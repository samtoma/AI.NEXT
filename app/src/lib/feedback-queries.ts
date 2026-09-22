/**
 * Reading and writing `feedback` (migration 025, FR-2801…FR-2811).
 *
 * **This is the only module in the application that touches the table**, and
 * that is load-bearing rather than tidy. `feedback-isolation.test.mts` walks
 * the import graph out of every prompt-building module and fails if this file
 * is reachable from any of them — a guarantee that is only meaningful because
 * there is exactly one file to be unreachable from. A second reader somewhere
 * else would make the test true and the property false.
 *
 * Three readers and two writers, on two different connections, and which is
 * which is the whole safety argument:
 *
 *  · `feedbackContext` / `recordFeedback` / `dismissFeedback` run under
 *    `withPrincipal` as `ainext_app`. Every row they touch is scoped by
 *    migration 025's policies to `current_setting('app.student_id')`, so the
 *    student id comes from the verified token and the DATABASE — not a WHERE
 *    clause somebody remembered to write — is what refuses another child's row.
 *  · `getFeedbackOverview` and `studentFeedback` run as `ainext_operator`,
 *    which holds **SELECT and nothing else** on this table. An operator cannot
 *    change what a child said, and the grant rather than this file is what
 *    makes that true.
 *
 * ---------------------------------------------------------------------------
 * NOTHING ABOUT THE ANSWER COMES FROM THE REQUEST BODY EXCEPT THE ANSWER
 * ---------------------------------------------------------------------------
 * The endpoint's payload is a moment, a thumb and a note. The student, the
 * sitting, the lesson and the course are all resolved HERE, from the verified
 * principal and from `sessions` — the same argument
 * `api/settings/appearance/route.ts` makes about the design variant, applied
 * to a row with more in it. A client that cannot name a session cannot file
 * its feedback against somebody else's lesson, and there is nothing this
 * feature could do with a client-supplied id that it cannot do without one.
 *
 * `sessions.lo_id` is what makes that possible: `/api/ask`, `/api/attempts`
 * and `/api/understanding` all stamp the objective onto the sitting, so the
 * lesson and the course are already recorded server-side by the time anybody
 * presses a thumb.
 *
 * `ENVIRONMENT` is applied first in every query, always (constitution XI,
 * FR-2509). "Did the students like it" pooled across the frozen baseline and
 * the comparison build would be a figure about neither, and it is exactly the
 * sort of figure somebody quotes.
 *
 * Every multi-query unit below runs through `sequential`, never `Promise.all`:
 * pg@9 removed the implicit queuing that used to make concurrent calls on one
 * client work (`lib/db.ts`).
 */

import type { PoolClient } from "pg";

import { sequential, withOperator, withPrincipal } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";
import {
  FEEDBACK_NOTE_MAX,
  mayAsk,
  sittingDurationMs,
  triggerFor,
  type FeedbackMoment,
  type FeedbackRating,
  type FeedbackTrigger,
  type MayAskDecision,
} from "@/lib/feedback-rules";

/* ===========================================================================
 * The student side
 * ======================================================================== */

/**
 * The decision, plus the two facts the row needs beyond it.
 *
 * `lessonSlug` and `courseId` ride along rather than being read again at write
 * time: the GET that renders the prompt and the POST that answers it are the
 * same sitting seconds apart, and resolving twice would be two chances to
 * disagree. The POST re-resolves anyway — it must, because a POST is not
 * obliged to have been preceded by a GET — and that is one query, not a
 * second copy of the rule.
 */
export type FeedbackContext = {
  /** Whether to OFFER the prompt. The GET returns this and nothing else. */
  decision: MayAskDecision;
  /**
   * Where an ANSWER would go, independently of whether we would have asked.
   *
   * **These two are separate on purpose, and the separation is a bug fix
   * waiting to happen otherwise.** The interaction is thumb first, note
   * second: by the time the note is posted, a row for this sitting already
   * exists, so `mayAsk` correctly answers `already_answered` — and a write
   * path that read its target out of the decision would drop the note on the
   * floor at exactly the moment a child had taken the trouble to type one.
   *
   * So the cadence rule governs asking, and the partial unique index governs
   * duplication. Null only when there is no sitting at all.
   */
  target: { sessionRef: number; trigger: FeedbackTrigger } | null;
  lessonSlug: string | null;
  courseId: string | null;
};

/**
 * "lo:geo1-2-1" → "geo1-2". The same derivation `lib/lesson.ts`'s `slugOfLo`
 * makes, restated here rather than imported, because importing `lib/lesson.ts`
 * would pull this module into the same graph as `learnPrompt` and
 * `reviewPrompt` — the two prompt builders `feedback-isolation.test.mts`
 * exists to keep at a distance. A three-line regular expression is a cheaper
 * price than an edge in that graph, and the test would fail loudly if anybody
 * paid the other one.
 */
function lessonSlugOfLo(loId: string | null): string | null {
  if (!loId) return null;
  const slug = loId.replace(/^lo:/, "").replace(/-[0-9]+$/, "");
  return slug === "" ? null : slug;
}

/** A sitting's kind, when it was a lesson rather than practice or a chat. */
const LESSON_KINDS = new Set(["lesson_learn", "lesson_review"]);

/**
 * `lo:u1-1-2` → `course:prep3-math-en`, by the same two hops
 * `LO_MODULE_SELECT` in `lib/lesson.ts` walks: an objective is `teaches`-ed by
 * a module, and a module is `part_of` a course. Restated here for the reason
 * `lessonSlugOfLo` is restated.
 *
 * `system_to IS NULL` on both edges keeps this on the current version of the
 * graph (migration 001's bitemporality) rather than matching a superseded one.
 */
const COURSE_OF_LO = `
  SELECT c.id AS course_id
    FROM graph_nodes lo
    JOIN graph_edges e   ON e.dst_id = lo.id AND e.edge_type = 'teaches'  AND e.system_to IS NULL
    JOIN graph_nodes m   ON m.id = e.src_id  AND m.kind = 'module'
    JOIN graph_edges ec  ON ec.src_id = m.id AND ec.edge_type = 'part_of' AND ec.system_to IS NULL
    JOIN graph_nodes c   ON c.id = ec.dst_id AND c.kind = 'course'
   WHERE lo.id = $1
   LIMIT 1
`;

/**
 * Everything the prompt needs to decide whether to appear, read as one unit of
 * work under this student's principal.
 *
 * **"Her most recent sitting" is the right sitting at both moments**, and for
 * the same reason at each: `/api/understanding` closes the lesson's session
 * with `completed` immediately before the report card renders, and the
 * practice loop's summary follows the last attempt, which is the last thing
 * that touched a session. In both cases the newest row by `opened_at` is the
 * one she has just finished.
 *
 * Returns "do not ask" on any failure. The prompt is the least important thing
 * on a report card, and a database that cannot answer must not be able to stop
 * a child seeing how she did.
 */
export async function feedbackContext(
  studentId: number,
  moment: FeedbackMoment
): Promise<FeedbackContext> {
  try {
    return await withPrincipal(studentId, (c) => contextOn(c, studentId, moment));
  } catch (err) {
    console.error("[feedback] could not decide whether to ask:", err);
    return {
      decision: { ask: false, because: "no_sitting" },
      target: null,
      lessonSlug: null,
      courseId: null,
    };
  }
}

async function contextOn(
  c: PoolClient,
  studentId: number,
  moment: FeedbackMoment
): Promise<FeedbackContext> {
  const [sittingRes, closedRes, lastRes] = await sequential([
    () =>
      c.query(
        `SELECT id, kind, lo_id, opened_at,
                coalesce(closed_at, last_seen_at) AS ended_at
           FROM sessions
          WHERE student_id = $1 AND environment = $2
          ORDER BY opened_at DESC
          LIMIT 1`,
        [studentId, ENVIRONMENT]
      ),
    () =>
      c.query(
        `SELECT count(*)::int AS n
           FROM sessions
          WHERE student_id = $1 AND environment = $2 AND closed_at IS NOT NULL`,
        [studentId, ENVIRONMENT]
      ),
    () =>
      c.query(
        `SELECT max(created_at) AS at
           FROM feedback
          WHERE student_id = $1 AND environment = $2`,
        [studentId, ENVIRONMENT]
      ),
  ] as const);

  const row = sittingRes.rows[0];
  const sitting = row
    ? {
        id: Number(row.id),
        openedAt: new Date(row.opened_at as string),
        endedAt: new Date(row.ended_at as string),
      }
    : null;

  // A second read rather than a join: "is there a row for THIS sitting" and
  // "when was she last asked anything" are different questions, and arriving
  // together they would only have to be untangled again inside `mayAsk`. It
  // costs one index lookup on a table of a few hundred rows.
  let answeredThisSitting = false;
  if (sitting) {
    const answered = await c.query(
      `SELECT 1 FROM feedback
        WHERE student_id = $1 AND environment = $2 AND session_ref = $3
        LIMIT 1`,
      [studentId, ENVIRONMENT, sitting.id]
    );
    answeredThisSitting = (answered.rowCount ?? 0) > 0;
  }

  const loId = (row?.lo_id as string | null) ?? null;
  const kind = (row?.kind as string | null) ?? null;

  // The slug is recorded only for a sitting that WAS a lesson. A practice
  // plan touches objectives too — `/api/attempts` stamps the first one onto
  // the session — and filing that under a lesson slug would put "this was
  // confusing" against a lesson the student never opened. The course is
  // resolved either way, because "how is the Arabic going" is a fair question
  // about a practice sitting.
  const lessonSlug = kind !== null && LESSON_KINDS.has(kind) ? lessonSlugOfLo(loId) : null;

  let courseId: string | null = null;
  if (loId) {
    const courseRes = await c.query(COURSE_OF_LO, [loId]);
    courseId = (courseRes.rows[0]?.course_id as string | null) ?? null;
  }

  const lastAt = lastRes.rows[0]?.at as string | null | undefined;

  return {
    decision: mayAsk({
      moment,
      sitting,
      answeredThisSitting,
      lastResolvedAt: lastAt ? new Date(lastAt) : null,
      closedSittings: Number(closedRes.rows[0]?.n ?? 0),
    }),
    // `triggerFor` rather than the decision's trigger, for the reason the
    // `target` field's docblock gives: this has to be right even when the
    // decision is "we would not have asked".
    target: sitting
      ? { sessionRef: sitting.id, trigger: triggerFor(moment, sittingDurationMs(sitting)) }
      : null,
    lessonSlug,
    courseId,
  };
}

/**
 * Write the thumb, and the note when one follows it.
 *
 * **One unit of work: re-resolve, then write.** The POST is not obliged to
 * have been preceded by a GET, and a caller that supplied its own session id
 * would be the client-trusted parameter this module exists without. So the
 * sitting is found again here, inside the same transaction as the INSERT.
 *
 * **One row per sitting, upserted.** The thumb arrives first and the note — if
 * it arrives at all — arrives seconds later from the same screen; they are one
 * answer rather than two events. `ON CONFLICT` on migration 025's partial
 * unique index is what makes that true without a read-then-write, so two taps
 * racing each other cannot produce two rows.
 *
 * **`coalesce(EXCLUDED.note, feedback.note)` on the note and not on the
 * rating.** A second POST carrying no note must not erase the note the first
 * one carried — that is the "she pressed the thumb again" case, and losing her
 * words to it would be unforgivable for the one column this whole feature is
 * arranged around. The rating IS overwritten plainly: changing her mind
 * between up and down is a thing she is allowed to do, and the later answer is
 * the one she means.
 *
 * `trigger_kind`, `lesson_slug` and `course_id` are not updated on conflict.
 * They describe the moment that asked, which happened once; a second POST is
 * the same moment, not a new one.
 *
 * Returns false when there was no sitting to attach the answer to — the
 * endpoint turns that into a 409 rather than writing a row with a null session
 * (FR-2309: a reference we cannot establish is a gap, never a guess).
 */
export async function recordFeedback(
  studentId: number,
  moment: FeedbackMoment,
  rating: FeedbackRating,
  note: string | null
): Promise<boolean> {
  if (note !== null && note.length > FEEDBACK_NOTE_MAX) {
    // Defence in depth, not validation: the endpoint has already refused this.
    // Reaching here means a second caller appeared that did not, and failing
    // loudly beats handing Postgres a row whose CHECK constraint will reject
    // it with a less useful message.
    throw new Error(
      `recordFeedback: note is ${note.length} characters, over the ${FEEDBACK_NOTE_MAX} cap`
    );
  }
  return withPrincipal(studentId, async (c) => {
    const ctx = await contextOn(c, studentId, moment);
    const target = ctx.target;
    if (!target) return false;
    await c.query(
      `INSERT INTO feedback
         (environment, student_id, session_ref, lesson_slug, course_id,
          trigger_kind, rating, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (environment, student_id, session_ref)
         WHERE session_ref IS NOT NULL
         DO UPDATE SET rating     = EXCLUDED.rating,
                       note       = coalesce(EXCLUDED.note, feedback.note),
                       updated_at = now()`,
      [
        ENVIRONMENT,
        studentId,
        target.sessionRef,
        ctx.lessonSlug,
        ctx.courseId,
        target.trigger,
        rating,
        note,
      ]
    );
    return true;
  });
}

/**
 * Record that she closed the prompt without answering.
 *
 * **`DO NOTHING`, never `DO UPDATE`.** A dismissal must never overwrite a
 * rating: a student who pressed a thumb and then closed the card has answered,
 * and turning that into `rating IS NULL` would both lose her answer and make
 * the row look like a refusal she did not make. The only row a dismissal ever
 * writes is the first one for that sitting.
 *
 * It still silences the prompt for the same fortnight an answer does — the row
 * is what `mayAsk` reads — which is the point of recording it at all. Kept
 * server-side against the student rather than in `localStorage`, on ADR-0017's
 * argument for the design variant: a preference about a person belongs to the
 * person, not to whichever browser she happened to be using. A dismissal in
 * browser storage is lost on the school computer and on a borrowed tablet, and
 * a child who said "not now" and is asked again the next evening has been told
 * that "not now" does not really exist.
 */
export async function dismissFeedback(
  studentId: number,
  moment: FeedbackMoment
): Promise<boolean> {
  return withPrincipal(studentId, async (c) => {
    const ctx = await contextOn(c, studentId, moment);
    const target = ctx.target;
    if (!target) return false;
    await c.query(
      `INSERT INTO feedback
         (environment, student_id, session_ref, lesson_slug, course_id,
          trigger_kind, rating, note)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)
       ON CONFLICT (environment, student_id, session_ref)
         WHERE session_ref IS NOT NULL
         DO NOTHING`,
      [
        ENVIRONMENT,
        studentId,
        target.sessionRef,
        ctx.lessonSlug,
        ctx.courseId,
        target.trigger,
      ]
    );
    return true;
  });
}

/* ===========================================================================
 * The console side — SELECT only, as `ainext_operator`
 * ======================================================================== */

/** One answer, with everything an operator needs in order to act on it. */
export type FeedbackNote = {
  id: number;
  studentId: number;
  studentName: string;
  sessionRef: number | null;
  lessonSlug: string | null;
  courseId: string | null;
  trigger: FeedbackTrigger;
  rating: FeedbackRating | null;
  note: string | null;
  createdAt: string;
};

export type FeedbackTally = {
  key: string;
  up: number;
  down: number;
  dismissed: number;
};

export type FeedbackFilters = {
  /** One `trigger_kind`, or null for all three. */
  trigger: FeedbackTrigger | null;
  /** 'up' | 'down' | 'dismissed', or null for everything. */
  rating: FeedbackRating | "dismissed" | null;
  /** Only rows carrying a note. **Defaults to true** — see `parseFeedbackFilters`. */
  notesOnly: boolean;
  /** A student id, or null. */
  student: number | null;
};

export type FeedbackOverview = {
  environment: string;
  totals: { up: number; down: number; dismissed: number; withNote: number };
  /** By ISO week, oldest first — the shape of it over time. */
  byWeek: FeedbackTally[];
  byTrigger: FeedbackTally[];
  /** Keyed by `course_id`; the page prints the registry's label for it. */
  byCourse: FeedbackTally[];
  /** The rows matching `filters`, newest first. */
  rows: FeedbackNote[];
  /** Every student who has ever answered, for the "who" filter links. */
  studentOptions: { id: number; name: string }[];
  filters: FeedbackFilters;
  /** The name behind `filters.student`, so a chip can print it (FR-2211). */
  studentFilterLabel: string | null;
  /** True when `rows` hit the limit and is therefore a cap rather than a count. */
  capped: boolean;
};

/** A screenful and then some, not a cliff — the same call `AUDIT_LIMIT` makes. */
export const FEEDBACK_ROW_LIMIT = 200;

/**
 * `searchParams` to a filter set that is always valid — pure, and the one
 * place a stale bookmark, a hand-edited URL or a typo is decided rather than
 * discovered. The same shape and the same reasoning as `parseSecurityFilters`,
 * deliberately: the security view established the filter-as-URL idiom on this
 * console and a third one would be a third thing for an operator to learn.
 *
 * **`notesOnly` defaults to TRUE, and that is the child-safety decision made
 * visible in a parser.** This page's job is to put children's words in front of
 * a person. Opening on a table of thumbs, with the notes behind a filter,
 * would make reading them optional — and a thing that is optional at 6 p.m. on
 * a Friday does not happen. `?notes=all` turns the counting view on and is one
 * click away.
 */
export function parseFeedbackFilters(
  raw: Readonly<{ [key: string]: string | string[] | undefined }>
): FeedbackFilters {
  const str = (key: string): string | null => {
    const v = raw[key];
    return typeof v === "string" && v !== "" ? v : null;
  };

  const trigger = str("trigger");
  const rating = str("rating");
  const studentRaw = str("student");
  const student = studentRaw !== null && /^\d+$/.test(studentRaw) ? Number(studentRaw) : null;

  return {
    trigger:
      trigger === "lesson_completed" || trigger === "session_ended" || trigger === "long_session"
        ? trigger
        : null,
    rating: rating === "up" || rating === "down" || rating === "dismissed" ? rating : null,
    notesOnly: str("notes") !== "all",
    student: student !== null && student > 0 ? student : null,
  };
}

/**
 * Everything `/feedback` renders, in one unit of work.
 *
 * Seven queries, fixed — every one runs whatever the filters say, because a
 * query count that grows with what was clicked is a page whose cost nobody can
 * state (`lib/security-queries.ts` makes the same argument about thirteen).
 *
 * **The tallies are deliberately unfiltered.** An operator narrowed to one
 * student still sees the cohort's shape beside that student's notes; without
 * it, four downs from one child read as the product's verdict.
 */
export async function getFeedbackOverview(
  operatorId: number,
  filters: FeedbackFilters
): Promise<FeedbackOverview> {
  return withOperator(operatorId, async (c) => {
    const [totalsRes, weekRes, triggerRes, courseRes, rowsRes, optionsRes, labelRes] =
      await sequential([
        () =>
          c.query(
            `SELECT count(*) FILTER (WHERE rating = 'up')     ::int AS up,
                    count(*) FILTER (WHERE rating = 'down')   ::int AS down,
                    count(*) FILTER (WHERE rating IS NULL)    ::int AS dismissed,
                    count(*) FILTER (WHERE note IS NOT NULL)  ::int AS with_note
               FROM feedback WHERE environment = $1`,
            [ENVIRONMENT]
          ),
        // `date_trunc('week', …)` is ISO — Monday-anchored — which is what the
        // overviews already use. Oldest first, so the reader's eye travels the
        // way time does; the notes below run the other way for the opposite
        // reason.
        () =>
          c.query(
            `SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD')  AS key,
                    count(*) FILTER (WHERE rating = 'up')   ::int          AS up,
                    count(*) FILTER (WHERE rating = 'down') ::int          AS down,
                    count(*) FILTER (WHERE rating IS NULL)  ::int          AS dismissed
               FROM feedback WHERE environment = $1
              GROUP BY 1 ORDER BY 1`,
            [ENVIRONMENT]
          ),
        () =>
          c.query(
            `SELECT trigger_kind                                  AS key,
                    count(*) FILTER (WHERE rating = 'up')   ::int  AS up,
                    count(*) FILTER (WHERE rating = 'down') ::int  AS down,
                    count(*) FILTER (WHERE rating IS NULL)  ::int  AS dismissed
               FROM feedback WHERE environment = $1
              GROUP BY 1 ORDER BY 1`,
            [ENVIRONMENT]
          ),
        // A sitting whose course could not be resolved groups under the empty
        // string rather than being dropped: a view that silently omitted rows
        // would be the wrong kind of tidy, and the page labels it plainly.
        () =>
          c.query(
            `SELECT coalesce(course_id, '')                       AS key,
                    count(*) FILTER (WHERE rating = 'up')   ::int  AS up,
                    count(*) FILTER (WHERE rating = 'down') ::int  AS down,
                    count(*) FILTER (WHERE rating IS NULL)  ::int  AS dismissed
               FROM feedback WHERE environment = $1
              GROUP BY 1 ORDER BY 1`,
            [ENVIRONMENT]
          ),
        () =>
          c.query(
            `SELECT f.id, f.student_id, s.display_name, f.session_ref, f.lesson_slug,
                    f.course_id, f.trigger_kind, f.rating, f.note, f.created_at
               FROM feedback f
               JOIN students s ON s.id = f.student_id
              WHERE f.environment = $1
                AND ($2::text IS NULL OR f.trigger_kind = $2)
                AND ($3::text IS NULL
                     OR ($3 = 'dismissed' AND f.rating IS NULL)
                     OR f.rating = $3)
                AND (NOT $4::boolean OR f.note IS NOT NULL)
                AND ($5::bigint IS NULL OR f.student_id = $5)
              ORDER BY f.created_at DESC
              LIMIT ${FEEDBACK_ROW_LIMIT}`,
            [ENVIRONMENT, filters.trigger, filters.rating, filters.notesOnly, filters.student]
          ),
        () =>
          c.query(
            `SELECT DISTINCT s.id, s.display_name
               FROM feedback f JOIN students s ON s.id = f.student_id
              WHERE f.environment = $1
              ORDER BY s.display_name`,
            [ENVIRONMENT]
          ),
        () =>
          filters.student == null
            ? Promise.resolve({ rows: [] as Record<string, unknown>[], rowCount: 0 })
            : c.query(`SELECT display_name FROM students WHERE id = $1`, [filters.student]),
      ] as const);

    const t = totalsRes.rows[0] ?? {};
    const tally = (r: Record<string, unknown>): FeedbackTally => ({
      key: String(r.key ?? ""),
      up: Number(r.up ?? 0),
      down: Number(r.down ?? 0),
      dismissed: Number(r.dismissed ?? 0),
    });

    return {
      environment: ENVIRONMENT,
      totals: {
        up: Number(t.up ?? 0),
        down: Number(t.down ?? 0),
        dismissed: Number(t.dismissed ?? 0),
        withNote: Number(t.with_note ?? 0),
      },
      byWeek: weekRes.rows.map(tally),
      byTrigger: triggerRes.rows.map(tally),
      byCourse: courseRes.rows.map(tally),
      rows: rowsRes.rows.map(toNote),
      studentOptions: optionsRes.rows.map((r) => ({
        id: Number(r.id),
        name: String(r.display_name ?? ""),
      })),
      filters,
      studentFilterLabel: labelRes.rows[0] ? String(labelRes.rows[0].display_name ?? "") : null,
      capped: rowsRes.rows.length === FEEDBACK_ROW_LIMIT,
    };
  });
}

/**
 * One student's own feedback, newest first — the Student 360 panel.
 *
 * It takes a client rather than opening its own unit of work, because the 360
 * reads a dozen things inside ONE `withOperator` transaction and a function
 * that insisted on its own would turn that page into two connections for no
 * gain. Shaped exactly like the other readers in `lib/console-queries.ts`, and
 * called from there.
 */
export async function studentFeedback(
  c: PoolClient,
  studentId: number,
  limit: number
): Promise<FeedbackNote[]> {
  const res = await c.query(
    `SELECT f.id, f.student_id, s.display_name, f.session_ref, f.lesson_slug,
            f.course_id, f.trigger_kind, f.rating, f.note, f.created_at
       FROM feedback f
       JOIN students s ON s.id = f.student_id
      WHERE f.student_id = $1 AND f.environment = $2
      ORDER BY f.created_at DESC
      LIMIT ${Number(limit)}`,
    [studentId, ENVIRONMENT]
  );
  return res.rows.map(toNote);
}

function toNote(r: Record<string, unknown>): FeedbackNote {
  return {
    id: Number(r.id),
    studentId: Number(r.student_id),
    studentName: String(r.display_name ?? ""),
    sessionRef: r.session_ref == null ? null : Number(r.session_ref),
    lessonSlug: (r.lesson_slug as string | null) ?? null,
    courseId: (r.course_id as string | null) ?? null,
    trigger: r.trigger_kind as FeedbackTrigger,
    rating: (r.rating as FeedbackRating | null) ?? null,
    note: (r.note as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

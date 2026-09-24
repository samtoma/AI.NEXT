/**
 * The teaching switches and tester marks — the CONSOLE's database seam
 * (ADR-0021, migration 030).
 *
 * Every decision is made in `lib/socratic-probing.ts`, which is pure; this
 * file only fetches and writes rows, as `ainext_operator` through
 * `withOperator`. The STUDENT side of the same tables — the resolver reading
 * the switch and the student's own mark under her principal — lives in
 * `lib/sessions.ts`, because it runs exactly once, when a learning session
 * opens, and nowhere else.
 *
 * `environment` is filtered on every read and written on every row
 * (constitution XI): the comparison build and the frozen baseline may teach
 * differently, and a switch read across both would make one of them wrong.
 *
 * Who did it and when is not a comment here: `teaching_settings.updated_by`,
 * `teaching_setting_changes` (append-only by privilege) and the
 * `marked_by`/`unmarked_by` columns of `student_testers` (the console holds
 * UPDATE on the two "removed" columns only). The console cannot write a change
 * without an author, because every function below takes the operator from the
 * caller's authorised principal and never from a request body.
 */

import { cache } from "react";

import { sequential, withOperator } from "@/lib/db";
import { ENVIRONMENT, RELEASE_TAG } from "@/lib/env";
import {
  PROBING_EVERYONE_UNLOCKED,
  asProbingSetting,
  effectiveSetting,
  type ProbingSetting,
} from "@/lib/socratic-probing";

type Db = {
  query: (
    text: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

const iso = (v: unknown): string => new Date(v as string).toISOString();
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

/* ------------------------------------------------------------------ */
/* The switch                                                          */
/* ------------------------------------------------------------------ */

export type TeachingState = {
  environment: string;
  /** what the row says; `off` when there is no row */
  stored: ProbingSetting;
  /** what the product acts on — `everyone` while locked reads as `testers` */
  effective: ProbingSetting;
  everyoneUnlocked: boolean;
  /** display name of whoever last moved it; null when nobody ever has */
  updatedBy: string | null;
  /** null = never changed: the default nobody chose */
  updatedAt: string | null;
  /** the deployed release, for the same header */
  releaseTag: string;
};

async function stateOn(db: Db): Promise<TeachingState> {
  const res = await db.query(
    `SELECT ts.socratic_probing, ts.updated_at, op.display_name AS updated_by
       FROM teaching_settings ts
       LEFT JOIN operators op ON op.id = ts.updated_by
      WHERE ts.environment = $1`,
    [ENVIRONMENT]
  );
  const r = res.rows[0];
  const stored = asProbingSetting(r?.socratic_probing);
  return {
    environment: ENVIRONMENT,
    stored,
    effective: effectiveSetting(stored),
    everyoneUnlocked: PROBING_EVERYONE_UNLOCKED,
    updatedBy: strOrNull(r?.updated_by),
    updatedAt: isoOrNull(r?.updated_at),
    releaseTag: RELEASE_TAG,
  };
}

/** The switch as it stands in this environment. Cheap: one indexed read. */
export async function getTeachingState(operatorId: number): Promise<TeachingState> {
  return withOperator(operatorId, (db) => stateOn(db));
}

/**
 * `getTeachingState`, or `null` when it cannot be read — for the surfaces
 * where the switch is a side fact rather than the subject: the console header
 * on every page, and the Student 360's test-account panel. A failed read there
 * must print "Probing: unknown", never take the whole console down with a 500
 * (a missing table after a partial rollback, a revoked grant, a dropped
 * connection). `/teaching` itself keeps the throwing read: on the page whose
 * subject IS the switch, an error page is the honest answer.
 *
 * **One read per request, however many surfaces ask** (fix pass 2): wrapped
 * in React's `cache()`, which memoises per server render — the layout's header
 * chip and a page that also shows the switch (the Student 360) share one
 * round trip instead of two, the shape `documentVariant` and
 * `resolveStudentId` already have. Per request, NOT across requests: a
 * process-wide TTL would let the header say the old position for seconds
 * after an operator moved the switch, and this chip exists to be believed.
 * A failure is memoised as the `null` it becomes, so "unknown" is printed
 * consistently for the whole render rather than retried per caller.
 */
export const getTeachingStateOrNull = cache(async function getTeachingStateOrNull(
  operatorId: number
): Promise<TeachingState | null> {
  try {
    return await getTeachingState(operatorId);
  } catch (err) {
    console.error("[console] could not read the teaching switch; showing it as unknown:", err);
    return null;
  }
});

export type TeachingChange = {
  id: number;
  /** null: there was no row — the default (off) nobody had chosen */
  fromValue: ProbingSetting | null;
  toValue: ProbingSetting;
  changedBy: string | null;
  changedAt: string;
  note: string | null;
};

export type TesterRow = {
  studentId: number;
  displayName: string;
  markedAt: string;
  markedBy: string | null;
};

export type TeachingPage = {
  state: TeachingState;
  history: TeachingChange[];
  /** open tester marks in this environment */
  testerCount: number;
  /** the marked students — only when the caller may list students */
  testers: TesterRow[] | null;
};

/**
 * Everything `/teaching` shows. `listTesters` is the caller's
 * `crossStudentReadAllowed("student_list", roles)`: every operator may read
 * the switch and the COUNT of test accounts, and only a `student-data` holder
 * — the role that already lists students — sees their names.
 */
export async function getTeachingPage(
  operatorId: number,
  listTesters: boolean
): Promise<TeachingPage> {
  return withOperator(operatorId, async (db) => {
    const [state, history, count, testers] = await sequential([
      () => stateOn(db),
      () =>
        db.query(
          `SELECT c.id, c.from_value, c.to_value, c.changed_at, c.note,
                  op.display_name AS changed_by
             FROM teaching_setting_changes c
             LEFT JOIN operators op ON op.id = c.changed_by
            WHERE c.environment = $1 AND c.setting = 'socratic_probing'
            ORDER BY c.changed_at DESC, c.id DESC
            LIMIT 50`,
          [ENVIRONMENT]
        ),
      () =>
        db.query(
          `SELECT count(*) AS n FROM student_testers
            WHERE environment = $1 AND unmarked_at IS NULL`,
          [ENVIRONMENT]
        ),
      () =>
        listTesters
          ? db.query(
              `SELECT t.student_id, s.display_name, t.marked_at,
                      op.display_name AS marked_by
                 FROM student_testers t
                 JOIN students s ON s.id = t.student_id
                 LEFT JOIN operators op ON op.id = t.marked_by
                WHERE t.environment = $1 AND t.unmarked_at IS NULL
                ORDER BY t.marked_at DESC`,
              [ENVIRONMENT]
            )
          : Promise.resolve(null),
    ] as const);

    return {
      state,
      history: history.rows.map((r) => ({
        id: Number(r.id),
        fromValue: r.from_value == null ? null : asProbingSetting(r.from_value),
        toValue: asProbingSetting(r.to_value),
        changedBy: strOrNull(r.changed_by),
        changedAt: iso(r.changed_at),
        note: strOrNull(r.note),
      })),
      testerCount: Number(count.rows[0]?.n ?? 0),
      testers: testers
        ? testers.rows.map((r) => ({
            studentId: Number(r.student_id),
            displayName: String(r.display_name ?? ""),
            markedAt: iso(r.marked_at),
            markedBy: strOrNull(r.marked_by),
          }))
        : null,
    };
  });
}

/**
 * Move the switch, recording from → to, who and when, in one transaction.
 *
 * The caller has already refused what may not be stored
 * (`settingChangeRefusal`) and checked the role; this only writes. A
 * transaction-scoped advisory lock serialises two operators saving at once,
 * so the history's `from_value` is always the value the change actually
 * replaced — without it, two saves from "off" would both record "from off".
 *
 * **Not writing is an answer.** Saving the position that is already in force
 * records nothing and reports `changed: false`: the history is a list of
 * changes, and a row per click on Save would bury the ones that were.
 */
export async function setProbingSetting(
  operatorId: number,
  to: ProbingSetting,
  note: string | null
): Promise<{ changed: boolean; from: ProbingSetting | null; to: ProbingSetting }> {
  return withOperator(operatorId, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `teaching_settings:${ENVIRONMENT}`,
    ]);
    const cur = await db.query(
      `SELECT socratic_probing FROM teaching_settings WHERE environment = $1`,
      [ENVIRONMENT]
    );
    const from = cur.rows[0] ? asProbingSetting(cur.rows[0].socratic_probing) : null;
    if ((from ?? "off") === to) return { changed: false, from, to };

    await db.query(
      `INSERT INTO teaching_settings (environment, socratic_probing, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (environment) DO UPDATE
          SET socratic_probing = EXCLUDED.socratic_probing,
              updated_by       = EXCLUDED.updated_by,
              updated_at       = now()`,
      [ENVIRONMENT, to, operatorId]
    );
    await db.query(
      `INSERT INTO teaching_setting_changes
         (environment, setting, from_value, to_value, changed_by, note)
       VALUES ($1, 'socratic_probing', $2, $3, $4, $5)`,
      [ENVIRONMENT, from, to, operatorId, note]
    );
    return { changed: true, from, to };
  });
}

/* ------------------------------------------------------------------ */
/* Tester marks                                                        */
/* ------------------------------------------------------------------ */

export type TesterMark = {
  id: number;
  note: string | null;
  markedBy: string | null;
  markedAt: string;
  unmarkedBy: string | null;
  unmarkedAt: string | null;
};

/**
 * One student's marks, newest first: the open one (if any) and every earlier
 * one with who removed it. Read on the Student 360, whose own `student_360`
 * audit row already records that this operator opened the record — a second
 * row for the same click would count one read twice (`studentAccess` makes
 * the same argument).
 */
export async function studentTesterMarks(
  operatorId: number,
  studentId: number
): Promise<{ current: TesterMark | null; history: TesterMark[] }> {
  const rows = await withOperator(operatorId, async (db) => {
    const res = await db.query(
      `SELECT t.id, t.note, t.marked_at, t.unmarked_at,
              mb.display_name AS marked_by, ub.display_name AS unmarked_by
         FROM student_testers t
         LEFT JOIN operators mb ON mb.id = t.marked_by
         LEFT JOIN operators ub ON ub.id = t.unmarked_by
        WHERE t.environment = $1 AND t.student_id = $2
        ORDER BY t.marked_at DESC, t.id DESC
        LIMIT 20`,
      [ENVIRONMENT, studentId]
    );
    return res.rows;
  });
  const marks: TesterMark[] = rows.map((r) => ({
    id: Number(r.id),
    note: strOrNull(r.note),
    markedBy: strOrNull(r.marked_by),
    markedAt: iso(r.marked_at),
    unmarkedBy: strOrNull(r.unmarked_by),
    unmarkedAt: isoOrNull(r.unmarked_at),
  }));
  return {
    current: marks.find((m) => m.unmarkedAt == null) ?? null,
    history: marks.filter((m) => m.unmarkedAt != null),
  };
}

/** `studentTesterMarks`, or `null` when the marks cannot be read (see `getTeachingStateOrNull`). */
export async function studentTesterMarksOrNull(
  operatorId: number,
  studentId: number
): Promise<{ current: TesterMark | null; history: TesterMark[] } | null> {
  try {
    return await studentTesterMarks(operatorId, studentId);
  } catch (err) {
    console.error("[console] could not read the tester marks; showing them as unknown:", err);
    return null;
  }
}

/**
 * Mark or unmark one student as a test account. `null` when the student is
 * not in this environment (the route answers 404, like the subscription
 * endpoint: "not yours" and "not there" are one answer).
 *
 * Marking inserts a row; unmarking STAMPS the open row — the console holds no
 * DELETE, so a removed mark is history, not a gap. Asking for the state a
 * student is already in changes nothing and says so.
 */
export async function setTesterMark(
  operatorId: number,
  studentId: number,
  tester: boolean,
  note: string | null
): Promise<{ changed: boolean; tester: boolean } | null> {
  return withOperator(operatorId, async (db) => {
    const who = await db.query(
      `SELECT 1 FROM students WHERE id = $1 AND environment = $2`,
      [studentId, ENVIRONMENT]
    );
    if (!who.rows[0]) return null;

    if (!tester) {
      const res = await db.query(
        `UPDATE student_testers
            SET unmarked_at = now(), unmarked_by = $3
          WHERE environment = $1 AND student_id = $2 AND unmarked_at IS NULL`,
        [ENVIRONMENT, studentId, operatorId]
      );
      return { changed: (res.rowCount ?? 0) > 0, tester: false };
    }

    // Insert only when no mark is open. The partial unique index is the
    // invariant; a race between two operators ends with one row and the loser
    // told nothing changed, rather than a 500.
    await db.query("SAVEPOINT tester_mark");
    try {
      const res = await db.query(
        `INSERT INTO student_testers (environment, student_id, note, marked_by)
         SELECT $1, $2, $3, $4
          WHERE NOT EXISTS (SELECT 1 FROM student_testers
                             WHERE environment = $1 AND student_id = $2
                               AND unmarked_at IS NULL)`,
        [ENVIRONMENT, studentId, note, operatorId]
      );
      await db.query("RELEASE SAVEPOINT tester_mark");
      return { changed: (res.rowCount ?? 0) > 0, tester: true };
    } catch (err) {
      await db.query("ROLLBACK TO SAVEPOINT tester_mark");
      if ((err as { code?: string }).code === "23505") return { changed: false, tester: true };
      throw err;
    }
  });
}

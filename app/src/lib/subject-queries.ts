import type { PoolClient } from "pg";

import { pool, sequential } from "./db";
import { visibleCoursesFor, type CourseScope } from "./catalog-queries";
import { scoped, type Db } from "./student-context";
import { MODULE_ORDER } from "./module-order";
import { compareCourses, courseDef } from "./courses";
import {
  displayLabelOfSpineKey,
  spineSubjectOf,
  spineSubjectOfCourse,
} from "./subjects";
import type { LessonBridge, SpineSubject, SubjectSummary, Verdict } from "./types";
import type { ProgressionLesson } from "./progression";
import {
  BOOK_SECTIONS_SQL,
  sectionIndexFromRows,
  type BookSectionRow,
  type SectionIndex,
} from "./book-sections";
import { sectionProgress } from "./section-label";


/**
 * Per-subject roll-ups + cross-subject bridges (Wave 1.5, the multi-subject
 * spine). "Separated by default, bridged by exception":
 *   - getSubjectSummaries → each COURSE's mastery, weakest topic and last
 *     check, rolled up ONLY within the course (never a blended score, §4) —
 *     one per subject for every student who sees one course of each, and two
 *     apart for a tester who sees two courses of one subject (FR-4009).
 *   - getLessonBridges → the curated `relates_to` connections touching a
 *     lesson's LOs, so the tutor can surface ONE grounded cross-subject hint
 *     at the natural moment (§5).
 *
 * Subject comes from the LO's course via the registry's EXACT lookup
 * (lib/subjects.ts). It used to be `courseId.endsWith("-social-ar") ? "social"
 * : "math"` with an `lo:soc*` id-prefix fallback — two guesses that made every
 * unrecognized course, and every LO whose id did not start with `lo:soc`, come
 * out as maths. An LO whose course is not in the registry is now UNFILED
 * (`null`) and simply does not roll up into any subject.
 */

/** "lo:soc1-2-1" → lesson slug "soc1-2" (LO-id minus the trailing part). */
function slugOfLo(loId: string): string {
  return loId.replace(/^lo:/, "").replace(/-[0-9]+$/, "");
}

async function columnExists(db: Db, table: string, column: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, column]
  );
  return (r.rowCount ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* Per-subject roll-up (student home)                                  */
/* ------------------------------------------------------------------ */

export async function getSubjectSummaries(
  studentId: number,
  c?: PoolClient
): Promise<SubjectSummary[]> {
  return scoped(studentId, c, (db) => subjectSummariesOn(db, studentId));
}

async function subjectSummariesOn(
  db: Db,
  studentId: number
): Promise<SubjectSummary[]> {
  // The course gate (migration 023). This is the student home — the surface
  // that decides whether a subject exists at all as far as a child is
  // concerned — so a hidden course must not appear here even as a zero. It is
  // the same set `lib/lesson.ts` gates on; the two surfaces cannot disagree
  // about which subjects are on.
  //
  // `studentId` is always a real student here (the one caller resolves it from
  // the session), so there is no ungated path through this function.
  const visible = await visibleCoursesFor(
    studentId,
    "release" in db ? (db as PoolClient) : undefined
  );
  // One client, so one query at a time (pg@9; lib/db.ts `sequential`).
  const [losRes, checksRes] = await sequential([
    () => db.query(
      `SELECT lo.id, lo.label, lo.order_in_parent,
              m.id AS module_id, m.order_in_parent AS module_order,
              c.id AS course_id, c.label AS course_label,
              ms.score AS mastery
       FROM graph_nodes lo
       LEFT JOIN graph_edges e
         ON e.dst_id = lo.id AND e.edge_type = 'teaches' AND e.system_to IS NULL
       LEFT JOIN graph_nodes m ON m.id = e.src_id AND m.kind = 'module'
       LEFT JOIN graph_edges ec
         ON ec.src_id = m.id AND ec.edge_type = 'part_of' AND ec.system_to IS NULL
       LEFT JOIN graph_nodes c ON c.id = ec.dst_id AND c.kind = 'course'
       LEFT JOIN mastery ms
         ON ms.lo_id = lo.id AND ms.student_id = $1 AND ms.system_to IS NULL
       WHERE lo.kind = 'learning_objective'
       ORDER BY ${MODULE_ORDER}`,
      [studentId]
    ),
    () => db.query(
      // `subject` is written by /api/understanding on every insert and was
      // backfilled by migration 006 — read it instead of guessing the subject
      // back out of the LO id.
      `SELECT lo_id, score, verdict, mode, created_at, subject
       FROM understanding_checks
       WHERE student_id = $1
       ORDER BY created_at DESC`,
      [studentId]
    ),
  ] as const);

  // ONE SUMMARY PER COURSE, never per subject (FR-4009, T371/T372). A student
  // normally sees one course of each subject, and then this is exactly the
  // per-subject home it always was. But an operator's exception can show her
  // the other curriculum's course of the same subject (a tester previewing the
  // Grade 10 book beside her Prep-3 maths), and a roll-up keyed by subject
  // then averaged the two books into one "Mathematics" card, named after
  // whichever course came first, with the other book's weakest topic and
  // lessons folded in. Keyed by course, the two stay apart, each in its own
  // book's order, each with its own mastery.
  interface Acc {
    subject: SpineSubject;
    courseId: string;
    courseLabel: string;
    scoreSum: number;
    scoreN: number;
    weakest: { id: string; label: string; mastery: number } | null;
    slugs: Set<string>;
    defaultSlug: string | null;
    /** the course's lessons in teach order, with mastery — for the roll-ups */
    lessons: Map<string, ProgressionLesson & { los: { id: string; mastery: number }[] }>;
  }
  const byCourse = new Map<string, Acc>();
  /** objective → its course, for the objectives that were filed (the checks below) */
  const courseOfLo = new Map<string, string>();
  /** every objective the graph holds, filed or not — to tell "hidden" from "gone" */
  const inGraph = new Set<string>();

  for (const r of losRes.rows) {
    inGraph.add(String(r.id));
    // Gated before it is filed: a hidden course contributes no LO, so it
    // produces no summary, no average and no "0%" card hinting that a subject
    // is there and empty.
    if (r.course_id == null || !visible.has(r.course_id)) continue;
    // Unfiled LO (course not in the registry): it belongs to no subject, so it
    // rolls up into none. It is NOT quietly added to maths' average.
    const subject = spineSubjectOfCourse(r.course_id);
    if (!subject) continue;
    const courseId = r.course_id as string;
    if (!courseOfLo.has(r.id)) courseOfLo.set(r.id, courseId);
    let acc = byCourse.get(courseId);
    if (!acc) {
      acc = {
        subject,
        courseId,
        courseLabel:
          (r.course_label as string) ?? displayLabelOfSpineKey(subject),
        scoreSum: 0,
        scoreN: 0,
        weakest: null,
        slugs: new Set(),
        defaultSlug: null,
        lessons: new Map(),
      };
      byCourse.set(courseId, acc);
    }
    const mastery = r.mastery == null ? 0 : Number(r.mastery);
    acc.scoreSum += mastery;
    acc.scoreN += 1;
    if (!acc.weakest || mastery < acc.weakest.mastery) {
      acc.weakest = { id: r.id, label: r.label, mastery };
    }
    const slug = slugOfLo(r.id);
    if (!acc.slugs.has(slug)) acc.slugs.add(slug);
    if (acc.defaultSlug == null) acc.defaultSlug = slug; // first in teach order
    let lesson = acc.lessons.get(slug);
    if (!lesson) {
      lesson = { slug, courseId: r.course_id ?? null, los: [] };
      acc.lessons.set(slug, lesson);
    }
    lesson.los.push({ id: r.id, mastery });
  }

  // The book sections of the courses she may see (FR-4314; migration 034),
  // read after the gate — the store holds lesson titles. One read for every
  // subject; none when nothing is visible.
  const courseIds = [...byCourse.keys()];
  const sections: SectionIndex = sectionIndexFromRows(
    courseIds.length === 0
      ? []
      : ((await db.query(BOOK_SECTIONS_SQL, [courseIds])).rows as BookSectionRow[])
  );

  // Last comprehension check per COURSE (checks are newest-first already),
  // read through the check's own objective: the `subject` tag cannot tell two
  // maths books apart. A check on an objective of a course she may not see
  // (the other curriculum's book, an exception since revoked) is skipped — it
  // is not evidence about any course on this page. Only a check whose
  // objective the graph no longer holds at all (or that names none) falls
  // back to its subject tag, and then only when exactly one of her courses
  // teaches that subject — every National student — so an old row still lands
  // where it always did and never on the wrong one of two books.
  const coursesOfSubject = new Map<SpineSubject, string[]>();
  for (const a of byCourse.values()) {
    coursesOfSubject.set(a.subject, [...(coursesOfSubject.get(a.subject) ?? []), a.courseId]);
  }
  const lastCheck = new Map<string, SubjectSummary["lastCheck"]>();
  for (const c of checksRes.rows) {
    let courseId: string | null = null;
    const loId = c.lo_id == null ? null : String(c.lo_id);
    if (loId != null && inGraph.has(loId)) {
      courseId = courseOfLo.get(loId) ?? null;
    } else {
      const subject = spineSubjectOf(c.subject);
      const only = subject ? coursesOfSubject.get(subject) : undefined;
      courseId = only && only.length === 1 ? only[0] : null;
    }
    if (courseId == null || lastCheck.has(courseId)) continue;
    lastCheck.set(courseId, {
      score: Number(c.score),
      verdict: c.verdict as Verdict,
      mode: c.mode === "review" ? "review" : "learn",
      createdAt: new Date(c.created_at).toISOString(),
    });
  }

  // Two courses of one subject (the tester's exception) would otherwise show
  // two cards that may carry the same node label ("Mathematics"): name each by
  // its registry course label ("Mathematics — Grade 10") in that case only.
  const shared = new Set(
    [...coursesOfSubject].filter(([, ids]) => ids.length > 1).map(([s]) => s)
  );

  // Course order — curriculum, then subject, then course (`lib/courses.ts`).
  // For a National student that IS the registry subject order the home has
  // always used (maths, Social Studies, Arabic), and two courses of one
  // subject sit side by side, never interleaved (FR-4009).
  return [...byCourse.values()]
    .sort((a, b) => compareCourses(a.courseId, b.courseId))
    .map((a) => ({
      subject: a.subject,
      courseId: a.courseId,
      courseLabel: shared.has(a.subject)
        ? (courseDef(a.courseId)?.label ?? a.courseLabel)
        : a.courseLabel,
      avgMastery: a.scoreN ? a.scoreSum / a.scoreN : 0,
      weakestLo: a.weakest,
      lessonsCount: a.slugs.size,
      defaultSlug: a.defaultSlug,
      lastCheck: lastCheck.get(a.courseId) ?? null,
      // "k of m parts mastered" per split section; [] for every National course
      sections: sectionProgress([...a.lessons.values()], sections),
    }));
}

/* ------------------------------------------------------------------ */
/* Cross-subject bridges for a lesson (the grounded hint)              */
/* ------------------------------------------------------------------ */

/**
 * The curated `relates_to` connections touching any of `loIds` (this lesson's
 * objectives). Each returned bridge names the FAR endpoint (in another
 * subject) + the human-approved one-line rationale, so the tutor can cite the
 * connection instead of fabricating one. Empty until Track A's `rationale`
 * column + edges land — never throws.
 *
 * The far endpoint's subject is read from the `node_subject` view (migration
 * 007: derived from `graph_nodes.subject` on the course), not guessed from its
 * LO id. The old `lo:soc*` prefix test named every non-social endpoint
 * «الرياضيات» in the tutor's own prompt — a mislabel the model would repeat
 * verbatim to the student.
 *
 * **THE COURSE GATE, ON BOTH ENDS** (FR-4006, FR-2705; the 2026-09-26
 * isolation audit). A bridge is a piece of ANOTHER course put in front of the
 * tutor — its objective's label and a rationale about it — so it is content,
 * and it is refused like content: a bridge survives only when the courses of
 * BOTH its objectives are ones this student may see. Before this, a student
 * who could see Prep-3 maths but not Social Studies had a Social Studies
 * objective and its explanation written into her maths tutor's instructions,
 * and an American student would have had the same from any National course a
 * bridge reached. An end that resolves to no course is refused, like an
 * unknown course (FR-2704).
 *
 * `scope` is required, so no caller can read bridges without deciding whose
 * they are. The prompt-capture harness passes the ungated scope (no student),
 * whose `course()` admits everything — its captures are unchanged.
 */
export async function getLessonBridges(
  loIds: string[],
  scope: CourseScope,
  db: Db = pool
): Promise<LessonBridge[]> {
  if (loIds.length === 0) return [];
  try {
    if (!(await columnExists(db, "graph_edges", "rationale"))) return [];
    // Each end's course, by the walk every gate uses: objective ← module
    // (`teaches`) → course (`part_of`), open edges only.
    const res = await db.query(
      `SELECT e.src_id, e.dst_id, e.rationale,
              ns.label AS src_label, nd.label AS dst_label,
              ss.subject AS src_subject, ds.subject AS dst_subject,
              (SELECT pc.dst_id FROM graph_edges te
                 JOIN graph_edges pc
                   ON pc.src_id = te.src_id AND pc.edge_type = 'part_of' AND pc.system_to IS NULL
                 JOIN graph_nodes c ON c.id = pc.dst_id AND c.kind = 'course'
                WHERE te.dst_id = e.src_id AND te.edge_type = 'teaches' AND te.system_to IS NULL
                ORDER BY pc.dst_id LIMIT 1) AS src_course,
              (SELECT pc.dst_id FROM graph_edges te
                 JOIN graph_edges pc
                   ON pc.src_id = te.src_id AND pc.edge_type = 'part_of' AND pc.system_to IS NULL
                 JOIN graph_nodes c ON c.id = pc.dst_id AND c.kind = 'course'
                WHERE te.dst_id = e.dst_id AND te.edge_type = 'teaches' AND te.system_to IS NULL
                ORDER BY pc.dst_id LIMIT 1) AS dst_course
       FROM graph_edges e
       JOIN graph_nodes ns ON ns.id = e.src_id
       JOIN graph_nodes nd ON nd.id = e.dst_id
       LEFT JOIN node_subject ss ON ss.node_id = e.src_id
       LEFT JOIN node_subject ds ON ds.node_id = e.dst_id
       WHERE e.edge_type = 'relates_to' AND e.system_to IS NULL
         AND (e.src_id = ANY($1) OR e.dst_id = ANY($1))`,
      [loIds]
    );
    const here = new Set(loIds);
    const out: LessonBridge[] = [];
    const seen = new Set<string>();
    for (const r of res.rows) {
      // the gate, per row and on both ends, before anything is built from it
      if (!scope.course(r.src_course) || !scope.course(r.dst_course)) continue;
      const srcHere = here.has(r.src_id);
      const thisLo = srcHere ? r.src_id : r.dst_id;
      const otherLo = srcHere ? r.dst_id : r.src_id;
      const thisLabel = srcHere ? r.src_label : r.dst_label;
      const otherLabel = srcHere ? r.dst_label : r.src_label;
      // the far endpoint's real subject; an unfiled endpoint yields no bridge
      // rather than a bridge labelled with the wrong subject
      const otherSubject = spineSubjectOf(
        srcHere ? r.dst_subject : r.src_subject
      );
      if (!otherSubject) continue;
      const key = `${thisLo}|${otherLo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        thisLo,
        thisLabel: (thisLabel as string) ?? thisLo,
        otherLo,
        otherLabel: (otherLabel as string) ?? otherLo,
        otherSubject,
        rationale: (r.rationale as string) ?? "",
      });
    }
    return out;
  } catch {
    return []; // schema not ready yet — bridges are additive, never fatal
  }
}

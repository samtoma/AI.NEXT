/**
 * Persistence for the lesson pointer (ADR-0020, mastery-gated progression —
 * Tamer's ADR-0012 on `wip/socratic-probing-route-b`, renumbered on `main`,
 * whose ADR-0012 is per-student isolation).
 *
 * Split from lib/progression.ts for the reason that module documents: the rule
 * is pure and testable without a database, this is the part that talks to one.
 *
 * The pointer is MONOTONIC. It advances when the gate is first crossed and is
 * never walked back. That is not an optimisation — mastery is genuinely
 * reversible (from a mastered 0.98, two wrong answers fall to 0.517), so a
 * pointer that followed the score down would move the student's assigned
 * lesson BACKWARDS after one bad session, and the card would flicker between
 * lessons run to run. Advancing is an event; the score is a reading.
 *
 * ---------------------------------------------------------------------------
 * ON MAIN: EVERY READ AND WRITE RUNS UNDER THE STUDENT'S PRINCIPAL (ADR-0012)
 * ---------------------------------------------------------------------------
 * The branch read `student_progress` and `mastery` through the bare `pool`.
 * On main the pool is `ainext_app` with no principal set, so those reads would
 * have returned ZERO rows under migration 028's forced RLS — silently: every
 * student "on the first lesson", every course "not complete". Each function
 * here therefore takes the caller's client when it has one (the attempt route
 * passes its open unit of work, so the advance sees the mastery row that
 * transaction just wrote) and otherwise opens its own `withPrincipal` unit
 * through `scoped`. Queries on one client run one at a time (`sequential`,
 * pg@9), never `Promise.all`.
 */
import type { PoolClient } from "pg";
import { sequential } from "./db";
import { scoped, type Db } from "./student-context";
import { sanitizeLessonSlug, slugOfLo } from "./lesson-slug";
import { LO_MODULE_SELECT, MODULE_ORDER } from "./lesson";
import {
  advanceTarget,
  courseComplete,
  lessonGatePassed,
  resolvePointer,
  type ProgressionLesson,
  type ProgressionLo,
} from "./progression";

/**
 * The lessons of every course, in catalogue order, with this student's current
 * mastery attached.
 *
 * Deliberately NOT `getLessonCatalog`: that one builds titles, page ranges and
 * subject lookups this path throws away, and applies the course gate. The
 * advance only ever walks the course of an LO the attempt route has ALREADY
 * gated, so the gate would be a second read for no second answer. It shares
 * the ordering, though — `LO_MODULE_SELECT` and `MODULE_ORDER` are imported
 * from lib/lesson.ts rather than restated, so "the next lesson in the
 * catalogue" cannot come to mean two different orders.
 */
async function loadCatalog(
  db: Db,
  studentId: number
): Promise<{ lessons: ProgressionLesson[]; mastery: Map<string, number> }> {
  const [losRes, masteryRes] = await sequential([
    () => db.query(`${LO_MODULE_SELECT} ORDER BY ${MODULE_ORDER}`),
    () =>
      db.query(
        `SELECT lo_id, score FROM mastery
         WHERE student_id = $1 AND system_to IS NULL`,
        [studentId]
      ),
  ] as const);
  const mastery = new Map<string, number>(
    masteryRes.rows.map((r) => [r.lo_id as string, Number(r.score)])
  );

  const bySlug = new Map<string, ProgressionLesson & { los: ProgressionLo[] }>();
  const lessons: (ProgressionLesson & { los: ProgressionLo[] })[] = [];
  for (const r of losRes.rows) {
    const slug = sanitizeLessonSlug(slugOfLo(r.id));
    let info = bySlug.get(slug);
    if (!info) {
      info = { slug, courseId: r.course_id ?? null, los: [] };
      bySlug.set(slug, info);
      lessons.push(info);
    }
    info.los.push({ id: r.id, mastery: mastery.get(r.id) ?? 0 });
  }
  return { lessons, mastery };
}

/** `prerequisite_of` edges as dst -> [src], the direction the rules read. */
async function prereqMap(db: Db): Promise<Map<string, string[]>> {
  const r = await db.query(
    `SELECT src_id, dst_id FROM graph_edges
     WHERE edge_type = 'prerequisite_of' AND system_to IS NULL`
  );
  const m = new Map<string, string[]>();
  for (const e of r.rows) {
    const list = m.get(e.dst_id) ?? [];
    list.push(e.src_id);
    m.set(e.dst_id, list);
  }
  return m;
}

/**
 * The lesson this student is currently on in this course, or null when the
 * course has no lessons in `catalog`.
 *
 * `catalog` is the caller's GATED catalogue (`getLessonCatalog(studentId)`), so
 * a stored slug from a course she can no longer see is never returned.
 *
 * A student with no row yet gets the course's first lesson WITHOUT writing
 * one: a read must not quietly create progression state, or merely opening
 * the picker would pin a student to a course they only glanced at. The row
 * appears when they first advance.
 */
export async function getCurrentLesson(
  studentId: number,
  courseId: string,
  catalog: readonly { slug: string; courseId: string | null }[],
  client?: PoolClient
): Promise<string | null> {
  const inCourse = catalog.filter((l) => l.courseId === courseId);
  if (inCourse.length === 0) return null;

  const r = await scoped(studentId, client, (db) =>
    db.query(
      `SELECT lesson_slug FROM student_progress
       WHERE student_id = $1 AND course_id = $2`,
      [studentId, courseId]
    )
  );
  // A stored slug no longer in this course's catalogue (content re-extracted,
  // a lesson renamed) must not strand the student on a lesson that cannot be
  // loaded — `resolvePointer` falls back to the course's first, and
  // `advanceIfMastered` resolves it the SAME way so the two sides agree.
  return resolvePointer(inCourse, r.rows[0]?.lesson_slug as string | undefined);
}

/**
 * Advance the pointer if the lesson containing `loId` has just been mastered.
 *
 * Called from /api/attempts inside the attempt's own unit of work (`db` is its
 * client, principal already set), so the mastery write and the advance it
 * implies commit together.
 *
 * Returns the slug advanced TO, or null when nothing moved, which is the
 * common case: almost every attempt leaves the gate uncrossed.
 */
export async function advanceIfMastered(
  db: Db,
  studentId: number,
  loId: string
): Promise<string | null> {
  const slug = sanitizeLessonSlug(slugOfLo(loId));

  // The catalogue read comes first only because `course_id` — the second half
  // of the pointer's key — is not known until the lesson is located. Nothing
  // is decided from it until the row below is locked.
  const { lessons, mastery } = await loadCatalog(db, studentId);
  const lesson = lessons.find((l) => l.slug === slug);
  if (!lesson?.courseId) return null;
  const courseId = lesson.courseId;
  const inCourse = lessons.filter((l) => l.courseId === courseId);

  // Lock the pointer row. Two attempts landing concurrently on the last two
  // objectives of a lesson would otherwise both read "not yet advanced" and
  // both try to advance.
  const cur = await db.query(
    `SELECT lesson_slug FROM student_progress
     WHERE student_id = $1 AND course_id = $2
     FOR UPDATE`,
    [studentId, courseId]
  );
  const stored = cur.rows[0]?.lesson_slug as string | undefined;

  // The whole decision is `advanceTarget` (lib/progression.ts), pure and
  // unit-tested. In short: only the lesson the student is actually ON can
  // advance the pointer (a stored slug that has left the catalogue counts as
  // the course's first lesson, exactly as `getCurrentLesson` shows it); it must
  // pass the gate; and a later lesson must be ready. The prerequisite read is
  // skipped unless the first two already hold — it is the expensive one.
  if (resolvePointer(inCourse, stored) !== slug) return null;
  if (!lessonGatePassed(lesson.los)) return null;
  const prereqs = await prereqMap(db);
  const next = advanceTarget(inCourse, stored, slug, mastery, prereqs);
  // Nothing ready after this lesson: PARK. At the course's last lesson that
  // is the terminal state; mid-course it waits for a prerequisite. Either way
  // the pointer stays put, and only `isCourseComplete` decides what the card
  // calls it.
  if (next === null) return null;

  await db.query(
    `INSERT INTO student_progress (student_id, course_id, lesson_slug, advanced_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (student_id, course_id)
     DO UPDATE SET lesson_slug = EXCLUDED.lesson_slug, advanced_at = now()`,
    [studentId, courseId, next]
  );
  return next;
}

/**
 * Whether the check-in for `slug` shows the terminal state: `slug` is the
 * course's LAST catalogue lesson and every lesson in the course passes the
 * gate (`courseComplete`, lib/progression.ts). Read-side only.
 *
 * It no longer asks "is any later lesson ready?" — that is null mid-course
 * too, whenever everything after the current lesson is waiting on a
 * prerequisite, and it used to celebrate those students as finished.
 */
export async function isCourseComplete(
  studentId: number,
  slug: string,
  courseId: string | null,
  client?: PoolClient
): Promise<boolean> {
  if (!courseId) return false;
  return scoped(studentId, client, async (db) => {
    const { lessons } = await loadCatalog(db, studentId);
    return courseComplete(
      lessons.filter((l) => l.courseId === courseId),
      slug
    );
  });
}

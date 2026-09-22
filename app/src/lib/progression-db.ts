/**
 * Persistence for the lesson pointer (ADR-0012).
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
 * Every function here takes a `Db` — the pool, or a transaction client. The
 * attempt path passes its OPEN CLIENT deliberately: the advance has to see the
 * mastery row the same transaction just wrote but has not committed, and it
 * must not reach for a second pool connection while holding one, which is how
 * a request deadlocks itself under a small pool.
 */
import { pool } from "./db";
import type { PoolClient } from "pg";
import { sanitizeLessonSlug, slugOfLo } from "./lesson-slug";
import { LO_MODULE_SELECT, MODULE_ORDER } from "./lesson";
import {
  lessonGatePassed,
  nextLessonSlug,
  type ProgressionLesson,
  type ProgressionLo,
} from "./progression";

type Db = Pick<PoolClient, "query">;

/**
 * The lessons of every course, in catalogue order, with this student's current
 * mastery attached.
 *
 * Deliberately NOT `getLessonCatalog`: that one reads through the pool and
 * builds titles, page ranges and subject lookups this path throws away. It
 * shares the ordering, though — `LO_MODULE_SELECT` and `MODULE_ORDER` are
 * imported from lib/lesson.ts rather than restated, so "the next lesson in the
 * catalogue" cannot come to mean two different orders.
 */
async function loadCatalog(
  db: Db,
  studentId: number
): Promise<{ lessons: ProgressionLesson[]; mastery: Map<string, number> }> {
  const [losRes, masteryRes] = await Promise.all([
    db.query(`${LO_MODULE_SELECT} ORDER BY ${MODULE_ORDER}`),
    db.query(
      `SELECT lo_id, score FROM mastery
       WHERE student_id = $1 AND system_to IS NULL`,
      [studentId]
    ),
  ]);
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
 * The lesson this student is currently on in this course.
 *
 * Returns null when the course has no lessons at all. A student with no row
 * yet gets the course's first lesson WITHOUT writing one: a read must not
 * quietly create progression state, or merely opening the picker would pin a
 * student to a course they only glanced at. The row appears when they first
 * advance, and the migration backfills everyone who already existed.
 */
export async function getCurrentLesson(
  studentId: number,
  courseId: string,
  catalog: readonly { slug: string; courseId: string | null }[]
): Promise<string | null> {
  const inCourse = catalog.filter((l) => l.courseId === courseId);
  if (inCourse.length === 0) return null;

  const r = await pool.query(
    `SELECT lesson_slug FROM student_progress
     WHERE student_id = $1 AND course_id = $2`,
    [studentId, courseId]
  );
  const stored = r.rows[0]?.lesson_slug as string | undefined;
  // A stored slug no longer in this course's catalogue (content re-extracted,
  // a lesson renamed) must not strand the student on a lesson that cannot be
  // loaded — fall back to the course's first.
  if (stored && inCourse.some((l) => l.slug === stored)) return stored;
  return inCourse[0].slug;
}

/**
 * Advance the pointer if the lesson containing `loId` has just been mastered.
 *
 * Called from /api/attempts inside the attempt's own transaction, so the
 * mastery write and the advance it implies commit together or not at all — a
 * student can never end up mastered-but-not-advanced because the request died
 * between two writes.
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
  const current =
    (cur.rows[0]?.lesson_slug as string | undefined) ?? inCourse[0]?.slug;

  // Only the lesson the student is actually ON can advance the pointer.
  // Re-drilling an old lesson, or answering ahead through the picker, must not
  // skip them forward past lessons they have not done.
  if (current !== slug) return null;
  if (!lessonGatePassed(lesson.los)) return null;

  const prereqs = await prereqMap(db);
  const next = nextLessonSlug(inCourse, slug, mastery, prereqs);
  // End of the course: park on the last lesson (ADR-0012 terminal state). The
  // pointer stays put and the check-in renders "complete" instead.
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
 * Whether this lesson is mastered AND the end of its course — the terminal
 * state the check-in renders instead of an assignment. Read-side only.
 */
export async function isCourseComplete(
  studentId: number,
  slug: string,
  courseId: string | null
): Promise<boolean> {
  if (!courseId) return false;
  const { lessons, mastery } = await loadCatalog(pool, studentId);
  const inCourse = lessons.filter((l) => l.courseId === courseId);
  const lesson = inCourse.find((l) => l.slug === slug);
  if (!lesson || !lessonGatePassed(lesson.los)) return false;

  const prereqs = await prereqMap(pool);
  return nextLessonSlug(inCourse, slug, mastery, prereqs) === null;
}

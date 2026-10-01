/**
 * The course-outline reads (migration 037) — the I/O half of
 * `lib/course-outline.ts`, which holds the rules and no database.
 *
 * `course_outline` is content (no RLS, SELECT for `ainext_app`), so these run
 * on whatever handle the caller holds. They hold no gate of their own: the
 * caller passes course ids it has ALREADY gated — a student's catalogue or
 * graph scope — because the outline holds a book's chapter and lesson titles,
 * and a hidden course's are not hers to read.
 */
import { pool } from "./db";
import type { Db } from "./student-context";
import {
  COURSE_OUTLINE_SQL,
  OUTLINE_LESSON_SQL,
  OUTLINE_PRESENT_SQL,
  outlineFromRows,
  type OutlineLesson,
  type OutlineRow,
} from "./course-outline";

async function outlinePresent(db: Db): Promise<boolean> {
  const r = await db.query(OUTLINE_PRESENT_SQL);
  return r.rows[0]?.present === true;
}

/**
 * The outline of the given (already gated) courses, in reading order. Empty
 * for no courses, for courses with no outline (every National course) and for
 * a database without migration 037 — in each case the surfaces show exactly
 * what they showed before.
 */
export async function getCourseOutline(
  courseIds: readonly string[],
  db: Db = pool
): Promise<OutlineLesson[]> {
  const ids = [...new Set(courseIds)];
  if (ids.length === 0) return [];
  if (!(await outlinePresent(db))) return [];
  const r = await db.query(COURSE_OUTLINE_SQL, [ids]);
  return outlineFromRows(r.rows as OutlineRow[]);
}

/**
 * The course whose outline lists `slug`, or null. For a slug that resolved to
 * NO objectives only — the guard in `lib/lesson.ts` asks it to tell "a lesson
 * of the book not prepared yet" (refused) from "no such lesson" (the old
 * fall-back to the default lesson, unchanged).
 */
export async function outlineCourseOfLesson(slug: string, db: Db): Promise<string | null> {
  if (!(await outlinePresent(db))) return null;
  const r = await db.query(OUTLINE_LESSON_SQL, [slug]);
  return (r.rows[0]?.course_id as string | undefined) ?? null;
}

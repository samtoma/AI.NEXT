/**
 * The course-outline reads (migration 037) — the I/O half of
 * `lib/course-outline.ts`, which holds the rules and no database. Classified
 * in `student-scope-guard.test.mts` (MODULES, "upstream"): its importers are
 * listed there, and a new one must say how it gates what it reads.
 *
 * `course_outline` is content (no RLS, SELECT for `ainext_app`), so these run
 * on whatever handle the caller holds. They hold no gate of their own: the
 * caller passes course ids it has ALREADY gated — a student's catalogue or
 * graph scope — because the outline holds a book's chapter and lesson titles,
 * and a hidden course's are not hers to read.
 */
import { pool } from "./db";
import type { Db } from "./student-context";
import { outlineFromRows, type OutlineLesson, type OutlineRow } from "./course-outline";

/**
 * Is the store there? The outline is an overlay on what a student already
 * sees: a database without migration 037 has no outline, and every surface
 * then shows exactly what it showed before 037 — so the reader asks first
 * rather than failing a check-in over a missing table.
 */
export const OUTLINE_PRESENT_SQL = `SELECT to_regclass('public.course_outline') IS NOT NULL AS present`;

/** Every outline row of the given courses (`$1`, already gated), in reading order. */
export const COURSE_OUTLINE_SQL = `
  SELECT course_id, lesson_slug, module_id, module_label, module_order, book_order,
         title, sections, section_titles, part_n, part_of, chapter_intro, group_key,
         page_from, page_to
    FROM course_outline
   WHERE course_id = ANY($1::text[])
   ORDER BY course_id, book_order`;

/** Is `$1` a lesson some book's outline lists? The guard's read (lib/lesson.ts). */
export const OUTLINE_LESSON_SQL = `SELECT course_id FROM course_outline WHERE lesson_slug = $1 LIMIT 1`;

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

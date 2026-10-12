/**
 * Short display titles per lesson slug; fallback = the lesson's first objective
 * label. Moved out of `lib/lesson.ts` (2026-10-01) so the skill map can use the
 * same names without importing the lesson module's server dependencies.
 *
 * Feature 003: the table itself now lives on the course registry
 * (`lib/courses.ts` `PREP3_MATH_LESSON_TITLES`, the Prep-3 maths entry's
 * `tutor.lessonTitles`) — one copy, so the lesson prompt, the catalogue and the
 * map can never name a lesson two ways. This stays the pure, import-light
 * Prep-3 lookup the map and the Ask prompt already use; a lesson of a course
 * whose titles come from the book-section store (Grade 10) is added to the
 * map's `lessonTitles` by `spineDataOn` (`lib/queries.ts`).
 */
export { PREP3_MATH_LESSON_TITLES as LESSON_TITLES } from "./courses.ts";

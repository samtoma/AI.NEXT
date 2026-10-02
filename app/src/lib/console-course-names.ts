/**
 * What the console CALLS a course, and how it groups courses — one place, so
 * no console page can print two courses of one subject under one name
 * (feature 003, FR-4104; contracts/console.md).
 *
 * Until 003 every console page named a course by its SUBJECT
 * (`displayLabel(SUBJECTS[subjectOfCourse(id)])`), which was exact while each
 * subject had one course. Since the Grade 10 American maths course, "Mathematics"
 * names two books, and a Feedback or Cost row labelled "Mathematics" could be
 * either — two figures printed under one name read as one figure. So every
 * console reader names a course by `courseName`: the course's own label AND
 * its curriculum, "Mathematics — Grade 10 (American)", the form the contract's
 * teaching-page line uses.
 *
 * A curriculum appears here only as a label on a COURSE, which is a fact about
 * a book, not about a student (privacy review F7): nothing in this module
 * reads or names a student.
 *
 * Pure, and its imports import nothing with side effects, so client
 * components (`CourseAvailabilityGrid`, `CurriculumEditor`) and `node --test`
 * load it as they load `lib/courses.ts`.
 */
import { COURSES, COURSE_IDS, isCourseId, type CourseId } from "./courses.ts";
import { CURRICULA, CURRICULUM_IDS, type CurriculumId } from "./curricula.ts";

/** "Mathematics — Grade 10 (American)"; the raw id for a course the registry
 *  does not know (shown, never hidden); "No course recorded" for none. */
export function courseName(raw: unknown): string {
  if (raw == null || raw === "") return "No course recorded";
  if (!isCourseId(raw)) return `unknown course (${String(raw)})`;
  const c = COURSES[raw];
  return `${c.label} (${CURRICULA[c.curriculum].label})`;
}

/** Every registry course, grouped under its curriculum, in registry order —
 *  THE grouping every console picker and section uses (FR-4101, FR-4104). */
export function coursesByCurriculum(): {
  curriculum: CurriculumId;
  label: string;
  description: string;
  courses: CourseId[];
}[] {
  return CURRICULUM_IDS.map((curriculum) => ({
    curriculum,
    label: CURRICULA[curriculum].label,
    description: CURRICULA[curriculum].description,
    courses: COURSE_IDS.filter((id) => COURSES[id].curriculum === curriculum),
  })).filter((g) => g.courses.length > 0);
}

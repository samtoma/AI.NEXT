/**
 * Which term a module belongs to, and its label without the term — for the
 * lesson check-in, which prints the term itself ("Term 2 · Unit 4").
 *
 * FR-3218 (Samuel, 2026-09-25): every Term 2 module's label names its term —
 * "Term 2 · Unit 1 — Equations", "Term 2 · Unit 4 — The Circle", "Term 2 ·
 * Unit 5 — Angles and Arcs in the Circle" — and no Term 1 label does ("Unit 1
 * — Relations and Functions"). So a surface that prints the term itself MUST
 * strip it from the label first, and MUST NOT prefix a label as it is stored:
 * until v0.9.2 the Arabic/Social check-in's maths rows did exactly that and
 * printed "Term 1 · Term 2 · Unit 1" and "Term 2 · Term 2 · Unit 5".
 *
 * `module:geo-u1` used to be the one Term 2 label that said nothing — "Unit 4 —
 * The Circle", although its `syllabus_ref` is "Second Term — Geometry Unit 4"
 * and it starts on page 39 of the Term 2 book. The check-in carried a comment
 * and a special case for that; migration 031 and the seed fix the label, and
 * the special case is gone. What remains is not a workaround:
 *
 *   · the term comes from the module ID, by the COURSE's own term rules — the
 *     same rules `MODULE_ORDER`'s term rank is generated from
 *     (lib/module-order.ts). For Prep-3 maths, `module:t2-*` is Term-2 algebra
 *     and `module:geo*` is geometry, which the syllabus teaches in Term 2;
 *   · `withoutTerm` removes a leading "Term N · ", because the design sets the
 *     term as its own eyebrow and the unit as the title.
 *
 * FEATURE 003: the rules are per course (`CourseDef.terms`, lib/courses.ts),
 * so every function here takes the course. A course with NO terms — the
 * Grade 10 American book is chapters and sections — has no term at all:
 * `termOfModule` answers `null` and `moduleHeading` prints the label alone
 * (FR-4203: "no label in this course may name a term"). A course the registry
 * does not know is treated the same way: nothing is claimed about it.
 *
 * Pure and dependency-free apart from the registry, so `term-labels.test.mts`
 * can run it on every seeded module under plain `node` (the check-in is a TSX
 * component).
 */
import { courseDef, type TermModel } from "./courses.ts";

/** A school term, as printed: "Term 1", "Term 2". */
export type Term = number;

function termBy(
  model: TermModel | null | undefined,
  matches: (rule: TermModel["rules"][number]) => boolean
): Term | null {
  if (!model) return null;
  return model.rules.find(matches)?.term ?? model.defaultTerm;
}

/** A module's term, from its id and its course; `null` for a course without
 *  terms (or one the registry does not know). */
export const termOfModule = (moduleId: string, courseId: string | null | undefined): Term | null =>
  termBy(courseDef(courseId)?.terms, (r) => moduleId.startsWith(`module:${r.modulePrefix}`));

/** Same question, from a lesson slug ("t2u1-1", "geo1-2", "u1-1"). */
export const termOfSlug = (slug: string, courseId: string | null | undefined): Term | null =>
  termBy(courseDef(courseId)?.terms, (r) => slug.startsWith(r.slugPrefix));

/** "Term 2 · Unit 1 — Equations" → "Unit 1 — Equations"; a label with no
 *  term is returned as it is. */
export const withoutTerm = (label: string): string =>
  label.replace(/^\s*Term\s*\d+\s*·\s*/u, "");

/** "Term 2 · Unit 4 — The Circle" from a module's id, stored label and
 *  course — the term said exactly once, whichever way the label was stored;
 *  for a course without terms, the label alone and no term (FR-4203). */
export const moduleHeading = (
  moduleId: string,
  label: string,
  courseId: string | null | undefined
): string => {
  const term = termOfModule(moduleId, courseId);
  return term == null ? withoutTerm(label) : `Term ${term} · ${withoutTerm(label)}`;
};

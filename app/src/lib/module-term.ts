/**
 * Which term a maths module belongs to, and its label without the term — for
 * the lesson check-in, which prints the term itself ("Term 2 · Unit 4").
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
 *   · the term comes from the module ID, by the same rule `MODULE_ORDER` ranks
 *     by (lib/module-order.ts) — `module:t2-*` is Term-2 algebra and
 *     `module:geo*` is geometry, which the syllabus teaches in Term 2;
 *   · `withoutTerm` removes a leading "Term N · ", because the design sets the
 *     term as its own eyebrow and the unit as the title.
 *
 * Pure and dependency-free, so `term-labels.test.mts` can run it on every
 * seeded module under plain `node` (the check-in is a TSX component).
 */

export type Term = 1 | 2;

/** A module's term, from its id. */
export const termOfModule = (moduleId: string): Term =>
  moduleId.startsWith("module:geo") || moduleId.startsWith("module:t2-")
    ? 2
    : 1;

/** Same question, from a lesson slug ("t2u1-1", "geo1-2", "u1-1"). */
export const termOfSlug = (slug: string): Term =>
  slug.startsWith("geo") || slug.startsWith("t2") ? 2 : 1;

/** "Term 2 · Unit 1 — Equations" → "Unit 1 — Equations"; a label with no
 *  term is returned as it is. */
export const withoutTerm = (label: string): string =>
  label.replace(/^\s*Term\s*\d+\s*·\s*/u, "");

/** "Term 2 · Unit 4 — The Circle" from any maths module's id and stored
 *  label — the term said exactly once, whichever way the label was stored. */
export const moduleHeading = (moduleId: string, label: string): string =>
  `Term ${termOfModule(moduleId)} · ${withoutTerm(label)}`;

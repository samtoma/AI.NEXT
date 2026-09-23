/**
 * Term-1 algebra, then Term-2 algebra, then geometry.
 *
 * THE TERM RANK IS LOAD-BEARING, and its absence was a live defect. This used
 * to push only `module:geo%` last, leaving the rest to `m.order_in_parent` —
 * but `module:u1` and `module:t2-u1` BOTH carry order_in_parent = 1 (each is
 * unit 1 of its own term), so the two terms tied, the tie fell through to
 * `lo.id`, and "t2u..." sorts before "u..." alphabetically. The catalogue came
 * out interleaved: t2u1-1, u1-1, t2u1-2, u1-2, t2u1-3, u1-3, u1-4, u2-1...
 *
 * That was survivable while nothing walked the order — the check-in read
 * `lessons[0]` only on the `?subject=` path and fell through to a literal
 * otherwise, so the interleaving showed up only as an oddly-shuffled picker.
 * ADR-0020 makes this order the progression sequence, where it would have sent
 * a student ping-ponging between terms after every lesson.
 *
 * One definition for every reader of catalogue order — `getLessonCatalog`
 * (lib/lesson.ts), the progression walk (lib/progression-db.ts) and the subject
 * home's roll-up (lib/subject-queries.ts) — because "next in the catalogue" has
 * to mean the catalogue the student is actually looking at.
 *
 * Its own module, with no imports, because lib/lesson.ts already imports
 * lib/subject-queries.ts: defining it in either and importing it into the
 * other would make the two modules import each other. lib/lesson.ts
 * re-exports it, so existing importers are unchanged.
 *
 * A SQL fragment: it expects the aliases `m` (module) and `lo` (learning
 * objective) that `LO_MODULE_SELECT` and the subject roll-up both use.
 */
export const MODULE_ORDER = `CASE
           WHEN m.id LIKE 'module:geo%' THEN 2
           WHEN m.id LIKE 'module:t2-%' THEN 1
           ELSE 0
         END,
         m.order_in_parent NULLS LAST, lo.order_in_parent, lo.id`;

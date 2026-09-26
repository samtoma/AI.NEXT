/**
 * THE CATALOGUE ORDER — the one definition of the order the curriculum is
 * taught in, for every reader that orders objectives, lessons or modules
 * (FR-3207, FR-3215, FR-3217).
 *
 * Term-1 algebra, then Term-2 algebra, then geometry; inside a term, the
 * module's position; inside a module, the objective's position; last, the
 * objective's id, so no two rows ever tie. A list that holds MORE THAN ONE
 * COURSE puts the course first (`COURSE_RANK`, below) and this order inside
 * each course.
 *
 * FEATURE 003 — COURSE, NOT SUBJECT. The first key used to be `SUBJECT_RANK`:
 * the registry position of a module's course, when every subject had exactly
 * one course. A second maths course (Grade 10, American) breaks the premise —
 * two courses of one subject would share a rank and interleave by unit number.
 * So the key is now `COURSE_RANK`, the position in the COURSE registry
 * (`lib/courses.ts`, curriculum, then subject, then course). The three
 * National courses keep positions 0, 1 and 2 — maths, Social Studies, Arabic,
 * the order `SUBJECT_RANK` gave them — so every list a National student sees
 * is ordered exactly as it was (FR-3217 unchanged for them; FR-4009 for a
 * student who can see two courses of one subject).
 *
 * THE TERM RANK now comes from each course's term model in the registry
 * (`CourseDef.terms`) instead of two literals here. Its text is generated to
 * be EXACTLY what v0.9.1 shipped — `catalogue-order-readers.test.mts` pins it,
 * because the progression walks this order — and a course with no terms (the
 * Grade 10 book) contributes no rule: its modules are term 0 and sort by
 * position, which is the book's order (FR-4203).
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
 * ---------------------------------------------------------------------------
 * EVERY READER, ONE SOURCE (FR-3217)
 * ---------------------------------------------------------------------------
 * Samuel, 2026-09-25, on finding that most readers did not use this: *"i
 * thought they are all from the same source."* They do now. And on lists that
 * hold several subjects: *"Yes they need to split by subject."*
 *
 *   Lists of ONE subject (or one course, or one lesson), by `MODULE_ORDER`:
 *     · the progression walk (lib/progression-db.ts) — it reads every course
 *       and walks one;
 *     · the subject home's roll-up (lib/subject-queries.ts) — per subject;
 *     · the skill map (lib/spine-lo-query.ts, FR-3215) — the map shows one
 *       subject at a time (`SpineExplorer`'s subject filter);
 *     · the console Overview's heatmap rows (lib/overview-queries.ts) — one
 *       subject per query.
 *     Since 003 a subject can have two courses. The student gate shows a
 *     student only her own curriculum's courses, one per subject, so the
 *     student readers above still see one course per subject — except a test
 *     account holding an exception for the other curriculum's course of the
 *     same subject (FR-4009), for whom the subject home and the skill map
 *     would merge the two. Recorded as open in the 003 report; the Overview
 *     (console) splits by course in 003's console work (decision 8).
 *   Lists of EVERY course, by `COURSE_RANK` then `MODULE_ORDER`:
 *     · the lesson catalogue — `getLessonCatalog` (lib/lesson.ts), the
 *       check-in's picker when no subject is named;
 *     · the practice plan, as the TIE-BREAK under "weakest first"
 *       (`getStudentPlan`, lib/queries.ts) — through `catalogueObjectivesSql`;
 *     · /pipeline's mini-map (lib/pipeline-queries.ts) — the same helper;
 *     · /gallery (`getGalleryData`, lib/visuals.ts);
 *     · the tutor's "Ask the Spine" context (lib/ask.ts) — its objective list
 *       through the same helper, its focus objectives as the TIE-BREAK under
 *       "weakest first", its prerequisite edges by the catalogue rank of each
 *       end — and the figure catalogue it reads (`getAllVisuals`). ADR-0020
 *       held these until Samuel lifted the hold for this ordering on
 *       2026-09-25: "yes for sure, for decision 2, it is part of the overall
 *       consistency".
 *   Modules of every course, by `COURSE_RANK` then `MODULE_RANK`:
 *     · the progress page's topics, as the tie-break under "started, weakest
 *       first" (`getTopicBreakdown`, lib/dashboard.ts);
 *     · the "Ingested units" line of the ask context (lib/ask.ts).
 *
 *   Adding `COURSE_RANK` in front changes nothing INSIDE a course — it is
 *   the same for every module of one course — so a single-course consumer of
 *   the lesson catalogue (the landing, the pointer, "just finished") sees the
 *   order it saw before; the scratch-database test compares them course by
 *   course.
 *
 *   Not rerouted, each for a stated reason — `catalogue-order-guard.test.mts`
 *   lists them and fails on any OTHER query that orders by `order_in_parent`
 *   without this file, and on any use of `MODULE_ORDER` / `MODULE_RANK`
 *   without `COURSE_RANK` that it has not been told is single-course:
 *     · INSIDE ONE LESSON, and nowhere else: `resolveLessonLos` (lib/lesson.ts)
 *       and `getVisualsForLos` (lib/visuals.ts), whose one caller passes one
 *       lesson's objectives. A lesson sits in one module, so there the term
 *       and module keys are constants and `MODULE_ORDER` reduces to exactly
 *       their `lo.order_in_parent, lo.id` — proved on the seeds by that test.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT KNOW (recorded, not changed)
 * ---------------------------------------------------------------------------
 *   · `lo.order_in_parent` is a position inside the MODULE for maths only. The
 *     Arabic and Social Studies seeds number objectives inside their LESSON
 *     (`lo:ara1-1-1`, `lo:ara1-2-1` and `lo:ara1-3-1` are all 1), so a flat
 *     list of one of those units reads lesson-interleaved. Deterministic, and
 *     invisible to every reader that groups by lesson.
 *
 * Its own module because lib/lesson.ts already imports lib/subject-queries.ts:
 * defining the order in either and importing it into the other would make the
 * two modules import each other. Its one import is the course registry
 * (lib/courses.ts), which imports no runtime code. lib/lesson.ts re-exports
 * `MODULE_ORDER`, so existing importers are unchanged.
 *
 * SQL fragments: they expect the aliases `m` (module) and `lo` (learning
 * objective) that `LO_MODULE_SELECT`, `LO_MODULE_JOIN` and the subject roll-up
 * all use.
 */
import { COURSES, COURSE_IDS } from "./courses";

/**
 * Every course's term rules, in registry order and each course's own rule
 * order. For today's registry that is Prep-3 maths's two — geometry (2), then
 * Term-2 algebra (1) — and nothing else: Social Studies and Arabic declare no
 * rule (every module Term 1) and the Grade 10 book has no terms.
 */
const TERM_RULES = COURSE_IDS.flatMap((id) => COURSES[id].terms?.rules ?? []);
for (const r of TERM_RULES) {
  // interpolated into SQL below — registry constants, never input
  if (!/^[a-z0-9-]+$/.test(r.modulePrefix) || !Number.isInteger(r.rank)) {
    throw new Error(`module-order: unexpected term rule ${JSON.stringify(r)}`);
  }
}
{
  // Two courses may not claim the same module prefix: a module id matches ONE
  // rule, or the term rank would depend on the order courses are listed in.
  const seen = new Set<string>();
  for (const r of TERM_RULES) {
    if (seen.has(r.modulePrefix)) throw new Error(`module-order: term prefix ${r.modulePrefix} declared twice`);
    seen.add(r.modulePrefix);
  }
}

/** Term 1 (0), Term-2 algebra (1), geometry — which is Term 2 as well (2).
 *  A missing module (`m.id` NULL) matches no LIKE and reads as 0. Generated
 *  from `TERM_RULES`; the text is pinned by catalogue-order-readers.test.mts. */
const TERM_RANK = `CASE
           ${TERM_RULES.map((r) => `WHEN m.id LIKE 'module:${r.modulePrefix}%' THEN ${r.rank}`).join("\n           ")}
           ELSE 0
         END`;

/** Objectives in catalogue order. Unchanged since v0.9.1 (the text is pinned
 *  by `catalogue-order-readers.test.mts`): the progression walks it. */
export const MODULE_ORDER = `${TERM_RANK},
         m.order_in_parent NULLS LAST, lo.order_in_parent, lo.id`;

/**
 * MODULES in catalogue order — `MODULE_ORDER` without the objective keys, for
 * a reader with one row per module and no `lo`. It ends in `m.id` so two
 * modules never tie; that only decides between modules of DIFFERENT courses
 * (no two modules of one course share a term and a position), and a reader of
 * several courses puts `COURSE_RANK` in front of it anyway.
 */
export const MODULE_RANK = `${TERM_RANK},
         m.order_in_parent NULLS LAST, m.id`;

/**
 * THE COURSE KEY, for a list that holds more than one course (FR-3217;
 * Samuel, 2026-09-25: "Yes they need to split by subject" — and, since 003,
 * by course, because one subject can have two). The registry position of the
 * course the module `m` is part of (open `part_of` edges); a module with no
 * course, a course the registry does not know, or no module at all sorts
 * after every known course. Put it IN FRONT of `MODULE_ORDER` or
 * `MODULE_RANK`: `ORDER BY ${COURSE_RANK}, ${MODULE_ORDER}`.
 *
 * A correlated read of the module's own `part_of` edges, so it needs only the
 * `m` alias every reader already has — no course join to add, and nothing
 * that could repeat a row. `min` picks the registry's earliest course should
 * a module ever belong to two. The course ids are the registry's own,
 * checked there to be plain ids (`lib/courses.ts`).
 */
export const COURSE_RANK = `coalesce((
           SELECT min(CASE pe.dst_id
                        ${COURSE_IDS.map((c, i) => `WHEN '${c}' THEN ${i}`).join("\n                        ")}
                      END)
             FROM graph_edges pe
            WHERE pe.src_id = m.id AND pe.edge_type = 'part_of' AND pe.system_to IS NULL
         ), ${COURSE_IDS.length})`;

/**
 * @deprecated The pre-003 name of `COURSE_RANK`, kept for one release
 * (plan A1). It is the same SQL: with one course per subject the two orders
 * were the same, and with two they must be split by course. No reader in
 * `app/src` uses it; `catalogue-order-guard.test.mts` treats either name as
 * the course key.
 */
export const SUBJECT_RANK = COURSE_RANK;

/**
 * Objective → its module, open `teaches` edges only, with the aliases the two
 * orders expect. LEFT on purpose: an objective with no module still comes back
 * (inside one course it sorts after the last Term-1 module — term 0, position
 * NULLS LAST; across courses, after every course). Every maths, Arabic and
 * Social Studies objective has exactly one open `teaches` edge today (274 of
 * 274 on the local database, 2026-09-25), so the join neither drops nor
 * repeats a row; the scratch-database tests count. Moved here from
 * lib/spine-lo-query.ts, text unchanged.
 */
export const LO_MODULE_JOIN = `
        LEFT JOIN graph_edges te
          ON te.dst_id = lo.id AND te.edge_type = 'teaches' AND te.system_to IS NULL
        LEFT JOIN graph_nodes m ON m.id = te.src_id AND m.kind = 'module'`;

/**
 * Every objective of every course, one row each — `SELECT <columns>` over
 * `graph_nodes lo` plus `LO_MODULE_JOIN`, ordered by course and then by
 * catalogue order inside it. The shared shape for a reader that wants the
 * flat list (the practice plan, /pipeline). `columns` is the reader's own
 * select list; it may name `lo.*` and `m.*`.
 */
export function catalogueObjectivesSql(columns: string): string {
  return `
        SELECT ${columns}
        FROM graph_nodes lo${LO_MODULE_JOIN}
        WHERE lo.kind = 'learning_objective'
        ORDER BY ${COURSE_RANK}, ${MODULE_ORDER}
      `;
}

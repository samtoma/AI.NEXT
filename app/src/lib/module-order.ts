/**
 * THE CATALOGUE ORDER — the one definition of the order the curriculum is
 * taught in, for every reader that orders objectives, lessons or modules
 * (FR-3207, FR-3215, FR-3217).
 *
 * Term-1 algebra, then Term-2 algebra, then geometry; inside a term, the
 * module's position; inside a module, the objective's position; last, the
 * objective's id, so no two rows ever tie. A list that holds MORE THAN ONE
 * SUBJECT puts the subject first (`SUBJECT_RANK`, below) and this order inside
 * each subject.
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
 *   Lists of EVERY subject, by `SUBJECT_RANK` then `MODULE_ORDER`:
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
 *   Modules of every subject, by `SUBJECT_RANK` then `MODULE_RANK`:
 *     · the progress page's topics, as the tie-break under "started, weakest
 *       first" (`getTopicBreakdown`, lib/dashboard.ts);
 *     · the "Ingested units" line of the ask context (lib/ask.ts).
 *
 *   Adding `SUBJECT_RANK` in front changes nothing INSIDE a course — it is
 *   the same for every module of one course — so a single-course consumer of
 *   the lesson catalogue (the landing, the pointer, "just finished") sees the
 *   order it saw before; the scratch-database test compares them course by
 *   course.
 *
 *   Not rerouted, each for a stated reason — `catalogue-order-guard.test.mts`
 *   lists them and fails on any OTHER query that orders by `order_in_parent`
 *   without this file, and on any use of `MODULE_ORDER` / `MODULE_RANK`
 *   without `SUBJECT_RANK` that it has not been told is single-subject:
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
 * two modules import each other. Its one import is the subject registry
 * (lib/subjects.ts), which imports nothing. lib/lesson.ts re-exports
 * `MODULE_ORDER`, so existing importers are unchanged.
 *
 * SQL fragments: they expect the aliases `m` (module) and `lo` (learning
 * objective) that `LO_MODULE_SELECT`, `LO_MODULE_JOIN` and the subject roll-up
 * all use.
 */
import { SUBJECTS, SUBJECT_IDS } from "./subjects";

/** Term 1 (0), Term-2 algebra (1), geometry — which is Term 2 as well (2).
 *  A missing module (`m.id` NULL) matches neither LIKE and reads as 0. */
const TERM_RANK = `CASE
           WHEN m.id LIKE 'module:geo%' THEN 2
           WHEN m.id LIKE 'module:t2-%' THEN 1
           ELSE 0
         END`;

/** Objectives in catalogue order. Unchanged since v0.9.1 (the text is pinned
 *  by `catalogue-order-readers.test.mts`): the progression walks it. */
export const MODULE_ORDER = `${TERM_RANK},
         m.order_in_parent NULLS LAST, lo.order_in_parent, lo.id`;

/**
 * MODULES in catalogue order — `MODULE_ORDER` without the objective keys, for
 * a reader with one row per module and no `lo`. It ends in `m.id` so two
 * modules never tie; that only decides between modules of DIFFERENT subjects
 * (no two maths modules share a term and a position), and a reader of several
 * subjects puts `SUBJECT_RANK` in front of it anyway.
 */
export const MODULE_RANK = `${TERM_RANK},
         m.order_in_parent NULLS LAST, m.id`;

/**
 * The course ids of the subject registry, in REGISTRY ORDER — the order the
 * product already shows subjects in (lib/subjects.ts: "the order subjects
 * appear in the graph territories, the subject filter and the student
 * home"). Today: Mathematics, Social Studies, Arabic. Not a second list: it
 * is read from `SUBJECTS` here, so a subject added there is ranked here.
 */
const REGISTRY_COURSES: readonly string[] = SUBJECT_IDS.map((id) => SUBJECTS[id].courseId);
for (const c of REGISTRY_COURSES) {
  // interpolated into SQL below — a registry constant, never input, and
  // checked to be a plain id so a typo cannot become SQL
  if (!/^course:[a-z0-9-]+$/.test(c)) throw new Error(`module-order: unexpected course id ${c}`);
}

/**
 * THE SUBJECT KEY, for a list that holds more than one subject (FR-3217;
 * Samuel, 2026-09-25: "Yes they need to split by subject"). The registry
 * position of the course the module `m` is part of (open `part_of` edges);
 * a module with no course, a course the registry does not know, or no module
 * at all sorts after every known subject. Put it IN FRONT of `MODULE_ORDER`
 * or `MODULE_RANK`: `ORDER BY ${SUBJECT_RANK}, ${MODULE_ORDER}`.
 *
 * A correlated read of the module's own `part_of` edges, so it needs only the
 * `m` alias every reader already has — no course join to add, and nothing
 * that could repeat a row. `min` picks the registry's earliest course should
 * a module ever belong to two.
 */
export const SUBJECT_RANK = `coalesce((
           SELECT min(CASE pe.dst_id
                        ${REGISTRY_COURSES.map((c, i) => `WHEN '${c}' THEN ${i}`).join("\n                        ")}
                      END)
             FROM graph_edges pe
            WHERE pe.src_id = m.id AND pe.edge_type = 'part_of' AND pe.system_to IS NULL
         ), ${REGISTRY_COURSES.length})`;

/**
 * Objective → its module, open `teaches` edges only, with the aliases the two
 * orders expect. LEFT on purpose: an objective with no module still comes back
 * (inside one subject it sorts after the last Term-1 module — term 0, position
 * NULLS LAST; across subjects, after every subject). Every maths, Arabic and
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
 * Every objective of every subject, one row each — `SELECT <columns>` over
 * `graph_nodes lo` plus `LO_MODULE_JOIN`, ordered by subject and then by
 * catalogue order inside it. The shared shape for a reader that wants the
 * flat list (the practice plan, /pipeline). `columns` is the reader's own
 * select list; it may name `lo.*` and `m.*`.
 */
export function catalogueObjectivesSql(columns: string): string {
  return `
        SELECT ${columns}
        FROM graph_nodes lo${LO_MODULE_JOIN}
        WHERE lo.kind = 'learning_objective'
        ORDER BY ${SUBJECT_RANK}, ${MODULE_ORDER}
      `;
}

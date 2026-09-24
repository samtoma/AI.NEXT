/**
 * The skill map's objective query (`/spine`, `lib/queries.ts` `spineDataOn`),
 * in catalogue order (FR-3215).
 *
 * It used to sort by `order_in_parent` alone. That is an objective's position
 * inside its own module, so nine maths objectives share every value and
 * Postgres returned the ties in no guaranteed order: production's first column
 * read Geometry 1, Unit 2, Unit 3, Unit 1, Unit 4, Unit 3 on 2026-09-24, and a
 * different order again minutes later. Each objective is now joined to its
 * module and sorted by `MODULE_ORDER` — the one definition of catalogue order
 * the lesson list, the progression walk and the subject home already share —
 * which ends in `lo.id`, so no two rows ever tie.
 *
 * The join is the one `LO_MODULE_SELECT` (lib/lesson.ts) uses, with the
 * aliases `MODULE_ORDER` expects (`lo`, `m`), and it is a LEFT JOIN on
 * purpose: an objective with no module must still reach the map. It keeps its
 * card and lands after the last Term-1 module — `MODULE_ORDER`'s CASE reads a
 * missing module as term 0, and `m.order_in_parent NULLS LAST` puts it after
 * every module that has a position. (None exists today: all 274 objectives
 * on the local database have exactly one open `teaches` edge.)
 *
 * Its own module, rather than inline in queries.ts, so a test can run the
 * exact SQL against a scratch database: queries.ts reaches `next/headers`
 * through the auth modules and cannot be imported under plain `node`.
 *
 * Two variants, as before: `node_subject` (migration 006/007) may not exist
 * yet on an older database, and the reader degrades to "no subject" then.
 */
import { MODULE_ORDER } from "./module-order";

/** Objective → its module, open `teaches` edges only. */
const LO_MODULE_JOIN = `
        LEFT JOIN graph_edges te
          ON te.dst_id = lo.id AND te.edge_type = 'teaches' AND te.system_to IS NULL
        LEFT JOIN graph_nodes m ON m.id = te.src_id AND m.kind = 'module'`;

/** With the `node_subject` view. */
export const SPINE_LO_SQL = `
        SELECT lo.id, lo.label, lo.description, lo.syllabus_ref, lo.source_page,
               lo.order_in_parent, ns.subject
        FROM graph_nodes lo${LO_MODULE_JOIN}
        LEFT JOIN node_subject ns ON ns.node_id = lo.id
        WHERE lo.kind = 'learning_objective'
        ORDER BY ${MODULE_ORDER}
      `;

/** Without it — an older database, before the multi-subject contract. */
export const SPINE_LO_SQL_NO_SUBJECT_VIEW = `
        SELECT lo.id, lo.label, lo.description, lo.syllabus_ref, lo.source_page,
               lo.order_in_parent
        FROM graph_nodes lo${LO_MODULE_JOIN}
        WHERE lo.kind = 'learning_objective'
        ORDER BY ${MODULE_ORDER}
      `;

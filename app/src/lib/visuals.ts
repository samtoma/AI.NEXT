import { pool } from "./db";

/** One row of the `visuals` table, joined to its LO (and module via the
 *  teaches edge) for grouping and labeling. */
export interface VisualRow {
  id: string;
  loId: string;
  questionId: string | null;
  kind: string;
  spec: Record<string, unknown>;
  caption: string | null;
  sourcePage: number | null;
  loLabel: string;
  syllabusRef: string | null;
}

export interface GalleryModule {
  id: string;
  label: string;
  visuals: VisualRow[];
}

export interface GalleryData {
  modules: GalleryModule[];
  total: number;
  kindCounts: { kind: string; count: number }[];
  loCount: number;
}

const BASE_SELECT = `
  SELECT v.id, v.lo_id, v.question_id, v.kind, v.spec, v.caption, v.source_page,
         lo.label AS lo_label, lo.syllabus_ref, lo.order_in_parent AS lo_order,
         m.id AS module_id, m.label AS module_label,
         m.order_in_parent AS module_order
  FROM visuals v
  JOIN graph_nodes lo ON lo.id = v.lo_id
  LEFT JOIN graph_edges e
    ON e.dst_id = v.lo_id AND e.edge_type = 'teaches' AND e.system_to IS NULL
  LEFT JOIN graph_nodes m ON m.id = e.src_id AND m.kind = 'module'
`;

interface RawRow {
  id: string;
  lo_id: string;
  question_id: string | null;
  kind: string;
  spec: Record<string, unknown>;
  caption: string | null;
  source_page: number | null;
  lo_label: string;
  syllabus_ref: string | null;
  module_id: string | null;
  module_label: string | null;
}

const toRow = (r: RawRow): VisualRow => ({
  id: r.id,
  loId: r.lo_id,
  questionId: r.question_id,
  kind: r.kind,
  spec: r.spec ?? {},
  caption: r.caption,
  sourcePage: r.source_page,
  loLabel: r.lo_label,
  syllabusRef: r.syllabus_ref,
});

/** Everything, grouped by module, for /gallery. */
export async function getGalleryData(): Promise<GalleryData> {
  const res = await pool.query(
    `${BASE_SELECT}
     ORDER BY m.order_in_parent NULLS LAST, lo.order_in_parent, v.id`
  );
  const modules: GalleryModule[] = [];
  const byModule = new Map<string, GalleryModule>();
  const kindCounts = new Map<string, number>();
  const los = new Set<string>();
  for (const r of res.rows as RawRow[]) {
    const mid = r.module_id ?? "module:unfiled";
    let group = byModule.get(mid);
    if (!group) {
      group = { id: mid, label: r.module_label ?? "Unfiled", visuals: [] };
      byModule.set(mid, group);
      modules.push(group);
    }
    group.visuals.push(toRow(r));
    kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1);
    los.add(r.lo_id);
  }
  return {
    modules,
    total: res.rowCount ?? 0,
    kindCounts: [...kindCounts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    loCount: los.size,
  };
}

/** Visuals attached to a single LO (Evidence Walk panel strip). */
export async function getVisualsForLo(loId: string): Promise<VisualRow[]> {
  const res = await pool.query(
    `${BASE_SELECT} WHERE v.lo_id = $1 ORDER BY v.id`,
    [loId]
  );
  return (res.rows as RawRow[]).map(toRow);
}

/** One stored visual by id ({{widget:viz_ref:…}} directive). */
export async function getVisualById(id: string): Promise<VisualRow | null> {
  const res = await pool.query(`${BASE_SELECT} WHERE v.id = $1`, [id]);
  const r = (res.rows as RawRow[])[0];
  return r ? toRow(r) : null;
}

/** Visuals for a set of LOs (lesson grounding catalogs). */
export async function getVisualsForLos(loIds: string[]): Promise<VisualRow[]> {
  if (loIds.length === 0) return [];
  const res = await pool.query(
    `${BASE_SELECT} WHERE v.lo_id = ANY($1) ORDER BY lo.order_in_parent, v.id`,
    [loIds]
  );
  return (res.rows as RawRow[]).map(toRow);
}

/** Every visual — compact catalog for spine-chat grounding. */
export async function getAllVisuals(): Promise<VisualRow[]> {
  const res = await pool.query(
    `${BASE_SELECT} ORDER BY m.order_in_parent NULLS LAST, lo.order_in_parent, v.id`
  );
  return (res.rows as RawRow[]).map(toRow);
}

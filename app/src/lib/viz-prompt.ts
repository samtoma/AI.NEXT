/**
 * Shared prompt fragments that teach the model its figure library —
 * used by both the spine-chat grounding (ask.ts) and the lesson surfaces
 * (lesson.ts). One source of truth for the two figure directives and the
 * 9-kind spec cheat sheet (contract: services/extraction/VIZ_SPEC.md).
 */

export interface VizCatalogItem {
  id: string;
  kind: string;
  loId: string;
  caption: string | null;
  sourcePage: number | null;
}

/** Compact `id | kind | lo | page | caption` catalog lines. */
export function visualsCatalogLines(rows: VizCatalogItem[]): string {
  return rows
    .map(
      (v) =>
        `- ${v.id} | ${v.kind} | ${v.loId} | p.${v.sourcePage ?? "—"} | "${(v.caption ?? "").slice(0, 140)}"`
    )
    .join("\n");
}

const SPEC_CHEATSHEET = `SPEC CHEAT SHEET (the 9 kinds — small integer values, flat JSON, double quotes):
· geo_scene {"elements":[{"type":"circle","cx":0,"cy":0,"r":5,"step":1},{"type":"point","x":0,"y":0,"label":"M","step":1},{"type":"chord","from":[-3,4],"to":[3,4],"label":"AB","step":2},{"type":"radius","from":[0,0],"to":[0,-5],"label":"r","step":3},{"type":"tangent","from":[-5,-5],"to":[5,-5],"step":4},{"type":"angle","at":[0,-5],"fromDeg":0,"toDeg":90,"label":"90°","step":5}],"animate":"sequence"} — element types: circle|point|segment|chord|radius|diameter|tangent|arc|angle|label; "step" (1,2,3…) is the draw order, so sequence the elements the way a teacher would draw them on the board; math orientation (y up); points meant to lie ON the circle must actually satisfy the circle equation (use 3-4-5 or 5-12-13 style integer points, e.g. r=5 → (3,4)); arc: {"startDeg":..,"endDeg":..}, label: {"x":..,"y":..,"text":".."}.
· coordinate_plot {"xRange":[-5,5],"yRange":[-5,5],"points":[{"x":3,"y":2,"label":"(3,2)"}],"animate":"plot-sequence"} · function_graph {"fn":"linear"|"quadratic","coefs":[a,b] or [a,b,c],"domain":[-5,5],"animate":"draw"} · number_line {"range":[0,10],"points":[{"x":4,"label":"r"}],"animate":"sweep"}
· arrow_map {"X":[1,2,3],"Y":[2,4,6],"pairs":[[1,2],[2,4],[3,6]],"animate":"arrows"} · product_grid {"X":[1,2],"Y":[3,4,5],"animate":"fill","showCount":true} · ratio_bars {"parts":[{"label":"a","value":3},{"label":"b","value":5}],"animate":"grow"} · stat_chart {"type":"bar"|"sector"|"dots","data":[{"label":"..","value":..}],"animate":"grow"} · trig_triangle {"angleDeg":30,"emphasize":"sin","sides":{"opp":1,"adj":2,"hyp":3},"animate":"ratio-highlight"}`;

/**
 * The two figure directives, documented for a system prompt.
 * `exampleRefId` should be a real id from the catalog in scope.
 */
export function figureDirectivesDoc(exampleRefId: string): string {
  return `FIGURES — show, don't only tell:
- {{widget:viz_ref:${exampleRefId}}} — pushes a STORED, human-curated animated figure from the FIGURE LIBRARY below, by id (no JSON). PREFER this whenever a library figure fits the point being made — these were drawn for the exact book pages you cite.
- {{widget:viz:{"kind":"geo_scene","spec":{…},"caption":"one short line"}}} — compose a CUSTOM animated figure when no stored one fits (nested JSON allowed in this directive only).
${SPEC_CHEATSHEET}
WHEN to show a figure: whenever the answer touches geometry, graphs, plotting, statistics or anything spatial, SHOW it — at most one figure per answer beat, each on its OWN line immediately after the sentence it illustrates. Figures complement the [[lo:]]/[[q:]]/[[page:]] citations, never replace them.`;
}

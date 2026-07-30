/**
 * Shared prompt fragments that teach the model its figure library —
 * used by both the spine-chat grounding (ask.ts) and the lesson surfaces
 * (lesson.ts). One source of truth for the two figure directives and the
 * 9-kind spec cheat sheet (contract: services/extraction/VIZ_SPEC.md).
 *
 * WHICH doc a lesson gets is decided by the subject's prompt kit
 * (LESSON_PROMPTS in lib/lesson.ts), keyed off the subject registry — never by
 * a `subject === "social-ar"` test at the call site. A new subject brings its
 * own `…FigureDirectivesDoc` here and names it in its kit.
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

const SOCIAL_SPEC_CHEATSHEET = `SPEC CHEAT SHEET (the 3 social-studies kinds — VIZ_SPEC v2; flat JSON, double quotes; labels/captions in Arabic; dates in Arabic-Indic digits «١٧٩٨م»; every element carries "step" 1,2,3… — the draw order, sequence it the way a teacher would draw on the board):
· map_scene {"base":"egypt","marks":[{"kind":"region","place":"سيناء","step":1},{"kind":"point","place":"القاهرة","step":2},{"kind":"route","through":["الإسكندرية","رشيد","القاهرة"],"label":"خط السير","step":3},{"kind":"badge","place":"أبو قير","label":"موقعة أبي قير ١٧٩٨م","step":4}],"animate":"sequence"} — base ∈ egypt|nile_valley|arab_world|africa|asia|world|mediterranean_east; mark kinds point|region|route|badge|label; "place" and every "through" entry MUST be an exact name from the GAZETTEER lists in the lesson data — never invent a place, never use coordinates.
· timeline {"era":[1798,1801],"events":[{"label":"وصول الحملة الفرنسية","when":"١٧٩٨م","step":1},{"label":"ثورة القاهرة الأولى","when":"أكتوبر ١٧٩٨م","step":2}],"animate":"sequence"} — الأقدم على اليمين (RTL); "when" is a short Arabic display string; list events in story order.
· flow_chain {"nodes":[{"label":"فرض الضرائب الفادحة","role":"سبب","step":1},{"label":"ثورة القاهرة الأولى","role":"حدث","step":2},{"label":"إعدام عدد من الثوار","role":"نتيجة","step":3}],"animate":"sequence"} — سبب → حدث → نتيجة boxes, RTL flow; use it for every «بم تفسر».`;

/**
 * The two figure directives for SOCIAL STUDIES (ADR-0004 Wave 1): same
 * {{widget:viz_ref}}/{{widget:viz}} protocol, but the cheat sheet documents
 * the three VIZ_SPEC v2 social kinds instead of the nine math ones. Maths
 * keeps figureDirectivesDoc byte-identical.
 */
export function socialFigureDirectivesDoc(exampleRefId: string): string {
  return `FIGURES — show, don't only tell (اشرح بالرسم):
- {{widget:viz_ref:${exampleRefId}}} — pushes a STORED, human-curated animated figure from the FIGURE LIBRARY below, by id (no JSON). PREFER this whenever a library figure fits the point being made — these were drawn for the exact book pages you cite.
- {{widget:viz:{"kind":"map_scene","spec":{…},"caption":"سطر واحد قصير"}}} — compose a CUSTOM animated figure when no stored one fits (nested JSON allowed in this directive only).
${SOCIAL_SPEC_CHEATSHEET}
WHEN to show a figure: خريطة لكل مكان، خط زمني لكل تتابع أحداث، سلسلة سبب ونتيجة لكل تفسير — at most one figure per beat, each on its OWN line immediately after the sentence it illustrates. Figures complement the [[lo:]]/[[q:]]/[[page:]] citations, never replace them.`;
}

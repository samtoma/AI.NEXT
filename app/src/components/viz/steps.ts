/**
 * How many controlled steps a {kind, spec} figure exposes on the board.
 *
 * geo_scene / arrow_map — and, since VIZ_SPEC v2, map_scene / timeline /
 * flow_chain — carry REAL step semantics (element `step` fields / one arrow
 * per step); every other kind is mapped to thirds of its natural timeline by
 * useVizTimeline's fraction window. Must stay consistent with the stepTimes
 * arrays the step-aware primitives pass to useVizTimeline (a filtered-out
 * malformed element can at worst over-count a dot — the playback window
 * itself always follows the primitive's own stepTimes).
 */

const GENERIC_STEPS = 3;

/** Distinct `step` values over an element array (default: index+1). */
function distinctSteps(v: unknown): number {
  const els = Array.isArray(v) ? v : [];
  const steps = new Set<number>();
  els.forEach((raw, i) => {
    const e =
      raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    steps.add(
      typeof e.step === "number" && Number.isFinite(e.step) ? e.step : i + 1
    );
  });
  return Math.max(1, steps.size);
}

export function vizStepCount(
  kind: string,
  spec: Record<string, unknown> | null | undefined
): number {
  if (!spec || typeof spec !== "object") return 1;
  if (kind === "geo_scene") return distinctSteps(spec.elements);
  // VIZ_SPEC v2 (social studies) — all three are element-step kinds
  if (kind === "map_scene") return distinctSteps(spec.marks ?? spec.layers);
  if (kind === "timeline") return distinctSteps(spec.events);
  if (kind === "flow_chain") return distinctSteps(spec.nodes);
  if (kind === "arrow_map") {
    const pairs = Array.isArray(spec.pairs)
      ? spec.pairs.filter((p) => Array.isArray(p) && p.length >= 2)
      : [];
    return 1 + pairs.length; // step 1 = the two set columns, then one arrow each
  }
  return GENERIC_STEPS;
}

/**
 * How many controlled steps a {kind, spec} figure exposes on the board.
 *
 * geo_scene / arrow_map — and, since VIZ_SPEC v2, map_scene / timeline /
 * flow_chain, and since v3 all seven Arabic kinds — carry REAL step semantics
 * (element `step` fields / one arrow per step); every other kind is mapped to
 * thirds of its natural timeline by useVizTimeline's fraction window. Must stay
 * consistent with the stepTimes arrays the step-aware primitives pass to
 * useVizTimeline (a filtered-out malformed element can at worst over-count a
 * dot — the playback window itself always follows the primitive's own
 * stepTimes, and useVizTimeline clamps the step index to that array).
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
  // VIZ_SPEC v3 (Arabic, ADR-0006) — every kind feeds a REAL count; none may
  // fall through to GENERIC_STEPS (arabic-viz-widgets.md §1, universal rules).
  if (kind === "text_passage") {
    // step 1 = the passage with every span dormant, then one step per group
    const spans = Array.isArray(spec.spans) ? spec.spans : [];
    if (spans.length === 0) return 1;
    const reveal = typeof spec.reveal === "string" ? spec.reveal : "span";
    if (reveal === "all") return 2;
    if (reveal === "category") {
      const cats = new Set(
        spans.map((s) =>
          s !== null && typeof s === "object" && !Array.isArray(s)
            ? String((s as Record<string, unknown>).category ?? "")
            : ""
        )
      );
      return 1 + Math.max(1, cats.size);
    }
    return 1 + distinctSteps(spans);
  }
  if (kind === "gloss_table") return distinctSteps(spec.entries);
  if (kind === "rule_tree") return 1 + distinctSteps(spec.nodes); // step 1 = root
  if (kind === "verse_layout") {
    const rhyme =
      spec.rhyme !== null && typeof spec.rhyme === "object"
        ? (spec.rhyme as Record<string, unknown>)
        : {};
    const sweep = typeof rhyme.tail === "string" && rhyme.emphasize !== false ? 1 : 0;
    const spans = Array.isArray(spec.spans) ? spec.spans : [];
    return (
      distinctSteps(spec.lines) + (spans.length > 0 ? distinctSteps(spans) : 0) + sweep
    );
  }
  if (kind === "harakat_reveal") return 1 + distinctSteps(spec.marks); // stage 0 = bare
  if (kind === "case_table")
    return distinctSteps(spec.cells ?? spec.columns ?? spec.rows ?? spec.cases);
  if (kind === "irab_tree") return 1 + distinctSteps(spec.tokens); // step 1 = sentence
  return GENERIC_STEPS;
}

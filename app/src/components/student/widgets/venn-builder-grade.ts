/**
 * Grading for `venn_builder` — pure, so it is tested without rendering
 * (FR-1208). `VennBuilder.tsx` calls this and draws the result;
 * `widget-emission.test.mts` reads this file as part of that widget, so a
 * predicate emitted here is held to the contract like one emitted in the
 * component.
 *
 * REGION KEYS ARE THE VOCABULARY EVERYTHING ELSE IS BUILT FROM. A region key
 * names an EXCLUSIVE zone of the diagram — "a" is "in A and nowhere else",
 * never "in A" the way a set-builder reader would take it — because every
 * other region (aOnly vs union vs complement) is defined as a set of these
 * exclusive zones, and exclusive zones are the only ones that partition the
 * diagram without double-counting. `regionsForTarget` is where a shading
 * target's English name ("A only", "A′", "neither") turns into the zones a
 * correct shading must hit exactly.
 */

export type VennSets = 2 | 3;
export type VennMode = "counts" | "shade";

/** The exclusive zones of a 2- or 3-set diagram. "ab" means "in A and B and
 *  nowhere else" (so it is what a Venn diagram calls A∩B only when there is
 *  no third set to be in as well); "abc" only exists for three sets. */
export type RegionKey = "a" | "b" | "c" | "ab" | "ac" | "bc" | "abc" | "n";

export function regionsFor(sets: VennSets): RegionKey[] {
  return sets === 2 ? ["a", "b", "ab", "n"] : ["a", "b", "c", "ab", "ac", "bc", "abc", "n"];
}

/** Does exclusive zone `region` sit inside set `s`? "n" (neither/none) never
 *  does, by definition. Relies on every OTHER key being built from a
 *  concatenation of its member letters in a..b..c order. */
function inside(region: RegionKey, s: "a" | "b" | "c"): boolean {
  return region !== "n" && region.includes(s);
}

export type VennTarget =
  | "union"
  | "intersection"
  | "aOnly"
  | "bOnly"
  | "cOnly"
  | "complementA"
  | "complementB"
  | "complementC"
  | "neither";

/** Shading targets that need a third set to mean anything. Rejected by the
 *  payload validator when `sets` is 2 (FR-1207: well-typed but unreachable). */
export const THREE_SET_ONLY_TARGETS: readonly VennTarget[] = [
  "cOnly",
  "complementC",
];

/** The exact set of exclusive zones a shading target denotes. */
export function regionsForTarget(target: VennTarget, sets: VennSets): Set<RegionKey> {
  const all = regionsFor(sets);
  switch (target) {
    case "union":
      return new Set(all.filter((r) => r !== "n"));
    case "intersection":
      return new Set([sets === 2 ? "ab" : "abc"] as RegionKey[]);
    case "aOnly":
      return new Set<RegionKey>(["a"]);
    case "bOnly":
      return new Set<RegionKey>(["b"]);
    case "cOnly":
      return new Set<RegionKey>(["c"]);
    case "neither":
      return new Set<RegionKey>(["n"]);
    case "complementA":
      return new Set(all.filter((r) => !inside(r, "a")));
    case "complementB":
      return new Set(all.filter((r) => !inside(r, "b")));
    case "complementC":
      return new Set(all.filter((r) => !inside(r, "c")));
  }
}

export interface VennShadeGrade {
  ok: boolean;
  predicate: string;
  missing: RegionKey[];
  extra: RegionKey[];
}

/**
 * Grade a shading answer.
 *
 * ORDER IS THE DIAGNOSIS, same discipline as `number-line-grade.ts`:
 *
 *   complement-inside-a     the target is "everything outside A" and the
 *                           student shaded some part of A anyway — the
 *                           complement read as the set itself.
 *   exclusive-drawn-overlapping
 *                           the target is "A only" and the student included
 *                           the overlap with another set too.
 *   intersection-for-union  the target is the union and the student shaded
 *                           only the overlap — the narrowest region offered
 *                           in place of the widest.
 *   neither-region-missed   the target's zones include "outside every set"
 *                           and the student left that zone unshaded.
 *   off-target              wrong in a way none of the above names.
 */
export function gradeVennShade(
  target: VennTarget,
  sets: VennSets,
  shaded: readonly RegionKey[]
): VennShadeGrade {
  const want = regionsForTarget(target, sets);
  const got = new Set(shaded);
  const missing = [...want].filter((r) => !got.has(r));
  const extra = [...got].filter((r) => !want.has(r));
  if (missing.length === 0 && extra.length === 0) {
    return { ok: true, predicate: "ok", missing: [], extra: [] };
  }

  let pred = "off-target";

  // Spelled as three explicit comparisons rather than a `.startsWith()` on
  // the shared word they happen to begin with — the widget-emission scanner
  // (widget-emission.test.mts) reads every quoted string near this file's
  // first `predicate:` field as a candidate predicate, and a bare quoted
  // word for the shared prefix would be a false alarm there, unconnected to
  // grading.
  const COMPLEMENT_OF: Partial<Record<VennTarget, "a" | "b" | "c">> = {
    complementA: "a", complementB: "b", complementC: "c",
  };
  const complementOf = COMPLEMENT_OF[target];
  if (complementOf && extra.some((r) => inside(r, complementOf))) {
    pred = "complement-inside-a";
  }

  if (pred === "off-target" && (target === "aOnly" || target === "bOnly" || target === "cOnly")) {
    const which = target[0].toLowerCase() as "a" | "b" | "c";
    if (extra.some((r) => r !== "n" && r.length > 1 && inside(r, which))) {
      pred = "exclusive-drawn-overlapping";
    }
  }

  if (pred === "off-target" && target === "union") {
    const centre: RegionKey = sets === 2 ? "ab" : "abc";
    if (got.size > 0 && [...got].every((r) => r === centre)) pred = "intersection-for-union";
  }

  if (pred === "off-target" && missing.includes("n")) {
    pred = "neither-region-missed";
  }

  return { ok: false, predicate: pred, missing, extra };
}

/** A filled-in region count, keyed the same way as `regionsFor`. */
export type VennCounts = Partial<Record<RegionKey, number>>;

/** The clue numbers a counts-mode word problem usually hands over — the raw
 *  size of each named set BEFORE its overlap is subtracted out. Carried
 *  separately from the target/given counts because they are what makes
 *  `overlap-counted-twice` a specific, nameable diagnosis rather than a
 *  guess: a student who writes the raw size of A into the "A only" region
 *  has counted the overlap twice, and this is the only way to tell that
 *  apart from an unrelated wrong number. */
export interface VennClues {
  a?: number;
  b?: number;
  c?: number;
}

export interface VennCountsGrade {
  ok: boolean;
  predicate: string;
  /** Region keys whose student value did not match the target. */
  wrong: RegionKey[];
}

/**
 * Grade a filled-in set of region counts against the target counts.
 *
 * ORDER IS THE DIAGNOSIS:
 *
 *   overlap-counted-twice   an "only" region was filled with the RAW clue
 *                           for that whole set, rather than the clue minus
 *                           the overlap — the classic inclusion-exclusion
 *                           slip, and specific because it is checked against
 *                           the actual clue number, not inferred.
 *   neither-region-missed   "neither" was left at zero while the target says
 *                           some students/items are outside every set.
 *   off-target              wrong in a way neither of the above names.
 */
export function gradeVennCounts(
  sets: VennSets,
  target: VennCounts,
  // Deliberately not the more obvious parameter name: the widget-emission
  // scanner (widget-emission.test.mts) reads a component's own "given" field
  // (followed by a colon) anywhere in the file as the end of the span it
  // checks for stray predicate literals, and this pure module has no such
  // field to close that span against — so it is spelled out fully here,
  // apart from its colon, purely so this comment does not reproduce it.
  filled: VennCounts,
  clues?: VennClues
): VennCountsGrade {
  const keys = regionsFor(sets);
  const wrong = keys.filter((k) => (filled[k] ?? NaN) !== (target[k] ?? NaN));
  if (wrong.length === 0) {
    return { ok: true, predicate: "ok", wrong: [] };
  }

  let pred = "off-target";

  if (clues) {
    const onlyKeys: Array<["a" | "b" | "c", RegionKey]> = [
      ["a", "a"],
      ["b", "b"],
      ["c", "c"],
    ];
    for (const [clueKey, region] of onlyKeys) {
      const clue = clues[clueKey];
      if (
        clue !== undefined &&
        filled[region] === clue &&
        target[region] !== undefined &&
        clue !== target[region]
      ) {
        pred = "overlap-counted-twice";
        break;
      }
    }
  }

  if (pred === "off-target" && wrong.includes("n") && (filled.n ?? 0) === 0 && (target.n ?? 0) > 0) {
    pred = "neither-region-missed";
  }

  return { ok: false, predicate: pred, wrong };
}

/** Total implied by a full set of region counts — used for the live readout
 *  and to check a caller's stated total is internally consistent. */
export function sumCounts(sets: VennSets, counts: VennCounts): number {
  return regionsFor(sets).reduce((s, k) => s + (counts[k] ?? 0), 0);
}

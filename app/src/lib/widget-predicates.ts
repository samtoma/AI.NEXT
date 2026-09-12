/**
 * The widget predicate vocabulary — GENERATED from contracts/widget-predicates.json.
 *
 * Do not edit by hand: `widget-predicates.test.mts` reads the contract and fails
 * if this file has drifted from it. The contract is the authority because three
 * layers have to agree on the spelling of every predicate — this module, the
 * extraction pipeline (`services/extraction/widget_spec.py`), and the rows
 * stored in `questions.choices`. A predicate misspelled in any one of them maps
 * to no misconception, and the student gets silence where a refutation was
 * supposed to be.
 *
 * A predicate names a structural fact about what the student built — "both ends
 * are on the circle", "the slope is inverted", "the stroke doubles back". Under
 * ADR-0009 these are a widget's distractors: the stored question maps each one
 * to a misconception_id, and the server serves that misconception's refutation.
 *
 * `ok` is reserved in every kind. It is the predicate meaning "correct", and it
 * is what `questions.correct_answer` holds for a widget row.
 */

/** The predicate a widget returns when the construction is right. */
export const OK: "ok" = "ok";

export const WIDGET_PREDICATES = {
  pair_plotter: {
    "swapped-coordinates": "Plotted (y, x) — the pair read in the wrong order",
    "wrong-quadrant": "Right distances, wrong signs — the point is in the wrong quadrant",
    "off-target": "Neither coordinate matches, with no recognisable pattern",
  },
  product_builder: {
    "reversed-pairs": "Built Y×X — the pairs are the right numbers in the wrong order",
    "missing-pairs": "An incomplete product: some pairs of X×Y were not selected",
    "extra-pairs": "Selected pairs that are not in X×Y at all",
  },
  line_drawer: {
    "slope-inverted": "Slope taken as run over rise instead of rise over run",
    "slope-sign-flipped": "Right gradient, wrong sign — the line leans the other way",
    "intercept-wrong": "Correct slope, wrong intercept — a line parallel to the answer",
    "vertical-line": "A vertical line, which has no slope and cannot be written y = mx + c",
    "points-swapped": "The named points plotted with x and y exchanged",
    "off-target": "Neither the slope nor the intercept matches",
  },
  circle_builder: {
    "ends-not-on-circle": "One or both endpoints are not on the circle",
    "chord-not-through-centre": "A chord was drawn where a diameter was asked for — it misses the centre",
    "radius-drawn-as-chord": "Both ends on the circle where a radius was asked for; a radius starts at the centre",
    "radius-short": "Starts at the centre but does not reach the circle",
    "is-secant": "The line cuts the circle twice — a secant, not a tangent",
    "is-external": "The line misses the circle completely",
    "off-target": "The construction does not satisfy the element asked for",
  },
  angle_setter: {
    "arc-given-as-angle": "Gave the arc where the inscribed angle was asked for — the angle is half the arc",
    "angle-given-as-arc": "Gave the inscribed angle where the central angle or arc was asked for — the arc is double",
    "other-arc": "Set the arc on the far side; C faces the arc across from it",
    "off-target": "The angle is not the one asked for, with no recognisable pattern",
  },
  triangle_ratio: {
    "ratio-inverted": "The right pair of sides, the wrong way up",
    "used-sine": "Built the sine where another ratio was asked for",
    "used-cosine": "Built the cosine where another ratio was asked for",
    "used-tangent": "Built the tangent where another ratio was asked for",
    "off-target": "The ratio does not match and is not a recognised substitution",
  },
  bar_builder: {
    "median-for-mean": "Built a set whose MEDIAN is the target — the mean is the total shared equally",
    "mean-for-median": "Built a set whose MEAN is the target — the median is the middle value in order",
    "no-mode": "No value repeats, so the set has no mode at all",
    "multi-modal": "Two or more values tie at the top, so the set has more than one mode",
    "total-wrong": "For this mean across n values the total must be mean x n, and it is not",
    "off-target": "The statistic does not match the target",
  },
  number_line_marker: {
    "missed-values": "Part of the answer set was not marked",
    "extra-values": "Marked values that the answer set does not contain",
    "endpoint-inclusion-wrong": "Right endpoints, wrong circles — hollow excludes (< >), filled includes (<= >=)",
    "interval-wrong": "The interval does not run between the right endpoints",
  },
  ratio_balance: {
    "inverse-solved-as-direct": "Matched the quotients where the products should match",
    "direct-solved-as-inverse": "Matched the products where the quotients should match",
    "off-target": "The fourth term does not balance the relationship",
  },
  sample_space: {
    "missed-outcomes": "Some outcomes in the event were not selected",
    "extra-outcomes": "Selected outcomes that do not satisfy the event",
    "counted-once": "Counted a compound outcome once where the grid shows several ways to make it",
  },
  curve_sketcher: {
    "fails-vertical-line-test": "The stroke doubles back: one x carries two y values, so it is not a function",
    "opens-wrong-way": "The parabola opens the opposite way — the sign of a",
    "slope-sign-flipped": "The line rises where it should fall, or the reverse",
    "vertically-displaced": "Right shape, sitting consistently above or below the true curve",
    "partial-coverage": "The sketch covers only part of the visible domain",
    "off-target": "The sketch does not follow the curve",
  },
} as const;

export type WidgetKind = keyof typeof WIDGET_PREDICATES;

/** Every predicate a given kind may return, `ok` included. */
export function predicatesFor(kind: string): readonly string[] {
  const k = WIDGET_PREDICATES[kind as WidgetKind];
  return k ? [OK, ...Object.keys(k)] : [OK];
}

/** Is `predicate` one this kind is allowed to emit? */
export function isKnownPredicate(kind: string, predicate: string): boolean {
  return predicatesFor(kind).includes(predicate);
}

/** The contract's own words for a predicate — used on operator surfaces and in
 *  the review page, so a reviewer reads the same sentence the contract defines
 *  rather than a paraphrase written at the call site. */
export function describePredicate(kind: string, predicate: string): string | null {
  if (predicate === OK) return "Correct";
  const k = WIDGET_PREDICATES[kind as WidgetKind];
  if (!k) return null;
  return (k as Record<string, string>)[predicate] ?? null;
}

/** What a widget hands back instead of a prose note (ADR-0009). The component
 *  reports STRUCTURE; the server decides what it means pedagogically. */
export interface WidgetOutcome {
  correct: boolean;
  /** One of `predicatesFor(kind)`. */
  predicate: string;
  /** What the student actually produced, recorded as `attempts.given_answer`. */
  given: string;
  /** One line for the tutor stream — still useful, but no longer load-bearing. */
  detail: string;
}

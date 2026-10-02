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
export const OK = "ok" as const;

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
    "sign-flipped": "Right sizes, wrong signs — a value marked as its negative, as when (x − a) = 0 is read as x = −a",
    "endpoint-inclusion-wrong": "Right endpoints, wrong circles — hollow excludes (< >), filled includes (<= >=)",
    "interval-wrong": "The interval does not run between the right endpoints",
    "off-target": "Wrong in a way none of the named errors describes",
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
    "asymptote-crossed": "The stroke runs straight through where the curve is undefined, as if it were continuous there",
    "wrong-quadrants": "The hyperbola's branches sit in the wrong pair of quadrants — the sign of a",
    "wrong-intercept": "The curve does not pass through its true y-intercept",
    "amplitude-wrong": "The curve reaches the wrong distance from its midline",
    "period-wrong": "The curve repeats at the wrong rate for this function",
    "vertical-shift-wrong": "The curve is centred on the wrong midline",
    "off-target": "The sketch does not follow the curve",
  },
  polygon_builder: {
    "only-one-pair-parallel": "That is a trapezium — only one pair of opposite sides is parallel",
    "sides-not-equal": "The sides that must be equal for this shape are not",
    "no-right-angle": "None of the interior angles is a right angle",
    "midsegment-not-half": "Parallel to the third side, but not half its length",
    "area-missing-half": "Exactly double the target — the ÷2 was left out of the area formula",
    "not-the-shape": "The construction does not have the property this shape needs",
  },
  solid_scaler: {
    "volume-scaled-by-k": "The scale factor was applied once (k), not cubed (k³) — a linear length scaling used for a volume",
    "area-scaled-by-k": "The scale factor was applied once (k), not squared (k²) — a linear length scaling used for an area",
    "wrong-formula-part": "The scale factor is right, but a face — usually a base — is missing from the surface-area reading",
    "off-target": "Neither the scale factor nor the surface reading matches",
  },
  box_plot_builder: {
    "median-of-unsorted": "The middle of the data as GIVEN, not the middle once it is sorted",
    "iqr-as-range": "The lower and upper quartiles were placed at the minimum and maximum — the interquartile range rebuilt as the full range",
    "quartile-method": "A different quartile method was used (splitting at the median) — this book uses linear interpolation between ranks",
    "whisker-to-outlier": "A whisker was dragged out to a raw outlier instead of stopping at the last value within 1.5×IQR",
    "off-target": "The five-number summary does not match, with no recognisable pattern",
  },
  venn_builder: {
    "overlap-counted-twice": "A region's raw set size was entered instead of the count exclusive to it — the overlap counted in twice",
    "intersection-for-union": "The intersection was shaded (or counted) where the union was asked for",
    "complement-inside-a": "The complement was shaded inside the set it complements, rather than everywhere outside it",
    "exclusive-drawn-overlapping": "\"X only\" was shaded including its overlap with another set",
    "neither-region-missed": "The region outside every set was left unshaded or uncounted",
    "off-target": "Wrong in a way none of the named errors describes",
  },
  area_model: {
    "missing-cross-term": "The x tiles were skipped — only x² and the constant are there, as in (a+b)² read as a² + b²",
    "middle-term-sign": "The constant term is right and the linear (x) term is not — usually its sign",
    "constant-sign": "The linear (x) term is right and the constant term is not — usually its sign",
    "not-a-rectangle": "The placed tiles do not tile a rectangle: a gap, a stray tile, or more than one x² tile",
    "off-target": "A valid rectangle whose terms match neither the target sum nor its product",
  },
} as const;

export type WidgetKind = keyof typeof WIDGET_PREDICATES;

/**
 * CAN EMIT (consistency review 2026-09-27, W1) — GENERATED from the contract's
 * `can_emit`, checked by widget-predicates.test.mts like the vocabulary above.
 *
 * A kind DECLARES every predicate it knows; a given question emits only some:
 * line_drawer in "points" mode grades the two handles and never reports a
 * slope, angle_setter asked for the inscribed angle never reports
 * "angle-given-as-arc". Per kind: a list, or `{ by, cases }` dispatching on the
 * stored spec's field (`"(absent)"` when it is missing, `"(present)"` when it
 * holds an object). Derived from each component's grading code (the contract
 * names the file); the pipeline refuses a mapping outside it
 * (`services/extraction/widget_spec.py` validate_widget), because a mapping on a
 * predicate the question cannot emit never fires and the student gets a plain
 * "not quite" where a refutation was promised.
 */
export const WIDGET_CAN_EMIT = {
  pair_plotter: ["swapped-coordinates", "wrong-quadrant", "off-target"],
  product_builder: ["reversed-pairs", "missing-pairs"],
  line_drawer: {
    by: "mode",
    cases: {
      points: ["points-swapped", "off-target"],
      equation: ["vertical-line", "intercept-wrong", "slope-sign-flipped", "slope-inverted", "off-target"],
    },
  },
  circle_builder: {
    by: "element",
    cases: {
      radius: ["radius-drawn-as-chord", "radius-short", "off-target"],
      chord: ["ends-not-on-circle"],
      diameter: ["chord-not-through-centre", "ends-not-on-circle"],
      tangent: ["is-secant", "is-external"],
    },
  },
  angle_setter: {
    by: "ask",
    cases: {
      inscribed: ["arc-given-as-angle", "other-arc", "off-target"],
      central: ["angle-given-as-arc", "other-arc", "off-target"],
    },
  },
  triangle_ratio: {
    by: "ask",
    cases: {
      sin: ["used-cosine", "used-tangent", "off-target"],
      cos: ["used-sine", "used-tangent", "off-target"],
      tan: ["used-sine", "used-cosine", "ratio-inverted", "off-target"],
    },
  },
  bar_builder: {
    by: "ask",
    cases: {
      mean: ["median-for-mean", "total-wrong"],
      median: ["mean-for-median", "off-target"],
      mode: ["no-mode", "multi-modal", "off-target"],
      range: ["off-target"],
    },
  },
  number_line_marker: {
    by: "mode",
    cases: {
      points: ["missed-values", "extra-values", "sign-flipped"],
      interval: ["endpoint-inclusion-wrong", "interval-wrong"],
    },
  },
  ratio_balance: {
    by: "mode",
    cases: {
      direct: ["direct-solved-as-inverse", "off-target"],
      inverse: ["inverse-solved-as-direct", "off-target"],
    },
  },
  sample_space: ["counted-once", "missed-outcomes", "extra-outcomes"],
  curve_sketcher: {
    by: "fn",
    cases: {
      linear: ["fails-vertical-line-test", "partial-coverage", "vertically-displaced", "off-target", "slope-sign-flipped"],
      quadratic: ["fails-vertical-line-test", "partial-coverage", "vertically-displaced", "off-target", "opens-wrong-way"],
      hyperbola: ["fails-vertical-line-test", "partial-coverage", "vertically-displaced", "off-target", "asymptote-crossed", "wrong-quadrants"],
      exponential: ["fails-vertical-line-test", "partial-coverage", "vertically-displaced", "off-target", "asymptote-crossed", "wrong-intercept"],
      sine: ["fails-vertical-line-test", "partial-coverage", "vertically-displaced", "off-target", "vertical-shift-wrong", "amplitude-wrong", "period-wrong"],
      cosine: ["fails-vertical-line-test", "partial-coverage", "vertically-displaced", "off-target", "vertical-shift-wrong", "amplitude-wrong", "period-wrong"],
      tangent: ["fails-vertical-line-test", "partial-coverage", "vertically-displaced", "off-target", "asymptote-crossed", "vertical-shift-wrong", "amplitude-wrong", "period-wrong"],
    },
  },
  polygon_builder: {
    by: "mode",
    cases: {
      construct: {
        by: "shape",
        cases: {
          scalene: ["not-the-shape"],
          isosceles: ["sides-not-equal", "not-the-shape"],
          right: ["no-right-angle", "not-the-shape"],
          parallelogram: ["only-one-pair-parallel", "not-the-shape"],
          rectangle: ["only-one-pair-parallel", "no-right-angle", "not-the-shape"],
          rhombus: ["only-one-pair-parallel", "sides-not-equal", "not-the-shape"],
          square: ["only-one-pair-parallel", "no-right-angle", "sides-not-equal", "not-the-shape"],
          trapezium: ["not-the-shape"],
          kite: ["sides-not-equal", "not-the-shape"],
        },
      },
      midsegment: ["midsegment-not-half", "not-the-shape"],
      area: ["area-missing-half", "not-the-shape"],
    },
  },
  solid_scaler: {
    by: "ask",
    cases: {
      volume: ["volume-scaled-by-k", "off-target"],
      area: {
        by: "solid",
        cases: {
          box: ["area-scaled-by-k", "wrong-formula-part", "off-target"],
          cylinder: ["area-scaled-by-k", "wrong-formula-part", "off-target"],
          cone: ["area-scaled-by-k", "wrong-formula-part", "off-target"],
          pyramid: ["area-scaled-by-k", "wrong-formula-part", "off-target"],
          sphere: ["area-scaled-by-k", "off-target"],
        },
      },
    },
  },
  box_plot_builder: ["median-of-unsorted", "iqr-as-range", "quartile-method", "whisker-to-outlier", "off-target"],
  venn_builder: {
    by: "mode",
    cases: {
      shade: {
        by: "target",
        cases: {
          union: ["intersection-for-union", "off-target"],
          intersection: ["off-target"],
          aOnly: ["exclusive-drawn-overlapping", "off-target"],
          bOnly: ["exclusive-drawn-overlapping", "off-target"],
          cOnly: ["exclusive-drawn-overlapping", "off-target"],
          complementA: ["complement-inside-a", "neither-region-missed", "off-target"],
          complementB: ["complement-inside-a", "neither-region-missed", "off-target"],
          complementC: ["complement-inside-a", "neither-region-missed", "off-target"],
          neither: ["neither-region-missed", "off-target"],
        },
      },
      counts: {
        by: "clues",
        cases: {
          "(present)": ["overlap-counted-twice", "neither-region-missed", "off-target"],
          "(absent)": ["neither-region-missed", "off-target"],
        },
      },
    },
  },
  area_model: ["missing-cross-term", "middle-term-sign", "constant-sign", "not-a-rectangle", "off-target"],
} as const;

type EmitNode = readonly string[] | { readonly by: string; readonly cases: Readonly<Record<string, EmitNode>> };

/** The predicates (besides `ok`) a widget of `kind` with this stored `spec` can
 *  actually emit, or null when the spec reaches no case (a value the widget
 *  does not render) or the kind is unknown. */
export function canEmit(kind: string, spec: Record<string, unknown> | null | undefined): readonly string[] | null {
  let node: EmitNode | undefined = (WIDGET_CAN_EMIT as Record<string, EmitNode>)[kind];
  while (node && !Array.isArray(node)) {
    const n = node as { by: string; cases: Record<string, EmitNode> };
    const v = spec?.[n.by];
    const key =
      v === undefined || v === null ? "(absent)"
      : typeof v === "object" || typeof v === "boolean" ? "(present)"
      : String(v);
    node = n.cases[key];
  }
  return (node as readonly string[] | undefined) ?? null;
}

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

/**
 * Directive documentation for the mathematics drawing widgets, SCOPED TO THE
 * LESSON'S OWN TOPIC.
 *
 * There are eleven maths widgets now, and documenting all eleven in every
 * lesson prompt would be wrong twice over. It is expensive — eleven payload
 * schemas in a prompt that already carries the curriculum graph, the question
 * bank and the figure catalogue — and, worse, it is a menu. A model handed
 * eleven options at every beat picks worse than one handed two, and the
 * failure mode is a circle-construction widget in a statistics lesson, which
 * reads to a fourteen-year-old as the tutor losing the thread.
 *
 * So each lesson is told about the widgets that belong to its unit and no
 * others. The mapping is by lesson slug prefix, which is exactly how the
 * extraction pipeline names LOs (`lo:geo2-3-1` → unit "geo2"), so it stays
 * true as long as the book does.
 *
 * The runtime does NOT depend on this: `render-math-widget.tsx` validates and
 * renders any registered widget whatever the lesson. This file decides what
 * the tutor is TOLD it has, not what the app will accept — a distinction worth
 * keeping, because the day a lesson genuinely needs a borrowed widget, the fix
 * is one line here and nothing downstream breaks.
 */

/** One documented directive: the example line the model copies. */
interface WidgetDoc {
  name: string;
  line: string;
}

const DOCS: Record<string, WidgetDoc> = {
  pair_plotter: {
    name: "pair_plotter",
    line: `{{widget:pair_plotter:{"prompt":"Plot the point (3,2)","target":[3,2]}}} — a coordinate grid (−5..5); the student taps one lattice point. Target coordinates must be whole numbers in −5..5.`,
  },
  product_builder: {
    name: "product_builder",
    line: `{{widget:product_builder:{"X":[1,2],"Y":[3,4,5],"prompt":"Tap all the pairs of X x Y"}}} — the student taps ordered pairs to build X×Y (decoys are added automatically). Small sets only: 2–3 numbers each, at most 4.`,
  },
  line_drawer: {
    name: "line_drawer",
    line: `{{widget:line_drawer:{"prompt":"Draw y = 2x - 1","mode":"equation","m":2,"b":-1}}} — the student DRAGS two lattice points and the line through them is drawn, with its equation updating live. In "equation" mode any two points on the correct line are accepted, so use it to ask for a line by its rule; m must be a whole number or the reciprocal of one, and b a whole number in −5..5. The other mode is {"mode":"points","through":[[-2,1],[3,4]]} — there the two named points ARE the answer.`,
  },
  circle_builder: {
    name: "circle_builder",
    line: `{{widget:circle_builder:{"prompt":"Draw a chord of circle M","element":"chord"}}} — a circle of radius 5 about M; the student drags both ends of a segment to construct the named element. element ∈ radius | chord | diameter | tangent. Every construction with the right PROPERTY is accepted (a chord has dozens of correct answers), and the defining properties light up live as the student drags — so use it to teach what the word means, not to test one remembered picture.`,
  },
  angle_setter: {
    name: "angle_setter",
    line: `{{widget:angle_setter:{"prompt":"Make the inscribed angle 35 degrees","ask":"inscribed","target":35}}} — A, B and C all drag on a circle; the arc AB that C faces and the angle ∠ACB are shown together and stay in a 2:1 ratio through every drag. ask ∈ central | inscribed. target must be a multiple of 5 (inscribed 5–175, central 10–350). This is the inscribed-angle theorem as a thing the student does with their hands — prefer it to any explanation of that theorem.`,
  },
  triangle_ratio: {
    name: "triangle_ratio",
    line: `{{widget:triangle_ratio:{"prompt":"Build a triangle where sin(theta) = 0.6","ask":"sin","target":0.6}}} — a right triangle whose two legs the student drags, with sin, cos and tan all updating live. ask ∈ sin | cos | tan; it is graded on the RATIO, so every similar triangle is accepted — 3-4 and 6-8 both give tan 0.75. sin and cos targets must be below 1. Use it to show that the ratio does not depend on the size.`,
  },
  bar_builder: {
    name: "bar_builder",
    line: `{{widget:bar_builder:{"prompt":"Build five values with a mean of 6","ask":"mean","target":6,"n":5}}} — the student drags bars (0..10) to BUILD a data set with a given statistic; mean, median, mode, range and the population standard deviation are all shown live. ask ∈ mean | median | mode | range; n is 3–8. This runs the book's question backwards on purpose: many data sets have a mean of 6, and discovering that is the lesson.`,
  },
  number_line_marker: {
    name: "number_line_marker",
    line: `{{widget:number_line_marker:{"prompt":"Mark the values x cannot take","mode":"points","range":[-6,6],"targets":[-2,3]}}} — the student taps values on a number line; the answer is a SET and is graded as one (1–4 targets). The other mode is {"mode":"interval","range":[-6,6],"from":2,"to":6,"openFrom":true,"openTo":true} — an inequality, where the student also sets each endpoint hollow (excluded, < or >) or filled (included, ≤ or ≥).`,
  },
  ratio_balance: {
    name: "ratio_balance",
    line: `{{widget:ratio_balance:{"prompt":"3 : 4 = 9 : ?","mode":"direct","a":3,"b":4,"c":9}}} — a beam balance for the fourth term; the student drags the right pan until it is level. mode "direct" requires the two QUOTIENTS to match, "inverse" the two PRODUCTS (use inverse for "more workers, fewer days"). The fourth term must come out a whole number from 1 to 24 — check that before emitting.`,
  },
  sample_space: {
    name: "sample_space",
    line: `{{widget:sample_space:{"prompt":"Tap every outcome where the two dice total 7","rows":6,"cols":6,"rule":{"kind":"sum","op":"eq","value":7}}} — the whole sample space as a grid; the student taps or drags across the outcomes in the event and n(E)/n(S) assembles live. kind ∈ sum | diff | product | same | first | second; op ∈ eq | ne | lt | le | gt | ge. You name the RULE and the app works out which cells satisfy it — never send a list of correct cells.`,
  },
  curve_sketcher: {
    name: "curve_sketcher",
    line: `{{widget:curve_sketcher:{"prompt":"Sketch y = x^2 - 4","fn":"quadratic","coefs":[1,0,-4]}}} — the student draws the curve FREEHAND with a finger and the sketch is scored on shape, within about one grid square. fn ∈ linear (coefs [m,c]) | quadratic (coefs [a,b,c], a ≠ 0). A stroke that doubles back is rejected for failing the vertical line test, which makes it a good way to revisit what a function is. Keep the curve mostly inside −5..5.`,
  },
};

/**
 * Which widgets each unit is told about. Keyed by the lesson-slug prefix the
 * extraction pipeline assigns (`u3-2` → "u3", `geo2-4` → "geo2").
 *
 * Order matters: the first entry is the one the model reaches for most, so
 * each list leads with the widget that carries that unit's central idea.
 */
const BY_UNIT: Record<string, string[]> = {
  // Relations and functions — the Cartesian product is the unit's spine, and
  // the sketcher's vertical-line-test rejection is this unit's definition
  // enforced by the instrument.
  u1: ["product_builder", "pair_plotter", "curve_sketcher", "line_drawer"],
  u2: ["ratio_balance", "bar_builder"],
  u3: ["bar_builder", "number_line_marker"],
  u4: ["triangle_ratio"],
  u5: ["pair_plotter", "line_drawer", "curve_sketcher"],
  geo1: ["circle_builder", "angle_setter"],
  geo2: ["angle_setter", "circle_builder"],
  t2u1: ["line_drawer", "number_line_marker", "ratio_balance"],
  t2u2: ["number_line_marker", "curve_sketcher"],
  t2u3: ["sample_space"],
};

/** `"geo2-4"` → `"geo2"`; `"u3-2"` → `"u3"`. */
export function unitOf(slug: string): string {
  return slug.split("-")[0];
}

/**
 * The `- {{widget:…}}` lines for this lesson, ready to drop into the prompt's
 * INTERACTIVE DIRECTIVES block.
 *
 * A slug from outside the mapping falls back to the two original widgets
 * rather than to everything: an unknown unit is the case where the model has
 * the least idea what fits, which is the worst moment to hand it eleven
 * options.
 */
export function mathWidgetDocs(slug: string): string {
  const names = BY_UNIT[unitOf(slug)] ?? ["pair_plotter", "product_builder"];
  return names
    .map((n) => DOCS[n])
    .filter((d): d is WidgetDoc => !!d)
    .map((d) => `- ${d.line}`)
    .join("\n");
}

/** The widget names this lesson is told about — for tests and the dev fixture. */
export function mathWidgetsFor(slug: string): string[] {
  return BY_UNIT[unitOf(slug)] ?? ["pair_plotter", "product_builder"];
}

/** Every unit key that carries a widget list — lets a test assert coverage. */
export const WIDGET_UNITS = Object.keys(BY_UNIT);

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

import { addressForms, type AddressForms } from "./address";

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
  // The three kinds below belong to feature 003 (the Grade 10 American course)
  // and are documented here so `mathWidgetDocsNamed` can render them; they are
  // never added to BY_UNIT below, so no Prep-3 (National) lesson is ever told
  // about them and every National prompt stays byte-identical.
  polygon_builder: {
    name: "polygon_builder",
    line: `{{widget:polygon_builder:{"prompt":"Construct a rhombus","mode":"construct","shape":"rhombus"}}} — the student drags 3 or 4 vertices on a lattice into the named shape; graded on its PROPERTIES (side lengths, parallel sides, right angles), so every valid figure is accepted. shape (triangle) ∈ scalene | isosceles | right; shape (quadrilateral) ∈ parallelogram | rectangle | rhombus | square | trapezium | kite — never equilateral, which a square lattice cannot draw. Two other modes: {"mode":"midsegment","triangle":[[0,0],[6,0],[0,6]],"apex":0} — the student drags a segment onto the two sides touching "apex" and it is graded parallel-and-half-length against the third side (the midpoint theorem, as a property, not a position); and {"mode":"area","shape":"triangle","target":6} — any polygon of that vertex count is accepted if its area matches (target must be a whole or half number, Pick's theorem).`,
  },
  solid_scaler: {
    name: "solid_scaler",
    line: `{{widget:solid_scaler:{"prompt":"Scale this cylinder so its volume is 8 times as large","solid":"cylinder","ask":"volume","ratio":8}}} — a simple isometric solid the student scales by dragging a factor k; the live readout shows V0·k³ and A0·k² together. solid ∈ box | cylinder | cone | pyramid | sphere; ask ∈ volume | area. "ratio" is the TARGET MULTIPLE (never an absolute number) and its correct k — ∛ratio for volume, √ratio for area — must land on the slider's own 0.5 stops from 0.5 to 4 (so favour ratio ∈ {1, 2.25, 4, 8, 9, 15.625, 16, 27, 64, …} — check ∛ or √ lands on a half before emitting). ask:"area" also shows toggles for which face(s) count, so leaving a base off is diagnosed on its own.`,
  },
  box_plot_builder: {
    name: "box_plot_builder",
    line: `{{widget:box_plot_builder:{"prompt":"Build the box plot for this data set","data":[2,4,4,5,6,7,9,12,15]}}} — the student drags five markers (minimum, Q1, median, Q3, maximum) onto a number line for the given data set. "data" must be 5–16 WHOLE numbers (so every quartile lands on the widget's snap grid) — never pre-sorted for the student, and include an outlier only when you want the whisker-vs-outlier distinction taught. Quartiles are graded by this book's own method: linear interpolation between ranks (Siyavula §10.4's "percentile formula"), not the split-at-the-median method some other syllabuses use.`,
  },
  venn_builder: {
    name: "venn_builder",
    line: `{{widget:venn_builder:{"prompt":"Shade A only","sets":2,"labels":["Football","Chess"],"mode":"shade","target":"aOnly"}}} — a real 2- or 3-circle Venn diagram; the student taps the region(s) that make the named target true. target ∈ union | intersection | aOnly | bOnly | cOnly | complementA | complementB | complementC | neither — cOnly/complementC need sets:3. The other mode fills in counts instead of shading: {"mode":"counts","sets":2,"labels":["French","German"],"total":20,"regions":{"a":8,"b":5,"ab":4,"n":3},"clues":{"a":12,"b":9}} — "regions" is every exclusive zone's TRUE count (a/b/c/ab/ac/bc/abc/n, whichever the set count needs) and must sum to "total" when you give one; "clues" are the word problem's raw, PRE-overlap set sizes, which is what lets the widget name "counted the overlap twice" as the specific mistake it is.`,
  },
  area_model: {
    name: "area_model",
    line: `{{widget:area_model:{"prompt":"Expand (x + 2)(x - 3) with the tiles","mode":"expand","a":2,"b":-3}}} — algebra tiles as a grid the student builds: one x² tile anchored, x-tiles run out along its top and left edges (the "a" and "b" signs — negative tiles are hatched AND marked "−", never colour alone), and the block those two runs bound is where the ab unit tiles go. mode ∈ expand | factor — same target (x+a)(x+b), same grading, only the prompt differs; a and b are whole numbers, not both zero, |a| and |b| ≤ 4 (the grid runs out past that). Prefer this over an explanation of FOIL: the cross term is something the student places, not a step they recite.`,
  },
  /**
   * `curve_sketcher`'s FIVE NEW FAMILIES, documented under a SEPARATE key
   * rather than folded into the entry above. That entry is read by every
   * Prep-3 (National) unit that already offers curve_sketcher (u1, u5, t2u2,
   * via BY_UNIT) — extending its text would extend THEIR prompt too, which is
   * exactly the byte-identity this feature is required not to break. `lib/
   * lesson.ts` asks for this key by name, in place of "curve_sketcher", for a
   * G10 lesson whose unit's LIVE widget bank holds a curve_sketcher question
   * of one of these five families (`hasG10CurveFamily`) — a National lesson
   * never sets that flag, so its prompt is unaffected (`documentedMathWidgets`
   * already tolerates a name with no BY_UNIT entry, so this is additive there
   * too).
   */
  curve_sketcher_g10: {
    name: "curve_sketcher",
    line: `{{widget:curve_sketcher:{"prompt":"Sketch y = 2/x - 1","fn":"hyperbola","coefs":[2,-1]}}} — the same freehand curve_sketcher, five more families. fn ∈ hyperbola (coefs [a,q], y=a/x+q, a a nonzero whole number |a|≤6, q whole |q|≤3) | exponential (coefs [a,b,q], y=a·b^x+q, a nonzero whole |a|≤3, b ∈ {2,3,0.5}, q whole |q|≤3) | sine | cosine | tangent (coefs [a,q], amplitude a — nonzero whole, |a|≤4 for sine/cosine or ≤3 for tangent — and vertical shift q whole |q|≤3; θ is in DEGREES, domain 0..360, and the period is fixed by the book's own convention — 360° for sine/cosine, 180° for tangent — never a parameter you set). Hyperbola and tangent have more than one visible branch and CANNOT be drawn as one stroke: tell the student to lift their finger and draw each branch separately. Drawing straight through where the curve is undefined (x=0 for a hyperbola, θ=90°/270° for tangent) is rejected as "asymptote-crossed", which is the point — an asymptote is a boundary the curve approaches and never crosses.`,
  },
};

/**
 * The five families `curve_sketcher_g10` documents that `curve_sketcher`'s
 * original entry does not (linear, quadratic) — `lib/lesson.ts` reads this to
 * decide whether a G10 unit's live curve_sketcher bank needs the wider entry.
 */
export const CURVE_SKETCHER_G10_FAMILIES: ReadonlySet<string> = new Set([
  "hyperbola",
  "exponential",
  "sine",
  "cosine",
  "tangent",
]);

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
export function mathWidgetDocs(
  slug: string,
  /** how this student is addressed (FR-2602). Defaults to the either-correct
   *  register — never the masculine — so a caller that forgets it is neutral
   *  rather than wrong about half the students. */
  a: AddressForms = addressForms(null)
): string {
  return mathWidgetDocsNamed(
    BY_UNIT[unitOf(slug)] ?? ["pair_plotter", "product_builder"],
    a
  );
}

/**
 * The same lines for a widget list the caller already has — a course whose
 * units are not in the map above names its own (feature 003: the Grade 10
 * course reads the widget kinds of its unit's live widget questions,
 * `lib/lesson.ts`). Names with no documentation here are skipped, as they are
 * above. An EMPTY list is told so, rather than handed another unit's widgets:
 * FR-1209 forbids a borrowed widget, and so does decision 10 for Grade 10.
 */
export function mathWidgetDocsNamed(
  names: readonly string[],
  a: AddressForms = addressForms(null)
): string {
  const lines = names
    .map((n) => DOCS[n])
    .filter((d): d is WidgetDoc => !!d)
    .map((d) => `- ${d.line}`);
  if (lines.length === 0) {
    return (
      `- This lesson's unit has no drawing widget of its own: for a hands-on ` +
      `beat use a stored figure or a question card from the QUESTION BANK.`
    );
  }
  lines.push(
    `- EVERY widget payload above may carry "lo":"lo:…" naming the objective ` +
      `the beat is teaching, and it SHOULD. A widget you compose is recorded ` +
      `as a real attempt against that objective and moves ${a.their} mastery ` +
      `estimate; without it the widget still teaches but nothing is recorded, ` +
      `because evidence filed against a guessed skill is worse than evidence ` +
      `not filed. Use an objective id from the LESSON DATA.`
  );
  lines.push(
    `- PREFER A STORED CONSTRUCTION. The QUESTION BANK below contains widget ` +
      `questions — their line reads "(construction: <kind>)". Push one with ` +
      `{{show_question:q:…}} exactly as you would any other question: they are ` +
      `bound to an objective, carry a worked solution, and name the specific ` +
      `mistakes they can diagnose. Compose one inline only when nothing stored fits.`
  );
  return lines.join("\n");
}

/** The names in `names` that this file documents, in their order. */
export function documentedMathWidgets(names: readonly string[]): string[] {
  return names.filter((n) => !!DOCS[n]);
}

/** The widget names this lesson is told about — for tests and the dev fixture. */
export function mathWidgetsFor(slug: string): string[] {
  return BY_UNIT[unitOf(slug)] ?? ["pair_plotter", "product_builder"];
}

/** Every unit key that carries a widget list — lets a test assert coverage. */
export const WIDGET_UNITS = Object.keys(BY_UNIT);

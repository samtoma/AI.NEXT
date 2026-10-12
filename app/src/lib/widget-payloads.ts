/**
 * Payload validation for the mathematics drawing widgets.
 *
 * WHY THIS IS ITS OWN MODULE, AWAY FROM THE COMPONENTS. Every widget directive
 * is written by a model, mid-stream, into a chat message: a coefficient can
 * arrive as a string, a target can land outside the grid, an answer can be
 * unreachable on the instrument being asked for. This layer is the only thing
 * between that and a child being marked wrong for a right answer, so it is
 * kept free of React and tested directly (widget-payloads.test.mts) rather
 * than exercised through a rendered component.
 *
 * The rule throughout: REJECT RATHER THAN REPAIR. A payload that does not
 * validate returns null and the widget does not render — the lesson keeps its
 * text and loses a beat. Coercing a near-miss into something renderable is the
 * worse failure, because a widget with a quietly wrong answer key looks
 * exactly like a working one until it tells a student their correct answer is
 * incorrect.
 *
 * "Reachable" is doing real work in several of these. It is not enough for a
 * target to be well-typed: the angle handles snap to 5°, the balance pan holds
 * whole numbers 1–24, sin and cos cannot reach 1 in a real right triangle. A
 * target outside those is a question the student cannot answer however well
 * they understand it, so it is refused here.
 */

export type CircleElement = "radius" | "chord" | "diameter" | "tangent";
export type BarStat = "mean" | "median" | "mode" | "range";
export type RuleKind = "sum" | "diff" | "product" | "same" | "first" | "second";
export type RuleOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge";
export type CurveFn =
  | "linear" | "quadratic" | "hyperbola" | "exponential" | "sine" | "cosine" | "tangent";
export type PolygonShape =
  | "scalene" | "isosceles" | "right"
  | "parallelogram" | "rectangle" | "rhombus" | "square" | "trapezium" | "kite";
export type SolidKind = "box" | "cylinder" | "cone" | "pyramid" | "sphere";
export type VennTarget =
  | "union" | "intersection" | "aOnly" | "bOnly" | "cOnly"
  | "complementA" | "complementB" | "complementC" | "neither";
export type VennRegionCounts = Partial<Record<"a" | "b" | "c" | "ab" | "ac" | "bc" | "abc" | "n", number>>;

export type MathWidget =
  | { name: "pair_plotter"; prompt: string; target: [number, number] }
  | { name: "product_builder"; prompt: string; X: number[]; Y: number[] }
  | { name: "line_drawer"; prompt: string; mode: "points"; through: [[number, number], [number, number]] }
  | { name: "line_drawer"; prompt: string; mode: "equation"; m: number; b: number }
  | { name: "circle_builder"; prompt: string; element: CircleElement }
  | { name: "angle_setter"; prompt: string; ask: "central" | "inscribed"; target: number }
  | { name: "triangle_ratio"; prompt: string; ask: "sin" | "cos" | "tan"; target: number }
  | { name: "bar_builder"; prompt: string; ask: BarStat; target: number; n: number; labels?: string[] }
  | { name: "number_line_marker"; prompt: string; mode: "points"; range: [number, number]; targets: number[] }
  | { name: "number_line_marker"; prompt: string; mode: "interval"; range: [number, number]; from: number; to: number; openFrom: boolean; openTo: boolean }
  | { name: "ratio_balance"; prompt: string; mode: "direct" | "inverse"; a: number; b: number; c: number }
  | { name: "sample_space"; prompt: string; rows: number; cols: number; rule: { kind: RuleKind; op: RuleOp; value: number } }
  | { name: "curve_sketcher"; prompt: string; fn: CurveFn; coefs: number[] }
  | { name: "polygon_builder"; prompt: string; mode: "construct"; shape: PolygonShape }
  | { name: "polygon_builder"; prompt: string; mode: "midsegment"; triangle: [[number, number], [number, number], [number, number]]; apex: 0 | 1 | 2 }
  | { name: "polygon_builder"; prompt: string; mode: "area"; shape: "triangle" | "quadrilateral"; target: number }
  | { name: "solid_scaler"; prompt: string; solid: SolidKind; dims: Record<string, number>; ask: "volume" | "area"; ratio: number }
  | { name: "box_plot_builder"; prompt: string; data: number[] }
  | { name: "venn_builder"; prompt: string; sets: 2 | 3; labels: string[]; mode: "shade"; target: VennTarget }
  | {
      name: "venn_builder"; prompt: string; sets: 2 | 3; labels: string[]; mode: "counts";
      total?: number; regions: VennRegionCounts; clues?: { a?: number; b?: number; c?: number };
    }
  | { name: "area_model"; prompt: string; mode: "expand" | "factor"; a: number; b: number };

/** Every maths widget name the dispatcher answers to. */
export const MATH_WIDGETS = [
  "pair_plotter", "product_builder", "line_drawer", "circle_builder",
  "angle_setter", "triangle_ratio", "bar_builder", "number_line_marker",
  "ratio_balance", "sample_space", "curve_sketcher",
  "polygon_builder", "solid_scaler", "box_plot_builder",
  "venn_builder", "area_model",
] as const;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);

const str = (v: unknown, fallback: string) =>
  typeof v === "string" && v.trim() ? v : fallback;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/** Exactly `n` finite numbers, or null. */
function nums(v: unknown, n: number): number[] | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  return v.every(isNum) ? (v as number[]) : null;
}

/** A pair of whole numbers, each within ±lim. */
function intPair(v: unknown, lim: number): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [a, b] = v;
  if (!isInt(a) || !isInt(b)) return null;
  if (Math.abs(a) > lim || Math.abs(b) > lim) return null;
  return [a, b];
}

const CIRCLE_ELEMENTS = ["radius", "chord", "diameter", "tangent"] as const;
const BAR_STATS = ["mean", "median", "mode", "range"] as const;
const RULE_KINDS = ["sum", "diff", "product", "same", "first", "second"] as const;
const RULE_OPS = ["eq", "ne", "lt", "le", "gt", "ge"] as const;
const CURVE_FNS = [
  "linear", "quadratic", "hyperbola", "exponential", "sine", "cosine", "tangent",
] as const;
/** Coefficients each curve family takes — kept beside `CURVE_FNS` rather than
 *  imported from `curve-sketcher-grade.ts` (a components/ module): this file
 *  has no imports by design (widget-payloads.test.mts exercises it with no
 *  rendering at all), and the replay test in the widget's own folder is what
 *  proves the two copies cannot drift apart unnoticed. */
const CURVE_COEF_COUNT: Record<CurveFn, number> = {
  linear: 2, quadratic: 3, hyperbola: 2, exponential: 3, sine: 2, cosine: 2, tangent: 2,
};
const POLYGON_SHAPES = [
  "scalene", "isosceles", "right",
  "parallelogram", "rectangle", "rhombus", "square", "trapezium", "kite",
] as const;
const SOLID_KINDS = ["box", "cylinder", "cone", "pyramid", "sphere"] as const;
const VENN_TARGETS = [
  "union", "intersection", "aOnly", "bOnly", "cOnly",
  "complementA", "complementB", "complementC", "neither",
] as const;
/** Shading targets that only mean something with a third set. */
const THREE_SET_ONLY_TARGETS: readonly VennTarget[] = ["cOnly", "complementC"];
const VENN_REGION_KEYS_2 = ["a", "b", "ab", "n"] as const;
const VENN_REGION_KEYS_3 = ["a", "b", "c", "ab", "ac", "bc", "abc", "n"] as const;

/** Positive, on-screen-sized dimensions per solid — override with `dims`,
 *  falling back to a nice default per field. Out-of-range rejects the whole
 *  payload rather than clamping: a huge solid is unreadable, not "close". */
function parseSolidDims(solid: SolidKind, raw: unknown): Record<string, number> | null {
  const d: Record<string, unknown> =
    raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const dim = (key: string, fallback: number): number | null => {
    const v = d[key];
    if (v === undefined) return fallback;
    return isNum(v) && v > 0 && v <= 8 ? v : null;
  };
  switch (solid) {
    case "box": {
      const l = dim("l", 4), w = dim("w", 3), h = dim("h", 2);
      return l === null || w === null || h === null ? null : { l, w, h };
    }
    case "cylinder":
    case "cone": {
      const r = dim("r", 2), h = dim("h", 4);
      return r === null || h === null ? null : { r, h };
    }
    case "pyramid": {
      const s = dim("s", 4), h = dim("h", 3);
      return s === null || h === null ? null : { s, h };
    }
    case "sphere": {
      const r = dim("r", 2);
      return r === null ? null : { r };
    }
  }
}

/**
 * Reachability for `curve_sketcher`, per family. Linear and quadratic are the
 * ORIGINAL two checks, unchanged (a quadratic with a = 0 is a line wearing
 * the wrong name; no coefficient over 10 in magnitude) — `curve-sketcher-
 * replay.test.mts` proves every live spec still validates the same way.
 * The five new families each get their own bounds, chosen so the visible
 * sketch stays legible on a 290×290 frame and, for hyperbola/exponential,
 * so growth near the edge of the domain does not run away entirely.
 */
function curveReachable(fn: CurveFn, coefs: readonly number[]): boolean {
  switch (fn) {
    case "linear":
    case "quadratic":
      if (fn === "quadratic" && coefs[0] === 0) return false;
      return coefs.every((k) => Math.abs(k) <= 10);

    case "hyperbola": {
      const [a, q] = coefs;
      return (
        Number.isInteger(a) && a !== 0 && Math.abs(a) <= 6 &&
        Number.isInteger(q) && Math.abs(q) <= 3
      );
    }

    case "exponential": {
      const [a, b, q] = coefs;
      const validB = b === 2 || b === 3 || b === 0.5;
      return (
        Number.isInteger(a) && a !== 0 && Math.abs(a) <= 3 &&
        validB &&
        Number.isInteger(q) && Math.abs(q) <= 3
      );
    }

    case "sine":
    case "cosine": {
      const [a, q] = coefs;
      return (
        Number.isInteger(a) && a !== 0 && Math.abs(a) <= 4 &&
        Number.isInteger(q) && Math.abs(q) <= 3
      );
    }

    case "tangent": {
      const [a, q] = coefs;
      return (
        Number.isInteger(a) && a !== 0 && Math.abs(a) <= 3 &&
        Number.isInteger(q) && Math.abs(q) <= 3
      );
    }
  }
}

export function parseMathWidget(
  name: string,
  props: Record<string, unknown>
): MathWidget | null {
  switch (name) {
    case "pair_plotter": {
      const target = intPair(props.target, 5);
      if (!target) return null;
      return { name, prompt: str(props.prompt, "Plot the point"), target };
    }

    case "product_builder": {
      const { X, Y } = props;
      if (!Array.isArray(X) || !Array.isArray(Y)) return null;
      if (X.length === 0 || Y.length === 0) return null;
      if (![...X, ...Y].every(isNum)) return null;
      // The grid draws one cell per pair; past this it stops being readable on
      // a phone and starts being a wall.
      if (X.length > 4 || Y.length > 4) return null;
      return {
        name,
        prompt: str(props.prompt, "Tap all the pairs of X×Y"),
        X: X as number[],
        Y: Y as number[],
      };
    }

    case "line_drawer": {
      const mode = oneOf(props.mode, ["equation", "points"] as const);
      if (!mode) return null;
      if (mode === "points") {
        if (!Array.isArray(props.through) || props.through.length !== 2) return null;
        const a = intPair(props.through[0], 5);
        const b = intPair(props.through[1], 5);
        if (!a || !b) return null;
        // Two handles on one point is not a line.
        if (a[0] === b[0] && a[1] === b[1]) return null;
        return {
          name, mode: "points",
          prompt: str(props.prompt, "Draw the line through both points"),
          through: [a, b],
        };
      }
      const { m, b } = props;
      if (!isNum(m) || !isNum(b)) return null;
      // Reachability: the handles sit on whole-number lattice points in −5..5,
      // so a fractional intercept or a slope that is neither whole nor the
      // reciprocal of a whole number has no two lattice points to sit on.
      if (!isInt(b) || Math.abs(b) > 5) return null;
      if (!Number.isInteger(m) && !Number.isInteger(1 / m)) return null;
      if (Math.abs(m) > 5) return null;
      return { name, mode: "equation", prompt: str(props.prompt, "Draw the line"), m, b };
    }

    case "circle_builder": {
      const element = oneOf<CircleElement>(props.element, CIRCLE_ELEMENTS);
      if (!element) return null;
      return { name, prompt: str(props.prompt, `Construct a ${element}`), element };
    }

    case "angle_setter": {
      const ask = oneOf(props.ask, ["central", "inscribed"] as const);
      const target = props.target;
      if (!ask || !isNum(target)) return null;
      // Handles snap to 5°, so anything off that grid can never be reached.
      if (target % 5 !== 0) return null;
      if (ask === "central" && (target < 10 || target > 350)) return null;
      if (ask === "inscribed" && (target < 5 || target > 175)) return null;
      return { name, prompt: str(props.prompt, `Set the ${ask} angle to ${target}°`), ask, target };
    }

    case "triangle_ratio": {
      const ask = oneOf(props.ask, ["sin", "cos", "tan"] as const);
      const target = props.target;
      if (!ask || !isNum(target) || target <= 0) return null;
      // sin and cos compare a leg to the hypotenuse, which is always longer,
      // so neither can reach 1 in a triangle that exists.
      if ((ask === "sin" || ask === "cos") && target >= 1) return null;
      if (ask === "tan" && target > 12) return null;
      return {
        name, ask, target,
        prompt: str(props.prompt, `Build a triangle with ${ask} θ = ${target}`),
      };
    }

    case "bar_builder": {
      const ask = oneOf<BarStat>(props.ask, BAR_STATS);
      const target = props.target;
      if (!ask || !isNum(target)) return null;
      const n = isInt(props.n) ? props.n : 5;
      if (n < 3 || n > 8) return null;
      // Bars run 0..10, so a target outside that is unbuildable whatever the
      // student does; mode and range must additionally come out whole.
      if (target < 0 || target > 10) return null;
      if ((ask === "mode" || ask === "range") && !isInt(target)) return null;
      const rawLabels = props.labels;
      let labels: string[] | undefined;
      if (Array.isArray(rawLabels)) {
        const clean = rawLabels.filter((l): l is string => typeof l === "string");
        labels = clean.length === n ? clean : undefined;
      }
      return {
        name, ask, target, n, labels,
        prompt: str(props.prompt, `Build a set with ${ask} ${target}`),
      };
    }

    case "number_line_marker": {
      const mode = oneOf(props.mode, ["points", "interval"] as const);
      const range = intPair(props.range, 20);
      if (!mode || !range || range[0] >= range[1]) return null;
      // Past this the ticks collide and the line is unreadable.
      if (range[1] - range[0] > 24) return null;
      if (mode === "points") {
        if (!Array.isArray(props.targets)) return null;
        const targets = props.targets.filter(
          (t): t is number => isInt(t) && t >= range[0] && t <= range[1]
        );
        // A target the student cannot reach makes the whole set ungradeable,
        // so a single bad entry rejects the payload rather than being dropped.
        if (targets.length !== props.targets.length) return null;
        if (targets.length === 0 || targets.length > 4) return null;
        return { name, mode: "points", prompt: str(props.prompt, "Mark the values"), range, targets };
      }
      const { from, to } = props;
      if (!isInt(from) || !isInt(to) || from > to) return null;
      if (from < range[0] || to > range[1]) return null;
      return {
        name, mode: "interval", range, from, to,
        openFrom: props.openFrom === true,
        openTo: props.openTo === true,
        prompt: str(props.prompt, "Show the interval"),
      };
    }

    case "ratio_balance": {
      const mode = oneOf(props.mode, ["direct", "inverse"] as const);
      const { a, b, c } = props;
      if (!mode || !isNum(a) || !isNum(b) || !isNum(c)) return null;
      if (a <= 0 || b <= 0 || c <= 0) return null;
      const answer = mode === "direct" ? (b * c) / a : (a * b) / c;
      // The pan holds a whole number from 1 to 24. Anything else is a question
      // this instrument cannot express the answer to.
      if (!Number.isInteger(answer) || answer < 1 || answer > 24) return null;
      return { name, mode, a, b, c, prompt: str(props.prompt, "Balance the relationship") };
    }

    case "sample_space": {
      const raw = props.rule;
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
      const r = raw as Record<string, unknown>;
      const kind = oneOf<RuleKind>(r.kind, RULE_KINDS);
      if (!kind) return null;
      const op = r.op === undefined ? "eq" : oneOf<RuleOp>(r.op, RULE_OPS);
      if (!op) return null;
      const value = r.value === undefined ? 0 : r.value;
      if (kind !== "same" && !isNum(value)) return null;
      const rows = isInt(props.rows) ? props.rows : 6;
      const cols = isInt(props.cols) ? props.cols : 6;
      if (rows < 2 || rows > 8 || cols < 2 || cols > 8) return null;
      return {
        name, rows, cols,
        rule: { kind, op, value: value as number },
        prompt: str(props.prompt, "Tap every outcome in the event"),
      };
    }

    case "curve_sketcher": {
      const fn = oneOf<CurveFn>(props.fn, CURVE_FNS);
      if (!fn) return null;
      const coefs = nums(props.coefs, CURVE_COEF_COUNT[fn]);
      if (!coefs) return null;
      if (!curveReachable(fn, coefs)) return null;
      return { name, fn, coefs, prompt: str(props.prompt, "Sketch the curve") };
    }

    case "polygon_builder": {
      const mode = oneOf(props.mode, ["construct", "midsegment", "area"] as const);
      if (!mode) return null;

      if (mode === "construct") {
        const shape = oneOf<PolygonShape>(props.shape, POLYGON_SHAPES);
        if (!shape) return null;
        return {
          name, mode: "construct", shape,
          prompt: str(props.prompt, `Construct a ${shape} on the lattice`),
        };
      }

      if (mode === "midsegment") {
        const raw = props.triangle;
        if (!Array.isArray(raw) || raw.length !== 3) return null;
        const t0 = intPair(raw[0], 6);
        const t1 = intPair(raw[1], 6);
        const t2 = intPair(raw[2], 6);
        if (!t0 || !t1 || !t2) return null;
        // Non-degenerate: the three vertices must not be collinear.
        const area2 = (t1[0] - t0[0]) * (t2[1] - t0[1]) - (t2[0] - t0[0]) * (t1[1] - t0[1]);
        if (area2 === 0) return null;
        const apex = props.apex;
        if (apex !== 0 && apex !== 1 && apex !== 2) return null;
        return {
          name, mode: "midsegment", triangle: [t0, t1, t2], apex,
          prompt: str(props.prompt, "Draw the segment joining the two midpoints"),
        };
      }

      // area: any polygon (3 or 4 free vertices) that hits a target area.
      const shape = oneOf(props.shape, ["triangle", "quadrilateral"] as const);
      const target = props.target;
      if (!shape || !isNum(target)) return null;
      // Pick's theorem: a lattice polygon's area is always a multiple of ½,
      // so anything else can never be built exactly, whatever the student does.
      if (target <= 0 || target > 24 || Math.round(target * 2) !== target * 2) return null;
      return {
        name, mode: "area", shape, target,
        prompt: str(props.prompt, `Build a ${shape} with area ${target}`),
      };
    }

    case "solid_scaler": {
      const solid = oneOf<SolidKind>(props.solid, SOLID_KINDS);
      const ask = oneOf(props.ask, ["volume", "area"] as const);
      const ratio = props.ratio;
      if (!solid || !ask || !isNum(ratio) || ratio <= 0) return null;
      // Reachability: the scale slider only stops at multiples of 0.5 from
      // 0.5 to 4 (FR-1207) — the k this ratio needs must land on one of them.
      const kNeeded = ask === "volume" ? Math.cbrt(ratio) : Math.sqrt(ratio);
      if (kNeeded < 0.5 - 1e-9 || kNeeded > 4 + 1e-9) return null;
      const steps = (kNeeded - 0.5) / 0.5;
      if (Math.abs(steps - Math.round(steps)) > 1e-6) return null;
      const dims = parseSolidDims(solid, props.dims);
      if (!dims) return null;
      return {
        name, solid, dims, ask, ratio,
        prompt: str(
          props.prompt,
          ask === "volume"
            ? `Scale this ${solid} so its volume is ${ratio}× as large`
            : `Scale this ${solid} so its surface area is ${ratio}× as large`
        ),
      };
    }

    case "box_plot_builder": {
      const raw = props.data;
      if (!Array.isArray(raw) || raw.length < 5 || raw.length > 16) return null;
      if (!raw.every(isInt)) return null;
      const data = raw as number[];
      // Keeps the drawn number line readable; whole numbers ensure the book's
      // rank formula lands every quartile on the widget's 0.25 snap grid.
      if (data.some((v) => Math.abs(v) > 500)) return null;
      return { name, data, prompt: str(props.prompt, "Build the box plot for this data set") };
    }

    case "venn_builder": {
      const sets = props.sets === 2 || props.sets === 3 ? props.sets : null;
      if (!sets) return null;
      const rawLabels = props.labels;
      if (!Array.isArray(rawLabels) || rawLabels.length !== sets) return null;
      if (!rawLabels.every((l) => typeof l === "string" && l.trim().length > 0)) return null;
      const labels = rawLabels as string[];

      const mode = oneOf(props.mode, ["shade", "counts"] as const);
      if (!mode) return null;

      if (mode === "shade") {
        const target = oneOf<VennTarget>(props.target, VENN_TARGETS);
        if (!target) return null;
        // Reachability: a target that names a third set means nothing on a
        // 2-set diagram — there is no C to be outside of, or on its own.
        if (sets === 2 && THREE_SET_ONLY_TARGETS.includes(target)) return null;
        return {
          name, mode: "shade", sets, labels, target,
          prompt: str(props.prompt, "Shade the named region"),
        };
      }

      const rawRegions = props.regions;
      if (rawRegions === null || typeof rawRegions !== "object" || Array.isArray(rawRegions)) return null;
      const regionKeys = sets === 2 ? VENN_REGION_KEYS_2 : VENN_REGION_KEYS_3;
      const regions: VennRegionCounts = {};
      for (const k of regionKeys) {
        const v = (rawRegions as Record<string, unknown>)[k];
        if (!isInt(v) || v < 0 || v > 999) return null;
        regions[k] = v;
      }
      // Reachability: a stated total the regions cannot possibly add up to is
      // a target no arrangement of non-negative counts can satisfy.
      const total = props.total;
      if (total !== undefined) {
        if (!isInt(total) || total < 0) return null;
        const sum = regionKeys.reduce((s, k) => s + (regions[k] ?? 0), 0);
        if (sum !== total) return null;
      }
      let clues: { a?: number; b?: number; c?: number } | undefined;
      const rawClues = props.clues;
      if (rawClues !== null && typeof rawClues === "object" && !Array.isArray(rawClues)) {
        const rc = rawClues as Record<string, unknown>;
        const c: { a?: number; b?: number; c?: number } = {};
        for (const k of ["a", "b", "c"] as const) {
          if (rc[k] === undefined) continue;
          if (!isInt(rc[k]) || (rc[k] as number) < 0) return null;
          c[k] = rc[k] as number;
        }
        clues = c;
      }
      return {
        name, mode: "counts", sets, labels, total, regions, clues,
        prompt: str(props.prompt, "Fill in every region, including neither"),
      };
    }

    case "area_model": {
      const mode = oneOf(props.mode, ["expand", "factor"] as const);
      const { a, b } = props;
      if (!mode || !isInt(a) || !isInt(b)) return null;
      // Reachability: both zero is just x², which teaches nothing this widget
      // is for; past ±4 the grid the tiles are placed on runs out of room.
      if (a === 0 && b === 0) return null;
      if (Math.abs(a) > 4 || Math.abs(b) > 4) return null;
      return {
        name, mode, a, b,
        prompt: str(
          props.prompt,
          mode === "expand"
            ? `Expand (x ${a >= 0 ? "+" : "−"} ${Math.abs(a)})(x ${b >= 0 ? "+" : "−"} ${Math.abs(b)}) with the tiles`
            : `Factorise x² ${a + b >= 0 ? "+" : "−"} ${Math.abs(a + b)}x ${a * b >= 0 ? "+" : "−"} ${Math.abs(a * b)} by building its rectangle`
        ),
      };
    }

    default:
      return null;
  }
}

/**
 * The objective an INLINE widget is teaching, as the tutor named it.
 *
 * A widget the model composes mid-stream has to be attributable to something
 * or it cannot become a question (ADR-0009 §3), and the lesson usually covers
 * several objectives — so guessing "the first one" would file evidence against
 * the wrong skill and move the wrong mastery estimate. The tutor knows which
 * objective the beat is about; it says so, or the widget stays a teaching aid
 * and moves nothing.
 *
 * Returning null is therefore a normal outcome, not an error.
 */
export function inlineWidgetLo(props: Record<string, unknown>): string | null {
  const lo = props.lo;
  return typeof lo === "string" && /^lo:[a-z0-9-]{1,60}$/i.test(lo) ? lo : null;
}

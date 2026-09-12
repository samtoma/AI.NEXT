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
export type CurveFn = "linear" | "quadratic";

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
  | { name: "curve_sketcher"; prompt: string; fn: CurveFn; coefs: number[] };

/** Every maths widget name the dispatcher answers to. */
export const MATH_WIDGETS = [
  "pair_plotter", "product_builder", "line_drawer", "circle_builder",
  "angle_setter", "triangle_ratio", "bar_builder", "number_line_marker",
  "ratio_balance", "sample_space", "curve_sketcher",
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
const CURVE_FNS = ["linear", "quadratic"] as const;

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
      const coefs = nums(props.coefs, fn === "linear" ? 2 : 3);
      if (!coefs) return null;
      // A quadratic with a = 0 is a line wearing the wrong name, and the
      // "opens upwards/downwards" diagnosis would be nonsense about it.
      if (fn === "quadratic" && coefs[0] === 0) return null;
      if (coefs.some((k) => Math.abs(k) > 10)) return null;
      return { name, fn, coefs, prompt: str(props.prompt, "Sketch the curve") };
    }

    default:
      return null;
  }
}

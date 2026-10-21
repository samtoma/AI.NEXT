/**
 * THE COORDINATE GRID A PLANE WIDGET IS DRAWN ON (pair_plotter, line_drawer,
 * curve_sketcher) — an optional `grid` field on the spec:
 *
 *   {"grid": {"x": [-1, 5], "y": [-2, 9], "step": 1}}
 *   {"grid": {"x": [0, 60], "y": [0, 20], "step": [5, 2]}}     per-axis steps
 *   {"grid": {"x": [-4, 4], "y": [-4, 4], "step": 0.5}}        half squares
 *
 * Absent, every widget is exactly what it was: −5..5 in whole steps. The book
 * asks for more than that — a point at (3, 5/2), the line y = 2½, a parabola
 * on [−1, 5] reaching 8, a frequency polygon whose axes count in fives — and
 * the fixed square made each of those a question no student could answer
 * (Tamer, 2026-10-21: "implement those changes").
 *
 * A tap or a handle lands on a grid point (a multiple of the step inside the
 * range), so every answer is reachable exactly when it sits on the grid. At
 * most MAX_STEPS steps per axis: past that a grid point is smaller than a
 * finger on an iPad and the widget stops being an instrument.
 *
 * Pure, so the payload parser and `node --test` share it.
 */

export interface Grid {
  x: [number, number];
  y: [number, number];
  /** the step along x and along y */
  sx: number;
  sy: number;
}

export const DEFAULT_GRID: Grid = { x: [-5, 5], y: [-5, 5], sx: 1, sy: 1 };
export const MAX_STEPS = 16;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const EPS = 1e-9;

/** Is `v` a whole number of `step`s from 0? (−1.5 on a 0.5 grid: yes.) */
export function onStep(v: number, step: number): boolean {
  const k = v / step;
  return Math.abs(k - Math.round(k)) < 1e-7;
}

/**
 * The spec's grid: DEFAULT_GRID when the field is absent, null when it is
 * present and malformed (the widget is then refused, never drawn wrong).
 */
export function parseGrid(raw: unknown): Grid | null {
  if (raw === undefined || raw === null) return DEFAULT_GRID;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const g = raw as Record<string, unknown>;
  const range = (v: unknown): [number, number] | null =>
    Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]) && v[0] < v[1] ? [v[0], v[1]] : null;
  const x = range(g.x);
  const y = range(g.y);
  const step = g.step ?? 1;
  const [sx, sy] = Array.isArray(step) ? step : [step, step];
  if (!x || !y || !num(sx) || !num(sy) || sx <= 0 || sy <= 0) return null;
  // the ends sit on the grid, and the grid is coarse enough to tap
  if (!onStep(x[0], sx) || !onStep(x[1], sx) || !onStep(y[0], sy) || !onStep(y[1], sy)) return null;
  if ((x[1] - x[0]) / sx > MAX_STEPS + EPS || (y[1] - y[0]) / sy > MAX_STEPS + EPS) return null;
  return { x, y, sx, sy };
}

export const isDefaultGrid = (g: Grid) =>
  g.x[0] === -5 && g.x[1] === 5 && g.y[0] === -5 && g.y[1] === 5 && g.sx === 1 && g.sy === 1;

/** Is [x, y] a point a student can tap on this grid? */
export function onGrid(g: Grid, [x, y]: readonly [number, number]): boolean {
  return (
    x >= g.x[0] - EPS && x <= g.x[1] + EPS && y >= g.y[0] - EPS && y <= g.y[1] + EPS &&
    onStep(x, g.sx) && onStep(y, g.sy)
  );
}

/** The nearest grid point, inside the range. */
export function snapToGrid(g: Grid, x: number, y: number): [number, number] {
  const s = (v: number, step: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, Math.round(Math.round(v / step) * step * 1e6) / 1e6));
  return [s(x, g.sx, g.x[0], g.x[1]), s(y, g.sy, g.y[0], g.y[1])];
}

/** Every grid value along one axis, low to high. */
export function gridValues(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil(lo / step - EPS); k * step <= hi + EPS; k++) out.push(Math.round(k * step * 1e6) / 1e6);
  return out;
}

/**
 * Can a line y = m·x + b be drawn on this grid by two handles? Yes when at
 * least two grid points lie on it (the handles sit on grid points).
 */
export function lineReachable(g: Grid, m: number, b: number): boolean {
  let n = 0;
  for (const x of gridValues(g.x[0], g.x[1], g.sx)) {
    const y = m * x + b;
    if (y >= g.y[0] - EPS && y <= g.y[1] + EPS && onStep(y, g.sy)) n++;
    if (n >= 2) return true;
  }
  return false;
}

/** Tick labels to print along an axis: every grid value, or every other one when there are more than 11. */
export function labelValues(lo: number, hi: number, step: number): number[] {
  const all = gridValues(lo, hi, step).filter((v) => Math.abs(v) > EPS);
  return all.length > 11 ? all.filter((v) => onStep(v, step * 2)) : all;
}

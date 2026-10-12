/**
 * Where `angle_setter` OPENS, and the one reading of its three points (the
 * arc C faces, and the inscribed angle, half of it).
 *
 * The widget used to open at A 180°, B 250°, C 60° for every question: arc 70°,
 * inscribed angle 35°. A question asking for exactly that — q:geo2-2-2:w002
 * (inscribed 35°), and the tutor's own documented example — therefore opened
 * already solved, and a student who pressed Check without touching anything
 * was marked right (consistency review 2026-09-27). The start is now chosen per
 * question: the old one whenever it is not a meaningful answer, and otherwise
 * the first of a few nearby openings that is neither the target nor a value
 * the widget would diagnose — the arc given as the angle (or the reverse), or
 * the other arc — so an untouched widget is never marked right and never
 * produces a diagnosis the student did not make.
 *
 * Pure (tested in `lib/widget-angle-setter-start.test.mts`); `AngleSetter.tsx`
 * reads both functions.
 */

export type AngleAsk = "central" | "inscribed";
export type AnglePoints = { A: number; B: number; C: number };

const norm = (d: number) => ((d % 360) + 360) % 360;

/** The arc AB that C faces (the one it does not stand on), and ∠ACB = half of it. */
export function angleReadings(deg: AnglePoints): { facing: number; inscribed: number; cOnCcw: boolean } {
  const ccw = norm(deg.B - deg.A);
  const cOnCcw = norm(deg.C - deg.A) < ccw;
  const facing = cOnCcw ? 360 - ccw : ccw;
  return { facing, inscribed: facing / 2, cOnCcw };
}

/** The opening the widget always had, then the alternatives, B moved along the circle. */
const OPENINGS: readonly AnglePoints[] = [250, 270, 230, 290, 210, 310].map((B) => ({ A: 180, B, C: 60 }));

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Would an untouched widget at `deg` be marked right, or diagnosed? */
export function startsOnAnAnswer(deg: AnglePoints, ask: AngleAsk, target: number): boolean {
  const r = angleReadings(deg);
  const reading = ask === "central" ? r.facing : r.inscribed;
  const confused = ask === "central" ? r.inscribed : r.facing; // arc-given-as-angle / angle-given-as-arc
  return same(reading, target) || same(confused, target) || same(360 - reading, target);
}

/** Where to open for this question: never on its answer, nor on a named mistake. */
export function angleSetterStart(ask: AngleAsk, target: number): AnglePoints {
  return OPENINGS.find((d) => !startsOnAnAnswer(d, ask, target)) ?? OPENINGS[0];
}

/**
 * The mastery ramp for the MVP 1.0 comparison build (Noor design system v0.2).
 *
 * FIVE DISCRETE STEPS, not a continuous gradient, because that is what the
 * handoff's tokens actually are — `--mastery-0-not-started` through
 * `--mastery-4-mastered`. A student reading a bar is asking "which band am I
 * in?", and a continuously interpolated hue answers a question nobody asked
 * while making two adjacent topics look different when they are in the same
 * band.
 *
 * THE RAMP CARRIES NO RED. This replaced a burnt-sienna → ochre → viridian
 * scale, and the change is a product requirement rather than a taste call: the
 * Noor system forbids red and coral outright — "wrong answers grey out and
 * invite a retry" — because the persona's stated fear is looking stupid, and a
 * red progress bar is what that fear looks like on a screen. Not-started is
 * therefore the neutral inactive fill, and the lowest LIT step is amber: a
 * student who has started something is never shown a warning colour for having
 * started it.
 *
 * Colour is never the only carrier: every caller pairs the bar with the
 * percentage and the band name, which is what keeps the scale legible in
 * greyscale, under CVD, and to a screen reader.
 *
 * This file is comparison-build code. The frozen baseline keeps its own ramp
 * on `main` (constitution v2.0.0 Principle XI) and never receives this commit.
 */

export type MasteryBand =
  | "not started"
  | "attempted"
  | "familiar"
  | "proficient"
  | "mastered";

type Step = { readonly band: MasteryBand; readonly hex: string };

/** tokens.css --mastery-0-not-started … --mastery-4-mastered, verbatim. */
const STEPS: readonly Step[] = [
  { band: "not started", hex: "#EFEEF6" },
  { band: "attempted", hex: "#F0A22F" },
  { band: "familiar", hex: "#D9A75A" },
  { band: "proficient", hex: "#8FB98A" },
  { band: "mastered", hex: "#2F9E8F" },
] as const;

/**
 * Band boundaries on the BKT posterior.
 *
 * 0.35 / 0.55 / 0.75 are the same cuts the dashboard and the spine surface
 * read, so the two can never disagree about what "proficient" means. They sit
 * above the 0.30 cold-start prior deliberately: a learner who has answered
 * nothing must not appear one step up the ramp for free.
 */
/**
 * The floor of the top band: the BKT posterior at which an objective counts as
 * **mastered**.
 *
 * Exported because the console's overviews need "how many objectives is this
 * cohort at or above the mastery threshold on" (contracts/admin.md §8, research
 * A3) and the answer must be the SAME number the student's own dashboard paints
 * teal. A console that used 0.8 while the product used 0.75 would report a
 * cohort falling short of a bar the product never showed them.
 *
 * It is 0.75, from the band boundaries above, and not the 0.80 that appears in
 * some planning prose. `lib/bkt.ts` holds the model, not the bands — it has
 * `MIN_SCORE`/`MAX_SCORE` clamps and no threshold — so the band scale is the
 * only place this number has ever been defined, and it lives here.
 */
export const MASTERY_THRESHOLD = 0.75;

function stepIndex(score: number, started: boolean): number {
  if (!started) return 0;
  const s = Math.max(0, Math.min(1, score));
  if (s < 0.35) return 1;
  if (s < 0.55) return 2;
  if (s < MASTERY_THRESHOLD) return 3;
  return 4;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * `started` defaults to true so every existing single-argument call site keeps
 * meaning what it meant: those callers only ever render a learner who has a
 * score. Pass `false` explicitly for an untouched topic — that is the one case
 * the score alone cannot tell you, because a cold-start 0.30 prior and a
 * genuinely-practised 0.30 are the same number and must not look the same.
 */
export function masteryStep(score: number, started = true): Step {
  return STEPS[stepIndex(score, started)];
}

export function masteryRgb(
  score: number,
  started = true
): [number, number, number] {
  return hexToRgb(masteryStep(score, started).hex);
}

export function masteryColor(score: number, alpha = 1, started = true): string {
  const [r, g, b] = masteryRgb(score, started);
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

/**
 * The band name, which doubles as the non-colour signal.
 *
 * The old scale said "weak". The handoff forbids "you're behind" framing
 * outright, and the whole point of naming a band is to tell her where she is,
 * not to grade her for being there — so the lowest lit band is "attempted",
 * which is a statement of fact about the evidence rather than a verdict.
 */
export function masteryLabel(score: number, started = true): MasteryBand {
  return masteryStep(score, started).band;
}

/** The legend, in ramp order — render it wherever the ramp is shown. */
export const MASTERY_LEGEND: readonly Step[] = STEPS;

export const pct = (score: number) => `${Math.round(score * 100)}%`;

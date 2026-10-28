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

type Step = {
  readonly band: MasteryBand;
  /** The custom property that holds this step's colour (`globals.css`). */
  readonly token: `--mastery-${0 | 1 | 2 | 3 | 4}`;
  /** `var(--mastery-N)` — what every caller paints with. */
  readonly color: string;
};

/**
 * THE RAMP IS TOKENS, NOT HEX (constitution XII; review 2026-09-23, F21).
 *
 * This table used to carry the five hex values verbatim from `tokens.css`,
 * which made `lib/mastery.ts` a second copy of the ramp: the dashboard and the
 * home painted from here while the report card and the practice loop read
 * `var(--m-*)` from the stylesheet, and the two disagreed the moment a skin
 * redefined one of them. Every screen now paints with `var(--mastery-N)`, so
 * the stylesheet is the only place a ramp colour is written down.
 *
 * `var()` is safe everywhere a caller uses it: inline `style` on HTML, and the
 * `style` prop (not a presentation attribute) on SVG.
 */
const step = (n: 0 | 1 | 2 | 3 | 4, band: MasteryBand): Step => ({
  band,
  token: `--mastery-${n}`,
  color: `var(--mastery-${n})`,
});

const STEPS: readonly Step[] = [
  step(0, "not started"),
  step(1, "attempted"),
  step(2, "familiar"),
  step(3, "proficient"),
  step(4, "mastered"),
] as const;

/**
 * Band boundaries on the BKT posterior.
 *
 * 0.40 / 0.75 / 0.90 since 2026-10-28 ("One mastery rule", M7 — Tamer; the
 * gates that read them are Samuel's, ADR-0020). They were 0.35 / 0.55 / 0.75,
 * under which ONE right answer from the 0.30 prior (0.69) already read
 * "Almost there" and two (0.92) "Nailed it". They still sit above the 0.30
 * cold-start prior: a learner who has answered nothing must not appear one
 * step up the ramp for free.
 *
 * These are the ONLY copy of the cuts. Every gate is written as a stage on
 * this ramp (lib/progression.ts), so moving a cut here moves the gates with it
 * and the screens and the rules can never disagree about a word.
 */
export const BAND_CUTS = { gettingThere: 0.4, almostThere: 0.75, nailedIt: 0.9 } as const;

/**
 * The floor of the top band: the BKT posterior at which an objective counts as
 * **mastered** ("Nailed it").
 *
 * Exported because the console's overviews need "how many objectives is this
 * cohort at or above the mastery threshold on" (contracts/admin.md §8, research
 * A3) and the answer must be the SAME number the student's own dashboard paints
 * teal. A console that used another number than the product would report a
 * cohort falling short of a bar the product never showed them.
 *
 * `lib/bkt.ts` holds the model, not the bands — it has `MIN_SCORE`/`MAX_SCORE`
 * clamps and no threshold — so the band scale is the only place this number is
 * defined, and it lives here.
 */
export const MASTERY_THRESHOLD = BAND_CUTS.nailedIt;

function stepIndex(score: number, started: boolean): number {
  if (!started) return 0;
  const s = Math.max(0, Math.min(1, score));
  if (s < BAND_CUTS.gettingThere) return 1;
  if (s < BAND_CUTS.almostThere) return 2;
  if (s < MASTERY_THRESHOLD) return 3;
  return 4;
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

/**
 * The ramp colour for a score, as a CSS value.
 *
 * `alpha < 1` mixes the token toward transparent with `color-mix()` rather
 * than decomposing it into channels, because a token has no channels to read
 * until the browser resolves it — which is the whole point of it being a token.
 */
export function masteryColor(score: number, alpha = 1, started = true): string {
  const { color } = masteryStep(score, started);
  if (alpha >= 1) return color;
  const pctAlpha = Math.round(Math.max(0, alpha) * 100);
  return `color-mix(in srgb, ${color} ${pctAlpha}%, transparent)`;
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

/**
 * The stage index (0-4) behind `masteryStep`, named.
 *
 * The 4-segment fill needs the ORDINAL, not the Step, and every caller was
 * reconstructing it as `MASTERY_LEGEND.indexOf(masteryStep(s))` — one lookup
 * too many, and one more place for the two to drift. Stage 0 is "not started"
 * and lights NO segment; stages 1-4 light that many, each taking its colour
 * from `STEPS[i + 1]`. That offset is the whole reason a "5-step ramp" and a
 * "4-segment fill" are the same object: never render five segments, and never
 * index the fill by the stage.
 */
export function masteryStage(score: number, started = true): 0 | 1 | 2 | 3 | 4 {
  return stepIndex(score, started) as 0 | 1 | 2 | 3 | 4;
}

/**
 * The student-facing phrase for a stage — the ONLY vocabulary the skill map
 * is allowed to put next to a fill.
 *
 * Deliberately not `MasteryBand`. The band names ("attempted", "proficient")
 * are the internal, legend-and-dashboard vocabulary: accurate, assessor's
 * English, and read on a card as a verdict being handed down. These say the
 * same five things in the voice the rest of the Play surfaces use, so the
 * skill map never becomes the one screen that grades her. They carry no
 * number and no letter by construction — there is nowhere in this array to
 * put one.
 */
export const MASTERY_PHRASE: readonly string[] = [
  "Not started",
  "Just started",
  "Getting there",
  "Almost there",
  "Nailed it",
] as const;

export const masteryPhrase = (stage: 0 | 1 | 2 | 3 | 4) => MASTERY_PHRASE[stage];

/** The legend, in ramp order — render it wherever the ramp is shown. */
export const MASTERY_LEGEND: readonly Step[] = STEPS;

export const pct = (score: number) => `${Math.round(score * 100)}%`;

/**
 * ONE LESSON LEVEL ("One mastery rule" M1, 2026-10-28).
 *
 * A lesson's (or unit's) stage from its objectives' stored scores: the average
 * score, an untried objective counting as 0, banded on the ramp above. Every
 * surface that shows a level for more than one objective — the check-in card,
 * the skill map's lesson pills, the dashboard, the lesson report — calls this
 * and nothing else.
 *
 * Before, the card averaged scores while the skill map rounded the average of
 * STAGES, and the two disagreed: 0.98 / 0.40 / 0.40 / 0.40 was "Getting there"
 * on the card and "Almost there" on the map. Untried counts as 0 so that two
 * objectives at the top cannot make a four-objective lesson look finished.
 *
 * `scores` are stored scores, 0 for "no mastery row" (an attempted objective
 * never reads 0 — BKT clamps at `MIN_SCORE`). Nothing attempted, or nothing
 * to attempt, is stage 0.
 */
export function lessonLevel(scores: readonly number[]): 0 | 1 | 2 | 3 | 4 {
  if (scores.length === 0 || !scores.some((s) => s > 0)) return 0;
  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return masteryStage(avg, true);
}

/** How many of these objectives have no answer yet — shown beside every lesson level. */
export const untriedCount = (scores: readonly number[]) => scores.filter((s) => !(s > 0)).length;

/**
 * NAILED IT NEEDS ONE HARDER QUESTION ("One mastery rule" M6 part 2).
 *
 * The score alone cannot tell a run of easy questions from real mastery, so
 * reaching "Nailed it" also needs at least one right answer at the hardest tier
 * the objective HAS, capped at standard: standard or advanced where the bank
 * has them, basic where it has nothing harder (or no bank questions at all —
 * then only tutor-built tasks, which count as basic, can practise it). Without
 * that fallback a thin bank would hold a student below the top for good.
 *
 * Applied where the score is written (/api/attempts), so the stored number is
 * the whole truth and every reader keeps banding on the score alone. Without
 * the evidence the score stops just under the cut; with it, BKT carries on.
 */
export const NAILED_IT_CAP = Math.round((MASTERY_THRESHOLD - 0.01) * 100) / 100;

export function capWithoutEvidence(score: number, hasEvidence: boolean, prior: number): number {
  // The cap stops a score RISING past the cut; it never pulls one down. A score
  // already above it (stored before this rule) keeps its place, so a right
  // answer can never lower a level.
  return hasEvidence ? score : Math.min(score, Math.max(NAILED_IT_CAP, prior));
}

/**
 * The report's level ("One mastery rule" M2): the lesson level from the stored
 * scores now, and which objectives moved a stage since the sitting began.
 * Pure — the route reads the scores (now, and as of the sitting's start, from
 * the bitemporal table) and hands them here.
 */
export function reportMastery(
  los: readonly { label: string; now: number; atStart: number }[],
  answered: number
): {
  stage: 0 | 1 | 2 | 3 | 4;
  untried: number;
  answered: number;
  moved: { label: string; from: 0 | 1 | 2 | 3 | 4; to: 0 | 1 | 2 | 3 | 4 }[];
} {
  const now = los.map((l) => l.now);
  return {
    stage: lessonLevel(now),
    untried: untriedCount(now),
    answered,
    moved: los
      .map((l) => ({
        label: l.label,
        from: masteryStage(l.atStart, l.atStart > 0),
        to: masteryStage(l.now, l.now > 0),
      }))
      .filter((m) => m.from !== m.to),
  };
}

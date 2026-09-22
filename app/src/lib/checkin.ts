/**
 * Derivation for the /student check-in card (Noor Play, "the check-in
 * anatomy" brief), plus the mastery-stage copy shared by the learn-mode
 * tutor prompt, its hidden session-starter message, and the comprehension
 * grader (see `learnOpeningFrame` / `learnAutoStartLine` below). Pure
 * functions with no server-only imports — deliberately, so the same code
 * runs in the "use client" lesson surface (LessonSession.tsx) and on the
 * server (lib/lesson.ts, api/understanding/route.ts) without either one
 * drifting out of sync with the other's wording.
 *
 * `recommendationReason` is the one exception: it must never reach a client
 * prop (see docs/design/handoffs/noor-play), so the caller logs it and stops
 * there rather than passing it down.
 */
import { MASTERY_LEGEND, masteryStep } from "@/lib/mastery";
import { addressForms, type Gender } from "@/lib/address";
import type { LessonLo } from "@/lib/types";

export type Recommendation = "reteach" | "refresh" | null;

export interface CheckInTopic {
  masteryStage: 0 | 1 | 2 | 3 | 4;
  weakestSubskill: string | null;
}

/** Topic-level stage: the average LO score, banded the same way the
 *  dashboard bands a single LO. `started` is "has any LO been attempted" —
 *  a topic nobody has touched must land on stage 0, not the cold-start prior. */
export function deriveMasteryStage(los: readonly LessonLo[]): 0 | 1 | 2 | 3 | 4 {
  const started = los.some((l) => l.mastery > 0);
  if (!started || los.length === 0) return 0;
  const avg = los.reduce((sum, l) => sum + l.mastery, 0) / los.length;
  return MASTERY_LEGEND.indexOf(masteryStep(avg, true)) as 0 | 1 | 2 | 3 | 4;
}

/** The one named gap: the weakest LO among those actually attempted, or
 *  null when nothing has been attempted yet (there is no "weakest" of
 *  nothing) or every attempted LO is already at the top band. */
export function deriveWeakestSubskill(
  los: readonly LessonLo[]
): { label: string; mastery: number } | null {
  const attempted = los.filter((l) => l.mastery > 0);
  if (attempted.length === 0) return null;
  const weakest = attempted.reduce((a, b) => (b.mastery < a.mastery ? b : a));
  if (masteryStep(weakest.mastery, true).band === "mastered") return null;
  return { label: weakest.label, mastery: weakest.mastery };
}

/** Stage 0-1 (never started / just started) → the full re-teach.
 *  Stage 2-3 (familiar / proficient) → a quick refresh is enough.
 *  Stage 4 (mastered) → no default nudge; the student picks freely. */
export function deriveRecommendation(stage: 0 | 1 | 2 | 3 | 4): Recommendation {
  if (stage <= 1) return "reteach";
  if (stage <= 3) return "refresh";
  return null;
}

/** Minutes, from the topic's actual content — never a flat placeholder.
 *  Reteach walks every LO interactively (~3 min/LO, floor 6). Refresh is a
 *  few quick checks plus one challenge question, capped at what the bank
 *  actually has (~1 min/check, +2 for the challenge). */
export function estimateMinutes(
  los: readonly LessonLo[],
  questionCount: number
): { reteach: number; refresh: number } {
  const reteach = Math.max(6, Math.round(los.length * 3));
  const quickChecks = Math.min(3, Math.max(1, questionCount));
  const refresh = quickChecks + 2;
  return { reteach, refresh };
}

/** Internal-only explanation of the recommendation, for the server log —
 *  never render this. */
export function buildRecommendationReason(
  stage: 0 | 1 | 2 | 3 | 4,
  weakest: { label: string; mastery: number } | null,
  recommendation: Recommendation
): string {
  const band = MASTERY_LEGEND[stage].band;
  const gap = weakest ? `; weakest: "${weakest.label}" (${Math.round(weakest.mastery * 100)}%)` : "";
  return `stage=${stage} (${band})${gap} -> ${recommendation ?? "no recommendation"}`;
}

/**
 * The learn-mode opening premise, keyed by the topic's mastery stage — the
 * SAME banding the check-in card and the mastery ramp render, so the
 * tutor's self-description (lib/lesson.ts `learnPrompt`), its hidden
 * session-starter (`learnAutoStartLine` below, LessonSession.tsx) and the
 * comprehension grader (api/understanding/route.ts) never contradict what
 * the student already sees on screen or what they have actually done before.
 *
 * This replaces a single hardcoded "understood NOTHING" premise that used
 * to fire for every learn-mode session alike — including a lesson never
 * attempted, where there was nothing to have failed to understand. The
 * mastery ramp's own product rule applies here too ("the persona's stated
 * fear is looking stupid"): no stage's framing casts the student as having
 * failed, only as being at a particular, ordinary point on the ramp.
 *
 * The copy is deliberately scrubbed of any deficit vocabulary — "wrong",
 * "gap", "zero", "catch up", "fix", "rebuild" — even in negated form ("there
 * is nothing to have gotten WRONG"). An earlier version tried the negated
 * phrasing and the model still opened with "No worries — let's rebuild it
 * from the very first brick": naming the concept to rule it out still seeds
 * it. Each branch instead states only what IS true, in upbeat terms, and
 * anchors the tone with a concrete example greeting rather than an abstract
 * instruction — an explicit "never apologize" rule is not trusted here for
 * the same reason.
 */
export function learnOpeningFrame(
  stage: 0 | 1 | 2 | 3 | 4,
  firstName: string,
  /** how this student is addressed (FR-2602). Omitted = the either-correct
   *  register; FR-2605 forbids the masculine as a fallback, so there is no
   *  branch here that produces it by default. */
  gender: Gender = null
): { premise: string; job: string } {
  const a = addressForms(gender, firstName);
  switch (stage) {
    case 0:
      return {
        premise: `this is a brand-new topic for ${a.them} — ${a.their} very first look at it`,
        job: `open with genuine excitement for something new — energetic and curious, like handing ${a.them} a new level to unlock (e.g. "${firstName}! New topic today — let's dive in 🚀") — then teach it fresh from the ground up`,
      };
    case 1:
      return {
        premise: `${a.they}${a.hasContr} had a first go at this one and it's still taking shape`,
        job: `keep the energy high and build confidently on what ${a.they} already ${a.has}, like leveling up rather than starting over (e.g. "${firstName}! Let's build on what you've got — round two 💪") — treat what ${a.they}${a.hasContr} done so far as real progress worth celebrating`,
      };
    case 2:
      return {
        premise: `${a.they}${a.hasContr} got a good feel for this and want${a.s} to go through it again`,
        job: "add depth and new connections, playful and curious throughout — not a repeat of the basics",
      };
    default:
      return {
        premise: `${a.they} already handle${a.s} this well and want${a.s} the full walk-through anyway`,
        job: `treat ${a.them} like someone who already gets it — go deeper, add richer challenges, and keep the energy up rather than re-teaching the basics`,
      };
  }
}

/**
 * The HIDDEN first "student" message that kicks off a learn-mode session
 * (LessonSession.tsx passes this as `autoStart`/`autoStartHidden` — the
 * model sees it as if the student typed it, but it never renders in the
 * transcript). It used to hardcode "I understood NOTHING from today's
 * lesson... teach me from zero" for every session — including a lesson the
 * student had never attempted — which primed exactly the apologetic
 * "no worries, let's rebuild it" tone `learnOpeningFrame` was fixed to
 * avoid: the model was reacting to what it believed the STUDENT had just
 * told it, independent of the tutor's own system prompt. Same mastery-stage
 * bands, same rule: state only what's true, never a claim of having failed.
 */
export function learnAutoStartLine(stage: 0 | 1 | 2 | 3 | 4): string {
  switch (stage) {
    case 0:
      return "Start now. This is a brand-new lesson for me — I haven't seen it before. Let's dive in!";
    case 1:
      return "Start now. I had a first go at this lesson already but it hasn't clicked yet. Let's build on it.";
    case 2:
      return "Start now. I've got a decent feel for this lesson already — let's go through it again.";
    default:
      return "Start now. I already handle this lesson well, but let's do the full walk-through anyway.";
  }
}

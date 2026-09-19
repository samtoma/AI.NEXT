/**
 * Derivation for the /student check-in card (Noor Play, "the check-in
 * anatomy" brief). Pure functions, server-side only: `recommendationReason`
 * must never reach a client prop (see docs/design/handoffs/noor-play), so
 * the caller logs it and stops there rather than passing it down.
 */
import { MASTERY_LEGEND, masteryStep } from "@/lib/mastery";
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

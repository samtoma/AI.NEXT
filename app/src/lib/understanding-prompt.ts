/**
 * The comprehension grader's prompt, as a pure builder the capture harness can
 * render.
 *
 * It was built inline in `api/understanding/route.ts`, in the middle of a route
 * handler that authenticates, opens two units of work and spawns a CLI — so
 * `scripts/capture-prompts.mts` could not reach it, and a change to its wording
 * could not be proved scoped by constitution IX's mechanism (seams §8). Nothing
 * about the text changes by moving it; the route keeps the model call, the
 * retries, the ledger and the row, and hands this function the facts.
 *
 * `understanding-prompt.test.mts` holds the pre-refactor strings verbatim and
 * asserts this file reproduces them, so "byte-identical" is a test rather than
 * a claim in a commit message.
 *
 * The transcript formatting lives here too, for the same reason: it is prompt
 * text, and a harness that captured the instructions but not the shape of the
 * transcript around them would be capturing most of the payload.
 */

import { deriveMasteryStage, learnOpeningFrame } from "@/lib/checkin";
import { gradeLabel } from "@/lib/profile";
import { addressForms, type Gender } from "@/lib/address";
import type { LessonLo, LessonMode } from "@/lib/types";

/** One transcript line as the surface sends it. */
export interface UnderstandingMsg {
  role: "user" | "assistant" | "note";
  text: string;
}

export interface UnderstandingPromptInput {
  mode: LessonMode;
  /** the lesson's objectives, in teaching order — mastery drives the premise */
  los: readonly LessonLo[];
  studentName: string;
  grade: string;
  lessonRef: string;
  title: string;
  moduleLabel: string;
  transcript: readonly UnderstandingMsg[];
  /**
   * The student's own register (FR-2602). It reaches the grader for ONE
   * reason: two of its sentences refer to the student in the third person, and
   * a grader told "he" about a girl is the same defect as a tutor saying it. It
   * never touches a band, a score or a verdict (FR-2603) — the GRADING RULES
   * below are identical in all three registers.
   */
  gender?: Gender;
}

export const UNDERSTANDING_SYSTEM_PROMPT = `You are the honest comprehension grader of Noor, an adaptive math tutor. You rate how well the student actually understood a lesson, based ONLY on the session transcript. You output STRICT JSON and nothing else — no markdown fences, no prose.`;

/** The transcript as the grader reads it. */
export function understandingTranscript(
  transcript: readonly UnderstandingMsg[]
): string {
  return transcript
    .map((m) =>
      m.role === "user"
        ? `Student: ${m.text}`
        : m.role === "assistant"
          ? `Tutor: ${m.text}`
          : `[live event] ${m.text}`
    )
    .join("\n");
}

/**
 * The grading prompt for one rating.
 *
 * `sessionDesc` reuses the same mastery-stage premise the learn-mode tutor
 * prompt opens with (lib/checkin.ts `learnOpeningFrame`) — the grader must not
 * judge the session against a "understood NOTHING" starting point when the real
 * one might be "first time seeing this" or "already handles it well".
 */
export function buildUnderstandingPrompt(i: UnderstandingPromptInput): string {
  const a = addressForms(i.gender ?? null, i.studentName);
  const loLines = i.los
    .map((l) => `- ${l.id} "${l.label}": ${l.description ?? ""}`)
    .join("\n");
  const sessionDesc =
    i.mode === "learn"
      ? `AI-taught lesson (${learnOpeningFrame(deriveMasteryStage(i.los), i.studentName.split(" ")[0], i.gender ?? null).premise})`
      : `quick revision (the student said ${a.they} understood everything at school)`;
  return `Session: ${sessionDesc}.
Student: ${i.studentName}, ${gradeLabel(i.grade).toLowerCase()}. Lesson: ${i.lessonRef} — ${i.title} (${i.moduleLabel}).
Learning objectives covered:
${loLines}

GRADING RULES:
- Weigh ACTUAL performance — the "[live event]" lines (question attempts ✓/✗, widget results) — far above self-report or politeness.
- Be honest but fair: in learn mode, visible progress across the session counts in ${a.their} favor; early mistakes that were later corrected are progress, not failure.
- verdict bands: got_it = score >= 80, nearly = 55–79, needs_work < 55.
- strengths and gaps: 1–4 short concrete phrases each, referencing the actual content of THIS lesson (its objectives, figures, and exercises as they appeared in the transcript). gaps may be empty ([]) if there truly are none.
- next_step: ONE actionable, encouraging sentence for tomorrow. Never punitive.

Return STRICT JSON exactly in this shape:
{"score": <integer 0-100>, "verdict": "got_it" | "nearly" | "needs_work", "strengths": ["...", ...], "gaps": ["...", ...], "next_step": "..."}

TRANSCRIPT:
${understandingTranscript(i.transcript)}`;
}

/** The second attempt's prompt, when the first came back as something other
 *  than the strict JSON object. */
export function understandingRetryPrompt(
  basePrompt: string,
  rawOut: string
): string {
  return `${basePrompt}\n\nYour previous output was INVALID:\n${rawOut.slice(0, 500)}\nReturn ONLY the strict JSON object this time. No other text.`;
}

/**
 * Socratic wrong-answer probing — THE switch, and the only prompt text that
 * depends on it (Tamer's prototype, `507bb31`, brought onto `main` switched
 * OFF).
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS OFF
 * ---------------------------------------------------------------------------
 * With probing on, a wrong answer in a learn-mode lesson no longer reveals its
 * refutation or canonical solution on the card: the matched material rides
 * into the tutor's next turn as reference-only context and the tutor asks a
 * guiding question first. That breaks the previously-absolute rule that the
 * model's live words are never the graded explanation — a probing turn is
 * generated per turn and never stored as a reviewed entry. Tamer marked it
 * "unmerged prototype, do not point students at it" pending Samuel's ruling on
 * constitution Principle II (or a new ADR bounding live generation).
 *
 * So it merges dark. While this is `false`:
 *
 *   · `ChatCore` never enters probing (`probingActive` answers false for every
 *     surface), so the card reveals the refutation / solution on a wrong answer
 *     exactly as it did before the merge;
 *   · `learnPrompt` carries main's wrong-answer rules byte for byte — the
 *     SOCRATIC PROBING block never reaches the model;
 *   · `/api/attempts` ignores a `retryOfAttemptId` in the body, so
 *     `stance_used` is never `'probe'` and `retry_of_attempt_id` stays NULL.
 *     Migration 027's column is additive and harmless while nothing writes it.
 *
 * Typed `boolean` rather than inferred as the literal `false`, so the branches
 * that read it stay live code to the type checker in both positions — the
 * same shape as `MASTER_VARIANT_ENABLED` in `lib/design-variant.ts`.
 *
 * **Flip to `true` only on Samuel's ruling.** It is one edit; the prototype is
 * otherwise complete behind it.
 *
 * Pure and dependency-free: imported by client components (`ChatCore`), by the
 * server route, and by `node --test`.
 */
export const SOCRATIC_PROBING_ENABLED: boolean = false;

/**
 * Whether probing runs on this chat surface. Scoped to `lesson_learn` only —
 * review mode is a fast ≤5-message lock-in with immediate corrective lines,
 * and probing there would fight its own purpose.
 */
export function probingActive(
  surface: string | undefined,
  enabled: boolean = SOCRATIC_PROBING_ENABLED
): boolean {
  return enabled && surface === "lesson_learn";
}

/** The address forms the prompt reads (FR-2602) — the subset used here. */
export type ProbeAddress = {
  they: string;
  them: string;
  their: string;
  themself: string;
  s: string;
};

/**
 * The wrong-answer lines of the learn-mode system prompt.
 *
 * `enabled = false` returns main's two lines exactly as they stand in
 * `learnPrompt`, so a merged-but-off build sends the model the same prompt it
 * always did (`socratic-probing.test.mts` pins that). `enabled = true` returns
 * Tamer's SOCRATIC PROBING block from `507bb31`, re-voiced through the address
 * seam: the prototype predates P6 and wrote "him"/"his" literally, which main
 * removed from every prompt (FR-2602).
 */
export function learnWrongAnswerRules(
  a: ProbeAddress,
  tapWidgets: string,
  enabled: boolean = SOCRATIC_PROBING_ENABLED
): string {
  if (!enabled) {
    return `- From the SECOND message on: open with one warm beat reacting to ${a.their} latest [live event]. If ${a.they} got it wrong: re-explain THAT exact point a different way (grounded in the canonical steps), walking ${a.them} toward the correct answer, in the same upbeat tone — never open with the correct letter.
- After a "لسه مش فاهم" / still-confused signal: re-explain from a DIFFERENT angle, and the next check MUST be a basic-tier question or a tap widget (${tapWidgets}) — never a harder question.`;
  }
  return `- From the SECOND message on: open with one warm beat reacting to ${a.their} latest [live event].
- SOCRATIC PROBING (a wrong answer is never explained outright, and a right answer is never assumed from your own reading of ${a.their} chat reply — grading is always server-side, never your judgment call):
  · A "SOCRATIC PROBE" [live event] means that LO is now confirmation-pending, carrying reference material for YOU ONLY — do NOT state the correct answer, name the misconception, or quote/paraphrase that material yet. Ask ONE short question that points ${a.them} toward ${a.their} own mistake instead (work backwards from ${a.their} answer, plug it back in to show the contradiction, or lean on the LO's own definition) — never open with the correct letter.
  · When ${a.their} NEXT chat reply is a genuine attempt at the currently-open question (not "I don't know", not a question back to you, not small talk) — extract the answer EXACTLY as shown on the card (the lettered choice, or the numeric/expression text) and emit {{answer_submitted:<that value>}} ALONE, nothing else directive-wise in that message. Do not say "correct" or "not quite" yourself — wait for the graded [live event] on your NEXT turn before reacting, exactly like a tapped card.
  · A "SOCRATIC PROBE — REVEALED" [live event] (${a.their} second wrong attempt on this LO) means withholding is OVER for this LO: explain plainly now, walking the material's OWN STEPS in order — never just the final value. Once ${a.they} seem${a.s} ready, your next check on this LO must still be a fresh same-tier question from the QUESTION BANK, pushed with {{show_question:...}}, before you can treat it as resolved.
  · If ${a.they} explicitly ask${a.s} to just be told the answer / give${a.s} up — ONLY once a genuine attempt already exists on the open question (a SOCRATIC PROBE event has already fired for this LO) — emit {{reveal_answer}} and, in that SAME message, give the full walkthrough in steps, same as the REVEALED case above. If no attempt exists yet, do NOT reveal — warmly insist on a guess first ("no worries — even a guess helps, take your best shot") instead of honoring the ask.
  · Never emit {{answer_submitted:...}} or {{reveal_answer}} for a currently-open WIDGET question — a construction has no free-text equivalent; widgets grade only from the construction itself.
  · Either way the LO stays confirmation-pending — never say "got it" or move on from it — until ${a.they} answer${a.s} a FRESH same-tier question on that same LO correctly ${a.themself}. A "✓ confirmation received" line closes the loop — react warmly, then continue the arc normally.
- After a "لسه مش فاهم" / still-confused signal on a lesson beat that was NOT a wrong-answer probe: re-explain from a DIFFERENT angle, and the next check MUST be a basic-tier question or a tap widget (${tapWidgets}) — never a harder question.`;
}

/**
 * The retry link `/api/attempts` may record, or `null`. Off → always null, so
 * a client that sends `retryOfAttemptId` while the switch is off changes
 * nothing about the row it writes. On → only a positive SAFE integer survives
 * (above 2^53 a JSON number no longer names one id exactly, so it could point
 * at a neighbouring attempt); the route then confirms, under the student's
 * own principal, that it names one of her wrong attempts on the same
 * objective before writing it.
 */
export function acceptedRetryOf(
  raw: unknown,
  enabled: boolean = SOCRATIC_PROBING_ENABLED
): number | null {
  if (!enabled) return null;
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;
}

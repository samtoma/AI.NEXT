/**
 * Socratic wrong-answer probing — the RULES, pure (ADR-0021).
 *
 * Tamer's prototype (`507bb31`) merged onto `main` in v0.6.0 behind a
 * compile-time `SOCRATIC_PROBING_ENABLED = false`. v0.7.0 replaces that
 * constant with a runtime decision an operator makes in the console
 * (`/teaching`), and this file holds every rule of that decision with no
 * database, no Next and no import anywhere near it — the same split as
 * `lib/catalog.ts` / `lib/catalog-queries.ts`: a switch that decides what a
 * child is taught has to be provable without a running system, including the
 * branches that are hard to reach in one.
 *
 * ---------------------------------------------------------------------------
 * WHAT PROBING IS, AND WHY IT IS NOT SIMPLY ON
 * ---------------------------------------------------------------------------
 * With probing on, a wrong answer in a learn-mode lesson no longer reveals its
 * refutation or canonical solution on the card: the matched material rides
 * into the tutor's next turn as reference-only context and the tutor asks a
 * guiding question first. That breaks the previously-absolute rule that the
 * model's live words are never the graded explanation, and issue #53 lists
 * what still has to be fixed before a real student should meet it (credit a
 * student did not earn; a lesson that can stall). Hence three positions:
 *
 *   off       — the default, and what an empty settings table means.
 *   testers   — only student accounts an operator has marked as test accounts.
 *   everyone  — LOCKED until #53 is closed: `PROBING_EVERYONE_UNLOCKED` below.
 *
 * ---------------------------------------------------------------------------
 * ON AT A NEW SITTING, OFF ON THE NEXT MESSAGE — ALWAYS BY THE SERVER
 * ---------------------------------------------------------------------------
 * `resolveProbing` runs once per learning session, when the session row is
 * created (`lib/sessions.ts`), and its answer is STORED on that row — the
 * record of what the sitting opened with, which nothing rewrites.
 *
 * Each REQUEST then gets that snapshot NARROWED, never widened (Samuel,
 * 2026-09-24, option B): a sitting that opened ON re-reads the switch and
 * the student's tester mark on every request and stops probing the moment
 * either says no (`probingCouldApply`) — and each counts only while it is
 * UNCHANGED since the sitting opened, so a sitting that stopped probing
 * never starts again, not after Off-then-On nor after un-mark-then-re-mark
 * (fix pass 2; `lib/sessions.ts`). `effectiveProbing` narrows it to the
 * lesson or question actually in front of the server (maths, learn mode — a
 * session can outlive the lesson it opened on). A sitting that opened OFF is
 * never turned on. So: switching Off, or removing a mark, reaches the
 * student's next message; switching On reaches their next sitting. The prompt builder, the attempt route and — through what the
 * server declares on each response — the client's cards all follow the
 * request's answer.
 *
 * With the answer `false` every helper here returns exactly what v0.6.0 sent
 * with its switch off — `probing-prompts.test.mts` compares all 24 tutor
 * prompts to a capture taken before this file changed.
 */

/** The three positions of the console switch. */
export const PROBING_SETTINGS = ["off", "testers", "everyone"] as const;
export type ProbingSetting = (typeof PROBING_SETTINGS)[number];

/**
 * **"Everyone" is locked until issue #53 is closed** (Samuel, 2026-09-24).
 *
 * #53 is the list of probing defects found in the v0.6.0 deep review — the two
 * worst being credit a student did not earn and a lesson that can stall. Until
 * it is closed, probing may reach test accounts and nobody else. While this is
 * `false`:
 *
 *   · the console shows "Everyone" disabled, with "Not ready yet — see issue
 *     #53" beside it;
 *   · `POST /api/console/teaching` refuses `everyone` with 409
 *     (`settingChangeRefusal`), whoever asks;
 *   · a stored `everyone` — written while it was unlocked, or by hand — is
 *     READ AS `testers` (`effectiveSetting`). The lock narrows what is already
 *     stored rather than trusting it, so re-locking is also one edit.
 *
 * Typed `boolean` rather than inferred as the literal `false`, so the branches
 * that read it stay live code to the type checker in both positions — the
 * same shape `MASTER_VARIANT_ENABLED` has in `lib/design-variant.ts`.
 * **Flip to `true` only when #53 is closed and Samuel says so.**
 */
export const PROBING_EVERYONE_UNLOCKED: boolean = false;

/** Where to read about the lock, in the words the console prints. */
export const PROBING_EVERYONE_LOCK_NOTE = "Not ready yet — see issue #53";

/**
 * The one course probing may run in. The probing block and every live-event
 * note ChatCore writes for it are English maths strings; Social Studies and
 * Arabic are taught in Egyptian Arabic and have no translation of any of it
 * (#53 P1-6). Not "the English courses" — this one id, until someone writes
 * the other two.
 */
export const PROBING_COURSE_ID = "course:prep3-math-en";

/**
 * The one surface probing may run on. Review mode is a fast ≤5-message
 * lock-in with immediate corrective lines, and probing there would fight its
 * own purpose; every other surface has no lesson to probe inside.
 */
export const PROBING_SURFACE = "lesson_learn";

/** A stored or posted value, read closed: anything unrecognised is `off`. */
export function asProbingSetting(raw: unknown): ProbingSetting {
  return typeof raw === "string" && (PROBING_SETTINGS as readonly string[]).includes(raw)
    ? (raw as ProbingSetting)
    : "off";
}

/**
 * The position the product ACTS on, given the stored one. `everyone` while the
 * lock is on is `testers`: see `PROBING_EVERYONE_UNLOCKED`.
 */
export function effectiveSetting(
  stored: ProbingSetting,
  everyoneUnlocked: boolean = PROBING_EVERYONE_UNLOCKED
): ProbingSetting {
  return stored === "everyone" && !everyoneUnlocked ? "testers" : stored;
}

/**
 * Why the console may not store this position, or null when it may.
 *
 * The server's refusal, not the page's: the console renders the option
 * disabled, and that is FR-2107's "hiding a control is not authorisation" —
 * a request built by hand still reaches this.
 */
export function settingChangeRefusal(
  to: ProbingSetting,
  everyoneUnlocked: boolean = PROBING_EVERYONE_UNLOCKED
): "everyone_locked" | null {
  return to === "everyone" && !everyoneUnlocked ? "everyone_locked" : null;
}

export type ProbingInputs = {
  /** the stored console position for this environment; no row is `off` */
  setting: ProbingSetting;
  /** whether an operator has marked this student as a test account */
  isTester: boolean;
  /** the course of the lesson the session is opening on, or null */
  courseId: string | null;
  /** the session's kind — `lesson_learn`, `practice`, … */
  surface: string | null | undefined;
};

/**
 * THE RESOLVER. Run when a learning session is created; its answer is stored
 * on the session row and never rewritten. For a sitting stored ON, the same
 * rule (minus the course, `probingCouldApply`) is asked again on every
 * request — of the switch and mark the sitting opened under, if unchanged —
 * and can only turn it off.
 *
 *   off                      → false
 *   testers                  → tester AND maths AND lesson_learn
 *   everyone (unlocked)      → maths AND lesson_learn
 *   everyone (locked, #53)   → as testers
 */
export function resolveProbing(
  input: ProbingInputs,
  everyoneUnlocked: boolean = PROBING_EVERYONE_UNLOCKED
): boolean {
  const setting = effectiveSetting(input.setting, everyoneUnlocked);
  if (setting === "off") return false;
  if (input.surface !== PROBING_SURFACE) return false;
  if (input.courseId !== PROBING_COURSE_ID) return false;
  if (setting === "testers") return input.isTester === true;
  return true; // everyone, unlocked
}

/**
 * Could probing apply to this session if its lesson turned out to be maths?
 *
 * Lets session creation skip the one extra read (which course is this lesson
 * in?) whenever the answer is already no — which, with the switch Off, is
 * always, so an Off build does exactly the reads it did before. And it is the
 * per-request re-check for a sitting that opened ON (`lib/sessions.ts`): the
 * switch and the mark as they are now — a switch moved, or a mark made,
 * since the sitting opened reads as off / unmarked — with the course left to
 * `effectiveProbing`.
 */
export function probingCouldApply(
  input: Omit<ProbingInputs, "courseId">,
  everyoneUnlocked: boolean = PROBING_EVERYONE_UNLOCKED
): boolean {
  return resolveProbing({ ...input, courseId: PROBING_COURSE_ID }, everyoneUnlocked);
}

/**
 * A sitting's probing answer, as it applies to the lesson in front of the
 * server now. `snapshot` is what `lib/sessions.ts` hands back for this
 * request — the stored snapshot already narrowed by the switch and the mark.
 *
 * Only ever NARROWS. A learning session can be reused across two lessons of
 * the same kind (ADR-0015 closes one on completion, inactivity or a different
 * kind, not on a different lesson), so a snapshot taken on a maths lesson can
 * meet an Arabic one; this is what keeps probing out of it. It never turns a
 * stored `false` on, and a NULL snapshot — a session opened before v0.7.0 —
 * is off.
 */
export function effectiveProbing(
  snapshot: boolean | null | undefined,
  surface: string | null | undefined,
  courseId: string | null | undefined
): boolean {
  return snapshot === true && surface === PROBING_SURFACE && courseId === PROBING_COURSE_ID;
}

/**
 * Whether probing runs on this chat surface, given the server's answer for
 * this lesson. The client's half of the same rule: `enabled` is what the
 * server declared for the session, never a flag the client decided.
 */
export function probingActive(surface: string | undefined, enabled: boolean): boolean {
  return enabled && surface === PROBING_SURFACE;
}

/**
 * Does a question card hold back the answer and the worked solution for a
 * WRONG result? Only while probing applies and the reveal has not been
 * unlocked (the second wrong attempt, or an explicit {{reveal_answer}}).
 *
 * `probing` is what the server declared on its latest response. When a
 * sitting stops probing — the switch moves, or the student is unmarked,
 * mid-sitting — the next response declares false and every card holding
 * back re-renders with its answer on offer ("Show the answer") and its
 * worked solution shown: nothing stays stuck behind a probe that is no
 * longer happening. `ChatQuestionCard` asks this, for both halves.
 */
export function cardWithholdsAnswer(probing: boolean, revealAnswer: boolean): boolean {
  return probing && !revealAnswer;
}

/**
 * The confirmation-pending state after the server declares whether this
 * sitting probes. A pending objective is a probing construct: once the server
 * says false it is dropped, or ChatCore's "Got it" guard would go on refusing
 * in a lesson that is no longer probing. `true` keeps it as it was.
 */
export function pendingAfterDeclaration<T>(pending: T | null, declared: boolean): T | null {
  return declared ? pending : null;
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
 * `enabled = false` returns main's two lines exactly as they stood in
 * `learnPrompt` before the prototype merged, so a lesson with probing off
 * sends the model the prompt it always did (`probing-prompts.test.mts` pins
 * all 24 renders). `enabled = true` returns Tamer's SOCRATIC PROBING block
 * from `507bb31`, re-voiced through the address seam: the prototype predates
 * P6 and wrote "him"/"his" literally, which main removed from every prompt
 * (FR-2602).
 */
export function learnWrongAnswerRules(
  a: ProbeAddress,
  tapWidgets: string,
  enabled: boolean
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
 * The retry link `/api/attempts` may record, or `null`.
 *
 * `enabled` is the SESSION'S stored snapshot as it applies to this question
 * (`effectiveProbing`), never the request's say-so. Off → always null, so a
 * client that sends `retryOfAttemptId` for a lesson that is not probing
 * changes nothing about the row it writes. On → only a positive SAFE integer
 * survives (above 2^53 a JSON number no longer names one id exactly, so it
 * could point at a neighbouring attempt); the route then confirms, under the
 * student's own principal, that it names one of her wrong attempts on the
 * same objective before writing it.
 */
export function acceptedRetryOf(raw: unknown, enabled: boolean): number | null {
  if (!enabled) return null;
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;
}

/**
 * The Stop button's pure logic — shared by the server routes that spawn the
 * model and the client surfaces that show its reply.
 *
 * A student who no longer wants a reply presses Stop. Two things must then be
 * true, and both are decided here so they can be tested without a model, a
 * database or a browser:
 *
 *  1. **On the server, a stopped turn is `stopped`, not `error`.** The client's
 *     abort kills the CLI with SIGKILL, and a killed CLI closes exactly like a
 *     crashed one — no result line, a signal exit. Before this module the close
 *     handler read that as a backend failure, so every Stop counted against the
 *     console's runtime-health signal (FR-3006). `stopped` is a cost line (the
 *     tokens were really spent; migration 041) and never a failure
 *     (`FAILING_OUTCOMES` in `lib/runtime-health.ts` stays error|timeout).
 *
 *  2. **On the client, what she already saw is kept, and nothing she did not.**
 *     The paced reveal (FR-3501) can be behind the stream — sometimes the whole
 *     reply has arrived and is still being revealed beat by beat — so "keep the
 *     partial reply" means "keep the revealed prefix", not "keep what the
 *     network delivered".
 *
 * No imports with side effects: this file is bundled for the browser.
 */

import { stripIncompleteTail } from "@/lib/chat-parse";
import type { Outcome } from "@/lib/pricing";

/** How a model process ended, as the close handler knows it. */
export type EndedTurn = {
  /** The sacred guard killed it (ADR-0006). */
  redacted?: boolean;
  /** The result line arrived, was not an error, and carried text. */
  completed: boolean;
  /** Our own timeout killed it. */
  timedOut: boolean;
  /** The student's Stop (the request's abort signal) killed it. */
  stopped: boolean;
};

/**
 * The `ai_interactions.outcome` for a turn that has ended.
 *
 * The order is the argument:
 *  · `redacted` first — the guard decided before anyone else could.
 *  · `ok` next — a turn whose result arrived complete WAS delivered, even if
 *    the student's Stop raced the close event. The server cannot unspend it,
 *    and calling it stopped would understate delivered replies.
 *  · `timeout` before `stopped` — when our own timer fired first, the turn had
 *    already failed; a Stop pressed on a hung reply must not hide that from the
 *    health signal.
 *  · `stopped` before `error` — a SIGKILL we sent on her behalf is not the CLI
 *    failing, however its exit looks.
 */
export function endedTurnOutcome(t: EndedTurn): Outcome {
  if (t.redacted) return "redacted";
  if (t.completed) return "ok";
  if (t.timedOut) return "timeout";
  if (t.stopped) return "stopped";
  return "error";
}

/** The ledger's `assistant_message` when she stopped before a word arrived. */
export const STOPPED_BEFORE_REPLY = "[stopped by the student before any reply]";

/**
 * What the ledger records as the assistant's message for a stopped turn: the
 * text she was shown, or a marker when there was none. Never an empty string —
 * the console's replay would draw an empty bubble and an operator could not
 * tell a stopped turn from a lost one.
 */
export function stoppedAssistantMessage(shown: string): string {
  const t = shown.trimEnd();
  return t.length > 0 ? t : STOPPED_BEFORE_REPLY;
}

/**
 * The client half: the reply as it stands when Stop is pressed.
 *
 * `received` is everything the stream delivered; `revealed` is how many of
 * its characters the paced reveal had shown (`null` when no reveal runs, i.e.
 * everything received was shown). The kept text is the revealed prefix, with
 * any half-arrived directive or unclosed maths removed — a settled
 * (non-streaming) message is parsed without the streaming parser's tail guard,
 * so a dangling `{{viz:` would otherwise render as raw braces.
 *
 * `localOnly` is true when nothing was shown: an empty assistant row carries
 * no meaning for the model, and it stays on screen only to carry the
 * "Stopped" label.
 */
export function stoppedReply(
  received: string,
  revealed: number | null
): { text: string; localOnly: boolean } {
  const upTo =
    revealed == null ? received.length : Math.max(0, Math.min(revealed, received.length));
  const text = stripIncompleteTail(received.slice(0, upTo)).trimEnd();
  return { text, localOnly: text.length === 0 };
}

/** The visible line on a stopped reply — words, never colour alone. Said in
 *  the tutor's voice and open to anything: she may have stopped it to change
 *  her answer, not only to ask something else. */
export function stoppedLabel(arabicUi: boolean): string {
  return arabicUi
    ? "تمام، هقف هنا. عايز تقول إيه؟"
    : "Okay, I’ll pause here. What would you like to say?";
}

/** The Stop control's accessible name. */
export function stopControlLabel(arabicUi: boolean): string {
  return arabicUi ? "وقّف الرد" : "Stop the reply";
}

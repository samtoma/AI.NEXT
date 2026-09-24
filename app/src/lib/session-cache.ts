import type { AskContext } from "./ask";
import { addressForms, type Gender } from "./address";

/**
 * Per-chat-session grounding snapshot.
 *
 * The grounding data block must be BYTE-STABLE across the turns of one chat
 * session: it is placed in the (cacheable) prompt prefix, and any live
 * re-interpolation — mastery moving after an answer, a different weakest-LO
 * slice — busts the prompt cache on every turn. So the context is built once,
 * on the session's first turn, and replayed verbatim for every later turn.
 *
 * In-memory is fine for the PoC (single dev server process); a deployed
 * runtime would key this in Redis/postgres alongside ai_interactions.
 *
 * ## What this cache must do about gender (P6, FR-2606)
 *
 * FR-2606: a change to a student's gender MUST take effect in the tutor's next
 * turn, without signing out or starting a new session. The address forms are
 * not a separate field the route could re-render — after P6 they are woven
 * through the system prompt and the address block inside the data block, which
 * is precisely the payload this cache replays verbatim. A student who fixes
 * their profile mid-lesson would otherwise keep being addressed the old way for
 * up to three hours, which is the failure FR-2606 names.
 *
 * **The decision: the register joins the KEY, it is not bypassed.** Bypassing —
 * rebuilding the context every turn, or splicing a fresh address block into a
 * cached one — throws away the byte-stability this cache exists for, on every
 * turn, for every student, to serve the rare turn after a profile edit. Keying
 * costs nothing while the register is unchanged (the same key, the same hit)
 * and misses exactly once when it changes, which rebuilds the context and
 * applies the new register on the very next turn. `snapshotKey` below is the
 * one place that rule lives, so a caller cannot forget it.
 *
 * The key carries the REGISTER ("f" / "m" / "n"), not the stored value. It is
 * a cache key in memory rather than an event, a log line or an error message
 * (FR-2604 bars those, and nothing here is written anywhere), and the register
 * is the only thing about a student's gender this cache has any business
 * distinguishing: two students who are addressed the same way need no separate
 * entries, and `unspecified` and `null` are one register, not two.
 */

const TTL_MS = 3 * 60 * 60 * 1000; // a lesson never legitimately outlives this
const MAX_SESSIONS = 200;

const cache = new Map<string, { at: number; ctx: AskContext }>();

/**
 * The cache key for one chat session's grounding snapshot.
 *
 * Every input that can change the model-visible payload belongs here, and the
 * student is part of it — no student's snapshot is ever re-served to another.
 * Pure, so `session-cache.test.mts` can assert the FR-2606 property (a changed
 * register is a changed key) without a database or a model.
 */
export function snapshotKey(k: {
  surface: string;
  chatSession: string;
  studentId: number | null;
  lesson?: string;
  questionId?: string;
  wrongAnswer?: string;
  /**
   * The uploaded worksheet grounding this turn, when one does (FR-205).
   *
   * Part of the key for the same reason the register is: the transcription
   * lands inside the replayed data block (`retrievalBlock`), so a snapshot
   * built before the photograph arrived would be handed back for every turn
   * after it and the tutor would never see the student's own page. Attaching
   * one misses once, which is the rebuild that puts it in front of the model.
   */
  uploadId?: number;
  /** read this turn, from the one profile query (lib/student-context.ts) */
  gender: Gender;
  /**
   * The learning session's stored Socratic-probing snapshot (ADR-0021). Part
   * of the key because it changes the system prompt: a chat whose session
   * rotated (30 minutes idle, ADR-0015) re-resolves, and the cached prompt of
   * the previous session must not be replayed into the new one. Appended ONLY
   * when true, so every key with probing off is the key v0.6.0 built.
   */
  probing?: boolean;
}): string {
  return [
    k.surface,
    k.chatSession,
    k.studentId ?? "",
    k.lesson ?? "",
    k.questionId ?? "",
    k.wrongAnswer ?? "",
    k.uploadId ?? "",
    addressForms(k.gender).key,
    ...(k.probing === true ? ["probe"] : []),
  ].join("|");
}

/**
 * `null` passes through UNCACHED, and that is the whole reason this signature
 * admits it.
 *
 * A builder returns `null` when the course gate (migration 023,
 * `lib/catalog.ts`) refuses the lesson. A refusal is a permission, not a
 * payload: caching one would keep refusing for up to three hours after an
 * operator switched the course on — a student watching a page that stays
 * broken for reasons nobody can see. Caching is for expensive things that are
 * true; a refusal is cheap and may stop being true at any moment.
 */
export async function snapshotContext(
  key: string,
  build: () => Promise<AskContext | null>
): Promise<AskContext | null> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.ctx;
  const ctx = await build();
  if (!ctx) return null;
  cache.set(key, { at: now, ctx });
  if (cache.size > MAX_SESSIONS) {
    const byAge = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < byAge.length - MAX_SESSIONS; i++)
      cache.delete(byAge[i][0]);
  }
  return ctx;
}

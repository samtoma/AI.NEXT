import type { AskContext } from "./ask";

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
 */

const TTL_MS = 3 * 60 * 60 * 1000; // a lesson never legitimately outlives this
const MAX_SESSIONS = 200;

const cache = new Map<string, { at: number; ctx: AskContext }>();

export async function snapshotContext(
  key: string,
  build: () => Promise<AskContext>
): Promise<AskContext> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.ctx;
  const ctx = await build();
  cache.set(key, { at: now, ctx });
  if (cache.size > MAX_SESSIONS) {
    const byAge = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < byAge.length - MAX_SESSIONS; i++)
      cache.delete(byAge[i][0]);
  }
  return ctx;
}

/**
 * Where a student left a lesson, and whether she gets it back (FR-204, #25).
 *
 * FR-204: "The system MUST return a student who stopped mid-lesson to where
 * they left off, not to the start of the unit." The place used to live in the
 * browser (`sessionStorage`, then `localStorage` for a week). Since issue #25
 * it lives ONLY on the server, in `lesson_saves` (migration 042), so it
 * survives a reload, sign-out and a change of device. The product owner's
 * calls, all encoded here or in the route:
 *
 *  1. **No browser storage, no fallback.** Old `ainext-lesson:*` keys are not
 *     migrated; `clearLegacyLessonSaves` removes them when the lesson reads.
 *  2. **No expiry.** A save is offered however old it is.
 *  3. **An early Finish keeps the place.** Finishing before the lesson is over
 *     still produces the report, but the save is kept and marked `endedEarly`.
 *     Only a Finish after the lesson is over discards it (DELETE).
 *  4. **Most recent save wins** across devices: every save is an upsert, and
 *     `at` is the server's clock at that write.
 *  5. **Saved as the lesson goes,** not at unload: the lesson PUTs after each
 *     settled change, through `createSaveChannel`, which keeps one request in
 *     flight and only the latest one queued, so an older save can never land
 *     after a newer one from the same tab.
 *
 * No React, no DOM globals, no database: the route and the component both
 * import it, and `npm test` drives it.
 */

import type { LessonMode } from "@/lib/types";
import { isLessonSlug } from "@/lib/lesson-slug";

export const SAVE_VERSION = 1;

/** The largest request body the save route accepts, in bytes. */
export const MAX_SAVE_BYTES = 1_000_000;

/** Shape limits — generous for a real lesson, tight enough to refuse junk. */
export const SAVE_LIMITS = {
  sid: 128,
  messages: 1000,
  board: 500,
  covered: 200,
  key: 200,
} as const;

/** What the server stores, and what the client sends. */
export interface SavePayload<M = unknown, B = unknown> {
  v: number;
  sid: string;
  messages: M[];
  board: B[];
  focusKey: string | null;
  covered: string[];
  /** objectives with a right checked answer in this sitting — the steps' full
   *  tick ("One mastery rule" M3). Optional: saves from before it read as none. */
  practised?: string[];
  /** set when the student pressed Finish before the lesson was over */
  endedEarly?: boolean;
}

/** A save as read back: the payload plus the server time of its last write. */
export interface SavedSession<M = unknown, B = unknown> extends SavePayload<M, B> {
  at: number;
}

export const isLessonMode = (m: unknown): m is LessonMode => m === "learn" || m === "review";

/** Is this a lesson the save route may address? */
export function isSaveTarget(mode: unknown, slug: unknown): boolean {
  return isLessonMode(mode) && isLessonSlug(slug);
}

/** The save route for one lesson. Mode and slug are curriculum ids, not personal data. */
export const lessonSaveUrl = (mode: LessonMode, slug: string) =>
  `/api/lesson-save/${mode}/${encodeURIComponent(slug)}`;

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const ROLES = new Set(["user", "assistant", "note"]);

/**
 * The server-side gate on a save body. Anything that is not exactly the
 * resume payload is refused, and unknown top-level fields are DROPPED rather
 * than stored: the table is meant to hold what resume needs and nothing more
 * (minors' data, migration 042's header). No student id is read from the
 * body — the route takes it from the session.
 */
export function validateSavePayload(
  j: unknown
): { ok: true; save: SavePayload } | { ok: false; error: string } {
  if (!isObj(j)) return { ok: false, error: "not_an_object" };
  if (j.v !== SAVE_VERSION) return { ok: false, error: "version" };
  if (typeof j.sid !== "string" || j.sid === "" || j.sid.length > SAVE_LIMITS.sid)
    return { ok: false, error: "sid" };
  if (!Array.isArray(j.messages) || j.messages.length > SAVE_LIMITS.messages)
    return { ok: false, error: "messages" };
  for (const m of j.messages) {
    if (!isObj(m) || !ROLES.has(m.role as string) || typeof m.text !== "string")
      return { ok: false, error: "message" };
    if (m.streaming === true) return { ok: false, error: "streaming_message" };
  }
  if (!Array.isArray(j.board) || j.board.length > SAVE_LIMITS.board)
    return { ok: false, error: "board" };
  for (const b of j.board) {
    if (!isObj(b) || typeof b.key !== "string" || b.key.length > SAVE_LIMITS.key)
      return { ok: false, error: "board_item" };
  }
  if (
    j.focusKey !== null &&
    (typeof j.focusKey !== "string" || j.focusKey.length > SAVE_LIMITS.key)
  )
    return { ok: false, error: "focusKey" };
  if (
    !Array.isArray(j.covered) ||
    j.covered.length > SAVE_LIMITS.covered ||
    !j.covered.every((c) => typeof c === "string" && c.length <= SAVE_LIMITS.key)
  )
    return { ok: false, error: "covered" };
  if (
    j.practised !== undefined &&
    (!Array.isArray(j.practised) ||
      j.practised.length > SAVE_LIMITS.covered ||
      !j.practised.every((c) => typeof c === "string" && c.length <= SAVE_LIMITS.key))
  )
    return { ok: false, error: "practised" };
  if (j.endedEarly !== undefined && typeof j.endedEarly !== "boolean")
    return { ok: false, error: "endedEarly" };
  if (!hasTutorText(j.messages)) return { ok: false, error: "nothing_to_resume" };
  const save: SavePayload = {
    v: SAVE_VERSION,
    sid: j.sid,
    messages: j.messages,
    board: j.board,
    focusKey: j.focusKey as string | null,
    covered: j.covered as string[],
    ...(Array.isArray(j.practised) ? { practised: j.practised as string[] } : {}),
    ...(j.endedEarly === true ? { endedEarly: true } : {}),
  };
  return { ok: true, save };
}

/** A save is worth offering only once the tutor has said something. */
export function hasTutorText(messages: readonly unknown[]): boolean {
  return messages.some((m) => {
    const msg = m as { role?: unknown; text?: unknown };
    return msg?.role === "assistant" && typeof msg.text === "string" && msg.text !== "";
  });
}

/**
 * The GET answer, read on the client: a save worth offering, or null. No
 * expiry — however old `at` is, the place is offered (product owner, #25).
 */
export function parseSaved(j: unknown): SavedSession | null {
  if (!isObj(j)) return null;
  const v = validateSavePayload(j);
  if (!v.ok) return null;
  if (typeof j.at !== "number" || !Number.isFinite(j.at)) return null;
  return { ...v.save, at: j.at };
}

/**
 * Is this Finish a stop rather than an ending? The lesson is over when the
 * tutor's recap (or review mode's nudge) armed Finish, or every objective has
 * been covered; anything before that is early.
 */
export function isEarlyFinish(p: {
  readyToFinish: boolean;
  coveredCount: number;
  loCount: number;
}): boolean {
  if (p.readyToFinish) return false;
  return p.coveredCount < p.loCount;
}

/** "step X of N" for the resume prompt: the step she was on, 1-based. */
export function resumeStep(covered: readonly string[], loCount: number): number {
  return Math.min(covered.length + 1, Math.max(loCount, 1));
}

/* ------------------------------------------------------------ the channel --- */

export type SaveOp = { kind: "put"; body: string } | { kind: "delete" };

/**
 * Ordered, coalescing writes to one lesson's save. At most one request is in
 * flight; a newer op replaces whatever is queued behind it, so the server
 * only ever sees saves in the order the tab made them and never an older one
 * last. A put identical to the last one sent is skipped (an idle tab writes
 * nothing). A failed put is not retried on its own: the next change re-sends,
 * and `unsent()` hands it to the unload flush.
 */
export function createSaveChannel(send: (op: SaveOp) => Promise<boolean>) {
  let inFlight: SaveOp | null = null;
  let queued: SaveOp | null = null;
  /** body of the last put accepted for sending and not known to have failed */
  let lastBody: string | null = null;
  /** body of a put that failed and has not been superseded */
  let failed: string | null = null;
  let idleWaiters: (() => void)[] = [];

  const pump = () => {
    if (inFlight || !queued) {
      if (!inFlight && !queued) {
        const w = idleWaiters;
        idleWaiters = [];
        w.forEach((f) => f());
      }
      return;
    }
    const op = queued;
    queued = null;
    inFlight = op;
    send(op)
      .catch(() => false)
      .then((ok) => {
        inFlight = null;
        if (op.kind === "put") {
          if (ok) {
            if (failed === op.body) failed = null;
          } else if (!queued) {
            failed = op.body;
            if (lastBody === op.body) lastBody = null;
          }
        }
        pump();
      });
  };

  return {
    put(body: string) {
      if (body === lastBody) return;
      lastBody = body;
      failed = null;
      queued = { kind: "put", body };
      pump();
    },
    remove() {
      lastBody = null;
      failed = null;
      queued = { kind: "delete" };
      pump();
    },
    /** A put the server has not confirmed (queued, in flight or failed), or null. */
    unsent(): string | null {
      if (queued?.kind === "put") return queued.body;
      if (queued?.kind === "delete") return null;
      if (inFlight?.kind === "put") return inFlight.body;
      return failed;
    },
    /** Resolves once nothing is queued or in flight. */
    idle(): Promise<void> {
      if (!inFlight && !queued) return Promise.resolve();
      return new Promise((r) => idleWaiters.push(r));
    },
  };
}

/* --------------------------------------------------- legacy browser saves --- */

const LEGACY_KEY_PREFIX = "ainext-lesson:";

/** The subset of `Storage` this module touches. */
export type KeyStore = Pick<Storage, "removeItem"> & {
  readonly length: number;
  key(index: number): string | null;
};

/**
 * Remove every pre-#25 browser save (`ainext-lesson:*`). They are not
 * migrated (product owner, #25) and must not linger on a shared device.
 */
export function clearLegacyLessonSaves(store: KeyStore): void {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k?.startsWith(LEGACY_KEY_PREFIX)) keys.push(k);
  }
  for (const k of keys) store.removeItem(k);
}

/**
 * Where a student left a lesson, and whether she gets it back (FR-204).
 *
 * FR-204: "The system MUST return a student who stopped mid-lesson to where
 * they left off, not to the start of the unit." Until this module the save
 * lived in `sessionStorage` and Finish deleted it unconditionally, so the most
 * common way a student stops mid-lesson — the header's Finish button, the one
 * visible exit in focus mode — was also the one that threw her place away
 * (tester report against v0.11.0, 2026-10-03). Closing the tab lost it too.
 *
 * Two rules, both here and not in the component so they are tested:
 *
 *  1. **An early Finish keeps the place.** Finishing before the lesson is over
 *     still produces the report the student asked for, but the save is kept
 *     and marked `endedEarly`, so the next visit offers Continue / Start over.
 *     Only a Finish after the lesson is over discards it.
 *  2. **The save survives the tab, for a week.** It lives in `localStorage`
 *     with a TTL checked on read. It is still one device only — cross-device
 *     resume needs server persistence (issue #25). Sign-out clears every save
 *     (`clearLessonSaves`), because a shared family iPad is the normal case.
 *
 * No React, no DOM globals: storage is passed in, so `npm test` can drive it.
 */

import type { LessonMode } from "@/lib/types";

export const SAVE_VERSION = 1;

/** A save older than this is ignored and removed on read. */
export const RESUME_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const KEY_PREFIX = "ainext-lesson:";

export interface SavedSession<M = unknown, B = unknown> {
  v: number;
  sid: string;
  messages: M[];
  board: B[];
  focusKey: string | null;
  covered: string[];
  at: number;
  /** set when the student pressed Finish before the lesson was over */
  endedEarly?: boolean;
}

/** The subset of `Storage` this module touches. */
export type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem"> & {
  readonly length: number;
  key(index: number): string | null;
};

// Scoped by STUDENT as well as mode+lesson: without the id, switching the
// demo student and opening the same lesson resumed the previous student's
// transcript (and inherited their server-side turn count) — found by the
// release review, 2026-07-30.
export const storeKey = (mode: LessonMode, slug: string, studentId: number) =>
  `${KEY_PREFIX}${mode}:${slug}:s${studentId}`;

/**
 * A stored save, or null when there is nothing worth offering: missing,
 * corrupt, another version, expired, or no tutor message in it yet.
 */
export function parseSaved(
  raw: string | null,
  now: number
): SavedSession | null {
  if (!raw) return null;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const s = j as Partial<SavedSession>;
  if (s.v !== SAVE_VERSION || typeof s.sid !== "string") return null;
  if (!Array.isArray(s.messages)) return null;
  if (typeof s.at !== "number" || now - s.at > RESUME_TTL_MS) return null;
  const hasTutorText = s.messages.some((m) => {
    const msg = m as { role?: unknown; text?: unknown };
    return msg?.role === "assistant" && typeof msg.text === "string" && msg.text !== "";
  });
  return hasTutorText ? (s as SavedSession) : null;
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

/** Remove every lesson save in this store — sign-out on a shared device. */
export function clearLessonSaves(store: KeyStore): void {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k?.startsWith(KEY_PREFIX)) keys.push(k);
  }
  for (const k of keys) store.removeItem(k);
}

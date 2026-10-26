/**
 * Background model work a student can stop, keyed by what it is working on.
 *
 * The chat routes stop through the request's own abort signal: the student's
 * fetch is the work, so aborting it is the Stop. Two kinds of work outlive the
 * request that started them — reading an uploaded photo (`lib/uploads.ts`) and
 * splitting a homework ask into questions (`lib/homework.ts`) both run after a
 * 202 — so nothing the client aborts reaches them. They register a cancel
 * function here under `upload:<id>` / `homework:<id>`, and the routes that
 * answer the Stop call `cancelRun`.
 *
 * **In-process only, by design.** The app is one Node process per environment
 * (`deploy/`), and the child process the cancel kills is that process's child —
 * no other process could kill it anyway. Held on `globalThis` so that two
 * route bundles importing this module share one map instead of one each.
 *
 * Ownership is the CALLER's check: a route must confirm the upload or ask is
 * the student's (the row-level-security read it already does) before it
 * cancels by id.
 */

type Registry = Map<string, () => void>;

const KEY = "__noorRunningWork";

function registry(): Registry {
  const g = globalThis as unknown as Record<string, Registry | undefined>;
  return (g[KEY] ??= new Map());
}

/** Register a cancel function; returns the unregister to call when the work ends. */
export function registerRun(key: string, cancel: () => void): () => void {
  const runs = registry();
  runs.set(key, cancel);
  return () => {
    if (runs.get(key) === cancel) runs.delete(key);
  };
}

/** Cancel the work under `key`. True when something was running and was told to stop. */
export function cancelRun(key: string): boolean {
  const runs = registry();
  const cancel = runs.get(key);
  if (!cancel) return false;
  runs.delete(key);
  cancel();
  return true;
}

export const uploadRunKey = (uploadId: number) => `upload:${uploadId}`;
export const homeworkRunKey = (askId: number) => `homework:${askId}`;

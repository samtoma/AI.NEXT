/**
 * `next/headers`, for a process that has no request.
 *
 * The prompt-capture harness imports `lib/lesson.ts` → `lib/student-context.ts`
 * → `lib/auth/principal.ts`, and that last module imports `cookies` from
 * `next/headers` at the top level. It never CALLS it during a capture — the
 * harness passes `studentId = null` deliberately, so nobody is signed in — but
 * an unresolvable import fails the whole run before a single prompt is built.
 * That import is the reason every constitution IX gate so far reported "fails
 * identically at HEAD" instead of a diff.
 *
 * So: an empty cookie jar. Not a fake session, not a default student — the same
 * answer the real `cookies()` would give for a request that carried no cookies,
 * which resolves to the anonymous principal the harness already expects.
 *
 * **This file never ships.** It lives under `scripts/`, outside `src/`, so no
 * Next build can reach it, and `ts-resolver.mjs` substitutes it only when the
 * process entrypoint is one of the scripts named in its STUB_ENTRYPOINTS list.
 * Every other caller — `next dev`, `next build`, the other standalone scripts —
 * resolves the real module.
 */

/** A jar with nothing in it, matching the async `cookies()` of Next 15+. */
export async function cookies() {
  return {
    get: () => undefined,
    getAll: () => [],
    has: () => false,
    set: () => {},
    delete: () => {},
    [Symbol.iterator]: function* () {},
  };
}

/** Request headers, of which there are none. */
export async function headers() {
  return new Headers();
}

export async function draftMode() {
  return { isEnabled: false, enable: () => {}, disable: () => {} };
}

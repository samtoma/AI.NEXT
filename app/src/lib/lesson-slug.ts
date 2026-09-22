/**
 * The LO-id → lesson-slug mapping, and nothing else.
 *
 * Its own module because both sides need it and they cannot share
 * `lib/lesson.ts`: that file opens a connection pool and runs queries, so
 * importing it from a `"use client"` component drags server code into the
 * browser bundle. Same reasoning as `lib/checkin.ts` — the pure part lives
 * where both the server and the client can reach it, and there is exactly
 * one definition of the rule.
 *
 * The rule is lexical, which is a property of how the curriculum was
 * extracted rather than a design choice: a lesson IS the set of objectives
 * sharing an id prefix, and `getLessonData` selects them with
 * `lo.id LIKE 'lo:<slug>-%'`. That guarantees a slug derived from a real LO
 * id always resolves to a lesson containing that LO — checked against the
 * seeded graph, where all 90 objectives map onto 34 lessons and none fails
 * `SLUG_RE`.
 */

export const DEFAULT_LESSON_SLUG = "u1-1";

const SLUG_RE = /^[a-z0-9]{1,12}-[0-9]{1,3}$/;

/** "lo:geo1-2-1" → lesson slug "geo1-2" (LO-id prefix minus the last part). */
export function slugOfLo(loId: string): string {
  return loId.replace(/^lo:/, "").replace(/-[0-9]+$/, "");
}

export function sanitizeLessonSlug(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return SLUG_RE.test(s) ? s : DEFAULT_LESSON_SLUG;
}

/**
 * The lesson URL for a topic, in learn mode.
 *
 * Sanitised on the way out as well as on the way in: the /student route
 * re-sanitises whatever arrives, and an id shaped oddly enough to produce a
 * junk slug should land on the default lesson rather than build a URL that
 * only fails once the page is already loading.
 */
export const learnHrefForLo = (loId: string) =>
  `/student?mode=learn&lesson=${encodeURIComponent(sanitizeLessonSlug(slugOfLo(loId)))}`;

/**
 * Demo student selection — the CLIENT-SAFE half (no `pg`, no `next/headers`,
 * so client components can import it).
 *
 * ⚠️  THIS IS A DEMO AFFORDANCE, NOT AUTH. ⚠️
 * The cookie below names which seeded demo student the PoC renders. It is a
 * plain, non-httpOnly, non-signed cookie that anyone can edit — deliberately.
 * It is NOT a session, NOT an identity claim and NOT a security boundary:
 * it must never gate anything that isn't already public in this PoC.
 * Real auth (parent account, phone + OTP) is a PRD §3 non-goal for the MVP and
 * lands with the student PWA — when it does, THIS FILE GOES AWAY; the student
 * comes from the authenticated session, never from a client-writable cookie.
 *
 * The value is still validated against the `students` table server-side
 * (see `student-context.ts`) — an unknown or garbage id falls back to the
 * default demo student rather than erroring or querying with a hostile value.
 */

export const DEMO_STUDENT_COOKIE = "ainext_demo_student";

/** Long enough to survive a demo session; short enough to expire on its own. */
export const DEMO_STUDENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** Omar — the mid-journey demo student, seeded first, so he is always id 1. */
export const DEFAULT_STUDENT_ID = 1;

export interface DemoStudent {
  id: number;
  displayName: string;
  grade: string;
  /** live counters, so the switcher can say WHY you'd pick this student */
  attempts: number;
  masteryRows: number;
  avgMastery: number;
}

/**
 * The whole resolution rule, as a pure function (DB-free, so it is unit
 * tested): a cookie value is honoured only when it names a student that
 * actually exists. Anything else — unset, empty, "abc", "1; DROP TABLE",
 * "999", "1.5", "-1" — falls back to the default student, and if even that
 * row is missing (a reseeded DB with different ids) to the lowest known id.
 */
export function pickStudentId(
  raw: string | null | undefined,
  knownIds: readonly number[]
): number {
  const fallback = knownIds.includes(DEFAULT_STUDENT_ID)
    ? DEFAULT_STUDENT_ID
    : knownIds.length > 0
      ? Math.min(...knownIds)
      : DEFAULT_STUDENT_ID;

  if (raw == null) return fallback;
  const trimmed = raw.trim();
  // strict: digits only. Number("") === 0 and Number(" 1 ") === 1 are exactly
  // the kind of coercion that lets junk through.
  if (!/^[0-9]{1,12}$/.test(trimmed)) return fallback;
  const id = Number(trimmed);
  return knownIds.includes(id) ? id : fallback;
}

/** Short display name: "Omar (demo)" → "Omar", "نور (جديدة)" → "نور"
 *  (the same convention LessonCheckIn already uses). */
export function shortName(displayName: string): string {
  return displayName.split(" ")[0] || displayName;
}

/**
 * The name to drop INSIDE Arabic copy («أهلاً يا نور»), or null when the
 * student's row name is not Arabic. All student-facing copy is Arabic (see
 * CLAUDE.md conventions), and a Latin name mid-sentence reads as a bug — so a
 * non-Arabic name is simply omitted and the sentence greets without it, rather
 * than rendering «أهلاً يا Omar». The row stays the single source of truth:
 * seed a student with an Arabic display name and the greeting personalizes.
 */
export function arabicGreetingName(displayName: string): string | null {
  const first = shortName(displayName);
  return /^[؀-ۿݐ-ݿ]+$/.test(first) ? first : null;
}

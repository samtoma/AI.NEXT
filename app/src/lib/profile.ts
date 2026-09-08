/**
 * Student profile vocabulary — the CLIENT-SAFE half (no `pg`, no `next/headers`),
 * so the create-student form and the server can share one definition.
 *
 * Backs FR-103/FR-104 (grade and interests captured at creation) and FR-302
 * (the student model holds them). The interest signal exists for one reason:
 * FR-203 lets the tutor frame an explanation against something the student
 * actually cares about, and ONLY where a real signal exists. An empty profile
 * is valid and means a colder start — never an invented interest.
 */

/** PRD A3: five broad categories plus a free-text catch-all. */
export const INTEREST_CATEGORIES = [
  { id: "sports", label: "Sports" },
  { id: "gaming_tech", label: "Gaming & Technology" },
  { id: "music", label: "Music" },
  { id: "arts", label: "Arts & Creativity" },
  { id: "business", label: "Business & Entrepreneurship" },
  { id: "other", label: "Other" },
] as const;

export type InterestId = (typeof INTEREST_CATEGORIES)[number]["id"];

const VALID_INTERESTS = new Set<string>(INTEREST_CATEGORIES.map((c) => c.id));

/**
 * PRD A3 asks for one lightweight follow-up on Sports and Music specifically,
 * because "sports" alone is a category label, not something an analogy can be
 * anchored to. This is the difference between a usable signal and a word.
 */
export const DETAIL_CATEGORIES: readonly InterestId[] = ["sports", "music"];

export type InterestDetail = {
  /** e.g. ["football"] or ["guitar"] — free text, the student's own words */
  which?: string[];
  /** sports: play | watch | both · music: play | listen | both */
  mode?: string;
  /** whatever the student typed under "Other" */
  otherText?: string;
};

/** Grades the PRD targets (§2). Prep-3 maps to grade 9 for this comparison. */
export const GRADES = ["7", "8", "9", "10", "11", "12"] as const;
export type Grade = (typeof GRADES)[number];

/**
 * The legacy PoC pinned every student to the literal string "prep-3", and the
 * baseline database is full of those rows. Both forms must keep working: a
 * migrated row reads "prep-3", a new row reads "9".
 */
export const LEGACY_PREP3 = "prep-3";

export function isValidGrade(v: unknown): v is Grade | typeof LEGACY_PREP3 {
  return (
    v === LEGACY_PREP3 || (typeof v === "string" && (GRADES as readonly string[]).includes(v))
  );
}

/** Human label for either form, so no surface has to special-case the legacy value. */
export function gradeLabel(grade: string): string {
  return grade === LEGACY_PREP3 ? "Grade 9 (prep-3)" : `Grade ${grade}`;
}

/**
 * Normalise whatever a client sent into a storable interest list.
 * Unknown ids are dropped rather than rejected: a stale client should produce a
 * slightly poorer profile, never a failed student creation (FR-104 — interests
 * must never block).
 */
export function normalizeInterests(raw: unknown): InterestId[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<InterestId>();
  for (const v of raw) {
    if (typeof v === "string" && VALID_INTERESTS.has(v)) seen.add(v as InterestId);
  }
  return [...seen];
}

/**
 * Normalise the optional follow-up detail, keyed by category. Anything we do not
 * recognise is dropped — the tutor must never be handed a "signal" it cannot
 * trust, because FR-203's whole point is that analogies are anchored in something
 * real or not attempted at all.
 */
export function normalizeInterestDetail(
  raw: unknown,
  interests: readonly InterestId[]
): Record<string, InterestDetail> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, InterestDetail> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_INTERESTS.has(key) || !interests.includes(key as InterestId)) continue;
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;

    const detail: InterestDetail = {};
    if (Array.isArray(v.which)) {
      const which = v.which
        .filter((w): w is string => typeof w === "string")
        .map((w) => w.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 5);
      if (which.length) detail.which = which;
    }
    if (typeof v.mode === "string" && v.mode.trim()) {
      detail.mode = v.mode.trim().slice(0, 20);
    }
    if (typeof v.otherText === "string" && v.otherText.trim()) {
      detail.otherText = v.otherText.trim().slice(0, 120);
    }
    if (Object.keys(detail).length) out[key] = detail;
  }

  return Object.keys(out).length ? out : null;
}

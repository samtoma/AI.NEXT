/**
 * Course availability — the RULES, with no database anywhere near them
 * (migration 023, Samuel's call of 2026-09-21).
 *
 * ⚠ NO REQUIREMENT COVERS THIS YET. There is no FR for course availability,
 * none has been invented, and nothing in `traceability.md` was touched. This
 * header is the record until a requirement lands; the tests beside it carry no
 * `@covers` annotation for the same reason.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE, PURE MODULE
 * ---------------------------------------------------------------------------
 * This is a gate on what a fourteen-year-old can reach, which puts it in the
 * small set of decisions that must be *proved* rather than observed working.
 * A rule that lives inside a SQL string can only be tested against a database,
 * which means in practice it is tested once and then trusted. Split out, the
 * whole decision is six lines of arithmetic over plain objects and every branch
 * — including the ones that are hard to reach in a running system, like "the
 * student has no grade" — is a test that runs in `node --test` in milliseconds.
 *
 * `lib/catalog-queries.ts` is the other half: it fetches the rows and applies
 * what is decided here. It holds no rule of its own.
 *
 * ---------------------------------------------------------------------------
 * THE RULE: EXPLICIT ALLOW, OVERRIDE WINS
 * ---------------------------------------------------------------------------
 *   1. A per-student override, if one names the course, decides it outright —
 *      in BOTH directions. It can show a course the grade rule hides (one test
 *      student gets all three subjects without exposing them to the pilot) and
 *      hide one the grade rule shows (one student is cut off without inventing
 *      a grade for them).
 *   2. Otherwise a `live` rule for (course, this student's grade) shows it.
 *   3. Otherwise it is HIDDEN. **No row means hidden**, and that is the whole
 *      design rather than an omission: the most likely state in this table's
 *      life is "nobody has recorded anything about this course yet", and a
 *      course the extraction pipeline loaded overnight must not be on a child's
 *      screen before a person decided it should be.
 *
 * Nothing here reads a commercial status, and nothing here CAN: look at the
 * signature of `isCourseVisible` — grade, rules, overrides. There is no
 * commercial input to pass it. `course_availability.requires_plan` exists as a
 * column and is always NULL; access is not gated on subscription in this
 * release (FR-2404). The console prints the column so an operator can see it is
 * empty (`lib/catalog-queries.ts` `courseCatalog`), and `lib/plan-gate.test.mts`
 * scans this module and the student surfaces to keep that the only reader —
 * the same job `lib/subscription-gate.test.mts` does for `subscription_status`.
 */

// Relative imports with an explicit `.ts`, like `lib/overview-rules.ts` — this
// module is loaded by `node --test`, which has no `@/` alias. `lib/profile.ts`
// imports nothing at all, so the whole graph reachable from here runs outside
// the bundler.
import { GRADES as GRADE_VALUES, LEGACY_PREP3 } from "./profile.ts";

export type CourseState = "live" | "hidden";

/** One row of `course_availability`, reduced to what the decision needs. */
export type AvailabilityRule = {
  courseId: string;
  grade: string;
  state: CourseState;
};

/** One row of `student_course_access`, same reduction. */
export type StudentOverride = { courseId: string; state: CourseState };

/**
 * The grades the product knows, in order, with the labels an Egyptian parent
 * or operator uses. Prep 1–3 is the preparatory stage, Secondary 1–3 the
 * thanaweya years; the numeric value is what `students.grade` stores.
 *
 * The VALUES come from `lib/profile.ts`, which already owns the list the signup
 * form validates against — a second hand-written array here is how a grade gets
 * added in one place, and a whole year of students silently matches no
 * availability rule. Only the labels are new.
 */
const GRADE_LABELS: Record<(typeof GRADE_VALUES)[number], string> = {
  "7": "Prep 1",
  "8": "Prep 2",
  "9": "Prep 3",
  "10": "Secondary 1",
  "11": "Secondary 2",
  "12": "Secondary 3",
};

export const GRADES: readonly { value: string; label: string }[] =
  GRADE_VALUES.map((value) => ({ value, label: GRADE_LABELS[value] }));

/** The Egyptian label for a stored grade; an unknown value keeps its own text
 *  rather than being renamed into a grade it is not. */
export function gradeDisplayLabel(grade: string | null | undefined): string {
  if (grade == null || grade === "") return "—";
  const canonical = canonicalGrade(grade);
  return GRADES.find((g) => g.value === canonical)?.label ?? String(grade);
}

/**
 * The stored grade in the one form the rules are keyed by.
 *
 * `students.grade` holds TWO spellings of the same year: the legacy PoC pinned
 * every student to the literal `"prep-3"` and the baseline database is full of
 * those rows, while a row created since reads `"9"` (lib/profile.ts). Under
 * explicit allow the difference is not cosmetic — a `prep-3` row compared
 * against a rule written for `9` matches nothing, and the student sees an empty
 * product with no error anywhere to explain it. They are the same year, so they
 * are the same key.
 *
 * Returns `null` for a missing or blank grade. `null` is not a grade to look
 * up; it is "we do not know what year this student is in", and under explicit
 * allow that means no grade rule can apply.
 */
export function canonicalGrade(grade: string | null | undefined): string | null {
  if (grade == null) return null;
  const trimmed = String(grade).trim();
  if (trimmed === "") return null;
  return trimmed === LEGACY_PREP3 ? "9" : trimmed;
}

/**
 * May this student see this course?
 *
 * The three steps of the rule, in order, and every path that does not reach an
 * explicit `live` returns false. A student with no grade sees nothing unless an
 * override names the course; an unknown course id — one no rule and no override
 * mentions, including a registry course the spine has never held — is hidden,
 * because there is nothing here that says otherwise.
 */
export function isCourseVisible(
  courseId: string,
  grade: string | null | undefined,
  rules: readonly AvailabilityRule[],
  overrides: readonly StudentOverride[]
): boolean {
  // 1. the exception, and it is decisive in both directions
  const override = overrides.find((o) => o.courseId === courseId);
  if (override) return override.state === "live";

  // 2. the broad rule, for this student's own year
  const canonical = canonicalGrade(grade);
  if (canonical === null) return false;
  const rule = rules.find(
    (r) => r.courseId === courseId && canonicalGrade(r.grade) === canonical
  );

  // 3. and the default, which is the point of the whole design
  return rule?.state === "live";
}

/**
 * Every course this student may see, from the same two inputs.
 *
 * The candidate set is every course either input MENTIONS — not every course
 * in the registry — so a course nobody has recorded anything about never
 * appears, by construction rather than by a filter that could be forgotten.
 *
 * Sorted, for a deterministic result a test can assert on. The order is NOT
 * product order: the order subjects are presented in belongs to the registry
 * (`lib/subjects.ts`), and a caller that used this array to lay out a page
 * would be taking its sequencing from a gate.
 */
export function visibleCourseIds(
  grade: string | null | undefined,
  rules: readonly AvailabilityRule[],
  overrides: readonly StudentOverride[]
): string[] {
  const candidates = new Set<string>([
    ...rules.map((r) => r.courseId),
    ...overrides.map((o) => o.courseId),
  ]);
  return [...candidates]
    .filter((courseId) => isCourseVisible(courseId, grade, rules, overrides))
    .sort();
}

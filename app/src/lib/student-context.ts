/**
 * "Which student is this request about" — now an answer with a signature behind
 * it (ADR-0012, FR-2101/FR-2102).
 *
 * This module used to read a cookie the client could set to any number, check
 * it against the `students` table, and fall back to Omar when it did not like
 * the answer. That was honest for a demo — the header said DEMO AFFORDANCE, NOT
 * AUTH in capitals — and it is gone. The id now comes from
 * `currentPrincipal()`, which resolves it from the verified access token and a
 * live join against `auth_sessions`, so revocation and lockout land within one
 * request. **There is no default student any more.** Anonymous is `null`, and a
 * `null` that reaches a query returns zero rows rather than somebody's lesson.
 *
 * The other half of this module is `scoped`, the seam every data module in the
 * app now goes through. Three cases, and the middle one is the point:
 *
 *  - a caller already inside a unit of work passes its client, and we reuse it,
 *    so one request's reads share one transaction and one principal;
 *  - a caller with a student and no client gets a unit of its own
 *    (`withPrincipal`), because running a student-scoped read on the bare pool
 *    now silently returns nothing — the failure mode is an empty dashboard, not
 *    an error, and empty is exactly what a missing principal looks like;
 *  - no student at all runs on the pool with no principal set, which is the
 *    right shape for the prompt-capture harness and for anything anonymous: it
 *    reads the curriculum (no policies there) and sees no student data.
 *
 * `scoped` is NOT a request-scoped transaction. It wraps a unit of work — see
 * `lib/db.ts` rule 1 — and nothing that calls a model may hold one open.
 *
 * The two resolvers are wrapped in React's `cache()`, which dedupes them per
 * REQUEST (not across requests — that would be a cache of "is this student
 * still allowed in", which is the one thing `currentPrincipal` refuses to
 * cache, and for good reason: revocation and lockout have to land within one
 * request). The reason is the shell: the root layout renders the account menu
 * and the verification banner, and the page inside it renders the student's
 * name, so both call `resolveStudentContext()` and one render was paying for
 * two token verifications, two `auth_sessions` joins and two `students` reads.
 * Outside a render — a route handler — `cache` simply passes the call through,
 * so nothing depends on it being in effect.
 */

import { cache } from "react";
import type { Pool, PoolClient } from "pg";

import { pool, withPrincipal } from "@/lib/db";
import { currentPrincipal } from "@/lib/auth/principal";
import type { Gender } from "@/lib/address";
import { asCurriculumId, type CurriculumId } from "@/lib/curricula";
import { asDesignVariant, type DesignVariant } from "@/lib/design-variant";

/** Either connection shape a query in this codebase can run on. */
export type Db = Pool | PoolClient;

/**
 * Run `fn` with the right connection for this student, in the right unit of
 * work. See the header for the three cases.
 */
export function scoped<T>(
  studentId: number | null | undefined,
  client: Db | undefined,
  fn: (db: Db) => Promise<T>
): Promise<T> {
  if (client) return fn(client);
  if (studentId == null) return fn(pool);
  return withPrincipal(studentId, fn);
}

/** One principal resolution per render, however many surfaces ask for it. */
const principal = cache(currentPrincipal);

/** The signed-in student's id, or null when nobody is signed in. */
export const resolveStudentId = cache(async function resolveStudentId(): Promise<
  number | null
> {
  const me = await principal();
  return me.kind === "student" ? me.studentId : null;
});

export type StudentContext = {
  studentId: number;
  studentName: string;
  emailVerified: boolean;
  gender: Gender;
  /**
   * The two facts the root layout needs to decide which design-system variant
   * this document wears (ADR-0017, FR-1011) — her grade, and her stored
   * override of the rule that reads it.
   *
   * **They ride on this context rather than on a second query**, and that is a
   * correctness decision as much as a cost one. The variant has to be resolved
   * server-side, in the same render that produces the document, or the page
   * renders in one skin and re-renders in the other — which ADR-0017 calls a
   * defect rather than a loading state. The shell already reads this student's
   * row once per render to put her name in the header; adding two columns to
   * that SELECT costs nothing, while a separate read on the layout's critical
   * path would be a second round trip in front of the first byte of every page
   * on the surface.
   *
   * `designVariant` is the OVERRIDE, not the answer. `null` means "no
   * preference stored, follow the grade rule", which is what almost every row
   * holds; `lib/design-variant.ts` is the only place that turns the pair into
   * an answer.
   */
  grade: string | null;
  designVariant: DesignVariant | null;
  /**
   * Her curriculum as stored (`students.curriculum_system`, feature 003) —
   * read in the same SELECT, for the one thing the shell does with it: naming
   * her grade in her curriculum's words (FR-4013; `gradeDisplayLabel`). What
   * she may SEE is never decided from this field; that is the student scope
   * (`lib/catalog-queries.ts`), which validates it.
   */
  curriculum: string | null;
  /**
   * Whether the registry knows that stored value (`lib/curricula.ts`). An
   * unknown one is shown as stored and matches no course (FR-4003); it is
   * never read as National.
   */
  curriculumKnown: boolean;
  /**
   * A first Google sign-in whose grade-and-curriculum step is still owed
   * (FR-4014). From the principal — the same read that says who she is — never
   * a second query that could disagree with it, like `emailVerified`.
   */
  onboardingPending: boolean;
};

const GENDERS = ["female", "male", "unspecified"] as const;

/** A stored value, or `null` for anything else — including a row that predates
 *  the column. `null` is not "masculine"; see lib/address.ts. */
export function asGender(raw: unknown): Gender {
  return (GENDERS as readonly string[]).includes(String(raw))
    ? (raw as Gender)
    : null;
}

/**
 * Everything a shell needs to render itself for the signed-in student, or null
 * when there is nobody to render it for.
 *
 * `emailVerified` travels with the name because the two are read together: the
 * banner that says what is outstanding, and the name beside it. It comes from
 * the principal (the token's account join), never from a second query that
 * could disagree with it.
 *
 * Returns null — not a fallback student — when the row is missing. A principal
 * whose student row has vanished is a broken state, and rendering somebody
 * else's name over it is the worst available answer.
 */
export const resolveStudentContext = cache(async function resolveStudentContext(): Promise<StudentContext | null> {
  const me = await principal();
  if (me.kind !== "student") return null;
  try {
    const row = await withPrincipal(me.studentId, async (c) => {
      const res = await c.query(
        `SELECT display_name, gender, grade, design_variant, curriculum_system
           FROM students WHERE id = $1`,
        [me.studentId]
      );
      return res.rows[0] ?? null;
    });
    if (!row) return null;
    return {
      studentId: me.studentId,
      studentName: (row.display_name as string) ?? "",
      emailVerified: me.emailVerified,
      gender: asGender(row.gender),
      grade: (row.grade as string | null) ?? null,
      // A stored value or null — never a guess. A column holding something
      // neither variant recognises would put an unmatched value in `data-ds`,
      // and an unmatched value renders the frozen baseline's identity, which
      // is the one appearance that is supposed to mean "nobody chose".
      designVariant: asDesignVariant(row.design_variant),
      curriculum: (row.curriculum_system as string | null) ?? null,
      curriculumKnown: asCurriculumId(row.curriculum_system) !== null,
      onboardingPending: me.onboardingPending === true,
    };
  } catch (err) {
    console.error("resolveStudentContext failed:", err);
    return null;
  }
});

/**
 * The full profile the retrieval layer needs (FR-302).
 *
 * Returns null rather than throwing: a tutor turn must degrade to a colder,
 * un-personalised lesson rather than fail, and FR-203 already requires the
 * tutor to skip interest-anchored framing when it has no signal.
 *
 * The optional client is the whole reason this is not a one-liner: `/api/ask`
 * reads the profile, the mastery neighbourhood and the session inside ONE unit
 * of work, and a function that insisted on opening its own would turn one
 * request into four transactions and four connections from a pool of twenty.
 */
export type StudentProfile = {
  id: number;
  displayName: string;
  grade: string;
  interests: string[];
  interestDetail: Record<string, unknown> | null;
  languagePref: string;
  /** As stored; `eg-national-en` when the column is NULL (it never is: 009's
   *  default). Kept for the readers that already take it. */
  curriculumSystem: string;
  /**
   * Feature 003 (contracts/student-api.md): the stored value validated
   * against the registry, `null` when the registry does not know it — never a
   * guess (FR-4003) — and whether it knew it. What she may SEE is decided by
   * the student scope, not by these. Optional in the TYPE only, so the
   * hand-built profiles of the prompt tests stay valid; `getStudentProfile`
   * always sets all three.
   */
  curriculum?: CurriculumId | null;
  curriculumKnown?: boolean;
  /** The first-Google-sign-in step is still owed (FR-4014). A tutor turn
   *  never reaches this while it is: `requireStudent()` answers 403 first. */
  onboardingPending?: boolean;
  /**
   * How the tutor addresses them (FR-2602). It rides on the profile — not on a
   * fourth query, and not on a cache — because `getStudentProfile` is read once
   * per turn, which is exactly what FR-2606 asks for: a student who changes it
   * is addressed correctly by the tutor's next turn, with no sign-out and no
   * new session. `null` and `'unspecified'` mean the same thing downstream
   * (`lib/address.ts`): a form correct for either, never the masculine.
   *
   * It is address and voice ONLY. Nothing in retrieval, mastery, selection or
   * difficulty may read it (FR-2603) and it must never reach an event, a log
   * line or an error message (FR-2604).
   */
  gender: Gender;
};

export async function getStudentProfile(
  studentId: number,
  c?: Db
): Promise<StudentProfile | null> {
  try {
    return await scoped(studentId, c, async (db) => {
      const res = await db.query(
        `SELECT id, display_name, grade, interests, interest_detail,
                language_pref, curriculum_system, gender, onboarding_pending
           FROM students WHERE id = $1`,
        [studentId]
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0];
      return {
        id: Number(r.id),
        displayName: r.display_name as string,
        grade: r.grade as string,
        interests: (r.interests as string[] | null) ?? [],
        interestDetail: (r.interest_detail as Record<string, unknown> | null) ?? null,
        languagePref: (r.language_pref as string) ?? "en",
        curriculumSystem: (r.curriculum_system as string) ?? "eg-national-en",
        curriculum: asCurriculumId(r.curriculum_system),
        curriculumKnown: asCurriculumId(r.curriculum_system) !== null,
        onboardingPending: r.onboarding_pending === true,
        gender: asGender(r.gender),
      };
    });
  } catch (err) {
    console.error("getStudentProfile failed:", err);
    return null;
  }
}

import { cache } from "react";

import { currentPrincipal } from "@/lib/auth/principal";
import { authPool, withOperator, withPrincipal } from "@/lib/db";
import { ENVIRONMENT, IS_CONSOLE, IS_MVP1 } from "@/lib/env";
import {
  MASTER_VARIANT_ENABLED,
  asDesignVariant,
  resolveVariant,
  resolveVariantForOperator,
  type DesignVariant,
} from "@/lib/design-variant";
import { resolveStudentContext } from "@/lib/student-context";

/**
 * Which variant this document wears — the DATABASE SEAM and the one caller the
 * root layout has (ADR-0017, FR-1011, migration 024).
 *
 * ---------------------------------------------------------------------------
 * THE SPLIT, AND WHY IT IS WORTH TWO FILES
 * ---------------------------------------------------------------------------
 * Every decision about which variant wins was already made in
 * `lib/design-variant.ts`, a pure module with unit tests and no database
 * anywhere near it. What is here is only which rows to fetch, under which
 * role, and what the ENVIRONMENT means — the same split `lib/catalog.ts` and
 * `lib/catalog-queries.ts` keep for course availability, for the same reason:
 * a change to this file must not be able to quietly change the rule.
 *
 * ---------------------------------------------------------------------------
 * "RESOLVED BEFORE FIRST PAINT" IS A PROPERTY OF WHERE THIS IS CALLED
 * ---------------------------------------------------------------------------
 * ADR-0017: the variant is "decided server-side and carried on the document
 * element, so no surface renders in one skin and re-renders in the other. A
 * visible skin flip is a defect, not a loading state."
 *
 * That is not something this module can enforce on its own — it is enforced by
 * `app/src/app/layout.tsx` awaiting `documentVariant()` while it builds the
 * `<html>` element, which is the only element in the application that exists
 * before any CSS is applied to anything. Two consequences worth stating so
 * they are not undone by accident:
 *
 *   1. **Nothing here may be moved into a client component or an effect.** A
 *      value the browser learns after hydration arrives one paint too late by
 *      construction, which is the exact defect.
 *   2. **Nothing here may throw.** A failure to read a preference must degrade
 *      to the default variant, not to an error page: the root layout wraps
 *      every route on the surface, so an exception raised here would take out
 *      the whole product over a colour scheme. Every read below catches and
 *      falls back, and says so at the call site.
 *
 * ---------------------------------------------------------------------------
 * TWO ROLES, AND THEY ARE NOT INTERCHANGEABLE
 * ---------------------------------------------------------------------------
 * The student's override is read through `resolveStudentContext()` on
 * `ainext_app`, under migration 017's `students_app_select` policy, so a bug
 * that passed the wrong id would return no row rather than another child's
 * preference. The operator's is read on `ainext_operator`, which is the only
 * role with any privilege on `operators` at all — `ainext_app` has none, by
 * migration 017 and re-checked by 024's verify block, so a student surface
 * cannot learn that operators exist by asking about a colour scheme.
 */

/**
 * The value for `<html data-ds>`, or `undefined` for "write no attribute".
 *
 * **`undefined` is a real answer and it means the frozen baseline.** ADR-0017
 * keeps three states apart: `play`, `master`, and the Ledger identity every
 * surface renders when the attribute is absent. The frozen `family-tutor`
 * baseline is not bound by the Noor system (CLAUDE.md, constitution XII), it
 * has no variants and it must keep rendering byte-identically to before — so
 * on `AINEXT_ENVIRONMENT=baseline` this answers `undefined` and the document
 * carries no `data-ds` at all, exactly as it did before FR-1011.
 *
 * On the comparison build it always answers a NAMED variant and never
 * `undefined`. ADR-0017: "a surface with no attribute is a bug rather than a
 * silent choice" — so an anonymous visitor, a student whose row has vanished
 * and a database that is down all get `play`, the default, rather than an
 * absent attribute that would look like the baseline.
 *
 * `cache()` dedupes it per RENDER, not across requests. The layout is the only
 * caller today; the wrapper is here so that a settings page which also wants
 * to show "what you are looking at right now" cannot turn one render into two
 * round trips.
 */
export const documentVariant = cache(async function documentVariant(): Promise<
  DesignVariant | undefined
> {
  // The frozen baseline keeps the attribute absent. Checked FIRST, before any
  // database work, because on that stack there is nothing to resolve.
  if (!IS_MVP1) return undefined;
  return IS_CONSOLE ? consoleVariant() : studentVariant();
});

/**
 * The student surface's answer: her override, else her grade, else `play`.
 *
 * `resolveStudentContext()` is React-cached and the shell calls it anyway to
 * render the account menu and the verification banner, so this adds no query
 * to the document path — the grade and the override ride on the row that is
 * already being read (see the note on `StudentContext`).
 *
 * A signed-out visitor has no grade and no override, so `resolveVariant`
 * answers with the default. That is the right answer rather than a fallback:
 * the marketing page, the sign-in screen and the signup form are the first
 * thing a fourteen-year-old and her parent see, and they should look like the
 * product the student is about to be handed.
 */
async function studentVariant(): Promise<DesignVariant> {
  const me = await resolveStudentContext();
  return resolveVariant(me?.grade, me?.designVariant);
}

/**
 * The console's answer: the operator's own stored preference, else `master` —
 * and, while Master is hidden, `play` for everybody (see `MASTER_VARIANT_ENABLED`).
 *
 * **An operator tool is not a children's surface**, which is why the default
 * differs from the student product's rather than being copied from it. Play is
 * designed for ages 10–16 — sticker shadows, 52px targets, Baloo across the
 * whole UI — and an operator reading a cost table or a security record all day
 * is none of those things. Nobody on the console has a grade either, so the
 * key the whole ADR turns on does not exist here and a preference is all there
 * is. The console is still SKINNED, not unskinned: constitution XII binds
 * every surface this repository builds, so this returns a named variant and
 * never `undefined`.
 *
 * **This is the root layout's only principal read on the console**, and it is
 * deliberately the narrowest one available: one id in, one column out, nothing
 * rendered from it. The console shell's own `consoleShellAccess()` does the
 * authorisation a moment later in `(console)/layout.console.tsx`; this does
 * not and must not — a refused operator still gets a document, and that
 * document still has to be legible enough to read the refusal on.
 *
 * The cost is honest: `currentPrincipal()` verifies the token and joins
 * `auth_sessions` once more per console render than before FR-1011, because
 * `authorize()` does not share this module's `cache()`. One extra indexed read
 * on an internal tool with four operators, in exchange for the console being
 * inside the design system rather than beside it.
 */
async function consoleVariant(): Promise<DesignVariant> {
  // While Master is hidden (ADR-0017 Amendment, 2026-09-23) no stored
  // preference can change the answer, so the principal read and the column
  // read are skipped rather than paid for on every console render. The answer
  // still comes from the resolver, not from a literal here.
  if (!MASTER_VARIANT_ENABLED) return resolveVariantForOperator(null);
  try {
    const me = await currentPrincipal();
    if (me.kind !== "operator") return resolveVariantForOperator(null);
    return resolveVariantForOperator(await storedOperatorVariant(me.operatorId));
  } catch (err) {
    // An operator who cannot be resolved is not an error to render; it is an
    // operator who has not signed in yet, and the sign-in page needs a skin.
    console.error("[design-variant] console variant resolution failed:", err);
    return resolveVariantForOperator(null);
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * One operator's stored preference, or `null` for "use the console default".
 *
 * Read on `authPool()` rather than through `withOperator()`: this runs on the
 * document path before the shell has authorised anybody, `withOperator` opens
 * a transaction and sets `app.operator_id` for the audit trail, and reading
 * your own colour scheme is not an audited event. The privilege is the same
 * either way — `ainext_operator`, migration 017's `operators_operator_select`
 * policy — and the `WHERE id = $1` is this function's own scoping.
 */
export async function storedOperatorVariant(
  operatorId: number
): Promise<DesignVariant | null> {
  try {
    const res = await authPool().query(
      `SELECT design_variant FROM operators WHERE id = $1`,
      [operatorId]
    );
    return asDesignVariant(res.rows[0]?.design_variant);
  } catch (err) {
    console.error("[design-variant] operator preference read failed:", err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Set or clear the student's own override.
 *
 * `variant === null` CLEARS it, and that is the only way back to the grade
 * rule. There is deliberately no third stored value meaning "defer": a missing
 * value already means exactly that, and a second spelling of one fact would
 * give `lib/design-variant.ts` a branch for a value meaning "ignore me" (the
 * argument migration 023 makes about `student_course_access`, and 024's header
 * repeats for this column).
 *
 * **Which row may be written is the database's answer, not this function's.**
 * `withPrincipal` sets `app.student_id`, and migration 017's
 * `students_app_update` policy scopes the UPDATE to that principal in both its
 * `USING` and its `WITH CHECK` — so the `WHERE id = $1` below is a clarity
 * measure and the refusal of another child's row is structural. That is the
 * whole reason the student surface is allowed to write a `students` column at
 * all when it may write nothing else the console owns.
 *
 * It throws on a database failure, unlike everything on the read path above:
 * this is called from a route handler, where a failure has a status code to
 * become and a student who was told "saved" and was not is worse than one who
 * is told to try again.
 */
export async function setStudentVariant(
  studentId: number,
  variant: DesignVariant | null
): Promise<void> {
  await withPrincipal(studentId, (c) =>
    c.query(`UPDATE students SET design_variant = $2 WHERE id = $1`, [
      studentId,
      variant,
    ])
  );
}

/**
 * Set or clear one operator's console preference.
 *
 * `withOperator` here, unlike the read above, because a write deserves the
 * unit of work and the principal setting even when nothing audits it yet.
 *
 * **The row scoping is the application's, and that is stated rather than
 * glossed.** Migration 017's `operators_operator_update` policy is
 * `USING (true)` — the console has to update ANY operator's lockout
 * bookkeeping during a sign-in that has no principal yet — so the `WHERE
 * id = $1` is the only thing standing between this and another operator's
 * row. The caller therefore takes that id from `authorize()` and never from a
 * request body (`api/console/profile/appearance/route.console.ts`), and the
 * blast radius if that were ever got wrong is one colleague's console colours,
 * which is why the weaker guarantee is acceptable here and is not on
 * `students`.
 */
export async function setOperatorVariant(
  operatorId: number,
  variant: DesignVariant | null
): Promise<void> {
  await withOperator(operatorId, (db) =>
    db.query(`UPDATE operators SET design_variant = $2 WHERE id = $1`, [
      operatorId,
      variant,
    ])
  );
}

/**
 * The environment this resolution happened in.
 *
 * Exported for the two settings surfaces, which say out loud which stack the
 * preference was stored against. Constitution XI keeps the comparison build
 * and the frozen baseline from pooling anything, and a student who set a
 * preference on one stack has not set it on the other — the column is per
 * database, so the two simply cannot see each other. Stating it on the screen
 * is cheaper than someone discovering it.
 */
export const VARIANT_ENVIRONMENT = ENVIRONMENT;

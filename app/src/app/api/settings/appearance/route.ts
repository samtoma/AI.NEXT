import { currentPrincipal } from "@/lib/auth/principal";
import { DESIGN_VARIANTS, isDesignVariant } from "@/lib/design-variant";
import { setStudentVariant } from "@/lib/design-variant-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/appearance — the student's own design-variant override
 * (ADR-0017, FR-1011, migration 024).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SERVER WRITE AND NOT A BROWSER PREFERENCE
 * ---------------------------------------------------------------------------
 * ADR-0017 pins it: the override is "stored server-side against the student,
 * not in browser storage, and it survives sign-out". This endpoint is the only
 * way it is written, and the student surface is allowed to write this one
 * `students` column — every other column on that table it may only read, or is
 * the console's — because this one is hers and is about nothing but her own
 * screen.
 *
 * ---------------------------------------------------------------------------
 * WHOSE ROW, AND WHY THE BODY CANNOT SAY
 * ---------------------------------------------------------------------------
 * **The body carries a variant and nothing else — no student id, ever.** The
 * id comes from `currentPrincipal()`, which resolves it from the verified
 * access token and a live join against `auth_sessions`, and the write runs
 * under `withPrincipal`, so migration 017's `students_app_update` policy scopes
 * it to that principal in both `USING` and `WITH CHECK`. Even an endpoint
 * written wrongly could not reach another child's row: the database refuses,
 * not the WHERE clause. An id in the body would have thrown that away for
 * nothing — this endpoint has exactly one row it could ever mean.
 *
 * ---------------------------------------------------------------------------
 * `null` IS A VALUE HERE, NOT A MISSING FIELD
 * ---------------------------------------------------------------------------
 * `{"variant": null}` CLEARS the override and puts the student back on the
 * grade rule. It is the only way back, and it is the one request shape that
 * must not be mistaken for a malformed body — hence the explicit `=== null`
 * branch below rather than a truthiness check, which would silently turn
 * "clear it" into a 400 and leave a student stuck with a choice she made once.
 *
 * ---------------------------------------------------------------------------
 * NO ANALYTICS EVENT, DELIBERATELY
 * ---------------------------------------------------------------------------
 * `contracts/analytics.md` keeps a CLOSED event vocabulary and this is not in
 * it; inventing one here would widen that vocabulary from a route handler
 * rather than from the contract. Nothing about the product's teaching claims
 * depends on knowing how many students changed their skin, and ADR-0017 names
 * the signal that WOULD matter — "Secondary students choosing Play in numbers"
 * — as a thing to look at when a Secondary cohort exists, which is not now.
 * When it is wanted, it is a contract change first.
 */
export async function POST(req: Request) {
  const me = await currentPrincipal();
  if (me.kind !== "student") {
    // 401 for anonymous and for an operator alike. An operator has a control
    // of their own on the console's `/profile`, and this is not it — a
    // principal with no `students` row has nothing here to change.
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { variant?: unknown };
  try {
    body = (await req.json()) as { variant?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  // Clear, or set: the two things this endpoint does. Anything else is a 400
  // that names the closed set, so a caller learns the real vocabulary instead
  // of a constraint violation from Postgres.
  const variant = body.variant;
  if (variant !== null && !isDesignVariant(variant)) {
    // The closed set comes from the module that owns it, never re-typed here:
    // a second hand-written list of variant names is the drift
    // `design-variant-scan.test.mts` exists to refuse.
    return Response.json(
      { error: "invalid_variant", allowed: [...DESIGN_VARIANTS, null] },
      { status: 400 }
    );
  }

  try {
    await setStudentVariant(me.studentId, variant);
    // The caller reloads the document on a 2xx rather than reading this body.
    // It has to: the variant lives on `<html data-ds>`, which only a fresh
    // document can carry, and re-rendering the page around a stale document
    // element is the skin flip this whole feature exists to avoid.
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[settings] design variant update failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

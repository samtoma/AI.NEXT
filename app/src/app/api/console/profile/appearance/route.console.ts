import { authorize } from "@/lib/auth/authorize";
import { AuthError } from "@/lib/auth/principal";
import { DESIGN_VARIANTS, isDesignVariant } from "@/lib/design-variant";
import { setOperatorVariant } from "@/lib/design-variant-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/console/profile/appearance — one operator's own console skin
 * (ADR-0017, FR-1011, migration 024).
 *
 * ---------------------------------------------------------------------------
 * MIRRORS `api/settings/appearance/route.ts`, ON PURPOSE
 * ---------------------------------------------------------------------------
 * Same body, same closed vocabulary, same meaning for `null` — clear the
 * preference and fall back to the default. Two surfaces answering the same
 * question differently is how a setting starts behaving differently depending
 * on where you set it. What differs is only the seam each one goes through:
 * `.console.ts` is what keeps this address out of the student build
 * (`next.config.ts` `pageExtensions`, FR-2201), proved from the build artefact
 * by `scripts/check-surface-manifest.mts` rather than from a promise, and
 * `authorize()` is the one principal check on the console (FR-2106).
 *
 * ---------------------------------------------------------------------------
 * `authorize({})` — SIGNED IN, NO ROLE
 * ---------------------------------------------------------------------------
 * Any signed-in operator may change the colours of their own console. There is
 * no role for which that is a privilege, and a role gate here would mean an
 * operator admitted to `/profile` could be refused the control the page is
 * showing them. The empty requirement is the same one `/profile` itself
 * carries in `console-routes.ts`, and it is a real check: `authorize({})`
 * refuses anonymous, and `principal.ts` has already downgraded any student
 * credential presented to this build to anonymous (FR-2205).
 *
 * ---------------------------------------------------------------------------
 * WHOSE ROW — THE HONEST VERSION
 * ---------------------------------------------------------------------------
 * **The body carries no operator id.** `me.operatorId` comes from
 * `authorize()`, and `setOperatorVariant` writes `WHERE id = $1` with it.
 *
 * Unlike the student endpoint, that WHERE clause is the *only* thing scoping
 * the write: migration 017's `operators_operator_update` policy is
 * `USING (true)`, because the console must update ANY operator's lockout
 * bookkeeping during a sign-in that has no principal yet, and narrowing it for
 * this feature would break sign-in. So the guarantee here is the application's
 * rather than the database's, it is written down in migration 024's header as
 * well as this one, and the reason it is acceptable is proportion: the worst
 * case is a colleague's console rendering in the other palette, which is a
 * nuisance and not a disclosure. The student endpoint gets the strong
 * guarantee because the student column sits on a table full of children's
 * records; this one does not.
 *
 * ---------------------------------------------------------------------------
 * NO AUDIT ROW
 * ---------------------------------------------------------------------------
 * `operator_reads` records an operator reading a STUDENT (FR-2306). This reads
 * no student, names no student and cannot reach one; writing an audit row for
 * "changed my own colours" would dilute a log whose value is that every line
 * in it is somebody looking at a child's record.
 */
export async function POST(req: Request) {
  let me;
  try {
    me = await authorize({});
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
  // `authorize` has already refused anonymous; this narrows the type for the
  // write below and re-refuses a principal that is somehow not an operator
  // rather than assuming the branch is unreachable.
  if (me.kind !== "operator") {
    return Response.json({ error: "permission_denied" }, { status: 403 });
  }

  let body: { variant?: unknown };
  try {
    body = (await req.json()) as { variant?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  // `null` is a value, not a missing field: it clears the preference and puts
  // this operator back on the console default. An `if (!variant)` here would
  // turn "clear it" into a 400 and leave the choice unreversible.
  const variant = body.variant;
  if (variant !== null && !isDesignVariant(variant)) {
    // From the module that owns the set, not re-typed — the student endpoint
    // makes the same choice for the same reason.
    return Response.json(
      { error: "invalid_variant", allowed: [...DESIGN_VARIANTS, null] },
      { status: 400 }
    );
  }

  try {
    await setOperatorVariant(me.operatorId, variant);
    // The caller reloads the document on a 2xx rather than reading this body —
    // the variant lives on `<html data-ds>`, which only a fresh document can
    // carry (`DesignVariantPicker`'s header says why at length).
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[console] design variant update failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

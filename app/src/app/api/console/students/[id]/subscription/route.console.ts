/**
 * POST /api/console/students/{id}/subscription — set a student's commercial
 * status (FR-2404, FR-2405, contracts/admin.md §6).
 *
 * ---------------------------------------------------------------------------
 * IT GATES NOTHING, AND THAT IS A REQUIREMENT
 * ---------------------------------------------------------------------------
 * There is **no payment system behind this** in this release (FR-2904 is
 * deferred). `subscription_status` is a record an operator keeps, and FR-2404
 * is explicit about the three things it must never become: it must not gate
 * access, it must not be shown to a student as a plan, and it must not be
 * described anywhere as a payment having happened. No student surface reads the
 * column — `lib/subscription-gate.test.mts` asserts that by scanning the source
 * rather than trusting this comment.
 *
 * ---------------------------------------------------------------------------
 * WHY A ROUTE HANDLER AND NOT A SERVER ACTION
 * ---------------------------------------------------------------------------
 * `.console.ts` is what keeps this address out of the student build entirely
 * (`next.config.ts` `pageExtensions`, FR-2201) — the same mechanism that
 * excludes every console page, applied to the console's first write endpoint.
 * A server action lives inside whichever page imports it and would have to be
 * excluded by remembering to; a route file is excluded by its name, and
 * `scripts/check-surface-manifest.mts` proves it from the build artefact.
 *
 * **`cost-billing` and nothing else** (FR-2405). The check is `authorize`'s,
 * because nothing else in this application performs a role check (FR-2106),
 * and a refusal is recorded as `permission_denied` by the seam itself.
 *
 * **Who changed it and when are columns, not a comment**:
 * `subscription_updated_by` and `subscription_updated_at` are written in the
 * same statement as the status, so a change without an author is not a state
 * this endpoint can produce. Migration 017 grants `ainext_operator` UPDATE on
 * exactly these four columns and no others — the narrowness is a privilege,
 * not a promise the handler keeps.
 */

import { authorize } from "@/lib/auth/authorize";
import { AuthError } from "@/lib/auth/principal";
import { withOperator } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The four values `students.subscription_status` admits (data-model §8). */
const STATUSES = ["none", "trial", "active", "lapsed"] as const;
type SubscriptionStatus = (typeof STATUSES)[number];

const isStatus = (v: unknown): v is SubscriptionStatus =>
  typeof v === "string" && (STATUSES as readonly string[]).includes(v);

/** Long enough for "paid by InstaPay 2026-09-20, receipt with Samuel". */
const MAX_NOTE = 280;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let me;
  try {
    me = await authorize({ role: "cost-billing" });
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
  // `authorize` has already refused anything that is not an operator holding
  // the role; this narrows the type rather than re-deciding anything.
  if (me.kind !== "operator") {
    return Response.json({ error: "permission_denied" }, { status: 403 });
  }

  const studentId = Number((await ctx.params).id);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  let body: { status?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isStatus(body.status)) {
    // The valid set is named: this is an internal tool and an operator who
    // mistypes deserves to be told what the four words are.
    return Response.json(
      { error: "invalid_status", allowed: STATUSES },
      { status: 400 }
    );
  }
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, MAX_NOTE)
      : null;

  try {
    const row = await withOperator(me.operatorId, async (client) => {
      const res = await client.query(
        `UPDATE students
            SET subscription_status     = $2,
                subscription_note       = $3,
                subscription_updated_at = now(),
                subscription_updated_by = $4
          WHERE id = $1 AND environment = $5
      RETURNING subscription_status, subscription_note, subscription_updated_at`,
        [studentId, body.status, note, me.operatorId, ENVIRONMENT]
      );
      return res.rows[0] ?? null;
    });

    // A student in another environment is not here. 404 rather than 403, the
    // same rule the rest of this feature applies: "not yours" and "not there"
    // are one answer, so neither can be mined for the other.
    if (!row) return Response.json({ error: "not_found" }, { status: 404 });

    return Response.json({
      status: String(row.subscription_status),
      note: (row.subscription_note as string | null) ?? null,
      updatedAt: new Date(row.subscription_updated_at as string).toISOString(),
      updatedBy: me.operatorId,
    });
  } catch (err) {
    console.error("[console] subscription update failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

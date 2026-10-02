/**
 * GET /api/console/review/fix-requests — the review gate's fix list, as JSON
 * the pipeline and its agents work from (migration 036; answer 37).
 *
 * Every item whose latest human decision is "fix requested" and that has NOT
 * changed since (a fixed item leaves the list by itself and comes back to the
 * review queue), plus every rejection the gate cannot act on by itself — a
 * misconception, worked example, objective or prerequisite link has no status
 * a reviewer can flip, so its rejection is the pipeline's to carry out. Each
 * entry carries the reviewer's note, their suggested correction, who and
 * when, the content fingerprint and the snapshot of what they saw.
 *
 * `content-review`, like the page that links to it. Scripts with database
 * access read the same list with `npm run review:export-fixes`
 * (`app/scripts/export-review-fixes.mts`).
 */

import { authorize } from "@/lib/auth/authorize";
import { AuthError } from "@/lib/auth/principal";
import { ENVIRONMENT } from "@/lib/env";
import { exportFixRequests } from "@/lib/review-gate-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let me;
  try {
    me = await authorize({ role: "content-review" });
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
  if (me.kind !== "operator") {
    return Response.json({ error: "permission_denied" }, { status: 403 });
  }
  try {
    const entries = await exportFixRequests(me.operatorId);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(
      JSON.stringify({ environment: ENVIRONMENT, exportedAt: new Date().toISOString(), entries }, null, 2),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="review-fix-requests-${ENVIRONMENT}-${day}.json"`,
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err) {
    console.error("[console] review fix-request export failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

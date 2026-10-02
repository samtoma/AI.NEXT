/**
 * POST /api/console/review — the review gate's one-by-one queue (migration
 * 036; Samuel's answer 37; `lib/review-gate.ts`, `lib/review-gate-queries.ts`).
 *
 *   { "action": "next",   "filters": {kind?, course?, module?, reason?}, "skip": ["<kind>|<ref>", …] }
 *       → claim and return the next item for this reviewer (their own open
 *         claim first, then the oldest open item nobody else holds)
 *   { "action": "decide", "kind", "ref", "fingerprint", "decision", "note"?,
 *     "suggestedCorrection"?, "filters", "skip" }
 *       → record the decision, apply its effect, release the claim, and
 *         return the next item in the same response
 *
 * `content-review` alone, like `/content` and `/courses`: whoever decides what
 * unreviewed content reaches a child is the role that signs it as reviewed or
 * retires it (FR-2204 — a safety control, and exercising it is recorded: every
 * decision is a row in `review_decisions`, append-only). `authorize({ role })`
 * is the only role check (FR-2106) and records its own refusal.
 *
 * `.console.ts`, so the student build has no such address (FR-2201,
 * `scripts/check-surface-manifest.mts`). The body never names an operator:
 * who decided comes from the principal, and 036's RLS refuses a decision
 * written in anybody else's name.
 */

import { authorize } from "@/lib/auth/authorize";
import { AuthError } from "@/lib/auth/principal";
import { itemKey, isItemKind, parseFilters } from "@/lib/review-gate";
import { decideAs, nextItemFor, parseDecideInput } from "@/lib/review-gate-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A reviewer skips a handful of items in a sitting, not hundreds. */
const MAX_SKIP = 200;

function skipSet(raw: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(raw)) return out;
  for (const s of raw.slice(0, MAX_SKIP)) {
    if (typeof s !== "string") continue;
    const at = s.indexOf("|");
    const kind = s.slice(0, at);
    const ref = s.slice(at + 1);
    if (at > 0 && isItemKind(kind) && ref.length > 0 && ref.length <= 400) out.add(itemKey(kind, ref));
  }
  return out;
}

export async function POST(req: Request) {
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

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const filters = parseFilters((body.filters ?? {}) as Record<string, unknown>);
  const skip = skipSet(body.skip);

  try {
    if (body.action === "next") {
      return Response.json(await nextItemFor(me.operatorId, filters, skip));
    }
    if (body.action === "decide") {
      const input = parseDecideInput(body);
      if ("error" in input) return Response.json({ error: "invalid", message: input.error }, { status: 400 });
      const result = await decideAs(me.operatorId, input);
      if (!result.ok) {
        return Response.json({ error: result.error, message: result.message }, { status: result.status });
      }
      const next = await nextItemFor(me.operatorId, filters, skip);
      return Response.json({ decided: result, ...next });
    }
    return Response.json({ error: "invalid", message: "action must be next or decide" }, { status: 400 });
  } catch (err) {
    console.error("[console] review gate request failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/**
 * POST /api/console/teaching — move the Socratic-probing switch (ADR-0021,
 * migration 030, `lib/teaching-queries.ts setProbingSetting`).
 *
 *   body: { probing: "off" | "testers" | "everyone", note?: string }
 *
 * ---------------------------------------------------------------------------
 * `teaching-controls` AND NOTHING ELSE
 * ---------------------------------------------------------------------------
 * The switch decides how the tutor answers a child who got it wrong, which is
 * a safety control in ADR-0014's sense. It was first specified under
 * `content-review` and moved to a role of its own the same day (Samuel,
 * 2026-09-24) so it can be narrowed without touching who reviews content.
 * The check is `authorize`'s, because nothing else in this application
 * performs a role check (FR-2106), and a refusal is recorded there as
 * `permission_denied`.
 *
 * ---------------------------------------------------------------------------
 * "EVERYONE" IS REFUSED HERE, NOT ONLY GREYED OUT THERE
 * ---------------------------------------------------------------------------
 * The page renders the option disabled with "Not ready yet — see issue #53".
 * That is presentation (FR-2107: hiding a control is not authorisation); a
 * request built by hand reaches this line, and while
 * `PROBING_EVERYONE_UNLOCKED` is false it answers 409 `everyone_locked`
 * whoever is asking — a role does not unlock it, #53 does.
 *
 * ---------------------------------------------------------------------------
 * WHAT A CHANGE REACHES
 * ---------------------------------------------------------------------------
 * Only lessons that START after it. Each learning session resolves probing
 * once, when it opens, and stores the answer (`lib/sessions.ts`); a lesson in
 * progress keeps the answer it opened with. The response says so, so the page
 * can too.
 */

import { authorize } from "@/lib/auth/authorize";
import { AuthError } from "@/lib/auth/principal";
import {
  PROBING_EVERYONE_LOCK_NOTE,
  PROBING_SETTINGS,
  settingChangeRefusal,
  type ProbingSetting,
} from "@/lib/socratic-probing";
import { setProbingSetting } from "@/lib/teaching-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same bound as the other console notes. */
const MAX_NOTE = 280;

const isSetting = (v: unknown): v is ProbingSetting =>
  typeof v === "string" && (PROBING_SETTINGS as readonly string[]).includes(v);

export async function POST(req: Request) {
  let me;
  try {
    me = await authorize({ role: "teaching-controls" });
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
  if (me.kind !== "operator") {
    return Response.json({ error: "permission_denied" }, { status: 403 });
  }

  let body: { probing?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isSetting(body.probing)) {
    return Response.json(
      { error: "invalid_setting", allowed: PROBING_SETTINGS },
      { status: 400 }
    );
  }
  const refusal = settingChangeRefusal(body.probing);
  if (refusal) {
    return Response.json(
      { error: refusal, reason: PROBING_EVERYONE_LOCK_NOTE },
      { status: 409 }
    );
  }
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, MAX_NOTE)
      : null;

  try {
    const out = await setProbingSetting(me.operatorId, body.probing, note);
    return Response.json({
      ok: true,
      changed: out.changed,
      from: out.from ?? "off",
      to: out.to,
      appliesTo: "lessons that start from now on; a lesson in progress keeps its setting",
    });
  } catch (err) {
    console.error("[console] teaching switch update failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/**
 * POST /api/auth/dev-operator — LOCAL DEVELOPMENT ONLY: sign in as an operator
 * chosen from a list, with no credential (ADR-0022, FR-3309).
 *
 * **This file is absent from every production build.** Its name ends
 * `.dev.console.ts`, and `next.config.ts` makes that a page extension only on
 * the console build and only when `NODE_ENV` is not `production` — so
 * `next build` (which is always production) never compiles it, and
 * `npm run check:surface:admin` fails if the address ever appears in the
 * console's production route manifest. On the student build it is never a
 * route at all.
 *
 * **And it re-checks all three locks itself** (`dev-picker.ts`): not
 * production, `AINEXT_DEV_OPERATOR_PICKER=on`, and a request to localhost. The
 * page that draws the buttons checks the same three, but hiding a button is
 * not authorisation (FR-2107) — a hand-built POST gets exactly the same answer
 * as a click. A refused request gets a bare 404, as if the endpoint did not
 * exist, and a `permission_denied` row saying which lock held.
 *
 * On success it starts a session through the same `signInOperator` the
 * Cloudflare route uses — same session machinery as a password sign-in — and
 * records `operator_login` with reason `dev-picker:<roles>`.
 *
 * A plain HTML form posts here (no script needed), so the answer is a 303 to
 * `next`.
 */

import { cookies } from "next/headers";

import { safeNext } from "@/components/auth/next-param";
import { accessCookie, applyCookies, cookieNames, refreshCookie } from "@/lib/auth/cookies";
import { devPickerDecisionFor } from "@/lib/auth/dev-picker";
import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import { signInOperator } from "@/lib/auth/operator-signin";
import { withAuthTx } from "@/lib/auth/session";
import { signAccessToken, verifyAccessToken } from "@/lib/auth/tokens";
import { ENVIRONMENT, SURFACE } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAMES = cookieNames("admin");

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const meta = requestMeta(req);
  const decision = devPickerDecisionFor(req.headers);
  const refusedBecause =
    SURFACE !== "admin" ? "not_console" : decision.allowed ? null : decision.why;
  if (refusedBecause !== null) {
    await recordAuthEvent({
      event: "permission_denied",
      outcome: "denied",
      actor: { kind: "anonymous" },
      subject: { kind: "dev_picker" },
      reason: `dev-picker:refused:${refusedBecause}`,
      ...meta,
    });
    return new Response(null, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return seeOther("/signin");
  }
  const operatorId = Number(form.get("operatorId"));
  const next = safeNext(typeof form.get("next") === "string" ? String(form.get("next")) : null, "/");
  if (!Number.isInteger(operatorId) || operatorId <= 0) return seeOther("/signin");

  const jar = await cookies();
  const accessRaw = jar.get(NAMES.access)?.value;
  const claims = accessRaw ? await verifyAccessToken(accessRaw, ENVIRONMENT) : null;

  try {
    const outcome = await withAuthTx((db) =>
      signInOperator(
        db,
        { operatorId },
        "dev-picker",
        {
          refreshToken: jar.get(NAMES.refresh)?.value ?? null,
          accessSessionId: claims && claims.knd === "operator" ? claims.sid : null,
        },
        recordAuthEvent,
        { ...meta, environment: ENVIRONMENT }
      )
    );
    if (outcome.kind === "unchanged") return seeOther(next);
    if (outcome.kind !== "ok") return seeOther("/signin");

    const token = await signAccessToken({
      sub: outcome.operatorId,
      knd: "operator",
      sid: outcome.sessionId,
      env: ENVIRONMENT,
    });
    return applyCookies(seeOther(next), [
      accessCookie(token, undefined, "admin"),
      refreshCookie(outcome.token, outcome.expiresAt, undefined, "admin"),
    ]);
  } catch (err) {
    console.error("[auth] dev-picker sign-in failed:", err);
    return seeOther("/signin");
  }
}

/**
 * GET /api/auth/google/callback — finish the handshake at the SAME place a
 * password sign-in finishes.
 *
 * **No token, id, name or picture ever appears in this redirect URL.** That is
 * Talent's live gap (R1 §2 point 4) and the reason this endpoint is specified
 * rather than ported: its callback puts a working access token plus the user's
 * identity into a query string, which lands in browser history, referrer
 * headers and the access log of every hop. Here the browser gets a bare
 * `302 /student` and two HttpOnly cookies.
 *
 * The upsert is Talent's and it is right: match on normalised email, **link** an
 * existing password account rather than erroring on it. A different
 * `google_sub` on the same address is the one refusal — `?error=account_conflict`
 * plus `suspicious_activity`.
 */

import {
  OAUTH_STATE_COOKIE,
  REFRESH_COOKIE_PATH,
  accessCookie,
  applyCookies,
  cleared,
  refreshCookie,
} from "@/lib/auth/cookies";
import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import {
  GOOGLE_DEFAULT_GRADE,
  completeGoogleLogin,
  googleConfigured,
  upsertGoogleAccount,
} from "@/lib/auth/google";
import { createAuthSession, withAuthTx } from "@/lib/auth/session";
import { signAccessToken, verifyStateToken } from "@/lib/auth/tokens";
import { emit } from "@/lib/analytics";
import { ENVIRONMENT, PUBLIC_URL } from "@/lib/env";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bounce(error: string): Response {
  return applyCookies(
    new Response(null, {
      status: 302,
      headers: { Location: `${PUBLIC_URL}/signin?error=${encodeURIComponent(error)}` },
    }),
    [cleared(OAUTH_STATE_COOKIE, REFRESH_COOKIE_PATH)]
  );
}

export async function GET(req: Request) {
  if (!googleConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });

  const meta = requestMeta(req);
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return bounce("oauth_failed");

  const jar = await cookies();
  const envelope = jar.get(OAUTH_STATE_COOKIE)?.value;
  if (!envelope) return bounce("oauth_failed");
  const payload = await verifyStateToken(envelope);
  if (!payload || payload.state !== state || typeof payload.verifier !== "string") {
    return bounce("oauth_failed");
  }

  const profile = await completeGoogleLogin(code, payload.verifier);
  if (!profile) return bounce("oauth_failed");
  if (!profile.emailVerified) return bounce("oauth_unverified_email");

  try {
    const outcome = await withAuthTx(async (db) => {
      const upsert = await upsertGoogleAccount(db, profile, ENVIRONMENT, recordAuthEvent, meta);
      if (upsert.kind === "conflict") return upsert;
      const session = await createAuthSession(
        db,
        { accountId: upsert.accountId },
        { ...meta, environment: ENVIRONMENT }
      );
      return { ...upsert, session };
    });

    if (outcome.kind === "conflict") return bounce("account_conflict");

    const token = await signAccessToken({
      sub: outcome.accountId,
      knd: "student",
      stu: outcome.studentId,
      sid: outcome.session.id,
      env: ENVIRONMENT,
    });

    await recordAuthEvent({
      event: "oauth_login",
      outcome: "success",
      actor: { kind: "account", id: outcome.accountId },
      reason: "google",
      ...meta,
    });
    await recordAuthEvent({
      event: "successful_login",
      outcome: "success",
      actor: { kind: "account", id: outcome.accountId },
      reason: "google",
      ...meta,
    });
    if (outcome.created) {
      void emit({
        event: "account_created",
        studentId: outcome.studentId,
        properties: { method: "google", grade: GOOGLE_DEFAULT_GRADE },
      });
    }

    return applyCookies(
      new Response(null, { status: 302, headers: { Location: `${PUBLIC_URL}/student` } }),
      [
        accessCookie(token),
        refreshCookie(outcome.session.token, outcome.session.expiresAt),
        cleared(OAUTH_STATE_COOKIE, REFRESH_COOKIE_PATH),
      ]
    );
  } catch (err) {
    console.error("[auth] google callback failed:", err);
    return bounce("oauth_failed");
  }
}

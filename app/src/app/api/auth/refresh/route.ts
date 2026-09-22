/**
 * POST /api/auth/refresh — rotate the refresh token, mint a new access token.
 *
 * Rotation is in place on the same `auth_sessions` row, so the session list a
 * student sees stays "the places I am signed in" rather than a log of every
 * fifteen minutes (data-model §4).
 *
 * **Presenting an already-rotated token revokes every session for that
 * principal** (FR-2008) and emits `suspicious_activity` + one `session_revoked`
 * per row. Either the token was stolen and the thief is using it, or it was
 * stolen and the student is; there is no third case and no way to tell which,
 * so the only safe answer is to end all of them and make the student sign in
 * again. Talent's own architecture document lists the absence of this as a
 * known gap — it is the one behaviour that cannot be retrofitted cheaply,
 * because it needs `rotated_from` written from the first rotation onward.
 *
 * Every failure clears BOTH cookies. A refresh cookie that does not work is a
 * cookie whose only remaining effect is to make the next request look signed in.
 *
 * **F-P2b, FR-2205**: `surface` (this build's — `SURFACE` from `@/lib/env`) is
 * threaded through both the cookie NAME read/written and `rotateRefreshToken`
 * itself. A token that belongs to the other surface's principal now fails the
 * lookup entirely — `rotateRefreshToken` returns `wrong_surface` (logged as
 * `permission_denied`/`cross_surface_refresh`) rather than `rotated`, and
 * crucially never touched that session's row. It falls into the same
 * `!== "rotated"` branch as every other refusal below and gets the same
 * answer: 401, both of THIS surface's cookies cleared, nothing else.
 */

import { cookies } from "next/headers";

import {
  ACCESS_COOKIE_PATH,
  REFRESH_COOKIE_PATH,
  accessCookie,
  applyCookies,
  cleared,
  clearedAuthCookies,
  cookieNames,
  refreshCookie,
} from "@/lib/auth/cookies";
import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import { rotateRefreshToken, withAuthTx } from "@/lib/auth/session";
import { signAccessToken } from "@/lib/auth/tokens";
import { ENVIRONMENT, SURFACE } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { access: ACCESS_COOKIE, refresh: REFRESH_COOKIE } = cookieNames(SURFACE);

function refused(): Response {
  return applyCookies(
    Response.json({ error: "invalid_credentials" }, { status: 401 }),
    clearedAuthCookies(undefined, SURFACE)
  );
}

export async function POST(req: Request) {
  const meta = requestMeta(req);
  const jar = await cookies();
  const presented = jar.get(REFRESH_COOKIE)?.value;
  if (!presented) return refused();

  try {
    const result = await withAuthTx((db) =>
      rotateRefreshToken(
        db,
        presented,
        { ...meta, environment: ENVIRONMENT },
        recordAuthEvent,
        undefined,
        SURFACE
      )
    );
    if (result.kind !== "rotated") return refused();

    const isStudent = "accountId" in result.ref;
    let studentId: number | null = null;
    if (isStudent) {
      const { pool } = await import("@/lib/db");
      const res = await pool.query(`SELECT id FROM students WHERE account_id = $1`, [
        (result.ref as { accountId: number }).accountId,
      ]);
      studentId = res.rows[0] ? Number(res.rows[0].id) : null;
    }

    const token = await signAccessToken({
      sub: isStudent
        ? (result.ref as { accountId: number }).accountId
        : (result.ref as { operatorId: number }).operatorId,
      knd: isStudent ? "student" : "operator",
      ...(studentId != null ? { stu: studentId } : {}),
      sid: result.sessionId,
      env: ENVIRONMENT,
    });

    return applyCookies(Response.json({ ok: true }), [
      accessCookie(token, undefined, SURFACE),
      refreshCookie(result.token, result.expiresAt, undefined, SURFACE),
    ]);
  } catch (err) {
    console.error("[auth] refresh failed:", err);
    // Clear on the way out either way: a half-rotated cookie is worse than none.
    return applyCookies(Response.json({ error: "server_error" }, { status: 500 }), [
      cleared(ACCESS_COOKIE, ACCESS_COOKIE_PATH),
      cleared(REFRESH_COOKIE, REFRESH_COOKIE_PATH),
    ]);
  }
}

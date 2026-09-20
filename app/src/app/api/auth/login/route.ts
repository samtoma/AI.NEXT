/**
 * POST /api/auth/login — one endpoint, two tables, one code path.
 *
 * On the student build this authenticates against `accounts`. On the console
 * build (`AINEXT_SURFACE=admin`, which P2 introduces — read defensively here)
 * it authenticates against `operators` and emits `operator_login` with the
 * roles in effect (FR-2207). A student credential presented to the console is
 * refused with `permission_denied` and never silently accepted (FR-2205).
 *
 * **The 401 is identical for a wrong password and an address with no account**
 * — same body, same status, and the same Argon2id work, because the no-account
 * branch burns a dummy verification (contracts/auth.md cross-cutting 2). The
 * distinguishing detail goes to `auth_events.reason` and nowhere a client can
 * see. Four other outcomes are distinguishable and deliberately so: `423`
 * locked with `until`, `403` disabled, `403` wrong surface, `429` throttled.
 *
 * Nothing about the password reaches this file. `authenticateCredential` takes
 * it, `password.ts` hashes it, and neither hands anything back but a verdict.
 */

import { accessCookie, applyCookies, refreshCookie } from "@/lib/auth/cookies";
import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import {
  authenticateCredential,
  createAuthSession,
  withAuthTx,
  type AuthSurface,
} from "@/lib/auth/session";
import { signAccessToken } from "@/lib/auth/tokens";
import { ipOverLimit, noteIpFailure } from "@/lib/auth/throttle";
import { ENVIRONMENT } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** P2 introduces AINEXT_SURFACE; until then every build is the student one. */
function surface(): AuthSurface {
  return process.env.AINEXT_SURFACE === "admin" ? "admin" : "student";
}

export async function POST(req: Request) {
  const meta = requestMeta(req);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* fall through: an unparseable body is an invalid credential */
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  try {
    const result = await withAuthTx(async (db) => {
      const throttled = await ipOverLimit(db, meta.ip);
      if (throttled.over) return { kind: "throttled" as const, retryAfter: throttled.retryAfter };

      if (!email || !password) {
        await noteIpFailure(db, meta.ip, recordAuthEvent, meta);
        await recordAuthEvent({
          event: "failed_login",
          outcome: "failure",
          actor: { kind: "anonymous" },
          reason: "missing_credential",
          ...meta,
        });
        return { kind: "invalid" as const };
      }

      const credential = await authenticateCredential(
        db,
        surface(),
        email,
        password,
        recordAuthEvent,
        meta
      );
      if (credential.kind !== "ok") {
        await noteIpFailure(db, meta.ip, recordAuthEvent, meta);
        return credential;
      }

      const session = await createAuthSession(
        db,
        credential.table === "accounts"
          ? { accountId: credential.id }
          : { operatorId: credential.id },
        { ...meta, environment: ENVIRONMENT }
      );
      return { ...credential, session };
    });

    switch (result.kind) {
      case "throttled":
        await recordAuthEvent({
          event: "suspicious_activity",
          outcome: "denied",
          actor: { kind: "anonymous" },
          reason: "login_ip_throttled",
          ...meta,
        });
        return Response.json(
          { error: "too_many_requests", retryAfter: result.retryAfter },
          { status: 429, headers: { "Retry-After": String(result.retryAfter) } }
        );
      case "invalid":
        return Response.json({ error: "invalid_credentials" }, { status: 401 });
      case "locked":
        return Response.json(
          { error: "locked", until: result.until.toISOString() },
          { status: 423 }
        );
      case "disabled":
        return Response.json({ error: "disabled" }, { status: 403 });
      case "wrong_surface":
        return Response.json({ error: "permission_denied" }, { status: 403 });
    }

    const token = await signAccessToken({
      sub: result.id,
      knd: result.table === "operators" ? "operator" : "student",
      ...(result.studentId != null ? { stu: result.studentId } : {}),
      sid: result.session.id,
      env: ENVIRONMENT,
    });

    return applyCookies(
      Response.json({
        studentId: result.studentId,
        displayName: result.displayName,
        emailVerified: result.emailVerified,
        ...(result.table === "operators" ? { roles: result.roles } : {}),
      }),
      [accessCookie(token), refreshCookie(result.session.token, result.session.expiresAt)]
    );
  } catch (err) {
    console.error("[auth] login failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

/**
 * Who is asking — resolved from the access cookie, on every request, with no cache.
 *
 * The signature check comes first because it is free: a forged or expired
 * cookie is rejected before any database connection is checked out, which
 * matters under R7's pool budget where a held connection is a connection some
 * other student's lesson is waiting for.
 *
 * Then exactly ONE indexed read (research R2's departure from Talent). Talent
 * decodes its JWT and re-reads the user to confirm they still exist, costing a
 * round trip per request; we spend the same round trip but get more for it —
 * the query joins `auth_sessions`, so **revocation, lockout, disabling and
 * deletion take effect within one request** rather than at the next fifteen-
 * minute token expiry. FR-2012 says signing out ends the sign-in immediately;
 * this join is what makes that true instead of nearly true.
 *
 * Deliberately NOT cached, per-request or otherwise. A cache here is a cache of
 * "is this student still allowed in", and the answer's whole value is that it
 * is current.
 *
 * `currentPrincipal` never throws: an anonymous visitor is an answer, not an
 * error. `requireStudent` is where the 401 lives, so route handlers read as one
 * line rather than as a null check nobody forgets until they do.
 */

import { cookies } from "next/headers";

import { pool, type Principal } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";

import { ACCESS_COOKIE } from "./cookies.ts";
import { verifyAccessToken, type AccessClaims } from "./tokens.ts";
import type { OperatorRole } from "./session.ts";

export type { Principal };

/** The refusals this layer can produce, carrying the status the contract names. */
export class AuthError extends Error {
  readonly status: 401 | 403 | 423 | 429;
  readonly code: string;

  constructor(status: 401 | 403 | 423 | 429, code: string, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }

  /** The body every refusal answers with — a code, never a reason a client can mine. */
  toResponse(): Response {
    return Response.json({ error: this.code }, { status: this.status });
  }
}

const ANONYMOUS: Principal = { kind: "anonymous" };

/** The verified claims, for the two places that need `sid` rather than a Principal. */
export async function currentClaims(): Promise<AccessClaims | null> {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  return verifyAccessToken(token, ENVIRONMENT);
}

export async function currentPrincipal(): Promise<Principal> {
  try {
    const claims = await currentClaims();
    if (!claims) return ANONYMOUS;
    return claims.knd === "operator"
      ? await loadOperatorPrincipal(claims)
      : await loadStudentPrincipal(claims);
  } catch (err) {
    // A database that is down is not a licence to treat a visitor as signed in.
    console.error("[auth] principal resolution failed:", err);
    return ANONYMOUS;
  }
}

async function loadStudentPrincipal(claims: AccessClaims): Promise<Principal> {
  const res = await pool.query(
    `SELECT s.id AS student_id, a.id AS account_id, a.email_verified_at
       FROM auth_sessions x
       JOIN accounts a ON a.id = x.account_id
       JOIN students s ON s.account_id = a.id
      WHERE x.id = $1 AND x.account_id = $2
        AND x.revoked_at IS NULL AND x.expires_at > now()
        AND a.status <> 'disabled'
      LIMIT 1`,
    [claims.sid, claims.sub]
  );
  const row = res.rows[0];
  if (!row) return ANONYMOUS;
  return {
    kind: "student",
    studentId: Number(row.student_id),
    accountId: Number(row.account_id),
    emailVerified: row.email_verified_at != null,
  };
}

async function loadOperatorPrincipal(claims: AccessClaims): Promise<Principal> {
  const res = await pool.query(
    `SELECT o.id,
            coalesce(array_agg(DISTINCT r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
       FROM auth_sessions x
       JOIN operators o ON o.id = x.operator_id
       LEFT JOIN operator_roles r ON r.operator_id = o.id AND r.revoked_at IS NULL
      WHERE x.id = $1 AND x.operator_id = $2
        AND x.revoked_at IS NULL AND x.expires_at > now()
        AND o.status <> 'disabled'
      GROUP BY o.id
      LIMIT 1`,
    [claims.sid, claims.sub]
  );
  const row = res.rows[0];
  if (!row) return ANONYMOUS;
  return {
    kind: "operator",
    operatorId: Number(row.id),
    roles: ((row.roles as string[] | null) ?? []) as OperatorRole[],
  };
}

export async function requireStudent(): Promise<Extract<Principal, { kind: "student" }>> {
  const me = await currentPrincipal();
  if (me.kind !== "student") throw new AuthError(401, "unauthenticated");
  return me;
}

export type PrincipalProfile = {
  principal: "student" | "operator";
  studentId?: number;
  displayName: string;
  grade?: string;
  gender?: string | null;
  emailVerified: boolean;
  roles?: string[];
};

/**
 * What `GET /api/auth/me` answers with — and nothing more. No session metadata,
 * no token material: the session list is `/api/auth/sessions`' job, and token
 * material is nobody's.
 */
export async function principalProfile(me: Principal): Promise<PrincipalProfile | null> {
  if (me.kind === "student") {
    const res = await pool.query(
      `SELECT display_name, grade, gender FROM students WHERE id = $1`,
      [me.studentId]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      principal: "student",
      studentId: me.studentId,
      displayName: String(row.display_name ?? ""),
      grade: row.grade == null ? undefined : String(row.grade),
      gender: (row.gender as string | null) ?? null,
      emailVerified: me.emailVerified,
    };
  }
  if (me.kind === "operator") {
    const res = await pool.query(`SELECT display_name FROM operators WHERE id = $1`, [
      me.operatorId,
    ]);
    const row = res.rows[0];
    if (!row) return null;
    return {
      principal: "operator",
      displayName: String(row.display_name ?? ""),
      emailVerified: true,
      roles: me.roles,
    };
  }
  return null;
}

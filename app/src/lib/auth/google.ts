/**
 * Google sign-in — `arctic` for the handshake, `jose` for the ID token
 * (research R3, contracts/auth.md).
 *
 * Two of Talent's behaviours are deliberately NOT mirrored, and they are the
 * reason this is ~150 lines of our own rather than a port:
 *
 *  · **No token in the redirect URL.** Talent's callback puts the access token
 *    plus user id, role, name and picture into the query string of a 302
 *    (`google_auth.py:185-196`, R1 §2 point 4), which puts a live credential in
 *    browser history, any referrer-forwarding proxy, and the access log of
 *    every hop. Here the callback ends at exactly the same session-creation
 *    path as a password sign-in and the browser receives a bare redirect.
 *  · **An OAuth login creates a session row.** Talent's never calls
 *    `create_session`, so its Google users have no working refresh path at all.
 *
 * The upsert rule IS Talent's, and it is right: match on normalised email, and
 * a Google sign-in on an existing password account **links** it rather than
 * erroring. An account that already carries a DIFFERENT `google_sub` is the one
 * case we refuse — two Google identities claiming one address is either a
 * mistake or an attack, and neither is resolved by picking one.
 *
 * When `AINEXT_GOOGLE_CLIENT_ID` is unset the whole surface answers
 * `503 not_configured` and the button renders disabled. Not a crash at boot,
 * because Google is optional: the product signs people in with a password.
 */

import { Google, generateCodeVerifier, generateState } from "arctic";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { GOOGLE_OAUTH, type GoogleOAuthConfig } from "@/lib/env";

import type { AuthEventRecorder } from "./events.ts";
import type { Queryable } from "./throttle.ts";

const SCOPES = ["openid", "email", "profile"];
const STATE_TTL_SECONDS = 10 * 60;

/** Google's published JWKS, fetched once and cached by `jose`. */
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** All three or none — `lib/env.ts` throws on a partial configuration. */
function googleConfig(): GoogleOAuthConfig | null {
  return GOOGLE_OAUTH;
}

export function googleConfigured(): boolean {
  return GOOGLE_OAUTH !== null;
}

export type GoogleHandshake = { url: string; state: string; codeVerifier: string };

export function beginGoogleLogin(): GoogleHandshake | null {
  const cfg = googleConfig();
  if (!cfg) return null;
  const client = new Google(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = client.createAuthorizationURL(state, codeVerifier, SCOPES);
  return { url: url.toString(), state, codeVerifier };
}

export type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
};

/**
 * Exchange the code and verify the ID token against Google's JWKS.
 *
 * The signature check is the whole security of this step: without it the
 * callback trusts whatever JSON came back over a channel an attacker chose.
 */
export async function completeGoogleLogin(
  code: string,
  codeVerifier: string
): Promise<GoogleProfile | null> {
  const cfg = googleConfig();
  if (!cfg) return null;
  try {
    const client = new Google(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
    const tokens = await client.validateAuthorizationCode(code, codeVerifier);
    const { payload } = await jwtVerify(tokens.idToken(), GOOGLE_JWKS, {
      issuer: GOOGLE_ISSUERS,
      audience: cfg.clientId,
    });
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!sub || !email) return null;
    return {
      sub,
      email,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === "string" ? payload.name : null,
    };
  } catch (err) {
    console.error("[auth] google callback failed:", err);
    return null;
  }
}

export type GoogleUpsert =
  | { kind: "ok"; accountId: number; studentId: number; created: boolean; displayName: string }
  | { kind: "conflict"; accountId: number };

/**
 * The grade a Google-created account starts at.
 *
 * DEVIATION, flagged on purpose: `students.grade` is NOT NULL and Google
 * supplies no grade, so a first Google sign-in has to write something. This
 * build serves exactly one curriculum — Prep-3 Mathematics, which is grade 9 —
 * so 9 is the only value that is not a coin toss, and FR-2013 lets the student
 * correct it from their profile. `gender` is left NULL, which data-model §8
 * defines as "never asked" and is therefore exactly true.
 */
export const GOOGLE_DEFAULT_GRADE = "9";

/**
 * Upsert by normalised email, inside the caller's transaction.
 *
 * Creating an account also creates its student: FR-2001 says one account holds
 * exactly one student, and an account with no student is a principal that
 * resolves to nobody.
 */
export async function upsertGoogleAccount(
  db: Queryable,
  profile: GoogleProfile,
  environment: string,
  record: AuthEventRecorder,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<GoogleUpsert> {
  const existing = await db.query(
    `SELECT a.id, a.google_sub, s.id AS student_id, coalesce(s.display_name, '') AS display_name
       FROM accounts a LEFT JOIN students s ON s.account_id = a.id
      WHERE lower(a.email) = lower($1)`,
    [profile.email]
  );
  const row = existing.rows[0];

  if (row) {
    const accountId = Number(row.id);
    const sub = (row.google_sub as string | null) ?? null;
    if (sub && sub !== profile.sub) {
      await record({
        event: "suspicious_activity",
        outcome: "denied",
        actor: { kind: "account", id: accountId },
        subject: { kind: "account", id: accountId },
        reason: "google_sub_conflict",
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
      return { kind: "conflict", accountId };
    }
    // Link, rather than erroring on a pre-existing password account (R1 §2).
    await db.query(
      `UPDATE accounts
          SET google_sub = coalesce(google_sub, $2),
              email_verified_at = coalesce(email_verified_at, $3)
        WHERE id = $1`,
      [accountId, profile.sub, now]
    );
    return {
      kind: "ok",
      accountId,
      studentId: Number(row.student_id),
      created: false,
      displayName: String(row.display_name ?? ""),
    };
  }

  const displayName = (profile.name ?? profile.email.split("@")[0] ?? "Student").slice(0, 60);
  const created = await db.query(
    `INSERT INTO accounts (email, google_sub, email_verified_at, environment)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [profile.email.trim().toLowerCase(), profile.sub, now, environment]
  );
  const accountId = Number(created.rows[0]!.id);
  const student = await db.query(
    `INSERT INTO students (display_name, grade, account_id, status, environment)
     VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
    [displayName, GOOGLE_DEFAULT_GRADE, accountId, environment]
  );
  return {
    kind: "ok",
    accountId,
    studentId: Number(student.rows[0]!.id),
    created: true,
    displayName,
  };
}

export { STATE_TTL_SECONDS };

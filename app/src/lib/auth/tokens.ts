/**
 * Token material: the 15-minute access JWT, and the opaque refresh token.
 *
 * Two different things on purpose (research R2).
 *
 * The ACCESS token is a signed JWT (HS256, `jose`) so a forged or expired
 * cookie is rejected before any database connection is checked out — which
 * matters under R7's pool budget, where a connection held is a connection some
 * other student's lesson is waiting for. Its claims are exactly five:
 * `sub` (principal id), `knd`, `stu` (students only), `sid` (auth_sessions.id)
 * and `env`. Nothing else goes in, because a JWT claim is a thing you cannot
 * take back for fifteen minutes.
 *
 * The REFRESH token is NOT a JWT. It needs three properties — unguessable,
 * storable as a hash, revocable — and a random string is all three where a JWT
 * is only the first. 32 bytes from `crypto.randomBytes`, stored as sha256 hex
 * and never in plaintext anywhere (data-model §4).
 *
 * Verification and reset links use the same random-32-bytes-store-the-sha256
 * shape (data-model §5). Talent stores its reset token in plaintext and makes
 * its verification token a stateless JWT with no row at all, so a leaked link
 * there cannot be revoked — only waited out (R1 §1). Hashing costs nothing and
 * buys revocation, so we pay it.
 *
 * **This module imports nothing from the app, on purpose** — no `@/lib/env`, no
 * database — and `env` is passed in by the caller. That is what lets
 * `node --test` run a real sign/verify round trip against the real `jose`
 * rather than against a mock of it, which is the only version of that test
 * worth having. `@/` is a bundler alias that plain Node does not resolve, so
 * one app import here costs the only test that proves a forged cookie fails.
 *
 * The price is the one knowing duplication in this feature: `AINEXT_AUTH_SECRET`
 * is read here AND by `lib/env.ts`'s `authSecret()`, with the same ≥32-byte rule
 * and the same refusal. Both read the same variable, so they cannot disagree
 * about its value — only about the wording of the error, which is the cheapest
 * kind of drift there is. Stated here rather than discovered later.
 */

import { randomBytes, createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Sliding window: each rotation pushes expiry this far out… */
export const REFRESH_SLIDING_MS = 7 * 24 * 60 * 60 * 1000;
/** …but never past this, measured from the session's first issue. */
export const REFRESH_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

export type PrincipalKind = "student" | "operator";

/** The five claims of contracts/auth.md, and no sixth. */
export type AccessClaims = {
  sub: number;
  knd: PrincipalKind;
  stu?: number;
  sid: number;
  env: string;
};

let cachedSecret: Uint8Array | null = null;

function secret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const raw = (process.env.AINEXT_AUTH_SECRET ?? "").trim();
  if (raw.length < 32) {
    // Refusing to start beats signing with a guessable key: a short secret
    // looks exactly like a working one until somebody forges a cookie.
    throw new Error(
      "AINEXT_AUTH_SECRET is missing or shorter than 32 characters. " +
        "Refusing to sign access tokens with a weak key."
    );
  }
  cachedSecret = new TextEncoder().encode(raw);
  return cachedSecret;
}

export async function signAccessToken(
  claims: AccessClaims,
  now: Date = new Date()
): Promise<string> {
  const issued = Math.floor(now.getTime() / 1000);
  const jwt = new SignJWT({
    knd: claims.knd,
    ...(claims.stu === undefined ? {} : { stu: claims.stu }),
    sid: claims.sid,
    env: claims.env,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(claims.sub))
    .setIssuedAt(issued)
    .setExpirationTime(issued + ACCESS_TOKEN_TTL_SECONDS);
  return jwt.sign(secret());
}

/**
 * Verify and narrow. Returns null for anything we would not act on.
 *
 * `expectedEnv` is checked when given: a token minted for the other environment
 * is not ours to honour, because pooling principals across environments is the
 * one thing constitution XI forbids outright.
 */
export async function verifyAccessToken(
  token: string,
  expectedEnv?: string
): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const sub = Number(payload.sub);
    const knd = payload.knd;
    const sid = Number(payload.sid);
    const env = payload.env;
    if (!Number.isFinite(sub) || !Number.isFinite(sid)) return null;
    if (knd !== "student" && knd !== "operator") return null;
    if (typeof env !== "string") return null;
    if (expectedEnv !== undefined && env !== expectedEnv) return null;
    const stu = payload.stu === undefined ? undefined : Number(payload.stu);
    if (stu !== undefined && !Number.isFinite(stu)) return null;
    return { sub, knd, sid, env, ...(stu === undefined ? {} : { stu }) };
  } catch {
    return null;
  }
}

/** 32 random bytes, base64url. Used for refresh, verification and reset alike. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 hex. The only form of a token that reaches a table. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * `least(now + 7 days, issued_at + 30 days)` — Talent's sliding window inside an
 * absolute cap (data-model §4), so a session cannot live forever by being used.
 */
export function refreshExpiry(issuedAt: Date, now: Date = new Date()): Date {
  const sliding = now.getTime() + REFRESH_SLIDING_MS;
  const absolute = issuedAt.getTime() + REFRESH_ABSOLUTE_MS;
  return new Date(Math.min(sliding, absolute));
}

/**
 * A short-lived signed envelope for the OAuth handshake.
 *
 * The `state` value and the PKCE verifier have to survive the round trip to
 * Google and come back proving they were ours. Signing them with the same
 * secret and putting them in an HttpOnly cookie is the cheapest way to get
 * that; they are not credentials and they expire in minutes, but an unsigned
 * state cookie is an open invitation to CSRF the callback.
 */
export async function signStateToken(
  payload: Record<string, string>,
  ttlSeconds: number,
  now: Date = new Date()
): Promise<string> {
  const issued = Math.floor(now.getTime() / 1000);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(issued)
    .setExpirationTime(issued + ttlSeconds)
    .sign(secret());
}

export async function verifyStateToken(token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function verificationExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + VERIFICATION_TTL_MS);
}

export function resetExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_TTL_MS);
}

/**
 * Password hashing — and the wall the password never crosses (FR-2003).
 *
 * Everything that has ever seen a plaintext password is in this file. Nothing
 * here returns it, logs it, echoes it into an error, or reports its length.
 * `checkPolicy` returns a CODE and a FIELD, never the value it judged, so a
 * caller physically cannot forward the password into a 422 body or an event.
 * That is the whole reason the policy lives beside the hasher rather than in a
 * validation module with the rest of the signup fields.
 *
 * Argon2id via `@node-rs/argon2` (research R1): prebuilt napi-rs binaries, so
 * `deploy/Dockerfile`'s `node:22-bookworm-slim` runtime stage needs no compiler
 * toolchain. Parameters are OWASP's minimum-viable Argon2id configuration as
 * published on 2026-09-20 — m=19 MiB, t=2, p=1. Pinned here, in one place, with
 * that date attached: re-read the cheat sheet before trusting this line in a
 * year, because the numbers move and a stale comment is how they stop moving.
 *
 * The dummy hash exists for timing (contracts/auth.md cross-cutting 2). A login
 * for an address with no account must cost the same as one with a wrong
 * password, or the 401 that carefully says nothing leaks the answer in its
 * latency instead.
 */

import { hash, hashSync, verify, type Algorithm } from "@node-rs/argon2";

/**
 * Argon2id.
 *
 * Written as the literal `2` rather than `Algorithm.Argon2id` because
 * `@node-rs/argon2` declares its enum as an ambient `const enum`, which
 * `isolatedModules` (on in this project, and required by Next) cannot read at
 * a call site. The cast keeps the type honest and the comment keeps the number
 * readable; the alternative is turning off a compiler flag for one integer.
 */
const ARGON2ID = 2 as Algorithm;

/** OWASP minimum-viable Argon2id, checked 2026-09-20. Change deliberately. */
export const PASSWORD_PARAMS = {
  algorithm: ARGON2ID,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Shortest password we accept. Stated, not discovered (FR-2011's sibling rule). */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Longest password we hash. Argon2 does not truncate (that is bcrypt's defect),
 * but an unbounded input is an unbounded amount of memory-hard work per request
 * on an endpoint that is deliberately unauthenticated.
 */
export const MAX_PASSWORD_LENGTH = 256;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, PASSWORD_PARAMS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain, PASSWORD_PARAMS);
  } catch {
    // A malformed stored hash is an integrity problem, not an authentication
    // success. Refuse, and let the auth_events row carry the reason.
    return false;
  }
}

/**
 * A real Argon2id hash of a value nobody knows, computed once at module load.
 * `verify` against it costs the same as verifying a real one.
 */
const DUMMY_HASH = hashSync("no-account-dummy-password-do-not-use", PASSWORD_PARAMS);

/** Burn one hash verification so the no-account branch takes the same time. */
export async function dummyVerify(): Promise<void> {
  try {
    await verify(DUMMY_HASH, "no-account-dummy-password-do-not-use-x", PASSWORD_PARAMS);
  } catch {
    /* timing side-effect only; the result is meaningless by construction */
  }
}

/** The 422 vocabulary. A code, never a value. */
export type PolicyFailure =
  | "password_too_short"
  | "password_too_long"
  | "password_matches_email";

export type PolicyResult =
  | { ok: true }
  | { ok: false; error: PolicyFailure; field: "password" };

/**
 * The password rules, pure and therefore testable without a hasher.
 *
 * Two rules, both from spec FR-2003's neighbourhood and Samuel's defaults:
 * at least 8 characters, and not the email's local part — the single most
 * common password an account creation form receives when the student is
 * fourteen and in a hurry. Deliberately NOT here: a character-class rule, a
 * dictionary, or a strength meter. They push people towards `Passw0rd!` and
 * none of them is what an attacker actually runs into.
 */
export function checkPolicy(password: unknown, email: string): PolicyResult {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: "password_too_short", field: "password" };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: "password_too_long", field: "password" };
  }
  const localPart = email.split("@")[0]?.trim().toLowerCase() ?? "";
  if (localPart.length > 0 && password.trim().toLowerCase() === localPart) {
    return { ok: false, error: "password_matches_email", field: "password" };
  }
  return { ok: true };
}

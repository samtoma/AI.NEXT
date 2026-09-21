/**
 * Sign-in sessions: creating one, rotating it, revoking it — and the credential
 * check that starts one.
 *
 * One `auth_sessions` row per signed-in device, not per token (data-model §4).
 * Rotation is **in place**: the row keeps its identity, `token_hash` is
 * overwritten and the old value moves to `rotated_from`. So the list a student
 * sees at `/api/auth/sessions` is genuinely "the places I am signed in" rather
 * than a growing log of every fifteen-minute refresh.
 *
 * **Reuse detection is the departure from Talent** (R1 §8 — its own architecture
 * document lists the absence as a known gap). A token that matches a
 * `rotated_from` is a token that was already exchanged: either it was stolen
 * and the thief is using it, or it was stolen and the student is. There is no
 * third case and no way to tell which, so every session for that principal is
 * revoked and `suspicious_activity` + one `session_revoked` per row is emitted
 * (FR-2008). This is the one behaviour that cannot be retrofitted cheaply,
 * because it needs `rotated_from` written from the first rotation onward.
 *
 * The exclusive arc — `account_id` XOR `operator_id` — is enforced by a CHECK in
 * the database, not by this code. One session model serves both, so phone + OTP
 * slots in later with no schema change (FR-2903, R1 §9), while an operator
 * session can never be mistaken for a student's.
 *
 * Every function takes its database handle and its event recorder as
 * parameters: that is what makes the reuse branch and the lockout branch
 * testable (SC-106) rather than reachable only through a live sign-in.
 */

import { dummyVerify, verifyPassword } from "./password.ts";
import { generateToken, hashToken, refreshExpiry } from "./tokens.ts";
import type { AuthEventRecorder } from "./events.ts";
import type { Queryable, PrincipalTable } from "./throttle.ts";
import {
  clearExpiredLockout,
  clearFailures,
  isLocked,
  noteCredentialFailure,
} from "./throttle.ts";

// One definition, in lib/db.ts, because the Principal type there carries it and
// two structurally-identical unions is how they stop being identical.
import type { OperatorRole } from "@/lib/db";
export type { OperatorRole };

export type PrincipalRef = { accountId: number } | { operatorId: number };

export type SessionMeta = {
  ip?: string | null;
  userAgent?: string | null;
  environment: string;
};

export type CreatedSession = { id: number; token: string; expiresAt: Date };

/**
 * The auth unit of work.
 *
 * `withPrincipal` (lib/db.ts) is for student-scoped work and sets
 * `app.student_id`; none of these routes has a principal yet — establishing one
 * is what they do — so they run a plain transaction instead. Kept to a unit of
 * work rather than a whole request for the same reason R7 gives: a connection
 * held across an await that is not a query is a connection some other student's
 * lesson is queueing behind.
 *
 * The pool is imported lazily so this module still loads under `node --test`
 * with no database, no DSN and no Next module aliasing.
 */
export async function withAuthTx<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  // `authPool()` is the application connection on the student build and the
  // OPERATOR connection on the console — because `ainext_app` has no grant at
  // all on `operators` or `operator_roles` (migration 017, deliberately), and
  // this is the transaction that reads them when the console signs somebody in.
  const { authPool } = await import("@/lib/db");
  const client = await authPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client as unknown as Queryable);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* the connection is going back to the pool either way */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * A device label from the user agent — a hint for the student's own session
 * list, nothing more. Deliberately crude: the alternative is a UA-parsing
 * dependency that ships a database of browser strings to answer "is this the
 * phone or the iPad".
 */
export function deviceNameFromUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const s = ua.toLowerCase();
  const platform = s.includes("ipad")
    ? "iPad"
    : s.includes("iphone")
      ? "iPhone"
      : s.includes("android")
        ? "Android"
        : s.includes("mac os")
          ? "Mac"
          : s.includes("windows")
            ? "Windows"
            : s.includes("linux")
              ? "Linux"
              : "Unknown device";
  const browser = s.includes("edg/")
    ? "Edge"
    : s.includes("chrome/") && !s.includes("chromium")
      ? "Chrome"
      : s.includes("firefox/")
        ? "Firefox"
        : s.includes("safari/")
          ? "Safari"
          : null;
  return browser ? `${platform} · ${browser}` : platform;
}

export async function createAuthSession(
  db: Queryable,
  ref: PrincipalRef,
  meta: SessionMeta,
  now: Date = new Date()
): Promise<CreatedSession> {
  const token = generateToken();
  const expiresAt = refreshExpiry(now, now); // first issue: now + 7 days
  const res = await db.query(
    `INSERT INTO auth_sessions
       (account_id, operator_id, token_hash, issued_at, last_used_at, expires_at,
        user_agent, device_name, ip_address, environment)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      "accountId" in ref ? ref.accountId : null,
      "operatorId" in ref ? ref.operatorId : null,
      hashToken(token),
      now,
      expiresAt,
      meta.userAgent ?? null,
      deviceNameFromUserAgent(meta.userAgent),
      meta.ip ?? null,
      meta.environment,
    ]
  );
  return { id: Number(res.rows[0]!.id), token, expiresAt };
}

export type RotateResult =
  | { kind: "rotated"; sessionId: number; ref: PrincipalRef; token: string; expiresAt: Date }
  | { kind: "reuse" }
  | { kind: "wrong_surface"; ref: PrincipalRef }
  | { kind: "unknown" };

/**
 * Exchange a refresh token for a new one, or detect that it was already spent.
 *
 * The rotation is a single conditional UPDATE so two tabs racing cannot both
 * win: the second finds no row matching the old hash and falls through to the
 * reuse check, which is the correct answer for a token that has been exchanged.
 * `least(now + 7d, issued_at + 30d)` is written in SQL for the same atomicity
 * reason and mirrors `refreshExpiry` exactly.
 *
 * **`surface` (F-P2b, FR-2205)**: when given, the UPDATE itself is filtered to
 * sessions of the matching kind — a student token presented on the console (or
 * an operator token presented on the student build) simply does not match the
 * WHERE clause, so it is **never rotated, never revoked, and never mutated at
 * all**. That last part is the point: the other surface's session is a live,
 * legitimate session, and answering "wrong surface" here must not cost the
 * caller their sign-in on the surface it IS valid for. A second, read-only
 * query then distinguishes "wrong surface" from "not live for any surface" so
 * the caller gets `wrong_surface` (log and refuse, nothing touched) rather than
 * falling into the reuse-detection branch below, which is answering a
 * different question (a token that WAS live and got spent) and would revoke a
 * session that was never presented anywhere improperly.
 *
 * Omitting `surface` keeps the pre-F-P2b behaviour (no kind constraint) —
 * every existing caller and test that does not pass it is unaffected.
 */
export async function rotateRefreshToken(
  db: Queryable,
  presented: string,
  meta: SessionMeta,
  record: AuthEventRecorder,
  now: Date = new Date(),
  surface?: AuthSurface
): Promise<RotateResult> {
  const presentedHash = hashToken(presented);
  const next = generateToken();
  const kindFilter = surfaceKindFilter(surface);
  const rotated = await db.query(
    `UPDATE auth_sessions
        SET token_hash = $2,
            rotated_from = $1,
            last_used_at = $3,
            expires_at = least($3::timestamptz + interval '7 days',
                               issued_at + interval '30 days'),
            ip_address = coalesce($4::inet, ip_address),
            user_agent = coalesce($5, user_agent)
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $3${kindFilter}
      RETURNING id, account_id, operator_id, expires_at`,
    [presentedHash, hashToken(next), now, meta.ip ?? null, meta.userAgent ?? null]
  );
  const row = rotated.rows[0];
  if (row) {
    return {
      kind: "rotated",
      sessionId: Number(row.id),
      ref:
        row.account_id != null
          ? { accountId: Number(row.account_id) }
          : { operatorId: Number(row.operator_id) },
      token: next,
      expiresAt: new Date(row.expires_at as string),
    };
  }

  // The UPDATE matched no row. If a surface constraint is in play, that could
  // mean "wrong surface" rather than "not live" — check, READ-ONLY, before
  // concluding either way. This query has no kind filter: it is asking "does a
  // live session exist for this token AT ALL", not "does one exist here".
  if (surface) {
    const foreign = await db.query(
      `SELECT account_id, operator_id FROM auth_sessions
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2
        LIMIT 1`,
      [presentedHash, now]
    );
    const f = foreign.rows[0];
    if (f) {
      const ref: PrincipalRef =
        f.account_id != null ? { accountId: Number(f.account_id) } : { operatorId: Number(f.operator_id) };
      await record({
        event: "permission_denied",
        outcome: "denied",
        actor: refActor(ref),
        subject: { kind: "surface" },
        reason: "cross_surface_refresh",
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
      return { kind: "wrong_surface", ref };
    }
  }

  // Not a live token. Was it one we already exchanged? That is the theft signal.
  const prior = await db.query(
    `SELECT id, account_id, operator_id FROM auth_sessions WHERE rotated_from = $1 LIMIT 1`,
    [presentedHash]
  );
  const spent = prior.rows[0];
  if (!spent) return { kind: "unknown" };

  const ref: PrincipalRef =
    spent.account_id != null
      ? { accountId: Number(spent.account_id) }
      : { operatorId: Number(spent.operator_id) };
  await record({
    event: "suspicious_activity",
    outcome: "denied",
    actor: refActor(ref),
    subject: refActor(ref),
    reason: "refresh_token_reuse",
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  await revokeAllForPrincipal(db, ref, record, "refresh_token_reuse", meta);
  return { kind: "reuse" };
}

function refActor(ref: PrincipalRef): { kind: "account" | "operator"; id: number } {
  return "accountId" in ref
    ? { kind: "account", id: ref.accountId }
    : { kind: "operator", id: ref.operatorId };
}

/**
 * `AND account_id IS NOT NULL` / `AND operator_id IS NOT NULL` — appended to a
 * WHERE clause that already matches on `token_hash`, so a token of the wrong
 * kind for `surface` fails to match at all rather than matching and then
 * being filtered out after the fact. No `surface` means no filter, which is
 * the pre-F-P2b behaviour every caller that predates the split still gets.
 */
function surfaceKindFilter(surface: AuthSurface | undefined): string {
  if (surface === "student") return " AND account_id IS NOT NULL";
  if (surface === "admin") return " AND operator_id IS NOT NULL";
  return "";
}

/**
 * Revoke exactly the session holding this refresh token. Safe to call blind.
 *
 * `surface`, when given, restricts revocation to a session of the matching
 * kind (F-P2b) — the same reasoning as `rotateRefreshToken`'s: a refresh
 * cookie that happens to belong to the OTHER surface's principal is a live
 * session there, and logging out of this surface must not silently end it.
 * Unlike rotation there is no "tell me which foreign session it was" branch
 * here: logout already returns 204 unconditionally (see this route's header),
 * so a token that matched nothing — because it was not live, or because it
 * belonged to the other surface — is one indistinguishable outcome, not two.
 */
export async function revokeByToken(
  db: Queryable,
  presented: string,
  record: AuthEventRecorder,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
  surface?: AuthSurface
): Promise<number> {
  const res = await db.query(
    `UPDATE auth_sessions SET revoked_at = $2
      WHERE token_hash = $1 AND revoked_at IS NULL${surfaceKindFilter(surface)}
      RETURNING id, account_id, operator_id`,
    [hashToken(presented), now]
  );
  for (const row of res.rows) {
    await record({
      event: "session_revoked",
      outcome: "success",
      actor:
        row.account_id != null
          ? { kind: "account", id: Number(row.account_id) }
          : { kind: "operator", id: Number(row.operator_id) },
      subject: { kind: "auth_session", id: Number(row.id) },
      reason: "logout",
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
  }
  return res.rows.length;
}

/** Revoke one session the principal owns. 0 rows means "not yours or not there". */
export async function revokeSessionById(
  db: Queryable,
  ref: PrincipalRef,
  sessionId: number,
  record: AuthEventRecorder,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<boolean> {
  const column = "accountId" in ref ? "account_id" : "operator_id";
  const owner = "accountId" in ref ? ref.accountId : ref.operatorId;
  const res = await db.query(
    `UPDATE auth_sessions SET revoked_at = $3
      WHERE id = $1 AND ${column} = $2 AND revoked_at IS NULL
      RETURNING id`,
    [sessionId, owner, now]
  );
  if (res.rows.length === 0) return false;
  await record({
    event: "session_revoked",
    outcome: "success",
    actor: refActor(ref),
    subject: { kind: "auth_session", id: sessionId },
    reason: "revoked_by_owner",
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return true;
}

/** One `session_revoked` row per session revoked — the contract says per row. */
export async function revokeAllForPrincipal(
  db: Queryable,
  ref: PrincipalRef,
  record: AuthEventRecorder,
  reason: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<number> {
  const column = "accountId" in ref ? "account_id" : "operator_id";
  const owner = "accountId" in ref ? ref.accountId : ref.operatorId;
  const res = await db.query(
    `UPDATE auth_sessions SET revoked_at = $2
      WHERE ${column} = $1 AND revoked_at IS NULL
      RETURNING id`,
    [owner, now]
  );
  for (const row of res.rows) {
    await record({
      event: "session_revoked",
      outcome: "success",
      actor: refActor(ref),
      subject: { kind: "auth_session", id: Number(row.id) },
      reason,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
  }
  return res.rows.length;
}

export type SessionListItem = {
  id: number;
  deviceName: string | null;
  ipAddress: string | null;
  lastUsedAt: string;
  createdAt: string;
  current: boolean;
};

/** The caller's own live sessions. **No token material** (FR-2009). */
export async function listSessions(
  db: Queryable,
  ref: PrincipalRef,
  currentSessionId: number | null,
  now: Date = new Date()
): Promise<SessionListItem[]> {
  const column = "accountId" in ref ? "account_id" : "operator_id";
  const owner = "accountId" in ref ? ref.accountId : ref.operatorId;
  const res = await db.query(
    `SELECT id, device_name, host(ip_address) AS ip, last_used_at, issued_at
       FROM auth_sessions
      WHERE ${column} = $1 AND revoked_at IS NULL AND expires_at > $2
      ORDER BY last_used_at DESC`,
    [owner, now]
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    deviceName: (r.device_name as string | null) ?? null,
    ipAddress: (r.ip as string | null) ?? null,
    lastUsedAt: new Date(r.last_used_at as string).toISOString(),
    createdAt: new Date(r.issued_at as string).toISOString(),
    current: currentSessionId != null && Number(r.id) === currentSessionId,
  }));
}

// ---------------------------------------------------------------------------
// The credential check
// ---------------------------------------------------------------------------

export type AuthSurface = "student" | "admin";

export type CredentialResult =
  | {
      kind: "ok";
      table: PrincipalTable;
      id: number;
      studentId: number | null;
      displayName: string;
      emailVerified: boolean;
      roles: OperatorRole[];
    }
  | { kind: "invalid" }
  | { kind: "locked"; until: Date }
  | { kind: "disabled" }
  | { kind: "wrong_surface" };

/**
 * Verify an email and password against the table this surface authenticates
 * against, and emit the sign-in events for whichever branch was taken.
 *
 * **The 401 branch is identical for a wrong password and an unknown address**
 * (FR-2005) — same body, same status, and the same amount of Argon2id work,
 * because the no-account path burns a dummy verification. The distinguishing
 * detail goes to `auth_events.reason`, which no client can read.
 *
 * **FR-2205 on the console**: an `accounts` credential presented to the admin
 * surface is refused with `permission_denied` rather than accepted as a
 * student.
 *
 * **It is refused WITHOUT verifying the student's password, and that is
 * migration 017's decision rather than a shortcut.** The console connects as
 * `ainext_operator`, which holds column-level SELECT on `accounts` — id, email,
 * status and the lockout bookkeeping — and deliberately NOT `password_hash`
 * (FR-2003: "no console query selects password_hash. Column-level SELECT is why
 * it cannot, rather than why it does not"). Verifying here would mean handing
 * the console the one column it must never hold, to make a 403 slightly less
 * informative than a 401 on a surface that is already behind Cloudflare Access
 * and whose only visitors are invited operators. The cost is named rather than
 * hidden: on the console, 403-vs-401 does tell a caller that an address has a
 * student account. The dummy verification still runs, so the two branches cost
 * the same time.
 */
export async function authenticateCredential(
  db: Queryable,
  surface: AuthSurface,
  email: string,
  password: string,
  record: AuthEventRecorder,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<CredentialResult> {
  const table: PrincipalTable = surface === "admin" ? "operators" : "accounts";
  const row = await loadPrincipalByEmail(db, table, email);

  if (!row) {
    await dummyVerify();
    if (surface === "admin") {
      // Might be a student trying the console door. Existence only — the
      // console's connection cannot read `password_hash` and must not be given
      // a reason to (see this function's header).
      const student = await studentAccountId(db, email);
      if (student !== null) {
        await record({
          event: "permission_denied",
          outcome: "denied",
          actor: { kind: "account", id: student },
          subject: { kind: "surface", id: undefined },
          reason: "student_credential_on_console",
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        });
        return { kind: "wrong_surface" };
      }
    }
    await record({
      event: "failed_login",
      outcome: "failure",
      actor: { kind: "anonymous" },
      reason: "no_such_account",
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return { kind: "invalid" };
  }

  // A lockout that has run out is cleared here, and only here, which is what
  // makes `lockout_cleared` an event that fires rather than one that is defined.
  await clearExpiredLockout(db, table, row.id, row.lockedUntil, record, meta, now);

  if (row.status === "disabled") {
    await record({
      event: "failed_login",
      outcome: "failure",
      actor: { kind: actorKind(table), id: row.id },
      reason: "disabled",
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return { kind: "disabled" };
  }

  if (isLocked(row.lockedUntil, now)) {
    await record({
      event: "failed_login",
      outcome: "failure",
      actor: { kind: actorKind(table), id: row.id },
      reason: "locked",
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return { kind: "locked", until: row.lockedUntil! };
  }

  const ok = row.passwordHash ? await verifyPassword(row.passwordHash, password) : false;
  if (!ok) {
    if (!row.passwordHash) await dummyVerify();
    const lock = await noteCredentialFailure(db, table, row.id, record, meta, now);
    await record({
      event: "failed_login",
      outcome: "failure",
      actor: { kind: actorKind(table), id: row.id },
      reason: row.passwordHash ? "wrong_password" : "no_password_credential",
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    if (lock.locked && lock.until) return { kind: "locked", until: lock.until };
    return { kind: "invalid" };
  }

  await clearFailures(db, table, row.id);
  const roles = table === "operators" ? await loadOperatorRoles(db, row.id) : [];
  await db.query(
    table === "accounts"
      ? `UPDATE accounts SET last_login_at = $2, login_count = login_count + 1 WHERE id = $1`
      : `UPDATE operators SET email_verified_at = coalesce(email_verified_at, $2) WHERE id = $1`,
    [row.id, now]
  );
  // One event, not two: `operator_login` IS the console's sign-in event
  // (contracts/analytics.md #12), and emitting `successful_login` beside it
  // would double every console sign-in in the security view's counts. The roles
  // in effect travel in `reason`, which is what FR-2207 asks the row to carry.
  await record({
    event: table === "operators" ? "operator_login" : "successful_login",
    outcome: "success",
    actor: { kind: actorKind(table), id: row.id },
    reason: table === "operators" ? roles.join(",") || "no_roles" : "password",
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return {
    kind: "ok",
    table,
    id: row.id,
    studentId: row.studentId,
    displayName: row.displayName,
    emailVerified: row.emailVerifiedAt != null,
    roles,
  };
}

function actorKind(table: PrincipalTable): "account" | "operator" {
  return table === "accounts" ? "account" : "operator";
}

export type PrincipalRow = {
  id: number;
  passwordHash: string | null;
  status: string;
  emailVerifiedAt: Date | null;
  lockedUntil: Date | null;
  studentId: number | null;
  displayName: string;
};

/**
 * Does an `accounts` row exist for this address? **Id and nothing else.**
 *
 * Used only by the console's wrong-surface branch, and written as its own
 * query rather than reusing `loadPrincipalByEmail` because that one selects
 * `password_hash` — a column `ainext_operator` has no grant on, by design.
 */
async function studentAccountId(db: Queryable, email: string): Promise<number | null> {
  const res = await db.query(
    `SELECT id FROM accounts WHERE lower(email) = lower($1) AND status <> 'disabled'`,
    [email]
  );
  const r = res.rows[0];
  return r ? Number(r.id) : null;
}

/** Case-insensitive by the same `lower(email)` index the database uniquely enforces. */
export async function loadPrincipalByEmail(
  db: Queryable,
  table: PrincipalTable,
  email: string
): Promise<PrincipalRow | null> {
  const sql =
    table === "accounts"
      ? `SELECT a.id, a.password_hash, a.status, a.email_verified_at, a.locked_until,
                s.id AS student_id, coalesce(s.display_name, '') AS display_name
           FROM accounts a LEFT JOIN students s ON s.account_id = a.id
          WHERE lower(a.email) = lower($1)`
      : `SELECT o.id, o.password_hash, o.status, o.email_verified_at, o.locked_until,
                NULL::bigint AS student_id, o.display_name
           FROM operators o
          WHERE lower(o.email) = lower($1)`;
  const res = await db.query(sql, [email]);
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    passwordHash: (r.password_hash as string | null) ?? null,
    status: String(r.status),
    emailVerifiedAt: r.email_verified_at ? new Date(r.email_verified_at as string) : null,
    lockedUntil: r.locked_until ? new Date(r.locked_until as string) : null,
    studentId: r.student_id == null ? null : Number(r.student_id),
    displayName: String(r.display_name ?? ""),
  };
}

export async function loadOperatorRoles(db: Queryable, operatorId: number): Promise<OperatorRole[]> {
  const res = await db.query(
    `SELECT DISTINCT role FROM operator_roles WHERE operator_id = $1 AND revoked_at IS NULL`,
    [operatorId]
  );
  return res.rows.map((r) => String(r.role) as OperatorRole);
}

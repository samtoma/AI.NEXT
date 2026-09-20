/**
 * The database seam, and the one place a student principal is established
 * (ADR-0012, plan A3, research R6/R7).
 *
 * **Why this module stopped being thirteen lines.** Isolation used to be a
 * convention: every query carried `WHERE student_id = $1` because whoever wrote
 * it remembered to, and one forgotten clause served a fourteen-year-old's
 * conversation to a different one. Migration 017 moves that guarantee into
 * Postgres — but policies only apply to a role that cannot bypass them.
 * Superusers and `BYPASSRLS` roles bypass unconditionally, and the table owner
 * bypasses unless `FORCE ROW LEVEL SECURITY` is set; the app used to connect as
 * `ainext` on the box and `$(whoami)` locally, both superusers. So `pool` must
 * point at `ainext_app` (a non-superuser, non-owner role) or every policy in
 * 017 is decoration and every isolation test passes for the wrong reason. The
 * DSN comes from `DATABASE_URL`, and the local default below is deliberately
 * the restricted role rather than a superuser: a missing variable should fail
 * closed, not open.
 *
 * **Three rules that are easy to get wrong:**
 *
 *  1. `withPrincipal` wraps a **unit of work**, never a whole request.
 *     `/api/ask` streams a tutor turn over SSE for tens of seconds; holding a
 *     connection across the model call is pool exhaustion with extra steps. The
 *     ask path takes a unit for its pre-turn reads, releases, calls the model,
 *     and takes a second unit for the ledger write.
 *  2. The principal is **transaction-scoped** (`set_config(..., true)`, i.e.
 *     `SET LOCAL`), never session-level. A pooled connection outlives the
 *     request that borrowed it, and a session-level setting is exactly how one
 *     student's principal survives into the next student's query.
 *  3. **Anonymous sets nothing**, and that is the safe state: the policies read
 *     `nullif(current_setting('app.student_id', true), '')::bigint`, and
 *     `student_id = NULL` is NULL rather than true, so a query with no
 *     principal returns zero rows instead of everybody's.
 *
 * `withMaint` is the escape hatch for loaders, backfills, rollups and the
 * bootstrap scripts, which must see every row. It connects as `ainext_maint`
 * (`BYPASSRLS`) and is **for scripts only** — an application path that reaches
 * for it has given up the guarantee this module exists to provide.
 *
 * This module deliberately imports nothing but `pg`: it is the bottom of the
 * dependency graph, and `db.test.mts` runs under `node --test`, which has no
 * `@/` alias resolution.
 */

import { Pool, type PoolClient } from "pg";

export type OperatorRole =
  | "content-review"
  | "evidence-access"
  | "student-data"
  | "cost-billing";

/**
 * Who is asking. Resolved from the verified access-token cookie by
 * `lib/auth/principal.ts` — never from a request parameter, a header, or
 * anything else a client can choose (FR-2102).
 */
export type Principal =
  | { kind: "student"; studentId: number; accountId: number; emailVerified: boolean }
  | { kind: "operator"; operatorId: number; roles: OperatorRole[] }
  | { kind: "anonymous" };

/** Local default is the RESTRICTED role on purpose — see the header. */
const DEFAULT_DSN = "postgres://ainext_app@127.0.0.1:5432/ainext_mvp1";

const globalForPg = globalThis as unknown as { pgPool?: Pool; pgMaintPool?: Pool };

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL ?? DEFAULT_DSN,
    // 20 per process, two processes, against Postgres 17's default 100 —
    // leaving room for the loader, psql and the rollup job (research R7).
    max: 20,
  });

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;

/**
 * The value `app.student_id` takes for a principal, or `null` for "set
 * nothing". Pure, and separated out so the decision is testable without a
 * database: only a student principal scopes rows, because only a student owns
 * any. An operator reads through its own role and its own connection, and
 * anonymous scopes to nothing at all.
 */
export function principalSetting(p: Principal | number): string | null {
  if (typeof p === "number") {
    if (!Number.isInteger(p) || p <= 0) {
      throw new Error(`withPrincipal: ${p} is not a student id`);
    }
    return String(p);
  }
  return p.kind === "student" ? String(p.studentId) : null;
}

/**
 * Run one unit of work with the principal set for its duration.
 *
 * `BEGIN`, set the principal, run the callback with that client, `COMMIT` —
 * or `ROLLBACK` and rethrow. The connection is always released. A bare number
 * is shorthand for a student id, because most call sites have one and nothing
 * else.
 */
export async function withPrincipal<T>(
  p: Principal | number,
  fn: (c: PoolClient) => Promise<T>
): Promise<T> {
  const setting = principalSetting(p);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (setting !== null) {
      // Bound parameter, not interpolation: set_config takes one, and `SET
      // LOCAL app.student_id = $1` does not.
      await client.query("SELECT set_config('app.student_id', $1, true)", [setting]);
    }
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The transaction is already gone; the original error is the interesting one.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The maintenance connection: `ainext_maint`, which bypasses every policy.
 *
 * Lazy, because most processes never need it and a second pool per process is
 * two more idle connections. It throws rather than silently falling back to
 * `DATABASE_URL`: falling back would run a backfill under the application role,
 * see a fraction of the rows, and report success.
 */
export function maintPool(): Pool {
  if (globalForPg.pgMaintPool) return globalForPg.pgMaintPool;
  const dsn = process.env.DATABASE_URL_MAINT;
  if (!dsn) {
    throw new Error(
      "DATABASE_URL_MAINT is not set. withMaint() connects as ainext_maint " +
        "(BYPASSRLS) and must never silently fall back to the application role — " +
        "a backfill that sees one student's rows and reports success is worse " +
        "than one that refuses to start."
    );
  }
  const p = new Pool({ connectionString: dsn, max: 4 });
  globalForPg.pgMaintPool = p;
  return p;
}

/** Scripts only: loaders, backfills, rollups, the operator bootstrap. */
export async function withMaint<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await maintPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

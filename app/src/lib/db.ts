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
 * `withOperator` is the console's own connection — `ainext_operator`, a THIRD
 * role, whose reads are cross-student by grant rather than by bypass. It is not
 * an escape hatch: it reads exactly what migration 017 permits and nothing
 * else.
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
  | "cost-billing"
  /** ADR-0021: the console's teaching switches (Socratic probing). Split out
   *  of `content-review` so it can be narrowed on its own. */
  | "teaching-controls";

/**
 * Who is asking. Resolved from the verified access-token cookie by
 * `lib/auth/principal.ts` — never from a request parameter, a header, or
 * anything else a client can choose (FR-2102).
 */
export type Principal =
  | {
      kind: "student";
      studentId: number;
      accountId: number;
      emailVerified: boolean;
      /** A first Google sign-in whose grade-and-curriculum step is still owed
       *  (feature 003, FR-4014). `lib/auth/principal.ts` always sets it; absent
       *  reads as "not pending". While true, no lesson opens. */
      onboardingPending?: boolean;
    }
  | { kind: "operator"; operatorId: number; roles: OperatorRole[] }
  | { kind: "anonymous" };

/** Local default is the RESTRICTED role on purpose — see the header. */
const DEFAULT_DSN = "postgres://ainext_app@127.0.0.1:5432/ainext_mvp1";

const globalForPg = globalThis as unknown as {
  pgPool?: Pool;
  pgMaintPool?: Pool;
  pgOperatorPool?: Pool;
};

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
 * Run a fixed list of thunks one at a time, in order, and return their results
 * as a tuple — the fix for pg@9 removing implicit query queuing on a single
 * client.
 *
 * `Promise.all([client.query(a), client.query(b)])` reads as parallel but
 * both queries share ONE socket; node-postgres has always queued them for you
 * under the hood, and pg@9 removes that with "Calling client.query() when the
 * client is already executing a query is deprecated and will be removed in
 * pg@9.0." `sequential` makes the queuing explicit instead of implicit, and
 * keeps the call site's shape — a fixed-order tuple of typed results — so
 * `const [a, b] = await Promise.all([...])` becomes `const [a, b] = await
 * sequential([...])` with nothing else at the call site changing.
 *
 * It only matters inside `withPrincipal`/`withOperator`/`withMaint`, where the
 * callback's `PoolClient` is one connection shared by every query in the unit
 * of work. A bare `pool.query(...)` needs none of this: the pool hands out a
 * fresh connection per call, so those really do run in parallel and
 * `Promise.all` over them stays correct and stays fast.
 */
export async function sequential<T extends readonly unknown[]>(
  thunks: { [K in keyof T]: () => Promise<T[K]> }
): Promise<T> {
  const results: unknown[] = [];
  for (const thunk of thunks as unknown as readonly (() => Promise<unknown>)[]) {
    results.push(await thunk());
  }
  return results as unknown as T;
}

/* ===========================================================================
 * The console's connection (ADR-0014, plan A4/A5, migration 017)
 * ======================================================================== */

/**
 * The operator pool: `ainext_operator`, on `DATABASE_URL_OPERATOR`.
 *
 * A third role rather than a second use of `ainext_app`, because the console's
 * reads are cross-student **by construction** — "what does one child cost" is a
 * table with every child in it — and `ainext_app` under a student principal
 * would return an empty report rather than refuse. An empty cost page is the
 * worst of the three possible answers: it looks like a fact.
 *
 * It is NOT `BYPASSRLS`. `ainext_operator` reads what migration 017's policies
 * and grants permit and nothing else: no `password_hash` (column-level SELECT
 * on `accounts` is why it cannot, rather than why it does not), no UPDATE or
 * DELETE on `operator_reads` (FR-2306 — the audit its subject cannot erase), no
 * grant at all on `verification_tokens` or `password_resets`.
 *
 * Lazy, like `maintPool`, and it throws rather than falling back to
 * `DATABASE_URL`: a console silently reading as `ainext_app` would show every
 * view empty and every figure zero, which reads as "no activity" rather than as
 * "misconfigured".
 */
export function operatorPool(): Pool {
  if (globalForPg.pgOperatorPool) return globalForPg.pgOperatorPool;
  const dsn = process.env.DATABASE_URL_OPERATOR;
  if (!dsn) {
    throw new Error(
      "DATABASE_URL_OPERATOR is not set. The console reads as ainext_operator " +
        "and must never silently fall back to the application role — under a " +
        "student principal every cross-student read returns zero rows, so the " +
        "console would render an empty, plausible, wrong report."
    );
  }
  // Smaller than the app pool: the console has a handful of operators, and
  // these connections come out of the same Postgres budget as the students'.
  const p = new Pool({ connectionString: dsn, max: 8 });
  globalForPg.pgOperatorPool = p;
  return p;
}

/**
 * Run one console read as the operator, with the operator recorded on the
 * transaction.
 *
 * `app.operator_id` is set for the same reason `app.student_id` is: so the
 * database knows who is asking without being told again by every query. **No
 * policy in migration 017 reads it today** — the operator policies are
 * `USING (true)`, because the role itself is the grant — and it is set anyway
 * because the audit columns and any future per-operator policy have to be able
 * to. Setting it costs one round trip inside a transaction we are opening
 * regardless; adding it later would mean auditing every call site.
 *
 * Transaction-scoped (`set_config(..., true)`), never session-level, for
 * exactly the reason `withPrincipal` is: a pooled connection outlives the
 * request that borrowed it.
 */
export async function withOperator<T>(
  operatorId: number,
  fn: (c: PoolClient) => Promise<T>
): Promise<T> {
  if (!Number.isInteger(operatorId) || operatorId <= 0) {
    throw new Error(`withOperator: ${operatorId} is not an operator id`);
  }
  const client = await operatorPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.operator_id', $1, true)", [String(operatorId)]);
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
 * Which connection the **authentication** path uses on this surface.
 *
 * This is not a nicety; without it the console cannot sign anybody in.
 * Migration 017 gives `ainext_app` **no grant at all** on `operators` or
 * `operator_roles`, deliberately and with a comment saying why: "a student
 * principal cannot discover that operators exist". The console build runs the
 * same `/api/auth/login` handler against those two tables, so on `admin` it has
 * to ask as `ainext_operator` — which holds exactly the grants that path needs
 * and no more: SELECT on `operators` and `operator_roles`, UPDATE on
 * `operators` for the lockout bookkeeping, SELECT/INSERT/UPDATE on
 * `auth_sessions` and `auth_throttle`, INSERT on `auth_events`.
 *
 * **The alternative was widening `ainext_app`, and it is the wrong one.** Every
 * student-facing process would then be able to read the operator table, to buy
 * a capability only the console needs. The narrow role already exists; this
 * routes to it.
 *
 * `process.env` is read directly rather than through `lib/env.ts` because this
 * module is the bottom of the dependency graph and `db.test.mts` loads it under
 * `node --test`, which has no `@/` alias. The resolution matches `env.ts`'s.
 */
export function authPool(): Pool {
  return process.env.AINEXT_SURFACE === "admin" ? operatorPool() : pool;
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

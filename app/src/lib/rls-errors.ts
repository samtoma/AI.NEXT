/**
 * What a route says when the DATABASE refuses (FR-2103, contracts/authorization.md).
 *
 * Migration 017 makes cross-student access a Postgres decision rather than an
 * application one, and the two directions fail in completely different shapes:
 *
 *  - a cross-student **READ** is not an error at all. The policy simply filters
 *    the row out, so the query succeeds and returns nothing. The route cannot
 *    tell "someone else's upload" from "no such upload", which is exactly the
 *    answer we want to give either way: **404, and no event**. There is nothing
 *    to record, because nothing was refused — an id was asked about and the
 *    answer was no.
 *  - a cross-student **WRITE** raises. `WITH CHECK` fails with SQLSTATE 42501
 *    and the message "new row violates row-level security policy". That IS a
 *    refusal, it is the one this whole feature exists to make impossible, and
 *    its alert threshold is zero — so it answers **403 and records
 *    `cross_student_access_denied`** (the only producer of that event lives in
 *    `auth/events.ts`, so there is one thing to grep for).
 *
 * `mapRlsError` returns `null` for anything else. A 42501 is a *permission*
 * error generally — a missing GRANT raises it too — but a missing GRANT is our
 * bug and must surface as a 500 rather than be dressed up as an attack; hence
 * the message test alongside the code, and the deliberate `null` for everything
 * that is neither.
 *
 * This module imports nothing that touches a pool or Next's module aliasing, so
 * the predicate can be tested under `node --test` without a database.
 */

import { recordCrossStudentDenied, requestMeta } from "./auth/events.ts";

/** `insufficient_privilege` — what a failed `WITH CHECK` raises. */
export const RLS_SQLSTATE = "42501";

const RLS_MESSAGE = "violates row-level security policy";

/**
 * A write the policies refused — as opposed to a grant we forgot.
 *
 * Both raise 42501; only the row-level failure carries that message. Testing
 * both is what keeps a missing GRANT loud (500) instead of silently reported as
 * a student attacking another student.
 */
export function isRlsWriteDenied(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  return e.code === RLS_SQLSTATE && message.includes(RLS_MESSAGE);
}

export type RlsDenialContext = {
  /** The request, for the ip/user-agent on the security row. */
  req?: Request;
  /** Who was asking — the signed-in account, when there is one. */
  actorAccountId?: number | null;
  /** Whose data the write would have touched. */
  targetStudentId: number;
  /** A short operational code: the route or table, never prose and never data. */
  resource: string;
};

/**
 * The refusal, or `null` when this error is not one.
 *
 * Returning a Response rather than throwing keeps the call site honest: every
 * route's catch block reads `const denied = await mapRlsError(...); if (denied)
 * return denied;` and then falls through to its own 500, so a new route cannot
 * accidentally inherit "403 everything".
 */
export async function mapRlsError(
  err: unknown,
  ctx: RlsDenialContext
): Promise<Response | null> {
  if (!isRlsWriteDenied(err)) return null;
  const meta = ctx.req ? requestMeta(ctx.req) : { ip: null, userAgent: null };
  await recordCrossStudentDenied({
    actorAccountId: ctx.actorAccountId ?? null,
    targetStudentId: ctx.targetStudentId,
    resource: ctx.resource,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return Response.json({ error: "forbidden" }, { status: 403 });
}

/** The body every "we will not say whether this exists" answer uses. */
export function notFoundResponse(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

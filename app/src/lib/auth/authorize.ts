/**
 * The single authorisation seam (FR-2106, contracts/authorization.md).
 *
 * Every operator route handler and every console layout calls `authorize`, and
 * **nothing else performs a role check anywhere in this application**. That is
 * not a style preference. Talent's own architecture document claims a
 * `require_role(...)` factory that its code does not have — what it has instead
 * is `if current_user.role == X: raise 403` scattered per endpoint (R1 §3, §9).
 * The documented guard and the real one drifted apart, and nobody could tell by
 * reading either. One function, called from everywhere, cannot drift from
 * itself.
 *
 * Three things live here and nowhere else:
 *
 *  1. **`checkRequirement`** — the decision, pure, so the four roles × the
 *     requirements matrix is a unit test (SC-110) instead of a click-through.
 *  2. **`authorize`** — resolve the principal, apply the decision, record every
 *     refusal as `permission_denied`. A refusal returns nothing: not a preview,
 *     not a length, not a count.
 *  3. **`CROSS_STUDENT_READS`** — the enumerated list of deliberately
 *     cross-student reads (FR-2108), each with the role that permits it and the
 *     person who asked for it. A read that is not on this list has no
 *     `ainext_operator` policy behind it and returns nothing; data-model §14's
 *     grants and this list are asserted against each other by a test, so the
 *     two cannot drift.
 *
 * **Hiding a control is not authorisation** (FR-2107). Nothing in this module
 * knows or cares what the UI renders.
 *
 * `principal.ts` is imported lazily because it reaches for `next/headers`;
 * keeping it out of the static graph is what lets `node --test` load this file
 * and exercise the matrix without a Next request context.
 */

import { recordAuthEvent, type AuthEventRecorder } from "./events.ts";
import type { OperatorRole } from "./session.ts";
import type { Principal } from "@/lib/db";

export type { OperatorRole };

export type Requirement = {
  /** An operator role the caller must currently hold. */
  role?: OperatorRole;
  /**
   * Operator roles the caller must hold **every one of** (ALL-OF). For the one
   * action two roles must agree on: marking a student as a test account names
   * a child (`student-data`) and decides who the tutor experiments on
   * (`teaching-controls`), so neither role alone may do it (ADR-0021). The
   * refusal names the first role missing, in the order given.
   */
  roles?: readonly OperatorRole[];
  /** The caller must be a student principal. */
  student?: true;
  /** …and must have confirmed their email (FR-2004 — this gates LEARNING). */
  verified?: true;
};

export type Refusal = {
  status: 401 | 403;
  code: "unauthenticated" | "permission_denied" | "email_unverified";
  /** Server-side only. Never reaches a response body. */
  reason: string;
};

export type Decision = { ok: true } | ({ ok: false } & Refusal);

/**
 * The whole matrix, decidable from the principal alone.
 *
 * Order is deliberate: authentication before authorisation, kind before role,
 * role before verification. A student who has not confirmed their email and is
 * also at the wrong door should be told they are at the wrong door.
 */
export function checkRequirement(me: Principal, req: Requirement): Decision {
  if (me.kind === "anonymous") {
    return { ok: false, status: 401, code: "unauthenticated", reason: "no_principal" };
  }

  const required: OperatorRole[] = [
    ...(req.role !== undefined ? [req.role] : []),
    ...(req.roles ?? []),
  ];
  if (required.length > 0) {
    if (me.kind !== "operator") {
      // FR-2205: a student account can never hold an operator role. On the
      // student build these routes do not exist at all (build scope, A4); this
      // is the console build's half of the same rule.
      return {
        ok: false,
        status: 403,
        code: "permission_denied",
        reason: `student_on_console:${required[0]}`,
      };
    }
    const missing = required.find((r) => !me.roles.includes(r));
    if (missing !== undefined) {
      return {
        ok: false,
        status: 403,
        code: "permission_denied",
        reason: `missing_role:${missing}`,
      };
    }
  }

  if (req.student === true) {
    if (me.kind !== "student") {
      return {
        ok: false,
        status: 403,
        code: "permission_denied",
        reason: "operator_on_student_surface",
      };
    }
    if (req.verified === true && !me.emailVerified) {
      return { ok: false, status: 403, code: "email_unverified", reason: "email_unverified" };
    }
  }

  return { ok: true };
}

/**
 * Resolve, check, record. Throws `AuthError` on refusal — which the route
 * handler turns into the status the contract names, and which no caller can
 * mistake for a permitted-but-empty result.
 */
export async function authorize(
  req: Requirement,
  record: AuthEventRecorder = recordAuthEvent
): Promise<Principal> {
  const { currentPrincipal, AuthError } = await import("./principal.ts");
  const me = await currentPrincipal();
  const decision = checkRequirement(me, req);
  if (decision.ok) return me;

  await record({
    event: "permission_denied",
    outcome: "denied",
    actor:
      me.kind === "student"
        ? { kind: "account", id: me.accountId }
        : me.kind === "operator"
          ? { kind: "operator", id: me.operatorId }
          : { kind: "anonymous" },
    subject: { kind: "requirement" },
    reason: decision.reason,
  });
  throw new AuthError(decision.status, decision.code);
}

/**
 * Reads that deliberately cross students (FR-2108).
 *
 * One named entry per read, with the role that permits it and the owner who
 * asked for it — so "why can anyone see all the students" has an answer with a
 * name on it rather than a query with nobody's. Anything not listed here has no
 * operator policy behind it and comes back empty; `ainext_app` cannot perform
 * any of them at all, with or without a principal.
 */
export const CROSS_STUDENT_READS: ReadonlyArray<{
  name: string;
  role: OperatorRole;
  owner: string;
}> = [
  { name: "student_list", role: "student-data", owner: "Samuel" },
  { name: "student_360", role: "student-data", owner: "Samuel" },
  { name: "session_timeline", role: "student-data", owner: "Samuel" },
  { name: "cost_totals", role: "cost-billing", owner: "Samuel" },
  // data-model §14: the enumerated cross-student reads are the operator "S all"
  // rows PLUS `cost_daily`. It is listed separately from `cost_totals` because
  // it is a different table with its own grant (migration 021) — the rollup the
  // per-student time series is drawn from, which `ainext_app` cannot read at all.
  { name: "cost_daily", role: "cost-billing", owner: "Samuel" },
  { name: "security_events", role: "student-data", owner: "Samuel" },
] as const;

/** Is this named read permitted for this role? The console asks before querying. */
export function crossStudentReadAllowed(name: string, roles: readonly OperatorRole[]): boolean {
  const entry = CROSS_STUDENT_READS.find((r) => r.name === name);
  return entry !== undefined && roles.includes(entry.role);
}

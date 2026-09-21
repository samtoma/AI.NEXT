/**
 * How a console page asks the seam whether it may render — and nothing more.
 *
 * This module holds **no authorisation rule of its own**. Every decision below
 * is `lib/auth/authorize.ts`'s: `authorize()` resolves the principal and
 * records the refusal, `checkRequirement()` decides each role. What this adds
 * is two things a React Server Component needs and a throwing seam does not
 * give it:
 *
 *  1. **A refusal you can render.** `authorize` throws, which is right for a
 *     route handler and wrong for a page: an uncaught throw inside a page is a
 *     500 error screen, not the 403 contracts/authorization.md specifies. So
 *     the throw is caught here and turned into a value, and the page renders
 *     `<ConsoleRefusal>` — which shows nothing of the page (FR-2107: not a
 *     preview, not a count, not a heading with an empty table under it).
 *  2. **An any-of for the one route that has one.** The student list admits
 *     `student-data` OR `cost-billing` (contracts/authorization.md, view 1) and
 *     `Requirement` carries a single role. Rather than calling `authorize`
 *     twice — which would record a spurious `permission_denied` for whichever
 *     role was tried first, and the security view alerts at three per hour —
 *     the seam's own pure `checkRequirement` is asked once per candidate and
 *     exactly ONE refusal is recorded if none admits.
 *
 * The route's roles come from `console-routes.ts`, not from the page, so the
 * nav, the guard, the manifest proof and the matrix test all read the same row.
 * A page whose path is not in that table throws at render: an unguarded console
 * page should be impossible to ship, and a loud failure on the operator's own
 * screen is how that stays true.
 */

import { checkRequirement } from "@/lib/auth/authorize";
import { recordAuthEvent } from "@/lib/auth/events";
import { AuthError } from "@/lib/auth/principal";
import { consoleRoute, type ConsoleRoute, type OperatorRole } from "@/lib/console-routes";
import type { Principal } from "@/lib/db";

export type ConsoleOperator = {
  operatorId: number;
  roles: OperatorRole[];
};

export type ConsoleAccess =
  | ({ ok: true } & ConsoleOperator)
  | { ok: false; status: 401 | 403; code: "unauthenticated" | "permission_denied" };

/**
 * The shell's own check: is this an operator at all?
 *
 * `authorize({})` is the seam refusing anonymous. The `kind` assertion after it
 * is the console build's half of FR-2205 — on this build a student credential
 * has already been downgraded to anonymous by `principal.ts`, so this branch
 * should be unreachable; it is here because "should be unreachable" is a claim
 * about another file, and this one refuses rather than assumes.
 */
export async function consoleShellAccess(): Promise<ConsoleAccess> {
  let me: Principal;
  try {
    const { authorize } = await import("@/lib/auth/authorize");
    me = await authorize({});
  } catch (err) {
    return refusalFrom(err);
  }
  if (me.kind !== "operator") {
    await recordAuthEvent({
      event: "permission_denied",
      outcome: "denied",
      actor: me.kind === "student" ? { kind: "account", id: me.accountId } : { kind: "anonymous" },
      subject: { kind: "console_shell" },
      reason: "non_operator_on_console",
    });
    return { ok: false, status: 403, code: "permission_denied" };
  }
  return { ok: true, operatorId: me.operatorId, roles: me.roles };
}

/**
 * The page's check: is this operator admitted to THIS route?
 *
 * Called with the page's own literal path, which is also its row in
 * `CONSOLE_ROUTES`.
 */
export async function consoleAccess(path: string): Promise<ConsoleAccess> {
  const route = consoleRoute(path);
  if (!route) {
    throw new Error(
      `console route "${path}" is not in CONSOLE_ROUTES (lib/console-routes.ts). ` +
        `Add it with the role that admits it — a console page nobody decided the ` +
        `authorisation for must not render.`
    );
  }

  const shell = await consoleShellAccess();
  if (!shell.ok) return shell;

  if (!admits(route, shell.roles)) {
    await recordAuthEvent({
      event: "permission_denied",
      outcome: "denied",
      actor: { kind: "operator", id: shell.operatorId },
      subject: { kind: "console_route" },
      // The role(s) that would have admitted, and the route. An operational
      // code — there is nothing here a client sees or an attacker learns.
      reason: `missing_role:${route.roles.join("|") || "operator"}:${route.path}`,
    });
    return { ok: false, status: 403, code: "permission_denied" };
  }

  return shell;
}

/**
 * The any-of, expressed through the seam's own decision function so no second
 * copy of the matrix exists anywhere.
 */
function admits(route: ConsoleRoute, roles: OperatorRole[]): boolean {
  if (route.roles.length === 0) return true;
  const me: Principal = { kind: "operator", operatorId: 0, roles };
  return route.roles.some((role) => checkRequirement(me, { role }).ok);
}

function refusalFrom(err: unknown): ConsoleAccess {
  if (err instanceof AuthError) {
    return err.status === 401
      ? { ok: false, status: 401, code: "unauthenticated" }
      : { ok: false, status: 403, code: "permission_denied" };
  }
  throw err;
}

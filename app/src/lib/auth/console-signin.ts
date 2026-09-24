/**
 * The console sign-in seam, as the running app sees it (ADR-0022).
 *
 * `cf-access.ts`, `dev-picker.ts` and `operator-signin.ts` hold the rules and
 * are pure enough to test under `node --test`. This module is the thin layer
 * that hands them a real request — `next/headers`, the process configuration,
 * the database — and it is the only one of the four that does.
 *
 * Three callers, and nothing else reads Cloudflare's header:
 *
 *  - `app/(auth)/signin/page.tsx` — asks `consoleSigninState()` whether to
 *    forward to the sign-in route, show a refusal, or show the form (and, on a
 *    laptop, the picker).
 *  - `app/api/auth/cloudflare/route.console.ts` — the one place a session is
 *    started from the proof.
 *  - `lib/auth/principal.ts` — asks `accessIdentityAllows()` whether an
 *    existing console session still belongs to the person Cloudflare says is
 *    at the keyboard (FR-3305). Imported lazily there, and only on the console.
 */

import { headers } from "next/headers";

import { SURFACE } from "@/lib/env";

import {
  cfAccessConfig,
  consoleSigninMode,
  readAccessAssertion,
  sessionMatchesAccessIdentity,
  verifyAccessAssertion,
  type CfVerifyResult,
  type ConsoleSigninMode,
} from "./cf-access.ts";
import { devPickerDecisionFor, type PickerOperator } from "./dev-picker.ts";

export type { PickerOperator };

/**
 * This request's verified Access proof, or null when the feature is off, the
 * surface is the student's, or no assertion was sent.
 */
export async function currentAccessProof(): Promise<CfVerifyResult | null> {
  if (SURFACE !== "admin") return null;
  const state = cfAccessConfig();
  if (state.state !== "on") return null;
  const assertion = readAccessAssertion(SURFACE, await headers());
  if (!assertion) return null;
  return verifyAccessAssertion(assertion, state.config);
}

/**
 * Does the console session belonging to `operatorEmail` still match the proven
 * person? See `sessionMatchesAccessIdentity` for the four answers. Never
 * throws: a verification failure is "no proof", which keeps the session.
 */
export async function accessIdentityAllows(operatorEmail: string): Promise<boolean> {
  try {
    return sessionMatchesAccessIdentity(SURFACE, operatorEmail, await currentAccessProof());
  } catch (err) {
    console.error("[cf-access] identity check failed; treating as no proof:", err);
    return true;
  }
}

export type ConsoleSigninState = ConsoleSigninMode & {
  /** Where "sign out of Cloudflare" goes, when the feature is on. */
  accessLogoutUrl: string | null;
  /** The proven address, for the refusal page's own sentence. Never put in a URL. */
  provenEmail: string | null;
  /** Whether this request may see the dev picker (all three locks open). */
  pickerAllowed: boolean;
};

export async function consoleSigninState(cf: string | null | undefined): Promise<ConsoleSigninState> {
  const h = await headers();
  const state = cfAccessConfig();
  const accessOn = state.state === "on";
  const mode = consoleSigninMode({
    surface: SURFACE,
    accessOn,
    hasAssertion: readAccessAssertion(SURFACE, h) !== null,
    cf,
  });

  let provenEmail: string | null = null;
  if (mode.mode === "refusal") {
    // Re-verified here rather than carried in the redirect: an address in a
    // query string lands in logs and history, and this page has the header.
    const proof = await currentAccessProof().catch(() => null);
    provenEmail = proof && proof.ok ? proof.email : null;
  }

  return {
    ...mode,
    accessLogoutUrl: accessOn ? state.config.logoutUrl : null,
    provenEmail,
    pickerAllowed: SURFACE === "admin" && devPickerDecisionFor(h).allowed,
  };
}

/**
 * Where the console's sign-out sends the browser once the session is ended
 * (FR-3307). With Cloudflare sign-in on it MUST be Access's own logout: the
 * Access session outlives ours, and the next request would otherwise carry a
 * valid assertion straight back into a new console session. And it must be the
 * console's OWN `/cdn-cgi/access/logout`, not the team-wide one — see
 * `ACCESS_APP_LOGOUT_PATH` for the 20–30 seconds that difference is about.
 */
export function consoleSignOutDestination(): string {
  const state = cfAccessConfig();
  return state.state === "on" ? state.config.logoutUrl : "/signin";
}

/**
 * The operators the dev picker lists. Called only after the page has seen the
 * three locks open; the endpoint checks them again for itself.
 */
export async function listPickerOperators(): Promise<PickerOperator[]> {
  const { authPool } = await import("@/lib/db");
  const res = await authPool().query(
    `SELECT o.id, o.display_name, o.email,
            coalesce(array_agg(DISTINCT r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
       FROM operators o
       LEFT JOIN operator_roles r ON r.operator_id = o.id AND r.revoked_at IS NULL
      WHERE o.status = 'active'
      GROUP BY o.id
      ORDER BY o.id
      LIMIT 50`
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    displayName: String(r.display_name ?? ""),
    email: String(r.email ?? ""),
    roles: ((r.roles as string[] | null) ?? []).map(String),
  }));
}

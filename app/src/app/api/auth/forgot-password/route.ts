/**
 * POST /api/auth/forgot-password — **always 202**, same body, same timing.
 *
 * The one deliberate user-enumeration defence on this surface (FR-2010).
 * Whether the address is registered, unregistered, Google-only or disabled, the
 * answer is identical. Mail dispatch happens **after** the response is
 * committed and inside its own error boundary, so a delivery failure cannot
 * leak through the status — the pattern Talent's own code comments call
 * `AUTH-012`, and one of the few places its implementation is exactly right.
 *
 * A Google-only account with no password still gets a reset link: setting a
 * password on an account that has none is the supported way to stop depending
 * on Google, and refusing here would be an enumeration oracle for "which
 * addresses use Google".
 *
 * **On the console build (`AINEXT_SURFACE=admin`) this resolves against
 * `operators` instead.** That is not a convenience: ADR-0014 seeds the first
 * operator with **no password** so that no credential sits in a config file,
 * and this flow is the only way he gets one (migration 019 gave
 * `password_resets` its operator arm). An operator with a NULL `password_hash`
 * is therefore the NORMAL case here, not an error.
 */

import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import { withAuthTx } from "@/lib/auth/session";
import { bumpThrottle, emailOverLimit, ipOverLimit } from "@/lib/auth/throttle";
import { issueResetToken } from "@/lib/auth/reset";
import { consoleResetLink, resetLink, resetMail, sendMail } from "@/lib/mail";
import { ENVIRONMENT } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCEPTED = { status: "accepted" } as const;

/** P2 introduces AINEXT_SURFACE; until then every build is the student one. */
function isConsole(): boolean {
  return process.env.AINEXT_SURFACE === "admin";
}

export async function POST(req: Request) {
  const meta = requestMeta(req);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* same 202 */
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return Response.json(ACCEPTED, { status: 202 });

  try {
    const issued = await withAuthTx(async (db) => {
      const byIp = await ipOverLimit(db, meta.ip);
      const byEmail = await emailOverLimit(db, email);
      if (byIp.over || byEmail.over) return null;
      await bumpThrottle(db, "email", email);
      await bumpThrottle(db, "ip", meta.ip ?? "unknown");

      const res = await db.query(
        isConsole()
          ? `SELECT id FROM operators WHERE lower(email) = lower($1) AND status <> 'disabled'`
          : `SELECT id FROM accounts WHERE lower(email) = lower($1) AND status <> 'disabled'`,
        [email]
      );
      const row = res.rows[0];
      if (!row) return null;
      const token = await issueResetToken(
        db,
        isConsole() ? "operator" : "account",
        Number(row.id),
        ENVIRONMENT,
        recordAuthEvent,
        meta
      );
      return token.token;
    });

    if (issued) {
      void sendMail(resetMail(email, isConsole() ? consoleResetLink(issued) : resetLink(issued)));
    }
  } catch (err) {
    console.error("[auth] forgot-password failed:", err);
  }

  return Response.json(ACCEPTED, { status: 202 });
}

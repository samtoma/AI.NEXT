/**
 * POST /api/auth/resend-verification — **always 202**.
 *
 * Two ways in, one answer:
 *
 *  · **Signed in, empty body.** The verification banner cannot send an address:
 *    `/api/auth/me` deliberately returns no email, because a page that does not
 *    need a minor's address should not be handed one. So a valid `ainext_at`
 *    is enough — the account's address is resolved server-side from the
 *    principal and never makes the round trip in either direction. Budgeted per
 *    account.
 *  · **Anonymous, `{ email }`.** Unchanged, budgeted per address and per IP.
 *
 * FR-2005's non-enumeration rule applies either way: whether or not the address
 * has an account, whether or not it is already verified, whether or not the
 * mail server is up, the answer is the same 202 with the same body. Mail goes
 * out after the response, in its own error boundary.
 *
 * The resend is deliberately always available and rate-limited rather than
 * hidden behind a countdown (ADR-0013 Consequences). A student who never got
 * the first mail is the case this endpoint exists for, and a disabled button
 * with a timer on it is exactly what that student does not need.
 */

import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import { currentPrincipal } from "@/lib/auth/principal";
import { withAuthTx } from "@/lib/auth/session";
import { bumpThrottle, emailOverLimit, ipOverLimit, peekThrottle, IP_FAILURE_LIMIT } from "@/lib/auth/throttle";
import { issueVerificationToken, resolveResendTarget, resendThrottleKey } from "@/lib/auth/verify";
import { sendMail, verificationLink, verificationMail } from "@/lib/mail";
import { ENVIRONMENT } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCEPTED = { status: "accepted" } as const;

export async function POST(req: Request) {
  const meta = requestMeta(req);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* an empty or unparseable body is the session path, and still gets a 202 */
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  const me = email ? { kind: "anonymous" as const } : await currentPrincipal();
  const accountId = me.kind === "student" ? me.accountId : null;
  if (!email && accountId === null) return Response.json(ACCEPTED, { status: 202 });

  try {
    const sent = await withAuthTx(async (db) => {
      const byIp = await ipOverLimit(db, meta.ip);
      if (byIp.over) return null;

      if (accountId !== null) {
        // Budgeted per account, under a key namespaced away from the sign-in
        // failure counter that shares this scope.
        const key = resendThrottleKey(accountId);
        if ((await peekThrottle(db, "account", key)) >= IP_FAILURE_LIMIT) return null;
        await bumpThrottle(db, "account", key);
      } else {
        if ((await emailOverLimit(db, email)).over) return null;
        await bumpThrottle(db, "email", email);
      }
      await bumpThrottle(db, "ip", meta.ip ?? "unknown");

      const target = await resolveResendTarget(
        db,
        accountId !== null ? { accountId } : { email }
      );
      if (!target) return null;
      const token = await issueVerificationToken(
        db,
        target.accountId,
        ENVIRONMENT,
        recordAuthEvent,
        meta
      );
      return { to: target.email, token: token.token };
    });

    if (sent) void sendMail(verificationMail(sent.to, verificationLink(sent.token)));
  } catch (err) {
    // Logged, never surfaced: the status must not distinguish the cases.
    console.error("[auth] resend-verification failed:", err);
  }

  return Response.json(ACCEPTED, { status: 202 });
}

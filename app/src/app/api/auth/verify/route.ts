/**
 * GET /api/auth/verify?token=… — spend a confirmation link.
 *
 * Always a 302, never a body. **It never reveals whose address the token
 * belonged to** (FR-2004): success goes to `/student`, anything else goes to
 * `/verify?state=expired`, and an observer holding a stolen or guessed token
 * learns only whether it worked.
 *
 * Single-use is enforced by the UPDATE that reads the row, so two tabs on the
 * same link cannot both succeed. An expired link lands on a screen that offers
 * a new one rather than on an error that offers nothing.
 *
 * Two events, in two stores, on purpose (contracts/analytics.md):
 * `email_verification_succeeded` is the security fact, `email_verified` is the
 * activation funnel step. The same fact is never written to both tables, but
 * these are two different facts about one moment.
 */

import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import { withAuthTx } from "@/lib/auth/session";
import { consumeVerificationToken, elapsedSinceSignup } from "@/lib/auth/verify";
import { emit } from "@/lib/analytics";
import { PUBLIC_URL } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const meta = requestMeta(req);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  // Built by hand rather than with Response.redirect(): that one is immutable,
  // and a later change that wants to clear a cookie here would throw at runtime.
  const expired = () =>
    new Response(null, {
      status: 302,
      headers: { Location: `${PUBLIC_URL}/verify?state=expired` },
    });
  if (!token) return expired();

  try {
    const outcome = await withAuthTx(async (db) => {
      const consumed = await consumeVerificationToken(db, token, recordAuthEvent, meta);
      if (!consumed.ok) return null;
      const elapsed = await elapsedSinceSignup(db, consumed.accountId);
      const student = await db.query(`SELECT id FROM students WHERE account_id = $1`, [
        consumed.accountId,
      ]);
      return {
        studentId: student.rows[0] ? Number(student.rows[0].id) : null,
        elapsedMs: elapsed,
      };
    });
    if (!outcome) return expired();

    void emit({
      event: "email_verified",
      studentId: outcome.studentId,
      properties: { elapsed_ms: outcome.elapsedMs },
    });
    return new Response(null, { status: 302, headers: { Location: `${PUBLIC_URL}/student` } });
  } catch (err) {
    console.error("[auth] verification failed:", err);
    return expired();
  }
}

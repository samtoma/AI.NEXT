import { applyCookies, clearedAuthCookies } from "@/lib/auth/cookies";
import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import { currentPrincipal, onboardingRefusal } from "@/lib/auth/principal";
import { authenticateCredential, revokeAllForPrincipal, withAuthTx } from "@/lib/auth/session";
import { SURFACE } from "@/lib/env";
import { DELETE_PHRASE, deleteOwnAccount } from "@/lib/student-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/settings/account — the student deletes her own account
 * (FR-2310's working default, Tamer's call 2026-10-27).
 *
 * Immediate and permanent: the account, the student and her interaction
 * record go in one transaction (`delete_own_account`, migration 043), then her
 * uploaded files. What is kept, cut loose from her, is listed in 043's header.
 *
 * CONFIRMATION. She types `DELETE`, and an account with a password must also
 * give it. The password goes through `authenticateCredential`, the sign-in
 * check itself, so a stolen session cannot use this endpoint to guess the
 * password past the sign-in lockout (FR-2011): a wrong one counts as a failed
 * sign-in and five lock the account. An account with no password (Google
 * only) has nothing to re-enter; the phrase is the whole confirmation.
 *
 * Every sign-in is revoked FIRST, so each one is recorded as `session_revoked`
 * (reason `account_deleted`) before the rows that would carry it are gone.
 * A student whose first-Google-sign-in step is pending is refused like every
 * student API (FR-4014): `/settings` sends her to `/welcome` first, so there
 * is no page from which she could have asked.
 */
export async function DELETE(req: Request) {
  const meta = requestMeta(req);
  const me = await currentPrincipal();
  if (me.kind !== "student") {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const pending = onboardingRefusal(me);
  if (pending) return pending;

  let body: { confirm?: unknown; password?: unknown };
  try {
    body = (await req.json()) as { confirm?: unknown; password?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.confirm !== DELETE_PHRASE) {
    return Response.json({ error: "confirmation_required" }, { status: 400 });
  }

  try {
    const check = await withAuthTx(async (db) => {
      const acct = await db.query(
        `SELECT email, password_hash IS NOT NULL AS has_password FROM accounts WHERE id = $1`,
        [me.accountId]
      );
      const row = acct.rows[0] as { email: string; has_password: boolean } | undefined;
      if (!row) return "gone" as const;
      if (!row.has_password) return "ok" as const;
      if (typeof body.password !== "string" || body.password === "") return "password_required" as const;
      const res = await authenticateCredential(db, "student", row.email, body.password, recordAuthEvent, meta);
      if (res.kind === "locked") return "locked" as const;
      return res.kind === "ok" && res.id === me.accountId ? ("ok" as const) : ("wrong_password" as const);
    });
    if (check === "gone") return Response.json({ error: "unauthenticated" }, { status: 401 });
    if (check === "password_required") {
      return Response.json({ error: "password_required" }, { status: 400 });
    }
    if (check === "wrong_password") return Response.json({ error: "wrong_password" }, { status: 403 });
    if (check === "locked") return Response.json({ error: "locked" }, { status: 429 });

    await withAuthTx((db) =>
      revokeAllForPrincipal(db, { accountId: me.accountId }, recordAuthEvent, "account_deleted", meta)
    );
    await deleteOwnAccount(me.studentId);
  } catch (err) {
    console.error("[settings] account deletion failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  return applyCookies(new Response(null, { status: 204 }), clearedAuthCookies(undefined, SURFACE));
}

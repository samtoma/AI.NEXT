/**
 * POST /api/auth/signup — the only way a student account comes into existence.
 *
 * The body is exactly six fields (FR-2002, constitution VII): email, password,
 * display name, grade, and optionally gender and interests. **No parent
 * contact, no phone, no address, no school, no free text.** Anything else in
 * the body is ignored rather than stored — the minimum about a minor is a
 * design property, not a promise in a privacy policy.
 *
 * A 201 signs the student in **immediately, unverified**. They reach a screen
 * that says what is outstanding and no lesson starts (FR-2004). Talent is
 * internally inconsistent here — it issues a token at signup and then refuses
 * login until verified (R1 §2) — and this resolves it on purpose.
 *
 * Account and student are created in ONE transaction. FR-2001 says one account
 * holds exactly one student; a half-created signup is an account that can sign
 * in and resolve to nobody.
 *
 * **The curriculum** (feature 003, FR-4005; contracts/student-api.md) is the
 * one field 003 adds, and it is optional in the body because it is asked only
 * when the grade offers two or more curricula. The server never trusts the
 * form's idea of what the grade offers: it reads the offer again, now, and
 * resolves with `resolveInitialCurriculum` — the same function the Google step
 * uses. One offered → stored `implied`, whatever was sent (a different known
 * value is recorded as `curriculum_resolved_from`); none → National,
 * `implied`; two or more → the student's answer, `chosen`, or a 409
 * `curriculum_required` carrying what the grade offers NOW, so the form asks
 * again when an operator changed the offer after the page loaded. An id the
 * registry does not know is always a 422. The INSERT writes the curriculum and
 * how it was set; `account_created` records both, first-party only (FR-4016).
 */

import { hashPassword, checkPolicy } from "@/lib/auth/password";
import { accessCookie, applyCookies, refreshCookie } from "@/lib/auth/cookies";
import { recordAuthEvent, requestMeta } from "@/lib/auth/events";
import { createAuthSession, withAuthTx } from "@/lib/auth/session";
import { issueVerificationToken } from "@/lib/auth/verify";
import { signAccessToken } from "@/lib/auth/tokens";
import { ipOverLimit, noteIpFailure } from "@/lib/auth/throttle";
import { sendMail, verificationLink, verificationMail } from "@/lib/mail";
import { accountCreatedProperties, curriculumRefusal } from "@/lib/auth/onboarding";
import { emit } from "@/lib/analytics";
import { resolveInitialCurriculum } from "@/lib/catalog";
import { offeredCurriculaFor } from "@/lib/curriculum-queries";
import { ENVIRONMENT } from "@/lib/env";
import { isValidGrade, normalizeInterests } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENDERS = new Set(["female", "male", "unspecified"]);

function invalid(error: string, field: string): Response {
  return Response.json({ error, field }, { status: 422 });
}

export async function POST(req: Request) {
  const meta = requestMeta(req);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* fall through to validation */
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 254) return invalid("invalid_email", "email");

  // The policy check happens in password.ts and returns a CODE. The password
  // itself never leaves that module, so it cannot reach this response body.
  const policy = checkPolicy(body.password, email);
  if (!policy.ok) return invalid(policy.error, policy.field);
  const password = body.password as string;

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (displayName.length < 2 || displayName.length > 40) {
    return invalid("invalid_display_name", "displayName");
  }

  if (!isValidGrade(body.grade)) return invalid("invalid_grade", "grade");
  const grade = String(body.grade);

  // Gender is skippable (Samuel's default, research R12). NULL means "never
  // asked"; 'unspecified' means "declined". Different facts, kept different.
  let gender: string | null = null;
  if (body.gender != null && body.gender !== "") {
    if (typeof body.gender !== "string" || !GENDERS.has(body.gender)) {
      return invalid("invalid_gender", "gender");
    }
    gender = body.gender;
  }

  // Interests must never block a signup (FR-104, carried unchanged).
  const interests = normalizeInterests(body.interests);

  try {
    // What the grade offers at THIS moment, not when the page loaded (FR-4005,
    // privacy review F12). A catalogue read with no student in it.
    const curriculum = resolveInitialCurriculum(body.curriculum, await offeredCurriculaFor(grade));
    if (!curriculum.ok) {
      const refusal = curriculumRefusal(curriculum.error, curriculum.offered);
      return Response.json(refusal.body, { status: refusal.status });
    }

    const outcome = await withAuthTx(async (db) => {
      const throttled = await ipOverLimit(db, meta.ip);
      if (throttled.over) return { kind: "throttled" as const, retryAfter: throttled.retryAfter };

      const taken = await db.query(`SELECT 1 FROM accounts WHERE lower(email) = lower($1)`, [
        email,
      ]);
      if (taken.rows.length > 0) return { kind: "taken" as const };

      const account = await db.query(
        `INSERT INTO accounts (email, password_hash, environment) VALUES ($1, $2, $3) RETURNING id`,
        [email, await hashPassword(password), ENVIRONMENT]
      );
      const accountId = Number(account.rows[0]!.id);

      const student = await db.query(
        `INSERT INTO students
           (display_name, grade, interests, account_id, status, gender, environment,
            curriculum_system, curriculum_source)
         VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8) RETURNING id`,
        [
          displayName,
          grade,
          interests,
          accountId,
          gender,
          ENVIRONMENT,
          curriculum.curriculum,
          curriculum.source,
        ]
      );
      const studentId = Number(student.rows[0]!.id);

      const verification = await issueVerificationToken(
        db,
        accountId,
        ENVIRONMENT,
        recordAuthEvent,
        meta
      );
      const session = await createAuthSession(
        db,
        { accountId },
        { ...meta, environment: ENVIRONMENT }
      );
      return { kind: "created" as const, accountId, studentId, verification, session };
    });

    if (outcome.kind === "throttled") {
      await recordAuthEvent({
        event: "suspicious_activity",
        outcome: "denied",
        actor: { kind: "anonymous" },
        reason: "signup_ip_throttled",
        ...meta,
      });
      return Response.json(
        { error: "too_many_requests", retryAfter: outcome.retryAfter },
        { status: 429, headers: { "Retry-After": String(outcome.retryAfter) } }
      );
    }

    if (outcome.kind === "taken") {
      // Counted against the IP: enumerating which addresses are taken is the
      // one thing this endpoint can be used for that it is not for.
      await withAuthTx((db) => noteIpFailure(db, meta.ip, recordAuthEvent, meta));
      await recordAuthEvent({
        event: "failed_signup",
        outcome: "failure",
        actor: { kind: "anonymous" },
        reason: "email_unavailable",
        ...meta,
      });
      return Response.json({ error: "email_unavailable" }, { status: 409 });
    }

    const token = await signAccessToken({
      sub: outcome.accountId,
      knd: "student",
      stu: outcome.studentId,
      sid: outcome.session.id,
      env: ENVIRONMENT,
    });

    void emit({
      event: "account_created",
      studentId: outcome.studentId,
      properties: accountCreatedProperties("password", grade, curriculum),
    });

    // After the response is built, in its own error boundary: a mail server
    // that is down must not turn a created account into a 500.
    void sendMail(verificationMail(email, verificationLink(outcome.verification.token)));

    return applyCookies(
      Response.json(
        { accountId: outcome.accountId, studentId: outcome.studentId, emailVerified: false },
        { status: 201 }
      ),
      [accessCookie(token), refreshCookie(outcome.session.token, outcome.session.expiresAt)]
    );
  } catch (err) {
    // The functional unique index on lower(email) is the real guarantee; the
    // SELECT above is only the polite path. A raw race lands here.
    if ((err as { code?: string }).code === "23505") {
      return Response.json({ error: "email_unavailable" }, { status: 409 });
    }
    console.error("[auth] signup failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

import { pool } from "@/lib/db";
import { listDemoStudents } from "@/lib/student-context";
import { emit } from "@/lib/analytics";
import {
  isValidGrade,
  normalizeInterests,
  normalizeInterestDetail,
  LEGACY_PREP3,
} from "@/lib/profile";

/**
 * Student roster and creation.
 *
 * ⚠️  DELIBERATELY NOT AUTH. ⚠️
 * Samuel's scope decision (decisions.md Q5) kept identity as a picker for the
 * MVP 1.0 comparison: "a simple ability to create new users, as easy as
 * possible". Signup, verification and sessions (PRD Epic A) are deferred.
 *
 * That is not only the cheap option — it is the better experiment. Both
 * environments now identify students the same way, so identity is a CONSTANT
 * across the comparison rather than another variable muddying the result.
 *
 * GET  → the roster with live counters (what the picker shows).
 * POST → create a student {name, grade, interests[], interestDetail} → {id}.
 *
 * Everything here is visible to anyone who can open the site, which is why the
 * site sits behind Cloudflare Access with an invited list (FR-907). No
 * credentials, no PII beyond a display name.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ students: await listDemoStudents() });
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* fall through to validation */
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 40) {
    return Response.json({ error: "name must be 2–40 characters" }, { status: 400 });
  }

  // Grade is required (FR-103) — it seeds the student model and shapes the
  // opening lesson. The legacy "prep-3" value stays acceptable so rows created
  // before this build keep the same meaning as rows created after it.
  const grade = body.grade;
  if (!isValidGrade(grade)) {
    return Response.json(
      { error: "grade must be one of 7–12 (or the legacy 'prep-3')" },
      { status: 400 }
    );
  }

  // Interests are OPTIONAL and must never block creation (FR-104). Unknown ids
  // are dropped, not rejected: a stale client should cost us a slightly poorer
  // profile, never a student who cannot be created.
  const interests = normalizeInterests(body.interests);
  const interestDetail = normalizeInterestDetail(body.interestDetail, interests);

  const res = await pool.query(
    `INSERT INTO students (display_name, grade, interests, interest_detail)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      name,
      grade === LEGACY_PREP3 ? LEGACY_PREP3 : String(grade),
      interests,
      interestDetail ? JSON.stringify(interestDetail) : null,
    ]
  );
  const id = Number(res.rows[0].id);

  void emit({
    event: "student_created",
    studentId: id,
    properties: {
      grade,
      interests,
      skipped_interests: interests.length === 0,
      has_interest_detail: interestDetail != null,
    },
  });

  return Response.json({ id }, { status: 201 });
}

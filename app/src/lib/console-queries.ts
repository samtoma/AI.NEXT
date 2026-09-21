import { withOperator } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";

/**
 * The console's read models (contracts/admin.md view 1, FR-2108, FR-2211).
 *
 * Every query here runs under `withOperator` — `ainext_operator`, whose
 * cross-student visibility comes from migration 017's grants and policies
 * rather than from a bypass. Run the same SQL on the application connection
 * and it returns nothing at all: `ainext_app` has no policy that matches a row
 * belonging to a student who is not the principal, and no principal is set.
 * That is the intended difference and it is why the console has its own DSN.
 *
 * **`environment` is filtered before anything is grouped** (constitution XI,
 * FR-2407, FR-2109). A student list that blended the frozen baseline with the
 * comparison build would not be a longer list; it would be a wrong one, and a
 * cost figure computed over it would be a plausible wrong number used to set a
 * price.
 *
 * **Two projections, one query** (contracts/authorization.md): `student-data`
 * sees the whole row; `cost-billing` sees the commercial subset. The contract
 * says the `cost-billing` projection of this view carries no content column —
 * **this view has no content column in either projection**, which is stated
 * rather than left to be noticed: there is no message, no transcript, no
 * preview and no turn count of a conversation anywhere in it. What the
 * projection actually drops is gender and email-verification, which are the
 * student's own facts rather than the commercial ones, plus the link into
 * Student 360, which `cost-billing` may not open at all.
 *
 * The period is 30 days and every figure that depends on it says so on the
 * page. Cost is **imputed at list price** and is labelled that way wherever it
 * is rendered (research A4.4): the runtime is a Claude subscription, so no
 * money left a bank account per turn.
 *
 * n ≤ 200 in the pilot, so the per-student subqueries below are deliberate:
 * they keep the shape readable and the row count honest (a student with no
 * sessions is a row with a zero, never a missing row). At a volume where that
 * stops being true, P4's `cost_daily` rollup is the thing to join to.
 */

export const LIST_PERIOD_DAYS = 30;

export type StudentListProjection = "full" | "cost";

export type StudentListRow = {
  id: number;
  displayName: string;
  grade: string;
  /** `null` renders as "not set" — never as an assumed value (A9, FR-2605). */
  gender: string | null;
  /** `legacy` is the picker-era cast, retired by A10 and kept for its history. */
  studentStatus: string;
  /** `null` when the student has no account at all (every legacy row). */
  accountStatus: string | null;
  emailVerified: boolean | null;
  subscriptionStatus: string;
  /** Latest of the account's last sign-in and the last session opened. */
  lastSeenAt: string | null;
  sessionsInPeriod: number;
  /** US dollars, imputed at list price, over the period. */
  costUsdInPeriod: number;
};

export type StudentList = {
  rows: StudentListRow[];
  projection: StudentListProjection;
  periodDays: number;
  environment: string;
};

export async function getStudentList(
  operatorId: number,
  projection: StudentListProjection,
  periodDays: number = LIST_PERIOD_DAYS
): Promise<StudentList> {
  const rows = await withOperator(operatorId, async (db) => {
    const res = await db.query(
      `SELECT st.id,
              st.display_name,
              st.grade,
              st.gender,
              st.status              AS student_status,
              st.subscription_status,
              a.status               AS account_status,
              (a.email_verified_at IS NOT NULL) AS email_verified,
              GREATEST(
                a.last_login_at,
                (SELECT max(ss.opened_at) FROM sessions ss
                  WHERE ss.student_id = st.id AND ss.environment = $1)
              ) AS last_seen_at,
              (SELECT count(*) FROM sessions ss
                WHERE ss.student_id = st.id AND ss.environment = $1
                  AND ss.opened_at >= now() - ($2 || ' days')::interval
              ) AS sessions_in_period,
              (SELECT coalesce(sum(ai.cost_usd), 0) FROM ai_interactions ai
                WHERE ai.student_id = st.id AND ai.environment = $1
                  AND ai.created_at >= now() - ($2 || ' days')::interval
              ) AS cost_usd_in_period
         FROM students st
         LEFT JOIN accounts a ON a.id = st.account_id
        WHERE st.environment = $1
        -- Most recently seen first: the question this list answers on a
        -- Tuesday morning is "who is using it", not "who signed up first".
        -- NULLS LAST keeps the never-seen at the bottom rather than the top.
        ORDER BY last_seen_at DESC NULLS LAST, st.display_name ASC`,
      [ENVIRONMENT, String(periodDays)]
    );
    return res.rows;
  });

  const full = projection === "full";
  return {
    projection,
    periodDays,
    environment: ENVIRONMENT,
    rows: rows.map((r) => ({
      id: Number(r.id),
      displayName: String(r.display_name ?? ""),
      grade: String(r.grade ?? ""),
      gender: full ? ((r.gender as string | null) ?? null) : null,
      studentStatus: String(r.student_status ?? "active"),
      accountStatus: (r.account_status as string | null) ?? null,
      emailVerified: full ? Boolean(r.email_verified) : null,
      subscriptionStatus: String(r.subscription_status ?? "none"),
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at as string).toISOString() : null,
      sessionsInPeriod: Number(r.sessions_in_period ?? 0),
      costUsdInPeriod: Number(r.cost_usd_in_period ?? 0),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Student 360 — the profile header only, in P2                        */
/* ------------------------------------------------------------------ */

export type StudentProfileCard = {
  id: number;
  displayName: string;
  grade: string;
  gender: string | null;
  interests: string[];
  languagePref: string;
  curriculumSystem: string;
  studentStatus: string;
  accountStatus: string | null;
  emailVerified: boolean | null;
  subscriptionStatus: string;
  createdAt: string;
  lastSeenAt: string | null;
};

/**
 * The profile fields, and deliberately nothing else.
 *
 * P3 owns Student 360 — mastery trajectories, sessions, the timeline, the
 * replay. This reads the header of that page and no part of its body, so
 * nothing here has to be un-built when P3 lands and nothing renders as a
 * half-finished version of a view that does not exist yet.
 *
 * **Opening the page writes an `operator_reads` row** (FR-2306, surface
 * `student_360`). That is done by the page, in the same `withOperator`
 * transaction — see `students/[id]/page.console.tsx`. The audit exists from the
 * first day a student's record can be opened, not from the day the page gets
 * interesting: an audit that starts late has a gap nobody can reconstruct.
 */
export async function getStudentProfileCard(
  operatorId: number,
  studentId: number,
  onRead: (db: {
    query: (
      text: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  }) => Promise<void>
): Promise<StudentProfileCard | null> {
  return withOperator(operatorId, async (db) => {
    const res = await db.query(
      `SELECT st.id, st.display_name, st.grade, st.gender, st.interests,
              st.language_pref, st.curriculum_system, st.status AS student_status,
              st.subscription_status, st.created_at,
              a.status AS account_status,
              (a.email_verified_at IS NOT NULL) AS email_verified,
              GREATEST(
                a.last_login_at,
                (SELECT max(ss.opened_at) FROM sessions ss
                  WHERE ss.student_id = st.id AND ss.environment = $2)
              ) AS last_seen_at
         FROM students st
         LEFT JOIN accounts a ON a.id = st.account_id
        WHERE st.id = $1 AND st.environment = $2`,
      [studentId, ENVIRONMENT]
    );
    const r = res.rows[0];
    if (!r) return null;

    // The audit row goes in the SAME transaction as the read it records. A
    // commit that carried the profile and not the audit would be exactly the
    // hole FR-2306 exists to close.
    await onRead(db);

    return {
      id: Number(r.id),
      displayName: String(r.display_name ?? ""),
      grade: String(r.grade ?? ""),
      gender: (r.gender as string | null) ?? null,
      interests: (r.interests as string[] | null) ?? [],
      languagePref: String(r.language_pref ?? "en"),
      curriculumSystem: String(r.curriculum_system ?? ""),
      studentStatus: String(r.student_status ?? "active"),
      accountStatus: (r.account_status as string | null) ?? null,
      emailVerified: r.email_verified == null ? null : Boolean(r.email_verified),
      subscriptionStatus: String(r.subscription_status ?? "none"),
      createdAt: new Date(r.created_at as string).toISOString(),
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at as string).toISOString() : null,
    };
  });
}

/** The operator's own name and roles, for the console header. */
export async function getOperatorCard(
  operatorId: number
): Promise<{ displayName: string; email: string } | null> {
  return withOperator(operatorId, async (db) => {
    const res = await db.query(
      `SELECT display_name, email FROM operators WHERE id = $1`,
      [operatorId]
    );
    const r = res.rows[0];
    if (!r) return null;
    return { displayName: String(r.display_name ?? ""), email: String(r.email ?? "") };
  });
}

import { ENVIRONMENT } from "@/lib/env";
import type { CostDetailAccess } from "@/lib/turn-threshold-queries";
import { DAILY_UPLOAD_THRESHOLD, type UploadThresholdSummary } from "@/lib/turn-thresholds";

/**
 * Photo uploads, observed — the Cost page's upload panel (ADR-0023, FR-3409).
 *
 * The daily upload cap is gone (FR-3407); `DAILY_UPLOAD_THRESHOLD` keeps its
 * number (FR-3408). This module reads how much uploading happened, how the
 * parses ended, and how often a student reached the old limit.
 *
 * **Two sources, and why.** Uploads are counted from `uploads`, the table
 * the old cap counted. How the parses ended comes from the `ai_interactions`
 * ledger, where every parse writes one row with `surface = 'upload_parse'`
 * and `surface_kind = 'upload_parse'` (`lib/uploads.ts`). The upload/OCR
 * SPEND is not read here: the Cost page already folds it from those rows into
 * its own photo/OCR figure (`cost-queries.ts`, FR-2402), and the panel reuses
 * that figure rather than computing the same dollars a second time.
 *
 * **The old count's window, reproduced exactly.** The retired `uploadsToday`
 * counted `created_at > now() - interval '1 day'` inside the same transaction
 * that inserted the row, so `now()` was the new upload's own `created_at`.
 * The count at each upload is therefore the uploads in the half-open 24 hours
 * `(created_at - 1 day, created_at]`, the new one included, which is the
 * window frame below. It is rolling, not a calendar day, and no timezone
 * enters it. A student-day is that student's uploads on one UTC date, and its
 * figure is the highest 24-hour count reached at any of them.
 *
 * **Environment first, always** (constitution XI): `$1` on both tables.
 * **`withOperator`**, the caller's client, one query after another.
 * **No student content** (FR-2406): from `uploads` only `student_id` and
 * `created_at` are read, never `parsed_text`, `storage_path` or the file.
 * From the ledger only `outcome`.
 *
 * **A billing-only operator gets aggregates and nothing else** (FR-2406). The
 * list of student-days that reached the threshold (a named student beside an
 * upload count) and the most uploads in 24 hours (one student's count) are
 * read only when the operator also holds `student-data` (`costDetailAccess`
 * in `lib/turn-threshold-queries.ts`). Without it the list's query is not run
 * and `max(d.most)` is not selected. The display name, from `students`, is
 * read only by the list.
 */

type Db = {
  query: (
    text: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

const UPLOAD_DAY = `(u.created_at AT TIME ZONE 'UTC')::date`;
const LEDGER_DAY = `(ai.created_at AT TIME ZONE 'UTC')::date`;
const TODAY_UTC = `(now() AT TIME ZONE 'UTC')::date`;

/**
 * The uploads in `(created_at - 1 day, created_at]`, per student. RANGE
 * offsets are inclusive, so the frame starts one microsecond (timestamptz's
 * resolution) after the 24-hour mark, which is the old rule's strict `>`.
 */
export const IN_24_HOURS =
  `count(*) OVER (PARTITION BY u.student_id ORDER BY u.created_at ` +
  `RANGE BETWEEN interval '1 day' - interval '1 microsecond' PRECEDING AND CURRENT ROW)`;

/** Q1: uploads and uploaders in the last $2 whole UTC days. $1 environment. */
export const UPLOAD_TOTALS_SQL = `
  SELECT count(*) AS uploads, count(DISTINCT u.student_id) AS students
    FROM uploads u
   WHERE u.environment = $1 AND ${UPLOAD_DAY} > ${TODAY_UTC} - $2::int`;

/** Q2: how the parses in the period ended, from the ledger. */
export const PARSE_OUTCOMES_SQL = `
  SELECT ai.outcome, count(*) AS parses
    FROM ai_interactions ai
   WHERE ai.environment = $1 AND ${LEDGER_DAY} > ${TODAY_UTC} - $2::int
     AND ai.surface_kind = 'upload_parse'
   GROUP BY ai.outcome`;

/**
 * Every in-period upload with its 24-hour count, folded into student-days.
 * The inner scan starts one day before the period so the first day's uploads
 * see their whole 24 hours; the period filter is applied after the window.
 */
const STUDENT_DAYS_CTE = `
  w AS (
    SELECT u.student_id, ${UPLOAD_DAY} AS day, ${IN_24_HOURS} AS in_24h
      FROM uploads u
     WHERE u.environment = $1 AND ${UPLOAD_DAY} >= ${TODAY_UTC} - $2::int
  ),
  days AS (
    SELECT w.student_id, w.day, max(w.in_24h) AS most, count(*) AS uploads
      FROM w
     WHERE w.day > ${TODAY_UTC} - $2::int
     GROUP BY w.student_id, w.day
  )`;

/**
 * Q3: student-days in the period, how many reached the threshold ($3) and how
 * many went past it — `uploadThresholdStatus`'s comparisons. `withHighest`
 * adds the most uploads one student made in 24 hours, selected only with
 * `student-data` (FR-2406).
 */
export const STUDENT_DAY_SUMMARY_SQL = (withHighest: boolean) => `
  WITH ${STUDENT_DAYS_CTE}
  SELECT count(*)                              AS student_days,
         count(*) FILTER (WHERE d.most >= $3)  AS reached,
         count(*) FILTER (WHERE d.most >  $3)  AS past${
           withHighest ? `,
         coalesce(max(d.most), 0)              AS highest` : ""
         }
    FROM days d`;

/** Q4: the student-days at or over the threshold ($3), newest first, $4 rows. */
export const STUDENT_DAYS_SQL = `
  WITH ${STUDENT_DAYS_CTE}
  SELECT d.student_id, st.display_name, d.day::text AS day, d.most, d.uploads
    FROM days d
    LEFT JOIN students st ON st.id = d.student_id
   WHERE d.most >= $3
   ORDER BY d.day DESC, d.most DESC, d.student_id
   LIMIT $4`;

/* ----------------------------------------------------------------- types */

export type UploadStudentDay = {
  studentId: number;
  displayName: string | null;
  /** The UTC date, YYYY-MM-DD. */
  day: string;
  /** The highest 24-hour upload count reached at any of that day's uploads. */
  most: number;
  /** Uploads on that UTC date. */
  uploads: number;
};

/** The per-student part of the panel, read only with `student-data` (FR-2406). */
export type UploadDetail = {
  recentDays: UploadStudentDay[];
  recentLimit: number;
  recentCapped: boolean;
};

export type UploadsView = {
  /** Rows in `uploads` in the period. */
  uploads: number;
  /** Students with at least one upload in the period. */
  students: number;
  /** Parse rows in the ledger in the period, by how they ended. */
  parses: { delivered: number; failed: number; other: number };
  threshold: UploadThresholdSummary;
  /** `null` for an operator without `student-data`: not read, not passed. */
  detail: UploadDetail | null;
};

export const UPLOAD_DAYS_LIMIT = 50;

const num = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/* ------------------------------------------------------------- the read */

/**
 * Totals, parse outcomes and the threshold's aggregates for every operator
 * the Cost page admits; the student-day list and the highest count only with
 * `access.studentDetail` — without it that query is never run (FR-2406).
 */
export async function readUploadsView(
  db: Db,
  periodDays: number,
  access: CostDetailAccess
): Promise<UploadsView> {
  const period = String(periodDays);
  const withDetail = access.studentDetail === true;
  const totals = await db.query(UPLOAD_TOTALS_SQL, [ENVIRONMENT, period]);
  const outcomes = await db.query(PARSE_OUTCOMES_SQL, [ENVIRONMENT, period]);
  const summary = await db.query(STUDENT_DAY_SUMMARY_SQL(withDetail), [
    ENVIRONMENT,
    period,
    DAILY_UPLOAD_THRESHOLD,
  ]);
  const days = withDetail
    ? await db.query(STUDENT_DAYS_SQL, [ENVIRONMENT, period, DAILY_UPLOAD_THRESHOLD, UPLOAD_DAYS_LIMIT + 1])
    : null;

  const parses = { delivered: 0, failed: 0, other: 0 };
  for (const r of outcomes.rows) {
    const n = num(r.parses);
    if (r.outcome === "ok") parses.delivered += n;
    else if (r.outcome === "error" || r.outcome === "timeout") parses.failed += n;
    else parses.other += n;
  }

  const s = summary.rows[0];
  return {
    uploads: num(totals.rows[0]?.uploads),
    students: num(totals.rows[0]?.students),
    parses,
    threshold: {
      threshold: DAILY_UPLOAD_THRESHOLD,
      studentDays: num(s?.student_days),
      reached: num(s?.reached),
      past: num(s?.past),
      highest: withDetail ? num(s?.highest) : null,
    },
    detail: days
      ? {
          recentDays: days.rows.slice(0, UPLOAD_DAYS_LIMIT).map((r) => ({
            studentId: num(r.student_id),
            displayName:
              typeof r.display_name === "string" && r.display_name ? r.display_name : null,
            day: String(r.day).slice(0, 10),
            most: num(r.most),
            uploads: num(r.uploads),
          })),
          recentLimit: UPLOAD_DAYS_LIMIT,
          recentCapped: days.rows.length > UPLOAD_DAYS_LIMIT,
        }
      : null,
  };
}

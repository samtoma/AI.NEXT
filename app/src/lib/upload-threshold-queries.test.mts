/**
 * The Cost page's photo-upload reads (ADR-0023, FR-3408, FR-3409): what they
 * count, over which window, in which environment, and what they never read.
 *
 * Shaped like `turn-threshold-queries.test.mts`: the SQL is asserted by shape
 * and the read is driven with a fake client that records every query and its
 * parameters. **No database.** The SQL was also run against a scratch Postgres
 * with seeded uploads — a burst of twelve inside 24 hours, a burst that
 * crossed midnight, a baseline-environment student — when this was written.
 *
 * A billing-only operator gets aggregates only (FR-2406): the student-day
 * list is never queried and the highest per-student count is never selected.
 *
 * @covers FR-2406
 * @covers FR-3408
 * @covers FR-3409
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ENVIRONMENT } from "./env.ts";
import {
  IN_24_HOURS,
  PARSE_OUTCOMES_SQL,
  STUDENT_DAYS_SQL,
  STUDENT_DAY_SUMMARY_SQL,
  UPLOAD_DAYS_LIMIT,
  UPLOAD_TOTALS_SQL,
  readUploadsView,
} from "./upload-threshold-queries.ts";

const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();
const ALL_SQL = {
  totals: UPLOAD_TOTALS_SQL,
  outcomes: PARSE_OUTCOMES_SQL,
  "summary (aggregates)": STUDENT_DAY_SUMMARY_SQL(false),
  "summary (with highest)": STUDENT_DAY_SUMMARY_SQL(true),
  days: STUDENT_DAYS_SQL,
};

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const code = (rel: string) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ------------------------------------------------------------ the window */

test("the 24 hours are the old uploadsToday's: (created_at − 1 day, created_at], rolling, per student", () => {
  assert.equal(
    squash(IN_24_HOURS),
    "count(*) OVER (PARTITION BY u.student_id ORDER BY u.created_at RANGE BETWEEN interval '1 day' - interval '1 microsecond' PRECEDING AND CURRENT ROW)"
  );
  // The retired count this reproduces, quoted where it is retired.
  assert.match(src("lib/uploads.ts"), /`created_at > now\(\) - interval '1 day'`/);
});

test("the window sees the day before the period, and the period is applied after it", () => {
  for (const sql of [STUDENT_DAY_SUMMARY_SQL(false), STUDENT_DAY_SUMMARY_SQL(true), STUDENT_DAYS_SQL]) {
    const s = squash(sql);
    assert.match(s, /WHERE u\.environment = \$1 AND \(u\.created_at AT TIME ZONE 'UTC'\)::date >= \(now\(\) AT TIME ZONE 'UTC'\)::date - \$2::int/);
    assert.match(s, /FROM w WHERE w\.day > \(now\(\) AT TIME ZONE 'UTC'\)::date - \$2::int GROUP BY w\.student_id, w\.day/);
    assert.ok(s.indexOf("OVER (") < s.indexOf("FROM w WHERE"), "the period filter must come after the window");
    assert.match(s, /max\(w\.in_24h\) AS most/);
  }
});

test("every read filters this environment first, as $1 (constitution XI)", () => {
  assert.match(squash(UPLOAD_TOTALS_SQL), /FROM uploads u WHERE u\.environment = \$1 AND/);
  assert.match(squash(PARSE_OUTCOMES_SQL), /FROM ai_interactions ai WHERE ai\.environment = \$1 AND/);
  for (const sql of [STUDENT_DAY_SUMMARY_SQL(false), STUDENT_DAYS_SQL]) {
    assert.match(squash(sql), /FROM uploads u WHERE u\.environment = \$1 AND/);
  }
});

test("the parse outcomes are the ledger's upload rows, surface_kind = 'upload_parse'", () => {
  const s = squash(PARSE_OUTCOMES_SQL);
  assert.match(s, /ai\.surface_kind = 'upload_parse'/);
  assert.match(s, /GROUP BY ai\.outcome/);
  // and that is the value lib/uploads.ts actually writes
  assert.match(src("lib/uploads.ts"), /VALUES \(\$1,'upload_parse',1,[\s\S]{0,120}'upload_parse',\$12/);
});

test("no read touches an upload's file, path or text (FR-2406)", () => {
  for (const [name, sql] of Object.entries(ALL_SQL)) {
    assert.doesNotMatch(sql, /parsed_text|storage_path|file_type|user_message|assistant_message/, name);
  }
  assert.doesNotMatch(code("lib/upload-threshold-queries.ts"), /parsed_text|storage_path/);
});

test("the spend is not recomputed here: the panel reuses the Cost page's photo/OCR figure", () => {
  for (const [name, sql] of Object.entries(ALL_SQL)) {
    assert.doesNotMatch(sql, /cost_usd/, `${name} must not sum a second upload figure`);
  }
  const page = code("app/(console)/cost/page.console.tsx");
  assert.match(page, /value=\{usd\(view\.upload\.costUsd\)\}/);
  assert.match(page, /usd\(view\.upload\.costUsd \/ priced\)/);
});

test("the list: student-days at or over the threshold ($3), newest first, $4 rows", () => {
  const s = squash(STUDENT_DAYS_SQL);
  assert.match(s, /WHERE d\.most >= \$3 ORDER BY d\.day DESC, d\.most DESC, d\.student_id LIMIT \$4$/);
  assert.match(s, /LEFT JOIN students st ON st\.id = d\.student_id/);
});

/* ------------------------------------------------------------- the read */

type Call = { text: string; values: readonly unknown[] };

function fakeDb(answers: Record<string, unknown>[][]) {
  const calls: Call[] = [];
  let i = 0;
  return {
    calls,
    db: {
      query: async (text: string, values: readonly unknown[] = []) => {
        calls.push({ text, values });
        const rows = answers[i++] ?? [];
        return { rows, rowCount: rows.length };
      },
    },
  };
}

test("the summary counts with uploadThresholdStatus's rule, and the highest only on request", () => {
  for (const withHighest of [false, true]) {
    const sql = squash(STUDENT_DAY_SUMMARY_SQL(withHighest));
    assert.match(sql, /count\(\*\) FILTER \(WHERE d\.most >= \$3\) AS reached/);
    assert.match(sql, /count\(\*\) FILTER \(WHERE d\.most > \$3\) AS past/);
    assert.doesNotMatch(sql, /students|display_name/, "the summary names nobody");
  }
  assert.doesNotMatch(STUDENT_DAY_SUMMARY_SQL(false), /max\(d\.most\)/, "no one student's count without student-data");
  assert.match(squash(STUDENT_DAY_SUMMARY_SQL(true)), /coalesce\(max\(d\.most\), 0\) AS highest/);
});

const TOTALS = [{ uploads: "23", students: "3" }];
const OUTCOMES = [
  { outcome: "ok", parses: "20" },
  { outcome: "error", parses: "2" },
  { outcome: "timeout", parses: "1" },
];
const SUMMARY = [{ student_days: "4", reached: "2", past: "1", highest: "12" }];

test("readUploadsView with student-data: four queries, this environment, this period, the threshold from the module", async () => {
  const { db, calls } = fakeDb([
    TOTALS,
    OUTCOMES,
    SUMMARY,
    [
      { student_id: "7", display_name: "Omar", day: "2026-09-24", most: "12", uploads: "12" },
      { student_id: "8", display_name: null, day: "2026-09-22", most: "10", uploads: "6" },
    ],
  ]);
  const view = await readUploadsView(db, 30, { studentDetail: true });

  assert.deepEqual(
    calls.map((c) => c.text),
    [UPLOAD_TOTALS_SQL, PARSE_OUTCOMES_SQL, STUDENT_DAY_SUMMARY_SQL(true), STUDENT_DAYS_SQL]
  );
  assert.deepEqual(calls[0].values, [ENVIRONMENT, "30"]);
  assert.deepEqual(calls[1].values, [ENVIRONMENT, "30"]);
  assert.deepEqual(calls[2].values, [ENVIRONMENT, "30", 10]);
  assert.deepEqual(calls[3].values, [ENVIRONMENT, "30", 10, UPLOAD_DAYS_LIMIT + 1]);

  assert.equal(view.uploads, 23);
  assert.equal(view.students, 3);
  assert.deepEqual(view.parses, { delivered: 20, failed: 3, other: 0 });
  assert.deepEqual(view.threshold, { threshold: 10, studentDays: 4, reached: 2, past: 1, highest: 12 });
  assert.equal(view.detail?.recentCapped, false);
  assert.deepEqual(view.detail?.recentDays, [
    { studentId: 7, displayName: "Omar", day: "2026-09-24", most: 12, uploads: 12 },
    { studentId: 8, displayName: null, day: "2026-09-22", most: 10, uploads: 6 },
  ]);
});

test("readUploadsView without student-data: aggregates only, no list query, no highest (FR-2406)", async () => {
  const { db, calls } = fakeDb([TOTALS, OUTCOMES, SUMMARY]);
  const view = await readUploadsView(db, 30, { studentDetail: false });
  assert.deepEqual(
    calls.map((c) => c.text),
    [UPLOAD_TOTALS_SQL, PARSE_OUTCOMES_SQL, STUDENT_DAY_SUMMARY_SQL(false)],
    "the per-student list's query is never sent"
  );
  assert.equal(view.detail, null);
  assert.deepEqual(view.threshold, { threshold: 10, studentDays: 4, reached: 2, past: 1, highest: null });
  // totals, students, outcomes and the reached/past counts still arrive
  assert.equal(view.uploads, 23);
  assert.equal(view.students, 3);
  assert.deepEqual(view.parses, { delivered: 20, failed: 3, other: 0 });
  assert.doesNotMatch(JSON.stringify(view), /studentId|displayName|recentDays|"most"/);
});

test("no uploads at all reads as zeros the page can tell apart from data", async () => {
  const { db } = fakeDb([[{ uploads: 0, students: 0 }], [], [{ student_days: 0, reached: 0, past: 0, highest: 0 }], []]);
  const view = await readUploadsView(db, 7, { studentDetail: true });
  assert.equal(view.uploads, 0);
  assert.deepEqual(view.parses, { delivered: 0, failed: 0, other: 0 });
  assert.equal(view.threshold.studentDays, 0);
  assert.deepEqual(view.detail?.recentDays, []);
});

test("the list says when it was cut", async () => {
  const row = { student_id: 1, display_name: "A", day: "2026-09-20", most: 11, uploads: 11 };
  const { db } = fakeDb([[{ uploads: 0, students: 0 }], [], [], Array.from({ length: UPLOAD_DAYS_LIMIT + 1 }, () => row)]);
  const view = await readUploadsView(db, 90, { studentDetail: true });
  assert.equal(view.detail?.recentDays.length, UPLOAD_DAYS_LIMIT);
  assert.equal(view.detail?.recentCapped, true);
});

/* ------------------------------------------------------ where it shows */

test("the Cost page: the upload panel sits beside the turn-limit panel, honest when empty, amber when reached", () => {
  const cost = code("lib/cost-queries.ts");
  assert.match(cost, /\(\) => readUploadsView\(db, periodDays, access\),\s*\] as const\)/);
  const page = code("app/(console)/cost/page.console.tsx");
  assert.match(page, /<TurnLimits [^>]*\/>\s*<PhotoUploads view=\{view\} periodText=\{periodText\} \/>/);
  assert.match(page, /title="Photo uploads — observed, not enforced"/);
  assert.match(page, /tone=\{reached \? "attention" : "neutral"\}/);
  assert.match(page, /const nothing = u\.uploads === 0 && parses === 0 && view\.upload\.turns === 0;/);
  assert.match(page, /\{nothing \? \(\s*<Empty>/, "no uploads is an empty state, not a row of zeros");
  // FR-2406: without detail, the note and neither the list nor the highest column
  assert.match(page, /\{u\.detail == null \? \(\s*<p[^>]*>\s*\{STUDENT_DATA_NOTE_UPLOADS\}/);
  assert.match(page, /"Which students, and their upload counts, need the student-data role \(FR-2406\)\."/);
  assert.match(page, /\{u\.detail \? <Th right>Most in 24 hours<\/Th> : null\}/);
  assert.match(page, /<ReachedStudentDays detail=\{u\.detail\} periodText=\{periodText\} \/>/);
});

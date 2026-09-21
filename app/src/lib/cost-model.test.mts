/**
 * SC-109, with fixture rows: **per-student cost reconciles with the period
 * total to within rounding**, and every student with at least one interaction
 * has a figure.
 *
 * The fixtures are the exact row shape `lib/cost-queries.ts` selects — one row
 * per (student, surface_kind) — so this exercises the fold the page renders
 * from, not a simplified stand-in for it. The database is not involved: the
 * reconciliation is arithmetic, and arithmetic that only runs against a live
 * Postgres is arithmetic nobody checks.
 *
 * @covers FR-2401
 * @covers FR-2402
 * @covers FR-2403
 * @covers SC-109
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUCKETS,
  BUCKET_LABEL,
  DEFAULT_PERIOD,
  PERIODS,
  RECONCILE_EPSILON_USD,
  bucketOf,
  daysOfPeriod,
  denseSeries,
  foldPerStudent,
  periodLabel,
  periodOf,
  reconcile,
  rollupFreshness,
  type PerStudentBucketRow,
  type SeriesRow,
} from "./cost-model.ts";

/* -------------------------------------------------------------- fixtures */

const row = (o: Partial<PerStudentBucketRow> & { studentId: number }): PerStudentBucketRow => ({
  displayName: `Student ${o.studentId}`,
  subscriptionStatus: "none",
  surfaceKind: "chat",
  turns: 1,
  costUsd: 0,
  tokens: 0,
  priceBasis: "cli-list-price",
  unpricedTurns: 0,
  firstAt: "2026-09-18T09:00:00.000Z",
  lastAt: "2026-09-20T18:00:00.000Z",
  ...o,
});

/**
 * Three students. Omar teaches and uploads; Nour only teaches; Yara has one
 * pre-migration-009 row with no kind at all. Deliberately awkward decimals:
 * a reconciliation that only passes on round numbers is not a reconciliation.
 */
const BUCKET_ROWS: PerStudentBucketRow[] = [
  row({ studentId: 1, surfaceKind: "chat", turns: 12, costUsd: 0.184321, tokens: 92_000 }),
  row({ studentId: 1, surfaceKind: "understanding", turns: 2, costUsd: 0.041002, tokens: 31_400 }),
  row({ studentId: 1, surfaceKind: "upload_parse", turns: 3, costUsd: 0.070915, tokens: 18_200 }),
  row({ studentId: 2, surfaceKind: "chat", turns: 7, costUsd: 0.093117, tokens: 54_100 }),
  row({ studentId: 3, surfaceKind: null, turns: 1, costUsd: 0.002004, tokens: 1_900 }),
];

const PERIOD_TOTAL = BUCKET_ROWS.reduce((n, r) => n + r.costUsd, 0);

const SERIES_ROWS: SeriesRow[] = [
  { studentId: 1, day: "2026-09-19", costUsd: 0.12, turns: 6, live: false },
  { studentId: 1, day: "2026-09-20", costUsd: 0.146238, turns: 8, live: false },
  { studentId: 1, day: "2026-09-21", costUsd: 0.03, turns: 3, live: true },
  { studentId: 2, day: "2026-09-20", costUsd: 0.093117, turns: 7, live: false },
  { studentId: 3, day: "2026-09-18", costUsd: 0.002004, turns: 1, live: false },
];

/* ------------------------------------------------------------- bucketing */

test("upload/OCR is its own bucket, and nothing else lands in it", () => {
  assert.equal(bucketOf("upload_parse"), "upload");
  assert.equal(bucketOf("chat"), "ai");
  assert.equal(bucketOf("understanding"), "ai");
  // Pre-migration-009 rows have no kind. They are NOT folded into teaching:
  // attributing a cost to a function that may not have spent it is exactly
  // what surface_kind exists to prevent.
  assert.equal(bucketOf(null), "unattributed");
  assert.equal(bucketOf(undefined), "unattributed");
  assert.equal(bucketOf("unattributed"), "unattributed");
  // A kind nobody has classified is teaching-side by default, which is the
  // conservative direction: it cannot silently deflate the OCR figure.
  assert.equal(bucketOf("some_future_kind"), "ai");
});

test("every bucket has a label a founder can read", () => {
  for (const b of BUCKETS) {
    assert.ok(BUCKET_LABEL[b].length > 0);
    assert.notEqual(BUCKET_LABEL[b], b, "FR-2211: no heading is a field name");
  }
});

/* ---------------------------------------------------------- the fold */

test("AI and upload/OCR reach the page as two figures and are never added", () => {
  const [omar] = foldPerStudent(BUCKET_ROWS.filter((r) => r.studentId === 1));
  assert.ok(omar);
  // chat + understanding, and NOT the three upload turns.
  assert.equal(omar!.ai.turns, 14);
  assert.equal(Number(omar!.ai.costUsd.toFixed(6)), 0.225323);
  assert.equal(omar!.upload.turns, 3);
  assert.equal(Number(omar!.upload.costUsd.toFixed(6)), 0.070915);
  assert.notEqual(omar!.ai.costUsd, omar!.reconcileTotalUsd, "the two must not be the same number");
  assert.equal(Number(omar!.reconcileTotalUsd.toFixed(6)), 0.296238);
  assert.equal(omar!.ai.tokens, 123_400);
});

test("a student with no upload still has an upload figure, and it is a real zero", () => {
  const [nour] = foldPerStudent(BUCKET_ROWS.filter((r) => r.studentId === 2));
  assert.equal(nour!.upload.turns, 0);
  assert.equal(nour!.upload.costUsd, 0);
  assert.equal(nour!.ai.turns, 7);
});

test("every student with an interaction gets a row, ordered by what they cost", () => {
  const folded = foldPerStudent(BUCKET_ROWS, SERIES_ROWS);
  assert.equal(folded.length, 3, "SC-109: every student with at least one interaction");
  assert.deepEqual(
    folded.map((s) => s.studentId),
    [1, 2, 3],
    "most expensive first"
  );
  assert.deepEqual(folded.map((s) => s.displayName), [
    "Student 1",
    "Student 2",
    "Student 3",
  ]);
});

test("the series arrives sorted, and says which day is live", () => {
  const folded = foldPerStudent(BUCKET_ROWS, SERIES_ROWS);
  const omar = folded.find((s) => s.studentId === 1)!;
  assert.deepEqual(
    omar.series.map((p) => p.day),
    ["2026-09-19", "2026-09-20", "2026-09-21"]
  );
  assert.deepEqual(
    omar.series.map((p) => p.live),
    [false, false, true],
    "only today is answered live; the rest come from the rollup"
  );
});

test("a series point for a student with no totals is dropped, not invented", () => {
  const folded = foldPerStudent(BUCKET_ROWS, [
    ...SERIES_ROWS,
    { studentId: 99, day: "2026-09-20", costUsd: 5, turns: 1, live: false },
  ]);
  assert.equal(folded.length, 3);
  assert.equal(folded.some((s) => s.studentId === 99), false);
});

/* ------------------------------------------------------- SC-109 itself */

test("SC-109: the per-student totals sum to the period total", () => {
  const folded = foldPerStudent(BUCKET_ROWS, SERIES_ROWS);
  const r = reconcile(folded, PERIOD_TOTAL);
  assert.equal(r.matches, true, `off by ${r.differenceUsd}`);
  assert.equal(r.studentsCounted, 3);
  assert.equal(Number(r.perStudentSumUsd.toFixed(6)), Number(PERIOD_TOTAL.toFixed(6)));
});

test("SC-109 tolerates rounding and nothing larger", () => {
  const folded = foldPerStudent(BUCKET_ROWS, SERIES_ROWS);
  // Half a cent of the sixth decimal place: the ledger stores six places and
  // the page prints four.
  assert.equal(reconcile(folded, PERIOD_TOTAL + RECONCILE_EPSILON_USD / 2).matches, true);
  // A hundredth of a cent is NOT rounding, and must be reported.
  assert.equal(reconcile(folded, PERIOD_TOTAL + 0.0001).matches, false);
});

test("a dropped student is caught, and the difference is named", () => {
  // The failure this check exists for: a student missing from the per-student
  // query — a join that lost them, an environment filter applied to one query
  // and not the other. The page prints the gap rather than a silent tick.
  const folded = foldPerStudent(
    BUCKET_ROWS.filter((r) => r.studentId !== 3),
    SERIES_ROWS
  );
  const r = reconcile(folded, PERIOD_TOTAL);
  assert.equal(r.matches, false);
  assert.equal(r.studentsCounted, 2);
  assert.equal(Number(r.differenceUsd.toFixed(6)), -0.002004);
});

test("a double-counted upload bucket is caught too", () => {
  const folded = foldPerStudent([...BUCKET_ROWS, BUCKET_ROWS[2]!], SERIES_ROWS);
  const r = reconcile(folded, PERIOD_TOTAL);
  assert.equal(r.matches, false);
  assert.equal(Number(r.differenceUsd.toFixed(6)), 0.070915);
});

test("an empty period reconciles at zero rather than failing", () => {
  const r = reconcile([], 0);
  assert.equal(r.matches, true);
  assert.equal(r.studentsCounted, 0);
});

/* ------------------------------------------------------ rollup freshness */

test("a closed day nobody rolled up is reported, not drawn as a gap", () => {
  const folded = foldPerStudent(BUCKET_ROWS, SERIES_ROWS);
  // The fixtures' series sums to 0.391359 against a ledger total of 0.391359 —
  // the rollup is current.
  const current = rollupFreshness(folded, PERIOD_TOTAL);
  assert.equal(current.complete, true, `missing ${current.missingUsd}`);

  // Drop a stored day: the series is now short, and the SERIES is the one
  // that is wrong.
  const stale = foldPerStudent(
    BUCKET_ROWS,
    SERIES_ROWS.filter((p) => p.day !== "2026-09-20")
  );
  const f = rollupFreshness(stale, PERIOD_TOTAL);
  assert.equal(f.complete, false);
  assert.ok(f.missingUsd > 0, "the ledger is ahead of the rollup, never behind it");
});

/* -------------------------------------------------------------- periods */

test("the period switch offers three windows and defaults to thirty days", () => {
  assert.deepEqual([...PERIODS], [7, 30, 90]);
  assert.equal(DEFAULT_PERIOD, 30);
  assert.equal(periodOf("7"), 7);
  assert.equal(periodOf(90), 90);
  // Anything else is the default rather than an error page: a bad query string
  // should not be able to blank a console view.
  assert.equal(periodOf("45"), 30);
  assert.equal(periodOf(undefined), 30);
  assert.equal(periodOf("'; DROP TABLE"), 30);
});

test("every period label names its period (FR-2211)", () => {
  for (const p of PERIODS) {
    assert.ok(periodLabel(p).includes(String(p)));
    assert.ok(/day/.test(periodLabel(p)));
  }
});

test("the axis is the whole period, oldest day first, ending today", () => {
  const today = new Date("2026-09-21T06:30:00.000Z");
  const days = daysOfPeriod(7, today);
  assert.equal(days.length, 7);
  assert.equal(days[0], "2026-09-15");
  assert.equal(days[6], "2026-09-21");
});

test("a day with no spend is a zero on the chart, and today stays live", () => {
  const today = new Date("2026-09-21T06:30:00.000Z");
  const dense = denseSeries(
    [{ day: "2026-09-20", costUsd: 0.146238, turns: 8, live: false }],
    7,
    today
  );
  assert.equal(dense.length, 7);
  assert.equal(dense[5]!.day, "2026-09-20");
  assert.equal(dense[5]!.costUsd, 0.146238);
  assert.equal(dense[0]!.costUsd, 0, "absence of spend, not absence of data");
  assert.equal(dense[6]!.live, true, "the padded today is still the live day");
  assert.equal(dense[0]!.live, false);
});

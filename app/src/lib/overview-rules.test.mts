/**
 * School-year week arithmetic, the retention definition, and the dictionary's
 * completeness (contracts/admin.md §8, research A3/R13, ADR-0016 §3, FR-2507).
 *
 * The two things worth a test here are the two things ADR-0016 says a wrong
 * answer to would make the pilot's verdict meaningless:
 *
 *  - **Weeks are school-year weeks, not calendar weeks.** On calendar weeks,
 *    month-2 retention splits across a January boundary and reports two halves
 *    of a number. So a date in June must belong to the school year that opened
 *    the previous September, and this asserts it.
 *  - **Retention is measured per student from their own first session**, with a
 *    denominator that excludes students who cannot yet be measured.
 *
 * Pure. No pool, no Next, no clock but the one each test hands in.
 *
 * @covers FR-2507
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ANCHOR_DESCRIPTION,
  DEFINITIONS,
  DAY_MS,
  MASTERY_THRESHOLD,
  RETENTION_END_DAY,
  RETENTION_START_DAY,
  cite,
  definitionOf,
  heatCell,
  monthTwoRetention,
  schoolWeekOf,
  schoolYearOf,
  schoolYearStart,
  weekKey,
  weekStart,
  weeksBetween,
} from "./overview-rules.ts";

/* ------------------------------------------------------------ the anchor */

test("the anchor is the third Saturday of September, and it really is a Saturday", () => {
  for (const year of [2024, 2025, 2026, 2027, 2028, 2030]) {
    const d = schoolYearStart(year);
    assert.equal(d.getUTCDay(), 6, `${year}: the anchor must fall on a Saturday`);
    assert.equal(d.getUTCMonth(), 8, `${year}: the anchor is in September`);
    assert.ok(
      d.getUTCDate() >= 15 && d.getUTCDate() <= 21,
      `${year}: the third Saturday is always between the 15th and the 21st, got ${d.getUTCDate()}`
    );
  }
});

test("2026's school year opens on Saturday 19 September 2026", () => {
  // Named in the metric dictionary, so a week number is never read as
  // authoritative by somebody who has not seen what it counts from.
  assert.equal(schoolYearStart(2026).toISOString(), "2026-09-19T00:00:00.000Z");
  assert.match(ANCHOR_DESCRIPTION, /third Saturday of September/);
});

/* -------------------------------------------------------- the week maths */

test("the anchor day itself is week 1, and so is the Friday six days later", () => {
  const anchor = schoolYearStart(2026);
  assert.deepEqual(schoolWeekOf(anchor), { year: 2026, week: 1 });
  assert.deepEqual(schoolWeekOf(new Date(anchor.getTime() + 6 * DAY_MS)), {
    year: 2026,
    week: 1,
  });
  assert.deepEqual(schoolWeekOf(new Date(anchor.getTime() + 7 * DAY_MS)), {
    year: 2026,
    week: 2,
  });
});

test("a date in June belongs to the school year that opened the previous September", () => {
  // The property calendar weeks lack, and the whole reason this module exists.
  const june = new Date("2027-06-15T00:00:00.000Z");
  assert.equal(schoolYearOf(june), 2026);
  assert.ok(schoolWeekOf(june).week > 35, "late in the 2026 school year, not week 24 of 2027");
});

test("January does not restart the numbering", () => {
  const dec = schoolWeekOf(new Date("2026-12-28T00:00:00.000Z"));
  const jan = schoolWeekOf(new Date("2027-01-04T00:00:00.000Z"));
  assert.equal(dec.year, 2026);
  assert.equal(jan.year, 2026, "the same school year, or month-2 retention reports two halves");
  assert.equal(jan.week, dec.week + 1);
});

test("a date before September belongs to the previous school year", () => {
  assert.equal(schoolYearOf(new Date("2026-09-18T23:59:59.000Z")), 2025);
  assert.equal(schoolYearOf(new Date("2026-09-19T00:00:00.000Z")), 2026);
});

test("weekStart is the inverse of schoolWeekOf", () => {
  for (const week of [1, 2, 17, 40]) {
    const start = weekStart({ year: 2026, week });
    assert.deepEqual(schoolWeekOf(start), { year: 2026, week });
  }
});

test("week keys sort in time order within a year", () => {
  const keys = [1, 2, 9, 10, 11, 40].map((week) => weekKey({ year: 2026, week }));
  assert.deepEqual([...keys].sort(), keys, "zero-padding is what makes W02 sort before W10");
});

test("weeksBetween is dense — a quiet week is a week, not a gap", () => {
  const from = schoolYearStart(2026);
  const to = new Date(from.getTime() + 4 * 7 * DAY_MS);
  const weeks = weeksBetween(from, to);
  assert.deepEqual(
    weeks.map((w) => w.week),
    [1, 2, 3, 4, 5],
    "a heatmap that skipped an empty week would draw the school holiday as if it never happened"
  );
});

test("weeksBetween does not loop forever on an inverted range", () => {
  const out = weeksBetween(new Date("2027-01-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
  assert.equal(out.length, 1);
});

/* --------------------------------------------------------- the retention */

const iso = (base: number, days: number) => new Date(base + days * DAY_MS).toISOString();

test("a student who came back on day 40 is retained", () => {
  const first = Date.parse("2026-09-21T00:00:00.000Z");
  const now = first + 70 * DAY_MS;
  const r = monthTwoRetention(
    [{ firstSessionAt: iso(first, 0), sessionsAt: [iso(first, 0), iso(first, 40)] }],
    now
  );
  assert.deepEqual(r, { eligible: 1, retained: 1, rate: 1, tooRecent: 0 });
});

test("a student who only ever came back on day 20 is measurable and not retained", () => {
  const first = Date.parse("2026-09-21T00:00:00.000Z");
  const now = first + 70 * DAY_MS;
  const r = monthTwoRetention(
    [{ firstSessionAt: iso(first, 0), sessionsAt: [iso(first, 0), iso(first, 20)] }],
    now
  );
  assert.equal(r.eligible, 1);
  assert.equal(r.retained, 0);
  assert.equal(r.rate, 0);
});

test("the window is [30, 60) — day 30 counts, day 60 does not", () => {
  const first = Date.parse("2026-09-21T00:00:00.000Z");
  const now = first + 90 * DAY_MS;
  const at = (d: number) =>
    monthTwoRetention([{ firstSessionAt: iso(first, 0), sessionsAt: [iso(first, d)] }], now)
      .retained;
  assert.equal(at(RETENTION_START_DAY - 1), 0);
  assert.equal(at(RETENTION_START_DAY), 1);
  assert.equal(at(RETENTION_END_DAY - 1), 1);
  assert.equal(at(RETENTION_END_DAY), 0);
});

test("a student who joined last week is NOT counted as unretained", () => {
  // The half that is usually left out: folding the not-yet-measurable into the
  // denominator drives the figure down every time somebody new signs up, which
  // would make the pilot's own success metric fall as the pilot grows.
  const now = Date.parse("2026-10-20T00:00:00.000Z");
  const r = monthTwoRetention(
    [{ firstSessionAt: new Date(now - 7 * DAY_MS).toISOString(), sessionsAt: [] }],
    now
  );
  assert.deepEqual(r, { eligible: 0, retained: 0, rate: null, tooRecent: 1 });
});

test("a rate over zero measurable students is null, not zero per cent", () => {
  assert.equal(monthTwoRetention([], Date.now()).rate, null);
});

test("retention is measured per student, so a 31st-of-the-month signup has a second month", () => {
  const a = Date.parse("2026-10-31T00:00:00.000Z");
  const b = Date.parse("2026-11-01T00:00:00.000Z");
  const now = b + 70 * DAY_MS;
  const r = monthTwoRetention(
    [
      { firstSessionAt: new Date(a).toISOString(), sessionsAt: [iso(a, 35)] },
      { firstSessionAt: new Date(b).toISOString(), sessionsAt: [iso(b, 35)] },
    ],
    now
  );
  assert.equal(r.eligible, 2);
  assert.equal(r.retained, 2);
});

/* ------------------------------------------------------ the heatmap cell */

test("never reached and reached-but-failing are different states, not different shades", () => {
  const never = heatCell(0, 0);
  const failing = heatCell(10, 0);
  assert.equal(never.state, "never-reached");
  assert.equal(never.share, null, "there is no share of nobody");
  assert.equal(failing.state, "reached");
  assert.equal(failing.share, 0);
  assert.notEqual(
    never.state,
    failing.state,
    "the same low number meaning opposite things is the view's entire point"
  );
});

test("a fully mastered cell is a share of one", () => {
  assert.equal(heatCell(4, 4).share, 1);
});

/* -------------------------------------------------------- the dictionary */

test("the dictionary defines every term the contract names, plus week and cohort", () => {
  const terms = DEFINITIONS.map((d) => d.term).sort();
  assert.deepEqual(terms, [
    "activated",
    "active",
    "cohort",
    "mastered",
    "retained",
    "session",
    "time-on-task",
    "week",
  ]);
});

test("every definition says where it is computed, so a reader can disagree with the code", () => {
  for (const d of DEFINITIONS) {
    assert.ok(d.text.length > 80, `${d.term}: a definition shorter than a sentence is a label`);
    assert.ok(d.computedIn.includes("."), `${d.term}: name the file`);
  }
});

test("cite() throws on a term with no definition", () => {
  // A figure citing a definition that does not exist is worse than one citing
  // none: the citation is the reason a reader stops asking.
  assert.throws(() => cite("engagement"), /metric dictionary/);
  assert.equal(cite("active").term, "active");
  assert.equal(definitionOf("nope"), undefined);
});

test("the mastered definition quotes the threshold the product actually paints", () => {
  assert.equal(MASTERY_THRESHOLD, 0.75);
  assert.ok(cite("mastered").text.includes(String(MASTERY_THRESHOLD)));
});

test("the week definition names the anchor in prose", () => {
  assert.ok(cite("week").text.includes(ANCHOR_DESCRIPTION));
});

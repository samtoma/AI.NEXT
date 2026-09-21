/**
 * The metric dictionary, as code (contracts/admin.md §8, research A3/R13,
 * ADR-0016 §3, FR-2507).
 *
 * At n=200 the difference between two defensible definitions of "active"
 * exceeds any effect the pilot could detect, which is why research A3 calls the
 * dictionary "cheaper and more load-bearing than any of the three views". So
 * the definitions live in one pure module, the queries cite them **by name**,
 * and `/overview/definitions` renders the same strings a reader of this file
 * sees. There is no second copy to drift.
 *
 * Pure: no pool, no Next, no clock but the one it is handed. `node --test` and
 * nothing else.
 *
 * ---------------------------------------------------------------------------
 * SCHOOL-YEAR WEEKS, AND THE ANCHOR THIS FILE CHOSE
 * ---------------------------------------------------------------------------
 * Every time bucket in the overviews is a **school-year week**, never a calendar
 * week (ADR-0016 §3): month-2 retention is the pilot's own success metric, and
 * on calendar weeks it splits across a January boundary and reports two halves
 * of a number.
 *
 * The anchor is the start of the Egyptian school year. Research A3 says **"late
 * September"** and R13 repeats "the Egyptian school-year start" — neither names
 * a date, so this file picks one and names it rather than leaving it implicit:
 *
 *   **the third Saturday of September** — the day the ministry's school year
 *   conventionally opens, and a Saturday because the Egyptian week begins on
 *   one. For 2026 that is **Saturday 19 September 2026**.
 *
 * That is a choice, not a citation, and it is printed on the definitions page
 * so nobody reads a week number as authoritative without seeing what it counts
 * from. Changing it is one constant here and every figure moves with it.
 *
 * UTC throughout, like every other timestamp the console prints
 * (`components/console/ui.tsx`). Cairo is UTC+2 with no DST, so a session at
 * 01:30 Cairo lands in the previous UTC day; at week granularity that shifts
 * nothing a pilot verdict rests on, and a second timezone in this codebase
 * would.
 */

// A RELATIVE import with an explicit `.ts`, like `lib/auth/*` — this module is
// loaded by `node --test`, which has no `@/` alias and would fail to resolve
// one at runtime. `lib/mastery.ts` itself imports nothing, so the whole graph
// reachable from here stays runnable outside the bundler.
import { MASTERY_THRESHOLD } from "./mastery.ts";

export { MASTERY_THRESHOLD };

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

/** September, zero-based for `Date.UTC`. */
const SEPTEMBER = 8;

/** Which Saturday of September opens the school year. Third. */
export const ANCHOR_NTH_SATURDAY = 3;

/** Human-readable, for the definitions page and the heatmap legend. */
export const ANCHOR_DESCRIPTION = "the third Saturday of September";

/**
 * The third Saturday of September in `calendarYear`, at 00:00 UTC.
 *
 * Computed rather than tabulated: a table of dates is a thing somebody has to
 * extend in 2029, and the rule is one line.
 */
export function schoolYearStart(calendarYear: number): Date {
  const first = new Date(Date.UTC(calendarYear, SEPTEMBER, 1));
  // getUTCDay: 0 = Sunday … 6 = Saturday. Days to add to reach the first
  // Saturday, then two more weeks for the third.
  const toFirstSaturday = (6 - first.getUTCDay() + 7) % 7;
  const day = 1 + toFirstSaturday + (ANCHOR_NTH_SATURDAY - 1) * 7;
  return new Date(Date.UTC(calendarYear, SEPTEMBER, day));
}

/**
 * Which school year a moment belongs to, named by the calendar year it opened
 * in: `2026` means the year that began in September 2026 and runs into 2027.
 *
 * A date in, say, June 2027 belongs to school year 2026 — which is exactly the
 * property calendar weeks lack and the reason this function exists.
 */
export function schoolYearOf(at: Date): number {
  const y = at.getUTCFullYear();
  return at.getTime() >= schoolYearStart(y).getTime() ? y : y - 1;
}

export type SchoolWeek = {
  /** The school year, named by its opening calendar year. */
  year: number;
  /** 1-based. Week 1 begins on the anchor. */
  week: number;
};

/**
 * The school-year week a moment falls in.
 *
 * Week 1 begins on the anchor, so the anchor day itself is week 1 and the
 * Friday six days later is still week 1. A date BEFORE the anchor belongs to
 * the previous school year, with a week number in the high forties — which is
 * correct and is why the year travels with the week everywhere below.
 */
export function schoolWeekOf(at: Date): SchoolWeek {
  const year = schoolYearOf(at);
  const start = schoolYearStart(year).getTime();
  return { year, week: Math.floor((at.getTime() - start) / WEEK_MS) + 1 };
}

/** The Saturday that opens `week` of `year`, at 00:00 UTC. */
export function weekStart({ year, week }: SchoolWeek): Date {
  return new Date(schoolYearStart(year).getTime() + (week - 1) * WEEK_MS);
}

/** `2026-W01`. Sorts lexically in time order within a year, which the heatmap needs. */
export function weekKey({ year, week }: SchoolWeek): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Every week from `from` to `to` inclusive, as a dense run.
 *
 * Dense on purpose: a heatmap that skipped a week with no activity would draw
 * the school holiday as if it had not happened, and "nobody studied that week"
 * is one of the few things a cohort view can actually tell you.
 */
export function weeksBetween(from: Date, to: Date): SchoolWeek[] {
  const a = schoolWeekOf(from);
  const b = schoolWeekOf(to);
  const out: SchoolWeek[] = [];
  let cursor = weekStart(a).getTime();
  const end = weekStart(b).getTime();
  // Guard against an inverted range rather than looping forever on one.
  if (cursor > end) return [a];
  while (cursor <= end) {
    out.push(schoolWeekOf(new Date(cursor)));
    cursor += WEEK_MS;
  }
  return out;
}

/* ====================================================== month-2 retention */

/**
 * The pilot's own success metric, and the one number most worth being explicit
 * about: *"≥60% month-2 retention"* (CLAUDE.md, PRD pilot criteria).
 *
 * **Retained** = a student whose first session falls in the cohort, and who has
 * at least one session in the window **[day 30, day 60)** measured from that
 * first session — not from a calendar month, because a student who signed up on
 * the 31st has no second month otherwise.
 *
 * The window is per student rather than absolute so the figure means the same
 * thing for somebody who joined in week 1 and somebody who joined in week 6.
 * `eligible` is the half that is usually left out and is why this returns a
 * pair: a student whose day 30 has not arrived yet is not "not retained", they
 * are **not yet measurable**, and folding them into the denominator drives the
 * number down every time somebody new signs up.
 */
export const RETENTION_START_DAY = 30;
export const RETENTION_END_DAY = 60;

export type RetentionInput = {
  firstSessionAt: string;
  /** Every session start for this student, ISO-8601. May include the first. */
  sessionsAt: readonly string[];
};

export type Retention = {
  /** Students whose day-60 window has opened — the honest denominator. */
  eligible: number;
  retained: number;
  /** null when nobody is eligible yet: a rate over zero students is not 0%. */
  rate: number | null;
  /** Students who joined too recently to be measurable. Reported, never hidden. */
  tooRecent: number;
};

export function monthTwoRetention(
  students: readonly RetentionInput[],
  nowMs: number
): Retention {
  let eligible = 0;
  let retained = 0;
  let tooRecent = 0;

  for (const s of students) {
    const first = Date.parse(s.firstSessionAt);
    if (!Number.isFinite(first)) continue;
    const windowOpens = first + RETENTION_START_DAY * DAY_MS;
    const windowCloses = first + RETENTION_END_DAY * DAY_MS;
    if (nowMs < windowOpens) {
      tooRecent += 1;
      continue;
    }
    eligible += 1;
    const back = s.sessionsAt.some((iso) => {
      const t = Date.parse(iso);
      return Number.isFinite(t) && t >= windowOpens && t < windowCloses;
    });
    if (back) retained += 1;
  }

  return {
    eligible,
    retained,
    rate: eligible === 0 ? null : retained / eligible,
    tooRecent,
  };
}

/* ========================================================== the dictionary */

export type Definition = {
  term: string;
  /** One written definition. Prose, not a formula — the formula is the query. */
  text: string;
  /** Where it is computed. A reader who disagrees knows which file to open. */
  computedIn: string;
};

/**
 * One definition each for active, session, time-on-task, mastered, retained,
 * activated — plus week and cohort, which the brief adds because every other
 * definition is stated in terms of them.
 *
 * The queries cite these **by `term`**, so a figure on a page and its definition
 * on the dictionary page cannot come apart.
 */
export const DEFINITIONS: readonly Definition[] = [
  {
    term: "week",
    text:
      `A school-year week. Week 1 begins on ${ANCHOR_DESCRIPTION} — the conventional opening of ` +
      `the Egyptian school year — and every later week is seven days from there. Never a calendar ` +
      `week: month-2 retention on calendar weeks splits across the January boundary and reports ` +
      `two halves of the pilot's own success metric. All timestamps are UTC. The anchor is a ` +
      `choice this build made because the research says "late September" without naming a date; ` +
      `changing it moves every week number on every overview.`,
    computedIn: "lib/overview-rules.ts — schoolWeekOf()",
  },
  {
    term: "cohort",
    text:
      `The students of one (subject, grade, syllabus version) whose first learning session falls ` +
      `in that school year. Subject comes from the course the objective belongs to, grade from the ` +
      `student's own record, and syllabus version from the curriculum edges — three different axes ` +
      `that a single "year" would conflate into a number meaning nothing. No figure is ever pooled ` +
      `across environments or solutions.`,
    computedIn: "lib/overview-queries.ts — getCohortOverview()",
  },
  {
    term: "session",
    text:
      `A row in the sessions table: one continuous stretch of study with an opened-at, a ` +
      `last-seen-at and a close reason. One student has at most one open session at a time; it ` +
      `closes when they finish, when they are idle, when a new one supersedes it, or when it is ` +
      `abandoned. A session is not a page view and not a sign-in.`,
    computedIn: "lib/sessions.ts",
  },
  {
    term: "active",
    text:
      `Active in a week = the student opened at least one session in that school-year week. ` +
      `Deliberately the weakest defensible definition: it counts showing up, not finishing. A ` +
      `stricter one — "completed an objective" — halves the number at n=200 without making it ` +
      `more true, and the difference between the two exceeds any effect this pilot could detect.`,
    computedIn: "lib/overview-queries.ts — weeklyActive",
  },
  {
    term: "time-on-task",
    text:
      `TWO numbers, never blended. Answering time is the sum of the per-attempt milliseconds the ` +
      `client recorded. Session wall-clock is opened-at to last-seen-at. The first excludes ` +
      `reading, watching and thinking; the second includes a student who walked away with the tab ` +
      `open. Averaging them would produce a figure that is neither.`,
    computedIn: "lib/console-queries.ts — timeOnTask",
  },
  {
    term: "mastered",
    text:
      `An objective whose current BKT posterior is at or above ${MASTERY_THRESHOLD} — the floor of ` +
      `the top band on the scale the student's own dashboard paints. "Current" means the mastery ` +
      `row with no system-to: the table is bitemporal, history is never overwritten, and an as-of ` +
      `figure is a predicate rather than a different table.`,
    computedIn: "lib/mastery.ts — MASTERY_THRESHOLD",
  },
  {
    term: "activated",
    text:
      `A three-step funnel, each step a strict subset of the one before: an account was created; ` +
      `the email address was confirmed; a first learning session was opened. Reported as three ` +
      `counts rather than one percentage, because which step people fall out of is the entire ` +
      `question and a single rate hides it.`,
    computedIn: "lib/overview-queries.ts — activation",
  },
  {
    term: "retained",
    text:
      `Month-2 retention, the pilot's own success criterion. A student is retained if they opened ` +
      `at least one session between day ${RETENTION_START_DAY} and day ${RETENTION_END_DAY} after ` +
      `their FIRST session — measured per student, not on calendar months, so somebody who joined ` +
      `on the 31st still has a second month. Students whose day-${RETENTION_START_DAY} has not ` +
      `arrived are reported separately as not-yet-measurable and are kept out of the denominator: ` +
      `counting them as "not retained" would push the figure down every time somebody new signs up.`,
    computedIn: "lib/overview-rules.ts — monthTwoRetention()",
  },
] as const;

export function definitionOf(term: string): Definition | undefined {
  return DEFINITIONS.find((d) => d.term === term);
}

/**
 * Cite a definition by name from a query or a panel.
 *
 * Throws on an unknown term, deliberately: a figure citing a definition that
 * does not exist is worse than a figure citing none, because the citation is
 * the reason a reader stops asking.
 */
export function cite(term: string): Definition {
  const d = definitionOf(term);
  if (!d) {
    throw new Error(
      `"${term}" is not in the metric dictionary (lib/overview-rules.ts DEFINITIONS). ` +
        `Add the definition before shipping a figure that claims to implement it.`
    );
  }
  return d;
}

/* ======================================================= the heatmap cell */

/**
 * What a heatmap cell can be, and why "never reached" is its own state.
 *
 * research A3: the distinction between an objective the cohort has not got to
 * and one it has got to and is failing "is the view's entire point". They are
 * the same low number and they mean opposite things — one is a pacing fact
 * about the curriculum, the other is a teaching failure — so they are different
 * states here rather than different shades of one.
 */
export type CellState = "never-reached" | "reached";

export type HeatCell = {
  state: CellState;
  /** Students with any evidence on this objective by the end of this week. */
  reached: number;
  /** Of those, how many are at or above the mastery threshold. */
  mastered: number;
  /** null exactly when state is "never-reached" — there is no share of nobody. */
  share: number | null;
};

export function heatCell(reached: number, mastered: number): HeatCell {
  if (reached === 0) {
    return { state: "never-reached", reached: 0, mastered: 0, share: null };
  }
  return { state: "reached", reached, mastered, share: mastered / reached };
}

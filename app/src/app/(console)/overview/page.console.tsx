import Link from "next/link";
import { Fragment } from "react";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { Empty, Figure, Panel, Td, Th } from "@/components/console/ui";
import { consoleAccess } from "@/lib/console-auth";
import { courseName } from "@/lib/console-course-names";
import { consoleRoute } from "@/lib/console-routes";
import { CURRICULA, CURRICULUM_IDS } from "@/lib/curricula";
import { getOverview, type CohortKey, type CohortOption, type Overview } from "@/lib/overview-queries";
import { ANCHOR_DESCRIPTION, cite } from "@/lib/overview-rules";

/**
 * Overviews — the cohort, and the course/year heatmap (contracts/admin.md §8,
 * research A3/R13, ADR-0016 §3, FR-2507, FR-2407; 003 FR-4104, decision 8).
 *
 * **All four roles.** There is no individual content anywhere on this page:
 * every cell is a count, a share, a duration or a curriculum label, and no
 * student's name or id appears. That is why a role that may not open a Student
 * 360 may still read this — and it is a property of the queries
 * (`lib/overview-queries.ts`), not of what this page chooses to print.
 *
 * **Keyed `(course, grade, syllabus_version)`** and bucketed on **school-year
 * weeks**, never calendar weeks. Both are the difference between a number and a
 * number that means something; the definitions page says why, in prose. Keyed
 * by COURSE since 003 (FR-4104): two courses of one subject — Prep-3 maths
 * and Grade 10 American maths — are never summed into one figure, and the
 * picker is a course picker, grouped by curriculum.
 *
 * **The SC-005 funnel is deliberately absent** — see the note at the bottom.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Overviews — Noor Console" };

const PATH = "/overview";

export default async function OverviewConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] !== "" ? (sp[k] as string) : undefined);
  const view = await getOverview(access.operatorId, {
    courseId: one("course"),
    // a pre-003 link: the first course of that subject
    subject: one("subject"),
    grade: one("grade"),
    syllabusVersion: one("syllabus"),
  });
  return <OverviewPage view={view} />;
}

/* --------------------------------------------------------------- format */

const int = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const usd = (v: number) => (v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`);
const day = (iso: string) => iso.slice(0, 10);

/* ----------------------------------------------------------------- page */

function OverviewPage({ view }: { view: Overview }) {
  if (!view.selected) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-5 py-7">
        <h1 className="font-display text-[24px] font-bold text-ink">Overviews</h1>
        <Panel title="No cohort">
          <Empty>
            No course on this environment has students of its curriculum, so there is no{" "}
            <em>(course, grade, syllabus version)</em> to key a cohort on. Load a course and create
            accounts, and this page fills itself.
          </Empty>
        </Panel>
      </main>
    );
  }

  const k = view.selected;

  return (
    <main className="mx-auto w-full max-w-[1200px] px-5 py-7">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        {view.environment} environment · school year {view.schoolYear}–{view.schoolYear + 1} · week{" "}
        {view.currentWeek.week}
      </p>
      <h1 className="mt-1 font-display text-[24px] font-bold text-ink">
        {courseName(k.courseId)} · grade {k.grade} · syllabus {k.syllabusVersion}
      </h1>
      <p className="mt-1 max-w-[85ch] text-[13px] leading-relaxed text-ink-soft">
        A cohort is keyed on all three of those, because the curriculum year, the student&rsquo;s
        school year and the course are different axes and conflating any two produces a number that
        means nothing. Two courses of one subject are never added together. The cohort is the
        grade-{k.grade} students who follow{" "}
        {view.selectedCurriculum
          ? `the ${CURRICULA[view.selectedCurriculum].label} curriculum`
          : "the course's curriculum"}
        {" — "}the students this course&rsquo;s rules reach. Weeks are <strong>school-year weeks</strong>: week 1 begins on{" "}
        {ANCHOR_DESCRIPTION}, {day(view.schoolYearStartsOn)}. Every term used below has a written
        definition —{" "}
        <Link href="/overview/definitions" className="text-ink underline underline-offset-2">
          read the metric dictionary
        </Link>
        , because at this sample size the gap between two defensible definitions of
        &ldquo;active&rdquo; is wider than any effect this pilot could detect.
      </p>

      <CohortSwitch view={view} />

      <Panel title="Activation" note={cite("activated").text}>
        <div className="grid gap-5 sm:grid-cols-3">
          <Figure
            label="Accounts"
            value={int(view.activation.accounts)}
            unit="students"
            period={`school year ${view.schoolYear}–${view.schoolYear + 1}`}
          />
          <Figure
            label="Email confirmed"
            value={int(view.activation.verified)}
            unit="students"
            period="of the accounts above"
          />
          <Figure
            label="Opened a first session"
            value={int(view.activation.firstSession)}
            unit="students"
            period="of the accounts above"
          />
        </div>
        <p className="mt-3 max-w-[80ch] text-[12px] leading-relaxed text-ink-faint">
          Three counts, not one rate: which step people fall out of is the whole question, and a
          single percentage hides it. All three are scoped to the cohort&rsquo;s students — this
          grade, this curriculum — rather than to the course&rsquo;s objectives, because a student
          who has never opened a session has touched no objective yet.
        </p>
      </Panel>

      <Panel
        title="Weekly active"
        note={cite("active").text}
        right={
          <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">
            school-year weeks
          </span>
        }
      >
        {view.weekly.length === 0 ? (
          <Empty>The school year has not started on this environment.</Empty>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink-soft">
                  <Th>Week</Th>
                  <Th>Starting</Th>
                  <Th right>Students active</Th>
                  <Th right>Sessions</Th>
                </tr>
              </thead>
              <tbody>
                {view.weekly.map((w) => (
                  <tr key={w.key} className="border-b border-line-soft last:border-0">
                    <Td mono>{w.key}</Td>
                    <Td mono>{day(w.startsOn)}</Td>
                    <Td right>{int(w.activeStudents)}</Td>
                    <Td right>{int(w.sessions)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Month-2 retention" note={cite("retained").text}>
        <div className="grid gap-5 sm:grid-cols-4">
          <Figure
            label="Retained"
            value={view.retention.rate === null ? "—" : pct(view.retention.rate)}
            unit="of measurable students"
            period={`days 30–59 after each student's first session`}
            hint={
              view.retention.rate === null
                ? "Nobody has reached day 30 yet. A rate over zero students is not 0%, so none is shown."
                : "The pilot's own success criterion is 60%."
            }
          />
          <Figure
            label="Came back"
            value={int(view.retention.retained)}
            unit="students"
            period="in their second month"
          />
          <Figure
            label="Measurable"
            value={int(view.retention.eligible)}
            unit="students"
            period="day 30 has passed"
          />
          <Figure
            label="Too recent to measure"
            value={int(view.retention.tooRecent)}
            unit="students"
            period="joined under 30 days ago"
            hint="Kept out of the denominator on purpose: counting them as 'not retained' would push the figure down every time somebody signs up."
          />
        </div>
      </Panel>

      <Panel
        title="Sessions, attempts and reach"
        note={
          <>
            {cite("session").text} Session length is scoped to the cohort&rsquo;s students only
            — sessions carry no course. Attempts, accuracy and objectives mastered below it ARE
            scoped to <strong>{courseName(k.courseId)}</strong> as well, which the two kinds of
            figure sitting side by side in one panel would otherwise hide.
          </>
        }
      >

        <div className="grid gap-5 sm:grid-cols-3 lg:grid-cols-5">
          <Figure
            label="Session length, median"
            value={view.sessionLength.medianMinutes === null ? "—" : view.sessionLength.medianMinutes.toFixed(1)}
            unit="minutes"
            period={`${int(view.sessionLength.sessions)} sessions this school year`}
          />
          <Figure
            label="Session length, p90"
            value={view.sessionLength.p90Minutes === null ? "—" : view.sessionLength.p90Minutes.toFixed(1)}
            unit="minutes"
            period="this school year"
          />
          <Figure
            label="Attempts"
            value={int(view.attempts.attempts)}
            unit="attempts"
            period="this school year"
          />
          <Figure
            label="Accuracy"
            value={view.attempts.accuracy === null ? "—" : pct(view.attempts.accuracy)}
            unit="of attempts correct"
            period="this school year"
            hint={view.attempts.accuracy === null ? "No attempts yet — not 0%." : undefined}
          />
          <Figure
            // The one figure in this panel that is BOTH grade- and
            // subject-scoped (attempts and accuracy above it are too, but this
            // is the one the brief named): a screenshot of this figure alone
            // must not need the H1 above it to say which subject it counts
            // (BRIEF-OVERVIEW.md deliverable 1).
            label={`Objectives mastered, median — ${courseName(k.courseId)}`}
            // A median over an even number of students is genuinely fractional;
            // rounding it to an integer would quietly invent a student who is
            // at that number. Shown as it is.
            value={
              view.mastery.medianObjectives === null
                ? "—"
                : Number.isInteger(view.mastery.medianObjectives)
                  ? String(view.mastery.medianObjectives)
                  : view.mastery.medianObjectives.toFixed(1)
            }
            unit={`of ${int(view.mastery.objectivesInSubject)} objectives`}
            period={`${int(view.mastery.studentsWithEvidence)} students with evidence`}
            hint={`At or above ${view.masteryThreshold} — the same threshold the student's own dashboard paints as the top band.`}
          />
        </div>
      </Panel>

      <Panel
        title="Cost per active student"
        note={
          <>
            From the daily cost rollup, which holds CLOSED days only — today is never in it. A
            day enters the series once it has ended in UTC and{" "}
            <code className="font-mono text-[12px]">npm run rollup:cost</code> has run for it.
          </>
        }
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <Figure
            label="Per active student"
            value={view.cost.perActiveUsd === null ? "—" : usd(view.cost.perActiveUsd)}
            unit="US dollars, imputed at list price"
            period={`school year to ${view.cost.throughDay ?? "no closed day yet"}`}
            hint="The tutor runs on a Claude subscription: no money left an account per turn."
          />
          <Figure
            label="Total"
            value={usd(view.cost.totalUsd)}
            unit="US dollars, imputed at list price"
            period="this school year, closed days"
          />
          <Figure
            label="Students with any spend"
            value={int(view.cost.activeStudents)}
            unit="students"
            period="this school year"
          />
        </div>
        <CostTileNote view={view} k={k} />
      </Panel>

      <HeatmapPanel view={view} k={k} />

      <SectionPanel view={view} k={k} />

      <Panel title="What is not on this page">
        <p className="max-w-[85ch] text-[13px] leading-relaxed text-ink-soft">
          <strong>The SC-005 funnel is deliberately not displayed.</strong> SC-005 asks what share of
          explanations a student sees turn into a practice attempt —{" "}
          <code className="font-mono text-[12px]">explanation_delivered</code> against{" "}
          <code className="font-mono text-[12px]">retrieval_attempt_submitted</code>. Today the first
          of those fires <em>only</em> when a wrong answer is explained — by a refutation from the
          library, or by the worked solution when none fits — not on the taught explanations that
          make up most of what a student reads. The ratio that
          can be computed from it is therefore not a conversion rate, and drawing it as one would
          make a real number out of an instrumentation gap. It appears here the release after the
          teaching path emits that event, and not before.
        </p>
        <p className="mt-3 max-w-[85ch] text-[13px] leading-relaxed text-ink-soft">
          No figure on this page is pooled across environments, solutions or courses — two courses
          of one subject are two cohorts — and no individual student appears on it at all.
        </p>
      </Panel>
    </main>
  );
}

/* -------------------------------------------------------- the cost tile */

/**
 * The sentence under the cost figures when `view.cost.tileState` is not
 * `"priced"` (BRIEF-OVERVIEW.md deliverable 4).
 *
 * `cost_daily` holds CLOSED days only, so a cohort with real spend TODAY
 * still shows "—" above — a true fact drawn as if the tile were broken. Three
 * different reasons produce that same dash, so this switches on the STATE
 * `costTileState` (`lib/overview-rules.ts`) computed rather than re-deriving
 * it from the raw numbers here, and each branch says a different, actionable
 * thing. The one rule that must never be violated by any branch: today's live
 * figure is printed BESIDE the closed-day figures above, never folded into
 * one of them — mixing a live number into a total labelled "closed days"
 * would be the exact "two sources for one dollar figure" failure the brief
 * warned this file off.
 */
function CostTileNote({ view, k }: { view: Overview; k: CohortKey }) {
  const { cost } = view;
  const cohort = `${courseName(k.courseId)} · grade ${k.grade}`;

  if (cost.tileState === "priced") return null;

  if (cost.tileState === "today-only") {
    return (
      <p className="mt-3 max-w-[80ch] text-[12px] leading-relaxed text-ink-soft">
        <strong className="text-ink">{usd(cost.todayLiveUsd)}</strong> in live spend today (UTC)
        across {int(cost.todayLiveStudents)} student{cost.todayLiveStudents === 1 ? "" : "s"} in{" "}
        {cohort} — not counted in the figures above, because the rollup only stores a day once it
        has closed and today never has. It joins the series once today ends in UTC and the rollup
        runs.
      </p>
    );
  }

  if (cost.tileState === "cohort-quiet") {
    return (
      <p className="mt-3 max-w-[80ch] text-[12px] leading-relaxed text-ink-soft">
        The rollup has closed days on this environment — the dash above is not a stuck pipeline —
        but none of them carry any spend for {cohort}, and nothing was spent on it today either.
        A true zero, not a missing figure.
      </p>
    );
  }

  return (
    <p className="mt-3 max-w-[80ch] text-[12px] leading-relaxed text-ink-soft">
      No spend recorded for {cohort} at all — not today, not on any closed day this school year.
      The figures above will fill once a student in this cohort uses the tutor and a day closes.
    </p>
  );
}

/* ------------------------------------------------------------ the switch */

/**
 * Which cohort you are looking at, as a control rather than a row of links to
 * notice (BRIEF-OVERVIEW.md deliverable 2) — a COURSE picker, grouped by
 * curriculum, since 003 (FR-4104, contracts/console.md "Overview — cohorts per
 * course"). Any view that selects by subject or grade must also let an
 * operator select the course, and here the course is the first choice.
 *
 * **Links, not a `<select>`** — same reasoning `security/page.console.tsx`'s
 * `FilterLink` states for this console: this page is a server component with
 * no client JavaScript of its own, and a cohort that is a URL is a cohort an
 * operator can bookmark or paste into a report. Each course is a caption with
 * one link per (grade, syllabus) that has students, `aria-current` plus the
 * filled-pill styling marking the active one so it does not depend on colour
 * alone.
 */
function CohortSwitch({ view }: { view: Overview }) {
  if (view.options.length <= 1) return null;

  return (
    <nav
      aria-label="Choose a cohort"
      className="mt-4 rounded-lg border border-line bg-card px-3.5 py-2.5"
    >
      <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
        Course — showing{" "}
        {view.selected ? `${courseName(view.selected.courseId)}, grade ${view.selected.grade}` : "none"}
      </p>
      <div className="mt-1.5 space-y-1.5">
        {CURRICULUM_IDS.map((curriculum) => {
          const inCurriculum = view.options.filter((o) => o.curriculum === curriculum);
          if (inCurriculum.length === 0) return null;
          const courses = [...new Set(inCurriculum.map((o) => o.courseId))];
          return (
            <div key={curriculum} className="flex flex-wrap items-center gap-1.5">
              <span className="w-[7.5rem] shrink-0 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">
                {CURRICULA[curriculum].label}
              </span>
              {courses.map((courseId) => {
                const opts = inCurriculum.filter((o) => o.courseId === courseId);
                const courseActive = view.selected?.courseId === courseId;
                return (
                  <div
                    key={courseId}
                    className="flex flex-wrap items-center gap-1 rounded border border-line-soft px-1 py-0.5"
                  >
                    <span className="px-1.5 text-[11.5px] font-medium text-ink-soft">
                      {courseName(courseId)}
                    </span>
                    {opts.map((o) => (
                      <CohortLink
                        key={`${o.grade}|${o.syllabusVersion}`}
                        option={o}
                        active={
                          courseActive &&
                          view.selected?.grade === o.grade &&
                          view.selected?.syllabusVersion === o.syllabusVersion
                        }
                        label={`grade ${o.grade} · ${o.syllabusVersion}`}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function CohortLink({
  option,
  active,
  label,
}: {
  option: CohortOption;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={`/overview?course=${encodeURIComponent(option.courseId)}&grade=${encodeURIComponent(
        option.grade
      )}&syllabus=${encodeURIComponent(option.syllabusVersion)}`}
      aria-current={active ? "true" : undefined}
      className={`ds-control-quiet rounded px-2.5 py-1 text-[12px] font-medium ${
        active ? "bg-ink text-paper" : "text-ink-soft hover:bg-line-soft hover:text-ink"
      }`}
    >
      {label} <span className="text-[10.5px] font-normal opacity-80">({int(option.students)})</span>
    </Link>
  );
}

/* ----------------------------------------------------------- the heatmap */

/**
 * 90 objectives × school-year weeks.
 *
 * **"Never reached" is rendered as its own thing, not as a pale version of
 * "failing"** (research A3 — "that distinction is the view's entire point").
 * They are the same low number and they mean opposite things: one says the
 * cohort has not got there, the other says it got there and stalled. So an
 * unreached cell is an empty outline with no fill and a dash in its title, and
 * a reached cell is a filled swatch whose opacity is the share at or above the
 * threshold. Tokens only, and no rust: a cohort struggling with an objective is
 * fourteen-year-olds learning, not an alarm.
 */
function HeatmapPanel({ view, k }: { view: Overview; k: CohortKey }) {
  const { objectives, weekKeys, cells } = view.heatmap;
  // Both branches name the subject IN THE TITLE, not only in the H1 above the
  // panel — a screenshot of this panel by itself is how this got misread as
  // the whole product's heatmap once already (BRIEF-OVERVIEW.md deliverable 1).
  const title = `Objectives against time — ${courseName(k.courseId)}, grade ${k.grade}`;
  if (objectives.length === 0 || weekKeys.length === 0) {
    return (
      <Panel title={title}>
        <Empty>No objectives in this course yet, or the school year has not started.</Empty>
      </Panel>
    );
  }
  return (
    <Panel
      title={title}
      note={
        <>
          Each cell is the share of students <em>who have reached that objective</em> sitting at or
          above {view.masteryThreshold}, as of the end of that school-year week. Read it for pacing:
          where the cohort is, and where it stalls.
        </>
      }
      right={<Legend />}
    >
      <div className="overflow-x-auto rounded border border-line">
        <table className="border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-ink-soft">
              <Th>Objective</Th>
              {weekKeys.map((w) => (
                <th
                  key={w}
                  scope="col"
                  className="px-1 py-2 font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] text-ink-faint"
                >
                  {w.slice(-3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {objectives.map((o, i) => (
              <tr key={o.loId} className="border-b border-line-soft last:border-0">
                <td className="max-w-[320px] truncate px-3 py-1 text-ink" title={o.label}>
                  <span className="font-mono text-[10px] text-ink-faint">
                    {o.moduleOrdinal ?? "–"}.{o.loOrdinal ?? "–"}{" "}
                  </span>
                  {o.label}
                </td>
                {cells[i]!.map((c, j) => (
                  <td key={weekKeys[j]} className="px-0.5 py-0.5">
                    <Cell cell={c} week={weekKeys[j]!} label={o.label} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/**
 * The cohort's figures per book SECTION and per lesson (003, FR-4319,
 * decision 18). A section split into parts is one row, its figures added up
 * from its parts' rows, with each part beneath it. Every figure is a count
 * over this cohort and this school year, and "reached" / "at the threshold"
 * count (student, objective) pairs — the only form that can be added across
 * parts without counting a child twice. Until the book-section store lands
 * (migration 034), every lesson is its own section — true of every National
 * course.
 */
function SectionPanel({ view, k }: { view: Overview; k: CohortKey }) {
  const title = `By book section and lesson — ${courseName(k.courseId)}, grade ${k.grade}`;
  if (view.bySection.length === 0) {
    return (
      <Panel title={title}>
        <Empty>No lessons in this course yet.</Empty>
      </Panel>
    );
  }
  const row = (label: React.ReactNode, f: Overview["byLesson"][number]["figures"], sub = false) => (
    <>
      <Td>{sub ? <span className="ps-4 font-mono text-[11px] text-ink-soft">{label}</span> : label}</Td>
      <Td right mono>
        {int(f.objectives)}
      </Td>
      <Td right mono>
        {int(f.attempts)}
      </Td>
      <Td right mono>
        {f.attempts === 0 ? "—" : pct(f.correct / f.attempts)}
      </Td>
      <Td right mono>
        {int(f.reached)}
      </Td>
      <Td right mono>
        {f.reached === 0 ? "—" : `${pct(f.mastered / f.reached)} (${int(f.mastered)})`}
      </Td>
    </>
  );
  return (
    <Panel
      title={title}
      note={
        <>
          This school year, this cohort. <strong>Reached</strong> counts (student, objective) pairs
          with a current mastery estimate; <strong>at the threshold</strong> is the share of them at
          or above {view.masteryThreshold}. A section split into parts is counted from its
          parts&rsquo; rows, each part beneath it.
        </>
      }
    >
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-ink-soft">
              <Th>Section · lesson</Th>
              <Th right>Objectives</Th>
              <Th right>Attempts</Th>
              <Th right>Accuracy</Th>
              <Th right>Reached, pairs</Th>
              <Th right>At the threshold</Th>
            </tr>
          </thead>
          <tbody>
            {view.bySection.map((sec) => (
              <Fragment key={sec.key}>
                <tr className="border-b border-line-soft">
                  {row(
                    <>
                      {sec.label}
                      {sec.parts.length > 1 ? (
                        <span className="ms-2 font-mono text-[10.5px] text-ink-faint">
                          {sec.parts.length} parts
                        </span>
                      ) : null}
                    </>,
                    sec.figures
                  )}
                </tr>
                {sec.parts.length > 1 &&
                  sec.parts.map((p) => (
                    <tr key={p.lessonSlug} className="border-b border-line-soft">
                      {row(
                        `${p.lessonSlug}${p.partN != null && p.partOf != null ? ` · part ${p.partN} of ${p.partOf}` : ""}`,
                        p.figures,
                        true
                      )}
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Cell({
  cell,
  week,
  label,
}: {
  cell: { state: string; reached: number; mastered: number; share: number | null };
  week: string;
  label: string;
}) {
  if (cell.state === "never-reached") {
    return (
      <span
        title={`${label} · ${week} · never reached — no student has any evidence on this objective yet`}
        aria-label="never reached"
        className="ds-empty block h-4 w-4 rounded-[2px] border border-dashed border-line"
      />
    );
  }
  const share = cell.share ?? 0;
  return (
    <span
      title={`${label} · ${week} · ${cell.mastered} of ${cell.reached} reached students at or above the threshold`}
      aria-label={`${Math.round(share * 100)} percent`}
      className="block h-4 w-4 rounded-[2px] bg-accent"
      style={{ opacity: 0.18 + 0.82 * share }}
    />
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-soft">
      <span className="flex items-center gap-1.5">
        <span className="ds-empty block h-3.5 w-3.5 rounded-[2px] border border-dashed border-line" />
        never reached
      </span>
      <span className="flex items-center gap-1.5">
        <span className="block h-3.5 w-3.5 rounded-[2px] bg-accent" style={{ opacity: 0.2 }} />
        reached, few at the threshold
      </span>
      <span className="flex items-center gap-1.5">
        <span className="block h-3.5 w-3.5 rounded-[2px] bg-accent" />
        reached, all at the threshold
      </span>
    </div>
  );
}

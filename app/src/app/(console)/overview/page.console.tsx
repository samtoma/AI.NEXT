import Link from "next/link";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { Empty, Figure, Panel, Td, Th } from "@/components/console/ui";
import { consoleAccess } from "@/lib/console-auth";
import { consoleRoute } from "@/lib/console-routes";
import { getOverview, type CohortKey, type CohortOption, type Overview } from "@/lib/overview-queries";
import { ANCHOR_DESCRIPTION, cite } from "@/lib/overview-rules";

/**
 * Overviews — the cohort, and the subject/year heatmap (contracts/admin.md §8,
 * research A3/R13, ADR-0016 §3, FR-2507, FR-2407).
 *
 * **All four roles.** There is no individual content anywhere on this page:
 * every cell is a count, a share, a duration or a curriculum label, and no
 * student's name or id appears. That is why a role that may not open a Student
 * 360 may still read this — and it is a property of the queries
 * (`lib/overview-queries.ts`), not of what this page chooses to print.
 *
 * **Keyed `(subject, grade, syllabus_version)`** and bucketed on **school-year
 * weeks**, never calendar weeks. Both are the difference between a number and a
 * number that means something; the definitions page says why, in prose.
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
            No course on this environment carries a subject, so there is no{" "}
            <em>(subject, grade, syllabus version)</em> to key a cohort on. Load a curriculum and
            this page fills itself.
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
        {k.subject} · grade {k.grade} · syllabus {k.syllabusVersion}
      </h1>
      <p className="mt-1 max-w-[85ch] text-[13px] leading-relaxed text-ink-soft">
        A cohort is keyed on all three of those, because the curriculum year, the grade the book is
        written for and the subject are different axes and conflating any two produces a number that
        means nothing. Weeks are <strong>school-year weeks</strong>: week 1 begins on{" "}
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
          single percentage hides it. The first two steps are scoped to the grade rather than to the
          subject, because a student who has never opened a session has touched no objective and so
          has no subject yet.
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
            {cite("session").text} Session length is scoped to grade {k.grade} only — sessions
            carry no subject. Attempts, accuracy and objectives mastered below it ARE scoped to{" "}
            <strong>{k.subject}</strong> as well, which the two kinds of figure sitting side by
            side in one panel would otherwise hide.
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
            label={`Objectives mastered, median — ${k.subject}`}
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

      <Panel title="What is not on this page">
        <p className="max-w-[85ch] text-[13px] leading-relaxed text-ink-soft">
          <strong>The SC-005 funnel is deliberately not displayed.</strong> SC-005 asks what share of
          explanations a student sees turn into a practice attempt —{" "}
          <code className="font-mono text-[12px]">explanation_delivered</code> against{" "}
          <code className="font-mono text-[12px]">retrieval_attempt_submitted</code>. Today the first
          of those fires <em>only</em> when a wrong answer is refuted from the explanation library,
          not on the taught explanations that make up most of what a student reads. The ratio that
          can be computed from it is therefore not a conversion rate, and drawing it as one would
          make a real number out of an instrumentation gap. It appears here the release after the
          teaching path emits that event, and not before.
        </p>
        <p className="mt-3 max-w-[85ch] text-[13px] leading-relaxed text-ink-soft">
          No figure on this page is pooled across environments or solutions, and no individual
          student appears on it at all.
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
  const cohort = `${k.subject} · grade ${k.grade}`;

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
 * notice (BRIEF-OVERVIEW.md deliverable 2).
 *
 * **Links, not a `<select>`** — same reasoning `security/page.console.tsx`'s
 * `FilterLink` already states for this console: this page is a server
 * component with no client JavaScript of its own, and a cohort that is a URL
 * is a cohort an operator can bookmark or paste into a report, which is this
 * console's established pattern (the brief asked to keep it, and a `<select>`
 * that actually navigated would need an `onChange` handler this page does not
 * have). What changes here is not the mechanism, only whether it READS as a
 * control: grouped by subject — the axis an operator actually thinks in —
 * with grade/syllabus broken out as its own row of links only for a subject
 * that has more than one (none does in this book today, but the schema
 * allows a syllabus revision to land mid-year), a visible label naming the
 * current selection in words, and `aria-current` plus the same filled-pill
 * styling `FilterLink` uses so the active choice does not depend on colour
 * alone.
 */
function CohortSwitch({ view }: { view: Overview }) {
  if (view.options.length <= 1) return null;

  const bySubject = new Map<string, CohortOption[]>();
  for (const o of view.options) {
    const list = bySubject.get(o.subject) ?? [];
    list.push(o);
    bySubject.set(o.subject, list);
  }

  return (
    <nav
      aria-label="Choose a cohort"
      className="mt-4 rounded-lg border border-line bg-card px-3.5 py-2.5"
    >
      <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
        Subject — showing {view.selected?.subject}, grade {view.selected?.grade}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {[...bySubject.entries()].map(([subject, opts]) => {
          const subjectActive = view.selected?.subject === subject;
          if (opts.length === 1) {
            return <CohortLink key={subject} option={opts[0]!} active={subjectActive} label={subject} />;
          }
          // More than one (grade, syllabus) under this subject: the subject
          // name is a caption, not a link, and each combination gets its own
          // control beside it — an outer link here would be ambiguous about
          // which of several courses it opens.
          return (
            <div
              key={subject}
              className="flex flex-wrap items-center gap-1 rounded border border-line-soft px-1 py-0.5"
            >
              <span className="px-1.5 text-[11.5px] font-medium text-ink-soft">{subject}</span>
              {opts.map((o) => (
                <CohortLink
                  key={`${o.grade}|${o.syllabusVersion}`}
                  option={o}
                  active={subjectActive && view.selected?.grade === o.grade && view.selected?.syllabusVersion === o.syllabusVersion}
                  label={`grade ${o.grade} · ${o.syllabusVersion}`}
                />
              ))}
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
      href={`/overview?subject=${encodeURIComponent(option.subject)}&grade=${encodeURIComponent(
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
  const title = `Objectives against time — ${k.subject}, grade ${k.grade}`;
  if (objectives.length === 0 || weekKeys.length === 0) {
    return (
      <Panel title={title}>
        <Empty>No objectives in this subject yet, or the school year has not started.</Empty>
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

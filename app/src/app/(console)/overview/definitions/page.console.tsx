import Link from "next/link";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { Panel } from "@/components/console/ui";
import { consoleAccess } from "@/lib/console-auth";
import { consoleRoute } from "@/lib/console-routes";
import {
  ANCHOR_DESCRIPTION,
  DEFINITIONS,
  MASTERY_THRESHOLD,
  schoolWeekOf,
  schoolYearStart,
} from "@/lib/overview-rules";

/**
 * The metric dictionary (contracts/admin.md §8, research A3, ADR-0016
 * "Two costs worth naming").
 *
 * **This page is the most load-bearing thing in the whole overview set**, and
 * that is the research's claim rather than a flourish: at n=200 the difference
 * between two defensible definitions of "active" exceeds any effect the pilot
 * could detect. A cohort figure whose definition is in somebody's head is a
 * figure that will be re-derived differently in three months and compared to
 * itself.
 *
 * Every string below is read from `lib/overview-rules.ts` — the same module the
 * queries cite by name through `cite()`, which throws on a term that is not
 * here. So this page cannot drift from the numbers it explains: it is not a
 * description of them, it is the thing they are computed against.
 *
 * All four roles, like the overview itself: a definition is not student data.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Metric dictionary — Noor Console" };

const PATH = "/overview/definitions";

export default async function DefinitionsConsolePage() {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }

  const now = new Date();
  const { year, week } = schoolWeekOf(now);
  const start = schoolYearStart(year);

  return (
    <main className="mx-auto w-full max-w-[900px] px-5 py-7">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        <Link href="/overview" className="underline underline-offset-2">
          overviews
        </Link>{" "}
        · metric dictionary
      </p>
      <h1 className="mt-1 font-display text-[24px] font-bold text-ink">
        What each number on the overviews means
      </h1>
      <p className="mt-1 max-w-[80ch] text-[13px] leading-relaxed text-ink-soft">
        Eight terms, one written definition each. Every figure on the cohort overview and the
        heatmap cites one of these by name, and a figure that cited a term missing from this list
        would fail to render rather than print a number nobody agreed on. With around two hundred
        students the gap between two reasonable definitions of &ldquo;active&rdquo; is wider than
        any effect this pilot could detect, which makes this page cheaper and more useful than any
        of the views it explains.
      </p>

      <Panel
        title="The anchor, stated because it is a choice"
        note="Every week number on every overview counts from here."
      >
        <p className="max-w-[80ch] text-[13px] leading-relaxed text-ink">
          School-year week 1 begins on <strong>{ANCHOR_DESCRIPTION}</strong> — for{" "}
          {year}&ndash;{year + 1} that is{" "}
          <strong>{start.toISOString().slice(0, 10)}</strong>, and today falls in{" "}
          <strong>week {week}</strong>.
        </p>
        <p className="mt-2 max-w-[80ch] text-[12.5px] leading-relaxed text-ink-soft">
          The research behind these views says &ldquo;anchored to the Egyptian school-year start
          (late September)&rdquo; without naming a date. This build picked the third Saturday — the
          conventional opening of the ministry year, and a Saturday because the Egyptian week begins
          on one — and prints it here rather than leaving a week number to be read as authoritative
          by somebody who has never seen what it counts from. It is one constant in{" "}
          <code className="font-mono text-[12px]">lib/overview-rules.ts</code>; changing it moves
          every week on every overview at once, which is the point of having one.
        </p>
        <p className="mt-2 max-w-[80ch] text-[12.5px] leading-relaxed text-ink-soft">
          All timestamps are UTC, as everywhere else in this console. Cairo is UTC+2 with no
          daylight saving, so a session after midnight Cairo falls in the previous UTC day; at week
          granularity that moves nothing a pilot verdict rests on, and a second timezone in this
          codebase would.
        </p>
      </Panel>

      {DEFINITIONS.map((d) => (
        <Panel key={d.term} title={d.term} note={`Computed in ${d.computedIn}`}>
          <p className="max-w-[80ch] text-[13px] leading-relaxed text-ink">{d.text}</p>
        </Panel>
      ))}

      <Panel title="Two numbers that are deliberately absent">
        <p className="max-w-[80ch] text-[13px] leading-relaxed text-ink-soft">
          <strong>The SC-005 funnel.</strong> The share of explanations that turn into a practice
          attempt is not shown, because{" "}
          <code className="font-mono text-[12px]">explanation_delivered</code> currently fires only
          when a wrong answer is explained (a refutation, or the worked solution when none fits)
          rather than on the taught explanations that make up most of what a student reads. The computable ratio is not a conversion rate and must not be
          drawn as one.
        </p>
        <p className="mt-3 max-w-[80ch] text-[13px] leading-relaxed text-ink-soft">
          <strong>A blended time-on-task.</strong> Answering time and session wall-clock are
          reported as two numbers on the Student 360 and never averaged into one. The first excludes
          reading and thinking; the second includes a tab left open. A single figure would be
          neither, and would be the one people quoted.
        </p>
        <p className="mt-3 max-w-[80ch] text-[12.5px] leading-relaxed text-ink-faint">
          The mastery threshold used throughout is {MASTERY_THRESHOLD}, which is the floor of the
          top band on the same scale the student&rsquo;s own dashboard paints. A console that
          measured against a different bar would report a cohort falling short of something the
          product never showed them.
        </p>
      </Panel>
    </main>
  );
}

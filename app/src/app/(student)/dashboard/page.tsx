import Link from "next/link";
import { resolveStudentContext } from "@/lib/student-context";
import { getTopicBreakdown, type TopicRow } from "@/lib/dashboard";
import {
  MASTERY_LEGEND,
  masteryColor,
  masteryLabel,
  pct,
} from "@/lib/mastery";
import { DashboardViewed } from "@/components/DashboardViewed";
import { MathText } from "@/components/MathText";
import { rollupText } from "@/lib/section-label";
import {
  BUTTON_PRIMARY,
  STICKER_PANEL,
  STROKE_SM,
  cx,
} from "@/components/sticker";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = { title: "Where you stand — Noor" };

/**
 * /dashboard — per-topic performance (PRD D1, FR-401).
 *
 * Form: horizontal bars, because the reader's job here is comparing magnitude
 * across ~10 topics. Started topics come first, weakest of those at the top;
 * untouched topics follow in curriculum order.
 *
 * That split matters and was got wrong first time: sorting purely by mastery put
 * five never-opened topics at 0% above a genuine 4% weakness with 18 attempts
 * behind it. A topic you have never started is not your weakest topic, and
 * burying the real one defeats the whole point of the page.
 *
 * There is no overall figure anywhere on this page, by requirement. A student
 * strong on three units and lost on a fourth is not "68%" — that number hides
 * the only thing worth acting on. `lib/dashboard.ts` does not even compute one.
 *
 * Colour: the Noor five-step mastery ramp (lib/mastery.ts). It replaced a
 * burnt-sienna scale that the design system forbids outright — there is no red
 * and no coral in this palette, because the persona's stated fear is looking
 * stupid. Every row still states the percentage AND the band name, and the
 * ramp is spelled out in a legend, so colour is never the only signal.
 *
 * Signed out → `/signin`, carrying where it was going. **Unverified is not
 * gated here**: FR-2004 gates learning, and this page starts nothing, spends
 * no AI turn and writes no attempt — it reports what the student has already
 * done. An unconfirmed account simply finds it empty, which is the truth, and
 * the shell's banner is already saying what is outstanding.
 */
export default async function DashboardPage() {
  const me = await resolveStudentContext();
  if (!me) redirect("/signin?next=/dashboard");
  const { studentId, studentName } = me;
  const topics = await getTopicBreakdown(studentId);
  const practised = topics.filter((t) => t.attempts > 0);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <DashboardViewed />

      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="rule-label">Where you stand</p>
          <h1 className="mt-1 font-display text-[1.75rem] font-extrabold leading-[1.2] text-ink">
            {studentName}
          </h1>
          <p className="mt-1 max-w-[62ch] text-[1rem] text-ink-soft">
            The topics you have started come first, the one worth your time at the
            top. Nothing here is a score, and nobody else sees it.
          </p>
        </div>
      </header>

      {practised.length === 0 && (
        <div className={cx(STICKER_PANEL, "p-5")}>
          <p className="text-[1rem] text-ink-soft">
            Nothing practised yet — answer a few questions and this fills in.
          </p>
          {/* ONE dominant action per screen, and never white text on amber. */}
          <Link href="/student" className={cx(BUTTON_PRIMARY, "mt-3")}>
            Start practising
          </Link>
        </div>
      )}

      {practised.length > 0 && (
        <>
          <ol className="space-y-2.5">
            {practised.map((t) => (
              <TopicBar key={t.moduleId} topic={t} />
            ))}
          </ol>

          {topics.some((t) => t.attempts === 0) && (
            <>
              <p className="rule-label mt-7 mb-2.5">Not opened yet</p>
              <ol className="space-y-2.5">
                {topics
                  .filter((t) => t.attempts === 0)
                  .map((t) => (
                    <TopicBar key={t.moduleId} topic={t} />
                  ))}
              </ol>
            </>
          )}

          <MasteryLegend />
        </>
      )}
    </main>
  );
}

/**
 * The ramp, named. Five swatches is the cheapest possible insurance against
 * the bars being read as a traffic light — which is exactly how a five-step
 * scale gets misread when only its extremes are ever seen side by side.
 */
function MasteryLegend() {
  return (
    <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-soft pt-4">
      {MASTERY_LEGEND.map((step) => (
        <span key={step.band} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cx(STROKE_SM, "h-4 w-4 shrink-0 rounded-[var(--play-radius-pill)]")}
            style={{ background: step.color }}
          />
          <span className="text-[0.9rem] text-ink-soft">{step.band}</span>
        </span>
      ))}
    </div>
  );
}

function TopicBar({ topic: t }: { topic: TopicRow }) {
  const untouched = t.attempts === 0;
  // A started topic always keeps a visible stub, so "barely begun" and "not
  // begun" never collapse into the same empty track.
  const width = untouched ? 0 : Math.max(2.5, t.mastery * 100);
  const band = masteryLabel(t.mastery, !untouched);

  return (
    <li className={cx(STICKER_PANEL, "px-4 py-3")}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-[1.05rem] font-bold text-ink">{t.label}</span>
        {/* Value and band travel together: colour is never the only signal. */}
        <span
          className="shrink-0 font-mono text-[0.72rem] font-medium text-ink-faint"
          title={
            untouched
              ? undefined
              : `Averaged across all ${t.loCount} objectives in this topic; one you have not met yet counts as zero.`
          }
        >
          {untouched ? "not started" : `${pct(t.mastery)} · ${band}`}
        </span>
      </div>

      <div
        className={cx(
          STROKE_SM,
          "mt-2 h-[18px] w-full overflow-hidden rounded-[var(--play-radius-pill)] bg-card p-0.5"
        )}
        role="img"
        aria-label={
          untouched
            ? `${t.label}: not started`
            : `${t.label}: ${pct(t.mastery)} mastery, ${band}`
        }
      >
        <div
          className="h-full rounded-[var(--play-radius-pill)] transition-[width]"
          style={{
            width: `${width}%`,
            background: masteryColor(t.mastery, 1, !untouched),
          }}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.72rem] font-medium text-ink-faint">
        <span>
          {t.practisedCount} of {t.loCount} objectives practised
        </span>
        <span>{t.attempts} attempts</span>
        {/* Naming an objective turns a bar into a next step. Two traps here,
            both hit in review:

            "weakest" is only true when there is something to be weakest OF —
            with a single practised objective it is also the strongest, and
            calling an 87% result the student's weakness is simply wrong.

            And the headline figure averages over EVERY objective in the topic,
            un-met ones counting as zero, while this one is the weakest of the
            few she has actually met. At low coverage those two numbers look
            like a contradiction on the same line — "11% · attempted" beside
            "weakest: … (98%)". Saying "of those practised" is what makes the
            pair readable, and is the honest description either way. */}
        {!untouched && t.weakestLoLabel && (
          <span className="text-ink-soft">
            {t.practisedCount > 1 ? "weakest of those practised" : "practising"}:{" "}
            {/* an objective label may carry maths (backlog #37) */}
            <MathText text={t.weakestLoLabel} />
            {t.weakestLoMastery != null && ` (${pct(t.weakestLoMastery)})`}
          </span>
        )}
      </div>

      {/* BOOK SECTIONS (feature 003, FR-4314; backlog #33). A chapter whose
          book section is split into parts says how far through each one she
          is — "1.7 Factorisation · 2 of 3 parts mastered" — the subject
          home's words, from the same roll-up (`TopicRow.sections`). "Mastered"
          is the progression gate, so this line and the pointer agree. Only
          on a topic she has started: an untouched chapter's "0 of 3" says
          nothing its "not started" does not. A module with no split section
          — every National module — renders exactly what it did. */}
      {!untouched && t.sections.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[0.85rem] text-ink-soft">
          {t.sections.map((sec) => (
            <li key={sec.key}>
              <span className="font-semibold text-ink">
                {sec.number && (
                  <>
                    <span dir="ltr">{sec.number}</span>{" "}
                  </>
                )}
                {sec.title ?? (sec.number ? "" : sec.key)}
              </span>
              {" · "}
              {rollupText(sec)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

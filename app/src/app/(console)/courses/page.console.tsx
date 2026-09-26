import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { CourseAvailabilityGrid } from "@/components/console/CourseAvailabilityGrid";
import { Th } from "@/components/console/ui";
import { consoleAccess } from "@/lib/console-auth";
import { lastLiveCourseHeadcount } from "@/lib/console-queries";
import { consoleRoute } from "@/lib/console-routes";
import { courseCatalog } from "@/lib/catalog-queries";
import { GRADES } from "@/lib/catalog";
import {
  CURRICULA,
  CURRICULUM_IDS,
  curriculumGradeLabel,
  type CurriculumId,
} from "@/lib/curricula";
import { offeredCurriculaByGrade } from "@/lib/curriculum-queries";
import { COURSE_GATING } from "@/lib/env";
import { COURSE_IDS, COURSES } from "@/lib/courses";
import { courseCompleteness } from "@/lib/course-completeness-queries";
import { coverageStatus } from "@/lib/coverage-status";

export const dynamic = "force-dynamic";

export const metadata = { title: "Courses — Noor Console" };

/**
 * `/courses` — which courses each grade can see, per CURRICULUM, grade and
 * course (FR-2701…FR-2711, 002; FR-4101…FR-4103, 003; contracts/console.md).
 * Samuel's own words for the page: "show me the product as if all three
 * subjects are fully available, but also I can check what to be live and what
 * not to show to the student via a toggle" (2026-09-21).
 *
 * (This header used to say no requirement covered the page. The course-gate
 * FRs have existed since 2026-09-22, and 003 added the curriculum dimension;
 * the note was stale.)
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ON IT
 * ---------------------------------------------------------------------------
 *   · **One section per curriculum** (FR-4101): each curriculum's courses ×
 *     the six school years, grades in that curriculum's words (FR-4013). The
 *     stored rule is still one row per (course, grade) — a course belongs to
 *     one curriculum, so its rule already is a curriculum decision — and a
 *     rule reaches only students of that course's curriculum (`lib/catalog.ts`).
 *   · **What sign-up offers, per grade** (FR-4102), by the ONE offer rule
 *     (`offeredCurricula`, FR-4004) that sign-up and the first-Google-sign-in
 *     step also use, so an operator sees what a new student of a grade will be
 *     asked before changing a rule.
 *   · **Headcounts, as numbers only** (FR-4103): before a change hides a
 *     curriculum's last live course for a grade, the cell asks, stating how
 *     many students it would leave with nothing to study. Read through the
 *     `last_live_course_headcount` entry of `CROSS_STUDENT_READS`, owned by
 *     `content-review`; the grid is handed counts and nothing else, and
 *     `course-count-guard.test.mts` fails if this view could name a student.
 *   · **The kill switch, in words that are true now** (FR-4015, decision A).
 *
 * Every registry course is listed whether or not a book is loaded for it —
 * the product as it will be sold — with an honest zero beside it
 * (`courseCatalog`, `lib/catalog-queries.ts`).
 *
 * `content-review` guards this page for the same reason it guards `/content`
 * (FR-2204): whoever decides what unreviewed content reaches a child decides
 * whether a whole course reaches one. It never learns a student's name here.
 */
const PATH = "/courses";

/** The kill switch's meaning since 003 (FR-4015; contracts/console.md). The
 *  same sentence `scripts/course-gating.sh status` prints. */
const KILL_SWITCH_SENTENCE =
  "Gating off suspends these rules. Students still see only their own curriculum's courses.";

export default async function CoursesConsolePage() {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }

  const rows = await courseCatalog(access.operatorId);
  // Each course's completeness beside its switch (FR-4309; backlog #16): the
  // counts from the content rows, the book-section checks, and the pipeline's
  // S8 coverage audit on record for its book.
  const depth = await courseCompleteness(access.operatorId);
  const coverage = Object.fromEntries(
    await Promise.all(
      COURSE_IDS.map(async (id) => [id, await coverageStatus(COURSES[id].pipelineBook)] as const)
    )
  );
  const completeness = Object.fromEntries(
    COURSE_IDS.map((id) => [id, { ...depth[id]!, coverage: coverage[id]! }])
  );
  const offered = await offeredCurriculaByGrade(access.operatorId);
  // Counts only; `null` if this operator's roles do not admit the read (the
  // page already requires `content-review`, which owns it) or it failed — the
  // question then says the number could not be counted, and still asks.
  const headcounts = await lastLiveCourseHeadcount(access.operatorId, access.roles).catch(
    (err) => {
      console.error("[console] headcount read failed:", err);
      return null;
    }
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6">
        <p className="rule-label">Course availability</p>
        <h1 className="mt-1 font-display text-[26px] font-bold text-ink">
          What every grade can see, curriculum by curriculum
        </h1>
        <p className="mt-1 max-w-[74ch] text-[14px] text-ink-soft">
          Every course the product knows, grouped under its curriculum, whether or not a book has
          been extracted for it yet — this is the product as it will be sold. A cell with a row
          behind it is a decision somebody made; a cell with none is the default, and the default
          is <strong>hidden</strong>. A course the extraction pipeline loads overnight is not on a
          child&rsquo;s screen until a person here says so.
        </p>
        <p className="mt-2 max-w-[74ch] text-[14px] text-ink-soft">
          A rule reaches only students who follow that course&rsquo;s curriculum. To set a whole
          course for every grade, or every course of one curriculum for a grade, use the{" "}
          <strong>all live</strong>
          {" control beside that row or column. "}It writes one rule per
          (course, grade), exactly as the cells do, never touches another curriculum&rsquo;s
          courses, and asks the same questions first.
        </p>
        <p className="mt-2 max-w-[74ch] text-[13px] font-semibold text-ink">{KILL_SWITCH_SENTENCE}</p>
      </header>

      {/*
        The kill switch (FR-2709 as FR-4015 amends it; decision A). With
        AINEXT_COURSE_GATING off the operators' RULES are suspended — a
        student sees every loaded course of HER OWN curriculum, plus any
        exception — and the page must not let an operator believe a toggle
        changes that. Gold, the console's "look here" tone, never a literal
        colour.
      */}
      {!COURSE_GATING && (
        <div className="mb-6 rounded-lg border border-gold bg-gold-wash px-4 py-3">
          <p className="text-[13.5px] font-semibold leading-relaxed text-ink">
            The gate is switched off.{" "}
            <code className="font-mono text-[12.5px]">AINEXT_COURSE_GATING</code> is not{" "}
            <code className="font-mono text-[12.5px]">on</code> for this stack.
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
            {KILL_SWITCH_SENTENCE} Every loaded course of a student&rsquo;s own curriculum is visible
            to her, whatever the tables below say. The toggles still write real rules — they take
            effect the moment the switch is turned on — but nothing you do here changes what a
            student sees today.
          </p>
        </div>
      )}

      <OfferedLine offered={offered} />

      <CourseAvailabilityGrid
        rows={rows}
        headcounts={headcounts}
        gating={COURSE_GATING}
        completeness={completeness}
      />

      <p className="mt-6 max-w-[74ch] text-[12.5px] leading-relaxed text-ink-faint">
        This is the broad, per-grade rule (<code className="font-mono text-[11.5px]">
          course_availability
        </code>). A single student can be given an exception in either direction — shown a course
        their grade or their curriculum does not have, or held back from one it does — from that
        student&rsquo;s own page. A student&rsquo;s curriculum is changed there too, by an operator
        holding <code className="font-mono text-[11.5px]">student-data</code>.
      </p>

      {/*
        The Plan column: `course_availability.requires_plan` is a SEAM (ADR-0018,
        migration 023), NULL on every row, read by nothing outside this page —
        `plan-gate.test.mts` fails if a student surface or the visibility rule
        ever reads it. Shown so an operator can see it is inert; said so,
        because a column called "Plan" on a page of access rules will otherwise
        be read as an access rule.
      */}
      <p className="mt-2 max-w-[74ch] text-[12.5px] leading-relaxed text-ink-faint">
        <strong>Plan</strong> shows <code className="font-mono text-[11.5px]">requires_plan</code>,
        which is <strong>recorded only and in force nowhere</strong>. Nothing reads it: no student
        is shown or refused a course because of what it says, and there is no payment system behind
        it in this release. It is here so the column is visible before it ever means anything.
      </p>
    </main>
  );
}

/**
 * What sign-up offers, per grade (FR-4102) — by the one offer rule (FR-4004).
 * A grade offering two or more curricula asks which one the school follows;
 * one is stored without asking; none stores National, without asking
 * (FR-4005). A grade is named in every curriculum's words, because the same
 * stored year is "Secondary 1" to one and "Grade 10" to the other (FR-4013).
 */
function OfferedLine({ offered }: { offered: { grade: string; curricula: CurriculumId[] }[] }) {
  return (
    <section aria-labelledby="offered-heading" className="mb-8">
      <h2 id="offered-heading" className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
        What sign-up offers today, per grade
      </h2>
      <p className="mt-1 max-w-[80ch] text-[12.5px] leading-relaxed text-ink-soft">
        A grade offers a curriculum when one of that curriculum&rsquo;s courses is live for it
        {COURSE_GATING ? "" : " — with the gate off, when one of its loaded courses is written for it"}.
        Sign-up asks only when a grade offers two or more, names only those, and pre-selects none.
      </p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-ink-soft">
              <Th>Grade</Th>
              <Th>Offers</Th>
              <Th>A new student of this grade</Th>
            </tr>
          </thead>
          <tbody>
            {GRADES.map((g) => {
              const curricula = offered.find((o) => o.grade === g.value)?.curricula ?? [];
              return (
                <tr key={g.value} className="border-b border-line-soft last:border-0">
                  <td className="px-3 py-2 align-top">
                    <span className="font-semibold text-ink">grade {g.value}</span>
                    <span className="ms-2 text-[12px] text-ink-soft">
                      {CURRICULUM_IDS.map(
                        (c) => `${curriculumGradeLabel(g.value, c)} (${CURRICULA[c].label})`
                      ).join(" · ")}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-ink">
                    {curricula.length === 0
                      ? "nothing live"
                      : curricula.map((c) => CURRICULA[c].label).join(" and ")}
                  </td>
                  <td className="px-3 py-2 align-top text-ink-soft">
                    {curricula.length === 0
                      ? `is not asked, and is stored as ${CURRICULA["eg-national-en"].label} — with nothing to study yet`
                      : curricula.length === 1
                        ? `is not asked, and is stored as ${CURRICULA[curricula[0]].label}`
                        : `is asked which curriculum the school follows: ${curricula
                            .map((c) => CURRICULA[c].label)
                            .join(" or ")}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

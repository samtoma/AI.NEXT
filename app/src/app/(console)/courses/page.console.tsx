import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { CourseAvailabilityGrid } from "@/components/console/CourseAvailabilityGrid";
import { consoleAccess } from "@/lib/console-auth";
import { consoleRoute } from "@/lib/console-routes";
import { courseCatalog } from "@/lib/catalog-queries";
import { COURSE_GATING } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata = { title: "Courses — Noor Console" };

/**
 * `/courses` — Samuel's own words: "show me the product as if all three
 * subjects are fully available, but also I can check what to be live and what
 * not to show to the student via a toggle" (2026-09-21, see
 * CONTRACT-catalog.md / BRIEF-CAT-B in the scratchpad this feature shipped
 * from).
 *
 * ⚠ **NO REQUIREMENT COVERS THIS PAGE.** There is no FR for course
 * availability; none has been invented and `specs/.../traceability.md` was not
 * touched (CLAUDE.md calls inventing one "matrix laundering"). This is
 * unspecified work, standing until a requirement lands — a decision Samuel
 * made directly rather than through the spec process, and the honest thing is
 * to say so here rather than to dress it in an FR number it does not have.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY SUBJECT APPEARS, EVEN THE ONES WITH NOTHING BEHIND THEM
 * ---------------------------------------------------------------------------
 * This grid is built from `lib/subjects.ts`'s `SUBJECTS` registry, not from
 * what `graph_nodes` happens to hold. That is the one property this whole page
 * exists for: Samuel needs to see the product as it will be sold — three
 * subjects — not as it happens to have been extracted so far. Today only
 * Mathematics has a book behind it; Social Studies and Arabic render as real
 * rows with an honest zero, rather than being absent because nobody has
 * loaded them yet. `lib/catalog-queries.ts`'s `courseCatalog` is what makes
 * that honest: it reads the registry for the rows and the spine only for the
 * two depth counts sitting beside them.
 *
 * `content-review` guards this page for the same reason it guards
 * `/content` (FR-2204): whoever can decide what an unreviewed generated
 * question looks like to a child is the same authority that decides whether a
 * whole subject with zero reviewed questions reaches one at all.
 */
const PATH = "/courses";

export default async function CoursesConsolePage() {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }

  const rows = await courseCatalog(access.operatorId);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6">
        <p className="rule-label">Course availability</p>
        <h1 className="mt-1 font-display text-[26px] font-bold text-ink">
          What every grade can see
        </h1>
        <p className="mt-1 max-w-[74ch] text-[14px] text-ink-soft">
          All three subjects, whether or not a book has been extracted for them yet — this is the
          product as it will be sold. A cell with a row behind it is a decision somebody made; a
          cell with none is the default, and the default is <strong>hidden</strong>. No row means
          hidden — a subject the extraction pipeline loads overnight is not on a child&rsquo;s
          screen until a person here says so.
        </p>
      </header>

      {/*
        ADDENDUM (Samuel, 2026-09-21): the console must tell the truth about
        the kill switch. With AINEXT_COURSE_GATING off, every toggle below is
        cosmetic — visibleCoursesFor (lib/catalog-queries.ts) answers "every
        course there is" regardless of what this table records, and a page
        that let an operator believe otherwise would be worse than no page at
        all. The design system's warning tone (gold, never a literal colour)
        is what every other warning banner in this console already uses —
        see the baseline notice on /content and the cross-student-denial
        banner on /security.
      */}
      {!COURSE_GATING && (
        <div className="mb-6 rounded-lg border border-gold bg-gold-wash px-4 py-3">
          <p className="text-[13.5px] font-semibold leading-relaxed text-ink">
            The gate is switched off. <code className="font-mono text-[12.5px]">
              AINEXT_COURSE_GATING
            </code>{" "}
            is not <code className="font-mono text-[12.5px]">on</code> for this stack.
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
            Every course is currently visible to every student, regardless of what the table below
            shows. The toggles below still write real rules — they will take effect the moment the
            switch is turned on — but nothing you do here changes what a student sees today.
          </p>
        </div>
      )}

      <CourseAvailabilityGrid rows={rows} />

      <p className="mt-6 max-w-[74ch] text-[12.5px] leading-relaxed text-ink-faint">
        This is the broad, per-grade rule (<code className="font-mono text-[11.5px]">
          course_availability
        </code>). A single student can be given an exception in either direction — shown a course
        their grade does not have, or held back from one it does — from that student&rsquo;s own
        page.
      </p>
    </main>
  );
}

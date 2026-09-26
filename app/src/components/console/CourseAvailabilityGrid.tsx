"use client";

import { useState } from "react";

import { Chip, Th, stamp } from "@/components/console/ui";
import { GRADES, type CourseState } from "@/lib/catalog";
import type { CourseCatalogRow } from "@/lib/catalog-queries";
import { coursesByCurriculum } from "@/lib/console-course-names";
import type { CurriculumHeadcounts } from "@/lib/console-queries";
import type { CourseCompletenessView } from "@/lib/course-completeness";
import { CompletenessPanel } from "@/components/console/CompletenessPanel";
import { CURRICULA, type CurriculumId } from "@/lib/curricula";

/**
 * The course availability grid — one SECTION PER CURRICULUM (feature 003,
 * FR-4101…FR-4103; contracts/console.md), each a table of that curriculum's
 * courses × the six school years, each cell the toggle itself.
 *
 * Requirements: FR-2701…FR-2711 (002, the course gate) hold unchanged, and
 * FR-4101 adds that availability is decided per curriculum, grade and course.
 * The stored rule is still one row per (course, grade) (migration 023,
 * decision 2): because a course belongs to exactly one curriculum, a rule for
 * it already IS a (curriculum, subject, grade) decision, and it reaches only
 * students of that curriculum (`lib/catalog.ts`, step 2).
 *
 * `"use client"` because a toggle is a write with feedback, not a link — the
 * same reason `SubscriptionEditor` is a client component, and this copies its
 * interaction shape exactly: local `busy`/`error` state per control, a POST to
 * the write endpoint, and a **full page reload** on success rather than a
 * local state patch. A local patch would let this grid disagree with the
 * server about `updated_by`/`updated_at` the moment two operators touch it at
 * once; a reload cannot.
 *
 * ---------------------------------------------------------------------------
 * THREE STATES ON EVERY CELL, NOT TWO
 * ---------------------------------------------------------------------------
 * "Nobody has decided" and "somebody decided no" are the same `state: hidden`
 * and very different facts (`CourseCatalogRow.explicit`). So a cell renders a
 * solid-bordered LIVE chip, a solid-bordered HIDDEN chip with the operator and
 * the time who chose it, or a dashed-bordered NOT SET cell with neither — the
 * dashed border carries the distinction on its own, so it survives a
 * screenshot with the colour desaturated exactly the way `ui.tsx`'s `Chip` is
 * written to.
 *
 * ---------------------------------------------------------------------------
 * THE QUESTIONS, ASKED IN THE PAGE (FR-2710) — NEVER `window.confirm`
 * ---------------------------------------------------------------------------
 * A click that would do something an operator might not mean turns the cell
 * (or, for a bulk action, the section's banner) into its own question, and
 * the answer is a button. It was a native confirm first, and that was a
 * defect: embedded browsers and some policies make `confirm()` return `false`
 * silently, so "Live" did nothing and said nothing. The questions:
 *
 *   · **An empty course.** "Live" on a course with zero objectives or zero
 *     questions names the numbers first (the honesty rule this page was built
 *     on: it never publishes an empty course silently).
 *   · **A grade the book is not written for** (FR-2710, contracts/console.md).
 *     "Live" for a year outside `CourseDef.grades` — the Grade 10 book for
 *     Prep 3 — asks first. It does not block: an operator may mean it.
 *   · **The last live course of a curriculum for a grade** (FR-4103). "Hidden"
 *     that would leave a curriculum with nothing live for a grade states HOW
 *     MANY students follow that curriculum in that grade and would have
 *     nothing to study. **A count only** — `lastLiveCourseHeadcount`, a
 *     `CROSS_STUDENT_READS` entry owned by `content-review`; this view is
 *     handed numbers and nothing else, so it cannot print a name or an id
 *     (privacy review F9; `course-count-guard.test.mts` scans it). When the
 *     count is zero there is nobody to warn about, and the click writes.
 *
 * None of them blocks. The whole design is "full flexibility, never silent".
 *
 * ---------------------------------------------------------------------------
 * BULK ACTIONS, PER SECTION (Samuel, 2026-09-22; 003)
 * ---------------------------------------------------------------------------
 * One action sets a whole course across every grade, or every course OF ONE
 * CURRICULUM for one grade. **A bulk action never crosses curricula**: until
 * 003 "every subject for Secondary 1" wrote a rule for every course in the
 * registry, which would now include the other curriculum's maths. Each
 * section's controls see only that section's cells.
 *
 * A bulk action is a convenience, never a second code path: one POST per
 * (course, grade) to the endpoint a single cell uses, sequential (a failure
 * half-way must leave an operator able to say which cells were written), so
 * the audit trail after "set the whole row live" is indistinguishable from six
 * clicks. The same questions apply, asked once for the whole action, in a
 * banner above that section's table — a grade column is about a hundred pixels
 * wide, and a question nobody can read is a question nobody answered.
 *
 * **The stored default is not changed by any of this and must not be** — a
 * course with no rule stays hidden, because a course nobody has decided about
 * is a course nobody has reviewed. Hidden is offered as well as Live: a bulk
 * action with no bulk undo is a one-way door.
 */
export function CourseAvailabilityGrid({
  rows,
  headcounts,
  gating,
  completeness = {},
}: {
  rows: CourseCatalogRow[];
  /** per (curriculum, grade), how many students a stranding hide leaves with
   *  nothing — counts only; `null` when they could not be counted */
  headcounts: CurriculumHeadcounts | null;
  gating: boolean;
  /** by course id — shown in the course's cell, beside its switches (FR-4309) */
  completeness?: Record<string, CourseCompletenessView>;
}) {
  const bulk = useBulkSet(headcounts);

  return (
    <div className="space-y-8">
      {coursesByCurriculum().map((section) => {
        const sectionRows = rows.filter((r) => r.curriculum === section.curriculum);
        if (sectionRows.length === 0) return null;
        return (
          <CurriculumSection
            key={section.curriculum}
            curriculum={section.curriculum}
            label={section.label}
            description={section.description}
            rows={sectionRows}
            bulk={bulk}
            headcounts={headcounts}
            gating={gating}
            completeness={completeness}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One curriculum's section                                            */
/* ------------------------------------------------------------------ */

function CurriculumSection({
  curriculum,
  label,
  description,
  rows,
  bulk,
  headcounts,
  gating,
  completeness,
}: {
  curriculum: CurriculumId;
  label: string;
  description: string;
  rows: CourseCatalogRow[];
  bulk: Bulk;
  headcounts: CurriculumHeadcounts | null;
  gating: boolean;
  completeness: Record<string, CourseCompletenessView>;
}) {
  // Group the flat (course × grade) list back into one row per course, in the
  // server's registry order — a grouping, not a re-sort.
  const courseOrder: string[] = [];
  const byCourse = new Map<string, CourseCatalogRow[]>();
  for (const row of rows) {
    if (!byCourse.has(row.courseId)) {
      courseOrder.push(row.courseId);
      byCourse.set(row.courseId, []);
    }
    byCourse.get(row.courseId)!.push(row);
  }
  const gradeWords = CURRICULA[curriculum].gradeLabels;

  return (
    <section aria-labelledby={`curriculum-${curriculum}`}>
      <header className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`curriculum-${curriculum}`} className="font-display text-[19px] font-bold text-ink">
          {label}
        </h2>
        <span className="text-[13px] text-ink-soft">{description}</span>
        <span className="font-mono text-[11px] text-ink-faint">{curriculum}</span>
      </header>
      <p className="mb-3 max-w-[80ch] text-[12.5px] leading-relaxed text-ink-soft">
        A rule here reaches only students who follow the {label} curriculum, or who hold an
        exception for the course. Grades are named the way this curriculum names them.
      </p>

      {bulk.section === curriculum && <BulkBanner bulk={bulk} />}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[1000px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line bg-paper-deep">
              <Th>Course</Th>
              {GRADES.map((g) => (
                <Th key={g.value}>
                  <span className="block">{gradeWords[g.value as keyof typeof gradeWords]}</span>
                  <span className="block text-[9.5px] normal-case tracking-normal text-ink-faint">
                    grade {g.value}
                  </span>
                  <BulkButtons
                    bulk={bulk}
                    section={curriculum}
                    what={`every ${label} course for ${gradeWords[g.value as keyof typeof gradeWords]}`}
                    cells={rows.filter((r) => r.grade === g.value)}
                    sectionRows={rows}
                  />
                </Th>
              ))}
              <Th>Plan</Th>
            </tr>
          </thead>
          <tbody>
            {courseOrder.map((courseId) => {
              const cells = byCourse.get(courseId)!;
              const head = cells[0];
              return (
                <tr key={courseId} className="border-b border-line-soft align-top last:border-0">
                  <td className="min-w-[220px] px-3 py-3">
                    <p className="text-[14px] font-semibold text-ink">{head.courseLabel}</p>
                    <p dir={head.dir} className="text-[13px] text-ink-soft">
                      {head.labelAr}
                    </p>
                    <p className="mt-1 max-w-[26ch] text-[11.5px] leading-snug text-ink-faint">
                      {head.book}
                    </p>
                    <p className="mt-1 text-[11.5px] leading-snug text-ink-soft">
                      Written for{" "}
                      {head.courseGrades
                        .map((g) => gradeWords[g as keyof typeof gradeWords] ?? `grade ${g}`)
                        .join(", ") || "no grade recorded"}
                    </p>
                    <p className="mt-1.5 font-mono text-[11px] text-ink-faint">
                      {head.objectivesLoaded} objective{head.objectivesLoaded === 1 ? "" : "s"} ·{" "}
                      {head.questionsLoaded} question{head.questionsLoaded === 1 ? "" : "s"} loaded
                    </p>
                    {completeness[courseId] && (
                      <CompletenessPanel depth={completeness[courseId]} />
                    )}
                    <BulkButtons
                      bulk={bulk}
                      section={curriculum}
                      what={`${head.courseLabel} for every grade`}
                      cells={cells}
                      sectionRows={rows}
                    />
                  </td>
                  {GRADES.map((g) => {
                    const cell = cells.find((c) => c.grade === g.value);
                    if (!cell) return <td key={g.value} className="px-2 py-3" />;
                    return (
                      <GridCell
                        key={g.value}
                        row={cell}
                        liveInSection={
                          rows.filter((r) => r.grade === g.value && r.state === "live").length
                        }
                        headcount={headcountFor(headcounts, curriculum, g.value)}
                        gating={gating}
                      />
                    );
                  })}
                  <PlanCell cells={cells} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The count for (curriculum, grade): a number, `0` when nobody follows it, or
 *  `null` when the counts could not be read. */
function headcountFor(
  headcounts: CurriculumHeadcounts | null,
  curriculum: CurriculumId,
  grade: string
): number | null {
  if (headcounts === null) return null;
  return headcounts[curriculum]?.[grade] ?? 0;
}

/* ------------------------------------------------------------------ */
/* The questions                                                       */
/* ------------------------------------------------------------------ */

/** True when publishing this course would show a student an empty course. */
function isEmpty(row: CourseCatalogRow): boolean {
  return row.objectivesLoaded === 0 || row.questionsLoaded === 0;
}

/** True when the book is not written for this cell's grade (FR-2710). */
function isOffGrade(row: CourseCatalogRow): boolean {
  return !row.courseGrades.includes(row.grade);
}

/** A cell that already says exactly this, on purpose, needs no write. */
function needsWrite(row: CourseCatalogRow, next: CourseState): boolean {
  return !(row.explicit && row.state === next);
}

/** The sentence for a stranding hide: a COUNT, never a name (FR-4103). */
function strandSentence(curriculumLabel: string, gradeLabel: string, n: number | null): string {
  const who =
    n === null
      ? "The number of students who follow it in this grade could not be counted just now; any of them"
      : `${n} student${n === 1 ? "" : "s"} follow${n === 1 ? "s" : ""} this curriculum in this grade and`;
  return `This leaves the ${curriculumLabel} curriculum with no live course for ${gradeLabel}. ${who} would have nothing to study.`;
}

/** The sentence for a grade the book is not written for (FR-2710). */
function offGradeSentence(row: CourseCatalogRow): string {
  const words = CURRICULA[row.curriculum].gradeLabels;
  const written = row.courseGrades
    .map((g) => words[g as keyof typeof words] ?? `grade ${g}`)
    .join(", ");
  return `${row.courseLabel} is written for ${written || "no grade"}, not ${row.gradeLabel}.`;
}

/* ------------------------------------------------------------------ */
/* The one write, shared by a single cell and by a bulk action         */
/* ------------------------------------------------------------------ */

/**
 * The POST, in one place. Returns an error string rather than throwing, so
 * both callers can put it next to the control the operator just used — and
 * the bulk caller can stop at the first one with a count of what it managed.
 */
async function writeRule(row: CourseCatalogRow, next: CourseState): Promise<string | null> {
  try {
    const res = await fetch("/api/console/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: row.courseId, grade: row.grade, state: next, note: null }),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return `${res.status} ${body.error ?? "could not save"}`;
  } catch {
    return "the console could not reach the server";
  }
}

/* ------------------------------------------------------------------ */
/* Bulk: the state machine, held once for the whole page               */
/* ------------------------------------------------------------------ */

type Strand = { gradeLabel: string; n: number | null };

type BulkAsk = {
  section: CurriculumId;
  /** what the operator asked for, in words, for the question and the progress */
  what: string;
  state: CourseState;
  /** only the cells that would actually change */
  todo: CourseCatalogRow[];
  /** the ones that would publish a course with nothing in it */
  empties: CourseCatalogRow[];
  /** the ones for a grade the book is not written for */
  offGrade: CourseCatalogRow[];
  /** the grades this would leave with no live course of the curriculum */
  strands: Strand[];
};

type Bulk = ReturnType<typeof useBulkSet>;

/**
 * One bulk action at a time, for the whole page — two in flight would write
 * overlapping cells in an order nobody chose. The page holds one question and
 * one run, every bulk control is disabled while either is open, and the
 * banner renders in the section the action belongs to.
 */
function useBulkSet(headcounts: CurriculumHeadcounts | null) {
  const [ask, setAsk] = useState<BulkAsk | null>(null);
  const [progress, setProgress] = useState<{ what: string; done: number; total: number } | null>(
    null
  );
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<CurriculumId | null>(null);

  const running = progress !== null;

  function request(
    sectionId: CurriculumId,
    what: string,
    cells: CourseCatalogRow[],
    sectionRows: CourseCatalogRow[],
    state: CourseState
  ) {
    if (running) return;
    setSection(sectionId);
    setError(null);
    const todo = cells.filter((c) => needsWrite(c, state));
    if (todo.length === 0) {
      setAsk(null);
      setNote(`${what} is already ${state} — nothing to write.`);
      return;
    }
    setNote(null);
    const empties = state === "live" ? todo.filter(isEmpty) : [];
    const offGrade = state === "live" ? todo.filter(isOffGrade) : [];
    // FR-4103: per grade this action touches, would the curriculum be left
    // with nothing live? Counted against the SECTION's cells — the courses of
    // this one curriculum — never the whole registry.
    const strands: Strand[] = [];
    if (state === "hidden") {
      for (const grade of new Set(todo.map((c) => c.grade))) {
        const liveBefore = sectionRows.filter((r) => r.grade === grade && r.state === "live");
        const liveAfter = liveBefore.filter(
          (r) => !todo.some((t) => t.courseId === r.courseId && t.grade === grade)
        );
        if (liveBefore.length === 0 || liveAfter.length > 0) continue;
        const n = headcountFor(headcounts, sectionId, grade);
        if (n === 0) continue; // nobody follows it in this grade: nobody to warn about
        strands.push({ gradeLabel: liveBefore[0].gradeLabel, n });
      }
    }
    const a: BulkAsk = { section: sectionId, what, state, todo, empties, offGrade, strands };
    if (empties.length > 0 || offGrade.length > 0 || strands.length > 0) {
      setAsk(a);
      return;
    }
    void run(a);
  }

  async function run(a: BulkAsk) {
    setAsk(null);
    setNote(null);
    setError(null);
    setProgress({ what: a.what, done: 0, total: a.todo.length });
    for (let i = 0; i < a.todo.length; i++) {
      const failure = await writeRule(a.todo[i], a.state);
      if (failure) {
        setProgress(null);
        setError(
          `Saved ${i} of ${a.todo.length}. ${a.todo[i].courseLabel} for ${a.todo[i].gradeLabel} failed: ${failure}. ` +
            `Reload to see what was written.`
        );
        return;
      }
      setProgress({ what: a.what, done: i + 1, total: a.todo.length });
    }
    // The server now holds `updated_by`/`updated_at` this component cannot
    // reconstruct.
    window.location.reload();
  }

  return {
    ask,
    progress,
    note,
    error,
    running,
    section,
    request,
    confirm: (a: BulkAsk) => void run(a),
    cancel: () => {
      setAsk(null);
      setError(null);
      setNote(null);
    },
  };
}

/** The Live / Hidden pair that sets a whole row or a whole column of ONE section. */
function BulkButtons({
  bulk,
  section,
  what,
  cells,
  sectionRows,
}: {
  bulk: Bulk;
  section: CurriculumId;
  /** the action in words — "Mathematics — Grade 10 for every grade", "every National course for Prep 3" */
  what: string;
  cells: CourseCatalogRow[];
  sectionRows: CourseCatalogRow[];
}) {
  const disabled = bulk.running || bulk.ask !== null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      {(["live", "hidden"] as const).map((state) => (
        <button
          key={state}
          type="button"
          onClick={() => bulk.request(section, what, cells, sectionRows, state)}
          disabled={disabled}
          // The accessible name says what the button does to what: "Live" on
          // its own is the single cell's word, and these do far more.
          aria-label={`Set ${what} ${state}`}
          title={`Set ${what} ${state}`}
          className="ds-control play-pressable rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] text-ink-soft hover:bg-line-soft disabled:opacity-40"
        >
          all {state}
        </button>
      ))}
    </span>
  );
}

/**
 * The question, the progress and the failure, above the section's table.
 * Renders nothing when no bulk action is in play.
 */
function BulkBanner({ bulk }: { bulk: Bulk }) {
  const { ask, progress, note, error } = bulk;
  if (!ask && !progress && !note && !error) return null;

  return (
    <div className="mb-4 rounded-lg border border-gold bg-gold-wash px-4 py-3">
      {ask && (
        <>
          <p className="text-[13.5px] font-semibold leading-relaxed text-ink">
            Set {ask.what} {ask.state}? It writes {ask.todo.length}{" "}
            {ask.todo.length === 1 ? "rule" : "rules"}.
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {ask.empties.map((c) => (
              <li key={`empty ${c.courseId} ${c.grade}`} className="text-[13px] leading-relaxed text-ink-soft">
                {c.courseLabel} for {c.gradeLabel} — {c.objectivesLoaded} objective
                {c.objectivesLoaded === 1 ? "" : "s"}, {c.questionsLoaded} question
                {c.questionsLoaded === 1 ? "" : "s"}. Students would see an empty course.
              </li>
            ))}
            {ask.offGrade.map((c) => (
              <li key={`off ${c.courseId} ${c.grade}`} className="text-[13px] leading-relaxed text-ink-soft">
                {offGradeSentence(c)}
              </li>
            ))}
            {ask.strands.map((s) => (
              <li key={`strand ${s.gradeLabel}`} className="text-[13px] leading-relaxed text-ink-soft">
                {strandSentence(CURRICULA[ask.section].label, s.gradeLabel, s.n)}
              </li>
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => bulk.confirm(ask)}
              className="ds-control play-pressable rounded border border-line bg-card px-2 py-1 text-[12px] font-semibold text-ink hover:bg-line-soft"
            >
              {ask.state === "live" ? "Set" : "Hide"} all {ask.todo.length} anyway
            </button>
            <button
              type="button"
              onClick={bulk.cancel}
              className="ds-control-quiet rounded border border-dashed border-line-soft px-2 py-1 text-[12px] font-semibold text-ink-soft hover:bg-line-soft"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {progress && (
        <p className="text-[13.5px] font-semibold leading-relaxed text-ink">
          Setting {progress.what}: {progress.done} of {progress.total} written…
        </p>
      )}

      {note && <p className="text-[13.5px] leading-relaxed text-ink">{note}</p>}

      {error && (
        <>
          <p className="text-[13.5px] font-semibold leading-relaxed text-ink">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="ds-control play-pressable mt-2 rounded border border-line bg-card px-2 py-1 text-[12px] font-semibold text-ink hover:bg-line-soft"
          >
            Reload
          </button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The subscription seam, shown and enforced nowhere                   */
/* ------------------------------------------------------------------ */

/**
 * `requires_plan` for one course, across its grades — **read-only, and read by
 * nothing else** (migration 023, ADR-0018, `courseCatalog`). NULL on every row
 * today; no gate consults it. Printed so an operator can see it is empty.
 * Per COURSE rather than per cell, because six empty cells per row would be
 * six times the noise for one fact; a value that does appear is named with
 * the grade it was written for.
 */
function PlanCell({ cells }: { cells: CourseCatalogRow[] }) {
  const recorded = cells.filter((c) => c.requiresPlan != null);
  return (
    <td className="min-w-[150px] px-3 py-3">
      {recorded.length === 0 ? (
        <>
          <Chip tone="neutral">none recorded</Chip>
          <p className="mt-1 max-w-[18ch] text-[11px] leading-snug text-ink-faint">
            Nothing reads this column. No student is refused a course for it.
          </p>
        </>
      ) : (
        <ul className="space-y-0.5">
          {recorded.map((c) => (
            <li key={c.grade} className="font-mono text-[11px] leading-snug text-ink-soft">
              {c.gradeLabel}: {c.requiresPlan}
            </li>
          ))}
        </ul>
      )}
    </td>
  );
}

/* ------------------------------------------------------------------ */
/* One cell                                                            */
/* ------------------------------------------------------------------ */

type CellAsk = { next: CourseState; reasons: string[] };

function GridCell({
  row,
  liveInSection,
  headcount,
  gating,
}: {
  row: CourseCatalogRow;
  /** live courses of THIS curriculum for this cell's grade, this one included */
  liveInSection: number;
  /** students of this curriculum and grade a stranding hide would leave with nothing */
  headcount: number | null;
  gating: boolean;
}) {
  const [busy, setBusy] = useState<CourseState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when a click is waiting for its answer. */
  const [asking, setAsking] = useState<CellAsk | null>(null);

  /**
   * The first half of the click: collect the reasons to ask, and ask in the
   * cell when there are any; otherwise write straight away.
   */
  function request(next: CourseState) {
    if (busy) return;
    if (!needsWrite(row, next)) return;
    const reasons: string[] = [];
    if (next === "live") {
      if (isEmpty(row)) {
        reasons.push(
          `${row.courseLabel} has ${row.objectivesLoaded} objective${row.objectivesLoaded === 1 ? "" : "s"} and ${row.questionsLoaded} question${row.questionsLoaded === 1 ? "" : "s"}. Students would see an empty course.`
        );
      }
      if (isOffGrade(row)) reasons.push(offGradeSentence(row));
    } else if (row.state === "live" && liveInSection === 1 && headcount !== 0) {
      reasons.push(
        strandSentence(CURRICULA[row.curriculum].label, row.gradeLabel, headcount) +
          (gating ? "" : " (Once the gate is switched on.)")
      );
    }
    if (reasons.length > 0) {
      setAsking({ next, reasons });
      setError(null);
      return;
    }
    void setTo(next);
  }

  async function setTo(next: CourseState) {
    if (busy) return;
    // A stale render (two tabs open) should not fire a no-op write.
    if (!needsWrite(row, next)) return;
    setAsking(null);
    setBusy(next);
    setError(null);
    const failure = await writeRule(row, next);
    if (failure) {
      setError(failure);
      setBusy(null);
      return;
    }
    window.location.reload();
  }

  const chipTone = row.state === "live" ? "good" : "neutral";
  const chipLabel = row.state === "live" ? "live" : row.explicit ? "hidden" : "not set";

  return (
    <td className="px-2 py-3">
      <div
        className={`flex flex-col items-start gap-1.5 rounded-md border px-2 py-2 ${
          row.explicit ? "border-line bg-card" : "ds-empty border-dashed border-line-soft"
        }`}
      >
        <Chip tone={chipTone}>{chipLabel}</Chip>
        {row.explicit && row.updatedAt && (
          <span className="font-mono text-[10px] leading-tight text-ink-faint">
            {row.updatedBy ?? "an operator no longer on record"}
            <br />
            {stamp(row.updatedAt)}
          </span>
        )}
        {asking ? (
          <div className="flex max-w-[9.5rem] flex-col items-start gap-1">
            {asking.reasons.map((r) => (
              <p key={r} className="text-[10.5px] leading-snug text-ink">
                {r}
              </p>
            ))}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => void setTo(asking.next)}
                disabled={busy !== null}
                className="ds-control play-pressable rounded border border-line bg-card px-1.5 py-0.5 text-[10.5px] font-semibold text-ink hover:bg-line-soft disabled:opacity-40"
              >
                {busy ? "…" : asking.next === "live" ? "Make it live anyway" : "Hide it anyway"}
              </button>
              <button
                type="button"
                onClick={() => setAsking(null)}
                disabled={busy !== null}
                className="ds-control-quiet rounded border border-dashed border-line-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-soft hover:bg-line-soft disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => request("live")}
              disabled={busy !== null || !needsWrite(row, "live")}
              className="ds-control play-pressable rounded border border-line bg-card px-1.5 py-0.5 text-[10.5px] font-semibold text-ink hover:bg-line-soft disabled:opacity-40"
            >
              {busy === "live" ? "…" : "Live"}
            </button>
            <button
              type="button"
              onClick={() => request("hidden")}
              disabled={busy !== null || !needsWrite(row, "hidden")}
              className="ds-control play-pressable rounded border border-line bg-card px-1.5 py-0.5 text-[10.5px] font-semibold text-ink hover:bg-line-soft disabled:opacity-40"
            >
              {busy === "hidden" ? "…" : "Hidden"}
            </button>
          </div>
        )}
        {error && <p className="max-w-[9rem] text-[10.5px] leading-snug text-ink">{error}</p>}
      </div>
    </td>
  );
}

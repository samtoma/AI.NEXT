"use client";

import { useState } from "react";

import { Chip, Th, stamp } from "@/components/console/ui";
import { GRADES, type CourseState } from "@/lib/catalog";
import type { CourseCatalogRow } from "@/lib/catalog-queries";

/**
 * The grid Samuel asked for: one row per course (`SUBJECTS` registry order),
 * one column per grade (`GRADES` order), each cell the toggle itself.
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
 * and very different facts (`CourseCatalogRow.explicit`), and the brief this
 * page was built from is explicit that the console must show the difference.
 * So a cell renders one of three things: a solid-bordered LIVE chip, a
 * solid-bordered HIDDEN chip with the operator and the timestamp who chose it,
 * or a dashed-bordered NOT SET cell with neither — the dashed border carries
 * the distinction on its own, so it survives a screenshot with the colour
 * desaturated exactly the way `ui.tsx`'s `Chip` is written to.
 *
 * ---------------------------------------------------------------------------
 * THE HONESTY RULE — THE POINT OF THE WHOLE PAGE
 * ---------------------------------------------------------------------------
 * Social Studies and Arabic have zero objectives in this database today.
 * Flipping either of them live for a grade would publish an empty course to a
 * real student with nothing on screen to say so — so a "Live" click on a cell
 * with zero objectives OR zero questions asks first, naming the exact numbers,
 * before anything is written. It does not block the click: Samuel may well
 * want an empty course live for his own testing, and the whole design of this
 * feature is "full flexibility now" — it only refuses to let that happen
 * *silently*.
 *
 * **The question is asked IN THE PAGE, never with `window.confirm`.** It was
 * a native confirm first, and that was a defect: embedded browsers (the one
 * this console is previewed in), some kiosk and corporate policies, and any
 * context that has suppressed dialogs make `confirm()` return `false`
 * immediately and silently. The operator then clicks "Live", nothing happens,
 * nothing is written and nothing is said — which is exactly how it was found.
 * A control whose confirmation step can be disabled by the surrounding browser
 * is a control that does not work, so the confirmation is ordinary in-flow
 * markup: the cell turns into its own question, and the answer is a button.
 *
 * ---------------------------------------------------------------------------
 * SETTING A WHOLE ROW OR A WHOLE COLUMN (Samuel, 2026-09-22)
 * ---------------------------------------------------------------------------
 * Samuel's intent is that every subject his grades have content for is
 * available: *"the default is that they are all subject per grade available"*,
 * with *"let me do myself the configuration"*. **The stored default is not
 * changed by any of this and must not be** — a course with no rule stays
 * hidden, because a course nobody has decided about is a course nobody has
 * reviewed, and eighteen cells is exactly the number at which somebody stops
 * clicking and asks for the default to be flipped instead. So the answer is to
 * make his intent cheap rather than implicit: one action sets a whole subject
 * across every grade, or a whole grade across every subject.
 *
 * **A bulk action is a convenience, never a second code path.** It sends one
 * POST per (course, grade) to the same endpoint a single cell uses, so every
 * rule is still written by `setGradeRule` with its own `updated_by` and
 * `updated_at`, and the audit trail after "set the whole row live" is
 * indistinguishable from six clicks. There is no bulk endpoint, no multi-row
 * INSERT, and nothing here that could ever write a rule the single-cell path
 * could not.
 *
 * The writes are **sequential**, not `Promise.all`: each one opens an operator
 * transaction, and a failure half-way through must leave an operator able to
 * say which cells were written. "Saved 4 of 6, the fifth failed" is a sentence
 * this can produce; with six parallel requests it is not.
 *
 * The same empty-course question applies, asked once for the whole action and
 * naming every empty course it would publish. It is asked ABOVE the table
 * rather than inside a header cell, because a grade column is about a hundred
 * pixels wide and a question nobody can read is a question nobody answered.
 *
 * **Hidden is offered as well as Live**, though only Live was asked for: a bulk
 * action with no bulk undo is a one-way door, and the whole feature was built
 * on the promise that it is reversible three ways (ADR-0018).
 */
export function CourseAvailabilityGrid({ rows }: { rows: CourseCatalogRow[] }) {
  // Group the flat (course × grade) list back into one row per course. Order
  // is preserved from the server's own SUBJECT_IDS loop (lib/catalog-queries.ts
  // `courseCatalog`), so this is a grouping, not a re-sort.
  const courseOrder: string[] = [];
  const byCourse = new Map<string, CourseCatalogRow[]>();
  for (const row of rows) {
    if (!byCourse.has(row.courseId)) {
      courseOrder.push(row.courseId);
      byCourse.set(row.courseId, []);
    }
    byCourse.get(row.courseId)!.push(row);
  }

  const bulk = useBulkSet();

  return (
    <div>
      <BulkBanner bulk={bulk} />

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[1000px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line bg-paper-deep">
              <Th>Course</Th>
              {GRADES.map((g) => (
                <Th key={g.value}>
                  <span className="block">{g.label}</span>
                  <BulkButtons
                    bulk={bulk}
                    what={`every subject for ${g.label}`}
                    cells={rows.filter((r) => r.grade === g.value)}
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
                    <p className="text-[14px] font-semibold text-ink">{head.label}</p>
                    <p dir={head.dir} className="text-[13px] text-ink-soft">
                      {head.labelAr}
                    </p>
                    <p className="mt-1 max-w-[26ch] text-[11.5px] leading-snug text-ink-faint">
                      {head.book}
                    </p>
                    <p className="mt-1.5 font-mono text-[11px] text-ink-faint">
                      {head.objectivesLoaded} objective{head.objectivesLoaded === 1 ? "" : "s"} ·{" "}
                      {head.questionsLoaded} question{head.questionsLoaded === 1 ? "" : "s"} loaded
                    </p>
                    <BulkButtons
                      bulk={bulk}
                      what={`${head.label} for every grade`}
                      cells={cells}
                    />
                  </td>
                  {GRADES.map((g) => {
                    const cell = cells.find((c) => c.grade === g.value);
                    if (!cell) return <td key={g.value} className="px-2 py-3" />;
                    return <GridCell key={g.value} row={cell} />;
                  })}
                  <PlanCell cells={cells} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The one write, shared by a single cell and by a bulk action         */
/* ------------------------------------------------------------------ */

/** True when publishing this course would show a student an empty course. */
function isEmpty(row: CourseCatalogRow): boolean {
  return row.objectivesLoaded === 0 || row.questionsLoaded === 0;
}

/** A cell that already says exactly this, on purpose, needs no write. */
function needsWrite(row: CourseCatalogRow, next: CourseState): boolean {
  return !(row.explicit && row.state === next);
}

/**
 * The POST, in one place.
 *
 * Returns an error string rather than throwing, because both callers need to
 * put it on the screen next to the control the operator just used — and the
 * bulk caller needs to stop at the first one with a count of what it managed.
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
/* Bulk: the state machine, held once for the whole grid               */
/* ------------------------------------------------------------------ */

type BulkAsk = {
  /** what the operator asked for, in words, for the question and the progress */
  what: string;
  state: CourseState;
  /** only the cells that would actually change */
  todo: CourseCatalogRow[];
  /** the ones that would publish a course with nothing in it */
  empties: CourseCatalogRow[];
};

type Bulk = ReturnType<typeof useBulkSet>;

/**
 * One bulk action at a time, for the whole grid.
 *
 * Deliberately not per-control state: two bulk actions in flight would write
 * overlapping cells in an order nobody chose, and the second one's "saved 6 of
 * 6" would be describing rules the first one had already changed. The grid can
 * hold one question and one run, and every bulk control is disabled while
 * either is open.
 */
function useBulkSet() {
  const [ask, setAsk] = useState<BulkAsk | null>(null);
  const [progress, setProgress] = useState<{ what: string; done: number; total: number } | null>(
    null
  );
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = progress !== null;

  function request(what: string, cells: CourseCatalogRow[], state: CourseState) {
    if (running) return;
    setError(null);
    const todo = cells.filter((c) => needsWrite(c, state));
    if (todo.length === 0) {
      setAsk(null);
      setNote(`${what} is already ${state} — nothing to write.`);
      return;
    }
    setNote(null);
    // The single cell's rule, applied to a set: only a move to `live` on a
    // course with nothing behind it needs an answer first.
    const empties = state === "live" ? todo.filter(isEmpty) : [];
    if (empties.length > 0) {
      setAsk({ what, state, todo, empties });
      return;
    }
    void run({ what, state, todo, empties });
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
          `Saved ${i} of ${a.todo.length}. ${a.todo[i].label} for ${a.todo[i].gradeLabel} failed: ${failure}. ` +
            `Reload to see what was written.`
        );
        return;
      }
      setProgress({ what: a.what, done: i + 1, total: a.todo.length });
    }
    // Same reason a single cell reloads: the server now holds `updated_by` and
    // `updated_at` values this component cannot reconstruct.
    window.location.reload();
  }

  return {
    ask,
    progress,
    note,
    error,
    running,
    request,
    confirm: (a: BulkAsk) => void run(a),
    cancel: () => {
      setAsk(null);
      setError(null);
      setNote(null);
    },
  };
}

/** The Live / Hidden pair that sets a whole row or a whole column. */
function BulkButtons({
  bulk,
  what,
  cells,
}: {
  bulk: Bulk;
  /** the action in words — "Mathematics for every grade", "every subject for Prep 3" */
  what: string;
  cells: CourseCatalogRow[];
}) {
  const disabled = bulk.running || bulk.ask !== null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      {(["live", "hidden"] as const).map((state) => (
        <button
          key={state}
          type="button"
          onClick={() => bulk.request(what, cells, state)}
          disabled={disabled}
          // The accessible name says what the button does to what, because
          // "Live" on its own is the same word the single cell uses and these
          // two controls do very different amounts.
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
 * The question, the progress and the failure, above the table where there is
 * room to read them. Renders nothing at all when no bulk action is in play.
 */
function BulkBanner({ bulk }: { bulk: Bulk }) {
  const { ask, progress, note, error } = bulk;
  if (!ask && !progress && !note && !error) return null;

  return (
    <div className="mb-4 rounded-lg border border-gold bg-gold-wash px-4 py-3">
      {ask && (
        <>
          <p className="text-[13.5px] font-semibold leading-relaxed text-ink">
            Set {ask.what} live? {ask.empties.length} of the {ask.todo.length}{" "}
            {ask.todo.length === 1 ? "rule" : "rules"} this writes would publish a course with
            nothing in it.
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {ask.empties.map((c) => (
              <li key={`${c.courseId} ${c.grade}`} className="text-[13px] leading-relaxed text-ink-soft">
                {c.label} for {c.gradeLabel} — {c.objectivesLoaded} objective
                {c.objectivesLoaded === 1 ? "" : "s"}, {c.questionsLoaded} question
                {c.questionsLoaded === 1 ? "" : "s"}. Students would see an empty course.
              </li>
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => bulk.confirm(ask)}
              className="ds-control play-pressable rounded border border-line bg-card px-2 py-1 text-[12px] font-semibold text-ink hover:bg-line-soft"
            >
              Publish all {ask.todo.length}, empty ones included
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
 * `requires_plan` for one course, across its grades — **read-only, and it is
 * read by nothing else** (migration 023, ADR-0018, and see `courseCatalog`).
 *
 * It exists so the column does not have to be invented under time pressure the
 * day PRD §10 sets a price. It is NULL on every row today, nothing writes it,
 * and no gate consults it: a student is never refused a course because of what
 * this says. Printing it is how an operator can know that — the alternative
 * was a column nobody could see, which is not the same as a column that does
 * nothing.
 *
 * Rendered per COURSE rather than per cell because it is empty everywhere and
 * six empty cells per row would be six times the noise for the same fact; when
 * a value does appear it is named with the grade it was written for, so the
 * summary cannot hide a difference between grades.
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

function GridCell({ row }: { row: CourseCatalogRow }) {
  const [busy, setBusy] = useState<CourseState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when a "Live" click on an empty course is waiting to be confirmed. */
  const [asking, setAsking] = useState(false);

  const empty = isEmpty(row);

  /**
   * The first half of the click. A "Live" on a course with nothing behind it
   * turns the cell into its own question rather than calling a dialog the
   * browser may have disabled; every other click writes straight away.
   */
  function request(next: CourseState) {
    if (busy) return;
    if (!needsWrite(row, next)) return;
    if (next === "live" && empty && !asking) {
      setAsking(true);
      setError(null);
      return;
    }
    void setTo(next);
  }

  async function setTo(next: CourseState) {
    if (busy) return;
    // Already exactly this, on purpose — the buttons below disable that case,
    // but a stale render (two tabs open) should not fire a no-op write.
    if (!needsWrite(row, next)) return;

    setAsking(false);
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
            <p className="text-[10.5px] leading-snug text-ink">
              {row.label} has {row.objectivesLoaded} objective
              {row.objectivesLoaded === 1 ? "" : "s"} and {row.questionsLoaded} question
              {row.questionsLoaded === 1 ? "" : "s"} for {row.gradeLabel}. Students would
              see an empty course.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => void setTo("live")}
                disabled={busy !== null}
                className="ds-control play-pressable rounded border border-line bg-card px-1.5 py-0.5 text-[10.5px] font-semibold text-ink hover:bg-line-soft disabled:opacity-40"
              >
                {busy === "live" ? "…" : "Publish it empty"}
              </button>
              <button
                type="button"
                onClick={() => setAsking(false)}
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

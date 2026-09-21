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

  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[860px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line bg-paper-deep">
            <Th>Course</Th>
            {GRADES.map((g) => (
              <Th key={g.value}>{g.label}</Th>
            ))}
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
                </td>
                {GRADES.map((g) => {
                  const cell = cells.find((c) => c.grade === g.value);
                  if (!cell) return <td key={g.value} className="px-2 py-3" />;
                  return <GridCell key={g.value} row={cell} />;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GridCell({ row }: { row: CourseCatalogRow }) {
  const [busy, setBusy] = useState<CourseState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when a "Live" click on an empty course is waiting to be confirmed. */
  const [asking, setAsking] = useState(false);

  const isEmpty = row.objectivesLoaded === 0 || row.questionsLoaded === 0;

  /**
   * The first half of the click. A "Live" on a course with nothing behind it
   * turns the cell into its own question rather than calling a dialog the
   * browser may have disabled; every other click writes straight away.
   */
  function request(next: CourseState) {
    if (busy) return;
    if (row.explicit && row.state === next) return;
    if (next === "live" && isEmpty && !asking) {
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
    if (row.explicit && row.state === next) return;

    setAsking(false);
    setBusy(next);
    setError(null);
    try {
      const res = await fetch("/api/console/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId: row.courseId, grade: row.grade, state: next, note: null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(`${res.status} ${body.error ?? "could not save"}`);
        setBusy(null);
        return;
      }
      window.location.reload();
    } catch {
      setError("the console could not reach the server");
      setBusy(null);
    }
  }

  const chipTone = row.state === "live" ? "good" : "neutral";
  const chipLabel = row.state === "live" ? "live" : row.explicit ? "hidden" : "not set";

  return (
    <td className="px-2 py-3">
      <div
        className={`flex flex-col items-start gap-1.5 rounded-md border px-2 py-2 ${
          row.explicit ? "border-line bg-card" : "border-dashed border-line-soft"
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
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => void setTo("live")}
                disabled={busy !== null}
                className="rounded border border-line bg-card px-1.5 py-0.5 text-[10.5px] font-semibold text-ink hover:bg-line-soft disabled:opacity-40"
              >
                {busy === "live" ? "…" : "Publish it empty"}
              </button>
              <button
                type="button"
                onClick={() => setAsking(false)}
                disabled={busy !== null}
                className="rounded border border-dashed border-line-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-soft hover:bg-line-soft disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-0.5 flex gap-1">
            <button
              type="button"
              onClick={() => request("live")}
              disabled={busy !== null || (row.explicit && row.state === "live")}
              className="rounded border border-line bg-card px-1.5 py-0.5 text-[10.5px] font-semibold text-ink hover:bg-line-soft disabled:opacity-40"
            >
              {busy === "live" ? "…" : "Live"}
            </button>
            <button
              type="button"
              onClick={() => request("hidden")}
              disabled={busy !== null || (row.explicit && row.state === "hidden")}
              className="rounded border border-line bg-card px-1.5 py-0.5 text-[10.5px] font-semibold text-ink hover:bg-line-soft disabled:opacity-40"
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

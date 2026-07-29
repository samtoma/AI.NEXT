"use client";

/**
 * case_table — the إملاء / إعراب grid (VIZ_SPEC v3 §1.3).
 *
 * Two shapes the book uses to compress a rule into cases:
 *   mode "conditions" — condition → examples (printed 12: six conditions for
 *                       الهمزة على واو; printed 18: five for على السطر)
 *   mode "matrix"     — sign × noun-type (printed 11 and 17)
 *
 * **Mobile reflow is mandatory, not a nicety.** At 360px × 200% zoom a
 * six-column grid of vowelled Arabic is unreadable; this is the WCAG-reflow
 * line for the vertical. Both layouts are rendered and swapped by a CONTAINER
 * query — the figure sits in a board panel whose width is unrelated to the
 * viewport's.
 *
 * spec (A): {mode:"conditions", title?, columns:[{condition, examples[], step?}]}
 * spec (B): {mode:"matrix", title?, rowAxis:{label,items[]}, colAxis:{label,items[]},
 *            cells:[{row, col, example, step?}]}
 */

import {
  VizError,
  arr,
  makeAnim,
  num,
  obj,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";
import { ArHeader } from "./arabic-ui";

interface Condition {
  condition: string;
  examples: string[];
  step: number;
}
interface Cell {
  row: string;
  col: string;
  example: string;
  step: number;
}

export function CaseTable({ spec, animOn }: VizProps) {
  const mode = str(spec.mode, arr(spec.cells).length > 0 ? "matrix" : "conditions");
  const title = str(spec.title);

  if (mode === "matrix") return <Matrix spec={spec} animOn={animOn} title={title} />;
  return <Conditions spec={spec} animOn={animOn} title={title} />;
}

/* ---------------- mode A — conditions ---------------- */

function Conditions({ spec, animOn, title }: VizProps & { title: string }) {
  const columns: Condition[] = arr(spec.columns ?? spec.rows ?? spec.cases)
    .map((raw, i) => {
      const c = obj(raw);
      return {
        condition: str(c.condition ?? c.label ?? c.condition_ar),
        examples: arr(c.examples ?? c.examples_ar)
          .map((e) => str(e))
          .filter(Boolean),
        step: Math.max(1, num(c.step, i + 1)),
      };
    })
    .filter((c) => c.condition);
  if (columns.length === 0) throw new VizError("case_table: no conditions");

  const steps = [...new Set(columns.map((c) => c.step))].sort((a, b) => a - b);
  const stepTimes = steps.map((_, i) => 0.25 + i * 0.5);
  const delayOf = (s: number) => stepTimes[Math.max(0, steps.indexOf(s))] ?? 0.25;
  const on = animOn && spec.animate !== "none";
  const tl = useVizTimeline((stepTimes[stepTimes.length - 1] ?? 0.25) + 0.9, on, stepTimes);
  const a = makeAnim(on, tl.ctrl);

  return (
    <div dir="rtl" lang="ar" key={tl.key} className="@container py-1">
      {title && <ArHeader label={title} />}

      {/* wide: one column per condition, header band on top */}
      <div className="flex gap-1 @max-[420px]:hidden">
        {columns.map((c, i) => (
          <div key={i} className="min-w-0 flex-1" style={a.pop(delayOf(c.step))}>
            <div className="ar-block ar-plain rounded-t-md border border-accent-deep/25 bg-accent-wash px-1.5 py-1 text-center text-[10.5px] font-semibold text-accent-deep">
              <bdi>{c.condition}</bdi>
            </div>
            <div className="flex flex-col gap-0.5 rounded-b-md border border-t-0 border-line-soft bg-card px-1 py-1">
              {c.examples.map((e, j) => (
                <span
                  key={j}
                  className="ar-block ar-plain text-center text-[12px] text-ink"
                >
                  <bdi>{e}</bdi>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* narrow: one stacked block per condition */}
      <div className="hidden flex-col gap-1 @max-[420px]:flex">
        {columns.map((c, i) => (
          <div
            key={i}
            className="rounded-md border border-line-soft bg-card"
            style={a.pop(delayOf(c.step))}
          >
            <div className="ar-block ar-plain rounded-t-md bg-accent-wash px-2 py-1 text-[11px] font-semibold text-accent-deep">
              <bdi>{c.condition}</bdi>
            </div>
            <div className="flex flex-wrap gap-1 px-2 py-1.5">
              {c.examples.map((e, j) => (
                <span
                  key={j}
                  className="ar-block ar-plain rounded border border-line-soft px-1.5 py-0.5 text-[12px] text-ink"
                >
                  <bdi>{e}</bdi>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- mode B — matrix ---------------- */

function Matrix({ spec, animOn, title }: VizProps & { title: string }) {
  const rowAxis = obj(spec.rowAxis);
  const colAxis = obj(spec.colAxis);
  const rows = arr(rowAxis.items).map((v) => str(v)).filter(Boolean);
  const cols = arr(colAxis.items).map((v) => str(v)).filter(Boolean);
  const cells: Cell[] = arr(spec.cells)
    .map((raw, i) => {
      const c = obj(raw);
      return {
        row: str(c.row),
        col: str(c.col),
        example: str(c.example),
        step: Math.max(1, num(c.step, i + 1)),
      };
    })
    .filter((c) => c.row && c.col);
  if (rows.length === 0 || cols.length === 0 || cells.length === 0)
    throw new VizError("case_table: matrix needs rowAxis, colAxis and cells");

  const steps = [...new Set(cells.map((c) => c.step))].sort((a, b) => a - b);
  const stepTimes = steps.map((_, i) => 0.25 + i * 0.5);
  const delayOf = (s: number) => stepTimes[Math.max(0, steps.indexOf(s))] ?? 0.25;
  const on = animOn && spec.animate !== "none";
  const tl = useVizTimeline((stepTimes[stepTimes.length - 1] ?? 0.25) + 0.9, on, stepTimes);
  const a = makeAnim(on, tl.ctrl);

  const cellAt = (r: string, c: string) =>
    cells.find((x) => x.row === r && x.col === c);

  return (
    <div dir="rtl" lang="ar" key={tl.key} className="@container py-1">
      {title && <ArHeader label={title} note={str(rowAxis.label)} />}

      {/* wide: the printed matrix. Empty cells are legitimate (the book's
          matrices are sparse) — render blank, never a dash. */}
      <div className="overflow-x-auto @max-[560px]:hidden">
        <table className="w-full border-collapse text-center">
          <thead>
            <tr>
              <th className="ar-block ar-plain border border-line-soft bg-accent-wash px-1 py-1 text-[9.5px] font-semibold text-accent-deep">
                <bdi>{str(rowAxis.label, "علامة الإعراب")}</bdi>
              </th>
              {cols.map((c) => (
                <th
                  key={c}
                  className="ar-block ar-plain border border-line-soft bg-accent-wash px-1 py-1 text-[9.5px] font-semibold text-accent-deep"
                >
                  <bdi>{c}</bdi>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <th className="ar-block ar-plain border border-line-soft bg-card-warm px-1 py-1 text-[11px] font-semibold text-ink">
                  <bdi>{r}</bdi>
                </th>
                {cols.map((c) => {
                  const cell = cellAt(r, c);
                  return (
                    <td
                      key={c}
                      className="ar-block ar-plain border border-line-soft bg-card px-1 py-1 text-[11.5px] text-ink"
                    >
                      {cell && (
                        <span style={a.pop(delayOf(cell.step))}>
                          <bdi>{cell.example}</bdi>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* narrow: one block per row — «علامة» heading, then its نوع → مثال pairs */}
      <div className="hidden flex-col gap-1 @max-[560px]:flex">
        {rows.map((r) => {
          const mine = cells.filter((c) => c.row === r);
          if (mine.length === 0) return null;
          return (
            <div key={r} className="rounded-md border border-line-soft bg-card">
              <div className="ar-block ar-plain rounded-t-md bg-accent-wash px-2 py-1 text-[11px] font-semibold text-accent-deep">
                <bdi>{r}</bdi>
              </div>
              <div className="flex flex-col gap-0.5 px-2 py-1.5">
                {mine.map((c, i) => (
                  <div
                    key={i}
                    className="flex items-baseline justify-between gap-2"
                    style={a.pop(delayOf(c.step))}
                  >
                    <span className="ar-block ar-plain text-[10.5px] text-ink-faint">
                      <bdi>{c.col}</bdi>
                    </span>
                    <span className="ar-block ar-plain text-[12px] text-ink">
                      <bdi>{c.example}</bdi>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

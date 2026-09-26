"use client";

/**
 * {{widget:box_plot_builder:{"prompt":"Build the box plot for this data set","data":[2,4,4,5,6,7,9,12,15]}}}
 *
 * Grade 10 (feature 003) chapter 10: the five-number summary, dragged onto a
 * number line rather than computed on paper. The raw data sits underneath as
 * small reference ticks — the student is placing markers against real values,
 * not guessing blind — while the five draggable markers (min, Q1, median, Q3,
 * max) build the box plot itself, kept in order by construction (a marker
 * cannot be dragged past its neighbour).
 *
 * GRADED BY THIS BOOK'S OWN QUARTILE CONVENTION (`box-plot-grade.ts`, checked
 * against Siyavula §10.4): linear interpolation between ranks, not the
 * split-at-the-median method. An outlier beyond 1.5×IQR is drawn as a lone
 * point, not a whisker end — dragging the whisker out to it anyway is
 * `whisker-to-outlier`.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { BUTTON_SECONDARY } from "@/components/sticker";
import { Handle, WidgetShell, type Verdict, WIDGET_ACTIONS, WIDGET_WELL } from "./WidgetShell";
import { clamp, tidy, useDragSurface, useKeyNudge } from "./drag";
import { OK, type WidgetOutcome } from "@/lib/widget-predicates";
import { fiveNumberSummary, gradeBoxPlot, type FiveMarks } from "./box-plot-grade";

const W = 320;
const H = 140;
const PAD = 26;
const AXIS = 74;
const SNAP = 0.25;

const KEYS = ["min", "q1", "median", "q3", "max"] as const;
type Key = (typeof KEYS)[number];
const LABEL: Record<Key, string> = { min: "Min", q1: "Q1", median: "Median", q3: "Q3", max: "Max" };

const fmt = (v: number) => tidy(v, 2);
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

export function BoxPlotBuilder({
  prompt, data, studentName, onResult,
}: {
  prompt: string;
  data: number[];
  /** The signed-in student's display name, narrated into the [live event]
   *  line below in place of the retired "Omar" demo persona (FR-2602,
   *  ADR-0010 plan A10). */
  studentName?: string;
  onResult: (o: WidgetOutcome) => void;
}) {
  const who = studentName?.trim() || "the student";
  const truth = useMemo(() => fiveNumberSummary(data), [data]);
  const rawMin = Math.min(...data);
  const rawMax = Math.max(...data);
  const pad = Math.max(1, (rawMax - rawMin) * 0.1);
  const lo = rawMin - pad;
  const hi = rawMax + pad;

  const sx = useCallback((v: number) => PAD + ((v - lo) / (hi - lo)) * (W - PAD * 2), [lo, hi]);
  const ix = useCallback((px: number) => lo + ((px - PAD) / (W - PAD * 2)) * (hi - lo), [lo, hi]);

  const svgRef = useRef<SVGSVGElement>(null);
  // Deliberately not the answer: five roughly-even guesses across the range.
  const [marks, setMarks] = useState<FiveMarks>(() => {
    const at = (t: number) => snap(lo + t * (hi - lo));
    return { min: at(0.1), q1: at(0.3), median: at(0.5), q3: at(0.7), max: at(0.9) };
  });
  const [active, setActive] = useState<Key>("median");
  const held = useRef<Key | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);

  const setMark = useCallback((key: Key, v: number) => {
    setMarks((cur) => {
      const i = KEYS.indexOf(key);
      const lower = i === 0 ? lo : cur[KEYS[i - 1]];
      const upper = i === KEYS.length - 1 ? hi : cur[KEYS[i + 1]];
      return { ...cur, [key]: clamp(snap(v), lower, upper) };
    });
  }, [lo, hi]);

  const { dragging, surface } = useDragSurface({
    svgRef,
    toValue: (q) => ({ x: ix(q.x), y: q.y }),
    onMove: (v) => {
      if (verdict) return;
      let k = held.current;
      if (k === null) {
        let best: Key = "min", bestD = Infinity;
        for (const key of KEYS) {
          const d = Math.abs(marks[key] - v.x);
          if (d < bestD) { bestD = d; best = key; }
        }
        k = best;
        held.current = k;
        setActive(k);
      }
      setMark(k, v.x);
    },
    onCommit: () => { held.current = null; },
  });

  const check = useCallback(() => {
    if (fired.current) return;
    const g = gradeBoxPlot(data, marks);
    fired.current = true;
    setVerdict(g.ok ? "correct" : "wrong");
    setNote(
      g.ok
        ? `min ${truth.min}, Q1 ${truth.q1}, median ${truth.median}, Q3 ${truth.q3}, max ${truth.max} — correct.`
        : `The book's five-number summary is min ${truth.min}, Q1 ${truth.q1}, median ${truth.median}, Q3 ${truth.q3}, max ${truth.max}.`
    );
    const given = KEYS.map((k) => `${LABEL[k]}=${marks[k]}`).join(", ");
    onResult({
      correct: g.ok,
      predicate: g.ok ? OK : g.predicate,
      given,
      detail: g.ok
        ? `✓ ${who} placed the five-number summary correctly on the box plot builder (${given})`
        : `✗ ${who} placed ${given} on the box plot builder — ${g.predicate}`,
    });
  }, [data, marks, truth, onResult, who]);

  const nudge = useKeyNudge({
    step: SNAP,
    disabled: !!verdict,
    onNudge: (dx) => { if (!verdict) setMark(active, marks[active] + dx); },
    onCommit: check,
  });

  const ink = verdict === "correct" ? "var(--accent)" : "var(--gold)";
  const showOutliers = truth.outliers.length > 0;

  return (
    <WidgetShell
      kind="box plot"
      hint="drag the five markers"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        verdict ? null : (
          <span className="inline-flex flex-wrap justify-center gap-x-3 gap-y-1">
            {KEYS.map((k) => (
              <span key={k} className={k === active ? "font-bold text-ink" : "text-ink-faint"}>
                {LABEL[k]}: {marks[k]}
              </span>
            ))}
          </span>
        )
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={`mx-auto block w-full max-w-[340px] ${WIDGET_WELL} ${verdict ? "cursor-default" : "cursor-pointer"}`}
        {...(verdict ? {} : surface)}
      >
        {/* the raw data, as reference ticks — placing markers against real
            values, not guessing blind */}
        {data.map((v, i) => (
          <line key={i} x1={sx(v)} y1={AXIS - 20} x2={sx(v)} y2={AXIS - 14}
                stroke="var(--ink-faint)" strokeWidth="1" opacity="0.6" />
        ))}
        {showOutliers && truth.outliers.map((v) => (
          <circle key={v} cx={sx(v)} cy={AXIS} r="3.5" fill="none" stroke="var(--ink-soft)"
                  strokeWidth="1.4" strokeDasharray="1.5 1.5" />
        ))}

        {/* the axis */}
        <line x1={PAD - 6} y1={AXIS} x2={W - PAD + 6} y2={AXIS} stroke="var(--ink-soft)" strokeWidth="1.4" />

        {/* the box and whiskers, live */}
        <line x1={sx(marks.min)} y1={AXIS} x2={sx(marks.q1)} y2={AXIS} stroke={ink} strokeWidth="1.6" />
        <line x1={sx(marks.q3)} y1={AXIS} x2={sx(marks.max)} y2={AXIS} stroke={ink} strokeWidth="1.6" />
        <rect x={Math.min(sx(marks.q1), sx(marks.q3))} y={AXIS - 16}
              width={Math.abs(sx(marks.q3) - sx(marks.q1))} height="32"
              fill={ink} fillOpacity="0.15" stroke={ink} strokeWidth="1.6" />
        <line x1={sx(marks.median)} y1={AXIS - 16} x2={sx(marks.median)} y2={AXIS + 16} stroke={ink} strokeWidth="2" />
        <line x1={sx(marks.min)} y1={AXIS - 9} x2={sx(marks.min)} y2={AXIS + 9} stroke={ink} strokeWidth="1.6" />
        <line x1={sx(marks.max)} y1={AXIS - 9} x2={sx(marks.max)} y2={AXIS + 9} stroke={ink} strokeWidth="1.6" />

        {KEYS.map((k) => (
          <Handle
            key={k}
            cx={sx(marks[k])} cy={AXIS} r={5} color={ink}
            label={LABEL[k]} live={`${marks[k]}`}
            dragging={dragging && active === k} locked={!!verdict}
            onKeyDown={(e) => { setActive(k); nudge(e); }}
          />
        ))}
        {KEYS.map((k) => (
          <text key={`t${k}`} x={sx(marks[k])} y={AXIS + 26} fontSize="8" textAnchor="middle"
                fill="var(--ink-faint)" style={{ fontFamily: "var(--stack-mono)" }}>
            {LABEL[k]}
          </text>
        ))}
      </svg>

      {!verdict && (
        <div className={WIDGET_ACTIONS}>
          <button type="button" onClick={check} className={BUTTON_SECONDARY}>Check</button>
        </div>
      )}
    </WidgetShell>
  );
}

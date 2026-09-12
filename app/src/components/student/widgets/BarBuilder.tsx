"use client";

/**
 * {{widget:bar_builder:{"prompt":"Build five values with a mean of 6","ask":"mean","target":6,"n":5}}}
 * ask ∈ mean | median | mode | range
 *
 * Drag the bars to build a data set. Sweeping across sets several at once,
 * like a graphic equaliser, so shaping a distribution is one gesture.
 *
 * WHY BUILD THE DATA RATHER THAN READ IT. Every statistics question in the
 * book hands the student a finished list and asks for the mean. That is the
 * easy direction, and it is the direction that lets a student compute a mean
 * for years without any sense of what it measures. Inverting it — here is the
 * mean, now produce data that has it — has many right answers, which is the
 * point: the student discovers that the mean pins down the total and nothing
 * else, and that the median does not care about the total at all.
 *
 * All five statistics stay on screen the whole time, so building for one and
 * watching the others move is free. Standard deviation is labelled POPULATION
 * and shows its divisor, because the n versus n−1 confusion is a catalogued
 * misconception in this syllabus (mc:u3-2-2:divisor-n-minus-one) and a widget
 * that printed a bare "SD" would be feeding it.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { WidgetShell, type Verdict } from "./WidgetShell";
import { clamp, tidy, useDragSurface, type Pt } from "./drag";

const MAXV = 10;
const W = 300;
const H = 210;
const PAD_L = 26;
const PAD_B = 26;
const PAD_T = 12;

export type BarStat = "mean" | "median" | "mode" | "range";

function stats(v: number[]) {
  const n = v.length;
  const sorted = [...v].sort((a, b) => a - b);
  const sum = v.reduce((s, x) => s + x, 0);
  const mean = sum / n;
  const median =
    n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const counts = new Map<number, number>();
  for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const modes = [...counts.entries()].filter(([, c]) => c === top).map(([x]) => x);
  // Population divisor: every value in the set is present, so n is correct
  // here and n−1 would be the sample estimator for data we do not have.
  const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  return {
    sum,
    mean: tidy(mean, 4),
    median: tidy(median, 4),
    // "No mode" is a real answer and must not be silently reported as one.
    mode: top === 1 ? null : modes.length === 1 ? modes[0] : modes,
    range: sorted[n - 1] - sorted[0],
    sd: tidy(Math.sqrt(variance), 3),
  };
}

const fmtMode = (m: number | number[] | null) =>
  m === null ? "none" : Array.isArray(m) ? m.join(", ") : String(m);

/** A statistic in the live readout; the one being asked for is inked. */
function Stat({
  k, ask, children,
}: { k: BarStat | "sd"; ask: BarStat; children: ReactNode }) {
  return <span className={k === ask ? "text-ink" : "text-ink-faint"}>{children}</span>;
}

export function BarBuilder({
  prompt,
  ask,
  target,
  n = 5,
  labels,
  onResult,
}: {
  prompt: string;
  ask: BarStat;
  target: number;
  n?: number;
  labels?: string[];
  onResult: (note: string) => void;
}) {
  const count = clamp(Math.round(n), 3, 8);
  const svgRef = useRef<SVGSVGElement>(null);
  const [vals, setVals] = useState<number[]>(() =>
    // Deliberately uneven and deliberately not on the answer.
    Array.from({ length: count }, (_, i) => [3, 5, 2, 6, 4, 7, 3, 5][i] ?? 4)
  );
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);

  const bw = (W - PAD_L - 14) / count;
  const barX = (i: number) => PAD_L + i * bw + bw * 0.16;
  const barW = bw * 0.68;
  const yOf = (v: number) => PAD_T + (1 - v / MAXV) * (H - PAD_T - PAD_B);

  const s = useMemo(() => stats(vals), [vals]);

  const { surface } = useDragSurface({
    svgRef,
    toValue: (q) => q,
    snap: (q: Pt) => {
      const i = Math.floor((q.x - PAD_L) / bw);
      if (i < 0 || i >= count) return null;
      const v = clamp(
        Math.round(((H - PAD_B - q.y) / (H - PAD_T - PAD_B)) * MAXV),
        0,
        MAXV
      );
      return { x: i, y: v };
    },
    onMove: (q) => {
      if (verdict) return;
      setVals((cur) => {
        if (cur[q.x] === q.y) return cur;
        const next = [...cur];
        next[q.x] = q.y;
        return next;
      });
    },
  });

  const reading = ask === "mode" ? (typeof s.mode === "number" ? s.mode : NaN) : s[ask];

  const check = useCallback(() => {
    if (fired.current) return;
    const ok = Number.isFinite(reading) && Math.abs((reading as number) - target) < 1e-9;
    fired.current = true;
    setVerdict(ok ? "correct" : "wrong");

    let why = "";
    if (!ok) {
      if (ask === "mode" && s.mode === null)
        why = " — no value repeats, so this set has no mode at all";
      else if (ask === "mode" && Array.isArray(s.mode))
        why = ` — two values tie at the top (${s.mode.join(" and ")}), so the set has two modes`;
      else if (ask === "mean" && Math.abs(s.median - target) < 1e-9)
        why = " — that is the MEDIAN, the middle value; the mean is the total shared out equally";
      else if (ask === "median" && Math.abs(s.mean - target) < 1e-9)
        why = " — that is the MEAN; the median is the middle value once they are in order";
      else if (ask === "mean")
        why = ` — for a mean of ${target} across ${count} values the total must be ${target * count}, and yours is ${s.sum}`;
    }

    const set = vals.join(", ");
    setNote(
      ok
        ? `${set} — mean ${s.mean}, median ${s.median}, mode ${fmtMode(s.mode)}, range ${s.range}.`
        : `Your set is ${set}, giving ${ask} ${Number.isFinite(reading) ? reading : fmtMode(s.mode)}; the target is ${target}${why}`
    );
    onResult(
      ok
        ? `✓ Omar built the set [${set}] with ${ask} = ${target} on the bar builder (mean ${s.mean}, median ${s.median}, mode ${fmtMode(s.mode)}, range ${s.range}, population SD ${s.sd})`
        : `✗ Omar built [${set}], whose ${ask} is ${Number.isFinite(reading) ? reading : fmtMode(s.mode)}, not ${target}${why}`
    );
  }, [ask, reading, target, s, vals, count, onResult]);

  const ink = verdict === "correct" ? "var(--accent)" : "var(--gold)";
  return (
    <WidgetShell
      kind="bar builder"
      hint="drag or sweep the bars"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        <span className="inline-flex flex-wrap justify-center gap-x-3 gap-y-1">
          <Stat k="mean" ask={ask}>mean {s.mean}</Stat>
          <Stat k="median" ask={ask}>median {s.median}</Stat>
          <Stat k="mode" ask={ask}>mode {fmtMode(s.mode)}</Stat>
          <Stat k="range" ask={ask}>range {s.range}</Stat>
          <Stat k="sd" ask={ask}>
            SD {s.sd}{" "}
            <span className="text-ink-faint">(population, ÷{vals.length})</span>
          </Stat>
        </span>
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={`mx-auto block w-full max-w-[320px] rounded-md border border-line-soft bg-card-warm ${
          verdict ? "cursor-default" : "cursor-ns-resize"
        }`}
        {...(verdict ? {} : surface)}
      >
        {/* value gridlines, labelled — heights are read, not guessed */}
        {Array.from({ length: 6 }, (_, i) => i * 2).map((v) => (
          <g key={v}>
            <line x1={PAD_L} y1={yOf(v)} x2={W - 8} y2={yOf(v)}
                  stroke="var(--line-soft)" strokeWidth="0.8" />
            <text x={PAD_L - 5} y={yOf(v) + 3} fontSize="7.5" textAnchor="end"
                  fill="var(--ink-faint)" style={{ fontFamily: "var(--stack-mono)" }}>
              {v}
            </text>
          </g>
        ))}

        {/* the mean, as a line across the bars — the statistic asked for is
            the one drawn, so the number and the picture are the same thing */}
        {(ask === "mean" || verdict) && (
          <>
            <line x1={PAD_L} y1={yOf(s.mean)} x2={W - 8} y2={yOf(s.mean)}
                  stroke="var(--accent-deep)" strokeWidth="1.5" strokeDasharray="5 3" />
            <text x={W - 10} y={yOf(s.mean) - 4} fontSize="8" textAnchor="end"
                  fill="var(--accent-deep)" style={{ fontFamily: "var(--stack-mono)" }}>
              mean {s.mean}
            </text>
          </>
        )}
        {ask === "mean" && (
          <line x1={PAD_L} y1={yOf(target)} x2={W - 8} y2={yOf(target)}
                stroke="var(--gold)" strokeWidth="1.5" opacity="0.7" />
        )}

        {vals.map((v, i) => (
          <g key={i}>
            <rect
              x={barX(i)} y={yOf(v)} width={barW}
              height={Math.max(0, yOf(0) - yOf(v))}
              rx="3" fill={ink} fillOpacity="0.75"
            />
            {/* the grab rail: full-height, invisible, so a finger can start
                anywhere in the column rather than on a thin bar top */}
            <rect x={barX(i)} y={PAD_T} width={barW} height={yOf(0) - PAD_T} fill="transparent" />
            <text x={barX(i) + barW / 2} y={yOf(v) - 4} fontSize="8.5" textAnchor="middle"
                  fill="var(--ink)" style={{ fontFamily: "var(--stack-mono)" }}>
              {v}
            </text>
            <text x={barX(i) + barW / 2} y={H - PAD_B + 12} fontSize="8" textAnchor="middle"
                  fill="var(--ink-faint)" style={{ fontFamily: "var(--stack-mono)" }}>
              {labels?.[i] ?? i + 1}
            </text>
          </g>
        ))}
        <line x1={PAD_L} y1={yOf(0)} x2={W - 8} y2={yOf(0)} stroke="var(--ink-soft)" strokeWidth="1.2" />
      </svg>

      {!verdict && (
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
          {/* Keyboard path: the bars are a grid of numbers as much as a
              picture, so they can be typed as well as dragged. */}
          {vals.map((v, i) => (
            <input
              key={i}
              type="number"
              min={0}
              max={MAXV}
              value={v}
              aria-label={`Value ${i + 1}`}
              onChange={(e) => {
                const nv = clamp(Math.round(Number(e.target.value) || 0), 0, MAXV);
                setVals((cur) => cur.map((x, j) => (j === i ? nv : x)));
              }}
              className="h-9 w-11 rounded-md border border-line bg-card text-center font-mono text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45"
            />
          ))}
          <button
            type="button"
            onClick={check}
            className="min-h-[36px] rounded-md border border-accent/45 bg-accent-wash px-3.5 font-display text-[13px] font-medium text-accent-deep transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45"
          >
            Check
          </button>
        </div>
      )}
    </WidgetShell>
  );
}

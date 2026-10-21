"use client";

import { useRef, useState } from "react";
import { OK, type WidgetOutcome } from "@/lib/widget-predicates";
import { BUTTON_SECONDARY, BUTTON_TERTIARY, cx } from "@/components/sticker";
import { DEFAULT_GRID, gridValues, labelValues, snapToGrid, type Grid } from "./grid";
import { numText } from "./format";
import { gradePoint, gradePoints, type P } from "./pair-plotter-grade";
import {
  FIGURE_MARK,
  WIDGET_FRAME,
  WIDGET_HEAD,
  WIDGET_HINT,
  WIDGET_KIND,
  WIDGET_PROMPT,
  WIDGET_RESULT,
  WIDGET_WELL,
} from "./WidgetShell";

/**
 * {{widget:pair_plotter:{"prompt":"Plot the point (3,2)","target":[3,2]}}}
 *
 * Interactive SVG coordinate grid (−5..5). The student taps a lattice point;
 * the widget gives correct/incorrect feedback (with the quadrant name) and
 * reports the outcome back into the chat stream exactly once.
 *
 * {{widget:pair_plotter:{"prompt":"Plot A, B, C and D","targets":[[2,3],[6,2],[-2,-2],[-2,1]],"grid":{"x":[-3,7],"y":[-3,4]}}}}
 *
 * Two additions (Tamer 2026-10-21), both absent by default: `grid` (grid.ts)
 * sets the range and the step, so a point with a half in it or a 6 can be
 * plotted; `targets` asks for SEVERAL points — the student taps each on (and
 * off again), then checks the set (pair-plotter-grade.ts). `join` draws the
 * polygon through the points in x order, for a frequency polygon.
 */

const PLOT = 240;
const PAD = 14;
const SIZE = PLOT + PAD * 2;

/** Where a point sits, in the lesson's language (English, constitution V —
 *  the maths course; the Arabic quadrant names were left over from the
 *  frozen baseline and showed beside the English one). */
function quadrant(x: number, y: number): { en: string } {
  if (x === 0 && y === 0) return { en: "the origin" };
  if (x === 0) return { en: "on the y-axis" };
  if (y === 0) return { en: "on the x-axis" };
  if (x > 0 && y > 0) return { en: "Quadrant I" };
  if (x < 0 && y > 0) return { en: "Quadrant II" };
  if (x < 0 && y < 0) return { en: "Quadrant III" };
  return { en: "Quadrant IV" };
}

export function PairPlotter({
  prompt,
  target,
  targets,
  grid = DEFAULT_GRID,
  join = false,
  studentName,
  pronoun,
  onResult,
}: {
  prompt: string;
  target?: [number, number];
  /** several points, graded as a set (instead of `target`) */
  targets?: [number, number][];
  grid?: Grid;
  join?: boolean;
  /** The signed-in student's display name, narrated into the [live event]
   *  line below in place of the retired "Omar" demo persona (FR-2602,
   *  ADR-0010 plan A10). Falls back to a name-free "the student" — never a
   *  guess — when a caller (dev fixture, admin replay) has none to give. */
  studentName?: string;
  /** Lower-case third-person pronoun for "swapped the coordinates", already
   *  resolved from `lib/address.ts` (FR-2605). Defaults to singular "they" —
   *  never the masculine. */
  pronoun?: string;
  onResult: (outcome: WidgetOutcome) => void;
}) {
  if (targets && targets.length) {
    return (
      <PointsPlotter prompt={prompt} targets={targets} grid={grid} join={join}
        studentName={studentName} onResult={onResult} />
    );
  }
  return (
    <OnePoint prompt={prompt} target={target ?? [0, 0]} grid={grid}
      studentName={studentName} pronoun={pronoun} onResult={onResult} />
  );
}

/** The grid's screen geometry: a PLOT×PLOT square, each axis scaled to its own range. */
function frame(g: Grid) {
  const px = (x: number) => PAD + ((x - g.x[0]) / (g.x[1] - g.x[0])) * PLOT;
  const py = (y: number) => PAD + ((g.y[1] - y) / (g.y[1] - g.y[0])) * PLOT;
  // the axes run through 0 when 0 is on the grid, else along the low edge
  const ax = g.x[0] <= 0 && g.x[1] >= 0 ? 0 : g.x[0];
  const ay = g.y[0] <= 0 && g.y[1] >= 0 ? 0 : g.y[0];
  return { px, py, ax, ay, xs: gridValues(g.x[0], g.x[1], g.sx), ys: gridValues(g.y[0], g.y[1], g.sy) };
}

/** The tapped spot, snapped to the nearest grid point; null outside the grid. */
function tapped(svg: SVGSVGElement, e: React.MouseEvent<SVGSVGElement>, g: Grid): [number, number] | null {
  const rect = svg.getBoundingClientRect();
  const sx = ((e.clientX - rect.left) / rect.width) * SIZE;
  const sy = ((e.clientY - rect.top) / rect.height) * SIZE;
  const x = g.x[0] + ((sx - PAD) / PLOT) * (g.x[1] - g.x[0]);
  const y = g.y[1] - ((sy - PAD) / PLOT) * (g.y[1] - g.y[0]);
  const hs = (g.sx / (g.x[1] - g.x[0])) * PLOT * 0.5;   // half a step, on screen
  if (sx < PAD - hs || sx > PAD + PLOT + hs || sy < PAD - hs || sy > PAD + PLOT + hs) return null;
  return snapToGrid(g, x, y);
}

const pt = (p: P) => `(${numText(p[0])},${numText(p[1])})`;

/** The static layer: grid lines, axes, labels — and the faint grid points while the student is still tapping. */
function GridLayer({ g, dots }: { g: Grid; dots: boolean }) {
  const { px, py, ax, ay, xs, ys } = frame(g);
  return (
    <>
      {xs.map((t) => (
        <line key={`v${t}`} x1={px(t)} y1={py(g.y[0])} x2={px(t)} y2={py(g.y[1])} stroke="var(--line-soft)" strokeWidth="1" />
      ))}
      {ys.map((t) => (
        <line key={`h${t}`} x1={px(g.x[0])} y1={py(t)} x2={px(g.x[1])} y2={py(t)} stroke="var(--line-soft)" strokeWidth="1" />
      ))}
      <line x1={px(g.x[0])} y1={py(ay)} x2={px(g.x[1])} y2={py(ay)} stroke="var(--ink-soft)" strokeWidth="1.4" />
      <line x1={px(ax)} y1={py(g.y[0])} x2={px(ax)} y2={py(g.y[1])} stroke="var(--ink-soft)" strokeWidth="1.4" />
      {labelValues(g.x[0], g.x[1], g.sx).map((t) => (
        <text key={`lx${t}`} x={px(t)} y={py(ay) + 8.5} textAnchor="middle" fontSize="6.5" fill="var(--ink-faint)" fontFamily="var(--stack-mono)">{numText(t)}</text>
      ))}
      {labelValues(g.y[0], g.y[1], g.sy).map((t) => (
        <text key={`ly${t}`} x={px(ax) - 4} y={py(t) + 2} textAnchor="end" fontSize="6.5" fill="var(--ink-faint)" fontFamily="var(--stack-mono)">{numText(t)}</text>
      ))}
      <text x={px(g.x[1]) - 2} y={py(ay) - 4} fontSize="7.5" fill="var(--ink-soft)" textAnchor="end" fontStyle="italic">x</text>
      <text x={px(ax) + 5} y={py(g.y[1]) + 6} fontSize="7.5" fill="var(--ink-soft)" fontStyle="italic">y</text>
      {dots && xs.map((x) => ys.map((y) => (
        <circle key={`${x},${y}`} cx={px(x)} cy={py(y)} r="1.1" fill="var(--ink)" opacity="0.12" />
      )))}
    </>
  );
}

function OnePoint({
  prompt,
  target,
  grid: g,
  studentName,
  pronoun,
  onResult,
}: {
  prompt: string;
  target: [number, number];
  grid: Grid;
  studentName?: string;
  pronoun?: string;
  onResult: (outcome: WidgetOutcome) => void;
}) {
  const who = studentName?.trim() || "the student";
  const they = pronoun?.trim() || "they";
  const [picked, setPicked] = useState<[number, number] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const done = picked !== null;
  const correct =
    done && picked![0] === target[0] && picked![1] === target[1];
  const { px, py, ax, ay } = frame(g);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (done || !svgRef.current) return;
    const at = tapped(svgRef.current, e, g);
    if (!at) return;
    const [x, y] = at;
    setPicked([x, y]);
    const q = quadrant(target[0], target[1]);
    // Right distances, wrong signs is a different error from a plain miss: the
    // student found the point and reflected it (pair-plotter-grade.ts).
    const pred = gradePoint([x, y], target);
    const ok = pred === OK;
    const swapped = pred === "swapped-coordinates";
    onResult({
      correct: ok,
      predicate: pred,
      given: pt([x, y]),
      detail: ok
        ? `✓ ${who} plotted ${pt(target)} correctly on the grid — ${q.en}`
        : `✗ ${who} plotted ${pt([x, y])} instead of ${pt(target)} on the pair plotter${
            swapped ? ` — ${they} swapped the coordinates (order confusion)` : ""
          }`,
    });
  };

  const q = quadrant(target[0], target[1]);

  return (
    <div className={WIDGET_FRAME}>
      <div className={WIDGET_HEAD}>
        <span className={WIDGET_KIND}>✳ interactive · pair plotter</span>
        <span className={WIDGET_HINT}>tap a point on the grid</span>
      </div>

      <div className="px-3.5 py-3">
        <p className={WIDGET_PROMPT}>{prompt}</p>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          onClick={handleClick}
          role="img"
          aria-label={prompt}
          className={cx(
            WIDGET_WELL,
            "mx-auto mt-2.5 block w-full max-w-[280px]",
            done ? "cursor-default" : "cursor-crosshair"
          )}
        >
          <GridLayer g={g} dots={!done} />

          {/* the target, revealed on a wrong pick */}
          {done && !correct && (
            <g>
              <line x1={px(target[0])} y1={py(ay)} x2={px(target[0])} y2={py(target[1])} stroke={FIGURE_MARK.correct} strokeWidth="1" strokeDasharray="3 2.5" opacity="0.55" />
              <line x1={px(ax)} y1={py(target[1])} x2={px(target[0])} y2={py(target[1])} stroke={FIGURE_MARK.correct} strokeWidth="1" strokeDasharray="3 2.5" opacity="0.55" />
              <circle cx={px(target[0])} cy={py(target[1])} r="6" fill="none" stroke={FIGURE_MARK.correct} strokeWidth="1.6" />
              <circle cx={px(target[0])} cy={py(target[1])} r="2.4" fill={FIGURE_MARK.correct} />
            </g>
          )}

          {/* the student's pick */}
          {done && (
            <g className="anim-pop">
              {correct && (
                <>
                  <line x1={px(picked![0])} y1={py(ay)} x2={px(picked![0])} y2={py(picked![1])} stroke={FIGURE_MARK.correct} strokeWidth="1" strokeDasharray="3 2.5" opacity="0.55" />
                  <line x1={px(ax)} y1={py(picked![1])} x2={px(picked![0])} y2={py(picked![1])} stroke={FIGURE_MARK.correct} strokeWidth="1" strokeDasharray="3 2.5" opacity="0.55" />
                </>
              )}
              <circle
                cx={px(picked![0])} cy={py(picked![1])} r="5.5"
                fill={correct ? FIGURE_MARK.correct : FIGURE_MARK.wrong}
                opacity="0.25"
              />
              <circle
                cx={px(picked![0])} cy={py(picked![1])} r="3"
                fill={correct ? FIGURE_MARK.correct : FIGURE_MARK.wrong}
              />
              <text
                x={px(picked![0]) + 7} y={py(picked![1]) - 5}
                fontSize="8" fontWeight="600"
                fill={correct ? "var(--ink)" : FIGURE_MARK.wrongText}
                fontFamily="var(--stack-mono)"
              >
                {pt(picked!)}
              </text>
            </g>
          )}
        </svg>

        {done && (
          <div className={cx("mt-2.5 px-3 py-2", WIDGET_RESULT[correct ? "correct" : "wrong"])}>
            <span className="font-display text-[13.5px] font-bold">
              {correct
                ? `Correct — ${pt(target)} ✓`
                : `Not quite — that's ${pt(picked!)}. The target is shown in green.`}
            </span>
            <span className="ms-2 font-mono text-[10px] font-medium">
              {q.en}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- several points, graded as a set ---------------- */

function PointsPlotter({
  prompt,
  targets,
  grid: g,
  join,
  studentName,
  onResult,
}: {
  prompt: string;
  targets: [number, number][];
  grid: Grid;
  join: boolean;
  studentName?: string;
  onResult: (outcome: WidgetOutcome) => void;
}) {
  const who = studentName?.trim() || "the student";
  const svgRef = useRef<SVGSVGElement>(null);
  const [picks, setPicks] = useState<[number, number][]>([]);
  const [graded, setGraded] = useState<ReturnType<typeof gradePoints> | null>(null);
  const { px, py } = frame(g);
  const same = (a: P, b: P) => a[0] === b[0] && a[1] === b[1];

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (graded || !svgRef.current) return;
    const at = tapped(svgRef.current, e, g);
    if (!at) return;
    // a second tap on a point takes it off again
    setPicks((cur) => (cur.some((q) => same(q, at)) ? cur.filter((q) => !same(q, at)) : [...cur, at]));
  };
  const check = () => {
    if (graded || picks.length === 0) return;
    const r = gradePoints(picks, targets);
    setGraded(r);
    onResult({
      correct: r.ok,
      predicate: r.predicate,
      given: picks.map(pt).join(" "),
      detail: r.ok
        ? `✓ ${who} plotted all ${targets.length} points correctly: ${targets.map(pt).join(", ")}`
        : `✗ ${who} plotted ${picks.map(pt).join(", ")} for ${targets.map(pt).join(", ")} on the pair plotter — ${
            r.predicate === "swapped-coordinates" ? "some coordinates swapped (x first, then y)"
            : r.predicate === "wrong-quadrant" ? "right distances, wrong signs"
            : r.predicate === "extra-points" ? `${r.extra.map(pt).join(", ")} ${r.extra.length === 1 ? "is" : "are"} not asked for`
            : `missed ${r.missed.map(pt).join(", ")}`}`,
    });
  };
  const byX = (ps: readonly P[]) => [...ps].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const poly = (ps: readonly P[]) => byX(ps).map((q) => `${px(q[0])},${py(q[1])}`).join(" ");
  const isHit = (q: P) => !!graded && graded.hit.some((h) => same(h, q));

  return (
    <div className={WIDGET_FRAME}>
      <div className={WIDGET_HEAD}>
        <span className={WIDGET_KIND}>✳ interactive · pair plotter</span>
        <span className={WIDGET_HINT}>tap each point · tap again to remove</span>
      </div>
      <div className="px-3.5 py-3">
        <p className={WIDGET_PROMPT}>{prompt}</p>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          onClick={handleClick}
          role="img"
          aria-label={prompt}
          className={cx(WIDGET_WELL, "mx-auto mt-2.5 block w-full max-w-[280px]", graded ? "cursor-default" : "cursor-crosshair")}
        >
          <GridLayer g={g} dots={!graded} />
          {join && picks.length > 1 && (
            <polyline points={poly(picks)} fill="none" stroke="var(--gold)" strokeWidth="1.6" />
          )}
          {graded && join && (
            <polyline points={poly(targets)} fill="none" stroke={FIGURE_MARK.correct} strokeWidth="1.4" strokeDasharray="4 3" />
          )}
          {graded && graded.missed.map((q) => (
            <circle key={`m${q}`} cx={px(q[0])} cy={py(q[1])} r="6" fill="none" stroke={FIGURE_MARK.correct} strokeWidth="1.6" strokeDasharray="3 2" />
          ))}
          {picks.map((q) => {
            const ink = !graded ? "var(--gold)" : isHit(q) ? FIGURE_MARK.correct : FIGURE_MARK.wrong;
            return (
              <g key={`p${q}`} className="anim-pop">
                <circle cx={px(q[0])} cy={py(q[1])} r="5.5" fill={ink} opacity="0.25" />
                <circle cx={px(q[0])} cy={py(q[1])} r="3" fill={ink} />
                <text x={px(q[0]) + 7} y={py(q[1]) - 5} fontSize="8" fontWeight="600" fontFamily="var(--stack-mono)"
                  fill={graded && !isHit(q) ? FIGURE_MARK.wrongText : "var(--ink)"}>{pt(q)}</text>
              </g>
            );
          })}
        </svg>
        {!graded ? (
          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={check} disabled={picks.length === 0} className={BUTTON_SECONDARY}>
              Check my points
            </button>
            {picks.length > 0 && (
              <button type="button" onClick={() => setPicks([])} className={BUTTON_TERTIARY}>Clear</button>
            )}
          </div>
        ) : (
          <div className={cx("mt-2.5 px-3 py-2", WIDGET_RESULT[graded.ok ? "correct" : "wrong"])}>
            <span className="font-display text-[13.5px] font-bold">
              {graded.ok
                ? `Correct — all ${targets.length} points ✓`
                : `${graded.hit.length} of ${targets.length} right. The ones missed are circled in green${graded.extra.length ? "; grey ones were not asked for" : ""}.`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

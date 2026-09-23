"use client";

import { useRef, useState } from "react";
import { OK, type WidgetOutcome } from "@/lib/widget-predicates";
import { cx } from "@/components/sticker";
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
 */

const R = 5; // half-range
const UNIT = 24;
const PAD = 14;
const SIZE = R * 2 * UNIT + PAD * 2; // 264
const px = (x: number) => PAD + (x + R) * UNIT;
const py = (y: number) => PAD + (R - y) * UNIT;

function quadrant(x: number, y: number): { en: string; ar: string } {
  if (x === 0 && y === 0) return { en: "the origin", ar: "نقطة الأصل" };
  if (x === 0) return { en: "on the y-axis", ar: "على محور الصادات" };
  if (y === 0) return { en: "on the x-axis", ar: "على محور السينات" };
  if (x > 0 && y > 0) return { en: "Quadrant I", ar: "الربع الأول" };
  if (x < 0 && y > 0) return { en: "Quadrant II", ar: "الربع الثاني" };
  if (x < 0 && y < 0) return { en: "Quadrant III", ar: "الربع الثالث" };
  return { en: "Quadrant IV", ar: "الربع الرابع" };
}

export function PairPlotter({
  prompt,
  target,
  studentName,
  pronoun,
  onResult,
}: {
  prompt: string;
  target: [number, number];
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
  const who = studentName?.trim() || "the student";
  const they = pronoun?.trim() || "they";
  const [picked, setPicked] = useState<[number, number] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const done = picked !== null;
  const correct =
    done && picked![0] === target[0] && picked![1] === target[1];

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (done || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * SIZE;
    const sy = ((e.clientY - rect.top) / rect.height) * SIZE;
    const x = Math.round((sx - PAD) / UNIT - R);
    const y = Math.round(R - (sy - PAD) / UNIT);
    if (x < -R || x > R || y < -R || y > R) return;
    setPicked([x, y]);
    const ok = x === target[0] && y === target[1];
    const q = quadrant(target[0], target[1]);
    const swapped = x === target[1] && y === target[0];
    // Right distances, wrong signs is a different error from a plain miss: the
    // student found the point and reflected it.
    const mirrored =
      !swapped &&
      Math.abs(x) === Math.abs(target[0]) &&
      Math.abs(y) === Math.abs(target[1]);
    onResult({
      correct: ok,
      predicate: ok
        ? OK
        : swapped
        ? "swapped-coordinates"
        : mirrored
        ? "wrong-quadrant"
        : "off-target",
      given: `(${x},${y})`,
      detail: ok
        ? `✓ ${who} plotted (${target[0]},${target[1]}) correctly on the grid — ${q.en}`
        : `✗ ${who} plotted (${x},${y}) instead of (${target[0]},${target[1]}) on the pair plotter${
            swapped ? ` — ${they} swapped the coordinates (order confusion)` : ""
          }`,
    });
  };

  const ticks = Array.from({ length: R * 2 + 1 }, (_, i) => i - R);
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
          {/* grid */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={px(t)} y1={py(-R)} x2={px(t)} y2={py(R)}
                stroke="var(--line-soft)" strokeWidth="1"
              />
              <line
                x1={px(-R)} y1={py(t)} x2={px(R)} y2={py(t)}
                stroke="var(--line-soft)" strokeWidth="1"
              />
            </g>
          ))}
          {/* axes */}
          <line x1={px(-R)} y1={py(0)} x2={px(R)} y2={py(0)} stroke="var(--ink-soft)" strokeWidth="1.4" />
          <line x1={px(0)} y1={py(-R)} x2={px(0)} y2={py(R)} stroke="var(--ink-soft)" strokeWidth="1.4" />
          {/* tick labels */}
          {ticks.filter((t) => t !== 0).map((t) => (
            <g key={`l${t}`} fontSize="6.5" fill="var(--ink-faint)" fontFamily="var(--stack-mono)">
              <text x={px(t)} y={py(0) + 8.5} textAnchor="middle">{t}</text>
              <text x={px(0) - 4} y={py(t) + 2} textAnchor="end">{t}</text>
            </g>
          ))}
          <text x={px(R) - 2} y={py(0) - 4} fontSize="7.5" fill="var(--ink-soft)" textAnchor="end" fontStyle="italic">x</text>
          <text x={px(0) + 5} y={py(R) + 6} fontSize="7.5" fill="var(--ink-soft)" fontStyle="italic">y</text>

          {/* hover affordance: faint lattice dots until answered */}
          {!done &&
            ticks.map((x) =>
              ticks.map((y) => (
                <circle
                  key={`${x},${y}`}
                  cx={px(x)} cy={py(y)} r="1.1"
                  fill="var(--ink)" opacity="0.12"
                />
              ))
            )}

          {/* the target, revealed on a wrong pick */}
          {done && !correct && (
            <g>
              <line x1={px(target[0])} y1={py(0)} x2={px(target[0])} y2={py(target[1])} stroke={FIGURE_MARK.correct} strokeWidth="1" strokeDasharray="3 2.5" opacity="0.55" />
              <line x1={px(0)} y1={py(target[1])} x2={px(target[0])} y2={py(target[1])} stroke={FIGURE_MARK.correct} strokeWidth="1" strokeDasharray="3 2.5" opacity="0.55" />
              <circle cx={px(target[0])} cy={py(target[1])} r="6" fill="none" stroke={FIGURE_MARK.correct} strokeWidth="1.6" />
              <circle cx={px(target[0])} cy={py(target[1])} r="2.4" fill={FIGURE_MARK.correct} />
            </g>
          )}

          {/* the student's pick */}
          {done && (
            <g className="anim-pop">
              {correct && (
                <>
                  <line x1={px(picked![0])} y1={py(0)} x2={px(picked![0])} y2={py(picked![1])} stroke={FIGURE_MARK.correct} strokeWidth="1" strokeDasharray="3 2.5" opacity="0.55" />
                  <line x1={px(0)} y1={py(picked![1])} x2={px(picked![0])} y2={py(picked![1])} stroke={FIGURE_MARK.correct} strokeWidth="1" strokeDasharray="3 2.5" opacity="0.55" />
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
                ({picked![0]},{picked![1]})
              </text>
            </g>
          )}
        </svg>

        {done && (
          <div className={cx("mt-2.5 px-3 py-2", WIDGET_RESULT[correct ? "correct" : "wrong"])}>
            <span className="font-display text-[13.5px] font-bold">
              {correct
                ? `تمام! (${target[0]},${target[1]}) ✓`
                : `Not quite — that's (${picked![0]},${picked![1]}). The target is shown in green.`}
            </span>
            <span className="ms-2 font-mono text-[10px] font-medium">
              {q.en} · <span className="ar-label font-display font-bold">{q.ar}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

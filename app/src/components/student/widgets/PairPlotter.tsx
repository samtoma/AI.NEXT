"use client";

import { useRef, useState } from "react";

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
  onResult,
}: {
  prompt: string;
  target: [number, number];
  onResult: (note: string) => void;
}) {
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
    onResult(
      ok
        ? `✓ Omar plotted (${target[0]},${target[1]}) correctly on the grid — ${q.en}`
        : `✗ Omar plotted (${x},${y}) instead of (${target[0]},${target[1]}) on the pair plotter${
            x === target[1] && y === target[0]
              ? " — he swapped the coordinates (order confusion)"
              : ""
          }`
    );
  };

  const ticks = Array.from({ length: R * 2 + 1 }, (_, i) => i - R);
  const q = quadrant(target[0], target[1]);

  return (
    <div className="anim-pop my-2 overflow-hidden rounded-lg border border-accent/40 bg-card shadow-[0_10px_24px_-16px_rgba(13,74,66,0.5)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-accent-wash px-3.5 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-accent-deep">
          ✳ interactive · pair plotter
        </span>
        <span className="font-mono text-[9px] text-ink-faint">
          tap a point on the grid
        </span>
      </div>

      <div className="px-3.5 py-3">
        <p className="text-[13px] font-medium leading-relaxed text-ink">
          {prompt}
        </p>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          onClick={handleClick}
          role="img"
          aria-label={prompt}
          className={`mx-auto mt-2.5 block w-full max-w-[280px] rounded-md border border-line-soft bg-card-warm ${
            done ? "cursor-default" : "cursor-crosshair"
          }`}
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
              <line x1={px(target[0])} y1={py(0)} x2={px(target[0])} y2={py(target[1])} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 2.5" opacity="0.55" />
              <line x1={px(0)} y1={py(target[1])} x2={px(target[0])} y2={py(target[1])} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 2.5" opacity="0.55" />
              <circle cx={px(target[0])} cy={py(target[1])} r="6" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
              <circle cx={px(target[0])} cy={py(target[1])} r="2.4" fill="var(--accent)" />
            </g>
          )}

          {/* the student's pick */}
          {done && (
            <g className="anim-pop">
              {correct && (
                <>
                  <line x1={px(picked![0])} y1={py(0)} x2={px(picked![0])} y2={py(picked![1])} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 2.5" opacity="0.55" />
                  <line x1={px(0)} y1={py(picked![1])} x2={px(picked![0])} y2={py(picked![1])} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 2.5" opacity="0.55" />
                </>
              )}
              <circle
                cx={px(picked![0])} cy={py(picked![1])} r="5.5"
                fill={correct ? "var(--accent)" : "var(--rust)"}
                opacity="0.25"
              />
              <circle
                cx={px(picked![0])} cy={py(picked![1])} r="3"
                fill={correct ? "var(--accent)" : "var(--rust)"}
              />
              <text
                x={px(picked![0]) + 7} y={py(picked![1]) - 5}
                fontSize="8" fontWeight="600"
                fill={correct ? "var(--accent-deep)" : "var(--rust)"}
                fontFamily="var(--stack-mono)"
              >
                ({picked![0]},{picked![1]})
              </text>
            </g>
          )}
        </svg>

        {done && (
          <div
            className={`anim-pop mt-2.5 rounded-md border px-3 py-2 ${
              correct
                ? "border-accent/45 bg-accent-wash"
                : "border-rust/40 bg-rust-wash/60"
            }`}
          >
            <span
              className={`font-display text-[13.5px] font-medium ${
                correct ? "text-accent-deep" : "text-rust"
              }`}
            >
              {correct
                ? `تمام! (${target[0]},${target[1]}) ✓`
                : `Not quite — that's (${picked![0]},${picked![1]}). The target is shown in green.`}
            </span>
            <span className="ml-2 font-mono text-[10px] text-ink-soft">
              {q.en} · {q.ar}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

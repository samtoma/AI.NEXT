"use client";

import { useRef, useState } from "react";
import { resolvePlace, useBaseMap, type BaseMap } from "@/components/viz/maps";
import { cx } from "@/components/sticker";
import { useFireOnce } from "./util";
import {
  FIGURE_MARK,
  WIDGET_FRAME,
  WIDGET_HEAD,
  WIDGET_HINT_AR,
  WIDGET_KIND_AR,
  WIDGET_PROMPT,
  WIDGET_RESULT,
  WIDGET_WELL,
} from "./WidgetShell";

/**
 * {{widget:locate_on_map:{"base":"egypt","prompt":"فين قناة السويس؟ دوس على مكانها","target":"قناة السويس"}}}
 *
 * «حدد على الخريطة» as a tap. The student taps the place on the base map;
 * grading is a deterministic hit-test against the gazetteer (place radius).
 * With `decoys`, candidate markers are shown and the tap must pick among
 * them (the easier pick_region tier). One attempt; a miss reveals the
 * correct place pulsing — dignity in failure, no red X wall.
 */

export function LocateOnMap({
  base,
  prompt,
  target,
  decoys,
  studentName,
  onResult,
}: {
  base: string;
  prompt: string;
  target: string;
  decoys?: string[];
  /** The signed-in student's display name, narrated into the note below in
   *  place of the retired "Omar" demo persona (FR-2602, ADR-0010 plan A10).
   *  Falls back to a name-free "the student" — never a guess — when a caller
   *  (dev fixture, admin replay) has none to give. */
  studentName?: string;
  onResult: (note: string) => void;
}) {
  const who = studentName?.trim() || "the student";
  const { map, status } = useBaseMap(base);
  const fire = useFireOnce(onResult);
  const svgRef = useRef<SVGSVGElement>(null);
  const [picked, setPicked] = useState<{ x: number; y: number; hit: string | null } | null>(null);

  const done = picked !== null;
  const t = map ? resolvePlace(map, target) : null;
  const candidates =
    map && t
      ? [t, ...(decoys ?? []).map((d) => resolvePlace(map, d)).filter(
          (r): r is NonNullable<typeof r> => r !== null && r.name !== t.name
        )]
      : [];
  const pickMode = candidates.length > 1;
  const correct = done && t !== null && picked.hit === t.name;

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (done || !map || !t || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const [, , W, H] = map.viewBox;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    // nearest place whose hit radius contains the tap
    const pool = pickMode ? candidates : Object.entries(map.places).map(([name, place]) => ({ name, place }));
    let hit: string | null = null;
    let best = Infinity;
    for (const { name, place } of pool) {
      const dist = Math.hypot(x - place.at[0], y - place.at[1]);
      const within = dist <= place.r * (pickMode ? 1.35 : 1.15);
      if (within && dist / place.r < best) {
        best = dist / place.r;
        hit = name;
      }
    }
    setPicked({ x, y, hit });
    const ok = hit === t.name;
    fire(
      ok
        ? `✓ ${who} located "${t.name}" correctly on the ${base} map`
        : `✗ ${who} tapped ${hit ? `"${hit}"` : "an empty area"} instead of "${t.name}" on the ${base} map`
    );
  };

  const regionPath = (name: string): string | undefined => {
    if (!map) return undefined;
    const r = resolvePlace(map, name);
    return r?.place.ref ? map.paths[r.place.ref] : undefined;
  };

  const renderTargetReveal = (m: BaseMap) => {
    if (!t) return null;
    const d = regionPath(t.name);
    const [x, y] = t.place.at;
    return (
      <g className="anim-pop">
        {d ? (
          <path d={d} fill={FIGURE_MARK.correct} opacity="0.2" stroke={FIGURE_MARK.correct} strokeWidth="1.8">
            <animate attributeName="opacity" values="0.28;0.1;0.28" dur="1.6s" repeatCount="3" />
          </path>
        ) : (
          <circle cx={x} cy={y} r={Math.min(t.place.r, 22)} fill={FIGURE_MARK.correct} opacity="0.22" stroke={FIGURE_MARK.correct} strokeWidth="1.8">
            <animate attributeName="opacity" values="0.3;0.12;0.3" dur="1.6s" repeatCount="3" />
          </circle>
        )}
        <text
          x={x}
          y={t.place.kind === "point" ? y - 8 : y + 3}
          fontSize="10.5"
          fontWeight="700"
          textAnchor="middle"
          fill="var(--ink)"
          // halo in the well's own Cream, so the name reads over coastlines
          style={{ paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 3 }}
        >
          {t.name}
        </text>
      </g>
    );
  };

  return (
    <div dir="rtl" className={WIDGET_FRAME}>
      <div className={WIDGET_HEAD}>
        <span className={WIDGET_KIND_AR}>✳ تفاعلي · حدد على الخريطة</span>
        <span className={WIDGET_HINT_AR}>دوس على المكان الصح</span>
      </div>

      <div className="px-3.5 py-3">
        <p className={WIDGET_PROMPT}>{prompt}</p>

        {status === "error" ? (
          <p className="ar-label mt-2 font-display text-[0.72rem] font-bold text-[color:var(--play-text-muted)]">
            الخريطة مش متاحة دلوقتي
          </p>
        ) : !map ? (
          <div
            className={cx(
              WIDGET_WELL,
              "ar-label mt-2.5 flex h-40 items-center justify-center font-display text-[0.72rem] font-bold text-[color:var(--play-text-muted)]"
            )}
          >
            الخريطة بتتحمّل…
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${map.viewBox[2]} ${map.viewBox[3]}`}
            onClick={handleClick}
            role="img"
            aria-label={prompt}
            className={cx(
              WIDGET_WELL,
              "mx-auto mt-2.5 block w-full max-w-[360px]",
              done ? "cursor-default" : "cursor-pointer"
            )}
            style={{ fontFamily: "var(--stack-sans)" }}
          >
            <g dangerouslySetInnerHTML={{ __html: map.inner }} />

            {/* pick-mode candidate markers */}
            {!done &&
              pickMode &&
              candidates.map(({ name, place }) => (
                <g key={name}>
                  <circle
                    cx={place.at[0]}
                    cy={place.at[1]}
                    r={Math.min(place.r, 16)}
                    fill="var(--gold)"
                    opacity="0.16"
                    stroke="var(--gold)"
                    strokeWidth="1.4"
                    strokeDasharray="4 3"
                  >
                    <animate attributeName="opacity" values="0.22;0.08;0.22" dur="1.8s" repeatCount="indefinite" />
                  </circle>
                </g>
              ))}

            {/* the student's tap */}
            {done && (
              <g className="anim-pop">
                <circle
                  cx={picked.x}
                  cy={picked.y}
                  r="7"
                  fill={correct ? FIGURE_MARK.correct : FIGURE_MARK.wrong}
                  opacity="0.25"
                />
                <circle
                  cx={picked.x}
                  cy={picked.y}
                  r="3.2"
                  fill={correct ? FIGURE_MARK.correct : FIGURE_MARK.wrongText}
                />
              </g>
            )}

            {/* reveal the target (both outcomes — it's the take-away) */}
            {done && renderTargetReveal(map)}
          </svg>
        )}

        {done && t && (
          <div className={cx("mt-2.5 px-3 py-2", WIDGET_RESULT[correct ? "correct" : "wrong"])}>
            <span className="font-display text-[13.5px] font-bold">
              {correct
                ? `تمام! دي ${t.name} ✓`
                : picked.hit
                  ? `مش هنا — دي ${picked.hit}. بص فين ${t.name} بتنوّر بالأخضر`
                  : `قربت — ${t.name} بتنوّر بالأخضر، شوفها كويس`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

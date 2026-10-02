"use client";

/**
 * {{widget:solid_scaler:{"prompt":"Scale this cylinder so its volume is 8 times as large","solid":"cylinder","ask":"volume","ratio":8}}}
 *
 * Grade 10 (feature 003) chapter 13: prisms, cylinders, cones, pyramids and
 * spheres, drawn as a simple isometric-looking SVG (no 3-D library — a scaled
 * box, a squashed-ellipse cylinder/cone, an isometric pyramid, a shaded
 * circle for a sphere are all that reading a scale factor needs).
 *
 * THE QUESTION IS ALWAYS A RATIO, drag k until V0·k³ or A0·k² hits it — see
 * `solid-scaler-grade.ts` for why that is what puts `volume-scaled-by-k` and
 * `area-scaled-by-k` in reach. `ask: "area"` also carries face toggles: the
 * commonest surface-area slip is a left-out base, which a scale factor alone
 * can never diagnose, so the student also says which faces they counted.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { BUTTON_SECONDARY, BUTTON_TERTIARY } from "@/components/sticker";
import { Handle, WidgetShell, type Verdict, WIDGET_ACTIONS, WIDGET_WELL } from "./WidgetShell";
import { clamp, tidy, useDragSurface, useKeyNudge } from "./drag";
import { OK, type WidgetOutcome } from "@/lib/widget-predicates";
import {
  gradeAreaScale, gradeVolumeScale, isReachableK, solidGeometry,
  K_MAX, K_MIN, K_STEP, type SolidKind,
} from "./solid-scaler-grade";

const W = 300;
const H = 220;
const TRACK_Y = 190;
const TRACK_X0 = 40;
const TRACK_X1 = 260;

const FACES: Record<SolidKind, string[]> = {
  box: ["top", "bottom"],
  cylinder: ["top", "bottom"],
  cone: ["base"],
  pyramid: ["base"],
  sphere: [],
};

const fmt = (v: number) => tidy(v, 2);
const fmtPi = (v: number) => `${fmt(v / Math.PI)}π`;

/* --------------------------------------------------- the isometric drawing */

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

/** World (x right, y depth, z up) → screen, simple isometric. */
function iso(x: number, y: number, z: number): { x: number; y: number } {
  return { x: (x - y) * COS30, y: (x + y) * SIN30 - z };
}

function poly(pts: { x: number; y: number }[], cx: number, cy: number, s: number): string {
  return pts.map((p) => `${cx + p.x * s},${cy + p.y * s}`).join(" ");
}

/** A scaled, simple isometric-looking solid. `k` scales every LENGTH, so the
 *  drawing grows linearly while the readouts below it grow as k² or k³ —
 *  that mismatch, seen rather than told, is the whole point of the widget. */
function SolidDrawing({ solid, dims, k, ink }: {
  solid: SolidKind; dims: Record<string, number>; k: number; ink: string;
}) {
  const cx = W / 2;
  const cy = 130;
  const unit = 16; // px per world unit, before k

  if (solid === "box") {
    const { l, w, h } = dims as { l: number; w: number; h: number };
    const [L, Wd, H2] = [l * k, w * k, h * k];
    const top = [
      iso(-L / 2, -Wd / 2, H2), iso(L / 2, -Wd / 2, H2),
      iso(L / 2, Wd / 2, H2), iso(-L / 2, Wd / 2, H2),
    ];
    const front = [
      iso(-L / 2, Wd / 2, H2), iso(L / 2, Wd / 2, H2),
      iso(L / 2, Wd / 2, 0), iso(-L / 2, Wd / 2, 0),
    ];
    const side = [
      iso(L / 2, Wd / 2, H2), iso(L / 2, -Wd / 2, H2),
      iso(L / 2, -Wd / 2, 0), iso(L / 2, Wd / 2, 0),
    ];
    return (
      <g>
        <polygon points={poly(side, cx, cy, unit)} fill={ink} fillOpacity="0.35" stroke={ink} strokeWidth="1.4" />
        <polygon points={poly(front, cx, cy, unit)} fill={ink} fillOpacity="0.5" stroke={ink} strokeWidth="1.4" />
        <polygon points={poly(top, cx, cy, unit)} fill={ink} fillOpacity="0.2" stroke={ink} strokeWidth="1.4" />
      </g>
    );
  }

  if (solid === "pyramid") {
    const { s, h } = dims as { s: number; h: number };
    const [S, H2] = [s * k, h * k];
    const base = [
      iso(-S / 2, -S / 2, 0), iso(S / 2, -S / 2, 0),
      iso(S / 2, S / 2, 0), iso(-S / 2, S / 2, 0),
    ];
    const apex = iso(0, 0, H2);
    return (
      <g>
        <polygon points={poly(base, cx, cy, unit)} fill="none" stroke={ink} strokeWidth="1.4" strokeDasharray="3 2" opacity="0.6" />
        {[0, 1, 2, 3].map((i) => (
          <polygon
            key={i}
            points={`${cx + base[i].x * unit},${cy + base[i].y * unit} ${cx + base[(i + 1) % 4].x * unit},${cy + base[(i + 1) % 4].y * unit} ${cx + apex.x * unit},${cy + apex.y * unit}`}
            fill={ink} fillOpacity={i === 1 || i === 2 ? 0.45 : 0.2} stroke={ink} strokeWidth="1.2"
          />
        ))}
      </g>
    );
  }

  // cylinder, cone, sphere: a squashed-ellipse silhouette reads as 3-D
  // without a projection library.
  const RY = 0.42; // vertical squash for the ellipse "seen from above"
  if (solid === "cylinder") {
    const { r, h } = dims as { r: number; h: number };
    const R = r * k * unit, H2 = h * k * unit;
    const topY = cy - H2 / 2, botY = cy + H2 / 2;
    return (
      <g>
        <path d={`M ${cx - R} ${topY} A ${R} ${R * RY} 0 0 0 ${cx + R} ${topY} L ${cx + R} ${botY} A ${R} ${R * RY} 0 0 1 ${cx - R} ${botY} Z`}
              fill={ink} fillOpacity="0.35" stroke={ink} strokeWidth="1.4" />
        <ellipse cx={cx} cy={topY} rx={R} ry={R * RY} fill={ink} fillOpacity="0.2" stroke={ink} strokeWidth="1.4" />
      </g>
    );
  }
  if (solid === "cone") {
    const { r, h } = dims as { r: number; h: number };
    const R = r * k * unit, H2 = h * k * unit;
    const baseY = cy + H2 / 2, apexY = cy - H2 / 2;
    return (
      <g>
        <path d={`M ${cx - R} ${baseY} A ${R} ${R * RY} 0 0 0 ${cx + R} ${baseY} L ${cx} ${apexY} Z`}
              fill={ink} fillOpacity="0.4" stroke={ink} strokeWidth="1.4" strokeLinejoin="round" />
        <ellipse cx={cx} cy={baseY} rx={R} ry={R * RY} fill="none" stroke={ink} strokeWidth="1.4" strokeDasharray="3 2" opacity="0.6" />
      </g>
    );
  }
  // sphere
  const { r } = dims as { r: number };
  const R = r * k * unit;
  return (
    <g>
      <circle cx={cx} cy={cy} r={R} fill={ink} fillOpacity="0.3" stroke={ink} strokeWidth="1.4" />
      <ellipse cx={cx} cy={cy} rx={R} ry={R * RY} fill="none" stroke={ink} strokeWidth="1" opacity="0.5" />
    </g>
  );
}

/* --------------------------------------------------------------- the widget */

export function SolidScaler({
  prompt, solid, dims, ask, ratio, studentName, onResult,
}: {
  prompt: string;
  solid: SolidKind;
  dims: Record<string, number>;
  ask: "volume" | "area";
  ratio: number;
  /** The signed-in student's display name, narrated into the [live event]
   *  line below in place of the retired "Omar" demo persona (FR-2602,
   *  ADR-0010 plan A10). */
  studentName?: string;
  onResult: (o: WidgetOutcome) => void;
}) {
  const who = studentName?.trim() || "the student";
  const svgRef = useRef<SVGSVGElement>(null);
  const [k, setK] = useState(1);
  const faces = FACES[solid];
  const [on, setOn] = useState<boolean[]>(() => faces.map(() => false));
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);

  const geom = useMemo(() => solidGeometry(solid, dims), [solid, dims]);
  const basesIncluded = faces.length === 0 || on.every(Boolean);

  const snapK = useCallback((x: number) => {
    const t = clamp((x - TRACK_X0) / (TRACK_X1 - TRACK_X0), 0, 1);
    const raw = K_MIN + t * (K_MAX - K_MIN);
    return clamp(Math.round(raw / K_STEP) * K_STEP, K_MIN, K_MAX);
  }, []);

  const { dragging, surface } = useDragSurface({
    svgRef,
    toValue: (q) => ({ x: q.x, y: q.y }),
    onMove: (q) => { if (!verdict) setK(snapK(q.x)); },
  });

  const kX = TRACK_X0 + ((k - K_MIN) / (K_MAX - K_MIN)) * (TRACK_X1 - TRACK_X0);

  const volumeAt = geom.volume * k ** 3;
  const areaAt = (basesIncluded ? geom.areaTotal : geom.areaPartial) * k ** 2;

  const check = useCallback(() => {
    if (fired.current) return;
    const g = ask === "volume" ? gradeVolumeScale(ratio, k) : gradeAreaScale(ratio, k, basesIncluded);
    fired.current = true;
    setVerdict(g.ok ? "correct" : "wrong");
    const reading = ask === "volume" ? volumeAt : areaAt;
    const label = ask === "volume" ? "volume" : "surface area";
    setNote(
      g.ok
        ? `k = ${k} makes the ${label} ${ratio}× the original.`
        : g.predicate === "wrong-formula-part"
          ? `The scale factor is right, but a face is missing from the surface-area reading — check every base is counted.`
          : g.predicate === "volume-scaled-by-k" || g.predicate === "area-scaled-by-k"
            ? `k = ${k} scales a LENGTH by ${k}, not the ${label} — ${label === "volume" ? "volume scales by k³" : "area scales by k²"}.`
            : `k = ${k} does not make the ${label} ${ratio}× the original.`
    );
    onResult({
      correct: g.ok,
      predicate: g.ok ? OK : g.predicate,
      given: `k=${k}${faces.length ? `, faces=[${faces.filter((_, i) => on[i]).join(",")}]` : ""}`,
      detail: g.ok
        ? `✓ ${who} set k=${k} on the solid scaler, making the ${solid}'s ${label} ${ratio}× the original`
        : `✗ ${who} set k=${k} on the solid scaler (${label} reads ${fmt(reading)}), asked for ${ratio}× the original — ${g.predicate}`,
    });
  }, [ask, ratio, k, basesIncluded, volumeAt, areaAt, onResult, who, solid, faces, on]);

  const nudge = useKeyNudge({
    step: K_STEP,
    disabled: !!verdict,
    onNudge: (dx) => { if (!verdict) setK((cur) => clamp(Math.round((cur + dx) / K_STEP) * K_STEP, K_MIN, K_MAX)); },
    onCommit: check,
  });

  const ink = verdict === "correct" ? "var(--accent)" : "var(--gold)";
  const kOk = isReachableK(k);

  return (
    <WidgetShell
      kind={`solid scaler · ${solid} · ${ask}`}
      hint="drag the scale factor"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        verdict ? null : (
          <span className="inline-flex flex-wrap justify-center gap-x-3 gap-y-1">
            <span className={ask === "volume" ? "font-bold text-ink" : "text-ink-faint"}>
              V(k) = {solid === "box" || solid === "pyramid" ? fmt(volumeAt) : fmtPi(volumeAt)}
            </span>
            <span className={ask === "area" ? "font-bold text-ink" : "text-ink-faint"}>
              A(k) = {solid === "box" || solid === "pyramid" ? fmt(areaAt) : fmtPi(areaAt)}
            </span>
            <span className="text-ink-faint">k = {k}{!kOk ? " (off the grid)" : ""}</span>
          </span>
        )
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={`mx-auto block w-full max-w-[320px] ${WIDGET_WELL} ${verdict ? "cursor-default" : "cursor-ew-resize"}`}
        {...(verdict ? {} : surface)}
      >
        <SolidDrawing solid={solid} dims={dims} k={k} ink={ink} />

        {/* the scale slider */}
        <line x1={TRACK_X0} y1={TRACK_Y} x2={TRACK_X1} y2={TRACK_Y} stroke="var(--ink-soft)" strokeWidth="1.4" />
        {Array.from({ length: Math.round((K_MAX - K_MIN) / K_STEP) + 1 }, (_, i) => K_MIN + i * K_STEP).map((v) => (
          <line
            key={v}
            x1={TRACK_X0 + ((v - K_MIN) / (K_MAX - K_MIN)) * (TRACK_X1 - TRACK_X0)} y1={TRACK_Y - 4}
            x2={TRACK_X0 + ((v - K_MIN) / (K_MAX - K_MIN)) * (TRACK_X1 - TRACK_X0)} y2={TRACK_Y + 4}
            stroke="var(--ink-faint)" strokeWidth="1"
          />
        ))}
        <Handle
          cx={kX} cy={TRACK_Y} r={6} color={ink} label="Scale factor k"
          live={`${k}`} dragging={dragging} locked={!!verdict}
          onKeyDown={nudge}
        />
        <text x={kX} y={TRACK_Y + 18} fontSize="10" textAnchor="middle" fill="var(--ink)"
              style={{ fontFamily: "var(--stack-mono)" }}>
          k = {k}
        </text>
      </svg>

      {!verdict && (
        <div className={WIDGET_ACTIONS}>
          {ask === "area" && faces.map((face, i) => (
            <button
              key={face}
              type="button"
              onClick={() => setOn((cur) => cur.map((v, j) => (j === i ? !v : v)))}
              aria-pressed={on[i]}
              className={BUTTON_TERTIARY}
            >
              {face}: {on[i] ? "✓ counted" : "not counted"}
            </button>
          ))}
          <button type="button" onClick={check} className={BUTTON_SECONDARY}>Check</button>
        </div>
      )}
    </WidgetShell>
  );
}

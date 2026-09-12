"use client";

/**
 * {{widget:angle_setter:{"prompt":"Drag B until the central angle is 80°","ask":"central","target":80}}}
 * {{widget:angle_setter:{"prompt":"Make the inscribed angle at C equal 35°","ask":"inscribed","target":35}}}
 *
 * The inscribed-angle theorem as something you do with your hands.
 *
 * A and B sit on the circle, C is the inscribed vertex, and all three drag.
 * Two readouts update continuously: the arc AB that C faces, and the angle
 * ∠ACB. They stay in a 2:1 ratio through every drag, which is the theorem —
 * and the student discovers it by watching a number refuse to change rather
 * than by being told a rule.
 *
 * WHY THE ARC IS "THE ONE C FACES" AND NOT "THE MINOR ARC". If C crosses onto
 * the other arc, a naive widget shows the inscribed angle jumping to the
 * supplement and looks broken. It is not broken: that jump IS the cyclic
 * quadrilateral theorem from the same unit. Defining the subtended arc as the
 * one C looks at makes inscribed = arc/2 true everywhere, no special case, and
 * lets the supplementary relationship show up as a labelled consequence rather
 * than a glitch. Both theorems come out of one construction.
 *
 * Angles snap to 5°, so every target the book asks for is reachable exactly
 * and no answer is lost to a pixel.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { makePlane } from "../../viz/plane";
import { Handle, WidgetShell, type Verdict } from "./WidgetShell";
import { tidy, useDragSurface, useKeyNudge, type Pt } from "./drag";

const RAD = 5;
const LIM = 6.4;
const W = 300;
const H = 300;
const SNAP = 5; // degrees

const norm = (d: number) => ((d % 360) + 360) % 360;
const toXY = (deg: number): Pt => ({
  x: RAD * Math.cos((deg * Math.PI) / 180),
  y: RAD * Math.sin((deg * Math.PI) / 180),
});
const degOf = (p: Pt) => norm((Math.atan2(p.y, p.x) * 180) / Math.PI);

export function AngleSetter({
  prompt,
  ask,
  target,
  onResult,
}: {
  prompt: string;
  ask: "central" | "inscribed";
  target: number;
  onResult: (note: string) => void;
}) {
  const p = useMemo(() => makePlane([-LIM, LIM], [-LIM, LIM], W, H, 18), []);
  const svgRef = useRef<SVGSVGElement>(null);
  // A parked left, B and C placed so nothing starts on the answer.
  const [deg, setDeg] = useState({ A: 180, B: 250, C: 60 });
  const [active, setActive] = useState<"A" | "B" | "C">("B");
  const held = useRef<"A" | "B" | "C" | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);

  const geom = useMemo(() => {
    const { A, B, C } = deg;
    const ccw = norm(B - A); // arc A→B counter-clockwise
    const offC = norm(C - A);
    const cOnCcw = offC < ccw;
    // The arc AB that C looks ACROSS at — the one it does not stand on.
    const facing = cOnCcw ? 360 - ccw : ccw;
    const inscribed = facing / 2;
    return {
      facing: tidy(facing, 1),
      inscribed: tidy(inscribed, 1),
      reflex: facing > 180,
      cOnCcw,
      pA: toXY(A),
      pB: toXY(B),
      pC: toXY(C),
    };
  }, [deg]);

  const snapDeg = useCallback(
    (v: Pt): Pt => {
      const d = norm(Math.round(degOf(v) / SNAP) * SNAP);
      return toXY(d);
    },
    []
  );

  const nearest = useCallback(
    (v: Pt): "A" | "B" | "C" => {
      const d = degOf(v);
      const gap = (k: "A" | "B" | "C") => {
        const raw = Math.abs(norm(deg[k] - d));
        return Math.min(raw, 360 - raw);
      };
      return (["A", "B", "C"] as const).reduce((best, k) =>
        gap(k) < gap(best) ? k : best
      );
    },
    [deg]
  );

  const { dragging, surface } = useDragSurface({
    svgRef,
    toValue: (q) => ({ x: p.ix(q.x), y: p.iy(q.y) }),
    snap: snapDeg,
    onMove: (v) => {
      if (verdict) return;
      let k = held.current;
      if (k === null) {
        k = nearest(v);
        held.current = k;
        setActive(k);
      }
      const at = k;
      const d = norm(Math.round(degOf(v) / SNAP) * SNAP);
      setDeg((cur) => {
        // Three coincident points are not a triangle; the move is refused
        // rather than collapsing the figure.
        const others = (["A", "B", "C"] as const).filter((z) => z !== at);
        if (others.some((z) => cur[z] === d)) return cur;
        return { ...cur, [at]: d };
      });
    },
    onCommit: () => {
      held.current = null;
    },
  });

  const reading = ask === "central" ? geom.facing : geom.inscribed;

  const check = useCallback(() => {
    if (fired.current) return;
    const ok = Math.abs(reading - target) < 1e-6;
    fired.current = true;
    setVerdict(ok ? "correct" : "wrong");
    const label = ask === "central" ? "arc AB / central angle" : "inscribed angle ∠ACB";
    let why = "";
    if (!ok) {
      if (ask === "inscribed" && Math.abs(geom.facing - target) < 1e-6) {
        why =
          " — that is the value of the ARC, not the inscribed angle; the inscribed angle is HALF the arc it faces";
      } else if (ask === "central" && Math.abs(geom.inscribed - target) < 1e-6) {
        why =
          " — that is the inscribed angle; the central angle / arc is DOUBLE it";
      } else if (Math.abs(360 - reading - target) < 1e-6) {
        why = " — that is the other arc; C faces the one across from it";
      }
    }
    setNote(
      ok
        ? `${label} = ${reading}°, and ∠ACB = ${geom.inscribed}° is exactly half the arc ${geom.facing}°.`
        : `You set ${label} to ${reading}°; the target is ${target}°${why}`
    );
    onResult(
      ok
        ? `✓ Omar set the ${label} to ${target}° on the angle setter (arc ${geom.facing}°, inscribed ${geom.inscribed}° — the 2:1 relationship held)`
        : `✗ Omar set the ${label} to ${reading}° instead of ${target}° on the angle setter${why}`
    );
  }, [ask, reading, target, geom, onResult]);

  const nudge = useKeyNudge({
    step: SNAP,
    disabled: !!verdict,
    onNudge: (dx, dy) => {
      if (verdict) return;
      const step = dx !== 0 ? dx : dy;
      setDeg((cur) => {
        const d = norm(cur[active] + step);
        const others = (["A", "B", "C"] as const).filter((z) => z !== active);
        if (others.some((z) => cur[z] === d)) return cur;
        return { ...cur, [active]: d };
      });
    },
    onCommit: check,
  });

  const ink = verdict === "correct" ? "var(--accent)" : "var(--gold)";
  /** Screen-space arc from `from`° to `to`° counter-clockwise at radius r.
   *  `open` yields a stroke path; otherwise it is closed back through the
   *  centre, which is the wedge. (SVG sweeps clockwise in screen space, so
   *  sweep-flag 0 is the counter-clockwise direction here — y is flipped.) */
  const arcPath = (from: number, to: number, r: number, open = true) => {
    const span = norm(to - from);
    const k = r / RAD;
    const s = toXY(from);
    const e = toXY(to);
    const rp = p.sx(r) - p.sx(0);
    const head = `M ${p.sx(s.x * k)} ${p.sy(s.y * k)}`;
    const arc = `A ${rp} ${rp} 0 ${span > 180 ? 1 : 0} 0 ${p.sx(e.x * k)} ${p.sy(e.y * k)}`;
    return open ? `${head} ${arc}` : `M ${p.sx(0)} ${p.sy(0)} L ${p.sx(s.x * k)} ${p.sy(s.y * k)} ${arc} Z`;
  };

  return (
    <WidgetShell
      kind="angle setter"
      hint="drag A, B or C"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        <span className="inline-flex flex-wrap justify-center gap-x-3 gap-y-1">
          <span className={ask === "central" ? "text-ink" : "text-ink-faint"}>
            arc AB facing C: {geom.facing}°
          </span>
          <span className={ask === "inscribed" ? "text-ink" : "text-ink-faint"}>
            ∠ACB: {geom.inscribed}°
          </span>
          <span className="text-accent-deep">always ×2</span>
        </span>
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={`mx-auto block w-full max-w-[320px] rounded-md border border-line-soft bg-card-warm ${
          verdict ? "cursor-default" : "cursor-grab"
        }`}
        {...(verdict ? {} : surface)}
      >
        <circle
          cx={p.sx(0)} cy={p.sy(0)} r={p.sx(RAD) - p.sx(0)}
          fill="none" stroke="var(--line)" strokeWidth="1.6"
        />

        {/* the arc C faces, drawn fat on the circumference — the quantity the
            readout is naming, shown in the same place the eye is looking */}
        <path
          d={geom.cOnCcw ? arcPath(deg.A, deg.B, RAD) : arcPath(deg.B, deg.A, RAD)}
          fill="none" stroke={ink} strokeWidth="4.5" strokeLinecap="round" opacity="0.5"
        />

        {/* radii to A and B, and the wedge at the centre */}
        <line x1={p.sx(0)} y1={p.sy(0)} x2={p.sx(geom.pA.x)} y2={p.sy(geom.pA.y)}
              stroke="var(--ink-faint)" strokeWidth="1.2" strokeDasharray="3 2.5" />
        <line x1={p.sx(0)} y1={p.sy(0)} x2={p.sx(geom.pB.x)} y2={p.sy(geom.pB.y)}
              stroke="var(--ink-faint)" strokeWidth="1.2" strokeDasharray="3 2.5" />
        <path
          d={arcPath(
            geom.cOnCcw ? deg.B : deg.A,
            geom.cOnCcw ? deg.A : deg.B,
            RAD * 0.26,
            false
          )}
          fill={ink} fillOpacity="0.14" stroke={ink} strokeWidth="1"
        />

        {/* the inscribed angle at C */}
        <line x1={p.sx(geom.pC.x)} y1={p.sy(geom.pC.y)} x2={p.sx(geom.pA.x)} y2={p.sy(geom.pA.y)}
              stroke={ink} strokeWidth="2" strokeLinecap="round" />
        <line x1={p.sx(geom.pC.x)} y1={p.sy(geom.pC.y)} x2={p.sx(geom.pB.x)} y2={p.sy(geom.pB.y)}
              stroke={ink} strokeWidth="2" strokeLinecap="round" />

        <circle cx={p.sx(0)} cy={p.sy(0)} r="2.6" fill="var(--ink-soft)" />
        <text x={p.sx(0) + 6} y={p.sy(0) + 12} fontSize="9.5" fill="var(--ink-soft)"
              fontStyle="italic">M</text>

        {(["A", "B", "C"] as const).map((k) => {
          const pt = k === "A" ? geom.pA : k === "B" ? geom.pB : geom.pC;
          return (
            <g key={k}>
              <Handle
                cx={p.sx(pt.x)} cy={p.sy(pt.y)}
                color={k === "C" ? "var(--accent-deep)" : ink}
                label={`Point ${k}`}
                live={`${deg[k]} degrees`}
                dragging={dragging && active === k}
                locked={!!verdict}
                onKeyDown={(e) => {
                  setActive(k);
                  nudge(e);
                }}
              />
              <text
                x={p.sx(pt.x * 1.19)} y={p.sy(pt.y * 1.19) + 3.5}
                fontSize="11" fontWeight="600" textAnchor="middle"
                fill={k === "C" ? "var(--accent-deep)" : "var(--ink-soft)"}
              >
                {k}
              </text>
            </g>
          );
        })}
      </svg>

      {!verdict && (
        <button
          type="button"
          onClick={check}
          className="mx-auto mt-2.5 block min-h-[40px] rounded-md border border-accent/45 bg-accent-wash px-4 font-display text-[13px] font-medium text-accent-deep transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45"
        >
          Done — that&apos;s {target}°
        </button>
      )}
    </WidgetShell>
  );
}

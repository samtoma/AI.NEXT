"use client";

/**
 * {{widget:polygon_builder:{"prompt":"Construct a rhombus","mode":"construct","shape":"rhombus"}}}
 * {{widget:polygon_builder:{"prompt":"Draw the segment joining the two midpoints","mode":"midsegment","triangle":[[0,0],[6,0],[0,6]],"apex":0}}}
 * {{widget:polygon_builder:{"prompt":"Build a triangle with area 6","mode":"area","shape":"triangle","target":6}}}
 *
 * Grade 10 (feature 003) geometry: triangles and quadrilaterals on straight
 * lines, where Prep-3's geometry widgets are all circle-based. Three modes,
 * one instrument — a lattice the student drags vertices on.
 *
 * GRADED BY PROPERTY, NOT POSITION (FR-1205), same discipline as
 * `CircleBuilder`: "construct" accepts every parallelogram, not one stored
 * pair of coordinates, and "midsegment" accepts every segment that is
 * parallel to the third side and half its length, wherever the student's two
 * points happen to sit on it. The pure checks live in `polygon-grade.ts`;
 * this file drags points and draws.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { makePlane, PlaneFrame } from "../../viz/plane";
import { BUTTON_SECONDARY } from "@/components/sticker";
import { Handle, WidgetShell, type Verdict, WIDGET_ACTIONS, WIDGET_WELL } from "./WidgetShell";
import { clamp, tidy, useDragSurface, useKeyNudge, type Pt } from "./drag";
import { OK, type WidgetOutcome } from "@/lib/widget-predicates";
import {
  gradeArea, gradeConstruct, gradeMidsegment, QUAD_SHAPES, type PolygonShape,
} from "./polygon-grade";

const LIM = 6;
const W = 300;
const H = 300;

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
const len2 = (a: Pt): number => a.x * a.x + a.y * a.y;
const dist = (a: Pt, b: Pt): number => Math.sqrt(len2(sub(a, b)));
const fmt = (v: number) => tidy(v, 2);

const isQuad = (shape: string) => (QUAD_SHAPES as readonly string[]).includes(shape);
const nVertices = (shape: string) => (isQuad(shape) ? 4 : 3);

const TRIANGLE_START: Pt[] = [{ x: -3, y: -3 }, { x: 4, y: -3 }, { x: -2, y: 4 }];
const QUAD_START: Pt[] = [{ x: -4, y: -3 }, { x: 4, y: -4 }, { x: 5, y: 4 }, { x: -3, y: 3 }];

const SHAPE_LABEL: Record<PolygonShape, string> = {
  scalene: "a scalene triangle", isosceles: "an isosceles triangle", right: "a right triangle",
  parallelogram: "a parallelogram", rectangle: "a rectangle", rhombus: "a rhombus",
  square: "a square", trapezium: "a trapezium", kite: "a kite",
};

/** One live property readout — dot + word, never colour alone (Noor Play). */
function Prop({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className={on ? "text-accent-deep" : "text-ink-faint"}>
      {on ? "●" : "○"} {children}
    </span>
  );
}

type Props =
  | {
      mode: "construct"; prompt: string; shape: PolygonShape;
      studentName?: string; onResult: (o: WidgetOutcome) => void;
    }
  | {
      mode: "midsegment"; prompt: string;
      triangle: [[number, number], [number, number], [number, number]]; apex: 0 | 1 | 2;
      studentName?: string; onResult: (o: WidgetOutcome) => void;
    }
  | {
      mode: "area"; prompt: string; shape: "triangle" | "quadrilateral"; target: number;
      studentName?: string; onResult: (o: WidgetOutcome) => void;
    };

export function PolygonBuilder(props: Props) {
  const who = props.studentName?.trim() || "the student";
  return props.mode === "midsegment"
    ? <Midsegment {...props} who={who} />
    : <VertexDrag {...props} who={who} />;
}

/* ------------------------------------------------ construct + area modes */

function VertexDrag(
  props: (
    | { mode: "construct"; shape: PolygonShape }
    | { mode: "area"; shape: "triangle" | "quadrilateral"; target: number }
  ) & { prompt: string; who: string; onResult: (o: WidgetOutcome) => void }
) {
  const { prompt, who, onResult } = props;
  const n = props.mode === "construct" ? nVertices(props.shape) : (props.shape === "quadrilateral" ? 4 : 3);
  const plane = useMemo(() => makePlane([-LIM, LIM], [-LIM, LIM], W, H, 18), []);
  const svgRef = useRef<SVGSVGElement>(null);
  const [pts, setPts] = useState<Pt[]>(() => (n === 4 ? QUAD_START : TRIANGLE_START).slice(0, n));
  const [active, setActive] = useState(0);
  const held = useRef<number | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);

  const { dragging, surface } = useDragSurface({
    svgRef,
    toValue: (q) => ({ x: plane.ix(q.x), y: plane.iy(q.y) }),
    snap: (v: Pt) => ({ x: clamp(Math.round(v.x), -LIM, LIM), y: clamp(Math.round(v.y), -LIM, LIM) }),
    onMove: (v) => {
      if (verdict) return;
      let i = held.current;
      if (i === null) {
        let best = 0, bestD = Infinity;
        pts.forEach((p, k) => {
          const d = len2(sub(p, v));
          if (d < bestD) { bestD = d; best = k; }
        });
        i = best;
        held.current = i;
        setActive(i);
      }
      const at = i;
      setPts((cur) => {
        const next = [...cur];
        next[at] = v;
        return next;
      });
    },
    onCommit: () => { held.current = null; },
  });

  // Live properties, for teaching, not grading — the same discipline as
  // CircleBuilder's lit-up defining properties.
  const live = useMemo(() => {
    const sides = pts.map((p, i) => dist(p, pts[(i + 1) % n]));
    if (n === 3) {
      const [s0, s1, s2] = sides.map((s) => tidy(s * s, 2)); // squared, exact on the lattice
      const right = pts.some((_, i) => {
        const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
        return dot(sub(prev, cur), sub(next, cur)) === 0;
      });
      return { sides, allEqual: s0 === s1 && s1 === s2, twoEqual: s0 === s1 || s1 === s2 || s0 === s2, right };
    }
    const [A, B, C, D] = pts;
    const par1 = cross(sub(B, A), sub(D, C)) === 0;
    const par2 = cross(sub(C, B), sub(A, D)) === 0;
    const s2 = sides.map((s) => tidy(s * s, 2));
    const allEqual = s2.every((s) => s === s2[0]);
    const right = pts.some((_, i) => {
      const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
      return dot(sub(prev, cur), sub(next, cur)) === 0;
    });
    return { sides, par1, par2, allEqual, right };
  }, [pts, n]);

  const area = useMemo(() => {
    let s = 0;
    for (let i = 0; i < n; i++) s += pts[i].x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * pts[i].y;
    return Math.abs(s) / 2;
  }, [pts, n]);

  const check = useCallback(() => {
    if (fired.current) return;
    const g = props.mode === "construct" ? gradeConstruct(props.shape, pts) : gradeArea(pts, props.target);
    fired.current = true;
    setVerdict(g.ok ? "correct" : "wrong");
    const want = props.mode === "construct" ? SHAPE_LABEL[props.shape] : `area ${props.target}`;
    const why =
      g.predicate === "only-one-pair-parallel" ? " — only one pair of sides is parallel"
      : g.predicate === "sides-not-equal" ? " — the sides that must be equal are not"
      : g.predicate === "no-right-angle" ? " — none of the angles is a right angle"
      : g.predicate === "area-missing-half" ? ` — that is exactly double: this area is ${fmt(area)}, which is 2× the target`
      : "";
    setNote(
      g.ok
        ? `That is ${props.mode === "construct" ? SHAPE_LABEL[props.shape] : `a shape with area ${fmt(area)}`}.`
        : `The target is ${want}${why}.`
    );
    onResult({
      correct: g.ok,
      predicate: g.ok ? OK : g.predicate,
      given: `[${pts.map((p) => `(${p.x},${p.y})`).join(" ")}]`,
      detail: g.ok
        ? `✓ ${who} constructed ${props.mode === "construct" ? SHAPE_LABEL[props.shape] : `a polygon of area ${fmt(area)}`} on the polygon builder`
        : `✗ ${who} built [${pts.map((p) => `(${p.x},${p.y})`).join(" ")}] on the polygon builder, asked for ${want}`,
    });
  }, [props, pts, area, onResult, who]);

  const nudge = useKeyNudge({
    step: 1,
    disabled: !!verdict,
    onNudge: (dx, dy) => {
      if (verdict) return;
      setPts((cur) => {
        const next = [...cur];
        next[active] = { x: clamp(cur[active].x + dx, -LIM, LIM), y: clamp(cur[active].y + dy, -LIM, LIM) };
        return next;
      });
    },
    onCommit: check,
  });

  const ink = verdict === "correct" ? "var(--accent)" : "var(--gold)";
  const path = pts.map((p) => `${plane.sx(p.x)},${plane.sy(p.y)}`).join(" ");

  return (
    <WidgetShell
      kind={`polygon · ${props.mode === "construct" ? props.shape : `area ${props.target}`}`}
      hint="drag the vertices"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        verdict ? null : props.mode === "area" ? (
          <span className="text-ink">area so far: {fmt(area)} (target {props.target})</span>
        ) : n === 3 ? (
          <span className="inline-flex flex-wrap justify-center gap-x-3 gap-y-1">
            <Prop on={live.right}>right angle</Prop>
            <Prop on={live.twoEqual ?? false}>two sides equal</Prop>
            <Prop on={live.allEqual}>all sides equal</Prop>
          </span>
        ) : (
          <span className="inline-flex flex-wrap justify-center gap-x-3 gap-y-1">
            <Prop on={live.par1 ?? false}>side 1 ∥ side 3</Prop>
            <Prop on={live.par2 ?? false}>side 2 ∥ side 4</Prop>
            <Prop on={live.allEqual}>all sides equal</Prop>
            <Prop on={live.right}>right angle</Prop>
          </span>
        )
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={`mx-auto block w-full max-w-[320px] ${WIDGET_WELL} ${verdict ? "cursor-default" : "cursor-crosshair"}`}
        {...(verdict ? {} : surface)}
      >
        <PlaneFrame p={plane} />
        <polygon points={path} fill={ink} fillOpacity="0.12" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <Handle
            key={i}
            cx={plane.sx(p.x)} cy={plane.sy(p.y)}
            color={ink}
            label={`Vertex ${i + 1}`}
            live={`${p.x}, ${p.y}`}
            dragging={dragging && active === i}
            locked={!!verdict}
            onKeyDown={(e) => { setActive(i); nudge(e); }}
          />
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

/* -------------------------------------------------------- midsegment mode */

function Midsegment({
  prompt, triangle, apex, who, onResult,
}: {
  prompt: string;
  triangle: [[number, number], [number, number], [number, number]];
  apex: 0 | 1 | 2;
  who: string;
  onResult: (o: WidgetOutcome) => void;
}) {
  const tri = useMemo<[Pt, Pt, Pt]>(
    () => triangle.map(([x, y]) => ({ x, y })) as [Pt, Pt, Pt],
    [triangle]
  );
  const others = useMemo(() => ([0, 1, 2] as const).filter((i) => i !== apex) as [number, number], [apex]);
  const apexPt = tri[apex];
  const farD = tri[others[0]];
  const farE = tri[others[1]];
  const thirdA = tri[others[0]];
  const thirdB = tri[others[1]];

  const plane = useMemo(() => {
    const xs = tri.map((p) => p.x), ys = tri.map((p) => p.y);
    const pad = 1.5;
    return makePlane(
      [Math.min(...xs) - pad, Math.max(...xs) + pad],
      [Math.min(...ys) - pad, Math.max(...ys) + pad],
      W, H, 20
    );
  }, [tri]);

  const svgRef = useRef<SVGSVGElement>(null);
  // t ∈ [0,1] along apex→far for each of the two draggable points, starting
  // away from the midpoint so there is something to actually drag.
  const [tD, setTD] = useState(0.2);
  const [tE, setTE] = useState(0.8);
  const [active, setActive] = useState<"d" | "e">("d");
  const held = useRef<"d" | "e" | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);

  const STEP = 0.025;
  const snapT = (t: number) => clamp(Math.round(t / STEP) * STEP, 0, 1);
  const projectT = (from: Pt, to: Pt, p: Pt) => {
    const seg = sub(to, from);
    const L2 = len2(seg);
    if (L2 === 0) return 0;
    return snapT(dot(sub(p, from), seg) / L2);
  };

  const { dragging, surface } = useDragSurface({
    svgRef,
    toValue: (q) => ({ x: plane.ix(q.x), y: plane.iy(q.y) }),
    onMove: (v) => {
      if (verdict) return;
      const D = add(apexPt, scale(sub(farD, apexPt), tD));
      const E = add(apexPt, scale(sub(farE, apexPt), tE));
      let k = held.current;
      if (k === null) {
        k = len2(sub(v, D)) <= len2(sub(v, E)) ? "d" : "e";
        held.current = k;
        setActive(k);
      }
      if (k === "d") setTD(projectT(apexPt, farD, v));
      else setTE(projectT(apexPt, farE, v));
    },
    onCommit: () => { held.current = null; },
  });

  const D = add(apexPt, scale(sub(farD, apexPt), tD));
  const E = add(apexPt, scale(sub(farE, apexPt), tE));
  const deLen = dist(D, E);
  const bcLen = dist(thirdA, thirdB);
  const parallel = Math.abs(cross(sub(E, D), sub(thirdB, thirdA))) < 1e-6 * Math.max(1, bcLen * deLen);
  const half = Math.abs(deLen - bcLen / 2) < 1e-3 * Math.max(1, bcLen);

  const check = useCallback(() => {
    if (fired.current) return;
    const g = gradeMidsegment(tri, apex, D, E);
    fired.current = true;
    setVerdict(g.ok ? "correct" : "wrong");
    setNote(
      g.ok
        ? `Parallel to the third side and exactly half its length — the midpoint theorem.`
        : g.predicate === "midsegment-not-half"
          ? `Parallel, but ${fmt(deLen)} is not half of ${fmt(bcLen)}.`
          : `That segment is not parallel to the third side.`
    );
    onResult({
      correct: g.ok,
      predicate: g.ok ? OK : g.predicate,
      given: `DE=${fmt(deLen)}, BC=${fmt(bcLen)}`,
      detail: g.ok
        ? `✓ ${who} drew the midsegment on the polygon builder: DE=${fmt(deLen)} is half of BC=${fmt(bcLen)} and parallel to it`
        : `✗ ${who} drew DE=${fmt(deLen)} against BC=${fmt(bcLen)} on the polygon builder — ${g.predicate}`,
    });
  }, [tri, apex, D, E, deLen, bcLen, onResult, who]);

  const nudge = useKeyNudge({
    step: STEP,
    disabled: !!verdict,
    onNudge: (dx) => {
      if (verdict) return;
      if (active === "d") setTD((t) => clamp(snapT(t + dx), 0, 1));
      else setTE((t) => clamp(snapT(t + dx), 0, 1));
    },
    onCommit: check,
  });

  const ink = verdict === "correct" ? "var(--accent)" : "var(--gold)";

  return (
    <WidgetShell
      kind="polygon · midsegment"
      hint="drag the two points"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        verdict ? null : (
          <span className="inline-flex flex-wrap justify-center gap-x-3 gap-y-1">
            <span className="text-ink">DE = {fmt(deLen)}, BC = {fmt(bcLen)}</span>
            <Prop on={parallel}>parallel to BC</Prop>
            <Prop on={half}>half its length</Prop>
          </span>
        )
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={`mx-auto block w-full max-w-[320px] ${WIDGET_WELL} ${verdict ? "cursor-default" : "cursor-crosshair"}`}
        {...(verdict ? {} : surface)}
      >
        {/* the fixed triangle */}
        <polygon
          points={tri.map((p) => `${plane.sx(p.x)},${plane.sy(p.y)}`).join(" ")}
          fill="none" stroke="var(--ink-soft)" strokeWidth="1.6"
        />
        {tri.map((p, i) => (
          <text key={i} x={plane.sx(p.x) + (i === apex ? -10 : 6)} y={plane.sy(p.y) - 6}
                fontSize="10" fontStyle="italic" fill="var(--ink-soft)">
            {i === apex ? "A" : i === others[0] ? "B" : "C"}
          </text>
        ))}
        {/* the third side, highlighted for reference */}
        <line
          x1={plane.sx(thirdA.x)} y1={plane.sy(thirdA.y)}
          x2={plane.sx(thirdB.x)} y2={plane.sy(thirdB.y)}
          stroke="var(--ink-faint)" strokeWidth="3" strokeDasharray="1 4" strokeLinecap="round"
        />
        {/* the student's segment */}
        <line
          x1={plane.sx(D.x)} y1={plane.sy(D.y)} x2={plane.sx(E.x)} y2={plane.sy(E.y)}
          stroke={ink} strokeWidth="2.4" strokeLinecap="round"
        />
        <Handle
          cx={plane.sx(D.x)} cy={plane.sy(D.y)} color={ink} label="Point D on side AB"
          live={`${fmt(tD * 100)}% along`} dragging={dragging && active === "d"} locked={!!verdict}
          onKeyDown={(e) => { setActive("d"); nudge(e); }}
        />
        <Handle
          cx={plane.sx(E.x)} cy={plane.sy(E.y)} color={ink} label="Point E on side AC"
          live={`${fmt(tE * 100)}% along`} dragging={dragging && active === "e"} locked={!!verdict}
          onKeyDown={(e) => { setActive("e"); nudge(e); }}
        />
      </svg>

      {!verdict && (
        <div className={WIDGET_ACTIONS}>
          <button type="button" onClick={check} className={BUTTON_SECONDARY}>Check</button>
        </div>
      )}
    </WidgetShell>
  );
}

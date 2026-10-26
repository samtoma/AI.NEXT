"use client";

/**
 * {{widget:region_shader:{"prompt":"X = [−2, 3]. Shade the region that represents X × X.","x":[-2,3],"y":[-2,3]}}}
 *
 * The student MARKS a rectangle of the plane (Tamer 2026-10-21; a new kind,
 * Samuel's to accept — decision 11): drag two opposite corners onto the grid,
 * and set each edge INCLUDED (solid, ≤) or EXCLUDED (dashed, <) — the plane's
 * version of a number line's filled and hollow ends. The answer is X × Y for
 * two intervals, `x` and `y`, with `open` naming the excluded edges; graded by
 * region-shader-grade.ts. `grid` (grid.ts) sets the board, as for the other
 * plane widgets.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { makePlane, PlaneFrame } from "../../viz/plane";
import { BUTTON_SECONDARY, BUTTON_TERTIARY, cx } from "@/components/sticker";
import { OK, type WidgetOutcome } from "@/lib/widget-predicates";
import { Handle, WidgetShell, WIDGET_ACTIONS, WIDGET_WELL, FIGURE_MARK, type Verdict } from "./WidgetShell";
import { useDragSurface, useKeyNudge, type Pt } from "./drag";
import { numText } from "./format";
import { DEFAULT_GRID, snapToGrid, type Grid } from "./grid";
import { gradeRegion, regionText, type OpenEdges, type Region } from "./region-shader-grade";
import { FigureSvg } from "@/components/viz/figure-svg";

const W = 280;
const H = 280;
type Edge = keyof OpenEdges;
const EDGES: Edge[] = ["left", "right", "bottom", "top"];

export function RegionShader({
  prompt,
  x: tx,
  y: ty,
  open: topen,
  grid: g = DEFAULT_GRID,
  studentName,
  onResult,
}: {
  prompt: string;
  x: [number, number];
  y: [number, number];
  open?: Partial<OpenEdges>;
  grid?: Grid;
  studentName?: string;
  onResult: (outcome: WidgetOutcome) => void;
}) {
  const who = studentName?.trim() || "the student";
  const target: Region = useMemo(
    () => ({ x: tx, y: ty, open: { left: !!topen?.left, right: !!topen?.right, bottom: !!topen?.bottom, top: !!topen?.top } }),
    [tx, ty, topen]
  );
  const p = useMemo(() => makePlane(g.x, g.y, W, H, 20), [g.x, g.y]);
  const svgRef = useRef<SVGSVGElement>(null);
  // the corners open on a small rectangle that is not the answer
  const [pts, setPts] = useState<Pt[]>(() => {
    const at = (fx: number, fy: number): Pt => {
      const [x, y] = snapToGrid(g, g.x[0] + fx * (g.x[1] - g.x[0]), g.y[0] + fy * (g.y[1] - g.y[0]));
      return { x, y };
    };
    return [at(0.1, 0.55), at(0.35, 0.85)];
  });
  const [open, setOpen] = useState<OpenEdges>({ left: false, right: false, bottom: false, top: false });
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const held = useRef<number | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);

  const snap = useCallback((v: Pt): Pt => {
    const [x, y] = snapToGrid(g, v.x, v.y);
    return { x, y };
  }, [g]);
  const place = useCallback((i: number, v: Pt) => {
    setPts((cur) => {
      const other = cur[1 - i];
      // a rectangle needs width and height: a corner on the other's row or column is refused
      if (v.x === other.x || v.y === other.y) return cur;
      const next = [...cur];
      next[i] = v;
      return next;
    });
  }, []);

  const { dragging, surface } = useDragSurface({
    svgRef,
    toValue: (q) => ({ x: p.ix(q.x), y: p.iy(q.y) }),
    snap,
    onMove: (v) => {
      if (verdict) return;
      let i = held.current;
      if (i === null) {
        const d0 = Math.hypot((v.x - pts[0].x) / g.sx, (v.y - pts[0].y) / g.sy);
        const d1 = Math.hypot((v.x - pts[1].x) / g.sx, (v.y - pts[1].y) / g.sy);
        i = d1 < d0 ? 1 : 0;
        held.current = i;
        activeRef.current = i;
        setActive(i);
      }
      place(i, v);
    },
    onCommit: () => {
      held.current = null;
    },
  });

  const drawn: Region = {
    x: [Math.min(pts[0].x, pts[1].x), Math.max(pts[0].x, pts[1].x)],
    y: [Math.min(pts[0].y, pts[1].y), Math.max(pts[0].y, pts[1].y)],
    open,
  };

  const check = useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    const pred = gradeRegion(drawn, target);
    const ok = pred === OK;
    setVerdict(ok ? "correct" : "wrong");
    const mine = regionText(drawn, numText);
    const want = regionText(target, numText);
    setNote(
      ok ? `That is ${want}.`
      : pred === "edge-inclusion-wrong" ? `The right rectangle, ${want} — check which edges belong: a square bracket is a solid edge, a round one dashed.`
      : pred === "region-swapped" ? `You marked ${mine}: the two intervals are the wrong way round — the first runs along x, the second along y. The region is ${want}.`
      : `You marked ${mine}; the region is ${want}.`
    );
    onResult({
      correct: ok,
      predicate: pred,
      given: mine,
      detail: ok
        ? `✓ ${who} shaded ${want} correctly on the region shader`
        : `✗ ${who} shaded ${mine} on the region shader instead of ${want}${
            pred === "edge-inclusion-wrong" ? " — right corners, wrong edges included or excluded"
            : pred === "region-swapped" ? " — the two intervals exchanged (x and y)" : ""}`,
    });
  }, [drawn, target, onResult, who]);

  const nudge = useKeyNudge({
    step: 1,
    disabled: !!verdict,
    onNudge: (dx, dy) => {
      const i = activeRef.current;
      place(i, snap({ x: pts[i].x + dx * g.sx, y: pts[i].y + dy * g.sy }));
    },
    onCommit: check,
  });

  const rect = (r: Region) => ({ x: p.sx(r.x[0]), y: p.sy(r.y[1]), w: p.sx(r.x[1]) - p.sx(r.x[0]), h: p.sy(r.y[0]) - p.sy(r.y[1]) });
  const edgeLine = (r: Region, e: Edge) => {
    const [x0, x1] = [p.sx(r.x[0]), p.sx(r.x[1])];
    const [y0, y1] = [p.sy(r.y[0]), p.sy(r.y[1])];
    return e === "left" ? [x0, y0, x0, y1] : e === "right" ? [x1, y0, x1, y1] : e === "bottom" ? [x0, y0, x1, y0] : [x0, y1, x1, y1];
  };
  const ink = verdict === "correct" ? "var(--accent)" : "var(--gold)";
  const r = rect(drawn);
  const edgeName: Record<Edge, string> = {
    left: `x = ${numText(drawn.x[0])}`, right: `x = ${numText(drawn.x[1])}`,
    bottom: `y = ${numText(drawn.y[0])}`, top: `y = ${numText(drawn.y[1])}`,
  };

  return (
    <WidgetShell
      kind="region shader"
      hint="drag two corners · tap an edge"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={verdict ? null : <span className="text-ink">{regionText(drawn, numText)}</span>}
    >
      <FigureSvg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={cx("mx-auto block w-full max-w-[300px]", WIDGET_WELL, verdict ? "cursor-default" : "cursor-crosshair")}
        {...(verdict ? {} : surface)}
      >
        <PlaneFrame p={p} />
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={ink} opacity="0.18" />
        {EDGES.map((e) => {
          const [a, b, c, d] = edgeLine(drawn, e);
          return (
            <line key={e} x1={a} y1={b} x2={c} y2={d} stroke={ink} strokeWidth="2.2"
              strokeDasharray={open[e] ? "5 4" : undefined} strokeLinecap="round" />
          );
        })}
        {verdict === "wrong" && (() => {
          const t = rect(target);
          return (
            <g>
              <rect x={t.x} y={t.y} width={t.w} height={t.h} fill={FIGURE_MARK.correct} opacity="0.12" />
              {EDGES.map((e) => {
                const [a, b, c, d] = edgeLine(target, e);
                return (
                  <line key={`t${e}`} x1={a} y1={b} x2={c} y2={d} stroke={FIGURE_MARK.correct} strokeWidth="1.6"
                    strokeDasharray={target.open[e] ? "5 4" : undefined} />
                );
              })}
            </g>
          );
        })()}
        {pts.map((pt, i) => (
          <Handle
            key={i}
            cx={p.sx(pt.x)}
            cy={p.sy(pt.y)}
            color={ink}
            label={`Corner ${i + 1}`}
            live={`${numText(pt.x)}, ${numText(pt.y)}`}
            dragging={dragging && active === i}
            locked={!!verdict}
            onKeyDown={(e) => {
              activeRef.current = i;
              setActive(i);
              nudge(e);
            }}
          />
        ))}
      </FigureSvg>

      {/* each edge: included (solid, ≤) or excluded (dashed, <) */}
      <div className={WIDGET_ACTIONS}>
        {EDGES.map((e) => (
          <button
            key={e}
            type="button"
            disabled={!!verdict}
            aria-pressed={!open[e]}
            onClick={() => setOpen((o) => ({ ...o, [e]: !o[e] }))}
            className={open[e] ? BUTTON_TERTIARY : BUTTON_SECONDARY}
          >
            {edgeName[e]}: {open[e] ? "excluded" : "included"}
          </button>
        ))}
      </div>
      {!verdict && (
        <div className={WIDGET_ACTIONS}>
          <button type="button" onClick={check} className={BUTTON_SECONDARY}>
            That&apos;s my region
          </button>
        </div>
      )}
    </WidgetShell>
  );
}

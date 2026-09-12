"use client";

/**
 * The interaction primitive the drawing widgets are built on.
 *
 * WHY THIS EXISTS. Before it, the one interactive gesture in the product was
 * PairPlotter's click handler, which mapped screen pixels to lattice points
 * with `getBoundingClientRect()` ratio arithmetic. That works for a click on a
 * mouse-driven page and fails everywhere else that matters here:
 *
 *   · it is CLICK-ONLY, so nothing can be dragged, and "draw" is a drag;
 *   · a finger scrolls the page instead of moving the handle, and iPad Safari
 *     is the device target (constitution, device target);
 *   · it goes wrong the moment an SVG is letterboxed by `preserveAspectRatio`,
 *     because the rect is the ELEMENT's box, not the viewBox's;
 *   · it leaves the keyboard with nothing to do, so the widget is unusable
 *     without a pointer at all.
 *
 * Every one of those is solved once here rather than nine times badly:
 * `getScreenCTM().inverse()` is the browser's own answer to "where in user
 * space is this pointer", pointer capture keeps a drag alive when the finger
 * leaves the glyph, `touch-action: none` stops the scroll, and each handle is
 * a real tab stop the arrow keys move.
 *
 * Snapping is the caller's business. A coordinate grid snaps to the lattice,
 * an angle snaps to 15°, a bar snaps to whole units, and a freehand sketch
 * snaps to nothing at all — so `snap` is a function in, not a flag.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export interface Pt {
  x: number;
  y: number;
}

/** Clamp helper — every widget needs it, none should re-type it. */
export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/** Round to a multiple of `step` (0 or less = no rounding). */
export const snapTo = (v: number, step: number) =>
  step > 0 ? Math.round(v / step) * step : v;

/** Kill floating-point lint like 2.9999999999996 before it reaches a label. */
export const tidy = (v: number, dp = 4) => Math.round(v * 10 ** dp) / 10 ** dp;

/**
 * Pointer position in the SVG's OWN user-space units.
 *
 * `getScreenCTM()` is the live matrix the browser used to paint, so it already
 * accounts for viewBox scaling, letterboxing, CSS transforms and page zoom.
 * Inverting it is exact where rect-ratio arithmetic is merely usually right.
 */
export function svgPoint(
  svg: SVGSVGElement | null,
  ev: { clientX: number; clientY: number }
): Pt | null {
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const p = svg.createSVGPoint();
  p.x = ev.clientX;
  p.y = ev.clientY;
  const local = p.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

export interface DragSurfaceOptions {
  svgRef: RefObject<SVGSVGElement | null>;
  /** SVG user-space → the widget's own coordinates (usually plane.ix/iy). */
  toValue: (p: Pt) => Pt;
  /** Constrain / snap / reject. Returning null rejects the position. */
  snap?: (p: Pt) => Pt | null;
  /** Fires continuously while dragging. */
  onMove: (p: Pt) => void;
  /** Fires once when the pointer is released (the "that's my answer" moment). */
  onCommit?: (p: Pt) => void;
  disabled?: boolean;
}

/**
 * Drag anywhere on the surface. Spread `surface` onto the <svg>.
 *
 * A press is treated as a move too, so tapping a spot is the zero-length drag
 * to it — which is exactly what a student expects and what keeps this a strict
 * superset of the old click behaviour.
 */
export function useDragSurface(opts: DragSurfaceOptions) {
  const { svgRef, toValue, snap, onMove, onCommit, disabled } = opts;
  const [dragging, setDragging] = useState(false);
  // Read through refs inside handlers so a re-render mid-drag cannot leave the
  // pointer talking to a stale closure.
  const live = useRef({ toValue, snap, onMove, onCommit, disabled });
  live.current = { toValue, snap, onMove, onCommit, disabled };

  const resolve = useCallback(
    (ev: { clientX: number; clientY: number }): Pt | null => {
      const raw = svgPoint(svgRef.current, ev);
      if (!raw) return null;
      const v = live.current.toValue(raw);
      return live.current.snap ? live.current.snap(v) : v;
    },
    [svgRef]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (live.current.disabled) return;
      const v = resolve(e);
      if (!v) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDragging(true);
      live.current.onMove(v);
    },
    [resolve]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragging || live.current.disabled) return;
      const v = resolve(e);
      if (v) live.current.onMove(v);
    },
    [dragging, resolve]
  );

  const end = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragging) return;
      setDragging(false);
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      const v = resolve(e);
      if (v) live.current.onCommit?.(v);
    },
    [dragging, resolve]
  );

  return {
    dragging,
    surface: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      // Without this a finger pans the page and the handle never moves.
      style: { touchAction: "none" as const },
    },
  };
}

/**
 * Freehand stroke capture — the widget that is literally "draw".
 *
 * Points are thinned on the way in: a raw pointer stream is 100+ samples a
 * second and a sketch needs maybe fifty, so anything closer than `minGap` to
 * the previous sample is dropped. That keeps the path cheap to render and,
 * more to the point, keeps scoring it honest — an unthinned stroke weights
 * whichever part of the curve the student drew SLOWLY.
 */
export function useStroke(opts: {
  svgRef: RefObject<SVGSVGElement | null>;
  toValue: (p: Pt) => Pt;
  minGap?: number;
  onDone: (stroke: Pt[]) => void;
  disabled?: boolean;
}) {
  const { svgRef, toValue, minGap = 3, onDone, disabled } = opts;
  const [stroke, setStroke] = useState<Pt[]>([]);
  const [drawing, setDrawing] = useState(false);
  const lastRaw = useRef<Pt | null>(null);
  const live = useRef({ toValue, onDone, disabled, minGap });
  live.current = { toValue, onDone, disabled, minGap };

  const push = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const raw = svgPoint(svgRef.current, e);
      if (!raw) return;
      const prev = lastRaw.current;
      if (prev) {
        const d = Math.hypot(raw.x - prev.x, raw.y - prev.y);
        if (d < live.current.minGap) return;
      }
      lastRaw.current = raw;
      setStroke((s) => [...s, live.current.toValue(raw)]);
    },
    [svgRef]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (live.current.disabled) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      lastRaw.current = null;
      setStroke([]);
      setDrawing(true);
      push(e);
    },
    [push]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!drawing || live.current.disabled) return;
      push(e);
    },
    [drawing, push]
  );

  const end = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!drawing) return;
      setDrawing(false);
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      setStroke((s) => {
        // A stray tap is not a sketch. Below this it is discarded rather than
        // scored, so a mis-touch never counts as a wrong answer.
        if (s.length >= 4) live.current.onDone(s);
        return s;
      });
    },
    [drawing]
  );

  const reset = useCallback(() => {
    lastRaw.current = null;
    setStroke([]);
  }, []);

  return {
    stroke,
    drawing,
    reset,
    surface: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      style: { touchAction: "none" as const },
    },
  };
}

/**
 * Arrow-key control for one handle.
 *
 * Not a courtesy: a drag-only widget is unusable without a pointer, and this
 * is also the only way to place a handle EXACTLY on a value when the target
 * is a few screen pixels wide. Shift takes a coarse step, so crossing a wide
 * plane is not forty presses.
 */
export function useKeyNudge(opts: {
  step: number;
  onNudge: (dx: number, dy: number) => void;
  onCommit?: () => void;
  disabled?: boolean;
}) {
  const { step, onNudge, onCommit, disabled } = opts;
  return useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      const k = e.key;
      const s = e.shiftKey ? step * 5 : step;
      let dx = 0;
      let dy = 0;
      if (k === "ArrowLeft") dx = -s;
      else if (k === "ArrowRight") dx = s;
      else if (k === "ArrowUp") dy = s;
      else if (k === "ArrowDown") dy = -s;
      else if (k === "Enter" || k === " ") {
        if (!onCommit) return;
        e.preventDefault();
        onCommit();
        return;
      } else return;
      e.preventDefault();
      onNudge(dx, dy);
    },
    [step, onNudge, onCommit, disabled]
  );
}

/**
 * Respect the OS "reduce motion" setting.
 *
 * The viz renderers have their own copy of this against the animation
 * timeline; the widgets need it for the settle/pulse transitions, and
 * importing across the two component families to save nine lines would tie
 * the interactive layer to the display layer's render loop.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  COL_GAP,
  OBJECTIVE_R,
  LESSON_R,
  fitView,
  focusOf,
  lessonStage,
  lessonsStarted,
  linkDestinationLabel,
  linkStyle,
  objectiveStage,
  viewFor,
  zoomLevel,
  type MapChapter,
  type Selection,
  type SkillMapModel,
  type Stage,
  type View,
} from "@/lib/skill-map";
import { MASTERY_LEGEND, masteryPhrase } from "@/lib/mastery";
import { declutter, labelCandidates, type Rect } from "@/lib/skill-map-labels";
import { STROKE, cx } from "@/components/sticker";

/**
 * The Your Progress Map canvas (FR-3224) — semantic zoom over the model built
 * by `lib/skill-map.ts`.
 *
 * EVERYTHING IS DRAWN IN SCREEN PIXELS. The view is `screen = world × scale +
 * t`, applied here to every position; radii are floored in screen px and every
 * stroke, arrowhead, shadow and label size is a constant screen value. That is
 * the Play rule "these values never scale" — a transform on a world-space group
 * would make outlines cartoonish when zoomed in and invisible when zoomed out.
 *
 * Selection is owned by the page (`SpineExplorer`): it drives the breadcrumb,
 * the topic panel and what the chat is told. This component animates to the
 * view a selection asks for (`viewFor`) whenever the selection changes, and
 * reports taps and "step up" back to the page.
 */

const EASE_MS = 560;
/** cubic-bezier(.3,.7,.2,1) — the map's zoom easing (handoff §9) */
function ease(t: number): number {
  const [x1, y1, x2, y2] = [0.3, 0.7, 0.2, 1];
  // solve x(u) = t by bisection, then return y(u)
  let lo = 0;
  let hi = 1;
  let u = t;
  for (let i = 0; i < 24; i++) {
    u = (lo + hi) / 2;
    const x = 3 * (1 - u) ** 2 * u * x1 + 3 * (1 - u) * u ** 2 * x2 + u ** 3;
    if (x < t) lo = u;
    else hi = u;
  }
  return 3 * (1 - u) ** 2 * u * y1 + 3 * (1 - u) * u ** 2 * y2 + u ** 3;
}

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const fill = (s: Stage) => MASTERY_LEGEND[s]!.color;
/** Every objective box is this wide; lesson names are LESSON_LABEL_W. */
const OBJECTIVE_BOX_W = 170;
const LESSON_LABEL_W = 118;

/** Text width in px for a CSS font, from one shared offscreen canvas; a
 *  character-count estimate where there is no canvas (server render). */
let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureText(text: string, font: string): number {
  if (measureCtx === undefined) {
    measureCtx =
      typeof document !== "undefined"
        ? document.createElement("canvas").getContext("2d")
        : null;
  }
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** Lines a text wraps to at a width — word by word, as the browser wraps. */
function linesFor(text: string, font: string, width: number): number {
  let lines = 1;
  let line = 0;
  const space = measureText(" ", font);
  for (const word of text.split(/\s+/)) {
    const w = measureText(word, font);
    if (line > 0 && line + space + w > width) {
      lines += 1;
      line = w;
    } else {
      line += (line > 0 ? space : 0) + w;
    }
  }
  return lines;
}

/** A quadratic curve from a to b, its ends pulled in by ra/rb, and an arrowhead at b. */
function curve(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ra: number,
  rb: number,
  bend: number,
  towardX: number,
  towardY: number,
  away: boolean,
) {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let nx = -(by - ay) / len;
  let ny = (bx - ax) / len;
  const toward = (towardX - mx) * nx + (towardY - my) * ny;
  if (toward < 0 !== away) {
    nx = -nx;
    ny = -ny;
  }
  const cxp = mx + nx * bend * len;
  const cyp = my + ny * bend * len;
  const pull = (px: number, py: number, r: number) => {
    const d = Math.hypot(cxp - px, cyp - py) || 1;
    return [px + ((cxp - px) / d) * r, py + ((cyp - py) / d) * r] as const;
  };
  const [sx, sy] = pull(ax, ay, ra);
  const [ex, ey] = pull(bx, by, rb + 2);
  const ud = Math.hypot(ex - cxp, ey - cyp) || 1;
  const ux = (ex - cxp) / ud;
  const uy = (ey - cyp) / ud;
  const head = 9;
  const baseX = ex - ux * head;
  const baseY = ey - uy * head;
  const arrow = `M${ex},${ey} L${baseX - uy * 4.5},${baseY + ux * 4.5} L${baseX + uy * 4.5},${baseY - ux * 4.5} Z`;
  // the line stops at the arrow's base so the head is not hidden under it
  return { d: `M${sx},${sy} Q${cxp},${cyp} ${baseX},${baseY}`, arrow };
}

export function SkillMap({
  model,
  asOf,
  selection,
  onSelect,
  onStepUp,
  onLevel,
  pulses,
}: {
  model: SkillMapModel;
  asOf: "today" | "baseline";
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** tap on empty space, or Esc */
  onStepUp: () => void;
  onLevel?: (level: 0 | 1 | 2) => void;
  /** objective id → nonce; a new nonce rings that objective once (Noor cited it) */
  pulses: Record<string, number>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const viewRef = useRef<View | null>(null);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);
  const [grabbing, setGrabbing] = useState(false);
  const userMoved = useRef(false);
  const anim = useRef<number | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  /** the node under the pointer — named in a tooltip if it has no label */
  const [hovered, setHovered] = useState<string | null>(null);

  /* ------------------------------------------------------ size + fit -- */
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0)
        setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    // Measure now as well: a ResizeObserver does not deliver while the page
    // is not being painted (a background tab), and the map would sit blank
    // until it is.
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(
    () => (size ? fitView(model, size.w, size.h) : null),
    [model, size],
  );

  const animateTo = useCallback((target: View) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const from = viewRef.current;
    const box = boxRef.current;
    if (!from || !box || reducedMotion()) {
      viewRef.current = target;
      setView(target);
      return;
    }
    const w = box.clientWidth;
    const h = box.clientHeight;
    // interpolate the world point at the centre, and the scale in log space,
    // so a zoom reads as moving towards a place rather than sliding sideways
    const cFrom = {
      x: (w / 2 - from.tx) / from.scale,
      y: (h / 2 - from.ty) / from.scale,
    };
    const cTo = {
      x: (w / 2 - target.tx) / target.scale,
      y: (h / 2 - target.ty) / target.scale,
    };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / EASE_MS);
      const k = ease(t);
      const scale = Math.exp(
        Math.log(from.scale) +
          (Math.log(target.scale) - Math.log(from.scale)) * k,
      );
      const x = cFrom.x + (cTo.x - cFrom.x) * k;
      const y = cFrom.y + (cTo.y - cFrom.y) * k;
      setView({ scale, tx: w / 2 - x * scale, ty: h / 2 - y * scale });
      anim.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  useEffect(
    () => () => {
      if (anim.current) cancelAnimationFrame(anim.current);
    },
    [],
  );

  // The selection decides the view. First paint and resizes re-fit until the
  // student has panned or zoomed themselves (handoff §6).
  const selKey = JSON.stringify(selection);
  const lastSelKey = useRef<string | null>(null);
  useEffect(() => {
    if (!size || !fit) return;
    const changed = lastSelKey.current !== selKey;
    lastSelKey.current = selKey;
    if (!viewRef.current) {
      setView(viewFor(model, selection, size.w, size.h));
      return;
    }
    if (changed) {
      userMoved.current = false;
      animateTo(viewFor(model, selection, size.w, size.h));
    } else if (!userMoved.current) {
      setView(viewFor(model, selection, size.w, size.h));
    }
    // `selection` is read through selKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, size, fit, model, animateTo]);

  const level = view && fit ? zoomLevel(view.scale, fit.scale) : 0;
  useEffect(() => {
    onLevel?.(level);
  }, [level, onLevel]);

  /* --------------------------------------------------- pan / zoom ----- */
  const clampScale = useCallback(
    (s: number) => Math.min(3, Math.max((fit?.scale ?? 0.05) * 0.6, s)),
    [fit],
  );
  const zoomAround = useCallback(
    (factor: number, px: number, py: number, animate = false) => {
      const v = viewRef.current;
      if (!v) return;
      const scale = clampScale(v.scale * factor);
      const wx = (px - v.tx) / v.scale;
      const wy = (py - v.ty) / v.scale;
      const next = { scale, tx: px - wx * scale, ty: py - wy * scale };
      userMoved.current = true;
      if (animate) animateTo(next);
      else setView(next);
    },
    [clampScale, animateTo],
  );

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAround(
        Math.exp(-e.deltaY * 0.0015),
        e.clientX - r.left,
        e.clientY - r.top,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAround]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{
    x: number;
    y: number;
    v: View;
    moved: boolean;
    pinch?: number;
  } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    const v = viewRef.current;
    if (!v) return;
    if (anim.current) {
      cancelAnimationFrame(anim.current);
      anim.current = null;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    suppressClick.current = false;
    if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, v, moved: false };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = {
        x: 0,
        y: 0,
        v,
        moved: true,
        pinch: Math.hypot(a!.x - b!.x, a!.y - b!.y),
      };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !drag.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (pointers.current.size >= 2 && d.pinch) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const r = boxRef.current!.getBoundingClientRect();
      const mx = (a!.x + b!.x) / 2 - r.left;
      const my = (a!.y + b!.y) / 2 - r.top;
      const scale = clampScale(d.v.scale * (dist / d.pinch));
      const wx = (mx - d.v.tx) / d.v.scale;
      const wy = (my - d.v.ty) / d.v.scale;
      userMoved.current = true;
      suppressClick.current = true;
      setView({ scale, tx: mx - wx * scale, ty: my - wy * scale });
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) {
      d.moved = true;
      setGrabbing(true);
      // only now take the pointer: capturing on pointerdown would retarget
      // the click away from the node that was tapped
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    userMoved.current = true;
    suppressClick.current = true;
    setView({ scale: d.v.scale, tx: d.v.tx + dx, ty: d.v.ty + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      drag.current = null;
      setGrabbing(false);
    }
  };

  /** A tap on a node: select it, unless this "click" ended a drag. */
  const tap = useCallback(
    (s: Selection, e: React.MouseEvent) => {
      e.stopPropagation();
      if (suppressClick.current) return;
      onSelect(s);
    },
    [onSelect],
  );
  const onTitleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const id = e.currentTarget.dataset.chapter;
      if (id) tap({ kind: "chapter", id }, e);
    },
    [tap],
  );
  const onBoxClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const id = e.currentTarget.dataset.objective;
      if (id) tap({ kind: "objective", id }, e);
    },
    [tap],
  );
  const key = (s: Selection, e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onSelect(s);
    }
  };

  const zoomBy = (factor: number) => {
    const box = boxRef.current;
    if (box)
      zoomAround(factor, box.clientWidth / 2, box.clientHeight / 2, true);
  };
  const fitAll = () => {
    userMoved.current = false;
    onSelect(null);
    if (size) animateTo(fitView(model, size.w, size.h));
  };

  /* --------------------------------------------------------- render -- */
  const focus = useMemo(() => focusOf(model, selection), [model, selection]);
  const centre = useMemo(
    () => ({
      x: (model.bounds.minX + model.bounds.maxX) / 2,
      y: (model.bounds.minY + model.bounds.maxY) / 2,
    }),
    [model],
  );

  const v = view;
  const S = (x: number, y: number) =>
    (v ? [x * v.scale + v.tx, y * v.scale + v.ty] : [0, 0]) as [number, number];
  const lr = v ? Math.max(LESSON_R * v.scale, 10) : 10;
  const or = v ? Math.max(OBJECTIVE_R * v.scale, 6) : 6;

  const selectedChapter = selection?.kind === "chapter" ? selection.id : null;
  const selectedLesson = selection?.kind === "lesson" ? selection.slug : null;
  const selectedObjective =
    selection?.kind === "objective" ? selection.id : null;

  const chapterFaded = (c: MapChapter) => !!focus && !focus.chapters.has(c.id);
  const lessonFaded = (slug: string) => !!focus && !focus.lessons.has(slug);
  const objectiveFaded = (id: string) =>
    !!focus && !focus.own.has(id) && !focus.linked.has(id);

  /* ------------------------------------------------- label placement -- */
  // Every candidate label gets a measured rectangle in screen px; `declutter`
  // keeps the important ones and drops what would overlap.
  const chapterTitleW = v
    ? Math.min(
        260,
        Math.max(
          88,
          Math.min(
            ...model.chapters.map((c) => (2 * c.discR + COL_GAP) * v.scale),
          ) - 12,
        ),
      )
    : 160;
  const labels: {
    key: string;
    kind: "chapter" | "lesson" | "objective";
    id: string;
    priority: number;
    rect: Rect;
  }[] = [];
  if (v && size) {
    for (const pick of labelCandidates(model, selection, level)) {
      if (pick.kind === "chapter") {
        const c = model.chapterById.get(pick.id)!;
        const [x, y] = S(c.cx, c.cy - c.discR);
        // One width for every chapter title (Tamer, 2026-10-01): the
        // narrowest chapter's column, so all match and none can reach into
        // a neighbour's. At most two lines; the rest is in the tooltip.
        const w = chapterTitleW;
        const lines = Math.min(2, linesFor(c.title, "800 15px 'Baloo 2'", w));
        const h = lines * 16.5 + 17;
        labels.push({
          key: `t-${c.id}`,
          kind: "chapter",
          id: c.id,
          priority: pick.priority,
          rect: { x: x - w / 2, y: y - 8 - h, w, h },
        });
      } else if (pick.kind === "lesson") {
        const l = model.lessonBySlug.get(pick.id)!;
        const [x, y] = S(l.x, l.y);
        const w = LESSON_LABEL_W;
        const h = linesFor(l.title, "800 13px 'Baloo 2'", w) * 15 + 13;
        const above = l.index % 2 === 0;
        const r = lr * (selectedLesson === l.slug ? 1.25 : 1);
        const top = above ? y - r - 6 - h : y + r + 6;
        labels.push({
          key: `ln-${l.slug}`,
          kind: "lesson",
          id: l.slug,
          priority: pick.priority,
          rect: { x: x - w / 2, y: top, w, h },
        });
      } else {
        const o = model.objectiveById.get(pick.id)!;
        const [x, y] = S(o.x, o.y);
        const cos = Math.cos(o.angle);
        const sin = Math.sin(o.angle);
        const gap = or + 8;
        const ax = x + cos * gap;
        const ay = y + sin * gap;
        // One width for every box, so they read as a set (Tamer, 2026-10-01).
        const w = OBJECTIVE_BOX_W;
        const all = linesFor(o.label, "700 12.5px 'Baloo 2'", w - 26);
        const lines = selectedObjective === o.id ? all : Math.min(2, all);
        const dest = linkDestinationLabel(model, o.id);
        const h = 13 + lines * 15.3 + 14 + (dest ? 14 : 0) + 4;
        const fx = cos > 0.35 ? 0 : cos < -0.35 ? -1 : -0.5;
        const fy = sin > 0.35 ? 0 : sin < -0.35 ? -1 : -0.5;
        labels.push({
          key: `ob-${o.id}`,
          kind: "objective",
          id: o.id,
          priority: pick.priority,
          rect: { x: ax + fx * w, y: ay + fy * h, w, h },
        });
      }
    }
  }
  const kept = v && size ? declutter(labels, size) : new Set<string>();

  // The tooltip names a hovered or focused node that has no label showing.
  const tipId = hovered ?? focused;
  let tooltip: { x: number; y: number; title: string; word: string } | null =
    null;
  if (v && tipId) {
    if (tipId.startsWith("lesson:")) {
      const slug = tipId.slice(7);
      const l = model.lessonBySlug.get(slug);
      if (l && !kept.has(`ln-${slug}`)) {
        const [x, y] = S(l.x, l.y);
        tooltip = {
          x,
          y: y - lr - 8,
          title: l.title,
          word: masteryPhrase(lessonStage(model, slug, asOf)),
        };
      }
    } else if (tipId.startsWith("obj:")) {
      const id = tipId.slice(4);
      const o = model.objectiveById.get(id);
      if (o && !kept.has(`ob-${id}`)) {
        const [x, y] = S(o.x, o.y);
        tooltip = {
          x,
          y: y - or - 8,
          title: o.label,
          word: masteryPhrase(objectiveStage(o, asOf)),
        };
      }
    } else if (tipId.startsWith("chapter:")) {
      const id = tipId.slice(8);
      const c = model.chapterById.get(id);
      if (c && !kept.has(`t-${id}`)) {
        const [x, y] = S(c.cx, c.cy - c.discR);
        const { started, total } = lessonsStarted(model, id, asOf);
        tooltip = {
          x,
          y: y - 8,
          title: c.title,
          word: `${started} of ${total} lessons started`,
        };
      }
    }
  }

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      role="application"
      aria-label="Your progress map. Tab to a chapter, lesson or objective; Enter opens it; Escape steps back; plus and minus zoom."
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onStepUp();
        } else if (e.key === "+" || e.key === "=") {
          zoomBy(1.4);
        } else if (e.key === "-") {
          zoomBy(1 / 1.4);
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={() => {
        if (suppressClick.current) return;
        onStepUp();
      }}
      className="relative h-full w-full select-none overflow-hidden bg-card outline-none"
      style={{ touchAction: "none", cursor: grabbing ? "grabbing" : "grab" }}
    >
      {v && (
        <svg
          width="100%"
          height="100%"
          className="absolute inset-0 block"
          aria-hidden={false}
        >
          {/* honey discs — flat; outlined with a hard shadow only when selected */}
          {model.chapters.map((c) => {
            const [x, y] = S(c.cx, c.cy);
            const r = c.discR * v.scale;
            const sel = selectedChapter === c.id;
            return (
              <g
                key={c.id}
                className="skillmap-fade"
                opacity={chapterFaded(c) ? 0.55 : 1}
                onClick={(e) => tap({ kind: "chapter", id: c.id }, e)}
                style={{ cursor: "pointer" }}
              >
                {sel && (
                  <circle cx={x + 5} cy={y + 5} r={r} fill="var(--ink)" />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill="var(--card-warm)"
                  stroke={
                    focused === `chapter:${c.id}`
                      ? "var(--noor-action)"
                      : sel
                        ? "var(--ink)"
                        : "none"
                  }
                  strokeWidth={sel || focused === `chapter:${c.id}` ? 3 : 0}
                  role="button"
                  tabIndex={0}
                  aria-label={`Chapter: ${c.title} — ${lessonsStarted(model, c.id, asOf).started} of ${lessonsStarted(model, c.id, asOf).total} lessons started`}
                  onKeyDown={(e) => key({ kind: "chapter", id: c.id }, e)}
                  onFocus={() => setFocused(`chapter:${c.id}`)}
                  onBlur={() =>
                    setFocused((f) => (f === `chapter:${c.id}` ? null : f))
                  }
                  onPointerEnter={() => setHovered(`chapter:${c.id}`)}
                  onPointerLeave={() =>
                    setHovered((h) => (h === `chapter:${c.id}` ? null : h))
                  }
                />
              </g>
            );
          })}

          {/* spokes: lesson → its objectives */}
          {[...model.lessonBySlug.values()].map((l) => {
            const [lx, ly] = S(l.x, l.y);
            return (
              <g
                key={`sp-${l.slug}`}
                className="skillmap-fade"
                opacity={lessonFaded(l.slug) ? 0.25 : 1}
              >
                {l.objectives.map((id) => {
                  const o = model.objectiveById.get(id)!;
                  const [ox, oy] = S(o.x, o.y);
                  return (
                    <line
                      key={id}
                      x1={lx}
                      y1={ly}
                      x2={ox}
                      y2={oy}
                      stroke="var(--play-disabled-border)"
                      strokeWidth={1.5}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* objective → objective links — the only lines, at every zoom
              level (Tamer, 2026-10-01): prerequisites are defined between
              objectives, and a lesson arrow would only restate them. */}
          {model.links.map((link) => {
            const style = linkStyle(link, focus);
            if (style === "hidden") return null;
            const a = model.objectiveById.get(link.a)!;
            const b = model.objectiveById.get(link.b)!;
            const [ax, ay] = S(a.x, a.y);
            const [bx, by] = S(b.x, b.y);
            const ch = model.chapterById.get(a.chapterId)!;
            const toward = link.across
              ? S(centre.x, centre.y)
              : S(ch.cx, ch.cy);
            const c = curve(
              ax,
              ay,
              bx,
              by,
              or,
              or,
              link.across ? 0.18 : 0.22,
              toward[0],
              toward[1],
              link.across,
            );
            const opacity =
              style === "faint" ? 0.06 : style === "normal" ? 0.4 : 1;
            const width = style === "strong" ? 2.6 : 1.7;
            return (
              <g
                key={`lk-${link.a}-${link.b}`}
                className="skillmap-fade"
                opacity={opacity}
              >
                <path
                  d={c.d}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth={width}
                  strokeDasharray={link.across ? "6 5" : undefined}
                />
                <path d={c.arrow} fill="var(--ink)" />
              </g>
            );
          })}

          {/* lesson nodes */}
          {[...model.lessonBySlug.values()].map((l) => {
            const [x, y] = S(l.x, l.y);
            const stage = lessonStage(model, l.slug, asOf);
            const sel = selectedLesson === l.slug;
            const id = `lesson:${l.slug}`;
            return (
              <g
                key={l.slug}
                className="skillmap-fade"
                opacity={lessonFaded(l.slug) ? 0.22 : 1}
              >
                <circle
                  className="skillmap-node"
                  data-selected={sel ? "lesson" : undefined}
                  cx={x}
                  cy={y}
                  r={lr}
                  // Selection is the ring and the pop, never a change of
                  // colour: the fill is the student's mastery, and it must
                  // read the same selected or not (Tamer, 2026-10-01).
                  fill={fill(stage)}
                  stroke="var(--ink)"
                  strokeWidth={sel ? 3.5 : 2.5}
                  role="button"
                  tabIndex={level >= 1 ? 0 : -1}
                  aria-label={`Lesson: ${l.title} — ${masteryPhrase(stage)}`}
                  onClick={(e) => tap({ kind: "lesson", slug: l.slug }, e)}
                  onKeyDown={(e) => key({ kind: "lesson", slug: l.slug }, e)}
                  onFocus={() => setFocused(id)}
                  onBlur={() => setFocused((f) => (f === id ? null : f))}
                  onPointerEnter={() => setHovered(id)}
                  onPointerLeave={() =>
                    setHovered((h) => (h === id ? null : h))
                  }
                />
                {(sel || focused === id) && (
                  <circle
                    cx={x}
                    cy={y}
                    r={lr * (sel ? 1.25 : 1) + 6}
                    fill="none"
                    stroke={
                      focused === id ? "var(--noor-action)" : "var(--ink)"
                    }
                    strokeWidth={focused === id ? 3 : 2.5}
                    pointerEvents="none"
                  />
                )}
              </g>
            );
          })}

          {/* objective nodes */}
          {[...model.objectiveById.values()].map((o) => {
            const [x, y] = S(o.x, o.y);
            const stage = objectiveStage(o, asOf);
            const sel = selectedObjective === o.id;
            const id = `obj:${o.id}`;
            return (
              <g
                key={o.id}
                className="skillmap-fade"
                opacity={objectiveFaded(o.id) ? 0.25 : 1}
              >
                {pulses[o.id] != null && (
                  <circle
                    key={pulses[o.id]}
                    className="skillmap-pulse"
                    cx={x}
                    cy={y}
                    r={or + 4}
                    fill="none"
                    stroke="var(--noor-action)"
                    strokeWidth={3}
                  />
                )}
                <circle
                  className="skillmap-node"
                  data-selected={sel ? "objective" : undefined}
                  cx={x}
                  cy={y}
                  r={or}
                  fill={fill(stage)}
                  stroke="var(--ink)"
                  strokeWidth={sel ? 3 : 2}
                  role="button"
                  tabIndex={level >= 2 ? 0 : -1}
                  aria-label={`${o.label} — ${masteryPhrase(stage)}`}
                  onClick={(e) => tap({ kind: "objective", id: o.id }, e)}
                  onKeyDown={(e) => key({ kind: "objective", id: o.id }, e)}
                  onFocus={() => setFocused(id)}
                  onBlur={() => setFocused((f) => (f === id ? null : f))}
                  onPointerEnter={() => setHovered(id)}
                  onPointerLeave={() =>
                    setHovered((h) => (h === id ? null : h))
                  }
                />
                {(sel || focused === id) && (
                  <circle
                    cx={x}
                    cy={y}
                    r={or * (sel ? 1.4 : 1) + 6}
                    fill="none"
                    stroke={
                      focused === id ? "var(--noor-action)" : "var(--ink)"
                    }
                    strokeWidth={focused === id ? 3 : 2}
                    pointerEvents="none"
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}

      {/* Labels: only those the selection and level allow, measured and
          placed most-important-first, with anything that would overlap a
          kept label dropped (lib/skill-map-labels.ts). */}
      {v &&
        labels
          .filter((l) => kept.has(l.key))
          .map((l) => {
            if (l.kind === "chapter") {
              const c = model.chapterById.get(l.id)!;
              const { started, total } = lessonsStarted(model, c.id, asOf);
              return (
                <button
                  key={l.key}
                  type="button"
                  data-chapter={c.id}
                  onClick={onTitleClick}
                  onPointerDown={(e) => e.stopPropagation()}
                  tabIndex={-1}
                  aria-hidden
                  className="skillmap-fade absolute flex flex-col items-center text-center"
                  style={{
                    left: l.rect.x,
                    top: l.rect.y,
                    width: l.rect.w,
                    opacity: chapterFaded(c) ? 0.5 : 1,
                  }}
                >
                  <span
                    className="line-clamp-2 font-display text-[15px] font-extrabold leading-[1.1] text-ink text-balance"
                    title={c.title}
                  >
                    {c.title}
                  </span>
                  <span className="mt-0.5 font-display text-[12px] font-bold leading-[1.15] text-ink-soft">
                    {c.unitRef ? `${c.unitRef} · ` : ""}
                    {started} of {total} lessons started
                  </span>
                </button>
              );
            }
            if (l.kind === "lesson") {
              const lesson = model.lessonBySlug.get(l.id)!;
              const stage = lessonStage(model, l.id, asOf);
              return (
                <div
                  key={l.key}
                  className="skillmap-fade pointer-events-none absolute flex flex-col items-center text-center"
                  style={{
                    left: l.rect.x,
                    top: l.rect.y,
                    width: l.rect.w,
                    opacity: lessonFaded(l.id) ? 0.22 : 1,
                    textShadow:
                      "0 0 3px var(--card), 0 0 3px var(--card), 0 0 4px var(--card), 0 0 4px var(--card)",
                  }}
                >
                  <span className="font-display text-[13px] font-extrabold leading-[1.15] text-ink text-balance">
                    {lesson.title}
                  </span>
                  <span className="font-display text-[11px] font-bold leading-[1.15] text-ink-soft">
                    {masteryPhrase(stage)}
                  </span>
                </div>
              );
            }
            const o = model.objectiveById.get(l.id)!;
            const stage = objectiveStage(o, asOf);
            const dest = linkDestinationLabel(model, o.id);
            const sel = selectedObjective === o.id;
            return (
              <button
                key={l.key}
                type="button"
                tabIndex={-1}
                data-objective={o.id}
                onClick={onBoxClick}
                onPointerDown={(e) => e.stopPropagation()}
                title={o.label}
                className={cx(
                  STROKE,
                  "skillmap-fade absolute rounded-[var(--play-radius-sm)] px-2.5 py-1.5 text-start",
                )}
                style={{
                  left: l.rect.x,
                  top: l.rect.y,
                  width: l.rect.w,
                  background: fill(stage),
                  borderWidth: "var(--play-stroke-sm)",
                  boxShadow: sel ? "var(--play-shadow-sm)" : "none",
                }}
              >
                {/* Two lines at most, unless it is the selected one; the full
                    text is in the tooltip. */}
                <span
                  className={cx(
                    "block font-display text-[12.5px] font-bold leading-[1.22] text-ink text-balance",
                    !sel && "line-clamp-2",
                  )}
                >
                  {o.label}
                </span>
                <span className="mt-0.5 block font-display text-[11px] font-bold leading-[1.2] text-ink">
                  {masteryPhrase(stage)}
                </span>
                {dest && (
                  <span className="mt-0.5 block font-display text-[11px] font-bold leading-[1.2] text-ink">
                    → {dest}
                  </span>
                )}
              </button>
            );
          })}

      {/* hover / keyboard-focus tooltip for a node whose label is not shown */}
      {v && tooltip && (
        <div
          role="tooltip"
          className={cx(
            STROKE,
            "pointer-events-none absolute z-10 max-w-[220px] rounded-[var(--play-radius-sm)] bg-card px-2.5 py-1.5 sticker-shadow-sm",
          )}
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
            borderWidth: "var(--play-stroke-sm)",
          }}
        >
          <span className="block font-display text-[12.5px] font-bold leading-[1.22] text-ink">
            {tooltip.title}
          </span>
          <span className="block font-display text-[11px] font-bold leading-[1.2] text-ink-soft">
            {tooltip.word}
          </span>
        </div>
      )}

      {/* + / − / Fit */}
      <div
        className="absolute bottom-3.5 start-3.5 flex flex-col gap-1.5"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {(
          [
            ["Zoom in", "+", 1.4],
            ["Zoom out", "−", 1 / 1.4],
            ["Fit the whole map", "Fit", 0],
          ] as const
        ).map(([label, text, factor]) => (
          <button
            key={text}
            type="button"
            aria-label={label}
            onClick={() => (factor === 0 ? fitAll() : zoomBy(factor))}
            className={cx(
              STROKE,
              "flex size-[var(--noor-touch-min)] items-center justify-center rounded-[var(--play-radius-sm)] bg-card font-display font-extrabold text-ink sticker-shadow-sm play-pressable",
              text === "Fit" ? "text-[0.95rem]" : "text-[1.4rem]",
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

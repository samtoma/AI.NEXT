"use client";

/**
 * Shared plumbing for the parametric visual-primitives library.
 *
 * Every primitive is a pure renderer over a `{kind, spec}` data row
 * (services/extraction/VIZ_SPEC.md is the producer contract). The helpers
 * here give all nine kinds the same three properties:
 *
 *  - defensive parsing  : bad spec fields soft-default or throw VizError,
 *                         which the <Visual> registry turns into a chip;
 *  - the GIF loop       : useVizLoop() remounts the animated layer every
 *                         cycle so CSS entry animations replay, with a
 *                         hold at the end — and stops entirely under
 *                         prefers-reduced-motion;
 *  - Ledger styling     : one palette + one mono label voice.
 */

import { createContext, useContext, useEffect, useState } from "react";
import type { CSSProperties } from "react";

export class VizError extends Error {}

/* ---------------- palette ---------------- */

export const INK = "var(--ink)";
export const INK_SOFT = "var(--ink-soft)";
export const INK_FAINT = "var(--ink-faint)";
export const LINE = "var(--line)";
export const LINE_SOFT = "var(--line-soft)";
export const ACCENT = "var(--accent)";
export const ACCENT_DEEP = "var(--accent-deep)";
export const GOLD = "var(--gold)";
export const RUST = "var(--rust)";
export const CARD = "var(--card)";
export const MONO = "var(--stack-mono)";
export const DISPLAY = "var(--stack-display)";

/** Categorical series colors, in Ledger order. */
export const SERIES = [ACCENT, GOLD, RUST, INK_SOFT, ACCENT_DEEP, "#7c6a9c"];

const NAMED: Record<string, string> = {
  accent: ACCENT,
  viridian: ACCENT,
  green: ACCENT,
  teal: ACCENT,
  gold: GOLD,
  ochre: GOLD,
  amber: GOLD,
  yellow: GOLD,
  orange: GOLD,
  rust: RUST,
  red: RUST,
  ink: INK,
  navy: INK,
  blue: INK,
  gray: INK_SOFT,
  grey: INK_SOFT,
};

/** Map a producer-supplied color name to the Ledger palette (never fails). */
export function colorOf(c: unknown, fallback = ACCENT): string {
  if (typeof c !== "string" || !c) return fallback;
  const k = c.toLowerCase().trim();
  if (NAMED[k]) return NAMED[k];
  if (/^(#[0-9a-f]{3,8}$|rgb|hsl)/i.test(k)) return c;
  return fallback;
}

/* ---------------- defensive spec parsing ---------------- */

export const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Number or numeric string; falls back, or throws VizError without one. */
export function num(v: unknown, fallback?: number): number {
  if (isNum(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(+v)) return +v;
  if (fallback !== undefined) return fallback;
  throw new VizError(`expected a number, got ${JSON.stringify(v)?.slice(0, 40)}`);
}

export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

export const str = (v: unknown, d = ""): string =>
  typeof v === "string" ? v : isNum(v) ? String(v) : d;

/** `[min, max]` with sane ordering; falls back on anything malformed. */
export function range2(v: unknown, d: [number, number]): [number, number] {
  if (Array.isArray(v) && v.length >= 2) {
    const a = num(v[0], NaN);
    const b = num(v[1], NaN);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b)
      return a < b ? [a, b] : [b, a];
  }
  return d;
}

/** "√3", "2√2", "1.5" → numeric value (null if unparseable). */
export function rootNum(v: unknown): number | null {
  if (isNum(v)) return v;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, "");
  const m = /^(\d+(?:\.\d+)?)?(?:√|sqrt\()(\d+(?:\.\d+)?)\)?$/.exec(s);
  if (m) return (m[1] ? +m[1] : 1) * Math.sqrt(+m[2]);
  return Number.isFinite(+s) && s !== "" ? +s : null;
}

/** Nice tick step so an axis shows ~4–8 ticks: 1/2/5 × 10^k. */
export function niceStep(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / 6;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

export function fmtNum(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

/* ---------------- motion ---------------- */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/* ---- playback modes (Wave B2: the whiteboard) ----
 *
 * loop : /gallery & demo surfaces — the classic GIF feel, but capped at
 *        LOOP_PLAYS playthroughs (then parked on the final frame) and
 *        IntersectionObserver-gated: offscreen plates render their final
 *        frame statically and only start playing when scrolled into view.
 * once : play a single stretched pass (lesson pacing), hold the final frame.
 * step : externally controlled (the board): steps < `step` show their final
 *        state instantly, step `step` animates in, later steps stay hidden.
 */

export type VizPlayMode = "loop" | "once" | "step";

export interface VizPlayback {
  mode: VizPlayMode;
  /** loop mode: false = offscreen → park on final frame, don't animate */
  visible?: boolean;
  /** step mode: current step, 1-based */
  step?: number;
  /** step mode: total steps for kinds without real step fields (fraction map) */
  totalSteps?: number;
  /** delay multiplier for once/step modes (lesson pacing, 2–4s staggers) */
  stretch?: number;
}

export const VizPlaybackContext = createContext<VizPlayback>({ mode: "loop" });

/** Reveal window handed to makeAnim by useVizTimeline (all in natural sec). */
export interface VizCtrl {
  /** elements with delay < this render their FINAL state, no animation */
  animateFromSec?: number;
  /** elements with delay > this stay hidden */
  revealSec?: number;
  /** rendered delay = (delay − animateFrom) × stretch */
  stretch?: number;
}

/** Everything parked on its final frame (offscreen loop plates). */
const ALL_FINAL: VizCtrl = { animateFromSec: Infinity };

/** Total playthroughs in loop mode before parking on the final frame. */
const LOOP_PLAYS = 2;

/**
 * The timeline seam every primitive uses (replaces the old useVizLoop).
 *
 * `totalSec` = natural end of the primitive's own stagger timeline (seconds,
 * without hold). `stepTimes` (optional, ascending) = the natural start time
 * of each discrete step for kinds with REAL step semantics (geo_scene,
 * arrow_map); kinds without pass nothing and step mode maps step n of N to
 * the fraction window [(n−1)/N, n/N] of the timeline.
 *
 * Returns the remount key for the animated <g> and the VizCtrl for makeAnim.
 */
export function useVizTimeline(
  totalSec: number,
  on: boolean,
  stepTimes?: number[]
): { key: string | number; ctrl?: VizCtrl } {
  const pb = useContext(VizPlaybackContext);
  const [cycle, setCycle] = useState(0);
  const visible = pb.visible !== false;
  const looping =
    on && pb.mode === "loop" && visible && cycle < LOOP_PLAYS - 1;
  const periodMs = Math.min(12000, Math.max(3000, totalSec * 1000 + HOLD_MS));
  useEffect(() => {
    if (!looping) return;
    const id = setInterval(() => setCycle((c) => c + 1), periodMs);
    return () => clearInterval(id);
  }, [looping, periodMs]);

  if (!on) return { key: 0 };

  if (pb.mode === "step") {
    const times = stepTimes && stepTimes.length > 0 ? stepTimes : null;
    const N = Math.max(1, times ? times.length : (pb.totalSteps ?? 1));
    const idx = Math.min(Math.max(pb.step ?? N, 1), N);
    const EPS = 0.01;
    const boundary = (j: number) =>
      times ? times[j] : (j / N) * Math.max(totalSec, 0.01);
    return {
      key: `s${idx}`, // keyed per STEP: advancing replays only the new step
      ctrl: {
        animateFromSec: idx === 1 ? 0 : boundary(idx - 1) - EPS,
        revealSec: idx >= N ? Infinity : boundary(idx) - EPS,
        stretch: pb.stretch ?? 1.6,
      },
    };
  }

  if (pb.mode === "once") {
    return { key: 0, ctrl: { stretch: pb.stretch ?? 3 } };
  }

  // loop: park offscreen plates on their final frame until first visible
  if (!visible && cycle === 0) return { key: "parked", ctrl: ALL_FINAL };
  return { key: cycle };
}

/** Inline-style animation helpers; all no-ops when `on` is false. */
export interface Anim {
  on: boolean;
  /** scale+fade entrance (dots, labels, stamps) */
  pop(delay: number): CSSProperties;
  fade(delay: number, dur?: number): CSSProperties;
  /** stroke draw — the element MUST set pathLength={100} */
  draw(delay: number, dur?: number): CSSProperties;
  /** bar growth; origin bottom (y) or left (x) of the element's own box */
  grow(delay: number, axis?: "x" | "y", dur?: number): CSSProperties;
  /** gentle infinite emphasis pulse */
  pulse(delay: number): CSSProperties;
  /**
   * The raw reveal gate behind the helpers above: "final" (already played),
   * "hidden" (not yet), or the rendered delay in seconds.
   *
   * For elements whose reveal is NOT an opacity change — the Arabic kinds tint
   * a `<mark>` by growing its background, because fading a highlight would fade
   * the text with it, and the text of a سورة or a بيت must never flicker.
   */
  gate(delay: number): "final" | "hidden" | number;
}

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

const HIDDEN: CSSProperties = { opacity: 0 };

export function makeAnim(on: boolean, ctrl?: VizCtrl): Anim {
  if (!on) {
    const none = () => ({});
    return {
      on,
      pop: none,
      fade: none,
      draw: none,
      grow: none,
      pulse: none,
      gate: () => "final" as const,
    };
  }
  const from = ctrl?.animateFromSec ?? 0;
  const until = ctrl?.revealSec ?? Infinity;
  const stretch = ctrl?.stretch ?? 1;
  /** Gate a natural delay: final state / hidden / rendered delay in sec. */
  const at = (d: number): "final" | "hidden" | number =>
    d < from ? "final" : d > until ? "hidden" : (d - from) * stretch;
  return {
    on,
    gate: at,
    pop: (d) => {
      const g = at(d);
      if (g === "final") return {};
      if (g === "hidden") return HIDDEN;
      return {
        animation: `viz-pop 0.45s ${EASE} ${g}s both`,
        transformBox: "fill-box",
        transformOrigin: "center",
      };
    },
    fade: (d, dur = 0.5) => {
      const g = at(d);
      if (g === "final") return {};
      if (g === "hidden") return HIDDEN;
      return { animation: `viz-fade ${dur}s ease ${g}s both` };
    },
    draw: (d, dur = 0.8) => {
      const g = at(d);
      if (g === "final") return {}; // no strokeDasharray → full stroke
      if (g === "hidden") return HIDDEN;
      return {
        strokeDasharray: 100,
        animation: `viz-draw ${dur}s cubic-bezier(0.4, 0, 0.2, 1) ${g}s both`,
      };
    },
    grow: (d, axis = "y", dur = 0.7) => {
      const g = at(d);
      if (g === "final") return {};
      if (g === "hidden") return HIDDEN;
      return {
        animation: `viz-grow-${axis} ${dur}s ${EASE} ${g}s both`,
        transformBox: "fill-box",
        transformOrigin: axis === "y" ? "50% 100%" : "0% 50%",
      };
    },
    pulse: (d) => {
      const g = at(d);
      if (g === "hidden") return HIDDEN;
      return {
        animation: `viz-pulse 1.5s ease-in-out ${g === "final" ? 0 : g}s infinite`,
      };
    },
  };
}

/** How long every primitive holds its finished frame before looping. */
export const HOLD_MS = 2200;

/* ---------------- tiny shared SVG bits ---------------- */

export const monoText: CSSProperties = { fontFamily: MONO };

/** Standard props each primitive receives from the <Visual> registry. */
export interface VizProps {
  spec: Record<string, unknown>;
  /** false under prefers-reduced-motion or animate:"none" → final frame */
  animOn: boolean;
}

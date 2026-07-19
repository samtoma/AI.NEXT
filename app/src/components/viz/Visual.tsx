"use client";

/**
 * <Visual kind={} spec={} caption? /> — the single entry point of the
 * parametric visual-primitives library (services/extraction/VIZ_SPEC.md).
 *
 * One renderer library, hundreds of data specs: producers (extraction
 * agents, the lesson AI) emit {kind, spec} rows; this registry maps them to
 * the nine primitives. A bad or unknown spec NEVER crashes the surface —
 * it degrades to a quiet "spec error" chip.
 */

import {
  Component,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  VizError,
  VizPlaybackContext,
  obj,
  usePrefersReducedMotion,
} from "./core";
import { ArrowMap } from "./ArrowMap";
import { CoordinatePlot } from "./CoordinatePlot";
import { FunctionGraph } from "./FunctionGraph";
import { GeoScene } from "./GeoScene";
import { NumberLine } from "./NumberLine";
import { ProductGrid } from "./ProductGrid";
import { RatioBars } from "./RatioBars";
import { StatChart } from "./StatChart";
import { TrigTriangle } from "./TrigTriangle";

export const VIZ_KINDS = [
  "coordinate_plot",
  "function_graph",
  "arrow_map",
  "product_grid",
  "ratio_bars",
  "stat_chart",
  "trig_triangle",
  "geo_scene",
  "number_line",
] as const;

export type VizKind = (typeof VIZ_KINDS)[number];

const REGISTRY: Record<
  VizKind,
  (p: { spec: Record<string, unknown>; animOn: boolean }) => ReactNode
> = {
  coordinate_plot: CoordinatePlot,
  function_graph: FunctionGraph,
  arrow_map: ArrowMap,
  product_grid: ProductGrid,
  ratio_bars: RatioBars,
  stat_chart: StatChart,
  trig_triangle: TrigTriangle,
  geo_scene: GeoScene,
  number_line: NumberLine,
};

export function Visual({
  kind,
  spec,
  caption,
  className = "",
  still = false,
}: {
  kind: string;
  spec: unknown;
  caption?: string | null;
  className?: string;
  /** render the final frame only, no animation (filmstrip thumbnails) */
  still?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const outer = useContext(VizPlaybackContext);
  const hostRef = useRef<HTMLDivElement>(null);
  // loop mode: plates start parked on their final frame and only begin
  // playing once scrolled into view (one-way latch; /gallery has 100+)
  const [seen, setSeen] = useState(false);
  const gate = outer.mode === "loop" && !still;
  useEffect(() => {
    if (!gate) return;
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [gate]);

  const playback = useMemo(
    () => (gate ? { ...outer, visible: seen } : outer),
    [gate, outer, seen]
  );

  const K = (REGISTRY as Record<string, (typeof REGISTRY)[VizKind]>)[kind];
  const s = obj(spec);

  if (!K || spec == null || typeof spec !== "object") {
    return (
      <SpecErrorChip
        kind={kind}
        msg={!K ? `unknown kind "${kind}"` : "spec is not an object"}
      />
    );
  }

  return (
    <div
      ref={hostRef}
      className={`overflow-hidden rounded-md border border-line-soft bg-card-warm p-1.5 ${className}`}
    >
      <VizPlaybackContext.Provider value={playback}>
        <VizBoundary kind={kind}>
          <K spec={s} animOn={!reduced && !still} />
        </VizBoundary>
      </VizPlaybackContext.Provider>
      {caption ? (
        <p className="border-t border-line-soft px-1.5 pb-0.5 pt-1.5 text-[11px] leading-snug text-ink-soft">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------- graceful failure ---------------- */

export function SpecErrorChip({ kind, msg }: { kind: string; msg?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-rust/40 bg-rust-wash/50 px-3 py-2.5">
      <span aria-hidden className="text-[13px] leading-none text-rust">▧</span>
      <span className="min-w-0">
        <span className="block font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-rust">
          spec error · {kind || "visual"}
        </span>
        {msg && (
          <span className="block truncate font-mono text-[9px] text-ink-faint">
            {msg}
          </span>
        )}
      </span>
    </div>
  );
}

interface BState {
  err: string | null;
}

class VizBoundary extends Component<{ kind: string; children: ReactNode }, BState> {
  state: BState = { err: null };

  static getDerivedStateFromError(e: unknown): BState {
    return {
      err:
        e instanceof VizError
          ? e.message
          : e instanceof Error
            ? `render failed: ${e.message.slice(0, 80)}`
            : "render failed",
    };
  }

  render() {
    if (this.state.err !== null)
      return <SpecErrorChip kind={this.props.kind} msg={this.state.err} />;
    return this.props.children;
  }
}

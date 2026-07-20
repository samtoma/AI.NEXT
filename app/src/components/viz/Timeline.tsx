"use client";

/**
 * timeline — horizontal era band, events stamping in by step (VIZ_SPEC v2).
 * RTL by default: the EARLIEST event sits on the RIGHT (Arabic reading
 * order), per social-studies-interactions.md §2a/§4.2.
 *
 * spec: {era?:[start,end]|string, direction?:"rtl"|"ltr",
 *        events:[{label, when?|date?, step?}], animate:"sequence"|"none"}
 *
 * Rendered as HTML (not SVG): mixed Arabic labels + Arabic-Indic dates need
 * real bidi isolation (<bdi>), which SVG text can't give us.
 */

import {
  VizError,
  arr,
  makeAnim,
  num,
  obj,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";
import { arDigits } from "./arabic";

interface Ev {
  label: string;
  when: string;
  step: number;
}

export function Timeline({ spec, animOn }: VizProps) {
  const events: Ev[] = arr(spec.events)
    .map((raw, i) => {
      const e = obj(raw);
      return {
        label: str(e.label ?? e.title),
        when: str(e.when ?? e.date ?? e.at),
        step: num(e.step, i + 1),
      };
    })
    .filter((e) => e.label !== "");
  if (events.length === 0) throw new VizError("timeline: no events");

  const dir = str(spec.direction, "rtl") === "ltr" ? "ltr" : "rtl";
  const eraRaw = spec.era;
  const era: [string, string] | null = Array.isArray(eraRaw)
    ? [str(eraRaw[0]), str(eraRaw[1])]
    : typeof eraRaw === "string" && eraRaw
      ? [eraRaw, ""]
      : null;

  const steps = [...new Set(events.map((e) => e.step))].sort((a, b) => a - b);
  const stepAt = new Map(steps.map((s, i) => [s, 0.4 + i * 0.7]));
  const stepTimes = steps.map((s) => stepAt.get(s) ?? 0.4);
  const on = animOn && spec.animate !== "none";
  const tl = useVizTimeline((stepTimes[stepTimes.length - 1] ?? 0.4) + 1.2, on, stepTimes);
  const a = makeAnim(on, tl.ctrl);

  // layout constants (card zone is fixed so the rail passes through the dots)
  const CARD_ZONE = 56;
  const RAIL_Y = CARD_ZONE + 6 + 5; // card zone + stem + half dot

  return (
    <div dir={dir} className="overflow-x-auto py-1.5">
      <div key={tl.key} style={{ minWidth: `${Math.max(events.length * 86, 200)}px` }}>
        {era && (
          <div className="mb-1 flex items-center justify-between px-2 font-mono text-[9px] tracking-wide text-ink-faint">
            <bdi>{arDigits(era[0])}</bdi>
            {era[1] && <bdi>{arDigits(era[1])}</bdi>}
          </div>
        )}
        <div className="relative">
          {/* the rail */}
          <div
            className="absolute inset-x-1 h-[2px] rounded bg-ink-soft/60"
            style={{
              top: `${RAIL_Y}px`,
              ...a.grow(0.1, "x", 0.9),
              transformOrigin: dir === "rtl" ? "100% 50%" : "0% 50%",
            }}
          />
          <div className="relative flex items-start">
            {events.map((e, i) => {
              const d = stepAt.get(e.step) ?? 0.4;
              return (
                <div key={i} className="flex min-w-0 flex-1 flex-col items-center px-1">
                  {/* stamped card */}
                  <div
                    className="flex items-end justify-center"
                    style={{ height: `${CARD_ZONE}px` }}
                  >
                    <div
                      className="max-w-full rounded-md border border-line bg-card px-1.5 py-1 text-center text-[11px] font-medium leading-snug text-ink shadow-[0_2px_6px_-3px_rgba(32,41,58,0.35)]"
                      style={a.pop(d)}
                    >
                      <bdi>{arDigits(e.label)}</bdi>
                    </div>
                  </div>
                  {/* stem + dot on the rail */}
                  <div className="h-[6px] w-px bg-ink-soft/50" style={a.fade(d + 0.15, 0.3)} />
                  <div
                    className="h-[10px] w-[10px] rounded-full border-2 border-accent bg-card"
                    style={a.pop(d + 0.2)}
                  />
                  {/* date under the rail */}
                  {e.when && (
                    <div
                      className="mt-1 font-mono text-[9.5px] font-semibold text-accent-deep"
                      style={a.fade(d + 0.35)}
                    >
                      <bdi>{arDigits(e.when)}</bdi>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * harakat_reveal — marks appearing in sequence (VIZ_SPEC v3 §1.7).
 *
 * Teaches where the علامة lands: the fatha ON the ب of «يا طالبَ العلم».
 *
 * **The implementation is the whole point.** Do NOT animate a combining mark by
 * splitting the string into per-character spans — that breaks the cursive join
 * in every browser without ZWJ scaffolding, and the mark positioning goes with
 * it. Instead each step is a complete STAGE STRING (the full text carrying
 * marks 1…k and no others), and the stages are cross-faded. Every stage is an
 * independently shaped run, so nothing ever moves or unjoins. Cost: zero bytes
 * beyond this component.
 *
 * spec: {text, marks:[{find, on?:"last"|int, mark?, note?, step?}],
 *        animate:"sequence"|"none"}
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
import { locateMark, stageVowelled, type MarkTarget } from "./arabic";
import { ArHeader } from "./arabic-ui";

interface Reveal {
  target: MarkTarget;
  note: string;
  step: number;
}

export function HarakatReveal({ spec, animOn }: VizProps) {
  const text = str(spec.text);
  if (!text) throw new VizError("harakat_reveal: no text");

  const reveals: Reveal[] = arr(spec.marks)
    .map((raw, i) => {
      const m = obj(raw);
      const onRaw = m.on;
      const on: "last" | number =
        typeof onRaw === "number" && Number.isFinite(onRaw) ? onRaw : "last";
      const target = locateMark(text, str(m.find), on, str(m.mark) || undefined);
      if (!target) {
        if (process.env.NODE_ENV !== "production")
          console.warn(
            `[viz:harakat_reveal] no «${str(m.mark)}» on «${str(m.find)}» — reveal skipped`
          );
        return null;
      }
      return { target, note: str(m.note), step: Math.max(1, num(m.step, i + 1)) };
    })
    .filter((r): r is Reveal => r !== null);
  if (reveals.length === 0) throw new VizError("harakat_reveal: no resolvable marks");

  reveals.sort((a, b) => a.step - b.step);
  const stages = stageVowelled(
    text,
    reveals.map((r) => r.target)
  );

  // stage 0 = the bare word, then one step per revealed mark
  const stepTimes = stages.map((_, i) => 0.2 + i * 0.8);
  const on = animOn && spec.animate !== "none";
  const tl = useVizTimeline((stepTimes[stepTimes.length - 1] ?? 0.2) + 1, on, stepTimes);
  const a = makeAnim(on, tl.ctrl);

  return (
    <div dir="rtl" lang="ar" key={tl.key} className="py-1">
      <ArHeader label="الضبط" />
      {/* All stages occupy ONE grid cell and paint over each other; the newest
          visible stage wins. Overlaying complete strings is what keeps the
          shaping intact — see the note at the top of this file. */}
      <div className="grid rounded-md border border-line-soft bg-card px-3 py-2">
        {stages.map((s, i) => (
          <p
            key={i}
            className="ar-block ar-vowelled col-start-1 row-start-1 bg-card text-[19px] text-ink"
            style={a.fade(stepTimes[i], 0.45)}
            aria-hidden={i < stages.length - 1}
          >
            {s}
          </p>
        ))}
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        {reveals.map((r, i) =>
          r.note ? (
            <div
              key={i}
              className="flex items-baseline gap-1.5"
              style={a.pop(stepTimes[i + 1] + 0.15)}
            >
              <span className="ar-label shrink-0 rounded-full border border-accent-deep/40 px-1.5 py-px font-mono text-[9px] font-semibold text-accent-deep">
                {text.slice(r.target.start, r.target.end)}
              </span>
              <span className="ar-block ar-plain text-[11.5px] text-ink-soft">
                <bdi>{r.note}</bdi>
              </span>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}

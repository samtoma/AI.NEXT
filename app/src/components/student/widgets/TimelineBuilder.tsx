"use client";

import { useMemo, useState } from "react";
import { arDigits } from "@/components/viz/arabic";
import { stableShuffle, useFireOnce } from "./util";

/**
 * {{widget:timeline_builder:{"prompt":"رتب الأحداث دي زي ما حصلت","events":["أ","ب","ج"],"correctOrder":[0,1,2]}}}
 *
 * «رتب الأحداث» — tap-to-order (no drag: cheap touchscreens). The student
 * taps the shuffled event cards in story order; each correct pick flies
 * onto the timeline strip, which fills RIGHT-TO-LEFT (earliest on the
 * right). A wrong pick flashes softly and stays available — the student
 * self-corrects; missteps are counted into the result note, never shown
 * as a score.
 */

export function TimelineBuilder({
  prompt,
  events,
  correctOrder,
  answerOrder,
  onResult,
}: {
  prompt: string;
  events: string[];
  correctOrder?: number[];
  /** legacy alias from the design spec */
  answerOrder?: number[];
  onResult: (note: string) => void;
}) {
  const order = useMemo(() => {
    const o = (correctOrder ?? answerOrder ?? events.map((_, i) => i)).filter(
      (i) => Number.isInteger(i) && i >= 0 && i < events.length
    );
    return [...new Set(o)];
  }, [correctOrder, answerOrder, events]);

  const pool = useMemo(
    () => stableShuffle(order.map((i) => i), (i) => events[i] ?? String(i)),
    [order, events]
  );

  const fire = useFireOnce(onResult);
  const [placed, setPlaced] = useState(0);
  const [missteps, setMissteps] = useState(0);
  const [flash, setFlash] = useState<number | null>(null);
  const n = order.length;
  const done = n > 0 && placed >= n;

  const tap = (idx: number) => {
    if (done) return;
    if (idx === order[placed]) {
      const next = placed + 1;
      setPlaced(next);
      if (next >= n) {
        fire(
          missteps === 0
            ? `✓ Omar ordered all ${n} events correctly on the timeline on the first try`
            : `✓ Omar completed the timeline order after ${missteps} wrong pick${missteps > 1 ? "s" : ""} (self-corrected)`
        );
      }
    } else {
      setMissteps((m) => m + 1);
      setFlash(idx);
      window.setTimeout(() => setFlash((f) => (f === idx ? null : f)), 450);
    }
  };

  if (n === 0) return null;
  const placedSet = new Set(order.slice(0, placed));

  return (
    <div
      dir="rtl"
      className="anim-pop my-2 overflow-hidden rounded-lg border border-accent/40 bg-card shadow-[0_10px_24px_-16px_rgba(13,74,66,0.5)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-accent-wash px-3.5 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-accent-deep">
          ✳ تفاعلي · رتب الأحداث
        </span>
        <span className="font-mono text-[9px] text-ink-faint">
          دوس على الأحداث بالترتيب — الأول على اليمين
        </span>
      </div>

      <div className="px-3.5 py-3">
        <p className="text-[13px] font-medium leading-relaxed text-ink">{prompt}</p>

        {/* the timeline strip: slots fill right-to-left */}
        <div className="mt-3 rounded-md border border-line-soft bg-card-warm px-2 pb-2 pt-2.5">
          <div className="flex items-stretch gap-1.5">
            {order.map((evIdx, slot) => {
              const filled = slot < placed;
              return (
                <div key={slot} className="min-w-0 flex-1">
                  <div
                    className={`flex min-h-[44px] items-center justify-center rounded-md border px-1 py-1 text-center text-[10.5px] leading-snug transition-all duration-200 ${
                      filled
                        ? "anim-pop border-accent/60 bg-accent-wash font-medium text-accent-deep"
                        : "border-dashed border-line text-ink-faint"
                    }`}
                  >
                    {filled ? <bdi>{arDigits(events[evIdx])}</bdi> : arDigits(slot + 1)}
                  </div>
                  <div className="mx-auto mt-1 h-[7px] w-[7px] rounded-full border-2 border-ink-soft/50 bg-card" />
                </div>
              );
            })}
          </div>
          <div className="mt-[-4px] h-[2px] rounded bg-ink-soft/40" />
        </div>

        {/* the shuffled pool */}
        {!done && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {pool.map((evIdx) =>
              placedSet.has(evIdx) ? null : (
                <button
                  key={evIdx}
                  onClick={() => tap(evIdx)}
                  className={`rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium leading-snug transition-all duration-150 ${
                    flash === evIdx
                      ? "border-rust bg-rust-wash text-rust"
                      : "border-line bg-card text-ink hover:-translate-y-px hover:border-ink/40"
                  }`}
                >
                  <bdi>{arDigits(events[evIdx])}</bdi>
                </button>
              )
            )}
          </div>
        )}

        {done && (
          <div className="anim-pop mt-3 rounded-md border border-accent/45 bg-accent-wash px-3 py-2">
            <span className="font-display text-[13.5px] font-medium text-accent-deep">
              {missteps === 0
                ? "برافو! رتبت الأحداث كلها صح من أول مرة ✓"
                : "تمام — وصلنا للترتيب الصح. دي نفس فكرة سؤال «رتب» في الامتحان"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

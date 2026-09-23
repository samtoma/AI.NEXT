"use client";

import { useMemo, useState } from "react";
import { arDigits } from "@/components/viz/arabic";
import { cx } from "@/components/sticker";
import { stableShuffle, useFireOnce } from "./util";
import {
  OPTION_INK,
  SLOT_INK,
  WIDGET_FRAME,
  WIDGET_HEAD,
  WIDGET_HINT_AR,
  WIDGET_KIND_AR,
  WIDGET_OPTION,
  WIDGET_PROMPT,
  WIDGET_RESULT,
  WIDGET_SLOT,
  WIDGET_WELL,
} from "./WidgetShell";

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
  studentName,
  onResult,
}: {
  prompt: string;
  events: string[];
  correctOrder?: number[];
  /** legacy alias from the design spec */
  answerOrder?: number[];
  /** The signed-in student's display name, narrated into the note below in
   *  place of the retired "Omar" demo persona (FR-2602, ADR-0010 plan A10).
   *  Falls back to a name-free "the student" — never a guess — when a caller
   *  (dev fixture, admin replay) has none to give. */
  studentName?: string;
  onResult: (note: string) => void;
}) {
  const who = studentName?.trim() || "the student";
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
            ? `✓ ${who} ordered all ${n} events correctly on the timeline on the first try`
            : `✓ ${who} completed the timeline order after ${missteps} wrong pick${missteps > 1 ? "s" : ""} (self-corrected)`
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
    <div dir="rtl" className={WIDGET_FRAME}>
      <div className={WIDGET_HEAD}>
        <span className={WIDGET_KIND_AR}>✳ تفاعلي · رتب الأحداث</span>
        <span className={WIDGET_HINT_AR}>دوس على الأحداث بالترتيب — الأول على اليمين</span>
      </div>

      <div className="px-3.5 py-3">
        <p className={WIDGET_PROMPT}>{prompt}</p>

        {/* the timeline strip: slots fill right-to-left */}
        <div className={cx(WIDGET_WELL, "mt-3 px-2 pb-2 pt-2.5")}>
          <div className="flex items-stretch gap-1.5">
            {order.map((evIdx, slot) => {
              const filled = slot < placed;
              return (
                <div key={slot} className="min-w-0 flex-1">
                  <div
                    className={cx(
                      WIDGET_SLOT,
                      "flex min-h-[44px] items-center justify-center px-1 py-1 text-center text-[10.5px] leading-snug transition-all duration-200",
                      filled ? SLOT_INK.filled : SLOT_INK.empty
                    )}
                  >
                    {filled ? <bdi>{arDigits(events[evIdx])}</bdi> : arDigits(slot + 1)}
                  </div>
                  {/* the bead on the time axis */}
                  <div className="mx-auto mt-1 h-[7px] w-[7px] rounded-[var(--play-radius-pill)] bg-ink" />
                </div>
              );
            })}
          </div>
          {/* the time axis, one thin ink stroke under the beads */}
          <div className="mt-[-4px] h-[var(--play-stroke-sm)] rounded-[var(--play-radius-pill)] bg-ink" />
        </div>

        {/* the shuffled pool */}
        {!done && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {pool.map((evIdx) =>
              placedSet.has(evIdx) ? null : (
                <button
                  key={evIdx}
                  onClick={() => tap(evIdx)}
                  className={cx(
                    WIDGET_OPTION,
                    "px-2.5 py-1.5 text-[11.5px] leading-snug",
                    // a wrong pick greys and nudges, then comes back live
                    flash === evIdx ? cx(OPTION_INK.wrong, "anim-nudge") : OPTION_INK.idle
                  )}
                >
                  <bdi>{arDigits(events[evIdx])}</bdi>
                </button>
              )
            )}
          </div>
        )}

        {done && (
          <div className={cx("mt-3 px-3 py-2", WIDGET_RESULT.correct)}>
            <span className="font-display text-[13.5px] font-bold">
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

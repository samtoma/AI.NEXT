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
 * {{widget:chain_builder:{"prompt":"ركّب السلسلة","cards":[{"label":"فرض الضرائب","role":"سبب"},{"label":"ثورة القاهرة الأولى","role":"حدث"},{"label":"إعدام الثوار","role":"نتيجة"}],"correctChain":[0,1,2]}}}
 *
 * «بم تفسر» as a build: the student assembles the سبب → حدث → نتيجة chain
 * by tapping cards in causal order. Slots are labeled with the expected
 * role and fill right-to-left. Deterministic grading; a wrong pick flashes
 * softly and stays — self-correction, missteps only in the result note.
 */

interface Card {
  label: string;
  role?: string;
}

const ROLE_COLOR: Record<string, string> = {
  "سبب": "text-gold",
  "حدث": "text-[color:var(--play-text-muted)]",
  "نتيجة": "text-ink",
};

/** The role tag over a card: Arabic, so the UI face, never tracked mono. */
const ROLE_TAG = "ar-label block font-display text-[0.72rem] font-bold";

export function ChainBuilder({
  prompt,
  cards,
  correctChain,
  studentName,
  onResult,
}: {
  prompt: string;
  cards: Card[];
  correctChain?: number[];
  /** The signed-in student's display name, narrated into the note below in
   *  place of the retired "Omar" demo persona (FR-2602, ADR-0010 plan A10).
   *  Falls back to a name-free "the student" — never a guess — when a caller
   *  (dev fixture, admin replay) has none to give. */
  studentName?: string;
  onResult: (note: string) => void;
}) {
  const who = studentName?.trim() || "the student";
  const chain = useMemo(() => {
    const c = (correctChain ?? cards.map((_, i) => i)).filter(
      (i) => Number.isInteger(i) && i >= 0 && i < cards.length
    );
    return [...new Set(c)];
  }, [correctChain, cards]);

  const pool = useMemo(
    () => stableShuffle(cards.map((_, i) => i), (i) => cards[i]?.label ?? String(i)),
    [cards]
  );

  const fire = useFireOnce(onResult);
  const [placed, setPlaced] = useState(0);
  const [missteps, setMissteps] = useState(0);
  const [flash, setFlash] = useState<number | null>(null);
  const n = chain.length;
  const done = n > 0 && placed >= n;

  const tap = (idx: number) => {
    if (done) return;
    if (idx === chain[placed]) {
      const next = placed + 1;
      setPlaced(next);
      if (next >= n) {
        const shape = chain.map((i) => cards[i]?.role ?? "؟").join("→");
        fire(
          missteps === 0
            ? `✓ ${who} built the ${shape} chain correctly on the first try`
            : `✓ ${who} completed the ${shape} chain after ${missteps} wrong pick${missteps > 1 ? "s" : ""} (self-corrected)`
        );
      }
    } else {
      setMissteps((m) => m + 1);
      setFlash(idx);
      window.setTimeout(() => setFlash((f) => (f === idx ? null : f)), 450);
    }
  };

  if (n === 0) return null;
  const placedSet = new Set(chain.slice(0, placed));

  return (
    <div dir="rtl" className={WIDGET_FRAME}>
      <div className={WIDGET_HEAD}>
        <span className={WIDGET_KIND_AR}>✳ تفاعلي · السبب والنتيجة</span>
        <span className={WIDGET_HINT_AR}>ركّب السلسلة بالترتيب</span>
      </div>

      <div className="px-3.5 py-3">
        <p className={WIDGET_PROMPT}>{prompt}</p>

        {/* the chain slots (RTL: first slot on the right) */}
        <div className={cx(WIDGET_WELL, "mt-3 flex flex-wrap items-center gap-y-2 px-2 py-2.5")}>
          {chain.map((cardIdx, slot) => {
            const filled = slot < placed;
            const role = cards[cardIdx]?.role ?? "";
            return (
              <div key={slot} className="flex min-w-0 flex-1 basis-0 items-center">
                {slot > 0 && (
                  <span aria-hidden className="mx-1 shrink-0 text-[13px] text-ink-faint">
                    ←
                  </span>
                )}
                <div
                  className={cx(
                    WIDGET_SLOT,
                    "min-w-0 flex-1 px-1.5 py-1.5 text-center transition-all duration-200",
                    filled ? SLOT_INK.filled : SLOT_INK.empty
                  )}
                >
                  {role && (
                    <span className={cx(ROLE_TAG, filled ? "" : ROLE_COLOR[role] ?? "")}>
                      {role}
                    </span>
                  )}
                  <span className="block text-[10.5px] leading-snug">
                    {filled ? <bdi>{arDigits(cards[cardIdx].label)}</bdi> : "؟"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* the card pool */}
        {!done && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {pool.map((cardIdx) =>
              placedSet.has(cardIdx) ? null : (
                <button
                  key={cardIdx}
                  onClick={() => tap(cardIdx)}
                  className={cx(
                    WIDGET_OPTION,
                    "px-2.5 py-1.5 text-start",
                    // a wrong pick greys and nudges, then comes back live —
                    // never red, and the card stays in the pool
                    flash === cardIdx ? cx(OPTION_INK.wrong, "anim-nudge") : OPTION_INK.idle
                  )}
                >
                  {cards[cardIdx]?.role && (
                    <span
                      className={cx(
                        ROLE_TAG,
                        flash === cardIdx ? "" : ROLE_COLOR[cards[cardIdx].role!] ?? ""
                      )}
                    >
                      {cards[cardIdx].role}
                    </span>
                  )}
                  <span className="block text-[11.5px] leading-snug">
                    <bdi>{arDigits(cards[cardIdx].label)}</bdi>
                  </span>
                </button>
              )
            )}
          </div>
        )}

        {done && (
          <div className={cx("mt-3 px-3 py-2", WIDGET_RESULT.correct)}>
            <span className="font-display text-[13.5px] font-bold">
              {missteps === 0
                ? "برافو! السلسلة كاملة صح — سبب، حدث، نتيجة ✓"
                : "تمام — كده فهمت إيه اللي أدى لإيه. دي إجابة «بم تفسر» جاهزة"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

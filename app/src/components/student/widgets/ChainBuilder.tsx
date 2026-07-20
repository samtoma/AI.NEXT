"use client";

import { useMemo, useState } from "react";
import { arDigits } from "@/components/viz/arabic";
import { stableShuffle, useFireOnce } from "./util";

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
  "حدث": "text-ink-soft",
  "نتيجة": "text-accent-deep",
};

export function ChainBuilder({
  prompt,
  cards,
  correctChain,
  onResult,
}: {
  prompt: string;
  cards: Card[];
  correctChain?: number[];
  onResult: (note: string) => void;
}) {
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
            ? `✓ Omar built the ${shape} chain correctly on the first try`
            : `✓ Omar completed the ${shape} chain after ${missteps} wrong pick${missteps > 1 ? "s" : ""} (self-corrected)`
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
    <div
      dir="rtl"
      className="anim-pop my-2 overflow-hidden rounded-lg border border-accent/40 bg-card shadow-[0_10px_24px_-16px_rgba(13,74,66,0.5)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-accent-wash px-3.5 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-accent-deep">
          ✳ تفاعلي · السبب والنتيجة
        </span>
        <span className="font-mono text-[9px] text-ink-faint">ركّب السلسلة بالترتيب</span>
      </div>

      <div className="px-3.5 py-3">
        <p className="text-[13px] font-medium leading-relaxed text-ink">{prompt}</p>

        {/* the chain slots (RTL: first slot on the right) */}
        <div className="mt-3 flex flex-wrap items-center gap-y-2 rounded-md border border-line-soft bg-card-warm px-2 py-2.5">
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
                  className={`min-w-0 flex-1 rounded-md border px-1.5 py-1.5 text-center transition-all duration-200 ${
                    filled
                      ? "anim-pop border-accent/60 bg-accent-wash"
                      : "border-dashed border-line"
                  }`}
                >
                  {role && (
                    <span
                      className={`block font-mono text-[8.5px] font-bold ${ROLE_COLOR[role] ?? "text-ink-faint"}`}
                    >
                      {role}
                    </span>
                  )}
                  <span
                    className={`block text-[10.5px] leading-snug ${
                      filled ? "font-medium text-accent-deep" : "text-ink-faint"
                    }`}
                  >
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
                  className={`rounded-md border px-2.5 py-1.5 text-right transition-all duration-150 ${
                    flash === cardIdx
                      ? "border-rust bg-rust-wash"
                      : "border-line bg-card hover:-translate-y-px hover:border-ink/40"
                  }`}
                >
                  {cards[cardIdx]?.role && (
                    <span
                      className={`block font-mono text-[8px] font-bold ${
                        flash === cardIdx ? "text-rust" : ROLE_COLOR[cards[cardIdx].role!] ?? "text-ink-faint"
                      }`}
                    >
                      {cards[cardIdx].role}
                    </span>
                  )}
                  <span
                    className={`block text-[11.5px] font-medium leading-snug ${
                      flash === cardIdx ? "text-rust" : "text-ink"
                    }`}
                  >
                    <bdi>{arDigits(cards[cardIdx].label)}</bdi>
                  </span>
                </button>
              )
            )}
          </div>
        )}

        {done && (
          <div className="anim-pop mt-3 rounded-md border border-accent/45 bg-accent-wash px-3 py-2">
            <span className="font-display text-[13.5px] font-medium text-accent-deep">
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

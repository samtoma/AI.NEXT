"use client";

import { useState } from "react";
import { arDigits } from "@/components/viz/arabic";
import { useFireOnce } from "./util";

/**
 * {{widget:hamza_seat:{"prompt":"الهمزة دي بتتكتب إزاي؟","items":[{"word":"فُ_َاد","answer":"ؤ","rule":"مفتوحة وما قبلها مضموم","page":12}]}}}
 *
 * «الإملاء» — the book's MOST-drilled skill: a hamza section in all three
 * lessons (printed 12, 18, 23), and the one place a Prep-3 student loses easy
 * marks. The book's own p.18 exercise («هات أمثلة من عندك») is free production
 * and cannot be auto-graded; the gradable inverse is seat selection, which is
 * also verbatim the exam item.
 *
 * The teaching moment is the RULE, not the tick: a correct tap completes the
 * word with its تشكيل and surfaces the book's own condition row. A wrong tap
 * greys that seat and leaves the item open for one retry before revealing.
 */

const STANDARD_SEATS = ["ؤ", "أ", "ئ", "ء"];

export interface HamzaItem {
  /** the word with the hamza blanked: «فُ_َاد» */
  word: string;
  seats?: string[];
  answer: string;
  /** the book's own condition row — this is the teaching */
  rule?: string;
  page?: number;
}

interface ItemState {
  picked: string | null;
  wrong: string[];
  revealed: boolean;
}

export function HamzaSeat({
  prompt,
  items,
  onResult,
}: {
  prompt: string;
  items: HamzaItem[];
  onResult: (note: string) => void;
}) {
  const clean = items.filter((it) => it.word && it.answer).slice(0, 6);
  const fire = useFireOnce(onResult);
  const [state, setState] = useState<ItemState[]>(() =>
    clean.map(() => ({ picked: null, wrong: [], revealed: false }))
  );

  if (clean.length === 0) return null;

  const settled = state.filter((s) => s.picked !== null || s.revealed).length;
  const done = settled >= clean.length;
  const firstTry = state.filter((s) => s.picked !== null && s.wrong.length === 0).length;

  const pick = (i: number, seat: string) => {
    setState((prev) => {
      const cur = prev[i];
      if (cur.picked !== null || cur.revealed) return prev;
      const next = [...prev];
      if (seat === clean[i].answer) {
        next[i] = { ...cur, picked: seat };
      } else {
        const wrong = [...cur.wrong, seat];
        // one retry, then the answer + its rule (dignity in failure: the item
        // never sits unsolved and never scolds)
        next[i] =
          wrong.length >= 2
            ? { picked: null, wrong, revealed: true }
            : { ...cur, wrong };
      }
      const closed = next.filter((s) => s.picked !== null || s.revealed).length;
      if (closed >= clean.length) {
        const got = next.filter((s) => s.picked !== null).length;
        const missed = clean
          .filter((_, k) => next[k].revealed)
          .map((it) => `«${it.rule ?? it.word}»`)
          .join(", ");
        fire(
          `hamza_seat ${got}/${clean.length}` +
            (missed ? ` — missed ${missed}` : " — clean run")
        );
      }
      return next;
    });
  };

  return (
    <div
      dir="rtl"
      lang="ar"
      className="anim-pop my-2 overflow-hidden rounded-lg border border-rust/40 bg-card shadow-[0_10px_24px_-16px_rgba(168,68,42,0.45)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-rust-wash px-3.5 py-2">
        <span className="ar-label font-mono text-[9px] text-rust">✳ تفاعلي · إملاء</span>
        <span className="ar-label font-mono text-[9px] text-ink-faint">
          {arDigits(settled)} من {arDigits(clean.length)}
        </span>
      </div>

      <div className="flex flex-col gap-2 px-3.5 py-3">
        <p className="ar-block ar-plain text-[13px] font-medium text-ink">{prompt}</p>

        {clean.map((it, i) => {
          const s = state[i];
          const solved = s.picked !== null;
          const closed = solved || s.revealed;
          const seats = (it.seats?.length ? it.seats : STANDARD_SEATS).slice(0, 5);
          // one text run, always: the completed word must shape as a word
          const shown = closed ? it.word.replace("_", it.answer) : it.word;
          return (
            <div key={i} className="rounded-md border border-line-soft bg-card-warm px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={`ar-block ar-vowelled text-[20px] ${
                    solved ? "text-accent-deep" : s.revealed ? "text-rust" : "text-ink"
                  }`}
                >
                  {shown}
                </span>
                <div className="flex gap-1.5">
                  {seats.map((seat) => {
                    const isWrong = s.wrong.includes(seat);
                    const isRight = closed && seat === it.answer;
                    return (
                      <button
                        key={seat}
                        type="button"
                        onClick={() => pick(i, seat)}
                        disabled={closed || isWrong}
                        className={`min-h-[44px] min-w-[44px] rounded-md border text-[19px] leading-none transition-all duration-150 ${
                          isRight
                            ? "border-accent bg-accent text-paper"
                            : isWrong
                              ? "border-line-soft bg-card text-ink-faint opacity-45"
                              : "border-line bg-card text-ink hover:-translate-y-px hover:border-ink/40"
                        }`}
                      >
                        {seat}
                      </button>
                    );
                  })}
                </div>
              </div>
              {closed && it.rule && (
                <p className="ar-block ar-plain anim-pop mt-1.5 border-r-2 border-gold/50 pr-1.5 text-[11.5px] text-ink-soft">
                  <bdi>
                    {it.rule}
                    {it.page ? ` — ص ${arDigits(it.page)}` : ""}
                  </bdi>
                </p>
              )}
            </div>
          );
        })}

        {done && (
          <div className="anim-pop rounded-md border border-accent/45 bg-accent-wash px-3 py-2">
            <span className="ar-block font-display text-[13.5px] font-medium text-accent-deep">
              {firstTry === clean.length
                ? "الهمزة دي بقت في إيدك ✓"
                : "تمام — القاعدة هي اللي بتقولك مكان الهمزة، مش الشكل"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

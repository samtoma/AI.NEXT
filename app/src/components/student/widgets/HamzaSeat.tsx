"use client";

import { useState } from "react";
import { arDigits } from "@/components/viz/arabic";
import { cx } from "@/components/sticker";
import { useFireOnce } from "./util";
import {
  pickInk,
  WIDGET_FRAME,
  WIDGET_HEAD,
  WIDGET_HINT_AR,
  WIDGET_KIND_AR,
  WIDGET_OPTION,
  WIDGET_PROMPT,
  WIDGET_RESULT,
  WIDGET_RULE_QUOTE,
  WIDGET_WELL,
} from "./WidgetShell";

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
    <div dir="rtl" lang="ar" className={WIDGET_FRAME}>
      <div className={WIDGET_HEAD}>
        <span className={WIDGET_KIND_AR}>✳ تفاعلي · إملاء</span>
        <span className={WIDGET_HINT_AR}>
          {arDigits(settled)} من {arDigits(clean.length)}
        </span>
      </div>

      <div className="flex flex-col gap-2 px-3.5 py-3">
        <p className={cx("ar-block ar-plain", WIDGET_PROMPT)}>{prompt}</p>

        {clean.map((it, i) => {
          const s = state[i];
          const solved = s.picked !== null;
          const closed = solved || s.revealed;
          const seats = (it.seats?.length ? it.seats : STANDARD_SEATS).slice(0, 5);
          // one text run, always: the completed word must shape as a word
          const shown = closed ? it.word.replace("_", it.answer) : it.word;
          return (
            <div key={i} className={cx(WIDGET_WELL, "px-2.5 py-2")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={cx(
                    "ar-block ar-vowelled text-[20px]",
                    solved
                      ? "text-[color:var(--play-on-leaf)]"
                      : s.revealed
                        ? "text-[color:var(--play-text-muted)]"
                        : "text-ink"
                  )}
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
                        data-verdict={isRight ? "correct" : isWrong ? "wrong" : undefined}
                        className={cx(
                          WIDGET_OPTION,
                          "min-w-[var(--noor-touch-min)] text-[19px] leading-none",
                          pickInk(isRight, isWrong, closed)
                        )}
                      >
                        {seat}
                      </button>
                    );
                  })}
                </div>
              </div>
              {closed && it.rule && (
                <p
                  className={cx(
                    WIDGET_RULE_QUOTE,
                    "ar-block ar-plain anim-pop mt-1.5 text-[11.5px] text-[color:var(--play-text-muted)]"
                  )}
                >
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
          <div className={cx("px-3 py-2", WIDGET_RESULT.correct)}>
            <span className="ar-block font-display text-[13.5px] font-bold">
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

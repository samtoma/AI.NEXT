"use client";

import { useMemo, useState } from "react";
import { locateSpan, tokenizeWords } from "@/components/viz/arabic";
import { categoryStyle } from "@/components/viz/arabic-ui";
import { arDigits } from "@/components/viz/arabic";
import { useFireOnce } from "./util";

/**
 * {{widget:extract_spans:{"prompt":"دوس على كل منادى في الفقرة","text":"…","category":"نحو","targets":["يا شبابَ مصر"]}}}
 *
 * «استخرج» — the most frequent exercise verb in the book (printed 10, 16, 22).
 *
 * Tests FINDING, not spelling: typing vocalised Arabic on a cheap Android is
 * punishment, and the exam item is «استخرج من الآيات…» anyway. Tap targets are
 * whole words — never a sub-word range, which would break the cursive join —
 * and the extra leading (`.ar-tappable`) is what buys a ≥44px target inside
 * running text without spacing the passage into unreadability.
 *
 * No partial credit, no timer, no red X: a wrong tap flashes and costs nothing
 * but a counter the student never sees (anxious-teenager rule).
 */

export function ExtractSpans({
  prompt,
  text,
  category = "نحو",
  targets,
  distractorHint,
  onResult,
}: {
  prompt: string;
  text: string;
  category?: string;
  targets: string[];
  distractorHint?: string;
  onResult: (note: string) => void;
}) {
  const words = useMemo(() => tokenizeWords(text).filter((w) => w.isWord), [text]);

  /** target index → the word indices it covers */
  const ranges = useMemo(() => {
    const out: { label: string; words: number[] }[] = [];
    for (const t of targets) {
      const span = locateSpan(text, t, 1, { wholeWord: true }) ?? locateSpan(text, t);
      if (!span) continue;
      const idx = words
        .map((w, i) => (w.start < span[1] && w.end > span[0] ? i : -1))
        .filter((i) => i >= 0);
      if (idx.length > 0) out.push({ label: t, words: idx });
    }
    return out;
  }, [targets, text, words]);

  const fire = useFireOnce(onResult);
  const [found, setFound] = useState<Set<number>>(new Set());
  const [misses, setMisses] = useState(0);
  const [flash, setFlash] = useState<number | null>(null);

  const n = ranges.length;
  const done = n > 0 && found.size >= n;
  const style = categoryStyle(category);

  const tap = (wordIdx: number) => {
    if (done) return;
    const hit = ranges.findIndex((r) => r.words.includes(wordIdx));
    if (hit >= 0 && !found.has(hit)) {
      const next = new Set(found);
      next.add(hit);
      setFound(next);
      if (next.size >= n)
        fire(
          `✓ extract_spans: found all ${n} «${category}» spans` +
            (misses > 0 ? ` after ${misses} wrong tap${misses > 1 ? "s" : ""}` : " with no wrong taps")
        );
      return;
    }
    if (hit >= 0) return; // already found — no penalty for re-tapping
    setMisses((m) => m + 1);
    setFlash(wordIdx);
    window.setTimeout(() => setFlash((f) => (f === wordIdx ? null : f)), 450);
  };

  // the widget must not render broken when the spans didn't resolve (§8)
  if (n === 0) return null;

  const foundWords = new Set(
    ranges.flatMap((r, i) => (found.has(i) ? r.words : []))
  );

  return (
    <div
      dir="rtl"
      lang="ar"
      className="anim-pop my-2 overflow-hidden rounded-lg border border-accent/40 bg-card shadow-[0_10px_24px_-16px_rgba(13,74,66,0.5)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-accent-wash px-3.5 py-2">
        <span className="ar-label font-mono text-[9px] text-accent-deep">
          ✳ تفاعلي · استخراج
        </span>
        <span className="ar-label font-mono text-[9px] text-ink-faint">
          {arDigits(found.size)} من {arDigits(n)}
        </span>
      </div>

      <div className="px-3.5 py-3">
        <p className="ar-block ar-plain text-[13px] font-medium text-ink">{prompt}</p>

        <p className="ar-block ar-tappable mt-2 rounded-md border border-line-soft bg-card-warm px-2.5 py-1.5 text-[16.5px] text-ink">
          {words.map((w, i) => {
            const isFound = foundWords.has(i);
            const isFlash = flash === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => tap(i)}
                disabled={done && !isFound}
                // inline (not inline-block): an inline-block button would open
                // its own line box and shred the passage's line rhythm
                className="mx-[1px] rounded px-0.5 py-3 align-baseline transition-colors duration-150"
                style={{
                  display: "inline",
                  font: "inherit",
                  color: isFlash ? "var(--rust)" : "inherit",
                  // The generous padding above buys the 44px tap target; the
                  // tint is painted as a text-height BAND inside it, so the
                  // highlight reads as a highlighter stroke and not a button.
                  backgroundColor: "transparent",
                  backgroundImage: isFlash
                    ? "linear-gradient(var(--rust-wash), var(--rust-wash))"
                    : isFound
                      ? `linear-gradient(${style.tint}, ${style.tint})`
                      : "none",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "center",
                  backgroundSize: "100% 1.7em",
                  textDecorationLine: isFound && style.underline !== "none" ? "underline" : "none",
                  textDecorationStyle: style.underline === "none" ? undefined : style.underline,
                  textDecorationColor: style.line,
                  textUnderlineOffset: "0.45em",
                }}
              >
                {w.text}
              </button>
            );
          })}
        </p>

        {misses >= 2 && distractorHint && !done && (
          <p className="ar-block ar-plain anim-fade mt-2 rounded-md border border-gold/40 bg-gold-wash px-2.5 py-1.5 text-[12px] text-ink-soft">
            <bdi>{distractorHint}</bdi>
          </p>
        )}

        {done && (
          <div className="anim-pop mt-3 rounded-md border border-accent/45 bg-accent-wash px-3 py-2">
            <span className="ar-block font-display text-[13.5px] font-medium text-accent-deep">
              {misses === 0
                ? "برافو — لقيتهم كلهم من أول مرة ✓"
                : "تمام، لقيتهم كلهم. دي بالظبط «استخرج من النص» بتاعة الامتحان"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

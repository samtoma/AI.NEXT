"use client";

import { useMemo, useState } from "react";
import { locateSpan } from "@/components/viz/arabic";
import { categoryStyle } from "@/components/viz/arabic-ui";
import { stableShuffle, useFireOnce } from "./util";

/**
 * {{widget:style_purpose:{"prompt":"…","text":"…","span":"كيفَ تَغدُو","styles":["نداء","استفهام","أمر"],"purposes":["التنبيه","الاستنكار"],"answer":{"style":"استفهام","purpose":"الاستنكار"}}}}
 *
 * «أسلوب … وغرضه …» — printed VERBATIM as a fill-in-the-blank on p.16, and
 * backed by two full مواطن الجمال boxes (pp. 9, 15). Both lists are closed
 * vocabularies of ~8 values, which is exactly why the richest interaction in
 * this vertical grades client-side with zero AI.
 *
 * Two stages, gated: the غرض list stays disabled until the أسلوب is right.
 * That is deliberate cognitive-load sequencing, not a UI limitation — and it
 * mirrors how the book's own blank reads.
 */

export function StylePurpose({
  prompt,
  text,
  span,
  styles,
  purposes,
  answer,
  onResult,
}: {
  prompt: string;
  text: string;
  span: string;
  styles: string[];
  purposes: string[];
  answer: { style: string; purpose: string };
  onResult: (note: string) => void;
}) {
  const at = useMemo(() => locateSpan(text, span), [text, span]);
  const styleOpts = useMemo(
    () => stableShuffle(styles.filter(Boolean), (s) => s),
    [styles]
  );
  const purposeOpts = useMemo(
    () => stableShuffle(purposes.filter(Boolean), (s) => s),
    [purposes]
  );

  const fire = useFireOnce(onResult);
  const [styleWrong, setStyleWrong] = useState<string[]>([]);
  const [styleOk, setStyleOk] = useState(false);
  const [purposeWrong, setPurposeWrong] = useState<string[]>([]);
  const [purposeOk, setPurposeOk] = useState(false);
  const [revealed, setRevealed] = useState<null | "style" | "purpose">(null);

  if (!answer?.style || !answer?.purpose || styleOpts.length < 2) return null;

  const finish = (purposeAnswered: string, ok: boolean) => {
    const sPart =
      styleWrong.length === 0
        ? "style ✓ first try"
        : `style ✗ ${styleWrong.length}× (answered ${styleWrong.map((w) => `'${w}'`).join(", ")})`;
    const pPart = ok
      ? purposeWrong.length === 0
        ? "purpose ✓ first try"
        : `purpose ✗ ${purposeWrong.length}× (answered '${purposeWrong[0]}', correct '${answer.purpose}')`
      : `purpose revealed (answered '${purposeAnswered}', correct '${answer.purpose}')`;
    fire(`style_purpose: ${sPart}, ${pPart}`);
  };

  const pickStyle = (s: string) => {
    if (styleOk || revealed) return;
    if (s === answer.style) {
      setStyleOk(true);
      return;
    }
    const wrong = [...styleWrong, s];
    setStyleWrong(wrong);
    // one retry, then reveal in the book's own wording
    if (wrong.length >= 2) {
      setStyleOk(true);
      setRevealed("style");
    }
  };

  const pickPurpose = (p: string) => {
    if (purposeOk) return;
    if (p === answer.purpose) {
      setPurposeOk(true);
      finish(p, true);
      return;
    }
    const wrong = [...purposeWrong, p];
    setPurposeWrong(wrong);
    if (wrong.length >= 2) {
      setPurposeOk(true);
      setRevealed("purpose");
      finish(p, false);
    }
  };

  const st = categoryStyle("بلاغة");
  const head = at ? text.slice(0, at[0]) : text;
  const mid = at ? text.slice(at[0], at[1]) : "";
  const tail = at ? text.slice(at[1]) : "";

  return (
    <div
      dir="rtl"
      lang="ar"
      className="anim-pop my-2 overflow-hidden rounded-lg border border-gold/45 bg-card shadow-[0_10px_24px_-16px_rgba(169,126,34,0.5)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-gold-wash px-3.5 py-2">
        <span className="ar-label font-mono text-[9px] text-gold">
          ✳ تفاعلي · أسلوب وغرض
        </span>
        <span className="ar-label font-mono text-[9px] text-ink-faint">
          {styleOk ? "الغرض" : "الأسلوب"}
        </span>
      </div>

      <div className="px-3.5 py-3">
        <p className="ar-block ar-plain text-[13px] font-medium text-ink">{prompt}</p>

        <p className="ar-block ar-vowelled mt-2 rounded-md border border-line-soft bg-card-warm px-2.5 py-1.5 text-[16.5px] text-ink">
          {head}
          {mid && (
            <mark
              style={{
                // `background` (shorthand) also clears the UA's yellow
                background: st.tint,
                color: "inherit",
                borderRadius: "0.2rem",
                textDecorationLine: "underline",
                textDecorationStyle: "dashed",
                textDecorationColor: st.line,
                textUnderlineOffset: "0.45em",
              }}
            >
              {mid}
            </mark>
          )}
          {tail}
        </p>

        {/* stage 1 — الأسلوب */}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {styleOpts.map((s) => {
            const isRight = styleOk && s === answer.style;
            const isWrong = styleWrong.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => pickStyle(s)}
                disabled={styleOk || isWrong}
                className={`ar-block min-h-[36px] rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition-all duration-150 ${
                  isRight
                    ? "border-accent bg-accent text-paper"
                    : isWrong
                      ? "border-rust/45 bg-rust-wash text-rust opacity-60"
                      : styleOk
                        ? "border-line-soft bg-card text-ink-faint"
                        : "border-line bg-card text-ink hover:-translate-y-px hover:border-ink/40"
                }`}
              >
                <bdi>{s}</bdi>
              </button>
            );
          })}
        </div>
        {styleWrong.length > 0 && !styleOk && (
          <p className="ar-block ar-plain anim-fade mt-1.5 text-[12px] text-ink-soft">
            {/* coach the CLUE, never the answer — teaching the clue is teaching
                the skill (arabic-student-experience.md §3.2) */}
            مش كده. بص على أول الجملة — في أداة بتقولك النوع.
          </p>
        )}

        {/* stage 2 — الغرض, unlocked only after the أسلوب */}
        <div className={`mt-2.5 ${styleOk ? "" : "pointer-events-none opacity-40"}`}>
          <span className="ar-label ar-block font-mono text-[9.5px] text-ink-faint">
            غرضه
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {purposeOpts.map((p) => {
              const isRight = purposeOk && p === answer.purpose;
              const isWrong = purposeWrong.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => pickPurpose(p)}
                  disabled={!styleOk || purposeOk || isWrong}
                  className={`ar-block min-h-[36px] rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition-all duration-150 ${
                    isRight
                      ? "border-accent bg-accent text-paper"
                      : isWrong
                        ? "border-rust/45 bg-rust-wash text-rust opacity-60"
                        : "border-line bg-card text-ink hover:-translate-y-px hover:border-ink/40"
                  }`}
                >
                  <bdi>{p}</bdi>
                </button>
              );
            })}
          </div>
        </div>

        {purposeOk && (
          <div className="anim-pop mt-3 rounded-md border border-accent/45 bg-accent-wash px-3 py-2">
            <span className="ar-block font-display text-[13.5px] font-medium text-accent-deep">
              {revealed
                ? `الإجابة: أسلوب ${answer.style} وغرضه ${answer.purpose}. دي بالظبط «أسلوب … وغرضه …» اللي بتيجي في الامتحان`
                : "برافو. دي بالظبط «أسلوب … وغرضه …» اللي بتيجي في الامتحان ✓"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { locateSpan } from "@/components/viz/arabic";
import { categoryStyle } from "@/components/viz/arabic-ui";
import { cx } from "@/components/sticker";
import { stableShuffle, useFireOnce } from "./util";
import {
  pickInk,
  WIDGET_FRAME,
  WIDGET_HEAD,
  WIDGET_HINT_AR,
  WIDGET_KIND_AR,
  WIDGET_OPTION,
  WIDGET_PROMPT,
  WIDGET_RESULT,
  WIDGET_WELL,
} from "./WidgetShell";

/** One option, for the أسلوب and the غرض rows alike. */
const optionCls = (isRight: boolean, isWrong: boolean, settled: boolean) =>
  cx(WIDGET_OPTION, "ar-block px-2.5 py-1 text-[12.5px]", pickInk(isRight, isWrong, settled));

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
    <div dir="rtl" lang="ar" className={WIDGET_FRAME}>
      <div className={WIDGET_HEAD}>
        <span className={WIDGET_KIND_AR}>✳ تفاعلي · أسلوب وغرض</span>
        <span className={WIDGET_HINT_AR}>{styleOk ? "الغرض" : "الأسلوب"}</span>
      </div>

      <div className="px-3.5 py-3">
        <p className={cx("ar-block ar-plain", WIDGET_PROMPT)}>{prompt}</p>

        <p className={cx(WIDGET_WELL, "ar-block ar-vowelled mt-2 px-2.5 py-1.5 text-[16.5px] text-ink")}>
          {head}
          {mid && (
            <mark
              style={{
                // `background` (shorthand) also clears the UA's yellow
                background: st.tint,
                color: "inherit",
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
                data-verdict={isRight ? "correct" : isWrong ? "wrong" : undefined}
                className={optionCls(isRight, isWrong, styleOk)}
              >
                <bdi>{s}</bdi>
              </button>
            );
          })}
        </div>
        {styleWrong.length > 0 && !styleOk && (
          <p className="ar-block ar-plain anim-fade mt-1.5 text-[12px] text-[color:var(--play-text-muted)]">
            {/* coach the CLUE, never the answer — teaching the clue is teaching
                the skill (arabic-student-experience.md §3.2) */}
            مش كده. بص على أول الجملة — في أداة بتقولك النوع.
          </p>
        )}

        {/* stage 2 — الغرض, unlocked only after the أسلوب */}
        <div className={`mt-2.5 ${styleOk ? "" : "pointer-events-none opacity-40"}`}>
          <span className="ar-label ar-block font-display text-[0.72rem] font-bold text-[color:var(--play-text-muted)]">
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
                  data-verdict={isRight ? "correct" : isWrong ? "wrong" : undefined}
                  className={optionCls(isRight, isWrong, false)}
                >
                  <bdi>{p}</bdi>
                </button>
              );
            })}
          </div>
        </div>

        {purposeOk && (
          <div className={cx("mt-3 px-3 py-2", WIDGET_RESULT.correct)}>
            <span className="ar-block font-display text-[13.5px] font-bold">
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

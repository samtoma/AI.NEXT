"use client";

/**
 * irab_tree — grammatical analysis, GATED (VIZ_SPEC v3 §1.6).
 *
 * The exam skill: word → موقع إعرابي → علامة الإعراب.
 *
 * **Book evidence for a worked إعراب: none.** The book states إعراب *rules*
 * («يُنصَبُ المنادى المُضافُ بالفتحة أو ما ينوبُ عنها») and never prints an
 * analysis. So this renderer enforces the grounding gate itself, in code:
 *
 *   every token must carry a rule_ref QUOTING a printed rule line,
 *   or the visual does not render at all.
 *
 * That refusal is the feature. Without it the AI is doing free-form grammar we
 * cannot verify, which breaks "nothing unreviewed reaches a student" as surely
 * as a wrong answer key would — and it fails invisibly, because improvised
 * إعراب reads perfectly fluent. A missing citation degrades to a spec-error
 * chip, which someone notices; a fabricated ruling does not.
 *
 * spec: {sentence, tokens:[{word, role, state?, mark?, rule_ref:{page,quote},
 *        step?}], animate:"sequence"|"none"}
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
import { arDigits, locateSpan, tokenizeWords } from "./arabic";
import { ArHeader } from "./arabic-ui";

interface Token {
  word: string;
  role: string;
  state: string;
  mark: string;
  page: number;
  quote: string;
  step: number;
  /** index into the sentence's word tokens, or -1 when unanchored */
  at: number;
}

/** A rule line, not a word: anything shorter is not a citation. */
const MIN_QUOTE = 8;

export function IrabTree({ spec, animOn }: VizProps) {
  const sentence = str(spec.sentence ?? spec.text);
  if (!sentence) throw new VizError("irab_tree: no sentence");

  const raw = arr(spec.tokens);
  if (raw.length === 0) throw new VizError("irab_tree: no tokens");

  const words = tokenizeWords(sentence).filter((w) => w.isWord);

  const tokens: Token[] = raw.map((r, i) => {
    const t = obj(r);
    const word = str(t.word);
    const ref = obj(t.rule_ref ?? t.ruleRef);
    const quote = str(ref.quote ?? ref.text).trim();
    const page = num(ref.page, 0);

    // ---- the gate. Refuse the WHOLE visual, not just this token: a partially
    // cited إعراب still teaches the uncited part as if it were the book's.
    if (!word)
      throw new VizError(`irab_tree: token ${i + 1} has no word`);
    if (quote.length < MIN_QUOTE || page <= 0)
      throw new VizError(
        `irab_tree refused: «${word}» has no rule_ref quoting a printed rule ` +
          `(the book prints zero إعراب worked examples — see VIZ_SPEC v3 §1.6)`
      );

    const span = locateSpan(sentence, word, 1, { wholeWord: true });
    const at = span ? words.findIndex((w) => w.start <= span[0] && w.end >= span[1]) : -1;
    return {
      word,
      role: str(t.role),
      state: str(t.state),
      mark: str(t.mark),
      page,
      quote,
      step: Math.max(1, num(t.step, i + 1)),
      at,
    };
  });

  const steps = [...new Set(tokens.map((t) => t.step))].sort((a, b) => a - b);
  // step 1 = the bare sentence, then one step per analysed word
  const stepTimes = [0.15, ...steps.map((_, i) => 0.8 + i * 0.7)];
  const delayOf = (s: number) => {
    const i = steps.indexOf(s);
    return i < 0 ? stepTimes[0] : stepTimes[i + 1];
  };

  const on = animOn && spec.animate !== "none";
  const tl = useVizTimeline((stepTimes[stepTimes.length - 1] ?? 0.15) + 1, on, stepTimes);
  const a = makeAnim(on, tl.ctrl);

  const tokenAtWord = (i: number) => tokens.findIndex((t) => t.at === i);

  return (
    <div dir="rtl" lang="ar" key={tl.key} className="py-1">
      <ArHeader label="إعراب" note={`ص ${arDigits(tokens[0].page)}`} />

      {/* The sentence, split PER WORD only — never per character (§3.3). Each
          analysed word keeps a stub under it and a number matching its card;
          a straight leader line cannot survive wrapping on a 360px screen, and
          wrapping is not optional here. */}
      <div
        className="ar-block ar-tappable flex flex-wrap items-start justify-center gap-x-1 rounded-md border border-line-soft bg-card px-2.5 py-2 text-[17px]"
        style={a.fade(stepTimes[0], 0.4)}
      >
        {words.map((w, i) => {
          const ti = tokenAtWord(i);
          if (ti < 0)
            return (
              <span key={i} className="text-ink">
                {w.text}
              </span>
            );
          const t = tokens[ti];
          const g = a.gate(delayOf(t.step));
          const lit = g !== "hidden";
          return (
            <span key={i} className="flex flex-col items-center">
              <span
                style={{
                  color: lit ? "var(--accent-deep)" : "inherit",
                  fontWeight: lit ? 600 : undefined,
                  transition: "color 0.35s ease",
                }}
              >
                {w.text}
              </span>
              <span
                className="h-2 w-px bg-accent-deep/45"
                style={a.grow(delayOf(t.step), "y", 0.3)}
              />
              <span
                className="ar-label -mt-px rounded-full border border-accent-deep/45 bg-card px-1 font-mono text-[8.5px] font-bold text-accent-deep"
                style={a.pop(delayOf(t.step))}
              >
                {arDigits(ti + 1)}
              </span>
            </span>
          );
        })}
      </div>

      {/* the إعراب cards */}
      <div className="mt-1.5 flex flex-col gap-1">
        {tokens.map((t, i) => (
          <div
            key={i}
            className="rounded-md border border-line-soft bg-card-warm px-2.5 py-1.5"
            style={a.pop(delayOf(t.step))}
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="ar-label shrink-0 rounded-full border border-accent-deep/45 px-1 font-mono text-[8.5px] font-bold text-accent-deep">
                {arDigits(i + 1)}
              </span>
              <span className="ar-block ar-plain text-[14px] font-semibold text-ink">
                <bdi>{t.word}</bdi>
              </span>
              <span className="ar-block ar-plain text-[12.5px] text-accent-deep">
                <bdi>
                  {t.role}
                  {t.state ? ` · ${t.state}` : ""}
                  {t.mark ? ` · ${t.mark}` : ""}
                </bdi>
              </span>
            </div>
            {/* the citation is part of the figure, not a footnote: this is what
                licenses the analysis above it */}
            <p className="ar-block ar-plain mt-0.5 border-r-2 border-gold/45 pr-1.5 text-[11px] text-ink-soft">
              <bdi>«{t.quote}» — ص {arDigits(t.page)}</bdi>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

/**
 * gloss_table — معاني المفردات (VIZ_SPEC v3 §1.2).
 *
 * The book supplies the lesson's vocabulary before comprehension, in every one
 * of the three lessons (printed 9 as a horizontal strip, 14 and 21 as rows).
 * The same payload feeds the `term_match` widget: the book *shows* the table,
 * then the exercise makes the student reproduce it.
 *
 * spec: {title?, layout?:"rows"|"strip",
 *        entries:[{word, gloss, plural?, singular?, antonym?, step?}],
 *        animate:"sequence"|"none"}
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
import { arDigits } from "./arabic";
import { ArHeader } from "./arabic-ui";

interface Entry {
  word: string;
  gloss: string;
  relations: { label: string; value: string }[];
  step: number;
}

export function GlossTable({ spec, animOn }: VizProps) {
  const entries: Entry[] = arr(spec.entries)
    .map((raw, i) => {
      const e = obj(raw);
      const relations: { label: string; value: string }[] = [];
      // the four relations the exercises drill — printed inside the gloss cell
      // as «وجمعها (أدواء)», so they belong to the row, not to a second table
      if (str(e.plural)) relations.push({ label: "جمعها", value: str(e.plural) });
      if (str(e.singular)) relations.push({ label: "مفردها", value: str(e.singular) });
      if (str(e.antonym)) relations.push({ label: "مضادها", value: str(e.antonym) });
      return {
        word: str(e.word ?? e.term),
        gloss: str(e.gloss ?? e.definition ?? e.meaning),
        relations,
        step: Math.max(1, num(e.step, i + 1)),
      };
    })
    .filter((e) => e.word && e.gloss);
  if (entries.length === 0) throw new VizError("gloss_table: no entries");

  const layout = str(spec.layout, "rows") === "strip" ? "strip" : "rows";
  const steps = [...new Set(entries.map((e) => e.step))].sort((a, b) => a - b);
  const stepTimes = steps.map((_, i) => 0.25 + i * 0.45);
  const delayOf = (s: number) => stepTimes[Math.max(0, steps.indexOf(s))] ?? 0.25;

  const on = animOn && spec.animate !== "none";
  const tl = useVizTimeline((stepTimes[stepTimes.length - 1] ?? 0.25) + 0.9, on, stepTimes);
  const a = makeAnim(on, tl.ctrl);

  const title = str(spec.title, "معاني المفردات");

  return (
    <div dir="rtl" lang="ar" key={tl.key} className="@container py-1">
      <ArHeader label={title} note={`${arDigits(entries.length)} كلمات`} />
      {/* A 7-entry printed strip is unreadable on a phone, so `strip` reflows to
          rows below 420px. Container query, not a viewport one: the figure lives
          inside a board panel whose width has nothing to do with the screen. */}
      <div
        className={
          layout === "strip"
            ? "flex flex-wrap gap-1.5 @max-[420px]:flex-col"
            : "flex flex-col gap-1"
        }
      >
        {entries.map((e, i) => (
          <div
            key={i}
            style={a.pop(delayOf(e.step))}
            className={
              layout === "strip"
                ? "min-w-[110px] flex-1 rounded-md border border-line-soft bg-card px-2 py-1.5 text-center @max-[420px]:grid @max-[420px]:grid-cols-[auto_1fr] @max-[420px]:items-baseline @max-[420px]:gap-x-2.5 @max-[420px]:text-right"
                : "grid grid-cols-[auto_1fr] items-baseline gap-x-2.5 rounded-md border border-line-soft bg-card px-2.5 py-1.5"
            }
          >
            <span
              className={`ar-block ar-plain shrink-0 text-[15px] font-semibold text-accent-deep ${
                // strip: word ABOVE its gloss (the book's paired cell); the
                // reflow to rows turns the pair back into two columns
                layout === "strip" ? "block @max-[420px]:inline" : ""
              }`}
            >
              <bdi>{e.word}</bdi>
            </span>
            <span className="ar-block ar-plain min-w-0 text-[13px] text-ink">
              <bdi>{arDigits(e.gloss)}</bdi>
              {e.relations.map((r) => (
                <span
                  key={r.label}
                  className="ar-label mr-1.5 inline-block rounded-full border border-gold/40 bg-gold-wash px-1.5 py-px align-middle font-mono text-[9px] text-gold"
                >
                  <bdi>
                    {r.label} {r.value}
                  </bdi>
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

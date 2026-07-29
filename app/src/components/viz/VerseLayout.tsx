"use client";

/**
 * verse_layout — البيت (VIZ_SPEC v3 §1.5).
 *
 * A بيت is ONE line in two hemistichs. Rendered as flowing prose it reads as
 * *broken*, not merely plain — which is why the cheapest of the v3 kinds is
 * still in the MVP. صدر right, عجز left, exactly as printed (p.14).
 *
 * spec: {poet?, lines:[{sadr, ajz, step?}], stanzaBreakAfter?:int[],
 *        rhyme?:{tail, emphasize?}, meter?:null,
 *        spans?:[{in:"sadr"|"ajz", line, find, category, label?, purpose?, step?}],
 *        animate:"sequence"|"none"}
 *
 * `meter` is accepted and IGNORED unless the book names the بحر on the page —
 * in this book it never does, and inventing a metre is inventing content.
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
import { arDigits, foldForMatch } from "./arabic";
import { AnnotatedText, ArHeader, resolveSpans, type ArSpan } from "./arabic-ui";

interface Bayt {
  sadr: string;
  ajz: string;
  step: number;
  sadrSpans: ArSpan[];
  ajzSpans: ArSpan[];
}

export function VerseLayout({ spec, animOn }: VizProps) {
  const rawSpans = arr(spec.spans).map(obj);

  const lines: Bayt[] = arr(spec.lines)
    .map((raw, i) => {
      const l = obj(raw);
      const sadr = str(l.sadr ?? l.first);
      const ajz = str(l.ajz ?? l.ajuz ?? l.second);
      const lineNo = i + 1;
      const pick = (where: "sadr" | "ajz", text: string) =>
        resolveSpans(
          text,
          rawSpans.filter(
            (s) => str(s.in, "sadr") === where && num(s.line, 1) === lineNo
          )
        );
      return {
        sadr,
        ajz,
        step: Math.max(1, num(l.step, lineNo)),
        sadrSpans: sadr ? pick("sadr", sadr) : [],
        ajzSpans: ajz ? pick("ajz", ajz) : [],
      };
    })
    .filter((l) => l.sadr && l.ajz);
  if (lines.length === 0) throw new VizError("verse_layout: no complete أبيات");

  const breaks = new Set(
    arr(spec.stanzaBreakAfter)
      .map((n) => num(n, NaN))
      .filter((n) => Number.isFinite(n))
  );

  const rhyme = obj(spec.rhyme);
  const rhymeTail = str(rhyme.tail);
  const rhymeOn = !!rhymeTail && rhyme.emphasize !== false;

  // Lines and spans share ONE step space (the spec's worked example puts the
  // first span at step 4, after three أبيات); the rhyme sweep is always last.
  const allSteps = [
    ...new Set([
      ...lines.map((l) => l.step),
      ...lines.flatMap((l) => [...l.sadrSpans, ...l.ajzSpans].map((s) => s.step)),
    ]),
  ].sort((a, b) => a - b);
  const rhymeStep = (allSteps[allSteps.length - 1] ?? 0) + 1;
  const steps = rhymeOn ? [...allSteps, rhymeStep] : allSteps;
  const stepTimes = steps.map((_, i) => 0.2 + i * 0.7);
  const delayOf = (s: number) => stepTimes[Math.max(0, steps.indexOf(s))] ?? 0.2;

  const on = animOn && spec.animate !== "none";
  const tl = useVizTimeline((stepTimes[stepTimes.length - 1] ?? 0.2) + 1, on, stepTimes);
  const a = makeAnim(on, tl.ctrl);

  const poet = str(spec.poet);

  return (
    <div dir="rtl" lang="ar" key={tl.key} className="@container py-1">
      {poet && <ArHeader label="شعر" note={poet} />}
      <div className="flex flex-col gap-0.5">
        {lines.map((l, i) => (
          <div key={i}>
            <div
              className="grid grid-cols-2 items-baseline gap-x-4 @max-[420px]:grid-cols-1 @max-[420px]:gap-x-0 @max-[420px]:border-r-2 @max-[420px]:border-gold/35 @max-[420px]:pr-2"
              style={a.fade(delayOf(l.step), 0.55)}
            >
              {/* صدر — right column in RTL */}
              <p className="ar-block ar-verse text-[17px] text-ink">
                <AnnotatedText
                  text={l.sadr}
                  spans={l.sadrSpans}
                  a={a}
                  delayOf={delayOf}
                />
              </p>
              {/* عجز — left column; stays right-aligned in its own column when
                  the pair stacks, so the بيت never loses its shape */}
              <p className="ar-block ar-verse text-[17px] text-ink">
                <Ajz
                  line={l}
                  a={a}
                  delayOf={delayOf}
                  rhymeTail={rhymeOn ? rhymeTail : ""}
                  rhymeDelay={delayOf(rhymeStep)}
                />
              </p>
            </div>
            {breaks.has(i + 1) && (
              <div
                className="py-1 text-center text-[11px] tracking-[0.5em] text-gold/70"
                style={a.fade(delayOf(l.step) + 0.3)}
                aria-hidden
              >
                ❊ ❊ ❊
              </div>
            )}
          </div>
        ))}
      </div>
      {rhymeOn && (
        <p
          className="ar-block ar-plain mt-1.5 text-[11px] text-ink-faint"
          style={a.fade(delayOf(rhymeStep) + 0.2)}
        >
          {/* names no rule — الروي is visually undeniable, the بحر is not */}
          <bdi>كل عجز بينتهي بنفس الصوت: «{arDigits(rhymeTail)}»</bdi>
        </p>
      )}
    </div>
  );
}

/** The عجز, with its rhyme tail tinted on the final step. */
function Ajz({
  line,
  a,
  delayOf,
  rhymeTail,
  rhymeDelay,
}: {
  line: Bayt;
  a: ReturnType<typeof makeAnim>;
  delayOf: (s: number) => number;
  rhymeTail: string;
  rhymeDelay: number;
}) {
  const at = rhymeTail ? tailSpan(line.ajz, rhymeTail) : null;
  // a span already annotating the tail wins — never stack two highlights
  const clash = at && line.ajzSpans.some((s) => s.end > at[0]);
  if (!at || clash)
    return (
      <AnnotatedText text={line.ajz} spans={line.ajzSpans} a={a} delayOf={delayOf} />
    );

  const g = a.gate(rhymeDelay);
  const head = line.ajz.slice(0, at[0]);
  return (
    <>
      <AnnotatedText
        text={head}
        spans={line.ajzSpans.filter((s) => s.end <= at[0])}
        a={a}
        delayOf={delayOf}
      />
      <span
        style={{
          color: g === "hidden" ? "inherit" : "var(--gold)",
          fontWeight: g === "hidden" ? "inherit" : 600,
          transition: "color 0.4s ease",
          ...(typeof g === "number"
            ? { animation: `viz-fade 0.5s ease ${g}s both` }
            : {}),
        }}
      >
        {line.ajz.slice(at[0])}
      </span>
    </>
  );
}

/**
 * Match the rhyme against the END of the rendered عجز (never by index — the
 * tail is written bare, the line is vowelled), and return the original-string
 * offset so the highlight lands on the real characters.
 */
function tailSpan(ajz: string, tail: string): [number, number] | null {
  const { folded, map } = foldForMatch(ajz);
  const t = foldForMatch(tail).folded.trim();
  if (!t) return null;
  // ignore closing punctuation: بيت 1's «عَليلا؟» rhymes exactly like بيت 2's
  // «الرَّحيلا», and a question mark must not silently drop it out of the قافية
  let end = folded.length;
  while (end > 0 && /[\s.,؛،؟!:"'«»)\]}…—–]/.test(folded[end - 1])) end--;
  if (!folded.slice(0, end).endsWith(t)) return null;
  return [map[end - t.length], ajz.length];
}

"use client";

/**
 * text_passage — THE signature Arabic primitive (VIZ_SPEC v3 §1.1).
 *
 * In maths the figure is a diagram; in Social Studies it is a map. In Arabic
 * **the passage IS the figure**: an annotated text appears 8× in 17 printed
 * pages, and every in-place annotation the book performs — استخراج targets,
 * منادى tokens, تضاد pairs, أسلوب/غرض labels, hamza positions — is a span over
 * it. Everything else in this vertical is secondary to getting this right.
 *
 * spec: {variant:"quran"|"quote"|"prose"|"dictation"|"grammar", text,
 *        units?:string[], attribution?, basmala?, ayahMarks?:int[],
 *        brackets?:"ornate"|"none", title?, reveal?:"span"|"category"|"all",
 *        spans?:[{find, nth?, category, label?, note?, purpose?, pairWith?, step}],
 *        animate:"sequence"|"none"}
 *
 * Step semantics: step 1 is the passage with every span dormant (plain text,
 * correct typography); step n>1 tints group n−1 and pops its chip. The passage
 * text NEVER animates itself — no draw-on, no per-character reveal — because
 * either would break the shaping of the very thing being taught (§3.3).
 */

import dynamic from "next/dynamic";
import {
  VizError,
  arr,
  makeAnim,
  num,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";
import { arDigits } from "./arabic";
import {
  AnnotatedText,
  SpanChips,
  arTextClass,
  ayahMark,
  resolveSpans,
  spanSteps,
} from "./arabic-ui";

/**
 * Amiri Quran is pulled in ONLY when a Quranic passage actually mounts —
 * next/font emits a family's @font-face into the CSS of whatever module imports
 * it, so a static import here would put a ~130 KB face on the critical path of
 * every maths and Social Studies route (ADR-0006 §3, fonts-quran.ts).
 */
const QuranPassage = dynamic(
  () => import("@/components/QuranPassage").then((m) => m.QuranPassage),
  { ssr: false }
);

const VARIANTS = ["quran", "quote", "prose", "dictation", "grammar"] as const;
type Variant = (typeof VARIANTS)[number];

const FRAME: Record<Variant, string> = {
  quran: "rounded-lg border-2 border-gold/45 bg-card px-4 py-3.5 text-center",
  quote: "rounded-lg border border-gold/40 bg-card-warm px-3.5 py-3",
  prose: "rounded-md border border-line bg-card px-3.5 py-3",
  dictation: "rounded-md border border-dashed border-rust/45 bg-card px-3.5 py-3",
  grammar: "rounded-md border border-line bg-card px-3.5 py-3 border-r-[3px] border-r-accent",
};

const KIND_LABEL: Record<Variant, string> = {
  quran: "قرآن كريم",
  quote: "اقتباس",
  prose: "نص",
  dictation: "إملاء",
  grammar: "تراكيب",
};

export function TextPassage({ spec, animOn }: VizProps) {
  const variant = (
    VARIANTS.includes(str(spec.variant) as Variant) ? str(spec.variant) : "prose"
  ) as Variant;

  // Sealed passages are stored per unit (per-ayah / per-paragraph) because line
  // structure is structural, never carried inside the string. When units are
  // supplied we lay them out with their ۝ markers between them; a single `text`
  // is the flat form the v3 spec shows.
  const units = arr(spec.units)
    .map((u) => str(u))
    .filter(Boolean);
  const ayahMarks = arr(spec.ayahMarks)
    .map((n) => num(n, NaN))
    .filter((n) => Number.isFinite(n));

  let text = str(spec.text);
  if (units.length > 0) {
    text =
      variant === "quran" && ayahMarks.length === units.length
        ? units.map((u, i) => `${u} ${ayahMark(ayahMarks[i])}`).join(" ")
        : units.join(" ");
  }
  if (!text) throw new VizError("text_passage: no text");

  const attribution = str(spec.attribution);
  if ((variant === "quran" || variant === "quote") && !attribution)
    // §3.4: attribution is required and always rendered for quoted text —
    // an unattributed آية or بيت is a citation defect, not a style choice.
    throw new VizError(`text_passage: variant "${variant}" requires an attribution`);

  const title = str(spec.title);
  const ornate = variant === "quote" && str(spec.brackets, "none") === "ornate";
  const reveal = str(spec.reveal, "span");

  // resolve spans, then group them into reveal steps
  const spans = resolveSpans(text, spec.spans);
  if (reveal === "all") spans.forEach((s) => (s.step = 1));
  else if (reveal === "category") {
    const cats = [...new Set(spans.map((s) => s.category))];
    spans.forEach((s) => (s.step = cats.indexOf(s.category) + 1));
  }
  const steps = spanSteps(spans);

  // step 1 = the bare passage; each span group is a step of its own
  const stepTimes = [0.15, ...steps.map((_, i) => 0.9 + i * 0.75)];
  const delayOf = (step: number) => {
    const i = steps.indexOf(step);
    return i < 0 ? stepTimes[0] : stepTimes[i + 1];
  };

  const on = animOn && spec.animate !== "none";
  const tl = useVizTimeline(
    (stepTimes[stepTimes.length - 1] ?? 0.15) + 1,
    on,
    stepTimes
  );
  const a = makeAnim(on, tl.ctrl);

  // The Quran contract (§3.4) — enforced in ONE renderer so no surface can
  // re-implement it wrong: verbatim text, tint-only spans, no justification,
  // no synthesis, ayah numbers as U+06DD, attribution always shown.
  const sacred = variant === "quran";

  if (spec.basmala === true && process.env.NODE_ENV !== "production")
    console.warn(
      "[viz:text_passage] `basmala: true` ignored — the runtime never types " +
        "scripture. Pass the البسملة as the first sealed unit instead (ADR-0006 §2)."
    );

  const body = (
    <p
      className={arTextClass(text, sacred ? "text-[18px]" : "text-[16.5px]")}
      style={sacred ? { lineHeight: "var(--ar-line-vowelled)" } : undefined}
    >
      <AnnotatedText
        text={text}
        spans={spans}
        a={a}
        delayOf={delayOf}
        tintOnly={sacred || ornate}
      />
    </p>
  );

  return (
    <div dir="rtl" lang="ar" key={tl.key} className="py-1">
      <div className={FRAME[variant]} style={a.fade(0.05, 0.45)}>
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="ar-label ar-block font-mono text-[9.5px] font-semibold text-ink-faint">
            {title || KIND_LABEL[variant]}
          </span>
          {attribution ? (
            <span className="ar-label ar-block font-mono text-[9.5px] text-gold">
              <bdi>{arDigits(attribution)}</bdi>
            </span>
          ) : null}
        </div>

        {ornate ? (
          <p className={arTextClass(text, "text-[16.5px]")}>
            <span className="text-gold">﴿</span>
            <AnnotatedText text={text} spans={spans} a={a} delayOf={delayOf} tintOnly />
            <span className="text-gold">﴾</span>
          </p>
        ) : sacred ? (
          <QuranPassage className="block">{body}</QuranPassage>
        ) : (
          body
        )}
      </div>

      <SpanChips spans={spans} a={a} delayOf={delayOf} />
    </div>
  );
}

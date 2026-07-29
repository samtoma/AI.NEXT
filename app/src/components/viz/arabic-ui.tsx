"use client";

/**
 * Shared rendering parts for the VIZ_SPEC v3 Arabic kinds (ADR-0006).
 *
 * The one mechanism worth reading before anything else: **an annotated span is
 * a tint, not a restyle.** A `<mark>` keeps the text run whole, so the cursive
 * join and every mark position survive; its highlight is grown as a background
 * (`viz-mark-in`) instead of faded in, so the letters underneath never flicker.
 * Nothing here ever splits a word into characters, re-vowels a string, or lets
 * `normalizeArabic()` reach the screen (arabic-viz-widgets.md §1.0, §3.3).
 */

import type { CSSProperties, ReactNode } from "react";
import { arDigits, isVowelled, locateSpan } from "./arabic";
import type { Anim } from "./core";
import { arr, num, obj, str } from "./core";

/* ------------------------------------------------------------------ */
/* Span categories — the closed vocabulary of §1.1                     */
/* ------------------------------------------------------------------ */

export interface CategoryStyle {
  /** underline + chip colour */
  line: string;
  /** the highlighter tint */
  tint: string;
  /** colour *and* underline style — never colour alone (accessibility) */
  underline: "solid" | "dashed" | "dotted" | "double" | "wavy" | "none";
}

export const SPAN_CATEGORIES: Record<string, CategoryStyle> = {
  // منادى، مضاف إليه، أداة نداء، بدل
  نحو: { line: "var(--accent-deep)", tint: "rgba(13,74,66,0.16)", underline: "solid" },
  // أسلوب مؤكد، استفهام، أمر، نهي، نداء، تشبيه
  بلاغة: { line: "var(--gold)", tint: "rgba(169,126,34,0.2)", underline: "dashed" },
  // همزة متوسطة / متطرفة
  إملاء: { line: "var(--rust)", tint: "rgba(168,68,42,0.16)", underline: "dotted" },
  // مفرد/جمع/مثنى، فعل مضارع
  صرف: { line: "var(--subject-arabic)", tint: "rgba(107,76,134,0.16)", underline: "double" },
  // معنى، مرادف — tint only, no rule under the word
  معجم: { line: "var(--ink-soft)", tint: "rgba(77,86,105,0.14)", underline: "none" },
  // opposition pairs
  تضاد: { line: "var(--ink-soft)", tint: "rgba(77,86,105,0.14)", underline: "wavy" },
};

export function categoryStyle(c: string | undefined): CategoryStyle {
  return SPAN_CATEGORIES[(c ?? "").trim()] ?? SPAN_CATEGORIES["معجم"];
}

/* ------------------------------------------------------------------ */
/* Spans                                                               */
/* ------------------------------------------------------------------ */

export interface ArSpan {
  find: string;
  nth: number;
  category: string;
  label: string;
  note: string;
  purpose: string;
  pairWith: string;
  step: number;
  start: number;
  end: number;
}

/**
 * Resolve `{find, nth}` anchors against the ORIGINAL text.
 *
 * An unresolved anchor silently drops that ONE span (and warns in dev) — the
 * same failure posture as an unknown gazetteer place in `map_scene`. The
 * passage still renders; a bad anchor must never blank a text the lesson is
 * built on. Producers are gated offline instead, where a failure costs a
 * bundle rather than a student's session.
 */
export function resolveSpans(text: string, raw: unknown): ArSpan[] {
  const out: ArSpan[] = [];
  for (const [i, r] of arr(raw).entries()) {
    const s = obj(r);
    const find = str(s.find ?? s.text ?? s.expression);
    if (!find) continue;
    const nth = Math.max(1, num(s.nth, 1));
    const at = locateSpan(text, find, nth);
    if (!at) {
      if (process.env.NODE_ENV !== "production")
        console.warn(`[viz:arabic] span not found in passage: «${find}» (nth ${nth})`);
      continue;
    }
    out.push({
      find,
      nth,
      category: str(s.category, "معجم"),
      label: str(s.label),
      note: str(s.note),
      purpose: str(s.purpose),
      pairWith: str(s.pairWith),
      step: Math.max(1, num(s.step, i + 1)),
      start: at[0],
      end: at[1],
    });
  }
  // non-overlapping, in reading order — a later span that collides is dropped
  out.sort((a, b) => a.start - b.start);
  const kept: ArSpan[] = [];
  for (const s of out) if (!kept.length || s.start >= kept[kept.length - 1].end) kept.push(s);
  return kept;
}

/** Distinct span steps, ascending. */
export function spanSteps(spans: ArSpan[]): number[] {
  return [...new Set(spans.map((s) => s.step))].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ */
/* The annotated text run                                              */
/* ------------------------------------------------------------------ */

/** Tint style for one span at one moment of the timeline. */
function markStyle(
  st: CategoryStyle,
  a: Anim,
  delay: number,
  tintOnly: boolean
): CSSProperties {
  const g = a.gate(delay);
  const base: CSSProperties = {
    // the UA stylesheet paints <mark> yellow and Tailwind's preflight does not
    // reset it — without this every category tint renders as highlighter yellow
    backgroundColor: "transparent",
    backgroundImage: `linear-gradient(${st.tint}, ${st.tint})`,
    backgroundRepeat: "no-repeat",
    // RTL: the highlighter sweeps from the right edge, the way a hand would
    backgroundPosition: "right center",
    borderRadius: "0.2rem",
    color: "inherit",
    paddingBlock: "0.08em",
  };
  // A dormant span is PLAIN TEXT: the rule goes on with the tint, not before
  // it. Step 1 must look exactly like an unannotated passage (§1.1).
  if (g !== "hidden" && !tintOnly && st.underline !== "none") {
    base.textDecorationLine = "underline";
    base.textDecorationStyle = st.underline;
    base.textDecorationColor = st.line;
    base.textDecorationThickness = "1.5px";
    // clear the kasra / shadda sitting under the baseline
    base.textUnderlineOffset = "0.45em";
  }
  if (g === "hidden") return { ...base, backgroundSize: "0% 100%" };
  if (g === "final") return { ...base, backgroundSize: "100% 100%" };
  return {
    ...base,
    backgroundSize: "100% 100%",
    animation: `viz-mark-in 0.5s ease ${g}s both`,
  };
}

/**
 * Render `text` with its spans tinted. Everything outside a span is emitted
 * verbatim, in one text node per gap, so the browser shapes the passage exactly
 * as if no annotation existed.
 */
export function AnnotatedText({
  text,
  spans,
  a,
  delayOf,
  tintOnly = false,
}: {
  text: string;
  spans: ArSpan[];
  a: Anim;
  /** natural delay (sec) at which a span's step reveals */
  delayOf: (step: number) => number;
  /** Quran/quote contract: tint only, never restyle the glyphs (§3.4) */
  tintOnly?: boolean;
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((s, i) => {
    if (s.start > cursor) parts.push(text.slice(cursor, s.start));
    parts.push(
      <mark
        key={`s${i}`}
        style={markStyle(categoryStyle(s.category), a, delayOf(s.step), tintOnly)}
      >
        {text.slice(s.start, s.end)}
      </mark>
    );
    cursor = s.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/* ------------------------------------------------------------------ */
/* The chip rail — one label per annotated span                        */
/* ------------------------------------------------------------------ */

export function SpanChips({
  spans,
  a,
  delayOf,
}: {
  spans: ArSpan[];
  a: Anim;
  delayOf: (step: number) => number;
}) {
  const shown = spans.filter((s) => s.label || s.note || s.purpose || s.pairWith);
  if (shown.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {shown.map((s, i) => {
        const st = categoryStyle(s.category);
        return (
          <div
            key={i}
            className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5"
            style={a.pop(delayOf(s.step) + 0.18)}
          >
            <span
              className="ar-label shrink-0 rounded-full border px-1.5 py-px font-mono text-[9.5px] font-semibold"
              style={{ color: st.line, borderColor: st.line }}
            >
              {s.label || s.category}
            </span>
            <span className="ar-block ar-plain text-[11.5px] text-ink-soft">
              <bdi>
                «{s.find}»
                {s.pairWith ? ` ↔ «${s.pairWith}»` : ""}
                {s.purpose ? ` — غرضه ${s.purpose}` : ""}
                {s.note ? ` — ${arDigits(s.note)}` : ""}
              </bdi>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small shared bits                                                   */
/* ------------------------------------------------------------------ */

/** The mono kind label every Arabic figure carries, with the tracking reset. */
export function ArHeader({ label, note }: { label: string; note?: string }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2">
      <span className="ar-label font-mono text-[9.5px] font-semibold text-ink-faint">
        {label}
      </span>
      {note ? (
        <span className="ar-label ar-block font-mono text-[9.5px] text-ink-faint">
          <bdi>{arDigits(note)}</bdi>
        </span>
      ) : null}
    </div>
  );
}

/** Body class for an Arabic block: vowelled text gets the taller leading. */
export function arTextClass(text: string, extra = ""): string {
  return `ar-block ${isVowelled(text) ? "ar-vowelled" : "ar-plain"} ${extra}`.trim();
}

/** U+06DD ARABIC END OF AYAH enclosing Arabic-Indic digits (§1.1). */
export function ayahMark(n: number): string {
  return `۝${arDigits(n)}`;
}

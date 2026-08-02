"use client";

import type { ReactNode } from "react";
import type {
  LessonPassage,
  LessonPassageUnit,
} from "@/lib/lesson-content";
import { QuranPassage } from "@/components/QuranPassage";

/**
 * A SEALED passage, rendered verbatim from the verified store (ADR-0006).
 *
 * This component is the ONLY way sacred text reaches a student surface: the
 * bytes come from the pipeline's checksummed seed data, never from a model.
 * The tutor references it by id ({{show_passage:…}}) and by آية number; it is
 * rendered on the read surface AND on the lesson whiteboard — Samuel's field
 * finding: the tutor once said «افتح بطاقة النص» on a surface that had no
 * such card, quizzing the student on text they had never seen.
 *
 * `highlight` marks the span the tutor is currently teaching (Samuel's field
 * call, 2026-08-02: pointing at a whole essay is useless — highlight the line).
 * quote-highlights are matched LOOSELY (diacritics-insensitive) against the
 * sealed words and mark only what matched; the sealed bytes themselves are
 * never altered — the <mark> wraps the store's own tokens.
 *
 * Quran gets the Amiri Quran face (lazy-loaded by this import path only) and
 * per-آية rows with printed numbers; everything else reads in global Naskh.
 */

export interface PassageHighlight {
  /** highlight the whole numbered unit (آية/بيت) — the sacred-safe pointer */
  unit?: number;
  /** verbatim span of a NON-sacred passage (loose-matched) */
  quote?: string;
}

/** Fold one whitespace token the way the containment guard folds words:
 *  drop harakat + annotation marks + punctuation, normalize letter variants —
 *  so an unvocalized model quote still finds the fully vocalized sealed text. */
function foldToken(tok: string): string {
  let w = "";
  for (const ch of tok.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (
      (cp >= 0x064b && cp <= 0x0656) ||
      cp === 0x0670 ||
      (cp >= 0x06d6 && cp <= 0x06ed) ||
      cp === 0x0640 ||
      cp === 0xfd3e ||
      cp === 0xfd3f
    ) {
      continue;
    }
    let c = ch;
    if (ch === "أ" || ch === "إ" || ch === "آ" || ch === "ٱ") c = "ا";
    else if (ch === "ى") c = "ي";
    else if (ch === "ة") c = "ه";
    else if (ch === "ؤ") c = "و";
    else if (ch === "ئ") c = "ي";
    if (/[\s،؛؟.,!:"'()\[\]«»—\-…]/.test(c)) continue;
    w += c;
  }
  return w;
}

/** The tutor points at آيات by their PRINTED number (what the student sees:
 *  ﴿٦٣﴾ — an Arabic-Indic string), while `n` is the sequential unit index.
 *  Accept either, so «الآية ٦٣» and «الوحدة ١» both land. */
export function unitMatches(u: LessonPassageUnit, unit: number): boolean {
  if (u.n === unit) return true;
  if (!u.printed_n) return false;
  const latin = u.printed_n.replace(/[٠-٩]/g, (d) =>
    String("٠١٢٣٤٥٦٧٨٩".indexOf(d))
  );
  return Number(latin) === unit;
}

/** First contiguous run of `tokens` whose folded forms equal the folded quote
 *  words (empty folded tokens — bare punctuation — are transparent). */
function findQuoteRun(
  tokens: string[],
  quote: string
): { start: number; end: number } | null {
  const q = quote.split(/\s+/).map(foldToken).filter(Boolean);
  if (q.length === 0) return null;
  const folded = tokens.map(foldToken);
  for (let i = 0; i < folded.length; i++) {
    let ti = i;
    let qi = 0;
    let last = -1;
    while (ti < folded.length && qi < q.length) {
      if (!folded[ti]) {
        ti++; // punctuation-only token inside the run — skip over it
        continue;
      }
      if (folded[ti] !== q[qi]) break;
      last = ti;
      ti++;
      qi++;
    }
    if (qi === q.length) return { start: i, end: last };
  }
  return null;
}

/** Unit text with the quote-run wrapped in <mark>; null when it doesn't
 *  match this unit (the caller then tries the next unit). */
function markedUnit(
  text: string,
  quote: string,
  markId: string | undefined,
  markCls: string
): ReactNode | null {
  const tokens = text.split(/(\s+)/); // keep separators for faithful re-join
  const wordIdx: number[] = [];
  const words: string[] = [];
  tokens.forEach((t, i) => {
    if (!/^\s*$/.test(t)) {
      wordIdx.push(i);
      words.push(t);
    }
  });
  const run = findQuoteRun(words, quote);
  if (!run) return null;
  const from = wordIdx[run.start];
  const to = wordIdx[run.end];
  return (
    <>
      {tokens.slice(0, from).join("")}
      <mark id={markId} className={markCls}>
        {tokens.slice(from, to + 1).join("")}
      </mark>
      {tokens.slice(to + 1).join("")}
    </>
  );
}

export function SealedPassageCard({
  passage,
  compact = false,
  highlight,
  markId,
}: {
  passage: LessonPassage;
  /** board rendering: tighter type scale, no outer margins */
  compact?: boolean;
  /** span the tutor is pointing at right now (chip scrolls to `markId`) */
  highlight?: PassageHighlight;
  /** DOM id stamped on the highlighted element, for scroll-to */
  markId?: string;
}) {
  const sacred = passage.sacred;
  const markCls = "rounded bg-gold/30 px-0.5 text-inherit";
  // quote highlighting is for NON-sacred passages only (the tutor can never
  // type sacred words, so a sacred quote cannot legitimately exist)
  const quote = !sacred && highlight?.quote ? highlight.quote : undefined;
  // resolve the quote to ONE unit up front (pure computation, no mutation
  // inside the render map): the first unit containing the folded run wins
  let quoteHit: { n: number; node: ReactNode } | null = null;
  if (quote) {
    for (const u of passage.units) {
      const marked = markedUnit(u.text_ar, quote, markId, markCls);
      if (marked) {
        quoteHit = { n: u.n, node: marked };
        break;
      }
    }
  }
  const body = (
    <div className="space-y-2">
      {passage.units.map((u) => {
        const unitHit =
          highlight?.unit != null && unitMatches(u, highlight.unit);
        const content: ReactNode = unitHit ? (
          <mark id={markId} className={markCls}>
            {u.text_ar}
          </mark>
        ) : quoteHit && quoteHit.n === u.n ? (
          quoteHit.node
        ) : (
          u.text_ar
        );
        return (
          <p
            key={u.n}
            className={
              sacred
                ? compact
                  ? "text-[16.5px] leading-[2.1] text-ink"
                  : "text-[19px] leading-[2.3] text-ink"
                : "text-[15px] leading-loose text-ink"
            }
          >
            {content}
            {u.printed_n && (
              <span className="mx-1.5 text-[13px] text-gold">﴿{u.printed_n}﴾</span>
            )}
          </p>
        );
      })}
    </div>
  );
  return (
    <article
      dir="rtl"
      className={`ledger-card px-5 py-4 ${sacred ? "border-gold/45 bg-gold-wash/40" : ""} ${
        compact ? "" : "mt-3 first:mt-0"
      }`}
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[16px] font-medium text-ink">
          {passage.title_ar}
        </h2>
        {passage.attribution_ar && (
          <span className="text-[11px] text-ink-faint">{passage.attribution_ar}</span>
        )}
      </div>
      {sacred ? <QuranPassage>{body}</QuranPassage> : body}
      {sacred && (
        <p className="mt-2 text-[10px] text-ink-faint">
          نصٌّ موثَّق: تمت مطابقته آليًا مع مصدرين مستقلين للمصحف
          {passage.verification_verdict === "agree" ? " · مطابق" : " · قيد المراجعة"}
        </p>
      )}
    </article>
  );
}

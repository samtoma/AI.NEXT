"use client";

import { useMemo, useState } from "react";
import { arDigits } from "@/components/viz/arabic";
import { stableShuffle, useFireOnce } from "./util";

/**
 * {{widget:term_match:{"prompt":"وصّل المصطلح بمعناه","pairs":[{"term":"الجلاء","definition":"رحيل قوات الاحتلال عن البلد المحتل"}],"decoyDefs":["…"]}}}
 *
 * «ضع المصطلح» from the book's «مفاهيم أتعلمها» boxes: tap a term (right
 * column), then its definition (left column). Matched pairs lock in green;
 * a wrong link flashes softly and unselects. Deterministic grading; the
 * result note carries the mistake count, the student never sees a score.
 *
 * **`relation` (ADR-0006).** The Arabic book does not drill "term ↔ meaning";
 * it drills FOUR labelled relations — معنى / مفرد / جمع / مضاد, printed as one
 * exercise on pp.16 and 22 («هاتِ معنى الأولى، ومفرد الثانية، ومُضادَ الثالثة»).
 * Unlabelled matching teaches the wrong thing there: a مضاد pair renders
 * identically to a معنى pair, so a student can win the widget while believing
 * an antonym is a synonym. The label is the fix, and it is the only change —
 * the same `term` may appear twice under two relations, which is precisely the
 * book's exercise.
 */

export type TermRelation = "معنى" | "مرادف" | "مضاد" | "مفرد" | "جمع";

interface Pair {
  term: string;
  definition?: string;
  /** legacy alias from the design spec */
  def?: string;
  relation?: TermRelation | string;
}

/**
 * Relation chips take their colour from the §1.1 span palette (معجم / تضاد /
 * صرف) and a glyph on top of it: معجم and تضاد share a colour there and are
 * separated by underline style, which a chip cannot show.
 */
const RELATION_CHIP: Record<string, { glyph: string; cls: string }> = {
  معنى: { glyph: "≡", cls: "border-ink-faint/50 text-ink-soft" },
  مرادف: { glyph: "≡", cls: "border-ink-faint/50 text-ink-soft" },
  مضاد: { glyph: "↔", cls: "border-rust/45 text-rust" },
  مفرد: { glyph: "⇄", cls: "border-arabic-line text-arabic" },
  جمع: { glyph: "⇄", cls: "border-arabic-line text-arabic" },
};

export function TermMatch({
  prompt,
  pairs,
  decoyDefs,
  onResult,
}: {
  prompt?: string;
  pairs: Pair[];
  decoyDefs?: string[];
  onResult: (note: string) => void;
}) {
  const clean = useMemo(
    () =>
      pairs
        .map((p) => ({
          term: p.term ?? "",
          def: p.definition ?? p.def ?? "",
          relation: typeof p.relation === "string" ? p.relation.trim() : "",
        }))
        .filter((p) => p.term && p.def),
    [pairs]
  );
  const terms = useMemo(
    () =>
      stableShuffle(
        clean.map((_, i) => i),
        // relation + index, so «داء» as معنى and «داء» as جمع don't collide
        (i) => `${clean[i].term}:${clean[i].relation}:${i}`
      ),
    [clean]
  );
  const defs = useMemo(() => {
    const all = [
      ...clean.map((p, i) => ({ text: p.def, pairIdx: i })),
      ...(decoyDefs ?? []).filter(Boolean).map((d) => ({ text: d, pairIdx: -1 })),
    ];
    return stableShuffle(all, (d) => d.text);
  }, [clean, decoyDefs]);

  const fire = useFireOnce(onResult);
  const [selectedTerm, setSelectedTerm] = useState<number | null>(null);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [mistakes, setMistakes] = useState(0);
  const [flashDef, setFlashDef] = useState<number | null>(null);
  const n = clean.length;
  const done = n > 0 && matched.size >= n;

  const tapTerm = (i: number) => {
    if (done || matched.has(i)) return;
    setSelectedTerm((cur) => (cur === i ? null : i));
  };

  const tapDef = (defPos: number) => {
    if (done || selectedTerm === null) return;
    const hit = defs[defPos];
    const already = hit.pairIdx >= 0 && matched.has(hit.pairIdx);
    if (already) return;
    if (hit.pairIdx === selectedTerm) {
      const next = new Set(matched);
      next.add(selectedTerm);
      setMatched(next);
      setSelectedTerm(null);
      if (next.size >= n) {
        // notes are the AI's input, so they name the widget, never the student
        const rels = [...new Set(clean.map((p) => p.relation).filter(Boolean))];
        const what = rels.length > 0 ? `${n} pairs (${rels.join(", ")})` : `${n} terms`;
        fire(
          mistakes === 0
            ? `✓ term_match: matched all ${what} on the first try`
            : `✓ term_match: matched all ${what} after ${mistakes} wrong link${mistakes > 1 ? "s" : ""}`
        );
      }
    } else {
      setMistakes((m) => m + 1);
      setFlashDef(defPos);
      window.setTimeout(() => setFlashDef((f) => (f === defPos ? null : f)), 450);
      setSelectedTerm(null);
    }
  };

  if (n === 0) return null;

  return (
    <div
      dir="rtl"
      className="anim-pop my-2 overflow-hidden rounded-lg border border-accent/40 bg-card shadow-[0_10px_24px_-16px_rgba(13,74,66,0.5)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-accent-wash px-3.5 py-2">
        {/* .ar-label resets the tracking/uppercase of the mono label voice —
            letter-spacing visually breaks the Arabic cursive join (§3.3) */}
        <span className="ar-label font-mono text-[9px] text-accent-deep">
          ✳ تفاعلي · المصطلحات
        </span>
        <span className="ar-label font-mono text-[9px] text-ink-faint">
          دوس على المصطلح وبعدين على معناه
        </span>
      </div>

      <div className="px-3.5 py-3">
        <p className="text-[13px] font-medium leading-relaxed text-ink">
          {prompt || "وصّل كل مصطلح بمعناه"}
        </p>

        <div className="mt-3 grid grid-cols-[1fr_1.7fr] gap-2">
          {/* terms (right column in RTL) */}
          <div className="flex flex-col gap-1.5">
            {terms.map((pairIdx) => {
              const isMatched = matched.has(pairIdx);
              const isSel = selectedTerm === pairIdx;
              return (
                <button
                  key={pairIdx}
                  onClick={() => tapTerm(pairIdx)}
                  disabled={isMatched}
                  className={`rounded-md border px-2 py-1.5 text-[12px] font-semibold leading-snug transition-all duration-150 ${
                    isMatched
                      ? "border-accent bg-accent text-paper"
                      : isSel
                        ? "border-ink bg-ink text-paper shadow-[0_4px_10px_-4px_rgba(32,41,58,0.5)]"
                        : "border-gold/50 bg-gold-wash text-ink hover:-translate-y-px"
                  }`}
                >
                  {clean[pairIdx].relation && (
                    <span
                      className={`ar-label ar-block mb-0.5 block rounded-full border bg-card px-1 py-px font-mono text-[8.5px] font-bold ${
                        RELATION_CHIP[clean[pairIdx].relation]?.cls ??
                        "border-line text-ink-faint"
                      }`}
                    >
                      {RELATION_CHIP[clean[pairIdx].relation]?.glyph ?? "·"}{" "}
                      <bdi>{clean[pairIdx].relation}</bdi>
                    </span>
                  )}
                  <bdi>{clean[pairIdx].term}</bdi>
                </button>
              );
            })}
          </div>
          {/* definitions (left column; includes decoys) */}
          <div className="flex flex-col gap-1.5">
            {defs.map((d, pos) => {
              const isMatched = d.pairIdx >= 0 && matched.has(d.pairIdx);
              return (
                <button
                  key={pos}
                  onClick={() => tapDef(pos)}
                  disabled={isMatched || selectedTerm === null}
                  className={`rounded-md border px-2 py-1.5 text-right text-[11px] leading-snug transition-all duration-150 ${
                    isMatched
                      ? "border-accent/50 bg-accent-wash text-accent-deep"
                      : flashDef === pos
                        ? "border-rust bg-rust-wash text-rust"
                        : selectedTerm !== null
                          ? "border-line bg-card text-ink hover:-translate-y-px hover:border-ink/40"
                          : "border-line-soft bg-card text-ink-soft"
                  }`}
                >
                  <bdi>{arDigits(d.text)}</bdi>
                  {isMatched && d.pairIdx >= 0 && (
                    <span className="mr-1 font-mono text-[9px] font-bold text-accent">
                      ✓ {clean[d.pairIdx].term}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {done && (
          <div className="anim-pop mt-3 rounded-md border border-accent/45 bg-accent-wash px-3 py-2">
            <span className="font-display text-[13.5px] font-medium text-accent-deep">
              {mistakes === 0
                ? `برافو! ${arDigits(n)} مصطلحات كلها صح من أول مرة ✓`
                : "تمام — المصطلحات دي ثبتت. دي نفسها سؤال «ضع المصطلح» في الامتحان"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

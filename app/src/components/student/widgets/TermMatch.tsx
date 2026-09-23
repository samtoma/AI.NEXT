"use client";

import { useMemo, useState } from "react";
import { arDigits } from "@/components/viz/arabic";
import { cx } from "@/components/sticker";
import { stableShuffle, useFireOnce } from "./util";
import {
  OPTION_INK,
  WIDGET_FRAME,
  WIDGET_HEAD,
  WIDGET_HINT_AR,
  WIDGET_KIND_AR,
  WIDGET_OPTION,
  WIDGET_PROMPT,
  WIDGET_RESULT,
} from "./WidgetShell";

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
 * separated by underline style, which a chip cannot show — so the glyph is
 * what tells معنى from مضاد. صرف is the berry playmate, as a paired fill.
 * Nothing here is red: مضاد is an opposite, not an error.
 */
const RELATION_CHIP: Record<string, { glyph: string; cls: string }> = {
  معنى: { glyph: "≡", cls: "bg-card text-[color:var(--play-text-muted)]" },
  مرادف: { glyph: "≡", cls: "bg-card text-[color:var(--play-text-muted)]" },
  مضاد: { glyph: "↔", cls: "bg-card text-[color:var(--play-text-muted)]" },
  مفرد: { glyph: "⇄", cls: "bg-[var(--play-berry)] text-[color:var(--play-on-berry-dim)]" },
  جمع: { glyph: "⇄", cls: "bg-[var(--play-berry)] text-[color:var(--play-on-berry-dim)]" },
};

/** The relation tag inside a term: a small sticker pill. Arabic, so the UI
 *  face, never tracked mono. */
const RELATION_TAG =
  "ar-label ar-block mb-0.5 block rounded-[var(--play-radius-pill)] border-[length:var(--play-stroke-sm)] border-ink px-1 py-px font-display text-[0.72rem] font-bold";

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
    <div dir="rtl" className={WIDGET_FRAME}>
      <div className={WIDGET_HEAD}>
        {/* .ar-label resets the tracking/uppercase of the label voice —
            letter-spacing visually breaks the Arabic cursive join (§3.3) */}
        <span className={WIDGET_KIND_AR}>✳ تفاعلي · المصطلحات</span>
        <span className={WIDGET_HINT_AR}>دوس على المصطلح وبعدين على معناه</span>
      </div>

      <div className="px-3.5 py-3">
        <p className={WIDGET_PROMPT}>{prompt || "وصّل كل مصطلح بمعناه"}</p>

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
                  data-verdict={isMatched ? "correct" : undefined}
                  className={cx(
                    WIDGET_OPTION,
                    "px-2 py-1.5 text-[12px] leading-snug",
                    isMatched
                      ? cx(OPTION_INK.correct, "anim-pop")
                      : isSel
                        ? OPTION_INK.selected
                        : OPTION_INK.idle
                  )}
                >
                  {clean[pairIdx].relation && (
                    <span
                      className={cx(
                        RELATION_TAG,
                        RELATION_CHIP[clean[pairIdx].relation]?.cls ??
                          "bg-card text-[color:var(--play-text-muted)]"
                      )}
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
                  data-verdict={isMatched ? "correct" : flashDef === pos ? "wrong" : undefined}
                  className={cx(
                    WIDGET_OPTION,
                    "px-2 py-1.5 text-start text-[11px] leading-snug",
                    isMatched
                      ? cx(OPTION_INK.correct, "anim-pop")
                      : flashDef === pos
                        ? cx(OPTION_INK.wrong, "anim-nudge")
                        : selectedTerm !== null
                          ? OPTION_INK.idle
                          : OPTION_INK.rest
                  )}
                >
                  <bdi>{arDigits(d.text)}</bdi>
                  {isMatched && d.pairIdx >= 0 && (
                    <span className="ms-1 font-display text-[0.72rem] font-bold">
                      ✓ {clean[d.pairIdx].term}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {done && (
          <div className={cx("mt-3 px-3 py-2", WIDGET_RESULT.correct)}>
            <span className="font-display text-[13.5px] font-bold">
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

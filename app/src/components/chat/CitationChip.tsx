"use client";

import { useState } from "react";
import type { Cite } from "@/lib/chat-parse";

export interface CiteInfo {
  title: string;
  sub?: string;
  page?: number | null;
}

/**
 * Inline receipt-chip for a citation marker — a miniature passport stamp.
 * Hover ⇒ mini provenance card. Click ⇒ delegated to the surface
 * (highlight LO on the graph / open the question modal / pin page reference).
 */
export function CitationChip({
  cite,
  resolve,
  onActivate,
  friendly = false,
}: {
  cite: Cite;
  resolve?: (c: Cite) => CiteInfo | null;
  onActivate?: (c: Cite) => void;
  /** student mode: human labels ("من الكتاب ص40") instead of raw db ids */
  friendly?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const info = hover || pinned ? (resolve?.(cite) ?? null) : null;

  const styles: Record<Cite["kind"], string> = {
    lo: "border-accent/55 bg-accent-wash text-accent-deep hover:bg-accent hover:text-paper",
    q: "border-ink/40 bg-card text-ink-soft hover:bg-ink hover:text-paper",
    page: "border-gold/60 bg-gold-wash text-gold hover:bg-gold hover:text-paper",
    // [[term?:…]] — a term missing from the lesson data, flagged for review
    // (the ministry-terminology rule in the Arabic-script subjects' language
    // contracts). Subtle ochre, review-flag semantics, no action.
    term: "cursor-default border-gold/50 bg-gold-wash/70 text-gold",
  };
  const label =
    cite.kind === "term"
      ? friendly
        ? "مصطلح؟"
        : `term? ${cite.id}`
      : friendly
        ? cite.kind === "page"
          ? `من الكتاب ص${cite.id}`
          : cite.kind === "q"
            ? "تمرين من الكتاب"
            : (resolve?.(cite)?.title ?? cite.id)
        : cite.kind === "page"
          ? `p.${cite.id}`
          : cite.id;

  return (
    <span
      className="relative inline-block align-baseline"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        dir="auto"
        onClick={() => {
          if (cite.kind === "term") return; // review flag — no click action yet
          if (cite.kind === "page") setPinned((p) => !p);
          onActivate?.(cite);
        }}
        className={`mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded border border-dashed px-1 py-px font-semibold leading-[1.35] transition-colors duration-150 ${
          friendly ? "text-[10px]" : "font-mono text-[9.5px] tracking-[0.03em]"
        } ${styles[cite.kind]}`}
      >
        {cite.kind === "lo" && <span aria-hidden>◈</span>}
        {cite.kind === "q" && <span aria-hidden>#</span>}
        {cite.kind === "page" && <span aria-hidden>❡</span>}
        {cite.kind === "term" && <span aria-hidden>✱</span>}
        {label}
      </button>

      {(hover || pinned) && info && (
        <span className="passport anim-pop absolute bottom-full left-1/2 z-30 mb-1.5 block w-52 -translate-x-1/2 p-2.5 shadow-[0_14px_30px_-14px_rgba(32,41,58,0.5)]">
          <span className="relative block">
            <span className="block font-mono text-[8px] uppercase tracking-[0.2em] text-gold">
              {cite.kind === "lo"
                ? "learning objective"
                : cite.kind === "q"
                  ? "question · reviewed"
                  : cite.kind === "term"
                    ? "term · flagged for review"
                    : "source reference"}
            </span>
            <span className="mt-1 block text-[11px] font-medium leading-snug text-ink">
              {info.title}
            </span>
            {info.sub && (
              <span className="mt-0.5 block font-mono text-[9px] leading-relaxed text-ink-soft">
                {info.sub}
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  );
}

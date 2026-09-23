"use client";

import { useState } from "react";
import type { Cite } from "@/lib/chat-parse";
import { STROKE_SM, cx } from "@/components/sticker";

export interface CiteInfo {
  title: string;
  sub?: string;
  page?: number | null;
}

/**
 * Inline receipt-chip for a citation marker — a small sticker pill set in the
 * running text. Hover ⇒ mini provenance card. Click ⇒ delegated to the surface
 * (highlight LO on the graph / open the question modal / pin page reference).
 *
 * It sits INSIDE a line of reading text, so it is the one control in the chat
 * that does not hold the 52px floor: a 52px pill would break the line it
 * annotates. It still wears the sticker (thin stroke, hard shadow, press).
 */
export function CitationChip({
  cite,
  resolve,
  onActivate,
  friendly = false,
  arabic = false,
}: {
  cite: Cite;
  resolve?: (c: Cite) => CiteInfo | null;
  onActivate?: (c: Cite) => void;
  /** student mode: human labels ("book p.40") instead of raw db ids */
  friendly?: boolean;
  /** RTL/Arabic-script subject — friendly labels render in Arabic, not English */
  arabic?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const info = hover || pinned ? (resolve?.(cite) ?? null) : null;

  // Fill + paired foreground per kind; the glyph (◈ # ❡ ✱) carries the kind
  // too, so it is never told by colour alone. No hover recolouring: the press
  // is the feedback, and hover lives inside `play-pressable`'s media query.
  const styles: Record<Cite["kind"], string> = {
    lo: cx(STROKE_SM, "bg-card text-ink sticker-shadow-sm play-pressable"),
    q: cx(STROKE_SM, "bg-card text-ink sticker-shadow-sm play-pressable"),
    // a page of the book — the Honey band with its paired amber text
    page: cx(
      STROKE_SM,
      "bg-card-warm text-[color:var(--play-text-amber-warm)] sticker-shadow-sm play-pressable"
    ),
    // [[term?:…]] — a term missing from the lesson data, flagged for review
    // (the ministry-terminology rule in the Arabic-script subjects' language
    // contracts). Review-flag semantics, no action: the inactive treatment,
    // dashed, no shadow, because it is not a control.
    term: "cursor-default border-[length:var(--play-stroke-sm)] border-dashed border-[color:var(--play-inactive-border)] bg-[var(--play-inactive-fill)] text-[color:var(--play-text-muted)]",
  };
  const label =
    cite.kind === "term"
      ? friendly
        ? arabic
          ? "مصطلح؟"
          : "term?"
        : `term? ${cite.id}`
      : friendly
        ? cite.kind === "page"
          ? arabic
            ? `من الكتاب ص${cite.id}`
            : `book p.${cite.id}`
          : cite.kind === "q"
            ? arabic
              ? "تمرين من الكتاب"
              : "exercise from the book"
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
        className={cx(
          "mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-[var(--play-radius-pill)] px-2 py-px leading-[1.35]",
          friendly
            ? "font-display text-[0.85rem] font-bold"
            : "font-mono text-[0.72rem] font-medium tracking-[0.03em]",
          styles[cite.kind]
        )}
      >
        {cite.kind === "lo" && <span aria-hidden>◈</span>}
        {cite.kind === "q" && <span aria-hidden>#</span>}
        {cite.kind === "page" && <span aria-hidden>❡</span>}
        {cite.kind === "term" && <span aria-hidden>✱</span>}
        {label}
      </button>

      {(hover || pinned) && info && (
        <span
          className={cx(
            STROKE_SM,
            "anim-pop absolute bottom-full left-1/2 z-30 mb-2 block w-60 -translate-x-1/2 rounded-[var(--play-radius-sm)] bg-card p-2.5 text-start text-ink sticker-shadow-sm"
          )}
        >
          <span className="relative block">
            <span className="block font-mono text-[0.72rem] uppercase tracking-[0.2em] text-gold">
              {cite.kind === "lo"
                ? "learning objective"
                : cite.kind === "q"
                  ? "question · reviewed"
                  : cite.kind === "term"
                    ? "term · flagged for review"
                    : "source reference"}
            </span>
            <span className="mt-1 block font-display text-[0.85rem] font-bold leading-snug text-ink">
              {info.title}
            </span>
            {info.sub && (
              <span className="mt-0.5 block font-mono text-[0.72rem] leading-relaxed text-ink-soft">
                {info.sub}
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  );
}

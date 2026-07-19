"use client";

import { useState } from "react";
import type { AttemptResult, SpineQuestion } from "@/lib/types";
import type { Cite } from "@/lib/chat-parse";
import { ChatCore } from "./ChatCore";
import type { CiteInfo } from "./CitationChip";
import { renderVizWidget } from "@/components/viz/render-viz-widget";

const USD_TO_EGP = 48;

const SUGGESTIONS = [
  "What should Omar work on next, and why?",
  "Why is he weak at quadratic functions?",
  "Quiz him on his weakest topic",
  "What did his baseline look like?",
];

/**
 * "Ask the Spine" — collapsible glass-box chat dock on the Evidence Walk.
 * The header carries the live cost meter: instrumentation-as-feature
 * (PRD hard requirement: < EGP 40/student/month, measured from day one).
 */
export function AskSpineDock({
  lookupQuestion,
  resolveCite,
  onCite,
  onCiteClick,
  onAttemptResult,
}: {
  lookupQuestion: (qid: string) => SpineQuestion | undefined;
  resolveCite: (c: Cite) => CiteInfo | null;
  onCite: (c: Cite) => void;
  onCiteClick: (c: Cite) => void;
  onAttemptResult: (r: AttemptResult, q: SpineQuestion) => void;
}) {
  const [open, setOpen] = useState(true);
  const [totalUsd, setTotalUsd] = useState(0);
  const [turns, setTurns] = useState(0);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="anim-pop fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-full border border-accent/40 bg-ink py-2.5 pl-4 pr-5 text-paper shadow-[0_18px_40px_-16px_rgba(13,74,66,0.7)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-deep"
      >
        <SpineGlyph />
        <span className="font-display text-[15px] font-medium">
          Ask the Spine
        </span>
        {turns > 0 && (
          <span className="rounded-full bg-paper/15 px-2 py-0.5 font-mono text-[10px]">
            ${totalUsd.toFixed(2)}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="anim-pop ledger-card fixed bottom-5 right-5 z-40 flex h-[min(74vh,680px)] w-[430px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden">
      {/* header + cost meter */}
      <div className="border-b border-line bg-card-warm px-4 pb-2.5 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-accent-deep">
              <SpineGlyph />
            </span>
            <div>
              <h2 className="font-display text-[17px] font-medium leading-tight text-ink">
                Ask the Spine
              </h2>
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">
                grounded chat · every claim cited
              </p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Collapse chat"
            className="rounded-full p-1.5 text-ink-faint transition-colors hover:bg-line-soft hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M2.5 5.5L7 10l4.5-4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-md border border-dashed border-gold/45 bg-gold-wash px-2.5 py-1.5">
          <span className="font-mono text-[10px] text-ink">
            session AI spend:{" "}
            <strong className="font-semibold">${totalUsd.toFixed(2)}</strong> ·
            ≈ EGP {(totalUsd * USD_TO_EGP).toFixed(2)}
            <span className="text-ink-faint"> · {turns} turns</span>
          </span>
          <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-gold">
            ceiling: EGP 40/student/month
          </span>
        </div>
      </div>

      <ChatCore
        surface="spine_chat"
        suggestions={SUGGESTIONS}
        placeholder="Ask about Omar, the graph, the syllabus…"
        emptyState={
          <div className="anim-fade px-2 py-6 text-center">
            <p className="font-display text-[15px] font-medium text-ink">
              Chat with the curriculum itself.
            </p>
            <p className="mx-auto mt-2 max-w-[300px] text-[12px] leading-relaxed text-ink-soft">
              Answers are grounded in the knowledge graph on the left — watch
              the objectives it cites{" "}
              <span className="font-semibold text-accent-deep">
                light up in real time
              </span>
              , and click any receipt-chip to follow the evidence.
            </p>
          </div>
        }
        lookupQuestion={lookupQuestion}
        resolveCite={resolveCite}
        onCite={onCite}
        onCiteClick={onCiteClick}
        onAttemptResult={onAttemptResult}
        renderWidget={(name, props) => renderVizWidget(name, props)}
        onTotalChange={(t, n) => {
          setTotalUsd(t);
          setTurns(n);
        }}
      />
    </div>
  );
}

function SpineGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M3 13.5h3.2M9.4 9h3.1M6.2 13.5C8 13.5 8 9 9.4 9M12.5 9c1.8 0 1.8-4.5 3.5-4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeDasharray="2.2 2"
      />
      <circle cx="3" cy="13.5" r="1.8" fill="currentColor" />
      <circle cx="9.4" cy="9" r="1.8" fill="currentColor" opacity="0.75" />
      <circle cx="15.5" cy="4.5" r="1.8" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

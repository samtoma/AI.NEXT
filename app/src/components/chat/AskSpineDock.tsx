"use client";

import { useState } from "react";
import type { AttemptResult, SpineQuestion } from "@/lib/types";
import type { Cite } from "@/lib/chat-parse";
import { ChatCore } from "./ChatCore";
import type { CiteInfo } from "./CitationChip";
import { renderVizWidget } from "@/components/viz/render-viz-widget";
import {
  HEADING,
  HONEY_BAND,
  ICON_BUTTON,
  STICKER_CARD,
  STROKE,
  STROKE_SM,
  cx,
} from "@/components/sticker";

/** "Omar Hassan" → "Omar". Inlined when the demo cast (and the module this
 *  lived in) was retired — the student's name now comes from her session. */
const shortName = (displayName: string) => displayName.split(" ")[0] || displayName;

const USD_TO_EGP = 48;

/** Starter prompts, named for whoever the demo is currently showing — the
 *  dock must not keep asking about Omar after the student switcher moves on. */
const suggestionsFor = (name: string) => [
  `What should ${name} work on next, and why?`,
  "Why is this topic still weak?",
  "Quiz the weakest topic",
  "What did the baseline look like?",
];

/**
 * "Ask the Spine" — collapsible glass-box chat dock on the Evidence Walk.
 *
 * The header carries the live cost meter: instrumentation-as-feature. It shows
 * SPEND, and deliberately no ceiling.
 *
 * It used to print "ceiling: EGP 40/student/month". That figure came from a
 * parent price band the new PRD withdrew, and constitution v2.0.0 Principle VI
 * detached it: per-student spend instrumentation and per-surface turn caps stay
 * mandatory, but **no numeric ceiling binds until PRD §10 sets a price**.
 * Displaying one anyway is worse than displaying nothing — it invites the room
 * to reason about headroom against a number nobody has agreed to, and it would
 * read to a reviewer as a limit the product enforces when nothing enforces it.
 */
export function AskSpineDock({
  lookupQuestion,
  resolveCite,
  onCite,
  onCiteClick,
  onAttemptResult,
  studentName = "the student",
}: {
  lookupQuestion: (qid: string) => SpineQuestion | undefined;
  resolveCite: (c: Cite) => CiteInfo | null;
  onCite: (c: Cite) => void;
  onCiteClick: (c: Cite) => void;
  onAttemptResult: (r: AttemptResult, q: SpineQuestion) => void;
  /** the resolved demo student's display name (follows the switcher) */
  studentName?: string;
}) {
  const [open, setOpen] = useState(true);
  const [totalUsd, setTotalUsd] = useState(0);
  const [turns, setTurns] = useState(0);

  if (!open) {
    // The entrance pop lives on the wrapper: an animation that fills `both`
    // keeps its final transform, and animation values outrank the press's
    // translate, so on the same element the button would never move.
    return (
      <div className="anim-pop fixed bottom-6 end-6 z-40">
        <button
          onClick={() => setOpen(true)}
          className={cx(
            STROKE,
            "flex min-h-[var(--noor-touch-min)] items-center gap-2.5 rounded-[var(--play-radius-pill)] bg-ink py-2.5 ps-4 pe-5 text-paper sticker-shadow play-pressable"
          )}
        >
          <SpineGlyph />
          <span className="font-display text-[15px] font-bold">
            Ask the Spine
          </span>
          {turns > 0 && (
            <span className="rounded-[var(--play-radius-pill)] bg-paper/15 px-2 py-0.5 font-mono text-[10px]">
              ${totalUsd.toFixed(2)}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className={cx(
        STICKER_CARD,
        "anim-pop fixed bottom-5 end-5 z-40 flex h-[min(74vh,680px)] w-[430px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden"
      )}
    >
      {/* header + cost meter */}
      <div className={cx(HONEY_BAND, "px-4 pb-2.5 pt-3")}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-accent-deep">
              <SpineGlyph />
            </span>
            <div>
              <h2 className={cx(HEADING, "text-[17px]")}>
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
            className={ICON_BUTTON}
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
        {/* a white inset on the Honey band — solid, not dashed: under Play a
            dashed outline means "disabled", and the meter is live */}
        <div
          className={cx(
            STROKE_SM,
            "mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-[var(--play-radius-sm)] bg-card px-2.5 py-1.5"
          )}
        >
          <span className="font-mono text-[10px] text-ink">
            session AI spend:{" "}
            <strong className="font-semibold">${totalUsd.toFixed(2)}</strong> ·
            ≈ EGP {(totalUsd * USD_TO_EGP).toFixed(2)}
            <span className="text-ink-faint"> · {turns} turns</span>
          </span>
          <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-faint">
            no ceiling set · pricing pending
          </span>
        </div>
      </div>

      <ChatCore
        surface="spine_chat"
        suggestions={suggestionsFor(shortName(studentName))}
        placeholder={`Ask about ${shortName(studentName)}, the graph, the syllabus…`}
        emptyState={
          <div className="anim-fade px-2 py-6 text-center">
            <p className="font-display text-[15px] font-bold text-ink">
              Chat with the curriculum itself.
            </p>
            <p className="mx-auto mt-2 max-w-[300px] text-[12px] leading-relaxed text-ink-soft font-read">
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

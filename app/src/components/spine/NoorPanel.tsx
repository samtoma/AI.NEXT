"use client";

import { useId, useState } from "react";
import type { AttemptResult, SpineQuestion } from "@/lib/types";
import type { Cite } from "@/lib/chat-parse";
import { ChatCore } from "@/components/chat/ChatCore";
import type { CiteInfo } from "@/components/chat/CitationChip";
import { renderVizWidget } from "@/components/viz/render-viz-widget";
import { NoorMark } from "@/components/NoorMark";
import { HONEY_BAND, ICON_BUTTON, STROKE_SM, cx } from "@/components/sticker";

/**
 * Two, and never more than three.
 *
 * Three was the build spec's number and the ceiling still holds — more than
 * that cannot sit above the composer at 300px without the panel scrolling,
 * and a starter prompt you have to scroll to find has already failed at the
 * one job it has. Two is what is left after "Why is this topic still shaky?"
 * came out: the panel is subject-wide and nothing in it says which topic
 * "this" is, so the question either resolved to whatever the model guessed
 * or duplicated what the topic panel already answers for a topic you have
 * actually opened.
 *
 * The copy is first-person because this panel belongs to the student reading
 * it — the old dock asked about "Omar" by name, which only made sense while
 * the screen was a demo being narrated at someone. Who the answer is about
 * is resolved server-side from the session's student, never from the wording
 * of the prompt.
 */
const PROMPTS = ["What should I work on next?", "Make me a study plan"];

/**
 * Noor, docked beside the skill map.
 *
 * DOCKED, never floating: a 340px column with a 3px ink edge, full height of
 * the frame, sharing the row with the tree rather than covering it. The
 * collapsible glass-box dock it replaces floated bottom-right over the graph
 * and carried a live, uncapped session-cost meter — dollars, EGP and turn
 * count — in front of the person it was metering. That meter is gone from the
 * UI layer entirely, not hidden: `onTotalChange` is deliberately not wired
 * here, so the number never reaches this component at all. Spend and turns
 * are still logged server-side for billing and for the console's per-surface
 * turn thresholds, observed rather than enforced since ADR-0023 (constitution
 * VI); they are operational telemetry and have no student-facing surface.
 *
 * `debug={false}` is the same cut applied to everything ChatCore renders
 * underneath: no per-message cost/token rows, no database ids on cards,
 * friendly citation chips ("book p.40" rather than a node key), and the
 * [live event] instrumentation rows hidden.
 *
 * BELOW 1024px (iPad portrait — the handoff's device table: "Nour docks to a
 * bottom sheet") the panel docks under the map, full width, and starts
 * collapsed to its Honey band with a toggle, so the map gets the screen. The
 * conversation is only HIDDEN when collapsed, never unmounted — ChatCore
 * keeps its transcript through any number of open/close cycles. At 1024 and
 * up the toggle does not exist and the panel is the docked column it always
 * was, whatever the toggle's state.
 */
export function NoorPanel({
  subjectLabel,
  lookupQuestion,
  resolveCite,
  onCite,
  onCiteClick,
  onAttemptResult,
}: {
  /** the subject the map is showing, in English ("Mathematics") — the
   *  empty-state line names it rather than assuming maths */
  subjectLabel: string;
  lookupQuestion: (qid: string) => SpineQuestion | undefined;
  resolveCite: (c: Cite) => CiteInfo | null;
  onCite: (c: Cite) => void;
  onCiteClick: (c: Cite) => void;
  onAttemptResult: (r: AttemptResult, q: SpineQuestion) => void;
}) {
  /** The bottom sheet's state below 1024; ignored (always open) above. */
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <aside
      /* 300px at EVERY width from 1024 up — deliberately not the design
         system's 300/340 device table. (Below 1024 it is the bottom sheet,
         full width; see the component comment.)
         The table is right in the abstract and wrong here: a panel that
         steps up 40px as you widen the window reads as the panel growing
         on its own, and the 40px comes straight out of the map beside it.
         Whatever it is worth on paper, a width you can predict is worth
         more than a width that is optimal at two specific viewports. 300
         is the narrower of the two, so the map never loses by it. */
      /* Logical border, so RTL moves the panel to the other side of the
         tree for free — the panel's edge is the only thing that has to flip.
         Width and colour are the Play stroke tokens. */
      /* Below 1024 the same edge moves to the block-start side (the sheet
         sits under the map), and the sheet is 55% of the row when open. */
      className={cx(
        "flex min-h-0 w-full shrink-0 flex-col border-t-[length:var(--play-stroke)] border-solid border-ink bg-card",
        open && "h-[55%]",
        "min-[1024px]:h-auto min-[1024px]:w-[300px] min-[1024px]:border-t-0 min-[1024px]:border-s-[length:var(--play-stroke)]"
      )}
    >
      <div className={cx(HONEY_BAND, "flex shrink-0 items-center gap-3 px-[22px] py-[18px]")}>
        {/* The companion is present, not summoned from a tab — and it is
            carried by motion alone: bob is idle, and it is the one infinite
            loop the design system permits. Never a facial expression. */}
        <span className={cx(STROKE_SM, "anim-bob flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] bg-card")}>
          <NoorMark className="h-7 w-7" />
        </span>
        <h2 className="font-display text-[1.1rem] font-extrabold leading-[1.2] text-ink">
          Got a question?
        </h2>
        {/* The sheet's toggle — only below 1024, where there is a sheet. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? "Hide the chat with Noor" : "Chat with Noor"}
          className={cx(ICON_BUTTON, "ms-auto min-[1024px]:hidden")}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden
            className={cx(
              "transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-180"
            )}
          >
            <path
              d="M2 9l5-5 5 5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div
        id={bodyId}
        className={cx(
          "min-h-0 flex-1 flex-col",
          open ? "flex" : "hidden",
          "min-[1024px]:flex"
        )}
      >
      <ChatCore
        surface="spine_chat"
        debug={false}
        suggestions={PROMPTS}
        suggestionLayout="stacked"
        placeholder="Ask Noor anything…"
        emptyState={
          <p className="font-read px-1 text-[0.95rem] leading-[1.75] text-ink-soft">
            Ask me anything about your {subjectLabel} so far — what to do
            next, why a topic is still weak, or for a study plan before your
            test.
          </p>
        }
        lookupQuestion={lookupQuestion}
        resolveCite={resolveCite}
        onCite={onCite}
        onCiteClick={onCiteClick}
        onAttemptResult={onAttemptResult}
        renderWidget={(name, props) => renderVizWidget(name, props)}
      />
      </div>
    </aside>
  );
}

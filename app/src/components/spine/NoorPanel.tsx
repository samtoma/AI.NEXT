"use client";

import type { AttemptResult, SpineQuestion } from "@/lib/types";
import type { Cite } from "@/lib/chat-parse";
import { ChatCore } from "@/components/chat/ChatCore";
import type { CiteInfo } from "@/components/chat/CitationChip";
import { renderVizWidget } from "@/components/viz/render-viz-widget";
import { NoorMark } from "@/components/NoorMark";

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
 * are still logged server-side for billing and for the per-surface turn caps
 * (constitution VI); they are operational telemetry and have no student-facing
 * surface.
 *
 * `debug={false}` is the same cut applied to everything ChatCore renders
 * underneath: no per-message cost/token rows, no database ids on cards,
 * friendly citation chips ("book p.40" rather than a node key), and the
 * [live event] instrumentation rows hidden.
 */
export function NoorPanel({
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
  return (
    <aside
      /* 300px at EVERY width — deliberately not the design system's
         300/340 device table.
         The table is right in the abstract and wrong here: a panel that
         steps up 40px as you widen the window reads as the panel growing
         on its own, and the 40px comes straight out of the map beside it.
         Whatever it is worth on paper, a width you can predict is worth
         more than a width that is optimal at two specific viewports. 300
         is the narrower of the two, so the map never loses by it. */
      className="flex min-h-0 w-[300px] shrink-0 flex-col bg-card"
      style={{
        // Logical, so RTL moves the panel to the other side of the tree for
        // free — the panel's edge is the only thing that has to flip.
        borderInlineStartWidth: 3,
        borderInlineStartStyle: "solid",
        borderInlineStartColor: "var(--ink)",
      }}
    >
      <div
        className="flex shrink-0 items-center gap-3 bg-card-warm px-[22px] py-[18px]"
        style={{
          borderBlockEndWidth: 3,
          borderBlockEndStyle: "solid",
          borderBlockEndColor: "var(--ink)",
        }}
      >
        {/* The companion is present, not summoned from a tab — and it is
            carried by motion alone: bob is idle, and it is the one infinite
            loop the design system permits. Never a facial expression. */}
        <span className="anim-bob flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[2.5px] border-ink bg-card">
          <NoorMark className="h-7 w-7" />
        </span>
        <h2 className="font-display text-[1.1rem] font-extrabold leading-[1.2] text-ink">
          Got a question?
        </h2>
      </div>

      <ChatCore
        surface="spine_chat"
        debug={false}
        suggestions={PROMPTS}
        suggestionLayout="stacked"
        sendTone="amber"
        placeholder="Ask Noor anything…"
        emptyState={
          <p className="font-read px-1 text-[0.95rem] leading-[1.75] text-ink-soft">
            Ask me anything about your maths so far — what to do next, why a
            topic is still weak, or for a study plan before your test.
          </p>
        }
        lookupQuestion={lookupQuestion}
        resolveCite={resolveCite}
        onCite={onCite}
        onCiteClick={onCiteClick}
        onAttemptResult={onAttemptResult}
        renderWidget={(name, props) => renderVizWidget(name, props)}
      />
    </aside>
  );
}

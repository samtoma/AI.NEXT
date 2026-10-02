"use client";

import type { AttemptResult, SpineQuestion } from "@/lib/types";
import type { Cite } from "@/lib/chat-parse";
import type { MapFocus } from "@/lib/map-focus";
import { ChatCore } from "@/components/chat/ChatCore";
import type { CiteInfo } from "@/components/chat/CitationChip";
import { renderVizWidget } from "@/components/viz/render-viz-widget";
import { NoorMark } from "@/components/NoorMark";
import { HONEY_BAND, STROKE, STROKE_SM, cx } from "@/components/sticker";

/** Starter questions (handoff §7); the last one names what is selected. */
const BASE_PROMPTS = [
  "What should I work on next?",
  "Make me a study plan for this week",
  "What have I improved since I started?",
];
/** Suggestions go once the conversation has this many messages. */
const SUGGESTIONS_UNTIL = 3;

/**
 * Ask Noor — the chat beside the Your Progress Map (FR-3224).
 *
 * Same top and height as the map panel, and the same 79px honey header with
 * the companion bobbing in it. Below 1100px it stacks under the map rather than
 * collapsing into a bar: the map and the conversation about it are read
 * together, and a sheet that hides one of them breaks that.
 *
 * Side by side its width is 38% of the window, between 420px and 620px. A
 * fixed 620px beside the map's 560px minimum needed about 1260px, so on an
 * iPad in landscape (1133–1194px) the chat wrapped under the map at 620px
 * with an empty strip beside it; at 38% the two fit from 1100px up.
 *
 * It knows what is selected on the map (`focus`), and `ChatCore` sends that
 * with every turn; the server resolves it against the curriculum before the
 * tutor sees it (`lib/map-focus.ts`). It explains and plans and never quizzes
 * (`questionCards={false}`, and the prompt says so).
 */
export function NoorPanel({
  subjectLabel,
  focus,
  lookupQuestion,
  resolveCite,
  onCite,
  onCiteClick,
  onAttemptResult,
}: {
  /** the subject the map is showing, in English ("Mathematics") */
  subjectLabel: string;
  focus: MapFocus | null;
  lookupQuestion: (qid: string) => SpineQuestion | undefined;
  resolveCite: (c: Cite) => CiteInfo | null;
  onCite: (c: Cite) => void;
  onCiteClick: (c: Cite) => void;
  onAttemptResult: (r: AttemptResult, q: SpineQuestion) => void;
}) {
  const prompts =
    focus && focus.label ? [...BASE_PROMPTS, `What connects to ${focus.label}?`] : BASE_PROMPTS;
  return (
    <aside
      aria-label="Ask Noor"
      className={cx(
        STROKE,
        "flex min-w-0 basis-full flex-col overflow-hidden rounded-[var(--play-radius)] bg-card sticker-shadow",
        "h-[max(420px,60dvh)] min-[1100px]:h-[max(520px,calc(100dvh_-_252px))] min-[1100px]:w-[clamp(420px,38vw,620px)] min-[1100px]:shrink-0 min-[1100px]:basis-[clamp(420px,38vw,620px)]"
      )}
    >
      <div className={cx(HONEY_BAND, "flex h-[79px] shrink-0 items-center gap-3 px-[18px] py-[14px]")}>
        {/* The companion is present, carried by motion alone: bob is the one
            infinite loop the design system permits. */}
        <span
          className={cx(
            STROKE_SM,
            "anim-bob flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] bg-card"
          )}
        >
          <NoorMark className="h-[30px] w-[30px]" />
        </span>
        <h2 className="font-display text-[1.4rem] font-extrabold leading-none text-ink">Ask Noor</h2>
      </div>

      <ChatCore
        surface="spine_chat"
        debug={false}
        suggestions={prompts}
        suggestionLayout="panel"
        suggestionsUntil={SUGGESTIONS_UNTIL}
        tutorAvatar
        // a long reply is shown from its top — read down, never up (FR-3222)
        alignTutorTop
        mapFocus={focus}
        placeholder="Ask Noor anything…"
        emptyState={
          <p className="font-read px-1 text-[0.95rem] leading-[1.75] text-ink-soft">
            {`Ask me anything about your ${subjectLabel} so far — what to do next, why a topic is still weak, or for a study plan before your test. Tap something on the map and I'll talk about that.`}
          </p>
        }
        // explains and plans, never quizzes (the prompt says so too)
        questionCards={false}
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

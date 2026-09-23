"use client";

/**
 * The reconstruction (contracts/admin.md §5, ADR-0015 §3, FR-2304, FR-2305).
 *
 * **Reconstructed, not recorded.** Nothing here is a picture of the student's
 * screen. Every line is the stored payload re-rendered by the components the
 * student's browser ran — the same `renderChatBlocks`, the same bubbles, the
 * same widget dispatch, the same report card. That is what makes it cheap and
 * honest, and it is also why the label above it is permanent rather than
 * dismissible: an operator deciding whether the tutor taught a child well must
 * know which parts are evidence and which are re-staging.
 *
 * **Read-only is a contract, not an intention** (FR-2305). This module and its
 * imports reach no route that writes: no `/api/ask`, `/api/attempts`,
 * `/api/understanding` or `/api/uploads`, no `lib/analytics` `emit`, no
 * `lib/sessions`. `lib/replay-guard.test.mts` walks this file's transitive
 * import graph and fails the build if any of them appears, so the guarantee
 * survives somebody adding a convenient import six months from now. The three
 * specific things that could have made it false, and what is done instead:
 *
 *  · `ChatQuestionCard` renders an answerable question and posts to
 *    `/api/attempts`. It is NOT imported. A plain answered card is rendered
 *    here instead — the question, what the student typed, whether it was
 *    right — which is what a replay of an already-answered question is.
 *  · The widgets ARE the student's, through `MathWidget readOnly`: pointer
 *    events off, subtree inert, outcome callback swallowed.
 *  · `ReportCard` is the student's, through `readOnly`: the three next-step
 *    doors are dropped, since they route into the student build and an
 *    operator must not take a student's action.
 *
 * `"use client"` is here for one reason: `MathWidget` takes an `onOutcome`
 * function, and a function prop cannot cross the server/client boundary. The
 * component holds no state and fetches nothing.
 */

import { StudentBubble, TutorBubble, renderChatBlocks } from "@/components/chat/message-blocks";
import { Chip, stamp } from "@/components/console/ui";
import { RendererMark } from "@/components/console/TimelineView";
import { ReportCard } from "@/components/student/ReportCard";
import { MathWidget } from "@/components/student/widgets/render-math-widget";
import { parseMessage } from "@/lib/chat-parse";
import type { LessonMode, Verdict } from "@/lib/types";
import { humanDuration, type TimelineItem } from "@/lib/timeline-rules";

const VERDICTS: readonly Verdict[] = ["got_it", "nearly", "needs_work"];

export function ReplayTranscript({
  items,
  currentRelease,
  studentName,
}: {
  items: readonly TimelineItem[];
  currentRelease: string;
  studentName: string;
}) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Frame key={item.key} item={item} currentRelease={currentRelease} studentName={studentName} />
      ))}
    </div>
  );
}

function Frame({
  item,
  currentRelease,
  studentName,
}: {
  item: TimelineItem;
  currentRelease: string;
  studentName: string;
}) {
  // A pause the student lived through. It is part of the experience being
  // reconstructed, so it is drawn rather than closed up.
  if (item.kind === "gap") {
    return (
      <div className="flex items-center gap-3 py-1 text-ink-faint">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em]">
          {humanDuration(item.ms)} passed
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }

  // Never on the student's screen: a mastery estimate moving and an
  // explanation-log row are the system's record of the episode, not part of
  // it. They stay in the timeline, where they belong, rather than being
  // invented into a reconstruction of what a child saw.
  if (item.kind === "mastery" || item.kind === "explanation") return null;

  return (
    <section className="rounded-lg border border-line bg-paper">
      <TurnHeader item={item} currentRelease={currentRelease} />
      <div className="space-y-2 px-3 py-3">
        {item.kind === "turn" && (
          <>
            <StudentBubble>{item.userMessage}</StudentBubble>
            <TutorBubble>
              {renderChatBlocks(parseMessage(item.assistantMessage, false), {
                // No `resolveCite`/`onCiteClick`: a citation chip in a
                // reconstruction is a label, not a control. It renders the
                // friendly text the student read and opens nothing.
                slots: {
                  widget: (b, i) => (
                    <MathWidget
                      key={i}
                      name={b.name}
                      payload={b.props}
                      readOnly
                      onOutcome={() => {}}
                      fallback={
                        <p className="ds-empty my-1.5 rounded border border-dashed border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                          an interactive {b.name} was shown here and cannot be rebuilt from the
                          stored payload
                        </p>
                      }
                    />
                  ),
                },
              })}
            </TutorBubble>
          </>
        )}

        {(item.kind === "attempt" || item.kind === "widget") && (
          <AnsweredCard item={item} />
        )}

        {item.kind === "understanding" && (
          <ReportCard
            readOnly
            studentName={studentName}
            costUsd={0}
            mode={(item.mode === "review" ? "review" : "learn") as LessonMode}
            check={{
              id: item.checkId,
              mode: (item.mode === "review" ? "review" : "learn") as LessonMode,
              score: item.score,
              // The column is free text; the component's union is not. An
              // unrecognised verdict falls back to the middle stamp rather
              // than crashing a transcript over a value nobody has seen yet.
              verdict: (VERDICTS as readonly string[]).includes(item.verdict)
                ? (item.verdict as Verdict)
                : "nearly",
              strengths: item.strengths,
              gaps: item.gaps,
              nextStep: item.nextStep ?? "",
              turns: item.turns,
            }}
          />
        )}

        {item.kind === "upload" && (
          <div className="rounded-lg border border-line-soft bg-card px-3 py-2.5 text-[13px] text-ink">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              the student sent a photo
            </p>
            <p className="mt-1">
              {item.fileType} · <Chip tone={item.parseStatus === "parsed" ? "good" : "attention"}>{item.parseStatus}</Chip>
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
              {item.parsedText
                ? `Read from it: ${item.parsedText}`
                : "Nothing was read from it, so the tutor taught from the conversation alone."}
            </p>
            <p className="mt-1.5 font-mono text-[10.5px] text-ink-faint">
              The image itself is not re-served here: a reconstruction shows what the tutor was
              given to work with, and that is the text above.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The three facts every turn carries in a replay (admin.md §5): when it
 * happened, which model produced it, and which renderer drew it — with the
 * "differs from current renderer" mark when today's build is not that one.
 */
function TurnHeader({
  item,
  currentRelease,
}: {
  item: Exclude<TimelineItem, { kind: "gap" }>;
  currentRelease: string;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft bg-card px-3 py-1.5">
      <span className="font-mono text-[11px] text-ink-faint">{stamp(item.at)}</span>
      {item.kind === "turn" ? (
        <>
          <span className="font-mono text-[11px] text-ink-faint">{item.model}</span>
          <RendererMark version={item.rendererVersion} currentRelease={currentRelease} />
        </>
      ) : (
        <span className="font-mono text-[11px] text-ink-faint">
          rendered by the current build — {currentRelease} — from stored fields
        </span>
      )}
      <span className="ms-auto font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
        reconstructed
      </span>
    </header>
  );
}

/**
 * An answered question, as a replay can honestly show one.
 *
 * `ChatQuestionCard` is the student's card and is deliberately not used: it is
 * answerable and it posts to `/api/attempts`. What a replay has is an attempt
 * that is already answered — so the card here shows the question, the answer
 * the student gave and the verdict they were shown, and nothing is clickable.
 *
 * A widget attempt gets the real construction through the student's own widget
 * in `readOnly` mode, because the construction IS the question (ADR-0009) and
 * a line of text cannot stand in for a circle somebody drew.
 */
function AnsweredCard({
  item,
}: {
  item: Extract<TimelineItem, { kind: "attempt" | "widget" }>;
}) {
  const spec = item.widgetSpec as { kind?: unknown; spec?: unknown } | null;
  const widgetKind = typeof spec?.kind === "string" ? spec.kind : null;
  const widgetProps =
    spec?.spec && typeof spec.spec === "object" ? (spec.spec as Record<string, unknown>) : {};

  return (
    <div className="rounded-lg border border-line-soft bg-card px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        the student was asked
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink">
        {item.questionStem ?? (
          <em className="text-ink-soft">
            This question is no longer in the bank, so its wording cannot be reconstructed.
          </em>
        )}
      </p>

      {item.kind === "widget" && widgetKind && (
        <div className="mt-2">
          <MathWidget
            name={widgetKind}
            payload={widgetProps}
            hostShowsPrompt
            readOnly
            onOutcome={() => {}}
            fallback={
              <p className="ds-empty rounded border border-dashed border-line px-2 py-1.5 font-mono text-[10.5px] text-ink-faint">
                The construction could not be rebuilt from the stored spec.
              </p>
            }
          />
        </div>
      )}

      <p className="mt-2 text-[13px] text-ink">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
          they answered
        </span>{" "}
        {item.givenAnswer ?? <em className="text-ink-soft">nothing was recorded</em>}{" "}
        <Chip tone={item.isCorrect ? "good" : "attention"}>
          {item.isCorrect ? "correct" : "not yet"}
        </Chip>
      </p>
      {item.misconceptionId && (
        <p className="mt-1 text-[12.5px] text-ink-soft">
          The tutor read this as {item.misconceptionLabel ?? "an unlabelled misconception"}{" "}
          <span className="font-mono text-[11px] text-ink-faint">{item.misconceptionId}</span>.
        </p>
      )}
    </div>
  );
}

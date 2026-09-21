/**
 * One time order, rendered (contracts/admin.md §4, FR-2303).
 *
 * **This is not a replay and must not be mistaken for one.** The timeline is
 * the *record*: every source, each row shown as the fields it actually has,
 * with its time and its identifiers. The replay next door re-renders the same
 * turns through the student's components and is labelled a reconstruction. The
 * difference matters to an operator judging whether the tutor taught well —
 * here they are reading evidence, there they are reading a re-staging — so the
 * two surfaces deliberately do not look alike.
 *
 * Message text IS shown here, in full, because this is a transcript view and
 * the whole point of the audit row that opening it writes is that somebody read
 * a child's conversation. A truncated transcript with a "show more" would be
 * the same read with a smaller audit trail.
 *
 * **Gaps are items, not spacing.** A nine-minute pause is drawn as its own row
 * with its own duration. Rendering it as whitespace would leave the reader to
 * subtract two timestamps, which they will not do, and the transcript would
 * quietly claim the student answered immediately.
 */

import { renderChatBlocks } from "@/components/chat/message-blocks";
import { Chip, stamp } from "@/components/console/ui";
import { parseMessage } from "@/lib/chat-parse";
import { humanDuration, type TimelineItem } from "@/lib/timeline-rules";

export function TimelineView({
  items,
  currentRelease,
}: {
  items: readonly TimelineItem[];
  /** The running build, for the "differs from current renderer" mark. */
  currentRelease: string;
}) {
  return (
    <ol className="space-y-2">
      {items.map((item) => (
        <li key={item.key}>
          <Item item={item} currentRelease={currentRelease} />
        </li>
      ))}
    </ol>
  );
}

function Item({ item, currentRelease }: { item: TimelineItem; currentRelease: string }) {
  if (item.kind === "gap") {
    return (
      <div className="flex items-center gap-3 px-1 py-1.5 text-ink-faint">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em]">
          {humanDuration(item.ms)} elapsed
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }

  return (
    <article className="rounded-lg border border-line bg-card">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line-soft px-3 py-1.5">
        <Chip tone={item.kind === "mastery" ? "good" : "neutral"}>{KIND_LABEL[item.kind]}</Chip>
        <span className="font-mono text-[11px] text-ink-faint">{stamp(item.at)}</span>
        {item.kind === "turn" && (
          <>
            <span className="font-mono text-[11px] text-ink-faint">{item.model}</span>
            <RendererMark version={item.rendererVersion} currentRelease={currentRelease} />
            {item.outcome !== "ok" && <Chip tone="attention">{item.outcome}</Chip>}
          </>
        )}
      </header>
      <div className="px-3 py-2.5 text-[13px] leading-relaxed text-ink">
        <Body item={item} />
      </div>
    </article>
  );
}

const KIND_LABEL: Record<Exclude<TimelineItem["kind"], "gap">, string> = {
  turn: "Tutor turn",
  attempt: "Answer",
  widget: "Widget outcome",
  understanding: "Understanding check",
  upload: "Upload",
  mastery: "Mastery movement",
  explanation: "Explanation",
};

/**
 * Which build drew this turn, and whether today's would draw it differently
 * (ADR-0015 §3). Three states, all of them stated: matches, differs, or was
 * never recorded — the last for turns written before migration 020, which must
 * not be silently presented as matching.
 */
export function RendererMark({
  version,
  currentRelease,
}: {
  version: string | null;
  currentRelease: string;
}) {
  if (version == null) {
    return <Chip tone="attention">renderer not recorded</Chip>;
  }
  if (version !== currentRelease) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-ink-faint">{version}</span>
        <Chip tone="attention">differs from current renderer</Chip>
      </span>
    );
  }
  return <span className="font-mono text-[11px] text-ink-faint">{version}</span>;
}

function Body({ item }: { item: Exclude<TimelineItem, { kind: "gap" }> }) {
  switch (item.kind) {
    case "turn":
      return (
        <div className="space-y-2">
          <Quote who="The student wrote" text={item.userMessage} />
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              The tutor answered
            </p>
            <div className="mt-1 rounded border border-line-soft bg-card-warm px-2.5 py-2">
              {renderChatBlocks(parseMessage(item.assistantMessage, false), { debug: true })}
            </div>
          </div>
          <p className="font-mono text-[11px] text-ink-faint">
            turn {item.turnIndex} · {item.surface}
            {item.surfaceKind ? ` / ${item.surfaceKind}` : ""} · {item.inputTokens.toLocaleString()} in
            → {item.outputTokens.toLocaleString()} out tokens
            {item.cacheReadTokens + item.cacheCreationTokens > 0
              ? ` (cache read ${item.cacheReadTokens.toLocaleString()}, written ${item.cacheCreationTokens.toLocaleString()})`
              : ""}{" "}
            · ${item.costUsd.toFixed(4)} imputed at list price ·{" "}
            {item.latencyMs == null ? "latency not recorded" : `${(item.latencyMs / 1000).toFixed(1)} s to answer`}
          </p>
        </div>
      );

    case "attempt":
    case "widget":
      return (
        <div className="space-y-1.5">
          <p className="text-ink-soft">
            {item.questionStem ?? (
              <em>The question is no longer in the bank; only the attempt remains.</em>
            )}{" "}
            <span className="font-mono text-[11px] text-ink-faint">{item.questionId}</span>
          </p>
          <p>
            <strong>Answered:</strong>{" "}
            {item.givenAnswer == null ? <em>nothing recorded</em> : item.givenAnswer}{" "}
            <Chip tone={item.isCorrect ? "good" : "attention"}>
              {item.isCorrect ? "correct" : "not yet"}
            </Chip>{" "}
            {!item.isCorrect && item.correctAnswer != null && (
              <span className="text-ink-soft">
                (the bank&apos;s answer: {item.correctAnswer})
              </span>
            )}
          </p>
          <p className="font-mono text-[11px] text-ink-faint">
            {item.modality === "widget" ? "answered by construction" : "answered as a question"} ·{" "}
            {item.timeMs == null ? "time not recorded" : `${humanDuration(item.timeMs)} on this question`}
            {item.loLabel || item.loId
              ? ` · ${item.loLabel ?? "unlabelled objective"} ${item.loId ?? ""}`
              : ""}
          </p>
          {item.misconceptionId && (
            <p className="text-[12.5px] text-ink-soft">
              Diagnosed: {item.misconceptionLabel ?? "an unlabelled misconception"}{" "}
              <span className="font-mono text-[11px] text-ink-faint">{item.misconceptionId}</span>
            </p>
          )}
        </div>
      );

    case "understanding":
      return (
        <div className="space-y-1.5">
          <p>
            <strong>{item.verdict.replace(/_/g, " ")}</strong> · scored {item.score} out of 100 ·{" "}
            {item.mode} mode · {item.turns} turns
          </p>
          <p className="font-mono text-[11px] text-ink-faint">
            {item.loLabel ?? "unlabelled objective"} {item.loId}
          </p>
          {item.strengths.length > 0 && (
            <p className="text-[12.5px] text-ink-soft">Held: {item.strengths.join("; ")}</p>
          )}
          {item.gaps.length > 0 && (
            <p className="text-[12.5px] text-ink-soft">Gaps: {item.gaps.join("; ")}</p>
          )}
          {item.nextStep && (
            <p className="text-[12.5px] text-ink-soft">Next step offered: {item.nextStep}</p>
          )}
        </div>
      );

    case "upload":
      return (
        <div className="space-y-1.5">
          <p>
            A {item.fileType} was uploaded ·{" "}
            <Chip tone={item.parseStatus === "parsed" ? "good" : "attention"}>
              {item.parseStatus}
            </Chip>
          </p>
          <p className="font-mono text-[11px] text-ink-faint">
            stored at {item.storagePath}
            {item.linkedLoId ? ` · linked to ${item.linkedLoId}` : ""}
          </p>
          {item.parsedText ? (
            <div className="rounded border border-line-soft bg-paper-deep px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-soft">
              {item.parsedText}
            </div>
          ) : (
            <p className="text-[12.5px] text-ink-soft">
              No text was extracted, so the tutor had nothing from this photo to ground on.
            </p>
          )}
        </div>
      );

    case "mastery":
      return (
        <div className="space-y-1.5">
          <p>
            {item.loLabel ?? "unlabelled objective"}{" "}
            <span className="font-mono text-[11px] text-ink-faint">{item.loId}</span>
          </p>
          <p>
            <strong>
              {item.priorScore == null
                ? "first estimate"
                : `${item.priorScore.toFixed(2)} → ${item.posteriorScore.toFixed(2)}`}
            </strong>{" "}
            <span className="text-[12px] text-ink-soft">
              probability of mastery, 0–1 (BKT posterior)
            </span>
          </p>
          <p className="font-mono text-[11px] leading-relaxed text-ink-faint">
            evidence: {item.evidence == null ? "none recorded" : JSON.stringify(item.evidence)}
          </p>
        </div>
      );

    case "explanation":
      return (
        <div className="space-y-1.5">
          <p>
            An explanation was produced for attempt{" "}
            <span className="font-mono text-[11px]">#{item.attemptId}</span> on question{" "}
            <span className="font-mono text-[11px]">{item.questionId}</span>.
          </p>
          <p className="flex flex-wrap items-center gap-1.5">
            <Chip tone={item.groundedOk ? "good" : "attention"}>
              {item.groundedOk ? "grounded" : "not grounded"}
            </Chip>
            <Chip>{item.cached ? "served from cache" : "generated"}</Chip>
            <span className="font-mono text-[11px] text-ink-faint">
              {item.model} · prompt {item.promptVersion}
            </span>
          </p>
          <p className="text-[12.5px] leading-relaxed text-ink-soft">
            The explanation&apos;s text is not shown here: it reaches a timeline only through its
            attempt, and what an operator is judging at this point is whether it was grounded and
            which prompt produced it.
          </p>
        </div>
      );
  }
}

function Quote({ who, text }: { who: string; text: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">{who}</p>
      <p className="mt-1 whitespace-pre-wrap rounded border border-line-soft bg-paper-deep px-2.5 py-2 text-ink">
        {text}
      </p>
    </div>
  );
}

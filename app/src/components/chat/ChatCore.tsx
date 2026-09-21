"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AttemptResult,
  ChatMsg,
  SpineQuestion,
  SpineSubject,
  TurnMeta,
} from "@/lib/types";
import { stepText } from "@/lib/types";
import { labelArOfSpineKey } from "@/lib/subjects";
import {
  directiveEndAt,
  extractAnswerSubmitted,
  extractCites,
  extractHighlights,
  hasRevealAnswerDirective,
  parseMessage,
  stripIncompleteTail,
  type Cite,
} from "@/lib/chat-parse";
import { submitAttempt } from "@/lib/attempts-client";
import { TeX } from "@/components/TeX";
import { CitationChip, type CiteInfo } from "./CitationChip";
import { ChatQuestionCard } from "./ChatQuestionCard";

/**
 * Imperative bridge for surfaces that host intercepted cards OUTSIDE the
 * transcript (the lesson whiteboard): board-hosted question/widget cards
 * report their outcomes back into the chat flow through this.
 */
export interface ChatCoreHandle {
  /** a board-hosted question card was answered */
  attemptResult(r: AttemptResult, q: SpineQuestion): void;
  /** a board-hosted widget reported an outcome note */
  widgetNote(note: string): void;
}

/**
 * A suggestion chip is either plain text — sent as a normal chat turn — or an
 * action chip whose `onSelect` fires directly (e.g. the lesson's inline
 * "Finish lesson" chip, which must act exactly like the header button and
 * never round-trip through the model).
 */
export type ChatSuggestion = string | { label: string; onSelect: () => void };

export interface ChatCoreProps {
  surface: "spine_chat" | "student_chat" | "lesson_learn" | "lesson_review";
  suggestions?: ChatSuggestion[];
  questionId?: string;
  wrongAnswer?: string;
  /** lesson slug for the lesson surfaces (e.g. "geo1-2") */
  lessonSlug?: string;
  /** stable chat-session id (session restore keeps the server turn caps) */
  sessionId?: string;
  /** restored transcript (session restore) — suppresses autoStart */
  initialMessages?: ChatMsg[];
  /** message auto-sent on first mount (student re-explanation flow) */
  autoStart?: string;
  /** hide the auto-start user bubble (AI-led lesson: the tutor opens) */
  autoStartHidden?: boolean;
  placeholder?: string;
  emptyState?: React.ReactNode;
  /**
   * Instrumentation mode (default true — the glass-box demo surfaces).
   * false = student mode: no cost/token meta rows, no db ids on cards,
   * friendly citation chips, [live event] rows hidden.
   */
  debug?: boolean;
  /**
   * True only for the RTL/Arabic-script subjects (`isRtlSubject`/
   * `isRtlSpineSubject` in `lib/subjects.ts`). Independent of `debug` — this
   * is the language axis, not the instrumentation axis. Default false keeps
   * every hardcoded student-facing string here in English, which is the
   * MVP 1.0 default; a caller passes true only when it knows its subject is
   * one of the RTL verticals.
   */
  arabicUi?: boolean;
  /** scripted local line shown instantly while the first AI turn streams */
  openingLine?: string;
  lookupQuestion?: (qid: string) => SpineQuestion | undefined;
  resolveCite?: (c: Cite) => CiteInfo | null;
  /** fired live while revealing, once per newly-cited/highlighted target */
  onCite?: (c: Cite) => void;
  onCiteClick?: (c: Cite) => void;
  onAttemptResult?: (r: AttemptResult, q: SpineQuestion) => void;
  /**
   * Socratic-probing prototype (wip/socratic-probing-route-b): fired whenever
   * ChatCore's own confirmation-pending state changes (lesson_learn only —
   * null on every other surface). A sibling surface that hosts its own
   * question cards outside the transcript (the lesson whiteboard) mirrors
   * this into its own state so ITS cards gate the same way; ChatCore stays
   * the single source of truth since it already owns handleAttempt.
   */
  onPendingConfirmationChange?: (
    pending: {
      loId: string;
      lastAttemptId: number;
      wrongCount: number;
      questionId: string;
    } | null
  ) => void;
  /** Socratic-probing prototype: fired whenever ChatCore grades a chat-typed
   *  answer itself (see onPendingConfirmationChange) — mirrored the same way
   *  so a board-hosted card can sync its own display too. */
  onExternalAttemptChange?: (
    attempt: { questionId: string; result: AttemptResult } | null
  ) => void;
  onTotalChange?: (totalUsd: number, turns: number) => void;
  /** render a {{widget:…}} directive as a live interactive card */
  renderWidget?: (
    name: string,
    props: Record<string, unknown>,
    emitNote: (note: string) => void
  ) => React.ReactNode;
  /** render a {{show_passage:…}} directive: the surface resolves the SEALED
   *  passage bytes by id (ADR-0006 — the model only ever carries the id, plus
   *  an optional span pointer: quote words for prose, unit number for sacred) */
  renderPassage?: (
    id: string,
    span?: { quote?: string; unit?: number; view?: "line" | "context" }
  ) => React.ReactNode;
  /** rendered INSIDE the scroll flow, above the first message — the lesson
   *  surfaces pin the sealed passage(s) here so the exchange opens on the
   *  text itself (Samuel: everything drawn inside the same exchange) */
  leading?: React.ReactNode;
  /** auto-send a hidden "Continue." turn after each widget/question result */
  autoContinue?: boolean;
  /**
   * Whiteboard interception (pure predicate, safe to call during render):
   * true ⇒ the surface owns this card on its board and the transcript renders
   * a small re-pin chip instead. Called with ("viz"|"viz_ref", props) and
   * ("question", {qid}).
   */
  interceptWidget?: (name: string, props: Record<string, unknown>) => boolean;
  /**
   * Fired once per viz/viz_ref/question directive when the paced reveal
   * first uncovers it, and again on every re-pin chip tap — the surface
   * pushes/focuses its board here.
   */
  onDirective?: (name: string, props: Record<string, unknown>) => void;
  /** receives the imperative bridge for board-hosted cards */
  handleRef?: React.MutableRefObject<ChatCoreHandle | null>;
  /** fired once per assistant message, after its paced reveal completes */
  onAssistantDone?: (text: string) => void;
  /** fired when a fully revealed assistant message carries {{finish_lesson}} */
  onFinishDirective?: () => void;
  /** the "open" button of a {{switch_subject:…}} handoff card was tapped */
  onSwitchSubject?: (subject: SpineSubject) => void;
  /** fired when the server turn cap is reached */
  onCapped?: () => void;
  /** transcript mirror for the parent (rating pass) */
  onMessagesChange?: (msgs: ChatMsg[]) => void;
  /** extra control rendered beside the input (mic button) */
  inputAccessory?: (api: { setInput: (v: string) => void }) => React.ReactNode;
}

/* ---------------- paced reveal tuning ---------------- */

/** ~200 wpm: reveal WORDS_PER_TICK words every TICK_MS. */
const WORDS_PER_TICK = 3;
const TICK_MS = 850;
/** extra dwell at sentence ends / beat boundaries / after a figure lands */
const SENTENCE_MS = 1150;
const BEAT_MS = 1700;
const DIRECTIVE_MS = 1500;
/** waiting for more stream when reveal caught up */
const STARVED_MS = 110;
/** once the stream is done, the remaining reveal never exceeds this */
const CATCHUP_BUDGET_MS = 2000;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Sent by the check-in card's affirmative button and the matching lesson
// suggestion chip — the one literal string both call sites use as their
// "the student says they're done" signal (see CheckInCard, LessonSession).
const GOT_IT_SENTINEL = "Got it — next ✓";

export function ChatCore({
  surface,
  suggestions = [],
  questionId,
  wrongAnswer,
  lessonSlug,
  sessionId,
  initialMessages,
  autoStart,
  autoStartHidden,
  placeholder = "Ask the spine…",
  emptyState,
  debug = true,
  arabicUi = false,
  openingLine,
  lookupQuestion,
  resolveCite,
  onCite,
  onCiteClick,
  onAttemptResult,
  onPendingConfirmationChange,
  onExternalAttemptChange,
  onTotalChange,
  renderWidget,
  renderPassage,
  leading,
  autoContinue,
  interceptWidget,
  onDirective,
  handleRef,
  onAssistantDone,
  onFinishDirective,
  onSwitchSubject,
  onCapped,
  onMessagesChange,
  inputAccessory,
}: ChatCoreProps) {
  const lessonSurface = surface === "lesson_learn" || surface === "lesson_review";
  /**
   * Socratic-probing prototype (wip/socratic-probing-route-b, Route B +
   * Option 1). Scoped to lesson_learn only: review mode's whole design is a
   * fast ≤5-message lock-in with immediate corrective lines (lib/lesson.ts
   * reviewPrompt) — probing there would blow its turn budget and fight its
   * own purpose, so this prototype leaves review mode's existing behavior
   * untouched. Open question, not yet ruled on by Samuel: see this branch's
   * brief for the Principle II grounding scope this raises.
   */
  const probingSurface = surface === "lesson_learn";
  const [messages, setMessages] = useState<ChatMsg[]>(() =>
    initialMessages && initialMessages.length > 0
      ? initialMessages
      : openingLine
        ? [{ role: "note", kind: "say", localOnly: true, text: openingLine }]
        : []
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [capped, setCapped] = useState(false);
  const chatSession = useRef<string>(
    sessionId ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  );
  const citedKeys = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);
  // live mirror so notes appended just before an auto-continue are included
  const messagesRef = useRef<ChatMsg[]>(messages);
  messagesRef.current = messages;
  // Which pushed question (if any) has no matching "the student answered…"
  // event note yet — read straight off the transcript so this holds
  // regardless of whether the host surface wires up onDirective/interceptWidget.
  // Guards the "Got it" affordance below from skipping a real attempt (FR-1214).
  const openQuestionId = useMemo(() => {
    let open: string | null = null;
    for (const m of messages) {
      if (m.role === "assistant" && m.text) {
        for (const b of parseMessage(m.text, true)) {
          if (b.t === "question") open = b.qid;
        }
      } else if (m.kind === "event" && open && m.text.includes(open)) {
        open = null;
      }
    }
    return open;
  }, [messages]);
  const openQuestionIdRef = useRef<string | null>(null);
  openQuestionIdRef.current = openQuestionId;
  // Socratic-probing prototype: which LO a wrong answer put into
  // confirmation-pending, the attempt a fresh sibling attempt on that LO
  // should link to via retry_of_attempt_id, how many wrong attempts this
  // cycle has taken (`wrongCount`), and which question that last attempt was
  // against (`questionId`). Session-scoped only (never persisted, never
  // touches mastery) — set/cleared in handleAttempt below. Once `wrongCount`
  // reaches 2, the card stops withholding (ChatQuestionCard's
  // `revealAnswer`) — same threshold an explicit {{reveal_answer}} forces
  // early (send()'s completion handler), never a separate, ungoverned path.
  // `questionId` matters because `openQuestionIdRef` clears the moment the
  // FIRST attempt on a card is graded (a matching event note now exists) —
  // a SECOND chat-typed attempt in the same still-open probe cycle has
  // nothing else to resolve {{answer_submitted:…}} against, since no new
  // card was necessarily pushed in between.
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    loId: string;
    lastAttemptId: number;
    wrongCount: number;
    questionId: string;
  } | null>(null);
  const pendingConfirmationRef = useRef(pendingConfirmation);
  pendingConfirmationRef.current = pendingConfirmation;
  useEffect(() => {
    onPendingConfirmationChange?.(pendingConfirmation);
  }, [pendingConfirmation, onPendingConfirmationChange]);
  // A chat-typed answer ({{answer_submitted:…}}) ChatCore graded itself —
  // handed down so the open question's OWN card (wherever it's rendered)
  // syncs its display instead of sitting there looking unanswered while the
  // transcript already says otherwise.
  const [externalAttempt, setExternalAttempt] = useState<{
    questionId: string;
    result: AttemptResult;
  } | null>(null);
  useEffect(() => {
    onExternalAttemptChange?.(externalAttempt);
  }, [externalAttempt, onExternalAttemptChange]);
  // send() (declared above handleAttempt in this file) needs to call it for
  // a chat-typed answer — a ref breaks the ordering/staleness problem a
  // direct reference would have, same pattern as sendRef/scheduleContinueRef
  // below. Populated right after handleAttempt's own declaration.
  const handleAttemptRef = useRef<(r: AttemptResult, q: SpineQuestion) => void>(
    () => {}
  );
  const continueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // live streaming flag (state is stale inside timers) + queued auto-continue
  const streamingRef = useRef(false);
  const pendingContinue = useRef(false);
  const scheduleContinueRef = useRef<() => void>(() => {});
  // cancel hook for the active paced reveal (unmount safety)
  const revealCancelRef = useRef<() => void>(() => {});
  // sticky auto-scroll: cleared when the user scrolls away from the bottom.
  // A surface with `leading` content (the sealed passage cards) starts a FRESH
  // session unstuck and scrolled to the top, so the student actually sees the
  // text before the tutor's messages pull the view down — auto-scroll used to
  // hide the passage immediately, reproducing the very bug the cards fix
  // (release review, 2026-07-30). Restored sessions keep bottom-stick.
  const startAtTop = !!leading && !initialMessages?.length;
  const stuckToBottom = useRef(!startAtTop);
  useEffect(() => {
    if (startAtTop && scrollRef.current) scrollRef.current.scrollTop = 0;
    // deliberately once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  useEffect(
    () => () => {
      if (continueTimer.current) clearTimeout(continueTimer.current);
      revealCancelRef.current();
    },
    []
  );

  const totalUsd = useMemo(
    () => messages.reduce((s, m) => s + (m.meta?.costUsd ?? 0), 0),
    [messages]
  );
  const turns = useMemo(
    () => messages.filter((m) => m.meta).length,
    [messages]
  );
  useEffect(() => {
    onTotalChange?.(totalUsd, turns);
  }, [totalUsd, turns, onTotalChange]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stuckToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const emitNewCites = useCallback(
    (text: string) => {
      if (!onCite && !onDirective) return;
      const visible = stripIncompleteTail(text);
      if (onCite) {
        for (const c of extractCites(visible)) {
          const key = `${c.kind}|${c.id}`;
          if (!citedKeys.current.has(key)) {
            citedKeys.current.add(key);
            onCite(c);
          }
        }
        for (const id of extractHighlights(visible)) {
          const key = `hl|${id}`;
          if (!citedKeys.current.has(key)) {
            citedKeys.current.add(key);
            onCite({ kind: "lo", id });
          }
        }
      }
      // board directives: fire once per viz/viz_ref/question, in reveal
      // order (occurrence index is stable — complete directives never
      // disappear as the streamed prefix grows)
      if (onDirective) {
        let n = 0;
        for (const b of parseMessage(visible, true)) {
          if (b.t === "widget" && (b.name === "viz" || b.name === "viz_ref")) {
            const key = `dir|${n++}`;
            if (!citedKeys.current.has(key)) {
              citedKeys.current.add(key);
              onDirective(b.name, b.props);
            }
          } else if (b.t === "question") {
            const key = `dir|${n++}`;
            if (!citedKeys.current.has(key)) {
              citedKeys.current.add(key);
              onDirective("question", { qid: b.qid });
            }
          } else if (b.t === "passage_ref") {
            const key = `dir|${n++}`;
            if (!citedKeys.current.has(key)) {
              citedKeys.current.add(key);
              onDirective("passage", { id: b.id });
            }
          }
        }
      }
    },
    [onCite, onDirective]
  );

  const send = useCallback(
    async (raw: string, opts?: { hidden?: boolean }) => {
      const text = raw.trim();
      if (!text || streaming || streamingRef.current || capped) return;
      // The "Got it — next ✓" check-in affordance is an acknowledgement, not
      // an attempt — it must never let the lesson move past a question that
      // was never answered (FR-1214: the client can't decide it was solved).
      // Caught here, before anything reaches the model, so it costs nothing.
      if (text === GOT_IT_SENTINEL && openQuestionIdRef.current) {
        setMessages((prev) => [
          ...prev,
          {
            role: "note",
            kind: "say",
            localOnly: true,
            text: "Give it a try first or tell me if you need help.",
          },
        ]);
        return;
      }
      // Socratic probing (Route B): a wrong answer left the LO
      // confirmation-pending — the same FR-1214 shape as the guard above,
      // but for "he hasn't SOLVED it yet" rather than "he hasn't tried it
      // yet." Caught here for the same reason: before anything reaches the
      // model, at no cost.
      if (text === GOT_IT_SENTINEL && pendingConfirmationRef.current) {
        setMessages((prev) => [
          ...prev,
          {
            role: "note",
            kind: "say",
            localOnly: true,
            text: "Let's make sure it clicked first — one more try on this before we move on.",
          },
        ]);
        return;
      }
      // a VISIBLE user action re-engages bottom-stick — after reading the
      // leading passage, the student expects to see the reply they asked for
      if (!opts?.hidden) stuckToBottom.current = true;
      setInput("");
      setStreaming(true);
      streamingRef.current = true;
      citedKeys.current = new Set();

      const paced = !prefersReducedMotion();

      const transcript: ChatMsg[] = [
        ...messagesRef.current,
        { role: "user", text, ...(opts?.hidden ? { hidden: true } : {}) },
      ];
      setMessages([
        ...transcript,
        {
          role: "assistant",
          text: "",
          streaming: true,
          ...(paced ? { reveal: 0 } : {}),
        },
      ]);

      // Patch the streaming assistant row — NOT blindly the last message:
      // question/widget cards can append "note" rows mid-stream.
      const patchLast = (patch: Partial<ChatMsg>) =>
        setMessages((prev) => {
          let i = prev.length - 1;
          while (i >= 0 && !prev[i].streaming) i--;
          if (i < 0) return prev;
          const next = [...prev];
          next[i] = { ...next[i], ...patch };
          return next;
        });

      /* ---- paced reveal engine: buffers the stream, reveals at reading
         cadence, dwells at sentence/beat boundaries, catches up ≤2s once
         the stream is done. All downstream effects (TTS, cite pips, finish
         handling, auto-continue) gate on REVEAL completion. ---- */
      let acc = "";
      let cursor = 0;
      let streamEnded = false;
      let revealFinished = !paced;
      let revealTimer: ReturnType<typeof setTimeout> | null = null;
      let revealResolve: () => void = () => {};
      const revealDone: Promise<void> = paced
        ? new Promise<void>((r) => {
            revealResolve = r;
          })
        : Promise.resolve();

      const cancelReveal = () => {
        if (revealFinished) return;
        revealFinished = true;
        if (revealTimer) clearTimeout(revealTimer);
        revealResolve();
      };
      revealCancelRef.current = cancelReveal;

      /** Advance the cursor ≤ WORDS_PER_TICK words; returns the dwell. */
      const advance = (): number => {
        let words = 0;
        while (cursor < acc.length && words < WORDS_PER_TICK) {
          while (cursor < acc.length && /\s/.test(acc[cursor])) cursor++;
          if (cursor >= acc.length) break;
          if (acc.startsWith("{{", cursor)) {
            const d = directiveEndAt(acc, cursor);
            if (d === "incomplete") {
              // directive still streaming in — wait unless the stream died
              if (!streamEnded) return STARVED_MS;
            } else if (typeof d === "number") {
              const isBeat = acc.startsWith("{{beat}}", cursor);
              cursor = d;
              return isBeat ? BEAT_MS : DIRECTIVE_MS; // reveal atomically, dwell
            }
            // plain "{{" text — fall through as an ordinary word
          }
          const start = cursor;
          while (cursor < acc.length && !/\s/.test(acc[cursor])) cursor++;
          if (cursor > start) {
            words++;
            if (/[.!?؟…]$/.test(acc.slice(start, cursor))) return SENTENCE_MS;
          }
        }
        return TICK_MS;
      };

      const tick = () => {
        if (revealFinished) return;
        if (cursor >= acc.length) {
          if (streamEnded) {
            cancelReveal();
            return;
          }
          revealTimer = setTimeout(tick, STARVED_MS);
          return;
        }
        let delay = advance();
        patchLast({ reveal: cursor });
        emitNewCites(acc.slice(0, cursor));
        if (streamEnded) {
          // catch-up easing: never lag stream-done by more than ~2s
          const ticksLeft = Math.max(
            1,
            Math.ceil((acc.length - cursor) / (WORDS_PER_TICK * 6))
          );
          delay = Math.min(delay, Math.max(50, CATCHUP_BUDGET_MS / ticksLeft));
        }
        revealTimer = setTimeout(tick, delay);
      };
      if (paced) revealTimer = setTimeout(tick, 60);

      let metaBuf: TurnMeta | null = null;

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            surface,
            chatSession: chatSession.current,
            questionId,
            wrongAnswer,
            lesson: lessonSlug,
            messages: transcript
              .filter((m) => !m.localOnly)
              .map((m) => ({ role: m.role, text: m.text })),
          }),
        });
        if (!res.ok || !res.body) throw new Error(`API ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let done = false;

        while (!done) {
          const { value, done: rdDone } = await reader.read();
          if (rdDone) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split("\n\n");
          buf = events.pop() ?? "";
          for (const ev of events) {
            const line = ev
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!line) continue;
            let j: {
              type: string;
              t?: string;
              text?: string;
              message?: string;
              meta?: TurnMeta;
            };
            try {
              j = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (j.type === "delta" && j.t) {
              acc += j.t;
              patchLast({ text: acc });
              if (!paced) emitNewCites(acc);
            } else if (j.type === "done" && j.meta) {
              metaBuf = j.meta;
              done = true;
            } else if (j.type === "cap") {
              cancelReveal();
              patchLast({
                role: "note",
                streaming: false,
                text: j.text ?? "",
              });
              setCapped(true);
              onCapped?.();
              done = true;
            } else if (j.type === "error") {
              cancelReveal();
              patchLast({
                streaming: false,
                error: true,
                text:
                  acc ||
                  (j.message ?? "AI backend unavailable — please try again."),
              });
              done = true;
            }
          }
        }

        streamEnded = true;

        if (metaBuf) {
          await revealDone; // resolves immediately when not paced
          patchLast({ streaming: false, meta: metaBuf, reveal: undefined });
          emitNewCites(acc);
          onAssistantDone?.(acc);
          if (acc.includes("{{finish_lesson}}")) onFinishDirective?.();
          // SOCRATIC PROBING (Route B, wip/socratic-probing-route-b): the
          // tutor recognized either a genuine chat-typed answer attempt or
          // an explicit "just tell me" and tagged it with a directive —
          // route BOTH through the exact grading/handleAttempt pipeline a
          // tapped card already uses, rather than trusting the tutor's own
          // prose as the mechanism. Scoped to probingSurface; a no-op
          // everywhere else even if the model somehow emitted one.
          if (probingSurface) {
            const submittedGiven = extractAnswerSubmitted(acc);
            const pendingNow = pendingConfirmationRef.current;
            // openQuestionIdRef tracks "no matching answered-event note
            // yet" — it clears the moment the FIRST attempt on a card is
            // graded, even though the probe cycle stays open and the tutor
            // may keep discussing that SAME question conversationally
            // before ever pushing a fresh card. Fall back to the pending
            // cycle's own question in that case, so a second chat-typed
            // attempt still has something to resolve against.
            const targetQuestionId =
              openQuestionIdRef.current ?? pendingNow?.questionId ?? null;
            if (submittedGiven != null && targetQuestionId) {
              const openQ = lookupQuestion?.(targetQuestionId);
              // Widgets grade from the construction itself (ADR-0009), never
              // from typed text — ignored rather than trusted even though
              // lib/lesson.ts also tells the tutor never to emit this for
              // one (defense in depth against a misrecognized directive).
              if (openQ && openQ.questionType !== "widget") {
                try {
                  const r = await submitAttempt({
                    questionId: openQ.id,
                    givenAnswer: submittedGiven,
                    // ChatCore doesn't track a per-question shown-at
                    // timestamp the way the card does — timeMs is storage
                    // only here, never part of grading.
                    timeMs: 0,
                    ...(pendingNow?.loId === openQ.loId
                      ? { retryOfAttemptId: pendingNow.lastAttemptId }
                      : {}),
                  });
                  setExternalAttempt({ questionId: openQ.id, result: r });
                  handleAttemptRef.current(r, openQ);
                } catch (e) {
                  console.error("chat-typed answer submission failed:", e);
                }
              }
            } else if (hasRevealAnswerDirective(acc)) {
              // Bail-out: force the same reveal the 2-attempt cap would
              // produce — never a free pass around it (no skipped
              // grounding, no unresolved LO). A no-op if nothing is
              // actually pending yet — lib/lesson.ts tells the tutor never
              // to emit this before a genuine attempt exists; this is the
              // backstop, not the primary guard, since the client can't
              // intercept the tutor's own free-generated text the way it
              // intercepts the "Got it" button.
              setPendingConfirmation((prev) =>
                prev
                  ? { ...prev, wrongCount: Math.max(prev.wrongCount, 2) }
                  : prev
              );
            }
          }
          if (metaBuf.capped) {
            setCapped(true);
            onCapped?.();
            if (surface === "student_chat") {
              setMessages((prev) => [
                ...prev,
                {
                  role: "note",
                  text: "That was my second explanation — my limit, on purpose. The reviewed canonical steps above are the ground truth: walk them once more slowly, then keep going. You've got this ✦",
                },
              ]);
            }
          }
        } else {
          cancelReveal();
        }

        // stream ended without a terminal event → treat as error
        setMessages((prev) => {
          let i = prev.length - 1;
          while (i >= 0 && !prev[i].streaming) i--;
          if (i < 0) return prev;
          const next = [...prev];
          next[i] = {
            ...next[i],
            streaming: false,
            error: !next[i].text,
            text: next[i].text || "AI backend unavailable — please try again.",
          };
          return next;
        });
      } catch {
        cancelReveal();
        patchLast({
          streaming: false,
          error: true,
          text: "AI backend unavailable — please try again.",
        });
      } finally {
        cancelReveal();
        streamingRef.current = false;
        setStreaming(false);
        // an auto-continue was blocked by this open stream — fire it now
        if (pendingContinue.current) {
          pendingContinue.current = false;
          scheduleContinueRef.current();
        }
      }
    },
    [
      surface,
      questionId,
      wrongAnswer,
      lessonSlug,
      streaming,
      capped,
      emitNewCites,
      onAssistantDone,
      onFinishDirective,
      onCapped,
      probingSurface,
      lookupQuestion,
    ]
  );

  // latest send for delayed auto-continues (avoids stale closures)
  const sendRef = useRef(send);
  sendRef.current = send;

  const scheduleContinue = useCallback(() => {
    if (!autoContinue) return;
    if (continueTimer.current) clearTimeout(continueTimer.current);
    continueTimer.current = setTimeout(() => {
      if (streamingRef.current) {
        // a stream is still open (widget note landed mid-stream) — queue a
        // single continue; send()'s finally block fires it on stream end
        pendingContinue.current = true;
        return;
      }
      sendRef.current("Continue.", { hidden: true });
    }, 700);
  }, [autoContinue]);
  scheduleContinueRef.current = scheduleContinue;

  useEffect(() => {
    if (
      autoStart &&
      !autoSent.current &&
      messages.filter((m) => !m.localOnly).length === 0
    ) {
      autoSent.current = true;
      send(autoStart, { hidden: autoStartHidden });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAttempt = useCallback(
    (r: AttemptResult, q: SpineQuestion) => {
      let note = `${r.isCorrect ? "✓" : "✗"} the student answered ${q.id} ${
        r.isCorrect ? "correctly" : "incorrectly"
      }${r.isCorrect ? "" : ` (correct answer: ${r.correctAnswer})`} — mastery ${Math.round(r.oldScore * 100)}% → ${Math.round(
        r.newScore * 100
      )}%`;

      // SOCRATIC PROBING (Route B + Option 1, wip/socratic-probing-route-b —
      // open grounding question not yet ruled on by Samuel, see that
      // branch's brief). ChatQuestionCard no longer reveals its correct
      // answer OR its refutation/solution on a wrong answer in this mode
      // (`probing`/`revealAnswer` props); instead the reviewed material
      // rides into the TUTOR's own next turn as reference-only context
      // here, and the system prompt (lib/lesson.ts learnPrompt) is told to
      // ask a guiding question before ever stating it — UNTIL the 2nd wrong
      // attempt on the same LO, at which point withholding stops and the
      // tutor explains plainly, in the material's own steps (never just the
      // final value). Scoring is untouched: bktUpdate() already ran
      // normally server-side before this client ever sees `r` — this note
      // only changes what the tutor SAYS, never what mastery records.
      const wasPending = pendingConfirmationRef.current;
      // The count a wrong answer on this LO would reach — computed once and
      // reused for both the note text and the state update below, so they
      // can never disagree about which attempt this is.
      const wrongCountAfter =
        wasPending?.loId === q.loId ? wasPending.wrongCount + 1 : 1;
      if (probingSurface) {
        if (!r.isCorrect) {
          const material = r.refutation
            ? r.refutation.steps.map((st) => st.text_md).join(" ")
            : r.solution.length > 0
              ? r.solution.map((st) => `Step ${st.step}. ${stepText(st)}`).join(" ")
              : null;
          note +=
            wrongCountAfter >= 2
              ? `\nSOCRATIC PROBE — REVEALED — ${q.loId}: that's two attempts without landing it. The card is now showing him the correct answer and the reference material directly — stop withholding. Walk him through it PLAINLY, in the material's own steps, in order (never just the final value): ${
                  material ??
                  "no reviewed material matches this specific error — walk the LO's own definition through to the correct answer instead, still step by step."
                } Once he seems ready, your next check on ${q.loId} must still be a fresh same-tier question before you can treat it as resolved.`
              : `\nSOCRATIC PROBE — ${q.loId} is now confirmation-pending. Reference material for YOUR use only, not the student's yet (do not quote or assert it until he has engaged with at least one guiding question, or explicitly asks you to just tell him): ${
                  material ??
                  "no reviewed material matches this specific error — reason from the LO's own definition instead, still without stating the answer outright."
                } Ask ONE short guiding question toward it now.`;
        } else if (wasPending?.loId === q.loId) {
          note += `\n✓ confirmation received for ${q.loId} — resolved, safe to move on.`;
        }
      }
      setPendingConfirmation((prev) => {
        if (!probingSurface) return prev;
        if (r.isCorrect) return prev?.loId === q.loId ? null : prev;
        // A wrong answer on the LO already pending extends the same cycle
        // (link to the newest attempt, bump wrongCount); a wrong answer on a
        // DIFFERENT LO while one is already pending leaves the earlier one
        // authoritative — this prototype tracks one open probe at a time.
        if (!prev || prev.loId === q.loId) {
          return {
            loId: q.loId,
            lastAttemptId: r.attemptId,
            wrongCount: wrongCountAfter,
            questionId: q.id,
          };
        }
        return prev;
      });

      setMessages((prev) => [
        ...prev,
        { role: "note", kind: "event", text: note },
        // latency theater: instant local reaction while the model responds
        ...(lessonSurface
          ? [
              {
                role: "note",
                kind: "say",
                localOnly: true,
                text: r.isCorrect
                  ? arabicUi
                    ? "برافو ✓ — شايف إجابتك…"
                    : "Nice ✓ — check your answer…"
                  : arabicUi
                    ? "ولا يهمك — بص هنا…"
                    : "No worries — look here…",
              } satisfies ChatMsg,
            ]
          : []),
      ]);
      onAttemptResult?.(r, q);
      scheduleContinue();
    },
    [onAttemptResult, scheduleContinue, lessonSurface, arabicUi, probingSurface]
  );
  handleAttemptRef.current = handleAttempt;

  /** Widget cards report their outcome here → visible note + next AI beat. */
  const handleWidgetNote = useCallback(
    (note: string) => {
      setMessages((prev) => [
        ...prev,
        { role: "note", kind: "event", text: note },
        ...(lessonSurface
          ? [
              {
                role: "note",
                kind: "say",
                localOnly: true,
                text: arabicUi
                  ? "✓ شايف إجابتك… ثانية واحدة"
                  : "✓ check your answer… one second",
              } satisfies ChatMsg,
            ]
          : []),
      ]);
      scheduleContinue();
    },
    [scheduleContinue, lessonSurface, arabicUi]
  );

  // {{check_in}} buttons send the matching suggestion HIDDEN — the card
  // itself shows the choice, no user bubble needed
  const handleCheckIn = useCallback((choice: string) => {
    sendRef.current(choice, { hidden: true });
  }, []);

  // imperative bridge: board-hosted cards (whiteboard) report back here
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      attemptResult: handleAttempt,
      widgetNote: handleWidgetNote,
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, handleAttempt, handleWidgetNote]);

  // stable identity — an inline lambda here would void MessageRow's memo
  const handleOpenQuestion = useMemo(
    () =>
      onCiteClick
        ? (qid: string) => onCiteClick({ kind: "q", id: qid })
        : undefined,
    [onCiteClick]
  );

  const paced = !prefersReducedMotion();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* messages */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          // user scrolled away from the bottom → stop auto-scrolling;
          // back within 40px of the bottom → resume
          const el = e.currentTarget;
          stuckToBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
        }}
        className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {leading}
        {messages.length === 0 && !streaming && emptyState}

        {messages.map((m, i) => (
          <MessageRow
            key={i}
            msg={m}
            debug={debug}
            arabicUi={arabicUi}
            writing={lessonSurface}
            dim={paced && streaming && m.role === "assistant" && !m.streaming}
            lookupQuestion={lookupQuestion}
            resolveCite={resolveCite}
            onCiteClick={onCiteClick}
            onAttempt={handleAttempt}
            probing={probingSurface}
            pendingLoId={pendingConfirmation?.loId ?? null}
            pendingAttemptId={pendingConfirmation?.lastAttemptId ?? null}
            pendingWrongCount={pendingConfirmation?.wrongCount ?? null}
            externalAttempt={externalAttempt}
            renderWidget={renderWidget}
            renderPassage={renderPassage}
            onWidgetNote={handleWidgetNote}
            onCheckIn={handleCheckIn}
            onOpenQuestion={handleOpenQuestion}
            interceptWidget={interceptWidget}
            onDirective={onDirective}
            onSwitchSubject={onSwitchSubject}
          />
        ))}
      </div>

      {/* suggestion chips — stay clickable after every stream */}
      {suggestions.length > 0 && !capped && (
        <div className="flex flex-wrap gap-1.5 border-t border-line-soft px-4 pb-1.5 pt-2.5">
          {suggestions.map((s) => {
            const label = typeof s === "string" ? s : s.label;
            return (
              <button
                key={label}
                onClick={() => (typeof s === "string" ? send(s) : s.onSelect())}
                disabled={streaming}
                className="rounded-full border border-accent/40 bg-accent-wash px-2.5 py-1 text-start text-[11px] font-medium leading-snug text-accent-deep transition-all duration-150 enabled:hover:-translate-y-px enabled:hover:bg-accent enabled:hover:text-paper disabled:opacity-40 play-pressable sticker-shadow-sm"
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* input */}
      <div
        className={`flex items-center gap-2 px-4 pb-3.5 ${
          suggestions.length > 0 && !capped ? "pt-1.5" : "border-t border-line-soft pt-3"
        }`}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder={capped ? "AI turn limit reached for this question" : placeholder}
          disabled={streaming || capped}
          className="min-w-0 flex-1 rounded-full border border-line bg-card px-4 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent sticker-shadow-sm"
        />
        {inputAccessory?.({ setInput })}
        <button
          onClick={() => send(input)}
          disabled={streaming || capped || !input.trim()}
          aria-label="Send"
          className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-all duration-150 enabled:hover:-translate-y-px enabled:hover:bg-accent-deep disabled:opacity-30 play-pressable sticker-shadow-sm"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 12V2m0 0L2.5 6.5M7 2l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Memoized on purpose: the paced reveal patches ONLY the streaming row's
 * message object each tick, so every settled row skips re-rendering.
 */
const MessageRow = memo(function MessageRow({
  msg: m,
  debug,
  arabicUi,
  writing,
  dim,
  lookupQuestion,
  resolveCite,
  onCiteClick,
  onAttempt,
  probing,
  pendingLoId,
  pendingAttemptId,
  pendingWrongCount,
  externalAttempt,
  onOpenQuestion,
  renderWidget,
  renderPassage,
  onWidgetNote,
  onCheckIn,
  interceptWidget,
  onDirective,
  onSwitchSubject,
}: {
  msg: ChatMsg;
  debug: boolean;
  /** RTL/Arabic-script subject — forwarded to question-card/citation strings */
  arabicUi: boolean;
  /** lesson surfaces: "بيكتب…" writing shimmer instead of the graph label */
  writing: boolean;
  /** another message is currently revealing — de-emphasize this one */
  dim: boolean;
  lookupQuestion?: (qid: string) => SpineQuestion | undefined;
  resolveCite?: (c: Cite) => CiteInfo | null;
  onCiteClick?: (c: Cite) => void;
  onAttempt: (r: AttemptResult, q: SpineQuestion) => void;
  /** Socratic-probing prototype: forwarded to ChatQuestionCard (see there) */
  probing: boolean;
  pendingLoId: string | null;
  pendingAttemptId: number | null;
  pendingWrongCount: number | null;
  externalAttempt: { questionId: string; result: AttemptResult } | null;
  onOpenQuestion?: (qid: string) => void;
  renderWidget?: ChatCoreProps["renderWidget"];
  renderPassage?: ChatCoreProps["renderPassage"];
  onWidgetNote?: (note: string) => void;
  onCheckIn?: (choice: string) => void;
  interceptWidget?: ChatCoreProps["interceptWidget"];
  onDirective?: ChatCoreProps["onDirective"];
  onSwitchSubject?: ChatCoreProps["onSwitchSubject"];
}) {
  if (m.hidden) return null;

  const dimStyle: React.CSSProperties = {
    opacity: dim ? 0.55 : 1,
    transition: "opacity 400ms ease",
  };

  if (m.role === "user") {
    return (
      <div className="anim-pop flex justify-end">
        <div
          dir="auto"
          className="max-w-[85%] rounded-xl rounded-ee-sm bg-ink px-3.5 py-2 text-[13px] leading-relaxed text-paper shadow-sm noor-bubble-student"
          style={{ textAlign: "start" }}
        >
          {m.text}
        </div>
      </div>
    );
  }

  if (m.role === "note") {
    // student-facing tutor line (latency theater / scripted opener)
    if (m.kind === "say") {
      return (
        <div className="anim-pop flex justify-start" style={dimStyle}>
          <div
            dir="auto"
            className="max-w-[85%] rounded-xl rounded-es-sm border border-line-soft bg-card-warm px-3.5 py-2 text-[13px] leading-relaxed text-ink-soft shadow-sm noor-bubble-tutor"
            style={{ textAlign: "start" }}
          >
            {m.text}
          </div>
        </div>
      );
    }
    // instrumentation rows ([live event]) — receipts only in debug mode
    if (m.kind === "event" && !debug) return null;
    return (
      <div className="anim-pop flex justify-center">
        <div className="max-w-[92%] rounded-lg border border-dashed border-gold/50 bg-gold-wash px-3 py-1.5 text-center font-mono text-[10px] leading-relaxed text-ink-soft">
          {m.text}
        </div>
      </div>
    );
  }

  // paced reveal: while streaming, render only the revealed prefix — the
  // defensive parser (stripIncompleteTail) keeps every prefix safe to show
  const visibleText =
    m.streaming && m.reveal != null ? m.text.slice(0, m.reveal) : m.text;
  const blocks = parseMessage(visibleText, !!m.streaming);

  return (
    <div className="anim-pop flex justify-start" style={dimStyle}>
      <div
        dir="auto"
        className={`max-w-[94%] rounded-xl rounded-es-sm border px-3.5 py-2.5 text-[13px] leading-relaxed text-ink shadow-sm font-read ${
          m.error
            ? "border-rust/40 bg-rust-wash/50"
            : "border-line-soft bg-card-warm noor-bubble-tutor"
        }`}
        style={{ textAlign: "start" }}
      >
        {m.streaming && visibleText.length === 0 && (
          <Thinking writing={writing} arabicUi={arabicUi} />
        )}

        {blocks.map((b, i) => {
          if (b.t === "highlight") return null; // side-effect only
          if (b.t === "finish") return null; // handled by the surface
          if (b.t === "beat") return null; // pacing marker — renders as time
          // Socratic-probing prototype: both handled once per completed
          // message in send()'s completion handler (submit/force-reveal),
          // never rendered inline — a mid-stream partial render would just
          // show the raw directive text with nothing to act on yet.
          if (b.t === "answer_submitted") return null;
          if (b.t === "reveal_answer") return null;
          if (b.t === "check_in") {
            return (
              <CheckInCard
                key={i}
                onPick={onCheckIn}
                disabled={!!m.streaming}
                arabicUi={arabicUi}
              />
            );
          }
          if (b.t === "widget") {
            // whiteboard interception: the surface owns the card on its
            // board — the transcript keeps a small re-pin chip in place
            if (
              (b.name === "viz" || b.name === "viz_ref") &&
              interceptWidget?.(b.name, b.props)
            ) {
              const name = b.name;
              const props = b.props;
              return (
                <BoardChip
                  key={i}
                  flavor="figure"
                  onOpen={onDirective ? () => onDirective(name, props) : undefined}
                />
              );
            }
            const card =
              onWidgetNote && renderWidget
                ? renderWidget(b.name, b.props, onWidgetNote)
                : null;
            return card ? <div key={i}>{card}</div> : null;
          }
          if (b.t === "question") {
            if (interceptWidget?.("question", { qid: b.qid })) {
              const qid = b.qid;
              return (
                <BoardChip
                  key={i}
                  flavor="question"
                  onOpen={
                    onDirective
                      ? () => onDirective("question", { qid })
                      : undefined
                  }
                />
              );
            }
            const q = lookupQuestion?.(b.qid);
            return q ? (
              <ChatQuestionCard
                key={i}
                question={q}
                debug={debug}
                lang={arabicUi ? "ar" : "en"}
                onResult={onAttempt}
                onOpenQuestion={onOpenQuestion}
                probing={probing}
                revealAnswer={pendingLoId === q.loId && (pendingWrongCount ?? 0) >= 2}
                retryOfAttemptId={
                  pendingLoId === q.loId ? (pendingAttemptId ?? undefined) : undefined
                }
                externalResult={
                  externalAttempt && externalAttempt.questionId === q.id
                    ? externalAttempt
                    : undefined
                }
              />
            ) : (
              <p key={i} className="my-1 font-mono text-[10px] text-ink-faint">
                → {b.qid}
              </p>
            );
          }
          if (b.t === "list") {
            return (
              <ul key={i} className="my-1.5 space-y-1 ps-1">
                {b.items.map((item, k) => (
                  <li key={k} className="flex gap-1.5" dir="auto">
                    <span className="mt-[1px] shrink-0 text-accent">·</span>
                    <span
                      className="tex-block min-w-0"
                      style={{ textAlign: "start" }}
                    >
                      {item.map((seg, s) =>
                        seg.t === "text" ? (
                          <TeX key={s} text={seg.v} />
                        ) : (
                          <CitationChip
                            key={s}
                            cite={seg}
                            friendly={!debug}
                            arabic={arabicUi}
                            resolve={resolveCite}
                            onActivate={onCiteClick}
                          />
                        )
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            );
          }
          if (b.t === "switch_subject") {
            return (
              <SubjectHandoffCard
                key={i}
                subject={b.subject}
                onOpen={
                  onSwitchSubject ? () => onSwitchSubject(b.subject) : undefined
                }
              />
            );
          }
          if (b.t === "passage_ref") {
            // sealed text: resolved by the SURFACE from verified data — if it
            // is board-intercepted the transcript keeps a re-pin chip, exactly
            // like figures. The id is all the model ever emitted.
            if (interceptWidget?.("passage", { id: b.id })) {
              const id = b.id;
              return (
                <BoardChip
                  key={i}
                  flavor="figure"
                  onOpen={
                    onDirective ? () => onDirective("passage", { id }) : undefined
                  }
                />
              );
            }
            return renderPassage ? (
              <div key={i}>
                {renderPassage(b.id, {
                  quote: b.quote,
                  unit: b.unit,
                  view: b.view,
                })}
              </div>
            ) : null;
          }
          return (
            <p
              key={i}
              dir="auto"
              className="tex-block my-1.5 first:mt-0 last:mb-0"
              style={{ textAlign: "start" }}
            >
              {b.inlines.map((seg, s) =>
                seg.t === "text" ? (
                  <TeX key={s} text={seg.v} />
                ) : (
                  <CitationChip
                    key={s}
                    cite={seg}
                    friendly={!debug}
                    arabic={arabicUi}
                    resolve={resolveCite}
                    onActivate={onCiteClick}
                  />
                )
              )}
            </p>
          );
        })}

        {m.streaming && visibleText.length > 0 && (
          <span className="ms-0.5 inline-block h-3.5 w-[7px] translate-y-[2px] animate-pulse rounded-[1px] bg-accent" />
        )}

        {debug && m.meta && (
          <p className="mt-2 border-t border-line-soft pt-1.5 font-mono text-[9px] tracking-wide text-ink-faint">
            ${m.meta.costUsd.toFixed(4)} · {m.meta.inputTokens.toLocaleString()}
            →{m.meta.outputTokens.toLocaleString()} tok
            {(m.meta.cacheReadTokens ?? 0) > 0 ||
            (m.meta.cacheCreationTokens ?? 0) > 0
              ? ` (cache r${(m.meta.cacheReadTokens ?? 0).toLocaleString()}/w${(m.meta.cacheCreationTokens ?? 0).toLocaleString()})`
              : ""}{" "}
            · {(m.meta.latencyMs / 1000).toFixed(1)}s · {m.meta.model}
            {m.meta.interactionId != null &&
              ` · logged #${m.meta.interactionId}`}
          </p>
        )}
      </div>
    </div>
  );
});

/**
 * Cross-subject handoff (Wave 1.5, multi-subject spine §3): the tutor stays
 * in its subject and OFFERS to switch rather than answering out-of-subject
 * (which would break grounding). "Open" navigates; "stay" collapses the card.
 */
function SubjectHandoffCard({
  subject,
  onOpen,
}: {
  subject: SpineSubject;
  onOpen?: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const label = labelArOfSpineKey(subject);
  if (dismissed) {
    return (
      <p className="my-1 text-[11px] text-ink-faint" dir="auto">
        — نكمل اللي إحنا فيه ✓
      </p>
    );
  }
  return (
    <div dir="rtl" className="my-2 rounded-xl border border-gold/45 bg-gold-wash/50 p-3">
      <p className="text-[13px] font-medium leading-relaxed text-ink">
        ده سؤال في <strong>{label}</strong> — تحب نفتح المادة دي، ولا نكمل اللي
        إحنا فيه ونرجعله بعدين؟
      </p>
      <div className="mt-2.5 flex gap-2">
        <button
          onClick={onOpen}
          disabled={!onOpen}
          className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40 play-pressable sticker-shadow-sm"
        >
          افتح {label} ←
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="rounded-full border border-line px-3.5 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:text-ink play-pressable sticker-shadow-sm"
        >
          نكمل
        </button>
      </div>
    </div>
  );
}

/**
 * Transcript stand-in for a board-intercepted figure/question — keeps the
 * position in the thread; tapping re-pins the card on the whiteboard.
 */
function BoardChip({
  flavor,
  onOpen,
}: {
  flavor: "figure" | "question";
  onOpen?: () => void;
}) {
  return (
    <button
      dir="rtl"
      onClick={onOpen}
      className="anim-pop my-1.5 inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-wash px-3 py-1.5 text-[12px] font-semibold text-accent-deep transition-all duration-150 hover:-translate-y-px hover:bg-accent hover:text-paper play-pressable sticker-shadow-sm"
    >
      <span aria-hidden className="text-[11px]">
        {flavor === "figure" ? "✎" : "⚡"}
      </span>
      {flavor === "figure" ? "شوف الرسمة ←" : "السؤال ع السبورة ←"}
    </button>
  );
}

/** {{check_in}} — two-big-buttons card. */
function CheckInCard({
  onPick,
  disabled,
  arabicUi,
}: {
  onPick?: (choice: string) => void;
  disabled: boolean;
  arabicUi: boolean;
}) {
  const [picked, setPicked] = useState<"no" | "yes" | null>(null);
  const choose = (which: "no" | "yes", text: string) => {
    if (picked || disabled) return;
    setPicked(which);
    onPick?.(text);
  };
  const dir = arabicUi ? "rtl" : "ltr";
  const noSignal = arabicUi
    ? "لسه مش فاهم — اشرحها بطريقة تانية"
    : "Not yet — explain it another way";
  return (
    <div className="anim-pop my-2 rounded-lg border border-accent/40 bg-accent-wash/60 px-3.5 py-3">
      <p dir={dir} className="mb-2.5 text-center font-display text-[16px] font-medium text-ink">
        {arabicUi ? "لسه معايا؟" : "Still with me?"}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          dir={dir}
          onClick={() => choose("no", noSignal)}
          disabled={disabled || picked != null}
          className={`rounded-lg border px-3 py-2.5 text-[14px] font-semibold transition-all duration-150 play-pressable sticker-shadow-sm ${
            picked === "no"
              ? "border-rust bg-rust text-paper"
              : "border-rust/40 bg-card text-rust enabled:hover:-translate-y-px enabled:hover:border-rust disabled:opacity-50"
          }`}
        >
          {arabicUi ? "لسه مش فاهم 🤔" : "Not yet 🤔"}
        </button>
        <button
          dir={dir}
          onClick={() => choose("yes", GOT_IT_SENTINEL)}
          disabled={disabled || picked != null}
          className={`rounded-lg border px-3 py-2.5 text-[14px] font-semibold transition-all duration-150 play-pressable sticker-shadow-sm ${
            picked === "yes"
              ? "border-accent bg-accent text-paper"
              : "border-accent/40 bg-card text-accent-deep enabled:hover:-translate-y-px enabled:hover:border-accent disabled:opacity-50"
          }`}
        >
          {arabicUi ? "كمل ✓" : GOT_IT_SENTINEL}
        </button>
      </div>
    </div>
  );
}

function Thinking({
  writing,
  arabicUi,
}: {
  writing: boolean;
  arabicUi: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 py-0.5">
      {writing ? (
        arabicUi ? (
          <span dir="rtl" className="text-[12.5px] italic text-ink-faint">
            بيكتب…
          </span>
        ) : (
          <span className="text-[12.5px] italic text-ink-faint">
            writing…
          </span>
        )
      ) : (
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
          walking the graph
        </span>
      )}
      <span className="inline-flex gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-1 rounded-full bg-accent"
            style={{
              animation: `think-dot 1.1s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        ))}
      </span>
    </span>
  );
}

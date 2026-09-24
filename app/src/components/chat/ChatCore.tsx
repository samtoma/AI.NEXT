"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { displayLabelOfSpineKey, labelArOfSpineKey } from "@/lib/subjects";
import { track } from "@/lib/ga";
import { masteryLabel } from "@/lib/mastery";
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
import { pendingAfterDeclaration, probingActive } from "@/lib/socratic-probing";
import type { CiteInfo } from "./CitationChip";
import { ChatQuestionCard } from "./ChatQuestionCard";
import {
  StudentBubble,
  TUTOR_BUBBLE_FILL,
  TUTOR_BUBBLE_FRAME,
  TutorBubble,
  renderChatBlocks,
} from "./message-blocks";
import { useUploadAttachment } from "./upload-attachment";
import {
  BUTTON_SECONDARY,
  BUTTON_TERTIARY,
  HEADING,
  STROKE,
  cx,
} from "@/components/sticker";

/**
 * A tappable chip in the Play anatomy: white, ink outline, pill, the small
 * hard shadow and the press. It is a real target, so it holds the 52px floor —
 * and at that height it takes the full 3px stroke, not the thin one.
 */
const CHIP_CONTROL = cx(
  STROKE,
  "inline-flex min-h-[var(--noor-touch-min)] items-center gap-1.5 rounded-[var(--play-radius-pill)] bg-card px-4",
  "font-display text-[0.85rem] font-bold leading-snug text-ink sticker-shadow-sm play-pressable"
);

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
  /**
   * How the starter prompts sit above the composer (Tamer's skill map,
   * `1fcf346`). "chips" (default) is the wrapping inline row every existing
   * surface renders. "stacked" is the skill map's docked panel: a "Try asking"
   * list, one suggestion per line, that reads as things you could say rather
   * than as the screen's primary actions. Opt-in, so no other surface
   * changes. (The branch's `sendTone` prop is not carried: main's send is
   * already amber-with-ink on every surface.)
   */
  suggestionLayout?: "chips" | "stacked";
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
   * Socratic probing (`507bb31`): fired whenever ChatCore's own
   * confirmation-pending state changes (lesson_learn only, and only in a
   * lesson whose session probes — null otherwise). The lesson whiteboard
   * hosts its own question cards outside the transcript and mirrors this so
   * ITS cards gate the same way; ChatCore stays the single source of truth.
   */
  onPendingConfirmationChange?: (
    pending: {
      loId: string;
      lastAttemptId: number;
      wrongCount: number;
      questionId: string;
    } | null
  ) => void;
  /**
   * Whether this lesson probes, as the SERVER declared it (ADR-0021) — fired
   * when that changes. The whiteboard's board-hosted cards read it through
   * the host exactly as they read the pending state above, so a board card
   * and a transcript card can never follow two different answers.
   */
  onProbingChange?: (probing: boolean) => void;
  /** Socratic-probing prototype: fired whenever ChatCore grades a chat-typed
   *  answer itself — mirrored the same way so a board-hosted card can sync. */
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
  suggestionLayout = "chips",
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
  onProbingChange,
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
   * Socratic probing (`507bb31`, Route B + Option 1; ADR-0021).
   *
   * **The client never decides this.** The server resolves it once per
   * learning session, stores it on the session row, and declares it on every
   * response that session serves: the first frame of each `/api/ask` stream
   * (`{type:"session", probing}`) and the `probing` field of every
   * `/api/attempts` result. ChatCore adopts whatever the server last said —
   * starting from OFF, which is what every surface was before v0.7.0 — and
   * scopes it to lesson_learn (review mode's ≤5-message lock-in would fight
   * it). With the server saying false, nothing below behaves differently from
   * v0.6.0's switched-off build.
   *
   * A ref beside the state, because the stream's completion callback and
   * `handleAttempt` must read the value the server sent THIS turn, not the
   * one their closure was created with.
   */
  const [serverProbing, setServerProbing] = useState(false);
  const serverProbingRef = useRef(false);
  const probingSurface = probingActive(surface, serverProbing);
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
  /**
   * This chat's stable session id, computed once.
   *
   * A lazily-initialised state rather than a `useRef`, which is what it was:
   * `useRef(crypto.randomUUID())` evaluates its argument on EVERY render and
   * throws the result away, so the id was correct but a fresh UUID was minted
   * on every keystroke — and the value had to be read back out of a ref during
   * render to be used. The lazy initialiser runs once, which is what was always
   * meant, and leaves a plain string that anything may read.
   */
  const [chatSession] = useState<string>(
    () =>
      sessionId ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  );
  const citedKeys = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);

  /**
   * The upload affordance (FR-205, PRD B10), in the one composer every student
   * surface renders.
   *
   * ON FOR THE STUDENT SURFACES, derived rather than configured. `spine_chat`
   * is the glass-box "Ask the Spine" dock on the Evidence Walk — an
   * instrumentation surface for a room full of adults, not a place a student
   * photographs homework — so it is the one surface without it. Deriving the
   * rule from `surface`, which this component already has, means no host has to
   * remember to pass a flag and no two hosts can disagree about it.
   *
   * The hook is called unconditionally, as hooks must be: with nothing picked
   * it holds no state, opens no request and renders two buttons, and the `&&`
   * below is what decides whether those buttons are placed.
   */
  const uploadsOn = surface !== "spine_chat";
  const attachment = useUploadAttachment({
    chatSession,
    surface,
    lang: arabicUi ? "ar" : "en",
  });
  /** The id the next turn carries — undefined on the surface without uploads. */
  const attachedUploadId = uploadsOn ? attachment.uploadId : undefined;
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
  // cycle has taken, and which question that last attempt was against.
  // Session-scoped only (never persisted, never touches mastery). Once
  // `wrongCount` reaches 2 the card stops withholding — the same threshold an
  // explicit {{reveal_answer}} forces early. Always null in a lesson that
  // does not probe: handleAttempt below never sets it unless the server said
  // this lesson probes, and `adoptProbing(false)` clears it.
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    loId: string;
    lastAttemptId: number;
    wrongCount: number;
    questionId: string;
  } | null>(null);
  const pendingConfirmationRef = useRef(pendingConfirmation);
  // Mirrored at commit, not during render (react-hooks/refs): every reader
  // is an event handler or a stream callback, all of which run after the
  // commit that set it, and a layout effect lands before any of them.
  useLayoutEffect(() => {
    pendingConfirmationRef.current = pendingConfirmation;
  }, [pendingConfirmation]);
  useEffect(() => {
    onPendingConfirmationChange?.(pendingConfirmation);
  }, [pendingConfirmation, onPendingConfirmationChange]);
  useEffect(() => {
    onProbingChange?.(probingSurface);
  }, [probingSurface, onProbingChange]);
  /**
   * Take the server's word for whether this sitting probes, as of ITS latest
   * response. Called from the stream and from attempt results — never from
   * anything the client decided. It can go false mid-sitting (ADR-0021,
   * option B: the switch went Off, or the student was unmarked — the server
   * says so on the next message), and then:
   *   · the confirmation-pending state is dropped (`pendingAfterDeclaration`):
   *     a pending LO is a probing construct, and one left behind would keep
   *     the "Got it" guard refusing in a lesson that no longer probes;
   *   · every card re-renders with `probing` false, so one that was holding
   *     back its answer and worked solution shows them (`cardWithholdsAnswer`);
   *   · the next wrong answer takes v0.6.0's path — revealed on the card, the
   *     Off prompt's re-explain lines — because `handleAttempt` and the
   *     stream's directive handling read this same value.
   * It can go true only at a new sitting (the server never turns on a
   * sitting that opened off).
   */
  const adoptProbing = useCallback((declared: boolean) => {
    serverProbingRef.current = declared;
    setServerProbing(declared);
    setPendingConfirmation((prev) => pendingAfterDeclaration(prev, declared));
  }, []);
  // A chat-typed answer ({{answer_submitted:…}}) ChatCore graded itself —
  // handed down so the open question's OWN card syncs its display.
  const [externalAttempt, setExternalAttempt] = useState<{
    questionId: string;
    result: AttemptResult;
  } | null>(null);
  useEffect(() => {
    onExternalAttemptChange?.(externalAttempt);
  }, [externalAttempt, onExternalAttemptChange]);
  // send() is declared above handleAttempt; a ref breaks the ordering and
  // staleness problem (same pattern as sendRef/scheduleContinueRef below).
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
      // Socratic probing: a wrong answer left the LO confirmation-pending —
      // the same FR-1214 shape as the guard above, for "not SOLVED yet"
      // rather than "not tried yet". Never pending in a lesson that does not probe.
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

      // GA4's audience layer sees that a question was asked and on which
      // surface — never the question, never who asked it (lib/ga.ts). Fired
      // before the request rather than after it, because "asked" is the
      // student's action and a failed turn is still an asked question.
      track("question_asked", { surface });

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            surface,
            chatSession,
            questionId,
            wrongAnswer,
            lesson: lessonSlug,
            // The worksheet this turn is about, when there is one. It stays
            // attached across turns on purpose: a student who photographs a
            // page asks two or three questions about it, and making them
            // re-send it for the second one would be a strange thing to do to
            // somebody who is already stuck. The remove button on the strip is
            // how it goes out of scope.
            uploadId: attachedUploadId,
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
              probing?: boolean;
            };
            try {
              j = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (j.type === "session") {
              // The lesson's probing snapshot, as this turn's prompt applied
              // it (ADR-0021). Sent before any text.
              adoptProbing(j.probing === true);
            } else if (j.type === "delta" && j.t) {
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
          // SOCRATIC PROBING (`507bb31`): a chat-typed answer or an explicit
          // "just tell me", tagged by the tutor with a directive, routed
          // through the SAME grading pipeline a tapped card uses. Only in a
          // lesson the server says probes (read from the ref: the value THIS
          // stream declared) — a no-op everywhere else, even if the model
          // somehow emitted one.
          if (probingActive(surface, serverProbingRef.current)) {
            const submittedGiven = extractAnswerSubmitted(acc);
            const pendingNow = pendingConfirmationRef.current;
            const targetQuestionId =
              openQuestionIdRef.current ?? pendingNow?.questionId ?? null;
            if (submittedGiven != null && targetQuestionId) {
              const openQ = lookupQuestion?.(targetQuestionId);
              // Widgets grade from the construction itself (ADR-0009), never
              // from typed text.
              if (openQ && openQ.questionType !== "widget") {
                try {
                  const r = await submitAttempt({
                    questionId: openQ.id,
                    givenAnswer: submittedGiven,
                    // storage only here, never part of grading
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
              // produce. A no-op if nothing is pending yet.
              setPendingConfirmation((prev) =>
                prev ? { ...prev, wrongCount: Math.max(prev.wrongCount, 2) } : prev
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
                  text: "That was my second explanation — my limit, on purpose. The worked steps above are the ground truth: walk them once more slowly, then keep going. You've got this ✦",
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
      // Recreating `send` when a parse settles is cheap and honest: this
      // callback already depends on `streaming` and `capped`, so it was never
      // stable across a turn, and mirroring the id through a ref to avoid a
      // dependency would only have hidden that.
      attachedUploadId,
      streaming,
      capped,
      emitNewCites,
      onAssistantDone,
      onFinishDirective,
      onCapped,
      adoptProbing,
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
      // The band, not the number. This note goes into the model's context on
      // every single answer, and "mastery 30% → 69%" is where a student ends
      // up being TOLD their P(L) swung 39 points in one question (#17) — which
      // is correct Bayesian behaviour and unreadable as a score. The band
      // moves when the teaching should change, which is the only thing the
      // model needs from it; when it does not move, the note says so rather
      // than inviting commentary on a number that did.
      const bandBefore = masteryLabel(r.oldScore);
      const bandAfter = masteryLabel(r.newScore);
      const bandNote =
        bandBefore === bandAfter
          ? `still ${bandAfter}`
          : `${bandBefore} → ${bandAfter}`;
      let note = `${r.isCorrect ? "✓" : "✗"} the student answered ${q.id} ${
        r.isCorrect ? "correctly" : "incorrectly"
      }${r.isCorrect ? "" : ` (correct answer: ${r.correctAnswer})`} — ${bandNote} (for you only: never say the band, a score or a percentage to the student)`;

      // SOCRATIC PROBING (`507bb31`, Route B + Option 1). With probing on,
      // the card withholds the reveal and the matched material rides into
      // the TUTOR's next turn as reference-only context, until the 2nd wrong
      // attempt on the same LO. Scoring is untouched: bktUpdate() already ran
      // server-side. Nothing here runs in a lesson that does not probe.
      //
      // Which lesson that is comes from THIS result: the attempt route says
      // whether the session it wrote against probes (ADR-0021), and the note,
      // the pending state and the card all follow the server's answer for
      // this attempt rather than the chat's last-known one.
      const declared =
        typeof r.probing === "boolean" ? r.probing : serverProbingRef.current;
      if (typeof r.probing === "boolean") adoptProbing(r.probing);
      const probingNow = probingActive(surface, declared);
      const wasPending = pendingConfirmationRef.current;
      const wrongCountAfter =
        wasPending?.loId === q.loId ? wasPending.wrongCount + 1 : 1;
      if (probingNow) {
        if (!r.isCorrect) {
          const material = r.refutation
            ? r.refutation.steps.map((st) => st.text_md).join(" ")
            : r.solution.length > 0
              ? r.solution.map((st) => `Step ${st.step}. ${stepText(st)}`).join(" ")
              : null;
          note +=
            wrongCountAfter >= 2
              ? `\nSOCRATIC PROBE — REVEALED — ${q.loId}: that's two attempts without landing it. The card is now showing the student the correct answer and the reference material directly — stop withholding. Walk the student through it PLAINLY, in the material's own steps, in order (never just the final value): ${
                  material ??
                  "no reviewed material matches this specific error — walk the LO's own definition through to the correct answer instead, still step by step."
                } Once the student seems ready, your next check on ${q.loId} must still be a fresh same-tier question before you can treat it as resolved.`
              : `\nSOCRATIC PROBE — ${q.loId} is now confirmation-pending. Reference material for YOUR use only, not the student's yet (do not quote or assert it until the student has engaged with at least one guiding question, or explicitly asks you to just say it): ${
                  material ??
                  "no reviewed material matches this specific error — reason from the LO's own definition instead, still without stating the answer outright."
                } Ask ONE short guiding question toward it now.`;
        } else if (wasPending?.loId === q.loId) {
          note += `\n✓ confirmation received for ${q.loId} — resolved, safe to move on.`;
        }
      }
      setPendingConfirmation((prev) => {
        if (!probingNow) return prev;
        if (r.isCorrect) return prev?.loId === q.loId ? null : prev;
        // one open probe at a time: a wrong answer on a DIFFERENT LO leaves
        // the earlier one authoritative
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
    [onAttemptResult, scheduleContinue, lessonSurface, arabicUi, surface, adoptProbing]
  );
  // Same commit-time mirror as `pendingConfirmationRef` above; its one
  // reader is the stream's completion callback.
  useLayoutEffect(() => {
    handleAttemptRef.current = handleAttempt;
  }, [handleAttempt]);

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
        <div
          className={
            suggestionLayout === "stacked"
              ? "flex flex-col gap-0.5 px-4 pb-1 pt-2"
              : "flex flex-wrap gap-2 border-t border-line-soft px-4 pb-2 pt-3"
          }
        >
          {suggestionLayout === "stacked" && (
            <p className="mb-1 px-1 font-display text-[0.72rem] font-bold leading-none text-[color:var(--play-text-muted)]">
              Try asking
            </p>
          )}
          {suggestions.map((s) => {
            const label = typeof s === "string" ? s : s.label;
            const onSelect = () => (typeof s === "string" ? send(s) : s.onSelect());
            if (suggestionLayout === "stacked") {
              /* A suggestion, not a control-shaped primary: no outline, no
                 shadow, no amber — the composer's send keeps the one amber.
                 Still a real <button> holding the touch floor. Its label is
                 under 0.9rem, so `--play-text-muted`, not ink-soft.
                 RTL: "›" is a Bidi_Mirrored character, so in a right-to-left
                 run it already DRAWS as "‹" — rotating it too would flip it
                 back. Only the hover nudge is physical, so it reverses. */
              return (
                <button
                  key={label}
                  onClick={onSelect}
                  disabled={streaming}
                  className="group flex min-h-[var(--noor-touch-min)] w-full items-center gap-2 rounded-[var(--play-radius-sm)] px-1 text-start font-display text-[0.88rem] font-bold leading-[1.4] text-[color:var(--play-text-muted)] transition-colors duration-150 enabled:hover:bg-card-warm enabled:hover:text-ink disabled:opacity-40"
                >
                  <span
                    aria-hidden
                    className="shrink-0 text-ink-faint transition-transform duration-150 group-enabled:group-hover:translate-x-0.5 rtl:group-enabled:group-hover:-translate-x-0.5"
                  >
                    ›
                  </span>
                  <span className="min-w-0">{label}</span>
                </button>
              );
            }
            return (
              <button
                key={label}
                onClick={onSelect}
                disabled={streaming}
                className={cx(CHIP_CONTROL, "text-start")}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* the attached upload, above the composer so a long sentence about an
          unreadable photograph never squeezes the text input on a phone */}
      {uploadsOn && attachment.banner}

      {/* input */}
      <div
        className={`flex items-center gap-2 px-4 pb-3.5 ${
          suggestions.length > 0 && !capped ? "pt-1.5" : "border-t border-line-soft pt-3"
        }`}
      >
        {/* Deliberately NOT disabled while a parse runs, and deliberately not
            gated on `capped` either: sending a photograph is not an AI turn and
            costs no turn of the per-surface cap. */}
        {uploadsOn && attachment.controls}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder={capped ? "AI turn limit reached for this question" : placeholder}
          disabled={streaming || capped}
          className={cx(
            STROKE,
            // 1rem, not 13px: the read scale, and the size below which iPad
            // Safari zooms the page on focus
            "min-h-[var(--noor-touch-min)] min-w-0 flex-1 rounded-[var(--play-radius-sm)] bg-card px-4 text-[1rem] text-ink outline-none placeholder:text-ink-faint sticker-shadow-sm"
          )}
        />
        {inputAccessory?.({ setInput })}
        <button
          onClick={() => send(input)}
          disabled={streaming || capped || !input.trim()}
          aria-label="Send"
          // The composer's send is amber with ink on it (handoff, Nour panel).
          // Empty, it is disabled: white and dashed — "not ready yet".
          className={cx(
            STROKE,
            "flex size-[var(--noor-touch-min)] shrink-0 items-center justify-center rounded-[var(--play-radius-pill)]",
            "bg-[var(--noor-action)] text-[color:var(--noor-on-action)] disabled:bg-card sticker-shadow-sm play-pressable"
          )}
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
  /** this lesson probes, as the server declared it (ADR-0021) — forwarded to
   *  ChatQuestionCard (see there) */
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
    return <StudentBubble>{m.text}</StudentBubble>;
  }

  if (m.role === "note") {
    // student-facing tutor line (latency theater / scripted opener)
    if (m.kind === "say") {
      return (
        <div className="anim-pop flex justify-start" style={dimStyle}>
          {/* frame inherits the conversation's direction (notch mirrors);
              the text resolves its own — see message-blocks.tsx */}
          <div className={cx("max-w-[85%] text-ink-soft", TUTOR_BUBBLE_FRAME, TUTOR_BUBBLE_FILL)}>
            <div dir="auto" style={{ textAlign: "start" }}>
              {m.text}
            </div>
          </div>
        </div>
      );
    }
    // instrumentation rows ([live event]) — receipts only in debug mode
    if (m.kind === "event" && !debug) return null;
    return (
      <div className="anim-pop flex justify-center">
        <div className="max-w-[92%] rounded-[var(--play-radius-sm)] border-[length:var(--play-stroke-sm)] border-dashed border-gold/50 bg-gold-wash px-3 py-1.5 text-center font-mono text-[0.72rem] leading-relaxed text-ink-soft">
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
    <TutorBubble error={!!m.error} style={dimStyle}>
        {m.streaming && visibleText.length === 0 && (
          <Thinking writing={writing} arabicUi={arabicUi} />
        )}

        {/* The blocks are rendered by components/chat/message-blocks.tsx —
            the SAME function the console's replay calls, so a reconstruction
            cannot drift from what the student saw (ADR-0015 §3). The five
            interactive block types stay here as slots, because they are the
            student surface's to own and a read-only replay must not be able to
            import them. */}
        {renderChatBlocks(blocks, {
          debug,
          arabicUi,
          resolveCite,
          onCiteClick,
          slots: {
            checkIn: (i) => (
              <CheckInCard
                key={i}
                onPick={onCheckIn}
                disabled={!!m.streaming}
                arabicUi={arabicUi}
              />
            ),
            widget: (b, i) => {
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
                    arabicUi={arabicUi}
                  />
                );
              }
              const card =
                onWidgetNote && renderWidget
                  ? renderWidget(b.name, b.props, onWidgetNote)
                  : null;
              return card ? <div key={i}>{card}</div> : null;
            },
            question: (b, i) => {
              if (interceptWidget?.("question", { qid: b.qid })) {
                const qid = b.qid;
                return (
                  <BoardChip
                    key={i}
                    flavor="question"
                    onOpen={
                      onDirective ? () => onDirective("question", { qid }) : undefined
                    }
                    arabicUi={arabicUi}
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
                <p key={i} className="my-1 font-mono text-[0.72rem] text-ink-faint">
                  → {b.qid}
                </p>
              );
            },
            switchSubject: (b, i) => (
              <SubjectHandoffCard
                key={i}
                subject={b.subject}
                arabicUi={arabicUi}
                onOpen={
                  onSwitchSubject ? () => onSwitchSubject(b.subject) : undefined
                }
              />
            ),
            passageRef: (b, i) => {
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
                    arabicUi={arabicUi}
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
            },
          },
        })}

        {m.streaming && visibleText.length > 0 && (
          <span className="ms-0.5 inline-block h-3.5 w-[7px] translate-y-[2px] animate-pulse rounded-full bg-accent" />
        )}

        {debug && m.meta && (
          <p className="mt-2 border-t border-line-soft pt-1.5 font-mono text-[0.72rem] tracking-wide text-ink-faint">
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
    </TutorBubble>
  );
});

/**
 * Cross-subject handoff (Wave 1.5, multi-subject spine §3): the tutor stays
 * in its subject and OFFERS to switch rather than answering out-of-subject
 * (which would break grounding). "Open" navigates; "stay" collapses the card.
 *
 * This card can fire from ANY subject's session — a maths question can name a
 * social-studies topic just as easily as the reverse — so its own prose
 * follows the calling session's `arabicUi`, exactly like `CheckInCard` above
 * (previously it did not: the whole card was hardcoded Arabic regardless of
 * which subject asked for the handoff, the bug class this fixes). The TARGET
 * subject's name still renders in its own script either way
 * (`displayLabelOfSpineKey`/`labelArOfSpineKey` — the same "each subject named
 * in its own script" rule `SubjectHome`'s `courseLabel` follows), because a
 * subject's name is not a translation.
 */
function SubjectHandoffCard({
  subject,
  arabicUi,
  onOpen,
}: {
  subject: SpineSubject;
  arabicUi: boolean;
  onOpen?: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const label = arabicUi ? labelArOfSpineKey(subject) : displayLabelOfSpineKey(subject);
  if (dismissed) {
    return (
      <p className="my-1 text-[0.85rem] text-ink-faint" dir="auto">
        {arabicUi ? "— نكمل اللي إحنا فيه ✓" : "— staying here ✓"}
      </p>
    );
  }
  return (
    <div
      dir={arabicUi ? "rtl" : "ltr"}
      className={cx(STROKE, "my-2 rounded-[var(--play-radius)] bg-card-warm p-3 text-ink sticker-shadow-sm")}
    >
      <p className="text-[1rem] text-ink">
        {arabicUi ? (
          <>
            ده سؤال في <strong>{label}</strong> — تحب نفتح المادة دي، ولا نكمل اللي
            إحنا فيه ونرجعله بعدين؟
          </>
        ) : (
          <>
            That&apos;s a <strong>{label}</strong> question — want to open that subject, or stay
            here and come back to it later?
          </>
        )}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          onClick={onOpen}
          disabled={!onOpen}
          className={BUTTON_SECONDARY}
        >
          {arabicUi ? `افتح ${label} ←` : `Open ${label} →`}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className={BUTTON_TERTIARY}
        >
          {arabicUi ? "نكمل" : "Stay here"}
        </button>
      </div>
    </div>
  );
}

/**
 * Transcript stand-in for a board-intercepted figure/question — keeps the
 * position in the thread; tapping re-pins the card on the whiteboard.
 *
 * Figures and questions are intercepted in every subject (the whiteboard
 * hosts maths figures too), so this chip's label follows `arabicUi` the same
 * way `CheckInCard` does — it used to be hardcoded Arabic and `dir="rtl"`
 * regardless of the session's language.
 */
function BoardChip({
  flavor,
  arabicUi,
  onOpen,
}: {
  flavor: "figure" | "question";
  arabicUi: boolean;
  onOpen?: () => void;
}) {
  // The pop lives on a wrapper: an entrance animation that fills `both`
  // keeps its last transform, which would swallow the press's translate.
  const label = arabicUi
    ? flavor === "figure"
      ? "شوف الرسمة ←"
      : "السؤال ع السبورة ←"
    : flavor === "figure"
      ? "See the figure →"
      : "Question on the board →";
  return (
    <span className="anim-pop my-1.5 inline-block">
      <button dir={arabicUi ? "rtl" : "ltr"} onClick={onOpen} className={CHIP_CONTROL}>
        <span aria-hidden>{flavor === "figure" ? "✎" : "⚡"}</span>
        {label}
      </button>
    </span>
  );
}

/**
 * The choice the student made, once the card has locked. Both buttons are
 * `disabled` after a pick, and the Play stylesheet's disabled rule (unlayered)
 * dashes the outline and greys the text of every disabled button — right for
 * the option NOT taken, wrong for the one that was: it would read as "broken"
 * rather than "you chose this". The picked one takes the Selected state from
 * the answer-option spec instead — Honey fill, solid ink outline, ink text —
 * and the `!` is what lets a layered utility outrank that unlayered rule. It
 * stays shadowless: a chosen button sits pressed into its own shadow.
 *
 * Neither choice is ever red. "Not yet" is not a wrong answer; asking for
 * another explanation is the product working as intended.
 */
const CHECK_IN_PICKED = "bg-card-warm! border-solid! border-ink! text-ink!";

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
    <div
      className={cx(STROKE, "anim-pop my-2 rounded-[var(--play-radius)] bg-card-warm px-4 py-3 sticker-shadow-sm")}
    >
      <p dir={dir} className={cx(HEADING, "mb-2.5 text-center text-[1.15rem]")}>
        {arabicUi ? "لسه معايا؟" : "Still with me?"}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          dir={dir}
          onClick={() => choose("no", noSignal)}
          disabled={disabled || picked != null}
          className={cx(BUTTON_SECONDARY, picked === "no" && CHECK_IN_PICKED)}
        >
          {arabicUi ? "لسه مش فاهم 🤔" : "Not yet 🤔"}
        </button>
        <button
          dir={dir}
          onClick={() => choose("yes", GOT_IT_SENTINEL)}
          disabled={disabled || picked != null}
          className={cx(BUTTON_SECONDARY, picked === "yes" && CHECK_IN_PICKED)}
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
          <span dir="rtl" className="text-[0.85rem] text-ink-faint">
            بيكتب…
          </span>
        ) : (
          <span className="text-[0.85rem] italic text-ink-faint">
            writing…
          </span>
        )
      ) : (
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-ink-faint">
          walking the graph
        </span>
      )}
      {/* the Play wait: three 9px amber dots, 1.3s, staggered 0/.18/.36s —
          "he's working on it", never a spinner */}
      <span className="inline-flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-[9px] rounded-full bg-[var(--noor-action)]"
            style={{
              animation: `think-dot 1.3s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        ))}
      </span>
    </span>
  );
}

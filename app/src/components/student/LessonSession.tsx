"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  AttemptResult,
  ChatMsg,
  LessonData,
  LessonMode,
  SpineQuestion,
  UnderstandingCheck,
} from "@/lib/types";
import { isRtlSubject } from "@/lib/subjects";
import type { Cite } from "@/lib/chat-parse";
import { ChatCore, type ChatCoreHandle } from "@/components/chat/ChatCore";
import { PairPlotter } from "@/components/student/widgets/PairPlotter";
import { ProductBuilder } from "@/components/student/widgets/ProductBuilder";
import { LocateOnMap } from "@/components/student/widgets/LocateOnMap";
import { TimelineBuilder } from "@/components/student/widgets/TimelineBuilder";
import { ChainBuilder } from "@/components/student/widgets/ChainBuilder";
import { TermMatch } from "@/components/student/widgets/TermMatch";
// Arabic vertical (ADR-0006)
import { ExtractSpans } from "@/components/student/widgets/ExtractSpans";
import { HamzaSeat } from "@/components/student/widgets/HamzaSeat";
import { StylePurpose } from "@/components/student/widgets/StylePurpose";
import { IrabBuilder } from "@/components/student/widgets/IrabBuilder";
import type { IrabAnswer, NounType } from "@/lib/irab";
import { renderVizWidget } from "@/components/viz/render-viz-widget";
import { ReportCard } from "@/components/student/ReportCard";
import {
  WhiteboardPanel,
  arDigits,
  boardItemOf,
  boardKeyOf,
  type BoardItem,
} from "@/components/student/WhiteboardPanel";
import { makeRecognition, sttSupported, ttsSupported } from "@/lib/voice";
import { speakRemote, stopSpeaking, unlockAudio } from "@/lib/tts-client";
import type { LessonPassage } from "@/lib/lesson-content";
import {
  SealedPassageCard,
  type PassageHighlight,
} from "@/components/student/SealedPassageCard";

/**
 * The adaptive lesson surface — same engine, two temperaments.
 * learn  : AI-led interactive lesson in beats, taught ON the whiteboard —
 *          figures and check questions land on a persistent board panel
 *          (desktop: right column of the h-dvh app frame; mobile: a
 *          collapsible top sheet ≤40dvh) while the transcript keeps small
 *          re-pin chips in place (ChatCore interceptWidget).
 * review : non-annoying 3-minute lock-it-in (3 questions, 1 widget, ≤5 turns).
 * Both run in FOCUS MODE (body[data-focus] hides the global nav) and end in
 * the honest report card. An in-progress session survives reloads via
 * sessionStorage ("استكمل الدرس؟").
 */

const REVIEW_TURN_CAP = 5;

const MODE_COPY: Record<
  LessonMode,
  {
    label: string;
    ar: string;
    chip: string;
    finish: string;
    autoStart: string;
    opening: string;
  }
> = {
  learn: {
    label: "Teach me",
    ar: "الدرس من الأول",
    chip: "learn mode · AI-led lesson",
    finish: "Finish lesson",
    autoStart:
      "Start now. I just came home from school and I understood NOTHING from today's lesson. Teach me from zero, from the very first idea.",
    opening: "يلا بينا 💪 بجهّز درس النهاردة… ✏️",
  },
  review: {
    label: "Quick revision",
    ar: "مراجعة سريعة",
    chip: "review mode · 3 minutes",
    finish: "End now",
    autoStart:
      "I understood today's lesson at school completely. Start the quick lock-it-in revision now — first check question please.",
    opening: "ثواني — بجهّز أسئلة المراجعة السريعة… ⏱",
  },
};

type Phase = "session" | "rating" | "report" | "error";

/**
 * Arabic-first surface copy for RTL subjects (ADR-0004 Wave 1). Maths keeps
 * MODE_COPY untouched — every RTL/Arabic branch in this file gates on the
 * subject's registered direction, so the LTR surface stays pixel-identical.
 */
const AR_MODE_COPY: Record<
  LessonMode,
  { chip: string; finish: string; placeholder: string; strip: string }
> = {
  learn: {
    chip: "درس تفاعلي · خطوة خطوة",
    finish: "خلّص الدرس",
    placeholder: "اكتب إجابتك أو اسأل أي حاجة…",
    strip: "✦ كل جملة من كتاب الوزارة",
  },
  review: {
    chip: "مراجعة سريعة · ٣ دقايق",
    finish: "خلّص دلوقتي",
    placeholder: "اكتب إجابتك هنا…",
    strip: "✦ كل جملة من كتاب الوزارة",
  },
};

const AR_SUGGESTIONS = ["لسه مش فاهم — اشرحها بطريقة تانية", "فهمت — كمّل ✓"];

/**
 * {{show_passage:…}} renders as a REFOCUS CHIP, not a second copy of the text.
 * The passage cards already open the exchange (the `leading` slot) — field
 * report 2026-08-02: re-printing the full essay mid-chat buried the
 * conversation under a duplicate wall of text. Tapping the chip scrolls the
 * pinned card back into view and flashes it.
 *
 * With a span pointer (quote words for prose / آية number for sacred) the chip
 * also HIGHLIGHTS that span inside the pinned card — Samuel's follow-up call:
 * pointing at a whole paragraph is useless, the highlighted line is the key.
 * The highlight is applied on mount (as the directive streams in), so it is
 * already visible when the student scrolls up.
 */
function PassageRefChip({
  passage,
  span,
  onSpan,
}: {
  passage: LessonPassage;
  span?: { quote?: string; unit?: number };
  onSpan: (id: string, span: PassageHighlight | null) => void;
}) {
  const hasSpan = !!(span?.quote || span?.unit != null);
  useEffect(() => {
    if (hasSpan) onSpan(passage.id, span ?? null);
    // apply once per chip appearance — span/id are stable for a parsed block
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div dir="rtl" className="py-1">
      <button
        onClick={() => {
          const el =
            document.getElementById(`sealed-${passage.id}-mark`) ??
            document.getElementById(`sealed-${passage.id}`);
          if (!el) return;
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          const card = document.getElementById(`sealed-${passage.id}`);
          card?.classList.add("ring-2", "ring-gold", "rounded-xl");
          window.setTimeout(
            () => card?.classList.remove("ring-2", "ring-gold", "rounded-xl"),
            2200
          );
        }}
        className="rounded-full border border-gold/50 bg-gold-wash px-3.5 py-1.5 text-[12px] font-medium text-ink-soft shadow-sm transition-all duration-150 hover:-translate-y-px hover:border-gold"
      >
        {hasSpan
          ? span?.unit != null
            ? `📜 ${passage.kind === "quran" ? "الآية" : "الجزء"} ${arDigits(span.unit)} — معلّم عليها ليك في بطاقة النص فوق ⬆`
            : "📜 معلّم ليك على الجزء ده في بطاقة النص فوق ⬆"
          : `📜 بطاقة النص فوق — «${passage.title_ar}» ⬆`}
      </button>
    </div>
  );
}

/* ---------------- session persistence (sessionStorage) ---------------- */

const SAVE_VERSION = 1;

interface SavedSession {
  v: number;
  sid: string;
  messages: ChatMsg[];
  board: BoardItem[];
  focusKey: string | null;
  covered: string[];
  at: number;
}

// Scoped by STUDENT as well as mode+lesson: without the id, switching the
// demo student and opening the same lesson resumed the previous student's
// transcript (and inherited their server-side turn count) — found by the
// release review, 2026-07-30.
const storeKey = (mode: LessonMode, slug: string, studentId: number) =>
  `ainext-lesson:${mode}:${slug}:s${studentId}`;

/* Defensive readers for `{{widget:…}}` payloads. The directives are authored by
   a model, so every field is untrusted: a malformed payload must render nothing
   rather than throw inside the chat stream. */
const strProp = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const arrProp = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const objProp = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const strArrProp = (v: unknown): string[] =>
  arrProp(v)
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);

const makeSid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Boot =
  | { state: "checking" }
  | { state: "prompt"; saved: SavedSession }
  | { state: "ready"; seed: SavedSession | null };

export function LessonSession({
  mode,
  lesson,
  passages = [],
}: {
  mode: LessonMode;
  lesson: LessonData;
  /** SEALED text passages of this lesson (Arabic vertical, ADR-0006) — the
   *  bytes come from verified seed data, server-side. They are pinned onto
   *  السبورة from message one: Samuel's field finding was a tutor saying
   *  «افتح بطاقة النص» on a surface that displayed no text at all. */
  passages?: LessonPassage[];
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("session");
  const [check, setCheck] = useState<UnderstandingCheck | null>(null);
  const [ratingCost, setRatingCost] = useState(0);
  const [totalUsd, setTotalUsd] = useState(0);
  const [turns, setTurns] = useState(0);
  // labeled progress stepper: LOs covered so far, in teaching order
  const [covered, setCovered] = useState<string[]>([]);
  // de-instrumentation: receipts hidden from students by default; the
  // founders' easter egg (triple-tap the header) brings them back
  const [debug, setDebug] = useState(false);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerTap = useCallback(() => {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (tapCount.current >= 3) {
      tapCount.current = 0;
      setDebug((d) => !d);
      return;
    }
    tapTimer.current = setTimeout(() => {
      tapCount.current = 0;
    }, 900);
  }, []);

  // voice
  const [ttsOK, setTtsOK] = useState(false);
  const [sttOK, setSttOK] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;

  const msgsRef = useRef<ChatMsg[]>([]);
  const turnsRef = useRef(0);
  const finishing = useRef(false);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------------- whiteboard ("السبورة") ---------------- */

  // Samuel's call (2026-07-30): السبورة is merged INTO the exchange — one
  // wide chat where figures, questions and the sealed passage render inline
  // in the flow. The board plumbing below stays dormant (boardOn=false)
  // rather than deleted, so the split view can be resurrected by flipping
  // this if a future usability pass wants it back.
  const boardOn = false;
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [pinNonce, setPinNonce] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(true);
  /** keys restored from a saved session — start parked on their final frame */
  const parkedKeys = useRef<Set<string>>(new Set());
  const lastFigKey = useRef<string | null>(null);
  const coreHandle = useRef<ChatCoreHandle | null>(null);

  /* ---------------- session restore ---------------- */

  const [boot, setBoot] = useState<Boot>({ state: "checking" });
  const freshSid = useRef<string>(makeSid());

  useEffect(() => {
    let saved: SavedSession | null = null;
    try {
      const raw = sessionStorage.getItem(storeKey(mode, lesson.slug, lesson.studentId));
      if (raw) {
        const j = JSON.parse(raw) as SavedSession;
        if (
          j &&
          j.v === SAVE_VERSION &&
          typeof j.sid === "string" &&
          Array.isArray(j.messages) &&
          j.messages.some((m) => m.role === "assistant" && m.text)
        ) {
          saved = j;
        }
      }
    } catch {
      /* corrupt save — start fresh */
    }
    setBoot(saved ? { state: "prompt", saved } : { state: "ready", seed: null });
  }, [mode, lesson.slug]);

  const resumeSaved = useCallback((saved: SavedSession) => {
    const restoredBoard = Array.isArray(saved.board) ? saved.board : [];
    parkedKeys.current = new Set(restoredBoard.map((b) => b.key));
    lastFigKey.current =
      [...restoredBoard].reverse().find((b) => b.type !== "question")?.key ??
      null;
    setBoard(restoredBoard);
    setFocusKey(saved.focusKey ?? lastFigKey.current);
    setCovered(Array.isArray(saved.covered) ? saved.covered : []);
    setBoot({ state: "ready", seed: saved });
  }, []);

  const startFresh = useCallback(() => {
    try {
      sessionStorage.removeItem(storeKey(mode, lesson.slug, lesson.studentId));
    } catch {
      /* noop */
    }
    setBoot({ state: "ready", seed: null });
  }, [mode, lesson.slug]);

  /* ---------------- sealed passages on the board ---------------- */

  // The lesson's sealed text is pinned onto السبورة the moment the session
  // opens (fresh OR restored) — the tutor teaches ON it and refers to it by
  // آية number; it must never be off-screen while it is being taught.
  const passageById = useRef(new Map(passages.map((p) => [p.id, p])));
  passageById.current = new Map(passages.map((p) => [p.id, p]));
  useEffect(() => {
    if (boot.state !== "ready" || !boardOn || passages.length === 0) return;
    const items: BoardItem[] = passages.map((p) => ({
      key: `passage:${p.id}`,
      type: "passage",
      id: p.id,
    }));
    setBoard((prev) => [
      ...items.filter((it) => !prev.some((b) => b.key === it.key)),
      ...prev,
    ]);
    // fresh session: open ON the text (a restored one keeps its saved focus)
    if (!boot.seed) {
      setFocusKey((k) => k ?? items[0].key);
      lastFigKey.current ??= items[0].key;
    }
    // deliberately once per boot state — passages are static lesson data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot.state, boardOn]);

  const lookupPassage = useCallback(
    (id: string) => passageById.current.get(id),
    []
  );

  // The span the tutor is currently pointing at, per pinned passage — set by
  // the latest {{show_passage:{…,"quote"/"unit"}}} chip, rendered as a <mark>
  // inside the pinned card (a NEW pointer replaces the previous one: one
  // "current focus" per passage, like a finger moving along the page).
  const [passageSpans, setPassageSpans] = useState<
    Record<string, PassageHighlight>
  >({});
  const onPassageSpan = useCallback(
    (id: string, span: PassageHighlight | null) => {
      setPassageSpans((prev) => {
        if (span == null) {
          if (!(id in prev)) return prev;
          const rest = { ...prev };
          delete rest[id];
          return rest;
        }
        const cur = prev[id];
        if (cur && cur.quote === span.quote && cur.unit === span.unit)
          return prev;
        return { ...prev, [id]: span };
      });
    },
    []
  );

  const sessionId =
    boot.state === "ready" ? (boot.seed?.sid ?? freshSid.current) : undefined;

  /* ---------------- throttled save ---------------- */

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;
  const focusKeyRef = useRef(focusKey);
  focusKeyRef.current = focusKey;
  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  const sessionIdRef = useRef<string | undefined>(sessionId);
  sessionIdRef.current = sessionId;

  const doSave = useCallback(() => {
    if (finishing.current || !sessionIdRef.current) return;
    const messages = msgsRef.current
      .filter((m) => !m.streaming)
      .map((m) => {
        const { streaming: _s, reveal: _r, ...rest } = m;
        return rest as ChatMsg;
      });
    if (!messages.some((m) => m.role === "assistant" && m.text)) return;
    try {
      const saved: SavedSession = {
        v: SAVE_VERSION,
        sid: sessionIdRef.current,
        messages,
        board: boardRef.current,
        focusKey: focusKeyRef.current,
        covered: coveredRef.current,
        at: Date.now(),
      };
      sessionStorage.setItem(
        storeKey(mode, lesson.slug, lesson.studentId),
        JSON.stringify(saved)
      );
    } catch {
      /* storage full/unavailable — resume is best-effort */
    }
  }, [mode, lesson.slug]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) return; // throttle: at most one write per 900ms
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      doSave();
    }, 900);
  }, [doSave]);

  useEffect(() => {
    if (boot.state === "ready") scheduleSave();
  }, [board, focusKey, covered, boot.state, scheduleSave]);

  useEffect(() => {
    setTtsOK(ttsSupported());
    setSttOK(sttSupported());
    return () => {
      stopSpeaking();
      if (finishTimer.current) clearTimeout(finishTimer.current);
      if (tapTimer.current) clearTimeout(tapTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (refocusTimer.current) clearTimeout(refocusTimer.current);
    };
  }, []);

  /* ---------- focus mode: hide the global nav during the lesson ---------- */

  useEffect(() => {
    if (phase === "session" || phase === "rating") {
      document.body.dataset.focus = "lesson";
      return () => {
        delete document.body.dataset.focus;
      };
    }
  }, [phase]);

  const questionById = useMemo(
    () => new Map(lesson.questions.map((q) => [q.id, q])),
    [lesson.questions]
  );
  const loById = useMemo(
    () => new Map(lesson.los.map((l) => [l.id, l])),
    [lesson.los]
  );
  const vizMeta = useMemo(
    () => new Map(lesson.visuals.map((v) => [v.id, v])),
    [lesson.visuals]
  );

  const copy = MODE_COPY[mode];
  const first = lesson.studentName.split(" ")[0];
  // subject-conditional RTL flip: dir on the app frame flips the grid (board
  // lands on the LEFT so the reading eye starts at the text), the stepper and
  // the chips; logical CSS below keeps LTR subjects unchanged. The flip now
  // follows the subject's registered direction rather than a social-ar test.
  const rtl = isRtlSubject(lesson.subject);
  const arCopy = AR_MODE_COPY[mode];

  /* ---------------- finish → honest rating ---------------- */

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    stopSpeaking();
    setPhase("rating");
    try {
      const transcript = msgsRef.current
        .filter((m) => !m.hidden && m.text && !m.streaming)
        .map((m) => ({ role: m.role, text: m.text }));
      const res = await fetch("/api/understanding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          lesson: lesson.slug,
          transcript,
          turns: turnsRef.current,
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const j = (await res.json()) as {
        check: UnderstandingCheck;
        costUsd: number;
      };
      // the session is complete — a finished lesson never offers a resume
      try {
        sessionStorage.removeItem(storeKey(mode, lesson.slug, lesson.studentId));
      } catch {
        /* noop */
      }
      setCheck(j.check);
      setRatingCost(j.costUsd);
      setPhase("report");
    } catch {
      finishing.current = false;
      setPhase("error");
    }
  }, [mode, lesson.slug]);

  const requestFinish = useCallback(
    (delayMs = 0) => {
      if (finishing.current || finishTimer.current) return;
      finishTimer.current = setTimeout(() => {
        finishTimer.current = null;
        finish();
      }, delayMs);
    },
    [finish]
  );

  /* ---------------- board wiring ---------------- */

  /** Pure predicate for ChatCore: do we own this card on the board? */
  const interceptWidget = useCallback(
    (name: string, props: Record<string, unknown>) =>
      boardKeyOf(name, props) != null,
    []
  );

  /** Directive revealed (or re-pin chip tapped) → push/focus on the board. */
  const onDirective = useCallback(
    (name: string, props: Record<string, unknown>) => {
      const item = boardItemOf(name, props);
      if (!item) return;
      // dedupe by key: a repeated viz_ref re-pins (and replays) — no re-push
      setBoard((prev) =>
        prev.some((it) => it.key === item.key) ? prev : [...prev, item]
      );
      setFocusKey(item.key);
      if (item.type !== "question") lastFigKey.current = item.key;
      // a live push/re-pin always plays — even if it was restored parked
      parkedKeys.current.delete(item.key);
      setPinNonce((n) => n + 1);
      setSheetOpen(true);
    },
    []
  );

  /** Board-hosted question answered → back into the chat flow; the board
   *  hands focus back to the last figure after the result lands. */
  const boardAttempt = useCallback((r: AttemptResult, q: SpineQuestion) => {
    coreHandle.current?.attemptResult(r, q);
    if (refocusTimer.current) clearTimeout(refocusTimer.current);
    refocusTimer.current = setTimeout(() => {
      refocusTimer.current = null;
      if (lastFigKey.current) setFocusKey(lastFigKey.current);
    }, 1800);
  }, []);

  /* ---------------- ChatCore wiring ---------------- */

  const renderWidget = useCallback(
    (
      name: string,
      props: Record<string, unknown>,
      emitNote: (note: string) => void
    ) => {
      if (name === "pair_plotter") {
        const target = props.target;
        if (
          Array.isArray(target) &&
          target.length === 2 &&
          target.every((v) => Number.isInteger(v) && Math.abs(v as number) <= 5)
        ) {
          return (
            <PairPlotter
              prompt={String(props.prompt ?? "Plot the point")}
              target={[target[0] as number, target[1] as number]}
              onResult={emitNote}
            />
          );
        }
      }
      // {{widget:viz:{…}}} composed figure / {{widget:viz_ref:v:…}} stored
      // figure — shared with the spine dock; degrades bad payloads to chips.
      // (In learn mode these are intercepted onto the board and never reach
      // this renderer.)
      const viz = renderVizWidget(name, props);
      if (viz) return viz;
      if (name === "product_builder") {
        const X = props.X;
        const Y = props.Y;
        if (
          Array.isArray(X) &&
          Array.isArray(Y) &&
          X.length > 0 &&
          Y.length > 0 &&
          [...X, ...Y].every((v) => typeof v === "number")
        ) {
          return (
            <ProductBuilder
              X={X as number[]}
              Y={Y as number[]}
              prompt={String(props.prompt ?? "Tap all the pairs of X×Y")}
              onResult={emitNote}
            />
          );
        }
      }
      // ---- social-studies widgets (ADR-0004 Wave 1) — same contract as
      // pair_plotter: deterministic client grading, one onResult note into
      // the [live event] + auto-continue flow. Bad payloads render nothing.
      if (name === "locate_on_map") {
        const base = props.base;
        const target = props.target;
        if (
          typeof base === "string" &&
          /^[a-z_]{1,32}$/.test(base) &&
          typeof target === "string" &&
          target.trim().length > 0
        ) {
          const decoys = Array.isArray(props.decoys)
            ? props.decoys
                .filter((d): d is string => typeof d === "string" && !!d.trim())
                .slice(0, 4)
            : undefined;
          return (
            <LocateOnMap
              base={base}
              prompt={String(props.prompt ?? "حدد المكان على الخريطة")}
              target={target}
              decoys={decoys}
              onResult={emitNote}
            />
          );
        }
      }
      if (name === "timeline_builder") {
        const events = props.events;
        if (
          Array.isArray(events) &&
          events.length >= 2 &&
          events.length <= 8 &&
          events.every((e) => typeof e === "string" && e.trim().length > 0)
        ) {
          const order = Array.isArray(props.correctOrder)
            ? props.correctOrder.filter((n): n is number => Number.isInteger(n))
            : undefined;
          return (
            <TimelineBuilder
              prompt={String(props.prompt ?? "رتب الأحداث زي ما حصلت")}
              events={events as string[]}
              correctOrder={order}
              onResult={emitNote}
            />
          );
        }
      }
      if (name === "chain_builder") {
        const rawCards = props.cards;
        if (Array.isArray(rawCards) && rawCards.length >= 2 && rawCards.length <= 6) {
          const cards: { label: string; role?: string }[] = [];
          for (const c of rawCards) {
            if (c === null || typeof c !== "object" || Array.isArray(c)) continue;
            const label = String((c as { label?: unknown }).label ?? "");
            const role = (c as { role?: unknown }).role;
            if (!label) continue;
            cards.push(
              typeof role === "string" ? { label, role } : { label }
            );
          }
          if (cards.length === rawCards.length) {
            const chain = Array.isArray(props.correctChain)
              ? props.correctChain.filter((n): n is number => Number.isInteger(n))
              : undefined;
            return (
              <ChainBuilder
                prompt={String(props.prompt ?? "ركّب السلسلة بالترتيب")}
                cards={cards}
                correctChain={chain}
                onResult={emitNote}
              />
            );
          }
        }
      }
      if (name === "term_match") {
        const rawPairs = props.pairs;
        if (Array.isArray(rawPairs) && rawPairs.length >= 1 && rawPairs.length <= 6) {
          const pairs = rawPairs.filter(
            (p): p is { term: string; definition?: string; def?: string } =>
              p !== null &&
              typeof p === "object" &&
              !Array.isArray(p) &&
              typeof (p as { term?: unknown }).term === "string"
          );
          if (pairs.length === rawPairs.length) {
            const decoyDefs = Array.isArray(props.decoyDefs)
              ? props.decoyDefs
                  .filter((d): d is string => typeof d === "string" && !!d.trim())
                  .slice(0, 4)
              : undefined;
            return (
              <TermMatch
                prompt={
                  typeof props.prompt === "string" ? props.prompt : undefined
                }
                pairs={pairs}
                decoyDefs={decoyDefs}
                onResult={emitNote}
              />
            );
          }
        }
      }
      // ---- Arabic widgets (ADR-0006). Same contract again: deterministic
      // client grading, one note into the [live event] flow, bad payloads
      // render nothing. `irab_builder` adds a content gate of its own — it
      // refuses an answer key that cites no printed rule (see the widget).
      if (name === "extract_spans") {
        const text = strProp(props.text);
        const targets = strArrProp(props.targets);
        if (text && targets.length > 0) {
          return (
            <ExtractSpans
              prompt={strProp(props.prompt) || "دوس على الكلمات المطلوبة"}
              text={text}
              category={strProp(props.category) || "نحو"}
              targets={targets}
              distractorHint={strProp(props.distractorHint) || undefined}
              onResult={emitNote}
            />
          );
        }
      }
      if (name === "hamza_seat") {
        const items = arrProp(props.items)
          .map((raw) => {
            const it = objProp(raw);
            const word = strProp(it.word);
            const answer = strProp(it.answer);
            if (!word || !answer) return null;
            return {
              word,
              answer,
              seats: strArrProp(it.seats),
              rule: strProp(it.rule) || undefined,
              page: typeof it.page === "number" ? it.page : undefined,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        if (items.length > 0) {
          return (
            <HamzaSeat
              prompt={strProp(props.prompt) || "الهمزة دي بتتكتب إزاي؟"}
              items={items}
              onResult={emitNote}
            />
          );
        }
      }
      if (name === "style_purpose") {
        const ans = objProp(props.answer);
        const text = strProp(props.text);
        const span = strProp(props.span);
        const style = strProp(ans.style);
        const purpose = strProp(ans.purpose);
        const styles = strArrProp(props.styles);
        const purposes = strArrProp(props.purposes);
        if (text && span && style && purpose && styles.length >= 2 && purposes.length >= 2) {
          return (
            <StylePurpose
              prompt={strProp(props.prompt) || "الأسلوب ده إيه، وغرضه إيه؟"}
              text={text}
              span={span}
              styles={styles}
              purposes={purposes}
              answer={{ style, purpose }}
              onResult={emitNote}
            />
          );
        }
      }
      if (name === "irab_builder") {
        const ans = objProp(props.answer);
        const sentence = strProp(props.sentence);
        const target = strProp(props.target);
        const roles = strArrProp(props.roles);
        const marks = strArrProp(props.marks);
        const ref = objProp(props.rule_ref);
        if (
          sentence &&
          target &&
          roles.length >= 2 &&
          marks.length >= 2 &&
          strProp(ans.word_ar) &&
          strProp(ans.role_ar)
        ) {
          return (
            <IrabBuilder
              prompt={strProp(props.prompt) || "أعرب الكلمة اللي تحتها خط"}
              sentence={sentence}
              target={target}
              roles={roles}
              marks={marks}
              answer={ans as unknown as IrabAnswer}
              rule_ref={{
                quote: strProp(ref.quote) || undefined,
                page: typeof ref.page === "number" ? ref.page : undefined,
              }}
              nounType={(strProp(props.nounType) || undefined) as NounType | undefined}
              onResult={emitNote}
            />
          );
        }
      }
      return null;
    },
    []
  );

  const resolveCite = useCallback(
    (c: Cite) => {
      if (c.kind === "page")
        return {
          title: "Ministry textbook",
          sub: `MOETE 2025–2026 · page ${c.id}`,
        };
      if (c.kind === "q") {
        const q = questionById.get(c.id);
        return {
          title: q ? "Reviewed question" : c.id,
          sub: `${c.id} · human-approved canonical solution`,
        };
      }
      if (c.kind === "term") {
        // [[term?:…]] — a term outside the lesson data, flagged for review
        return {
          title: c.id,
          sub: "مصطلح غير موجود في بيانات الدرس — للمراجعة",
        };
      }
      const lo = loById.get(c.id);
      return {
        title: lo?.label ?? c.id,
        sub: `learning objective · ${lesson.lessonRef}`,
      };
    },
    [questionById, loById, lesson.lessonRef]
  );

  const onCite = useCallback(
    (c: Cite) => {
      if (c.kind === "lo" && loById.has(c.id)) {
        setCovered((prev) => (prev.includes(c.id) ? prev : [...prev, c.id]));
      }
    },
    [loById]
  );

  const onAssistantDone = useCallback((text: string) => {
    if (voiceOnRef.current) {
      // Neural voice via /api/tts, with automatic Web Speech fallback.
      void speakRemote(text, {
        onStart: () => setSpeaking(true),
        onEnd: () => setSpeaking(false),
      });
    }
  }, []);

  const onTotalChange = useCallback(
    (usd: number, t: number) => {
      setTotalUsd(usd);
      setTurns(t);
      turnsRef.current = t;
      if (mode === "review" && t >= REVIEW_TURN_CAP) requestFinish(2500);
    },
    [mode, requestFinish]
  );

  const onMessagesChange = useCallback(
    (msgs: ChatMsg[]) => {
      msgsRef.current = msgs;
      scheduleSave();
    },
    [scheduleSave]
  );

  const lookupQuestion = useCallback(
    (qid: string) => questionById.get(qid),
    [questionById]
  );

  const toggleVoice = () => {
    // First tap is a user gesture — unlock programmatic <audio> playback so the
    // neural voice can start later without a click (browser autoplay policy).
    unlockAudio();
    setVoiceOn((v) => {
      if (v) {
        stopSpeaking();
        setSpeaking(false);
      }
      return !v;
    });
  };

  /* ---------------- render ---------------- */

  if (phase === "report" && check) {
    return (
      <main
        dir={rtl ? "rtl" : undefined}
        className="mx-auto max-w-3xl px-6 pb-16 pt-10"
      >
        <ReportCard
          check={check}
          mode={mode}
          costUsd={ratingCost}
          studentName={lesson.studentName}
          rtl={rtl}
        />
      </main>
    );
  }

  if (phase === "rating" || phase === "error") {
    return (
      <main
        dir={rtl ? "rtl" : undefined}
        className="mx-auto max-w-3xl px-6 pb-16 pt-10"
      >
        <section className="ledger-card anim-pop mx-auto max-w-xl px-8 py-10 text-center">
          {phase === "rating" ? (
            <>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
                {rtl ? "بنقيّم الجلسة كلها · بأمانة" : "grading the whole session · honestly"}
              </p>
              <p className="mt-3 font-display text-2xl font-medium text-ink">
                {rtl ? "قد إيه فعلاً رسّخ معاك؟" : "How much of it really landed?"}
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
                {rtl
                  ? "المدرّس بيرجع يقرأ كل اللي عملته النهاردة — كل إجابة وكل لمسة — وبيكتب تقرير فهمك."
                  : "The tutor is re-reading everything you did — every answer, every tap on a widget — and writing your comprehension report."}
              </p>
              <span className="mt-5 inline-flex gap-[5px]">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-accent"
                    style={{
                      animation: `think-dot 1.1s ease-in-out ${i * 0.18}s infinite`,
                    }}
                  />
                ))}
              </span>
            </>
          ) : (
            <>
              <p className="font-display text-2xl font-medium text-ink">
                {rtl ? "المصحّح مش متاح دلوقتي" : "The grader is unavailable"}
              </p>
              <p className="mt-2 text-[13.5px] text-ink-soft">
                {rtl
                  ? "جلستك محفوظة — جرّب التقييم تاني."
                  : "Your session is safe — try the rating again."}
              </p>
              <button
                onClick={() => finish()}
                className="mt-5 rounded-full bg-ink px-6 py-2.5 text-[14px] font-semibold text-paper transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-deep"
              >
                {rtl ? "جرّب التقييم تاني ←" : "Retry rating →"}
              </button>
            </>
          )}
        </section>
      </main>
    );
  }

  const stepNow = Math.min(Math.max(covered.length, 1), lesson.los.length);
  const currentLo =
    (covered.length ? loById.get(covered[covered.length - 1]) : undefined) ??
    lesson.los[0];

  return (
    <main
      dir={rtl ? "rtl" : undefined}
      className="mx-auto flex h-dvh min-h-[540px] w-full max-w-4xl flex-col px-4 pb-3 pt-4 md:px-6"
    >
      {/* header */}
      <section className="anim-rise shrink-0">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          {/* triple-tap = founders' easter egg: toggles the receipts back on */}
          <div onClick={headerTap} className="select-none">
            <p className="rule-label mb-1 pe-2">
              {rtl ? arCopy.chip : copy.chip} · {first}
              {debug && (
                <span className="ms-2 text-gold" title="debug receipts on">
                  · receipts on
                </span>
              )}
            </p>
            <h1 className="font-display text-xl font-medium tracking-tight text-ink md:text-2xl">
              {lesson.lessonRef} — {lesson.title}
              <span dir="rtl" className="ms-3 text-[16px] text-accent-deep">
                {copy.ar}
              </span>
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {ttsOK && (
              <button
                onClick={toggleVoice}
                aria-pressed={voiceOn}
                aria-label={voiceOn ? "Turn voice off" : "Turn voice on"}
                title={voiceOn ? "Voice on — tutor speaks" : "Voice off"}
                className={`flex h-8 items-center gap-1.5 rounded-full border px-3 font-mono text-[10px] uppercase tracking-[0.1em] transition-all duration-150 ${
                  voiceOn
                    ? "border-accent bg-accent text-paper"
                    : "border-line bg-card text-ink-soft hover:border-accent/50 hover:text-accent-deep"
                }`}
              >
                <SpeakerIcon />
                {speaking ? (
                  <span className="inline-flex gap-[3px]" aria-label="speaking">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="h-1 w-1 rounded-full bg-current"
                        style={{
                          animation: `think-dot 0.9s ease-in-out ${i * 0.15}s infinite`,
                        }}
                      />
                    ))}
                  </span>
                ) : (
                  <span>{voiceOn ? "on" : "voice"}</span>
                )}
              </button>
            )}

            <button
              onClick={() => requestFinish(0)}
              className="h-8 rounded-full bg-ink px-4 text-[12px] font-semibold text-paper transition-all duration-150 hover:-translate-y-px hover:bg-accent-deep"
            >
              {rtl ? `${arCopy.finish} ←` : `${copy.finish} →`}
            </button>
          </div>
        </div>

        {/* labeled progress stepper + the up-front promise */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5" aria-hidden>
            {lesson.los.map((l) => (
              <span
                key={l.id}
                className="h-2 w-7 rounded-full transition-colors duration-500"
                style={{
                  backgroundColor: covered.includes(l.id)
                    ? "var(--accent)"
                    : "rgba(32,41,58,0.15)",
                }}
              />
            ))}
          </span>
          <span dir="rtl" className="text-[12.5px] font-semibold text-ink">
            {arDigits(stepNow)} من {arDigits(lesson.los.length)} ·{" "}
            {/* social LO labels are Arabic — keep them in the RTL flow */}
            <span dir={rtl ? undefined : "ltr"} className="font-normal text-ink-soft">
              {currentLo?.label}
            </span>
          </span>
          <span dir="rtl" className="text-[11px] text-ink-faint">
            {arDigits(lesson.los.length)} خطوات وبعدها تقرير فهمك 📋
          </span>
        </div>
      </section>

      {boot.state === "prompt" ? (
        <ResumePrompt
          onResume={() => resumeSaved(boot.saved)}
          onFresh={startFresh}
        />
      ) : boot.state === "ready" ? (
        <div className="anim-rise mt-3 flex min-h-0 flex-1 flex-col gap-3">
          {/* the whiteboard — OUTSIDE the chat scroll container.
              mobile: collapsible top sheet ≤40dvh; desktop: in-flow right
              column pinned by the h-dvh app frame (never position:fixed —
              the Android keyboard pit). */}
          {boardOn && (
            <div
              className={`min-h-0 shrink-0 md:order-2 md:flex md:min-h-0 md:flex-1 md:flex-col ${
                sheetOpen ? "max-h-[40dvh] md:max-h-none" : ""
              }`}
            >
              <WhiteboardPanel
                items={board}
                focusKey={focusKey}
                onFocus={setFocusKey}
                pinNonce={pinNonce}
                parked={parkedKeys.current}
                lookupQuestion={lookupQuestion}
                lookupPassage={lookupPassage}
                onAttempt={boardAttempt}
                debug={debug}
                vizMeta={vizMeta}
                collapsed={!sheetOpen}
                onToggleCollapsed={() => setSheetOpen((o) => !o)}
              />
            </div>
          )}

          {/* lesson stream */}
          <section className="ledger-card flex min-h-0 flex-1 flex-col overflow-hidden md:order-1">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-card-warm px-4 py-2">
              {rtl ? (
                <span dir="rtl" className="text-[10.5px] font-semibold text-accent-deep">
                  {arCopy.strip} · {lesson.lessonRef}
                </span>
              ) : (
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-accent-deep">
                  ✦ grounded in the reviewed spine · {lesson.lessonRef} only
                </span>
              )}
              {debug ? (
                <span className="font-mono text-[9px] text-ink-faint">
                  {mode === "review"
                    ? `turn ${Math.min(turns, REVIEW_TURN_CAP)}/${REVIEW_TURN_CAP} · `
                    : ""}
                  ${totalUsd.toFixed(3)} session spend
                </span>
              ) : (
                <span dir="rtl" className="text-[10.5px] text-ink-faint">
                  {mode === "review" ? "٣ دقايق وخلصنا ⏱" : "خطوة خطوة مع بعض ✏️"}
                </span>
              )}
            </div>

            <ChatCore
              surface={mode === "learn" ? "lesson_learn" : "lesson_review"}
              lessonSlug={lesson.slug}
              sessionId={sessionId}
              initialMessages={boot.seed?.messages}
              autoStart={copy.autoStart}
              autoStartHidden
              autoContinue
              debug={debug}
              openingLine={copy.opening}
              placeholder={
                rtl
                  ? arCopy.placeholder
                  : mode === "learn"
                    ? "Answer or ask anything…"
                    : "Answer here…"
              }
              suggestions={
                mode === "learn"
                  ? rtl
                    ? AR_SUGGESTIONS
                    : ["لسه مش فاهم — say it another way", "Got it — next ✓"]
                  : []
              }
              lookupQuestion={lookupQuestion}
              resolveCite={resolveCite}
              onCite={onCite}
              renderWidget={renderWidget}
              renderPassage={(id, span) => {
                const p = lookupPassage(id);
                return p ? (
                  <PassageRefChip
                    passage={p}
                    span={span}
                    onSpan={onPassageSpan}
                  />
                ) : (
                  // an unresolvable id must fail VISIBLY, not vanish — the
                  // tutor believes it just showed the student a text
                  <p dir="rtl" className="py-2 text-center text-[12px] text-rust">
                    النص ده مش متاح في بيانات الدرس
                  </p>
                );
              }}
              leading={
                passages.length > 0 ? (
                  <div dir="rtl" className="space-y-2">
                    {passages.map((p) => (
                      <div key={p.id} id={`sealed-${p.id}`}>
                        <SealedPassageCard
                          passage={p}
                          compact
                          highlight={passageSpans[p.id]}
                          markId={`sealed-${p.id}-mark`}
                        />
                      </div>
                    ))}
                    <p className="pb-1 text-center text-[10.5px] text-ink-faint">
                      النص من الحافظة الموثقة · هنذاكر عليه مع بعض ⬇
                    </p>
                  </div>
                ) : undefined
              }
              interceptWidget={boardOn ? interceptWidget : undefined}
              onDirective={boardOn ? onDirective : undefined}
              handleRef={coreHandle}
              onAssistantDone={onAssistantDone}
              onFinishDirective={() => requestFinish(2200)}
              onCapped={() => requestFinish(2200)}
              onTotalChange={onTotalChange}
              onMessagesChange={onMessagesChange}
              onSwitchSubject={(subj) => router.push(`/student?subject=${subj}`)}
              inputAccessory={
                sttOK
                  ? (api) => <MicButton setInput={api.setInput} />
                  : undefined
              }
            />
          </section>
        </div>
      ) : (
        <div className="min-h-0 flex-1" />
      )}

      {rtl ? (
        <p dir="rtl" className="mt-2 shrink-0 text-center text-[10px] text-ink-faint">
          كل جملة من كتاب الوزارة، بمراجعة بشرية · وفي الآخر تقرير فهم بأمانة ·{" "}
          <Link
            href="/student"
            className="underline decoration-dotted underline-offset-2 hover:text-accent-deep"
          >
            ارجع للبداية
          </Link>
        </p>
      ) : (
        <p className="mt-2 shrink-0 text-center font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
          every beat grounded in human-reviewed solutions · session ends with an
          honest comprehension score ·{" "}
          <Link
            href="/student"
            className="underline decoration-dotted underline-offset-2 hover:text-accent-deep"
          >
            back to check-in
          </Link>
        </p>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */

/** A saved session exists for this lesson — resume or start over. */
function ResumePrompt({
  onResume,
  onFresh,
}: {
  onResume: () => void;
  onFresh: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center">
      <section className="ledger-card anim-pop mt-10 w-full max-w-md px-8 py-8 text-center">
        <p dir="rtl" className="font-display text-2xl font-medium text-ink">
          استكمل الدرس؟
        </p>
        <p
          dir="rtl"
          className="mt-2 text-[13.5px] leading-relaxed text-ink-soft"
        >
          كان معاك درس شغّال هنا قبل كده — تحب تكمّل من حيث وقفت؟
        </p>
        <div className="mt-5 grid gap-2">
          <button
            dir="rtl"
            onClick={onResume}
            className="rounded-full bg-accent-deep px-6 py-2.5 text-[14px] font-semibold text-paper transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent"
          >
            كمل من حيث وقفت ✓
          </button>
          <button
            dir="rtl"
            onClick={onFresh}
            className="rounded-full border border-line bg-card px-6 py-2.5 text-[13px] font-medium text-ink-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:text-accent-deep"
          >
            لا — ابدأ من الأول
          </button>
        </div>
      </section>
    </div>
  );
}

function MicButton({ setInput }: { setInput: (v: string) => void }) {
  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  useEffect(
    () => () => {
      try {
        recRef.current?.abort?.();
      } catch {
        /* noop */
      }
    },
    []
  );

  const toggle = () => {
    if (listening) {
      try {
        recRef.current?.stop?.();
      } catch {
        /* noop */
      }
      setListening(false);
      return;
    }
    const rec = makeRecognition();
    if (!rec) return;
    recRef.current = rec;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    rec.onresult = (e: any) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++)
        text += e.results[i][0].transcript;
      setInput(text.trim());
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label={listening ? "Stop listening" : "Speak your answer"}
      title={listening ? "Listening… tap to stop" : "Speak your answer"}
      className={`flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full border transition-all duration-150 ${
        listening
          ? "anim-mic border-rust bg-rust text-paper"
          : "border-line bg-card text-ink-soft hover:border-accent/50 hover:text-accent-deep"
      }`}
    >
      <MicIcon />
    </button>
  );
}

function MicIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="5" y="1.5" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 7.5a4 4 0 0 0 8 0M7 11.5v1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2 5.5v3h2.2L7.5 11V3L4.2 5.5H2z"
        fill="currentColor"
      />
      <path
        d="M9.5 4.5a3.4 3.4 0 0 1 0 5M11 3a5.6 5.6 0 0 1 0 8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

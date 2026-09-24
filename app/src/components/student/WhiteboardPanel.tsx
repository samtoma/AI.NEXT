"use client";

/**
 * "Whiteboard" ("السبورة" in the Arabic verticals) — the persistent lesson
 * whiteboard (Wave B2).
 *
 * The current figure and the current question live HERE, outside the chat
 * scroll container: desktop = the sticky right column of the lesson grid,
 * mobile = a collapsible top sheet (≤40dvh). The transcript keeps small
 * re-pin chips at the original positions (ChatCore interceptWidget).
 *
 * Figures play in controlled steps (VizPlaybackContext mode "step"):
 * auto-advance ~3s per step while the beat is being read, "▸ Next"/"▸ التالي"
 * tap-advance, step dots, replay. Questions take the board focus and hand
 * it back to the last figure once answered.
 *
 * Every string here branches on `arabicUi` (the subject's registered `dir`,
 * same source as `ChatCore`/`ReportCard`) — this panel hosts figures for
 * EVERY subject, including maths, so its chrome used to leak unconditional
 * Arabic into English lessons before this fix.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AttemptResult,
  LessonViz,
  SpineQuestion,
} from "@/lib/types";
import type { LessonPassage } from "@/lib/lesson-content";
import { cardRevealUnlocked } from "@/lib/socratic-probing";
import { SealedPassageCard } from "@/components/student/SealedPassageCard";
import { Visual } from "@/components/viz/Visual";
import { VizPlaybackContext } from "@/components/viz/core";
import { vizStepCount } from "@/components/viz/steps";
import { ChatQuestionCard } from "@/components/chat/ChatQuestionCard";
import {
  HONEY_BAND,
  ICON_BUTTON,
  STICKER_CARD,
  STROKE_SM,
  cx,
} from "@/components/sticker";

/* ---------------- board model ---------------- */

export type BoardItem =
  | {
      key: string;
      type: "viz";
      kind: string;
      spec: Record<string, unknown>;
      caption?: string;
    }
  | { key: string; type: "viz_ref"; id: string }
  | { key: string; type: "question"; qid: string }
  /** a SEALED text passage (ADR-0006) — resolved by id from verified lesson
   *  data, never from a model payload. The Arabic lessons teach ON this. */
  | { key: string; type: "passage"; id: string };

/** Stable board key for an incoming directive (dedupes repeated viz_ref). */
export function boardKeyOf(
  name: string,
  props: Record<string, unknown>
): string | null {
  if (name === "viz_ref" && typeof props.id === "string") {
    return `ref:${props.id}`;
  }
  if (name === "question" && typeof props.qid === "string") {
    return `q:${props.qid}`;
  }
  if (name === "passage" && typeof props.id === "string") {
    return `passage:${props.id}`;
  }
  if (name === "viz" && typeof props.kind === "string") {
    // identical composed payloads dedupe to the same key
    try {
      return `viz:${JSON.stringify(props)}`;
    } catch {
      return null;
    }
  }
  return null;
}

export function boardItemOf(
  name: string,
  props: Record<string, unknown>
): BoardItem | null {
  const key = boardKeyOf(name, props);
  if (!key) return null;
  if (name === "viz_ref") return { key, type: "viz_ref", id: String(props.id) };
  if (name === "question")
    return { key, type: "question", qid: String(props.qid) };
  if (name === "passage") return { key, type: "passage", id: String(props.id) };
  const spec = props.spec;
  if (spec === null || typeof spec !== "object" || Array.isArray(spec))
    return null;
  return {
    key,
    type: "viz",
    kind: String(props.kind),
    spec: spec as Record<string, unknown>,
    caption: typeof props.caption === "string" ? props.caption : undefined,
  };
}

/* ---------------- stored-figure fetch (shared cache) ---------------- */

interface VisualDto {
  id: string;
  kind: string;
  spec: Record<string, unknown>;
  caption: string | null;
  sourcePage: number | null;
}

const refCache = new Map<string, Promise<VisualDto | null>>();

function fetchVisual(id: string): Promise<VisualDto | null> {
  let p = refCache.get(id);
  if (!p) {
    p = fetch(`/api/visuals?id=${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        const j = (await res.json()) as { visual?: VisualDto };
        return j.visual && j.visual.spec && typeof j.visual.spec === "object"
          ? j.visual
          : null;
      })
      .catch(() => null);
    refCache.set(id, p);
  }
  return p;
}

/* ---------------- helpers ---------------- */

export const arDigits = (n: number | string): string =>
  String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);

const AUTO_ADVANCE_MS = 2800; // "draws once slowly" — 2–4s per step
const BOARD_STRETCH = 1.6;

interface ResolvedFigure {
  kind: string;
  spec: Record<string, unknown>;
  caption?: string;
  page?: number | null;
  refId?: string;
}

/* ---------------- the panel ---------------- */

export function WhiteboardPanel({
  items,
  focusKey,
  onFocus,
  pinNonce,
  parked,
  lookupQuestion,
  lookupPassage,
  onAttempt,
  debug,
  arabicUi = false,
  vizMeta,
  collapsed,
  onToggleCollapsed,
  probing = false,
  pendingLoId = null,
  pendingAttemptId = null,
  pendingWrongCount = null,
  externalAttempt = null,
}: {
  items: BoardItem[];
  focusKey: string | null;
  onFocus: (key: string) => void;
  /** bumped on every directive/re-pin — parked figures replay */
  pinNonce: number;
  /** keys restored from a saved session — start on their final frame */
  parked: ReadonlySet<string>;
  lookupQuestion: (qid: string) => SpineQuestion | undefined;
  /** sealed passages of THIS lesson, by id (Arabic vertical; undefined
   *  elsewhere — a passage item then renders a calm not-available note) */
  lookupPassage?: (id: string) => LessonPassage | undefined;
  onAttempt: (r: AttemptResult, q: SpineQuestion) => void;
  debug: boolean;
  /** RTL/Arabic-script subject — forwarded to the question card's strings */
  arabicUi?: boolean;
  /** lesson figure library metadata (captions/pages without a fetch) */
  vizMeta: ReadonlyMap<string, LessonViz>;
  /** mobile top-sheet collapse (ignored on desktop via CSS) */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Socratic probing — whether this lesson probes, as the SERVER declared it
   *  (ADR-0021), mirrored from ChatCore by LessonSession (`onProbingChange`,
   *  beside `onPendingConfirmationChange`) so a board-hosted question card
   *  gates its reveal the same way an inline-transcript one does. */
  probing?: boolean;
  pendingLoId?: string | null;
  pendingAttemptId?: number | null;
  /** How many wrong attempts the pending cycle has taken — once
   *  `cardRevealUnlocked` says so (the second), the withholding lifts
   *  (ChatQuestionCard's `revealAnswer`). Nothing else lifts it (FR-3112). */
  pendingWrongCount?: number | null;
  /** A chat-typed answer ChatCore graded itself, mirrored down so THIS
   *  board-hosted card syncs its display too when it's the open question. */
  externalAttempt?: { questionId: string; result: AttemptResult } | null;
}) {
  const [refs, setRefs] = useState<Record<string, VisualDto | "missing">>({});
  const [steps, setSteps] = useState<Record<string, number>>({});

  // fetch any stored figures we haven't resolved yet
  useEffect(() => {
    let alive = true;
    for (const it of items) {
      if (it.type !== "viz_ref" || refs[it.id]) continue;
      fetchVisual(it.id).then((v) => {
        if (alive)
          setRefs((prev) =>
            prev[it.id] ? prev : { ...prev, [it.id]: v ?? "missing" }
          );
      });
    }
    return () => {
      alive = false;
    };
  }, [items, refs]);

  const focused = items.find((it) => it.key === focusKey) ?? null;

  const resolve = useCallback(
    (it: BoardItem): ResolvedFigure | "loading" | "missing" | null => {
      if (it.type === "viz")
        return { kind: it.kind, spec: it.spec, caption: it.caption };
      if (it.type !== "viz_ref") return null;
      const meta = vizMeta.get(it.id);
      const v = refs[it.id];
      if (v === "missing") return "missing";
      if (!v)
        return meta
          ? "loading" // header can already show caption/page — spec pending
          : "loading";
      return {
        kind: v.kind,
        spec: v.spec,
        caption: v.caption ?? meta?.caption ?? undefined,
        page: v.sourcePage ?? meta?.sourcePage,
        refId: it.id,
      };
    },
    [refs, vizMeta]
  );

  const fig =
    focused && focused.type !== "question" ? resolve(focused) : null;
  const figReady = fig !== null && fig !== "loading" && fig !== "missing";
  const total = figReady
    ? Math.max(1, vizStepCount((fig as ResolvedFigure).kind, (fig as ResolvedFigure).spec))
    : 1;
  const fKey = focused?.key ?? "";
  const step = steps[fKey] ?? (parked.has(fKey) ? total : 1);

  const setStep = useCallback(
    (key: string, s: number) => setSteps((prev) => ({ ...prev, [key]: s })),
    []
  );

  // auto-advance: the figure draws itself once, slowly, step by step
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!figReady || !fKey || step >= total) return;
    advanceTimer.current = setTimeout(
      () => setStep(fKey, Math.min(step + 1, total)),
      AUTO_ADVANCE_MS
    );
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, [figReady, fKey, step, total, setStep]);

  // re-pin of an already-finished figure → replay from step 1
  const lastNonce = useRef(pinNonce);
  useEffect(() => {
    if (pinNonce === lastNonce.current) return;
    lastNonce.current = pinNonce;
    if (figReady && fKey && (steps[fKey] ?? 0) >= total && total > 1) {
      setStep(fKey, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinNonce]);

  const playback = useMemo(
    () => ({
      mode: "step" as const,
      step,
      totalSteps: total,
      stretch: BOARD_STRETCH,
    }),
    [step, total]
  );

  const others = items.filter((it) => it.key !== focusKey).slice(-8);
  const focusedQ =
    focused?.type === "question" ? lookupQuestion(focused.qid) : undefined;
  const page = figReady ? (fig as ResolvedFigure).page : undefined;

  return (
    <section className={cx(STICKER_CARD, "flex min-h-0 flex-col overflow-hidden")}>
      {/* header */}
      <div className={cx(HONEY_BAND, "flex shrink-0 items-center justify-between gap-2 px-3.5 py-2")}>
        <span className="flex items-center gap-2">
          {arabicUi ? (
            <span dir="rtl" className="font-display text-[1.05rem] font-extrabold text-ink">
              السبورة ✎
            </span>
          ) : (
            <span className="font-display text-[1.05rem] font-extrabold text-ink">
              Whiteboard ✎
            </span>
          )}
          {debug && figReady && (fig as ResolvedFigure).refId && (
            <span className="font-mono text-[0.72rem] font-medium text-ink-faint">
              {(fig as ResolvedFigure).refId}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {/* Arabic, so never the mono face (handoff, TYPE) — the English
              form is mono like LessonCheckIn's "Textbook · {pageRange}". */}
          {page != null &&
            (arabicUi ? (
              <span dir="rtl" className="text-[0.85rem] font-bold text-ink-faint">
                من الكتاب ص{page}
              </span>
            ) : (
              <span dir="ltr" className="font-mono text-[0.72rem] font-medium text-ink-faint">
                Textbook · p.{page}
              </span>
            ))}
          <button
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={
              arabicUi
                ? collapsed
                  ? "افتح السبورة"
                  : "اقفل السبورة"
                : collapsed
                  ? "Open the whiteboard"
                  : "Close the whiteboard"
            }
            className={cx(ICON_BUTTON, "text-[0.85rem] md:hidden")}
          >
            {collapsed ? "▾" : "▴"}
          </button>
        </span>
      </div>

      {/* content (mobile: collapsible; desktop: always open) */}
      <div
        className={`thin-scroll min-h-0 flex-1 overflow-y-auto px-3.5 py-3 ${
          collapsed ? "hidden md:block" : ""
        }`}
      >
        {!focused &&
          (arabicUi ? (
            <p
              dir="rtl"
              className="py-8 text-center text-[1rem] leading-relaxed text-ink-faint"
            >
              هنرسم هنا مع بعض ✏️
            </p>
          ) : (
            <p className="py-8 text-center text-[1rem] leading-relaxed text-ink-faint">
              We'll draw here together ✏️
            </p>
          ))}

        {/* crossfade on swap: key remount + fade-in */}
        {focused && (
          <div key={focused.key} className="anim-fade">
            {focused.type === "question" &&
              (focusedQ ? (
                <ChatQuestionCard
                  question={focusedQ}
                  debug={debug}
                  lang={arabicUi ? "ar" : "en"}
                  onResult={onAttempt}
                  probing={probing}
                  revealAnswer={
                    pendingLoId === focusedQ.loId && cardRevealUnlocked(pendingWrongCount)
                  }
                  retryOfAttemptId={
                    pendingLoId === focusedQ.loId
                      ? (pendingAttemptId ?? undefined)
                      : undefined
                  }
                  externalResult={
                    externalAttempt && externalAttempt.questionId === focusedQ.id
                      ? externalAttempt
                      : undefined
                  }
                />
              ) : (
                <p className="font-mono text-[0.72rem] font-medium text-ink-faint">
                  → {focused.qid}
                </p>
              ))}

            {/* sealed text passage (ADR-0006): bytes from verified lesson
                data, resolved by id — the Arabic lessons teach ON this card */}
            {focused.type === "passage" &&
              (() => {
                const p = lookupPassage?.(focused.id);
                return p ? (
                  <SealedPassageCard passage={p} compact />
                ) : arabicUi ? (
                  <p dir="rtl" className="py-6 text-center text-[0.9rem] font-bold text-[color:var(--play-text-muted)]">
                    النص ده مش متاح في بيانات الدرس
                  </p>
                ) : (
                  <p className="py-6 text-center text-[0.9rem] font-bold text-[color:var(--play-text-muted)]">
                    This text isn't available in the lesson data
                  </p>
                );
              })()}

            {focused.type !== "question" && fig === "loading" && (
              <div className="flex items-center gap-2 py-8 justify-center">
                <span className="inline-flex gap-[3px]" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-2 w-2 rounded-[var(--play-radius-pill)] bg-[var(--noor-action)]"
                      style={{
                        animation: `think-dot 1.1s ease-in-out ${i * 0.18}s infinite`,
                      }}
                    />
                  ))}
                </span>
                <span dir={arabicUi ? "rtl" : "ltr"} className="text-[0.85rem] text-ink-faint">
                  {arabicUi ? "بجهّز الرسمة…" : "Preparing the figure…"}
                </span>
              </div>
            )}
            {focused.type !== "question" && fig === "missing" && (
              <p
                dir={arabicUi ? "rtl" : undefined}
                className="py-6 text-center text-[0.9rem] font-bold text-[color:var(--play-text-muted)]"
              >
                {arabicUi ? "الرسمة دي مش موجودة" : "This figure isn't available"}
              </p>
            )}

            {figReady && (
              <>
                <div className="board-figure">
                  <VizPlaybackContext.Provider value={playback}>
                    <Visual
                      kind={(fig as ResolvedFigure).kind}
                      spec={(fig as ResolvedFigure).spec}
                      caption={(fig as ResolvedFigure).caption ?? null}
                    />
                  </VizPlaybackContext.Provider>
                </div>

                {/* step controls */}
                {total > 1 && (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span
                      className="flex items-center gap-1"
                      aria-label={
                        arabicUi ? `خطوة ${step} من ${total}` : `Step ${step} of ${total}`
                      }
                    >
                      {Array.from({ length: Math.min(total, 12) }, (_, i) => (
                        <button
                          key={i}
                          onClick={() => setStep(fKey, i + 1)}
                          aria-label={arabicUi ? `الخطوة ${arDigits(i + 1)}` : `Step ${i + 1}`}
                          className="flex h-6 w-5 items-center justify-center"
                        >
                          {/* drawn steps are ink, steps to come are the
                              inactive grey — both outlined, so neither
                              vanishes on the white card */}
                          <span
                            className={cx(
                              STROKE_SM,
                              "h-2.5 w-2.5 rounded-[var(--play-radius-pill)] transition-colors duration-300",
                              i + 1 <= step ? "bg-ink" : "bg-[var(--play-inactive-fill)]"
                            )}
                          />
                        </button>
                      ))}
                    </span>
                    {step < total ? (
                      <button
                        dir={arabicUi ? "rtl" : "ltr"}
                        onClick={() => setStep(fKey, Math.min(step + 1, total))}
                        className={BOARD_STEP_BUTTON}
                      >
                        {arabicUi ? "▸ التالي" : "▸ Next"}
                      </button>
                    ) : (
                      <button
                        dir={arabicUi ? "rtl" : "ltr"}
                        onClick={() => setStep(fKey, 1)}
                        className={BOARD_STEP_BUTTON}
                      >
                        {arabicUi ? "↺ ارسمها تاني" : "↺ Draw it again"}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* filmstrip of prior figures/questions — tap to re-pin */}
        {others.length > 0 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto border-t border-line-soft pt-2.5">
            {others.map((it) => (
              <FilmThumb
                key={it.key}
                item={it}
                resolve={resolve}
                onFocus={onFocus}
                arabicUi={arabicUi}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** "Next step" / "draw it again" under a board figure: a small sticker
 *  that presses. Still a 52px target — the handoff's floor has no
 *  exception for secondary controls. */
const BOARD_STEP_BUTTON = cx(
  STROKE_SM,
  "inline-flex min-h-[var(--noor-touch-min)] items-center rounded-[var(--play-radius-pill)] bg-card px-4 font-display text-[0.95rem] font-bold text-ink sticker-shadow-sm play-pressable"
);

/* ---------------- filmstrip thumb ---------------- */

function FilmThumb({
  item,
  resolve,
  onFocus,
  arabicUi,
}: {
  item: BoardItem;
  resolve: (it: BoardItem) => ResolvedFigure | "loading" | "missing" | null;
  onFocus: (key: string) => void;
  arabicUi: boolean;
}) {
  const label = arabicUi
    ? item.type === "question"
      ? "سؤال"
      : item.type === "passage"
        ? "النص"
        : "رسمة"
    : item.type === "question"
      ? "Question"
      : item.type === "passage"
        ? "Text"
        : "Figure";
  const fig =
    item.type !== "question" && item.type !== "passage" ? resolve(item) : null;
  const ready = fig !== null && fig !== "loading" && fig !== "missing";
  return (
    <button
      onClick={() => onFocus(item.key)}
      title={label}
      aria-label={label}
      className={cx(
        STROKE_SM,
        "w-16 shrink-0 overflow-hidden rounded-[var(--play-radius-sm)] bg-card sticker-shadow-sm play-pressable"
      )}
    >
      {item.type === "question" ? (
        <span className="flex h-11 items-center justify-center text-[1rem] text-ink">
          ⚡
        </span>
      ) : ready ? (
        <span className="pointer-events-none block h-11 overflow-hidden [&_svg]:h-full [&_svg]:w-full">
          <Visual
            kind={(fig as ResolvedFigure).kind}
            spec={(fig as ResolvedFigure).spec}
            still
            className="border-0 bg-transparent p-0"
          />
        </span>
      ) : (
        <span className="flex h-11 items-center justify-center text-[0.9rem] text-ink-faint">
          ✎
        </span>
      )}
    </button>
  );
}

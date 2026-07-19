"use client";

/**
 * "السبورة" — the persistent lesson whiteboard (Wave B2).
 *
 * The current figure and the current question live HERE, outside the chat
 * scroll container: desktop = the sticky right column of the lesson grid,
 * mobile = a collapsible top sheet (≤40dvh). The transcript keeps small
 * re-pin chips at the original positions (ChatCore interceptWidget).
 *
 * Figures play in controlled steps (VizPlaybackContext mode "step"):
 * auto-advance ~3s per step while the beat is being read, "▸ التالي"
 * tap-advance, step dots, replay. Questions take the board focus and hand
 * it back to the last figure once answered.
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
import { Visual } from "@/components/viz/Visual";
import { VizPlaybackContext } from "@/components/viz/core";
import { vizStepCount } from "@/components/viz/steps";
import { ChatQuestionCard } from "@/components/chat/ChatQuestionCard";

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
  | { key: string; type: "question"; qid: string };

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
  onAttempt,
  debug,
  vizMeta,
  collapsed,
  onToggleCollapsed,
}: {
  items: BoardItem[];
  focusKey: string | null;
  onFocus: (key: string) => void;
  /** bumped on every directive/re-pin — parked figures replay */
  pinNonce: number;
  /** keys restored from a saved session — start on their final frame */
  parked: ReadonlySet<string>;
  lookupQuestion: (qid: string) => SpineQuestion | undefined;
  onAttempt: (r: AttemptResult, q: SpineQuestion) => void;
  debug: boolean;
  /** lesson figure library metadata (captions/pages without a fetch) */
  vizMeta: ReadonlyMap<string, LessonViz>;
  /** mobile top-sheet collapse (ignored on desktop via CSS) */
  collapsed: boolean;
  onToggleCollapsed: () => void;
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
    <section className="ledger-card flex min-h-0 flex-col overflow-hidden">
      {/* header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft bg-accent-wash px-3.5 py-2">
        <span className="flex items-center gap-2">
          <span dir="rtl" className="font-display text-[14px] font-medium text-accent-deep">
            السبورة ✎
          </span>
          {debug && figReady && (fig as ResolvedFigure).refId && (
            <span className="font-mono text-[8.5px] text-ink-faint">
              {(fig as ResolvedFigure).refId}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {page != null && (
            <span dir="rtl" className="font-mono text-[10px] text-ink-soft">
              من الكتاب ص{page}
            </span>
          )}
          <button
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "افتح السبورة" : "اقفل السبورة"}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-card text-[10px] text-ink-soft md:hidden"
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
        {!focused && (
          <p
            dir="rtl"
            className="py-8 text-center text-[13px] leading-relaxed text-ink-faint"
          >
            هنرسم هنا مع بعض ✏️
          </p>
        )}

        {/* crossfade on swap: key remount + fade-in */}
        {focused && (
          <div key={focused.key} className="anim-fade">
            {focused.type === "question" &&
              (focusedQ ? (
                <ChatQuestionCard
                  question={focusedQ}
                  debug={debug}
                  onResult={onAttempt}
                />
              ) : (
                <p className="font-mono text-[10px] text-ink-faint">
                  → {focused.qid}
                </p>
              ))}

            {focused.type !== "question" && fig === "loading" && (
              <div className="flex items-center gap-2 py-8 justify-center">
                <span className="inline-flex gap-[3px]" aria-hidden>
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
                <span dir="rtl" className="text-[11px] text-ink-faint">
                  بجهّز الرسمة…
                </span>
              </div>
            )}
            {focused.type !== "question" && fig === "missing" && (
              <p dir="rtl" className="py-6 text-center text-[12px] text-rust">
                الرسمة دي مش موجودة
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
                    <span className="flex items-center gap-1" aria-label={`خطوة ${step} من ${total}`}>
                      {Array.from({ length: Math.min(total, 12) }, (_, i) => (
                        <button
                          key={i}
                          onClick={() => setStep(fKey, i + 1)}
                          aria-label={`الخطوة ${arDigits(i + 1)}`}
                          className="flex h-4 w-4 items-center justify-center"
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full transition-colors duration-300"
                            style={{
                              backgroundColor:
                                i + 1 <= step
                                  ? "var(--accent)"
                                  : "rgba(32,41,58,0.18)",
                            }}
                          />
                        </button>
                      ))}
                    </span>
                    {step < total ? (
                      <button
                        dir="rtl"
                        onClick={() => setStep(fKey, Math.min(step + 1, total))}
                        className="rounded-full border border-accent/40 bg-card px-3 py-1 text-[11.5px] font-semibold text-accent-deep transition-all duration-150 hover:-translate-y-px hover:border-accent"
                      >
                        ▸ التالي
                      </button>
                    ) : (
                      <button
                        dir="rtl"
                        onClick={() => setStep(fKey, 1)}
                        className="rounded-full border border-line bg-card px-3 py-1 text-[11.5px] font-medium text-ink-soft transition-all duration-150 hover:-translate-y-px hover:border-accent/50 hover:text-accent-deep"
                      >
                        ↺ ارسمها تاني
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
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------- filmstrip thumb ---------------- */

function FilmThumb({
  item,
  resolve,
  onFocus,
}: {
  item: BoardItem;
  resolve: (it: BoardItem) => ResolvedFigure | "loading" | "missing" | null;
  onFocus: (key: string) => void;
}) {
  const label =
    item.type === "question" ? "سؤال" : "رسمة";
  const fig = item.type !== "question" ? resolve(item) : null;
  const ready = fig !== null && fig !== "loading" && fig !== "missing";
  return (
    <button
      onClick={() => onFocus(item.key)}
      title={label}
      aria-label={label}
      className="w-16 shrink-0 overflow-hidden rounded-md border border-line bg-card transition-all duration-150 hover:-translate-y-px hover:border-accent/50"
    >
      {item.type === "question" ? (
        <span className="flex h-11 items-center justify-center text-[15px] text-accent-deep">
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
        <span className="flex h-11 items-center justify-center text-[12px] text-ink-faint">
          ✎
        </span>
      )}
    </button>
  );
}

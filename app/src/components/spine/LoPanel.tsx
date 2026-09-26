"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SpineLo, SpineQuestion, Tier } from "@/lib/types";
import type { VisualRow } from "@/lib/visuals";
import { masteryStage, masteryPhrase } from "@/lib/mastery";
import { MasteryFill } from "@/components/MasteryFill";
import { HONEY_BAND, ICON_BUTTON, STROKE, STROKE_SM, cx } from "@/components/sticker";
import { TeX } from "@/components/TeX";
import { MathText } from "@/components/MathText";
import { plainMath } from "@/lib/math-text";
import { Visual } from "@/components/viz/Visual";
import { learnHrefForLo } from "@/lib/lesson-slug";
import type { AsOf } from "./GraphCanvas";

const TIER_ORDER: Tier[] = ["basic", "standard", "advanced"];

/** Px of the panel that must stay inside the map however far it is dragged. */
const EDGE_KEEP = 140;
/** Px of its top that must stay inside — the handle, so it is always grabbable. */
const HANDLE_KEEP = 56;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * The panel's chips are set in Baloo, not in the shared `.chip`.
 *
 * `.chip` is IBM Plex Mono, which carries no Arabic script and no
 * Arabic-Indic digits: the moment "questions" is translated, a mono chip
 * silently falls through to a system face at the wrong size. That is the
 * design handoff's single most-repeated bug, and these two strings are
 * ordinary translatable copy rather than the Latin-only counters mono is
 * for. Same sticker geometry, a typeface that survives the Arabic build.
 */
const CHIP = cx(
  STROKE_SM,
  "inline-flex items-center rounded-[var(--play-radius-pill)] bg-card px-3 py-1 font-display text-[0.75rem] font-bold leading-none text-ink"
);

/** A pressable row inside the panel: thin stroke, small radius, small
 *  shadow, the press, and the touch floor. */
const ROW = cx(
  STROKE_SM,
  "play-pressable sticker-shadow-sm min-h-[var(--noor-touch-min)] rounded-[var(--play-radius-sm)]"
);

/** Plain words for the three question tiers — the tier key is internal. */
const TIER_LABEL: Record<Tier, string> = {
  basic: "To warm up",
  standard: "The main ones",
  advanced: "If you want a push",
};

/**
 * One topic, opened from the map.
 *
 * Same cuts as the screen around it. What used to lead this panel was
 * "3-1-4 · node lo:u3-1-4"; what used to sit in the middle of it was
 * "Mastery trend · as-of query" over two percentage bars and a "▲ 12 pts
 * since diagnostic" badge. The panel says the same things now in the
 * vocabulary the cards use — a fill and one plain word — and the internal
 * key stays in the DOM as `data-lo-id` for debugging.
 *
 * It floats over the TREE, never over Noor: she is docked at a fixed width
 * and full height, and nothing is allowed to cover her.
 *
 * DRAGGABLE by its header. The panel opens docked to the map's inline end,
 * which is the one place guaranteed to be out of the way of nothing — the
 * topic you just clicked is often underneath it, and so are the
 * prerequisites you opened the panel to go and look at. `offset` lives in
 * the parent rather than here so the position survives clicking through to
 * another topic: move it once, and it stays where you put it for the rest
 * of the session. (The map also scrolls the opened card out from under it —
 * GraphCanvas `keepClear` — so dragging is a convenience, not the only way
 * to see what is underneath.)
 *
 * Dragging is never the ONLY way to move it (WCAG 2.5.7): once moved, a Dock
 * button in the header puts it back with one press or one key.
 *
 * KEYBOARD: opening moves focus to the panel's heading; Escape (or Close)
 * closes it and hands focus back to whatever opened it — the card, or the
 * citation in Noor's answer — falling back to the topic's card on the map.
 *
 * BELOW 1024px (iPad portrait) it is not a floating panel at all: it docks
 * under the map as a full-width sheet, in flow, so it shortens the map
 * rather than covering 70% of it. No drag and no offset there — the offset a
 * wider window left behind is kept, and applies again at 1024 and up.
 */
export function LoPanel({
  frameRef,
  lo,
  allLos,
  questions,
  asOf,
  offset,
  onOffsetChange,
  onClose,
  onSelectLo,
  onOpenQuestion,
}: {
  /** the positioned frame — owned by the parent, which shares it with the
   *  map so the selected card can be scrolled clear of the panel */
  frameRef: React.RefObject<HTMLDivElement | null>;
  lo: SpineLo;
  allLos: SpineLo[];
  questions: SpineQuestion[];
  asOf: AsOf;
  /** how far the student has dragged the panel from its docked position */
  offset: { x: number; y: number };
  onOffsetChange: (next: { x: number; y: number }) => void;
  onClose: () => void;
  onSelectLo: (id: string) => void;
  onOpenQuestion: (q: SpineQuestion) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** The control that opened the panel — focus goes back there on close. */
  const returnTo = useRef<HTMLElement | null>(null);

  // Focus follows the panel open. `preventScroll`: the heading is in the
  // sticky band, and the map has its own opinion about what to scroll.
  // Keyed by topic id in the parent, so this runs on every click-through too.
  useEffect(() => {
    const active = document.activeElement;
    returnTo.current =
      active instanceof HTMLElement &&
      active !== document.body &&
      !frameRef.current?.contains(active)
        ? active
        : null;
    headingRef.current?.focus({ preventScroll: true });
  }, [frameRef]);

  /** Close, handing focus back: to the opener if it is still on the page,
   *  else to this topic's card on the map. */
  const close = () => {
    const frame = frameRef.current;
    let back = returnTo.current?.isConnected ? returnTo.current : null;
    if (!back && frame?.parentElement) {
      back =
        Array.from(
          frame.parentElement.querySelectorAll<HTMLElement>(
            `button[data-lo-id="${CSS.escape(lo.id)}"]`
          )
        ).find((el) => !frame.contains(el)) ?? null;
    }
    back?.focus();
    onClose();
  };

  /** Where the drag started, plus the panel's position at zero offset —
   *  measured once on pointerdown so the clamp never has to reason about a
   *  rect that is moving underneath it. */
  const grab = useRef<{
    px: number;
    py: number;
    baseLeft: number;
    baseTop: number;
    w: number;
    h: number;
    bounds: DOMRect;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Close and Study both live INSIDE the drag handle, so the handle has to
    // stand down for them. `a` as well as `button`: Study is a Link, and a
    // drag that starts on it captures the pointer and swallows the click —
    // the button would look perfectly normal and simply never navigate.
    if ((e.target as HTMLElement).closest("button, a")) return;
    // Docked as a sheet below 1024: nothing to drag.
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    const el = frameRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const r = el.getBoundingClientRect();
    grab.current = {
      px: e.clientX,
      py: e.clientY,
      baseLeft: r.left - offset.x,
      baseTop: r.top - offset.y,
      w: r.width,
      h: r.height,
      bounds: parent.getBoundingClientRect(),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    if (!g) return;
    // Clamp so a strip of the panel and the whole of its handle stay
    // reachable: drag it off the edge and you could never drag it back.
    const left = clamp(
      g.baseLeft + (e.clientX - g.px),
      g.bounds.left - (g.w - EDGE_KEEP),
      g.bounds.right - EDGE_KEEP
    );
    const top = clamp(
      g.baseTop + (e.clientY - g.py),
      g.bounds.top,
      g.bounds.bottom - HANDLE_KEEP
    );
    onOffsetChange({ x: left - g.baseLeft, y: top - g.baseTop });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    grab.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const byId = new Map(allLos.map((l) => [l.id, l]));
  const stageOf = (score: number) => masteryStage(score, score > 0);
  const prereqs = lo.prereqIds
    .map((pid) => byId.get(pid))
    .filter((p): p is SpineLo => Boolean(p));
  const moved = offset.x !== 0 || offset.y !== 0;

  return (
    /* Two elements, and they have to stay two.
       The drag offset is a `transform: translate`, and `.anim-pop` — the
       reveal every panel in this product opens with — is a `transform:
       scale` keyframe with fill-mode `both`. On one element the animation
       wins and keeps winning: it settles on `scale(1)` and holds it
       forever, so the translate silently never applies and the panel cannot
       be moved at all. The positioned wrapper carries the drag; the inner
       card carries the reveal.
       The drag offset rides in two custom properties and is applied only at
       1024 and up; below that the frame is an in-flow sheet under the map. */
    <div
      ref={frameRef}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        // A modal opened from inside the panel — the question pop-up, a
        // figure — owns Escape; it closes first, and the panel stays.
        if (document.querySelector('[aria-modal="true"]')) return;
        e.preventDefault();
        close();
      }}
      className={cx(
        "relative z-10 h-[55%] w-full shrink-0 px-4 pb-4 pt-2",
        "min-[1024px]:absolute min-[1024px]:inset-y-[16px] min-[1024px]:end-[18px] min-[1024px]:h-auto min-[1024px]:w-[360px] min-[1024px]:p-0",
        "min-[1024px]:[transform:translate(var(--lo-dx),var(--lo-dy))]"
      )}
      style={
        {
          "--lo-dx": `${offset.x}px`,
          "--lo-dy": `${offset.y}px`,
        } as React.CSSProperties
      }
    >
      <aside
        data-lo-id={lo.id}
        className={cx(
          STROKE,
          "anim-pop thin-scroll h-full overflow-y-auto rounded-[var(--play-radius)] bg-card sticker-shadow"
        )}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          /* `touch-none` — without it a touch drag scrolls the panel instead
             of moving it, and iPad Safari is a hard device target. Only
             where there is a drag: on the sheet below 1024 it would just
             stop the header scrolling the panel. */
          className={cx(
            HONEY_BAND,
            "sticky top-0 z-10 flex items-center justify-between gap-2.5 px-4 py-2.5",
            "min-[1024px]:cursor-grab min-[1024px]:touch-none min-[1024px]:active:cursor-grabbing"
          )}
        >
          {/* Clamped, so the header is the same height on every topic.
              Unclamped it is not: adding the Study pill took ~140px off the
              title's line width, which pushed longer topics onto a fourth
              and fifth line and made the panel look like it grew when all
              that changed was which topic you clicked. Two lines and the
              full label stays in `title` for the rest. */}
          <h2
            ref={headingRef}
            tabIndex={-1}
            title={plainMath(lo.label)}
            className="line-clamp-2 min-w-0 rounded-[var(--play-radius-sm)] font-display text-[1rem] font-extrabold leading-[1.25] text-ink"
          >
            {/* an objective label may carry maths (backlog #37) */}
            <MathText text={lo.label} />
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            {/* Straight into the lesson for THIS topic — the map's whole job
                is telling you what to work on, and until now the answer was
                "go to Study and find it again yourself".

                Ink, not amber: the design system keeps primary buttons on
                the ink CTA surface and reserves amber for one accent per
                screen, which the composer's send circle already spends. It
                sits in the sticky header so it survives scrolling the panel,
                and inside the drag handle, where `onPointerDown` already
                steps aside for anything that is a control. */}
            <Link
              href={learnHrefForLo(lo.id)}
              className={cx(
                STROKE_SM,
                "play-pressable sticker-shadow-sm flex min-h-[var(--noor-touch-min)] items-center rounded-[var(--play-radius-pill)] bg-accent px-4 font-display text-[0.82rem] font-bold leading-none text-paper"
              )}
            >
              Study
            </Link>
            {/* The keyboard- and tap-operable alternative to dragging (WCAG
                2.5.7): there once the panel has been moved, and only where
                it can be (1024 and up). */}
            {moved && (
              <button
                onClick={() => onOffsetChange({ x: 0, y: 0 })}
                aria-label="Dock the panel"
                title="Dock the panel"
                className={cx(ICON_BUTTON, "max-[1024px]:hidden")}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden
                  className="rtl:-scale-x-100"
                >
                  <path
                    d="M12 2v10M2 7h7M6 4l3 3-3 3"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
            <button onClick={close} aria-label="Close" className={ICON_BUTTON}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M2 2l10 10M12 2L2 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-5 px-5 py-4">
          {lo.description && (
            <p className="font-read text-[0.9rem] leading-[1.75] text-ink-soft">
              <TeX text={lo.description} />
            </p>
          )}

          {/* Where she stands, in the two snapshots the tabs name. No
            percentage, no delta badge, no "as-of" anything. */}
          <div className="space-y-2.5">
            {(
              [
                ["Where you started", lo.baseline, "baseline"],
                ["Today", lo.current, "today"],
              ] as const
            ).map(([label, score, key]) => {
              const stage = stageOf(score);
              return (
                <div key={label} className="flex items-center gap-2.5">
                  <span
                    className={`w-[104px] shrink-0 font-display text-[0.78rem] leading-none ${
                      asOf === key
                        ? "font-extrabold text-ink"
                        : "font-bold text-[color:var(--play-text-muted)]"
                    }`}
                  >
                    {label}
                  </span>
                  <MasteryFill stage={stage} className="w-[76px] shrink-0" />
                  <span className="font-display text-[0.78rem] font-bold leading-none text-[color:var(--play-text-muted)]">
                    {masteryPhrase(stage)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <span className={CHIP}>
              <span dir="ltr">{questions.length}</span>&nbsp;questions
            </span>
            {lo.sourcePage !== null && (
              <span className={CHIP}>
                Book p.<span dir="ltr">{lo.sourcePage}</span>
              </span>
            )}
          </div>

          <VisualsStrip loId={lo.id} />

          {prereqs.length > 0 && (
            <div>
              <p className="mb-2.5 font-display text-[0.78rem] font-extrabold text-ink">
                Worth having first
              </p>
              <div className="space-y-2">
                {prereqs.map((p) => (
                  <button
                    key={p.id}
                    data-lo-id={p.id}
                    onClick={() => onSelectLo(p.id)}
                    className={cx(ROW, "flex w-full items-center gap-2.5 bg-card-warm px-3 py-2 text-start")}
                  >
                    <span className="flex-1 truncate font-display text-[0.82rem] font-bold text-ink">
                      <MathText text={p.label} />
                    </span>
                    {/* The fill's own default height (10) and a 64px width: at
                        height 5 two 2.5px outlines left 0px of fill and the
                        bar drew as a solid ink pill whatever the stage. */}
                    <MasteryFill
                      stage={stageOf(p.current)}
                      className="w-16 shrink-0"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2.5 font-display text-[0.78rem] font-extrabold text-ink">
              Questions
            </p>
            <div className="space-y-3.5">
              {TIER_ORDER.map((tier) => {
                const qs = questions.filter((q) => q.tier === tier);
                if (qs.length === 0) return null;
                return (
                  <div key={tier}>
                    <span className="font-display text-[0.72rem] font-bold text-[color:var(--play-text-muted)]">
                      {TIER_LABEL[tier]}
                    </span>
                    <div className="mt-1.5 space-y-2">
                      {qs.map((q) => (
                        <button
                          key={q.id}
                          data-question-id={q.id}
                          onClick={() => onOpenQuestion(q)}
                          className={cx(ROW, "block w-full bg-card px-3 py-2.5 text-start")}
                        >
                          <p className="font-read text-[0.82rem] leading-[1.6] text-ink">
                            <TeX text={q.stem} />
                          </p>
                          {q.provenance.sourcePage !== null && (
                            <span className="mt-1 block font-display text-[0.7rem] font-bold text-[color:var(--play-text-muted)]">
                              Book p.
                              <span dir="ltr">{q.provenance.sourcePage}</span>
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Visuals strip — figures from the book, attached to this topic       */
/* ------------------------------------------------------------------ */

function VisualsStrip({ loId }: { loId: string }) {
  const [visuals, setVisuals] = useState<VisualRow[]>([]);
  const [open, setOpen] = useState<VisualRow | null>(null);

  useEffect(() => {
    let alive = true;
    setVisuals([]);
    fetch(`/api/visuals?lo=${encodeURIComponent(loId)}`)
      .then((r) => (r.ok ? r.json() : { visuals: [] }))
      .then((j: { visuals?: VisualRow[] }) => {
        if (alive) setVisuals(j.visuals ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [loId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (visuals.length === 0) return null;

  return (
    <div className="anim-fade">
      <p className="mb-2.5 font-display text-[0.78rem] font-extrabold text-ink">
        Figures from the book
      </p>
      <div className="thin-scroll -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2">
        {visuals.map((v) => (
          <button
            key={v.id}
            data-visual-id={v.id}
            onClick={() => setOpen(v)}
            title={v.caption ?? undefined}
            className={cx(ROW, "w-[150px] shrink-0 bg-card p-2 text-start")}
          >
            <Visual kind={v.kind} spec={v.spec} />
            {v.sourcePage !== null && (
              <span className="mt-1 block font-display text-[0.68rem] font-bold text-[color:var(--play-text-muted)]">
                Book p.<span dir="ltr">{v.sourcePage}</span>
              </span>
            )}
          </button>
        ))}
      </div>

      {open &&
        createPortal(
          <div
            className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-6"
            onClick={() => setOpen(null)}
            role="dialog"
            aria-modal="true"
            aria-label={open.caption ?? "Figure from the book"}
          >
            <div
              className={cx(
                STROKE,
                "anim-pop w-full max-w-[520px] overflow-clip rounded-[var(--play-radius)] bg-card sticker-shadow-lg"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={cx(HONEY_BAND, "flex items-center justify-between gap-3 px-5 py-3")}
              >
                <span className="truncate font-display text-[0.85rem] font-extrabold text-ink">
                  <MathText text={open.loLabel} />
                </span>
                <button onClick={() => setOpen(null)} aria-label="Close" className={ICON_BUTTON}>
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M2 2l10 10M12 2L2 12"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
              <div className="px-5 pt-4">
                <Visual kind={open.kind} spec={open.spec} />
              </div>
              <div className="px-5 pb-5 pt-3">
                {open.caption && (
                  <p className="font-read text-[0.88rem] leading-[1.7] text-ink">
                    {open.caption}
                  </p>
                )}
                {open.sourcePage !== null && (
                  <span className={`mt-3 ${CHIP}`}>
                    Book p.<span dir="ltr">{open.sourcePage}</span>
                  </span>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

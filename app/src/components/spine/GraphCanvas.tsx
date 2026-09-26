"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SpineLo } from "@/lib/types";
import { spineSubjectDef } from "@/lib/subjects";
import { masteryStage, masteryPhrase } from "@/lib/mastery";
import {
  FRAME_LABEL_H,
  NODE_H,
  PAD,
  curvePath,
  edgeCurve,
  layoutSpine,
  occludedEdges,
  sectionFrames,
} from "@/lib/spine-layout";

/**
 * A topic's book section on the map (feature 003, FR-4315): the split section
 * it is a part of, as the frame round its cards names it. `label` is
 * "1.7 Factorisation", `part` is "part 2 of 3".
 */
export type MapSection = { key: string; label: string; part: string | null };
import { MasteryFill } from "@/components/MasteryFill";
import { MathText } from "@/components/MathText";
import { plainMath } from "@/lib/math-text";
import { cx } from "@/components/sticker";

export type AsOf = "baseline" | "today";

/* The map's geometry — card size, column placement, edge curves, occlusion —
   is pure and lives in lib/spine-layout.ts (FR-3215, FR-3216), where it is
   unit-tested on the real maths graph. This file renders it. */

/** Unlit card border — never ink, never a shadow. The Play inactive-border
 *  token (3.00:1 on white), not the branch's literal lilac. */
const UNLIT_BORDER = "var(--play-inactive-border)";
/** Edges: one flat line at the thin stroke, no arrowheads and no labels —
 *  the same ink mix main's graph edges use, not a literal lilac. */
const EDGE = "color-mix(in srgb, var(--ink) 30%, transparent)";

/**
 * The card's own wash, one per stage — the SAME five colours the fill uses,
 * laid on at wash strength.
 *
 * The screen you stare at for minutes needs to answer "where am I strong?"
 * from across the room, and a six-pixel bar four segments wide does not.
 * The old Evidence Walk got that part right: it tinted the whole node by
 * mastery. What it got wrong was pairing the tint with a percentage badge,
 * and mixing a CONTINUOUS hue, so two topics in the same band looked
 * different. This is the banded version of the same idea — five discrete
 * washes off `--mastery-0…4`, so the card and its fill can never disagree
 * about which band a topic is in.
 *
 * The percentages are tuned per pigment, not set on a straight line: amber
 * and the tan a step above it are near neighbours by design, so the tan
 * needs roughly twice the strength before the two read apart, while teal is
 * the heaviest of the five and lands in the same lightness family at 22%.
 * Measured, the five come out #FFFFFF · #FDF2E2 · #F3E4CD · #E2EDE1 ·
 * #D1EAE6 — even steps to the eye. All stay above ~80% white, which keeps
 * ink body text over 12:1: the wash is a second carrier for the band,
 * never a contrast risk.
 *
 * This is the one place the build spec's token list is not followed to the
 * letter: it names leaf #EAF7DF "fill for the strongest stage", which was
 * right when stage 4 was the ONLY tinted card. Now that every stage carries
 * a wash, the top of the ramp wears the ramp's own top colour instead of a
 * green borrowed from outside it.
 */
const STAGE_WASH = [
  "var(--card)", // 0 · not started — plain white, the only untinted card
  "color-mix(in srgb, var(--mastery-1) 14%, var(--card))",
  "color-mix(in srgb, var(--mastery-2) 30%, var(--card))",
  "color-mix(in srgb, var(--mastery-3) 26%, var(--card))",
  "color-mix(in srgb, var(--mastery-4) 22%, var(--card))",
] as const;

export function GraphCanvas({
  los,
  edges,
  asOf,
  selectedLoId,
  questionCounts,
  onSelect,
  citedIds,
  pulses,
  coverRef,
  sections,
}: {
  los: SpineLo[];
  edges: { src: string; dst: string }[];
  /**
   * Topic id → its split book section (FR-4315). Omitted when the subject has
   * none — every National subject — and then nothing below differs from the
   * map before 003: same placement, no frames, same card names.
   */
  sections?: ReadonlyMap<string, MapSection>;
  asOf: AsOf;
  selectedLoId: string | null;
  questionCounts: Map<string, number>;
  onSelect: (id: string) => void;
  /** topics Noor referenced in the answer she is writing — a passing ring */
  citedIds?: Set<string>;
  /** id → nonce; bumping the nonce re-fires the ring */
  pulses?: Record<string, number>;
  /** the topic panel's frame, which floats over the map at 1024px and up —
   *  the selected (or keyboard-focused) card is scrolled clear of it */
  coverRef?: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  /**
   * Scroll the map so `card` is inside the part of it nothing covers.
   *
   * At 1024px and up the topic panel floats over the map's inline end, and
   * the card you just opened is very often the one underneath it — as are
   * the prerequisites you opened it to go and find. Below 1024 the panel is
   * docked under the map instead, which covers nothing but shortens the map,
   * so the card can end up below the fold. Both are the same question: where
   * is the visible, uncovered part of the map, and is the card in it?
   *
   * "Where feasible": a card at the far edge of a map that cannot scroll any
   * further stays where it is, and the panel is draggable (and dockable) for
   * exactly that case.
   */
  const keepClear = useCallback(
    (card: HTMLElement, smooth: boolean) => {
      const scroller = ref.current;
      if (!scroller) return;
      const view = scroller.getBoundingClientRect();
      let left = view.left + PAD;
      let right = view.left + scroller.clientWidth - PAD;
      const top = view.top + PAD;
      let bottom = view.top + scroller.clientHeight - PAD;
      const cover = coverRef?.current?.getBoundingClientRect();
      if (
        cover &&
        cover.width > 0 &&
        cover.left < right &&
        cover.right > left &&
        cover.top < bottom &&
        cover.bottom > top
      ) {
        if (cover.height >= (bottom - top) * 0.6) {
          // A side panel: keep whichever side of it is wider.
          if (cover.left - left >= right - cover.right) right = cover.left - PAD;
          else left = cover.right + PAD;
        } else if (cover.top > top) {
          bottom = cover.top - PAD;
        }
      }
      const c = card.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (c.right > right) dx = c.right - right;
      if (c.left - dx < left) dx = c.left - left;
      if (c.bottom > bottom) dy = c.bottom - bottom;
      if (c.top - dy < top) dy = c.top - top;
      if (dx === 0 && dy === 0) return;
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      scroller.scrollBy({
        left: dx,
        top: dy,
        behavior: smooth && !reduce ? "smooth" : "auto",
      });
    },
    [coverRef]
  );

  // On selection, after the panel for it has mounted (same commit).
  useEffect(() => {
    if (selectedLoId === null) return;
    const card = ref.current?.querySelector<HTMLElement>(
      `button[data-lo-id="${CSS.escape(selectedLoId)}"]`
    );
    if (card) keepClear(card, true);
  }, [selectedLoId, keepClear]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const groupOf = useMemo(
    () => (sections ? (id: string) => sections.get(id)?.key ?? null : undefined),
    [sections]
  );
  const { placed, nodeW, canvasW, canvasH, midY } = useMemo(
    () => layoutSpine(los, width, groupOf),
    [los, width, groupOf]
  );
  /* A split section's cards, framed as one group per column run, labelled by
     the section (and the part, when the run is one part). None without a
     split section. */
  const frames = useMemo(
    () => (groupOf ? sectionFrames(placed, nodeW, groupOf) : []),
    [placed, nodeW, groupOf]
  );
  const posById = useMemo(
    () => new Map(placed.map((p) => [p.lo.id, p])),
    [placed]
  );

  /**
   * Where the map opens (FR-3216).
   *
   * Columns are centred on one midline again, so a short first column sits in
   * the middle of a canvas as tall as the tallest one — on maths, six cards
   * against thirteen, ~550px down. Opened at the scroll origin, an iPad pane
   * would show the top of the middle columns and not the topic the map
   * starts with. So the pane opens with the midline in the middle of the
   * view, but never scrolled past the first column's first card: on a short
   * pane that card sits at the top, on a tall one the whole centred map
   * shows. Vertical only; the first column is already at the inline start.
   *
   * Once per set of cards (a subject), not on every layout: a resize or a
   * refreshed snapshot with the same topics must not yank the pane away from
   * wherever the student has scrolled to. A layout effect, so the first paint
   * is already in place.
   *
   * SUPERSEDED — the v0.6.0 note this replaces: "No scroll-into-view on
   * mount: `layout` normalises the graph so its topmost node sits one
   * headroom below the canvas origin, which puts the start of the map at the
   * pane's own scroll origin. That was not true while columns were centred
   * on the tallest one — the first layer landed ~600px into a 2000px canvas
   * and the map opened on blank paper, which is what the scroll-on-mount was
   * there to hide." Centring is back, so the opening position is too.
   */
  const canvasRef = useRef<HTMLDivElement>(null);
  const openedFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const scroller = ref.current;
    const canvas = canvasRef.current;
    const first = placed[0]; // column 0's top card: columns are placed in order
    if (!scroller || !canvas || !first) return;
    const key = `${placed.length}:${first.lo.id}`;
    if (openedFor.current === key) return;
    openedFor.current = key;
    // The canvas's own origin inside the scroller's content (its padding).
    const origin =
      canvas.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    const centred = midY - scroller.clientHeight / 2;
    const firstInView = first.y - PAD;
    scroller.scrollTo({
      top: Math.max(0, origin + Math.min(centred, firstInView)),
      behavior: "auto",
    });
  }, [placed, midY]);

  /* Which edges pass behind a card that is not one of their own endpoints —
     drawn dashed below. Recomputed only when the layout does; the reasoning
     is on `occludedEdges` (lib/spine-layout.ts). */
  const occluded = useMemo(
    () => occludedEdges(edges, placed, nodeW),
    [edges, placed, nodeW]
  );

  const stageOf = (lo: SpineLo) => {
    const score = asOf === "today" ? lo.current : lo.baseline;
    // A topic she has never touched is stage 0 on its own merit, not because
    // the cold-start prior happens to band low — same rule the check-in card
    // and the dashboard apply.
    return masteryStage(score, score > 0);
  };

  return (
    /* `min-h-0 flex-1` only bite below 1024, where the map's container is a
       column with the docked topic sheet under it; at 1024 and up the
       container is a block and `h-full` is what sizes this, as before. */
    <div ref={ref} className="thin-scroll h-full min-h-0 flex-1 overflow-auto p-4">
      <div
        ref={canvasRef}
        className="relative"
        style={{ width: canvasW, height: canvasH }}
      >
        {/* book sections (FR-4315) — a Honey tray behind each run of one
            section's cards, its label in the Honey band's own pairing (amber
            text on Honey). Behind the edges and the cards; decoration for the
            eye only, since every framed card also says its section in its
            accessible name below. */}
        {frames.map((f) => {
          const members = f.loIds.map((id) => sections?.get(id));
          const first = members[0];
          const onePart = members.every((m) => m?.part && m.part === first?.part);
          const label = first ? `${first.label}${onePart && first.part ? ` · ${first.part}` : ""}` : "";
          return (
            <div
              key={`${f.key}|${f.loIds[0]}`}
              aria-hidden
              className="pointer-events-none absolute"
              style={{
                left: f.x,
                top: f.y,
                width: f.width,
                height: f.height,
                zIndex: 0,
                borderRadius: "var(--play-radius)",
                border: "var(--play-stroke-sm) solid var(--play-inactive-border)",
                background: "var(--card-warm)",
              }}
            >
              {/* The display face in sentence case, not the mono eyebrow:
                  "1.7 Factorisation · part 2 of 3" must fit one card's width,
                  and uppercase mono truncated it to "…PART 1…". */}
              <span
                className="block truncate px-2.5 font-display text-[0.74rem] font-bold text-[var(--play-text-amber-warm)]"
                style={{ height: FRAME_LABEL_H, lineHeight: `${FRAME_LABEL_H}px` }}
              >
                {label}
              </span>
            </div>
          );
        })}

        {/* edges — plain lines, no arrowheads, no direction labels */}
        <svg
          className="absolute inset-0"
          width={canvasW}
          height={canvasH}
          fill="none"
          style={{ zIndex: 1 }}
          aria-hidden
        >
          {edges.map((e, i) => {
            const s = posById.get(e.src);
            const t = posById.get(e.dst);
            if (!s || !t) return null;
            const d = curvePath(edgeCurve(s, t, nodeW));
            const touched =
              selectedLoId !== null &&
              (e.src === selectedLoId || e.dst === selectedLoId);
            const dim = selectedLoId !== null && !touched;
            return (
              <path
                key={i}
                d={d}
                strokeLinecap="round"
                /* Dashed = this line runs behind a card on its way across.
                   A solid line that vanishes under one card and reappears
                   from under another reads as two unrelated links; the dash
                   says "same line, it goes behind that". It carries no
                   direction and no meaning about the relationship — the
                   build spec's "no arrowheads, no directional labels" is
                   about semantics, and this is legibility. */
                strokeDasharray={occluded.has(i) ? "9 7" : undefined}
                style={{
                  stroke: touched ? "var(--ink)" : EDGE,
                  strokeWidth: "var(--play-stroke-sm)",
                  opacity: dim ? 0.3 : 1,
                  transition: "opacity 0.35s ease, stroke 0.35s ease",
                }}
              />
            );
          })}
        </svg>

        {/* topic cards */}
        {placed.map(({ lo, x, y }, i) => {
          const stage = stageOf(lo);
          const lit = stage > 0;
          const selected = lo.id === selectedLoId;
          const cited = citedIds?.has(lo.id) ?? false;
          const pulseNonce = pulses?.[lo.id];
          const dim =
            selectedLoId !== null &&
            !selected &&
            !lo.prereqIds.includes(selectedLoId) &&
            !(posById.get(selectedLoId)?.lo.prereqIds ?? []).includes(lo.id);
          const count = questionCounts.get(lo.id) ?? 0;
          // Its book section, said in words too (FR-4315): the frame is
          // aria-hidden, so the grouping reaches a screen reader here.
          const section = sections?.get(lo.id);
          const sectionName = section
            ? `, ${section.label}${section.part ? ` ${section.part}` : ""}`
            : "";
          return (
            <button
              key={lo.id}
              /* The internal id stays in the DOM for debugging and for tests
                 to hang off — never on the face of the card (build spec 02,
                 DO NOT #2). */
              data-lo-id={lo.id}
              onClick={() => onSelect(lo.id)}
              /* Keyboard focus only (`:focus-visible`): a mouse press also
                 focuses the button in Chromium, and scrolling the card out
                 from under the pointer between mousedown and mouseup would
                 eat the click. */
              onFocus={(e) => {
                if (e.currentTarget.matches(":focus-visible"))
                  keepClear(e.currentTarget, false);
              }}
              aria-pressed={selected}
              aria-label={`${plainMath(lo.label)} — ${masteryPhrase(stage)}, ${count} questions${sectionName}`}
              /* `items-stretch` is NOT redundant with the flex default.
                 WebKit's UA stylesheet overrides `align-items` on a <button>,
                 so a button used as a flex container does not stretch its
                 children across the cross axis the way every other element
                 does. On the card that silently collapses the mastery fill —
                 its segments are `flex-1` off a zero basis, so with no
                 stretch they shrink to their 1.5px borders and the bar
                 renders as four dots in the corner. Chromium stretches and
                 looks correct, which is exactly how this shipped: iPad
                 Safari is a hard device target (constitution, devices), and
                 it is the browser that gets it wrong. */
              className={cx(
                "group play-pressable map-card absolute flex flex-col items-stretch gap-2 text-start",
                // Sticker treatment is what "you have started this" looks
                // like: an unlit card is a flat outline with no shadow, and
                // the first lit segment buys the ink edge and the hard
                // offset. Selection lifts the same sticker; it never
                // introduces a second visual language.
                //
                // CLASSES, never an inline `box-shadow` (main's 114214e): an
                // inline shadow outranks both the amber `:focus-visible` ring
                // and `.play-pressable:active`, so a keyboard-focused card
                // showed no focus and a pressed one never collapsed. The
                // transition lives on `.map-card` (globals.css, PLAY FIXES)
                // for the same reason — inline, it replaced the press's own
                // timing and ignored reduced motion.
                selected
                  ? "sticker-shadow"
                  : lit || cited
                    ? "sticker-shadow-sm"
                    : undefined
              )}
              style={{
                left: x,
                top: y,
                width: nodeW,
                height: NODE_H,
                padding: "12px 14px",
                // a small card, so the card radius — not the chip's 14
                borderRadius: "var(--play-radius)",
                border: `var(--play-stroke-sm) solid ${
                  lit || selected || cited ? "var(--ink)" : UNLIT_BORDER
                }`,
                background: STAGE_WASH[stage],
                opacity: dim && !cited ? 0.45 : 1,
                zIndex: selected ? 4 : 2,
                // `backwards`, not `both`: a finished animation that FILLS
                // keeps its last keyframe, and animated values outrank every
                // normal declaration — so `both` pinned `transform` (the
                // press never moved the card) and `opacity: 1` (the dim above
                // never applied). `backwards` still holds the 0% frame
                // through each card's stagger delay, then lets go.
                animation: `pop-in 0.4s cubic-bezier(0.22,1,0.36,1) ${Math.min(i, 24) * 30}ms backwards`,
              }}
            >
              {pulseNonce !== undefined && (
                <span key={pulseNonce} className="anim-cite-ring" aria-hidden />
              )}
              {/* The clamp lives on a CHILD, never on the flex item itself:
                  a flex item blockifies `display:-webkit-box` to `flow-root`
                  and the line clamp silently stops applying — the title then
                  gets cut by the card's overflow at whatever height the flex
                  line leaves it, mid-line and with no ellipsis. */}
              <span className="min-h-0 flex-1 overflow-hidden">
                <span
                  className="line-clamp-3 font-display text-[0.92rem] font-bold leading-[1.3] text-ink"
                  dir={
                    spineSubjectDef(lo.subject)?.dir === "rtl"
                      ? "rtl"
                      : undefined
                  }
                >
                  {/* An objective label may carry maths (backlog #37). The
                      card's height is fixed and its title clamps at three
                      lines, so a formula is set a size down: at full size a
                      superscript's taller line box pushed a three-line
                      label's last line under the card's edge. Important
                      (`!`): `globals.css` sizes `.katex` in an unlayered
                      rule, which outranks any layered utility. */}
                  <MathText text={lo.label} className="[&_.katex]:text-[0.9em]!" />
                </span>
              </span>
              {/* Belt and braces with the `items-stretch` above: an explicit
                  width means the bar is correct even if something later
                  re-centres or re-starts this card's cross axis. */}
              <MasteryFill stage={stage} className="w-full" />
              {/* The band word first (FR-1003: a named band beside the fill,
                  never colour alone), then the count. The numeral sits in its
                  own span so an Arabic build can wrap it dir="ltr" without
                  touching the sentence around it. `--play-text-muted`, not
                  ink-soft: at 0.76rem ink-soft fell under AA on two of the
                  stage washes. `truncate` clips, so the leading is the
                  reading face's own rather than `leading-none`, which would
                  shave the descenders off "questions". */}
              <span className="truncate font-read text-[0.76rem] leading-[1.3] text-[color:var(--play-text-muted)]">
                {masteryPhrase(stage)} · <span dir="ltr">{count}</span> questions
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

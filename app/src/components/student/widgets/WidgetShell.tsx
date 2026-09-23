"use client";

/**
 * The frame every interactive widget is served in.
 *
 * PairPlotter and ProductBuilder each carried their own copy of this chrome,
 * and the copies had already drifted — different hint wording, different
 * feedback border weights. With nine more widgets arriving, a tenth copy is
 * how a design system dies, so the header, the prompt, the feedback panel and
 * the reset affordance live here once.
 *
 * Two rules the shell enforces rather than suggests:
 *
 *   · WRONG IS NEVER RED. The palette has no red in it by decision — a wrong
 *     answer greys out and nudges (Noor Play, "Answer options"), because the
 *     student is fourteen and mid-lesson (constitution, no-red rule).
 *   · Colour is never the only signal. Every verdict carries its own word, so
 *     the state survives a colourblind reader and a greyscale print alike.
 *
 * The anatomy below is exported because ten widgets draw their own frame
 * (the Arabic and social-studies ones, which need `dir="rtl"` and their own
 * header copy, and the two oldest math widgets). They wear these same class
 * strings rather than ten hand-written copies of the chrome, which had
 * drifted into viridian, gold and red shadows (review 2026-09-23, F18).
 * Every value is a Noor Play token via `@/components/sticker`; nothing here
 * names a colour.
 */

import type { ReactNode } from "react";
import {
  BUTTON_SECONDARY,
  HONEY_BAND,
  STICKER_PANEL,
  STROKE,
  STROKE_SM,
  VERDICT_INK,
  cx as join,
} from "@/components/sticker";

export type Verdict = "correct" | "partial" | "wrong" | null;

/* ------------------------------------------------------ the frame ------- */

/** The widget frame: one Play sticker panel, the same on every widget. */
export const WIDGET_FRAME = join(STICKER_PANEL, "anim-pop my-2 overflow-hidden");

/** The header strip across the top of the frame — the Honey band. */
export const WIDGET_HEAD = join(
  HONEY_BAND,
  "flex flex-wrap items-center justify-between gap-2 px-3.5 py-2"
);

/** The header's kind eyebrow, Latin copy: Plex Mono, amber-family on Honey. */
export const WIDGET_KIND =
  "font-mono text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[color:var(--play-text-amber-warm)]";

/** The same eyebrow carrying Arabic. Plex Mono has no Arabic glyphs and
 *  letter-spacing breaks the cursive join, so it moves to the UI face and
 *  `.ar-label` resets tracking and case (handoff TYPE). */
export const WIDGET_KIND_AR =
  "ar-label font-display text-[0.72rem] font-bold text-[color:var(--play-text-amber-warm)]";

/** The header's gesture hint (ink, from the Honey band). */
export const WIDGET_HINT = "font-mono text-[0.72rem] font-medium";
export const WIDGET_HINT_AR = "ar-label font-display text-[0.72rem] font-bold";

/** The prompt line under the header. */
export const WIDGET_PROMPT = "text-[13px] font-bold leading-relaxed text-ink";

/** A sunken well inside the frame — the figure, the passage, the strip being
 *  built. Cream on the white panel, the thin outline, no shadow: it holds
 *  content, it is not itself a control. */
export const WIDGET_WELL = join(STROKE_SM, "rounded-[var(--play-radius-sm)] bg-paper");

/* ---------------------------------------------------- the options ------- */

/**
 * A tappable option — a card, a chip, a hamza seat — at the answer-option
 * anatomy: the thin stroke, the 14px radius, a 52px target, Baloo 700.
 *
 * The stroke WIDTH only: each state below sets its own border colour, and a
 * state may want a dashed edge, so the solid style that `STROKE_WIDTH_SM`
 * carries would fight it (Preflight already makes every border solid).
 */
export const WIDGET_OPTION =
  "border-[length:var(--play-stroke-sm)] min-h-[var(--noor-touch-min)] rounded-[var(--play-radius-sm)] font-bold";

/**
 * Option inks. Animations are left to the caller: `anim-pop` belongs on the
 * option the student just got right and `anim-nudge` on the one they just got
 * wrong — not on a state revealed all at once by a Check button, where the
 * result strip is the one thing that moves. Never pair `anim-pop` with
 * `play-pressable`: the pop fills `both` and would pin the press's transform.
 *
 * A verdict option is usually also `disabled`. Give it `data-verdict` so the
 * stylesheet can keep its inks instead of the generic disabled grey.
 */
export const OPTION_INK = {
  /** live, untouched */
  idle: "border-ink bg-card text-ink sticker-shadow-sm play-pressable",
  /** picked but not yet graded — Honey, keeps its stroke and shadow */
  selected: "border-ink bg-card-warm text-ink sticker-shadow-sm play-pressable",
  /** right — the leaf playmate */
  correct: join(VERDICT_INK.correct, "sticker-shadow-sm"),
  /** wrong — grey fill, inactive border, still AA text, no shadow */
  wrong: VERDICT_INK.wrong,
  /** settled: the item closed on another option */
  rest: "border-ink bg-card text-ink",
} as const;

/**
 * The ink for one option in a pick-until-right row (a hamza seat, a موقع, a
 * أسلوب): the right one pops leaf, a wrong one greys and nudges, and once the
 * row has closed on another option the rest settle.
 */
export function pickInk(isRight: boolean, isWrong: boolean, settled: boolean): string {
  if (isRight) return join(OPTION_INK.correct, "anim-pop");
  if (isWrong) return join(OPTION_INK.wrong, "anim-nudge");
  return settled ? OPTION_INK.rest : OPTION_INK.idle;
}

/** A place being filled in order (a chain link, a timeline slot): dashed
 *  "not yet" while empty, leaf once the right card lands in it. */
export const WIDGET_SLOT =
  "rounded-[var(--play-radius-sm)] border-[length:var(--play-stroke-sm)]";
export const SLOT_INK = {
  empty:
    "border-dashed border-[color:var(--play-disabled-border)] text-[color:var(--play-text-muted)]",
  filled: join(OPTION_INK.correct, "anim-pop font-bold"),
} as const;

/* ---------------------------------------------------- the controls ------ */

/**
 * The row under a figure that holds the widget's own buttons. The commit
 * button in it is `BUTTON_SECONDARY` and a clear/undo is `BUTTON_TERTIARY`:
 * the lesson screen already carries its ONE amber primary outside the widget.
 */
export const WIDGET_ACTIONS = "mt-2.5 flex flex-wrap items-center justify-center gap-2";

/** A typed value (a bar height, a ratio): the chip/input radius, a 52px
 *  target, the full stroke because it is taller than 40px. */
export const WIDGET_INPUT = join(
  STROKE,
  "h-[var(--noor-touch-min)] min-w-[var(--noor-touch-min)] rounded-[var(--play-radius-sm)] bg-card text-center font-mono text-[1rem] font-medium text-ink"
);

/* ----------------------------------------------------- the results ------ */

const STRIP = "border-[length:var(--play-stroke-sm)] rounded-[var(--play-radius-sm)]";

/** The strip that closes an item: correct pops, close pops, wrong nudges. */
export const WIDGET_RESULT: Record<Exclude<Verdict, null>, string> = {
  correct: join(STRIP, VERDICT_INK.correct, "sticker-shadow-sm anim-pop"),
  partial: join(STRIP, VERDICT_INK.partial, "sticker-shadow-sm anim-pop"),
  wrong: join(STRIP, VERDICT_INK.wrong, "anim-nudge"),
};

/** A coaching line mid-item (a hint, a computed diagnosis): the Honey band. */
export const WIDGET_NOTE = join(STRIP, "border-ink bg-card-warm text-ink");

/** A quoted rule under a result: an amber-family bar on the inline-start edge. */
export const WIDGET_RULE_QUOTE =
  "border-s-[length:var(--play-stroke-sm)] border-[color:var(--gold)] ps-1.5";

/**
 * Marks drawn INSIDE a figure (SVG fills and strokes), where the leaf fill is
 * too pale to read as a thin line on Cream: the correct target is mastery
 * teal, a wrong pick is the inactive grey. Never red.
 */
export const FIGURE_MARK = {
  correct: "var(--noor-progress)",
  wrong: "var(--play-inactive-border)",
  wrongText: "var(--play-text-muted)",
} as const;

/* ------------------------------------------------------- the shell ------ */

const VERDICT_TEXT: Record<Exclude<Verdict, null>, string> = {
  correct: "Correct",
  partial: "Close",
  wrong: "Not yet",
};

export function WidgetShell({
  kind,
  hint,
  prompt,
  verdict = null,
  feedback,
  onReset,
  resetLabel = "Try again",
  children,
  footer,
}: {
  /** Shown in the header strip — the student's name for this tool. */
  kind: string;
  /** The gesture, in three or four words ("drag the handles"). */
  hint: string;
  prompt: string;
  verdict?: Verdict;
  /** One line of teaching after the verdict — what the answer MEANS. */
  feedback?: ReactNode;
  /** Omit to make the widget one-shot. */
  onReset?: () => void;
  resetLabel?: string;
  children: ReactNode;
  /** Live readout under the figure (slope, angle, mean) while working. */
  footer?: ReactNode;
}) {
  return (
    <div className={WIDGET_FRAME}>
      <div className={WIDGET_HEAD}>
        <span className={WIDGET_KIND}>✳ interactive · {kind}</span>
        <span className={WIDGET_HINT}>{hint}</span>
      </div>

      <div className="px-3.5 py-3">
        {/* Empty when the host has already shown the question — an empty
            paragraph would leave a phantom gap above the figure. */}
        {prompt && <p className={WIDGET_PROMPT}>{prompt}</p>}

        <div className="mt-2.5">{children}</div>

        {footer && (
          <div className="mt-2 text-center font-mono text-[10.5px] font-medium text-[color:var(--play-text-muted)]">
            {footer}
          </div>
        )}

        {verdict && (
          <div className={join("mt-2.5 px-3 py-2", WIDGET_RESULT[verdict])}>
            <span className="font-display text-[13.5px] font-bold">
              {VERDICT_TEXT[verdict]}
            </span>
            {/* inherits the verdict's paired foreground — never a grey picked
                by eye on a coloured fill */}
            {feedback && <span className="ms-2 text-[12.5px]">{feedback}</span>}
          </div>
        )}

        {onReset && verdict && (
          <button type="button" onClick={onReset} className={join(BUTTON_SECONDARY, "mt-2.5")}>
            {resetLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A draggable handle.
 *
 * It is a real tab stop with an `aria-label` that says where it currently is,
 * because a handle a screen reader announces as "group" is a handle nobody can
 * use. The hit target is a transparent circle roughly twice the painted
 * radius: a 4px dot is correct to look at and impossible to catch with a
 * fingertip, and the device target is an iPad.
 */
export function Handle({
  cx,
  cy,
  r = 5,
  color = "var(--accent)",
  label,
  live,
  onKeyDown,
  dragging,
  locked,
}: {
  cx: number;
  cy: number;
  r?: number;
  color?: string;
  label: string;
  /** Announced position, e.g. "3, 2". */
  live?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  dragging?: boolean;
  locked?: boolean;
}) {
  return (
    <g
      tabIndex={locked ? -1 : 0}
      role="slider"
      aria-label={live ? `${label}: ${live}` : label}
      aria-valuetext={live}
      onKeyDown={onKeyDown}
      className="group cursor-grab focus-visible:outline-none"
      style={{ touchAction: "none" }}
    >
      {/* finger-sized target, invisible */}
      <circle cx={cx} cy={cy} r={Math.max(r * 2.2, 13)} fill="transparent" />
      {/* focus ring — drawn, not outlined, so it follows the circle */}
      <circle
        cx={cx}
        cy={cy}
        r={r + 4}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        opacity={dragging ? 0.45 : 0}
        className="transition-opacity"
      />
      <circle
        cx={cx}
        cy={cy}
        r={r + 3.5}
        fill="none"
        stroke="var(--gold)"
        strokeWidth="2"
        className="opacity-0 transition-opacity group-focus-visible:opacity-100"
      />
      <circle cx={cx} cy={cy} r={r} fill={color} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--card)" strokeWidth="1.2" />
    </g>
  );
}

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
 *     answer is a gold "not yet", not an alarm, because the student is
 *     fourteen and mid-lesson (constitution, no-red rule).
 *   · Colour is never the only signal. Every verdict carries its own word, so
 *     the state survives a colourblind reader and a greyscale print alike.
 */

import type { ReactNode } from "react";

export type Verdict = "correct" | "partial" | "wrong" | null;

const VERDICT_TEXT: Record<Exclude<Verdict, null>, string> = {
  correct: "Correct",
  partial: "Close",
  wrong: "Not yet",
};

const VERDICT_SKIN: Record<Exclude<Verdict, null>, string> = {
  correct: "border-accent/45 bg-accent-wash text-accent-deep",
  partial: "border-gold/45 bg-gold-wash text-gold",
  // Deliberately the SAME gold family as "close", one notch firmer. There is
  // no rust/red state here: a wrong answer is a teaching moment, not a fault.
  wrong: "border-gold/50 bg-gold-wash text-gold",
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
    <div className="anim-pop my-2 overflow-hidden rounded-lg border border-accent/40 bg-card shadow-[0_10px_24px_-16px_rgba(13,74,66,0.5)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-accent-wash px-3.5 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-accent-deep">
          ✳ interactive · {kind}
        </span>
        <span className="font-mono text-[9px] text-ink-faint">{hint}</span>
      </div>

      <div className="px-3.5 py-3">
        <p className="text-[13px] font-medium leading-relaxed text-ink">{prompt}</p>

        <div className="mt-2.5">{children}</div>

        {footer && (
          <div className="mt-2 text-center font-mono text-[10.5px] text-ink-soft">
            {footer}
          </div>
        )}

        {verdict && (
          <div className={`anim-pop mt-2.5 rounded-md border px-3 py-2 ${VERDICT_SKIN[verdict]}`}>
            <span className="font-display text-[13.5px] font-medium">
              {VERDICT_TEXT[verdict]}
            </span>
            {feedback && (
              <span className="ml-2 text-[12.5px] text-ink-soft">{feedback}</span>
            )}
          </div>
        )}

        {onReset && verdict && (
          <button
            type="button"
            onClick={onReset}
            className="mt-2 min-h-[36px] rounded-md border border-line px-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:border-accent/50 hover:text-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45"
          >
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

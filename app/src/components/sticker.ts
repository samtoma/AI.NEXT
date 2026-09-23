/**
 * Noor Play anatomy as class strings — the sticker, written once.
 *
 * The handoff's one structural idea is that every surface is a paper cut-out:
 * a 3px ink outline, a hard offset shadow with no blur, radii of 14/20/28/999,
 * and a 90ms press that moves the control into its own shadow
 * (docs/design/handoffs/noor-play/CLAUDE.md). Before this module each screen
 * spelled that out by hand — `border-[3px]`, `rounded-[20px]`, `rounded-[22px]`
 * on the card beside it, a viridian soft shadow on the one after — and the
 * copies had drifted into three border weights on one button row (review
 * 2026-09-23, F14/F15/F17/F18).
 *
 * EVERY VALUE HERE IS A TOKEN (constitution XII). Strokes, radii and the touch
 * floor are `var(--play-*)`/`var(--noor-*)` arbitrary values; the shadows are
 * the `sticker-shadow*` classes from `globals.css`, which are unlayered and so
 * also win over any `shadow-*` utility a caller might still carry; the press
 * is `.play-pressable`. Colour pairs always travel together — a coloured
 * background is never written without its paired `on-` foreground.
 *
 * These are plain strings rather than components so a `Link`, a `button`, a
 * `summary` and a `span` can all wear the same anatomy. Tailwind scans this
 * file, so every class below is generated.
 */

/** Join class fragments, dropping the empty ones. */
export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/* ------------------------------------------------------------ strokes --- */

/** The outline's width alone, for a caller that sets its own border colour
 *  (a verdict state). Never pair these with `STROKE`/`STROKE_SM`: two border
 *  colour utilities on one element resolve by stylesheet order, not by the
 *  order they are written in. */
export const STROKE_WIDTH = "border-[length:var(--play-stroke)] border-solid";
export const STROKE_WIDTH_SM = "border-[length:var(--play-stroke-sm)] border-solid";

/** The sticker outline — 3px ink. */
export const STROKE = `${STROKE_WIDTH} border-ink`;
/** The outline on anything under 40px tall — 2.5px ink. */
export const STROKE_SM = `${STROKE_WIDTH_SM} border-ink`;

/* ------------------------------------------------------------ surfaces -- */

/** A big card or sheet: white, 3px ink, 28px radius, 4px hard shadow. NOT a
 *  control — it carries no press. */
export const STICKER_CARD = cx(
  STROKE,
  "rounded-[var(--play-radius-lg)] bg-card text-ink sticker-shadow"
);

/** A small card or panel inside a page: 20px radius. */
export const STICKER_PANEL = cx(
  STROKE,
  "rounded-[var(--play-radius)] bg-card text-ink sticker-shadow"
);

/** The Honey band across the top of a card (headers, the friendly strip).
 *  Divides from the body with the ink outline, on the block-end edge only. */
export const HONEY_BAND =
  "bg-card-warm text-ink border-b-[length:var(--play-stroke)] border-solid border-ink";

/* ------------------------------------------------------------- buttons -- */

const BUTTON_BASE = cx(
  STROKE,
  "inline-flex items-center justify-center gap-2",
  "rounded-[var(--play-radius)] px-6 text-center font-display font-bold",
  "sticker-shadow play-pressable"
);

/** Primary: amber, ink text, 1.15rem, 56px tall. **ONE per screen**, always. */
export const BUTTON_PRIMARY = cx(
  BUTTON_BASE,
  "min-h-[56px] bg-[var(--noor-action)] text-[color:var(--noor-on-action)] text-[1.15rem]"
);

/** Secondary: white, ink text, 1.05rem, 52px, same stroke and shadow. */
export const BUTTON_SECONDARY = cx(
  BUTTON_BASE,
  "min-h-[var(--noor-touch-min)] bg-card text-ink text-[1.05rem]"
);

/**
 * A button-SHAPED label inside a card that is itself the link — "Start ←" at
 * the foot of a door card. It is not a second control (a link inside a link
 * is invalid, and two presses on one target is a lie), so it carries the
 * thin outline but no shadow and no press; the card around it presses. Add
 * the fill + paired foreground at the call site.
 */
export const BUTTON_LABEL = cx(
  STROKE_SM,
  "inline-flex min-h-[var(--noor-touch-min)] items-center gap-1.5 rounded-[var(--play-radius)] px-4 font-display text-[1.05rem] font-bold"
);

/** Tertiary: no border, no shadow, link-blue text, still a 52px target. */
export const BUTTON_TERTIARY =
  "inline-flex min-h-[var(--noor-touch-min)] items-center px-2 font-display text-[0.95rem] font-bold text-[color:var(--play-text-link)] underline decoration-dotted underline-offset-4";

/**
 * A round icon control (close, collapse). A real control, so it is a sticker
 * that presses, and it holds the 52px target on desktop too — the handoff is
 * explicit that a cursor is not a reason to shrink one.
 */
export const ICON_BUTTON = cx(
  STROKE,
  "inline-flex size-[var(--noor-touch-min)] shrink-0 items-center justify-center",
  "rounded-[var(--play-radius-pill)] bg-card text-ink sticker-shadow-sm play-pressable"
);

/* --------------------------------------------------------------- badges -- */

/** A label pill (verdicts, tags). Under 40px tall, so the thin stroke. */
export const BADGE = cx(
  STROKE_SM,
  "inline-flex items-center gap-1.5 rounded-[var(--play-radius-pill)] px-3 py-0.5",
  "font-display text-[0.85rem] font-bold leading-snug sticker-shadow-sm"
);

/**
 * A mastery-ramp swatch for a legend. Outlined because step 0 (not started)
 * is the near-white inactive fill and would vanish on a white card without
 * one. The fill goes on `style` from `MASTERY_LEGEND[n].color`.
 */
export const MASTERY_SWATCH = cx(
  STROKE_SM,
  "inline-block h-3.5 w-6 shrink-0 rounded-[var(--play-radius-pill)]"
);

/* ------------------------------------------------------ verdict inks ---- */

/**
 * The three verdict states, as fill + paired foreground + border colour — use
 * with `STROKE_WIDTH`/`STROKE_WIDTH_SM`, not `STROKE`. **There is no red.**
 * Correct is the leaf playmate (handoff: "Correct = leaf green"); close is the
 * Honey band with amber-family text; wrong greys out with the inactive border
 * and stays AA-legible, because a wrong option is still a live control.
 */
export const VERDICT_INK = {
  correct: "bg-[var(--play-leaf)] text-[color:var(--play-on-leaf)] border-ink",
  partial: "bg-card-warm text-[color:var(--play-text-amber-warm)] border-ink",
  wrong:
    "bg-[var(--play-inactive-fill)] text-[color:var(--play-text-muted)] border-[color:var(--play-inactive-border)]",
} as const;

/**
 * Question difficulty tiers — fill, paired foreground and border colour; use
 * with `STROKE_WIDTH_SM`. No red and no playmate (playmates code subjects and
 * quests only), so the tiers climb in weight instead: white, Honey, ink.
 */
export const TIER_INK = {
  basic: "bg-card text-ink border-ink",
  standard: "bg-card-warm text-[color:var(--play-text-amber-warm)] border-ink",
  advanced: "bg-ink text-paper border-ink",
} as const;

/* ------------------------------------------------------------ headings -- */

/**
 * Display type under Play is Baloo, which is tall: the 1.04–1.25 leading the
 * Fraunces headings were written with makes two-line Baloo headings collide
 * (F28). Headings take 800 and a 1.2 leading; UI labels take 700.
 */
export const HEADING = "font-display font-extrabold leading-[1.2] text-ink";

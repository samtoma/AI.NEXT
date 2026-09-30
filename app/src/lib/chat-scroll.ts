/**
 * Where the lesson transcript scrolls when a new message lands (FR-3222).
 *
 * The transcript used to follow the bottom unconditionally: every message and
 * every reveal tick set `scrollTop = scrollHeight`. That is right for text,
 * which reads top to bottom as it arrives, and wrong for a tall interactive
 * block — a widget, a question card, a sealed passage. The tutor's prompt makes
 * that block the last beat of its message, so it arrives after the explanation
 * and pushes the whole message up: the block's own header and question line
 * end up above the fold, and the student has to scroll UP to find what they are
 * being asked. Scrolling up to find the question is the thing this removes.
 *
 * The rule is one comparison, made on the newest message's FRAME — the whole
 * tutor bubble, explanation included — when that message holds an interactive
 * block. Aligning the block alone would leave the explanation above it cut
 * off, and that is the text the student needs first. Pinned to the
 * bottom, the visible window starts at `max = scrollHeight - clientHeight`. If
 * the frame's top is at or below that, the whole message is on screen when we
 * pin to the bottom, so do exactly what we always did. If it is above, pinning
 * would cut its top off, so show it from its top instead — the student reads
 * the explanation, then scrolls DOWN to the widget, which is the direction a
 * page already reads.
 *
 * Pure and DOM-free so the two branches and the clamps are testable without a
 * browser; the caller supplies the four numbers.
 */

/** Marks a block a student has to act on. Set by `ChatCore` on the widget,
 *  question and sealed-passage slots; read here and by nothing else. */
export const CHAT_INTERACTIVE_ATTR = "data-chat-interactive";

/** Air kept above an aligned frame so its top border and shadow are not clipped. */
export const BLOCK_TOP_MARGIN = 12;

export function scrollTopFor(v: {
  scrollHeight: number;
  clientHeight: number;
  /** The newest message's frame top, in the scroll container's own coordinates
   *  (what `scrollTop` is measured in), or null when that message holds no
   *  interactive block — then it simply follows the bottom. */
  frameTop: number | null;
  topMargin?: number;
}): number {
  const max = Math.max(0, v.scrollHeight - v.clientHeight);
  if (v.frameTop === null) return max;
  if (v.frameTop >= max) return max;
  const margin = v.topMargin ?? BLOCK_TOP_MARGIN;
  return Math.min(max, Math.max(0, v.frameTop - margin));
}

/** Anything with a layout offset and an offset parent — an `HTMLElement`, or a
 *  plain object in a test. */
export interface OffsetNode {
  offsetTop: number;
  offsetParent: unknown;
}

/**
 * A node's top edge in the scroll container's coordinates, by summing layout
 * offsets up the `offsetParent` chain.
 *
 * NOT `getBoundingClientRect()`: every bubble and widget arrives with `.anim-pop`,
 * which is `transform: scale(0.7 → 1.14 → 1)` over ~380ms, and a bounding rect
 * measured mid-animation is that scaled box. `offsetTop` is layout and ignores
 * transforms. The container must be positioned (`relative`) so the chain ends at it.
 */
export function offsetTopWithin(container: unknown, node: OffsetNode): number {
  let y = 0;
  let n: OffsetNode | null = node;
  while (n && n !== container) {
    y += n.offsetTop;
    n = n.offsetParent as OffsetNode | null;
  }
  return y;
}

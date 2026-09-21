/**
 * A bounded region that scrolls its own rows under a header that stays put.
 *
 * **Why a cap and not a height.** A console list can hold one row or forty —
 * an operator with one sign-in and one with forty both use `/profile`. A
 * fixed `height` renders the first operator's list as a tall box with one
 * row floating in a lot of empty card, which reads as broken. `max-height`
 * with no `height` lets the box be exactly as tall as its content up to the
 * cap, so three rows render as three rows and only a longer list scrolls.
 *
 * **Why the cap is `vh`-based with a floor, not a pixel count.** A pixel cap
 * chosen for a laptop screen either wastes most of a large monitor or, read
 * the other way, swallows half a short laptop viewport. `clamp()` keeps the
 * box a fraction of whatever viewport it is in, the floor keeps a short
 * viewport from squeezing it down to one visible row, and the ceiling keeps
 * a tall monitor from turning the list into the whole page. None of the
 * three numbers is a colour, stroke, radius or shadow, so constitution XII's
 * tokens-only rule does not reach them — this is layout, not skin.
 *
 * **Why the header is sticky rather than repeated or omitted.** `position:
 * sticky` needs no scroll listener and no measurement; it degrades to a
 * normal in-flow element if JavaScript never runs. The header has to live
 * *inside* the scrolling element for `sticky` to pin against that element's
 * own scrollport rather than the page's — that is also why this component
 * owns both the header and the rows instead of leaving the header to a
 * sibling.
 *
 * **Why `tabIndex={0}` and `role="region"`.** A `div` with `overflow-y: auto`
 * is not reachable by keyboard on its own — a mouse-only user can scroll it
 * and a keyboard-only user cannot, which is exactly the gap this exists to
 * close. `tabIndex={0}` puts it in the tab order so arrow keys and Page
 * Down work once it is focused; `role="region"` plus `aria-label` gives that
 * stop a name, since the box has no visible heading of its own once the
 * caller's own section heading has scrolled out of the viewport above it.
 *
 * **One scroll container, never nested.** A scroll region inside a scroll
 * region fights the reader over which one responds to the wheel or the
 * arrow keys. This component is the only element here that sets
 * `overflow-y`; a caller that wraps another scrolling element in this one is
 * using it wrong.
 */

"use client";

import type { ReactNode } from "react";

export function ScrollList({
  header,
  ariaLabel,
  children,
}: {
  /** Pinned to the top of the scroll region while rows pass under it. */
  header: ReactNode;
  /** Read by assistive tech on focus, since the region has no on-screen heading of its own. */
  ariaLabel: string;
  /** The rows. This element is the only thing that scrolls — do not put another scroll container in here. */
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
      className="thin-scroll max-h-[clamp(14rem,40vh,28rem)] overflow-y-auto rounded-lg border border-line bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/45"
    >
      <div className="sticky top-0 z-10 border-b border-line bg-card">{header}</div>
      {children}
    </div>
  );
}

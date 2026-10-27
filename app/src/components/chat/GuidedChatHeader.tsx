import type { ReactNode } from "react";

import { NoorMark } from "@/components/NoorMark";
import { HONEY_BAND, STROKE, cx } from "@/components/sticker";

/**
 * The chat panel's header band on both guided pages — Ask Noor (homework) and the guided lesson
 * (design_handoff_guided_pages §2): Honey, the ink rule under it, Nour's 44px badge, "Ask Noor"
 * and one sub line naming what the chat is about.
 *
 * The badge bobs at rest — the one loop the system allows — and wiggles INSTEAD while a reply is
 * pending (§7), so the header says "she's on it" even when the thinking bubble is scrolled away.
 */
export function GuidedChatHeader({
  sub,
  thinking,
  rtl = false,
  trailing,
}: {
  sub: ReactNode;
  thinking: boolean;
  rtl?: boolean;
  /** the founders' receipts (debug spend), at the band's end */
  trailing?: ReactNode;
}) {
  return (
    <div className={cx(HONEY_BAND, "flex shrink-0 items-center gap-3 px-5 py-3")}>
      <span
        aria-hidden
        className={cx(
          STROKE,
          "flex size-11 shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] bg-card",
          thinking ? "guided-wiggle" : "anim-bob"
        )}
      >
        <NoorMark className="size-7" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5" dir={rtl ? "rtl" : undefined}>
        <span className="font-display text-[1.25rem] font-extrabold leading-[1.1] text-ink">
          {rtl ? "اسأل نور" : "Ask Noor"}
        </span>
        <span className="truncate font-display text-[0.85rem] font-bold leading-[1.2] text-[color:var(--play-text-dim)]">
          {sub}
        </span>
      </span>
      {trailing}
    </div>
  );
}

/**
 * The chat panel's frame: the 3px outline, 22px, the surface fill and NO shadow — the shadow
 * layer is the bubbles, input and Send inside it (`.lesson-chat`). On a phone it runs edge to
 * edge with only its top corners rounded (§1).
 */
export const GUIDED_CHAT_PANEL = cx(
  STROKE,
  "lesson-chat flex min-h-0 flex-1 flex-col overflow-hidden bg-card text-ink",
  "-mx-3 rounded-t-[var(--chat-panel-radius)] border-b-0",
  "sm:mx-0 sm:rounded-[var(--chat-panel-radius)] sm:border-b-[length:var(--play-stroke)]"
);

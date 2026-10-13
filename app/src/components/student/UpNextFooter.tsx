"use client";

import { useId, useState } from "react";
import Link from "next/link";

/**
 * Up next's footer (design handoff `home_ask` §3, "Option B"): a flat honey
 * strip, 3px ink on top, split into two 56px plain buttons by a 3px divider —
 * "Pick something else" and "Just practise · today's plan". Not links, not
 * stickers: they are the card's own doors.
 *
 * "Pick something else" opens the whole-book picker (rendered by the server
 * and handed in as `picker`) inside the card, under the strip.
 */
export function UpNextFooter({ picker }: { picker: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rule = {
    borderBlockStartWidth: "var(--play-stroke)",
    borderBlockStartStyle: "solid",
    borderBlockStartColor: "var(--ink)",
  } as const;
  const door =
    "flex min-h-14 items-center justify-center gap-2 px-4 text-center font-display text-[1rem] font-extrabold leading-tight hover:bg-[var(--card-warm-hover)]";
  return (
    <>
      <div className="grid grid-cols-2 bg-card-warm" style={rule}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className={`${door} text-ink`}
          style={{
            borderInlineEndWidth: "var(--play-stroke)",
            borderInlineEndStyle: "solid",
            borderInlineEndColor: "var(--ink)",
          }}
        >
          Pick something else
          <span aria-hidden className={`text-[0.7rem] transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>
        <Link href="/student?mode=practice" prefetch={false} className={`${door} text-ink`}>
          <span>
            Just practise{" "}
            <span className="font-bold text-ink-soft">· today&apos;s plan</span>
          </span>
        </Link>
      </div>
      {open && (
        <div id={panelId} style={rule}>
          {picker}
        </div>
      )}
    </>
  );
}

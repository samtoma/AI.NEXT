"use client";

/**
 * Inline lesson-stream card for the {{widget:viz:…}} / {{widget:viz_ref:…}}
 * directives — the AI pushes any of the nine primitives mid-chat as an
 * animated figure. Stored figures also carry their provenance stamp
 * (id + book page).
 */

import { HONEY_BAND, STICKER_PANEL, cx } from "@/components/sticker";
import { Visual } from "./Visual";
import { kindMeta } from "./kind-meta";

/** The same frame the interactive widgets wear (student/widgets/WidgetShell):
 *  a Play sticker panel with a Honey header band. It carried the Ledger's
 *  viridian soft shadow before (review 2026-09-23, F18). */
const FRAME = cx(STICKER_PANEL, "anim-pop my-2 max-w-[420px] overflow-hidden");
const HEAD = cx(HONEY_BAND, "flex flex-wrap items-center justify-between gap-2 px-3.5 py-2");

export function VizCard({
  kind,
  spec,
  caption,
  refId,
  sourcePage,
}: {
  kind: string;
  spec: Record<string, unknown>;
  caption?: string;
  /** stored-visual id (viz_ref) — rendered as a provenance stamp */
  refId?: string;
  sourcePage?: number | null;
}) {
  return (
    <div className={FRAME}>
      <div className={HEAD}>
        <span className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[color:var(--play-text-amber-warm)]">
          ✦ figure · {kind.replace(/_/g, " ")}
        </span>
        <span className="flex items-center gap-2">
          {(refId || sourcePage != null) && (
            <span className="font-mono text-[0.72rem] font-medium tracking-wide">
              {refId}
              {refId && sourcePage != null && " · "}
              {sourcePage != null && `book p.${sourcePage}`}
            </span>
          )}
          <span aria-hidden className="font-mono text-[10px] text-[color:var(--play-text-amber-warm)]">
            {kindMeta(kind).glyph}
          </span>
        </span>
      </div>
      <div className="px-3.5 py-3">
        <Visual kind={kind} spec={spec} caption={caption || null} />
      </div>
    </div>
  );
}

"use client";

/**
 * Inline lesson-stream card for the {{widget:viz:…}} / {{widget:viz_ref:…}}
 * directives — the AI pushes any of the nine primitives mid-chat as an
 * animated figure. Stored figures also carry their provenance stamp: the
 * book page for a student, and the figure's id and kind only for the console's
 * reviewer (`operator`) — an id is not something a student can use (UI
 * clean-up, 2026-10-23).
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
  operator = false,
}: {
  kind: string;
  spec: Record<string, unknown>;
  caption?: string;
  /** stored-visual id (viz_ref) — rendered as a provenance stamp */
  refId?: string;
  sourcePage?: number | null;
  /** the console's reviewer: shows the id and the primitive's name */
  operator?: boolean;
}) {
  const shownId = operator ? refId : undefined;
  return (
    <div className={FRAME}>
      <div className={HEAD}>
        <span className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[color:var(--play-text-amber-warm)]">
          {operator
            ? `✦ figure · ${kind === "book_image" ? "the book\u2019s picture" : kind.replace(/_/g, " ")}`
            : kind === "book_image"
              ? "✦ From your textbook"
              : "✦ Figure"}
        </span>
        <span className="flex items-center gap-2">
          {(shownId || sourcePage != null) && (
            <span className="font-mono text-[0.72rem] font-medium tracking-wide">
              {shownId}
              {shownId && sourcePage != null && " · "}
              {sourcePage != null && (operator ? `book p.${sourcePage}` : `Textbook p.${sourcePage}`)}
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

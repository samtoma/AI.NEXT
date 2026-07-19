"use client";

/**
 * Inline lesson-stream card for the {{widget:viz:…}} / {{widget:viz_ref:…}}
 * directives — the AI pushes any of the nine primitives mid-chat as an
 * animated figure. Stored figures also carry their provenance stamp
 * (id + book page).
 */

import { Visual } from "./Visual";
import { kindMeta } from "./kind-meta";

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
    <div className="anim-pop my-2 max-w-[420px] overflow-hidden rounded-lg border border-accent/40 bg-card shadow-[0_10px_24px_-16px_rgba(13,74,66,0.5)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-accent-wash px-3.5 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-accent-deep">
          ✦ figure · {kind.replace(/_/g, " ")}
        </span>
        <span className="flex items-center gap-2">
          {(refId || sourcePage != null) && (
            <span className="font-mono text-[8.5px] tracking-wide text-ink-faint">
              {refId}
              {refId && sourcePage != null && " · "}
              {sourcePage != null && `book p.${sourcePage}`}
            </span>
          )}
          <span aria-hidden className="font-mono text-[10px] text-accent-deep">
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

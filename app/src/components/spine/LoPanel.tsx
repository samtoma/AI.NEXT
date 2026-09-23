"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SpineBridge, SpineLo, SpineQuestion, Tier } from "@/lib/types";
import { spineSubjectDef } from "@/lib/subjects";
import type { VisualRow } from "@/lib/visuals";
import { masteryColor, masteryLabel, pct } from "@/lib/mastery";
import { TeX } from "@/components/TeX";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { Visual } from "@/components/viz/Visual";
import { kindMeta } from "@/components/viz/kind-meta";
import type { AsOf } from "./GraphCanvas";
import {
  HONEY_BAND,
  ICON_BUTTON,
  STICKER_CARD,
  STROKE,
  STROKE_WIDTH_SM,
  TIER_INK,
  cx,
} from "@/components/sticker";

const TIER_ORDER: Tier[] = ["basic", "standard", "advanced"];

/** Tier chip colours (fill + paired text + border colour, no width) — pair
 *  with `STROKE_WIDTH_SM`. Kept under this name because other surfaces
 *  import it from here. */
export const tierStyle: Record<Tier, string> = TIER_INK;

/** A list row that opens something: a sticker that presses, 52px floor. */
const ROW_BUTTON = cx(
  STROKE,
  "w-full min-h-[var(--noor-touch-min)] rounded-[var(--play-radius)] text-left",
  "sticker-shadow-sm play-pressable"
);

/** The subject chip's label + tokens come from the registry entry, so an LO
 *  whose course is unfiled shows NO chip rather than another subject's. */
function subjectChipOf(subject: SpineLo["subject"]) {
  const def = spineSubjectDef(subject);
  return def ? { label: def.labelAr, cls: def.accent.chip } : null;
}

export function LoPanel({
  lo,
  allLos,
  questions,
  bridges = [],
  asOf,
  onClose,
  onSelectLo,
  onOpenQuestion,
}: {
  lo: SpineLo;
  allLos: SpineLo[];
  questions: SpineQuestion[];
  /** cross-subject relates_to links touching this LO */
  bridges?: SpineBridge[];
  asOf: AsOf;
  onClose: () => void;
  onSelectLo: (id: string) => void;
  onOpenQuestion: (q: SpineQuestion) => void;
}) {
  const delta = lo.current - lo.baseline;
  const byId = new Map(allLos.map((l) => [l.id, l]));
  const subjectChip = subjectChipOf(lo.subject);
  // resolve each bridge's far endpoint (the LO in the OTHER subject)
  const connections = bridges
    .map((b) => {
      const otherId = b.src === lo.id ? b.dst : b.src;
      return { other: byId.get(otherId) ?? null, rationale: b.rationale };
    })
    .filter((c) => c.other);

  return (
    <aside
      className={cx(
        STICKER_CARD,
        "anim-panel thin-scroll w-[372px] shrink-0 self-stretch overflow-y-auto"
      )}
      style={{ maxHeight: H_PANEL }}
    >
      <div className={cx(HONEY_BAND, "sticky top-0 z-10 px-5 pb-3 pt-4")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
              {lo.syllabusRef} · node {lo.id}
            </p>
            <h2 className="mt-1 font-display text-xl font-extrabold leading-snug text-ink">
              {lo.label}
            </h2>
          </div>
          <button
            onClick={onClose}
            className={ICON_BUTTON}
            aria-label="Close panel"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="space-y-5 px-5 py-4">
        {lo.description && (
          <p className="font-read text-[13.5px] leading-relaxed text-ink-soft">
            <TeX text={lo.description} />
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {subjectChip && (
            <span className={`chip ${subjectChip.cls}`}>{subjectChip.label}</span>
          )}
          <span className="chip">source page {lo.sourcePage ?? "—"}</span>
          <span className="chip">{lo.syllabusRef}</span>
          <span className="chip">{questions.length} questions</span>
        </div>

        {connections.length > 0 && (
          <div>
            <p className="rule-label mb-2.5">🔗 cross-subject connections</p>
            <div className="space-y-2">
              {connections.map((c) => (
                <button
                  key={c.other!.id}
                  onClick={() => onSelectLo(c.other!.id)}
                  className={cx(ROW_BUTTON, "block bg-card-warm px-3 py-2 text-start")}
                >
                  {/* amber-family text on Honey takes its own token */}
                  <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-[color:var(--play-text-amber-warm)]">
                    <span aria-hidden>↗</span>
                    {c.other!.label}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-soft">
                    {c.rationale}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* mastery trend */}
        <div>
          <p className="rule-label mb-2.5">Mastery trend · as-of query</p>
          <div className="space-y-2">
            {(
              [
                ["Baseline", lo.baseline, "baseline"],
                ["Today", lo.current, "today"],
              ] as const
            ).map(([label, score, key]) => (
              <div key={label} className="flex items-center gap-2.5">
                <span
                  className={`w-14 text-[11px] ${
                    asOf === key ? "font-semibold text-ink" : "text-ink-faint"
                  }`}
                >
                  {label}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-[var(--play-radius-pill)] bg-ink/10">
                  <div
                    className="h-full rounded-[var(--play-radius-pill)] transition-all duration-700"
                    style={{
                      width: pct(score),
                      backgroundColor: masteryColor(score),
                    }}
                  />
                </div>
                <span className="w-9 text-right font-mono text-[11px] text-ink-soft">
                  {pct(score)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            {/* a gain is progress, so the progress pair (teal + its ink);
                a drop greys out like everything else that went the wrong
                way — never red */}
            <span
              className={cx(
                STROKE_WIDTH_SM,
                "inline-flex items-center gap-1 rounded-[var(--play-radius-pill)] px-2 py-0.5 font-mono text-[11px] font-semibold",
                delta >= 0
                  ? "border-ink bg-[var(--noor-progress)] text-[color:var(--noor-on-progress)]"
                  : "border-[color:var(--play-inactive-border)] bg-[var(--play-inactive-fill)] text-[color:var(--play-text-muted)]"
              )}
            >
              {delta >= 0 ? "▲" : "▼"} {Math.round(Math.abs(delta) * 100)} pts
              since diagnostic
            </span>
            <span className="text-[11px] text-ink-faint">
              now {masteryLabel(lo.current)}
            </span>
          </div>
        </div>

        <VisualsStrip loId={lo.id} />

        {/* prerequisites */}
        {lo.prereqIds.length > 0 && (
          <div>
            <p className="rule-label mb-2.5">Prerequisites</p>
            <div className="space-y-1.5">
              {lo.prereqIds.map((pid) => {
                const p = byId.get(pid);
                if (!p) return null;
                const met = p.current >= 0.5;
                return (
                  <button
                    key={pid}
                    onClick={() => onSelectLo(pid)}
                    className={cx(ROW_BUTTON, "flex items-center gap-2 bg-card-warm px-2.5 py-1.5")}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-[var(--play-radius-pill)]"
                      style={{ backgroundColor: masteryColor(p.current) }}
                    />
                    <span className="flex-1 truncate text-[12px] text-ink">
                      {p.label}
                    </span>
                    <span
                      className={`font-mono text-[10px] ${
                        met
                          ? "text-accent-deep"
                          : "text-[color:var(--play-text-muted)]"
                      }`}
                    >
                      {met ? "met ✓" : "not met"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* questions by tier */}
        <div>
          <p className="rule-label mb-2.5">Questions</p>
          <div className="space-y-3.5">
            {TIER_ORDER.map((tier) => {
              const qs = questions.filter((q) => q.tier === tier);
              if (qs.length === 0) return null;
              return (
                <div key={tier}>
                  <span
                    className={cx(
                      STROKE_WIDTH_SM,
                      "inline-block rounded-[var(--play-radius-sm)] px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.12em]",
                      tierStyle[tier]
                    )}
                  >
                    {tier}
                  </span>
                  <div className="mt-1.5 space-y-1.5">
                    {qs.map((q) => (
                      <button
                        key={q.id}
                        onClick={() => onOpenQuestion(q)}
                        className={cx(ROW_BUTTON, "group bg-card px-3 py-2")}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] text-ink-faint">
                            {q.id}
                          </span>
                          <span className="flex items-center gap-1.5">
                            {/* Whether a human has read this item is worth a
                                chip in the dense list, not only in the modal:
                                an operator scanning a unit should not have to
                                open twelve questions to find the unchecked one. */}
                            <ProvenanceBadge question={q.provenance} />
                            <span className="chip border-accent/30 bg-accent-wash px-1.5! py-px! text-[9px]! text-accent-deep">
                              {q.status}
                            </span>
                            <span className="font-mono text-[9px] uppercase text-ink-faint">
                              p.{q.provenance.sourcePage}
                            </span>
                          </span>
                        </div>
                        <p className="mt-1 text-[12.5px] leading-snug text-ink-soft transition-colors group-hover:text-ink">
                          <TeX text={q.stem} />
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}

const H_PANEL = 470 + 41; // graph height + canvas footer, keeps rows aligned

/* ------------------------------------------------------------------ */
/* Visuals strip — animated figures attached to this LO                */
/* ------------------------------------------------------------------ */

function VisualsStrip({ loId }: { loId: string }) {
  const [visuals, setVisuals] = useState<VisualRow[]>([]);
  const [open, setOpen] = useState<VisualRow | null>(null);

  useEffect(() => {
    let alive = true;
    setVisuals([]);
    fetch(`/api/visuals?lo=${encodeURIComponent(loId)}`)
      .then((r) => (r.ok ? r.json() : { visuals: [] }))
      .then((j: { visuals?: VisualRow[] }) => {
        if (alive) setVisuals(j.visuals ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [loId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (visuals.length === 0) return null;

  return (
    <div className="anim-fade">
      <p className="rule-label mb-2.5">Visuals · animated from the book</p>
      {/* end/bottom padding leaves room for the sticker shadow and its
          hover lift, which the scroller would otherwise clip */}
      <div className="thin-scroll -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2 pe-2 pt-0.5">
        {visuals.map((v) => (
          <button
            key={v.id}
            onClick={() => setOpen(v)}
            title={v.caption ?? v.id}
            className={cx(
              STROKE,
              "group w-[150px] shrink-0 rounded-[var(--play-radius)] bg-card p-1.5 text-left sticker-shadow-sm play-pressable"
            )}
          >
            <Visual kind={v.kind} spec={v.spec} />
            <span className="mt-1 flex items-center justify-between gap-1 px-0.5">
              <span className="truncate font-mono text-[8.5px] text-ink-faint">
                <span aria-hidden>{kindMeta(v.kind).glyph}</span> {v.kind}
              </span>
              <span className="shrink-0 font-mono text-[8.5px] text-ink-faint">
                p.{v.sourcePage ?? "—"}
              </span>
            </span>
          </button>
        ))}
      </div>

      {open &&
        createPortal(
          <div
            className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-6 backdrop-blur-[2px]"
            onClick={() => setOpen(null)}
            role="dialog"
            aria-modal="true"
            aria-label={open.caption ?? open.id}
          >
            <div
              className={cx(STICKER_CARD, "anim-pop w-full max-w-[520px] overflow-hidden")}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={cx(HONEY_BAND, "flex items-center justify-between gap-3 px-4 py-2.5")}>
                <span className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                  {open.id} · {open.loLabel}
                </span>
                <button
                  onClick={() => setOpen(null)}
                  aria-label="Close visual"
                  className={ICON_BUTTON}
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="px-5 pt-4">
                <Visual kind={open.kind} spec={open.spec} />
              </div>
              <div className="px-5 pb-4 pt-3">
                {open.caption && (
                  <p className="text-[13px] leading-relaxed text-ink">
                    {open.caption}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <span
                    className={cx(
                      STROKE_WIDTH_SM,
                      "inline-flex items-center gap-1 rounded-[var(--play-radius-pill)] px-2 py-px font-mono text-[9.5px]",
                      kindMeta(open.kind).chip
                    )}
                  >
                    <span aria-hidden>{kindMeta(open.kind).glyph}</span>
                    {open.kind}
                  </span>
                  <span className="chip px-2! py-px! text-[9.5px]!">
                    source page {open.sourcePage ?? "—"}
                  </span>
                  {open.questionId && (
                    <span className="chip px-2! py-px! text-[9.5px]!">
                      {open.questionId}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

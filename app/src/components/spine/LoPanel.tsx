"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SpineLo, SpineQuestion, Tier } from "@/lib/types";
import type { VisualRow } from "@/lib/visuals";
import { masteryColor, masteryLabel, pct } from "@/lib/mastery";
import { TeX } from "@/components/TeX";
import { Visual } from "@/components/viz/Visual";
import { kindMeta } from "@/components/viz/kind-meta";
import type { AsOf } from "./GraphCanvas";

const TIER_ORDER: Tier[] = ["basic", "standard", "advanced"];

export const tierStyle: Record<Tier, string> = {
  basic: "bg-accent-wash text-accent-deep border-accent/30",
  standard: "bg-gold-wash text-gold border-gold/35",
  advanced: "bg-rust-wash text-rust border-rust/30",
};

export function LoPanel({
  lo,
  allLos,
  questions,
  asOf,
  onClose,
  onSelectLo,
  onOpenQuestion,
}: {
  lo: SpineLo;
  allLos: SpineLo[];
  questions: SpineQuestion[];
  asOf: AsOf;
  onClose: () => void;
  onSelectLo: (id: string) => void;
  onOpenQuestion: (q: SpineQuestion) => void;
}) {
  const delta = lo.current - lo.baseline;
  const byId = new Map(allLos.map((l) => [l.id, l]));

  return (
    <aside className="anim-panel ledger-card thin-scroll w-[372px] shrink-0 self-stretch overflow-y-auto"
      style={{ maxHeight: H_PANEL }}
    >
      <div className="sticky top-0 z-10 border-b border-line-soft bg-card/95 px-5 pb-3 pt-4 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
              {lo.syllabusRef} · node {lo.id}
            </p>
            <h2 className="mt-1 font-display text-xl font-medium leading-snug text-ink">
              {lo.label}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-faint transition-colors hover:bg-line-soft hover:text-ink"
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
          <p className="text-[13.5px] leading-relaxed text-ink-soft">
            <TeX text={lo.description} />
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <span className="chip">source page {lo.sourcePage ?? "—"}</span>
          <span className="chip">{lo.syllabusRef}</span>
          <span className="chip">{questions.length} questions</span>
        </div>

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
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10">
                  <div
                    className="h-full rounded-full transition-all duration-700"
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
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${
                delta >= 0
                  ? "bg-accent-wash text-accent-deep"
                  : "bg-rust-wash text-rust"
              }`}
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
                    className="flex w-full items-center gap-2 rounded-md border border-line-soft bg-card-warm px-2.5 py-1.5 text-left transition-colors hover:border-line"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: masteryColor(p.current) }}
                    />
                    <span className="flex-1 truncate text-[12px] text-ink">
                      {p.label}
                    </span>
                    <span
                      className={`font-mono text-[10px] ${
                        met ? "text-accent-deep" : "text-rust"
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
                    className={`inline-block rounded border px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.12em] ${tierStyle[tier]}`}
                  >
                    {tier}
                  </span>
                  <div className="mt-1.5 space-y-1.5">
                    {qs.map((q) => (
                      <button
                        key={q.id}
                        onClick={() => onOpenQuestion(q)}
                        className="group w-full rounded-md border border-line-soft bg-card px-3 py-2 text-left transition-all duration-200 hover:-translate-y-px hover:border-accent/40 hover:shadow-[0_6px_16px_-8px_rgba(13,74,66,0.35)]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] text-ink-faint">
                            {q.id}
                          </span>
                          <span className="flex items-center gap-1.5">
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
      <div className="thin-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {visuals.map((v) => (
          <button
            key={v.id}
            onClick={() => setOpen(v)}
            title={v.caption ?? v.id}
            className="group w-[150px] shrink-0 rounded-md border border-line-soft bg-card p-1.5 text-left transition-all duration-200 hover:-translate-y-px hover:border-accent/40 hover:shadow-[0_6px_16px_-8px_rgba(13,74,66,0.35)]"
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
              className="ledger-card anim-pop w-full max-w-[520px] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-line-soft bg-card-warm px-4 py-2.5">
                <span className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                  {open.id} · {open.loLabel}
                </span>
                <button
                  onClick={() => setOpen(null)}
                  aria-label="Close visual"
                  className="rounded-full p-1.5 text-ink-faint transition-colors hover:bg-line-soft hover:text-ink"
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
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-px font-mono text-[9.5px] ${kindMeta(open.kind).chip}`}
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

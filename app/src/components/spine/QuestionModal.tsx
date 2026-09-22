"use client";

import { useEffect, useState } from "react";
import { mcqChoices } from "@/lib/types";
import type { SpineData, SpineLo, SpineQuestion } from "@/lib/types";
import { stepText } from "@/lib/types";
import { TeX } from "@/components/TeX";
import { tierStyle } from "./tier-style";
import { questionProvenance } from "@/lib/provenance";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import {
  BADGE,
  BUTTON_SECONDARY,
  HONEY_BAND,
  ICON_BUTTON,
  STICKER_CARD,
  STICKER_PANEL,
  STROKE,
  STROKE_WIDTH,
  STROKE_WIDTH_SM,
  VERDICT_INK,
  cx,
} from "@/components/sticker";

const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function shortSha(sha: string) {
  const v = sha.replace(/^sha256:/, "");
  return v.length > 20 ? `${v.slice(0, 12)}…${v.slice(-6)}` : v;
}

export function QuestionModal({
  question: q,
  lo,
  doc,
  onClose,
}: {
  question: SpineQuestion;
  lo: SpineLo | null;
  doc: SpineData["doc"];
  onClose: () => void;
}) {
  const [revealed, setRevealed] = useState(1);
  const total = q.solution.length;
  const prov = questionProvenance(q.provenance);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className={cx(
          STICKER_CARD,
          "anim-pop thin-scroll max-h-[90vh] w-full max-w-2xl overflow-y-auto"
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* header */}
        <div className={cx(HONEY_BAND, "sticky top-0 z-10 flex items-center justify-between gap-3 px-6 py-3.5")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-ink-soft">{q.id}</span>
            <span
              className={cx(
                STROKE_WIDTH_SM,
                "rounded-[var(--play-radius-sm)] px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.12em]",
                tierStyle[q.tier]
              )}
            >
              {q.tier}
            </span>
            <span className="chip border-accent/30 bg-accent-wash px-1.5! py-px! text-[9px]! text-accent-deep">
              status · {q.status}
            </span>
            {/* Same chip as the list this modal was opened from, so provenance
                does not disappear the moment you look closer at an item. */}
            <ProvenanceBadge question={q.provenance} />
            <span className="font-mono text-[10px] text-ink-faint">
              {lo?.syllabusRef} · {q.loId}
            </span>
          </div>
          <button
            onClick={onClose}
            className={ICON_BUTTON}
            aria-label="Close"
          >
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* stem */}
          <div className="tex-block text-[17px] leading-relaxed text-ink">
            <TeX text={q.stem} />
          </div>

          {/* choices */}
          {q.questionType === "mcq" && q.choices && (
            <div className="grid gap-2 sm:grid-cols-2">
              {mcqChoices(q)!.map((c) => {
                const correct = c.key === q.correctAnswer;
                return (
                  // Not a control — a reference view of the options, with the
                  // correct one on the leaf verdict ink and the rest on white.
                  <div
                    key={c.key}
                    className={cx(
                      STROKE_WIDTH,
                      "flex items-center gap-3 rounded-[var(--play-radius)] px-3.5 py-2.5 text-[14px] sticker-shadow-sm",
                      correct ? VERDICT_INK.correct : "border-ink bg-card text-ink-soft"
                    )}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] font-mono text-[11px] font-semibold ${
                        correct
                          ? "bg-accent text-paper"
                          : "bg-ink/8 text-ink-soft"
                      }`}
                    >
                      {c.key}
                    </span>
                    <span className="flex-1">
                      <TeX text={c.text} />
                    </span>
                    {correct && (
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">
                        correct ✓
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {q.questionType === "numeric" && (
            <div
              className={cx(
                STROKE_WIDTH,
                "flex items-center gap-3 rounded-[var(--play-radius)] px-4 py-2.5 sticker-shadow-sm",
                VERDICT_INK.correct
              )}
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
                numeric answer
              </span>
              <span className="font-mono text-[15px] font-semibold">
                {q.correctAnswer}
              </span>
            </div>
          )}

          {/* canonical solution */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="rule-label">
                Canonical solution · v{q.solutionVersion}
              </p>
            </div>
            <ol className="space-y-2.5">
              {q.solution.slice(0, revealed).map((s) => (
                <li
                  key={s.step}
                  className={cx(
                    STROKE,
                    "anim-rise flex gap-3 rounded-[var(--play-radius)] bg-card-warm px-4 py-3 sticker-shadow-sm"
                  )}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] bg-ink font-mono text-[11px] font-semibold text-paper">
                    {s.step}
                  </span>
                  <span className="tex-block pt-0.5 text-[14px] leading-relaxed text-ink">
                    <TeX text={stepText(s)} />
                  </span>
                </li>
              ))}
            </ol>
            {revealed < total ? (
              <button
                onClick={() => setRevealed((r) => r + 1)}
                className={cx(BUTTON_SECONDARY, "mt-3")}
              >
                Reveal step {revealed + 1} of {total} ↓
              </button>
            ) : (
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                {total} steps · reviewed canonical solution — the ground truth
                every generated explanation is checked against
              </p>
            )}
          </div>

          {/* provenance passport — a sticker panel under Play; the ledger's
              dashed-gold passport and rotated rubber stamp were the frozen
              baseline's anatomy */}
          <div className={cx(STICKER_PANEL, "p-5")}>
            <div className="relative">
              <div className="flex items-start justify-between gap-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold">
                  Provenance record
                </p>
                {/* This stamp used to read "Reviewed ✓" unconditionally. That
                    was true when every question came out of the reviewed book
                    extraction, and became a lie the moment generated items
                    landed beside them (ADR-0008): the passport would have
                    asserted a human check that never happened, on the one
                    screen built to make provenance believable. */}
                <span
                  className={cx(
                    BADGE,
                    "anim-pop",
                    prov.humanChecked ? VERDICT_INK.correct : VERDICT_INK.partial
                  )}
                >
                  {prov.humanChecked ? "Reviewed ✓" : "Not reviewed"}
                </span>
              </div>

              <div className="mt-3 flex items-start gap-5">
                {/* page stamp */}
                <div
                  className={cx(
                    STROKE,
                    "flex shrink-0 flex-col items-center rounded-[var(--play-radius-sm)] bg-card-warm px-4 py-2.5"
                  )}
                >
                  {/* amber-family text on Honey takes its own token */}
                  <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--play-text-amber-warm)]">
                    page
                  </span>
                  {/* a page number on one line — it cannot wrap, so the
                      tight leading stays */}
                  <span className="font-display text-3xl font-extrabold leading-none text-ink">
                    {q.provenance.sourcePage ?? "—"}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="font-display text-[15px] font-bold leading-snug text-ink">
                    {doc.title}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">
                    {doc.publisher} · edition {doc.edition}
                  </p>
                  {q.provenance.sourceNote && (
                    <p className="mt-1.5 text-[11.5px] italic leading-relaxed text-ink-faint">
                      “{q.provenance.sourceNote}”
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line-soft pt-3 font-mono text-[11px]">
                <Field
                  k="extraction run"
                  v={
                    q.provenance.extractor
                      ? `${q.provenance.extractor} · ${q.provenance.extractorVersion}`
                      : "—"
                  }
                />
                <Field
                  k="extracted"
                  v={fmtDateTime(q.provenance.extractionFinishedAt)}
                />
                <Field k="origin" v={prov.label} />
                {q.provenance.parentQuestionId && (
                  <Field k="derived from" v={q.provenance.parentQuestionId} />
                )}
                <Field k="reviewed by" v={q.provenance.reviewedBy ?? "— nobody"} />
                <Field k="reviewed at" v={fmtDateTime(q.provenance.reviewedAt)} />
                <Field k="source value" v={q.provenance.source} />
                <Field k="sha-256" v={shortSha(q.provenance.sourceSha256)} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-[0.16em] text-ink-faint">{k}</p>
      <p className="truncate text-ink-soft" title={v}>
        {v}
      </p>
    </div>
  );
}

import { TeX } from "@/components/TeX";
import type { ReviewQuestion } from "@/lib/pipeline-queries";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ReviewStage({
  q,
  liveCount,
  reviewedCount,
}: {
  q: ReviewQuestion;
  liveCount: number;
  reviewedCount: number;
}) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_19rem]">
      {/* the question, exactly as it sits in the spine */}
      <div className="ledger-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-card-warm px-5 py-3">
          <span className="font-mono text-[11px] font-semibold text-ink">{q.id}</span>
          <span className="chip">{q.tier}</span>
          <span className="chip">{q.questionType}</span>
          <span className="chip">
            {q.loId} · {q.loLabel}
          </span>
        </div>

        <div className="px-5 py-4">
          <p className="text-[15.5px] font-medium leading-relaxed text-ink">
            <TeX text={q.stem} />
          </p>

          {q.choices && (
            <div className="mt-3.5 grid gap-1.5 sm:grid-cols-2">
              {q.choices.map((c) => {
                const correct = c.key === q.correctAnswer;
                return (
                  <div
                    key={c.key}
                    className={`flex items-baseline gap-2.5 rounded-md border px-3 py-1.5 text-[13px] ${
                      correct
                        ? "border-accent/40 bg-accent-wash text-ink"
                        : "border-line-soft text-ink-soft"
                    }`}
                  >
                    <span
                      className={`font-mono text-[11px] font-semibold ${
                        correct ? "text-accent-deep" : "text-ink-faint"
                      }`}
                    >
                      {c.key}
                    </span>
                    <span className="leading-relaxed">
                      <TeX text={c.text} />
                    </span>
                    {correct && (
                      <span className="ml-auto font-mono text-[10px] font-semibold text-accent-deep">
                        ✓
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4">
            <p className="rule-label mb-2">
              Canonical solution · what the AI is allowed to explain from
            </p>
            <ol className="space-y-1.5">
              {q.solution.map((s) => (
                <li key={s.step} className="flex gap-3 text-[13.5px] leading-relaxed text-ink-soft">
                  <span className="mt-0.5 font-mono text-[10.5px] font-semibold text-gold">
                    {String(s.step).padStart(2, "0")}
                  </span>
                  <span>
                    <TeX text={s.text_md} />
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-dashed border-line px-5 py-2.5 font-mono text-[10.5px] text-ink-faint">
          <span className="text-gold">↳ book p.{q.sourcePage}</span>
          <span>{q.sourceNote}</span>
        </div>
      </div>

      {/* the gate itself */}
      <div className="passport p-6">
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
              Human review gate
            </p>
            <span className="stamp-seal anim-stamp shrink-0">Reviewed ✓</span>
          </div>

          <div className="mt-4 space-y-0.5">
            {[
              { s: "draft", note: "extracted, invisible to students", done: true },
              { s: "review", note: "a person checks stem + every step", done: true },
              { s: "live", note: "servable — and only now", done: true, current: true },
            ].map((step, i) => (
              <div key={step.s} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-1 h-2.5 w-2.5 rounded-full border-2 ${
                      step.current
                        ? "border-accent bg-accent"
                        : "border-ink-faint bg-transparent"
                    }`}
                  />
                  {i < 2 && <span className="h-6 w-px bg-line" />}
                </div>
                <div className="pb-1.5">
                  <p
                    className={`font-mono text-[12px] font-semibold ${
                      step.current ? "text-accent-deep" : "text-ink-soft"
                    }`}
                  >
                    {step.s}
                    {step.current && " ●"}
                  </p>
                  <p className="text-[11.5px] leading-snug text-ink-faint">{step.note}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-dashed border-gold/40 pt-3.5 font-mono text-[11px] leading-relaxed text-ink-soft">
            <p>
              reviewed_by <span className="font-semibold text-ink">{q.reviewedBy}</span>
            </p>
            <p>
              reviewed_at <span className="font-semibold text-ink">{fmtDate(q.reviewedAt)}</span>
            </p>
            <p className="mt-2">
              {reviewedCount}/{liveCount} live questions carry this stamp
            </p>
          </div>

          <p className="mt-4 text-[13px] leading-relaxed text-ink-soft">
            The LLM never solves from scratch — it explains from these reviewed
            steps. An unreviewed question simply cannot be served.
          </p>
        </div>
      </div>
    </div>
  );
}

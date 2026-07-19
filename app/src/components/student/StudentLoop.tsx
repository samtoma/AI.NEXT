"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { AttemptResult, PlanItem, PlanReason } from "@/lib/types";
import type { Cite } from "@/lib/chat-parse";
import { TeX } from "@/components/TeX";
import { ChatCore } from "@/components/chat/ChatCore";
import { masteryColor, pct } from "@/lib/mastery";

const REASON_META: Record<
  PlanReason,
  { label: string; className: string; why: string }
> = {
  weakest: {
    label: "weakest topic",
    className: "bg-rust-wash text-rust border-rust/35",
    why: "lowest mastery with prerequisites met",
  },
  review: {
    label: "spaced review",
    className: "bg-accent-wash text-accent-deep border-accent/35",
    why: "strong topic — keep it warm",
  },
  stretch: {
    label: "stretch",
    className: "bg-gold-wash text-gold border-gold/40",
    why: "one step past the frontier",
  },
};

type Phase = "plan" | "asking" | "correct" | "explain" | "summary";

interface Recorded {
  item: PlanItem;
  result: AttemptResult;
}

export function StudentLoop({
  plan,
  studentName,
}: {
  plan: PlanItem[];
  studentName: string;
}) {
  const [phase, setPhase] = useState<Phase>("plan");
  const [idx, setIdx] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [numeric, setNumeric] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<Recorded[]>([]);
  const [lastGiven, setLastGiven] = useState<string>("");
  const [askOpen, setAskOpen] = useState(false);
  const shownAt = useRef<number>(Date.now());

  const item = plan[idx];
  const lastResult = records[records.length - 1]?.result;

  const begin = () => {
    shownAt.current = Date.now();
    setPhase("asking");
  };

  const advance = () => {
    setChoice(null);
    setNumeric("");
    setAskOpen(false);
    if (idx + 1 >= plan.length) {
      setPhase("summary");
    } else {
      setIdx((i) => i + 1);
      shownAt.current = Date.now();
      setPhase("asking");
    }
  };

  const submit = async () => {
    const given = item.questionType === "mcq" ? choice : numeric.trim();
    if (!given || busy) return;
    setLastGiven(given);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: item.questionId,
          givenAnswer: given,
          timeMs: Date.now() - shownAt.current,
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const result: AttemptResult = await res.json();
      setRecords((r) => [...r, { item, result }]);
      setPhase(result.isCorrect ? "correct" : "explain");
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(false);
    }
  };

  // aggregated per-LO deltas for the summary
  const loDeltas = useMemo(() => {
    const m = new Map<
      string,
      { label: string; first: number; last: number }
    >();
    for (const { result } of records) {
      const cur = m.get(result.loId);
      if (cur) cur.last = result.newScore;
      else
        m.set(result.loId, {
          label: result.loLabel,
          first: result.oldScore,
          last: result.newScore,
        });
    }
    return [...m.values()];
  }, [records]);

  return (
    <main className="mx-auto max-w-3xl px-6 pb-16">
      <section className="anim-rise pb-6 pt-9">
        <p className="rule-label mb-4">Student Loop · {studentName}</p>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink md:text-4xl">
            <span dir="rtl" className="text-accent-deep">خطة اليوم</span>
            <span className="mx-3 text-ink-faint">/</span>
            Today&apos;s Plan
          </h1>
          {phase !== "plan" && phase !== "summary" && (
            <div className="flex items-center gap-1.5">
              {plan.map((p, i) => {
                const rec = records[i];
                return (
                  <span
                    key={p.questionId}
                    className="h-2 w-7 rounded-full transition-colors duration-300"
                    style={{
                      backgroundColor: rec
                        ? rec.result.isCorrect
                          ? "var(--m-high)"
                          : "var(--m-low)"
                        : i === idx
                          ? "var(--ink)"
                          : "rgba(32,41,58,0.15)",
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ------- plan overview ------- */}
      {phase === "plan" && (
        <section className="space-y-3">
          <p
            className="anim-rise text-[15px] leading-relaxed text-ink-soft"
            style={{ animationDelay: "60ms" }}
          >
            Five questions picked from the curriculum graph — weighted toward
            the weakest objectives whose prerequisites are met, plus spaced
            review and one stretch.
          </p>
          {plan.map((p, i) => {
            const meta = REASON_META[p.reason];
            return (
              <div
                key={p.questionId}
                className="ledger-card anim-rise flex items-center gap-4 px-5 py-3.5"
                style={{ animationDelay: `${120 + i * 70}ms` }}
              >
                <span className="font-display text-xl font-medium text-ink-faint">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13.5px] font-semibold text-ink">
                      {p.loLabel}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-px font-mono text-[9.5px] uppercase tracking-[0.1em] ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[10.5px] text-ink-faint">
                    {meta.why} · mastery {pct(p.loScore)} · {p.tier} tier
                  </p>
                </div>
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: masteryColor(p.loScore) }}
                />
              </div>
            );
          })}
          <div className="anim-rise pt-3" style={{ animationDelay: "520ms" }}>
            <button
              onClick={begin}
              className="w-full rounded-xl bg-ink py-3.5 font-display text-lg font-medium text-paper transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-deep hover:shadow-[0_16px_32px_-16px_rgba(13,74,66,0.6)]"
            >
              Start the session →
            </button>
          </div>
        </section>
      )}

      {/* ------- question ------- */}
      {(phase === "asking" || phase === "correct" || phase === "explain") &&
        item && (
          <section key={item.questionId} className="anim-pop">
            <div className="ledger-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-card-warm px-6 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] font-semibold text-ink">
                    {item.loLabel}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-px font-mono text-[9.5px] uppercase tracking-[0.1em] ${REASON_META[item.reason].className}`}
                  >
                    {REASON_META[item.reason].label}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-ink-faint">
                  {item.questionId} · p.{item.sourcePage ?? "—"} · {item.tier}
                </span>
              </div>

              <div className="px-6 py-6">
                <p className="tex-block text-[18px] leading-relaxed text-ink">
                  <TeX text={item.stem} />
                </p>

                {/* answers */}
                {phase === "asking" && (
                  <div className="mt-6">
                    {item.questionType === "mcq" && item.choices ? (
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {item.choices.map((c) => (
                          <button
                            key={c.key}
                            onClick={() => setChoice(c.key)}
                            className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-[15px] transition-all duration-150 ${
                              choice === c.key
                                ? "border-ink bg-ink/5 shadow-[0_0_0_1px_var(--ink)]"
                                : "border-line bg-card hover:-translate-y-px hover:border-ink/40"
                            }`}
                          >
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-semibold transition-colors ${
                                choice === c.key
                                  ? "bg-ink text-paper"
                                  : "bg-ink/8 text-ink-soft"
                              }`}
                            >
                              {c.key}
                            </span>
                            <TeX text={c.text} />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={numeric}
                        onChange={(e) => setNumeric(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && submit()}
                        placeholder="Type your answer…"
                        autoFocus
                        className="w-full max-w-xs rounded-lg border border-line bg-card px-4 py-3 font-mono text-lg text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent"
                      />
                    )}

                    <div className="mt-6 flex items-center gap-4">
                      <button
                        onClick={submit}
                        disabled={
                          busy ||
                          (item.questionType === "mcq" ? !choice : !numeric.trim())
                        }
                        className="rounded-full bg-ink px-7 py-2.5 text-[14px] font-semibold text-paper transition-all duration-200 enabled:hover:-translate-y-0.5 enabled:hover:bg-accent-deep disabled:opacity-35"
                      >
                        {busy ? "Checking…" : "Submit answer"}
                      </button>
                      {error && (
                        <span className="text-[13px] text-rust">
                          {error} — try again
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* correct */}
                {phase === "correct" && lastResult && (
                  <div className="anim-pop mt-6 rounded-xl border border-accent/40 bg-accent-wash px-5 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-display text-xl font-medium text-accent-deep">
                        Correct — nicely done. ✓
                      </p>
                      <MasteryDelta result={lastResult} />
                    </div>
                    <button
                      onClick={advance}
                      className="mt-4 rounded-full bg-accent-deep px-6 py-2 text-[14px] font-semibold text-paper transition-all duration-200 hover:-translate-y-0.5"
                    >
                      {idx + 1 >= plan.length ? "Finish session →" : "Next question →"}
                    </button>
                  </div>
                )}

                {/* wrong → grounded explanation */}
                {phase === "explain" && lastResult && (
                  <div className="anim-pop mt-6 rounded-xl border border-rust/35 bg-rust-wash/60 px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-display text-lg font-medium text-ink">
                        Not quite — let&apos;s look at it step by step.
                      </p>
                      <span className="chip border-accent/40 bg-accent-wash text-accent-deep">
                        grounded in reviewed solution ✓
                      </span>
                    </div>
                    <ol className="mt-4 space-y-2.5">
                      {lastResult.solution.map((s, i) => (
                        <li
                          key={s.step}
                          className="anim-rise flex gap-3 rounded-lg border border-line-soft bg-card px-4 py-3"
                          style={{ animationDelay: `${200 + i * 550}ms` }}
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[11px] font-semibold text-paper">
                            {s.step}
                          </span>
                          <span className="tex-block pt-0.5 text-[14px] leading-relaxed text-ink">
                            <TeX text={s.text_md} />
                          </span>
                        </li>
                      ))}
                    </ol>
                    <div
                      className="anim-rise mt-4 flex flex-wrap items-center justify-between gap-3"
                      style={{
                        animationDelay: `${200 + lastResult.solution.length * 550}ms`,
                      }}
                    >
                      <MasteryDelta result={lastResult} />
                      <div className="flex flex-wrap items-center gap-2.5">
                        {!askOpen && (
                          <button
                            onClick={() => setAskOpen(true)}
                            className="rounded-full border border-accent/50 bg-accent-wash px-5 py-2 text-[13px] font-semibold text-accent-deep transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent hover:text-paper"
                          >
                            Still confused? Ask the tutor ✦
                          </button>
                        )}
                        <button
                          onClick={advance}
                          className="rounded-full bg-ink px-6 py-2 text-[14px] font-semibold text-paper transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-deep"
                        >
                          Got it {idx + 1 >= plan.length ? "— finish →" : "→"}
                        </button>
                      </div>
                    </div>

                    {askOpen && (
                      <div className="anim-pop mt-4 overflow-hidden rounded-xl border border-accent/35 bg-card">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-accent-wash px-4 py-2">
                          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-accent-deep">
                            ✦ AI tutor · grounded in the canonical steps only
                          </span>
                          <span className="font-mono text-[9px] text-ink-faint">
                            max 2 AI turns per question
                          </span>
                        </div>
                        <div className="flex h-[400px] flex-col">
                          <ChatCore
                            key={item.questionId}
                            surface="student_chat"
                            questionId={item.questionId}
                            wrongAnswer={lastGiven}
                            autoStart={`I answered "${lastGiven}" and it was wrong. Can you explain where I went wrong — in a different way than the steps above?`}
                            suggestions={[
                              "لسه مش فاهم — try it yet another way",
                            ]}
                            placeholder="Ask about this question…"
                            resolveCite={(c: Cite) =>
                              c.kind === "page"
                                ? {
                                    title: "Ministry textbook",
                                    sub: `MOETE 2025–2026 · page ${c.id}`,
                                  }
                                : c.kind === "q"
                                  ? {
                                      title: "This question",
                                      sub: `${c.id} · reviewed canonical solution`,
                                    }
                                  : {
                                      title:
                                        c.id === item.loId
                                          ? item.loLabel
                                          : c.id,
                                      sub: "learning objective",
                                    }
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              every attempt is written to attempts + mastery (temporal) ·
              wrong answers log a grounded explanation
            </p>
          </section>
        )}

      {/* ------- summary ------- */}
      {phase === "summary" && (
        <section className="space-y-5">
          <div className="ledger-card anim-pop px-7 py-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-display text-2xl font-medium text-ink">
                Session complete
              </h2>
              <p className="font-mono text-[12px] text-ink-soft">
                {records.filter((r) => r.result.isCorrect).length} / {records.length}{" "}
                correct
              </p>
            </div>

            <p className="rule-label mb-3 mt-6">Mastery updated · temporal rows written</p>
            <div className="space-y-3">
              {loDeltas.map((d) => {
                const delta = d.last - d.first;
                return (
                  <div key={d.label} className="flex items-center gap-3">
                    <span className="w-56 truncate text-[13px] font-medium text-ink">
                      {d.label}
                    </span>
                    <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-ink/10">
                      <div
                        className="absolute h-full rounded-full opacity-35"
                        style={{
                          width: pct(d.first),
                          backgroundColor: masteryColor(d.first),
                        }}
                      />
                      <div
                        className="absolute h-full rounded-full transition-all duration-1000 ease-out"
                        style={{
                          width: pct(d.last),
                          backgroundColor: masteryColor(d.last),
                        }}
                      />
                    </div>
                    <span
                      className={`w-20 text-right font-mono text-[12px] font-semibold ${
                        delta >= 0 ? "text-accent-deep" : "text-rust"
                      }`}
                    >
                      {delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(delta * 100))} pts
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="anim-rise flex flex-wrap gap-3" style={{ animationDelay: "250ms" }}>
            <Link
              href="/spine"
              className="flex-1 rounded-xl bg-ink px-6 py-3.5 text-center font-display text-lg font-medium text-paper transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-deep"
            >
              See it on the graph →
            </Link>
            <button
              onClick={() => window.location.reload()}
              className="rounded-xl border border-line bg-card px-6 py-3.5 font-display text-lg font-medium text-ink transition-all duration-200 hover:-translate-y-0.5"
            >
              New plan
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

function MasteryDelta({ result }: { result: AttemptResult }) {
  const delta = result.newScore - result.oldScore;
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] text-ink-soft">
      mastery {pct(result.oldScore)}
      <svg width="14" height="8" viewBox="0 0 14 8" fill="none" aria-hidden>
        <path d="M0 4h12m0 0L9 1m3 3L9 7" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <strong
        className={`font-semibold ${delta >= 0 ? "text-accent-deep" : "text-rust"}`}
      >
        {pct(result.newScore)}
      </strong>
    </span>
  );
}

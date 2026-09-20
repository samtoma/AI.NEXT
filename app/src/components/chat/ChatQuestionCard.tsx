"use client";

import { useRef, useState } from "react";
import { mcqChoices } from "@/lib/types";
import type { AttemptResult, SpineQuestion, WidgetQuestionSpec } from "@/lib/types";
import { MathWidget } from "@/components/student/widgets/render-math-widget";
import type { WidgetOutcome } from "@/lib/widget-predicates";
import { TeX } from "@/components/TeX";
import { pct } from "@/lib/mastery";
import { tierStyle } from "@/components/spine/LoPanel";

/**
 * Live question card pushed into the chat by a {{show_question:…}} directive.
 * Answering goes through the real /api/attempts flow — mastery updates,
 * temporal rows are written, and the graph ripples.
 */
export function ChatQuestionCard({
  question: q,
  debug = true,
  lang = "en",
  onResult,
  onOpenQuestion,
}: {
  question: SpineQuestion;
  /** false = student mode: no db ids, soft failure state, no mastery deltas */
  debug?: boolean;
  /** RTL/Arabic-script subject — student-mode strings render in Arabic, not English */
  lang?: "en" | "ar";
  onResult: (result: AttemptResult, q: SpineQuestion) => void;
  onOpenQuestion?: (qid: string) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [numeric, setNumeric] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [answerShown, setAnswerShown] = useState(false);
  const shownAt = useRef(Date.now());

  // `choices` carries the lettered options for an MCQ and the stored
  // construction for a widget; narrow once rather than at each use.
  const widgetSpec =
    q.questionType === "widget" && q.choices && !Array.isArray(q.choices)
      ? (q.choices as WidgetQuestionSpec)
      : null;

  const submit = async (widget?: WidgetOutcome) => {
    const given = widget
      ? widget.given
      : q.questionType === "mcq"
        ? choice
        : numeric.trim();
    if (!given || busy || result) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: q.id,
          givenAnswer: given,
          timeMs: Date.now() - shownAt.current,
          // A widget reports WHAT it built; the server decides whether that is
          // right and what it means. The predicate never carries a verdict
          // (ADR-0009) — `correct` on the outcome is for the widget's own
          // local feedback, and the server re-derives it from the stored
          // question's own correct_answer.
          ...(widget ? { predicate: widget.predicate } : {}),
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const r: AttemptResult = await res.json();
      setResult(r);
      onResult(r, q);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="anim-pop my-2 overflow-hidden rounded-lg border border-accent/40 bg-card shadow-[0_10px_24px_-16px_rgba(13,74,66,0.5)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-accent-wash px-3.5 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-accent-deep">
          ⚡ live question · pushed by the tutor
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={`rounded border px-1.5 py-px font-mono text-[8.5px] uppercase tracking-[0.1em] ${tierStyle[q.tier]}`}
          >
            {q.tier}
          </span>
          {debug && (
            <span className="font-mono text-[9px] text-ink-faint">
              {q.id} · p.{q.provenance.sourcePage ?? "—"}
            </span>
          )}
        </span>
      </div>

      <div className="px-3.5 py-3">
        <p className="tex-block text-[13.5px] leading-relaxed text-ink">
          <TeX text={q.stem} />
        </p>

        {!result && (
          <div className="mt-3">
            {q.questionType === "widget" ? (
              // A WIDGET IS A QUESTION (ADR-0009), so it arrives through the
              // same `{{show_question:…}}` directive and the same selector as
              // everything else — no parallel push path, no second registry.
              // The stored spec lives in `choices`; the construction the
              // student makes IS the answer, so there is no submit button.
              <MathWidget
                name={widgetSpec?.kind ?? ""}
                payload={{ ...(widgetSpec?.spec ?? {}), prompt: q.stem }}
                onOutcome={(outcome) => void submit(outcome)}
                fallback={
                  <p className="rounded-md border border-gold/50 bg-gold-wash px-3 py-2 text-[12.5px] text-gold">
                    This construction could not be set up. Ask for another question.
                  </p>
                }
              />
            ) : q.questionType === "mcq" && q.choices ? (
              <div className="grid gap-1.5">
                {mcqChoices(q)!.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setChoice(c.key)}
                    disabled={busy}
                    className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-[12.5px] transition-all duration-150 play-pressable sticker-shadow-sm ${
                      choice === c.key
                        ? "border-ink bg-ink/5 shadow-[0_0_0_1px_var(--ink)]"
                        : "border-line bg-card hover:border-ink/40"
                    }`}
                  >
                    <span
                      className={`flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold ${
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
                placeholder="Type the answer…"
                className="w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            )}
            <div className="mt-2.5 flex items-center gap-3">
              <button
                onClick={() => void submit()}
                disabled={
                  busy || (q.questionType === "mcq" ? !choice : !numeric.trim())
                }
                className="rounded-full bg-accent-deep px-4 py-1.5 text-[11.5px] font-semibold text-paper transition-all duration-150 enabled:hover:-translate-y-px disabled:opacity-35 play-pressable sticker-shadow-sm"
              >
                {busy ? "Checking…" : "Submit answer"}
              </button>
              {error && (
                <span className="text-[11px] text-rust">{error}</span>
              )}
            </div>
          </div>
        )}

        {result && (
          <div
            className={`anim-pop mt-3 rounded-md border px-3 py-2.5 ${
              result.isCorrect
                ? "border-accent/45 bg-accent-wash"
                : "border-rust/40 bg-rust-wash/60"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                dir="auto"
                className={`font-display text-[14px] font-medium ${
                  result.isCorrect ? "text-accent-deep" : "text-rust anim-nudge"
                }`}
              >
                {result.isCorrect
                  ? debug
                    ? "Correct ✓"
                    : lang === "ar"
                      ? "صح عليك ✓"
                      : "Correct ✓"
                  : debug
                    ? // A widget's `correct_answer` is the reserved predicate
                      // "ok" — machinery, not an answer. Printing it tells the
                      // student nothing and looks broken; the construction they
                      // were asked for is already in the stem.
                      q.questionType === "widget"
                      ? "Not yet"
                      : `Not quite — answer: ${result.correctAnswer}`
                    : lang === "ar"
                      ? "مش مظبوطة — تعالى نشوفها مع بعض"
                      : "Not quite — let's look at it together"}
              </span>
              {debug && (
                <span className="font-mono text-[10px] text-ink-soft">
                  mastery {pct(result.oldScore)} →{" "}
                  <strong
                    className={
                      result.newScore >= result.oldScore
                        ? "text-accent-deep"
                        : "text-rust"
                    }
                  >
                    {pct(result.newScore)}
                  </strong>
                </span>
              )}
            </div>
            {/* student mode: the correct letter stays withheld until the
                explanation lands — a quiet affordance reveals it on demand */}
            {!debug && !result.isCorrect && q.questionType !== "widget" && (
              <p
                dir={lang === "ar" ? "rtl" : "ltr"}
                className="mt-1.5 text-[12px] text-ink-soft"
              >
                {answerShown ? (
                  lang === "ar" ? (
                    <>
                      الإجابة الصح: <strong>{result.correctAnswer}</strong>
                    </>
                  ) : (
                    <>
                      Correct answer: <strong>{result.correctAnswer}</strong>
                    </>
                  )
                ) : (
                  <button
                    onClick={() => setAnswerShown(true)}
                    className="underline decoration-dotted underline-offset-2 hover:text-accent-deep"
                  >
                    {lang === "ar" ? "شوف الإجابة الصح" : "Show the answer"}
                  </button>
                )}
              </p>
            )}
            {/* THE REFUTATION — the entry authored for the error this student
                actually made, not the question's generic solution. Before
                ADR-0009 this was looked up, logged to analytics and then
                dropped, so the text written for the mistake reached a
                dashboard and never reached the student. */}
            {result.refutation && !result.isCorrect && (
              <div className="mt-2 rounded-md border border-accent/35 bg-accent-wash px-3 py-2.5">
                <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-accent-deep">
                  why that happened
                </p>
                <ol className="mt-1.5 grid gap-1.5 font-read">
                  {result.refutation.steps.map((st) => (
                    <li key={st.step} className="text-[13px] leading-relaxed text-ink">
                      {st.text_md}
                    </li>
                  ))}
                </ol>
                {debug && (
                  <p className="mt-2 font-mono text-[9.5px] text-ink-faint">
                    {result.diagnosis?.misconceptionId} · via {result.diagnosis?.via}
                    {result.refutation.reviewed ? "" : " · unreviewed"}
                  </p>
                )}
              </div>
            )}
            {debug && !result.isCorrect && onOpenQuestion && (
              <button
                onClick={() => onOpenQuestion(q.id)}
                className="mt-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-accent-deep underline decoration-dotted underline-offset-2 hover:text-accent"
              >
                open canonical solution ↗
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

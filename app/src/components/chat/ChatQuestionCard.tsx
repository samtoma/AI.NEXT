"use client";

import { useRef, useState } from "react";
import { mcqChoices } from "@/lib/types";
import type { AttemptResult, SpineQuestion, WidgetQuestionSpec } from "@/lib/types";
import { MathWidget } from "@/components/student/widgets/render-math-widget";
import type { WidgetOutcome } from "@/lib/widget-predicates";
import { TeX } from "@/components/TeX";
import { pct } from "@/lib/mastery";
import { track } from "@/lib/ga";
import {
  BUTTON_PRIMARY,
  BUTTON_TERTIARY,
  HONEY_BAND,
  STICKER_PANEL,
  STROKE,
  STROKE_SM,
  STROKE_WIDTH_SM,
  TIER_INK,
  VERDICT_INK,
  cx,
} from "@/components/sticker";

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
    // The audience layer learns that an attempt was submitted in a chat card.
    // Not the question, not the answer, not whether it was right (lib/ga.ts).
    track("retrieval_attempt_submitted", { surface: "chat_card" });
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
    <div className={cx(STICKER_PANEL, "anim-pop my-2 overflow-hidden")}>
      <div className={cx(HONEY_BAND, "flex flex-wrap items-center justify-between gap-2 px-3.5 py-2")}>
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-accent-deep">
          ⚡ live question · pushed by the tutor
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={cx(
              STROKE_WIDTH_SM,
              "rounded-[var(--play-radius-pill)] px-2 py-px font-mono text-[0.72rem] uppercase tracking-[0.1em]",
              TIER_INK[q.tier]
            )}
          >
            {q.tier}
          </span>
          {debug && (
            <span className="font-mono text-[0.72rem] text-ink-faint">
              {q.id} · p.{q.provenance.sourcePage ?? "—"}
            </span>
          )}
        </span>
      </div>

      <div className="px-3.5 py-3">
        <p className="tex-block text-[1rem] text-ink">
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
                // NO PROMPT. The card has already rendered the stem above,
                // with its maths typeset and its markdown resolved. Passing
                // `q.stem` in here printed it a SECOND time as a raw string —
                // "Circle $M$ has radius $5$. Construct a **radius**" — sitting
                // under a correctly typeset copy of itself. The widget keeps
                // its own prompt for standalone use; the dev fixture passes one.
                payload={widgetSpec?.spec ?? {}}
                hostShowsPrompt
                onOutcome={(outcome) => void submit(outcome)}
                fallback={
                  <p
                    className={cx(
                      STROKE_SM,
                      "rounded-[var(--play-radius-sm)] bg-card-warm px-3 py-2 text-[0.85rem] text-[color:var(--play-text-amber-warm)]"
                    )}
                  >
                    This construction could not be set up. Ask for another question.
                  </p>
                }
              />
            ) : q.questionType === "mcq" && q.choices ? (
              <div className="grid gap-2">
                {mcqChoices(q)!.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setChoice(c.key)}
                    disabled={busy}
                    // The answer-option anatomy: 2.5px ink, white, 52px,
                    // Baloo 700; Selected is the Honey fill, keeping its
                    // stroke and shadow. `text-start`, not `text-left`, so an
                    // Arabic option reads from the right.
                    className={cx(
                      STROKE_SM,
                      "flex min-h-[var(--noor-touch-min)] items-center gap-2.5 rounded-[var(--play-radius-sm)] px-3 py-2 text-start",
                      "font-display text-[1.05rem] font-bold text-ink sticker-shadow-sm play-pressable",
                      choice === c.key ? "bg-card-warm" : "bg-card"
                    )}
                  >
                    <span
                      className={cx(
                        "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[0.72rem] font-medium",
                        choice === c.key
                          ? "bg-card text-[color:var(--play-text-amber-warm)]"
                          : "bg-[var(--play-inactive-fill)] text-[color:var(--play-text-muted)]"
                      )}
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
                className={cx(
                  STROKE,
                  "min-h-[var(--noor-touch-min)] w-full rounded-[var(--play-radius-sm)] bg-card px-4 font-mono text-[1rem] text-ink outline-none placeholder:text-ink-faint sticker-shadow-sm"
                )}
              />
            )}
            {/* A widget question has nothing to submit: the construction IS
                the answer and posts itself the moment the student commits to
                it. This button sat here permanently disabled, which reads as a
                broken page rather than as "not applicable". */}
            {q.questionType !== "widget" && (
              <div className="mt-2.5 flex items-center gap-3">
                <button
                  onClick={() => void submit()}
                  disabled={
                    busy || (q.questionType === "mcq" ? !choice : !numeric.trim())
                  }
                  // the card's one action — amber; disabled, it goes white
                  // and dashed rather than dimming (handoff, Buttons)
                  className={cx(BUTTON_PRIMARY, "disabled:bg-card")}
                >
                  {busy ? "Checking…" : "Submit answer"}
                </button>
              </div>
            )}
            {/* Outside the button row, because a widget posts itself: hiding
                the row for widgets took the only error surface with it, so a
                failed widget attempt reported nothing at all and the student
                was left looking at a construction that had silently not
                counted. Every question type can fail the same way, so the
                message belongs to the card, not to the button. */}
            {error && (
              <p className="mt-2.5 text-[0.85rem] text-[color:var(--play-text-muted)]" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        {result && (
          <div
            // Correct is the leaf playmate and pops; wrong greys out and
            // nudges. There is no red verdict (handoff, Answer options).
            className={cx(
              STROKE_WIDTH_SM,
              "anim-pop mt-3 rounded-[var(--play-radius-sm)] px-3 py-2.5",
              result.isCorrect ? VERDICT_INK.correct : VERDICT_INK.wrong
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                dir="auto"
                className={cx(
                  "font-display text-[1.05rem] font-bold",
                  !result.isCorrect && "anim-nudge"
                )}
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
                <span className="font-mono text-[0.72rem]">
                  mastery {pct(result.oldScore)} →{" "}
                  <strong>
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
                className="mt-1.5 text-[0.85rem]"
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
                    className={BUTTON_TERTIARY}
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
              <div
                className={cx(STROKE_SM, "mt-2 rounded-[var(--play-radius-sm)] bg-card px-3 py-2.5 text-ink")}
              >
                <p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-accent-deep">
                  why that happened
                </p>
                <ol className="mt-1.5 grid gap-1.5 font-read">
                  {result.refutation.steps.map((st) => (
                    <li key={st.step} className="text-[1rem] text-ink">
                      <TeX text={st.text_md} />
                    </li>
                  ))}
                </ol>
                {debug && (
                  <p className="mt-2 font-mono text-[0.72rem] text-ink-faint">
                    {result.diagnosis?.misconceptionId} · via {result.diagnosis?.via}
                  </p>
                )}
              </div>
            )}
            {debug && !result.isCorrect && onOpenQuestion && (
              <button
                onClick={() => onOpenQuestion(q.id)}
                className="mt-1.5 font-mono text-[0.72rem] font-medium uppercase tracking-[0.1em] text-[color:var(--play-text-link)] underline decoration-dotted underline-offset-2"
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

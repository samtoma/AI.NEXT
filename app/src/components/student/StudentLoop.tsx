"use client";

import { useMemo, useRef, useState } from "react";
import { mcqChoices } from "@/lib/types";
import Link from "next/link";
import type { AttemptResult, PlanItem, PlanReason } from "@/lib/types";
import { stepText } from "@/lib/types";
import type { Cite } from "@/lib/chat-parse";
import { TeX } from "@/components/TeX";
import { ChatCore } from "@/components/chat/ChatCore";
import { MathAnswerInput } from "@/components/chat/MathAnswerInput";
import { markerInputOf } from "@/lib/answer-marker";
import { AttemptRetryError, submitAttempt } from "@/lib/attempts-client";
import { FeedbackPrompt } from "@/components/student/FeedbackPrompt";
import { masteryColor, masteryLabel, pct } from "@/lib/mastery";
import { track } from "@/lib/ga";
import {
  BADGE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  HEADING,
  HONEY_BAND,
  STICKER_CARD,
  STICKER_PANEL,
  STROKE,
  STROKE_SM,
  STROKE_WIDTH,
  STROKE_WIDTH_SM,
  VERDICT_INK,
  cx,
} from "@/components/sticker";

/**
 * Noor Play anatomy throughout (`components/sticker.ts`): the reason tags are
 * badges told apart by their WORDS, with the Honey band reserved for the one
 * worth attention; there is no red — "weakest" used to be the Ledger's rust.
 */
const REASON_META: Record<
  PlanReason,
  { label: string; className: string; why: string }
> = {
  weakest: {
    label: "weakest topic",
    className: "bg-card-warm text-ink",
    why: "lowest mastery with prerequisites met",
  },
  review: {
    label: "spaced review",
    className: "bg-card text-ink",
    why: "strong topic — keep it warm",
  },
  stretch: {
    label: "stretch",
    className: "bg-card text-ink",
    why: "one step past the frontier",
  },
};

/**
 * One pip in the session's progress row. Correct is the leaf playmate, a
 * miss is the inactive grey (never red — review 2026-09-23, F21: this read
 * `--m-low`, which is red under the Ledger palette), the current question is
 * ink, and the ones still to come are empty white.
 */
function pipClass(state: "correct" | "wrong" | "current" | "todo") {
  const ink = {
    correct: "border-ink bg-[var(--play-leaf)]",
    wrong: "border-[color:var(--play-inactive-border)] bg-[var(--play-inactive-fill)]",
    current: "border-ink bg-ink",
    todo: "border-ink bg-card",
  }[state];
  return cx(
    STROKE_WIDTH_SM,
    "h-3.5 w-7 rounded-[var(--play-radius-pill)] transition-colors duration-300",
    ink
  );
}

type Phase = "plan" | "asking" | "correct" | "explain" | "summary";

interface Recorded {
  item: PlanItem;
  result: AttemptResult;
}

export function StudentLoop({
  plan,
  studentName,
  bookCite = null,
}: {
  plan: PlanItem[];
  studentName: string;
  /** how a page receipt names the book (`CourseDef.cite`); `null` when the
   *  plan's courses cite different books, or none (backlog #36) */
  bookCite?: { name: string; edition: string } | null;
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
  // The marker's message from the last submit, when the answer came back for
  // re-entry (T416, FR-4320): never a verdict, so it is cleared on every fresh
  // question and on a graded submit, never on a keystroke.
  const [reentry, setReentry] = useState<string | null>(null);
  const shownAt = useRef<number>(Date.now());

  const item = plan[idx];
  const lastResult = records[records.length - 1]?.result;
  // A typed maths question (FR-4320): its `choices` carry a marker spec, and
  // it is answered in the maths input — same rule ChatQuestionCard applies.
  const markerInput = useMemo(
    () => markerInputOf({ questionType: item.questionType, choices: item.choices }),
    [item.questionType, item.choices]
  );

  // The practice loop is the one surface where a question being PUT IN FRONT of
  // a student is a distinct client moment, so it is the only place
  // `retrieval_attempt_started` can honestly be sent (lib/ga.ts). No question
  // id, no objective id — the practice surface and nothing more.
  const begin = () => {
    shownAt.current = Date.now();
    track("retrieval_attempt_started", { surface: "practice" });
    setPhase("asking");
  };

  const advance = () => {
    setChoice(null);
    setNumeric("");
    setReentry(null);
    setAskOpen(false);
    if (idx + 1 >= plan.length) {
      setPhase("summary");
    } else {
      setIdx((i) => i + 1);
      shownAt.current = Date.now();
      track("retrieval_attempt_started", { surface: "practice" });
      setPhase("asking");
    }
  };

  const submit = async () => {
    const given = item.questionType === "mcq" ? choice : numeric.trim();
    if (!given || busy) return;
    setLastGiven(given);
    setBusy(true);
    setError(null);
    track("retrieval_attempt_submitted", { surface: "practice" });
    try {
      const result = await submitAttempt({
        questionId: item.questionId,
        givenAnswer: given,
        timeMs: Date.now() - shownAt.current,
      });
      setReentry(null);
      setRecords((r) => [...r, { item, result }]);
      setPhase(result.isCorrect ? "correct" : "explain");
    } catch (e) {
      // The maths-expression marker sent the answer back for re-entry (T416,
      // FR-4320): nothing was recorded — no attempt, no mastery change. Not a
      // wrong answer and not a request failure, so it gets its own message and
      // keeps what the student typed, rather than surfacing as "API 422".
      if (e instanceof AttemptRetryError) setReentry(e.retry.message);
      else setError(e instanceof Error ? e.message : "request failed");
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
          {/* English leads on the LTR shell (decisions.md Q6); the Arabic sits
              beside it at the same size and weight, not beneath it at half.
              The gap is flex, not a margin: margin-inline-start on a dir="rtl"
              span resolves to its right edge and the two scripts render flush. */}
          <h1 className={cx(HEADING, "flex flex-wrap items-baseline gap-x-3 text-[1.9rem] md:text-[2.4rem]")}>
            <span>Today&apos;s Plan</span>
            <span className="text-ink-faint">/</span>
            <span dir="rtl" className="text-accent-deep">خطة اليوم</span>
          </h1>
          {phase !== "plan" && phase !== "summary" && (
            <div className="flex items-center gap-1.5">
              {plan.map((p, i) => {
                const rec = records[i];
                return (
                  <span
                    key={p.questionId}
                    className={pipClass(
                      rec
                        ? rec.result.isCorrect
                          ? "correct"
                          : "wrong"
                        : i === idx
                          ? "current"
                          : "todo"
                    )}
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
            className="anim-rise font-read text-[1rem] leading-relaxed text-ink-soft"
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
                className={cx(STICKER_PANEL, "anim-rise flex items-center gap-4 px-5 py-3.5")}
                style={{ animationDelay: `${120 + i * 70}ms` }}
              >
                <span className="font-display text-[1.5rem] font-extrabold text-ink-faint">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-display text-[1.05rem] font-bold text-ink">
                      {p.loLabel}
                    </span>
                    <span className={cx(BADGE, meta.className)}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[0.72rem] font-medium text-ink-faint">
                    {/* band, not percentage — same reason as MasteryDelta below */}
                    {meta.why} · {masteryLabel(p.loScore, p.loScore > 0)} · {p.tier} tier
                  </p>
                </div>
                {/* 0 means no evidence, not a bad result: the not-started step. */}
                <span
                  className={cx(STROKE_SM, "h-4 w-4 shrink-0 rounded-[var(--play-radius-pill)]")}
                  style={{
                    backgroundColor: masteryColor(p.loScore, 1, p.loScore > 0),
                  }}
                />
              </div>
            );
          })}
          <div className="anim-rise pt-3" style={{ animationDelay: "520ms" }}>
            <button onClick={begin} className={cx(BUTTON_PRIMARY, "w-full")}>
              Start the session →
            </button>
          </div>
        </section>
      )}

      {/* ------- question ------- */}
      {(phase === "asking" || phase === "correct" || phase === "explain") &&
        item && (
          <section key={item.questionId} className="anim-pop">
            <div className={cx(STICKER_CARD, "overflow-hidden")}>
              <div className={cx(HONEY_BAND, "flex flex-wrap items-center justify-between gap-2 px-6 py-3")}>
                <div className="flex items-center gap-2.5">
                  <span className="font-display text-[1rem] font-bold text-ink">
                    {item.loLabel}
                  </span>
                  <span className={cx(BADGE, REASON_META[item.reason].className)}>
                    {REASON_META[item.reason].label}
                  </span>
                </div>
                <span className="font-mono text-[0.72rem] font-medium text-ink-faint">
                  {item.questionId} · p.{item.sourcePage ?? "—"} · {item.tier}
                </span>
              </div>

              <div className="px-6 py-6">
                <p className="tex-block text-[1.15rem] leading-relaxed text-ink">
                  <TeX text={item.stem} />
                </p>

                {/* answers */}
                {phase === "asking" && (
                  <div className="mt-6">
                    {item.questionType === "mcq" && item.choices ? (
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {mcqChoices(item)!.map((c) => (
                          // The handoff's answer option: 2.5px ink, 3px hard
                          // shadow, a real 56px target; SELECTED fills Honey
                          // and keeps its stroke and shadow.
                          <button
                            key={c.key}
                            onClick={() => setChoice(c.key)}
                            aria-pressed={choice === c.key}
                            className={cx(
                              STROKE_SM,
                              "flex min-h-[56px] items-center gap-3 rounded-[var(--play-radius-sm)] px-4 py-3 text-start font-display text-[1.1rem] font-bold text-ink sticker-shadow-sm play-pressable",
                              choice === c.key ? "bg-card-warm" : "bg-card"
                            )}
                          >
                            <span
                              className={cx(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] font-mono text-[0.85rem] font-medium transition-colors",
                                choice === c.key
                                  ? "bg-ink text-paper"
                                  : "bg-[var(--play-inactive-fill)] text-[color:var(--play-text-muted)]"
                              )}
                            >
                              {c.key}
                            </span>
                            <TeX text={c.text} />
                          </button>
                        ))}
                      </div>
                    ) : markerInput ? (
                      <MathAnswerInput
                        input={markerInput}
                        value={numeric}
                        onChange={setNumeric}
                        onSubmit={() => void submit()}
                        disabled={busy}
                        reentry={reentry}
                      />
                    ) : (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={numeric}
                        onChange={(e) => setNumeric(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && submit()}
                        placeholder="Type your answer…"
                        autoFocus
                        className={cx(STROKE, "min-h-[var(--noor-touch-min)] w-full max-w-xs rounded-[var(--play-radius-sm)] bg-card px-4 py-3 font-mono text-lg text-ink placeholder:text-ink-faint")}
                      />
                    )}

                    <div className="mt-6 flex items-center gap-4">
                      <button
                        onClick={submit}
                        disabled={
                          busy ||
                          (item.questionType === "mcq" ? !choice : !numeric.trim())
                        }
                        className={cx(BUTTON_PRIMARY, "disabled:bg-[var(--play-inactive-fill)]")}
                      >
                        {busy ? "Checking…" : "Submit answer"}
                      </button>
                      {error && (
                        <span className="text-[0.9rem] font-bold text-[color:var(--play-text-muted)]">
                          {error} — try again
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* correct */}
                {phase === "correct" && lastResult && (
                  // Correct is the leaf playmate with its paired ink (handoff).
                  <div
                    className={cx(
                      STROKE_WIDTH,
                      VERDICT_INK.correct,
                      "anim-pop mt-6 rounded-[var(--play-radius)] px-5 py-4"
                    )}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-display text-[1.5rem] font-extrabold leading-[1.2]">
                        Correct — nicely done. ✓
                      </p>
                      <MasteryDelta result={lastResult} />
                    </div>
                    <button onClick={advance} className={cx(BUTTON_PRIMARY, "mt-4")}>
                      {idx + 1 >= plan.length ? "Finish session →" : "Next question →"}
                    </button>
                  </div>
                )}

                {/* wrong → grounded explanation */}
                {phase === "explain" && lastResult && (
                  // Wrong greys out and nudges — never red (handoff).
                  <div
                    className={cx(
                      STROKE_WIDTH,
                      VERDICT_INK.wrong,
                      "anim-pop mt-6 rounded-[var(--play-radius)] px-5 py-4"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-display text-[1.25rem] font-extrabold leading-[1.25] text-ink anim-nudge">
                        Not quite — let&apos;s look at it step by step.
                      </p>
                      <span className={cx(BADGE, "bg-card text-ink")}>
                        grounded in the worked solution ✓
                      </span>
                    </div>
                    <ol className="mt-4 space-y-2.5">
                      {lastResult.solution.map((s, i) => (
                        <li
                          key={s.step}
                          className={cx(STROKE_SM, "anim-rise flex gap-3 rounded-[var(--play-radius-sm)] bg-card px-4 py-3")}
                          style={{ animationDelay: `${200 + i * 550}ms` }}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] bg-ink font-mono text-[0.8rem] font-medium text-paper">
                            {s.step}
                          </span>
                          <span className="tex-block pt-0.5 text-[1rem] leading-relaxed text-ink font-read">
                            <TeX text={stepText(s)} />
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
                          <button onClick={() => setAskOpen(true)} className={BUTTON_SECONDARY}>
                            Still confused? Ask the tutor ✦
                          </button>
                        )}
                        <button onClick={advance} className={BUTTON_PRIMARY}>
                          Got it {idx + 1 >= plan.length ? "— finish →" : "→"}
                        </button>
                      </div>
                    </div>

                    {askOpen && (
                      <div className={cx(STICKER_PANEL, "anim-pop mt-4 overflow-hidden")}>
                        <div className={cx(HONEY_BAND, "flex flex-wrap items-center justify-between gap-2 px-4 py-2")}>
                          <span className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.1em] text-ink">
                            ✦ AI tutor · grounded in the canonical steps only
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
                              "I still don't get it — try it yet another way",
                            ]}
                            placeholder="Ask about this question…"
                            resolveCite={(c: Cite) =>
                              c.kind === "page"
                                ? bookCite
                                  ? {
                                      title: bookCite.name,
                                      sub: `${bookCite.edition} · page ${c.id}`,
                                    }
                                  : { title: `Page ${c.id}`, sub: "the lesson's book" }
                                : c.kind === "q"
                                  ? {
                                      title: "This question",
                                      sub: `${c.id} · worked solution`,
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
            <p className="mt-3 text-center font-mono text-[0.72rem] font-medium uppercase tracking-[0.1em] text-ink-faint">
              every attempt is written to attempts + mastery (temporal) ·
              wrong answers log a grounded explanation
            </p>
          </section>
        )}

      {/* ------- summary ------- */}
      {phase === "summary" && (
        <section className="space-y-5">
          <div className={cx(STICKER_CARD, "anim-pop px-7 py-6")}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-display text-[1.5rem] font-extrabold leading-[1.2] text-ink">
                Session complete
              </h2>
              <p className="font-mono text-[0.9rem] font-medium text-ink-soft">
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
                    <span className="w-56 truncate font-display text-[0.95rem] font-bold text-ink">
                      {d.label}
                    </span>
                    <div
                      className={cx(
                        STROKE_SM,
                        "relative h-4 flex-1 overflow-hidden rounded-[var(--play-radius-pill)] bg-card"
                      )}
                    >
                      {/* where it started, as a ghost of the same ramp step */}
                      <div
                        className="absolute h-full rounded-[var(--play-radius-pill)]"
                        style={{
                          width: pct(d.first),
                          backgroundColor: masteryColor(d.first, 0.35),
                        }}
                      />
                      <div
                        className="absolute h-full rounded-[var(--play-radius-pill)] transition-all duration-1000 ease-out"
                        style={{
                          width: pct(d.last),
                          backgroundColor: masteryColor(d.last),
                        }}
                      />
                    </div>
                    <span
                      className={cx(
                        "w-20 text-end font-mono text-[0.85rem] font-medium",
                        delta >= 0
                          ? "text-[color:var(--play-on-leaf-dim)]"
                          : "text-[color:var(--play-text-muted)]"
                      )}
                    >
                      {delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(delta * 100))} pts
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="anim-rise flex flex-wrap gap-3" style={{ animationDelay: "250ms" }}>
            <Link href="/spine" className={cx(BUTTON_PRIMARY, "flex-1")}>
              See it on the graph →
            </Link>
            <button onClick={() => window.location.reload()} className={BUTTON_SECONDARY}>
              New plan
            </button>
          </div>

          {/* "The end of a session", the first of the three moments Samuel
              named (FR-2801). It sits AFTER the two doors, deliberately: a
              student who wants to leave has already passed everything she
              needs before she meets the question, which is most of what
              "non-intrusive" means in practice. It renders nothing at all
              unless the server says to ask — see `FeedbackPrompt`.

              No `rtl` prop: the practice plan is not a lesson and carries no
              subject of its own — items can come from more than one course —
              so there is no registered direction to read. It therefore takes
              the product's default (constitution V: English LTR for MVP 1.0),
              which is the same answer this whole screen already gives. When
              the practice loop learns which subject it is in, this is one
              prop. */}
          <FeedbackPrompt moment="session_ended" />
        </section>
      )}
    </main>
  );
}

/**
 * What changed, in bands — never in percentages.
 *
 * This component is the literal source of feedback #17: it printed
 * "mastery 30% → 69%" after every answer, so a student watching two answers
 * in a row saw a gauge swing 39 points and then back. Nothing was wrong with
 * the model — 0.30 → correct → 0.69 → incorrect → 0.30 is exactly right for
 * BKT with P(G)=0.20 and P(S)=0.10, and that is the problem: P(L) is a BELIEF
 * about a student, and a belief held after two observations is not a score
 * anyone should be shown to the nearest point.
 *
 * So the same decision the check-in card already made (#42, FR-1003) applies
 * here: the named band, never the number. The band moves when the teaching
 * should change, which is the only movement that means anything to a student,
 * and a band that has not moved says so plainly instead of implying nothing
 * happened.
 */
function MasteryDelta({ result }: { result: AttemptResult }) {
  const before = masteryLabel(result.oldScore);
  const after = masteryLabel(result.newScore);
  const moved = before !== after;
  // FR-1010: the signature spring is reserved for exactly this transition,
  // and had never once been spent because nothing rendered a band change.
  const isMastered = moved && after === "mastered";

  return (
    <span
      // No colour of its own: it inherits the panel's paired foreground, so
      // it is legible on the leaf "correct" panel and the grey "wrong" one.
      className={cx(
        "inline-flex items-center gap-2 font-mono text-[0.72rem] font-medium uppercase tracking-[0.1em]",
        isMastered && "anim-mastered"
      )}
    >
      {moved ? (
        <>
          <span>{before}</span>
          <svg width="14" height="8" viewBox="0 0 14 8" fill="none" aria-hidden="true">
            <path d="M0 4h12m0 0L9 1m3 3L9 7" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <strong className="font-bold">{after}</strong>
        </>
      ) : (
        <span>still {after}</span>
      )}
    </span>
  );
}

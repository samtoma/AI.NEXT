"use client";

import { useState } from "react";
import { ChatQuestionCard } from "@/components/chat/ChatQuestionCard";
import type { AttemptResult, SpineQuestion, WidgetQuestionSpec } from "@/lib/types";

/**
 * Real STORED widget questions, answered through the ordinary question card.
 *
 * The point of this page is that there is nothing special on it. These rows
 * came out of `questions` the way any other item does; the card that renders
 * them is the card that renders multiple choice; the POST goes to the same
 * `/api/attempts`. That is the claim ADR-0009 makes, and this is where it is
 * either true or it is not.
 *
 * What each card shows underneath is the part that was impossible before: the
 * objective the construction is bound to, the predicates it can emit, and the
 * misconception each one resolves to.
 */
export function StoredWidgets({ questions }: { questions: SpineQuestion[] }) {
  const [results, setResults] = useState<
    { qid: string; correct: boolean; mid: string | null; score: number }[]
  >([]);

  return (
    <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {questions.map((q) => {
          const w = (!Array.isArray(q.choices) ? q.choices : null) as WidgetQuestionSpec | null;
          return (
            <section key={q.id} className="rounded-xl border border-line bg-card-warm p-3.5">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent-deep">
                  {q.id}
                </span>
                <span className="font-mono text-[10px] text-ink-faint">
                  {q.loId} · {q.tier} · {w?.kind}
                </span>
              </div>

              <ChatQuestionCard
                question={q}
                // Operator view: show the mastery delta and the misconception
                // id behind the refutation. A student sees the refutation
                // without the machinery.
                debug
                onResult={(r: AttemptResult) =>
                  setResults((prev) => [
                    {
                      qid: q.id,
                      correct: r.isCorrect,
                      mid: r.diagnosis?.misconceptionId ?? null,
                      score: r.newScore,
                    },
                    ...prev,
                  ])
                }
              />

              <div className="mt-2 rounded-md bg-paper-deep px-2.5 py-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                  predicates → misconceptions
                </p>
                <ul className="mt-1 grid gap-0.5">
                  {(w?.diagnostics ?? []).map((d) => (
                    <li key={d.predicate} className="font-mono text-[10.5px] leading-relaxed text-ink-soft">
                      <span className="text-gold">{d.predicate}</span> →{" "}
                      <span className="text-accent-deep">{d.misconception_id}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
      </div>

      <section className="mt-7 rounded-xl border border-line bg-card p-4">
        <h2 className="font-display text-[17px] font-semibold">What the database recorded</h2>
        <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-ink-soft">
          Each row is a real attempt: graded on the server against the stored
          question&apos;s own answer, diagnosed from its own predicate map, tagged{" "}
          <code className="font-mono text-[12px]">modality=&apos;widget&apos;</code>, and applied to
          the BKT estimate for the objective.
        </p>
        {results.length === 0 ? (
          <p className="mt-3 font-mono text-[11.5px] text-ink-faint">
            nothing yet — answer a construction above
          </p>
        ) : (
          <ul className="mt-3 grid gap-1.5">
            {results.map((r, i) => (
              <li key={i} className="rounded-md bg-paper-deep px-3 py-2 font-mono text-[11.5px] text-ink">
                <span className="text-ink-faint">{r.qid}</span>{" "}
                <span className={r.correct ? "text-accent-deep" : "text-gold"}>
                  {r.correct ? "correct" : "not yet"}
                </span>
                {r.mid && <> · diagnosed <span className="text-accent-deep">{r.mid}</span></>}
                {" · "}mastery now {r.score.toFixed(4)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

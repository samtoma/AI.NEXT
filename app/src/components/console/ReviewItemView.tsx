"use client";

import { useState } from "react";

import { Chip } from "@/components/console/ui";
import { MathWidget } from "@/components/student/widgets/render-math-widget";
import {
  HONEY_BAND,
  STICKER_PANEL,
  STROKE_SM,
  STROKE_WIDTH_SM,
  TIER_INK,
  cx,
} from "@/components/sticker";
import { TeX } from "@/components/TeX";
import { VizCard } from "@/components/viz/VizCard";
import { markerInputOf } from "@/lib/answer-marker";
import { displayStem, hasFigurePlaceholder } from "@/lib/question-figures";
import { ANSWER_ONLY_CARD_NOTE, choiceOptions, isAnswerOnly, lessSpecificKeys } from "@/lib/question-flags";
import { GATE_LABEL } from "@/lib/review-gate-records";
import {
  DECISION_LABEL,
  KIND_LABEL,
  KIND_SCOPE,
  REASON_LABEL,
  type FigurePayload,
  type QuestionPayload,
  type ReviewItemPayload,
  type TextStep,
} from "@/lib/review-gate";
import type { WidgetOutcome } from "@/lib/widget-predicates";

/**
 * One backlog item, for a reviewer (`/review`; migration 036; answer 37).
 *
 * Left: **what the student sees**, drawn with the student product's own
 * pieces — the sticker card and honey band, `<TeX>`, the book figure, the
 * live widget — so a reviewer signs the thing a child is shown, not a
 * database row. It is a picture of the card, not the card: nothing here posts
 * an attempt (the console has no student), and a widget's construction only
 * reports locally which pattern it would send, which is exactly what a
 * predicate→misconception claim is about.
 *
 * Right: **where it came from and who has checked it** — the book's page and
 * worked solution, the generated item's parent and template family, the AI
 * checks (`ai_checked_by`, a safety hold, a review note), the AI verifier's
 * reasoning on a held claim, and every earlier decision on the item.
 *
 * Console chrome (chips, panels) is the console's; the card on the left is
 * the student's. Tokens only, both sides (constitution XII).
 */
export function ReviewItemView({ item }: { item: ReviewItemPayload }) {
  return (
    <article aria-label={`${KIND_LABEL[item.kind]} ${item.ref}`}>
      <ItemHeader item={item} />
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section aria-label="As the student sees it">
          <SectionLabel>As the student sees it</SectionLabel>
          <StudentSide item={item} />
        </section>
        <section aria-label="Source and checks">
          <SectionLabel>Source and checks</SectionLabel>
          <SourceSide item={item} />
          <History item={item} />
        </section>
      </div>
    </article>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">{children}</p>;
}

function ItemHeader({ item }: { item: ReviewItemPayload }) {
  return (
    <header>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip>{KIND_LABEL[item.kind]}</Chip>
        {item.assignee === "samuel" ? <Chip tone="attention">for Samuel</Chip> : null}
        {item.readOnly ? <Chip>read only — Samuel decides</Chip> : null}
        {item.state !== "open" ? <Chip>{item.state.replace("_", " ")}</Chip> : null}
        {item.reasons.map((r, i) => (
          <span key={i} title={r.detail}>
            <Chip tone="attention">{REASON_LABEL[r.code]}</Chip>
          </span>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-ink">
        <span className="font-semibold">{item.courseLabel}</span>
        {item.moduleLabel ? <> · {item.moduleLabel}</> : null}
        {item.loLabel ? <> · {item.loLabel}</> : null}
      </p>
      <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
        {item.ref}
        {item.loId && item.loId !== item.ref ? ` · ${item.loId}` : ""}
      </p>
      <p className="mt-1.5 max-w-[90ch] text-[12.5px] text-ink-soft">{KIND_SCOPE[item.kind]}</p>
      {item.reasons.some((r) => r.detail) ? (
        <ul className="mt-1.5 grid gap-0.5 text-[12px] text-ink-soft">
          {item.reasons
            .filter((r) => r.detail)
            .map((r, i) => (
              <li key={i}>
                <span className="font-semibold">{REASON_LABEL[r.code]}:</span> {r.detail}
              </li>
            ))}
        </ul>
      ) : null}
    </header>
  );
}

/* ------------------------------------------------------- student side */

function StudentSide({ item }: { item: ReviewItemPayload }) {
  switch (item.kind) {
    case "book_question":
    case "generated_question":
    case "widget_question":
      return item.question ? <QuestionCard q={item.question} /> : <Missing />;
    case "mapping_claim":
      return item.question && item.claim ? (
        <>
          <QuestionCard q={item.question} claim={item.claim} />
          <ClaimLine item={item} />
          {item.claim.refutation.length > 0 ? (
            <Refutation title="why that happened — shown when the claim fires" steps={item.claim.refutation} />
          ) : (
            <p className="mt-2 text-[12.5px] text-ink-soft">This misconception has no refutation entry yet.</p>
          )}
        </>
      ) : (
        <Missing />
      );
    case "misconception":
      return item.misconception ? (
        <>
          <div className={cx(STICKER_PANEL, "px-3.5 py-3")}>
            <p className="font-display text-[1.05rem] font-bold text-ink">{item.misconception.label}</p>
            <p className="mt-1 text-[0.95rem] text-ink">
              <TeX text={item.misconception.description} />
            </p>
            {item.misconception.signal ? (
              <p className="mt-1.5 text-[0.85rem] text-ink-soft">
                Signal: <TeX text={item.misconception.signal} />
              </p>
            ) : null}
          </div>
          {item.misconception.refutations.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-ink-soft">No refutation entry: a student diagnosed with it is shown the worked solution instead.</p>
          ) : (
            item.misconception.refutations.map((r) => (
              <Refutation key={r.id} title="why that happened" steps={r.steps} />
            ))
          )}
        </>
      ) : (
        <Missing />
      );
    case "worked_example":
      return item.workedExample ? (
        <div className={cx(STICKER_PANEL, "overflow-hidden")}>
          <div className={cx(HONEY_BAND, "px-3.5 py-2")}>
            <span className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-accent-deep">
              {item.workedExample.entryType.replace("_", " ")}
              {item.workedExample.sourcePage != null ? ` · book p.${item.workedExample.sourcePage}` : ""}
            </span>
          </div>
          <Steps steps={item.workedExample.steps} />
        </div>
      ) : (
        <Missing />
      );
    case "objective":
      return item.objective ? (
        <div className={cx(STICKER_PANEL, "px-3.5 py-3")}>
          <p className="font-display text-[1.05rem] font-bold text-ink">
            <TeX text={item.objective.label} />
          </p>
          {item.objective.description ? (
            <p className="mt-1 text-[0.95rem] text-ink">
              <TeX text={item.objective.description} />
            </p>
          ) : null}
          <p className="mt-2 text-[0.85rem] text-ink-soft">
            {item.objective.liveQuestions} live question{item.objective.liveQuestions === 1 ? "" : "s"} teach it.
          </p>
        </div>
      ) : (
        <Missing />
      );
    case "prerequisite_link":
      return item.link ? (
        <div className={cx(STICKER_PANEL, "px-3.5 py-3 text-ink")}>
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-ink-faint">first</p>
          <p className="font-display text-[1rem] font-bold">
            <TeX text={item.link.src.label} />
          </p>
          {item.link.src.description ? (
            <p className="text-[0.9rem] text-ink-soft">
              <TeX text={item.link.src.description} />
            </p>
          ) : null}
          <p className="my-2 font-mono text-[0.8rem] text-ink-faint" aria-hidden>
            ↓ comes before
          </p>
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-ink-faint">then</p>
          <p className="font-display text-[1rem] font-bold">
            <TeX text={item.link.dst.label} />
          </p>
          {item.link.dst.description ? (
            <p className="text-[0.9rem] text-ink-soft">
              <TeX text={item.link.dst.description} />
            </p>
          ) : null}
        </div>
      ) : (
        <Missing />
      );
    case "gate_decision":
      return item.gate ? <GateDecided gate={item.gate} /> : <Missing />;
    case "figure_stand_in":
      return item.figure ? (
        <>
          <FigureView f={item.figure} />
          {item.question ? <QuestionCard q={item.question} /> : null}
        </>
      ) : (
        <Missing />
      );
  }
}

function Missing() {
  return <p className="text-[13px] text-ink-soft">This item could not be read. Skip it and tell the pipeline.</p>;
}

function Steps({ steps }: { steps: TextStep[] }) {
  if (steps.length === 0) return <p className="px-3.5 py-3 text-[0.9rem] text-ink-soft">No steps.</p>;
  return (
    <ol className="grid gap-1.5 px-3.5 py-3 font-read">
      {steps.map((s) => (
        <li key={s.step} className="text-[1rem] text-ink">
          <TeX text={s.text} />
        </li>
      ))}
    </ol>
  );
}

function Refutation({ title, steps }: { title: string; steps: TextStep[] }) {
  return (
    <div className={cx(STROKE_SM, "mt-2 rounded-[var(--play-radius-sm)] bg-card px-3 py-2.5 text-ink")}>
      <p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-accent-deep">{title}</p>
      <ol className="mt-1.5 grid gap-1.5 font-read">
        {steps.map((s) => (
          <li key={s.step} className="text-[1rem] text-ink">
            <TeX text={s.text} />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** `/book-figures/<book>/<file>` only — never an external address (services/extraction/schemas.py). */
const BOOK_FIGURE_SRC = /^\/book-figures\/[a-z0-9][a-z0-9-]*\/[A-Za-z0-9_.-]+\.(?:png|jpe?g|gif|svg|webp)$/;

function FigureView({ f }: { f: FigurePayload }) {
  if (f.kind === "book_image") {
    const src = typeof f.spec.src === "string" ? f.spec.src : "";
    const alt = typeof f.spec.alt === "string" ? f.spec.alt : "";
    const needed = typeof f.spec.native_kind_needed === "string" ? f.spec.native_kind_needed : null;
    return (
      <div className={cx(STICKER_PANEL, "my-2 max-w-[520px] overflow-hidden")}>
        <div className={cx(HONEY_BAND, "flex flex-wrap items-center justify-between gap-2 px-3.5 py-2")}>
          <span className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[color:var(--play-text-amber-warm)]">
            ✦ figure · the book&rsquo;s picture
          </span>
          <span className="font-mono text-[0.72rem]">
            {f.id}
            {f.sourcePage != null ? ` · book p.${f.sourcePage}` : ""}
          </span>
        </div>
        <div className="px-3.5 py-3">
          {BOOK_FIGURE_SRC.test(src) && !src.includes("..") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={alt} className="block h-auto max-w-full" />
          ) : (
            <p className="text-[0.85rem] text-ink-soft">The picture&rsquo;s path is not a book-figure path: {src || "none"}.</p>
          )}
          {f.caption ? <p className="mt-1.5 text-[0.85rem] text-ink-soft">{f.caption}</p> : null}
          <p className="mt-2 text-[12px] text-ink-soft">
            Stand-in until a native figure exists{needed ? ` (needs: ${needed})` : ""}.
          </p>
        </div>
      </div>
    );
  }
  return (
    <VizCard kind={f.kind} spec={f.spec} caption={f.caption ?? undefined} refId={f.id} sourcePage={f.sourcePage} />
  );
}

function QuestionCard({ q, claim }: { q: QuestionPayload; claim?: ReviewItemPayload["claim"] }) {
  const [outcome, setOutcome] = useState<WidgetOutcome | null>(null);
  const [round, setRound] = useState(0);
  const options = q.questionType === "mcq" ? choiceOptions(q.choices) : null;
  const lessSpecific = options ? lessSpecificKeys({ choices: q.choices, correct_answer: q.correctAnswer }) : new Set<string>();
  const marker = markerInputOf({ questionType: q.questionType, choices: q.choices });
  const widget =
    q.questionType === "widget" && q.choices && typeof q.choices === "object" && !Array.isArray(q.choices)
      ? (q.choices as { kind?: string; spec?: Record<string, unknown>; diagnostics?: { predicate: string; misconception_id: string }[] })
      : null;
  const tierInk = TIER_INK[(q.tier in TIER_INK ? q.tier : "standard") as keyof typeof TIER_INK];
  const answerOnly = isAnswerOnly(q.choices);
  const mcFor = (id: string | undefined) => (id ? (q.misconceptions[id]?.label ?? id) : null);

  return (
    <div className={cx(STICKER_PANEL, "overflow-hidden")}>
      <div className={cx(HONEY_BAND, "flex flex-wrap items-center justify-between gap-2 px-3.5 py-2")}>
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-accent-deep">
          {q.questionType === "widget" ? `construction · ${widget?.kind ?? "?"}` : `question · ${q.questionType}`}
        </span>
        <span className={cx(STROKE_WIDTH_SM, "rounded-[var(--play-radius-pill)] px-2 py-px font-mono text-[0.72rem] uppercase tracking-[0.1em]", tierInk)}>
          {q.tier}
        </span>
      </div>
      <div className="px-3.5 py-3">
        <p className="tex-block text-[1rem] text-ink">
          <TeX text={displayStem(q.stem)} />
        </p>
        {q.figures.map((f) => (
          <FigureView key={f.id} f={f} />
        ))}
        {hasFigurePlaceholder(q.stem) && q.figures.length === 0 ? (
          <p className="mt-1 text-[12px] text-ink-soft">The stem points at a figure and there is none: students see the words only.</p>
        ) : null}

        {widget ? (
          <div className="mt-3">
            <MathWidget
              key={round}
              name={widget.kind ?? ""}
              payload={widget.spec ?? {}}
              hostShowsPrompt
              onOutcome={(o) => setOutcome(o)}
              fallback={<p className="text-[0.85rem] text-ink-soft">This construction could not be set up — that is what a student would see.</p>}
            />
            <div className="mt-2 rounded-md bg-paper-deep px-2.5 py-2 text-[12px] text-ink-soft">
              {outcome ? (
                <>
                  Your construction reports <span className="font-mono text-ink">{outcome.predicate}</span>
                  {outcome.predicate === q.correctAnswer ? " — marked correct" : ""}
                  {(() => {
                    const d = widget.diagnostics?.find((x) => x.predicate === outcome.predicate);
                    if (d) return <> → names <span className="font-semibold text-ink">{mcFor(d.misconception_id)}</span></>;
                    if (outcome.predicate !== q.correctAnswer) return " → diagnoses nothing (the worked solution is shown)";
                    return null;
                  })()}
                  {claim && outcome.predicate === claim.predicate ? (
                    <span className="font-semibold text-ink"> · this is the claim under review</span>
                  ) : null}
                  .{" "}
                  <button type="button" className="ds-control-quiet underline" onClick={() => { setOutcome(null); setRound((n) => n + 1); }}>
                    Try again
                  </button>
                </>
              ) : (
                <>Build an answer to see which pattern it reports. Nothing is recorded.</>
              )}
            </div>
          </div>
        ) : options ? (
          <ul className="mt-3 grid gap-2">
            {options.map((c) => {
              const key = c.key.trim().toUpperCase();
              const isKey = key === q.correctAnswer.trim().toUpperCase();
              const tag = (c as { misconception_id?: string }).misconception_id;
              return (
                <li
                  key={c.key}
                  className={cx(
                    STROKE_SM,
                    "flex min-h-[var(--noor-touch-min)] flex-wrap items-center gap-2.5 rounded-[var(--play-radius-sm)] px-3 py-2",
                    "font-display text-[1.05rem] font-bold text-ink",
                    isKey ? "bg-card-warm" : "bg-card"
                  )}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--play-inactive-fill)] font-mono text-[0.72rem] font-medium text-[color:var(--play-text-muted)]">
                    {c.key}
                  </span>
                  <span className="min-w-0 flex-1">
                    <TeX text={c.text} />
                  </span>
                  {isKey ? <Chip tone="good">answer key</Chip> : null}
                  {lessSpecific.has(key) ? <Chip>true, less precise</Chip> : null}
                  {tag ? <Chip tone="attention">→ {mcFor(tag)}</Chip> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-3 rounded-md bg-paper-deep px-3 py-2 text-[0.95rem] text-ink">
            <span className="font-mono text-[0.72rem] uppercase tracking-[0.1em] text-ink-faint">
              {marker ? `typed answer · ${marker.kind}${marker.form ? ` · ${marker.form}` : ""}` : "typed answer"}
            </span>
            <div className="mt-0.5" dir="ltr">
              Answer key:{" "}
              <strong>
                {marker ? (
                  <TeX text={q.correctAnswer.includes("$") ? q.correctAnswer : `$${q.correctAnswer}$`} />
                ) : (
                  q.correctAnswer
                )}
              </strong>
            </div>
          </div>
        )}
      </div>
      {answerOnly ? (
        <p className="border-t border-line-soft px-3.5 py-2 text-[0.85rem] text-ink-soft">{ANSWER_ONLY_CARD_NOTE}</p>
      ) : q.solution.length > 0 ? (
        <div className="border-t border-line-soft">
          <p className="px-3.5 pt-2.5 font-mono text-[0.72rem] uppercase tracking-[0.14em] text-[color:var(--play-text-muted)]">
            here&apos;s how to solve it — the worked solution (v{q.solutionVersion})
          </p>
          <Steps steps={q.solution} />
        </div>
      ) : null}
    </div>
  );
}

function ClaimLine({ item }: { item: ReviewItemPayload }) {
  const c = item.claim!;
  return (
    <div className="mt-3 rounded-md border border-line bg-card px-3 py-2.5 text-[13px] text-ink">
      <p>
        When the construction reports <span className="font-mono">{c.predicate}</span>, the tutor names{" "}
        <span className="font-semibold">{c.misconception?.label ?? c.misconceptionId}</span>.
      </p>
      {c.misconception?.description ? (
        <p className="mt-1 text-[12.5px] text-ink-soft">
          <TeX text={c.misconception.description} />
        </p>
      ) : null}
      <p className="mt-1.5">
        <Chip tone={c.active ? "good" : "attention"}>{c.active ? "active for students" : "held inactive"}</Chip>
      </p>
    </div>
  );
}

/* -------------------------------------------------------- source side */

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2 border-b border-line-soft py-1.5 text-[12.5px]">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

function QuestionFacts({ q }: { q: QuestionPayload }) {
  return (
    <dl>
      <Fact label="Book">
        {q.sourcePage != null ? `p.${q.sourcePage}` : "no page"}
        {q.sourceNote ? <div className="text-ink-soft">{q.sourceNote}</div> : null}
      </Fact>
      {q.parentId ? (
        <Fact label={q.parentKind === "teaching" ? "Generated from (book teaching item)" : "Generated from"}>
          <span className="font-mono text-[11px]">{q.parentId}</span>
          {q.parentStem ? (
            <div className="mt-0.5 text-ink-soft">
              <TeX text={displayStem(q.parentStem)} />
            </div>
          ) : null}
        </Fact>
      ) : null}
      {q.family ? (
        <Fact label="Template family">
          <span className="font-mono text-[11px]">{q.family}</span>
        </Fact>
      ) : null}
      <Fact label="Human stamp">{q.reviewedBy ? `${q.reviewedBy}${q.reviewedAt ? ` · ${q.reviewedAt.slice(0, 10)}` : ""}` : "none"}</Fact>
      <Fact label="AI check">
        {q.aiCheckedBy ? `${q.aiCheckedBy}${q.aiCheckedAt ? ` · ${q.aiCheckedAt.slice(0, 10)}` : ""}` : "none recorded"}
      </Fact>
      <Fact label="Students">
        {q.status === "live" ? "see it" : q.status === "review" ? `do not see it — held${q.holdReason ? `: ${q.holdReason}` : ""}` : q.status}
      </Fact>
      {q.reviewNote ? <Fact label="Review note">{q.reviewNote}</Fact> : null}
    </dl>
  );
}

function SourceSide({ item }: { item: ReviewItemPayload }) {
  switch (item.kind) {
    case "book_question":
    case "generated_question":
    case "widget_question":
    case "figure_stand_in":
      return item.question ? (
        <QuestionFacts q={item.question} />
      ) : item.figure ? (
        <dl>
          <Fact label="Figure">{item.figure.id}</Fact>
          <Fact label="Question">none — an objective&rsquo;s figure</Fact>
        </dl>
      ) : null;
    case "mapping_claim":
      return item.claim ? (
        <>
          <dl>
            <Fact label="Claim">
              <span className="font-mono text-[11px]">{item.claim.predicate}</span> →{" "}
              <span className="font-mono text-[11px]">{item.claim.misconceptionId}</span>
            </Fact>
            <Fact label="State">{item.claim.active ? "active (the grader uses it)" : "held (decision 47) — the grader ignores it"}</Fact>
            {item.claim.why ? <Fact label="AI verifier">{item.claim.why}</Fact> : null}
            {item.claim.verifierRuns.length > 0 ? (
              <Fact label="Verifier runs">
                <span className="font-mono text-[11px]">{item.claim.verifierRuns.join(", ")}</span>
              </Fact>
            ) : null}
          </dl>
          {item.question ? (
            <div className="mt-3">
              <QuestionFacts q={item.question} />
            </div>
          ) : null}
        </>
      ) : null;
    case "misconception":
      return item.misconception ? (
        <dl>
          <Fact label="Written by">{item.misconception.generatedBy}</Fact>
          <Fact label="Named by">
            {item.misconception.taggedQuestions} question{item.misconception.taggedQuestions === 1 ? "" : "s"} (options or widget claims)
          </Fact>
          <Fact label="Refutation">
            {item.misconception.refutations.length === 0
              ? "none"
              : item.misconception.refutations
                  .map((r) => `${r.id} · ${r.reviewed ? `reviewed by ${r.reviewedBy ?? "?"}` : "not reviewed"}`)
                  .join("; ")}
          </Fact>
        </dl>
      ) : null;
    case "worked_example":
      return item.workedExample ? (
        <dl>
          <Fact label="Entry">{item.workedExample.id}</Fact>
          <Fact label="Book">{item.workedExample.sourcePage != null ? `p.${item.workedExample.sourcePage}` : "no page"}</Fact>
          <Fact label="Written by">{item.workedExample.generatedBy}</Fact>
        </dl>
      ) : null;
    case "objective":
      return item.objective ? (
        <dl>
          <Fact label="Syllabus ref">{item.objective.syllabusRef ?? "none"}</Fact>
          <Fact label="Book">{item.objective.sourcePage != null ? `p.${item.objective.sourcePage}` : "no page"}</Fact>
          <Fact label="Comes after">
            {item.objective.prerequisites.length === 0 ? "nothing" : item.objective.prerequisites.map((p) => p.label).join("; ")}
          </Fact>
          <Fact label="Comes before">
            {item.objective.dependents.length === 0 ? "nothing" : item.objective.dependents.map((p) => p.label).join("; ")}
          </Fact>
        </dl>
      ) : null;
    case "gate_decision":
      return item.gate ? <GateChecks gate={item.gate} /> : null;
    case "prerequisite_link":
      return item.link ? (
        <dl>
          <Fact label="From">
            <span className="font-mono text-[11px]">{item.link.src.id}</span>
          </Fact>
          <Fact label="To">
            <span className="font-mono text-[11px]">{item.link.dst.id}</span>
          </Fact>
          <Fact label="Why (pipeline)">{item.link.rationale ?? "no rationale recorded"}</Fact>
        </dl>
      ) : null;
  }
}

/** What an auto-passed gate decided — the part Samuel signs. Not a student surface: there is none. */
function GateDecided({ gate }: { gate: NonNullable<ReviewItemPayload["gate"]> }) {
  const shown = gate.decisions.slice(0, 200);
  return (
    <div className="rounded-lg border border-line bg-card">
      <div className="border-b border-line px-3.5 py-2.5">
        <p className="font-display text-[15px] font-bold text-ink">{GATE_LABEL[gate.gate]}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-soft">
          {gate.book}
          {gate.chapter != null ? ` · chapter ${gate.chapter}` : ""}
          {gate.run ? ` · run ${gate.run}` : ""} · decided {gate.decidedAt.slice(0, 16).replace("T", " ")} UTC
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-ink">
          <Chip tone={gate.outcome === "blocked" ? "attention" : "neutral"}>{gate.outcome.replace(/_/g, " ")}</Chip>
          {gate.summary}
        </p>
        <p className="mt-1 text-[12px] text-ink-soft">
          Signed {gate.by} — an automatic pass, never a human stamp. Nothing here moves production: that is still
          only Samuel&rsquo;s explicit go through CI.
        </p>
      </div>
      {gate.blocked.length > 0 ? (
        <div className="border-b border-line bg-gold-wash px-3.5 py-2 text-[12.5px] text-ink">
          <p className="font-semibold">Did not auto-pass</p>
          <ul className="mt-1 list-disc ps-5">
            {gate.blocked.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {shown.length === 0 ? (
        <p className="px-3.5 py-3 text-[12.5px] text-ink-soft">The record lists no individual decisions.</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-[12.5px] text-ink">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-3 py-1.5 text-start font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">
                  Item
                </th>
                <th scope="col" className="px-3 py-1.5 text-start font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">
                  Auto-decided
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d, i) => (
                <tr key={i} className="border-b border-line-soft align-top">
                  <td className="px-3 py-1.5 font-mono text-[11px]">{d.key}</td>
                  <td className="px-3 py-1.5">
                    {d.decision}
                    {d.detail ? <div className="text-ink-soft">{d.detail}</div> : null}
                    {d.basis ? <div className="text-ink-faint">basis: {d.basis}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {gate.decisions.length > shown.length ? (
            <p className="px-3 py-2 text-[12px] text-ink-soft">
              …and {gate.decisions.length - shown.length} more in {gate.source}.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The checks behind an auto-pass, and where its evidence is. */
function GateChecks({ gate }: { gate: NonNullable<ReviewItemPayload["gate"]> }) {
  return (
    <dl>
      <Fact label="Signed">{gate.by}</Fact>
      <Fact label="Read from">
        <span className="font-mono text-[11px]">{gate.source}</span>
        {gate.origin === "auto-file" ? <div className="text-ink-soft">an auto-pass file (no gate record yet)</div> : null}
      </Fact>
      <Fact label="Checks">
        {gate.checks.length === 0 ? (
          "none listed"
        ) : (
          <ul className="grid gap-0.5">
            {gate.checks.map((c, i) => (
              <li key={i}>
                <span className="font-semibold">{c.name}</span>: {c.state}
                {c.detail ? <span className="text-ink-soft"> — {c.detail}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Fact>
      <Fact label="Coverage (S8)">
        {gate.coverage ? (
          <>
            {gate.coverage.state.toUpperCase()}
            {gate.coverage.summary
              ? ` · ${gate.coverage.summary.checks} checks, ${gate.coverage.summary.fail} failing`
              : ""}
            {gate.coverage.failing.length > 0 ? (
              <div className="text-ink-soft">failing: {gate.coverage.failing.join(", ")}</div>
            ) : null}
            <div className="font-mono text-[11px] text-ink-faint">{gate.coverage.file}</div>
          </>
        ) : (
          "no audit on record for this book"
        )}
      </Fact>
      <Fact label="Evidence">
        {gate.evidence.length === 0 ? (
          "none listed"
        ) : (
          <ul className="grid gap-0.5">
            {gate.evidence.map((e, i) => (
              <li key={i}>
                {e.label}: <span className="font-mono text-[11px]">{e.path}</span>
              </li>
            ))}
          </ul>
        )}
      </Fact>
    </dl>
  );
}

function History({ item }: { item: ReviewItemPayload }) {
  if (item.history.length === 0) {
    return <p className="mt-4 text-[12.5px] text-ink-soft">No reviewer has decided on this item before.</p>;
  }
  return (
    <div className="mt-4">
      <SectionLabel>Earlier decisions</SectionLabel>
      <ul className="grid gap-1.5 text-[12.5px] text-ink">
        {item.history.map((h, i) => (
          <li key={i} className="rounded-md bg-paper-deep px-2.5 py-1.5">
            <span className="font-semibold">{DECISION_LABEL[h.decision]}</span> by {h.operatorName} ·{" "}
            <span className="text-ink-faint">{h.decidedAt.slice(0, 16).replace("T", " ")} UTC</span>
            {h.current ? null : <span className="text-ink-faint"> · on an earlier version</span>}
            {h.note ? <p className="mt-0.5 whitespace-pre-wrap text-ink-soft">{h.note}</p> : null}
            {h.suggestedCorrection ? (
              <p className="mt-0.5 whitespace-pre-wrap text-ink-soft">
                <span className="font-semibold">Suggested:</span> {h.suggestedCorrection}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

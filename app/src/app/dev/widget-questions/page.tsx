import { pool } from "@/lib/db";
import type { SpineQuestion, Tier } from "@/lib/types";
import { StoredWidgets } from "./client";

/**
 * DEV HARNESS — the stored widget bank, served the way a student would get it.
 *
 * Not a fixture: these rows are read from `questions` at request time, so the
 * page is empty if the bank is empty and wrong if the bank is wrong. That is
 * deliberate — the other widget page proves the components work, and this one
 * proves the PIPELINE does.
 */
export const dynamic = "force-dynamic";

export default async function WidgetQuestionsPage() {
  const res = await pool.query(
    `SELECT q.id, q.lo_id, q.tier, q.question_type, q.stem, q.choices,
            q.correct_answer, q.canonical_solution, q.solution_version, q.status,
            q.source, q.parent_question_id, q.source_sha256, q.source_page,
            q.source_note, q.reviewed_by, q.reviewed_at
       FROM questions q
      WHERE q.question_type = 'widget' AND q.status = 'live'
      ORDER BY q.lo_id, q.id`
  );

  const questions: SpineQuestion[] = res.rows.map((r) => ({
    id: r.id,
    loId: r.lo_id,
    tier: r.tier as Tier,
    questionType: r.question_type,
    stem: r.stem,
    choices: r.choices,
    correctAnswer: r.correct_answer,
    solution: r.canonical_solution ?? [],
    solutionVersion: Number(r.solution_version ?? 1),
    status: r.status,
    provenance: {
      source: r.source,
      parentQuestionId: r.parent_question_id ?? null,
      sourceSha256: r.source_sha256,
      sourcePage: r.source_page,
      sourceNote: r.source_note,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
      // Not selected here — this page is about the construction, not the
      // extraction run that produced it.
      extractor: null,
      extractorVersion: null,
      extractionFinishedAt: null,
    },
  }));

  const kinds = new Set(
    questions.map((q) => (!Array.isArray(q.choices) && q.choices ? q.choices.kind : "?"))
  );
  const los = new Set(questions.map((q) => q.loId));
  const mappings = questions.reduce(
    (n, q) => n + (!Array.isArray(q.choices) && q.choices ? q.choices.diagnostics.length : 0),
    0
  );

  return (
    <main className="min-h-screen bg-paper px-4 py-8 text-ink" data-ds="noor">
      <div className="mx-auto max-w-[1100px]">
        <header className="mb-7 border-b border-line pb-5">
          <h1 className="font-display text-[26px] font-bold">Widget questions</h1>
          <p className="mt-1.5 max-w-[70ch] text-[14px] leading-relaxed text-ink-soft">
            Read from the question bank at request time — not a fixture. Each one is a row in{" "}
            <code className="font-mono text-[13px]">questions</code> with{" "}
            <code className="font-mono text-[13px]">question_type = &apos;widget&apos;</code>,
            rendered by the same card that renders multiple choice and answered through the same{" "}
            <code className="font-mono text-[13px]">/api/attempts</code>. Nothing on this page is
            a special path, which is the whole claim of ADR-0009.
          </p>
          <p className="mt-2 font-mono text-[11px] text-ink-faint">
            {questions.length} live widget questions · {los.size} objectives · {kinds.size} kinds ·{" "}
            {mappings} predicate→misconception mappings
          </p>
        </header>

        {questions.length === 0 ? (
          <p className="rounded-xl border border-gold/50 bg-gold-wash px-4 py-3 text-[13.5px] text-gold">
            The bank has no live widget questions. Run{" "}
            <code className="font-mono">generate_widget_questions.py</code> and load the bundle.
          </p>
        ) : (
          <StoredWidgets questions={questions} />
        )}
      </div>
    </main>
  );
}

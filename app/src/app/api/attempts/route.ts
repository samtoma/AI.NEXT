import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { resolveStudentId } from "@/lib/student-context";
import { bktUpdate, DEFAULT_PARAMS, type BktParams } from "@/lib/bkt";
import { emit } from "@/lib/analytics";
import { getLibraryEntries, flagAuthoringGap } from "@/lib/explanations";
import type { AttemptResult, SolutionStep } from "@/lib/types";

function grade(
  questionType: string,
  correct: string,
  given: string
): boolean {
  if (questionType === "numeric") {
    const a = parseFloat(correct);
    const b = parseFloat(given);
    if (!Number.isNaN(a) && !Number.isNaN(b)) return Math.abs(a - b) < 1e-6;
  }
  return correct.trim().toLowerCase() === given.trim().toLowerCase();
}

export async function POST(req: Request) {
  let body: { questionId?: string; givenAnswer?: string; timeMs?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { questionId, givenAnswer, timeMs } = body;
  if (!questionId || typeof givenAnswer !== "string") {
    return NextResponse.json(
      { error: "questionId and givenAnswer are required" },
      { status: 400 }
    );
  }

  // Which demo student this attempt belongs to — a cookie, validated against
  // the students table, defaulting to Omar. DEMO AFFORDANCE, NOT AUTH:
  // auth is a PRD §3 non-goal for the MVP (see lib/demo-student.ts).
  const studentId = await resolveStudentId();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const qRes = await client.query(
      `SELECT q.id, q.lo_id, q.question_type, q.correct_answer, q.choices,
              q.canonical_solution, q.solution_version, n.label AS lo_label
       FROM questions q
       JOIN graph_nodes n ON n.id = q.lo_id
       WHERE q.id = $1 AND q.status = 'live'`,
      [questionId]
    );
    if (qRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "unknown question" }, { status: 404 });
    }
    const q = qRes.rows[0];
    const isCorrect = grade(q.question_type, q.correct_answer, givenAnswer);

    // THE DIAGNOSIS. On a multiple-choice question the distractors are not
    // filler — somebody chose each one to encode a specific error, and the
    // misconception catalogue names which. So the option the student picked IS
    // the diagnosis, with no classifier in between and no guesswork.
    //
    // That is why `confidence` is 1 here and null everywhere else: we are not
    // inferring what she was thinking, we are reading a label attached to the
    // thing she clicked. A numeric answer gets no diagnosis at all rather than
    // an invented one.
    const chosenOption: { text?: string; misconception_id?: string } | null =
      !isCorrect && q.question_type === "mcq" && Array.isArray(q.choices)
        ? (q.choices.find(
            (c: { key?: string }) => c.key === givenAnswer.trim().toUpperCase()
          ) ?? null)
        : null;
    const misconceptionId: string | null = chosenOption?.misconception_id ?? null;

    // 1. record the attempt
    // `diagnosis_type` records HOW the outcome was determined. `confidence` is
    // deliberately left NULL unless a distractor named the error outright —
    // FR-307 requires uncertainty be recorded honestly rather than dressed up
    // as a number we did not compute.
    const attemptRes = await client.query(
      `INSERT INTO attempts
         (student_id, question_id, given_answer, is_correct, time_ms, attempted_at,
          diagnosis_type, misconception_id, stance_used, confidence)
       VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9)
       RETURNING id`,
      [
        studentId,
        questionId,
        givenAnswer,
        isCorrect,
        Math.round(timeMs ?? 0),
        isCorrect
          ? "correct"
          : misconceptionId
            ? "distractor_diagnosed"
            : "deterministic_grade_incorrect",
        misconceptionId,
        isCorrect ? "confirm" : "re_explain",
        misconceptionId ? 1 : null,
      ]
    );
    const attemptId = attemptRes.rows[0].id;

    // 2. temporal mastery update: close the current row, open a new one.
    //
    // The update rule is BKT (lib/bkt.ts, ADR-0007) — it replaced the Elo-style
    // exponential moving average that lived here. The bitemporal pattern, the
    // FOR UPDATE lock and the transaction are unchanged: only the number's
    // meaning and the rule producing it changed. `score` is now P(L).
    const mRes = await client.query(
      `SELECT id, score, p_init, p_transit, p_guess, p_slip FROM mastery
       WHERE student_id = $1 AND lo_id = $2 AND system_to IS NULL
       FOR UPDATE`,
      [studentId, q.lo_id]
    );

    const row = mRes.rowCount ? mRes.rows[0] : null;
    const params: BktParams = row
      ? {
          pInit: Number(row.p_init),
          pTransit: Number(row.p_transit),
          pGuess: Number(row.p_guess),
          pSlip: Number(row.p_slip),
        }
      : DEFAULT_PARAMS;

    const oldScore = row ? Number(row.score) : params.pInit;
    const evidence = bktUpdate(oldScore, isCorrect ? "correct" : "incorrect", params);
    const newScore = evidence.afterTransit;

    if (row) {
      await client.query(
        `UPDATE mastery SET system_to = now() WHERE id = $1`,
        [row.id]
      );
    }
    // The evidence trail travels with the row it produced, so "why is this
    // student's mastery here?" is answerable without reconstructing it from
    // attempt history (FR-301).
    await client.query(
      `INSERT INTO mastery
         (student_id, lo_id, score, system_from, system_to,
          p_init, p_transit, p_guess, p_slip, evidence)
       VALUES ($1, $2, $3, now(), NULL, $4, $5, $6, $7, $8)`,
      [
        studentId,
        q.lo_id,
        newScore,
        params.pInit,
        params.pTransit,
        params.pGuess,
        params.pSlip,
        JSON.stringify({
          attempt_id: attemptId,
          question_id: questionId,
          observation: evidence.observation,
          prior: evidence.prior,
          posterior: evidence.posterior,
          after_transit: evidence.afterTransit,
        }),
      ]
    );

    // 3. wrong answer → log the canonical-grounded explanation
    const solution: SolutionStep[] = q.canonical_solution ?? [];
    if (!isCorrect) {
      const outputMd = solution
        .map((s) => `**Step ${s.step}.** ${s.text_md}`)
        .join("\n\n");
      await client.query(
        `INSERT INTO explanation_log
           (attempt_id, question_id, solution_version, model, prompt_version,
            wrong_answer, output_md, grounded_ok, cached)
         VALUES ($1, $2, $3, 'canonical-grounded', 'poc-demo', $4, $5, true, false)`,
        [attemptId, questionId, q.solution_version, givenAnswer, outputMd]
      );
    }

    await client.query("COMMIT");

    // Fire-and-forget, and deliberately AFTER commit: an analytics failure must
    // never roll back a student's graded attempt.
    // A wrong answer is where the PRD's teaching bet lives: serve an authored
    // refutation, or say plainly that none exists and fall back to the canonical
    // solution (FR-305, PRD §8). What we must never do is improvise one and
    // present it as settled — so the absence is logged, not papered over.
    if (!isCorrect) {
      // Ask for THE refutation of the error she actually made, not whichever
      // entry this objective happens to have first. Serving a refutation of a
      // mistake the student did not make is worse than serving the plain
      // solution: it corrects something she never thought.
      const entries = misconceptionId
        ? await getLibraryEntries([q.lo_id], {
            misconceptionId,
            entryTypes: ["refutation", "contrasting_case"],
          })
        : await getLibraryEntries([q.lo_id], {
            entryTypes: ["refutation", "contrasting_case"],
          });
      if (entries.length === 0) {
        void flagAuthoringGap(studentId, misconceptionId);
      } else {
        const chosen = entries[0];
        void emit({
          event: "explanation_delivered",
          studentId,
          properties: {
            lo_id: chosen.loId,
            entry_id: chosen.id,
            entry_type: chosen.entryType,
            misconception_id: chosen.misconceptionId,
            // travels all the way to analytics so we can always answer "how much
            // UNREVIEWED teaching did students actually see" (SC-011), not just
            // how much exists in the table.
            reviewed: chosen.reviewed,
          },
        });
      }
    }

    void emit({
      event: "retrieval_attempt_submitted",
      studentId,
      properties: {
        skill_id: q.lo_id,
        question_id: questionId,
        correct: isCorrect,
        prior: evidence.prior,
        posterior: evidence.posterior,
        mastery: newScore,
      },
    });

    const result: AttemptResult = {
      isCorrect,
      correctAnswer: q.correct_answer,
      solution,
      loId: q.lo_id,
      loLabel: q.lo_label,
      oldScore,
      newScore,
    };
    return NextResponse.json(result);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("attempt POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  } finally {
    client.release();
  }
}

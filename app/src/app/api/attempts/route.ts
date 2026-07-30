import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { resolveStudentId } from "@/lib/student-context";
import type { AttemptResult, SolutionStep } from "@/lib/types";

const K = 0.15;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

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
      `SELECT q.id, q.lo_id, q.question_type, q.correct_answer,
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

    // 1. record the attempt
    const attemptRes = await client.query(
      `INSERT INTO attempts (student_id, question_id, given_answer, is_correct, time_ms, attempted_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id`,
      [studentId, questionId, givenAnswer, isCorrect, Math.round(timeMs ?? 0)]
    );
    const attemptId = attemptRes.rows[0].id;

    // 2. temporal mastery update: close the current row, open a new one
    const mRes = await client.query(
      `SELECT id, score FROM mastery
       WHERE student_id = $1 AND lo_id = $2 AND system_to IS NULL
       FOR UPDATE`,
      [studentId, q.lo_id]
    );
    const oldScore = mRes.rowCount ? Number(mRes.rows[0].score) : 0.3;
    const outcome = isCorrect ? 1 : 0;
    const newScore = clamp(oldScore + K * (outcome - oldScore), 0.02, 0.98);

    if (mRes.rowCount) {
      await client.query(
        `UPDATE mastery SET system_to = now() WHERE id = $1`,
        [mRes.rows[0].id]
      );
    }
    await client.query(
      `INSERT INTO mastery (student_id, lo_id, score, system_from, system_to)
       VALUES ($1, $2, $3, now(), NULL)`,
      [studentId, q.lo_id, newScore]
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

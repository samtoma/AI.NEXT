import { NextResponse } from "next/server";
import { withPrincipal } from "@/lib/db";
import { AuthError, requireStudent } from "@/lib/auth/principal";
import { mapRlsError } from "@/lib/rls-errors";
import { bktUpdate, DEFAULT_PARAMS, type BktParams } from "@/lib/bkt";
import { emit } from "@/lib/analytics";
import { getLibraryEntries, flagAuthoringGap } from "@/lib/explanations";
import { currentSessionOrNull } from "@/lib/sessions";
import type { AttemptResult, SolutionStep } from "@/lib/types";
import { evaluateArithmeticExpression } from "@/lib/arithmetic";

/**
 * A refusal decided INSIDE the unit of work.
 *
 * `withPrincipal` commits when the callback returns and rolls back when it
 * throws, so "unknown question" and "a widget attempt must report a predicate"
 * have to leave by throwing — returning a 404 shape would COMMIT, and the
 * inline widget this request may have just materialised would survive a request
 * that answered "no such question". That is precisely the rollback the explicit
 * `client.query("ROLLBACK")` used to perform, kept rather than lost in
 * translation.
 */
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string }
  ) {
    super(body.error);
  }
}

function grade(
  questionType: string,
  correct: string,
  given: string
): boolean {
  if (questionType === "numeric") {
    const a = parseFloat(correct);
    if (!Number.isNaN(a)) {
      const trimmedGiven = given.trim();
      // The common case: a clean numeric literal, no working shown.
      if (/^[+-]?\d+(\.\d+)?$/.test(trimmedGiven)) {
        return Math.abs(a - parseFloat(trimmedGiven)) < 1e-6;
      }
      // The student typed the steps that lead to the answer ("3x4" for 12)
      // instead of the final value. Evaluate deterministically — no model
      // call — before falling back to treating it as text.
      const evaluated = evaluateArithmeticExpression(trimmedGiven);
      if (evaluated !== null) return Math.abs(a - evaluated) < 1e-6;
      const b = parseFloat(trimmedGiven);
      if (!Number.isNaN(b)) return Math.abs(a - b) < 1e-6;
    }
  }
  return correct.trim().toLowerCase() === given.trim().toLowerCase();
}

export async function POST(req: Request) {
  let body: {
    questionId?: string;
    givenAnswer?: string;
    timeMs?: number;
    /** Widget attempts only: the structural predicate the construction
     *  satisfied. Graded here against the question's own `correct_answer`,
     *  never trusted as a verdict (ADR-0009). */
    predicate?: string;
    /** An inline widget the TUTOR composed mid-stream, with no row behind it.
     *  Answering one materialises it (ADR-0009 §3) so that nothing can move a
     *  reported number without leaving a reviewable artefact. */
    inlineWidget?: { kind: string; spec: Record<string, unknown>; loId: string; stem: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { questionId, givenAnswer, timeMs, predicate, inlineWidget } = body;
  if (!questionId || typeof givenAnswer !== "string") {
    return NextResponse.json(
      { error: "questionId and givenAnswer are required" },
      { status: 400 }
    );
  }

  // Whose attempt this is. From the verified access token and a live session
  // join — never from the request (FR-2102).
  let me;
  try {
    me = await requireStudent();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.code }, { status: err.status });
    throw err;
  }
  // FR-2004: verification gates LEARNING, not sign-in. Answering a question is
  // learning, and mastery written against an unconfirmed address is the thing
  // the gate exists to prevent.
  if (!me.emailVerified) {
    return NextResponse.json({ error: "email_unverified" }, { status: 403 });
  }
  const studentId = me.studentId;

  // ONE unit of work for the whole graded write: the attempt, the bitemporal
  // mastery close-and-open, and the explanation log. `withPrincipal` is the
  // BEGIN/COMMIT that `pool.connect()` + `client.query("BEGIN")` used to be,
  // with `set_config('app.student_id', …)` added — so the FOR UPDATE lock, the
  // rollback semantics and the "an attempt that rolls back takes its session
  // with it" property are all unchanged.
  try {
    const outcome = await withPrincipal(studentId, async (client) => {
      // MATERIALISE AN INLINE WIDGET (ADR-0009 §3).
      //
      // Samuel's two decisions collide here: all widget attempts move mastery,
      // and the tutor may still compose a widget inline when the bank has
      // nothing that fits. But `attempts.question_id` is NOT NULL and references
      // `questions`, so an improvised widget has nothing to attach to.
      //
      // Resolved in the direction that loses nothing: answering one WRITES it,
      // as source='variant', status='review', reviewed_by=NULL. So the tutor's
      // improvisation becomes content — countable under FR-1108, provenance-
      // tagged under FR-1110, queued for the same human gate as everything else.
      // It is never written live: materialising is not promotion, and the
      // selector must not serve one student's improvised construction to the
      // next student before a human has read it (enforced by a CHECK in
      // migration 010, not only by this code).
      //
      // Before this, an improvised widget simply evaporated after the beat.
      if (inlineWidget && typeof questionId === "string" && questionId.startsWith("qw:inline:")) {
        await client.query(
          `INSERT INTO questions
             (id, lo_id, tier, question_type, stem, choices, correct_answer,
              canonical_solution, solution_version, status, source, source_note,
              materialised_from, reviewed_by, reviewed_at)
           VALUES ($1,$2,'standard','widget',$3,$4,'ok','[]'::jsonb,1,'review','variant',$5,$6,NULL,NULL)
           ON CONFLICT (id) DO NOTHING`,
          [
            questionId,
            inlineWidget.loId,
            inlineWidget.stem,
            JSON.stringify({ kind: inlineWidget.kind, spec: inlineWidget.spec, diagnostics: [] }),
            `Composed inline by the tutor and materialised on first attempt (ADR-0009 §3). Kind ${inlineWidget.kind}.`,
            studentId,
          ]
        );
      }

      const qRes = await client.query(
        `SELECT q.id, q.lo_id, q.question_type, q.correct_answer, q.choices,
                q.canonical_solution, q.solution_version, n.label AS lo_label
         FROM questions q
         JOIN graph_nodes n ON n.id = q.lo_id
         WHERE q.id = $1
           AND (q.status = 'live' OR q.materialised_from IS NOT NULL)`,
        [questionId]
      );
      if (qRes.rowCount === 0) {
        throw new HttpError(404, { error: "not_found" });
      }
      const q = qRes.rows[0];

      // A WIDGET IS A QUESTION (ADR-0009), and its wrong answers are PREDICATES
      // rather than lettered options. The client reports which structural thing
      // happened — "both ends on the circle", "the stroke doubles back" — and the
      // stored question maps that to a misconception. Grading stays here on the
      // server: `correct_answer` holds the reserved predicate "ok", so a client
      // claiming success has to claim it in the same vocabulary everything else
      // is checked against.
      const isWidget = q.question_type === "widget";
      if (isWidget && typeof predicate !== "string") {
        throw new HttpError(400, {
          error: "a widget attempt must report a predicate",
        });
      }
      const isCorrect = isWidget
        ? predicate === q.correct_answer
        : grade(q.question_type, q.correct_answer, givenAnswer);

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

      // The widget equivalent: look the predicate up in the question's own
      // diagnostics. An unmapped predicate (`off-target`, and anything the
      // author chose not to name) yields null, which is honest — the student was
      // wrong and we do not claim to know why.
      const widgetDiagnostic: { misconception_id?: string } | null =
        isWidget && !isCorrect && q.choices && Array.isArray(q.choices.diagnostics)
          ? (q.choices.diagnostics.find(
              (d: { predicate?: string }) => d.predicate === predicate
            ) ?? null)
          : null;

      const misconceptionId: string | null =
        chosenOption?.misconception_id ?? widgetDiagnostic?.misconception_id ?? null;

      // The learning session this attempt belongs to (ADR-0015). The client sends
      // nothing new: an answer submitted inside a lesson joins the lesson's open
      // session (`adoptOpen`), and only an answer with no sitting around it opens
      // a `practice` one. It runs on the transaction's client, so an attempt that
      // rolls back takes its session with it rather than leaving a phantom — and
      // so P1's `withPrincipal` scopes both to the same student.
      const sessionId = await currentSessionOrNull(
        studentId,
        "practice",
        { surface: "attempt", loId: q.lo_id, adoptOpen: true },
        client
      );

      // 1. record the attempt
      // `diagnosis_type` records HOW the outcome was determined. `confidence` is
      // deliberately left NULL unless a distractor named the error outright —
      // FR-307 requires uncertainty be recorded honestly rather than dressed up
      // as a number we did not compute.
      const attemptRes = await client.query(
        `INSERT INTO attempts
           (student_id, question_id, session_id, given_answer, is_correct, time_ms,
            attempted_at, diagnosis_type, misconception_id, stance_used, confidence, modality)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          studentId,
          questionId,
          sessionId,
          givenAnswer,
          isCorrect,
          Math.round(timeMs ?? 0),
          isCorrect
            ? "correct"
            : misconceptionId
              ? isWidget
                ? "construction_diagnosed"
                : "distractor_diagnosed"
              : "deterministic_grade_incorrect",
          misconceptionId,
          isCorrect ? "confirm" : "re_explain",
          // Confidence 1 for both: neither is inferred. A distractor carries a
          // label the student clicked; a predicate is a geometric fact about
          // what they built. Reading a label is not guessing.
          misconceptionId ? 1 : null,
          // Samuel's decision (ADR-0009 §1): widget attempts DO move mastery,
          // and this column is what keeps that auditable — every comparison
          // metric can be recomputed with and without them.
          isWidget ? "widget" : "question",
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

      // The unit of work ends here: `withPrincipal` COMMITs on return. Everything
      // below used to run after the explicit COMMIT and still does — it just
      // does it outside the callback rather than after a statement.
      return {
        q,
        isWidget,
        isCorrect,
        misconceptionId,
        evidence,
        oldScore,
        newScore,
        solution,
      };
    });

    const {
      q,
      isWidget,
      isCorrect,
      misconceptionId,
      evidence,
      oldScore,
      newScore,
      solution,
    } = outcome;

    // Fire-and-forget, and deliberately AFTER commit: an analytics failure must
    // never roll back a student's graded attempt.
    // A wrong answer is where the PRD's teaching bet lives: serve an authored
    // refutation, or say plainly that none exists and fall back to the canonical
    // solution (FR-305, PRD §8). What we must never do is improvise one and
    // present it as settled — so the absence is logged, not papered over.
    // The refutation the student is ABOUT to be shown, carried back in the
    // response rather than only into analytics.
    //
    // Before ADR-0009 this lookup happened, logged, and then the caller got the
    // question's canonical solution anyway — so the entry written for the exact
    // error a student made reached a dashboard and never reached the student.
    // That was survivable while the tutor stream was the only surface, because
    // the model reads the library itself. It stops being survivable when a
    // construction is answered on its own card, which is what a widget question
    // is.
    let served: {
      misconceptionId: string | null;
      entryId: string;
      entryType: string;
      reviewed: boolean;
      steps: { step: number; text_md: string }[];
    } | null = null;

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
        const content = chosen.content as
          | { steps?: { step: number; text_md: string }[] }
          | { step: number; text_md: string }[]
          | null;
        served = {
          misconceptionId: chosen.misconceptionId,
          entryId: chosen.id,
          entryType: chosen.entryType,
          reviewed: chosen.reviewed,
          steps: Array.isArray(content) ? content : (content?.steps ?? []),
        };
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
      // Additive: existing callers ignore these. `diagnosis` is null when the
      // error was not one the question names — which is the honest answer, not
      // a gap to fill with the nearest entry.
      modality: isWidget ? "widget" : "question",
      diagnosis: misconceptionId
        ? { misconceptionId, via: isWidget ? predicate! : givenAnswer }
        : null,
      refutation: served,
    };
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    // A write the POLICY refused — someone else's ids on this student's
    // request. 403, and the one security event whose alert threshold is zero
    // (FR-2103). Anything else is our bug and stays a 500.
    const denied = await mapRlsError(err, {
      req,
      actorAccountId: me.accountId,
      targetStudentId: studentId,
      resource: "api/attempts",
    });
    if (denied) return denied;
    console.error("attempt POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { withPrincipal } from "@/lib/db";
import { AuthError, requireStudent } from "@/lib/auth/principal";
import { mapRlsError } from "@/lib/rls-errors";
import { bktUpdate, DEFAULT_PARAMS, type BktParams } from "@/lib/bkt";
import { visibleCoursesFor } from "@/lib/catalog-queries";
import { emit } from "@/lib/analytics";
import { getLibraryEntries, flagAuthoringGap } from "@/lib/explanations";
import { currentSessionSnapshot } from "@/lib/sessions";
import type { AttemptResult, SolutionStep } from "@/lib/types";
import { markAnswer, type AttemptRetry } from "@/lib/attempt-grading";
import { MarkerKeyError } from "@/lib/answer-marker";
import { choiceOptions } from "@/lib/question-flags";
import {
  acceptedRetryOf,
  attemptProbingDeclaration,
  effectiveProbing,
} from "@/lib/socratic-probing";
import { advanceIfMastered } from "@/lib/progression-db";

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

/**
 * An answer the maths-expression marker sends back for re-entry (T416, FR-4320): in a form the question
 * does not ask for, or not readable as maths. It is NOT a verdict, so it leaves the unit of work by
 * throwing — `withPrincipal` rolls back, and nothing this request touched survives: no attempt row, no
 * mastery change, no learning session opened. Answered 422 with the marker's message, so a client that
 * does not know the shape fails safe (an error, never "wrong").
 */
class ReentryRequested extends Error {
  constructor(readonly body: AttemptRetry) {
    super(body.retry);
  }
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
    /** Socratic-probing prototype (`507bb31`): set by the client when this
     *  attempt is the same-tier sibling question served to confirm
     *  understanding after a wrong answer put the LO into
     *  confirmation-pending (ChatCore's `pendingConfirmation`). Links the
     *  retry back to the attempt it is confirming — correct or not — so a
     *  probe cycle is reconstructible from `attempts` alone (migration 027).
     *  **Ignored unless probing applies to this attempt** (ADR-0021: the
     *  learning session it joins opened with probing on, AND the switch and
     *  the student's mark still say so now — never this field's presence) —
     *  see `lib/socratic-probing.ts`. */
    retryOfAttemptId?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { questionId, givenAnswer, timeMs, predicate, inlineWidget, retryOfAttemptId } = body;
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

      // The course this question belongs to, walked the same way
      // `lib/lesson.ts` walks it: LO ← module (`teaches`) → course (`part_of`).
      // LEFT joins throughout, so a question whose LO hangs off nothing still
      // returns its row — with a null course, which the gate below refuses.
      const qRes = await client.query(
        `SELECT q.id, q.lo_id, q.question_type, q.correct_answer, q.choices,
                q.canonical_solution, q.solution_version, n.label AS lo_label,
                c.id AS course_id, (q.reviewed_by IS NOT NULL) AS solution_reviewed
         FROM questions q
         JOIN graph_nodes n ON n.id = q.lo_id
         LEFT JOIN graph_edges te
           ON te.dst_id = q.lo_id AND te.edge_type = 'teaches' AND te.system_to IS NULL
         LEFT JOIN graph_nodes m ON m.id = te.src_id AND m.kind = 'module'
         LEFT JOIN graph_edges ce
           ON ce.src_id = m.id AND ce.edge_type = 'part_of' AND ce.system_to IS NULL
         LEFT JOIN graph_nodes c ON c.id = ce.dst_id AND c.kind = 'course'
         WHERE q.id = $1
           AND (q.status = 'live' OR q.materialised_from IS NOT NULL)
         LIMIT 1`,
        [questionId]
      );
      if (qRes.rowCount === 0) {
        throw new HttpError(404, { error: "not_found" });
      }
      const q = qRes.rows[0];

      // THE COURSE GATE (migration 023, lib/catalog.ts), and this endpoint
      // needs it as much as the page does. `questionId` comes from the request
      // body, and the response to a wrong answer carries `correctAnswer` and
      // the question's full canonical solution — so an ungated attempt is a
      // way to read a hidden course's worked answers one question id at a
      // time, while writing mastery for a course the student is not taking.
      //
      // Thrown, not returned, on purpose: `withPrincipal` COMMITs on a return,
      // and a returned 404 here would leave behind the inline widget the block
      // above may have just materialised (see `HttpError`).
      const visible = await visibleCoursesFor(studentId, client);
      if (!q.course_id || !visible.has(q.course_id)) {
        throw new HttpError(404, { error: "not_found" });
      }

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
      // THE MARKER (T416, FR-4320). A question carrying `choices.marker` is
      // marked by mathematical equivalence (lib/answer-marker.ts, ADR-0025);
      // every other question by today's `grade()`, unchanged (FR-C03) —
      // `markAnswer` decides which, and the replay proves the second half on
      // every recorded attempt (SC-212). A re-entry is decided HERE, before
      // the session below is adopted or opened and before any write, and it
      // leaves by throwing so the unit of work rolls back whole. The same
      // re-entry answers a choice question's TRUE but less precise option
      // (`choices.less_specific`, Samuel's G2 answer 20; lib/question-flags.ts):
      // not wrong, not an attempt, asked again. A malformed flag is ignored
      // with a server-log warning, never a failed request.
      const verdict = isWidget ? null : markAnswer(q, givenAnswer);
      if (verdict?.verdict === "retry") {
        throw new ReentryRequested({
          retry: verdict.retry,
          ...(verdict.form ? { form: verdict.form } : {}),
          ...(verdict.reason ? { reason: verdict.reason } : {}),
          message: verdict.message,
        });
      }
      const isCorrect = isWidget
        ? predicate === q.correct_answer
        : verdict!.isCorrect;

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
        !isCorrect && q.question_type === "mcq"
          ? ((choiceOptions(q.choices) as { key?: string; text?: string; misconception_id?: string }[] | null)?.find(
              (c) => c.key === givenAnswer.trim().toUpperCase()
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
      const session = await currentSessionSnapshot(
        studentId,
        "practice",
        { surface: "attempt", loId: q.lo_id, adoptOpen: true },
        client
      );
      const sessionId = session.sessionId;

      // PROBING, FOR THIS ATTEMPT (ADR-0021). The session it joined must have
      // OPENED with probing on (stored on the row, never re-resolved, never
      // taken from the request), the switch and her tester mark must still
      // say so NOW (`session.probing`, option B: Off reaches her next
      // message), and the question must be maths in a learn-mode session. An
      // attempt with no lesson around it opens a `practice` session, which
      // never probes.
      const probing = effectiveProbing(session.probing, session.kind, q.course_id);

      // Socratic probing (`507bb31`): the attempt this one confirms, if any.
      // `acceptedRetryOf` answers null unless the session probes, so a lesson
      // with probing off writes exactly the row v0.6.0 wrote whatever the
      // client sends. When it is on, the id must name a WRONG attempt of THIS
      // student's on THIS question's objective — the only thing a probe cycle
      // ever retries (the client links a retry to its pending LO's last wrong
      // attempt). Anything else is dropped rather than written as a false
      // edge. The student is checked twice on purpose: RLS already hides
      // another child's attempt under her principal (ADR-0012), and
      // `student_id = $2` keeps the statement correct on its own if it is ever
      // run on another connection.
      let retryOf = acceptedRetryOf(retryOfAttemptId, probing);
      if (retryOf !== null) {
        const own = await client.query(
          `SELECT 1 FROM attempts a
             JOIN questions tq ON tq.id = a.question_id
            WHERE a.id = $1 AND a.student_id = $2
              AND a.is_correct = false AND tq.lo_id = $3`,
          [retryOf, studentId, q.lo_id]
        );
        if (own.rowCount === 0) retryOf = null;
      }

      // 1. record the attempt
      // `diagnosis_type` records HOW the outcome was determined. `confidence` is
      // deliberately left NULL unless a distractor named the error outright —
      // FR-307 requires uncertainty be recorded honestly rather than dressed up
      // as a number we did not compute.
      const attemptRes = await client.query(
        `INSERT INTO attempts
           (student_id, question_id, session_id, given_answer, is_correct, time_ms,
            attempted_at, diagnosis_type, misconception_id, stance_used, confidence, modality${
              // The column is named only when a link exists, so with
              // probing off this statement is exactly v0.6.0's and does not
              // depend on migration 027 having run.
              retryOf !== null ? ", retry_of_attempt_id" : ""
            })
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11${retryOf !== null ? ", $12" : ""})
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
          // A confirmation-retry (Socratic probing) is tagged "probe"
          // regardless of outcome — a distinct teaching stance, not a third
          // verdict. Unreachable unless the session probes (retryOf is null).
          retryOf !== null ? "probe" : isCorrect ? "confirm" : "re_explain",
          // Confidence 1 for both: neither is inferred. A distractor carries a
          // label the student clicked; a predicate is a geometric fact about
          // what they built. Reading a label is not guessing.
          misconceptionId ? 1 : null,
          // Samuel's decision (ADR-0009 §1): widget attempts DO move mastery,
          // and this column is what keeps that auditable — every comparison
          // metric can be recomputed with and without them.
          isWidget ? "widget" : "question",
          ...(retryOf !== null ? [retryOf] : []),
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

      // 4. advance the lesson pointer if this attempt just completed the lesson
      // (Tamer's mastery-gated progression, ADR-0020 on main). Inside the unit
      // of work deliberately: the mastery write and the advance it implies
      // commit together, so a student never ends up mastered-but-not-advanced
      // because the request died between two writes. Same client, so the
      // advance sees the mastery row written above and runs under the same
      // student principal (ADR-0012).
      //
      // Only a CORRECT answer can cross the gate, so the catalogue read — which
      // is not cheap — is skipped entirely on the common path.
      //
      // Under a SAVEPOINT (trial merge): a failure in the pointer code rolls
      // back the pointer alone and leaves the graded attempt exactly as main
      // writes it. The pointer is a convenience; the attempt is the student's
      // evidence. It is NOT a shim for a database without migration 028 —
      // production applies every migration before the app starts
      // (deploy/apply-migrations.sh, the compose `migrate` service), and
      // /student reads the pointer with no such cover.
      let advancedTo: string | null = null;
      if (isCorrect) {
        await client.query("SAVEPOINT lesson_progress");
        try {
          advancedTo = await advanceIfMastered(client, studentId, q.lo_id);
          await client.query("RELEASE SAVEPOINT lesson_progress");
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT lesson_progress");
          console.error("lesson pointer advance failed (attempt kept):", err);
          advancedTo = null;
        }
      }

      // The unit of work ends here: `withPrincipal` COMMITs on return. Everything
      // below used to run after the explicit COMMIT and still does — it just
      // does it outside the callback rather than after a statement.
      return {
        advancedTo,
        probing,
        sessionKind: session.kind,
        attemptId: Number(attemptId),
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
      advancedTo,
      probing,
      sessionKind,
      attemptId,
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
      // solution: it corrects something she never thought — so an undiagnosed
      // error (a numeric answer, or an MCQ distractor with no misconception
      // label) skips the library entirely and falls back to the canonical
      // solution client-side (FR-305), rather than guessing at one of the
      // LO's OTHER misconceptions.
      const entries = misconceptionId
        ? await getLibraryEntries([q.lo_id], {
            misconceptionId,
            entryTypes: ["refutation", "contrasting_case"],
          })
        : [];
      if (entries.length === 0) {
        // An AUTHORING GAP is a misconception the question names with no
        // refutation written for it (FR-305) — something an author can fix.
        // An undiagnosed error is not one: there is no misconception to write
        // a refutation OF, so flagging it would bury the real gaps under one
        // flag per wrong numeric answer.
        if (misconceptionId) void flagAuthoringGap(studentId, misconceptionId);
        // The student is shown the question's worked solution instead
        // (client-side, from `solution` below), and that is an explanation
        // delivered as much as a refutation is. Before the undiagnosed path
        // stopped borrowing another misconception's entry this event fired
        // for it; it now fires for what is actually shown, typed so a
        // refutation-only count stays one filter away.
        if (solution.length > 0) {
          void emit({
            event: "explanation_delivered",
            studentId,
            properties: {
              lo_id: q.lo_id,
              entry_id: null,
              entry_type: "canonical_solution",
              misconception_id: misconceptionId,
              // The question's own review stamp (ADR-0019 keeps it in the
              // data): SC-011 counts unreviewed teaching SEEN, and a worked
              // solution nobody has read is exactly that.
              reviewed: q.solution_reviewed === true,
            },
          });
        }
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
      attemptId,
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
      advancedTo,
      diagnosis: misconceptionId
        ? { misconceptionId, via: isWidget ? predicate! : givenAnswer }
        : null,
      refutation: served,
      // Probing as it applied to THIS attempt (ADR-0021) — declared only
      // when the attempt was written inside a learn-mode lesson sitting
      // (`attemptProbingDeclaration`, fix pass 2). There the client adopts
      // it, so the card that shows this result withholds or reveals by the
      // same rule the server just wrote the row by, and a false after the
      // switch went Off mid-sitting un-withholds any card still held back.
      // An attempt in any other session (a `practice` one opened by an
      // answer before any tutor turn, or after the lesson sitting went idle)
      // declares nothing, and ChatCore keeps what the lesson last told it
      // rather than dropping a pending probe on a `false` that is not about
      // the lesson at all.
      ...attemptProbingDeclaration(sessionKind, probing),
    };
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    if (err instanceof ReentryRequested) {
      // Which question and why, never what was typed: the list of unreadable
      // answers is the parser's to-do list (marker-evaluation §7), but a
      // minor's free text is not ours to log without a privacy review.
      console.info("[marker] re-entry, nothing recorded:", {
        question_id: questionId,
        retry: err.body.retry,
        ...(err.body.form ? { form: err.body.form } : { reason: err.body.reason }),
      });
      return NextResponse.json(err.body, { status: 422 });
    }
    if (err instanceof MarkerKeyError) {
      // The question's key or spec cannot be marked: a content defect for the
      // loader's check (validateKey), never the student's. Logged, and no
      // attempt recorded — the transaction rolled back with the throw.
      console.error("[marker] key defect, no attempt recorded:", { question_id: questionId, error: err.message });
      return NextResponse.json({ error: "internal error" }, { status: 500 });
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

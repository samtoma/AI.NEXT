import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { NextResponse } from "next/server";
import { systemPromptFile } from "@/lib/claude-prompt-file";
import { withPrincipal } from "@/lib/db";
import { AuthError, requireStudent } from "@/lib/auth/principal";
import { mapRlsError } from "@/lib/rls-errors";
import { ENVIRONMENT, RELEASE_TAG } from "@/lib/env";
import {
  getLessonData,
  lessonAnchorLo,
  lessonCourseId,
  sanitizeLessonSlug,
} from "@/lib/lesson";
import {
  UNDERSTANDING_SYSTEM_PROMPT,
  buildUnderstandingPrompt,
  understandingRetryPrompt,
} from "@/lib/understanding-prompt";
import { spineKeyOf } from "@/lib/subjects";
import { closeSession, currentSessionOrNull } from "@/lib/sessions";
import {
  ZERO_TOKENS,
  addTokens,
  costFor,
  tokensFromUsage,
  type CliUsage,
  type Outcome,
  type TokenCounts,
} from "@/lib/pricing";
import {
  CLAUDE_BIN,
  claudeCwd,
  claudeEnv,
  classifyCliFailure,
  type CliCode,
} from "@/lib/claude-cli";
import type { LessonMode, ReportMastery, UnderstandingCheck, Verdict } from "@/lib/types";
import { reportMastery } from "@/lib/mastery";
import { endedTurnOutcome } from "@/lib/stop-turn";

/**
 * POST /api/understanding — the honest comprehension rating.
 *
 * Sends the full lesson transcript (incl. widget/question [live event] lines)
 * to the LLM asking for STRICT JSON {score, verdict, strengths, gaps,
 * next_step}; parses (one retry on invalid output), inserts the row into
 * understanding_checks, and logs cost to ai_interactions.
 *
 * Two units of work with the model between them (research R7). Up to two CLI
 * calls of ninety seconds each sit in the gap, and a connection held across
 * that is three minutes of a pool of twenty spent on one rating.
 */

export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 90_000;

interface InMsg {
  role: "user" | "assistant" | "note";
  text: string;
}

/**
 * One call's outcome, and it always resolves.
 *
 * It used to reject on a CLI failure, which threw past the ledger write and
 * left no row — so a rating attempt that burned a full lesson transcript of
 * input tokens and then died was recorded as costing nothing (research A4.2).
 * A failed call is a cost line with its outcome, so the failure comes back as
 * a value carrying whatever usage was reported.
 */
type CliResult =
  | {
      ok: true;
      text: string;
      /** The CLI's own total, or null if it did not report one. */
      cliCostUsd: number | null;
      tokens: TokenCounts;
      latencyMs: number;
    }
  | {
      ok: false;
      /** `stopped`: the student pressed Stop on the rating (migration 041). */
      outcome: Extract<Outcome, "error" | "timeout" | "stopped">;
      tokens: TokenCounts;
      latencyMs: number;
      /**
       * WHY it failed, as one of `lib/claude-cli.ts`'s seven stable words.
       *
       * This used to be `detail: string` holding the last 300 bytes of the
       * CLI's stderr — which was then never read by anything, so it was a
       * credential-adjacent string carried around a request handler for no
       * benefit. CLI diagnostics can contain a filesystem path, a home
       * directory or a fragment of whatever failed to authenticate; a closed
       * vocabulary cannot. The word ends up in `assistant_message`, which an
       * operator can read in the console's replay, so it had to be one that is
       * safe to show.
       */
      code: CliCode;
    };

function runClaudeJson(
  systemPrompt: string,
  userPrompt: string,
  /** The request's abort signal — the student's Stop. */
  signal?: AbortSignal
): Promise<CliResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let timedOut = false;
    let stopped = false;
    // The system prompt in a FILE, never on the command line: one exec argument
    // over 131,072 bytes is refused with E2BIG (lib/claude-prompt-file.ts).
    const promptFile = systemPromptFile(systemPrompt);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(
        CLAUDE_BIN,
        [
          "-p",
          "--output-format",
          "json",
          "--model",
          MODEL,
          "--system-prompt-file",
          promptFile.path,
          "--disallowedTools",
          "*",
          "--max-turns",
          "1",
        ],
        {
          // One builder for all four call sites, `lib/claude-cli.ts` — see the
          // note in `api/ask/route.ts`. The health probe uses the same two
          // functions, which is what makes its verdict a claim about this path.
          cwd: claudeCwd(),
          env: claudeEnv(),
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
    } catch (err) {
      // A synchronous spawn failure (E2BIG was one) is the same answer as an
      // asynchronous one: the process never started, nothing was spent.
      promptFile.dispose();
      const e = err as NodeJS.ErrnoException;
      resolve({
        ok: false,
        outcome: "error",
        tokens: ZERO_TOKENS,
        latencyMs: Date.now() - started,
        code: classifyCliFailure({ spawnError: { code: e.code, message: e.message } }),
      });
      return;
    }
    child.on("close", promptFile.dispose);
    child.on("error", promptFile.dispose);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    // THE STOP BUTTON: the client aborts, the child dies, and the ledger says
    // `stopped` rather than classifying the kill as a backend failure.
    const stop = () => {
      if (!timedOut) stopped = true;
      child.kill("SIGKILL");
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    child.on("close", () => signal?.removeEventListener("abort", stop));
    let out = "";
    let errTail = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on(
      "data",
      (c: Buffer) => (errTail = (errTail + c.toString("utf8")).slice(-1000))
    );
    child.stdin.on("error", () => {});
    child.stdin.write(userPrompt);
    child.stdin.end();
    const failed = (tokens: TokenCounts, code: CliCode): CliResult => ({
      ok: false,
      outcome: endedTurnOutcome({ completed: false, timedOut, stopped }) as
        | "error"
        | "timeout"
        | "stopped",
      tokens,
      latencyMs: Date.now() - started,
      code,
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      // The process never started: nothing was spent and there is nothing to
      // price. ZERO_TOKENS here means "none were used", not "none were
      // counted" — and the caller writes the row ANYWAY, because a turn that
      // cost nothing is still a turn that failed (FR-3006).
      resolve(
        failed(
          ZERO_TOKENS,
          classifyCliFailure({ spawnError: { code: e.code, message: e.message } })
        )
      );
    });
    child.on("close", () => {
      clearTimeout(timeout);
      let j: {
        result?: string;
        is_error?: boolean;
        total_cost_usd?: number;
        duration_ms?: number;
        usage?: CliUsage;
      } | null = null;
      try {
        j = JSON.parse(out);
      } catch {
        // No parseable envelope at all — killed mid-write, or the CLI printed
        // something that is not its own JSON. Nothing countable came back, and
        // the plain text it printed instead is exactly what the classifier
        // wants to read: a lapsed sign-in fails here, before any JSON.
        return resolve(
          failed(
            ZERO_TOKENS,
            classifyCliFailure({ timedOut, text: `${errTail}\n${out}` })
          )
        );
      }
      // An `is_error` envelope still reports its usage, and those tokens were
      // spent: they are carried out rather than discarded with the failure.
      const tokens = tokensFromUsage(j?.usage);
      if (!j || j.is_error || typeof j.result !== "string") {
        return resolve(
          failed(
            tokens,
            classifyCliFailure({ timedOut, text: `${errTail}\n${j?.result ?? ""}` })
          )
        );
      }
      resolve({
        ok: true,
        text: j.result,
        cliCostUsd: typeof j.total_cost_usd === "number" ? j.total_cost_usd : null,
        tokens,
        latencyMs: j.duration_ms ?? Date.now() - started,
      });
    });
  });
}

interface RatingJson {
  score: number;
  verdict: Verdict;
  strengths: string[];
  gaps: string[];
  next_step: string;
}

function parseRating(text: string): RatingJson | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const score = Math.round(Number(j.score));
    const verdict = j.verdict as Verdict;
    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100 ||
      !["got_it", "nearly", "needs_work"].includes(verdict) ||
      !Array.isArray(j.strengths) ||
      !Array.isArray(j.gaps) ||
      typeof j.next_step !== "string"
    )
      return null;
    return {
      score,
      verdict,
      strengths: (j.strengths as unknown[]).map(String).slice(0, 4),
      gaps: (j.gaps as unknown[]).map(String).slice(0, 4),
      next_step: j.next_step,
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: {
    mode?: LessonMode;
    chatSession?: string;
    transcript?: InMsg[];
    turns?: number;
    /** lesson slug (e.g. "geo1-2") */
    lesson?: string;
    /** Finish pressed before the lesson was over (FR-204) */
    early?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const mode: LessonMode = body.mode === "review" ? "review" : "learn";
  const transcript = (body.transcript ?? []).slice(-60);
  const turns = Math.max(0, Math.round(Number(body.turns ?? 0)));
  const chatSession = String(body.chatSession ?? "").slice(0, 64);
  const early = body.early === true;
  if (transcript.length === 0) {
    return NextResponse.json({ error: "empty transcript" }, { status: 400 });
  }

  let me;
  try {
    me = await requireStudent();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
  // FR-2004: rating a lesson writes a mastery-adjacent record about a named
  // child. That is learning, and it waits for a confirmed address.
  if (!me.emailVerified) {
    return NextResponse.json({ error: "email_unverified" }, { status: 403 });
  }

  // UNIT ONE — the lesson slice and the sitting, before any model call.
  //
  // The lesson's own session (ADR-0015): the client does not send `chatSession`
  // here at all — which is exactly why the check could never be tied to the
  // lesson that produced it — so the session is found server-side by kind, and
  // this is the same sitting /api/ask has been writing turns into.
  const studentId = me.studentId;
  let data: NonNullable<Awaited<ReturnType<typeof getLessonData>>>;
  let sessionId: number | null;
  try {
    const pre = await withPrincipal(studentId, async (client) => {
      const d = await getLessonData(
        sanitizeLessonSlug(body.lesson),
        studentId,
        client
      );
      // The course gate (migration 023): `body.lesson` is a client-supplied
      // slug and this endpoint would otherwise rate — and therefore read the
      // objectives of — a lesson from a course this student may not have. A
      // null slice is refused before the session is opened, so a refused
      // rating leaves no sitting behind either.
      if (!d) return null;
      return {
        data: d,
        sessionId: await currentSessionOrNull(
          studentId,
          mode === "review" ? "lesson_review" : "lesson_learn",
          {
            surface: "understanding_check",
            loId: lessonAnchorLo(d),
            clientKey: chatSession || undefined,
            // A learn-mode sitting can OPEN here (the lesson's own sitting
            // closed or went idle before the rating), and later asks reuse
            // it — so its probing snapshot must be resolved with the lesson's
            // course, by the same resolver `/api/ask` uses (ADR-0021; fix
            // pass 2). Without it the resolver has no course and stores
            // probing=false for a maths lesson. Asked lazily: never with the
            // switch Off, never for review.
            ...(mode === "review"
              ? {}
              : { courseOf: () => lessonCourseId(body.lesson, client) }),
          },
          client
        ),
      };
    });
    // Same answer for "no such lesson" and "not yours", for the reason
    // `lib/lesson.ts` gives: two answers would let a client enumerate the
    // courses that exist but are switched off for this student.
    if (!pre) return NextResponse.json({ error: "not_found" }, { status: 404 });
    ({ data, sessionId } = pre);
  } catch (err) {
    const denied = await mapRlsError(err, {
      req,
      actorAccountId: me.accountId,
      targetStudentId: studentId,
      resource: "api/understanding",
    });
    if (denied) return denied;
    console.error("understanding: pre-rating reads failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  // The grading prompt is built in `lib/understanding-prompt.ts` — a pure
  // builder, so `scripts/capture-prompts.mts` can render it and constitution IX
  // has a surface to diff. It used to be four interpolations in the middle of
  // this handler, which is why it was one of the two prompts no gate covered.
  const systemPrompt = UNDERSTANDING_SYSTEM_PROMPT;
  const basePrompt = buildUnderstandingPrompt({
    mode,
    los: data.los,
    studentName: data.studentName,
    grade: data.grade,
    lessonRef: data.lessonRef,
    title: data.title,
    moduleLabel: data.moduleLabel,
    transcript,
    // FR-2602: the same register the tutor used this session, read from the
    // same one profile query (`getLessonData`) rather than a second one.
    gender: data.gender,
  });

  try {
    /** The CLI's own totals, summed over the attempts that reported one. */
    let cliCost: number | null = null;
    let tokens: TokenCounts = ZERO_TOKENS;
    let totalMs = 0;
    let rating: RatingJson | null = null;
    let rawOut = "";
    /** Set when an attempt failed outright, for the ledger row's outcome and
     *  for the short code the console's replay shows beside it. */
    let failure: {
      outcome: Extract<Outcome, "error" | "timeout" | "stopped">;
      code: CliCode;
    } | null = null;

    for (let attempt = 0; attempt < 2 && !rating; attempt++) {
      const prompt =
        attempt === 0
          ? basePrompt
          : understandingRetryPrompt(basePrompt, rawOut);
      // `req.signal`: the student's Stop kills the grading model mid-call, and
      // a Stop between the two attempts means the retry never starts.
      const r = await runClaudeJson(systemPrompt, prompt, req.signal);
      // Both branches spent tokens, so both branches accumulate them.
      tokens = addTokens(tokens, r.tokens);
      totalMs += r.latencyMs;
      if (!r.ok) {
        failure = { outcome: r.outcome, code: r.code };
        break;
      }
      failure = null;
      if (r.cliCostUsd !== null) cliCost = (cliCost ?? 0) + r.cliCostUsd;
      rawOut = r.text;
      rating = parseRating(r.text);
    }

    if (!rating) {
      // THE RATING FAILED, AND IT WAS NOT FREE. A full lesson transcript went
      // into the model on each attempt; writing no row is how the most
      // expensive failure in the product looks like nothing happened
      // (research A4.2). No `understanding_checks` row is written — there is no
      // rating — so this one is its own unit rather than a savepoint inside one.
      //
      // **AND IT IS WRITTEN EVEN WHEN NOTHING WAS SPENT** (FR-3006). The
      // `totalInputTokens(tokens) + tokens.outputTokens > 0` gate that used to
      // stand here was right about cost and wrong about health: a lapsed CLI
      // sign-in fails before a single token is counted, so the gate made the
      // console's passive signal blind to exactly the fault it exists to
      // catch. `costFor` answers `cost_usd = NULL` / `price_basis =
      // 'unpriced'` for an uncounted turn, so nothing is recorded as free that
      // was not — see `api/ask/route.ts`'s longer note on the same change.
      {
        const { costUsd, priceBasis } = costFor(MODEL, tokens, cliCost);
        try {
          await withPrincipal(studentId, (client) =>
            client.query(
              `INSERT INTO ai_interactions
                 (student_id, surface, turn_index, user_message, assistant_message,
                  grounding, citations, model, input_tokens, output_tokens,
                  cache_read_tokens, cache_creation_tokens, cost_usd, latency_ms,
                  environment, surface_kind, session_id, renderer_version,
                  outcome, price_basis, priced_at)
               VALUES ($1,'understanding_check',1,$2,$3,$4,'[]',$5,$6,$7,$8,$9,$10,$11,$12,
                       'understanding',$13,$14,$15,$16,now())`,
              [
                studentId,
                `[rate ${mode} session — ${transcript.length} transcript lines]`,
                failure?.outcome === "stopped"
                  ? "[no rating — stopped by the student]"
                  : failure
                    ? `[no rating — the grading model ${failure.outcome === "timeout" ? "timed out" : "failed"}: ${failure.code}]`
                    : "[no rating — the grading model returned invalid JSON twice]",
                JSON.stringify({
                  chat_session: chatSession,
                  mode,
                  lesson: data.slug,
                  lo_ids: data.los.map((l) => l.id),
                }),
                MODEL,
                tokens.inputTokens,
                tokens.outputTokens,
                tokens.cacheReadTokens,
                tokens.cacheCreationTokens,
                costUsd,
                totalMs,
                ENVIRONMENT,
                sessionId,
                RELEASE_TAG,
                failure?.outcome ?? "error",
                priceBasis,
              ]
            )
          );
        } catch (e) {
          console.error("understanding: failed to log a failed rating:", e);
        }
      }
      if (failure?.outcome === "stopped") {
        // Nobody is waiting for this body — the client aborted — but a
        // status that is not a 5xx keeps a proxy's error rate honest.
        return NextResponse.json({ stopped: true }, { status: 499 });
      }
      return NextResponse.json(
        { error: "rating model returned invalid JSON twice" },
        { status: 502 }
      );
    }

    // UNIT TWO — the rating and its cost row, after the model has answered and
    // with no connection held while it did.
    let mastery: ReportMastery | undefined;
    const id = await withPrincipal(studentId, async (client) => {
      const ins = await client.query(
        `INSERT INTO understanding_checks
           (student_id, lo_id, session_id, mode, score, verdict, strengths, gaps,
            next_step, turns, subject)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          studentId,
          lessonAnchorLo(data),
          sessionId,
          mode,
          rating.score,
          rating.verdict,
          JSON.stringify(rating.strengths),
          JSON.stringify(rating.gaps),
          rating.next_step,
          turns,
          // the subject key stored on the rating row: an EXACT registry
          // mapping, not a two-armed guess that filed everything else as maths
          spineKeyOf(data.subject),
        ]
      );
      const checkId = Number(ins.rows[0].id);

      // "Where you are today" from STORED mastery ("One mastery rule" M2): the
      // lesson level now, what moved since this sitting opened (the mastery
      // table is bitemporal, so the score at the sitting's start is a read,
      // not something to store), and how many checked answers she gave in it.
      const loIds = data.los.map((l) => l.id);
      const m = await client.query(
        `WITH s AS (SELECT opened_at FROM sessions WHERE id = $3)
         SELECT
           (SELECT coalesce(json_object_agg(lo_id, score), '{}') FROM mastery
             WHERE student_id = $1 AND lo_id = ANY($2) AND system_to IS NULL) AS now,
           (SELECT coalesce(json_object_agg(lo_id, score), '{}') FROM mastery, s
             WHERE student_id = $1 AND lo_id = ANY($2)
               AND system_from <= s.opened_at
               AND (system_to IS NULL OR system_to > s.opened_at)) AS at_start,
           -- the sitting is this lesson's own, so its attempts are this lesson's
           (SELECT count(*) FROM attempts
             WHERE student_id = $1 AND session_id = $3)::int AS answered`,
        [studentId, loIds, sessionId]
      );
      const nowBy: Record<string, number> = m.rows[0].now ?? {};
      // no sitting to anchor to: nothing can be said to have moved
      const startBy: Record<string, number> = sessionId === null ? nowBy : (m.rows[0].at_start ?? {});
      mastery = reportMastery(
        data.los.map((l) => ({
          label: l.label,
          now: Number(nowBy[l.id] ?? 0),
          atStart: Number(startBy[l.id] ?? 0),
        })),
        Number(m.rows[0].answered ?? 0)
      );

      // Cost instrumentation — every LLM call is logged (PRD hard requirement).
      // Behind a SAVEPOINT because the rule this code already stated is that
      // instrumentation is observability, not behaviour: it used to be a
      // separate statement in its own try/catch, and inside one transaction a
      // bare failure here would roll back the rating the student is waiting to
      // read. The savepoint keeps the old degradation with the new atomicity.
      await client.query("SAVEPOINT cost_row");
      try {
        const { costUsd, priceBasis } = costFor(MODEL, tokens, cliCost);
        await client.query(
          `INSERT INTO ai_interactions
             (student_id, surface, turn_index, user_message, assistant_message,
              grounding, citations, model, input_tokens, output_tokens,
              cache_read_tokens, cache_creation_tokens, cost_usd, latency_ms,
              environment, surface_kind, session_id, renderer_version,
              outcome, price_basis, priced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'understanding',
                   $16,$17,'ok',$18,now())`,
          [
            studentId,
            "understanding_check",
            1,
            `[rate ${mode} session — ${transcript.length} transcript lines]`,
            rawOut.slice(0, 4000),
            JSON.stringify({
              chat_session: chatSession,
              mode,
              lesson: data.slug,
              lo_ids: data.los.map((l) => l.id),
              check_id: checkId,
            }),
            JSON.stringify([]),
            MODEL,
            // UNCACHED input, and the two cache counters beside it — this
            // route summed all three into `input_tokens` and wrote no cache
            // columns at all, so a rating's cache hits were invisible (A0.2).
            tokens.inputTokens,
            tokens.outputTokens,
            tokens.cacheReadTokens,
            tokens.cacheCreationTokens,
            costUsd,
            totalMs,
            ENVIRONMENT,
            sessionId,
            // The build that produced this check's report card (ADR-0015 §3) —
            // the console replays the verdict through the student's own
            // ReportCard, so it has to know which one drew it.
            RELEASE_TAG,
            priceBasis,
          ]
        );
        await client.query("RELEASE SAVEPOINT cost_row");
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT cost_row");
        console.error("understanding: failed to log ai_interaction:", e);
      }
      return checkId;
    });

    // A rating after the lesson is over IS the end of the lesson — the client
    // discards its resume key on the same response (LessonSession `finish`).
    // Closing here is the only place `completed` is ever written; without it
    // every sitting would end up swept as `inactivity`, and FR-2302's "did she
    // finish, or walk away" would have one answer for both.
    //
    // An EARLY Finish is not that (FR-204): the student stopped halfway and
    // keeps her place. The sitting is left open, so continuing within the idle
    // window carries on in it and otherwise the sweep closes it as
    // `inactivity` — a stop recorded as one, never as `completed`.
    //
    // Its own unit, deliberately: a failure to close must not undo the rating
    // the student is waiting to read.
    if (sessionId !== null && !early) {
      try {
        await closeSession(studentId, sessionId, "completed");
      } catch (e) {
        console.error("understanding: failed to close the session:", e);
      }
    }

    const check: UnderstandingCheck = {
      id,
      mode,
      score: rating.score,
      verdict: rating.verdict,
      strengths: rating.strengths,
      gaps: rating.gaps,
      nextStep: rating.next_step,
      turns,
      mastery,
    };
    // The same figure the ledger row carries, arrived at the same way — an
    // imputation at list price, never money that left an account.
    return NextResponse.json({
      check,
      costUsd: costFor(MODEL, tokens, cliCost).costUsd ?? 0,
    });
  } catch (err) {
    const denied = await mapRlsError(err, {
      req,
      actorAccountId: me.accountId,
      targetStudentId: studentId,
      resource: "api/understanding",
    });
    if (denied) return denied;
    console.error("understanding POST failed:", err);
    return NextResponse.json(
      { error: "rating backend unavailable" },
      { status: 502 }
    );
  }
}

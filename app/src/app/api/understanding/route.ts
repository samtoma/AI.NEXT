import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { withPrincipal } from "@/lib/db";
import { AuthError, requireStudent } from "@/lib/auth/principal";
import { mapRlsError } from "@/lib/rls-errors";
import { ENVIRONMENT, RELEASE_TAG } from "@/lib/env";
import {
  getLessonData,
  lessonAnchorLo,
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
  totalInputTokens,
  type CliUsage,
  type Outcome,
  type TokenCounts,
} from "@/lib/pricing";
import type { LessonMode, UnderstandingCheck, Verdict } from "@/lib/types";

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
      outcome: Extract<Outcome, "error" | "timeout">;
      tokens: TokenCounts;
      latencyMs: number;
      detail: string;
    };

function runClaudeJson(
  systemPrompt: string,
  userPrompt: string
): Promise<CliResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let timedOut = false;
    const child = spawn(
      "claude",
      [
        "-p",
        "--output-format",
        "json",
        "--model",
        MODEL,
        "--system-prompt",
        systemPrompt,
        "--disallowedTools",
        "*",
        "--max-turns",
        "1",
      ],
      {
        cwd: process.env.TMPDIR ?? "/tmp",
        env: {
          ...process.env,
          PATH: `${process.env.PATH ?? ""}:${process.env.HOME ?? ""}/.local/bin`,
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
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
    const failed = (tokens: TokenCounts, detail: string): CliResult => ({
      ok: false,
      outcome: timedOut ? "timeout" : "error",
      tokens,
      latencyMs: Date.now() - started,
      detail,
    });
    child.on("error", (e) => {
      clearTimeout(timeout);
      // The process never started: nothing was spent and there is nothing to
      // price. ZERO_TOKENS here means "none were used", not "none were counted"
      // — the caller writes no row for it.
      resolve(failed(ZERO_TOKENS, String(e)));
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
        // something that is not its own JSON. Nothing countable came back.
        return resolve(failed(ZERO_TOKENS, errTail.slice(-300)));
      }
      // An `is_error` envelope still reports its usage, and those tokens were
      // spent: they are carried out rather than discarded with the failure.
      const tokens = tokensFromUsage(j?.usage);
      if (!j || j.is_error || typeof j.result !== "string") {
        return resolve(failed(tokens, errTail.slice(-300) || "cli reported is_error"));
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
  let data: Awaited<ReturnType<typeof getLessonData>>;
  let sessionId: number | null;
  try {
    ({ data, sessionId } = await withPrincipal(studentId, async (client) => {
      const d = await getLessonData(
        sanitizeLessonSlug(body.lesson),
        studentId,
        client
      );
      return {
        data: d,
        sessionId: await currentSessionOrNull(
          studentId,
          mode === "review" ? "lesson_review" : "lesson_learn",
          {
            surface: "understanding_check",
            loId: lessonAnchorLo(d),
            clientKey: chatSession || undefined,
          },
          client
        ),
      };
    }));
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
    /** Set when an attempt failed outright, for the ledger row's outcome. */
    let failure: { outcome: Extract<Outcome, "error" | "timeout">; detail: string } | null =
      null;

    for (let attempt = 0; attempt < 2 && !rating; attempt++) {
      const prompt =
        attempt === 0
          ? basePrompt
          : understandingRetryPrompt(basePrompt, rawOut);
      const r = await runClaudeJson(systemPrompt, prompt);
      // Both branches spent tokens, so both branches accumulate them.
      tokens = addTokens(tokens, r.tokens);
      totalMs += r.latencyMs;
      if (!r.ok) {
        failure = { outcome: r.outcome, detail: r.detail };
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
      if (totalInputTokens(tokens) + tokens.outputTokens > 0) {
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
                failure
                  ? `[no rating — the grading model ${failure.outcome === "timeout" ? "timed out" : "failed"}]`
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
      return NextResponse.json(
        { error: "rating model returned invalid JSON twice" },
        { status: 502 }
      );
    }

    // UNIT TWO — the rating and its cost row, after the model has answered and
    // with no connection held while it did.
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

    // The rating IS the end of the lesson — the client discards its resume key
    // on the same response (LessonSession.tsx:568). Closing here is the only
    // place `completed` is ever written; without it every sitting would end up
    // swept as `inactivity`, and FR-2302's "did she finish, or walk away"
    // would have one answer for both.
    //
    // Its own unit, deliberately: a failure to close must not undo the rating
    // the student is waiting to read.
    if (sessionId !== null) {
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

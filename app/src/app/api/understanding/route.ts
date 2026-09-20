import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { withPrincipal } from "@/lib/db";
import { AuthError, requireStudent } from "@/lib/auth/principal";
import { mapRlsError } from "@/lib/rls-errors";
import { ENVIRONMENT } from "@/lib/env";
import {
  getLessonData,
  lessonAnchorLo,
  sanitizeLessonSlug,
} from "@/lib/lesson";
import { deriveMasteryStage, learnOpeningFrame } from "@/lib/checkin";
import { spineKeyOf } from "@/lib/subjects";
import { closeSession, currentSessionOrNull } from "@/lib/sessions";
import { gradeLabel } from "@/lib/profile";
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

interface CliResult {
  text: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

function runClaudeJson(
  systemPrompt: string,
  userPrompt: string
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
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
    const timeout = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
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
    child.on("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      try {
        const j = JSON.parse(out) as {
          result?: string;
          is_error?: boolean;
          total_cost_usd?: number;
          duration_ms?: number;
          usage?: {
            input_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
            output_tokens?: number;
          };
        };
        if (j.is_error || typeof j.result !== "string")
          throw new Error("cli error");
        const u = j.usage ?? {};
        resolve({
          text: j.result,
          costUsd: j.total_cost_usd ?? 0,
          inputTokens:
            (u.input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0),
          outputTokens: u.output_tokens ?? 0,
          latencyMs: j.duration_ms ?? Date.now() - started,
        });
      } catch {
        reject(new Error(`claude CLI failed — ${errTail.slice(-300)}`));
      }
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

  const loLines = data.los
    .map((l) => `- ${l.id} "${l.label}": ${l.description ?? ""}`)
    .join("\n");

  const systemPrompt = `You are the honest comprehension grader of Noor, an adaptive math tutor. You rate how well the student actually understood a lesson, based ONLY on the session transcript. You output STRICT JSON and nothing else — no markdown fences, no prose.`;

  const transcriptText = transcript
    .map((m) =>
      m.role === "user"
        ? `Student: ${m.text}`
        : m.role === "assistant"
          ? `Tutor: ${m.text}`
          : `[live event] ${m.text}`
    )
    .join("\n");

  // Same mastery-stage premise the learn-mode tutor prompt opens with
  // (lib/lesson.ts `learnOpeningFrame`) — the grader must not judge the
  // session against a "he understood NOTHING" starting point when the real
  // one might be "first time seeing this" or "already handles it well".
  const sessionDesc =
    mode === "learn"
      ? `AI-taught lesson (${learnOpeningFrame(deriveMasteryStage(data.los), data.studentName.split(" ")[0]).premise})`
      : `quick revision (the student said he understood everything at school)`;
  const basePrompt = `Session: ${sessionDesc}.
Student: ${data.studentName}, ${gradeLabel(data.grade).toLowerCase()}. Lesson: ${data.lessonRef} — ${data.title} (${data.moduleLabel}).
Learning objectives covered:
${loLines}

GRADING RULES:
- Weigh ACTUAL performance — the "[live event]" lines (question attempts ✓/✗, widget results) — far above self-report or politeness.
- Be honest but fair: in learn mode, visible progress across the session counts in his favor; early mistakes that were later corrected are progress, not failure.
- verdict bands: got_it = score >= 80, nearly = 55–79, needs_work < 55.
- strengths and gaps: 1–4 short concrete phrases each, referencing the actual content of THIS lesson (its objectives, figures, and exercises as they appeared in the transcript). gaps may be empty ([]) if there truly are none.
- next_step: ONE actionable, encouraging sentence for tomorrow. Never punitive.

Return STRICT JSON exactly in this shape:
{"score": <integer 0-100>, "verdict": "got_it" | "nearly" | "needs_work", "strengths": ["...", ...], "gaps": ["...", ...], "next_step": "..."}

TRANSCRIPT:
${transcriptText}`;

  try {
    let totalCost = 0;
    let totalIn = 0;
    let totalOut = 0;
    let totalMs = 0;
    let rating: RatingJson | null = null;
    let rawOut = "";

    for (let attempt = 0; attempt < 2 && !rating; attempt++) {
      const prompt =
        attempt === 0
          ? basePrompt
          : `${basePrompt}\n\nYour previous output was INVALID:\n${rawOut.slice(0, 500)}\nReturn ONLY the strict JSON object this time. No other text.`;
      const r = await runClaudeJson(systemPrompt, prompt);
      totalCost += r.costUsd;
      totalIn += r.inputTokens;
      totalOut += r.outputTokens;
      totalMs += r.latencyMs;
      rawOut = r.text;
      rating = parseRating(r.text);
    }

    if (!rating) {
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
        await client.query(
          `INSERT INTO ai_interactions
             (student_id, surface, turn_index, user_message, assistant_message,
              grounding, citations, model, input_tokens, output_tokens,
              cost_usd, latency_ms, environment, surface_kind, session_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'understanding',$14)`,
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
            totalIn,
            totalOut,
            totalCost,
            totalMs,
            ENVIRONMENT,
            sessionId,
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
    return NextResponse.json({ check, costUsd: totalCost });
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

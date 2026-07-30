import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  getLessonData,
  lessonAnchorLo,
  sanitizeLessonSlug,
} from "@/lib/lesson";
import { spineKeyOf } from "@/lib/subjects";
import { resolveStudentId } from "@/lib/student-context";
import type { LessonMode, UnderstandingCheck, Verdict } from "@/lib/types";

/**
 * POST /api/understanding — the honest comprehension rating.
 *
 * Sends the full lesson transcript (incl. widget/question [live event] lines)
 * to the LLM asking for STRICT JSON {score, verdict, strengths, gaps,
 * next_step}; parses (one retry on invalid output), inserts the row into
 * understanding_checks, and logs cost to ai_interactions.
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

  // Which demo student this comprehension check belongs to — a cookie,
  // validated against the students table, defaulting to Omar. DEMO
  // AFFORDANCE, NOT AUTH: auth is a PRD §3 non-goal for the MVP
  // (see lib/demo-student.ts).
  const studentId = await resolveStudentId();

  const data = await getLessonData(sanitizeLessonSlug(body.lesson), studentId);
  const loLines = data.los
    .map((l) => `- ${l.id} "${l.label}": ${l.description ?? ""}`)
    .join("\n");

  const systemPrompt = `You are the honest comprehension grader of AI.Next, an adaptive math tutor. You rate how well the student actually understood a lesson, based ONLY on the session transcript. You output STRICT JSON and nothing else — no markdown fences, no prose.`;

  const transcriptText = transcript
    .map((m) =>
      m.role === "user"
        ? `Student: ${m.text}`
        : m.role === "assistant"
          ? `Tutor: ${m.text}`
          : `[live event] ${m.text}`
    )
    .join("\n");

  const basePrompt = `Session: ${mode === "learn" ? `AI-taught lesson (the student said he understood NOTHING at school and was taught from zero)` : `quick revision (the student said he understood everything at school)`}.
Student: ${data.studentName}, grade 10. Lesson: ${data.lessonRef} — ${data.title} (${data.moduleLabel}).
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

    const ins = await pool.query(
      `INSERT INTO understanding_checks
         (student_id, lo_id, mode, score, verdict, strengths, gaps, next_step, turns, subject)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        studentId,
        lessonAnchorLo(data),
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
    const id = Number(ins.rows[0].id);

    // cost instrumentation — every LLM call is logged (PRD hard requirement)
    try {
      await pool.query(
        `INSERT INTO ai_interactions
           (student_id, surface, turn_index, user_message, assistant_message,
            grounding, citations, model, input_tokens, output_tokens,
            cost_usd, latency_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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
            check_id: id,
          }),
          JSON.stringify([]),
          MODEL,
          totalIn,
          totalOut,
          totalCost,
          totalMs,
        ]
      );
    } catch (e) {
      console.error("understanding: failed to log ai_interaction:", e);
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
    console.error("understanding POST failed:", err);
    return NextResponse.json(
      { error: "rating backend unavailable" },
      { status: 502 }
    );
  }
}

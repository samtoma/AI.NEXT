import { spawn } from "node:child_process";
import { pool } from "@/lib/db";
import { buildAskContext, type AskSurface } from "@/lib/ask";
import { buildLessonContext } from "@/lib/lesson";
import { snapshotContext } from "@/lib/session-cache";

/**
 * POST /api/ask — "Ask the Spine" grounded chat, streamed as SSE.
 *
 * LLM backend: the locally-authenticated `claude` CLI in print mode with
 * stream-json output. We pass a custom --system-prompt (grounding rules) and
 * the curriculum data + transcript on stdin, parse the JSONL stream, and
 * re-emit text deltas as SSE. The final "result" line carries cost/usage,
 * which we log to ai_interactions (cost ceiling is a PRD hard requirement).
 */

export const dynamic = "force-dynamic";

const STUDENT_ID = 1;
const MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 90_000;

type Surface = AskSurface | "lesson_learn" | "lesson_review";

/** Per-surface AI-turn caps (server-enforced, PRD cost discipline). */
const TURN_CAPS: Record<Surface, number | null> = {
  spine_chat: null,
  student_chat: 2, // PRD §6.3: max 2 AI turns per question
  lesson_learn: 14, // generous ceiling for a full taught lesson
  lesson_review: 5, // the non-annoying path: hard ≤ 5 turns
};

const CAP_MESSAGES: Partial<Record<Surface, string>> = {
  student_chat:
    "We've walked through this one together twice now — that's my limit, on purpose. The canonical steps above are the reviewed ground truth, and they're the best guide from here: read them once more, slowly, saying each step out loud. Then move on and come back to this topic tomorrow — spacing helps more than a third explanation would. You're closer than you think.",
  lesson_learn:
    "That's a full lesson's worth of work for one evening — let's stop here and see how far you've come. Tap Finish for your report.",
  lesson_review:
    "That's our whole 3 minutes — تمام. Let's see your score.",
};

interface InMsg {
  role: "user" | "assistant" | "note";
  text: string;
}

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

function extractCitations(text: string) {
  const cites: { kind: string; id: string }[] = [];
  const re = /\[\[(lo|q|page):([^\]\n]{1,80})\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    const id = m[1] === "page" ? m[2] : `${m[1]}:${m[2]}`;
    if (!cites.some((c) => c.kind === m![1] && c.id === id))
      cites.push({ kind: m[1], id });
  }
  const are = /\{\{(show_question|highlight):([^}\n]{1,160})\}\}/g;
  while ((m = are.exec(text))) cites.push({ kind: m[1], id: m[2] });
  const wre = /\{\{widget:([a-z_]{1,40}):/g;
  while ((m = wre.exec(text))) cites.push({ kind: "widget", id: m[1] });
  if (text.includes("{{finish_lesson}}"))
    cites.push({ kind: "finish_lesson", id: "finish_lesson" });
  return cites;
}

export async function POST(req: Request) {
  let body: {
    surface?: Surface;
    chatSession?: string;
    messages?: InMsg[];
    questionId?: string;
    wrongAnswer?: string;
    /** lesson slug for the lesson surfaces (e.g. "geo1-2") */
    lesson?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
    });
  }
  const surface: Surface =
    body.surface === "student_chat" ||
    body.surface === "lesson_learn" ||
    body.surface === "lesson_review"
      ? body.surface
      : "spine_chat";
  const chatSession = String(body.chatSession ?? "").slice(0, 64);
  const messages = (body.messages ?? []).slice(-24);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!chatSession || !lastUser) {
    return new Response(
      JSON.stringify({ error: "chatSession and a user message are required" }),
      { status: 400 }
    );
  }

  // server-side turn count for this chat session (drives the per-surface caps)
  const turnsRes = await pool.query(
    `SELECT count(*) AS n FROM ai_interactions
     WHERE surface = $1 AND grounding->>'chat_session' = $2`,
    [surface, chatSession]
  );
  const priorTurns = Number(turnsRes.rows[0].n);
  const cap = TURN_CAPS[surface];

  if (cap != null && priorTurns >= cap) {
    return new Response(
      sse({ type: "cap", text: CAP_MESSAGES[surface] ?? "Session limit reached." }),
      { headers: { "Content-Type": "text/event-stream" } }
    );
  }

  // Grounding is snapshotted per chat session: byte-stable across turns so
  // the (system prompt + data block) prefix stays prompt-cache-hot, and the
  // mastery numbers the model reasons over never shift mid-conversation.
  const snapshotKey = [
    surface,
    chatSession,
    body.lesson ?? "",
    body.questionId ?? "",
    body.wrongAnswer ?? "",
  ].join("|");
  const ctx = await snapshotContext(snapshotKey, () =>
    surface === "lesson_learn" || surface === "lesson_review"
      ? buildLessonContext(
          surface === "lesson_learn" ? "learn" : "review",
          chatSession,
          body.lesson
        )
      : buildAskContext(surface, chatSession, body.questionId, body.wrongAnswer)
  );

  const transcript = messages
    .map((m) =>
      m.role === "user"
        ? `User: ${m.text}`
        : m.role === "assistant"
          ? `Tutor: ${m.text}`
          : `[live event] ${m.text}`
    )
    .join("\n\n");

  // Data block rides in the SYSTEM prompt: stable prefix (cache hits), while
  // the per-turn user prompt carries only the growing transcript.
  const systemPrompt = `${ctx.systemPrompt}

${ctx.dataBlock}`;

  const userPrompt = `CONVERSATION SO FAR:
${transcript}

Reply as the Tutor to the last user message. Output only the reply text (with citation markers and, if fitting, one action directive).`;

  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(sse(obj)));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };

      const child = spawn(
        "claude",
        [
          "-p",
          "--output-format",
          "stream-json",
          "--include-partial-messages",
          "--verbose",
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
            // Samuel (2026-07-18): PoC quality over cost — thinking re-enabled,
            // but BOUNDED: unbounded adaptive thinking measured 30–60s dead-air
            // stalls mid-lesson. 6k budget keeps deliberation on hard explanation
            // turns while capping the stall. Tune via AINEXT_THINKING_BUDGET;
            // revisit at the runtime ADR (CLI→API swap).
            MAX_THINKING_TOKENS: process.env.AINEXT_THINKING_BUDGET ?? "6000",
          },
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, TIMEOUT_MS);
      req.signal.addEventListener("abort", () => child.kill("SIGKILL"));

      let fullText = "";
      let result: {
        total_cost_usd?: number;
        usage?: {
          input_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
          output_tokens?: number;
        };
        duration_ms?: number;
        is_error?: boolean;
        result?: string;
      } | null = null;
      let stderrTail = "";
      let buf = "";

      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let j: {
            type?: string;
            event?: {
              type?: string;
              delta?: { type?: string; text?: string };
            };
          } & Record<string, unknown>;
          try {
            j = JSON.parse(line);
          } catch {
            continue;
          }
          if (
            j.type === "stream_event" &&
            j.event?.type === "content_block_delta" &&
            j.event.delta?.type === "text_delta" &&
            typeof j.event.delta.text === "string"
          ) {
            fullText += j.event.delta.text;
            send({ type: "delta", t: j.event.delta.text });
          } else if (j.type === "result") {
            result = j as typeof result;
          }
        }
      });
      child.stderr.on("data", (c: Buffer) => {
        stderrTail = (stderrTail + c.toString("utf8")).slice(-2000);
      });
      child.stdin.on("error", () => {
        /* EPIPE if child died early — surfaced via close handler */
      });
      child.stdin.write(userPrompt);
      child.stdin.end();

      child.on("error", () => {
        clearTimeout(timeout);
        send({ type: "error", message: "AI backend unavailable" });
        finish();
      });

      child.on("close", async (code) => {
        clearTimeout(timeout);
        if (result == null || result.is_error || !fullText) {
          console.error(
            `ask: claude CLI failed (code ${code}) — ${stderrTail.slice(-400)}`
          );
          send({
            type: "error",
            message: "AI backend unavailable — please try again",
          });
          finish();
          return;
        }

        const u = result.usage ?? {};
        const cacheReadTokens = u.cache_read_input_tokens ?? 0;
        const cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
        const inputTokens =
          (u.input_tokens ?? 0) + cacheCreationTokens + cacheReadTokens;
        const outputTokens = u.output_tokens ?? 0;
        const costUsd = result.total_cost_usd ?? 0;
        const latencyMs = result.duration_ms ?? Date.now() - started;
        const citations = extractCitations(fullText);

        let interactionId: number | null = null;
        try {
          const ins = await pool.query(
            `INSERT INTO ai_interactions
               (student_id, surface, turn_index, user_message, assistant_message,
                grounding, citations, model, input_tokens, output_tokens,
                cache_read_tokens, cache_creation_tokens, cost_usd, latency_ms)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             RETURNING id`,
            [
              STUDENT_ID,
              surface,
              priorTurns + 1,
              lastUser.text,
              fullText,
              JSON.stringify(ctx.grounding),
              JSON.stringify(citations),
              MODEL,
              inputTokens,
              outputTokens,
              cacheReadTokens,
              cacheCreationTokens,
              costUsd,
              latencyMs,
            ]
          );
          interactionId = ins.rows[0].id;
        } catch (e) {
          console.error("ask: failed to log ai_interaction:", e);
        }

        send({
          type: "done",
          meta: {
            costUsd,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            latencyMs,
            model: MODEL,
            interactionId,
            turnIndex: priorTurns + 1,
            capped: cap != null && priorTurns + 1 >= cap,
          },
        });
        finish();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

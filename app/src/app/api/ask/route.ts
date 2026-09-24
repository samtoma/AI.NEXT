import { spawn } from "node:child_process";
import { withPrincipal } from "@/lib/db";
import { AuthError, requireStudent } from "@/lib/auth/principal";
import { ENVIRONMENT, RELEASE_TAG } from "@/lib/env";
import { buildAskContext, type AskSurface } from "@/lib/ask";
import {
  CLAUDE_BIN,
  claudeCwd,
  claudeEnv,
  classifyCliFailure,
} from "@/lib/claude-cli";
import { buildLessonContext, lessonCourseId } from "@/lib/lesson";
import { getAllSacredPassages } from "@/lib/lesson-content";
import {
  makeSacredGuard,
  SACRED_HOLDBACK_CHARS,
  type SacredGuard,
} from "@/lib/sacred-guard";
import { snapshotContext, snapshotKey } from "@/lib/session-cache";
import { coerceUploadId } from "@/lib/upload-contract";
import { getStudentProfile } from "@/lib/student-context";
import { currentSessionSnapshot } from "@/lib/sessions";
import {
  ZERO_TOKENS,
  costFor,
  tokensFromUsage,
  type Outcome,
  type TokenCounts,
} from "@/lib/pricing";

/**
 * POST /api/ask — "Ask the Spine" grounded chat, streamed as SSE.
 *
 * LLM backend: the locally-authenticated `claude` CLI in print mode with
 * stream-json output. We pass a custom --system-prompt (grounding rules) and
 * the curriculum data + transcript on stdin, parse the JSONL stream, and
 * re-emit text deltas as SSE. The final "result" line carries cost/usage,
 * which we log to ai_interactions (cost ceiling is a PRD hard requirement).
 *
 * TWO UNITS OF WORK, and the gap between them is the point (research R7).
 *
 *   unit 1  the turn count, the session, the grounding assembly — everything
 *           the turn needs to exist. Then the connection is RELEASED.
 *   …       the model streams for tens of seconds, holding nothing.
 *   unit 2  the ledger row, once there is something to record.
 *
 * A single unit spanning the model call would be correct and would also be the
 * fastest way to exhaust a pool of twenty: eighteen concurrent lesson turns and
 * the nineteenth student's sign-in waits on somebody else's tutor finishing a
 * sentence. Nothing in this file may hold a client across `spawn`.
 *
 * EVERY TURN THAT SPENDS TOKENS LEAVES A ROW (research A0.2/A0.3, plan A7).
 * Three write paths, one `logTurn`, and the differences between them are in the
 * `outcome` and the price basis rather than in three copies of an INSERT:
 *
 *   ok        the model answered. The CLI's own `total_cost_usd`.
 *   redacted  the sacred guard tripped and the child was killed mid-stream, so
 *             the CLI never reported a total. This used to write five literal
 *             zeros — "a redacted turn cost real money and is recorded as
 *             free, on exactly the turns we most want to examine". It now
 *             writes the counters seen on the stream, repriced at list price.
 *   error /   the backend failed or timed out. This used to write nothing at
 *   timeout   all, which is how a failing day looks cheap. **Since 2026-09-22
 *             it also writes when NO tokens are known** — the row carries
 *             `cost_usd = NULL` and `price_basis = 'unpriced'` rather than a
 *             fabricated zero, because a turn that never reached the model
 *             genuinely cost nothing and is still a failed turn. That case is
 *             exactly what a lapsed CLI sign-in looks like, and gating it away
 *             made the console's health signal blind to the one fault it was
 *             built to catch (FR-3006). The failure is also classified into a
 *             short stable code (`lib/claude-cli.ts`) so the console's replay
 *             says *which* backend failure it was.
 *
 * And `input_tokens` is now UNCACHED input only (`lib/pricing.ts`), with the
 * two cache counters beside it as they always were in their own columns.
 *
 * THE LESSON'S PROBING SNAPSHOT (ADR-0021, v0.7.0). Whether this turn's
 * system prompt carries the Socratic-probing block is decided by the learning
 * session's stored `probing` column — resolved once when that session opened
 * (`lib/sessions.ts`) and read back here — and by nothing the request says.
 * The value the prompt was actually built with goes to the client as the
 * stream's first frame, `{type:"session", probing}`, so the cards follow the
 * prompt rather than a guess. An older client ignores a frame type it does not
 * know, which is every client before this one.
 */

export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 90_000;

type Surface = AskSurface | "lesson_learn" | "lesson_review";

/** Per-surface AI-turn caps (server-enforced, PRD cost discipline). */
const TURN_CAPS: Record<Surface, number | null> = {
  spine_chat: null,
  student_chat: 2, // PRD §6.3: max 2 AI turns per question
  // Raised 14 -> 18 for the Socratic arc (#33, #34, #35). Asking the student
  // to try a step before it is explained, asking how he got there, and ending
  // on a from-memory retrieval all cost TURNS — that is what they are. At 14
  // a full lesson reached the cap before the final retrieval could happen, so
  // the fix for #34 would have been silently skipped on exactly the lessons
  // that ran long. A cap that truncates the ending is worse than no ending
  // rule at all. Cost implication is real and deliberate: ~29% more turns on
  // the most expensive surface, for the teaching behaviour the pilot exists
  // to test (SC-005).
  lesson_learn: 18,
  lesson_review: 5, // the non-annoying path: hard ≤ 5 turns
};

const CAP_MESSAGES: Partial<Record<Surface, string>> = {
  student_chat:
    "We've walked through this one together twice now — that's my limit, on purpose. The canonical steps above are the ground truth, and they're the best guide from here: read them once more, slowly, saying each step out loud. Then move on and come back to this topic tomorrow — spacing helps more than a third explanation would. You're closer than you think.",
  lesson_learn:
    "That's a full lesson's worth of work for one evening — let's stop here and see how far you've come. Tap Finish for your report.",
  lesson_review:
    "That's our whole 3 minutes — done. Let's see your score.",
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
    /** a worksheet the student photographed, to ground this turn on (FR-205) */
    uploadId?: unknown;
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
  /**
   * THE GROUNDING LINK for an uploaded worksheet (FR-205, PRD B10).
   *
   * A positive safe integer or nothing — `coerceUploadId` is the whole of the
   * validation, and it is deliberately NOT an ownership check. The id travels
   * down to `getParsedUpload(uploadId, studentId)`, which runs inside the
   * student's own unit of work under a row-level-security policy on `uploads`
   * that is enabled AND forced: an id belonging to another student produces no
   * row there, not a row this layer would then have to filter. A second check
   * here could only ever drift from the one that actually holds, and on the day
   * they disagreed the weaker one would be the one people trusted, because it
   * is the one they can see. The scoped read IS the check.
   *
   * A malformed id is dropped silently rather than refused: the turn is a
   * student's question and it must still be answered, just without the
   * worksheet in its grounding.
   */
  const uploadId = coerceUploadId(body.uploadId);
  const messages = (body.messages ?? []).slice(-24);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!chatSession || !lastUser) {
    return new Response(
      JSON.stringify({ error: "chatSession and a user message are required" }),
      { status: 400 }
    );
  }

  // Whose mastery grounds this turn. From the verified access token, never
  // from the request (FR-2102). Resolved BEFORE the turn-cap check, because the
  // cap is scoped per student and no student may inherit another's turn count.
  let me;
  try {
    me = await requireStudent();
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
  // FR-2004: a tutor turn is learning, and learning waits for a confirmed
  // address. It is also the most expensive thing an unverified signup could do.
  if (!me.emailVerified) {
    return Response.json({ error: "email_unverified" }, { status: 403 });
  }
  const studentId = me.studentId;

  // ---------------------------------------------------------------------
  // UNIT ONE — everything the turn needs before the model is spawned.
  // ---------------------------------------------------------------------
  let priorTurns: number;
  /** Turns the student actually received; what the cap counts. */
  let deliveredTurns: number;
  let sessionId: number | null;
  let ctx: Awaited<ReturnType<typeof buildAskContext>>;
  /** what the system prompt was built with — the session's snapshot, effective */
  let probing: boolean;
  const cap = TURN_CAPS[surface];
  try {
    const pre = await withPrincipal(studentId, async (client) => {
      // Server-side turn counts for this chat session. TWO of them, and the
      // difference arrived with P4's honest ledger:
      //
      //   · `delivered` drives the per-surface CAP. The cap is a teaching rule
      //     ("max 2 AI turns per question", PRD §6.3) — it counts explanations
      //     the student actually received. A turn the backend dropped taught
      //     nobody anything, and spending one of two chances on an outage is a
      //     product defect, not cost discipline. Spend is REPORTED, not capped.
      //   · `logged` drives `turn_index`, which stays monotonic across every
      //     row in the session so a failed turn and the retry after it are two
      //     places in the timeline rather than one.
      const turnsRes = await client.query(
        `SELECT count(*) AS logged,
                count(*) FILTER (WHERE outcome = 'ok') AS delivered
           FROM ai_interactions
          WHERE surface = $1 AND grounding->>'chat_session' = $2 AND student_id = $3`,
        [surface, chatSession, studentId]
      );
      const turns = Number(turnsRes.rows[0].logged);
      const delivered = Number(turnsRes.rows[0].delivered);
      if (cap != null && delivered >= cap) return { turns, delivered, capped: true as const };

      // The learning session this turn belongs to (ADR-0015). Opened AFTER the
      // cap check, because a turn the cap refused is not a sitting. All four
      // ask surfaces are session kinds by the same name, so the surface IS the
      // kind; `chatSession` rides along as the transitional correlation key.
      //
      // Opening one resolves and STORES its probing snapshot (ADR-0021); a
      // reused one hands back the snapshot it opened with. `courseOf` is how
      // the resolver learns the lesson's course (probing is maths only), and
      // it is only ever asked when probing could apply — never with the
      // switch Off.
      const session = await currentSessionSnapshot(
        studentId,
        surface,
        {
          surface,
          clientKey: chatSession,
          ...(surface === "lesson_learn"
            ? { courseOf: () => lessonCourseId(body.lesson, client) }
            : {}),
        },
        client
      );

      // Grounding is snapshotted per chat session: byte-stable across turns so
      // the (system prompt + data block) prefix stays prompt-cache-hot, and the
      // mastery numbers the model reasons over never shift mid-conversation.
      // The student is part of the key — no student's snapshot is ever re-served
      // to another.
      //
      // FR-2606: the student's register is part of the key, and the profile is
      // read HERE, this turn, inside the unit of work that is already open —
      // never cached across turns. A student who fixes their gender mid-lesson
      // therefore misses the snapshot once and is addressed correctly on the
      // very next turn, without signing out or starting a new session. See the
      // decision recorded in `lib/session-cache.ts`.
      const me = await getStudentProfile(studentId, client);
      //
      // The upload joins the key for the same reason the register does: it
      // changes the model-visible payload. Without it the FIRST turn of a chat
      // session would be cached for three hours and replayed verbatim over
      // every later turn — so a student who photographs a worksheet after
      // saying hello would get the pre-upload snapshot back, forever, and the
      // transcription would never reach the tutor at all. Keying costs one
      // rebuild on the turn the photograph arrives, and nothing after it.
      const key = snapshotKey({
        surface,
        chatSession,
        studentId,
        lesson: body.lesson,
        questionId: body.questionId,
        wrongAnswer: body.wrongAnswer,
        uploadId,
        gender: me?.gender ?? null,
        // The stored snapshot changes the system prompt, so it keys the cache.
        probing: session.probing,
      });
      const built = await snapshotContext(key, () =>
        surface === "lesson_learn" || surface === "lesson_review"
          ? buildLessonContext(
              surface === "lesson_learn" ? "learn" : "review",
              chatSession,
              body.lesson,
              studentId,
              uploadId,
              client,
              // the session's stored snapshot — never a request field
              session.probing
            )
          : buildAskContext(
              surface,
              chatSession,
              body.questionId,
              body.wrongAnswer,
              studentId,
              uploadId,
              client
            )
      );
      return {
        turns,
        delivered,
        capped: false as const,
        sessionId: session.sessionId,
        ctx: built,
      };
    });

    if (pre.capped) {
      return new Response(
        sse({ type: "cap", text: CAP_MESSAGES[surface] ?? "Session limit reached." }),
        { headers: { "Content-Type": "text/event-stream" } }
      );
    }
    if (!pre.ctx) {
      // THE COURSE GATE (migration 023, lib/catalog.ts). `body.lesson` is a
      // client-supplied slug: without this, a student who could not open a
      // hidden lesson's page could still be taught it turn by turn, which is
      // the same content arriving more slowly and more expensively.
      //
      // JSON rather than an SSE frame, and the same shape the unverified-email
      // refusal above already uses — the client already handles a non-stream
      // response from this endpoint. 404 rather than 403, so "not yours" and
      // "no such lesson" stay one answer.
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    priorTurns = pre.turns;
    deliveredTurns = pre.delivered;
    sessionId = pre.sessionId;
    ctx = pre.ctx;
    probing = pre.ctx.probing === true;
  } catch (err) {
    console.error("ask: pre-turn reads failed:", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
  // The unit of work is closed. Everything below runs with no connection held.

  // Sacred output containment (ADR-0006 §2, fails closed): the model's stream
  // is scanned against EVERY sealed sacred passage in the product — on every
  // surface — and the turn is aborted on any ≥4-word quote-run before the
  // words reach the client (lib/sacred-guard.ts holdback window). Originally
  // wired only to the lesson surfaces; the release review (2026-07-30) showed
  // student_chat re-explains Arabic questions with no backstop, so the guard
  // is now the whole sealed corpus, everywhere. Null only when no sacred
  // content exists at all (e.g. a box before the Arabic refresh).
  const sacredGuard: SacredGuard | null = makeSacredGuard(
    await getAllSacredPassages()
  );
  const lessonSurface =
    surface === "lesson_learn" || surface === "lesson_review";

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

      // First frame, before any text: the lesson's probing snapshot as this
      // prompt applied it (ADR-0021). ChatCore adopts it; the cards and the
      // live-event notes follow it, so the client can never probe while the
      // model was told not to, or the other way round.
      send({ type: "session", probing });

      // Runtime thinking budget. The hard reasoning happened at EXTRACTION time
      // (grounded, human-reviewed claims/solutions); at runtime the tutor mostly
      // paraphrases a claim, picks the next beat, and reacts — so a big budget is
      // pure latency. Default 1024 (the extended-thinking floor: minimal
      // deliberation, still on, snappy). AINEXT_THINKING_BUDGET=0 (or "off") turns
      // thinking OFF entirely for maximum speed; a higher number restores more.
      const rawBudget = (process.env.AINEXT_THINKING_BUDGET ?? "1024")
        .trim()
        .toLowerCase();
      const thinkEnv: Record<string, string> =
        rawBudget === "0" || rawBudget === "off"
          ? {}
          : { MAX_THINKING_TOKENS: rawBudget };

      const child = spawn(
        CLAUDE_BIN,
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
          // The binary, the directory and the environment all come from
          // `lib/claude-cli.ts`, which is the ONLY builder of them in this
          // repository. Authentication is decided by what is in that
          // environment, so the health probe
          // (`app/scripts/probe-runtime.mts`) calling the same two functions
          // is what makes its verdict a statement about THIS code path rather
          // than about a program nothing serves students from.
          cwd: claudeCwd(),
          env: claudeEnv(thinkEnv),
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      let timedOut = false;
      const timeout = setTimeout(() => {
        // Remembered, not just acted on: a killed child and a crashed one close
        // the same way, and the ledger row has to say which (research A4.2).
        timedOut = true;
        child.kill("SIGKILL");
      }, TIMEOUT_MS);
      req.signal.addEventListener("abort", () => child.kill("SIGKILL"));

      let fullText = "";
      let emittedLen = 0; // holdback frontier (sacred guard active only)
      let redacted = false;
      /**
       * The best usage the stream has reported SO FAR.
       *
       * The `result` line carries the authoritative figures, and on the two
       * paths that abort a turn it never arrives. But `--include-partial-messages`
       * re-emits the raw `message_start` (which carries the whole input side:
       * uncached input and both cache counters) and `message_delta` (which
       * carries output tokens as they accumulate). Reading them is what lets a
       * redacted or failed turn be priced from something real instead of from
       * zeros.
       */
      let partial: TokenCounts = ZERO_TOKENS;
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
              message?: { usage?: Record<string, number> };
              usage?: Record<string, number>;
            };
          } & Record<string, unknown>;
          try {
            j = JSON.parse(line);
          } catch {
            continue;
          }
          // Usage as it arrives, before any verdict about the turn.
          // `message_start` carries the input side complete; `message_delta`
          // carries output tokens cumulatively. Each counter keeps the LARGEST
          // value seen, because a later event that omits a field must not erase
          // what an earlier one reported.
          if (j.type === "stream_event") {
            const u = j.event?.message?.usage ?? j.event?.usage;
            if (u) {
              const seen = tokensFromUsage(u);
              partial = {
                inputTokens: Math.max(partial.inputTokens, seen.inputTokens),
                outputTokens: Math.max(partial.outputTokens, seen.outputTokens),
                cacheReadTokens: Math.max(partial.cacheReadTokens, seen.cacheReadTokens),
                cacheCreationTokens: Math.max(
                  partial.cacheCreationTokens,
                  seen.cacheCreationTokens
                ),
              };
            }
          }
          if (
            j.type === "stream_event" &&
            j.event?.type === "content_block_delta" &&
            j.event.delta?.type === "text_delta" &&
            typeof j.event.delta.text === "string"
          ) {
            if (redacted) continue;
            fullText += j.event.delta.text;
            if (sacredGuard) {
              // fails closed: abort the turn the moment a sealed quote-run
              // appears — the holdback below guarantees it was never emitted
              if (sacredGuard.violates(fullText)) {
                redacted = true;
                clearTimeout(timeout);
                child.kill("SIGKILL");
                console.error(
                  `ask: SACRED CONTAINMENT tripped on ${surface} — turn redacted ` +
                    `(lesson ${body.lesson ?? "?"}, ${fullText.length} chars suppressed)`
                );
                send({
                  type: "delta",
                  t:
                    `${fullText.slice(0, emittedLen)}`.length === 0
                      ? ""
                      : "\n\n",
                });
                send({
                  type: "delta",
                  t:
                    lessonSurface
                      ? "النص الكريم لا يُكتب هنا — تجده كاملًا وموثَّقًا في بطاقة النص داخل المحادثة، فتأمله هناك وقل لي ما لاحظت 🙏\n" +
                        `{{show_passage:${sacredGuard.firstPassageId}}}`
                      : "النص الكريم لا يُكتب هنا — نرجع له في المصحف أو في بطاقة النص الموثقة داخل الدرس، وأنا أشرح المعنى من كتاب الوزارة 🙏",
                });
                send({
                  type: "done",
                  meta: {
                    // The counters the stream reported before the child was
                    // killed, repriced at list price — not the zeros this
                    // branch used to claim (research A0.3). The client shows
                    // what the turn cost; the row below records the same.
                    costUsd: costFor(MODEL, partial, null).costUsd ?? 0,
                    inputTokens: partial.inputTokens,
                    outputTokens: partial.outputTokens,
                    cacheReadTokens: partial.cacheReadTokens,
                    cacheCreationTokens: partial.cacheCreationTokens,
                    latencyMs: Date.now() - started,
                    model: MODEL,
                    interactionId: null,
                    turnIndex: priorTurns + 1,
                    capped: cap != null && deliveredTurns >= cap,
                    redacted: true,
                  },
                });
                finish();
                continue;
              }
              // emit only what is safely OUTSIDE the holdback window
              const safeLen = Math.max(
                emittedLen,
                fullText.length - SACRED_HOLDBACK_CHARS
              );
              if (safeLen > emittedLen) {
                send({ type: "delta", t: fullText.slice(emittedLen, safeLen) });
                emittedLen = safeLen;
              }
            } else {
              send({ type: "delta", t: j.event.delta.text });
            }
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

      /**
       * UNIT TWO — the one ledger write, shared by all three outcomes.
       *
       * A fresh unit of work, long after unit one was released. It never
       * throws: instrumentation is observability, not behaviour, and a failed
       * cost row must not turn a delivered answer into an error.
       */
      const logTurn = async (args: {
        outcome: Outcome;
        assistantMessage: string;
        tokens: TokenCounts;
        /** The CLI's own total when its result line arrived; null when it did not. */
        cliCostUsd: number | null;
        latencyMs: number;
        citations: { kind: string; id: string }[];
      }): Promise<number | null> => {
        const { costUsd, priceBasis } = costFor(MODEL, args.tokens, args.cliCostUsd);
        try {
          const ins = await withPrincipal(studentId, (client) =>
            client.query(
              `INSERT INTO ai_interactions
                 (student_id, surface, turn_index, user_message, assistant_message,
                  grounding, citations, model, input_tokens, output_tokens,
                  cache_read_tokens, cache_creation_tokens, cost_usd, latency_ms,
                  environment, surface_kind, session_id, renderer_version,
                  outcome, price_basis, priced_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'chat',$16,$17,
                       $18,$19,now())
               RETURNING id`,
              [
                studentId,
                surface,
                priorTurns + 1,
                lastUser.text,
                args.assistantMessage,
                JSON.stringify(ctx.grounding),
                JSON.stringify(args.citations),
                MODEL,
                // UNCACHED input only. The two cache counters are their own
                // columns and are no longer also inside this one (A0.2).
                args.tokens.inputTokens,
                args.tokens.outputTokens,
                args.tokens.cacheReadTokens,
                args.tokens.cacheCreationTokens,
                costUsd,
                args.latencyMs,
                ENVIRONMENT,
                sessionId,
                // Which build rendered this turn for the student (ADR-0015 §3).
                // The console's replay compares it against the running release
                // and marks a turn the current renderer would draw differently.
                // Stamped on the REDACTED branch too: the suppressed turn is the
                // one an operator is most likely to open, and "which build
                // decided to suppress this" is their first question.
                RELEASE_TAG,
                args.outcome,
                priceBasis,
              ]
            )
          );
          return Number(ins.rows[0].id);
        } catch (e) {
          console.error(`ask: failed to log a '${args.outcome}' interaction:`, e);
          return null;
        }
      };

      child.on("close", async (code) => {
        clearTimeout(timeout);
        if (redacted) {
          // Audit trail for the religious-content owner: the suppressed turn is
          // recorded server-side; the student saw only the redirect line. The
          // counters are the ones the stream reported before the kill, repriced
          // at list price — a redacted turn spent real money (A0.3).
          await logTurn({
            outcome: "redacted",
            assistantMessage:
              "[REDACTED — sacred containment tripped; sealed quote-run suppressed]",
            tokens: partial,
            cliCostUsd: null,
            latencyMs: Date.now() - started,
            citations: [],
          });
          finish();
          return;
        }
        if (result == null || result.is_error || !fullText) {
          // The CLI's own words, classified into one short stable code and
          // then NOT carried any further: `cliCode` is a word from a closed
          // vocabulary, and the raw text below goes only to this process's
          // stderr as it always has.
          const cliCode = classifyCliFailure({
            timedOut,
            exitCode: code,
            text: `${stderrTail}\n${result?.result ?? ""}`,
          });
          console.error(
            `ask: claude CLI failed (code ${code}, ${cliCode}) — ${stderrTail.slice(-400)}`
          );
          // A FAILURE THAT BURNED TOKENS IS A COST LINE (research A4.2). The
          // turn produced nothing the student could use, and the input tokens
          // were spent all the same; writing nothing is how a failing day looks
          // cheap. When the result line DID arrive but carried `is_error`, its
          // own totals are authoritative and are used.
          const tokens = result?.usage ? tokensFromUsage(result.usage) : partial;
          //
          // **AND A FAILURE THAT BURNED NOTHING IS STILL A FAILED TURN**
          // (FR-3006, the incident of 2026-09-22).
          //
          // This branch used to be gated on
          // `totalInputTokens(tokens) + tokens.outputTokens > 0`, with a
          // comment saying that a failure before any tokens are known writes
          // nothing at all because there is no cost line to draw. As COST
          // accounting that was right and it is still right — what it missed
          // is that the ledger is also the product's only record of whether
          // the tutor worked, and **the zero-token failure is precisely the
          // shape of a lapsed sign-in**: the CLI exits immediately with
          // "Failed to authenticate", no `message_start` ever arrives, so no
          // counter is ever known. The console's passive signal was therefore
          // structurally blind to the one fault it was built to catch. Seven
          // weeks of failing turns would have left seven weeks of no rows.
          //
          // So the row is always written now, and the cost stays honest rather
          // than being faked to justify it: `costFor` returns `cost_usd = NULL`
          // with `price_basis = 'unpriced'` for a turn with no counters
          // (`lib/pricing.ts`), the cost views already report unpriced turns as
          // a COUNT rather than folding an unknown into a total, and
          // `cost-model.ts`'s `unpricedTurns` field exists for exactly this.
          // Nothing is recorded as free that was not free; a turn that never
          // reached the model genuinely cost nothing.
          await logTurn({
            outcome: timedOut ? "timeout" : "error",
            assistantMessage: timedOut
              ? `[no answer — the model did not finish within ${TIMEOUT_MS / 1000}s]`
              : `[no answer — the AI backend failed: ${cliCode}]`,
            tokens,
            cliCostUsd: result?.total_cost_usd ?? null,
            latencyMs: result?.duration_ms ?? Date.now() - started,
            citations: [],
          });
          send({
            type: "error",
            message: "AI backend unavailable — please try again",
          });
          finish();
          return;
        }

        const tokens = tokensFromUsage(result.usage);
        const costUsd = result.total_cost_usd ?? 0;
        const latencyMs = result.duration_ms ?? Date.now() - started;
        const citations = extractCitations(fullText);

        const interactionId = await logTurn({
          outcome: "ok",
          assistantMessage: fullText,
          tokens,
          cliCostUsd: result.total_cost_usd ?? null,
          latencyMs,
          citations,
        });

        // guard-mode emission runs behind the holdback window — release the
        // clean tail before closing the turn
        if (sacredGuard && fullText.length > emittedLen) {
          send({ type: "delta", t: fullText.slice(emittedLen) });
          emittedLen = fullText.length;
        }

        send({
          type: "done",
          meta: {
            costUsd,
            inputTokens: tokens.inputTokens,
            outputTokens: tokens.outputTokens,
            cacheReadTokens: tokens.cacheReadTokens,
            cacheCreationTokens: tokens.cacheCreationTokens,
            latencyMs,
            model: MODEL,
            interactionId,
            turnIndex: priorTurns + 1,
            // This turn was delivered, so it counts: the cap is reached when
            // the answer just sent is the last one the surface allows.
            capped: cap != null && deliveredTurns + 1 >= cap,
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

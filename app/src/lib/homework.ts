import { spawn } from "node:child_process";
import type { PoolClient } from "pg";
import { withPrincipal } from "@/lib/db";
import { scoped, getStudentProfile, type Db } from "@/lib/student-context";
import { ENVIRONMENT, RELEASE_TAG } from "@/lib/env";
import { CLAUDE_BIN, claudeCwd, claudeEnv } from "@/lib/claude-cli";
import { visibleGraphFor } from "@/lib/catalog-queries";
import { subjectOfCourse } from "@/lib/subjects";
import { masteryLabel } from "@/lib/mastery";
import { ZERO_TOKENS, costFor, tokensFromUsage, type Outcome, type TokenCounts } from "@/lib/pricing";
import {
  buildSplitPrompt,
  homeworkSystemPrompt,
  type SplitObjective,
} from "@/lib/homework-prompt";
import {
  fillGaps,
  gapsComplete,
  parseSplitReply,
  type Gap,
  type HomeworkMode,
  type HomeworkSubject,
  type ItemStatus,
} from "@/lib/homework-rules";
import type { AskContext } from "@/lib/ask";
import { getParsedUpload } from "@/lib/uploads";
import { endedTurnOutcome } from "@/lib/stop-turn";
import { cancelRun, homeworkRunKey, registerRun, uploadRunKey } from "@/lib/running-work";

/**
 * Homework ask — the I/O half (spec 004, ADR-0025 — PROPOSED, prototype only).
 *
 * Same shape as `lib/uploads.ts`: the request writes a row and returns; the
 * slow part (waiting for an upload's transcription, then the split call) runs
 * after the response in units of its own, never holding a pooled client across
 * a model call, and the page polls for the outcome.
 *
 * Every read and write here is under the student's principal; the three
 * homework tables carry the `uploads` RLS policy shape (migration 040), so an
 * id belonging to somebody else simply produces no row.
 */

const MODEL = "claude-sonnet-5";
const SPLIT_TIMEOUT_MS = 90_000;
/** How long the reader waits for an upload's own parse (it has a 90s timeout). */
const PARSE_WAIT_MS = 150_000;
const PARSE_POLL_MS = 2_000;

/** `stopped`: the student pressed Stop while it was being read (migration 041). */
export type AskStatus = "reading" | "ready" | "unreadable" | "failed" | "stopped";

export type HomeworkItem = {
  id: number;
  position: number;
  label: string | null;
  text: string;
  gaps: Gap[];
  subject: HomeworkSubject;
  status: ItemStatus;
  mode: HomeworkMode | null;
  edited: boolean;
  objective: { id: string; label: string; unit: string; mastery: string } | null;
};

export type HomeworkAsk = {
  id: number;
  source: "typed" | "upload";
  status: AskStatus;
  fileType: string | null;
  items: HomeworkItem[];
};

/* ------------------------------------------------------------------ */
/* Create + read                                                       */
/* ------------------------------------------------------------------ */

export async function createAsk(
  studentId: number,
  /** typed text, a file, or a file with a typed note beside it */
  input: { text: string; uploadId?: undefined } | { uploadId: number; text?: string }
): Promise<number | null> {
  return withPrincipal(studentId, async (db) => {
    if (input.uploadId != null) {
      // The scoped read IS the ownership check (RLS on uploads).
      const u = await db.query(`SELECT id FROM uploads WHERE id = $1`, [input.uploadId]);
      if (u.rowCount === 0) return null;
    }
    const r = await db.query(
      `INSERT INTO homework_asks (student_id, environment, source, upload_id, typed_text)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        studentId,
        ENVIRONMENT,
        input.uploadId != null ? "upload" : "typed",
        input.uploadId ?? null,
        input.text || null,
      ]
    );
    return Number(r.rows[0].id);
  });
}

export async function getAsk(
  studentId: number,
  askId: number,
  c?: Db
): Promise<HomeworkAsk | null> {
  return scoped(studentId, c, async (db) => {
    const a = await db.query(
      `SELECT a.id, a.source, a.status, u.file_type
         FROM homework_asks a LEFT JOIN uploads u ON u.id = a.upload_id
        WHERE a.id = $1`,
      [askId]
    );
    if (a.rowCount === 0) return null;
    // An item's objective was chosen from her gated set when the ask was read;
    // a course hidden since then drops it rather than naming it (the course gate).
    const gate = await visibleGraphFor(db, studentId);
    const items = await db.query(
      `SELECT i.id, i.position, i.label, i.text, i.gaps, i.subject, i.status, i.mode,
              i.edited, i.lo_id, lo.label AS lo_label, m.label AS unit_label,
              (SELECT score FROM mastery ms
                WHERE ms.student_id = i.student_id AND ms.lo_id = i.lo_id AND ms.system_to IS NULL
                LIMIT 1) AS score
         FROM homework_items i
         LEFT JOIN graph_nodes lo ON lo.id = i.lo_id
         LEFT JOIN graph_edges te
           ON te.dst_id = i.lo_id AND te.edge_type = 'teaches' AND te.system_to IS NULL
         LEFT JOIN graph_nodes m ON m.id = te.src_id AND m.kind = 'module'
        WHERE i.ask_id = $1
        ORDER BY i.position`,
      [askId]
    );
    return {
      id: Number(a.rows[0].id),
      source: a.rows[0].source,
      status: a.rows[0].status,
      fileType: a.rows[0].file_type ?? null,
      items: items.rows.map((r) => ({
        id: Number(r.id),
        position: Number(r.position),
        label: r.label ?? null,
        text: r.text,
        gaps: (r.gaps ?? []) as Gap[],
        subject: r.subject,
        status: r.status,
        mode: r.mode ?? null,
        edited: r.edited === true,
        objective: r.lo_id && gate.lo(r.lo_id)
          ? {
              id: r.lo_id,
              label: r.lo_label ?? r.lo_id,
              unit: r.unit_label ?? "",
              mastery: masteryLabel(r.score == null ? 0 : Number(r.score), r.score != null),
            }
          : null,
      })),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Reading: wait for the transcription, then split                     */
/* ------------------------------------------------------------------ */

/**
 * Turn an ask into its questions. Never throws: every way it can fail ends
 * as a status the page shows (FR-3606 — never a guess).
 */
export async function readAsk(askId: number, studentId: number): Promise<AskStatus> {
  // Stoppable from the page's Stop (DELETE /api/homework/{id}), which arrives
  // in another request: this reading outlives the one that started it.
  const stopper = new AbortController();
  const unregister = registerRun(homeworkRunKey(askId), () => stopper.abort());
  try {
    return await readAskUntil(askId, studentId, stopper.signal);
  } finally {
    unregister();
  }
}

async function readAskUntil(
  askId: number,
  studentId: number,
  signal: AbortSignal
): Promise<AskStatus> {
  try {
    const src = await scoped(studentId, undefined, (db) =>
      db.query(`SELECT source, upload_id, typed_text FROM homework_asks WHERE id = $1`, [askId])
    );
    if (src.rowCount === 0) return "failed";
    let text: string | null = src.rows[0].typed_text;

    if (src.rows[0].source === "upload") {
      const parsed = await waitForParse(Number(src.rows[0].upload_id), studentId, signal);
      if (signal.aborted) return setAskStatus(askId, studentId, "stopped");
      if (parsed.status !== "parsed" || !parsed.text) {
        return setAskStatus(askId, studentId, parsed.status === "unreadable" ? "unreadable" : "failed");
      }
      // A note typed beside the file is part of what the student asked.
      text = text ? `${parsed.text}\n\nThe student also wrote: ${text}` : parsed.text;
    }
    if (!text?.trim()) return setAskStatus(askId, studentId, "unreadable");

    const objectives = await visibleMathsObjectives(studentId);
    if (signal.aborted) return setAskStatus(askId, studentId, "stopped");
    const started = Date.now();
    const run = await runSplit(buildSplitPrompt(text, objectives), signal);
    await logSplit(studentId, askId, run, Date.now() - started);
    // Stopped mid-split, or after it answered but before its questions were
    // written: either way she asked for it to stop, and it stops.
    if (run.outcome === "stopped" || signal.aborted) {
      return setAskStatus(askId, studentId, "stopped");
    }
    if (run.reply == null) return setAskStatus(askId, studentId, "failed");

    const result = parseSplitReply(run.reply, new Set(objectives.map((o) => o.id)));
    if (!result) return setAskStatus(askId, studentId, "failed");
    if (result.kind === "unreadable") return setAskStatus(askId, studentId, "unreadable");

    await withPrincipal(studentId, async (db) => {
      for (const [k, q] of result.questions.entries()) {
        await db.query(
          `INSERT INTO homework_items
             (ask_id, student_id, environment, position, label, text, gaps, subject, lo_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (ask_id, position) DO NOTHING`,
          [askId, studentId, ENVIRONMENT, k + 1, q.label, q.text, JSON.stringify(q.gaps), q.subject, q.objective]
        );
      }
      await db.query(`UPDATE homework_asks SET status = 'ready' WHERE id = $1`, [askId]);
    });
    return "ready";
  } catch (e) {
    console.error("[homework] read failed:", e);
    return setAskStatus(askId, studentId, "failed").catch(() => "failed" as const);
  }
}

/**
 * The page's Stop while an ask is being read. The caller has already read
 * the ask under the student's principal (the ownership check).
 *
 * The running reader is told to stop and writes `stopped` itself once its
 * model process is dead, so the ledger row and the status agree. When no
 * reader is running in this process (it finished in the same instant, or the
 * server restarted under it) the row is moved to `stopped` directly — but
 * only from `reading`, so a Stop that lost the race never hides questions
 * that are already there.
 */
export async function stopAsk(studentId: number, askId: number): Promise<void> {
  if (cancelRun(homeworkRunKey(askId))) return;
  await scoped(studentId, undefined, (db) =>
    db.query(
      `UPDATE homework_asks SET status = 'stopped' WHERE id = $1 AND status = 'reading'`,
      [askId]
    )
  );
}

async function setAskStatus(askId: number, studentId: number, status: AskStatus): Promise<AskStatus> {
  await scoped(studentId, undefined, (db) =>
    db.query(`UPDATE homework_asks SET status = $2 WHERE id = $1`, [askId, status])
  );
  return status;
}

async function waitForParse(
  uploadId: number,
  studentId: number,
  signal: AbortSignal
): Promise<{ status: string; text: string | null }> {
  const deadline = Date.now() + PARSE_WAIT_MS;
  // A Stop while the photo is still being read stops the reading too — it is
  // the same model work the student is waiting on, and nothing else wants it.
  const stopParse = () => void cancelRun(uploadRunKey(uploadId));
  signal.addEventListener("abort", stopParse, { once: true });
  try {
    return await pollParse(uploadId, studentId, deadline, signal);
  } finally {
    signal.removeEventListener("abort", stopParse);
  }
}

async function pollParse(
  uploadId: number,
  studentId: number,
  deadline: number,
  signal: AbortSignal
): Promise<{ status: string; text: string | null }> {
  for (;;) {
    if (signal.aborted) return { status: "failed", text: null };
    const r = await scoped(studentId, undefined, (db) =>
      db.query(`SELECT parse_status, parsed_text FROM uploads WHERE id = $1`, [uploadId])
    );
    if (r.rowCount === 0) return { status: "failed", text: null };
    const status = r.rows[0].parse_status as string;
    if (status !== "pending") return { status, text: r.rows[0].parsed_text ?? null };
    if (Date.now() > deadline) return { status: "failed", text: null };
    await new Promise((res) => setTimeout(res, PARSE_POLL_MS));
  }
}

/** The maths objectives this student can see — the course gate's answer, in catalogue order. */
async function visibleMathsObjectives(studentId: number): Promise<SplitObjective[]> {
  return scoped(studentId, undefined, async (db) => {
    const gate = await visibleGraphFor(db, studentId);
    const r = await db.query(
      `SELECT lo.id, lo.label, m.label AS unit, c.id AS course_id
         FROM graph_nodes lo
         JOIN graph_edges te ON te.dst_id = lo.id AND te.edge_type = 'teaches' AND te.system_to IS NULL
         JOIN graph_nodes m ON m.id = te.src_id AND m.kind = 'module'
         JOIN graph_edges ec ON ec.src_id = m.id AND ec.edge_type = 'part_of' AND ec.system_to IS NULL
         JOIN graph_nodes c ON c.id = ec.dst_id AND c.kind = 'course'
        WHERE lo.kind = 'learning_objective'
        ORDER BY m.id, lo.id`
    );
    return r.rows
      .filter((x) => gate.lo(x.id) && subjectOfCourse(x.course_id) === "math-en")
      .map((x) => ({ id: x.id, label: x.label, unit: x.unit }));
  });
}

type SplitRun = { reply: string | null; tokens: TokenCounts; cliCostUsd: number | null; outcome: Outcome };

function runSplit(prompt: string, signal?: AbortSignal): Promise<SplitRun> {
  return new Promise((resolve) => {
    const child = spawn(
      CLAUDE_BIN,
      ["-p", "--output-format", "json", "--model", MODEL, "--disallowedTools", "*", "--max-turns", "1"],
      { cwd: claudeCwd(), env: claudeEnv(), stdio: ["pipe", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    let timedOut = false;
    let stopped = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, SPLIT_TIMEOUT_MS);
    // The student's Stop: killed, and recorded as `stopped` (migration 041).
    const stop = () => {
      if (!timedOut) stopped = true;
      child.kill("SIGKILL");
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", () => {
      clearTimeout(timeout);
      resolve({ reply: null, tokens: ZERO_TOKENS, cliCostUsd: null, outcome: "error" });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      let j: { result?: string; is_error?: boolean; total_cost_usd?: number; usage?: Parameters<typeof tokensFromUsage>[0] } | null = null;
      try {
        j = JSON.parse(out.trim());
      } catch {
        j = null;
      }
      const tokens = tokensFromUsage(j?.usage);
      const cliCostUsd = typeof j?.total_cost_usd === "number" ? j.total_cost_usd : null;
      if (code !== 0 || !j || j.is_error || typeof j.result !== "string") {
        if (!stopped) console.error(`[homework] split failed (code ${code}): ${err.slice(-300)}`);
        return resolve({
          reply: null,
          tokens,
          cliCostUsd,
          outcome: endedTurnOutcome({ completed: false, timedOut, stopped }),
        });
      }
      resolve({ reply: j.result, tokens, cliCostUsd, outcome: "ok" });
    });
    child.stdin.on("error", () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** The split is metered on its own surface kind (FR-3604), like OCR is. */
async function logSplit(studentId: number, askId: number, run: SplitRun, latencyMs: number) {
  const { costUsd, priceBasis } = costFor(MODEL, run.tokens, run.cliCostUsd);
  try {
    await scoped(studentId, undefined, (db) =>
      db.query(
        `INSERT INTO ai_interactions
           (student_id, surface, turn_index, user_message, assistant_message,
            grounding, citations, model, input_tokens, output_tokens,
            cache_read_tokens, cache_creation_tokens, cost_usd, latency_ms,
            environment, surface_kind, renderer_version, outcome, price_basis, priced_at)
         VALUES ($1,'homework_split',1,$2,$3,'{}','[]',$4,$5,$6,$7,$8,$9,$10,$11,
                 'homework_split',$12,$13,$14,now())`,
        [
          studentId,
          `[homework ask ${askId}]`,
          run.reply?.slice(0, 4000) ?? `[${run.outcome}]`,
          MODEL,
          run.tokens.inputTokens,
          run.tokens.outputTokens,
          run.tokens.cacheReadTokens,
          run.tokens.cacheCreationTokens,
          costUsd,
          latencyMs,
          ENVIRONMENT,
          RELEASE_TAG,
          run.outcome,
          priceBasis,
        ]
      )
    );
  } catch (e) {
    console.error("[homework] failed to log split cost:", e);
  }
}

/* ------------------------------------------------------------------ */
/* The tutor's context for one question (the `homework` surface)       */
/* ------------------------------------------------------------------ */

/**
 * `null` when the item is not this student's, is not maths, has no chosen
 * mode, or still has an unfilled gap — the route answers all four with one
 * 404, like the course gate does.
 */
export async function buildHomeworkContext(
  itemId: number,
  chatSession: string,
  studentId: number,
  client: PoolClient,
  /** a photo of the student's own attempt ("Check my work"), when attached */
  uploadId?: number
): Promise<AskContext | null> {
  const r = await client.query(
    `SELECT i.id, i.ask_id, i.label, i.text, i.gaps, i.subject, i.mode, i.lo_id,
            lo.label AS lo_label, lo.description AS lo_description, m.label AS unit_label,
            a.source,
            (SELECT score FROM mastery ms
              WHERE ms.student_id = i.student_id AND ms.lo_id = i.lo_id AND ms.system_to IS NULL
              LIMIT 1) AS score
       FROM homework_items i
       JOIN homework_asks a ON a.id = i.ask_id
       LEFT JOIN graph_nodes lo ON lo.id = i.lo_id
       LEFT JOIN graph_edges te
         ON te.dst_id = i.lo_id AND te.edge_type = 'teaches' AND te.system_to IS NULL
       LEFT JOIN graph_nodes m ON m.id = te.src_id AND m.kind = 'module'
      WHERE i.id = $1`,
    [itemId]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  const gaps = (row.gaps ?? []) as Gap[];
  if (row.subject !== "maths" || !row.mode || !gapsComplete(gaps)) return null;
  // The same gate as getAsk: an objective outside her scope is not taught from.
  const gate = await visibleGraphFor(client, studentId);
  if (row.lo_id && !gate.lo(row.lo_id)) row.lo_id = null;

  const profile = await getStudentProfile(studentId, client);
  const student = profile?.displayName?.split(" ")[0] || "the student";
  const systemPrompt = homeworkSystemPrompt({
    student,
    question: fillGaps(row.text, gaps),
    label: row.label ?? null,
    mode: row.mode,
    fromUpload: row.source === "upload",
    objective: row.lo_id
      ? {
          id: row.lo_id,
          label: row.lo_label ?? row.lo_id,
          description: row.lo_description ?? null,
          unit: row.unit_label ?? "",
          mastery: masteryLabel(row.score == null ? 0 : Number(row.score), row.score != null),
        }
      : null,
  });
  // The attempt rides in the data block, not the system prompt, so the
  // question's prefix stays the same whether or not a photo is attached.
  const attempt = uploadId ? await getParsedUpload(uploadId, studentId, client) : null;
  return {
    systemPrompt,
    dataBlock:
      attempt?.status === "parsed" && attempt.text
        ? `THE STUDENT'S OWN WORKING, read from a photo they attached (an unreadable part is marked as such — never guess it):\n<<<\n${attempt.text}\n>>>`
        : "",
    grounding: {
      lo_ids: row.lo_id ? [row.lo_id] : [],
      question_ids: [],
      pages: [],
      chat_session: chatSession,
      homework_item: Number(row.id),
      homework_ask: Number(row.ask_id),
    },
  };
}

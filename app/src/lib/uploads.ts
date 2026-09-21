/**
 * Student uploads — intake, storage and parsing (PRD B10, FR-205/206, T044–T047).
 *
 * The Blueprint's "ingest-first" finding: every real usage pattern students
 * already have starts with a photo of something. This is that path.
 *
 * Parsing runs through the `claude` CLI already on the box (research.md R2) —
 * no new dependency, no new key, and no minors' photographs leaving to an extra
 * third party. It is metered as its own `surface_kind` because image tokens cost
 * materially more than text and Principle VI requires that be visible separately
 * rather than blended into a per-student figure.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { scoped, type Db } from "@/lib/student-context";
import { ENVIRONMENT, RELEASE_TAG } from "@/lib/env";
import {
  ZERO_TOKENS,
  costFor,
  tokensFromUsage,
  totalInputTokens,
  type CliUsage,
  type Outcome,
  type TokenCounts,
} from "@/lib/pricing";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const DAILY_UPLOAD_CAP = 10;               // per student, per day
const PARSE_TIMEOUT_MS = 90_000;
const MODEL = "claude-sonnet-5";

export const ACCEPTED = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
} as const;

export type AcceptedType = keyof typeof ACCEPTED;
export type ParseStatus = "pending" | "parsed" | "failed" | "unreadable";

export function isAccepted(t: string): t is AcceptedType {
  return t in ACCEPTED;
}

function uploadRoot(): string {
  return process.env.AINEXT_UPLOAD_DIR ?? path.join(process.env.TMPDIR ?? "/tmp", "ainext-uploads");
}

/** Uploads used today, for the per-student cap (FR-047). */
export async function uploadsToday(
  studentId: number,
  c?: Db
): Promise<number> {
  const res = await scoped(studentId, c, (db) =>
    db.query(
      `SELECT count(*) AS n FROM uploads
        WHERE student_id = $1 AND created_at > now() - interval '1 day'`,
      [studentId]
    )
  );
  return Number(res.rows[0].n);
}

export async function storeUpload(
  studentId: number,
  sessionId: string | null,
  /** The learning session (ADR-0015). `sessionId` above is the legacy client
   *  string kept beside it for the transition — the two must never be joined. */
  sessionRef: number | null,
  fileType: AcceptedType,
  bytes: Buffer,
  c?: Db
): Promise<number> {
  const dir = path.join(uploadRoot(), String(studentId));
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}${ACCEPTED[fileType]}`);
  await writeFile(file, bytes);

  const res = await scoped(studentId, c, (db) =>
    db.query(
      `INSERT INTO uploads (student_id, session_id, session_ref, file_type, storage_path, parse_status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id`,
      [studentId, sessionId, sessionRef, fileType, file]
    )
  );
  return Number(res.rows[0].id);
}

/**
 * The parse instruction.
 *
 * Two rules in here are requirements, not style:
 *
 *  - FR-206: transcribe only what the academic task needs. A student's kitchen
 *    table, a sibling in frame, an address on an envelope — none of that is ours
 *    to retain or remark on, and the cheapest place to enforce that is before
 *    the text is ever written down.
 *  - FR-205 / PRD §8: say plainly when something cannot be read. A confident
 *    transcription of an unreadable digit is worse than an admission, because
 *    the tutor will then teach against a problem the student never wrote.
 */
const PARSE_PROMPT = `Read the file at the path given below and transcribe the mathematics in it.

Rules:
- Transcribe ONLY the academic content: the problem, the working, the answer.
- Do NOT describe or transcribe anything incidental — people, faces, rooms,
  names, addresses, phone numbers, or anything else not part of the maths.
- If part of it is genuinely unreadable, say so explicitly and transcribe the
  rest. Never guess at an unreadable digit, symbol or step.
- If NOTHING is readable, or you cannot open the file at all, reply with exactly: UNREADABLE
- Reply with the transcription only — no preamble, no commentary, no JSON.`;

type ParseOutcome = {
  status: ParseStatus;
  text: string | null;
  /** What the parse spent. The ledger row used to hard-code zeros here. */
  tokens: TokenCounts;
  /** The CLI's own total, or null when it reported none. */
  cliCostUsd: number | null;
  /** `ai_interactions.outcome` for the row this parse writes. */
  outcome: Outcome;
};

function runParse(filePath: string): Promise<ParseOutcome> {
  return new Promise((resolve) => {
    // The Read tool must be ALLOWED here, and only Read.
    //
    // This is the opposite of the chat surfaces, which disallow every tool —
    // and getting it wrong is not a visible failure. With tools disabled the
    // model cannot open the image at all, yet still answers: it echoes the path
    // back, the parse is recorded as SUCCESSFUL, and a meaningless string flows
    // into the tutor's grounding as if it were the student's worksheet. Found
    // exactly that way in local testing.
    // `--output-format json` is a COST fix, not a plumbing preference.
    //
    // In plain `-p` mode the CLI prints the transcription and nothing else, so
    // this path had no usage line to read and wrote literal zeros into the
    // ledger — which made `surface_kind='upload_parse'`, the row that exists
    // precisely so image tokens cannot hide inside a teaching figure
    // (Principle VI, FR-2402), report $0.00 for every photograph ever sent.
    // The JSON envelope is the same one `/api/understanding` already reads;
    // the transcription comes out of `result` and every downstream check below
    // is applied to THAT string, exactly as it was to stdout before.
    const child = spawn(
      "claude",
      [
        "-p",
        "--output-format", "json",
        "--model", MODEL,
        "--allowedTools", "Read",
        "--max-turns", "2",
      ],
      {
        // cwd is the upload root, so a relative path cannot wander outside it.
        cwd: uploadRoot(),
        env: {
          ...process.env,
          PATH: `${process.env.PATH ?? ""}:${process.env.HOME ?? ""}/.local/bin`,
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let out = "";
    let err = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, PARSE_TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    /** A parse that produced no transcription, carrying whatever it spent. */
    const failed = (tokens: TokenCounts, cliCostUsd: number | null): ParseOutcome => ({
      status: "failed",
      text: null,
      tokens,
      cliCostUsd,
      outcome: timedOut ? "timeout" : "error",
    });

    child.on("error", () => {
      clearTimeout(timeout);
      // The process never started: nothing spent, nothing to record.
      resolve(failed(ZERO_TOKENS, null));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      let j: {
        result?: string;
        is_error?: boolean;
        total_cost_usd?: number;
        usage?: CliUsage;
      } | null = null;
      try {
        j = JSON.parse(out.trim());
      } catch {
        j = null;
      }
      const tokens = tokensFromUsage(j?.usage);
      const cliCostUsd = typeof j?.total_cost_usd === "number" ? j.total_cost_usd : null;

      if (code !== 0 || !j || j.is_error || typeof j.result !== "string") {
        console.error(`[uploads] parse failed (code ${code}): ${err.slice(-300)}`);
        return resolve(failed(tokens, cliCostUsd));
      }
      const text = j.result.trim();
      if (!text) {
        return resolve(failed(tokens, cliCostUsd));
      }
      // Everything below reads the model's own answer, exactly as it read
      // stdout before the envelope existed. A parse that reached this point
      // SPENT tokens whatever it concluded, so each branch carries them.
      const spent = { tokens, cliCostUsd, outcome: "ok" as const };

      // The model's own admission is the signal — we do not infer unreadability
      // from a short response, because a short answer to a short problem is fine.
      if (/^UNREADABLE\b/i.test(text)) {
        return resolve({ status: "unreadable", text: null, ...spent });
      }
      // Defence in depth for the failure above: if the reply is JSON, or
      // mentions the storage path, the model did not transcribe anything — it
      // talked ABOUT the file. Treat that as unreadable rather than storing it
      // as a transcription, because a wrong transcription is worse than none:
      // the tutor would teach against a problem the student never wrote.
      if (/^[[{]/.test(text) || text.includes(filePath)) {
        console.error(`[uploads] parse returned metadata, not a transcription: ${text.slice(0, 200)}`);
        return resolve({ status: "unreadable", text: null, ...spent });
      }
      resolve({ status: "parsed", text, ...spent });
    });

    child.stdin.write(`${PARSE_PROMPT}\n\nFile to read: ${filePath}\n`);
    child.stdin.end();
  });
}

/**
 * Parse an upload and record the outcome. Never throws: a failed parse is a
 * state the student is told about (FR-205), not an error that takes down the
 * lesson around it.
 */
export async function parseUpload(
  uploadId: number,
  /** Whose upload this is. Passed in, never re-derived — the row is only
   *  readable under this principal in the first place (FR-2105). */
  studentId: number,
  /** Passed in, never re-derived: this runs AFTER the response, and by then the
   *  student's open session may have been superseded or swept. The ledger row
   *  belongs to the session that took the photo (ADR-0015, FR-2309). */
  sessionRef: number | null = null
): Promise<ParseStatus> {
  // Unit one: find the file. Short, and closed before the model is spawned.
  const res = await scoped(studentId, undefined, (db) =>
    db.query(`SELECT storage_path FROM uploads WHERE id = $1`, [uploadId])
  );
  if (res.rowCount === 0) return "failed";
  const filePath = res.rows[0].storage_path as string;

  // …the model call happens with NO connection held. Ninety seconds of a
  // borrowed client is nearly five per cent of the pool, for one photograph.
  const started = Date.now();
  let outcome: ParseOutcome;
  try {
    outcome = await runParse(filePath);
  } catch (e) {
    console.error("[uploads] parse threw:", e);
    outcome = {
      status: "failed",
      text: null,
      tokens: ZERO_TOKENS,
      cliCostUsd: null,
      outcome: "error",
    };
  }

  // Unit two: the outcome the student is waiting on.
  await scoped(studentId, undefined, (db) =>
    db.query(
      `UPDATE uploads SET parse_status = $2, parsed_text = $3 WHERE id = $1`,
      [uploadId, outcome.status, outcome.text]
    )
  );

  // Metered as its own surface_kind so image-token cost never hides inside the
  // teaching figure (Principle VI, research.md R2). Its own unit, so a failed
  // cost row cannot undo the parse status above.
  //
  // **The counters are real now.** This INSERT wrote `0,0,0` for input tokens,
  // output tokens and cost on every photograph the product has ever parsed —
  // so the one figure FR-2402 exists to keep visible was structurally zero,
  // and "is OCR eating us" had a reassuring answer that meant nothing. A parse
  // that never started still writes no row: there is no cost line to draw.
  if (totalInputTokens(outcome.tokens) + outcome.tokens.outputTokens > 0) {
    const { costUsd, priceBasis } = costFor(MODEL, outcome.tokens, outcome.cliCostUsd);
    try {
      await scoped(studentId, undefined, (db) =>
        db.query(
        `INSERT INTO ai_interactions
           (student_id, surface, turn_index, user_message, assistant_message,
            grounding, citations, model, input_tokens, output_tokens,
            cache_read_tokens, cache_creation_tokens, cost_usd, latency_ms,
            environment, surface_kind, session_id, renderer_version,
            outcome, price_basis, priced_at)
         VALUES ($1,'upload_parse',1,$2,$3,'{}','[]',$4,$5,$6,$7,$8,$9,$10,$11,
                 'upload_parse',$12,$13,$14,$15,now())`,
          [
            studentId,
            `[upload ${uploadId}]`,
            outcome.text?.slice(0, 4000) ?? `[${outcome.status}]`,
            MODEL,
            outcome.tokens.inputTokens,
            outcome.tokens.outputTokens,
            outcome.tokens.cacheReadTokens,
            outcome.tokens.cacheCreationTokens,
            costUsd,
            Date.now() - started,
            ENVIRONMENT,
            sessionRef,
            // Which build parsed the photo (ADR-0015 §3). The parse result is
            // what the student was then taught from, so the timeline shows the
            // version beside it like any other turn.
            RELEASE_TAG,
            outcome.outcome,
            priceBasis,
          ]
        )
      );
    } catch (e) {
      console.error("[uploads] failed to log parse cost:", e);
    }
  }

  return outcome.status;
}

/** Parsed text for a given upload, for the retrieval layer to ground on. */
export async function getParsedUpload(
  uploadId: number,
  studentId: number,
  c?: Db
): Promise<{ status: ParseStatus; text: string | null } | null> {
  // `student_id = $2` is now belt and braces: the policy already narrows this
  // to the principal, and a row belonging to anybody else is simply invisible.
  // Invisible is exactly the answer the route wants — it returns 404 for "not
  // yours" and for "no such id" alike, and cannot tell the caller which.
  const res = await scoped(studentId, c, (db) =>
    db.query(
      `SELECT parse_status, parsed_text FROM uploads WHERE id = $1 AND student_id = $2`,
      [uploadId, studentId]
    )
  );
  if (res.rowCount === 0) return null;
  return {
    status: res.rows[0].parse_status as ParseStatus,
    text: (res.rows[0].parsed_text as string | null) ?? null,
  };
}

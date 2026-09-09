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
import { pool } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";

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
export async function uploadsToday(studentId: number): Promise<number> {
  const res = await pool.query(
    `SELECT count(*) AS n FROM uploads
      WHERE student_id = $1 AND created_at > now() - interval '1 day'`,
    [studentId]
  );
  return Number(res.rows[0].n);
}

export async function storeUpload(
  studentId: number,
  sessionId: string | null,
  fileType: AcceptedType,
  bytes: Buffer
): Promise<number> {
  const dir = path.join(uploadRoot(), String(studentId));
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}${ACCEPTED[fileType]}`);
  await writeFile(file, bytes);

  const res = await pool.query(
    `INSERT INTO uploads (student_id, session_id, file_type, storage_path, parse_status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
    [studentId, sessionId, fileType, file]
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

type ParseOutcome = { status: ParseStatus; text: string | null };

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
    const child = spawn(
      "claude",
      [
        "-p",
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
    const timeout = setTimeout(() => child.kill("SIGKILL"), PARSE_TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", () => {
      clearTimeout(timeout);
      resolve({ status: "failed", text: null });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const text = out.trim();
      if (code !== 0 || !text) {
        console.error(`[uploads] parse failed (code ${code}): ${err.slice(-300)}`);
        return resolve({ status: "failed", text: null });
      }
      // The model's own admission is the signal — we do not infer unreadability
      // from a short response, because a short answer to a short problem is fine.
      if (/^UNREADABLE\b/i.test(text)) {
        return resolve({ status: "unreadable", text: null });
      }
      // Defence in depth for the failure above: if the reply is JSON, or
      // mentions the storage path, the model did not transcribe anything — it
      // talked ABOUT the file. Treat that as unreadable rather than storing it
      // as a transcription, because a wrong transcription is worse than none:
      // the tutor would teach against a problem the student never wrote.
      if (/^[[{]/.test(text) || text.includes(filePath)) {
        console.error(`[uploads] parse returned metadata, not a transcription: ${text.slice(0, 200)}`);
        return resolve({ status: "unreadable", text: null });
      }
      resolve({ status: "parsed", text });
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
export async function parseUpload(uploadId: number): Promise<ParseStatus> {
  const res = await pool.query(
    `SELECT student_id, storage_path FROM uploads WHERE id = $1`,
    [uploadId]
  );
  if (res.rowCount === 0) return "failed";
  const { student_id: studentId, storage_path: filePath } = res.rows[0];

  const started = Date.now();
  let outcome: ParseOutcome;
  try {
    outcome = await runParse(filePath);
  } catch (e) {
    console.error("[uploads] parse threw:", e);
    outcome = { status: "failed", text: null };
  }

  await pool.query(
    `UPDATE uploads SET parse_status = $2, parsed_text = $3 WHERE id = $1`,
    [uploadId, outcome.status, outcome.text]
  );

  // Metered as its own surface_kind so image-token cost never hides inside the
  // teaching figure (Principle VI, research.md R2).
  try {
    await pool.query(
      `INSERT INTO ai_interactions
         (student_id, surface, turn_index, user_message, assistant_message,
          grounding, citations, model, input_tokens, output_tokens,
          cost_usd, latency_ms, environment, surface_kind)
       VALUES ($1,'upload_parse',1,$2,$3,'{}','[]',$4,0,0,0,$5,$6,'upload_parse')`,
      [
        studentId,
        `[upload ${uploadId}]`,
        outcome.text?.slice(0, 4000) ?? `[${outcome.status}]`,
        MODEL,
        Date.now() - started,
        ENVIRONMENT,
      ]
    );
  } catch (e) {
    console.error("[uploads] failed to log parse cost:", e);
  }

  return outcome.status;
}

/** Parsed text for a given upload, for the retrieval layer to ground on. */
export async function getParsedUpload(
  uploadId: number,
  studentId: number
): Promise<{ status: ParseStatus; text: string | null } | null> {
  const res = await pool.query(
    `SELECT parse_status, parsed_text FROM uploads WHERE id = $1 AND student_id = $2`,
    [uploadId, studentId]
  );
  if (res.rowCount === 0) return null;
  return {
    status: res.rows[0].parse_status as ParseStatus,
    text: (res.rows[0].parsed_text as string | null) ?? null,
  };
}

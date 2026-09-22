/**
 * The upload parse instruction, as a module the capture harness can reach.
 *
 * It lived inline in `lib/uploads.ts` and was therefore invisible to
 * `scripts/capture-prompts.mts` — that module opens a child process and talks
 * to the filesystem, so the harness cannot import it to render one string
 * (seams §8: "neither is reachable by the capture harness"). Constitution IX's
 * proof mechanism is byte-identity of captured prompts, and a prompt the
 * harness cannot render is a prompt nobody can prove anything about. Moving the
 * text — and only the text — into a module with no imports makes it capturable
 * and leaves `uploads.ts` holding the process it runs it in.
 *
 * No student, no gender, no personalisation reaches this prompt. It instructs a
 * transcription, not a tutor: nothing here addresses a student, so P6's address
 * seam deliberately does not touch it.
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
export const PARSE_PROMPT = `Read the file at the path given below and transcribe the mathematics in it.

Rules:
- Transcribe ONLY the academic content: the problem, the working, the answer.
- Do NOT describe or transcribe anything incidental — people, faces, rooms,
  names, addresses, phone numbers, or anything else not part of the maths.
- If part of it is genuinely unreadable, say so explicitly and transcribe the
  rest. Never guess at an unreadable digit, symbol or step.
- If NOTHING is readable, or you cannot open the file at all, reply with exactly: UNREADABLE
- Reply with the transcription only — no preamble, no commentary, no JSON.`;

/**
 * What is actually written to the parser's stdin: the instruction plus the one
 * path it operates on. The concatenation lived at the call site; it is prompt
 * text, so it lives here with the rest of it and the harness captures the whole
 * model-visible payload rather than most of it.
 */
export function buildUploadParsePrompt(filePath: string): string {
  return `${PARSE_PROMPT}\n\nFile to read: ${filePath}\n`;
}

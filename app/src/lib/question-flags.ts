/**
 * TWO FLAGS A QUESTION'S `choices` MAY CARRY (Samuel's G2 answers 20 and 22,
 * 2026-09-26, decisions 41 and 43; the data contract is spec 003
 * `contracts/pipeline-handoff.md`, "Two G2 fields in `choices`").
 *
 *  - `less_specific: ["B", …]` — on a choice question whose options include
 *    more than one TRUE answer (a square is also a rectangle): the book's most
 *    specific answer is the key, and each option listed here is true but less
 *    precise. Picking one is sent back for re-entry — not an attempt, not
 *    wrong, no mastery effect — exactly like the maths marker's re-entry
 *    (`lib/attempt-grading.ts`, FR-4320).
 *  - `answer_only: true` — on any question whose book has no worked solution
 *    (Ex8-6:24a, key √34). The tutor confirms right or wrong and points to the
 *    lesson's own worked examples; it never works the answer out (grounded
 *    teaching, constitution Principle II; 001 FR-C01).
 *
 * `choices` is one jsonb column with several shapes. A flag needs an OBJECT to
 * sit on, so a choice question that carries `less_specific` stores its options
 * under `options`: `{ "options": [{key, text}, …], "less_specific": ["B"] }`.
 * `answer_only` sits beside a marked question's `marker`:
 * `{ "marker": {…}, "answer_only": true }` (it is read on an options object
 * too, should one ever carry it). A bare array of options — every question
 * before these flags — carries none, and reads as before. Nothing here
 * guesses: an absent or malformed flag is no flag.
 *
 * Pure; no database, no React.
 */
import type { Choice } from "./types";

/** The copy a student sees when she picks a true-but-less-precise option. */
export const LESS_SPECIFIC_MESSAGE =
  "That's true — but there's a more precise name for it. Try again.";

const isObject = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v);

const isChoice = (c: unknown): c is Choice =>
  isObject(c) && typeof c.key === "string" && typeof c.text === "string";

/**
 * The lettered options of a choice question, in either shape — a bare array,
 * or `{ options: [...] }` beside a flag — or `null` for anything else (a
 * number, a construction, a marker spec).
 */
export function choiceOptions(choices: unknown): Choice[] | null {
  if (Array.isArray(choices)) return choices as Choice[];
  if (isObject(choices) && Array.isArray(choices.options) && choices.options.every(isChoice)) {
    return choices.options as Choice[];
  }
  return null;
}

/** Does this question's book give no worked solution (`answer_only: true`)? */
export function isAnswerOnly(choices: unknown): boolean {
  return isObject(choices) && choices.answer_only === true;
}

const norm = (s: string) => s.trim().toUpperCase();

/**
 * The option keys that are true but less specific than the key, VALIDATED:
 * each must be one of the question's own option keys and must not be the
 * correct answer itself. Anything else is dropped and reported through `warn`
 * — a content defect for the loader to catch, never the student's problem and
 * never a crash. Keys are compared as the route compares a chosen option:
 * trimmed, case-insensitive.
 */
export function lessSpecificKeys(
  q: { choices: unknown; correct_answer: string; id?: string },
  warn: (message: string) => void = () => {}
): Set<string> {
  const out = new Set<string>();
  if (!isObject(q.choices) || q.choices.less_specific === undefined) return out;
  const raw = q.choices.less_specific;
  const where = q.id ? ` on ${q.id}` : "";
  if (!Array.isArray(raw)) {
    warn(`less_specific${where} is not a list of option keys — ignored`);
    return out;
  }
  const options = choiceOptions(q.choices);
  const keys = new Set((options ?? []).map((c) => norm(c.key)));
  const correct = norm(q.correct_answer ?? "");
  for (const k of raw) {
    if (typeof k !== "string" || !keys.has(norm(k))) {
      warn(`less_specific${where} names ${JSON.stringify(k)}, which is not one of its options — ignored`);
    } else if (norm(k) === correct) {
      warn(`less_specific${where} names the correct answer ${JSON.stringify(k)} — ignored`);
    } else {
      out.add(norm(k));
    }
  }
  return out;
}

/**
 * What the tutor is told about an `answer_only` question, wherever a prompt
 * would otherwise hand it the question's worked solution to walk through
 * (Samuel's G2 answer 22; grounded teaching, constitution Principle II and 001 FR-C01): the book
 * prints no working for it, so there is nothing grounded to explain with, and
 * working it out would be solving from scratch. One sentence, the same on
 * every surface that carries it — the lesson's question bank, the Ask
 * context's question in scope, and a Socratic probe's live-event note.
 */
export const ANSWER_ONLY_INSTRUCTION =
  "ANSWER ONLY — the book prints no worked solution for this question. Do NOT work it out, solve it, " +
  "or explain it step by step, and never invent a method for it: say whether the student's answer is " +
  "right or wrong, give the correct answer, and point the student to this lesson's own worked examples " +
  "(the book's worked examples, or a question here that carries a worked solution) for the method.";

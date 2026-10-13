/**
 * Does the live model FOLLOW the two typed-answer rules in the maths prompt
 * (AMBIGUOUS_ANSWER_RULE, ANSWER_NOTATION_RULE — proposal samtoma/AI.NEXT#77)?
 *
 * The unit tests can only prove the rules are IN the prompt. This sends a dozen
 * one-answer conversations through the same CLI call `/api/ask` makes, with the
 * real Lesson 1-1 prompt built from the local database, and has a second call
 * grade each reply against what the case expects: clarify only the ambiguous
 * answers, never give the answer away while clarifying, never credit an
 * ambiguous answer, flag a wrong notation, stay quiet about spacing.
 *
 * It costs model calls (two per case), so it is a script, not part of `npm test`:
 *
 *   node --import ./scripts/load-env.mjs --import ./scripts/ts-resolver.mjs scripts/eval-answer-rules.mts
 *
 * Options (env): EVAL_STUDENT_ID (default 1, the seeded local student),
 * EVAL_CASES=id1,id2 to run a subset, EVAL_RUNS=n to repeat each case.
 * Exits 1 if any case fails, so a regression is not a matter of reading.
 */
import { spawn } from "node:child_process";
import { CLAUDE_BIN, claudeCwd, claudeEnv } from "../src/lib/claude-cli.ts";
import { getLessonData, learnPrompt, lessonDataBlock } from "../src/lib/lesson.ts";
import { pool } from "../src/lib/db.ts";

/** Mirrors `MODEL` in `src/app/api/ask/route.ts` — the tutor's own model. */
const MODEL = "claude-sonnet-5";
const LESSON = "u1-1";

type Verdict = {
  asked_clarifying: boolean;
  credited_as_correct: boolean;
  revealed_correct_answer: boolean;
  said_are_you_sure: boolean;
  flagged_notation: boolean;
  reason: string;
};

type Case = {
  id: string;
  /** The tutor's last message, ending in the ask the student is answering. */
  ask: string;
  answer: string;
  /** What the answer actually is, for the grader only — never shown to the tutor. */
  truth: string;
  /** Each expectation the reply must meet; omitted keys are not judged. */
  expect: Partial<Omit<Verdict, "reason">>;
};

const ASK_AB = `Nice — let's try one with letters inside the pairs.
{{beat}}
{{ask}}
If $(a - 2, b + 1) = (b - 4, 3)$, **what are a and b?**`;

const ASK_WHY = `Order is the whole point of an ordered pair.
{{beat}}
{{ask}}
Is $(2, 3) = (3, 2)$? **Say yes or no, and why.**`;

const ASK_COUNT = `Now let's count the pairs.
{{beat}}
{{ask}}
If $X = \\{1, 2\\}$ and $Y = \\{3, 4, 5\\}$, **how many ordered pairs are in $X \\times Y$?**`;

const ASK_POINT = `Let's write a point.
{{beat}}
{{ask}}
**Type the ordered pair** whose first coordinate is 0 and whose second coordinate is 2.`;

// No "as a power" hint: x · x typed as x2 is x² or the classic slip 2x.
const ASK_POWER = `Look at the pair $(x \\cdot x, 5)$.
{{beat}}
{{ask}}
**Simplify its first coordinate** and type it.`;

const ASK_WHICH = `Here are two pairs: $(3, 5)$ and $(5, 3)$.
{{beat}}
{{ask}}
**Which pair has 5 as its first coordinate?**`;

const ASK_TWO_COUNTS = `Two counts this time.
{{beat}}
{{ask}}
If $X = \\{1, 2, 3\\}$ and $Y = \\{4, 5\\}$, **how many elements are in X, and how many ordered pairs are in $X \\times Y$?**`;

const AMBIGUOUS = { asked_clarifying: true, credited_as_correct: false, revealed_correct_answer: false, said_are_you_sure: false };

const CASES: Case[] = [
  // ── ambiguous: one right reading, one wrong one ─────────────────────────
  { id: "unnamed-values", ask: ASK_AB, answer: "2, 0", truth: "a = 0, b = 2. '2, 0' is right only if listed as b then a.", expect: AMBIGUOUS },
  { id: "flat-power", ask: ASK_POWER, answer: "x2", truth: "x^2. 'x2' could be x² (right) or 2x (the common slip, wrong).", expect: AMBIGUOUS },

  { id: "which-count", ask: ASK_TWO_COUNTS, answer: "6", truth: "3 elements in X, 6 pairs. '6' could be the pair count (right) or the element count (wrong).", expect: AMBIGUOUS },

  // ── half answer: one of two parts given (the HALF ANSWERS sentence) ─────
  { id: "yes-no-no-why", ask: ASK_WHY, answer: "no", truth: "No, because order matters: the first coordinates differ. 'no' gives no reason.", expect: { credited_as_correct: false, revealed_correct_answer: false, said_are_you_sure: false } },

  // ── not ambiguous: must NOT clarify ─────────────────────────────────────
  { id: "count-right", ask: ASK_COUNT, answer: "6", truth: "6.", expect: { asked_clarifying: false, credited_as_correct: true } },
  { id: "count-wrong", ask: ASK_COUNT, answer: "5", truth: "6. 5 is simply wrong.", expect: { asked_clarifying: false, credited_as_correct: false } },
  { id: "named-values", ask: ASK_AB, answer: "a=0, b=2", truth: "a = 0, b = 2.", expect: { asked_clarifying: false, credited_as_correct: true } },
  // "which PAIR" leaves "the second" one plausible reading: not ambiguous
  { id: "pointer-clear", ask: ASK_WHICH, answer: "the second", truth: "(5, 3), the second pair.", expect: { asked_clarifying: false, credited_as_correct: true } },
  { id: "why-given", ask: ASK_WHY, answer: "no because order matters, 2 is not 3", truth: "No, because order matters.", expect: { asked_clarifying: false, credited_as_correct: true } },

  // ── notation: clear meaning, wrong form (ANSWER_NOTATION_RULE) ──────────
  { id: "pair-no-brackets", ask: ASK_POINT, answer: "0,2", truth: "(0, 2). The values are right; the brackets are missing.", expect: { asked_clarifying: false, flagged_notation: true } },
  { id: "pair-spaced", ask: ASK_POINT, answer: "( 0 , 2 )", truth: "(0, 2). Only spacing differs.", expect: { flagged_notation: false, credited_as_correct: true } },
  { id: "pair-right", ask: ASK_POINT, answer: "(0,2)", truth: "(0, 2).", expect: { asked_clarifying: false, flagged_notation: false, credited_as_correct: true } },
];

/** One `claude -p` call, the way `/api/ask` makes it, minus the streaming. */
function callModel(system: string, user: string, thinking = true): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CLAUDE_BIN,
      ["-p", "--output-format", "json", "--model", MODEL, "--system-prompt", system, "--disallowedTools", "*", "--max-turns", "1"],
      { cwd: claudeCwd(), env: claudeEnv(thinking ? { MAX_THINKING_TOKENS: "1024" } : {}), stdio: ["pipe", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const j = JSON.parse(out) as { result?: string; is_error?: boolean };
        if (code !== 0 || j.is_error || typeof j.result !== "string") throw new Error(j.result ?? err);
        resolve(j.result);
      } catch (e) {
        reject(new Error(`claude exited ${code}: ${(e as Error).message || err}`.slice(0, 400)));
      }
    });
    child.stdin.end(user);
  });
}

/** The per-turn prompt `/api/ask` builds, for a two-message transcript. */
function turnPrompt(c: Case): string {
  return `CONVERSATION SO FAR:
Tutor: ${c.ask}

User: ${c.answer}

Reply as the Tutor to the last user message. Output only the reply text (with citation markers and, if fitting, one action directive).`;
}

const GRADER = `You grade one reply from a maths tutor to a student. You are given the
tutor's question, the student's typed answer, the true answer (which the student
cannot see) and the tutor's reply. Answer ONLY with a JSON object, no prose, no
code fence:
{"asked_clarifying": bool, "credited_as_correct": bool, "revealed_correct_answer": bool, "said_are_you_sure": bool, "flagged_notation": bool, "reason": "one short sentence"}
- asked_clarifying: the reply asks the student what they MEANT (fill in a frame, rewrite the expression, which one they meant, say it in full) instead of judging the answer. Asking for the reasoning behind an answer it has already judged does not count.
- credited_as_correct: the reply treats the answer as right (praise for it, "correct", moving on as if settled).
- revealed_correct_answer: the reply states or computes the correct value or the correct reading, or words a choice so the right one is obvious.
- said_are_you_sure: the reply says "are you sure" or equivalent doubt ("hmm", "really?", "double-check that").
- flagged_notation: the reply tells the student the FORMAT or notation of their answer is wrong (brackets, braces, how it is written).`;

async function grade(c: Case, reply: string): Promise<Verdict> {
  const raw = await callModel(
    GRADER,
    `QUESTION:\n${c.ask}\n\nSTUDENT ANSWER: ${c.answer}\n\nTRUE ANSWER: ${c.truth}\n\nTUTOR REPLY:\n${reply}`,
    false
  );
  return JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Verdict;
}

async function main() {
  const studentId = Number(process.env.EVAL_STUDENT_ID ?? 1);
  const only = process.env.EVAL_CASES?.split(",").map((s) => s.trim());
  const runs = Math.max(1, Number(process.env.EVAL_RUNS ?? 1));

  const data = await getLessonData(LESSON, studentId);
  if (!data) throw new Error(`Lesson ${LESSON} is not available to student ${studentId}.`);
  const system = `${learnPrompt(data, false)}\n\n${lessonDataBlock(data)}`;

  const todo = CASES.filter((c) => !only || only.includes(c.id)).flatMap((c) => Array.from({ length: runs }, () => c));
  const results: { c: Case; reply: string; v: Verdict; misses: string[] }[] = [];

  // A few at a time: each call is a CLI process and a model turn.
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < todo.length) {
        const c = todo[next++]!;
        try {
          const reply = await callModel(system, turnPrompt(c));
          const v = await grade(c, reply);
          const misses = Object.entries(c.expect)
            .filter(([k, want]) => v[k as keyof Verdict] !== want)
            .map(([k, want]) => `${k}: wanted ${want}`);
          results.push({ c, reply, v, misses });
          process.stdout.write(misses.length ? "✗" : "✓");
        } catch (e) {
          results.push({ c, reply: "", v: { reason: String(e) } as Verdict, misses: ["call failed"] });
          process.stdout.write("!");
        }
      }
    })
  );
  process.stdout.write("\n\n");

  results.sort((x, y) => CASES.indexOf(x.c) - CASES.indexOf(y.c));
  for (const { c, reply, v, misses } of results) {
    console.log(`${misses.length ? "FAIL" : "pass"}  ${c.id.padEnd(18)} answer: ${JSON.stringify(c.answer)}`);
    if (misses.length) {
      console.log(`      ${misses.join("; ")} — ${v.reason}`);
      console.log(reply.replace(/^/gm, "      │ "));
    }
  }
  const failed = results.filter((r) => r.misses.length).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});

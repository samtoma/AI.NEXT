/**
 * SC-212 replay: every recorded attempt of the existing courses, marked again through the dispatch the
 * attempts route runs (`markAnswer` in `src/lib/attempt-grading.ts`, T416), must get the verdict the grader
 * of v0.9.3 gives.
 *
 *   node --import ./scripts/ts-resolver.mjs scripts/marker-eval/replay-attempts.mts <database-url> [...]
 *
 * READ ONLY: each database is read inside `BEGIN READ ONLY`, so the replay cannot change the data it
 * proves (the effect of replaying "from a copy", without copying).
 *
 * `grade()` below is a FROZEN copy of v0.9.3's grader, the private function that lived in
 * `src/app/api/attempts/route.ts`. T416 moved it, verbatim, into `src/lib/attempt-grading.ts`, and this
 * script refuses to run unless the two are byte-identical, so the reference cannot drift with the code it
 * checks. The dispatch is the real one, imported: the replay proves the route's own marking path.
 *
 * Three numbers per database:
 *   1. dispatch  vs v0.9.3's grade()    — MUST be identical for every attempt (SC-212). Exit code 1 if not.
 *      A re-entry ("retry") counts as a difference: an attempt that was recorded must still be recordable.
 *   2. questions carrying a marker spec — MUST be 0 for the existing courses (the marker path is never
 *      taken for them, by construction: `choices.marker` is absent).
 *   3. today's grade() vs the stored `is_correct` — informational: it measures how far the grader has
 *      moved since the attempt was written (widget attempts are graded by predicate and are excluded).
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { evaluateArithmeticExpression } from "../../src/lib/arithmetic.ts";
import { markAnswer } from "../../src/lib/attempt-grading.ts";

// ------------------------------------------------------------------ v0.9.3's grader, frozen
function grade(
  questionType: string,
  correct: string,
  given: string
): boolean {
  if (questionType === "numeric") {
    const a = parseFloat(correct);
    if (!Number.isNaN(a)) {
      const trimmedGiven = given.trim();
      // The common case: a clean numeric literal, no working shown.
      if (/^[+-]?\d+(\.\d+)?$/.test(trimmedGiven)) {
        return Math.abs(a - parseFloat(trimmedGiven)) < 1e-6;
      }
      // The student typed the steps that lead to the answer ("3x4" for 12)
      // instead of the final value. Evaluate deterministically — no model
      // call — before falling back to treating it as text.
      const evaluated = evaluateArithmeticExpression(trimmedGiven);
      if (evaluated !== null) return Math.abs(a - evaluated) < 1e-6;
      const b = parseFloat(trimmedGiven);
      if (!Number.isNaN(b)) return Math.abs(a - b) < 1e-6;
    }
  }
  return correct.trim().toLowerCase() === given.trim().toLowerCase();
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const functionText = (src: string): string => {
  const start = src.search(/\n(export )?function grade\(/);
  if (start < 0) throw new Error("grade() not found");
  const end = src.indexOf("\n}\n", start);
  return src.slice(start + 1, end + 2).replace(/^export /, "");
};
const liveGrade = functionText(readFileSync(path.join(HERE, "../../src/lib/attempt-grading.ts"), "utf8"));
const ownGrade = functionText(readFileSync(fileURLToPath(import.meta.url), "utf8"));
if (liveGrade !== ownGrade) {
  console.error("grade() in src/lib/attempt-grading.ts differs from v0.9.3's; SC-212 forbids that. Refusing to run.");
  process.exit(2);
}
const gradeHash = createHash("sha256").update(liveGrade).digest("hex").slice(0, 16);

// ------------------------------------------------------------------ the T416 dispatch
type Row = { question_type: string; correct_answer: string; choices: unknown; given_answer: string };

/** What the route does: `markAnswer`, the function it calls. A re-entry records nothing ("retry"). */
function dispatch(r: Row): boolean | "retry" {
  const v = markAnswer(r, r.given_answer);
  return v.verdict === "graded" ? v.isCorrect : "retry";
}

// ------------------------------------------------------------------ run
const urls = process.argv.slice(2);
if (!urls.length) {
  console.error("usage: replay-attempts.mts <database-url> [...]");
  process.exit(64);
}
let failed = false;
console.log(`grade() in src/lib/attempt-grading.ts: sha256 ${gradeHash} (byte-identical to v0.9.3's, verified)`);
for (const url of urls) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const markerQs = await client.query(
      `SELECT count(*)::int AS n FROM questions WHERE jsonb_typeof(choices) = 'object' AND choices ? 'marker'`
    );
    const { rows } = await client.query<Row & { is_correct: boolean; attempt_id: string; question_id: string }>(
      `SELECT a.id AS attempt_id, a.question_id, a.given_answer, a.is_correct,
              q.question_type, q.correct_answer, q.choices
         FROM attempts a JOIN questions q ON q.id = a.question_id
        WHERE q.question_type <> 'widget'
        ORDER BY a.id`
    );
    await client.query("COMMIT");
    let same = 0;
    let driftFromStored = 0;
    const differ: unknown[] = [];
    const byType = new Map<string, number>();
    for (const r of rows) {
      byType.set(r.question_type, (byType.get(r.question_type) ?? 0) + 1);
      const frozen = grade(r.question_type, r.correct_answer, r.given_answer);
      const next = dispatch(r);
      if (next === frozen) same++;
      else differ.push({ attempt: r.attempt_id, question: r.question_id, given: r.given_answer, frozen, next });
      if (frozen !== r.is_correct) driftFromStored++;
    }
    const db = new URL(url).pathname.slice(1);
    console.log(
      `${db}: ${rows.length} attempts (${[...byType].map(([t, n]) => `${t} ${n}`).join(", ")}); ` +
        `dispatch == v0.9.3 grade(): ${same}/${rows.length}; questions with a marker spec: ${markerQs.rows[0].n}; ` +
        `grade() vs stored is_correct: ${rows.length - driftFromStored}/${rows.length} agree`
    );
    if (differ.length) {
      failed = true;
      console.error(JSON.stringify(differ.slice(0, 20), null, 1));
    }
  } finally {
    await client.end();
  }
}
process.exit(failed ? 1 : 0);

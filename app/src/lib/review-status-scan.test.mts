/**
 * No student surface says whether content was reviewed (ADR-0019, FR-3211).
 *
 * Samuel's rule of 2026-09-23: the whole maths bank is live, review status
 * stays in the data, and it is an OPERATOR fact — shown in the console, never
 * to a student. `15906fa` removed the last student-visible claims ("reviewed
 * canonical solution", "Reviewed ✓ / Not reviewed", "Reviewed question"). This
 * is what stops one coming back: it reads every student-surface source file,
 * strips comments, and fails on review-status wording in anything a screen
 * could print — a string literal or JSX text.
 *
 * A source scan and not a render: the claim is about every string these files
 * can put on a screen, including branches no fixture reaches, and a render
 * test proves only the branches it rendered.
 *
 * **The allowlist is named, not a pattern.** Each entry is a specific string in
 * a specific file with the reason it is not student copy. The two today are
 * ChatCore's Socratic-probing notes to the TUTOR — `[live event]` rows, which
 * student mode never renders (`m.kind === "event" && !debug`), and whose
 * wording belongs with the prompt-wording issue (#51), not here.
 *
 * @covers FR-3211
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../", import.meta.url));

/** Every surface a student can reach. The console lives elsewhere. */
const STUDENT_ROOTS = [
  "app/(student)",
  "app/(auth)",
  "components/student",
  "components/spine",
  "components/chat",
  "components/viz",
  "components/auth",
];

const REVIEW_WORDS =
  /\b(un)?reviewed\b|\bnot\s+reviewed\b|\bunchecked\b|\bhuman[- ]?(checked|reviewed)\b|\bchecked\s+by\s+a\s+(human|person)\b/i;

/** file (relative to src/) → exact strings allowed, each with its reason. */
const ALLOWED: Record<string, { text: RegExp; why: string }[]> = {
  "components/chat/ChatCore.tsx": [
    {
      text: /no reviewed material matches this specific error/,
      why: "a [live event] note to the tutor under Socratic probing; student mode never renders event rows (#51, #53)",
    },
  ],
};

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (/\.(tsx?|mts)$/.test(name) && !/\.test\.mts$/.test(name)) out.push(p);
  }
  return out;
}

/** Comments out, so a sentence ABOUT review status is not review status. */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** What a screen could print: string literals and JSX text. */
function printable(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)) {
    out.push(m[0]);
  }
  for (const m of code.matchAll(/>([^<>{}]+)</g)) out.push(m[1]!);
  return out;
}

const files = STUDENT_ROOTS.flatMap((r) => walk(path.join(SRC, r)));

test("the scan reaches the student surfaces it claims to", () => {
  const rel = files.map((f) => path.relative(SRC, f));
  for (const expected of [
    "app/(student)/page.student.tsx",
    "components/spine/QuestionModal.tsx",
    "components/student/LessonSession.tsx",
    "components/chat/ChatQuestionCard.tsx",
  ]) {
    assert.ok(rel.includes(expected), `${expected} is not scanned`);
  }
  assert.ok(files.length > 40, `only ${files.length} files scanned`);
});

test("no student-surface string states whether content was reviewed (ADR-0019)", () => {
  const found: string[] = [];
  for (const f of files) {
    const rel = path.relative(SRC, f);
    for (const s of printable(stripComments(readFileSync(f, "utf8")))) {
      if (!REVIEW_WORDS.test(s)) continue;
      if ((ALLOWED[rel] ?? []).some((a) => a.text.test(s))) continue;
      found.push(`${rel}: ${s.slice(0, 100)}`);
    }
  }
  assert.deepEqual(found, [], `review-status wording on a student surface:\n${found.join("\n")}`);
});

test("the negative control: the scan does catch the wording 15906fa removed", () => {
  for (const removed of [
    `"reviewed, with canonical solutions"`,
    `<span>Reviewed ✓</span>`,
    `{ title: "Reviewed question" }`,
    `"Generated · unchecked"`,
  ]) {
    assert.ok(
      printable(stripComments(removed)).some((s) => REVIEW_WORDS.test(s)),
      `the scan would miss ${removed}`
    );
  }
  // …and does not trip on an identifier or a comment.
  assert.equal(
    printable(stripComments(`const ok = q.reviewed; // reviewed by a human\n/* unreviewed */`)).some(
      (s) => REVIEW_WORDS.test(s)
    ),
    false
  );
});

test("the /spine question pop-up is never opened in its debug mode", () => {
  // QuestionModal keeps the engineering record — status, the provenance badge
  // ("Generated · unchecked"), ids — behind `debug`, for an operator surface.
  // The student's /spine must never pass it.
  const explorer = stripComments(
    readFileSync(path.join(SRC, "components/spine/SpineExplorer.tsx"), "utf8")
  );
  const call = explorer.slice(explorer.indexOf("<QuestionModal"), explorer.indexOf("/>", explorer.indexOf("<QuestionModal")));
  assert.ok(call.length > 0, "SpineExplorer no longer opens QuestionModal — update this test");
  assert.doesNotMatch(call, /\bdebug\b/, "the student's /spine passes debug to QuestionModal");

  const modal = stripComments(
    readFileSync(path.join(SRC, "components/spine/QuestionModal.tsx"), "utf8")
  );
  const badge = modal.indexOf("<ProvenanceBadge");
  const branch = modal.lastIndexOf("{debug ?", badge);
  assert.ok(badge > 0 && branch > 0 && badge - branch < 400, "the provenance badge is not inside the debug branch");
});

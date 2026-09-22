/**
 * The grounding link — that an uploaded worksheet actually reaches the turn it
 * was uploaded for (FR-205, PRD B10, and the half of SC-009 that says
 * "including via upload").
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SOURCE WALK AND NOT A REQUEST
 * ---------------------------------------------------------------------------
 * The honest test is: sign a student in, post a photograph, post a turn, and
 * read the prompt the model was handed. That needs Postgres, a signed access
 * token and the `claude` CLI, so it belongs to the live smoke run and not to
 * `npm test` — which means it is not the test that runs on the commit that
 * breaks this.
 *
 * What broke this before was not a wrong value. It was a MISSING WIRE: the
 * route simply never read `uploadId` from its body, so `askContext`'s
 * `uploadId` parameter — which existed, and worked — was handed `undefined` on
 * every turn the product has ever served, and the upload path was dead in a way
 * no type checker could see and no unit test would notice. The 001 matrix
 * records it as "uploads are unreachable and the grounding link is dead".
 *
 * So the wire itself is what is asserted, hop by hop, the same way
 * `replay-guard.test.mts` asserts a module graph: composer → route → context
 * builder → `retrieve()`. Every hop is one grep a reviewer could do by hand,
 * and together they are the thing that was missing.
 *
 * ---------------------------------------------------------------------------
 * AND THE ONE THING THAT MUST *NOT* BE THERE
 * ---------------------------------------------------------------------------
 * Upload isolation is a row-level-security policy on `uploads` (enabled AND
 * forced) plus `getParsedUpload(uploadId, studentId)` reading inside the
 * student's own unit of work. The route must not grow a second opinion about
 * whose upload this is. Two ownership checks cannot be kept in step, and the
 * weaker one is always the one people trust, because it is the one they can
 * see. The last test here is that no such check exists.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `app/src` — the root `@/` resolves to. */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/**
 * The file with its comments removed.
 *
 * Every assertion below is about what the code DOES, and this repo explains
 * itself at length — the route's own comment names `getParsedUpload(uploadId,
 * studentId)` in order to say why it must not call it, which is precisely the
 * string the last test forbids. A test that could be satisfied, or broken, by
 * prose is not a test of the wire. (Safe here because none of these files
 * contains a `//` outside a comment — no URLs, no regex literals with one —
 * which is checked by eye and is why the stripper can stay this simple.)
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gm, "$1");
}

const ASK_ROUTE = code(read("app/api/ask/route.ts"));
const LESSON = code(read("lib/lesson.ts"));
const ASK = code(read("lib/ask.ts"));
const CHAT_CORE = code(read("components/chat/ChatCore.tsx"));
const CONTROL = code(read("components/chat/upload-attachment.tsx"));

/**
 * The balanced argument text of the first `name(` call in `source`.
 *
 * Balanced rather than "the next 300 characters", because these call sites are
 * multi-line and nested, and a fixed window would either miss the argument or
 * wander into the next statement — both of which turn this file into a test
 * that passes for the wrong reason.
 */
function callArgs(source: string, name: string): string {
  const open = source.indexOf(`${name}(`);
  assert.notEqual(open, -1, `${name}( is not called at all`);
  let depth = 0;
  const from = open + name.length;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return source.slice(from + 1, i);
    }
  }
  assert.fail(`unbalanced parentheses after ${name}(`);
}

/* --------------------------------------------------- hop 1: the composer */

test("the composer sends the attached upload with the turn", () => {
  const body = callArgs(CHAT_CORE, "JSON.stringify");
  assert.match(
    body,
    /uploadId:/,
    "ChatCore posts to /api/ask without the id the student just uploaded"
  );
});

test("the composer offers an upload on the student surfaces", () => {
  assert.match(CONTROL, /type="file"/, "there is no file input anywhere");
  assert.match(CONTROL, /capture=/, "a phone is never offered its camera");
  assert.match(CHAT_CORE, /useUploadAttachment\(/, "ChatCore never mounts the control");
});

/* ------------------------------------------------------- hop 2: the route */

test("the route reads uploadId from the body and validates it", () => {
  assert.match(
    ASK_ROUTE,
    /coerceUploadId\(\s*body\.uploadId\s*\)/,
    "the route does not read uploadId — this is the break FR-205 had"
  );
});

test("the route passes the id to BOTH context builders", () => {
  // Both, because the control lives in the composer that all four surfaces
  // render: a lesson is where a worksheet is most likely to be photographed,
  // and threading the id only into `buildAskContext` would leave the button
  // visible and its grounding dead on exactly the surface that carries it.
  for (const builder of ["buildLessonContext", "buildAskContext"]) {
    assert.match(
      callArgs(ASK_ROUTE, builder),
      /\buploadId\b/,
      `${builder} is called without the upload`
    );
  }
});

test("the upload is part of the grounding snapshot key", () => {
  // Without this the first turn of a chat session is cached for three hours and
  // replayed verbatim, so a photograph taken after "hi" would never reach the
  // model at all — a dead link that looks exactly like a working one.
  assert.match(
    callArgs(ASK_ROUTE, "snapshotKey"),
    /\buploadId\b/,
    "a snapshot built before the upload would be replayed over every turn after it"
  );
});

/* -------------------------------------------- hop 3: into the retrieval */

test("both context builders hand the id to retrieve()", () => {
  for (const [name, source] of [
    ["lib/lesson.ts", LESSON],
    ["lib/ask.ts", ASK],
  ] as const) {
    assert.match(
      callArgs(source, "retrieve"),
      /\buploadId\b/,
      `${name} builds a context that cannot see the student's upload`
    );
  }
});

/* ------------------------------------------- the check that must not exist */

test("the route adds no second opinion about whose upload this is", () => {
  // The scoped read IS the check (lib/uploads.ts `getParsedUpload`, plus the
  // forced RLS policy on `uploads`). Anything here would be a copy of it that
  // can drift, and drift in the permissive direction is invisible.
  for (const forbidden of [/getParsedUpload/, /\bFROM\s+uploads\b/i, /uploads\b[^\n]*student_id/]) {
    assert.equal(
      forbidden.test(ASK_ROUTE),
      false,
      `api/ask/route.ts grew its own ownership check (${forbidden})`
    );
  }
});

test("the client holds an integer and no notion of ownership", () => {
  for (const forbidden of [/studentId/, /student_id/, /getParsedUpload/]) {
    assert.equal(
      forbidden.test(CONTROL),
      false,
      `the upload control reasons about whose upload it is (${forbidden})`
    );
  }
});

/* -------------------------------------------------- the SC-009 guardrail */

test("the upload path still refuses to hand over graded answers", () => {
  // SC-009 is "zero direct answers served to graded work, INCLUDING VIA
  // UPLOAD". The constraint is one paragraph in `retrievalBlock`, appended
  // beside the transcription itself, and it is the reason wiring this link is
  // safe. It is asserted here rather than left to a prompt review because it
  // sits in the only block a `uploadId` can add, and deleting it would look
  // like tidying.
  const retrieval = read("lib/retrieval.ts");
  assert.match(retrieval, /guide-don't-answer rule applies here/);
  assert.match(retrieval, /do NOT hand over the finished answer/);
  assert.match(retrieval, /not a way around that/);
});

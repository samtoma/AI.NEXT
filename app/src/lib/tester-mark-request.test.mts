// @covers FR-3107
/**
 * The tester-mark endpoint's body, read closed (fix pass 2). Pure: the route
 * (`api/console/students/[id]/tester/route.console.ts`) hands its parsed JSON
 * here and answers 400 with whatever `error` comes back; the static half at
 * the bottom pins that it does.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { TESTER_NOTE_MAX, parseTesterMarkBody } from "./tester-mark-request.ts";

test("mark: a note is kept, trimmed, cut at the limit; an empty one is no note", () => {
  assert.deepEqual(parseTesterMarkBody({ tester: true, note: "  Samuel's iPad  " }), {
    ok: true,
    tester: true,
    note: "Samuel's iPad",
  });
  assert.deepEqual(parseTesterMarkBody({ tester: true }), { ok: true, tester: true, note: null });
  assert.deepEqual(parseTesterMarkBody({ tester: true, note: "   " }), { ok: true, tester: true, note: null });
  assert.deepEqual(parseTesterMarkBody({ tester: true, note: 42 }), { ok: true, tester: true, note: null });
  const long = parseTesterMarkBody({ tester: true, note: "x".repeat(TESTER_NOTE_MAX + 50) });
  assert.ok(long.ok && long.note?.length === TESTER_NOTE_MAX);
});

test("unmark: exactly { tester: false } — a note in any shape is refused, not dropped", () => {
  assert.deepEqual(parseTesterMarkBody({ tester: false }), { ok: true, tester: false, note: null });
  for (const note of ["removing: account handed back", "", "   ", null, 0, false, {}]) {
    assert.deepEqual(
      parseTesterMarkBody({ tester: false, note }),
      { ok: false, error: "note_not_allowed_on_unmark" },
      `note=${JSON.stringify(note)}`
    );
  }
});

test("anything that is not a boolean `tester` is refused, whatever else it carries", () => {
  for (const body of [{}, { tester: "true" }, { tester: 1 }, { tester: null }, { note: "x" }, null, [], "tester", 7]) {
    assert.deepEqual(parseTesterMarkBody(body), { ok: false, error: "invalid_tester" }, JSON.stringify(body));
  }
});

test("the route answers every refusal with 400 and its code, and writes only what the parser returned", () => {
  const route = readFileSync(
    fileURLToPath(new URL("../app/api/console/students/[id]/tester/route.console.ts", import.meta.url)),
    "utf8"
  );
  assert.match(route, /const parsed = parseTesterMarkBody\(body\);/);
  assert.match(route, /if \(!parsed\.ok\) \{[\s\S]*?status: 400/);
  assert.match(route, /setTesterMark\(me\.operatorId, studentId, parsed\.tester, parsed\.note\)/);
  assert.doesNotMatch(route, /body\.note|body\.tester/, "the route must not read the body around the parser");
  // the console's own editor never sends a note on unmark
  const editor = readFileSync(
    fileURLToPath(new URL("../components/console/TesterMarkEditor.tsx", import.meta.url)),
    "utf8"
  );
  assert.match(editor, /JSON\.stringify\(tester \? \{ tester, note \} : \{ tester \}\)/);
});

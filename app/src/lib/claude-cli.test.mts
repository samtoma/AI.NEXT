/**
 * The CLI failure classifier, and the one misfile that would have hidden the
 * incident of 2026-09-22 (FR-3003, FR-3004).
 *
 * Pure: the classifier takes an exit code, a spawn error and whatever text the
 * CLI printed, and returns one of seven words. So every boundary is testable
 * with fixture strings, no process, no credential and no network — which is
 * the only way to test `not_signed_in` at all without logging somebody out.
 *
 * **The fixture strings are paraphrases, deliberately.** They are written to
 * the shape of the real messages rather than pasted from a live failure,
 * because a CLI's diagnostic output can carry a path, a home directory or a
 * fragment of the thing that failed to authenticate — and a test file is in
 * git forever. The one message reproduced closely is the box's own, which is
 * already quoted in `deploy/TAKEOVER.md` and in migration 026's header and
 * contains nothing but English.
 *
 * @covers FR-3003, FR-3004
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLI_CODES,
  CLI_CODE_ACTION,
  CLI_CODE_LABEL,
  CLAUDE_BIN,
  PROBE_PROMPT,
  claudeCwd,
  claudeEnv,
  classifyCliFailure,
  isCliFailure,
  isProbeAnswer,
} from "./claude-cli.ts";

/* ------------------------------------------------------- the vocabulary */

test("every code has a label and an action", () => {
  for (const code of CLI_CODES) {
    assert.ok(CLI_CODE_LABEL[code], `${code} has no label`);
    assert.ok(CLI_CODE_ACTION[code], `${code} has no action`);
  }
});

test("the actions send the reader to four different places", () => {
  // The whole reason there are seven codes rather than one. If two of these
  // ever became the same sentence, the code they distinguish would have
  // stopped earning its place — and an operator would be sent to a terminal
  // for a rate limit, or to a deploy log for an expired sign-in.
  assert.ok(CLI_CODE_ACTION.not_signed_in.includes("Only Samuel"));
  assert.ok(CLI_CODE_ACTION.cli_missing.includes("deploy fault"));
  assert.ok(CLI_CODE_ACTION.call_failed.includes("transient"));
  assert.ok(CLI_CODE_ACTION.bad_output.includes("product question"));
  const distinct = new Set(CLI_CODES.filter((c) => c !== "ok").map((c) => CLI_CODE_ACTION[c]));
  assert.equal(distinct.size, CLI_CODES.length - 1, "two failure codes share one action");
});

test("only `ok` means the tutor can teach", () => {
  assert.equal(isCliFailure("ok"), false);
  for (const code of CLI_CODES.filter((c) => c !== "ok")) {
    assert.equal(isCliFailure(code), true, `${code} should count as a failure`);
  }
});

/* --------------------------------------------------------- the spawn seam */

test("the binary is a name, resolved through PATH", () => {
  // Not an absolute path: the CLI lives somewhere different in the container,
  // on a laptop and on whatever box comes next, and a name plus the PATH below
  // is the one form true in all three.
  assert.equal(CLAUDE_BIN, "claude");
  assert.ok(!CLAUDE_BIN.includes("/"));
});

test("claudeEnv appends the npm-global bin directory and keeps everything else", () => {
  const before = process.env.PATH;
  const home = process.env.HOME;
  try {
    process.env.PATH = "/usr/bin";
    process.env.HOME = "/home/someone";
    const env = claudeEnv();
    assert.equal(env.PATH, "/usr/bin:/home/someone/.local/bin");
    // The rest of the environment is inherited untouched — which is how the
    // CLI finds its own sign-in (CLAUDE_CONFIG_DIR, HOME). A probe that
    // stripped it would authenticate differently from the product and prove
    // nothing about it.
    assert.equal(env.HOME, "/home/someone");
  } finally {
    process.env.PATH = before;
    process.env.HOME = home;
  }
});

test("claudeEnv's extra variables are merged last and cannot be lost", () => {
  const env = claudeEnv({ MAX_THINKING_TOKENS: "2048" });
  assert.equal(env.MAX_THINKING_TOKENS, "2048");
  assert.ok((env.PATH ?? "").includes(".local/bin"));
});

test("claudeCwd is TMPDIR, or /tmp — never the repository", () => {
  const before = process.env.TMPDIR;
  try {
    process.env.TMPDIR = "/var/folders/xyz";
    assert.equal(claudeCwd(), "/var/folders/xyz");
    delete process.env.TMPDIR;
    assert.equal(claudeCwd(), "/tmp");
  } finally {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
  }
});

/* ----------------------------------------------- the classifier's order */

test("our own timeout beats every other signal", () => {
  // A killed child prints whatever it had got to and exits on a signal. Both
  // are artefacts of the kill, not evidence about the credential.
  assert.equal(
    classifyCliFailure({
      timedOut: true,
      exitCode: null,
      text: "failed to authenticate",
    }),
    "timed_out"
  );
});

test("a process that never started is classified from its spawn error", () => {
  assert.equal(
    classifyCliFailure({ spawnError: { code: "ENOENT", message: "spawn claude ENOENT" } }),
    "cli_missing"
  );
  assert.equal(
    classifyCliFailure({ spawnError: { code: "EACCES", message: "permission denied" } }),
    "spawn_failed"
  );
});

test("a spawn error outranks anything printed, because nothing printed it", () => {
  assert.equal(
    classifyCliFailure({
      spawnError: { code: "ENOENT" },
      text: "unauthorized",
    }),
    "cli_missing"
  );
});

test("exit 127 is a missing binary, not a failed call", () => {
  assert.equal(classifyCliFailure({ exitCode: 127, text: "command not found" }), "cli_missing");
});

/* --------------------------------- the one that matters: not_signed_in */

test("the message the live box actually produced is `not_signed_in`", () => {
  // The seven-week outage, verbatim from deploy/TAKEOVER.md §5. If this ever
  // stops returning `not_signed_in`, the console goes back to calling the
  // incident a generic backend error and somebody is sent to look at the wrong
  // thing.
  assert.equal(
    classifyCliFailure({
      exitCode: 1,
      text: "Failed to authenticate: OAuth session expired and could not be refreshed",
    }),
    "not_signed_in"
  );
});

test("the neighbouring wordings for the same condition are `not_signed_in`", () => {
  const shapes = [
    "OAuth token has expired",
    "Error: authentication_error — invalid bearer token",
    "Unauthorized",
    "You are not logged in. Run /login to continue.",
    "No credentials found for this configuration directory",
    "Your session expired; please log in to continue",
    "invalid api key · fix external/ANTHROPIC_API_KEY",
    "Please run `claude login`",
  ];
  for (const text of shapes) {
    assert.equal(classifyCliFailure({ exitCode: 1, text }), "not_signed_in", text);
  }
});

test("matching is case-insensitive, because a CLI capitalises how it likes", () => {
  assert.equal(
    classifyCliFailure({ exitCode: 1, text: "FAILED TO AUTHENTICATE" }),
    "not_signed_in"
  );
});

/* ------------------------------------ and the misfiles it must not make */

test("an ordinary failure is `call_failed`, not a credential problem", () => {
  // The negative control. If these came back `not_signed_in`, the tile would
  // send Samuel to a TTY at 3am for a rate limit — which is how an operator
  // learns to ignore the tile, and is the failure mode the seven codes exist
  // to prevent.
  const transient = [
    "rate_limit_error: too many requests",
    "overloaded_error",
    "fetch failed: ECONNRESET",
    "getaddrinfo ENOTFOUND api.anthropic.com",
    "Error: model not found",
    "",
  ];
  for (const text of transient) {
    assert.equal(classifyCliFailure({ exitCode: 1, text }), "call_failed", text);
  }
});

test("a bare 401 and a bare `sign in` are NOT credential signatures", () => {
  // Both were considered and left out for being too loose: `401` matches a
  // token count and a file path, and `sign in` matches half the product's own
  // copy. A signature that fires on ordinary output is worse than one that
  // misses, because both outcomes are still failures on the tile and only one
  // of them wakes somebody up wrongly.
  assert.equal(
    classifyCliFailure({ exitCode: 1, text: "prompt was 401 tokens, over budget" }),
    "call_failed"
  );
  assert.equal(
    classifyCliFailure({ exitCode: 1, text: "could not sign in the student" }),
    "call_failed"
  );
});

test("no failure ever classifies as `ok`", () => {
  // `classifyCliFailure` is only ever called on a path that has already failed,
  // so returning `ok` would mark a broken runtime healthy. Belt and braces.
  const inputs = [
    { exitCode: 1 },
    { exitCode: 127 },
    { timedOut: true },
    { spawnError: { code: "ENOENT" } },
    { exitCode: 1, text: "unauthorized" },
    {},
  ];
  for (const input of inputs) {
    assert.notEqual(classifyCliFailure(input), "ok");
  }
});

test("the classifier returns a word from the closed vocabulary and never the text", () => {
  // The privacy property, asserted rather than trusted: whatever goes in, what
  // comes out is one of seven known words. A classifier that passed any part of
  // its input through would put a filesystem path or a credential fragment into
  // `runtime_health.code`, which is granted to the console role and kept for
  // days.
  const secret = "/Users/someone/.claude/oauth-tokens.json contains sk-ant-oat01-NOTREAL";
  const code = classifyCliFailure({ exitCode: 1, text: secret });
  assert.ok(
    (CLI_CODES as readonly string[]).includes(code),
    "the classifier returned something outside the closed vocabulary"
  );
  assert.equal(code, "call_failed");
});

/* --------------------------------------------------- the probe's answer */

test("the probe asks what the runbook asks", () => {
  // deploy/TAKEOVER.md §5 step 3 is `claude -p "reply with exactly: OK"`. A
  // probe that asked something else would be testing a different thing from
  // the one an operator reaches for.
  assert.equal(PROBE_PROMPT, "reply with exactly: OK");
});

test("the answer check is loose about punctuation and strict about everything else", () => {
  for (const good of ["OK", "ok", " OK ", "OK.", "Ok!", "OK\n"]) {
    assert.equal(isProbeAnswer(good), true, JSON.stringify(good));
  }
  for (const bad of [
    "",
    null,
    undefined,
    "OKAY",
    "Sure! OK",
    "I cannot do that",
    "Failed to authenticate",
  ]) {
    assert.equal(isProbeAnswer(bad), false, JSON.stringify(bad));
  }
});

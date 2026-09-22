/**
 * Where the `claude` CLI is, how the product starts it, and what its failures
 * are called.
 *
 * **Pure. No `node:child_process`, no database, no Next, no environment module.**
 * It reads `process.env` and returns values; it never spawns anything. That is
 * what lets `claude-cli.test.mts` exercise the classifier under `node --test`,
 * and it is why the probe, three product routes and a scan test can all import
 * it without dragging a runtime behind them.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS AT ALL (the incident of 2026-09-22)
 * ---------------------------------------------------------------------------
 * The tutor runs on Samuel's Claude **subscription** through the bundled CLI,
 * not on an API key. On the live box that sign-in silently expired, and it was
 * found only because somebody ran the CLI by hand after the container had been
 * up seven weeks. For an unknown part of that, the product signed students in,
 * showed them their lessons and their progress, and failed every single tutor
 * turn.
 *
 * The console now carries a probe that answers "can the tutor teach right now"
 * (`app/scripts/probe-runtime.mts`). A probe is only worth running if it
 * authenticates **exactly** as the product does: a probe that resolved a
 * different binary, or built a different `PATH`, or pointed at a different
 * config directory, would be a green light about a program no student ever
 * talks to. So the seam is here, in one module, and the three places that
 * spawn the CLI for real — `api/ask/route.ts`, `api/understanding/route.ts`
 * and `lib/uploads.ts` — take their binary name and their environment from the
 * same two functions the probe does.
 *
 * `claude-cli-seam.test.mts` is what keeps that true: it reads those four files
 * and fails if any of them builds its own `PATH` string again. A comment asking
 * people to use this module would have lasted until the next hurry.
 *
 * ---------------------------------------------------------------------------
 * THE CREDENTIAL IS NOT HERE, AND MUST NEVER BE
 * ---------------------------------------------------------------------------
 * Nothing in this file reads, holds, copies or logs a credential. The CLI finds
 * its own sign-in through `CLAUDE_CONFIG_DIR` (set in `deploy/Dockerfile` to a
 * Docker volume, so one interactive login covers both containers and survives
 * every rebuild) or, on a laptop, through the developer's `~/.claude`. We
 * inherit that environment and otherwise stay out of it.
 *
 * The one consequence worth knowing: **`CLAUDE_CONFIG_DIR` is how a failure can
 * be rehearsed without logging anybody out.** Point it at an empty directory
 * and the CLI behaves exactly as the box did — it runs and refuses for want of
 * a credential — while the real sign-in in `~/.claude` is untouched. That is
 * how `not_signed_in` below was tested, and it is the only honest way to test
 * it.
 */

/* ========================================================== the spawn seam */

/**
 * The binary, by name rather than by path, resolved through `PATH`.
 *
 * Deliberately not an absolute path: the CLI lives at
 * `/usr/local/share/npm-global/bin/claude` in the container image, at
 * `~/.local/bin/claude` on a laptop, and somewhere else again on whatever box
 * comes next. A name plus the `PATH` below is the one form that is true in all
 * three, and it is the form the product has always used.
 */
export const CLAUDE_BIN = "claude";

/**
 * The working directory the CLI is started in.
 *
 * `TMPDIR` (or `/tmp`), because the CLI reads the directory it is started in —
 * project files, a `CLAUDE.md`, a settings file — and the tutor must be
 * grounded in the curriculum we hand it on stdin and in nothing else. Starting
 * it in the repository would silently add this project's own instructions to
 * every child's lesson.
 *
 * `lib/uploads.ts` is the one caller that overrides this, with the upload root,
 * so a relative path in an OCR prompt cannot wander outside it. That is a
 * deliberate exception and it is stated where it happens.
 */
export function claudeCwd(): string {
  return process.env.TMPDIR ?? "/tmp";
}

/**
 * The environment the CLI is started with: everything this process has, plus
 * the one directory an npm global install lands in that a service manager's
 * `PATH` usually lacks.
 *
 * **This is the function that makes the probe meaningful.** Authentication is
 * decided entirely by what is in here — `CLAUDE_CONFIG_DIR`, `HOME`, and
 * whatever the CLI reads out of them — so a probe that built this differently
 * would prove nothing about the product. There is exactly one builder, and
 * every caller passes only the extra variables its own call needs.
 *
 * `extra` is merged last so a caller can set, for example,
 * `MAX_THINKING_TOKENS`. A caller cannot use it to change how the CLI
 * authenticates without that being visible at the call site, which is the
 * point.
 */
export function claudeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${process.env.PATH ?? ""}:${process.env.HOME ?? ""}/.local/bin`,
    ...extra,
  };
}

/* ====================================================== the failure codes */

/**
 * What went wrong, as a short stable word.
 *
 * **These exist because collapsing them is how an operator learns to ignore the
 * tile.** Each one has a different owner and a different next action, and a
 * single "the tutor is down" would send somebody to the wrong one:
 *
 *   ok             the CLI ran and answered what it was asked. Nothing to do.
 *   cli_missing    no `claude` on the PATH the product uses. The image is
 *                  wrong or an install failed — a DEPLOY fault, not a
 *                  credential one, and re-running the login would not touch it.
 *   not_signed_in  the CLI ran and refused for want of a credential. **This is
 *                  the incident of 2026-09-22.** Only Samuel can fix it, from a
 *                  TTY; `deploy/TAKEOVER.md` §5 is the procedure.
 *   call_failed    signed in, and the call itself failed — rate limit, network,
 *                  model error. Usually transient and usually nobody's job:
 *                  this is exactly the code that must NOT raise an alarm on its
 *                  own, which is why the alert rule counts consecutive
 *                  failures rather than firing on one.
 *   timed_out      our own deadline killed it. Says nothing about the sign-in;
 *                  a hung CLI and a slow one look identical from here.
 *   bad_output     it answered, and not with what was asked. The runtime works
 *                  and something about the call does not — worth a distinct
 *                  word precisely because it is the one failure where the
 *                  credential is fine.
 *   spawn_failed   the process could not be started, for a reason that is not
 *                  "the binary is absent". Permissions, a broken interpreter, a
 *                  full disk. Rare, and rare is exactly when a generic bucket
 *                  is most expensive.
 *
 * **They are stable words, and that is a contract.** They are stored in
 * `runtime_health.code`, they key the tile's copy and they appear in alert
 * mail. Renaming one rewrites history that is already on disk; add a new one
 * instead.
 */
export const CLI_CODES = [
  "ok",
  "cli_missing",
  "not_signed_in",
  "call_failed",
  "timed_out",
  "bad_output",
  "spawn_failed",
] as const;

export type CliCode = (typeof CLI_CODES)[number];

/** What a console reader is shown instead of the stored word (FR-2211). */
export const CLI_CODE_LABEL: Readonly<Record<CliCode, string>> = {
  ok: "Answered",
  cli_missing: "The tutor program is not installed",
  not_signed_in: "Signed out, or the sign-in expired",
  call_failed: "Signed in; the call itself failed",
  timed_out: "No answer before the deadline",
  bad_output: "Answered, but not with what was asked",
  spawn_failed: "The program could not be started",
} as const;

/**
 * What to do about it, in one sentence an operator can act on.
 *
 * Kept beside the label rather than in the page, because the page is not the
 * only reader: the alert mail says the same sentence, and two copies of
 * operational advice drift in the direction of the one nobody reads.
 */
export const CLI_CODE_ACTION: Readonly<Record<CliCode, string>> = {
  ok: "Nothing.",
  cli_missing:
    "A deploy fault, not a sign-in one: the image does not carry the tutor program. Re-running the sign-in would change nothing.",
  // Short on purpose. The console's tile prints the full sentence — the
  // terminal, the runbook and the command — on its own line beneath this one,
  // and saying it twice in one tile reads as shouting.
  not_signed_in: "Only Samuel can fix this, and only from a terminal.",
  call_failed:
    "Usually transient — a rate limit, a network hiccup, a model error. Worth watching, not worth waking anybody for.",
  timed_out:
    "The program did not answer in time. Says nothing about the sign-in; look at load on the box first.",
  bad_output:
    "The runtime is fine and the answer was not. This is a product question rather than an operations one.",
  spawn_failed:
    "The program is there and would not start: permissions, disk, or the container's user. Look at the box.",
} as const;

/**
 * Whether a code means the tutor cannot teach right now.
 *
 * `bad_output` counts as a failure deliberately: a runtime that cannot return
 * the simplest possible answer is not a runtime anybody should assume is
 * teaching a child correctly, even though the credential behind it is fine.
 * The code is still distinct, so the tile can say which of the two it is.
 */
export function isCliFailure(code: CliCode): boolean {
  return code !== "ok";
}

/**
 * Substrings that mean "this process has no usable credential", matched
 * case-insensitively.
 *
 * Read from the message the box actually produced — `Failed to authenticate:
 * OAuth session expired and could not be refreshed` — plus the neighbouring
 * wordings the CLI and the API use for the same condition. A list of
 * substrings is crude and is chosen over a regular expression on purpose: the
 * cost of a miss is one incident filed under `call_failed` instead of
 * `not_signed_in`, and both are failures, both are on the tile, and both raise
 * the same alert. The cost of a clever pattern is somebody spending an evening
 * on it.
 *
 * `invalid api key` is here although this build has no API key: if an
 * `ANTHROPIC_API_KEY` is ever set as a workaround (TAKEOVER §5 argues against
 * it), a bad one is the same operator problem wearing different words.
 *
 * Two candidates were **left out for being too loose**, and the omissions are
 * worth as much as the entries: a bare `401` matches a token count and a file
 * path, and a bare `sign in` matches half the product's own copy. A signature
 * that fires on ordinary output would file transient failures as credential
 * failures and send somebody to a TTY at 3am for a rate limit.
 */
const AUTH_SIGNATURES = [
  "failed to authenticate",
  "oauth session expired",
  "oauth token",
  "authentication_error",
  "invalid api key",
  "invalid bearer token",
  "unauthorized",
  "/login",
  "claude login",
  "not logged in",
  "no credentials",
  "credentials not found",
  "session expired",
  "log in to",
] as const;

/**
 * What the classifier is given. Every field is optional because the three
 * callers know different amounts: a spawn that never started has no exit code,
 * and a call that returned JSON has a `result` string as well as stderr.
 */
export type CliFailureInput = {
  /** The `Error` from `child.on("error")`, if the process never started. */
  spawnError?: { code?: string; message?: string } | null;
  /** Our own deadline fired and we killed it. Beats every other signal. */
  timedOut?: boolean;
  /** The process exit code, or null when it died on a signal. */
  exitCode?: number | null;
  /**
   * Anything the CLI said about the failure — stderr, and the `result` string
   * from `--output-format json` when there is one.
   *
   * **Read here and nowhere else.** It is matched against the signatures above
   * and then dropped on the floor: it is never returned, never stored in
   * `runtime_health`, never put in alert mail and never written to a log by
   * anything that calls this. Diagnostic output from a CLI can carry a
   * filesystem path, a home directory, a project name or a fragment of a
   * token, and a health table is read by more people and kept longer than a
   * log is.
   */
  text?: string | null;
};

/**
 * Turn a failed CLI invocation into one of the codes above.
 *
 * The order is the whole design, because several signals are usually present
 * at once and only one of them is the operator's actual problem:
 *
 *  1. **Our own timeout first.** If we killed it, the exit code and whatever
 *     it had managed to print are artefacts of the kill, not evidence.
 *  2. **Then a spawn error**, because a process that never started cannot have
 *     an opinion about credentials. `ENOENT` is the binary being absent;
 *     anything else is `spawn_failed`.
 *  3. **Then exit 127**, the shell's own "command not found", which is what a
 *     `PATH` problem looks like when something between us and the binary used
 *     a shell.
 *  4. **Then the credential signatures**, because an authentication refusal
 *     also produces a non-zero exit, and the exit code alone would file the
 *     incident of 2026-09-22 under `call_failed` — which is a shrug where a
 *     name was needed.
 *  5. **Then everything else is `call_failed`**: it started, it had a
 *     credential as far as we can tell, and it did not work.
 */
export function classifyCliFailure(input: CliFailureInput): CliCode {
  if (input.timedOut) return "timed_out";

  if (input.spawnError) {
    return input.spawnError.code === "ENOENT" ? "cli_missing" : "spawn_failed";
  }

  if (input.exitCode === 127) return "cli_missing";

  const text = (input.text ?? "").toLowerCase();
  if (text.length > 0 && AUTH_SIGNATURES.some((sig) => text.includes(sig))) {
    return "not_signed_in";
  }

  return "call_failed";
}

/* ============================================================== the probe */

/**
 * What the probe asks, and what counts as the right answer.
 *
 * Both live here rather than in the script because the product's own
 * `TAKEOVER.md` §5 step 3 is the same sentence — `claude -p "reply with
 * exactly: OK"` — and a probe that asked something else would be testing a
 * different thing from the one in the runbook the operator will reach for.
 *
 * The check is deliberately loose about punctuation and case and strict about
 * everything else. A model that answers `OK.` has done what was asked; one
 * that answers `Sure! OK` has not been obedient but has plainly reached a
 * model, and both of those are worlds away from `Failed to authenticate`. The
 * cost of the looseness is that `bad_output` is rare; the cost of being strict
 * would be a tile that cries wolf about a full stop.
 */
export const PROBE_PROMPT = "reply with exactly: OK";

export function isProbeAnswer(text: string | null | undefined): boolean {
  const cleaned = (text ?? "")
    .trim()
    .replace(/[.!\s]+$/u, "")
    .toLowerCase();
  return cleaned === "ok";
}

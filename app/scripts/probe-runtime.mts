/**
 * The runtime probe — can the tutor teach right now? (FR-3001…FR-3005,
 * migration 026, `lib/runtime-health.ts`, `lib/claude-cli.ts`.)
 *
 * ---------------------------------------------------------------------------
 * FOR WHOEVER RUNS THIS
 * ---------------------------------------------------------------------------
 *   npm run probe:runtime           # call the CLI, store the reading, trim
 *   npm run probe:runtime -- --dry  # call the CLI and print; store nothing
 *
 * That `npm run` target is:
 *
 *   node --import ./scripts/load-env.mjs --import ./scripts/ts-resolver.mjs scripts/probe-runtime.mts
 *
 * — a plain `node scripts/probe-runtime.mts` will NOT see `DATABASE_URL_MAINT`:
 * only `next dev`/`next build` load `app/.env.local` automatically, and
 * `withMaint()` (lib/db.ts) fails closed without it. `load-env.mjs` fills that
 * in for a standalone run and never overrides a variable already exported, so
 * cron, CI and `scripts/local-dev.sh`'s own inline exports all still win.
 *
 * **ON A BOX THIS IS A CRON JOB, EVERY FIFTEEN MINUTES.** The crontab line,
 * with the minutes spelled out rather than as a step expression — a step
 * expression contains the two characters that would end this comment block,
 * and a runbook line nobody can paste is worse than a long one:
 *
 *   0,15,30,45 * * * *  cd /opt/reletix/AI.NEXT/app && npm run probe:runtime >> /var/log/noor-probe.log 2>&1
 *
 * Fifteen minutes rather than five: unlike the alert sweep, **every run of this
 * costs a real model call** on Samuel's subscription. Fifteen minutes is 96
 * calls a day of a dozen tokens each — a rounding error against one lesson —
 * while a five-minute probe would be 288 and a one-minute one 1,440. The
 * argument for the number, and for the 45-minute staleness threshold that
 * follows from it, is in `lib/runtime-health.ts` beside the constants.
 *
 * **The probe's own spend is deliberately NOT in the cost ledger.** `cost_daily`
 * and `ai_interactions` are per-STUDENT accounting (FR-2401, FR-2402) and a
 * probe has no student; writing it there would put a founder's monitoring into
 * a child's cost line, which is exactly the blending `surface_kind` exists to
 * prevent. The bound is stated instead: 96 calls a day, each one twelve tokens
 * of prompt and two of answer.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS — the incident of 2026-09-22
 * ---------------------------------------------------------------------------
 * The tutor runs on Samuel's Claude **subscription** through the bundled
 * `claude` CLI. On the live box that sign-in silently expired, and it was found
 * only because somebody ran the CLI by hand after the container had been up
 * seven weeks. For an unknown part of that, `ainext.reletix.com` signed a
 * student in, showed her lessons and progress, and failed every single tutor
 * turn. Nothing in the product detected it.
 *
 * The passive half of the answer already existed: `ai_interactions.outcome`
 * records what real turns did, and the console now reads it. But it needs
 * traffic — a quiet night looks identical to a healthy one — so this is the
 * active half: a tiny scheduled call whose result is stored, which catches a
 * lapse at 3am with nobody online.
 *
 * ---------------------------------------------------------------------------
 * IT SPAWNS THE CLI THE SAME WAY THE PRODUCT DOES, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * A probe that authenticated differently from the product would be a green
 * light about a program no student ever talks to. So the binary name, the
 * working directory and — above all — the environment come from
 * `lib/claude-cli.ts`, the same two functions `api/ask/route.ts`,
 * `api/understanding/route.ts` and `lib/uploads.ts` call. Authentication is
 * decided entirely by what is in that environment (`CLAUDE_CONFIG_DIR`, `HOME`
 * and what the CLI reads out of them), and there is exactly one builder of it.
 * `lib/claude-cli-seam.test.mts` fails the build if any of the four files
 * starts constructing its own `PATH` again.
 *
 * The flags mirror `/api/understanding` rather than `/api/ask`: `--output-format
 * json`, `--disallowedTools "*"`, `--max-turns 1`, the same model. That route is
 * the product's non-streaming call, which is the shape a probe wants — one
 * request, one JSON object, an `is_error` flag and a `result` string. Streaming
 * would add parsing that could fail for reasons that have nothing to do with
 * the credential.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT NEVER DOES
 * ---------------------------------------------------------------------------
 *  · **It never runs from a request handler.** The console READS the stored
 *    reading; it does not spawn anything. A page load that called the CLI would
 *    bill a founder for curiosity and would turn one hung CLI into a hung
 *    console — on the page an operator opens precisely when things are wrong.
 *  · **It never stores or logs the CLI's own words.** stderr and the `result`
 *    string are read in memory by `classifyCliFailure`, which returns one of
 *    seven stable codes, and then they are dropped. CLI diagnostics carry
 *    filesystem paths, home directories and — on an authentication failure —
 *    fragments of the thing that failed to authenticate. See migration 026's
 *    header for why a health table is a worse place for that than a log.
 *  · **It never hangs.** A hard timeout kills the child, so a wedged CLI cannot
 *    wedge the schedule. The timeout is a FAILURE with its own code, not a
 *    skipped run: a probe that quietly did not report would make the tile stale
 *    without saying why.
 *
 * ---------------------------------------------------------------------------
 * REHEARSING A FAILURE WITHOUT LOGGING ANYBODY OUT
 * ---------------------------------------------------------------------------
 * Both failure paths can be exercised on a laptop without touching a sign-in,
 * which matters because "test the alarm" must not mean "break the product":
 *
 *   # `not_signed_in` — the incident itself. An empty config directory makes
 *   # the CLI run and refuse for want of a credential; ~/.claude is untouched.
 *   mkdir -p /tmp/no-claude-config
 *   CLAUDE_CONFIG_DIR=/tmp/no-claude-config npm run probe:runtime -- --dry
 *
 *   # `cli_missing` — a deploy fault. Hide both places `claudeEnv()` looks.
 *   env PATH=/usr/bin HOME=/tmp/nowhere npm run probe:runtime -- --dry
 *
 * `--dry` on both, so a rehearsal does not write a failure into the record and
 * start a clock on "failing since".
 */

import { spawn } from "node:child_process";

import { withMaint } from "../src/lib/db.ts";
import { ENVIRONMENT } from "../src/lib/env.ts";
import {
  CLAUDE_BIN,
  CLI_CODE_ACTION,
  CLI_CODE_LABEL,
  PROBE_PROMPT,
  claudeCwd,
  claudeEnv,
  classifyCliFailure,
  isProbeAnswer,
  type CliCode,
} from "../src/lib/claude-cli.ts";
import { PROBE_KEEP_ROWS } from "../src/lib/runtime-health.ts";

/* -------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);

if (has("--help") || has("-h")) {
  console.log(
    [
      "probe-runtime — ask the Claude CLI one tiny question and record whether it answered",
      "",
      "  --dry    call the CLI and print the reading; write no runtime_health row",
      "",
      "Codes: ok | cli_missing | not_signed_in | call_failed | timed_out | bad_output | spawn_failed",
      "The CLI's own output is never printed or stored — only the code.",
    ].join("\n")
  );
  process.exit(0);
}

const DRY = has("--dry");

/** The probe's name in `runtime_health.probe`. One probe today; the column
 *  exists so the second one needs no migration. */
const PROBE = "claude_cli";

/**
 * The same model the three product surfaces call.
 *
 * A probe on a cheaper model would answer a question nobody asked: "is some
 * model reachable" is not "can the tutor teach", and the two differ exactly
 * when a model is deprecated or an entitlement changes — which is a failure
 * mode worth catching rather than designing around.
 */
const MODEL = "claude-sonnet-5";

/**
 * The hard deadline. Thirty seconds.
 *
 * `/api/ask` allows ninety because a student is waiting for a whole
 * explanation; this asks for two characters. Thirty seconds is generous enough
 * that a loaded box is not reported as broken, and short enough that four
 * probes an hour can never pile up on each other.
 */
const TIMEOUT_MS = 30_000;

/* ------------------------------------------------------------- the call */

type Reading = { ok: boolean; code: CliCode; durationMs: number | null };

/**
 * One call, and the four things it can turn into.
 *
 * Every path resolves — nothing here rejects — because a probe that threw
 * would leave no row, and a missing row is indistinguishable from a probe that
 * was never scheduled. The whole feature rests on the difference between those
 * two, so this function has no failure mode that produces silence.
 */
function probe(): Promise<Reading> {
  return new Promise((resolve) => {
    const started = Date.now();

    const child = spawn(
      CLAUDE_BIN,
      [
        "-p",
        "--output-format",
        "json",
        "--model",
        MODEL,
        "--disallowedTools",
        "*",
        "--max-turns",
        "1",
      ],
      {
        cwd: claudeCwd(),
        env: claudeEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let out = "";
    // Held in memory, matched, and never printed or stored. `classifyCliFailure`
    // is the only reader and it returns a word, not this string.
    let errText = "";
    let settled = false;
    let timedOut = false;

    const finish = (reading: Reading) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(reading);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    // A process that never started has no exit code and no output, so this
    // path cannot wait for `close` — on some failures `close` never comes.
    child.on("error", (err: NodeJS.ErrnoException) => {
      finish({
        ok: false,
        code: classifyCliFailure({ spawnError: { code: err.code, message: err.message } }),
        durationMs: Date.now() - started,
      });
    });

    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      // Bounded: a CLI that decides to print a megabyte of diagnostics must not
      // grow this process's memory. The signatures we match are short.
      errText = (errText + chunk.toString("utf8")).slice(-4000);
    });

    child.on("close", (exitCode) => {
      const durationMs = Date.now() - started;

      // Our own kill beats everything else it may have managed to print.
      if (timedOut) {
        finish({ ok: false, code: "timed_out", durationMs });
        return;
      }

      // `--output-format json` gives one object: `{ is_error, result, … }`.
      // Unparseable output is not treated as a parse bug — on a failed
      // invocation the CLI prints plain text, and that text is exactly what
      // the classifier wants to look at.
      let parsed: { is_error?: boolean; result?: string } | null = null;
      try {
        parsed = JSON.parse(out) as { is_error?: boolean; result?: string };
      } catch {
        parsed = null;
      }

      const failed = exitCode !== 0 || parsed === null || parsed.is_error === true;
      if (failed) {
        finish({
          ok: false,
          code: classifyCliFailure({
            exitCode,
            // Both channels, because an authentication refusal reaches us on
            // stderr from the CLI and inside `result` from the API — and the
            // incident of 2026-09-22 is the case that must never be filed as a
            // generic `call_failed`.
            text: `${errText}\n${parsed?.result ?? out}`,
          }),
          durationMs,
        });
        return;
      }

      // `parsed` is non-null here: `failed` above covers `parsed === null`.
      if (!isProbeAnswer(parsed?.result)) {
        finish({ ok: false, code: "bad_output", durationMs });
        return;
      }

      finish({ ok: true, code: "ok", durationMs });
    });

    child.stdin.end(PROBE_PROMPT);
  });
}

/* ------------------------------------------------------------- the write */

/**
 * Record the reading and bound the history, in ONE transaction.
 *
 * The trim is a `DELETE … WHERE id NOT IN (the newest N)` rather than a
 * time-based cutoff, so the history's length does not change when the cron
 * cadence does — somebody who moves the probe to five minutes gets a shorter
 * window of the same 300 readings, not a table that silently grows threefold.
 *
 * Scoped to (environment, probe): a second probe must not push the first one's
 * history out, and one environment must never trim the other's
 * (constitution XI).
 */
async function record(reading: Reading): Promise<number> {
  return withMaint(async (db) => {
    await db.query("BEGIN");
    try {
      await db.query(
        `INSERT INTO runtime_health (environment, probe, ok, code, duration_ms)
         VALUES ($1, $2, $3, $4, $5)`,
        [ENVIRONMENT, PROBE, reading.ok, reading.code, reading.durationMs]
      );
      const trimmed = await db.query(
        `DELETE FROM runtime_health
           WHERE environment = $1 AND probe = $2
             AND id NOT IN (
               SELECT id FROM runtime_health
                WHERE environment = $1 AND probe = $2
                ORDER BY checked_at DESC, id DESC
                LIMIT $3
             )`,
        [ENVIRONMENT, PROBE, PROBE_KEEP_ROWS]
      );
      await db.query("COMMIT");
      return trimmed.rowCount ?? 0;
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }
  });
}

/* ------------------------------------------------------------------- run */

const reading = await probe();

const line =
  `[probe] ${ENVIRONMENT}/${PROBE}: ${reading.ok ? "PASS" : "FAIL"} ` +
  `code=${reading.code} ${reading.durationMs ?? "?"}ms — ${CLI_CODE_LABEL[reading.code]}`;

console.log(line);
if (!reading.ok) console.log(`          ${CLI_CODE_ACTION[reading.code]}`);

if (DRY) {
  console.log("          (dry run — nothing written)");
  process.exit(0);
}

const trimmed = await record(reading);
console.log(
  `[probe] recorded${trimmed > 0 ? `, ${trimmed} old reading(s) trimmed to the last ${PROBE_KEEP_ROWS}` : ""}`
);

// A failing probe is not a failing SCRIPT. It did its job: it found out, and it
// wrote down what it found. Exiting non-zero would make cron mail a second,
// worse copy of the same news with none of the context, and would make a CI
// step that ran this red for a reason that is not about the code.
process.exit(0);

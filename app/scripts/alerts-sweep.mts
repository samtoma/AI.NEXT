/**
 * The security alert sweep (contracts/admin.md §7, research A5, ADR-0016 §6,
 * FR-2502, FR-3009).
 *
 * ---------------------------------------------------------------------------
 * FOR WHOEVER RUNS THIS
 * ---------------------------------------------------------------------------
 *   npm run alerts:sweep            # evaluate the six rules, deliver what fired
 *   npm run alerts:sweep -- --dry   # evaluate and print; claim nothing, mail nothing
 *
 * That `npm run` target is:
 *
 *   node --import ./scripts/load-env.mjs --import ./scripts/ts-resolver.mjs scripts/alerts-sweep.mts
 *
 * — a plain `node scripts/alerts-sweep.mts` will NOT see `DATABASE_URL_MAINT`:
 * only `next dev`/`next build` load `app/.env.local` automatically, and
 * `withMaint()` (lib/db.ts) fails closed without it. `load-env.mjs` fills that
 * in for a standalone run and never overrides a variable already exported, so
 * cron, CI and `scripts/local-dev.sh`'s own inline exports all still win.
 *
 * **ON A BOX THIS IS A CRON JOB, EVERY FIVE MINUTES.** The crontab line, with
 * the minutes spelled out rather than as a step expression — a step expression
 * contains the two characters that would end this comment block, and a runbook
 * line nobody can paste is worse than a long one:
 *
 *   0,5,10,15,20,25,30,35,40,45,50,55 * * * *  cd /opt/reletix/AI.NEXT/app && npm run alerts:sweep >> /var/log/noor-alerts.log 2>&1
 *
 * Five minutes rather than one: SC-105 requires an ATTEMPT to be visible in the
 * console's Security view within 60 seconds, and that is satisfied by the view
 * being un-cached and reading `auth_events` live — it does not depend on this
 * script at all. What this adds is the push half, and a five-minute push is
 * fast enough for the one rule that matters at zero and calm enough for the
 * four that count bursts.
 *
 * `scripts/local-dev.sh` invokes it once at the end of setup, which is how a
 * fresh laptop proves the sweep runs at all rather than discovering on the box
 * that it never did.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENT, AND HOW
 * ---------------------------------------------------------------------------
 * Safe to run at any time, any number of times. Every rule fires against a
 * `(rule, key, window_start)` bucket, and the row is CLAIMED with
 * `INSERT … ON CONFLICT DO NOTHING RETURNING` before anything is delivered —
 * one atomic statement, so two overlapping sweeps cannot both mail the same
 * alert. A second run over the same history claims nothing and sends nothing,
 * which is what "the sweep is quiet" is supposed to mean.
 *
 * The claim happens BEFORE the send, deliberately. The failure modes are not
 * symmetric: claiming first and failing to send loses one alert that the next
 * genuine occurrence will raise again, while sending first and failing to claim
 * mails the same thing every five minutes forever, which is how a mailbox
 * learns to ignore the one rule that sits at zero.
 *
 * ---------------------------------------------------------------------------
 * `ainext_maint`, NOT THE CONSOLE'S ROLE
 * ---------------------------------------------------------------------------
 * `alerts_sent` is maintenance-owned (migration 022): `ainext_operator` holds
 * SELECT so the console can say when a rule last fired, and no UPDATE or DELETE,
 * because an alert log the alerted party can rewrite is not a log. A sweep is a
 * script, and `withMaint` is the seam scripts use.
 */

import { withMaint } from "../src/lib/db.ts";
import { ENVIRONMENT, ALERT_EMAIL } from "../src/lib/env.ts";
import { sendMail } from "../src/lib/mail.ts";
import {
  LOOKBACK_MS,
  alertMail,
  evaluate,
  type Alert,
  type AlertEventRow,
} from "../src/lib/alerts.ts";
import type { ProbeRow } from "../src/lib/runtime-health.ts";

/* -------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);

if (has("--help") || has("-h")) {
  console.log(
    [
      "alerts-sweep — evaluate five rules over auth_events and one over runtime_health",
      "",
      "  --dry    evaluate and print; claim no alerts_sent row and send no mail",
      "",
      "Idempotent: a rule fires once per (rule, key, window). Re-running is quiet.",
      "With AINEXT_ALERT_EMAIL unset the sweep logs its alerts instead of mailing.",
    ].join("\n")
  );
  process.exit(0);
}

const DRY = has("--dry");

/* ------------------------------------------------------------------- read */

const nowMs = Date.now();
const since = new Date(nowMs - LOOKBACK_MS).toISOString();

/**
 * Only the events the five rules read, and only the columns they read.
 *
 * `environment` first in the predicate (constitution XI, FR-2509): an alert
 * that pooled the frozen baseline's failures with the comparison build's would
 * be a number about neither stack.
 */
const EVENTS = [
  "failed_login",
  "permission_denied",
  "cross_student_access_denied",
  "suspicious_activity",
] as const;

const rows: AlertEventRow[] = await withMaint(async (db) => {
  const res = await db.query<{
    id: string;
    event: string;
    actor_kind: string | null;
    actor_id: string | null;
    ip_address: string | null;
    reason: string | null;
    occurred_at: Date;
  }>(
    `SELECT id, event, actor_kind, actor_id, host(ip_address) AS ip_address, reason, occurred_at
       FROM auth_events
      WHERE environment = $1
        AND event = ANY($2::text[])
        AND occurred_at >= $3
      ORDER BY occurred_at`,
    [ENVIRONMENT, [...EVENTS], since]
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    event: r.event,
    actorKind: r.actor_kind,
    actorId: r.actor_id === null ? null : Number(r.actor_id),
    ip: r.ip_address,
    reason: r.reason,
    occurredAt: r.occurred_at.toISOString(),
  }));
});

/* -------------------------------------------------- the runtime readings */

/**
 * The sixth rule's input: what the runtime probe
 * (`app/scripts/probe-runtime.mts`) has stored lately.
 *
 * **This sweep does not spawn the CLI and must never start to.** It runs every
 * five minutes; the probe runs every fifteen, because each probe run costs a
 * real model call. The two schedules are separate on purpose — one is free and
 * frequent, one is cheap and paced — and collapsing them would triple the
 * probe's cost to make one file shorter.
 *
 * Forty rows is comfortably more than `PROBE_FAILURE_RUN` needs, so a run of
 * failures can be counted back to its start even after a long outage, and it is
 * one index scan. Environment-scoped like everything else here: a probe result
 * from the other stack says nothing about this one (constitution XI, FR-2509).
 *
 * A missing table is treated as "no readings" rather than as a crash. A box
 * running the pre-026 database with a post-026 application would otherwise
 * lose the FIVE working rules to the sixth one's missing input, which is the
 * wrong trade in every direction: the security mail matters more than the
 * health mail, and an operator whose alerts went quiet during a migration would
 * have no way to know.
 */
const probes: ProbeRow[] = await withMaint(async (db) => {
  try {
    const res = await db.query<{
      probe: string;
      ok: boolean;
      code: string;
      duration_ms: number | null;
      checked_at: Date;
    }>(
      `SELECT probe, ok, code, duration_ms, checked_at
         FROM runtime_health
        WHERE environment = $1
        ORDER BY checked_at DESC
        LIMIT 40`,
      [ENVIRONMENT]
    );
    return res.rows.map((r) => ({
      probe: r.probe,
      ok: r.ok,
      code: r.code,
      durationMs: r.duration_ms,
      checkedAt: r.checked_at.toISOString(),
    }));
  } catch (e) {
    console.warn(
      `[alerts] runtime_health is unreadable (${(e as Error).message.slice(0, 80)}) — ` +
        `the tutor-unreachable rule is skipped; the other five are unaffected`
    );
    return [];
  }
});

/* --------------------------------------------------------------- evaluate */

const alerts = evaluate(rows, nowMs, probes);

console.log(
  `[alerts] ${ENVIRONMENT}: ${rows.length} event(s) since ${since}, ` +
    `${probes.length} probe reading(s), ` +
    `${alerts.length} rule firing(s)${DRY ? " (dry run)" : ""}`
);

if (DRY) {
  for (const a of alerts) {
    console.log(`  would fire  ${a.rule}  key=${a.key}  window=${a.windowStart}  ${a.summary}`);
  }
  process.exit(0);
}

/* ------------------------------------------------------------ claim + send */

/**
 * Claim the bucket. Returns true when THIS run won it — false means another
 * sweep, or an earlier run of this one, already delivered for this window.
 */
async function claim(alert: Alert, delivered: "email" | "logged"): Promise<boolean> {
  return withMaint(async (db) => {
    const res = await db.query(
      `INSERT INTO alerts_sent (rule, key, window_start, environment, detail, delivered)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (rule, key, window_start) DO NOTHING
       RETURNING rule`,
      [
        alert.rule,
        alert.key,
        alert.windowStart,
        ENVIRONMENT,
        JSON.stringify(alert.detail),
        delivered,
      ]
    );
    return res.rowCount === 1;
  });
}

let sent = 0;
let logged = 0;
let quiet = 0;

for (const alert of alerts) {
  // A rule that never mails is recorded as 'logged' whatever the configuration
  // says; a rule that mails is recorded as 'logged' when there is nowhere to
  // send it. Both are the same word because both mean "the rule fired and no
  // message left the box", which is the fact a reader of this table wants.
  const willMail = alert.delivery === "email" && ALERT_EMAIL !== null;
  const won = await claim(alert, willMail ? "email" : "logged");
  if (!won) {
    quiet += 1;
    continue;
  }

  const { subject, text } = alertMail(alert, ENVIRONMENT);
  if (willMail) {
    // `sendMail` never throws — a delivery failure logs and moves on, so a
    // broken SMTP host cannot take the sweep down and leave the next rule
    // unevaluated.
    await sendMail({ to: ALERT_EMAIL!, subject, text });
    sent += 1;
    console.log(`  mailed      ${alert.rule}  key=${alert.key}  -> ${ALERT_EMAIL}`);
  } else {
    logged += 1;
    const why =
      alert.delivery === "log"
        ? "shadow rule — never mails"
        : "AINEXT_ALERT_EMAIL is unset";
    console.log(`  ALERT       ${subject}  (${why})`);
    console.log(text.replace(/^/gm, "              "));
  }
}

console.log(
  `[alerts] done: ${sent} mailed, ${logged} logged, ${quiet} already sent for their window`
);

process.exit(0);

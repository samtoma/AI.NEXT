/**
 * The five security alert rules (contracts/admin.md §7, research A5, ADR-0016
 * §6, FR-2502).
 *
 * **This module is pure.** No pool, no `withMaint`, no mail, no clock of its
 * own — every function below takes the rows and the "now" it is reasoning about
 * and returns the alerts that follow. The sweep
 * (`app/scripts/alerts-sweep.mts`) is the impure half: it reads, calls these,
 * claims the `alerts_sent` rows and delivers. That split is what lets
 * `alerts.test.mts` assert the arithmetic and the once-per-window behaviour
 * under `node --test` with no database at all.
 *
 * ---------------------------------------------------------------------------
 * THE THRESHOLDS ARE DELIBERATELY CRUDE, AND THAT IS THE DESIGN
 * ---------------------------------------------------------------------------
 * At ~200 students the base rate of a real attack is low, and research A5's
 * argument is that a noisy alert means every alert gets ignored. So the rules
 * sit where a human would want to look and nowhere finer. Two of them only
 * REPORT — the lock and the IP throttle are already enforced by the auth path
 * (`lib/auth/throttle.ts`), so the rule's job is to tell somebody it happened,
 * not to happen. One runs in shadow and never mails at all.
 *
 * ---------------------------------------------------------------------------
 * ONE RULE SITS AT ZERO, AND IT IS THE POINT
 * ---------------------------------------------------------------------------
 * `cross_student_access_denied` should be structurally impossible under ADR-0012:
 * the database returns nothing rather than another student's rows, so the event
 * only exists when an application bug asked for something RLS refused, or when
 * somebody tried. Any occurrence mails immediately, and the running absence of
 * these mails is the standing proof that the policies work.
 */

/* ------------------------------------------------------------------ inputs */

/** One `auth_events` row, narrowed to what the rules read. */
export type AlertEventRow = {
  id: number;
  event: string;
  /** 'account' | 'operator' | 'anonymous' | null */
  actorKind: string | null;
  actorId: number | null;
  ip: string | null;
  reason: string | null;
  /** ISO-8601, UTC. */
  occurredAt: string;
};

export type AlertSeverity = "notice" | "urgent";

/** How an alert is delivered, decided by the rule rather than by the sweep. */
export type AlertDelivery = "email" | "log";

export type AlertRuleId =
  | "account_lock_burst"
  | "ip_failure_burst"
  | "operator_permission_denied"
  | "cross_student_access_denied"
  | "impossible_travel_shadow";

export type Alert = {
  rule: AlertRuleId;
  /** What the alert is ABOUT: an account id, an IP, an operator id, an event id. */
  key: string;
  /** The bucket this firing is recorded against — the idempotency key's third part. */
  windowStart: string;
  severity: AlertSeverity;
  delivery: AlertDelivery;
  /** One line, for a subject line. Never carries a credential or free text. */
  summary: string;
  /** The numbers the alert was built from, stored verbatim in `alerts_sent.detail`. */
  detail: Record<string, string | number>;
};

/* ------------------------------------------------------------- the windows */

export const MINUTE_MS = 60_000;

/** research A5: five failures for one account in fifteen minutes. */
export const LOCK_WINDOW_MS = 15 * MINUTE_MS;
export const LOCK_THRESHOLD = 5;

/** research A5: twenty failures from one IP in fifteen minutes. */
export const IP_WINDOW_MS = 15 * MINUTE_MS;
export const IP_THRESHOLD = 20;

/** research A5: three refusals for one operator in one hour. */
export const OPERATOR_WINDOW_MS = 60 * MINUTE_MS;
export const OPERATOR_THRESHOLD = 3;

/**
 * The zero-threshold rule's window. One hour, so a single attacker retrying in
 * a loop produces one mail an hour rather than one every five minutes — and
 * keyed by the EVENT ID rather than by the actor, so two genuinely different
 * occurrences in the same hour are two alerts. Zero threshold means "any
 * occurrence", not "any sweep that can still see one".
 */
export const CROSS_STUDENT_WINDOW_MS = 60 * MINUTE_MS;

/** The shadow rule never mails, so its window only controls log volume. */
export const SHADOW_WINDOW_MS = 60 * MINUTE_MS;

/**
 * The longest window any rule reads, so the sweep knows how far back to fetch.
 * Derived rather than written down: a rule with a longer window that forgot to
 * update the fetch would silently see a truncated history.
 */
export const LOOKBACK_MS = Math.max(
  LOCK_WINDOW_MS,
  IP_WINDOW_MS,
  OPERATOR_WINDOW_MS,
  CROSS_STUDENT_WINDOW_MS,
  SHADOW_WINDOW_MS
);

/* ------------------------------------------------------------- the bucket */

/**
 * Floor a timestamp to a window boundary, in UTC.
 *
 * This is what makes a rule fire once per window rather than once per sweep:
 * every firing inside the same bucket produces the same `window_start`, which
 * is the third column of `alerts_sent`'s primary key, so the second INSERT
 * conflicts and the sweep stays quiet. A NEW burst crossing into the next
 * bucket gets a new key and alerts again.
 *
 * Epoch-floored rather than now-floored, deliberately: a bucket must not depend
 * on when the sweep happened to run, or two sweeps four minutes apart would
 * compute two different "windows" for the same fifteen minutes of history.
 */
export function windowStart(atMs: number, windowMs: number): string {
  return new Date(Math.floor(atMs / windowMs) * windowMs).toISOString();
}

/* -------------------------------------------------------------- the rules */

type Grouped = Map<string, AlertEventRow[]>;

function groupBy(rows: readonly AlertEventRow[], key: (r: AlertEventRow) => string | null): Grouped {
  const out: Grouped = new Map();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

function within(row: AlertEventRow, nowMs: number, windowMs: number): boolean {
  const t = Date.parse(row.occurredAt);
  return Number.isFinite(t) && t > nowMs - windowMs && t <= nowMs;
}

/**
 * Rule 1 — a burst of failures against ONE account.
 *
 * REPORTS ONLY. `lib/auth/throttle.ts` already locks at the fifth failure and
 * emits `account_locked`; this rule exists so somebody finds out, because a
 * lock nobody hears about is a fourteen-year-old locked out with nobody
 * watching. Counted over `failed_login` rather than over `account_locked` so it
 * still fires on the burst that stopped at four and came back.
 */
export function accountLockBursts(rows: readonly AlertEventRow[], nowMs: number): Alert[] {
  const failures = rows.filter(
    (r) => r.event === "failed_login" && r.actorKind === "account" && within(r, nowMs, LOCK_WINDOW_MS)
  );
  const alerts: Alert[] = [];
  for (const [accountId, group] of groupBy(failures, (r) =>
    r.actorId === null ? null : String(r.actorId)
  )) {
    if (group.length < LOCK_THRESHOLD) continue;
    const newest = Math.max(...group.map((r) => Date.parse(r.occurredAt)));
    alerts.push({
      rule: "account_lock_burst",
      key: accountId,
      windowStart: windowStart(newest, LOCK_WINDOW_MS),
      severity: "notice",
      delivery: "email",
      summary: `${group.length} failed sign-ins for account #${accountId} in 15 minutes`,
      detail: { account_id: Number(accountId), failures: group.length, threshold: LOCK_THRESHOLD },
    });
  }
  return alerts;
}

/**
 * Rule 2 — a burst of failures from ONE source IP.
 *
 * REPORTS ONLY, for the same reason: the throttle already refuses the IP.
 * Talent has no rate limiter and records it as a known gap; we close it and
 * then say so out loud rather than inheriting the silence (research A5).
 */
export function ipFailureBursts(rows: readonly AlertEventRow[], nowMs: number): Alert[] {
  const failures = rows.filter(
    (r) => r.event === "failed_login" && r.ip !== null && within(r, nowMs, IP_WINDOW_MS)
  );
  const alerts: Alert[] = [];
  for (const [ip, group] of groupBy(failures, (r) => r.ip)) {
    if (group.length < IP_THRESHOLD) continue;
    const newest = Math.max(...group.map((r) => Date.parse(r.occurredAt)));
    alerts.push({
      rule: "ip_failure_burst",
      key: ip,
      windowStart: windowStart(newest, IP_WINDOW_MS),
      severity: "notice",
      delivery: "email",
      summary: `${group.length} failed sign-ins from ${ip} in 15 minutes`,
      detail: { ip, failures: group.length, threshold: IP_THRESHOLD },
    });
  }
  return alerts;
}

/**
 * Rule 3 — one operator refused three times in an hour.
 *
 * MAILS. Three refusals is either somebody reaching for a surface they were not
 * granted — which is a conversation, not an incident — or a console bug asking
 * for something nobody may have. Both are worth a mail and neither is worth a
 * page. Anonymous and student refusals are excluded: those are the ordinary
 * traffic of a signed-out browser hitting a console URL.
 */
export function operatorDenials(rows: readonly AlertEventRow[], nowMs: number): Alert[] {
  const denials = rows.filter(
    (r) =>
      r.event === "permission_denied" &&
      r.actorKind === "operator" &&
      within(r, nowMs, OPERATOR_WINDOW_MS)
  );
  const alerts: Alert[] = [];
  for (const [operatorId, group] of groupBy(denials, (r) =>
    r.actorId === null ? null : String(r.actorId)
  )) {
    if (group.length < OPERATOR_THRESHOLD) continue;
    const newest = Math.max(...group.map((r) => Date.parse(r.occurredAt)));
    alerts.push({
      rule: "operator_permission_denied",
      key: operatorId,
      windowStart: windowStart(newest, OPERATOR_WINDOW_MS),
      severity: "notice",
      delivery: "email",
      summary: `operator #${operatorId} was refused ${group.length} times in an hour`,
      detail: {
        operator_id: Number(operatorId),
        denials: group.length,
        threshold: OPERATOR_THRESHOLD,
        // The route each refusal named, deduplicated. An operational code, and
        // the difference between "clicked one forbidden link three times" and
        // "walked the whole nav".
        routes: [...new Set(group.map((r) => r.reason ?? "unknown"))].join(" "),
      },
    });
  }
  return alerts;
}

/**
 * Rule 4 — **any** cross-student access denial. Threshold zero.
 *
 * MAILS IMMEDIATELY, once per event, because each one is a separate fact: under
 * RLS this cannot happen in normal operation, so two occurrences are two bugs
 * or two attempts and collapsing them would lose one. Keyed by event id, which
 * also makes the `alerts_sent` row a permanent pointer back into `auth_events`.
 */
export function crossStudentDenials(rows: readonly AlertEventRow[], nowMs: number): Alert[] {
  return rows
    .filter(
      (r) =>
        r.event === "cross_student_access_denied" && within(r, nowMs, CROSS_STUDENT_WINDOW_MS)
    )
    .map((r) => ({
      rule: "cross_student_access_denied" as const,
      key: String(r.id),
      // The event's OWN time, not the sweep's: re-running the sweep an hour
      // later must not re-alert on the same event under a new bucket.
      windowStart: windowStart(Date.parse(r.occurredAt), CROSS_STUDENT_WINDOW_MS),
      severity: "urgent" as const,
      delivery: "email" as const,
      summary: `cross-student access was denied (auth_events #${r.id}) — this should be impossible`,
      detail: {
        auth_event_id: r.id,
        actor_kind: r.actorKind ?? "unknown",
        actor_id: r.actorId ?? 0,
        reason: r.reason ?? "",
        occurred_at: r.occurredAt,
      },
    }));
}

/**
 * Rule 5 — impossible-travel-lite, **in shadow**.
 *
 * NEVER MAILS. `lib/auth/events.ts` emits `suspicious_activity` for >1000 km/h
 * between successive sign-in geolocations and for refresh-token reuse; research
 * A5 is explicit that for the pilot this logs only — no block, no step-up, no
 * email. With ~200 students in one country behind Egyptian mobile CGNAT the
 * expected signal is carrier NAT and VPNs, and a false lockout of a
 * fourteen-year-old the night before an exam costs more than the attack it
 * prevents. The rule exists so the shadow signal is visible in one place rather
 * than only in a table nobody opens.
 */
export function shadowSuspicion(rows: readonly AlertEventRow[], nowMs: number): Alert[] {
  const hits = rows.filter(
    (r) => r.event === "suspicious_activity" && within(r, nowMs, SHADOW_WINDOW_MS)
  );
  if (hits.length === 0) return [];
  const newest = Math.max(...hits.map((r) => Date.parse(r.occurredAt)));
  return [
    {
      rule: "impossible_travel_shadow",
      key: "shadow",
      windowStart: windowStart(newest, SHADOW_WINDOW_MS),
      severity: "notice",
      delivery: "log",
      summary: `${hits.length} suspicious-activity signal(s) in the last hour — shadow mode, no action taken`,
      detail: { signals: hits.length, mode: "shadow" },
    },
  ];
}

/** Every rule, in the order contracts/admin.md §7 lists the tiles. */
export const RULES = [
  accountLockBursts,
  ipFailureBursts,
  operatorDenials,
  crossStudentDenials,
  shadowSuspicion,
] as const;

/** Evaluate all five. Deterministic order, so a log diff is readable. */
export function evaluate(rows: readonly AlertEventRow[], nowMs: number): Alert[] {
  return RULES.flatMap((rule) => rule(rows, nowMs));
}

/* ------------------------------------------------------------- the message */

/**
 * The alert's body. Plain text, no link, no tracking pixel, no student name.
 *
 * `lib/mail.ts`'s house style: the product sends plain text, in English, with
 * nothing in it that an analytics tool could read. An alert is not an exception
 * to that — it goes to a founder's inbox and it carries counts and ids.
 */
export function alertMail(alert: Alert, environment: string): { subject: string; text: string } {
  const prefix = alert.severity === "urgent" ? "URGENT" : "Noor security";
  return {
    subject: `[${prefix}] ${alert.summary} (${environment})`,
    text: [
      alert.summary,
      "",
      `Rule        ${alert.rule}`,
      `Environment ${environment}`,
      `Window      ${alert.windowStart} (UTC)`,
      "",
      // 16, because `auth_event_id` is 13 characters and a key that ran into
      // its own value is the kind of thing somebody reads at 3am.
      ...Object.entries(alert.detail).map(([k, v]) => `${k.padEnd(16)}${v}`),
      "",
      "This is one firing per window: the sweep will not repeat it for the same",
      "window. The console's Security view has the events behind it.",
      "",
      "— Noor",
    ].join("\n"),
  };
}

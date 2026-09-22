/**
 * "Can the tutor teach right now?" — the arithmetic, and the one judgement it
 * exists to protect.
 *
 * **Pure. No database, no Next, no clock of its own** — every function takes
 * the rows and the `now` it is reasoning about. `lib/alerts.ts`'s split, for
 * the same reason: `runtime-health.test.mts` asserts every threshold and every
 * boundary under `node --test` with nothing running. `lib/security-queries.ts`
 * reads the rows, `app/scripts/probe-runtime.mts` writes them, and this file
 * decides what they mean.
 *
 * ---------------------------------------------------------------------------
 * THE JUDGEMENT: A PROBE THAT HAS NOT RUN RECENTLY IS `unknown`, NOT HEALTHY
 * ---------------------------------------------------------------------------
 * This is the whole reason the module is not three lines. The tempting shape is
 * "read the newest row, show its verdict", and it is wrong in the exact
 * direction that caused the incident this work exists for: a probe that last
 * passed two hours ago and has not been heard from since would paint a green
 * tile over a box whose scheduler died. **Silence is not health.** A stale
 * reading is `unknown`, it is rendered differently from both `ok` and
 * `failing`, and the page says in words that nobody has looked rather than
 * that everything is fine.
 *
 * The second judgement, and it is nearly as important: **when the tutor is
 * down, most of the product is not.** Sign-in, the console, lesson browsing,
 * mastery from stored attempts, analytics and the cost ledger all keep
 * working; only the three CLI-spawning surfaces stop. "The tutor is down"
 * reads as "everything is down" and would cause the wrong response, so the
 * copy that says otherwise lives with the state machine (`STILL_WORKING`
 * below) rather than being retyped in whichever surface renders it next.
 *
 * ---------------------------------------------------------------------------
 * TWO SIGNALS, BECAUSE THEY FAIL DIFFERENTLY
 * ---------------------------------------------------------------------------
 * **PASSIVE — what real turns actually did.** `ai_interactions.outcome` records
 * `ok`/`error`/`timeout` per turn. A run of failures on the CLI-spawning
 * surfaces *is* the product failing, observed rather than simulated: it is the
 * strongest evidence there is. Its weakness is that it needs traffic, and a
 * quiet night is indistinguishable from a healthy one.
 *
 * **ACTIVE — the probe.** A scheduled `claude -p` whose result is stored, so a
 * lapse at 3am with nobody online is still caught. Its weakness is that it
 * costs a real (very small) model call and that it only knows what was true
 * when it last ran.
 *
 * Neither alone is enough, so the page shows both and says which one is
 * talking. `runtimeVerdict` prefers the passive signal when it has anything to
 * say, because an observed failure outranks a simulated one.
 */

/* ===================================================== the numbers, argued */

const MINUTE_MS = 60_000;

/**
 * How often the probe runs on a box. **15 minutes**, and the cron line is in
 * the probe's own header.
 *
 * The incident went unnoticed for some unknown part of seven weeks, so almost
 * any cadence is a win and the choice is really about cost against noise.
 * Every run is a real model call on Samuel's subscription: 15 minutes is 96
 * calls a day of a dozen tokens each, which is a rounding error against one
 * lesson, while 1 minute would be 1,440 and would start to look like something
 * on a bill nobody authorised. Going the other way, an hourly probe makes
 * "unknown" the tile's normal state for most of the day, and a tile that is
 * usually grey teaches its reader nothing.
 */
export const PROBE_INTERVAL_MS = 15 * MINUTE_MS;

/**
 * How old a reading may be before it stops meaning anything. **45 minutes —
 * three intervals.**
 *
 * One missed run is an ordinary fact of life on a small box: a deploy, a
 * restart, a cron tick that overlapped a long sweep. Two in a row is a
 * pattern. Three is the schedule itself being broken, which is a *different*
 * fault from the tutor being broken and is exactly as worth knowing — and it
 * is the only fault a health check cannot report about itself, which is why
 * the age is on the page beside the verdict rather than folded into it.
 *
 * Tighter than three intervals and the tile flickers to `unknown` through
 * every routine restart, which is how a reader learns to ignore it.
 */
export const STALE_AFTER_MS = 3 * PROBE_INTERVAL_MS;

/**
 * How many rows the probe keeps per (environment, probe). **300.**
 *
 * The table holds a history rather than one row for one reason: the console has
 * to be able to say **"failing since 21:40 on Friday"** and not merely "failing
 * now". At the 15-minute cadence 300 rows is just over three days, which is
 * chosen to **survive a weekend** — the incident was found on a working day
 * about a fault that had been true for weeks, and a one-day horizon would have
 * answered "since midnight", which is a lie of omission dressed as a fact.
 *
 * Beyond three days the rows stop answering a question anybody asks: a
 * fortnight-old probe result is material for a post-mortem, and a post-mortem
 * reads the alert mail and the deploy log, not a rolling health table. 300 rows
 * × 2 environments is ~600 rows for the life of the product, which is small
 * enough that no retention job, no partition and no vacuum tuning is ever
 * needed — the probe trims in the same transaction as it writes.
 */
export const PROBE_KEEP_ROWS = 300;

/**
 * How many consecutive failing probes raise an alarm. **3 — 45 minutes.**
 *
 * It must not fire on one failed probe. A single `call_failed` at 3am is a rate
 * limit, a DNS blip or a box under memory pressure, and mailing about it is how
 * the one alert that matters gets filtered into a folder. Three consecutive
 * failures spanning three quarters of an hour cannot be a blip.
 *
 * Why not longer: 45 minutes is comfortably inside one evening's homework,
 * which is the window in which the product is actually used. A threshold of two
 * hours would routinely let a whole evening's students be failed before anybody
 * was told, and the entire point of this work is that a lapse must not outlive
 * the session it breaks.
 *
 * Note what this cannot do, stated here rather than discovered later: if the
 * probe stops running altogether, no run of failures ever accumulates and **no
 * alert is ever sent**. The push half is blind to its own absence. That is
 * precisely why `unknown` is a visible state on the page — the pull half is the
 * only half that can report the silence.
 */
export const PROBE_FAILURE_RUN = 3;

/**
 * The idempotence bucket for the alert. **One hour**, matching the operator
 * rule in `lib/alerts.ts`.
 *
 * A genuine outage stays true through every subsequent sweep, so without a
 * bucket the sweep would mail every five minutes forever. One hour means a
 * persistent outage is one mail an hour: enough to be impossible to ignore,
 * calm enough to still be read at the fourth one.
 */
export const RUNTIME_ALERT_WINDOW_MS = 60 * MINUTE_MS;

/**
 * How many recent turns the passive signal looks at. **50.**
 *
 * A count rather than a period, deliberately. A period ("the last 24 hours")
 * silently becomes "no evidence" on a quiet night and the tile would have to
 * choose between saying nothing and saying something it does not know. A count
 * always has something to say, as long as the page also prints **when** those
 * fifty turns happened — which it does, because "50 turns, none failed" is
 * worthless if the newest of them is from August.
 *
 * 50 because it is more than an evening's turns for one student and fewer than
 * a day's for a pilot cohort, so the window is naturally about "recently" at
 * the volume this product actually has, and it is one small index scan.
 */
export const TURN_SAMPLE = 50;

/**
 * How recent the newest real turn must be for traffic to speak about **now**.
 * **2 hours.**
 *
 * THIS NUMBER EXISTS BECAUSE THE TILE LIED THE FIRST TIME IT WAS RUN. Against
 * the real local database, a probe aged to three hours — correctly `unknown` —
 * produced a headline of "Teaching", because the passive signal fell back on
 * twenty-two successful turns and cheerfully called the runtime healthy. The
 * newest of those turns was **twenty-three hours old**. That is the same
 * mistake as a stale probe reading as a pass, arriving through the other
 * signal, and it would have shipped: every unit test passed, because every
 * fixture had fresh turns in it.
 *
 * So traffic is bounded the way the probe is. **In both directions**, and the
 * symmetry is the same argument: a failure run from three hours ago may well
 * have been fixed since, and a success from yesterday evening says nothing
 * about this morning. Outside the window the passive signal answers `unknown`
 * and the probe decides — which is exactly what the probe is for.
 *
 * Two hours rather than the probe's 45 minutes, because the two are measuring
 * different things. The probe's age is about a *schedule we control*, so a
 * missed run is a fault. Traffic's age is about *when children happened to
 * study*, and at pilot volume there is no traffic at all for most of the day:
 * a 45-minute bound would make the passive signal permanently `unknown` and
 * throw away the one signal that is observed rather than simulated. Two hours
 * is about one sitting plus the gap after it — near enough to "now" that a
 * reader would accept the claim, short enough that "it worked last night" can
 * never be it.
 *
 * **What is NOT bounded is what the tile prints.** Line two always reports
 * every turn it sampled, with the dates on it, including "the last turn that
 * worked was seven weeks ago" — which is the most damning sentence this
 * feature can produce and must never be suppressed for being old. The window
 * governs only whether traffic gets to decide the one-word headline.
 */
export const TURN_FRESH_MS = 2 * 60 * MINUTE_MS;

/**
 * How many consecutive failed turns make the passive signal say `failing`.
 * **3.**
 *
 * One failed turn is a timeout on one child's long question and happens in a
 * healthy product. Three in a row with no success between them is not: under a
 * working runtime the failures are independent, and three consecutive is the
 * point at which "the backend is down" becomes much more likely than "three
 * students were unlucky in a row".
 *
 * Kept equal to `PROBE_FAILURE_RUN` on purpose — two different numbers here
 * would be two numbers to defend and there is no evidence that would settle
 * either of them differently.
 */
export const TURN_FAILURE_RUN = 3;

/**
 * The `surface_kind` values written by the three places that spawn the CLI:
 * `api/ask` (`chat`), `api/understanding` (`understanding`) and `lib/uploads`
 * (`upload_parse`).
 *
 * Enumerated rather than matched by pattern for migration 023's reason: a
 * future surface should land in this list as a deliberate edit, because a new
 * kind that quietly joined the health signal would change what the tile means
 * without anybody deciding to.
 */
export const CLI_SURFACE_KINDS = ["chat", "understanding", "upload_parse"] as const;

/**
 * Which `ai_interactions.outcome` values count as the runtime failing.
 *
 * `error` and `timeout` only. **`redacted` and `refused` are deliberately not
 * here**: the sacred guard killing a turn and the model declining one are the
 * product working exactly as designed, and counting them would put a permanent
 * baseline of "failures" under the tile — which is the fastest way to make a
 * health signal meaningless.
 */
export const FAILING_OUTCOMES = ["error", "timeout"] as const;

/**
 * What keeps working when the tutor cannot teach, in the words an operator
 * needs to read before they escalate.
 *
 * This sentence is the difference between "the tutor is broken" and "the
 * product is down", and those two get very different responses at 9pm. It is
 * taken from `deploy/TAKEOVER.md` §5, which is the procedure the same operator
 * will open next, and it lives here so the page and the alert mail cannot
 * drift into saying different things about the same outage.
 */
export const STILL_WORKING =
  "Sign-in and sign-up, the whole console, browsing lessons and the graph explorer, " +
  "mastery computed from stored attempts, analytics and the cost ledger all keep working.";

export const WHAT_STOPS =
  "What stops is teaching: tutor turns, understanding checks and photo OCR — the three " +
  "places that start the Claude CLI. A student can sign in and move around; she cannot be taught.";

/* =========================================================== input shapes */

/** One `runtime_health` row, narrowed to what the arithmetic reads. */
export type ProbeRow = {
  probe: string;
  ok: boolean;
  /** A `CliCode` from `lib/claude-cli.ts`. Typed as string: the table may hold
   *  a word written by an older build, and a health view must render it rather
   *  than crash on it. */
  code: string;
  /** ISO-8601, UTC. */
  checkedAt: string;
  durationMs: number | null;
};

/** One `ai_interactions` row, narrowed to what the arithmetic reads — and it
 *  reads nothing about a child. No student id, no message, no cost. */
export type TurnRow = {
  outcome: string;
  surfaceKind: string | null;
  /** ISO-8601, UTC. */
  at: string;
};

/**
 * Three states, and the middle one is the one this module exists for.
 *
 *  · `ok`      — something recent says the tutor can teach.
 *  · `unknown` — **nothing recent says anything.** Not a mild `ok`.
 *  · `failing` — something recent says it cannot.
 */
export type RuntimeState = "ok" | "unknown" | "failing";

/* ============================================================ the verdicts */

const ms = (iso: string) => Date.parse(iso);
const usable = (iso: string) => Number.isFinite(ms(iso));

/**
 * Sort newest-first and drop anything with an unparseable timestamp.
 *
 * Callers pass rows straight from SQL, which arrive ordered — but an ordering
 * this module depends on and does not enforce is an ordering that breaks the
 * day somebody adds a `LIMIT` in the wrong place. Cheap at fifty rows.
 */
function newestFirst<T>(rows: readonly T[], key: (r: T) => string): T[] {
  return rows.filter((r) => usable(key(r))).sort((a, b) => ms(key(b)) - ms(key(a)));
}

export type ProbeVerdict = {
  state: RuntimeState;
  /** Why it is `unknown`, so the page can say which kind of nothing this is. */
  unknownBecause: "never_run" | "stale" | null;
  /** The newest reading's code, or null when there has never been one. */
  code: string | null;
  /** When the newest reading happened. */
  lastAt: string | null;
  /** How old it is, in ms. The page prints this beside the verdict, always. */
  ageMs: number | null;
  /** How long the newest reading took, when it managed to finish. */
  durationMs: number | null;
  /** How many readings in a row have failed, newest first. 0 when the newest passed. */
  consecutiveFailures: number;
  /** The oldest failure in that unbroken run — "failing since". */
  failingSince: string | null;
  /** How long that run has lasted. Carried here rather than computed by the
   *  page so that one render reads ONE clock: a page that took its own `now`
   *  could call a probe stale against one instant and date its outage from
   *  another. */
  failingForMs: number | null;
  /** The newest reading that passed, at any depth in the history we hold. */
  lastOkAt: string | null;
};

/**
 * What the probe history says.
 *
 * **Staleness is checked before the verdict, never after.** A stale `ok` is not
 * a weak `ok`; it is not an `ok` at all, and the order of these two branches is
 * the single line of code this module is really about. A stale *failure* is
 * also `unknown` — it may well have been fixed since, and reporting a
 * three-hour-old failure as current would send somebody to look at a box that
 * is fine, which costs exactly as much trust as the opposite mistake.
 *
 * The counts below are computed over the whole history regardless, because
 * "failing since" and "last worked" are facts about the past and stay true
 * whether or not the newest reading is fresh.
 */
export function probeVerdict(rows: readonly ProbeRow[], nowMs: number): ProbeVerdict {
  const sorted = newestFirst(rows, (r) => r.checkedAt);

  let consecutiveFailures = 0;
  let failingSince: string | null = null;
  for (const row of sorted) {
    if (row.ok) break;
    consecutiveFailures += 1;
    failingSince = row.checkedAt;
  }
  const lastOkAt = sorted.find((r) => r.ok)?.checkedAt ?? null;

  const newest = sorted[0];
  if (!newest) {
    return {
      state: "unknown",
      unknownBecause: "never_run",
      code: null,
      lastAt: null,
      ageMs: null,
      durationMs: null,
      consecutiveFailures: 0,
      failingSince: null,
      failingForMs: null,
      lastOkAt: null,
    };
  }

  const ageMs = nowMs - ms(newest.checkedAt);
  const stale = ageMs > STALE_AFTER_MS;

  return {
    state: stale ? "unknown" : newest.ok ? "ok" : "failing",
    unknownBecause: stale ? "stale" : null,
    code: newest.code,
    lastAt: newest.checkedAt,
    ageMs,
    durationMs: newest.durationMs,
    consecutiveFailures,
    failingSince,
    failingForMs: failingSince === null ? null : nowMs - ms(failingSince),
    lastOkAt,
  };
}

export type TurnVerdict = {
  state: RuntimeState;
  /** Why it is `unknown`: nobody has used the tutor at all, or nobody has used
   *  it recently enough for the answer to be about now. The two need different
   *  copy — one is an empty product, the other is yesterday's evidence. */
  unknownBecause: "no_turns" | "stale" | null;
  /** How many turns were looked at. Zero is the "quiet night" case. */
  sampled: number;
  /** How many of them failed (`error` or `timeout`). */
  failed: number;
  /** The newest turn's time — without this, "none failed" says nothing. */
  newestAt: string | null;
  /** How long ago that was. "Fifty turns, none failed" is a statement about
   *  August if the newest of them is from August, and the tile has to be able
   *  to say so. */
  newestAgeMs: number | null;
  /** The oldest turn in the sample, so the reader knows what "recent" spans. */
  oldestAt: string | null;
  /** The newest turn that succeeded. The damning figure when it is old. */
  lastOkAt: string | null;
  /** Consecutive failures from the newest turn backwards. */
  consecutiveFailures: number;
  /** The oldest failure in that unbroken run. */
  failingSince: string | null;
  /** How long that run has lasted, against the same clock as everything else. */
  failingForMs: number | null;
};

/**
 * What real traffic says.
 *
 * **No traffic is `unknown`, for the same reason a stale probe is.** An empty
 * sample is the quiet-night case and it is the passive signal's whole weakness:
 * zero failures out of zero turns is not evidence of health and must never be
 * rendered as if it were.
 *
 * Rows are expected to be pre-filtered to `CLI_SURFACE_KINDS` by the query, and
 * are filtered again here — the SQL is the performance decision and this is the
 * correctness one, and a surface that does not spawn the CLI (a future
 * non-Claude one, say) leaking into this count would make the tile lie about
 * which program is broken.
 */
export function turnVerdict(rows: readonly TurnRow[], nowMs: number): TurnVerdict {
  const cli = new Set<string>(CLI_SURFACE_KINDS);
  const bad = new Set<string>(FAILING_OUTCOMES);
  const sorted = newestFirst(
    rows.filter((r) => r.surfaceKind !== null && cli.has(r.surfaceKind)),
    (r) => r.at
  );

  let consecutiveFailures = 0;
  let failingSince: string | null = null;
  for (const row of sorted) {
    if (!bad.has(row.outcome)) break;
    consecutiveFailures += 1;
    failingSince = row.at;
  }

  const failed = sorted.filter((r) => bad.has(r.outcome)).length;
  const lastOkAt = sorted.find((r) => !bad.has(r.outcome))?.at ?? null;

  // Traffic may only speak about NOW while it IS recent — see `TURN_FRESH_MS`,
  // and the defect that put it there. Checked before the verdict, exactly as
  // staleness is for the probe, because a stale `ok` is not a weak `ok`.
  const newestAgeMs = sorted[0] ? nowMs - ms(sorted[0].at) : null;
  const stale = newestAgeMs !== null && newestAgeMs > TURN_FRESH_MS;

  return {
    state:
      sorted.length === 0 || stale
        ? "unknown"
        : consecutiveFailures >= TURN_FAILURE_RUN
          ? "failing"
          : "ok",
    unknownBecause: sorted.length === 0 ? "no_turns" : stale ? "stale" : null,
    sampled: sorted.length,
    failed,
    newestAt: sorted[0]?.at ?? null,
    newestAgeMs,
    oldestAt: sorted[sorted.length - 1]?.at ?? null,
    lastOkAt,
    consecutiveFailures,
    failingSince,
    failingForMs: failingSince === null ? null : nowMs - ms(failingSince),
  };
}

export type RuntimeVerdict = {
  state: RuntimeState;
  /** Which signal decided it, so the page can attribute the claim it makes. */
  source: "turns" | "probe" | "nothing";
  probe: ProbeVerdict;
  turns: TurnVerdict;
};

/**
 * The tile's headline, from both signals.
 *
 * **Observed beats simulated.** A run of real failed turns is the product
 * failing for real children and outranks anything the probe has to say,
 * including a probe that passed a minute ago — a probe answering `OK` while
 * every lesson turn fails means the fault is downstream of the credential, and
 * "failing" is still the honest headline.
 *
 * After that the probe decides, and where neither has anything recent the
 * answer is `unknown` with `source: "nothing"` — which is a real state and the
 * one a brand-new environment sits in until the first probe runs.
 *
 * What this function deliberately does NOT do is average the two or pick the
 * cheerier one. The page renders all three lines whatever this returns; the
 * headline exists so a reader who takes in one word takes in the worst true
 * one.
 */
export function runtimeVerdict(
  probe: ProbeVerdict,
  turns: TurnVerdict
): RuntimeVerdict {
  if (turns.state === "failing") return { state: "failing", source: "turns", probe, turns };
  if (probe.state !== "unknown") return { state: probe.state, source: "probe", probe, turns };
  if (turns.state === "ok") return { state: "ok", source: "turns", probe, turns };
  return { state: "unknown", source: "nothing", probe, turns };
}

/* =============================================================== rendering */

/**
 * A duration in words a person reads at a glance: "4 minutes", "2 hours 15
 * minutes", "3 days".
 *
 * Here rather than in the page because the alert mail prints the same figure,
 * and because `stamp()` in the console kit renders an instant while every
 * question anybody asks about this feature is about an interval — "how long has
 * it been like this", "how old is that reading".
 *
 * Seconds are only shown under a minute: at this feature's resolution a reading
 * is either fresh or it is not, and "2 hours 15 minutes 6 seconds" is precision
 * about a number that is a quarter-hour granular at source.
 */
export function humanDuration(msTotal: number | null): string {
  if (msTotal === null || !Number.isFinite(msTotal)) return "unknown";
  const total = Math.max(0, Math.round(msTotal / 1000));
  if (total < 60) return `${total} second${total === 1 ? "" : "s"}`;

  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes === 0
      ? `${hours} hour${hours === 1 ? "" : "s"}`
      : `${hours} hour${hours === 1 ? "" : "s"} ${restMinutes} minute${restMinutes === 1 ? "" : "s"}`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0
    ? `${days} day${days === 1 ? "" : "s"}`
    : `${days} day${days === 1 ? "" : "s"} ${restHours} hour${restHours === 1 ? "" : "s"}`;
}

/** The one word the tile's chip carries. The colour is a second signal, never
 *  the only one — the console kit's rule for every chip in the product. */
export const STATE_WORD: Readonly<Record<RuntimeState, string>> = {
  ok: "Teaching",
  unknown: "Unknown",
  failing: "Cannot teach",
} as const;

/* =============================================================== the copy */

/**
 * **The three things the console must say, as text rather than as markup.**
 *
 * The wording IS the requirement here (FR-3007, FR-3008), not decoration on
 * top of one: "stale must not read as healthy" and "say what still works" are
 * obligations about sentences. Sentences that live inside JSX can only be
 * checked by opening a browser — and `.tsx` cannot be loaded by `node --test`,
 * which has no JSX transform, so a tile that held its own copy would have been
 * shipped on nobody's word but the author's. This feature was written with no
 * dev server available at all, which made that gap immediate rather than
 * theoretical.
 *
 * So the copy is here, pure, and `runtime-health.test.mts` reads it. The tile
 * (`components/console/RuntimeHealthTile.tsx`) owns the structure, the tokens
 * and the emphasis, and owns no words of its own.
 *
 * `fmt` is how a timestamp becomes a string. The console passes `stamp()` from
 * its own kit, which renders UTC and says so; a test passes something shorter.
 * Taking it as a parameter is what keeps this module free of the console's
 * component library — it is imported by the alert sweep too, which has no
 * components at all.
 */
export type HealthThresholds = {
  probeIntervalMs: number;
  staleAfterMs: number;
  failureRun: number;
  turnSample: number;
};

export type HealthLines = {
  /** The chip's word. */
  word: string;
  /** Line 1, the clause a reader takes in whole. Rendered bold. */
  probeLead: string;
  /** Line 1's remainder: the age, the code, and what to do about it. */
  probeRest: string;
  /** Line 2 — what real turns did, and what they cannot tell you. */
  turns: string;
  /** Line 3's opening clause. Rendered bold, because it is the one that stops
   *  somebody rolling back a deployment that is fine. */
  stillWorkingLead: string;
  /** Line 3's remainder. */
  stillWorking: string;
  /** Who can fix it. `null` when nothing is wrong. */
  whoFixes: string | null;
  /** Which signal is talking, and the thresholds behind it. */
  provenance: string;
};

/**
 * **The remedy has to match the diagnosis**, and the first draft of this tile
 * got it wrong.
 *
 * That draft printed "only Samuel can restore the sign-in" under every state
 * that was not `ok` — including `unknown`, where the sign-in is not what is
 * broken and may well be perfectly fine. An operator reading it at 9pm would
 * have escalated to the one person who cannot be reached, about a problem that
 * was a dead cron line. A wrong instruction is worse than no instruction: it
 * costs somebody's evening and it teaches them to distrust the next one.
 *
 * So there are four answers, and each names the thing that is actually wrong:
 *
 *   ok              nobody. Nothing to say.
 *   unknown         the PROBE needs to run. Not Samuel, not yet — there is no
 *                   evidence of a fault, only an absence of evidence.
 *   not_signed_in   Samuel, from a terminal. THE INCIDENT. TAKEOVER §5.
 *   failing, other  whatever the code in line one said. It is explicitly not a
 *                   sign-in problem, and saying so stops the reflex.
 */
function whoFixes(verdict: RuntimeVerdict): string | null {
  const { probe, state } = verdict;

  if (state === "ok") return null;

  if (state === "unknown") {
    return (
      "Nothing here needs Samuel yet — this is an absence of evidence, not evidence of a " +
      "fault. What it needs is the probe to run: `npm run probe:runtime` on the box, and the " +
      "cron line from that script's own header if it is missing."
    );
  }

  if (probe.code === "not_signed_in") {
    return (
      "Only Samuel can restore the sign-in. It is interactive and needs a terminal, so no " +
      "agent, pipeline or deploy step can perform it — the procedure is deploy/TAKEOVER.md §5, " +
      "and the command it ends with is `docker compose … exec -it app claude`."
    );
  }

  if (verdict.source === "turns" && probe.state === "ok") {
    return (
      "Real turns are failing although the probe can still reach the model, so the fault is " +
      "downstream of the sign-in — look at the turn itself before anybody is woken up. If the " +
      "probe starts failing too, deploy/TAKEOVER.md §5 is the sign-in procedure."
    );
  }

  return (
    "This is not a sign-in problem: the code above says what it is. deploy/TAKEOVER.md §5 is " +
    "the procedure if it ever becomes one, and only Samuel can carry that one out."
  );
}

export function healthLines(
  verdict: RuntimeVerdict,
  t: HealthThresholds,
  fmt: (iso: string) => string,
  labelOf: (code: string) => string,
  actionOf: (code: string) => string
): HealthLines {
  const { probe, turns, state, source } = verdict;

  /* --- line 1: the probe, and how old it is. Never one without the other. */

  let probeLead: string;
  let probeRest: string;

  if (probe.unknownBecause === "never_run") {
    probeLead = "No probe has ever run on this environment.";
    probeRest =
      "Nothing here says the tutor is working — it says nobody has looked. The probe is a " +
      `cron job every ${humanDuration(t.probeIntervalMs)}; running it once is what proves it ` +
      "runs at all.";
  } else if (probe.unknownBecause === "stale") {
    probeLead = `Nobody has looked for ${humanDuration(probe.ageMs)}.`;
    probeRest =
      `The last reading was at ${fmt(probe.lastAt!)} and it ` +
      `${probe.code === "ok" ? "passed" : "failed"} — but anything older than ` +
      `${humanDuration(t.staleAfterMs)} is a fact about the past, not about now. Either the ` +
      "schedule has stopped or the box has. This is not a pass.";
  } else if (probe.state === "failing") {
    probeLead =
      probe.failingForMs === null
        ? "The tutor could not answer."
        : `The tutor has been unable to answer for ${humanDuration(probe.failingForMs)}.`;
    const code = probe.code ?? "unknown";
    probeRest =
      `${probe.consecutiveFailures} reading${probe.consecutiveFailures === 1 ? "" : "s"} in a ` +
      `row, since ${probe.failingSince ? fmt(probe.failingSince) : "unknown"}. The last one ` +
      `said: ${labelOf(code)}. ${actionOf(code)}` +
      (probe.lastOkAt ? ` It last answered at ${fmt(probe.lastOkAt)}.` : "");
  } else {
    probeLead = `The probe answered ${humanDuration(probe.ageMs)} ago.`;
    probeRest =
      `At ${fmt(probe.lastAt!)} it was asked one question and gave the right answer` +
      (probe.durationMs !== null ? `, in ${(probe.durationMs / 1000).toFixed(1)}s` : "") +
      ". That is a statement about that moment and about no other.";
  }

  /* --- line 2: what real turns did, and what they cannot tell you. */

  let turnsLine: string;
  if (turns.sampled === 0) {
    turnsLine =
      "No student has asked the tutor anything on this environment, so real traffic says " +
      "nothing either way. A quiet night and a broken tutor look identical here — which is " +
      "exactly what the probe above is for.";
  } else if (turns.unknownBecause === "stale") {
    // Everything it knows, and then the reason it does not get a vote. The
    // figures still print: "the last turn that worked was seven weeks ago" is
    // the most damning sentence this tile can produce and is never suppressed
    // for being old.
    turnsLine =
      `The last ${turns.sampled} real tutor turn${turns.sampled === 1 ? "" : "s"} ` +
      `${turns.failed === 0 ? "all succeeded" : `include ${turns.failed} that failed`}, ` +
      `but the newest is ${humanDuration(turns.newestAgeMs)} old ` +
      `(${fmt(turns.newestAt!)}) — nobody has used the tutor recently enough for that to be ` +
      "about now." +
      (turns.failed > 0 && turns.lastOkAt
        ? ` The last turn that worked was ${fmt(turns.lastOkAt)}.`
        : "");
  } else {
    const span =
      ` Newest ${fmt(turns.newestAt!)}` +
      (turns.newestAgeMs !== null ? ` (${humanDuration(turns.newestAgeMs)} ago)` : "") +
      `, oldest ${fmt(turns.oldestAt!)}.`;
    if (turns.state === "failing") {
      turnsLine =
        `${turns.consecutiveFailures} real tutor turn` +
        `${turns.consecutiveFailures === 1 ? "" : "s"} in a row failed, since ` +
        `${turns.failingSince ? fmt(turns.failingSince) : "unknown"}` +
        (turns.failingForMs !== null ? ` — ${humanDuration(turns.failingForMs)}` : "") +
        `. ${turns.failed} of the last ${turns.sampled} failed altogether. ` +
        (turns.lastOkAt
          ? `The last turn that worked was ${fmt(turns.lastOkAt)}.`
          : `Not one of the last ${turns.sampled} worked.`) +
        span;
    } else {
      turnsLine =
        `Of the last ${turns.sampled} real tutor turn${turns.sampled === 1 ? "" : "s"}` +
        `${turns.sampled < t.turnSample ? " (all there are)" : ""}, ` +
        `${turns.failed === 0 ? "none failed" : `${turns.failed} failed`}.` +
        span;
    }
  }

  /* --- line 3: what still works. The sentence that stops the wrong panic. */

  return {
    word: STATE_WORD[state],
    probeLead,
    probeRest,
    turns: turnsLine,
    stillWorkingLead:
      state === "ok"
        ? "If this ever says it cannot teach, most of the product still can."
        : "Most of the product is still working.",
    stillWorking: `${STILL_WORKING} ${WHAT_STOPS}`,
    whoFixes: whoFixes(verdict),
    provenance:
      (source === "turns"
        ? "reading from: real turns"
        : source === "probe"
          ? "reading from: the scheduled probe"
          : "reading from: nothing — neither signal has anything recent") +
      ` · probe runs every ${humanDuration(t.probeIntervalMs)}, stale after ` +
      `${humanDuration(t.staleAfterMs)} · ${t.failureRun} failures in a row raises an email`,
  };
}

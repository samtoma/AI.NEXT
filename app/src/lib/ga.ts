/**
 * GA4 — the audience layer, and **the only module in this codebase that touches
 * `gtag`** (ADR-0016 §2, contracts/analytics.md "The GA4 wrapper contract",
 * research A1, FR-2504…FR-2506, FR-2604, SC-113, SC-114).
 *
 * `lib/analytics.ts` owns the first-party INSERT; this owns the third-party
 * send. The symmetry is the point: one module per destination, each with a
 * closed allow-list, so "anonymously" is a configuration that a test can read
 * rather than an intention somebody remembers.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR PROPERTIES THIS FILE EXISTS TO MAKE TRUE
 * ---------------------------------------------------------------------------
 *  1. **Two closed lists.** Eleven event names and five property names. Anything
 *     outside either is dropped with a `console.warn` — never passed through,
 *     never renamed, never folded into a surviving property. SC-113 is
 *     verifiable by inspecting *every* event type the wrapper can send, which
 *     is only feasible because the list is short and closed.
 *  2. **Consent defaults are set in code, BEFORE `config`** (research A1). GA4
 *     has no cookieless mode; `client_storage:'none'` does not suppress the
 *     `_ga` cookies and a `gtag('consent','default',…)` denying
 *     `analytics_storage` before `config` does. So the defaults are the first
 *     thing pushed onto `dataLayer` and `config` is the last.
 *  3. **The console never loads this.** Not "loads it and sends nothing" — never
 *     loads it. `layout.tsx` renders the script component only on the student
 *     branch, and `ga-console-guard.test.mts` asserts that no `(console)` file
 *     imports this module. Two independent reasons, because one is a habit.
 *  4. **Nothing awaits `track`, nothing renders behind it** (FR-2505). `track`
 *     returns `void`, swallows every throw, and no-ops when `gtag` is absent —
 *     which is exactly the state an ad blocker, a school proxy, an unset
 *     `AINEXT_GA_MEASUREMENT_ID` or a server render all produce. A blocked GA
 *     is indistinguishable, to the product, from a GA that was never there.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MEASUREMENT ID IS NOT READ HERE
 * ---------------------------------------------------------------------------
 * `AINEXT_GA_MEASUREMENT_ID` is a server variable (`lib/env.ts`) and this module
 * runs in the browser. It does not need the id: if the id is unset, the shell
 * renders no script, so `window.gtag` never exists, so `track` no-ops. "No-op
 * when the id is unset" is therefore a CONSEQUENCE of the shell's decision
 * rather than a second copy of it — there is no `NEXT_PUBLIC_` mirror of the id
 * to drift, and no branch here that could be wrong about whether GA is on.
 *
 * The tag loader's URL deliberately lives in the `GaScript` server component
 * (whose code never reaches a browser bundle) and not here, because this module
 * IS bundled for the client wherever a client component calls `track`. Keeping
 * the vendor domain out of this file is what lets the admin build's client
 * bundle contain no trace of it — see `ga-console-guard.test.mts`.
 */

/* ============================================================== the lists */

/**
 * Eleven, and no twelfth (contracts/analytics.md, research A1).
 *
 * These mirror first-party event names, but they are NOT the first-party union:
 * `lib/analytics.ts` carries sixteen, and the five missing here — `account_created`,
 * `email_verified`, `student_created`, `student_selected`, `parent_view_opened`,
 * `safety_flag_raised`, `button_click` — are either identity-shaped or
 * categorically excluded. `safety_flag_raised` most of all: a signal that a
 * child may be distressed is not telemetry and does not leave this box.
 */
export const GA_EVENTS = [
  "session_started",
  "session_ended",
  "unit_started",
  "unit_completed",
  "lesson_step_viewed",
  "question_asked",
  "explanation_delivered",
  "retrieval_attempt_started",
  "retrieval_attempt_submitted",
  "upload_submitted",
  "dashboard_viewed",
] as const;

export type GaEvent = (typeof GA_EVENTS)[number];

/**
 * Five, and no sixth.
 *
 * `module_ordinal` (1–10) is deliberately here where `lo_id` is deliberately
 * not: 90 objectives plus timestamps plus a persistent `client_id` reconstructs
 * one child's learning path inside Google's systems, and the module ordinal
 * keeps the shape while losing the identification (research A1). Samuel may yet
 * decide `lo_id` is fine — it is curriculum metadata, not personal data — and
 * that decision is one entry in this array, which is why it is an array.
 */
export const GA_PROPS = [
  "surface",
  "subject",
  "grade",
  "module_ordinal",
  "environment",
] as const;

export type GaProp = (typeof GA_PROPS)[number];

export type GaProps = Partial<Record<GaProp, string | number>>;

const EVENT_SET: ReadonlySet<string> = new Set(GA_EVENTS);
const PROP_SET: ReadonlySet<string> = new Set(GA_PROPS);

export function isGaEvent(name: string): name is GaEvent {
  return EVENT_SET.has(name);
}

export function isGaProp(name: string): name is GaProp {
  return PROP_SET.has(name);
}

/* =========================================================== the sanitiser */

export type Sanitised = {
  /** Only allow-listed keys with a scalar value. */
  props: Record<string, string | number>;
  /** Every key that was refused, for the warning and for the test. */
  dropped: string[];
};

/**
 * Keep the five, drop the rest, and say so.
 *
 * A value that is neither a string nor a finite number is dropped too, not
 * coerced: `String(someObject)` is how free text reaches a third party under a
 * property name that looked safe.
 */
export function sanitiseProps(props: Record<string, unknown> | undefined): Sanitised {
  const kept: Record<string, string | number> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(props ?? {})) {
    if (!isGaProp(key)) {
      dropped.push(key);
      continue;
    }
    if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
      kept[key] = value;
    } else {
      dropped.push(key);
    }
  }
  return { props: kept, dropped };
}

/* ============================================================ the consent */

/** GA4's four consent signals. The names are Google's, not ours. */
export type ConsentSignal =
  | "analytics_storage"
  | "ad_storage"
  | "ad_user_data"
  | "ad_personalization";

export type ConsentState = "granted" | "denied";

/**
 * Which surface a page belongs to, for consent purposes.
 *
 * **Resolved from the PRINCIPAL, not from the path** — see `GaScript.tsx` for
 * why, and for the one case where that is weaker than the contract's wording.
 */
export type ConsentSurface = "public" | "student-auth";

/**
 * contracts/analytics.md's table, as code.
 *
 * The three advertising signals are denied on BOTH surfaces and there is no
 * branch that could grant them: no Ads link, no advertising features, no Google
 * Signals — and since 15 June 2026 these three signals are the sole authority
 * over advertising data, so denying them here is the control rather than a
 * setting in the GA UI (research A1).
 */
export function consentDefaults(surface: ConsentSurface): Record<ConsentSignal, ConsentState> {
  return {
    analytics_storage: surface === "public" ? "granted" : "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  };
}

/* ========================================================== the bootstrap */

/**
 * The inline snippet the student shell renders, as text.
 *
 * Order inside it is the whole contract and is why this is one snippet rather
 * than three tags: `dataLayer` is a queue that `gtag.js` replays IN ORDER when
 * it eventually loads, so what matters is not which `<script>` executes first
 * but which push lands first. Consent defaults, then `js`, then `config` —
 * always, and with no way for a caller to reorder them.
 *
 * `page_view: false` turns enhanced measurement's automatic page_view off and
 * the manual send below replaces it with a `page_location` whose query string
 * is stripped: `/student?lesson=…` would otherwise hand Google a per-device
 * curriculum path, which is the same identification `lo_id` is excluded for.
 *
 * No `user_id`, ever. There is no parameter for one and no call site that could
 * pass one.
 */
export function gaBootstrap(measurementId: string, surface: ConsentSurface): string {
  const consent = consentDefaults(surface);
  return [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){dataLayer.push(arguments);}",
    // 1. consent FIRST — before `js`, before `config`, unconditionally.
    `gtag('consent','default',${JSON.stringify(consent)});`,
    "gtag('js',new Date());",
    // 2. then config, with automatic page_view off.
    `gtag('config',${JSON.stringify(measurementId)},{send_page_view:false,anonymize_ip:true});`,
    // 3. then one manual page_view whose query string is stripped.
    "gtag('event','page_view',{page_location:location.origin+location.pathname," +
      "page_title:document.title});",
  ].join("");
}

/* =============================================================== the send */

type GtagFn = (...args: unknown[]) => void;

/**
 * `window.gtag`, or null.
 *
 * Read from `globalThis` rather than `window` so this file is loadable under
 * `node --test` (where `window` is undefined) without a DOM shim — in a browser
 * `window === globalThis`, so it is the same reference.
 */
function gtagOrNull(): GtagFn | null {
  const g = (globalThis as { gtag?: unknown }).gtag;
  return typeof g === "function" ? (g as GtagFn) : null;
}

/**
 * Send one event. **The only exported way to reach `gtag` from the product.**
 *
 * Returns `void` and never throws. The ordering below is deliberate and is what
 * the tests read: the allow-list check and the property sanitiser run BEFORE
 * the `gtag` lookup, so a call site sending something it should not is warned
 * about on a developer's machine where no measurement id is configured — the
 * exact machine where it would otherwise never be noticed.
 */
export function track(event: string, props?: Record<string, unknown>): void {
  if (!isGaEvent(event)) {
    console.warn(
      `[ga] "${event}" is not one of the ${GA_EVENTS.length} allowed events — dropped. ` +
        `Add it to GA_EVENTS in lib/ga.ts and to contracts/analytics.md, or use ` +
        `lib/analytics.ts's emit() instead (the first-party stream is the record).`
    );
    return;
  }

  const { props: clean, dropped } = sanitiseProps(props);
  if (dropped.length > 0) {
    console.warn(
      `[ga] ${event}: dropped ${dropped.map((d) => `"${d}"`).join(", ")} — GA4 carries only ` +
        `${GA_PROPS.join(", ")}, and no identifier, content or personal datum under any name.`
    );
  }

  const gtag = gtagOrNull();
  if (!gtag) return; // no measurement id, blocked, or server-rendered. All fine.

  try {
    gtag("event", event, clean);
  } catch {
    // FR-2505: analytics is a visibility layer. It cannot cost a turn.
  }
}

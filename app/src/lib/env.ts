/**
 * Environment identity for the side-by-side comparison (ADR-0007, FR-901).
 *
 * Two stacks run the same codebase against the same curriculum: the frozen
 * `baseline` (ainext.reletix.com) and the `mvp1` comparison build. Every
 * analytics event and every AI cost row is stamped with which one produced it,
 * because constitution v2.0.0 Principle XI forbids pooling metrics across them.
 *
 * This is read from CONFIGURATION ONLY — never inferred from the request host,
 * a header, or anything a client can influence. A misconfigured stack must
 * produce obviously-wrong data (everything attributed to the wrong environment)
 * rather than quietly-plausible data, because quietly-plausible pooled data is
 * how a comparison silently stops meaning anything.
 */

// A DEFAULT import with an explicit attribute, and both halves are load-bearing.
// `lib/env.ts` is loaded two ways: through Next's bundler, and directly by
// `app/scripts/bootstrap-operator.mts` under plain `node`. Node's ESM refuses a
// JSON module without `with { type: "json" }`, and a JSON module in Node has a
// default export and no named ones — so `import { version } from …` fails in
// the script even though the bundler accepts it. This form works in both.
import pkg from "../../package.json" with { type: "json" };

export type Environment = "baseline" | "mvp1";

const VALID: readonly Environment[] = ["baseline", "mvp1"] as const;

function resolve(): Environment {
  const raw = (process.env.AINEXT_ENVIRONMENT ?? "").trim().toLowerCase();
  if (!raw) return "baseline"; // the frozen stack is the safe default
  if ((VALID as readonly string[]).includes(raw)) return raw as Environment;
  throw new Error(
    `AINEXT_ENVIRONMENT="${raw}" is not one of ${VALID.join(" | ")}. ` +
      `Refusing to start rather than mis-attribute comparison data.`
  );
}

export const ENVIRONMENT: Environment = resolve();

/** True on the comparison build. Use for env-gated behaviour, never for data attribution. */
export const IS_MVP1 = ENVIRONMENT === "mvp1";

/* ===========================================================================
 * Which surface this build IS (ADR-0014, plan A4, research R9).
 * ======================================================================== */

export type Surface = "student" | "admin";

const VALID_SURFACES: readonly Surface[] = ["student", "admin"] as const;

/**
 * `student` or `admin`, resolved exactly the way `ENVIRONMENT` is: from
 * configuration only, defaulting to the safe value, throwing on a value it
 * cannot make sense of.
 *
 * The default is `student` because that is the surface a child is handed: a
 * typo in the variable must produce the build with LESS in it, never the one
 * with the console in it. And an unrecognised value refuses to start rather
 * than silently choosing — a stack that thinks it is the console while serving
 * lessons is the failure this whole split exists to prevent.
 *
 * `next.config.ts` resolves the same variable independently, because a Next
 * config is loaded before this module's graph exists. The two lists are
 * identical and a mismatch would show up as a build whose routes disagree with
 * its own runtime checks.
 */
function resolveSurface(): Surface {
  const raw = (process.env.AINEXT_SURFACE ?? "").trim().toLowerCase();
  if (!raw) return "student";
  if ((VALID_SURFACES as readonly string[]).includes(raw)) return raw as Surface;
  throw new Error(
    `AINEXT_SURFACE="${raw}" is not one of ${VALID_SURFACES.join(" | ")}. ` +
      `Refusing to start rather than serve a surface nobody asked for.`
  );
}

export const SURFACE: Surface = resolveSurface();

/** True on the admin console build. The console's routes exist only here. */
export const IS_CONSOLE = SURFACE === "admin";

/* ===========================================================================
 * Which build rendered this (ADR-0015 §3, data-model §12, FR-2304).
 * ======================================================================== */

/**
 * The app's release tag, stamped onto every tutor turn as
 * `ai_interactions.renderer_version` and shown beside every turn in the
 * console's replay.
 *
 * **Why a replay needs it.** ADR-0015 rejected storing a rendered snapshot per
 * turn and chose to re-render the stored payload with the student's own
 * components. That is cheap and honest and has one failure mode: the components
 * change, and the replay shows an operator something the student was never
 * shown. Comparing the turn's stamp against this constant is what turns that
 * silent drift into a visible mark — "differs from current renderer" — so a
 * replay that no longer matches can be recognised rather than believed.
 *
 * It comes from `package.json`'s `version` rather than from an environment
 * variable, because the version is what `docs/VERSIONING.md` already bumps at a
 * release cut and a variable would be a second place to remember. `PDR1-0` is
 * the solution prefix (ADR-0010); the two together are the release name the
 * CHANGELOG uses, so an operator reading `PDR1-0-v0.4.0` on a turn can find
 * that release's entry without a lookup table.
 *
 * Resolved at module load, not per call: it cannot change while a process runs,
 * and a per-turn `require` of a JSON file on the ledger write path would be
 * three syscalls to learn a constant.
 */
export const RELEASE_TAG: string = `PDR1-0-v${pkg.version}`;

/**
 * Whether the INTERNAL surfaces are reachable: `/pipeline`, `/admin/*`,
 * `/gallery` and `/dev/*`.
 *
 * **DEPRECATED, and honoured for one release only (ADR-0014 Consequences).**
 * `AINEXT_SURFACE` has replaced it: those routes now live in the console build
 * and are absent from the student build at build time, which is what FR-2201
 * asked for and what this flag could only approximate. Nothing in the
 * application reads `INTERNAL_SURFACES` any more — it is exported so a stack
 * still setting the variable gets a warning rather than a silent no-op, and it
 * is removed at the cut of the release after the console ships (owner Samuel).
 *
 * Two flags that both decide route scope is how a surface ends up enabled by
 * one and disabled by the other, so the warning names the replacement rather
 * than merely noting the deprecation.
 *
 * Feedback #10, #11 and #12: a student opening the comparison build was given
 * "Pipeline", "Content" and "Evidence Walk" in the same navigation bar as
 * "Study". Those are an extraction pipeline, a content review queue and a
 * graph explorer — tools for us, listed to a fourteen-year-old.
 *
 * This is NOT a permission system and must not be mistaken for one. Roles need
 * accounts (#7, #8, FR-106, DEFERRED), and until those exist the honest thing
 * is a build-time switch rather than a login-shaped thing that checks nothing.
 * What it does guarantee is that the build a student is handed does not carry
 * the routes at all — they 404, rather than being merely unlinked and one
 * guessed URL away.
 *
 * Default: ON everywhere EXCEPT the comparison build, where it is off unless
 * explicitly enabled. That keeps the existing demo stacks exactly as they are
 * and makes the student-facing build the one that has to opt in — the safe
 * direction for a flag whose failure mode is showing a child the admin tools.
 *
 * `/spine` is deliberately NOT gated here: the lesson report sends students to
 * it ("See it on the graph →") and #15 asks for more of it, not less. What #12
 * actually reported is the *tab*, and the tab is gone.
 */
function resolveInternalSurfaces(): boolean {
  const raw = (process.env.AINEXT_INTERNAL_SURFACES ?? "").trim().toLowerCase();
  if (raw !== "") {
    // One line, once, at module load — not per request, and not an exception:
    // a deployment mid-migration must still start.
    console.warn(
      `[env] AINEXT_INTERNAL_SURFACES="${raw}" is DEPRECATED and ignored for route scope. ` +
        `Use AINEXT_SURFACE=admin to build the console (ADR-0014); this variable is ` +
        `removed at the cut of the release after the console ships.`
    );
  }
  if (raw === "on" || raw === "true" || raw === "1") return true;
  if (raw === "off" || raw === "false" || raw === "0") return false;
  return !IS_MVP1;
}

export const INTERNAL_SURFACES: boolean = resolveInternalSurfaces();

/* ===========================================================================
 * Course availability (migration 023, lib/catalog.ts) — the kill switch
 * ======================================================================== */

/**
 * Whether the per-(course, grade) availability gate applies at all.
 *
 * ⚠ NO REQUIREMENT COVERS THE FEATURE THIS SWITCHES. See `lib/catalog.ts`.
 *
 * `on` — the gate applies: a student sees a course only when a rule (or a
 * personal override) says `live`. `off`, or unset — `visibleCoursesFor`
 * answers "everything", and every student surface behaves exactly as it did
 * before migration 023 existed.
 *
 * ---------------------------------------------------------------------------
 * THE ASYMMETRY IS THE POINT, AND IT IS THE OPPOSITE OF THE GATE'S OWN DEFAULT
 * ---------------------------------------------------------------------------
 * Inside the gate, a missing ROW means hidden: default-deny, because the thing
 * being decided is whether a child sees unapproved content and nobody should
 * have to remember to hide it.
 *
 * Here, a missing VARIABLE means the gate is OFF. That looks like the same
 * decision made twice in opposite directions, and it is — because the two
 * failures are not the same failure. A forgotten row hides one course that
 * somebody was about to turn on anyway. A forgotten variable, if this defaulted
 * to `on`, would be an allow-list nobody has populated yet: **every student on
 * that stack locked out of the course they are paying to study**, on a Sunday
 * evening, with no error message anywhere to explain it. For a tutoring product
 * the safe failure is "too much visible", not "a child locked out of their own
 * lesson" — the content behind the gate is the ministry curriculum, not
 * anything a stranger uploaded.
 *
 * So the gate is opted INTO per stack. `scripts/local-dev.sh` writes `on` into
 * the generated `.env.local`, so local development and every test run exercise
 * the real path rather than the bypass.
 *
 * Unparseable values throw, like `AINEXT_ENVIRONMENT`: "the gate is in a state
 * nobody chose" is not something to resolve by guessing.
 *
 * EXPORTED, unlike its neighbours, so `lib/catalog.test.mts` can prove both
 * directions of a switch whose whole job is to be correct on the day somebody
 * reaches for it. `COURSE_GATING` is resolved once at module load, which is the
 * right thing for the application and untestable from inside one process.
 */
export function resolveCourseGating(): boolean {
  const raw = (process.env.AINEXT_COURSE_GATING ?? "").trim().toLowerCase();
  if (raw === "") return false;
  if (raw === "on" || raw === "true" || raw === "1") return true;
  if (raw === "off" || raw === "false" || raw === "0") return false;
  throw new Error(
    `AINEXT_COURSE_GATING="${raw}" is not one of on | off. Refusing to start ` +
      `rather than guess whether a course gate is meant to be enforced.`
  );
}

export const COURSE_GATING: boolean = resolveCourseGating();

/* ===========================================================================
 * Identity (ADR-0013) — the variables sign-in, mail and Google need.
 *
 * Two different shapes below, and the difference is deliberate.
 *
 * Anything that can have an HONEST DEFAULT is resolved at module load and
 * throws only on a value it cannot make sense of, exactly like
 * AINEXT_ENVIRONMENT above: a misconfigured stack should refuse to start rather
 * than run on a guess.
 *
 * Anything that is a SECRET has no honest default, so it is resolved lazily by
 * a function that throws at the point of use. Throwing at import would take
 * `next build`, `npm test` and every script down on a machine that has no
 * business holding the production signing key — and a build that cannot run
 * without secrets is a build nobody runs.
 * ======================================================================== */

/**
 * HS256 signing key for the access token. At least 32 bytes.
 *
 * No default of any kind. A development fallback here would ship as a
 * production signing key the first time someone forgot the variable, and a
 * signing key everyone knows is a session everyone can mint.
 */
export function authSecret(): string {
  const raw = process.env.AINEXT_AUTH_SECRET ?? "";
  if (raw.length < 32) {
    throw new Error(
      raw
        ? `AINEXT_AUTH_SECRET is ${raw.length} characters; at least 32 are required.`
        : "AINEXT_AUTH_SECRET is not set. Generate one with `openssl rand -hex 32` " +
            "(scripts/local-dev.sh does this for you locally) — there is deliberately no default."
    );
  }
  return raw;
}

export type MailTransport = "console" | "smtp";

const VALID_TRANSPORTS: readonly MailTransport[] = ["console", "smtp"] as const;

function resolveMailTransport(): MailTransport {
  const raw = (process.env.AINEXT_MAIL_TRANSPORT ?? "").trim().toLowerCase();
  if (!raw) return "console";
  if ((VALID_TRANSPORTS as readonly string[]).includes(raw)) return raw as MailTransport;
  throw new Error(
    `AINEXT_MAIL_TRANSPORT="${raw}" is not one of ${VALID_TRANSPORTS.join(" | ")}.`
  );
}

/**
 * `console` prints verification and reset links to the server log and writes
 * them under `app/.local-mail/`; `smtp` sends them. Console is the default
 * because local development has no mail server, and a link that is printed is a
 * link a developer can follow — silently dropping it is how "verification is
 * broken" gets diagnosed for an hour.
 */
export const MAIL_TRANSPORT: MailTransport = resolveMailTransport();

/** Only meaningful when MAIL_TRANSPORT is `smtp`; throws if it is and this is unset. */
export function smtpUrl(): string {
  const raw = (process.env.AINEXT_SMTP_URL ?? "").trim();
  if (!raw) {
    throw new Error(
      "AINEXT_MAIL_TRANSPORT=smtp but AINEXT_SMTP_URL is not set. A verification " +
        "mail that cannot be sent must fail loudly: a student waiting for a link " +
        "that was never sent has no way to tell the difference from a slow one."
    );
  }
  return raw;
}

export const MAIL_FROM: string =
  (process.env.AINEXT_MAIL_FROM ?? "").trim() || "no-reply@localhost";

/**
 * Absolute origin for the links we put in mail. Never derived from the request
 * host: a Host header is client-controlled, and a verification link pointed at
 * an attacker's origin is a verification link that verifies for them.
 */
function resolveOrigin(name: string, fallback: string): string {
  const raw = (process.env[name] ?? "").trim() || fallback;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name}="${raw}" is not an absolute URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name}="${raw}" must be http or https.`);
  }
  return parsed.origin;
}

export const PUBLIC_URL: string = resolveOrigin("AINEXT_PUBLIC_URL", "http://localhost:3000");

/**
 * The console's own origin, for the links in operator mail — a password reset
 * built from the request origin is reset poisoning: an attacker sets the Host
 * header, the mail arrives from us, and the operator's reset token walks to
 * their server. Falls back to PUBLIC_URL when unset, because one origin is the
 * normal state until the console gets a hostname of its own (D3).
 */
export const CONSOLE_URL: string = resolveOrigin("AINEXT_CONSOLE_URL", PUBLIC_URL);

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/**
 * All three or none. A PARTIAL configuration throws, because the failure it
 * produces otherwise is a Google button that renders enabled and fails at the
 * callback — after the student has already handed Google their credentials.
 * Unconfigured is a supported state: the button renders disabled and says so.
 */
function resolveGoogleOAuth(): GoogleOAuthConfig | null {
  const clientId = (process.env.AINEXT_GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.AINEXT_GOOGLE_CLIENT_SECRET ?? "").trim();
  const redirectUri = (process.env.AINEXT_GOOGLE_REDIRECT_URI ?? "").trim();
  const present = [clientId, clientSecret, redirectUri].filter(Boolean).length;
  if (present === 0) return null;
  if (present < 3) {
    throw new Error(
      "Google sign-in is partially configured: AINEXT_GOOGLE_CLIENT_ID, " +
        "AINEXT_GOOGLE_CLIENT_SECRET and AINEXT_GOOGLE_REDIRECT_URI must all be " +
        "set, or all be unset (the button then renders disabled)."
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export const GOOGLE_OAUTH: GoogleOAuthConfig | null = resolveGoogleOAuth();

/**
 * The first operator (ADR-0014, plan A5). Read by
 * `app/scripts/bootstrap-operator.mts`, which seeds the row and its four role
 * grants and sets NO password — Samuel obtains one through the ordinary reset
 * flow, so no credential ever sits in a config file. Null means "no bootstrap
 * configured", which is a normal state for a student-only stack.
 */
export const BOOTSTRAP_OPERATOR_EMAIL: string | null =
  (process.env.AINEXT_BOOTSTRAP_OPERATOR_EMAIL ?? "").trim().toLowerCase() || null;

/* ===========================================================================
 * Monitoring and analytics (ADR-0016, plan A8, contracts/analytics.md).
 *
 * Both variables below are OPTIONAL and both follow the same shape as
 * AINEXT_ENVIRONMENT above: unset is a supported state with an honest
 * behaviour, and only a value that cannot be made sense of refuses to start.
 * Neither is a secret, so both resolve at module load.
 * ======================================================================== */

/**
 * The GA4 measurement id, e.g. `G-XXXXXXXXXX`.
 *
 * **Unset is the normal state on a laptop and in CI**: the student shell then
 * renders no script tag at all, the vendor's global never exists, and
 * `lib/ga.ts`'s `track()` no-ops. GA is an audience layer (ADR-0016 §2) — a build without one
 * is a build with one fewer dashboard, not a build that is missing something.
 *
 * A MALFORMED value throws, because the failure it produces otherwise is
 * silent: a script tag pointing at a measurement id that does not exist loads,
 * costs the student a request, and reports nothing, forever. GA4 web ids are
 * `G-` followed by an alphanumeric stream; the older `UA-` and the server-side
 * `GT-`/`AW-`/`DC-` forms are refused by name rather than by omission, because
 * pasting one of those is the likely mistake and "not a G- id" is a worse error
 * message than "that is a Universal Analytics id". This build sends browser
 * events only — no Measurement Protocol, ADR-0016 §2 — so it needs the
 * `G-XXXXXXXXXX` form from the GA4 data stream and nothing else.
 */
function resolveGaMeasurementId(): string | null {
  const raw = (process.env.AINEXT_GA_MEASUREMENT_ID ?? "").trim();
  if (!raw) return null;
  if (/^(UA|AW|DC|GT)-/i.test(raw)) {
    throw new Error(
      `AINEXT_GA_MEASUREMENT_ID="${raw}" is not a GA4 web measurement id. ` +
        `This build sends browser events only (no Measurement Protocol, ADR-0016 §2), ` +
        `so it needs the G-XXXXXXXXXX form from the GA4 data stream.`
    );
  }
  if (!/^G-[A-Z0-9]{4,}$/i.test(raw)) {
    throw new Error(
      `AINEXT_GA_MEASUREMENT_ID="${raw}" does not look like G-XXXXXXXXXX. ` +
        `Refusing to render a tag that would load and report nothing.`
    );
  }
  return raw;
}

export const GA_MEASUREMENT_ID: string | null = resolveGaMeasurementId();

/**
 * Where the security sweep sends an alert (`app/scripts/alerts-sweep.mts`,
 * contracts/admin.md §7, research A5).
 *
 * **Unset means the sweep LOGS instead of mailing** — it still evaluates every
 * rule, still records that the rule fired in `alerts_sent`, and still prints
 * the alert body. That is the honest degradation: an alert nobody addressed a
 * mail to is not a reason to stop detecting, and a laptop has nowhere to send
 * one. A malformed address throws, for the same reason a malformed measurement
 * id does — mail to `samuel@` fails at 3am on the one night it mattered.
 */
function resolveAlertEmail(): string | null {
  const raw = (process.env.AINEXT_ALERT_EMAIL ?? "").trim();
  if (!raw) return null;
  // Deliberately loose: one @, something either side, no whitespace. A stricter
  // pattern would reject a valid address somebody actually uses, and the thing
  // being caught here is a typo'd variable, not an RFC 5322 violation.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    throw new Error(
      `AINEXT_ALERT_EMAIL="${raw}" is not an email address. Leave it unset to have ` +
        `the sweep log its alerts instead — that is a supported state.`
    );
  }
  return raw;
}

export const ALERT_EMAIL: string | null = resolveAlertEmail();

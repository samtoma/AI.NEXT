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

/**
 * Whether the INTERNAL surfaces are reachable: `/pipeline`, `/admin/*`,
 * `/gallery` and `/dev/*`.
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
  if (raw === "on" || raw === "true" || raw === "1") return true;
  if (raw === "off" || raw === "false" || raw === "0") return false;
  return !IS_MVP1;
}

export const INTERNAL_SURFACES: boolean = resolveInternalSurfaces();

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
function resolvePublicUrl(): string {
  const raw = (process.env.AINEXT_PUBLIC_URL ?? "").trim() || "http://localhost:3000";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`AINEXT_PUBLIC_URL="${raw}" is not an absolute URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`AINEXT_PUBLIC_URL="${raw}" must be http or https.`);
  }
  return parsed.origin;
}

export const PUBLIC_URL: string = resolvePublicUrl();

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

/**
 * The LOCAL DEVELOPMENT operator picker — and the three locks on it
 * (ADR-0022, FR-3309).
 *
 * On a laptop there is no Cloudflare in front of the console, so there is no
 * proof of who is at the keyboard, and typing a password to switch between two
 * seeded operators is friction that buys nothing. The picker is a list of
 * "Sign in as <operator>" buttons on the console's sign-in page.
 *
 * It is a way to become ANY operator without a credential, so it is locked
 * three times, and every lock is checked by the server endpoint that does the
 * signing in — not only by the page that draws the buttons:
 *
 *  1. **`NODE_ENV !== "production"`.** Next inlines `NODE_ENV` at build time,
 *     so in a production build this clause is the constant `false` and the
 *     whole function answers "no" whatever else is true. Belt to that: the
 *     endpoint's file is `route.dev.console.ts`, and `next.config.ts` adds the
 *     `dev.console.ts` page extension only outside production — so a
 *     production build does not contain the endpoint at all, and
 *     `npm run check:surface:admin` fails if it ever does.
 *  2. **`AINEXT_DEV_OPERATOR_PICKER === "on"`** — exactly that string. Set by
 *     `scripts/local-dev.sh` in `app/.env.local`, never by the deploy.
 *  3. **The request is to `localhost` / `127.0.0.1` / `[::1]`**, by its Host
 *     header, and — when the browser sends one — its Origin too. A console
 *     reached over the tailnet or the LAN (the iPad test path) gets no picker.
 *     The Host header is client-supplied, so this lock is the weakest of the
 *     three and is not relied on alone; it stops the ordinary case of a dev
 *     server that `next dev` bound to every interface being handed to anyone
 *     on the same Wi-Fi. When Next's dev server has recorded the connecting
 *     address (`x-forwarded-for`), that must be loopback too.
 *
 * Pure — no request object, no `process.env` read inside the decision — so the
 * refusal in each case is a unit test (`dev-picker.test.mts`).
 */

export type DevPickerInput = {
  nodeEnv: string | undefined;
  flag: string | undefined;
  host: string | null | undefined;
  origin?: string | null;
  forwardedFor?: string | null;
};

export type DevPickerDecision =
  | { allowed: true }
  | { allowed: false; why: "production" | "flag_off" | "not_local_host" | "not_local_origin" | "not_local_client" };

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** `localhost:3002` → `localhost`; `[::1]:3002` → `[::1]`. Null for anything unparseable. */
function hostnameOf(hostHeader: string): string | null {
  const h = hostHeader.trim().toLowerCase();
  if (!h) return null;
  try {
    return new URL(`http://${h}`).hostname;
  } catch {
    return null;
  }
}

function isLocalHostHeader(host: string | null | undefined): boolean {
  if (!host) return false;
  const name = hostnameOf(host);
  return name !== null && LOCAL_HOSTNAMES.has(name);
}

function isLocalOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === "http:" || u.protocol === "https:") && LOCAL_HOSTNAMES.has(u.hostname);
  } catch {
    return false;
  }
}

function isLoopbackAddress(raw: string): boolean {
  const first = raw.split(",")[0]!.trim().toLowerCase();
  return (
    first === "::1" ||
    first === "127.0.0.1" ||
    first.startsWith("127.") ||
    first === "::ffff:127.0.0.1" ||
    first.startsWith("::ffff:127.")
  );
}

export function devPickerDecision(input: DevPickerInput): DevPickerDecision {
  if (input.nodeEnv === "production") return { allowed: false, why: "production" };
  if (input.flag !== "on") return { allowed: false, why: "flag_off" };
  if (!isLocalHostHeader(input.host)) return { allowed: false, why: "not_local_host" };
  if (input.origin && input.origin !== "null" && !isLocalOrigin(input.origin)) {
    return { allowed: false, why: "not_local_origin" };
  }
  if (input.forwardedFor && !isLoopbackAddress(input.forwardedFor)) {
    return { allowed: false, why: "not_local_client" };
  }
  return { allowed: true };
}

/**
 * The same decision, read from this process and one request's headers.
 *
 * `process.env.NODE_ENV` is written out in full on purpose: that exact
 * expression is what Next replaces with a string literal at build time, which
 * is what turns lock 1 into a constant in a production artefact.
 */
export function devPickerDecisionFor(headers: {
  get(name: string): string | null;
}): DevPickerDecision {
  return devPickerDecision({
    nodeEnv: process.env.NODE_ENV,
    flag: process.env.AINEXT_DEV_OPERATOR_PICKER,
    host: headers.get("host"),
    origin: headers.get("origin"),
    forwardedFor: headers.get("x-forwarded-for"),
  });
}

/** One row of the picker's list, as `/signin` renders it. */
export type PickerOperator = {
  id: number;
  displayName: string;
  email: string;
  roles: string[];
};

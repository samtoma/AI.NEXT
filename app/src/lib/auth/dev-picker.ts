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
 *  3. **The request is to this machine.** What actually makes that true is
 *     WHERE THE DEV SERVER LISTENS, not anything in this file: `next dev`
 *     binds every interface (`0.0.0.0`) unless told otherwise, so
 *     `scripts/local-dev.sh` and the `tutor-console` entry in
 *     `.claude/launch.json` start the console with `-H 127.0.0.1` whenever the
 *     picker flag is set, and then nothing off this machine can open a
 *     connection to it at all. A console started by hand without that flag is
 *     reachable from the LAN, and this lock is then only as good as the checks
 *     below.
 *
 *     A route handler cannot see its own socket, so what the server checks is
 *     the request's description of itself: the Host header must name
 *     `localhost` / `127.0.0.1` / `[::1]`; the Origin, when one is sent, must
 *     be a loopback origin — and `Origin: null` (a sandboxed frame, a `data:`
 *     or `file:` page, some cross-site redirects) is refused, not waved
 *     through; and `x-forwarded-for`, when present, must be loopback.
 *     **None of these is proof.** Host and Origin are written by the client,
 *     and Next fills in `x-forwarded-for` from the socket only when the
 *     request did not bring its own (`??=` in Next's base server) — so a
 *     machine on the same Wi-Fi, talking to a server bound to every interface,
 *     can send `Host: localhost` and `X-Forwarded-For: 127.0.0.1` and pass all
 *     three. What the checks DO stop is a browser on another machine (which
 *     cannot forge Host or Origin), a cross-site form post, and a sandboxed
 *     frame. The loopback bind is what stops a hand-built request.
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
  | {
      allowed: false;
      why: "production" | "flag_off" | "not_local_host" | "not_local_origin" | "null_origin" | "not_local_client";
    };

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
  // An Origin that was sent at all must be a loopback origin. `null` is what a
  // browser sends when it will not say where the request came from — a
  // sandboxed iframe, a `data:` or `file:` document, a cross-origin redirect
  // chain — which is exactly the request this lock exists to refuse. An empty
  // header is not a real browser's and is refused with it.
  if (input.origin != null) {
    if (input.origin.trim().toLowerCase() === "null") return { allowed: false, why: "null_origin" };
    if (!isLocalOrigin(input.origin)) return { allowed: false, why: "not_local_origin" };
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

/**
 * Keeping a signed-in student signed in while a page stays open (FR-2016).
 *
 * The access cookie lives 15 minutes (`ACCESS_TOKEN_TTL_SECONDS`) and nothing
 * on the student surface renewed it, although `proxy.ts` said "the client
 * refreshes ahead of expiry". A walk-through is estimated at about 15 minutes,
 * so a student deep in one lesson page sent their next message with an expired
 * cookie, got a 401, and read "AI backend unavailable". Widget attempts, whose
 * failures are deliberately swallowed, were most likely dropped with no sign.
 *
 * Two parts, both browser-only:
 *
 *  1. `authFetch` — on a 401, renew once and retry the request once. Safe to
 *     retry because every student route checks the principal before it does
 *     anything, so a 401 means the request did nothing.
 *  2. `startSessionKeepAlive` — renew ahead of expiry while the student is
 *     actually here: the page visible AND an interaction in the last 15 minutes.
 *
 * SECURITY — the two rules this module exists to keep:
 *
 *  · **Never two renewals at once.** `/api/auth/refresh` treats a refresh token
 *    presented twice as theft and revokes EVERY session of that student
 *    (FR-2008), with no grace window. Two 401s at once, the timer racing a
 *    retry, or two tabs would all do exactly that. So renewals are single-flight
 *    inside a tab (one shared promise) and serialised across tabs with the Web
 *    Locks API; a renewal that waited for another tab's lock skips itself when
 *    that tab renewed moments ago. The cookie jar is shared, so a renewal sent
 *    after another tab's has completed carries the NEW refresh token — never a
 *    spent one.
 *  · **Never keep an idle session alive.** The server's 7-day idle expiry and
 *    30-day absolute cap (`rotateRefreshToken`) are unchanged, but a timer that
 *    renewed in a forgotten tab would defeat the idle one. So the keep-alive
 *    only renews for a student who is visibly here and has touched the page
 *    recently; anyone else is renewed, if at all, by their own next action.
 *
 * Residual risk, not introduced here: if the network drops after the server
 * rotated but before the browser stored the new cookie, the next renewal
 * presents the spent token and the student is signed out everywhere. That is
 * the reuse rule working as designed; it is only more likely because renewals
 * now happen during a lesson rather than only at `/signin`.
 */

/** Renew this long after the last renewal, while the student is active. */
export const KEEPALIVE_EVERY_MS = 10 * 60 * 1000;
/** "Here" means an interaction within this window (and the page visible). */
export const ACTIVE_WITHIN_MS = 15 * 60 * 1000;
/** A renewal another tab made this recently makes ours unnecessary. */
export const RECENT_RENEWAL_MS = 60 * 1000;

const LOCK_NAME = "noor-session-renewal";
const RENEWED_AT_KEY = "noor.session.renewedAt";

/** The student-facing line when renewal itself fails (FR-2016). Shown by the
 *  tutor chat only, where its error message would otherwise appear. */
export const SIGNED_OUT_MESSAGE =
  "You have been signed out — try refreshing this page, or sign in again.";

/* ---------------------------------------------------------- pure rules --- */

/** Should the keep-alive renew now? Pure, so the idle rule is testable. */
export function keepAliveDue(v: {
  now: number;
  visible: boolean;
  lastActivityAt: number;
  lastRenewedAt: number;
}): boolean {
  if (!v.visible) return false;
  if (v.now - v.lastActivityAt > ACTIVE_WITHIN_MS) return false;
  return v.now - v.lastRenewedAt >= KEEPALIVE_EVERY_MS;
}

/** Did some tab renew recently enough that this one need not? */
export function renewedRecently(renewedAt: number | null, now: number): boolean {
  return renewedAt !== null && now - renewedAt < RECENT_RENEWAL_MS;
}

/* ------------------------------------------------------- shared storage --- */

function readRenewedAt(): number | null {
  try {
    const v = Number(localStorage.getItem(RENEWED_AT_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeRenewedAt(t: number): void {
  try {
    localStorage.setItem(RENEWED_AT_KEY, String(t));
  } catch {
    /* private mode: the lock still serialises; only the skip is lost */
  }
}

/* ------------------------------------------------------------- renewal --- */

let inFlight: Promise<boolean> | null = null;
let lastRenewedHere = Date.now();

async function renewOnce(): Promise<boolean> {
  // Inside the cross-tab lock: another tab may have renewed while we waited.
  if (renewedRecently(readRenewedAt(), Date.now())) {
    lastRenewedHere = Date.now();
    return true;
  }
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
    });
    if (!res.ok) return false;
    const now = Date.now();
    writeRenewedAt(now);
    lastRenewedHere = now;
    return true;
  } catch {
    return false;
  }
}

/**
 * Renew the session. Single-flight in this tab, serialised across tabs.
 * Resolves true when a fresh access cookie is in place.
 */
export function renewSession(): Promise<boolean> {
  if (inFlight) return inFlight;
  const locks =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { locks?: LockManager }).locks
      : undefined;
  // `request` resolves with the callback's own (awaited) result.
  const run: Promise<boolean> = locks
    ? locks.request(LOCK_NAME, renewOnce).then((ok) => ok)
    : renewOnce();
  inFlight = run.finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * `fetch`, plus one renewal-and-retry on a 401. Anything that is not a 401 is
 * returned untouched, so callers keep their own error handling. A 401 that
 * survives renewal is returned as-is: the tutor chat turns it into
 * `SIGNED_OUT_MESSAGE`, and other callers keep their existing behaviour.
 *
 * Do not pass a body that can only be read once (a ReadableStream): the retry
 * sends the same `init` again. Strings, FormData and Blobs are fine.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  const renewed = await renewSession();
  if (!renewed) return res;
  return fetch(input, init);
}

/* ---------------------------------------------------------- keep-alive --- */

/**
 * Renew ahead of expiry while the student is present. Returns a stop function.
 * Mounted once per page by `SessionKeepAlive`.
 */
export function startSessionKeepAlive(): () => void {
  let lastActivityAt = Date.now();
  const onActivity = () => {
    lastActivityAt = Date.now();
  };
  const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
  for (const e of events) {
    window.addEventListener(e, onActivity, { passive: true, capture: true });
  }
  const check = () => {
    if (
      keepAliveDue({
        now: Date.now(),
        visible: document.visibilityState === "visible",
        lastActivityAt,
        lastRenewedAt: Math.max(lastRenewedHere, readRenewedAt() ?? 0),
      })
    ) {
      void renewSession();
    }
  };
  const timer = window.setInterval(check, 60 * 1000);
  document.addEventListener("visibilitychange", check);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", check);
    for (const e of events) {
      window.removeEventListener(e, onActivity, { capture: true });
    }
  };
}

"use client";

/**
 * "Continue with Google" — or a disabled button that says why.
 *
 * Availability is decided on the SERVER (`GOOGLE_OAUTH !== null` in
 * `lib/env.ts`) and handed down as a boolean prop. Deliberately not probed
 * from the client: a HEAD on `/api/auth/google/login` would start a handshake
 * and set a state cookie just to find out whether the button works, and the
 * only other way to tell the client is to expose the client id, which is a
 * credential we have no reason to ship to a browser that is not mid-redirect.
 *
 * With Google unset this renders disabled rather than hidden. A student who
 * signed up with Google on another build and cannot find the button would
 * conclude the account is gone; a dashed, plainly-labelled button says the
 * truth instead (ADR-0013's "state the consequence" rule applied to a UI).
 */

export function GoogleButton({
  available,
  label = "Continue with Google",
}: {
  available: boolean;
  label?: string;
}) {
  if (!available) {
    return (
      <div>
        <button
          type="button"
          disabled
          aria-describedby="google-unavailable"
          className="w-full min-h-[52px] rounded-[20px] border-[3px] px-5 font-display text-[1.05rem] font-bold"
        >
          {label}
        </button>
        <p
          id="google-unavailable"
          className="mt-1.5 text-[0.85rem] text-ink-soft"
        >
          Google sign-in isn&apos;t set up yet.
        </p>
      </div>
    );
  }

  return (
    // A plain link, not a fetch: the endpoint answers 302 to Google and sets
    // the PKCE state cookie on the way out. Following that with fetch() would
    // land the handshake in a response body instead of the address bar.
    <a
      href="/api/auth/google/login"
      className="play-pressable flex w-full min-h-[52px] items-center justify-center rounded-[20px] border-[3px] border-ink bg-card px-5 font-display text-[1.05rem] font-bold text-ink sticker-shadow-sm"
    >
      {label}
    </a>
  );
}

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
 * With Google unset this renders nothing. It used to render a disabled,
 * labelled button, so that a student who signed up with Google on another
 * build would not conclude the account was gone — but Google has never been
 * configured on any deployment, so no such account exists, and a dead button
 * on every sign-in screen only advertised a feature we do not offer. Revisit
 * if Google is ever switched on in one environment and off in another.
 */

export function GoogleButton({
  available,
  label = "Continue with Google",
}: {
  available: boolean;
  label?: string;
}) {
  if (!available) return null;

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

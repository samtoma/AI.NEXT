import { redirect } from "next/navigation";

import { CloudflareRefusal } from "@/components/auth/CloudflareRefusal";
import { FormNotice } from "@/components/auth/Controls";
import { DevOperatorPicker } from "@/components/auth/DevOperatorPicker";
import { SigninForm } from "@/components/auth/SigninForm";
import { safeNext } from "@/components/auth/next-param";
import { currentPrincipal } from "@/lib/auth/principal";
import { GOOGLE_OAUTH, IS_CONSOLE } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata = { title: IS_CONSOLE ? "Console sign-in — Noor" : "Sign in — Noor" };

/**
 * /signin — and, for most visitors who land here, not a sign-in at all.
 *
 * The client does a silent `POST /api/auth/refresh` before showing anything
 * (see `SigninForm`): the proxy sends a student here the moment her 15-minute
 * access cookie expires, and her refresh cookie — which this page cannot read
 * but that request does carry — is good for days. The server cannot do that
 * rotation itself; a Server Component cannot set a cookie.
 *
 * What the server CAN answer is the case where the access cookie is still
 * valid: a student who is already signed in and typed the URL gets sent on
 * rather than shown a form she does not need.
 *
 * Google availability is read here, from the server's own configuration, and
 * crosses to the client as a boolean. The client id stays on this side.
 *
 * **The copy is surface-aware, and now so is the default destination**
 * (ADR-0014; F-P2b). The same form posts to the same `/api/auth/login`, which
 * authenticates against `operators` rather than `accounts` when
 * `AINEXT_SURFACE=admin` and refuses a student credential there with
 * `permission_denied` (FR-2205). One endpoint, one code path, two tables —
 * but `?next=` is absent far more often than it is present (nobody's sign-in
 * link normally carries one), and `safeNext`'s own fallback used to be
 * `/student` unconditionally. On the console that fallback is a page this
 * build 404s on: an operator whose silent refresh succeeds with no `?next=`
 * was landing on a dead end instead of the student list. The fallback is
 * surface-aware for exactly the same reason the copy already is.
 *
 * **On the console, Cloudflare Access comes first** (ADR-0022). When the
 * request carries an Access assertion, this page does not show a form: it
 * forwards to `/api/auth/cloudflare`, which verifies the assertion and starts
 * the session (a Server Component cannot set the cookies). That route always
 * comes back here with `?cf=` set when it could not sign anybody in, and
 * `consoleSigninState` never forwards a request carrying `cf` — so a failed
 * verification lands on the password form (the fallback, FR-3308) rather than
 * looping, and a proven identity with no account lands on a refusal
 * (FR-3303). None of this runs on the student surface.
 */
export default async function SigninPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; cf?: string | string[] }>;
}) {
  const sp = await searchParams;
  const next = safeNext(
    Array.isArray(sp.next) ? sp.next[0] : sp.next,
    IS_CONSOLE ? "/" : "/student"
  );

  const me = await currentPrincipal();
  if (me.kind === "student") redirect(next);
  // On the console an operator who is already signed in is sent on for the
  // same reason: the form would be a screen they do not need.
  if (me.kind === "operator") redirect(next);

  let notice: string | null = null;
  let picker: React.ReactNode = null;
  if (IS_CONSOLE) {
    const { consoleSigninState, listPickerOperators } = await import("@/lib/auth/console-signin");
    const state = await consoleSigninState(Array.isArray(sp.cf) ? sp.cf[0] : sp.cf);
    if (state.mode === "forward") {
      redirect(`/api/auth/cloudflare?${new URLSearchParams({ next }).toString()}`);
    }
    if (state.mode === "refusal") {
      return (
        <CloudflareRefusal
          kind={state.kind}
          email={state.provenEmail}
          logoutUrl={state.accessLogoutUrl}
        />
      );
    }
    if (state.notice === "invalid") {
      notice =
        "Your Cloudflare sign-in could not be verified, so the console cannot sign you in with it. Use your operator password instead.";
    } else if (state.notice === "error") {
      notice =
        "Signing you in from Cloudflare failed on our side. Try again in a moment, or use your operator password.";
    }
    if (state.pickerAllowed) {
      picker = <DevOperatorPicker operators={await listPickerOperators()} next={next} />;
    }
  }

  return (
    <>
      <h1 className="mb-2 text-center font-display text-[1.9rem] font-extrabold text-ink">
        {IS_CONSOLE ? "Console sign-in" : "Welcome back"}
      </h1>
      <p className="mb-7 text-center text-[1rem] text-ink-soft">
        {IS_CONSOLE
          ? "Operator accounts only. Student credentials are refused here."
          : "Pick up where you left off."}
      </p>
      <FormNotice message={notice} />
      {picker}
      <SigninForm
        next={next}
        googleAvailable={GOOGLE_OAUTH !== null}
        signupAvailable={!IS_CONSOLE}
      />
    </>
  );
}

import { redirect } from "next/navigation";

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
 * **The copy is surface-aware and nothing else is** (ADR-0014). The same form
 * posts to the same `/api/auth/login`, which authenticates against `operators`
 * rather than `accounts` when `AINEXT_SURFACE=admin` and refuses a student
 * credential there with `permission_denied` (FR-2205). One endpoint, one code
 * path, two tables — the page only says which door this is.
 */
export default async function SigninPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);

  const me = await currentPrincipal();
  if (me.kind === "student") redirect(next);
  // On the console an operator who is already signed in is sent on for the
  // same reason: the form would be a screen they do not need.
  if (me.kind === "operator") redirect(next);

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
      <SigninForm
        next={next}
        googleAvailable={GOOGLE_OAUTH !== null}
        signupAvailable={!IS_CONSOLE}
      />
    </>
  );
}

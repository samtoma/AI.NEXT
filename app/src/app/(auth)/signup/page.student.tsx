import { redirect } from "next/navigation";

import { SignupForm } from "@/components/auth/SignupForm";
import { safeNext } from "@/components/auth/next-param";
import { currentPrincipal } from "@/lib/auth/principal";
import { GOOGLE_OAUTH } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata = { title: "Create an account — Noor" };

/**
 * /signup — the only door into the product (FR-2001: one account, one student).
 *
 * A student who is already signed in is sent on rather than offered a second
 * account: an account holds exactly one student, so "create another" from a
 * live session is a dead end the form cannot deliver.
 *
 * Google availability is a server fact, handed down as a boolean. The client
 * id never reaches the browser from here — it reaches it from Google's own
 * redirect, which is the only place it belongs.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);

  const me = await currentPrincipal();
  if (me.kind === "student") redirect(next);

  return (
    <>
      <h1 className="mb-2 text-center font-display text-[1.9rem] font-extrabold text-ink">
        Let&apos;s get you started
      </h1>
      <p className="mb-7 text-center text-[1rem] text-ink-soft">
        A few things about you, and Noor can start where you actually are.
      </p>
      <SignupForm next={next} googleAvailable={GOOGLE_OAUTH !== null} />
    </>
  );
}

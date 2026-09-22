import { ResendVerification } from "@/components/auth/ResendVerification";
import { TertiaryLink } from "@/components/auth/Controls";

export const dynamic = "force-dynamic";

export const metadata = { title: "Confirm your email — Noor" };

/**
 * /verify — the two things that can be true about a confirmation link.
 *
 * `GET /api/auth/verify` never renders anything itself: it spends the token
 * and answers 302 either to `/student` (it worked) or to `/verify?state=expired`
 * (it did not). That redirect is the reason this page exists, and the reason
 * it says nothing about **whose** address the token belonged to — an observer
 * who guessed a token learns only whether it worked (FR-2004).
 *
 * "Expired" here covers expired, already-spent and never-valid alike. To the
 * person reading the screen those are one fact — this link doesn't work, ask
 * for another — and inventing three messages would be inventing three
 * distinctions an attacker could read.
 *
 * With no state parameter this is the "we've sent it, go and look" screen a
 * student lands on from the shell. Both variants carry the same resend, always
 * available and never behind a countdown (ADR-0013).
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string | string[] }>;
}) {
  const sp = await searchParams;
  const state = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  const expired = state === "expired";

  return (
    <>
      <h1 className="mb-2 text-center font-display text-[1.9rem] font-extrabold text-ink">
        {expired ? "That link has expired" : "Check your email"}
      </h1>
      <p className="mb-7 text-center text-[1rem] text-ink-soft">
        {expired
          ? "Confirmation links only work once, and only for a day. Here's a fresh one."
          : "We sent you a link to confirm your address. Open it and you're set."}
      </p>

      <ResendVerification idPrefix="verify" />

      <div className="mt-8 border-t border-line-soft pt-4">
        <p className="text-[0.95rem] text-ink-soft">
          Nothing in the inbox? Look in junk or promotions — it arrives from
          Noor and has nothing but the link in it.
        </p>
        <div className="mt-2">
          <TertiaryLink href="/signin">Back to sign in</TertiaryLink>
        </div>
      </div>
    </>
  );
}

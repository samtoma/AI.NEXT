import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { TertiaryLink } from "@/components/auth/Controls";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Set a new password — Noor",
  // The URL of this page carries a single-use credential. Nothing should be
  // asking a crawler to come and fetch it.
  robots: { index: false, follow: false },
};

/**
 * /reset-password?token=… — the one page in the product whose URL is a secret.
 *
 * The token is read here and handed to the form as a **prop**, so it travels
 * from there in a request body. It is never put back into a URL: `lib/mail.ts`
 * builds the only link that contains it, and nothing on this side constructs
 * another — not the success state, not a redirect, not an analytics call. A
 * token in a URL we build lands in a Referer header and a server log, and this
 * one is worth a password.
 *
 * An absent token is answered here rather than by the endpoint, because a form
 * that can only fail is worse than a sentence explaining why.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const sp = await searchParams;
  const token = (Array.isArray(sp.token) ? sp.token[0] : sp.token) ?? "";

  if (!token) {
    return (
      <>
        <h1 className="mb-2 text-center font-display text-[1.9rem] font-extrabold text-ink">
          This link is incomplete
        </h1>
        <p className="mb-7 text-center text-[1rem] text-ink-soft">
          Open the link from the email exactly as it arrived, or ask for a new
          one.
        </p>
        <div className="flex justify-center">
          <TertiaryLink href="/forgot-password">Send me a new link</TertiaryLink>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-2 text-center font-display text-[1.9rem] font-extrabold text-ink">
        Pick a new password
      </h1>
      <p className="mb-7 text-center text-[1rem] text-ink-soft">
        Then sign in with it. This link only works once.
      </p>
      <ResetPasswordForm token={token} />
    </>
  );
}

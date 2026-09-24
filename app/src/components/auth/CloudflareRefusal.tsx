import { FormError, TertiaryLink } from "./Controls";

/**
 * The console's answer to a Cloudflare identity it has no operator for
 * (ADR-0022, FR-3303).
 *
 * Cloudflare has proven who this is; the console has no account for that
 * address (or has one that is switched off). So: no session, no form, and a
 * plain sentence saying which. **No password form here, on purpose.** With a
 * verified identity at the keyboard, a password session for a different
 * operator would be ended on its very next request — the proven person wins
 * (FR-3305) — so offering the form would offer a door that closes behind you.
 *
 * The one way forward that is real is signing out of Cloudflare and back in as
 * the address that does have an account, so that is the link. The refusal has
 * already been recorded by the sign-in route before this renders.
 *
 * Server Component; the two controls it borrows are the auth screens' own.
 */
export function CloudflareRefusal({
  kind,
  email,
  logoutUrl,
}: {
  kind: "no_account" | "disabled";
  email: string | null;
  logoutUrl: string | null;
}) {
  const who = email ? <strong className="font-bold text-ink">{email}</strong> : "this address";
  return (
    <>
      <h1 className="mb-2 text-center font-display text-[1.9rem] font-extrabold text-ink">
        {kind === "disabled"
          ? "This console account is switched off"
          : "This Cloudflare identity has no console account"}
      </h1>
      <FormError
        message={
          kind === "disabled"
            ? "Cloudflare has confirmed who you are, and your operator account is disabled. Nothing was signed in."
            : "Cloudflare has confirmed who you are, and there is no operator account for that address. Nothing was signed in."
        }
      />
      <p className="mb-5 text-[1rem] leading-relaxed text-ink-soft">
        You are signed in to Cloudflare as {who}. Operator accounts are created by hand — ask
        Samuel to add this address, or sign out of Cloudflare and come back with the address that
        has an account. This attempt was recorded.
      </p>
      {logoutUrl && (
        <div className="flex justify-center">
          <TertiaryLink href={logoutUrl}>Sign out of Cloudflare</TertiaryLink>
        </div>
      )}
    </>
  );
}

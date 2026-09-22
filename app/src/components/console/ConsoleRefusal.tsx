/**
 * What a refused console page renders — which is **nothing of the page**.
 *
 * Not a preview, not a length, not a count, not a heading with an empty table
 * under it (contracts/authorization.md, spec edge cases). The refusal says only
 * that the answer exists and is not this operator's to see, and names the role
 * that would have admitted them so the next step is "ask for that role" rather
 * than "reload and hope".
 *
 * No reason string reaches here from the seam. The server-side `reason` goes to
 * `auth_events` and stays there; this component is handed a code and a list of
 * role names that are already public in the product's own vocabulary.
 */

export function ConsoleRefusal({
  status,
  roles,
}: {
  status: 401 | 403;
  /** The role(s) that would admit. Empty for the shell itself. */
  roles?: readonly string[];
}) {
  const unauthenticated = status === 401;

  return (
    <main className="mx-auto w-full max-w-[42rem] px-6 py-16">
      <div
        className="rounded-xl border px-5 py-4"
        style={{ borderColor: "var(--line)", background: "var(--card)" }}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          {status} · {unauthenticated ? "Not signed in" : "Not permitted"}
        </p>
        <h1 className="mt-2 font-display text-[22px] font-bold text-ink">
          {unauthenticated ? "Sign in to use the console" : "You do not hold the role for this"}
        </h1>
        <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-ink-soft">
          {unauthenticated ? (
            <>This build is the operator console. Sign in with an operator account to continue.</>
          ) : (
            <>
              Your account is signed in, and this surface is not one of the ones it is permitted.
              Nothing from it has been loaded or rendered.
            </>
          )}
        </p>
        {!unauthenticated && roles !== undefined && roles.length > 0 && (
          <p className="mt-3 font-mono text-[12px] text-ink-faint">
            Needs: {roles.join(" or ")}
          </p>
        )}
        <p className="mt-4 text-[13px] text-ink-faint">
          This attempt was recorded. Roles are granted deliberately and by hand — there is no
          screen that hands them out (ADR-0014).
        </p>
      </div>
    </main>
  );
}

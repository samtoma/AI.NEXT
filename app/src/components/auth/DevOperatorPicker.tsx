import type { PickerOperator } from "@/lib/auth/dev-picker";

/**
 * "Sign in as <operator>" — LOCAL DEVELOPMENT ONLY (ADR-0022, FR-3309).
 *
 * Rendered by `/signin` on the console only after all three of the picker's
 * locks have opened (`lib/auth/dev-picker.ts`), and each button posts to an
 * endpoint that checks the same three again and does not exist in a production
 * build at all. This component is therefore never the thing standing between a
 * visitor and an operator session; it is only the shortcut.
 *
 * Plain forms, no script: a server-rendered list, one POST per operator. The
 * dashed border and the "local development" label are there so a screenshot of
 * this page can never be mistaken for the real console's sign-in.
 */
export function DevOperatorPicker({
  operators,
  next,
}: {
  operators: PickerOperator[];
  next: string;
}) {
  return (
    <section
      aria-labelledby="dev-picker-heading"
      className="mb-7 rounded-[14px] border-[3px] border-dashed border-ink px-4 py-4"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        Local development only
      </p>
      <h2 id="dev-picker-heading" className="mt-1 font-display text-[1.1rem] font-bold text-ink">
        Sign in as an operator
      </h2>
      <p className="mt-1 text-[0.9rem] leading-relaxed text-ink-soft">
        No password, because there is no Cloudflare here to prove who you are. This list exists
        only on localhost with <code className="font-mono">AINEXT_DEV_OPERATOR_PICKER=on</code>,
        never in a production build. Each sign-in is recorded as <code className="font-mono">dev-picker</code>.
      </p>
      {operators.length === 0 ? (
        <p className="mt-3 text-[0.9rem] text-ink-soft">
          No active operators yet — run <code className="font-mono">npm run bootstrap:operator</code>.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {operators.map((op) => (
            <li key={op.id}>
              <form method="post" action="/api/auth/dev-operator">
                <input type="hidden" name="operatorId" value={op.id} />
                <input type="hidden" name="next" value={next} />
                <button
                  type="submit"
                  className="ds-control play-pressable flex w-full flex-col items-start gap-0.5 rounded-[14px] border-[3px] border-ink bg-card px-4 py-2.5 text-start"
                >
                  <span className="block w-full text-start font-display text-[1rem] font-bold text-ink">
                    Sign in as {op.displayName || op.email}
                  </span>
                  <span className="block w-full text-start font-mono text-[11px] text-ink-faint">
                    {op.email} · operator #{op.id} ·{" "}
                    {op.roles.length > 0 ? op.roles.join(" · ") : "no roles"}
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

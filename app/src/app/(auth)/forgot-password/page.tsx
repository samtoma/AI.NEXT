import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Forgot your password — Noor" };

/**
 * /forgot-password — one field, one answer, whoever asks.
 *
 * The endpoint behind it returns the same 202 for a registered address, an
 * unregistered one, a Google-only account and a disabled one (FR-2010), so
 * this screen has exactly one outcome and phrases it as a conditional. The
 * copy is the security property, not decoration around it.
 */
export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-2 text-center font-display text-[1.9rem] font-extrabold text-ink">
        Forgot your password?
      </h1>
      <p className="mb-7 text-center text-[1rem] text-ink-soft">
        Happens to everyone. Tell us the address you used.
      </p>
      <ForgotPasswordForm />
    </>
  );
}

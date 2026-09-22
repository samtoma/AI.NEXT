"use client";

import { useState } from "react";

import {
  Field,
  FormError,
  OFFLINE_MESSAGE,
  PrimaryButton,
  TertiaryLink,
  TextInput,
} from "./Controls";

/**
 * Ask for a reset link.
 *
 * `POST /api/auth/forgot-password` answers **202 for every address** —
 * registered, unregistered, Google-only, disabled — with the same body and
 * (deliberately) the same timing (FR-2010). So this screen has exactly one
 * success state and it is phrased as a conditional: "if that address has an
 * account". Any copy here that said "we've sent you an email" would turn a
 * carefully identical response into an account-enumeration oracle in the UI
 * layer, which is the easiest place in the whole system to give it away.
 */

export function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const data = new FormData(e.currentTarget);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(data.get("email") ?? "") }),
      });
      setSent(true);
    } catch {
      setError(OFFLINE_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div role="status" aria-live="polite">
        <p className="text-[1.05rem] text-ink">
          If that address has an account, a link to set a new password is on its
          way. It works once and lasts an hour.
        </p>
        <p className="mt-3 text-[0.95rem] text-ink-soft">
          Nothing arrived? Check the junk folder, then try again.
        </p>
        <div className="mt-5">
          <TertiaryLink href="/signin">Back to sign in</TertiaryLink>
        </div>
      </div>
    );
  }

  return (
    <>
      <FormError message={error} />
      <form onSubmit={onSubmit} noValidate>
        <Field
          id="email"
          label="Email"
          hint="We'll send a link to set a new one."
        >
          <TextInput
            id="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            hint
          />
        </Field>
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send me a link"}
        </PrimaryButton>
      </form>
      <div className="mt-6">
        <TertiaryLink href="/signin">Back to sign in</TertiaryLink>
      </div>
    </>
  );
}

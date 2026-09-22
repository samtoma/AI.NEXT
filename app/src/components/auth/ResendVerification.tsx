"use client";

import { useState } from "react";

import {
  Field,
  FormNotice,
  OFFLINE_MESSAGE,
  PrimaryButton,
  TextInput,
} from "./Controls";

/**
 * Send the confirmation email again — **the anonymous path**.
 *
 * A signed-in student never sees this form: the banner and the outstanding
 * screen use `SessionResend`, which posts an empty body and lets the server
 * resolve the address from the access cookie. This one exists for the case it
 * was always for — somebody who never got the first mail, is not signed in,
 * and has nothing to go on but the address they typed at signup (ADR-0013
 * Consequences). That is the only reason to ask for an email at all.
 *
 * The answer is always the same 202 whatever the address is (FR-2005), so the
 * acknowledgement below never says whether an account was found. It is worded
 * as a conditional on purpose, and that wording is the security property.
 *
 * Always available, never behind a countdown. The throttle lives on the
 * server, where it cannot be cleared by reloading the page.
 */

const SENT_MESSAGE =
  "If that address has an account waiting to be confirmed, the link is on its way. Check your junk folder too.";

export function ResendVerification({
  idPrefix = "resend",
}: {
  idPrefix?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = `${idPrefix}-email`;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const data = new FormData(e.currentTarget);
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(data.get("email") ?? "") }),
      });
      // 202 is the only answer this endpoint gives. Anything else is a
      // transport problem, and a student who retries is doing no harm.
      setSent(true);
    } catch {
      setError(OFFLINE_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p role="status" aria-live="polite" className="text-[1rem] text-ink">
        {SENT_MESSAGE}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-2">
      {error && <FormNotice message={error} />}
      <Field id={fieldId} label="The email you signed up with">
        <TextInput
          id={fieldId}
          name="email"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      </Field>
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send the link again"}
      </PrimaryButton>
    </form>
  );
}

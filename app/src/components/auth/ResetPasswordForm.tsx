"use client";

import { useState } from "react";

import {
  Field,
  FormError,
  OFFLINE_MESSAGE,
  PrimaryButton,
  TertiaryLink,
  TextInput,
  messageFor,
} from "./Controls";
import { MIN_PASSWORD_LENGTH } from "./password-rule";

/**
 * Set a new password with the token from the email.
 *
 * The token arrives in the address bar (that is what a mail link is) and goes
 * out in a **request body** — it is never written into a URL this code builds,
 * never into the success redirect, and never into an analytics call. A token
 * in a URL we construct ends up in a Referer header, a server log and the
 * browser's history, and this one is worth a password.
 *
 * Success revokes every session for the account, including this browser's, and
 * the endpoint clears both cookies on the way out. That is stated on the
 * screen rather than discovered on the next tab: "signed out everywhere" is a
 * surprise if it happens silently and a reassurance if it is announced.
 *
 * The enumeration defence does not apply here (contracts/auth.md): by this
 * point the token is the secret, so a dead link says so plainly instead of
 * stranding whoever is holding it.
 */

export function ResetPasswordForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setFieldError(null);

    const data = new FormData(e.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");

    // Checked here and nowhere else: the server has one password, so a typo
    // that both fields share is the one thing only this screen can catch.
    if (password !== confirm) {
      setFieldError("These two don't match. Type it again.");
      setBusy(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (res.ok) {
        setDone(true);
        return;
      }

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        field?: string;
      };
      const message = messageFor(body.error, {});
      if (body.field === "password") setFieldError(message);
      else setError(message);
    } catch {
      setError(OFFLINE_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" aria-live="polite">
        <p className="text-[1.05rem] text-ink">
          Done — that&apos;s your new password.
        </p>
        <p className="mt-3 text-[0.95rem] text-ink-soft">
          We signed you out everywhere on purpose, including here. Sign in again
          with the new one.
        </p>
        <a
          href="/signin"
          className="play-pressable mt-6 flex w-full min-h-[56px] items-center justify-center rounded-[20px] border-[3px] border-ink px-6 font-display text-[1.15rem] font-bold sticker-shadow"
          style={{
            background: "var(--noor-action, #f0a22f)",
            color: "var(--noor-on-action, #241f3d)",
          }}
        >
          Sign in
        </a>
      </div>
    );
  }

  return (
    <>
      <FormError message={error} />
      <form onSubmit={onSubmit} noValidate>
        <Field
          id="password"
          label="New password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={fieldError}
        >
          <TextInput
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            hint
            error={fieldError}
          />
        </Field>

        <Field id="confirm" label="Type it once more">
          <TextInput
            id="confirm"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </Field>

        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Saving…" : "Set my new password"}
        </PrimaryButton>
      </form>

      <div className="mt-6">
        <TertiaryLink href="/forgot-password">
          Link stopped working? Ask for another
        </TertiaryLink>
      </div>
    </>
  );
}

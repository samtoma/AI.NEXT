"use client";

import { useEffect, useRef, useState } from "react";

import {
  Field,
  FormError,
  OFFLINE_MESSAGE,
  PrimaryButton,
  TertiaryLink,
  TextInput,
  messageFor,
} from "./Controls";
import { safeNext } from "./next-param";
import { GoogleButton } from "./GoogleButton";

/**
 * Sign in — but try NOT to, first.
 *
 * **The silent refresh is the point of this component.** `ainext_at` lives
 * fifteen minutes and `ainext_rt` is scoped to `Path=/api/auth`, so a student
 * who left the tab open over lunch presents no access cookie to the proxy and
 * gets bounced here even though her sign-in is good for another six days
 * (`proxy.ts` states this edge; I2b's report item 10). A page cannot see the
 * refresh cookie — that is what HttpOnly means — but a request to
 * `/api/auth/refresh` carries it, because that path is exactly what the cookie
 * is scoped to. So the first thing this page does is ask: one POST, and on a
 * 200 the student is already back where she was going and never sees a form.
 *
 * The form is held back for the length of that request rather than rendered
 * and then yanked away mid-keystroke, with a ceiling on the wait: a refresh
 * endpoint that is slow must cost the student a second, not the ability to
 * sign in. No spinner — the system has none, and this is under a second.
 *
 * On failure nothing is said about it. A refresh that does not work means "not
 * signed in", which is the state this page already assumes.
 */

const REFRESH_CEILING_MS = 1500;

export function SigninForm({
  next,
  googleAvailable,
  signupAvailable = true,
}: {
  next: string;
  googleAvailable: boolean;
  /**
   * False on the console build, where `/signup` is not a route at all (ADR-0014,
   * contracts/auth.md "Operator authentication": operators are seeded or
   * granted, never self-registered). Decided on the server and passed down as a
   * boolean, exactly as `googleAvailable` is — a link to a 404 is worse than no
   * link, and this one would also imply a door into the console that does not
   * and must not exist.
   */
  signupAvailable?: boolean;
}) {
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const started = useRef(false);

  const destination = safeNext(next);

  useEffect(() => {
    // Strict Mode double-invokes effects in development; a second refresh POST
    // rotates the token again and is harmless, but the ref keeps the log clean
    // and the navigation single.
    if (started.current) return;
    started.current = true;

    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        setChecking(false);
      }
    };
    const ceiling = setTimeout(done, REFRESH_CEILING_MS);

    void fetch("/api/auth/refresh", { method: "POST" })
      .then((res) => {
        if (res.ok) {
          // A full navigation, not router.replace(): the cookies this response
          // set have to be on the NEXT server render, and a soft navigation can
          // serve a cached RSC payload rendered without them.
          window.location.replace(destination);
          return;
        }
        done();
      })
      .catch(done)
      .finally(() => clearTimeout(ceiling));

    return () => clearTimeout(ceiling);
  }, [destination]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(data.get("email") ?? ""),
          password: String(data.get("password") ?? ""),
        }),
      });

      if (res.ok) {
        window.location.assign(destination);
        return;
      }

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        field?: string;
        retryAfter?: number;
        until?: string;
      };
      const message = messageFor(body.error, body);
      if (body.field) setFieldErrors({ [body.field]: message });
      else setError(message);
    } catch {
      setError(OFFLINE_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <p className="py-8 text-center text-[1.05rem] text-ink-soft">
        One second — seeing if you&apos;re already signed in…
      </p>
    );
  }

  return (
    <>
      <FormError message={error} />

      <form onSubmit={onSubmit} noValidate>
        <Field id="email" label="Email" error={fieldErrors.email}>
          <TextInput
            id="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            error={fieldErrors.email}
          />
        </Field>

        <Field id="password" label="Password" error={fieldErrors.password}>
          <TextInput
            id="password"
            type="password"
            autoComplete="current-password"
            required
            error={fieldErrors.password}
          />
        </Field>

        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Signing you in…" : "Sign in"}
        </PrimaryButton>
      </form>

      <div className="mt-4">
        <GoogleButton available={googleAvailable} />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4">
        <TertiaryLink href="/forgot-password">Forgot your password?</TertiaryLink>
        {signupAvailable && <TertiaryLink href="/signup">Create an account</TertiaryLink>}
      </div>
    </>
  );
}

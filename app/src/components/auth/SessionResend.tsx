"use client";

import { useState } from "react";

import { OFFLINE_MESSAGE } from "./Controls";

/**
 * Resend the confirmation email to **the address already on the account**.
 *
 * One button, no field, no body: `POST /api/auth/resend-verification` with a
 * valid `ainext_at` resolves the address from the principal server-side. A
 * signed-in student should never have to retype an email the server already
 * holds — and the address still never makes the round trip in either
 * direction, which is why `/api/auth/me` can keep refusing to return it.
 *
 * **No status branching.** The endpoint answers 202 to everything — already
 * verified, throttled, mail server down — because a status that distinguished
 * those cases would distinguish them to anyone who could reach the endpoint
 * (FR-2005). So every response gets the same sentence. A network failure is
 * not a response and says so, because an offline phone is the one case where
 * "sent" would be a lie the student can act on.
 *
 * The anonymous path — somebody who never got the first mail and is not signed
 * in — keeps the email-bearing form on `/verify`. That is the case the field
 * exists for, and the only one.
 */

const SENT_MESSAGE = "Sent. Check your inbox, and the junk folder too.";

export function SessionResend({
  variant = "banner",
}: {
  /** "banner" is the pill in the shell; "primary" is the amber CTA on /student. */
  variant?: "banner" | "primary";
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/auth/resend-verification", { method: "POST" });
      setSent(true);
    } catch {
      setError(OFFLINE_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p
        role="status"
        aria-live="polite"
        className={
          variant === "primary"
            ? "text-[1rem] text-ink"
            : "text-[0.95rem] font-semibold text-ink"
        }
      >
        {SENT_MESSAGE}
      </p>
    );
  }

  const label = busy ? "Sending…" : "Send the email again";

  return (
    <div>
      <button
        type="button"
        onClick={resend}
        disabled={busy}
        className={
          variant === "primary"
            ? "play-pressable w-full min-h-[56px] rounded-[20px] border-[3px] border-ink px-6 font-display text-[1.15rem] font-bold sticker-shadow"
            : "play-pressable min-h-[52px] rounded-[999px] border-[3px] border-ink bg-card px-4 font-display text-[0.95rem] font-bold text-ink sticker-shadow-sm"
        }
        style={
          variant === "primary"
            ? {
                background: "var(--noor-action, #f0a22f)",
                color: "var(--noor-on-action, #241f3d)",
              }
            : undefined
        }
      >
        {label}
      </button>
      {error && (
        <p
          role="alert"
          className="mt-1.5 text-[0.85rem] font-semibold"
          style={{ color: "var(--play-text-amber-warm, #8a4208)" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

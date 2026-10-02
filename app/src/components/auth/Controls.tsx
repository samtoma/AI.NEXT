"use client";

/**
 * The five auth screens share one set of controls, and one vocabulary for
 * saying no.
 *
 * **The copy in `messageFor` is a translation, never an elaboration.** The
 * server answers with a CODE — `invalid_credentials`, `email_unavailable` —
 * chosen so that a client cannot learn more than the code carries (FR-2005,
 * FR-2010). Turning `invalid_credentials` into "we don't know that email" or
 * "wrong password" would undo the whole design: those two cases are one code
 * on purpose, and they get one sentence here. The map below is the only place
 * a code becomes English, so a future "helpful" message has exactly one file
 * to get past.
 *
 * Noor Play anatomy (docs/design/handoffs/noor-play): 3px ink outlines, hard
 * offset shadows, 52px minimum targets on mouse and touch alike, and **no red
 * anywhere** — a refusal is ink on Honey, which is the palette's whole answer
 * to "something is wrong" (constitution XII, FR-1002/FR-1005). A fourteen-
 * year-old who mistypes a password is not being warned, they are being asked
 * to try again.
 */

import type { ReactNode } from "react";

/* ---------------------------------------------------------------- copy ---- */

/** What the server said, turned into one sentence. Never more specific. */
export function messageFor(
  code: string | undefined,
  extra?: { retryAfter?: number; until?: string }
): string {
  switch (code) {
    // --- credentials -------------------------------------------------------
    case "invalid_credentials":
      // ONE sentence for "no such account" and "wrong password" alike.
      return "That email and password don't go together. Check both and try again.";
    case "locked":
      return extra?.until
        ? `Too many tries. You can try again after ${clockTime(extra.until)}.`
        : "Too many tries. Give it a few minutes and try again.";
    case "disabled":
      return "This account is switched off. Ask whoever set it up for you.";
    case "permission_denied":
      return "This sign-in doesn't work here.";
    case "too_many_requests":
      return `That's a lot of tries. Wait ${minutesish(extra?.retryAfter)} and have another go.`;

    // --- signup fields -----------------------------------------------------
    case "invalid_email":
      return "That doesn't look like an email address.";
    case "email_unavailable":
      return "That email can't be used here. If the account is yours, sign in instead.";
    case "password_too_short":
      return "Passwords need at least 8 characters.";
    case "password_too_long":
      return "That password is too long — 256 characters is the limit.";
    case "password_matches_email":
      return "Pick something that isn't just your email name.";
    case "invalid_display_name":
      return "Give us a name between 2 and 40 letters.";
    case "invalid_grade":
      return "Pick your grade.";
    case "invalid_gender":
      return "Pick one of the options, or leave it.";

    // --- curriculum and the first-Google-sign-in step (feature 003) ----------
    case "curriculum_required":
      // Also what a student reads when an operator changed what her grade
      // offers after the page loaded: the options are refreshed, and she picks.
      return "Pick the curriculum your school follows.";
    case "invalid_curriculum":
      return "Pick one of the curricula shown.";
    case "onboarding_already_completed":
      return "You've already set this up. Your lessons are ready.";
    case "onboarding_pending":
      return "Tell Noor your grade first, and your lessons are ready.";

    // --- tokens ------------------------------------------------------------
    case "invalid_token":
      return "This link doesn't work any more. Ask for a new one.";
    case "email_unverified":
      return "Confirm your email first — the link is in your inbox.";
    case "unauthenticated":
      return "You're signed out. Sign in and try again.";

    // --- everything else ---------------------------------------------------
    case "server_error":
      return "Something broke on our side, not yours. Try again in a moment.";
    default:
      return "That didn't work. Try again in a moment.";
  }
}

/** "13:40" — a wall clock, because "in 900 seconds" is not a thing anyone reads. */
function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "a few minutes";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function minutesish(seconds: number | undefined): string {
  if (!seconds || seconds < 60) return "a minute";
  const m = Math.ceil(seconds / 60);
  return m === 1 ? "a minute" : `${m} minutes`;
}

/** The network itself failing is not the server saying no — say so differently. */
export const OFFLINE_MESSAGE =
  "Couldn't reach Noor. Check your connection and try again.";

/* ------------------------------------------------------------- controls --- */

const INPUT_BASE =
  "w-full min-h-[52px] rounded-[14px] border-[3px] border-ink bg-card px-4 " +
  "text-[1.05rem] text-ink placeholder:text-ink-faint";

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="mb-5">
      <label
        htmlFor={id}
        className="mb-1.5 block font-display text-[0.95rem] font-bold text-ink"
      >
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mb-1.5 text-[0.85rem] text-ink-soft">
          {hint}
        </p>
      )}
      {children}
      {/* The field's own error is polite, not assertive: the form-level banner
          is the one that announces. Two assertive regions on one submit talk
          over each other in a screen reader. */}
      <p
        id={`${id}-error`}
        aria-live="polite"
        className="mt-1.5 min-h-[1.15rem] text-[0.85rem] font-semibold"
        style={{ color: "var(--play-text-amber-warm, #8a4208)" }}
      >
        {error ?? ""}
      </p>
    </div>
  );
}

export function TextInput({
  id,
  error,
  hint,
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  error?: string | null;
  hint?: boolean;
}) {
  return (
    <input
      {...rest}
      id={id}
      name={rest.name ?? id}
      aria-invalid={error ? true : undefined}
      aria-describedby={
        [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
          .filter(Boolean)
          .join(" ") || undefined
      }
      className={`${INPUT_BASE} ${className}`}
      // A field that was refused fills Honey and keeps its ink outline. The
      // outline never changes colour, because the only colour it could change
      // to is the one this palette does not have.
      style={error ? { background: "var(--card-warm)" } : undefined}
    />
  );
}

export function SelectInput({
  id,
  error,
  hint,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  error?: string | null;
  hint?: boolean;
  children: ReactNode;
}) {
  return (
    <select
      {...rest}
      id={id}
      name={rest.name ?? id}
      aria-invalid={error ? true : undefined}
      aria-describedby={
        [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
          .filter(Boolean)
          .join(" ") || undefined
      }
      className={INPUT_BASE}
      style={error ? { background: "var(--card-warm)" } : undefined}
    >
      {children}
    </select>
  );
}

/**
 * The form-level refusal. `role="alert"` so it is spoken the moment it
 * appears — this is the one message that explains why nothing happened.
 */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-5 rounded-[14px] border-[3px] border-ink px-4 py-3 text-[0.95rem] font-semibold text-ink sticker-shadow-sm"
      style={{ background: "var(--card-warm)" }}
    >
      {message}
    </div>
  );
}

/** Something went right. Same anatomy, Honey again — the palette is warm either way. */
export function FormNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-5 rounded-[14px] border-[3px] border-ink px-4 py-3 text-[0.95rem] font-semibold text-ink sticker-shadow-sm"
      style={{ background: "var(--card-warm)" }}
    >
      {message}
    </div>
  );
}

/** Amber, ink text, alone on the screen. Never white on amber. */
export function PrimaryButton({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`play-pressable w-full min-h-[56px] rounded-[20px] border-[3px] border-ink px-6 font-display text-[1.15rem] font-bold sticker-shadow ${className}`}
      style={{
        background: "var(--noor-action, #f0a22f)",
        color: "var(--noor-on-action, #241f3d)",
      }}
    >
      {children}
    </button>
  );
}

/** White fill, ink text. The second thing on a screen, never the first. */
export function SecondaryButton({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`play-pressable min-h-[52px] rounded-[20px] border-[3px] border-ink bg-card px-5 font-display text-[1.05rem] font-bold text-ink sticker-shadow-sm ${className}`}
    >
      {children}
    </button>
  );
}

/** No border, no shadow, 52px all the same. */
export function TertiaryLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="inline-flex min-h-[52px] items-center font-display text-[0.95rem] font-bold underline underline-offset-4"
      style={{ color: "var(--play-text-link, #136386)" }}
    >
      {children}
    </a>
  );
}

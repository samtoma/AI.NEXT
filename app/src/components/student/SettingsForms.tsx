"use client";

import { useState } from "react";

import {
  Field,
  FormError,
  FormNotice,
  OFFLINE_MESSAGE,
  PrimaryButton,
  SecondaryButton,
  SelectInput,
  TextInput,
  messageFor,
} from "@/components/auth/Controls";
import { CurriculumChoice, type CurriculumOption } from "@/components/auth/CurriculumChoice";
import type { CurriculumId } from "@/lib/curricula";

/**
 * The three new sections of `/settings` (FR-2013, FR-4010 as amended
 * 2026-10-27, FR-2310). Each one saves on its own, with an explicit button,
 * and says in words what changed — the page's one-decision-at-a-time rule.
 *
 * Every successful save RELOADS the document rather than refreshing it: a
 * grade change can move the design variant, which lives on `<html data-ds>`,
 * and the nav and header carry her name. A reload is the one way all of it is
 * fresh at once (the same reason `DesignVariantPicker` gives).
 */

async function send(
  url: string,
  method: "POST" | "DELETE",
  body: unknown
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: OFFLINE_MESSAGE };
  }
  if (res.ok) {
    const data = res.status === 204 ? {} : ((await res.json().catch(() => ({}))) as Record<string, unknown>);
    return { ok: true, data };
  }
  const err = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, message: settingsMessage(err.error) };
}

function settingsMessage(code: string | undefined): string {
  switch (code) {
    case "wrong_password":
      return "That isn't your password. Nothing was deleted.";
    case "password_required":
      return "Type your password to confirm.";
    case "confirmation_required":
      return "Type DELETE, in capitals, to confirm.";
    case "unknown_curriculum":
      return "Pick one of the curricula shown.";
    default:
      return messageFor(code);
  }
}

/* ------------------------------------------------------------------ */
/* Name and grade                                                      */
/* ------------------------------------------------------------------ */

export function ProfileSection({
  name,
  grade,
  grades,
}: {
  name: string;
  grade: string;
  /** every grade, labelled in her own curriculum's words (FR-4013) */
  grades: readonly { value: string; label: string }[];
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftGrade, setDraftGrade] = useState(grade);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = draftName.trim() === name && draftGrade === grade;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await send("/api/settings/profile", "POST", {
      displayName: draftName,
      grade: draftGrade,
    });
    if (!res.ok) {
      setError(res.message);
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  return (
    <form onSubmit={save} noValidate>
      <FormError message={error} />
      <Field id="settings-name" label="What should Noor call you?">
        <TextInput
          id="settings-name"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          autoComplete="given-name"
          maxLength={40}
          required
        />
      </Field>
      <Field
        id="settings-grade"
        label="Your grade"
        hint="Your progress stays with each course, so changing grade loses nothing. Change back and it's all there."
      >
        <SelectInput
          id="settings-grade"
          hint
          value={draftGrade}
          onChange={(e) => setDraftGrade(e.target.value)}
        >
          {grades.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </SelectInput>
      </Field>
      <PrimaryButton type="submit" disabled={busy || unchanged}>
        {busy ? "Saving…" : "Save"}
      </PrimaryButton>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Curriculum                                                          */
/* ------------------------------------------------------------------ */

export function CurriculumSection({
  current,
  currentLabel,
  options,
  grade,
  offered,
  courses,
}: {
  current: CurriculumId | null;
  currentLabel: string;
  options: readonly CurriculumOption[];
  grade: string;
  offered: readonly CurriculumId[];
  /** the course labels she would see in each curriculum, at her grade */
  courses: Readonly<Record<string, readonly string[]>>;
}) {
  const [picked, setPicked] = useState<CurriculumId | null>(current);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickedLabel = options.find((o) => o.id === picked)?.label ?? "";

  async function change() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    const res = await send("/api/settings/curriculum", "POST", { curriculum: picked });
    if (!res.ok) {
      setError(res.message);
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  const losing = current ? (courses[current] ?? []) : [];
  const gaining = picked ? (courses[picked] ?? []) : [];

  return (
    <div>
      <FormError message={error} />
      <CurriculumChoice
        options={options}
        value={picked}
        onChange={(id) => {
          setPicked(id);
          setConfirming(false);
        }}
        grade={grade}
        offered={offered}
      />
      {!confirming ? (
        <PrimaryButton
          type="button"
          disabled={!picked || picked === current}
          onClick={() => setConfirming(true)}
        >
          Change curriculum
        </PrimaryButton>
      ) : (
        // In the page, never a browser dialog (FR-2710), and it names what
        // she stops and starts seeing (FR-4010).
        <div
          role="group"
          aria-labelledby="curriculum-confirm-title"
          className="rounded-[14px] border-[3px] border-ink p-4 sticker-shadow-sm"
          style={{ background: "var(--card-warm)" }}
        >
          <p id="curriculum-confirm-title" className="font-display text-[1.05rem] font-bold text-ink">
            Switch from {currentLabel} to {pickedLabel}?
          </p>
          <p className="mt-2 text-[0.95rem] text-ink">
            {losing.length > 0 ? `You'll stop seeing ${listOf(losing)}. ` : ""}
            {gaining.length > 0
              ? `You'll start seeing ${listOf(gaining)}.`
              : `${pickedLabel} has nothing to study for your grade yet.`}
          </p>
          <p className="mt-2 text-[0.95rem] text-ink">
            Your progress is kept. A course you haven&apos;t opened yet starts fresh, and if you
            switch back, everything is exactly where you left it.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <PrimaryButton type="button" className="sm:w-auto" disabled={busy} onClick={change}>
              {busy ? "Switching…" : `Switch to ${pickedLabel}`}
            </PrimaryButton>
            <SecondaryButton type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Keep {currentLabel}
            </SecondaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Deleting the account                                                */
/* ------------------------------------------------------------------ */

export function DeleteAccountSection({
  hasPassword,
  phrase,
}: {
  hasPassword: boolean;
  /** what she types to confirm — passed down so the server owns the word */
  phrase: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await send("/api/settings/account", "DELETE", {
      confirm: typed,
      ...(hasPassword ? { password } : {}),
    });
    if (!res.ok) {
      setError(res.message);
      setBusy(false);
      return;
    }
    setDone(true);
    // The cookies are already cleared; the home page is the signed-out one.
    window.location.assign("/");
  }

  if (done) return <FormNotice message="Your account has been deleted." />;

  if (!open) {
    return (
      <SecondaryButton type="button" onClick={() => setOpen(true)}>
        Delete my account…
      </SecondaryButton>
    );
  }

  return (
    <form onSubmit={remove} noValidate>
      <FormError message={error} />
      <div
        className="mb-5 rounded-[14px] border-[3px] border-ink p-4 text-[0.95rem] text-ink"
        style={{ background: "var(--card-warm)" }}
      >
        <p className="font-display text-[1.05rem] font-bold">This can&apos;t be undone.</p>
        <p className="mt-2">
          Your account, your progress in every course, your chats with Noor and anything you
          uploaded are deleted straight away. You&apos;ll be signed out on every device.
        </p>
      </div>
      {hasPassword && (
        <Field id="delete-password" label="Your password">
          <TextInput
            id="delete-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
      )}
      <Field id="delete-confirm" label={`Type ${phrase} to confirm`}>
        <TextInput
          id="delete-confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
      </Field>
      <div className="flex flex-wrap gap-3">
        <PrimaryButton
          type="submit"
          className="sm:w-auto"
          disabled={busy || typed !== phrase || (hasPassword && password === "")}
        >
          {busy ? "Deleting…" : "Delete my account"}
        </PrimaryButton>
        <SecondaryButton type="button" disabled={busy} onClick={() => setOpen(false)}>
          Keep my account
        </SecondaryButton>
      </div>
    </form>
  );
}

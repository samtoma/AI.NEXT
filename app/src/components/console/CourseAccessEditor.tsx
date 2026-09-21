"use client";

import { useState } from "react";

/**
 * Set, change or clear one student's course-access exception, from the
 * Student 360 (`(console)/students/[id]/page.console.tsx`).
 *
 * Copies `SubscriptionEditor.tsx`'s interaction shape on purpose: local
 * `busy`/`error` state, a POST to the write endpoint, and a full page reload
 * on success rather than a local patch — the page's own read
 * (`lib/catalog-queries.ts` `studentAccess`) is what the console trusts, and a
 * client-side guess at the new `gradeState`/`effectiveState` pairing could
 * disagree with it the moment two operators touch the same student at once.
 *
 * **Three choices, not two.** "Inherit the grade rule" is not the same
 * request as "force hidden" even though a student whose grade rule is already
 * hidden ends up looking identical either way — the FIRST leaves no row
 * behind to later contradict a grade rule that changes, and the second
 * pins this student regardless of what happens to their grade. Collapsing
 * them into one control would make that distinction impossible to ask for.
 * `POST .../courses` reads `state: null` as exactly "inherit" (it deletes the
 * override row rather than writing a third stored value —
 * `lib/catalog-queries.ts setStudentOverride`'s own docblock explains why).
 */

type OverrideChoice = "inherit" | "live" | "hidden";

export function CourseAccessEditor({
  studentId,
  courseId,
  current,
  note,
}: {
  studentId: number;
  courseId: string;
  /** This student's stored override, or `null` when there is none. */
  current: "live" | "hidden" | null;
  note: string | null;
}) {
  const initial: OverrideChoice = current ?? "inherit";
  const [choice, setChoice] = useState<OverrideChoice>(initial);
  const [text, setText] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unchanged = choice === initial && text === (note ?? "");

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/console/students/${studentId}/courses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          state: choice === "inherit" ? null : choice,
          note: text,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(`${res.status} ${body.error ?? "could not save"}`);
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("the console could not reach the server");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <select
        value={choice}
        onChange={(e) => setChoice(e.target.value as OverrideChoice)}
        disabled={busy}
        className="w-40 rounded border border-line bg-card px-2 py-1 text-[12px] text-ink"
      >
        <option value="inherit">Inherit grade rule</option>
        <option value="live">Force live</option>
        <option value="hidden">Force hidden</option>
      </select>
      <input
        type="text"
        value={text}
        maxLength={280}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        placeholder="why (optional)"
        className="w-40 rounded border border-line bg-card px-2 py-1 text-[11.5px] text-ink"
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy || unchanged}
        className="rounded border border-line bg-card px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {error && (
        <p className="max-w-[10rem] text-end text-[11px] leading-snug text-ink">
          Not saved: {error}
        </p>
      )}
    </div>
  );
}

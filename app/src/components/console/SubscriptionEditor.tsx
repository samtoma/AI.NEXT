"use client";

import { useState } from "react";

/**
 * Set a student's commercial status, from the 360 page (FR-2404, FR-2405).
 *
 * **Rendered only for an operator who holds `cost-billing`.** The page decides
 * that from the roles the principal actually holds; hiding it is not the
 * authorisation (FR-2107) — `POST /api/console/students/{id}/subscription`
 * refuses the same request from any other role, and this control existing or
 * not changes nothing about that.
 *
 * **It gates nothing, and the copy says so.** FR-2404 is explicit: the status
 * must not gate access, must not be shown to a student as a plan, and must not
 * be described anywhere as a payment having happened. So the note field is
 * "what you want to remember", never "payment reference", and the sentence
 * under the control is part of the requirement rather than decoration.
 *
 * A full reload after a successful change, not a soft refresh: the page is a
 * server component that read this student's row in the same transaction as its
 * audit entry, and re-rendering half of it from a stale payload is how a
 * console starts disagreeing with itself.
 */

const STATUSES = ["none", "trial", "active", "lapsed"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_HELP: Record<Status, string> = {
  none: "no commercial arrangement recorded",
  trial: "trying the product, nothing agreed",
  active: "an arrangement is current",
  lapsed: "there was one and it has ended",
};

export function SubscriptionEditor({
  studentId,
  current,
  note,
}: {
  studentId: number;
  current: string;
  note: string | null;
}) {
  const [status, setStatus] = useState<Status>(
    (STATUSES as readonly string[]).includes(current) ? (current as Status) : "none"
  );
  const [text, setText] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unchanged = status === current && text === (note ?? "");

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/console/students/${studentId}/subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: text }),
      });
      if (!res.ok) {
        // The code, not a reason a client can mine — and enough for an operator
        // to know whether to retry or to fetch somebody with the role.
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
    <div className="mt-3 border-t border-line-soft pt-3">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">
        Change the commercial status
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="text-[12.5px] text-ink-soft">
          <span className="block">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            disabled={busy}
            className="mt-1 rounded border border-line bg-card px-2 py-1 text-[13px] text-ink"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s} — {STATUS_HELP[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[16rem] flex-1 text-[12.5px] text-ink-soft">
          <span className="block">What you want to remember (optional)</span>
          <input
            type="text"
            value={text}
            maxLength={280}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            placeholder="e.g. agreed with the family on 20 September"
            className="mt-1 w-full rounded border border-line bg-card px-2 py-1 text-[13px] text-ink"
          />
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || unchanged}
          className="rounded border border-line bg-card px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-[12.5px] text-ink">
          Not saved: <span className="font-mono text-[12px]">{error}</span>
        </p>
      )}
      <p className="mt-2 max-w-[78ch] text-[12px] leading-relaxed text-ink-faint">
        This is a note to ourselves. It gates nothing: the student sees no plan, no surface reads
        it, and nothing here records that a payment was made — there is no payment system behind it
        in this release. Your account and the time are recorded with the change.
      </p>
    </div>
  );
}

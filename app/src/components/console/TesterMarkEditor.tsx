"use client";

import { useState } from "react";

/**
 * Mark this student as a test account, or remove the mark — one click either
 * way (ADR-0021). Rendered on the Student 360, which only `student-data`
 * reaches; `POST /api/console/students/{id}/tester` checks the same role.
 *
 * Marking takes an optional note ("Samuel's iPad account"), because a mark
 * found months later with no reason is a mark nobody dares remove. Removing
 * takes none: it is the undo, and an undo that asks questions is one people
 * put off. Either way the operator and the time are recorded by the server
 * from the signed-in principal, and a removed mark stays in the history.
 *
 * Same interaction shape as `CourseAccessEditor`: one POST, then a full reload
 * so the page's own read is what the operator sees.
 */
export function TesterMarkEditor({
  studentId,
  isTester,
}: {
  studentId: number;
  isTester: boolean;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(tester: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/console/students/${studentId}/tester`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tester ? { tester, note } : { tester }),
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
    <div className="mt-3 border-t border-line-soft pt-3">
      {isTester ? (
        <button
          type="button"
          onClick={() => void post(false)}
          disabled={busy}
          className="ds-control play-pressable rounded border border-line bg-card px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
        >
          {busy ? "Removing…" : "Remove the test-account mark"}
        </button>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[16rem] flex-1 text-[12.5px] text-ink-soft">
            <span className="block">Why this is a test account (optional)</span>
            <input
              type="text"
              value={note}
              maxLength={280}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              placeholder="e.g. Samuel's iPad account for trying probing"
              className="ds-field mt-1 w-full rounded border border-line bg-card px-2 py-1 text-[13px] text-ink"
            />
          </label>
          <button
            type="button"
            onClick={() => void post(true)}
            disabled={busy}
            className="ds-control play-pressable rounded border border-line bg-card px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
          >
            {busy ? "Marking…" : "Mark as a test account"}
          </button>
        </div>
      )}
      {error && (
        <p className="mt-2 text-[12.5px] text-ink" role="alert">
          Not saved: <span className="font-mono text-[12px]">{error}</span>
        </p>
      )}
    </div>
  );
}

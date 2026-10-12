"use client";

import { useState } from "react";

/**
 * Change one student's curriculum, from the Student 360 (feature 003:
 * FR-4010…FR-4012; decision 4; contracts/console.md).
 *
 * **It asks in the page before it writes, and the question says what will
 * happen** (FR-4010, FR-2710): which courses she will STOP seeing, which she
 * will START seeing, and that her progress is kept. Never `window.confirm` —
 * an embedded or policy-restricted browser makes that return `false`
 * silently, and a control whose confirmation the surrounding browser can
 * switch off is a control that does not work (`CourseAvailabilityGrid.tsx`
 * found that the hard way). The question is ordinary markup, and the answer is
 * a button.
 *
 * The courses are decided on the SERVER, by the gate's own rule
 * (`curriculumProjection`, `lib/console-queries.ts`), and passed in as names:
 * this component compares two lists and does no availability reasoning of its
 * own, so it cannot promise a student a course the product would not show her.
 *
 * Interaction shape copied from `SubscriptionEditor` and `CourseAccessEditor`:
 * local `busy`/`error` state, one POST, and a full page reload on success —
 * the 360 re-reads the record, the history and the access panel from the
 * server rather than trusting a local patch to agree with them.
 *
 * Rendered only on the Student 360, which only `student-data` reaches; the
 * endpoint refuses every other role on its own (FR-2107 — hiding a control is
 * not the authorisation).
 */

export type CurriculumOption = {
  id: string;
  /** "American" — flat and factual, never a tier (FR-4016) */
  label: string;
  /** her grade in this curriculum's words — "Grade 10" / "Secondary 1" (FR-4013) */
  gradeLabel: string;
  /** the course names she would see under it, decided server-side */
  sees: string[];
};

export function CurriculumEditor({
  studentId,
  stored,
  storedLabel,
  currentSees,
  options,
}: {
  studentId: number;
  /** `students.curriculum_system` as stored — possibly a value the registry does not know */
  stored: string;
  storedLabel: string;
  /** the course names she sees today */
  currentSees: string[];
  options: CurriculumOption[];
}) {
  const known = options.some((o) => o.id === stored);
  const [choice, setChoice] = useState<string>(known ? stored : "");
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = options.find((o) => o.id === choice) ?? null;
  const unchanged = target === null || target.id === stored;

  const stop = target ? currentSees.filter((c) => !target.sees.includes(c)) : [];
  const start = target ? target.sees.filter((c) => !currentSees.includes(c)) : [];
  const keep = target ? target.sees.filter((c) => currentSees.includes(c)) : [];

  async function save() {
    if (busy || !target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/console/students/${studentId}/curriculum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ curriculum: target.id, note }),
      });
      if (!res.ok) {
        // The code, not a reason a client could mine — enough to know whether
        // to reload (409, somebody changed it first) or fetch someone with the role.
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
        Change the curriculum
      </p>

      {!asking ? (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-[12.5px] text-ink-soft">
            <span className="block">Curriculum</span>
            <select
              value={choice}
              onChange={(e) => {
                setChoice(e.target.value);
                setError(null);
              }}
              disabled={busy}
              className="ds-field mt-1 rounded border border-line bg-card px-2 py-1 text-[13px] text-ink"
            >
              {!known && <option value="">{storedLabel} — choose one</option>}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} ({o.id}){o.id === stored ? " — current" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[16rem] flex-1 text-[12.5px] text-ink-soft">
            <span className="block">Why (optional, recorded with the change)</span>
            <input
              type="text"
              value={note}
              maxLength={280}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              placeholder="e.g. the school confirmed it follows the American curriculum"
              className="ds-field mt-1 w-full rounded border border-line bg-card px-2 py-1 text-[13px] text-ink"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setAsking(true);
            }}
            disabled={busy || unchanged}
            className="ds-control play-pressable rounded border border-line bg-card px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
          >
            Change curriculum…
          </button>
        </div>
      ) : (
        target && (
          <div
            role="group"
            aria-label="Confirm the curriculum change"
            className="mt-2 rounded-lg border border-gold bg-gold-wash px-4 py-3"
          >
            <p className="text-[13.5px] font-semibold leading-relaxed text-ink">
              Change this student&rsquo;s curriculum from {storedLabel} to {target.label}?
            </p>
            <ul className="mt-1.5 space-y-1 text-[13px] leading-relaxed text-ink-soft">
              <li>
                <strong className="text-ink">She will stop seeing:</strong>{" "}
                {stop.length > 0 ? stop.join(", ") : "nothing she sees today"}.
              </li>
              <li>
                <strong className="text-ink">She will start seeing:</strong>{" "}
                {start.length > 0 ? start.join(", ") : "nothing new"}.
              </li>
              {keep.length > 0 && (
                <li>
                  <strong className="text-ink">She keeps:</strong> {keep.join(", ")} (an
                  exception, which follows her across curricula).
                </li>
              )}
              {target.sees.length === 0 && (
                <li>
                  {target.label} has no course live for {target.gradeLabel} in this environment, so
                  she will see <strong className="text-ink">no course at all</strong> and the
                  &ldquo;nothing to study yet&rdquo; page until one is switched on for that grade
                  (Courses, the <code className="font-mono text-[12px]">content-review</code> role).
                </li>
              )}
              <li>
                <strong className="text-ink">Nothing is deleted.</strong> Her mastery, answers and
                saved place stay with the course she earned them in, and changing back restores
                them exactly as they are now.
              </li>
              <li>
                The change is recorded with your name, the time
                {note.trim() ? " and your note" : ""}, and it shows in her history below.
              </li>
            </ul>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy}
                className="ds-control play-pressable rounded border border-line bg-card px-2.5 py-1 text-[12.5px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
              >
                {busy ? "Saving…" : `Yes, change to ${target.label}`}
              </button>
              <button
                type="button"
                onClick={() => setAsking(false)}
                disabled={busy}
                className="ds-control-quiet rounded border border-dashed border-line-soft px-2.5 py-1 text-[12.5px] font-semibold text-ink-soft hover:bg-line-soft disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )
      )}

      {error && (
        <p className="mt-2 text-[12.5px] text-ink">
          Not saved: <span className="font-mono text-[12px]">{error}</span>
          {error.startsWith("409") ? " — it was changed already; reload to see it." : null}
        </p>
      )}
      <p className="mt-2 max-w-[78ch] text-[12px] leading-relaxed text-ink-faint">
        Only the console changes a curriculum after sign-up; no student surface offers it. A
        conversation she already has open keeps what it started with until it ends.
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";

/**
 * The Socratic-probing switch on `/teaching` (ADR-0021).
 *
 * Three positions as three radio options, not a select: the one that cannot be
 * chosen has to be SEEN not to be choosable, with the reason beside it —
 * a disabled `<option>` hides both. "Everyone" renders disabled with the lock
 * note while the server's constant says so; the endpoint refuses it anyway
 * (FR-2107 — this rendering is presentation, the 409 is the rule).
 *
 * Interaction shape copied from `SubscriptionEditor`: local busy/error, one
 * POST, a full reload on success so the page's own read — the position, who
 * moved it, the history — is what the operator sees, never a local guess.
 *
 * An operator without `teaching-controls` gets the same three options,
 * disabled, and one sentence naming the role — so the page never offers a
 * control the server would refuse, and never hides that the control exists.
 *
 * **The rows are radio ROWS, not `ds-control`s** (fix pass, 2026-09-24).
 * `.ds-control` is a button's anatomy — the 52px target, the hard shadow —
 * and on a `<label>` it painted the enabled look over a disabled option,
 * because Play's disabled rule matches `[disabled]` and a label never is. The
 * row is the radio-row pattern `SignupForm`'s gender choice uses (a label
 * wrapping a native radio, `has-[:checked]` for the chosen one), and a row
 * whose radio is disabled takes Play's disabled anatomy through
 * `has-[:disabled]`: a dashed `--play-disabled-border` edge,
 * `--play-disabled-text`, no shadow, no press. So a locked "Everyone" — and
 * every row, for an operator without the role — LOOKS unavailable.
 *
 * **Keyboard.** Native radios in one `<fieldset>`: Tab reaches the group,
 * the arrow keys move between ENABLED options and skip a disabled one (the
 * browser's own behaviour for a disabled radio), and the row shows the amber
 * focus ring (`--noor-focus-ring`) while its radio has keyboard focus. There
 * is no `role="radiogroup"`: the fieldset and its legend ARE the group and
 * its name, and a second group role inside them only made screen readers
 * announce the group twice, the inner one without a name.
 */

type Setting = "off" | "testers" | "everyone";

const OPTIONS: { value: Setting; label: string; help: string }[] = [
  {
    value: "off",
    label: "Off",
    help: "A wrong answer reveals its worked solution on the card, as it always has.",
  },
  {
    value: "testers",
    label: "Test accounts only",
    help: "Maths lessons for students marked as test accounts probe first; everyone else is unchanged.",
  },
  {
    value: "everyone",
    label: "Everyone",
    help: "Every student's maths lessons probe first.",
  },
];

export function TeachingSwitch({
  stored,
  canEdit,
  everyoneUnlocked,
  lockNote,
}: {
  /** the position on record (`off` when nobody has chosen one) */
  stored: Setting;
  /** holds `teaching-controls` */
  canEdit: boolean;
  everyoneUnlocked: boolean;
  lockNote: string;
}) {
  const [choice, setChoice] = useState<Setting>(stored);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unchanged = choice === stored;

  async function save() {
    if (busy || unchanged || !canEdit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/console/teaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ probing: choice, note }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        setError(`${res.status} ${body.error ?? "could not save"}${body.reason ? ` — ${body.reason}` : ""}`);
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
    <div>
      <fieldset>
        <legend className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">
          Socratic probing
        </legend>
        <div className="mt-2 flex flex-col gap-2">
          {OPTIONS.map((o) => {
            const locked = o.value === "everyone" && !everyoneUnlocked;
            const disabled = busy || !canEdit || locked;
            return (
              <label
                key={o.value}
                className={
                  "group flex items-start gap-3 rounded border border-line bg-card px-3 py-2 text-start " +
                  "has-[:checked]:bg-card-warm " +
                  "has-[:focus-visible]:shadow-[var(--noor-focus-ring)] " +
                  "has-[:disabled]:cursor-not-allowed has-[:disabled]:border-dashed " +
                  "has-[:disabled]:border-[color:var(--play-disabled-border)] has-[:disabled]:shadow-none " +
                  (disabled ? "" : "play-pressable cursor-pointer hover:bg-line-soft")
                }
              >
                <input
                  type="radio"
                  name="socratic-probing"
                  value={o.value}
                  checked={choice === o.value}
                  onChange={() => setChoice(o.value)}
                  disabled={disabled}
                  aria-describedby={`probing-help-${o.value}`}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--ink)]"
                />
                <span className="flex flex-col">
                  <span className="text-[13.5px] font-semibold text-ink group-has-[:disabled]:text-[color:var(--play-disabled-text)]">
                    {o.label}
                    {o.value === stored && (
                      <span className="ms-2 font-mono text-[10px] font-normal uppercase tracking-[0.08em] text-ink-faint group-has-[:disabled]:text-[color:var(--play-disabled-text)]">
                        on record
                      </span>
                    )}
                  </span>
                  <span
                    id={`probing-help-${o.value}`}
                    className="text-[12.5px] font-normal leading-snug text-ink-soft group-has-[:disabled]:text-[color:var(--play-disabled-text)]"
                  >
                    {/* The reason stays at full contrast: it is the one line
                        on a locked row somebody has to be able to read. */}
                    {locked ? <strong className="text-ink">{lockNote}.</strong> : null}{" "}
                    {o.help}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {canEdit ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="min-w-[16rem] flex-1 text-[12.5px] text-ink-soft">
            <span className="block">Why (optional, kept with the change)</span>
            <input
              type="text"
              value={note}
              maxLength={280}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              aria-describedby="probing-note-hint"
              placeholder="e.g. trying it on the founders' test accounts before Thursday"
              className="ds-field mt-1 w-full rounded border border-line bg-card px-2 py-1 text-[13px] text-ink"
            />
            {/* The history below is readable by every role, including roles
                that may not know who the students are — so the note must
                never be where a child gets named. */}
            <span id="probing-note-hint" className="mt-1 block text-[12px] text-ink-soft">
              Don&rsquo;t name a student — every operator can read this note.
            </span>
          </label>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || unchanged}
            className="ds-control play-pressable rounded border border-line bg-card px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      ) : (
        <p className="mt-3 max-w-[78ch] text-[12.5px] leading-relaxed text-ink-soft">
          Changing this needs the <code className="font-mono text-[12px]">teaching-controls</code>{" "}
          role. You can see where it stands and who moved it last.
        </p>
      )}
      {error && (
        <p className="mt-2 text-[12.5px] text-ink" role="alert">
          Not saved: <span className="font-mono text-[12px]">{error}</span>
        </p>
      )}
    </div>
  );
}

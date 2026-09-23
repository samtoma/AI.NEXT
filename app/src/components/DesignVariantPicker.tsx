"use client";

import { useState } from "react";

import {
  DEFAULT_DESIGN_VARIANT,
  DESIGN_VARIANT_LABELS,
  selectableVariants,
  type DesignVariant,
} from "@/lib/design-variant";

/**
 * The variant switch — one control, used by both surfaces (ADR-0017, FR-1011).
 *
 * ---------------------------------------------------------------------------
 * WHY THREE OPTIONS AND NOT TWO
 * ---------------------------------------------------------------------------
 * The rule and the override are different states, and a two-way toggle
 * collapses them. "Follow my grade" stores NULL — no preference, the
 * Preparatory/Secondary rule decides — while "Play" stores `play`, which is a
 * Secondary student who deliberately chose the younger variant. They can
 * produce the same appearance today and mean opposite things tomorrow, and
 * only one of them survives somebody correcting her grade.
 *
 * The third option is also the only way BACK. A two-way control can express
 * "I want Play" but has no gesture for "forget what I said" — the student
 * would be stuck with an override for good, which is not a preference, it is a
 * trapdoor. Samuel specified the three-state selector for exactly that reason.
 *
 * ---------------------------------------------------------------------------
 * WHY A `<select>` AND NOT A SEGMENTED CONTROL
 * ---------------------------------------------------------------------------
 * Samuel's call. It is also the accessible default: a native select is one tab
 * stop, is announced as a listbox with its label, gets the platform's own
 * picker on a phone — a full-height wheel on iOS, well past the 44px touch
 * floor whatever this page does — and needs no arrow-key handling, no roving
 * tabindex and no `aria-` bookkeeping of ours to get right. A segmented
 * control would be three targets, custom keyboard handling and a state that
 * has to be announced by something other than colour (WCAG 1.4.1, and this
 * control's entire subject is colour).
 *
 * The option text explains rather than names, in the same `name — what it is`
 * idiom `SubscriptionEditor` uses: "Play" and "Master" are our words, and a
 * fifteen-year-old choosing between two nouns she has never seen is choosing
 * at random.
 *
 * ---------------------------------------------------------------------------
 * WHY SAVE IS EXPLICIT, AND WHY IT RELOADS
 * ---------------------------------------------------------------------------
 * Saving on change would reskin the page under the cursor while the select is
 * still open. The button stays disabled until the value actually differs from
 * what is stored, so "Save" is never a lie about whether there is anything to
 * save.
 *
 * A full reload rather than a soft refresh, for a reason particular to this
 * control: the value being changed lives on `<html data-ds>`, which the ROOT
 * LAYOUT renders. Next will not re-render a root layout for a client-side
 * navigation, so a soft refresh would leave the document element carrying the
 * old variant while the page under it re-rendered — the skin flip ADR-0017
 * calls a defect, produced by the very setting that is meant to prevent it.
 * `window.location.assign` re-requests the document, the server resolves the
 * variant again before first paint, and the new skin arrives in the first
 * HTML response exactly as it does for every other visit.
 *
 * ---------------------------------------------------------------------------
 * CONSTITUTION XII
 * ---------------------------------------------------------------------------
 * Every colour, edge and radius below is a token-backed utility (`border-line`,
 * `bg-card`, `text-ink`, `text-ink-soft`, `text-ink-faint`) — no literal
 * colour, stroke width, radius or shadow, on either surface. That is what lets
 * this one component render correctly in both variants without knowing which
 * one it is in, which is the whole design. The field and the button carry
 * `ds-field` / `ds-control` (globals.css), which is how Play gets its 52px
 * target, sticker edge and press without this file knowing Play exists.
 *
 * ---------------------------------------------------------------------------
 * WHILE MASTER IS HIDDEN (ADR-0017 Amendment, 2026-09-23)
 * ---------------------------------------------------------------------------
 * With one look selectable there is nothing to choose, and a select with one
 * real option beside a Save that can never be enabled reads as broken. So the
 * control collapses to one read-only sentence naming the look in force and
 * saying another is coming. It re-appears on its own when
 * `MASTER_VARIANT_ENABLED` is turned back on — nothing here needs editing.
 */

/** `null` is not a variant; it is the absence of an override. */
type Selection = DesignVariant | "follow";

/**
 * What each variant IS, in a student's words rather than the system's.
 *
 * Surface-neutral on purpose: an operator and a student are choosing between
 * the same two things, and only the meaning of the FIRST option differs
 * between them (her grade, versus the console's fixed default). That
 * difference is the `followLabel` prop and nothing else.
 */
const VARIANT_HELP: Record<DesignVariant, string> = {
  play: "bigger, bolder, more colour",
  master: "quieter, more restrained",
};

type PickerProps = {
  /** The route handler that writes it. Server-side, same-origin, POST. */
  endpoint: string;
  /** The stored override, or `null` when the rule is in charge. */
  stored: DesignVariant | null;
  /** What applies when there is no override — resolved on the server. */
  ruleVariant: DesignVariant;
  /** The first option's text. Differs by surface; see `VARIANT_HELP`. */
  followLabel: string;
  /** Why the rule gives what it gives, e.g. "following your grade (Prep 3)". */
  ruleReason: string;
  /**
   * Console sizing. The student's control meets the 44px touch floor because
   * a fourteen-year-old uses it on a phone; the console is explicitly out of
   * polish scope (primitives only), and matching `SubscriptionEditor`'s
   * density there is the consistent choice rather than a concession.
   */
  compact?: boolean;
};

export function DesignVariantPicker(props: PickerProps) {
  const options = selectableVariants();
  if (options.length < 2) {
    // Master hidden: the only look there is, said once, with no control.
    return <CurrentLookOnly look={options[0] ?? DEFAULT_DESIGN_VARIANT} compact={props.compact} />;
  }
  return <VariantSelect {...props} options={options} />;
}

function CurrentLookOnly({ look, compact = false }: { look: DesignVariant; compact?: boolean }) {
  return (
    <p
      className={`${compact ? "text-[12.5px]" : "mt-2 text-[14px]"} max-w-[70ch] leading-relaxed text-ink-soft`}
    >
      You are using{" "}
      <strong className="font-semibold text-ink">{DESIGN_VARIANT_LABELS[look]}</strong> —{" "}
      {VARIANT_HELP[look]}. Another look is on its way, and you will be able to choose it here
      when it is ready.
    </p>
  );
}

function VariantSelect({
  endpoint,
  stored,
  ruleVariant,
  followLabel,
  ruleReason,
  compact = false,
  options,
}: PickerProps & { options: readonly DesignVariant[] }) {
  const [selection, setSelection] = useState<Selection>(stored ?? "follow");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unchanged = selection === (stored ?? "follow");

  // What the CURRENT selection would give, without saving anything. The rule
  // itself stays on the server (`lib/design-variant.ts`); what crosses the wire
  // is its answer for this person, so the browser carries no copy of a rule it
  // could disagree with.
  const effective: DesignVariant = selection === "follow" ? ruleVariant : selection;
  const byRule = selection === "follow";

  // `disabled:opacity-50` dims the unsaved-nothing Save in a variant with no
  // disabled anatomy of its own. Under Play it is cancelled in globals.css:
  // Play's disabled state (dashed edge, `--play-disabled-text`) is already the
  // signal, and dimming it on top fell to 1.76:1 (review F22).
  const field = compact
    ? "ds-field mt-1 rounded border border-line bg-card px-2 py-1 text-[13px] text-ink"
    : "ds-field mt-1 min-h-[44px] w-full max-w-[26rem] rounded-lg border border-line bg-card px-3 text-[15px] text-ink";
  const action = compact
    ? "ds-control play-pressable rounded border border-line bg-card px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
    : "ds-control play-pressable min-h-[44px] rounded-lg border border-line bg-card px-4 text-[15px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50";

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `null` on the wire is the cleared override — the same value the
        // column holds, rather than a sentinel string the server would have to
        // learn to translate.
        body: JSON.stringify({ variant: selection === "follow" ? null : selection }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(`${res.status} ${body.error ?? "could not save"}`);
        setBusy(false);
        return;
      }
      // See the header: a reload, not a refresh, because the value lives on
      // the document element that only a fresh document can carry.
      window.location.assign(window.location.pathname);
    } catch {
      setError("could not reach the server");
      setBusy(false);
    }
  }

  return (
    <div className={compact ? "" : "mt-2"}>
      <div className={compact ? "flex flex-wrap items-end gap-3" : ""}>
        <label className={compact ? "text-[12.5px] text-ink-soft" : "block text-ink-soft"}>
          <span className={compact ? "block" : "block text-[14px]"}>How this looks</span>
          <select
            value={selection}
            onChange={(e) => setSelection(e.target.value as Selection)}
            disabled={busy}
            className={field}
          >
            <option value="follow">{followLabel}</option>
            {options.map((v) => (
              <option key={v} value={v}>
                {DESIGN_VARIANT_LABELS[v]} — {VARIANT_HELP[v]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || unchanged}
          className={compact ? action : `${action} mt-3 block`}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {error && (
        <p className={`mt-2 ${compact ? "text-[12.5px]" : "text-[14px]"} text-ink`}>
          Not saved: <span className="font-mono text-[12px]">{error}</span>
        </p>
      )}

      {/* What is actually in force, and why — the rule told apart from the
          override without anybody having to save to find out. Never colour
          alone: the difference is carried by the words (WCAG 1.4.1). */}
      <p
        className={`mt-2 max-w-[70ch] leading-relaxed text-ink-soft ${
          compact ? "text-[12px]" : "text-[14px]"
        }`}
      >
        {unchanged ? "Right now" : "If you save"}:{" "}
        <strong className="font-semibold text-ink">
          {DESIGN_VARIANT_LABELS[effective]}
        </strong>{" "}
        — {byRule ? ruleReason : "because you chose it"}.
      </p>
    </div>
  );
}

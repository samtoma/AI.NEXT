"use client";

import { useId, useMemo, useRef } from "react";
import { TeX } from "@/components/TeX";
import { previewLatex, reentryMessage, type MarkerInput } from "@/lib/answer-marker";
import { STROKE, STROKE_SM, VERDICT_INK, STROKE_WIDTH_SM, cx } from "@/components/sticker";

/**
 * Typed maths entry for a question the maths-expression marker marks (T417, FR-4320, ADR-0025).
 *
 * A plain text field, so the iPad's own keyboard works as it does everywhere else: letters for x and y,
 * Return to submit, no custom keyboard to learn. Beside it:
 *
 *  - **a symbol bar** for what the keyboard makes hard to reach (^, √, a fraction, ±, π, brackets, and
 *    ≤ ≥ ∞ on an interval). Each key inserts at the caret and keeps the keyboard up: it takes no focus.
 *  - **a live preview**, typeset by the app's KaTeX (`<TeX>`), of the answer *as the marker reads it*:
 *    `previewLatex` is the marker's own reader, so what the student sees is what gets marked. It marks
 *    nothing, and the key never reaches the client through this component.
 *  - **the marker's re-entry message**, inline, when the server sent the answer back (a form the question
 *    does not ask for, or not readable): nothing was recorded, and the student is told what to change.
 *
 * Maths is left to right in any direction (Principle V): the field and the preview carry `dir="ltr"`.
 * Play tokens only (Principle XII); the message wears the Honey "close" verdict, never red.
 */
export function MathAnswerInput({
  input,
  value,
  onChange,
  onSubmit,
  disabled = false,
  reentry = null,
  label = "Your answer",
}: {
  input: MarkerInput;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  /** The marker's message from the last submit, when the answer came back for re-entry. */
  reentry?: string | null;
  label?: string;
}) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => previewLatex(value, input), [value, input]);
  // Most unreadable states are just "not finished typing yet" and stay quiet. One is worth saying live,
  // because it is a real choice the student has to make: `1/2x` is read neither way (T413).
  const liveHint =
    preview.reason?.startsWith("ambiguous division") ? reentryMessage({ result: "unreadable", reason: preview.reason }) : null;

  const keys = useMemo(() => symbolKeys(input), [input]);

  /** Insert at the caret (replacing a selection), then put the caret where the key says. */
  const insert = (text: string, caretFromStart: number) => {
    const el = field.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    const caret = start + caretFromStart;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="grid gap-2">
      <label htmlFor={`${id}-field`} className="font-display text-[0.85rem] font-bold text-ink-soft">
        {label}
      </label>
      <input
        ref={field}
        id={`${id}-field`}
        type="text"
        dir="ltr"
        // letters for the variables; not "decimal", which hides them on an iPad
        inputMode="text"
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        aria-describedby={cx(`${id}-preview`, (reentry || liveHint) && `${id}-message`)}
        aria-invalid={reentry ? true : undefined}
        placeholder="Type the answer, e.g. (x - 3)(x + 3)"
        className={cx(
          STROKE,
          "min-h-[var(--noor-touch-min)] w-full rounded-[var(--play-radius-sm)] bg-card px-4 font-mono text-[1rem] text-ink outline-none placeholder:text-ink-faint sticker-shadow-sm"
        )}
      />

      <div role="group" aria-label="Maths symbols" className="flex flex-wrap gap-1.5" dir="ltr">
        {keys.map((k) => (
          <button
            key={k.label}
            type="button"
            aria-label={k.name}
            title={k.name}
            disabled={disabled}
            // keep focus (and the iPad keyboard) in the field: the key is a typing aid, not a stop
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(k.insert, k.caret)}
            className={cx(
              STROKE_SM,
              "inline-flex min-h-[var(--noor-touch-min)] min-w-[var(--noor-touch-min)] items-center justify-center rounded-[var(--play-radius-sm)] bg-card px-2.5",
              "font-display text-[1.05rem] font-bold text-ink sticker-shadow-sm play-pressable disabled:text-[color:var(--play-disabled-text)]"
            )}
          >
            <span aria-hidden="true">{k.label}</span>
          </button>
        ))}
      </div>

      <div
        id={`${id}-preview`}
        aria-live="polite"
        className={cx(STROKE_SM, "flex min-h-[var(--noor-touch-min)] items-center gap-3 rounded-[var(--play-radius-sm)] bg-paper px-3 py-2")}
      >
        <span className="shrink-0 font-mono text-[0.72rem] uppercase tracking-[0.14em] text-[color:var(--play-text-muted)]">
          reads as
        </span>
        <span dir="ltr" className="min-w-0 overflow-x-auto text-[1.1rem] text-ink">
          {preview.latex ? (
            <TeX text={`$${preview.latex}$`} />
          ) : (
            <span className="text-[0.95rem] text-[color:var(--play-text-muted)]">
              {liveHint ? "needs brackets" : value.trim() ? "…keep typing" : "your answer appears here"}
            </span>
          )}
        </span>
      </div>

      {(reentry || liveHint) && (
        <p
          id={`${id}-message`}
          role={reentry ? "alert" : undefined}
          className={cx(STROKE_WIDTH_SM, VERDICT_INK.partial, "rounded-[var(--play-radius-sm)] px-3 py-2 text-[0.95rem] font-bold")}
        >
          {reentry ?? liveHint}
        </p>
      )}
    </div>
  );
}

type SymbolKey = { label: string; name: string; insert: string; caret: number };

/** The bar: the same core keys everywhere, and the kind's own where it needs them. */
function symbolKeys(input: MarkerInput): SymbolKey[] {
  const keys: SymbolKey[] = [
    { label: "xⁿ", name: "Insert a power", insert: "^", caret: 1 },
    { label: "√", name: "Insert a square root", insert: "√()", caret: 2 },
    { label: "a/b", name: "Insert a fraction", insert: "()/()", caret: 1 },
    { label: "±", name: "Insert plus or minus", insert: "±", caret: 1 },
    { label: "π", name: "Insert pi", insert: "π", caret: 1 },
    { label: "(", name: "Insert an opening bracket", insert: "(", caret: 1 },
    { label: ")", name: "Insert a closing bracket", insert: ")", caret: 1 },
  ];
  if (input.kind === "interval") {
    keys.push(
      { label: "≤", name: "Insert less than or equal to", insert: "≤", caret: 1 },
      { label: "≥", name: "Insert greater than or equal to", insert: "≥", caret: 1 },
      { label: "∞", name: "Insert infinity", insert: "∞", caret: 1 }
    );
  }
  if (input.kind === "coordinates" || input.kind === "values" || input.kind === "interval") {
    keys.push({ label: ";", name: "Insert a separator", insert: "; ", caret: 2 });
  }
  return keys;
}

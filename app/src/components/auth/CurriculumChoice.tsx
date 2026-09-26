"use client";

import type { CurriculumId } from "@/lib/curricula";

/**
 * "Which curriculum does your school follow?" — asked ONLY when the grade
 * offers two or more (feature 003, FR-4005, decision 1), on sign-up and on the
 * first-Google-sign-in step (FR-4014). A grade that offers one is stored
 * without asking, so most students never see this.
 *
 * Three rules from the spec, and where each lives:
 *
 *   · **Only what the grade offers.** The caller passes the grade's offer,
 *     computed on the server from this environment's live rules; this lists
 *     exactly those, in registry order.
 *   · **Nothing pre-selected.** A radio group, not a select: a select forces a
 *     default, and a default would be a fact about a child that nobody
 *     supplied (the same reason `GenderChoice` is a radio group).
 *   · **Flat labels** (FR-4016, privacy review F1): the registry's own names,
 *     "American" and "National", with no description under them — nothing that
 *     reads as a tier, a price or a kind of school.
 *
 * Play anatomy from tokens only (constitution XII): the stroke, radius and
 * shadow are the design system's variables, and a chosen option fills Honey
 * and keeps its ink outline, so the choice survives greyscale.
 */

export type CurriculumOption = { id: CurriculumId; label: string };

export function CurriculumChoice({
  options,
  value,
  onChange,
  error,
}: {
  options: readonly CurriculumOption[];
  value: CurriculumId | null;
  onChange: (id: CurriculumId) => void;
  error?: string | null;
}) {
  return (
    <fieldset className="mb-6">
      <legend className="mb-1.5 font-display text-[0.95rem] font-bold text-ink">
        Which curriculum does your school follow?
      </legend>
      <p id="curriculum-hint" className="mb-2.5 text-[0.85rem] text-ink-soft">
        Noor teaches you the course for it.
      </p>
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-describedby={error ? "curriculum-hint curriculum-error" : "curriculum-hint"}
        aria-invalid={error ? true : undefined}
      >
        {options.map((o) => (
          <label
            key={o.id}
            className="play-pressable flex min-h-[52px] cursor-pointer items-center gap-2 rounded-[var(--play-radius)] border-[length:var(--play-stroke)] border-ink bg-card px-4 font-display text-[1rem] font-bold text-ink sticker-shadow-sm has-[:checked]:bg-card-warm"
          >
            <input
              type="radio"
              name="curriculum"
              value={o.id}
              checked={value === o.id}
              onChange={() => onChange(o.id)}
              className="h-5 w-5 accent-[var(--ink)]"
            />
            {o.label}
          </label>
        ))}
      </div>
      <p
        id="curriculum-error"
        aria-live="polite"
        className="mt-1.5 min-h-[1.15rem] text-[0.85rem] font-semibold"
        style={{ color: "var(--play-text-amber-warm)" }}
      >
        {error ?? ""}
      </p>
    </fieldset>
  );
}

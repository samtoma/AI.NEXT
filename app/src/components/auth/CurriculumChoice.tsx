"use client";

import { curriculumGradeLabel, type CurriculumId } from "@/lib/curricula";

/**
 * "Which curriculum does your school follow?" — asked for EVERY grade, once
 * one is chosen, on sign-up and on the first-Google-sign-in step (FR-4005,
 * FR-4014). Samuel's reversal of 2026-10-01 ("yes the sign up should always
 * ask"; decision 1, superseded) removed the old two-or-more gate: every
 * student answers this.
 *
 * Four rules from the spec, and where each lives:
 *
 *   · **Every registry curriculum, always.** `options` is the full registry,
 *     in registry order — never filtered by what the grade offers.
 *   · **A neutral note on a curriculum with nothing live yet.** `offered` is
 *     which of them have something live for `grade` (computed on the server,
 *     `offeredCurricula`); an option outside it still a plain, selectable
 *     choice, with one line underneath in the curriculum's own grade word
 *     (`curriculumGradeLabel`) — never a reason not to pick it.
 *   · **Nothing pre-selected.** A radio group, not a select: a select forces a
 *     default, and a default would be a fact about a child that nobody
 *     supplied (the same reason `GenderChoice` is a radio group).
 *   · **Flat labels** (FR-4016, privacy review F1): the registry's own names,
 *     "American" and "National" — nothing that reads as a tier, a price or a
 *     kind of school.
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
  grade,
  offered,
}: {
  /** Every curriculum the registry knows, in registry order — never filtered. */
  options: readonly CurriculumOption[];
  value: CurriculumId | null;
  onChange: (id: CurriculumId) => void;
  error?: string | null;
  /** The grade just chosen — named in each curriculum's own words below. */
  grade: string;
  /** Which curricula have something live for `grade` (`offeredCurricula`). */
  offered: readonly CurriculumId[];
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
        className="flex flex-col flex-wrap gap-2"
        role="radiogroup"
        aria-describedby={error ? "curriculum-hint curriculum-error" : "curriculum-hint"}
        aria-invalid={error ? true : undefined}
      >
        {options.map((o) => {
          const nothingYet = !offered.includes(o.id);
          return (
            <label
              key={o.id}
              className="play-pressable flex min-h-[52px] cursor-pointer items-center gap-2 rounded-[var(--play-radius)] border-[length:var(--play-stroke)] border-ink bg-card px-4 py-2 font-display text-[1rem] font-bold text-ink sticker-shadow-sm has-[:checked]:bg-card-warm"
            >
              <input
                type="radio"
                name="curriculum"
                value={o.id}
                checked={value === o.id}
                onChange={() => onChange(o.id)}
                className="h-5 w-5 shrink-0 accent-[var(--ink)]"
              />
              <span>
                {o.label}
                {nothingYet && (
                  <span className="block font-sans text-[0.78rem] font-normal text-ink-soft">
                    Nothing to study here yet for {curriculumGradeLabel(grade, o.id)}
                  </span>
                )}
              </span>
            </label>
          );
        })}
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

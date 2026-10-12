"use client";

import { useState } from "react";

import type { CurriculumId } from "@/lib/curricula";
import { GRADES } from "@/lib/profile";

import {
  Field,
  FormError,
  OFFLINE_MESSAGE,
  PrimaryButton,
  SelectInput,
  messageFor,
} from "./Controls";
import { CurriculumChoice, type CurriculumOption } from "./CurriculumChoice";

/**
 * The one-screen step after a FIRST Google sign-in (feature 003, FR-4014).
 *
 * Google told us an email and a name. It did not tell us a grade, and the
 * product cannot choose a course without one, so this asks — and asks for
 * nothing else: grade, then — always, once a grade is chosen (Samuel's
 * reversal of 2026-10-01, "yes the sign up should always ask"; decision 1,
 * superseded) — curriculum, naming every registry curriculum. No name, no
 * gender, no interests; those stay optional where they already were.
 *
 * **No grade is pre-selected.** The account was stored with a placeholder
 * grade because the column cannot be empty; pre-selecting it here would turn
 * the placeholder into an answer she never gave with one click.
 *
 * It works once. The server refuses a second submission with 409
 * `onboarding_already_completed`, and a student who somehow sees that is sent
 * on to her lessons: the step is done, and it is never a way to change a
 * curriculum (decision 4).
 */
export function OnboardingForm({
  offered,
  curricula,
}: {
  /** What each grade offers, computed on the server for this environment. */
  offered: Readonly<Record<string, CurriculumId[]>>;
  /** Every curriculum's flat label, in registry order. */
  curricula: readonly CurriculumOption[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [grade, setGrade] = useState("");
  const [picked, setPicked] = useState<CurriculumId | null>(null);
  // The server's answer wins: a 422 carries what the grade offers NOW.
  const [offer, setOffer] = useState<Record<string, CurriculumId[]>>({ ...offered });

  const gradeOffer = offer[grade] ?? [];

  function chooseGrade(next: string) {
    setGrade(next);
    setFieldErrors({});
    // The pick survives a grade change: a curriculum with nothing live for
    // the new grade is still the student's answer, not an invalid one.
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!grade) {
      setFieldErrors({ grade: messageFor("invalid_grade") });
      return;
    }
    // Always required now (Samuel's 2026-10-01 reversal).
    if (!picked) {
      setFieldErrors({ curriculum: messageFor("curriculum_required") });
      return;
    }

    setBusy(true);
    setFieldErrors({});
    try {
      const res = await fetch("/api/auth/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade, curriculum: picked }),
      });

      if (res.status === 204) {
        window.location.assign("/student");
        return;
      }

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        field?: string;
        offered?: CurriculumId[];
      };
      if (body.error === "onboarding_already_completed") {
        // Done already (another tab, a double tap): nothing to ask any more.
        window.location.assign("/student");
        return;
      }
      if (body.error === "curriculum_required" && Array.isArray(body.offered)) {
        // Refreshes the "nothing yet" notes only — a pick outside this list is
        // still a valid, explicit choice and is never cleared because of it.
        setOffer((prev) => ({ ...prev, [grade]: body.offered! }));
      }
      const message = messageFor(body.error);
      if (body.field) setFieldErrors({ [body.field]: message });
      else setError(message);
    } catch {
      setError(OFFLINE_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <FormError message={error} />

      <form onSubmit={onSubmit} noValidate>
        <Field id="grade" label="Which grade are you in?" error={fieldErrors.grade}>
          <SelectInput
            id="grade"
            value={grade}
            onChange={(e) => chooseGrade(e.target.value)}
            required
            error={fieldErrors.grade}
          >
            <option value="" disabled>
              Choose your grade
            </option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                Grade {g}
              </option>
            ))}
          </SelectInput>
        </Field>

        {grade && (
          <CurriculumChoice
            options={curricula}
            value={picked}
            onChange={(id) => {
              setPicked(id);
              setFieldErrors({});
            }}
            grade={grade}
            offered={gradeOffer}
            error={fieldErrors.curriculum}
          />
        )}

        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Getting your lessons ready…" : "Start learning"}
        </PrimaryButton>
      </form>
    </>
  );
}

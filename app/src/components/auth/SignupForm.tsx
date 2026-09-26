"use client";

import { useState } from "react";

import { asksCurriculum, curriculumToSend } from "@/lib/auth/onboarding";
import type { CurriculumId } from "@/lib/curricula";
import { GRADES, INTEREST_CATEGORIES, type InterestId } from "@/lib/profile";

import {
  Field,
  FormError,
  OFFLINE_MESSAGE,
  PrimaryButton,
  SelectInput,
  TertiaryLink,
  TextInput,
  messageFor,
} from "./Controls";
import { safeNext } from "./next-param";
import { CurriculumChoice, type CurriculumOption } from "./CurriculumChoice";
import { GoogleButton } from "./GoogleButton";
import { MIN_PASSWORD_LENGTH } from "./password-rule";

/**
 * Create an account — six fields, and the reason there are only six.
 *
 * Email, password, name, grade, optionally gender, optionally interests. **No
 * parent contact, no phone, no school, no birth date, no free text** (FR-2002,
 * constitution VII). The server ignores anything else in the body, so a field
 * added here would be a field collected from a minor and then dropped, which
 * is worse than not asking.
 *
 * Gender has two ways of being empty and they mean different things: an
 * untouched radio group sends nothing at all (the column stays NULL — never
 * asked), while "I'd rather not say" sends `unspecified` (asked, declined).
 * The tutor reads it to address the student correctly and for nothing else,
 * which the label says out loud rather than leaving a fourteen-year-old to
 * wonder why an app wants to know.
 *
 * The password rule is printed before it is enforced. A refusal after the fact
 * that could have been a sentence before it is the cheapest kind of rudeness.
 *
 * **One conditional question, feature 003's only addition** (FR-4005, FR-2002):
 * after grade, "which curriculum does your school follow?" — shown only when
 * that grade offers two or more curricula, naming only those, with none
 * pre-selected. A grade that offers one sends nothing and the server stores
 * that one without asking. When the server answers 409 `curriculum_required`
 * (an operator changed the grade's offer after this page loaded), the form
 * takes the offer it carries and asks again.
 */

export function SignupForm({
  next,
  googleAvailable,
  offered,
  curricula,
}: {
  next: string;
  googleAvailable: boolean;
  /** What each grade offers, computed on the server for this environment. */
  offered: Readonly<Record<string, CurriculumId[]>>;
  /** Every curriculum's flat label, in registry order. */
  curricula: readonly CurriculumOption[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [interests, setInterests] = useState<InterestId[]>([]);
  const [grade, setGrade] = useState("9");
  const [picked, setPicked] = useState<CurriculumId | null>(null);
  // The server's answer wins: a 409 carries what the grade offers NOW.
  const [offer, setOffer] = useState<Record<string, CurriculumId[]>>({ ...offered });

  const destination = safeNext(next);
  const gradeOffer = offer[grade] ?? [];
  const askingCurriculum = asksCurriculum(gradeOffer);

  function chooseGrade(value: string) {
    setGrade(value);
    // A pick the new grade does not offer is not carried across.
    if (picked && !(offer[value] ?? []).includes(picked)) setPicked(null);
  }

  function toggleInterest(id: InterestId) {
    setInterests((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;

    // Asked and not answered: say so here rather than after a round trip.
    const curriculum = curriculumToSend(gradeOffer, picked);
    if (askingCurriculum && !curriculum) {
      setError(null);
      setFieldErrors({ curriculum: messageFor("curriculum_required") });
      return;
    }

    setBusy(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(e.currentTarget);
    const gender = String(data.get("gender") ?? "");

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(data.get("email") ?? ""),
          password: String(data.get("password") ?? ""),
          displayName: String(data.get("displayName") ?? ""),
          grade,
          // Omitted entirely when untouched: "" would be a value, and the
          // column's NULL is the record of a question we never asked.
          ...(gender ? { gender } : {}),
          interests,
          // Only when the grade asked (FR-4005); otherwise the server decides.
          ...(curriculum ? { curriculum } : {}),
        }),
      });

      if (res.status === 201) {
        // Signed in already, unverified. The shell says what is outstanding.
        window.location.assign(destination);
        return;
      }

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        field?: string;
        retryAfter?: number;
        offered?: CurriculumId[];
      };
      if (body.error === "curriculum_required" && Array.isArray(body.offered)) {
        const now = body.offered;
        setOffer((prev) => ({ ...prev, [grade]: now }));
        if (picked && !now.includes(picked)) setPicked(null);
      }
      const message = messageFor(body.error, body);
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
        <Field id="displayName" label="What should Noor call you?" error={fieldErrors.displayName}>
          <TextInput
            id="displayName"
            type="text"
            autoComplete="given-name"
            maxLength={40}
            required
            error={fieldErrors.displayName}
          />
        </Field>

        <Field id="email" label="Email" error={fieldErrors.email}>
          <TextInput
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            error={fieldErrors.email}
          />
        </Field>

        <Field
          id="password"
          label="Password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. Anything you'll remember.`}
          error={fieldErrors.password}
        >
          <TextInput
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            hint
            error={fieldErrors.password}
          />
        </Field>

        <Field id="grade" label="Which grade are you in?" error={fieldErrors.grade}>
          <SelectInput
            id="grade"
            value={grade}
            onChange={(e) => chooseGrade(e.target.value)}
            required
            error={fieldErrors.grade}
          >
            {GRADES.map((g) => (
              <option key={g} value={g}>
                Grade {g}
              </option>
            ))}
          </SelectInput>
        </Field>

        {askingCurriculum && (
          <CurriculumChoice
            options={curricula.filter((c) => gradeOffer.includes(c.id))}
            value={picked}
            onChange={(id) => {
              setPicked(id);
              setFieldErrors((prev) => ({ ...prev, curriculum: "" }));
            }}
            error={fieldErrors.curriculum}
          />
        )}

        <GenderChoice error={fieldErrors.gender} />

        <fieldset className="mb-6">
          <legend className="mb-1.5 font-display text-[0.95rem] font-bold text-ink">
            What are you into?
          </legend>
          <p className="mb-2.5 text-[0.85rem] text-ink-soft">
            Pick any, or none. Noor uses it to explain things with something you
            already like.
          </p>
          <div className="flex flex-wrap gap-2">
            {INTEREST_CATEGORIES.map((c) => {
              const on = interests.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleInterest(c.id)}
                  className="play-pressable min-h-[52px] rounded-[999px] border-[3px] border-ink px-4 font-display text-[0.95rem] font-bold text-ink sticker-shadow-sm"
                  style={{
                    // Chosen chips fill Honey and keep their outline, so the
                    // choice survives greyscale and does not rely on colour.
                    background: on ? "var(--card-warm)" : "var(--card)",
                  }}
                >
                  {on ? "✓ " : ""}
                  {c.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Setting you up…" : "Create my account"}
        </PrimaryButton>
      </form>

      <div className="mt-4">
        <GoogleButton available={googleAvailable} label="Sign up with Google" />
      </div>

      <p className="mt-6 text-[0.95rem] text-ink-soft">
        Already have one? <TertiaryLink href="/signin">Sign in</TertiaryLink>
      </p>
    </>
  );
}

/**
 * Three options and a fourth state: nothing selected.
 *
 * A radio group rather than a select, because a select forces a default and
 * the default would be a fact about a child that nobody supplied.
 */
function GenderChoice({ error }: { error?: string }) {
  const options = [
    { value: "female", label: "She" },
    { value: "male", label: "He" },
    { value: "unspecified", label: "I'd rather not say" },
  ];
  return (
    <fieldset className="mb-6">
      <legend className="mb-1.5 font-display text-[0.95rem] font-bold text-ink">
        How should Noor talk to you?
      </legend>
      <p id="gender-hint" className="mb-2.5 text-[0.85rem] text-ink-soft">
        Only used to get your words right when Noor writes to you. Skip it if
        you&apos;d rather.
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-describedby="gender-hint">
        {options.map((o) => (
          <label
            key={o.value}
            className="play-pressable flex min-h-[52px] cursor-pointer items-center gap-2 rounded-[20px] border-[3px] border-ink bg-card px-4 font-display text-[1rem] font-bold text-ink sticker-shadow-sm has-[:checked]:bg-card-warm"
          >
            <input
              type="radio"
              name="gender"
              value={o.value}
              className="h-5 w-5 accent-[var(--ink)]"
            />
            {o.label}
          </label>
        ))}
      </div>
      <p
        id="gender-error"
        aria-live="polite"
        className="mt-1.5 min-h-[1.15rem] text-[0.85rem] font-semibold"
        style={{ color: "var(--play-text-amber-warm, #8a4208)" }}
      >
        {error ?? ""}
      </p>
    </fieldset>
  );
}

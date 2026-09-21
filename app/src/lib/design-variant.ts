/**
 * Which design-system variant this page render wears — the RULE, with no
 * database and no React anywhere near it (ADR-0017, FR-1011).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE, PURE MODULE
 * ---------------------------------------------------------------------------
 * The same argument `lib/catalog.ts` makes about course availability, and for
 * the same kind of decision: this one answers "what does a fourteen-year-old
 * see", the answer has to be provable rather than observed working, and the
 * branches that matter most are the ones that are hard to reach in a running
 * system — a student with no grade, a grade spelled the legacy way, an
 * override whose value is something nobody expected. Split out, the whole
 * decision is a table of cases that runs under `node --test` in milliseconds.
 *
 * `lib/design-variant-queries.ts` is the other half: it reads the stored
 * values and applies what is decided here. It holds no rule of its own.
 *
 * ---------------------------------------------------------------------------
 * THE RULE, AS ADR-0017 PINS IT
 * ---------------------------------------------------------------------------
 *   1. A stored **override**, if the student (or operator) has set one, decides
 *      it outright. "The grade rule is the default, not a ceiling."
 *   2. Otherwise **grade** decides: Preparatory → Play, Secondary → Master.
 *      The boundary is the Preparatory/Secondary line, and Prep 3 — the cohort
 *      this build serves — is on the Play side.
 *   3. Otherwise **Play**. A grade that is missing, blank or unreadable fails
 *      to the younger-audience variant on purpose: it is larger, has higher
 *      contrast and bigger targets, and it is the variant the current cohort
 *      would have received anyway. The safe failure is the more legible one.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE GRADE VOCABULARY COMES FROM
 * ---------------------------------------------------------------------------
 * `lib/profile.ts` owns the list (`"7".."12"`, plus the legacy `"prep-3"`
 * spelling), `lib/catalog.ts` owns the Egyptian stage labels and the
 * `canonicalGrade` fold that makes `prep-3` and `9` the same key. **Both are
 * imported, neither is re-typed.** A second hand-written grade list here is
 * exactly how a year gets added in one place and a whole cohort silently
 * lands on the wrong skin — the same failure `lib/catalog.ts` calls out for
 * availability rules, where the symptom is an empty product instead of an
 * ill-fitting one.
 *
 * `GRADE_STAGE` below is keyed by the imported `Grade` union, so **adding a
 * grade to `lib/profile.ts` is a type error here until somebody says which
 * stage it belongs to.** That is deliberate: the Preparatory/Secondary
 * partition is the whole key, and ADR-0017 names "the arrival of non-Egyptian
 * grade structures" as one of the three things that would force this decision
 * to be revisited. A new grade should stop a build, not pick a side by itself.
 *
 * Relative imports with an explicit `.ts`, like `lib/catalog.ts` — this module
 * is loaded by `node --test`, which has no `@/` alias, and by `layout.tsx`
 * through the bundler. The whole graph reachable from here (`catalog.ts` →
 * `profile.ts`) runs outside the bundler too.
 */

import { canonicalGrade } from "./catalog.ts";
import { GRADES, type Grade } from "./profile.ts";

/**
 * The two variants, and the only two spellings the product stores or writes.
 *
 * `noor` is NOT here. It survives in `globals.css` as a selector alias of
 * `play` for anything outside this repository that still writes it (the
 * published artifact, the handoff, an old screenshot), and nothing in `src/`
 * may write it again — `design-variant-scan.test.mts` is what keeps that true.
 */
export type DesignVariant = "play" | "master";

/** In the order the system documents them: the younger variant first. */
export const DESIGN_VARIANTS: readonly DesignVariant[] = ["play", "master"] as const;

/**
 * The answer when nothing is known — ADR-0017's "default when grade is unknown
 * or unreadable: Play". Exported as a named constant rather than written as a
 * literal at each of the three sites that need it, so the default is one fact
 * that can be changed once and read everywhere.
 */
export const DEFAULT_DESIGN_VARIANT: DesignVariant = "play";

/**
 * The default for the **console**, which is a different question with a
 * different answer. See `resolveVariantForOperator`.
 */
export const OPERATOR_DEFAULT_VARIANT: DesignVariant = "master";

/** What each variant is called on a screen a person reads. */
export const DESIGN_VARIANT_LABELS: Record<DesignVariant, string> = {
  play: "Play",
  master: "Master",
};

/**
 * The Preparatory/Secondary partition, stage by stage.
 *
 * Keyed by `Grade`, so this object cannot be incomplete: see the header.
 */
const GRADE_STAGE: Record<Grade, "preparatory" | "secondary"> = {
  "7": "preparatory",
  "8": "preparatory",
  "9": "preparatory", // Prep 3 — the cohort this build serves. Play side.
  "10": "secondary",
  "11": "secondary",
  "12": "secondary",
};

/** The stage → variant mapping, stated once so the two facts stay separable. */
const STAGE_VARIANT: Record<"preparatory" | "secondary", DesignVariant> = {
  preparatory: "play",
  secondary: "master",
};

/**
 * Is this one of the two variants?
 *
 * The guard every boundary uses — a request body, a database column, a
 * `localStorage` value nobody should have written. It is not a courtesy: the
 * value ends up in an HTML attribute that selects a stylesheet block, and a
 * value that matched neither block would render the frozen baseline's identity
 * on a student's screen, which is the one appearance that is supposed to mean
 * "no variant was chosen".
 */
export function isDesignVariant(value: unknown): value is DesignVariant {
  return (
    typeof value === "string" &&
    (DESIGN_VARIANTS as readonly string[]).includes(value)
  );
}

/**
 * A stored value, or `null` for anything else — including a column that
 * predates migration 024 and a row written by a hand nobody remembers.
 *
 * `null` is not "play"; it means **no override**, which is a different fact
 * from "an override that happens to say play", and `resolveVariant` treats
 * them differently only in that the first defers to the grade. Keeping them
 * distinct is what lets a Secondary student who has chosen Play keep Play
 * after somebody fixes her grade, and what lets clearing the override put her
 * back on the rule.
 *
 * Modelled on `asGender` in `lib/student-context.ts`, deliberately: a second
 * idiom for "narrow an unknown database value onto a closed set" is a second
 * thing to get wrong.
 */
export function asDesignVariant(raw: unknown): DesignVariant | null {
  return isDesignVariant(raw) ? raw : null;
}

/**
 * Preparatory → play, Secondary → master, unknown → play.
 *
 * `canonicalGrade` folds the legacy `prep-3` spelling onto `9` before the
 * lookup. Without it every migrated PoC row — and the baseline database is
 * full of them — would match no stage and fall to the default. That would
 * happen to be the right answer for Prep 3, which is precisely why it has to
 * be done properly: a rule that is accidentally right for today's only cohort
 * is a rule that breaks silently on the first Secondary student.
 */
export function variantForGrade(grade: string | null | undefined): DesignVariant {
  const canonical = canonicalGrade(grade);
  if (canonical === null) return DEFAULT_DESIGN_VARIANT;
  if (!(GRADES as readonly string[]).includes(canonical)) {
    // A grade the product does not know — a typo, a foreign school system, a
    // value written before the column was constrained. Not an error: ADR-0017
    // says "unknown or unreadable" fails to Play, and a throw here would take
    // out the document layout for a student whose only problem is her year.
    return DEFAULT_DESIGN_VARIANT;
  }
  return STAGE_VARIANT[GRADE_STAGE[canonical as Grade]];
}

/**
 * The whole resolution: the override wins whenever it is set, otherwise grade.
 *
 * Both arguments are deliberately permissive (`null | undefined`, and a raw
 * string for the grade) because both come from a database row, and a resolver
 * that demanded well-formed input would push the narrowing out to every
 * caller — which is where it would eventually be forgotten.
 */
export function resolveVariant(
  grade: string | null | undefined,
  override: DesignVariant | null | undefined
): DesignVariant {
  if (override != null) return override;
  return variantForGrade(grade);
}

/**
 * The console's answer, which is NOT the student rule with a different default.
 *
 * An operator tool is not a children's surface. Nobody using `/students`,
 * `/cost` or `/security` has a grade, so the key the whole ADR turns on does
 * not exist here; what is left is a preference, and the sensible absence of
 * one is the restrained variant rather than the one designed for a
 * fourteen-year-old. Constitution XII binds the console exactly as it binds
 * the student product — the console is skinned, not unskinned — so this
 * returns a named variant and never `undefined`.
 */
export function resolveVariantForOperator(
  override: DesignVariant | null | undefined
): DesignVariant {
  return override ?? OPERATOR_DEFAULT_VARIANT;
}

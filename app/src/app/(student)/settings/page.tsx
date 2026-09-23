import { redirect } from "next/navigation";

import { DesignVariantPicker } from "@/components/DesignVariantPicker";
import { gradeDisplayLabel } from "@/lib/catalog";
import { MASTER_VARIANT_ENABLED, variantForGrade } from "@/lib/design-variant";
import { resolveStudentContext } from "@/lib/student-context";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your settings — Noor" };

/**
 * /settings — the student's own preferences.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PAGE EXISTS AT ALL, AND WHAT IT DELIBERATELY IS NOT
 * ---------------------------------------------------------------------------
 * ADR-0017 requires the design-variant override to live "in settings", and
 * before FR-1011 **this product had no settings**. A student could sign in,
 * study and sign out; she could not change one thing about her own account
 * (`docs/PROJECT_STATE.md`, FR-2013: "No student can edit her own profile" —
 * endpoints and a data model with no surface on top).
 *
 * So this is the smallest honest surface that satisfies the ADR, and it is
 * deliberately not a profile editor. It carries ONE control. It is not the
 * home FR-2013 asks for, it does not let her change her name, her year, her
 * interests or how the tutor addresses her, and it must not be read as having
 * closed that requirement — when FR-2013 is built, this page is where it goes,
 * and the variant control becomes one section of several. Building the whole
 * profile editor here in order to hang one selector off it would have been the
 * larger change and the one nobody asked for.
 *
 * ---------------------------------------------------------------------------
 * THE ANXIOUS-TEENAGER CASE
 * ---------------------------------------------------------------------------
 * The audience is not assistive-tech-heavy, but it is fourteen-year-olds under
 * exam stress, and the accessibility obligation that actually binds here is
 * cognitive load: one decision per screen, stated in words rather than in a
 * swatch, with the current state legible without touching anything. Hence one
 * control, an explicit Save, and a sentence under it that says what is in
 * force and why. Nothing on this page is signalled by colour alone (WCAG
 * 1.4.1) — which matters more here than anywhere, since colour is the subject.
 *
 * Signed out → `/signin`, carrying where it was going, exactly as `/dashboard`
 * does. There is nothing on this page for somebody with no account: the
 * preference is stored against a student, and a visitor has none.
 */
export default async function SettingsPage() {
  const me = await resolveStudentContext();
  if (!me) redirect("/signin?next=/settings");

  // What the grade rule alone would give — resolved HERE, on the server, and
  // handed to the control as a value. The rule itself never reaches the
  // browser, so nothing in the client can hold a second, disagreeing copy of
  // the Preparatory/Secondary boundary.
  const ruleVariant = variantForGrade(me.grade);
  const gradeLabel = gradeDisplayLabel(me.grade);
  const knowsGrade = me.grade != null && me.grade !== "";

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-6">
        <p className="rule-label">Your settings</p>
        <h1 className="mt-1 font-display text-[26px] font-bold text-ink">
          {me.studentName}
        </h1>
        <p className="mt-1 max-w-[62ch] text-[14px] text-ink-soft">
          {knowsGrade ? `${gradeLabel}. ` : ""}Changes here are saved to your
          account, so they follow you to any device you sign in on.
        </p>
      </header>

      <section className="ledger-card p-5">
        <h2 className="font-display text-[18px] font-bold text-ink">
          How the app looks
        </h2>
        {/* While Master is hidden (ADR-0017 Amendment, 2026-09-23) there is one
            look and nothing to pick, so the invitation to choose is not made;
            the picker below says which look is in force and that another is
            coming. */}
        {MASTER_VARIANT_ENABLED && (
          <p className="mt-1 max-w-[62ch] text-[14px] leading-relaxed text-ink-soft">
            There are two looks. Everything works the same in both — the lessons,
            your progress and what the tutor says do not change. Pick whichever is
            easier for you to read.
          </p>
        )}

        <DesignVariantPicker
          endpoint="/api/settings/appearance"
          stored={me.designVariant}
          ruleVariant={ruleVariant}
          followLabel="Follow my grade — the usual setting"
          ruleReason={
            knowsGrade
              ? `following your grade (${gradeLabel})`
              : "we do not have your year on file, so you get the easier of the two to read"
          }
        />
      </section>
    </main>
  );
}

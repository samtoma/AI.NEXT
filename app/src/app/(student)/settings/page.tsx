import { redirect } from "next/navigation";

import { DesignVariantPicker } from "@/components/DesignVariantPicker";
import {
  CurriculumSection,
  DeleteAccountSection,
  ProfileSection,
} from "@/components/student/SettingsForms";
import { currentPrincipal } from "@/lib/auth/principal";
import { GRADES, canonicalGrade, gradeDisplayLabel } from "@/lib/catalog";
import { coursesByCurriculum } from "@/lib/catalog-queries";
import { courseDef } from "@/lib/courses";
import { CURRICULUM_IDS, curriculumLabel } from "@/lib/curricula";
import { offeredCurriculaEveryGrade } from "@/lib/curriculum-queries";
import { MASTER_VARIANT_ENABLED, variantForGrade } from "@/lib/design-variant";
import { DELETE_PHRASE, accountHasPassword } from "@/lib/student-settings";
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
 * It started as the smallest honest surface that satisfied the ADR: one
 * control. Since 2026-10-27 (Tamer's call) it is also where she changes her
 * name and grade (FR-2013 — gender and interests are still owed), her
 * curriculum (FR-4010 as amended), and deletes her account (FR-2310), each in
 * its own section with its own Save, so the one-decision rule below holds per
 * section. Progress stays with the course it was earned in whatever she
 * changes (FR-4011).
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
  // Her year in her own curriculum's words (FR-4013): "Grade 10" for an
  // American-curriculum student, "Secondary 1" for a National one.
  const gradeLabel = gradeDisplayLabel(me.grade, me.curriculum);
  const knowsGrade = me.grade != null && me.grade !== "";
  const principal = await currentPrincipal();
  if (principal.kind !== "student") redirect("/signin?next=/settings");

  const grade = canonicalGrade(me.grade) ?? "";
  const [offeredByGrade, byCurriculum, hasPassword] = await Promise.all([
    offeredCurriculaEveryGrade(),
    coursesByCurriculum(principal.studentId),
    accountHasPassword(principal.accountId),
  ]);
  const courseLabels = Object.fromEntries(
    Object.entries(byCurriculum).map(([c, ids]) => [
      c,
      ids.map((id) => courseDef(id)?.label ?? id),
    ])
  );
  const curriculumOptions = CURRICULUM_IDS.map((id) => ({ id, label: curriculumLabel(id) }));

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

      <section className="ledger-card mb-6 p-5">
        <h2 className="mb-4 font-display text-[18px] font-bold text-ink">About you</h2>
        <ProfileSection
          name={me.studentName}
          grade={grade}
          grades={GRADES.map((g) => ({
            value: g.value,
            label: gradeDisplayLabel(g.value, me.curriculum),
          }))}
        />
      </section>

      <section className="ledger-card mb-6 p-5">
        <h2 className="mb-4 font-display text-[18px] font-bold text-ink">Your curriculum</h2>
        <CurriculumSection
          current={me.curriculumKnown ? (me.curriculum as (typeof CURRICULUM_IDS)[number]) : null}
          currentLabel={curriculumLabel(me.curriculum)}
          options={curriculumOptions}
          grade={grade}
          offered={offeredByGrade[grade] ?? []}
          courses={courseLabels}
        />
      </section>

      <section className="ledger-card mb-6 p-5">
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

      <section className="ledger-card p-5">
        <h2 className="font-display text-[18px] font-bold text-ink">Delete your account</h2>
        <p className="mb-4 mt-1 max-w-[62ch] text-[14px] leading-relaxed text-ink-soft">
          Removes your account and everything in it, for good.
        </p>
        <DeleteAccountSection hasPassword={hasPassword} phrase={DELETE_PHRASE} />
      </section>
    </main>
  );
}

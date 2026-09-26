import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import "./fonts";
import "./fonts/type-stack.css";
import { GaScript } from "@/components/GaScript";
import { NavLinks } from "@/components/NavLinks";
import { NoorMark } from "@/components/NoorMark";
import { VerificationBanner } from "@/components/auth/VerificationBanner";
import { documentVariant } from "@/lib/design-variant-queries";
import { IS_CONSOLE, IS_MVP1 } from "@/lib/env";
import { resolveStudentContext } from "@/lib/student-context";
import { gradeDisplayLabel } from "@/lib/catalog";
import { CURRICULA, DEFAULT_CURRICULUM, asCurriculumId } from "@/lib/curricula";

/* ------------------------- the type stack lives in ./fonts -----------------
   The seven families that used to be declared here are now `next/font/local`
   calls over .woff2 files committed under `src/app/fonts/`, and this is not a
   refactor anybody should undo.

   `next/font/google` self-hosts at runtime but downloads the files **during
   `next build`**. That made the first production deploy depend on the CI
   runner reaching fonts.googleapis.com, and it could not: three failed runs on
   `Module not found ... [next]/internal/font/google/baloo_bhaijaan_2_*.module.css`,
   one re-run that passed, two more that failed. The deploy job never ran. The
   on-box image build runs `next build` twice and would fail the same way.

   Vendoring moves that download from build time to commit time. Nothing about
   what a browser receives changes: same families, same weight ranges, same
   per-subset unicode-ranges, same preload set, same `display` — the files are
   byte-for-byte the ones the last successful build had fetched. `./fonts.ts`
   carries the full note, the per-subset reasoning and the bilingual-parity
   rules; `./fonts/LICENSES.md` carries the OFL provenance.

   `./fonts` is imported for its side effects — the @font-face rules and the
   fingerprinted, preloaded files. `./fonts/type-stack.css` carries the two
   things next/font/local cannot emit correctly here: the metric-matched
   fallback faces, and the `--font-*` variables globals.css consumes. Both are
   explained there; neither is a free-hand invention. */

// The root layout is async and reads cookies (via `currentPrincipal()`), so no
// segment under it can be prerendered — `/_not-found` otherwise is, throwing at
// build time and baking a permanently signed-out shell onto every 404.
export const dynamic = "force-dynamic";

export const metadata: Metadata = IS_MVP1
  ? {
      title: "Noor — study with what you already have",
      description:
        "A tutor that works from your own book and worksheet, one step at a time.",
    }
  : {
      title: "Noor — AI Tutor PoC",
      description:
        "Curriculum-grounded adaptive tutor built on an agent-native data spine.",
    };

/**
 * The shell knows who is here — and the two consequences of that.
 *
 * `resolveStudentContext()` is the single seam for "which student is this
 * request", so the shell asks it rather than reading a cookie or holding its
 * own copy of the rule. Anonymous is `null`, which is an answer, not an error:
 * the nav drops the student links and offers the two doors that work.
 *
 * The layout is now async and principal-dependent, so **every route renders
 * dynamically**. That is not a regression to mourn — a shell that says "signed
 * in as Omar" is the last thing that should ever come off a static cache, and
 * the student surfaces were already `force-dynamic`.
 *
 * The verification banner lives here, above `children`, so it is on every
 * screen for as long as it is true (FR-2004). Verification gates learning, not
 * signing in: the banner is what carries that state everywhere the student
 * goes instead of a modal she has to dismiss on the one screen that blocks.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // On the console build the shell belongs to `(console)/layout.console.tsx`:
  // its own header, its own nav derived from the operator's roles, its own
  // footer. Rendering the student chrome above it would put "Study", "Where you
  // stand" and a student verification banner on top of an operator's screen —
  // links to routes that 404 on this build, and a state that belongs to a
  // principal this build refuses. So the root layout stops at the document on
  // the console and carries no principal read of its own.
  const student = IS_CONSOLE ? null : await resolveStudentContext();

  // `data-ds` is the whole switch: globals.css redefines every semantic token
  // under [data-ds="play"] (aliased as "noor") and names [data-ds="master"] as
  // its sibling, so the comparison build reskins without a single component
  // being forked, and the frozen baseline (attribute absent) renders
  // byte-identically to before.
  //
  // **THIS AWAIT IS THE REQUIREMENT, not an implementation detail** (ADR-0017,
  // FR-1011). The variant is resolved HERE, server-side, in the same render
  // that produces the document, because `<html>` is the only element that
  // exists before any CSS applies to anything. Resolve it anywhere else — a
  // client effect, a `useEffect`, a cookie read in the browser — and the page
  // paints in one skin and repaints in the other, which the ADR calls a defect
  // rather than a loading state. `documentVariant()` never throws and never
  // answers `undefined` on the comparison build: a student's override, else
  // her grade, else `play`; on the console an operator's own preference, else
  // `master`, because an operator tool is not a children's surface. While
  // Master is hidden (`MASTER_VARIANT_ENABLED`, ADR-0017 Amendment 2026-09-23)
  // it answers `play` for everybody.
  //
  // `undefined` — no attribute, the Ledger identity — is what a checkout with
  // AINEXT_ENVIRONMENT unset gets (lib/env.ts defaults to `baseline`). That is
  // a configuration mistake on `main`, not a look: app/.env.example sets it.
  //
  // This is the ONLY place in `src/` that writes a variant name.
  // `design-variant-scan.test.mts` is what keeps that sentence true — a
  // component that pinned itself to one variant would be the mixed build the
  // handoff forbids, arrived at one file at a time.
  //
  // No dir attribute here, deliberately. English LTR is MVP 1.0's default, not
  // a hard-coded direction — constitution v2.0.0 Principle V.
  const variant = await documentVariant();

  // The chrome names the product's National course set ("Prep 3 ·
  // Mathematics", and the ministry's syllabus in the footer). For a student of
  // ANOTHER curriculum that is untrue — FR-4205: nothing may tell her that her
  // material comes from the Egyptian ministry's books — so she gets her own
  // grade, in her curriculum's words, and her curriculum's name (flat, FR-4016),
  // and no syllabus line. Everybody else — every National student, anybody
  // signed out, and a curriculum the registry does not know — reads exactly
  // what they read before 003. From the context already loaded: no extra query.
  const ownCurriculum = asCurriculumId(student?.curriculum);
  const otherCurriculum =
    student && ownCurriculum && ownCurriculum !== DEFAULT_CURRICULUM ? ownCurriculum : null;
  // A first Google sign-in whose grade and curriculum are still owed
  // (FR-4014; backlog #15): the account holds a placeholder grade and no
  // chosen curriculum, so the chrome may name neither — no "Prep 3 ·
  // Mathematics", no ministry syllabus line — and offers no study links,
  // which would only bounce her back to `/welcome`.
  const onboardingPending = student?.onboardingPending === true;

  return (
    <html
      lang="en"
      data-ds={variant}
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        {IS_CONSOLE ? (
          children
        ) : (
          <>
            {/* GA4, the audience layer (ADR-0016 §2). INSIDE this branch on
                purpose: the console build takes the `children`-only path above
                and therefore never renders a tag, never loads the vendor
                script and never sets a consent signal. Renders nothing at all
                when AINEXT_GA_MEASUREMENT_ID is unset. */}
            <GaScript signedIn={student !== null} />
            <header className="relative z-20 border-b border-line bg-card/70 backdrop-blur-sm">
              <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6">
                <Link href="/" className="flex items-center gap-2.5">
                  {/* Noor is the product on every surface. Only the strapline
                      distinguishes the environments — the mark and the name never do. */}
                  <NoorMark className="h-8 w-8 shrink-0" />
                  <span className="font-display text-lg font-bold tracking-tight text-ink">
                    Noor
                  </span>
                  {!(IS_MVP1 && onboardingPending) && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-faint">
                      {!IS_MVP1
                        ? "Tutor PoC · Data Spine"
                        : otherCurriculum
                          ? `${gradeDisplayLabel(student?.grade, otherCurriculum)} · ${CURRICULA[otherCurriculum].label}`
                          : "Prep 3 · Mathematics"}
                    </span>
                  )}
                </Link>
                <NavLinks
                  mvp1={IS_MVP1}
                  signedIn={student !== null}
                  studentName={student?.studentName ?? null}
                  onboardingPending={onboardingPending}
                />
              </div>
            </header>
            {student !== null && !student.emailVerified && <VerificationBanner />}
            <div className="relative z-10 flex-1">{children}</div>
            <footer className="relative z-10 border-t border-line-soft">
              <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                <span>
                  {IS_MVP1
                    ? "Noor · Student MVP 1.0 — comparison environment"
                    : "Noor · Agent-Native Data Spine — investor preview"}
                </span>
                {/* course-level, not lesson-level: any selected lesson/unit shows
                    its own module label on the surface itself */}
                {!otherCurriculum && !onboardingPending && (
                  <span>Prep-3 Mathematics · MOETE 2025–2026</span>
                )}
              </div>
            </footer>
          </>
        )}
      </body>
    </html>
  );
}

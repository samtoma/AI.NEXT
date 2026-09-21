import type { Metadata } from "next";
import {
  Baloo_Bhaijaan_2,
  Cairo,
  Fraunces,
  IBM_Plex_Mono,
  Noto_Naskh_Arabic,
  Spline_Sans,
  Spline_Sans_Mono,
} from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { GaScript } from "@/components/GaScript";
import { NavLinks } from "@/components/NavLinks";
import { NoorMark } from "@/components/NoorMark";
import { VerificationBanner } from "@/components/auth/VerificationBanner";
import { IS_CONSOLE, IS_MVP1 } from "@/lib/env";
import { resolveStudentContext } from "@/lib/student-context";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});

const splineSans = Spline_Sans({
  variable: "--font-spline",
  subsets: ["latin"],
});

const splineMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
});

/* ---------------- the Noor families (MVP 1.0 comparison build) -------------
   Baloo Bhaijaan 2 and Cairo each ship Latin AND Arabic in one family, which
   is precisely why the handoff picked them: bilingual parity — same face, same
   size, same weight in both scripts — becomes a property of the type stack
   instead of something every component has to remember. Both Arabic subsets
   are requested for that reason, even though MVP 1.0 ships English-first: the
   direction seam stays switchable (constitution v2.0.0 Principle V), and a
   language flip that arrives with no Arabic cut loaded is not switchable in
   any useful sense.

   IBM Plex Mono is Latin-only on purpose. It carries no Arabic script and no
   Arabic-Indic digits, so globals.css forces any Arabic run out of the mono
   stack rather than letting it fall through to an arbitrary system face. */
const baloo = Baloo_Bhaijaan_2({
  variable: "--font-baloo",
  subsets: ["latin", "arabic"],
  weight: ["600", "700", "800"],
  display: "swap",
});

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["latin", "arabic"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

/**
 * Arabic webfont for the whole product (ADR-0006 §3).
 *
 * Loaded from the root layout — and therefore preloaded on every route —
 * because Arabic is the primary script here: the student surface and the
 * shipped Social Studies vertical are entirely Arabic, and `display: swap`
 * without a preload means the most important text on the page reflows late on
 * a 3G connection.
 *
 * `subsets: ["arabic"]` preloads the Arabic cut only (93,960 B). Note that it
 * does NOT stop next/font from self-hosting the family's latin / latin-ext /
 * math / symbols cuts with their unicode-ranges intact. Those cuts never render
 * anything — Fraunces and Spline win every Latin character (see the font-stack
 * note in globals.css) — but a page containing a character the Latin faces lack
 * (Greek maths letters φ σ θ α, arrows → ⇢ ↳, operators ≈ ≠, dingbats ✓ ✕ ✦ ✳)
 * matches their unicode-range, so the browser fetches the cut, finds the glyph
 * missing from its cmap too, and falls through to the system font exactly as
 * before. Measured dead weight: latin 19,732 B, math 14,248 B, symbols 9,404 B,
 * whichever apply to the page. Eliminating it means dropping next/font/google
 * for a vendored Arabic-only cut via next/font/local — a separate call.
 *
 * Variable weight (400–700) is one file for every weight the UI uses. The
 * static 400 cut is ~43 KB smaller but leaves the browser to synthesise bold,
 * which smears تشكيل — the one thing this font is here to render correctly.
 *
 * `adjustFontFallback: false` states the intent — next/font's metric-matched
 * fallback is a `local(...)` face with no unicode-range, which is exactly the
 * mechanism that was swallowing Arabic in the first place. Note that this
 * version's Turbopack font pipeline ignores the flag and emits the fallback
 * face anyway, so globals.css names "Noto Naskh Arabic" directly rather than
 * using var(--font-naskh) in the stacks; see the note there.
 */
const notoNaskhArabic = Noto_Naskh_Arabic({
  variable: "--font-naskh",
  subsets: ["arabic"],
  display: "swap",
  adjustFontFallback: false,
});

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

  // data-ds is the whole switch: globals.css redefines every semantic token
  // under [data-ds="noor"], so the comparison build reskins without a single
  // component being forked, and the frozen baseline (attribute absent) renders
  // byte-identically to before.
  //
  // No dir attribute here, deliberately. English LTR is MVP 1.0's default, not
  // a hard-coded direction — constitution v2.0.0 Principle V.
  return (
    <html
      lang="en"
      data-ds={IS_MVP1 ? "noor" : undefined}
      className={`${fraunces.variable} ${splineSans.variable} ${splineMono.variable} ${notoNaskhArabic.variable} ${baloo.variable} ${cairo.variable} ${plexMono.variable} h-full antialiased`}
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
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-faint">
                    {IS_MVP1 ? "Prep 3 · Mathematics" : "Tutor PoC · Data Spine"}
                  </span>
                </Link>
                <NavLinks
                  mvp1={IS_MVP1}
                  signedIn={student !== null}
                  studentName={student?.studentName ?? null}
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
                <span>Prep-3 Mathematics · MOETE 2025–2026</span>
              </div>
            </footer>
          </>
        )}
      </body>
    </html>
  );
}

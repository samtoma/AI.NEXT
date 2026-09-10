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
import { NavLinks } from "@/components/NavLinks";
import { Logo } from "@/components/Logo";
import { NourMark } from "@/components/NourMark";
import { IS_MVP1 } from "@/lib/env";

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

/* ---------------- the Nour families (MVP 1.0 comparison build) -------------
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

export const metadata: Metadata = IS_MVP1
  ? {
      title: "Nour — study with what you already have",
      description:
        "A tutor that works from your own book and worksheet, one step at a time.",
    }
  : {
      title: "AI.Next — AI Tutor PoC",
      description:
        "Curriculum-grounded adaptive tutor built on an agent-native data spine.",
    };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // data-ds is the whole switch: globals.css redefines every semantic token
  // under [data-ds="nour"], so the comparison build reskins without a single
  // component being forked, and the frozen baseline (attribute absent) renders
  // byte-identically to before.
  //
  // No dir attribute here, deliberately. English LTR is MVP 1.0's default, not
  // a hard-coded direction — constitution v2.0.0 Principle V.
  return (
    <html
      lang="en"
      data-ds={IS_MVP1 ? "nour" : undefined}
      className={`${fraunces.variable} ${splineSans.variable} ${splineMono.variable} ${notoNaskhArabic.variable} ${baloo.variable} ${cairo.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="relative z-20 border-b border-line bg-card/70 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6">
            <Link href="/" className="flex items-center gap-2.5">
              {IS_MVP1 ? (
                <>
                  <NourMark className="h-8 w-8 shrink-0" />
                  <span className="font-display text-lg font-bold tracking-tight text-ink">
                    Nour
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-faint">
                    Prep 3 · Mathematics
                  </span>
                </>
              ) : (
                <>
                  <Logo className="h-8 w-8 shrink-0" />
                  <span className="font-display text-lg font-semibold tracking-tight text-ink">
                    AI<span className="text-accent">.</span>Next
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                    Tutor PoC · Data Spine
                  </span>
                </>
              )}
            </Link>
            <NavLinks mvp1={IS_MVP1} />
          </div>
        </header>
        <div className="relative z-10 flex-1">{children}</div>
        <footer className="relative z-10 border-t border-line-soft">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            <span>
              {IS_MVP1
                ? "Nour · Student MVP 1.0 — comparison environment"
                : "AI.Next · Agent-Native Data Spine — investor preview"}
            </span>
            {/* course-level, not lesson-level: any selected lesson/unit shows
                its own module label on the surface itself */}
            <span>Prep-3 Mathematics · MOETE 2025–2026</span>
          </div>
        </footer>
      </body>
    </html>
  );
}

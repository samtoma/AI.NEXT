import type { Metadata } from "next";
import {
  Fraunces,
  Noto_Naskh_Arabic,
  Spline_Sans,
  Spline_Sans_Mono,
} from "next/font/google";
import Link from "next/link";
import "katex/dist/katex.min.css";
import "./globals.css";
import { NavLinks } from "@/components/NavLinks";
import { Logo } from "@/components/Logo";

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

export const metadata: Metadata = {
  title: "AI.Next — AI Tutor PoC",
  description:
    "Curriculum-grounded adaptive tutor built on an agent-native data spine.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${splineSans.variable} ${splineMono.variable} ${notoNaskhArabic.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="relative z-20 border-b border-line bg-card/70 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <Logo className="h-8 w-8 shrink-0" />
              <span className="font-display text-lg font-semibold tracking-tight text-ink">
                AI<span className="text-accent">.</span>Next
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                Tutor PoC · Data Spine
              </span>
            </Link>
            <NavLinks />
          </div>
        </header>
        <div className="relative z-10 flex-1">{children}</div>
        <footer className="relative z-10 border-t border-line-soft">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            <span>AI.Next · Agent-Native Data Spine — investor preview</span>
            {/* course-level, not lesson-level: any selected lesson/unit shows
                its own module label on the surface itself */}
            <span>Prep-3 Mathematics · MOETE 2025–2026</span>
          </div>
        </footer>
      </body>
    </html>
  );
}

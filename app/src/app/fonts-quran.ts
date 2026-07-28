import { Amiri_Quran } from "next/font/google";

/**
 * Amiri Quran — the face for Quranic passages only (ADR-0006 §3).
 *
 * Deliberately declared in its own module and NOT imported by the root layout:
 * next/font emits a font's `@font-face` into the CSS of whatever module imports
 * it, so keeping it here means the ~45 KB Arabic cut ships with the component
 * that renders scripture and with nothing else. A maths lesson never pays for
 * it. `preload: false` keeps it out of the route's preload tags too, so the
 * file is fetched only once a Quranic passage is actually laid out.
 *
 * Why a second Arabic face at all: the printed مصحف is set in Uthmani
 * orthography (ADR-0006 §2), whose marks Noto Naskh does not draw the same way.
 * Amiri Quran is the corpus's own typeface, so a vendored آية renders as
 * printed rather than as a plausible-looking approximation.
 *
 * To use it, put BOTH the variable and the class on the wrapper:
 *
 *   import { amiriQuran } from "@/app/fonts-quran";
 *   <p className={`${amiriQuran.variable} font-quran`} dir="rtl" lang="ar">…</p>
 *
 * `<QuranPassage>` (components/QuranPassage.tsx) does exactly that. Until some
 * component mounts, `--font-quran` is undefined and `.font-quran` falls back to
 * Noto Naskh, so the class is always safe to write.
 *
 * `adjustFontFallback: false` for the same reason as Noto Naskh in layout.tsx:
 * next/font's generated fallback is a `local(Arial)` face with no
 * unicode-range, and Arial's Arabic must never stand in for scripture.
 */
export const amiriQuran = Amiri_Quran({
  variable: "--font-quran",
  subsets: ["arabic"],
  weight: "400",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

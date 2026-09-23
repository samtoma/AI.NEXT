import localFont from "next/font/local";
import "./fonts/type-stack-quran.css";

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
 * Noto Naskh, so the class is always safe to write. That is still true: the
 * variable is set by a class, not on `:root`, and the class only exists in the
 * CSS this module pulls in.
 *
 * The files are vendored rather than fetched from Google during `next build`
 * — see the incident note at the top of `src/app/fonts.ts`. Both cuts are
 * here, each keeping its own `unicode-range`, because the latin cut is what
 * Google's CSS shipped for this family and dropping it is a type decision, not
 * part of a build fix.
 *
 * `adjustFontFallback: false` states the intent — next/font's metric-matched
 * fallback is a `local(...)` face with no unicode-range, and Times New Roman's
 * Arabic must never stand in for scripture. next/font/google's Turbopack path
 * ignored the flag and emitted that face anyway, so it is reproduced verbatim
 * in ./fonts/type-stack-quran.css rather than quietly dropped here: removing
 * it is a real improvement and deserves a change that says so.
 */
const amiriQuranArabic = localFont({
  src: "./fonts/amiri-quran/amiri-quran-arabic-400.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Amiri Quran'" },
    { prop: "unicode-range", value: "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1" },
  ],
});

const amiriQuranLatin = localFont({
  src: "./fonts/amiri-quran/amiri-quran-latin-400.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Amiri Quran'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

/**
 * The public handle for the face. `<QuranPassage>` reads `.variable` and
 * nothing else, which is the whole surface this needs to have.
 *
 * `variable` is the name of a CLASS, not of a next/font-generated one: the
 * class declares `--font-quran` and lives in ./fonts/type-stack-quran.css,
 * because Turbopack names a local face after its JS binding rather than after
 * the `font-family` in `declarations` — see point 2 of the note in
 * `src/app/fonts.ts`. Being a class rather than a `:root` rule is what keeps
 * the old behaviour: `--font-quran` exists only on the element that opts in,
 * so `.font-quran` elsewhere still resolves to Noto Naskh.
 *
 * No `className` / `style` here on purpose. next/font would hand back a
 * `fontFamily` naming that JS binding, which no @font-face answers to, and a
 * handle that renders nothing is worse than no handle. `cuts` exists so both
 * vendored cuts keep a live reference and neither can be tree-shaken out of
 * the CSS — a dropped cut is a unicode-range that silently stops matching.
 */
export const amiriQuran = {
  variable: "font-quran-vars",
  cuts: [amiriQuranArabic, amiriQuranLatin],
} as const;

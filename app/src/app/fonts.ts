import localFont from "next/font/local";

/* ---------------------------------------------------------------------------
   Vendored webfonts. READ THIS BEFORE "TIDYING" THEM BACK TO next/font/google.

   `next/font/google` self-hosts at runtime, but it downloads the files **during
   `next build`**. The browser never talked to Google; the build machine did.
   That is what broke the first production deploy — three CI failures on

       Module not found ... [next]/internal/font/google/baloo_bhaijaan_2_*.module.css

   because the runner could not reach fonts.googleapis.com. One re-run passed
   and two more failed, so it is a flaky third-party dependency, not a blip, and
   the on-box image build (which runs `next build` twice) would hit it the same
   way. A deploy must not depend on a third party being reachable.

   So the download moved from build time to commit time. The .woff2 files under
   ./fonts are the bytes Google's CSS API served for exactly these families,
   weights, axes and subsets, verified byte-for-byte against the
   .next/static/media output of the last build made before this change. Nothing
   a browser receives changes: same family names, same weight ranges, same
   per-subset unicode-ranges, same ten preloaded files, same `display: swap`.
   Re-vendoring is now a deliberate act with a diff, which is the point.
   (The preload set has since shrunk on purpose — the three Ledger latin cuts
   are no longer preloaded; see the note above Fraunces.)

   Rules for anyone editing this file:
     · woff2 only, and variable files stay variable. Substituting a static cut
       would silently change every intermediate weight the design system uses.
     · Baloo Bhaijaan 2 and Cairo keep BOTH their latin and arabic cuts.
       Bilingual parity is a property of the type stack, not something every
       component has to remember (constitution Principle V) — a language flip
       that arrives with no Arabic loaded is not a flip.
     · every `unicode-range` is load-bearing. It is what stops an Arabic face
       being served for Latin text and the reverse; drop it and the direction
       seam collapses into whichever @font-face happens to come first.
     · the family names and the --font-* variables are consumed by globals.css
       by literal name. A rename there is an invisible fallback to a system
       face, not a compile error.

   Why one `localFont()` call per subset: `next/font/local` has no `subsets`
   option, and its `declarations` apply to the whole call — so a per-subset
   `unicode-range` means a per-subset call. `preload` is per call too, which is
   exactly what keeps the preload set at the ten files the old `subsets: [...]`
   produced, and no more.

   Why `adjustFontFallback: false` everywhere, and why the --font-* variables
   are declared in ./fonts/type-stack.css instead of by `variable:` here —
   two Turbopack facts worth knowing before you "simplify" this:

     1. next/font/local derives the metric-matched fallback from the file with
        fontkit; next/font/google used a precomputed table. They disagree — for
        Fraunces by 12 points of `size-adjust`, for Noto Naskh Arabic by 17.
        Regenerating them would move every heading during font load, so the
        eight faces that ship today are transcribed verbatim instead.
     2. Turbopack names a local face after its **JS binding**, not after the
        `font-family` in `declarations`. The @font-face rules come out right,
        but `variable: "--font-cairo"` would emit
        `--font-cairo: "cairoArabic", …` — a name no @font-face answers to.
        So the variables are written out by hand next to the fallback faces.

   This module is imported for its side effects alone (`import "./fonts"` in
   layout.tsx). The exports exist so each cut has a name in a stack trace.
--------------------------------------------------------------------------- */

/* ---------------- the Noor families (MVP 1.0 comparison build) -------------
   Baloo Bhaijaan 2 and Cairo each ship Latin AND Arabic in one family, which
   is precisely why the handoff picked them: bilingual parity — same face, same
   size, same weight in both scripts — becomes a property of the type stack
   instead of something every component has to remember. Both Arabic cuts are
   vendored for that reason, even though MVP 1.0 ships English-first: the
   direction seam stays switchable (constitution v2.0.0 Principle V), and a
   language flip that arrives with no Arabic cut loaded is not switchable in
   any useful sense.

   IBM Plex Mono is Latin-only on purpose. It carries no Arabic script and no
   Arabic-Indic digits, so globals.css forces any Arabic run out of the mono
   stack rather than letting it fall through to an arbitrary system face. Its
   cyrillic and vietnamese cuts below are not a change of heart — they are what
   `subsets: ["latin"]` already shipped. That option only ever decided which
   cuts were *preloaded*, never which were self-hosted. */

/* ================= the Ledger faces: Fraunces and the Splines ==============
   NOT PRELOADED since 2026-09-23 (review F29,
   docs/reviews/2026-09-23-play-master-ui-review.md). With Master hidden
   (`MASTER_VARIANT_ENABLED` in lib/design-variant.ts) every page on `main`
   renders Play, whose stacks name Baloo, Cairo and IBM Plex Mono — so these
   three latin cuts were ~3 preload requests per page for faces no Play page
   paints. They stay DECLARED: the `:root` stacks in globals.css still name
   them for the attribute-less Ledger identity (the frozen baseline, and a
   checkout with AINEXT_ENVIRONMENT unset), and a page that does use them
   fetches them on first use through the normal @font-face path. Preload was
   only ever a head-start, never whether the face exists.

   When Master returns with its own published type (Baloo headings, Cairo
   body — no Fraunces), revisit this list rather than flipping these back. */

/* ============================ Fraunces — display ===========================
   Variable 100–900 carrying the opsz, SOFT and WONK axes, which is what
   `axes: ["opsz", "SOFT", "WONK"]` requested; every optical size and every
   intermediate weight still resolves out of the one file per cut. */
export const frauncesVietnamese = localFont({
  src: "./fonts/fraunces/fraunces-vietnamese-wght.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Fraunces'" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
});

export const frauncesLatinExt = localFont({
  src: "./fonts/fraunces/fraunces-latin-ext-wght.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Fraunces'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

export const frauncesLatin = localFont({
  src: "./fonts/fraunces/fraunces-latin-wght.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false, // Ledger face — not preloaded while Master is hidden (review F29)
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Fraunces'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

/* ========================= Spline Sans — body text ========================= */
export const splineSansLatinExt = localFont({
  src: "./fonts/spline-sans/spline-sans-latin-ext-wght.woff2",
  weight: "300 700",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Spline Sans'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

export const splineSansLatin = localFont({
  src: "./fonts/spline-sans/spline-sans-latin-wght.woff2",
  weight: "300 700",
  style: "normal",
  display: "swap",
  preload: false, // Ledger face — not preloaded while Master is hidden (review F29)
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Spline Sans'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

/* ======================= Spline Sans Mono — mono UI ======================== */
export const splineSansMonoLatinExt = localFont({
  src: "./fonts/spline-sans-mono/spline-sans-mono-latin-ext-wght.woff2",
  weight: "300 700",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Spline Sans Mono'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

export const splineSansMonoLatin = localFont({
  src: "./fonts/spline-sans-mono/spline-sans-mono-latin-wght.woff2",
  weight: "300 700",
  style: "normal",
  display: "swap",
  preload: false, // Ledger face — not preloaded while Master is hidden (review F29)
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Spline Sans Mono'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

/* ==================== Baloo Bhaijaan 2 — Play display ======================
   Three discrete weight descriptors over ONE variable file, exactly as Google
   served it: the browser instantiates the wght axis at 600, 700 or 800, and a
   request for 650 snaps to the nearest declared face. Declaring a "600 800"
   range instead would render 650 at 650 — a different type stack. */
export const balooBhaijaan2Arabic = localFont({
  src: [
    { path: "./fonts/baloo-bhaijaan-2/baloo-bhaijaan-2-arabic-wght.woff2", weight: "600" },
    { path: "./fonts/baloo-bhaijaan-2/baloo-bhaijaan-2-arabic-wght.woff2", weight: "700" },
    { path: "./fonts/baloo-bhaijaan-2/baloo-bhaijaan-2-arabic-wght.woff2", weight: "800" },
  ],
  style: "normal",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Baloo Bhaijaan 2'" },
    { prop: "unicode-range", value: "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1" },
  ],
});

export const balooBhaijaan2Vietnamese = localFont({
  src: [
    { path: "./fonts/baloo-bhaijaan-2/baloo-bhaijaan-2-vietnamese-wght.woff2", weight: "600" },
    { path: "./fonts/baloo-bhaijaan-2/baloo-bhaijaan-2-vietnamese-wght.woff2", weight: "700" },
    { path: "./fonts/baloo-bhaijaan-2/baloo-bhaijaan-2-vietnamese-wght.woff2", weight: "800" },
  ],
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Baloo Bhaijaan 2'" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
});

export const balooBhaijaan2LatinExt = localFont({
  src: [
    { path: "./fonts/baloo-bhaijaan-2/baloo-bhaijaan-2-latin-ext-wght.woff2", weight: "600" },
    { path: "./fonts/baloo-bhaijaan-2/baloo-bhaijaan-2-latin-ext-wght.woff2", weight: "700" },
    { path: "./fonts/baloo-bhaijaan-2/baloo-bhaijaan-2-latin-ext-wght.woff2", weight: "800" },
  ],
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Baloo Bhaijaan 2'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

export const balooBhaijaan2Latin = localFont({
  src: [
    { path: "./fonts/baloo-bhaijaan-2/baloo-bhaijaan-2-latin-wght.woff2", weight: "600" },
    { path: "./fonts/baloo-bhaijaan-2/baloo-bhaijaan-2-latin-wght.woff2", weight: "700" },
    { path: "./fonts/baloo-bhaijaan-2/baloo-bhaijaan-2-latin-wght.woff2", weight: "800" },
  ],
  style: "normal",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Baloo Bhaijaan 2'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

/* ========================= Cairo — Play reading face ======================= */
export const cairoArabic = localFont({
  src: "./fonts/cairo/cairo-arabic-wght.woff2",
  weight: "200 1000",
  style: "normal",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Cairo'" },
    { prop: "unicode-range", value: "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1" },
  ],
});

export const cairoLatinExt = localFont({
  src: "./fonts/cairo/cairo-latin-ext-wght.woff2",
  weight: "200 1000",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Cairo'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

export const cairoLatin = localFont({
  src: "./fonts/cairo/cairo-latin-wght.woff2",
  weight: "200 1000",
  style: "normal",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Cairo'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

/* ===================== IBM Plex Mono — the label voice ===================== */
export const ibmPlexMonoCyrillicExt = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-cyrillic-ext-400.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-cyrillic-ext-500.woff2", weight: "500" },
  ],
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'IBM Plex Mono'" },
    { prop: "unicode-range", value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F" },
  ],
});

export const ibmPlexMonoCyrillic = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-cyrillic-400.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-cyrillic-500.woff2", weight: "500" },
  ],
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'IBM Plex Mono'" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

export const ibmPlexMonoVietnamese = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-vietnamese-400.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-vietnamese-500.woff2", weight: "500" },
  ],
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'IBM Plex Mono'" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
});

export const ibmPlexMonoLatinExt = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-latin-ext-400.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-latin-ext-500.woff2", weight: "500" },
  ],
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'IBM Plex Mono'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

export const ibmPlexMonoLatin = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-latin-400.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-latin-500.woff2", weight: "500" },
  ],
  style: "normal",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'IBM Plex Mono'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

/* ==================== Noto Naskh Arabic — Arabic body ======================
   Loaded from the root layout, and therefore preloaded on every route, because
   Arabic is the primary script for the Arabic verticals: `display: swap`
   without a preload means the most important text on the page reflows late on
   a 3G connection. Only the arabic cut is preloaded (93,960 B), exactly as
   `subsets: ["arabic"]` did.

   The latin / latin-ext / math / symbols cuts below never render anything —
   Fraunces and Spline win every Latin character (see the font-stack note in
   globals.css) — but a page containing a character the Latin faces lack (Greek
   maths letters φ σ θ α, arrows → ⇢ ↳, operators ≈ ≠, dingbats ✓ ✕ ✦ ✳)
   matches their unicode-range, so the browser fetches the cut, finds the glyph
   missing from its cmap too, and falls through to the system font. Measured
   dead weight: latin 19,732 B, math 14,248 B, symbols 9,404 B, whichever apply
   to the page. Deleting them is now a four-line change here rather than a
   fight with the loader — but it is a type decision, not part of a build fix,
   so they are vendored exactly as they ship.

   Variable weight (400–700) is one file for every weight the UI uses. The
   static 400 cut is ~43 KB smaller but leaves the browser to synthesise bold,
   which smears تشكيل — the one thing this font is here to render correctly. */
export const notoNaskhArabicArabic = localFont({
  src: "./fonts/noto-naskh-arabic/noto-naskh-arabic-arabic-wght.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Noto Naskh Arabic'" },
    { prop: "unicode-range", value: "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1" },
  ],
});

export const notoNaskhArabicMath = localFont({
  src: "./fonts/noto-naskh-arabic/noto-naskh-arabic-math-wght.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Noto Naskh Arabic'" },
    { prop: "unicode-range", value: "U+0302-0303, U+0305, U+0307-0308, U+0310, U+0312, U+0315, U+031A, U+0326-0327, U+032C, U+032F-0330, U+0332-0333, U+0338, U+033A, U+0346, U+034D, U+0391-03A1, U+03A3-03A9, U+03B1-03C9, U+03D1, U+03D5-03D6, U+03F0-03F1, U+03F4-03F5, U+2016-2017, U+2034-2038, U+203C, U+2040, U+2043, U+2047, U+2050, U+2057, U+205F, U+2070-2071, U+2074-208E, U+2090-209C, U+20D0-20DC, U+20E1, U+20E5-20EF, U+2100-2112, U+2114-2115, U+2117-2121, U+2123-214F, U+2190, U+2192, U+2194-21AE, U+21B0-21E5, U+21F1-21F2, U+21F4-2211, U+2213-2214, U+2216-22FF, U+2308-230B, U+2310, U+2319, U+231C-2321, U+2336-237A, U+237C, U+2395, U+239B-23B7, U+23D0, U+23DC-23E1, U+2474-2475, U+25AF, U+25B3, U+25B7, U+25BD, U+25C1, U+25CA, U+25CC, U+25FB, U+266D-266F, U+27C0-27FF, U+2900-2AFF, U+2B0E-2B11, U+2B30-2B4C, U+2BFE, U+3030, U+FF5B, U+FF5D, U+1D400-1D7FF, U+1EE00-1EEFF" },
  ],
});

export const notoNaskhArabicSymbols = localFont({
  src: "./fonts/noto-naskh-arabic/noto-naskh-arabic-symbols-wght.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Noto Naskh Arabic'" },
    { prop: "unicode-range", value: "U+0001-000C, U+000E-001F, U+007F-009F, U+20DD-20E0, U+20E2-20E4, U+2150-218F, U+2190, U+2192, U+2194-2199, U+21AF, U+21E6-21F0, U+21F3, U+2218-2219, U+2299, U+22C4-22C6, U+2300-243F, U+2440-244A, U+2460-24FF, U+25A0-27BF, U+2800-28FF, U+2921-2922, U+2981, U+29BF, U+29EB, U+2B00-2BFF, U+4DC0-4DFF, U+FFF9-FFFB, U+10140-1018E, U+10190-1019C, U+101A0, U+101D0-101FD, U+102E0-102FB, U+10E60-10E7E, U+1D2C0-1D2D3, U+1D2E0-1D37F, U+1F000-1F0FF, U+1F100-1F1AD, U+1F1E6-1F1FF, U+1F30D-1F30F, U+1F315, U+1F31C, U+1F31E, U+1F320-1F32C, U+1F336, U+1F378, U+1F37D, U+1F382, U+1F393-1F39F, U+1F3A7-1F3A8, U+1F3AC-1F3AF, U+1F3C2, U+1F3C4-1F3C6, U+1F3CA-1F3CE, U+1F3D4-1F3E0, U+1F3ED, U+1F3F1-1F3F3, U+1F3F5-1F3F7, U+1F408, U+1F415, U+1F41F, U+1F426, U+1F43F, U+1F441-1F442, U+1F444, U+1F446-1F449, U+1F44C-1F44E, U+1F453, U+1F46A, U+1F47D, U+1F4A3, U+1F4B0, U+1F4B3, U+1F4B9, U+1F4BB, U+1F4BF, U+1F4C8-1F4CB, U+1F4D6, U+1F4DA, U+1F4DF, U+1F4E3-1F4E6, U+1F4EA-1F4ED, U+1F4F7, U+1F4F9-1F4FB, U+1F4FD-1F4FE, U+1F503, U+1F507-1F50B, U+1F50D, U+1F512-1F513, U+1F53E-1F54A, U+1F54F-1F5FA, U+1F610, U+1F650-1F67F, U+1F687, U+1F68D, U+1F691, U+1F694, U+1F698, U+1F6AD, U+1F6B2, U+1F6B9-1F6BA, U+1F6BC, U+1F6C6-1F6CF, U+1F6D3-1F6D7, U+1F6E0-1F6EA, U+1F6F0-1F6F3, U+1F6F7-1F6FC, U+1F700-1F7FF, U+1F800-1F80B, U+1F810-1F847, U+1F850-1F859, U+1F860-1F887, U+1F890-1F8AD, U+1F8B0-1F8BB, U+1F8C0-1F8C1, U+1F900-1F90B, U+1F93B, U+1F946, U+1F984, U+1F996, U+1F9E9, U+1FA00-1FA6F, U+1FA70-1FA7C, U+1FA80-1FA89, U+1FA8F-1FAC6, U+1FACE-1FADC, U+1FADF-1FAE9, U+1FAF0-1FAF8, U+1FB00-1FBFF" },
  ],
});

export const notoNaskhArabicLatinExt = localFont({
  src: "./fonts/noto-naskh-arabic/noto-naskh-arabic-latin-ext-wght.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Noto Naskh Arabic'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

export const notoNaskhArabicLatin = localFont({
  src: "./fonts/noto-naskh-arabic/noto-naskh-arabic-latin-wght.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Noto Naskh Arabic'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

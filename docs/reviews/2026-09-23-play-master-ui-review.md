# Play and Master — UI review

**Snapshot, 2026-09-23, `main` at `a3208fa` (v0.5.0 + deploy fixes).** Written after Samuel reported
"a lot of bad UI and conflict of UI with the play view and the master view". Like every file in this
folder it is a record of what was believed on the day and is not edited afterwards; the living
backlog is the GitHub issues labelled `ui-variants`, listed at the end.

Visual version (screenshots, token table, component comparison):
<https://claude.ai/artifact/NTUidvZjBr3BRaTLpe4ZYp> (private to Samuel until shared).

## The answer in one paragraph

Master was specified, built, overwritten, and then brought back under its name with the wrong
palette. The design system defines two age variants of one brand — **Play** (Prep, loud, sticker
outlines) and **Master** (Secondary, hairlines, soft shadows, Baloo for headings only) — and a third
theme, **Ledger**, which is the frozen family-tutor product and not an age variant. Today
`[data-ds="master"]` inherits the `:root` Ledger palette, while the components still carry the Play
look as fixed values. Every Master screen, and therefore the whole console (operators default to
Master), mixes three identities: Play's controls, Ledger's paper and serif type, and Ledger's red.

## How it happened

| Date | Commit | What |
|---|---|---|
| 2026-09-10 | `df1bf29` | Noor **Master v0.2** implemented verbatim (under `[data-ds="nour"]`): cool paper, hairlines, Cairo with Baloo headings. It worked. |
| 2026-09-16 | `bb0bd1e` | **Play** overwrites the same block (ADR-0011: "Master is replaced, not retained"). Student, chat and auth components get Play shapes written in as fixed values (3px ink, 20px radii, sticker shadows). The console is not swept. |
| 2026-09-20 | `3db8981` | ADR-0017 brings two variants back, keyed to grade, but its Context names them "play and ledger" and records Master's anatomy as "not published". The design system had gained its Master columns about three hours earlier. |
| 2026-09-21 | P2–P6, `c58cb02` | Every MVP1 page still carries the Play attribute, so the console is built and eyeballed in Play. |
| 2026-09-22 | `85fe3b8` | FR-1011 implemented on ADR-0017's wording: `[data-ds="master"]` becomes an empty name that inherits Ledger; the comment naming "the v0.2 Master skin" is deleted; the console defaults to Master. Overnight every console page flips to Ledger. |
| 2026-09-22 | `04849f0`, `45f14e4` | Feedback and health console pages are built after the flip, inside the hybrid. No test renders any screen in both skins, so no build ever failed. |

## Four causes

1. **Master points at the wrong theme** — choosing Master yields Ledger: ruled grid and grain,
   Fraunces serif, viridian accent, red for wrong answers.
2. **Components hard-code Play** — 140 fixed outlines, corners, shadows and colours in 46 files
   (+6 in 2 `.ts` files), instead of tokens both variants define.
3. **Play-only tokens and states vanish in Master** — amber action, disabled, focus, press and the
   grey wrong-answer exist only under Play: 110 Play-only class uses in 19 files do nothing in
   Master; 7 Play-only token declarations have no fallback at all.
4. **The console lives in the hybrid** — operators default to Master; faint labels there read at
   2.73:1 on paper (3.05:1 on cards) against a 4.5:1 minimum.

## Findings

Severity: **P0** broken · **P1** wrong-looking · **P2** inconsistent · **P3** polish. Paths relative to
`app/src/`.

| ID | Sev | Skin | Screen | File | What a user sees | Fix direction |
|---|---|---|---|---|---|---|
| F1 | P0 | Master | Student dashboard, empty | `app/(student)/dashboard/page.tsx:79-80` | "Start practising" is plain text — its amber fill resolves to nothing | Master defines `--noor-action`/`--noor-on-action` |
| F2 | P0 | Master | Maths check-in | `components/student/LessonCheckIn.tsx:275` | Recommended row loses its amber; the recommendation disappears | Same |
| F3 | P0 | Master | Arabic/Social check-in | `LessonCheckIn.tsx:407` | "Start" button is bare text | Same |
| F4 | P1 | Master | Console + all auth screens | `components/auth/Controls.tsx:103,219,234,251,271`; `GoogleButton.tsx:53`; `OutstandingScreen.tsx:30-74`; `SignupForm.tsx:183,239`; `app/(auth)/layout.tsx:25` | 3px ink inputs, serif buttons, amber CTA on grid paper and grain | Shared stroke/radius/shadow tokens + a UI-font role |
| F5 | P1 | Master | Sign-in, sign-up | `auth/GoogleButton.tsx:33` | Disabled "Continue with Google" looks enabled | Master disabled treatment |
| F6 | P1 | Master | Lesson chat, report card, widgets | `chat/ChatCore.tsx:1242-1243`; `LessonSession.tsx:1317,1515`; `ReportCard.tsx:37-39` (+~97 rust uses in 24 files) | Red "Not yet" button, red mic, red "Needs work" stamp and gauge | Master maps `--rust` to grey, `--m-*` to the ramp |
| F7 | P1 | Master | Console, every page | `components/console/ui.tsx:49,95` + 158 `text-ink-faint` sites | Panel titles, periods, footers at 2.73:1 — fails AA | Master faint text `#5d5b6e` (6.13:1) |
| F8 | P1 | Master | Console attention chips/banners | `ui.tsx:193`; `ProvenanceBadge.tsx:27`; `CourseAvailabilityGrid.tsx:340`; `feedback/page.console.tsx:200` | Gold on gold tint 3.13:1 at 10px | Master gold text ≈ `#a34f0a` (5.31:1); not df1bf29's `#d98c1f` (2.53:1) |
| F9 | P1 | Both | Console content/pipeline | `components/ProvenanceBadge.tsx:29` | "Confirmed" badge teal on teal tint, 2.74:1 at 9.5px | Ink text, or the progress pair |
| F10 | P1 | Play | Console with Play | `ui.tsx:45,193`; `CourseAvailabilityGrid.tsx:322,361,521-549` | 3px ink outline on every panel, 10px chip and 20px micro-button; Baloo and loose leading in dense tables | Stroke-sm under 40px, real targets, tighter data type |
| F11 | P1 | Play | Console overview heatmap | `overview/page.console.tsx:561,578` | "Never reached" cells get 3px dashed ink and look darker than cells with data | Hairline / inactive treatment |
| F12 | P2 | Both | Console session replay | `chat/message-blocks.tsx:58,81` via `console/ReplayTranscript.tsx:37` | Replay renders in the operator's skin, not the student's (ADR-0015 §3 claims it cannot drift) | Render in the student's recorded skin (ADR note), or label it |
| F13 | P2 | Both | Student home | `student/SubjectHome.tsx:127` | Subject colour coding silently dropped — `.ledger-card` (unlayered) beats the utilities; all cards identical white | Card component with a subject prop |
| F14 | P2 | Play | Report card | `ReportCard.tsx:164,229,252-273`; `FeedbackPrompt.tsx:246,287` | Ledger passport card and rotated stamp beside sticker buttons; feedback button flat | Components valid in both variants |
| F15 | P2 | Master | Report card | `ReportCard.tsx:252,267,273` | One button row, three border weights | Per-variant stroke token |
| F16 | P2 | Master | Header / account menu | `NavLinks.tsx:193,204,220,229` | Thick "Omar ▾" pill and serif menu next to hairline nav pills | Tokens + UI-font role |
| F17 | P2 | Play | Arabic/Social check-in | `LessonCheckIn.tsx:388` vs `:416` | One card sticker shadow, the other a soft viridian glow | Tokens only |
| F18 | P2 | Play | Lesson widgets / visuals | `student/widgets/*` (11 viridian shadows); `widgets/HamzaSeat.tsx:96` (red); `viz/arabic-ui.tsx:34-44`; `viz/MapScene.tsx:50,247` | Ledger viridian and red literals inside Play lessons | Tokens only |
| F19 | P2 | Play | `/spine` Evidence Walk | `spine/SpineExplorer.tsx:271`; `spine/GraphCanvas.tsx:240-424` | Ledger mastery legend including red | `lib/mastery.ts` / `--mastery-*` |
| F20 | P2 | Play | Signed-in `/` | `app/(student)/page.student.tsx:28-160,241` | The whole Ledger "Investor preview" page; hover glows never fire | Rebuild on tokens (or retire — product call) |
| F21 | P2 | Both | Mastery colours | `lib/mastery.ts:38-44` | Ramp as fixed hex; in Master the same score is amber→teal on home and red→green on reports | `var(--mastery-*)` in both variants |
| F22 | P2 | Play | Settings, skin picker | `components/DesignVariantPicker.tsx:130-133` | Disabled Save + `disabled:opacity` → 1.76:1, looks broken | Drop the opacity under Play |
| F23 | P2 | Master | Lesson, report | `LessonSession.tsx:1171`; `ReportCard.tsx:164` | Finish nudge and celebration animations missing; `.anim-mastered` undefined for Master | Master motion block |
| F24 | P2 | Master | Every Master page | `app/globals.css:115-143`; `LessonCheckIn.tsx:76` | Ruled grid, viridian vignette, grain behind console and student-Master screens | Master: flat `#f7f6fb` |
| F25 | P3 | Master | Console | `app/(console)/layout.console.tsx:73` | Fixed grain overlay paints over console text and tables | Stack content above it; moot once Master drops grain |
| F26 | P2 | Config | Fresh checkout / captures | `lib/env.ts:30`; `app/layout.tsx:117`; `.env.example` | `AINEXT_ENVIRONMENT` unset → no `data-ds` at all | Add to `.env.example`; fail captures lacking it |
| F27 | P3 | Both | Chat bubbles | `ChatCore.tsx:977`; `message-blocks.tsx:58,80` | 13px message text (spec 1rem); Play's radius rule removes the tail corner | Tokens |
| F28 | P3 | Both | Typography | 75 `font-display font-medium` sites; 11 headings at line-height 1.04–1.25 (e.g. `page.student.tsx:34`) | Headings written for Fraunces render as Baloo and collide; Master buttons in heavy serif | UI-font role; display type for headings only |
| F29 | P3 | Both | Performance | `app/fonts.ts` | 9 preloaded files for both skins' fonts on every page | Preload per variant |

Negatives confirmed: the ink-on-viridian pairing does not occur anywhere; every page carries a
named variant when the environment is set; no page flips skin after first paint.

### Worst-looking screens

| # | Master | Play |
|---|---|---|
| 1 | Console sign-in and all auth screens (F4, F5) | Console with Play chosen (F10, F11) |
| 2 | Maths check-in (F2) | Report card (F14) |
| 3 | Dashboard empty state (F1) | Signed-in `/` (F20) |
| 4 | Lesson chat (F6, F23) | Arabic/Social check-in (F17) |
| 5 | Report card (F6, F15) | `/spine` (F19) |
| 6 | Arabic/Social check-in (F3) | Lesson widgets (F18) |
| 7 | Console overall (F7, F8, F24, F25) | Student home (F13) |
| 8 | Header and account menu (F16) | Settings picker (F22) |
| 9 | Student home (F13, F21) | Chat (F27) |
| 10 | Widgets in lessons (F6, F18) | Header (mild) |

## What Master needs (for when it comes back)

The published Master theme (design system `tokens.json`, synced 2026-09-20; mockups in
`docs/design/noor/{Welcome,Main,Progress}.dc.html`) supplies: paper `#f7f6fb`, paper-deep `#efeef6`,
card `#ffffff`, ink `#2b2a38`, ink-soft / ink-faint `#5d5b6e`, line / line-soft `#e6e4f0`, accent
`#1e2450`, text-inverse `#f2f1f7`; the shared core (action `#f0a22f`, hover `#d98c1f`, on-action
`#141833`, progress `#2f9e8f`, on-progress `#241f3d`, celebrate `#6e4fa8`, the mastery ramp);
`master-stroke 1px`, radii 8/12/16, `master-shadow-sm 0 2px 8px rgba(30,36,80,.08)`,
`master-shadow-lg 0 12px 32px rgba(30,36,80,.16)`, `master-touch-min 44px`; Baloo for headings only,
Cairo for everything else.

It leaves about fifteen tokens the code uses undefined (card-warm, accent-deep/-wash, gold/-wash,
rust/-wash, `m-low/mid/high`, subject hues, disabled, the student bubble, amber and link text).
Those need values before Master can ship.

## Options considered

- **A — implement the published Master** (recommended as the real fix): restore values, fill the
  gaps, give every Play-only token and class a Master version, move the 140 fixed values to shared
  tokens, take Ledger off `main`, add a both-skins capture and a Principle XII lint. ~1 day for the
  token block, 2–4 days for the migration.
- **B — Play everywhere** until A lands: no Ledger anywhere at once, but the console in Play has its
  own defects (F10, F11).
- **C — contain**: hide Master from students, one console skin, no picker.

Open design calls: disabled in Master; input edges (the published hairline is 1.3:1, a field
boundary needs 3:1 — proposed `#85829b`, 3.7:1); subject colours in Master; whether the console
keeps a picker; which skin a replay uses (F12); neutral shared token names.

## Decision on the day

Samuel: **hide Master now, fix the Play findings, keep the Master work as a backlog.** Play becomes
the only skin for students and operators behind a single switch; Master returns when option A is
done. Recorded as the 2026-09-23 amendment to ADR-0017.

## Backlog

Tracked in GitHub issues labelled `ui-variants`; the tracking issue is
[#51](https://github.com/samtoma/AI.NEXT/issues/51).

| Issue | What |
|---|---|
| [#45](https://github.com/samtoma/AI.NEXT/issues/45) | Play fixes (F9–F11, F13, F14, F17–F22, F26–F29) and Master hidden — done on the day |
| [#50](https://github.com/samtoma/AI.NEXT/issues/50) | Decisions needed before Master returns |
| [#46](https://github.com/samtoma/AI.NEXT/issues/46) | Master step 1 — published tokens and states (F1–F3, F5–F8, F23–F25) |
| [#47](https://github.com/samtoma/AI.NEXT/issues/47) | Master step 2 — components read shared tokens (F4, F15, F16, F28) |
| [#48](https://github.com/samtoma/AI.NEXT/issues/48) | Take the Ledger identity off `main` |
| [#49](https://github.com/samtoma/AI.NEXT/issues/49) | Guardrails — every screen in every skin, Principle XII lint (F26) |

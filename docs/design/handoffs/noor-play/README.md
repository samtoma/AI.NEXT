# Handoff: Nour PLAY — Design System (ages 10–16)

## Overview

Nour Play is **Variant A** of the Nour design system: a louder, more physical,
character-led interface for students aged **10–16**. It exists because the master
system is tuned for Grades 10–12 — restrained and slightly editorial, because a
sixteen-year-old is embarrassed by anything that looks like a kids' app. Run that same
interface at a twelve-year-old and it reads as homework.

**This system layers on the Nour master system v0.2.** Anything not specified here
falls back to master. The sibling bundle `design_handoff_nour_master` contains that
system. **Do not mix the two in one build** — pick by target age (10–16 → Play,
15–18 → master).

It is primarily a **web and iPad** product. The phone layout is the collapse, not the
starting point.

## About the design files

The files in `reference/` are **design references created in HTML** — prototypes
showing intended look, structure and behaviour. They are **not production code to copy
directly.**

`Nour Play Design System.dc.html` is a *documentation* page: it renders the design
system itself (swatches, motion demos, component anatomy, device layouts) rather than
being the product. Read it as the spec, then **recreate the described screens in your
target codebase's existing environment** — React, Vue, SwiftUI, Flutter, native — using
its established patterns and component library. If no environment exists yet, choose
the most appropriate framework and implement there.

The HTML uses inline styles and a small custom runtime (`support.js`) purely so the
document renders standalone. **Do not port that architecture.** Port the *values* from
`tokens.css` / `tokens.json` and the *rules* from `CLAUDE.md`.

To view: open `reference/Nour Play Design System.dc.html` in a browser. Needs network
access for Google Fonts.

## Fidelity

**High-fidelity.** All colours, typography, spacing, radii, stroke weights, shadow
offsets, motion timings and contrast ratios are final and specified exactly.

Two deliberate exceptions:
- **Subject icons** are shown as blank outlined squares in the reference. The rules are
  specified (28px, 2.5px stroke, 8px radius, white or Honey fill on a playmate tile) but
  the glyphs are not drawn. Use your icon library restyled to those rules.
- **No illustration or empty-state artwork** exists. Ask before inventing any.

---

## Files in this bundle

| File | What it is |
|---|---|
| `CLAUDE.md` | **Start here.** Drop at repo root. The enforceable rules, compressed for an agent. |
| `tokens.css` | CSS custom properties, the seven keyframes, and the `.play-pressable` press behaviour. Import once at the app entry. |
| `tokens.json` | Same values, machine-readable — for Tailwind config, JS themes, iOS/Android generators. |
| `reference/Nour Play Design System.dc.html` | The full visual spec document. |
| `reference/nour-friend.svg` | The logo mark / companion character. Production asset. |
| `reference/support.js` | Runtime needed only to view the reference HTML. Do not port. |

---

## Why this variant exists

Ages 10–16 need feedback that is **immediate and physical**, and a companion that
**visibly reacts** — that's the difference between a session finished and a session
abandoned.

### Where it deliberately departs from the master system
Stated openly, because a variant that pretends to obey everything ends up obeying
nothing.

| Master rule | Play variant | Because |
|---|---|---|
| Baloo for headlines only | **Baloo runs the entire UI** | Rounded type reads as friendly rather than institutional. At this age the interface itself has to look approachable, not just the headline. |
| 1px hairline borders, soft shadows | **3px ink outline + hard offset shadow** | Objects need to look physically pressable, and it gives every control an unmistakable pressed state without a colour change. |
| Radius 8/12/16 | **Radius 14/20/28** | Chunkier shapes read as toys rather than forms, and larger radii pair with the heavier stroke without looking cramped. |
| Touch target 44px | **Touch target 52px** | Younger students tap faster and less precisely, frequently on a shared or damaged device. |
| One signature spring | **Seven named response animations** | Immediate physical feedback keeps a twelve-year-old in the session — but every animation must answer an action, never idle. |
| Paper `#F7F6FB` ground | **Cream `#FFF6E6` ground** | A warmer, more saturated ground holds the heavier outlines without the page looking clinical. |

### What does not bend
Playful in the details, never in the substance. **Louder does not mean manipulative.**

- No red for wrong answers. No leaderboards. No comparison to other students.
- Help is never withheld to drive engagement.
- Every reward marks something the student actually learned — never time spent, never
  a login.
- Stopping is offered as warmly as continuing.

---

## Design tokens

Full values in `tokens.css` and `tokens.json`. Summary:

### The sticker system — the one structural idea

| Token | Value | Note |
|---|---|---|
| `--play-stroke` | `3px` solid `#241F3D` | `2.5px` on anything under 40px tall |
| `--play-shadow` | `4px 4px 0 #241F3D` | **Hard offset. No blur, ever.** |
| `--play-shadow-sm` / `-lg` / `-xl` | `3px` / `6px` / `7px` | small elements / big cards / device frames |
| `--play-press-offset` | `4px` | travel on press; shadow collapses to `0` |
| Radius | `14` / `20` / `28` / `999` | chips-inputs / buttons-small cards / big cards-sheets / pills |
| `--play-target-min` | `52px` | **holds on desktop with a mouse too** |

**These are absolute values and must never scale with the viewport.** The illusion
depends on them reading as a physical cut edge.

**The press** is the single highest-value interaction in the kit — it does more for
perceived responsiveness than any loading state. `tokens.css` ships it as
`.play-pressable`; wire it to every control.

### Colour

| Token | Hex | Job |
|---|---|---|
| `--play-bg-page` | `#FFF6E6` Cream | The ground. Warmer and more saturated than master's Paper. |
| `--play-bg-surface` | `#FFFFFF` | Cards, Nour's bubbles. |
| `--play-bg-warm` | `#FFE9BD` Honey | Headers, banners, celebration badges. The friendly band. |
| `--play-ink` | `#241F3D` Deep Ink | Body text **and every single outline and shadow**. |
| `--play-action` | `#F0A22F` Nour Glow | Unchanged from master. One primary per screen. |
| `--play-mastery` | `#2F9E8F` Grow Teal | Mastery badges, final ramp stage. |
| `--play-celebrate` | `#7B4FC9` Party Violet | Celebration only. Brighter than master's violet so it can carry a full-bleed screen. |
| `--play-sky` | `#7FD1F0` | Playmate. Subject coding, student chat bubbles. |
| `--play-leaf` | `#B6E88F` | Playmate. **Correct answers** and subject coding. |
| `--play-berry` | `#FFA8C5` | Playmate. Subject coding, highlight bands. **Never a warning.** |

**Paired foregrounds — use these, don't pick by eye:**

| Background | Foreground | Ratio |
|---|---|---|
| amber `#F0A22F` | `#241F3D` | 8.1:1 — **never white** (2.1:1) |
| teal `#2F9E8F` | `#241F3D` | 4.79:1 — **never white** (3.28:1) |
| violet `#7B4FC9` | `#FFFFFF` / dim `#F0E9FB` | 7.4:1 |
| sky `#7FD1F0` | `#0F3D51` / dim `#134B63` | |
| leaf `#B6E88F` | `#1F3D12` / dim `#3A5B26` | |
| berry `#FFA8C5` | `#7A2447` / dim `#6E2440` | |
| Honey `#FFE9BD` | `#6B5A2E`, small mono on amber `#5E3806` | |

**Text greys on Cream/white:** `#4A4266` secondary body · `#5A5570` labels, option
letters, inactive nav · `#615B7D` mono eyebrows in cards · `#655B80` section
eyebrows · `#136386` tertiary actions and links · `#A34F0A` amber-family text.

`--play-ink-soft: #6B6489` is for supporting copy at 0.9rem+. Below that use
`--play-text-muted`. `#8A83A6` is permitted **only** on an element carrying
`[disabled]`.

**There is no red in this palette.** Correct = leaf green. Wrong = grey fill + nudge.

### Typography

**Baloo runs the whole UI** — the biggest visible break from master.

| Step | Size | Face | Use |
|---|---|---|---|
| Display | 2.4rem | Baloo 800 | Celebrations, screen titles, the big equation |
| Title | 1.5rem | Baloo 800 | Card titles, quest names, student name |
| **UI** | **1.15rem** | **Baloo 700** | **Buttons, answer options — the workhorse** |
| Label | 0.85rem | Baloo 700 / Cairo 700 | Chips, nav labels, badges, counters |
| Reading | 1rem | Cairo 400 | **Any passage over three lines** |
| Data | 0.72rem | IBM Plex Mono 500 | Step counters, timers, Latin-only labels |

- Display never below 1.3rem and never in a paragraph.
- Cairo takes over past three lines — rounded type is friendly for six words and tiring
  for sixty.
- Arabic and English at **equal size and weight**. Arabic line-height 1.9, Latin 1.75.
  **Never letter-space Arabic.**
- **IBM Plex Mono carries no Arabic script and no Arabic-Indic digits (`٠–٩`).** Wrap
  any Arabic run inside a mono element in a Cairo span with
  `letter-spacing: normal`, or move the whole label to Cairo. This bug recurred
  several times during design — add a lint rule if you can.

### Spacing

Same 8px rhythm as master: `8 / 16 / 24 / 32 / 48`. Tap targets **52px minimum**.

---

## Devices & breakpoints — web and iPad first

| Class | Width | Structure | Notes |
|---|---|---|---|
| **Web · canonical** | 1280pt+ | **Three pane — 88px icon rail / workspace / 340px Nour panel** | Design this first. The companion panel never collapses at this width. |
| **iPad landscape** | 1024–1194pt | **Two pane — 80px rail / workspace / 300px Nour panel** | Same component sizes as web; only pane widths change. The quest map drops out. |
| iPad portrait | 744–1023pt | Rail + workspace; Nour docks to a bottom sheet | A 300px panel here would squeeze the workspace below usable width. |
| Phone | 360–430pt | Single column, bottom nav, inline avatar | The collapse. Quest map becomes the header bar. |
| Split View | ≤700pt effective | Phone layout wholesale | **No intermediate layout exists — test explicitly.** |

### The order of work
**Design 1360 web first → mirror to iPad by changing only pane widths → collapse to
phone last. Never the reverse.** Phone-first produces a companion that hides in a tab
and a quest map that never existed — two things this variant depends on. Going the
other direction, the collapse is mechanical and nothing is lost.

### Scaling rules
| Rule | Detail | Don't |
|---|---|---|
| **The sticker** | 3px stroke, 4px shadow, 14/20/28 radii — absolute at every viewport | `stroke: 0.3vw`, or radius growing with the card |
| **Type** | Workspace body stays 1rem, options stay 1.15rem from 360→1920pt. Only the equation card grows (focal display, not UI) | Scaling the type ramp per breakpoint |
| **Targets** | 52px holds on desktop with a mouse. Chunky targets are the variant's character | Shrinking to 32px because there's a cursor |
| **Measure** | Workspace 820px · text 64ch · card grids 2 columns · options 1 col phone / 2 above, never 3+ | Grids filling to auto-fit at any width |
| **Hover** | Additive only, behind `@media (hover: hover) and (pointer: fine)` | Unconditional hover — leaves sticky state on iPad |
| **RTL** | Rail moves to the end side, panel to the start side, chat notches flip with them. Logical properties throughout | Hardcoding `border-left` on the rail |

---

## Screens / views

### Web · three pane at 1360×800 (reference layout, LTR)

**Purpose:** the canonical study session.

**Layout:**
- **Icon rail, 88px fixed**, `border-inline-end: 3px solid ink`, white. Contains the
  52px companion badge (bobbing), a 2px `#EDE9F5` divider, then 56px nav tiles at
  18px radius: active = amber fill + 3px ink + `3px 3px 0` shadow; inactive = 2.5px
  `#B4AECB` border, no fill, no shadow, label `#5A5570`.
- **Workspace, flex:1.** Header band: Honey fill, `border-block-end: 3px solid ink`,
  18px/28px padding — Title 1.5rem skill name, a white "Quest 3 of 4" pill, an 18px
  quest bar (2.5px ink border, 2px inner padding, amber fill on white) capped at 280px,
  then a mono "5 MIN LEFT" pushed to the end.
  Body: 28px padding, **capped at 820px** — the leftover width becomes empty Cream,
  deliberately. Equation card: white, 3px ink, 24px radius, `5px 5px 0` shadow,
  34px/30px padding, centred, mono eyebrow + **3rem mono equation, `white-space:
  nowrap`**. Then answer options in a **2-column grid**, 12px gap. Then the action row:
  amber primary with `↵` printed on it, plus a `#136386` text button.
- **Nour panel, 340px fixed**, `border-inline-start: 3px solid ink`, white.
  Header: 44px companion badge (bobbing) + Baloo name + mono "ALWAYS HERE", with a 3px
  ink divider. Message list, 20px padding, 12px gap. Footer: two suggestion chips
  (999 radius, 2.5px ink, `2px 2px 0` shadow), then the ask bar — 999 radius, 2.5px
  ink, Cream fill, `3px 3px 0` shadow, with a 44px amber send circle. Bottom strip:
  Cream, mono caption.

**Accent:** amber on the one Next button and the active rail item. The quest bar
borrows it because it sits in the Honey band, not the workspace.

**Copy used:** "Linear equations" / "Quest 3 of 4" / "5 MIN LEFT" / "SOLVE FOR X" /
`3x + 5 = 23` / options `x = 4`, `x = 6` ✓, `x = 8` "Not this one", `x = 9` /
"Next ↵" / "I don't get it — explain" / "Nice — you took the 5 off both sides first.
That's the bit most people skip." / "so I divide by 3?" / "Exactly. Try it and tell me
what you get." / chips "Another example", "Show me" / "Ask Nour…"

### iPad · two pane at 1024×768 landscape (reference layout, RTL)

Identical component sizes to web — **only the pane widths changed.** Rail 80px on the
**right**, companion panel 300px on the **left**, and the chat bubble notches follow.
The quest map is dropped rather than squeezed; the header progress bar carries that
information.

In Split View below 700pt this collapses straight to the phone layout. There is no
in-between.

**Copy used:** "المعادلات الخطية" / "٣ من ٤" / "٥ دقايق" / "أوجد قيمة س" /
`3x + 5 = 23` / options س = ٤ / ٦ ✓ / ٨ "مش دي" / ٩ / "كمّل" / "مش فاهم — وضّحلي" /
"حلو! شيلت الـ ٥ من الطرفين الأول — دي الخطوة اللي بيفوتها معظم الناس." / "أقسم على ٣؟"
/ "بالظبط. جرّب وقوللي طلع بكام." / "اسأل نور…"

### Phone · 01 Home (360×690)

**Layout:** greeting row (52px bobbing badge + "إزيك يا" / Title name + a leaf
"٤ مهارات" pill). **Quest card:** amber fill, 3px ink, 24px radius, `5px 5px 0`
shadow, 18px padding — mono eyebrow `#5E3806`, Title skill name, an 18px bar with a
**violet** fill on white, a metadata row, then a **white** button (the primary sits
inside an amber card, so it inverts). Then "اختار مادة" and a **2×2 subject grid**:
each tile 3px ink, 20px radius, `4px 4px 0`, 14px padding, 78px min-height, a 28px
outlined icon square, Title name, and a count in the `-dim` foreground. Bottom nav:
3 tabs, `border-block-start: 3px solid ink`, 56px min-height, active tile amber.

**Accent:** amber on the one quest card. **Subject tiles use the playmates for
recognition, not decoration** — a ten-year-old finds "the blue one" faster than a word.

### Phone · 02 Question (360×690)

**Layout:** header row with a 40px back tile, an 18px quest bar, and a mono `3/8`.
Body: companion 44px + a hint bubble, then the equation card (**1.9rem mono,
`white-space: nowrap`**), then 3 stacked options at 56px min-height, then the amber
primary + a `#136386` text button pinned with `margin-top: auto`.

**Behaviour:** correct **pops** and turns leaf-green; wrong **nudges** side to side and
greys out. It never turns red and never removes the shadow from the other options — the
student can pick again immediately. "وضّحلي" is always the last thing on the page.

### Phone · 03 Celebration (360×690)

**The one full-violet surface in the system, and the only place particles are allowed.**

**Layout:** violet ground with three rising particles (`play-rise`, staggered
2.2/2.6/2.4s). A 132px ring container: pulsing Honey ring + a 112px Honey badge with
3px ink and `5px 5px 0`, squashing, holding the 72px mark. Display "جبتها!" in white,
Cairo body in `#F0E9FB`. A white skill card with a teal "مُتمكّن" pill (**text
`#241F3D`, not white**) and the 5-segment master mastery ramp with 2px ink borders.
Then the amber primary and a Honey text button.

**Note the second button:** stopping is offered as warmly as continuing — **the
celebration is not a hook.**

---

## Component library

### Buttons
| Variant | Spec |
|---|---|
| Primary | Amber fill, ink text, Baloo 700 1.15rem, `padding: 17px 24px`, `min-height: 56px`, radius 20, 3px ink, `4px 4px 0`. **Always amber, always alone on the screen.** |
| Secondary | White fill, ink text, Baloo 700 1.05rem, `min-height: 52px`, same stroke + shadow. |
| Tertiary | No border, no shadow, `#136386` text, Baloo 700 0.95rem, `min-height: 52px`. |
| Disabled | `#FBFAFE` fill, **3px dashed `#B4AECB`**, `#8A83A6` text, **no shadow**, `cursor: not-allowed`, real `disabled` attribute. |

Disabled loses its shadow and its outline goes dashed — it reads as "not ready yet"
rather than "broken".

### Answer options
- Base: 2.5px ink, white, radius 16, `min-height: 52–56px`, Baloo 700 1.05–1.15rem,
  `3px 3px 0` shadow, option letter at the end in `#5A5570`.
- **Selected:** Honey fill, keeps stroke and shadow, label "اخترتها" in `#8A4208`.
- **Correct:** leaf fill, `#1F3D12` text, `✓`, **`pop` 380ms**.
- **Wrong:** `#F6F5FA` fill, 2.5px `#9C95B8` border, `#5A5570` text, **no shadow**,
  **`nudge` 420ms**, and an invitation to retry. **Never red.** It is still an active
  control — the student can pick again immediately, so it keeps AA-legible text.

### Chat bubbles
- **Nour:** white, 2.5px ink, `3px 3px 0` shadow, notch at **top-start** toward the
  avatar — `18px 6px 18px 18px` in RTL, `6px 18px 18px 18px` in LTR.
- **Student:** sky fill, `#0F3D51` text, notch at the **bottom far corner** —
  `18px 18px 6px 18px` in RTL, `18px 18px 18px 6px` in LTR. Max-width 82–86%.
- **Thinking:** the companion **wiggles** and the bubble holds three 9px amber dots
  (1.3s, staggered 0 / .18s / .36s). The wait reads as "he's working on it", not "the
  app froze".

### Quest card / progress
A quest is a small set of questions on **one skill**, finishable in one sitting. Bar:
20px tall, 2.5px ink, 999 radius, white track, 2px inner padding, amber fill,
`fill` 1.4s on arrival. Counter as a pill with a leaf fill.

**Deliberately not a streak:** nothing punishes a missed day and progress is never
lost.

### Celebration block
Violet ground, 3px ink, 28px radius, `6px 6px 0` shadow. 96px ring container: pulsing
Honey ring + 82px Honey badge holding the 52px mark, squashing. Display title in white,
Title-size Arabic in Honey, Cairo meta in `#F0E9FB`.

**Fires only when a skill genuinely reaches mastered** — never for logging in, never
for time spent, never twice for the same skill.

### Subject tiles
3px ink, 20px radius, `4px 4px 0`, 14px padding, 78px min-height, playmate fill, a
28px outlined icon square (white or Honey), Title name in the paired `on` colour, and
a count in the `-dim` colour. **Playmates carry recognition, not decoration.**

### Rail (web/iPad)
88px web / 80px iPad. Companion badge at the top, 2px divider, then nav tiles: active =
amber fill + 3px ink + `3px 3px 0`; inactive = 2.5px `#B4AECB`, no fill, no shadow.
Labels 0.58–0.6rem Baloo 700.

---

## Interactions & behaviour

- **Press** on every control: `translate(4px,4px)` + shadow → 0, 90ms. Non-negotiable.
- **Correct answer:** `pop` 380ms + leaf fill + `✓`.
- **Wrong answer:** `nudge` 420ms + grey fill. Immediately retryable. Never red.
- **Thinking:** companion `wiggle` + three amber dots. No spinner.
- **Quest bar:** `fill` 1.4s once on arrival at the screen.
- **Mastery:** `ring` + `squash`, violet ground, particles. Once per skill, ever.
- **Idle:** companion `bob` 3.2s — the only infinite loop in the system.
- Hover lift is **additive and web-only**, behind `(hover: hover) and (pointer: fine)`.
- Keyboard: `↵` advances and is **printed on the primary button**.
- `prefers-reduced-motion` disables all seven animations.

---

## State management

- `locale` / `dir`: `ar-EG` | `en` → drives `dir` on `<html>`, rail side, panel
  side, and bubble notch corners.
- `viewportClass`: `web | ipad-landscape | ipad-portrait | phone` → three-pane /
  two-pane / rail+sheet / single column.
- `companionMood`: `idle | thinking | encouraging | celebrating` — drives the
  animation only, **never a different asset**.
- `quest`: `{ skillId, total, completed, estMinutes }`.
- `questionState`: `unanswered | selected | correct | wrong` per option.
- `skillMastery`: `Record<skillId, 0..4>` → the master mastery ramp.
- `celebrationShown`: `Set<skillId>` — guarantees **once per skill, ever**.
- `hintRung`: `1..4` per problem (master hint ladder applies unchanged).
- `prefersReducedMotion`: boolean, from the media query.

---

## Accessibility

- Every coloured background has a paired foreground token, all AA at their intended
  size. **Never pick a foreground by eye.**
- 52px minimum targets, on touch and mouse alike.
- `prefers-reduced-motion` disables all seven animations.
- **Never convey state by colour alone**: correct carries `✓`, wrong carries "مش دي —
  جرّب تاني", mastery carries its text label.
- The character never has a facial expression, so it can never appear to mock a
  struggling student.
- Wrong answers keep AA-legible text because they remain active controls.

## Assets

- `reference/nour-friend.svg` — the mark and companion. 64×64 viewBox, amber head,
  indigo body. **Production asset.** In this variant it always sits in a circular
  outlined badge. Never redraw it, never add a face.
- Fonts: Baloo 2, Baloo Bhaijaan 2, Cairo, IBM Plex Mono — Google Fonts, OFL 1.1, free
  for web/iOS/Android/PDF and self-hostable.
- **Subject icons are not drawn** — blank outlined squares in the reference.
- **No illustration or empty-state artwork.** Ask before inventing any.

## Open items before build

1. "Nour" is a **placeholder pending naming and trademark check.**
2. Subject icon set needs drawing to the stated rules.
3. Play and master **overlap at ages 15–16** — the switching rule (which variant a
   given student gets, and whether they can choose) is not yet defined.
4. No illustration or empty-state direction.
5. Phone layouts are documented as the collapse but have had less design attention than
   web and iPad, by explicit product direction.

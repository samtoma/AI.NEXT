# Nour PLAY — Design System (ages 10–16)

Drop this file at the root of the repo (or the UI package). Claude Code reads it
automatically. Import `tokens.css` once at the app entry and reference
`var(--play-*)`. Never hardcode a hex.

**This system LAYERS ON the Nour master system v0.2.** Anything not specified here
falls back to master. Use this system when the target age is **10–16**; use master for
**15–18**. Do not mix them in one build.

---

## THE ONE STRUCTURAL IDEA — everything is a sticker

- **3px solid `#241F3D` outline + hard offset shadow `4px 4px 0 #241F3D`. No blur.**
- Stroke drops to **2.5px** on anything under 40px tall, so the outline doesn't
  swallow the shape.
- **On press:** `translate(4px, 4px)` and shadow collapses to `0`, in **90ms**.
  **If it doesn't move, it isn't a control.**
- Radius: **14** chips/inputs · **20** buttons/small cards · **28** big cards/sheets ·
  **999** pills.
- This replaces the master system's hairline borders and soft shadows entirely.

### The trap — these values are ABSOLUTE
Stroke, shadow offset and radius **never scale with the viewport**. The sticker
illusion depends on them reading as a physical cut edge. Grow them on a 27″ monitor
and the interface stops looking like paper cut-outs and starts looking like a cartoon.

Never write `stroke: 0.3vw` or a radius that grows with the card.

---

## COLOR

- Ground `--play-bg-page: #FFF6E6` (Cream). Surface `#FFFFFF`. Warm bands
  `#FFE9BD` (Honey).
- Ink `#241F3D` — **body text AND every outline and shadow.**
- Action amber `#F0A22F`, text on it `#241F3D`. **Never white on amber.**
- Mastery teal `#2F9E8F`, text on it `#241F3D` — **not white** (3.28:1, fails).
- Celebrate violet `#7B4FC9`, text on it `#FFFFFF`.
- **Playmates** sky `#7FD1F0`, leaf `#B6E88F`, berry `#FFA8C5` — for
  **SUBJECT and QUEST coding only, never decoration.**
- **Correct = leaf green. Wrong = grey fill + nudge. NEVER red, ever.**

**Every coloured background has a paired `--play-on-*` token. Use it.** Picking a
foreground by eye is how the contrast bugs got in — a background token without a
matching foreground token is a bug waiting to happen.

For small text on a playmate fill use the `-dim` variants (`--play-on-sky-dim`
etc.), which are darkened for AA at label sizes.

`--play-disabled-text: #8A83A6` is permitted **only** on an element that actually
carries `[disabled]`.

---

## TYPE

- **Baloo 2 / Baloo Bhaijaan 2 runs the WHOLE UI at 700–800**: headlines, buttons,
  labels, numbers. This is the deliberate break from master, where Baloo is
  headline-only. Its roundness is the point at this age.
- **Cairo 400 only for passages over three lines.** Rounded type is friendly for six
  words and tiring for sixty.
- **IBM Plex Mono 500** for step counters, timers and Latin-only labels.
  **It carries no Arabic script and no Arabic-Indic digits (`٠–٩`).** Any Arabic run
  inside a mono element must be wrapped in a Cairo span with
  `letter-spacing: normal`, or the whole label moved to Cairo. This bug recurred
  repeatedly — add a lint rule.
- Arabic and English at **equal size and weight**. Arabic line-height 1.9, Latin 1.75.
  Never letter-space Arabic.
- Scale: display 2.4rem · title 1.5rem · UI 1.15rem · label 0.85rem · read 1rem ·
  data 0.72rem. **Display never below 1.3rem and never in a paragraph.**

---

## TARGETS & DENSITY

- Minimum tap target **52px** (not master's 44) — fast, imprecise taps, often on a
  shared or cracked device.
- **52px holds on desktop with a mouse too.** This age group uses trackpads badly, and
  a chunky target is part of the variant's character, not an accessibility tax. Never
  shrink to 32px because there's a cursor.
- 8px spacing rhythm. One idea per screen. **ONE amber primary per screen.**

---

## DEVICES — web and iPad are canonical, phone is the collapse

A 10–16-year-old studies on a shared laptop at the kitchen table or an iPad on the
sofa. The phone is where they check something quickly, not where a session happens.

| Class | Width | Structure |
|---|---|---|
| **Web** | 1280pt+ | **Three pane — 88px icon rail / workspace / 340px Nour panel.** Panel never collapses above 1280. |
| **iPad landscape** | 1024–1194pt | **Two pane — 80px rail / workspace / 300px Nour panel.** Same component sizes as web; only pane widths change. |
| iPad portrait | 744–1023pt | Rail + workspace; Nour docks to a bottom sheet. |
| Phone | 360–430pt | Single column, bottom nav, inline avatar. |
| Split View | ≤700pt effective | Phone layout wholesale. **No intermediate layout exists.** |

**Order of work: design the 1360 web layout FIRST, mirror to iPad by changing only
pane widths, then collapse to phone LAST.** Phone-first produces a companion that hides
in a tab and a quest map that never existed — two things this variant depends on.

### Scaling rules
- **Width buys panes and empty Cream, never bigger controls.** Workspace body stays
  1rem and answer options stay 1.15rem from 360pt to 1920pt. The only element that
  grows is the equation card, which is a focal display, not UI.
- Cap the workspace at **820px**, reading text at **64ch**, card grids at **2 columns**.
- Answer options: **1 column on phone, 2 on iPad and web. Never 3+.** A four-across
  row reads as a form and the student loses the sense of choosing between a few things.
- **Hover styles only inside `@media (hover: hover) and (pointer: fine)`** —
  otherwise iPad taps leave a sticky hover that reads as a broken button.
- **RTL mirrors the rail, the panel side, AND the chat bubble notches.** Use logical
  properties — `border-inline-start`, never `border-left`.

---

## MOTION — reactive, never ambient

Seven named animations. **Every one is a response to something the student did.**
Ambient animation on a study screen is noise and the fastest way to make a page feel
cheap.

| Name | Spec | Use |
|---|---|---|
| `press` | 90ms, translate 4px, shadow → 0 | Every control on tap. Highest-value animation in the kit. |
| `pop` | 380ms `cubic-bezier(.34,1.6,.64,1)` | Correct answer, reward appearing, badge landing. |
| `nudge` | 420ms shake ±5px | Wrong answer. **Never paired with a colour change to red.** |
| `wiggle` | 900ms loop, rotate ±6° | Nour thinking. Only while a response is pending. |
| `bob` | 3.2s loop, translateY 7px | Nour idle. **The ONLY permitted infinite loop.** |
| `fill` | 1.4s width ease-out | Quest bar advancing. Once, on arrival. |
| `ring + squash` | 1.6s ring, 1.2s squash | Mastery celebration only. |

**Hard limits:** one animation at a time; nothing over 600ms; if two things want to
move, the feedback wins and the decoration waits. Honour `prefers-reduced-motion`.

---

## THE CHARACTER

The friend mark (`nour-friend.svg`) becomes a **present companion** in a circular
outlined badge.

**Four moods, carried by motion ONLY:**
- **idle** → bob · **thinking** → wiggle · **encouraging** → pop once ·
  **celebrating** → squash + ring pulse.

**NEVER redraw the artwork. Never add facial expressions.** One asset covers every
state, and the character can never look like it's laughing at you — which matters
because the master research says the student's stated fear is looking stupid.

Sizes: **28px** inline beside a bubble · **44px** in a header/panel · **96px** on
celebration and empty states. Below 28px drop to the mark alone with no ring.

On the persistent web/iPad panel the companion is **always visible** — never summoned
from a tab. That continuity is the main thing the big screen earns.

---

## PROGRESS = QUESTS, NOT STREAKS

- A **quest** is a few questions on **ONE skill**, finishable in one sitting, labelled
  with its length in minutes.
- Reward **only real learning**: a skill reaching mastered. Never logins, never time
  spent, never the same skill twice.
- **A missed day costs nothing and progress is never taken away.** This is the master
  brand's no-shame rule kept intact under a louder skin.

---

## WHAT DOES NOT BEND

Playful in the details, never in the substance. Louder does not mean manipulative.

- **No red for wrong answers.** Wrong greys out, nudges, and can be retried
  immediately. It never removes the shadow from the other options.
- **No leaderboards, class ranking, or peer comparison.**
- **Help is never withheld to drive engagement.** "Show me" is always reachable.
- Every reward marks something the student actually learned.
- Stopping is offered as warmly as continuing — the celebration is not a hook.

---

## FORBIDDEN

- Red for wrong answers. Any red in the palette.
- Leaderboards, class ranking, peer comparison.
- Streaks with loss, countdown pressure, "you'll lose your progress".
- Ambient looping animation on a study screen. Two animations at once.
- Facial expressions on the mark. Sparkle/star AI iconography.
- Withholding an explanation to drive engagement.
- Arabic set in IBM Plex Mono. White text on amber or on teal.
- Baloo in a paragraph over three lines.
- Scaling stroke, shadow, radius or type with the viewport.
- Stretched phone layouts on iPad or web. Answer options 3+ across.
- Unconditional `:hover` styles. `left`/`right` in CSS.

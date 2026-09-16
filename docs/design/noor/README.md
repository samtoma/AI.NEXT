# Noor design revamp — canvas source

Working files for the design canvas published at
<https://claude.ai/code/artifact/8e98ed20-b07b-4403-afd4-2091ad2fcb0b>.

Six artboards, all iPad landscape **1194×834** (the canonical device in the
handoff), laid out as two rows of the same three screens — master on top, Play
below — so the two variants can be read against each other rather than in
sequence:

| Screen | Master (15–18) | Play (10–16) |
|---|---|---|
| Who's studying | `Welcome.dc.html` | `WelcomePlay.dc.html` |
| Lesson | `Main.dc.html` | `LessonPlay.dc.html` |
| Where you stand | `Progress.dc.html` | `ProgressPlay.dc.html` |

They are clickable prototypes, not stills: the hint ladder, the topic
selection and the profile picker all work.

Content is real, not lorem. The lesson question is `q:u1-1-1:002` from the
Prep-3 Mathematics book; module titles and objective counts come from
`services/extraction/manifest/math-los.json` (u1=11, u2=8, u3=8, u4=7, u5=9,
geo1=9, geo2=18, t2u1=8, t2u2=7, t2u3=5 — 90 objectives across 10 modules).

## Which variant ships

**Play**, as of 2026-09-16 — replacing Master. Implemented in
`app/src/app/globals.css` under `[data-ds="noor"]`: the sticker system (3px
ink outlines, hard offset shadows, 14/20/28/999 radii, `.play-pressable`),
Baloo running the whole UI, 52px targets, and the seven named animations.
Handoff bundle: `docs/design/handoffs/noor-play/` (`design_handoff_nour_play`
v1.0a — CLAUDE.md, tokens.css, tokens.json, reference/).

Prep-3 is 14–15, which sits inside both bands, and the handoff is explicit
that they must not be mixed in one build. Master was the original pick
because the comparison environment's variable under test is BKT-vs-Elo
teaching behaviour, and a sticker-heavy visual language is a second variable
— **this call was overturned in favour of Play**; record the reasoning in an
ADR if it wasn't already (constitution Principle I still applies going
forward — reversing this again is Samuel's call, same as the original pick).

Coverage as shipped: the token/colour/typography/motion layer and the
blanket radius+border+shadow rules apply everywhere under `[data-ds="noor"]`
with no component touched. The bespoke sticker chrome (borders, hard
shadows, `.play-pressable`, disabled treatment) has had a full pass over the
core student screens (home/quest, lesson/question, chat panel, celebration —
`components/student/`, `components/chat/`). Internal tooling
(`/admin`, `/pipeline`, `/spine`, `/dev`) and the per-widget SVG verdict-ink
colours (`components/student/widgets/*`) were left as-is — out of the
handoff's stated scope (the ages 10–16 student session), not overlooked.

## To edit the canvas

Edit the `.dc.html` files here, then re-seed and republish with the `design`
skill — always a fresh copy of the payload template, never the published file.

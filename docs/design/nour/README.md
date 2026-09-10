# Nour design revamp — canvas source

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

**Master**, implemented in `app/src/app/globals.css` under `[data-ds="nour"]`.
Prep-3 is 14–15, which sits inside both bands, and the handoff is explicit that
they must not be mixed in one build. Master was chosen because the comparison
environment's variable under test is BKT-vs-Elo teaching behaviour: a
sticker-heavy visual language is a second variable, and a 14-year-old reading a
system built for 10-year-olds is a confound in the wrong direction.

**This is Samuel's call to confirm or overturn** (constitution Principle I).
It is deliberately cheap to reverse — the Play variant is a token swap plus the
sticker border/shadow rules, not a rebuild.

## To edit the canvas

Edit the `.dc.html` files here, then re-seed and republish with the `design`
skill — always a fresh copy of the payload template, never the published file.

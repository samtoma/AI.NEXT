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

**Both — one per render, chosen by the student's grade.** Decided by Samuel on
2026-09-20 and recorded in
[ADR-0017](../../decisions/0017-two-variants-keyed-to-grade.md), which amends
[ADR-0011](../../decisions/0011-noor-play-design-system.md)'s "Master is
replaced, not retained". Constitution **v3.1.1 Principle XII** carries the rule;
the requirement is **FR-1011** in `specs/001-student-mvp1-delta/spec.md`.

- **Preparatory → Play. Secondary → Master.** The boundary is the
  Preparatory/Secondary line, so Prep-3 — 14–15, and inside *both* published age
  bands — lands on Play. Grade rather than age, because grade is already
  collected (constitution Principle VII) and the age bands overlap.
- **A student override in settings wins**, is stored against the student, and
  **survives sign-out**.
- **Exactly one variant per page render, resolved before first paint**, and no
  surface hard-codes a variant. This keeps the handoff's own rule — the two are
  never mixed in one build — intact.
- **Default when the grade is unknown: Play.**
- **Both variants must meet the same accessibility pairings.** Master is a
  shipping skin now, not a historical one.

**What exists today is Play only.** `app/src/app/globals.css` implements it
under `[data-ds="noor"]`: the sticker system (3px ink outlines, hard offset
shadows, 14/20/28/999 radii, `.play-pressable`), Baloo running the whole UI,
52px targets, and the seven named animations. Handoff bundle:
`docs/design/handoffs/noor-play/` (`design_handoff_nour_play` v1.0a —
CLAUDE.md, tokens.css, tokens.json, reference/). Master is not a named sibling
in the stylesheet, and its component anatomy is not published — so **no
Secondary cohort should be onboarded until it is**. FR-1011 is OPEN.

Coverage as shipped: the token/colour/typography/motion layer and the
blanket radius+border+shadow rules apply everywhere under `[data-ds="noor"]`
with no component touched. The bespoke sticker chrome (borders, hard
shadows, `.play-pressable`, disabled treatment) has had a full pass over the
core student screens (home/quest, lesson/question, chat panel, celebration —
`components/student/`, `components/chat/`). Internal tooling
(`/admin`, `/pipeline`, `/spine`, `/dev`) and the per-widget SVG verdict-ink
colours (`components/student/widgets/*`) were left as-is — out of the
handoff's stated scope (the ages 10–16 student session), not overlooked.

**Corrected 2026-09-20:** that last sentence described the scope as it stood
when the pass was made. Constitution v3.1.1 **Principle XII** withdrew the
carve-out, so those surfaces and the widget verdict inks are **in scope and
non-compliant by omission**, not out of scope. `FR-1001` is PARTIAL for exactly
that reason.

## To edit the canvas

Edit the `.dc.html` files here, then re-seed and republish with the `design`
skill — always a fresh copy of the payload template, never the published file.

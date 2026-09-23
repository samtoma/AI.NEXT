# ADR-0017 — Two design-system variants, selected at runtime and keyed to grade

**Status**: Accepted — Samuel, 2026-09-20, on finalising the design-system governance
**Amended**: 2026-09-23 — Master hidden; Play for every student and operator until Master's published tokens are implemented ([Amendment](#amendment--samuel-2026-09-23-master-hidden-play-everywhere))
**Amends**: [ADR-0011](./0011-noor-play-design-system.md) — the "Master is replaced, not retained" decision
**Affects**: constitution Principle XII (v3.1.1) · `FR-1001` and the new `FR-1011` in `specs/001-student-mvp1-delta/spec.md` · `app/src/app/globals.css` (`[data-ds]`) · `docs/design/noor/README.md` · `docs/design/handoffs/noor-play/`

## Context

ADR-0011 replaced Master with Play and said so plainly: *"Master is replaced, not
retained as an alternative."* It had two reasons. The handoff forbids mixing the
two variants inside one build, and — the load-bearing one — **a variant switch
was rejected because the rule that would pick between them was never defined**.
Its own words: *"an undefined switch is a bug with a configuration flag in front
of it."* That was a correct rejection of an undefined mechanism, not a finding
that two variants are wrong.

**What changed is that the rule now exists.** Samuel has defined it: the variant
follows the student's **grade**, and the boundary sits on the Preparatory /
Secondary line. Preparatory 3 — the cohort this build serves — gets Play.
Secondary gets Master. With the rule written down, ADR-0011's stated objection no
longer applies, and reversing it is a decision rather than a drift.

**Grade, not age.** Constitution Principle VII permits name, grade and the
interest signals the tutor uses, and **grade is already collected** — it is in
the student record today. Age is not, and collecting a birth date to drive a
skin would be a new datum about a minor to solve a problem grade already solves.
Grade is also the stronger key: the published age bands overlap (Master 15–18,
Play 10–16) and Prep-3 students are 14–15, so age sits inside both bands and
cannot decide anything. The Prep/Secondary line is a clean partition of the
population the product serves.

**The handoff's "do not mix" rule is preserved, not broken.** It forbids mixing
the two variants *in one build* — in practice, in one render. It does not require
that only one variant exist. One variant per page render, resolved before the
first paint, satisfies it exactly.

**A second variant is less new than it sounds.** The published system already
carries two colour themes over one semantic token set — `play` and `ledger`, the
latter being the restrained identity every surface still renders when the
`[data-ds]` attribute is absent. So this is a second skin over semantics that
already exist, not a second design system. What does **not** exist yet is
Master's full anatomy published as a peer skin under the Play system's component
guidelines; that is real work and the Consequences name it.

## Options considered

1. **Play only** (the ADR-0011 status quo) — one token set, one capture baseline,
   nothing to select. Wrong for a 17-year-old: the sticker system, 52px targets
   and Baloo-everywhere are designed for 10–16, and the product's stated ambition
   reaches Secondary.
2. **Master only** (the ADR-0007 status quo) — restrained, cheap to maintain.
   Rejected already by feedback [#38](https://github.com/samtoma/AI.NEXT/issues/38)
   from the PRD's own owner, and ADR-0011 is the record of that.
3. **Both, selected at runtime and keyed to grade** — **chosen.** The one key the
   product already holds, a boundary that matches how Egyptian schooling is
   actually segmented, and an explicit student override for the students the line
   gets wrong.
4. **Both, keyed to age** — rejected. Age is **not collected**, the published
   bands overlap across the whole pilot cohort, and adding a birth date about a
   minor to choose a colour scheme fails Principle VII's minimum-collection test.
5. **One variant per deployment** (a build flag, or a second hostname) — rejected.
   This is **one product with one student population**, not two audiences behind
   two URLs. A build flag also cannot serve a Prep-3 and a Secondary student on
   the same deployment, which is the whole requirement.

## Decision

**The published design system has two variants — Play (10–16) and Master
(15–18) — and the product selects one at runtime from the student's grade.**

The parameters, pinned:

- **The key is grade.** Preparatory → **Play**. Secondary → **Master**. The
  boundary is the Preparatory/Secondary line; Preparatory 3 is on the Play side.
- **A student override exists in settings.** It is **stored server-side against
  the student**, not in browser storage, and it **survives sign-out** — a student
  who chose the other skin finds it again on the next device and the next session.
- **The override wins over the grade rule** whenever it is set. The grade rule is
  the default, not a ceiling.
- **Default when grade is unknown or unreadable: Play.** Failing to the
  younger-audience variant is the safe failure: it is larger, higher-contrast and
  easier to hit, and it is the variant the current cohort would have received.
- **Exactly one variant per page render.** The variants are never mixed in one
  document, which is the handoff's own rule kept intact.
- **Resolved before first paint.** The variant is decided server-side and carried
  on the document element, so no surface renders in one skin and re-renders in
  the other. A visible skin flip is a defect, not a loading state.
- **No surface may hard-code a variant.** A component that pins itself to Play or
  to Master is the mixed build the handoff forbids, arrived at one file at a time.

**No code ships in this branch.** This ADR records the decision and the
governance around it; the implementation lands with the requirement that carries
it (`FR-1011`).

## Consequences

**A second token set stays live, and it is held to the same standard.** Master is
no longer a historical variant that may quietly rot. It is a shipping skin, so it
carries the same obligations Principle XII places on Play: every coloured
background uses its paired `on-` foreground, and **both variants must satisfy the
same accessibility pairings**. A pairing that fails in Master is a defect in the
system, not an acceptable difference between skins. The contrast table in
`docs/design/handoffs/noor-play/README.md` needs its Master counterpart before
Master ships to a student.

**Visual regression and capture cost roughly doubles.** Every screen now has two
correct appearances. Whatever proves a screen right has to prove it twice, and a
review that looked at one skin has looked at half the product. This is the price
ADR-0011 named when it rejected the switch — *"it would double the surface area
of every visual regression"* — and it is now paid deliberately, with a defined
rule, rather than avoided by having no rule.

**`globals.css` gains a second `[data-ds]` skin.** Today there is one block,
`[data-ds="noor"]`, plus the Ledger identity that renders when the attribute is
absent. Master becomes a named sibling rather than the unnamed default, so the
selector set is explicit and a surface with no attribute is a bug rather than a
silent choice. That refactor is part of `FR-1011`, not a separate cleanup.

**The override needs a home in the student record and in settings.** It is one
more stored preference about a minor — permitted under Principle VII as a product
preference rather than a new personal datum, but it is data, it belongs to the
student, and it moves with the account rather than the browser.

**Master's anatomy is not published yet.** The system's component guidelines,
type scale and motion spec are written for Play. Master ships as a colour theme
today; shipping it as a full variant means publishing its anatomy on the same
artifact. Until that exists, **no Secondary cohort should be onboarded** — the
grade rule would route them to a variant that is half specified.

**What would trigger revisiting.** Three things. A cohort whose grade does not
predict its appetite — Secondary students choosing Play in numbers, or the
reverse — which would make the grade key the wrong key rather than a mis-set
boundary. A measured cost: if maintaining two skins starts delaying teaching work,
the honest answer is to drop one, not to let one decay. And the arrival of
non-Egyptian grade structures, which would break the Preparatory/Secondary
partition and force a different key entirely.

## Amendment — Samuel, 2026-09-23: Master hidden, Play everywhere

**Status of this ADR: Accepted, with its Master half suspended.** The grade rule,
the override and every pinned parameter above stand and stay implemented. What is
suspended is *reaching* Master.

### What happened

A UI review on 2026-09-23
([`docs/reviews/2026-09-23-play-master-ui-review.md`](../reviews/2026-09-23-play-master-ui-review.md))
found that `[data-ds="master"]` does not render Master. This ADR's Context called
the two published themes "`play` and `ledger`" and treated Master as the Ledger
palette; the implementation (`FR-1011`, `85fe3b8`) followed that wording, so the
Master selector restates no tokens and inherits the `:root` **Ledger** set — the
frozen family-tutor identity: ruled paper, grain, Fraunces, viridian, rust red.
Components meanwhile carry Play's shapes as fixed values. Every Master screen, and
the whole console (operators defaulted to Master), therefore mixed three
identities.

Two statements above are also wrong and are corrected here rather than edited in
place: **Master's anatomy is published.** The design system's `tokens.json`
carries a `master` theme (synced 2026-09-20), its screens are drawn in
`docs/design/noor/{Welcome,Main,Progress}.dc.html`, and it was implemented once,
verbatim, in `df1bf29` on 2026-09-10 before ADR-0011 replaced it. "Master's
anatomy is not published yet" (Consequences) and the Context's "`play` and
`ledger`" should be read in that light.

### Decision

Samuel: **hide Master now, fix the Play findings, keep the Master work as a
backlog.**

- **One switch**: `MASTER_VARIANT_ENABLED = false` in `app/src/lib/design-variant.ts`.
  While it is off, every resolver answers **Play** — every student whatever her
  grade or stored override, and every operator; the console default is Play.
- **Nothing is migrated.** Stored `master` overrides stay in `students` and
  `operators` untouched; turning the switch back on restores every choice as it
  was.
- **Master cannot be chosen.** The student `/settings` and console `/profile`
  pickers collapse to one read-only line naming the look in force; both
  appearance endpoints refuse `"master"` with the same `400 invalid_variant`
  they give any unknown value.
- **The rule stays proved.** `design-variant.test.mts` runs the grade rule and
  the override with the switch ON, and separately proves that everything is Play
  with it OFF.

### What turns it back on

Master's published tokens implemented under `[data-ds="master"]` in
`app/src/app/globals.css` (the review's option A: restore the published values,
give the ~15 tokens the code uses and the theme leaves undefined their Master
values, give every Play-only token and state a Master version, and take the
Ledger identity off `main`) — tracked in GitHub issues #46, #47, #48 and #50 under
tracking issue #51. Flipping the switch is a decision recorded here, not a
refactor; the suite's tripwire (`MASTER_VARIANT_ENABLED` asserted `false`)
changes in the same commit.

### Consequences

- The console is Play. Its own Play defects (review F9–F11, F22, and a stacking
  guard for F25) were addressed the same day, largely through semantic classes (`ds-tag`, `ds-control`,
  `ds-field`, `ds-empty`, `ds-dense`) that Play styles in `globals.css` and that
  stay inert in any other variant, so no console component learns which variant
  it is in.
- `FR-1011` stays **PARTIAL**: the mechanism is intact and proved, but
  "Secondary → Master" currently resolves to Play by this decision.
- Until the switch is back on, this ADR's grade key has no visible effect; no
  Secondary cohort should be onboarded expecting Master, which was already the
  rule above.

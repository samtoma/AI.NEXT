# ADR-0011 — Noor Play replaces Master as the Student MVP design system

**Status**: Accepted — Samuel, 2026-09-20, by authorising the `PDR1-0-v0.3.0` release
**Amends**: [ADR-0007](./0007-student-mvp1-comparison-build.md) — the Master pick recorded under its design section
**Affects**: `FR-1001` · `app/src/app/globals.css` (`[data-ds="noor"]`) · `docs/design/noor/` · `docs/design/handoffs/noor-play/` · every `nour` identifier in the tree

## Context

ADR-0007 chose the **Master** variant (ages 15–18: restrained, low chrome) for
the comparison build, and gave a specific reason: the variable under test in
that environment is **BKT-versus-Elo teaching behaviour**, and a sticker-heavy
visual language would be a *second* variable sitting on top of the first. If the
comparison came out favouring one side, you would not be able to say whether the
teaching model or the look did it.

Two things have since changed, and both cut against that reasoning.

**The comparison stopped being a system property.** ADR-0010's Clarification
withdrew cross-solution content parity and the frozen-baseline obligation. The
two solutions may now diverge completely; the comparison is an *observational
judgement from live usage*, not a controlled experiment the repository enforces.
A confound argument is an argument about a controlled experiment. There is no
longer one to confound.

**The audience said the restrained variant was wrong.** Feedback
[#38](https://github.com/samtoma/AI.NEXT/issues/38) asked for "the more
children-based version of the design system" — filed by Tamer, who owns the PRD
this solution is built to. Prep-3 students are 14–15, which sits inside **both**
published age bands (Master 15–18, Play 10–16), so the band boundary does not
decide it and someone has to.

The handoff (`design_handoff_nour_play` v1.0a) is explicit that the two variants
must not be mixed in one build, so this is a replace, not a third switchable
option. A variant switch was considered and rejected: the rule that would pick
between them at runtime was never defined, and an undefined switch is a bug with
a configuration flag in front of it.

## Decision

**`[data-ds="noor"]` is Noor Play.** Master is replaced, not retained as an
alternative.

What that means concretely:

- The token, colour, typography and motion layer in `globals.css` under
  `[data-ds="noor"]` is the Play system: 3px ink outlines, hard offset shadows,
  14/20/28/999 radii, `.play-pressable`, 52px targets, Baloo running the whole
  UI, and seven named animations (`bob` is the one permitted infinite loop).
- Blanket radius and border-width rules mean any plain `rounded-*` / `border`
  utility picks up the sticker treatment **with no component touched**. This is
  what kept the change additive: the component sweep wires press, shadow and
  animation classes onto real controls, and removes nothing.
- The product is called **Noor**. Every `nour` identifier is renamed —
  `NourMark` → `NoorMark`, `docs/design/nour/` → `docs/design/noor/`, and the
  persona string in `lib/ask.ts` the first rename pass missed (feedback
  [#37](https://github.com/samtoma/AI.NEXT/issues/37)).

Two constraints survive the change unchanged, and were checked:

- **No red and no coral** (FR-1002, constitution). `--rust` under Play is
  `#5a5570`, a grey-purple. The only warm hues in the block are ambers
  (`#a34f0a`, `#d98c1f`); nothing in it sits in the red band.
- **No Arabic-capable surface is removed** (constitution Principle V). The Play
  anatomy covers the English/maths check-in only; `SocialCheckIn` and the Arabic
  verticals keep their prior bilingual rendering untouched.

## Consequences

**Accepted.** The comparison, such as it remains, now differs on look as well as
on mastery model. Nobody will be able to attribute a difference in outcomes to
BKT alone. That price is paid knowingly: ADR-0010 already reduced the comparison
to an observational judgement, and a design the audience rejects produces no
usage to observe.

**Reversible, at a known cost.** The change is a token layer plus an additive
class sweep, so reverting the *tokens* is cheap. Reverting the component sweep
is not free — the press and animation classes are wired onto real controls — but
nothing was deleted to make room for it.

**Out of scope, and still is.** The internal surfaces (`/admin`, `/pipeline`,
`/spine`, `/dev`, `/gallery`) did not get the Play pass and were never meant to.
Neither did the per-widget SVG verdict-ink colours.

**One known consequence of the token swap, measured.** `--line-soft` moved from
`rgba(32,41,58,0.09)` to `#ede9f5`. Against `--card-warm` `#ffe9bd` that is
**1.00:1** — invisible. It survives in that pairing only on `/pipeline` and the
Arabic `IrabTree`, both out of the MVP 1.0 student path, and the chat bubble
that used to pair them is overridden to `--ink`. Against `--card` (the widget
SVG grids) it is 1.19:1, effectively unchanged from the 1.18:1 it was before, so
this is not a regression the swap introduced. Recorded here so the next person
to measure it does not re-derive it; left unfixed because no student-facing
surface is affected.

## Alternatives considered

**Keep Master, reject the feedback.** Defensible on the original confound
argument, and that argument is what ADR-0010 dissolved. It also sets the PRD
owner's read of his own audience against a constraint that no longer binds.

**Ship both, switch by age.** Rejected. The switching rule was never defined,
Prep-3 sits inside both bands so age would not resolve it, and the handoff
forbids mixing the two in one build. It would double the surface area of every
visual regression for a choice nobody had made.

**Ship Play only on the check-in, keep Master elsewhere.** Rejected for the same
reason — it is the mixed build the handoff rules out, arrived at by accident
instead of on purpose.

## Open

- The `--line-soft` on `--card-warm` pairing above is a one-token fix (`--grid`,
  or `--line` at low alpha) whenever an internal surface matters enough. Not
  scheduled.
- `.anim-mastered`, the signature spring reserved for proficient → mastered
  (FR-1010), is still **BUILT and unspent** — it needs a live band transition to
  observe, and no session has produced one.

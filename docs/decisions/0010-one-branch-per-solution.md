# ADR-0010 — One branch per solution, both long-lived

**Status**: Accepted — Samuel, 2026-09-13
**Amends**: [ADR-0007](./0007-student-mvp1-comparison-build.md) — its *delivery model*, not its product scope
**Affects**: `specs/001-student-mvp1-delta/` phases 1, 3, 10, 12 · constitution Principle XI (comparison integrity) · `CLAUDE.md` topology table · `.github/workflows/ci-cd.yml`

## Context

ADR-0007 adopted the Student MVP as a **comparison build**: two Docker stacks on
one box, two Cloudflare hostnames, a `main`/`mvp1` branch pair, and content parity
enforced between two live databases so the two products could be measured side by
side.

That model put two *solutions* inside one repository's deployment topology and
treated one of them as an environment of the other. It has produced concrete
friction:

- **Phase 3 (8 tasks) has never run.** Every task in it is box-and-hostname work
  that cannot be done from a development machine, so the comparison the whole
  build exists to serve has no recorded parity run across two databases.
- **The `mvp1` branch was never created.** `T001` sat blocked on permission, so
  the branch the CI matrix, `deploy/DEPLOY-MVP1.md` and `docker-compose.mvp1.yml`
  all reference did not exist. Documentation described a topology that was not real.
- **Parity was asserted against constants, not against a second database.** What
  `parity_check.py` actually proves today is that one database matches expected
  values — useful, but not a comparison.
- The two products have diverged far past "same thing, different settings":
  different audience, language, direction, device target, mastery model and
  content review regime.

## Decision

**Each solution is its own long-lived branch. Both are kept indefinitely. Neither
is an environment of the other.**

| Branch | Solution | State |
|---|---|---|
| `main` | shared trunk | default branch; **not retired** — see Consequences |
| `family-tutor` | Founding Families — parent-sold, Arabic RTL, three subjects, Elo mastery | frozen baseline |
| `PDR1-0` | Student MVP — student-facing, English LTR, mathematics only, BKT mastery | active development |

`PDR1-0` is the rename of the working branch `claude/tamer-shared-drive-access-ddpypu`,
whose name was an artefact of how the session was created and carried no meaning.

### What follows from it

1. **A branch is a solution, not a deployment slot.** Environment naming
   (`mvp1`, "the comparison environment") stops describing *which product this is*
   and goes back to describing *where a build runs*.
2. **Parity is asserted per branch against the held-constant book**, not between
   two live databases. The Prep-3 Mathematics constant — 10 modules, 90 LOs, 112
   prerequisite edges, 450 questions, 212 visuals, source `38ee465de1dc3692` —
   remains the thing neither solution may drift from, and `parity_check.py`
   remains the gate. What changes is that a green run no longer requires a second
   stack to exist.
3. **Comparison becomes a reporting concern, not a topology concern.** Events stay
   environment-tagged and metrics stay unpooled (constitution Principle XI holds
   unchanged); what is withdrawn is the requirement that both products be *live
   simultaneously on one box* before anything can be measured.
4. **Deployment is per solution and independent.** Neither branch's release
   schedule is coupled to the other's.

## Consequences

**Good**

- Phase 3 is re-cut from eight blocked box tasks into per-solution deployment,
  which can proceed independently and does not block product work.
- The branch names now say what the products are, which is what a person reading
  the repository needs to know first.
- The frozen baseline is explicitly named and protected rather than implicitly
  being "whatever `main` is".

**Costs, stated plainly**

- **The simultaneous side-by-side comparison is given up**, and with it the
  original promise that founders could open both products at once on two
  hostnames. If that demo is still wanted it must be re-specified as its own
  piece of work. This is the real price of the decision.
- `family-tutor` and `main` currently point at the same commit. Until CI and the
  `ainext.reletix.com` hostname are repointed at `family-tutor`, `main` is still
  the branch that deploys production. **Retiring `main` is deliberately not done
  here** — it is a production change and needs its own go-ahead.
- Three references to `mvp1` as a branch remain in the tree and must be re-cut:
  the CI branch→environment matrix (`T004`), `deploy/DEPLOY-MVP1.md`, and
  `deploy/docker-compose.mvp1.yml`.

**Neutral**

- No product scope changes. ADR-0007's product decisions — International
  curriculum, English-medium, BKT, parent dashboard in scope, math-only — all
  stand. Only the delivery model is amended.

## Open

- **Retire `main`?** Recommended only after CI and the production hostname are
  repointed at `family-tutor`. Owner: Samuel.
- **Spelling of `PDR1-0`.** If the intent was `PRD1-0`, after the product
  requirements document, renaming is cheap now and expensive once colleagues have
  re-pointed their clones.
- **Does a live side-by-side demo still need to exist?** If yes it is new work,
  not a leftover of this ADR.

---

## Clarification — Samuel, 2026-09-13 (same day, after the first pass)

> *"I will keep each branch with its own deployment triggers on their own branches, so the
> comparison will be on the live usage, so no conflict. I will not rely on the system to compare,
> the 2 systems can be completely different, no problem. Don't touch the main now."*

This goes further than the decision above, and narrows the constraint set again.

### What it settles

1. **Deployment is per branch, triggered from that branch.** No shared workflow arbitration, no
   branch→environment matrix deciding where a push lands. Each solution owns its own trigger.
2. **The comparison is observational, on live usage.** It is a judgement the founders make from
   watching real students, not a property the system enforces.
3. **The two solutions may diverge completely.** Different content, different curriculum, different
   subjects, different everything — divergence is no longer a defect.
4. **`main` is not to be touched.** No instrumentation PR, no retirement, no repointing, for now.

### What this withdraws

- **Cross-solution content parity is no longer a requirement.** `FR-904` and `SC-001` asserted that
  every solution serves the identical curriculum set. That was the load-bearing constraint of the
  whole comparison design, and it is dropped: the book is no longer a held-constant variable
  *between* solutions.
- **`FR-908` — the baseline emits the same conversion metric with no teaching change — is dropped**,
  together with `T059`/`T060`. Both required a PR to `main`.
- **"A frozen baseline stays frozen" stops being a comparison-validity constraint.** The baseline is
  frozen because nobody is working on it, not because an experiment depends on it.
- **Constitution Principle XI is materially narrowed** — see constitution v3.0.0.

### What survives, and why it should

- **`parity_check.py` is kept, in a narrower role: an intra-solution drift guard.** It is no longer
  a cross-solution gate, but it earns its place *within* a solution — it has already caught two real
  defects that a totals-only check would have missed (a scoped refresh silently demoting 29 questions
  to `review`, and a `source_documents` query returning zero rows instead of erroring). Deleting it
  would be a regression. **Recommendation, for Samuel: keep it as a per-solution content-integrity
  check.** Not a comparison instrument.
- **Environment attribution and unpooled metrics** stay. Even with an observational comparison,
  mixing two products' rows into one number produces a figure that means nothing. This is data
  hygiene, not experiment design.
- **Student data does not cross solutions.** Unchanged, and never was about the comparison.

### Consequence to name honestly

With parity dropped, `family-tutor` and `PDR1-0` are no longer two treatments of one experiment —
they are two products that happen to share a history. **Any future claim that one "teaches better"
than the other is an opinion formed from live usage, not a measured result**, because the variable
that made it measurable has been released. That is a legitimate trade for delivery speed; it should
just never be written up later as though it were an experiment.

---

## Amendment — Samuel, 2026-09-22: `main` is the single development branch

**Status of this ADR: Superseded in part.** The *reasoning* below stands and is
worth keeping. The *branch topology* it prescribes does not survive this
amendment, and `docs/BRANCHING.md` is now the operative description.

### What changed, and why the original rule stopped paying

This ADR's rule — one long-lived branch per solution, neither an environment of
the other — was correct while **two solutions were both being worked on**. That
stopped being true. `family-tutor` has been frozen since it was branched;
nobody has pushed to it, and nobody intends to. What remained was one active
product carried on `PDR1-0`, a default branch `main` that nothing was developed
on, and a deploy trigger pointing at the branch that was not the default. Every
new contributor, every tool that assumes the default branch, and every link that
resolves against it started from the wrong place.

Samuel: *"I want really to squash the main. It is no longer used. We have
already created a backup in a separate branch."* Verified before acting:
`origin/family-tutor` sat on the **same commit** as `origin/main` (`f0cb192`)
and was byte-identical, so the frozen product's history is fully preserved
independently of `main`.

### The new topology

- **`main`** — the product, and the only branch anybody develops on. Carries the
  workflow and the deploy trigger.
- **`family-tutor`** — the frozen baseline, and the backup of the old `main`.
  Kept indefinitely. Nobody works on it.
- **`PDR1-0`** — retired. `main` was a strict ancestor of it (0 ahead, 119
  behind), so the move was a **fast-forward**: no merge, no force push, and all
  119 commits remain on `main` as the record. Nothing was squashed, despite the
  word Samuel used — flattening a hundred commits would have destroyed exactly
  the per-phase record `docs/PROJECT_STATE.md` relies on.

### Two things this costs, named rather than discovered

1. **The frozen baseline has no pipeline deploy path.** `family-tutor` carries
   its own `ci-cd.yml` whose deploy gate reads `refs/heads/main` — a ref that
   now runs `main`'s workflow, not that copy. Redeploying the baseline means
   editing that copy's gate or doing it by hand. Acceptable *because* it is
   frozen, but it is a real loss and not a detail.
2. **ADR-0010's safety property is weakened by one.** "Each solution branch
   carries its own workflow, so editing one can never change what another
   deploys" still holds — but with one branch deploying, a rail changed in the
   wrong copy is now less likely to be noticed, because there is no second live
   copy to disagree with it.

### What did NOT change

**Constitution Principle XI stands untouched.** Environment attribution,
unpooled metrics and "student data does not cross solutions" are data hygiene,
not experiment design, and a branch topology has never been what enforced them —
`ai_interactions.environment` and the RLS policies are. The Clarification above
remains the record on why the two products are no longer a measurable
comparison.

### The order of operations, because it is the safety argument

`main` was fast-forwarded **while the deploy gate still read `PDR1-0`**, so the
push that moved 119 commits could not deploy anything. The gate was changed to
`refs/heads/main` in a **separate commit afterwards**, and `workflow_dispatch`
was left in place, so no push, merge or tag deploys — a deploy is still a person
pressing a button. A branch move and a change to what deploys are two decisions
and must not arrive in one push.

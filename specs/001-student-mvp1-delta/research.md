# Phase 0 Research — Student MVP 1.0 Comparison Build

**Feature**: `001-student-mvp1-delta` | **Date**: 2026-09-08
**Purpose**: resolve the technical unknowns in `plan.md` before design. Each item states a decision,
why, and what else was weighed. Per Constitution Principle I these are **proposals** — Samuel decides.

---

## R1. BKT parameters and cold start

**Decision**: implement standard four-parameter BKT with the posterior-then-transit update, seeded
with fixed defaults per skill, stored as columns so they can be tuned later without a code change.

```
Evidence step (given observation):
  P(L|correct)   = P(L)(1−P(S))            / [ P(L)(1−P(S)) + (1−P(L))P(G) ]
  P(L|incorrect) = P(L)P(S)                / [ P(L)P(S)     + (1−P(L))(1−P(G)) ]
Learning step:
  P(L') = P(L|obs) + (1 − P(L|obs)) · P(T)
```

Starting values: `P(L₀)=0.30`, `P(T)=0.10`, `P(G)=0.20`, `P(S)=0.10`.

**Rationale**: `P(L₀)=0.30` is deliberately the prior the Elo implementation already uses
(`oldScore = ... : 0.3` in `api/attempts/route.ts`), so cold-start behaviour does not lurch between
the two environments for reasons unrelated to the hypothesis. The other three are the conventional
Corbett–Anderson starting points. Guess is set above slip because a meaningful share of the 450-item
bank is multiple choice, where guessing is genuinely easier than slipping.

**Clamping**: retain the existing `[0.02, 0.98]` clamp. Without it, BKT saturates and a confident
estimate can never be revised by new evidence — which would be worse than Elo, not better.

**Alternatives considered**: fitting parameters per skill from the existing attempt history (rejected
for now — the PoC has too little real attempt data to fit against, and fitting on demo-student data
would encode noise); Bayesian knowledge tracing with item difficulty (BKT+, rejected as
over-engineering for 90 skills); keeping Elo and only adding the evidence trail (rejected — the PRD
names BKT and it is the variable under test).

**Open for Samuel**: whether per-skill parameters should be hand-tuned for the pilot's specific units
or left at defaults. Recommendation: leave at defaults, so any measured difference is attributable to
the model rather than to tuning effort we did not also spend on the baseline.

---

## R2. OCR and upload parsing

**Decision**: parse uploads through the **Claude CLI already running on the box** (Samuel's
subscription), as a distinct metered surface.

**Rationale**: it introduces no new dependency, no new API key and no new bill, and it is the only
option that already has an operational story on this box (the `claude_cfg` volume, the existing
timeout and error handling in the ask path). It also handles the actual requirement better than
classical OCR does: PRD B10 wants *handwritten* student work and textbook pages understood in
context, not characters transcribed. And per FR-206, keeping parsing inside the runtime we already
audit avoids sending minors' photographs to an additional third party.

**Consequences**: upload parsing must be metered as its own surface in `ai_interactions`, because
image tokens are materially more expensive than text and Principle VI requires that cost be visible
separately from day one. A per-student upload cap is required — proposed 10/day — enforced
server-side alongside the existing turn caps.

**Alternatives considered**: Tesseract in the container (rejected — poor on handwriting, no semantic
understanding, and adds a system dependency); a hosted OCR API such as Google Vision or Azure
(rejected — new vendor, new key, new cost centre, and minors' images leaving to a third party
triggers exactly the PRD §9 review we have deferred); client-side OCR (rejected — the PRD's device
target is a tablet and the work belongs server-side).

---

## R3. Content parity enforcement (FR-904)

**Decision**: a Python check `services/extraction/parity_check.py` that connects to both databases,
computes a **content fingerprint**, and exits non-zero on any difference. Run in CI on the `mvp1`
branch and immediately after every content refresh in either environment.

Fingerprint = source-document sha256 + counts of `module`, `learning_objective`, `prerequisite_of`
edges, `questions` (total and `status='live'`), `visuals` + a sorted digest of learning-objective ids.

**Rationale**: counts alone would miss a swap of one LO for another; the id digest catches that
cheaply without hashing full content, which would false-positive on harmless whitespace differences.
Expected values are the verified constants — 10 / 90 / 112 / 450 / 212.

**Note that matters**: `promote-poc` bulk-promoted the baseline's questions to `live`, and PROJECT_STATE
records that a math refresh demotes Unit-1's 29 back to `review` (933 → 904). The parity check must
therefore compare **live** counts explicitly, or the two environments can silently diverge on what is
actually servable while total counts still match.

**Alternatives considered**: comparing full row dumps (rejected — brittle and slow); trusting both
environments to load the same bundle files (rejected — that is the assumption the check exists to
verify, and Principle XI says drift must fail loudly).

---

## R4. Crisis escalation channel (FR-602) — **UNRESOLVED, needs a human owner**

**Technical decision**: detection runs on the ask path in `lib/safety.ts`, writes a `safety_flags` row
carrying flag type and timestamp only (FR-802), and dispatches out-of-band immediately — not through
the analytics queue. Dispatch is an adapter with two implementations: email to a named address, and a
webhook, so the channel can change without touching detection.

**What is not resolved**: who receives it. FR-602 says a crisis flag reaches a human immediately;
that is an operational commitment, not a code path. An unmonitored channel is arguably worse than
none, because it produces a record that looks like a safeguard and is not one.

**Recommendation to Samuel**: name one founder as the on-call recipient for the pilot's duration, with
a stated response expectation, before any student is invited. Until that name exists, P5 in the plan's
phasing is not complete, and the environment should carry founders only.

**Alternatives considered**: routing to a shared founders' inbox (weaker — no individual accountability
and no response expectation); deferring crisis detection entirely for a 10–20 student pilot (rejected —
the cohort is real minors and the cost of the code path is small; it is the human commitment that is
the real work).

---

## R5. Box capacity for two stacks

**Decision**: before P0 completes, measure the box's free memory and disk and re-check the compose
limits, rather than assuming the second stack fits.

Current per-stack limits are `db` 1g, `app` 2g, plus the loader at 512m when it runs. A second stack
therefore asks for roughly **3 GB more** steady-state, on a box already co-tenanting the production
`talent.reletix.com` and `talent-preprod` stacks.

**Rationale**: this is the cheapest possible failure to prevent and the most expensive to discover
late — an OOM on a shared box can take down production tenants that have nothing to do with this
experiment. Principle X's shared-box rails exist for exactly this class of mistake.

**Mitigation if memory is tight**: lower the comparison stack's `app` limit first (it serves 10–20
users, not a cohort), then consider `shared_buffers` tuning on its Postgres. Do **not** reduce the
baseline's limits — that would change the frozen environment's behaviour under load.

**Open**: needs a reading from the box. Cannot be resolved from the repository.

---

## R6. Cloudflare hostname and Access policy

**Decision**: propose `mvp1.ainext.reletix.com`, added as a second public hostname in the
**Cloudflare Zero Trust dashboard** pointing at `http://localhost:3101`, reusing the existing Access
application policy with the pilot emails added.

**Rationale**: DEPLOY.md records that ingress for this box is dashboard-managed, not a local
`config.yml`, so `cloudflared tunnel route dns` and `systemctl reload cloudflared` do not apply — a
trap worth restating here because it is the single most likely wasted hour in P0. Reusing the existing
Access application rather than creating a second one means one place to add and revoke pilot families,
which matters because revocability is what bounds the R‑Q8 unreviewed-content risk.

**Alternatives considered**: a path prefix on the existing hostname (rejected — cookies, storage and
Access policy would be shared, and the two environments must not share client state); a separate
tunnel (rejected — unnecessary, and more moving parts on a shared box).

**Open for Samuel**: the hostname itself is a naming preference, not a technical constraint.

---

## R7. Deploying two environments from one workflow

**Decision**: extend `ci-cd.yml` with a branch→environment mapping rather than duplicating the
workflow: `main` → `/opt/reletix/AI.NEXT` (project `ainext`, port 3100);
`mvp1` → `/opt/reletix/AI.NEXT-mvp1` (project `ainext-mvp1`, port 3101). The deploy job's `APP_DIR`,
compose project and health-check port become matrix values derived from `github.ref_name`. The
existing `concurrency: deploy-oci` group is kept so the two never deploy simultaneously onto the
shared box.

**Rationale**: one workflow means one place where the shared-box safety rails (no `system prune`,
dangling-only cleanup, health gate before traffic) are enforced. Two copies would drift, and the copy
that drifts is the one that eventually prunes production's images.

**Consequence**: the deploy job's `if:` condition widens from `refs/heads/main` to the two named
branches. Every other branch still builds and never deploys — unchanged.

**Alternatives considered**: a separate `ci-cd-mvp1.yml` (rejected, per above); deploying the second
environment by hand (rejected — it would drift from the repo and break the "code deploys can never
touch data" separation that Principle X depends on).

---

## Summary of what still blocks

| # | Item | Blocks | Resolvable by |
|---|---|---|---|
| R4 | Named human recipient for crisis escalation | Real students on the environment (P5 gate) | **Samuel — a person's name** |
| R5 | Box memory headroom for a second stack | P0 rollout | A reading from the box |
| R6 | Hostname preference | P0 ingress step | Samuel, or accept the proposal |
| R1 | Per-skill BKT tuning vs defaults | Nothing — defaults are safe | Samuel, optional |

Everything else is decided and ready for Phase 1 design.

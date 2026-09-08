# Delta Matrix — PoC baseline vs. Student MVP 1.0

**Companion to**: `spec.md` in this directory
**Baseline**: `specs/000-baseline/spec.md`, as-built at main `f0cb192`, live at `ainext.reletix.com`
**Target**: `PRD: AI Tutor — Student MVP` v0.4 (Tamer Deif, 2026-09-03)
**Date**: 2026-09-08

> **Scope narrowed 2026-09-08.** Samuel answered a twelve-question scope pass (`decisions.md`); the
> constitution was amended to v2.0.0 and the decision recorded in ADR-0007. This matrix still shows the
> **full** PRD-vs-baseline difference, which is what makes it useful as a reference — see
> "§7 What the decisions cut" at the end for what is actually being built first.

Disposition codes:

| Code | Meaning |
|---|---|
| **KEEP** | Exists and is unchanged by the new PRD |
| **EXTEND** | Exists; the PRD widens or deepens it |
| **REPLACE** | Exists, but the PRD calls for a different mechanism |
| **NEW** | Does not exist in any form today |
| **DROP** | Exists but is out of scope for this build |

---

## 1. The headline

The PoC is a **content-proving instrument**: it demonstrates that a ministry textbook can become a
grounded, teachable curriculum graph, and it does so across three subjects for an audience that is
handed a profile. The new PRD describes a **product a stranger can buy**: accounts, payment, safety
escalation, parent visibility, and a probabilistic model of the learner.

The good news, and it is genuinely good: **the hard half is already built and stays.** The extraction
pipeline, the review gate, grounded teaching with citations, deterministic grading, the curriculum
graph and the 450-question mathematics bank all carry over untouched. The PRD's own §3 calls the
content pipeline "arguably the largest pre-launch dependency in this entire PRD" — and for the book
we are holding constant, that dependency is already discharged.

What is new is almost entirely the **product shell** around the teaching core, plus one genuine
change at the centre: **Elo becomes Bayesian Knowledge Tracing**.

---

## 2. Product framing

| Dimension | Baseline (as-built) | Student MVP 1.0 (PRD v0.4) | Disposition |
|---|---|---|---|
| Buyer / account owner | Parent owns the account | Student owns the account; parent is a linked read-only view | **REPLACE** |
| Primary persona | Egyptian secondary student, sold via parent | Student, grades 7-12, Egypt/MENA | **EXTEND** |
| Subjects live | Mathematics, Social Studies, Arabic Language | Mathematics only | **DROP** (deferred, not deleted) |
| Curriculum system | Egyptian national, new Bakaloreya framing | International primary; national English-medium a maybe | **REPLACE** *(held constant for this build)* |
| Delivery language | Arabic RTL throughout | English-first; Arabic/Franco switching later | **REPLACE** |
| Device target | Low-end Android on 3G, first load < 1.5 MB | iPad Safari + desktop; Android tablets explicitly not optimised | **REPLACE** |
| Connectivity | Session survives connection drops | Good wifi assumed for MVP | **REPLACE** |
| Parent reporting | Weekly WhatsApp report (manual) | In-product read-only dashboard + threshold alerts | **REPLACE** |
| Pilot goal | 50 paying families, ≥60% M2 retention | Phase 1: 100 paid users; Phase 2: 1000+ | **REPLACE** |

---

## 3. Requirement-level diff

### Teaching core — mostly KEEP

| Baseline | What it does today | New PRD | Disposition |
|---|---|---|---|
| `FR-001` | AI-led learn + review modes, beat pacing, one interactive per message | B1, B7, B8 — same shape, English voice | **KEEP** (retune voice) |
| `FR-002` | Every claim carries `[[lo]]`/`[[q]]`/`[[page]]` citations | Retrieval-first grounding | **KEEP** |
| `FR-003` | Mistakes explained from the reviewed canonical solution, never re-solved | B2 + §8 "never improvise a novel refutation" | **KEEP** — PRD is stricter |
| `FR-004` | Out-of-book → acknowledge, decline, redirect | §8 out-of-graph row | **KEEP** |
| `FR-005` | Stored end-of-lesson comprehension report | D1 dashboard consumes it | **KEEP** |
| `FR-020` | Deterministic grading, transactional mastery, Elo K=0.15 | C1 — BKT mastery probability | **REPLACE** (grading determinism kept; model swapped) |
| `FR-022` | 10 tap-first widget types, payload-validated, grounded | Not contradicted | **KEEP** |
| `FR-030` | Per-subject behaviour lives in the registry | Single subject, but registry discipline holds | **KEEP** |
| `FR-031` | Cross-subject handoff cards, curated bridges | Math-only; dormant | **KEEP** (dormant) |

### Sacred text — KEEP, dormant

| Baseline | New PRD | Disposition |
|---|---|---|
| `FR-010`–`FR-013` sealed passages, runtime output guard, آية-number pointers | No Arabic content in this build | **KEEP** in code, dormant in this environment; still live in the baseline environment |

### Identity & accounts — the largest single gap

| Baseline | New PRD | Disposition |
|---|---|---|
| `FR-040` server-validated demo cookie, explicitly *not* auth | A1 email/phone signup with verification | **REPLACE** |
| `FR-041` visible profile picker, in-place student creation | Gone — a stranger signs themselves up | **REPLACE** |
| `FR-042` session survives reloads and drops | B9 resume where I left off | **KEEP/EXTEND** |
| — | A2 grade capture (7-12) | **NEW** |
| — | A3 interest capture, 5 categories + Other, skippable, with Sports/Music detail | **NEW** |
| — | A4 stay logged in across visits | **NEW** |
| — | F2 account-sharing deterrence | **NEW** |

### Student model & retrieval — the substantive change

| Baseline | New PRD | Disposition |
|---|---|---|
| Elo-style per-LO score, bitemporal history, K=0.15 | BKT mastery probability with evidence trail | **REPLACE** |
| Student row: display name, grade | Grade, language preference, curriculum system, interests, interest detail, communication style | **EXTEND** |
| Grounding slices assembled per surface, prompt-kit driven | An explicit retrieval layer — the PRD names this as "the piece that doesn't exist yet" | **REPLACE** |
| Canonical solutions attached to questions | Typed explanation library: worked example / faded / contrasting case / refutation, each human-reviewed | **EXTEND** — real authoring work |
| — | Misconception as a first-class diagnosable entity | **NEW** |
| — | Mid-year placement assessment | **NEW** |
| Attempts store correctness + mastery delta | Attempts store diagnosis type, misconception id, stance used, confidence | **EXTEND** |

**Note on naming**: the PRD's "skill taxonomy" and "prerequisite graph" are our existing
`learning_objective` nodes (90) and `prerequisite_of` edges (112); its "Q-matrix" is our
question-to-LO tagging. PRD §3.1 items 1–3 are already satisfied for this book. Item 4 — the reviewed
explanation/refutation library — is the one that genuinely needs a subject-matter expert.

### Student-facing surfaces

| Baseline | New PRD | Disposition |
|---|---|---|
| `/student` home, subject cards, lesson picker | A2 → single-subject entry | **EXTEND** |
| Practice loop, mastery-weighted plan assembly | B1 unit walkthrough | **KEEP** |
| Ask the Spine — grounded chat on `/spine` and `/student` | B3 ask anything, guided, never hands over graded answers | **EXTEND** — and note this was a *declared PRD non-goal* in the baseline, now core |
| — | B10 photo/PDF upload with OCR grounding | **NEW** |
| — | D1 per-topic performance dashboard | **NEW** |
| — | D2 exam prep, high-yield topics + prioritised weaknesses | **NEW** |
| `/`, `/spine`, `/gallery`, `/pipeline` investor surfaces | Not in the PRD | **KEEP** (baseline environment) / **DROP** (new environment) |

### Parent

| Baseline | New PRD | Disposition |
|---|---|---|
| Parent dashboard is an explicit PRD non-goal; weekly WhatsApp report is manual | E1 read-only dashboard + threshold alerts, non-punitive | **NEW** |

### Safety

| Baseline | New PRD | Disposition |
|---|---|---|
| Sacred containment, turn caps, grounding refusals | F1 self-harm/crisis response + escalation | **NEW** |
| — | Crisis channel deliberately separate from routine analytics | **NEW** |
| Per-student scoping of sessions, caps, spend | F1 privacy between students | **KEEP** |

### Monetisation — entirely new

| Baseline | New PRD | Disposition |
|---|---|---|
| None — the PoC sits behind Cloudflare Access for a known audience | G1 14-day trial | **NEW** |
| — | G2 card payment via tokenised hosted checkout | **NEW** |
| — | G2 shareable parent payment link (WhatsApp/email) | **NEW** |
| — | G3 plans page with upgrade/downgrade/cancel | **NEW** |
| — | §10 one trial-ending reminder, dunning, failed-payment state | **NEW** |

### Analytics & cost

| Baseline | New PRD | Disposition |
|---|---|---|
| `FR-050` per-call token/cost/latency ledger; in-session spend meter | H1 + §13 product event taxonomy (~20 events) | **EXTEND** — different layer, both needed |
| `FR-051` server-enforced per-surface turn caps | Not mentioned; still the cost lever | **KEEP** |
| EGP 40/student/month ceiling (Constitution VI) | No ceiling stated; uploads/OCR add unbudgeted cost | **REPLACE** — needs a decision |

### Operations

| Baseline | New PRD | Disposition |
|---|---|---|
| `FR-060` PR → main → self-hosted runner → build on box → health check | Unchanged | **KEEP** |
| `FR-061` content refresh with typed confirmation, backup, rollback, drift detection | Unchanged, now needed for two stacks | **EXTEND** |
| `FR-062` `--approve-all` refuses sacred bundles; review-status gate | Reinforced by PRD §3.1(4) | **KEEP** |
| Single stack, port 3100, one hostname | Two stacks side by side, own volumes/ports/hostnames | **EXTEND** |

---

## 4. Comparison environment

Current topology, from `deploy/docker-compose.yml` and `deploy/DEPLOY.md`:

- Stack at `/opt/reletix/AI.NEXT` on Samuel's Oracle OCI box, co-tenant beside `talent/`
- App bound to `127.0.0.1:3100` only; Postgres not published to the host
- Existing token-managed `cloudflared` container serves `ainext.reletix.com` → `localhost:3100`
- Ingress managed in the Cloudflare Zero Trust dashboard, **not** a local `config.yml`
- Behind Cloudflare Access (Allow → Include → Emails, one-time PIN)
- AI runtime is the bundled `claude` CLI on Samuel's subscription, OAuth persisted in the
  `claude_cfg` volume — **destroyed only by `down -v`**

What the second environment needs:

| Concern | Requirement |
|---|---|
| Isolation | Own compose project, own database volume, own internal port (3100 is taken) |
| Ingress | A second public hostname added in the Cloudflare Zero Trust dashboard, same Access policy |
| Content | Loadable from the same bundles; parity check enforced (FR-904) |
| Data | No student data crosses environments |
| Attribution | Environment tag on every event, ledger row and cost record (FR-901) |
| Blast radius | Standing it up must not redeploy, restart or mutate the existing stack (FR-903, FR-906) |
| Hard rule | Never `docker compose down -v` on the shared box — it destroys the AI runtime login |

---

## 5. Build-effort read

Rough shape, for sequencing rather than estimation:

**Reused wholesale (no work)** — extraction pipeline, curriculum graph, 450-question bank, 212
visuals, review gate, citation/provenance machinery, deterministic grading, widget library, deploy
and content-refresh pipelines.

**Genuinely new build** — accounts and verification, onboarding, BKT, retrieval layer, explanation
library authoring, uploads and OCR, dashboards, exam prep, placement, parent view, safety escalation,
billing end to end, analytics taxonomy, second environment.

**The three that carry the most risk**:

1. **The explanation/refutation library (FR-304)** — the only item that needs a mathematics
   subject-matter expert rather than an engineer. It gates the core teaching behaviour, and the PRD
   is emphatic that none of it may be AI-generated and shipped live. This is the critical path.
2. **BKT replacing Elo (FR-301)** — swapping the mastery model changes what every downstream surface
   reads. It also means the comparison measures the whole experience rather than isolating the
   algorithm (Open Decision 3 in `spec.md`).
3. **Safety escalation (FR-602)** — a crisis flag reaching a human channel implies a human is on the
   other end of it. That is an operational commitment, not a code path, and it needs an owner named
   before a real student uses the product.

---

## 6. What this diff does not cover

- **Legal** — PRD §9 (Law No. 151/2020, terms and privacy policy addressing minors, parental consent,
  retention and deletion) is unresolved and blocks a real paid cohort.
- **Pricing** — deliberately unset in the PRD; a business decision.
- **The four constitution conflicts** — recorded in `spec.md` under Governance Impact, for Samuel.
- **Implementation** — no architecture, schema or technology choices are made here. That is
  `/speckit-plan`, and per Constitution Principle I it needs Samuel's decisions first.

---

## 7. What the decisions cut

Applying `decisions.md` to the matrix above, the first build is:

**Built now**
- Teaching mechanics: BKT replacing Elo, retrieval layer, misconception/refutation library
- Ask-anything, guided, never handing over graded answers
- Uploads + OCR
- Student dashboard (per-topic)
- Parent view + threshold alerts
- English LTR chrome, direction kept switchable
- Second environment behind Cloudflare Access, with content parity enforced
- Conversion-metric instrumentation on **both** environments

**Not built (deferred, not deleted)**
- Epic A signup, verification, session handling → replaced by a student picker with "create new user"
- Epic G trial, card payments, plans page, parent payment link
- F2 account-sharing deterrence (no accounts to share)
- Exam prep (D2) and mid-year placement (C2) — dependent on mastery data existing first

**Changed in kind rather than deferred**
- The explanation library ships **pipeline-generated and unreviewed**, flagged and attributed, bounded
  by Cloudflare Access. The review gate stays enforced for questions and canonical solutions.
- Parent access rides the same picker as students, with the accepted limitation that any pilot parent
  can see any pilot student's data.

**The three risks that survive this narrowing** — unchanged from §5 above except that the first is now
larger, because the human gate that would have caught it has been suspended:

1. Unreviewed generated teaching content reaching real students, inside the very metric being measured.
2. The comparison cannot attribute a result to any single change (accepted deliberately, Q4).
3. Safety escalation still implies a human on the other end of the channel, and that owner is unnamed.

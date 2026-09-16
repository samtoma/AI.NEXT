# ADR-0007: PRD supersession — "Student MVP" (International) replaces "Founding Families" (Bakaloreya)

- **Status:** Accepted
- **Date:** 2026-09-02
- **Decided by:** Samuel (CTO/Architect)

## Context

Every ADR to date (0001–0006) built toward `PRD-ai-tutor-mvp.md` v1.0 ("Founding Families" pilot,
Approved for build, July 2026): Egyptian national Bakaloreya curriculum, grade 10/11, Arabic RTL
throughout, sold to parents, low-end Android + 3G, WhatsApp-only parent reports, no parent
dashboard. That scope produced the data-spine architecture, the extraction pipeline + coverage
oracle, and three shipped verticals (Math, Social Studies, Arabic Language incl. sealed Quran
lane) — all Prep-3 (~grade 9) content sourced from Egyptian ministry textbooks.

On 2026-09-01/02, Tamer Deif (co-CEO; per the team's Decision Matrix, **Product & Customer is his
"Decide" domain**) circulated a new PRD — *"PRD: AI Tutor — Student MVP"*, now at **v0.5**,
`PRD_Student_MVP1.0.md`/`.pdf` — describing a different MVP: International curriculum (IGCSE /
American diploma) as the confirmed primary target, English-medium primary language, iPad Safari +
desktop web (explicitly not optimizing for Android), grades 7–12, a parent dashboard in scope
(vs. WhatsApp-only), and a skill-taxonomy/Q-matrix/BKT/"Retrieval Layer" architecture description
that doesn't reference the spine/graph work already built. Companion docs: `ai_tutor_system_
instructions_v1.0.md` (operating instructions, internally v1.2) and a K-12 design system.

Samuel confirmed on 2026-09-02 that this new PRD is now the operative one.

Per the Decision Matrix, **Technology/Architecture is "Contribute only" for both co-CEOs** — the
new PRD's architecture diagram is a "starting skeleton... not prescribed," explicitly leaving
implementation to engineering. This ADR is the architecture-side response to a product-side
decision already made elsewhere.

## Options considered

1. **Full replacement** — new PRD becomes the sole authoritative scope; re-target content,
   platform, and language; keep the spine architecture, extraction pipeline, and review-gate
   discipline unchanged (they were built to be curriculum/subject/language-agnostic). *Chosen.*
2. **Run both scopes in parallel** (dual-curriculum, dual-language product) — rejected: doubles
   content-sourcing and QA surface against a Phase 0 target that is now ~2 weeks out
   (mid-September per both PRDs' rollout plans), with no resourcing to match.
3. **Reject the new PRD, hold the old scope, escalate** — not the decision Samuel made; recorded
   here as the road not taken, not as a live option.

## Decision

**`PRD_Student_MVP1.0` (v0.5, Tamer Deif) is now the authoritative product-scope document,
superseding `PRD-ai-tutor-mvp.md` v1.0.** Per CLAUDE.md's authority rules, this is a product-scope
decision (Tamer's domain), not an architecture decision — but it changes several inputs the
architecture was tuned against:

| Dimension | Was (v1.0) | Now (v0.5) |
|---|---|---|
| Curriculum | Egyptian national Bakaloreya | International (IGCSE/American), National-English as fallback — pending §3.3 content-rights call |
| Grade band | Grade 10 (11 secondary) | Grades 7–12, 1–2 grades to be chosen for depth |
| Primary language | Arabic RTL throughout | English LTR (proposed simplification, pending confirm); AR/Franco deferred |
| Subjects in MVP | Math only (Social Studies/Arabic were vertical expansions, not MVP scope) | Math only — unchanged |
| Device target | Low-end Android + 3G | iPad Safari + desktop; Android/3G explicitly not optimized for |
| Parent surface | WhatsApp reports only (dashboard = non-goal) | Parent dashboard + alerts, in scope |
| Mastery model | Elo-style (built) | BKT (specified) |
| Monetization | EGP 250–400/mo, no stated trial | 14-day trial, card-only MVP, Paymob/Fawry recommended |

The data-spine architecture (Postgres graph, bitemporal mastery, provenance, human review gate,
extraction pipeline with coverage oracle) is **not** superseded — it was built curriculum- and
language-agnostic for exactly this reason (ADR-0001 §19.6 MVP-cut discipline; ADR-0004's
subject-registry pattern already generalizes cleanly). What changes is the *content* poured
through it, the *device/language* surface on top of it, and several *net-new subsystems* (billing,
parent dashboard, auth, upload/OCR, explanation/refutation library) neither PRD's built state had
yet. Full breakdown: `docs/specs/gap-analysis-student-mvp-v0.5.md`.

## Consequences

**Enables.** Near-zero rebuild of the graph/provenance/review-gate core — `graph_nodes`/
`graph_edges` already implement PRD §3.1's "skill taxonomy + prerequisite graph" generically, and
`questions.canonical_solution` already implements the item bank. The multi-subject registry
(ADR-0004) means "Math only" doesn't require deleting the Social Studies/Arabic verticals, just
not surfacing them for this MVP.

**Costs.** All built curriculum content (90 math LOs, ~450 math questions) is Egyptian-national-
sourced and doesn't count toward an International-curriculum requirement — new content sourcing
starts near zero. The Arabic-first RTL/sacred-containment investment (ADR-0006) sits unused for
this MVP, not deleted. No billing, parent dashboard, auth, upload/OCR, or explanation/refutation
library exists yet — all net-new, against a Phase 0 target (mid-September) that is now ~2 weeks
out. Mastery model changes from the built Elo-style scorer to BKT — a real algorithmic swap, not
a rename.

**Revisit if.** The §3.3 content-rights question resolves toward National-English rather than
International — in which case the existing Prep-3 Math (English) content becomes directly
reusable instead of orphaned, materially changing the content-gap picture. Also revisit if Phase 0
timeline pressure forces a scope cut back toward what's already built (see gap analysis
recommendation).

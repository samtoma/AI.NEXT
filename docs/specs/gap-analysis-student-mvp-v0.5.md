# Gap analysis — built state vs. `PRD_Student_MVP1.0` v0.5

> Companion to ADR-0007. Read that first for the decision; this is the inventory behind it.
> Sources: `docs/PROJECT_STATE.md` (built state, through 2026-08-02 + Arabic vertical 2026-07-30),
> repo code (`app/`, `services/extraction/`), `PRD_Student_MVP1.0.md`/`.pdf` v0.5,
> `ai_tutor_system_instructions_v1.0.md` (v1.2), Drive folder `1YE-JFQiCBLNshAwhWY7flwYq_0ekcNm-`.

## Timeline reality check

Both the old and new PRD target **Phase 0 mid-September** for a closed pilot. Today is
2026-09-02 — **that's ~2 weeks out.** Every "net-new" item below competes for that window against
whatever content-sourcing and legal work §3.3/§9 still block. This should shape sequencing more
than any single architecture concern.

## 1. Data model / architecture

The spine's graph already covers more of PRD §5's data model than the PRD's own "doesn't exist
yet" framing suggests — it just isn't described that way in the PRD.

| PRD §5 entity | Built equivalent | Gap |
|---|---|---|
| Skill / SkillPrerequisite | `graph_nodes` (kind=learning_objective) + `graph_edges` (type=prerequisite_of) | None — generic by design (ADR-0001) |
| Item | `questions` (with `canonical_solution` JSONB steps) | None |
| Unit / LessonStep | `graph_nodes` (kind=module/topic) + lesson content JSON | None |
| Attempt | `attempts` table (append-only) | Field set close; confirm `diagnosis_type`/`misconception_id`/`stance_used`/`confidence` columns match instructions doc §9's JSON exactly |
| MasteryEstimate | `mastery` table, **Elo-style score**, bitemporal | **Real gap: PRD specifies BKT.** Elo↔BKT are different models (BKT is a per-skill HMM with learn/guess/slip params, not an ELO update) — this is a swap, not a relabel. Flag for ai-engineer + your sign-off. |
| ExplanationLibraryEntry (worked_example/faded/contrasting_case/refutation, keyed by misconception_id) | **Does not exist.** Current prompt grounds explanations in `canonical_solution` + live AI generation, not an authored, human-reviewed, misconception-keyed library. | **Real gap.** This is what the instructions doc §4 misconception protocol and PRD B3/F1 actually run on — without it, §4.3's "flag for human authoring review" has nothing to flag into. |
| Student (language_pref, curriculum_system, interests[]) | Student/demo-student model exists but lacks `interests[]`, `curriculum_system` | New fields, small lift |
| Subscription | **Does not exist.** No billing state machine. | **Net-new** — see §4 |
| ParentLink | **Does not exist** (WhatsApp-only was the old design) | **Net-new** — see §4 |
| Upload | **Does not exist** | **Net-new** — see §4 |
| Session (platform field) | Partial — session handling exists for the demo surface, not the real auth'd product | Net-new, was already on the roadmap (`PROJECT_STATE.md` "Next" #4) regardless of which PRD |

**Provenance/citation layer — already built, not a gap.** `source_documents` (content-addressed by
sha256) → `extraction_runs` (versioned batches) → `graph_nodes`/`questions` (each carrying
`source_sha256`/`source_page`/`extraction_run_id`) → `explanation_log` (`grounded_ok` flag, replayable)
→ `ai_interactions` (`grounding` sent vs. `citations` emitted, logged separately per turn). PRD §5's
data model has no equivalent of this. Recommendation for the review: don't ask Tamer to "add
provenance" as new scope — point him at this existing chain and propose `Item`/`ExplanationLibraryEntry`
adopt the same shape (`source_sha256`, `source_page`, `status: draft/review/live`) rather than a new
design. This also directly implements PRD §9's "flag for human authoring review" (instructions doc
§4.3) — `questions.status` already models exactly that lifecycle.

**Retrieval Layer** (PRD §4): partially exists in spirit — `app/src/lib/ask.ts` / `lesson.ts`
already compose a grounding slice (mastery + prerequisite edges + LO + question catalog) per
student per turn, which is the retrieval layer's job description. It isn't architected as an
explicit named layer that also pulls from an explanation/refutation library, because that library
doesn't exist yet. Extending it once §ExplanationLibraryEntry lands is additive, not a rebuild.

## 2. Content

**This is the largest gap, independent of architecture.** Everything extracted to date —
90 math LOs / ~450 questions, 84 Social Studies LOs, 20 Arabic Language lessons — is sourced from
**Egyptian ministry Prep-3 (~grade 9) textbooks**. The new PRD's confirmed primary target is
**International (IGCSE/American)**. None of the built question bank counts toward that.

One correction to the working assumption: the built Math content is **already in English**
(ADR-0002: "PoC content = ministry Prep-3 Math (English)") — so "English-medium" per se isn't the
gap; **curriculum system and grade band** are. If §3.3's content-rights question resolves toward
National-English rather than International, the existing Math content becomes directly reusable
and this gap shrinks a lot. That question is upstream of a real content-sourcing decision and
isn't yours to resolve alone (§3.3 calls it "a legal/business decision").

The extraction pipeline itself (schema-driven, Pydantic-validated, coverage-oracle-gated, tiered
Haiku+Sonnet, human review before live) is curriculum-agnostic — it has never ingested an IGCSE or
American-diploma source, but nothing about it assumes Egyptian-ministry-specific structure except
the manifest/page-offset config per book (see ADR-0006's page-offset lesson — expect a new
manifest, not new machinery, per source document).

**Explanation/refutation library authoring** (PRD §3.1 item 4) has no pipeline stage today — the
extraction pipeline produces questions + canonical solutions, not worked examples / faded variants
/ contrasting cases / refutation texts keyed to misconception IDs. This is new pipeline surface,
not just new content volume.

## 3. Platform & language

- **Device:** app is responsive Next.js; PRD wants iPad Safari + desktop, explicitly not
  optimizing for Android. Likely renders fine already (untested on-device) — the gap is
  **QA coverage**, not a rebuild. The low-end-Android/3G performance discipline (< 1.5 MB first
  load, from CLAUDE.md's non-negotiable constraints) was built for a different device target; it's
  not wasted (it's a floor, not a ceiling) but stop treating 3G as the binding constraint.
- **Language/RTL:** the Arabic-first RTL investment (ADR-0006: Noto Naskh/Amiri fonts, sacred
  Quran containment, RTL lesson surfaces, span highlighting) is real, shipped, and **not in this
  MVP's critical path** — PRD §6 proposes English-only LTR for MVP, deferring bilingual RTL until
  Arabic-medium content ships. Nothing needs to be deleted (ADR-0004's subject-registry pattern
  means Arabic/Social Studies stay dormant, not removed) but budget/timeline shouldn't count on
  them for Phase 0.

## 4. Net-new subsystems (exist in neither PRD's built state)

These aren't "gaps between two PRDs" — they were never built, full stop, and both PRDs need them:

- **Auth** (email/phone signup, OTP/magic link, session handling, account-sharing deterrence) —
  already `PROJECT_STATE.md` "Next" #4 before this pivot.
- **Billing/subscription** (14-day trial, Paymob/Fawry, plans page, dunning, trial-ending
  reminder) — the new PRD's §10 is materially more specified than the old one had; still zero
  code.
- **Parent dashboard** (read-only, non-punitive alerts) — this one *is* new work the pivot adds:
  the old PRD's non-goal was "no parent web dashboard," so this wasn't even on the old roadmap.
- **Upload/OCR ingestion** (B9/B10) — no pipeline exists for student-submitted photos/PDFs.
- **Analytics event schema** (PRD §13) — `ai_interactions` logs cost/tokens/citations today;
  the product-funnel event taxonomy (signup, onboarding, trial, payment, button_click, etc.) is
  unbuilt.

## 5. Teaching methodology / prompt alignment — open, needs a direct comparison

The current lesson/ask prompts (`app/src/lib/ask.ts`, lesson prompt kit) implement a beat
protocol, paced reveal, and comprehension-report-card flow per `PROJECT_STATE.md`. The new
instructions doc (v1.2) specifies a different explicit frame: 7 diagnosis types (`new`/`sloppy`/
`shaky`/`misconception`/`confusion`/`rusty`/`exam-imminent`), a stance-routing table, a mandatory
misconception protocol, and "every response ends in a retrieval act." I have not yet done a
line-by-line comparison of the shipped prompts against this doc — that's real work (ai-engineer
territory) I'd flag as the next concrete step rather than guess at from here.

## 6. Compliance

Unchanged and still open in both PRDs: Egypt PDPL review, ToS/Privacy Policy for minors, parental
consent mechanism, data retention policy for safety-escalation records. Neither PRD resolves
these; new PRD §9 restates the same open items as old PRD's equivalent section.

## Recommendation

Given the ~2-week Phase 0 window: the content-rights question (§3.3) and grade-band pick (§3.2)
are the actual gate — nothing in Epic B ships without them, and they're not engineering calls.
Get those answered first; everything else (billing, parent dashboard, auth, upload) is normal
build work that can proceed in parallel once scoped, and the architecture underneath doesn't need
to wait on them.

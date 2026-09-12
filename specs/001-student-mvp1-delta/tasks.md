---
description: "Task list for the Student MVP 1.0 comparison build"
---

# Tasks: Student MVP 1.0 — Comparison Build

**Input**: Design documents from `/specs/001-student-mvp1-delta/`
**Prerequisites**: `plan.md`, `spec.md`, `decisions.md`, `research.md`, `data-model.md`, `contracts/`
**Constitution**: v2.0.0 · **ADR**: 0007

**Tests**: Not blanket TDD. Test tasks appear only where an artifact already demands them — the six
BKT invariants in `contracts/bkt.md`, the parity check (FR-904), and the prompt byte-identity proof
that keeps the baseline a baseline (FR-908).

**Phase order note**: phases follow the **build sequence in `plan.md`**, not spec priority order. US7
(the comparison environment) is spec-priority P7 but must be built first — nothing can be compared
until two URLs exist. Each phase states its story and its spec priority.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable — different files, no dependency on an incomplete task
- **[Story]**: US1–US8 from `spec.md`; setup, foundational and polish phases carry no story label

---

## Phase 1: Setup

**Purpose**: branch, deploy scaffolding and the one thing that must be checked before touching a
shared production box.

- [ ] T001 Create long-lived branch `mvp1` from `origin/main` and push it, per plan.md A1 **[BLOCKED — needs permission]** this session is pinned to its designated branch; creating and pushing `mvp1` is a push to a different branch, which needs Samuel's explicit go-ahead.
- [X] T002 Create `deploy/docker-compose.mvp1.yml` — compose project `ainext-mvp1`, app on `127.0.0.1:3101`, own `ainext-mvp1_pg` and `ainext-mvp1_claude_cfg` volumes, loader kept behind `profiles: ["tools"]`
- [X] T003 [P] Write `deploy/DEPLOY-MVP1.md` — bootstrap, the dashboard-managed Cloudflare hostname steps, and the shared-box rails (never `down -v`, never `system prune`)
- [X] T004 [P] Extend `.github/workflows/ci-cd.yml` with a branch→environment matrix (`main`→`/opt/reletix/AI.NEXT`:3100:`ainext`, `mvp1`→`/opt/reletix/AI.NEXT-mvp1`:3101:`ainext-mvp1`), keeping the single `concurrency: deploy-oci` group
- [ ] T005 Measure box headroom before any second stack lands (`free -h`, `df -h /var/lib/docker`) and record the reading in `specs/001-student-mvp1-delta/research.md` R5 — a second stack asks ~3 GB and production `talent` is co-tenant **[BLOCKED — needs box access]** cannot be measured from the build container.

**Checkpoint**: branch and deploy definitions exist; box capacity is known, not assumed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: no user story work begins until this phase completes.

- [X] T006 Write `db/migrations/009-mvp1-bkt-library-analytics.sql` implementing the whole delta in `data-model.md`: `mastery` BKT columns + `evidence`, `misconceptions`, `explanation_library`, `students` profile columns, `attempts` diagnosis columns, `analytics_events`, `safety_flags`, `uploads`, `ai_interactions.environment` + `surface_kind`
- [X] T007 Add the `entry_type='refutation' ⇒ misconception_id IS NOT NULL` constraint and the `p_guess + p_slip < 1` check to migration 009 — a refutation with nothing to refute, and a degenerate BKT parameter set, are both bugs the schema can refuse
- [X] T008 [P] Create `app/src/lib/env.ts` resolving `AINEXT_ENVIRONMENT` (`baseline` | `mvp1`) from configuration only, never inferred from host or request — a misconfigured stack must produce obviously-wrong data rather than quietly pooled data (FR-901)
- [X] T009 [P] Create `app/src/lib/analytics.ts` — typed emitter for the `contracts/analytics.md` taxonomy, stamping `environment`, `student_id` and `occurred_at` server-side
- [X] T010 [P] Create `app/src/app/api/analytics/route.ts` as the client event sink; reject any client-supplied `environment` field outright
- [X] T011 [P] Create `services/extraction/parity_check.py` computing the FR-904 fingerprint (source sha256, module/LO/prerequisite/question/visual counts, sorted LO-id digest) and **comparing `status='live'` counts separately from totals** — research.md R3: a scoped refresh demotes bulk-promoted questions, so totals can match while servable sets differ
- [X] T012 Extend `app/src/lib/db.ts` write paths for `ai_interactions` to record `environment` and `surface_kind` on every AI call (Principle VI)

**Checkpoint**: schema, environment identity, measurement and the parity guard all exist.

---

## Phase 3: User Story 7 — Two environments, one book (spec priority P7, built first) 🎯

**Goal**: two URLs, same content, both Access-gated, parity green.

**Independent Test**: load both URLs; run the same lesson on each; `parity_check.py` exits 0.

- [ ] T013 [US7] Bootstrap `/opt/reletix/AI.NEXT-mvp1` on the box from branch `mvp1`, with its own `deploy/.env` and a **different** `POSTGRES_PASSWORD` than the baseline
- [ ] T014 [US7] Bring the stack up with `docker compose -p ainext-mvp1 -f deploy/docker-compose.mvp1.yml up -d --build` and confirm health on `127.0.0.1:3101`
- [ ] T015 [US7] Complete the one-time Claude CLI OAuth login inside the new stack's `app` container — the new `claude_cfg` volume does not inherit the baseline's login
- [ ] T016 [US7] Add public hostname `ainext-mvp1.reletix.com` → `http://localhost:3101` in the **Cloudflare Zero Trust dashboard** (not a local `config.yml`) and attach it to the existing Access application so pilot families are granted and revoked in one place (FR-907)
- [ ] T017 [US7] Load the identical math bundles into the new database via the loader container (`--all --course course:prep3-math-en`)
- [ ] T018 [US7] Run `parity_check.py` against both databases and confirm GREEN including live counts — 10 modules / 90 LOs / 112 prerequisite edges / 450 questions / 212 visuals
- [ ] T019 [US7] Verify the baseline stack was never restarted, redeployed or mutated during the whole procedure (`docker compose -p ainext ps` uptime unbroken) — FR-903
- [ ] T020 [US7] Confirm `curl -sI https://ainext-mvp1.reletix.com` returns a 302 to Cloudflare Access and the environment is never publicly reachable

**Checkpoint**: the comparison is now physically possible. Everything after this is the experience.

---

## Phase 4: User Story 1 — Pick who I am, or create me (spec priority P1)

**Goal**: a pilot student gets in through a dropdown or a two-field "create new user", and lands in a
lesson shaped by what they entered.

**Independent Test**: from a clean browser, create a student and reach the first streamed tutor
message in under a minute.

- [X] T021 [US1] Extend `app/src/lib/student-context.ts` to resolve and expose the new profile fields (interests, interest detail, language preference, curriculum system) alongside the existing server-side validation
- [X] T022 [US1] Extend the create-student flow in `app/src/app/api/demo-students/` to capture grade (7-12, required) and interests (five PRD categories + free-text Other, skippable) — FR-103, FR-104
- [X] T023 [US1] Add the Sports/Music optional follow-up detail capture, stored as `interest_detail` JSON, so FR-203 has a real signal and is never tempted to invent one
- [X] T024 [US1] Update the student picker UI in `app/src/components/student/` — visible dropdown plus "create new user", never a login form, English copy
- [X] T025 [US1] Flip the app shell to English LTR via the existing `app/src/lib/subjects.ts` direction seam; assert no page-level direction is hard-coded and the Arabic/Social contracts remain loadable (Principle V, FR-208)
- [X] T026 [US1] Persist and restore the last selected student and lesson position across visits (FR-105)
- [X] T027 [P] [US1] Emit `student_created`, `student_selected`, `session_started`, `session_ended` through `lib/analytics.ts`

**Checkpoint**: US1 independently demonstrable on the new environment.

---

## Phase 5: User Story 2 — The teaching core (spec priority P2) — **the hypothesis**

**Goal**: BKT mastery, one retrieval seam, and refutations served from stored entries.

**Independent Test**: run a student through a unit with a seeded misconception; the served refutation
is a stored entry, mastery is a probability that moves with evidence, and the next item changes.

- [X] T028 [US2] Create `app/src/lib/bkt.ts` implementing `contracts/bkt.md` — pure `bktUpdate(prior, observation, params)`, posterior-then-transit, clamped `[0.02, 0.98]`, `DEFAULT_PARAMS` 0.30/0.10/0.20/0.10
- [X] T029 [US2] Write `app/src/lib/bkt.test.mts` covering all six contract invariants, including **invariant 3**: 20 correct then 1 incorrect must fall strictly below the run's peak — an unclamped BKT saturates and becomes unrevisable, which would make the new model worse than the Elo one it replaces in exactly the dimension being measured
- [X] T030 [US2] Replace the inline Elo update in `app/src/app/api/attempts/route.ts` with `bktUpdate`, keeping the existing transaction, `FOR UPDATE` row lock and bitemporal row-closing untouched
- [X] T031 [US2] Persist the `evidence` JSON (attempt id, question id, observation, prior, posterior, after-transit, misconception id, confidence) on each new mastery row — FR-301's inspectable trail
- [X] T032 [US2] Record `diagnosis_type`, `misconception_id`, `stance_used` and `confidence` on the attempt row, leaving `confidence` nullable so low certainty is recorded honestly rather than coerced (FR-307)
- [X] T033 [US2] Create `app/src/lib/retrieval.ts` — the single grounding composition seam returning mastery on nearest skills, profile attributes, candidate misconception and its library entry, and the graph slice (FR-303)
- [X] T034 [US2] Refactor `app/src/lib/ask.ts` and `app/src/lib/lesson.ts` to compose grounding **only** through `retrieval.ts`, removing the per-surface assembly
- [X] T035 [US2] Create `app/src/lib/explanations.ts` — library lookup by `(lo_id, misconception_id, entry_type)`, returning stored entries only; never generates at request time
- [X] T036 [US2] Implement the authoring-gap path: no library entry for a detected misconception ⇒ serve the standard correct explanation and raise a `misconception_gap` flag (FR-305, PRD §8)
- [ ] T037 [US2] Run `app/scripts/capture-prompts.mts` after the retrieval refactor and review every diff deliberately — this environment's prompts are *expected* to change; the harness is here to prove nothing changed that we did not intend (Principle IX) **[BLOCKED — needs a live Postgres]** the harness renders every surface against a database; verified instead by inspecting the diff, which touches only ledger inserts and appends a retrieval block that renders to "" when nothing is retrieved.
- [X] T038 [P] [US2] Emit `explanation_delivered` (with `lo_id`, `entry_type`, `misconception_id`, `reviewed`) and `retrieval_attempt_started` / `retrieval_attempt_submitted`

**Checkpoint**: the variable under test is live. The comparison can begin producing signal.

---

## Phase 6: Content — the generated explanation library

**Purpose**: make US2's misconception path real. Per decisions.md Q8 this content ships **without**
human review, flagged and attributed.

- [X] T039 Create `services/extraction/runbook/refutation.workflow.js` reusing the ADR-0005 conveyor — per LO: enumerate likely misconceptions, author worked example / faded / contrasting case / refutation, verify each against the existing canonical solution, assemble
- [X] T040 Create `services/extraction/assemble_refutations.py` producing a validated bundle of `misconceptions` + `explanation_library` rows with page provenance carried through (Principle II)
- [X] T041 Extend `services/extraction/load_seed.py` to load the new bundle type, forcing `reviewed=false` and a generator attribution string on every row — the loader must make it impossible to insert generated content that claims to be reviewed
- [ ] T042 Generate and load the library for the pilot's units on the `mvp1` environment only; confirm the baseline database is untouched **[BLOCKED — needs the box]** generation needs the Claude runtime and loading needs the mvp1 database; the pipeline is complete and dry-run verified from manifest through assembler.
- [ ] T043 Verify `SELECT count(*) FROM explanation_library WHERE NOT reviewed` returns the expected count and is reportable on demand — this number is what makes the Principle III suspension honest and reversible (SC-011) **[BLOCKED — needs the box]** the query is ready and the loader forces `reviewed=false`; the count can only be taken against a loaded database.

**Checkpoint**: the tutor teaches misconception-specific content, and we can state exactly how much of it is unreviewed.

---

## Phase 7: User Story 3 — Ask anything, upload my own material (spec priority P3)

**Goal**: a student uploads a worksheet or asks a question and is taught through it, never handed the
answer.

**Independent Test**: upload a photographed worksheet, ask for the answer, get guided teaching.

- [X] T044 [US3] Create `app/src/app/api/uploads/route.ts` — multipart intake (JPEG/PNG/PDF, ≤10 MB), storage on the uploads volume, `202` with `uploadId`
- [X] T045 [US3] Create `app/src/lib/uploads.ts` parsing uploads through the on-box Claude CLI runtime (research.md R2), writing `parse_status` and `parsed_text`
- [X] T046 [US3] Distinguish `unreadable` from `failed` end to end, with different user-facing copy — unreadable asks the student to retype or reshoot, failed offers a retry; never silently guess at an unreadable upload (FR-205, PRD §8)
- [X] T047 [US3] Meter upload parsing as its own `surface_kind` in `ai_interactions` and enforce a per-student daily cap (10) — image tokens are materially more expensive and must not hide inside a blended per-student figure (Principle VI)
- [X] T048 [US3] Feed parsed upload content into `retrieval.ts` so explanations are grounded in the student's own material (FR-205)
- [X] T049 [US3] Apply the guide-don't-answer guardrail to uploaded material identical to typed questions — uploading must not be a way around it (FR-202, SC-009) *(prompt-level; enforced in the retrieval block. Verified present in the composed prompt — that the model obeys it needs a full lesson turn.)*
- [X] T050 [US3] Implement FR-206: use uploaded material for the academic task only; do not retain or comment on incidental personal detail *(prompt-level, enforced at transcription time so incidental detail is never written down.)*
- [X] T051 [P] [US3] Emit `question_asked` (with `mode` and `guardrail_triggered`) and `upload_submitted`

---

## Phase 8: User Story 4 — See where I stand (spec priority P4)

**Goal**: per-topic strengths and weaknesses, never one blended number.

**Independent Test**: drive uneven mastery across topics; the dashboard reflects the unevenness.

> Exam prep (D2) and mid-year placement (C2) are **deferred** — not ticked in decisions.md Q7 and
> dependent on real mastery data existing first.

- [X] T052 [US4] Create `app/src/app/api/dashboard/route.ts` returning per-module mastery, attempt counts and weakest LO, with no blended aggregate field (FR-401)
- [X] T053 [US4] Create `app/src/app/dashboard/page.tsx` rendering per-topic breakdown from BKT probabilities, reusing `lib/mastery.ts` colouring
- [X] T054 [P] [US4] Emit `dashboard_viewed`

---

## Phase 9: User Story 5 — Parent view (spec priority P5)

**Goal**: a read-only, non-punitive view of the same performance data, plus threshold alerts.

**Independent Test**: open the parent view for a student; see performance, no transcripts.

- [ ] T055 [US5] Create `app/src/app/api/parent/route.ts` — read-only, no POST, same payload as the dashboard plus alerts, never including lesson or chat transcripts (FR-501, FR-603)
- [ ] T056 [US5] Create `app/src/app/parent/page.tsx` behind the same student picker (decisions.md Q11), with a visible notice that this pilot view is not access-scoped per family
- [ ] T057 [US5] Implement threshold alerts (prolonged inactivity, sustained struggle on a topic) in supportive, non-punitive wording (FR-502)
- [ ] T058 [P] [US5] Emit `parent_view_opened`

---

## Phase 10: User Story 8 — Measurement on both sides (spec priority P8)

**Goal**: the headline metric computable per environment, never pooled.

**Independent Test**: complete one full journey; every event fires with its properties and the correct
environment tag.

- [ ] T059 [US8] Open a **narrow** PR to `main` adding only `analytics_events`, `lib/analytics.ts`, `lib/env.ts` and event emission to the baseline — no teaching change of any kind (FR-908)
- [ ] T060 [US8] Prove the baseline change is behaviour-neutral: `npx tsc --noEmit`, `npm test`, and `capture-prompts.mts` reporting **zero** prompt diffs. A non-zero diff means the instrumentation reached further than it should — fix the scope, never waive the check
- [ ] T061 [US8] Implement the SC-005 metric query: comprehension interactions (`explanation_delivered`, or `question_asked` with `mode='conceptual'`) followed by a `retrieval_attempt_submitted` **within the same session**, reported per environment
- [ ] T062 [US8] Verify no reporting path can pool the two environments, and that `explanation_delivered.reviewed` is available as a breakdown

**Checkpoint**: both environments emit comparable data. The experiment is measurable.

---

## Phase 11: Safety — **HARD GATE before any real student**

**⚠️ Real pilot students MUST NOT be invited until this phase is complete**, per plan.md P5 and
research.md R4. Until then the environment carries founders only.

- [ ] T063 Create `app/src/lib/safety.ts` — crisis and distress classification on the inbound ask path (FR-601)
- [ ] T064 Write `safety_flags` rows carrying flag type and timestamp only — no transcript, no excerpt (FR-802)
- [ ] T065 Implement the escalation dispatch adapter (email and webhook implementations) on a path **separate from the analytics queue**, dispatching immediately (FR-602)
- [ ] T066 Keep the student-facing tone supportive and never "reported on" while a flag is raised (PRD §8)
- [ ] T067 **BLOCKED ON SAMUEL** — name the human recipient and their response expectation, and record it in `deploy/DEPLOY-MVP1.md`. An unmonitored channel is worse than none: it produces a record that looks like a safeguard and is not one (research.md R4)
- [ ] T068 End-to-end verify a raised flag reaches the named human within the same session, and confirm none are sitting in the routine analytics queue (SC-010)

---

## Phase 12: Polish & Cross-Cutting

- [x] T069 Fix the stale product framing in `CLAUDE.md` — its header still describes the parent-sold, Arabic-RTL, low-end-Android product with a parent dashboard as a non-goal, which now contradicts constitution v2.0.0 and will mislead every future session and subagent
- [ ] T070 [P] Walk `quickstart.md` end to end on the real box and correct anything that does not match reality
- [ ] T071 [P] Update `docs/PROJECT_STATE.md` and `docs/README.md` with the two-environment topology and how to reach each
- [ ] T072 Run `/speckit-analyze` for cross-artifact consistency across spec, plan and tasks
- [ ] T073 Re-run `parity_check.py` as the final gate before students, and after every subsequent content refresh in either environment (Principle XI)

---

## Phase 13: Design system — the Nour visual language **[ADDED 2026-09-10]**

Executed out of band, after the design handoff landed (Drive folder
`1eAJeMHy5m3D-FhS8RAv2KMg5F6eO0QOM`). It is recorded here rather than left as untracked work
because it changed shipped behaviour that no requirement covered: the Phase 8 dashboard used a
burnt-sienna mastery ramp, and the design system forbids red outright. Traceability now runs
through **FR-1001…FR-1010** (spec.md §Design system) and
[traceability.md §8](./traceability.md).

- [X] T074 Add the Nour token layer to `app/src/app/globals.css` under `[data-ds="nour"]`, set from `IS_MVP1` in `app/src/app/layout.tsx` — redefine the EXISTING semantic tokens rather than adding a parallel set, so no component forks per environment and the frozen baseline renders unchanged (FR-1001)
- [X] T075 Replace the mastery ramp in `app/src/lib/mastery.ts` with the five discrete token steps and a `started` flag — a cold-start 0.30 prior and a practised 0.30 are the same number and must not look the same (FR-1002, FR-1004)
- [X] T076 Rename the mastery bands to the token names (`attempted`, not `weak`) and render a legend on `/dashboard`, so identity is never carried by colour alone (FR-1003, FR-1009)
- [X] T077 Load Baloo Bhaijaan 2 + Cairo + IBM Plex Mono via `next/font`, both Arabic subsets included, and force Arabic out of the mono stack in `globals.css` (FR-1007)
- [X] T078 Flip the check-in and Today's Plan headlines to English-first with Arabic at equal size and weight, spacing from flex rather than inline margins (FR-1006, FR-208)
- [X] T079 Add `/dashboard` to the shell navigation — it was built in Phase 8 with no way into it, which is the same as not having been built (FR-401)
- [X] T080 Publish the six-artboard design canvas and commit its source to `docs/design/nour/`, recording the master-vs-Play choice as Samuel's to confirm (constitution Principle I)

**Not done, and deliberately so**: `.anim-mastered` (FR-1010) is defined and unspent — the one
signature spring is reserved for a proficient → mastered transition, which needs live band movement
to fire. Spending it anywhere else is what makes it stop meaning anything.

---

## Phase 14: The generated question bank **[ADDED 2026-09-10 — ADR-0008]**

Authorised by Samuel on 2026-09-10 after the tier-coverage measurement: BKT reaches `advanced`
after two correct answers where Elo needed six, and 5 of 90 objectives have no advanced item
while 52 have exactly one. Traceability: **FR-1101…FR-1109**, constitution **v2.1.0**.

- [X] T081 Measure tier coverage across the live bank and record the gap that justifies the decision (5 objectives with no advanced item, 52 with exactly one, 140/192/118 by tier)
- [X] T082 Amend constitution Principle III to cover generated questions, with the 10% sample and the parent-question link as attached conditions; write `docs/decisions/0008-generated-question-bank.md`
- [X] T083 Redefine the content constant in `services/extraction/parity_check.py` — fingerprint the **book** (`source IN ('seed','authored')`), count generated items separately, and fail hard when any generated row appears in the baseline (FR-1102, FR-1103)
- [X] T084 Create `services/extraction/load_generated_questions.py` — structural validation, forced `source='variant'` + `reviewed_by=NULL`, an `AINEXT_ENVIRONMENT != mvp1` refusal, `review`-by-default with explicit `--promote`, and a seeded sample written to a review queue (FR-1101, FR-1104, FR-1105, FR-1106)
- [X] T085 Author and load the first sample bundle — 12 items across the seven thinnest objectives, distractors carrying `misconception_id` (FR-1107); verified live: objectives with no advanced item **5 → 0**, parity still GREEN with the book constant at 450
- [ ] T087 Generate the full coverage pass — every objective carries at least one live item per tier (FR-1109); currently 4 objectives still have no basic item
- [ ] T088 Build the generation workflow properly in `services/extraction/runbook/` alongside the refutation conveyor, so bundles are reproducible rather than hand-authored
- [ ] T089 Fold the generated-question loader into `load_seed.py` bundle dispatch, or document deliberately why it stays a separate entry point
- [ ] T090 Emit an event when `pickQuestion` cannot honour the target tier, so "how often did we serve below the student's level?" is answerable from data instead of inferred
- [X] T091 Surface the live-unreviewed count on an operator surface, not only in the parity output (FR-1108) — `/admin/content`, reachable from the shell nav
- [X] T092 Create `app/src/lib/provenance.ts` as the single derivation of the three provenance states, plus `ProvenanceBadge`; carry `parent_question_id` through to the spine (FR-1110)
- [X] T093 Fix the `/spine` provenance passport, which stamped **"Reviewed ✓" unconditionally** — true while every question came from the reviewed extraction, a lie the moment generated items landed beside them, on the one screen built to make provenance believable
- [X] T094 **DECIDED (Samuel, 2026-09-12): keep it hidden from students for the pilot.** Telling her a question is machine-written would change how she answers it, and that change lands inside the metric being measured. Provenance stays fully visible on operator surfaces. Revisit before any audience wider than the invited cohort — promoting the environment already requires reinstating the review gate (constitution III), and disclosure should be settled in the same act
- [X] T095 Remove the EGP 40 ceiling from the product surface (Samuel, 2026-09-12: *"I don't want a ceiling to be applied yet"*) — the meter now shows spend with "no ceiling set · pricing pending"; constitution v2.0.0 Principle VI had already detached the figure with the parent price band it came from
- [X] T096 Build `services/extraction/generate_questions.py` — template families whose answer keys are COMPUTED from the sampled parameters, so a 10% sample validates a family rather than a single item (FR-1109)
- [X] T097 Generate and load bundle v2: 531 items across 35 families and 33 objectives; live bank **450 → 993**, objectives with no advanced item **5 → 0**, with no standard item **0**, parity still GREEN on the book constant
- [ ] T098 Extend the generator to the remaining **54 book-only objectives** — mostly circle-geometry theorems and data-collection concepts, which are proof- and definition-shaped rather than parameterisable, so they need a different template form than "sample numbers, compute the answer"
- [ ] T099 Close the last four objectives with no basic item — all "applications" objectives (word problems), the hardest to template without producing nonsense
- [ ] T100 Re-run the exhaustion measurement after a week of real sessions and let it set the next generation target, rather than a round number (ADR-0008 §Open)

### Misconceptions — making a wrong answer mean something (FR-1111…FR-1115)

- [X] T101 Author `services/extraction/build_misconceptions.py` — the catalogue, written against each objective's own definition and the book's own distractors (FR-1111, FR-1114)
- [X] T102 Create `services/extraction/load_misconceptions.py` — upserts misconceptions, writes a refutation per entry, stamps book distractors by exact choice text, and folds generator-invented ids in as aliases (FR-1112, FR-1115)
- [X] T103 Diagnose from the chosen distractor in `api/attempts/route.ts`: record `misconception_id` and `confidence=1` on the attempt, and serve the refutation of **that** error (FR-1113)
- [X] T086 **Samuel reviewed the 10% sample (2026-09-12): 52 of 53 items, every one accepted.** Verdicts recorded in `samples/question-bank-v2.verdicts.json` and applied — 52 read directly, 413 siblings validated through their families
- [X] T108 Create `services/extraction/apply_review_verdicts.py` — accept stamps the item and its family with DISTINCT reviewer strings, reject retires the whole family, "needs a fix" pulls only the named item
- [X] T109 Add the **family-validated** provenance state. Collapsing it into "checked by a human" would have put that claim on 413 items nobody opened
- [X] T110 Fix the sampler: draw **one item per family** before spreading the remainder. The first round drew 53 items uniformly and reached only 30 of 35 families, leaving 66 items with no path to review — under a family model a uniform draw is the wrong instrument
- [ ] T111 Second review round: 5 items, one from each family the first draw missed (`question-bank-v2.review-queue-topup.json`, published to the review artifact)
- [ ] T112 Ratify or replace the retire-the-family rule in ADR-0008 — it is implemented as the proposal and has never fired, because nothing was rejected
- [ ] T104 Extend the catalogue to the remaining 53 objectives — 37 of 90 are covered, and 201 of 250 book MCQs are still undiagnosable
- [ ] T105 Have the generator emit catalogue ids directly instead of inventing its own and relying on the alias pass
- [ ] T106 Include the objective's own definition on each review card, so a reviewer judges an item against the syllabus rather than against mathematics in general (the standard-deviation review, 2026-09-12)
- [ ] T107 Decide who performs the 10% review. An AI first pass is useful; the constitution's suspension is conditioned on a **human** gate, and a model reviewing model-generated maths reproduces the failure mode it is meant to catch

**Standing caveat**: question supply is now a variable in the comparison — the baseline
exhausts its advanced tier and the comparison build does not. Every reported result must say
so. See ADR-0008 §Consequences.



---

## Dependencies

```
Phase 1 Setup
   └─> Phase 2 Foundational (migration, env identity, analytics lib, parity check)
          └─> Phase 3 US7 Environment ......... enables everything measurable
                 ├─> Phase 4 US1 Identity ..... independent
                 ├─> Phase 5 US2 Teaching core  ← the hypothesis
                 │      └─> Phase 6 Content .... makes US2's misconception path real
                 │             ├─> Phase 7 US3 Ask + uploads
                 │             ├─> Phase 8 US4 Dashboard (needs BKT data)
                 │             └─> Phase 9 US5 Parent (needs dashboard payload)
                 └─> Phase 10 US8 Measurement .. needs flows to instrument
                        └─> Phase 11 Safety ⛔ HARD GATE → real students
                               └─> Phase 12 Polish

Phase 13 Design system ....... independent of the gate; applied to Phases 4-8 surfaces
Phase 14 Question bank ....... needs BKT (Phase 5) to have exposed the coverage gap
```

**US6 (trial, payment, plans) has no tasks** — deferred by decisions.md Q7.

## Parallel opportunities

- **Phase 1**: T003 and T004 in parallel after T002.
- **Phase 2**: T008, T009, T010, T011 are four different files with no interdependency.
- **Phase 4/5/7/8/9**: every analytics-emission task (T027, T038, T051, T054, T058) is parallel to its
  phase's implementation work.
- **Phases 7, 8, 9** can proceed in parallel once Phase 6 lands — uploads, dashboard and parent view
  touch disjoint files.
- **Phase 10's T059/T060** run on `main` and are parallel to all `mvp1` work.

## Implementation strategy

**Minimum viable comparison** = Phases 1–6 (T001–T043). At that point two URLs serve the same book,
one of them with BKT, a retrieval layer and misconception-specific teaching, and the difference is
observable. Phases 7–9 complete the PRD experience; Phase 10 makes it measurable; Phase 11 is what
makes it *permissible* with real students.

**Suggested first milestone**: Phases 1–3 (T001–T020). It is self-contained, it de-risks the two
riskiest infrastructure unknowns (box capacity, dashboard-managed ingress), and it ends with a green
parity check — the proof that the whole comparison premise holds.

## Task count

| Phase | Tasks | Story |
|---|---|---|
| 1 Setup | 5 | — |
| 2 Foundational | 7 | — |
| 3 Environment | 8 | US7 |
| 4 Identity | 7 | US1 |
| 5 Teaching core | 11 | US2 |
| 6 Content | 5 | — |
| 7 Ask + uploads | 8 | US3 |
| 8 Dashboard | 3 | US4 |
| 9 Parent | 4 | US5 |
| 10 Measurement | 4 | US8 |
| 11 Safety gate | 6 | — |
| 12 Polish | 5 | — |
| **Total** | **73** | |

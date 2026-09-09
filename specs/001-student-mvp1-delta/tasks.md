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

- [ ] T039 Create `services/extraction/runbook/refutation.workflow.js` reusing the ADR-0005 conveyor — per LO: enumerate likely misconceptions, author worked example / faded / contrasting case / refutation, verify each against the existing canonical solution, assemble
- [ ] T040 Create `services/extraction/assemble_refutations.py` producing a validated bundle of `misconceptions` + `explanation_library` rows with page provenance carried through (Principle II)
- [ ] T041 Extend `services/extraction/load_seed.py` to load the new bundle type, forcing `reviewed=false` and a generator attribution string on every row — the loader must make it impossible to insert generated content that claims to be reviewed
- [ ] T042 Generate and load the library for the pilot's units on the `mvp1` environment only; confirm the baseline database is untouched
- [ ] T043 Verify `SELECT count(*) FROM explanation_library WHERE NOT reviewed` returns the expected count and is reportable on demand — this number is what makes the Principle III suspension honest and reversible (SC-011)

**Checkpoint**: the tutor teaches misconception-specific content, and we can state exactly how much of it is unreviewed.

---

## Phase 7: User Story 3 — Ask anything, upload my own material (spec priority P3)

**Goal**: a student uploads a worksheet or asks a question and is taught through it, never handed the
answer.

**Independent Test**: upload a photographed worksheet, ask for the answer, get guided teaching.

- [ ] T044 [US3] Create `app/src/app/api/uploads/route.ts` — multipart intake (JPEG/PNG/PDF, ≤10 MB), storage on the uploads volume, `202` with `uploadId`
- [ ] T045 [US3] Create `app/src/lib/uploads.ts` parsing uploads through the on-box Claude CLI runtime (research.md R2), writing `parse_status` and `parsed_text`
- [ ] T046 [US3] Distinguish `unreadable` from `failed` end to end, with different user-facing copy — unreadable asks the student to retype or reshoot, failed offers a retry; never silently guess at an unreadable upload (FR-205, PRD §8)
- [ ] T047 [US3] Meter upload parsing as its own `surface_kind` in `ai_interactions` and enforce a per-student daily cap (10) — image tokens are materially more expensive and must not hide inside a blended per-student figure (Principle VI)
- [ ] T048 [US3] Feed parsed upload content into `retrieval.ts` so explanations are grounded in the student's own material (FR-205)
- [ ] T049 [US3] Apply the guide-don't-answer guardrail to uploaded material identical to typed questions — uploading must not be a way around it (FR-202, SC-009)
- [ ] T050 [US3] Implement FR-206: use uploaded material for the academic task only; do not retain or comment on incidental personal detail
- [ ] T051 [P] [US3] Emit `question_asked` (with `mode` and `guardrail_triggered`) and `upload_submitted`

---

## Phase 8: User Story 4 — See where I stand (spec priority P4)

**Goal**: per-topic strengths and weaknesses, never one blended number.

**Independent Test**: drive uneven mastery across topics; the dashboard reflects the unevenness.

> Exam prep (D2) and mid-year placement (C2) are **deferred** — not ticked in decisions.md Q7 and
> dependent on real mastery data existing first.

- [ ] T052 [US4] Create `app/src/app/api/dashboard/route.ts` returning per-module mastery, attempt counts and weakest LO, with no blended aggregate field (FR-401)
- [ ] T053 [US4] Create `app/src/app/dashboard/page.tsx` rendering per-topic breakdown from BKT probabilities, reusing `lib/mastery.ts` colouring
- [ ] T054 [P] [US4] Emit `dashboard_viewed`

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

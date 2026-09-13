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

> **Re-cut 2026-09-13 by [ADR-0010](../../docs/decisions/0010-one-branch-per-solution.md).**
> The original phase created `mvp1` as a second *environment* of one product. Each
> solution is now its own long-lived branch. `T001` is superseded; `T002`–`T004`
> were built against the withdrawn naming and need re-pointing.

**Purpose**: name the solution branches, and re-point the deploy scaffolding that still
says `mvp1`.

- [X] T001 ~~Create long-lived branch `mvp1`~~ — **superseded by ADR-0010 and done differently.** `claude/tamer-shared-drive-access-ddpypu` was renamed to `PDR1-0` and pushed; `family-tutor` was created from `origin/main` and pushed; the old remote ref was deleted (2026-09-13, both at `544fe6e`). `main` is untouched and still default.
- [X] T002 Create `deploy/docker-compose.mvp1.yml` — compose project `ainext-mvp1`, app on `127.0.0.1:3101`, own `ainext-mvp1_pg` and `ainext-mvp1_claude_cfg` volumes, loader kept behind `profiles: ["tools"]`
- [X] T003 [P] Write `deploy/DEPLOY-MVP1.md` — bootstrap, the dashboard-managed Cloudflare hostname steps, and the shared-box rails (never `down -v`, never `system prune`)
- [X] T004 [P] Extend `.github/workflows/ci-cd.yml` with a branch→environment matrix, keeping the single `concurrency: deploy-oci` group
- [ ] T005 ~~Measure box headroom before any second stack lands~~ — **no longer blocking.** Two simultaneous stacks are not required by ADR-0010. Keep as a pre-deploy check for whichever solution deploys next, not as a gate on development.
- [X] T136 Give each solution branch **its own deploy trigger** (ADR-0010 Clarification) — **done 2026-09-13.** `ci-cd.yml` on this branch now deploys `PDR1-0` and nothing else: the branch→environment matrix and all four ternaries are gone, `if:` is `refs/heads/PDR1-0`, and no `main` trigger exists here. `deploy/DEPLOY-MVP1.md` and `deploy/CICD.md` re-cut. **Deliberately NOT renamed:** the directory, compose project, volume, database and `AINEXT_ENVIRONMENT` all keep `mvp1` — they name the *environment and its stack*, not the branch, and `mvp1` is already stamped on every analytics/ledger/cost row in that database (the loader refuses any other value). **Two live consequences, see T139 and T140.**
- [X] T139 ~~A push to `PDR1-0` now attempts a deploy and will fail until the box is bootstrapped~~ — **resolved 2026-09-13 by locking deploy to manual dispatch.** Samuel: *"deployment on infra might come after we finalise and test locally."* The deploy job now requires `github.event_name == 'workflow_dispatch'`, so **a push never deploys** and nothing in this repository can reach the OCI box. The per-branch structure from T136 is intact. **To re-arm when the box is ready:** change `== 'workflow_dispatch'` back to `!= 'pull_request'` in `.github/workflows/ci-cd.yml` — that one edit is the whole difference. `build` still runs on every push and PR.
- [ ] T140 The **baseline branch's own copy** of `ci-cd.yml` still carries the old matrix (`if: main || mvp1`, plus the four ternaries). It is harmless today because the `mvp1` branch no longer exists, so it only ever fires for `main` — but it must get the same per-branch treatment when the baseline moves to `family-tutor`. **Cannot be done from here: it requires touching `main`, which Samuel has ruled out.**
- [X] T137 ~~Decide whether `main` is retired in favour of `family-tutor`~~ — **ANSWERED 2026-09-13: no, not now.** Samuel: *"don't touch the main now."* `main` stays as it is, untouched and still the default. Reopen only if he asks.

**Checkpoint**: both solutions are named branches; nothing in the deploy tree references a branch that does not exist.

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

## Phase 3: Deploy each solution independently

> **Re-cut 2026-09-13 by [ADR-0010](../../docs/decisions/0010-one-branch-per-solution.md).**
> Was "User Story 7 — Two environments, one book": two stacks co-tenant on one box,
> parity asserted between two live databases, and a simultaneous side-by-side demo.
> That delivery model is withdrawn. **The side-by-side demo is given up** — if it is
> still wanted it is new work, not a leftover of this phase. Parity is now asserted
> per branch against the held-constant book, which `T073` already does and which
> needs no second stack.

> **⏸️ DEFERRED by Samuel, 2026-09-13:** *"deployment on infra might come after we finalise and
> test locally."* This whole phase is parked until local work is finished and tested. Deploy is
> locked to manual dispatch (`T139`) so nothing reaches the box in the meantime. `docs/LOCAL-DEV.md`
> is the supported way to run and verify the product until this phase is un-parked.

**Goal**: each solution deploys on its own schedule, Access-gated, with the content
constant intact on each.

**Independent Test**: deploy one solution from its own branch; `parity_check.py` exits 0
against that deployment; the other solution is provably untouched.

- [ ] T013 Deploy the `PDR1-0` solution from its own branch, with its own `deploy/.env` and a **different** `POSTGRES_PASSWORD` than any other stack
- [ ] T014 Bring the stack up and confirm health on its own port
- [ ] T015 Complete the one-time Claude CLI OAuth login inside that stack's `app` container — a new `claude_cfg` volume does not inherit another stack's login
- [ ] T016 Add the public hostname in the **Cloudflare Zero Trust dashboard** (not a local `config.yml`) and attach it to the existing Access application so pilot families are granted and revoked in one place (FR-907)
- [ ] T017 Load the math bundles into that deployment's database (`--all --course course:prep3-math-en`)
- [ ] T018 Run `parity_check.py` against the deployment and confirm GREEN — 10 modules / 90 LOs / 112 prerequisite edges / 450 questions / 212 visuals, source `38ee465de1dc3692`. **Read as a per-solution drift guard, not a cross-solution parity gate** (ADR-0010 Clarification): this asserts `PDR1-0` serves the set it is supposed to serve, and says nothing about any other solution.
- [ ] T019 Verify no other solution's stack was restarted, redeployed or mutated during the procedure — FR-903, now read as "deploying one solution never touches another"
- [ ] T020 Confirm the hostname returns a 302 to Cloudflare Access and is never publicly reachable
- [X] T138 ~~Re-specify the simultaneous side-by-side demo~~ — **ANSWERED 2026-09-13: dropped.** Samuel: *"the comparison will be on the live usage… I will not rely on the system to compare."* No system-enforced comparison surface is required.

**Checkpoint**: a solution can be deployed from its own branch without reference to any other, and its content constant is proven on the deployment.

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
- [X] T043 Verify `SELECT count(*) FROM explanation_library WHERE NOT reviewed` returns the expected count and is reportable on demand — this number is what makes the Principle III suspension honest and reversible (SC-011) *(verified locally 2026-09-13: 94 of 94 unreviewed, reportable on demand. The box is no longer the gate — see ADR-0010.)* the query is ready and the loader forces `reviewed=false`; the count can only be taken against a loaded database.

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

## Phase 10: User Story 8 — Measurement on each solution (spec priority P8)

> **Re-cut twice on 2026-09-13** — [ADR-0010](../../docs/decisions/0010-one-branch-per-solution.md)
> and its Clarification. Was "Measurement on both sides". Measurement is now **per solution only**:
> `T059`/`T060` are dropped because they required a PR to `main`, and FR-908 is dropped with them.
> What survives is `T061` (the SC-005 metric on this solution) and `T062` (no pooling). The
> comparison itself is observational, made from live usage — not a system property.

**Goal**: the headline metric computable per environment, never pooled.

**Independent Test**: complete one full journey; every event fires with its properties and the correct
environment tag.

- [X] T059 [US8] ~~Open a narrow PR to `main` adding analytics to the baseline (FR-908)~~ — **DROPPED 2026-09-13 (ADR-0010 Clarification).** Samuel: *"don't touch the main now."* FR-908 is dropped with it; the comparison is observational and does not need the baseline instrumented.
- [X] T060 [US8] ~~Prove the baseline change is behaviour-neutral~~ — **DROPPED with `T059`.** There is no baseline change to prove neutral.
- [ ] T061 [US8] Implement the SC-005 metric query: comprehension interactions (`explanation_delivered`, or `question_asked` with `mode='conceptual'`) followed by a `retrieval_attempt_submitted` **within the same session**, reported per environment
- [ ] T062 [US8] Verify no reporting path can pool environments **or solutions**, and that `explanation_delivered.reviewed` is available as a breakdown

**Checkpoint**: each solution emits comparable data. The experiment is measurable without both running at once.

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
- [ ] T070 [P] Walk `quickstart.md` end to end on the real box and correct anything that does not match reality — it now carries an ADR-0010 banner but has **not** been walked
- [X] T071 [P] Update `docs/PROJECT_STATE.md` and `docs/README.md` with the topology and how to reach each *(done 2026-09-13 for ADR-0010: `PROJECT_STATE.md` and `CLAUDE.md` now describe one branch per solution. **`docs/README.md` still pending** — reopen if that matters separately.)*
- [ ] T072 Run `/speckit-analyze` for cross-artifact consistency across spec, plan and tasks
- [X] T073 Re-run `parity_check.py` as the final gate before students, and after every subsequent content refresh (Principle XI) *(run 2026-09-13: PARITY GREEN, source sha256 `38ee465de1dc3692`, LO digest `ed4182bd68af8e68`. The "in either environment" clause is re-cut by ADR-0010 — parity is now asserted per solution branch against the expected constants.)*

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
- [ ] T111 Second review round: 5 items, one from each family the first draw missed (`question-bank-v2.review-queue-topup.json`, published to the review artifact) — **queue generated, 0 of 5 reviewed as of 2026-09-13**; awaiting Samuel's verdicts
- [ ] T112 Ratify or replace the retire-the-family rule in ADR-0008 — it is implemented as the proposal and has never fired, because nothing was rejected
- [ ] T104 Extend the catalogue to the remaining objectives — **42 of 90 covered as of 2026-09-13** (the "37 of 90" here was stale), and the bulk of book MCQs are still undiagnosable
- [ ] T105 Have the generator emit catalogue ids directly instead of inventing its own and relying on the alias pass
- [ ] T106 Include the objective's own definition on each review card, so a reviewer judges an item against the syllabus rather than against mathematics in general (the standard-deviation review, 2026-09-12)
- [X] T107 Decide who performs the 10% review. An AI first pass is useful; the constitution's suspension is conditioned on a **human** gate, and a model reviewing model-generated maths reproduces the failure mode it is meant to catch *(decided in ADR-0008: Samuel reviews the sample himself — "I will review 10% of the questions". 52 verdicts recorded 2026-09-12 under `question-bank-v2.verdicts.json`.)*

**Standing caveat**: question supply is now a variable in the comparison — the baseline
exhausts its advanced tier and the comparison build does not. Every reported result must say
so. See ADR-0008 §Consequences.

## Phase 15: Interactive practice widgets **[ADDED 2026-09-12 — Samuel's request]**

*"Can we generate more widgets as well with more option to draw and better capability?"*

The starting position, measured rather than assumed: **two** interactive widgets, both
tap-only, serving **2 of 10** modules. Geometry — 72 of the book's 212 figures, the largest
category by a distance — had none. The only student gesture anywhere in the product was a
single click.

- [X] T113 Build the shared interaction primitive (`widgets/drag.ts`): pointer capture,
  `getScreenCTM().inverse()` mapping, `touch-action: none`, caller-supplied snapping, freehand
  stroke capture with distance thinning, arrow-key nudging. Solving drawing once rather than
  nine times badly is the whole "better capability" ask
- [X] T114 Extract `WidgetShell` + `Handle` — the chrome the two existing widgets had each
  copied and already drifted apart on. Enforces the no-red rule and keeps a verdict from ever
  being colour alone; the handle is a focus stop announcing its own value, behind a
  finger-sized hit target
- [X] T115 Nine widgets, one per uncovered module: `line_drawer`, `circle_builder`,
  `angle_setter`, `triangle_ratio`, `bar_builder`, `number_line_marker`, `ratio_balance`,
  `sample_space`, `curve_sketcher`. All ten modules now covered (FR-1201)
- [X] T116 Validated dispatch (`lib/widget-payloads.ts` + `render-math-widget.tsx`). Rejects
  rather than repairs, and rejects the well-typed-but-unreachable; no React, so the guard is
  tested directly (FR-1207, FR-1208)
- [X] T117 Document widgets to the tutor **per unit** rather than per subject
  (`lib/widget-docs.ts`). Eleven schemas in every prompt is a cost and a menu (FR-1209)
- [X] T118 `/dev/math-widgets` — every widget with the payload that produced it, plus the
  five payloads that must refuse to render. The review surface the human gate needs, since
  "drag it and see whether the mathematics holds" is not a code review
- [X] T119 ~~**Spend a tutor turn.** No Claude turn has ever chosen a widget~~ — **it has now, and it is recorded.** During the 2026-09-13 session a lesson turn composed **inline `pair_plotter` widgets twice** on `lo:u1-1-1` ("Plot the ordered pair (3, -1)") — a defensible choice for an ordered-pairs objective. Both were answered (`modality='widget'`, both wrong) and both materialised into reviewable rows per ADR-0009: `qw:inline:pair_plotter-81270` and `-95360`, held at `status='review'`. **The ADR-0009 guard was also proven live**: `UPDATE ... SET status='live'` on a materialised row is refused by CHECK `questions_materialised_not_live`, by constraint rather than convention. What remains unmeasured is *how often* and *which* widget a model reaches for across many turns — reopen as a measurement task if that matters.
- [ ] T120 Run the widgets on a **real iPad**. Touch and keyboard are both verified only under
  synthetic pointer events in desktop Chromium — which is exactly the setting that hid the two
  pointer bugs until the widgets were actually driven
- [X] T121 Decide whether widget outcomes should move mastery (FR-1211) *(decided in ADR-0009 §1: every widget attempt counts and updates BKT, tagged by `attempts.modality` so any metric can be recomputed without them. ADR-0009 formally amends FR-1211.)*. They deliberately do
  not, to keep the comparison clean — but a student can construct every chord in the unit and
  the mastery number will not notice. **Samuel's call**

**What the browser found that the code review did not.** Both pointer bugs below were invisible
to typechecking, linting and reading, and both would have hurt students more than they hurt the
test:

1. `pointermove` gated on React state dropped every move dispatched before the re-render
   committed. A mouse drag mostly survives it; a finger does not, because the first events
   after a touchstart arrive about a millisecond apart. On the iPad this targets, the start of
   every drag would have gone missing.
2. `pointerdown` never called `preventDefault`, so the browser began a native selection gesture
   and fired `pointercancel` **mid-drag** — a handle stopping a third of the way to where it
   was pulled, with no error raised anywhere.

The lesson is cheap to state and was expensive to learn: an interaction primitive is not
verified until something drags it.

## Phase 16: Widgets as questions **[ADDED 2026-09-13 — ADR-0009]**

Samuel asked whether the widgets bind to the generated questions, the misconceptions and the
lessons. They did not, on all three. `attempts.question_id` is NOT NULL and references
`questions`, so a widget outcome could never be recorded, diagnosed, counted or made to move
mastery unless the widget IS a row there. Asked for the best rather than the cheapest fix, the
answer was to unify the two supply chains.

- [X] T124 ADR-0009 — a widget is a question. Samuel's two decisions: all widget attempts move
  BKT tagged by modality; stored preferred with inline still allowed
- [X] T125 `contracts/widget-predicates.json` — 51 predicates over 11 kinds, one authority read
  by the TS module, `widget_spec.py` and the loader. A predicate misspelled in any one layer
  resolves to no misconception and the student gets silence, with nothing raised anywhere
- [X] T126 Migration 010 — `question_type='widget'`, `attempts.modality`,
  `questions.materialised_from` with a CHECK that a materialised row can never be born live
- [X] T127 16 new misconceptions for errors only a CONSTRUCTION reveals. You cannot write a
  multiple-choice item that catches "thinks a diameter is any long chord"; you can see it
  instantly from where the two ends go
- [X] T128 `generate_widget_questions.py` — 48 questions, 13 objectives, 20 families, 75
  predicate→misconception mappings, through the same validate → load → sample pipeline as the
  543 generated MCQ/numeric items
- [X] T129 The prerequisite rule, checked against the curriculum graph rather than asserted: a
  diagnostic may name a misconception on this objective or any transitive prerequisite of it
- [X] T130 All 11 widgets report a structured outcome; `api/attempts` grades server-side,
  diagnoses from the stored predicate map, and tags the row
- [X] T131 Stored widget questions render in the ordinary question card via the ordinary
  `{{show_question:…}}` directive — no parallel push path
- [X] T132 The refutation is returned and rendered. It was being looked up, logged and then
  discarded in favour of the generic solution
- [X] T133 Inline materialisation — answering a composed widget writes it as `status='review'`
- [ ] T122 **Render widget questions in the review page.** 20 are queued covering all 20
  families and `render_review_page.py` handles multiple-choice and numeric only. Until it can
  show a construction, every widget question a student sees is unreviewed
- [ ] T123 Extend widget generation beyond the 13 objectives it reaches today
- [ ] T134 Map the remaining predicates to misconceptions, or record deliberately that they have
  none. `off-target` correctly resolves to nothing; several named ones have no entry yet
- [ ] T135 Report every comparison metric sliced by `modality`. It is the second declared
  variable after question supply, and a pooled number now hides which instrument produced it

**What the graph caught that review would not.** The prerequisite check rejected two content
errors while generating: a chord misconception authored on the diameter-theorem objective instead
of the definitions one, and a linear-functions sketch reaching for a coordinate-geometry
misconception taught three units later. Both would have produced a widget that diagnoses
confidently and then explains something the student was never taught.



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
- **Phase 10's T059/T060** run on the baseline branch (`family-tutor`, or `main` until it is retired) and are parallel to all `PDR1-0` work.

## Implementation strategy

> **Re-cut 2026-09-13 by [ADR-0010](../../docs/decisions/0010-one-branch-per-solution.md).** The
> strategy below was written around a simultaneous two-URL comparison. That delivery model is
> withdrawn: each solution is its own long-lived branch and deploys on its own schedule.

**Minimum viable product** = Phases 1–6. At that point one solution serves the held-constant book
with BKT, a retrieval layer and misconception-specific teaching, and `parity_check.py` proves the
content constant held. Phases 7–9 complete the PRD experience; Phase 10 makes it measurable;
Phase 11 is what makes it *permissible* with real students.

**Suggested first milestone**: close the Phase 7 repairs and Phase 11. Phase 7 is marked complete but
its feature is unreachable — no UI was ever scoped, `T046`'s unreadable check is broken and `T048`'s
grounding link is dead. Phase 11 is a declared hard gate and is 0/6. Deployment (Phase 3) no longer
blocks product work and can run whenever a solution is ready to ship.

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
| 13 Design (Nour) | 12 | — |
| 14 Generated bank | 12 | — |
| 15 Widgets | 9 | — |
| 16 Widgets as questions | 14 | — |
| **Total** | **135** | |

## Phase 17: Closing the partial requirements **[ADDED 2026-09-13 — Samuel's request]**

**Goal**: no requirement sits at PARTIAL because half of it was never built.

- [X] T141 **FR-207 — the engagement half.** `app/src/lib/engagement.ts`: a pure classifier over the last 12 attempts (correctness, `time_ms`, `attempted_at`) producing a *stance* for the tutor, wired into `retrieval.ts` beside grade. Precedence `returning → rushing → struggling → labouring → steady`; fails quiet below 4 observations and on any query error so the prompt stays byte-identical when there is nothing to say. Per PRD §8 it is never shown to the student and the block says so. 21 tests; 123 pass; verified against the live database.
- [X] T142 **FR-1109 — the 4 objectives with no live basic item** — **done 2026-09-13.** `lo:t2u1-1-4` (sum-and-difference), `lo:t2u1-3-1` (substitute the linear into the quadratic), `lo:t2u1-3-2` (sum-and-product), `lo:u4-2-4` (drop the perpendicular in an equilateral triangle). Authored, not templated, per `T099`. Loaded live+unreviewed with **all four** written to the review queue rather than a 10% sample. Every one of the 90 objectives now carries a live item at all three tiers; parity GREEN, book constant 450/450 untouched.
- [ ] T143 **FR-1111 — extend the misconception catalogue.** **Measured and started 2026-09-13: 43 of 90 objectives, 102 entries.** `lo:t2u3-1-2` (intersection / mutually exclusive) authored as a rate check — **6 entries from one objective's own distractors**, all mapped to exact book choices, refutations live in `explanation_library`. **Remaining: 47 objectives, ~110 entries.** All 47 have book MCQs to mine (135 total), so the method is proven and repeatable; the cost is authoring time at the constitution's grounding bar, not discovery. Suggested unit of work: one objective at a time, since each needs its own distractors read. **Do not batch-generate these** — `build_misconceptions.py` deliberately calls no LLM.

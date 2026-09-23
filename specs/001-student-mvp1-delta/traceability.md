# Traceability — Student MVP 1.0 comparison build

**Status date**: 2026-09-22 (rev. 12) · **Branch**: `feat/002-identity-and-admin-console`
*(rev. 11 was 2026-09-20 on `PDR1-0`, at `PDR1-0-v0.4.0`)*
**Authority**: [spec.md](./spec.md) · [tasks.md](./tasks.md) · [decisions.md](./decisions.md) ·
constitution [v3.1.1](../../.specify/memory/constitution.md) · [ADR-0007](../../docs/decisions/0007-student-mvp1-comparison-build.md) ·
[ADR-0010](../../docs/decisions/0010-one-branch-per-solution.md) · [ADR-0011](../../docs/decisions/0011-noor-play-design-system.md)

> **rev. 9 demoted four rows that said VERIFIED and were not.** Prototype 1.1 was the first
> time anyone drove this build as a student rather than as its author, and four requirements
> marked VERIFIED failed in front of him. The rows below now carry what he saw alongside the
> fix, because a matrix that only records successes cannot be used to judge the next claim.
> This is the counting rule working as written: *treat VERIFIED as a claim that someone ran
> it, and be willing to demote.*
>
> **rev. 10 was the fix pass, and it admitted that two pieces of shipped work had no
> requirement at all.** **rev. 11 closes that** — Samuel approved writing them, so access
> gating is now **FR-605**/**FR-606** and the teaching protocol is **FR-209**…**FR-213**,
> seven rows below.
>
> Two things about how they were written are worth keeping. They are stated as obligations
> on the *product*, never as the wording of a prompt — a prompt is an implementation and
> will be rewritten many times. And the **unmet** half of access control became its own
> requirement (**FR-606**, BLOCKED) rather than a caveat inside the met one, because a gap
> is easy to lose inside a satisfied requirement and hard to lose beside one.
>
> Five of the seven are **BUILT, not VERIFIED**, and that is not a formality: FR-209…213 are
> model behaviour, and nothing in this build can judge model behaviour. See §9 item 8 —
> that gap now blocks five requirements, not an abstraction.
>
> ---
>
> **rev. 12 (2026-09-22) settles a contradiction this document had been carrying, and demotes a
> second row on the way.** `FR-205` said VERIFIED — "accept uploads from anywhere in the lesson" —
> and eleven rows later `SC-009` said, of the same feature, *"uploads are unreachable and the
> grounding link is dead"*. Both cannot have been true. **The second one was right**, and the row
> below now carries that history rather than a silent flip: see FR-205 for when it was verified in
> error, what the error was, and what closed it.
>
> **`FR-905` moves VERIFIED → BLOCKED.** It forbids serving Arabic and Social Studies in this
> environment, and on 2026-09-21 Samuel had all three courses loaded and set live for grade 9. The
> requirement is unmet by his own instruction; it is not rewritten to match, and the call is his.
>
> **`FR-1011` moves OPEN → PARTIAL**, not to VERIFIED. The variant mechanism is finished and was
> driven live; the Master variant it can select is a colour name over the baseline tokens, and
> ADR-0017 forbids onboarding a Secondary cohort until its anatomy is published. A mechanism that
> works and a destination that is half specified is PARTIAL by this document's own counting rule.
>
> One thing about rev. 12's evidence is worth knowing before reading it. The work it records
> (`c58cb02`, `c510cf7`, `62f780c`, `85fe3b8`) was proved by a **hand-run browser and psql session
> on 2026-09-21–22 for which no smoke script exists**, unlike P0–P6 in the 002 matrix. That
> evidence is real and it is **not re-runnable by anybody else**, which is a weaker guarantee than
> `scripts/console-p5-smoke.sh` and is said here once rather than in every cell.

This document answers one question per row: **for this requirement, what code exists, and what
actually proves it works?** It is the bridge between the spec's functional requirements and the
task breakdown, and it is deliberately harsher than either — a requirement whose code exists but
has never been executed is not "done" here.

## Status vocabulary

| Status | Means |
|---|---|
| **VERIFIED** | Code exists **and** was executed in this environment — against a loaded database, a passing test, or a rendered page. |
| **BUILT** | Code exists and typechecks, but the thing that would prove it needs the box, the Claude runtime, or a browser session nobody has run. |
| **PARTIAL** | Some of the requirement is real; the rest is named in the Gap column. |
| **OPEN** | Not started. |
| **BLOCKED** | Cannot proceed here — the blocker is named. |
| **DEFERRED** | Out of scope by an explicit decision, with the decision cited. |

**Counting rule**: a requirement is counted once, at its weakest part. FR-207 is PARTIAL, not
"BUILT with a note", because half of it does not exist.

---

## 1. Carried over unchanged — the constant

These are the baseline guarantees the rebuild is forbidden to drop. They are restated as
requirements precisely so that "we rebuilt it and grounding quietly went away" cannot happen
without a checklist row going red.

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-C01 | Grounded teaching — never solved from scratch | **BUILT** | `app/src/lib/retrieval.ts`, `lib/ask.ts`, `lib/lesson.ts` (T033–T034) | Prompt-capture harness (T037) needs a live DB; verified by deliberate diff review instead — the refactor touches ledger inserts and appends a retrieval block that renders to `""` when nothing is retrieved |
| FR-C02 | Review-gate machinery intact; suspension is a **flag**, not a deletion | **VERIFIED** | `db/migrations/009` `explanation_library.reviewed BOOLEAN DEFAULT FALSE`; `load_seed.py` forces `false` | Constraint fired against a real database; `SELECT count(*) … WHERE NOT reviewed` is the reversibility receipt (T043, needs the box to have a number) |
| FR-C03 | Deterministic server-side grading, transactional mastery | **VERIFIED** | `app/src/app/api/attempts/route.ts` — `FOR UPDATE`, row-closing bitemporal write; `lib/arithmetic.ts` expression evaluator (`7ac26e4`) | 56 unit tests pass; live BKT walk 0.3000 → 0.1458 → 0.4909 → 0.8314 → 0.9612. **Extended 2026-09-20:** `grade()` used `parseFloat`, which silently reads only the leading digits, so a student who typed the working — "3x6" for a `correct_answer` of 18 — was compared as **3** and marked wrong. Now: exact literal → expression evaluation → the old lenient parse → string equality. The evaluator is a hand-written recursive-descent parser over a whitelisted character set, **not** `eval`/`Function`, and adds no model call to the grading path. 5 new unit tests; checked live against `q:u1-1-2:g002-cardin` — "3x6" correct, "3x5" wrong *and* diagnosed as `mc:u1-1-2:product-commutes`, "18" still correct. Gap: arithmetic only — algebraic finals (`x=5` vs `5`) are not covered. Feedback [#40](https://github.com/samtoma/AI.NEXT/issues/40) |
| FR-C04 | Per-call AI cost/token/latency/student logging, environment-stamped | **BUILT** | `app/src/lib/db.ts` write paths; `ai_interactions.environment` + `surface_kind` (T012); **`lib/cost-queries.ts` + `/admin/cost`** (rev. 10) | Schema verified; per-surface rows accumulate only under real traffic. **Extended 2026-09-20:** the logging was never the gap — every model call has carried surface, kind, cost, both token counts, cache counters, latency, student and environment since migration 009. Nothing *read* it: the only query touching the table outside the insert path counted rows for a stat tile, so feedback [#39](https://github.com/samtoma/AI.NEXT/issues/39) ("no cost tracking by function") was a reporting gap wearing an instrumentation gap's clothes. `/admin/cost` now groups by function, by teaching-vs-upload kind, and per student with a projected month. Still BUILT not VERIFIED: no query here has been run, because there is no database in the session that wrote it. |
| FR-C05 | Operational safety for every solution's stack | **BUILT** | `deploy/DEPLOY-MVP1.md` rails (never `down -v`, never `system prune`), compose project isolation | Cannot be proven without the box (T019) |

---

## 2. Identity & onboarding — FR-1xx

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-101 | Identity is a **picker, never a login** | **VERIFIED** | `components/DemoStudentSwitcher.tsx` (visible variant), `app/student/page.tsx` (T024) | Rendered and screenshotted; no password field exists anywhere in the tree |
| FR-102 | Selected student validated **server-side** every request | **VERIFIED** | `lib/student-context.ts` → `resolveStudentContext()` (T021) | Cookie value is validated against the `students` table; an unknown id falls back rather than trusting the client |
| FR-103 | Capture grade 7–12, seed the student model with it | **VERIFIED** | `api/demo-students/route.ts`, `lib/profile.ts` `GRADES` (T022) | Both seeded students carry a grade (9, 10) in the live database |
| FR-104 | Interest capture, five categories + Sports/Music detail | **VERIFIED** | `lib/profile.ts` `INTEREST_CATEGORIES`/`DETAIL_CATEGORIES`; `students.interests`, `interest_detail` JSONB (T023) | Live row: `{sports,music}` with `{"music":{"which":["guitar"]},"sports":{"which":["football"]}}` |
| FR-105 | Remember the last student and lesson position across visits | **BUILT** | Cookie persistence + `?lesson=` position (T026) | Needs a multi-visit browser session to prove |
| FR-106 | Self-signup with email/phone verification *[REVISED 2026-09-20 — superseded by 002 FR-2001…FR-2011]* | **DEFERRED** | — | decisions.md Q5 — the picker replaces it for the PoC. **Superseded 2026-09-20**: ADR-0013 replaces the picker with student-owned accounts (002 FR-2001…FR-2011); phone/OTP stays deferred (002 FR-2903). This unblocks FR-606. |

---

## 3. Learning core — FR-2xx

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-201 | Walk the curriculum one unit at a time, prerequisite-sequenced | **VERIFIED** | `lib/queries.ts` plan assembly over `graph_edges.edge_type='prerequisite_of'` | Today's Plan renders five real questions: three weakest-with-prerequisites-met, one spaced review, one stretch |
| FR-202 | Ask anything at any point; guided teaching, never the answer handed over | **BUILT** | `api/ask/route.ts`, `lib/ask.ts` | The guardrail path exists and is prompt-level; proving it needs the Claude runtime |
| FR-203 | Interests frame explanations **only where a real analogy exists** | **BUILT** | `lib/retrieval.ts` profile attributes | Deliberately conditional; needs live turns to observe |
| FR-204 | Return a stopped student to where they left off | **BUILT** | T026, shared with FR-105 | Same gap |
| FR-205 | Accept JPEG/PNG/PDF uploads from anywhere in the lesson | **VERIFIED** | `api/uploads/route.ts` (≤10 MB, `202` + poll), `lib/uploads.ts`; **the control** — `components/chat/upload-attachment.tsx` mounted by `ChatCore`'s composer (`StudentLoop`, `AskSpineDock`), limits shared client-and-server from `lib/upload-contract.ts`; `api/ask/route.ts` reads `uploadId`; `buildLessonContext` and `lib/session-cache.ts`'s `snapshotKey` carry it | **This row said VERIFIED for ten days and was wrong, and the wrong claim is kept here because the demotion is the evidence that the counting rule works.** It was marked VERIFIED on 2026-09-10 against `api/uploads/route.ts` — intake, storage and status transitions, all real — **but no student surface had a file input.** Nothing outside the auth forms rendered one, and `api/ask/route.ts` never read `uploadId`, so `askContext`'s parameter was `undefined` on every turn this product has ever served. The requirement's words are *"from anywhere in the lesson"*; what was verified was code that existed, not a path a student could reach. `SC-009` recorded the truth in the same document — *"uploads are unreachable and the grounding link is dead"* — and the two rows contradicted each other from 2026-09-16 until now. **Closed 2026-09-21 (`85fe3b8`)**: one control in the composer both the lesson and the chat render, a camera only on touch devices, polling that outlives the server's own parse timeout. Three further breaks had to be fixed for the feature to do anything — `buildLessonContext` ignored the upload, the grounding snapshot key did not carry it (a photo taken after "hi" would have been ignored for three hours), and the size/type limits lived in a module the browser cannot bundle. **Live, hand-run**: `uploads` rows 2–4 for student 1, `parse_status='parsed'`, **rows 3–4 created through the UI control**, and tutor turns that quote the equation off the photograph. `upload-link.test.mts` and `upload-contract.test.mts` walk the wire hop by hop (composer → route → context builder → `retrieve()`) so the missing wire cannot return silently. **Two gaps, named**: PDF has never been sent **through the control** — only the server intake path was exercised, and the accepted-type list is one shared constant, which is an argument rather than a run; and neither test carries a `@covers` annotation, so the generated count below does not see them. |
| FR-206 | Uploaded material used for the academic task only | **PARTIAL** | Prompt constraint (T050); `lib/retrieval.ts:304` renders the uploaded text into the prompt only when a parse succeeded | **Half of this is now real rather than prompt-level, because there are live turns to look at.** The *retention* half holds where it matters most: the parse dropped the worksheet's "Name/Class" header line, so the incidental personal detail never reached storage or the prompt — there is nothing stored for the tutor to comment on. Gap: the *never commented on* half is still a prompt constraint observed over a handful of turns, with no sampling and nothing that re-checks it on a later commit. Promote when a release-review sample exists — the same sample `SC-008` is waiting for. |
| FR-207 | Tone adapts to **grade level** and to **how engaged the student appears** | **VERIFIED** | Grade via `retrieval.ts` profile block; **engagement via `lib/engagement.ts`** — pure classifier + row mapping, query in `retrieval.ts`, rendered into the prompt beside grade | **Closed 2026-09-13.** 21 tests (123 total, all pass) + exercised against the live database: 6 real attempts classified `struggling`, stance rendered, label withheld. Precedence is `returning` → `rushing` → `struggling` → `labouring` → `steady`, so a student back after an absence is never read as failing. Fails quiet below 4 observations and on any query error, so the prompt stays byte-identical when there is nothing to say. Per PRD §8 the block is a stance for the tutor and forbids repeating it to the student. |
| FR-208 | English LTR by default; direction never hard-coded | **VERIFIED** | `app/layout.tsx` (no `dir` on `<html>`), `globals.css` logical properties, `lib/subjects.ts` direction seam (T025, T074); `arabicUi` prop threaded through `ChatCore`/`ChatQuestionCard` (`73c30a8`, `edee361`, `2578277`) | **Amended 2026-09-20 — the earlier VERIFIED was true of the three pages someone had looked at and false everywhere else.** Prototype 1.1 found Arabic rendering unconditionally to English-subject students in ~13 places across `ChatCore`, `ChatQuestionCard`, `CitationChip`, `LessonSession`, `ReportCard`, `StudentLoop`, `GraphCanvas`, `LoPanel`, `DemoStudentSwitcher`, `api/ask` and `CheckInCard`. Root cause was structural, not cosmetic: `debug` and mode flags were standing in for a language check, so instrumentation state decided which language a child read. The language axis is now its own prop, defaulting to English. Feedback [#20](https://github.com/samtoma/AI.NEXT/issues/20), [#41](https://github.com/samtoma/AI.NEXT/issues/41) |
| FR-209 | Elicit before explaining — introduce, ask, wait, then confirm | **BUILT** | `lib/lesson.ts` shared learn rhythm (`775b6d8`) | Feedback [#33](https://github.com/samtoma/AI.NEXT/issues/33). Written into the protocol for all three subjects, with the one permitted exception (a first definition the student cannot guess) stated in the rule itself. **Cannot be promoted without a live lesson** — this is model behaviour, and the failure mode to watch for is over-correction: a tutor that interrogates a tired student. See §9 item 8. |
| FR-210 | An open question is a first-class ask in every subject | **BUILT** | `lib/lesson.ts` shared learn rhythm (`775b6d8`) | Feedback [#34](https://github.com/samtoma/AI.NEXT/issues/34). **The defect this records is worth keeping.** Every interactive directive the protocol offered — `{{show_question}}`, widgets, figures — produces a CARD, so a model told to make the student act had only card-shaped tools and produced a quiz. Worse: the instruction naming a chat question as a valid ask **already existed in `arabicProtocol` and in neither `mathProtocol` nor `socialProtocol`** — written once, reaching one subject of three. The fix went into the shared rhythm precisely so it cannot happen again per-subject. |
| FR-211 | Ask for the working; act on a partial answer | **BUILT** | `lib/lesson.ts` shared learn rhythm (`775b6d8`); grading half in `lib/arithmetic.ts` (`7ac26e4`) | Feedback [#35](https://github.com/samtoma/AI.NEXT/issues/35), [#24](https://github.com/samtoma/AI.NEXT/issues/24). Both halves had to move together: asking a student to show working while `grade()` marked `3x6` wrong for an answer of 18 would have been worse than not asking. Gap named in FR-C03 — the grader handles arithmetic only, so multi-step and algebraic working still cannot be scored and there is no partial credit. |
| FR-212 | A taught lesson ends on retrieval, before any recap | **BUILT** | `lib/lesson.ts` LESSON ARC (`775b6d8`); turn cap 14→18 in `api/ask/route.ts` | Feedback [#34](https://github.com/samtoma/AI.NEXT/issues/34). The arc previously read `→ closing recap message`, so **not ending on retrieval was the specification**, not a drift from it. The cap had to move with it: at 14 a full lesson reached the limit before the retrieval could happen, so this requirement would have been silently unmet on exactly the lessons that ran long. ~29% more turns on the most expensive surface, deliberately. |
| FR-213 | Multi-step explanations delivered as steps | **BUILT** | `lib/lesson.ts` shared learn rhythm (`775b6d8`) | Feedback [#23](https://github.com/samtoma/AI.NEXT/issues/23). The machinery pre-dated the rule — the rhythm has always allowed 2–4 beats separated by `{{beat}}` — but nothing said an *explanation specifically* had to be split, so the beat rule read as a length limit. **This is the cheapest of the five to check**: count the `{{beat}}` pauses in a multi-step explanation. If they are still absent, the problem is the model ignoring an instruction rather than a missing one, and the fix is a worked example rather than another rule. |

---

## 4. Student model & retrieval — FR-3xx · **the hypothesis under test**

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-301 | Mastery as a **probability** with an inspectable evidence trail | **VERIFIED** | `lib/bkt.ts` (pure), `mastery.evidence` JSONB, `contracts/bkt.md` | 8 tests over all six contract invariants; live walk saturates at exactly 0.9800 after 15 correct and still drops to 0.8737 on one wrong — invariant 3 (revisability) holds |
| FR-302 | Model holds mastery, grade, language preference, interests | **VERIFIED** | `db/migrations/009` `students` columns | Live rows carry all four |
| FR-303 | A retrieval layer assembles grounding **before** any model call | **VERIFIED** | `lib/retrieval.ts` — the single composition seam | Nearest-skills CTE executed against the real graph; a column-name bug (`src`/`dst` vs `src_id`/`dst_id`) that would have failed **every tutor turn** was found only by running it |
| FR-304 | Explanation library as first-class content, `reviewed=false` in this environment only | **BUILT** | `migrations/009`, `services/extraction/runbook/refutation.workflow.js`, `assemble_refutations.py`, `load_seed.py` | Pipeline dry-run verified end to end from manifest to assembler; **generation and load need the box** (T042) |
| FR-305 | No library entry ⇒ serve the standard correct explanation and raise an authoring gap | **BUILT** | `lib/explanations.ts` (T035–T036) | Lookup path typechecks; needs library rows to exercise |
| FR-306 | A student joining mid-year is **placed by assessment**, not assumed to start at zero | **OPEN** ⚠️ | — | **No placement flow exists.** Not deferred in the spec, so it currently reads as in-scope and unbuilt — see §9 |
| FR-307 | Every attempt records diagnosis type, misconception, stance, confidence | **VERIFIED** | `api/attempts/route.ts`, `attempts` diagnosis columns (T032) | Columns exist and are written; `confidence` deliberately nullable |

---

## 5. Progress & assessment — FR-4xx

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-401 | Break performance down **by topic**, never a single blended number | **VERIFIED** | `lib/dashboard.ts` (computes no aggregate at all), `app/dashboard/page.tsx`, `api/dashboard/route.ts` | Rendered against live BKT data; the module exposes no overall figure, so a caller cannot render one by accident |
| FR-402 | Exam preparation — high-yield topics and question patterns | **OPEN** ⚠️ | — | Not built, not deferred — see §9 |

---

## 6. Parent, safety, billing, analytics — FR-5xx…FR-8xx

| FR | Requirement | Status | Implementation | Proof / blocker |
|---|---|---|---|---|
| FR-501 | Read-only parent view of the same data *[REVISED 2026-09-20 — superseded by 002 FR-2901, FR-2902]* | **DEFERRED** | — | Phase 9 (T055–T058) was never started. **Superseded 2026-09-20**: the picker-based mechanism is withdrawn with the picker itself (ADR-0013); the parent link is modelled and the view deferred (002 FR-2901, FR-2902). |
| FR-502 | Supportive, non-punitive threshold alerts | **OPEN** | — | Phase 9 |
| FR-601 | Never encourage or normalise self-harm; respond safely | **OPEN** | — | Phase 11 — **hard gate before any real student** |
| FR-602 | Crisis flags reach a human **immediately**, off the analytics path | **BLOCKED** ⛔ | — | **T067 — Samuel must name the recipient.** An unmonitored channel produces a record that looks like a safeguard and is not one |
| FR-603 | No student's data exposed to another | **PARTIAL** | Cloudflare Access boundary; picker is not access-scoped per family | Documented honestly as a pilot limitation; the parent view (FR-501) must carry a visible notice |
| FR-604 | Account-sharing deterrence *[REVISED 2026-09-20 — superseded by 002 FR-2009]* | **DEFERRED** | — | No accounts to share — the stated reason no longer holds; 002 creates accounts. **Superseded 2026-09-20**: ships as the deterrent's minimum honest form, a student sees and can end every place their account is signed in (002 FR-2009). **Status there as of 2026-09-21: PARTIAL** — the endpoints are verified, and no student-facing surface lists a session yet, so the deterrent is not visible to a student. |
| FR-605 | The student build does not carry the operator surfaces | **VERIFIED** | `lib/env.ts` `INTERNAL_SURFACES`; layouts at `app/admin/` and `app/dev/`; guards in `/pipeline`, `/gallery`; `NavLinks`; `app/page.tsx` (`b4cca13`). **Re-implemented 2026-09-21** (002 P2, `65d180c`): those layouts are deleted and the surfaces live in the `(console)` route group of a second build target, so the guarantee now comes from `next.config.ts`'s page extensions and is asserted from the build artefact by `app/scripts/check-surface-manifest.mts` in CI (002 FR-2201). | Feedback [#10](https://github.com/samtoma/AI.NEXT/issues/10), [#11](https://github.com/samtoma/AI.NEXT/issues/11), [#12](https://github.com/samtoma/AI.NEXT/issues/12). The nav read `Study · Where you stand · Evidence Walk · Content · Pipeline` to a fourteen-year-old. **Verified by serving the built app on both settings**: flag off → 404 on all seven routes; flag on, *same build* → reached. The first implementation was wrong and looked right — two dev harnesses are prerendered, so the layout gate ran at build time and 404'd even with the override on; the dev layout is `force-dynamic` now. `/spine` is deliberately not gated (the lesson report sends students there; feedback #15 asks for more of it). |
| FR-606 | Per-person authorisation for operator surfaces, with roles *[REVISED 2026-09-20 — superseded by 002 FR-2202, FR-2203, FR-2204]* | **DEFERRED** | — | Feedback [#7](https://github.com/samtoma/AI.NEXT/issues/7). **Superseded 2026-09-20** — no longer blocked on FR-106 (FR-106's deferral is lifted), but the requirement itself ships as 002 FR-2202/FR-2203/FR-2204: one authorisation point, four roles, content-review named a safety control. Recorded as its own requirement rather than folded into FR-605 **because FR-605 must never be read as satisfying it** — a build-time switch cannot tell one person from another, and the gap is easier to lose inside a satisfied requirement than beside one. Carries a safety weight beyond admin convenience: the content-review role controls the human gate ADR-0007's unreviewed-content exception depends on. |
| FR-701…707 | Trial, payment, plans | **DEFERRED** | — | decisions.md Q7 — payments out of this build |
| FR-801 | Emit the PRD §13 event taxonomy | **PARTIAL** | `lib/analytics.ts`, `api/analytics/route.ts`; emitters for `student_created`, `student_selected`, `session_started`/`_ended`, `explanation_delivered`, `retrieval_attempt_started`/`_submitted`, `question_asked`, `upload_submitted`, `dashboard_viewed` | Gap: `parent_view_opened` (T058) and the safety events (Phase 11) |
| FR-802 | Safety-flag events carry the flag type and nothing else | **BUILT** | `safety_flags` table — no transcript, no excerpt column exists | Schema enforces it structurally; emission is Phase 11 |

---

## 7. Comparison environment — FR-9xx · **the reason this branch exists**

> **Re-cut 2026-09-13 by [ADR-0010](../../docs/decisions/0010-one-branch-per-solution.md).** Each
> solution is now its own long-lived branch (`family-tutor`, `PDR1-0`); neither is an environment of
> the other. Requirements that asserted *two stacks live at once on one box* are amended below.
> Environment tagging and unpooled metrics (Principle XI) are unchanged — what is withdrawn is the
> requirement that both products run simultaneously before anything can be measured.
>
> **Further narrowed the same day by the [ADR-0010 Clarification](../../docs/decisions/0010-one-branch-per-solution.md#clarification--samuel-2026-09-13-same-day-after-the-first-pass).**
> Samuel: *"I will not rely on the system to compare, the 2 systems can be completely different."*
> Cross-solution content parity and the frozen-baseline obligation are **withdrawn**; `FR-908` is
> **dropped**. What survives is data hygiene (attribution, no pooling, no student data crossing) and
> a per-solution content-drift check. Constitution Principle XI was redefined accordingly — **v3.0.0**.

| FR | Requirement | Status | Implementation | Proof / blocker |
|---|---|---|---|---|
| FR-901 | Every event, ledger row and cost record identifies its environment | **VERIFIED** | `lib/env.ts` (config only — never inferred from the request host), `lib/db.ts`, `lib/analytics.ts` | A misconfigured stack fails loudly rather than producing quietly-plausible pooled data |
| FR-902 | A separate isolated stack — own volumes, own port, own password | **BUILT** | `deploy/docker-compose.mvp1.yml` — project `ainext-mvp1`, `127.0.0.1:3101`, own `pg` and `claude_cfg` volumes | T013–T014 need the box |
| FR-903 | ~~Both reachable at once~~ → **deploying one solution never touches another** (ADR-0010); the baseline is never restarted or mutated | **BUILT** | Compose project separation; DEPLOY-MVP1 procedure | T019 verifies uptime unbroken — needs the box |
| FR-904 | ~~Same bundles both sides~~ → **per-solution drift guard only** (ADR-0010 Clarification): a solution MUST NOT silently drift from the set it is supposed to serve. Cross-solution parity is **withdrawn** — solutions may serve entirely different curricula | **VERIFIED** | `services/extraction/parity_check.py` | Proven to catch its target failure: a fresh scoped load gives 450 total but only **421 live** (Unit 1's 29 demoted) — a totals-only check would have called that parity. A `source_documents` bug that returned **zero rows instead of erroring** was found the same way |
| FR-905 | No Arabic or Social Studies content in this environment | **BLOCKED** ⛔ | `COURSE_SUBJECT="math"`, `node_subject` view scoping — both still present and still course-scoped | **Demoted from VERIFIED 2026-09-22. The requirement is unmet, by Samuel's own instruction, and is left standing rather than reworded.** The 2026-09-13 proof was "loader and parity check are both course-scoped", which was true of a `local-dev.sh` that called the loader once. It now calls it for all three courses (`62f780c`), and all three are **live for grade 9** in the local `mvp1` database — 90 maths objectives, 84 social, 100 Arabic; a Social Studies lesson opens in Arabic right-to-left and is taught. This is the only `mvp1` environment that exists (nothing is deployed — FR-902, FR-907), so there is nowhere the requirement is still holding. **What changed underneath it is that loading and serving are now separable** ([ADR-0018](../../docs/decisions/0018-course-availability.md), 002 FR-2702…FR-2706): reinstating FR-905 is one console action per course and unloads nothing. Whether it is reinstated or withdrawn is a product call and belongs to **Samuel** — §9 item 13. Parity is unaffected and stayed GREEN: it fingerprints the maths book this solution serves, and ADR-0010's Clarification withdrew cross-solution content parity. |
| FR-906 | Provisioning removes no volumes on the shared box | **BUILT** | DEPLOY-MVP1 rails | Procedural; verified by following it (T013) |
| FR-907 | Behind Cloudflare Access, explicitly invited list | **BLOCKED** | Hostname `ainext-mvp1.reletix.com` fixed at **one label** (research.md R6) | T016 — needs the Cloudflare Zero Trust dashboard |
| FR-908 | ~~The baseline emits the same conversion metric, with no teaching change~~ | **DROPPED** | — | **Dropped 2026-09-13 (ADR-0010 Clarification).** Required a PR to `main`, which Samuel ruled out (*"don't touch the main now"*), and it existed only to make a controlled comparison valid — an obligation now released. `T059`/`T060` dropped with it. |

---

## 8. Design system & visual language — FR-10xx **[NEW]**

Added 2026-09-10. The design revamp was executed against the *Nour Design System v0.2* handoff
(Drive `1eAJeMHy5m3D-FhS8RAv2KMg5F6eO0QOM`) with no corresponding requirements in the spec, which
made a shipped behaviour untraceable: the burnt-sienna mastery ramp violated a stated product rule
and nothing in the requirement set could have caught it. These rows close that gap.

**Authority moved 2026-09-20.** The visual authority is now the published **Noor Play design
system**, <https://claude.ai/artifact/SXTAsvPUCjU4ZMp5oZtM6J>, binding on every surface this
repository builds under **constitution v3.1.0 Principle XII**. The Drive handoff above named the
*Master* variant, which ADR-0011 replaced. `docs/design/handoffs/noor-play/` is the published
system's source material and is superseded wherever they differ.

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-1001 | **Every surface this repository builds** MUST apply the Noor Play design system; the frozen `family-tutor` baseline is not bound | **PARTIAL** | `globals.css` `[data-ds="play"]`/`[data-ds="noor"]`, now set from the resolved variant in `layout.tsx` rather than from `IS_MVP1` (`85fe3b8`, FR-1011) | **Status changed 2026-09-20 from VERIFIED, because the requirement widened, not because the code regressed.** What holds: one token block, no component forks, and with the attribute absent every surface renders as the Ledger baseline. What does not: Principle XII withdrew ADR-0011's carve-out, so `/admin`, `/pipeline`, `/spine`, `/dev` and `/gallery` are now in scope and have never had the Play pass — they render on the baseline tokens by omission. Neither did the per-widget SVG verdict inks. **Amended 2026-09-22 — two changes, neither of which closes it.** The internal surfaces are no longer in this build at all: they live in the console build's `(console)` route group and their conformance is tracked as 002 **FR-2209**, which is BUILT because nothing checks it. And two dev harnesses that were pinning `data-ds="noor"` in their own markup — a mixed build arrived at one file at a time — are unpinned, with `design-variant-scan.test.mts` failing if any component hard-codes a variant again. Verified again when those surfaces carry the system and something checks that they do. |
| FR-1002 | **No red and no coral** may appear in the product palette. A wrong answer greys out and invites a retry | **VERIFIED** | `lib/mastery.ts` five-step ramp; `--rust` remapped to the neutral inactive treatment | Rendered dashboard contains no `#b8472a`/`#cf9227`; the ramp is `#EFEEF6 → #F0A22F → #D9A75A → #8FB98A → #2F9E8F` |
| FR-1003 | Mastery MUST be shown as named bands, never colour alone | **VERIFIED** | `/dashboard`: `MASTERY_LEGEND`, per-row `pct` + band name, `role="img"`. `PlayCheckIn` (`LessonCheckIn.tsx`): outlined ramp + band name + `role="img"`, no percentage | **Amended 2026-09-20.** The dashboard proof still holds. The Noor Play check-in card was a *second* mastery surface and did not: feedback [#42](https://github.com/samtoma/AI.NEXT/issues/42) asked for the percentage off the study page, and the first cut removed every non-colour signal with it. Measured, lit-vs-unlit ran 1.84:1–2.84:1 against a 3:1 floor and adjacent lit bands sit 1.02:1 apart, so two of the three channels this requirement names — greyscale and colour vision — failed; only the screen reader was covered. Fixed without reinstating the number: a 1.5px ink outline makes lit-vs-unlit fill-vs-empty (15.69:1 unlit, ≥4.79:1 against every lit fill), the band name renders as text at 5.51:1, and the `aria-label` names the band. **The requirement is unchanged — it never mandated a percentage, only a named band alongside whatever value is shown.** |
| FR-1004 | An objective with **no evidence** MUST NOT be shown in a lit band | **VERIFIED** | `masteryColor(score, alpha, started)` | A cold-start 0.30 prior and a practised 0.30 no longer look identical; unopened lessons render grey, not amber |
| FR-1005 | Never white text on amber; one dominant accent per screen | **VERIFIED** | `--nour-on-action: #141833`; `--accent` mapped to indigo, not amber | 31 `bg-accent`+`text-paper` call sites keep a legal pairing |
| FR-1006 | Bilingual pairs MUST render at **equal size and weight**, each carrying its own direction | **VERIFIED** | Flex gaps (not inline margins) in `LessonCheckIn`, `StudentLoop` | Fixed a real defect: `margin-inline-start` on a `dir="rtl"` span resolves to its **right** edge, so the scripts rendered flush — `I'm lostمش فاهم حاجة`. **Note 2026-09-20:** that exact pair no longer exists on the English surface — the button now reads "Walk me through it" with no Arabic gloss (feedback [#19](https://github.com/samtoma/AI.NEXT/issues/19)), because an English-default surface should not have been rendering a bilingual pair at all. The requirement still governs the Arabic verticals, where pairs are legitimate; this row's proof is retained as the record of the layout bug it caught. |
| FR-1007 | Arabic MUST never be set in the mono stack or letter-spaced | **VERIFIED** | `globals.css` `[lang="ar"]`/`[dir="rtl"]` override | IBM Plex Mono carries no Arabic script; the override forces Cairo |
| FR-1008 | Equations render LTR inline in any page direction | **VERIFIED** | `.katex { direction: ltr }` under the Nour scope; `dir="ltr"` on maths spans | Constitution v2.0.0 Principle V |
| FR-1009 | No leaderboards, ranking, peer comparison, or "you're behind" framing | **VERIFIED** | Band names are factual (`attempted`, not `weak`); no ranking surface exists; `lib/checkin.ts` `learnOpeningFrame`/`learnAutoStartLine` replace the fixed premise (`91c2282`) | **Demoted and re-verified 2026-09-20.** The UI half was true; the tutor half was the opposite of true and nobody had read it. `lib/lesson.ts`'s `learnPrompt` told the model on **every** learn session that the student "understood NOTHING", including a lesson never attempted, and `LessonSession`'s hidden auto-start message said "I understood NOTHING… teach me from zero" as if the student had typed it. Either alone reproduced the apologetic opener Prototype 1.1 reported ("let's rebuild it from the very first brick"). Both now key off the same 0–4 mastery banding the ramp uses, so a first-time lesson opens as something new rather than as a failure. Verified live against the dev DB at all three reachable stages. Feedback [#30](https://github.com/samtoma/AI.NEXT/issues/30) |
| FR-1010 | The signature spring is reserved for proficient → mastered | **BUILT** | `.anim-mastered` (420 ms, `--spring-pop`), respects `prefers-reduced-motion`; applied in `StudentLoop`'s `MasteryDelta` (rev. 10) | **Still BUILT, for a better reason.** It was unspent because *nothing in the product rendered a band change at all* — the lesson showed `mastery 30% → 69%`, a number, so there was no transition for a transition animation to attach to. Replacing that with band movement (`attempted → proficient`) gave it its trigger, and the class is now applied on arrival at `mastered`. Promoting it to VERIFIED still needs someone to watch a real student cross that boundary, which no session has produced. |
| FR-1011 | Exactly **one design-system variant per page render**, selected before first paint by grade (Preparatory → Play, Secondary → Master) unless the student stored an override, which survives sign-out; no surface hard-codes a variant | **PARTIAL** — Master hidden by decision, 2026-09-23 | `lib/design-variant.ts` (the pure rule), `lib/design-variant-queries.ts`, migration `024` (two nullable override columns), `app/layout.tsx` (`data-ds` on `<html>`), `components/DesignVariantPicker.tsx`, `(student)/settings/page.tsx`, `api/settings/appearance/route.ts`, `api/console/profile/appearance/route.console.ts`; `globals.css` names both `[data-ds="play"]` (aliased `noor`) and `[data-ds="master"]` | **2026-09-23 — Master hidden by Samuel's decision** ([ADR-0017 Amendment](../../docs/decisions/0017-two-variants-keyed-to-grade.md); review [`docs/reviews/2026-09-23-play-master-ui-review.md`](../../docs/reviews/2026-09-23-play-master-ui-review.md)). `MASTER_VARIANT_ENABLED = false` in `lib/design-variant.ts`: every student and every operator now resolves to Play whatever the grade or stored override; stored `master` overrides are kept, not migrated; both pickers show a read-only line and both endpoints refuse `"master"` with `400 invalid_variant`. So the requirement's "Secondary → Master" clause is **unmet by decision**, not by defect, and the row stays PARTIAL. The mechanism is unchanged and still proved — the grade rule and override run with the switch ON, and new cases prove all-Play with it OFF (`design-variant.test.mts`, 29 tests with the scan test). **Correction to the note below:** Master's anatomy *is* published (design-system `tokens.json` `master` theme; `docs/design/noor/{Welcome,Main,Progress}.dc.html`; implemented once in `df1bf29`, 2026-09-10) — the gap is that `[data-ds="master"]` inherits the Ledger `:root` palette instead of it. Revisit when Master's published tokens are implemented (issues #46/#47). **Moved OPEN → PARTIAL 2026-09-21 (`85fe3b8`), and deliberately not to VERIFIED.** *Added 2026-09-20 ([ADR-0017](../../docs/decisions/0017-two-variants-keyed-to-grade.md)) — the code came after the requirement, which is the ordinary way round and is why this row needs no "added after" stamp.* **The mechanism is done and was driven live**, in served HTML on the first response with no hydration: Omar (grade 9) → `data-ds="play"` at byte 31; an override → `master`; cleared → `play`; a console operator → `master`; signed out → `play`; a request for `"noor"` refused **400**, so the compatibility alias is not a value anybody can store. The override is a column on the student, not browser storage, so it survives sign-out; `design-variant-scan.test.mts` fails if any component hard-codes a variant again, which it did — two dev pages were pinning `data-ds="noor"` in their own markup, the mixed build the handoff forbids, arrived at one file at a time. 24 unit tests across `design-variant.test.mts` and the scan test. **Gap, and it is the requirement's own second clause: "Secondary → Master" selects a variant that is a colour name over the baseline tokens.** `[data-ds="master"]` sets `--ds-variant: master` and nothing else; Master's anatomy — component guidelines, type scale, motion spec, and the contrast table ADR-0017's Consequences require — is unpublished, and **ADR-0017 forbids onboarding a Secondary cohort until it is**. A mechanism that works and a destination that is half specified is PARTIAL under this document's counting rule. Also: neither test carries `@covers`, so the generated count below does not see them. |

**Variant selection is decided, not open.** Both variants ship, keyed to the student's grade with a
stored override — [ADR-0017](../../docs/decisions/0017-two-variants-keyed-to-grade.md), amending
[ADR-0011](../../docs/decisions/0011-noor-play-design-system.md); the obligation is **FR-1011**
above. Background: `docs/design/noor/README.md`.

---

## 8b. Generated question bank — FR-11xx **[NEW]**

Added 2026-09-10 (ADR-0008, constitution v2.1.0). The driver was measured, not anticipated:
BKT reaches the `advanced` tier three times faster than Elo, and the bank behind that tier is
thin — 5 of 90 objectives had no advanced item, 52 had exactly one.

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-1101 | Generated items stored `source='variant'`, `reviewed_by IS NULL`, with a parent link | **VERIFIED** | `services/extraction/load_generated_questions.py` — all three forced by the loader, not taken from the bundle | 12 items loaded live against the local database and read back with the expected provenance |
| FR-1102 | Generated questions never reach the baseline; the check fails loudly if they do | **VERIFIED** | `parity_check.py` `check_baseline_clean()`; loader refuses any `AINEXT_ENVIRONMENT != mvp1` | The refusal was exercised: running with `AINEXT_ENVIRONMENT=baseline` stopped before writing anything |
| FR-1103 | The constant is the **book**, not the bank | **VERIFIED** | `parity_check.py` fingerprints `source IN ('seed','authored')`; generated fields excluded from `diff()` | Parity stayed GREEN at 450 book questions with 12 generated items live beside them |
| FR-1104 | Loading and exposing are two separate acts | **VERIFIED** | Loader defaults to `status='review'`; `--promote` required for `live` | Both paths run |
| FR-1105 | A reproducible ≥10% sample written to a review queue | **VERIFIED** | `--sample`/`--seed` write `*.review-queue.json` with the seed recorded | 1 of 12 selected under seed 42; re-running the same seed reselects the same item |
| FR-1106 | Structural validation before load, not presented as a correctness check | **VERIFIED** | `validate()` — tier, answer-in-choices, duplicate choice text, empty solution, cross-objective misconception | Bundle passes; the docstring states plainly what it cannot catch |
| FR-1107 | Distractors carry a `misconception_id` | **VERIFIED** | Sample bundle: 12 misconceptions, each distractor mapped | Closes the loop to the Phase 6 library without a classifier |
| FR-1108 | Live-unreviewed count reportable and disclosed with every parity result | **VERIFIED** | Disclosed on every `parity_check.py` run **and** on `/admin/content` | Page renders live: 450 book · 12 generated unchecked · 0 checked · 0 awaiting promotion |
| FR-1110 | A visible provenance tag on every question, on operator surfaces | **VERIFIED** | `lib/provenance.ts` (single derivation), `ProvenanceBadge`, `/admin/content`, `/spine` LO panel and passport | Badges render on both surfaces; the passport's unconditional "Reviewed ✓" stamp — which would have asserted a human check that never happened — now follows the row |
| FR-1109 | Coverage first — one live item per tier per objective | **VERIFIED** | `seed/generated/coverage-basics.json`, loaded via `load_generated_questions.py --promote --sample 100` | **Closed 2026-09-13.** The last 4 gaps (`lo:t2u1-1-4`, `lo:t2u1-3-1`, `lo:t2u1-3-2`, `lo:u4-2-4`) were all *applications* objectives — `T099` had already recorded these as the hardest to template, so they were authored rather than generated. Query now returns **zero** objectives missing any tier at any of basic/standard/advanced. Parity GREEN, book constant untouched at 450/450. **All 4 are live and unreviewed**, and all 4 were written to the review queue (`coverage-basics.review-queue.json`) rather than a 10% sample. |

**Blocked on Samuel**: T086 — review the 10% sample and return a verdict per item, and decide
what happens to a family when one of its members is rejected (ADR-0008 §Open).

## 8c. Misconceptions — FR-1111…FR-1115 **[NEW]**

Added 2026-09-12, prompted by a review of a generated standard-deviation item that asked why
the divisor is n and not n−1. The item was right for this curriculum; the tutor had nothing
grounded to say about the question.

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-1111 | A catalogue covering generated and textbook questions, authored against each objective's own definition | **PARTIAL** | `build_misconceptions.py` (1,120+ lines, hand-authored, no LLM) -> `seed/misconceptions-math.json` | **Measured 2026-09-13: 43 of 90 objectives, 102 entries, 100 refutations in `explanation_library` (all unreviewed).** `lo:t2u3-1-2` was authored this session as a rate check: **6 entries for one objective**, each mined from that objective's own book distractors and mapped to the exact choices. Remaining: **47 objectives, ~110 entries** at the same standard — all 47 do have book MCQs to mine (135 of them), so the approach is proven, but this is the largest content job in the backlog and cannot be closed in one pass without dropping the grounding bar the constitution sets. |
| FR-1112 | Every misconception a distractor points at has a servable refutation | **VERIFIED** | `load_misconceptions.py` writes one refutation per entry | **0** distractors point at nothing; `explanation_library` went from 0 rows to 76 |
| FR-1113 | Diagnose from the chosen distractor; serve *that* refutation | **VERIFIED** | `api/attempts/route.ts` | Live: answering `q:u1-1-1:001` with B recorded `diagnosis_type=distractor_diagnosed`, `misconception_id=mc:u1-1-1:multiplied-not-added`, `confidence=1`, and served `expl:mc:u1-1-1:multiplied-not-added` |
| FR-1114 | Conceptual entries for confusions no distractor encodes | **VERIFIED** | 2 entries, including `mc:u3-2-2:divisor-n-minus-one` | Answers within the syllabus — names the book's σ with n, explains where n−1 belongs, and tells the student to check the calculator's setting |
| FR-1115 | One error, one entry; generator ids folded in as aliases | **VERIFIED** | Alias pass in the loader | 18 generator ids re-pointed and removed; the questions carrying them were rewritten in place |

**Coverage today**: 94 book distractors across 49 of 250 book MCQs (was **zero**), and 471
generated distractors. The gap is named: 201 book MCQs are still undiagnosable (T104).

## 8b. Interactive practice widgets (FR-12xx)

Every row here was exercised in a real Chromium session against the built app — dragged, drawn,
tapped and graded — not typechecked and assumed. `/dev/math-widgets` is the surface that was
driven.

| Req | What it demands | Status | Where | What proves it |
|---|---|---|---|---|
| FR-1201 | Every module has at least one widget | **VERIFIED** | `lib/widget-docs.ts` | 10 of 10 modules mapped, up from 2. A test asserts the mapping covers every unit **and** that every built widget is documented to at least one of them — the quiet failure is a widget that works and is never offered |
| FR-1202 | Continuous input, not only taps | **VERIFIED** | 9 new widgets | 6 drag-to-construct, 1 freehand, 2 tap. Dragged in-browser: a line to `y = 2x − 1`, a chord onto (−3,4)–(4,−3), an inscribed angle to 35° |
| FR-1203 | Touch/mouse/pen; survives leaving the figure; no lost start | **VERIFIED** | `widgets/drag.ts` | Pointer capture + `getScreenCTM().inverse()` + `touch-action:none`. **Two bugs found by driving it and fixed**: moves gated on React state were dropped before the re-render committed (fatal on a touchscreen, where the first events arrive ~1 ms apart), and a missing `preventDefault` let the browser start a native selection and fire `pointercancel` mid-drag. Both confirmed fixed in Chromium — the cancel is gone and handles now reach their target |
| FR-1204 | Operable without a pointer | **BUILT** | `WidgetShell.Handle`, `useKeyNudge` | Each handle is a `role="slider"` focus stop announcing its value; arrows move by one snap step, Shift by five, Enter commits. Verified in the DOM (`aria-valuetext` reads back after every drag); **not yet driven by keyboard alone or with a screen reader** |
| FR-1205 | Grade the property, not a stored position | **VERIFIED** | each widget's `check()` | `circle_builder` accepts any of the 66 chords; `line_drawer` in equation mode accepts any two points on the line; `triangle_ratio` accepted 6–8–10 for sin θ = 3/5 and said so: *"Any similar triangle gives the same ratio"* |
| FR-1206 | A diagnosis, not a score | **VERIFIED** | the `onResult` notes | Fired live: *"that is the MEDIAN… the mean is the total shared out equally"*; *"inverse means the product stays the same: 6 × 10 = 60, but 4 × 7 = 28"*; *"your stroke doubles back… it is not the graph of a function at all"* |
| FR-1207 | Reject rather than repair; reject the unreachable | **VERIFIED** | `lib/widget-payloads.ts` | 5 unreachable-but-well-typed payloads render nothing, shown as a panel on the fixture: string coordinates, a 37° angle off the 5° snap, a fourth term of 40/3, sin θ = 1, a quadratic with a = 0 |
| FR-1208 | Validation testable without rendering | **VERIFIED** | `widget-payloads.test.mts` | 18 tests, no React. Covers type confusion, wrong-length arrays, non-finite numbers, enum escapes, reachability, and that a payload is never mutated |
| FR-1209 | Tell the tutor about its own unit only | **VERIFIED** | `lib/widget-docs.ts`, `lib/lesson.ts` | ≤4 widgets per unit, asserted by test. A further test parses every documented example directive back out and runs it through the validator — a documented example the validator rejects would train the model to emit payloads that silently render nothing |
| FR-1210 | Syllabus notation in the readouts | **VERIFIED** | `widgets/format.ts` | Caught by looking at the rendered page: `line_drawer` was printing `y = 0.75x + 0.25`. Now `y = 3/4x + 1/4`, with 7 tests covering `1x`, `+ 0`, `+ −3`, negative denominators and the vertical-line case |
| FR-1211 | Teaching signal, not assessment | **VERIFIED** | dispatch path | Widget results reach the tutor as a `[live event]` note and nothing else; no widget touches `api/attempts` or the BKT update. Deliberate — an ungraded widget moving mastery would put an uncontrolled variable inside the comparison |

**What this does not yet cover.** No widget has been used by a real student, or on a real iPad
(FR-1204's keyboard path and the touch path are both verified only in a desktop Chromium with
synthetic pointer events). And the tutor has never *chosen* one: the prompt documentation is in
place and tested, but no Claude turn has been spent to see which widget a model actually reaches
for at a real teaching beat. That is T119, and it is the one that decides whether this work
lands.

---

## 8c. Widgets as questions (FR-12xx, ADR-0009)

Every row was exercised against the real database and, where it touches a surface, in a real
browser session against the built app.

| Req | What it demands | Status | Where | What proves it |
|---|---|---|---|---|
| FR-1212 | A widget is representable as a question | **VERIFIED** | migration 010, `generate_widget_questions.py` | 48 widget questions live in `questions` across 13 objectives and 20 families. They inherit everything: the selector has no `question_type` filter, `/admin/content` lists them with provenance unchanged, and the book constant (450 `authored`) is untouched, so parity is safe by construction |
| FR-1213 | Predicates as distractors, one shared contract | **VERIFIED** | `contracts/widget-predicates.json` | 51 predicates over 11 kinds, read by the TS module, `widget_spec.py` and the loader. A test fails on drift; a second reads the widget sources and checks every predicate literal they can emit. That one **found a real defect**: `number_line_marker` initialised to `off-target`, which was not in its vocabulary |
| FR-1214 | Client reports structure, server decides meaning | **VERIFIED** | `api/attempts/route.ts`; `ChatCore` open-question guard (`18b7d6c`) | Grading is `predicate === q.correct_answer` server-side; the outcome's own `correct` flag is used only for local feedback. A widget attempt with no predicate is rejected 400. **Amended 2026-09-20:** Prototype 1.1 reported that tapping "Got it" without attempting counted as correct. The server had not been fooled — that acknowledgement never reaches `grade()` at all; it is sent as a plain chat turn, and nothing stopped the *model* reading it as licence to move past a question it had never seen answered. The guard is deterministic, not a prompt: `ChatCore` derives from the transcript which pushed question still has no matching "the student answered…" event, and if "Got it" fires while one is open it is caught client-side before any network call. No LLM call added. Feedback [#31](https://github.com/samtoma/AI.NEXT/issues/31) |
| FR-1215 | Prerequisite rule, checked against the graph | **VERIFIED** | `generate_widget_questions.py` | Recursive closure over `prerequisite_of`. **Caught two content errors I had written**: `chord-endpoints-off-circle` authored on the diameter-theorem objective instead of the definitions one, and a linear-functions sketch reaching for a coordinate-geometry misconception taught later. Neither was visible by reading the code |
| FR-1216 | Widget attempts move mastery, tagged by modality | **VERIFIED** | migration 010, `api/attempts` | Live: a wrong construction on `q:geo1-1-2:w001` moved BKT 0.98 → 0.8737 and wrote `modality='widget'`, `diagnosis_type='construction_diagnosed'`. `SELECT modality, count(*) FROM attempts GROUP BY 1` is the audit |
| FR-1217 | Stored preferred; inline materialises, never live | **VERIFIED** | `api/attempts`, migration 010 CHECK | An inline widget answered through the API wrote `qw:inline:demo-001` as `status='review'`, `reviewed_by=NULL`, `materialised_from=2`. `UPDATE … SET status='live'` on it is **refused by the database**, not merely by the code — the guarantee is a constraint, not a convention |
| FR-1218 | The refutation reaches the student | **VERIFIED** | `api/attempts`, `ChatQuestionCard`; `readyToFinish` in `LessonSession` (`64b45e6`) | It was already looked up and logged to analytics, then discarded in favour of the generic solution — the text written for the mistake reached a dashboard and never the child. Now returned and rendered under "why that happened", with `unreviewed` shown. **Demoted and re-verified 2026-09-20 — it rendered and was then taken away.** Three separate auto-advance timers (`onFinishDirective`, `onCapped`, and review mode's turn cap) each fired `requestFinish` on a fixed 2.2–2.5s delay with no student action in between, so on the last question of a lesson the report replaced the explanation before it could be read. "Reaches the student" has to mean stays on screen. All three timers are gone; they now only arm the header's "Finish lesson" button and a matching in-chat chip, and the report is reachable **only** by a tap. Feedback [#28](https://github.com/samtoma/AI.NEXT/issues/28) |
| FR-1219 | No internal vocabulary reaches students | **VERIFIED** | `ChatQuestionCard` | Caught in the browser: the card printed *"Not quite — answer: ok"*. Now "Not yet", and the reveal-the-answer affordance is suppressed for widgets |

**Where the tutor still is not.** The prompt now documents stored constructions and the `"lo"`
attribution field, and the question catalogue renders widget rows as `(construction: <kind>)` — but
**no Claude turn has yet pushed a stored widget or composed an attributed inline one.** The inline
materialisation path is verified at the API with a hand-built request, not through a real lesson
turn. That remains T119, and it is still the task that decides whether any of this reaches a
student.

**Coverage, stated plainly.** 13 of 90 objectives carry a widget question, and not every predicate
resolves to a misconception — `off-target` deliberately resolves to none, and several named ones
have no catalogue entry yet. An unmapped predicate serves no refutation, which is the honest
behaviour, not a silent failure.

**The review gate does not yet reach widgets.** The loader put 20 of the 48 into the human review
queue, covering all 20 families, but `render_review_page.py` renders multiple-choice and numeric
items only. Until it renders a construction, those 20 cannot be reviewed — so every widget question
a student sees is unreviewed generated content, bounded to the comparison environment exactly as
ADR-0008 bounds the rest. That is T122.

---

## 9. What is unresolved, and who owns it

| # | Item | Owner | Why it matters |
|---|---|---|---|
| 1 | **T067 — name the crisis-escalation recipient** | **Samuel** | Phase 11 is a hard gate before any real student. Everything else in safety is buildable the moment this lands |
| 2 | **FR-306** (mid-year placement) reads as in-scope and is unbuilt | **Samuel** | Either build it or defer it explicitly — an in-scope requirement nobody is building is worse than a deferred one |
| 3 | **FR-402** (exam preparation) same | **Samuel** | Same |
| 4 | **SC-007** is not buildable as written | **Samuel** | Named in `/speckit-analyze`; the metric has no data source |
| 5 | **SC-004** still references "verified signups" | **Samuel** | Signups were replaced by the picker (decisions.md Q5); the criterion is stale |
| 6 | **T001** — create and push the `mvp1` branch | **Samuel** | This session is pinned to its designated branch; pushing `mvp1` needs an explicit go-ahead |
| 7 | ~~Master vs Play design variant~~ — **settled 2026-09-20**, Play, recorded as [ADR-0011](../../docs/decisions/0011-noor-play-design-system.md) | Samuel | The reason Master was picked (avoid a second variable in a controlled comparison) stopped holding when ADR-0010 withdrew parity |
| 8 | ~~Access gating has no requirement~~ — **resolved 2026-09-20**, Samuel approved. Written as **FR-605** (VERIFIED) and **FR-606** (BLOCKED on FR-106) | Samuel | Split deliberately: FR-605 is what shipped, FR-606 is what is still missing, and FR-605 must never be read as satisfying FR-606 |
| 9 | ~~The Socratic protocol has no requirement either~~ — **resolved 2026-09-20**, Samuel approved. Written as **FR-209**…**FR-213**, all BUILT | Samuel | Stated as obligations on the product, never as prompt wording — a prompt is an implementation of these and will be rewritten many times |
| 10 | **Nothing in the build can judge teaching behaviour** — now **blocking five named requirements** | **Samuel** | FR-209…FR-213 are all BUILT and none can be promoted, because promotion needs evidence this build cannot produce. Same for `SC-005`, the core bet. Scoped as a solution and queued in [`ROADMAP.md`](../../docs/ROADMAP.md) 2026-09-20 |
| 11 | **The tutor prompts assume the student is male** | **Samuel** | 63 masculine pronouns (+1 `himself`) in `lib/lesson.ts`, 21 in `lib/ask.ts`, 11 in `lib/checkin.ts` (recounted 2026-09-20, `specs/002-identity-and-admin-console/research/codebase-seams.md` §8; the original review said 23), and a masculine Arabic vocative offered to the model as an example. `students` has no gender column. Not on any feedback row — found in review |
| 7b | ~~Review the 10% question sample~~ — **done 2026-09-12**, 52 of 53 accepted. A second round of 5 covers the families the first draw missed (T111) | Samuel | The condition his own authorisation attached to the generated bank |
| 7d | **Who performs the 10% review** (T107) | **Samuel** | The constitution's suspension is conditioned on a *human* gate. A model reviewing model-generated maths reproduces the failure mode it is meant to catch — and on the standard-deviation item it produced a false rejection |
| 7c | Question supply is now a **variable**, not a constant | **Samuel** | The baseline exhausts its advanced tier and the comparison build does not. Every reported result has to say so — and the gap is now **993 vs 450**, not 462 vs 450 |
| 8 | Box-dependent work: T005, T013–T020, T042–T043, T070 | Engineering, once box access exists | Everything is written and dry-run verified; none of it has met the real environment |
| 9 | **No tutor turn has ever chosen a widget** (T119) | Engineering | Eleven widgets, 48 stored widget questions, prompt documentation written and tested. Whether a model pushes the right stored construction at a real teaching beat is still unmeasured, and it is the thing that decides whether any of this reaches a student |
| 10 | ~~Widget outcomes do not move mastery~~ — **decided 2026-09-12**, ADR-0009: they do, tagged by modality. FR-1211 is superseded by FR-1216 | Samuel | Modality is now the comparison's second declared variable after question supply. Every reported result must say whether widget evidence is included |
| 11 | **Widget questions cannot be reviewed yet** (T122) | Engineering | 20 are queued and `render_review_page.py` cannot render a construction. Until it can, every widget a student sees is unreviewed — bounded to the comparison environment, but unreviewed |
| 12 | **13 of 90 objectives carry a widget question** | Engineering | Coverage was never the goal of the first bundle; the pipeline was. Extending it is now template work (T123) |
| 13 | **FR-905 is unmet and stays written down** — Arabic and Social Studies are loaded and live for grade 9 | **Samuel** | New 2026-09-22. His own instruction of 2026-09-21 broke the requirement's premise, so the matrix records it as BLOCKED rather than quietly rewriting it to match. Two answers are cheap and both are his: reinstate it by setting the two courses hidden in the console (one action each, nothing unloaded), or withdraw it and say what the comparison is now about. **The thing that must not happen is neither** — 297 Arabic and 279 Social Studies questions sit at `review`, and default-deny (ADR-0018) plus the review gate are the only two holds between them and a student |
| 14 | **Rev. 12's evidence has no smoke script**, unlike every phase in the 002 matrix | Engineering | The uploads, variant and console-reads work was proved by a hand-run browser and psql session on 2026-09-21–22. Real evidence, and **not re-runnable by anybody else** — so a regression in any of it would be found by a person noticing, not by a script. `scripts/console-p5-smoke.sh` is the shape the missing one should take |
| 15 | **Four test files prove requirements and declare none of them** | Engineering | `upload-link.test.mts`, `upload-contract.test.mts`, `design-variant.test.mts` and `design-variant-scan.test.mts` carry no `@covers` annotation — three of them say in their own headers that this is because no requirement existed when they were written. FR-1011 existed then and FR-2701…FR-2711 exist now, so the reason has expired. Until the annotations land, `scripts/traceability.py` cannot see **53** tests that do real work (9 + 21 + 18 + 5), and the "requirements a test declares" count below under-reports. The 002 matrix carries the same item for `catalog.test.mts` and `catalog-gate.test.mts` — 25 more |

---

## 10. Counts

<!-- GENERATED by scripts/traceability.py --write. Do not edit by hand:
     the next run overwrites it. Change the spec or the rows instead. -->

| | Count |
|---|---|
| Functional requirements | **98** |
| Success criteria | **6** |
| Traced (every one needs a row) | **104 / 104** |
| — verified | 56 |
| — built | 17 |
| — partial | 8 |
| — open | 6 |
| — blocked | 4 |
| — deferred | 12 |
| Requirements a test declares | **9** |
| Tasks complete / total | **99 / 143** |

**Of 56 requirements marked VERIFIED, 9 have an automated test declaring them.** The remaining 47 were verified by running the product — a browser session, a query against a loaded database — which is real evidence and is not re-checked on any later commit. That gap is the honest measure of this build's regression risk, and it is the number to drive down.

Counted from the artifacts by `scripts/traceability.py`, which fails CI when the spec, the matrix and the tests disagree. The hand-maintained table this replaced had drifted five requirements out of date, and an entire deferred block had no row at all.

The frozen baseline (`specs/000-baseline/`) defines 31 more requirements. It shipped and is not under change (ADR-0007), so it is reported by the tool but never gated — it has no matrix of its own yet.

## 9. Success criteria — SC-001…SC-011 · **the measures the pilot is judged on**

> **Traced for the first time on 2026-09-16.** These eleven had never appeared in this matrix at
> any revision, which meant the measures the pilot is judged on were the only requirements nobody
> was tracking. Two of them have had their premise removed by decisions taken since they were
> written, and are recorded as BLOCKED on a product call rather than quietly rewritten to match
> what we happen to have built — that rewrite is Tamer's to make, not engineering's.

| SC | Criterion | Status | Implementation | Proof / gap |
|---|---|---|---|---|
| SC-001 | Each solution provably serves the content set it is supposed to serve *(re-cut by ADR-0010 — no longer cross-solution)* | **VERIFIED** | `services/extraction/parity_check.py` | Run 2026-09-13 and again after the FR-1109 load: PARITY GREEN, source `38ee465de1dc3692`, 450/450 book questions. Re-runnable on demand. |
| SC-002 | A reviewer can move between the two experiences on one lesson in a sitting, with no data, session or content bleed | **DROPPED** | — | **Withdrawn by the ADR-0010 Clarification.** This was the side-by-side comparison; Samuel: *"the comparison will be on the live usage… I will not rely on the system to compare."* `T138` closed as dropped. Id retained, never reused. |
| SC-003 | Every metric reportable per environment, never pooled | **PARTIAL** | `lib/env.ts`, `lib/analytics.ts`, `analytics_events.environment` | Attribution is real and verified — every row written this session carried `environment='mvp1'`, never `baseline`. Gap: no reporting layer exists to pool or not pool (`T061`, `T062`). Survives ADR-0010 as data hygiene (constitution v3.0.0 Principle XI). |
| SC-004 | ≥70% of **verified signups** complete onboarding and start a lesson within 24h | **BLOCKED** | — | **Premise is stale.** There are no verified signups: identity is a picker, not auth (decisions.md Q5, `FR-106` DEFERRED). The criterion cannot be measured as written. Needs Tamer to restate it against the identity model this build actually has. |
| SC-005 | Comprehension-to-retrieval conversion rate, measurable from day one | **OPEN** | — | `T061` not built. The PRD calls this the single metric testing whether the core bet works, and nothing computes it. Its "headline comparison metric between the two builds" clause is withdrawn by ADR-0010; the measure itself survives per solution and is the one to build. **Amended 2026-09-20 — it is MIS-INSTRUMENTED, not merely unbuilt, and that is worse.** Of the two events the ratio needs, `explanation_delivered` fires **only when a refutation is served** (a wrong answer matching a known misconception), while `retrieval_attempt_submitted` fires on **every** graded attempt. Their ratio today is *all attempts over refutations only* — a plausible number that is not a conversion rate, and nothing should be decided from it. **FR-212 is what makes this fixable**: the second moment never existed as a distinct thing (retrieval was any graded answer), and requiring a lesson to end on a from-memory retrieval creates one. Emit that moment, make `explanation_delivered` fire on every explanation, and the criterion becomes computable. Scoped as layer 4 of the evaluation harness in [`ROADMAP.md`](../../docs/ROADMAP.md). |
| SC-006 | D7 and D30 retention reported per environment | **OPEN** | — | Event taxonomy exists (`FR-801`, PARTIAL); no retention query. |
| SC-007 | Trial-to-paid conversion, time-to-upgrade, post-trial churn measurable end to end | **DEFERRED** | — | Payments are out of this build (decisions.md Q7); `FR-701…707` deferred with it. Nothing to measure until billing returns. |
| SC-008 | Zero ungrounded explanations; claim-bearing statements carry resolvable citations | **PARTIAL** | `lib/retrieval.ts`, `lib/ask.ts`, `explanation_library` | Grounding is built and the retrieval block renders `""` when nothing is retrieved, so an ungrounded turn is structurally hard. Gap: no release-review sampling has been run, so "zero" is unmeasured rather than demonstrated. |
| SC-009 | Zero direct answers served to graded work, **including via upload** | **PARTIAL** | Prompt guardrail (`FR-202`, `T049`); the upload guardrail in `lib/retrieval.ts`'s `retrievalBlock()` (`:304`–`:311`) | **Still PARTIAL, for a completely different reason than before — and this row was the one that was right.** It read *"the upload half cannot hold at all: uploads are unreachable (`FR-205`) and the grounding link is dead"* while `FR-205` said VERIFIED, and that contradiction stood from 2026-09-16 to 2026-09-22. The precondition it named is now closed (`85fe3b8`), and the consequence is exact: **the upload guardrail fired for the first time on 2026-09-21.** The instruction that uploading is not a way round guide-don't-answer is inside the block that renders only when parsed upload text reaches the prompt, and no text ever had — so for the whole life of this build the sentence existed and had never been sent. Live turns now quote `3x + 7 = 22` and `6x − 4 = 20` off the photographs and decline to solve them. **Remaining gap, unchanged in kind**: both halves are prompt-level and **"zero" is unmeasured** — no release-review sampling has been run, which is the same gap `SC-008` carries. Neither half can be promoted by this build; judging teaching behaviour is §9 item 10. |
| SC-010 | Every crisis flag reaches the human channel in the same session, none left in the analytics queue | **OPEN** | — | Phase 11 is 0/6. `T067` needs Samuel to name the recipient. **This is the hard gate before any real student.** |
| SC-011 | No unreviewed question or canonical solution is servable; generated explanations exempt, flagged and countable | **BLOCKED** | `explanation_library.reviewed`, `questions.reviewed_by` | **Contradicted by a later decision.** ADR-0008 explicitly permits unreviewed *questions* live in this environment, and 130 are. The "exempt, flagged, countable" half is VERIFIED — 100 of 100 refutations flagged unreviewed and countable in one query. The prohibition half is no longer the policy. Needs Tamer to restate it against ADR-0008. |

**Two criteria are BLOCKED on a product call, not on engineering.** `SC-004` measures signups that no
longer exist and `SC-011` forbids what ADR-0008 now permits. Both were written before the decisions
that broke them. Rewriting a success criterion to match what got built is how a pilot passes its own
exam, so they stay visibly broken until Tamer restates them.

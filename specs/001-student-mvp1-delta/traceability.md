# Traceability — Student MVP 1.0 comparison build

**Status date**: 2026-09-20 (rev. 9, `PDR1-0-v0.3.0`) · **Branch**: `PDR1-0`
**Authority**: [spec.md](./spec.md) · [tasks.md](./tasks.md) · [decisions.md](./decisions.md) ·
constitution [v3.0.0](../../.specify/memory/constitution.md) · [ADR-0007](../../docs/decisions/0007-student-mvp1-comparison-build.md) ·
[ADR-0010](../../docs/decisions/0010-one-branch-per-solution.md) · [ADR-0011](../../docs/decisions/0011-noor-play-design-system.md)

> **rev. 9 demoted four rows that said VERIFIED and were not.** Prototype 1.1 was the first
> time anyone drove this build as a student rather than as its author, and four requirements
> marked VERIFIED failed in front of him. The rows below now carry what he saw alongside the
> fix, because a matrix that only records successes cannot be used to judge the next claim.
> This is the counting rule working as written: *treat VERIFIED as a claim that someone ran
> it, and be willing to demote.*

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
| FR-C04 | Per-call AI cost/token/latency/student logging, environment-stamped | **BUILT** | `app/src/lib/db.ts` write paths; `ai_interactions.environment` + `surface_kind` (T012) | Schema verified; per-surface rows accumulate only under real traffic |
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
| FR-106 | Self-signup with email/phone verification | **DEFERRED** | — | decisions.md Q5 — the picker replaces it for the PoC |

---

## 3. Learning core — FR-2xx

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-201 | Walk the curriculum one unit at a time, prerequisite-sequenced | **VERIFIED** | `lib/queries.ts` plan assembly over `graph_edges.edge_type='prerequisite_of'` | Today's Plan renders five real questions: three weakest-with-prerequisites-met, one spaced review, one stretch |
| FR-202 | Ask anything at any point; guided teaching, never the answer handed over | **BUILT** | `api/ask/route.ts`, `lib/ask.ts` | The guardrail path exists and is prompt-level; proving it needs the Claude runtime |
| FR-203 | Interests frame explanations **only where a real analogy exists** | **BUILT** | `lib/retrieval.ts` profile attributes | Deliberately conditional; needs live turns to observe |
| FR-204 | Return a stopped student to where they left off | **BUILT** | T026, shared with FR-105 | Same gap |
| FR-205 | Accept JPEG/PNG/PDF uploads from anywhere in the lesson | **VERIFIED** | `api/uploads/route.ts` (≤10 MB, `202` + poll), `lib/uploads.ts` | Intake, storage and status transitions exercised locally; **parse** needs the on-box Claude CLI |
| FR-206 | Uploaded material used for the academic task only | **BUILT** | Prompt constraint (T050) | Prompt-level; needs live turns |
| FR-207 | Tone adapts to **grade level** and to **how engaged the student appears** | **VERIFIED** | Grade via `retrieval.ts` profile block; **engagement via `lib/engagement.ts`** — pure classifier + row mapping, query in `retrieval.ts`, rendered into the prompt beside grade | **Closed 2026-09-13.** 21 tests (123 total, all pass) + exercised against the live database: 6 real attempts classified `struggling`, stance rendered, label withheld. Precedence is `returning` → `rushing` → `struggling` → `labouring` → `steady`, so a student back after an absence is never read as failing. Fails quiet below 4 observations and on any query error, so the prompt stays byte-identical when there is nothing to say. Per PRD §8 the block is a stance for the tutor and forbids repeating it to the student. |
| FR-208 | English LTR by default; direction never hard-coded | **VERIFIED** | `app/layout.tsx` (no `dir` on `<html>`), `globals.css` logical properties, `lib/subjects.ts` direction seam (T025, T074); `arabicUi` prop threaded through `ChatCore`/`ChatQuestionCard` (`73c30a8`, `edee361`, `2578277`) | **Amended 2026-09-20 — the earlier VERIFIED was true of the three pages someone had looked at and false everywhere else.** Prototype 1.1 found Arabic rendering unconditionally to English-subject students in ~13 places across `ChatCore`, `ChatQuestionCard`, `CitationChip`, `LessonSession`, `ReportCard`, `StudentLoop`, `GraphCanvas`, `LoPanel`, `DemoStudentSwitcher`, `api/ask` and `CheckInCard`. Root cause was structural, not cosmetic: `debug` and mode flags were standing in for a language check, so instrumentation state decided which language a child read. The language axis is now its own prop, defaulting to English. Feedback [#20](https://github.com/samtoma/AI.NEXT/issues/20), [#41](https://github.com/samtoma/AI.NEXT/issues/41) |

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
| FR-501 | Read-only parent view of the same data | **OPEN** | — | Phase 9 (T055–T058) |
| FR-502 | Supportive, non-punitive threshold alerts | **OPEN** | — | Phase 9 |
| FR-601 | Never encourage or normalise self-harm; respond safely | **OPEN** | — | Phase 11 — **hard gate before any real student** |
| FR-602 | Crisis flags reach a human **immediately**, off the analytics path | **BLOCKED** ⛔ | — | **T067 — Samuel must name the recipient.** An unmonitored channel produces a record that looks like a safeguard and is not one |
| FR-603 | No student's data exposed to another | **PARTIAL** | Cloudflare Access boundary; picker is not access-scoped per family | Documented honestly as a pilot limitation; the parent view (FR-501) must carry a visible notice |
| FR-604 | Account-sharing deterrence | **DEFERRED** | — | No accounts to share |
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
| FR-905 | No Arabic or Social Studies content in this environment | **VERIFIED** | `COURSE_SUBJECT="math"`, `node_subject` view scoping | Loader and parity check are both course-scoped |
| FR-906 | Provisioning removes no volumes on the shared box | **BUILT** | DEPLOY-MVP1 rails | Procedural; verified by following it (T013) |
| FR-907 | Behind Cloudflare Access, explicitly invited list | **BLOCKED** | Hostname `ainext-mvp1.reletix.com` fixed at **one label** (research.md R6) | T016 — needs the Cloudflare Zero Trust dashboard |
| FR-908 | ~~The baseline emits the same conversion metric, with no teaching change~~ | **DROPPED** | — | **Dropped 2026-09-13 (ADR-0010 Clarification).** Required a PR to `main`, which Samuel ruled out (*"don't touch the main now"*), and it existed only to make a controlled comparison valid — an obligation now released. `T059`/`T060` dropped with it. |

---

## 8. Design system & visual language — FR-10xx **[NEW]**

Added 2026-09-10. The design revamp was executed against the *Nour Design System v0.2* handoff
(Drive `1eAJeMHy5m3D-FhS8RAv2KMg5F6eO0QOM`) with no corresponding requirements in the spec, which
made a shipped behaviour untraceable: the burnt-sienna mastery ramp violated a stated product rule
and nothing in the requirement set could have caught it. These rows close that gap.

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-1001 | The comparison build MUST apply the Nour design system; the frozen baseline MUST be visually unchanged | **VERIFIED** | `globals.css` `[data-ds="nour"]`, set from `IS_MVP1` in `layout.tsx` | One token block, no component forks; with the attribute absent every surface renders as before |
| FR-1002 | **No red and no coral** may appear in the product palette. A wrong answer greys out and invites a retry | **VERIFIED** | `lib/mastery.ts` five-step ramp; `--rust` remapped to the neutral inactive treatment | Rendered dashboard contains no `#b8472a`/`#cf9227`; the ramp is `#EFEEF6 → #F0A22F → #D9A75A → #8FB98A → #2F9E8F` |
| FR-1003 | Mastery MUST be shown as named bands, never colour alone | **VERIFIED** | `/dashboard`: `MASTERY_LEGEND`, per-row `pct` + band name, `role="img"`. `PlayCheckIn` (`LessonCheckIn.tsx`): outlined ramp + band name + `role="img"`, no percentage | **Amended 2026-09-20.** The dashboard proof still holds. The Noor Play check-in card was a *second* mastery surface and did not: feedback [#42](https://github.com/samtoma/AI.NEXT/issues/42) asked for the percentage off the study page, and the first cut removed every non-colour signal with it. Measured, lit-vs-unlit ran 1.84:1–2.84:1 against a 3:1 floor and adjacent lit bands sit 1.02:1 apart, so two of the three channels this requirement names — greyscale and colour vision — failed; only the screen reader was covered. Fixed without reinstating the number: a 1.5px ink outline makes lit-vs-unlit fill-vs-empty (15.69:1 unlit, ≥4.79:1 against every lit fill), the band name renders as text at 5.51:1, and the `aria-label` names the band. **The requirement is unchanged — it never mandated a percentage, only a named band alongside whatever value is shown.** |
| FR-1004 | An objective with **no evidence** MUST NOT be shown in a lit band | **VERIFIED** | `masteryColor(score, alpha, started)` | A cold-start 0.30 prior and a practised 0.30 no longer look identical; unopened lessons render grey, not amber |
| FR-1005 | Never white text on amber; one dominant accent per screen | **VERIFIED** | `--nour-on-action: #141833`; `--accent` mapped to indigo, not amber | 31 `bg-accent`+`text-paper` call sites keep a legal pairing |
| FR-1006 | Bilingual pairs MUST render at **equal size and weight**, each carrying its own direction | **VERIFIED** | Flex gaps (not inline margins) in `LessonCheckIn`, `StudentLoop` | Fixed a real defect: `margin-inline-start` on a `dir="rtl"` span resolves to its **right** edge, so the scripts rendered flush — `I'm lostمش فاهم حاجة`. **Note 2026-09-20:** that exact pair no longer exists on the English surface — the button now reads "Walk me through it" with no Arabic gloss (feedback [#19](https://github.com/samtoma/AI.NEXT/issues/19)), because an English-default surface should not have been rendering a bilingual pair at all. The requirement still governs the Arabic verticals, where pairs are legitimate; this row's proof is retained as the record of the layout bug it caught. |
| FR-1007 | Arabic MUST never be set in the mono stack or letter-spaced | **VERIFIED** | `globals.css` `[lang="ar"]`/`[dir="rtl"]` override | IBM Plex Mono carries no Arabic script; the override forces Cairo |
| FR-1008 | Equations render LTR inline in any page direction | **VERIFIED** | `.katex { direction: ltr }` under the Nour scope; `dir="ltr"` on maths spans | Constitution v2.0.0 Principle V |
| FR-1009 | No leaderboards, ranking, peer comparison, or "you're behind" framing | **VERIFIED** | Band names are factual (`attempted`, not `weak`); no ranking surface exists; `lib/checkin.ts` `learnOpeningFrame`/`learnAutoStartLine` replace the fixed premise (`91c2282`) | **Demoted and re-verified 2026-09-20.** The UI half was true; the tutor half was the opposite of true and nobody had read it. `lib/lesson.ts`'s `learnPrompt` told the model on **every** learn session that the student "understood NOTHING", including a lesson never attempted, and `LessonSession`'s hidden auto-start message said "I understood NOTHING… teach me from zero" as if the student had typed it. Either alone reproduced the apologetic opener Prototype 1.1 reported ("let's rebuild it from the very first brick"). Both now key off the same 0–4 mastery banding the ramp uses, so a first-time lesson opens as something new rather than as a failure. Verified live against the dev DB at all three reachable stages. Feedback [#30](https://github.com/samtoma/AI.NEXT/issues/30) |
| FR-1010 | The signature spring is reserved for proficient → mastered | **BUILT** | `.anim-mastered` (420 ms, `--spring-pop`), respects `prefers-reduced-motion` | Defined and unspent — needs a live band transition to observe |

**Open design decision (Samuel's call, constitution Principle I):** the **master** variant ships
rather than **Play**. Prep-3 is 14–15, inside both bands, and the handoff forbids mixing them. The
comparison environment already varies BKT against Elo; a second visual variable is a confound.
Reversing it is a token swap plus the sticker border/shadow rules — see `docs/design/nour/README.md`.

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
| 7 | Master vs Play design variant | **Samuel** | Implemented as master; cheap to reverse |
| 7b | ~~Review the 10% question sample~~ — **done 2026-09-12**, 52 of 53 accepted. A second round of 5 covers the families the first draw missed (T111) | Samuel | The condition his own authorisation attached to the generated bank |
| 7d | **Who performs the 10% review** (T107) | **Samuel** | The constitution's suspension is conditioned on a *human* gate. A model reviewing model-generated maths reproduces the failure mode it is meant to catch — and on the standard-deviation item it produced a false rejection |
| 7c | Question supply is now a **variable**, not a constant | **Samuel** | The baseline exhausts its advanced tier and the comparison build does not. Every reported result has to say so — and the gap is now **993 vs 450**, not 462 vs 450 |
| 8 | Box-dependent work: T005, T013–T020, T042–T043, T070 | Engineering, once box access exists | Everything is written and dry-run verified; none of it has met the real environment |
| 9 | **No tutor turn has ever chosen a widget** (T119) | Engineering | Eleven widgets, 48 stored widget questions, prompt documentation written and tested. Whether a model pushes the right stored construction at a real teaching beat is still unmeasured, and it is the thing that decides whether any of this reaches a student |
| 10 | ~~Widget outcomes do not move mastery~~ — **decided 2026-09-12**, ADR-0009: they do, tagged by modality. FR-1211 is superseded by FR-1216 | Samuel | Modality is now the comparison's second declared variable after question supply. Every reported result must say whether widget evidence is included |
| 11 | **Widget questions cannot be reviewed yet** (T122) | Engineering | 20 are queued and `render_review_page.py` cannot render a construction. Until it can, every widget a student sees is unreviewed — bounded to the comparison environment, but unreviewed |
| 12 | **13 of 90 objectives carry a widget question** | Engineering | Coverage was never the goal of the first bundle; the pipeline was. Extending it is now template work (T123) |

---

## 10. Counts

<!-- GENERATED by scripts/traceability.py --write. Do not edit by hand:
     the next run overwrites it. Change the spec or the rows instead. -->

| | Count |
|---|---|
| Functional requirements | **90** |
| Success criteria | **6** |
| Traced (every one needs a row) | **96 / 96** |
| — verified | 57 |
| — built | 13 |
| — partial | 5 |
| — open | 7 |
| — blocked | 3 |
| — deferred | 10 |
| Requirements a test declares | **10** |
| Tasks complete / total | **99 / 143** |

**Of 57 requirements marked VERIFIED, 9 have an automated test declaring them.** The remaining 48 were verified by running the product — a browser session, a query against a loaded database — which is real evidence and is not re-checked on any later commit. That gap is the honest measure of this build's regression risk, and it is the number to drive down.

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
| SC-005 | Comprehension-to-retrieval conversion rate, measurable from day one | **OPEN** | — | `T061` not built. The PRD calls this the single metric testing whether the core bet works, and nothing computes it. Its "headline comparison metric between the two builds" clause is withdrawn by ADR-0010; the measure itself survives per solution and is the one to build. |
| SC-006 | D7 and D30 retention reported per environment | **OPEN** | — | Event taxonomy exists (`FR-801`, PARTIAL); no retention query. |
| SC-007 | Trial-to-paid conversion, time-to-upgrade, post-trial churn measurable end to end | **DEFERRED** | — | Payments are out of this build (decisions.md Q7); `FR-701…707` deferred with it. Nothing to measure until billing returns. |
| SC-008 | Zero ungrounded explanations; claim-bearing statements carry resolvable citations | **PARTIAL** | `lib/retrieval.ts`, `lib/ask.ts`, `explanation_library` | Grounding is built and the retrieval block renders `""` when nothing is retrieved, so an ungrounded turn is structurally hard. Gap: no release-review sampling has been run, so "zero" is unmeasured rather than demonstrated. |
| SC-009 | Zero direct answers served to graded work, **including via upload** | **PARTIAL** | Prompt guardrail (`FR-202`, `T049`) | The typed-question half is built and prompt-level. **The upload half cannot hold at all**: uploads are unreachable (`FR-205`) and the grounding link is dead, so no uploaded material reaches a turn to be guarded. Closing `FR-205` is a precondition for this criterion. |
| SC-010 | Every crisis flag reaches the human channel in the same session, none left in the analytics queue | **OPEN** | — | Phase 11 is 0/6. `T067` needs Samuel to name the recipient. **This is the hard gate before any real student.** |
| SC-011 | No unreviewed question or canonical solution is servable; generated explanations exempt, flagged and countable | **BLOCKED** | `explanation_library.reviewed`, `questions.reviewed_by` | **Contradicted by a later decision.** ADR-0008 explicitly permits unreviewed *questions* live in this environment, and 130 are. The "exempt, flagged, countable" half is VERIFIED — 100 of 100 refutations flagged unreviewed and countable in one query. The prohibition half is no longer the policy. Needs Tamer to restate it against ADR-0008. |

**Two criteria are BLOCKED on a product call, not on engineering.** `SC-004` measures signups that no
longer exist and `SC-011` forbids what ADR-0008 now permits. Both were written before the decisions
that broke them. Rewriting a success criterion to match what got built is how a pilot passes its own
exam, so they stay visibly broken until Tamer restates them.

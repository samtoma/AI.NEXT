# Traceability — Student MVP 1.0 comparison build

**Status date**: 2026-09-12 (rev. 7) · **Branch**: `claude/tamer-shared-drive-access-ddpypu` (destined for `mvp1`)
**Authority**: [spec.md](./spec.md) · [tasks.md](./tasks.md) · [decisions.md](./decisions.md) ·
constitution [v2.0.0](../../.specify/memory/constitution.md) · [ADR-0007](../../docs/decisions/0007-student-mvp1-comparison-build.md)

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
| FR-C03 | Deterministic server-side grading, transactional mastery | **VERIFIED** | `app/src/app/api/attempts/route.ts` — `FOR UPDATE`, row-closing bitemporal write | 56 unit tests pass; live BKT walk 0.3000 → 0.1458 → 0.4909 → 0.8314 → 0.9612 |
| FR-C04 | Per-call AI cost/token/latency/student logging, environment-stamped | **BUILT** | `app/src/lib/db.ts` write paths; `ai_interactions.environment` + `surface_kind` (T012) | Schema verified; per-surface rows accumulate only under real traffic |
| FR-C05 | Operational safety for both environments | **BUILT** | `deploy/DEPLOY-MVP1.md` rails (never `down -v`, never `system prune`), compose project isolation | Cannot be proven without the box (T019) |

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
| FR-207 | Tone adapts to **grade level** and to **how engaged the student appears** | **PARTIAL** | Grade reaches the prompt via `retrieval.ts:143`; **no engagement signal exists** | Gap: nothing measures engagement — no idle/latency/retry signal is collected or passed |
| FR-208 | English LTR by default; direction never hard-coded | **VERIFIED** | `app/layout.tsx` (no `dir` on `<html>`), `globals.css` logical properties, `lib/subjects.ts` direction seam (T025, T074) | `<html>` carries no `dir`; the check-in, plan and dashboard lead in English with Arabic at equal size and weight |

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

| FR | Requirement | Status | Implementation | Proof / blocker |
|---|---|---|---|---|
| FR-901 | Every event, ledger row and cost record identifies its environment | **VERIFIED** | `lib/env.ts` (config only — never inferred from the request host), `lib/db.ts`, `lib/analytics.ts` | A misconfigured stack fails loudly rather than producing quietly-plausible pooled data |
| FR-902 | A separate isolated stack — own volumes, own port, own password | **BUILT** | `deploy/docker-compose.mvp1.yml` — project `ainext-mvp1`, `127.0.0.1:3101`, own `pg` and `claude_cfg` volumes | T013–T014 need the box |
| FR-903 | Both reachable at once; the baseline is never restarted or mutated | **BUILT** | Compose project separation; DEPLOY-MVP1 procedure | T019 verifies uptime unbroken — needs the box |
| FR-904 | Same bundles both sides; an automated check proves content parity | **VERIFIED** | `services/extraction/parity_check.py` | Proven to catch its target failure: a fresh scoped load gives 450 total but only **421 live** (Unit 1's 29 demoted) — a totals-only check would have called that parity. A `source_documents` bug that returned **zero rows instead of erroring** was found the same way |
| FR-905 | No Arabic or Social Studies content in this environment | **VERIFIED** | `COURSE_SUBJECT="math"`, `node_subject` view scoping | Loader and parity check are both course-scoped |
| FR-906 | Provisioning removes no volumes on the shared box | **BUILT** | DEPLOY-MVP1 rails | Procedural; verified by following it (T013) |
| FR-907 | Behind Cloudflare Access, explicitly invited list | **BLOCKED** | Hostname `ainext-mvp1.reletix.com` fixed at **one label** (research.md R6) | T016 — needs the Cloudflare Zero Trust dashboard |
| FR-908 | The baseline emits the same conversion metric, with **no teaching change** | **OPEN** | — | T059 — a deliberately narrow PR to `main`; T060 requires **zero** prompt diffs |

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
| FR-1003 | Mastery MUST be shown as named bands, never colour alone | **VERIFIED** | `MASTERY_LEGEND`, per-row `pct` + band name, `role="img"` labels | Every row states the percentage and the band; the legend names all five steps |
| FR-1004 | An objective with **no evidence** MUST NOT be shown in a lit band | **VERIFIED** | `masteryColor(score, alpha, started)` | A cold-start 0.30 prior and a practised 0.30 no longer look identical; unopened lessons render grey, not amber |
| FR-1005 | Never white text on amber; one dominant accent per screen | **VERIFIED** | `--nour-on-action: #141833`; `--accent` mapped to indigo, not amber | 31 `bg-accent`+`text-paper` call sites keep a legal pairing |
| FR-1006 | Bilingual pairs MUST render at **equal size and weight**, each carrying its own direction | **VERIFIED** | Flex gaps (not inline margins) in `LessonCheckIn`, `StudentLoop` | Fixed a real defect: `margin-inline-start` on a `dir="rtl"` span resolves to its **right** edge, so the scripts rendered flush — `I'm lostمش فاهم حاجة` |
| FR-1007 | Arabic MUST never be set in the mono stack or letter-spaced | **VERIFIED** | `globals.css` `[lang="ar"]`/`[dir="rtl"]` override | IBM Plex Mono carries no Arabic script; the override forces Cairo |
| FR-1008 | Equations render LTR inline in any page direction | **VERIFIED** | `.katex { direction: ltr }` under the Nour scope; `dir="ltr"` on maths spans | Constitution v2.0.0 Principle V |
| FR-1009 | No leaderboards, ranking, peer comparison, or "you're behind" framing | **VERIFIED** | Band names are factual (`attempted`, not `weak`); no ranking surface exists | The dashboard states "nothing here is a score, and nobody else sees it" |
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
| FR-1109 | Coverage first — one live item per tier per objective | **PARTIAL** | `generate_questions.py` — 35 template families, answers computed rather than asserted | Live bank **450 → 993**. Objectives with no advanced item **5 → 0**, with no standard item **0**, with no basic item **4** (all "applications" word problems, T099). Depth is uneven by design: 36 objectives now average 19.8 items, 54 remain book-only at 5.2 (T098) |

**Blocked on Samuel**: T086 — review the 10% sample and return a verdict per item, and decide
what happens to a family when one of its members is rejected (ADR-0008 §Open).

## 8c. Misconceptions — FR-1111…FR-1115 **[NEW]**

Added 2026-09-12, prompted by a review of a generated standard-deviation item that asked why
the divisor is n and not n−1. The item was right for this curriculum; the tutor had nothing
grounded to say about the question.

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-1111 | A catalogue covering generated **and** textbook questions, authored against each objective's own definition | **PARTIAL** | `build_misconceptions.py` — 78 misconceptions, authored from the LO descriptions and the book's own distractors | 37 of 90 objectives covered; 53 remain (T104) |
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
| 9 | **No tutor turn has ever chosen a widget** (T119) | Engineering | Eleven widgets are built, validated and documented per unit. Whether a model reaches for the right one at a real teaching beat is unmeasured, and it is the thing that decides whether any of this reaches a student |
| 10 | **Widget outcomes do not move mastery** (FR-1211) | **Samuel** | Deliberate, to keep the comparison clean. But it means a student can construct every chord in the unit and the mastery number will not notice. Worth an explicit decision rather than an inherited default |

---

## 10. Counts

| | Count |
|---|---|
| Functional requirements (incl. FR-10xx, FR-11xx, FR-12xx) | **82** |
| VERIFIED | 49 |
| BUILT (awaiting the box, the runtime, or a browser session) | 16 |
| PARTIAL | 5 |
| OPEN | 6 |
| BLOCKED | 2 |
| DEFERRED by explicit decision | 9 |
| Tasks complete / total | **74 / 121** |

Both totals are now **counted from the documents** rather than carried forward — 82 is every
`**FR-nnn**` definition in spec.md, 121 every task id in tasks.md. The previous revision said 76
requirements and 112 tasks; the requirement figure was already 5 high before this phase added
11, which is what a hand-maintained count does over six revisions.

The honest headline: **the teaching core, the environment attribution, the content-parity gate and
the whole design language are done and were exercised against real data. Nothing has met the box.**

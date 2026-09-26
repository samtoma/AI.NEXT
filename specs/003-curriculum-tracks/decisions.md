# 003 — Samuel's decisions, 2026-09-25

**Authority level**: decided. This file records what Samuel decided for feature 003. The spec, the
plan and ADR-0024 are cut against it. Where a later decision changes one of these, the change is
stamped here with its date, not rewritten.

**Source.** On 2026-09-25 Samuel read three documents: the options in
[research.md](./research.md) (app architect), `docs/specs/extraction-pipeline.md` §10 (pipeline
auditor), and the three open questions in [spec.md](./spec.md). His answer, verbatim, relayed by
the coordinating session: *"I would take your recommendations"*. The coordinating session then
listed the seventeen decisions below. **Not committed**; Samuel reviews the written form.

**Second round, the same day.** Samuel read the written spec, plan, tasks and ADR drafts, and the
Grade 10 S0 report (`services/extraction/runbook/g10-s0-report.md`), and answered *"ok for all"*.
The coordinating session relayed that with the confirmations and new decisions below (#18–#22). Two
first-round decisions are amended by it (#13, #14). They are stamped where they stand, not
rewritten.

## The seventeen decisions

| # | Decision | Recorded in |
|---|---|---|
| 1 | **Sign-up asks for a curriculum only when the grade has live courses in two or more curricula**, as decided in the console. When there is only one curriculum it is stored without asking. (Spec Q1, option A.) | FR-4004, FR-4005; ADR-0024 |
| 2 | **One course belongs to exactly one curriculum.** The gate stays keyed by (course, grade). No new rule table. | FR-4002, FR-4101; ADR-0024 |
| 3 | **Ids.** National = `eg-national-en`; American = `us-american-en`, with the label "American". The book is written for South Africa's CAPS curriculum; state that neutrally, once. | FR-4001, FR-4201; ADR-0024 |
| 4 | **At launch, only the console changes a student's curriculum.** No student settings control. Switching never deletes progress, and switching back restores it. The change is made by an operator and recorded. | FR-4010…FR-4012; US5 |
| 5 | **A first Google sign-in** gets a one-screen step for grade and curriculum. | FR-4014 |
| 6 | **Launch scope.** Grade 10 sees only the American maths course, not Prep-3 maths. | FR-4211 |
| 7 | **Grade 10 uses the Play design.** Socratic probing is off for the G10 course at launch. | FR-4204, FR-4212 |
| 8 | **The console Overview splits by course.** | FR-4104 |
| 9 | **ADR-0019's "all content live" covers the G10 course.** Switching the course on is the gate. (Spec Q2, option A.) | FR-4202; ADR-0019 note |
| 10 | **The prompt hold (ADR-0020) is lifted for the G10 course's prompts only.** They refer to "this book" and its pages. The Prep-3 and other National prompts stay byte-identical. (Spec Q3, option A.) | FR-4205, FR-4206; ADR-0020 note |
| 11 | **Every chapter gets widget questions.** Any new widget kind is listed for Samuel's OK before it is built. | FR-4306 |
| 12 | **Objectives are derived from the book**, which has no objectives box. Each objective has at least two kinds of evidence. Record this in an ADR-0005 amendment and the pipeline docs, **not as an FR**. | ADR-0005 amendment; `docs/specs/extraction-pipeline.md` §3.4 |
| 13 | ~~**Solutions.** Steps are derived to the printed answer and then re-solved blind. Siyavula's public Teacher's Guide is used where it has worked solutions.~~ **Amended 2026-09-25 by #19**: the EPUB carries a worked solution for every one of the 2,531 exercise items. Those are the canonical solutions, and each is re-solved blind. The re-solve must agree with the printed answer **and** with the EPUB solution. The Teacher's Guide is used only where it adds something. | FR-4302; ADR-0005 amendment |
| 14 | ~~**Answers the app cannot mark yet** are converted to multiple choice where that is natural. The rest stay as worked examples. Expression grading is a follow-up.~~ **Amended 2026-09-25 by #20**: a maths-expression marker is built in this cycle. Multiple choice is used only where it is natural. Items with no markable answer (proofs, sketches) stay as worked examples. | FR-4303, FR-4320; ADR-0005 amendment |
| 15 | **Notation.** Decimal commas and `(x; y)` are normalised to the app's style. The book's word-problem contexts (for example the Rand) are kept as printed. | FR-4308; ADR-0005 amendment |
| 16 | **Generated question families are a declarative spec that can be regenerated** (pipeline option A). | FR-4304; ADR-0005 amendment |
| 17 | **The production load is a separate, manually started "Load a course" GitHub action.** It takes a backup first, only adds rows, can be re-run, and is never part of a deploy. `refresh-content` is fixed to point at noor. | FR-4208, FR-4210; ADR-0024 |

## Second round — Samuel, 2026-09-25: *"ok for all"*

| # | Decision | Recorded in |
|---|---|---|
| 18 | **Book-section grouping.** Samuel: *"need good taging and understanding that it is like that, so when we recommend or suggest scoring etc... we consider them very related"*. The rules:<ul><li>Every lesson carries its book provenance as data: a split part carries its section and "part n of m"; a merged lesson carries every section it covers; a promoted introduction is tagged as the chapter introduction.</li><li>Parts of one section are taught consecutively.</li><li>Recommendations and the next-lesson logic treat the section as one unit, and never move a student past it until every part passes.</li><li>Each part is scored on its own objectives. The section gets a roll-up ("2 of 3 parts mastered") and is mastered only when every part is.</li><li>The skill map shows the parts as one group.</li><li>Noor's Ask context treats sibling parts as closely related.</li><li>Automatic part n−1 → part n prerequisites are added alongside the book's own.</li><li>Students always see the printed section number.</li><li>The console reports per lesson and per section.</li><li>This holds for **every curriculum**, not only G10.</li></ul> | FR-4311…FR-4319; ADR-0020 note |
| 19 | **Canonical solutions come from the EPUB** (amends #13). The EPUB's worked solutions for all 2,531 items are the canonical solutions, re-solved independently: a blind re-solve must agree with the printed answer and with the EPUB solution. New provenance: `book_worked_epub` (an EPUB worked solution that is not in the PDF). The Teacher's Guide is used only where it adds something. | FR-4302; ADR-0005 amendment; pipeline §3.6 |
| 20 | **A maths-expression marker is built in this cycle** (amends #14). Today 54% of exercise items cannot be marked, and 1,111 have maths-expression answers. Typed answers are marked by mathematical equivalence — algebraic expressions, equations, intervals, coordinates — with #15's normalisation. Multiple choice is used only where it is natural. | FR-4320, FR-4303 |
| 21 | **Maths-image transcription (S0b).** The EPUB's maths is 8,561 unique equation images, each named by the MD5 of its LaTeX. Two independent vision passes; a transcription is accepted on a hash match or on agreement, and cross-checked against the PDF text layer. The source-adapter design and the edition-check rules change: build markers plus section and media codes, not the version string or every shortcode. Teacher notes are dropped at S2. The revised one-time cost is about **$210–230**. | FR-4407, FR-4408; pipeline §3.3, §5 |
| 22 | **The misconception catalogue (B19)**, as recommended:<ul><li>the loaded JSON (`seed/generated/misconceptions.json`) becomes the single source, and the Python generator is retired;</li><li>the 6 missing `t2u3-1-2` entries go live;</li><li>the export keeps `kind` and aliases;</li><li>`seed/misconceptions-math.json` is deleted;</li><li>live ids are never renamed.</li></ul>It touches Prep-3 content, so it goes through tests and the CI proof. | FR-4409; pipeline §3.8, B19 |

**Confirmed in the same answer (2026-09-25)**:
- **A**: with the gate switched off, curriculum scoping stays on (FR-4015). **Confirmed.**
- **Privacy review F5**: option **(b)**, anonymous analytics stay unconfigured until the cohort is
  larger. **Confirmed.**
- **Spec Open question 3**, the Ask book-list line for National students who see fewer than all loaded
  courses: **acknowledged.**
- B, C, D and E are confirmed with them. The answer was "ok for all".

## Third round — Samuel, 2026-09-25, one-by-one

**Source.** Samuel answered thirteen questions one at a time, relayed by the coordinating session and
recorded verbatim in the session scratchpad
(`/private/tmp/claude-501/-Users-samueltoma-Documents-Claude-Projects-AI-Enthusiasts-PoC-Tutor-School-V1/5dd6b4ce-c4c4-4eab-b8f8-5465c092db24/scratchpad/g10/samuel-answers.md`).
**Answer 1** (hotfix v0.9.3, "Full fix + deploy (Recommended)", including the sign-flipped note
sentence — ADR-0020's fourth exception) **already shipped**; see `docs/PROJECT_STATE.md`'s v0.9.3
section. It is referenced here, not repeated as a new decision. Answers 2–13 are decisions 23–34
below.

| # | Decision | Recorded in |
|---|---|---|
| 23 | **T413 gate: build the expression marker in-house.** *"Build our own (Recommended)."* No third-party library; the built-in engine (exact BigInt rationals + seeded float64 sampling) is the marking engine, behind a `mark(answer, spec, engine)` seam so a symbolic engine (evaluated: CortexJS Compute Engine) can be plugged in later without a rewrite. Evidence: `marker-evaluation.md` — the built-in engine scores 100% on 8,620 labelled cases at 0.03 ms p50/0.13 ms p95, adds 10.6 KB gzipped and no dependency; Compute Engine ties on correctness but is ~7× slower at p95 and adds ~940 KB gzipped from a 0.x package. | [ADR-0025](../../docs/decisions/0025-answer-marker-build-in-house.md); gate record (T413) |
| 24 | **The marking rules are confirmed as recommended**, plus the marker's other behaviours from `marker-evaluation.md` §6: the required form is enforced and told to the student; unreadable input is returned for re-entry, never marked wrong; an item with no printed answer is checked against the EPUB solution alone and listed at G2. `1/2x` is ambiguous and is always unreadable, never guessed. A decimal answer to a question with an exact-value key (surd, π) is `wrong_form: exact`, not `incorrect`. A fraction answered for a recurring-decimal key is accepted as equal — **except** the 8 items that ask "write as a decimal", which require a decimal and refuse the fraction as the wrong form. An answer of the wrong shape (a number for an interval question, an expression for "find the equation of the line") is returned for re-entry, never marked wrong. | FR-4320 (amended) |
| 25 | **The pipeline finds Grade 10's prerequisite links in the book.** *"Yes, find them (Recommended)"* — a new stage: each candidate link is evidence-backed (quoted from the book, not inferred from outside knowledge), checked by a second, independent AI, and approved by Samuel together with each chapter's objectives, at gate **G1**. This is about prerequisite *links* between objectives, not an objectives-finding methodology question, so — unlike decision 12 — it is written as a requirement. | new FR-4410; pipeline doc §3.4 (S1) |
| 26 | **Figures no existing figure kind can draw get native widget/figure types**, not a static book image. *"You should create widgets for those"* — build native renderers for geometry diagrams, trigonometry graphs and 3-D solids, the same way a question gets a widget. This changes S4's assumption that an unmatched figure is only recorded in `viz-gaps.json`: it is now recorded **and** queued for a native type, with a figure-gap inventory (kind needed, and how many figures of that kind, by size) put to Samuel before any is built — the same gate decision 11 already set for widget *questions*. | new FR-4321 |
| 27 | **All six proposed new widget kinds are approved**: shape builder, extended curve sketcher, Venn diagram, box-plot builder, algebra tiles, 3-D solid scaler. *"All six (Recommended)."* This is Samuel's policy approval of the **kinds**; each is still built only for the chapters the S7 widget-gap list actually names (T355–T357), under the published design system. | FR-4306 (amended) |
| 28 | **Constitution v3.3.0 → v3.4.0: approved.** *"Yes, update it (Recommended)."* Applies `constitution-amendment-proposal.md`'s text verbatim, with the Sync Impact Report in the existing header format. This is the explicit word T389 was waiting for. | `.specify/memory/constitution.md`; `constitution-amendment-proposal.md` marked applied |
| 29 | **"Load a course" gains a restore mode.** *"Yes, add restore (Recommended)."* Alongside the existing add-only load mode, the same GitHub Action gets a `restore` mode that replays a previously exported, reviewed bundle (`--restore`, keeping every row's own status and review stamp — the same semantics `export_generated_content.py`'s bundles already carry), gated by a **typed confirmation** (the course id), the same backup-first, verified-readback discipline as the load mode, and never touching a course's rows if the restore target's provenance does not match. | FR-4208, FR-4210 (amended) |
| 30 | **The American track's prompts are English-only.** *"English only (Recommended)"* — no Egyptian-Arabic phrases or colloquialisms in the G10 course's prompts, but the address term **"Egyptian student" is kept**, because the audience is still an Egyptian student following an American-curriculum book. This is a per-course setting (an "Arabic touches" flag on `CourseDef`): on for the National courses (unchanged), off for G10. | FR-4205 (amended) |
| 31 | **Misconception verification runs per objective (S5).** *"Per topic (Recommended)."* The option carried "~$22–32", which this record first wrote as "~$22–32 **per objective**" — a **mislabel** (corrected 2026-09-26): $22–32 was the planning estimate for S5 across the **whole book** (the per-lesson S5 figure × 65 lessons, inside the book total of $220–260). The Chapter 8 pilot measures S5 at **≈ $0.70 per objective** (draft + final, calibrated from the pilot's real/dry ratio ×5.5–6.3), ≈ $9 for the chapter's 13 objectives and ≈ $120 projected for the book (≈ 170 objectives). The decision itself — per objective — is unchanged. | pipeline doc §3.8 (S5), §5 (cost); `docs/WIP-g10-pilot/pilot-report.md` (projection) |
| 32 | **A third independent reading decides an EPUB-only formula image**, instead of holding it, when two independent readings disagree. *"Add a third reading."* An image found only in an EPUB solution, with no printed-page counterpart, is accepted on a hash match, on two agreeing readings, or on the third reading breaking a tie between the first two — never guessed. | FR-4407 (amended); pipeline doc §3.3 (S0b) |
| 33 | **A second, independent mapper checks the mapping of the 1,228 chapter-end exercises to objectives.** *"Yes, double-check (Recommended)."* This is S1's design (the objective-to-exercise map, spec.md §3.4 rule 2): a second blind mapper produces its own item→objective assignment, and disagreements are surfaced at gate **G1** alongside the objectives themselves, rather than trusting a single mapper's assignment for items no lesson directly contains. | pipeline doc §3.4 (S1) |
| 34 | **Arabic lessons use the book's real printed names.** *"Use the book's names (Recommended)"* — where a National Arabic lesson's working title differs from the book's own printed section name, the printed name is used. This changes what a small number of Arabic lesson titles say, and therefore what reaches the tutor's prompts for those lessons: a fifth, narrow exception to ADR-0020's prompt hold. | ADR-0020 (fifth exception) |

## Fourth round — Samuel, 2026-09-26, the Chapter 8 pilot

Relayed by the coordinating session and logged verbatim in the same scratchpad file as the third round
(`g10/samuel-answers.md`). Answer N of that log is decision N + 21 here.

| # | Decision | Recorded in |
|---|---|---|
| 35 | **Answer 14: run the Chapter 8 pilot.** *"go for the chapter 8 pilot when ready"* — after the pipeline dry run passes; G1 (objectives) comes back to Samuel as a question; load to a scratch database only; measure both S0b settings. | the pilot's run records (`services/extraction/runs/g10-math/`) |
| 36 | **Answer 15: end-of-chapter items that fit no objective → "Both"** (the pilot's S1 run, where both blind mappers placed Ex8-6:28a, 32e, 40c and 46d nowhere). **(c)** The objective finders also read the end-of-chapter items in scope for their lesson, each in its own reading order, so a skill practised only there gets its own objective; they may cite such an item as exercise evidence but never list it (the two blind mappers still place every end-of-chapter item), and rule 1 is unchanged for such an objective. **(b)** A new G1 verdict, "outside this chapter's objectives", per distributed item, with who, when and why: the item is kept out of practice, never dropped silently, and listed in the coverage audit as a named exception; rule 2 is relaxed only under that verdict. Pipeline policy, like decision 12: objectives are not written as requirements. | pipeline doc §3.4 (S1), §3.11 (S8); FR-4303 (amended: an item's fate) |

## Fifth round — Samuel, 2026-09-26, the curriculum-isolation audit

Samuel's standing requirement: each curriculum and each grade stays isolated during teaching. The audit's
questions were relayed by the coordinating session and his answers logged with the rounds above
(`docs/WIP-g10-pilot/samuel-answers.md`, answers 16 and 17). Answer N of that log is decision N + 21
here, as before. Two of the audit's questions were not Samuel's to answer here: the loader's refusal of a
cross-course prerequisite stays under FR-4006 (the orchestrator's call, no new requirement), and the
student-facing wording the fix introduced goes to product-designer later, left as written.

| # | Decision | Recorded in |
|---|---|---|
| 37 | **Answer 16: an open conversation reads the new scope on its next turn.** *"Next turn (Recommended)"* — when an operator changes a student's curriculum, grants or revokes an exception, or changes a rule for her grade, a chat already open is rebuilt under the new scope on its next turn; a lesson whose course she may no longer see is refused like any hidden course. The session snapshot is keyed by the student's scope (`lib/session-cache.ts` `scopeFingerprint`). This replaces FR-4011's last sentence ("keeps its session snapshot until it ends") and the matching edge case. | FR-4011 (amended); spec.md edge cases |
| 38 | **Answer 17: allow the handoff difference, and strip the card too.** *"Allow (Recommended)"* — for a student who cannot see a subject, the lesson prompt's cross-subject line offers no handoff to it and a curated connection into a course she cannot see is not given to the tutor. This is a National prompt change for such students only (every student who sees the courses involved keeps a byte-identical prompt), recorded as **ADR-0020's seventh exception** and beside the Ask book-list line in FR-4206. And, as defence in depth, **any `{{switch_subject:…}}` card to a subject she may not open is removed from the reply on the server** before it reaches her, and from the ledger's copy (`lib/handoff-filter.ts`, `/api/ask`). | FR-4206 (amended); ADR-0020 (seventh exception); FR-4006 |

## Sixth round — Samuel, 2026-09-26, gate G2 for Chapter 8

Samuel reviewed the book questions of the Chapter 8 pilot (the G2 dossier `services/extraction/runs/g10-math/g2-ch08.review.html`
with its recommendations) and answered one topic at a time; the coordinating session relayed the questions and logged his
answers (`docs/WIP-g10-pilot/samuel-answers.md`, answers 18–25; answer 25 extends decision 45). Answer N is decision N + 21, as before. His verdicts are
`services/extraction/runs/g10-math/g2.json` (by Samuel Toma); the gate is recorded below (T354, G2).

| # | Decision | Recorded in |
|---|---|---|
| 39 | **Answer 18: the 60 routine items as recommended.** *"Approve (Recommended)"* — every item whose recommendation was not marked "your call": 34 accepted, 24 fixed (book errors corrected where the independent re-solve is right — Ex8-6:5, Ex8-6:30a, the Worked example 8 misprint on p.303, the Ex8-6:40 stem's P(−1;1) for P(1;−1) and others; our typing and part-numbering fixes), and Ex8-4:1c and Ex8-4:14 excluded (book errors whose whole solution would need rewriting). | `runs/g10-math/g2.json`; FR-4302 |
| 40 | **Answer 19: several points in one answer → teaching only.** *"Teaching only"* — Ex8-1:2, Ex8-6:1 and Ex8-6:39b are worked examples (not markable), never marked questions: the app's marker reads one coordinate pair per key. | `runs/g10-math/g2.json`; FR-4303 |
| 41 | **Answer 20: more than one true shape name → the most specific answer is the key.** *"Most specific only (Recommended)"* — Ex8-6:36b (square), Ex8-6:42e (square) and Ex8-6:21c (isosceles trapezium) stay marked choice questions; every OTHER option that is also true (a square is a rhombus, a rectangle and — in this book — a kite; an isosceles trapezium is a trapezium) is listed in `choices.less_specific`, and the app returns such a pick for re-entry ("true, but be more precise"), never marks it wrong. This extends FR-4320's re-entry rule to a less specific true option; no new FR. | `contracts/pipeline-handoff.md`; `schemas.McqChoices`; FR-4320 |
| 42 | **Answer 21: "give reasons" questions → mark the name, discuss the reasons.** *"Mark the name, discuss reasons (Recommended)"* — Ex8-6:19d and Ex8-6:22e are marked as choices on the shape's name; the book's reasons stay in the stored solution, which the tutor teaches from. | `runs/g10-math/g2.json`; FR-4303 |
| 43 | **Answer 22: three one-offs, decided individually.** Ex8-6:24a → *"Mark answer only"*: a marked question, key √34 (printed answer = blind re-solve), carrying `choices.answer_only: true` — the book has no working, so the tutor gives no step-by-step explanation, and the item's solution stays as the book has it. Ex8-6:33a → *"Keep as printed"* (answer "no value of k"). Ex8-5:5 → *"Exclude now and let us review in details later"*: excluded pending a detailed review, an open item (integration backlog 75). | `contracts/pipeline-handoff.md`; `schemas.MarkerChoices`; FR-4302, FR-4320 |
| 44 | **Answer 23: Ex8-6:36b gets one line of solution.** *"Add one line (Recommended)"* — its key is "square" (decision 41), but the book's solution proves only MP ⊥ LN and concludes "rhombus", so the grounded tutor would have taught "rhombus" for a "square" key. One line is appended to the stored solution — *"LM ⊥ MN and all four sides are √26, so LMNP is a square."* — a correction Samuel approved, recorded on the G2 fix; the rest of the book's working is unchanged. | `runs/g10-math/g2.json` (`g10m8s3-2:Ex8-6:36b`); FR-4302 |
| 45 | **Answer 24: two typos in the book's working are corrected.** The S5 draft's author refused to build on them, and the three-way check could not see them (it compares final answers only). Ex8-6:32d: "Substitute A(−2; 2)" → "Substitute A(−1; 7)" (the stem's A); Ex8-6:45a: "9 − 5" → "9 − 4". Each is a correction Samuel approved, recorded on its G2 fix; the rest of the working is unchanged. **Answer 25** (same decision): the Ex8-6:32d typo was carried into the next line too — "(2) = −(−1) + c" → "(7) = −(−1) + c" (7 = 1 + c gives the book's c = 6) — corrected the same way; the working is now consistent with A(−1; 7). | `runs/g10-math/g2.json` (`g10m8s3-2:Ex8-6:32d`, `g10m8s3-2:Ex8-6:45a`); FR-4302; pilot report, backlog 78 |

## Seventh round — Samuel, 2026-09-26, the S7 widget verifier (Chapter 8 pilot)

Relayed by the coordinating session and logged as answer 26 in `docs/WIP-g10-pilot/samuel-answers.md`
(answer N is decision N + 21; 46 is not used — answer 25 extended decision 45).

| # | Decision | Recorded in |
|---|---|---|
| 47 | **Answer 26: widget mappings the blind checker refused → "Keep them, and let's human review."** The verifier (`wf_dbca7b50-327`) found all 25 Chapter 8 widgets answerable and read correctly, confirmed 20 predicate → misconception claims and refused 23; the all-or-nothing rule would have shipped no widget. Now all 7 templates ship; a refused claim is **held** (`choices.pending_review`, with the verifier's reason) — never shown to a student, never a diagnosis, never S5 evidence — until a human keeps it (it becomes active) or drops it (deleted). A widget whose every claim is held ships as a plain right/wrong widget. The human review is part of gate G3 (`render_review_page.py --gate g3-mappings`; its export is `--mapping-review`). An unreachable target, a stem that reads otherwise or a missing verdict still refuses the template. | FR-4306 (amended); `generate_widget_questions.py` (`verdict_scan`, `hold_pending`); `widget_spec.validate_widget`; `assemble_misconceptions.py --bundle`; runbook README (S7, G3) |

## Adopted under "all recommendations", not in the relayed list

*All five confirmed 2026-09-25 ("ok for all"), above.*

These were recommendations in the documents Samuel accepted wholesale, but the relayed list does
not name them. Each is written into the spec or plan as adopted and flagged here, so that Samuel
can reverse any of them cheaply before build.

| # | Recommendation | Source | Recorded in |
|---|---|---|---|
| A | **The kill switch suspends operator rules, not curriculum scoping.** With `AINEXT_COURSE_GATING` off, a student still sees only her own curriculum's courses. This amends FR-2709's "absent means ungated". | research.md §4 D3, Q2 | FR-4015; ADR-0024 |
| B | **One numbered section of the book is one lesson.** A section too long for one sitting is split along its own sub-headings at the manifest gate (G0). | extraction-pipeline §10 D2 (a) | FR-4301; ADR-0005 amendment |
| C | **The pipeline stays on Claude Workflow**, with a cost meter (`meter_run.py`). | extraction-pipeline §10 D9 (a) | ADR-0005 amendment |
| D | **A curriculum is never sent to the anonymous analytics stream**, and never shown to another student. | research.md §6.1 | FR-4016 |
| E | **Registries in app code**: subjects keep the teaching contract; a new course registry holds book, curriculum and grades; a curriculum registry holds ids and labels; the graph carries a `program:` node per curriculum as an echo. | research.md §4 D1 | ADR-0024; plan A1 |

## Out of scope, by instruction

- **Licensing, credit and attribution** of the source book. Samuel's team handles these outside
  the app. The pipeline document's §10 D10 flag is routed to them, and nothing in this feature
  depends on the answer.
- **Requirements about learning objectives or teaching methodology.** Decision 12 is recorded as
  pipeline policy (ADR-0005), not as an FR.

## Gate record

Every ⛔ HUMAN GATE in [tasks.md](./tasks.md) is recorded here when it is passed. Each entry gives
the date, who passed it, what they saw, and the decision, in their own words where possible. An
empty table means no gate has been passed yet.

| Task | Gate | Date | Who | Decision |
|---|---|---|---|---|
| T301 | Confirmations: decisions.md A–E; privacy review F5 → (b) | 2026-09-25 | Samuel | *"ok for all"*: A (the kill switch keeps curriculum scoping) confirmed; F5 option (b) confirmed; B–E confirmed. Spec Open question 3 (the Ask book-list line) acknowledged. |
| T352 | **G0** — manifest, lesson split, offset regime, edition verdict (`services/extraction/manifest/g10-math-american.json`, `runbook/g10-s0-report.md`) | 2026-09-25 | Samuel | **Passed, 65 lessons.** The following apply from report §3.5:<ul><li>splits **P1a** 1.7 Factorisation → 3 parts;</li><li>**P1b** 6.6 Trigonometric functions → 3;</li><li>**P1c** 8.3 Gradient of a line → 2;</li><li>**P1d** 13.2 Right prisms and cylinders → 2;</li><li>**P1e** 13.3 Right pyramids, cones and spheres → 2;</li><li>promotions **P2a** (6.1 → `g10m6s1-1`) and **P2b** (7.1 → `g10m7s1-1`);</li><li>merges **P3a** (1.2 into 1.3) and **P3b** (5.2 + 5.3 + 5.4).</li></ul>The optional merges **P3c** (14.4 + 14.5) and **P3d** (14.6 + 14.7) are **not** applied. The offset is `printed = PDF − 11`. The edition verdict is same content, different packaging, with no PDF-only fallback. |
| T413 | **The expression marker's library or approach**, evaluated in `marker-evaluation.md` against 8,620 labelled cases built from the book's own printed answers | 2026-09-25 | Samuel | *"Build our own (Recommended)."* No third-party library. The built-in engine (§1, §3 of `marker-evaluation.md`) is used; `mark(answer, spec, engine)` keeps the engine pluggable for later. Recorded as [ADR-0025](../../docs/decisions/0025-answer-marker-build-in-house.md). See decision 23 above for the marking-rules detail (decision 24). |
| T354 / T359 | **G1, Chapter 8 (Analytical geometry), pilot** — `objectives/g10-math/ch08.review.html` from S1 run `wf_a70b525d-f44` (prompts `s1-v5`): 13 objectives in 5 lessons, all 13 agreed by both blind finders, 54 evidence items kept, 2 dropped; 132 end-of-chapter items distributed by two blind mappers; 1 prerequisite link (distance → points on a line) confirmed by the independent checker; 25 decisions owed | 2026-09-26 | Samuel | *"Approve as recommended."* Verdicts file `services/extraction/runs/g10-math/objectives/g1-ch08.verdicts.json`:<ul><li>11 end-of-chapter items placed (the four "what type of quadrilateral" items, 26 and 37d → parallel & perpendicular lines; 24d, 28b → mid-point; 29b, 40a → equation of a line; 29c → unknown end point);</li><li>3 ruled **outside this chapter's objectives** (answer 15): 28a (parallelogram-property recall), 32e (triangle area), 46d (ratio of triangle areas);</li><li>all 11 terminology flags kept as the book writes them;</li><li>the one link kept.</li></ul>G1 only; G2–G5 for the pilot are still to come. Also noted for G2: the book misprints Worked example 8, §8.3, p.303 (m<sub>AC</sub> denominator printed "3−3"), confirmed by two independent readings at S0b. |
| T354 | **G2, Chapter 8 (Analytical geometry), pilot** — `services/extraction/runs/g10-math/g2-ch08.review.html` from the five final lesson runs (`lesson-v4`, `collect-4`; 201 book items: 144 agreed three ways, 20 disputed, 37 with no printed answer), with a recommendation per item (`g2-ch08.recommended.json`, 71 items, 11 marked "your call") | 2026-09-26 | Samuel | Decisions 39–45 (answers 18–24). Verdicts file `services/extraction/runs/g10-math/g2.json` (by Samuel Toma):<ul><li>the 60 routine items as recommended: 34 accept, 24 fix (book errors corrected, typing and part numbering), Ex8-4:1c and Ex8-4:14 excluded;</li><li>Ex8-1:2, Ex8-6:1, Ex8-6:39b → teaching only (several points in one answer);</li><li>Ex8-6:36b, 42e, 21c → most specific answer is the key, other true options in <code>choices.less_specific</code> (re-entry, never wrong);</li><li>Ex8-6:19d, 22e → mark the name, the reasons stay in the solution;</li><li>Ex8-6:24a → marked on its answer only (<code>choices.answer_only</code>, no step-by-step explanation); Ex8-6:33a → kept as printed; Ex8-5:5 → excluded pending a detailed review (integration backlog 75).</li></ul>Split and checked: 158 marked questions, 40 worked examples, 3 excluded, 0 held; <code>assemble_lesson_bundle.py --chapter 8 --check</code> valid, the app's marker reads all 97 keys. Ex8-6:36b's solution gained one line Samuel approved so that it proves "square" (answer 23 → decision 44). Typos in the book's working corrected with his approval (answers 24–25 → decision 45: Ex8-6:32d, two lines; Ex8-6:45a). G3–G5 for the pilot are still to come. |


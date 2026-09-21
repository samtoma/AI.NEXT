# Changelog

All notable changes to the **`PDR1-0`** solution (Student MVP). The frozen
baseline `family-tutor` has its own history and is not tracked here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
scheme is described in [docs/VERSIONING.md](docs/VERSIONING.md). Entries are
written for someone who does not know the codebase, and every line that closes a
requirement names it.

## [Unreleased]

Feature 002 — identity, per-student isolation and the admin console — built in seven
phases on `feat/002-identity-and-admin-console`. **Not merged, not tagged, not
deployed.** `app/package.json` is deliberately not bumped: the release is Samuel's
(VERSIONING.md step 3).

Until this ships, "which student is using the product" was answered by a dropdown.
That is the thing that changes.

### Added

- **Real accounts, and the end of the picker.** A student signs up with an email
  address and a password, confirms the address, and signs in. Before this there was
  a menu of demo students and anyone could pick any of them; there was no such thing
  as *your* data. Sign-up asks for name, grade, and optionally how the tutor should
  address her and what she is interested in. Sessions are two cookies no page script
  can read, the short one expiring in fifteen minutes and the long one rotating on
  every use — and if an old one is ever replayed, every session on that account is
  ended, because a replayed credential means somebody has a copy. Five wrong
  passwords lock the account for fifteen minutes. Reset works by email and says the
  same thing whether or not the address exists. `FR-2001`…`FR-2012`, `FR-2014`.
- **Per-student isolation enforced by the database, not by remembering to filter.**
  Twenty tables now carry row-level security policies, and the application connects
  as a role that cannot bypass them. A query that forgets to say which student it is
  about returns **nothing** rather than everything — which is the opposite of the
  usual failure, and the point. Asking for another student's record answers "not
  found", byte for byte identical to asking for a record that was never there.
  `FR-2101`…`FR-2109`.
- **An admin console, as a separate build of the same codebase.** The pipeline, the
  content review queue, the gallery and the dev harnesses no longer live in the
  student's app at all — they are compiled into a second build that runs on its own
  port. Four roles decide who sees what: content review, evidence access, student
  data, cost and billing. An operator holding only one of them is refused the rest,
  and the refusal is recorded. `FR-2201`…`FR-2211`.
- **A real record of what a learning session was.** The `sessions` table had existed
  for months and had never held a single row, so a tutor turn could only be tied to
  the lesson it belonged to by guessing from timestamps. Sessions now open, close on
  completion or after thirty minutes of silence, and every turn, answer, check and
  upload is attached to one. `FR-2301`, `FR-2302`, `FR-2309`.
- **Student 360, one timeline, and a replay.** An operator can open a student's
  record and see the whole of it in one place — mastery over time, attempts, time on
  task, help-seeking, misconceptions, cost — and then open any past session as a
  single ordered story: what the tutor said, what she answered, which widgets she
  used, when the mastery moved. A replay renders it in the student's own screens,
  made read-only, labelled "Reconstructed from stored records" and stamped with the
  version that drew it, so a replay that no longer matches what she actually saw can
  be recognised rather than believed. `FR-2303`…`FR-2305`.
- **Every operator read of a student's record is logged**, with who and when, shown
  to the next operator who opens that record. Operators can add to that log and
  cannot remove from it. `FR-2306`.
- **Cost per student, over time, honestly labelled.** AI spend and photo/OCR spend
  are reported as two figures and never blended; per-student figures reconcile
  against the period total and say so on the page; every number says "imputed at
  list price" because that is what it is. `FR-2401`…`FR-2403`, `FR-2407`.
- **Subscription status per student — a record, never a gate.** Only the cost and
  billing role can set it, every change records who and when, and a test scans the
  student-facing screens to prove nothing there reads it. No student is ever shown a
  door that is locked. `FR-2404`…`FR-2406`.
- **A security view, and alerts.** Sign-ins and failures over time, accounts locked
  right now and why, top source addresses, live sessions, refusals by operator, and
  a cross-student-access counter whose acceptable value is zero. A sweep evaluates
  four alert rules plus a fifth that only ever reports. `FR-2502`.
- **Cohort overviews and a dictionary.** How a subject and grade are doing by
  school-year week, an objective-by-week heatmap that shows "never reached"
  differently from "reached and failing", and a definitions page every query cites by
  name — so two people reading the same number mean the same thing by it.
  `FR-2507`.
- **The tutor addresses each student correctly.** She says how she would like to be
  spoken to at sign-up, or declines; the tutor's language follows on the next turn,
  with no sign-out. `FR-2601`…`FR-2603`, `FR-2606`.

### Fixed

- **The tutor assumed every student was a boy.** Not as a default that could be
  changed — there was no setting. Close to a hundred masculine forms across the
  lesson, chat, check-in, widget-documentation and grader prompts (63 in the lesson
  prompt alone, and three files nobody had counted), and the text that read as
  "neutral" was simply the
  masculine register, served to girls. All of it now comes from one place, with a
  form that is correct for either when she has not said. `FR-2605`.
- **All fourteen interactive widgets told the tutor the student was called "Omar"** —
  the name of a retired demo student — whichever student was actually using them, and
  one of them used a masculine pronoun.
- **Every photo/OCR row in the cost ledger had been written as zero**, so the upload
  figure we report separately was structurally zero and always had been. It reads the
  parser's real usage now.
- **Turns killed by the content guard also cost nothing, on paper.** They cost real
  money; the guard just stops the process before the cost is written down. They are
  priced at list price now and marked redacted, and a failed or redacted turn no
  longer eats into a student's turn allowance.
- **The input-token count included the cache counters**, which over-stated it
  everywhere it appeared.
- **A finished session could be recorded as having ended before it began**, when the
  inactivity timeout stamped it with the last time it was seen.
- **The tool that proves a prompt did not change had been broken**, so every change
  for weeks could only report that it "fails the same way it did before". It works
  again, and now covers two prompts it had never been able to reach.

### Security

- **The application had been connecting to the database as a superuser**, in both
  places it runs. A superuser ignores row-level security completely, so the whole
  isolation scheme would have been decoration. It now connects as an ordinary role
  that the policies actually apply to, and the proof is run as that role — run as a
  superuser it passes for the wrong reason.
- **The console accepted a student's credential**, because browsers share cookies
  across ports on localhost. Each surface now has its own cookie names, and a token
  from the wrong surface is refused, recorded, and left untouched rather than
  destroyed.
- **Two places leaked other students' data and are gone**: an endpoint that returned
  every student's name, grade and interests to anyone who asked, and a panel on the
  pipeline page that displayed the most recent tutor conversation written by *any*
  student.
- **Operator passwords are never written into a configuration file.** The first
  operator is created without one and obtains it through the ordinary reset flow,
  and reset links are built from a configured address rather than from whatever host
  the request claimed to be for.

### Known gaps

- **Nothing here is deployed.** The console has no hostname and no Cloudflare Access
  policy yet.
- **Google sign-in is built and switched off**, and **no email has ever actually been
  sent** — both wait on credentials. Locally, every link is written to a folder.
- **Analytics is built and inert**: with no measurement id configured, no script
  loads on any screen.
- **A student cannot yet edit her own profile, or see where she is signed in** — the
  endpoints exist, the screens do not.
- **There is no way to delete an account**, and the retention decision that would say
  what "delete" means has not been made.
- **The Arabic prompts still carry masculine forms outside direct address.** Out of
  scope for a maths-only build, and named so it is not forgotten.
- Full status, row by row, with what proves each one:
  `specs/002-identity-and-admin-console/traceability.md`.

## [PDR1-0-v0.4.0] — 2026-09-20

The fix pass. Ten of the 27 issues still open after v0.3.0 are closed with code;
the other fifteen carry a written answer. Two pieces of this release have **no
requirement covering them** — see *Governance* below.

**Prepared, not deployed**, same as v0.3.0.

### Fixed

- **The lesson showed a student her mastery as a percentage after every answer**
  ([#17](https://github.com/samtoma/AI.NEXT/issues/17)). Replayed through the
  real model, the reported `30 → 69 → 30` is reproduced **exactly** and is
  correct: with a 20% guess rate and a 10% slip rate, two answers genuinely move
  the belief that far. The defect was rendering it. `MasteryDelta` printed
  `mastery 30% → 69%` on `/student`, ungated, after every attempt. It now reads
  `attempted → proficient`, or `still attempted` when the band holds.
- **The tutor was being handed the same numbers, and read them out**
  ([#27](https://github.com/samtoma/AI.NEXT/issues/27)). Four places put raw
  P(L) percentages into the prompt — `mastery today 92%` in the objective lines
  is the literal source of "92%, that's excellent". All four now pass the named
  band, with an explicit do-not-quote instruction copied from the engagement
  block, which has had one since `FR-207`.
- **The student build no longer carries the internal tools**
  ([#10](https://github.com/samtoma/AI.NEXT/issues/10),
  [#11](https://github.com/samtoma/AI.NEXT/issues/11),
  [#12](https://github.com/samtoma/AI.NEXT/issues/12)). "Evidence Walk",
  "Content" and "Pipeline" sat beside "Study" in a fourteen-year-old's
  navigation. The tabs are gone and `/pipeline`, `/gallery`, `/admin/*` and
  `/dev/*` return 404, so guessing the URL doesn't work either. `/spine` stays
  reachable — the lesson report sends students there on purpose.
- **The tutor explained the question before asking it**
  ([#33](https://github.com/samtoma/AI.NEXT/issues/33),
  [#34](https://github.com/samtoma/AI.NEXT/issues/34),
  [#35](https://github.com/samtoma/AI.NEXT/issues/35),
  [#24](https://github.com/samtoma/AI.NEXT/issues/24),
  [#23](https://github.com/samtoma/AI.NEXT/issues/23)). Five reports, one cause:
  every tool the protocol gave the tutor for making a student *do* something
  produced a **card**. There was no way to express an open question — in the
  maths and social protocols. The Arabic one has had that instruction all
  along; it was written once and reached one of three subjects.
- **The lesson report had no door back into the work**
  ([#29](https://github.com/samtoma/AI.NEXT/issues/29)). It ends by showing a
  student her gaps and offered two ways out, neither of which addressed them.
  A third goes to the plan loop, which is already built weakest-first.
- **The tutor could drift back to a question the student had moved past**
  ([#22](https://github.com/samtoma/AI.NEXT/issues/22)) — the whole question
  bank is in its context and nothing said which one was current.

### Added

- **`/admin/cost` — what the AI spends, by the function that spent it**
  ([#39](https://github.com/samtoma/AI.NEXT/issues/39)). The instrumentation was
  never missing; nothing read it. Grouped by function, by teaching-versus-upload,
  and per student with a projected month — the only basis a price can be built
  on. Scoped to one environment, because a blended cost figure is a plausible
  wrong number someone would price against.

### Changed

- **The `lesson_learn` turn cap, 14 → 18.** Asking before explaining and ending
  on retrieval cost turns. At 14 a full lesson hit the cap *before* the
  retrieval, so the fix for #34 would have been skipped on exactly the lessons
  that ran long. ~29% more turns on the most expensive surface, deliberately.
- **The lesson ends on retrieval**, as its own message, from memory, before any
  recap. The arc previously read `→ closing recap message`.

### Governance

- **Two shipped things have no requirement.** Access gating and the Socratic
  protocol are both live and neither appears in `spec.md`, so neither can carry
  a traceability row without becoming an orphan CI rejects. Named in §9 of the
  matrix with Samuel as owner rather than papered over with invented FRs.
- **Nothing in the build can judge teaching behaviour.** The Socratic change,
  the Arabic/English mixing in #20 and #22's drift are all assessable only by a
  human reading a transcript. The LLM-judge harness asked for on feedback row
  015 still does not exist, so every teaching change ships unverifiable.
- **The tutor prompts assume the student is male** — 23 masculine pronouns in
  `lib/lesson.ts` alone, and no gender column in `students`. Found in review,
  on nobody's list.

### Known gaps

Fifteen issues remain open with a written answer rather than a fix. The
accounts bundle ([#8](https://github.com/samtoma/AI.NEXT/issues/8)) blocks four
of them, and two more wait on a decision from Samuel:
[#15](https://github.com/samtoma/AI.NEXT/issues/15) (whether `/spine` stays a
student surface at all) and
[#36](https://github.com/samtoma/AI.NEXT/issues/36) (how much grounding a
student should see).

## [PDR1-0-v0.3.0] — 2026-09-20

The first release shaped by someone using the product rather than building it.
Tamer ran the v0.2.0 build as a student would and filed 37 issues; this closes
ten of them, and four requirements that said VERIFIED turned out not to be.

**Prepared, not deployed.** Deploy is manual-only while infrastructure is parked
(`T139`), so tagging this does not put it in front of anyone.

### Fixed

- **A wrong answer could be marked wrong for being right.** Numeric grading used
  `parseFloat`, which reads only the leading digits, so a student who typed the
  working — `3x6` for an answer of 18 — was compared as **3**. Grading now
  evaluates the expression first, with a hand-written parser over a whitelisted
  character set (no `eval`, no model call). Still arithmetic only: `x=5` for `5`
  is not covered (`FR-C03`, [#40](https://github.com/samtoma/AI.NEXT/issues/40)).
- **Tapping "Got it" could skip a question that was never answered.** The server
  was never fooled — that acknowledgement never reaches grading at all. It is
  sent as an ordinary chat turn, and nothing stopped the *model* treating it as
  licence to move on. The chat now works out from the transcript whether a
  pushed question is still unanswered and stops the tap before it reaches the
  network (`FR-1214`, [#31](https://github.com/samtoma/AI.NEXT/issues/31)).
- **The last explanation of a lesson was taken away before it could be read.**
  Three separate timers each jumped to the report 2.2–2.5 seconds after the
  closing recap rendered, with no student action in between. The report is now
  reachable only by tapping Finish (`FR-1218`,
  [#28](https://github.com/samtoma/AI.NEXT/issues/28)).
- **Every learn session opened by telling the student they understood nothing.**
  Two independent copies of that premise — one in the tutor's system prompt, one
  in a hidden message sent as if the student had typed it — fired even for a
  lesson never attempted. Both now key off the same mastery banding the progress
  ramp uses, so a first lesson opens as something new (`FR-1009`,
  [#30](https://github.com/samtoma/AI.NEXT/issues/30)).
- **Arabic was rendering to English-subject students in about thirteen places.**
  The cause was structural: `debug` and mode flags were standing in for a
  language check, so instrumentation state decided which language a child read.
  Language is now its own prop, defaulting to English (`FR-208`,
  [#20](https://github.com/samtoma/AI.NEXT/issues/20),
  [#41](https://github.com/samtoma/AI.NEXT/issues/41)).
- **"brafo", "brofa" and friends** were not a typo anywhere. The maths language
  contract instructed the model to sprinkle transliterated Egyptian-Arabic
  interjections into English replies, and its own inconsistent transliteration
  of برافو is where they came from. The instruction is gone from the English
  maths contract only; the Arabic subject contracts keep theirs
  ([#26](https://github.com/samtoma/AI.NEXT/issues/26)).
- **The tutor talked about the student instead of to them** — fixed in the
  system prompt ([#16](https://github.com/samtoma/AI.NEXT/issues/16)). The
  check-in button that read "I'm lost", with an Arabic gloss beside it in
  English mode, now reads "Walk me through it"
  ([#19](https://github.com/samtoma/AI.NEXT/issues/19)).
- **A widget question printed its own stem twice** — once typeset by the card
  and again as raw LaTeX inside the widget — under a Submit button that could
  never enable, because a widget has nothing to submit (`ADR-0009`). Found in
  review of that fix: hiding the button row took the card's only error surface
  with it, so a failed widget attempt reported nothing at all.
- **The student check-in showed mastery in colour alone.** Taking the percentage
  off the study page ([#42](https://github.com/samtoma/AI.NEXT/issues/42)) took
  every non-colour signal with it. Measured, lit segments sat 1.84:1–2.84:1
  against unlit ones — under the 3:1 floor — and adjacent bands 1.02:1 apart.
  The ramp now carries an ink outline and a named band, and still no number
  (`FR-1003`).
- **Voice is pulled from the lesson UI** ([#21](https://github.com/samtoma/AI.NEXT/issues/21)).
  The backend stays wired and dormant rather than deleted, so bringing it back
  is a flag, not a rebuild.
- **The traceability counts block had never once been generated.** `--write`
  searched for a section heading that does not exist, so the table was
  hand-maintained and had drifted five requirements and eight tasks out of date
  — and the command returned non-zero, which would have failed CI's staleness
  check on any push touching `app/`.

### Changed

- **Noor Play replaces Master as the design system** ([ADR-0011](docs/decisions/0011-noor-play-design-system.md),
  [#38](https://github.com/samtoma/AI.NEXT/issues/38)). Sticker chrome, 52px
  targets, Baloo throughout, seven named animations. The reversal had been
  sitting unconfirmed since 2026-09-16; the reason Master was originally picked
  — avoiding a second variable in a controlled comparison — no longer holds,
  because ADR-0010 withdrew parity and made the comparison observational.
  Additive: blanket radius and border rules mean plain utilities pick up the
  treatment with no component touched, and nothing was removed. The product is
  called **Noor** throughout ([#37](https://github.com/samtoma/AI.NEXT/issues/37)).
- **The tutor reads the student's actual grade** instead of a hardcoded "10".
- `FR-1003` is **clarified, not amended**: it asks for a named band, never for a
  percentage. Dropping the number was always allowed; dropping every non-colour
  signal never was.

### Known gaps

- **The Socratic cluster is untouched** — seven issues
  ([#22](https://github.com/samtoma/AI.NEXT/issues/22),
  [#23](https://github.com/samtoma/AI.NEXT/issues/23),
  [#24](https://github.com/samtoma/AI.NEXT/issues/24),
  [#32](https://github.com/samtoma/AI.NEXT/issues/32),
  [#33](https://github.com/samtoma/AI.NEXT/issues/33),
  [#34](https://github.com/samtoma/AI.NEXT/issues/34),
  [#35](https://github.com/samtoma/AI.NEXT/issues/35)) saying one thing: the
  tutor explains where it should elicit. It is the largest item in the feedback
  and the core bet (`SC-005`), and it is not in this release.
- **The internal surfaces are ungated.** `/pipeline`, `/gallery`, `/spine`,
  `/admin` and `/dev` have no environment check and no auth, and the front page
  links to two of them ([#10](https://github.com/samtoma/AI.NEXT/issues/10),
  [#11](https://github.com/samtoma/AI.NEXT/issues/11),
  [#12](https://github.com/samtoma/AI.NEXT/issues/12)). Cloudflare Access is the
  only thing holding them.
- **The tutor prompts assume the student is male** — 23 masculine pronouns in
  `lib/lesson.ts` alone, more in `lib/ask.ts` and `lib/checkin.ts`, and a
  masculine Arabic example (`يا بطل`) offered to the model. There is no gender
  column in the schema. Not on anyone's list; filed here so it is on one.
- **Durable resume and per-user analytics are blocked**, not deferred
  ([#25](https://github.com/samtoma/AI.NEXT/issues/25)). `students.id` is a
  per-environment identity sequence that a routine content reseed truncates and
  restarts, bound to a cookie the code itself documents as "not an identity
  claim". Both need the accounts work (`FR-106`) first.

## [PDR1-0-v0.2.0] — 2026-09-16

The first version of the Student MVP solution that can be pointed at. Everything
below was in flight without a version number, which made "which build did you see
that on?" unanswerable — the question every piece of feedback has to start with.

### Added
- **The tutor can see how engaged a student is** (`FR-207`). Reads the last 12
  attempts and gives the tutor a stance — returning, rushing, struggling,
  labouring, steady — never a label to repeat back. Silent below 4 observations.
- **Every objective now carries a question at every difficulty tier** (`FR-1109`).
  The last four gaps were word-problem objectives and were authored rather than
  generated, because templating them produces nonsense.
- **Misconceptions for intersection and mutually exclusive events**, six entries
  mined from the book's own distractors (`FR-1111`, still partial: 43 of 90
  objectives covered).
- **A computed traceability matrix.** `scripts/traceability.py` derives the
  requirement state instead of trusting a hand-edited document: a requirement
  exists because a spec defines it, is traced because a row names it, is covered
  because a test declares it (`@covers FR-nnn`). `--check` fails CI when those
  three disagree.
- **CI actually runs the tests.** 123 of them, which had never run in CI —
  including through two edits to the workflow.
- **The eleven success criteria are traced for the first time.** They are the
  measures the pilot is judged on and had never appeared in the matrix.
- Repository governance: four issue templates tied to requirement ids, a
  pull-request template enforcing the requirement→task→proof thread,
  `CODEOWNERS`, `docs/FEEDBACK.md`, `docs/ROADMAP.md`, `docs/VERSIONING.md` and
  this changelog.

### Changed
- **One branch per solution** (ADR-0010). `PDR1-0` and `family-tutor` are separate
  products, not two environments of one. Constitution **v3.0.0** redefines
  Principle XI from "Comparison Integrity" to "Solution Integrity".
- Each solution branch carries its own deploy trigger. Deploy is **manual-only**
  while infrastructure work is parked.

### Removed
- Cross-solution content parity, the frozen-baseline obligation, and `FR-908`.
  The comparison is now an observational judgement from live usage.
- The simultaneous side-by-side demo — the original promise of ADR-0007.

### Fixed
- `FR-904` and `FR-C05` had been deleted from the matrix by a bad edit that
  overwrote the id column with prose. The matrix silently read 87 rows instead of
  89 for three days, and 87 was published as the requirement count. Restored, and
  the CI gate now catches this class of decay.

### Known broken
- **Uploads do not work end to end** (`FR-205`, marked VERIFIED and it should not
  be). No upload UI exists; the unreadable check misses a trailing admission and
  stores commentary as a transcription; `uploadId` never reaches the tutor prompt.
- **Safety is not built** (`FR-601`, `FR-602`). No crisis classification, no
  escalation. **No real student should use this build until that closes.**
- All 100 refutations and 130 generated questions are live and unreviewed.

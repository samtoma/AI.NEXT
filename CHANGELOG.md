# Changelog

All notable changes to the **`PDR1-0`** solution (Student MVP). The frozen
baseline `family-tutor` has its own history and is not tracked here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
scheme is described in [docs/VERSIONING.md](docs/VERSIONING.md). Entries are
written for someone who does not know the codebase, and every line that closes a
requirement names it.

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

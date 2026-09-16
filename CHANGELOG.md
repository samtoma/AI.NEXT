# Changelog

All notable changes to the **`PDR1-0`** solution (Student MVP). The frozen
baseline `family-tutor` has its own history and is not tracked here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
scheme is described in [docs/VERSIONING.md](docs/VERSIONING.md). Entries are
written for someone who does not know the codebase, and every line that closes a
requirement names it.

## [Unreleased]

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

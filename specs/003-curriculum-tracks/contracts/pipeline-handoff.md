# Contract: what the extraction pipeline hands the app for the Grade 10 course

**Owner of the pipeline side**: `services/extraction/**` and `docs/specs/extraction-pipeline.md` (v2).
**Owner of the app side**: `app/src/lib/courses.ts`. This file is the seam: ids and shapes both
sides depend on. A change here changes both sides in the same work.
**Enforces**: FR-4201, FR-4203, FR-4207, FR-4301…FR-4310, FR-4401…FR-4406

## Ids (pinned by this plan; the pipeline config's placeholders take these values)

| Thing | Value | Rule it satisfies |
|---|---|---|
| Book key | `g10-math` | the pipeline's key (manifest `book` field); its config file under `services/extraction/books/` follows the pipeline's own naming |
| Course | `course:us-g10-math-en` | `^course:[a-z0-9-]+$` (`module-order.ts`); encodes the curriculum so a future National G10 maths does not collide |
| Curriculum | `us-american-en` | decision 3 |
| Program node | `program:us-american-en` | the graph echo of the curriculum (ADR-0024) |
| Subject / spine key | `math` | never a new key (migration 007) |
| Grade | `"10"` | `lib/profile.ts` GRADES |
| Lesson slug | `g10m<ch>s<sec>-<part>`, e.g. `g10m6s3-1` | `SLUG_RE` and migration 028's CHECK; unique across courses; does not start `geo` or `t2` |
| Objective | `lo:g10m<ch>s<sec>-<part>-<n>` | the lesson is the LO-id prefix (`lesson-slug.ts`) |
| Module | `module:g10m-cNN` | never `module:geo%` or `module:t2-%` (`TERM_RANK`) |
| Questions | `q:<lo tail>:we03`, `…:ex4-2-3b`, `…:g001-<family>`, `…:w001` | namespaced, so the loader's collision guard passes |
| Misconceptions | `mc:<lo tail>:<slug>` | the shipped convention |
| Visuals | `v:g10m<ch>s<sec>-<part>:<n>` | namespaced |

## Book config fields the app reads (through the registry cross-check test)

`course_id`, `curriculum`, `subject`, `grade`, `language: "en"`, `direction: "ltr"`,
`id_prefixes: ["g10m"]`, `objectives_mode: "derived"`,
`notation: { decimal: "point", pair_separator: "comma" }` (decision 15), `sacred_content: false`.

## S0a's block contract

`source_adapter.py` parses the EPUB into typed blocks (`work/<book>/blocks.jsonl`), one JSON object per
block: `heading`, `para`, `list`, `summary_item`, `definition`, `box`, `table`, `figure`, `media`,
`worked_example` (with its `workstep`s), `exercise_header`, `exercise_item` (the problem plus its EPUB
worked solution), **`teacher_only`** (the teacher's-guide notes S2 drops, FR-4408), and `unparsed` for
anything the adapter could not classify. Maths inside any block is an image reference
(`equation/<md5>.png`) until S0b replaces it with accepted LaTeX. Every `exercise_item` carries its
identity as `(exercise label, question number, sub-part index)` — the EPUB has no per-item shortcode.
`edition-check.json` records the verdict from build markers plus section/media-code set equality (§3.3
step 6 of the pipeline doc) — never a version-string or shortcode match, because the EPUB has neither.

## Run-output paths — the two shapes

A workflow's **raw** return value is saved once, as the whole call produced it:
`runs/<book>/<stage>/<runId>.json` (or, for the lesson conveyor specifically, the **plural**
`runs/<book>/lessons/<runId>.json` — one file, however many lesson slugs that call covered).
`assemble_objectives.py lesson-runs <book> runs/<book>/lessons/<runId>.json` **splits** that file,
validates each lesson against `assemble_lesson_bundle.py`'s own input models, and writes one file per
lesson to the **singular** `runs/<book>/lesson/<slug>.json` — this is what `coverage_report.py` and
`assemble_lesson_bundle.py` actually read (their `--runs` default is `runs/<book>/lesson/`). Getting the
plural/singular distinction backwards is the most likely way to hand an assembler a directory with
nothing in it.

## Bundles and exports

- `services/extraction/seed/g10-math/*.json`: one `SeedBundle` per chapter. Each declares its
  `source_document` (the learner PDF, `grade: "10"`, `language: "en"`, the real title and publisher),
  its modules, lessons (with **lesson titles** from the section headings, FR-4203), objectives,
  claims, book questions and visuals. Each carries `external_node_refs` to the course node and the
  `course part_of program:us-american-en` edge.
- `services/extraction/seed/generated/g10-math/`:
  - `misconceptions.json` (the `load_misconceptions.py` shape, `mc:` ids);
  - `generated-questions.json`;
  - `widget-questions.json`;
  - `families/` (the declarative family specs, decision 16).

  All of these are **exports after review** (`export_generated_content.py --course`, B15), so their
  statuses and review stamps are true.
- `services/extraction/runs/g10-math/<stage>/<runId>.json`: committed run outputs, and `cost.jsonl`.
- `services/extraction/coverage/g10-math.json`: the S8 audit. It is GREEN, or carries signed
  exceptions.

## Lessons, book provenance and answer types (rev. 2, 2026-09-25)

- **65 lessons** for Grade 10, from G0 (splits P1a–e, promotions P2a–b, merges P3a–b; P3c and P3d
  not applied). A split part's slug ends in its part number (`g10m1s7-1`, `-2`, `-3`). A merged
  lesson's slug takes the number of its **`slug_section`** — the section that carries the practice
  (`book_config.py`'s own words: "the one that carries the practice"), not necessarily the first one
  listed: `g10m1s3-1` for the 1.2+1.3 merge takes section 1.3 (which has the exercise, not 1.2), and
  `g10m5s3-1` for the 5.2+5.3+5.4 merge takes section 5.3. The promoted introductions are `g10m6s1-1`
  and `g10m7s1-1`.
- **Every lesson in the bundle carries its book provenance** (FR-4311): `sections` (printed numbers and
  titles), `part: {n, of}` or null, and `chapter_intro`. The loader writes it to the book-sections
  store ([data-model.md](../data-model.md) §2).
- **Every exercise item is typed** for marking (FR-4303, FR-4320): `numeric`, `choice` (only where
  natural), `expression` (with `choices.marker` per [answer-marker.md](./answer-marker.md)), or
  `not_markable`, which becomes a worked example and not a question row.
- **Solution source** per book question: `book_worked`, **`book_worked_epub`**, or `teachers_guide`
  (FR-4302).
- **Maths** in stems, solutions and claims comes from S0b's accepted transcriptions (FR-4407). No
  `teacher_only` block reaches a bundle (FR-4408).

## Status at export (decision 9, ADR-0019 note)

After gate G5 says go:

| Item | Status at export | Reviewer stamp |
|---|---|---|
| Book questions, verified (blind answer = printed answer = EPUB solution's final answer) | `live` | none, unless a human read it at G2 |
| Book questions disputed at G2 | `review` (held) | as recorded |
| Exercises with no printed answer, verified against the EPUB solution and accepted at G2 | `live` if markable, else a worked example | as recorded |
| Maths-expression answers (FR-4320) | `live`, `question_type='short'` with `choices.marker` | none |
| Verbal or choice answers made multiple choice, only where natural (FR-4303) | `live`, `source='authored'`, parent = the book item | none |
| Proofs, sketches, "show that" | teaching material (worked examples), not a question row | — |
| Generated families accepted or unsampled at G3 | `live` | only the sampled-and-accepted items |
| Families rejected at G3 | `retired` | as recorded |
| Widget questions | `live` | as the family's |
| Materialised inline widgets | never `live` (CHECK `questions_materialised_not_live`) | — |

A solution's source is recorded as `book_worked`, `book_worked_epub` or `teachers_guide`
(`answer_anchored` is not expected for Grade 10; [data-model.md](../data-model.md)).

## Notation (decision 15)

At assembly, a decimal comma becomes a point and `(x; y)` becomes `(x, y)` in stems, choices,
answers, solutions and claims. Vocabulary (gradient, surd) and word-problem contexts (the Rand) stay
as printed. The coverage audit counts normalised items so a missed one is visible.

## Widget kinds (decision 11)

S7 writes `coverage/g10-math.widget-gaps.json`: each chapter with no fitting existing kind, and the
kind it would need. **That list goes to Samuel before any new kind is built** (tasks T355/T356). An
approved kind is a frontend build (component + `contracts/widget-predicates.json` entry + validator)
bound by the design system, followed by an S7 re-run for that chapter.

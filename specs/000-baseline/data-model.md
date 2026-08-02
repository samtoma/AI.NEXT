# Data Model — AI.Next Tutor PoC (As-Built)

**Date**: 2026-08-02 · **Source of truth**: `db/schema.sql` + `db/migrations/002..008` (Postgres) and `services/extraction/schemas.py` (ingest contracts). This file is the readable map; the code wins on detail.

## 1. PostgreSQL schema

Base schema `db/schema.sql`; migrations start at 002 (001–006 shipped inside the seed
dump and are not idempotent; **only 007 and 008 are re-runnable** and applied by
`refresh-content.sh apply_migrations`).

### Curriculum (the spine)

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `source_documents` | Book provenance root | `sha256 PK`, title, publisher, language, grade, subject |
| `extraction_runs` | One ingest run | FK `source_sha256`, extractor + versions |
| `graph_nodes` | program/course/module/LO/topic | `id TEXT PK`, `kind` CHECK, label, `source_page`, `subject` (007: courses only — `CHECK (subject IS NULL OR kind='course')`) |
| `graph_edges` | part_of / teaches / prerequisite_of / about / **relates_to** (006) | temporal (`system_from/to`, `valid_from/to`), `rationale` (006, bridges), partial indexes on live edges |
| `questions` | The question bank | `id TEXT PK`, FK `lo_id`, `tier` CHECK, `question_type` CHECK (008: +irab/extract/lexical/rhetoric/spelling_fix), `correct_answer TEXT` (typed Arabic answers = tagged JSON), `canonical_solution JSONB`, `status` CHECK (draft/review/live/rejected/retired), review attribution |
| `visuals` (004) | Stored `{kind, spec}` figures | `id TEXT PK`, FK `lo_id`/`question_id`, kind (validated in code via `VIZ_KINDS`), `spec JSONB` |
| VIEW `node_subject` (006→007) | LO → course → subject resolution | reads `graph_nodes.subject`; `relates_to` deliberately excluded |

### Student state

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `students` | Demo roster (NOT auth) | display_name, grade |
| `attempts` | Append-only answer events | FK student+question, `is_correct`, `time_ms` |
| `mastery` | **Bitemporal** per-LO score | never overwritten: close row (`system_to=now()`) then insert; partial index on current rows |
| `understanding_checks` (003+006+007) | End-of-lesson honest rating | mode/score/verdict CHECKs, strengths/gaps JSONB, `subject` CHECK (math/social/arabic) |
| `explanation_log` | Write-only audit of mistake explanations | FK attempt/question, solution_version, grounded_ok |
| `ai_interactions` (002+005) | The cost ledger — every AI call | surface, turn_index, grounding JSONB, citations, tokens (+cache cols), `cost_usd`, latency |
| `sessions` | **Dead table** — plan assembly moved to request time (`getStudentPlan`); kept as tracked debt | |

### Curated data

- `db/bridges.sql` — the human-curated cross-subject `relates_to` edges (2 today), with
  bilingual rationale; restored by the loader after course-scoped replaces.

### Writers/readers (operational map)

- Loader (`services/extraction/load_seed.py`) writes everything curricular inside one
  transaction (nodes → deferred edges → questions → visuals), stamps course `subject`
  from `COURSE_SUBJECTS`, seeds demo students, and refuses `--approve-all` on sacred
  bundles.
- The app writes only student-state tables: `attempts`+`mastery`+`explanation_log`
  (`/api/attempts`), `understanding_checks` (`/api/understanding`), `ai_interactions`
  (`/api/ask`, `/api/understanding`), `students` (`/api/demo-students`).

## 2. Ingest contracts (`services/extraction/schemas.py`, pydantic v2)

One `SeedBundle` per file in `services/extraction/seed/`:

```
SeedBundle
├─ source_document | source_file, extraction_run, syllabus_version
├─ nodes[], edges[], questions[], visuals[], key_terms[]
├─ external_node_refs[]            # cross-bundle references
└─ Arabic lane (ADR-0006):
   text_passages[], vocab_items[], rhetoric_notes[],
   grammar_rules[], spelling_rules[], external_rule_refs[], external_passage_refs[]
```

Highlights:

- **`TextPassage`** — the sealed text: kind (quran/hadith/prose/poetry/story→prose),
  units (آيات with `printed_n` Arabic-Indic strings), `text_sha256` seal over the STORE
  normal form, `capture_lane`, `verification` (`authority_crosscheck` for Quran —
  api.quran.com + api.alquran.cloud, verdict agree/flagged; hadith always flagged —
  no machine authority), approval trio (`approved_by/at/sha256`).
- **Typed Arabic answers** (union `ArabicAnswer`): `IrabAnswer` (word/role/state/
  position/sign/sign_kind + `rule_ref` that MUST resolve to a printed `gc:` clause),
  `ExtractAnswer` (SpanRefs into passages), `LexicalAnswer` (معنى/مضاد/جمع/مفرد),
  `RhetoricAnswer` (closed 23-label type enum), `SpellingFixAnswer` (case_id resolves).
- **`GrammarRule`/`RuleClause`** (`gr:`/`gc:` ids) — cumulative per topic across
  installments (merged by the assembler); **`SpellingRule`** with
  `printed_case_count == len(cases)` guard.
- **Cross-model validators**: referential integrity (every edge endpoint, LO, visual id
  resolves; prerequisite graph is a DAG) and Arabic integrity (sacred-marker scan on
  every stem — markers alone escalate; span/substring fidelity; sensitivity
  inheritance from sacred passages).

## 3. Lesson content bundles (`services/extraction/seed/content/*.json`)

35 files (`_sample`, 14 `soc*`, 20 `ara*`), read from disk at request time by
`app/src/lib/lesson-content.ts` (defensive normalization, null when absent), shipped
inside the app image (drift-checked against the checkout by `refresh-content.sh status`).

Common shape: `lessonId, title, tamheed, subtopics[{key,title,exposition}],
key_terms[], enrichment[], misconceptions[{wrong,correction}],
interactives[{lo,kind,prompt_ar,spec}]` (8 widget kinds).

Arabic adds: `qadaya[]` (cross-cutting issues), `out_of_scope[]` (recitation/
composition skills not graded on-platform), and `passages[]` — a **denormalized
projection** of sealed TextPassages (`id, kind, title_ar, attribution_ar,
citation_ref, sacred, verification_verdict, units[{n, printed_n, text_ar}]`) that
feeds `SealedPassageCard`, span highlighting, and the runtime guard corpus
(`getAllSacredPassages`).

## 4. Identity conventions

- Nodes: `course:prep3-*`, `mod:*`, `lesson slugs` (`u1-1`, `soc1-1`, `ara2-1`, `geo1-2`),
  `lo:*`; questions `q:<lesson>:NNN`; visuals `v:<lesson>:NNN`; passages `t:<lesson>:NNN`;
  grammar `gr:`/`gc:`; spelling `sp:`.
- Subjects: registry keys `math-en`/`social-ar`/`arabic-ar` (app) ↔ spine keys
  `math`/`social`/`arabic` (DB/URLs) — exact lookups only, never inference.
- Two Arabic page-offset regimes: T1 = PDF−1, T2 = PDF−61 (encoded in the conveyor).

# Plan — Full-Book Ingest at Richer Depth (Phase B)

Status: **in progress, started 2026-07-21** (Samuel: "fully ingest the full book" + "content that appears to the student be richer — structure/explanation/questions/widgets feel conservative").
Builds on the extraction line (ADR-0005, `extraction-pipeline.md`). Design authority: data-spine thesis Pillar I + Ch. 19.6.

## Two tracks, run together

### Track A — Scale: all 14 Term-1 lessons
The book (`Social_prp3_T1_2.pdf`) is 4 units / 14 lessons (geography U1–2, history U3–4). Two are done
(soc1-2 landforms, soc3-2 French campaign); 12 remain. The manifest already segments all 14
(`services/extraction/manifest/social-prep3-t1.json`). Each rides the same conveyor.

### Track B — Depth: the richness upgrade (the point of this phase)
The extraction contract gains **exposition + variety + interactivity**. Per lesson the pipeline now produces:

1. **Exposition** (NEW): `tamheed` hook + a teaching passage per sub-topic (3–6 sentences, book-grounded) —
   the explainer a student reads/hears, not just atomic claims.
2. **Key terms** (مفاهيم أتعلمها) — verbatim ministry definitions (schema already has `KeyTerm`).
3. **Enrichment boxes** (معلومات إثرائية) — the book's own side-boxes, currently discarded.
4. **Misconceptions** — common wrong answers + the correction (feeds distractors + tutor).
5. **Dense, varied questions** — keep ~8–10/LO but enforce ≥4 distinct *styles* per lesson
   (recall-for-terms, explain-why بم تفسر, compare قارن, consequence النتائج المترتبة, order/locate)
   and ≥2 higher-order items/LO. Style tag rides in `source_note` (no app/schema break).
6. **Widget plan** — 3–5 interactive/animated widgets/lesson, typed to the lesson:
   geography → rich `map_scene` + `LocateOnMap`; history → `timeline` + `chain` (cause→effect) + `TermMatch`.

Exposition/enrichment/misconceptions are produced now and stored as a per-lesson `lesson_content` JSON;
a small frontend surface renders them (Track-B frontend task, parallel — see below).

## The richer conveyor (per lesson)
| Stage | Model | Output |
|---|---|---|
| 0 Segment+Exposition | Sonnet | LOs (verbatim objectives) · sub-topic list · tamheed · key_terms · enrichment · misconceptions |
| 1 Claims (per sub-topic) | Sonnet | grounded `ClaimStep[]` + a rich exposition passage |
| 2 Questions (per sub-topic) | Sonnet | 8–10/LO, style-varied, grounded, higher-order ceiling |
| 3 Widgets (per lesson) | Sonnet | 3–5 typed interactive/animated specs, grounded |
| 4 Verify (per sub-topic) | Sonnet + Haiku | adversarial re-solve + provenance |
| 5 Coverage oracle (per lesson) | Sonnet | checklist vs produced — GREEN gate |
| 6 Assemble + validate | — | bundle (Pydantic/DAG) + lesson_content.json |
| 7 Human gate (Samuel) | — | richness review, then load |

Stage 0 **auto-segments** each lesson from its page headings, so scaling to 14 lessons needs no
hand-authoring — the full-book run is just the lesson list from the manifest.

## Parallelization (to accelerate)
Three lanes run at once:
- **Lane 1 — Extraction engine** (`rich-lesson.workflow.js`): pipelines lessons; within each, sub-topics
  fan out. Concurrency ~16, so 14 lessons complete in ~2 waves.
- **Lane 2 — Asset readiness** (design-system-lead, background): audit/build base maps for U2 population
  (thematic distribution maps) and confirm U3/U4 history maps (egypt / mediterranean_east / nile_valley
  already exist). Runs now so assets are ready before those lessons' widgets need them.
- **Lane 3 — Frontend richness surface** (frontend-engineer, background): a `lesson_content` store +
  lesson exposition/enrichment/key-term/misconception rendering + denser widget slots. Launches once the
  richness bar is confirmed on the reference lesson (avoids building to a moving target).

## Sequence (MVP-cut: prove the bar, then fan out)
1. **Now:** build the richer conveyor; run **Lesson 1 (soc1-1, قارات العالم)** as the first RICH lesson
   — it fills a real gap AND sets the richness bar. Launch Lane-2 asset audit in parallel.
2. **Review:** Samuel signs off the richness of soc1-1 (or dials it). Launch Lane-3 frontend surface.
3. **Fan out:** run the remaining 12 lessons in parallel waves through the same conveyor.
4. **Back-fill:** re-run the 2 already-done lessons (soc1-2, soc3-2) at the new richness bar for consistency.
5. **Load + human gate** per wave; questions stay `review` until Samuel clears them.

## Cost
Richer + full book is more spend, one-time. Rough envelope ~$40–80 total (Haiku mechanical, Sonnet
content/verify). Honors "quality over cost" for the demo; logged once cost-metering lands (task #6).

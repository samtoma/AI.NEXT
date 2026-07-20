# Proposal: Ingesting Social Studies (دراسات اجتماعية) — the second vertical on the spine

- **Status:** Proposal — awaiting Samuel's Wave-0 decisions (§6)
- **Date:** 2026-07-20
- **Source:** `docs/Source/Social_prp3_T1_2.pdf` — ministry Prep-3 Social Studies, Arabic, 2025–2026, 186 pages (Term 1 + Term 2)
- **Homework behind this:** three specialist reports, all on disk —
  [social-studies-scout.md](social-studies-scout.md) (structure + spine fit),
  [social-studies-interactions.md](social-studies-interactions.md) (interactive method),
  [social-studies-ai-pipeline.md](social-studies-ai-pipeline.md) (Arabic AI pipeline)

## 1. What the book is (scouted, not assumed)

8 units / 30 lessons, geography and history alternating (2+2 per term). Fully Arabic, scanned, watermarked (harmless to vision reads; blacklisted in extraction prompts). Two structural gifts and two surprises:

- **Gift 1:** every lesson opens with an official ministry metadata panel — أهداف الدرس (behavioral objectives), مفاهيم أتعلمها (concepts), figure inventory. **The LO decomposition is printed in the book.** Filter affective objectives → ~100–130 LOs.
- **Gift 2:** history lessons carry explicit أسباب/أحداث/نتائج boxes and the book itself declares causal links between eras — prerequisite edges with receipts.
- **Surprise 1:** the book contains **zero printed exercises** (all behind QR codes to the MOE e-learning portal) → the whole question bank must be authored; past exam models become the calibration source; the human review gate carries more weight.
- **Surprise 2:** the intro explicitly states figures/percentages/years are **not exam targets** → question authoring should favor inference verbs (بم تفسر، ما النتائج المترتبة) over recall — pending Samuel's policy call (§6.1).

## 2. Ingestion methodology — same six stages, three adapted

The pipeline (deep-dive §4) survives intact; adaptation is in what flows through it:

| Stage | Math book | Social Studies |
|---|---|---|
| 1. Content-address | sha256 | **unchanged** |
| 2. Decompose (typed bundle) | LOs from lesson structure | LOs **from the ministry objective panels**; مفاهيم boxes → typed terms; أسباب/نتائج boxes → typed cause-effect facts; map references → gazetteer entries |
| 3. Schema validation | DAG, refs, MCQ keys | **unchanged** (mcq/short only; numeric legitimately unused) |
| 4. Independent verification | re-solve the arithmetic | **replaced: independent grounded cross-check** — a second agent answers each question from the stem + cited page image alone; every claim in the model answer must be *quotable from the page*; scripted cross-bundle consistency for dates/names/places; a human-approved **trap set** (plausible facts NOT in the book) that the tutor must refuse 100% |
| 5. Human review gate | as built | **unchanged, heavier** (all-authored bank; sensitive lessons) |
| 6. Load | as built | **unchanged** (`course:prep3-social-ar`) |

Honest caveat from the scout: the cross-check is *agreement, not proof* (two readers can share an OCR misreading of Arabic-Indic digits) — humans sample numeric facts at the gate.

## 3. How the spine methodology applies (the thesis's own test)

- **Nodes/edges/questions map as-is.** No new node kinds: units = modules, ~10–15 recurring anchors (النيل، محمد علي…) as `topic` nodes; a dedicated `event` kind is deferred to v2.
- **Prerequisites are real but different per discipline:** geography is a genuine skill ladder (map skills → relief → climate → population → economy → country capstones); history edges are drawn **only where the book declares causal-explanatory dependence** (French campaign results → rise of Muhammad Ali) — never blanket chronology. Est. 110–150 edges.
- **`canonical_solution` becomes a model answer with evidence:** claim-steps each citing a book page, plus a normalized facts array — same JSONB column, no migration.
- **The grounding rule sharpens:** *the book's number wins even when the model believes the world's number* (the book says Asia = ٤٤٫٢M km²; encyclopedias differ; the exam grades the book). Outside-book questions: acknowledge → refuse → redirect with citation. History is where LLMs confabulate most confidently — containment is rules + per-claim citations + automated fact-audit (replayable from `ai_interactions.grounding`) + the trap set.
- Bidi/RTL: the directive/citation parser needs **zero changes** (logical-order scanning); RTL is a rendering concern only.

## 4. The interactive method for this subject

Understanding here is **relational, not procedural** — checked by *reconstruction*: order it, locate it, connect it, name it, retell it. Six check types that map one-to-one onto the exam's own verbs (بم تفسر / حدد على الخريطة / رتب / ضع المصطلح) — practice mirrors the exam, which is the pitch to anxious families.

**MVP primitive set (ranked by teaching value per effort):**
1. `map_scene` + `locate_on_map` — Ledger-styled SVG base maps (Egypt, Nile, Arab world, continents; 6–8 assets = the one real build investment) with a gazetteer so the AI emits *place names, never coordinates*; students tap to locate.
2. `timeline` + `timeline_builder` — RTL timelines (earliest on the right); tap-to-order events (no drag — cheap touchscreens).
3. `chain_builder` — connect أسباب → أحداث → نتائج cards.
4. `term_match` — المصطلحات ↔ definitions.
(`sort_classify`, `source_card` next wave; `stat_chart` reused as-is for economic geography.)

**Grading discipline preserved:** ordering/locating/matching grade **deterministically client-side** from human-reviewed facts; only "explain it back" is AI-graded against canonical beats.

**The lesson flow:** the whiteboard (السبورة) becomes *"the story so far"* — a pinned timeline/map grows one element per narration beat while the tutor tells the story (same controlled-step seam we built), ending as the revision artifact behind the report card. Report card axes: الخريطة، الزمن، الأسباب والنتائج، المصطلحات، السرد.

**Voice is promoted to P1 for this subject** — narration is the medium. Recommendation: Azure `ar-EG-SalmaNeural` (the only Egyptian-tuned neural voice; ~⅓ of ElevenLabs' price) via the provider abstraction already in place; OpenAI TTS as A/B. STT: Web Speech `ar-EG` for the PoC.

**RTL:** a scoped route-level flip + audit (logical CSS properties, Arabic-Indic numerals with bidi isolation, Arabic-first font subset, direction-neutral map/chart islands) — not a rewrite, and it delivers the RTL work the math production PWA needs anyway.

## 5. Effort & cost

- **Waves:** Wave 0 (contracts: VIZ_SPEC v2 kinds, base-map SVGs, RTL flip, Arabic language contract — gated on §6) → Wave 1 (skeleton: 1 geography + 1 history lesson end-to-end, the proof) → Waves 2+ (4 parallel unit tracks, math-playbook style).
- **Volume:** ~100–130 LOs, 450–550 authored questions, 220–300 visuals. ~4–6 wall-clock days of agent work after Wave 0.
- **Runtime cost (quality-first per Samuel's standing call):** est. EGP 10–14/AI-lesson (Arabic ≈ 2× output tokens) + EGP 2.5–4 TTS; levers documented for pre-pilot optimization.

## 6. Decisions needed from Samuel (Wave-0 gate)

1. **Question policy:** honor the book's "figures/years are not exam targets" → inference-verb emphasis? *(Recommend: yes — mirror the exam verbs; recall questions only for المصطلحات.)*
2. **Voice vendor:** Azure ar-EG Salma (new vendor + your Azure key → ADR) vs stretch OpenAI TTS Arabic. *(Recommend: Azure; it also future-proofs the math Arabic edition.)*
3. **Maps:** build the `map_scene` primitive with SVG base maps vs a cropped-page-image stopgap. *(Recommend: build it — it's the signature interaction of the subject.)*
4. **Scope:** both terms at once vs Term 1 first. *(Recommend: Term 1 first — demoable in ~half the time, same pipeline proof.)*
5. **Sensitive content stance:** history lessons touch political material — strict book-grounded explanation only, no model commentary. *(Recommend: yes, as a hard prompt rule + review-gate check.)*

## 7. Why this matters beyond the subject

This is the thesis's own claim under test — *"the differences are domain, not architecture"* (Ch. 15.7). The pipeline, schema, review gate, whiteboard, beats, provenance, and cost meters all carry over; what's new is one language contract, one verification variant, and four visual primitives. If Wave 1 lands cleanly, the "build a spine, sell verticals" story stops being a slide and becomes a demo: two subjects, one spine.

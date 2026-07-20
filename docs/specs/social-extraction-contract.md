# Social Studies Extraction Contract — `course:prep3-social-ar` (Wave 1)

- **Status:** ACTIVE contract for the Wave-1 extraction agents. Every extraction/verification agent working on the Social Studies book reads this file verbatim before producing a bundle.
- **Authority:** ADR-0004 (accepted decisions), `docs/specs/social-studies-ai-pipeline.md` (methodology), ADR-0001 (spine discipline). Human review gate (Samuel) is final on everything — nothing in this contract weakens it.
- **Source:** `docs/Source/Social_prp3_T1_2.pdf` — الدراسات الاجتماعية, Preparatory 3, Term 1 (+T2 in same file), Egyptian Ministry of Education, 186 pp, scanned + watermarked. Term 1 scope first: 4 units, ~15 lessons (ADR-0004 §4).
- **Runtime consumer:** `app/src/lib/lesson.ts` / `app/src/lib/ask.ts` detect subject `social-ar` from the course node and render the model-answer claim-steps defined here into the tutor prompt. What you extract is *exactly* what the tutor is allowed to say.

---

## 1. Bundle rules

Bundles follow the math `SeedBundle` shape (`services/extraction/schemas.py`) with the social-specific extensions below (schema owners are extending `schemas.py` in Wave 1; this document is the contract they implement).

### 1.1 Identity and structure

```json
{
  "source_document": {
    "title": "الدراسات الاجتماعية — كتاب الطالب، الصف الثالث الإعدادي، الفصل الدراسي الأول",
    "publisher": "Arab Republic of Egypt — Ministry of Education & Technical Education",
    "edition": "2025-2026",
    "language": "ar",
    "grade": "prep-3",
    "subject": "social studies",
    "file_path": "docs/Source/Social_prp3_T1_2.pdf"
  },
  "syllabus_version": "2025-2026",
  "external_node_refs": ["program:bakaloreya-track"]
}
```

- Course node (first social bundle only): `course:prep3-social-ar`, `part_of` → `program:bakaloreya-track`. **The `-social-ar` suffix is load-bearing:** the runtime derives the subject key from it (`subjectOfCourse` in `app/src/lib/lesson.ts`). Do not rename.
- Modules: `module:soc-u1` … `module:soc-u4`, `part_of` → `course:prep3-social-ar`, labels Arabic verbatim from the book (e.g. `"الوحدة الأولى — الجغرافيا الطبيعية للعالم"`).

### 1.2 Id conventions — Latin ids, Arabic content

| Entity | Pattern | Example |
|---|---|---|
| Lesson slug | `soc<unit>-<lesson>` | `soc1-2` |
| Learning objective | `lo:soc<unit>-<lesson>-<n>` | `lo:soc1-2-3` |
| Question | `q:soc<unit>-<lesson>:NNN` | `q:soc1-2:004` |
| Visual | `v:soc<unit>-<lesson>:NNN` | `v:soc1-2:001` |

- **Ids are ASCII/Latin only.** Labels, descriptions, stems, choices, answers, claims, terms, captions are **Arabic** (the book's own wording).
- The lesson slug must satisfy the app's slug rule `^[a-z0-9]{1,12}-[0-9]{1,3}$` (`SLUG_RE` in `app/src/lib/lesson.ts`) — `soc1-2` passes; anything with a second internal dash (e.g. `ss-t1u1-1`) does **not** and will silently fall back to the default math lesson. ⚠️ Any pre-existing test rows using `ss-…` style ids do not conform to this contract and must not ship.
- Numerals: **Arabic-Indic digits inside all Arabic text fields, exactly as printed in the book** (٤٤٫٢ with the Arabic decimal separator ٫). Latin digits only in ids, `source_page`, `step`, `evidence_page` and other structural fields.

### 1.3 Watermark blacklist (hard gate)

The page footers carry the watermark **«صندوق تأمين ضباط الشرطة»**. This string (or any substring/variant of it) must **never** appear in any extracted field — label, description, stem, choice, claim, term, note, caption. Enforcement is layered:

1. The extraction prompt lists it as an explicit blacklist.
2. A scripted grep over the serialized bundle runs before load; any hit **fails the bundle**.
3. The verifier prompt (§4) carries the same blacklist.

---

## 2. From book structure to spine data

### 2.1 أهداف الدرس panel → learning objectives

Every lesson opens with a ministry objective panel (أهداف الدرس). Mapping method:

1. **One panel bullet → one LO** (`lo:soc<unit>-<lesson>-<n>`, `n` in panel order = `order_in_parent`). Split a compound bullet ("يحدد … ويفسر …") into separate LOs; never merge bullets.
2. `label` = the bullet **near-verbatim** (keep the ministry's imperfect-verb phrasing: يحدد، يفسر، يقارن، يستنتج…). Trim only trailing punctuation.
3. `description` = 1–3 Arabic sentences expanding the objective **using only that lesson's book content** (this text reaches the tutor prompt — it is grounding material, not editorial).
4. `source_page` = the page where the panel appears; `syllabus_ref` = `"Term 1 · Unit <U> · Lesson <L>"`.
5. Edges: `module:soc-u<U>` —`teaches`→ each LO. `prerequisite_of` edges are rare in this subject (lessons are largely self-contained); add them only where the book itself sequences dependence, and keep the DAG rule.

### 2.2 مفاهيم أتعلمها boxes → term entries

The glossary box is the **ministry terminology source of truth** (pipeline spec §2.2). Each term in the box becomes a `key_terms` entry:

```json
{
  "term_ar": "الموقع الجغرافي",
  "definition_ar": "<the book's definition sentence, verbatim, including as-printed diacritics>",
  "page": 8,
  "lesson": "soc1-1"
}
```

- `term_ar` and `definition_ar` are **verbatim** — no paraphrase, no normalization (the book's spelling wins, e.g. أوربا if that is what the book prints).
- Terms are first-class review items: **the verbatim check on terms is human** (short, high-stakes, cheap to review).
- Terms are the *only* permitted target for recall questions (§5).

### 2.3 أسباب / نتائج boxes → typed facts

Cause/result boxes (and any in-text enumeration of أسباب, نتائج, أهمية, مظاهر) become **typed facts inside model-answer claim-steps** (§3): one claim-step per cause/result, each with a `facts` entry of `kind: "cause"` or `kind: "result"` bound to its entity/event. Enumerations are **closed sets**: extract every item the book lists and no more — the tutor is forbidden to extend them, so an incomplete extraction silently shrinks the syllabus and an inflated one fabricates it.

---

## 3. The grounding unit: model answer with evidence

Math's canonical solution is replaced by **الإجابة النموذجية بالأدلة** — the same `canonical_solution` jsonb column on `questions`, new step shape. **Exact shape of the array stored in `canonical_solution`** (this is what the runtime renders — one object per claim-step):

```json
[
  {
    "step": 1,
    "claim_ar": "تمتد قارة آسيا من دائرة عرض ١٠° جنوبًا إلى دائرة عرض ٨١° شمالًا",
    "evidence_page": 3,
    "evidence_kind": "text",
    "facts": [
      { "kind": "coordinate", "entity": "قارة آسيا", "value": "١٠°ج – ٨١°ش" }
    ]
  },
  {
    "step": 2,
    "claim_ar": "تبلغ مساحة قارة آسيا ٤٤٫٢ مليون كم²",
    "evidence_page": 3,
    "evidence_kind": "map",
    "facts": [
      { "kind": "area", "entity": "قارة آسيا", "value": "٤٤٫٢ مليون كم²" }
    ]
  }
]
```

Field contract (mirrored by `ClaimStep` in `app/src/lib/types.ts`):

- `step` — 1-based, contiguous. Order = the order a teacher would state the claims.
- `claim_ar` — one atomic Arabic claim, book-faithful. One claim per step; a cause and its result are two steps.
- `evidence_page` — the page whose text/map/box supports the claim. **Every step has one.** This is what makes the runtime rule enforceable and the Evidence Walk identical to math's ("this sentence ← this page").
- `evidence_kind` — `"text" | "map" | "concept_box" | "enrichment_box"`.
- `facts` — every checkable atom in the claim (dates, numbers, coordinates, areas, names, places, causes, results), normalized `{kind, entity, value}`. This array is the raw material for the scripted cross-consistency check and the runtime fact audit — you can string-match a fact; you can't string-match a paragraph.

Question-level companions (bundle fields alongside `solution`; storage mapping owned by the schema/loader owners):

- `answer_type` — `"define" | "enumerate" | "locate" | "compare" | "explain_cause" | "evidence"`.
- `accepted_variants_note` — human-authored Arabic tolerance statement for grading free text (e.g. "يُقبل ذكر الحدود بأي ترتيب؛ الصياغة الحرفية غير مطلوبة، الأرقام والمصطلحات مطلوبة حرفيًا"). Required for `short` questions.
- `key_terms` — glossary terms (verbatim surface forms) this answer must use.

**Book-vs-world rule:** where the book conflicts with encyclopedic reality (Asia = ٤٤٫٢ vs 44.58M km²), extract **the book's value**, note the conflict in `source_note`, and record an internal erratum — the exam grades the book, so the spine teaches the book.

---

## 4. Independent grounded cross-check protocol (the re-solve replacement)

Math's trust move was an independent re-solve. Facts have no arithmetic oracle, so verification is three layers; `verified: true` is set by the pipeline, never by the extractor.

### 4.1 Page-fidelity second reading (per claim-step, automatable)

A **separate agent, fresh context**, receives ONLY: the question stem + the cited page image (high-DPI render). Not the extraction, not the book text, not the extractor's reasoning. It answers from stem + page alone, per claim:

> «هل هذه الجملة مدعومة نصًا أو من الخريطة في هذه الصفحة؟ أجب: مدعومة / غير مدعومة / جزئيًا، مع تحديد الموضع.»

- Bar: **every claim must be quotable from its cited page** — supported by the page's text, map, or box, at the stated location. "True but on another page" = غير مدعومة (fix the citation, re-verify).
- مدعومة on all steps → eligible for `verified`. Any غير مدعومة / جزئيًا → the discrepancy queue (human), like math's re-solve diffs.
- Known shared-OCR weakness (both passes read the same scan): render pages at high DPI, use a different model family for the verifier where feasible, and the human gate **samples numeric-fact claims specifically** (a human checks «٨١° شمالًا» against a map in seconds).
- Verifier prompt carries the watermark blacklist (§1.3).

### 4.2 Scripted date/name/place cross-consistency (bundle-wide)

All `facts` entries are normalized into a fact table keyed by (entity, kind). A script flags:

- the same entity with conflicting values across lessons (two areas for Africa);
- the same event with two dates;
- spelling variants of one proper noun (أوروبا/أوربا — the **book's** spelling becomes the canonical surface form).

LLM only for entity normalization; the diff itself is a script. Conflicts → human queue. Genuine book errata are recorded internally and still taught as printed.

### 4.3 `verified: true` rules

`verified: true` on a question **iff**:

1. every claim-step passed the §4.1 second reading (مدعومة), and
2. the §4.2 script raises no unresolved conflict touching its facts, and
3. the watermark grep (§1.3) is clean.

`verified` is necessary but not sufficient for `status: live` — **the human review gate remains final and unchanged**: nothing reaches a student without it.

---

## 5. Question policy (ADR-0004 §1)

- **Inference verbs favored** — the book's own directive is that figures/years are not exam targets. Author stems with: بم تفسر…؟ / ما النتائج المترتبة على…؟ / قارن بين…؟ / دلل على…؟ / ما أهمية…؟
- **Recall questions are reserved for المصطلحات only** (glossary terms, §2.2): «ما المقصود بـ…؟» with the book definition as the model answer.
- **Types: `mcq` and `short` only.** No `numeric`. MCQ distractors must be plausible *within the book's world* (a neighboring value or a sibling concept from the same unit) — never invented facts that a student could mistake for syllabus content.
- Tiers as in math (`basic`/`standard`/`advanced`); every question carries `source_page` + `source_note` naming the exact book anchor (drill, box, map, or "original in scope of …").

---

## 6. Trap set — plausible-but-not-in-book (containment proof)

Per unit: **≥ 10 trap cases** of (question → expected refusal/redirect). Categories (pipeline spec §4c):

1. Off-book-but-true facts (e.g. Asia's population rank when the lesson doesn't state it).
2. Book-vs-world conflicts («مساحة آسيا ٤٤٫٥٨ مليون كم²، صح؟» → tutor must correct to the book's ٤٤٫٢, cited).
3. Causal bait — the book lists N causes; the trap invites an (N+1)th.
4. Adjacent-syllabus bait — other grades/terms the model knows cold.

Pipeline: agent drafts → **automated absence-check against the full extracted book text** (a "trap" that is actually on page 90 is a false test) → **human approves every case**. The tutor must refuse each trap via acknowledge → decline → redirect (never answer-then-disclaim); the release bar is a 100% refusal rate on the approved set before any student sees the subject.

---

## 7. Sensitive-content extraction rule (ADR-0004 §5)

Historical and political material is extracted **strictly as the book presents it**: stems, model answers, claims and descriptions carry the book's framing only — no added commentary, no modern political parallels, no evaluative judgments beyond the book's own words. Extraction agents flag lessons touching political history in `source_note` (`"sensitive: political-history"`) so the human review gate gives them priority attention. The same rule is enforced at runtime by the social-ar system prompts (`app/src/lib/lesson.ts`).

---

## 8. Visuals

Producer rules for social figures (base maps, `map_scene`, `timeline`, `flow_chain`) live in **`services/extraction/VIZ_SPEC.md` v2** — that spec is the single authority for viz kinds, spec shapes, and the gazetteer rule (place names, never raw coordinates; ADR-0004 §3). This contract adds only: every visual cites its `source_page` (the book map/figure it re-renders), captions are Arabic, ids follow §1.2, and the watermark blacklist applies to captions and any text inside specs.

---

## 9. Checklist per bundle (gate order)

1. Ids/slugs conform to §1.2 (scripted).
2. Watermark grep clean (§1.3, scripted).
3. Pydantic validation (`schemas.py`, extended for claim-steps) passes.
4. Page-fidelity second reading run; discrepancy queue empty or resolved (§4.1).
5. Cross-consistency script clean or conflicts human-resolved (§4.2).
6. Term entries human-checked verbatim (§2.2).
7. Trap set drafted + absence-checked + human-approved (§6).
8. Human review gate on every question → only then `status: live`.

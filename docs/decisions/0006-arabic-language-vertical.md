# ADR-0006: Arabic Language vertical — a new extraction contract

- **Status:** Accepted
- **Date:** 2026-07-28
- **Decided by:** Samuel (CTO/Architect)

## Context

The third ministry book — «اللغة العربية — لغتي حياتي», الصف الثالث الإعدادي (122 pages, both terms,
6 units, **20 lessons**) — does not fit the extraction contract built for Social Studies and Maths.

Our atom is **a claim with a page citation**. Arabic has two different atoms: a **verbatim text**
(قرآن / شعر / نثر) and a **rule that is applied, not recalled** (إعراب is derived per word). The
asymmetry that forces the decision: *a paraphrase of a fact is a weaker fact; a paraphrase of an آية is
a defect.*

Six specialist studies (scout, extraction contract, student experience, viz/widgets, verification,
sensitive content — all in `docs/specs/arabic-*.md`, synthesised in
`docs/specs/proposal-arabic-vertical.md`) surfaced findings that would otherwise have shipped wrong:

- The **page offset breaks mid-book** (Term 1 `printed = PDF − 1`; Term 2 `printed = PDF − 61`) — carrying
  the Term-1 rule forward cites a *real but wrong* page across all of Term 2.
- **A whole lesson is missing from its unit opener** («حب الوطن», printed ٤٩) — our structure-derived
  segmenter would have dropped it silently: the Africa-only failure (ADR-0005) in a new costume.
- The **Quran is printed in Uthmani orthography**; a model asked to type it silently emits imlā'ī —
  visually plausible, textually wrong, invisible to similarity checks.
- **Scripture is scattered** (a Quranic شاهد inside the *grammar* section; a حديث inside prose) while
  «آيات العلم» is a *poem* — so sealing cannot be scoped to "the Quran lesson", in either direction.
- **بيت 1 and بيت 7 of «كن جميلا» share an identical صدر** — dedupe-by-hash silently deletes a line.
- **The product has no Arabic webfont** (`subsets: ["latin"]`, no Arabic family in CSS) — every Arabic
  glyph, including the *shipped* Social Studies vertical, renders in the device fallback. Survivable for
  Latin maths; not for a subject where the تشكيل **is** the content, on our low-end-Android target.

Constraints: PRD first-load budget < 1.5 MB on 3G; AI cost ceiling EGP 40/student/month; minors' data;
Arabic RTL throughout; nothing unreviewed reaches a student (CLAUDE.md §3).

## Options considered

1. **Stretch the Social Studies contract** — cheapest, no new machinery; but it has no representation for
   verbatim text, no way to grade a derived إعراب, and would paraphrase scripture. Rejected on fidelity.
2. **New vertical, full language stack** (incl. خط handwriting + تلاوة ASR + تعبير grading) — most complete;
   but handwriting and composition grading are subjective and slow to build, and a weak grader on
   subjective work is worse than none.
3. **New vertical, exam-load-bearing core** — text + grammar + إملاء + five widgets; defer the rest.

## Decision

**Build a new Arabic vertical scoped to the exam-load-bearing core, with scripture handled as a vendored
asset rather than model output.** Four parameters pinned:

1. **MVP scope** — verbatim text, معاني المفردات, مواطن الجمال, إعراب, and **الإملاء** (the book's
   most-drilled skill: a full section in every lesson), delivered through five widgets:
   `extract_spans` → `hamza_seat` → `style_purpose` → `irab_builder` → extended `term_match`.
   **Deferred:** خط (handwriting), تلاوة ASR, تعبير grading.
2. **Quran lane — transcribe, then cross-verify against two independent online authorities.**
   *(Samuel, 2026-07-28, superseding the original "vendor a corpus" decision — the Quran is immutable and
   widely published, so verification is easy and reliable, and this avoids the licensing question
   entirely. Stored as **text, never an image**.)* The lane is:
   1. A vision model **transcribes** the passage from the book page **and** independently reports its
      citation `(surah, ayah_from, ayah_to)`.
   2. That range is fetched **raw (curl, no model in the loop)** from **two independent authorities**
      and the two are diffed against each other.
   3. The book transcript is diffed against the canonical text. Comparison runs in **COMPARE form**:
      strip tatweel and the Quranic **annotation block U+06D6–U+06ED** (tajweed/pause aids, which
      legitimately differ by publisher) while **keeping U+0670 dagger-alef and the hamza marks, which are
      text**.
   4. All three agree → store the **canonical Uthmani, NFC, unmodified**, sealed with `text_sha256`.
   5. **Any disagreement → FLAG for human review.** Never silently pick a source, never block the rest of
      the run.
   **The runtime still emits span tokens, never scripture**, with an output-containment check that fails
   closed.
   **Validated on the real passage before adoption:** سورة الفرقان ٦٣–٧٠ (the عباد الرحمن lesson) —
   two sources agreed **8/8** on the text. The raw diff initially showed 6/8 "failures" that turned out to
   be **U+06ED (small low meem, an iqlab tajweed mark)** present in one edition only. That is precisely
   why the annotation block must be excluded from comparison but preserved in what we store — and why a
   naive byte-compare would have flagged the correct text as corrupt.
3. **Arabic webfont** — **Noto Naskh Arabic globally**, plus **Amiri Quran lazy-loaded only on Quran
   passages**. This also repairs the shipped Social Studies vertical. Page weight to be measured against
   the < 1.5 MB budget.
4. **LO granularity** — **5 assessable spine LOs per lesson** (not the printed 8–9). خط and تعبير are
   recorded `OUT_OF_SCOPE(reason)` **and the product must state, in visible copy, that these are not
   scored at this stage for simplicity** — the gap is disclosed to the student and parent, never silently
   hidden and never left sitting at 0% forever in the weekly report.

Supporting mechanisms adopted with the contract (details in the specs): K=3 decorrelated transcriptions
diffed as codepoint sequences for all non-scripture verbatim text; two normal forms (STORE = NFC vs
COMPARE-LOOSE, never confused); approval bound to a checksum so one changed harakah auto-demotes a live
passage; `IrabAnswer` as a typed slot record (not a string) with a deterministic rule table as third
voter and `VARIANT` treated as valid, not a defect; a coverage oracle asserting **integer equalities**
plus an `OUT_OF_SCOPE` status; pipeline 9 → **10 stages** (Text Capture added; Claims → Language
Artefacts; Visuals → text-anchored interactives; Verify hardened with blind إعراب re-derivation).

## Consequences

**Enables.** Grading is mostly deterministic — `IrabAnswer` slots plus مواطن الجمال being a *table* over a
closed ~8-value vocabulary means **6 of 9 question types grade with no model call**; Arabic runtime cost
should land *below* maths. It also unlocks the vertical's demo moment: «أَيُّهَذَا الشَّاكِي» is printed as a
موطن جمال on p.15 and as the المنادى lesson on pp.16–17 — *the book separates them by three pages; the
spine puts them thirty seconds apart*.

**Costs.** Ingestion is materially more expensive than Social Studies: transcription is pinned to the
high-res vision tier (Opus/Sonnet — Haiku 4.5's 1568 px tier is **barred**) and K=3 triples that pass.
One-time. The font adds page weight to every page in the product. The human gate now needs an **Arabic
teacher**, and Quran-derived content needs a **named religious-content owner** with two sign-offs.

**Becomes harder / must change before extraction.** `variant_engine.py` must never vary a Quranic stem
(still a stub — cheapest moment to write the exclusion); `load_seed.py --approve-all` must **hard-refuse**
Quran-derived bundles; MCQ decoy machinery must not manufacture near-miss verses; TTS must not recite
scripture. Sealing cannot be scoped by lesson. Unlike Social Studies, this syllabus **requires the
student's own رأي**, so ADR-0004 §5's "no evaluative judgment" rule must **not** be copy-pasted.

**Revisit if.** A vendored corpus proves unlicensable in our distribution (fall back to K=3 transcription
with a scholar seal); the font pushes first load past the 1.5 MB budget on 3G; or a pilot shows parents
want خط/تعبير scored after all.

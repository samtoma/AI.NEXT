# Proposal — Arabic Language vertical (اللغة العربية, Prep-3)

**Status:** awaiting Samuel's decisions. Nothing is built or extracted yet.
**Entry point.** Six specialist studies back this: [scout](arabic-scout.md) ·
[extraction contract](arabic-extraction-contract.md) · [student experience](arabic-student-experience.md) ·
[viz & widgets](arabic-viz-widgets.md) · [verification](arabic-verification.md) ·
[sensitive content](arabic-sensitive-content.md).
**Book:** `docs/Source/Arabic_Prp3_Tr1_2.pdf` — «اللغة العربية — لغتي حياتي», 122 pages, both terms,
6 units, **20 lessons**.

---

## 1. Verdict: this needs a new vertical, not a new manifest

Our current atom is **a claim with a page citation** — built for history/geography facts. Arabic has
two different atoms:

| | Social / History | Arabic |
|---|---|---|
| Atom | a claim, cited to a page | a **verbatim text** + a **rule that is applied** |
| Truth model | fact recall | **إعراب is derived**, not looked up |
| Fidelity risk | a wrong fact | a **corrupted harakah** — unacceptable in قرآن/شعر |
| Answers | recall / explain | إعراب · استخراج · شرح · مرادف/مضاد · غرض بلاغي · إملاء |
| Figures | maps, timelines | **the annotated passage itself** |

A paraphrase of a fact is a weaker fact. A paraphrase of an آية is **a defect**. That single asymmetry
is why the contract has to change rather than stretch.

## 2. What the study found that we would otherwise have shipped wrong

1. **The page offset breaks mid-book.** Term 1 `printed = PDF − 1`; Term 2 `printed = PDF − 61`
   (verified at PDF 110 → folio ٤٩). Carrying T1's rule into T2 cites a *real but wrong* page on every
   Term-2 fact — silent corruption, our worst class.
2. **A whole lesson is missing from its unit opener.** T2 Unit 3 lists three lessons; it has four —
   **«حب الوطن»** (printed ٤٩) is absent from the opener but present in the contents table and headed
   «الدرس الثالث». Our social pipeline derives lessons from the book's own structure, so it would have
   dropped it silently: the Africa-only failure in a new costume.
3. **The Quran is in Uthmani orthography.** A model asked to *type* it silently produces imlā'ī —
   visually plausible, textually wrong, invisible to similarity checks.
4. **Scripture is scattered.** A Quranic شاهد sits inside the المنادى *grammar* section (PDF p.23) and a
   حديث with ﷺ inside قاسم أمين's prose — while «آيات العلم» is a *poem* and the لقمان aphorism is not
   scripture. Sealing cannot be scoped to "the Quran lesson", in either direction.
5. **بيت 1 and بيت 7 of «كن جميلا» share an identical صدر** — any dedupe-by-hash silently deletes a line.
6. **Grammar is taught in installments** (المنادى spans lessons 1-1→1-3; البدل 2-1→2-3). A per-lesson
   "no outside grammar" rule would forbid the book's own sequencing.
7. **No Arabic webfont exists in the product** (`subsets: ["latin"]`, no Arabic family in the CSS) —
   every Arabic glyph, including shipped Social Studies, renders in the device fallback.
8. **No printed exercise bank** (QR codes to ministry web drills) — the whole question bank is authored,
   as with Social Studies.

## 3. The design, in one page

**Fidelity — don't verify the text, prevent the model from producing it.**
- **Quran:** never transcribed. Agents emit only `(surah, ayah_from, ayah_to)`; two models must agree on
  those integers; text is materialised from a **pinned, checksummed corpus**. Runtime emits **span
  tokens, never scripture**; an output-containment check fails closed.
- **All other verbatim text:** **K=3 decorrelated transcriptions diffed as codepoint sequences.**
  Unanimous seals; any disagreement quarantines to a human. No majority vote, no similarity score.
- Two normal forms, never confused: **STORE** (NFC; strips tatweel; preserves ى/ي، ة/ه) vs
  **COMPARE-LOOSE** (routes diffs and grades student typing — never accepts a passage).
- **Approval binds to a checksum**: one changed harakah auto-demotes a live passage.

**Grading — most of it is deterministic.**
- `IrabAnswer` is a **typed slot record** (role/state/sign/sign_kind/rule_ref), not a string → scripted
  slot-diff with partial credit, a *computed* diagnosis the tutor only verbalizes, and a small cache key.
- **مواطن الجمال is a table** (شاهد → نوع → غرض) over a closed ~8-value vocabulary → the richest
  interaction grades with **zero AI**.
- Net: **6 of 9 question types grade with no model call**; Arabic runtime cost should land *below* math's.
- `VARIANT` (a fuller but compatible إعراب) is **not a defect** — it feeds the runtime grader's
  accepted answers. A deterministic **rule table built from the book's own printed rules** acts as a
  third voter, the only thing that catches two models being correlated-wrong.

**Experience — the book prints its own arc; we convert its passive steps into actions.**
All lessons share one skeleton: ناقش → النص+مفردات+شرح+مواطن الجمال → أسئلة → قراءة صامتة → لغويات → كتابة.
**One session, two acts, hinged** (two sessions would be a menu, and the hinge dies). The three text
types differ only in the middle verb: قرآن = استخراج+دلالة · شعر = أسلوب/غرض+صورة · نثر = تلخيص+استنتاج.

**The killer moment.** «أَيُّهَذَا الشَّاكِي» is printed on p.15 as a موطن جمال (نداءٌ للتنبيه) and on
pp.16–17 as the المنادى lesson. *The book separates them by three pages; we put them thirty seconds
apart* — tap the word → name نوع → name غرض → «الكلمة اللي لسه ماسكينها دي؟ دي بالظبط درس النحو
النهاردة» → the same word becomes the first إعراب. One gesture, two objectives, fully deterministic.

**Coverage oracle — deterministic, and honest about gaps.**
Because these pages are tabular, the oracle asserts **integer equalities** (vocab cells, rhetoric
bullets, إملاء rows, verse counts) instead of a model's opinion. It gains a third status,
**`OUT_OF_SCOPE(reason)`**: تلاوة and خط are printed objectives we cannot assess, and silently dropping
them *is* the Africa-only failure in language form.

**Pipeline:** 9 → **10 stages** — *Text Capture* added; *Claims* → *Language Artefacts*; *Visuals* →
text-anchored interactives; *Verify* hardened with a blind إعراب re-derivation.

**Widgets (v3).** The passage is the figure — an annotated text appears 8× in 17 pages; the tree diagram
appears **once**. Kinds: `text_passage` (this vertical's `map_scene`), `gloss_table`, `case_table`,
`rule_tree`, `verse_layout`, `irab_tree`, `harakat_reveal`. Student widgets in priority order:
`extract_spans` → `hamza_seat` → `style_purpose` → `irab_builder` → extended `term_match`.
**Honest reuse:** `ChainBuilder` already covers بيت reassembly (don't build a second orderer),
`LocateOnMap` works as-is on قصة أثر, `TermMatch` needs one prop. **Do not** build a general تشكيل
placer (~a month saved).
**Hard gate:** the book prints **zero إعراب worked examples**, only rules — so no `irab_tree` may render
without a `rule_ref` quoting a printed rule line. Otherwise the AI improvises grammar we cannot verify.

**Sensitive content.** Never produce sacred text from memory; never paraphrase it into verse-shape; no
فتوى; no adjudication between تفسير schools; the book's شرح only; no شيخ roleplay; no recitation grading.
Quran-derived content defaults to `sealed_pending_scholar`, needs two named sign-offs, and the loader must
**hard-refuse `--approve-all`** for it. Note this syllabus, unlike Social Studies, **requires the student's
own رأي** — so our "no evaluative judgment" rule cannot be copy-pasted.

**Immediate code risks (fix before extraction):** `variant_engine.py` would generate variants of Quranic
stems (still a stub — cheapest moment to write the exclusion); `load_seed.py --approve-all` force-promotes
to live; MCQ decoy machinery would manufacture near-miss verses; TTS would recite scripture.

## 4. Cost & shape

~20 lessons. Transcription is pinned to the **high-res vision tier** (Opus/Sonnet; Haiku 4.5's 1568px
tier is barred), and K=3 triples the transcription pass — so this book is **materially more expensive to
ingest than Social Studies**, one-time. Runtime, by contrast, should be *cheaper* than math.

## 5. Decisions for Samuel

Consolidated from ~19 across the six specs; the rest have sensible defaults recorded in-spec.

| # | Decision | Recommendation |
|---|---|---|
| 1 | **MVP scope** — how much of the language stack | Text + grammar + إملاء + the 5 core widgets; defer خط, تلاوة-ASR, تعبير grading |
| 2 | **Quran lane** — vendor a corpus vs transcribe | **Vendor** a checksummed حفص corpus; confirm licensing + رواية match |
| 3 | **Arabic webfont** | Noto Naskh Arabic globally + Amiri Quran lazy-loaded on Quran passages (fixes Social Studies too) |
| 4 | **LO granularity** | 5 spine LOs/lesson; خط + تعبير `OUT_OF_SCOPE`, not 0%-forever in the parent report |
| 5 | **Reviewer** (ops, not build) | An Arabic teacher for the gate + a **named religious-content owner** for the two Quran sign-offs |

## 6. Plan once approved

1. Wave 0 — contracts: schemas, VIZ_SPEC v3, the fidelity gates, the `variant_engine`/`--approve-all`
   exclusions, the Arabic font, `course:prep3-arabic-ar`.
2. Wave 1 — one **reference lesson** (عباد الرحمن: Quran + المنادى + الهمزة) end-to-end, for Samuel's
   richness sign-off before any fan-out.
3. Wave 2 — fan out the remaining 19 lessons; coverage-oracle GREEN per lesson; audit pass.
4. Wave 3 — human gate, load, and the deployed-instance content-refresh path (see below).

**Blocker to clear separately:** the deployed stack seeds its DB **only on first boot**, so a new book
cannot reach `ainext.reletix.com` without either a `down -v` (which also wipes the Claude login) or a
loader run against the deployed DB. Needs a proper content-refresh path.

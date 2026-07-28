# Verification & Fidelity Strategy — Arabic Language (اللغة العربية), Prep-3

> Status: **proposal — awaiting Samuel's decisions (§7)**. Owner: QA. Co-owner: ai-engineer (graders), data-engineer (seal storage), security-privacy-officer (§5 escalation path).
> Scope: verification of extracted content for the Arabic vertical. Adapts `services/extraction/runbook/rich-lesson.workflow.js` (stage 5 independent re-solve, stage 6 coverage oracle) and `services/extraction/runbook/audit-claims.workflow.js` (stronger-model provenance re-audit).
> Evidence base: `docs/Source/Arabic_Prp3_Tr1_2.pdf`, PDF pp. 9–25 = printed pp. 8–24 (Unit 1, all three lessons + Unit 2 opener). **Printed = PDF − 1.**

---

## 0. Why the current verification model does not transfer

Everything we built for Math and Social Studies rests on two assumptions:

1. **A question has a checkable answer.** Re-solve it with a different model that never saw the proposed answer; compare. That gave us 0 answer errors across 754 Social Studies questions.
2. **A claim has a page.** Re-read the page with a stronger model; rule supported / unsupported / wrong. That caught 4 real defects (a wrong century, two over-claims, one unsupported inference).

Arabic breaks both, and adds a third failure mode we have never had to handle.

| | Social Studies | Arabic |
|---|---|---|
| Answer | one key, string-comparable | إعراب has legitimate variants; تذوق has no key at all |
| Claim | a proposition on a page | a **character sequence** on a page — the text *is* the fact |
| Worst defect | a wrong century (embarrassing) | a dropped harakah in a Quranic verse (**unrecoverable trust loss**) |

The third failure mode is the governing one. **Verbatim fidelity is a correctness property, not a formatting concern.** A verse of سورة الفرقان re-typed by a model with one letter or one mark changed is a defect of a different kind than a wrong date: it is religiously offensive, it is what a parent will screenshot, and no amount of "the rest of the product is accurate" repairs it. PRD §12's trust-collapse thesis applies here at maximum severity.

So the strategy below inverts the default: **for text that must be exact, we do not verify a model's output — we prevent the model from producing it at all.**

### 0.1 Concrete traps found while reading pp. 8–24

These are not hypotheticals; each was observed in the source and each defines a test.

| # | Observation | Defect it produces | Where handled |
|---|---|---|---|
| T1 | سورة الفرقان ٦٣–٧٠ (printed p.8) is set in **Uthmani orthography** — ٱ alef wasla, superscript (dagger) alef, pause marks, ۝ ayah markers | A model asked to "type the verses" silently re-renders them in modern imlā'ī script. Every verse is then wrong, and fluently so. | §1.2 tier A |
| T2 | A Quranic quote appears **inside the grammar section**: ﴿يُوسُفُ أَعْرِضْ عَنْ هَذَا﴾ (printed p.22, footnoted سورة يوسف الآية ٢٩) | Sealing only "the Quran lesson" misses it. Sacred text is not confined to one lesson. | §1.2 tier A applies to any ﴿…﴾ span, anywhere |
| T3 | The poem (كن جميلا, printed p.14) has **7 أبيات in صدر/عجز columns**, and بيت 1 and بيت 7 share an **identical صدر** («أيهذا الشاكي وما بك داء») with different أعجاز | (a) linear reading scrambles hemistich pairing; (b) a dedupe-by-hash step silently drops بيت 7 | §1.5 structural checks (bayt count, قافية, no dedupe) |
| T4 | Every عجز rhymes on ـلا (عليلا، الرحيلا، إكليلا، ثقيلا، جميلا، يزولا، جميلا) | Gives a free deterministic integrity check on the poem | §1.5 |
| T5 | The book prints **dotless final yaa** (فى، التى) in some places and dotted (في، التي) in others — Egyptian print convention, internally inconsistent | Normalizing ى→ي is a **fidelity defect** in stored text; *not* normalizing it when grading a student's typed answer is a **false failure** | §1.3 two normal forms |
| T6 | Tatweel/kashida used for typographic stretching (باب اللــوق, printed p.13) | Tatweel enters the stored string as if it were part of the word | §1.3 STORE form strips U+0640 |
| T7 | معاني المفردات tables (pp. 9, 14, 21) are RTL grids with word/meaning stacked and multiple pairs per column | Word↔meaning transposition — a wrong gloss taught confidently | §1.5 / §4 item 3 |
| T8 | The إملاء tables (pp. 12, 18, 23) contain **deliberately empty cells** for the student to fill (هات أمثلة من عندك) | Empty cells extracted as "missing data" and hallucinated full, or the rule row mistaken for an answer key | §4 item 7 |
| T9 | Book answers often live **elsewhere on the page**: the fill-in «"اصرف" فعل ..... يفيد: .....» (p.9) is keyed by the مواطن الجمال bullet «(اصرف): أمرٌ يفيد الدعاء» on the same page | Grader marks a correct answer wrong for lack of a key | §3 grounding rule |
| T10 | Numeric facts still appear in prose (قلعة قايتباي: طول ٦٠ مترًا، عرض ٥٠ مترًا، مساحة ١٧٥٥٠ مترًا, p.20) | Same class as the Social Studies wrong-century defect | existing provenance audit, unchanged |
| T11 | Objectives include **non-assessable** skills — «يتلو الآيات تلاوة صحيحة» (oral), «يكتب نموذجًا بخطي النسخ والرقعة» (handwriting) | Silently dropped from coverage; the book's own objective box is then a lie about what we teach | §4 `OUT_OF_SCOPE` status |

> A note on my own reading: while transcribing the إملاء case table on printed p.12 into these notes I could not be certain I had every cell right from the page image. That is precisely the point of §1 — if a careful human reader working slowly is unsure, an extraction agent producing 40 passages an hour is not going to be reliably right, and no LLM-grades-LLM loop will tell us so.

---

## 1. The verbatim-fidelity gate

### 1.1 Principle: quote, never type

Any text the student sees that is supposed to *be* the book's text is a **sealed passage**: an immutable, checksummed blob produced once, reviewed once, and thereafter only ever *referenced* — never regenerated, never paraphrased, never re-typed by any stage of the pipeline or by the runtime tutor.

Downstream stages address passage content by `(passage_id, char_offset_start, char_offset_end)`. They may not emit passage text into their own fields. This is enforced deterministically (§1.6).

### 1.2 Two tiers of verbatim text

**Tier A — sacred text (Quran). Zero transcription. Corpus lookup only.**

Extraction agents are **forbidden** from transcribing Quranic text. They emit only a reference:

```
{ kind: "quran", surah: 25, ayah_from: 63, ayah_to: 70, script: "uthmani", riwaya: "hafs" }
```

The text is then materialised from a **pinned, vendored corpus file** (Tanzil Uthmani or equivalent — vendor choice is an open decision, §7.1), committed to the repo with its own `sha256` recorded in the extraction manifest. This converts an unbounded transcription risk into a bounded, one-time provenance question: *is this corpus file correct?* — answerable once, by a human, forever.

Per-passage verification then reduces to two small, discrete, easily-compared outputs:
- **Reference agreement:** two independent models each read the page and emit only `(surah, ayah_from, ayah_to)`. Integers. Exact match required. Any mismatch → human.
- **Rendered-vs-printed check:** a human sees the corpus-rendered text beside the page crop and confirms the range and script match what the book prints (§5).

Tier A also covers any ﴿…﴾ span anywhere in the book (T2), plus أحاديث if the later units contain them.

**Tier B — non-sacred verbatim (poetry, prose, book-authored sentences, table cells, the book's own questions). K-way consensus.**

No canonical corpus exists — and importantly, one would be *wrong*: we must reproduce **what this ministry book printed**, not what ديوان تبر وتراب prints. So:

1. Transcribe the same page region **K = 3 times, decorrelated**: different model family where available, different prompt framing, and at least one pass over an upscaled/cropped image rather than the full page. (Same model + same prompt three times produces correlated errors and a false unanimity — this must be enforced in the runbook, not left to chance.)
2. Normalize each output to **STORE form** (§1.3). Compare as **codepoint sequences**. Not embeddings, not similarity — sequence equality.
3. **Unanimous → seal.** Store the string, its `text_sha256`, the page ref, the K model IDs, and `normalizer_version`.
4. **Any disagreement → quarantine.** Never resolved by a model, never resolved by majority vote. It goes to a human with the page crop, the character-level diff, and the disagreeing positions highlighted (§5).

Majority-vote resolution is explicitly rejected: 2-of-3 agreement on a diacritic is exactly the signal that the page is hard to read, which is exactly when a human is needed.

### 1.3 Normalization — two normal forms, and never confuse them

Version this specification as `normalizer_version`. **Changing it invalidates every checksum and therefore every human approval** (§5.4). It is frozen at v1 below.

#### STORE form (what we persist, checksum, and display) — semantic-preserving

Applied in order:

1. **Unicode NFC.** This is load-bearing for two reasons:
   - *Diacritic ordering is solved deterministically.* Arabic marks carry distinct canonical combining classes (fathatan 27, dammatan 28, kasratan 29, fatha 30, damma 31, kasra 32, shadda 33, sukun 34, superscript alef 35), so canonical ordering sorts them into one order. شدة-then-فتحة and فتحة-then-شدة become the same codepoint sequence **without losing either mark**. Comparison is order-insensitive; content is not.
   - *Hamza carriers unify.* ا+U+0654 → أ, ا+U+0655 → إ, ا+U+0653 → آ, و+U+0654 → ؤ, ي+U+0654 → ئ. Two spellings of the same grapheme compare equal. NFC does **not** collapse أ/إ/آ/ا into each other — that distinction is preserved, as it must be.
2. **Strip tatweel U+0640 ONLY when it is bare** (T6). **AMENDED 2026-07-28 — the original blanket rule
   was wrong and would have corrupted scripture.** It was written from the book's *prose* («باب اللــوق»,
   printed p.13), where tatweel is pure justification. But in Uthmani Quranic text tatweel is routinely a
   **diacritic carrier**: measured on the real lesson passage (سورة الفرقان ٦٣–٧٠), **11 of 11 tatweels
   carry a combining mark** — ten hold the dagger alef U+0670 (ٱلرَّحْمَـٰنِ، يُضَـٰعَفْ، سَلَـٰمًا …) and one holds
   hamza U+0654 (سَيِّـَٔاتِهِمْ); **zero were bare**. Stripping them would have altered the text and then
   sealed the altered bytes under a valid-looking `text_sha256` — a corruption a human comparing against a
   page crop would very likely wave through.
   **The deterministic rule:** *tatweel followed by a combining mark is a carrier → **preserve** (it is
   text); bare tatweel is justification → strip.* Verified on real data: 11/11 carriers preserved,
   «اللــوق» still normalised. Normalizer bumped to `ar-norm-v2`; this was free because nothing had been
   sealed yet — which is precisely why Wave 0 exists.
3. **Strip / reject invisibles:** strip U+200B, U+FEFF, U+00A0→U+0020, U+200E, U+200F, U+061C. **Reject** (hard fail, not strip) U+200C, U+200D — they should never appear in book text and their presence signals a mangled source.
4. **Reject Arabic presentation forms** U+FB50–U+FDFF and U+FE70–U+FEFF — **except** the allowlist
   `U+FD3E ﴿`, `U+FD3F ﴾` (the legitimate Quran-quote brackets) and **`U+FDFA ﷺ`** (added 2026-07-28:
   the book prints this honorific in قاسم أمين's prose, PDF p.26). The rule's purpose is to catch
   *positional letter variants* copied from a broken PDF text layer, which break search and comparison.
   ﴿﴾ and ﷺ are **semantic ligatures, not positional variants**, and storing them as printed is faithful
   to the book — the alternative (spelling out صلى الله عليه وسلم) would silently change the printed text,
   which the sacred lane forbids. A presentation-form codepoint elsewhere means the model copied from a broken PDF text layer. Do **not** use blanket NFKC: it would destroy the ornate brackets and other meaningful distinctions.
5. **Reject non-Egyptian-Arabic codepoints:** U+06A9 (Farsi keheh), U+06CC (Farsi yeh), U+06BE, U+06C1, U+06F0–U+06F9 (Extended Arabic-Indic digits). Models occasionally emit these instead of ك / ي / ٠-٩. Silent, invisible at a glance, and a guaranteed defect.
6. **Preserve exactly, no exceptions:** all of U+064B–U+0656, U+0670 (dagger alef), U+0671 (ٱ), the Quranic mark range U+06D6–U+06ED (pause marks, ۝, small high seen/meem/rounded zero, sajdah), Arabic-Indic digits U+0660–U+0669 **as printed** (the book uses ٦٣، ١٩٥٧م، ١٧٥٥٠ — converting to ASCII digits is a fidelity defect; the *renderer* may localize, the *store* may not), ء/أ/إ/آ/ا distinctions, ة/ه, ى/ي (T5), all Arabic punctuation ، ؛ ؟.
7. **Whitespace:** collapse runs of space/tab to a single U+0020; trim ends. Line structure is **never** carried in the string — it is structural (§1.4): poetry stores hemistichs, Quran stores per-ayah, prose stores paragraphs.

#### COMPARE-LOOSE form — a router and a student-answer comparator, never an acceptance criterion

Strip all of U+064B–U+0656, U+0670, U+06D6–U+06ED; map أ إ آ ٱ → ا; ى → ي; ة → ه; ؤ → و; ئ → ي; strip tatweel.

Two and only two legitimate uses:

- **Routing a Tier-B disagreement:**
  - identical in LOOSE **and** in STORE → PASS.
  - identical in LOOSE, differ in STORE → **DIACRITIC DISPUTE** — the dangerous class, highest-priority human queue.
  - differ in LOOSE → **WORD DISPUTE** — one transcriber misread a word; also human, separate queue.
- **Grading a student's typed answer**, where a student writing «هونا» for «هَوْنًا» or «فى» for «في» must be accepted (T5).

**LOOSE form is never used to accept a passage, never stored, never displayed.** Cosine similarity, edit distance and embedding comparison have no role anywhere in this gate.

### 1.4 The seal artifact

```
passage {
  id, lesson_id, kind: quran|hadith|poem|prose|table_cell|book_question,
  printed_page,
  units: [ ... ]           // structure, not a blob: see below
  store_text,              // the canonical STORE-form string (concatenation of units)
  text_sha256,             // sha256(utf8(store_text))
  normalizer_version,
  provenance: { tier, corpus_ref|transcribers[], seal_run_id },
  review: { status, reviewer, at, approved_sha256 }
}
```

`units` is structural so that a diff localises and a defect is small:
- Quran → `[{ ayah: 63, text }, … { ayah: 70, text }]`
- Poetry → `[{ bayt: 1, sadr, ajuz }, … ]`
- Prose → `[{ para: 1, text }, … ]`
- Table → `[{ row, col, text }]`

Ayah-number glyphs (۝ + digits) and hemistich layout are **rendering concerns**, not string content.

### 1.5 Deterministic structural checks (free, and they catch real defects)

| Check | Applies to | Rule |
|---|---|---|
| Ayah count & contiguity | Quran | `ayah_to − ayah_from + 1` units, no gaps, monotonic |
| Bayt count | poetry | equals the count declared by the segmenter from the printed page (7 for كن جميلا); each بيت has exactly two non-empty hemistichs |
| **No dedupe** | poetry, prose | identical unit strings are legal and must be preserved (T3: بيت 1 and بيت 7 share a صدر). Any dedupe-by-hash step is a bug; assert count before/after every transform |
| **القافية** | poetry | all أعجاز end with the same rhyme letter after stripping harakat (all ـلا here). A column-scramble, a merged line, or a dropped بيت breaks this immediately |
| Table completeness | معاني المفردات, إملاء | rows × cols matches the segmenter's declared grid; every declared non-empty cell is non-empty; **declared-empty cells stay empty** (T8) |
| Pair integrity | معاني المفردات | a second independent read produces the same *set of (word, gloss) pairs*; a transposition changes the set (T7) |
| Charset | all | no codepoint outside the STORE-form allowlist |

### 1.6 The no-retyping lint (deterministic, build-time and runtime)

The seal protects the passage. This protects everything *around* it — the far likelier real-world defect: the passage is sealed correctly, and then a question stem, a model answer, a claim, or a live tutor turn quotes it from memory with a mark changed.

**Rule.** For every LLM-produced Arabic field, compute the longest common word-run against each sealed passage in the same lesson, comparing in LOOSE form. If a run of **≥ 4 consecutive words** matches a sealed passage in LOOSE form but the corresponding STORE-form substrings are not identical → **RED**.

Interpretation: *you are quoting the book — so quote it exactly, or don't quote it.* This is the Arabic analogue of the math contradiction-fallback rule.

- **Build time:** blocks the bundle.
- **Runtime:** the tutor's output is repaired before display — the offending run is replaced with the sealed substring (the verbatim-canonical fallback), and the event is logged as `verbatim_fallback_fired` for the eval dashboard. For a Tier-A (Quran) match, do not repair silently: suppress the quote entirely and render the sealed passage block instead. **No AI-generated text is ever rendered inside a Quranic passage block** — no inline gloss, no annotation that could be mistaken for the text.

### 1.7 Placement and failure behaviour

Adapting `rich-lesson.workflow.js`, the Arabic conveyor inserts a stage before Claims and adds checks at three later points:

```
0  Manifest (printed = PDF − 1)
1  Segment          objectives box, sections, printed-page map, declared counts
                    (bayt count, table grid, ayah range)   ← counts are the oracle's contract
2  SEAL   ← NEW     Tier A corpus lookup / Tier B K-way consensus → sealed passages
3  Claims / exposition        must cite (passage_id, offsets); may not re-type
4  Questions        typed: iraab | imlaa | mufradat | tazawwuq | fahm
5  Verify           5a إعراب structural re-derivation + rule table (§2)
                    5b open-ended rubric grading + trap set (§3)
                    5c provenance audit (existing, unchanged)
                    5d verbatim re-check + no-retyping lint (§1.6)
6  Coverage oracle  language-lesson checklist (§4)
7  Assemble         checksums re-verified after every transform
8  Human gate       per-artifact status defaults (§5)
9  Load             loader re-verifies checksums; refuses --approve-all for sealed types
10 Runtime          render from sealed blob; verify checksum at read; §1.6 runtime guard
```

**On failure — no auto-repair, ever.**
- Tier-A reference mismatch, or any Tier-B disagreement → passage `quarantined`; the lesson cannot reach the human gate until resolved by a human.
- Checksum mismatch at *any* point after sealing (assemble, load, render) → **quarantine the whole bundle**, not just the passage. A checksum that moves means a stage is mutating sealed text; that is a pipeline defect and the blast radius is unknown.
- Runtime checksum mismatch → the passage renders as an explicit unavailable state with an alert. It never renders possibly-corrupted sacred text. This is the one place a visible product degradation is unambiguously correct.

---

## 2. إعراب verification

### 2.1 Structure, not string

إعراب answers are stored and compared as records, never as free text. Free text is generated *from* the record for display.

```
iraab_answer {
  token,                 // the word being parsed, with its harakah, as a passage offset ref
  function,              // منادى | مضاف إليه | صفة | بدل …
  state: "معرب" | "مبني",
  case: "منصوب" | "مرفوع" | "مجرور" | null,
  marker,                // الفتحة | الكسرة | الياء | الألف | الضم | الواو
  marker_kind: "أصلية" | "فرعية" | "بناء",
  position: null | "في محل نصب",     // for مبني
  subtype,               // مضاف | شبيه بالمضاف | نكرة غير مقصودة | علم مفرد | نكرة مقصودة | ما فيه ال
  reason,                // e.g. لأنه جمع مذكر سالم
  followers: [ … ]       // مضاف إليه مجرور … etc.
  rendered_ar            // the display sentence, generated from the fields above
}
```

### 2.2 The rule table — a deterministic third voter

This is the single most important addition, and it is what the Social Studies pipeline never needed. Two independent models can be **correlated-wrong**: both trained on the same grammar, both making the same classic mistake. A two-model agreement scheme cannot detect that. A rule table can.

The lesson's own printed rules (pp. 11, 12, 16, 17, 22) are a closed, finite system. Encode them once, by a human, from the book, and review that encoding as a first-class artifact:

**المنادى المعرب — منصوب. Marker by the noun's number/type:**

| Noun type | Marker |
|---|---|
| مفرد | الفتحة |
| جمع تكسير | الفتحة |
| جمع مؤنث سالم | الكسرة |
| مثنى | الياء |
| جمع مذكر سالم | الياء |
| الأسماء الخمسة | الألف |

Applies to the three معرب subtypes: **المضاف**، **الشبيه بالمضاف**، **النكرة غير المقصودة**.

**المنادى المبني — مبني على ما يُرفع به، في محل نصب. Subtypes: العلم المفرد، النكرة المقصودة:**

| Noun type | Built on |
|---|---|
| مفرد / جمع تكسير / جمع مؤنث سالم | الضم |
| مثنى | الألف |
| جمع مذكر سالم | الواو |

**نداء ما فيه (ال):** أداة + أيُّ (مذكر) / أيَّةُ (مؤنث) + ها للتنبيه; أيّ **مبني على الضم في محل نصب** (نكرة مقصودة); the noun after (ال) is **مرفوع** as صفة أو بدل. Exception: لفظ الجلالة — «يا ألله» with همزة قطع, or أداة النداء deleted and compensated by مشددة ميم: «اللهم».

**Enforcement.** Given `(subtype, noun_type)` the pair `(case/state, marker)` is *derivable*. Any إعراب answer is checked against the table deterministically. **A contradiction is RED regardless of model agreement.** Where a topic has no table yet (future units), fall back to two-model + human, and note the gap in the coverage report.

The table is versioned data owned by QA, authored from the printed page, and human-reviewed like a passage. It is also directly reusable as the runtime grader's key.

### 2.3 Comparison: equivalence, not string equality

An independent model (≠ the author, per house rule) re-derives the إعراب from the sealed sentence alone, without seeing the proposed answer, and emits the same record shape. Then:

1. **Token alignment first.** If the two records parse different tokens, that is `DISAGREE` (or a malformed question) — compare nothing further.
2. **Synonym mapping** via a curated, versioned table. Examples: «الفتحة» ≡ «الفتحة الظاهرة» ≡ «فتحة ظاهرة على آخره»; «مبني على الضم» + `position: في محل نصب` ≡ «مبني على الضم في محل نصب»; «منصوب بالياء» ≡ «منصوب وعلامة نصبه الياء نيابة عن الفتحة». Data, not model judgement.
3. **Core fields** — `function`, `state`, `case`, `marker` — must match after synonym mapping.
4. **Subset-compatibility = agreement.** «منادى منصوب وعلامة نصبه الفتحة» vs «منادى مضاف منصوب وعلامة نصبه الفتحة الظاهرة على آخره، وهو مضاف» — the second is a *superset*, not a disagreement. Formally: agreement iff core fields are equal after mapping **and** no field present in both has conflicting values. Fields present in only one record are elaboration.
5. **Rule-table consistency** checked on both.

**Three verdicts:**

| Verdict | Condition | Action |
|---|---|---|
| **AGREE** | core fields equal, no conflicts, both rule-table consistent | question proceeds to the human gate as auto-`live` candidate |
| **VARIANT** | compatible but differ in fullness/wording, both rule-table consistent | **not a defect.** Store the fuller form as the model answer; add every variant to `accepted_answers` |
| **DISAGREE** | any core-field conflict, token mismatch, or **either** answer contradicting the rule table | block the question; human decides; log as a defect for the trend metric |

**The verification output is a product artifact.** `accepted_answers` is exactly what the runtime grader needs to avoid marking a correct student answer wrong. This kills the naive string-match false-failure problem at its source: the set of acceptable phrasings is produced by the verification stage, versioned with the question, and grown when a human resolves a VARIANT.

### 2.4 Adversarial probe

For each إعراب question, generate three plausible-wrong answers of specific shapes and require the grader to reject all three:
- right `function`, wrong `marker` (منادى منصوب وعلامة نصبه **الكسرة** on a مفرد);
- wrong `state` (treating a نكرة مقصودة as معرب منصوب — the classic student error, and the classic model error);
- right structure, wrong token (parsing the مضاف إليه instead of the منادى).

A grader that accepts any of these is broken and blocks the release (§6).

---

## 3. Open-ended answers (شرح / تذوق / مواطن الجمال)

There is no key, but there **are** wrong answers — and, crucially, the book prints its own شرح النص and مواطن الجمال boxes (pp. 9, 15, 21). Those boxes are the acceptance boundary.

### 3.1 Every open-ended question carries an acceptance spec

```
acceptance_spec {
  reference: [passage_ref…],     // the book's own شرح / مواطن الجمال / مفردات, sealed
  required_elements: [ … ],      // propositions an acceptable answer must contain
  credit_variants: [ … ],        // alternative valid framings of an element
  disqualifiers: [ … ],          // statements that make an answer wrong regardless of the rest
  register: "فصحى",
  length: { min_words, max_words }
}
```

Worked example — «(يمشون على الأرض هونًا): ما موطن الجمال؟» (p.9):
- `required_elements`: [names it as a تعبير جميل / صورة; connects هونًا to التواضع or السكينة والوقار]
- `credit_variants`: [«يدل على تواضعهم», «كناية عن التواضع», «تصوير لمشيهم في سكينة»]
- `disqualifiers`: [calls it an أسلوب استفهام or أمر; glosses هونًا as سرعة or ضعف; asserts a تفسير claim not in the book]

Worked example — «كيف تغدو إذا غدوت عليلا؟» (p.15):
- `required_elements`: [identifies استفهام; states its غرض = الاستنكار]
- `disqualifiers`: [treats it as a genuine request for information; attributes the poem to another poet]

**Grounding rule (T9):** the reference may point anywhere on the lesson's pages, not only to a printed "answer". The fill-in «"اصرف" فعل ..... يفيد: .....» is keyed by the مواطن الجمال bullet on the same page. If no reference on the lesson's pages can satisfy the `required_elements`, the question is **unanswerable from the book** and is dropped — not "graded leniently".

### 3.2 Independent grader protocol

The grader model is given: the sealed passage, the book's own boxes, and the `acceptance_spec`. It is **not** given the author's model answer.

It returns, per element: found / not-found, with an **evidence citation as passage offsets** — never re-typed text (§1.6). Verdict ∈ `acceptable | incomplete | wrong`, plus which disqualifier fired if any.

**Self-consistency check.** Run the grader on the *author's own model answer*. If the author's answer fails its own rubric, either the rubric or the answer is wrong — a deterministically detectable inconsistency and, in my experience with the Social Studies pass, the cheapest defect-finder in the whole set. Block the question.

**Inter-grader agreement.** Two graders on the same answer. Disagreement means the **question is ambiguous**, not that the answer is bad → route to human. Track the disagreement rate as a health metric per lesson.

### 3.3 Trap set — the thing that makes rubric grading trustworthy

For each open-ended question, three deliberately-wrong answers:

| Trap | Shape | What it detects |
|---|---|---|
| **fluent-empty** | restates the line beautifully without naming the device or the meaning | grader rewarding fluency (the dominant LLM-judge failure) |
| **plausible-wrong** | names the wrong device (calls a نداء an استفهام; calls a تضاد a تشبيه) | grader not actually checking the element |
| **off-book** | a true-sounding literary fact not in the lesson (e.g. a biographical claim about أبو ماضي beyond the book's footnote) | grader importing outside knowledge — the thing that makes the tutor ungroundable |

**A grader that passes a trap is a broken grader.** Trap-rejection rate is a release gate (§6), not a report line. This is the Arabic equivalent of "0 answer errors across 754 questions": the number we will be asked to defend.

### 3.4 Deterministic language lints (all generated Arabic, every stage)

- **Colloquialism blocklist** — مش، عشان، ده، دي، دول، إزاي، بتاع، كده، أوي، حاجة (as "thing"), عايز، لسه. Egyptian colloquial in a فصحى lesson is an instant credibility loss with the parent. Cheap, deterministic, catches a real failure mode.
- **Ministry-terminology allowlist** — the answer must use the book's own terms: مواطن الجمال، أسلوب مؤكد، غرضه الاستنكار، أمر غرضه النصح والإرشاد، تضاد، نداء للتنبيه، منادى مضاف / شبيه بالمضاف / نكرة مقصودة. Off-syllabus terminology (بلاغة terms not introduced in Prep-3) is flagged.
- **Length band** per question type.
- **Charset lint** — §1.3 rules 3–5 applied to *all* generated Arabic, not only passages.

---

## 4. The coverage oracle for a language lesson

"Complete" for a language lesson is defined by the book itself. The oracle scores this checklist and, exactly as in `rich-lesson.workflow.js`, **GREEN only if every item is `covered` or explicitly `OUT_OF_SCOPE` with a recorded reason.** Any `MISSING` or `thin` on a load-bearing item is RED and blocks the bundle.

The critical addition over the Social Studies oracle is the third status. Lesson 1 has 8 printed objectives, two of which we cannot assess in an MVP with no audio capture and no handwriting surface (T11). Silently dropping them reproduces the "Africa-only" failure in its language form. Declaring them makes the product's real gaps visible to Samuel and to the parent, rather than invisible.

| # | Item | Source in the book | "covered" means | Deterministic check |
|---|---|---|---|---|
| 1 | **أهداف الدرس** | the objectives box (pp. 8, 14, 19) | every numbered objective maps to ≥1 LO **and** ≥1 question, or carries `OUT_OF_SCOPE(reason)` | objective count from the box == mapped+declared count |
| 2 | **النص** | the lesson's primary text | sealed, complete, correct unit count | §1.5: ayah 63–70 contiguous / 7 أبيات with صدر+عجز / every printed paragraph of both قصة أثر sections |
| 3 | **معاني المفردات** | the printed gloss table | every cell extracted, pairing correct | cell count matches; pair-set identical on a second independent read (T7) |
| 4 | **شرح النص/الآيات** | the شرح box | present; every sentence traceable to the box | provenance audit (5c) |
| 5 | **مواطن الجمال** | the مواطن box | every printed bullet captured, each with its cited line **and** its named device | bullet count (5 in lesson 1, 5 in lesson 2) |
| 6 | **اللغويات / التراكيب** | the grammar sections | topic definition + **full** taxonomy as the book presents it + every printed example + every إعراب rule row + the exceptions | for المنادى: 3 معرب subtypes + 2 مبني subtypes + ما فيه ال + يا ألله/اللهم + حذف أداة النداء; every row of §2.2 has ≥1 question |
| 7 | **الإملاء** | the case tables (pp. 12, 18, 23) | every rule row/column with its rule statement and its printed examples; **student-blank cells preserved as blanks** | grid dimensions match; every printed example word present; declared-empty stays empty (T8) |
| 8 | **التعبير** | the تحدث/التعبير prompt | prompt captured verbatim + a model response plan | prompt is a sealed passage |
| 9 | **الخط** | «يكتب نموذجًا بخطي النسخ والرقعة» | expected `OUT_OF_SCOPE("no handwriting capture surface in MVP")` — surfaced in the UI, not hidden | declaration exists |
| 10 | **التلاوة / الإلقاء** | «يتلو تلاوة صحيحة», «يلقي إلقاءً معبرًا» | expected `OUT_OF_SCOPE("no audio capture in MVP")` | declaration exists |
| 11 | **أسئلة الكتاب نفسها** | اسأل وناقش / ناقش زملاءك / اقرأ ثم ناقش | **every printed question appears in the bank** — these are what the teacher will actually ask | printed question count == bank count for that lesson |
| 12 | **الصناديق الإثرائية** | القضايا المتضمنة، قرأت لك، اقرأ واستمتع، انظر وتأمل | captured or declared | box count from the segmenter |

---

## 5. The human review gate

The existing invariant stands and is tested as an invariant, not a feature: **nothing with `status ≠ live` is ever servable.** Arabic adds a second axis.

### 5.1 Approval is bound to a checksum

A human does not approve "this passage" — they approve **this exact byte sequence**. `review.approved_sha256` is stored. If `text_sha256` ever differs from `approved_sha256`, the artifact is **automatically demoted out of `live`**, no exceptions, no override flag. This is the invariant test I care most about: *mutate one harakah in a live sealed passage in a test fixture and assert the passage stops being servable.*

Corollary: bumping `normalizer_version` changes every checksum and therefore revokes every approval. That is correct and intended — a change to what "the text is" is a change that a human must re-confirm. It also means the normalizer spec must be treated as frozen and changed rarely and deliberately.

### 5.2 Default status by artifact type

| Artifact | Default | Promotion to `live` requires | Bulk approve? |
|---|---|---|---|
| **Quran passage** | `sealed_pending_scholar` | **two** sign-offs: (a) an Arabic/religious-studies-qualified reviewer confirms ayah range, script, and character-exact match against the page crop; (b) a designated owner confirms corpus provenance (edition, رواية حفص عن عاصم, corpus sha256) | **Never.** The loader must hard-refuse `--approve-all` for this type |
| **Hadith / any ﴿…﴾ span** | `sealed_pending_scholar` | as above | Never |
| **Poetry / prose passage** | `review` | one human sign-off with page crop side-by-side and the K-way diff shown | per-lesson only, and only after the diff view has been opened (record the interaction) |
| **معاني المفردات، شرح، مواطن الجمال** | `review` | one Arabic-teacher sign-off (book's own words — fast) | per-lesson |
| **إعراب / إملاء / MCQ / fill-in question** | `review` | auto-`live` candidate **only if** rule-table consistent **and** verdict AGREE **and** no §1.6 lint hit; otherwise `blocked` | yes, but with a mandatory ≥20% sampling audit before the first cohort |
| **Open-ended شرح/تذوق question** | `review` | **always human.** The grader pre-screens; it does not approve | no |
| **الخط / التلاوة items** | `out_of_scope` | n/a — rendered as a declared gap in the UI | n/a |

### 5.3 What the human must actually see

The review surface is part of the gate, not a convenience. Approving without this evidence is not approval:

1. the page crop at ≥300% zoom, positioned on the passage;
2. the sealed text rendered in the **student's** font, size and RTL context — the same renderer the student gets, so that a rendering defect is caught here and not in a parent's screenshot;
3. a character-level diff panel marking every position where the K transcriptions disagreed (empty for a unanimous seal — and the reviewer should see that it is empty);
4. unit counts (ayah range, bayt count, table grid) beside the printed counts;
5. the checksum being approved, and the reviewer's identity and timestamp recorded against it.

### 5.4 Religious-content escalation

- Any student-visible sentence asserting a religious ruling, a تفسير, or an attribution of divine intent that is **not verbatim from the book's شرح box** → blocked, human-only, no auto-`live` path.
- The runtime tutor **refuses تفسير**. Explanation of a verse is bounded by the book's شرح الآيات and معاني المفردات. Out-of-bounds requests get the existing refuse-outside behaviour, not a best-effort answer.
- No AI-generated text renders inside a Quranic passage block (§1.6).
- This vertical needs a named human owner with the standing to make religious-content calls before the first family sees it. That is a hiring/assignment question, not an engineering one (§7.4).

---

## 6. Eval set, release gates, and metrics

**Versioned eval set** (`evals/arabic/vN/`), run on every prompt or model change, scores tracked over time — same discipline as the explanation-pipeline evals:

- `seal/` — page regions with human-confirmed ground-truth STORE strings, including deliberately hard ones (the poem's repeated صدر, a tatweel-stretched heading, the RTL gloss table).
- `iraab/` — parsed items across all rows of the §2.2 rule table, plus the §2.4 adversarial probes.
- `openended/` — questions with acceptance specs, each with 1 good answer and the 3 traps (§3.3).
- `lints/` — malformed input: colloquial answers, Persian codepoints, presentation forms, a passage with one harakah changed, a tutor turn that paraphrases a verse.

**Release gates (all must hold):**

| Gate | Threshold |
|---|---|
| Sealed-passage character defects | **0** — the headline number, the Arabic analogue of "0 answer errors / 754 questions" |
| Rule-table contradictions in live إعراب answers | **0** |
| Grader trap-rejection rate | **100%** on the versioned trap set |
| §1.6 no-retyping lint hits in a live bundle | **0** |
| Coverage oracle | GREEN, with every `OUT_OF_SCOPE` carrying a reason |
| Quran passages in `live` without two sign-offs | **0** (invariant test, not a report) |

**Tracked over time (trend, not gate):** Tier-B unanimity rate; diacritic-dispute rate per 1000 characters; AGREE/VARIANT/DISAGREE distribution; inter-grader disagreement rate; first-pass coverage GREEN rate; human-gate rejection rate; `verbatim_fallback_fired` count in runtime.

**Invariant tests (the adversarial set — I write these against the implementation, not the spec):**
1. mutate one harakah in a `live` sealed passage → it stops being servable;
2. `--approve-all` against a bundle containing a Quran passage → loader refuses, non-zero exit;
3. bump `normalizer_version` → every approval revoked;
4. feed a tutor turn that paraphrases الفرقان ٦٣ → runtime suppresses the quote and renders the sealed block;
5. inject U+06CC (Farsi yeh) into an extracted passage → charset lint blocks;
6. delete بيت 7 of the poem → قافية + count checks fire;
7. transpose two cells of the معاني المفردات table → pair-set check fires;
8. give the grader the three traps for every open-ended question → all rejected.

---

## 7. Open decisions for Samuel

These are proposals with trade-offs, not decisions. Each accepted answer becomes an ADR.

1. **Quran corpus vendor and edition.** Recommend a pinned, checksummed Tanzil Uthmani (حفص عن عاصم) text vendored into the repo. Trade-off: a licensing/attribution review is required, versus the alternative (transcription) which I consider unacceptable at any quality bar. **My recommendation: corpus, non-negotiable.**
2. **K for Tier-B consensus, and model decorrelation.** K=3 with at least two model families costs roughly 3× the transcription budget for a small fraction of each lesson's tokens. K=2 halves the cost and raises the human-adjudication queue. Recommend K=3 for poetry and Quranic-adjacent text, K=2 for ordinary prose.
3. **Who is the Arabic reviewer?** The gate in §5 is not implementable without a qualified human. This connects to the open "part-time teacher hire" question already in `PROJECT_STATE.md` — for Arabic it is a harder requirement than for math.
4. **Religious-content owner.** A named person who signs off Quran-bearing artifacts and owns the escalation path (§5.4). Recommend this is not Samuel by default — it should be someone with standing to make the call.
5. **Scope of الخط / التلاوة.** Recommend declaring both `OUT_OF_SCOPE` for the MVP and **saying so in the product** (a visible "this lesson has a handwriting/recitation component we don't assess"), rather than quietly under-covering the book. Honest gaps sell better to a parent than invisible ones.
6. **Tooling for the seal store.** Whether sealed passages live in the existing content JSON with checksums, or in a separate content-addressed store (which would match the spine's existing sha256-passport pattern from `/pipeline`). The latter is more consistent with ADR-0001; the former ships faster.

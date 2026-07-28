# Arabic Language Extraction Contract — `course:prep3-arabic-ar`

- **Status:** PROPOSAL for Samuel (architect). Intended to become an ADR. Nothing here is locked until he accepts or amends it.
- **Authority:** ADR-0001 (data-spine thesis, MVP-cut discipline Ch. 19.6), ADR-0004 (multi-subject spine, sensitive-content stance), ADR-0005 (extraction line + coverage oracle). Human review gate is final on everything.
- **Source:** `docs/Source/Arabic_Prp3_Tr1_2.pdf` — «لغتي حياتي — اللغة العربية، الصف الثالث الإعدادي، الفصلان الدراسيان»، وزارة التربية والتعليم والتعليم الفني، الإدارة المركزية لتطوير المناهج، طبعة ٢٠٢٥–٢٠٢٦م. **Printed page = PDF index − 1.**
- **Sibling contracts:** `docs/specs/social-extraction-contract.md` (the contract this one deliberately breaks from), `services/extraction/schemas.py` (models being extended).

---

## 0. Why the existing atom does not fit

Our current grounding atom is a **claim with a page citation** (`ClaimStep`), built for history/geography facts: a sentence that is true, supported by a page, and checkable by re-reading that page. Two things about Arabic break it.

**1. The primary atom is a verbatim text, not a claim.** A Quran passage or a line of poetry is not a proposition to be supported — it is an artefact to be reproduced *exactly*, with full تشكيل, verse numbering, and (for poetry) the صدر/عجز split. Paraphrase is not a lower-fidelity version of it; paraphrase is a **defect**, and for Quran a serious one. No amount of page-citation machinery protects a character.

**2. The secondary atom is a rule that is applied, not recalled.** إعراب is derived per-word from a rule the book states. «يا طالبَ العلم» → *منادى مضاف منصوب وعلامة نصبه الفتحة الظاهرة* is not a fact on page 11; it is the *output of* the rule on page 11 applied to a word in a sentence. Storing it as a claim loses the derivation, loses the ability to diagnose *which part* a student got wrong, and loses the ability to verify it independently.

The book itself confirms the shape. Lesson 1 (عباد الرحمن، ص٨) bundles: نص قرآني (الفرقان ٦٣–٧٠) + معاني المفردات + شرح الآيات + مواطن الجمال + التراكيب اللغوية (المنادى) + إملاء (الهمزة المتوسطة على واو) + قطعة إملاء («باب اللوق») + تعبير + خط. Lesson 2 (كن جميلا، ص١٤) is the same skeleton over a poem by إيليا أبو ماضي. Lesson 3 (قصة أثر، ص١٩) is the same skeleton over informational prose (الكنيسة المعلقة / قلعة قايتباي). **The Arabic lesson is a fixed component set, not a variable list of subtopics** — which, as §5 shows, gives us a much stronger completeness oracle than social studies has.

A third structural finding, from the book's own contents table (PDF p.7): the grammar column runs **المنادى المضاف/الشبيه بالمضاف/النكرة غير المقصودة (ص٨) → المنادى المفرد/النكرة المقصودة (ص١٤) → نداء ما فيه ال (ص١٩) → البدل وأنواعه (ص٢٥) → تابع أنواع البدل (ص٢٩، ص٣٢) → أسلوبا المدح والذم (ص٣٦) → …**. A grammar rule is a **unit-spanning object taught in installments**, not a lesson-local one. Any rule "no grammar outside this lesson" would forbid the book's own lesson 3 from using lesson 1's نصب signs. The correct rule is cumulative and is specified in §4.5.

---

## 1. Bundle rules and identity

Follows the `SeedBundle` shape with Arabic-specific artefact arrays (§2).

```json
{
  "source_document": {
    "title": "لغتي حياتي — اللغة العربية، الصف الثالث الإعدادي، الفصلان الدراسيان",
    "publisher": "Arab Republic of Egypt — Ministry of Education & Technical Education",
    "edition": "2025-2026",
    "language": "ar",
    "grade": "prep-3",
    "subject": "arabic language",
    "file_path": "docs/Source/Arabic_Prp3_Tr1_2.pdf"
  },
  "syllabus_version": "2025-2026",
  "external_node_refs": ["program:bakaloreya-track"]
}
```

| Entity | Pattern | Example |
|---|---|---|
| Course | `course:prep3-arabic-ar` | — |
| Module (unit) | `module:ara-u<U>` | `module:ara-u1` |
| Lesson slug | `ara<unit>-<lesson>` | `ara1-2` |
| Learning objective | `lo:ara<unit>-<lesson>-<n>` | `lo:ara1-2-3` |
| Question | `q:ara<unit>-<lesson>:NNN` | `q:ara1-2:004` |
| Text passage | `t:ara<unit>-<lesson>:NNN` | `t:ara1-1:001` |
| Grammar rule | `gr:<latin-slug>` | `gr:munada` |
| Rule clause | `gc:<rule>:<latin-slug>` | `gc:munada:mudaf-sign-fatha` |
| Spelling rule | `sp:<latin-slug>` | `sp:hamza-mid-waw` |

- `ara1-2` satisfies the app slug rule `^[a-z0-9]{1,12}-[0-9]{1,3}$` (`SLUG_RE`, `app/src/lib/lesson.ts`).
- **Ids ASCII only; every content field Arabic, the book's own wording.**
- **Numerals:** Arabic-Indic inside Arabic text exactly as printed (`٦٣`, `١٧٥٥٠`); Latin only in ids and structural integer fields.
- **Subject key:** `subjectOfCourse` currently derives the subject from the course-id suffix. `-arabic-ar` needs adding — a one-line runtime change, not a data change. Flagged in §7.
- **No watermark blacklist needed** — unlike the social book, this PDF's footers carry only the ministry line and the printer's mark. Keep a generic footer-string grep in the gate anyway (§8).

---

## 2. Artefact types

Pydantic-style, mirroring `schemas.py` conventions. Every model justified; three candidate models are **cut** at the end of this section.

### 2.0 Normalization primitives (used by every validator and grader)

```python
def norm_exact(s: str) -> str:
    """NFC only. Identity/hashing/fidelity. NEVER strips a diacritic."""

def norm_key(s: str) -> str:
    """Matching only, never storage or display:
    NFC → drop harakat U+064B–U+0652 and superscript alef U+0670
        → أ إ آ ٱ → ا  ·  ى → ي  ·  ة → ه
        → drop tatweel U+0640 → collapse whitespace."""
```

Quranic marks (U+06D6–U+06ED), sukun, shadda and superscript alef are **preserved by `norm_exact`** and must survive storage untouched. `norm_key` exists so a student typing «الطلاب» matches a stored «الطُّلابِ` — it is applied to *answers*, never to *passages*.

### 2.1 `TextPassage` + `TextUnit` — the primary atom

```python
Fidelity = Literal["sacred", "literary", "prose"]

class TextUnit(BaseModel):
    n: int                       # 1-based index within the passage
    printed_n: Optional[str]     # as printed, Arabic-Indic: "٦٣" … "٧٠"
    text_ar: str                 # full string incl. تشكيل, exactly as captured
    sadr_ar: Optional[str]       # poetry only
    ajuz_ar: Optional[str]       # poetry only

class TextPassage(BaseModel):
    id: str
    lesson: str
    kind: Literal["quran", "hadith", "poetry", "prose", "dictation"]
    fidelity: Fidelity
    title_ar: str                # "عِبادُ الرَّحمنِ"
    attribution_ar: str          # "سورة الفرقان (٦٣ – ٧٠)"
    corpus_ref: Optional[str]    # machine ref for the corpus lane: "quran:25:63-70"
    units: list[TextUnit]
    text_sha256: str             # sha256 of norm_exact("\n".join(unit texts)) — the identity
    capture_lane: Literal["corpus", "double_blind"]
    approved_by: Optional[str]   # human sign-off on the hash; required before load
    source_page: int
```

**Three fidelity tiers, and they are not cosmetic — they select the capture lane and the runtime policy (§4).**

| tier | what | capture | runtime |
|---|---|---|---|
| `sacred` | Quran, Hadith | **corpus only** | model may never emit the text; span tokens only |
| `literary` | poetry (memorized, recited, quoted verbatim in exams) | double-blind | may quote, character-exact, scripted post-check |
| `prose` | informational text, dictation passages | double-blind | may quote or paraphrase in شرح |

Validators: `sacred` ⇒ `capture_lane == "corpus"`; `poetry` ⇒ every unit has both `sadr_ar` and `ajuz_ar`; `text_sha256` must recompute; `approved_by` required for `status: live`.

*Why it earns its place:* it is the atom. Everything else in the lesson points at it.

### 2.2 `VocabItem` — معاني المفردات

```python
class VocabItem(BaseModel):
    lesson: str
    word_ar: str                  # verbatim, with تشكيل as printed: "هونًا"
    gloss_ar: str                 # "بسكينة و وقار"
    plural_ar: Optional[str]      # "أدواء"  (book prints: داء … وجمعها (أدواء))
    singular_ar: Optional[str]    # "طائفة"  (book prints: طوائف … مفردها (طائفة))
    antonym_ar: Optional[str]     # NOT printed anywhere in this book — see below
    authored: bool = False        # True for any field not printed in the book
    passage_ref: Optional[str]
    unit_n: Optional[int]         # which آية / بيت the word sits in
    source_page: int
```

**Sharp finding worth Samuel's attention:** the معاني المفردات tables print **معنى**, and sometimes **جمع** or **مفرد** — they never print **مضاد**. Yet the book's own drills demand it («داء - الجناة - الرحيل» هات معنى الأولى ومفرد الثانية ومُضاد الثالثة، ص١٦؛ «حصن - الروايات - القديم»، ص٢٢). So antonyms are **authored content that the book does not license**. Marking them `authored: true` routes them to the human gate as first-class review items instead of laundering them as extracted fact. Same treatment for any جمع/مفرد we supply that the book didn't print.

*Why it earns its place:* it is the answer key for a whole question type (§3, `lexical`) and it is graded by set membership, not by an LLM. Cheap, exact, cacheable.

### 2.3 `RhetoricNote` — مواطن الجمال

```python
RhetoricType = Literal[
    "تشبيه", "استعارة", "كناية", "تضاد", "أسلوب مؤكد", "نداء", "استفهام",
    "أمر", "نهي", "تعبير يوحي", "أفعال مضارعة", "إطناب", "إيجاز", "حسن تعليل",
]
RhetoricPurpose = Literal[
    "التنبيه", "الاستنكار", "النصح والإرشاد", "الدعاء", "التعجب", "التقرير",
    "التمني", "التحذير", "الاستمرار والتجدد", "التوكيد", "التعليل",
]

class RhetoricNote(BaseModel):
    id: str
    lesson: str
    passage_ref: str
    unit_n: Optional[int]
    expression_ar: str            # MUST be a character-exact substring of the passage
    span: Optional[SpanRef]       # computed by the pipeline, never authored
    type: RhetoricType
    purpose: Optional[RhetoricPurpose]
    effect_ar: str                # الأثر, the book's own wording
    verbatim_from_book: bool      # True = printed in مواطن الجمال; False = authored
    source_page: int
```

The enums are drawn from the book's own printed notes — e.g. «(يسرفوا - يقتروا) تضادٌ يبرز المعنى ويوضحه ويؤكده» (ص٩)؛ «أيهذا الشاكي: نداءٌ للتنبيه» و«كيف تغدو إذا غدوت عليلًا؟: استفهام غرضه الاستنكار» و«فتمتع بالصبح: أمرٌ غرضه النصح والإرشاد» (ص١٥).

*Why closed enums matter:* they make الغرض البلاغي MCQ-able and free-text-gradeable **without an LLM judge**, and they are the structural defence against MSA-translated-from-English rhetoric terminology reaching a student. A new label is not a generation decision — it is a human decision to extend the enum.

### 2.4 `GrammarRule` + `RuleClause` — التراكيب اللغوية

```python
class RuleClause(BaseModel):
    id: str                       # "gc:munada:mudaf-sign-ya-jam-mudhakkar"
    text_ar: str                  # verbatim rule sentence from the book
    kind: Literal["definition", "tool", "type", "condition", "sign", "exception", "note"]
    examples_ar: list[str] = []   # the book's own examples, verbatim
    first_taught_lesson: str      # "ara1-1" — load-bearing for scope (§4.5)
    source_page: int

class GrammarRule(BaseModel):
    id: str                       # "gr:munada"
    label_ar: str                 # "المنادى"
    unit: str                     # "module:ara-u1"
    taught_in: list[str]          # ["ara1-1", "ara1-2", "ara1-3"] — installments
    clauses: list[RuleClause]
    types_tree: Optional[dict]    # أنواع المنادى المعرب tree as printed (ص١٢)
```

*Why it earns its place:* `RuleClause.id` is the citation target that makes إعراب auditable, and `first_taught_lesson` is what makes the cumulative-scope oracle a script rather than a judgment call.

### 2.5 `IrabAnswer` — the crown jewel

Egyptian إعراب answers are formulaic, which means they are **structured**, which means they can be slot-graded.

```python
IrabState = Literal["مرفوع", "منصوب", "مجرور", "مجزوم", "مبني",
                    "في محل رفع", "في محل نصب", "في محل جر"]
IrabSign  = Literal["الضمة", "الفتحة", "الكسرة", "الألف", "الواو", "الياء",
                    "السكون", "حذف النون", "حذف حرف العلة",
                    "تنوين الفتح", "تنوين الضم", "تنوين الكسر"]
SignKind  = Literal["ظاهرة", "مقدرة", "نائبة عن الفتحة",
                    "نائبة عن الضمة", "نائبة عن الكسرة", "—"]

class IrabAnswer(BaseModel):
    word_ar: str                  # with تشكيل, as it must be produced
    role_ar: str                  # "منادى مضاف" / "مضاف إليه" / "نعت" / "بدل"
    state: IrabState
    sign: Optional[IrabSign]
    sign_kind: SignKind = "ظاهرة"
    reason_ar: Optional[str]      # "لأنه جمع مذكر سالم"
    rule_ref: str                 # RuleClause.id — MUST resolve (§4.4)
    surface_ar: str               # full formulaic string the student writes
    accept_ar: list[str] = []     # human-approved equivalent phrasings
```

Example, from the book's own rule (ص١١، «والياءُ مع جمعِ المذكرِ السالمِ مثل: يا طالبي العلم»):

```json
{ "word_ar": "طالبي", "role_ar": "منادى مضاف", "state": "منصوب",
  "sign": "الياء", "sign_kind": "نائبة عن الفتحة",
  "reason_ar": "لأنه جمع مذكر سالم",
  "rule_ref": "gc:munada:mudaf-sign-ya-jam-mudhakkar",
  "surface_ar": "منادى مضاف منصوب وعلامة نصبه الياء نيابةً عن الفتحة لأنه جمع مذكر سالم" }
```

*Why it earns its place — this is the single highest-leverage decision in the contract.* Slot-wise storage buys three things at once:

1. **Grading without an LLM.** Compare slots, award partial credit, done. No judge, no cost, no drift.
2. **A computed diagnosis.** A wrong answer produces a *slot diff*, e.g. `sign: الفتحة → الياء`. The tutor does not diagnose; it **verbalizes a structured diff** grounded in the cited clause. That is exactly the runtime-explanation discipline (never solve from scratch) applied to a subject where the "canonical solution" is a derivation.
3. **A cache key that is a small finite set.** Explanations cache by `(question_id, slot-diff signature)` — a handful per question, not one per free-text answer. Arabic explanations should be *cheaper* per turn than math's.

### 2.6 `SpellingRule` + `SpellingCase` — الإملاء

```python
class SpellingCase(BaseModel):
    id: str
    condition_ar: str             # "مضمومة وما قبلها مفتوح"
    written_as_ar: str            # "على واو"
    examples_ar: list[str]        # ["هَؤُلاء", "يَؤُم", "خَطْوُهُ", "يَقْرَؤُهُ"]
    source_page: int

class SpellingRule(BaseModel):
    id: str                       # "sp:hamza-mid-waw"
    label_ar: str                 # "الهمزة المتوسطة على واو"
    lesson: str
    cases: list[SpellingCase]
    printed_case_count: int       # from the printed table — feeds the oracle (§5)
    note_ar: Optional[str]        # ملحوظة (ص١٣: مآرب – مآثر)
```

The book prints these as literal case tables — ص١٢ (على واو، 5 columns), ص١٨ (على السطر، 5 rows), ص٢٣ (المتطرفة، 5 bullets). `printed_case_count` is the countable the oracle asserts against.

*Why it earns its place:* it is the answer key for `spelling_fix`, and a wrong answer maps to a **case row**, giving the same computed-diagnosis property as إعراب.

### 2.7 `CompositionPrompt` — التعبير (stored, never graded)

```python
class CompositionPrompt(BaseModel):
    id: str
    lesson: str
    mode: Literal["تحدث", "اكتب"]
    prompt_ar: str                       # verbatim: "عن أهداف ثورتي ٢٥ يناير و٣٠ يونيه…"
    suggested_points_ar: list[str] = []  # authored scaffold, human-gated
    graded: Literal["none"] = "none"     # locked closed for MVP
    source_page: int
```

*Why it survives the cut in a reduced form:* it is printed in every lesson, it costs almost nothing to store, and it gives the weekly parent report something true to say («كتب موضوع تعبير عن…»). It earns **no grader** — see §6.

### 2.8 Cut

- **`CalligraphyModel` — cut entirely as a typed artefact.** The objective is printed («يكتب نموذجًا بخطي: النسخ والرقعة»), but there is no gradeable answer without handwriting capture, and handwriting capture is not an MVP the PRD contemplates. A typed model with no consumer is spine debt. If a display asset is ever wanted, it is a `Visual`, not a new type. §6 says how to handle the objective honestly.
- **A separate `Exposition` model — cut.** The book *prints* شرح الآيات / شرح الأبيات (ص٩، ص١٥). It is teaching prose, not a validated fact — it belongs in the existing rich-content channel (`seed/content/<lessonId>.json`), alongside tamheed / القضايا المتضمنة / اقرأ واستمتع / قرأت لك. New typed artefacts are for things that need validation or grading.
- **A separate `DictationPassage` model — cut, folded in.** «باب اللوق» (ص١٣) is a `TextPassage` with `kind="dictation"`, `fidelity="prose"`. One capture pipeline, not two.

---

## 3. Question types and — critically — how each is graded

`Question.type` extends to:

```python
ArQuestionType = Literal[
    "mcq",            # existing
    "irab",           # أعرب ما تحته خط
    "extract",        # استخرج من النص
    "lexical",        # هات مرادف / مضاد / جمع / مفرد
    "rhetoric",       # ما نوع الأسلوب / ما الغرض البلاغي
    "why",            # علل / ما دلالة / لماذا
    "explain",        # اشرح البيت بأسلوبك
    "shakl",          # اضبط بالشكل
    "spelling_fix",   # صوّب الخطأ الإملائي
]
```

| type | answer object | grader | partial credit | what a wrong answer yields |
|---|---|---|---|---|
| `irab` | `IrabAnswer` | **scripted slot diff** (role / state / sign / sign_kind) | yes, per slot | the wrong slot(s) + the `rule_ref` clause text |
| `extract` | `SpanAnswer{unit_n, start, end}` + `accepted: list[SpanAnswer]` | **scripted** normalized-span match | no | the correct span, highlightable in the rendered passage |
| `lexical` | `{field: معنى\|مضاد\|جمع\|مفرد, accept: list[str]}` | **scripted** set membership under `norm_key` | no | the book's own gloss from `VocabItem` |
| `rhetoric` | `{type: RhetoricType, purpose: RhetoricPurpose?, effect_ar}` | **scripted** enum match (+ rubric on `effect_ar`, deferred) | yes (type vs purpose) | the correct enum + the book's أثر |
| `spelling_fix` | `{corrected_ar, case_id}` | **scripted** word match under `norm_key` + optional case naming | yes | the `SpellingCase` condition + its examples |
| `shakl` | `VowelAnswer{targets: [{pos, harakah}]}` | **scripted** per-position diacritic compare after rasm normalization | yes, per position | the positions that are wrong |
| `why` | `list[ClaimStep]` with `evidence_span` instead of `evidence_page` | MCQ in MVP; rubric later | — | the model answer's claim list |
| `explain` | `{rubric_points: list[str], model_answer_ar}` | **LLM grounded rubric grader** (deferred) | yes | model answer reveal |
| `mcq` | choice key | existing | no | existing |

**Six of nine types are graded by a script.** That is the design goal, and it is achievable *because* the answer objects are structured rather than free text. Only `explain` genuinely needs an LLM grader, and it is the one type deferred out of the MVP (§6).

Two representation notes that matter downstream:

- **`extract` answers are spans into the hashed passage**, not copied strings. That means (a) the grader cannot drift from the text, and (b) the student surface can *highlight the answer in the passage* — the direct product analogue of math's Evidence Walk.
- **`why` reuses `ClaimStep`** with `evidence_span` swapped for `evidence_page`. The social-studies atom is not wrong; it is just not the *primary* atom here. Reusing it keeps one comprehension pipeline across two subjects.

The `accepted_variants_note` convention from the social contract (§3) carries over unchanged for every free-text type: a human-authored Arabic tolerance statement, required before `status: live`.

---

## 4. Grounding rules (hard; the analogue of social's "book-wins")

**4.1 The text is never generated.** Every pipeline stage after Text Capture, and the runtime, treat a `TextPassage` as read-only. The tutor references units by token — `{{ayah:64}}`, `{{bayt:3}}`, `{{span:t:ara1-2:001#3:12-27}}` — and the client renders from the stored passage. A scripted post-filter checks every Arabic run of ≥ 4 words in model output that overlaps a passage: it must be a character-exact substring under `norm_exact`, or the turn is discarded and the canonical explanation is served verbatim. Same fallback discipline as "if the output contradicts the canonical final answer, fall back verbatim."

**4.2 Sacred text: zero tolerance.** For `fidelity == "sacred"` the model may not emit the text **at all**, exact or otherwise — only span tokens. This is the only defensible engineering position for Quranic text, and it is also the cheapest.

**4.3 Two capture lanes, neither of which trusts a model to type Arabic correctly.**

- **Lane A — corpus (sacred).** The text is *not extracted*. The model extracts only the **citation** printed under the box («سورة الفرقان ٦٣–٧٠»); a deterministic script assembles the passage from a vendored, versioned Quran corpus (رواية حفص عن عاصم, matching the printed مصحف). Character-exactness becomes a property of the corpus, not of a model. A rasm-diff verifier then confirms the assembled text matches the high-DPI page crop, flagging any رواية divergence as a real finding.
- **Lane B — double-blind transcription (literary, prose, dictation).** Two independent agents, **different model families, fresh context**, each transcribe the same high-DPI page crop. A **script** — not an LLM — diffs them at character level. Identical ⇒ candidate. Any divergence ⇒ the exact divergent positions go to the human gate with the crop attached. The human signs off on the resulting `text_sha256`.
- **The hash is the gate.** The loader refuses any passage whose hash is not in the approved list; the runtime prompt-assembler refuses to render a passage whose stored hash does not recompute.
- **Vision tier is not optional.** تشكيل marks are a few pixels tall. Transcription must run on a **high-resolution-vision-tier model** (`claude-opus-5` or `claude-sonnet-5` — 2576 px long edge, up to ~4784 image tokens per image). `claude-haiku-4-5` is 1568 px-tier and **must not touch verbatim transcription**; it stays on mechanical/provenance work as in the existing runbook.

**4.4 إعراب must follow the book's own stated rule.** Every `IrabAnswer.rule_ref` resolves to a `RuleClause` printed in *this* book. If the derivation cannot be licensed by a printed clause, the question is not shippable. The tutor's explanation paraphrases that clause — it does not appeal to general Arabic grammar, and it does not appeal to a rule the book states differently.

**4.5 Cumulative scope, not lesson-local scope.** Legal grammar scope for lesson *L* = every `RuleClause` whose `first_taught_lesson` ≤ *L* **in book order**. Anything later is out of bounds: explaining منادى مبني in `ara1-1` is a violation, even though it is correct Arabic, because the book introduces it in `ara1-2`. Enforced twice — as a scripted RED in the coverage oracle, and as a filter on the runtime grounding slice. This is the direct analogue of the "Africa-only" catch: it makes *the tutor teaching next month's grammar* structurally impossible rather than merely unlikely.

**4.6 Closed rhetorical vocabulary.** `RhetoricType` / `RhetoricPurpose` are enums seeded from the book's own مواطن الجمال wording. A note that needs a new label is a **human decision to extend the enum**, never a generation decision. This is the terminology guardrail: Egyptian ministry terms, not MSA renderings of English rhetoric labels.

**4.7 Book-wins (inherited).** Where the book's spelling, rule statement, or gloss differs from a classical authority, **extract the book's version**, note the conflict in `source_note`, record an internal erratum. The exam grades the book.

**4.8 No cross-text importing.** A question on lesson *L* may only extract spans from lesson *L*'s passages. The book invites the opposite in one drill («اذكر بعض الكنائس والقلاع الأخرى الموجودة بمصر»، ص٢٢) — that is an open discussion prompt, and it ships as **ungraded**, with the tutor declining to supply outside content and redirecting, per the existing refuse-outside rule.

**4.9 Religious and heritage content.** Quran lessons are taught as **language**: معاني المفردات، إعراب، مواطن الجمال، and the book's own printed شرح. The tutor does not issue tafsir, fatwa, or theological ruling beyond that printed شرح, and refuses via acknowledge → decline → redirect. The same book-framing-only rule (ADR-0004 §5) applies to lesson 3's heritage content (الكنيسة المعلقة، جامع عمرو بن العاص، قلعة قايتباي). **This is the highest-sensitivity content in the product and needs Samuel's explicit sign-off, not an engineer's default** (§7.2).

---

## 5. What changes in the 9-stage pipeline

Nine stages become ten: **one added, two replaced, one demoted, three retyped, three kept.**

| # | Today (`rich-lesson.workflow.js`) | Arabic | Change |
|---|---|---|---|
| 0 | Manifest | Manifest | **KEEP.** Printed page = PDF − 1. The book's contents table (PDF p.7) hands us per-lesson title + start page + grammar topic for free — Stage 0 is nearly free here. |
| 1 | Segment (free subtopics) | Segment (**fixed skeleton**) | **RETYPED.** Emits the 13-slot component skeleton (below), the text's *citation*, and the **printed cardinalities** the oracle will assert against. |
| — | — | **Text Capture** | **NEW — and the highest-stakes stage in the line.** Lane A or Lane B (§4.3) → `text_sha256`. Nothing downstream may re-type the text. |
| 2 | Exposition | Gloss & Exposition | **DEMOTED.** شرح is *printed*; extract it, and only expand it into teaching prose with the printed شرح as a ceiling. Also emits `VocabItem`. |
| 3 | Claims | **Language Artefacts** | **REPLACED.** Produces `RhetoricNote`, `RuleClause`, `IrabAnswer`, `SpellingCase`. `ClaimStep` survives only for the `why` type. |
| 4 | Questions | Questions | **KEEP, retyped repertoire (§3).** Like the social book, this book prints very few drills — the إعراب / اضبط / صوّب bank is **authored**, not extracted, and every item is human-gated. |
| 5 | Visuals / widgets | **Text-anchored interactives** | **REPLACED.** Maps and timelines are useless here. New primitives: `passage_highlight` (tap the span), `irab_slots` (fill the four إعراب slots), `hamza_sorter` (drop the word into the right case column), `shakl_keypad`. `vocab_match` reuses the existing `term_match`. |
| 6 | Verify (re-solve + provenance) | Verify — **three lanes** | **HARDENED.** (a) **Text fidelity** = script (hash + double-blind diff), no LLM. (b) **Blind إعراب re-derivation** — see below. (c) **Span check** = script; every `expression_ar` and every accepted extract span must be a character-exact substring of the hashed passage. |
| 7 | Coverage oracle | **Cardinality + scope oracle** | **RETYPED** — see below. |
| 8 | Human gate | Human gate (**Arabic teacher**) | **HARDENED.** Hash sign-off is mandatory and human. Religious/heritage content gets a dedicated pass. A generalist reviewer is not sufficient. |
| 9 | Load | Load | **KEEP.** Loader additionally refuses unapproved hashes. |

### 5.1 The verification oracle we get back

Math's trust move was an independent arithmetic re-solve. Social studies had no oracle — facts have no arithmetic — so it settled for a page-fidelity second reading. **Arabic gets a real oracle back, because إعراب is derivable.**

A separate agent, fresh context, receives **only** the book's `RuleClause` set in scope and the target word in its sentence — not the author's answer, not the author's reasoning. It produces an `IrabAnswer` blind. The pipeline then **diffs slot-wise**. Identical slots ⇒ eligible for `verified: true`. Any slot mismatch ⇒ discrepancy queue (human), exactly like math's re-solve diffs. This is the strongest verification available in any of our three subjects, and it exists only because §2.5 made the answer structured.

### 5.2 What "complete" means for a language lesson

An Arabic lesson is a near-fixed skeleton, so the oracle asserts **exact counts**, not "covered / thin / MISSING" judgments. The LLM's job is to *report the printed count*; the **script** performs the comparison — a model cannot fudge a comparison it never performs.

**(a) Structural — all 13 components present or explicitly N/A:**
أهداف الدرس · القضايا المتضمنة · ناقش · النص · معاني المفردات · شرح · مواطن الجمال · اسأل وناقش + المناقشات المرقّمة · التراكيب اللغوية · الإملاء (قاعدة) · قطعة الإملاء · التعبير · اقرأ واستمتع / قرأت لك

**(b) Cardinality — script compares printed count vs produced count:**

| assertion | source of the printed count |
|---|---|
| `len(vocab_items) == printed_vocab_cells` | the معاني المفردات table |
| `len(rhetoric_notes) == printed_rhetoric_bullets` | the مواطن الجمال bullet list |
| `len(spelling_rule.cases) == spelling_rule.printed_case_count` | the إملاء case table |
| `len(irab_sign_clauses) == printed_sign_rows` | the نصب/بناء sign table (ص١١، ص١٧) |
| `len(passage.units) == printed_unit_count` | verse/بيت count; for Quran also `last − first + 1` |
| `len(captured_drills) == printed_drill_count` | the numbered question blocks |

**(c) Scope — scripted:** every `IrabAnswer.rule_ref` resolves to a clause with `first_taught_lesson` ≤ this lesson in book order. Violation ⇒ **RED**.

**(d) Fidelity — scripted:** every `RhetoricNote.expression_ar` and every accepted `extract` span is a character-exact substring of its passage under `norm_exact`. Violation ⇒ **RED**.

**Verdict `GREEN` only if all four groups pass.** Note how much stronger this is than the social oracle: because Arabic lesson pages are *tabular*, "complete" is a set of integer equalities rather than a model's opinion about thoroughness.

---

## 6. The MVP cut (thesis Ch. 19.6 — don't build everything before shipping anything)

**Scope: Unit 1, the three lessons already read — عباد الرحمن (قرآن), كن جميلا (شعر), قصة أثر (نثر).** One lesson of each fidelity tier is deliberate: it proves all three capture lanes on the smallest possible corpus.

### IN

- `TextPassage` across **all three fidelity tiers** — the corpus lane, the double-blind lane, and the runtime span-token policy. This is the differentiator; it is not deferrable.
- `VocabItem`, `RhetoricNote`, `GrammarRule` + `RuleClause`, `IrabAnswer`, `SpellingRule`.
  - المنادى is a near-perfect demo rule: self-contained, unit-spanning (so it exercises §4.5), and rich in nائب-عن-الفتحة signs (so slot diffs are interesting).
  - الهمزة المتوسطة is likewise unit-spanning and purely tabular.
- Question types: **`irab`, `extract`, `lexical`, `rhetoric` (enum only), `spelling_fix`, `mcq`.** All six graded by script.
- Interactives: **two, not five** — `passage_highlight` and `irab_slots`.
- **The slot-diff explanation loop** — the product moment. A student answers «منصوب بالفتحة» for «يا طالبي العلم»; the grader emits `sign: الفتحة → الياء`; the tutor says «أصبتَ في نوع المنادى وفي حالته، لكنّ علامة النصب هنا الياء نيابةً عن الفتحة، لأنه جمع مذكر سالم» — verbalized from a computed diff and the cited clause, never re-derived.
- Coverage oracle (all four groups), blind إعراب re-derivation, Arabic-teacher human gate.

### DEFER

| deferred | why |
|---|---|
| `shakl` (اضبط بالشكل) | Needs an Arabic diacritic keypad usable on a low-end Android over 3G — real frontend cost — and subtle rasm-normalization work. High build cost, low marginal demo value next to `irab`. |
| `explain` (اشرح البيت بأسلوبك) | The only genuinely LLM-graded type: adds an eval burden and a per-turn cost against the EGP 40 ceiling. **Ship it as an ungraded self-check with model-answer reveal**, which is honest and costs nothing. |
| `why` as free text | Ships as `mcq` in the MVP; the rubric grader lands with `explain`. |
| Composition grading | `CompositionPrompt` stores and displays; no grader, no scoring. |
| Calligraphy (خط) | Cut as an artefact (§2.8). The printed objective is surfaced honestly in the parent report as an off-app task, not faked. |
| Recitation (تلاوة جهرية) | A printed objective («يتلو الآيات تلاوة صحيحة») that needs Arabic ASR with tajweed scoring. **Explicitly out of scope**, and said plainly to the parent — «راجِعْ التلاوة مع معلّمك» — rather than pretended. |
| `hamza_sorter`, `shakl_keypad`, `vocab_match` | Interactive fast-follow after the vertical is proven. |
| Units 2–3 and Term 2 | Full-book scale-up follows the same conveyor once GREEN on Unit 1. |

**Cost note.** Extraction-time cost (high-res vision, double-blind transcription) is **one-time and does not touch the EGP 40/student/month runtime ceiling**. The runtime side should be *cheaper* than math: six of nine question types are graded by script with no model call at all, and explanations cache on `(question_id, slot-diff signature)` — a small finite key space per question rather than one entry per free-text answer.

---

## 7. Open decisions for Samuel

1. **Quran corpus lane — vendor a text file, or transcribe like everything else?** Recommendation: **vendor it.** A versioned Uthmani/Imlaei corpus in رواية حفص عن عاصم makes character-exactness a property of a file we can diff and license, not of a model's vision. Transcribing is cheaper to build and materially weaker. Licensing and رواية-match against the printed مصحف need confirming.
2. **Sacred-text runtime policy.** §4.2 says the model may never emit Quranic text, only span tokens the client renders. Does the app render the passage at all beyond the lesson header — and is the app's rendering of Quran something we want to ship at PoC quality? This is a religious-sensitivity call, not an engineering one.
3. **Authored lexical fields.** The book never prints مضاد but the exam demands it. Accept authored antonyms behind the human gate (recommended), or restrict `lexical` questions to printed fields only in the MVP?
4. **Subject key.** `course:prep3-arabic-ar` requires extending `subjectOfCourse` in `app/src/lib/lesson.ts`. Confirm the naming now so it is a one-time change.
5. **Vision tier and cost.** Verbatim transcription pinned to `claude-opus-5` / `claude-sonnet-5` (2576 px high-res tier); `claude-haiku-4-5` barred from transcription. Confirm the extraction-run cost is acceptable given it is one-time.
6. **Reviewer.** The human gate needs an Arabic-language teacher, not a generalist — the same open question as the part-time math teacher hire (PROJECT_STATE open questions).

---

## 8. Per-bundle gate order

1. Ids / slugs conform to §1 (scripted).
2. Footer-string grep clean (scripted).
3. Pydantic validation passes, incl. fidelity/lane and hash-recompute validators (§2.1).
4. Text Capture complete: every passage has an approved `text_sha256` and a signed-off human (§4.3).
5. Blind إعراب re-derivation run; slot-diff discrepancy queue empty or resolved (§5.1).
6. Span check clean — every rhetoric expression and accepted extract span is character-exact (§5.2d).
7. Cumulative-scope check clean (§4.5 / §5.2c).
8. Cardinality oracle GREEN on all six assertions (§5.2b).
9. Vocabulary and rhetoric enums human-checked verbatim; any `authored: true` field explicitly approved.
10. Human review gate on every question → only then `status: live`.

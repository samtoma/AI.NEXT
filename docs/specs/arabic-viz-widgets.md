# Arabic Language (اللغة العربية) — Visual & Widget Primitives

> **Status:** proposal, awaiting Samuel's direction. Design-system-lead, 2026-07-28.
> **Scope:** the visual vocabulary + student-facing interactive set for a third subject
> vertical (Prep-3 Arabic, ministry book `docs/Source/Arabic_Prp3_Tr1_2.pdf`).
> **Grounded in:** PDF pages 9–25 (printed 8–24) — Unit 1 in full (عباد الرحمن / كن جميلًا /
> قصة أثر) plus the Unit-2 opener.
> **Contracts touched (not yet edited):** `services/extraction/VIZ_SPEC.md` (→ v3),
> `services/extraction/schemas.py` `VIZ_KINDS`, `app/src/components/viz/*`,
> `app/src/components/student/widgets/*`.

---

## 0. What the book actually shows (the evidence, before the design)

I inventoried every non-photographic visual structure in printed pages 8–24. This matters
because the obvious answer (“Arabic = إعراب trees”) is **not** what the book prints.

| Structure | Where (printed p.) | Count |
|---|---|---|
| **معاني المفردات gloss table** | 9 (horizontal strip), 14 (vertical rows), 21 (vertical rows) | 3 |
| **Annotated passage** — target words coloured/underlined *in place* inside running text | 10 (المنادى المعرب), 16 (المنادى المبني), 22 (نداء ما فيه الـ) | 3 |
| **Span → rhetorical label list** (مواطن الجمال) | 9, 15 | 2 |
| **Condition → examples grid** (الهمزة المتوسطة) | 12 (6 conditions, on واو), 18 (5 conditions, on السطر — *fill-in*) | 2 |
| **Sign × noun-type matrix** (علامة الإعراب × نوع الاسم) | 11 (المنادى المضاف: فتحة/كسرة/ياء/ألف), 17 (المنادى المبني: ضم/ألف/واو) | 2 |
| **Framed scripture / quotation block** | 8 (سورة الفرقان ٦٣–٧٠, fully vowelled, medallions, بسملة), 21 (قرأت لك, لقمان الحكيم), 22 (﴿يوسف أعرض عن هذا﴾ with source footnote) | 3 |
| **Poem in صدر / عجز columns** | 14 (كن جميلًا, 7 أبيات, ❊❊❊ stanza break) | 1 |
| **Decision-rule list** (preceding vowel → hamza seat) | 23 (الهمزة المتطرفة: فتح→ألف، كسر→ياء، ضم→واو، ساكن→السطر) | 1 |
| **Tree diagram** | 12 (أنواعُ المنادى المعرب → المضاف / الشبيه بالمضاف / النكرة غير المقصودة) | **1** |
| **إعراب worked example (word → موقع → علامة)** | — | **0** |

Three consequences drive everything below:

1. **The passage is the figure.** In this subject the “map_scene equivalent” — the one
   signature primitive that carries the vertical — is *a framed Arabic text with annotated
   spans*. It appears 8× in 17 pages. Everything else is secondary.
2. **الإملاء (hamza) is the most-drilled skill in the book**, appearing as a full section in
   **all three** lessons (p.12, p.18, p.23). It is under-represented in the brief and belongs
   in the MVP widget set.
3. **The book prints no إعراب analysis at all.** It prints إعراب *rules* (`يُنصب المنادى
   المضاف بالفتحة أو ما ينوب عنها`, `مبني على الضم مع المفرد`). An `irab_tree` therefore cannot
   be free-form grammatical analysis — see §1.6 for the grounding gate. This is the single
   biggest content-integrity risk in the vertical.

Two negative findings worth recording:

- **بحر / تفعيلات never appears.** The poem is presented as استمع وتذوق; the analysis asked for
  is مواطن الجمال, not prosody. `verse_layout` must not invent a metre. الروي (the ل + ا ending
  every عجز: عليلا، الرحيلا، إكليلا، ثقيلا، جميلا، يزولا، جميلا) is visually undeniable and safe
  to *highlight* without naming a rule the book never states.
- **الخط (النسخ والرقعة) is a printed ministry objective** (lesson-1 objectives; Unit-2
  objective 12) **with no printed model** in these pages. See §5, “don’t build”.

---

## 1. VIZ_SPEC v3 — new kinds

Written to be merged into `services/extraction/VIZ_SPEC.md` as the v3 block. All v1/v2 rules
still apply: `{kind, spec}` data only, ids `v:<lesson>:<nnn>`, every visual carries
`source_page` and a one-line **Arabic** student-voiced caption, 2–4 visuals per LO.

**Universal v3 rules**

- `animate` is `"sequence" | "none"` (v2 convention). No infinite loops; the whiteboard drives
  discrete steps.
- Every element carries an integer `step` (1-based, ties reveal together). Every kind must feed
  a real `stepTimes` array to `useVizTimeline` and a real count to `vizStepCount` — no kind may
  fall back to `GENERIC_STEPS`.
- **Text is quoted verbatim from the book, with its تشكيل intact.** Producers must never
  normalize, re-vowel, or “tidy” a quoted string.
- Arabic-Indic digits in everything the student reads (`٦٣`, `١٧٥٥٠`), per v2.

### 1.0 Span anchoring — the shared mechanism (read this first)

Four of the seven kinds highlight sub-strings of vowelled Arabic. Character **offsets are not
usable**: producers count combining marks inconsistently, and any offset drifts the moment a
mark is added. Spans are therefore anchored **by content**:

```json
{"find": "يا شبابَ مصر", "nth": 1}
```

Resolution algorithm the renderer must implement (new helper in `app/src/components/viz/arabic.ts`):

```
strip(text)  ->  { plain, map }      // map[i] = index of plain[i] in the ORIGINAL string
match normalizeArabic(find) against normalizeArabic(plain), take occurrence `nth` (default 1)
render range = [ map[pStart] , map[pEnd-1] + 1 )   // slice of the ORIGINAL, marks intact
```

**Normalize for matching, render the original.** `normalizeArabic()` already strips harakat,
tatweel and unifies alef/yaa/taa-marbuta — it is a *lookup* helper and must never reach a
rendered string. An unresolved `find` **silently skips that one span** (same failure posture as
an unknown gazetteer place in `map_scene`) and logs in dev. Producers get an offline validator
in the extraction pipeline so unresolved spans fail the bundle, not the student.

For widgets that grade word taps (§2.1), `find` must be whole space-delimited word(s).

### 1.1 `text_passage` — the signature primitive

**Teaches:** the text itself, and every in-place annotation the book performs on it —
استخراج targets, منادى tokens, تضاد pairs, أسلوب/غرض labels, hamza positions.
**Book evidence:** printed 8, 9, 10, 13, 15, 16, 19–20, 21, 22.

```json
{
  "variant": "quran",
  "text": "وَعِبَادُ الرَّحْمَٰنِ الَّذِينَ يَمْشُونَ عَلَى الْأَرْضِ هَوْنًا …",
  "attribution": "سورة الفرقان (٦٣ - ٧٠)",
  "basmala": true,
  "ayahMarks": [63, 64, 65, 66, 67, 68, 69, 70],
  "spans": [
    {"find": "هَوْنًا", "category": "معجم", "note": "بسكينة ووقار", "step": 1},
    {"find": "يُسْرِفُوا", "category": "تضاد", "pairWith": "يَقْتُرُوا", "note": "تضادٌّ يبرز المعنى ويؤكده", "step": 2}
  ],
  "animate": "sequence"
}
```

| field | type | notes |
|---|---|---|
| `variant` | `"quran" \| "quote" \| "prose" \| "dictation" \| "grammar"` | **required.** Selects frame + typography contract (§3.4). |
| `text` | string | verbatim, تشكيل intact. |
| `attribution` | string? | required for `quran` and `quote`. |
| `basmala` | bool? | `quran` only — renders البسملة on its own line, as the book does. |
| `ayahMarks` | int[]? | `quran` only — verse numbers, rendered with **U+06DD ARABIC END OF AYAH** enclosing Arabic-Indic digits, *not* a hand-drawn SVG circle. |
| `brackets` | `"ornate" \| "none"` | `quote` only — `ornate` = ﴿ ﴾ (printed 22). |
| `spans` | Span[]? | see §1.0 + category table below. Omit for a plain reading block. |
| `title` | string? | e.g. `"باب اللوق"` (printed 13), `"قرأت لك"` (printed 21). |
| `reveal` | `"span" \| "category" \| "all"` | default `"span"`. `"category"` groups all spans of a category into one step. |

**Span categories** (closed vocabulary — colour *and* underline style, never colour alone):

| category | covers | Ledger colour | underline |
|---|---|---|---|
| `نحو` | منادى، مضاف إليه، أداة نداء، بدل | `--accent-deep` | solid |
| `بلاغة` | أسلوب مؤكد، استفهام، أمر، نهي، نداء، تشبيه | `--gold` | dashed |
| `إملاء` | همزة متوسطة/متطرفة positions | `--rust` | dotted |
| `صرف` | مفرد/جمع/مثنى، فعل مضارع | `--subject-arabic` (§3.1) | double |
| `معجم` | معنى، مرادف | `--ink-soft` | none (tint only) |
| `تضاد` | opposition pairs — `pairWith` draws a hairline connector | `--ink-soft` | wavy |

Optional per-span: `label` (the chip text, defaults to the category), `note` (the book’s own
gloss — “تعبير جميل يدل على تواضعهم الدائم”), `purpose` (الغرض البلاغي: التنبيه / الاستنكار /
النصح / الدعاء / التعليل).

**Step semantics.** Step 1 renders the passage with all spans dormant (plain text, correct
typography). Step *n* > 1 tints span group *n−1* and pops its label chip; earlier groups stay
tinted at reduced emphasis. `vizStepCount = 1 + distinctSteps(spans)`.

**Layout.** The passage never animates its own text (no draw-on, no per-character reveal — see
§3.3). Only the tint layer and the chips animate. Spans are `<mark>` elements with a
transparent-to-tint `background-size` transition; this preserves the text run and therefore the
shaping.

### 1.2 `gloss_table` — معاني المفردات

**Teaches:** the lesson vocabulary the book supplies before comprehension.
**Book evidence:** printed 9 (strip), 14 (rows), 21 (rows). Present in **every** lesson.

```json
{
  "title": "معاني المفردات",
  "layout": "rows",
  "entries": [
    {"word": "داء",    "gloss": "مرض",   "plural": "أدواء",  "step": 1},
    {"word": "عليلا",  "gloss": "مريضًا",                     "step": 2},
    {"word": "تتوقى",  "gloss": "تخشى",                       "step": 3},
    {"word": "إكليلا", "gloss": "تاجًا", "plural": "أكاليل",  "step": 4}
  ],
  "animate": "sequence"
}
```

- `layout`: `"rows"` (vertical 2-column, printed 14/21) | `"strip"` (horizontal paired cells,
  printed 9). **`strip` reflows to `rows` below 420px** — with 7 entries the printed strip is
  unreadable on a phone.
- Optional per-entry: `plural`, `singular`, `antonym` — the book prints these inside the gloss
  cell (`وجمعها (أدواء)`), and they are exactly the four relations the exercises drill (§2.5).
- One row per step. `vizStepCount = distinctSteps(entries)`.
- **Same JSON feeds the `term_match` widget** — one payload, two faces: the book *shows* the
  table, then the exercise makes you reproduce it.

### 1.3 `case_table` — the الإملاء / الإعراب grid

**Teaches:** the two grid shapes the book uses to compress a rule into cases.
**Book evidence:** printed 12 (6 conditions × examples), 18 (5 conditions, fill-in),
11 and 17 (sign × noun-type matrices).

**Mode A — `conditions`** (printed 12, 18):

```json
{
  "mode": "conditions",
  "title": "تُرسَم الهمزة المتوسطة على واو إذا كانت:",
  "columns": [
    {"condition": "مضمومة وما قبلها مفتوح",        "examples": ["هؤلاء", "يَؤُم", "خَطْوُه", "يقرؤه"], "step": 1},
    {"condition": "مضمومة وما قبلها مضموم",        "examples": ["تباطُؤ", "يَلؤم"],                    "step": 2},
    {"condition": "مضمومة وما قبلها حرف صحيح ساكن","examples": ["يرؤف", "تجرُؤ"],                     "step": 3},
    {"condition": "مضمومة وما قبلها حرف مد",       "examples": ["تفاؤل", "جزاؤه"],                    "step": 4},
    {"condition": "مفتوحة وما قبلها مضموم",        "examples": ["فُؤَاد", "سُؤَال", "يُؤَدُّون"],      "step": 5},
    {"condition": "ساكنة وما قبلها مضموم",         "examples": ["يُؤْذي", "رُؤْية", "مُؤْتمر"],        "step": 6}
  ],
  "animate": "sequence"
}
```

**Mode B — `matrix`** (printed 11, 17):

```json
{
  "mode": "matrix",
  "title": "إعراب المنادى المضاف",
  "rowAxis": {"label": "علامة الإعراب", "items": ["الفتحة", "الكسرة", "الياء", "الألف"]},
  "colAxis": {"label": "نوع الاسم", "items": ["المفرد", "جمع التكسير", "جمع المؤنث السالم", "المثنى", "جمع المذكر السالم", "الأسماء الخمسة"]},
  "cells": [
    {"row": "الفتحة", "col": "المفرد",             "example": "يا طالبَ العلمِ",   "step": 1},
    {"row": "الفتحة", "col": "جمع التكسير",        "example": "يا طلابَ العلمِ",   "step": 2},
    {"row": "الكسرة", "col": "جمع المؤنث السالم",  "example": "يا طالباتِ المجدِ", "step": 3},
    {"row": "الياء",  "col": "المثنى",             "example": "يا طالبَيِ العلمِ", "step": 4},
    {"row": "الياء",  "col": "جمع المذكر السالم",  "example": "يا طالبي العلمِ",   "step": 5},
    {"row": "الألف",  "col": "الأسماء الخمسة",     "example": "يا ذا المالِ أنفِقْ على الفقراءِ", "step": 6}
  ],
  "animate": "sequence"
}
```

- Header band uses `--accent-wash` + `--accent-deep` text (the book’s cyan band, restyled to
  Ledger). Body cells on `--card`.
- **Mobile reflow is mandatory**, not optional: under 420px `conditions` renders as stacked
  condition-header + example-chips blocks, one per step, and `matrix` renders as one block per
  row (`علامة` heading, then its `نوع الاسم → مثال` pairs). A 6-column grid at 360px × 200%
  zoom is unreadable; this is the WCAG-reflow line for the vertical.
- Empty cells in `matrix` are legitimate (the book’s matrices are sparse) — render blank, not
  a dash.
- `vizStepCount = distinctSteps(columns | cells)`.

### 1.4 `rule_tree` — taxonomy *and* decision tree

**Teaches:** the book’s own classification diagram, plus every rule it states as a
condition→outcome list.
**Book evidence:** printed 12 (the one printed tree diagram), 11 (أدوات النداء: قريب vs بعيد),
23 (الهمزة المتطرفة seats), and Unit-2 objective 10 (أنواع البدل).

```json
{
  "root": {"label": "أنواعُ المنادى المعرب"},
  "nodes": [
    {"id": "a", "label": "١- المضاف",                "example": "يا شبابَ الوطنِ", "step": 1},
    {"id": "b", "label": "٢- الشبيه بالمضاف",        "example": "يا راغبين في نهضةِ مصرَ", "step": 2},
    {"id": "c", "label": "٣- النكرة غير المقصودة",  "example": "يا طلابًا بادروا",  "step": 3}
  ],
  "note": "يُنصَب المنادى في هذه الأنواع الثلاثة بالفتحة أو ما ينوب عنها",
  "animate": "sequence"
}
```

Decision-tree form — same kind, `edgeLabel` carries the condition on the branch:

```json
{
  "root": {"label": "الهمزة المتطرفة تُرسَم حسب حركة الحرف الذي قبلها"},
  "nodes": [
    {"id": "1", "edgeLabel": "قبلها فتح",              "label": "على الألف",       "example": "قرَأ - نشَأ",   "step": 1},
    {"id": "2", "edgeLabel": "قبلها كسر",              "label": "على الياء",       "example": "شاطئ - يخطئ",  "step": 2},
    {"id": "3", "edgeLabel": "قبلها ضم",               "label": "على الواو",       "example": "لؤلؤ - يجرؤ",  "step": 3},
    {"id": "4", "edgeLabel": "قبلها ساكن صحيح أو حرف علة", "label": "مفردة على السطر", "example": "جزْء - عبْء - شيء - ضوء", "step": 4}
  ],
  "animate": "sequence"
}
```

- Optional `parent` on a node for depth-2 (max depth 3, max 5 children per level — mobile).
- **RTL layout: child ١ sits on the RIGHT**, matching the book. Connector is orthogonal
  (vertical stub → horizontal bar → vertical stubs), stroke-drawn with `a.draw()` before each
  node `a.pop()`s in.
- Node style: rounded rect, `--accent-wash` fill / `--accent-deep` border and text (the book’s
  solid blue restyled to Ledger — solid fills at this size fail contrast for the Arabic label).
- `vizStepCount = 1 + distinctSteps(nodes)` (step 1 = root alone).

### 1.5 `verse_layout` — the بيت

**Teaches:** that a بيت is one line in two hemistichs, and where الروي falls.
**Book evidence:** printed 14 (كن جميلًا, إيليا أبو ماضي, 7 أبيات, ❊❊❊ break after بيت 3).

```json
{
  "poet": "إيليا أبو ماضي",
  "lines": [
    {"sadr": "أيُّهذا الشَّاكي وما بِكَ داءٌ", "ajz": "كيفَ تَغدُو إذا غَدَوتَ عَليلا؟", "step": 1},
    {"sadr": "إنَّ شَرَّ الجُناةِ في الأرضِ نَفسٌ", "ajz": "تتوقَّى قَبلَ الرَّحيلِ الرَّحيلا", "step": 2},
    {"sadr": "وترى الشَّوكَ في الوُرودِ وتَعمى", "ajz": "أن ترى فوقَها النَّدى إكليلا", "step": 3}
  ],
  "stanzaBreakAfter": [3],
  "rhyme": {"tail": "يلا", "emphasize": true},
  "meter": null,
  "spans": [
    {"in": "ajz", "line": 1, "find": "كيفَ تَغدُو", "category": "بلاغة", "label": "استفهام", "purpose": "الاستنكار", "step": 4}
  ],
  "animate": "sequence"
}
```

- **RTL: صدر right column, عجز left column**, exactly as printed. Two equal columns with a
  caesura gutter; the ❊ ❊ ❊ stanza separator renders as a centred ornament row.
- `rhyme.tail` is matched against the **end of the rendered `ajz` string** (not by index) and
  tinted `--gold` on the final step. `rhyme` is optional and purely visual — it names no rule.
- **`meter` defaults `null` and must never be inferred.** A producer may only set it if the
  book names the بحر on the page. In this book, it never does.
- `spans` uses the §1.0 mechanism, resolved *within* the named hemistich (`in` + `line`).
- **Narrow screens: stack صدر above عجز** with a hairline joint marker and a right-edge bracket
  grouping the pair as one بيت. Never shrink below the minimum vowelled size (§3.2) to force two
  columns, and never justify (§3.3).
- `vizStepCount = distinctSteps(lines) + (rhyme.emphasize ? 1 : 0) + distinctSteps(spans)`.

### 1.6 `irab_tree` — grammatical analysis *(gated, see §5)*

**Teaches:** the exam skill — word → موقع إعرابي → علامة الإعراب.
**Book evidence:** **none printed.** The book states إعراب *rules*, never a worked analysis.

```json
{
  "sentence": "يا شبابَ مصرَ، إنَّ مصرَ تنتظرُ منكم أن تنهضوا بها",
  "tokens": [
    {"word": "يا",     "role": "أداة نداء",  "state": "حرف",  "mark": null,
     "rule_ref": {"page": 11, "quote": "وتسبقها أداة نداء (يا)"}, "step": 1},
    {"word": "شبابَ",  "role": "منادى مضاف", "state": "مُعرب", "mark": "منصوب بالفتحة",
     "rule_ref": {"page": 11, "quote": "يُنصَبُ المنادى المُضافُ بالفتحة أو ما ينوبُ عنها"}, "step": 2},
    {"word": "مصرَ",   "role": "مضاف إليه",  "state": "مُعرب", "mark": "مجرور",
     "rule_ref": {"page": 11, "quote": "شبابَ منادى مضاف، والوطنِ مضاف إليه"}, "step": 3}
  ],
  "animate": "sequence"
}
```

**Grounding gate — the load-bearing rule of this whole spec.** Every token’s `rule_ref` must
quote a printed rule line, and the construction must be one the book has taught in a *prior or
current* lesson. For Unit 1 that is exactly: **المنادى وأنواعه + its إعراب signs, and أداة
النداء**. A producer that cannot supply a `rule_ref` for a token **must not emit the visual**.
Without this the AI is doing free-form grammar we cannot verify, which breaks the “nothing
unreviewed reaches a student” rule as surely as a wrong answer key would.

- Rendering: the sentence on one RTL line, **split per word only** (never per character —
  §3.3). Each analysed word gets a leader line down to an إعراب card revealed on its step.
- `vizStepCount = 1 + distinctSteps(tokens)` (step 1 = the bare sentence).

### 1.7 `harakat_reveal` — marks appearing in sequence *(deferred, see §5)*

**Teaches:** where the علامة lands (the fatha *on the* ب of `يا طالبَ العلم`), and how a hamza
seat follows its vowel. Supports تلاوة/نطق objectives.

```json
{
  "text": "يا طالبَ العلمِ",
  "marks": [
    {"find": "طالب", "on": "last", "mark": "fatha", "note": "علامة النصب على آخر المنادى المضاف", "step": 1},
    {"find": "العلم", "on": "last", "mark": "kasra", "note": "مضاف إليه مجرور",                    "step": 2}
  ],
  "animate": "sequence"
}
```

**Implementation direction (this is the whole reason to spec it before building it):** do **not**
animate combining marks by splitting the string into per-character spans — that breaks the
cursive join in every browser without ZWJ scaffolding, and mark positioning goes with it.
Instead render **stage strings**: stage *k* is the full string with marks `1..k` present and the
rest stripped, cross-faded stage to stage. Each stage is an independent, correctly-shaped run.
The renderer derives the stages from `text` + `marks`; producers supply only the final vowelled
string and the reveal order. Cost: zero bytes beyond the component.

### 1.8 Registration checklist (per new kind)

1. `services/extraction/VIZ_SPEC.md` — the v3 block
2. `services/extraction/schemas.py` → `VIZ_KINDS` set
3. `app/src/components/viz/<Kind>.tsx` + `Visual.tsx` `VIZ_KINDS` array + `REGISTRY`
4. `app/src/components/viz/steps.ts` → `vizStepCount` (real step count, never `GENERIC_STEPS`)
5. `app/src/components/viz/kind-meta.ts` → glyph + chip classes

Proposed glyphs (all currently unused): `text_passage ¶`, `gloss_table ☰`, `case_table ▦`,
`rule_tree ⋔`, `verse_layout ❈`, `irab_tree ⑂`, `harakat_reveal ⁘`.

---

## 2. Interactive widgets — priority order

Conventions inherited from Wave 0 (`app/src/components/student/widgets/`): deterministic
client-side grading, no `Math.random` (use `stableShuffle`), `onResult(note)` fired **exactly
once** via `useFireOnce`, **notes in English** (they feed the AI stream), **all student-facing
copy Arabic**, the student never sees a score.

> Existing quirk to fix, not replicate: `TermMatch.tsx` hardcodes the demo student’s name in its
> result note (`✓ Omar matched all ${n} terms…`). New widgets take the name from context or omit
> it.

### 2.1 `extract_spans` — «استخرج» *(highest priority)*

The most frequent exercise verb in the book: *استخرج من الآيات تضادًا وبيّن أثره في المعنى*
(printed 10), plus every التراكيب passage’s implicit “find the منادى” (10, 16, 22).

```ts
{
  prompt: string,                 // "دوس على كل منادى في الفقرة"
  text: string,                   // verbatim, تشكيل intact
  category: string,               // the one category being hunted (نحو/بلاغة/إملاء/…)
  targets: string[],              // whole words/phrases, resolved via §1.0
  distractorHint?: string,        // shown after 2 misses, book-grounded
  onResult: (note: string) => void
}
```

**Grading.** Word-tap; correct target locks tinted + gets its label chip. A wrong word flashes
`--rust-wash` for 450 ms and is *not* penalised beyond a mistake counter. Complete when
`found.size === targets.length`. Note: `"✓ found all N منادى spans (M wrong taps)"`.
No partial credit, no time pressure — anxious-teenager rule.

**Touch targets.** Words in a passage are ~20 px tall at 16 px. Tappable passages set
`line-height: 2.4` and each tappable word gets `padding-block: 0.5rem` on an inline `<button>`
(not `inline-block`, which would break the line box). This is how the ≥44 px target is met
without spacing the text into unreadability.

### 2.2 `hamza_seat` — «الإملاء»

The book’s most-drilled skill: a hamza section in **all three lessons** (12, 18, 23). The
book’s own p.18 exercise (“supply your own examples in the grid”) is free production and cannot
be auto-graded; the gradable inverse is seat selection.

```ts
{
  prompt: string,                 // "الهمزة في الكلمة دي تتكتب إزاي؟"
  items: [{
    word: string,                 // with the hamza position blanked: "فُ_َاد"
    seats: string[],              // ["ؤ","أ","ئ","ء"]  (renderer supplies the standard 4)
    answer: string,               // "ؤ"
    rule: string,                 // "مفتوحة وما قبلها مضموم" — from the book's own grid
    page: number
  }],
  onResult: (note: string) => void
}
```

**Grading.** One tap per item, 3–5 items. On correct: the word completes with its تشكيل and the
`rule` chip appears (this is the teaching moment — the rule, not the tick). On wrong: the chosen
seat greys, the item stays open, one retry, then reveal + rule. Note carries per-item outcome so
the AI can target the next beat: `"hamza_seat 4/5 — missed 'مفتوحة وبعدها ألف الاثنين'"`.

**Why not a general تشكيل placer:** see §5.

### 2.3 `style_purpose` — «أسلوب … غرضه …»

Printed **verbatim as a fill-in-the-blank** on p.16: `فَتَمَتَّعْ بالصُّبحِ ما دُمتَ فيه ……
أسلوب: ……… غرضه: ………`. Backed by two full مواطن الجمال boxes (9, 15).

```ts
{
  prompt: string,
  text: string,                   // the passage or بيت
  span: string,                   // the highlighted fragment, resolved via §1.0
  styles: string[],               // ["نداء","استفهام","أمر","نهي","تأكيد","تشبيه"]
  purposes: string[],             // ["التنبيه","الاستنكار","النصح والإرشاد","الدعاء","التعليل"]
  answer: { style: string, purpose: string },
  onResult: (note: string) => void
}
```

**Grading.** Two-stage, gated: the غرض list stays disabled until the أسلوب is right — this is
deliberate cognitive-load sequencing, and it mirrors how the book’s blank reads. Wrong أسلوب →
soft flash + one retry, then reveal with the book’s own wording. Note:
`"style_purpose: style ✓ first try, purpose ✗ once (answered 'الدعاء', correct 'النصح والإرشاد')"`.

### 2.4 `irab_builder` — «أعرب ما تحته خط» *(gated with §1.6)*

The canonical Arabic exam item. Same grounding gate as `irab_tree`: every option list and every
answer must trace to a printed rule.

```ts
{
  prompt: string,
  sentence: string,
  target: string,                 // the word to parse, §1.0 anchored
  roles: string[],                // ["منادى مضاف","منادى مبني","مضاف إليه","نعت","بدل"]
  marks: string[],                // ["منصوب بالفتحة","منصوب بالياء","مبني على الضم","مجرور بالكسرة"]
  answer: { role: string, mark: string },
  rule_ref: { page: number, quote: string },
  onResult: (note: string) => void
}
```

**Grading.** Two-stage like §2.3 (موقع, then علامة — the علامة list is filtered by the chosen
موقع, which is itself the teaching). On completion the `rule_ref` quote surfaces as the
explanation. This widget is the *only* place we need diacritic “placement”, and it needs no
keyboard: the علامة is a pick from a list.

### 2.5 `term_match` — reuse with one prop

Printed 16 (`«داءُ - الجُناةُ - الرَّحيلَ» هاتِ معنى الأولى، ومفرد الثانية، ومُضادَ الثالثة`) and
printed 22 (`هاتِ جَمعَ الأولى ومفرد الثانية ومضادُ الثالثة`).

**The existing `TermMatch` does not cover this as-is.** It pairs term ↔ definition with no
relation label, but the book drills **four distinct relations** — معنى / مفرد / جمع / مضاد — and
an unlabelled match teaches the wrong thing: a مضاد pair renders identically to a معنى pair, so
a student can win the widget while believing an antonym is a synonym.

**Minimal change (not a new widget):**

```ts
pairs: [{ term: string, definition: string, relation?: "معنى"|"مرادف"|"مضاد"|"مفرد"|"جمع" }]
```

Render `relation` as a small chip on the term button, colour-coded to the §1.1 category palette
(معجم vs تضاد vs صرف). Allow the same `term` to appear twice with different relations — that is
precisely the book’s exercise. Everything else (shuffle, decoys, grading, note) stands.

### 2.6 `verse_builder` — ترتيب البيت *(defer; reuse ChainBuilder)*

Not asked for anywhere in the book — this is our invention. When we do it, it is a thin variant
of the existing `ChainBuilder` (ordered card assembly with roles): roles become `صدر` / `عجز`
instead of `سبب` / `حدث` / `نتيجة`. **Do not build a second ordering widget.**

### 2.7 Widget registration checklist

1. `app/src/components/student/widgets/<Widget>.tsx`
2. `app/src/components/student/LessonSession.tsx` — the `name === "…"` dispatch
3. `app/src/components/student/LessonContentView.tsx` dispatch **and**
   `app/src/lib/lesson-content.ts` → `INTERACTIVE_KINDS`
4. `app/src/lib/lesson.ts` — the `{{widget:…}}` catalogue line the lesson AI is taught, with a
   full worked example payload (this is where the AI learns the shape; a missing line means the
   widget is dead code)

---

## 3. Arabic typography — the real constraints

### 3.1 Finding: **there is no Arabic webfont in the product today**

`app/src/app/layout.tsx` loads Fraunces, Spline Sans and Spline Sans Mono, all with
`subsets: ["latin"]`. `app/src/app/globals.css` sets `font-family: var(--font-spline),
"Avenir Next", "Segoe UI", sans-serif` — **no Arabic family anywhere in the chain**. Every
Arabic glyph in the shipped product is currently rendered by whatever the device happens to
have. That was survivable for maths and social studies, where Arabic is unvowelled labels. It is
not survivable for a subject where **the تشكيل is the content**: on low-end Android the fallback
ranges from Noto Naskh Arabic (good mark positioning) to OEM Kufi-ish faces where marks collide
or drift onto the wrong base letter. We would be shipping a Quran page whose vowels land in
different places on different phones.

**Three directions for Samuel:**

| | Family | Why | Cost (woff2, Arabic subset) | Risk |
|---|---|---|---|---|
| **A** | **Noto Naskh Arabic** (variable, OFL) | The reference naskh; best-tested `mark`/`mkmk` positioning; it *is* the Android default, so the fallback matches the webfont and there is no reflow surprise | ~70–90 KB | Utilitarian; low contrast at 13 px; doesn’t look like a book |
| **B** | **Amiri** + **Amiri Quran** (OFL) | A Bulaq-type naskh revival — the closest thing to the ministry book’s own look, and the strongest fit for “Ledger / archival warm paper”. Amiri Quran has correct Uthmani mark handling and the ayah medallion | ~110 KB + ~130 KB | Two faces; low x-height needs +1–2 px everywhere; reads old-fashioned in UI chrome; heavier |
| **C** | **IBM Plex Sans Arabic** or **Cairo** | Crisp at small sizes on cheap screens; modern, matches a “tech product” read | ~60–80 KB | Sans + full تشكيل is where mark collision is worst; visibly unlike the book the student is being taught from |

**Recommendation: A as the single Arabic family for everything, plus Amiri Quran loaded lazily
and only on lessons containing a `text_passage` with `variant:"quran"`.** One family everywhere
is the MVP-discipline answer; the one exception buys fidelity exactly where fidelity is
non-negotiable and stays off the critical path. If Samuel wants the book look, direction B as
primary is defensible — it costs roughly +40 KB in the critical path and a size bump across the
type scale, and I’d want a side-by-side on a real cheap Android before committing.

**Also load a real 600/700 weight.** Faux-bold on Arabic smears the marks; set
`font-synthesis: none` globally so the browser can never fake it, and use colour/size for
emphasis where a bold face isn’t available.

### 3.2 Sizing and rhythm

Vowelled Arabic stacks marks **above and below** the baseline; the Latin line-height scale
clips or collides.

```css
:root {
  --ar-size-body:      17px;   /* never below 15px for vowelled prose */
  --ar-size-verse:     18px;   /* poetry carries more تشكيل per line */
  --ar-size-min:       14px;   /* absolute floor, unvowelled UI only */
  --ar-line-vowelled:  2.0;    /* fully vowelled: Quran, poetry, dictation */
  --ar-line-plain:     1.65;   /* unvowelled labels, chips, tables */
  --ar-line-tappable:  2.4;    /* §2.1 — buys the 44px target inside running text */
  --subject-arabic:      #6b4c86;   /* third territory: math viridian, social sepia, arabic aubergine */
  --subject-arabic-wash: rgba(107, 76, 134, 0.07);
  --subject-arabic-line: rgba(107, 76, 134, 0.30);
}
```

Naskh needs roughly +1–2 px over Latin at the same optical size. At 200 % zoom on a 360 px
viewport, `--ar-size-body` becomes ~34 px effective — which is why §1.3’s reflow is a hard
requirement rather than a nicety.

### 3.3 What to avoid — concretely

- **`letter-spacing` on Arabic.** It visually breaks the cursive join. This is a live drift risk:
  the codebase applies `tracking-[0.14em]` / `tracking-[0.16em]` to mono label classes, and those
  labels already carry Arabic — e.g. `TermMatch.tsx` renders «✳ تفاعلي · المصطلحات» inside
  `font-mono text-[9px] uppercase tracking-[0.16em]`. **Rule: `tracking-*` and
  `uppercase` never apply to an element containing Arabic.** Needs an `.ar-label` class that
  resets both, and a lint rule / review check.
- **`text-align: justify`.** Without kashida support it produces canyon-sized word gaps. Use
  `text-align: start`. The book justifies its poetry typographically (elongation); we cannot do
  that safely, so we align instead.
- **Splitting text into per-character spans.** Breaks shaping. Per-**word** splitting is safe
  (Arabic words don’t join across spaces) — that’s what `irab_tree` and `extract_spans` use.
  Anything needing sub-word animation uses the stage-string technique (§1.7).
- **Running displayed text through `normalizeArabic()`.** It strips harakat. Match on the
  normalized copy, render the original (§1.0).
- **Font-synthesised bold/italic.** `font-synthesis: none`.
- **Auto-hyphenation / `word-break: break-all`** on Arabic — never.
- **`font-feature-settings: "ss01"`** is currently set globally on `body`. It’s a Spline Sans
  stylistic set; scope it to Latin so it can’t reach an Arabic face with a different ss01.

### 3.4 The Quran contract (`variant: "quran"`)

Non-negotiable, enforced in **one** renderer so no surface can re-implement it wrong:

- Text is stored and rendered **verbatim**; no normalization, no re-vowelling, no trimming, no
  `dangerouslySetInnerHTML` transforms. The human review gate diffs the stored string against
  the book.
- No `letter-spacing`, no `text-transform`, no justification, no synthesis, no
  auto-hyphenation, no `::first-letter` styling.
- Verse numbers use **U+06DD** enclosing Arabic-Indic digits — not a drawn circle, not a
  parenthesis.
- `attribution` is **required** and always rendered (`سورة الفرقان (٦٣ - ٧٠)`).
- `lang="ar"` and `dir="rtl"` on the block.
- Spans may **tint** Quranic text but may never restyle its glyphs (no bold, no size change, no
  colour on the text itself — background tint + a chip in the margin only).
- Copy/paste yields the exact source string.
- The same rules apply to `variant:"quote"` with `brackets:"ornate"` (﴿ ﴾, printed 22).

### 3.5 What `arabic.ts` already handles — and the gap

`app/src/components/viz/arabic.ts` is 33 lines and provides exactly two things:
`arDigits()` (Western → Arabic-Indic) and `normalizeArabic()` (harakat/tatweel stripping +
alef/yaa/taa-marbuta unification, for tolerant gazetteer lookup). Both are correct and reusable.

**Missing, and required by §1.0:**

- `locateSpan(text, find, nth) → [start, end) | null` — the strip-with-position-map matcher.
- `stripHarakat(text) → { plain, map }` — the position map is the piece that doesn’t exist today.
- `stageVowelled(text, order) → string[]` — the §1.7 stage-string generator.
- `isVowelled(text) → boolean` — picks `--ar-line-vowelled` vs `--ar-line-plain` automatically,
  so no producer has to think about it.
- `hamzaSeatOf(word) → "أ"|"ؤ"|"ئ"|"ء"|null` — for the §2.2 validator (offline, extraction-side).

### 3.6 Bundle-cost check (with frontend-engineer, per mandate)

- All seven renderers are pure SVG/DOM, no dependencies: est. **~12–15 KB gzipped total** for
  the whole Arabic viz + widget set. Negligible against the 1.5 MB budget.
- **The font is the entire cost.** One Arabic family ≈ 70–90 KB in the critical path; the Quran
  face ≈ 130 KB lazy, route-scoped. Subsetting note below.
- **Subsetting must be codepoint-based, not glyph-pruned.** Keep the Arabic blocks
  (U+0600–06FF, U+0750–077F, U+FB50–FDFF, U+FE70–FEFF) *and* retain the OpenType features
  `init, medi, fina, isol, rlig, calt, liga, ccmp, mark, mkmk`. Dropping `mark`/`mkmk` — the
  default behaviour of a careless `pyftsubset` invocation — is precisely how تشكيل ends up
  positioned wrong. Verify with a rendered diff of the Quran block before/after subsetting.
- **Unrelated saving, worth taking with this work:** `app/src/app/layout.tsx` imports
  `katex/dist/katex.min.css` at the root, so every route — including Arabic lessons that render
  no maths — pays for KaTeX CSS. Moving it to the maths surfaces is a free ~20 KB on the Arabic
  critical path. Flagging for frontend-engineer, not doing it here.

---

## 4. Reuse audit — what we already have

Honest accounting, so we build only what is genuinely new.

| Existing asset | Arabic need | Verdict |
|---|---|---|
| `core.ts` — `makeAnim`, `useVizTimeline`, `VizPlaybackContext`, `VizError`, Ledger palette | all step/animation semantics | **Reuse 100 %.** Every new kind plugs into the same seam; the whiteboard, filmstrip, focus mode and reduced-motion handling come free. No new animation machinery. |
| `Visual.tsx` registry + `SpecErrorChip` + `VizBoundary` | graceful spec failure | **Reuse 100 %.** |
| `steps.ts` `vizStepCount` | controlled steps | **Extend** — 7 new entries; none may fall through to `GENERIC_STEPS`. |
| `arabic.ts` | span anchoring, digits | **Reuse + extend** (§3.5). `arDigits` and `normalizeArabic` are correct as-is. |
| **`TermMatch`** | مرادف / مضاد / مفرد / جمع | **Reuse + 1 prop.** Does *not* cover it as-is — the book drills four labelled relations and unlabelled matching teaches the wrong thing (§2.5). |
| **`ChainBuilder`** | بيت reassembly; ordering the steps of a rule | **Reuse later, build nothing.** Ordered card assembly with roles is exactly the mechanic. |
| **`LocateOnMap`** | comprehension of قصة أثر | **Reuse as-is, zero new code.** Lesson 3 is literally about الكنيسة المعلقة (Cairo) and قلعة قايتباي (Alexandria); both القاهرة and الإسكندرية are already in the `egypt` gazetteer. A real, free win for a reading lesson. |
| `TimelineBuilder` / `timeline` viz | author lives — نجيب محفوظ (١٩١١–٢٠٠٦, printed 13), إيليا أبو ماضي (١٨٩٠–١٩٥٧, printed 14) | **Reuse opportunistically.** Genuine but marginal fit; build nothing. |
| `flow_chain` | narrative سبب→نتيجة inside a prose text | Marginal. No new work. |
| `PairPlotter`, `ProductBuilder`, the 9 maths kinds, `map_scene` marks | — | **No fit.** |
| `widgets/util.ts` — `stableShuffle`, `useFireOnce`, `hashOf` | deterministic grading | **Reuse 100 %.** |

**Net new code:** 7 renderers, 4 widgets, ~5 helpers in `arabic.ts`, one font pipeline, one
`.ar-label` typography reset. Everything else is existing scaffolding.

---

## 5. MVP cut

**Ship — Wave 0-ar (what makes an Arabic lesson feel alive):**

Every one of the three lessons has the same skeleton — *a text → its vocabulary → an annotation
of the text → a grammar rule → an الإملاء rule*. The minimum set is whatever renders that
skeleton without a visible hole.

- **Kinds (5):** `text_passage` (all 5 variants), `gloss_table`, `case_table`, `rule_tree`,
  `verse_layout`.
  `verse_layout` is in the MVP despite serving one lesson in three because a بيت rendered as
  flowing prose reads as *broken*, not merely plain — and it is the cheapest of the five (pure
  CSS grid). Unit 2 adds another poem (آيات العلم).
- **Widgets (4):** `extract_spans`, `hamza_seat`, `style_purpose`, `term_match` + `relation`.
- **Foundation:** the Arabic font decision (§3.1) and pipeline, the `arabic.ts` span locator,
  the type-scale tokens, the `.ar-label` reset, `--subject-arabic` as the third territory colour.
- **Free reuse:** `LocateOnMap` on قصة أثر.

**Fast-follow (after the first lessons are through the human gate):**

- `irab_tree` + `irab_builder`, **gated on ≥ 30 human-approved إعراب items** with `rule_ref` on
  every token. High perceived value — “this is what an Arabic teacher does” — and the highest
  grounding risk in the vertical. Ship the data contract now (§1.6) so the extraction pipeline
  produces reviewable إعراب from day one; ship the renderer and widget once the gate has stock.
- `harakat_reveal` via the stage-string technique (§1.7).
- `verse_builder` as a `ChainBuilder` variant.

**Don’t build:**

- **A general تشكيل placer / free-form diacritic input.** It looks like the obvious Arabic
  widget and it isn’t: the book never asks a student to supply تشكيل, mobile keyboards make
  combining-mark entry miserable, and the graded skill that *does* exist — ضبط أواخر الكلمات —
  is already the علامة stage of `irab_builder`, where it’s a pick-list with no keyboard at all.
  This is roughly a month saved.
- **بحر / تفعيلات visualisation.** Not in the Prep-3 book (§0).
- **Calligraphy tracing (النسخ / الرقعة).** It is a printed ministry objective, but the book
  prints no model on these pages, ruqʿah webfonts are scarce, and stroke-order tracing needs
  per-glyph path assets plus handwriting capture. For MVP this is a **content-asset need, not a
  code need**: static model images, flagged to product-designer. Revisit only if the pilot shows
  parents asking for it.
- **A second ordering widget.** `ChainBuilder` exists (§2.6).

**Open questions for Samuel**

1. Font direction — A (Noto Naskh, recommended), B (Amiri, book-look, +40 KB and a type-scale
   bump), or C (modern sans). I’d want a side-by-side on a real low-end Android before locking.
2. `--subject-arabic` aubergine `#6b4c86` as the third territory colour — or keep the vertical
   inside the existing ink/viridian world and distinguish it by primitive alone?
3. Does the إعراب grounding gate (§1.6) hold as written — *no `rule_ref`, no visual* — given
   إعراب is the highest-value exam skill and the most tempting thing to let the AI improvise?

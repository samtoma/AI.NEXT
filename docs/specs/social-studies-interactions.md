# Spec proposal: Social Studies (دراسات اجتماعية) — interactive learning methods

- **Status:** PROPOSAL for Samuel — no implementation. Product-designer draft, 2026-07-20.
- **Scope:** Egyptian Prep-3 Social Studies (geography + history), source book `docs/Source/Social_prp3_T1_2.pdf` (Arabic, 186 pp, Term 1 + Term 2).
- **Builds on:** `docs/specs/tutor-experience-v2.md` (beats + السبورة + controlled-step figures), `services/extraction/VIZ_SPEC.md` (figures-as-data contract), the widget directive machinery in `app/src/lib/lesson.ts` (`{{widget:<kind>:<flat JSON>}}`).
- **Book sampling done:** Term-1 Unit 1 (world physical geography, pp. 10–17: continents, oceans, تضاريس), Term-1 Unit 3 history (pp. 55–60: الحملة الفرنسية ١٧٩٨, ثورتا القاهرة, opener of درس محمد علي), Term-2 Unit 1 economic geography (pp. 100–108: agricultural/animal resources, world distribution maps + bar charts).

---

## 1. The pedagogical shape of the subject (vs math)

Math understanding is **procedural**: the student re-derives. You check it by making them solve. Social studies understanding is **relational**: the student holds a web of places, dates, causes, and terms, and can traverse it. You cannot check it by "re-solving" — there is nothing to solve. You check it by making the student **reconstruct the web**:

| Faculty | What it means here | How the tutor CHECKS it | Book evidence |
|---|---|---|---|
| **Narrative memory** (السرد) | Can retell the story arc in own words | **Explain-back**: "احكيلي اللي حصل في سطرين" — AI grades free text against the canonical beat list of the LO (grounded, never from world knowledge) | Every history lesson is a story: campaign → resistance → departure (pp. 48–52) |
| **Spatial reasoning** (الخرائط) | Can locate, read a legend, trace a route | **Locating**: tap the place/region on a map; deterministic hit-test | Book verb: «حدد على الخريطة», «لاحظ من الخريطة» — maps on nearly every page |
| **Temporal reasoning** (الزمن) | Can order events, anchor key dates | **Ordering**: arrange shuffled event cards; scrub an era | Lesson objective, p. 60 verbatim: «يرسم خريطة زمنية لأهم الأحداث التاريخية» — the ministry itself asks for a timeline |
| **Cause→effect** (الأسباب والنتائج) | Can distinguish سبب from نتيجة and connect chains | **Connecting**: match causes to results; assemble سبب→حدث→نتيجة chains | The book pre-structures every event as أسبابها / أحداثها / نتائجها three-column boxes (p. 56) — extraction gets this for free |
| **Terminology** (المصطلحات) | Knows the defined terms | **Matching**: term ↔ definition cards | «مفاهيم أتعلمها» boxes on most spreads (المقاومة، الجلاء، حوض النهر، الدول الجُزرية…) |
| **Evidence reading** (الاستنتاج) | Can extract a fact from a map/chart/source | **Reading a source**: a book figure + one question on it | Book verb: «نستنتج من الخريطة», bar charts throughout economic geography |

**The exam-anxiety hook.** These six checks map one-to-one onto the actual exam verbs: بم تفسر؟ (chain_builder), ما النتائج المترتبة على…؟ (chain_builder), ضع المصطلح (term_match), حدد على الخريطة (locate_on_map), رتب الأحداث (timeline_builder), استنتج من الشكل (source_card). The student practices **in the exam's own grammar** — that is the anxiety-relief pitch to the parent, same as the math side's step-by-step solutions.

**Grounding rule preserved.** Same as math: nothing is graded from the model's world knowledge. Extraction produces canonical facts per LO (event lists with dates, place gazetteer entries, cause→effect pairs, term definitions — all human-reviewed); ordering/locating/matching widgets grade **deterministically client-side**; only explain-back is AI-graded, against the canonical bullet list, with the same provenance chips («من الكتاب ص٤٩»).

---

## 2. Proposed interactive primitives

Two families, mirroring the math split: **display primitives** (VIZ_SPEC siblings — animated, controlled-step, live on السبورة) and **interactive widgets** (pair_plotter/product_builder siblings — the student acts, result → `[live event]`). All keep the Ledger aesthetic: ink-line SVG, paper ground, stamps — maps are hand-drawn-atlas style, not GIS realism.

### 2a. Display primitives (extend VIZ_SPEC)

**`map_scene`** — the geo_scene of this subject; the single highest-value primitive.
A named base map + layers appearing in `step` order (plugs into the existing `makeAnim`/`useVizTimeline` seam unchanged). Base maps are **pre-built SVG assets** with a gazetteer of named anchors (id → point/polygon), so the AI and extraction agents never emit raw coordinates — they emit names. Proposed bases (one-time asset build, the real cost of this primitive): `egypt`, `nile_valley`, `world`, `africa`, `asia`, `europe`, `arab_world`, `mediterranean_east` (for the campaign/Levant lessons).
```json
{"kind":"map_scene","spec":{
  "base":"mediterranean_east",
  "layers":[
    {"type":"region","id":"egypt","label":"مصر","tint":"paper-green","step":1},
    {"type":"marker","at":"alexandria","label":"الإسكندرية","step":2},
    {"type":"route","points":["toulon","alexandria","embaba","cairo"],
     "label":"خط سير الحملة الفرنسية","style":"dashed-arrow","step":3},
    {"type":"badge","at":"abu_qir","label":"موقعة أبي قير ١٧٩٨","icon":"battle","step":4}
  ],
  "animate":"sequence"}}
```
Layer types: `region` (tint a polygon), `marker`, `route` (animated dashed arrow along waypoints — the book's خط سير maps, pp. 55, 57), `badge` (event stamp), `legend`. Serves: every geography lesson (continents, تضاريس, climate, resources-distribution) and every history lesson with movement (campaigns, trade routes).

**`timeline`** — horizontal era band, events dropping in by `step`; **RTL: earliest on the RIGHT** (Arabic reading order).
```json
{"kind":"timeline","spec":{
  "era":[1798,1801],"direction":"rtl",
  "events":[
    {"when":"يوليو ١٧٩٨","label":"دخول القاهرة","step":1},
    {"when":"أغسطس ١٧٩٨","label":"موقعة أبي قير البحرية","step":2},
    {"when":"أكتوبر ١٧٩٨","label":"ثورة القاهرة الأولى","step":3},
    {"when":"سبتمبر ١٨٠١","label":"جلاء الحملة","step":4}],
  "animate":"sequence"}}
```
`when` is a display string (the book mixes month+year and year-only); an optional numeric `at` orders/positions. Serves: all history lessons; also geography sequences (Nile flood cycle).

**`flow_chain`** — animated سبب→حدث→نتيجة boxes connected by arrows, revealing in order; the book's three-column event boxes as motion.
```json
{"kind":"flow_chain","spec":{
  "nodes":[{"label":"فرض الضرائب الفادحة","role":"سبب","step":1},
           {"label":"ثورة القاهرة الأولى","role":"حدث","step":2},
           {"label":"إعدام كثير من الثوار","role":"نتيجة","step":3}],
  "animate":"sequence"}}
```

**`concept_tree`** — the book's classification diagrams (e.g. الموارد الزراعية → غذائية/ألياف/خاصة, p. 100) revealed level by level.
```json
{"kind":"concept_tree","spec":{"root":"الموارد الزراعية",
  "children":[{"label":"محاصيل غذائية","children":[{"label":"القمح"},{"label":"الأرز"}]},
              {"label":"محاصيل ألياف","children":[{"label":"القطن"},{"label":"الكتان"}]}],
  "animate":"by-level"}}
```

**Reuse as-is:** `stat_chart` already covers the subject's many bar charts (wheat/corn/cotton production, pp. 100–103) — zero new build.

### 2b. Interactive widgets (extend the lesson widget set)

All follow the existing contract: `{{widget:<kind>:<flat JSON>}}`, last beat of the message, graded locally, result posted as `[live event]`, wrong answer → soft coaching, never a score.

**`locate_on_map`** — "حدد على الخريطة" as a tap.
```json
{"prompt":"فين قناة السويس؟ دوس على مكانها","base":"egypt",
 "target":"suez_canal","alsoAccept":[],"showLabelsAfter":true}
```
Hit-test against the gazetteer polygon/radius; a miss shows a warm nudge + the region pulsing («قربت — هي أعلى شوية، عند التقاء البحرين»). Variant `"mode":"pick_region"` highlights 3–4 candidate regions to choose among (easier tier, good post-"لسه مش فاهم").

**`timeline_builder`** — order shuffled event cards. **Tap-to-order, not drag** (cheap touchscreens; drag is v2 polish). Student taps cards in sequence; they fly onto a timeline strip right-to-left.
```json
{"prompt":"رتب الأحداث دي زي ما حصلت","events":
 ["الحملة الفرنسية توصل الإسكندرية","موقعة أبي قير البحرية",
  "ثورة القاهرة الأولى","رحيل نابليون"],"answerOrder":[0,1,2,3]}
```
Client shuffles; on a wrong pick the card shakes softly and stays — the student self-corrects (dignity in failure; no red X).

**`chain_builder`** — connect أسباب to نتائج (the "بم تفسر" muscle).
```json
{"prompt":"وصّل كل سبب بنتيجته","mode":"match",
 "left":["حصار الأسطول الإنجليزي لشواطئ مصر","تأمين نابليون للعلماء في الأزهر"],
 "right":["حرمان الحملة من الإمدادات","محاولة كسب ثقة المصريين"],
 "pairs":[[0,0],[1,1]]}
```
Second mode `"mode":"sequence"`: assemble a سبب→حدث→نتيجة chain from a card pool (harder tier). Renders as tap-left-then-tap-right linking (no drag).

**`sort_classify`** — bucket sort: exports/imports, climate zones, جبال/هضاب/سهول, رعي بدائي/تجاري.
```json
{"prompt":"صنّف التضاريس دي","buckets":["جبال","هضاب","سهول"],
 "items":[{"label":"الهيمالايا","bucket":0},{"label":"التبت","bucket":1},
          {"label":"سهول سيبيريا","bucket":2},{"label":"أطلس","bucket":0}]}
```
Tap an item, tap a bucket. Immediate soft feedback per item.

**`term_match`** — مصطلحات pairs, straight from the «مفاهيم أتعلمها» boxes.
```json
{"prompt":"وصّل المصطلح بمعناه","pairs":[
  {"term":"الجلاء","def":"رحيل قوات الاحتلال عن البلد المحتل"},
  {"term":"المقاومة","def":"رفض الشعوب للاحتلال ومظاهره"}]}
```
Reverse mode (`"mode":"name_the_term"`): show the definition, student picks the term — this is the exam's «ضع المصطلح» exactly.

**`source_card`** — a re-typeset excerpt/figure from the book with provenance + one question (evidence reading). *Not* a page-image crop — scans are heavy on 3G and ugly; we re-set the text in Ledger style with the existing «من الكتاب ص٤٩» chip carrying provenance.
```json
{"page":49,"title":"من الكتاب — ثورة القاهرة الأولى",
 "body":"أصبح الأزهر الشريف مقر قيادة المقاومة واشتدت الثورة...",
 "ask":"ليه كان الأزهر بالذات مركز الثورة؟","expects":"free_text"}
```
Free-text answers go through the AI grader grounded on the excerpt itself.

### 2c. Ranking — MVP set (teaching value ÷ build effort)

| Rank | Primitive | Teaching value | Build effort | Call |
|---|---|---|---|---|
| 1 | **`map_scene` + `locate_on_map`** | Carries every geography lesson AND history movement; the subject IS maps | **High** — the base-map SVG assets + gazetteer are the one real asset investment (est. 6–8 bases; everything after is data) | **MVP** |
| 2 | **`timeline` + `timeline_builder`** | Ministry-mandated skill, carries all history; the assembled timeline is the revision artifact | Low–medium (1D layout, tap-order) | **MVP** |
| 3 | **`chain_builder`** | «بم تفسر» is the highest-weight exam verb; book pre-structures the data | Low (two columns + links) | **MVP** |
| 4 | **`term_match`** | Cheap, high-frequency, exam-verbatim | Trivial (a card grid) | **MVP** |
| 5 | `sort_classify` | Broad but substitutable (chain_builder/term_match cover checks meanwhile) | Trivial | Wave 2 |
| 6 | `flow_chain` + `concept_tree` (display) | Nice narration props; `timeline`+`map_scene` carry the board meanwhile | Low | Wave 2 |
| 7 | `source_card` | Deepest skill, but needs grader prompt work + careful excerpt extraction | Medium | Wave 2 |

MVP = **4 widgets + 2 display primitives** (map_scene, timeline) + stat_chart reuse. That is enough to teach and check every lesson type in the sampled units.

---

## 3. The lesson flow, adapted (beats + السبورة)

The beat protocol, paced reveal, and board mechanics transfer **unchanged** — what changes is what accumulates on السبورة.

### History lesson (worked example: ثورة القاهرة الأولى)

The board is no longer "current figure" — it is **the story so far**. A `timeline` primitive is pinned for the whole lesson and grows a step per beat (same controlled-step seam; each new beat's directive advances it). The filmstrip holds the maps.

1. **Beat 1 — scene-setting (voice-forward):** tutor narrates the situation; `map_scene` (mediterranean_east) draws the campaign route on the board.
2. **Beats 2–4 — the story:** each beat tells one episode (≤2 sentences, per protocol) and stamps one event onto the pinned timeline (`{{widget:viz_ref:...}}` step-advance). The student *watches history assemble*.
3. **Check 1:** `timeline_builder` — reorder the very events just told.
4. **Beat 5 — why it happened:** tutor walks أسباب; check 2: `chain_builder` match.
5. **«لسه مش فاهم» path:** re-walk *on the board* — the tutor replays the timeline/map steps where confusion lives, then the mandated easier check = `locate_on_map` pick_region or `term_match` (tap widgets, per the existing rule).
6. **Close — explain-back:** «احكيلي القصة في سطرين، بالتواريخ اللي فاكرها» → AI-graded vs canonical beats → report card. The completed timeline stays on screen behind the report: *this is what you built today*.

### Geography lesson (worked example: تضاريس إفريقيا)

`map_scene` (africa) is pinned; each beat lights one layer (جبال أطلس tint + label while the tutor names it; hضبة الحبشة next…). Checks alternate `locate_on_map` («فين جبال أطلس؟») and `sort_classify` (جبال/هضاب/سهول). Economic-geography lessons swap in `stat_chart` beats + a `concept_tree`, check with `sort_classify` (crops→families) and `locate_on_map` («فين أكبر منتج للقطن؟» → tap China on world base).

### Where VOICE matters more than in math

In math, TTS was decoration on worked steps. Here the **medium is narration** — a history lesson is literally a story told while the board draws, and our student reads slowly under exam anxiety; hearing the arc while watching the timeline build is the closest thing to the tutor this product replaces. Recommendation:

- **Arabic neural TTS becomes P1 for this subject** (it was "later" for math — correctly). The provider abstraction (`app/src/lib/tts/`) makes it a drop-in; bake off Azure `ar-EG` voices vs ElevenLabs Arabic on 5 narration beats before deciding.
- **Register decision needed (flag for Samuel):** book text is MSA (فصحى), coaching lines are Egyptian. Proposal: one voice reads narration beats in MSA-as-written (matches the exam register they must produce), coaching stays text-only. Needs a listening test with 2–3 real students.
- Cost is bounded: narration lines come from canonical beats → highly cacheable by the existing text-hash audio cache; coaching lines uncached but text-only under this proposal.
- Degradation: no audio (3G, muted phone) → the existing paced reveal already delivers the narration cadence. Voice is an enhancer, never a dependency.

---

## 4. RTL implications — the honest top 5

The math surface is LTR-first with Arabic flavor (`dir="auto"` per bubble). This subject flips the **whole lesson surface** to a true RTL reading experience. Scoped as a lesson-route-level direction context + an audit pass — not a rewrite — but these five will bite:

1. **Route-level `dir="rtl"`, not per-bubble `dir="auto"`.** The lesson layout (chat column, board split, chips, stepper «٢ من ٤», filmstrip scroll direction, "شوف الرسمة ←" chevrons) must mirror as a unit. Mostly free if the layout uses logical CSS properties (`margin-inline-start` etc.) — it currently doesn't everywhere; budget a flexbox/logical-properties audit of `LessonSession`/board components.
2. **Timelines and steppers read right→left.** Earliest event on the right; step dots, progress bars, and the «▸ التالي» tap-advance arrow all mirror. This is semantic, not just CSS `direction` — the timeline primitive needs `direction:"rtl"` as a first-class layout mode (built in from day one is cheap; retrofitting isn't).
3. **Numerals + bidi islands.** The book uses Eastern Arabic numerals for dates (١٧٩٨م). Policy proposal: Arabic-Indic digits in all student-facing prose and timelines (matching the book/exam), Western digits allowed inside charts. Mixed runs (date ranges, «٧٠٫٧٪», coordinates like «٣١° شمالًا») need `<bdi>`/`unicode-bidi: isolate` wrappers or ranges render scrambled — this is the classic RTL bug class; add it to QA's checklist explicitly.
4. **Arabic-first typography.** Current font stack is Latin-first with Arabic fallback. Needs a proper Arabic UI face (e.g. IBM Plex Sans Arabic or Noto Naskh Arabic — subset-woff2 to respect the 1.5 MB first-load budget), larger line-height (Arabic ascenders/diacritics clip at Latin line-heights), and **no italics/oblique** for emphasis (broken in Arabic) — use weight/color, which the Ledger style prefers anyway.
5. **Maps and charts are direction-neutral islands.** The map itself never mirrors (geography is geography); labels inside SVG are RTL text anchored appropriately (`text-anchor` flips meaning — needs per-label attention in the base-map assets), legends/keys sit on the right, and stat_chart axis labels need `dir` isolation. Decide once in the base-map asset spec, not per-lesson.

---

## 5. The report card (بطاقة الفهم) for this subject

Same chassis as math (`understanding_checks`: score dial, verdict stamp, strengths, gaps, next step) — the **dimensions** change. Every check in the lesson tags one of five skills, so the card is computed from real evidence, not vibes:

| Skill axis | Fed by | Sample strength line | Sample gap line |
|---|---|---|---|
| **الخريطة** (locating) | locate_on_map hits/misses | «بيحدد على خريطة مصر من أول مرة» | «لسه بيلخبط بين هضبة الحبشة وهضبة البحيرات» |
| **الزمن** (chronology) | timeline_builder orderings | «رتب أحداث الحملة الفرنسية صح كاملة» | «واقع في ترتيب موقعتي أبي قير البحرية والبرية» |
| **الأسباب والنتائج** | chain_builder | «فاهم ليه قامت ثورة القاهرة الأولى» | «بيخلط بين أسباب الثورة ونتايجها» |
| **المصطلحات** | term_match | «المصطلحات ثابتة: الجلاء، المقاومة» | «محتاج يثبت الفرق بين الرعي البدائي والتجاري» |
| **السرد** (explain-back) | AI-graded retell vs canonical beats | «حكى القصة بترتيبها وبتاريخين صح» | «الحكاية ناقصة النهاية — وقف عند رحيل نابليون» |

- **Verdict stamps** (Ledger style, warm): «متمكن» / «ماشي في السكة» / «محتاج مراجعة تانية» — never a percentile against peers.
- **Next step** is always one of the five axes, phrased as tomorrow's assignment («بكرة هنرجع نمشي على خط سير الحملة على الخريطة») — feeding the "every screen assigns the next action" principle.
- **Parent/WhatsApp line** falls out directly, in the caring-tutor voice: «في التاريخ: بيرتّب الأحداث كويس جدًا، وبنشتغل على تثبيت الأسباب والنتائج — دي أهم حاجة في امتحان الدراسات.» One skill praised + one being worked on + why it matters for the exam: 30-second readable, forwardable.
- The dial's exam-verb mapping should be explicit on the card footer for the anxious student: «الأسئلة دي هي نفسها أسئلة الامتحان: رتب، حدد على الخريطة، بم تفسر، ضع المصطلح».

---

## Open calls for Samuel (my recommendations first)

1. **MVP set = map_scene + locate_on_map, timeline + timeline_builder, chain_builder, term_match** (§2c). Recommend yes — covers every sampled lesson type; base-map assets are the only real investment.
2. **Base-map asset build** (~6–8 Ledger-styled SVGs + gazetteers): commission as a one-time design task before any extraction of this subject. Recommend simplified hand-drawn-atlas style from public-domain outlines; ~1 asset/day of design effort.
3. **Arabic TTS promotion to P1 for this subject** with an MSA-narration / text-coaching split (§3). Needs a small bake-off + student listening test; provider layer already supports it.
4. **RTL scope:** lesson-route-level flip + logical-properties audit + bidi-isolation QA checklist (§4), executed once, before this subject ships — and it becomes the RTL foundation the *math* production PWA needs anyway (the deferred "RTL document pass" in tutor-experience-v2 §Deferred).
5. **Extraction note (not design, flagging):** the book's أسباب/أحداث/نتائج boxes, مفاهيم boxes, and lesson-objective lists are unusually structured — the extraction schema for this subject should capture them as typed facts (events, chains, terms, gazetteer refs), which is exactly what the widgets consume. Same human-review gate applies before any student sees them.

# Spec proposal: Arabic language (اللغة العربية) — the student experience

- **Status:** PROPOSAL for Samuel — no implementation, no code. Product-designer draft, 2026-07-28.
- **Scope:** Egyptian Prep-3 اللغة العربية, Term 1 Unit 1 as the design sample. Source book `docs/Source/Arabic_Prp3_Tr1_2.pdf`, printed pp. 8–23 (PDF 9–24): الدرس الأول «عِبادُ الرَّحمن» (قرآن), الدرس الثاني «كُنْ جَميلًا» — إيليا أبو ماضي (شعر), الدرس الثالث «قِصّةُ أثَرٍ» (نثر/قصة).
- **Builds on:** `docs/specs/social-studies-interactions.md` (the sibling subject spec), `docs/specs/tutor-experience-v2.md` (beats + السبورة + controlled-step reveal), the directive machinery in `app/src/lib/lesson.ts` (`{{beat}}`, `{{widget:<kind>:<flat JSON>}}`, the TEACHING SCRIPT block) and `app/src/components/student/LessonSession.tsx` (doors → learn/review → report card).
- **Design authority:** every recommendation below is traced to a printed page. Where I am guessing, it says **[ASSUMPTION]** and names the test.

---

## 0. The one-paragraph thesis

The Arabic book already prints the lesson arc we need. Every one of the three lessons has the *identical* six-part skeleton: ناقش → النص (+معاني المفردات، شرح، مواطن الجمال) → اسأل وناقش → قراءة صامتة وأسئلة أعمق → لغويات وتراكيب → الكتابة (إملاء/خط/تعبير). We do not invent an arc for this subject; **we take the book's own arc and convert its passive steps into actions.** The single design move that makes Arabic feel alive rather than recited is this: *the line the student just found beautiful is the line he then parses.* «أَيُّهَذَا الشَّاكِي» is printed on p. 15 as a موطن جمال (نداءٌ للتنبيه) and on pp. 16–17 as the grammar lesson (المنادى المبني). The book puts them three pages apart. We put them thirty seconds apart. That seam is the product.

---

## 1. What the book actually does (evidence base)

### 1.1 The fixed lesson skeleton — identical in all three lessons

| Book section | Printed at | What it contains | Our conversion |
|---|---|---|---|
| **أهداف الدرس** (sidebar) | 8, 14, 19 | 8–9 ministry objectives, verbatim | → the 5 spine LOs (§1.4) |
| **القضايا المتضمنة** (sidebar) | 8, 14, 19 | values: حقوق الإنسان، التسامح، الوحدة الوطنية، محاربة التطرف | → tone only. **Never quizzed** (§6) |
| **ناقش** | 8, 14, 19 | 2–4 personal opener questions, no wrong answer | → the تمهيد beat (chips + free text) |
| **① استمع ثم تحدث / استمع وتذوق** | 8, 14, 19–20 | THE TEXT, fully vocalized + «انظر وتأمل» image | → `text_panel` pinned on السبورة, read aloud |
| **معاني المفردات** | 9, 14, 21 | word → gloss table | → `word_work` taps |
| **شرح الآيات / شرح الأبيات** | 9, 15 | one canonical paraphrase paragraph | → the tutor's script + the grader's rubric |
| **مواطن الجمال في الآيات/الأبيات** | 9, 15 | 5 bullets, each: expression → device → effect. **Absent from قصة أثر** | → `beauty_spot` (§3.2) |
| **② اسأل وناقش** | 9, 15, 21 | comprehension + a speech-bubble question + a fill-in blank | → check beats |
| **③ قراءة صامتة ثم ناقش** | 10, 16, 21–22 | دلالة / حقيقة أم رأى / أسلوب+غرض(أكمل) / مرادف-مفرد-مضاد / الجمال / تلخيص | → the exam-verb battery (§3) |
| **④ لغويات وتراكيب** | 10–12, 16–17, 22 | المنادى — serialized across the three lessons | → `iraab_builder` (§3.3) |
| **⑤ الكتابة: أ-الإملاء** | 12–13, 18, 23 | الهمزة: condition→example table + a blank column | → `hamza_pick` (§3.7) |
| **⑤ ب-الخط، جـ-التعبير** | 13, 18, 23 | النسخ والرقعة handwriting; civic composition prompts | → **non-goals** (§6) |
| **اقرأ واستمتع** | 13, 18, 23 | enrichment (نجيب محفوظ، نوتردام) | → optional closing card, ungraded |

### 1.2 مواطن الجمال is a table, not prose — the load-bearing discovery

Every printed bullet decomposes into the same four fields. Verbatim from pp. 9 and 15:

| الشاهد | النوع | الغرض / الأثر |
|---|---|---|
| «يمشون على الأرض هونًا» | تعبير جميل (صورة) | يدل على تواضعهم الدائم |
| «اصرف» | أسلوب أمر | يفيد الدعاء |
| «يسرفوا ↔ يقتروا» ، «سيئات ↔ حسنات» | تضاد | يبرز المعنى ويؤكده |
| «يمشون، يبيتون، يقولون» | أفعال مضارعة | تفيد الاستمرار والتجدد |
| «إنَّ عذابها كان غرامًا» | أسلوب مؤكد بـ«إنّ» | تعليل لما قبله |
| «أيهذا الشاكي» | نداء | للتنبيه |
| «كيف تغدو إذا غدوت عليلًا؟» | استفهام | غرضه الاستنكار |
| «تتوقى قبل الرحيل الرحيلا» | تعبير موحٍ | يوحي بالخوف والقلق والتشاؤم |
| «ترى فوقها الندى إكليلا» | صورة | صوّر قطرات الندى بتاج المَلِك |
| «فتمتع بالصبح ما دمت فيه» | أسلوب أمر | غرضه النصح والإرشاد |

**النوع** and **الغرض** are each a closed vocabulary of ~8 values. A closed vocabulary is a widget. This is the same structural gift the Social book gave us with its أسباب/أحداث/نتائج boxes — and it means the highest-value Arabic interaction grades **deterministically, client-side, with zero AI involvement**.

The book even prints the interaction: p. 16, exercise جـ — «فتمتع بالصبح ما دمت فيه، أسلوب: ......... غرضه: .........(أكمل)». Two blanks. Two taps.

### 1.3 The grammar is a serial, not a topic

| Lesson | Grammar | Ruling | Printed |
|---|---|---|---|
| ① عباد الرحمن | المنادى المُعرَب: المضاف / الشبيه بالمضاف / النكرة غير المقصودة | منصوب — بالفتحة، الكسرة، الياء، الألف | 10–12 |
| ② كن جميلا | المنادى المبني (المفرد): العلم / النكرة المقصودة | مبني على الضم، الألف، الواو — في محل نصب | 16–17 |
| ③ قصة أثر | نداء ما فيه «ال»: أيها/أيتها، يا ألله، اللهم؛ إعراب «أيّ» | مبني على الضم؛ ما بعده صفة أو بدل مرفوع | 22 |

Two things follow. First, **إعراب المنادى is a two-decision tree with a small closed set at each node** — a builder, not an essay. Second, the book introduces the rule *inductively* from an underlined قطعة, not rule-first: p. 10 says, in effect, look at the underlined words and you will find they are منادى preceded by يا. Our tutor must mirror that order — **notice, then name** — because rule-first is precisely the dead lesson we are replacing.

الإملاء is serialized the same way: الهمزة المتوسطة على واو (p. 12) → على السطر (p. 18) → الهمزة المتطرفة (p. 23).

### 1.4 Recommendation: collapse 8–9 printed objectives into 5 spine LOs

The printed أهداف lists include objectives we will not serve (يكتب نموذجًا بخطي النسخ والرقعة). If those become LOs they sit at 0% mastery forever and quietly lie to the parent. Proposed LO set, identical in shape for every Arabic lesson — and identical to the report-card axes (§5), so the stepper, the report and the WhatsApp line all speak the same five words:

1. **المفردات** — معاني المفردات + مرادف/مضاد/مفرد/جمع + المعنى من السياق
2. **الفهم** — الفكرة العامة، الأفكار الجزئية، أسئلة النص
3. **التذوق** — مواطن الجمال (قرآن/شعر) *or* الاستنتاج والتلخيص (نثر)
4. **النحو** — المنادى (this lesson's slice)
5. **الإملاء** — الهمزة (this lesson's slice)

Stepper reads «٣ من ٥ · التذوق». Handwriting and التعبير are **out of the spine**, not silently failed.

---

## 2. The lesson arc

### 2.1 The contested call: one lesson, or two linked sessions?

**Recommendation — Direction A: ONE session, TWO acts, with an explicit hinge.**

| | What it is | Why | Cost |
|---|---|---|---|
| **A — one session, hinged** ✅ | Act 1 النص (feel + understand) → **hinge** → Act 2 القاعدة (apply), entered through a line of the text itself | Matches the book (§4 sits *inside* the lesson) and matches Omar's mental model — school assigned "درس العربي", singular. Keeps our one-action-per-screen law: no menu, no choice. And the hinge is the whole emotional payoff — it evaporates if the two halves are a day apart. | 15 minutes gets tight; the grammar act can feel rushed |
| **B — two linked sessions** | «النص» today, «النحو» tomorrow | Mirrors the exam's own paper split (نصوص / نحو); each act breathes; grammar gets natural spacing | Two doors is a **menu**, which we have ruled out for this student. The hinge dies. A student who does only half generates a half-report the parent can't read. |
| **C — one session, grammar first** | Rule → examples → then the text | How many Egyptian tutors actually teach; gets the exam-heavy half done while attention is highest | This is exactly the dead, unmemorable lesson we exist to replace. The text becomes a worksheet the student never feels. |

**Mitigating A's cost — the arc is elastic at exactly one joint.** Act 2 always runs in full (it is the scored half). What flexes is the *depth* of Act 1's التذوق: two مواطن جمال when there's time, one when the student is slow. And B's spacing benefit is recovered without B's menu: the report card can *assign* a 4-minute grammar-only «جولة تانية» on a later day — an assignment, never an option.

**Budget for a 15-minute learn session:** تمهيد 1 · Act 1 النص ≈ 7 · Act 2 القاعدة ≈ 5.5 · قفلة + report ≈ 1.5.

### 2.2 The whiteboard's protagonist changes

In math السبورة holds a figure; in Social it holds a map or a timeline. **In Arabic it holds the text.** A new board item type `text_panel` is pinned for the entire session and never scrolls away; the tutor highlights spans inside it as the lesson moves (`text_focus`). The filmstrip holds the rule card and the earlier highlighted states. This is the same pin/focus/replay seam already built — the board just gains one item type.

### 2.3 Arc — قرآن (عِبادُ الرَّحمن, pp. 8–13)

Reverence first, meaning forward. **The first meeting with a sacred text is not a quiz.**

| # | Beat | Interaction | Notes |
|---|---|---|---|
| 0 | تمهيد | 3 chips on the book's own ناقش: «ما صفات عباد الرحمن؟» | No wrong answer. Anxiety floor. |
| 1 | عرض الآيات | **none** | Verses render from the stored asset, fully vocalized, whole; TTS reads them; student may read along. One beat of stillness. |
| 2 | المفردات | `word_work` ×3 (هونًا، اصرف، غرامًا) | ~40s, all-correct-by-design warm-up |
| 3 | الصفات | tutor names one صفة per beat → `text_pick`: «استخرج من الآيات الصفة اللي بتتكلم عن الإنفاق» | comprehension by locating, not by recall |
| 4 | **التذوق ①** | `beauty_spot` on «يمشون على الأرض هونًا» → نوع + غرض | |
| 5 | **التذوق ②** | `text_pick` (two spans): «دوس على الكلمتين المتضادتين» → then «التضاد ضايف إيه؟» | تضاد, p. 9 |
| 6 | الدلالة | `text_pick` ×3 on the مضارع verbs → «دلالتها؟» → الاستمرار والتجدد | the book's own p. 10 question |
| 7 | **الهينج** | — | Weakest of the three: these آيات carry no منادى. Honest bridge: «الآيات فيها أسلوب أمر (اصرف) — النهاردة أسلوب تاني، بيندهلك: النداء.» |
| 8 | القاعدة | `rule_card` reveal → `iraab_builder` ×2 on the book's قطعة («يا شبابَ مصر» = مضاف منصوب بالفتحة؛ «يا راغبين» = شبيه بالمضاف منصوب بالياء) | pp. 10–12 |
| 9 | الإملاء | `hamza_pick` ×2 (سؤال، يؤم) | p. 12 |
| 10 | القفلة | `cloze` ×1 (أكمل الآية — §4) → report | |

### 2.4 Arc — شعر (كُنْ جَميلًا, pp. 14–18)

Feel first, then track the argument. **This is the arc that carries the killer moment.**

| # | Beat | Interaction | Notes |
|---|---|---|---|
| 0 | تمهيد | 3 chips: «كيف ترى الحياة من وجهة نظرك؟» | book's own ناقش, p. 14 |
| 1 | عرض الأبيات | **none** | بيت by بيت, صدر then عجز, paced reveal + TTS. In poetry the reveal cadence *is* the meter — this is where paced reveal earns its rent. |
| 2 | المفردات | `word_work` ×4 (داء، عليلا، تتوقى، إكليلا) | p. 14 table |
| 3 | الفكرة | «الشاعر بيعاتب مين؟» → `line_order`: order 4 أبيات by the argument (شكوى → استنكار → نصيحة → خلاصة) | reuses TimelineBuilder. Rhyme gives no clue (all lines rhyme in ـلا) — the student **must** use meaning. |
| 4 | **KILLER** | `beauty_spot` chain on البيت الأول (§4) | See §4 in full |
| 5 | الهينج | tutor: «الكلمة دي بالذات هي درس النحو النهاردة.» | Zero seam. This is the demo. |
| 6 | القاعدة | `rule_card` (المنادى المبني) → `iraab_builder` ×3 (يا خالدُ / يا خالدان / يا خالدون), third tap = العلامة | pp. 16–17 |
| 7 | التذوق ② | `beauty_spot` on «ترى فوقها الندى إكليلا» — الشاعر شبّه إيه بإيه؟ | p. 15 |
| 8 | حقيقة أم رأي | `fact_or_opinion` on «إن شرَّ الجناة في الأرض نفسٌ…» + why | the book prints exactly this, p. 16 |
| 9 | الإملاء | `hamza_pick` ×2 (جزءان، تبوّءك) | p. 18 |
| 10 | القفلة | `cloze` on «كن جميلًا تر الوجود ......» → report | |

### 2.5 Arc — نثر/قصة (قِصّةُ أثَرٍ, pp. 19–23)

Nearest neighbour to Social Studies. **The book prints no مواطن جمال for this lesson** — so the التذوق slot is filled by الاستنتاج والتلخيص instead. That asymmetry is the book's, not ours.

| # | Beat | Interaction | Notes |
|---|---|---|---|
| 0 | تمهيد | 3 chips: «ما أهم القلاع الموجودة في مصر؟» | p. 19 |
| 1 | النص أ (الكنيسة المعلقة) | **none** | text_panel + the book's photo |
| 2 | المفردات | `word_work` ×4 (منار، طوائف، العتاد، يرتادها) | p. 21 |
| 3 | **التلخيص** | `explain_back` — «لخّص الفقرة الأولى بأسلوبك» (AI-graded, §3.8) | the book's own printed exercise, p. 21. The centrepiece of this arc. |
| 4 | الاستنتاج | 3 chips: «ما دلالة وجود جامع عمرو بن العاص بجوار الكنيسة؟» → tutor gives the book's framing (الوحدة الوطنية), no commentary | p. 21. Sensitive-content rules, §6. |
| 5 | النص ب (قلعة قايتباي) | text_panel | |
| 6 | الترتيب | `line_order`: المماليك → قنصوه الغوري → العثمانيون → محمد علي | the paragraph is chronological, p. 20 |
| 7 | حقيقة أم رأي | `fact_or_opinion` on one sentence | objective, p. 19 |
| 8 | القاعدة | `rule_card` (نداء ما فيه ال) → `iraab_builder` ×2 (أيها الرجلُ / يا أيتها الطالباتُ) | p. 22 |
| 9 | الإملاء | `hamza_pick` ×2 (شاطئ، لؤلؤ) — الهمزة المتطرفة is where this widget shines | p. 23 |
| 10 | القفلة | report | no cloze — prose is not memorised |

### 2.6 The «فهمت كله ✓» door — 3-minute lock-in for Arabic

Same 5-turn cap as today. Script: `word_work` (2 words) → `beauty_spot` (one line) → `iraab_builder` (one word) → warm wrap. Three checks, one per scoring axis that actually carries exam marks. No text reading, no تمهيد.

---

## 3. The interactions, in priority order

All follow the existing contract: `{{widget:<kind>:<flat JSON>}}`, last beat of the message, **tap-to-select never drag** (cheap touchscreens, per the Social spec), graded client-side where possible, result posted as `[live event]`, wrong answer → warm coaching, never a score, never a red X.

| # | Widget | Teaches | Beats a plain question because | Grading | Effort | Call |
|---|---|---|---|---|---|---|
| 1 | `word_work` | المفردات | zero typing; 4 taps in 40s = the fastest possible "I'm making progress" signal at minute one | deterministic | trivial | **MVP** |
| 2 | `beauty_spot` | التذوق — أسلوب + غرض | converts appreciation from a thing to memorise into a thing to **notice** | deterministic (closed sets) | medium | **MVP — the killer** |
| 3 | `iraab_builder` | النحو | makes the *decision structure* visible: إعراب is two decisions, not a sentence to produce | deterministic | medium-low | **MVP** |
| 4 | `text_pick` | الاستخراج | tests finding, not spelling — typing vocalised Arabic on a cheap Android is punishment | deterministic (stored spans) | medium | **MVP** (shared primitive) |
| 5 | `fact_or_opinion` | الفهم النقدي | printed objective in two of three lessons; two taps + one sentence | tap deterministic, "why" AI-graded | trivial | **MVP** |
| 6 | `line_order` | بنية النص | orders the *argument*, not the rhyme | deterministic | **zero** (reuse TimelineBuilder) | **MVP** |
| 7 | `hamza_pick` | الإملاء | pick-the-spelling is verbatim the exam item; the error is visible | deterministic | trivial | **MVP** |
| 8 | `explain_back` | الفهم / التلخيص | the only thing that proves he understood rather than matched | AI-graded vs canonical شرح | medium (prompt) | **MVP** |
| 9 | `cloze` | الحفظ (light) | the exam's «أكمل» verb, ~free given we hold the text | deterministic | low | **MVP, gated** (§4) |
| 10 | `tashkeel` standalone | الضبط | — | ambiguous | high | **fold into #3 as step 3** |
| 11 | صدر/عجز reassembly | — | degenerates into rhyme-matching; `line_order` already gets the value | deterministic | low | **Wave 2** |

### 3.1 `word_work` — «شغل الكلمة»
```json
{"prompt":"«هونًا» معناها إيه؟","word":"هونًا","mode":"synonym",
 "correct":"بسكينة ووقار","options":["بسرعة","بسكينة ووقار","بصوت عالٍ"]}
```
Modes: `synonym` / `antonym` / `singular` / `plural` / `in_context`. **Distractors come only from the same lesson's glossary**, never LLM-invented — grounded, and a wrong tap teaches a second real word. `in_context` (the same word in a new sentence) serves the printed L3 objective «يستنتج معنى كلمة جديدة من خلال السياق».

### 3.2 `beauty_spot` — «ليه دي حلوة؟» (the core)
Three stages in one card; stages 2 and 3 unlock only after the one before.
```json
{"line_id":"v1","prompt":"دوس على الكلمة اللي بينادي بيها الشاعر",
 "spans":[[0,7]],
 "device":{"correct":"نداء","options":["نداء","استفهام","أمر","تضاد","توكيد","تشبيه"]},
 "purpose":{"correct":"التنبيه","options":["التنبيه","الاستنكار","النصح","الدعاء","التوكيد"]}}
```
- Stage 1 `text_pick`: tap the span inside the pinned text (1 span; 2 for تضاد).
- Stage 2 النوع: chip row.
- Stage 3 الغرض: chip row.
- **The coaching is the pedagogy.** Every device has a surface clue, and a wrong tap surfaces the clue rather than the answer: نداء → أداة النداء; استفهام → أداة الاستفهام; أمر → صيغة الفعل; تضاد → كلمتان متقابلتان. Teaching the clue is teaching the skill.
- The result note carries which stage failed, so the report card can distinguish "can't find it" from "can't name it" — different gaps, different next steps.

### 3.3 `iraab_builder` — «أعرب في خطوتين»
```json
{"sentence_id":"g2-1","target_span":[3,9],
 "type":{"correct":"علم مفرد","options":["مضاف","شبيه بالمضاف","نكرة غير مقصودة","علم مفرد","نكرة مقصودة"]},
 "ruling":{"correct":"مبني على الضم في محل نصب",
           "options":["مبني على الضم في محل نصب","منصوب بالفتحة","منصوب بالياء"]},
 "sign_letter":{"index":5,"correct":"ضمة","options":["ضمة","فتحة","كسرة"]}}
```
- **Step 2's option set is derived from step 1's answer** — which is the rule itself. Revealing step 2 only after step 1 is pedagogy, not a UI limitation.
- Step 3 (`sign_letter`) is the scoped تشكيل: one letter, large target, 3 options — the exam's «اضبط ما تحته خط». **[ASSUMPTION]** that three steps still reads as "easier" and not "more work". Test with 3 students before shipping step 3; ship steps 1–2 first.
- Wrong step 1 → coach from the *neighbouring* type, never the answer: «لو كان علم مفرد كان مبني على الضم. بس ده جه بعده كلمة بتكمّل معناه — يبقى إيه؟»

### 3.4 `text_pick` — the shared span primitive
Renders the pinned text with **whole words as tap targets** and returns the tapped span ids. Used standalone for «استخرج منادى / استخرج أسلوب تضاد» and as stage 1 of `beauty_spot`. Requires character spans from extraction (§7). Hard constraint: tap targets are **whole words only** — see §8 on Arabic shaping.

### 3.5 `fact_or_opinion` — «حقيقة ولا رأي؟»
Two big buttons + a one-line "ليه؟" (typed, or picked from 3 canonical justifications on the easier tier). The tap grades locally; the "ليه" goes to the grader. Printed at p. 16 and as an objective at pp. 14, 19.

### 3.6 `line_order` — reuse
`TimelineBuilder` unchanged, relabelled. Orders أبيات by argument, or events by chronology. **Zero build.**

### 3.7 `hamza_pick` — «إمْلا في نص دقيقة»
```json
{"prompt":"إزاي تتكتب؟","gap":"سـ__ال","options":["سؤال","سأال","سئال"],"correct":"سؤال",
 "rule":"مفتوحة وما قبلها مضموم → على واو"}
```
Two words, 30 seconds, in the closing act. On a correct tap the rule row lights up in the `rule_card` — the student sees *why*, not just *right*.

### 3.8 `explain_back` — the one AI-graded interaction
Free text (or mic), graded against the book's own شرح الآيات/الأبيات or the paragraph's canonical bullets. **Hard rule: grade ideas, never language.** Omar writes عامية, misspells, and drops الهمزات. If the grader penalises that, the interaction becomes humiliating and violates dignity-in-failure. Rubric: which canonical ideas appeared, in his own words. Register and spelling are *never* scored here — الإملاء has its own axis and its own widget.

---

## 4. The killer moment — «الكلمة دي مش صدفة»

**The beat.** The poem's first line is on the board: «أَيُّهَذَا الشَّاكِي وَمَا بِكَ دَاءٌ / كَيْفَ تَغْدُو إِذَا غَدَوْتَ عَلِيلًا؟»

1. Tutor: «في السطر ده الشاعر عمل حاجتين مقصودين. تعالى نمسكهم.»
2. `beauty_spot` #1 → tap «كيف تغدو…؟» → النوع: **استفهام** → الغرض: **الاستنكار**. Tutor: «مش بيسأل عشان يعرف. بيستنكر عليك.»
3. `beauty_spot` #2 → tap «أَيُّهَذَا» → النوع: **نداء** → الغرض: **التنبيه**.
4. **The hinge, one line, no widget:** «طيب — الكلمة اللي لسه ماسكينها دي؟ دي بالظبط درس النحو النهاردة. تعالى نعربها.»
5. `rule_card` opens on المنادى المبني, and the *same word* becomes the first `iraab_builder`.

**Why this is the product, in five lines a co-founder will accept:**
1. **It is the thing a fact-tutor structurally cannot do.** Any chatbot defines المنادى. Making a 15-year-old *notice* that the poet grabbed him by the shoulder before telling him off — that is a human tutor's move, and we just automated it.
2. **It fuses the two halves of the subject in one gesture.** One tap sequence, two curriculum objectives (التذوق + النحو), one emotional beat. The demo sentence: *"the line he just found beautiful is the line he's about to parse."*
3. **It is 100% deterministic.** Closed vocabularies, stored spans, no AI grading. It cannot hallucinate and it cannot humiliate — the two failure modes that would kill this subject.
4. **It disarms the most-feared exam item.** «أسلوب: ......... غرضه: .........(أكمل)» is printed on p. 16 as a blank the student dreads. He just answered it as a game, before he knew it was one.
5. **It is book-grounded to the letter** — p. 15 مواطن الجمال bullet 1, p. 16 exercise جـ, pp. 16–17 المنادى المبني. Three printed pages, one interaction, zero invention.

---

## 5. Memorization (الحفظ) — support lightly, defer the system

**The book's evidence.** Across all three lessons the printed objectives ask for **تلاوة صحيحة** (p. 8), **إلقاء معبر** and **شرح النص بأسلوبه** (p. 14), **قراءة جهرية معبرة** and **تلخيص** (p. 19). The exercises say «اتلُ الآيات تلاوة جهرية صحيحة» and «اقرأ النص قراءة جهرية معبرة». **No lesson in this unit prints a حفظ objective.** The ministry is asking for correct expressive *reading*, not recitation from memory.

**Recommendation, three parts:**

1. **Read-along, ungraded — ship it.** The tutor's TTS reads the text; the student may read with it; the paced reveal keeps the cadence. This serves the actual printed objective, costs nothing new (the `app/src/lib/tts/` provider layer + hash-keyed audio cache already exist; canonical text lines are perfectly cacheable), and carries zero grading risk. For poetry it is a real quality upgrade — meter is audible, not visible.

2. **Cloze («أكمل») — ship it, gated.** ≤1 beat per lesson, poetry and قرآن only, drawn from the stored text asset. It matches the exam's own «أكمل» verb, it is nearly free, and it produces the pleasant "I know this" feeling at the end of a session. **Gates for قرآن (non-negotiable):** the full verse is displayed intact first, in a separate beat; the practice card is a *separate* card; the student **picks** words, never types them; every option is a word from that same verse; the lafẓ الجلالة is never blanked; the missing word comes from the stored asset and **never from the model**.

3. **Defer: recitation grading (ASR/tajweed) and any spaced-repetition حفظ scheduler.**
   - *Recitation grading* — Arabic ASR on a 15-year-old's voice, over 3G, in Quranic register, is a research project with a religiously sensitive failure mode: a flaky model telling an Egyptian teenager his تلاوة is wrong is a churn event, not a bug. Recording-and-storing without grading is worse: it adds a minor's voice to our PII surface for no learning gain. **No.**
   - *Spaced repetition* — حفظ only pays off as a cross-session schedule, and Arabic has no daily-plan engine yet. It is a natural Wave-2 unlock once one exists, and when it comes the unit is **«بيت واحد في اليوم»**, not "the whole poem".

**[ASSUMPTION] needing validation before build:** that a Quran cloze reads as respectful practice rather than gamification. This must be tested with a **parent and a teacher**, not only a student — the parent is the buyer, and a mishandled Quran interaction is not a usability defect, it is an account cancellation.

---

## 6. Sensitive content — hard rules for this subject

Arabic carries risks the other two subjects do not. These are product constraints, not tone preferences.

1. **Quranic text is an asset, never a generation.** Verses are stored verbatim (vocalised, verse-numbered) from a verified, human-reviewed source and rendered from that asset. The model is **forbidden** to reproduce, paraphrase, complete, correct or "improve" Quranic text in its own output; when it needs the verse it emits a reference directive and the stored asset renders. Same rule for the poem's lines. An LLM misquoting Quran to an Egyptian teenager ends the product.
2. **The book's شرح is the ceiling.** No تفسير beyond the printed شرح الآيات, no فتوى, no theology, no comparative religion, no elaboration on عذاب/الزنا/الشرك beyond the book's own wording. Off-book question → the existing acknowledge → decline → redirect script.
3. **Cross-faith neutrality by design.** This unit contains a Quran lesson *and* a lesson about الكنيسة المعلقة beside جامع عمرو بن العاص, whose own printed point is الوحدة الوطنية. The tutor never assumes Omar's faith, presents each text exactly as the book frames it, and adds no commentary in either direction.
4. **القضايا المتضمنة (حقوق الإنسان، التسامح، محاربة التطرف) are tone, never quiz items.** They shape the warmth of the closing line; they never become a question with a right answer.
5. **The التعبير prompts are political** (ثورتا ٢٥ يناير و٣٠ يونيو، الشرطة والجيش والشعب) — see §7, they are out of scope. Nothing in the session invites political opinion.

---

## 7. Non-goals for MVP

- **الخط (النسخ والرقعة)** — a printed objective in all three lessons, and out of reach: it needs camera capture or finger-tracing plus handwriting evaluation. Small exam weight, large build. **Not an LO** (§1.4).
- **التعبير / composition grading** — a different product, and §6.5 makes these particular prompts a poor first one.
- **Recitation ASR / tajweed grading**, and voice recording storage (§5.3).
- **Standalone تشكيل tool** — folded into `iraab_builder` step 3, one letter at a time (§3.3).
- **حفظ scheduler / spaced repetition** — Wave 2, needs a daily-plan engine (§5.3).
- **صدر/عجز reassembly** — Wave 2; `line_order` captures the value now (§3, row 11).
- **Drag-and-drop anything** — tap-to-select everywhere.
- **A cross-lesson «امتحان النحو» surface** — the grammar serial is real, but a unit-exam surface is scope we have not earned.
- **Any LLM-authored Arabic literary or Quranic text** — assets only, human-reviewed, always.

---

## 8. Handoff to frontend-engineer — states and Arabic-specific traps

**States for every widget:** empty (no spans stored → the widget must not render at all, not render broken), loading (skeleton in the shape of the text block, never a spinner over the verse), offline (the text asset and all deterministic widgets work fully offline; only `explain_back` and the tutor's next beat need the network — queue and tell him honestly: «مفيش نت دلوقتي — كمّل، وأنا هبعت لما يرجع»), error (a widget that fails validation degrades to a chip, exactly like the viz path today), and **resume** (the pinned text and its highlight state must restore with the session — sessionStorage already carries board items).

**The five Arabic traps, in the order they will bite:**

1. **Font subsetting will eat the harakat.** Aggressive woff2 subsetting drops combining-mark codepoints and every vocalised line renders bare — a silent, total content failure. The Arabic face must be subset **with** the diacritic ranges explicitly retained, and the Quran block needs a face that carries the full mark set (Naskh-class). Budget it against the 1.5 MB first-load ceiling deliberately; do not let a build tool decide.
2. **Never split a word with a `<span>`.** Highlighting a sub-word range breaks Arabic joining and the word visually falls apart. Tap targets and highlights are **whole words only**; ranges come from stored spans, never from JS whitespace splitting (clitics like وَالَّذِينَ / لِرَبِّهِمْ make naive splitting wrong anyway).
3. **Line-height and clipping.** Fully vocalised text at Latin line-heights clips ascenders and marks. Poetry needs more leading than prose; the Quran block more than both.
4. **The شعر layout is the hardest in the app.** صدر | عجز is a two-column RTL pair that must collapse to stacked on a 320 px screen **without losing the pairing** — and the عجز stays right-aligned in its own column when it does. Design it at 320 px first, not last.
5. **Numerals and bidi islands.** Arabic-Indic digits in all student-facing prose (matching the book), verse markers ﴿٦٣﴾ live inside the text asset, and `<bdi>` around every mixed run. Free-text input is `dir="rtl"`, no autocorrect assumptions, and the existing Web-Speech mic is a genuine accessibility win for a student who types slowly.

**Extraction contract this rests on** (flagging for data-engineer / ai-engineer, not designing it): `text_asset` (verbatim, vocalised, line-ids + character spans, `sacred: true` flag), `glossary[]`, `explanation[]` (canonical, feeds the grader), `beauty_spots[] {spans, device ∈ closed set, purpose ∈ closed set, note}`, `grammar_instances[] {span, type, ruling, sign_letter_index}`, `spelling_items[] {gap, options, rule_id}`, `discussion_prompts[]`, `values[]`. Same human-review gate as every other subject, plus a **sacred-text verification step** for the Quran assets.

---

## 9. Arabic UX copy

Register: content in فصحى مبسطة, coaching in Egyptian — matching the existing `social-ar` LANGUAGE CONTRACT. Never positions against the school teacher.

### The doors
Keep the two doors **byte-identical to the other subjects** — one gesture, learned once, across the whole product. Only the sub-line and affordance strip change.

| | Copy |
|---|---|
| Lesson chip | «قرآن كريم» / «شعر» / «قصة» (beside the lesson title, like the existing «هندسة» / «دراسات») |
| Door 1 title | **مش فاهم حاجة** |
| Door 1 sub | اشرحهولي من الأول خالص. |
| Door 1 strip | النص والمعنى · مواطن الجمال · النحو خطوة خطوة |
| Door 1 CTA | علّمني ← |
| Door 2 title | **فهمت كله ✓** |
| Door 2 sub | فاهمه — مراجعة سريعة في ٣ دقايق. |
| Door 2 strip | مفردات · أسلوب وغرض · إعراب |

### Key moments

| Moment | Copy |
|---|---|
| Text reveal (قرآن) | اسمعها الأول… مش هنسأل دلوقتي. خليك معايا بس. |
| Text reveal (شعر) | هقراهولك بيت بيت. سيب ودانك تسمع الوزن. |
| `word_work` correct | كده تمام — الكلمة دي مش هتلخبطك تاني. |
| `word_work` wrong | قريبة. بص للجملة اللي حواليها — هي اللي بتقولك. |
| `text_pick` miss | قربت. بص على أول البيت — في كلمة بتنادي عليك. |
| `beauty_spot` — wrong النوع | مش أمر. شوف: في أداة استفهام؟ يبقى النوع إيه؟ |
| `beauty_spot` — wrong الغرض | الاستفهام هنا مش عايز إجابة — الشاعر مستغرب ومستنكر. جرّب تاني. |
| `beauty_spot` — correct | برافو. دي بالظبط «أسلوب … وغرضه …» اللي بتيجي في الامتحان. |
| **The hinge** | الكلمة اللي لسه ماسكينها دي؟ دي بالظبط درس النحو النهاردة. تعالى نعربها. |
| `iraab_builder` step 1 | نبدأ بسؤال واحد بس: المنادى ده نوعه إيه؟ |
| `iraab_builder` step 2 | تمام — وما دام مضاف، يبقى حكمه إيه؟ |
| `iraab_builder` wrong | لو كان علم مفرد كان مبني على الضم. بس ده جه بعده كلمة بتكمّل معناه — يبقى إيه؟ |
| `explain_back` prompt | اكتب بكلامك إنت — مش لازم كلام الكتاب. وغلطة إملا مش مشكلة دلوقتي. |
| `explain_back` partial | فكرتين من تلاتة. ناقصك إن الكنيسة اتجددت أكتر من مرة — زوّدها وتبقى تمام. |
| `cloze` | كمّل من غير ما تبص. ولو مش فاكر، دوس «فكّرني» والسطر يرجع ثانية. |
| «لسه مش فاهم» | ولا يهمك — تعالى من أول وجديد، وبمثال أسهل المرة دي. |
| Off-book question | سؤال محترم — بس إحنا هنا بنذاكر شرح الكتاب بس، لأنه اللي جاي في الامتحان. اللي الكتاب بيقوله هو: … |
| Closing | خلصنا. النهاردة مسكت النص، وعرفت تعرب المنادى. تعالى نشوف تقرير فهمك 📋 |

### Report card (بطاقة الفهم) — five axes, same five words as the stepper

| Axis | Fed by | Sample strength | Sample gap |
|---|---|---|---|
| **المفردات** | `word_work` | «المفردات ثابتة: هونًا، غرامًا، قوامًا» | «لسه بيلخبط بين المرادف والمضاد» |
| **الفهم** | comprehension checks, `fact_or_opinion` | «فهم فكرة النص من أول قراية» | «بيجاوب من عنده قبل ما يرجع للنص» |
| **التذوق** | `beauty_spot` (or التلخيص/الاستنتاج in النثر) | «عرف النداء والاستفهام وغرض كل واحد» | «بيلاقي التعبير بس لسه بيتلخبط في الغرض» |
| **النحو** | `iraab_builder` | «عرف نوع المنادى وعلامته من أول مرة» | «بيعرف النوع، والعلامة لسه محتاجة تثبيت» |
| **الإملاء** | `hamza_pick` | «الهمزة المتوسطة على واو مضبوطة» | «الهمزة المتطرفة محتاجة جولة تانية» |

- **Verdict stamps:** «متمكن» / «ماشي في السكة» / «محتاج جولة تانية» — never a percentile against classmates.
- **Next step is always an assignment, never an option:** «بكرة هنشتغل على الأسلوب والغرض — دي أكتر حاجة بتتسأل في الامتحان.»
- **Footer, for the anxious student:** «الأسئلة دي هي نفسها أسئلة الامتحان: استخرج، أسلوب وغرضه، أعرب، اضبط، هات المضاد.»
- **WhatsApp line (30-second parent read, forwardable):** «في العربي: الإعراب بقى ماشي — عرف نوع المنادى وعلامته من أول مرة. وبنشتغل على «الأسلوب والغرض»، ودي اللي بتاخد درجات كتير في الامتحان.» One thing praised, one thing being worked on, why it matters for the exam.

---

## 10. Open calls for Samuel (recommendations first)

1. **Arc = one session, two acts, hinged (§2.1 Direction A)**, with the elastic joint at التذوق depth and a report-assigned «جولة تانية» for grammar spacing. Recommend yes.
2. **MVP interaction set = `word_work`, `beauty_spot`, `iraab_builder`, `text_pick`, `fact_or_opinion`, `line_order` (reuse), `hamza_pick`, `explain_back`, gated `cloze`** (§3). Three of the nine are trivial, one is free.
3. **Killer moment = the `beauty_spot` → hinge → `iraab_builder` chain on «أيهذا الشاكي»** (§4). This is what I would put in front of a co-founder, and it should be the first thing built.
4. **Memorization: read-along + gated cloze now; recitation grading and spaced repetition deferred** (§5), on the evidence that no lesson in this unit prints a حفظ objective.
5. **Five spine LOs per lesson, not the printed 8–9** (§1.4) — handwriting and composition stay out of the graph rather than sit at 0% forever in the parent's report.
6. **Sensitive-content rules (§6) are hard gates, not guidance** — particularly "Quranic text is an asset, never a generation". Recommend these enter the Arabic language contract in `lesson.ts` the same way the Social sensitive-content rule did (ADR-0004 §5).
7. **Three things to validate before build, in this order:** (a) time a real 15-minute session end-to-end — the whole arc rests on it fitting; (b) put `iraab_builder` in front of 3 students to check that three steps reads as *easier*, not *longer*; (c) show the Quran cloze to a parent **and** a teacher, not just a student.

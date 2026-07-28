# Scout Report — Arabic «اللغة العربية / لغتي حياتي», الصف الثالث الإعدادي, 2025‑2026

**Source:** `/Users/samueltoma/Documents/Claude/Projects/AI Enthusiasts/PoC Tutor School V1/docs/Source/Arabic_Prp3_Tr1_2.pdf`
**Scanned by:** data-engineer, 2026‑07‑28. Every one of the 122 PDF pages was read visually.
**Purpose:** page‑accurate structural map to plan extraction (ADR‑0005 conveyor, Stage‑0 manifest input).

---

## 0. Book facts (verified, not inferred)

| Fact | Value |
|---|---|
| PDF pages | **122** (`pdfinfo`) |
| Text layer | **None.** 122 scanned JPEGs, 150 dpi, 1181×1624 px body pages. `pdftotext` yields 12 bytes total. |
| Colophon page count | ١٢٤ صفحة بالغلاف (PDF p.121) — differs from 122 because covers are double‑spreads |
| Cover pages | PDF **1** and **122** are landscape double‑page spreads (2421×1653 px) = front+back cover on one image |
| Producer | PDF Candy Desktop → GPL Ghostscript 9.50, created 2025‑08‑06 |
| Deposit no. | ٢٠٢٣/١٥٢٧٤ (PDF p.120); book no. ٢٣٧/٢/٢٤/٣/٣٣/١٠ |
| Structure | **Both terms in one file.** 6 units, **20 lessons** (10 per term) |
| Contents tables | **Two.** Term‑1 on PDF **p.7**; Term‑2 on PDF **p.65** |
| Standalone non‑lesson sections | **None** (see §3) |

---

## 1. Page‑offset rule — ⚠️ IT CHANGES

**There are two independent printed‑page series.** The single rule "printed = PDF − 1" is **only valid for Term 1** and will silently corrupt every Term‑2 citation.

| Range | Rule | Valid over |
|---|---|---|
| **Term 1** | `printed = PDF − 1` | PDF **9 → 62** (printed ٨ → ٦١) |
| **Seam** | *no printed folio at all* | PDF **63, 64, 65, 66** |
| **Term 2** | `printed = PDF − 61` | PDF **67 → 119** (printed ٦ → ٥٨) |
| **Back matter** | *no printed folio* | PDF **120, 121, 122** |

The break happens because the physical book restarts numbering at the term divider. Term‑1's last numbered page is printed ٦١ = PDF 62; Term‑2's first numbered page is printed ٦ = PDF 67.

**Offset delta at the seam = +60.** Any extractor carrying the Term‑1 rule into Term 2 will cite pages ~60 too low — i.e. it will point students at a *different, real, wrong* page of the same book. This is the highest‑severity failure mode in this source.

### Page‑offset verification log (pages I actually checked)

Term 1, `printed = PDF − 1`:

| PDF | Printed folio seen | ✓ |
|---|---|---|
| 9 | ٨ | ✓ |
| 11 | ١٠ | ✓ |
| 14 | ١٣ | ✓ |
| 19 | ١٨ | ✓ |
| 24 | ٢٣ | ✓ |
| 25 | ٢٤ | ✓ |
| 28 | ٢٧ | ✓ |
| 32 | ٣١ | ✓ |
| 36 | ٣٥ | ✓ |
| 41 | ٤٠ | ✓ |
| 44 | ٤٣ | ✓ |
| 48 | ٤٧ | ✓ |
| 52 | ٥١ | ✓ |
| 56 | ٥٥ | ✓ |
| 59 | ٥٨ | ✓ |
| **62** | **٦١** (last of Term 1) | ✓ |

Seam — no folio printed on any of these:

| PDF | Content |
|---|---|
| 63 | **fully blank** |
| 64 | الفصل الدراسى الثانى divider |
| 65 | **Term‑2 contents table** |
| 66 | Term‑2 Unit‑1 opener |

Term 2, `printed = PDF − 61`:

| PDF | Printed folio seen | ✓ |
|---|---|---|
| 67 | ٦ (first of Term 2) | ✓ |
| 68 | ٧ | ✓ |
| 70 | ٩ | ✓ |
| 75 | ١٤ | ✓ |
| 79 | ١٨ | ✓ |
| 82 | ٢١ | ✓ |
| 85 | ٢٤ | ✓ |
| 91 | ٣٠ | ✓ |
| 98 | ٣٧ | ✓ |
| 100 | ٣٩ | ✓ |
| 109 | ٤٨ | ✓ |
| 114 | ٥٣ | ✓ |
| 118 | ٥٧ | ✓ |
| **119** | **٥٨** (last content page) | ✓ |

**Late‑page confirmation (the point the brief flagged as riskiest):** PDF 118 → ٥٧ and PDF 119 → ٥٨. The `−61` rule holds unbroken to the final content page. No second shift exists.

**Unit‑opener folio inconsistency (do not mistake for an offset break):** unit‑opener pages are inconsistently foliated. PDF 25 (T1 U2 opener) *prints* ٢٤, but PDF 8, 42, 66, 80, 99 print **no folio**. The offset still holds arithmetically across them — proven by bracketing: PDF 41=٤٠ and PDF 43=٤٢ ⇒ PDF 42 = ٤١ implied; PDF 98=٣٧ and PDF 100=٣٩ ⇒ PDF 99 = ٣٨ implied. A folio‑sampling offset check that lands on an opener will read "no number" — that is *not* evidence of a shift.

---

## 2. Complete lesson map

Ordered term → unit → lesson. `PDF` = 1‑based PDF page index. `Printed` = folio as printed in the book.
Lesson end boundaries are confirmed by the per‑lesson QR block that terminates almost every lesson (see §4.9).

### الفصل الدراسي الأول — Term 1 (10 lessons, 3 units)

Front matter: PDF 1 cover spread · 2 title/authors · 3 **blank** · 4 المقدمة · 5 **blank** · 6 term divider · 7 **contents table** · 8 Unit‑1 opener (printed ٧).

| # | Unit | Lesson | لغويات وتراكيب (grammar) | Printed | PDF | Text type | Author / source |
|---|---|---|---|---|---|---|---|
| T1‑U1‑L1 | ١ هَيَّا نَتواصل | عِبادُ الرَّحمنِ | المنادى المضاف – المنادى الشبيه بالمضاف – النكرة غير المقصودة | ٨–١٣ | 9–14 | **قرآن كريم** | سورة الفرقان ٦٣–٧٠ |
| T1‑U1‑L2 | ١ هَيَّا نَتواصل | كُنْ جَمِيلًا | المنادى (المفرد – النكرة المقصودة) | ١٤–١٨ | 15–19 | **نص شعري** | إيليا أبو ماضي (ديوان تِبْرٌ وتُرابٌ) |
| T1‑U1‑L3 | ١ هَيَّا نَتواصل | قِصَّةُ أَثَرٍ | المنادى (نداء ما فيه ال) | ١٩–٢٣ | 20–24 | **نثر** (informational, 2 passages) | أ‑الكنيسة المعلقة، ب‑قلعة قايتباي |
| T1‑U2‑L1 | ٢ رَحْمَةٌ ومَحَبَّةٌ | رَحْمَةٌ ومَحَبَّةٌ | البدل وأنواعه | ٢٥–٢٨ | 26–29 | **نثر** | قاسم أمين، من كتاب «تحرير المرأة» |
| T1‑U2‑L2 | ٢ رَحْمَةٌ ومَحَبَّةٌ | سميرة موسى | (تابع) أنواع البدل | ٢٩–٣١ | 30–32 | **نثر** (سيرة) | — |
| T1‑U2‑L3 | ٢ رَحْمَةٌ ومَحَبَّةٌ | آياتُ العِلمِ | (تابع) أنواع البدل — printed banner: «(تابع) بدل البعض من كل وبدل الاشتمال» | ٣٢–٣٥ | 33–36 | **نص شعري** | الهراوي |
| T1‑U2‑L4 | ٢ رَحْمَةٌ ومَحَبَّةٌ | طريقُ النورِ | أسلوبا المدح والذم | ٣٦–٤٠ | 37–41 | **نثر** (سيرة: لويس برايل) | — |
| T1‑U3‑L1 | ٣ طريقُ العِلمِ | فَضْلُ العِلمِ | فاعل نعم وبئس | ٤٢–٤٧ | 43–48 | **حديث شريف** | عن أبي الدرداء — أخرجه أحمد وأصحاب السنن |
| T1‑U3‑L2 | ٣ طريقُ العِلمِ | زِراعةُ الفَضاءِ | حبذا، لا حبذا | ٤٨–٥١ | 49–52 | **نثر** (مقال علمي) | — |
| T1‑U3‑L3 | ٣ طريقُ العِلمِ | الكِتابُ | الممنوع من الصرف | ٥٢–٦١ | 53–62 | **نص شعري** | أحمد شوقي (أمير الشعراء) |

Unit openers: U1 → PDF 8 (printed ٧) · U2 → PDF 25 (printed ٢٤) · U3 → PDF 42 (printed ٤١, unfoliated).

### الفصل الدراسي الثاني — Term 2 (10 lessons, 3 units)

Seam/front matter: PDF 63 **blank** · 64 term divider · 65 **contents table** · 66 Unit‑1 opener. **None of these four carry a printed folio.**

| # | Unit | Lesson | لغويات وتراكيب (grammar) | Printed | PDF | Text type | Author / source |
|---|---|---|---|---|---|---|---|
| T2‑U1‑L1 | ١ لحظات غيرت التاريخ | سفينةُ نوحٍ عليه السلام | اسم الفاعل من الفعل الثلاثي الصحيح | ٦–٩ | 67–70 | **قرآن كريم** | سورة هود ٣٦–٤٢ |
| T2‑U1‑L2 | ١ لحظات غيرت التاريخ | الحياةُ دقائقُ وثوانٍ | اسم الفاعل من الثلاثي مُعتَل العين واللام | ١٠–١٤ | 71–75 | **نثر** (contains an embedded 2‑line poem) | مقال؛ يقتبس بيتين لأحمد شوقي |
| T2‑U1‑L3 | ١ لحظات غيرت التاريخ | خِلالٌ كريمةٌ | اسم الفاعل من الفعل غير الثلاثي | ١٥–١٨ | 76–79 | **نص شعري** | حافظ إبراهيم |
| T2‑U2‑L1 | ٢ نحو حياة أفضل | رسالةٌ إلى ابني | صيغ المبالغة | ٢٠–٢٤ | 81–85 | **نثر** (رسالة) | د. فاخر عاقل |
| T2‑U2‑L2 | ٢ نحو حياة أفضل | وادي الكنانة | اسم المفعول | ٢٥–٣٠ | 86–91 | **نص شعري** | الهراوي |
| T2‑U2‑L3 | ٢ نحو حياة أفضل | فالقُ الحَبِّ والنَّوى | اسما الزمان والمكان | ٣١–٣٧ | 92–98 | **نثر** | زكي نجيب محمود |
| T2‑U3‑L1 | ٣ كُنْ جَمِيلًا | استعِنْ باللهِ | **مراجعة** اسمي الزمان والمكان | ٣٩–٤٣ | 100–104 | **حديث شريف** | عن ابن عباس، رواه الترمذي |
| T2‑U3‑L2 | ٣ كُنْ جَمِيلًا | الحمامةُ المطوَّقةُ | اسم الآلة | ٤٤–٤٨ | 105–109 | **قصة** | عبد الله بن المقفع (كليلة ودمنة)، بتصرف |
| T2‑U3‑L3 | ٣ كُنْ جَمِيلًا | حُبُّ الوطنِ | أسلوب التفضيل | ٤٩–٥٣ | 110–114 | **نص شعري** | مصطفى صادق الرافعي |
| T2‑U3‑L4 | ٣ كُنْ جَمِيلًا | المشروعاتُ الصغيرةُ | صوغ اسم التفضيل | ٥٤–٥٨ | 115–119 | **نثر** (مقال) | — |

Unit openers: U1 → PDF 66 (unfoliated) · U2 → PDF 80 (printed ١٩) · U3 → PDF 99 (printed ٣٨, unfoliated).
Back matter: PDF 120 deposit number · 121 المواصفات الفنية + copyright · 122 back‑cover spread.

### Text‑type census

| Type | Count | Lessons |
|---|---|---|
| نثر (prose/article/biography/letter) | 9 | قصة أثر · رحمة ومحبة · سميرة موسى · طريق النور · زراعة الفضاء · الحياة دقائق وثوان · رسالة إلى ابني · فالق الحب والنوى · المشروعات الصغيرة |
| نص شعري | 6 | كن جميلا · آيات العلم · الكتاب · خلال كريمة · وادي الكنانة · حب الوطن |
| قرآن كريم | 2 | عباد الرحمن · سفينة نوح عليه السلام |
| حديث شريف | 2 | فضل العلم · استعن بالله |
| قصة | 1 | الحمامة المطوقة |
| **Total** | **20** | |

---

## 3. Non‑lesson sections — what is *absent* matters

**There is no standalone anything.** I checked every page; the book contains **zero** of the following:

- ❌ No set novel / رواية / قصة طويلة (contrast: many Egyptian Arabic editions ship one).
- ❌ No نصوص للحفظ section.
- ❌ No مراجعات / مراجعة عامة / اختبارات.
- ❌ No standalone أنشطة or تدريبات bank.
- ❌ No standalone الخط or الإملاء unit.
- ❌ No answer key, no glossary appendix, no index.

`الإملاء`, `الخط` (نماذج بخطي النسخ والرقعة) and `التعبير` are **inside every lesson**, under the `٥ الكتابة` block. They are lesson sub‑sections, not sections.

Recurring in‑lesson boxes (these are the real content units to extract):

| Box | Role | Notes |
|---|---|---|
| ناقش | pre‑reading prompts | opens every lesson, top‑right |
| أهداف الدرس | side panel, per‑lesson objectives | **the coverage‑oracle source** |
| القضايا المتضمنة | side panel, cross‑cutting national issues | حقوق الإنسان، التسامح، الوحدة الوطنية… |
| ١ استمع ثم تحدث / استمع وتذوق | the primary text itself | «وتذوق» variant marks poetry |
| معاني المفردات ⟷ **أضف إلى قاموسك** | glossary table | **name changes between terms** — Term 1 uses معاني المفردات, Term 2 mostly أضف إلى قاموسك |
| شرح الأبيات / شرح النص / شرح الحديث الشريف | canonical exposition | three different headers, same slot |
| مواطن الجمال في الأبيات / في النص / في الحديث | rhetorical‑device analysis | three headers, same slot |
| ٢ اسأل وناقش / فكر وناقش | comprehension Qs | |
| ٣ اقرأ … قراءة صامتة | comprehension Qs | |
| ٤ لغويات وتراكيب / التراكيب اللغوية | the grammar block | banner text varies (§4.5) |
| ٥ الكتابة → أ‑الإملاء، ب/جـ‑التعبير | writing | |
| قرأت لك / قرأت في كتاب | third‑party quotation box | **not lesson text** — do not attribute to the lesson author |
| اقرأ واستمتع | appendix reading, usually a *different* author | e.g. نجيب محفوظ bio, نوتردام, يوسف إدريس bio, السمك الطيار, وثيقة حقوق الطفل |
| انظر وتأمل | image caption tag | |

---

## 4. Structural surprises that will break a naive extractor

Ranked by how much damage they do.

**4.1 — Two page‑number series (SEVERITY: critical).** See §1. `printed = PDF − 1` for Term 1, `printed = PDF − 61` for Term 2, four unfoliated pages between. Every span‑grounded citation depends on getting this right. The manifest must carry a *per‑term* offset, never a book‑wide constant.

**4.2 — A unit opener under‑lists its own lessons (SEVERITY: critical — this is the "Africa‑only" failure class).**
Term‑2 Unit‑3 (كن جميلًا) opener at **PDF 99** shows `دروس الوحدة` with **three** thumbnails: استعن بالله، الحمامة المطوقة، المشروعات الصغيرة. The unit actually has **four** lessons — **حُبُّ الوطنِ (printed ٤٩–٥٣ / PDF 110–114) is omitted from the opener.** The Term‑2 contents table (PDF 65) lists all four.
⇒ Any pipeline that derives the lesson list from the unit‑opener page (the way the social‑studies conveyor derives objectives from the ministry objective panel) will **silently drop حب الوطن**. The coverage oracle must cross‑check *unit opener × contents table × QR block sequence* and fail closed on disagreement. All five other unit openers agree with the contents table.

**4.3 — Duplicate titles across terms (SEVERITY: high).** `كُنْ جَمِيلًا` is **both** Term‑1 Unit‑1 **Lesson 2** *and* Term‑2 **Unit 3** (a unit title). Unit numbers also restart per term (الوحدة الأولى/الثانية/الثالثة appear twice). Any slug or ID keyed on title, or on `unit N + lesson M` without a term component, collides. IDs must be term‑qualified, e.g. `lo:ar-t1u1l2-*` vs `lo:ar-t2u3-*`.

**4.4 — Grammar topics span multiple lessons (SEVERITY: high).** The one‑lesson‑one‑topic assumption is false here:

| Chain | Lessons | Printed banner |
|---|---|---|
| البدل | T1 U2 L1 → L2 → L3 | «البدل وأنواعه» → «(تابع) أنواع البدل» → «(تابع) بدل البعض من كل وبدل الاشتمال» |
| المنادى | T1 U1 L1 → L2 → L3 | «المنادى» → «تابع المنادى» → «تابع المنادى» |
| اسم الفاعل | T2 U1 L1 → L2 → L3 | «اسم الفاعل» → «تابع اسم الفاعل» → «تابع اسم الفاعل» |
| اسم التفضيل | T2 U3 L3 → L4 | «أسلوب التفضيل» → «صوغ أسلوب التفضيل» |

Plus **T2 U3 L1 (استعن بالله) carries no new grammar at all** — its block is «مراجعة اسمي الزمان والمكان», a pure review of the *previous unit's* topic. Modelled naively it becomes a phantom LO. Model these as one LO with multiple lesson spans, or as `PREREQUISITE_OF`‑chained sub‑LOs — not as N independent topics named «تابع …».

**4.5 — Grammar‑block banner text is unstable (SEVERITY: medium).** Three different banners occupy the same slot: `التراكيب اللغوية`, `لغويات وتراكيب`, and `تابع <topic>`. The banner is a two‑cell strip; the **left cell** is the literal `لغويات وتراكيب` label and the **right cell** carries the topic. Header‑string matching on the left cell alone finds the block; matching on the right cell yields «تابع المنادى» as a distinct topic. Both cells must be read, and `تابع` must be stripped and treated as a continuation flag.

**4.6 — In‑lesson section numbers are not stable (SEVERITY: medium).** The nominal skeleton is `١ استمع` → `٢ اسأل وناقش` → `٣ اقرأ صامتة` → `٤ لغويات وتراكيب` → `٥ الكتابة`. Actual deviations found:

| Lesson | Deviation |
|---|---|
| طريق النور (T1 U2 L4) | grammar block numbered **٦**, التعبير **٧**; extra ٤ ناقش… and ٥ اقرأ وتناقش (نص دستوري: المادة ٨١ من دستور ٢٠١٤) |
| استعن بالله (T2 U3 L1) | الكتابة is **٤**, grammar block is **٦** — and there is no ٥ |
| رسالة إلى ابني (T2 U2 L1) | ٥ تحدث، ٦ ما رأيك فيمن، ٧ ابحث في مركز مصادر التعلم |
| الحياة دقائق وثوان (T2 U1 L2) | ٧ كوّن أنت وزملاؤك جماعة (المخترعات الصغيرة) |
| فضل العلم (T1 U3 L1) | grammar block is unlabelled by number in the banner row |

⇒ Segment on **box geometry + header text**, never on the circled digit.

**4.7 — Printed objective lists have numbering gaps (SEVERITY: medium, hits the coverage oracle).** Term‑1 Unit‑1 `أهداف الوحدة` (PDF 8) runs ١، ٢، ٣، ٤، **٦**، ٧، ٨، ٩، ١٠، ١١، ١٢ — **number ٥ is missing in the printed book.** A coverage oracle that asserts "objectives produced == max printed number" will report a false gap forever. Count *rendered items*, not the maximum ordinal.

**4.8 — Poetry is laid out in صدر/عجز two columns (SEVERITY: high for OCR).** Every نص شعري lesson prints each بيت as two horizontally separated hemistichs with **no separator punctuation**. Left‑to‑right or column‑naive text extraction interleaves them into nonsense. Affected: كن جميلا، آيات العلم، الكتاب، خلال كريمة، وادي الكنانة، حب الوطن; plus the embedded شوقي couplet inside the *prose* lesson الحياة دقائق وثوان (printed ١٠); plus poems inside `اقرأ واستمتع` boxes (لغتنا الجميلة on printed T1‑٤٠; في حب الوطن / فاروق شوشة on T2‑٤٨). Poems are also broken into stanzas by a `❋ ❋ ❋` glyph row. Extraction must reconstruct **one بيت = صدر + عجز**, preserve the stanza break, and never emit a half‑line as a standalone quote.
Related: `كلمات للوطن` (كمال ناصر, printed T2‑٣٠) is free verse typeset as **prose with `/` separators** — a third layout.

**4.9 — QR codes end nearly every lesson (SEVERITY: medium — and a product signal).** Each lesson closes with a magenta banner «لمزيد من التدريبات يرجى الدخول على الموقع الإلكتروني للوزارة» + a QR code captioned with the lesson number and name (e.g. «١‑عباد الرحمن», «٤‑المشروعات الصغيرة»). 
- **Useful:** this is the single most reliable lesson‑boundary delimiter in the book. Every lesson end I verified in §2 was confirmed by it.
- **Risky:** it is an *external* dependency. The QR targets are not in the PDF and were not resolved.
- **Product‑critical:** the book itself contains almost **no printed exercise bank** — the drill load lives behind these links. Same finding as the Social Studies book. The Arabic question bank will have to be **authored**, not harvested. Plan capacity accordingly.

**4.10 — Grammar content is heavily tabular and diagrammatic (SEVERITY: medium).** Grammar blocks render as: 3–5 column RTL tables (`البدل / المبدل منه`, `اسم الفاعل / وزنه / فعله / نوعه`, `اسم الآلة / وزنه / فعله`), and **box‑and‑arrow tree diagrams** rasterised as artwork — `أنواع البدل ثلاثة`, `أنواع المنادى المعرب`, `العلم يمنع من الصرف في الحالات الآتية`, `أجزاء أسلوب التفضيل`, `تزاد الألف بعد واو الجماعة`. These are **figures, not text**; OCR will emit their labels as orphan word salad. They should become visual primitives, not paragraphs.

**4.11 — Contents‑table column order is RTL (SEVERITY: high, very easy to get wrong).** Both tables read, right → left: `الوحدة | الدرس | لغويات وتراكيب | رقم الصفحة`. A left‑to‑right table parse pairs the **page number with the unit** and the **lesson with the grammar topic** — producing a plausible‑looking but entirely wrong map. The two tables also use **different templates** (Term 1 is colour‑banded per unit; Term 2 is a plainer pastel grid), so a template‑matched parser tuned on p.7 will not transfer to p.65.

**4.12 — Contents tables under‑specify (SEVERITY: medium).** They give **start pages only** — no end pages, no unit ranges, and unit openers are not listed at all. Lesson extents in §2 were derived by walking pages, not from the tables. Also: **text type is not in the contents table.** It appears only as a parenthetical on the unit‑opener thumbnail captions («(قرآن كريم)», «(نص شعري)») and prose lessons carry **no tag at all** — so `text_type` must be resolved from the unit opener plus the lesson body, and "untagged ⇒ نثر" is the only safe default.

**4.13 — Lesson lengths are wildly uneven (SEVERITY: medium).** Range is 3 printed pages (سميرة موسى, ٢٩–٣١) to **10** (الكتاب, ٥٢–٦١ — because الممنوع من الصرف alone runs printed ٥٥–٦١). Fixed‑window page chunking will cut الكتاب mid‑topic. Segment on lesson headers + QR terminators.

**4.14 — Blank and unfoliated pages inside the sequence (SEVERITY: medium).** Fully blank: PDF **3**, **5**, **63**. Unfoliated but non‑blank: PDF 1, 2, 4, 6, 7, 8, 42, 64, 65, 66, 80(printed ١٩ — actually foliated), 99, 120, 121, 122. Any "page N of the PDF is page N−k of the book" loop that does not special‑case these will drift.

**4.15 — Cover pages are double‑spreads (SEVERITY: low).** PDF 1 and 122 are 2421×1653 landscape images each holding two physical pages. This is why the colophon says ١٢٤ pages while the PDF has 122. Do not treat them as body pages.

**4.16 — Title mismatch: «قصة أثر» is not a story (SEVERITY: low, but a content‑integrity trap).** T1 U1 L3 is titled «قِصَّةُ أَثَرٍ» yet contains two *informational* passages (الكنيسة المعلقة، قلعة قايتباي). Classifying by title keyword `قصة` mislabels it; the one genuine قصة in the book is الحمامة المطوقة. Conversely, the *prose* lesson الحياة دقائق وثوان opens with poetry.

**4.17 — Full tashkeel throughout (SEVERITY: high for OCR quality).** Body text is fully vocalised (harakat, shadda, tanwin). For an *Arabic grammar* subject the harakat are **load‑bearing** — إعراب answers hinge on a single ضمة vs فتحة. OCR/vision confusion between e.g. `يا طالبَ العلمِ` and `يا طالبُ العلمِ` inverts a correct answer into a wrong one. Any extracted إعراب claim needs independent re‑derivation before it can go live, and the human review gate cannot be skipped on grammar items.

**4.18 — Religious source text (SEVERITY: policy).** Two Qur'an lessons (Furqan 63–70; Hud 36–42) and two hadith lessons carry text that **must be reproduced letter‑exact, with tashkeel, and never paraphrased or generated**. These should be flagged `verbatim_only` in the content model and excluded from any LLM variant‑generation path. Same class of rule as the sensitive‑content stance in ADR‑0004 §5.

---

## 5. Extraction planning notes (for the manifest / conveyor)

1. **Stage‑0 manifest must be per‑term.** Two offset records: `{term: 1, pdf_range: [9,62], offset: -1}` and `{term: 2, pdf_range: [67,119], offset: -61}`; plus an explicit `unfoliated: [1..8, 63..66, 120..122]` list. Do **not** ship a single global offset.
2. **Coverage oracle inputs:** contents table (PDF 7 / 65) × unit‑opener `دروس الوحدة` thumbnails × QR terminator captions. Fail closed on any disagreement — §4.2 proves the openers are not trustworthy alone. Expected totals: **6 units, 20 lessons**, 10 per term.
3. **Per‑lesson objectives** come from the `أهداف الدرس` side panel (present on all 20 lessons); **per‑unit objectives** from `أهداف الوحدة` on the opener. Count rendered items, not ordinals (§4.7).
4. **Grammar is the spine of this subject.** ~17 distinct grammar topics across 20 lessons, chained (§4.4). The curriculum graph for Arabic will be much more `PREREQUISITE_OF`‑dense than the Social Studies graph: المنادى → البدل → المدح والذم → الممنوع من الصرف → المشتقات (اسم الفاعل → اسم المفعول → اسما الزمان والمكان → اسم الآلة → اسم التفضيل). The Term‑2 مشتقات chain is a clean linear DAG and a good first extraction slice.
5. **Question bank must be authored** (§4.9) — the book ships no drill bank. Budget this as content work, not extraction work.
6. **Verbatim‑lock** the 4 scripture lessons (§4.18) before any variant engine touches this subject.

---

*Scope note: this document maps structure only. No content was extracted, no questions authored, and no file other than this one was modified.*

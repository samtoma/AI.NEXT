# Grade 10 maths: S0a source scouting and S0 manifest report

| | |
|---|---|
| **Book** | Siyavula, *Everything Maths, Grade 10 Mathematics*, Version 1.1 CAPS |
| **Stages** | S0a (source adapter, scouted by hand) and S0 (manifest), per `docs/specs/extraction-pipeline.md` §3.3 |
| **Date** | 2026-09-25 |
| **Status** | Draft for **gate G0** (Samuel). Nothing is decided by this report. |
| **Manifest** | `services/extraction/manifest/g10-math-american.json` |
| **How it was made** | Deterministic Python (stdlib + the PyMuPDF already installed in the user site-packages). No LLM, no ingest run, no generated content. Scripts in `services/extraction/scratch_g10/`; see §7. |
| **Objectives** | Not derived. That is S1, after G0. |

## 0. What G0 needs to know

1. **Edition verdict: same content, different packaging.** The EPUB and the PDF carry the same v1.1 text.
   The EPUB adds a worked solution to every exercise item. It drops the answer appendix, the past papers,
   the item shortcodes and the page numbers. Chapter 2 is numbered differently (§1).
2. **The EPUB has no machine-readable maths.** There is no MathML, no LaTeX and no alt text. It holds
   16,388 equation images (8,561 unique PNGs). The spec's premise that "the EPUB gives clean text and
   clean mathematics" (§3.3) does not hold for this file.
   - Each image's file name is the MD5 of its LaTeX source (583 reproduced exactly). That gives an exact
     check on any transcription.
   - A recommended text-source route is in §2.5.
3. **Every one of the 2,531 exercise items has a worked solution in the EPUB.** The printed learner book
   has final answers only. This changes S3 and decision D3 (§6).
4. **Manifest:** 14 chapters and **59 lessons** under the default (one numbered section = one lesson).
   - Split, merge and promotion proposals would give 65 lessons. None is applied.
   - The offset is `printed = PDF − 11` on all 497 pages that print a folio, with no exceptions.
5. **Answer formats:** only 267 items (11%) can be graded by today's grader as printed. Another 632 (25%)
   become gradable after normalisation. 1,374 (54%) cannot be graded today: algebraic answers,
   multi-value answers, coordinates, intervals, surds, proofs and sketches (§4).
6. **Cost and design:**
   - Maths transcription becomes a real sub-stage, about $20–25 once per book.
   - S3's derivation step can mostly go.
   - The figure volume is about twice the spec's assumption.
   - The spec's edition-check tests and several scout facts need correcting (§6).

## 1. Edition check: EPUB vs PDF

| Check | PDF | EPUB | Result |
|---|---|---|---|
| Chapter titles | 14 | 14 (nav only) | 12/14 equal. Chapter 2 is "Exponents" in the PDF, "Exponentials" in the EPUB; chapter 13 is "Measurements" vs "Measurement" |
| Numbered sections, in order | 81 | 81 | 81/81 titles equal. Numbering differs in chapter 2 only (see below) |
| Section codes (`EMA…`) | 172 | 172 (`id="scEMA…"`) | set-equal |
| Video / presentation shortcodes | 78 | 78 (`id="sc2DBJ"` …) | set-equal |
| Worked examples | 174 | 174 | equal per chapter, numbers 1..n in both. 2 titles differ only by a dropped maths symbol (`… by k`) |
| Exercise sets | 87 (`Exercise 1 – 1`) | 87 (`Exercise 1.1`) | label sets equal |
| Questions per exercise | 1,056 (shortcode lists) | 1,058 | 86/87 equal. 13-3 is nested differently (PDF 1a–c + 2–4, EPUB 6 flat): same 6 items |
| Exercise items (finest sub-part) | 1,984 shortcodes (per question or per sub-part) | 2,531 `div.entry` | the EPUB is finer-grained. Per-question item counts equal the PDF answer appendix in 48/87 sets; the rest are answers not printed plus parse limits (§4) |
| Figure placements (book, excluding EPUB-only solution figures) | 761 | 764 | equal in 13/14 chapters. Chapter 14: 44 vs 47 (one image is repeated in the EPUB §14.5) |
| 10 random body paragraphs (seed 20260925) | | | 9 at 1.000 word similarity, 1 at 0.927 |
| 10 random exercise stems (word order) | | | 9 at 1.000, 1 at 0.947 |
| 10 random worked-example questions | | | 10 at 1.000 |
| Printed numeric answers found in the EPUB solution of the same question (`md5("\text{12,566}")`) | 427 testable | 69 found | no contradiction. Most answers sit inside larger equation images and cannot be tested without transcription |
| Printed verbal answers ("irrational", "rhombus") found word-for-word in the EPUB solution | 177 testable | 157 found | 20 misses: PDF hyphenation ("pow- ers") or the answer sits inside a maths image (checked by eye: `tan 90° … undefined`) |

**Edition and version markers** (recorded, not interpreted):

| | PDF | EPUB |
|---|---|---|
| Version string | cover "VERSION 1.1 CAPS". The half-title (PDF p.2) reads "GRADE 10 MATHEMATICS **TEACHER'S GUIDE** VERSION 1.1 CAPS" | none anywhere. The cover image reads "Mathematics Grade 10 Learner's book" |
| Build | Acrobat 10.1.10, created 2015-06-11. Bookmarks name the parts "web - Revised Gr10 TG full front matter" and "maths-gr10-lb-web" | `dc:identifier www.siyavula.com.epubmaker.maths10`, modified 2015-09-15. Equation PNGs rendered 2015-09-07; the XHTML zip entries are dated 2015-10-15 |
| Licence statement | PDF p.3: CC BY-ND 4.0 | copyright page: CC-BY 4.0, under the heading "Physical Sciences 10 / Physical Sciences – Grade 10 CAPS" (a template slip) |
| Hashes | sha256 `c85561ec…4453c`, 7,089,873 B, 535 pp. | sha256 `881f0968…a4e99`, 49,009,925 B, 10,247 entries |

**What differs in content:**
- **The EPUB adds:**
  - a worked solution (`div.solution`) for all 2,531 exercise items;
  - 32 visible `div.teachers-guide` notes addressed to teachers, for example "According to CAPS, the
    rational exponent law is introduced in Grade 11 …".
- **The EPUB lacks:**
  - the Solutions appendix (printed pp.497–514);
  - the Past exam papers (pp.515–521);
  - the List of Definitions;
  - all 1,984 per-item shortcodes;
  - any page mapping.
- **Chapter 2 numbering:**
  - The EPUB heading says "2.5 Exponential equations"; its own nav says 2.4.
  - The EPUB chapter summary has no number and no section-code id.
  - The PDF prints "2.4 Exponential equations" and "2.5 Summary", and both carry code `EMAW`.

**Verdict:** same edition (v1.1 CAPS) and same content, different packaging. The EPUB is a later
(September 2015) build of the same source. It includes the teacher's-guide layer: solutions and notes. Nothing
found contradicts the PDF text or its printed answers. Per spec §3.3 step 6, the adapter should
**not** fall back to PDF-only. That rule, however, assumed the EPUB would supply the maths, and it does not
(§2.2, §6).

## 2. EPUB structure

### 2.1 Package, spine and nav
- EPUB 3 (OPF 3.0). The spine has 99 items:
  - `nav`;
  - the copyright page;
  - 96 content files `NN-<chapter-slug>-MM.cnxmlplus.html`;
  - an image-attribution page.
- **One file per numbered section.** Plus, per chapter, one file after the "Chapter summary" file that
  holds only the end-of-chapter exercise (for example `01-algebraic-expressions-09`).
  - §14.5's exercise is also in its own heading-less file, `14-probability-05`.
- Section markup: `div.section#scEMA4` > `h2.title#toc-id-3` "1.3 Rational and irrational numbers".
  Sub-headings are `h3`/`h4` inside nested `div.section#scEMA5`; 116 in all. Some `h4` sub-headings
  (Domain and range, Period …) have no code.
- **Nav** (`maths10.nav.xhtml`): 14 unlinked chapter entries and 173 linked entries (sections,
  sub-headings, summaries). Every title with inline maths loses the maths: "Functions of the form",
  "Gradient and -intercept method".
- **`toc.ncx` is unusable.** It is a broken legacy tree: 37 navPoints under one "Introduction" root, and
  `dtb:totalPageCount = 0`.
- **No page-list, no pagebreak markers.** EPUB anchors map to PDF pages only by alignment on shared
  anchors:
  - 172 section codes;
  - 78 media codes;
  - worked-example numbers;
  - exercise labels with question numbers.

  Worked examples and exercises have **no ids** in the EPUB, so the manifest uses ordinal locators
  (`file::div.worked_example[k]`).

### 2.2 How maths is encoded (the key finding)

| | Count |
|---|---|
| `<img class="math-inline">` | 13,348 |
| `<img class="math-block">` | 3,040 |
| Unique equation PNGs (`equation/<md5>.png`, 46 MB) | 8,561 (median 128×25 px, 150 dpi, grey + alpha) |
| MathML `<math>` elements | **0** |
| LaTeX in text (`\(`, `$…$`) | **0** |
| `alt` text on equation images | **0**. The 994 `alt` attributes are on figures and repeat the file name |
| PNG metadata | creation dates only, no source |

- MathJax is bundled (581 JS files, 20 fonts), but nothing on the page is typeset by it.
- **The file name is `md5(LaTeX source)`.** For example `md5("a")`, `md5("\mathbb{Q}")`, `md5("\text{0,4}")`.
  Numbers are wrapped as `\text{…}`. It is confirmed by 583 exact reproductions and no counter-example.
- 583 unique images (6.8%) can be recovered deterministically by hashing candidate strings: single
  symbols, and every number in the PDF text layer as `\text{n}`. They account for 4,999 of the 16,388
  references (30.5%).
- The other 7,978 unique images need transcription.
  - Many "single" images are aligned multi-line derivations: 714 exercise solutions are one image over
    100 px tall.
- Where the maths sits:
  - 3,622 references in exercise stems, 7,107 in exercise solutions, 2,893 in worked examples,
    2,766 elsewhere;
  - **1,309 of the 2,531 exercise items have a stem that is only maths or a figure.** The words live in the
    question header;
  - 198 items have no words at all.

### 2.3 Figures
- 995 figure references (975 unique files): `tikzpicture/<md5>.png` (960; median 418×288 px) and `images/`
  (15 photos).
- By context: 373 in exercise problems, 98 in exercise headers, 181 in the body, 103 in worked examples,
  8 in activities, 1 in a note, and 231 in EPUB-only exercise solutions.
- In the PDF every figure is a **Form XObject** (externalised TikZ): 761 book placements, plus 15 raster
  photos in the body.
  - Crops can be taken from each form's placement, with no region detection.
  - Alternatively, the EPUB PNG can be used as the figure source; it is already cropped.

### 2.4 Worked examples, exercises and answers in markup
- **Worked example:** `div.worked_example` >
  - `h1.title` "Worked example N: title";
  - `div.question`;
  - then `div.workstep` > `h2.title` (step title) + content: 571 steps in 164 examples.
  - 10 examples have no worksteps: the solution is loose content after `div.question`.
  - There is no "solution" wrapper. The PDF prints QUESTION and SOLUTION headings.
- **Exercise:** outer `div.problemset` holds:
  - `span.exerciseTitle` "Exercise C.N";
  - an optional `div.header`;
  - either nested `div.problemset` (one numbered question, with a `div.header` and `div.entry` sub-parts)
    or bare `div.entry` (a question with no sub-parts).

  Each `div.entry` = `div.problem` + `div.solution`.
  - Exception: Exercise 5.1's questions 2–7 sit in untitled sibling problemsets and bare entries after
    the titled block. The scan folds them in.
- **Solutions in the EPUB:**
  - worked, with 8+ words: 1,031;
  - short text + maths: 296;
  - one maths image or a bare number: 1,146. Of these, 912 are multi-line derivations in one image, 223
    are single-line answers and 11 are plain numbers;
  - two or more maths images: 36;
  - figure only: 22.
- **Printed answers (PDF only):** the appendix "Solutions to exercises", PDF 508–525 / printed 497–514.
  - It gives final answers per exercise, in 2–4 columns.
  - The scan parses 2,281 answer leaves.
  - Answers are printed for 2,270 of the 2,531 items. The 261 without are mostly proofs, sketches,
    "represent", "show that" and "complete the table" (confirmed by eye on 5-1, 2-4, 3-1).

### 2.5 Recommendation for the text source (Samuel decides)

| Option | What | For | Against |
|---|---|---|---|
| **A (recommended)** | EPUB for structure, prose, item boundaries and worked solutions. Maths: **transcribe each unique equation PNG once** by vision at K=2, and accept a transcription when `md5(latex) == filename` or both passes agree after normalisation. Cross-check digits and letters against the PDF text layer, where maths spans are identifiable by their Computer Modern fonts (CMMI/CMSY/CMR/CMEX/MSBM). PDF for printed pages, printed answers and shortcodes | clean, isolated images; dedup (8,561, not 16,388); an exact oracle for a share of them; cheapest (about $20–25 per book, §6) | a vision stage the spec did not plan; exact-hash hits on long derivations will be rare, so those rest on K=2 agreement |
| B | PDF-only: vision on page regions (spec's fallback) | one source | layout-ambiguous, no oracle; about $30–90 per book; loses the EPUB's worked solutions |
| C | Rebuild maths from the PDF text layer by glyph geometry (baselines, fraction bars) | no model cost | a large, brittle build (fractions, radicals, aligned systems); no oracle |

## 3. The Stage-0 manifest

### 3.1 Page map
- **`printed = PDF − 11`.** One regime (PDF 13–532 → printed 2–521), checked on **every** page:
  - 497 pages print a folio;
  - 497 agree;
  - 0 exceptions.
- **No folio on 38 pages:**
  - front matter PDF 1–12;
  - blank pages 15, 53, 83, 117, 245, 339, 365, 413, 479;
  - 14 chapter openers;
  - back matter 533–535.

  They are consistent with the rule through the TOC.
- **Anchors:** PDF 17 = p.6 (1.1 Introduction), 247 = 236 (7.1), 304 = 293 (8.3), 511 = 500 (Solutions),
  526 = 515 (Past exam papers).
- The PDF bookmarks for "Solutions to exercises" and "Past exam papers" point **one page early**. Chapter
  and section bookmarks are right. The adapter should read running heads, not bookmarks.

### 3.2 Lesson unit, introductions, summaries, end-of-chapter exercises
- **Default applied:** each of the 59 numbered teaching sections is one lesson, `g10m<ch>s<sec>-1`. The
  8 "Introduction" and 14 "Chapter summary" sections are not lessons.
- **Chapter summary:** bullets that serve as S1 `summary` evidence. The **end-of-chapter exercise** is
  printed inside the summary section and attaches to the **chapter (module)**. S1's exercise map assigns
  each of its items to one lesson.
  - These exercises hold **1,187 of the 2,531 items (47%)**, so S1's mapping is a large job, not an edge
    case.
- **Page convention:** a lesson runs from its heading page to the page before the next heading. When the
  next heading starts below the top of a page, that page is shared: it is counted in both lessons and
  flagged `starts_mid_page` / `ends_mid_page`.
  - Chapters 8, 10–14 have no Introduction; their opening paragraph belongs to the first lesson.
  - For §14.1 this is a two-page preamble (printed 470–472), flagged.
- Each lesson record carries:
  - its printed and PDF range;
  - its EPUB file, `#scEMA…` anchor and `toc-id`;
  - its sub-headings with codes;
  - its worked examples (number, title, printed page, EPUB locator);
  - its exercise sets (questions, items, the shortcode map, printed-answer pages in the appendix, items
    with and without a printed answer, answer types, EPUB inline-solution count);
  - figures by context, boxes, media shortcodes, maths-image counts and flags.

### 3.3 Chapters

| Ch | Title | Printed pp. | Lessons | Worked examples | Exercise sets (in lessons + intro + end-of-chapter) | Items (of which end-of-chapter) | Figures (book) |
|---|---|---|---|---|---|---|---|
| 1 | Algebraic expressions | 5–41 | 7 | 21 | 10 + 0 + 1 | 554 (211) | 8 |
| 2 | Exponents | 43–58 | 3 | 13 | 3 + 0 + 1 | 152 (79) | 2 |
| 3 | Number patterns | 59–71 | 1 | 3 | 1 + 0 + 1 | 90 (47) | 13 |
| 4 | Equations and inequalities | 73–105 | 6 | 19 | 6 + 0 + 1 | 270 (101) | 21 |
| 5 | Trigonometry | 107–144 | 7 | 12 | 7 + 0 + 1 | 240 (80) | 72 |
| 6 | Functions | 145–233 | 6 | 25 | 6 + 1 + 1 | 347 (164) | 147 |
| 7 | Euclidean geometry | 235–282 | 3 | 8 | 6 + 1 + 1 | 159 (84) | 157 |
| 8 | Analytical geometry | 283–327 | 4 | 13 | 5 + 0 + 1 | 191 (132) | 71 |
| 9 | Finance and growth | 329–353 | 4 | 12 | 6 + 0 + 1 | 135 (60) | 3 |
| 10 | Statistics | 355–388 | 5 | 14 | 6 + 0 + 1 | 102 (51) | 25 |
| 11 | Trigonometry | 389–401 | 1 | 5 | 1 + 0 + 1 | 33 (27) | 20 |
| 12 | Euclidean geometry | 403–414 | 1 | 1 | 1 + 0 + 1 | 40 (25) | 25 |
| 13 | Measurements | 415–467 | 4 | 20 | 6 + 0 + 1 | 100 (49) | 153 |
| 14 | Probability | 469–496 | 7 | 8 | 7 + 0 + 1 | 118 (77) | 47 |
| | **Total** | 5–496 | **59** | **174** | **87** | **2,531 (1,187)** | **764** |

The printed range runs from the chapter opener to the last page of the chapter summary.

### 3.4 Lessons (the default split)

"Items" counts in-section exercise items only; end-of-chapter items are not yet mapped (S1).

| Lesson id | § | Title | Printed pp. | Pages | WE | Exercise sets | Items | Figures | Flag |
|---|---|---|---|---|---|---|---|---|---|
| `g10m1s2-1` | 1.2 | The real number system | 6–7 | 2 | 0 | – | 0 | 1 | no practice |
| `g10m1s3-1` | 1.3 | Rational and irrational numbers | 7–12 | 6 | 3 | 1-1 | 59 | 2 |  |
| `g10m1s4-1` | 1.4 | Rounding off | 12–14 | 3 | 1 | 1-2 | 21 | 1 |  |
| `g10m1s5-1` | 1.5 | Estimating surds | 14–16 | 3 | 2 | 1-3 | 15 | 0 |  |
| `g10m1s6-1` | 1.6 | Products | 16–20 | 5 | 3 | 1-4 | 79 | 1 |  |
| `g10m1s7-1` | 1.7 | Factorisation | 20–30 | 11 | 8 | 1-5, 1-6, 1-7, 1-8, 1-9 | 105 | 1 | split? |
| `g10m1s8-1` | 1.8 | Simplification of fractions | 31–35 | 5 | 4 | 1-10 | 64 | 0 |  |
| `g10m2s2-1` | 2.2 | Revision of exponent laws | 45–50 | 6 | 5 | 2-1 | 39 | 0 |  |
| `g10m2s3-1` | 2.3 | Rational exponents | 50–51 | 2 | 2 | 2-2 | 9 | 0 |  |
| `g10m2s4-1` | 2.4 | Exponential equations | 52–56 | 5 | 6 | 2-3 | 25 | 0 | EPUB says 2.5 |
| `g10m3s2-1` | 3.2 | Describing sequences | 60–67 | 8 | 3 | 3-1 | 43 | 5 |  |
| `g10m4s2-1` | 4.2 | Solving linear equations | 74–78 | 5 | 3 | 4-1 | 35 | 0 |  |
| `g10m4s3-1` | 4.3 | Solving quadratic equations | 78–81 | 4 | 2 | 4-2 | 42 | 0 |  |
| `g10m4s4-1` | 4.4 | Solving simultaneous equations | 81–89 | 9 | 5 | 4-3 | 21 | 5 |  |
| `g10m4s5-1` | 4.5 | Word problems | 89–94 | 6 | 4 | 4-4 | 21 | 0 |  |
| `g10m4s6-1` | 4.6 | Literal equations | 94–96 | 3 | 2 | 4-5 | 21 | 0 |  |
| `g10m4s7-1` | 4.7 | Solving linear inequalities | 96–100 | 5 | 3 | 4-6 | 29 | 9 |  |
| `g10m5s2-1` | 5.2 | Similarity of triangles | 108–110 | 3 | 0 | – | 0 | 2 | no practice |
| `g10m5s3-1` | 5.3 | Defining the trigonometric ratios | 110–115 | 6 | 1 | 5-1 | 21 | 16 |  |
| `g10m5s4-1` | 5.4 | Reciprocal ratios | 115 | 1 | 0 | – | 0 | 0 | no practice |
| `g10m5s5-1` | 5.5 | Calculator skills | 116–118 | 3 | 2 | 5-2 | 31 | 0 |  |
| `g10m5s6-1` | 5.6 | Special angles | 118–120 | 3 | 0 | 5-3 | 26 | 4 |  |
| `g10m5s7-1` | 5.7 | Solving trigonometric equations | 120–130 | 11 | 7 | 5-4, 5-5, 5-6 | 52 | 23 |  |
| `g10m5s8-1` | 5.8 | Defining ratios in the Cartesian plane | 131–138 | 8 | 2 | 5-7 | 30 | 7 |  |
| `g10m6s2-1` | 6.2 | Linear functions | 150–157 | 8 | 3 | 6-2 | 34 | 17 |  |
| `g10m6s3-1` | 6.3 | Quadratic functions | 158–167 | 10 | 4 | 6-3 | 19 | 15 |  |
| `g10m6s4-1` | 6.4 | Hyperbolic functions | 167–177 | 11 | 4 | 6-4 | 23 | 12 |  |
| `g10m6s5-1` | 6.5 | Exponential functions | 177–187 | 11 | 4 | 6-5 | 20 | 16 |  |
| `g10m6s6-1` | 6.6 | Trigonometric functions | 187–207 | 21 | 6 | 6-6 | 41 | 38 | split? |
| `g10m6s7-1` | 6.7 | Interpretation of graphs | 208–214 | 7 | 4 | 6-7 | 10 | 6 |  |
| `g10m7s2-1` | 7.2 | Triangles | 242–251 | 10 | 1 | 7-2 | 16 | 37 |  |
| `g10m7s3-1` | 7.3 | Quadrilaterals | 252–262 | 11 | 5 | 7-3, 7-4, 7-5, 7-6 | 14 | 23 |  |
| `g10m7s4-1` | 7.4 | The mid-point theorem | 262–268 | 7 | 1 | 7-7 | 26 | 23 |  |
| `g10m8s1-1` | 8.1 | Drawing figures on the Cartesian plane | 284–287 | 4 | 0 | 8-1 | 6 | 8 |  |
| `g10m8s2-1` | 8.2 | Distance between two points | 288–293 | 6 | 2 | 8-2 | 10 | 8 |  |
| `g10m8s3-1` | 8.3 | Gradient of a line | 293–308 | 16 | 7 | 8-3, 8-4 | 36 | 23 | split? |
| `g10m8s4-1` | 8.4 | Mid-point of a line | 308–314 | 7 | 4 | 8-5 | 7 | 7 |  |
| `g10m9s2-1` | 9.2 | Simple interest | 330–335 | 6 | 4 | 9-1 | 14 | 0 |  |
| `g10m9s3-1` | 9.3 | Compound interest | 335–340 | 6 | 2 | 9-2 | 9 | 2 |  |
| `g10m9s4-1` | 9.4 | Calculations using simple and compound interest | 340–347 | 8 | 5 | 9-3, 9-4, 9-5 | 36 | 0 |  |
| `g10m9s5-1` | 9.5 | Foreign exchange rates | 347–349 | 3 | 1 | 9-6 | 16 | 0 |  |
| `g10m10s1-1` | 10.1 | Collecting data | 356–358 | 3 | 2 | 10-1 | 3 | 1 |  |
| `g10m10s2-1` | 10.2 | Measures of central tendency | 358–364 | 7 | 6 | 10-2 | 15 | 0 |  |
| `g10m10s3-1` | 10.3 | Grouping data | 365–371 | 7 | 1 | 10-3, 10-4 | 17 | 8 |  |
| `g10m10s4-1` | 10.4 | Measures of dispersion | 372–378 | 7 | 4 | 10-5 | 11 | 3 |  |
| `g10m10s5-1` | 10.5 | Five number summary | 378–380 | 3 | 1 | 10-6 | 5 | 4 |  |
| `g10m11s1-1` | 11.1 | Two-dimensional problems | 390–397 | 8 | 5 | 11-1 | 6 | 11 |  |
| `g10m12s1-1` | 12.1 | Proofs and conjectures | 404–408 | 5 | 1 | 12-1 | 15 | 11 |  |
| `g10m13s1-1` | 13.1 | Area of a polygon | 416–419 | 4 | 1 | 13-1 | 12 | 20 |  |
| `g10m13s2-1` | 13.2 | Right prisms and cylinders | 420–432 | 13 | 6 | 13-2, 13-3 | 14 | 41 | split? |
| `g10m13s3-1` | 13.3 | Right pyramids, right cones and spheres | 432–451 | 20 | 10 | 13-4, 13-5 | 18 | 44 | split? |
| `g10m13s4-1` | 13.4 | The effect of multiplying a dimension by a factor of k | 451–456 | 6 | 3 | 13-6 | 7 | 11 |  |
| `g10m14s1-1` | 14.1 | Theoretical probability | 470–474 | 5 | 1 | 14-1 | 14 | 8 | + chapter preamble 470–472 |
| `g10m14s2-1` | 14.2 | Relative frequency | 475–477 | 3 | 2 | 14-2 | 3 | 1 |  |
| `g10m14s3-1` | 14.3 | Venn diagrams | 478–481 | 4 | 2 | 14-3 | 12 | 6 |  |
| `g10m14s4-1` | 14.4 | Union and intersection | 481–482 | 2 | 0 | 14-4 | 2 | 11 |  |
| `g10m14s5-1` | 14.5 | Probability identities | 483–484 | 2 | 1 | 14-5 | 2 | 6 |  |
| `g10m14s6-1` | 14.6 | Mutually exclusive events | 485–486 | 2 | 1 | 14-6 | 4 | 5 |  |
| `g10m14s7-1` | 14.7 | Complementary events | 486–489 | 4 | 1 | 14-7 | 4 | 5 |  |

- Lessons average 6.4 pages (median 6). 1,289 items are in lessons, 55 in the two introductions and
  1,187 in end-of-chapter sets.
- Every lesson id matches `SLUG_RE`, and no module id starts with `module:geo` or `module:t2-`.

### 3.5 Proposals (in the manifest under `lesson_unit.proposals_not_applied`; none applied)

**Splits.** Spec rule: more than 12 printed pages, or more than 3 separately exercised methods. Parts
follow the EPUB's own order of sub-headings, worked examples and exercise sets.

| # | Lesson | Why | Parts |
|---|---|---|---|
| P1a | 1.7 Factorisation | 5 exercised methods, 105 items | -1 common factors, difference of squares, grouping (WE 10–12, Ex 1-5/6/7, 52 items) · -2 trinomials (WE 13, Ex 1-8, 26) · -3 sum and difference of cubes (WE 14–17, Ex 1-9, 27) |
| P1b | 6.6 Trigonometric functions | 21 pages | -1 sine (WE 16–17) · -2 cosine + comparison (WE 18–19) · -3 tangent (WE 20–21). The one set, 6-6 (41 items), closes the section, so S1 must distribute it |
| P1c | 8.3 Gradient of a line | 16 pages | -1 gradient between two points (WE 3–4, Ex 8-3) · -2 straight lines, parallel and perpendicular, horizontal and vertical, points on a line (WE 5–9, Ex 8-4) |
| P1d | 13.2 Right prisms and cylinders | 13 pages counting the shared page, 12 full: borderline | -1 surface area (WE 2–4, Ex 13-2) · -2 volume (WE 5–7, Ex 13-3) |
| P1e | 13.3 Right pyramids, cones and spheres | 20 pages | -1 surface area (WE 8–11, Ex 13-4) · -2 volume (WE 12–17, Ex 13-5) |

**Promotions.** Introductions that teach and carry practice:
- **P2a:** 6.1 (set, interval and function notation, domain and range; Ex 6-1, 36 items) becomes
  `g10m6s1-1`.
- **P2b:** 7.1 (angles, parallel lines; WE 1, Ex 7-1, 19 items) becomes `g10m7s1-1`.
- Under the default, these 55 items and 1 worked example belong to no lesson.

**Merges.**
- **Required** by spec §3.4 rule 1, which says an objective needs worked-example or exercise evidence:
  - P3a merges 1.2 into 1.3;
  - P3b merges 5.2 + 5.3 + 5.4.

  1.2, 5.2 and 5.4 have no worked example and no exercise item.
- **Optional:**
  - P3c merges 14.4 + 14.5 (2 + 2 items);
  - P3d merges 14.6 + 14.7 (4 + 4 items).
- **Keep:** N1, 7.3. It has 4 exercise sets but 14 items, mostly proofs.

If P1a–e, P2a–b and P3a–b are all accepted, there are **65 lessons**; with P3c–d as well, 63. The spec
estimated about 62, from 3 split candidates. This scan finds 4 by the page rule (13.2 is borderline), plus
1.7 by the methods rule.

## 4. Totals

| | Count |
|---|---|
| Chapters (modules) | 14 |
| Numbered sections | 81 = 59 teaching + 8 introductions + 14 chapter summaries |
| Lessons, default | 59 (65 if the proposals are accepted) |
| Worked examples | 174 (571 worked steps in the EPUB) |
| Exercise sets | 87 = 71 in lessons + 2 in introductions + 14 end-of-chapter |
| Exercise questions (numbered) | 1,058 |
| **Exercise items (finest sub-part, the unit S1 maps and S3 turns into questions)** | **2,531**, of which 1,187 are end-of-chapter |
| Item shortcodes (PDF only; per question or per sub-part) | 1,984, all unique |
| Printed answers (appendix) | 2,281 leaves parsed. **2,270 items have one; 261 do not** (proofs, sketches, "represent", "show that", tables) |
| Items with a worked solution in the EPUB | 2,531 (about 90% multi-step, 9% answer only, 1% figure only) |
| Figures (book) | 761 PDF placements / 764 EPUB references. Plus 231 EPUB-only figures in solutions and 15 body photos |
| Equation images | 16,388 references, 8,561 unique. 30.5% of references are recoverable without a model |
| Past exam papers | 2 (Paper 1 and 2 Exemplar 2012): 16 questions, 77 marked parts, **no answers printed, not in the EPUB** |

**What today's grader can mark.** Printed answers were typed by a heuristic over the PDF text layer and
spot-checked at 8 per type; expect a few percent misfiled. The grader is `grade()` in
`app/src/app/api/attempts/route.ts` (≈L39–62):
- A **numeric** key is `parseFloat` against `^[+-]?\d+(\.\d+)?$`, or against a whitelisted arithmetic
  expression.
- Everything else is a case-insensitive exact string.
- A typed decimal comma parses as its integer part: `3,317` → 3. So the book's own notation is marked
  wrong.

| Answer type | Items | Gradable today? |
|---|---|---|
| Integer | 267 | yes |
| Decimal with comma | 166 | after D5 normalisation (key stored with a point; a typed comma still fails) |
| Number with unit or currency (`24 cm2`, `R 5,03`, `45°`) | 265 | after stripping the unit from the key |
| Fraction (flattened in the text layer, `3 25` = 3/25) | 146 | if the key is stored as a decimal (a typed `a/b` is evaluated) |
| `x = 7` style | 55 | if the key is the bare number (a typed `x = 7` fails) |
| Verbal or choice (`irrational`, `rhombus`, `(ii)`) | 258 | exact text only: fragile, better as MCQ (D4b) |
| **Algebraic expression, factorised form or formula** | **629** | **no** |
| Several values (`x = 2 or x = −3`, `4 and 5`, lists) | 265 | no |
| Coordinates `(x; y)` | 76 | no |
| Inequality, interval, set | 66 | no |
| Exact surd or π | 65 | no |
| Recurring decimal (`0,2̇1̇`) | 10 | no |
| No printed answer (proof, sketch …) | 261 | no |
| Other | 2 | no |
| **Total** | **2,531** | yes 267 (11%) · after normalisation 632 (25%) · exact text 258 (10%) · **no 1,374 (54%)** |

That makes **1,111 items whose printed answer is a maths expression the app cannot mark**: algebraic,
several values, coordinates, intervals, surds and recurring decimals. Another 261 have no printed answer.
This is the input to D4 (MCQ conversion vs expression-equivalence grading) and D5 (notation).

## 5. Anomalies

**Book and markup**
1. The PDF half-title (p.2) says "Teacher's Guide"; the body is the learner book. The bookmarks name a
   "Revised Gr10 TG full front matter" in front of "maths-gr10-lb-web".
2. The EPUB copyright page is headed "Physical Sciences 10 / Physical Sciences – Grade 10 CAPS". The
   EPUB carries no version string.
3. **Chapter 2 numbering and codes:**
   - The EPUB heading says 2.5 for Exponential equations; its nav says 2.4; the PDF says 2.4.
   - The PDF "2.5 Summary" reuses code `EMAW`, and it is the only summary titled "Summary".
   - The EPUB summary has no number and no id.
4. Two chapter titles differ between formats: 2 "Exponents" / "Exponentials" and 13 "Measurements" /
   "Measurement". The EPUB file slugs follow the EPUB titles, and its `toc.ncx` is a broken partial
   tree.
5. Exercise 5.1 is split in the EPUB markup: only question 1 sits under the title (15 items in untitled
   sibling blocks).
6. Exercise 13-3 is nested differently: PDF 1a–c + 2–4, EPUB 6 flat items.
7. 32 teacher's-guide notes are visible in the EPUB (not hidden by CSS) and addressed to teachers.
   They must never become student-facing claims.
8. EPUB titles and the nav drop inline maths: "Functions of the form" ×12, "… by k" loses the k.
9. The EPUB repeats one figure in §14.5, so chapter 14 has 47 EPUB vs 44 PDF placements. The other 13
   chapters are equal.

**Answers and practice**

10. The Past exam papers relabel their questions "Exercise 1 – 1" and "Exercise 2 – 1", colliding with
    chapter labels. There is a "(2 mars)" typo. No answers are printed.
11. 261 items have no printed answer, and whole questions go unanswered. Examples: 3-1 Q1; 5-1 Q1, 2, 4
    and 7; 12-2 almost entirely (proofs). The appendix merges 2-4 Q7's two parts onto one line.
12. Three teaching sections have no practice at all: 1.2, 5.2 and 5.4.
13. Two introductions do have practice: 6.1 (36 items) and 7.1 (1 worked example, 19 items).

**PDF navigation**

14. The PDF bookmarks for the back matter point one page early (Solutions 507, not 508; Past papers 525,
    not 526).

**Repo and spec**

15. **Paths and ignore rules:**
    - The source paths differ from spec §3.1's example (`docs/Source/g10-math/…_v11.epub`). The files
      are `docs/Source/Gr10_Mathematics_Learner_Eng_v11.pdf` and
      `docs/Source/Gr10_Mathematics_Learner_Eng_CC-BY.epub`.
    - The EPUB is ignored only by the local `.git/info/exclude`, not by `.gitignore` (which covers
      `docs/Source/*.pdf`). A fresh clone would not ignore it.
16. **Spec scout facts to correct:**
    - §6.8 runs pp.214–233, not 214–235 (234 is blank, 235 is the chapter 7 opener).
    - 13.2 is also over 12 pages by the shared-page count.
    - The past papers have no printed answers.

## 6. What changes the pipeline design or its cost

1. **S0a step 3 ("Maths becomes LaTeX: MathML → LaTeX, or the image alt text") cannot be built as
   written.** Neither exists. Add a maths-transcription sub-stage, option A in §2.5:
   - vision on the 8,561 unique PNGs at K=2;
   - acceptance by `md5(latex) == filename` or by agreement;
   - a cross-check against the PDF text layer's maths spans.

   It sits upstream of S1, S2 and S3: 52% of item stems and 48% of item solutions are maths-only. B2
   grows from L to L plus a workflow (about M).
2. **Edition check (§3.3 step 6):**
   - "Same version string" cannot pass: the EPUB has none. Use the build markers instead.
   - "Set equality of every shortcode" cannot pass: the EPUB has no item shortcodes. Use the 172 section
     codes and 78 media codes. Identify items by (exercise label, question number, sub-part index).
   - The PDF-only fallback should hinge on content agreement, not on the maths encoding; the two
     questions are separate.
3. **S3 / D3: the EPUB supplies worked solutions for all 2,531 items.**
   - The "answer-anchored derivation" row of §3.6 can become transcription of the book's own solution.
     That needs a new provenance, for example `book_worked_epub`, because the solution is not printed in
     the PDF, which is the citation authority.
   - Verification becomes three-way: printed answer, the EPUB solution's last line, and the blind
     re-solve.
   - D3 option (b), the Teacher's Guide, is largely delivered by the EPUB already. Whether an
     EPUB-only solution may count as "book" is Samuel's call.
4. **S2 must drop `div.teachers-guide` blocks.** Add a `teacher_only` block type in B2.
5. **S4 figures:**
   - Crop per PDF Form XObject (exact bboxes), or use the EPUB PNGs directly. No region detection.
   - Volume is **764 figures, about 13 per lesson**, not the 6 assumed, so S4 costs about 2× (about
     $0.30 per lesson instead of $0.15).
6. **S1:**
   - 47% of items are end-of-chapter and must be mapped by S1, which enlarges S1's input.
   - Three lessons cannot ground an objective (merges P3a and P3b).
   - Two introductions hold practice (P2).
7. **Volumes against the §5 cost assumptions:**
   - 2,531 items, about 43 per lesson once end-of-chapter items are spread, against 30 assumed: S3's
     re-solve and typing scale about 1.4×, while dropping the derivation step roughly cancels it.
   - Worked examples, 2.9 per lesson, match the assumption.
   - Pages, 6.4 per lesson, are below the assumed 8.
   - Lessons: 59–65.
8. **Revised one-time estimate (API-equivalent, rough).**
   - Maths transcription is about $20–25 per book:
     - input about 1.7M image tokens per pass at 2× upscale;
     - output about 0.5M LaTeX tokens per pass;
     - × 2 passes on Sonnet 5, plus a reconcile pass.
   - Lessons cost about $3.2 each with S4 doubled and S1 enlarged.
   - Total **about $210–230** for 62–65 lessons, against the spec's $120–190. The PDF-only fallback's
     $30–90 is not needed.
   - Batch pricing under D9(b) would halve the transcription.
9. **The answer-format gap (D4/D5) is larger than the spec implies:**
   - 54% of items cannot be graded today;
   - even plain numbers fail on the book's decimal comma;
   - D5(a) normalisation lifts 632 items.
10. **Shortcodes are PDF-only.** Keep them in `source_note` as the spec says. They also give the only
    stable per-item id that matches the printed book.

## 7. Reproduce

The scripts are scouting code, not the B2/B3 builds. They live in `services/extraction/scratch_g10/`,
which is untracked and gitignore-able. Their outputs go to a scratch directory.

```sh
S=docs/Source; OUT=<scratch>/g10; mkdir -p $OUT/epub
unzip -q $S/Gr10_Mathematics_Learner_Eng_CC-BY.epub -d $OUT/epub
python3 services/extraction/scratch_g10/scout_pdf.py  $S/Gr10_Mathematics_Learner_Eng_v11.pdf $OUT   # → pdf_scan.json
python3 services/extraction/scratch_g10/scout_epub.py $OUT/epub/OPS $OUT                             # → epub_scan.json
python3 services/extraction/scratch_g10/compare.py    $S/Gr10_Mathematics_Learner_Eng_v11.pdf $OUT   # → edition-check.json
python3 services/extraction/scratch_g10/build_manifest_draft.py $OUT \
    services/extraction/manifest/g10-math-american.json $S/Gr10_Mathematics_Learner_Eng_v11.pdf \
    $S/Gr10_Mathematics_Learner_Eng_CC-BY.epub                                                     # → manifest + manifest_tables.json
```

- They need Python 3.9+ with PyMuPDF (`fitz`); PyMuPDF is present in the user site-packages and is not
  in `pyproject.toml`.
- Every run is deterministic, with seed 20260925 for the samples.

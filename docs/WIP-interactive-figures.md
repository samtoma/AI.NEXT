# WIP — more interactive figures (`proto/interactive-figures`)

Branched from `schema-and-ingestion-pipeline` at `9e42f51` on 2026-10-20. The
working list for raising how many of the `prep3-parallel` book's figures reach a
student as a drawn figure, and how many of those ask the student something.

No requirement covers this yet. Anything here that changes `VIZ_SPEC.md` (a new
kind, a new field) is a producer/consumer contract change and is **Samuel's
call** — those items are marked 🔒.

## Where we start (compiled output at `9e42f51`)

The book has **324 figures** across 35 lesson records (Unit 7 has none).

| Outcome | Figures |
|---|---|
| Drawn natively (`geo_scene`, `coordinate_plot`, `arrow_map`, …) | **202** |
| Shown as the book's picture (`book_image` stand-in) | 20 |
| A question is held because its figure is neither drawn nor croppable | 3 |
| Not used at all | **99** |

Of the 99 unused:
- **66 orphans** — no question or worked example in the record points at the figure.
- **~23** — their question has no usable answer (none printed; the generated one not approved or not agreed). The only gap that is a review block.
- **~6** — their question is not markable and is kept as a worked example.
- **~6** — their question is live, but the figure is not attached to it.

Per unit, drawn / total: U1 25/29 · U2 0/3 · U3 0/8 · U4 1/12 · U5 17/22 ·
U6 5/6 · U7 — (no figures in the book: algebraic fractions, checked on pp. 15, 20, 25) · U8 1/13 · U9 65/83 · U10 88/148.

Interactivity: none of the 202 drawn figures asks the student anything. The
predict-then-reveal prototype (26 figures, hand-written table in
`app/src/lib/figure-predictions.ts`) lives on `proto/interactive-diagrams`, not
here, and is keyed to the live Prep-3 course's figure ids, not this book's.

Figures in this list were counted from `compiled/prep3-parallel/*.json`,
`compile-report.json` and the `book-records/prep3-parallel/pp3u*.json` records.

## Progress — VIZ_SPEC v4 built (2026-10-20, ADR-0026)

**Correction to the triage below.** 97 of the 99 unused figures were *sent* to S4
and refused as gaps; they were not missing links. A gap reaches a student only
as a stand-in for a question, so a refused lesson figure showed nothing. The
fix is drawing ability (Track C), not linking (A1). Likewise "drawable today"
was optimistic: S4 refused every plain polygon because the contract called
`geo_scene` circle-only.

Built: `geo_scene` polygons, marks (ticks, parallel arrows, right-angle squares,
equal-angle arcs), dashed, fill, arrows and panels; `venn_diagram`;
`coordinate_plot`/`function_graph` axis titles, labelled segments, shaded
polygons, quadrants, notes, `scale:"none"`; S4 prompts `lesson-v9`. Examples
and real S4 output are on `/dev/figure-marks`.

**One-lesson proof, pp3u10-3** (S4 re-run, $0.71):

| | Before | After |
|---|---|---|
| Figures drawn | 8 of 23 | **22 of 23** |
| Gaps | 15 | 1 (figure-12: the crop cuts off B, A and an angle; A4) |
| Book-picture stand-ins in the bundle | 6 | 0 |

Recompiled: in `compiled/prep3-parallel/pp3u10.json`, only pp3u10-3's visuals
changed; its questions, objectives and links are untouched.

**Next:**
- Re-run S4 on the remaining lessons. The whole book's previous S4 runs came
  to about $6. This lesson cost $0.71, roughly double before, because more
  figures are now drawn and compared.
- Recompile.
- Teach the lesson AI's `viz-prompt.ts` the v4 fields.

Watch for this: `compile_book_records.py` deleted the two
`*.review-queue.json` sample files. They were restored from git.

## Track D started — working with the figure, lesson pp3u10-3 (2026-10-20)

Three interactions, graded from the figure's own spec with no model call
(`app/src/lib/figure-interactions.ts`, a hand-written table keyed by figure id):

| Interaction | Figures | Key |
|---|---|---|
| **Read the marks**: tap the lines the marks speak about | 4, 6, 10, 11, 13, 14, 15, 20, 23 | the spec's `ticks` / `parallel` |
| **Tap the equal angle** | 2 (worked example 1: ∠C = ∠D = ∠E) | same chord, same side, from the coordinates |
| **Drag to discover** | 2 (drag C along the circle), 16 (drag D off it: the converse) | sampled from the geometry (2); the book's converse (16) |

How it behaves:
- **Figure 2 is two tasks, one card each:** `figure-2#spot` ("which angles
  equal ∠ACB?") and then `figure-2#drag` ("drag C and watch"). The tutor gives
  them in order, one per message, with its own sentence between. They were two
  steps on one card, and the second went unnoticed.
- **The drag task shows its cues until the first move:** a pulsing ring on the
  handle (it does not pulse under reduced motion), a dashed arrow along the
  point's own arc, and the live value at each angle.
- **Drill figures get no equal-angle step**, because drill 1 asks for exactly those
  angles.
- **A first wrong try gets a hint and a retry; the answer shows after the second.**
- **The tutor gets one note per settled step:** engagement only, no attempt row,
  no mastery move.
- **Every tap target also has a real button,** and the drag has step buttons, so
  every step works without a pointer.

Where it shows: **only when the tutor asks for it**, with
`{{widget:figure_task:<id>}}`.
- A figure it shows with `viz_ref`, and a figure on a question card, stays a
  plain picture.
- This replaced a first version that made every listed figure interactive
  automatically: the tutor then asked its own question while the figure asked
  another (Tamer, 2026-10-20).
- The lesson's data block now carries a FIGURE TASKS list (`figureTasksBlock`),
  only for a lesson that has tasks, so no other lesson's prompt changes. Its rule:
  a message that pushes a task asks no question of its own; the task is the
  question.
- The outcome comes back through the lesson's note sink (`FigureNoteContext`).
- Outside lessons (gallery, practice, spine dock) the figure stays plain.
- To review it with no AI, use `/dev/figure-marks` ("Work with the figure"), with
  the notes printed on the page.

Open questions:
- **Moving the table into the data:** it would become a field the pipeline
  writes, which changes VIZ_SPEC, so Samuel's call.
- **State is not kept across a reload:** a resumed lesson asks again.
- **Whether the tutor actually uses the tasks, and keeps to "no second
  question", is untested:** it needs a live lesson turn.

## Book widgets — Unit 1 trial (2026-10-21)

Tamer: "let's try 1+2 for unit 1 … through the independent solver as usual, and held for review in case anything
does not seem right." A **variant of S7**, built beside Samuel's like the cross-unit linker; his
`runbook/widgets.workflow.js` is untouched and stays the default. **Not in the ingest plan**: run by hand.

- **Option 1, the book's construction exercises as widgets.** `book_widgets.py author` →
  `runbook/widgets-book.workflow.js` (mode author). Per exercise part: an existing kind only where building the answer
  IS the part; the stem in the book's words; the key the book's or read off the stem; the parent the part's own
  question row, else the objective's worked example (`parent_kind: "teaching"`, migration 038).
- **Option 2, method hints.** A template's `hints: [{predicate, step, text}]` for predicates no misconception names,
  each taken from solution step `step`, never the answer. The app shows one (`AttemptResult.hint`, "check this step")
  only when no misconception was diagnosed (`lib/widget-hint.ts`).
- **Same review rules.** `generate_widget_questions.py` checks (additive: hints, teaching parents); Samuel's blind
  verifier prompt word for word plus a step judging each hint (`book_widgets.py verify`, runs `s7b-verify.*`); `finish`
  applies decision 47 to hints too (unconfirmed → `choices.pending_hints`, never read); the new widgets join the 10%
  generated-review sample. Held hints: `reviews/prep3-parallel/widget-mappings-pending.pp3u1-1.json`, page
  `reviews/prep3-parallel/pages/g3-book-widget-hints-u1.html` (keep/drop export → `--mapping-review`).
- **Unit 1 result** ($0.54 author + $0.95 verify): 9 widgets live — Cartesian products (drill 2 A–C, product_builder)
  and graphs of linear and constant functions (drills 4 and 5, line_drawer); 2 misconception mappings, 21 hints active,
  6 held (four "vertical-line" hints on constant lines that describe the answer; two "use your table" hints, and the
  widget shows no table). 9 gaps, all for Samuel: multi-point plotting, rational points, a region of the plane,
  relations as subsets, arrow diagrams, $f(x) = 2\tfrac12$ (off the lattice).
- **Gotcha:** `finish` rebuilds the unit's catalogue from its S5 final run, which still holds the carry-over entries
  deleted in 6bbb1f0 — after it, restore `generated/misconceptions.json` and `generated-questions.json` and keep only
  `widget-questions.json` (merged by hand, header kept).

## In the pipeline (2026-10-21)

**Figure tasks: generated.**
- `services/extraction/figure_tasks.py` derives them from each drawing, with no
  model call, and `compile_book_records.py` writes them into the figure's spec
  as `tasks` (VIZ_SPEC v4).
- Rules:
  - `marks` goes on any figure whose drawing has tick or parallel marks;
  - `spot` + `drag` go on a circle figure with several drawn angles on one chord;
  - `converse` goes on two angles marked equal on one base;
  - a figure shown with an exercise gets `marks` only.
- The app reads the tasks from the spec (`lib/figure-interactions.ts`
  `tasksOf`); the hand-written table is gone.
- The tutor's FIGURE TASKS list is built from the same data.
- Whole book: 82 tasks on 81 figure cards (Units 4, 5, 9, 10), loaded into the
  trial database.
- On pp3u10-3 the derivation reproduces the hand-made list exactly, plus five
  more `marks` figures.

**Cross-unit linker: wired into `ingest.py`.**
- **Unit plan:** S1X runs the linker (Unit 2 on), then the Objectives (G1)
  review of its links, then S1X applies what was kept.
- **Automatic runner:** the linker run once, plus apply.
- **`refresh`:** applies the kept links before every compile, so an approved
  link can no longer sit unapplied.
- **Already run on Units 2–10.** 8 links are approved and live; 5 wait for review.

## Whole-book re-run with VIZ_SPEC v4 (2026-10-20)

S4 (`lesson-v9`) was re-run on the other 34 lessons ($7.66; `runs/prep3-parallel/lessons/s4-visuals.20261020T131609Z.json`).

| | Before | After |
|---|---|---|
| Figures drawn | 216 of 324 | **295 of 324** (91%) |
| Refused (gaps) | 106 | 27 |
| Book-picture stand-ins in the bundles | 49 | 11 |

Drawn per unit: U1 27/29 · U2 0/3 · U3 0/8 · U4 7/12 · U5 19/22 · U6 6/6 · U7 — · U8 9/13 · U9 79/83 · U10 147/148.

- **6 figures the earlier run had drawn were refused this time.** The model
  varies from run to run, and the checker rejected some re-written coordinates.
  The earlier accepted drawing is kept for each, with the reason recorded in
  the lesson's `runs` entry: pp3u1-1:4, pp3u5-1:3, pp3u5-1:6, pp3u5-3:1,
  pp3u5-3:2, pp3u6-1:5.
- **The 27 left:**
  - **About 15 should stay pictures:** photos, clip art, calculators and their
    key sequences, a die.
  - **New abilities:** an angle mark on a coordinate plot (×2 in pp3u5-3, kept
    from the earlier run without the mark), a spinner with coloured sectors,
    the 0–360° angle ring, an arrow diagram on one set with loops, several
    arrow diagrams side by side.
  - **The checker's objections** (pp3u2-3:1, pp3u4-1:5, pp3u5-2:5, pp3u8-1:6,
    pp3u2-1:1): worth a second run, or a person's look.
  - **Crops:** pp3u10-3:12, pp3u9-2:22, pp3u9-2:25.
- **Renderer fixes the run turned up:**
  - a coordinate plot with only its quadrants named (pp3u1-1:7) now draws;
  - geometry positions are rounded to 1/100 px, which ends the server/browser
    hydration warning.
- **Compiled and loaded into the trial database:** 102 figures added, 225
  redrawn, 38 stand-ins removed, no question changed.

## One figure per part (2026-10-20)

A "Study each of the following figures" drill is split into one question per
part, but every part carried **all** the drill's figures (drill 1: three figures
on each of its three questions).

`compile_book_records.py` now gives each part its own figure
(`figure_of_part`):
- the figure its words name ("(figure 2)", "Figure 3:");
- else, when the drill has one figure per part, the one in its own place;
- otherwise all of them, as before.

Result:
- 33 questions across Units 6, 9 and 10 changed, and every one kept its own figure.
- The figure rows in the bundles drop from 362 to 294.
- Drill 3's third part, whose figure is the bad crop, is now held instead of
  being shown the other parts' figures. It was already in review in the trial
  database.

Loaded into the trial database. Test: `tests/test_compile_figure_of_part.py`.

## Triage of the 99 unused figures (2026-10-20)

Sorted from each figure's record caption (written by the extraction model from
the page image), not by opening all 99 crops. 25 of the 99 crops are not yet
`checked`. Treat individual calls as provisional until the figure is drawn.

| Bucket | Figures | What it takes |
|---|---|---|
| **Drawable with today's kinds** | **26** | Linking (A1) or an answer (B1), then a drawing |
| **Needs geometry marks** (ticks, parallel arrows, equal-angle arcs) | **45** | C1 |
| Needs `venn_diagram` | 6 | C2 |
| Needs labelled segments on `coordinate_plot` (symbolic points such as M(x₁, y₁)) | 3 | C6 |
| Needs an angle-ring / protractor drawing | 1 | C4, or keep the picture |
| **Keep as picture or text** (photos, decoration, calculator keys) | **18** | Nothing to animate |

Of the 99, **81 could be drawn**: 26 now, 55 with new drawing ability. The
other 18 should stay a picture or text.

**Drawable with today's kinds (26)**
- `geo_scene`, circles: pp3u10-3:12 (concentric circles), pp3u10-5:21,
  pp3u10-7:1 (the ray sweeping to the tangent, which fits stepped animation
  well), pp3u10-7:9, pp3u9-1:25, pp3u9-2:14 (one circle sliding past another),
  pp3u9-2:17
- `geo_scene`, polygons and triangles: pp3u10-3:21, pp3u10-5:14/15/17/18/22,
  pp3u10-6:13/14 (inscribed circles), pp3u10-7:16, pp3u4-2:7, pp3u6-1:1,
  pp3u9-2:26
- `trig_triangle`: pp3u4-1:1, pp3u4-1:4, pp3u4-2:2
- `coordinate_plot`: pp3u1-1:7 (quadrants), pp3u5-2:5 (parallelogram on grid)
- `function_graph`: pp3u2-3:1 (distance–time line). It has no axis titles;
  check whether the lesson needs them.
- `arrow_map` ×3: pp3u1-3:1. Split into three figures; the record says the
  arrows must be read from the page.

⚠️ **Open question:** 13 of these are triangles or quadrilaterals drawn with
`geo_scene` segments. `VIZ_SPEC.md` calls `geo_scene` a *circle-geometry*
scene, and one stand-in (pp3u4-2:1) was refused because "no kind draws a
general triangle". Unit 10 already draws some polygons natively. Settle
whether `geo_scene` covers polygons before counting these as drawable.

**Needs geometry marks (45)**: almost all of Units 9–10.
- pp3u10-1: 11, 15, 16, 18, 19
- pp3u10-2: 1, 15, 17, 34
- pp3u10-3: 6, 10, 13, 14, 15, 17, 18, 19, 20, 22, 23
- pp3u10-4: 6, 7, 8, 9, 10, 11
- pp3u10-5: 6, 16, 19, 20
- pp3u10-6: 5, 6, 11, 12
- pp3u10-7: 15, 17, 18
- pp3u9-1: 18, 19, 20, 29 · pp3u9-2: 11 (also three panels: split) ·
  pp3u9-3: 5, 6 · pp3u9-4: 19

Equal-angle arcs are needed by pp3u10-5:20 and pp3u10-6:6. All the others need
only ticks and/or parallel arrows.

**Needs `venn_diagram` (6)**: pp3u8-1: 4, 7, 8, 9 · pp3u8-2: 1, 3

**Needs labelled segments on `coordinate_plot` (3)**: pp3u5-1: 4, 5 · pp3u5-2: 4
(the distance and midpoint derivations). pp3u5-2:4 also has ticks.

**Angle ring (1)**: pp3u4-1:2, a 0–360° ring

**Keep as picture or text (18)**
- Photos and decoration (7): pp3u1-2:1, pp3u2-1:1, pp3u3-1:1/2/3, pp3u9-1:1,
  pp3u9-3:1
- Pictures of a calculator or die (3): pp3u4-1:3, pp3u4-2:4, pp3u8-1:1
- Calculator key sequences (7): pp3u2-3:2, pp3u3-1:4, pp3u3-2:1/2/3/4,
  pp3u4-2:6. Better as text in the worked example than as a figure.
- Rotation-direction convention (1): pp3u5-3:5

## Track A — get more figures drawn (no contract change)

- [ ] **A1. Link the 66 orphan figures.** Biggest single win. Decide per figure:
      attach it to its lesson objective as a lesson figure, or to the question
      it actually illustrates. Heaviest lessons: pp3u10-3 (9), pp3u10-1 (5),
      pp3u8-1 (5), pp3u10-6 (4), pp3u3-1 (4), pp3u3-2 (4), pp3u4-2 (4).
      Open question: does the compiler draw a figure that only an objective
      points at, or only figures a question/example references?
- [ ] **A2. Attach figures to their live questions** (~6, probably a compiler
      bug): pp3u1-3:figure-1, pp3u10-3:figure-10/12/15, pp3u10-7:figure-1,
      pp3u9-1:figure-18.
- [ ] **A3. Link the printed figures that no record links** — 8 held questions
      point at a figure no record links: pp3u6-2-1 drill-1, pp3u10-2-3 drill-15
      (×5), pp3u10-5-2 drill-3 (×2).
- [ ] **A4. Fix the 3 failed crops** so their held questions can at least show
      the book's picture: pp3u4-1:figure-5, pp3u8-1:figure-3, pp3u9-2:figure-22.
- [x] **A5. Check Unit 7** — zero figure items in its records. Checked
      2026-10-20: the book has none. Term 2 Unit 2 (algebraic fractions) is
      text and fractions only, plus the lesson pages' decorative cartoons.
- [ ] **A6. Look at Units 2, 3, 4, 8** (2 drawn of 36) — mostly orphans and
      new kinds; confirm after A1 and B1.

## Track B — unblock by review (Tamer / Samuel)

- [ ] **B1. Approve or settle the generated answers** behind ~23 figures, all in
      Units 9–10 (pp3u10-5 drills 4–10 alone carry 7). Goes through the
      existing generated-review queue; no code.
- [ ] **B2. Decide the not-markable ones** (~6: pp3u4-1 think-and-discuss,
      pp3u9-1 drills 7–8, pp3u9-2 drill-6, pp3u10-6 drill-3) — keep as worked
      examples, or make them markable.

## Track C — new drawing ability 🔒 (VIZ_SPEC change, Samuel's call)

Each of the 20 stand-ins records what it lacks (`native_kind_needed`).

- [ ] **C1. `geo_scene` marks**: equal-length ticks, equal-arc ticks, parallel
      arrows, right-angle marks. Covers about 9 stand-ins (pp3u10-2:28/29,
      pp3u10-3:4/11, pp3u10-5:5/10, pp3u10-6:9, pp3u9-4:17, pp3u4-2:1) **and
      45 of the 99 unused figures** (see the triage). The biggest single
      unlock: about 54 figures in all.
- [ ] **C2. `venn_diagram` kind** — 4 figures (pp3u1-1:1, pp3u8-1:6/10,
      pp3u8-2:2), the most-used missing kind by question count.
- [ ] **C3. Multi-panel `geo_scene`** — pp3u10-7:3, pp3u9-2:10.
- [ ] **C4. Smaller ones**: card/object sets (pp3u8-1:5), a triangle with an
      inscribed circle (pp3u10-6:17), two circles with common tangents
      (pp3u10-6:16), algebraic angle labels (pp3u9-2:25), and the trig-triangle
      θ label (pp3u4-2:3).
- [ ] **C6. Labelled segments on `coordinate_plot`** — symbolic points and
      leg labels (x₂ − x₁), for pp3u5-1:4/5 and pp3u5-2:4.
- [ ] **C5. Figures that withhold labels** — pp3u1-1:5/6, pp3u10-7:6/7/8 fall
      back to the picture because the drawing hides labels the question reads
      off. Decide: show the labels, or keep the picture.

## Track D — make drawn figures interactive

- [ ] **D1. Port predict-then-reveal** from `proto/interactive-diagrams`
      (`FigurePredict`, `PlotGrid`, `figure-predictions.ts`) onto this branch,
      keyed to this book's figure ids.
- [ ] **D2. Write prompts for this book's lesson figures** the existing modes
      already grade: `arrow_map` (draw/verdict/range), `coordinate_plot`
      (plot), `geo_scene` (angle, only where the angle is the theorem's result).
- [ ] **D3. New grading modes** for kinds with none yet: `number_line`,
      `ratio_bars`, `function_graph`, and a multiple choice for symbolic
      `geo_scene` claims (e.g. *which two segments are equal?*, built from the
      figure's own labels).
- [ ] **D4. 🔒 Move predictions into the data** — a `predict` field the
      pipeline writes, replacing the hand-written table.

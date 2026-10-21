# ADR-0026: VIZ_SPEC v4 — geometry marks, polygons and the Venn diagram

- **Status:** Accepted
- **Date:** 2026-10-20
- **Decided by:** Samuel (CTO/Architect). His agreement to change the figure contract was relayed by Tamer on 2026-10-20. Tamer chose the shape (extend `geo_scene`, not add a kind) and the scope under that agreement.

## Context
The `prep3-parallel` book has 324 figures. The S4 drawing step drew 202 of them and refused 120 as gaps; 97 of the refused figures reached no student at all, because only a gap that a question uses gets the book's picture as a stand-in. S4's stated reasons were consistent:
- the `geo_scene` contract called it "circle geometry", so every plain triangle and quadrilateral was refused, although the renderer has always drawn segments anywhere;
- no kind could draw the marks a textbook figure states its givens with: equal-length ticks, parallel arrows, right-angle squares, equal-angle arcs. Leaving them out drops part of the question;
- dashed and shaded parts, Venn diagrams, axis titles, labelled segments and symbolic coordinates had no field.

A triage of the 99 unused figures (`docs/WIP-interactive-figures.md`) found 81 drawable with these abilities. The other 18 are photos, decoration and calculator key sequences.

## Options considered
1. **Extend `geo_scene`** with new element fields and a `polygon` element. Additive: all 222 drawn `geo_scene` specs stay valid and draw the same. One geometry kind for the producer to choose.
2. **A new `polygon_scene` kind** (or the `geometry_diagram` that `figure_inventory.py` had proposed for Grade 10) beside a circle-only `geo_scene`. Cleaner names, but marks would have to exist in both kinds, and S4 would have to pick between two near-identical kinds for figures that mix circles and polygons, which most Unit 9–10 figures do.

## Decision
VIZ_SPEC goes to **v4**, additively. Option 1 is chosen:
- **`geo_scene`** draws any straight-edge-and-circle figure. It adds:
  - a `polygon` element;
  - `ticks`, `parallel`, `dashed` and `arrow` on segments;
  - `ticks` on arcs;
  - `right` and `arcs` on angles;
  - `fill` on circles and polygons;
  - `panels` for a figure printed as several numbered drawings.
- **`venn_diagram`** is the tenth maths kind:
  - 1–3 sets drawn as relationships (overlapping, apart, one inside another), not proportional areas;
  - items placed by sampling the real ovals;
  - shaded regions as intersections and differences of those ovals.
- **`coordinate_plot`** adds labelled and dashed segments, shaded `polygons`, `axes` titles, `quadrants`, `notes` and `scale:"none"` (a derivation drawn with symbolic points). **`function_graph`** adds `axes`.
- The S4 prompts become **`lesson-v9`**. A Venn diagram, a triangle or quadrilateral scene and a shaded region are no longer named as gaps. The author is told that marks are givens and that several drawings are panels. Compare reads a mark field as the mark it draws.

## Consequences
- The 97 unused figures and 20 stand-ins can be re-drawn by re-running S4 per lesson (`book_record_figures.py run`); one lesson costs about $0.40. Re-running also redraws figures already drawn, so it can change them.
- `trig_triangle` stays the sin/cos/tan ratio picture only. Every other right triangle is a `geo_scene`.
- Not changed: the lesson AI's own figure prompt (`app/src/lib/viz-prompt.ts`) still lists the v1 `geo_scene` elements and has no `venn_diagram`. Teaching it v4 is a separate change with its prompt goldens.
- Still gaps: photos and decoration, calculator key sequences, the 0–360° angle ring, a box plot, a 3-D solid, several curves on one set of axes.
- Revisit if a book needs marks `geo_scene` cannot express cleanly (congruence of whole triangles, loci) or more than three Venn sets.

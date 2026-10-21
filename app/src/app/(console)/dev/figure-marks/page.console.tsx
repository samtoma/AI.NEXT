"use client";

/**
 * DEV HARNESS — the VIZ_SPEC v4 figure abilities, each drawn from a spec
 * modelled on a real Prep-3 figure the drawing step had to refuse before v4
 * (docs/WIP-interactive-figures.md, the triage). The spec is printed beside
 * the drawing, so a reviewer checks the drawing against the book's figure and
 * the producer contract at once.
 *
 * Not linked from anywhere; static route, no data access. Guarded by the /dev
 * layout like every harness here.
 */

import { useState } from "react";
import { Visual } from "@/components/viz/Visual";
import { InteractiveFigure } from "@/components/student/figures/InteractiveFigure";
import { interactionsFor, taskIdsOf } from "@/lib/figure-interactions";
import { PP3U10_3_FIGURES } from "./pp3u10-3-figures";

interface Case {
  figure: string;
  what: string;
  kind: string;
  spec: Record<string, unknown>;
}

const CASES: Case[] = [
  {
    figure: "pp3u1-1 (tutor-drawn)",
    what: "a product grid: hovering a pair lights that pair and its x and y headers only",
    kind: "product_grid",
    spec: { X: [2, -1], Y: [4, 0], animate: "fill", showCount: true },
  },
  {
    figure: "pp3u10-3:figure-17",
    what: "a quadrilateral with diagonals, two angle values and equal-side ticks (AB = AD)",
    kind: "geo_scene",
    spec: {
      elements: [
        { type: "polygon", points: [[-3, -2], [3, -2], [2.5, 3], [-3, 3]], step: 1 },
        { type: "segment", from: [-3, -2], to: [3, -2], ticks: 1, step: 2 },
        { type: "segment", from: [3, -2], to: [2.5, 3], ticks: 1, step: 2 },
        { type: "segment", from: [3, -2], to: [-3, 3], step: 3 },
        { type: "segment", from: [-3, -2], to: [2.5, 3], step: 3 },
        { type: "point", x: -3, y: 3, label: "C", step: 1 },
        { type: "point", x: 2.5, y: 3, label: "D", step: 1 },
        { type: "point", x: -3, y: -2, label: "B", step: 1 },
        { type: "point", x: 3, y: -2, label: "A", step: 1 },
        { type: "angle", at: [-3, 3], fromDeg: -40, toDeg: -90, label: "50°", step: 4 },
        { type: "angle", at: [3, -2], fromDeg: 100, toDeg: 180, label: "80°", step: 4 },
      ],
      animate: "sequence",
    },
  },
  {
    figure: "pp3u10-3:figure-18",
    what: "a trapezium, AD ∥ BC marked with arrows, diagonals meeting at E",
    kind: "geo_scene",
    spec: {
      elements: [
        { type: "segment", from: [-2, 2], to: [2, 2], parallel: 1, step: 1 },
        { type: "segment", from: [-4, -2], to: [4, -2], parallel: 1, step: 1 },
        { type: "segment", from: [-2, 2], to: [-4, -2], step: 1 },
        { type: "segment", from: [2, 2], to: [4, -2], step: 1 },
        { type: "segment", from: [-2, 2], to: [4, -2], dashed: true, step: 2 },
        { type: "segment", from: [2, 2], to: [-4, -2], dashed: true, step: 2 },
        { type: "point", x: -2, y: 2, label: "D", step: 1 },
        { type: "point", x: 2, y: 2, label: "A", step: 1 },
        { type: "point", x: 4, y: -2, label: "B", step: 1 },
        { type: "point", x: -4, y: -2, label: "C", step: 1 },
        { type: "point", x: 0, y: 0.667, label: "E", step: 2 },
      ],
      animate: "sequence",
    },
  },
  {
    figure: "pp3u10-3:figure-22",
    what: "a square: right-angle squares at the corners, equal-side ticks",
    kind: "geo_scene",
    spec: {
      elements: [
        { type: "polygon", points: [[0, 0], [4, 0], [4, 4], [0, 4]], fill: true, step: 1 },
        { type: "segment", from: [0, 0], to: [4, 0], ticks: 2, step: 2 },
        { type: "segment", from: [4, 0], to: [4, 4], ticks: 2, step: 2 },
        { type: "segment", from: [4, 4], to: [0, 4], ticks: 2, step: 2 },
        { type: "segment", from: [0, 4], to: [0, 0], ticks: 2, step: 2 },
        { type: "angle", at: [0, 0], fromDeg: 0, toDeg: 90, right: true, step: 3 },
        { type: "angle", at: [4, 0], fromDeg: 90, toDeg: 180, right: true, step: 3 },
        { type: "angle", at: [4, 4], fromDeg: 180, toDeg: 270, right: true, step: 3 },
        { type: "angle", at: [0, 4], fromDeg: 270, toDeg: 360, right: true, step: 3 },
        { type: "point", x: 0, y: 4, label: "D", step: 1 },
        { type: "point", x: 4, y: 4, label: "A", step: 1 },
        { type: "point", x: 4, y: 0, label: "B", step: 1 },
        { type: "point", x: 0, y: 0, label: "C", step: 1 },
      ],
      animate: "sequence",
    },
  },
  {
    figure: "pp3u10-2:figure-34",
    what: "equal arcs DE and BC marked with ticks; two secants from an outside point",
    kind: "geo_scene",
    spec: {
      elements: [
        { type: "circle", cx: 0, cy: 0, r: 4, step: 1 },
        { type: "arc", startDeg: 130, endDeg: 230, label: "104°", step: 2 },
        { type: "arc", startDeg: 30, endDeg: 60, ticks: 1, step: 3 },
        { type: "arc", startDeg: -60, endDeg: -30, ticks: 1, step: 3 },
        { type: "segment", from: [9, 0], to: [-2.57, 3.06], step: 4 },
        { type: "segment", from: [9, 0], to: [-2.57, -3.06], step: 4 },
        { type: "point", x: 9, y: 0, label: "A", step: 4 },
        { type: "angle", at: [9, 0], fromDeg: 165, toDeg: 195, label: "36°", step: 5 },
      ],
      animate: "sequence",
    },
  },
  {
    figure: "pp3u10-6:figure-6",
    what: "two tangents from A: equal angles at M and at A, marked with arcs",
    kind: "geo_scene",
    spec: {
      elements: [
        { type: "circle", cx: 0, cy: 0, r: 3, step: 1 },
        { type: "point", x: 0, y: 0, label: "M", step: 1 },
        { type: "point", x: 7, y: 0, label: "A", step: 2 },
        { type: "tangent", from: [7, 0], to: [1.29, 2.71], step: 2 },
        { type: "tangent", from: [7, 0], to: [1.29, -2.71], step: 2 },
        { type: "radius", from: [0, 0], to: [1.29, 2.71], step: 3 },
        { type: "radius", from: [0, 0], to: [1.29, -2.71], step: 3 },
        { type: "segment", from: [0, 0], to: [7, 0], dashed: true, step: 3 },
        { type: "angle", at: [0, 0], fromDeg: 0, toDeg: 64.5, arcs: 2, step: 4 },
        { type: "angle", at: [0, 0], fromDeg: -64.5, toDeg: 0, arcs: 2, step: 4 },
        { type: "angle", at: [7, 0], fromDeg: 154.6, toDeg: 180, arcs: 1, step: 4 },
        { type: "angle", at: [7, 0], fromDeg: 180, toDeg: 205.4, arcs: 1, step: 4 },
      ],
      animate: "sequence",
    },
  },
  {
    figure: "pp3u9-2:figure-14",
    what: "a circle slid along a line toward another: positions as steps, the motion an arrow",
    kind: "geo_scene",
    spec: {
      elements: [
        { type: "segment", from: [-8, 0], to: [8, 0], arrow: "both", step: 1 },
        { type: "circle", cx: 3, cy: 0, r: 3, fill: true, step: 1 },
        { type: "point", x: 3, y: 0, label: "M", step: 1 },
        { type: "circle", cx: -5, cy: 0, r: 1.5, dashed: true, step: 2 },
        { type: "point", x: -5, y: 0, label: "N", step: 2 },
        { type: "segment", from: [-5, 2.2], to: [-1, 2.2], arrow: "end", step: 3 },
        { type: "circle", cx: -1, cy: 0, r: 1.5, step: 4 },
      ],
      animate: "sequence",
    },
  },
  {
    figure: "pp3u9-2:figure-11",
    what: "three numbered drawings, one geo_scene with panels",
    kind: "geo_scene",
    spec: {
      panels: [
        { label: "(A)", elements: [
          { type: "circle", cx: 0, cy: 0, r: 3, step: 1 },
          { type: "point", x: 0, y: 0, label: "M", step: 1 },
          { type: "segment", from: [0, 0], to: [3, 0], step: 2 },
          { type: "segment", from: [3, 0], to: [3, 4], step: 2 },
          { type: "angle", at: [3, 0], fromDeg: 90, toDeg: 180, right: true, step: 3 },
        ] },
        { label: "(B)", elements: [
          { type: "circle", cx: 0, cy: 0, r: 3, step: 1 },
          { type: "chord", from: [-2.4, 1.8], to: [2.4, 1.8], ticks: 1, step: 2 },
          { type: "chord", from: [-2.4, -1.8], to: [2.4, -1.8], ticks: 1, step: 2 },
        ] },
        { label: "(C)", elements: [
          { type: "polygon", points: [[0, 0], [4, 0], [0, 3]], step: 1 },
          { type: "angle", at: [0, 0], fromDeg: 0, toDeg: 90, right: true, step: 2 },
          { type: "segment", from: [4, 0], to: [0, 3], label: "5 cm", step: 2 },
        ] },
      ],
      animate: "sequence",
    },
  },
  {
    figure: "pp3u8-1:figure-8",
    what: "two overlapping sets, elements in their regions, the overlap shaded",
    kind: "venn_diagram",
    spec: {
      universe: "S",
      sets: [{ label: "B" }, { label: "A" }],
      overlaps: [["A", "B"]],
      items: [
        { text: "3", in: ["B"] }, { text: "9", in: ["B"] }, { text: "6", in: ["A", "B"] },
        { text: "2", in: ["A"] }, { text: "4", in: ["A"] }, { text: "8", in: ["A"] },
        { text: "5", in: [] }, { text: "1", in: [] }, { text: "7", in: [] },
      ],
      shade: [{ in: ["A", "B"] }],
      animate: "sequence",
    },
  },
  {
    figure: "pp3u8-2:figure-3",
    what: "A − B shaded and named",
    kind: "venn_diagram",
    spec: {
      universe: "S",
      sets: [{ label: "B" }, { label: "A" }],
      overlaps: [["A", "B"]],
      shade: [{ in: ["A"], out: ["B"] }],
      notes: [{ text: "A − B", in: ["A"], out: ["B"] }],
      animate: "sequence",
    },
  },
  {
    figure: "pp3u8-2:figure-1",
    what: "one set and its complement A′ shaded",
    kind: "venn_diagram",
    spec: {
      universe: "S",
      sets: [{ label: "A" }],
      shade: [{ in: [], out: ["A"] }],
      notes: [{ text: "A′", in: [], out: ["A"] }],
      animate: "sequence",
    },
  },
  {
    figure: "pp3u8-1:figure-9",
    what: "mutually exclusive events: two sets apart",
    kind: "venn_diagram",
    spec: { universe: "S", sets: [{ label: "A" }, { label: "B" }], animate: "sequence" },
  },
  {
    figure: "pp3u8-1:figure-6 (shape)",
    what: "A and B overlap, C sits inside A",
    kind: "venn_diagram",
    spec: {
      universe: "S",
      sets: [{ label: "A" }, { label: "B" }, { label: "C", inside: "A" }],
      overlaps: [["A", "B"]],
      items: [{ text: "x", in: ["A", "C"] }, { text: "y", in: ["A", "B"] }],
      shade: [{ in: ["A", "B"] }],
      animate: "sequence",
    },
  },
  {
    figure: "three sets",
    what: "three mutually overlapping sets, the triple overlap shaded",
    kind: "venn_diagram",
    spec: {
      universe: "U",
      sets: [{ label: "X" }, { label: "Y" }, { label: "Z" }],
      overlaps: [["X", "Y"], ["Y", "Z"], ["X", "Z"]],
      items: [{ text: "2", in: ["X", "Y", "Z"] }, { text: "4", in: ["Y", "Z"] }, { text: "1", in: ["X"] }],
      shade: [{ in: ["X", "Y", "Z"] }],
      animate: "sequence",
    },
  },
  {
    figure: "pp3u1-1:figure-7",
    what: "the four quadrants, named, with their sign conditions",
    kind: "coordinate_plot",
    spec: {
      xRange: [-4, 4], yRange: [-4, 4], points: [{ x: 0, y: 0, label: "O" }],
      quadrants: ["first\nx > 0, y > 0", "second\nx < 0, y > 0", "third\nx < 0, y < 0", "fourth\nx > 0, y < 0"],
      animate: "plot-sequence",
    },
  },
  {
    figure: "pp3u5-1:figure-4",
    what: "the distance derivation: symbolic points, labelled legs, shaded triangle, no scale",
    kind: "coordinate_plot",
    spec: {
      xRange: [-1, 7], yRange: [-1, 6], scale: "none",
      points: [{ x: 1, y: 1, label: "M(x₁, y₁)" }, { x: 5, y: 1, label: "K" }, { x: 5, y: 4, label: "N(x₂, y₂)" }],
      segments: [{ from: 0, to: 1, label: "x₂ − x₁" }, { from: 1, to: 2, label: "y₂ − y₁" }, [0, 2]],
      polygons: [{ points: [0, 1, 2], fill: true }],
      animate: "plot-sequence",
    },
  },
  {
    figure: "pp3u2-3:figure-1",
    what: "distance–time: the axes titled in the book's words",
    kind: "function_graph",
    spec: {
      fn: "linear", coefs: [15, 0], domain: [0, 4],
      axes: { x: "Time in seconds", y: "Distance in metres" },
      animate: "draw",
    },
  },
];

/** What the drawing step actually wrote with the v4 contract (lesson-v9, pp3u10-3 re-run 2026-10-20),
 *  copied verbatim from teaching/prep3-parallel/visuals/pp3u10-3.json — every one a gap before v4. */
const S4_OUTPUT: Case[] = [
 {
  "figure": "pp3u10-3:figure-17",
  "what": "S4 lesson-v9 output: Quadrilateral ABCD with both diagonals, AB = AD, angle C = 50° and angle A = 80°.",
  "kind": "geo_scene",
  "spec": {
   "animate": "sequence",
   "elements": [
    {
     "type": "polygon",
     "points": [
      [
       0,
       0
      ],
      [
       6.6,
       0
      ],
      [
       5.5,
       6.5
      ],
      [
       0,
       6.4
      ]
     ],
     "step": 1
    },
    {
     "type": "point",
     "x": 0,
     "y": 6.4,
     "label": "C",
     "step": 1
    },
    {
     "type": "point",
     "x": 5.5,
     "y": 6.5,
     "label": "D",
     "step": 1
    },
    {
     "type": "point",
     "x": 0,
     "y": 0,
     "label": "B",
     "step": 1
    },
    {
     "type": "point",
     "x": 6.6,
     "y": 0,
     "label": "A",
     "step": 1
    },
    {
     "type": "segment",
     "from": [
      6.6,
      0
     ],
     "to": [
      0,
      6.4
     ],
     "step": 2
    },
    {
     "type": "segment",
     "from": [
      0,
      0
     ],
     "to": [
      5.5,
      6.5
     ],
     "step": 2
    },
    {
     "type": "segment",
     "from": [
      0,
      0
     ],
     "to": [
      6.6,
      0
     ],
     "ticks": 1,
     "step": 3
    },
    {
     "type": "segment",
     "from": [
      6.6,
      0
     ],
     "to": [
      5.5,
      6.5
     ],
     "ticks": 1,
     "step": 3
    },
    {
     "type": "angle",
     "at": [
      0,
      6.4
     ],
     "fromDeg": 270,
     "toDeg": 316,
     "label": "50°",
     "step": 4
    },
    {
     "type": "angle",
     "at": [
      6.6,
      0
     ],
     "fromDeg": 100,
     "toDeg": 180,
     "label": "80°",
     "step": 4
    }
   ]
  }
 },
 {
  "figure": "pp3u10-3:figure-20",
  "what": "S4 lesson-v9 output: Trapezium ABCD with AD parallel to BC, diagonals meeting at E, and EC and EB marked equal.",
  "kind": "geo_scene",
  "spec": {
   "animate": "sequence",
   "elements": [
    {
     "type": "polygon",
     "points": [
      [
       0.7,
       4
      ],
      [
       6,
       4
      ],
      [
       6.45,
       0
      ],
      [
       0,
       0
      ]
     ],
     "step": 1
    },
    {
     "type": "point",
     "x": 0.7,
     "y": 4,
     "label": "D",
     "step": 1
    },
    {
     "type": "point",
     "x": 6,
     "y": 4,
     "label": "A",
     "step": 1
    },
    {
     "type": "point",
     "x": 6.45,
     "y": 0,
     "label": "B",
     "step": 1
    },
    {
     "type": "point",
     "x": 0,
     "y": 0,
     "label": "C",
     "step": 1
    },
    {
     "type": "segment",
     "from": [
      0.7,
      4
     ],
     "to": [
      6,
      4
     ],
     "parallel": 1,
     "step": 2
    },
    {
     "type": "segment",
     "from": [
      0,
      0
     ],
     "to": [
      6.45,
      0
     ],
     "parallel": 1,
     "step": 2
    },
    {
     "type": "segment",
     "from": [
      6,
      4
     ],
     "to": [
      3.25,
      2.2
     ],
     "step": 3
    },
    {
     "type": "segment",
     "from": [
      3.25,
      2.2
     ],
     "to": [
      0,
      0
     ],
     "ticks": 2,
     "step": 3
    },
    {
     "type": "segment",
     "from": [
      0.7,
      4
     ],
     "to": [
      3.25,
      2.2
     ],
     "step": 3
    },
    {
     "type": "segment",
     "from": [
      3.25,
      2.2
     ],
     "to": [
      6.45,
      0
     ],
     "ticks": 2,
     "step": 3
    },
    {
     "type": "point",
     "x": 3.25,
     "y": 2.2,
     "label": "E",
     "step": 3
    }
   ]
  }
 },
 {
  "figure": "pp3u10-3:figure-6",
  "what": "S4 lesson-v9 output: Chords AB and CD cross at E with EA and ED marked equal; DA and BC are joined.",
  "kind": "geo_scene",
  "spec": {
   "animate": "sequence",
   "elements": [
    {
     "type": "circle",
     "cx": 0,
     "cy": 0,
     "r": 5,
     "step": 1
    },
    {
     "type": "point",
     "x": 0,
     "y": 0,
     "label": "",
     "step": 1
    },
    {
     "type": "point",
     "x": -2.86,
     "y": 4.14,
     "label": "D",
     "step": 2
    },
    {
     "type": "point",
     "x": 3.42,
     "y": 4.14,
     "label": "A",
     "step": 2
    },
    {
     "type": "point",
     "x": -4.14,
     "y": -2.56,
     "label": "B",
     "step": 2
    },
    {
     "type": "point",
     "x": 4.14,
     "y": -2.56,
     "label": "C",
     "step": 2
    },
    {
     "type": "point",
     "x": 0,
     "y": 1.49,
     "label": "E",
     "step": 2
    },
    {
     "type": "chord",
     "from": [
      3.42,
      4.14
     ],
     "to": [
      0,
      1.49
     ],
     "ticks": 1,
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      0,
      1.49
     ],
     "to": [
      -4.14,
      -2.56
     ],
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      -2.86,
      4.14
     ],
     "to": [
      0,
      1.49
     ],
     "ticks": 1,
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      0,
      1.49
     ],
     "to": [
      4.14,
      -2.56
     ],
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      -2.86,
      4.14
     ],
     "to": [
      3.42,
      4.14
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      -4.14,
      -2.56
     ],
     "to": [
      4.14,
      -2.56
     ],
     "step": 4
    }
   ]
  }
 },
 {
  "figure": "pp3u10-3:figure-11",
  "what": "S4 lesson-v9 output: Parallel chords BA and DC, with (3y − 5)° at E and arc AC marked 50°.",
  "kind": "geo_scene",
  "spec": {
   "animate": "sequence",
   "elements": [
    {
     "type": "circle",
     "cx": 0,
     "cy": 0,
     "r": 5,
     "step": 1
    },
    {
     "type": "point",
     "x": 0,
     "y": 0,
     "label": "",
     "step": 1
    },
    {
     "type": "point",
     "x": 0.77,
     "y": 4.94,
     "label": "E",
     "step": 2
    },
    {
     "type": "point",
     "x": -5,
     "y": 0,
     "label": "B",
     "step": 2
    },
    {
     "type": "point",
     "x": 5,
     "y": 0,
     "label": "A",
     "step": 2
    },
    {
     "type": "point",
     "x": -2.93,
     "y": -4.05,
     "label": "D",
     "step": 2
    },
    {
     "type": "point",
     "x": 2.93,
     "y": -4.05,
     "label": "C",
     "step": 2
    },
    {
     "type": "chord",
     "from": [
      -5,
      0
     ],
     "to": [
      5,
      0
     ],
     "parallel": 1,
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      -2.93,
      -4.05
     ],
     "to": [
      2.93,
      -4.05
     ],
     "parallel": 1,
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      0.77,
      4.94
     ],
     "to": [
      -5,
      0
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      0.77,
      4.94
     ],
     "to": [
      5,
      0
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      0.77,
      4.94
     ],
     "to": [
      -2.93,
      -4.05
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      0.77,
      4.94
     ],
     "to": [
      2.93,
      -4.05
     ],
     "step": 4
    },
    {
     "type": "angle",
     "at": [
      0.77,
      4.94
     ],
     "fromDeg": 220.6,
     "toDeg": 247.6,
     "label": "(3y − 5)°",
     "step": 5
    },
    {
     "type": "arc",
     "cx": 0,
     "cy": 0,
     "r": 5,
     "startDeg": -54,
     "endDeg": 0,
     "label": "50°",
     "step": 5
    }
   ]
  }
 }
];

/** The lesson's figures as a student works them — with the note each step
 *  would send the tutor printed underneath, since no tutor is listening here. */
function InteractiveSection() {
  const [notes, setNotes] = useState<string[]>([]);
  return (
    <section className="mb-8">
      <h2 className="font-display text-xl text-ink">Work with the figure — lesson pp3u10-3</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        Read the marks, tap the equal angle, drag to discover. Graded from each figure&apos;s own spec; no AI.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* one card per TASK, as the tutor pushes them: a figure with two tasks is two cards */}
        {PP3U10_3_FIGURES.flatMap((f) =>
          taskIdsOf(f.id, f.spec).map((tid) => {
            const steps = interactionsFor(tid, f.spec);
            return steps ? (
              <div key={tid}>
                <p className="font-mono text-[11px] text-ink-soft">{tid}</p>
                <InteractiveFigure figure={f} steps={steps} taskId={tid} onNote={(n) => setNotes((x) => [n, ...x])} />
              </div>
            ) : null;
          })
        )}
      </div>
      <div className="mt-4 rounded-xl border border-line bg-card p-3">
        <h3 className="text-sm font-semibold text-ink">Notes the tutor would receive</h3>
        {notes.length === 0 ? (
          <p className="mt-1 text-xs text-ink-soft">none yet</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {notes.map((n, i) => (
              <li key={i} className="font-mono text-[11px] text-ink-soft">{n}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function FigureMarksPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <InteractiveSection />
      <h1 className="font-display text-2xl text-ink">Figure abilities — VIZ_SPEC v4</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        Each drawing is a spec modelled on a Prep-3 figure the drawing step refused before v4. Compare it with the
        book&apos;s figure: every mark the book draws is a given and must be here.
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {[...CASES, ...S4_OUTPUT].map((c) => (
          <section key={c.figure + c.what} className="rounded-xl border border-line bg-card p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">{c.figure}</h2>
              <span className="text-xs text-ink-soft">{c.kind}</span>
            </div>
            <p className="mt-0.5 text-xs text-ink-soft">{c.what}</p>
            <div className="mt-2">
              <Visual kind={c.kind} spec={c.spec} />
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-ink-soft">spec</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-paper-deep p-2 font-mono text-[10px] text-ink-soft">
                {JSON.stringify(c.spec, null, 1)}
              </pre>
            </details>
          </section>
        ))}
      </div>
    </main>
  );
}

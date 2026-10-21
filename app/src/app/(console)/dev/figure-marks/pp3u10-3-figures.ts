/**
 * A snapshot of lesson pp3u10-3's stored figures that carry tasks, copied from
 * services/extraction/compiled/prep3-parallel/pp3u10.json — the tasks as the
 * pipeline writes them at compile (services/extraction/figure_tasks.py) — so
 * the harness and lib/figure-interactions.test.mts need no database.
 * Regenerate it after the book is recompiled.
 */
import type { StoredFigure } from "@/components/student/figures/InteractiveFigure";

export const PP3U10_3_FIGURES: StoredFigure[] = [
 {
  "id": "v:pp3u10-3:figure-1",
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
     "x": 2.94,
     "y": -4.05,
     "label": "A",
     "step": 2
    },
    {
     "type": "point",
     "x": -2.94,
     "y": -4.05,
     "label": "B",
     "step": 2
    },
    {
     "type": "point",
     "x": -4.76,
     "y": 1.55,
     "label": "C",
     "step": 2
    },
    {
     "type": "point",
     "x": 0,
     "y": 5,
     "label": "D",
     "step": 2
    },
    {
     "type": "point",
     "x": 4.76,
     "y": 1.55,
     "label": "E",
     "step": 2
    },
    {
     "type": "polygon",
     "points": [
      [
       2.94,
       -4.05
      ],
      [
       -2.94,
       -4.05
      ],
      [
       -4.76,
       1.55
      ],
      [
       0,
       5
      ],
      [
       4.76,
       1.55
      ]
     ],
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      0,
      5
     ],
     "to": [
      2.94,
      -4.05
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      0,
      5
     ],
     "to": [
      -2.94,
      -4.05
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      4.76,
      1.55
     ],
     "to": [
      -2.94,
      -4.05
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      4.76,
      1.55
     ],
     "to": [
      -4.76,
      1.55
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      -4.76,
      1.55
     ],
     "to": [
      2.94,
      -4.05
     ],
     "step": 4
    },
    {
     "type": "arc",
     "cx": 0,
     "cy": 0,
     "r": 5,
     "startDeg": 18,
     "endDeg": 90,
     "ticks": 1,
     "step": 5
    },
    {
     "type": "arc",
     "cx": 0,
     "cy": 0,
     "r": 5,
     "startDeg": 90,
     "endDeg": 162,
     "ticks": 1,
     "step": 5
    },
    {
     "type": "arc",
     "cx": 0,
     "cy": 0,
     "r": 5,
     "startDeg": 162,
     "endDeg": 234,
     "ticks": 1,
     "step": 5
    },
    {
     "type": "arc",
     "cx": 0,
     "cy": 0,
     "r": 5,
     "startDeg": -54,
     "endDeg": 18,
     "ticks": 1,
     "step": 5
    },
    {
     "type": "arc",
     "cx": 0,
     "cy": 0,
     "r": 5,
     "startDeg": 234,
     "endDeg": 306,
     "label": "100°",
     "step": 6
    }
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "equal",
     "prompt": "Which arcs does the figure mark as equal? Tap all of them."
    }
   ]
  },
  "caption": "A circle with pentagon ABCDE and its diagonals, and arc AB marked 100°.",
  "sourcePage": 79
 },
 {
  "id": "v:pp3u10-3:figure-2",
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
     "x": 3.28,
     "y": -3.77,
     "label": "A",
     "step": 2
    },
    {
     "type": "point",
     "x": -3.28,
     "y": -3.77,
     "label": "B",
     "step": 2
    },
    {
     "type": "point",
     "x": -5,
     "y": 0.17,
     "label": "C",
     "step": 2
    },
    {
     "type": "point",
     "x": -0.95,
     "y": 4.91,
     "label": "D",
     "step": 2
    },
    {
     "type": "point",
     "x": 4.41,
     "y": 2.35,
     "label": "E",
     "step": 2
    },
    {
     "type": "chord",
     "from": [
      3.28,
      -3.77
     ],
     "to": [
      -3.28,
      -3.77
     ],
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      -3.28,
      -3.77
     ],
     "to": [
      -5,
      0.17
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      -5,
      0.17
     ],
     "to": [
      3.28,
      -3.77
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      -3.28,
      -3.77
     ],
     "to": [
      -0.95,
      4.91
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      -0.95,
      4.91
     ],
     "to": [
      3.28,
      -3.77
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      -3.28,
      -3.77
     ],
     "to": [
      4.41,
      2.35
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      4.41,
      2.35
     ],
     "to": [
      3.28,
      -3.77
     ],
     "step": 4
    }
   ],
   "tasks": [
    {
     "name": "spot",
     "mode": "equal_angle",
     "angle": [
      "A",
      "C",
      "B"
     ],
     "prompt": "Which other angles equal ∠ACB? Tap their vertices."
    },
    {
     "name": "drag",
     "mode": "drag",
     "point": "C",
     "along": "circle",
     "angle": [
      "A",
      "C",
      "B"
     ],
     "compare": [
      [
       "A",
       "D",
       "B"
      ],
      [
       "A",
       "E",
       "B"
      ]
     ],
     "prompt": "Drag C around the circle and watch ∠ACB.",
     "question": "While C stays on the same arc, what happens to ∠ACB?",
     "options": [
      "It stays the same",
      "It gets bigger as C moves",
      "It gets smaller as C moves"
     ]
    }
   ]
  },
  "caption": "Inscribed angles C, D and E all stand on the same arc AB.",
  "sourcePage": 79
 },
 {
  "id": "v:pp3u10-3:figure-4",
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
     "x": -0.26,
     "y": 4.99,
     "label": "A",
     "step": 2
    },
    {
     "type": "point",
     "x": -3.94,
     "y": 3.08,
     "label": "C",
     "step": 2
    },
    {
     "type": "point",
     "x": -2.94,
     "y": -4.05,
     "label": "D",
     "step": 2
    },
    {
     "type": "point",
     "x": 2.87,
     "y": -4.1,
     "label": "B",
     "step": 2
    },
    {
     "type": "chord",
     "from": [
      -0.26,
      4.99
     ],
     "to": [
      -2.94,
      -4.05
     ],
     "ticks": 1,
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      -0.26,
      4.99
     ],
     "to": [
      2.87,
      -4.1
     ],
     "ticks": 1,
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      -2.94,
      -4.05
     ],
     "to": [
      2.87,
      -4.1
     ],
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      -3.94,
      3.08
     ],
     "to": [
      -2.94,
      -4.05
     ],
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      -3.94,
      3.08
     ],
     "to": [
      2.87,
      -4.1
     ],
     "step": 3
    },
    {
     "type": "angle",
     "at": [
      -2.94,
      -4.05
     ],
     "fromDeg": 0,
     "toDeg": 73,
     "label": "70°",
     "step": 4
    },
    {
     "type": "angle",
     "at": [
      2.87,
      -4.1
     ],
     "fromDeg": 133.5,
     "toDeg": 180,
     "label": "20°",
     "step": 4
    }
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "equal",
     "prompt": "Which chords does the figure mark as equal? Tap all of them."
    }
   ]
  },
  "caption": "A circle with points A, B, C, D; chords AD and AB are marked equal, with 70° at D and 20° at B.",
  "sourcePage": 80
 },
 {
  "id": "v:pp3u10-3:figure-6",
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
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "equal",
     "prompt": "Which chords does the figure mark as equal? Tap all of them."
    }
   ]
  },
  "caption": "Chords AB and CD cross at E with EA and ED marked equal; DA and BC are joined.",
  "sourcePage": 80
 },
 {
  "id": "v:pp3u10-3:figure-10",
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
     "x": -2.17,
     "y": 4.5,
     "label": "E",
     "step": 2
    },
    {
     "type": "point",
     "x": 2.83,
     "y": 4.12,
     "label": "B",
     "step": 2
    },
    {
     "type": "point",
     "x": -5,
     "y": 0.22,
     "label": "F",
     "step": 2
    },
    {
     "type": "point",
     "x": -1.71,
     "y": -4.7,
     "label": "D",
     "step": 2
    },
    {
     "type": "point",
     "x": -0.64,
     "y": -4.96,
     "label": "C",
     "step": 2
    },
    {
     "type": "point",
     "x": 3.89,
     "y": -3.15,
     "label": "A",
     "step": 2
    },
    {
     "type": "chord",
     "from": [
      -2.17,
      4.5
     ],
     "to": [
      -5,
      0.22
     ],
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      -2.17,
      4.5
     ],
     "to": [
      -1.71,
      -4.7
     ],
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      2.83,
      4.12
     ],
     "to": [
      -0.64,
      -4.96
     ],
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      2.83,
      4.12
     ],
     "to": [
      3.89,
      -3.15
     ],
     "step": 3
    },
    {
     "type": "arc",
     "cx": 0,
     "cy": 0,
     "r": 5,
     "startDeg": 177.5,
     "endDeg": 250,
     "ticks": 2,
     "step": 4
    },
    {
     "type": "arc",
     "cx": 0,
     "cy": 0,
     "r": 5,
     "startDeg": 262.6,
     "endDeg": 321,
     "ticks": 2,
     "step": 4
    },
    {
     "type": "angle",
     "at": [
      -2.17,
      4.5
     ],
     "fromDeg": 236.5,
     "toDeg": 272.9,
     "label": "30°",
     "step": 5
    },
    {
     "type": "angle",
     "at": [
      2.83,
      4.12
     ],
     "fromDeg": 249,
     "toDeg": 278.2,
     "label": "(5x − 40)°",
     "step": 5
    }
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "equal",
     "prompt": "Which arcs does the figure mark as equal? Tap all of them."
    }
   ]
  },
  "caption": "Arcs FD and CA are marked equal; 30° is at E and (5x − 40)° is at B.",
  "sourcePage": 82
 },
 {
  "id": "v:pp3u10-3:figure-11",
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
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "parallel",
     "prompt": "Which chords are marked parallel? Tap all of them."
    }
   ]
  },
  "caption": "Parallel chords BA and DC, with (3y − 5)° at E and arc AC marked 50°.",
  "sourcePage": 82
 },
 {
  "id": "v:pp3u10-3:figure-13",
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
     "x": -2.87,
     "y": -4.1,
     "label": "B",
     "step": 2
    },
    {
     "type": "point",
     "x": 2.87,
     "y": -4.1,
     "label": "A",
     "step": 2
    },
    {
     "type": "point",
     "x": -0.47,
     "y": 4.98,
     "label": "E",
     "step": 2
    },
    {
     "type": "point",
     "x": 0.47,
     "y": 4.98,
     "label": "D",
     "step": 2
    },
    {
     "type": "point",
     "x": 0,
     "y": 6.7,
     "label": "C",
     "step": 2
    },
    {
     "type": "segment",
     "from": [
      -2.87,
      -4.1
     ],
     "to": [
      -0.47,
      4.98
     ],
     "ticks": 1,
     "step": 3
    },
    {
     "type": "segment",
     "from": [
      2.87,
      -4.1
     ],
     "to": [
      0.47,
      4.98
     ],
     "ticks": 1,
     "step": 3
    },
    {
     "type": "segment",
     "from": [
      -0.47,
      4.98
     ],
     "to": [
      0,
      6.7
     ],
     "step": 4
    },
    {
     "type": "segment",
     "from": [
      0.47,
      4.98
     ],
     "to": [
      0,
      6.7
     ],
     "step": 4
    },
    {
     "type": "segment",
     "from": [
      -2.87,
      -4.1
     ],
     "to": [
      2.87,
      -4.1
     ],
     "step": 4
    }
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "equal",
     "prompt": "Which sides or segments does the figure mark as equal? Tap all of them."
    }
   ]
  },
  "caption": "Equal chords AD and BE meet when extended at C outside the circle.",
  "sourcePage": 83
 },
 {
  "id": "v:pp3u10-3:figure-14",
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
     "x": -2.9,
     "y": 4.46,
     "label": "D",
     "step": 2
    },
    {
     "type": "point",
     "x": 2.2,
     "y": 4.5,
     "label": "A",
     "step": 2
    },
    {
     "type": "point",
     "x": -3.6,
     "y": -3.5,
     "label": "B",
     "step": 2
    },
    {
     "type": "point",
     "x": 2,
     "y": -4.58,
     "label": "C",
     "step": 2
    },
    {
     "type": "point",
     "x": -0.73,
     "y": 0.46,
     "label": "E",
     "step": 2
    },
    {
     "type": "segment",
     "from": [
      -2.9,
      4.46
     ],
     "to": [
      -0.73,
      0.46
     ],
     "ticks": 1,
     "step": 3
    },
    {
     "type": "segment",
     "from": [
      -0.73,
      0.46
     ],
     "to": [
      2,
      -4.58
     ],
     "step": 3
    },
    {
     "type": "segment",
     "from": [
      2.2,
      4.5
     ],
     "to": [
      -0.73,
      0.46
     ],
     "step": 3
    },
    {
     "type": "segment",
     "from": [
      -0.73,
      0.46
     ],
     "to": [
      -3.6,
      -3.5
     ],
     "ticks": 1,
     "step": 3
    },
    {
     "type": "segment",
     "from": [
      2.2,
      4.5
     ],
     "to": [
      2,
      -4.58
     ],
     "step": 4
    }
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "equal",
     "prompt": "Which sides or segments does the figure mark as equal? Tap all of them."
    }
   ]
  },
  "caption": "Equal chords AB and CD cross at E, with DE and EB marked equal and AC joined.",
  "sourcePage": 83
 },
 {
  "id": "v:pp3u10-3:figure-15",
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
     "x": -3.21,
     "y": 3.83,
     "label": "C",
     "step": 2
    },
    {
     "type": "point",
     "x": 4.89,
     "y": 1.04,
     "label": "A",
     "step": 2
    },
    {
     "type": "point",
     "x": -5,
     "y": 0,
     "label": "E",
     "step": 2
    },
    {
     "type": "point",
     "x": -1.87,
     "y": -4.64,
     "label": "B",
     "step": 2
    },
    {
     "type": "chord",
     "from": [
      4.89,
      1.04
     ],
     "to": [
      -3.21,
      3.83
     ],
     "ticks": 1,
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      4.89,
      1.04
     ],
     "to": [
      -1.87,
      -4.64
     ],
     "ticks": 1,
     "step": 3
    },
    {
     "type": "chord",
     "from": [
      -5,
      0
     ],
     "to": [
      4.89,
      1.04
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      -5,
      0
     ],
     "to": [
      -1.87,
      -4.64
     ],
     "step": 4
    },
    {
     "type": "chord",
     "from": [
      -5,
      0
     ],
     "to": [
      -3.21,
      3.83
     ],
     "step": 4
    }
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "equal",
     "prompt": "Which chords does the figure mark as equal? Tap all of them."
    }
   ]
  },
  "caption": "Chords AB and AC are marked equal, with E on the circle joined to A, B and C.",
  "sourcePage": 83
 },
 {
  "id": "v:pp3u10-3:figure-16",
  "kind": "geo_scene",
  "spec": {
   "animate": "sequence",
   "elements": [
    {
     "type": "circle",
     "cx": 0,
     "cy": 0,
     "r": 4.9,
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
     "x": 3.83,
     "y": -3,
     "label": "A",
     "step": 2
    },
    {
     "type": "point",
     "x": -3.83,
     "y": -3,
     "label": "B",
     "step": 2
    },
    {
     "type": "point",
     "x": 3.2,
     "y": 3.6,
     "label": "C",
     "step": 2
    },
    {
     "type": "point",
     "x": -3.83,
     "y": 2.9,
     "label": "D",
     "step": 2
    },
    {
     "type": "polygon",
     "points": [
      [
       3.83,
       -3
      ],
      [
       -3.83,
       -3
      ],
      [
       3.2,
       3.6
      ],
      [
       -3.83,
       2.9
      ]
     ],
     "step": 3
    },
    {
     "type": "segment",
     "from": [
      3.83,
      -3
     ],
     "to": [
      -3.83,
      2.9
     ],
     "step": 4
    },
    {
     "type": "segment",
     "from": [
      -3.83,
      -3
     ],
     "to": [
      3.2,
      3.6
     ],
     "step": 4
    },
    {
     "type": "angle",
     "at": [
      3.2,
      3.6
     ],
     "fromDeg": 223,
     "toDeg": 275.5,
     "arcs": 1,
     "step": 5
    },
    {
     "type": "angle",
     "at": [
      -3.83,
      2.9
     ],
     "fromDeg": 270,
     "toDeg": 322.4,
     "arcs": 1,
     "step": 5
    }
   ],
   "tasks": [
    {
     "name": "converse",
     "mode": "drag",
     "point": "D",
     "along": "free",
     "angle": [
      "A",
      "D",
      "B"
     ],
     "compare": [
      [
       "A",
       "C",
       "B"
      ]
     ],
     "prompt": "Drag D anywhere above AB and compare ∠ADB with ∠ACB.",
     "question": "When are ∠ADB and ∠ACB equal?",
     "options": [
      "Only when D is on the circle through A, B and C",
      "Whenever D is above AB",
      "Always"
     ],
     "key": 0
    }
   ]
  },
  "caption": "Quadrilateral ABCD with both diagonals, and the angles at C and D on base AB marked equal.",
  "sourcePage": 84
 },
 {
  "id": "v:pp3u10-3:figure-17",
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
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "equal",
     "prompt": "Which sides or segments does the figure mark as equal? Tap all of them."
    }
   ]
  },
  "caption": "Quadrilateral ABCD with both diagonals, AB = AD, angle C = 50° and angle A = 80°.",
  "sourcePage": 84
 },
 {
  "id": "v:pp3u10-3:figure-18",
  "kind": "geo_scene",
  "spec": {
   "animate": "sequence",
   "elements": [
    {
     "type": "polygon",
     "points": [
      [
       1.25,
       4.2
      ],
      [
       4.35,
       4.25
      ],
      [
       6.3,
       0.25
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
     "x": 1.25,
     "y": 4.2,
     "label": "D",
     "step": 1
    },
    {
     "type": "point",
     "x": 4.35,
     "y": 4.25,
     "label": "A",
     "step": 1
    },
    {
     "type": "point",
     "x": 6.3,
     "y": 0.25,
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
      1.25,
      4.2
     ],
     "to": [
      4.35,
      4.25
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
      6.3,
      0.25
     ],
     "parallel": 1,
     "step": 2
    },
    {
     "type": "segment",
     "from": [
      4.35,
      4.25
     ],
     "to": [
      0,
      0
     ],
     "step": 3
    },
    {
     "type": "segment",
     "from": [
      1.25,
      4.2
     ],
     "to": [
      6.3,
      0.25
     ],
     "step": 3
    },
    {
     "type": "point",
     "x": 2.9,
     "y": 2.6,
     "label": "E",
     "step": 3
    },
    {
     "type": "angle",
     "at": [
      2.9,
      2.6
     ],
     "fromDeg": 136,
     "toDeg": 222,
     "label": "76°",
     "step": 4
    },
    {
     "type": "angle",
     "at": [
      6.3,
      0.25
     ],
     "fromDeg": 142,
     "toDeg": 180,
     "label": "38°",
     "step": 4
    }
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "parallel",
     "prompt": "Which sides or segments are marked parallel? Tap all of them."
    }
   ]
  },
  "caption": "Trapezium ABCD with AD parallel to BC, diagonals meeting at E, angle DEC = 76° and angle CBD = 38°.",
  "sourcePage": 84
 },
 {
  "id": "v:pp3u10-3:figure-19",
  "kind": "geo_scene",
  "spec": {
   "animate": "sequence",
   "elements": [
    {
     "type": "polygon",
     "points": [
      [
       1.1,
       5.2
      ],
      [
       5.1,
       4.4
      ],
      [
       5.4,
       0
      ],
      [
       0,
       2.4
      ]
     ],
     "step": 1
    },
    {
     "type": "point",
     "x": 1.1,
     "y": 5.2,
     "label": "D",
     "step": 1
    },
    {
     "type": "point",
     "x": 5.1,
     "y": 4.4,
     "label": "A",
     "step": 1
    },
    {
     "type": "point",
     "x": 5.4,
     "y": 0,
     "label": "B",
     "step": 1
    },
    {
     "type": "point",
     "x": 0,
     "y": 2.4,
     "label": "C",
     "step": 1
    },
    {
     "type": "segment",
     "from": [
      5.1,
      4.4
     ],
     "to": [
      0,
      2.4
     ],
     "step": 2
    },
    {
     "type": "segment",
     "from": [
      1.1,
      5.2
     ],
     "to": [
      5.4,
      0
     ],
     "step": 2
    },
    {
     "type": "point",
     "x": 3,
     "y": 3.45,
     "label": "E",
     "step": 2
    },
    {
     "type": "segment",
     "from": [
      1.1,
      5.2
     ],
     "to": [
      5.1,
      4.4
     ],
     "ticks": 2,
     "step": 3
    },
    {
     "type": "segment",
     "from": [
      0,
      2.4
     ],
     "to": [
      1.1,
      5.2
     ],
     "ticks": 1,
     "step": 3
    },
    {
     "type": "angle",
     "at": [
      1.1,
      5.2
     ],
     "fromDeg": 310,
     "toDeg": 349,
     "label": "60°",
     "step": 4
    },
    {
     "type": "angle",
     "at": [
      3,
      3.45
     ],
     "fromDeg": 305,
     "toDeg": 384,
     "label": "85°",
     "step": 4
    },
    {
     "type": "angle",
     "at": [
      5.4,
      0
     ],
     "fromDeg": 94,
     "toDeg": 131,
     "label": "25°",
     "step": 4
    }
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "equal",
     "prompt": "Which sides or segments does the figure mark as equal? Tap all of them."
    }
   ]
  },
  "caption": "Quadrilateral ABCD with diagonals meeting at E, angle D = 60°, angle AEB = 85°, angle B = 25°, DA and CD marked equal in the way shown.",
  "sourcePage": 84
 },
 {
  "id": "v:pp3u10-3:figure-20",
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
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "both",
     "prompt": "Tap every line the marks tell you something about."
    }
   ]
  },
  "caption": "Trapezium ABCD with AD parallel to BC, diagonals meeting at E, and EC and EB marked equal.",
  "sourcePage": 84
 },
 {
  "id": "v:pp3u10-3:figure-22",
  "kind": "geo_scene",
  "spec": {
   "animate": "sequence",
   "elements": [
    {
     "type": "polygon",
     "points": [
      [
       0,
       4
      ],
      [
       4,
       4
      ],
      [
       4,
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
     "x": 0,
     "y": 4,
     "label": "D",
     "step": 1
    },
    {
     "type": "point",
     "x": 4,
     "y": 4,
     "label": "A",
     "step": 1
    },
    {
     "type": "point",
     "x": 4,
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
      4,
      4
     ],
     "to": [
      4,
      0
     ],
     "ticks": 1,
     "step": 2
    },
    {
     "type": "segment",
     "from": [
      4,
      0
     ],
     "to": [
      0,
      0
     ],
     "ticks": 1,
     "step": 2
    },
    {
     "type": "angle",
     "at": [
      0,
      4
     ],
     "fromDeg": 270,
     "toDeg": 360,
     "right": true,
     "step": 3
    },
    {
     "type": "angle",
     "at": [
      4,
      4
     ],
     "fromDeg": 180,
     "toDeg": 270,
     "right": true,
     "step": 3
    },
    {
     "type": "angle",
     "at": [
      4,
      0
     ],
     "fromDeg": 90,
     "toDeg": 180,
     "right": true,
     "step": 3
    },
    {
     "type": "angle",
     "at": [
      0,
      0
     ],
     "fromDeg": 0,
     "toDeg": 90,
     "right": true,
     "step": 3
    }
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "equal",
     "prompt": "Which sides or segments does the figure mark as equal? Tap all of them."
    }
   ]
  },
  "caption": "Square ABCD with right angles at the corners and two equal sides marked.",
  "sourcePage": 84
 },
 {
  "id": "v:pp3u10-3:figure-23",
  "kind": "geo_scene",
  "spec": {
   "animate": "sequence",
   "elements": [
    {
     "type": "polygon",
     "points": [
      [
       2.25,
       2.45
      ],
      [
       6.9,
       2.45
      ],
      [
       4.6,
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
     "x": 2.25,
     "y": 2.45,
     "label": "D",
     "step": 1
    },
    {
     "type": "point",
     "x": 6.9,
     "y": 2.45,
     "label": "A",
     "step": 1
    },
    {
     "type": "point",
     "x": 4.6,
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
      2.25,
      2.45
     ],
     "to": [
      6.9,
      2.45
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
      4.6,
      0
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
      2.25,
      2.45
     ],
     "parallel": 2,
     "step": 2
    },
    {
     "type": "segment",
     "from": [
      4.6,
      0
     ],
     "to": [
      6.9,
      2.45
     ],
     "parallel": 2,
     "step": 2
    }
   ],
   "tasks": [
    {
     "name": "marks",
     "mode": "marks",
     "ask": "parallel",
     "prompt": "Which sides or segments are marked parallel? Tap all of them."
    }
   ]
  },
  "caption": "Parallelogram ABCD with both pairs of opposite sides marked parallel.",
  "sourcePage": 84
 }
];

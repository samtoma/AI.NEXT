/**
 * A snapshot of Unit 1's arrow diagrams that carry tasks (draw / function / range), copied from
 * services/extraction/compiled/prep3-parallel/pp3u1.json — the tasks as the pipeline writes them at compile
 * (services/extraction/figure_tasks.py arrow_tasks) — so the harness needs no database. One copy per figure.
 * Regenerate it after the book is recompiled.
 */
import type { StoredFigure } from "@/components/student/figures/InteractiveFigure";

export const PP3U1_ARROW_FIGURES: StoredFigure[] = [
 {
  "id": "v:pp3u1-1:figure-2",
  "kind": "arrow_map",
  "spec": {
   "X": [
    1,
    2
   ],
   "Y": [
    3,
    4,
    5
   ],
   "pairs": [
    [
     1,
     3
    ],
    [
     1,
     4
    ],
    [
     1,
     5
    ],
    [
     2,
     3
    ],
    [
     2,
     4
    ],
    [
     2,
     5
    ]
   ],
   "animate": "arrows",
   "tasks": [
    {
     "name": "draw",
     "mode": "arrows",
     "prompt": "Draw X × Y as an arrow diagram: an arrow from every element of X to every element of Y."
    }
   ]
  },
  "caption": "Every element of X = {1, 2} has an arrow to every element of Y = {3, 4, 5}, giving the 6 pairs of X × Y.",
  "sourcePage": 10
 },
 {
  "id": "v:pp3u1-1:figure-4",
  "kind": "arrow_map",
  "spec": {
   "X": [
    3,
    4,
    8
   ],
   "Y": [
    3,
    4,
    8
   ],
   "pairs": [
    [
     3,
     3
    ],
    [
     3,
     4
    ],
    [
     3,
     8
    ],
    [
     4,
     3
    ],
    [
     4,
     4
    ],
    [
     4,
     8
    ],
    [
     8,
     3
    ],
    [
     8,
     4
    ],
    [
     8,
     8
    ]
   ],
   "animate": "arrows",
   "tasks": [
    {
     "name": "draw",
     "mode": "arrows",
     "prompt": "Draw X × X as an arrow diagram: an arrow from every element of X to every element of X."
    }
   ]
  },
  "caption": "Each of 3, 4 and 8 is paired with every element of the same set, giving all 9 pairs of X × X.",
  "sourcePage": 10
 },
 {
  "id": "v:pp3u1-2:figure-3",
  "kind": "arrow_map",
  "spec": {
   "X": [
    "-1",
    "1",
    "2"
   ],
   "Y": [
    "2",
    "4",
    "6",
    "8"
   ],
   "pairs": [
    [
     "-1",
     "2"
    ],
    [
     "1",
     "6"
    ],
    [
     "2",
     "8"
    ]
   ],
   "animate": "arrows",
   "tasks": [
    {
     "name": "draw",
     "mode": "arrows",
     "prompt": "Draw the relation {(−1, 2), (1, 6), (2, 8)} as an arrow diagram: one arrow for each pair."
    }
   ]
  },
  "caption": "Arrow diagram of b = 2a + 4: −1 goes to 2, 1 goes to 6, 2 goes to 8.",
  "sourcePage": 14
 },
 {
  "id": "v:pp3u1-2:figure-5",
  "kind": "arrow_map",
  "spec": {
   "X": [
    "-2",
    "-1",
    "0",
    "1",
    "2"
   ],
   "Y": [
    "-2",
    "-1",
    "0",
    "1",
    "2"
   ],
   "pairs": [
    [
     "-2",
     "2"
    ],
    [
     "2",
     "-2"
    ],
    [
     "-1",
     "1"
    ],
    [
     "1",
     "-1"
    ],
    [
     "0",
     "0"
    ]
   ],
   "animate": "arrows",
   "tasks": [
    {
     "name": "draw",
     "mode": "arrows",
     "prompt": "Draw the relation {(−2, 2), (2, −2), (−1, 1), (1, −1), (0, 0)} as an arrow diagram: one arrow for each pair."
    }
   ]
  },
  "caption": "Arrow diagram of R on X: 0 maps to itself, and −1↔1 and −2↔2 are linked both ways.",
  "sourcePage": 14
 },
 {
  "id": "v:pp3u1-3:figure-2",
  "kind": "arrow_map",
  "spec": {
   "X": [
    3,
    4,
    5,
    6
   ],
   "Y": [
    3,
    4,
    5,
    6
   ],
   "pairs": [
    [
     3,
     3
    ],
    [
     4,
     5
    ],
    [
     5,
     4
    ],
    [
     6,
     5
    ]
   ],
   "animate": "arrows",
   "tasks": [
    {
     "name": "draw",
     "mode": "arrows",
     "prompt": "Draw the relation {(3, 3), (4, 5), (5, 4), (6, 5)} as an arrow diagram: one arrow for each pair."
    },
    {
     "name": "function",
     "mode": "verdict",
     "prompt": "Is this relation a function on X?"
    },
    {
     "name": "range",
     "mode": "range",
     "prompt": "Tap every element an arrow points to: together they are the range."
    }
   ]
  },
  "caption": "Each of 3, 4, 5, 6 has exactly one arrow: 3→3, 4→5, 5→4, 6→5.",
  "sourcePage": 17
 },
 {
  "id": "v:pp3u1-3:figure-10",
  "kind": "arrow_map",
  "spec": {
   "X": [
    -1,
    2,
    3
   ],
   "Y": [
    2,
    3,
    5,
    7
   ],
   "pairs": [
    [
     -1,
     3
    ],
    [
     2,
     7
    ],
    [
     3,
     5
    ]
   ],
   "animate": "arrows",
   "tasks": [
    {
     "name": "draw",
     "mode": "arrows",
     "prompt": "Draw the relation {(−1, 3), (2, 7), (3, 5)} as an arrow diagram: one arrow for each pair."
    },
    {
     "name": "function",
     "mode": "verdict",
     "prompt": "Is this relation a function from X to Y?"
    },
    {
     "name": "range",
     "mode": "range",
     "prompt": "Tap every element of Y that an arrow reaches: together they are the range."
    }
   ]
  },
  "caption": "f maps X = {-1, 2, 3} into Y = {2, 3, 5, 7}: -1→3, 2→7, 3→5.",
  "sourcePage": 17
 },
 {
  "id": "v:pp3u1-3:figure-11",
  "kind": "arrow_map",
  "spec": {
   "X": [
    2,
    3,
    4
   ],
   "Y": [
    2,
    3,
    4,
    5,
    6,
    7,
    8
   ],
   "pairs": [
    [
     2,
     4
    ],
    [
     3,
     6
    ],
    [
     4,
     8
    ]
   ],
   "animate": "arrows",
   "tasks": [
    {
     "name": "draw",
     "mode": "arrows",
     "prompt": "Draw the relation {(2, 4), (3, 6), (4, 8)} as an arrow diagram: one arrow for each pair."
    },
    {
     "name": "function",
     "mode": "verdict",
     "prompt": "Is this relation a function from X to Y?"
    },
    {
     "name": "range",
     "mode": "range",
     "prompt": "Tap every element of Y that an arrow reaches: together they are the range."
    }
   ]
  },
  "caption": "R maps X = {2, 3, 4} into Y = {2,…,8}: 2→4, 3→6, 4→8.",
  "sourcePage": 18
 }
];

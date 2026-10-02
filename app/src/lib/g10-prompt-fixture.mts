/**
 * A SMALL GRADE 10 COURSE, for proving the tutor's Grade 10 prompts before the
 * real book is extracted (feature 003, WP-E; FR-4205, FR-4212).
 *
 * Five lessons of the Grade 10 American Mathematics course
 * (`course:us-g10-math-en`), shaped the way the pipeline hands a G10 bundle to
 * the app (`specs/003-curriculum-tracks/contracts/pipeline-handoff.md`):
 *
 *   · 1.3 — G0's merge P3a: ONE lesson covering sections 1.2 and 1.3, titled
 *     "Rational and irrational numbers";
 *   · 1.7 Factorisation — G0's split P1a: THREE lessons, parts 1, 2 and 3 of
 *     one section (US6, decision 18; added by WP-F for T406–T410);
 *   · 6.2 Linear functions — an ordinary one-section lesson;
 *
 * each with its book provenance as the loader writes it (`G10_BOOK_SECTIONS`,
 * `course_lessons`, migration 034):
 *
 *   · the book's real source document (title, publisher, edition and the
 *     learner PDF's sha256, from `services/extraction/manifest/g10-math-american.json`);
 *   · `program:us-american-en`, the course `part_of` it, chapters as modules
 *     (`module:g10m-cNN`), lessons as numbered sections (`g10m<ch>s<sec>-<part>`),
 *     objectives `lo:g10m<ch>s<sec>-<part>-<n>` whose `syllabus_ref` is the
 *     printed section number (pipeline spec §3.4);
 *   · book questions `…:we01` / `…:ex1-1-4a`, widget questions `…:w001`,
 *     a stored figure `v:g10m1s3-1:1`, one misconception and its refutation;
 *   · notation normalised as decision 15 says: decimal points, `(x, y)` pairs.
 *
 * The sections, titles, splits and printed pages are the book's (sections
 * 1.2–1.3, 1.7 and 6.2, as G0 cut them — `manifest/g10-math-american.json`).
 * The objectives, questions and solutions are WRITTEN FOR THIS FIXTURE, in the
 * book's style — they are not extracted, not reviewed, and never loaded into a
 * database students use. Lesson 1 has a stored figure; the others have none,
 * so the prompts' "no figure of its own" path is covered.
 *
 * Used by:
 *   · `g10-prompts.test.mts` — renders the real prompt builders over a fake
 *     client that serves exactly these rows, against committed goldens;
 *   · a scratch database, for the capture harness:
 *
 *       node --import ./scripts/ts-resolver.mjs src/lib/g10-prompt-fixture.mts <database-url>
 *
 *     which inserts these rows and nothing else. It refuses a database whose
 *     name does not say it is a scratch one, and one that already holds the
 *     course.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

import { US_G10_MATH_EN } from "./courses.ts";
import { CURRICULA } from "./curricula.ts";

export const G10_COURSE = US_G10_MATH_EN;
export const G10_PROGRAM = CURRICULA["us-american-en"].programNodeId;

export interface FixtureNode {
  id: string;
  kind: "program" | "course" | "module" | "learning_objective";
  label: string;
  description?: string | null;
  syllabus_ref?: string | null;
  order_in_parent?: number | null;
  source_page?: number | null;
  /** the spine key, on the course node only */
  subject?: string | null;
}

export interface FixtureQuestion {
  id: string;
  lo_id: string;
  tier: "basic" | "standard" | "advanced";
  question_type: "mcq" | "numeric" | "widget";
  stem: string;
  choices: unknown;
  correct_answer: string;
  canonical_solution: { step: number; text_md: string }[];
  source_page: number;
}

export const G10_SOURCE_DOCUMENT = {
  sha256: "c85561eca415a2c4288388f313e0a62a5a25fc8a21c12b7351e13866cfe4453c",
  title: "Everything Maths, Grade 10 Mathematics",
  publisher: "Siyavula Education (with volunteers)",
  edition: "Version 1.1 CAPS",
  language: "en",
  grade: "10",
  subject: "mathematics",
  file_path: "docs/Source/Gr10_Mathematics_Learner_Eng_v11.pdf",
} as const;

export const G10_NODES: readonly FixtureNode[] = [
  { id: G10_PROGRAM, kind: "program", label: "American" },
  { id: G10_COURSE, kind: "course", label: "Mathematics — Grade 10", subject: "math" },
  { id: "module:g10m-c01", kind: "module", label: "Chapter 1 — Algebraic expressions", order_in_parent: 1 },
  { id: "module:g10m-c06", kind: "module", label: "Chapter 6 — Functions", order_in_parent: 6 },
  {
    id: "lo:g10m1s3-1-1",
    kind: "learning_objective",
    label: "Classify numbers as rational or irrational",
    description:
      "A rational number can be written as $\\frac{a}{b}$ with $a$ and $b$ integers and $b \\neq 0$; its decimal form terminates or recurs. An irrational number cannot: its decimal form neither terminates nor recurs, as for $\\sqrt{2}$ and $\\pi$.",
    syllabus_ref: "1.3",
    order_in_parent: 1,
    source_page: 7,
  },
  {
    id: "lo:g10m1s3-1-2",
    kind: "learning_objective",
    label: "Convert terminating and recurring decimals to fractions",
    description:
      "Write a terminating decimal over a power of ten and simplify. For a recurring decimal, multiply by the power of ten that lines up the repeating block, then subtract to remove it.",
    syllabus_ref: "1.3",
    order_in_parent: 2,
    source_page: 9,
  },
  // The merge covers 1.2 as well: the number system (added by WP-F).
  {
    id: "lo:g10m1s3-1-3",
    kind: "learning_objective",
    label: "Name the number sets a number belongs to",
    description:
      "Every number here is real. The natural numbers sit inside the whole numbers, the whole numbers inside the integers, the integers inside the rationals; a real number that is not rational is irrational.",
    syllabus_ref: "1.3",
    order_in_parent: 3,
    source_page: 6,
  },
  {
    id: "lo:g10m1s3-1-4",
    kind: "learning_objective",
    label: "Write a recurring decimal in dot or bar notation",
    description: "A dot or a bar over the repeating block marks where the decimal recurs: $0.\\dot{3}$, $0.\\overline{142857}$.",
    syllabus_ref: "1.3",
    order_in_parent: 4,
    source_page: 10,
  },
  // 1.7 Factorisation, split in three (G0 P1a). Every part prints "1.7".
  {
    id: "lo:g10m1s7-1-1",
    kind: "learning_objective",
    label: "Take out a common factor, switching signs around in brackets",
    description:
      "Look for a factor every term shares and take it out. A bracket such as $(b - a)$ can be written $-(a - b)$ to show a common factor.",
    syllabus_ref: "1.7",
    order_in_parent: 5,
    source_page: 20,
  },
  {
    id: "lo:g10m1s7-1-2",
    kind: "learning_objective",
    label: "Factorise a difference of two squares",
    description: "$a^2 - b^2 = (a - b)(a + b)$: write each term as a square, then take the difference and the sum of the roots.",
    syllabus_ref: "1.7",
    order_in_parent: 6,
    source_page: 22,
  },
  {
    id: "lo:g10m1s7-2-1",
    kind: "learning_objective",
    label: "Factorise a quadratic trinomial $x^2 + bx + c$",
    description:
      "Find two numbers whose product is $c$ and whose sum is $b$; they are the constants in the two brackets.",
    syllabus_ref: "1.7",
    order_in_parent: 7,
    source_page: 25,
  },
  {
    id: "lo:g10m1s7-2-2",
    kind: "learning_objective",
    label: "Factorise a quadratic trinomial $ax^2 + bx + c$ with $a \\neq 1$",
    description:
      "Try pairs of factors of $a$ and of $c$ in the two brackets, and check that the inner and outer products add to $bx$.",
    syllabus_ref: "1.7",
    order_in_parent: 8,
    source_page: 26,
  },
  {
    id: "lo:g10m1s7-3-1",
    kind: "learning_objective",
    label: "Factorise a difference of two cubes",
    description: "$a^3 - b^3 = (a - b)(a^2 + ab + b^2)$.",
    syllabus_ref: "1.7",
    order_in_parent: 9,
    source_page: 28,
  },
  {
    id: "lo:g10m1s7-3-2",
    kind: "learning_objective",
    label: "Factorise a sum of two cubes",
    description: "$a^3 + b^3 = (a + b)(a^2 - ab + b^2)$.",
    syllabus_ref: "1.7",
    order_in_parent: 10,
    source_page: 29,
  },
  {
    id: "lo:g10m6s2-1-1",
    kind: "learning_objective",
    label: "Read the gradient and $y$-intercept from $y = mx + c$",
    description:
      "In $y = mx + c$, $m$ is the gradient (the change in $y$ for each increase of $1$ in $x$) and $c$ is the $y$-intercept (where the graph cuts the $y$-axis).",
    syllabus_ref: "6.2",
    order_in_parent: 1,
    source_page: 150,
  },
  {
    id: "lo:g10m6s2-1-2",
    kind: "learning_objective",
    label: "Sketch a straight-line graph from its intercepts",
    description:
      "Find the $y$-intercept by setting $x = 0$ and the $x$-intercept by setting $y = 0$, plot both points and draw the line through them.",
    syllabus_ref: "6.2",
    order_in_parent: 2,
    source_page: 152,
  },
];

export const G10_EDGES: readonly { src: string; dst: string; type: string }[] = [
  { src: G10_COURSE, dst: G10_PROGRAM, type: "part_of" },
  { src: "module:g10m-c01", dst: G10_COURSE, type: "part_of" },
  { src: "module:g10m-c06", dst: G10_COURSE, type: "part_of" },
  { src: "module:g10m-c01", dst: "lo:g10m1s3-1-1", type: "teaches" },
  { src: "module:g10m-c01", dst: "lo:g10m1s3-1-2", type: "teaches" },
  { src: "module:g10m-c01", dst: "lo:g10m1s3-1-3", type: "teaches" },
  { src: "module:g10m-c01", dst: "lo:g10m1s3-1-4", type: "teaches" },
  { src: "module:g10m-c01", dst: "lo:g10m1s7-1-1", type: "teaches" },
  { src: "module:g10m-c01", dst: "lo:g10m1s7-1-2", type: "teaches" },
  { src: "module:g10m-c01", dst: "lo:g10m1s7-2-1", type: "teaches" },
  { src: "module:g10m-c01", dst: "lo:g10m1s7-2-2", type: "teaches" },
  { src: "module:g10m-c01", dst: "lo:g10m1s7-3-1", type: "teaches" },
  { src: "module:g10m-c01", dst: "lo:g10m1s7-3-2", type: "teaches" },
  { src: "module:g10m-c06", dst: "lo:g10m6s2-1-1", type: "teaches" },
  { src: "module:g10m-c06", dst: "lo:g10m6s2-1-2", type: "teaches" },
  { src: "lo:g10m1s3-1-1", dst: "lo:g10m1s3-1-2", type: "prerequisite_of" },
  // the book's own edges inside two of 1.7's parts. Part n-1 → part n is NOT
  // here: the product derives it from `G10_BOOK_SECTIONS` (FR-4317).
  { src: "lo:g10m1s7-2-1", dst: "lo:g10m1s7-2-2", type: "prerequisite_of" },
  { src: "lo:g10m1s7-3-1", dst: "lo:g10m1s7-3-2", type: "prerequisite_of" },
];

/**
 * Every fixture lesson's book provenance, as the loader writes it to
 * `course_lessons` (migration 034; T404): the merge P3a, the three parts of
 * 1.7 (P1a) and an ordinary section — titles as printed.
 */
export const G10_BOOK_SECTIONS: readonly {
  course_id: string;
  lesson_slug: string;
  title: string;
  sections: readonly string[];
  section_titles: readonly string[];
  part_n: number | null;
  part_of: number | null;
  chapter_intro: boolean;
  group_key: string;
}[] = [
  {
    course_id: G10_COURSE,
    lesson_slug: "g10m1s3-1",
    title: "Rational and irrational numbers",
    sections: ["1.2", "1.3"],
    section_titles: ["The real number system", "Rational and irrational numbers"],
    part_n: null,
    part_of: null,
    chapter_intro: false,
    group_key: "1.3",
  },
  ...[1, 2, 3].map((n) => ({
    course_id: G10_COURSE,
    lesson_slug: `g10m1s7-${n}`,
    title: "Factorisation",
    sections: ["1.7"],
    section_titles: ["Factorisation"],
    part_n: n,
    part_of: 3,
    chapter_intro: false,
    group_key: "1.7",
  })),
  {
    course_id: G10_COURSE,
    lesson_slug: "g10m6s2-1",
    title: "Linear functions",
    sections: ["6.2"],
    section_titles: ["Linear functions"],
    part_n: null,
    part_of: null,
    chapter_intro: false,
    group_key: "6.2",
  },
];

export const G10_MISCONCEPTION = {
  id: "mc:g10m1s3-1-1:every-root-irrational",
  lo_id: "lo:g10m1s3-1-1",
  label: "Every root is irrational",
  description:
    "Treats any number written with a root sign as irrational, so calls $\\sqrt{4}$ or $\\sqrt{9}$ irrational without simplifying it first.",
  signal: "Chose $\\sqrt{4}$ as the irrational number.",
} as const;

export const G10_QUESTIONS: readonly FixtureQuestion[] = [
  {
    id: "q:g10m1s3-1-1:we01",
    lo_id: "lo:g10m1s3-1-1",
    tier: "basic",
    question_type: "mcq",
    stem: "Which of the following numbers is irrational?",
    choices: [
      { key: "A", text: "$\\sqrt{4}$", misconception_id: G10_MISCONCEPTION.id },
      { key: "B", text: "$\\sqrt{2}$" },
      { key: "C", text: "$\\frac{5}{3}$" },
      { key: "D", text: "$0.75$" },
    ],
    correct_answer: "B",
    canonical_solution: [
      { step: 1, text_md: "A number is rational if it can be written as $\\frac{a}{b}$ with $a$ and $b$ integers and $b \\neq 0$." },
      { step: 2, text_md: "$\\sqrt{4} = 2 = \\frac{2}{1}$, $\\frac{5}{3}$ and $0.75 = \\frac{3}{4}$ can all be written that way, so they are rational." },
      { step: 3, text_md: "$\\sqrt{2} = 1.4142\\ldots$ neither terminates nor recurs, so it cannot be written as $\\frac{a}{b}$: $\\sqrt{2}$ is irrational." },
    ],
    source_page: 8,
  },
  {
    id: "q:g10m1s3-1-1:w001",
    lo_id: "lo:g10m1s3-1-1",
    tier: "standard",
    question_type: "widget",
    stem: "Simplify, then mark $\\frac{-6}{3}$ and $\\frac{9}{3}$ on the number line.",
    choices: {
      kind: "number_line_marker",
      spec: { mode: "points", range: [-6, 6], targets: [-2, 3] },
      diagnostics: [],
    },
    correct_answer: "ok",
    canonical_solution: [
      { step: 1, text_md: "$\\frac{-6}{3} = -2$ and $\\frac{9}{3} = 3$." },
      { step: 2, text_md: "Both are integers, and every integer is rational: $-2 = \\frac{-2}{1}$ and $3 = \\frac{3}{1}$." },
    ],
    source_page: 8,
  },
  {
    id: "q:g10m1s3-1-2:ex1-1-4a",
    lo_id: "lo:g10m1s3-1-2",
    tier: "standard",
    question_type: "numeric",
    stem: "Write $0.\\dot{5}$ as a fraction in its simplest form.",
    choices: null,
    correct_answer: "5/9",
    canonical_solution: [
      { step: 1, text_md: "Let $x = 0.555\\ldots$" },
      { step: 2, text_md: "Multiply by $10$: $10x = 5.555\\ldots$" },
      { step: 3, text_md: "Subtract: $10x - x = 5.555\\ldots - 0.555\\ldots$, so $9x = 5$." },
      { step: 4, text_md: "$x = \\frac{5}{9}$." },
    ],
    source_page: 11,
  },
  {
    id: "q:g10m1s7-1-2:we01",
    lo_id: "lo:g10m1s7-1-2",
    tier: "basic",
    question_type: "mcq",
    stem: "Factorise $x^2 - 9$.",
    choices: [
      { key: "A", text: "$(x - 3)^2$" },
      { key: "B", text: "$(x - 3)(x + 3)$" },
      { key: "C", text: "$(x + 3)^2$" },
      { key: "D", text: "$(x - 9)(x + 1)$" },
    ],
    correct_answer: "B",
    canonical_solution: [
      { step: 1, text_md: "$x^2 - 9$ is a difference of two squares: $x^2 - 3^2$." },
      { step: 2, text_md: "$a^2 - b^2 = (a - b)(a + b)$ with $a = x$ and $b = 3$." },
      { step: 3, text_md: "So $x^2 - 9 = (x - 3)(x + 3)$." },
    ],
    source_page: 22,
  },
  {
    id: "q:g10m1s7-2-1:we01",
    lo_id: "lo:g10m1s7-2-1",
    tier: "basic",
    question_type: "mcq",
    stem: "Factorise $x^2 + 5x + 6$.",
    choices: [
      { key: "A", text: "$(x + 1)(x + 6)$" },
      { key: "B", text: "$(x + 2)(x + 3)$" },
      { key: "C", text: "$(x - 2)(x - 3)$" },
      { key: "D", text: "$(x + 5)(x + 1)$" },
    ],
    correct_answer: "B",
    canonical_solution: [
      { step: 1, text_md: "Look for two numbers whose product is $6$ and whose sum is $5$." },
      { step: 2, text_md: "$2 \\times 3 = 6$ and $2 + 3 = 5$." },
      { step: 3, text_md: "So $x^2 + 5x + 6 = (x + 2)(x + 3)$." },
    ],
    source_page: 25,
  },
  {
    id: "q:g10m1s7-3-1:we01",
    lo_id: "lo:g10m1s7-3-1",
    tier: "basic",
    question_type: "mcq",
    stem: "Factorise $x^3 - 8$.",
    choices: [
      { key: "A", text: "$(x - 2)(x^2 + 2x + 4)$" },
      { key: "B", text: "$(x - 2)^3$" },
      { key: "C", text: "$(x - 2)(x^2 - 2x + 4)$" },
      { key: "D", text: "$(x + 2)(x^2 - 2x + 4)$" },
    ],
    correct_answer: "A",
    canonical_solution: [
      { step: 1, text_md: "$x^3 - 8 = x^3 - 2^3$ is a difference of two cubes." },
      { step: 2, text_md: "$a^3 - b^3 = (a - b)(a^2 + ab + b^2)$ with $a = x$ and $b = 2$." },
      { step: 3, text_md: "So $x^3 - 8 = (x - 2)(x^2 + 2x + 4)$." },
    ],
    source_page: 28,
  },
  {
    id: "q:g10m6s2-1-1:we01",
    lo_id: "lo:g10m6s2-1-1",
    tier: "basic",
    question_type: "mcq",
    stem: "What is the gradient of the graph of $y = -2x + 3$?",
    choices: [
      { key: "A", text: "$3$" },
      { key: "B", text: "$-2$" },
      { key: "C", text: "$2$" },
      { key: "D", text: "$\\frac{3}{2}$" },
    ],
    correct_answer: "B",
    canonical_solution: [
      { step: 1, text_md: "The equation is in the form $y = mx + c$." },
      { step: 2, text_md: "Comparing the two, $m = -2$ and $c = 3$." },
      { step: 3, text_md: "The gradient is $m = -2$." },
    ],
    source_page: 151,
  },
  {
    id: "q:g10m6s2-1-2:w001",
    lo_id: "lo:g10m6s2-1-2",
    tier: "standard",
    question_type: "widget",
    stem: "Draw the graph of $y = 2x - 1$.",
    choices: { kind: "line_drawer", spec: { mode: "equation", m: 2, b: -1 }, diagnostics: [] },
    correct_answer: "ok",
    canonical_solution: [
      { step: 1, text_md: "The $y$-intercept is $c = -1$, so the line passes through $(0, -1)$." },
      { step: 2, text_md: "The gradient is $2$: from $(0, -1)$ move $1$ right and $2$ up, to $(1, 1)$." },
      { step: 3, text_md: "Draw the straight line through $(0, -1)$ and $(1, 1)$." },
    ],
    source_page: 153,
  },
  {
    id: "q:g10m6s2-1-2:w002",
    lo_id: "lo:g10m6s2-1-2",
    tier: "standard",
    question_type: "widget",
    stem: "Sketch the graph of $y = -x + 2$.",
    choices: { kind: "curve_sketcher", spec: { fn: "linear", coefs: [-1, 2] }, diagnostics: [] },
    correct_answer: "ok",
    canonical_solution: [
      { step: 1, text_md: "$y$-intercept: set $x = 0$, so $y = 2$ — the point $(0, 2)$." },
      { step: 2, text_md: "$x$-intercept: set $y = 0$, so $x = 2$ — the point $(2, 0)$." },
      { step: 3, text_md: "Draw the straight line through $(0, 2)$ and $(2, 0)$." },
    ],
    source_page: 154,
  },
];

export const G10_VISUALS = [
  {
    id: "v:g10m1s3-1:1",
    lo_id: "lo:g10m1s3-1-1",
    kind: "number_line",
    spec: { range: [0, 3], points: [{ x: 1.41, label: "√2" }], animate: "sweep" },
    caption: "Where √2 sits: between 1.41 and 1.42, and its decimals never stop and never repeat.",
    source_page: 8,
  },
] as const;

export const G10_REFUTATION = {
  id: `expl:${G10_MISCONCEPTION.id}`,
  lo_id: G10_MISCONCEPTION.lo_id,
  misconception_id: G10_MISCONCEPTION.id,
  entry_type: "refutation",
  content: [
    { step: 1, text_md: "A root sign on its own does not make a number irrational." },
    { step: 2, text_md: "Simplify first: $\\sqrt{4} = 2$, and $2 = \\frac{2}{1}$ is rational." },
    { step: 3, text_md: "Only a root that does not simplify to a fraction, like $\\sqrt{2}$, is irrational." },
  ],
  source_page: 8,
} as const;

/** The fixture's lessons, in the book's order. */
export const G10_LESSONS = ["g10m1s3-1", "g10m1s7-1", "g10m1s7-2", "g10m1s7-3", "g10m6s2-1"] as const;

/** Who stamps the fixture rows — never a reviewer. */
const FIXTURE_TAG = "g10-prompt-fixture (feature 003, WP-E) — not extracted, not reviewed";

type Query = (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * Insert the fixture into a database built by the migrations. Adds rows only,
 * and refuses when the course is already there.
 */
export async function loadG10Fixture(query: Query): Promise<void> {
  const present = await query(`SELECT 1 FROM graph_nodes WHERE id = $1`, [G10_COURSE]);
  if (present.rows.length > 0) throw new Error(`${G10_COURSE} is already loaded here — refusing`);
  const d = G10_SOURCE_DOCUMENT;
  await query(
    `INSERT INTO source_documents (sha256, title, publisher, edition, language, grade, subject, file_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (sha256) DO NOTHING`,
    [d.sha256, d.title, d.publisher, d.edition, d.language, d.grade, d.subject, d.file_path]
  );
  for (const n of G10_NODES) {
    await query(
      `INSERT INTO graph_nodes (id, kind, label, description, syllabus_ref, order_in_parent, source_page, subject, source_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
      [
        n.id,
        n.kind,
        n.label,
        n.description ?? null,
        n.syllabus_ref ?? null,
        n.order_in_parent ?? null,
        n.source_page ?? null,
        n.subject ?? null,
        n.kind === "program" ? null : d.sha256,
      ]
    );
  }
  for (const e of G10_EDGES) {
    await query(
      `INSERT INTO graph_edges (src_id, dst_id, edge_type, syllabus_version) VALUES ($1, $2, $3, 'g10-fixture')`,
      [e.src, e.dst, e.type]
    );
  }
  const m = G10_MISCONCEPTION;
  await query(
    `INSERT INTO misconceptions (id, lo_id, label, description, signal, generated_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [m.id, m.lo_id, m.label, m.description, m.signal, FIXTURE_TAG]
  );
  for (const q of G10_QUESTIONS) {
    await query(
      `INSERT INTO questions (id, lo_id, tier, question_type, stem, choices, correct_answer,
                              canonical_solution, solution_version, status, source, source_sha256, source_page, source_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 'live', 'seed', $9, $10, $11)`,
      [
        q.id,
        q.lo_id,
        q.tier,
        q.question_type,
        q.stem,
        q.choices == null ? null : JSON.stringify(q.choices),
        q.correct_answer,
        JSON.stringify(q.canonical_solution),
        d.sha256,
        q.source_page,
        FIXTURE_TAG,
      ]
    );
  }
  for (const v of G10_VISUALS) {
    await query(
      `INSERT INTO visuals (id, lo_id, kind, spec, caption, source_page) VALUES ($1, $2, $3, $4, $5, $6)`,
      [v.id, v.lo_id, v.kind, JSON.stringify(v.spec), v.caption, v.source_page]
    );
  }
  const r = G10_REFUTATION;
  await query(
    `INSERT INTO explanation_library (id, lo_id, misconception_id, entry_type, content, source_page, generated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [r.id, r.lo_id, r.misconception_id, r.entry_type, JSON.stringify(r.content), r.source_page, FIXTURE_TAG]
  );
  // Book provenance (migration 034), when this database has the store. A
  // database built before 034 gets none — as the loader refuses, a split
  // section cannot be loaded there, so say so rather than half-load it.
  const store = await query(`SELECT to_regclass('public.course_lessons') IS NOT NULL AS present`);
  if (store.rows[0]?.present !== true) {
    throw new Error("course_lessons (migration 034) is missing here — apply it before loading the G10 fixture");
  }
  for (const l of G10_BOOK_SECTIONS) {
    await query(
      `INSERT INTO course_lessons (course_id, lesson_slug, title, sections, section_titles, part_n, part_of, chapter_intro, group_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [l.course_id, l.lesson_slug, l.title, [...l.sections], [...l.section_titles], l.part_n, l.part_of, l.chapter_intro, l.group_key]
    );
  }
}

/** Only as a script: load the fixture into a SCRATCH database, by URL. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.argv[2];
  if (!url) throw new Error("usage: node --import ./scripts/ts-resolver.mjs src/lib/g10-prompt-fixture.mts <database-url>");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!/(scratch|fixture|wpe)/.test(dbName)) {
    throw new Error(`refusing "${dbName}": the G10 prompt fixture loads into a scratch database only`);
  }
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await loadG10Fixture((t, v) => client.query(t, v));
    await client.query("COMMIT");
    console.log(`loaded the G10 prompt fixture into ${dbName}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

/**
 * THE COURSE REGISTRY — which books the product teaches from, and whose they
 * are (feature 003; Samuel's decisions of 2026-09-25, decisions 2 and E).
 *
 * Until 003 the subject registry (`lib/subjects.ts`) carried one `courseId`
 * per subject, and `?subject=math` therefore always meant the Prep-3 maths
 * book. A second maths course — Grade 10, American curriculum — cannot be
 * expressed that way: it is the SAME subject (English maths: the same voice,
 * widgets and grounding rules) taught from a DIFFERENT book, for a different
 * grade, in a different curriculum. So the registry is split:
 *
 *   · `lib/subjects.ts` keeps the teaching contract — voice, widgets, labels,
 *     direction, accent. What is true of maths wherever it is taught.
 *   · THIS file holds the courses — the book, the curriculum it belongs to,
 *     the grades it is written for, its school terms and whether Socratic
 *     probing may run in it. What is true of one book.
 *   · `lib/curricula.ts` holds the curricula a course can belong to.
 *
 * The rules that keep it honest, the ones `lib/subjects.ts` already keeps:
 *   1. Lookups are EXACT. An id either is a key here or it is not.
 *   2. Unknown is `null`, never a default. A course the registry does not
 *      know has no curriculum, and the gate hides it from every student
 *      (FR-4002) — it fails closed, like a course with no rule (FR-2704).
 *   3. **Every `course:` id in the app is written in this file and nowhere
 *      else** (`student-scope-guard.test.mts`). A course id written inline in
 *      a reader is how `PROBING_COURSE_ID` and `?subject=math → Prep 3` came
 *      to be; the guard fails on the next one.
 *
 * One course belongs to EXACTLY ONE curriculum (decision 2). The course gate
 * stays keyed by (course, grade) — migration 023, unchanged — and a course's
 * curriculum comes from here, so a (course, grade) rule already IS a
 * (curriculum, subject, grade) decision.
 *
 * Imports only TYPES from `lib/subjects.ts` (so there is no runtime import
 * cycle: `lib/subjects.ts` reads this file to answer "which subject does this
 * course teach") and `lib/curricula.ts`. Pure; loaded by `node --test` and by
 * client components alike.
 */
import type { Subject } from "./subjects.ts";
import type { CurriculumId } from "./curricula.ts";

/* ------------------------------------------------------------------ */
/* The ids — the ONLY place a `course:` literal may be written          */
/* ------------------------------------------------------------------ */

/** Prep-3 Mathematics, National (the book the product launched with). */
export const PREP3_MATH_EN = "course:prep3-math-en";
/** Prep-3 Social Studies, National. */
export const PREP3_SOCIAL_AR = "course:prep3-social-ar";
/** Prep-3 Arabic, National. */
export const PREP3_ARABIC_AR = "course:prep3-arabic-ar";
/**
 * Grade 10 Mathematics, American (FR-4201). The id encodes the curriculum so
 * a future National Grade-10 maths book cannot collide with it (research.md
 * §8.1). `docs/specs/extraction-pipeline.md` still shows a placeholder for it;
 * this is the id the app gates, orders and labels by.
 */
export const US_G10_MATH_EN = "course:us-g10-math-en";

/* ------------------------------------------------------------------ */
/* The shape                                                           */
/* ------------------------------------------------------------------ */

/**
 * One school-term rule of a course: modules whose id starts
 * `module:<modulePrefix>` (and lessons whose slug starts `<slugPrefix>`) are
 * taught in `term`, and sit at `rank` in the catalogue order among the
 * course's terms. A module no rule matches is in `defaultTerm` at rank 0.
 */
export interface TermRule {
  modulePrefix: string;
  slugPrefix: string;
  term: number;
  rank: number;
}

/** A course's school terms, or `null` for a book with none (FR-4203). */
export interface TermModel {
  rules: readonly TermRule[];
  defaultTerm: number;
}

export interface CourseDef {
  /** the teaching contract it is taught under (`lib/subjects.ts`) */
  subject: Subject;
  /** the one curriculum it belongs to (`lib/curricula.ts`, FR-4002) */
  curriculum: CurriculumId;
  /**
   * The school years the book is written for. INFORMATION, not a gate: what
   * a student sees is decided by the (course, grade) rules an operator
   * writes. It is what sign-up offers when the gate is switched off
   * (`offeredCurricula`, lib/catalog.ts) and what the console prints.
   */
  grades: readonly string[];
  /** the course's own name, for the console — "Mathematics — Grade 10" */
  label: string;
  /** the source book (`source_documents.title`) */
  book: string;
  /**
   * How a STUDENT surface cites the book: the check-in's band ("Ministry
   * textbook · P.7–12") and a page citation's sheet (`name`, then `edition`
   * with the page). Never the tutor's words for it — those are
   * `tutor.lessonBookName` — and never another course's: a Grade 10 student
   * is not told her pages come from a ministry textbook (FR-4205).
   */
  cite: { name: string; edition: string };
  /**
   * How the signed-in home page (`app/(student)/page.student.tsx`) words
   * where the material comes from: `source` completes "a knowledge graph
   * extracted from …", and `syllabus` sits under the prerequisite count. A
   * National student reads exactly what that page has always said (FR-4206);
   * a Grade 10 student is not told her book is the Egyptian Ministry textbook
   * or the 2025–2026 syllabus (FR-4205). `sourceWordingFor`, below, picks the
   * words for the courses she may see.
   */
  homeCopy: { source: string; syllabus: string };
  /**
   * The extraction pipeline's name for this book — its config in
   * `services/extraction/books/<pipelineBook>.json`, whose `course_id` is
   * this course's id — and so the name of its S8 coverage audit,
   * `services/extraction/coverage/<pipelineBook>.json`, which the console
   * shows beside the course's switch (FR-4309).
   */
  pipelineBook: string;
  /**
   * The school terms, or `null` when the book has none. Drives the term
   * rank of the one catalogue order (`lib/module-order.ts`) and the "Term N"
   * eyebrow of the check-in (`lib/module-term.ts`). A course without terms
   * prints no term at all (FR-4203).
   */
  terms: TermModel | null;
  /**
   * Whether Socratic probing (ADR-0021) may run in this course. Its block
   * and every live-event note are English maths strings written for the
   * Prep-3 book; #53 is open. Exactly one course may say `true`
   * (`lib/socratic-probing.ts` `PROBING_COURSE_ID`, decision 7).
   */
  probing: boolean;
  /** What the tutor is told about this course's book (below). */
  tutor: CourseTutorFacts;
}

/* ------------------------------------------------------------------ */
/* What the tutor is told about the book                               */
/* ------------------------------------------------------------------ */

/**
 * Example ids the tutor's directive documentation falls back to when a lesson
 * has none of its own (a lesson with no live question, or no stored figure).
 */
export interface ExampleIds {
  /** an objective id, without its `lo:` prefix */
  lo: string;
  /** a question id, without its `q:` prefix */
  q: string;
  /** a book page */
  page: number;
  /** a stored figure id */
  viz: string;
}

/** The citation and directive examples the Ask-the-Spine prompt shows. */
export interface AskExampleIds {
  /** `[[lo:…]]`, and the "exactly [[lo:…]]" reminder — no `lo:` prefix */
  lo: string;
  /** `[[q:…]]` — no `q:` prefix */
  q: string;
  /** `[[page:…]]` */
  page: number;
  /** `{{show_question:…}}` — with its `q:` prefix */
  showQuestion: string;
  /** `{{highlight:…}}` — two objective ids, comma-separated */
  highlight: string;
  /** `{{widget:viz_ref:…}}` */
  viz: string;
}

/**
 * THE TUTOR'S FACTS ABOUT ONE BOOK (feature 003, WP-E; ADR-0020 note of
 * 2026-09-25; FR-4205, FR-4206).
 *
 * Until 003 these were strings inside the maths prompt kit (`lib/lesson.ts`)
 * and the Ask context (`lib/ask.ts`), true of the one Prep-3 book and written
 * as if they were true of maths. A second maths book makes them wrong for
 * half the students, so they live here, per course, and the prompt builders
 * read them. The next curriculum brings its own values; it needs no new
 * prompt branch.
 *
 * `null` never means "borrow another course's value". It means the course has
 * no such fact, and the prompt takes it from the lesson's own data (its own
 * figures, questions and objectives) or leaves the line out.
 *
 * The three National entries carry EXACTLY the values the prompts printed
 * before 003 — ADR-0020's hold, proven byte for byte by the capture harness
 * (`app/scripts/capture-prompts.mts`). The Grade 10 entry is decision 10:
 * "this book" and its pages, no syllabus year, no Prep-3 figure or widget.
 */
export interface CourseTutorFacts {
  /** how the lesson data header names the book: "(school Lesson 1-1: …, <this>)" */
  lessonBookName: string;
  /** the Ask context's source line when no book row is visible to the student */
  askBookFallback: string;
  /** the word before a lesson's printed reference in the lesson data header */
  lessonRefLead: string;
  /** closes the Ask context's source line; `null` when the book prints no syllabus year */
  syllabusLine: string | null;
  /**
   * Printed lesson titles by lesson slug, for a book whose bundles carry none
   * (Prep-3 maths). `null`: the lesson's own data names it — today its first
   * objective's label, and the book-sections store once it exists (FR-4311).
   */
  lessonTitles: Readonly<Record<string, string>> | null;
  /**
   * Whether this course's lessons are named by the titles in the
   * book-sections store (`course_lessons.title`, migration 034) even though
   * none of them is a part, a merge or a promoted introduction.
   *
   * A book-shaped course (the Grade 10 book) is always named from the store
   * (`lib/section-label.ts` `shownTitles`); this is the switch for a course
   * whose lessons are each exactly one printed lesson. `true` for Prep-3
   * Arabic (Samuel's decision 13, 2026-09-25: the book's printed names, such
   * as «عِبادُ الرَّحمنِ», instead of the first objective «فهم النص والاستماع»
   * that all twenty Arabic lessons share) — an approved exception to
   * ADR-0020's prompt hold, for the lesson title and nothing else. `false`
   * for Prep-3 maths (its registry titles above win anyway) and Social
   * Studies, whose printed titles are not in the store: their prompts stay
   * byte-identical.
   */
  bookLessonTitles: boolean;
  /**
   * Whether the tutor's prompts carry their Egyptian-Arabic touches: the
   * «فهمت كله؟ حلو» review opener, the Arabic closing example, the
   * «لسه مش فاهم» name of the still-confused signal and the Arabic line of
   * the address block. `true` for every National course, whose prompts are
   * held byte-identical (ADR-0020). `false` for the Grade 10 course (Samuel's
   * decision 9, 2026-09-25: "English only" — the student is still described
   * as an Egyptian grade-10 student, but the tutor is told to write no
   * Arabic at all). Only an English-taught subject may say `false`.
   */
  arabicTouches: boolean;
  /** lesson-slug prefix of the lessons taught figure-first (geometry), or `null` */
  figureLedSlugPrefix: string | null;
  /**
   * Where a maths lesson's widget list comes from (FR-1209):
   *   · "unit-map" — the Prep-3 unit map in `lib/widget-docs.ts`, with its
   *     two-widget fallback and the product_builder review moment;
   *   · "module-questions" — the widget kinds of the live widget questions of
   *     the lesson's own unit (its module). No fallback: a unit with none is
   *     told about none.
   * `null` for a subject whose protocol names its own widgets.
   */
  lessonWidgets: "unit-map" | "module-questions" | null;
  /** example ids for a lesson with none of its own; `null`: placeholders, never another book's ids */
  exampleFallbacks: ExampleIds | null;
  /** the Ask prompt's examples; `null`: the student's own data */
  askExamples: AskExampleIds | null;
}

/**
 * Short display titles of the Prep-3 maths lessons, by slug. Moved here from
 * `lib/lesson.ts` (`LESSON_TITLES`), text unchanged: the Prep-3 bundles carry
 * no lesson titles, so the registry does.
 */
const PREP3_MATH_LESSON_TITLES: Readonly<Record<string, string>> = {
  "u1-1": "Cartesian product",
  "u1-2": "Relations",
  "u1-3": "Functions",
  "u1-4": "Polynomial functions",
  "u2-1": "Ratio",
  "u2-2": "Proportion",
  "u2-3": "Direct and inverse variation",
  "u3-1": "Collecting data and samples",
  "u3-2": "Dispersion and standard deviation",
  "u4-1": "Trigonometric ratios",
  "u4-2": "Special angles and applications",
  "u5-1": "The distance between two points",
  "u5-2": "The midpoint of a segment",
  "u5-3": "The slope of a straight line",
  "u5-4": "The equation of a straight line",
  "geo1-1": "The circle: definitions and chords",
  "geo1-2": "Point, line and circle positions — tangents",
  "geo1-3": "The circumcircle",
  "geo1-4": "Chords and distance from the center",
};

/**
 * The Ask prompt's examples as it has always printed them — for every
 * National course alike, because the Ask prompt's citation block was one
 * shared string before 003 (Social Studies and Arabic included). Frozen by
 * ADR-0020's hold, not chosen.
 */
const NATIONAL_ASK_EXAMPLES: AskExampleIds = {
  lo: "u1-4-3",
  q: "u1-4-3:002",
  page: 22,
  showQuestion: "q:u1-4-1:002",
  highlight: "lo:u1-2-1,lo:u1-3-1",
  viz: "v:geo1-2:004",
};

/** The National lesson examples before 003 — only the figure was per subject. */
const nationalExamples = (viz: string): ExampleIds => ({
  lo: "u1-1-1",
  q: "u1-1-1:001",
  page: 8,
  viz,
});

/** What the National books' prompts have always said about the book. */
const NATIONAL_BOOK = {
  lessonBookName: "Egyptian ministry textbook",
  askBookFallback: "ministry textbook",
  lessonRefLead: "school",
  syllabusLine: "Syllabus 2025–2026.",
  askExamples: NATIONAL_ASK_EXAMPLES,
  // The Egyptian-Arabic touches every National prompt has always carried
  // (ADR-0020's hold).
  arabicTouches: true,
} as const;

/** How the student surfaces have always cited a National book. */
const NATIONAL_CITE = { name: "Ministry textbook", edition: "MOETE 2025–2026" } as const;

/** What the home page has always said about a National book — text unchanged. */
const NATIONAL_HOME = {
  source: "the Egyptian Ministry textbook",
  syllabus: "syllabus 2025–2026",
} as const;

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

/**
 * ORDER MATTERS, and it is curriculum first, then subject, then course. It
 * is THE COURSE ORDER — `COURSE_RANK` in `lib/module-order.ts`, the order a
 * list of several courses is split in (FR-3217, FR-4009). The three National
 * courses keep the positions the subject registry gave them (maths, Social
 * Studies, Arabic), so every list a National student sees is ordered exactly
 * as before.
 */
export const COURSES = {
  [PREP3_MATH_EN]: {
    subject: "math-en",
    curriculum: "eg-national-en",
    grades: ["9"],
    label: "Mathematics — Prep 3",
    book: "Mathematics — Student's Book, Preparatory Year Three, First Term",
    cite: NATIONAL_CITE,
    homeCopy: NATIONAL_HOME,
    pipelineBook: "prep3-math-en",
    // Term-1 algebra, then Term-2 algebra (`module:t2-*`), then geometry
    // (`module:geo*`, which the syllabus also teaches in Term 2). THE ORDER
    // OF THESE TWO RULES IS THE TEXT OF `MODULE_ORDER`'s term rank, which
    // `catalogue-order-readers.test.mts` pins: geometry's rule first.
    terms: {
      rules: [
        { modulePrefix: "geo", slugPrefix: "geo", term: 2, rank: 2 },
        { modulePrefix: "t2-", slugPrefix: "t2", term: 2, rank: 1 },
      ],
      defaultTerm: 1,
    },
    probing: true,
    tutor: {
      ...NATIONAL_BOOK,
      lessonTitles: PREP3_MATH_LESSON_TITLES,
      bookLessonTitles: false,
      figureLedSlugPrefix: "geo",
      lessonWidgets: "unit-map",
      exampleFallbacks: nationalExamples("v:geo1-1:001"),
    },
  },
  [PREP3_SOCIAL_AR]: {
    subject: "social-ar",
    curriculum: "eg-national-en",
    grades: ["9"],
    label: "Social Studies — Prep 3",
    book: "الدراسات الاجتماعية — كتاب الطالب، الصف الثالث الإعدادي، الفصل الدراسي الأول",
    cite: NATIONAL_CITE,
    homeCopy: NATIONAL_HOME,
    pipelineBook: "prep3-social-ar",
    // No rule: every module reads Term 1, as the check-in has always printed.
    terms: { rules: [], defaultTerm: 1 },
    probing: false,
    tutor: {
      ...NATIONAL_BOOK,
      lessonTitles: null,
      bookLessonTitles: false,
      figureLedSlugPrefix: null,
      lessonWidgets: null,
      exampleFallbacks: nationalExamples("v:soc1-1:001"),
    },
  },
  [PREP3_ARABIC_AR]: {
    subject: "arabic-ar",
    curriculum: "eg-national-en",
    grades: ["9"],
    label: "Arabic — Prep 3",
    book: "اللغة العربية — كتاب الطالب، الصف الثالث الإعدادي، الفصل الدراسي الأول",
    cite: NATIONAL_CITE,
    homeCopy: NATIONAL_HOME,
    pipelineBook: "prep3-arabic-ar",
    terms: { rules: [], defaultTerm: 1 },
    probing: false,
    tutor: {
      ...NATIONAL_BOOK,
      lessonTitles: null,
      // Decision 13: the printed lesson names in the store, not the first objective.
      bookLessonTitles: true,
      figureLedSlugPrefix: null,
      lessonWidgets: null,
      exampleFallbacks: nationalExamples("v:ara1-1:001"),
    },
  },
  [US_G10_MATH_EN]: {
    subject: "math-en",
    curriculum: "us-american-en",
    grades: ["10"],
    label: "Mathematics — Grade 10",
    book: "Everything Maths — Grade 10 (Siyavula)",
    // The book's own name, never "Ministry textbook" (FR-4205; backlog #36).
    cite: { name: "Everything Maths", edition: "Siyavula · Grade 10" },
    // Its own book and no syllabus year, which the book does not print
    // (FR-4205, decision 10).
    homeCopy: {
      source: "Everything Maths, the Siyavula Grade 10 textbook",
      syllabus: "Everything Maths · Grade 10",
    },
    pipelineBook: "g10-math",
    // The book is chapters and sections, with no school terms (FR-4203).
    terms: null,
    // Decision 7: probing is off for the Grade 10 course at launch.
    probing: false,
    // Decision 10 (ADR-0020 note, 2026-09-25): "this book" and its pages; no
    // syllabus year, because the book prints none; no Prep-3 figure, widget
    // or example id; lesson titles and section numbers from the book's own
    // data (`syllabus_ref` is the printed section number, pipeline spec §3.4).
    tutor: {
      lessonBookName: "this book",
      askBookFallback: "this book",
      lessonRefLead: "section",
      syllabusLine: null,
      lessonTitles: null,
      bookLessonTitles: true,
      figureLedSlugPrefix: null,
      lessonWidgets: "module-questions",
      exampleFallbacks: null,
      askExamples: null,
      // Decision 9 (2026-09-25): English only — no Arabic phrase in any prompt.
      arabicTouches: false,
    },
  },
} as const satisfies Record<string, CourseDef>;

export type CourseId = keyof typeof COURSES;

/** Registry order — THE course order. */
export const COURSE_IDS = Object.keys(COURSES) as CourseId[];

for (const id of COURSE_IDS) {
  // Course ids are interpolated into SQL by `lib/module-order.ts`: a registry
  // constant, never input, and checked here to be a plain id so a typo cannot
  // become SQL. Same pattern the loader enforces.
  if (!/^course:[a-z0-9-]+$/.test(id)) throw new Error(`courses: unexpected course id ${id}`);
}

/* ------------------------------------------------------------------ */
/* Exact lookups                                                       */
/* ------------------------------------------------------------------ */

/** Is this string a course the registry knows? */
export function isCourseId(raw: unknown): raw is CourseId {
  return typeof raw === "string" && Object.hasOwn(COURSES, raw);
}

/** The registry entry for a course id, or `null`. */
export function courseDef(raw: unknown): CourseDef | null {
  return isCourseId(raw) ? COURSES[raw] : null;
}

/**
 * The curriculum a course belongs to, or `null` for a course the registry
 * does not know — which the gate reads as "hidden from every student"
 * (FR-4002).
 */
export function curriculumOfCourse(raw: unknown): CurriculumId | null {
  return courseDef(raw)?.curriculum ?? null;
}

/** `curriculumOfCourse`, under the name contracts/registry-and-gate.md uses. */
export const curriculumOf = curriculumOfCourse;

/** Every registry course of one curriculum, in course order. */
export function coursesOf(curriculum: CurriculumId): CourseId[] {
  return COURSE_IDS.filter((id) => COURSES[id].curriculum === curriculum);
}

/** The registry position of a course; unknown sorts after every known one. */
export function courseRank(raw: unknown): number {
  const i = isCourseId(raw) ? COURSE_IDS.indexOf(raw) : -1;
  return i < 0 ? COURSE_IDS.length : i;
}

/** Registry-order comparator for course ids (unknown last). */
export function compareCourses(a: unknown, b: unknown): number {
  return courseRank(a) - courseRank(b);
}

/* ------------------------------------------------------------------ */
/* Student-facing wording                                              */
/* ------------------------------------------------------------------ */

/**
 * When a student's courses do not agree on one book — a tester's exception
 * for another curriculum's course — or she may see none yet: words true of
 * any book, naming none.
 */
export const NEUTRAL_HOME_COPY = {
  source: "the textbooks of your own courses",
  syllabus: "from your own textbooks",
} as const;

/**
 * The home page's wording about where her material comes from, for the
 * courses she may see (FR-4205, FR-4206; the 2026-09-26 isolation audit). The
 * courses' own `homeCopy` when they all agree — every National student reads
 * the National wording, byte for byte; a Grade 10 student reads her book's —
 * and the neutral wording when they do not, or when she may see nothing yet,
 * so a page is never attributed to a book she is not using. A course the
 * registry does not know has no wording, and makes the set disagree.
 */
export function sourceWordingFor(
  courseIds: Iterable<string>
): { source: string; syllabus: string } {
  const words = new Map<string, { source: string; syllabus: string }>();
  let unknown = false;
  for (const id of courseIds) {
    const copy = courseDef(id)?.homeCopy;
    if (!copy) {
      unknown = true;
      continue;
    }
    words.set(`${copy.source}\u0000${copy.syllabus}`, copy);
  }
  if (unknown || words.size !== 1) return NEUTRAL_HOME_COPY;
  return [...words.values()][0];
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { retrieve, retrievalBlock } from "./retrieval";
import { getStudentProfile, scoped, type Db } from "./student-context";
import { addressForms, type AddressForms } from "./address";
import { sequential } from "./db";
import { deriveMasteryStage, learnOpeningFrame } from "./checkin";
import { masteryLabel } from "./mastery";
import { gradeLabel } from "./profile";
import type { AskContext } from "./ask";
import { getLessonContent, type LessonContent } from "./lesson-content";
import { getLessonBridges } from "./subject-queries";
import { resolveStudentScope, visibleCoursesFor } from "./catalog-queries";
import { getVisualsForLos } from "./visuals";
import { mcqChoices } from "./types";
import { ANSWER_ONLY_INSTRUCTION, isAnswerOnly } from "./question-flags";
import { effectiveProbing, learnWrongAnswerRules, PROBING_SURFACE } from "./socratic-probing";
import { COURSE_RANK, MODULE_ORDER } from "./module-order";
import { DEFAULT_LESSON_SLUG, sanitizeLessonSlug, slugOfLo } from "./lesson-slug";
import type { WidgetQuestionSpec } from "./types";
import { CURVE_SKETCHER_G10_FAMILIES, documentedMathWidgets, mathWidgetDocs, mathWidgetDocsNamed } from "./widget-docs";
import { courseDef, type CourseTutorFacts } from "./courses";
import {
  BOOK_SECTIONS_SQL,
  provenanceFromRow,
  type BookSectionRow,
  type LessonProvenance,
} from "./book-sections";
import { lessonHeading, shownProvenance, shownTitles } from "./section-label";
import {
  figureDirectivesDoc,
  socialFigureDirectivesDoc,
  visualsCatalogLines,
} from "./viz-prompt";
import {
  SPINE_SUBJECT_KEYS,
  labelArOfSpineKey,
  requireSubjectOfCourse,
  subjectDef,
  subjectOfCourse,
} from "./subjects";
import type {
  ClaimStep,
  LessonBridge,
  LessonData,
  LessonInfo,
  LessonLo,
  LessonMode,
  SolutionStep,
  SpineQuestion,
  Subject,
  Tier,
} from "./types";

/**
 * Adaptive lesson modes — "How did today's lesson go?"
 *
 * Same engine, two temperaments:
 *  - learn  : Omar understood nothing at school → AI-led interactive lesson
 *             in small beats (explanation → widget / check question → adapt).
 *  - review : Omar understood everything → non-annoying 3-minute lock-it-in
 *             (3 quick-fire questions + one widget moment, ≤ 5 AI turns).
 *
 * The lesson itself is a PARAMETER: any (module, syllabus_ref) group of LOs
 * in the spine — Algebra Lesson 1-1 or Geometry "The Circle" alike. Both
 * modes are grounded EXCLUSIVELY in the human-reviewed spine slice for the
 * selected lesson: its LO descriptions, the canonical solutions of its live
 * questions, and its curated figure library. The model never teaches from
 * scratch beyond that scope.
 */

/**
 * `studentId` is now the SIGNED-IN student (lib/student-context.ts) and there is
 * no default one. It stays optional, and `null` is a supported value, for the
 * one caller that legitimately has nobody: `scripts/capture-prompts.mts`, which
 * renders every prompt surface to disk for the byte-identity diff. A null
 * student reads the curriculum and no mastery — which is what "no signal"
 * already meant — rather than borrowing somebody's.
 *
 * Every student-scoped read below (`mastery`, `students`) runs inside a unit of
 * work under that student. The curriculum reads beside them need no principal,
 * and share the unit only because splitting them would buy nothing.
 *
 * NOTHING in this file's prompt text changed. The edits are the connection a
 * query runs on and the type of one parameter.
 *
 * Feature 003 (ADR-0020 note, 2026-09-25; FR-4205, FR-4206): the facts these
 * prompts state about a BOOK — its name, the lead of a lesson reference, the
 * lesson titles, the geometry lessons, the fallback example ids, where a
 * lesson's widgets come from — are read from the course registry
 * (`lib/courses.ts` `CourseTutorFacts`) instead of being written here for the
 * Prep-3 book. The National courses carry exactly the values this file used,
 * so their prompts are byte-identical (the capture harness, 438 files, and
 * `national-prompts.test.mts`); the Grade 10 course's are new
 * (`g10-prompts.test.mts`).
 */

// The slug rule itself lives in `lib/lesson-slug.ts` — a client-safe module,
// because the skill map's topic panel needs the same mapping to build its
// "Study" link and cannot import this file (it opens a pool). Re-exported
// here so every existing importer keeps working unchanged (Tamer's `1fcf346`).
export { DEFAULT_LESSON_SLUG, sanitizeLessonSlug } from "./lesson-slug";

/**
 * Subject detection (ADR-0004 Wave 0): the lesson's module sits `part_of` a
 * course node; the course id keys the language contract + grounding rules.
 *
 * The lookup itself now lives in the subject registry (lib/subjects.ts) and is
 * EXACT. It used to be `courseId?.endsWith("-social-ar") ? … : "math-en"`,
 * which silently taught every unrecognized course — Arabic included — as
 * maths, in English, with maths widgets. Unknown course → `null` here, and
 * `requireSubjectOfCourse` throws at the call sites that cannot proceed
 * without a subject.
 *
 * @see lib/subjects.ts — `subjectOfCourse` / `requireSubjectOfCourse`
 */

/* ------------------------------------------------------------------ */
/* What the tutor is told about the course's book (feature 003)        */
/* ------------------------------------------------------------------ */

/**
 * The course's tutor facts — book name, syllabus line, example ids, lesson
 * titles, the figure-led lessons and where its widgets come from — from the
 * course registry (`lib/courses.ts` `CourseTutorFacts`). They used to be
 * strings in this file's maths kit, true of the Prep-3 book only.
 *
 * A course the registry does not know has no facts and cannot be taught: this
 * throws rather than lending it another book's name, the same refusal
 * `requireSubjectOfCourse` makes for its subject.
 */
function tutorFacts(courseId: string | null | undefined): CourseTutorFacts {
  const def = courseDef(courseId);
  if (!def) {
    throw new Error(
      `Course "${courseId}" is not in the course registry (lib/courses.ts), so ` +
        `the tutor has no facts about its book. Refusing to teach it with another book's.`
    );
  }
  return def.tutor;
}

/**
 * A lesson's display title, in this order:
 *
 *   1. the registry's printed title, for a book whose bundles carry none
 *      (Prep-3 maths, `LESSON_TITLES` before 003, text unchanged);
 *   2. its printed title from the book-section store (FR-4311, migration 034)
 *      — `printedLabel(...).title` — for a lesson of a course whose book
 *      provenance changes what it shows (`shownProvenance`,
 *      lib/section-label.ts: a course with a split, merged or promoted lesson,
 *      i.e. the Grade 10 book). This is what puts "Rational and irrational
 *      numbers" where the prompt used to print the merged lesson's first
 *      objective;
 *      The same store names the lessons of a course whose registry entry
 *      says its lessons carry the book's printed names
 *      (`tutor.bookLessonTitles`, `shownTitles`): Prep-3 Arabic, Samuel's
 *      decision 13 — «عِبادُ الرَّحمنِ», where every Arabic lesson used to
 *      print its first objective «فهم النص والاستماع». An approved ADR-0020
 *      exception, for this title and nothing else;
 *   3. undefined — the caller then uses the first objective's label, as it
 *      always has. Every maths and Social Studies lesson ends here or at 1,
 *      with or without a one-section row in the store, so its title is
 *      byte-identical (FR-4206; the section-label header says why "with a
 *      row" is not enough). So does an Arabic lesson with no row yet.
 *
 * One function, so the catalogue and the tutor's prompt cannot disagree about
 * it. The store is read by its callers on the handle they already hold
 * (`bookSectionsOn`); this stays pure.
 */
function lessonTitle(
  courseId: unknown,
  slug: string,
  printed?: string
): string | undefined {
  const registry = courseDef(courseId)?.tutor.lessonTitles?.[slug];
  if (registry !== undefined) return registry;
  return printed != null && printed !== "" ? printed : undefined;
}

/**
 * The printed reference a lesson is called by (backlog #35, FR-4318): for a
 * lesson whose book provenance is shown, its printed section number(s) —
 * "1.7" for each part of 1.7, and the RANGE "1.2–1.3" for the merged lesson
 * that covers both — the same words the check-in, the chips and the lesson
 * header print, so the tutor never says "section 1.3" of a lesson the
 * student sees as "1.2–1.3". Every other lesson — every National one — keeps
 * its objectives' `syllabus_ref` ("Lesson 1-1"), byte for byte.
 */
function lessonRefOf(
  syllabusRef: string | null | undefined,
  slug: string,
  provenance?: LessonProvenance | null
): string {
  if (provenance) {
    const number = lessonHeading(provenance).number;
    if (number !== "") return number;
  }
  return syllabusRef ?? slug;
}

/**
 * What the book-section store says about the given courses' lessons, by slug
 * (FR-4311): `BOOK_SECTIONS_SQL` on the caller's handle, then
 *   · `provenance` — `shownProvenance`, only the book-shaped courses' rows, so
 *     a National lesson is never in the map;
 *   · `titles` — `shownTitles`, the printed titles of those courses' lessons
 *     and of a course whose registry names its lessons from the store
 *     (Prep-3 Arabic, decision 13).
 * `courseIds` must already be gated: the store holds lesson titles. No ids,
 * no read.
 *
 * Not `getSectionIndex` (lib/progression-db.ts): that module imports this one,
 * and the read is one statement.
 */
async function bookSectionsOn(
  db: Db,
  courseIds: readonly string[]
): Promise<{ provenance: Map<string, LessonProvenance>; titles: Map<string, string> }> {
  if (courseIds.length === 0) return { provenance: new Map(), titles: new Map() };
  const r = await db.query(BOOK_SECTIONS_SQL, [courseIds]);
  const rows = (r.rows as BookSectionRow[]).map(provenanceFromRow);
  return { provenance: shownProvenance(rows), titles: shownTitles(rows) };
}

/** Placeholders for an example id a lesson has none of — never another book's id. */
const PLACEHOLDER_ID = "<id>";
const PLACEHOLDER_PAGE = "N";

/* ------------------------------------------------------------------ */
/* Catalog — every teachable lesson, grouped by module                 */
/* ------------------------------------------------------------------ */

export const LO_MODULE_SELECT = `
  SELECT lo.id, lo.label, lo.description, lo.syllabus_ref, lo.source_page,
         lo.order_in_parent,
         m.id AS module_id, m.label AS module_label,
         m.order_in_parent AS module_order,
         c.id AS course_id
  FROM graph_nodes lo
  LEFT JOIN graph_edges e
    ON e.dst_id = lo.id AND e.edge_type = 'teaches' AND e.system_to IS NULL
  LEFT JOIN graph_nodes m ON m.id = e.src_id AND m.kind = 'module'
  LEFT JOIN graph_edges ec
    ON ec.src_id = m.id AND ec.edge_type = 'part_of' AND ec.system_to IS NULL
  LEFT JOIN graph_nodes c ON c.id = ec.dst_id AND c.kind = 'course'
  WHERE lo.kind = 'learning_objective'
`;

// Catalogue order lives in lib/module-order.ts (see why there); re-exported so
// lib/progression-db.ts and any other importer of it from here keep working.
export { MODULE_ORDER } from "./module-order";

/* ------------------------------------------------------------------ */
/* The course gate (migration 023, lib/catalog.ts)                     */
/* ------------------------------------------------------------------ */

/**
 * "May this student be shown content from this course?", as a predicate to
 * apply to rows — one database answer per unit of work, not one per row.
 *
 * **It is a GATE, not a filter.** Every function in this file that can put a
 * course in front of a student consults it, including the ones reached by a
 * hand-typed `?lesson=` URL that never touched a catalogue. Hiding a card in
 * the UI and refusing the data are different guarantees, and only the second
 * one survives somebody guessing a slug.
 *
 * **A null student means NO GATE, and that is not a hole.** The only caller
 * that legitimately has no student is `scripts/capture-prompts.mts`, which
 * renders every prompt surface to disk for the constitution IX byte-diff and
 * reads no student data at all; there is nobody to hide a course from, and
 * gating it would empty the harness and break the gate that watches the
 * prompts. Every route that serves a real child resolves its principal through
 * `requireStudent()` before it gets here, so `null` never arrives from a
 * request.
 *
 * **A course-less row is hidden**, like an unknown course id: an LO whose
 * module hangs off no course cannot be checked against any rule, and explicit
 * allow has exactly one answer for a thing it cannot verify.
 *
 * The `Db` may be a `Pool` rather than the caller's `PoolClient` (`scoped`
 * admits both). Handing a bare pool to `visibleCoursesFor` would read
 * `student_course_access` with NO principal set, which under migration 023's
 * policy returns zero overrides — a silently WRONG answer rather than an
 * error. So a pool is passed as "no client", and the gate opens its own
 * principalled unit of work instead.
 */
async function courseGateFor(
  db: Db,
  studentId: number | null
): Promise<(courseId: string | null | undefined) => boolean> {
  if (studentId == null) return () => true;
  const client = "release" in db ? (db as PoolClient) : undefined;
  const visible = await visibleCoursesFor(studentId, client);
  return (courseId) => courseId != null && visible.has(courseId);
}

export async function getLessonCatalog(
  studentId: number | null = null,
  c?: PoolClient
): Promise<LessonInfo[]> {
  const { losRes, masteryRes, visible, book } = await scoped(studentId, c, async (db) => {
    const [losRes, masteryRes] = await sequential([
      // Every course's lessons, so COURSE FIRST (course-registry order:
      // curriculum, then subject — for a National student exactly the old
      // subject order), then the catalogue order inside each (FR-3217,
      // FR-4009). The course key is the same for
      // every module of one course, so a caller that narrows to one course —
      // the landing, the pointer, "just finished" — sees the order it always
      // did; the check-in's picker with no subject named no longer interleaves
      // Arabic, Social Studies and maths units by unit number.
      () => db.query(`${LO_MODULE_SELECT} ORDER BY ${COURSE_RANK}, ${MODULE_ORDER}`),
      () =>
        studentId == null
          ? Promise.resolve({ rows: [] as { lo_id: string; score: string }[] })
          : db.query(
              `SELECT lo_id, score FROM mastery
             WHERE student_id = $1 AND system_to IS NULL`,
              [studentId]
            ),
    ] as const);
    // One client, so this runs after the two above rather than beside them
    // (pg@9; lib/db.ts `sequential`).
    const visible = await courseGateFor(db, studentId);
    // The book provenance of the courses she may see (FR-4311), after the
    // gate: the store holds lesson titles, and a hidden course's are not hers.
    const courseIds = [
      ...new Set(
        losRes.rows
          .map((r) => r.course_id as string | null)
          .filter((id): id is string => id != null && visible(id))
      ),
    ];
    return { losRes, masteryRes, visible, book: await bookSectionsOn(db, courseIds) };
  });
  const mastery = new Map<string, number>(
    masteryRes.rows.map((r) => [r.lo_id, Number(r.score)])
  );

  const bySlug = new Map<string, LessonInfo>();
  const out: LessonInfo[] = [];
  for (const r of losRes.rows) {
    // The gate, applied to the ROW rather than to the finished list: a lesson
    // from a hidden course is never constructed, so it cannot be returned by a
    // branch somebody adds below.
    if (!visible(r.course_id)) continue;
    const slug = slugOfLo(r.id);
    let info = bySlug.get(slug);
    if (!info) {
      const provenance = book.provenance.get(slug);
      info = {
        slug,
        ref: lessonRefOf(r.syllabus_ref, slug, provenance),
        title: lessonTitle(r.course_id, slug, book.titles.get(slug)) ?? r.label,
        moduleId: r.module_id ?? "module:unfiled",
        moduleLabel: r.module_label ?? "Unfiled",
        courseId: r.course_id ?? null,
        subject: subjectOfCourse(r.course_id),
        los: [],
        // only for a book-shaped course: a National lesson carries no key at all
        ...(provenance ? { provenance } : {}),
      };
      bySlug.set(slug, info);
      out.push(info);
    }
    info.los.push({
      id: r.id,
      label: r.label,
      description: r.description,
      sourcePage: r.source_page,
      mastery: mastery.get(r.id) ?? 0,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* One lesson's full grounded slice                                    */
/* ------------------------------------------------------------------ */

/**
 * WHICH OBJECTIVES A LESSON SLUG MEANS — the one resolution, used by both
 * `lessonCourseId` (the session's probing snapshot) and `lessonDataOn` (the
 * lesson the tutor teaches, whose `courseId` the prompt's probing narrowing
 * reads). Fix pass 2: they used to be two copies of the same rule — the same
 * sanitising, the same `LIKE`, the same order, the same fall-back to the
 * default lesson for an unknown slug — which agreed only because nobody had
 * edited one of them yet. A drift between them is exactly "the sitting stored
 * probing for one course and the prompt narrowed it by another".
 *
 * `firstOnly` adds `LIMIT 1` for the caller that only needs the course;
 * everything else about the statement is shared, so the first row is the same
 * row either way.
 *
 * Its `ORDER BY lo.order_in_parent, lo.id` is the one objective sort in this
 * file that does not name `MODULE_ORDER`, and it does not need to (FR-3217's
 * listed exception, `catalogue-order-guard.test.mts`): the `LIKE` keeps ONE
 * lesson, a lesson sits in one module, and inside one module `MODULE_ORDER`'s
 * term and module keys are constants — it reduces to exactly this. The guard
 * test checks that premise on every seeded lesson. This read also feeds the
 * lesson prompt, which ADR-0020 holds.
 */
async function resolveLessonLos(db: Db, slug: unknown, firstOnly = false) {
  const read = async (s: string) =>
    (
      await db.query(
        `${LO_MODULE_SELECT} AND lo.id LIKE $1 ORDER BY lo.order_in_parent, lo.id${firstOnly ? " LIMIT 1" : ""}`,
        [`lo:${s}-%`]
      )
    ).rows;
  const safeSlug = sanitizeLessonSlug(slug);
  const rows = await read(safeSlug);
  if (rows.length > 0 || safeSlug === DEFAULT_LESSON_SLUG) return { slug: safeSlug, rows };
  // unknown slug → the default lesson (same student, same unit of work)
  return { slug: DEFAULT_LESSON_SLUG, rows: await read(DEFAULT_LESSON_SLUG) };
}

/** The course of a resolved lesson: its first objective's, or null. */
function courseOfLessonRows(rows: readonly { course_id?: unknown }[]): string | null {
  return (rows[0]?.course_id as string | null | undefined) ?? null;
}

/**
 * The course a lesson slug belongs to, or null — for ONE purpose: resolving a
 * new learning session's Socratic-probing snapshot (ADR-0021), which is maths
 * only. Resolved by `resolveLessonLos`, the same function `lessonDataOn` uses,
 * so the course this answers IS the `courseId` of the lesson the tutor will
 * then teach and narrow the prompt by (`buildLessonContext`).
 *
 * **Not a gate.** It reads curriculum rows only and decides nothing about
 * visibility — `getLessonData` still refuses a hidden course a few statements
 * later in the same request. And it is called only when probing could apply
 * at all (`probingCouldApply`), so with the switch Off it never runs.
 */
export async function lessonCourseId(
  slug: string | undefined,
  client: PoolClient
): Promise<string | null> {
  return courseOfLessonRows((await resolveLessonLos(client, slug, true)).rows);
}

/**
 * One lesson's grounded slice, or **`null` when this student may not have it**.
 *
 * ---------------------------------------------------------------------------
 * WHY `null` AND NOT A THROW — the refusal shape, decided once
 * ---------------------------------------------------------------------------
 * `?lesson=geo1-2` is a hand-typed URL. It reaches this function without
 * passing a catalogue, so whatever this function does IS the gate; filtering
 * the picker upstream would leave the slug working for anyone who guessed it.
 *
 * The refusal is a `null` rather than an exception because the three callers
 * need three different refusals — a 404 page, a JSON 404, and an SSE stream
 * that has to say something to a waiting client — and all three already wrap
 * this call in a broad `catch` that reports 500 "internal error". A thrown
 * refusal would therefore be delivered to the student as an outage: correct
 * behaviour wearing the costume of a bug, on the one path where telling those
 * apart matters. A `null` return type makes the compiler walk every caller and
 * ask what it wants to say, which is the same argument `lib/subjects.ts` makes
 * for deriving its unions from the registry.
 *
 * The page turns it into `notFound()`. A hidden course and a slug that never
 * existed are ONE answer, deliberately: two answers would let a student
 * enumerate which courses exist but are switched off for them, which is a
 * smaller leak than the content and still a leak.
 *
 * With no student in scope (`studentId === null`, the prompt-capture harness)
 * there is nobody to refuse and this behaves exactly as it always has.
 */
export async function getLessonData(
  slug: string = DEFAULT_LESSON_SLUG,
  studentId: number | null = null,
  c?: PoolClient
): Promise<LessonData | null> {
  return scoped(studentId, c, (db) => lessonDataOn(db, slug, studentId));
}

async function lessonDataOn(
  db: Db,
  slug: string,
  studentId: number | null
): Promise<LessonData | null> {
  // Which objectives — `resolveLessonLos`, the one resolution `lessonCourseId`
  // shares, unknown slug → the default lesson included.
  //
  // ONE student read, and it is the profile (plan A9, "the address seam").
  // This used to be its own `SELECT display_name, grade` beside the identical
  // read `retrieve()` was already doing for the same turn — two reads, and only
  // one of them could ever learn how to address the student.
  const [lesson, profile] = await sequential([
    () => resolveLessonLos(db, slug),
    () => (studentId == null ? Promise.resolve(null) : getStudentProfile(studentId, db)),
  ] as const);
  const safeSlug = lesson.slug;
  const losRes = { rows: lesson.rows };

  // THE GATE, and it is deliberately the first thing after the lesson is
  // identified — before the question bank, the figures and the student's
  // mastery are read. Everything below this line is content, and content for a
  // course this student may not see must not be fetched at all, let alone
  // assembled and then discarded. (`getVisualsForLos` also runs on the bare
  // pool rather than this client, so "fetch then filter" would reach outside
  // the unit of work to do it.)
  //
  // An empty `losRes` lands here with `course_id` undefined and is refused for
  // the same reason an unknown course is: there is nothing to check a rule
  // against. That is a small improvement on the old behaviour, which carried
  // on and threw `UnknownSubjectError` several reads later.
  const visible = await courseGateFor(db, studentId);
  if (!visible(losRes.rows[0]?.course_id)) return null;

  const loIds: string[] = losRes.rows.map((r) => r.id);

  const [masteryRes, qRes, visuals] = await sequential([
    () =>
      studentId == null
        ? Promise.resolve({ rows: [] as { lo_id: string; score: string }[] })
        : db.query(
            `SELECT lo_id, score FROM mastery
           WHERE student_id = $1 AND lo_id = ANY($2) AND system_to IS NULL`,
            [studentId, loIds]
          ),
    () =>
      db.query(
        `SELECT id, lo_id, tier, question_type, stem, choices, correct_answer,
              canonical_solution, solution_version, status,
              source, parent_question_id, source_sha256, source_page, source_note,
              reviewed_by, reviewed_at
       FROM questions
       WHERE status = 'live' AND lo_id = ANY($1)
       ORDER BY lo_id, tier, id`,
        [loIds]
      ),
    () => getVisualsForLos(loIds),
  ] as const);

  const mastery = new Map<string, number>(
    masteryRes.rows.map((r) => [r.lo_id, Number(r.score)])
  );

  const questions: SpineQuestion[] = qRes.rows.map((r) => ({
    id: r.id,
    loId: r.lo_id,
    tier: r.tier as Tier,
    questionType: r.question_type,
    stem: r.stem,
    choices: r.choices,
    correctAnswer: r.correct_answer,
    solution: r.canonical_solution ?? [],
    solutionVersion: Number(r.solution_version ?? 1),
    status: r.status,
    provenance: {
      source: r.source,
      parentQuestionId: r.parent_question_id ?? null,
      sourceSha256: r.source_sha256,
      sourcePage: r.source_page,
      sourceNote: r.source_note,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
      extractor: null,
      extractorVersion: null,
      extractionFinishedAt: null,
    },
  }));

  const first = losRes.rows[0];
  // A lesson IS its subject: the contract, the grounding rules and the widget
  // catalogue all hang off it. An unregistered course therefore cannot be
  // taught at all — it throws here instead of quietly becoming a maths lesson.
  const subject = requireSubjectOfCourse(
    first?.course_id,
    `lesson "${safeSlug}"`
  );
  const kit = lessonPromptKit(subject);

  // The widgets of the lesson's OWN unit, for a course whose registry facts
  // say they come from its data (FR-1209; feature 003, decision 10): the kinds
  // of the live widget questions of the lesson's module, most used first. The
  // Prep-3 unit map in `lib/widget-docs.ts` knows nothing of such a book, and
  // its fallback (pair_plotter, product_builder) is Prep-3's Unit 1 — the
  // borrowed widget decision 10 rules out. Prep-3 never runs this read.
  let unitWidgets: string[] | undefined;
  let hasG10CurveFamily = false;
  if (tutorFacts(first?.course_id).lessonWidgets === "module-questions") {
    const moduleId = (first?.module_id as string | null | undefined) ?? null;
    const w =
      moduleId == null
        ? { rows: [] as { kind: unknown }[] }
        : await db.query(
            `SELECT q.choices->>'kind' AS kind, count(*) AS n
               FROM questions q
               JOIN graph_edges t
                 ON t.dst_id = q.lo_id AND t.edge_type = 'teaches' AND t.system_to IS NULL
              WHERE t.src_id = $1 AND q.status = 'live' AND q.question_type = 'widget'
              GROUP BY 1
              ORDER BY count(*) DESC, 1`,
            [moduleId]
          );
    unitWidgets = w.rows
      .map((r) => r.kind)
      .filter((k): k is string => typeof k === "string" && k.length > 0);

    // `widget-docs.ts` documents curve_sketcher's five NEW families (hyperbola,
    // exponential, sine, cosine, tangent) under a separate key
    // ("curve_sketcher_g10") so the National unit map's own entry — read by
    // every Prep-3 unit that already offers curve_sketcher — stays exactly as
    // it was. A G10 unit whose live bank holds a curve_sketcher question of
    // one of those five is told about that key instead (`mathProtocol`
    // below), which needs to know that BEFORE it asks `mathWidgetDocsNamed`
    // for its widget list — a second, cheap read, only when the unit has a
    // curve_sketcher at all.
    if (unitWidgets.includes("curve_sketcher") && moduleId != null) {
      const fnRes = await db.query(
        `SELECT DISTINCT q.choices->'spec'->>'fn' AS fn
           FROM questions q
           JOIN graph_edges t
             ON t.dst_id = q.lo_id AND t.edge_type = 'teaches' AND t.system_to IS NULL
          WHERE t.src_id = $1 AND q.status = 'live' AND q.question_type = 'widget'
            AND q.choices->>'kind' = 'curve_sketcher'`,
        [moduleId]
      );
      hasG10CurveFamily = fnRes.rows.some((r) =>
        CURVE_SKETCHER_G10_FAMILIES.has(String((r as { fn: unknown }).fn))
      );
    }
  }

  // Distinct base maps referenced by the stored map_scene figures (≤2, in
  // first-appearance order) — keys the gazetteer injection for social lessons.
  const mapBases: string[] = [];
  for (const v of visuals) {
    if (v.kind !== "map_scene") continue;
    const base = (v.spec as { base?: unknown }).base;
    if (
      typeof base === "string" &&
      /^[a-z_]{1,32}$/.test(base) &&
      !mapBases.includes(base)
    ) {
      mapBases.push(base);
      if (mapBases.length >= 2) break;
    }
  }

  // Subjects that name their actual source book (كتاب الوزارة) in the data
  // block resolve its title here; the others stay null (math's prompts name
  // the book generically, so leaving this null keeps them byte-identical).
  let docTitle: string | null = null;
  if (kit.namesSourceBook && first?.course_id) {
    const docRes = await db.query(
      `SELECT d.title FROM graph_nodes c
       JOIN source_documents d ON d.sha256 = c.source_sha256
       WHERE c.id = $1`,
      [first.course_id]
    );
    docTitle = (docRes.rows[0]?.title as string | undefined) ?? null;
  }

  const los: LessonLo[] = losRes.rows.map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    sourcePage: r.source_page,
    mastery: mastery.get(r.id) ?? 0,
  }));

  // The lesson's book provenance (FR-4311, FR-4318): the printed title of a
  // Grade 10 lesson, where the header used to print its first objective. Read
  // for the lesson's whole course, not by `LESSON_PROVENANCE_SQL`'s one row,
  // because whether the store may name it is a property of the course
  // (`shownProvenance`): a National lesson's own one-section row would
  // otherwise rename it. The course has passed the gate above.
  const courseId = courseOfLessonRows(lesson.rows);
  const book = await bookSectionsOn(db, courseId ? [courseId] : []);
  const provenance = book.provenance.get(safeSlug);

  return {
    slug: safeSlug,
    // the printed range for a merged Grade 10 lesson ("1.2–1.3"), as the
    // check-in prints it (backlog #35); `syllabus_ref` for every other
    lessonRef: lessonRefOf(first?.syllabus_ref, safeSlug, provenance),
    title:
      lessonTitle(first?.course_id, safeSlug, book.titles.get(safeSlug)) ??
      first?.label ??
      safeSlug,
    moduleLabel: first?.module_label ?? "Unfiled",
    // the SAME answer `lessonCourseId` gives for this slug (`courseOfLessonRows`
    // over `resolveLessonLos`): what `buildLessonContext` narrows probing by
    courseId,
    subject,
    los,
    questions,
    visuals: visuals.map((v) => ({
      id: v.id,
      kind: v.kind,
      loId: v.loId,
      caption: v.caption,
      sourcePage: v.sourcePage,
    })),
    mapBases,
    docTitle,
    studentName: profile?.displayName ?? "Omar",
    // `LessonData.studentId` is a plain number because it is interpolated into
    // the data block. No student in scope (the capture harness) renders 0 —
    // "nobody", which is what it is — rather than a borrowed id.
    studentId: studentId ?? 0,
    grade: profile?.grade ?? "10",
    // Address and voice only (FR-2603). Nothing below reads it except the
    // prompt templates; `null` means "not recorded", never "masculine".
    gender: profile?.gender ?? null,
    // only for a course that names its own unit's widgets (see above)
    ...(unitWidgets ? { unitWidgets } : {}),
    // only true for a G10 unit whose live curve_sketcher bank needs the wider
    // ("curve_sketcher_g10") documentation (see above)
    ...(hasG10CurveFamily ? { hasG10CurveFamily } : {}),
    // only for a book-shaped course (lib/section-label.ts): the check-in's
    // "1.7 Factorisation · part 2 of 3" (FR-4318)
    ...(provenance ? { provenance } : {}),
  };
}

/** understanding_checks FK anchor — the lesson's first LO. */
export function lessonAnchorLo(data: LessonData): string {
  return data.los[0]?.id ?? "lo:u1-1-1";
}

/**
 * A lesson taught figure-first — Prep-3's geometry units (`geo…`), by the
 * course's own registry fact. A course without one has none: a Grade 10
 * geometry chapter is not told about Prep-3's circle and angle widgets.
 */
function isGeoLesson(data: LessonData): boolean {
  const prefix = tutorFacts(data.courseId).figureLedSlugPrefix;
  return prefix != null && data.slug.startsWith(prefix);
}

/**
 * The lesson's own unit's widgets, documented ones only, for a course that
 * names them from its data (`lessonWidgets: "module-questions"`); `null` for a
 * course that reads the unit map in `lib/widget-docs.ts` (Prep-3), whose
 * prompts therefore stay as they were.
 */
function ownUnitWidgets(data: LessonData): string[] | null {
  return tutorFacts(data.courseId).lessonWidgets === "module-questions"
    ? documentedMathWidgets(data.unitWidgets ?? [])
    : null;
}

/* ------------------------------------------------------------------ */
/* Grounding block shared by both modes + the rating pass              */
/* ------------------------------------------------------------------ */

/**
 * Formats canonical steps for the prompt. Math steps ({step, text_md}) render
 * exactly as before (byte-identical). Social claim-steps ({step, claim_ar,
 * evidence_page, …} — see docs/specs/social-extraction-contract.md) render the
 * Arabic claim with its per-claim evidence page so the model can cite it.
 */
/** gradeLabel() lower-cased for embedding mid-sentence — "grade 10" /
 *  "grade 9 (prep-3)" — so prompts narrate the student's ACTUAL grade
 *  (lib/profile.ts) instead of a fixed literal. */
function lowerGrade(grade: string): string {
  return gradeLabel(grade).replace(/^Grade/, "grade");
}

function fmtSteps(steps: SolutionStep[]): string {
  return steps
    .map((s) => {
      const c = s as Partial<SolutionStep> & Partial<ClaimStep>;
      if (c.text_md != null) return `Step ${s.step}. ${c.text_md}`;
      const ev =
        c.evidence_page != null
          ? ` [evidence: p.${c.evidence_page}${c.evidence_kind ? `, ${c.evidence_kind}` : ""}]`
          : "";
      return `Step ${s.step}. ${c.claim_ar ?? ""}${ev}`;
    })
    .join(" | ");
}

export function lessonDataBlock(data: LessonData): string {
  const kit = lessonPromptKit(data.subject);
  const solutionLabel = kit.solutionLabel;
  const bankNote = kit.bankNote;
  // Band, not percentage — see the note in `retrieval.ts`. "mastery today
  // 92%" in this block is the literal source of the model saying "92%,
  // that's excellent" mid-lesson (#27): it was handed a number and nothing
  // told it the number was not for the student.
  const loLines = data.los
    .map(
      (l) =>
        `- ${l.id} | "${l.label}" | book p.${l.sourcePage ?? "—"} | ${masteryLabel(l.mastery)}\n  ${l.description ?? ""}`
    )
    .join("\n");

  const qLines = data.questions
    .map((q) => {
      // A widget question's `choices` is a construction spec, not options, so
      // the catalogue line names the construction the tutor would be pushing
      // rather than printing nothing (ADR-0009).
      const opts = mcqChoices(q);
      const choices = opts
        ? opts.map((c) => `(${c.key}) ${c.text}`).join(" ")
        : q.questionType === "widget" && q.choices
          ? `(construction: ${(q.choices as WidgetQuestionSpec).kind})`
          : "(numeric)";
      // An `answer_only` question (Samuel's G2 answer 22): the book prints no
      // working, so the tutor is given none to walk — only the instruction
      // not to invent one. Every other question reads exactly as before.
      const solutionLine = isAnswerOnly(q.choices)
        ? ANSWER_ONLY_INSTRUCTION
        : `${solutionLabel}${q.solutionVersion}, human-reviewed): ${fmtSteps(q.solution)}`;
      return `- ${q.id} | ${q.loId} | ${q.tier} | ${q.questionType} | p.${q.provenance.sourcePage ?? "—"}\n  Stem: ${q.stem}\n  Choices: ${choices}\n  Correct: ${q.correctAnswer}\n  ${solutionLine}`;
    })
    .join("\n");

  const vizLines = visualsCatalogLines(data.visuals);
  // the course's own book (FR-4205): "Egyptian ministry textbook" and "school
  // Lesson 1-1" for the National books, exactly as before; "this book" and
  // "section 1.3" for Grade 10
  const facts = tutorFacts(data.courseId);
  const bookName = kit.bookName(data.docTitle, facts);

  return `LESSON DATA — your ONLY source of truth (${facts.lessonRefLead} ${data.lessonRef}: ${data.title} — ${data.moduleLabel}, ${bookName})
Student: ${data.studentName} (id ${data.studentId}), ${lowerGrade(data.grade)}.

LEARNING OBJECTIVES of this lesson, in teaching order:
${loLines}

QUESTION BANK for this lesson (${bankNote}):
${qLines}

FIGURE LIBRARY for this lesson (stored animated figures — push by id with {{widget:viz_ref:<id>}}):
${vizLines || "(none for this lesson — compose custom figures with {{widget:viz:…}} when needed)"}`;
}

/* ------------------------------------------------------------------ */
/* Gazetteer injection (social lessons — Wave 1)                       */
/* ------------------------------------------------------------------ */

const GAZ_KIND_ORDER = ["point", "region", "line", "sea"];

/**
 * Compact gazetteer name lists (names only, grouped by kind) for the ≤2 base
 * maps referenced by a social lesson's stored visuals, read server-side from
 * app/public/maps/<base>.json. Appended to the lesson data block so the model
 * only ever names places the hit-tester can resolve. Empty string when no
 * base resolves — the data block is unchanged then.
 */
async function gazetteerBlock(bases: string[]): Promise<string> {
  const sections: string[] = [];
  for (const base of bases.slice(0, 2)) {
    if (!/^[a-z_]{1,32}$/.test(base)) continue;
    try {
      const raw = await readFile(
        path.join(process.cwd(), "public", "maps", `${base}.json`),
        "utf8"
      );
      const gaz = JSON.parse(raw) as {
        places?: Record<string, { kind?: unknown }>;
      };
      const byKind = new Map<string, string[]>();
      for (const [name, p] of Object.entries(gaz.places ?? {})) {
        const kind = typeof p?.kind === "string" ? p.kind : "point";
        const arr = byKind.get(kind) ?? [];
        arr.push(name);
        byKind.set(kind, arr);
      }
      if (byKind.size === 0) continue;
      const kinds = [
        ...GAZ_KIND_ORDER.filter((k) => byKind.has(k)),
        ...[...byKind.keys()].filter((k) => !GAZ_KIND_ORDER.includes(k)),
      ];
      sections.push(
        `[base "${base}"]\n${kinds
          .map((k) => `  ${k}: ${byKind.get(k)!.join("، ")}`)
          .join("\n")}`
      );
    } catch {
      /* missing/corrupt gazetteer asset — skip this base */
    }
  }
  if (sections.length === 0) return "";
  return `

GAZETTEER — أسماء الأماكن المعتمدة (the base maps used by this lesson's figures). In every map widget and map_scene ("target", "decoys", "place", every "through" entry) use ONLY these names, copied EXACTLY as written — never invent a place, never use coordinates:
${sections.join("\n")}`;
}

/* ------------------------------------------------------------------ */
/* Cross-subject connections (bridge-aware hint — Wave 1.5 §5)          */
/* ------------------------------------------------------------------ */

/**
 * The curated `relates_to` links touching this lesson, formatted as an
 * OPTIONAL grounding hint. Grounded because each connection is human-approved
 * with its own rationale — the tutor cites it, never fabricates one. Empty
 * string when the lesson has no bridges (so those lessons' prompts are
 * unchanged). Appended to the data block, like the gazetteer.
 */
function bridgeBlock(bridges: LessonBridge[]): string {
  if (bridges.length === 0) return "";
  const lines = bridges
    .map(
      (b) =>
        `- this "${b.thisLabel}" ↔ ${labelArOfSpineKey(b.otherSubject)} «${b.otherLabel}»: ${b.rationale}`
    )
    .join("\n");
  return `

CROSS-SUBJECT CONNECTIONS (curated, human-approved links between THIS lesson and another subject — mention naturally ONLY IF the student reaches this idea; cite the connection, never fabricate one; at most ONE gentle one-line hint per lesson, then move on):
${lines}
The hint is light and optional — e.g. «فكرة الإحداثيات دي شفتها في الرياضيات» / "you already met this coordinates idea in math" — dropped at the natural moment, never forced, never a second lesson.`;
}

/* ------------------------------------------------------------------ */
/* System prompts                                                      */
/* ------------------------------------------------------------------ */

/**
 * Cross-subject recognition + offered handoff (Wave 1.5 — Samuel's core call:
 * seamless awareness, never a hard pause, never a blind inline answer). Added
 * IDENTICALLY to every subject's lesson prompt: a math session must recognize
 * a history question, and a social session a math question. The literal string
 * is shared so the only prompt delta this wave introduces is byte-for-byte the
 * same in math and social. `{{switch_subject:…}}` is parsed into a warm
 * handoff card, NOT answered from memory — that keeps grounding honest.
 */
const CROSS_SUBJECT_RULE = `CROSS-SUBJECT AWARENESS (subjects stay separate; offer a clean handoff): if the student asks about a DIFFERENT school subject — e.g. a history or geography question during a math lesson, or a math question during a social-studies lesson (NOT merely another lesson inside THIS subject) — do NOT answer it from memory or from this lesson's data. Give ONE short warm acknowledgment in your own voice, then emit {{switch_subject:<subject>}} alone on its own line, where <subject> is exactly "math" or "social". This offers a handoff to that subject; it is NOT one of the interactive directives above and does not count as this message's single directive.`;

/** The subjects `CROSS_SUBJECT_RULE` offers a handoff to, as it is written. */
const HANDOFF_TARGETS = ["math", "social"] as const;
const HANDOFF_CLAUSE = `exactly "math" or "social"`;
if (!CROSS_SUBJECT_RULE.includes(HANDOFF_CLAUSE)) {
  throw new Error("lesson: CROSS_SUBJECT_RULE no longer names its handoff targets as expected");
}

/**
 * The same awareness with no handoff to offer: every other subject the rule
 * names is closed to this student. Out of her material, so the tutor
 * acknowledges, declines and brings her back to the lesson (spec 003 edge
 * case, Principle II) — and never emits a handoff that would land on a 404.
 */
const NO_HANDOFF_RULE = `CROSS-SUBJECT AWARENESS (subjects stay separate): if the student asks about a DIFFERENT school subject — e.g. a history or geography question during a math lesson, or a math question during a social-studies lesson (NOT merely another lesson inside THIS subject) — do NOT answer it from memory or from this lesson's data. Give ONE short warm acknowledgment in your own voice that it is outside what you can help with here, then bring the student back to this lesson with a question about it. Never emit {{switch_subject:…}}: no other subject is open to this student here.`;

/**
 * The cross-subject rule THIS student's lesson prompt carries (FR-4006; the
 * 2026-09-26 isolation audit). A handoff is offered only to a subject with a
 * course she may see: `data.handoffSubjects`, set from her scope by
 * `buildLessonContext`.
 *
 * Byte-identical to `CROSS_SUBJECT_RULE` whenever every subject the rule
 * would offer is open to her — every National student who sees Social
 * Studies, and the capture harness (no student, `handoffSubjects` absent), so
 * both prompt goldens are untouched. Narrowed to the open ones when some are
 * closed, and the no-handoff wording when none is.
 */
function crossSubjectRule(data: LessonData): string {
  const open = data.handoffSubjects;
  if (open === undefined) return CROSS_SUBJECT_RULE;
  const own = subjectDef(data.subject).key;
  const others = HANDOFF_TARGETS.filter((k) => k !== own);
  const offered = others.filter((k) => open.includes(k));
  if (offered.length === others.length) return CROSS_SUBJECT_RULE;
  if (offered.length === 0) return NO_HANDOFF_RULE;
  return CROSS_SUBJECT_RULE.replace(
    HANDOFF_CLAUSE,
    offered.map((k) => `exactly "${k}"`).join(" or ")
  );
}

/** Real ids from the lesson in scope, injected into a subject's directive
 *  documentation so every example the model reads is one it can actually use. */
interface ProtocolExamples {
  lo: string;
  q: string;
  /** a page number, or the placeholder "N" when neither the lesson nor its course has one */
  page: number | string;
  viz: string;
}

/** Dispatches to the subject's own protocol — the directive catalogue, the
 *  citation rules and the FORMAT line are all per-subject (registry §widgets).
 *
 *  The examples are the lesson's own ids. When it has none of one kind, the
 *  course's registry fallback applies (the National books: exactly the ids
 *  they have always shown) — and for a course with none (Grade 10), a
 *  placeholder, never another book's id (decision 10). */
function sharedProtocol(data: LessonData, rhythm: string): string {
  const kit = lessonPromptKit(data.subject);
  const fallback = tutorFacts(data.courseId).exampleFallbacks;
  return kit.protocol(
    rhythm,
    {
      lo: data.los[0]?.id.replace(/^lo:/, "") ?? fallback?.lo ?? PLACEHOLDER_ID,
      q: data.questions[0]?.id.replace(/^q:/, "") ?? fallback?.q ?? PLACEHOLDER_ID,
      page: data.los[0]?.sourcePage ?? fallback?.page ?? PLACEHOLDER_PAGE,
      viz: data.visuals[0]?.id ?? fallback?.viz ?? PLACEHOLDER_ID,
    },
    data
  );
}

/** SOCIAL STUDIES — Arabic citations + the map / timeline / chain / term-match
 *  catalogue (ADR-0004 Wave 1). */
function socialProtocol(
  rhythm: string,
  ex: ProtocolExamples,
  data: LessonData
): string {
  const { lo: exLo, q: exQ, page: exPage, viz: exViz } = ex;
  const a = addressForms(data.gender, data.studentName);
  return `CITATIONS: embed [[lo:${exLo}]] / [[q:${exQ}]] / [[page:${exPage}]] receipt markers after substantive claims, ids strictly from the LESSON DATA. Flag any needed term missing from the LESSON DATA with [[term?:المصطلح]] right after it — never guess a definition silently.

MESSAGE RHYTHM:
${rhythm}

INTERACTIVE DIRECTIVES (each on its OWN line; at most ONE interactive directive per message, always as its LAST beat — {{beat}} itself is a pause marker, not an interactive directive):
- {{show_question:q:${exQ}}} — pushes that live question card (ids from the QUESTION BANK only; each id at most once per session).
- {{widget:locate_on_map:{"base":"egypt","prompt":"فين قناة السويس؟ دوس على مكانها","target":"قناة السويس","decoys":["نهر النيل","خليج العقبة"]}}} — «حدد على الخريطة» as a tap. "base" is one of the GAZETTEER bases below; "target" and every "decoys" entry are EXACT gazetteer names. Give 2–3 decoys for the easier pick-among-markers mode; omit "decoys" for the harder free tap. Payload must be flat JSON exactly in this shape.
- {{widget:timeline_builder:{"prompt":"رتب الأحداث زي ما حصلت","events":["وصول الحملة الفرنسية","موقعة إمبابة","ثورة القاهرة الأولى"],"correctOrder":[0,1,2]}}} — «رتب الأحداث» by tapping. List "events" (3–5 short Arabic labels, facts strictly from the model answers) in story order; "correctOrder" is their indexes in that order.
- {{widget:chain_builder:{"prompt":"ركّب سلسلة «بم تفسر»","cards":[{"label":"فرض الضرائب الفادحة","role":"سبب"},{"label":"ثورة القاهرة الأولى","role":"حدث"},{"label":"إعدام عدد من الثوار","role":"نتيجة"}],"correctChain":[0,1,2]}}} — the student assembles the سبب → حدث → نتيجة chain in causal order (3–4 cards, facts strictly from the model answers).
- {{widget:term_match:{"prompt":"وصّل المصطلح بمعناه","pairs":[{"term":"الموقع الفلكي","definition":"موقع المكان بالنسبة لدوائر العرض وخطوط الطول"}],"decoyDefs":["تعريف قريب للتشتيت"]}}} — «ضع المصطلح» matching, 2–4 pairs; terms and definitions VERBATIM from the LESSON DATA (المصطلحات قانون); "decoyDefs" optional.
- ${socialFigureDirectivesDoc(exViz)}
  A figure counts as the ONE directive of its message. This is a SOCIAL-STUDIES lesson: اشرح بالرسم — a map_scene for every place, a timeline for every sequence of events, a flow_chain for every «بم تفسر» — pick the stored library figure when one fits the beat.
- {{finish_lesson}} — arms ${a.their} Finish button (shown both in the header and as a chat chip); tapping it is what triggers the comprehension report, not this marker. Emit it alone on the final line of your LAST message only.
Results of widgets and questions arrive as "[live event]" lines — ALWAYS adapt your next beat to the latest result.

${crossSubjectRule(data)}

FORMAT: plain short Arabic paragraphs. No headings, no numbered lesson plans, no walls of text.`;
}

/** ARABIC LANGUAGE — text-anchored widgets (ADR-0006): the passage is the
 *  figure. إعراب grades client-side from typed slots; the widget payloads are
 *  therefore grounded in the printed rule lines, never derived. */
function arabicProtocol(
  rhythm: string,
  ex: ProtocolExamples,
  data: LessonData
): string {
  const { lo: exLo, q: exQ, page: exPage } = ex;
  const a = addressForms(data.gender, data.studentName);
  return `CITATIONS: embed [[lo:${exLo}]] / [[q:${exQ}]] / [[page:${exPage}]] receipt markers after substantive claims, ids strictly from the LESSON DATA. Flag any needed term missing from the LESSON DATA with [[term?:المصطلح]] right after it — never guess a definition silently.

MESSAGE RHYTHM:
${rhythm}

INTERACTIVE DIRECTIVES (each on its OWN line; at most ONE interactive directive per message, always as its LAST beat — {{beat}} itself is a pause marker, not an interactive directive):
- {{show_question:q:${exQ}}} — pushes that live question card (ids from the QUESTION BANK only; each id at most once per session).
- {{widget:extract_spans:{"prompt":"دوس على كل منادى في الأمثلة","text":"يا شبابَ الوطنِ اعملوا. يا راغبين في الخير أقبلوا.","category":"نحو","targets":["شبابَ","راغبين"]}}} — «استخرج» as a tap. "text" MUST be non-sacred material quoted verbatim from the LESSON DATA (أمثلة القاعدة، قطعة الإملاء) — NEVER the آيات; "targets" are exact words from that text.
- {{widget:hamza_seat:{"prompt":"اختر الحرف الصحيح لكل همزة","items":[{"word":"فُ_َاد","answer":"ؤ","rule":"مفتوحة وما قبلها مضموم","page":${exPage}}]}}} — الهمزة المتوسطة, 2–4 items; "rule" is the printed case row VERBATIM from the LESSON DATA.
- {{widget:style_purpose:{"prompt":"حدد الأسلوب وغرضه","text":"…من بيانات الدرس…","span":"اصْرِفْ عَنَّا","styles":["أمر","نداء","استفهام"],"purposes":["الدعاء","التنبيه"],"answer":{"style":"أمر","purpose":"الدعاء"}}}} — «أسلوب … وغرضه …»; the answer pair comes VERBATIM from مواطن الجمال in the LESSON DATA.
- {{widget:irab_builder:{"prompt":"أعرب الكلمة","sentence":"يا طالبَ العلمِ اجتهدْ","target":"طالبَ","roles":["منادى مضاف","مضاف إليه","فاعل"],"marks":["الفتحة","الكسرة","الياء"],"answer":{"word_ar":"طالبَ","role_ar":"منادى مضاف","state":"منصوب","sign":"الفتحة","sign_kind":"ظاهرة"},"rule_ref":{"page":${exPage},"quote":"…سطر القاعدة المطبوع حرفيًا…"}}}} — slot-built إعراب. ⚠ GROUNDING GATE: "rule_ref.quote" MUST be a rule line printed in the LESSON DATA (with its page) — an إعراب the book cannot license is not askable. Sentence and answer come from the question bank or the printed examples, never invented.
- {{widget:term_match:{"prompt":"وصّل الكلمة بمعناها","pairs":[{"term":"هَوْنًا","definition":"بسكينة ووقار"}],"decoyDefs":["تعريف قريب للتشتيت"]}}} — معاني المفردات matching, 2–4 pairs VERBATIM from the LESSON DATA.
- {{show_passage:{"id":"t:ara1-1:001","quote":"…كلمات متتالية منسوخة حرفيًا من النص…","view":"line"}}} — points at the text. NEVER point at a whole paragraph: give the 3–12 consecutive words you are about to discuss (النثر والشعر فقط: quote is copied verbatim from a NON-sacred passage؛ التشكيل مش لازم — المطابقة تتجاهله). For a SACRED passage (قرآن/حديث) the quote field is FORBIDDEN — you never type its words — use {"id":"t:ara1-1:002","unit":3,"view":"line"} to point at آية ٣ by NUMBER. "view" picks the presentation — choose it by what THIS beat needs:
  · "view":"line" (the default): a small card appears inline in the exchange carrying ONLY the marked span (rendered by the app from the verified store — your quote is only a locator, it is never shown as your words). Use when the line itself is the subject: close reading, معنى كلمة، جمال تعبير، إعراب جملة.
  · "view":"context": no inline card — the span is highlighted up in the PINNED full passage card and a small chip points there. Use when the surroundings matter: موقع الجملة في الفقرة، ترتيب الأفكار، ربط أول النص بآخره.
  Bare {{show_passage:t:ara1-1:001}} (no span) just scrolls back to the full card — use it only for a general «ارجع للنص». All forms are POINTERS: none counts as this message's interactive directive, and a pointer alone is never an ask — talk about the marked words in the SAME message and still END it with a real ask. Never point in two consecutive messages.
- {{finish_lesson}} — arms ${a.their} Finish button (shown both in the header and as a chat chip); tapping it is what triggers the comprehension report, not this marker. Emit it alone on the final line of your LAST message only.
⚠ SACRED TEXT (hard rule, no exceptions): الآيات والأحاديث معروضة للطالب في بطاقة النص أول المحادثة من الحافظة الموثقة — you never type, quote, complete or embed Quran/Hadith text in prose or in ANY widget payload. Reference it by آية number + {{show_passage:…}} («تأمل الآية ٦٣ في بطاقة النص فوق»). Vocabulary words (single words like هَوْنًا) from the glossary are allowed in term_match. أي رد يتضمن ٣ كلمات متتالية فأكثر من النص المختوم يُلغى آليًا قبل وصوله للطالب.
⚠ NEVER END A MESSAGE WITHOUT AN ASK: your last beat is always something the student ACTS on — a question in chat, a choice, or an interactive directive (widget / show_question). Ending on a statement, a summary, or a show_passage chip strands ${a.them} with nothing to do; if you pointed at the text, the question about that exact spot goes in the SAME message.
This is an ARABIC lesson: the text IS the figure — anchor every beat to ONE specific آية/بيت/جملة by number, ask about one span at a time (معناها، جمالها، إعرابها), and vary the asks across chat questions, extract_spans, style_purpose, irab_builder and term_match instead of repeating open «ما رأيك» questions.
Results of widgets and questions arrive as "[live event]" lines — ALWAYS adapt your next beat to the latest result.

${crossSubjectRule(data)}

FORMAT: plain short Arabic paragraphs. No headings, no numbered lesson plans, no walls of text.`;
}

/** MATHEMATICS — LaTeX citations + the pair_plotter / product_builder / figure
 *  catalogue. This is the original single-subject protocol, byte for byte. */
function mathProtocol(
  rhythm: string,
  ex: ProtocolExamples,
  data: LessonData
): string {
  const { lo: exLo, q: exQ, page: exPage, viz: exViz } = ex;
  const a = addressForms(data.gender, data.studentName);
  // Geometry no longer has to choose between seeing and doing: circle_builder
  // and angle_setter put a construction in the student's hands, so the old
  // "widgets rarely fit here" advice would now be leaving the best tools in
  // the unit unused.
  const vizGuidance = isGeoLesson(data)
    ? `This is a GEOMETRY lesson: lean on figures — open most teaching beats with a stored geo_scene from the FIGURE LIBRARY ({{widget:viz_ref:…}}), or compose one, so ${a.they} SEE${a.S} every definition and theorem drawn out. Then hand the construction over: the circle/angle widgets below let ${a.them} build the thing the figure just showed, which is where a definition actually sticks.`
    : `Figures are for SEEING and widgets are for DOING — show the stored library figure when one fits the beat, then give ${a.them} the matching widget so ${a.they} ${a.does} it ${a.themself}.`;
  // FR-1209: the lesson's own unit's widgets and no others. Prep-3 reads the
  // unit map (byte-identical); a course that names its own reads its data.
  const own = ownUnitWidgets(data);
  // T417: a G10 unit whose live curve_sketcher bank holds one of the five new
  // families (`hasG10CurveFamily`, set only for such a course) is documented
  // under "curve_sketcher_g10" instead — the wider entry, never folded into
  // the original so every Prep-3 lesson's prompt (which never sets this flag)
  // stays byte-identical.
  const widgetDocs =
    own == null
      ? mathWidgetDocs(data.slug, a)
      : mathWidgetDocsNamed(
          data.hasG10CurveFamily ? own.map((w) => (w === "curve_sketcher" ? "curve_sketcher_g10" : w)) : own,
          a
        );

  return `CITATIONS: embed [[lo:${exLo}]] / [[q:${exQ}]] / [[page:${exPage}]] receipt markers after substantive claims, ids strictly from the LESSON DATA. Never inside $...$ math.

MESSAGE RHYTHM:
${rhythm}

INTERACTIVE DIRECTIVES (each on its OWN line; at most ONE interactive directive per message, always as its LAST beat — {{beat}} itself is a pause marker, not an interactive directive):
- {{show_question:q:${exQ}}} — pushes that live question card (ids from the QUESTION BANK only; each id at most once per session).
${widgetDocs}
  Every widget payload is FLAT JSON in exactly the shape shown, plain ASCII inside the JSON. Each one grades itself on the student's device and reports back — never state the answer in the same message you emit a widget in, and never emit one whose numbers you have not checked are reachable: a widget with an impossible target does not render at all, and the beat is simply lost.
- ${figureDirectivesDoc(exViz)}
  A figure counts as the ONE directive of its message. ${vizGuidance}
- {{finish_lesson}} — arms ${a.their} Finish button (shown both in the header and as a chat chip); tapping it is what triggers the comprehension report, not this marker. Emit it alone on the final line of your LAST message only.
Results of widgets and questions arrive as "[live event]" lines — ALWAYS adapt your next beat to the latest result.

${crossSubjectRule(data)}

FORMAT: plain short paragraphs, inline math in $...$ (LaTeX). No headings, no numbered lesson plans, no walls of text.`;
}

/**
 * The LANGUAGE & VOICE contract lives on the subject's registry entry
 * (lib/subjects.ts) — one voice per subject, no per-session lottery
 * (ADR-0004 Wave 0). A subject whose contract has not been authored yet has
 * no voice to borrow, so this throws instead of silently teaching it in
 * another subject's language.
 */
function languageContract(subject: Subject, facts?: CourseTutorFacts): string {
  const contract = subjectDef(subject).languageContract;
  if (contract == null) {
    throw new Error(
      `No LANGUAGE & VOICE contract for subject "${subject}" — author it on ` +
        `its entry in lib/subjects.ts before teaching it.`
    );
  }
  // An English-only course (decision 9) says so in one extra line; every
  // course with its Arabic touches reads the subject's contract unchanged.
  return facts && !facts.arabicTouches ? `${contract}\n${ENGLISH_ONLY.languageLine}` : contract;
}

/**
 * THE ENGLISH-ONLY VOICE (feature 003, Samuel's decision 9 of 2026-09-25:
 * "English only" for the Grade 10 course; `CourseTutorFacts.arabicTouches`).
 *
 * The maths prompts carry a few Egyptian-Arabic touches — the review opener
 * «فهمت كله؟ حلو», the Arabic closing example, the «لسه مش فاهم» name of the
 * still-confused signal and the address block's Arabic line — written for a
 * National student. A course that turns them off gets these English lines in
 * their places, and one explicit line in the language contract, so the model
 * is not left to infer from "an Egyptian grade-10 student" that a little
 * Arabic is welcome. The student is still described as Egyptian: that is who
 * she is, and it is not a language instruction. Every National prompt keeps
 * its touches, byte for byte (ADR-0020's hold).
 */
const ENGLISH_ONLY = {
  reviewOpenerEg: `"Got all of it? Nice — let's lock it in. 3 minutes ⏱"`,
  closingEg: (firstName: string) =>
    `${firstName ? `Nice work, ${firstName}` : "Nice work"} — that's the revision done, and the Finish button is there whenever you're ready.`,
  languageLine:
    "- English only in this course: write no Arabic at all — no Arabic greeting, interjection, praise or sign-off — even if the student writes to you in Arabic.",
} as const;

/**
 * HARD GROUNDING RULES for the learn prompt, per subject. Social studies adds
 * the book-wins rule, the outside-book acknowledge→decline→redirect script,
 * the sensitive-content hard rule (ADR-0004 §5) and the model-answer-only
 * clause (docs/specs/social-studies-ai-pipeline.md §3.2).
 */
function socialGroundingRules(data: LessonData): string {
  return `HARD GROUNDING RULES (non-negotiable):
1. Teach ONLY the ${data.los.length} learning objectives in the LESSON DATA below, in order. Never drift into other lessons, terms or grades.
2. لا تذكر أي معلومة تاريخية أو جغرافية — تاريخ، رقم، اسم، مكان، سبب، نتيجة — غير واردة نصًا في بيانات الدرس (الإجابات النموذجية وأوصاف الأهداف والمصطلحات). معلوماتك العامة عن التاريخ والجغرافيا لا وجود لها في هذه الجلسة: كتاب الوزارة وحده هو الحقيقة. THE BOOK'S STATEMENT WINS even when you believe the world disagrees: حتى لو كنت تعتقد أن الرقم أو الرواية في الكتاب غير دقيقة، فكلام الكتاب هو الإجابة الصحيحة في الامتحان — الامتحان يصحَّح من الكتاب، والاستشهاد بالصفحة [[page:N]] واجب.
3. الإجابة النموذجية هي المسار الوحيد المسموح به للحقائق: when walking through any question, follow its HUMAN-REVIEWED model answer (الإجابة النموذجية) claim-steps exactly — a different pedagogical angle is allowed, different or additional FACTS are not, and never change a final answer. Every claim-bearing beat carries its [[page:N]]. If you cannot phrase a re-explanation without contradicting a model-answer fact, give the claim-steps verbatim instead.
4. OUTSIDE THE BOOK — acknowledge → decline → redirect, in that exact order, always: إذا سأل عن معلومة غير واردة في بيانات الدرس، رحِّب بالسؤال، ثم وضِّح أننا نذاكر من كتاب الوزارة فقط لأنه أساس الامتحان، ثم وجِّهه لأقرب معلومة واردة فعلًا مع الاستشهاد. النمط: «سؤال حلو — بس ده مش في كتاب الوزارة بتاعنا، وإحنا بنذاكر من الكتاب بس عشان ده اللي جاي في الامتحان. اللي الكتاب بيقوله عن الموضوع ده هو: … [[page:N]]». NEVER answer first and disclaim after — the ungrounded answer must never be produced at all. And never claim «لا أعرف» — the honest framing is «إحنا بنذاكر من الكتاب».
5. SENSITIVE CONTENT (hard rule): historical and political material is explained strictly as the book presents it — no commentary of your own, no modern political parallels, no evaluative judgments beyond the book's own framing. عرض الكتاب كما هو: بلا رأي شخصي، وبلا إسقاط على الحاضر، وبلا حكم قيمي زائد على صياغة الكتاب نفسه.`;
}

/** ARABIC grounding rules (ADR-0006). Differs from social deliberately:
 *  the sacred-containment rule is added, and ADR-0004 §5's "no evaluative
 *  judgment" rule is NOT copied — this syllabus asks for the student's own
 *  رأي in marked places (ADR-0006 "must change before extraction" list). */
function arabicGroundingRules(data: LessonData): string {
  return `HARD GROUNDING RULES (non-negotiable):
1. Teach ONLY the ${data.los.length} learning objectives in the LESSON DATA below, in order. Never drift into other lessons, terms or grades.
2. اللغة تُدرَّس من الكتاب وحده: كل قاعدة نحوية أو إملائية تستند إلى سطر قاعدة مطبوع في بيانات الدرس مع [[page:N]]، وكل إعراب يتبع النموذج المعتمد للسؤال (الخانات المنفصلة: الموقع/الحالة/العلامة/نوعها) — لا تشتق إعرابًا من معرفتك العامة، ولا تتجاوز ما دُرِّس: النحو تراكمي، وما لم يطبعه هذا الدرس أو دروسه السابقة لا وجود له في الجلسة.
3. ⚠ SACRED TEXT — الحكم القاطع: نص الآيات والأحاديث معروض للطالب في بطاقة النص أول المحادثة من الحافظة الموثقة، ويمكنك إعادة عرضه داخل الحوار بـ {{show_passage:…}}. لا تكتب نص القرآن أو الحديث بنفسك أبدًا — لا في الشرح، ولا داخل أي {{…}} — ولا "تصحّحه" ولا تكمله من ذاكرتك؛ أشر إليه برقم الآية. أي رد يتضمن ٣ كلمات متتالية فأكثر من النص المختوم يُلغى آليًا. مفردات المعجم المفردة (هَوْنًا، غَرَامًا) مسموح بها في الشرح.
4. OUTSIDE THE BOOK — acknowledge → decline → redirect, in that exact order: إذا سأل عن قاعدة أو نص غير وارد في بيانات الدرس، رحِّب بالسؤال، ثم وضِّح أننا نذاكر من كتاب الوزارة لأنه أساس الامتحان، ثم وجِّهه لأقرب قاعدة أو شاهد وارد فعلًا مع [[page:N]]. NEVER answer first and disclaim after.
5. رأي الطالب: حيث يطلب الكتاب رأيًا شخصيًا أو قيمًا مستفادة، رحِّب برأي الطالب وناقشه بدفء — الرأي له، والحقائق اللغوية والبلاغية للكتاب. قوِّم لغة رأيه بلطف إن أخطأ في صياغتها.`;
}

/** MATHEMATICS grounding rules — the original two-rule text, byte for byte. */
function mathGroundingRules(data: LessonData): string {
  return `HARD GROUNDING RULES:
1. Teach ONLY the ${data.los.length} learning objectives in the LESSON DATA below, in order. Every mathematical claim must be derivable from the LO descriptions and the canonical solutions provided. Never invent other methods, notations, or topics.
2. When walking through any exercise, follow its HUMAN-REVIEWED CANONICAL SOLUTION steps exactly — never change a final answer.`;
}

/** Extra review-mode rule bullets for social studies (maths gets none — its
 *  review prompt stays byte-identical to the single-subject original). */
const SOCIAL_REVIEW_RULES = (a: AddressForms) => `
- كلام الكتاب هو الصواب دائمًا: corrective lines come ONLY from that question's model answer (الإجابة النموذجية), cited [[page:N]] — never from your general knowledge. The book's statement wins even when you believe the world disagrees.
- Off-book question from ${a.them}: acknowledge → decline → redirect to the nearest in-book claim with [[page:N]] — never answer-then-disclaim. Historical/political material: strictly the book's own framing — no commentary, no modern parallels, no evaluative judgments.`;

/** Extra review-mode rule bullets for Arabic — the sacred containment and the
 *  rule-line citation discipline survive review mode too. */
const ARABIC_REVIEW_RULES = (a: AddressForms) => `
- كل تصويب نحوي أو إملائي يستند إلى سطر القاعدة المطبوع أو النموذج المعتمد للسؤال، مع [[page:N]] — أبدًا من معرفتك العامة.
- ⚠ النص القرآني/الحديث لا يُكتب بيدك أبدًا، لا في الشرح ولا في أي {{…}} — أشر إلى بطاقة النص المختومة ورقم الآية. مفردات المعجم المفردة مسموح بها.
- Off-book question from ${a.them}: acknowledge → decline → redirect to the nearest in-book rule with [[page:N]] — never answer-then-disclaim.`;

/* ------------------------------------------------------------------ */
/* The per-subject prompt kit                                          */
/* ------------------------------------------------------------------ */

/**
 * Everything the lesson prompts need to know about a subject that is NOT a
 * plain fact on its registry entry: the rule text, the directive catalogue and
 * the content-pipeline capabilities. One kit per subject — the prompt builders
 * below contain no `subject === "…"` tests at all.
 */
interface LessonPromptKit {
  /** LESSON DATA: what this subject's reviewed answer path is called */
  solutionLabel: string;
  /** LESSON DATA: how the question bank is introduced */
  bankNote: string;
  /**
   * LESSON DATA header: how the source book is named. `facts` is the
   * course's registry entry — its `lessonBookName` is the unnamed form
   * ("Egyptian ministry textbook", or "this book" for Grade 10).
   */
  bookName: (docTitle: string | null, facts: CourseTutorFacts) => string;
  /** resolve the course's real book title (source_documents) for the header */
  namesSourceBook: boolean;
  /** append the base-map gazetteer to the data block (map-based figures) */
  usesGazetteer: boolean;
  /** learn mode injects the reviewed teaching script (content bundles exist) */
  usesTeachingScript: boolean;
  groundingRules: (data: LessonData) => string;
  /** extra review-mode rule bullets ("" when the subject adds none) */
  reviewSubjectRules: (a: AddressForms) => string;
  protocol: (
    rhythm: string,
    ex: ProtocolExamples,
    data: LessonData
  ) => string;
  /** learn mode: the extra "teach from the script" paragraph ("" if none) */
  learnRichNote: (data: LessonData) => string;
  /** review mode: the example opener line */
  reviewOpenerEg: string;
  /** review mode: the single widget/visual moment */
  reviewWidgetMoment: (data: LessonData) => string;
}

/**
 * Keyed by the registry-derived `Subject` union, so adding a subject to
 * lib/subjects.ts makes THIS table fail to compile until someone decides what
 * that subject's tutor sounds like. `null` = deliberately not authored yet.
 */
const LESSON_PROMPTS: Record<Subject, LessonPromptKit | null> = {
  "math-en": {
    solutionLabel: "CANONICAL SOLUTION (v",
    bankNote:
      "each with its human-reviewed canonical solution — the ONLY permitted mathematical paths",
    bookName: (_docTitle, facts) => facts.lessonBookName,
    namesSourceBook: false,
    usesGazetteer: false,
    usesTeachingScript: false,
    groundingRules: mathGroundingRules,
    reviewSubjectRules: () => "",
    protocol: mathProtocol,
    learnRichNote: () => "",
    reviewOpenerEg: `"فهمت كله؟ حلو — let's lock it in. 3 minutes ⏱"`,
    reviewWidgetMoment: (data) => {
      const a = addressForms(data.gender, data.studentName);
      const visualMoment = `ONE visual moment: push the single most illustrative stored figure ({{widget:viz_ref:...}} from the FIGURE LIBRARY) and ask ${a.them} ONE quick question about what it shows — ${a.they} answer${a.s} in chat.`;
      if (isGeoLesson(data)) return visualMoment;
      const own = ownUnitWidgets(data);
      // Prep-3 (the unit map): the moment it has always had, byte for byte.
      if (own == null) {
        return `ONE widget moment: {{widget:product_builder:{"X":[1,2],"Y":[4,5],"prompt":"Last one - build X x Y yourself"}}} (or a pair_plotter / stored figure if it fits this lesson better).`;
      }
      // A course that names its own unit's widgets (Grade 10): only those
      // (FR-1209) — product_builder is Prep-3's Unit 1, not this book's.
      if (own.length > 0) {
        return `ONE widget moment: one of this unit's own widgets (${own.join(" / ")}), in exactly the payload shape documented under INTERACTIVE DIRECTIVES below, or a stored construction from the QUESTION BANK pushed with {{show_question:...}} (or a stored figure from the FIGURE LIBRARY if it fits this lesson better).`;
      }
      if (data.visuals.length > 0) return visualMoment;
      return `ONE last check instead of a widget (this unit has none): {{show_question:...}} with a standard-tier question from the QUESTION BANK that you have not used yet.`;
    },
  },

  "social-ar": {
    solutionLabel: "MODEL ANSWER WITH EVIDENCE (الإجابة النموذجية — v",
    bankNote:
      "each with its human-reviewed model answer — الإجابة النموذجية بالأدلة — the ONLY permitted factual path",
    bookName: (docTitle, facts) =>
      docTitle ? `كتاب الوزارة «${docTitle}»` : facts.lessonBookName,
    namesSourceBook: true,
    usesGazetteer: true,
    usesTeachingScript: true,
    groundingRules: socialGroundingRules,
    reviewSubjectRules: SOCIAL_REVIEW_RULES,
    protocol: socialProtocol,
    learnRichNote: (data) =>
      `\n\nYOUR SCRIPT: teach FROM the TEACHING SCRIPT in the LESSON DATA below — it is your reviewed narrative for THIS exact lesson. Turn each objective's passage into a short chain of beats (اشرح فكرة صغيرة → افحص بسؤال/تفاعل → كيّف حسب رده), never a wall and never read verbatim. Weave «الأخطاء الشائعة» in as gentle trap-checks that surface ${addressForms(data.gender, data.studentName).their} misunderstanding, then correct it. Open by greeting ${data.studentName.split(" ")[0]} by name and naming today's lesson in one warm line.`,
    reviewOpenerEg: `"فهمت كله؟ حلو — يلا نثبّته في ٣ دقايق ⏱"`,
    reviewWidgetMoment: () =>
      `ONE widget moment: {{widget:term_match:{"prompt":"آخر واحدة — وصّل المصطلح بمعناه","pairs":[…2–3 pairs, terms and definitions VERBATIM from the LESSON DATA…]}}} (or a locate_on_map / stored map figure if it fits this lesson better — gazetteer names only).`,
  },

  // Wave B (ADR-0006): Arabic teaches from the sealed passages + printed rule
  // lines. The answer paths are TYPED (إعراب slots, closed rhetoric enums), so
  // most grading is client-side; the tutor's job is the warm walk-through —
  // and it may NEVER type scripture (sealed-card display only).
  "arabic-ar": {
    solutionLabel: "MODEL ANSWER (الإجابة النموذجية — v",
    bankNote:
      "each with its human-reviewed answer record — typed إعراب slots / closed rhetoric labels — the ONLY permitted answer path",
    bookName: (docTitle, facts) =>
      docTitle ? `كتاب الوزارة «${docTitle}»` : facts.lessonBookName,
    namesSourceBook: true,
    usesGazetteer: false,
    usesTeachingScript: true,
    groundingRules: arabicGroundingRules,
    reviewSubjectRules: ARABIC_REVIEW_RULES,
    protocol: arabicProtocol,
    learnRichNote: (data) =>
      `\n\nYOUR SCRIPT: teach FROM the TEACHING SCRIPT in the LESSON DATA below — it is your reviewed narrative for THIS exact lesson. النص الأساسي (الآيات/القصيدة) معروض للطالب في بطاقة النص أول المحادثة من الحافظة الموثقة: علِّم منه بالإحالة إلى أرقام الآيات/الأبيات و{{show_passage:…}} ولا تكتبه أبدًا. Turn each objective into a short chain of beats (اشرح فكرة صغيرة → افحص بسؤال/تفاعل → كيّف حسب رده). Open by greeting ${data.studentName.split(" ")[0]} by name and naming today's lesson in one warm line.`,
    reviewOpenerEg: `"فهمت كله؟ حلو — يلا نثبّته في ٣ دقايق ⏱"`,
    reviewWidgetMoment: () =>
      `ONE widget moment: {{widget:term_match:{"prompt":"آخر واحدة — وصّل الكلمة بمعناها","pairs":[…2–3 pairs VERBATIM from معاني المفردات in the LESSON DATA…]}}} (or a hamza_seat / irab_builder if it fits this lesson better — payloads grounded in the printed rule lines).`,
  },
};

/** The subject's prompt kit, or a loud failure. Never another subject's. */
function lessonPromptKit(subject: Subject): LessonPromptKit {
  const kit = LESSON_PROMPTS[subject];
  if (!kit) {
    throw new Error(
      `Subject "${subject}" has no lesson prompt contract yet — add one to ` +
        `LESSON_PROMPTS in lib/lesson.ts. Refusing to teach it as another subject.`
    );
  }
  return kit;
}

/**
 * The learn-mode system prompt.
 *
 * `probing` is this lesson's Socratic-probing snapshot (ADR-0021), resolved
 * ONCE when the learning session was created and read back from the session
 * row — never a request flag, and never re-resolved here. It is required
 * rather than defaulted so no caller can build a prompt without having
 * decided. `false` renders the prompt v0.6.0 sent, byte for byte
 * (`probing-prompts.test.mts`).
 */
export function learnPrompt(data: LessonData, probing: boolean): string {
  const kit = lessonPromptKit(data.subject);
  // the course's facts: its Arabic touches, or none (decision 9)
  const facts = tutorFacts(data.courseId);
  // The register this student is addressed in (FR-2602). Every pronoun below
  // reads from it; there is no longer a literal one anywhere in this prompt.
  const a = addressForms(data.gender, data.studentName);
  const arc = data.los
    .map((l, i) => `${l.id} "${l.label}" (${i === data.los.length - 1 ? "1–2" : "2–3"} messages)`)
    .join(" → ");
  // the subject's tap-only widgets (registry) — what a stuck student gets next.
  // A course that names its own unit's widgets offers only the tap widgets
  // among them (FR-1209); Prep-3 offers the subject's list, as before.
  const own = ownUnitWidgets(data);
  const taps = subjectDef(data.subject).tapWidgets.filter(
    (w) => own == null || own.includes(w)
  );
  const tapWidgets = ["figure", ...taps].join(" / ");
  const rhythm = `- Every message is 2–4 beats, separated by {{beat}} alone on its own line ({{beat}} renders as a natural writing pause, never as text).
- One beat = at most 2 short sentences (≤25 words total), OR one figure directive, OR one interactive directive.
- The LAST beat of a message is an ASK, with nothing after it — end every message with something for ${a.them} to do or answer. An ask is EITHER an interactive directive (widget or check question) OR an OPEN QUESTION typed in plain words that ${a.they} answer${a.s} by typing back. Both count. Neither is the default.
- THE OPEN QUESTION IS A REAL MOVE, NOT A FALLBACK. "What do you think happens if we double it?", "Why did that one work and this one didn't?", "Where would you start?" — a question with no card attached, that ${a.they} answer${a.s} in ${a.their} own words. Reach for it when you want ${a.their} REASONING; reach for a card or widget when you want a checkable answer. A lesson that never asks an open question has not taught, it has quizzed.
- NEVER STATE A STEP YOU HAVEN'T ASKED ${a.them.toUpperCase()} TO TRY. When a new idea or step is coming, ask ${a.them} for it first — even when you are almost sure ${a.they} cannot get it. ${a.Their} wrong attempt is what makes your explanation land; your explanation landing first makes ${a.their} attempt pointless. Introduce, ask, wait for ${a.their} answer, THEN confirm or correct. The only exception is the very first definition of something ${a.they} ${a.has} no way to guess.
- ASK FOR THE WORKING, NOT ONLY THE ANSWER. After an attempt — right or wrong — ask HOW ${a.they} got there at least once per objective: "how did you get that?", "what did you do first?". When ${a.they} give${a.s} you part of a solution with no final answer, WORK WITH THE PART ${a.they.toUpperCase()} GAVE YOU: say what is right about it, name the next step as a question, and never reply that you need the final answer first. A student showing ${a.their} steps is the best thing that can happen in this lesson.
- ONE IDEA PER BEAT WHEN EXPLAINING. An explanation of more than one step is split across beats with {{beat}} between them, each beat one move of the reasoning — never a single paragraph carrying the whole chain.
- The very FIRST message of the lesson has no [live event] yet — there is nothing to react to. Open with upbeat energy for the topic itself (see your opening instructions above), not a reaction to anything.
- THE QUESTION UNDER DISCUSSION IS ALWAYS THE MOST RECENT ONE YOU PUSHED. The whole QUESTION BANK is in your context and every question you have already used is still sitting in the transcript above — explaining an EARLIER one is the single easiest mistake to make here, and from ${a.their} side it looks like you stopped listening. Before you react to a [live event], check its question id against the last {{show_question}} you emitted. Never explain a question ${a.they} ${a.has} already moved past unless ${a.they} ask${a.s} you to go back to it.
${learnWrongAnswerRules(a, tapWidgets, probing, facts.arabicTouches)}
- Never repeat a widget, figure or question ${a.they} already saw.
- Closing message: one-line recap beat of the big ideas, then a line telling ${a.them} plainly this is the end of today's lesson and ${a.they} can finish whenever ${a.they}${a.isContr} ready, then {{finish_lesson}}. {{finish_lesson}} only arms ${a.their} Finish button — it doesn't end the session, so if ${a.they} keep${a.s} chatting after it, keep answering normally.`;
  const richNote = kit.learnRichNote(data);
  const firstName = data.studentName.split(" ")[0];
  const { premise, job } = learnOpeningFrame(
    deriveMasteryStage(data.los),
    firstName,
    data.gender
  );
  const gradeAdj = lowerGrade(data.grade).replace(" ", "-");
  return `You are ${data.studentName}'s personal AI tutor at Noor. ${a.They} ${a.is} an Egyptian ${gradeAdj} student who just came home from school. Today's lesson is ${data.lessonRef} — ${data.title} (${data.moduleLabel}) — ${premise}. Your job: ${job}, one short message of small beats at a time — as if you are writing to ${a.them} and drawing for ${a.them}.

TONE: upbeat, playful and curious throughout, whatever the stage — like exploring something interesting together, never clinical.${richNote}

${kit.groundingRules(data)}

${languageContract(data.subject, facts)}

LESSON ARC: greet ${a.them} in one line and start immediately → ${arc} → FINAL RETRIEVAL, then closing recap message with {{finish_lesson}}.
FINAL RETRIEVAL is its own message and it is not optional: before any recap, ask ${a.them} to bring back today's main idea FROM MEMORY, in ${a.their} own words, with nothing on screen to copy from — "without scrolling up, tell me what a radius actually is" / "what was the trick we used, in your own words?". Not a question card, not a widget: an open question. Then react to what ${a.they} say${a.s}, and only then recap and finish. A lesson that ends by telling ${a.them} what ${a.they} learned has skipped the part that makes it stick.
If ${a.they} say${a.s} ${a.they} want${a.s} to stop, or a [live event] says ${a.they} tapped Finish, give one warm closing line then {{finish_lesson}}.

${sharedProtocol(data, rhythm)}`;
}

export function reviewPrompt(data: LessonData): string {
  const kit = lessonPromptKit(data.subject);
  const a = addressForms(data.gender, data.studentName);
  const picks = data.los.slice(0, 3);
  // English-only course (decision 9): English opener and closing examples.
  const facts = tutorFacts(data.courseId);
  const openerEg = facts.arabicTouches ? kit.reviewOpenerEg : ENGLISH_ONLY.reviewOpenerEg;
  const closingEg = facts.arabicTouches
    ? a.arClosingEg
    : ENGLISH_ONLY.closingEg(data.studentName.split(" ")[0] ?? "");
  const checkList = picks
    .map(
      (l, i) =>
        `${i + 1}. ${i === 0 ? `One warm opener line (e.g. ${openerEg}) + immediately` : "One-line reaction (max 12 words) +"} {{show_question:...}} with a ${i === 0 ? "basic" : "basic or standard"}-tier question from ${l.id}.`
    )
    .join("\n");
  const widgetMoment = kit.reviewWidgetMoment(data);
  const gradeAdj = lowerGrade(data.grade).replace(" ", "-");
  return `You are ${data.studentName}'s AI tutor at Noor. ${a.They} ${a.is} an Egyptian ${gradeAdj} student who came home saying ${a.they} understood today's lesson (${data.lessonRef} — ${data.title}, ${data.moduleLabel}) COMPLETELY. Respect that: do NOT teach, do NOT lecture, do NOT be annoying. This is a fast, warm, 3-minute lock-it-in revision.

HARD BUDGET: at most 5 messages total, then ${a.their} Finish button lights up (the session itself doesn't auto-end). Follow this script exactly:
${checkList}
${picks.length + 1}. One-line reaction + ${widgetMoment}
${picks.length + 2}. One-line warm wrap that also tells ${a.them} the revision is done and ${a.they} can finish whenever ${a.they}${a.isContr} ready (e.g. "${closingEg}") + {{finish_lesson}}.

RULES:
- Never more than ONE short line of prose per message. No explanations unless ${a.they} got it wrong — then ONE crisp corrective line taken from that question's canonical solution, and still move on.
- Question ids strictly from the QUESTION BANK, each used once, spread across the lesson's LOs.
- If a [live event] says ${a.they} tapped End now, skip straight to a one-line wrap + {{finish_lesson}}.${kit.reviewSubjectRules(a)}
- {{finish_lesson}} only arms ${a.their} Finish button — it doesn't end the session, so if ${a.they} keep${a.s} chatting after it, keep answering normally.

${languageContract(data.subject, facts)}

${sharedProtocol(
    data,
    "- Review messages are ONE beat — never emit {{beat}}. One short line + the directive."
  )}`;
}

/**
 * The rich, human-reviewed TEACHING SCRIPT the extraction pipeline emits
 * (tamheed → per-objective exposition → key terms → misconceptions). It rides
 * in the learn-mode data block so the AI teaches FROM the reviewed narrative —
 * turned into beats in its own voice — instead of improvising off bare LO
 * stubs. Misconceptions become check-traps. Social-only; math has no content
 * files, so its data block stays byte-identical.
 */
/** Sealed passages of the lesson (ADR-0006). The SURFACE displays them on
 *  السبورة from verified data; this block tells the tutor what is on screen
 *  and how to re-focus it ({{show_passage:<id>}}). In learn mode the text is
 *  included READ-ONLY so the tutor can actually discuss specific آيات/أبيات —
 *  the server-side containment guard (lib/sacred-guard.ts) aborts any turn
 *  that re-emits ≥4 consecutive words of it. */
function sealedPassagesBlock(
  passages: NonNullable<LessonContent["passages"]>,
  withText: boolean
): string {
  const rows = passages.map((p) => {
    const pointerEg = p.sacred
      ? `ظلِّل آية بـ {{show_passage:{"id":"${p.id}","unit":N}}}`
      : `ظلِّل مقطعًا بـ {{show_passage:{"id":"${p.id}","quote":"…كلماته حرفيًا…"}}}`;
    const head = `- ${p.id} «${p.title_ar}» (${p.kind}${
      p.citation_ref ? `، ${p.citation_ref}` : ""
    }، ${p.units.length} ${p.kind === "quran" ? "آيات" : "وحدات"}) — ${pointerEg}`;
    if (!withText) return head;
    const body = p.units
      .map((u) => `  ${u.printed_n ? `﴿${u.printed_n}﴾ ` : `(${u.n}) `}${u.text_ar}`)
      .join("\n");
    return `${head}\n${body}`;
  });
  return `

SEALED TEXT PASSAGES — معروضة للطالب في أول المحادثة، من الحافظة الموثقة (هي "بطاقة النص"):
${rows.join("\n")}
${withText ? '⚠ النص أعلاه للاطّلاع فقط كي تناقشه بدقة — يُمنَع منعًا باتًا نسخ أي مقطع منه (٣ كلمات متتالية فأكثر) إلى ردودك. الاستثناء الوحيد: حقل "quote" داخل {{show_passage:…}} لنصٍّ غير مقدس — انسخ فيه المقطع حرفيًا فيتظلَّل للطالب داخل البطاقة (لا يظهر ككلامك). النص المقدس لا استثناء له إطلاقًا: أشِر إليه برقم الآية ("unit") فقط؛ أي تجاوز يُلغي الرد آليًا.' : "أشِر إليها بالأرقام و{{show_passage:…}} — لا تكتب نصوصها أبدًا."}`;
}

function teachingScriptBlock(c: LessonContent): string {
  const subs = c.subtopics
    .filter((s) => s.exposition)
    .map((s) => `• ${s.title ? `[${s.title}] ` : ""}${s.exposition}`)
    .join("\n");
  if (!subs && !c.tamheed) return "";
  const terms = c.key_terms.length
    ? "\nمفاهيم أتعلمها (بتعريف الكتاب الحرفي — علّمها كما وردت):\n" +
      c.key_terms.map((t) => `- ${t.term_ar}: ${t.definition_ar}`).join("\n")
    : "";
  const misc = c.misconceptions.length
    ? "\nأخطاء شائعة (وظِّف كل واحدة كسؤال فخّ/فحص: اطرح الاعتقاد الخاطئ أو أمسكه إن ظهر، ثم صحّحه بلطف):\n" +
      c.misconceptions
        .map((m) => `- خطأ شائع: ${m.wrong}\n  الصواب: ${m.correction}`)
        .join("\n")
    : "";
  return `

TEACHING SCRIPT — النص التعليمي المُراجَع لهذا الدرس (كل جملة من الكتاب، بمراجعة بشرية). علِّم منه لكن بصوتك الدافئ وبأسلوبك التفاعلي: فكرة واحدة صغيرة في كل {{beat}}، لا تقرأه حرفيًا ولا تسرده دفعة واحدة، بل حوِّل كل فقرة إلى سلسلة (اشرح فكرة → فحص/تفاعل → كيّف حسب رده).
تمهيد: ${c.tamheed ?? ""}
شرح الأهداف (كل فقرة نصُّ تدريسِ هدفها بالترتيب):
${subs}${terms}${misc}`;
}

/**
 * AskContext for the lesson surfaces — same shape /api/ask already streams,
 * and **`null` when the lesson's course is not this student's to have**.
 *
 * The gate is inherited from `getLessonData` rather than restated here: a
 * tutor turn is the most expensive way to serve a lesson, and it must refuse
 * on exactly the same rule the page does. Two copies of that rule is how a
 * course stops being reachable by URL and stays reachable by asking about it.
 */
export async function buildLessonContext(
  mode: LessonMode,
  chatSession: string,
  lessonSlug?: string,
  /** the request's signed-in student (lib/student-context.ts) */
  studentId: number | null = null,
  /**
   * A worksheet the student photographed mid-lesson, to ground this turn on
   * (FR-205, PRD B10).
   *
   * The upload affordance lives in `ChatCore`'s composer, which is the composer
   * these two surfaces render — so the lesson is where a photograph is most
   * likely to be taken, and threading the id only into `buildAskContext` would
   * have left the control visible and its grounding dead on exactly the surface
   * that carries it. It reaches `retrieve()` below and nowhere else.
   */
  uploadId?: number,
  /** the caller's unit of work, when it has one open (`/api/ask`) */
  client?: PoolClient,
  /**
   * The learning session's stored Socratic-probing snapshot (ADR-0021) —
   * `sessions.probing`, as `/api/ask` read it back from the session row. The
   * one use-time rule is applied below (`effectiveProbing`: maths, learn mode,
   * or off), which can only narrow it. Absent is off: the prompt-capture
   * harness and every caller that has no session render the Off prompt.
   */
  probingSnapshot: boolean = false
): Promise<AskContext | null> {
  const data = await getLessonData(
    sanitizeLessonSlug(lessonSlug),
    studentId,
    client
  );
  if (!data) return null;
  const kit = lessonPromptKit(data.subject);
  // Map-based subjects append the gazetteer name lists of their referenced
  // base maps (≤2) so the model can only name places the hit-tester resolves.
  const gazetteer =
    kit.usesGazetteer && data.mapBases.length > 0
      ? await gazetteerBlock(data.mapBases)
      : "";
  // THE STUDENT'S SCOPE, for the two things below that reach OUTSIDE this
  // lesson's own course: the cross-subject bridges and the handoff rule
  // (FR-4006; the 2026-09-26 isolation audit). The lesson itself was admitted
  // by `getLessonData`'s gate above; a bridge's far end and a handoff's target
  // are other courses, and each is admitted only if she may see it. No
  // student (the capture harness) is the ungated scope: nothing is refused,
  // and both prompt goldens are unchanged.
  const scope = await resolveStudentScope(studentId, client);
  // Curated cross-subject bridges touching this lesson's LOs (§5). Fetched for
  // every subject — the connection is symmetric — and appended only when some
  // exist, so lessons without a bridge keep byte-identical data blocks. Both
  // ends must be courses she may see.
  const bridges = bridgeBlock(
    await getLessonBridges(data.los.map((l) => l.id), scope, client)
  );
  // The subjects a handoff may name: those with a course she may see. `null`
  // courses is the ungated harness scope — not narrowed, the rule as written.
  const taught: LessonData =
    scope.courses === null
      ? data
      : {
          ...data,
          handoffSubjects: SPINE_SUBJECT_KEYS.filter((k) =>
            scope.course(scope.courseForSubject(k))
          ),
        };
  // The rich teaching script grounds the AI-LED lesson (learn mode) only —
  // review stays a fast 3-minute lock-in, and not every subject's pipeline
  // emits content bundles (maths has none, so its data block is unchanged).
  const content = kit.usesTeachingScript
    ? await getLessonContent(data.slug)
    : null;
  const teaching =
    mode === "learn" && content ? teachingScriptBlock(content) : "";
  // Sealed passages (Arabic vertical): pinned on السبورة by the surface; the
  // tutor gets the ids (and, in learn mode, the read-only text) so it teaches
  // ON the card instead of referencing text the student cannot see.
  const passagesBlock = content?.passages?.length
    ? sealedPassagesBlock(content.passages, mode === "learn")
    : "";
  // The retrieval layer (FR-303): the student-model half of grounding, composed
  // in ONE place instead of assembled per surface. It renders to "" when there
  // is nothing retrieved, so a student with no profile and no library entries
  // produces a byte-identical prompt to the pre-retrieval build — any diff the
  // capture harness reports is then real retrieved content, not scaffolding.
  const retrieved = await retrieve(
    studentId,
    data.los.map((l) => l.id),
    { uploadId, client }
  );

  // Review mode never probes; learn mode probes only when the session's
  // snapshot says so AND this lesson's course may probe — the registry's
  // `probing` fact: Prep-3 maths, and not the Grade 10 course, whatever the
  // switch says (#53 P1-6: nothing in the probing block is translated or
  // written for another book; decision 7, FR-4212). A snapshot taken on a
  // Prep-3 maths lesson can meet another course's when a session is reused
  // across lessons, and this is the line that keeps it out.
  const probing =
    mode === "learn" && effectiveProbing(probingSnapshot, PROBING_SURFACE, data.courseId);

  return {
    systemPrompt: mode === "learn" ? learnPrompt(taught, probing) : reviewPrompt(taught),
    probing,
    dataBlock:
      lessonDataBlock(data) +
      gazetteer +
      bridges +
      passagesBlock +
      teaching +
      retrievalBlock(retrieved, { arabicAddress: tutorFacts(data.courseId).arabicTouches }),
    grounding: {
      lo_ids: data.los.map((l) => l.id),
      question_ids: data.questions.map((q) => q.id),
      pages: [
        ...new Set(
          data.los
            .map((l) => l.sourcePage)
            .filter((p): p is number => p != null)
        ),
      ],
      chat_session: chatSession,
      lesson: data.slug,
    },
  };
}

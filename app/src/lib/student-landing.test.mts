/**
 * WHICH SCREEN `/student` SHOWS — every branch, including the two that used to
 * be 404.
 *
 * **The landing rule itself has no FR** (see `lib/student-landing.ts`). The
 * lesson POINTER's branches do since 2026-09-24 — spec 002 wrote down what
 * ADR-0020 shipped without a requirement — and this file proves two of them:
 * a pointer not in her gated list reads as the first lesson, and neither
 * `?lesson=` nor the course gate yields to a pointer.
 *
 * @covers FR-3204
 * @covers FR-3206
 *
 * ---------------------------------------------------------------------------
 * THE TABLE THIS FILE EXISTS FOR
 * ---------------------------------------------------------------------------
 * Signed in correctly as a grade-9 student, asking for `/student` with no query
 * string at all. Before the fix:
 *
 *   courses live for this grade      GET /student
 *   ---------------------------      ------------
 *   all three                        the subject home
 *   two of three                     the subject home
 *   ONE                              404
 *   NONE                             404
 *
 * Both 404s had the same cause and it is written up in `student-landing.ts`:
 * with no `?subject=` the page never set a slug, so `getLessonData` applied its
 * own default — a MATHS lesson — and the course gate refused it for anybody who
 * may not see maths.
 *
 * The **zero row is the one that must never regress**. Under explicit allow, a
 * grade nobody has configured yet has no visible courses, so that row is not an
 * edge case: it is what every student in a new grade gets on the day they are
 * let in. A 404 there is a child locked out of her own product with nothing on
 * screen to explain it and nothing in the log to tell it apart from a mistyped
 * address.
 *
 * ---------------------------------------------------------------------------
 * TWO LAYERS, DELIBERATELY
 * ---------------------------------------------------------------------------
 * The first block drives `decideLanding` directly: it is pure, so every branch
 * is a line of arithmetic over plain objects.
 *
 * The second block drives the REAL `getLessonCatalog` against a fake
 * `PoolClient` — the technique and the fixture shape are `catalog-gate.test.mts`'s,
 * on purpose — and feeds its actual output into `decideLanding`. That is what
 * makes the zero row an end-to-end claim rather than a claim about a fixture I
 * wrote by hand: the availability rows go in, and the screen comes out.
 *
 * `AINEXT_COURSE_GATING` is set before the first import because `lib/env.ts`
 * resolves it once at module load.
 */

process.env.AINEXT_COURSE_GATING = "on";

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";

const { decideLanding } = await import("./student-landing.ts");
const { getLessonCatalog } = await import("./lesson.ts");

const STUDENT = 42;
const MATH = "course:prep3-math-en";
const SOCIAL = "course:prep3-social-ar";
const ARABIC = "course:prep3-arabic-ar";

/* ------------------------------------------------------------------ */
/* Layer 1 — the decision, on its own                                  */
/* ------------------------------------------------------------------ */

/** A gated catalogue entry, in the shape `getLessonCatalog` returns. */
const lesson = (slug: string, courseId: string, subject: string) => ({
  slug,
  courseId,
  subject,
});

const MATHS_LESSON = lesson("u1-1", MATH, "math-en");
const SOCIAL_LESSON = lesson("soc1-1", SOCIAL, "social-ar");
const ARABIC_LESSON = lesson("ara1-1", ARABIC, "arabic-ar");

/** `/student`, nothing in the query string. */
const bare = (lessons: ReturnType<typeof lesson>[]) =>
  decideLanding({ subject: undefined, courseId: null, lessonSlug: undefined, lessons });

test("all three subjects live → the subject home", () => {
  assert.deepEqual(bare([MATHS_LESSON, SOCIAL_LESSON, ARABIC_LESSON]), {
    screen: "subject-home",
  });
});

test("two subjects live → the subject home", () => {
  assert.deepEqual(bare([ARABIC_LESSON, SOCIAL_LESSON]), { screen: "subject-home" });
});

test("ONE subject live → that subject's check-in, not maths and not a 404", () => {
  // The old code asked for `u1-1` here — a maths lesson this student may not
  // see — and turned the gate's refusal into notFound().
  assert.deepEqual(bare([ARABIC_LESSON]), { screen: "check-in", slug: "ara1-1" });
});

test("NO subject live → the honest empty home, never a 404", () => {
  assert.deepEqual(bare([]), { screen: "nothing-yet" });
});

test("one subject, several lessons → the FIRST in teaching order", () => {
  const out = bare([ARABIC_LESSON, lesson("ara1-2", ARABIC, "arabic-ar")]);
  assert.deepEqual(out, { screen: "check-in", slug: "ara1-1" });
});

/* ------------------------------------------------------------------ */
/* The lesson pointer (ADR-0020), which must not bend the rules above  */
/* ------------------------------------------------------------------ */

test("pointer in her list → the check-in opens on it, not the first lesson", () => {
  const out = decideLanding({
    subject: undefined,
    courseId: null,
    lessonSlug: undefined,
    lessons: [ARABIC_LESSON, lesson("ara1-2", ARABIC, "arabic-ar")],
    pointer: "ara1-2",
  });
  assert.deepEqual(out, { screen: "check-in", slug: "ara1-2" });
});

test("a pointer NOT in her gated list is ignored — the first lesson, as before", () => {
  // A stale pointer, or one into a course the gate now hides, must never be
  // the way a slug from outside her list reaches the page.
  const out = decideLanding({
    subject: undefined,
    courseId: null,
    lessonSlug: undefined,
    lessons: [ARABIC_LESSON],
    pointer: "u1-4",
  });
  assert.deepEqual(out, { screen: "check-in", slug: "ara1-1" });
});

test("?lesson= beats the pointer (the 2026-07-30 field report)", () => {
  const out = decideLanding({
    subject: undefined,
    courseId: null,
    lessonSlug: "ara1-1",
    lessons: [ARABIC_LESSON, lesson("ara1-2", ARABIC, "arabic-ar")],
    pointer: "ara1-2",
  });
  assert.deepEqual(out, { screen: "check-in", slug: "ara1-1" });
});

test("a pointer never turns the subject home into a check-in", () => {
  const out = decideLanding({
    subject: undefined,
    courseId: null,
    lessonSlug: undefined,
    lessons: [MATHS_LESSON, SOCIAL_LESSON],
    pointer: "u1-1",
  });
  assert.deepEqual(out, { screen: "subject-home" });
});

test("a pointer never softens the refusal of a subject she may not see", () => {
  const out = decideLanding({
    subject: "math",
    courseId: MATH,
    lessonSlug: undefined,
    lessons: [ARABIC_LESSON],
    pointer: "u1-1",
  });
  assert.deepEqual(out, { screen: "refused" });
});

/* ------------------------------------------------------------------ */
/* The non-disclosure rule, which the fix must not soften              */
/* ------------------------------------------------------------------ */

test("?subject= naming a course this student may not see is refused", () => {
  // Her catalogue is Arabic only; the URL asks for maths. The answer must be
  // the same one a subject that does not exist gets, so a guessed value cannot
  // be used to discover which courses exist but are switched off.
  const out = decideLanding({
    subject: "math",
    courseId: MATH,
    lessonSlug: undefined,
    lessons: [ARABIC_LESSON],
  });
  assert.deepEqual(out, { screen: "refused" });
});

test("a student with nothing at all still gets the refusal for a named subject", () => {
  // The empty home is her home page. It is not an answer to a URL that asked
  // for something specific — that would tell her which subjects exist.
  const out = decideLanding({
    subject: "math",
    courseId: MATH,
    lessonSlug: undefined,
    lessons: [],
  });
  assert.deepEqual(out, { screen: "refused" });
});

test("?subject= naming a course she CAN see opens it, home or no home", () => {
  const out = decideLanding({
    subject: "social",
    courseId: SOCIAL,
    lessonSlug: undefined,
    lessons: [MATHS_LESSON, SOCIAL_LESSON, ARABIC_LESSON],
  });
  assert.deepEqual(out, { screen: "check-in", slug: "soc1-1" });
});

test("?lesson= is carried through verbatim, and the gate downstream decides", () => {
  // Including a slug from a course she may not see: `getLessonData` refuses it
  // and the page 404s. Filtering it here would be a second copy of the gate on
  // the surface most likely to grow a new branch.
  const out = decideLanding({
    subject: undefined,
    courseId: null,
    lessonSlug: "u1-4",
    lessons: [ARABIC_LESSON],
  });
  assert.deepEqual(out, { screen: "check-in", slug: "u1-4" });
});

test("a ?lesson= link is honoured even when the home would otherwise show", () => {
  // Field report, 2026-07-30: "picking another lesson brings me back". The
  // picker's chips land here and must not be bounced to the home.
  const out = decideLanding({
    subject: undefined,
    courseId: null,
    lessonSlug: "soc1-2",
    lessons: [MATHS_LESSON, SOCIAL_LESSON, ARABIC_LESSON],
  });
  assert.deepEqual(out, { screen: "check-in", slug: "soc1-2" });
});

test("an unrecognised ?subject= is no choice at all — never silently maths", () => {
  // `courseIdOfSpineKey` answers null for a value the registry does not know,
  // and null means "nothing was chosen". The home appears, which is the screen
  // for a student who has not chosen.
  const out = decideLanding({
    subject: "chemistry",
    courseId: null,
    lessonSlug: undefined,
    lessons: [MATHS_LESSON, SOCIAL_LESSON],
  });
  assert.deepEqual(out, { screen: "subject-home" });
});

test("a course the registry does not know does not count towards the home", () => {
  // An unfiled course rolls up into no subject in `getSubjectSummaries`, so it
  // must not be counted as one here — or the home would render with a card
  // missing from it.
  const out = decideLanding({
    subject: undefined,
    courseId: null,
    lessonSlug: undefined,
    lessons: [ARABIC_LESSON, { slug: "x1-1", courseId: "course:unfiled", subject: null }],
  });
  assert.deepEqual(out, { screen: "check-in", slug: "ara1-1" });
});

/* ------------------------------------------------------------------ */
/* Layer 2 — from availability rows to the screen, through the real    */
/* catalogue                                                           */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

type Fixture = {
  grade: string | null;
  rules: { course_id: string; grade: string; state: string }[];
  overrides: { course_id: string; state: string }[];
};

const LO_ROWS: Row[] = [
  lo("lo:u1-1-1", "Ordered pairs", "module:u1", "Unit 1", MATH, "Mathematics"),
  lo("lo:soc1-1-1", "الموقع الفلكي", "module:soc1", "الوحدة ١", SOCIAL, "الدراسات الاجتماعية"),
  lo("lo:ara1-1-1", "المنادى", "module:ara1", "الوحدة ١", ARABIC, "اللغة العربية"),
];

function lo(
  id: string,
  label: string,
  moduleId: string,
  moduleLabel: string,
  courseId: string,
  courseLabel: string
): Row {
  return {
    id,
    label,
    description: `${label} — description`,
    syllabus_ref: "1-1",
    source_page: 8,
    order_in_parent: 1,
    module_id: moduleId,
    module_label: moduleLabel,
    module_order: 1,
    course_id: courseId,
    course_label: courseLabel,
  };
}

/**
 * The four reads `getLessonCatalog` makes under the gate, and nothing else.
 * Anything unexpected throws by name, so a query that should not have run is a
 * failure with the SQL in it rather than a silently empty result.
 */
function fakeClient(f: Fixture): PoolClient {
  const query = async (text: string) => {
    let rows: Row[] | null = null;
    if (text.includes("FROM course_availability")) rows = f.rules;
    else if (text.includes("FROM student_course_access")) rows = f.overrides;
    else if (text.includes("SELECT grade FROM students"))
      rows = f.grade === null ? [] : [{ grade: f.grade }];
    else if (text.includes("FROM graph_nodes lo")) rows = LO_ROWS;
    else if (text.includes("FROM mastery")) rows = [];
    if (rows === null) {
      throw new Error(`the catalogue should not have reached:\n${text.trim().slice(0, 160)}`);
    }
    return { rows, rowCount: rows.length };
  };
  // `release` is what `lib/lesson.ts` tests for to tell a PoolClient from a
  // Pool, so the fake must have it.
  return { query, release() {} } as unknown as PoolClient;
}

/** The catalogue this student actually gets, then the screen it produces. */
async function landingFor(f: Fixture) {
  const lessons = await getLessonCatalog(STUDENT, fakeClient(f));
  return {
    lessons: lessons.map((l) => l.slug),
    landing: decideLanding({
      subject: undefined,
      courseId: null,
      lessonSlug: undefined,
      lessons,
    }),
  };
}

test("end to end: three rules live → three lessons → the subject home", async () => {
  const out = await landingFor({
    grade: "9",
    rules: [
      { course_id: MATH, grade: "9", state: "live" },
      { course_id: SOCIAL, grade: "9", state: "live" },
      { course_id: ARABIC, grade: "9", state: "live" },
    ],
    overrides: [],
  });
  assert.deepEqual(out.lessons.sort(), ["ara1-1", "soc1-1", "u1-1"]);
  assert.deepEqual(out.landing, { screen: "subject-home" });
});

test("end to end: ARABIC ONLY → the Arabic check-in (was 404)", async () => {
  const out = await landingFor({
    grade: "9",
    rules: [{ course_id: ARABIC, grade: "9", state: "live" }],
    overrides: [],
  });
  assert.deepEqual(out.lessons, ["ara1-1"]);
  assert.deepEqual(
    out.landing,
    { screen: "check-in", slug: "ara1-1" },
    "a student whose only subject is Arabic must land on Arabic, not on a maths slug"
  );
});

test("end to end: NO rule for this grade → the empty home (was 404)", async () => {
  // A grade nobody has configured. This is the ordinary state of a new grade
  // under explicit allow, and it must never be a 404 again.
  const out = await landingFor({ grade: "9", rules: [], overrides: [] });
  assert.deepEqual(out.lessons, []);
  assert.deepEqual(out.landing, { screen: "nothing-yet" });
});

test("end to end: no grade on the student at all → the empty home, not an error", async () => {
  const out = await landingFor({
    grade: null,
    rules: [{ course_id: MATH, grade: "9", state: "live" }],
    overrides: [],
  });
  assert.deepEqual(out.lessons, []);
  assert.deepEqual(out.landing, { screen: "nothing-yet" });
});

test("end to end: a per-student override alone is enough to land somewhere", async () => {
  // The other half of the empty assertions: a landing that answered
  // "nothing-yet" unconditionally would pass all of them and break the product.
  const out = await landingFor({
    grade: "9",
    rules: [],
    overrides: [{ course_id: SOCIAL, state: "live" }],
  });
  assert.deepEqual(out.lessons, ["soc1-1"]);
  assert.deepEqual(out.landing, { screen: "check-in", slug: "soc1-1" });
});

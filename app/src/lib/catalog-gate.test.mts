/**
 * The student-side course gate, exercised through the REAL functions.
 *
 * The course gate's requirements exist now (002's FR-2701…FR-2711; 003's
 * curriculum dimension), so this file says what it proves. The 003 block at
 * the end runs a National and an American student, and a tester whose
 * exception crosses curricula, through the same real functions with the gate
 * ON; `catalog-gate-off.test.mts` does the same with it OFF (FR-4015).
 *
 * @covers FR-2705, FR-2706, FR-4006, FR-4009
 *
 * ---------------------------------------------------------------------------
 * WHY A FAKE CLIENT AND NOT A FAKE RULE
 * ---------------------------------------------------------------------------
 * `lib/catalog.test.mts` proves the rule. This file proves the WIRING — that
 * `getLessonCatalog`, `getSubjectSummaries` and `getLessonData` each actually
 * consult it — and wiring is exactly what a test of the pure rule cannot see.
 * A gate that is correct and unreachable looks identical to one that works.
 *
 * So these tests call the shipped functions and hand them a `PoolClient` whose
 * `query` answers from fixtures. `scoped()` reuses a client it is given, so
 * every read in the call — the objectives, the mastery, the availability rules
 * and the student's own overrides — lands on the fake, in the real order, with
 * the real SQL.
 *
 * **The fake THROWS on a query it was not expecting, and that is a load-bearing
 * assertion rather than a convenience.** It is how the refusal test proves the
 * gate refuses *before* the question bank and the figure library are read: if
 * `getLessonData` ever fetched content first and filtered afterwards, the fake
 * would be asked for `questions` and the test would fail with the query that
 * should never have run.
 *
 * `AINEXT_COURSE_GATING` is set before the first import because `lib/env.ts`
 * resolves it once at module load — which is right for the application and
 * means a test process has to decide up front which side of the switch it is
 * proving. This one proves the gate ON; `catalog.test.mts` proves the switch
 * itself, both ways.
 */

process.env.AINEXT_COURSE_GATING = "on";

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";

const { getLessonCatalog, getLessonData } = await import("./lesson.ts");
const { getSubjectSummaries } = await import("./subject-queries.ts");

const STUDENT = 42;
const MATH = "course:prep3-math-en";
const SOCIAL = "course:prep3-social-ar";
const ARABIC = "course:prep3-arabic-ar";
const G10 = "course:us-g10-math-en";

type Row = Record<string, unknown>;

/** One objective per subject, each properly filed under its own course. */
const LO_ROWS: Row[] = [
  lo("lo:u1-1-1", "Ordered pairs", "module:u1", "Unit 1", MATH, "Mathematics"),
  lo("lo:soc1-1-1", "الموقع الفلكي", "module:soc1", "الوحدة ١", SOCIAL, "الدراسات الاجتماعية"),
  lo("lo:ara1-1-1", "المنادى", "module:ara1", "الوحدة ١", ARABIC, "اللغة العربية"),
  lo("lo:g10m1s1-1-1", "Simplify expressions", "module:g10m-c01", "Chapter 1 — Algebraic expressions", G10, "Mathematics"),
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

type Fixture = {
  grade: string | null;
  /** `students.curriculum_system`; National when left out */
  curriculum?: string;
  /** rows of `course_availability` for this environment */
  rules: { course_id: string; grade: string; state: string }[];
  /** rows of `student_course_access` for this student */
  overrides: { course_id: string; state: string }[];
};

/**
 * A `PoolClient` shaped like the one `withPrincipal` hands out, answering the
 * five reads this gate makes and refusing everything else by name.
 */
function fakeClient(f: Fixture): PoolClient {
  const query = async (text: string, values?: unknown[]) => {
    const rows = answer(text, values, f);
    if (rows === null) {
      throw new Error(
        `the gate should not have reached this query:\n${text.trim().slice(0, 200)}`
      );
    }
    return { rows, rowCount: rows.length };
  };
  // `release` is what `lib/lesson.ts` and `lib/subject-queries.ts` test for to
  // tell a PoolClient from a Pool, so the fake must have it.
  return { query, release() {} } as unknown as PoolClient;
}

function answer(text: string, values: unknown[] | undefined, f: Fixture): Row[] | null {
  // The availability rules and this student's overrides — `lib/catalog-queries`.
  if (text.includes("FROM course_availability")) return f.rules;
  if (text.includes("FROM student_course_access")) return f.overrides;

  // The gate's own narrow read of the grade, distinct from the full profile.
  if (text.includes("SELECT grade FROM students")) {
    return f.grade === null ? [] : [{ grade: f.grade }];
  }
  if (text.includes("FROM students WHERE id")) {
    return [
      {
        id: STUDENT,
        display_name: "Nour Adel",
        grade: f.grade,
        interests: [],
        interest_detail: null,
        language_pref: "en",
        curriculum_system: f.curriculum ?? "eg-national-en",
        gender: null,
      },
    ];
  }

  // The objectives, with or without the per-lesson LIKE narrowing.
  if (text.includes("FROM graph_nodes lo")) {
    const like = text.includes("lo.id LIKE") ? String(values?.[0] ?? "") : null;
    if (!like) return LO_ROWS;
    const prefix = like.replace(/%$/, "");
    return LO_ROWS.filter((r) => String(r.id).startsWith(prefix));
  }

  if (text.includes("FROM mastery")) return [];
  if (text.includes("FROM understanding_checks")) return [];
  // the book-section store (migration 034), read for the VISIBLE courses only
  // — no National course has a split section, so it holds nothing to change
  if (text.includes("FROM course_lessons")) return [];

  // `questions`, `visuals`, `source_documents` — content. Reaching any of them
  // from a refused lesson is the bug this returns null to catch.
  return null;
}

/** Maths live for Prep 3; social explicitly off; Arabic never mentioned. */
const SEEDED: Fixture = {
  grade: "9",
  rules: [
    { course_id: MATH, grade: "9", state: "live" },
    { course_id: SOCIAL, grade: "9", state: "hidden" },
  ],
  overrides: [],
};

/* ------------------------------------------------------------------ */
/* The catalogue                                                       */
/* ------------------------------------------------------------------ */

test("getLessonCatalog drops lessons from a hidden course", async () => {
  const out = await getLessonCatalog(STUDENT, fakeClient(SEEDED));
  assert.deepEqual(
    out.map((i) => i.slug),
    ["u1-1"],
    "only the live course's lesson survives"
  );
  assert.equal(out[0].courseId, MATH);
});

test("getLessonCatalog is not blanket-deny — an override adds a course back", async () => {
  // The other half of the previous assertion: a gate that returned nothing
  // would pass that test and break the product.
  const out = await getLessonCatalog(
    STUDENT,
    fakeClient({ ...SEEDED, overrides: [{ course_id: ARABIC, state: "live" }] })
  );
  assert.deepEqual(out.map((i) => i.slug).sort(), ["ara1-1", "u1-1"]);
});

test("a student with no grade sees no lessons at all", async () => {
  const out = await getLessonCatalog(STUDENT, fakeClient({ ...SEEDED, grade: null }));
  assert.deepEqual(out, []);
});

/* ------------------------------------------------------------------ */
/* The per-subject home                                                */
/* ------------------------------------------------------------------ */

test("getSubjectSummaries drops a hidden subject entirely", async () => {
  const out = await getSubjectSummaries(STUDENT, fakeClient(SEEDED));
  assert.deepEqual(
    out.map((s) => s.subject),
    ["math"],
    "a hidden subject must not appear even as a 0% card"
  );
});

test("getSubjectSummaries follows an override too", async () => {
  const out = await getSubjectSummaries(
    STUDENT,
    fakeClient({ ...SEEDED, overrides: [{ course_id: SOCIAL, state: "live" }] })
  );
  assert.deepEqual(out.map((s) => s.subject).sort(), ["math", "social"]);
});

/* ------------------------------------------------------------------ */
/* The direct URL — the part that makes this a gate                    */
/* ------------------------------------------------------------------ */

test("a direct read of a hidden lesson refuses, and reads no content first", async () => {
  // `?lesson=soc1-1` typed into the address bar. It never passes a catalogue,
  // so this call IS the gate. The fake throws on any `questions` or `visuals`
  // read, so a pass here also proves nothing was fetched before the refusal.
  const data = await getLessonData("soc1-1", STUDENT, fakeClient(SEEDED));
  assert.equal(data, null);
});

test("the refusal is not slug-shaped — the same lesson opens under an override", async () => {
  // Proves the previous test refused because of the COURSE, not because the
  // fixture happens to make every lesson unreachable.
  await assert.rejects(
    () =>
      getLessonData(
        "soc1-1",
        STUDENT,
        fakeClient({ ...SEEDED, overrides: [{ course_id: SOCIAL, state: "live" }] })
      ),
    /should not have reached this query[\s\S]*canonical_solution/i,
    "past the gate, the next thing read is the question bank"
  );
});

test("an ungated read (no student) is unchanged — the capture harness", async () => {
  // `studentId === null` is `scripts/capture-prompts.mts`, which renders every
  // prompt surface for the constitution IX byte-diff and has no student to
  // refuse. Gating it would empty the harness and blind the gate that watches
  // the prompts. It must reach the question bank for EVERY course.
  await assert.rejects(
    () => getLessonData("soc1-1", null, fakeClient(SEEDED)),
    /should not have reached this query[\s\S]*canonical_solution/i
  );
  const out = await getLessonCatalog(null, fakeClient(SEEDED));
  assert.deepEqual(out.map((i) => i.slug).sort(), ["ara1-1", "g10m1s1-1", "soc1-1", "u1-1"]);
});

/* ------------------------------------------------------------------ */
/* 003 — a second curriculum, through the same real functions           */
/* ------------------------------------------------------------------ */

/** Launch (decision 6): Prep-3 subjects live for grade 9, G10 for grade 10. */
const LAUNCH: Fixture = {
  grade: "9",
  rules: [
    { course_id: MATH, grade: "9", state: "live" },
    { course_id: SOCIAL, grade: "9", state: "live" },
    { course_id: ARABIC, grade: "9", state: "live" },
    { course_id: G10, grade: "10", state: "live" },
  ],
  overrides: [],
};
const AMERICAN_10: Fixture = { ...LAUNCH, grade: "10", curriculum: "us-american-en" };
const NATIONAL_10: Fixture = { ...LAUNCH, grade: "10", curriculum: "eg-national-en" };

test("003: a National student sees exactly her National courses — never the American book", async () => {
  const out = await getLessonCatalog(STUDENT, fakeClient(LAUNCH));
  assert.deepEqual(out.map((i) => i.slug).sort(), ["ara1-1", "soc1-1", "u1-1"]);
  const home = await getSubjectSummaries(STUDENT, fakeClient(LAUNCH));
  assert.deepEqual(home.map((s) => s.courseId), [MATH, SOCIAL, ARABIC]);
});

test("003: an American grade-10 student sees the Grade 10 book and nothing National", async () => {
  const out = await getLessonCatalog(STUDENT, fakeClient(AMERICAN_10));
  assert.deepEqual(out.map((i) => i.slug), ["g10m1s1-1"]);
  const home = await getSubjectSummaries(STUDENT, fakeClient(AMERICAN_10));
  assert.deepEqual(home.map((s) => [s.subject, s.courseId]), [["math", G10]]);
});

test("003: the same live G10 rule reaches no National grade-10 student", async () => {
  assert.deepEqual(await getLessonCatalog(STUDENT, fakeClient(NATIONAL_10)), []);
  assert.deepEqual(await getSubjectSummaries(STUDENT, fakeClient(NATIONAL_10)), []);
});

test("003: a direct read of the other curriculum's lesson refuses, before any content is read (FR-2706)", async () => {
  // an American student pasting a Prep-3 lesson, and a National one pasting a G10 lesson
  assert.equal(await getLessonData("u1-1", STUDENT, fakeClient(AMERICAN_10)), null);
  assert.equal(await getLessonData("g10m1s1-1", STUDENT, fakeClient(NATIONAL_10)), null);
  assert.equal(await getLessonData("g10m1s1-1", STUDENT, fakeClient(LAUNCH)), null);
  // …and her own opens: the next thing read is the question bank
  await assert.rejects(
    () => getLessonData("g10m1s1-1", STUDENT, fakeClient(AMERICAN_10)),
    /should not have reached this query[\s\S]*canonical_solution/i
  );
});

test("003: a National tester with the G10 book by exception sees both maths courses (FR-4009)", async () => {
  const tester: Fixture = { ...LAUNCH, overrides: [{ course_id: G10, state: "live" }] };
  const out = await getLessonCatalog(STUDENT, fakeClient(tester));
  assert.deepEqual(out.map((i) => i.slug).sort(), ["ara1-1", "g10m1s1-1", "soc1-1", "u1-1"]);
  await assert.rejects(
    () => getLessonData("g10m1s1-1", STUDENT, fakeClient(tester)),
    /should not have reached this query[\s\S]*canonical_solution/i
  );
});

test("003: an unknown stored curriculum sees nothing — not National by default (FR-4003)", async () => {
  const odd: Fixture = { ...LAUNCH, curriculum: "eg-national-ar" };
  assert.deepEqual(await getLessonCatalog(STUDENT, fakeClient(odd)), []);
  assert.equal(await getLessonData("u1-1", STUDENT, fakeClient(odd)), null);
});

/* ------------------------------------------------------------------ */
/* The 2026-09-26 isolation audit                                      */
/* ------------------------------------------------------------------ */

const { getLessonBridges } = await import("./subject-queries.ts");
const { resolveStudentScope } = await import("./catalog-queries.ts");

test("isolation: a tester's two maths courses are two home cards, in course order, never one merged card (FR-4009)", async () => {
  const tester: Fixture = { ...LAUNCH, overrides: [{ course_id: G10, state: "live" }] };
  const home = await getSubjectSummaries(STUDENT, fakeClient(tester));
  assert.deepEqual(home.map((s) => s.courseId), [MATH, SOCIAL, ARABIC, G10]);
  assert.deepEqual(home.map((s) => s.subject), ["math", "social", "arabic", "math"]);
  // named apart by their course labels, only because they share a subject
  assert.equal(home[0].courseLabel, "Mathematics — Prep 3");
  assert.equal(home[3].courseLabel, "Mathematics — Grade 10");
  assert.equal(home[3].defaultSlug, "g10m1s1-1", "the Grade 10 card leads into its own book");
  assert.equal(home[3].lessonsCount, 1, "no Prep-3 lesson folded into it");
  // a National student with one course per subject: the labels she always had
  const national = await getSubjectSummaries(STUDENT, fakeClient(LAUNCH));
  assert.deepEqual(national.map((s) => s.courseLabel), ["Mathematics", "الدراسات الاجتماعية", "اللغة العربية"]);
});

/** The rows the bridge reader's query returns, each end with its course. */
const BRIDGE_ROWS: Row[] = [
  {
    src_id: "lo:u1-1-1", dst_id: "lo:soc1-1-1", rationale: "coordinates on a map",
    src_label: "Ordered pairs", dst_label: "الموقع الفلكي", src_subject: "math", dst_subject: "social",
    src_course: MATH, dst_course: SOCIAL,
  },
  {
    src_id: "lo:g10m1s1-1-1", dst_id: "lo:u1-1-1", rationale: "the same algebra, another book",
    src_label: "Simplify expressions", dst_label: "Ordered pairs", src_subject: "math", dst_subject: "math",
    src_course: G10, dst_course: MATH,
  },
];

function bridgeDb(): PoolClient {
  const query = async (text: string) => {
    if (text.includes("information_schema.columns")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
    if (text.includes("edge_type = 'relates_to'")) return { rows: BRIDGE_ROWS, rowCount: BRIDGE_ROWS.length };
    throw new Error(`the bridge reader should not have reached this query:\n${text.trim().slice(0, 200)}`);
  };
  return { query, release() {} } as unknown as PoolClient;
}

test("isolation: a bridge reaches the tutor only when BOTH its courses are hers (FR-4006)", async () => {
  // Prep-3 maths and Social Studies visible: the Social Studies bridge, and not
  // the one into the Grade 10 book
  const national = await resolveStudentScope(STUDENT, fakeClient(LAUNCH));
  const n = await getLessonBridges(["lo:u1-1-1"], national, bridgeDb());
  assert.deepEqual(n.map((b) => b.otherLo), ["lo:soc1-1-1"]);
  // Social Studies hidden for her: no bridge carries it into her maths lesson
  const noSocial = await resolveStudentScope(STUDENT, fakeClient({ ...LAUNCH, overrides: [{ course_id: SOCIAL, state: "hidden" }] }));
  assert.deepEqual(await getLessonBridges(["lo:u1-1-1"], noSocial, bridgeDb()), []);
  // an American student: nothing National, whichever end is hers
  const american = await resolveStudentScope(STUDENT, fakeClient(AMERICAN_10));
  assert.deepEqual(await getLessonBridges(["lo:g10m1s1-1-1"], american, bridgeDb()), []);
  // the ungated harness scope (no student) is unchanged: every bridge
  const ungated = await resolveStudentScope(null);
  assert.equal((await getLessonBridges(["lo:u1-1-1"], ungated, bridgeDb())).length, 2);
});

/**
 * The student-side course gate, exercised through the REAL functions.
 *
 * **No `@covers` annotation** — this capability has no FR (see
 * `lib/catalog.ts`). Nothing in `traceability.md` was touched for it.
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

type Row = Record<string, unknown>;

/** One objective per subject, each properly filed under its own course. */
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

type Fixture = {
  grade: string | null;
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
        curriculum_system: "eg-national-en",
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
  assert.deepEqual(out.map((i) => i.slug).sort(), ["ara1-1", "soc1-1", "u1-1"]);
});

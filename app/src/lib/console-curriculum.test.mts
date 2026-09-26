/**
 * Curricula on the console (feature 003; contracts/console.md; tasks
 * T377–T382): who can see a student's curriculum, what the editor promises,
 * and that no console reader pools two courses of one subject.
 *
 *   · **`cost-billing` never sees a per-student curriculum** (FR-2406,
 *     FR-4104, privacy review F7). The students list is the one student page
 *     that role reaches, and its cost projection does not even SELECT the
 *     column; `/cost` and its read models never read it at all. The route
 *     matrix (`auth/matrix.test.mts`) keeps the 360 and the change endpoint
 *     `student-data`'s alone.
 *   · **The editor's question is the gate's answer** (FR-4010): what a student
 *     would see under each curriculum is `isCourseVisible` itself, and an
 *     exception follows her across curricula (FR-4009).
 *   · **No figure pools two courses** (FR-4104): a source guard over every
 *     console reader this feature touched — the Overview keys on the course,
 *     the Content page sums nothing across courses, `/pipeline` counts one
 *     course, and every console label names the course, not the subject.
 *   · **The editor asks in the page** (FR-2710): no native dialog anywhere in
 *     the console's curriculum and course controls.
 *
 *   · **Per lesson and per book section** (FR-4319, decision 18): a split
 *     section's parts roll up into one row computed from the parts' rows, in
 *     catalogue order.
 *
 * @covers FR-4010, FR-4104, FR-4105, FR-2406, FR-4319
 */
process.env.AINEXT_COURSE_GATING = "on";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

const { getStudentList, projectCurricula } = await import("./console-queries.ts");
const { addContentFigures, contentByLesson, rollUpBySection, sectionChecks } = await import(
  "./content-admin.ts"
);
const { NO_SECTIONS, buildSectionIndex, sectionProblems } = await import("./book-sections.ts");
const { courseName, coursesByCurriculum } = await import("./console-course-names.ts");
const { COURSE_IDS, PREP3_ARABIC_AR, PREP3_MATH_EN, PREP3_SOCIAL_AR, US_G10_MATH_EN } = await import(
  "./courses.ts"
);

const APP = fileURLToPath(new URL("../..", import.meta.url));
const code = (rel: string) =>
  readFileSync(APP + rel, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/* ------------------------------------------------------------------ */
/* The students list: the curriculum is the full projection's alone    */
/* ------------------------------------------------------------------ */

let listSql: string[] = [];
(globalThis as unknown as { pgOperatorPool: unknown }).pgOperatorPool = {
  connect: async () =>
    ({
      query: async (text: string) => {
        const t = text.replace(/\s+/g, " ").trim();
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(t) || t.startsWith("SELECT set_config")) return { rows: [] };
        listSql.push(t);
        // what Postgres would return for exactly the columns asked for
        const row: Record<string, unknown> = {
          id: 7,
          display_name: "Salma",
          grade: "10",
          gender: "f",
          student_status: "active",
          subscription_status: "none",
          account_status: "active",
          email_verified: true,
          last_seen_at: null,
          sessions_in_period: 0,
          cost_usd_in_period: 0,
        };
        if (t.includes("st.curriculum_system")) {
          row.curriculum_system = "us-american-en";
          row.curriculum_source = "chosen";
        }
        return { rows: [row] };
      },
      release() {},
    }) as unknown as PoolClient,
};

test("cost-billing's projection never selects a curriculum; student-data's does (F7, FR-4105)", async () => {
  listSql = [];
  const cost = await getStudentList(1, "cost");
  assert.equal(listSql.length, 1);
  assert.doesNotMatch(listSql[0], /curriculum/, "the cost projection's query carries no curriculum column");
  assert.equal(cost.rows[0].curriculum, null);
  assert.equal(cost.rows[0].curriculumSource, null);

  listSql = [];
  const full = await getStudentList(1, "full");
  assert.match(listSql[0], /st\.curriculum_system, st\.curriculum_source,/);
  assert.equal(full.rows[0].curriculum, "us-american-en");
  assert.equal(full.rows[0].curriculumSource, "chosen");
});

test("the list page prints the curriculum column only for the full projection", () => {
  const page = code("src/app/(console)/page.console.tsx");
  assert.match(page, /\{full && <Th>Curriculum<\/Th>\}/);
  assert.match(page, /\{full && \(\s*<td[^>]*>\s*<CurriculumCell/);
  // the grade in her curriculum's words only in the full projection; the cost
  // projection prints the stored year, which names no curriculum
  assert.match(page, /\{full \? gradeDisplayLabel\(s\.grade, s\.curriculum\) : s\.grade\}/);
});

test("nothing cost-billing reaches alone reads a student's curriculum (FR-2406, F7)", () => {
  for (const file of [
    "src/app/(console)/cost/page.console.tsx",
    "src/lib/cost-queries.ts",
    "src/lib/turn-threshold-queries.ts",
    "src/lib/upload-threshold-queries.ts",
  ]) {
    assert.doesNotMatch(code(file), /curriculum_system|curriculum_source|curriculumSystem/, file);
  }
});

/* ------------------------------------------------------------------ */
/* The editor's question: the gate's own answer, per curriculum        */
/* ------------------------------------------------------------------ */

const rules = [
  { courseId: PREP3_MATH_EN, grade: "9", state: "live" as const },
  { courseId: PREP3_SOCIAL_AR, grade: "9", state: "live" as const },
  { courseId: US_G10_MATH_EN, grade: "10", state: "live" as const },
];

test("a grade-10 National student sees nothing; American would show her the Grade 10 course", () => {
  const p = projectCurricula({ grade: "10", stored: "eg-national-en", rules, overrides: [] });
  assert.deepEqual(p.current, []);
  assert.deepEqual(p.byCurriculum["eg-national-en"], []);
  assert.deepEqual(p.byCurriculum["us-american-en"], [US_G10_MATH_EN]);
});

test("an exception follows her across curricula (FR-4009), and a hidden one holds", () => {
  const p = projectCurricula({
    grade: "9",
    stored: "eg-national-en",
    rules,
    overrides: [
      { courseId: US_G10_MATH_EN, state: "live" },
      { courseId: PREP3_SOCIAL_AR, state: "hidden" },
    ],
  });
  assert.deepEqual(p.current, [PREP3_MATH_EN, US_G10_MATH_EN]);
  assert.deepEqual(p.byCurriculum["us-american-en"], [US_G10_MATH_EN], "only the exception survives the switch");
});

test("an unknown stored value sees only exceptions (FR-4003); the kill switch keeps curriculum scoping (FR-4015)", () => {
  assert.deepEqual(projectCurricula({ grade: "9", stored: "american", rules, overrides: [] }).current, []);
  const off = projectCurricula({
    grade: "7",
    stored: "eg-national-en",
    rules: [],
    overrides: [],
    switchedOff: { loaded: new Set([PREP3_MATH_EN, PREP3_ARABIC_AR, US_G10_MATH_EN]) },
  });
  assert.deepEqual(off.current, [PREP3_MATH_EN, PREP3_ARABIC_AR]);
  assert.deepEqual(off.byCurriculum["us-american-en"], [US_G10_MATH_EN]);
});

/* ------------------------------------------------------------------ */
/* Names: a course, never a subject                                    */
/* ------------------------------------------------------------------ */

test("every course has its own console name; two maths courses never share one", () => {
  const names = COURSE_IDS.map(courseName);
  assert.equal(new Set(names).size, names.length);
  assert.equal(courseName(PREP3_MATH_EN), "Mathematics — Prep 3 (National)");
  assert.equal(courseName(US_G10_MATH_EN), "Mathematics — Grade 10 (American)");
  assert.equal(courseName(null), "No course recorded");
  assert.equal(courseName("course:gone"), "unknown course (course:gone)");
  // grouped by curriculum, registry order, every course exactly once
  assert.deepEqual(
    coursesByCurriculum().flatMap((g) => g.courses),
    [...COURSE_IDS]
  );
});

/* ------------------------------------------------------------------ */
/* The pooling guard (FR-4104)                                         */
/* ------------------------------------------------------------------ */

test("the Overview keys every objective-scoped figure on the course, never the subject", () => {
  const q = code("src/lib/overview-queries.ts");
  assert.doesNotMatch(q, /ns\.subject\s*=|WHERE subject = /, "no subject-keyed objective read");
  assert.doesNotMatch(q, /GROUP BY ns\.subject|GROUP BY subject\b/);
  // attempts, mastery, the objective count and both heatmap reads
  assert.ok((q.match(/ns\.course_id = \$\d/g) ?? []).length >= 4, "course-keyed reads");
  assert.match(q, /FROM node_subject WHERE course_id = \$3/);
  assert.match(q, /export type CohortKey = \{\s*courseId: string;/);
  // the population is the course's curriculum's students, in every grade-scoped read
  assert.ok((q.match(/curriculum_system = \$\d/g) ?? []).length >= 8);
  const page = code("src/app/(console)/overview/page.console.tsx");
  assert.match(page, /href=\{`\/overview\?course=/, "the picker is a course picker");
  assert.doesNotMatch(page, /k\.subject/);
});

test("the Content page counts per course and never sums across courses", () => {
  const page = code("src/app/(console)/content/page.console.tsx");
  assert.doesNotMatch(page, /bank\.rows\.length/, "no whole-bank total");
  assert.doesNotMatch(page, /All subjects/);
  assert.match(page, /coursesByCurriculum\(\)/, "the switcher is grouped by curriculum");
  assert.match(page, /scopeContentView\(bank, id\)/, "each breakdown row is one course's rows");
});

test("/pipeline counts one named course; /gallery groups and counts by course", () => {
  const q = code("src/lib/pipeline-queries.ts");
  assert.match(q, /FROM questions\s+WHERE lo_id IN \(SELECT node_id FROM node_subject WHERE course_id = \$1\)/);
  assert.match(q, /WHERE id IN \(\$\{COURSE_NODES\}\)/, "node counts inside the course");
  assert.match(q, /loRes\.rows = loRes\.rows\.filter\(\(row\) => inCourse\.has/);
  assert.doesNotMatch(q, /FROM source_documents LIMIT 1/, "the course's own book, not the first row");
  const pipeline = code("src/app/(console)/pipeline/page.console.tsx");
  assert.match(pipeline, /running for real — \{courseName\(courseId\)\}/);
  const gallery = code("src/app/(console)/gallery/page.console.tsx");
  assert.doesNotMatch(gallery, /data\.total\} plates|data\.loCount|data\.kindCounts/, "no gallery-wide figure");
  assert.match(gallery, /courseName\(g\.courseId\)/);
});

test("console labels name the course, never only its subject (FR-4104)", () => {
  for (const file of [
    "src/app/(console)/cost/page.console.tsx",
    "src/app/(console)/feedback/page.console.tsx",
    "src/app/(console)/content/page.console.tsx",
    "src/app/(console)/overview/page.console.tsx",
    "src/app/(console)/students/[id]/page.console.tsx",
  ]) {
    const c = code(file);
    assert.doesNotMatch(c, /subjectOfCourse\(|displayLabel\(SUBJECTS\[/, `${file} labels a course by subject`);
  }
  const teaching = code("src/app/(console)/teaching/page.console.tsx");
  assert.match(teaching, /COURSE_IDS\.filter\(\(id\) => COURSES\[id\]\.probing\)/, "FR-4212 from the registry");
});

/* ------------------------------------------------------------------ */
/* In the page, never a native dialog (FR-2710, FR-4010)               */
/* ------------------------------------------------------------------ */

test("the curriculum editor and the course grid ask in the page", () => {
  for (const file of [
    "src/components/console/CurriculumEditor.tsx",
    "src/components/console/CourseAvailabilityGrid.tsx",
    "src/components/console/CourseAccessEditor.tsx",
  ]) {
    // a native dialog — `window.confirm(` or a bare global `confirm(` — not
    // a method of the component's own (`bulk.confirm(ask)`)
    assert.doesNotMatch(code(file), /window\.(confirm|alert|prompt)\(|(^|[^.\w])(confirm|alert|prompt)\(/m, file);
  }
  const editor = code("src/components/console/CurriculumEditor.tsx");
  assert.match(editor, /She will stop seeing:/);
  assert.match(editor, /She will start seeing:/);
  assert.match(editor, /Nothing is deleted\./);
  const route = code("src/app/api/console/students/[id]/curriculum/route.console.ts");
  assert.match(route, /authorize\(\{ role: "student-data" \}\)/);
  assert.match(route, /"invalid_curriculum"/);
  assert.match(route, /"no_change"/);
  assert.match(route, /setStudentCurriculum\(me\.operatorId, studentId, body\.curriculum, note\)/);
});

/* ------------------------------------------------------------------ */
/* Per lesson and per book section (FR-4319)                           */
/* ------------------------------------------------------------------ */

const add = (a: { n: number }, b: { n: number }) => ({ n: a.n + b.n });

test("a split section's parts roll up into one row, computed from the parts' rows", () => {
  // `lib/book-sections.ts`'s own index over `course_lessons` rows (034)
  const lessons = [
    { lessonSlug: "g10m1s6-1", figures: { n: 1 } },
    { lessonSlug: "g10m1s7-1", figures: { n: 2 } },
    { lessonSlug: "g10m1s8-1", figures: { n: 5 } },
    // out of catalogue place on purpose: the index keeps parts together
    { lessonSlug: "g10m1s7-3", figures: { n: 4 } },
    { lessonSlug: "g10m1s7-2", figures: { n: 3 } },
  ];
  const part = (slug: string, n: number) => ({
    courseId: US_G10_MATH_EN,
    slug,
    title: `Factorisation, part ${n}`,
    sections: [{ number: "1.7", title: "Factorisation" }],
    part: { n, of: 3 },
    chapterIntro: false,
    groupKey: "1.7",
  });
  const merged = {
    courseId: US_G10_MATH_EN,
    slug: "g10m1s6-1",
    title: "Products and factors",
    sections: [
      { number: "1.5", title: "Products" },
      { number: "1.6", title: "Factors" },
    ],
    part: null,
    chapterIntro: false,
    groupKey: "1.5",
  };
  const index = buildSectionIndex([merged, part("g10m1s7-1", 1), part("g10m1s7-2", 2), part("g10m1s7-3", 3)]);
  const sections = rollUpBySection(lessons, index, add);
  assert.deepEqual(
    sections.map((s) => [s.label, s.split, s.parts.map((p) => p.lessonSlug), s.figures.n]),
    [
      ["1.5 + 1.6 Products + Factors", false, ["g10m1s6-1"], 1],
      ["1.7 Factorisation", true, ["g10m1s7-1", "g10m1s7-2", "g10m1s7-3"], 9],
      ["g10m1s8-1", false, ["g10m1s8-1"], 5],
    ]
  );
  assert.deepEqual(sections[1].parts.map((p) => [p.partN, p.partOf]), [[1, 3], [2, 3], [3, 3]]);
  // with no store rows — every National course — every lesson is its own section
  assert.deepEqual(
    rollUpBySection(lessons, NO_SECTIONS, add).map((s) => s.figures.n),
    [1, 2, 5, 4, 3]
  );
});

test("National courses: the section store changes no figure and no order (no split section)", () => {
  // One row per lesson, one section each, no parts — the provenance T404
  // writes for every National lesson. Grouping by it must be the identity.
  const lessons = [
    { lessonSlug: "u1-1", figures: { n: 3 } },
    { lessonSlug: "u1-2", figures: { n: 1 } },
    { lessonSlug: "t2u1-1", figures: { n: 4 } },
    { lessonSlug: "geo1-1", figures: { n: 2 } },
  ];
  const rows = lessons.map((l, i) => ({
    courseId: PREP3_MATH_EN,
    slug: l.lessonSlug,
    title: `Lesson ${i + 1}`,
    sections: [{ number: l.lessonSlug, title: `Lesson ${i + 1}` }],
    part: null,
    chapterIntro: false,
    groupKey: l.lessonSlug,
  }));
  const index = buildSectionIndex(rows);
  assert.equal(index.hasSplits, false);
  const withStore = rollUpBySection(lessons, index, add);
  const withoutStore = rollUpBySection(lessons, NO_SECTIONS, add);
  for (const sections of [withStore, withoutStore]) {
    assert.deepEqual(sections.map((s) => s.parts.map((p) => p.lessonSlug)), lessons.map((l) => [l.lessonSlug]));
    assert.deepEqual(sections.map((s) => s.figures), lessons.map((l) => l.figures), "every figure is the lesson's own");
    assert.ok(sections.every((s) => !s.split));
  }
  assert.deepEqual(sectionChecks(lessons, { index, storeProblems: sectionProblems(rows) }), []);
});

test("lessons list in catalogue order, not the bank's review order", () => {
  const row = (lo: string, rank: number, status: string, source = "seed") => ({
    id: `q:${lo}`, loId: `lo:${lo}`, loLabel: lo, moduleLabel: null, tier: "basic",
    questionType: "mcq", stem: "", status, source, reviewedBy: null, reviewedAt: null,
    parentQuestionId: null, generatedBy: null, sourcePage: null, attempts: 0,
    courseId: PREP3_MATH_EN, lessonSlug: lo.replace(/-\d+$/, ""), catalogueRank: rank,
  });
  const lessons = contentByLesson([
    row("t2u1-1-1", 5, "live", "variant"),
    row("u1-1-2", 1, "live"),
    row("u1-1-1", 0, "review"),
    row("u1-2-1", 2, "live"),
  ]);
  assert.deepEqual(lessons.map((l) => l.lessonSlug), ["u1-1", "u1-2", "t2u1-1"]);
  assert.deepEqual(
    [lessons[0].figures.questions, lessons[0].figures.bookLive, lessons[0].figures.held],
    [2, 1, 1]
  );
  const total = lessons.map((l) => l.figures).reduce(addContentFigures);
  assert.equal(total.questions, 4);
});

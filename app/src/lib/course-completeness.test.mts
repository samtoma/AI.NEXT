/**
 * A course's completeness beside its switch (feature 003, FR-4309; backlog
 * #16) — the pure fold `/courses` shows, and the coverage audit's reading.
 *
 * Every figure here is checked against rows written out in the test, which
 * is FR-3212's "every count computed from the rows shown" as a test.
 *
 * @covers FR-4309, FR-4305, FR-4306, FR-4312
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  familyOf,
  solutionSourceOf,
  summariseCompleteness,
  type ObjectiveRow,
  type QuestionRow,
} from "./course-completeness.ts";
import { coverageFromJson } from "./coverage-status.ts";
import type { BookSectionRow } from "./book-sections.ts";

const G10 = "course:us-g10-math-en";
const lo = (id: string, moduleId = "module:g10m1", label = id): ObjectiveRow => ({
  loId: id,
  label,
  moduleId,
  moduleLabel: moduleId === "module:g10m1" ? "Chapter 1 — Algebraic expressions" : "Chapter 6 — Functions",
  courseId: G10,
});
const q = (loId: string, over: Partial<QuestionRow> = {}): QuestionRow => ({
  loId,
  tier: "basic",
  questionType: "mcq",
  status: "live",
  source: "seed",
  sourceNote: null,
  ...over,
});
const part = (slug: string, n: number, of: number): BookSectionRow => ({
  course_id: G10,
  lesson_slug: slug,
  title: "Factorisation",
  sections: ["1.7"],
  section_titles: ["Factorisation"],
  part_n: n,
  part_of: of,
  chapter_intro: false,
  group_key: "1.7",
});

test("solution sources and families are read from the notes the loader writes", () => {
  assert.equal(solutionSourceOf("Exercise 1-7 · p.25 · solution: book_worked_epub"), "book_worked_epub");
  assert.equal(solutionSourceOf("Worked example 3 · p.20 · solution: book_worked"), "book_worked");
  assert.equal(solutionSourceOf("solution: something_else"), "unrecorded");
  assert.equal(solutionSourceOf(null), "unrecorded");
  assert.equal(familyOf("Generated from template family tpl:u1-1-2:inverse."), "tpl:u1-1-2:inverse");
  assert.equal(familyOf("Composed inline by the tutor"), null);
});

test("every count is a fold over the rows, and the named rows are the ones under the floor", () => {
  const objectives = [
    lo("lo:g10m1s7-1-1"),
    lo("lo:g10m1s7-2-1", "module:g10m1", "Factorise $x^2 + bx + c$"),
    lo("lo:g10m6s2-1-1", "module:g10m6"),
  ];
  const all = ["basic", "standard", "advanced"];
  const questions: QuestionRow[] = [
    // lo 1: every tier live — two book (one EPUB, one worked), one generated
    q("lo:g10m1s7-1-1", { sourceNote: "· solution: book_worked_epub" }),
    q("lo:g10m1s7-1-1", { tier: "standard", sourceNote: "· solution: book_worked" }),
    q("lo:g10m1s7-1-1", { tier: "advanced", source: "variant", sourceNote: "Generated from template family tpl:a." }),
    // lo 2: basic only, plus a held book question and a live widget
    q("lo:g10m1s7-2-1", { status: "review", tier: "advanced", sourceNote: "· solution: book_worked_epub" }),
    q("lo:g10m1s7-2-1", { questionType: "widget", source: "variant" }),
    // lo 3 (another chapter): a held widget and a held generated one only
    q("lo:g10m6s2-1-1", { questionType: "widget", source: "variant", status: "review" }),
    q("lo:g10m6s2-1-1", { source: "variant", status: "review", sourceNote: "Generated from template family tpl:b." }),
    // retired rows and another course's rows count nowhere
    q("lo:g10m1s7-1-1", { status: "retired" }),
    q("lo:u1-1-1", {}),
  ];
  const d = summariseCompleteness({
    objectives,
    questions,
    misconceptions: [
      { loId: "lo:g10m1s7-1-1", explained: true },
      { loId: "lo:g10m6s2-1-1", explained: false },
      { loId: "lo:u1-1-1", explained: true },
    ],
    workedExamples: [{ loId: "lo:g10m1s7-2-1" }, { loId: "lo:u1-1-1" }],
    sectionRows: [part("g10m1s7-1", 1, 2), part("g10m1s7-2", 2, 2)],
  });
  assert.equal(d.chapters, 2);
  assert.equal(d.lessons, 3);
  assert.equal(d.sections, 1, "1.7 is one printed section, whatever its parts");
  assert.equal(d.objectives, 3);
  assert.deepEqual(d.bookQuestions, {
    live: 2,
    held: 1,
    bySolution: { book_worked_epub: 2, book_worked: 1 },
  });
  assert.equal(d.workedExamplesOnly, 1);
  assert.deepEqual(d.generated, { live: 1, held: 1, families: 2 });
  assert.deepEqual(d.widget, { live: 1, held: 1 });
  assert.deepEqual(d.misconceptions, { total: 2, withExplanation: 1 });
  assert.deepEqual(d.underTierFloor, [
    { loId: "lo:g10m1s7-2-1", label: "Factorise $x^2 + bx + c$", missing: ["standard", "advanced"] },
    { loId: "lo:g10m6s2-1-1", label: "lo:g10m6s2-1-1", missing: all },
  ]);
  assert.deepEqual(d.chaptersWithoutWidget, [{ moduleId: "module:g10m6", label: "Chapter 6 — Functions" }]);
  assert.deepEqual(d.sectionChecks, []);
});

test("the book-section checks: a part missing from the store, and parts apart in the catalogue", () => {
  const base = { questions: [], misconceptions: [], workedExamples: [] };
  // parts 1 and 3 of 3 stored: part 2 is missing
  const gap = summariseCompleteness({
    ...base,
    objectives: [lo("lo:g10m1s7-1-1"), lo("lo:g10m1s7-3-1")],
    sectionRows: [part("g10m1s7-1", 1, 3), part("g10m1s7-3", 3, 3)],
  });
  assert.equal(gap.sectionChecks.length, 1);
  assert.match(gap.sectionChecks[0]!, /parts 1, 3 stored, 1, 2, 3 expected/);
  // another lesson between the two parts in catalogue order
  const apart = summariseCompleteness({
    ...base,
    objectives: [lo("lo:g10m1s7-1-1"), lo("lo:g10m1s6-1-1"), lo("lo:g10m1s7-2-1")],
    sectionRows: [part("g10m1s7-1", 1, 2), part("g10m1s7-2", 2, 2)],
  });
  assert.equal(apart.sectionChecks.length, 1);
  assert.match(apart.sectionChecks[0]!, /another lesson sits between its parts in the catalogue/);
});

test("a National course with no store rows: no sections figure, no section problems", () => {
  const d = summariseCompleteness({
    objectives: [{ loId: "lo:u1-1-1", label: "Ordered pairs", moduleId: "module:u1", moduleLabel: "Unit 1", courseId: "course:prep3-math-en" }],
    questions: [q("lo:u1-1-1", { source: "authored" })],
    misconceptions: [],
    workedExamples: [],
    sectionRows: [],
  });
  assert.equal(d.sections, null);
  assert.deepEqual(d.sectionChecks, []);
  assert.deepEqual(d.bookQuestions.bySolution, { unrecorded: 1 });
});

test("the coverage audit: GREEN, RED with its failing checks, and a file that cannot be read", () => {
  const green = coverageFromJson(
    JSON.stringify({ status: "GREEN", chapters: "all", summary: { checks: 18, hold: 17, excepted: 1, fail: 0 }, checks: [], missing_inputs: [] }),
    "services/extraction/coverage/g10-math.json"
  );
  assert.equal(green.state, "green");
  assert.deepEqual(green.summary, { checks: 18, hold: 17, excepted: 1, fail: 0 });
  assert.equal(green.chapters, "all");

  const red = coverageFromJson(
    JSON.stringify({
      status: "RED",
      chapters: [8],
      summary: { checks: 18, hold: 15, excepted: 0, fail: 3 },
      checks: [{ id: "tier_floor", state: "fails" }, { id: "pages", state: "holds" }, { id: "figures", state: "fails" }],
      missing_inputs: ["objectives/g10m8s1-1.json", "runs/lesson/g10m8s1-1.json"],
    }),
    "f"
  );
  assert.equal(red.state, "red");
  assert.deepEqual(red.chapters, [8]);
  assert.deepEqual(red.failing, ["tier_floor", "figures"]);
  assert.equal(red.missingInputs, 2);

  assert.equal(coverageFromJson("{not json", "f").state, "unreadable");
  assert.equal(coverageFromJson(JSON.stringify({ status: "AMBER" }), "f").state, "unreadable");
});

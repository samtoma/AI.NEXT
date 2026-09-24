import { test } from "node:test";
import assert from "node:assert/strict";
import {
  untriedObjectives,
  previousCompletedSlug,
  lessonGatePassed,
  lessonPrereqsMet,
  nextLessonSlug,
  resolvePointer,
  advanceTarget,
  courseComplete,
  MASTERED_GATE,
  PREREQ_GATE,
  type ProgressionLesson,
} from "./progression.ts";

/**
 * @covers ADR-0020
 * @covers FR-3202
 * @covers FR-3203
 * @covers FR-3204
 * @covers FR-3205
 * @covers FR-3207
 *
 * (The FR annotations were added 2026-09-24, when spec 002 wrote down what
 * ADR-0020 shipped without a requirement — FR-3201…FR-3207.)
 *
 * The progression rules. Every one of these exists because getting it wrong
 * would be invisible in normal use and would move a real student to the wrong
 * lesson — the failure mode is silent, which is exactly the class of bug the
 * "always shows lesson 1-1" defect belonged to.
 *
 * The fixture is the REAL shape of the seeded maths graph, not a toy chain:
 * u1-1 unlocks four different lessons, and u2-1/u3-1 are roots with no
 * prerequisites at all. A linear fixture would pass every one of these tests
 * while leaving the branching untested.
 */

const lesson = (slug: string, los: string[], mastery = 0): ProgressionLesson => ({
  slug,
  courseId: "course:prep3-math-en",
  los: los.map((id) => ({ id, mastery })),
});

/** Catalogue order as MODULE_ORDER produces it for the maths course. */
const catalog: ProgressionLesson[] = [
  lesson("u1-1", ["lo:u1-1-1", "lo:u1-1-2"]),
  lesson("u1-2", ["lo:u1-2-1"]),
  lesson("u1-3", ["lo:u1-3-1"]),
  lesson("u1-4", ["lo:u1-4-1"]),
  lesson("u2-1", ["lo:u2-1-1"]),
  lesson("u5-1", ["lo:u5-1-1"]),
];

/** The real cross-lesson edges among these, as dst -> [src]. */
const prereqs = new Map<string, string[]>([
  ["lo:u1-2-1", ["lo:u1-1-1"]],
  ["lo:u1-3-1", ["lo:u1-2-1"]],
  ["lo:u1-4-1", ["lo:u1-1-1", "lo:u1-3-1"]],
  ["lo:u5-1-1", ["lo:u1-1-1"]],
  // u2-1 is a root: deliberately absent.
]);

const allAt = (score: number) =>
  new Map(
    catalog.flatMap((l) => l.los.map((lo) => [lo.id, score] as [string, number]))
  );

/* ---------------------------------------------------------------- */
/* The gate                                                          */
/* ---------------------------------------------------------------- */

// This is the whole reason the gate is `every` and not the average: the ramp
// the student is looking at DOES average, and would call this mastered.
test("one weak objective fails the gate even when the others are at ceiling", () => {
  const los = [
    { id: "a", mastery: 0.98 },
    { id: "b", mastery: 0.98 },
    { id: "c", mastery: 0.29 },
  ];
  const average = los.reduce((s, l) => s + l.mastery, 0) / los.length;
  assert.ok(average >= MASTERED_GATE, "fixture must be one the average passes");
  assert.equal(lessonGatePassed(los), false);
});

test("the gate passes only when every objective is at or above it", () => {
  assert.equal(
    lessonGatePassed([{ id: "a", mastery: MASTERED_GATE }]),
    true,
    "the boundary itself counts as passing"
  );
  assert.equal(
    lessonGatePassed([{ id: "a", mastery: MASTERED_GATE - 1e-9 }]),
    false
  );
});

// An empty lesson passing the gate would advance a student past content that
// does not exist yet — a re-extraction artefact must not look like mastery.
test("a lesson with no objectives never passes the gate", () => {
  assert.equal(lessonGatePassed([]), false);
});

/* ---------------------------------------------------------------- */
/* Prerequisites                                                     */
/* ---------------------------------------------------------------- */

// 131 of the 202 seeded prerequisite edges are inside a single lesson. If
// those counted, a lesson would have to be partly mastered before it could be
// started, and would never become reachable at all.
test("a lesson's own objectives are not prerequisites for entering it", () => {
  const selfReferential: ProgressionLesson = {
    slug: "u9-9",
    courseId: "course:prep3-math-en",
    los: [
      { id: "lo:u9-9-1", mastery: 0 },
      { id: "lo:u9-9-2", mastery: 0 },
    ],
  };
  const intra = new Map([["lo:u9-9-2", ["lo:u9-9-1"]]]);
  assert.equal(lessonPrereqsMet(selfReferential, new Map(), intra), true);
});

test("a root lesson is always ready", () => {
  const u21 = catalog.find((l) => l.slug === "u2-1")!;
  assert.equal(lessonPrereqsMet(u21, new Map(), prereqs), true);
});

test("readiness is gated at PREREQ_GATE, not at the mastered gate", () => {
  const u12 = catalog.find((l) => l.slug === "u1-2")!;
  const justUnder = new Map([["lo:u1-1-1", PREREQ_GATE - 1e-9]]);
  const atGate = new Map([["lo:u1-1-1", PREREQ_GATE]]);
  assert.equal(lessonPrereqsMet(u12, justUnder, prereqs), false);
  assert.equal(lessonPrereqsMet(u12, atGate, prereqs), true);
  assert.ok(PREREQ_GATE < MASTERED_GATE, "readiness is a lower bar than done");
});

/* ---------------------------------------------------------------- */
/* The walk                                                          */
/* ---------------------------------------------------------------- */

// The branching case. u1-1 unlocks u1-2, u1-4 and u5-1; the graph cannot pick
// among them, and catalogue order is the tie-break (ADR-0020).
test("with several lessons unlocked, catalogue order breaks the tie", () => {
  const mastery = allAt(0.98);
  assert.equal(nextLessonSlug(catalog, "u1-1", mastery, prereqs), "u1-2");
});

// The graph's veto: it cannot choose the next lesson, but it can rule one out.
test("an unready lesson is skipped, not served", () => {
  // u1-1 is done; u1-2's prerequisite is met, but u1-3 and u1-4 are not
  // reachable yet. Knock u1-2 out of readiness and the walk must move past it.
  const mastery = new Map([["lo:u1-1-1", 0.98]]);
  // u1-2 needs lo:u1-1-1 (met) -> it is next
  assert.equal(nextLessonSlug(catalog, "u1-1", mastery, prereqs), "u1-2");

  // With NOTHING met, every dependent lesson is unready and the walk falls
  // through to the first root after the current position.
  assert.equal(nextLessonSlug(catalog, "u1-1", new Map(), prereqs), "u2-1");
});

test("the walk never goes backwards", () => {
  const mastery = allAt(0.98);
  const next = nextLessonSlug(catalog, "u1-3", mastery, prereqs);
  const from = catalog.findIndex((l) => l.slug === "u1-3");
  const to = catalog.findIndex((l) => l.slug === next);
  assert.ok(to > from, `${next} must come after u1-3 in the catalogue`);
});

// null is what PARKS the pointer. It is not, by itself, "complete" — see the
// terminal-state tests below. Wrapping to the start here would silently
// restart a finished course.
test("the last lesson has no next", () => {
  assert.equal(nextLessonSlug(catalog, "u5-1", allAt(0.98), prereqs), null);
});

test("an unknown current slug yields no next rather than guessing one", () => {
  assert.equal(nextLessonSlug(catalog, "nope-1", allAt(0.98), prereqs), null);
});

// A pointer is per course. Walking off the end of maths into another course's
// first lesson would be a cross-subject jump, not progression.
test("the walk stays inside the catalogue it was given", () => {
  const mathsOnly = catalog.filter((l) => l.courseId === "course:prep3-math-en");
  const next = nextLessonSlug(mathsOnly, "u5-1", allAt(0.98), prereqs);
  assert.equal(next, null);
});

/** Same catalogue, with an explicit mastery score per lesson. */
const scored = (scores: Record<string, number>): ProgressionLesson[] =>
  catalog.map((l) => ({
    ...l,
    los: l.los.map((lo) => ({ ...lo, mastery: scores[l.slug] ?? 0 })),
  }));

/** The per-LO mastery map a scored catalogue implies (what the DB would hold). */
const masteryOf = (cat: readonly ProgressionLesson[]) =>
  new Map(cat.flatMap((l) => l.los.map((lo) => [lo.id, lo.mastery] as [string, number])));

/* ---------------------------------------------------------------- */
/* The pointer: where it is, and where an attempt moves it           */
/* ---------------------------------------------------------------- */

test("a student with no stored pointer is on the course's first lesson", () => {
  assert.equal(resolvePointer(catalog, undefined), "u1-1");
  assert.equal(resolvePointer(catalog, null), "u1-1");
});

test("a stored pointer that is still in the catalogue is kept", () => {
  assert.equal(resolvePointer(catalog, "u1-3"), "u1-3");
});

test("an empty course has no pointer at all", () => {
  assert.equal(resolvePointer([], "u1-1"), null);
});

// A content reload that renames or re-cuts a lesson leaves a stored slug the
// catalogue no longer has. The page shows such a student the first lesson;
// the advance must agree, or her attempts on the lesson she is SHOWN never
// match the lesson the pointer is ON and she can never move again.
test("a stale stored slug counts as the first lesson, and can advance again", () => {
  assert.equal(resolvePointer(catalog, "u9-9"), "u1-1");
  const cat = scored({ "u1-1": 0.98 });
  assert.equal(
    advanceTarget(cat, "u9-9", "u1-1", masteryOf(cat), prereqs),
    "u1-2",
    "mastering the lesson she is shown moves the stale pointer on"
  );
  assert.equal(
    advanceTarget(cat, "u9-9", "u1-2", masteryOf(scored({ "u1-2": 0.98 })), prereqs),
    null,
    "a stale pointer is the FIRST lesson, not a wildcard for any lesson"
  );
});

test("only an attempt on the lesson the pointer is on can move it", () => {
  const cat = scored({ "u1-1": 0.98, "u1-2": 0.98 });
  // Re-drilling a lesson behind the pointer, or answering ahead through the
  // picker, must not skip her past lessons she has not done.
  assert.equal(advanceTarget(cat, "u1-3", "u1-2", masteryOf(cat), prereqs), null);
  assert.equal(advanceTarget(cat, "u1-1", "u1-2", masteryOf(cat), prereqs), null);
});

test("the pointer does not move until the current lesson passes the gate", () => {
  const cat = scored({ "u1-1": MASTERED_GATE - 0.01 });
  assert.equal(advanceTarget(cat, "u1-1", "u1-1", masteryOf(cat), prereqs), null);
});

test("passing the gate moves the pointer to the next ready lesson", () => {
  const cat = scored({ "u1-1": 0.98 });
  assert.equal(advanceTarget(cat, "u1-1", "u1-1", masteryOf(cat), prereqs), "u1-2");
});

/* ---------------------------------------------------------------- */
/* The terminal state                                                */
/* ---------------------------------------------------------------- */

// THE P1 THIS FILE NOW GUARDS. u2-1 is mastered and the only lesson after it,
// u5-1, waits on lo:u1-1-1, which is below PREREQ_GATE. Nothing later is
// ready, so `nextLessonSlug` is null — and that null used to be read as "end
// of course", which put "That's the whole course" on the card of a student
// with a lesson still ahead of her.
test("mid-course with nothing ready yet: the pointer parks and the course is NOT complete", () => {
  const cat = scored({ "u2-1": 0.98, "u1-1": PREREQ_GATE - 0.1 });
  const mastery = masteryOf(cat);
  assert.equal(
    nextLessonSlug(cat, "u2-1", mastery, prereqs),
    null,
    "fixture must be one where no later lesson is ready"
  );
  assert.equal(
    advanceTarget(cat, "u2-1", "u2-1", mastery, prereqs),
    null,
    "the pointer stays on u2-1"
  );
  assert.equal(courseComplete(cat, "u2-1"), false);
});

// ADR-0020: the pointer parks on the last lesson and the card renders the
// completed state there.
test("the last lesson, with the whole course mastered, is complete", () => {
  const cat = scored(Object.fromEntries(catalog.map((l) => [l.slug, 0.98])));
  assert.equal(
    advanceTarget(cat, "u5-1", "u5-1", masteryOf(cat), prereqs),
    null,
    "the pointer parks on the last lesson rather than wrapping"
  );
  assert.equal(courseComplete(cat, "u5-1"), true);
});

test("the last lesson is not complete until it passes the gate itself", () => {
  const all = Object.fromEntries(catalog.map((l) => [l.slug, 0.98]));
  const cat = scored({ ...all, "u5-1": MASTERED_GATE - 0.01 });
  assert.equal(courseComplete(cat, "u5-1"), false);
});

// The stricter reading, on purpose: the banner tells her she has been through
// every topic, so a pointer that reached the end by skipping an unready lesson
// does not earn it.
test("reaching the last lesson with an earlier lesson unmastered is not complete", () => {
  const all = Object.fromEntries(catalog.map((l) => [l.slug, 0.98]));
  const cat = scored({ ...all, "u1-3": 0.3 });
  assert.equal(courseComplete(cat, "u5-1"), false);
});

test("a mastered course shows complete only on its last lesson", () => {
  const cat = scored(Object.fromEntries(catalog.map((l) => [l.slug, 0.98])));
  assert.equal(courseComplete(cat, "u2-1"), false);
  assert.equal(courseComplete(cat, "nope-1"), false);
  assert.equal(courseComplete([], "u5-1"), false);
});

/* ---------------------------------------------------------------- */
/* The collapsed "just finished" row                                 */
/* ---------------------------------------------------------------- */

test("the finished lesson behind the pointer is the one shown", () => {
  const cat = scored({ "u1-1": 0.98 });
  assert.equal(previousCompletedSlug(cat, "u1-2"), "u1-1");
});

// The skip case, and the reason this walks back instead of taking the
// immediate predecessor: a pointer that jumped u1-1 -> u2-1 because the
// lessons between were not ready has u1-4 behind it and u1-1 finished.
test("a skipped-over lesson is not mistaken for the finished one", () => {
  const cat = scored({ "u1-1": 0.98 });
  assert.equal(previousCompletedSlug(cat, "u2-1"), "u1-1");
});

test("nothing is shown at the start of a course", () => {
  assert.equal(previousCompletedSlug(scored({}), "u1-1"), null);
});

// A student mid-way through with nothing yet mastered must not be handed a
// "finished" row for a lesson they only opened.
test("an unfinished earlier lesson is not shown as finished", () => {
  const cat = scored({ "u1-1": 0.5 });
  assert.equal(previousCompletedSlug(cat, "u1-2"), null);
});

test("the nearest finished lesson wins when several are behind", () => {
  const cat = scored({ "u1-1": 0.98, "u1-2": 0.98 });
  assert.equal(previousCompletedSlug(cat, "u1-3"), "u1-2");
});

test("an unknown current slug yields nothing rather than the last finished", () => {
  assert.equal(previousCompletedSlug(scored({ "u1-1": 0.98 }), "nope-1"), null);
});

/* ---------------------------------------------------------------- */
/* "hasn't come up yet"                                              */
/* ---------------------------------------------------------------- */

const obj = (label: string, mastery: number) => ({ label, mastery });

// The case the line was written for: u1-1 has four objectives, review mode
// scripts its questions from three, and the fourth never gets an attempt.
test("the objective review mode cannot reach is named", () => {
  assert.deepEqual(
    untriedObjectives([
      obj("Ordered pairs", 0.9),
      obj("Cartesian product", 0.9),
      obj("Representing products", 0.9),
      obj("Product cardinality", 0),
    ]),
    ["Product cardinality"]
  );
});

// An untouched lesson is every objective untried — which the ramp already
// says ("not started") and the doors already answer. Repeating it is noise.
test("a lesson nobody has started names nothing", () => {
  assert.deepEqual(untriedObjectives([obj("A", 0), obj("B", 0)]), []);
});

test("a fully attempted lesson names nothing", () => {
  assert.deepEqual(untriedObjectives([obj("A", 0.4), obj("B", 0.9)]), []);
});

// The floor is load-bearing: BKT clamps to MIN_SCORE (0.02), so an objective
// answered even once — and answered WRONG every time — can never read as 0.
// A struggling student must never be told their worst objective is untried.
test("a repeatedly-wrong objective is attempted, not untried", () => {
  assert.deepEqual(untriedObjectives([obj("A", 0.02), obj("B", 0.9)]), []);
});

test("several untried objectives all come back, in lesson order", () => {
  assert.deepEqual(
    untriedObjectives([obj("A", 0.8), obj("B", 0), obj("C", 0)]),
    ["B", "C"]
  );
});

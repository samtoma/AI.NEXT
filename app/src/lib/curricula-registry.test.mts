/**
 * The three registries — curricula, courses, subjects — hold together, and
 * the books on disk agree with them (feature 003; data-model.md §1
 * "Invariants"). No database: the registries are app code, and the books are
 * the pipeline's own files (`services/extraction/books/*.json` and every seed
 * bundle), so a book that names a course the app does not know — or names it
 * under the wrong curriculum — fails here, before any loader runs.
 *
 * Why it matters. The course gate hides a course the registry does not know
 * from every student (FR-4002), so a typo in a book's course id would load a
 * course nobody can ever see. A lesson slug shared by two courses merges two
 * books into one lesson (`lib/progression-db.ts` builds `bySlug` over every
 * course). And a module id of a course with no school terms that happened to
 * start `module:geo` would be ranked — and labelled — as Prep-3 geometry.
 *
 * @covers FR-4001, FR-4002, FR-4203, FR-4212
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CURRICULA,
  CURRICULUM_IDS,
  DEFAULT_CURRICULUM,
  asCurriculumId,
  curriculumGradeLabel,
  curriculumLabel,
  isKnownCurriculum,
} from "./curricula.ts";
import {
  COURSES,
  COURSE_IDS,
  PREP3_MATH_EN,
  compareCourses,
  courseDef,
  courseRank,
  coursesOf,
  curriculumOf,
  isCourseId,
} from "./courses.ts";
import { SUBJECTS, SUBJECT_IDS, coursesOfSpineKey, subjectOfCourse } from "./subjects.ts";
import { GRADES } from "./profile.ts";
import { PROBING_COURSE_ID } from "./socratic-probing.ts";
import { slugOfLo } from "./lesson-slug.ts";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const EXTRACTION = join(REPO, "services/extraction");

/* ------------------------------------------------------------------ */
/* The registries on their own                                         */
/* ------------------------------------------------------------------ */

test("curricula: National first, then American — the two ids Samuel decided (decision 3)", () => {
  assert.deepEqual(CURRICULUM_IDS, ["eg-national-en", "us-american-en"]);
  assert.equal(DEFAULT_CURRICULUM, "eg-national-en", "the column's default (009): every pre-003 student");
  assert.equal(CURRICULA["us-american-en"].label, "American");
  assert.equal(CURRICULA["eg-national-en"].label, "National");
});

test("curricula are labelled flatly, never as a tier (FR-4016, privacy review F1)", () => {
  for (const id of CURRICULUM_IDS) {
    const c = CURRICULA[id];
    for (const text of [c.label, c.description]) {
      assert.doesNotMatch(text, /premium|international|private|elite|top|advanced|standard|basic/i, `${id}: "${text}"`);
    }
  }
});

test("every curriculum names every stored grade, and its program node is its own", () => {
  for (const id of CURRICULUM_IDS) {
    assert.deepEqual(Object.keys(CURRICULA[id].gradeLabels).sort(), [...GRADES].sort(), id);
  }
  assert.equal(curriculumGradeLabel("10", "us-american-en"), "Grade 10");
  assert.equal(curriculumGradeLabel("10", "eg-national-en"), "Secondary 1");
  const programs = CURRICULUM_IDS.map((id) => CURRICULA[id].programNodeId);
  assert.equal(new Set(programs).size, programs.length);
  // pinned in plan A11 and contracts/pipeline-handoff.md
  assert.equal(CURRICULA["us-american-en"].programNodeId, "program:us-american-en");
  assert.equal(CURRICULA["eg-national-en"].programNodeId, "program:bakaloreya-track");
});

test("a curriculum is validated exactly: no case folding, no default, no trimming (FR-4003)", () => {
  assert.equal(asCurriculumId("us-american-en"), "us-american-en");
  for (const bad of ["US-AMERICAN-EN", " us-american-en", "american", "", null, undefined, 7, "__proto__", "toString"]) {
    assert.equal(asCurriculumId(bad), null, String(bad));
    assert.equal(isKnownCurriculum(bad), false, String(bad));
  }
  assert.match(curriculumLabel("x-y"), /unknown curriculum \(x-y\)/);
});

test("courses: the four, in course order — curriculum, then subject — each in exactly one curriculum (FR-4002)", () => {
  assert.deepEqual(COURSE_IDS, [
    "course:prep3-math-en",
    "course:prep3-social-ar",
    "course:prep3-arabic-ar",
    "course:us-g10-math-en",
  ]);
  for (const id of COURSE_IDS) {
    assert.match(id, /^course:[a-z0-9-]+$/);
    assert.ok(isKnownCurriculum(COURSES[id].curriculum), id);
    assert.ok(SUBJECT_IDS.includes(COURSES[id].subject), id);
    assert.equal(curriculumOf(id), COURSES[id].curriculum);
    assert.equal(subjectOfCourse(id), COURSES[id].subject);
  }
  // registry order groups each curriculum's courses together
  const curricula = COURSE_IDS.map((id) => COURSES[id].curriculum);
  const firstIndex = CURRICULUM_IDS.map((c) => curricula.indexOf(c));
  assert.deepEqual(firstIndex, [...firstIndex].sort((a, b) => a - b), "curricula in registry order");
  for (const c of CURRICULUM_IDS) {
    const ids = coursesOf(c);
    assert.deepEqual(ids, COURSE_IDS.filter((id) => COURSES[id].curriculum === c));
    const at = ids.map((id) => COURSE_IDS.indexOf(id));
    assert.equal(at[at.length - 1] - at[0], at.length - 1, `${c}'s courses are contiguous`);
  }
  // the National courses keep the subject registry's order (so every
  // National list is ordered as before 003)
  assert.deepEqual(coursesOf("eg-national-en").map((id) => COURSES[id].subject), SUBJECT_IDS);
});

test("an unknown course has no curriculum and no subject — it fails closed", () => {
  for (const bad of ["course:unknown", "course:PREP3-MATH-EN", "", null, undefined, "__proto__"]) {
    assert.equal(isCourseId(bad), false, String(bad));
    assert.equal(courseDef(bad), null, String(bad));
    assert.equal(curriculumOf(bad), null, String(bad));
    assert.equal(subjectOfCourse(bad as string), null, String(bad));
  }
  assert.equal(courseRank("course:unknown"), COURSE_IDS.length, "sorts after every known course");
  assert.ok(compareCourses(PREP3_MATH_EN, "course:unknown") < 0);
});

test("the subject registry names no course: two courses share maths (decision E)", () => {
  for (const id of SUBJECT_IDS) {
    assert.ok(!("courseId" in SUBJECTS[id]), `${id} still carries a courseId`);
    assert.ok(!("book" in SUBJECTS[id]), `${id} still carries a book`);
  }
  assert.deepEqual(coursesOfSpineKey("math"), ["course:prep3-math-en", "course:us-g10-math-en"]);
  assert.deepEqual(coursesOfSpineKey("social"), ["course:prep3-social-ar"]);
  assert.deepEqual(coursesOfSpineKey("geography"), []);
});

test("probing: exactly one course may probe, it is Prep-3 maths, and the G10 course does not (FR-4212, decision 7)", () => {
  const probing = COURSE_IDS.filter((id) => COURSES[id].probing);
  assert.deepEqual(probing, [PROBING_COURSE_ID]);
  assert.equal(PROBING_COURSE_ID, "course:prep3-math-en", "its value is unchanged");
  assert.equal(COURSES["course:us-g10-math-en"].probing, false);
});

test("terms: Prep-3 maths keeps its two rules; the Grade 10 book has none (FR-4203)", () => {
  assert.deepEqual(COURSES[PREP3_MATH_EN].terms, {
    rules: [
      { modulePrefix: "geo", slugPrefix: "geo", term: 2, rank: 2 },
      { modulePrefix: "t2-", slugPrefix: "t2", term: 2, rank: 1 },
    ],
    defaultTerm: 1,
  });
  assert.equal(COURSES["course:us-g10-math-en"].terms, null);
  const prefixes = COURSE_IDS.flatMap((id) => COURSES[id].terms?.rules.map((r) => r.modulePrefix) ?? []);
  assert.equal(new Set(prefixes).size, prefixes.length, "a module prefix belongs to one course");
});

/* ------------------------------------------------------------------ */
/* The books on disk agree                                             */
/* ------------------------------------------------------------------ */

type BookConfig = {
  book: string;
  course_id: string;
  curriculum: string;
  subject: string;
  grade: string;
  id_prefixes?: string[];
  bundles?: string[];
};
type Bundle = {
  nodes: { id: string; kind: string }[];
  edges: { src: string; dst: string; type: string }[];
};

function bookConfigs(): BookConfig[] {
  const dir = join(EXTRACTION, "books");
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  return names.map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")) as BookConfig);
}

/** Every curriculum bundle under seed/, recursively (not the generated bank,
 *  the lesson content bundles, or the misconception catalogue). */
function seedBundles(): { file: string; doc: Bundle }[] {
  const out: { file: string; doc: Bundle }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "generated" && entry !== "content") walk(full);
      } else if (entry.endsWith(".json")) {
        const doc = JSON.parse(readFileSync(full, "utf8")) as Partial<Bundle>;
        if (Array.isArray(doc.nodes) && Array.isArray(doc.edges)) out.push({ file: full, doc: doc as Bundle });
      }
    }
  };
  walk(join(EXTRACTION, "seed"));
  return out;
}

test("every book config names a registry course, in that course's curriculum, subject and grade", () => {
  const books = bookConfigs();
  assert.ok(books.length >= 3, "the three National book configs at least");
  for (const b of books) {
    const def = courseDef(b.course_id);
    assert.ok(def, `${b.book}: ${b.course_id} is not in lib/courses.ts`);
    assert.equal(b.curriculum, def.curriculum, `${b.book}: curriculum`);
    assert.equal(b.subject, SUBJECTS[def.subject].key, `${b.book}: subject`);
    const grade = b.grade === "prep-3" ? "9" : b.grade;
    assert.ok((def.grades as readonly string[]).includes(grade), `${b.book}: grade ${b.grade} not in ${def.grades}`);
  }
  // no two books declare the same id prefix
  const prefixes = books.flatMap((b) => b.id_prefixes ?? []);
  assert.equal(new Set(prefixes).size, prefixes.length, `id prefixes collide: ${prefixes}`);
  // only Prep-3 maths may use the prefixes its term rules read
  for (const b of books) {
    if (b.course_id === PREP3_MATH_EN) continue;
    for (const p of b.id_prefixes ?? []) {
      assert.ok(!p.startsWith("geo") && !p.startsWith("t2"), `${b.book}: prefix ${p} would be read as a Prep-3 term`);
    }
  }
});

test("every course a seed bundle declares is a registry course, and its program edge is its curriculum's", () => {
  const bundles = seedBundles();
  assert.ok(bundles.length >= 10);
  let courses = 0;
  for (const { file, doc } of bundles) {
    for (const n of doc.nodes.filter((x) => x.kind === "course")) {
      courses++;
      const def = courseDef(n.id);
      assert.ok(def, `${file}: course ${n.id} is not in lib/courses.ts`);
      for (const e of doc.edges.filter((x) => x.type === "part_of" && x.src === n.id && x.dst.startsWith("program:"))) {
        assert.equal(e.dst, CURRICULA[def.curriculum].programNodeId, `${file}: ${n.id} part_of ${e.dst}`);
      }
    }
  }
  assert.ok(courses >= 3);
});

test("a lesson slug belongs to ONE course, and a course without terms has no term-shaped module or slug", () => {
  const bundles = seedBundles();
  // module → course, and objective → module, across every bundle
  const courseOfModule = new Map<string, string>();
  const moduleOfLo = new Map<string, string>();
  for (const { doc } of bundles) {
    for (const e of doc.edges) {
      if (e.type === "part_of" && e.dst.startsWith("course:")) courseOfModule.set(e.src, e.dst);
      if (e.type === "teaches") moduleOfLo.set(e.dst, e.src);
    }
  }
  const courseOfSlug = new Map<string, Set<string>>();
  for (const [lo, mod] of moduleOfLo) {
    const course = courseOfModule.get(mod);
    if (!course) continue;
    const slug = slugOfLo(lo);
    courseOfSlug.set(slug, (courseOfSlug.get(slug) ?? new Set()).add(course));
    const def = courseDef(course);
    if (def && def.terms === null) {
      assert.ok(!mod.startsWith("module:geo") && !mod.startsWith("module:t2-"), `${course}: module ${mod}`);
      assert.ok(!slug.startsWith("geo") && !slug.startsWith("t2"), `${course}: slug ${slug}`);
    }
  }
  assert.ok(courseOfSlug.size >= 60, "all three National courses' lessons were read");
  for (const [slug, courses] of courseOfSlug) {
    assert.equal(courses.size, 1, `lesson ${slug} is in ${[...courses].join(" and ")}`);
  }
});

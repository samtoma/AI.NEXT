/**
 * THE WHOLE BOOK, RENDERED (feature 003; Samuel, 2026-10-01): the REAL
 * `LessonCheckIn` and `SubjectHome`, rendered to HTML with react-dom/server.
 *
 *   · Grade 10: the "Everything in the book" list is OPEN on the page — no
 *     "Pick something else" trigger to find it behind — every chapter and
 *     lesson listed; a prepared lesson is a link, an unprepared one is not
 *     (and says "Being prepared"); the finished-everything banner does not
 *     claim "the whole course" while lessons are still being prepared; no
 *     Arabic anywhere; no literal colour.
 *   · Grade 10 course card: "5 of 65 lessons ready".
 *   · National: the check-in and the home render the SAME bytes whatever
 *     outline is passed — the list stays collapsed behind "Pick something
 *     else", the cards say "N lessons".
 *
 * `.tsx` has no loader in plain `node --test`, so this file registers one for
 * its own imports: TypeScript's own `transpileModule` (the compiler `tsc`
 * already uses), JSX to `react/jsx-runtime`, and `next/*` subpaths given the
 * `.js` their package needs under ESM. Nothing else is stubbed — the
 * components, `next/link` and the libraries are the real ones.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { OutlineLesson, OutlineRow } from "../../lib/course-outline.ts";
import { outlineFromRows } from "../../lib/course-outline.ts";

// `registerHooks` (Node 22.15+) is newer than this repo's @types/node; the
// shape used here is the documented one (scripts/ts-resolver.mjs uses it too).
type Loaded = { format: string; source: string; shortCircuit?: boolean };
type LoadHook = (url: string, context: unknown, nextLoad: (url: string, context: unknown) => Loaded) => Loaded;
const { createRequire, registerHooks } = nodeModule as unknown as {
  createRequire: typeof nodeModule.createRequire;
  registerHooks: (hooks: { load: LoadHook }) => void;
};
const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof import("typescript");
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    const file = fileURLToPath(url);
    const out = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: file,
    });
    const source = out.outputText.replace(/(["'])next\/([a-z/-]+)\1/g, (_m, q: string, sub: string) => `${q}next/${sub}.js${q}`);
    return { format: "module", source, shortCircuit: true };
  },
});

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { LessonCheckIn } = await import("./LessonCheckIn.tsx");
const { SubjectHome } = await import("./SubjectHome.tsx");

const G10 = "course:us-g10-math-en";
const MATH = "course:prep3-math-en";
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const render = (el: unknown) => renderToStaticMarkup(el as Parameters<typeof renderToStaticMarkup>[0]);

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function row(
  slug: string,
  chapter: number,
  chapterTitle: string,
  bookOrder: number,
  sections: [string, string][],
  part: [number, number] | null = null
): OutlineRow {
  return {
    course_id: G10,
    lesson_slug: slug,
    module_id: `module:g10m-c${String(chapter).padStart(2, "0")}`,
    module_label: `Chapter ${chapter} — ${chapterTitle}`,
    module_order: chapter,
    book_order: bookOrder,
    title: sections.at(-1)![1],
    sections: sections.map((s) => s[0]),
    section_titles: sections.map((s) => s[1]),
    part_n: part?.[0] ?? null,
    part_of: part?.[1] ?? null,
    chapter_intro: false,
    group_key: sections.at(-1)![0],
    page_from: null,
    page_to: null,
  };
}

/** Chapter 1 (nothing loaded) and Chapter 8 (loaded), in the book's shapes. */
const OUTLINE: OutlineLesson[] = outlineFromRows([
  row("g10m1s3-1", 1, "Algebraic expressions", 1, [["1.2", "The real number system"], ["1.3", "Rational and irrational numbers"]]),
  row("g10m1s7-2", 1, "Algebraic expressions", 2, [["1.7", "Factorisation"]], [2, 3]),
  row("g10m8s1-1", 8, "Analytical geometry", 3, [["8.1", "Drawing figures on the Cartesian plane"]]),
  row("g10m8s2-1", 8, "Analytical geometry", 4, [["8.2", "Distance between two points"]]),
]);

const lo = (id: string, mastery: number) => ({ id, label: `Objective ${id}`, description: null, sourcePage: 284, mastery });

function catalogueLesson(o: OutlineLesson, mastery: number) {
  return {
    slug: o.slug,
    ref: o.provenance.sections[0]!.number,
    title: o.provenance.title,
    moduleId: o.moduleId,
    moduleLabel: o.moduleLabel,
    courseId: G10,
    subject: "math-en",
    los: [lo(`lo:${o.slug}-1`, mastery)],
    provenance: o.provenance,
  };
}
const G10_LESSONS = OUTLINE.filter((o) => o.moduleOrder === 8).map((o, i) => catalogueLesson(o, i === 0 ? 0.8 : 0));

function data(l: { slug: string; title: string; moduleLabel: string; courseId: string; subject: string; los: unknown[]; provenance?: unknown }) {
  return {
    slug: l.slug,
    lessonRef: l.slug,
    title: l.title,
    moduleLabel: l.moduleLabel,
    courseId: l.courseId,
    subject: l.subject,
    los: l.los,
    questions: [],
    visuals: [],
    mapBases: [],
    docTitle: null,
    studentName: "Lina Fouad",
    studentId: 1,
    grade: "10",
    gender: null,
    ...(l.provenance ? { provenance: l.provenance } : {}),
  };
}

const CHECKIN = {
  hasContent: false,
  masteryStage: 1,
  weakestSubskill: null,
  recommendation: "reteach",
  estimates: { reteach: 9, refresh: 3 },
  completedToday: false,
  courseComplete: false,
  untriedSubskills: [],
  justFinished: null,
  trial: null,
};

function g10CheckIn(extra: Record<string, unknown> = {}): string {
  return render(
    h(LessonCheckIn as never, {
      ...CHECKIN,
      lesson: data(G10_LESSONS[1]!),
      lessons: G10_LESSONS,
      outline: OUTLINE,
      ...extra,
    })
  );
}

const NATIONAL_LESSONS = [
  ["u1-1", "module:u1", "Unit 1 — Relations and Functions", 0.8],
  ["u1-2", "module:u1", "Unit 1 — Relations and Functions", 0.2],
  ["geo1-1", "module:geo-u1", "Term 2 · Unit 4 — The Circle", 0],
].map(([slug, moduleId, moduleLabel, m]) => ({
  slug: slug as string,
  ref: `Lesson ${String(slug).replace(/^[a-z]+/, "")}`,
  title: `Title ${slug}`,
  moduleId: moduleId as string,
  moduleLabel: moduleLabel as string,
  courseId: MATH,
  subject: "math-en",
  los: [lo(`lo:${slug}-1`, m as number)],
}));

function nationalCheckIn(extra: Record<string, unknown> = {}): string {
  return render(
    h(LessonCheckIn as never, { ...CHECKIN, lesson: data(NATIONAL_LESSONS[1]!), lessons: NATIONAL_LESSONS, ...extra })
  );
}

/* ------------------------------------------------------------------ */
/* Grade 10                                                            */
/* ------------------------------------------------------------------ */

test("Grade 10: the whole book is OPEN on the check-in — no 'Pick something else' to find it behind", () => {
  const html = g10CheckIn();
  assert.match(html, /<section aria-label="Everything in the book"/);
  assert.doesNotMatch(html, /<details/, "no collapsed picker");
  assert.doesNotMatch(html, /Pick something else/);
  assert.match(html, /Just practise/, "the practice door is still there");
  // every chapter, in the book's order, inside the open list
  const book = html.slice(html.indexOf('aria-label="Everything in the book"'));
  const c1 = book.indexOf("Algebraic expressions");
  const c8 = book.indexOf("Analytical geometry");
  assert.ok(c1 > 0 && c8 > c1, "Chapter 1 before Chapter 8");
  // and the list sits between the card and the practice door
  assert.ok(html.indexOf("Everything in the book") < html.indexOf("Just practise"));
});

test("Grade 10: a prepared lesson is a link; an unprepared one is shown, says so, and links nowhere", () => {
  const html = g10CheckIn();
  for (const slug of ["g10m8s1-1", "g10m8s2-1"]) {
    assert.match(html, new RegExp(`href="/student\\?subject=math&amp;lesson=${slug}"`), `${slug} opens`);
  }
  for (const slug of ["g10m1s3-1", "g10m1s7-2"]) {
    assert.doesNotMatch(html, new RegExp(`lesson=${slug}`), `${slug} is not startable from here`);
  }
  // named as it will be once loaded, and said to be being prepared
  assert.match(html, /title="1\.2–1\.3 Rational and irrational numbers — Being prepared"/);
  assert.match(html, /title="1\.7 Factorisation · part 2 of 3 — Being prepared"/);
  assert.match(html, /<span dir="ltr">1\.7 · part 2<\/span><span class="sr-only"> — Being prepared<\/span>/);
  // the chapter with nothing prepared carries the words; the legend explains the dashed chip
  assert.match(html, /Algebraic expressions<\/span><span class="[^"]*border-dashed[^"]*">Being prepared<\/span>/);
  assert.match(html, /= being prepared/);
  // Chapter 8 reads as today: no "Being prepared" next to its name
  assert.doesNotMatch(html, /Analytical geometry<\/span><span class="[^"]*">Being prepared/);
});

test("Grade 10: finishing everything ready does not claim 'the whole course' while chapters are being prepared", () => {
  const more = g10CheckIn({ courseComplete: true, morePreparing: true });
  assert.match(more, /everything that&#x27;s ready so far/);
  assert.match(more, /The\s+rest of the book is being prepared and will show up here\s+on its own\./);
  assert.doesNotMatch(more, /whole course/);
  // once nothing is being prepared, the old banner returns
  const all = g10CheckIn({ courseComplete: true, morePreparing: false });
  assert.match(all, /the whole course/);
});

test("Grade 10: no Arabic, and no literal colour — tokens only", () => {
  const html = g10CheckIn({ courseComplete: true, morePreparing: true });
  assert.doesNotMatch(html, ARABIC);
  assert.doesNotMatch(html, /(class|style)="[^"]*#[0-9a-fA-F]{3,8}/, "no hex colour in a class or style");
  assert.doesNotMatch(html, /(class|style)="[^"]*\brgba?\(/, "no rgb() colour in a class or style");
});

/* ------------------------------------------------------------------ */
/* The course card                                                     */
/* ------------------------------------------------------------------ */

const NATIONAL_CARDS = [
  { subject: "math", courseId: MATH, courseLabel: "Mathematics", avgMastery: 0.4, weakestLo: null, lessonsCount: 35, defaultSlug: "u1-1", lastCheck: null, sections: [] },
  { subject: "social", courseId: "course:prep3-social-ar", courseLabel: "الدراسات الاجتماعية", avgMastery: 0.2, weakestLo: null, lessonsCount: 14, defaultSlug: "soc1-1", lastCheck: null, sections: [] },
];

test("the Grade 10 card counts what is ready of the whole book; a card without an outline keeps 'N lessons'", () => {
  const g10 = { ...NATIONAL_CARDS[0]!, courseId: G10, courseLabel: "Mathematics — Grade 10", lessonsCount: 5, outline: { ready: 5, total: 65 } };
  const html = render(h(SubjectHome as never, { summaries: [g10, NATIONAL_CARDS[0]], studentName: "Lina Fouad" }));
  assert.match(html, /5 of 65 lessons ready/);
  assert.match(html, /35 lessons/, "the card with no outline");
  assert.doesNotMatch(html, />5 lessons</, "never the bare count for a course with an outline");
});

/* ------------------------------------------------------------------ */
/* National, byte for byte                                             */
/* ------------------------------------------------------------------ */

test("NATIONAL: the check-in renders the same bytes whatever outline is passed, and keeps its collapsed picker", () => {
  for (const base of [{}, { courseComplete: true }]) {
    const before = nationalCheckIn(base);
    assert.match(before, /<details class="group w-fit open:w-full">/);
    assert.match(before, /Pick something else/);
    assert.doesNotMatch(before, /aria-label="Everything in the book"/);
    assert.doesNotMatch(before, /Being prepared|being prepared/);
    for (const extra of [{ outline: [] }, { outline: OUTLINE }, { outline: OUTLINE, morePreparing: false }]) {
      assert.equal(nationalCheckIn({ ...base, ...extra }), before, JSON.stringify(extra));
    }
  }
});

test("NATIONAL: the home's cards render the same bytes, and say 'N lessons'", () => {
  const html = render(h(SubjectHome as never, { summaries: NATIONAL_CARDS, studentName: "Omar Hassan" }));
  assert.match(html, /35 lessons/);
  assert.match(html, /14 دروس/, "the Arabic card keeps its own words");
  assert.doesNotMatch(html, /lessons ready/);
});

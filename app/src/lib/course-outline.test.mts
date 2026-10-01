/**
 * THE WHOLE BOOK, BEFORE ALL OF IT IS PREPARED (feature 003; Samuel,
 * 2026-10-01: "I want the students to see all chapters as well not only 8!")
 * — the rules of `lib/course-outline.ts`, pure, on the REAL Grade 10 manifest
 * (`services/extraction/manifest/g10-math-american.json`, G0 passed: 14
 * chapters, 65 lessons) and the REAL National maths seeds.
 *
 *   · ORDER — the outline reads in the book's order, whatever order its rows
 *     arrive in; chapters 1…14, lessons as the manifest lists them.
 *   · READINESS IS DERIVED — a lesson is prepared exactly when it is in the
 *     gated catalogue. Today that is Chapter 8's five lessons; "loading"
 *     Chapter 1 (adding its lessons to the catalogue, nothing else) makes its
 *     lessons ready with no change to the outline.
 *   · NOT STARTABLE — an unprepared lesson is a picker entry with no catalogue
 *     lesson behind it, so the surface has nothing to link it to; the lesson
 *     on the card, "Up next" and practice come from the catalogue alone.
 *   · NATIONAL UNCHANGED — with no outline, the picker's groups are exactly the
 *     grouping the check-in always built (`groupByModule`, kept here verbatim
 *     as the reference), and a G10 outline never touches a National group.
 *   · NO ARABIC — nothing the outline makes a Grade 10 student read carries
 *     Arabic script (answer 35, `arabicTouches = false`).
 *
 * The server-side refusal of an unprepared slug is `course-outline-guard.test.mts`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BEING_PREPARED,
  bookOpenByDefault,
  chaptersBeingPrepared,
  hasUnpreparedLessons,
  isUnprepared,
  outlineCounts,
  outlineFromRows,
  outlineOf,
  pickerGroups,
  preparedSlugs,
  readyCount,
  readyCountText,
  type CatalogueLesson,
  type OutlineLesson,
  type OutlineRow,
} from "./course-outline.ts";
import { lessonChipText, lessonHeading, lessonHeadingText } from "./section-label.ts";
import { decideLanding } from "./student-landing.ts";
import { courseDef } from "./courses.ts";
import { slugOfLo } from "./lesson-slug.ts";
import { MATHS_SEED_FILES } from "./spine-maths-fixture.mts";

const G10 = "course:us-g10-math-en";
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const repo = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

type ManifestLesson = {
  id: string;
  title: string;
  order_in_module: number;
  printed_pages: [number, number];
  book_provenance: {
    sections: { number: string; title: string }[];
    part: { n: number; of: number } | null;
    chapter_intro: boolean;
    group_key: string;
  };
};
type ManifestModule = { id: string; chapter: number; title: string; order_in_parent: number; lessons: ManifestLesson[] };

const MANIFEST = JSON.parse(
  readFileSync(repo("services/extraction/manifest/g10-math-american.json"), "utf8")
) as { book: { course_id: string }; modules: ManifestModule[] };

/**
 * The rows `services/extraction/load_course_outline.py` writes, from the
 * manifest: chapter label "Chapter N — title" (assemble_lesson_bundle.py's
 * rule), book order 1…N in the manifest's order. The loader's own test proves
 * it writes these; this builds them without a database.
 */
function manifestRows(): OutlineRow[] {
  const rows: OutlineRow[] = [];
  for (const mod of MANIFEST.modules) {
    for (const les of mod.lessons) {
      const bp = les.book_provenance;
      rows.push({
        course_id: MANIFEST.book.course_id,
        lesson_slug: les.id,
        module_id: mod.id,
        module_label: `Chapter ${mod.chapter} — ${mod.title}`,
        module_order: mod.order_in_parent,
        book_order: rows.length + 1,
        title: les.title,
        sections: bp.sections.map((s) => s.number),
        section_titles: bp.sections.map((s) => s.title),
        part_n: bp.part?.n ?? null,
        part_of: bp.part?.of ?? null,
        chapter_intro: bp.chapter_intro,
        group_key: bp.group_key,
        page_from: les.printed_pages[0],
        page_to: les.printed_pages[1],
      });
    }
  }
  return rows;
}

type Lesson = CatalogueLesson & { title: string };

/** A catalogue lesson as `getLessonCatalog` builds one for a loaded G10 chapter. */
function g10Lesson(o: OutlineLesson): Lesson {
  return { slug: o.slug, courseId: G10, moduleId: o.moduleId, moduleLabel: o.moduleLabel, subject: "math", title: o.provenance.title };
}

const OUTLINE = outlineFromRows(manifestRows());
const CH8 = OUTLINE.filter((o) => o.moduleId === "module:g10m-c08").map(g10Lesson);

/** The National maths catalogue, from its seeds: lesson → its module and course. */
function nationalCatalogue(): Lesson[] {
  type N = { id: string; kind: string; label: string };
  type E = { src: string; dst: string; type: string };
  const nodes = new Map<string, N>();
  const edges: E[] = [];
  for (const f of MATHS_SEED_FILES) {
    const doc = JSON.parse(readFileSync(repo(`services/extraction/seed/${f}.json`), "utf8")) as { nodes: N[]; edges: E[] };
    for (const n of doc.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
    edges.push(...doc.edges);
  }
  const moduleOf = new Map(edges.filter((e) => e.type === "teaches").map((e) => [e.dst, e.src]));
  const courseOf = new Map(edges.filter((e) => e.type === "part_of").map((e) => [e.src, e.dst]));
  const out: Lesson[] = [];
  const seen = new Set<string>();
  for (const n of nodes.values()) {
    if (n.kind !== "learning_objective") continue;
    const slug = slugOfLo(n.id);
    if (seen.has(slug)) continue;
    seen.add(slug);
    const moduleId = moduleOf.get(n.id) ?? "module:unfiled";
    out.push({
      slug,
      courseId: courseOf.get(moduleId) ?? null,
      moduleId,
      moduleLabel: nodes.get(moduleId)?.label ?? "Unfiled",
      subject: "math",
      title: n.label,
    });
  }
  return out;
}

/**
 * THE REFERENCE: `groupByModule` exactly as LessonCheckIn.tsx had it before
 * the outline — what every course with no outline must still get.
 */
function groupByModule(lessons: Lesson[]) {
  const modules: { id: string; label: string; subject: Lesson["subject"]; courseId: Lesson["courseId"]; lessons: Lesson[] }[] = [];
  for (const l of lessons) {
    const m = modules.find((x) => x.id === l.moduleId);
    if (m) m.lessons.push(l);
    else modules.push({ id: l.moduleId, label: l.moduleLabel, subject: l.subject, courseId: l.courseId, lessons: [l] });
  }
  return modules;
}

/** A picker's groups in the reference's shape — only possible when every entry is ready. */
function asReference(groups: ReturnType<typeof pickerGroups<Lesson>>) {
  return groups.map((g) => {
    assert.equal(g.preparing, false, `${g.id}: a group with no outline is never "being prepared"`);
    return {
      id: g.id,
      label: g.label,
      subject: g.subject,
      courseId: g.courseId,
      lessons: g.entries.map((e) => {
        assert.ok(e.ready, `${e.slug}: an entry with no outline is always ready`);
        return e.lesson;
      }),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Order                                                               */
/* ------------------------------------------------------------------ */

test("the manifest's outline: 14 chapters, 65 lessons, Chapter 8's five slugs exactly the loaded ones", () => {
  assert.equal(OUTLINE.length, 65);
  assert.equal(new Set(OUTLINE.map((o) => o.moduleId)).size, 14);
  assert.deepEqual(
    CH8.map((l) => l.slug),
    ["g10m8s1-1", "g10m8s2-1", "g10m8s3-1", "g10m8s3-2", "g10m8s4-1"]
  );
  assert.ok(OUTLINE.every((o) => o.courseId === G10));
  // every slug the app's SLUG_RE accepts (lib/lesson-slug.ts), unique
  assert.ok(OUTLINE.every((o) => /^[a-z0-9]{1,12}-[0-9]{1,3}$/.test(o.slug)));
  assert.equal(new Set(OUTLINE.map((o) => o.slug)).size, 65);
});

test("reading order is the book's, whatever order the rows arrive in", () => {
  const rows = manifestRows();
  const shuffled = [...rows].reverse();
  shuffled.push(shuffled.splice(10, 1)[0]!);
  const outline = outlineFromRows(shuffled);
  assert.deepEqual(outline.map((o) => o.slug), rows.map((r) => r.lesson_slug));
  assert.deepEqual(outline.map((o) => o.bookOrder), rows.map((_, i) => i + 1));
  // chapters 1…14 in that order, each contiguous
  const chapters: string[] = [];
  for (const o of outline) if (chapters.at(-1) !== o.moduleLabel) chapters.push(o.moduleLabel);
  assert.equal(chapters.length, 14, "a chapter's lessons are contiguous");
  assert.deepEqual(
    chapters.map((c) => Number(/^Chapter (\d+) — /.exec(c)?.[1])),
    Array.from({ length: 14 }, (_, i) => i + 1)
  );
  assert.equal(chapters[0], "Chapter 1 — Algebraic expressions");
  assert.equal(chapters[7], "Chapter 8 — Analytical geometry");
  // the three parts of 1.7 in part order, beside each other
  const at = (s: string) => outline.findIndex((o) => o.slug === s);
  assert.deepEqual([at("g10m1s7-1"), at("g10m1s7-2"), at("g10m1s7-3")], [4, 5, 6]);
});

test("an unprepared lesson is named as it will be once loaded — the book's own numbers and titles", () => {
  const name = (slug: string) => {
    const o = OUTLINE.find((x) => x.slug === slug)!;
    const h = lessonHeading(o.provenance);
    return { chip: lessonChipText(h, o.provenance), heading: lessonHeadingText(h) };
  };
  assert.deepEqual(name("g10m1s3-1"), { chip: "1.2–1.3", heading: "1.2–1.3 Rational and irrational numbers" });
  assert.deepEqual(name("g10m1s7-2"), { chip: "1.7 · part 2", heading: "1.7 Factorisation · part 2 of 3" });
  assert.deepEqual(name("g10m5s3-1"), { chip: "5.2–5.4", heading: "5.2–5.4 Defining the trigonometric ratios" });
  assert.deepEqual(name("g10m6s1-1"), { chip: "6.1", heading: "6.1 Introduction" });
  assert.deepEqual(name("g10m14s7-1"), { chip: "14.7", heading: "14.7 Complementary events" });
  // Chapter 8 exactly as its loaded course_lessons rows name it
  assert.deepEqual(name("g10m8s3-1"), { chip: "8.3 · part 1", heading: "8.3 Gradient of a line · part 1 of 2" });
});

/* ------------------------------------------------------------------ */
/* Readiness, derived                                                  */
/* ------------------------------------------------------------------ */

test("readiness is the catalogue: today Chapter 8's 5 of 65, 13 chapters wholly being prepared", () => {
  const prepared = preparedSlugs(CH8);
  assert.deepEqual(outlineCounts(G10, OUTLINE, prepared), { chapters: 14, lessons: 65, prepared: 5, preparing: 60 });
  const preparing = chaptersBeingPrepared(G10, OUTLINE, prepared);
  assert.equal(preparing.length, 13);
  assert.ok(!preparing.some((c) => c.id === "module:g10m-c08"), "Chapter 8 is on the map, not a placeholder");
  assert.deepEqual(
    preparing.map((c) => c.moduleOrder),
    [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14],
    "in book order"
  );
  assert.equal(preparing.find((c) => c.id === "module:g10m-c01")?.lessons, 8);
  assert.ok(hasUnpreparedLessons(G10, OUTLINE, prepared));
  assert.ok(isUnprepared("g10m1s3-1", OUTLINE, prepared));
  assert.ok(!isUnprepared("g10m8s1-1", OUTLINE, prepared), "a prepared lesson");
  assert.ok(!isUnprepared("u1-1", OUTLINE, prepared), "a slug no outline lists is not 'unprepared'");
});

test("a chapter becomes startable the moment its lessons are in the catalogue — no change to the outline", () => {
  const before = pickerGroups(CH8, OUTLINE);
  assert.ok(before.find((g) => g.id === "module:g10m-c01")?.preparing);

  // "load" Chapter 1: its lessons reach the catalogue; the outline is untouched
  const ch1 = OUTLINE.filter((o) => o.moduleId === "module:g10m-c01").map(g10Lesson);
  const catalogue = [...ch1, ...CH8];
  const after = pickerGroups(catalogue, OUTLINE);
  const c1 = after.find((g) => g.id === "module:g10m-c01")!;
  assert.equal(c1.preparing, false);
  assert.ok(c1.entries.every((e) => e.ready));
  assert.deepEqual(outlineCounts(G10, OUTLINE, preparedSlugs(catalogue)).prepared, 13);
  assert.equal(chaptersBeingPrepared(G10, OUTLINE, preparedSlugs(catalogue)).length, 12);

  // a PARTLY loaded chapter: its prepared lessons ready, the rest still shown, not startable
  const partial = [ch1[0]!, ...CH8];
  const p1 = pickerGroups(partial, OUTLINE).find((g) => g.id === "module:g10m-c01")!;
  assert.equal(p1.preparing, false, "a chapter with a prepared lesson is not a placeholder");
  assert.deepEqual(p1.entries.map((e) => e.ready), [true, false, false, false, false, false, false, false]);
  assert.ok(
    !chaptersBeingPrepared(G10, OUTLINE, preparedSlugs(partial)).some((c) => c.id === "module:g10m-c01")
  );
});

test("everything prepared: no placeholder, no 'being prepared', the whole-course banner may say so", () => {
  const all = OUTLINE.map(g10Lesson);
  const prepared = preparedSlugs(all);
  assert.deepEqual(chaptersBeingPrepared(G10, OUTLINE, prepared), []);
  assert.equal(hasUnpreparedLessons(G10, OUTLINE, prepared), false);
  assert.ok(pickerGroups(all, OUTLINE).every((g) => !g.preparing && g.entries.every((e) => e.ready)));
});

test("Samuel 2026-10-01: the Grade 10 list is open by default; National keeps its collapsed picker", () => {
  assert.equal(bookOpenByDefault(G10, OUTLINE), true);
  assert.equal(bookOpenByDefault("course:prep3-math-en", OUTLINE), false, "a National lesson, even beside a G10 outline");
  assert.equal(bookOpenByDefault(G10, []), false, "no outline loaded: as before");
  assert.equal(bookOpenByDefault(null, OUTLINE), false);
});

test("Samuel 2026-10-01: the course card counts ready of the whole book, growing as chapters load", () => {
  const today = readyCount(G10, OUTLINE, preparedSlugs(CH8));
  assert.deepEqual(today, { ready: 5, total: 65 });
  assert.equal(readyCountText(today!), "5 of 65 lessons ready");
  // Chapter 1 loads — nothing else changes
  const ch1 = OUTLINE.filter((o) => o.moduleId === "module:g10m-c01").map(g10Lesson);
  assert.equal(readyCountText(readyCount(G10, OUTLINE, preparedSlugs([...ch1, ...CH8]))!), "13 of 65 lessons ready");
  // a course with no outline gets no count — its card keeps "N lessons"
  assert.equal(readyCount("course:prep3-math-en", OUTLINE, preparedSlugs(nationalCatalogue())), null);
  assert.doesNotMatch(readyCountText(today!), ARABIC);
});

/* ------------------------------------------------------------------ */
/* The picker: the whole book, unprepared lessons not startable         */
/* ------------------------------------------------------------------ */

test("the picker lists the whole book in order; Chapter 8 is today's chapter, the rest shown and not openable", () => {
  const groups = pickerGroups(CH8, OUTLINE);
  assert.equal(groups.length, 14);
  assert.deepEqual(
    groups.flatMap((g) => g.entries.map((e) => e.slug)),
    OUTLINE.map((o) => o.slug),
    "every lesson, in the book's order"
  );
  const ch8 = groups[7]!;
  assert.equal(ch8.id, "module:g10m-c08");
  assert.equal(ch8.label, "Chapter 8 — Analytical geometry");
  assert.equal(ch8.preparing, false);
  // the very catalogue objects, so their chip, mastery and link are unchanged
  assert.deepEqual(
    ch8.entries.map((e) => (e.ready ? e.lesson : null)),
    CH8
  );
  for (const g of groups) {
    if (g === ch8) continue;
    assert.equal(g.preparing, true, `${g.label}: nothing prepared`);
    for (const e of g.entries) {
      assert.equal(e.ready, false, `${e.slug} is not startable`);
      // nothing to open: an unready entry carries no catalogue lesson at all
      assert.ok(!("lesson" in e), `${e.slug}: no lesson behind it to link to`);
    }
  }
  // the only startable lessons are the catalogue's
  const startable = groups.flatMap((g) => g.entries.filter((e) => e.ready).map((e) => e.slug));
  assert.deepEqual(startable, CH8.map((l) => l.slug));
});

test("'Up next' and the landing pick only prepared lessons — the outline is not one of their inputs", () => {
  // the landing chooses from the gated catalogue; the outline's first lesson
  // (1.2–1.3, unprepared) is never it
  const landing = decideLanding({
    subject: undefined,
    courseId: G10,
    lessonSlug: undefined,
    lessons: CH8,
    pointer: null,
  });
  assert.deepEqual(landing, { screen: "check-in", slug: "g10m8s1-1" });
  // a pointer at an unprepared lesson (impossible today, defended anyway) falls back to a prepared one
  const pointed = decideLanding({
    subject: undefined,
    courseId: G10,
    lessonSlug: undefined,
    lessons: CH8,
    pointer: "g10m1s3-1",
  });
  assert.deepEqual(pointed, { screen: "check-in", slug: "g10m8s1-1" });
});

test("a prepared lesson the outline does not list is never dropped", () => {
  const stray: Lesson = { ...CH8[0]!, slug: "g10m8s9-1", title: "stray" };
  const groups = pickerGroups([...CH8, stray], OUTLINE);
  const ch8 = groups.find((g) => g.id === "module:g10m-c08")!;
  assert.deepEqual(ch8.entries.at(-1), { ready: true, slug: "g10m8s9-1", lesson: stray });
});

/* ------------------------------------------------------------------ */
/* National unchanged                                                  */
/* ------------------------------------------------------------------ */

test("NATIONAL UNCHANGED: with no outline the picker is exactly the old grouping", () => {
  const national = nationalCatalogue();
  assert.ok(national.length >= 30, `the National maths catalogue (${national.length} lessons)`);
  assert.deepEqual(asReference(pickerGroups(national, [])), groupByModule(national));
});

test("NATIONAL UNCHANGED: a G10 outline never touches a National group, even beside it", () => {
  const national = nationalCatalogue();
  // a tester who may see both books: National first (course order), then G10
  const groups = pickerGroups([...national, ...CH8], OUTLINE);
  const nationalGroups = groups.filter((g) => g.courseId !== G10);
  assert.deepEqual(asReference(nationalGroups), groupByModule(national));
  assert.equal(groups.length, groupByModule(national).length + 14);
  assert.deepEqual(groups.slice(0, nationalGroups.length), nationalGroups, "the National units keep their place");
  // the G10 chapters replace its one loaded module, where it stood
  assert.ok(groups.slice(nationalGroups.length).every((g) => g.courseId === G10));
  // and an outline for a course the picker does not show changes nothing
  assert.deepEqual(asReference(pickerGroups(national, OUTLINE)), groupByModule(national));
  assert.deepEqual(outlineOf("course:prep3-math-en", OUTLINE), []);
});

/* ------------------------------------------------------------------ */
/* No Arabic in this course                                             */
/* ------------------------------------------------------------------ */

test("NO ARABIC: the course says so, and nothing the outline shows a Grade 10 student carries Arabic", () => {
  assert.equal(courseDef(G10)?.tutor.arabicTouches, false, "answer 35");
  assert.doesNotMatch(BEING_PREPARED, ARABIC);
  for (const o of OUTLINE) {
    const h = lessonHeading(o.provenance);
    for (const text of [o.moduleLabel, o.provenance.title, ...o.provenance.sections.map((s) => s.title), lessonChipText(h, o.provenance), lessonHeadingText(h)]) {
      assert.doesNotMatch(text, ARABIC, `${o.slug}: ${text}`);
    }
  }
  for (const c of chaptersBeingPrepared(G10, OUTLINE, preparedSlugs(CH8))) assert.doesNotMatch(c.label, ARABIC);
});

test("NO ARABIC: the new student copy — the picker's not-ready pieces, the banner, the map's placeholders", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const checkIn = strip(readFileSync(repo("app/src/components/student/LessonCheckIn.tsx"), "utf8"));
  const play = checkIn.slice(checkIn.indexOf("function PlayCheckIn("), checkIn.indexOf("function ActionRow("));
  assert.ok(play.length > 1000, "PlayCheckIn found");
  assert.doesNotMatch(play, ARABIC, "the Noor Play check-in (the Grade 10 course's) carries no Arabic");
  assert.match(play, /That&apos;s everything that&apos;s ready so far/);
  const spine = strip(readFileSync(repo("app/src/components/spine/SpineExplorer.tsx"), "utf8"));
  const placeholders = spine.slice(spine.indexOf("function ChaptersBeingPrepared("), spine.indexOf("function StageTally("));
  assert.ok(placeholders.length > 200, "ChaptersBeingPrepared found");
  assert.doesNotMatch(placeholders, ARABIC);
  assert.doesNotMatch(strip(readFileSync(repo("app/src/lib/course-outline.ts"), "utf8")), ARABIC);
});

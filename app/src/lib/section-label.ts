/**
 * BOOK SECTIONS AS A STUDENT READS THEM (feature 003, decision 18; FR-4314,
 * FR-4315, FR-4318).
 *
 * `lib/book-sections.ts` holds the rules — which lessons are one unit, the
 * roll-up, the recommendation. This module holds what the student surfaces
 * make of them: the WORDS they print, so the check-in, the subject home and
 * the skill map say "1.7 Factorisation · part 2 of 3" and "2 of 3 parts
 * mastered" the same way; which courses may show their provenance at all; and
 * the two small derivations the readers share (`sectionProgress`,
 * `sectionFocusObjectives`), kept here so they are tested without a database.
 * Pure; no database, no React. Student copy is English (constitution
 * Principle V).
 *
 * ---------------------------------------------------------------------------
 * WHICH COURSES SHOW THEIR BOOK PROVENANCE, AND WHY NOT EVERY ONE
 * ---------------------------------------------------------------------------
 * The loader writes a `course_lessons` row for EVERY lesson of every course
 * (T404, FR-4311), National included: one section each, numbered from the
 * printed "Lesson 4-1" and titled from the objectives' syllabus reference. For
 * the Arabic book that title is the lesson's real name ("عِبادُ الرَّحمنِ"),
 * while what the catalogue, the check-in and the tutor's prompt have always
 * called the lesson is its first objective's label ("فهم النص والاستماع",
 * the same for all twenty Arabic lessons). Reading titles from any row would
 * therefore rename every Arabic lesson — in the prompts that FR-4206 holds
 * byte-identical — the day the loader first runs.
 *
 * So a course takes its lesson titles, printed numbers and parts from the
 * store only when its provenance says something a single "Lesson n" cannot: a
 * part of a split section, a lesson covering several sections, or a promoted
 * chapter introduction (`bookShapedCourses`). That is plan A12's invariant as
 * a predicate — "a course with no split or merged section reads, renders and
 * prompts exactly as before" — and it holds whether or not the loader has
 * written the course's one-section rows. The Grade 10 book has all three
 * shapes; no National course has any.
 *
 * ONE EXCEPTION, FOR TITLES ONLY (Samuel's decision 13, 2026-09-25; ADR-0020
 * note). The Arabic lessons are to be called by the book's printed names. So
 * the TITLE rule (`shownTitles`) also reads the store for a course whose
 * registry entry sets `tutor.bookLessonTitles` — Prep-3 Arabic — while the
 * PROVENANCE rule (`shownProvenance`) does not: an Arabic lesson keeps its
 * printed number, its chips and its headers, and its prompts change in the
 * lesson-title lines alone. Maths and Social Studies stay byte-identical.
 */
import {
  partsInCatalogue,
  printedLabel,
  sectionRollups,
  type LessonProvenance,
  type SectionIndex,
  type SectionRecommendation,
  type SectionRollup,
} from "./book-sections";
import type { ProgressionLesson } from "./progression";
import type { SectionProgress } from "./types";
import { slugOfLo } from "./lesson-slug";
import { courseDef } from "./courses";

/** A part, a merge or a promoted chapter introduction — a lesson a single "Lesson n" cannot describe. */
export function isBookShaped(p: LessonProvenance): boolean {
  return p.part != null || p.sections.length > 1 || p.chapterIntro;
}

/**
 * The courses whose lessons are named from the book-section store: those
 * with at least one book-shaped lesson (see the header). Every other course —
 * every National course, with or without its one-section rows — keeps the
 * number and title it always showed.
 */
export function bookShapedCourses(rows: readonly LessonProvenance[]): Set<string> {
  const out = new Set<string>();
  for (const p of rows) if (isBookShaped(p)) out.add(p.courseId);
  return out;
}

/**
 * The provenance a surface should show for each lesson, by slug: the rows of
 * the book-shaped courses only (`bookShapedCourses`). A slug absent here
 * shows what it always showed.
 */
export function shownProvenance(rows: readonly LessonProvenance[]): Map<string, LessonProvenance> {
  const shaped = bookShapedCourses(rows);
  const out = new Map<string, LessonProvenance>();
  for (const p of rows) if (shaped.has(p.courseId) && !out.has(p.slug)) out.set(p.slug, p);
  return out;
}

/**
 * The printed title the store gives each lesson a surface should NAME from
 * it, by slug: every lesson of a book-shaped course (as `shownProvenance`),
 * and every lesson of a course whose registry entry says its lessons carry
 * the book's printed names (`CourseTutorFacts.bookLessonTitles` — Prep-3
 * Arabic, Samuel's decision 13 of 2026-09-25: «عِبادُ الرَّحمنِ», not the
 * first objective «فهم النص والاستماع» all twenty lessons share).
 *
 * TITLES ONLY. A course named here by its registry flag gets no provenance
 * (`shownProvenance` is unchanged), so its printed lesson number, its chips
 * and its headers stay exactly as they were (FR-4318's "that display is
 * unchanged"); only the title moves. That is the approved ADR-0020 exception
 * (ADR-0020 note, decision 13) — for the Arabic course's lesson title and
 * nothing else. A course without the flag and without a book-shaped lesson
 * — Prep-3 maths, whose registry titles win anyway, and Social Studies —
 * reads exactly as before, with or without its one-section rows.
 *
 * An empty stored title is no title: the caller keeps its fallback.
 */
export function shownTitles(rows: readonly LessonProvenance[]): Map<string, string> {
  const shaped = bookShapedCourses(rows);
  const out = new Map<string, string>();
  for (const p of rows) {
    if (out.has(p.slug)) continue;
    if (!shaped.has(p.courseId) && courseDef(p.courseId)?.tutor.bookLessonTitles !== true) continue;
    const title = printedLabel(p).title.trim();
    if (title !== "") out.set(p.slug, title);
  }
  return out;
}

/** "1.7" → [prefix "1.", 7]; null when the number does not end in digits. */
function splitNumber(n: string): { head: string; k: number } | null {
  const m = /^(.*?)(\d+)$/.exec(n);
  return m ? { head: m[1], k: Number(m[2]) } : null;
}

/**
 * The printed section number(s) of a lesson: "1.7"; "1.2–1.3" for a merge of
 * consecutive sections (P3a), "5.2–5.4" for three (P3b); a list for sections
 * that are not consecutive, so a range never claims a section the lesson does
 * not cover.
 */
export function sectionNumbers(numbers: readonly string[]): string {
  if (numbers.length <= 1) return numbers[0] ?? "";
  const parts = numbers.map(splitNumber);
  const first = parts[0];
  const consecutive =
    first != null &&
    parts.every((p, i) => p != null && p.head === first.head && p.k === first.k + i);
  return consecutive ? `${numbers[0]}–${numbers[numbers.length - 1]}` : numbers.join(", ");
}

/** What a lesson header prints, from its stored provenance (FR-4318). */
export interface LessonHeading {
  /** the printed section number(s): "1.7", "1.2–1.3" */
  number: string;
  /** the printed title: "Factorisation" */
  title: string;
  /** "part 2 of 3", or null for a lesson that is not a part */
  part: string | null;
}

export function lessonHeading(p: LessonProvenance): LessonHeading {
  const label = printedLabel(p);
  return { number: sectionNumbers(label.numbers), title: label.title, part: label.partLabel };
}

/** "1.7 Factorisation · part 2 of 3" — one string, for titles and accessible names. */
export function lessonHeadingText(h: LessonHeading): string {
  const head = [h.number, h.title].filter((s) => s !== "").join(" ");
  return h.part ? `${head} · ${h.part}` : head;
}

/** "1.7 · part 2" — a lesson chip in the picker, where the title is the chip's tooltip. */
export function lessonChipText(h: LessonHeading, p: LessonProvenance): string {
  return p.part ? `${h.number} · part ${p.part.n}` : h.number;
}

/** "2 of 3 parts mastered" (FR-4314). */
export function rollupText(r: Pick<SectionRollup, "mastered" | "parts">): string {
  return `${r.mastered} of ${r.parts} parts mastered`;
}

/**
 * The same roll-up on an Arabic (RTL) card: «الأجزاء المتقنة: ٢ من ٣»
 * ("parts mastered: 2 of 3"). Worded as a label and a count so it needs no
 * gender agreement (no «أتقنتَ/أتقنتِ») and no number–noun agreement (Arabic
 * «جزءان/ثلاثة أجزاء» changes with the number). Western digits, as the same
 * subject card prints its lesson count («12 دروس») and its score. No
 * Arabic-taught course has a split section today, so nothing renders it yet.
 * PROVISIONAL WORDING, flagged for product-designer review (backlog #38).
 */
export function rollupTextAr(r: Pick<SectionRollup, "mastered" | "parts">): string {
  return `الأجزاء المتقنة: ${r.mastered} من ${r.parts}`;
}

/** "1.7 Factorisation" — a split section's label on the skill map (FR-4315). */
export function sectionLabel(s: { number: string | null; title: string | null }): string {
  return [s.number, s.title].filter((x): x is string => !!x).join(" ");
}

/** "Continue Factorisation" — a recommendation into a started section (FR-4313). */
export function continueText(rec: Pick<SectionRecommendation, "title" | "number">): string {
  return `Continue ${rec.title ?? rec.number ?? "this section"}`;
}

/* ------------------------------------------------------------------ */
/* What the readers compute from the rules (pure)                      */
/* ------------------------------------------------------------------ */

/**
 * Split-section roll-ups for the subject home and the progress page
 * (FR-4314): `sectionRollups` over the lessons in catalogue order, each
 * marked started when any objective of any part has evidence (mastery > 0 —
 * every BKT update clamps above zero, the rule `sectionRecommendation` uses).
 * Empty with no split section, which is every National course.
 */
export function sectionProgress(
  lessons: readonly ProgressionLesson[],
  index: SectionIndex
): SectionProgress[] {
  if (!index.hasSplits) return [];
  const bySlug = new Map(lessons.map((l) => [l.slug, l] as const));
  return sectionRollups(lessons, index).map((r) => ({
    ...r,
    started: r.partsMastered.some((p) =>
      (bySlug.get(p.slug)?.los ?? []).some((lo) => lo.mastery > 0)
    ),
  }));
}

/**
 * The objectives FR-4316 puts first in the tutor's Ask context for a question
 * on objective `loId`: when its lesson is a part of a split section, every
 * objective of that section — its own part, then the other parts NEAREST
 * first (for part 2 of 3: part 2, part 1, part 3), each in catalogue order.
 * Empty when the lesson is not a part, which is every National lesson.
 */
export function sectionFocusObjectives(
  loId: string,
  catalog: readonly ProgressionLesson[],
  index: SectionIndex
): string[] {
  const slug = slugOfLo(loId);
  const group = index.groupOf(slug);
  if (!group.split) return [];
  const parts = partsInCatalogue(group, catalog);
  const at = parts.findIndex((l) => l.slug === slug);
  if (at < 0) return [];
  return parts
    .map((l, i) => ({ l, i, d: Math.abs(i - at) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .flatMap(({ l }) => l.los.map((lo) => lo.id));
}

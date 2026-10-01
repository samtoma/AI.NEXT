/**
 * THE WHOLE BOOK, BEFORE ALL OF IT IS PREPARED (feature 003; Samuel,
 * 2026-10-01: "I want the students to see all chapters as well not only 8!").
 *
 * The Grade 10 book's structure — 14 chapters, 65 lessons, titles, order — is
 * known from its manifest (gate G0). Its content reaches the database a
 * chapter at a time, as the teaching pipeline prepares it. The structure is
 * stored in `course_outline` (migration 037, written by
 * `services/extraction/load_course_outline.py`); this module holds the RULES
 * that read it. Pure: no database, no React — so the client skill map can use
 * it and every branch is a `node --test` case (`course-outline.test.mts`).
 *
 * ---------------------------------------------------------------------------
 * READINESS IS DERIVED, NEVER STORED
 * ---------------------------------------------------------------------------
 * A lesson is PREPARED exactly when it is in the student's gated catalogue —
 * `getLessonCatalog` (lib/lesson.ts), which builds a lesson from its loaded
 * objectives (`lo:<slug>-<n>` filed under a module of the course). That is
 * the rule that has always decided what a lesson IS, so:
 *
 *   · the fan-out needs no extra step: the moment `load_seed.py` loads a
 *     chapter, its lessons are in the catalogue and become startable here,
 *     with no change to the outline and no code change per chapter;
 *   · a lesson can never be shown as startable while having nothing to teach
 *     from (constitution II, grounded teaching always) — "visible" is the
 *     outline, "teachable" is the catalogue, and nothing here turns the first
 *     into the second;
 *   · "Up next", the practice plan and every tutor surface keep reading the
 *     catalogue alone. Nothing in this module feeds them.
 *
 * ---------------------------------------------------------------------------
 * A COURSE WITH NO OUTLINE IS EXACTLY WHAT IT WAS
 * ---------------------------------------------------------------------------
 * Only a course with outline rows changes. Every National course has none, so
 * `pickerGroups` returns the very grouping the check-in always built (every
 * entry ready, the catalogue's module order) and the skill map gets no
 * placeholders. An outline is read only for courses the caller has already
 * gated (`lib/course-outline-queries.ts`), so a student sees the outline of a
 * course she may see and of no other — curriculum isolation is untouched.
 *
 * Student copy is English (constitution Principle V); the Grade 10 course
 * touches no Arabic (`CourseTutorFacts.arabicTouches = false`, answer 35).
 */
import { provenanceFromRow, type BookSectionRow, type LessonProvenance } from "./book-sections";

/* ------------------------------------------------------------------ */
/* The store (migration 037)                                          */
/* ------------------------------------------------------------------ */

/**
 * Is the store there? The outline is an overlay on what a student already
 * sees: a database without migration 037 has no outline, and every surface
 * then shows exactly what it showed before 037 — so the reader asks first
 * rather than failing a check-in over a missing table.
 */
export const OUTLINE_PRESENT_SQL = `SELECT to_regclass('public.course_outline') IS NOT NULL AS present`;

/** Every outline row of the given courses (`$1`, already gated), in reading order. */
export const COURSE_OUTLINE_SQL = `
  SELECT course_id, lesson_slug, module_id, module_label, module_order, book_order,
         title, sections, section_titles, part_n, part_of, chapter_intro, group_key,
         page_from, page_to
    FROM course_outline
   WHERE course_id = ANY($1::text[])
   ORDER BY course_id, book_order`;

/** Is `$1` a lesson some book's outline lists? The guard's read (lib/lesson.ts). */
export const OUTLINE_LESSON_SQL = `SELECT course_id FROM course_outline WHERE lesson_slug = $1 LIMIT 1`;

/** One row of `course_outline`, as `COURSE_OUTLINE_SQL` returns it. */
export interface OutlineRow extends BookSectionRow {
  module_id: string;
  module_label: string;
  module_order: number | string;
  book_order: number | string;
  page_from: number | string | null;
  page_to: number | string | null;
}

/** One lesson of a book's outline, prepared or not. */
export interface OutlineLesson {
  courseId: string;
  slug: string;
  /** the module the chapter is (or will be, once loaded): "module:g10m-c01" */
  moduleId: string;
  /** "Chapter 1 — Algebraic expressions" — the label the loaded module takes */
  moduleLabel: string;
  moduleOrder: number;
  /** its place in the whole book, 1…N: THE reading order */
  bookOrder: number;
  /** printed section number(s), title, part — the same shape a loaded lesson has (034) */
  provenance: LessonProvenance;
  /** printed pages, when the manifest records them */
  pages: { from: number; to: number } | null;
}

const asInt = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

/** Rows as the app reads them, sorted by course then reading order. */
export function outlineFromRows(rows: readonly OutlineRow[]): OutlineLesson[] {
  return rows
    .map((r) => {
      const from = asInt(r.page_from);
      const to = asInt(r.page_to);
      return {
        courseId: r.course_id,
        slug: r.lesson_slug,
        moduleId: r.module_id,
        moduleLabel: r.module_label,
        moduleOrder: asInt(r.module_order) ?? 0,
        bookOrder: asInt(r.book_order) ?? 0,
        provenance: provenanceFromRow(r),
        pages: from != null && to != null ? { from, to } : null,
      };
    })
    .sort((a, b) => a.courseId.localeCompare(b.courseId) || a.bookOrder - b.bookOrder);
}

/* ------------------------------------------------------------------ */
/* Readiness — derived from the catalogue                              */
/* ------------------------------------------------------------------ */

/** The words a lesson or chapter that is not prepared yet carries. Student copy. */
export const BEING_PREPARED = "Being prepared";

/** The prepared lessons: exactly the slugs of the (gated) catalogue. */
export function preparedSlugs(catalog: readonly { slug: string }[]): Set<string> {
  return new Set(catalog.map((l) => l.slug));
}

/** The outline lessons of one course, in reading order. */
export function outlineOf(courseId: string | null | undefined, outline: readonly OutlineLesson[]): OutlineLesson[] {
  if (courseId == null) return [];
  return outline.filter((o) => o.courseId === courseId).sort((a, b) => a.bookOrder - b.bookOrder);
}

/** An outline lesson that is not prepared: listed in the book, nothing loaded to teach from. */
export function isUnprepared(
  slug: string,
  outline: readonly OutlineLesson[],
  prepared: ReadonlySet<string>
): boolean {
  return !prepared.has(slug) && outline.some((o) => o.slug === slug);
}

/** How much of a course's book is prepared — counts for a caption or a report. */
export function outlineCounts(
  courseId: string,
  outline: readonly OutlineLesson[],
  prepared: ReadonlySet<string>
): { chapters: number; lessons: number; prepared: number; preparing: number } {
  const mine = outlineOf(courseId, outline);
  const ready = mine.filter((o) => prepared.has(o.slug)).length;
  return {
    chapters: new Set(mine.map((o) => o.moduleId)).size,
    lessons: mine.length,
    prepared: ready,
    preparing: mine.length - ready,
  };
}

/** True when some lesson of the course's book is not prepared yet. */
export function hasUnpreparedLessons(
  courseId: string | null | undefined,
  outline: readonly OutlineLesson[],
  prepared: ReadonlySet<string>
): boolean {
  return outlineOf(courseId, outline).some((o) => !prepared.has(o.slug));
}

/** A chapter of the book with no lesson prepared yet — the skill map's placeholder. */
export interface PreparingChapter {
  id: string;
  /** "Chapter 1 — Algebraic expressions" */
  label: string;
  moduleOrder: number;
  /** how many lessons the book has in it */
  lessons: number;
}

/**
 * The chapters of a course's book with NO lesson prepared, in book order. A
 * chapter with one prepared lesson is on the map (its prepared topics) and is
 * not a placeholder; the lessons it still lacks are listed on the check-in.
 */
export function chaptersBeingPrepared(
  courseId: string,
  outline: readonly OutlineLesson[],
  prepared: ReadonlySet<string>
): PreparingChapter[] {
  const out: PreparingChapter[] = [];
  const byId = new Map<string, PreparingChapter & { ready: boolean }>();
  for (const o of outlineOf(courseId, outline)) {
    let c = byId.get(o.moduleId);
    if (!c) {
      c = { id: o.moduleId, label: o.moduleLabel, moduleOrder: o.moduleOrder, lessons: 0, ready: false };
      byId.set(o.moduleId, c);
    }
    c.lessons += 1;
    if (prepared.has(o.slug)) c.ready = true;
  }
  // In the order the chapters first appear in the book's reading order
  // (`outlineOf` walks `bookOrder`), which IS book order — no second sort.
  for (const c of byId.values()) {
    if (!c.ready) out.push({ id: c.id, label: c.label, moduleOrder: c.moduleOrder, lessons: c.lessons });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The check-in's "Everything in the book" groups                      */
/* ------------------------------------------------------------------ */

/** What the picker needs from a catalogue lesson (`LessonInfo` has it all). */
export interface CatalogueLesson {
  slug: string;
  courseId: string | null;
  moduleId: string;
  moduleLabel: string;
  subject: string | null;
}

/** One lesson in a picker group: a catalogue lesson to open, or an outline lesson to show only. */
export type PickerEntry<L extends CatalogueLesson> =
  | { ready: true; slug: string; lesson: L }
  | { ready: false; slug: string; outline: OutlineLesson };

/** One unit (or chapter) of the picker. */
export interface PickerGroup<L extends CatalogueLesson> {
  id: string;
  label: string;
  subject: L["subject"];
  courseId: string | null;
  entries: PickerEntry<L>[];
  /** true when no lesson of the group is prepared — a whole chapter still being prepared */
  preparing: boolean;
}

/**
 * The check-in picker's groups — "Everything in the book".
 *
 * First the catalogue grouped by module, in catalogue order, every entry
 * ready: exactly the grouping the check-in has always built (it was
 * `groupByModule` in LessonCheckIn.tsx), and all a National course ever gets.
 *
 * Then, for each course with an outline, its groups are REPLACED, at the
 * place its first group stood, by its book's chapters in book order with
 * every lesson listed: a lesson in the catalogue is a ready entry (the very
 * catalogue object, so its chip, mastery and link are what they always were),
 * any other outline lesson an entry to show and not to open. A chapter with a
 * prepared lesson keeps the catalogue's label for it, so Chapter 8 reads as
 * today. A catalogue lesson the outline does not list is never dropped: it is
 * appended to its own module's group after the book's chapters.
 */
export function pickerGroups<L extends CatalogueLesson>(
  catalog: readonly L[],
  outline: readonly OutlineLesson[]
): PickerGroup<L>[] {
  const groups: PickerGroup<L>[] = [];
  for (const l of catalog) {
    const g = groups.find((x) => x.id === l.moduleId);
    if (g) g.entries.push({ ready: true, slug: l.slug, lesson: l });
    else
      groups.push({
        id: l.moduleId,
        label: l.moduleLabel,
        subject: l.subject,
        courseId: l.courseId,
        entries: [{ ready: true, slug: l.slug, lesson: l }],
        preparing: false,
      });
  }

  const outlined = new Set(outline.map((o) => o.courseId));
  if (outlined.size === 0) return groups;

  const out: PickerGroup<L>[] = [];
  const replaced = new Set<string>();
  for (const g of groups) {
    const courseId = g.courseId;
    if (courseId == null || !outlined.has(courseId)) {
      out.push(g);
      continue;
    }
    if (replaced.has(courseId)) continue;
    replaced.add(courseId);
    out.push(...bookChapters(courseId, g.subject, catalog, outline));
  }
  return out;
}

/** One course's chapters in book order, every lesson listed (see `pickerGroups`). */
function bookChapters<L extends CatalogueLesson>(
  courseId: string,
  subject: L["subject"],
  catalog: readonly L[],
  outline: readonly OutlineLesson[]
): PickerGroup<L>[] {
  const ready = new Map(
    catalog.filter((l) => l.courseId === courseId).map((l) => [l.slug, l] as const)
  );
  const chapters: PickerGroup<L>[] = [];
  const byId = new Map<string, PickerGroup<L>>();
  const listed = new Set<string>();
  for (const o of outlineOf(courseId, outline)) {
    listed.add(o.slug);
    let c = byId.get(o.moduleId);
    if (!c) {
      c = { id: o.moduleId, label: o.moduleLabel, subject, courseId, entries: [], preparing: true };
      byId.set(o.moduleId, c);
      chapters.push(c);
    }
    const lesson = ready.get(o.slug);
    if (lesson) {
      c.entries.push({ ready: true, slug: o.slug, lesson });
      if (c.preparing) {
        c.preparing = false;
        c.label = lesson.moduleLabel;
      }
    } else {
      c.entries.push({ ready: false, slug: o.slug, outline: o });
    }
  }
  // never drop a prepared lesson the outline does not list
  for (const l of ready.values()) {
    if (listed.has(l.slug)) continue;
    let c = byId.get(l.moduleId);
    if (!c) {
      c = { id: l.moduleId, label: l.moduleLabel, subject, courseId, entries: [], preparing: false };
      byId.set(l.moduleId, c);
      chapters.push(c);
    }
    c.entries.push({ ready: true, slug: l.slug, lesson: l });
    c.preparing = false;
  }
  return chapters;
}

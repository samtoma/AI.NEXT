/**
 * BOOK SECTIONS — the parts of one printed section are one unit (feature 003,
 * decision 18; FR-4311…FR-4314, FR-4317; ADR-0020 note of 2026-09-25).
 *
 * Samuel, 2026-09-25: *"need good taging and understanding that it is like
 * that, so when we recommend or suggest scoring etc... we consider them very
 * related"*. G0 split five sections of the Grade 10 book into parts (1.7
 * Factorisation is three lessons), merged two pairs, and promoted two chapter
 * introductions to lessons. Every lesson's provenance is stored as data in
 * `course_lessons` (migration 034, written by the loader); this module holds
 * the RULES that read it:
 *
 *   · the section key and part order — which lessons are one unit;
 *   · FR-4312: the parts are consecutive in catalogue order, in part order
 *     (`consecutiveParts` repairs a catalogue that is not; `partOrderProblems`
 *     reports it);
 *   · FR-4313: may the place move past this section? (`mayLeaveSection`) —
 *     and the recommendation into a started section is named by the section
 *     (`sectionRecommendation`);
 *   · FR-4314: the roll-up, "k of m parts mastered", mastered only when every
 *     part is (`sectionRollup`, `sectionRollups`);
 *   · FR-4317: part n-1 is a prerequisite of part n, DERIVED here at read time
 *     and marked as the product's (`partPrereqEdges`), never written into
 *     `graph_edges`.
 *
 * The walk that uses them — where the pointer goes after a lesson passes —
 * stays in lib/progression.ts with the rest of ADR-0020's rule.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ONE UNIT, AND WHY A NATIONAL COURSE CANNOT CHANGE
 * ---------------------------------------------------------------------------
 * A split section is the set of rows sharing (course, group_key) that carry a
 * part number — at least two of them. EVERY OTHER LESSON IS ITS OWN UNIT,
 * whatever its group_key says, and so is a lesson with no row at all. That is
 * load-bearing: the Prep-3 maths book prints "Lesson 3-1" for both `u3-1` and
 * `t2u3-1`, and "Lesson 4-1" for both `u4-1` and `geo1-1`, so a rule that
 * grouped by group_key alone would weld unrelated lessons together as soon as
 * the loader wrote one-section rows for the National books (T404). With no
 * split section in a course, every function here is the identity or reduces
 * to the single-lesson rule, and lib/progression.ts runs its pre-003 code
 * path verbatim (`hasSplits` false). `book-sections.test.mts` and
 * `progression-sections.test.mts` prove both on the real National catalogue.
 *
 * ---------------------------------------------------------------------------
 * "MASTERED" IS THE PROGRESSION GATE
 * ---------------------------------------------------------------------------
 * A part counts as mastered when it passes `lessonGatePassed` — EVERY
 * objective at 0.75 (lib/progression.ts), not the averaged ramp. So the
 * roll-up and the pointer can never disagree: the section reads "3 of 3" at
 * exactly the moment the pointer is allowed to leave it (SC-211).
 *
 * PURE. No database, no clock. The one SQL text here (`BOOK_SECTIONS_SQL`) is
 * a constant any reader runs on its own handle — the progression, the subject
 * home, the progress page, the Ask context, the console — so the store is read
 * one way everywhere without those readers importing a database module they
 * do not already import. The caller passes the course ids it has ALREADY
 * gated: this table holds lesson titles, and a hidden course's titles are not
 * a student's to read.
 *
 * It imports the gate from lib/progression.ts; lib/progression.ts imports only
 * this module's TYPES, and applies the rules through the `SectionIndex`
 * object's methods, so the two modules never import each other at runtime.
 */
import { lessonGatePassed, type ProgressionLesson } from "./progression";

/* ------------------------------------------------------------------ */
/* The store (migration 034)                                          */
/* ------------------------------------------------------------------ */

/**
 * Every lesson row of the given courses. `$1` is a `text[]` of course ids the
 * caller has already gated. Ordered only so the result is deterministic; part
 * order is decided by `part_n`, not by this.
 */
export const BOOK_SECTIONS_SQL = `
  SELECT course_id, lesson_slug, title, sections, section_titles,
         part_n, part_of, chapter_intro, group_key
    FROM course_lessons
   WHERE course_id = ANY($1::text[])
   ORDER BY course_id, lesson_slug`;

/**
 * ONE lesson's row: `$1` the course id (already gated), `$2` the lesson slug.
 * The read for a caller that holds one lesson — the lesson prompt's header
 * (`getLessonData`, lib/lesson.ts) — on its own handle; map the row with
 * `provenanceFromRow` and label it with `printedLabel`.
 */
export const LESSON_PROVENANCE_SQL = `
  SELECT course_id, lesson_slug, title, sections, section_titles,
         part_n, part_of, chapter_intro, group_key
    FROM course_lessons
   WHERE course_id = $1 AND lesson_slug = $2`;

/** One row of `course_lessons`, as `BOOK_SECTIONS_SQL` returns it. */
export interface BookSectionRow {
  course_id: string;
  lesson_slug: string;
  title: string;
  sections: string[] | null;
  section_titles: string[] | null;
  part_n: number | string | null;
  part_of: number | string | null;
  chapter_intro: boolean | null;
  group_key: string;
}

/** A printed section: its number ("1.7") and its title ("Factorisation"). */
export interface PrintedSection {
  number: string;
  title: string;
}

/** Where a lesson comes from in its book (FR-4311). */
export interface LessonProvenance {
  courseId: string;
  slug: string;
  title: string;
  /** the printed sections it covers, in book order — one, or several for a merge */
  sections: readonly PrintedSection[];
  /** "part n of m", only for a part of a split section */
  part: { n: number; of: number } | null;
  /** a promoted chapter introduction */
  chapterIntro: boolean;
  /** the printed section a part belongs to; the lesson's own section otherwise */
  groupKey: string;
}

/** The four shapes a lesson can have (FR-4311, US6 scenario 6). */
export type ProvenanceKind = "section" | "part" | "merged" | "chapter-intro";

export function provenanceKind(p: LessonProvenance): ProvenanceKind {
  if (p.part) return "part";
  if (p.chapterIntro) return "chapter-intro";
  if (p.sections.length > 1) return "merged";
  return "section";
}

const asInt = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

/**
 * A row as the app reads it. The part is kept only when it is well formed —
 * migration 034's CHECKs guarantee that in the database; this guards a
 * hand-built row (a test, a fixture) the same way, so a malformed part is
 * read as no part rather than as a unit it cannot be.
 */
export function provenanceFromRow(r: BookSectionRow): LessonProvenance {
  const numbers = r.sections ?? [];
  const titles = r.section_titles ?? [];
  const n = asInt(r.part_n);
  const of = asInt(r.part_of);
  return {
    courseId: r.course_id,
    slug: r.lesson_slug,
    title: r.title,
    sections: numbers.map((number, i) => ({ number, title: titles[i] ?? "" })),
    part: n != null && of != null && n >= 1 && n <= of ? { n, of } : null,
    chapterIntro: r.chapter_intro === true,
    groupKey: r.group_key,
  };
}

/* ------------------------------------------------------------------ */
/* FR-4318 — what a lesson is called, as printed                      */
/* ------------------------------------------------------------------ */

/** A lesson's printed number(s), printed title and part, for headers and prompts. */
export interface PrintedLabel {
  /** the printed section numbers it covers, in book order ("1.7"; "1.2", "1.3" for a merge) */
  numbers: readonly string[];
  /**
   * The printed title. `course_lessons.title` as the loader wrote it; when
   * that is empty, the printed title of the section the lesson is filed under
   * (a part's section, else its first). Never an objective's label: that is
   * the fallback `lessonTitle()` in lib/lesson.ts uses only when the store has
   * no row for the lesson.
   */
  title: string;
  /** the printed title of each section it covers, element for element with `numbers` */
  sectionTitles: readonly string[];
  /** "part n of m" as numbers, for a part of a split section */
  part: { n: number; of: number } | null;
  /** "part 2 of 3" — English, as student copy is for MVP 1.0; null for a lesson that is not a part */
  partLabel: string | null;
  chapterIntro: boolean;
}

/**
 * The printed label of a lesson from its stored provenance (FR-4311,
 * FR-4318). Pure. A lesson with no row has no label: the caller keeps what it
 * shows today, which is what keeps every National header unchanged until its
 * rows exist and, after, exactly as its rows say.
 */
export function printedLabel(p: LessonProvenance): PrintedLabel {
  const filed = p.sections.find((s) => s.number === p.groupKey) ?? p.sections[0];
  return {
    numbers: p.sections.map((s) => s.number),
    title: p.title.trim() !== "" ? p.title : (filed?.title ?? ""),
    sectionTitles: p.sections.map((s) => s.title),
    part: p.part,
    partLabel: p.part ? `part ${p.part.n} of ${p.part.of}` : null,
    chapterIntro: p.chapterIntro,
  };
}

/* ------------------------------------------------------------------ */
/* Units: the section key and part order                              */
/* ------------------------------------------------------------------ */

/**
 * One unit of the catalogue: the parts of a split section, or one lesson.
 *
 * `slugs` are every member the store lists, in part order. The rules below
 * always intersect them with the catalogue they are handed — a lesson exists
 * to be taught only if it has objectives there — so a part the store lists
 * but the catalogue lacks is ignored rather than turned into a barrier no
 * student could ever pass (`sectionProblems` reports it instead).
 */
export interface SectionGroup {
  /** `<course>|<group_key>` for a split section; `<course>|lesson:<slug>` for any other lesson */
  key: string;
  courseId: string | null;
  /** the printed section number — the split section's, else the lesson's first; null without a row */
  number: string | null;
  /** its printed title; null without a row */
  title: string | null;
  /** member lessons, in part order (one, for any other lesson) */
  slugs: readonly string[];
  /** true only for the parts of a split section — two or more rows with a part number */
  split: boolean;
}

/**
 * The store for some courses, indexed. Built by `buildSectionIndex` (or
 * `sectionIndexFromRows`); `NO_SECTIONS` is the empty one.
 *
 * `order` and `prereqsFor` are methods, not only the free functions below,
 * so lib/progression.ts can apply them to its walk without importing this
 * module at runtime (this module imports the gate from there).
 */
export interface SectionIndex {
  /** false when no split section is indexed: every rule then reduces to the single-lesson one */
  readonly hasSplits: boolean;
  /** the split sections, in the order their first rows were indexed */
  readonly splitGroups: readonly SectionGroup[];
  /** the unit a lesson belongs to — a singleton for any lesson that is not a part */
  groupOf(slug: string): SectionGroup;
  /** the lesson's stored provenance, or null when the store has no row for it */
  provenanceOf(slug: string): LessonProvenance | null;
  /** FR-4312: the catalogue with each split section's parts together, in part order */
  order<T extends { slug: string }>(catalog: readonly T[]): T[];
  /** FR-4317: the prerequisite map with the derived part n-1 → n edges added */
  prereqsFor(
    prereqs: ReadonlyMap<string, readonly string[]>,
    catalog: readonly ProgressionLesson[]
  ): ReadonlyMap<string, readonly string[]>;
}

const partKey = (courseId: string, groupKey: string) => `${courseId}|${groupKey}`;
const lessonKey = (courseId: string | null, slug: string) => `${courseId ?? ""}|lesson:${slug}`;

/** The unit of a lesson the store has no row for, or that is not a part. */
function singleton(slug: string, p: LessonProvenance | null): SectionGroup {
  return {
    key: lessonKey(p?.courseId ?? null, slug),
    courseId: p?.courseId ?? null,
    number: p?.sections[0]?.number ?? null,
    title: p?.sections[0]?.title ?? null,
    slugs: [slug],
    split: false,
  };
}

/**
 * Index the store's rows for the courses the caller is walking.
 *
 * A lesson slug is unique across courses (the pipeline's id contract, and
 * `curricula-registry.test.mts` invariant 3), so the index is keyed by slug.
 * Should two rows ever claim one slug, the first is kept and
 * `sectionProblems` says so.
 */
export function buildSectionIndex(rows: readonly LessonProvenance[]): SectionIndex {
  const bySlug = new Map<string, LessonProvenance>();
  for (const p of rows) if (!bySlug.has(p.slug)) bySlug.set(p.slug, p);

  // The parts, by section. Only rows with a part number are candidates.
  const members = new Map<string, LessonProvenance[]>();
  for (const p of bySlug.values()) {
    if (!p.part) continue;
    const k = partKey(p.courseId, p.groupKey);
    const list = members.get(k) ?? [];
    list.push(p);
    members.set(k, list);
  }

  const groupOfSlug = new Map<string, SectionGroup>();
  const splitGroups: SectionGroup[] = [];
  for (const [key, list] of members) {
    // A lone part is not a unit of several: nothing to hold together, and
    // treating it as one would change nothing but the key. It stays its own
    // lesson; `sectionProblems` flags the missing siblings.
    if (list.length < 2) continue;
    const parts = [...list].sort((a, b) => a.part!.n - b.part!.n || a.slug.localeCompare(b.slug));
    const first = parts[0];
    const section =
      first.sections.find((s) => s.number === first.groupKey) ?? first.sections[0] ?? null;
    const group: SectionGroup = {
      key,
      courseId: first.courseId,
      number: first.groupKey,
      title: section?.title ?? null,
      slugs: parts.map((p) => p.slug),
      split: true,
    };
    splitGroups.push(group);
    for (const p of parts) groupOfSlug.set(p.slug, group);
  }

  const index: SectionIndex = {
    hasSplits: splitGroups.length > 0,
    splitGroups,
    groupOf: (slug) => groupOfSlug.get(slug) ?? singleton(slug, bySlug.get(slug) ?? null),
    provenanceOf: (slug) => bySlug.get(slug) ?? null,
    order: (catalog) => consecutiveParts(catalog, index),
    prereqsFor: (prereqs, catalog) => withPartPrereqs(prereqs, catalog, index),
  };
  return index;
}

/** Rows straight from `BOOK_SECTIONS_SQL`, indexed. */
export function sectionIndexFromRows(rows: readonly BookSectionRow[]): SectionIndex {
  return buildSectionIndex(rows.map(provenanceFromRow));
}

/** No store at all: every lesson is its own unit. */
export const NO_SECTIONS: SectionIndex = buildSectionIndex([]);

/** The members of `group` that are in `catalog`, in part order. */
export function partsInCatalogue<T extends { slug: string }>(
  group: SectionGroup,
  catalog: readonly T[]
): T[] {
  const bySlug = new Map(catalog.map((l) => [l.slug, l] as const));
  return group.slugs.map((s) => bySlug.get(s)).filter((l): l is T => l !== undefined);
}

/* ------------------------------------------------------------------ */
/* FR-4312 — parts consecutive, in part order                         */
/* ------------------------------------------------------------------ */

/**
 * The catalogue with each split section's parts moved together, in part
 * order, to where its first-listed part stands. Every other lesson keeps its
 * place. For a catalogue already in that shape — which the loader's objective
 * order produces — and for any course with no split section, it returns the
 * lessons in exactly the order given.
 *
 * Why repair rather than trust. The walk continues from the END of a section;
 * if a stray lesson sat between part 1 and part 2 in the SQL order, a walk
 * that jumped from part 1 to part 2 and then carried on from part 2 would
 * silently skip it for ever. Normalising first makes that impossible.
 */
export function consecutiveParts<T extends { slug: string }>(
  catalog: readonly T[],
  index: SectionIndex
): T[] {
  if (!index.hasSplits) return [...catalog];
  const placed = new Set<string>();
  const out: T[] = [];
  for (const l of catalog) {
    if (placed.has(l.slug)) continue;
    const g = index.groupOf(l.slug);
    if (!g.split) {
      out.push(l);
      placed.add(l.slug);
      continue;
    }
    for (const part of partsInCatalogue(g, catalog)) {
      if (placed.has(part.slug)) continue;
      out.push(part);
      placed.add(part.slug);
    }
  }
  return out;
}

/**
 * FR-4312 as a check: every split section whose parts are not consecutive,
 * or not in part order, in `catalog`. Empty when the catalogue is right. For
 * the loader's and the console's checks; the walk repairs rather than fails.
 */
export function partOrderProblems(
  catalog: readonly { slug: string }[],
  index: SectionIndex
): string[] {
  const at = new Map(catalog.map((l, i) => [l.slug, i] as const));
  const problems: string[] = [];
  for (const g of index.splitGroups) {
    const positions = g.slugs.map((s) => at.get(s)).filter((i): i is number => i !== undefined);
    if (positions.length < 2) continue;
    const inPartOrder = positions.every((p, i) => i === 0 || p > positions[i - 1]);
    const consecutive = positions.every((p, i) => i === 0 || p === positions[i - 1] + 1);
    if (!inPartOrder) problems.push(`${g.key}: parts are not in part order in the catalogue`);
    else if (!consecutive) problems.push(`${g.key}: another lesson sits between its parts in the catalogue`);
  }
  return problems;
}

/**
 * The store's own consistency, for the loader and the console (the database
 * enforces the per-row shape; these are the across-row rules it cannot):
 * a split section's parts agree on m and are exactly 1…m, a part's section
 * is among the sections it covers, and no slug is claimed twice.
 */
export function sectionProblems(rows: readonly LessonProvenance[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const parts = new Map<string, LessonProvenance[]>();
  for (const p of rows) {
    if (seen.has(p.slug)) problems.push(`${p.slug}: more than one row claims this lesson`);
    seen.add(p.slug);
    if (p.sections.length === 0) problems.push(`${p.slug}: no printed section (FR-4311)`);
    if (!p.part) continue;
    if (!p.sections.some((s) => s.number === p.groupKey)) {
      problems.push(`${p.slug}: part of ${p.groupKey}, which is not among the sections it covers`);
    }
    const k = partKey(p.courseId, p.groupKey);
    parts.set(k, [...(parts.get(k) ?? []), p]);
  }
  for (const [k, list] of parts) {
    const ofs = new Set(list.map((p) => p.part!.of));
    if (ofs.size > 1) {
      problems.push(`${k}: its parts disagree on how many there are (${[...ofs].join(", ")})`);
      continue;
    }
    const of = list[0].part!.of;
    const ns = list.map((p) => p.part!.n).sort((a, b) => a - b);
    const want = Array.from({ length: of }, (_, i) => i + 1);
    if (ns.join(",") !== want.join(",")) {
      problems.push(`${k}: parts ${ns.join(", ")} stored, ${want.join(", ")} expected`);
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* FR-4317 — part n-1 is a prerequisite of part n, derived            */
/* ------------------------------------------------------------------ */

/**
 * A prerequisite the PRODUCT adds, as opposed to one the book states. The
 * origin travels with the edge so a reader that shows edges (the skill map,
 * the Ask context) can say which is which (FR-4317: "records it as added by
 * the product rather than stated by the book").
 */
export interface DerivedPrereqEdge {
  /** the prerequisite objective (an objective of part n-1) */
  src: string;
  /** the dependant objective (an objective of part n) */
  dst: string;
  origin: "part-order";
}

/**
 * Every objective of part n-1 is a prerequisite of every objective of part n,
 * for each split section, over the parts present in `catalog`. Derived at
 * read time and never written anywhere: `graph_edges` stays exactly the
 * book's.
 */
export function partPrereqEdges(
  catalog: readonly ProgressionLesson[],
  index: SectionIndex
): DerivedPrereqEdge[] {
  const edges: DerivedPrereqEdge[] = [];
  for (const g of index.splitGroups) {
    const parts = partsInCatalogue(g, catalog);
    for (let i = 1; i < parts.length; i++) {
      for (const dst of parts[i].los) {
        for (const src of parts[i - 1].los) {
          edges.push({ src: src.id, dst: dst.id, origin: "part-order" });
        }
      }
    }
  }
  return edges;
}

/**
 * `prereqs` (dst → [src], the direction lib/progression.ts reads) with the
 * derived part edges added. Returns `prereqs` ITSELF when there is nothing to
 * add — a course with no split section is walked against the very same map.
 */
export function withPartPrereqs(
  prereqs: ReadonlyMap<string, readonly string[]>,
  catalog: readonly ProgressionLesson[],
  index: SectionIndex
): ReadonlyMap<string, readonly string[]> {
  const derived = partPrereqEdges(catalog, index);
  if (derived.length === 0) return prereqs;
  const out = new Map<string, string[]>();
  for (const [dst, srcs] of prereqs) out.set(dst, [...srcs]);
  for (const e of derived) {
    const list = out.get(e.dst) ?? [];
    if (!list.includes(e.src)) list.push(e.src);
    out.set(e.dst, list);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* FR-4313 — the section is one unit for the place                    */
/* ------------------------------------------------------------------ */

/**
 * May a student's place move past this unit? Only when every part in the
 * catalogue passes the mastery gate. For a lesson that is not a part, this is
 * exactly ADR-0020's lesson gate.
 */
export function mayLeaveSection(
  group: SectionGroup,
  catalog: readonly ProgressionLesson[]
): boolean {
  const parts = partsInCatalogue(group, catalog);
  return parts.length > 0 && parts.every((l) => lessonGatePassed(l.los));
}

/* ------------------------------------------------------------------ */
/* FR-4314 — the roll-up                                              */
/* ------------------------------------------------------------------ */

/** "k of m parts mastered" for one section. */
export interface SectionRollup {
  key: string;
  courseId: string | null;
  /** the printed section number ("1.7") */
  number: string | null;
  /** the printed section title ("Factorisation") */
  title: string | null;
  /** m — the parts present in the catalogue */
  parts: number;
  /** k — the parts passing the mastery gate */
  mastered: number;
  /** true only when every part is mastered (k = m, m > 0) */
  isMastered: boolean;
  /** each part, in part order, scored on its own objectives */
  partsMastered: readonly { slug: string; n: number; mastered: boolean }[];
}

/**
 * The roll-up of one unit. Each part is scored on its own objectives, as any
 * lesson is (FR-4314); the section is mastered only when every part is.
 * "Mastered" is the progression gate (see the header), so `isMastered` and
 * `mayLeaveSection` are the same predicate.
 */
export function sectionRollup(
  group: SectionGroup,
  catalog: readonly ProgressionLesson[],
  index: SectionIndex = NO_SECTIONS
): SectionRollup {
  const parts = partsInCatalogue(group, catalog);
  const partsMastered = parts.map((l, i) => ({
    slug: l.slug,
    n: index.provenanceOf(l.slug)?.part?.n ?? i + 1,
    mastered: lessonGatePassed(l.los),
  }));
  const mastered = partsMastered.filter((p) => p.mastered).length;
  return {
    key: group.key,
    courseId: group.courseId,
    number: group.number,
    title: group.title,
    parts: parts.length,
    mastered,
    isMastered: parts.length > 0 && mastered === parts.length,
    partsMastered,
  };
}

/**
 * The roll-ups of every SPLIT section with a part in `catalog`, in the
 * catalogue order of its first part. A lesson that is not a part gets none —
 * a "1 of 1 parts mastered" line would be a new display for every National
 * lesson, which FR-4318's "unchanged" forbids — so a course with no split
 * section returns an empty list.
 */
export function sectionRollups(
  catalog: readonly ProgressionLesson[],
  index: SectionIndex
): SectionRollup[] {
  if (!index.hasSplits) return [];
  const out: SectionRollup[] = [];
  const done = new Set<string>();
  for (const l of catalog) {
    const g = index.groupOf(l.slug);
    if (!g.split || done.has(g.key)) continue;
    done.add(g.key);
    out.push(sectionRollup(g, catalog, index));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* FR-4313 — a recommendation into a started section names it         */
/* ------------------------------------------------------------------ */

/** What a recommendation into a started section says: "Continue Factorisation". */
export interface SectionRecommendation {
  key: string;
  courseId: string | null;
  /** the printed section number ("1.7") */
  number: string | null;
  /** the section title the recommendation is named by ("Factorisation") */
  title: string | null;
  /** the part being recommended — "part n of m" */
  part: { slug: string; n: number; of: number };
  rollup: SectionRollup;
}

/**
 * The recommendation for lesson `slug`, when it is a part of a split section
 * the student has STARTED: any objective of any of its parts has evidence
 * (mastery > 0 — every BKT update clamps above zero, so 0 means "never
 * attempted", as `untriedObjectives` in lib/progression.ts relies on).
 *
 * Null for a lesson that is not a part, and for a section not yet started —
 * the recommendation is then the lesson's own, exactly as before. The copy
 * ("Continue Factorisation", "part 2 of 3") is the surface's to write; this
 * returns what it is written from.
 */
export function sectionRecommendation(
  slug: string,
  catalog: readonly ProgressionLesson[],
  index: SectionIndex
): SectionRecommendation | null {
  if (!index.hasSplits) return null;
  const g = index.groupOf(slug);
  if (!g.split) return null;
  const parts = partsInCatalogue(g, catalog);
  const at = parts.findIndex((l) => l.slug === slug);
  if (at < 0) return null;
  const started = parts.some((l) => l.los.some((lo) => lo.mastery > 0));
  if (!started) return null;
  const p = index.provenanceOf(slug)?.part;
  return {
    key: g.key,
    courseId: g.courseId,
    number: g.number,
    title: g.title,
    part: { slug, n: p?.n ?? at + 1, of: p?.of ?? parts.length },
    rollup: sectionRollup(g, catalog, index),
  };
}

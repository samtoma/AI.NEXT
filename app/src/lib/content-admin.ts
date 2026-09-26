import {
  BOOK_SECTIONS_SQL,
  buildSectionIndex,
  partOrderProblems,
  provenanceFromRow,
  sectionProblems,
  type BookSectionRow,
  type SectionIndex,
} from "@/lib/book-sections";
import { sequential, withOperator } from "@/lib/db";
import { slugOfLo } from "@/lib/lesson-slug";
import { catalogueObjectivesSql } from "@/lib/module-order";
import { tallyProvenance, type ProvenanceTally } from "@/lib/provenance";

/**
 * The content operator's view of the question bank (FR-1108).
 *
 * The count that matters is not "how many generated questions exist" — it is
 * **how many unchecked ones are live**, because that is the number that says
 * how much ungated mathematics students can actually be served. A bundle
 * sitting in `review` is a decision not yet taken; a row in `live` is one
 * already taken.
 *
 * **P2 closed the temporary hole this carried.** It used to run under
 * `withMaint`, which bypasses every policy, because the console had no
 * principal of its own. It now runs under `withOperator` — `ainext_operator`,
 * whose cross-student visibility comes from migration 017's grants rather than
 * from a bypass. The count of every student's attempts per question is a
 * cross-student read by construction, and it is one `ainext_app` still cannot
 * perform at all.
 */

export type AdminQuestionRow = {
  id: string;
  loId: string;
  loLabel: string;
  moduleLabel: string | null;
  tier: string;
  questionType: string;
  stem: string;
  status: string;
  source: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  parentQuestionId: string | null;
  generatedBy: string | null;
  sourcePage: number | null;
  attempts: number;
  /** The course the question's objective belongs to; `null` if it has none. */
  courseId: string | null;
  /** The lesson its objective belongs to (`lo:<slug>-<n>`, `lib/lesson-slug.ts`). */
  lessonSlug: string;
  /** Its objective's position in THE catalogue order (course, then
   *  `MODULE_ORDER`, via `catalogueObjectivesSql`); lessons list in it. */
  catalogueRank: number;
};

export type ContentAdminView = {
  rows: AdminQuestionRow[];
  /** across LIVE rows only — what students can be served */
  live: ProvenanceTally;
  /** across every row regardless of status — what exists */
  all: ProvenanceTally;
  /** generated rows still waiting on a promote decision */
  pendingPromotion: number;
  /** book rows at `review` — loaded, not servable (includes scripture held by ADR-0006) */
  bookHeld: number;
};

/**
 * The same view narrowed to one course, or the whole bank for `null`.
 *
 * Every count on the page is computed from the rows it is given, so a
 * narrowed view cannot disagree with its own table. The page used to sum the
 * three books into one "From the book" figure without saying so, which read as
 * a maths number (2026-09-23).
 */
export function scopeContentView(
  view: ContentAdminView,
  courseId: string | null
): ContentAdminView {
  const rows = courseId ? view.rows.filter((r) => r.courseId === courseId) : view.rows;
  return summarise(rows);
}

function summarise(rows: AdminQuestionRow[]): ContentAdminView {
  const liveRows = rows.filter((r) => r.status === "live");
  return {
    rows,
    live: tallyProvenance(liveRows),
    all: tallyProvenance(rows),
    pendingPromotion: rows.filter((r) => r.source === "variant" && r.status === "review").length,
    bookHeld: rows.filter((r) => r.source !== "variant" && r.status === "review").length,
  };
}

export async function getContentAdminView(operatorId: number): Promise<ContentAdminView> {
  const [res, orderRes] = await withOperator(operatorId, (db) =>
    sequential([
      () =>
        db.query(
          `SELECT q.id, q.lo_id, q.tier, q.question_type, q.stem, q.status, q.source,
                q.reviewed_by, q.reviewed_at, q.parent_question_id, q.source_page,
                lo.label AS lo_label,
                mod.label AS module_label,
                er.extractor AS generated_by,
                (SELECT count(*) FROM attempts a WHERE a.question_id = q.id) AS attempts,
                (SELECT ns.course_id FROM node_subject ns
                  WHERE ns.node_id = q.lo_id ORDER BY ns.course_id LIMIT 1) AS course_id
           FROM questions q
           JOIN graph_nodes lo ON lo.id = q.lo_id
           LEFT JOIN graph_edges te
                  ON te.dst_id = q.lo_id AND te.edge_type = 'teaches'
           LEFT JOIN graph_nodes mod ON mod.id = te.src_id
           LEFT JOIN extraction_runs er ON er.id = q.extraction_run_id
          WHERE q.status <> 'retired'
          -- Generated items first, unchecked before checked: the rows that need a
          -- human decision sit at the top rather than being found by scrolling.
          ORDER BY (q.source = 'variant') DESC,
                   (q.reviewed_by IS NULL) DESC,
                   q.lo_id, q.tier, q.id`
        ),
      // THE catalogue order (FR-3217), for the per-lesson breakdown (003,
      // FR-4319): course first, then term and module. The bank's own order
      // above is generated-first, which is a review order, not a book's.
      () => db.query(catalogueObjectivesSql("lo.id")),
    ] as const)
  );
  const rank = new Map(orderRes.rows.map((r, i) => [String(r.id), i]));

  const rows: AdminQuestionRow[] = res.rows.map((r) => ({
    id: r.id,
    loId: r.lo_id,
    loLabel: r.lo_label,
    moduleLabel: r.module_label ?? null,
    tier: r.tier,
    questionType: r.question_type,
    stem: r.stem,
    status: r.status,
    source: r.source,
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
    parentQuestionId: r.parent_question_id ?? null,
    generatedBy: r.generated_by ?? null,
    sourcePage: r.source_page ?? null,
    attempts: Number(r.attempts ?? 0),
    courseId: r.course_id ?? null,
    lessonSlug: slugOfLo(String(r.lo_id)),
    catalogueRank: rank.get(String(r.lo_id)) ?? Number.MAX_SAFE_INTEGER,
  }));

  return summarise(rows);
}

/* ================================================================== */
/* Per lesson and per book section (003, FR-4319, decision 18; T411)   */
/* ================================================================== */

/**
 * The book-section store (migration 034, `course_lessons`) for some courses,
 * indexed by `lib/book-sections.ts` — the one reading of it every surface
 * shares, so the console groups parts exactly as the progression does. Corpus
 * data: SELECT is granted to the operator role (034), no student anywhere. A
 * course with no rows (every National course until the loader writes them,
 * T404) indexes to singletons: each lesson its own section, which is exactly
 * what a National lesson is.
 */
export async function bookSections(
  operatorId: number,
  courseIds: readonly string[]
): Promise<{ index: SectionIndex; storeProblems: string[] }> {
  const res = await withOperator(operatorId, (db) => db.query(BOOK_SECTIONS_SQL, [courseIds]));
  const provenance = (res.rows as unknown as BookSectionRow[]).map(provenanceFromRow);
  return {
    index: buildSectionIndex(provenance),
    // the store's across-row rules (a split section's parts are exactly 1…m,
    // a part's section is among those it covers, no slug claimed twice)
    storeProblems: sectionProblems(provenance),
  };
}

/**
 * The book-section checks for one course's lessons, as the console shows them
 * beside its completeness (FR-4309, FR-4312): the store's own consistency,
 * plus whether each split section's parts are consecutive and in part order
 * in the CATALOGUE order the lessons are listed in (before any repair). Empty
 * for every National course: none has a split section.
 */
export function sectionChecks(
  lessonsInCatalogueOrder: readonly { lessonSlug: string }[],
  sections: { index: SectionIndex; storeProblems: string[] }
): string[] {
  return [
    ...sections.storeProblems,
    ...partOrderProblems(
      lessonsInCatalogueOrder.map((l) => ({ slug: l.lessonSlug })),
      sections.index
    ),
  ];
}

/** The six provenance figures for a set of rows, as plain numbers. */
export type LessonContentFigures = {
  questions: number;
  bookLive: number;
  generatedUnchecked: number;
  generatedChecked: number;
  generatedFamily: number;
  waiting: number;
  held: number;
};

function figuresOf(rows: AdminQuestionRow[]): LessonContentFigures {
  const v = summarise(rows);
  return {
    questions: v.rows.length,
    bookLive: v.live.book,
    generatedUnchecked: v.live.generatedUnchecked,
    generatedChecked: v.live.generatedChecked,
    generatedFamily: v.live.generatedFamilyChecked,
    waiting: v.pendingPromotion,
    held: v.bookHeld,
  };
}

/** Per-lesson figures for ONE course's rows, in catalogue order. */
export function contentByLesson(
  rows: AdminQuestionRow[]
): { lessonSlug: string; figures: LessonContentFigures }[] {
  const order: string[] = [];
  const byLesson = new Map<string, AdminQuestionRow[]>();
  for (const r of [...rows].sort((a, b) => a.catalogueRank - b.catalogueRank)) {
    if (!byLesson.has(r.lessonSlug)) {
      order.push(r.lessonSlug);
      byLesson.set(r.lessonSlug, []);
    }
    byLesson.get(r.lessonSlug)!.push(r);
  }
  return order.map((lessonSlug) => ({ lessonSlug, figures: figuresOf(byLesson.get(lessonSlug)!) }));
}

export type SectionFigures<F> = {
  /** the unit's key (`lib/book-sections.ts` `SectionGroup.key`) */
  key: string;
  /** "1.7 Factorisation" for a section or a split section; the slug without a row */
  label: string;
  /** true for the parts of a split section */
  split: boolean;
  parts: { lessonSlug: string; partN: number | null; partOf: number | null; figures: F }[];
  /** computed from its parts' rows, never from anywhere else (FR-4319) */
  figures: F;
};

/**
 * Lessons grouped into their book sections (FR-4319): the parts of a split
 * section become one row whose figures are the sum of its parts' — the unit
 * `lib/book-sections.ts` defines (`groupOf`), in its order (`order`: parts
 * consecutive, in part order, FR-4312). A lesson that is not a part is its
 * own row, labelled with its printed section when the store has it (a merged
 * lesson names every section it covers). Generic over the figures, so the
 * Content page and the Overview share it.
 */
export function rollUpBySection<F>(
  lessons: readonly { lessonSlug: string; figures: F }[],
  index: SectionIndex,
  add: (a: F, b: F) => F
): SectionFigures<F>[] {
  const ordered = index.order(lessons.map((l) => ({ slug: l.lessonSlug, figures: l.figures })));
  const out: SectionFigures<F>[] = [];
  const byKey = new Map<string, SectionFigures<F>>();
  for (const l of ordered) {
    const g = index.groupOf(l.slug);
    const p = index.provenanceOf(l.slug);
    const part = {
      lessonSlug: l.slug,
      partN: p?.part?.n ?? null,
      partOf: p?.part?.of ?? null,
      figures: l.figures,
    };
    const existing = byKey.get(g.key);
    if (existing) {
      existing.parts.push(part);
      existing.figures = add(existing.figures, l.figures);
      continue;
    }
    const label = g.split
      ? `${g.number ?? ""} ${g.title ?? ""}`.trim()
      : p && p.sections.length > 0
        ? `${p.sections.map((s) => s.number).join(" + ")} ${p.sections.map((s) => s.title).join(" + ")}`.trim()
        : l.slug;
    const row: SectionFigures<F> = { key: g.key, label, split: g.split, parts: [part], figures: l.figures };
    byKey.set(g.key, row);
    out.push(row);
  }
  return out;
}

/** Adds two content figure sets, field by field. */
export function addContentFigures(a: LessonContentFigures, b: LessonContentFigures): LessonContentFigures {
  return {
    questions: a.questions + b.questions,
    bookLive: a.bookLive + b.bookLive,
    generatedUnchecked: a.generatedUnchecked + b.generatedUnchecked,
    generatedChecked: a.generatedChecked + b.generatedChecked,
    generatedFamily: a.generatedFamily + b.generatedFamily,
    waiting: a.waiting + b.waiting,
    held: a.held + b.held,
  };
}

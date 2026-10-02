/**
 * A fake `pool` that answers the curriculum reads of the tutor's prompt
 * builders from a small in-memory curriculum — so the REAL
 * `buildLessonContext`, `buildAskContext` and `getLessonData` render prompts
 * in a unit test, with no database (feature 003, WP-E).
 *
 * With no student in scope and no client passed, every read those builders
 * make goes through `pool` (`scoped` in `lib/student-context.ts`), which is
 * what the capture harness does against a real database. This answers the
 * same statements, recognised by their text, and THROWS on any other: a new
 * read in a prompt path shows up here as a failure, not as a silently empty
 * block.
 *
 * Catalogue order is the ORDER OF THE FIXTURE's learning objectives (and of
 * its modules): write them in the course's catalogue order. The real order is
 * proven against Postgres by the capture harness, whose Grade 10 capture
 * `g10-prompts.test.mts` holds equal to its goldens.
 *
 * Used by `g10-prompts.test.mts`, `g10-probing.test.mts` and
 * `national-prompts.test.mts`. The last is also run against the v0.9.2 source
 * to write its golden, so this file must only rely on what both sides share.
 */
import { pool } from "./db.ts";

export interface FixtureDoc {
  sha256: string;
  title: string;
  publisher: string;
  edition: string | null;
  grade: string;
  subject: string;
}

export interface FixtureCurriculum {
  docs: readonly FixtureDoc[];
  /** program, course (with `source_sha256`), module and objective nodes — objectives in catalogue order */
  nodes: readonly {
    id: string;
    kind: string;
    label: string;
    description?: string | null;
    syllabus_ref?: string | null;
    order_in_parent?: number | null;
    source_page?: number | null;
    source_sha256?: string | null;
  }[];
  edges: readonly { src: string; dst: string; type: string }[];
  questions: readonly {
    id: string;
    lo_id: string;
    tier: string;
    question_type: string;
    stem: string;
    choices: unknown;
    correct_answer: string;
    canonical_solution: unknown;
    source_page: number | null;
    source_sha256?: string | null;
  }[];
  visuals: readonly {
    id: string;
    lo_id: string;
    kind: string;
    spec: unknown;
    caption: string | null;
    source_page: number | null;
  }[];
  misconceptions?: readonly { id: string; lo_id: string; label: string; description: string; signal: string | null }[];
  library?: readonly {
    id: string;
    lo_id: string;
    misconception_id: string | null;
    entry_type: string;
    content: unknown;
    source_page: number | null;
  }[];
  /**
   * `course_lessons` rows (migration 034, feature 003): each lesson's book
   * provenance. Left out, the store is empty — what a curriculum with no row
   * of its own reads (every National capture before the loader writes one).
   */
  lessons?: readonly {
    course_id: string;
    lesson_slug: string;
    title: string;
    sections: readonly string[];
    section_titles: readonly string[];
    part_n?: number | null;
    part_of?: number | null;
    chapter_intro?: boolean;
    group_key: string;
  }[];
}

type Row = Record<string, unknown>;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Replace `pool.query` (and forbid `pool.connect`) with answers from `cur`. */
export function installFixturePool(cur: FixtureCurriculum, log?: string[]): void {
  const node = new Map(cur.nodes.map((n) => [n.id, n]));
  const moduleOf = new Map<string, string>();
  const courseOf = new Map<string, string>();
  for (const e of cur.edges) {
    if (e.type === "teaches") moduleOf.set(e.dst, e.src);
    if (e.type === "part_of" && node.get(e.dst)?.kind === "course") courseOf.set(e.src, e.dst);
  }
  const los = cur.nodes.filter((n) => n.kind === "learning_objective");
  const modules = cur.nodes.filter((n) => n.kind === "module");
  const rank = new Map(los.map((l, i) => [l.id, i]));

  const loRow = (l: (typeof los)[number]): Row => {
    const m = moduleOf.get(l.id) ?? null;
    return {
      id: l.id,
      label: l.label,
      description: l.description ?? null,
      syllabus_ref: l.syllabus_ref ?? null,
      source_page: l.source_page ?? null,
      order_in_parent: l.order_in_parent ?? null,
      module_id: m,
      module_label: m ? node.get(m)?.label ?? null : null,
      module_order: m ? node.get(m)?.order_in_parent ?? null : null,
      course_id: m ? courseOf.get(m) ?? null : null,
    };
  };
  const visualRow = (v: FixtureCurriculum["visuals"][number]): Row => {
    const lo = node.get(v.lo_id);
    const m = moduleOf.get(v.lo_id) ?? null;
    return {
      id: v.id,
      lo_id: v.lo_id,
      question_id: null,
      kind: v.kind,
      spec: v.spec,
      caption: v.caption,
      source_page: v.source_page,
      lo_label: lo?.label ?? null,
      syllabus_ref: lo?.syllabus_ref ?? null,
      lo_order: lo?.order_in_parent ?? null,
      module_id: m,
      module_label: m ? node.get(m)?.label ?? null : null,
      module_order: m ? node.get(m)?.order_in_parent ?? null : null,
    };
  };
  const questionRow = (q: FixtureCurriculum["questions"][number]): Row => ({
    id: q.id,
    lo_id: q.lo_id,
    tier: q.tier,
    question_type: q.question_type,
    stem: q.stem,
    choices: q.choices,
    correct_answer: q.correct_answer,
    canonical_solution: q.canonical_solution,
    solution_version: 1,
    status: "live",
    source: "seed",
    parent_question_id: null,
    source_sha256: q.source_sha256 ?? null,
    source_page: q.source_page,
    source_note: null,
    reviewed_by: null,
    reviewed_at: null,
  });
  const byQuestionOrder = (a: Row, b: Row) =>
    cmp(String(a.lo_id), String(b.lo_id)) || cmp(String(a.tier), String(b.tier)) || cmp(String(a.id), String(b.id));

  const answer = (sql: string, values: unknown[] = []): Row[] | null => {
    const ids = (values[0] ?? []) as string[];
    // an objective and its module and course (LO_MODULE_SELECT, catalogueObjectivesSql)
    if (sql.includes("FROM graph_nodes lo") && sql.includes("WHERE lo.kind = 'learning_objective'")) {
      if (sql.includes("lo.id LIKE $1")) {
        const prefix = String(values[0]).replace(/%$/, "");
        const rows = los
          .filter((l) => l.id.startsWith(prefix))
          .map(loRow)
          .sort((a, b) => Number(a.order_in_parent) - Number(b.order_in_parent) || cmp(String(a.id), String(b.id)));
        return /LIMIT 1\b/.test(sql) ? rows.slice(0, 1) : rows;
      }
      return los.map(loRow);
    }
    if (sql.startsWith("SELECT m.id, m.label FROM graph_nodes m WHERE m.kind = 'module'")) {
      return modules.map((m) => ({ id: m.id, label: m.label }));
    }
    if (sql.startsWith("SELECT id, src_id, dst_id FROM graph_edges WHERE edge_type = 'prerequisite_of'")) {
      return cur.edges
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.type === "prerequisite_of")
        .map(({ e, i }) => ({ id: String(i + 1), src_id: e.src, dst_id: e.dst }));
    }
    if (sql === "SELECT id AS course_id, source_sha256 FROM graph_nodes WHERE kind = 'course'") {
      return cur.nodes
        .filter((n) => n.kind === "course")
        .map((n) => ({ course_id: n.id, source_sha256: n.source_sha256 ?? null }));
    }
    // the course of a question's objective (lib/ask.ts, question in scope)
    if (sql.startsWith("SELECT c.id FROM graph_edges t JOIN graph_edges p")) {
      const m = moduleOf.get(String(values[0]));
      const c = m ? courseOf.get(m) : undefined;
      return c ? [{ id: c }] : [];
    }
    // the lesson data block's book title (subjects that name their book)
    if (sql.includes("JOIN source_documents d ON d.sha256 = c.source_sha256")) {
      const c = node.get(String(values[0]));
      const d = cur.docs.find((x) => x.sha256 === c?.source_sha256);
      return d ? [{ title: d.title }] : [];
    }
    if (sql.startsWith("SELECT sha256, title, publisher, edition, grade, subject FROM source_documents")) {
      return cur.docs.map((d) => ({ ...d }));
    }
    // the widget kinds of one unit's live widget questions (lib/lesson.ts, 003)
    if (sql.startsWith("SELECT q.choices->>'kind' AS kind, count(*) AS n FROM questions q")) {
      const moduleId = String(values[0]);
      const counts = new Map<string, number>();
      for (const q of cur.questions) {
        if (q.question_type !== "widget" || moduleOf.get(q.lo_id) !== moduleId) continue;
        const kind = String((q.choices as { kind?: unknown } | null)?.kind ?? "");
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
      return [...counts.entries()]
        .sort(([ka, na], [kb, nb]) => nb - na || cmp(ka, kb))
        .map(([kind, n]) => ({ kind, n: String(n) }));
    }
    // the distinct curve_sketcher `fn` families live in one unit (lib/lesson.ts,
    // T417) — whether a G10 lesson is told about "curve_sketcher_g10"
    if (sql.startsWith("SELECT DISTINCT q.choices->'spec'->>'fn' AS fn FROM questions q")) {
      const moduleId = String(values[0]);
      const fns = new Set<string>();
      for (const q of cur.questions) {
        if (q.question_type !== "widget" || moduleOf.get(q.lo_id) !== moduleId) continue;
        const choices = q.choices as { kind?: unknown; spec?: { fn?: unknown } } | null;
        if (choices?.kind !== "curve_sketcher") continue;
        const fn = choices.spec?.fn;
        if (typeof fn === "string") fns.add(fn);
      }
      return [...fns].sort().map((fn) => ({ fn }));
    }
    if (sql.includes("FROM questions WHERE status = 'live' AND lo_id = ANY($1)")) {
      return cur.questions.filter((q) => ids.includes(q.lo_id)).map(questionRow).sort(byQuestionOrder);
    }
    if (sql.includes("FROM questions WHERE status = 'live' ORDER BY lo_id, tier, id")) {
      return cur.questions.map(questionRow).sort(byQuestionOrder);
    }
    // figures (lib/visuals.ts BASE_SELECT)
    if (sql.includes("FROM visuals v JOIN graph_nodes lo ON lo.id = v.lo_id")) {
      if (sql.includes("WHERE v.lo_id = ANY($1)")) {
        return cur.visuals
          .filter((v) => ids.includes(v.lo_id))
          .map(visualRow)
          .sort((a, b) => Number(a.lo_order) - Number(b.lo_order) || cmp(String(a.id), String(b.id)));
      }
      return cur.visuals
        .map(visualRow)
        .sort(
          (a, b) =>
            (rank.get(String(a.lo_id)) ?? 1e9) - (rank.get(String(b.lo_id)) ?? 1e9) || cmp(String(a.id), String(b.id))
        );
    }
    // no `rationale` column: no cross-subject bridges
    if (sql.includes("FROM information_schema.columns")) return [];
    if (sql.includes("FROM misconceptions WHERE lo_id = ANY($1)")) {
      return (cur.misconceptions ?? [])
        .filter((m) => ids.includes(m.lo_id))
        .map((m) => ({ ...m }))
        .sort((a, b) => cmp(a.id, b.id));
    }
    // the book-section store (lib/book-sections.ts BOOK_SECTIONS_SQL and
    // LESSON_PROVENANCE_SQL), ordered as the SQL orders it
    if (sql.includes("FROM course_lessons")) {
      const row = (l: NonNullable<FixtureCurriculum["lessons"]>[number]): Row => ({
        course_id: l.course_id,
        lesson_slug: l.lesson_slug,
        title: l.title,
        sections: [...l.sections],
        section_titles: [...l.section_titles],
        part_n: l.part_n ?? null,
        part_of: l.part_of ?? null,
        chapter_intro: l.chapter_intro ?? false,
        group_key: l.group_key,
      });
      const all = cur.lessons ?? [];
      if (sql.includes("WHERE course_id = ANY($1::text[])")) {
        return all
          .filter((l) => ids.includes(l.course_id))
          .map(row)
          .sort((a, b) => cmp(String(a.course_id), String(b.course_id)) || cmp(String(a.lesson_slug), String(b.lesson_slug)));
      }
      if (sql.includes("WHERE course_id = $1 AND lesson_slug = $2")) {
        return all.filter((l) => l.course_id === values[0] && l.lesson_slug === values[1]).map(row);
      }
      return null;
    }
    if (sql.includes("FROM explanation_library WHERE lo_id = ANY($1)")) {
      return (cur.library ?? [])
        .filter((e) => ids.includes(e.lo_id))
        .map((e) => ({ ...e, reviewed: false }))
        .sort((a, b) => cmp(a.lo_id, b.lo_id) || cmp(a.entry_type, b.entry_type) || cmp(a.id, b.id));
    }
    return null;
  };

  (pool as unknown as { connect: () => Promise<never> }).connect = async () => {
    throw new Error("prompt-fixture-pool: no database connection in a unit test");
  };
  (pool as unknown as { query: (t: string, v?: unknown[]) => Promise<unknown> }).query = async (
    text: string,
    values?: unknown[]
  ) => {
    const sql = squash(text);
    log?.push(sql);
    const rows = answer(sql, values);
    if (rows === null) throw new Error(`prompt-fixture-pool: unexpected query:\n${sql.slice(0, 300)}`);
    return { rows, rowCount: rows.length };
  };
}

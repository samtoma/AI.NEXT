import type { PoolClient } from "pg";
import { retrieve, retrievalBlock } from "./retrieval";
import { getStudentProfile, scoped, type Db } from "./student-context";
import { addressForms, type AddressForms } from "./address";
import { sequential } from "./db";
import { visibleGraphFor } from "./catalog-queries";
import { getAllVisuals } from "./visuals";
import { COURSE_RANK, MODULE_RANK, catalogueObjectivesSql } from "./module-order";
import { figureDirectivesDoc, visualsCatalogLines } from "./viz-prompt";
import { requireSubjectOfCourse } from "./subjects";
import { masteryLabel } from "./mastery";
import { COURSE_IDS, COURSES, coursesOf, isCourseId, type AskExampleIds, type CourseId } from "./courses";
import type { Subject } from "./types";
import { slugOfLo } from "./lesson-slug";
import {
  BOOK_SECTIONS_SQL,
  NO_SECTIONS,
  partPrereqEdges,
  partsInCatalogue,
  sectionIndexFromRows,
  type BookSectionRow,
  type DerivedPrereqEdge,
  type SectionIndex,
} from "./book-sections";
import { sectionFocusObjectives, sectionLabel, sectionNumbers } from "./section-label";

/**
 * "Ask the Spine" — server-side grounding assembly.
 *
 * Every chat turn is grounded in the curriculum graph: the full LO list with
 * mastery, the prerequisite edge list, the question catalog, and (when a
 * question is in scope) its human-reviewed canonical solution. The model is
 * never allowed to solve from scratch — it explains *via* the canonical steps.
 *
 * The mastery half is the student's, so the assembly runs under their principal
 * — inside `/api/ask`'s pre-turn unit of work when it has one, in its own
 * otherwise. `studentId` may be null (the prompt-capture harness), which reads
 * the curriculum and no mastery rather than borrowing somebody's.
 *
 * NOTHING in this file's prompt text changed.
 *
 * v0.9.2 (FR-3217) changed the ORDER of three of its lists — objectives, units
 * and prerequisite edges — to the one catalogue order, split by subject, and
 * fixed the order of the edges, which had none. The wording of the prompt is
 * unchanged.
 *
 * Feature 003 (ADR-0020 note, 2026-09-25; FR-4205, FR-4206): three facts that
 * were Prep-3 strings here now come from the course registry
 * (`lib/courses.ts` `CourseTutorFacts`) — the syllabus line after each book,
 * the book named when none is visible, and the example ids of the citation
 * and directive documentation. Every National course carries exactly the
 * values this file printed before, so its prompts are byte-identical; the
 * Grade 10 course has no syllabus year and takes its examples from the
 * student's own data, never Prep-3's ids.
 */

export type AskSurface = "spine_chat" | "student_chat";

export interface Grounding {
  lo_ids: string[];
  question_ids: string[];
  pages: number[];
  chat_session: string;
  question_id?: string;
  wrong_answer?: string;
  /** lesson slug for the lesson surfaces (e.g. "geo1-2") */
  lesson?: string;
}

export interface AskContext {
  systemPrompt: string;
  dataBlock: string;
  grounding: Grounding;
  /**
   * Whether `systemPrompt` carries the Socratic-probing block (ADR-0021) —
   * the learning session's stored snapshot after the maths-only use-time rule.
   * Set by `buildLessonContext` only; absent everywhere else, which is off.
   * `/api/ask` tells the client this value, so the cards follow exactly the
   * prompt the model was given. Never stored in `grounding`: the ledger row
   * is written the same with probing off as it always was.
   */
  probing?: boolean;
}

/**
 * Mastery reaches the model as a NAMED BAND, never as a percentage.
 *
 * `pctStr` used to live here and rendered P(L) straight into the prompt as
 * "mastery today 92%". A number in the context is a number the model will
 * say out loud, and it did — "92%, that's excellent" mid-lesson, with no
 * referent the student could use (#27). Two independent reasons it should
 * never have been a number:
 *
 *   - P(L) is a BELIEF, not a score. 30 -> 69 -> 30 across two answers is
 *     correct Bayesian behaviour and reads as a broken gauge (#17).
 *   - the interface deliberately stopped showing the number (#42, FR-1003).
 *     A tutor that keeps saying it undoes that decision in conversation.
 *
 * The band is what the ordering already encodes, so nothing the model can
 * act on is lost.
 */
const bandStr = (v: number) => masteryLabel(v);

/**
 * How many LOs get the FULL treatment (description + question stems +
 * figure catalog). Everything else stays in the block as a compact index —
 * graph-as-index, not graph-as-payload. Keeps a spine turn ≤ ~8k input
 * tokens instead of shipping all 240 stems + 123 visuals (39.9k).
 */
const FOCUS_LO_COUNT = 8;

export async function buildAskContext(
  surface: AskSurface,
  chatSession: string,
  questionId?: string,
  wrongAnswer?: string,
  /** the request's signed-in student (lib/student-context.ts) */
  studentId: number | null = null,
  /** a just-uploaded worksheet/photo to ground this turn on (PRD B10) */
  uploadId?: number,
  /** the caller's unit of work, when it has one open (`/api/ask`) */
  client?: PoolClient
): Promise<AskContext> {
  return scoped(studentId, client, (db) =>
    askContextOn(db, surface, chatSession, questionId, wrongAnswer, studentId, uploadId)
  );
}

async function askContextOn(
  db: Db,
  surface: AskSurface,
  chatSession: string,
  questionId: string | undefined,
  wrongAnswer: string | undefined,
  studentId: number | null,
  uploadId: number | undefined
): Promise<AskContext> {
  // `sequential`, not `Promise.all`: every query here runs on the SAME client
  // when the caller passes its unit of work, and pg@9 removed the implicit
  // queue that made the parallel-looking version work (lib/db.ts).
  //
  // The sixth entry used to be this file's own `SELECT display_name` — a
  // second, narrower read of the same row `retrieve()` reads below, and the
  // reason two files each had their own idea of who the student was. It is the
  // profile now: one read, and the one place the voice is decided (plan A9).
  const [
    allLosRes,
    allEdgesRes,
    masteryRes,
    allQRes,
    docRes,
    profile,
    allModulesRes,
    everyVisual,
    courseBookRes,
  ] = await sequential([
      // THE ONE ORDER (FR-3217; Samuel, 2026-09-25, lifting ADR-0020's hold
      // for this ordering: "yes for sure … it is part of the overall
      // consistency"). The context lists every course, so the course comes
      // first (registry order), then the catalogue order inside it — the
      // lesson list's. It was `ORDER BY order_in_parent`: a position inside a
      // module, shared by the first objective of every unit of every subject,
      // so Postgres chose the order of every tie — and with it, for a student
      // whose mastery ties, which objectives are the focus below.
      () =>
        db.query(
          catalogueObjectivesSql("lo.id, lo.label, lo.description, lo.syllabus_ref, lo.source_page")
        ),
      // No ORDER BY here on purpose: the edges are put in catalogue order
      // below, once the gate has narrowed the objectives they are ranked by.
      () => db.query(`
        SELECT id, src_id, dst_id FROM graph_edges
        WHERE edge_type = 'prerequisite_of' AND system_to IS NULL
      `),
      () =>
        studentId == null
          ? Promise.resolve({
              rows: [] as { lo_id: string; score: string; system_to: Date | null }[],
            })
          : db.query(
              `SELECT lo_id, score, system_from, system_to FROM mastery
             WHERE student_id = $1 ORDER BY lo_id, system_from`,
              [studentId]
            ),
      () => db.query(`
        SELECT id, lo_id, tier, question_type, stem, choices, correct_answer,
               canonical_solution, solution_version, source_page, source_sha256
        FROM questions WHERE status = 'live' ORDER BY lo_id, tier, id
      `),
      () => db.query(
        `SELECT sha256, title, publisher, edition, grade, subject
         FROM source_documents ORDER BY ingested_at, sha256`
      ),
      () => (studentId == null ? Promise.resolve(null) : getStudentProfile(studentId, db)),
      // The unit list: course first, then MODULE_RANK — Term 1, Term 2,
      // geometry. It had no term rank, so Term 1 and Term 2 units interleaved.
      () => db.query(`
        SELECT m.id, m.label FROM graph_nodes m WHERE m.kind = 'module'
        ORDER BY ${COURSE_RANK}, ${MODULE_RANK}
      `),
      () => getAllVisuals(),
      // The book each course is built from (the loader stamps it on the course
      // node) — which course's registry facts speak for each book (003). The
      // same statement the student scope reads the books with.
      () => db.query(`SELECT id AS course_id, source_sha256 FROM graph_nodes WHERE kind = 'course'`),
    ] as const);

  /* ------------------------------------------------------------------ *
   * THE COURSE GATE (migration 023, lib/catalog.ts)
   *
   * The eight reads above are deliberately WHOLE-SPINE — every LO, every live
   * question, every module, every figure — because "Ask the Spine" reasons
   * over the graph rather than over one lesson. That is also why this is the
   * quietest way a hidden course could reach a student: no URL to guess and no
   * lesson to open, just a subject that is switched off appearing in the data
   * block of an ordinary chat turn, complete with the canonical solution of
   * any question id the client names.
   *
   * So the eight results are narrowed HERE, once, before anything downstream
   * reads them. Every line of prompt assembly below is unchanged and gated by
   * construction — the alternative, a filter at each of the six places the
   * rows are consumed, is six chances to add a seventh.
   *
   * `studentId === null` is the prompt-capture harness and is not gated, for
   * the reason `courseGateFor` in lib/lesson.ts gives: there is nobody to hide
   * a course from, and an empty harness would blind the constitution IX diff.
   * ------------------------------------------------------------------ */
  const gate = await visibleGraphFor(db, studentId);
  const losRes = { rows: allLosRes.rows.filter((l) => gate.lo(l.id)) };
  const qRes = { rows: allQRes.rows.filter((q) => gate.lo(q.lo_id)) };

  // Each visible objective's place in the catalogue: its row index in the
  // ordered read above. The one rank this context breaks ties by — for the
  // focus objectives and for the edges.
  const catalogRank = new Map(losRes.rows.map((l, i) => [l.id as string, i]));
  const byCatalogue = (a: string, b: string) =>
    (catalogRank.get(a) ?? Number.MAX_SAFE_INTEGER) -
    (catalogRank.get(b) ?? Number.MAX_SAFE_INTEGER);

  // An edge is kept only when BOTH endpoints survive: a prerequisite arrow
  // pointing into a hidden course names that course's objective in the prompt.
  //
  // THE EDGES IN A FIXED ORDER (FR-3217). They used to come back in whatever
  // order the query plan produced, so the same data could render a different
  // PREREQUISITE EDGES block — it did, between two captures of one database.
  // Now: the source objective in catalogue order, then the destination in
  // catalogue order, then the edge id — so the arrows read in the order the
  // book teaches, each objective's outgoing arrows together, and two rows
  // naming the same pair are still told apart. Same data, same prompt.
  const edgesRes = {
    rows: allEdgesRes.rows
      .filter((e) => gate.lo(e.src_id) && gate.lo(e.dst_id))
      .sort(
        (a, b) =>
          byCatalogue(a.src_id, b.src_id) ||
          byCatalogue(a.dst_id, b.dst_id) ||
          Number(a.id) - Number(b.id)
      ),
  };
  const modulesRes = { rows: allModulesRes.rows.filter((m) => gate.module(m.id)) };
  const allVisuals = everyVisual.filter((v) => gate.lo(v.loId));

  // The books, through the same gate (003; privacy review §5 item 1, MUST).
  // This read used to be the one of the eight that was NOT narrowed, so every
  // ingested book's title, publisher and grade reached every student's tutor
  // turn — a hidden course's, and from the moment a second curriculum's book
  // is loaded, that curriculum's, before any operator switched it on. A book is
  // kept only when a course this student may see is built from it
  // (`gate.doc`). The harness scope keeps every book, so the captures read as
  // before; so does any student who may see every loaded course.
  const docs = (docRes.rows as {
    sha256: string;
    title: string;
    publisher: string;
    edition: string | null;
    grade: string;
    subject: string;
  }[]).filter((d) => gate.doc(d.sha256));
  const student = profile?.displayName ?? "the demo student";
  // Address and voice only (FR-2603): nothing below branches teaching on it.
  const a = addressForms(profile?.gender ?? null, student);

  // baseline = earliest row per LO, current = open row
  const baseline = new Map<string, number>();
  const current = new Map<string, number>();
  for (const r of masteryRes.rows) {
    if (!baseline.has(r.lo_id)) baseline.set(r.lo_id, Number(r.score));
    if (r.system_to === null) current.set(r.lo_id, Number(r.score));
  }

  // ---- per-session grounding slice (graph-as-index) ----
  // Focus = the question in scope's LO + the weakest LOs today. Snapshotted
  // per chat session by the route, so the block is byte-stable across turns
  // (prompt-cache prefix survives) and mastery never "live-updates" mid-chat.
  const focusLos = new Set<string>();
  const focusQRow = questionId
    ? qRes.rows.find((q) => q.id === questionId)
    : undefined;
  if (focusQRow) focusLos.add(focusQRow.lo_id);

  // Subject plumbing (ADR-0004 Wave 0): when a question is in scope, its
  // LO → module → course chain keys the language/grounding sections of the
  // system prompt.
  //
  // `null` here means NO QUESTION IS IN SCOPE (the spine-explorer surface has
  // no lesson) — it is not a subject fallback. A question WHOSE course is not
  // in the registry throws instead, because grounding a real question in the
  // wrong subject's rules is exactly the failure this refactor removes.
  let subject: Subject | null = null;
  let focusCourse: string | null = null;
  if (focusQRow) {
    const courseRes = await db.query(
      `SELECT c.id FROM graph_edges t
       JOIN graph_edges p
         ON p.src_id = t.src_id AND p.edge_type = 'part_of' AND p.system_to IS NULL
       JOIN graph_nodes c ON c.id = p.dst_id AND c.kind = 'course'
       WHERE t.edge_type = 'teaches' AND t.system_to IS NULL AND t.dst_id = $1
       LIMIT 1`,
      [focusQRow.lo_id]
    );
    subject = requireSubjectOfCourse(
      courseRes.rows[0]?.id,
      `question "${focusQRow.id}"`
    );
    focusCourse = (courseRes.rows[0]?.id as string | undefined) ?? null;
  }

  // WHOSE BOOK SPEAKS (003). A question in scope: its own course. None (the
  // observer surface): the first course of THIS context — loaded, and one she
  // may see — in registry order: Prep-3 maths for a National student, the
  // Grade 10 course for a Grade 10 student. Every National course carries the
  // same Ask facts, so a National context reads exactly as before whichever of
  // its courses comes first. A context with no course at all — a student whose
  // course is not switched on yet — speaks with her own curriculum's first
  // course, so a Grade 10 student is never told about the ministry textbook;
  // with no curriculum either (the harness), the registry's first.
  const courseBooks = courseBookRes.rows as { course_id: string; source_sha256: string | null }[];
  const askCourse: CourseId =
    (isCourseId(focusCourse) ? focusCourse : null) ??
    COURSE_IDS.find((id) => gate.course(id) && courseBooks.some((r) => r.course_id === id)) ??
    (gate.curriculum ? coursesOf(gate.curriculum)[0] : undefined) ??
    DEFAULT_ASK_COURSE;
  const facts = COURSES[askCourse].tutor;
  // Each book's course, by the sha the loader stamped on the course node.
  const courseOfBook = new Map<string, CourseId>();
  for (const id of COURSE_IDS) {
    for (const r of courseBooks) {
      if (r.course_id === id && r.source_sha256 && !courseOfBook.has(r.source_sha256)) {
        courseOfBook.set(r.source_sha256, id);
      }
    }
  }
  // A book's syllabus line is its course's; a book no course is built from
  // speaks with the context's course.
  const syllabusOf = (sha: string | undefined): string | null => {
    const c = sha ? courseOfBook.get(sha) : undefined;
    return c ? COURSES[c].tutor.syllabusLine : facts.syllabusLine;
  };
  const withSyllabus = (line: string | null) => (line ? ` ${line}` : "");

  // Per-course source doc (Wave 1): a question in scope pins the document it
  // was actually extracted from (its bundle sha) instead of whichever book
  // `LIMIT 1` happened to return. No question in scope (spine explorer):
  // a single-doc install reads exactly as before; a multi-doc install lists
  // every loaded book.
  const focusDoc = focusQRow
    ? docs.find((d) => d.sha256 === focusQRow.source_sha256)
    : undefined;
  const doc: { sha256?: string; title: string; publisher: string; edition: string | null; grade: string; subject: string } =
    focusDoc ??
    docs[0] ?? {
      title: facts.askBookFallback,
      publisher: "",
      edition: null,
      grade: "",
      subject: "",
    };
  // The syllabus line comes from the book's course (003): "Syllabus
  // 2025–2026." for a National book, as always; nothing for a book that prints
  // no syllabus year (Grade 10). Several books that agree share one line at
  // the end, exactly as before; books that disagree — only a tester who sees
  // two curricula — each carry their own.
  const bookSyllabus = docs.map((d) => syllabusOf(d.sha256));
  const oneSyllabus = bookSyllabus.every((l) => l === bookSyllabus[0]);
  const sourceLine =
    focusDoc || docs.length <= 1
      ? `Source book: "${doc.title}" — ${doc.publisher} (edition ${doc.edition}, ${doc.subject}, grade ${doc.grade}).${withSyllabus(syllabusOf(doc.sha256))}`
      : oneSyllabus
        ? `Source books (all ingested): ${docs
            .map((d) => `"${d.title}" — ${d.publisher} (${d.subject}, grade ${d.grade})`)
            .join("; ")}.${withSyllabus(bookSyllabus[0] ?? null)}`
        : `Source books (all ingested): ${docs
            .map((d, i) => {
              const line = bookSyllabus[i];
              return `"${d.title}" — ${d.publisher} (${d.subject}, grade ${d.grade}${line ? `; ${line.replace(/\.$/, "")}` : ""})`;
            })
            .join("; ")}.`;
  // BOOK SECTIONS (feature 003, decision 18; FR-4316, FR-4317). The book
  // sections of the courses in this context (`course_lessons`, migration 034),
  // read after the gate — the store holds lesson titles. With a split section
  // among them, two things change, and ONLY then:
  //
  //   · a question in scope that sits in one part pulls its whole section into
  //     the focus set, ahead of the weakest objectives: its own part, then the
  //     other parts nearest first. While a student works in part 2 of 1.7,
  //     parts 1 and 3 are the nearest related material (FR-4316);
  //   · the part n-1 → part n prerequisites are listed, in a block of their
  //     own that says the product added them (FR-4317), beside the book's.
  //
  // With none — every National course — `sections.hasSplits` is false, the
  // focus set is chosen exactly as before and no block is added, so every
  // National prompt is byte-identical (FR-4206; the capture harness).
  const sectionCourses = courseBooks.map((r) => r.course_id).filter((id) => gate.course(id));
  const sections: SectionIndex =
    sectionCourses.length === 0
      ? NO_SECTIONS
      : sectionIndexFromRows(
          (await db.query(BOOK_SECTIONS_SQL, [sectionCourses])).rows as BookSectionRow[]
        );
  const askLessons = sections.hasSplits
    ? lessonsOfObjectives(losRes.rows.map((l) => l.id as string))
    : [];
  if (sections.hasSplits && focusQRow) {
    for (const id of sectionFocusObjectives(focusQRow.lo_id, askLessons, sections)) {
      if (focusLos.size >= FOCUS_LO_COUNT) break;
      focusLos.add(id);
    }
  }
  const partBlock = sections.hasSplits
    ? partPrereqBlock(partPrereqEdges(askLessons, sections), askLessons, sections, byCatalogue)
    : "";

  // Weakest first is the primary key; catalogue order (subject, then the
  // lesson list's order) breaks every tie, written out rather than left to
  // sort stability — for a new student every score is 0, so it decides the
  // whole focus set: a maths student's is Unit 1's first eight objectives.
  const byWeakness = [...losRes.rows].sort(
    (a, b) =>
      (current.get(a.id) ?? 0) - (current.get(b.id) ?? 0) || byCatalogue(a.id, b.id)
  );
  for (const l of byWeakness) {
    if (focusLos.size >= FOCUS_LO_COUNT) break;
    focusLos.add(l.id);
  }

  // A merged lesson's objectives cite the lesson's printed RANGE ("1.2–1.3"),
  // the words the student's check-in and lesson header print (backlog #35);
  // every other objective keeps its own `syllabus_ref`. No National lesson
  // covers two sections, so every National line is unchanged.
  const refOf = (l: { id: string; syllabus_ref: string | null }): string | null => {
    const p = sections.provenanceOf(slugOfLo(l.id));
    return p && p.sections.length > 1 ? sectionNumbers(p.sections.map((x) => x.number)) : l.syllabus_ref;
  };
  const loLines = losRes.rows
    .map((l) => {
      const head = `- ${l.id} | "${l.label}" | ref ${refOf(l) ?? "—"} | book p.${l.source_page ?? "—"} | now ${bandStr(current.get(l.id) ?? 0)} | at baseline ${bandStr(baseline.get(l.id) ?? 0)}`;
      return focusLos.has(l.id) && l.description
        ? `${head}\n  ${l.description}`
        : head;
    })
    .join("\n");

  const edgeLines = edgesRes.rows
    .map((e) => `${e.src_id} -> ${e.dst_id}`)
    .join("\n");

  // Detailed bank (stems) only for focus LOs; compact per-LO index for the
  // rest — enough to reason about coverage without shipping 240 stems.
  const qLines = qRes.rows
    .filter((q) => focusLos.has(q.lo_id))
    .map(
      (q) =>
        `- ${q.id} | ${q.lo_id} | ${q.tier} | ${q.question_type} | p.${q.source_page ?? "—"} | "${String(q.stem).slice(0, 150)}"`
    )
    .join("\n");

  const qIndexByLo = new Map<string, { n: number; tiers: Map<string, number> }>();
  for (const q of qRes.rows) {
    if (focusLos.has(q.lo_id)) continue;
    let e = qIndexByLo.get(q.lo_id);
    if (!e) {
      e = { n: 0, tiers: new Map() };
      qIndexByLo.set(q.lo_id, e);
    }
    e.n++;
    e.tiers.set(q.tier, (e.tiers.get(q.tier) ?? 0) + 1);
  }
  const qIndexLines = [...qIndexByLo.entries()]
    .map(
      ([lo, e]) =>
        `- ${lo} | ${e.n} reviewed questions (${[...e.tiers.entries()].map(([t, n]) => `${n} ${t}`).join(", ")})`
    )
    .join("\n");

  const pages = [
    ...new Set(
      [
        ...losRes.rows.map((l) => l.source_page),
        ...qRes.rows.map((q) => q.source_page),
      ].filter((p): p is number => p != null)
    ),
  ].sort((a, b) => a - b);

  let focusBlock = "";
  const focusQ = questionId
    ? qRes.rows.find((q) => q.id === questionId)
    : undefined;
  if (focusQ) {
    const steps = (
      (focusQ.canonical_solution ?? []) as {
        step: number;
        text_md?: string;
        claim_ar?: string;
        evidence_page?: number;
      }[]
    )
      .map((s) =>
        s.text_md != null
          ? `  Step ${s.step}. ${s.text_md}`
          : `  Step ${s.step}. ${s.claim_ar ?? ""}${s.evidence_page != null ? ` [evidence: p.${s.evidence_page}]` : ""}`
      )
      .join("\n");
    const choices = focusQ.choices
      ? (focusQ.choices as { key: string; text: string }[])
          .map((c) => `    (${c.key}) ${c.text}`)
          .join("\n")
      : "    (numeric answer)";
    const solutionHeading = askPromptKit(subject).solutionHeading(
      focusQ.solution_version
    );
    focusBlock = `
QUESTION IN SCOPE (the one being discussed right now):
${focusQ.id} | ${focusQ.lo_id} | ${focusQ.tier} | book p.${focusQ.source_page ?? "—"}
Stem: ${focusQ.stem}
Choices:
${choices}
Correct answer: ${focusQ.correct_answer}
${wrongAnswer ? `${student}'s wrong answer: "${wrongAnswer}"` : ""}
${solutionHeading}
${steps}
`;
  }

  const moduleLines = modulesRes.rows
    .map((m) => `${m.id} "${m.label}"`)
    .join("; ");

  const vizLines = visualsCatalogLines(
    allVisuals.filter((v) => focusLos.has(v.loId))
  );
  const vizIndexByLo = new Map<string, string[]>();
  for (const v of allVisuals) {
    if (focusLos.has(v.loId)) continue;
    const arr = vizIndexByLo.get(v.loId) ?? [];
    arr.push(`${v.id} (${v.kind})`);
    vizIndexByLo.set(v.loId, arr);
  }
  const vizIndexLines = [...vizIndexByLo.entries()]
    .map(([lo, ids]) => `- ${lo} | ${ids.join(", ")}`)
    .join("\n");

  const dataBlock = `CURRICULUM DATA — your only source of truth
${sourceLine}
Ingested units: ${moduleLines}.
Student: ${student} (id 1). Mastery is 0–100%; "baseline" is ${a.their} placement diagnostic, "today" is a snapshot taken when this chat began.

LEARNING OBJECTIVES (id | label | syllabus ref | book page | mastery; descriptions included for the current focus objectives):
${loLines}

PREREQUISITE EDGES ("A -> B" means A is a prerequisite of B):
${edgeLines}${partBlock}

DETAILED QUESTION BANK — focus objectives only (id | LO | tier | type | book page | stem). Push question cards ONLY from this list:
${qLines || "(none in focus)"}

QUESTION INDEX for all other objectives (coverage only — you may cite these LOs, but never invent or push question ids from here):
${qIndexLines || "(none)"}

FIGURE LIBRARY — focus objectives (stored animated figures — push by id with {{widget:viz_ref:<id>}}; id | kind | LO | book page | caption):
${vizLines || "(none in focus)"}

FIGURE INDEX for other objectives (ids you may push by id, uncaptioned here):
${vizIndexLines || "(none)"}
${focusBlock}`;

  const grounding: Grounding = {
    lo_ids: losRes.rows.map((l) => l.id),
    question_ids: qRes.rows.map((q) => q.id),
    pages,
    chat_session: chatSession,
    ...(questionId ? { question_id: questionId } : {}),
    ...(wrongAnswer ? { wrong_answer: wrongAnswer } : {}),
  };

  // Retrieval layer (FR-303) — the student-model half of grounding. Renders to
  // "" when nothing is retrieved, so prompts stay byte-identical for a student
  // with no profile and no library entries.
  const retrieved = await retrieve(studentId, grounding.lo_ids, {
    uploadId,
    client: db,
  });

  // The examples the citation and directive documentation shows: the course's
  // registry values (every National course: the ids this prompt has always
  // printed), or, for a course with none (Grade 10), ids from this student's
  // own context — never another book's (decision 10).
  const examples =
    facts.askExamples ??
    askExamplesFromContext(
      losRes.rows as { id: string; source_page: number | null }[],
      qRes.rows as { id: string; lo_id: string; source_page: number | null }[],
      allVisuals,
      focusQRow?.lo_id ?? [...focusLos][0],
      focusQRow?.id
    );

  return {
    systemPrompt: askSystemPrompt(surface, student, subject, a, examples),
    // An English-only course's tutor (decision 9) gets no Arabic address line.
    dataBlock: dataBlock + retrievalBlock(retrieved, { arabicAddress: facts.arabicTouches }),
    grounding,
  };
}

/* ------------------------------------------------------------------ */
/* Book sections in the Ask context (feature 003, FR-4316, FR-4317)    */
/* ------------------------------------------------------------------ */

/** Objectives in catalogue order → the lessons they make up, in that order. */
function lessonsOfObjectives(
  loIds: readonly string[]
): { slug: string; courseId: null; los: { id: string; mastery: number }[] }[] {
  const bySlug = new Map<string, { slug: string; courseId: null; los: { id: string; mastery: number }[] }>();
  for (const id of loIds) {
    const slug = slugOfLo(id);
    const l = bySlug.get(slug) ?? { slug, courseId: null, los: [] };
    bySlug.set(slug, l);
    l.los.push({ id, mastery: 0 });
  }
  return [...bySlug.values()];
}


/**
 * The derived part prerequisites as a block of the data block (FR-4317):
 * headed as ADDED BY THE PRODUCT, one line naming each split section and its
 * parts, then its edges in catalogue order (source, then destination) — the
 * order the book's own edge list uses. Starts with the blank line that
 * separates blocks; "" when there are no such edges, so a context with no
 * split section renders exactly as before.
 */
function partPrereqBlock(
  edges: readonly DerivedPrereqEdge[],
  catalog: readonly { slug: string; courseId: string | null; los: readonly { id: string; mastery: number }[] }[],
  index: SectionIndex,
  byCatalogue: (a: string, b: string) => number
): string {
  if (edges.length === 0) return "";
  const lines: string[] = [];
  for (const g of index.splitGroups) {
    const own = edges
      .filter((e) => index.groupOf(slugOfLo(e.dst)).key === g.key)
      .sort((a, b) => byCatalogue(a.src, b.src) || byCatalogue(a.dst, b.dst));
    if (own.length === 0) continue;
    const parts = partsInCatalogue(g, catalog).map((l, i) => {
      const n = index.provenanceOf(l.slug)?.part?.n ?? i + 1;
      return `part ${n} ${l.slug}`;
    });
    lines.push(`${sectionLabel(g) || g.key} — ${parts.join(", ")}`);
    for (const e of own) lines.push(`${e.src} -> ${e.dst}`);
  }
  if (lines.length === 0) return "";
  return `

PREREQUISITES ADDED BY THE PRODUCT, not stated by the book. Each book section below is taught as consecutive lessons, one per part, and every objective of part n-1 is a prerequisite of every objective of part n ("A -> B" as above):
${lines.join("\n")}`;
}

/** The Ask prompt's examples; a page may be the placeholder "N". */
type AskExamples = Omit<AskExampleIds, "page"> & { page: number | string };

/** Placeholder for an example id the context has none of. */
const PLACEHOLDER_ID = "<id>";

/**
 * Example ids from the student's own context, for a course whose registry
 * entry names none (003): the objective in focus (the question's, else the
 * first focus objective), a live question of it, its page, the objective
 * after it for the highlight, and a figure of it. Each falls back to a
 * placeholder, never to an id from another book.
 */
function askExamplesFromContext(
  los: readonly { id: string; source_page: number | null }[],
  questions: readonly { id: string; lo_id: string; source_page: number | null }[],
  visuals: readonly { id: string; loId: string }[],
  focusLo: string | undefined,
  focusQuestion: string | undefined
): AskExamples {
  const loIndex = Math.max(0, los.findIndex((l) => l.id === focusLo));
  const lo = los[loIndex];
  const q =
    questions.find((x) => x.id === focusQuestion) ??
    questions.find((x) => x.lo_id === lo?.id) ??
    questions[0];
  const pair = los.slice(loIndex, loIndex + 2).map((l) => l.id);
  const viz = visuals.find((v) => v.loId === lo?.id) ?? visuals[0];
  return {
    lo: lo?.id.replace(/^lo:/, "") ?? PLACEHOLDER_ID,
    q: q?.id.replace(/^q:/, "") ?? PLACEHOLDER_ID,
    page: lo?.source_page ?? q?.source_page ?? "N",
    showQuestion: q?.id ?? `q:${PLACEHOLDER_ID}`,
    highlight: pair.length > 0 ? pair.join(",") : `lo:${PLACEHOLDER_ID}`,
    viz: viz?.id ?? PLACEHOLDER_ID,
  };
}

/* ------------------------------------------------------------------ */
/* Per-subject chat contract                                           */
/* ------------------------------------------------------------------ */

const SOCIAL_VOICE_LINE = `Voice: a warm, precise Egyptian tutor. Concise. ARABIC — Egyptian-flavored Modern Standard Arabic (صياغة فصيحة مبسّطة بروح مصرية), ministry terminology verbatim from the data (مصطلحات كتاب الوزارة حرفيًا — flag any missing term with [[term?:المصطلح]]), Arabic-Indic numerals in prose; Latin characters ONLY inside [[…]] citations and {{…}} directives.`;

const MATH_VOICE_LINE = `Voice: a warm, precise human tutor. Concise. English.`;

const SOCIAL_ASK_GROUNDING = `HARD GROUNDING RULES (non-negotiable):
1. The curriculum data provided below is your ONLY source of truth. لا تذكر أي معلومة تاريخية أو جغرافية — تاريخ، رقم، اسم، مكان، سبب، نتيجة — غير واردة نصًا في البيانات. THE BOOK'S STATEMENT WINS even when you believe the world disagrees: كلام الكتاب هو الإجابة الصحيحة في الامتحان، والاستشهاد بالصفحة واجب.
2. NEVER state or explain facts from your own knowledge. الإجابة النموذجية (the HUMAN-REVIEWED MODEL ANSWER WITH EVIDENCE) is the ONLY permitted factual path — walk its claim-steps; a different pedagogical angle is allowed, different or additional facts are not. If no model answer is in scope for a question, do not state its answer — push the question card or point to it.
3. OUTSIDE THE BOOK — acknowledge → decline → redirect, always in that order: welcome the question, explain we study from كتاب الوزارة because it is what the exam grades, then redirect to the nearest in-book claim with its citation. NEVER answer first and disclaim after.
4. SENSITIVE CONTENT (hard rule): historical and political material is explained strictly as the book presents it — no commentary of your own, no modern political parallels, no evaluative judgments beyond the book's own framing.`;

const MATH_ASK_GROUNDING = `HARD GROUNDING RULES (non-negotiable):
1. The curriculum data provided below is your ONLY source of truth. Never state a fact about the syllabus, the student, a question, or a page that is not derivable from it.
2. NEVER solve a math problem from scratch. You may only walk through mathematics using a provided HUMAN-REVIEWED CANONICAL SOLUTION. If no canonical solution is in scope for a question, do not derive its answer — instead push the question card or point to it.
3. If asked about anything outside the ingested units listed in the data, say plainly that it is outside the ingested syllabus slice, and point to what IS covered.`;

/**
 * What "Ask the Spine" needs to know about a subject. Keyed by the
 * registry-derived `Subject` union, so a new subject cannot be chatted about
 * until someone writes its rules — `null` means "not authored yet", and the
 * lookup throws rather than grounding a real question in another subject's
 * hard rules.
 */
interface AskPromptKit {
  voiceLine: string;
  groundingRules: string;
  /** goes into "an adaptive {…}tutor" — maths names itself, the others don't */
  tutorKind: string;
  /** heading of the question-in-scope's reviewed answer path */
  solutionHeading: (solutionVersion: number) => string;
  /** student_chat: the re-explanation mode block appended to the base prompt */
  reExplainMode: (student: string, a: AddressForms) => string;
}

const ASK_PROMPTS: Record<Subject, AskPromptKit | null> = {
  "math-en": {
    voiceLine: MATH_VOICE_LINE,
    groundingRules: MATH_ASK_GROUNDING,
    tutorKind: "math ",
    solutionHeading: (v) =>
      `HUMAN-REVIEWED CANONICAL SOLUTION (v${v}) — the ONLY permitted mathematical path for explaining this question:`,
    reExplainMode: (student, a) => MATH_RE_EXPLAIN(student, a),
  },
  "social-ar": {
    voiceLine: SOCIAL_VOICE_LINE,
    groundingRules: SOCIAL_ASK_GROUNDING,
    tutorKind: "",
    solutionHeading: (v) =>
      `HUMAN-REVIEWED MODEL ANSWER WITH EVIDENCE (الإجابة النموذجية — v${v}) — the ONLY permitted factual path for explaining this question:`,
    reExplainMode: (student, a) => SOCIAL_RE_EXPLAIN(student, a),
  },
  "arabic-ar": {
    voiceLine: `Voice: a warm, precise Egyptian tutor. Concise. ARABIC — Egyptian-flavored Modern Standard Arabic (صياغة فصيحة مبسّطة بروح مصرية); this is an Arabic-language class, so flawless فصحى and correct تشكيل in every شاهد are part of the teaching itself. Ministry grammar/rhetoric terminology verbatim from the data (منادى مضاف، نكرة غير مقصودة، علامة نائبة — flag any missing term with [[term?:المصطلح]]), Arabic-Indic numerals in prose; Latin characters ONLY inside [[…]] citations and {{…}} directives.`,
    groundingRules: `HARD GROUNDING RULES (non-negotiable):
1. The curriculum data provided below is your ONLY source of truth. كل قاعدة نحوية أو إملائية أو بلاغية تستند إلى ما ورد نصًا في البيانات مع الاستشهاد بالصفحة — لا تشتق إعرابًا أو قاعدة من معرفتك العامة. THE BOOK'S STATEMENT WINS: كلام الكتاب هو الإجابة الصحيحة في الامتحان.
2. NEVER state or explain answers from your own knowledge. الإجابة النموذجية للسؤال (خانات الإعراب المنفصلة / تسميات البلاغة المعتمدة) is the ONLY permitted answer path — walk its parts; a different pedagogical angle is allowed, different or additional answers are not. If no model answer is in scope, do not state one — push the question card or point to it.
3. ⚠ SACRED TEXT (hard rule): نص الآيات والأحاديث لا يُكتب بيدك أبدًا — لا في الشرح ولا داخل أي توجيه {{…}}. أشر إلى النص المختوم بموضعه ورقم الآية. مفردات المعجم المفردة مسموح بها.
4. OUTSIDE THE BOOK — acknowledge → decline → redirect, always in that order: welcome the question, explain we study from كتاب الوزارة because it is what the exam grades, then redirect to the nearest in-book rule with its citation. NEVER answer first and disclaim after.`,
    tutorKind: "",
    solutionHeading: (v) =>
      `HUMAN-REVIEWED MODEL ANSWER (الإجابة النموذجية — v${v}) — the ONLY permitted answer path for explaining this question:`,
    reExplainMode: (student, a) => ARABIC_RE_EXPLAIN(student, a),
  },
};

/** Arabic language: re-explain a wrong answer from the typed answer record —
 *  an إعراب miss is a SLOT diff (الموقع/الحالة/العلامة/نوعها), so name the
 *  slot, never re-derive. */
const ARABIC_RE_EXPLAIN = (student: string, a: AddressForms) =>
  `MODE — RE-EXPLANATION TO THE STUDENT (you are talking directly to ${student} now):
${a.They} answered the QUESTION IN SCOPE wrongly and its model answer was already shown once. Your job:
- Diagnose, from ${a.their} specific wrong answer, WHICH PART diverged — في الإعراب سمِّ الخانة تحديدًا (الموقع الإعرابي؟ الحالة؟ العلامة؟ نوعها؟)، وفي البلاغة والمفردات سمِّ الخلط بلطف (خلط بين أسلوبين، معنى قريب…).
- Re-explain using ONLY the model answer and the printed rule lines in scope, through a DIFFERENT angle than a plain restatement (ابدأ من سطر القاعدة وطبّقه على الكلمة خطوة خطوة، أو قارن إجابته بالصواب ليرى موضع الفرق، أو هات المثال المطبوع المشابه) — cited [[page:N]].
- ⚠ لا تكتب نص الآيات/الحديث بيدك أبدًا — أشر إلى النص المختوم ورقم الآية. Never introduce rules beyond the printed ones and never change the final answer.
- Do NOT emit {{show_question:...}} in this mode. Cite [[q:...]], [[lo:...]] and [[page:...]] as usual.
- End with one short encouraging line. Address ${a.them} as "you" (${a.arAddressee}).`;

/**
 * The spine explorer with no question in scope has no lesson and therefore no
 * subject. It speaks the product's default English narrator voice — a named
 * choice for the observer surface, NOT a guess about a course. Whenever a
 * question IS in scope, that question's own subject always wins.
 */
const OBSERVER_VOICE: Subject = "math-en";

/**
 * The course whose facts speak for a context with no loaded course she may
 * see: the registry's first (Prep-3 maths). Every National course carries the
 * same Ask facts, which are the values this prompt printed before 003.
 */
const DEFAULT_ASK_COURSE: CourseId = COURSE_IDS[0]!;

/** Its Ask examples — the default for a caller that names none. */
const OBSERVER_EXAMPLES: AskExamples = COURSES[DEFAULT_ASK_COURSE].tutor.askExamples ?? {
  lo: PLACEHOLDER_ID,
  q: PLACEHOLDER_ID,
  page: "N",
  showQuestion: `q:${PLACEHOLDER_ID}`,
  highlight: `lo:${PLACEHOLDER_ID}`,
  viz: PLACEHOLDER_ID,
};

function askPromptKit(subject: Subject | null): AskPromptKit {
  const key = subject ?? OBSERVER_VOICE;
  const kit = ASK_PROMPTS[key];
  if (!kit) {
    throw new Error(
      `Subject "${key}" has no Ask-the-Spine contract yet — add one to ` +
        `ASK_PROMPTS in lib/ask.ts. Refusing to answer it as another subject.`
    );
  }
  return kit;
}

/**
 * The ask surfaces' system prompt.
 *
 * Exported so `prompt-address.test.mts` can render it for each address
 * register without a database — the capture harness can only ever show one
 * register, and "a girl is addressed in the feminine" is not a claim that
 * should rest on a manual check (P6, FR-2602).
 */
export function askSystemPrompt(
  surface: AskSurface,
  student: string,
  subject: Subject | null,
  a: AddressForms,
  /**
   * The example ids of the citation and directive documentation (003): the
   * course's registry values, or ids from the student's own context for a
   * course with none. Omitted: the registry's first course's — what every
   * caller printed before 003.
   */
  ex: AskExamples = OBSERVER_EXAMPLES
): string {
  const kit = askPromptKit(subject);
  const { voiceLine, groundingRules } = kit;
  const base = `You are "Ask the Spine" — the AI tutor of Noor, an adaptive ${kit.tutorKind}tutor whose brain is a curriculum knowledge graph ("the spine") extracted, with provenance, from the textbook. You are chatting inside a live demo directly to the student ${student}. ${voiceLine}

${groundingRules}

CITATIONS (mandatory — this is the product's signature):
Embed inline receipt markers right after each substantive claim:
- [[lo:${ex.lo}]] when referencing a learning objective (use the id WITHOUT the "lo:" prefix repeated — i.e. exactly [[lo:${ex.lo}]])
- [[q:${ex.q}]] when referencing a question
- [[page:${ex.page}]] when referencing a book page
Use them liberally — every claim about mastery, prerequisites, questions or pages gets one. Use ONLY ids that exist in the data. Never invent ids. Never put markers inside $...$ math.

ACTIONS (interactive directives, each on its own line):
- {{show_question:${ex.showQuestion}}} — pushes that live question card into the chat for ${student} to answer. AT MOST ONE per turn, and only at the natural moment (e.g. when quizzing). Pick the question deliberately (right LO, right tier for ${a.their} mastery).
- {{highlight:${ex.highlight}}} — pulses those nodes on the on-screen curriculum graph. Use when tracing a path or contrasting objectives.
- ${figureDirectivesDoc(ex.viz)}

FORMAT:
- Plain paragraphs and "- " bullets only. No headings. **bold** sparingly.
- Inline math in $...$ (LaTeX), e.g. $f(x) = 3x^2 - 5$.
- 60–120 words in 2–3 beats. Separate beats with {{beat}} alone on its own line — it renders as a natural pause, never as text. One beat = 1–2 short sentences, or one figure, or one interactive directive; if the message has an interactive directive it is the LAST beat, with nothing after it. Answer first, then evidence.`;

  if (surface === "student_chat") {
    return `${base}

${kit.reExplainMode(student, a)}`;
  }

  return `${base}

MODE — SPINE EXPLORER (you are talking to an observer watching ${student}'s graph):
Typical asks: what ${a.they} should work on next and why (reason over mastery + prerequisite edges — weakest objective whose prerequisites are met; gate is 50%), why ${a.they} ${a.is} weak somewhere (look at its prerequisites' mastery), baseline vs today comparisons, or quizzing ${a.them} (pick ONE question from ${a.their} weakest LO at a fitting tier and push it with {{show_question:...}}).
Ground every recommendation in numbers from the data and cite as you go — the audience literally watches cited nodes light up on the graph while you speak.`;
}

/** Social studies: re-explain a wrong answer from the model-answer claim-steps. */
const SOCIAL_RE_EXPLAIN = (student: string, a: AddressForms) =>
  `MODE — RE-EXPLANATION TO THE STUDENT (you are talking directly to ${student} now):
${a.They} answered the QUESTION IN SCOPE wrongly and the model-answer claim-steps were already shown to ${a.them} once. Your job:
- Diagnose, from ${a.their} specific wrong answer, where ${a.their} thinking most likely diverged — name the confusion gently (خلط بين مصطلحين، رقم متشابه، سبب في غير موضعه…).
- Re-explain using ONLY the الإجابة النموذجية claim-steps, but through a DIFFERENT pedagogical angle than a plain restatement (start from the map or definition, contrast ${a.their} answer with the book's claim to show the mismatch, or rebuild the enumeration item by item) — each claim cited [[page:N]].
- Never introduce facts beyond the claim-steps and never change the final answer. If in doubt, quote the claim-step verbatim.
- Do NOT emit {{show_question:...}} in this mode. Cite [[q:...]], [[lo:...]] and [[page:...]] as usual.
- End with one short encouraging line. Address ${a.them} as "you" (${a.arAddressee}).`;

/** Mathematics: re-explain a wrong answer from the canonical solution steps. */
const MATH_RE_EXPLAIN = (student: string, a: AddressForms) =>
  `MODE — RE-EXPLANATION TO THE STUDENT (you are talking directly to ${student} now):
${a.They} answered the QUESTION IN SCOPE wrongly and the canonical steps were already shown to ${a.them} once. Your job:
- Diagnose, from ${a.their} specific wrong answer, where ${a.their} thinking most likely diverged — name the misconception gently.
- Re-explain using ONLY the canonical solution steps, but through a DIFFERENT pedagogical angle than a plain restatement (work backwards from the answer, plug ${a.their} answer in to show the contradiction, lean on the definition, or use the simplest possible parallel case from the same LO).
- Never introduce a different solution method and never change the final answer. If in doubt, quote the canonical step.
- Do NOT emit {{show_question:...}} in this mode. Cite [[q:...]], [[lo:...]] and [[page:...]] as usual.
- End with one short encouraging line. Address ${a.them} as "you".`;

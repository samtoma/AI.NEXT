import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * THE BOOK'S OWN STATEMENTS for a maths lesson compiled from book records
 * (Tamer, 2026-10-16): its definitions, rules, cautions, conventions, printed
 * methods and key terms, in the book's words, by objective.
 *
 * Until now the maths tutor taught from objective descriptions and worked
 * solutions only (`mathGroundingRules`), so a lesson's printed definitions
 * never reached it. Book-record lessons carry them; nothing else does.
 *
 * WHERE THEY COME FROM. `services/extraction/compile_book_records.py` writes
 * one file per lesson (format `ainext.book-statements/1`) to
 * `compiled/<book>/content/<slug>.json`. This reader looks ONLY in the folder
 * `AINEXT_BOOK_STATEMENTS_DIR` names (relative to the app's working
 * directory, like the lesson-content root). Unset — every deployed
 * environment today — it returns `null` for every lesson, so every prompt is
 * byte-identical to the build before (the National and Grade 10 goldens hold
 * that). Grade 10's own extracted claims (`seed/content/`) are never read
 * here: the decision was book-record lessons only.
 *
 * Read defensively, like `lesson-content.ts`: a missing or malformed file is
 * `null`, never a throw.
 */

export interface BookStatement {
  /** the book-record id, e.g. "u1-1:definition-2" */
  id: string;
  /** definition | rule | caution | convention | method | key_term | prior_knowledge */
  type: string;
  /** the book's words, misprints corrected, in the app's notation */
  text: string;
  /** the printed page */
  page: number | null;
}

/**
 * The book's own context for an objective (services/extraction/book_record_context.py,
 * S1C; Tamer, 2026-10-22): a real-life opener or a concept introduction, as
 * the book prints it. The tutor opens the objective with it; never one the
 * book does not print.
 */
export interface BookContext {
  /** the book-record id of the passage, e.g. "eb11c2-2:linking-text-1" */
  id: string;
  /** real_life | concept_intro */
  kind: string;
  text: string;
  page: number | null;
}

export interface BookStatementGroup {
  /** the objective it teaches, `lo:<slug>-N`, or null for none */
  lo: string | null;
  label: string | null;
  statements: BookStatement[];
  /** the book's context for the objective (or the whole lesson); [] when none */
  context: BookContext[];
  /** live question ids of the objective set in a real situation; [] when none */
  realLifeQuestions: string[];
}

export interface BookStatements {
  lesson: string;
  groups: BookStatementGroup[];
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The folder the statements are read from, or null when none is configured. */
export function bookStatementsDir(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const dir = (env.AINEXT_BOOK_STATEMENTS_DIR ?? "").trim();
  if (!dir) return null;
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

function normGroup(raw: unknown): BookStatementGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const statements = (Array.isArray(g.statements) ? g.statements : [])
    .map((s): BookStatement | null => {
      if (!s || typeof s !== "object") return null;
      const x = s as Record<string, unknown>;
      if (typeof x.id !== "string" || typeof x.text !== "string" || !x.text.trim()) return null;
      return {
        id: x.id,
        type: typeof x.type === "string" ? x.type : "statement",
        text: x.text.trim(),
        page: typeof x.page === "number" ? x.page : null,
      };
    })
    .filter((s): s is BookStatement => s !== null);
  const context = (Array.isArray(g.context) ? g.context : [])
    .map((c): BookContext | null => {
      if (!c || typeof c !== "object") return null;
      const x = c as Record<string, unknown>;
      if (typeof x.id !== "string" || typeof x.text !== "string" || !x.text.trim()) return null;
      if (x.kind !== "real_life" && x.kind !== "concept_intro") return null;
      return { id: x.id, kind: x.kind, text: x.text.trim(), page: typeof x.page === "number" ? x.page : null };
    })
    .filter((c): c is BookContext => c !== null);
  const realLifeQuestions = (Array.isArray(g.real_life_questions) ? g.real_life_questions : []).filter(
    (q): q is string => typeof q === "string" && q.startsWith("q:")
  );
  if (!statements.length && !context.length && !realLifeQuestions.length) return null;
  return {
    lo: typeof g.lo === "string" ? g.lo : null,
    label: typeof g.label === "string" ? g.label : null,
    statements,
    context,
    realLifeQuestions,
  };
}

/** The lesson's statements, or null (no folder configured, no file, nothing usable). */
export async function getBookStatements(
  slug: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<BookStatements | null> {
  const dir = bookStatementsDir(env);
  if (!dir || !SLUG_RE.test(slug)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(dir, `${slug}.json`), "utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.format !== "ainext.book-statements/1" || r.lesson !== slug) return null;
  const groups = (Array.isArray(r.groups) ? r.groups : [])
    .map(normGroup)
    .filter((g): g is BookStatementGroup => g !== null);
  return groups.length ? { lesson: slug, groups } : null;
}

/** How many statements there are in all. */
export function statementCount(s: BookStatements | null | undefined): number {
  return s ? s.groups.reduce((n, g) => n + g.statements.length, 0) : 0;
}

/** How many context passages there are in all: the lesson prompt's context rules ride on this (0: no change at all). */
export function contextCount(s: BookStatements | null | undefined): number {
  return s ? s.groups.reduce((n, g) => n + g.context.length, 0) : 0;
}

const TYPE_LABEL: Record<string, string> = {
  definition: "definition",
  rule: "rule",
  caution: "caution",
  convention: "convention",
  method: "method",
  key_term: "key term",
  prior_knowledge: "prior knowledge",
};

/** The data-block section the tutor reads (learn and review). "" when there is nothing. */
export function bookStatementsBlock(s: BookStatements | null | undefined): string {
  return statementsSection(s) + contextSection(s);
}

const groupHead = (g: BookStatementGroup) => (g.lo ? `${g.lo}${g.label ? ` — ${g.label}` : ""}` : "(the whole lesson)");

function statementsSection(s: BookStatements | null | undefined): string {
  if (!statementCount(s)) return "";
  const groups = s!.groups
    .filter((g) => g.statements.length)
    .map((g) => {
      const lines = g.statements.map(
        (x) => `- (${TYPE_LABEL[x.type] ?? x.type}${x.page != null ? `, p.${x.page}` : ""}) ${x.text}`
      );
      return `${groupHead(g)}\n${lines.join("\n")}`;
    })
    .join("\n");
  return `

THE BOOK'S STATEMENTS — the definitions, rules, cautions, conventions, methods and key terms the textbook prints for this lesson, in its own words, by objective. When you define a term or state a rule, use these words and cite the page; never state a definition or rule the book does not print.
${groups}`;
}

const CONTEXT_LABEL: Record<string, string> = { real_life: "real-life opener", concept_intro: "introduction" };

/** The book's context per objective, and its questions set in a real situation. "" for a lesson with none. */
function contextSection(s: BookStatements | null | undefined): string {
  if (!contextCount(s)) return "";
  const groups = s!.groups
    .filter((g) => g.context.length || g.realLifeQuestions.length)
    .map((g) => {
      const lines = g.context.map(
        (x) => `- (${CONTEXT_LABEL[x.kind] ?? x.kind}${x.page != null ? `, p.${x.page}` : ""}) ${x.text}`
      );
      if (g.realLifeQuestions.length) lines.push(`- real-life questions: ${g.realLifeQuestions.join(", ")}`);
      return `${groupHead(g)}\n${lines.join("\n")}`;
    })
    .join("\n");
  return `

THE BOOK'S CONTEXT — the real-life openers and introductions the textbook prints, by objective ("the whole lesson" sets up all of them), and the questions in the QUESTION BANK that are set in a real situation. Retell it in your own words and cite the page; never a situation, number or fact it does not give.
${groups}`;
}

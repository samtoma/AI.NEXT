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

export interface BookStatementGroup {
  /** the objective it teaches, `lo:<slug>-N`, or null for none */
  lo: string | null;
  label: string | null;
  statements: BookStatement[];
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
  if (!statements.length) return null;
  return {
    lo: typeof g.lo === "string" ? g.lo : null,
    label: typeof g.label === "string" ? g.label : null,
    statements,
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
  if (!statementCount(s)) return "";
  const groups = s!.groups
    .map((g) => {
      const head = g.lo ? `${g.lo}${g.label ? ` — ${g.label}` : ""}` : "(the whole lesson)";
      const lines = g.statements.map(
        (x) => `- (${TYPE_LABEL[x.type] ?? x.type}${x.page != null ? `, p.${x.page}` : ""}) ${x.text}`
      );
      return `${head}\n${lines.join("\n")}`;
    })
    .join("\n");
  return `

THE BOOK'S STATEMENTS — the definitions, rules, cautions, conventions, methods and key terms the textbook prints for this lesson, in its own words, by objective. When you define a term or state a rule, use these words and cite the page; never state a definition or rule the book does not print.
${groups}`;
}

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * THE S8 COVERAGE AUDIT, AS THE CONSOLE SHOWS IT (feature 003, FR-4309 and
 * FR-4301's "the pipeline's coverage audit MUST report none missing";
 * backlog #16).
 *
 * `services/extraction/coverage_report.py` writes `coverage/<book>.json` for
 * a book the pipeline ingested: every integer equality it checks, and a
 * verdict — GREEN (every check holds, or every failure is covered by a SIGNED
 * exception) or RED. It is committed beside the bundles it audits, so the
 * file an image carries is the audit of the content that image's commit
 * loads. The console reads its verdict and summary, and nothing else, to put
 * it beside the course's switch.
 *
 * Read at request time from the repository layout — `<app>/../services/
 * extraction/coverage/` — the way `lib/lesson-content.ts` reads
 * `seed/content`; the image mirrors that path (`deploy/Dockerfile`). A book
 * with no file is "no audit on record": the three National books were loaded
 * before the audit existed, and saying so is the honest answer, not a RED.
 *
 * Server-only (node:fs). Never throws: a file that cannot be parsed is
 * "unreadable", shown as such.
 */

export type CoverageState = "green" | "red" | "none" | "unreadable";

export interface CoverageStatus {
  state: CoverageState;
  /** the file's path relative to the repository, for the operator */
  file: string;
  /** "all", or the chapters a partial audit covered (the Chapter 8 pilot) */
  chapters: "all" | number[] | null;
  summary: { checks: number; hold: number; excepted: number; fail: number } | null;
  /** the ids of the checks that fail */
  failing: string[];
  /** inputs the audit could not find (lessons not yet extracted, …) */
  missingInputs: number;
}

const BOOK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Parse a coverage report's JSON text. Pure, for the test. */
export function coverageFromJson(text: string, file: string): CoverageStatus {
  const empty: CoverageStatus = {
    state: "unreadable",
    file,
    chapters: null,
    summary: null,
    failing: [],
    missingInputs: 0,
  };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return empty;
  }
  if (raw == null || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;
  const status = r.status === "GREEN" ? "green" : r.status === "RED" ? "red" : null;
  if (!status) return empty;
  const s = (r.summary ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const checks = Array.isArray(r.checks) ? (r.checks as Record<string, unknown>[]) : [];
  return {
    state: status,
    file,
    chapters:
      r.chapters === "all"
        ? "all"
        : Array.isArray(r.chapters)
          ? (r.chapters as unknown[]).filter((c): c is number => typeof c === "number")
          : null,
    summary: { checks: n(s.checks), hold: n(s.hold), excepted: n(s.excepted), fail: n(s.fail) },
    failing: checks.filter((c) => c.state === "fails").map((c) => String(c.id ?? "?")),
    missingInputs: Array.isArray(r.missing_inputs) ? r.missing_inputs.length : 0,
  };
}

/** The audit on record for one pipeline book (`CourseDef.pipelineBook`). */
export async function coverageStatus(pipelineBook: string): Promise<CoverageStatus> {
  const file = `services/extraction/coverage/${pipelineBook}.json`;
  const none: CoverageStatus = {
    state: "none",
    file,
    chapters: null,
    summary: null,
    failing: [],
    missingInputs: 0,
  };
  if (!BOOK_ID.test(pipelineBook)) return { ...none, state: "unreadable" };
  let text: string;
  try {
    text = await readFile(path.join(process.cwd(), "..", file), "utf8");
  } catch {
    return none;
  }
  return coverageFromJson(text, file);
}

/**
 * WORKING STEPS THE CHECKER FLAGGED, as the review gate reads them (Samuel's
 * answers 30 and 37c; FR-4411 → FR-4501). Pure: no file system, no database, no
 * Node built-ins — the files are read by `lib/review-gate-files.ts`, the
 * content by `lib/review-gate-queries.ts`.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE THE CONSOLE RELIES ON — `ainext.working-check/1`
 * ---------------------------------------------------------------------------
 * One file per chapter, written by `services/extraction/working_check.py`
 * (`collect`), at `runs/<book>/working-check/chNN.flags.json`:
 *
 *   {
 *     "format": "ainext.working-check/1",
 *     "book": "g10-math", "chapter": 8, "prompts_version": "sw-v1",
 *     "runs": ["<run id or sha>"],
 *     "flags": [ {
 *       "solution_id": "q:g10m8s3-2-2:ex8-4-19b" | "expl:g10m8s3-2-2:ex8-6-26",
 *       "lo": "lo:g10m8s3-2-2",
 *       "step": 4,                      // 1-based, in the numbered working as served
 *       "kind": "label",                // wrong_value | arithmetic | sign | label | copy | final_answer | other
 *       "where": "working",             // working | question | unsure — absent in sw-v1: reads as "working"
 *       "quote": "m_{PR}\\times m_{QR}", "expected": "…", "why": "…",
 *       "sources": ["agent"], "numeric": {…}
 *     } ],
 *     …                                  // verdicts, skipped, unclear: not backlog material
 *   }
 *
 * ONLY the canonical `chNN.flags.json` are backlog material. Calibration
 * experiments (`ch08-cal.flags.json`, `ch08-cal-b5h.flags.json`, the raw
 * `ch08-wf_….json` run files) are measurements of the checker, never findings
 * about the book (`isCanonicalFlagsFile`).
 *
 * `chNN.calibration.json` (`ainext.working-check-calibration/1`) beside it is
 * the classification truth of an earlier run: each flag a person (or the
 * qa-engineer agent) read against the book, classed REAL, REAL-BUT-ELSEWHERE or
 * FALSE with the evidence. It is shown to the reviewer so a false alarm reads as
 * one; it is never a review (answer 33) and never closes an item.
 *
 * One backlog item per FLAGGED SOLUTION, all its flags shown. Its ref is the
 * solution id — `q:…` is a row of `questions`, `expl:…` a worked example of
 * `explanation_library` — so the item is linked to the content it belongs to.
 */

export const WORKING_CHECK_FORMAT = "ainext.working-check/1";
export const CALIBRATION_FORMAT = "ainext.working-check-calibration/1";

export const FLAG_WHERE = ["working", "question", "unsure"] as const;
export type FlagWhere = (typeof FLAG_WHERE)[number];

export const FLAG_KINDS = ["wrong_value", "arithmetic", "sign", "label", "copy", "final_answer", "other"] as const;

export const FLAG_KIND_LABEL: Record<string, string> = {
  wrong_value: "wrong value",
  arithmetic: "arithmetic",
  sign: "sign or bracket",
  label: "label changes",
  copy: "copy slip",
  final_answer: "last step vs. the key",
  other: "other",
};

/** Where the checker puts the fault — a stem misprint reads as a question problem. */
export const WHERE_LABEL: Record<FlagWhere, string> = {
  working: "in the working",
  question: "in the question text",
  unsure: "step or question — the checker is unsure",
};

export const CLASSES = ["REAL", "REAL-BUT-ELSEWHERE", "FALSE"] as const;
export type FlagClass = (typeof CLASSES)[number];

export const CLASS_LABEL: Record<FlagClass, string> = {
  REAL: "real defect in the book",
  "REAL-BUT-ELSEWHERE": "real defect, but not a step of the working",
  FALSE: "false alarm — the checker's mistake",
};

/** One flagged step, as read from a flags file. */
export interface WorkingFlag {
  step: number;
  kind: string;
  where: FlagWhere;
  quote: string;
  expected: string;
  why: string;
  sources: string[];
  /** the free numeric pre-check's own reading, when it agreed (`left`, `relation`, `right`, `why`) */
  numeric?: Record<string, string>;
  /** the calibration truth, when one classes this (solution, step) */
  calibration?: { verdict: FlagClass; evidence: string };
}

/** Everything the checker said about one solution. */
export interface WorkingFlagGroup {
  /** the solution id: "q:…" or "expl:…" */
  ref: string;
  solutionKind: "question" | "worked_example";
  book: string;
  /** the course the book belongs to (`lib/courses.ts`) — set by the reader */
  courseId: string;
  chapter: number | null;
  promptsVersion: string | null;
  runs: string[];
  /** the flags file, repository-relative */
  source: string;
  /** the objective the checker named, a fallback only: the console places the item by the solution's own row */
  lo: string | null;
  flags: WorkingFlag[];
  /** who classified the flags, when, and on which run — when a calibration file is beside the flags */
  calibration: {
    classifiedBy: string | null;
    classifiedOn: string | null;
    sourceRun: string | null;
    /** the checker version that run used ("sw-v1"), when the file names it */
    promptsVersion: string | null;
    source: string;
  } | null;
}

/* ----------------------------------------------------------------- helpers */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const BOOK = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SOLUTION_ID = /^(q|expl):[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$/;

/** The solution's table, from its id: "q:" a question, "expl:" a worked example. */
export const solutionKindOf = (id: string): "question" | "worked_example" => (id.startsWith("expl:") ? "worked_example" : "question");

/**
 * The chapter number of a CANONICAL flags file — `ch08.flags.json` — and null
 * for everything else in the folder: a calibration copy (`ch08-cal.flags.json`,
 * `ch08-cal-b5h.flags.json`), a raw run file (`ch08-wf_….json`), a truth file.
 */
export function canonicalFlagsChapter(file: string): number | null {
  const m = file.match(/^ch(\d{1,2})\.flags\.json$/);
  return m ? Number(m[1]) : null;
}

/** The truth file beside a chapter's flags. */
export const calibrationFileFor = (chapter: number): string => `ch${String(chapter).padStart(2, "0")}.calibration.json`;

const flagWhere = (v: unknown): FlagWhere => (typeof v === "string" && (FLAG_WHERE as readonly string[]).includes(v) ? (v as FlagWhere) : "working");

/* ------------------------------------------------------------------ parse */

export interface ParsedFlagsFile {
  book: string;
  chapter: number | null;
  promptsVersion: string | null;
  runs: string[];
  flags: (WorkingFlag & { solutionId: string; lo: string | null })[];
}

const MAX_FLAGS = 5000;

/**
 * A chapter's flags file. Null when it is not one (wrong `format`, no book, a
 * book other than the folder's). A flag that cannot be read — no solution id of
 * the shape, a step that is not a positive whole number — is dropped, never
 * guessed: the item would point at nothing.
 */
export function parseFlagsFile(raw: unknown, book: string, fileChapter: number | null): ParsedFlagsFile | null {
  if (!isObj(raw) || raw.format !== WORKING_CHECK_FORMAT) return null;
  const rawBook = text(raw.book, 64);
  if (!BOOK.test(book) || (rawBook && rawBook !== book)) return null;
  const chapter = typeof raw.chapter === "number" && Number.isInteger(raw.chapter) ? raw.chapter : fileChapter;
  const flags: ParsedFlagsFile["flags"] = [];
  for (const f of Array.isArray(raw.flags) ? raw.flags.slice(0, MAX_FLAGS) : []) {
    if (!isObj(f)) continue;
    const solutionId = text(f.solution_id, 220);
    const step = f.step;
    if (!SOLUTION_ID.test(solutionId) || typeof step !== "number" || !Number.isInteger(step) || step < 1 || step > 1000) continue;
    const numeric: Record<string, string> = {};
    if (isObj(f.numeric)) {
      for (const k of ["left", "relation", "right", "why"]) {
        const v = f.numeric[k];
        if (typeof v === "string") numeric[k] = text(v, 400);
      }
    }
    flags.push({
      solutionId,
      lo: text(f.lo, 200) || null,
      step,
      kind: text(f.kind, 40) || "other",
      where: flagWhere(f.where),
      quote: text(f.quote, 1000),
      expected: text(f.expected, 2000),
      why: text(f.why, 2000),
      sources: Array.isArray(f.sources) ? f.sources.filter((s): s is string => typeof s === "string").slice(0, 6).map((s) => s.slice(0, 40)) : [],
      ...(Object.keys(numeric).length > 0 ? { numeric } : {}),
    });
  }
  return {
    book,
    chapter,
    promptsVersion: text(raw.prompts_version, 40) || null,
    runs: Array.isArray(raw.runs) ? raw.runs.filter((r): r is string => typeof r === "string" && r.length > 0).slice(0, 20).map((r) => r.slice(0, 80)) : [],
    flags,
  };
}

export interface ParsedCalibration {
  /** `<solution id>#<step>` → the class and the evidence */
  labels: Map<string, { verdict: FlagClass; evidence: string }>;
  classifiedBy: string | null;
  classifiedOn: string | null;
  sourceRun: string | null;
  promptsVersion: string | null;
}

export const labelKey = (solutionId: string, step: number) => `${solutionId}#${step}`;

/** A calibration truth file. Null when it is not one. */
export function parseCalibration(raw: unknown): ParsedCalibration | null {
  if (!isObj(raw) || raw.format !== CALIBRATION_FORMAT) return null;
  const labels = new Map<string, { verdict: FlagClass; evidence: string }>();
  for (const l of Array.isArray(raw.labels) ? raw.labels.slice(0, MAX_FLAGS) : []) {
    if (!isObj(l)) continue;
    const id = text(l.solution_id, 220);
    const verdict = l.verdict;
    if (!SOLUTION_ID.test(id) || typeof l.step !== "number" || !Number.isInteger(l.step)) continue;
    if (typeof verdict !== "string" || !(CLASSES as readonly string[]).includes(verdict)) continue;
    const key = labelKey(id, l.step);
    if (!labels.has(key)) labels.set(key, { verdict: verdict as FlagClass, evidence: text(l.evidence, 2000) });
  }
  const sourceRun = text(raw.source_run, 300) || null;
  return {
    labels,
    classifiedBy: text(raw.classified_by, 400) || null,
    classifiedOn: text(raw.classified_on, 40) || null,
    sourceRun,
    promptsVersion: sourceRun?.match(/\(prompts ([A-Za-z0-9._-]+)\)/)?.[1] ?? null,
  };
}

/**
 * The flags of one file, one group per flagged solution, each flag carrying its
 * calibration class when the truth file classes it. Groups come in the order
 * their solution first appears; flags in step order.
 */
export function groupFlags(
  file: ParsedFlagsFile,
  courseId: string,
  source: string,
  calibration: ParsedCalibration | null,
  calibrationSource: string | null
): WorkingFlagGroup[] {
  const by = new Map<string, WorkingFlagGroup>();
  for (const { solutionId, lo, ...flag } of file.flags) {
    let g = by.get(solutionId);
    if (!g) {
      g = {
        ref: solutionId,
        solutionKind: solutionKindOf(solutionId),
        book: file.book,
        courseId,
        chapter: file.chapter,
        promptsVersion: file.promptsVersion,
        runs: file.runs,
        source,
        lo,
        flags: [],
        calibration:
          calibration && calibrationSource
            ? {
                classifiedBy: calibration.classifiedBy,
                classifiedOn: calibration.classifiedOn,
                sourceRun: calibration.sourceRun,
                promptsVersion: calibration.promptsVersion,
                source: calibrationSource,
              }
            : null,
      };
      by.set(solutionId, g);
    }
    const label = calibration?.labels.get(labelKey(solutionId, flag.step));
    g.flags.push(label ? { ...flag, calibration: label } : flag);
  }
  for (const g of by.values()) g.flags.sort((a, b) => a.step - b.step || a.quote.localeCompare(b.quote));
  return [...by.values()];
}

/* ------------------------------------------------------------ fingerprint */

/** Whitespace out, so LaTeX re-spacing never changes what was quoted. */
export const squash = (s: string): string => s.replace(/\s+/g, "");

/**
 * What a reviewer signs of the CHECKER's side: which steps, flagged for what,
 * where, quoting what. NOT the checker's prose (`why`, `expected`) — a re-run
 * words the same finding differently, and a reviewer who said "not an error"
 * to a step must not be asked again because the model rephrased itself. The
 * other half of the fingerprint is the solution's own text, hashed in SQL.
 */
export function flagsKey(flags: readonly Pick<WorkingFlag, "step" | "kind" | "where" | "quote">[]): string {
  return JSON.stringify(
    [...flags]
      .map((f) => [f.step, f.kind, f.where, squash(f.quote)] as const)
      .sort((a, b) => a[0] - b[0] || String(a[3]).localeCompare(String(b[3])) || String(a[1]).localeCompare(String(b[1])))
  );
}

/* --------------------------------------------------------------- the text */

/** A solution's working, as the checker numbered it: position, not the stored `step` field. */
export interface WorkingText {
  /** a worked example's problem element, or null (a question's stem is its own column) */
  problem: string | null;
  /** the numbered working: every element that is not the problem, in order — empty ones keep their number */
  steps: string[];
}

/**
 * Steps from a stored jsonb value, numbered the way `working_check.py`
 * numbers them (`enumerate(steps, 1)`): a question's `canonical_solution` is
 * `[{step, text_md}]`; a library entry's `content` is the same plus a leading
 * `{kind: "problem", text_md}` that is not a step. Position, not the stored
 * `step` field, because the checker's "step 4" is the fourth line of what it
 * was shown.
 */
export function workingTextOf(content: unknown): WorkingText {
  const list = Array.isArray(content)
    ? content
    : isObj(content) && Array.isArray(content.steps)
      ? content.steps
      : [];
  let problem: string | null = null;
  const steps: string[] = [];
  for (const s of list) {
    if (!isObj(s)) continue;
    const t = typeof s.text_md === "string" ? s.text_md : "";
    if (s.kind === "problem") {
      problem = problem == null ? t : `${problem} ${t}`;
    } else {
      steps.push(t);
    }
  }
  return { problem, steps };
}

/** Is the quote still in the step, as the step reads now? Whitespace aside, exactly. */
export function quoteInStep(step: string | undefined, quote: string): boolean {
  if (!step || !quote) return false;
  return squash(step).includes(squash(quote));
}

/* ---------------------------------------------------------------- payload */

/** One flag, as the reviewer view shows it. */
export interface WorkingFlagPayload extends WorkingFlag {
  /** the quote is still in this step as it reads now (false: a correction may have landed, or the checker misquoted) */
  quoteFound: boolean;
}

/** Everything the reviewer view renders for one flagged solution. */
export interface WorkingFlagItemPayload {
  solutionId: string;
  solutionKind: "question" | "worked_example";
  book: string;
  chapter: number | null;
  promptsVersion: string | null;
  runs: string[];
  source: string;
  /** a worked example's problem (a question's stem is on `question`) */
  problem: string | null;
  sourcePage: number | null;
  /** the numbered working as served, one entry per step: position + text */
  steps: { n: number; text: string }[];
  flags: WorkingFlagPayload[];
  calibration: WorkingFlagGroup["calibration"];
}

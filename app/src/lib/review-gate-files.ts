/**
 * Auto-passed gate decisions, read from the pipeline's run files (Samuel's
 * answers 37c and 39; the shape is `lib/review-gate-records.ts`'s header).
 *
 * Read at request time from the repository layout —
 * `<app>/../services/extraction/runs/<book>/` — the way `lib/coverage-status.ts`
 * reads `coverage/<book>.json`, for every MATHS course's pipeline book in the
 * course registry. Server-only (node:fs, node:crypto). Never throws: a file
 * that cannot be read or parsed is skipped and logged, never a failed page.
 *
 * ⚠ PRODUCTION: the image copies `services/extraction/coverage` and
 * `seed/content` only (`deploy/Dockerfile`), so on the box this finds no run
 * files and the console lists no gate decisions until the image carries
 * `services/extraction/runs/<book>/gates/` too (or the loader puts the
 * records in the database). Locally — where the fan-out runs — it reads them.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { COURSES, COURSE_IDS } from "./courses";
import { mergeRecords, parseAutoFile, parseRecord, type GateRecord } from "./review-gate-records";
import {
  calibrationFileFor,
  canonicalFlagsChapter,
  flagsKey,
  groupFlags,
  parseCalibration,
  parseFlagsFile,
  type WorkingFlag,
  type WorkingFlagGroup,
} from "./review-gate-working";

export type GateRecordRow = GateRecord & { fingerprint: string; courseId: string };

/** A run file bigger than this is not a gate record. */
const MAX_BYTES = 8 * 1024 * 1024;

const BOOK = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The maths courses' pipeline books → their course (registry order). */
export function mathsBooks(): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of COURSE_IDS) {
    const c = COURSES[id];
    if (String(c.subject).startsWith("math") && BOOK.test(c.pipelineBook)) out.set(c.pipelineBook, id);
  }
  return out;
}

export const defaultRunsRoot = () => path.join(process.cwd(), "..", "services", "extraction", "runs");

/** md5 of the record's content (not where it was read from) — the gate item's fingerprint. */
export function recordFingerprint(r: GateRecord): string {
  const { source: _source, origin: _origin, ...content } = r;
  void _source;
  void _origin;
  return createHash("md5").update(JSON.stringify(content)).digest("hex");
}

async function list(dir: string, pattern: RegExp): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => pattern.test(f)).sort().map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

async function readJson(file: string): Promise<{ raw: unknown; mtime: string } | null> {
  try {
    const st = await stat(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return { raw: JSON.parse(await readFile(file, "utf8")), mtime: st.mtime.toISOString() };
  } catch (err) {
    console.warn(`[review-gate] skipped ${file}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Every auto-passed gate decision of every maths book, canonical records
 * first; `root` is the `runs/` directory (a test passes its own).
 */
export async function readGateRecords(root: string = defaultRunsRoot()): Promise<GateRecordRow[]> {
  const books = mathsBooks();
  const repo = path.resolve(root, "..", "..", "..");
  const rel = (f: string) => path.relative(repo, f).split(path.sep).join("/");
  const found: GateRecordRow[] = [];
  for (const [book, courseId] of books) {
    const dir = path.join(root, book);
    const canonical = await list(path.join(dir, "gates"), /\.json$/);
    const auto = [
      ...(await list(path.join(dir, "objectives"), /^g1-ch\d{1,2}\.auto\.json$/)),
      ...(await list(dir, /^g2\.json$/)),
      ...(await list(dir, /^g[345]-.*\.auto\.json$/)),
    ];
    for (const file of canonical) {
      const doc = await readJson(file);
      const r = doc && parseRecord(doc.raw, rel(file), doc.mtime);
      if (r && r.book === book) found.push({ ...r, courseId, fingerprint: recordFingerprint(r) });
    }
    for (const file of auto) {
      const doc = await readJson(file);
      if (!doc) continue;
      for (const r of parseAutoFile(doc.raw, rel(file), book, doc.mtime)) {
        found.push({ ...r, courseId, fingerprint: recordFingerprint(r) });
      }
    }
  }
  return mergeRecords(found) as GateRecordRow[];
}

/**
 * The step-level checker's flags, one group per flagged solution (FR-4411 →
 * FR-4501), of every maths book: `runs/<book>/working-check/chNN.flags.json`
 * and nothing else in that folder — a calibration copy (`chNN-cal….flags.json`)
 * or a raw run file is a measurement of the checker, not a finding about the
 * book (`canonicalFlagsChapter`). A `chNN.calibration.json` beside a file
 * classes its flags (REAL / REAL-BUT-ELSEWHERE / FALSE, with evidence); it is
 * shown to the reviewer and decides nothing.
 *
 * Never throws: a file that cannot be read or parsed is skipped and logged.
 * Same production caveat as `readGateRecords`: the image carries no `runs/`, so
 * on the box this finds nothing and the backlog has no flagged-step items.
 */
export async function readWorkingFlags(root: string = defaultRunsRoot()): Promise<WorkingFlagGroup[]> {
  const repo = path.resolve(root, "..", "..", "..");
  const rel = (f: string) => path.relative(repo, f).split(path.sep).join("/");
  const out: WorkingFlagGroup[] = [];
  for (const [book, courseId] of mathsBooks()) {
    const dir = path.join(root, book, "working-check");
    const truths = new Set((await list(dir, /^ch\d{1,2}\.calibration\.json$/)).map((f) => path.basename(f)));
    for (const file of await list(dir, /^ch\d{1,2}\.flags\.json$/)) {
      const chapter = canonicalFlagsChapter(path.basename(file));
      if (chapter == null) continue;
      const doc = await readJson(file);
      const parsed = doc && parseFlagsFile(doc.raw, book, chapter);
      if (!parsed) continue;
      // The truth file is named after the FILE's chapter, whatever the flags file says inside.
      const calibrationPath = path.join(dir, calibrationFileFor(chapter));
      const cal = truths.has(calibrationFileFor(chapter)) ? await readJson(calibrationPath) : null;
      const calibration = cal ? parseCalibration(cal.raw) : null;
      out.push(...groupFlags(parsed, courseId, rel(file), calibration, calibration ? rel(calibrationPath) : null));
    }
  }
  return out;
}

/**
 * A flagged solution's fingerprint: the solution's own text (hashed in SQL —
 * stem, key, working, options) with what the checker flagged in it. A reload
 * or a correction that changes the text, or a re-run that flags something
 * else, puts a decided item back in front of a reviewer; a re-run that words
 * the same finding differently does not (`flagsKey`).
 */
export function workingFlagFingerprint(solutionHash: string, flags: readonly Pick<WorkingFlag, "step" | "kind" | "where" | "quote">[]): string {
  return createHash("md5").update(`${solutionHash}\u001f${flagsKey(flags)}`).digest("hex");
}

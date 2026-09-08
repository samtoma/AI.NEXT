/**
 * Explanation / refutation library lookup (FR-304, FR-305).
 *
 * The PRD's central teaching bet: when a student gets something wrong, the
 * tutor should not re-derive an explanation — it should serve content authored
 * ahead of time for that specific misconception. This module is the read side
 * of that. Entries are RETRIEVED, never generated at request time.
 *
 * ⚠️  Constitution v2.0.0 Principle III is SUSPENDED for these rows in this
 * environment only (ADR-0007, decisions.md Q8): they are pipeline-generated and
 * ship without human review, flagged `reviewed = false` and attributed. That is
 * why `reviewed` travels with every entry all the way to the analytics event —
 * so we can always answer "how much unreviewed teaching did students actually
 * see", not merely "how much exists".
 */

import { pool } from "@/lib/db";

export type EntryType =
  | "worked_example"
  | "faded"
  | "contrasting_case"
  | "refutation";

export type LibraryEntry = {
  id: string;
  loId: string;
  misconceptionId: string | null;
  entryType: EntryType;
  content: unknown;
  sourcePage: number | null;
  reviewed: boolean;
};

export type Misconception = {
  id: string;
  loId: string;
  label: string;
  description: string;
  signal: string | null;
};

/** Known misconceptions for a set of learning objectives. */
export async function getMisconceptions(
  loIds: readonly string[]
): Promise<Misconception[]> {
  if (loIds.length === 0) return [];
  try {
    const res = await pool.query(
      `SELECT id, lo_id, label, description, signal
         FROM misconceptions WHERE lo_id = ANY($1) ORDER BY id`,
      [loIds]
    );
    return res.rows.map((r) => ({
      id: r.id as string,
      loId: r.lo_id as string,
      label: r.label as string,
      description: r.description as string,
      signal: (r.signal as string | null) ?? null,
    }));
  } catch (err) {
    console.error("getMisconceptions failed:", err);
    return [];
  }
}

/**
 * Library entries for a set of learning objectives, optionally narrowed to one
 * misconception.
 *
 * Returns [] on any failure rather than throwing. A missing library must
 * degrade to the standard correct explanation (FR-305), never to a failed
 * lesson — and never to the model improvising a refutation, which is the one
 * outcome PRD §8 explicitly forbids.
 */
export async function getLibraryEntries(
  loIds: readonly string[],
  opts: { misconceptionId?: string; entryTypes?: readonly EntryType[] } = {}
): Promise<LibraryEntry[]> {
  if (loIds.length === 0) return [];
  const params: unknown[] = [loIds];
  let sql = `SELECT id, lo_id, misconception_id, entry_type, content, source_page, reviewed
               FROM explanation_library WHERE lo_id = ANY($1)`;
  if (opts.misconceptionId) {
    params.push(opts.misconceptionId);
    sql += ` AND misconception_id = $${params.length}`;
  }
  if (opts.entryTypes?.length) {
    params.push(opts.entryTypes);
    sql += ` AND entry_type = ANY($${params.length})`;
  }
  sql += " ORDER BY lo_id, entry_type, id";

  try {
    const res = await pool.query(sql, params);
    return res.rows.map((r) => ({
      id: r.id as string,
      loId: r.lo_id as string,
      misconceptionId: (r.misconception_id as string | null) ?? null,
      entryType: r.entry_type as EntryType,
      content: r.content,
      sourcePage: (r.source_page as number | null) ?? null,
      reviewed: Boolean(r.reviewed),
    }));
  } catch (err) {
    console.error("getLibraryEntries failed:", err);
    return [];
  }
}

/**
 * Record that a misconception was detected with no authored refutation behind it
 * (FR-305, PRD §8). The tutor still teaches — it gives the standard correct
 * explanation — but the gap is logged so the content pipeline can close it.
 *
 * This is the honest alternative to the failure mode the PRD names: inventing a
 * novel refutation and presenting it as settled.
 */
export async function flagAuthoringGap(
  studentId: number,
  misconceptionId: string | null
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO safety_flags (student_id, flag_type) VALUES ($1, 'misconception_gap')`,
      [studentId]
    );
    console.warn(
      `[library] authoring gap: no refutation for ${misconceptionId ?? "an undiagnosed error"}`
    );
  } catch (err) {
    console.error("flagAuthoringGap failed:", err);
  }
}

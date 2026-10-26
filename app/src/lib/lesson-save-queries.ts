import { withPrincipal } from "@/lib/db";
import { ENVIRONMENT } from "@/lib/env";
import type { SavePayload, SavedSession } from "@/lib/lesson-resume";
import type { LessonMode } from "@/lib/types";

/**
 * `lesson_saves` (migration 042) — the database seam for FR-204 / #25.
 *
 * Every function takes the student id the ROUTE resolved from the session and
 * runs under `withPrincipal`, so the table's forced RLS policy scopes the
 * statement to that student in USING and WITH CHECK: a wrong id reads nothing
 * and writes nothing for another child. The `student_id = $1` predicates are
 * belt to that policy's braces. Every statement binds `environment`
 * (FR-2109): a save never crosses stacks.
 */

export async function getLessonSave(
  studentId: number,
  mode: LessonMode,
  slug: string
): Promise<SavedSession | null> {
  return withPrincipal(studentId, async (c) => {
    const r = await c.query<{ payload: SavePayload; at: string }>(
      `SELECT payload, (extract(epoch FROM updated_at) * 1000)::bigint::text AS at
         FROM lesson_saves
        WHERE student_id = $1 AND environment = $2 AND mode = $3 AND lesson_slug = $4`,
      [studentId, ENVIRONMENT, mode, slug]
    );
    const row = r.rows[0];
    return row ? { ...row.payload, at: Number(row.at) } : null;
  });
}

/** Upsert — the most recent save wins; `updated_at` is the server's clock. Returns its `at`. */
export async function putLessonSave(
  studentId: number,
  mode: LessonMode,
  slug: string,
  save: SavePayload
): Promise<number> {
  return withPrincipal(studentId, async (c) => {
    const r = await c.query<{ at: string }>(
      `INSERT INTO lesson_saves (student_id, environment, mode, lesson_slug, payload_version, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (student_id, environment, mode, lesson_slug) DO UPDATE
          SET payload_version = EXCLUDED.payload_version,
              payload         = EXCLUDED.payload,
              updated_at      = clock_timestamp()
       RETURNING (extract(epoch FROM updated_at) * 1000)::bigint::text AS at`,
      [studentId, ENVIRONMENT, mode, slug, save.v, JSON.stringify(save)]
    );
    return Number(r.rows[0].at);
  });
}

/** Start over, or the lesson is complete. Deleting nothing is not an error. */
export async function deleteLessonSave(
  studentId: number,
  mode: LessonMode,
  slug: string
): Promise<void> {
  await withPrincipal(studentId, (c) =>
    c.query(
      `DELETE FROM lesson_saves
        WHERE student_id = $1 AND environment = $2 AND mode = $3 AND lesson_slug = $4`,
      [studentId, ENVIRONMENT, mode, slug]
    )
  );
}

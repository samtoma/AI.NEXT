/**
 * The student's own settings — name, grade, curriculum, and deleting the
 * account (FR-2013, FR-4010 as amended 2026-10-27, FR-2310; migration 043).
 *
 * Every write is one of migration 043's definer functions, called under the
 * student's own principal. `ainext_app` still holds UPDATE on exactly one
 * `students` column (033, `curriculum-privilege.test.mts`), so nothing in this
 * file may `UPDATE students` directly, and nothing does.
 *
 * WHAT HAPPENS TO PROGRESS (Tamer, 2026-10-27): progress belongs to the course
 * it was earned in, and a course belongs to one curriculum and one grade. So a
 * curriculum change and a grade change both leave every attempt, mastery
 * estimate and saved place where it is (FR-4011). The courses she now sees
 * show their own progress, which is none for a course she has never opened,
 * and changing back shows the old progress exactly as she left it.
 */

import { rm } from "node:fs/promises";
import path from "node:path";

import { authPool, withPrincipal } from "./db";
import { canonicalGrade, resolveOnGradeChange, type CurriculumSource } from "./catalog";
import { asCurriculumId, type CurriculumId } from "./curricula";
import { isValidGrade } from "./profile";

/** The sign-up rule (`api/auth/signup`), so the two cannot disagree. */
export const NAME_MIN = 2;
export const NAME_MAX = 40;

export function validDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return name.length >= NAME_MIN && name.length <= NAME_MAX ? name : null;
}

/* ------------------------------------------------------------------ */
/* Name and grade (FR-2013, FR-4008)                                   */
/* ------------------------------------------------------------------ */

export type ProfileResult =
  | {
      ok: true;
      /** the curriculum moved because it was implied and the grade re-resolved it */
      reresolvedTo: CurriculumId | null;
      /** a chosen curriculum the new grade has nothing live for (FR-4008) */
      curriculumNotOffered: boolean;
    }
  | { ok: false; reason: "invalid_display_name" | "invalid_grade" };

/**
 * FR-4008 decides what a grade change does to the curriculum; this applies
 * it. `resolveOnGradeChange` needs the live course rules, which the database
 * function cannot read, so the application decides and the function refuses
 * to re-resolve anything but an implied curriculum.
 */
export async function updateOwnProfile(
  studentId: number,
  input: { displayName?: unknown; grade?: unknown },
  /** what a grade offers (`offeredCurriculaFor`), read by the route — FR-4008 needs it */
  offeredFor: (grade: string) => Promise<readonly CurriculumId[]>
): Promise<ProfileResult> {
  const name = validDisplayName(input.displayName);
  if (!name) return { ok: false, reason: "invalid_display_name" };
  if (!isValidGrade(input.grade)) return { ok: false, reason: "invalid_grade" };
  const grade = canonicalGrade(String(input.grade)) as string;
  const offered = await offeredFor(grade);

  return withPrincipal(studentId, async (db) => {
    const cur = await db.query(
      `SELECT curriculum_system, curriculum_source FROM students WHERE id = $1`,
      [studentId]
    );
    const row = cur.rows[0] as { curriculum_system: string; curriculum_source: string } | undefined;
    const source: CurriculumSource = row?.curriculum_source === "chosen" ? "chosen" : "implied";
    const next = resolveOnGradeChange({ curriculum: row?.curriculum_system, source }, offered);
    const reresolveTo = next.changed ? asCurriculumId(next.curriculum) : null;
    await db.query(`SELECT update_own_profile($1, $2, $3)`, [name, grade, reresolveTo]);
    return {
      ok: true,
      reresolvedTo: reresolveTo,
      curriculumNotOffered: next.flagged,
    } as const;
  });
}

/* ------------------------------------------------------------------ */
/* The curriculum (FR-4010 amended, FR-4011, FR-4012)                   */
/* ------------------------------------------------------------------ */

export type OwnCurriculumResult =
  | { ok: true; changed: boolean; curriculum: CurriculumId }
  | { ok: false; reason: "unknown_curriculum" };

/**
 * Any curriculum the registry knows, as at sign-up (`resolveInitialCurriculum`):
 * one with nothing live for her grade yet is still a valid choice, and the
 * page says so before she makes it.
 */
export async function changeOwnCurriculum(
  studentId: number,
  curriculum: unknown
): Promise<OwnCurriculumResult> {
  const to = asCurriculumId(curriculum);
  if (!to) return { ok: false, reason: "unknown_curriculum" };
  const changed = await withPrincipal(studentId, async (db) => {
    const res = await db.query(`SELECT change_own_curriculum($1) AS changed`, [to]);
    return res.rows[0]?.changed === true;
  });
  return { ok: true, changed, curriculum: to };
}

/* ------------------------------------------------------------------ */
/* Deleting the account (FR-2310)                                      */
/* ------------------------------------------------------------------ */

/** Whether deleting must ask for a password: a Google-only account has none. */
export async function accountHasPassword(accountId: number): Promise<boolean> {
  const res = await authPool().query(
    `SELECT password_hash IS NOT NULL AS has_password FROM accounts WHERE id = $1`,
    [accountId]
  );
  return res.rows[0]?.has_password === true;
}

/** What she types to confirm a deletion. Plain, and the same in every build. */
export const DELETE_PHRASE = "DELETE";

/**
 * Remove the student, her interaction record and her account in one
 * transaction (`delete_own_account`, migration 043), then her uploaded files.
 *
 * The files go AFTER the commit: a failed transaction must not leave a
 * student whose worksheets are gone. A file that cannot be removed is logged
 * and left; the row that pointed at it is already gone, so nothing can serve
 * it. Only paths under the upload root are touched, whatever the row said.
 */
export async function deleteOwnAccount(studentId: number): Promise<void> {
  const files = await withPrincipal(studentId, async (db) => {
    const res = await db.query(`SELECT delete_own_account() AS files`);
    return (res.rows[0]?.files as string[] | null) ?? [];
  });
  const root = path.resolve(
    process.env.AINEXT_UPLOAD_DIR ?? path.join(process.env.TMPDIR ?? "/tmp", "ainext-uploads")
  );
  for (const f of files) {
    const abs = path.resolve(root, f);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      console.error("[settings] upload path outside the upload root, left alone:", f);
      continue;
    }
    try {
      await rm(abs, { force: true });
    } catch (err) {
      console.error("[settings] could not remove an upload of a deleted account:", err);
    }
  }
  // `saveUpload` keeps each student's files in a folder named by her id.
  await rm(path.join(root, String(studentId)), { recursive: true, force: true }).catch((err) =>
    console.error("[settings] could not remove a deleted account's upload folder:", err)
  );
}

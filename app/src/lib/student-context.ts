import { cookies } from "next/headers";
import { pool } from "./db";
import {
  DEFAULT_STUDENT_ID,
  DEMO_STUDENT_COOKIE,
  pickStudentId,
  type DemoStudent,
} from "./demo-student";

/**
 * Server-side resolution of "which demo student am I looking at" — the half
 * that touches `next/headers` and the database.
 *
 * ⚠️  DEMO AFFORDANCE, NOT AUTH — see the header of `demo-student.ts`. ⚠️
 * The cookie is never trusted: every request re-reads the (tiny) `students`
 * table and only honours an id that exists. Unknown / malformed / missing →
 * the default demo student. This function must NEVER throw: a broken cookie
 * is a demo inconvenience, not a 500.
 */

export { DEFAULT_STUDENT_ID, DEMO_STUDENT_COOKIE };
export type { DemoStudent };

/**
 * The seeded demo cast, with the live counters the switcher shows so it is
 * obvious which student tells which story (0 attempts = the cold start).
 */
export async function listDemoStudents(): Promise<DemoStudent[]> {
  try {
    // avg_mastery uses the SAME definition as every other surface: the mean
    // over ALL learning objectives, with an un-practised LO counting as 0.
    // (Dividing by the student's own mastery rows would flatter a student who
    // has only ever touched three topics — and would disagree with /spine.)
    const res = await pool.query(
      `SELECT s.id, s.display_name, s.grade,
              (SELECT count(*) FROM attempts a WHERE a.student_id = s.id)     AS attempts,
              (SELECT count(*) FROM mastery m
                WHERE m.student_id = s.id AND m.system_to IS NULL)            AS mastery_rows,
              (SELECT coalesce(sum(m.score), 0) FROM mastery m
                WHERE m.student_id = s.id AND m.system_to IS NULL)
                / greatest((SELECT count(*) FROM graph_nodes
                             WHERE kind = 'learning_objective'), 1)           AS avg_mastery
       FROM students s
       ORDER BY s.id`
    );
    return res.rows.map((r) => ({
      id: Number(r.id),
      displayName: r.display_name as string,
      grade: r.grade as string,
      attempts: Number(r.attempts),
      masteryRows: Number(r.mastery_rows),
      avgMastery: Number(r.avg_mastery),
    }));
  } catch (err) {
    console.error("listDemoStudents failed:", err);
    return [];
  }
}

/** The raw cookie value (server components + route handlers alike). */
async function rawCookie(): Promise<string | null> {
  try {
    const jar = await cookies();
    return jar.get(DEMO_STUDENT_COOKIE)?.value ?? null;
  } catch {
    return null; // no request scope (build-time render) → default student
  }
}

/**
 * The resolved student id for this request. Validated against `students`;
 * falls back to the default demo student on anything unexpected.
 */
export async function resolveStudentId(): Promise<number> {
  const [raw, students] = await Promise.all([rawCookie(), listDemoStudents()]);
  return pickStudentId(
    raw,
    students.map((s) => s.id)
  );
}

/** id + name + the full cast, for surfaces that render the switcher. */
export async function resolveStudentContext(): Promise<{
  studentId: number;
  studentName: string;
  students: DemoStudent[];
}> {
  const [raw, students] = await Promise.all([rawCookie(), listDemoStudents()]);
  const studentId = pickStudentId(
    raw,
    students.map((s) => s.id)
  );
  return {
    studentId,
    studentName:
      students.find((s) => s.id === studentId)?.displayName ?? "Demo student",
    students,
  };
}

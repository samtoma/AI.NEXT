/**
 * The retrieval layer (FR-303).
 *
 * The PRD names this as "the piece that doesn't exist yet": the step that turns
 * "a student asked a question" into "a student asked a question, and here is
 * their mastery on the nearest skills, their grade, their language preference,
 * and the reviewed library entry for the likely misconception."
 *
 * Before this module, grounding was assembled separately inside `lib/ask.ts`
 * and `lib/lesson.ts`. Both still build the curriculum slice they always built —
 * that machinery works and is proven byte-identical by the capture harness — and
 * this module composes the STUDENT-MODEL half around it in one auditable place.
 * The point is that "what did the model actually see?" becomes one function call
 * to inspect rather than two files to reconstruct.
 *
 * Everything here degrades rather than throws. A tutor turn that loses the
 * student's profile should teach a colder lesson, not fail — and FR-203 already
 * requires the tutor to skip interest-anchored framing when it has no signal,
 * so "no signal" is a supported state, not an error.
 */

import { pool } from "@/lib/db";
import { getStudentProfile, type StudentProfile } from "@/lib/student-context";
import {
  getLibraryEntries,
  getMisconceptions,
  type LibraryEntry,
  type Misconception,
} from "@/lib/explanations";

/** How many nearby skills carry their mastery into the prompt. */
const NEAREST_SKILLS = 5;

export type SkillMastery = {
  loId: string;
  label: string;
  /** P(L) — the BKT belief, not an Elo score */
  mastery: number;
};

export type RetrievalBundle = {
  profile: StudentProfile | null;
  nearestSkills: SkillMastery[];
  misconceptions: Misconception[];
  libraryEntries: LibraryEntry[];
};

/**
 * Mastery on the focus skills plus their immediate prerequisites — "the three
 * nearest skills" the PRD asks for, generalised to NEAREST_SKILLS.
 *
 * Prerequisites are included because that is where an unexplained failure
 * usually lives: a student getting factorisation wrong often has a gap one edge
 * upstream, and a tutor that cannot see that will keep re-teaching the wrong
 * thing.
 */
async function nearestSkillMastery(
  studentId: number,
  focusLoIds: readonly string[]
): Promise<SkillMastery[]> {
  if (focusLoIds.length === 0) return [];
  try {
    const res = await pool.query(
      `WITH focus AS (
         SELECT unnest($2::text[]) AS lo_id
       ),
       neighbourhood AS (
         SELECT lo_id FROM focus
         UNION
         SELECT e.src_id FROM graph_edges e
           JOIN focus f ON f.lo_id = e.dst_id
          WHERE e.edge_type = 'prerequisite_of'
       )
       SELECT n.id AS lo_id, n.label,
              coalesce(m.score, 0) AS mastery
         FROM neighbourhood h
         JOIN graph_nodes n ON n.id = h.lo_id
         LEFT JOIN mastery m
           ON m.lo_id = n.id AND m.student_id = $1 AND m.system_to IS NULL
        ORDER BY mastery ASC, n.id
        LIMIT ${NEAREST_SKILLS}`,
      [studentId, [...focusLoIds]]
    );
    return res.rows.map((r) => ({
      loId: r.lo_id as string,
      label: r.label as string,
      mastery: Number(r.mastery),
    }));
  } catch (err) {
    console.error("nearestSkillMastery failed:", err);
    return [];
  }
}

/**
 * Compose everything the model is allowed to know about THIS student for THIS
 * turn. Nothing ungrounded enters here: every field is read from the store.
 */
export async function retrieve(
  studentId: number,
  focusLoIds: readonly string[],
  opts: { misconceptionId?: string } = {}
): Promise<RetrievalBundle> {
  const [profile, nearestSkills, misconceptions, libraryEntries] =
    await Promise.all([
      getStudentProfile(studentId),
      nearestSkillMastery(studentId, focusLoIds),
      getMisconceptions(focusLoIds),
      getLibraryEntries(focusLoIds, { misconceptionId: opts.misconceptionId }),
    ]);
  return { profile, nearestSkills, misconceptions, libraryEntries };
}

/**
 * Render the bundle as a prompt block.
 *
 * Returns "" when there is nothing to say. That matters more than it looks: an
 * empty string keeps the assembled prompt byte-identical to what it was before
 * this layer existed, so a student with no profile and no library produces the
 * exact same prompt as the baseline. The capture harness can then attribute any
 * diff to real retrieved content rather than to added scaffolding.
 */
export function retrievalBlock(b: RetrievalBundle): string {
  const parts: string[] = [];

  if (b.profile) {
    const p = b.profile;
    const bits = [`grade ${p.grade}`, `language ${p.languagePref}`];
    if (p.interests.length) {
      bits.push(`interests: ${p.interests.join(", ")}`);
      if (p.interestDetail) {
        bits.push(`interest detail: ${JSON.stringify(p.interestDetail)}`);
      }
    }
    parts.push(
      `STUDENT MODEL (retrieved — never invent beyond this):\n- ${bits.join("\n- ")}\n` +
        `- If no interest is listed above, do NOT frame explanations around an ` +
        `invented interest; teach plainly instead.`
    );
  }

  if (b.nearestSkills.length) {
    const rows = b.nearestSkills
      .map(
        (s) =>
          `- ${s.loId} | "${s.label}" | mastery ${Math.round(s.mastery * 100)}%`
      )
      .join("\n");
    parts.push(
      `NEAREST SKILLS BY MASTERY (weakest first — P(L) from Bayesian Knowledge Tracing):\n${rows}`
    );
  }

  if (b.misconceptions.length) {
    const rows = b.misconceptions
      .map((m) => `- ${m.id} | ${m.label} — ${m.description}`)
      .join("\n");
    parts.push(
      `KNOWN MISCONCEPTIONS for these skills:\n${rows}\n` +
        `Diagnose against this list. If the student's error is not on it, say so ` +
        `plainly rather than asserting a diagnosis you cannot support.`
    );
  }

  if (b.libraryEntries.length) {
    const rows = b.libraryEntries
      .map(
        (e) =>
          `- ${e.id} | ${e.entryType}` +
          (e.misconceptionId ? ` | answers ${e.misconceptionId}` : "") +
          (e.sourcePage != null ? ` | book p.${e.sourcePage}` : "") +
          `\n  ${JSON.stringify(e.content)}`
      )
      .join("\n");
    parts.push(
      `AUTHORED EXPLANATION LIBRARY (teach FROM these — never improvise a ` +
        `refutation at request time):\n${rows}\n` +
        `If none of the above fits the student's actual error, give the standard ` +
        `correct explanation from the canonical solution instead. Do not invent a ` +
        `new refutation and present it as settled.`
    );
  }

  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

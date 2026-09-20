import { NextResponse } from "next/server";
import { AuthError, requireStudent } from "@/lib/auth/principal";
import { getTopicBreakdown } from "@/lib/dashboard";

/**
 * Per-topic performance (FR-401).
 *
 * Returns topics only. There is deliberately no `overall` field: the
 * requirement is that performance is never presented as a single blended
 * number, and the cheapest way to guarantee that is not to compute one.
 *
 * Whose topics is not a question this route answers — `requireStudent()` does,
 * from the access cookie. There is no student id in the request to override,
 * and the breakdown runs under that principal, so the second account in the
 * red-team script gets its own empty dashboard rather than the first's.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  let me;
  try {
    me = await requireStudent();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
  // No verification gate here: reading your own progress is not learning, and
  // FR-2004 scopes the gate to the surfaces that teach.
  const topics = await getTopicBreakdown(me.studentId);
  return NextResponse.json({ topics });
}

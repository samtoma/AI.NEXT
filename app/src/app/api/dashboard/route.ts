import { NextResponse } from "next/server";
import { resolveStudentId } from "@/lib/student-context";
import { getTopicBreakdown } from "@/lib/dashboard";

/**
 * Per-topic performance (FR-401).
 *
 * Returns topics only. There is deliberately no `overall` field: the
 * requirement is that performance is never presented as a single blended
 * number, and the cheapest way to guarantee that is not to compute one.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const studentId = await resolveStudentId();
  const topics = await getTopicBreakdown(studentId);
  return NextResponse.json({ topics });
}

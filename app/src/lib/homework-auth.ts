import { NextResponse } from "next/server";
import { AuthError, requireStudent } from "@/lib/auth/principal";

/**
 * The homework routes' shared gate: a signed-in student with a confirmed
 * address (FR-2004 — homework help is learning). Returns the student id, or
 * the response to send instead.
 */
export async function homeworkStudent(): Promise<number | NextResponse> {
  let me;
  try {
    me = await requireStudent();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
  if (!me.emailVerified) {
    return NextResponse.json({ error: "email_unverified" }, { status: 403 });
  }
  return me.studentId;
}

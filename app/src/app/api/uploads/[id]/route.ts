import { NextResponse } from "next/server";
import { resolveStudentId } from "@/lib/student-context";
import { getParsedUpload } from "@/lib/uploads";

/**
 * Upload status (FR-205).
 *
 * `unreadable` is a distinct state from `failed`, and the copy differs because
 * the right next action differs: an unreadable photo needs retyping or
 * reshooting, a failed one needs a retry. Collapsing them would tell a student
 * to retry an upload that will fail identically every time.
 */
export const dynamic = "force-dynamic";

const COPY: Record<string, string> = {
  pending: "Reading your upload…",
  parsed: "Got it.",
  unreadable:
    "I couldn't read that clearly enough to work from. Could you retype the question, or take the photo again in better light?",
  failed: "Something went wrong reading that file. Want to try again?",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const uploadId = Number(id);
  if (!Number.isInteger(uploadId) || uploadId <= 0) {
    return NextResponse.json({ error: "bad upload id" }, { status: 400 });
  }

  const studentId = await resolveStudentId();
  // Scoped to the resolved student: one pilot student must not be able to read
  // another's uploaded work by guessing an id.
  const row = await getParsedUpload(uploadId, studentId);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    uploadId,
    parseStatus: row.status,
    message: COPY[row.status] ?? COPY.failed,
    // The transcription itself is never returned to the client: it goes to the
    // retrieval layer server-side. Handing it back would invite a client to
    // treat it as the answer.
    hasText: Boolean(row.text),
  });
}

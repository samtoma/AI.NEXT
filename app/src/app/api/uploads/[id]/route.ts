import { NextResponse } from "next/server";
import { AuthError, requireStudent } from "@/lib/auth/principal";
import { getParsedUpload } from "@/lib/uploads";

/**
 * Upload status (FR-205).
 *
 * `unreadable` is a distinct state from `failed`, and the copy differs because
 * the right next action differs: an unreadable photo needs retyping or
 * reshooting, a failed one needs a retry. Collapsing them would tell a student
 * to retry an upload that will fail identically every time.
 *
 * Somebody else's upload id is a **404**, not a 403 (FR-2103, Samuel's accepted
 * default). Under the policy the row is not filtered out after we read it — it
 * is never returned at all — so this route genuinely cannot distinguish "not
 * yours" from "no such id", and saying 403 would confirm the id exists. Nothing
 * is recorded either: nothing was refused, an id was asked about and the answer
 * was no.
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

  const { id } = await params;
  const uploadId = Number(id);
  if (!Number.isInteger(uploadId) || uploadId <= 0) {
    return NextResponse.json({ error: "bad upload id" }, { status: 400 });
  }

  const row = await getParsedUpload(uploadId, me.studentId);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

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

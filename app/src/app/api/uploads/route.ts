import { NextResponse } from "next/server";
import { withPrincipal } from "@/lib/db";
import { AuthError, requireStudent } from "@/lib/auth/principal";
import { mapRlsError } from "@/lib/rls-errors";
import { emit } from "@/lib/analytics";
import { currentSessionOrNull } from "@/lib/sessions";
import {
  isAccepted,
  storeUpload,
  parseUpload,
  uploadsToday,
  MAX_UPLOAD_BYTES,
  DAILY_UPLOAD_CAP,
} from "@/lib/uploads";

/**
 * Upload intake (PRD B10, FR-205).
 *
 * Returns 202 immediately and parses in the background: a student photographing
 * a worksheet should be back in their lesson at once, not watching a spinner
 * while a model reads their handwriting.
 *
 * Two units of work, with the file write between them — the cap check, the
 * session and the row go in ONE transaction under the student's principal, and
 * `parseUpload` opens its own afterwards because it outlives this request by up
 * to ninety seconds. It is handed the student id for the same reason it is
 * already handed the session: after the response there is no request left to
 * re-derive either from (FR-2105).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let me;
  try {
    me = await requireStudent();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
  // FR-2004: uploading work to be taught from is learning.
  if (!me.emailVerified) {
    return NextResponse.json({ error: "email_unverified" }, { status: 403 });
  }
  const studentId = me.studentId;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file provided" }, { status: 400 });
  }

  // Order matters: type before size. "That file type isn't supported" is a
  // useful message; making someone wait through a 40 MB upload to be told the
  // same thing is not.
  // Held in a const rather than re-read from `file`: the narrowing has to
  // survive into the closure below, and `file.type` is a getter TypeScript
  // will not narrow across one.
  const fileType = file.type;
  if (!isAccepted(fileType)) {
    return NextResponse.json(
      { error: `unsupported file type ${fileType || "unknown"} — JPEG, PNG or PDF only` },
      { status: 415 }
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `file is ${(file.size / 1048576).toFixed(1)} MB — the limit is 10 MB` },
      { status: 413 }
    );
  }

  const sessionId =
    typeof form.get("sessionId") === "string" ? String(form.get("sessionId")) : null;
  const bytes = Buffer.from(await file.arrayBuffer());

  let uploadId: number;
  let sessionRef: number | null;
  try {
    const unit = await withPrincipal(studentId, async (client) => {
      // Cost bound (Principle VI): image tokens are expensive, and an unbounded
      // upload path is the one place this build could quietly outspend the
      // baseline. Counted inside the unit so the count and the insert see the
      // same snapshot — two tabs cannot both read "9" and both write.
      const used = await uploadsToday(studentId, client);
      if (used >= DAILY_UPLOAD_CAP) return { capped: true as const };

      // The learning session this upload belongs to (ADR-0015). A photo taken
      // mid-lesson joins that lesson's sitting (`adoptOpen`); `student_chat` is
      // only the fallback for a photo with no sitting around it — the student
      // is asking about a worksheet, which is what that kind means.
      const ref = await currentSessionOrNull(
        studentId,
        "student_chat",
        {
          surface: "upload_intake",
          clientKey: sessionId ?? undefined,
          adoptOpen: true,
        },
        client
      );
      // The bytes hit the disk inside the unit so a rolled-back row cannot
      // leave an orphaned file the cap never counts.
      const id = await storeUpload(
        studentId,
        sessionId,
        ref,
        fileType,
        bytes,
        client
      );
      return { capped: false as const, uploadId: id, sessionRef: ref };
    });

    if (unit.capped) {
      return NextResponse.json(
        {
          error: `daily upload limit of ${DAILY_UPLOAD_CAP} reached — try again tomorrow`,
        },
        { status: 429 }
      );
    }
    uploadId = unit.uploadId;
    sessionRef = unit.sessionRef;
  } catch (err) {
    const denied = await mapRlsError(err, {
      req,
      actorAccountId: me.accountId,
      targetStudentId: studentId,
      resource: "api/uploads",
    });
    if (denied) return denied;
    console.error("upload POST failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  void emit({
    event: "upload_submitted",
    studentId,
    sessionId,
    sessionRef,
    properties: { file_type: fileType, size_bytes: file.size },
  });

  // Fire-and-forget, in units of its own. The client polls
  // GET /api/uploads/:id for the outcome.
  void parseUpload(uploadId, studentId, sessionRef);

  return NextResponse.json({ uploadId, parseStatus: "pending" }, { status: 202 });
}

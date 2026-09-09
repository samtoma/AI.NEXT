import { NextResponse } from "next/server";
import { resolveStudentId } from "@/lib/student-context";
import { emit } from "@/lib/analytics";
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
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const studentId = await resolveStudentId();

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
  if (!isAccepted(file.type)) {
    return NextResponse.json(
      { error: `unsupported file type ${file.type || "unknown"} — JPEG, PNG or PDF only` },
      { status: 415 }
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `file is ${(file.size / 1048576).toFixed(1)} MB — the limit is 10 MB` },
      { status: 413 }
    );
  }

  // Cost bound (Principle VI): image tokens are expensive, and an unbounded
  // upload path is the one place this build could quietly outspend the baseline.
  if ((await uploadsToday(studentId)) >= DAILY_UPLOAD_CAP) {
    return NextResponse.json(
      { error: `daily upload limit of ${DAILY_UPLOAD_CAP} reached — try again tomorrow` },
      { status: 429 }
    );
  }

  const sessionId = typeof form.get("sessionId") === "string" ? String(form.get("sessionId")) : null;
  const bytes = Buffer.from(await file.arrayBuffer());
  const uploadId = await storeUpload(studentId, sessionId, file.type, bytes);

  void emit({
    event: "upload_submitted",
    studentId,
    sessionId,
    properties: { file_type: file.type, size_bytes: file.size },
  });

  // Fire-and-forget. The client polls GET /api/uploads/:id for the outcome.
  void parseUpload(uploadId);

  return NextResponse.json({ uploadId, parseStatus: "pending" }, { status: 202 });
}

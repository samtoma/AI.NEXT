import { NextResponse } from "next/server";
import { emit } from "@/lib/analytics";
import { createAsk, readAsk } from "@/lib/homework";
import { currentPrincipal, onboardingRefusal } from "@/lib/auth/principal";
import { homeworkStudent } from "@/lib/homework-auth";
import { MAX_TYPED_CHARS, coerceId } from "@/lib/homework-rules";

/**
 * POST /api/homework — "Ask Noor" from the home page (spec 004, FR-3603).
 *
 * Body: `{ text }` for a typed question, or `{ uploadId }` for a file already
 * sent to POST /api/uploads (with an optional `text` note beside it). Returns 202 with the ask id at once; reading the
 * file and splitting it into questions happens after the response
 * (`readAsk`), and the page polls GET /api/homework/:id.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await currentPrincipal();
  // FR-4014: no homework help while the first-Google-sign-in step is owed.
  const pending = onboardingRefusal(me);
  if (pending) return pending;
  const who = homeworkStudent(me);
  if (who instanceof NextResponse) return who;
  const studentId = who;

  let body: { text?: unknown; uploadId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const uploadId = coerceId(body.uploadId);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!uploadId && !text) {
    return NextResponse.json({ error: "text or uploadId is required" }, { status: 400 });
  }
  if (text.length > MAX_TYPED_CHARS) {
    return NextResponse.json({ error: "question too long" }, { status: 413 });
  }

  const askId = await createAsk(studentId, uploadId ? { uploadId, text } : { text });
  if (askId == null) return NextResponse.json({ error: "not_found" }, { status: 404 });

  void emit({
    event: "homework_asked",
    studentId,
    properties: { source: uploadId ? "upload" : "typed" },
  });
  void readAsk(askId, studentId);

  return NextResponse.json({ askId }, { status: 202 });
}

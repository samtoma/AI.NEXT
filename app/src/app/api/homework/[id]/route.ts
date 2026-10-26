import { NextResponse } from "next/server";
import { getAsk, stopAsk } from "@/lib/homework";
import { currentPrincipal, onboardingRefusal } from "@/lib/auth/principal";
import { homeworkStudent } from "@/lib/homework-auth";
import { coerceId } from "@/lib/homework-rules";

/** GET /api/homework/:id — the ask and its questions, for the page's poll. */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentPrincipal();
  // FR-4014: no homework help while the first-Google-sign-in step is owed.
  const pending = onboardingRefusal(me);
  if (pending) return pending;
  const who = homeworkStudent(me);
  if (who instanceof NextResponse) return who;
  const askId = coerceId((await params).id);
  if (!askId) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ask = await getAsk(who, askId);
  if (!ask) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(ask);
}

/**
 * DELETE /api/homework/:id — the page's Stop while Noor is still reading the
 * ask (the photo's transcription and/or the split). The model work is killed
 * and recorded as `stopped` (migration 041); the ask itself stays, at status
 * `stopped`. Answers with the ask as it now stands, so the page can render
 * from it; a Stop that lost the race to a finished reading changes nothing.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentPrincipal();
  const pending = onboardingRefusal(me);
  if (pending) return pending;
  const who = homeworkStudent(me);
  if (who instanceof NextResponse) return who;
  const askId = coerceId((await params).id);
  if (!askId) return NextResponse.json({ error: "bad id" }, { status: 400 });
  // The scoped read is the ownership check: somebody else's ask is a 404.
  const ask = await getAsk(who, askId);
  if (!ask) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (ask.status !== "reading") return NextResponse.json(ask);
  await stopAsk(who, askId);
  // The reader writes `stopped` once its child is dead; answer with that now
  // rather than making the page poll for it.
  return NextResponse.json({ ...ask, status: "stopped" });
}

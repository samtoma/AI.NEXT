import { NextResponse } from "next/server";
import { getAsk } from "@/lib/homework";
import { homeworkStudent } from "@/lib/homework-auth";
import { coerceId } from "@/lib/homework-rules";

/** GET /api/homework/:id — the ask and its questions, for the page's poll. */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await homeworkStudent();
  if (who instanceof NextResponse) return who;
  const askId = coerceId((await params).id);
  if (!askId) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ask = await getAsk(who, askId);
  if (!ask) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(ask);
}

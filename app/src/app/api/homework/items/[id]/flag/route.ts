import { NextResponse } from "next/server";
import { withPrincipal } from "@/lib/db";
import { emit } from "@/lib/analytics";
import { ENVIRONMENT } from "@/lib/env";
import { homeworkStudent } from "@/lib/homework-auth";
import { coerceId } from "@/lib/homework-rules";

/**
 * POST /api/homework/items/:id/flag — "That doesn't look right" (FR-3612).
 *
 * Records the Noor message the student disagreed with, for review. The
 * re-check itself is an ordinary chat turn the page sends alongside this;
 * this row is the review queue's half. ADR-0025: a self-worked answer a
 * student doubts is exactly the thing somebody should look at.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await homeworkStudent();
  if (who instanceof NextResponse) return who;
  const itemId = coerceId((await params).id);
  if (!itemId) return NextResponse.json({ error: "bad id" }, { status: 400 });

  let body: { tutorMessage?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const tutorMessage =
    typeof body.tutorMessage === "string" ? body.tutorMessage.slice(0, 8000) : "";
  if (!tutorMessage) return NextResponse.json({ error: "tutorMessage is required" }, { status: 400 });

  const ok = await withPrincipal(who, async (db) => {
    const r = await db.query(`SELECT 1 FROM homework_items WHERE id = $1`, [itemId]);
    if (r.rowCount === 0) return false;
    await db.query(
      `INSERT INTO homework_flags (student_id, environment, item_id, tutor_message)
       VALUES ($1, $2, $3, $4)`,
      [who, ENVIRONMENT, itemId, tutorMessage]
    );
    return true;
  });
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  void emit({ event: "homework_flagged", studentId: who, properties: {} });
  return NextResponse.json({ ok: true }, { status: 201 });
}

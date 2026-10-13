import { NextResponse } from "next/server";
import { withPrincipal } from "@/lib/db";
import { emit } from "@/lib/analytics";
import { getAsk } from "@/lib/homework";
import { homeworkStudent } from "@/lib/homework-auth";
import {
  applyGapAnswers,
  coerceId,
  coerceMode,
  regapEditedText,
  type Gap,
} from "@/lib/homework-rules";

/**
 * PATCH /api/homework/items/:id — what the student does to one question.
 *
 *   { action: "gaps",   answers: string[] }   fill the ▒▒ marks (FR-3606)
 *   { action: "text",   text: string }        "Edit the text" (FR-3607)
 *   { action: "select", mode: "walk"|"check" } start it; any other active
 *                                              question in the ask goes back
 *                                              to open (FR-3608, FR-3609)
 *   { action: "done" }                        the walkthrough ended (FR-3611)
 *
 * Every read and write is under the student's principal, so another student's
 * item id is simply not found. Answers with the whole ask, so the page renders
 * from one shape.
 */
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await homeworkStudent();
  if (who instanceof NextResponse) return who;
  const studentId = who;
  const itemId = coerceId((await params).id);
  if (!itemId) return NextResponse.json({ error: "bad id" }, { status: 400 });

  let body: { action?: unknown; answers?: unknown; text?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const result = await withPrincipal(studentId, async (db) => {
    const r = await db.query(
      `SELECT ask_id, text, gaps, subject, status FROM homework_items WHERE id = $1`,
      [itemId]
    );
    if (r.rowCount === 0) return { status: 404 as const };
    const row = r.rows[0];
    const gaps = (row.gaps ?? []) as Gap[];

    switch (body.action) {
      case "gaps": {
        const next = applyGapAnswers(gaps, body.answers);
        if (!next) return { status: 400 as const };
        await db.query(`UPDATE homework_items SET gaps = $2 WHERE id = $1`, [itemId, JSON.stringify(next)]);
        break;
      }
      case "text": {
        if (typeof body.text !== "string") return { status: 400 as const };
        const next = regapEditedText(body.text, gaps);
        if (!next) return { status: 400 as const };
        await db.query(
          `UPDATE homework_items SET text = $2, gaps = $3, edited = true WHERE id = $1`,
          [itemId, next.text, JSON.stringify(next.gaps)]
        );
        break;
      }
      case "select": {
        const mode = coerceMode(body.mode);
        if (!mode || row.subject !== "maths") return { status: 400 as const };
        await db.query(
          `UPDATE homework_items SET status = 'open'
            WHERE ask_id = $1 AND id <> $2 AND status = 'active'`,
          [row.ask_id, itemId]
        );
        await db.query(
          `UPDATE homework_items
              SET mode = $2, status = CASE WHEN status = 'done' THEN 'done' ELSE 'active' END
            WHERE id = $1`,
          [itemId, mode]
        );
        break;
      }
      case "done": {
        await db.query(
          `UPDATE homework_items SET status = 'done', done_at = coalesce(done_at, now()) WHERE id = $1`,
          [itemId]
        );
        break;
      }
      default:
        return { status: 400 as const };
    }
    return { status: 200 as const, askId: Number(row.ask_id) };
  });

  if (result.status !== 200) {
    return NextResponse.json({ error: result.status === 404 ? "not_found" : "bad request" }, { status: result.status });
  }
  if (body.action === "done") {
    void emit({ event: "homework_question_done", studentId, properties: {} });
  }
  return NextResponse.json(await getAsk(studentId, result.askId));
}

import { NextResponse } from "next/server";

import { AuthError, requireStudent } from "@/lib/auth/principal";
import {
  MAX_SAVE_BYTES,
  isSaveTarget,
  validateSavePayload,
} from "@/lib/lesson-resume";
import {
  deleteLessonSave,
  getLessonSave,
  putLessonSave,
} from "@/lib/lesson-save-queries";
import type { LessonMode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/lesson-save/:mode/:slug — where the signed-in student left this lesson
 * (FR-204, issue #25, migration 042).
 *
 *   GET     → `{ save }`, the save or `null`
 *   PUT     → upsert; body is `lib/lesson-resume.ts` SavePayload → `{ at }`
 *   DELETE  → Start over, or the lesson is complete → 204
 *
 * WHOSE SAVE. The student id comes from `requireStudent()` — the verified
 * session — and never from the path or the body; the body carries no id field
 * and `validateSavePayload` copies only the resume fields, so one sent anyway
 * is dropped. Every query runs under `withPrincipal`, so the table's forced RLS
 * policy refuses another child's row even if this file were wrong.
 *
 * SIZE. The body is refused above MAX_SAVE_BYTES before it is parsed.
 */

type Ctx = { params: Promise<{ mode: string; slug: string }> };

async function resolve(ctx: Ctx): Promise<
  | { ok: true; studentId: number; mode: LessonMode; slug: string }
  | { ok: false; res: Response }
> {
  let me;
  try {
    me = await requireStudent();
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, res: err.toResponse() };
    throw err;
  }
  const { mode, slug } = await ctx.params;
  if (!isSaveTarget(mode, slug)) {
    return { ok: false, res: NextResponse.json({ error: "bad_lesson" }, { status: 400 }) };
  }
  return { ok: true, studentId: me.studentId, mode: mode as LessonMode, slug };
}

export async function GET(_req: Request, ctx: Ctx) {
  const who = await resolve(ctx);
  if (!who.ok) return who.res;
  const save = await getLessonSave(who.studentId, who.mode, who.slug);
  return NextResponse.json({ save }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request, ctx: Ctx) {
  const who = await resolve(ctx);
  if (!who.ok) return who.res;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_SAVE_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_SAVE_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const v = validateSavePayload(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const at = await putLessonSave(who.studentId, who.mode, who.slug, v.save);
  return NextResponse.json({ at });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const who = await resolve(ctx);
  if (!who.ok) return who.res;
  await deleteLessonSave(who.studentId, who.mode, who.slug);
  return new Response(null, { status: 204 });
}

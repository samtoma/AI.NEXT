import { NextResponse } from "next/server";
import { AuthError, requireStudent } from "@/lib/auth/principal";
import { getVisualById, getVisualsForLo } from "@/lib/visuals";

export const dynamic = "force-dynamic";

/**
 * GET /api/visuals?lo=lo:u1-1-2 → visuals attached to that LO.
 * GET /api/visuals?id=v:geo1-1:001 → one stored visual ({{widget:viz_ref:…}}).
 *
 * `visuals` is CONTENT — curriculum, not student data — so it carries no
 * policy and this route opens no unit of work. It still refuses anonymous
 * callers: the figure library is the reviewed output of the extraction
 * pipeline, and there is no reason for it to be readable by anyone who has not
 * signed in. RLS would not have caught that, which is exactly why it is stated
 * here rather than assumed.
 */
export async function GET(req: Request) {
  try {
    await requireStudent();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const params = new URL(req.url).searchParams;
  const id = params.get("id");
  const lo = params.get("lo");

  if (id) {
    if (id.length > 120) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    try {
      const visual = await getVisualById(id);
      if (!visual) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      return NextResponse.json({ visual });
    } catch {
      return NextResponse.json({ error: "query failed" }, { status: 500 });
    }
  }

  if (!lo || lo.length > 120) {
    return NextResponse.json(
      { error: "lo or id query param required" },
      { status: 400 }
    );
  }
  try {
    const visuals = await getVisualsForLo(lo);
    return NextResponse.json({ visuals });
  } catch {
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}

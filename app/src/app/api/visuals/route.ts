import { NextResponse } from "next/server";
import { AuthError, requireStudent } from "@/lib/auth/principal";
import { resolveStudentGraphScope } from "@/lib/catalog-queries";
import { getVisualById, getVisualsForLo } from "@/lib/visuals";

export const dynamic = "force-dynamic";

/**
 * GET /api/visuals?lo=lo:u1-1-2 → visuals attached to that LO.
 * GET /api/visuals?id=v:geo1-1:001 → one stored visual ({{widget:viz_ref:…}}).
 *
 * `visuals` is CONTENT — curriculum, not student data — so it carries no
 * policy. It still refuses anonymous callers: the figure library is the
 * reviewed output of the extraction pipeline, and there is no reason for it to
 * be readable by anyone who has not signed in. RLS would not have caught that,
 * which is exactly why it is stated here rather than assumed.
 *
 * THE COURSE GATE (003; privacy review §5 item 4). It also used to serve ANY
 * figure to any signed-in student — a hidden course's diagrams, or another
 * curriculum's, by id. A figure is served now only when its objective belongs
 * to a course this student may see (the student scope, `lib/catalog-queries.ts`).
 * A refused figure answers exactly as one that does not exist: 404 for `?id=`,
 * an empty list for `?lo=` (FR-2706 — hidden and absent are one answer).
 */
export async function GET(req: Request) {
  let me;
  try {
    me = await requireStudent();
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
      const scope = visual ? await resolveStudentGraphScope(me.studentId) : null;
      if (!visual || !scope?.lo(visual.loId)) {
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
    const scope = await resolveStudentGraphScope(me.studentId);
    const visuals = scope.lo(lo) ? await getVisualsForLo(lo) : [];
    return NextResponse.json({ visuals });
  } catch {
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getVisualById, getVisualsForLo } from "@/lib/visuals";

export const dynamic = "force-dynamic";

/**
 * GET /api/visuals?lo=lo:u1-1-2 → visuals attached to that LO.
 * GET /api/visuals?id=v:geo1-1:001 → one stored visual ({{widget:viz_ref:…}}).
 */
export async function GET(req: Request) {
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
        return NextResponse.json({ error: "not found" }, { status: 404 });
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

import { NextResponse } from "next/server";
import { emit, isClientEmittable } from "@/lib/analytics";
import { resolveStudentId } from "@/lib/student-context";

/**
 * Client event sink (FR-801).
 *
 * Server-side events are emitted directly through lib/analytics.ts and do not
 * travel through this route. This exists only for interactions the server never
 * sees — a step scrolled into view, a button tapped, a tab closed.
 *
 * Two things a client may NOT do here, both for comparison integrity (FR-901):
 *   1. set `environment` — it is stamped server-side from configuration;
 *   2. emit an arbitrary event name — only the allow-list in lib/analytics.ts,
 *      so a stray or malicious client cannot fabricate the funnel events the
 *      comparison metric is computed from.
 */
export async function POST(req: Request) {
  let body: { event?: string; sessionId?: string; properties?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { event, sessionId, properties } = body;
  if (typeof event !== "string" || !isClientEmittable(event)) {
    return NextResponse.json(
      { error: "unknown or non-client-emittable event" },
      { status: 400 }
    );
  }

  const studentId = await resolveStudentId();

  await emit({
    event,
    studentId,
    sessionId: typeof sessionId === "string" ? sessionId : null,
    // `environment` is ignored if a client sends it — the emitter always
    // overwrites it from configuration.
    properties: properties && typeof properties === "object" ? properties : {},
  });

  return NextResponse.json({ ok: true });
}

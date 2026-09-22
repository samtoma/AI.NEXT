import { NextResponse } from "next/server";
import { emit, isClientEmittable } from "@/lib/analytics";
import { AuthError, requireStudent } from "@/lib/auth/principal";

/**
 * Client event sink (FR-801).
 *
 * Server-side events are emitted directly through lib/analytics.ts and do not
 * travel through this route. This exists only for interactions the server never
 * sees — a step scrolled into view, a button tapped, a tab closed.
 *
 * Three things a client may NOT do here, all for comparison integrity (FR-901):
 *   1. set `environment` — it is stamped server-side from configuration;
 *   2. emit an arbitrary event name — only the allow-list in lib/analytics.ts,
 *      so a stray or malicious client cannot fabricate the funnel events the
 *      comparison metric is computed from;
 *   3. **say whose event it is.** The body's `studentId` was never trusted and
 *      is now not even read: the row is attributed to the principal on the
 *      cookie. Anonymous callers are refused outright rather than writing a
 *      NULL-student row — `emit`'s anonymous path exists for the pre-account
 *      funnel steps the auth routes emit server-side, not for anyone who can
 *      POST here.
 */
export async function POST(req: Request) {
  let me;
  try {
    me = await requireStudent();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

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

  await emit({
    event,
    studentId: me.studentId,
    sessionId: typeof sessionId === "string" ? sessionId : null,
    // `sessionRef` stays NULL (FR-2309, P0 report item 5). The client sends a
    // legacy string, not a `sessions.id`, and resolving one here would mean
    // guessing which sitting a tab-close belongs to. An event we cannot
    // attribute is written unattributed; it is never attached to the nearest
    // session in time.
    sessionRef: null,
    // `environment` is ignored if a client sends it — the emitter always
    // overwrites it from configuration.
    properties: properties && typeof properties === "object" ? properties : {},
  });

  return NextResponse.json({ ok: true });
}

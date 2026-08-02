import { pool } from "@/lib/db";
import { listDemoStudents } from "@/lib/student-context";

/**
 * Demo student roster — PoC ONLY, and deliberately NOT auth (PRD §3).
 *
 * GET  → the seeded cast with live counters (what the switcher panel shows).
 * POST → create a new demo student {name} and return {id}; the client then
 *        sets the plain demo cookie itself (lib/demo-student.ts) and
 *        refreshes. Grade is pinned to prep-3 — the PoC's only cohort.
 *
 * Every row this creates is equally visible to whoever can open the demo
 * site (it is behind Cloudflare Access); no credentials, no PII beyond a
 * display name. Real accounts (parent-owned, phone+OTP) arrive with the
 * student PWA and replace this file.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ students: await listDemoStudents() });
}

export async function POST(req: Request) {
  let name = "";
  try {
    const body = (await req.json()) as { name?: unknown };
    name = typeof body.name === "string" ? body.name.trim() : "";
  } catch {
    /* fall through to the validation error */
  }
  if (name.length < 2 || name.length > 40) {
    return Response.json(
      { error: "name must be 2–40 characters" },
      { status: 400 }
    );
  }
  const res = await pool.query(
    `INSERT INTO students (display_name, grade) VALUES ($1, 'prep-3')
     RETURNING id`,
    [name]
  );
  return Response.json({ id: Number(res.rows[0].id) }, { status: 201 });
}

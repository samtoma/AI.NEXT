/**
 * The body of `POST /api/console/students/{id}/tester`, read closed
 * (ADR-0021, FR-3107) — pure, so every refusal is a unit test rather than a
 * click-through.
 *
 *   { tester: true,  note?: string }   mark, with an optional reason
 *   { tester: false }                   unmark — and nothing else
 *
 * **A note on an unmark is refused, not dropped** (fix pass 2). The mark
 * row's `note` is the reason it was MADE, written once at insert (migration
 * 030's trigger refuses any later change to it), and removal stamps only
 * `unmarked_at` / `unmarked_by` — there is nowhere to keep a removal note. The
 * route used to accept one and silently discard it, so an operator (or a
 * script) could believe a reason had been recorded that never was. The
 * console's own editor never sends one (`TesterMarkEditor`: `{ tester }` on
 * unmark), so the refusal costs the UI nothing.
 */

/** The longest note kept; longer is cut, not refused (the field says so). */
export const TESTER_NOTE_MAX = 280;

export type TesterMarkRequest =
  | { ok: true; tester: boolean; note: string | null }
  | { ok: false; error: "invalid_tester" | "note_not_allowed_on_unmark" };

export function parseTesterMarkBody(raw: unknown): TesterMarkRequest {
  // `null`, an array or a bare string is valid JSON and not a body
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as {
    tester?: unknown;
    note?: unknown;
  };
  if (typeof body.tester !== "boolean") return { ok: false, error: "invalid_tester" };
  if (!body.tester) {
    return body.note !== undefined
      ? { ok: false, error: "note_not_allowed_on_unmark" }
      : { ok: true, tester: false, note: null };
  }
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, TESTER_NOTE_MAX)
      : null;
  return { ok: true, tester: true, note };
}

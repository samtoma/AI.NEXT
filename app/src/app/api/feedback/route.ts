import { currentPrincipal, onboardingRefusal } from "@/lib/auth/principal";
import {
  dismissFeedback,
  feedbackContext,
  recordFeedback,
} from "@/lib/feedback-queries";
import {
  FEEDBACK_NOTE_MAX,
  isFeedbackMoment,
  isFeedbackRating,
  normaliseNote,
  type FeedbackMoment,
} from "@/lib/feedback-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/api/feedback` — the student's own verdict on the product (FR-2801…FR-2807,
 * migration 025).
 *
 * Shaped after `api/settings/appearance/route.ts`, which is the nearest thing
 * in this codebase: a student surface writing one row that is hers, about her
 * own experience, with a body that carries a value and no identity.
 *
 * ---------------------------------------------------------------------------
 * WHOSE ROW, AND WHY THE BODY CANNOT SAY
 * ---------------------------------------------------------------------------
 * **The body carries a moment, a thumb and a note. Nothing else, ever** — no
 * student id, no session id, no lesson slug. The student comes from
 * `currentPrincipal()`, which resolves her from the verified access token and
 * a live join against `auth_sessions`; the sitting, the lesson and the course
 * are resolved server-side from `sessions` (`lib/feedback-queries.ts`). Every
 * write runs under `withPrincipal`, so migration 025's policies scope it to
 * that principal in both `USING` and `WITH CHECK`. An endpoint written wrongly
 * could not reach another child's row: the database refuses, not the WHERE
 * clause.
 *
 * The one thing the client does say is WHICH OF TWO SCREENS is asking, and it
 * is validated against a closed list (`isFeedbackMoment`). A wrong value there
 * mislabels one row's trigger and can do nothing else — it names no person and
 * selects no data.
 *
 * ---------------------------------------------------------------------------
 * GET IS THE "SHOULD WE ASK" — AND IT IS THE REASON THERE IS NO GET CACHE
 * ---------------------------------------------------------------------------
 * The prompt asks before it renders, rather than being told by the page that
 * mounted it. That costs one request at the end of a lesson — a moment with
 * nothing else happening on the wire — and buys two things worth more than it:
 * the cadence rule lives in one place on the server instead of being threaded
 * through three components' props, and the decision is made at the instant the
 * prompt would appear rather than at whatever earlier instant the page
 * rendered.
 *
 * `force-dynamic` because the answer is about one student at one moment, and a
 * cached "yes" is a child being asked twice.
 *
 * ---------------------------------------------------------------------------
 * IT NEVER BLOCKS, AND THIS FILE CANNOT MAKE IT BLOCK
 * ---------------------------------------------------------------------------
 * Every failure here answers "do not ask" or a status the component ignores.
 * A student whose network drops between the thumb and the note loses the note
 * and keeps the thumb; a student whose database is unreachable sees no prompt
 * and a perfectly normal report card. The one behaviour this endpoint must
 * never have is holding up the end of a lesson, and the way it does not have
 * it is by having nothing downstream of it.
 *
 * ---------------------------------------------------------------------------
 * NO ANALYTICS EVENT, DELIBERATELY
 * ---------------------------------------------------------------------------
 * `contracts/analytics.md` keeps a CLOSED event vocabulary, and the argument
 * `api/settings/appearance` makes applies with more force here: the `feedback`
 * row IS the record — timestamped, environment-tagged, attributable — and a
 * second row in `analytics_events` saying the same thing would be a duplicate
 * with a worse shape and a looser grant. Nothing is emitted to GA either;
 * `lib/ga.ts`'s allow-list is eleven names and this is not one of them, and a
 * child's opinion of us is not something to send to Google.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ENDPOINT DOES NOT DO TO THE NOTE
 * ---------------------------------------------------------------------------
 * It does not scan it, classify it, score it, translate it, summarise it or
 * derive a `safety_flags` row from it. Migration 025's header carries the
 * argument in full; the short version is that a keyword list applied to
 * teenagers produces false alarms in bulk and false comfort in the other
 * direction, and the human path is a console surface that shows every note in
 * full rather than a scanner that decides which ones matter.
 */

/** Parse `?moment=`, the one parameter either verb takes. */
function momentOf(raw: unknown): FeedbackMoment | null {
  return isFeedbackMoment(raw) ? raw : null;
}

/**
 * GET — may we ask this student, and about which sitting?
 *
 * Answers `{ask:false}` for anyone who is not a signed-in student, including
 * an operator: an operator has no `students` row, so there is no sitting to be
 * asked about, and a console build does not serve this route at all.
 */
export async function GET(req: Request) {
  const me = await currentPrincipal();
  if (me.kind !== "student") return Response.json({ ask: false });
  // FR-4014: nothing about a lesson while the first-Google-sign-in step is owed.
  const pending = onboardingRefusal(me);
  if (pending) return pending;

  const moment = momentOf(new URL(req.url).searchParams.get("moment"));
  if (!moment) return Response.json({ ask: false });

  const { decision } = await feedbackContext(me.studentId, moment);
  if (!decision.ask) {
    // `because` is a developer-facing word — `too_new`, `asked_recently` — and
    // it names a rule rather than a fact about this student. It is returned so
    // that "why is the prompt not showing" is answerable from the network tab
    // instead of by reading `mayAsk` and guessing which branch fired.
    return Response.json({ ask: false, because: decision.because });
  }
  // Deliberately NOT the session id. The component has no use for one — it
  // never sends it back — and an id on a page is an id in a bug report.
  return Response.json({ ask: true, trigger: decision.trigger });
}

/**
 * POST — a thumb, a thumb with a note, or a dismissal.
 *
 * Three bodies, and the third is the one that is easy to get wrong:
 *
 *   {"moment":"lesson_completed","rating":"up"}
 *   {"moment":"lesson_completed","rating":"up","note":"the graph bit helped"}
 *   {"moment":"lesson_completed","dismiss":true}
 *
 * The second is normally a SECOND request: the thumb is sent the instant it is
 * pressed, so a student who types nothing has still answered, and the note
 * amends the row she already wrote. `recordFeedback` upserts, which is what
 * makes those two requests one row.
 */
export async function POST(req: Request) {
  const me = await currentPrincipal();
  if (me.kind !== "student") {
    // 401 for anonymous and for an operator alike. An operator has no row here
    // to write and no opinion this table records; the console reads feedback,
    // it never produces it.
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const pending = onboardingRefusal(me);
  if (pending) return pending;

  let body: { moment?: unknown; rating?: unknown; note?: unknown; dismiss?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const moment = momentOf(body.moment);
  if (!moment) {
    return Response.json(
      { error: "invalid_moment", allowed: ["lesson_completed", "session_ended"] },
      { status: 400 }
    );
  }

  try {
    // Dismissal first, because it is the only branch with no rating and
    // checking it after would make `rating: undefined` look like a bad request
    // rather than like "she closed it".
    if (body.dismiss === true) {
      const wrote = await dismissFeedback(me.studentId, moment);
      return wrote
        ? Response.json({ ok: true, recorded: "dismissed" })
        : Response.json({ error: "no_sitting" }, { status: 409 });
    }

    if (!isFeedbackRating(body.rating)) {
      // The closed set comes from the module that owns it, never re-typed
      // here: a second hand-written list of rating names is the drift
      // `design-variant-scan.test.mts` exists to refuse.
      return Response.json(
        { error: "invalid_rating", allowed: ["up", "down"] },
        { status: 400 }
      );
    }

    const note = normaliseNote(body.note);
    if (!note.ok) {
      // Refused, never truncated. A note cut at 600 characters mid-word would
      // be stored as something the child did not write, and attributed to her.
      return Response.json(
        { error: "note_too_long", max: FEEDBACK_NOTE_MAX, length: note.length },
        { status: 400 }
      );
    }

    const wrote = await recordFeedback(me.studentId, moment, body.rating, note.note);
    if (!wrote) {
      // No sitting to attach it to. FR-2309's rule is that a reference we
      // cannot establish is a gap rather than a guess, so nothing is written
      // and the component quietly stops showing the prompt.
      return Response.json({ error: "no_sitting" }, { status: 409 });
    }
    return Response.json({ ok: true, recorded: note.note === null ? "rating" : "rating+note" });
  } catch (err) {
    console.error("[feedback] write failed:", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

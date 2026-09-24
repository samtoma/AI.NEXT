# ADR-0023 — Turn and upload limits become observed thresholds, not an enforced cap

**Status**: Accepted — Samuel, 2026-09-24. **Amended the same day** (uploads): Samuel's follow-up
instruction, the same day — *"please remove the limit of the photo uploads for now as well, and add
the monitoring and cost if any in the admin console"* — extends this ADR to the daily upload cap,
which the Decision below first recorded as untouched. Title and scope widened to match; everything
about the turn caps below is unchanged by this amendment.
**Amends**: [constitution](../../.specify/memory/constitution.md) v3.2.0 → **v3.3.0** (Principle VI, folded into one amendment covering both limits) · the `TURN_CAPS` refusal in `app/src/app/api/ask/route.ts` (removed) · the `DAILY_UPLOAD_CAP` refusal in `app/src/lib/upload-contract.ts` and `app/src/app/api/uploads/route.ts` (removed) · `FR-051` in [`specs/000-baseline/spec.md`](../../specs/000-baseline/spec.md), **superseded** · the cap clause of `T047` in [`specs/001-student-mvp1-delta/tasks.md`](../../specs/001-student-mvp1-delta/tasks.md), **superseded** (the metering half of T047 stands) · `research.md` L66 (`specs/001-student-mvp1-delta/`), **superseded** · `specs/001-student-mvp1-delta/delta-matrix.md`'s FR-051 row · `specs/001-student-mvp1-delta/traceability.md`'s FR-212 row · `specs/001-student-mvp1-delta/contracts/api.md` (both the turn-cap line and the uploads `429` line) · `specs/000-baseline/contracts/api.md` · `docs/architecture/system-design-deep-dive.md`
**Affects**: `app/src/lib/turn-thresholds.ts` (new — `TURN_THRESHOLDS`, `thresholdStatus`, and now `DAILY_UPLOAD_THRESHOLD`, `uploadThresholdStatus`, `summariseUploadDays`) · `app/src/lib/turn-threshold-queries.ts` (new — the console's turn reads) · `app/src/lib/upload-threshold-queries.ts` (new — `readUploadsView`, the console's upload reads, reusing `cost-queries.ts`'s existing photo/OCR spend figure rather than recomputing it) · `app/src/lib/upload-contract.ts`, `app/src/app/api/uploads/route.ts` (the daily-cap refusal removed; size/type limits untouched) · `app/src/app/(console)/cost/page.console.tsx` (turn-limit panel, and now the photo-upload monitoring panel) · `app/src/app/(console)/students/[id]/sessions/` (list, timeline, replay) · `app/src/components/console/ui.tsx` (the chip) · `specs/002-identity-and-admin-console/spec.md` and `traceability.md`, **FR-3401…FR-3409**
**Related**: [ADR-0021](./0021-runtime-teaching-toggle-and-testers.md) (raised `lesson_learn` 14→18, the number this ADR carries forward unenforced) · [ADR-0019](./0019-serve-the-whole-maths-bank.md) (the other case in this repo where Samuel lifted a standing bound and kept the record instead) · constitution Principle VI (Cost Discipline) and Principle XI (per-environment attribution, no pooling) · FR-2402/FR-2406 (specs/002 — the existing spend split and the cost-billing role's content-blindness, both of which FR-3409's upload panel must keep true)

## Context

Until this decision, `app/src/app/api/ask/route.ts` enforced `TURN_CAPS`: a hard, server-side
ceiling on delivered AI replies per (surface, chat session, student) —

| Surface | Cap | Why |
|---|---|---|
| `student_chat` | 2 | PRD §6.3, "max 2 AI turns per question" |
| `lesson_learn` | 18 | raised from 14 for #33–#35 so the Socratic arc could reach its closing retrieval (ADR-0021's context) |
| `lesson_review` | 5 | "the non-annoying path" |
| `spine_chat` | none | — |

The count was delivered replies only (`outcome = 'ok'` in `ai_interactions`), keyed per surface,
chat session and student — the same key the code has always used. On hitting the cap the server
refused the next request with a canned message ("That's a full lesson's worth of work for one
evening…") and the client locked the input with "AI turn limit reached for this question." The
refusal itself was never logged as an event distinct from a normal reply, so there is no way to
recover, after the fact, how many times a cap was hit before today.

**Live evidence, gathered 2026-09-24.** Of the 6 lessons taught so far on production, **2 hit the
18-reply `lesson_learn` cap**, both on lesson `u1-1`, after about 10–11 minutes each; both times the
student restarted the lesson rather than continuing. Of each lesson's 18 replies, 6–7 were button
taps ("Start now", "Continue.", "Got it — next ✓", "say it another way") and only 2–3 were the
student's own typed questions ("what is a net diagram", "what is a quadrant?") — most of a capped
lesson's turn budget was spent on structural prompts, not on student-initiated questions. Cost is
≈$0.028 per lesson reply, so an 18-reply lesson costs ≈$0.47; the two capped lessons together cost
under $1.

Constitution v3.2.0 Principle VI ("Cost Discipline") says: "uploads, OCR and ask-anything add
unbudgeted per-student cost, and **the server-enforced per-surface turn caps remain the operative
bound on worst-case spend**." Samuel's decision below removes exactly that bound, so the principle
must be amended, not merely the code.

**The upload cap, added the same day.** `app/src/app/api/uploads/route.ts` carried a second,
separate limit: a student's 11th photo or PDF upload in a day was refused with a `429` and "That's
10 uploads today — my limit…" (`DAILY_UPLOAD_CAP = 10` in `app/src/lib/upload-contract.ts`). It came
from 001 `T047` and `research.md` L66 ("a per-student upload cap is required — proposed 10/day"),
reasoned from the same worst-case-spend logic as the turn caps: image tokens are materially more
expensive than text, so an unmetered upload path could quietly outspend the baseline. The 10 MB size
limit and the JPEG/PNG/PDF type limit are a different kind of check — what a student may send, not
how many times — and stay exactly as they are; neither is a count and neither is touched here. Upload
parsing is metered as its own `surface_kind` (`upload_parse`) in `ai_interactions`, separately from
tutoring spend (FR-2402), and that metering is unaffected.

**The evidence is not symmetric, and it matters that this ADR says so.** The turn caps above had two
real, capped conversations on production the day of the decision. **The upload cap has never fired
against a real upload** — a read-only check of production on 2026-09-24 found **zero uploads to
date**. Removing an enforced limit that has never once bound anything is not the same kind of call as
removing one that visibly bound two lessons that morning: there is no cost-impact evidence either
way, only the same reasoning ("image tokens are expensive") that set the number in the first place.
Samuel's instruction covers it anyway — *"remove the limit of the photo uploads for now as well, and
add the monitoring and cost if any in the admin console"* — and the console monitoring this ADR adds
(FR-3409) is how that evidence starts to exist, rather than being assumed in either direction.

## Decision

Samuel, verbatim, 2026-09-24: **"remove the limits, make them highlight in the admin console, we
need to know how often those limits are triggered."** — and, the same day, extending it: **"please
remove the limit of the photo uploads for now as well, and add the monitoring and cost if any in the
admin console."**

- **No surface refuses a student's turn because of how many replies the conversation has had.** The
  cap messages and the input lock are gone. A student never again sees a limit message.
- **The three numbers survive, as observed thresholds, not an enforced ceiling.** `student_chat` 2,
  `lesson_learn` 18, `lesson_review` 5, `spine_chat` none — moved to one named constant,
  `TURN_THRESHOLDS` in `app/src/lib/turn-thresholds.ts`, read by the console and by the review-mode
  finish nudge (below). The numbers are unchanged; only their consequence changes.
- **Two words, defined precisely, because the code can now tell them apart for the first time:**
  - **"Reached"** — at least the threshold's number of delivered replies (`outcome = 'ok'`) in one
    conversation (surface, chat session, student — the same key `TURN_CAPS` used).
  - **"Went past"** — more than the threshold: the reply the old rule would have refused.
  - Before this decision the refused request was never logged as a distinct event, so **history can
    only show "reached," never "went past,"** for anything before this change ships. "Went past" is
    only observable from here forward.
- **The review-mode finish nudge stays**, unchanged in effect: at 5 replies in `lesson_review` it
  offers Finish. It has never blocked a turn on its own — the block was `TURN_CAPS` — so removing the
  cap does not remove the nudge; the nudge now reads the same named constant instead of its own
  copy of the number.
- **The console gets the visibility Samuel asked for**, not the enforcement it replaces: a
  highlighted "Turn limits — observed, not enforced" panel on the Cost page (per surface, for the
  chosen period: threshold, conversations, reached count and share, went-past count, highest reply
  count, and a list of the most recent conversations that reached a threshold, linked to their
  session); an attention chip — amber, never red (FR-1002) — on a session that reached its threshold,
  on the student session list, the session timeline and replay. `/overview` is unchanged; it is
  anonymous by design and this is per-session detail.
- **The uploads daily cap is withdrawn on the same terms, the same day.** No upload is refused
  because of how many the student sent that day; the 429 and its message are gone (FR-3407). The 10
  MB size limit and the JPEG/PNG/PDF type limit are untouched — they answer a different question
  (what may be sent) and neither is a count. The unverified-email refusal on uploads (FR-2004) is
  also untouched; it is not a count either.
- **The daily number survives the same way the turn numbers did**: one named constant,
  `DAILY_UPLOAD_THRESHOLD = 10`, added to `app/src/lib/turn-thresholds.ts` beside
  `TURN_THRESHOLDS` (FR-3408) — the same module, because it is the same mechanism (an observed
  count, no longer an enforced one) applied to a different resource.
- **The console's Cost page gets photo-upload monitoring** (FR-3409), separate from the turn-limit
  panel because it answers a different question: uploads in the period, the students who uploaded,
  parse outcomes (parsed / failed / unreadable), and upload/OCR spend with its average per upload —
  kept apart from tutoring spend, which FR-2402 already keeps apart and this does not change. Alongside
  it: how many student-days reached or went past the daily threshold, highlighted whenever any did,
  and a list of those student-days. Per environment, never pooled (constitution XI), and carrying no
  upload content (FR-2406) — the same content-blindness the cost-billing role already has elsewhere
  on this page.
- **Counted per environment, never pooled** (constitution XI): a threshold crossing is counted
  against the surface, chat session and student the reply was actually served to, the same isolation
  `TURN_CAPS` already had. Two solutions' turn-limit numbers are never added together. The same rule
  governs the upload threshold and its student-day counts.

## Why this and not an alternative

The obvious alternative — raise the caps instead of removing them — was not what Samuel asked for,
and the evidence above suggests it would not have answered the actual question anyway: the two
lessons that hit the 18-reply cap spent most of their turns on button taps, not on genuine student
questions, so a higher fixed number would still eventually be wrong for some lesson and still tell
nobody how often it binds. Samuel's framing — remove the limit, watch how often it would have fired —
treats "how many turns does a lesson actually need" as an empirical question to answer from usage,
not a number to guess twice. This ADR records that framing as the decision, not as a justification
invented after the fact: the quote above is what he said.

**The upload cap has no equivalent evidence to weigh, and this ADR does not invent any.** With zero
production uploads, there is no data showing the cap ever prevented an expensive day, and none
showing it would be safe to remove either — the honest position is that nobody knows yet, which is
exactly what "add the monitoring" is for. Applying the same mechanism (an observed threshold, not an
enforced one) rather than a bespoke rule for uploads keeps the two limits legible as one policy
rather than two, and means the Cost page's "reached / went past" language means the same thing on
both panels.

## Consequences

- **Worst-case spend per conversation is now unbounded**, and only visibility mitigates it — the
  server no longer refuses a turn at any count. Constitution Principle VI is amended below so this is
  not left contradicting the code: instrumentation and per-environment attribution stay mandatory;
  the "operative bound" clause is replaced by the observed-threshold mechanism this ADR defines.
  Nothing else in Cost Discipline changes — the ledger, the spend meter and environment attribution
  are all unaffected.
- **PRD §6.3's "max 2 AI turns per question" is departed from.** The PRD is product-scope authority
  (CLAUDE.md Authority rule 2); this ADR does not rewrite it, and the departure should be put to its
  owner, Tamer Deif, rather than left as a silent drift between the shipped product and the document
  that describes it.
- **`FR-051`** ("Server-enforced per-surface turn caps MUST bound spend per student") **is
  superseded** by this ADR and by `FR-3401` (specs/002, "no surface refuses a student's turn because
  of how many replies the conversation has had"). `FR-051` lives in `specs/000-baseline/spec.md`, an
  as-built record of the shipped baseline — it is annotated with the supersession, not rewritten or
  deleted, following the convention already used for `FR-106`/`FR-501`/`FR-604` in
  `specs/001-student-mvp1-delta/spec.md`.
- **A worse worst case is now reachable and nobody has watched it happen.** The two production
  lessons that hit 18 replies both stopped there; there is no live data yet on what a lesson or chat
  does at 30, 50 or 200 replies once nothing stops it. That is exactly the gap the console panel exists
  to close, and it should be read regularly until a real distribution is visible — not assumed benign
  because nothing has broken yet.
- **The three numbers are not retired.** `TURN_THRESHOLDS` keeps them as the named constant every
  consumer (console, review nudge) reads, so a future re-enforcement — if the observed data calls for
  one — changes one file's meaning, not its numbers.
- **Worst-case upload/OCR spend per student is now unbounded too**, and for this one there is no
  "it only happened twice" to point to — it is unbounded with zero prior signal about what it is being
  unbounded *from*. FR-3409's monitoring is the only mitigation, and it starts from nothing: the first
  real reading of "how many uploads does a student-day actually need" happens after this ships, not
  before it.
- **`T047`'s cap clause is superseded**; its metering clause is not. `specs/001-student-mvp1-delta/
  tasks.md` T047 asked for both — meter upload parsing as its own surface, and enforce the daily cap
  — in one line. Only the second half is superseded here; the metering `T047` also asked for is what
  FR-3409's spend split still runs on, unchanged.

## How to undo this

The thresholds are already the right numbers — nothing here invents new ones, for either limit.
Undoing the turn-cap half is reverting the code commit that removed the refusal in
`app/src/app/api/ask/route.ts` (restoring `TURN_CAPS`'s refusal and the input lock) while keeping
`TURN_THRESHOLDS` as the source of the numbers. Undoing the upload-cap half is the same shape:
restore the `429` in `app/src/app/api/uploads/route.ts` and `upload-contract.ts`'s refusal message,
reading `DAILY_UPLOAD_THRESHOLD` for the number rather than reintroducing a second copy of `10`. Each
half can be undone independently of the other — they are one ADR because they are one policy, not
because they must be reverted together. Constitution Principle VI would need a matching reversal,
recorded as a further amendment citing this ADR, not a silent edit.

# ADR-0023 — Turn limits become observed thresholds, not an enforced cap

**Status**: Accepted — Samuel, 2026-09-24
**Amends**: [constitution](../../.specify/memory/constitution.md) v3.2.0 → **v3.3.0** (Principle VI) · the `TURN_CAPS` refusal in `app/src/app/api/ask/route.ts` (removed) · `FR-051` in [`specs/000-baseline/spec.md`](../../specs/000-baseline/spec.md), **superseded** · `specs/001-student-mvp1-delta/delta-matrix.md`'s FR-051 row · `specs/001-student-mvp1-delta/traceability.md`'s FR-212 row · `specs/001-student-mvp1-delta/contracts/api.md` · `specs/000-baseline/contracts/api.md` · `docs/architecture/system-design-deep-dive.md`
**Affects**: `app/src/lib/turn-thresholds.ts` (new — `TURN_THRESHOLDS`, `thresholdStatus`) · `app/src/lib/turn-threshold-queries.ts` (new — the console's reads) · `app/src/app/(console)/cost/page.console.tsx` · `app/src/app/(console)/students/[id]/sessions/` (list, timeline, replay) · `app/src/components/console/ui.tsx` (the chip) · `specs/002-identity-and-admin-console/spec.md` and `traceability.md`, **FR-3401…FR-3406**
**Related**: [ADR-0021](./0021-runtime-teaching-toggle-and-testers.md) (raised `lesson_learn` 14→18, the number this ADR carries forward unenforced) · [ADR-0019](./0019-serve-the-whole-maths-bank.md) (the other case in this repo where Samuel lifted a standing bound and kept the record instead) · constitution Principle VI (Cost Discipline)

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

## Decision

Samuel, verbatim, 2026-09-24: **"remove the limits, make them highlight in the admin console, we
need to know how often those limits are triggered."**

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
- **The uploads daily cap (`DAILY_UPLOAD_CAP`) is untouched.** It bounds a different kind of spend
  (OCR calls) through a different mechanism (a daily ceiling, not a per-conversation reply count) and
  nothing in this decision or Samuel's words above touches it.
- **Counted per environment, never pooled** (constitution XI): a threshold crossing is counted
  against the surface, chat session and student the reply was actually served to, the same isolation
  `TURN_CAPS` already had. Two solutions' turn-limit numbers are never added together.

## Why this and not an alternative

The obvious alternative — raise the caps instead of removing them — was not what Samuel asked for,
and the evidence above suggests it would not have answered the actual question anyway: the two
lessons that hit the 18-reply cap spent most of their turns on button taps, not on genuine student
questions, so a higher fixed number would still eventually be wrong for some lesson and still tell
nobody how often it binds. Samuel's framing — remove the limit, watch how often it would have fired —
treats "how many turns does a lesson actually need" as an empirical question to answer from usage,
not a number to guess twice. This ADR records that framing as the decision, not as a justification
invented after the fact: the quote above is what he said.

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

## How to undo this

The thresholds are already the right numbers — nothing here invents new ones. Undoing this ADR is
reverting the code commit that removed the refusal in `app/src/app/api/ask/route.ts` (restoring
`TURN_CAPS`'s refusal and the input lock) while keeping `TURN_THRESHOLDS` as the source of the
numbers, so the console panel and the enforced cap read the same constant rather than drifting apart
again. Constitution Principle VI would need a matching reversal, recorded as a further amendment
citing this ADR, not a silent edit.

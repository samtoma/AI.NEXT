# ADR-0015 — One interaction timeline per student per session, replayed by reconstruction

**Status**: Accepted — Samuel, 2026-09-20, in the identity & admin-console brainstorm (decisions D6, D7)
**Affects**: `sessions` and `ai_interactions` (`db/schema.sql`, `db/migrations/002-ai-interactions.sql`, `009-mvp1-bkt-library-analytics.sql`) · the three ledger write sites — `app/src/app/api/ask/route.ts` (two INSERTs), `app/src/app/api/understanding/route.ts`, `app/src/lib/uploads.ts` · `app/src/app/api/attempts/route.ts` · `FR-2301…FR-2399` · `docs/ROADMAP.md`
**Depends on**: [ADR-0012](./0012-per-student-isolation-rls.md), [ADR-0014](./0014-admin-console-second-build-target.md)

## Context

The transcript of what a student did exists. It does not exist as one thing, and
the table that looks like it should hold it together has never held anything.

**`sessions` is dead schema.** R3's inventory
(`specs/002-identity-and-admin-console/research/codebase-seams.md` §4) checked
every module: nothing in the application inserts into `sessions` or selects from
it — the only two mentions in `app/src` are a code comment and a UI label.
`attempts.session_id` is a bare `BIGINT` with no foreign key and it is **not in
the INSERT column list** at `app/src/app/api/attempts/route.ts:177-179`, so
every attempts row this product has ever written has `session_id = NULL`.

What the app calls a session today is an ephemeral client-generated string that
is never a row of its own:

| Where | What it actually is |
|---|---|
| `ai_interactions` | `chatSession`, kept inside `grounding->>'chat_session'` JSONB; read only to count prior turns against the cap |
| `understanding_checks` | the same `chatSession`, also inside `grounding` |
| `uploads.session_id` | free `TEXT` — whatever the client posted as `sessionId` |
| `analytics_events.session_id` | `TEXT` — null on server-side emits, client-supplied otherwise |
| `sessions.id` | `BIGINT`. Never written. |

So D6's "add `session_id` to `ai_interactions`" cannot be executed as a
one-column migration against a live key, because **there is no live key**. The
problem is larger than D6's phrasing implied, not smaller: this is not a
populated table missing one join, it is a missing concept with a placeholder
table and a client string standing in for it in three different types.

The consequence is unchanged and is why this comes first: a tutor turn cannot be
reliably tied to the lesson it belonged to except by timestamp proximity, the
correlation is lost **at write time**, and no later migration can recover which
lesson yesterday's turn belonged to. Of everything in this workstream it is the
only gap destroying data right now.

The rest of the record, for completeness: `attempts` carries every widget
outcome since ADR-0009; `understanding_checks` has student, LO, mode and
verdict; `mastery` is bitemporal and joins only by time; `explanation_log` has
no `student_id` at all and hangs off a nullable `attempt_id`.

## Options considered

**(a) Store a rendered snapshot per turn.** Pixel-faithful and immune to
renderer drift. Heavy: it duplicates content already stored, multiplies the
highest-volume student table, and freezes a rendering bug into the record as
though it were the truth of what the student was taught. Rejected.

**(b) Store the payloads, pin the renderer version, re-render on demand —
"reconstructed".** Cheap, uses the components the student actually used, stays
honest by being labelled as a reconstruction rather than a recording.
**Chosen.**

**(c) Leave it and join by timestamp.** This is today, and today is what fails.
Rejected.

## Decision

**1. `sessions` becomes the real learning-session row, and that is the first
migration of the workstream.** A session row is opened when a student starts a
lesson, a practice run or a chat, and closed on completion or on inactivity.
**Every recorded interaction belongs to exactly one session.**
`ai_interactions`, `attempts`, `understanding_checks`, `uploads` and
`analytics_events` all reference it by a `BIGINT` foreign key.

This is more than D6 literally asked for, and it is the only way to give D6 what
it asked for. An `ai_interactions.session_id` referencing nothing would be a
fourth ephemeral string in a fourth format.

**Transition.** Today's client `chatSession` string is *mapped onto* the new row
rather than discarded — one session row per distinct `chatSession` — so turns
already written stay correlated. The existing `TEXT` columns
(`uploads.session_id`, `analytics_events.session_id`) are kept beside the new FK
during the transition and **retired once the FK is populated everywhere**. They
are the legacy client string and must never be joined to `sessions.id`, which is
`BIGINT`; the types disagree and a join that returns rows would be returning
coincidences. The plan owns the mechanics and the cut-over. The obligation is
that the two never coexist as two different answers to "which session".

Ordering: the proposed numbering puts this at `013`. The plan may renumber —
3-digit prefixes are load-bearing, since migrations apply by alphabetical glob
(seams §11) — but must not resequence it behind the account and policy work.

**2. A read model merges the sources into one time-ordered timeline per student
per session** — tutor turns, attempts, widget outcomes, understanding checks,
uploads and mastery moves in a single order. It is a read model, not a new
table: the sources stay authoritative and nothing is copied for the timeline's
convenience.

**3. Replay is read-only and reconstructed.** It renders with the same
components the student saw, driven by the stored payload, and it is **labelled
*reconstructed*** in the interface. A renderer-version field on each turn
records which version produced it, so a replay that no longer matches what the
student saw can be recognised rather than believed. An operator reading a
transcript to judge whether the tutor taught well needs to know which parts are
evidence and which are re-staging.

**4. Every operator read of a student's record writes an audit row** — who read,
whose record, when, which surface. The row is itself student-scoped under RLS
(ADR-0012), and the reader cannot delete it: the `student-data` role holds no
delete on that table. An audit log the audited party can erase is decoration.
This is the control that makes ADR-0014's highest-privilege role grantable at
all.

**5. Retention: full fidelity, now.** Samuel, D7 — his decision and his
responsibility, taken against constitution v3.1.0 Principle VII's minimalism
rather than in ignorance of it. It is bounded by a named condition, not a good
intention: **a retention policy MUST exist before any audience wider than the
invited pilot cohort. Owner: Samuel. When: the pilot-exit decision.**

## Consequences

**A session lifecycle is new product behaviour, not a column.** Something has to
open and close a session, and four routes need it — `/api/ask`,
`/api/attempts`, `/api/understanding`, `/api/uploads`. The analytics vocabulary
already contains `session_started` and `session_ended` (seams §6) with nothing
durable behind them; they become real. Open, close and inactivity rules are the
plan's, in `data-model.md`.

**The ask, understanding and upload write paths must carry the session** —
three files, **four** INSERT statements, since `app/src/app/api/ask/route.ts`
writes twice (the sacred-guard-suppressed turn and the successful turn). The
understanding and upload INSERTs also omit the cache-token columns the ask path
writes; the plan should not make that asymmetry worse while it is in there.

**`student_chat` and `spine_chat` outside a lesson get sessions too.** That is
what "exactly one session" means, and it removes the null-session special case
that a narrower reading would have left in the timeline forever.

**A renderer-version field on every turn, and a commitment not to delete pinned
versions.** Replay fidelity is bounded by how long the components that produced
it are kept — a maintenance obligation this decision creates and does not pay
for by itself.

**`explanation_log` enters the timeline through the attempt or not at all.** It
has no `student_id`; it hangs off a nullable `attempt_id` (ADR-0012 says the
same about its RLS policy). An explanation with no attempt behind it is
unreachable from a student's timeline — worth knowing before it is reported as
a gap in the merge.

**The teaching evaluation harness scoped in `docs/ROADMAP.md` gets the timeline
as its data source.** A harness that needs ordered lesson transcripts is exactly
what this produces. Mentioned so the two are not built twice; **not designed
here.**

**Cost.** `sessions` goes from empty to one row per study sitting;
`ai_interactions`, the highest-volume student table, gains one column and one
index; the operator-read audit table grows with operator reads, not with student
use. Nothing else grows.

**What would trigger revisiting.** A legal or contractual duty to produce an
exact record of what a student was shown — a dispute, or a regulator. A
reconstruction would not satisfy that, and option (a) returns for the turns that
matter, not for all of them.

# Contract: Learning sessions

**Module**: `app/src/lib/sessions.ts` · **Table**: `sessions` (+ `session_id` / `session_ref` on five
tables) · **ADR**: [0015](../../../docs/decisions/0015-interaction-timeline-and-replay.md)
**Enforces**: FR-2301, FR-2302, FR-2309 · **Replaces**: the ephemeral `chatSession` string

> A learning session is **new product behaviour, not a column**. Nothing creates one today: the
> `sessions` table has never held a row, and what the product passes around is an opaque string the
> browser invented, in three incompatible shapes (`research/codebase-seams.md` §4).

## The API

```ts
/** Find the student's open session, or open one. Called at the top of every interaction. */
currentSession(studentId: number, kind: SessionKind, opts?: {
  surface?: string;          // 'lesson_learn' | 'student_chat' | …, as ai_interactions.surface
  loId?: string;             // the objective, when the caller knows it
  clientKey?: string;        // the legacy chatSession string, during the transition
}): Promise<{ sessionId: number; opened: boolean }>;

/** Close explicitly. Idempotent: closing a closed session is a no-op, not an error. */
closeSession(sessionId: number, reason: CloseReason): Promise<void>;

/** Close every session idle longer than the window. Called lazily and nightly. */
sweepIdleSessions(now?: Date): Promise<number>;

type SessionKind  = "lesson_learn" | "lesson_review" | "practice" | "student_chat" | "spine_chat";
type CloseReason  = "completed" | "inactivity" | "superseded" | "abandoned";
```

Both calls run inside `withPrincipal`, so a session row is created under the student it belongs to
and under no other.

## Lifecycle

| Trigger | Effect | `close_reason` | Event |
|---|---|---|---|
| First interaction of a study stretch | a row opens | — | `session_started` |
| Lesson or practice completes; the student ends a chat | closes | `completed` | `session_ended` |
| **30 minutes** with no interaction | closes on the next sweep | `inactivity` | `session_ended` |
| The student opens a session of a different kind | the previous one closes first | `superseded` | `session_ended` |
| An operator or the nightly job closes a stranded row | closes | `abandoned` | `session_ended` |

**At most one open session per student**, enforced by a partial unique index — the invariant that
makes FR-2301's "exactly one session" true rather than aspirational. **The 30-minute window is
documented, not discovered** (FR-2302); it is in plan.md's Open list because it is Samuel's to change,
not because it is undecided.

**Closing is one-way.** A closed session is never reopened; the student's next interaction opens a
new one. A reopened session makes "how long did this sitting last" unanswerable, which is the one
question the session exists to answer.

## What each surface must send, and what it must record

| Route | Kind | Sends | Records |
|---|---|---|---|
| `POST /api/ask` | from `surface`: `lesson_learn`, `lesson_review`, `student_chat`, `spine_chat` | `chatSession` (transitional), `surface`, `loId` when known | `ai_interactions.session_id` on **both** INSERTs — the success path *and* the sacred-guard redaction path |
| `POST /api/attempts` | `practice`, or the lesson's kind when the attempt is inside one | nothing new from the client | `attempts.session_id` — today the column exists and is **never in the INSERT list** |
| `POST /api/understanding` | the lesson's kind | `chatSession` (transitional) | `understanding_checks.session_id` and `ai_interactions.session_id` on its grading turn |
| `POST /api/uploads` | the current session's kind | `sessionId` (transitional `TEXT`) | `uploads.session_ref`; `parseUpload` writes the ledger row under the same session |
| `POST /api/analytics` | — | nothing new | `analytics_events.session_ref` |

**Four INSERT statements across three files**, because `api/ask/route.ts` writes twice (ADR-0015
Consequences). The understanding and upload INSERTs also omit the cache-token columns the ask path
writes; the session work does not make that asymmetry worse and the cost work (A7) fixes it.

**`student_chat` and `spine_chat` outside a lesson get sessions too.** That is what "exactly one
session" means, and it removes the null-session special case a narrower reading would have left in
the timeline forever.

## Unattributable interactions

An interaction that cannot be attributed to a session is written with a **NULL** session and is
visible as such in the console — counted, listed, and never attached to the nearest session in time
(FR-2309). Timestamp proximity is a guess, and a guess in an audit surface is worse than a gap.

Every row that existed before this feature has a NULL `attempts.session_id` and keeps it: no evidence
exists to reconstruct it, and inventing one would be the same guess.

## Events

`session_started` and `session_ended` already exist in `lib/analytics.ts`'s union with nothing
durable behind them. They now carry `session_ref`, and `session_ended` carries `close_reason` and
`duration_ms` in `properties`. `session_ended` is also in the client allow-list today, which stays
true — a client may report the end of its own session; the server decides what that means.

## Transition

Each distinct legacy client string maps to one session row (`sessions.client_key`, unique per
student), so turns already written stay correlated (ADR-0015). During the transition
`uploads.session_id` and `analytics_events.session_id` keep their `TEXT` values beside the new
`BIGINT` reference. **They must never be joined to `sessions.id`** — the types disagree and a join
that returned rows would be returning coincidences. They are dropped in a later release, once every
write path populates the reference.

## Verification

- **Zero** interactions written after cutover with a NULL session, asserted by query (plan P0 gate).
- One open session per student at any instant, asserted by the unique index and by a test that opens
  two kinds in sequence and expects a `superseded` close.
- A session closed by inactivity is distinguishable from one the student finished (FR-2302).
- `capture-prompts` shows **0 diffs** across this phase: session plumbing must not change a prompt.

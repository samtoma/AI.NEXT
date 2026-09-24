# ADR-0021 — Socratic probing becomes a console switch — On at the next sitting, Off at the next message — for test accounts first

**Status**: Accepted — Samuel, 2026-09-24. **Amended the same day** (fix pass): when a change reaches a student — Samuel chose option B, below; the tester mark needs two roles; the role grant and the rollback path hardened. **Amended again the same day** (fix pass 2): a sitting that has stopped probing never starts again — the consequence "Off then On probes again", recorded below as deliberate in the first amendment, is withdrawn because it let On reach a sitting under way, which FR-3105 forbids.
**Amends**: the compile-time `SOCRATIC_PROBING_ENABLED = false` that v0.6.0 merged Tamer's prototype behind (`app/src/lib/socratic-probing.ts`, [CHANGELOG v0.6.0](../../CHANGELOG.md))
**Affects**: `db/migrations/014-operators-and-roles.sql` (five-role vocabulary) · `db/migrations/029-teaching-controls-role.sql` · `db/migrations/030-teaching-toggle-and-testers.sql` and both rollbacks · `app/src/lib/socratic-probing.ts` (the rules) · `app/src/lib/sessions.ts` (the snapshot) · `app/src/lib/teaching-queries.ts` · `app/src/lib/env.ts` (`RELEASE_TAG`) · `app/src/app/api/ask/route.ts`, `app/src/app/api/attempts/route.ts` · `app/src/components/chat/ChatCore.tsx`, `ChatQuestionCard.tsx`, `components/student/LessonSession.tsx`, `WhiteboardPanel.tsx` · `app/src/app/(console)/teaching/`, `app/src/app/api/console/teaching/`, `app/src/app/api/console/students/[id]/tester/` · the Student 360 and the three session pages · `FR-3101`…`FR-3111` in [`specs/002-identity-and-admin-console/spec.md`](../../specs/002-identity-and-admin-console/spec.md)
**Related**: [ADR-0014](./0014-admin-console-second-build-target.md) (roles, and what a safety control is) · [ADR-0015](./0015-interaction-timeline-and-replay.md) (the learning session this snapshot is stored on) · [ADR-0018](./0018-course-availability.md) (the per-student override pattern the tester mark copies) · [ADR-0012](./0012-per-student-isolation-rls.md) (why the mark is a table the student surface cannot write) · issue [#53](https://github.com/samtoma/AI.NEXT/issues/53) (what probing still has to fix)

## Context

v0.6.0 brought Tamer's Socratic-probing prototype onto `main` switched off: with
probing on, a wrong answer in a learn-mode lesson does not reveal its worked
solution on the card; the tutor asks a guiding question first and the matched
material rides into its next turn as reference only. The four-way review of
that merge filed what still has to be fixed before a real student meets it as
**#53** — the two worst are credit a student did not earn and a lesson that can
stall — and none of the Arabic or Social Studies wording it needs exists.

The switch was a compile-time constant. Turning it on meant a release, it meant
turning it on for **every** student at once, and it meant nobody could say
afterwards which lessons had probed. Samuel wants to try it on the founders' own
accounts now, on the live site, while #53 is worked, and to be able to see —
per lesson — what each student got.

## Options considered

**Who gets it**

1. **Everyone, when it is ready.** The constant, flipped once. Nothing to build;
   nothing learned before #53 closes. Rejected as the only position.
2. **An A/B split across real students.** The question it answers — does probing
   teach better? — is the right one eventually. At pilot size it cannot answer
   it: ~50 families is ~25 per arm, and a teaching effect small enough to be
   plausible is invisible at that size against the spread between two
   fourteen-year-olds. It would also put #53's defects in front of half the
   pilot. **Deferred**, not rejected: it needs a cohort large enough to power it
   and #53 closed.
3. **Test accounts an operator marks by hand — chosen.** The people trying it
   are the people who can report what went wrong. It needs a mark on a student
   and a three-position switch: Off / Test accounts only / Everyone.

**When it is decided**

1. **Per turn** — whatever the switch says now. A lesson could change behaviour
   between two messages; a card could withhold under one rule and the tutor
   answer under the other. Rejected.
2. **Per student** — cached on the account. The same mid-lesson flip, one step
   removed. Rejected.
3. **Per lesson, stored — chosen first.** Resolved once when the learning
   session opens, stored on the session row with the release, and read back
   by everything that behaves differently under probing. The review of the
   first build found the cost (F2/F3): Off was not an instant stop for a
   sitting in progress, a reused session carried its answer across lessons,
   and the snapshot was per sitting, not per lesson.
4. **Stored per sitting, narrowed per request — chosen (Samuel, 2026-09-24,
   option B).** The sitting's snapshot is still resolved and stored when it
   opens, and never rewritten — it is the record of what the sitting started
   with. Each REQUEST then gets that snapshot AND what the switch resolves to
   now for that student (the position and her tester mark) — each counted
   only while it is unchanged since the sitting opened (fix pass 2).
   Narrowing only: **Off — or removing a mark — reaches the student's next
   message**, even mid-lesson; **On reaches their next sitting**, because a
   sitting that opened off is never turned on, and one that stopped probing
   never starts again. The alternative Samuel weighed (A: keep
   per-sitting and reword the requirement) left Off without a way to stop a
   sitting in progress.

**Where the tester mark lives**

1. **A column on `students`.** Rejected: `ainext_app` holds table-level UPDATE
   on `students` (a student edits her own profile), so the student surface
   could set it under her own principal.
2. **A separate table, RLS-forced, SELECT-only to the app — chosen**, copying
   `student_course_access` (ADR-0018).

## Decision

**Socratic probing is a console switch with three positions, decided by the
server — On at a student's next sitting, Off at their next message — and,
until #53 closes, it can reach test accounts and nobody else.**

- **Three positions: Off, Test accounts only, Everyone.** No row means Off.
- **Everyone is locked** behind one code constant, `PROBING_EVERYONE_UNLOCKED =
  false`, pointing at #53. The console shows it disabled with "Not ready yet —
  see issue #53"; `POST /api/console/teaching` refuses it with 409 whoever
  asks; and a stored `everyone` (written while unlocked, or by hand) is **read
  as Test accounts only** while locked, so re-locking is also one edit.
- **Maths only.** The resolver returns off for any course other than
  `course:prep3-math-en`: the probing block and the live-event notes are English
  maths strings, and nothing has been translated (#53 P1-6). And **learn mode
  only**: review mode's ≤5-message lock-in would fight it.
- **A dedicated role gates the write: `teaching-controls`.** Specified under
  `content-review` and moved the same day, so who may change how a child is
  taught can be narrowed without touching who reviews content. A safety control
  in ADR-0014's sense. Every **active** operator holding **`content-review`**
  (the role it is split from) got it **once**, from migration 029, guarded on
  "a `teaching-controls` row has ever existed, or the `auth_events` trail
  records a grant of it" — so neither a re-run nor withdrawing the role
  (`rollback/029`) and deploying again hands it back to someone it was removed
  from. New operators get it from the bootstrap script. *(Fix pass,
  2026-09-24: was "every operator holding a role", guarded on the rows only.)* Reading the Teaching page is any role-holder's:
  it names no student unless the reader holds `student-data`.
- **The tester mark needs `student-data` AND `teaching-controls`** (Samuel,
  fix pass 2026-09-24; it was `student-data` alone). It names a person — the
  Student 360's own role, as the per-student course override — and it decides
  which child the tutor tries an unfinished teaching behaviour on, which is
  the switch's safety decision in another form: marking a REAL child by
  mistake is the failure that matters while #53 is open. So neither role
  alone may do it, and the control says "Only accounts the team owns — never
  a real student." **Nobody lost access**: every operator held all five roles
  on the day. The seam gained its one ALL-OF (`authorize({ roles })`).
- **Reading `/teaching` needs a role — any one of the five** (fix pass): an
  operator whose every role was revoked reads the shell's own pages only. The
  switch's note is readable by every role, so the field says "Don't name a
  student". A failed read of the switch prints "Probing: unknown" in the
  console header and on the Student 360 instead of a 500.
- **The sitting's snapshot, narrowed per request (option B).** When a
  learning session is created the server resolves `off → false; testers →
  tester AND maths AND lesson_learn; everyone → maths AND lesson_learn` and
  stores the answer on `sessions.probing` with `sessions.release_tag`. A
  trigger refuses any later change to either: that row is the record of how
  the sitting OPENED. Every request in a sitting stored ON then re-reads the
  switch and the student's mark (one statement, fail closed) and probes only
  if they still allow it **and neither has changed since the sitting opened**
  — `teaching_settings.updated_at` and the open mark's `marked_at` at or
  before `sessions.opened_at`; a sitting stored off reads nothing and never
  turns on. So Off and un-marking reach the next message; On reaches the next
  sitting (a sitting ends after 30 minutes idle, ADR-0015); and a sitting that
  stopped probing stays stopped. The course half —
  maths only — is applied to the lesson or question actually in front of the
  server.
- **The server is the authority.** `/api/ask` builds the prompt from the
  request's answer and tells the client in the stream's first frame — and a
  turn refused by the cap carries it on its `cap` frame, read from the open
  sitting without touching it (fix pass 2); `/api/attempts` records a retry
  link and the `probe` stance only when the request probes, and returns the
  answer when the attempt was written inside a learn-mode lesson sitting —
  from any other session it says nothing, so the client keeps what the lesson
  last told it (fix pass 2); `ChatCore` starts off and adopts what the server
  declares — and when that turns false
  mid-sitting it drops the pending probe and every held-back card shows its
  answer and worked solution; the whiteboard mirrors ChatCore. No request
  carries a probing flag.
- **Off leaves the tutor's instructions byte-identical.** All 24 learn/review
  prompts (3 subjects × 4 address forms) are compared whole to a capture
  taken before the change, and the reviews compared all 438 captured model
  inputs with probing Off against v0.6.0: identical. The card and the answer
  record take v0.6.0's code paths, selected by the same boolean. That is the
  claim, and no wider one: the stream gains a first frame, and session rows
  gain two columns.
- **Recorded and visible.** Every change to the switch: from, to, who, when
  (append-only). Every mark: who, when, and who removed it (removal stamps, never
  deletes). Every session: its release and its probing answer, a structured
  `[sessions] opened` log line, and chips on the session list, timeline and
  replay. The console header shows the deployed release and the switch on every
  page. `RELEASE_TAG` reads the deployed tag, falling back to `v<version>`.

## Consequences

**Off is a stop on the next message; On waits for the next sitting.** Off (or
removing a mark) is the kill switch it should be — no deploy, no waiting for
sittings to end — and a question card that was holding back its answer shows
it on the student's next message. On never changes a sitting under way, so a
student is never switched into probing between two messages. The price is one
extra read per request **in a sitting that opened with probing on** — today
only test accounts' — and nothing for anybody else.

**A sitting that stopped probing never starts again** *(fix pass 2 — this
replaces the first amendment's "a sitting that opened on, switched Off and then
On again, probes again", which it had called deliberate)*. "Stored AND now" let
Off-then-On resume a sitting mid-lesson, which is On reaching a sitting under
way — what FR-3105 and the `/teaching` copy both say it never does. The rule is
now "stored AND now AND unchanged since the sitting opened", and it needs no new
state: the switch's `updated_at` and the mark's `marked_at` already record
whether anything moved, and un-marking then re-marking makes a NEW mark row
with a later `marked_at`, so it is not the mark the sitting opened under. Any
move of the switch counts, including one between two On positions; Save on the
position already in force writes nothing, so an idle click ends nobody's
probing. The comparison is between transaction start times, so a change whose
transaction straddles a sitting's own opening can end its probing early —
never start it, because the current values must still allow it.

**A session can outlive the lesson it opened on.** ADR-0015 reuses an open
session of the same kind rather than closing it when the lesson changes, so a
maths snapshot can meet an Arabic lesson. `effectiveProbing` narrows at use time
(maths, learn mode) and can never turn a stored `false` on, so this errs only
towards off.

**v0.6.0 cannot be redeployed onto a v0.7.0 database** while any
`teaching-controls` row exists: its migration 014 re-adds the four-value role
CHECK unconditionally on every deploy and Postgres refuses it. **v0.6.1 can**:
it is v0.6.0 plus a guard that rebuilds that CHECK only when it lacks one of
its roles, and v0.7.0's 014 carries the same guard with five — so v0.7.0 is a
safe rollback target for whatever comes next. CI now proves it on every change
to `db/` (job `migrations`: fresh ×3, upgrade from the previous release,
rollback onto it and forward again). The three levers — switch Off, revert and
deploy, and the manual path if v0.6.0 itself is ever unavoidable — are in
[`deploy/DEPLOY-MVP1.md` → "Rolling back"](../../deploy/DEPLOY-MVP1.md#rolling-back).

**The Off path adds one read per learn-lesson session open** (the switch and
the student's own mark, in one statement) and nothing per turn; review,
practice, chat and upload sessions open with no extra query at all. With the
switch Off the lesson's course is never looked up.

**What would trigger revisiting.** #53 closing — the constant flips and the
"stop now" argument above has to be made. A cohort large enough to power an A/B
comparison. And translating the probing strings, at which point "maths only"
becomes a list.

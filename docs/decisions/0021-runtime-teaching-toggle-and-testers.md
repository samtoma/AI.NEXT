# ADR-0021 — Socratic probing becomes a console switch, decided once per lesson, for test accounts first

**Status**: Accepted — Samuel, 2026-09-24
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
3. **Per lesson, stored — chosen.** Resolved once when the learning session
   opens, stored on the session row with the release, and read back by
   everything that behaves differently under probing.

**Where the tester mark lives**

1. **A column on `students`.** Rejected: `ainext_app` holds table-level UPDATE
   on `students` (a student edits her own profile), so the student surface
   could set it under her own principal.
2. **A separate table, RLS-forced, SELECT-only to the app — chosen**, copying
   `student_course_access` (ADR-0018).

## Decision

**Socratic probing is a console switch with three positions, decided once per
lesson by the server, and — until #53 closes — it can reach test accounts and
nobody else.**

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
  2026-09-24: was "every operator holding a role", guarded on the rows only.)* Reading the Teaching page is every operator's:
  it names no student unless the reader holds `student-data`.
- **The tester mark is `student-data`'s**, the Student 360's own role — as the
  per-student course override is — because it names a person. It decides
  nothing by itself; the switch does.
- **Per-lesson snapshot.** When a learning session is created the server
  resolves `off → false; testers → tester AND maths AND lesson_learn;
  everyone → maths AND lesson_learn` and stores the answer on `sessions.probing`
  with `sessions.release_tag`. A trigger refuses any later change to either. A
  reused session keeps what it opened with; a lesson idle for 30 minutes ends
  (ADR-0015) and the next one resolves again.
- **The server is the authority.** `/api/ask` builds the prompt from the stored
  snapshot and tells the client in the stream's first frame; `/api/attempts`
  records a retry link and the `probe` stance only when the session probes, and
  returns the answer; `ChatCore` starts off and adopts what the server declares,
  and the whiteboard mirrors ChatCore. No request carries a probing flag.
- **Off is v0.6.0, byte for byte.** All 24 learn/review prompts (3 subjects × 4
  address forms) are compared whole to a capture taken before the change.
- **Recorded and visible.** Every change to the switch: from, to, who, when
  (append-only). Every mark: who, when, and who removed it (removal stamps, never
  deletes). Every session: its release and its probing answer, a structured
  `[sessions] opened` log line, and chips on the session list, timeline and
  replay. The console header shows the deployed release and the switch on every
  page. `RELEASE_TAG` reads the deployed tag, falling back to `v<version>`.

## Consequences

**A switch flipped mid-lesson reaches the next lesson, not this one.** That is
the point, and it is also the cost: Off is not an instant kill for a lesson in
progress. Because Everyone is locked, the lessons that can be probing at any
moment are test accounts' — the people who asked for it. If probing is ever on
for everyone, "stop now" means Off plus waiting for open lessons to end (at most
30 minutes idle), and that should be re-argued before Everyone is unlocked.

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

**The Off path adds one read per session open** (the switch and the student's
own mark, in one statement) and nothing per turn. With the switch Off the
lesson's course is never looked up.

**What would trigger revisiting.** #53 closing — the constant flips and the
"stop now" argument above has to be made. A cohort large enough to power an A/B
comparison. And translating the probing strings, at which point "maths only"
becomes a list.

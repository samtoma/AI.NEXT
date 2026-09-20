# Quickstart — Identity & Admin Console

**Feature**: `002-identity-and-admin-console` | **Date**: 2026-09-20
**For**: Samuel, on a laptop, today and tomorrow. Nothing here touches the OCI box, the baseline, or
any deployed thing. Deploying the console is a later release (D3).

Run everything from the repository root. Each block is one command, copy-pasteable as it stands.

---

## Today, on `PDR1-0-v0.4.0` — nothing from 002 is built yet

This section works **right now**, before a line of this feature exists. It is here so the two
exposures FR-2104 closes are things you have seen rather than things you were told about.

### 1. Start the student surface

```bash
./scripts/local-dev.sh
```

Idempotent: it creates `ainext_mvp1` if missing, applies the schema and every migration, loads the
curriculum, restores generated content with its review stamps, seeds `'Omar (demo)'` if there are no
students, runs the parity check, writes `app/.env.local`, and serves on **:3000**. You will see
`10 / 90 / 112 / 450 / 212`, `PARITY: GREEN`, then the dev server at
`http://localhost:3000/student`.

### 2. Turn the internal surfaces on, on the same port

```bash
printf '\nAINEXT_INTERNAL_SURFACES=on\n' >> app/.env.local
```

Restart the dev server (Ctrl-C, then `./scripts/local-dev.sh` again). `/admin/content`,
`/admin/cost`, `/pipeline`, `/gallery` and `/dev/*` now resolve. **This is a build-time switch, not a
permission system** — `app/src/lib/env.ts` says so in as many words. There is no person behind it.

### 3. See the first exposure — `/pipeline` shows a student's actual turn

Have a short tutor conversation at `/student`, then:

```bash
open http://localhost:3000/pipeline
```

Scroll to the live-interaction panel: it is showing **the most recent tutor turn written by any
student, with its grounding** — `app/src/lib/pipeline-queries.ts:183-184`, a `SELECT … FROM
ai_interactions ORDER BY created_at DESC LIMIT 1` with no student predicate. Switch students, talk
again, reload: it follows whoever spoke last. That is a conversation, not a counter, and FR-2104
names it.

### 4. See the second — the roster endpoint

```bash
curl -s http://localhost:3000/api/demo-students | head -c 800
```

Every student's id, display name, grade, interests and progress counters, to any caller. It is the
picker's contract working exactly as designed, and it is the seam accounts replace.

### Evidence to collect

- A screenshot of `/pipeline` showing a turn from a student you were not signed in as.
- The `curl` output above, saved.
- `psql -d ainext_mvp1 -c "select count(*) from sessions;"` → **0**. The table has never held a row.

---

## After Phase 0 — learning sessions are real

### Check that new interactions belong to a session

Do a lesson, a chat, an understanding check and an upload, then:

```bash
psql -d ainext_mvp1 -c "select id, kind, opened_at, closed_at, close_reason from sessions order by id desc limit 10;"
```

Then the one that matters:

```bash
psql -d ainext_mvp1 -c "select count(*) as orphans from ai_interactions where session_id is null and created_at > now() - interval '1 hour';"
```

**Expected: 0.** An interaction written after cutover with no session is the P0 gate failing.

### Check that a session closes by inactivity, and says so

Leave a lesson open past the window (30 minutes, or run the sweep by hand), then:

```bash
psql -d ainext_mvp1 -c "select id, kind, close_reason, closed_at - opened_at as duration from sessions where closed_at is not null order by id desc limit 5;"
```

One you finished reads `completed`; one the timeout closed reads `inactivity` (FR-2302).

### Evidence to collect

- The orphan count, zero, after a full journey; one `completed` and one `inactivity` row side by side.
- A `capture-prompts` run diffed against the pre-phase capture → **no diffs**. Session plumbing must
  not change a single prompt.

---

## After Phase 1 — accounts and database-enforced isolation

### Sign up, verify, sign in

```bash
open http://localhost:3000/signup
```

Email, password, name, grade, gender. You are signed in immediately but **unverified**, and the
lesson is refused with a plain message and a resend button. There is no mail server locally: the
verification link is printed to the dev-server console as
`http://localhost:3000/api/auth/verify?token=…` (or in the optional catcher at
`http://localhost:8025`). Paste it, then sign in, reach a lesson, and confirm no surface names or
lists another student.

### Prove RLS — the part worth doing carefully

**Connect as the application role, not as yourself.** Your own account is a Postgres superuser, and
superusers bypass row-level security unconditionally, so a proof run as `$(whoami)` proves nothing.

```bash
psql "postgres://ainext_app@127.0.0.1:5432/ainext_mvp1"
```

Inside that session, three queries — a principal, a different principal, and none:

```sql
BEGIN; SET LOCAL app.student_id = 1; SELECT count(*) FROM attempts; ROLLBACK;
```

```sql
BEGIN; SET LOCAL app.student_id = 2; SELECT count(*) FROM attempts; ROLLBACK;
```

```sql
BEGIN; SELECT count(*) FROM attempts; ROLLBACK;
```

**Expected**: student 1's count, student 2's count, and **0**. The third is the whole decision — a
query with no student scope returns nothing, never everything (FR-2101). Repeat it against
`ai_interactions`, `uploads`, `understanding_checks` and `mastery`; the answer must be 0 every time.

### Confirm the two exposures are gone

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/demo-students
```

**Expected: 404.** The roster is not in the student build at all.

### Evidence to collect

- The three `psql` results, including the zero; the 404 from the roster endpoint; `/pipeline` no
  longer showing any student's turn.
- `select event, count(*) from auth_events group by 1;` — after a signup, a verify, a good sign-in, a
  bad one and five bad ones in a row, every named event you exercised appears.
- `npm --prefix app test` — the isolation suite and the event-emission suite both green.

---

## After Phase 2 — the console on its own port

### Start both surfaces

```bash
./scripts/local-dev.sh --both
```

Student on **:3000**, console on **:3002**, one database, one command (FR-2210, SC-111). To run only
the console:

```bash
AINEXT_SURFACE=admin PORT=3002 npm --prefix app run dev
```

### Get the first operator account

The first operator is seeded from a configured email and holds all four roles (ADR-0014):

```bash
printf '\nAINEXT_BOOTSTRAP_OPERATOR_EMAIL=you@example.com\n' >> app/.env.local
```

Then, idempotently — running it twice grants nothing new:

```bash
npm --prefix app run bootstrap-operator
```

It creates the operator and its four role grants and **sets no password**, so no credential is ever
written into a config file. Get one through the ordinary reset flow at
`http://localhost:3002/forgot-password`; the link is printed to the console server's log, exactly
like the verification link.

### Check what 404s where

```bash
curl -s -o /dev/null -w 'student build /console -> %{http_code}\n' http://localhost:3000/console
```

**Expected: 404** — the route is not in that build at all, not merely hidden (FR-2201).

```bash
curl -s -o /dev/null -w 'console build /student -> %{http_code}\n' http://localhost:3002/student
```

```bash
curl -s -o /dev/null -w 'console, signed out -> %{http_code}\n' http://localhost:3002/console/students
```

**Expected: 404** then **401** — the console build does not serve the student's pages either, and no
console data renders before a role is established.

### Prove a role is a boundary, and that the audit cannot be erased

Create a second operator holding only `content-review`, sign in as them, and try the student list, a
transcript and the cost view — each must refuse. Then open a student's timeline as yourself. Both
leave a record:

```bash
psql -d ainext_mvp1 -c "select occurred_at, event, reason from auth_events where event = 'permission_denied' order by occurred_at desc limit 10;"
```

```bash
psql -d ainext_mvp1 -c "select occurred_at, operator_id, student_id, surface from operator_reads order by occurred_at desc limit 5;"
```

One `operator_reads` row per transcript open, naming who opened whose record. The session **list**
writes none — only opening a transcript does.

### Evidence to collect

- The three status codes above (404, 404, 401), and the `permission_denied` rows for the single-role
  operator, one per refused surface.
- The `operator_reads` rows, and a failed `DELETE` against that table as `ainext_operator`.
- A screenshot of the console's first screen, for the design-system pass (FR-2209).

---

## If something is wrong

| Symptom | Almost certainly |
|---|---|
| The RLS proof returns rows with no principal set | You are connected as a superuser or the table owner. Reconnect as `ainext_app`. |
| A new test never seems to run | `app/package.json`'s `test` script is a hardcoded list, not a glob. Append the file by hand. |
| A migration seems skipped | Migrations apply by alphabetical glob; the prefix must be three digits — `011`, not `11`. |
| Both surfaces fight over a port | The console is `:3002`. `AINEXT_SURFACE=admin` without `PORT` tries `:3000`. |

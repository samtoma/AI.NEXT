# Quickstart — Identity & Admin Console

**Feature**: `002-identity-and-admin-console` | **Updated**: 2026-09-21 (P0–P6 implemented)
**For**: Samuel, on a laptop. Nothing here touches the OCI box, the baseline, or any deployed thing.
Deploying the console is a later release (D3).

Run everything from the repository root. Each block is one command, copy-pasteable as it stands.
Every command below was executed on `feat/002-identity-and-admin-console`; what each one *proves* is
recorded against a requirement in [`traceability.md`](./traceability.md).

---

## Start it

```bash
./scripts/local-dev.sh --both
```

Student on **:3000**, console on **:3002**, one database, one command (FR-2210, SC-111). `--admin`
serves the console alone; no flag serves the student alone.

Idempotent: it creates `ainext_mvp1` if missing, applies the schema and all twenty-two migrations,
loads the curriculum, restores generated content with its review stamps, seeds `'Omar (demo)'` if
there are no students, runs the parity check, writes `app/.env.local`, seeds the first operator and
the local student account, and serves. You will see `10 / 90 / 112 / 450 / 212`, `PARITY: GREEN`,
then both dev servers.

**The application connects as `ainext_app`** — a role that is not a superuser and not the table
owner — so row-level security actually applies. The script repoints `DATABASE_URL` for you. It also
writes `DATABASE_URL_OPERATOR` (the console's connection) and `DATABASE_URL_MAINT` (BYPASSRLS,
scripts only, never the app).

### Who you can sign in as

| Where | Email | Password | What it is |
|---|---|---|---|
| Student, `:3000` | `omar@local.test` | `omar-local-test` | The seeded account bound to `'Omar (demo)'`, pre-verified. `app/scripts/seed-local-account.mts` refuses to run anywhere but localhost. |
| Console, `:3002` | `samuel.s.toma@gmail.com` | `ConsoleLocal!2026` | The bootstrap operator, all four roles. Local only — this password exists on this laptop and nowhere else. |
| Console, `:3002` | `cost-only@local.test` | `CostOnly!2026` | One role, `cost-billing`. The one to sign in as when you want to see a refusal. |

The operator is seeded with **no password** (`npm --prefix app run bootstrap:operator`, idempotent —
running it twice grants nothing new). The passwords above were set through the ordinary reset flow
at `http://localhost:3002/forgot-password`; do the same for any operator you add.

### From the iPad, over the tailnet

The dev servers bind all interfaces. Next 16 refuses cross-origin dev requests unless the host is
listed, so `app/.env.local` carries `AINEXT_DEV_ORIGINS` (comma-separated, wildcards allowed) and
`next.config.ts` feeds it to `allowedDevOrigins`. `AINEXT_PUBLIC_URL` and `AINEXT_CONSOLE_URL` carry
the tailnet name too, so a verification or reset link opens from the device that asked for it.

Student `http://macbook-pro.tail9c994e.ts.net:3000`, console `…:3002`. **HTTP only** — this tailnet
has no HTTPS certificates. Cookies are `Secure` only in production, so sign-in works over plain HTTP
here and would not on the box.

---

## Sign up, verify, sign in

```bash
open http://localhost:3000/signup
```

Email, password, name, grade, and two optional fields: how Noor should talk to you, and what you are
interested in. You are signed in immediately but **unverified**, and a lesson is refused with a plain
message and a resend button — verification gates *learning*, not signing in, so you can still look at
`/spine`.

There is no mail server on a laptop. `AINEXT_MAIL_TRANSPORT=console` prints the verification link to
the dev-server log and writes it under `app/.local-mail/`:

```bash
ls -t app/.local-mail | head -3
```

Open the newest file, paste the link, and you are verified.

---

## Prove the isolation — the part worth doing carefully

**Connect as the application role, not as yourself.** Your own account is a Postgres superuser, and
superusers bypass row-level security unconditionally, so a proof run as `$(whoami)` proves nothing.

```bash
psql "postgres://ainext_app:ainext_app@127.0.0.1:5432/ainext_mvp1"
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
query with no student scope returns nothing, never everything (FR-2101). Repeat against
`ai_interactions`, `uploads`, `understanding_checks` and `mastery`; the answer must be 0 every time.
The scripted version of the same proof is `app/scripts/rls-proof.sql`.

Then the adversarial pass — two accounts, a cookie jar each, every student route:

```bash
./scripts/red-team-isolation.sh http://localhost:3000
```

**45 checks, all PASS.** It is idempotent and cleans up after itself. One caveat that is not a
defect: it deliberately burns five failed sign-ins into the shared IP throttle bucket (20 per 15
minutes). Three back-to-back runs from one IP exhaust it and the fourth run starts seeing 429s —
that is the throttle working. Wait for the window, or clear the bucket as the maintenance role:

```bash
psql "postgres://ainext_maint:ainext_maint@127.0.0.1:5432/ainext_mvp1" \
  -c "DELETE FROM auth_throttle WHERE scope = 'ip';"
```

The two old exposures are gone, and not merely hidden:

```bash
curl -s -o /dev/null -w 'roster -> %{http_code}\n' http://localhost:3000/api/demo-students
curl -s -o /dev/null -w 'pipeline -> %{http_code}\n' http://localhost:3000/pipeline
```

**Expected: 404, 404.** Neither route is in the student build's manifest.

---

## The console

Sign in at `http://localhost:3002/` as the four-role operator. The landing page is the student list;
`cost-billing` alone sees a projection of it with no content column.

| Path | What it is |
|---|---|
| `/students/1` | Student 360 — profile, BKT trajectory, attempts and accuracy, time on task as two numbers never blended, sessions, help-seeking, misconceptions, imputed cost, subscription (read-only unless you hold `cost-billing`), safety flags as type and time only, sign-in history, and the audit panel of who opened this record |
| `/students/1/sessions` | The session list. Metadata only, and it writes **no** audit row |
| `/students/1/sessions/<id>` | The one-order timeline: tutor turns, attempts, widget outcomes, understanding checks, uploads, mastery movements and explanations, merged, with gaps over 60 s shown as items |
| `/students/1/sessions/<id>/replay` | The reconstructed replay, in the student's own renderers made read-only, labelled "Reconstructed from stored records" with occurred-at, model and renderer version per turn |
| `/security` | Sign-ins, failures, lockouts, denials, top source IPs, active sessions, and the operator-read audit — force-dynamic, so an attempt shows within seconds |
| `/cost` | AI spend and upload/OCR spend as separate figures, per-student sparklines, the reconciliation line, an outcome breakdown. Every figure says "imputed at list price" |
| `/overview`, `/overview/definitions` | Cohort overviews on school-year weeks, the 90-objective heatmap, and the metric dictionary the queries cite by name |
| `/content`, `/pipeline`, `/gallery`, `/dev/*` | The four operator surfaces re-homed from the student build |

### Check what 404s where

```bash
curl -s -o /dev/null -w 'student build /students -> %{http_code}\n' http://localhost:3000/students
curl -s -o /dev/null -w 'console build /student -> %{http_code}\n' http://localhost:3002/student
```

**Expected: 404 and 404** — each build is missing the other's routes entirely, not hiding them. The
same guarantee is asserted from the build artefact, and that assertion runs in CI:

```bash
npm --prefix app run check:surface
npm --prefix app run check:surface:admin
```

### Prove a role is a boundary, and that the audit cannot be erased

Sign in as `cost-only@local.test` and try `/security`, `/students/1` and a transcript. Each refuses
and renders none of the page. Then open a student's 360 as yourself. Both leave a record:

```bash
psql -d ainext_mvp1 -c "select occurred_at, event, reason from auth_events where event = 'permission_denied' order by occurred_at desc limit 10;"
```

```bash
psql -d ainext_mvp1 -c "select occurred_at, operator_id, student_id, surface from operator_reads order by occurred_at desc limit 5;"
```

One `operator_reads` row per 360, timeline and replay open, naming who opened whose record. The
session **list** writes none. `ainext_operator` holds `SELECT` and `INSERT` on that table and nothing
else, so an operator cannot remove their own row — worth confirming for yourself:

```bash
psql "postgres://ainext_operator:ainext_operator@127.0.0.1:5432/ainext_mvp1" \
  -c "DELETE FROM operator_reads WHERE id = (SELECT max(id) FROM operator_reads);"
```

**Expected: permission denied.** (This is the one check in this document that no smoke script runs —
FR-2306 is PARTIAL in the matrix because of it.)

---

## Sessions, cost and alerts

Every interaction now belongs to a real session row. After a lesson, a chat, an understanding check
and an upload:

```bash
psql -d ainext_mvp1 -c "select id, kind, opened_at, closed_at, close_reason from sessions order by id desc limit 10;"
```

Then the one that matters:

```bash
psql -d ainext_mvp1 -c "select count(*) as orphans from ai_interactions where session_id is null and created_at > now() - interval '1 hour';"
```

**Expected: 0.** An interaction written after cutover with no session is the P0 guarantee failing.
(Pre-cutover rows are deliberately NULL rather than attached to the nearest session — FR-2309.)

Roll yesterday's cost into `cost_daily`. Idempotent, and it deliberately leaves today open:

```bash
npm --prefix app run rollup:cost
```

Evaluate the security alert rules. Each rule fires once per window; with `AINEXT_ALERT_EMAIL` unset
nothing is mailed and everything is logged:

```bash
npm --prefix app run alerts:sweep -- --dry
```

---

## The prompts, and the tutor's voice

The prompt byte-identity harness runs as documented and covers 234 files:

```bash
npm --prefix app run capture:prompts
```

Capture before a change, capture after, diff the two directories. Anything that is not a prompt
change must produce **no diffs** — that is constitution IX, and it is how P6 proved that changing the
address register changed nothing else.

The tutor addresses a student by the register she chose, and a change takes effect on the next turn
with no sign-out (FR-2606). To watch it happen:

```bash
psql -d ainext_mvp1 -c "update students set gender = 'female' where id = 1;"
```

Ask Noor something at `/student`. Then set it back to NULL and ask again — the reply changes register
without a sign-out, because the prompt-snapshot cache keys on `f|m|n` rather than on the stored value.

---

## The smoke scripts

Six scripts, one per phase, each printing `PASS|FAIL <FR> <what>` and exiting non-zero on any FAIL.
They speak HTTP to servers that are already running and never start, build or kill one.

```bash
./scripts/red-team-isolation.sh http://localhost:3000     # P1 — 45 checks
./scripts/console-smoke.sh                                # P2 — 53 checks
./scripts/console-p3-smoke.sh                             # P3 — 45 checks, spends one real turn
./scripts/console-p4-smoke.sh                             # P4 — 54 checks, one real turn + one upload
./scripts/console-p5-smoke.sh                             # P5 — 68 checks
./scripts/voice-p6-smoke.sh                               # P6 — deterministic checks only
```

P6's three live turns are **off by default**, because a smoke test that gets re-run casually must not
quietly spend model money every time (roughly $0.70 for the three):

```bash
AINEXT_SMOKE_LIVE_TURNS=1 ./scripts/voice-p6-smoke.sh
```

All six are idempotent: each deletes its own throwaway accounts and everything hanging off them at
both start and end. None of them touches Omar's history.

---

## What is not configured locally

Three things are built and inert. Each has a stand-in, and each is a row in
[`SETUP.md`](./SETUP.md) that only Samuel can close.

| Not configured | Env vars | What you see instead | Setup |
|---|---|---|---|
| **Google sign-in** | `AINEXT_GOOGLE_CLIENT_ID`, `AINEXT_GOOGLE_CLIENT_SECRET`, `AINEXT_GOOGLE_REDIRECT_URI` | The button renders disabled: "Google sign-in not configured". The callback has never been reached — FR-2006 is the one BUILT row in the matrix | **S1** (and **S13**, **S15**) |
| **SMTP** | `AINEXT_SMTP_URL`, `AINEXT_MAIL_FROM` | `AINEXT_MAIL_TRANSPORT=console`: every link goes to the dev-server log and `app/.local-mail/`. Nothing has ever been sent to a real address | **S2** |
| **GA4** | `AINEXT_GA_MEASUREMENT_ID` | No script renders on any surface, student or console. The allow-list and the consent defaults are asserted by unit tests only | **S7**, **S22** |

---

## If something is wrong

| Symptom | Almost certainly |
|---|---|
| The RLS proof returns rows with no principal set | You are connected as a superuser or the table owner. Reconnect as `ainext_app`. |
| Sign-in suddenly 429s | The shared IP throttle (20 failures / 15 min) — heavy testing from one address. Wait for the window or clear `auth_throttle` as `ainext_maint`. |
| A new test never seems to run | `app/package.json`'s `test` script is a hardcoded list, not a glob. Append the file by hand. |
| A migration seems skipped | Migrations apply by alphabetical glob; the prefix must be three digits — `011`, not `11`. |
| Both surfaces fight over a port | The console is `:3002`. `AINEXT_SURFACE=admin` without `PORT` tries `:3000`. The dev-server lock is per `distDir`, which is why two can coexist at all. |
| A page opened over the tailnet loads no styles | The host is not in `AINEXT_DEV_ORIGINS`. Add it and restart. |
| A console refusal answers HTTP 200 | As built — React Server Components cannot set a status without Next's `experimental.authInterrupts`. The body is a refusal and renders none of the page; API refusals are real 401/403 (**S19**). |

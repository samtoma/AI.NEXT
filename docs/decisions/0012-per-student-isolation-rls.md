# ADR-0012 — Per-student isolation is enforced by the database

**Status**: Accepted — Samuel, 2026-09-20, in the identity & admin-console brainstorm — *"row level security indeed, same as reletix"*
**Affects**: `app/src/lib/db.ts` · `app/src/lib/pipeline-queries.ts` · `app/src/lib/uploads.ts` · `deploy/docker-compose.mvp1.yml` and `deploy/docker-compose.local.yml` (the `DATABASE_URL` repoint) · `scripts/local-dev.sh` · every migration from `011` onward · `FR-2101…FR-2199` · constitution v3.1.1 Principles VII and XI
**Depends on**: [ADR-0013](./0013-student-accounts-and-sign-in.md) — there is no principal to set until accounts exist

## Context

Isolation today is a convention. `resolveStudentId()`
(`app/src/lib/student-context.ts`) validates a cookie against `students` and
returns a number; every query touching student data then carries
`WHERE student_id = $1` because whoever wrote it remembered to.
`app/src/lib/db.ts` is thirteen lines and exports a bare `pool`, so there is no
place where the rule could be applied once.

That is adequate for a picker with five demo students and inadequate for real
accounts. The failure mode is not exotic: one new endpoint, one forgotten
clause, and a fourteen-year-old's conversation is served to a different one.

**It is also not hypothetical.** R3's inventory
(`specs/002-identity-and-admin-console/research/codebase-seams.md` §1) found two
reads on student-scoped data that scope to no student and are gated only by the
build-time flag. **`app/src/lib/pipeline-queries.ts:183-184`** returns the most
recent `ai_interactions` row — any student, with its `grounding` — to the
`/pipeline` page: the most concrete cross-student content exposure in the
repository, and it is a tutor turn, not a counter. **`GET /api/demo-students`**
returns every student's id, name, grade, interests and counters to anyone who
can reach the app. The second is not a bug in today's scope — it is the picker's
contract — but it states the underlying problem exactly: **there is no concept
of "my own row" at the data-access layer at all.** Both close under this
decision, and the requirements name them explicitly.

**The reference Samuel named does not do what he asked for.** R1 verified
TalentReletix against its own code (`specs/002-identity-and-admin-console/research/talent-reletix-auth.md` §4):
there is no `ROW LEVEL SECURITY` and no `CREATE POLICY` anywhere in its Alembic
history. Its `DATA_ARCHITECTURE.md` says so in its own words — `company_id` is on
every tenant table and every query filters on it, *"recently hardened by PR #63
IDOR fixes"*. "Recently hardened" is the tell: the discipline exists because a
cross-company IDOR was found and fixed by hand, not because the database ever
refused the query. So the words pointed at a property, not an implementation.
That property — **a forgotten filter returns nothing, never another student's
rows** — is what this ADR adopts, and it is stronger than what Talent has. We are
not copying Talent's isolation model; we are closing the class of bug that model
has already been shown to be vulnerable to, by moving the guarantee into Postgres.

Constraints that shaped the choice: roughly 50 pilot families and ~200 students
at the target scale, one OCI box, one Postgres 17 instance, a content set that
`scripts/parity_check.py` must keep checking, and constitution v3.1.1 Principle
XI's requirement that every row say which environment produced it.

## Options considered

**(a) One database per student.** Isolation by construction, and nobody can
forget to apply it. At 200 students: every migration runs 200 times and can
half-fail across the set, a pool per database or a proxy in front, the
450-question curriculum duplicated 200 times, and a running cost that scales with
enrolment rather than usage. Rejected — the guarantee is real, the operational
bill is not payable by three founders.

**(b) One schema per student.** One database, 200 schemas, `search_path` per
request. Cheaper than (a) on connections and backups; still 200× migrations, and
the shared curriculum needs a common schema with cross-schema keys. Rejected now,
**retained as the migration path** (see Consequences).

**(c) Application-level filter only — today's model, and Talent's.** Free, already
built, and its failure mode is PR #63 with a minor's transcript on the other side
of it. Rejected.

**(d) Postgres row-level security on one database.** One migration run, one
backup, one parity check. The principal is set on the connection for the unit of
work that needs it and the database refuses rows that do not match, so a
forgotten `WHERE` returns zero rows instead of somebody else's. Costs: student-data queries run
inside a transaction carrying the principal, and the app and the loaders each
need a database role of their own. **Chosen.**

## Decision

**Row-level security is enabled — and forced — on every student-scoped table,
with the principal set on the connection for the unit of work that needs it, by
an application role that cannot bypass a policy.**

**The tables.** Confirmed against `db/schema.sql` and `db/migrations/002…010`:
`students`, `attempts`, `mastery`, `sessions`, `ai_interactions`,
`analytics_events`, `safety_flags`, `uploads`, `understanding_checks`, plus the
account and operator-audit tables added by ADR-0013 and ADR-0015.

`explanation_log` is the exception, stated here rather than discovered later:
**it has no `student_id` column.** It hangs off a nullable `attempt_id`, so its
policy is a subquery through `attempts`; a NULL `attempt_id` belongs to no
student and is reachable only by the operator role.

**The application stops connecting as a superuser — without this the rest is
decoration.** Superusers and `BYPASSRLS` roles bypass policies unconditionally;
the owner bypasses them unless `FORCE ROW LEVEL SECURITY` is set. Today the app
connects as `ainext` (the `POSTGRES_USER` in `deploy/docker-compose.mvp1.yml`)
and as `$(whoami)` locally (`scripts/local-dev.sh`) — both superusers. Three
things are load-bearing together, and shipping two is worse than shipping none:
a **non-superuser, non-owner `ainext_app` role**; **`ENABLE` and `FORCE ROW LEVEL
SECURITY`** on every table above; and **`DATABASE_URL` repointed at
`ainext_app`** in both compose files and the `.env.local` the local script
writes. Until the repoint lands the policies are inert and the system looks
protected while refusing nothing — which is why the isolation test runs **as
`ainext_app`**: run as owner or superuser it proves the opposite of its claim.

**Setting the principal.** Transaction-scoped, `SET LOCAL`, inside the
transaction that does the work — never a session-level `SET`. A pooled
connection outlives the request that borrowed it, and a session-level setting is
how one student's principal survives into the next student's query.

The codebase does not support that today, and the gap's shape is known exactly
(seams §3): `app/src/lib/db.ts` is one module-level `Pool` (`max: 5`) called as
`pool.query()` from ~15 modules with no injected client to hang a principal on;
the only transaction-scoped path in the whole application is
`app/src/app/api/attempts/route.ts`; and three writes — `emit`, `parseUpload`,
`flagAuthoringGap` — run **detached from any request**, on whatever connection
the pool hands out, often after the response has been sent. A `SET LOCAL`
principal reaches none of them. The decision stands anyway: it is the right
mechanism, and the restructuring is its price, stated in Consequences.

**Fail-closed.** With no principal set the policy matches nothing and the query
returns zero rows; the default is never "all rows". A page that renders empty is
a bug someone reports; a page that renders the wrong child is a breach nobody
notices.

**Operator access is a different database role, not a wider setting.** Operators
read student data through a distinct role with its own policy path, and every
such read writes an audit row (ADR-0015). Letting the student role impersonate an
operator by setting a flag would put the boundary one mistaken assignment away
from collapse.

**Cross-student reads answer 404, not 403** — Talent's one rule worth porting
verbatim (`TEN-002`, R1 §3), and under RLS the read path gets it nearly free: the
row is not visible, so a cross-student id and a nonexistent id are
indistinguishable. The write path still needs hand-written code to turn a blocked
write into a 403 and a `cross_student_access_denied` event, not a database error.

**`environment` stays mandatory and separate.** RLS answers *whose row is this*;
`environment` answers *which build produced it* (constitution v3.1.1 Principle
XI). Two questions, two mechanisms, neither standing in for the other.

## Consequences

**A principal-scoped client wrapper has to exist, and everything moves onto it.**
The plan introduces one — a `withPrincipal(studentId, fn)`-shaped seam that
checks out a client, opens a transaction, sets the principal, runs the callback
and releases — and the ~15 modules importing the bare `pool` migrate onto it.
**It wraps a unit of work, not a whole request:** `/api/ask` streams for tens of
seconds, so the ask path takes the principal for its pre-turn reads, releases,
calls the model, then takes it again for the ledger write. A connection held for
the life of that request is pool exhaustion with extra steps.
`app/src/app/api/attempts/route.ts` already has the right shape and is the
natural first anchor. The bare `pool` export must eventually go: while it exists
it is the hole the policies were written to close.

**Detached writes carry the principal explicitly.** `emit`, `parseUpload` and
`flagAuthoringGap` run after their request has returned and inherit nothing; each
is passed the student id and opens its own principal-scoped transaction.
`parseUpload` is the sharp one — its two queries (`app/src/lib/uploads.ts:172-176`
and `:188-191`) do not predicate on `student_id` at all today.

**Connection accounting changes.** `max: 5` is sized for a pool that lends a
connection per query. Holding a client for a unit of work, plus detached writes
holding their own, makes pool exhaustion a live failure mode. The plan sizes it.

**Cross-student aggregates need an explicit operator path.** `/admin/cost` reads
across students by design (`app/src/lib/cost-queries.ts`) and a naive per-student
policy would make it return nothing. It runs under the operator role with an
aggregation policy, gated by the `cost-billing` role (ADR-0014) — never by
widening the student policy.

**The loaders and the extraction pipeline connect as a non-RLS maintenance
role**, and so does `scripts/parity_check.py` if it ever grows a student-data
assertion (today it reads only content tables, which get no policies). They load
curriculum, not student data, and must not hold a principal they have no
business holding. `deploy/docker-compose.mvp1.yml` gives the `loader` service
the same `ainext` user as the app today — that stops being true, and the compose
file gains a second credential.

**Tests must prove the negative, as `ainext_app`.** A test that passes because
the filter is present proves nothing about RLS, and one run as a superuser proves
less than nothing. The obligation is a test that *omits* the filter and asserts
zero rows, plus one asserting that no principal sees nothing — both as the
application role. `app/package.json`'s `test` script is a hardcoded list of eleven
files (seams §9): a new test file not appended to it by hand never runs, in CI
or anywhere else.

**What would trigger revisiting.** A school-district or ministry contract that
demands physical separation of one cohort's data. Schema-per-tenant — option (b)
— is the migration path, and policies written against a settable principal port
to it far more cheaply than hand-written `WHERE` clauses would.

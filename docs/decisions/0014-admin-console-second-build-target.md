# ADR-0014 — The admin console is a second build target of one codebase

**Status**: Accepted — Samuel, 2026-09-20, in the identity & admin-console brainstorm (decisions D3, D4)
**Amends**: nothing
**Affects**: `FR-605` and `FR-606` in `specs/001-student-mvp1-delta/spec.md` · `app/src/lib/env.ts` · `app/src/app/admin/layout.tsx` and `app/src/app/dev/layout.tsx` · `scripts/local-dev.sh` · `deploy/docker-compose.mvp1.yml` · `.github/workflows/ci-cd.yml` · `FR-2201…FR-2299` · constitution v3.1.0 Principles III, X and XII
**Depends on**: [ADR-0013](./0013-student-accounts-and-sign-in.md) — a role has to attach to an account

## Context

FR-605 shipped in `PDR1-0-v0.4.0` after feedback #10, #11 and #12: a student
opening the build was given "Pipeline", "Content" and "Evidence Walk" in the
same navigation bar as "Study". The fix was a build-time switch —
`AINEXT_INTERNAL_SURFACES` → `INTERNAL_SURFACES` in `app/src/lib/env.ts`, read
by `app/src/app/admin/layout.tsx` and `app/src/app/dev/layout.tsx`, which
`notFound()` when it is off. It gates `/pipeline`, `/admin/*`, `/gallery` and
`/dev/*`.

The source comment is unusually clear about what it is not:

> This is NOT a permission system and must not be mistaken for one. Roles need
> accounts (#7, #8, FR-106, DEFERRED), and until those exist the honest thing is
> a build-time switch rather than a login-shaped thing that checks nothing.

FR-606 is the requirement that asks for the real thing — per-person
authorisation, distinguishing at minimum content review from evidence access —
and it is BLOCKED on accounts, which ADR-0013 now provides. Samuel wants the
console as its own release: trivial to test locally today and tomorrow, deployed
to OCI later.

The flag's limits are not theoretical. `/pipeline` is gated by it and nothing
else, and `app/src/lib/pipeline-queries.ts:183-184` shows that page the most
recent `ai_interactions` row — any student, with its `grounding`
(`specs/002-identity-and-admin-console/research/codebase-seams.md` §1). A build
flag cannot tell the person reading that turn from the person who should not be.

## Options considered

**(a) One app, one build, a role gate only.** The simplest thing, and it is
wrong for a stated reason rather than a stylistic one. FR-605 is a **build-scope**
obligation — *"those routes MUST NOT resolve in that build, so a guessed or
shared URL reaches nothing."* A role check runs *after* the route resolves. It
answers a different question, and adopting it would quietly drop a requirement
that shipped six days ago. Rejected.

**(b) A separate repository or a separate application.** Cleanest separation on
paper. It duplicates the authentication path, the database access layer and the
design system — which constitution v3.1.0 Principle XII now binds on the
internal surfaces too — and guarantees drift between two copies of the same
session logic. Talent's
architecture document describing a `require_role` its code does not have (R1 §3)
is that failure with one repository; two would make it structural. Rejected.

**(c) One codebase, `AINEXT_SURFACE=student|admin` selecting which route tree is
compiled and served, on its own hostname, behind Cloudflare Access at the edge
*and* account + role inside.** Chosen.

## Decision

**One codebase, two build targets, four roles, two layers of defence.**

`AINEXT_SURFACE` ∈ `student | admin` decides which route tree a build carries.
The student build does not contain the operator routes at all, which is what
FR-605 asks for; the admin build contains them and refuses anyone without the
matching role, which is what FR-606 asks for.

**Defence in depth, with each layer doing its own job.** Cloudflare Access
proves you are on the invite list. The account and role prove you are permitted
to see this surface. Neither is asked to do the other's work. R1 §8 records what
a single layer looks like when it fails: Talent's `/debug/*` endpoints sit behind
an environment flag and no role check at all.

**The four roles**, per person, granted deliberately, never inherited from
knowing a URL:

- **`content-review`** — the human gate that ADR-0007's unreviewed-content
  exception and constitution v3.1.0 Principle III depend on. **This is a safety
  control, not an administrative convenience**: whoever holds it decides what
  unreviewed, pipeline-generated content reaches a child. Named as such so it is
  never swept into a general "admin" grant along with the right to read a log.
- **`evidence-access`** — extraction provenance and the evidence walk. Reads
  content, not students.
- **`student-data`** — interaction replay and student 360. The highest privilege
  in the system, because it reads a minor's conversation. Every read is audited
  ([ADR-0015](./0015-interaction-timeline-and-replay.md)). **The `/pipeline`
  leak is the first thing this split closes**: reading extraction provenance is
  `evidence-access` and needs no student's turn on the page, so that query stops
  being served to whoever happens to hold a pipeline URL.
- **`cost-billing`** — spend, budgets, per-student subscription status. Reads no
  student content, by design and by the queries it is permitted.

Enforcement is server-side at **one seam** — a single guard every operator route
goes through, per ADR-0013's second departure. No per-page checks, and nothing
in the client is a boundary.

**What moves behind the admin surface**: `/pipeline`, `/admin/*`, `/gallery`,
`/dev/*`, plus the new cost, student-360, interaction-timeline, auth-monitoring
and analytics views.

**`/spine` stays student-facing.** Settled 2026-09-20 and not reopened here: the
lesson report sends students to it, and feedback #15 asked for more of it, not
less.

**The console's interface is bound by the design system.** Constitution v3.1.0
Principle XII makes the published Noor Play system the visual authority for
**every surface we build, the internal tools included** — the carve-out ADR-0011
held for `/admin`, `/pipeline`, `/spine`, `/dev` and `/gallery` is withdrawn. So
the console is built from the published tokens, every coloured background uses
its paired `on-` foreground, and a deliberate departure is an ADR rather than a
local override. An internal tool may lag the system; it may not diverge from it
on purpose. This is a real cost — the operator surfaces have had no design pass
at all — and it is named here so nobody budgets the console as chrome-free.

**Local, today**: student on `:3000` and admin on `:3002` from one
`./scripts/local-dev.sh` run against the one `ainext_mvp1` database. The
mechanics belong to the plan and `quickstart.md`; the obligation this ADR fixes
is that the second surface costs one command, not a second checkout and not a
second database.

**OCI, later**: a second compose service and a second hostname beside the
existing `127.0.0.1:3101`, never touching another solution (v3.1.0 X, ADR-0010).

## Consequences

**`AINEXT_INTERNAL_SURFACES` is honoured for one release and then removed.** Two
flags that both decide route scope is how a surface ends up enabled by one and
disabled by the other. Removal lands in the release after the console ships;
**owner Samuel, at that release's cut** — it is not left open-ended.

**CI builds two targets per solution branch.** `.github/workflows/ci-cd.yml`
gains a second build, and `docs/BRANCHING.md`'s rail applies: a workflow change
made on one solution branch must be made on every one, or the copy that drifts
is the one that misbehaves in production.

**The four roles have to be seeded, and there is no picker to bootstrap from.**
The **first operator is Samuel**, granted all four roles by an **idempotent
bootstrap script**, keyed on an email address supplied in configuration
(`AINEXT_BOOTSTRAP_OPERATOR_EMAIL`) and run by `scripts/local-dev.sh` and by the
deploy runbook. It is a script and not a `.sql` migration for a mechanical
reason worth stating: migrations are applied by an alphabetical glob and a bare
`.sql` file cannot read configuration, so the email would have to be hard-coded
into the repository. The script **seeds no password** — Samuel obtains one
through the ordinary reset flow, so no credential ever sits in a config file —
and re-running it grants nothing new. Deliberately not a UI: a screen that hands
out roles before anyone holds one is a screen that hands out roles to anyone.

**The student build stops carrying operator code at all.** Smaller bundle,
smaller attack surface, and FR-605 becomes provable from a build artifact rather
than from a runtime assertion — which is a stronger proof than the one it has
today.

**`app/src/lib/env.ts` becomes wrong the day this lands.** Its comment describes
a world in which roles do not exist and a build-time switch is the honest
answer. It is the first file to update, not the last.

**What would trigger revisiting.** The console being operated by someone who is
not a founder — a school's own staff administering their own cohort. That is a
tenancy question rather than a packaging one, and it reopens ADR-0012's
schema-per-tenant option before it reopens this decision.

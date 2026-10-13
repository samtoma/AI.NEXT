# ADR-0024 — A staging environment on the production box

**Status**: Accepted — Samuel, 2026-10-11: *"now I want to create staging branch, with this branch we create a deployement on the ubuntu server, but in another container, and this container is also localhost, with tunnel from cloudflare and then only users who has permission can access, it will be staging-noor.reletix.com, for this we don't care about migration and keeping the data, each deployement has no problem to start as a fresh server, yet the only persistent thing is the claude authentication that we need to keep"*
**Amends**: [ADR-0010](./0010-one-branch-per-solution.md) Amendment — `main` is the single *development* branch. `staging` is **not** a second development branch; it is a deployment target that carries `main` plus its own deploy configuration. · `deploy/TAKEOVER.md` — a third stack now shares the box, and the runbook's "what runs here" inventory grows by one.
**Affects**: `deploy/docker-compose.staging.yml` (new) · `.github/workflows/deploy-staging.yml` (new) · `deploy/STAGING.md` (new) · `app/src/lib/env.ts` (the environment set gains a third member) · `db/migrations/033-staging-environment-seed.sql` (new) · `docs/BRANCHING.md` · `deploy/TAKEOVER.md`
**Depends on**: [ADR-0007](./0007-student-mvp1-comparison-build.md) (the environment tag on every row), [ADR-0018](./0018-course-availability.md) (the course gate is per-environment), [ADR-0022](./0022-console-signin-from-cloudflare-access.md) (the console's identity comes from the Access assertion, so a staging console needs its own Access application and its own AUD)
**Amended**: 2026-10-11, the same day, during the setup itself — the access posture. This ADR first put **both** staging hostnames behind Cloudflare Access; Samuel settled it the other way once the applications were in front of him, and staging now mirrors production exactly: **student surface open, console gated**. See [Access — staging mirrors production's posture](#access--staging-mirrors-productions-posture-student-open-and-console-gated), which also records the two Cloudflare distinctions that made the original setup confusing.

## Context

Everything shipped so far has been proven in exactly two places: a laptop, and
`noor.reletix.com` with real pilot families on it. There has been nowhere to put a change that is
finished but not trusted — no place to click through a release the way a student will, on the real
box, over the real tunnel, against a real Postgres, before it reaches anybody.

The box already runs three things that matter: `talent.reletix.com` (a different product, in
production), the Mailu mail stack that the whole zone's mail depends on, and
`noor.reletix.com` + `admin-noor.reletix.com`. Any fourth stack has to be unable to disturb them,
and the mechanism has to be strong enough that a tired person running the wrong command at the
wrong hour still cannot take the student site down.

Samuel's framing settles the two questions that usually make a staging environment expensive. Data
is **disposable** — a deploy may start from an empty database, so there is no migration path to
preserve, no backup to take, no fixture to keep in sync. And exactly one thing is **not**
disposable: the interactive `claude` CLI login, because re-obtaining it costs a human a browser
round trip and cannot be automated (`deploy/TAKEOVER.md` §5).

## Options considered

**(a) A second box.** Total isolation, nothing shared, nothing to guard. Rejected on cost and on
fidelity in the same breath: a staging environment on different hardware stops answering the
question staging exists to answer — "does this work *there*" — and the box has 85 GB free.

**(b) A branch of the production compose file, run with a different `-p`.** Reuse
`docker-compose.mvp1.yml` and override the project name on the command line. Rejected: the file
hardcodes its own `name: ainext-mvp1`, the database name, both image tags, the console's
`container_name` and both host ports. An invocation that forgot one flag would bind port 3101,
reuse the production image tag, or point at the production database. The isolation would live in
the operator's muscle memory, which is exactly where it must not live.

**(c) Parameterise the production compose file with `${VAR}` defaults and feed it two env files.**
One file, no drift between environments. Rejected *for now*: it edits the file that serves pilot
families in order to build something for ourselves, and it makes every future production deploy
depend on variable resolution that has never been exercised. The right time for this is a quiet
week with staging already standing to prove it on.

**(d) A separate, fully-qualified `docker-compose.staging.yml`, and a separate workflow.** Every
identifier distinct by construction — project, database, image tags, container names, ports,
volumes, deploy directory. Nothing production reads is touched. The cost is a second file that can
drift from the first. **Chosen**, with the drift accepted and recorded below.

## Decision

**A second, fully isolated stack runs on the same box, rebuilt from nothing on every push to the
`staging` branch, keeping only its Claude login.**

### What is isolated, and how

| | production | staging |
|---|---|---|
| Compose project | `ainext-mvp1` | `ainext-staging` |
| Deploy directory | `/opt/reletix/AI.NEXT-mvp1` | `/opt/reletix/AI.NEXT-staging` |
| Database | `ainext_mvp1` | `ainext_staging` |
| Image tags | `ainext-mvp1-app`, `-loader` | `ainext-staging-app`, `-loader` |
| Loopback ports | 3101 student, 3102 console | **3201** student, **3202** console |
| Hostnames | `noor.reletix.com`, `admin-noor.reletix.com` | `staging-noor.reletix.com`, `admin-staging-noor.reletix.com` |
| Environment tag | `mvp1` | **`staging`** |
| Deploy trigger | `workflow_dispatch` only (T139) | push to `staging`, plus dispatch |

Not one of those values is shared, and none is supplied by the person running the deploy — they are
properties of two different files. The workflow's first step refuses to run at all unless the
project is `ainext-staging` and the deploy directory is the staging one, so the guard fires before
any destructive command exists in the shell.

Both stacks keep the single `concurrency: deploy-oci` group, so a staging deploy and a production
deploy can never be on the box at the same time.

### Data is disposable, and the deploy says so out loud

Every staging deploy runs `down -v` first and builds the database from `db/schema.sql` plus every
migration in order, then loads the curriculum and the generated maths content the way the
production deploy does. There is no upgrade path to protect, so the fresh path is the only path
that is ever exercised — which incidentally means **staging tests the from-scratch install on every
push**, the one scenario production's own deploy never runs.

`down -v` is forbidden on production and normal here. That inversion is the sharpest edge in this
decision, and it is why the guard step exists and why both compose files carry the warning in the
form that is correct for them.

### Secrets are generated per deploy, and staging needs none of ours

Because the cluster is re-initialised every time, the workflow generates `POSTGRES_PASSWORD`, the
HS256 `AINEXT_AUTH_SECRET` and the three distinct role passwords with `openssl rand -hex 32` on
every run. Staging therefore reads **no GitHub secret**, and no production credential is present
anywhere in the staging stack. This is only safe because the volume is destroyed first: a retained
volume would stay initialised with the previous password and the app would simply fail to
authenticate — so the teardown and the generated credentials are one mechanism, not two.

### The Claude login is the one persistent thing, and it is staging's own

`claude_cfg` is declared `external` with the name `ainext-staging_claude_cfg`. Compose refuses to
remove an external volume, so the one-time interactive login survives every `down -v` — the
persistence is enforced by Compose's own semantics rather than by remembering to omit a flag.

It is a **different volume from production's**, and the credential inside it is a **different
login**, obtained once by hand on staging. Copying production's `.credentials.json` was considered
and rejected: the OAuth refresh rotates, so two stacks holding one refresh token means whichever
refreshes first can invalidate the other — and "the other" could be `noor.reletix.com`. A staging
environment that can break production's Claude access is not a staging environment.

### `staging` becomes the third environment tag

Constitution Principle XI requires every analytics event and every cost-ledger row to be tagged
with the stack that produced it. `app/src/lib/env.ts` enumerated a closed set of two —
`baseline | mvp1` — and refuses to start on anything else, which is the correct design and the
reason a third member has to be a deliberate act rather than a string in a config file.

The alternative was to run staging as `mvp1`. It needs no code change and the course gate works out
of the box, and it was rejected because every row staging writes would then claim to have come from
the stack serving pilot families. The separate database makes that harmless *today*, which is
exactly the kind of "harmless today" that is discovered to have been load-bearing on the day
somebody exports two databases into one spreadsheet.

So: `Environment` gains `"staging"`, and two consequences are settled with it.

1. **The course gate.** Migration 023's rule is *explicit allow — no row means hidden*, seeded for
   `baseline` and `mvp1` only. A fresh `staging` database with `AINEXT_COURSE_GATING=on` would show
   a student nothing, and `apply-migrations.sh` refuses to finish when no `live` row exists for the
   environment. Migration 033 seeds the staging rows additively and idempotently, matching what is
   live on `mvp1`. Staging runs with the gate **on**, because a staging stack that bypasses the
   gate is not testing the product.
2. **`IS_MVP1` becomes `IS_BASELINE`, and this was the find that justified the whole option.** The
   flag was `ENVIRONMENT === "mvp1"`, and all five of its call sites used it to ask the *opposite*
   question — every one of their comments says "the frozen baseline" in so many words. With two
   environments the two questions had the same answer, so nothing distinguished them. A third
   environment separated them, and separated them **silently**: nothing throws, staging would simply
   have been a different product. A `staging` stack reading as "not mvp1" would have taken the
   baseline branch in `design-variant-queries.ts` (no `data-ds` attribute, so **the Noor Play design
   system never applies at all** — constitution XII, the thing staging most needs to show),
   `student-nav.ts` (a signed-in student sent to the investor-preview ledger instead of `/student`,
   against FR-3220), `NavLinks.tsx` (the old Overview nav), `layout.tsx` (investor-preview title,
   strapline and footer) and `content/page.console.tsx` (a banner declaring the stack to *be* the
   baseline and forbidden to carry generated content — false and the exact opposite of true).

   Asking about the baseline is the form that survives a fourth environment: `=== "baseline"` has one
   right answer forever, because the baseline is frozen. The rename is **behaviour-preserving for both
   existing stacks by construction** — while only `baseline` and `mvp1` exist, `IS_BASELINE` is
   exactly the old `!IS_MVP1` — which is why it is safe to merge to `main` and why `npm test` is
   unchanged at 1048 passing.

   The same conflation was in `services/extraction/load_generated_questions.py` and
   `load_misconceptions.py`, which refused any environment but `mvp1` outright. That bound exists to
   keep generated, unreviewed content off the **baseline** (constitution III, ADR-0008), not to name
   one string, so both now test membership of `GENERATED_CONTENT_ENVIRONMENTS = {mvp1, staging}` —
   a set, so that admitting an environment stays a deliberate edit rather than an automatic grant of
   `!== "baseline"`. Without this, staging's content load fails at step 10 of every deploy.

### Access — staging mirrors production's posture, student open and console gated

**Amended 2026-10-11, the same day, during the setup itself.** This section first said *both*
staging hostnames sit behind an Access application, on the reading that "only users who has
permission can access" meant the whole environment. Samuel settled it the other way once the
applications were in front of him: the **student surface is open** and only the **console is gated**
— exactly production's arrangement, where `noor.reletix.com` is open by ADR-0019 and
`admin-noor.reletix.com` is gated by its own application.

That is the better answer, and for a reason worth recording rather than merely accepting: staging
exists to show the product as production serves it, and an access posture that differs from
production's is one more way staging can disagree with the thing it is meant to predict. A gate on
the student surface would have made every staging visit pass through a challenge no real visitor
meets.

The console stays gated on its own merits, and not only out of caution: ADR-0022 has the console
take operator identity **from** the verified Access assertion, so with Access off it falls back to a
password whose reset mail, on staging, is written to a container log rather than sent
(`AINEXT_MAIL_TRANSPORT=console`). An ungated staging console is therefore both more exposed and
less usable. `AINEXT_STAGING_CF_ACCESS_AUD` is the console application's AUD, not the student one's.

**Two Cloudflare distinctions cost time here, and both are written down so they cost nobody time
twice.**

1. **An application with no policy is not "open" — it is "closed to everyone, after asking."** The
   application is what intercepts a request and challenges for identity; policies only decide who
   passes. A policy-less application prompts for an email and then denies every address. Making a
   hostname genuinely open means **deleting the application**, which is what ADR-0019 actually did
   to `noor.reletix.com` — it has no application, rather than an empty one.
2. **An Access application creates no DNS record.** The tunnel's *public hostname* is what makes a
   name exist and routes it to the origin port; the application only protects a name. Creating the
   application alone leaves the hostname `NXDOMAIN`, which looks like a broken gate and is in fact a
   missing route.

The tunnel is token-managed, so both are dashboard acts, by hand, by Samuel. Order still matters
wherever a gate is wanted: the application must exist **before** the hostname, or the hostname is
briefly live and unprotected (`deploy/cloudflared-ingress.example.yml` §3).

Nothing in this repo can prove any of it. `deploy/STAGING.md` carries the off-box `curl` that
verifies the result — **and the expected answers now differ per hostname**: a 302 to
`cloudflareaccess.com` for the console, a plain 200 for the student surface. On the console a 200 is
the failure; on the student surface a 302 is the failure.

An Access application's AUD can be read without the dashboard at all, which is how this environment's
was obtained: the redirect to `cloudflareaccess.com` carries a `meta` JWT whose `aud` claim *is* the
application's AUD tag. Verified against production before being relied on —
`admin-noor.reletix.com`'s redirect yields `d810c05d…77c004`, byte-identical to the
`AINEXT_CF_ACCESS_AUD` already in production's `deploy/.env`.

Staging is **not** a release gate, not a QA sign-off, and not something a student or a family is
ever pointed at. It is a place to look at the product on the real box before production is asked to
show it.

## Consequences

- **Two compose files will drift.** `docker-compose.staging.yml` is a copy of
  `docker-compose.mvp1.yml` as of v0.11.1 with eleven changes. A change to the production stack has
  to be made twice until option (c) is taken. `deploy/STAGING.md` records the change list so the
  diff can be re-derived rather than re-guessed.
- **The product-code part of this belongs on `main`.** The `env.ts` third member and migration 033
  are product changes, not deploy configuration; they should merge to `main` so the two branches
  differ only in deploy files. Until they do, `staging` carries product code `main` does not have —
  the exact condition ADR-0010 exists to prevent — so this is a debt with a short fuse, owner
  Samuel.
- **A fourth stack's worth of resources.** One more Postgres, two more Node processes, one more
  image build per push. 85 GB free and the deploys are serialised, so the cost is disk and build
  minutes, not contention.
- **Pushing to `staging` deploys.** Unlike production (manual-only, T139), a push is enough. That
  is the point, and it means `staging` must never be used as a scratch branch.
- **Staging sends no mail and reports no analytics.** `AINEXT_MAIL_TRANSPORT=console` so a
  verification link is logged rather than delivered to a real address, and the GA id and alert
  address are empty so staging traffic never enters a production dashboard or pages anyone.

## Accepted risks

- **The guard is a shell assertion, not a capability boundary.** A person with a shell on the box
  can still type `docker compose -p ainext-mvp1 … down -v` by hand. This decision makes the
  *automated* path safe and the manual path loudly documented; it does not make the box
  unmistake-proof.
- **No requirement covers a staging environment,** and none has been invented. This ADR is the
  record, in the shape CLAUDE.md asks for — §9 of `specs/001-student-mvp1-delta/traceability.md`
  already names two shipped features with no FR, and this is infrastructure rather than product.
- **Staging's Claude login consumes the same subscription** as production's. Whether two concurrent
  CLI logins under one subscription are supported is not documented anywhere we control; if it
  turns out they are not, the fallback is an API key for staging alone.

## Amendment — 2026-10-13: staging sends real mail

**Decision (Samuel, 2026-10-13):** "I want the staging to really send mails, it will be a real env similar
to the prod, yet for demos and trials." Staging's `AINEXT_MAIL_TRANSPORT` goes from a hard-set `console`
to production's `${AINEXT_MAIL_TRANSPORT:-smtp}` on the app and the console, and the deploy writes `smtp`
and the same `AINEXT_MAIL_FROM` secret as production. Mail relays through Mailu on the shared network,
exactly as production's does, and every link in it names a staging hostname. This replaces the rule above
that staging sends no mail ("Staging sends no mail and reports no analytics"); analytics and alert e-mail
stay off (`AINEXT_GA_MEASUREMENT_ID` and `AINEXT_ALERT_EMAIL` empty). **Consequence to watch:** staging's
database is still destroyed and rebuilt on every staging deploy, so a demo or trial account made there
does not survive the next deploy — open with Samuel.

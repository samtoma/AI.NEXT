# Taking over the live deployment — a study

> Written 2026-09-22 from the `feat/002-identity-and-admin-console` working tree, by an agent that
> **never touched the box**. Nothing here was executed. Every command is written to be read first
> and run second, by a person who can see the box's own state, which this study cannot.
>
> Companion files: `DEPLOY-MVP1.md` (the ongoing runbook), `CICD.md` (the pipeline),
> `cloudflared-ingress.example.yml` (what must be clicked in Cloudflare),
> `apply-migrations.sh` (how schema changes reach a database that already exists).

**Assume the reader is a stressed founder at midnight.** Every section therefore says what breaks
between steps and what is reversible, because the question at midnight is never "what is the ideal
architecture", it is "if this goes wrong in ninety seconds, how do I put it back".

---

## 0. The state of the world, verified from the repository

Facts, each one checked rather than remembered:

| | |
|---|---|
| `origin/main` | `f0cb192` — the frozen baseline (parent-sold, Arabic RTL, three subjects, Elo mastery) |
| `origin/family-tutor` | `f0cb192` — **the same commit, byte for byte** (`git diff origin/main origin/family-tutor` is empty) |
| `origin/PDR1-0` | `ddfdc47` — 98 commits **ahead** of `main`, 0 behind. `main` is a strict ancestor |
| `origin/req/identity-and-admin-console` | +2 on `PDR1-0` |
| `origin/feat/002-identity-and-admin-console` | +10 on `req/…`, i.e. +12 on `PDR1-0` |
| local `feat/002-…` (this tree) | **+4 more, unpushed** — course availability, the two skins, the three courses, the upload fix |
| Open PRs | **#43** `req/…` → `PDR1-0` (ready) · **#44** `feat/002-…` → `req/…` (**draft**) |
| Tags | `PDR1-0-v0.2.0`, `v0.3.0`, `v0.4.0`, plus two baseline-era tags |

**Samuel's backup is real.** `family-tutor` and `main` are the identical commit, so replacing `main`
loses nothing that is not also on `family-tutor`. That is the single fact that makes everything in
§1 low-risk, and it is why it is checked here rather than assumed.

Two workflow copies exist and they disagree, which matters more than it looks:

| Branch | `deploy` gate | Deploys to | Trigger |
|---|---|---|---|
| `main` / `family-tutor` (same file) | `refs/heads/main && event_name != 'pull_request'` | `/opt/reletix/AI.NEXT`, project `ainext`, `:3100`, db `ainext_poc` | **every push** |
| `PDR1-0` (and this branch) | `refs/heads/PDR1-0 && event_name == 'workflow_dispatch'` | `/opt/reletix/AI.NEXT-mvp1`, project `ainext-mvp1`, `:3101`/`:3102`, db `ainext_mvp1` | **by hand only** |

So today **a push to `main` deploys production automatically and a push to `PDR1-0` deploys
nothing.** Hold that thought through §1; it is the source of both the risk and the safety.

---

## 1. Replacing `main` — Samuel's decision, and the order that makes it safe

> **This is recorded as a decision, not re-argued.** ADR-0010 left retiring `main` undone and called
> it "a production change that needs its own go-ahead". Samuel gave it on 2026-09-22: *"I want really
> to squash the main. It is no longer used. We have already created a backup in a separate branch."*
> **ADR-0010's Open item should be amended to record this.** Writing that amendment belongs to
> whoever owns `docs/decisions/` — it is deliberately not done here.

### 1.1 There is nothing to squash, and that is good news

`main` is an **ancestor** of `PDR1-0` (0 ahead, 98 behind). The histories are linear. So:

* `git push origin PDR1-0:main` is a **fast-forward**. No merge commit, no conflicts, no `-f`.
* A squash — collapsing 98 commits into one — would destroy the phase-by-phase record that
  `docs/PROJECT_STATE.md` explicitly calls *"the record"* (seven phase commits, each closed by a
  live smoke script, each naming what it found). That record is the only written trace of six
  defects nobody had planned for. **Do not squash. Fast-forward.**

The word "squash" in the request means *"make `main` be the PDR1-0 line"*. Fast-forwarding does
exactly that, and keeps more.

### 1.2 The one thing that could go wrong, and why it does not

The obvious fear: moving `main` triggers `main`'s auto-deploy and the student MVP lands on
`/opt/reletix/AI.NEXT` — the **baseline's** directory, compose project and database (`ainext_poc`,
which has never seen migrations 011–024).

It does not happen, for a precise reason: **GitHub runs the workflow file from the commit that was
pushed.** The instant `main` points at the PDR1-0 line, `main`'s copy of `ci-cd.yml` *is* the PDR1-0
copy, whose gate reads `refs/heads/PDR1-0` and `workflow_dispatch`. The push is on `refs/heads/main`
and is an ordinary push, so the gate is false twice over. The `build` job runs; `deploy` is skipped.

Two consequences follow, and the second is a trap:

1. **Do not change the gate in the same push.** Moving the branch and re-pointing the gate are two
   separate, separately-reversible acts. Doing both at once removes the property above.
2. **After `main` moves, nothing can deploy the frozen baseline any more.** `family-tutor` carries a
   copy of the *old* workflow, gated on `refs/heads/main` — a ref that will no longer describe the
   baseline. The baseline would still be *running* (containers do not care about branches) but CI
   could never redeploy it. **Fix on `family-tutor`, in its own commit:** change its gate to
   `github.ref == 'refs/heads/family-tutor'`, and take the opportunity to make it
   `workflow_dispatch`-only too, so the frozen baseline cannot be redeployed by an accidental push.
   That edit belongs on that branch and is not made here.

### 1.3 The PRs

* **#44** (`feat/002-…` → `req/…`, draft) — it does not contain the four unpushed commits in this
  working tree. Push them first or they are simply not in the merge.
* **#43** (`req/…` → `PDR1-0`) — base is `PDR1-0` explicitly. **Changing the repository's default
  branch does not retarget it**; the default branch only decides what a *new* PR proposes as its
  base. But **deleting the `PDR1-0` branch closes #43 outright.** If `PDR1-0` is to go away, retarget
  first: `gh pr edit 43 --base main`.

### 1.4 The order

Each step is a single act with a single way back.

```
1.  Push the four local commits on feat/002-…              ← reversible: they are commits
2.  Mark #44 ready, merge it into req/…                    ← reversible: revert commit
3.  Merge #43 into PDR1-0                                  ← reversible: revert commit
4.  Verify CI green on PDR1-0 (build + traceability)
5.  git push origin PDR1-0:main         (fast-forward)     ← reversible: git push -f origin f0cb192:main
                                                              (and family-tutor still holds f0cb192)
6.  Settings → General → Default branch → main             ← reversible: switch it back
      (it already is main; this step is a no-op today and
       is listed so nobody "fixes" it later by accident)
7.  STOP. Deploy the box from PDR1-0 as it stands, by hand,
    and prove it works (§3, §4) BEFORE step 8.
8.  On main: change the deploy gate to refs/heads/main,     ← reversible: revert commit
    keep `event_name == 'workflow_dispatch'`.
9.  On family-tutor: change its gate to refs/heads/family-tutor
    and make it workflow_dispatch-only.
10. Only now consider deleting the PDR1-0 branch —
    after #43 is merged or retargeted.                     ← NOT reversible in the PR sense
```

**Should the gate become `main`?** Yes, at step 8 and not before. Reasons, in order of weight:

* Two branches with identical content, one of which deploys, is exactly the drift ADR-0010 warns
  about. The copy that drifts is the one that eventually prunes production's images.
* `workflow_dispatch`-only must survive the move. That property was Samuel's own call (2026-09-13,
  T139) and it is what makes every step above safe to take in the wrong order. It costs one click
  per deploy and buys the ability to move branches without holding your breath.
* Until step 7 has passed, `PDR1-0` deploying and `main` not deploying is a *feature*: `main` can be
  moved, inspected, and moved back with nothing in the world changing.

**What is not reversible anywhere in §1:** deleting a branch that is the base of an open PR (it
closes the PR), and deleting `family-tutor` (it is the only remaining copy of `f0cb192`). Neither is
necessary. Leave both alone until the pilot is running.

---

## 2. The hostnames

### 2.1 Settled, and where the value lives

The student site is **noor.reletix.com** (Samuel, 2026-09-22; the earlier "trilatics"/"relatics"
were typos). It appears in exactly one place in the stack — the default of `AINEXT_PUBLIC_URL` in
`docker-compose.mvp1.yml` — and is overridable per stack from `deploy/.env`. No service body
contains a hostname literal.

### 2.2 The console hostname — **awaiting Samuel**

Proposal: **noor-console.reletix.com**.

`console.noor.reletix.com` reads better and is **not certificate-covered**: Universal SSL covers
`*.reletix.com`, a wildcard matches exactly one label, and a two-label name would need Advanced
Certificate Manager — a paid add-on. A browser certificate error in front of the operator sign-in
page is the wrong lesson to teach anybody about this product. `AINEXT_CONSOLE_URL` therefore has
**no default**: the stack refuses to start until the name is decided, which is the right place for
that question to be asked.

### 2.3 Everything that moves when a hostname changes

Nine things, and missing any one of them produces a failure that looks like something else:

| # | What | Where | Failure if forgotten |
|---|---|---|---|
| 1 | `AINEXT_PUBLIC_URL` | `deploy/.env` (default in compose) | Verification and reset links point at the old origin — a dead link in a child's inbox |
| 2 | `AINEXT_CONSOLE_URL` | `deploy/.env` | Operator reset links land on the student build, which has no such route → 404 |
| 3 | Cloudflare tunnel public hostname → `localhost:3101` | Zero Trust dashboard | The name resolves to nothing, or to the wrong product |
| 4 | Cloudflare tunnel public hostname → `localhost:3102` | Zero Trust dashboard | Console unreachable — or reachable and ungated, which is worse |
| 5 | **Cloudflare Access application on the console hostname** | Zero Trust dashboard | An operator sign-in page on the open internet (see §2.4) |
| 6 | `AINEXT_GOOGLE_REDIRECT_URI` **and** the same URI registered in Google Cloud | `deploy/.env` + Google console | `redirect_uri_mismatch` — **Google's** error page, which sends people looking in the wrong repository |
| 7 | `AINEXT_MAIL_FROM` and the Mailu domain behind it | `deploy/.env` + Mailu (§6) | Mail is sent and silently rejected by the receiving side |
| 8 | SPF / DKIM / DMARC records for the sending domain | Cloudflare DNS (§6) | Mail arrives in spam, i.e. no student can verify |
| 9 | GA4 data stream URL, if GA is ever configured | GA4 property | Traffic attributed to a stream nobody looks at |

**Cookies are not on this list, and that is worth knowing.** `lib/auth/cookies.ts` sets no `Domain`
attribute, so every cookie is host-only. A hostname change therefore signs everybody out on the old
host and leaks nothing to the new one. There is no cookie-domain configuration to get wrong — which
also means the console and the student surface cannot share a session across hostnames even by
accident (P1's second defect, fixed by design).

### 2.4 The cut-over order, and what breaks between steps

```
a. Decide the console hostname.
b. Create the Cloudflare ACCESS APPLICATION for it — BEFORE the hostname exists.
c. Bring the stack up on the box (§3). Nothing is public yet: both ports are on 127.0.0.1.
   Verify over an SSH tunnel:  ssh -L 3101:127.0.0.1:3101 -L 3102:127.0.0.1:3102 <box>
d. Add the tunnel hostname for the CONSOLE  → localhost:3102.  Confirm it 302s to Access.
e. Register the Google redirect URI for noor.reletix.com (both sides).
f. Configure Mailu + DNS (§6) and send one real verification mail to a real inbox.
g. Add the tunnel hostname for the STUDENT surface → localhost:3101.
h. Invite the first human.
```

* Between (c) and (g) **nothing about the live site changes at all.** `ainext.reletix.com` keeps
  serving the frozen baseline from `:3100`. This whole sequence is additive.
* If (g) happens before (e), email+password sign-in works and the Google button fails at Google.
* If (g) happens before (f), nobody can verify an account. `AINEXT_MAIL_TRANSPORT=console` prints
  the link to the container log, which is fine for you and useless for a student. **Do not invite
  anyone before (f).**
* Repointing `ainext.reletix.com` from `localhost:3100` to `localhost:3101` — if that is wanted at
  all — is **one field in the dashboard**, takes effect in seconds, needs no deploy and no DNS
  propagation, and is undone just as fast. It is by a wide margin the most reversible action in this
  entire document, and it is why the hostname question never needs to be coupled to the branch
  question.

---

## 3. Migrations, and the database

### 3.1 What was broken, and what now applies them

`docker-compose.mvp1.yml`'s `db` service mounted **no schema and no migrations**. The local stack
mounts both into `/docker-entrypoint-initdb.d`, which Postgres runs **only when the data directory
is empty** — useless to a volume that already exists. Nothing in the stack or the pipeline applied
migrations `011`–`024`: learning sessions, accounts, RLS, console grants, the cost ledger, alerts,
course availability, the design variant. The app would have started against a database missing most
of what it reads and failed at the first request rather than at deploy time.

**Now:** a one-shot `migrate` service runs before `app`, `console` and the loader are allowed to
start (`condition: service_completed_successfully`). It is a compose service and not a step in the
deploy job because `docker compose up -d --build` by hand is a documented routine operation on this
box, and a migration step that lives only in the workflow would not run then.

**It connects as the database OWNER** (`POSTGRES_USER`), not as `ainext_maint`. `ainext_maint` is
BYPASSRLS and it still cannot do this job: migration 017 grants the three roles `USAGE` on schema
`public` and never `CREATE`, marks `ainext_maint` `NOCREATEROLE`, and re-grants table privileges
only an owner may re-grant — while 017 itself runs `CREATE ROLE` and `ALTER ROLE … BYPASSRLS`, which
only a superuser may do. The full argument is in the header of `apply-migrations.sh`. The **running
application** still never receives that credential.

Each file is applied with `--single-transaction -v ON_ERROR_STOP=1`, so the database is always at a
whole number of migrations — never inside one — and "fix it and run again" is always correct. Then
four post-flight checks run: the three roles exist and are neither superuser nor BYPASSRLS; all
three have passwords; `course_availability` and `students.design_variant` are present; and, only
when the course gate is on, at least one course is allow-listed.

### 3.2 Fresh database or migrate in place

Samuel: *"I'm also ready to start from scratch… but use all the username and passwords for the
database and any configuration already existing on the main."*

There are three databases in this conversation and they are not interchangeable:

| Database | Stack | What is in it |
|---|---|---|
| `ainext_poc` | `ainext`, `:3100` | **The live frozen baseline.** Founder and demo usage since July, behind Cloudflare Access. Arabic RTL, three subjects, Elo mastery, **no accounts** — identity there is a picker |
| `ainext_mvp1` | `ainext-mvp1`, `:3101` | The PDR1-0 stack's database. **The deploy has never run**, so this very likely does not exist yet |
| local | laptop | Rebuilt by `scripts/local-dev.sh` on demand |

**Path A — migrate `ainext_poc` into the new product. Do not do this.** The migrations would apply
(they are additive), but the result is the *family-tutor* product's data wearing the student MVP's
schema: student rows with no accounts and therefore no owner under RLS, Elo mastery where the code
reads BKT, three subjects' content, and every row tagged `AINEXT_ENVIRONMENT=baseline` — which
constitution Principle XI forbids pooling with `mvp1` data. It would also destroy the frozen
baseline, which is the thing the comparison is supposed to be against.

**Path B — start fresh on `ainext_mvp1`, leave `ainext_poc` completely alone. Recommended.**

What is lost by starting fresh, stated plainly: **nothing of value.** If `ainext_mvp1` does not yet
exist, "fresh" is simply the first boot. If it does exist, what it holds is whatever hand-testing
produced on a stack that has never been announced to anyone. There are no paying families — the
pilot target is 50 families from late September and it has not started. No student account on the
live deployment exists at all, because the live deployment predates accounts entirely.

The honest caveat: **`ainext_poc` is not nothing.** It is the only running instance of the frozen
baseline, the thing `family-tutor` describes and the reference the comparison is measured against.
Do not `down -v` the `ainext` project, do not delete its volume, and take a dump before touching
anything on that box (§3.3).

### 3.3 Credentials — what can be reused and what cannot

| Value | Reuse from the box's existing `deploy/.env`? |
|---|---|
| `POSTGRES_PASSWORD` | **Yes.** It never leaves the compose network. One caveat worth stating once: one password across two stacks couples their rotation, and each stack has its own `deploy/.env`, so using the same string is a choice rather than a consequence |
| `AINEXT_APP_PASSWORD`, `AINEXT_OPERATOR_PASSWORD`, `AINEXT_MAINT_PASSWORD` | **No — they do not exist there.** Migration 017 is a PDR1-0 migration; the baseline has no such roles. Generate three new strong values |
| `AINEXT_AUTH_SECRET` | **No — it does not exist there.** The baseline predates accounts. `openssl rand -hex 32` |
| Cloudflare tunnel token, Mailu host | **Yes** — box-level infrastructure, shared by every product on it |

So "reuse the existing configuration" is true for the infrastructure and **cannot** be true for
identity: four of the five application secrets are new by construction. That is not an oversight in
the old configuration; those things did not exist when it was written.

### 3.4 Before anything: take a dump. There is no automated backup today.

This is a gap, and naming it is part of the job. The box has **no scheduled database backup and no
tested restore**. Minors' data is about to start arriving. Before the takeover, and then on a
schedule:

```bash
# one-off, before you touch anything — both stacks, outside the volumes
cd /opt/reletix/AI.NEXT/deploy
docker compose exec -T db pg_dump -U ainext -Fc ainext_poc  > ~/backups/ainext_poc-$(date +%F).dump

cd /opt/reletix/AI.NEXT-mvp1/deploy
docker compose -p ainext-mvp1 -f docker-compose.mvp1.yml exec -T db \
  pg_dump -U ainext -Fc ainext_mvp1 > ~/backups/ainext_mvp1-$(date +%F).dump
```

A dump nobody has restored is a hope, not a backup. **Prove the restore once**, into a throwaway
database on the same server, before the pilot:

```bash
docker compose -p ainext-mvp1 -f docker-compose.mvp1.yml exec -T db \
  psql -U ainext -c 'CREATE DATABASE restore_test'
docker compose -p ainext-mvp1 -f docker-compose.mvp1.yml exec -T db \
  pg_restore -U ainext -d restore_test < ~/backups/ainext_mvp1-$(date +%F).dump
# count a table you recognise, then:  DROP DATABASE restore_test;
```

Scheduling it, scoping it (minors' PII means the dump file is itself personal data — `chmod 600`, on
the box only, never in a repository or a chat), and its retention are a separate piece of work with
the security-privacy-officer. **Do not start the pilot without it.**

---

## 4. The course gate — a decision Samuel has to make, with a recommendation

`AINEXT_COURSE_GATING` is now in the compose file, defaulted to **`off`** — which is exactly today's
behaviour, chosen so that adding the variable changes nothing by itself. **That is not the
recommendation.**

**Recommendation: `on`, with `course:prep3-math-en` allow-listed.**

The argument for `off` is in `app/src/lib/env.ts` and it is a good one: a forgotten variable that
defaulted to `on` would be an allow-list nobody had populated, i.e. every student locked out of the
course they are paying to study, on a Sunday evening, with no error message anywhere. For a tutoring
product the safe failure is "too much visible", never "a child locked out of her own lesson".

That argument is about a **silent** failure, and it no longer applies on this stack: the `migrate`
service refuses to finish when the gate is on and no course is allow-listed, and prints the `INSERT`
to run. The failure moved from a support thread to a deploy log.

What `off` now costs, which it did not cost when that comment was written: **three courses are
loaded** (commit `62f780c` brought Arabic and Social Studies back), and two of them carry questions
that have not been through the human review gate. ADR-0007 suspends review for *generated
explanations* only — questions and canonical solutions keep the normal gate, and constitution
Principle III still binds. `off` puts unreviewed questions in front of children.

It also activates **S24**: the Arabic and social-studies prompts still carry masculine forms outside
the vocative. That item was deferred as "out of the maths-only scope" — and `off` puts those subjects
in scope by making them visible. The two decisions are the same decision.

To turn it on:

```
# deploy/.env
AINEXT_COURSE_GATING=on
```
```sql
INSERT INTO course_availability (environment, course_id, grade, state, note)
VALUES ('mvp1', 'course:prep3-math-en', '9', 'live', 'pilot launch')
ON CONFLICT (environment, course_id, grade) DO UPDATE SET state = 'live';
```

Reversible: set it back to `off` and redeploy. The rows stay and do nothing.

---

## 5. Reactivating the Claude CLI — **only Samuel can do this**

The tutor runs on Samuel's Claude **subscription** through the bundled `claude` CLI, not on an API
key. The login is interactive; no agent and no workflow can perform it.

**How the credential reaches the container.** `deploy/Dockerfile` installs
`@anthropic-ai/claude-code` globally and sets `CLAUDE_CONFIG_DIR=/repo/.claude`; the compose file
mounts the named volume `claude_cfg` at `/repo/.claude` for **both** the `app` and the `console`
services. So the login lives in a Docker volume, not in the image and not in the repository: it
survives every `up -d --build`, and **one login covers both containers**. Only `docker compose
down -v` destroys it — which is why "never `down -v`" is written in three places.

**What is broken while it is lapsed** — and it is less than it feels like:

* Broken: every tutor turn (`/api/ask`), understanding checks (`/api/understanding`), and upload
  OCR (`lib/uploads.ts`). Those are the three places the CLI is spawned.
* **Working:** sign-in and sign-up, the whole console, browsing lessons and the graph explorer,
  mastery computed from stored attempts, analytics, the cost ledger. A student can sign in and move
  around; she cannot be taught.

**What Samuel does, in order, from his own SSH session (a TTY is required — this cannot be a CI
step):**

```bash
ssh <the box>
cd /opt/reletix/AI.NEXT-mvp1/deploy
C="docker compose -p ainext-mvp1 -f docker-compose.mvp1.yml"

# 1. the container must be running
$C ps

# 2. log in — interactive; follow the URL it prints and paste the code back
$C exec -it app claude

# 3. prove it non-interactively
$C exec -T app claude -p "reply with exactly: OK"
#    → OK

# 4. prove it through the product: open a lesson and ask one question
```

If step 2 reports the config directory is not writable, the volume has been remounted or the image
rebuilt with different ownership — the Dockerfile `chown`s `/repo` to `node` and the container runs
as `node`. Check `$C exec app ls -ld /repo/.claude`.

**Do not put an `ANTHROPIC_API_KEY` in `deploy/.env` as a workaround** without deciding to. It is a
different commercial arrangement with different per-token costs, and the cost ledger's price basis
(`lib/pricing.ts`) would then be describing a different contract than the one being billed.

---

## 6. Mail — the same pattern Talent uses, for `admin@noor.reletix.com`

> **Standing instruction, Samuel: the TalentReletix repository must never be cloned or downloaded.**
> Nothing here came from it. This section is derived from this repository's own files
> (`app/src/lib/mail.ts`, `lib/env.ts`, SETUP.md S2) plus what Mailu's own admin interface asks for.
> Confirm the host names against the Mailu dashboard, not against another repo.

The application side is three lines and no code change. `mail.ts` builds a nodemailer transport
directly from `AINEXT_SMTP_URL` and sends `MAIL_FROM`; there is nothing else to configure.

### 6.1 What changes in this repository

```
# deploy/.env  — on the box, never committed
AINEXT_MAIL_TRANSPORT=smtp
AINEXT_MAIL_FROM=admin@noor.reletix.com
AINEXT_SMTP_URL=smtps://admin%40noor.reletix.com:<url-encoded-password>@<mailu-host>:465
```

`AINEXT_SMTP_URL` is a **URL**. The `@` in the username must be `%40` and any of `@ : / # ? &` in
the password must be percent-encoded, or the URL reparses into a different host and the failure
reads like a firewall problem.

### 6.2 What Samuel does in Mailu's admin interface (not code)

1. **Add the domain** `noor.reletix.com` as a *new domain* in Mailu. It is a distinct mail domain
   from the one Talent uses; adding it does not touch Talent's configuration.
2. **Create the mailbox** `admin@noor.reletix.com` with a strong password. It must be a real
   mailbox, not an alias to nowhere — the receiving side checks that the sender exists.
3. **Generate the DKIM key** for that domain (the domain's detail page has the button). Mailu then
   prints the exact DNS records it expects, including the selector. **Use the records Mailu prints**
   in preference to the templates below, which are the shape and not the values.

### 6.3 What Samuel does in Cloudflare DNS (zone `reletix.com`)

All of these are **DNS-only (grey cloud)**. MX records cannot be proxied, and if the mail host's own
`A` record is orange-clouded, SMTP never reaches it.

| Type | Name | Value | Why |
|---|---|---|---|
| MX | `noor` | `<mailu-host>` priority 10 | Where replies and bounces go |
| TXT | `noor` | `v=spf1 mx -all` | Says only our MX may send as this domain |
| TXT | `dkim._domainkey.noor` | the public key Mailu generated | Signature the receiver verifies |
| TXT | `_dmarc.noor` | `v=DMARC1; p=none; rua=mailto:admin@noor.reletix.com` | Start at `p=none`, read the reports for a week, then raise to `p=quarantine` |

Start DMARC at `p=none`. Going straight to `quarantine` on a brand-new subdomain with no reputation
is how a verification mail ends up in a parent's spam folder on launch night.

### 6.4 Verify, in this order

```bash
# 1. the transport, from the container, without involving the product
docker compose -p ainext-mvp1 -f docker-compose.mvp1.yml exec -T app \
  node -e "require('nodemailer').createTransport(process.env.AINEXT_SMTP_URL).verify().then(console.log,console.error)"

# 2. a real message to a Gmail address → open it → "Show original"
#    SPF: PASS   DKIM: PASS   DMARC: PASS.  Anything else, stop and fix it here.

# 3. the product path: sign up with a real address, confirm the link arrives and works
```

Outbound port 25 must be open from the box. Talent already sends mail from it, so this is almost
certainly solved — but it is the classic OCI default-deny and worth confirming rather than assuming.

---

## 7. What must exist before the first real student signs in

Read `specs/002-identity-and-admin-console/SETUP.md` for the full S1–S24 table and its local
stand-ins. This is the deployment reading of it: which rows stop being "nice to have" the moment a
fourteen-year-old types her email address.

### Blocking — the stack does not start, or the product does not work

| | Why it blocks |
|---|---|
| **S3** auth secret | Compose refuses to start without `AINEXT_AUTH_SECRET` |
| **S4** role passwords | Compose refuses to start; and without `DATABASE_URL` on `ainext_app`, every RLS policy in migration 017 is inert and the isolation is decoration |
| **S2** SMTP | No verification, no password reset. A pilot with `AINEXT_MAIL_TRANSPORT=console` is a pilot where you read links out of a container log to each family in turn |
| **S5** first operator | Nobody can open the console at all. Needs S2 first — the password arrives by mail |
| **D2** Claude CLI (§5) | No lesson turns, no understanding checks, no upload OCR. The product signs students in and cannot teach them |

### Blocking on policy, not on code — and these are the sharp ones

| | Why it blocks |
|---|---|
| **S10** PDPL opinion on guardian consent for under-15s | The audience *is* under-15s. The grace period ends 2026-11-01 and the pilot starts before that. Consent fields are modelled and unenforced — which is a decision waiting to be made, not a gap waiting to be filled |
| **S9** constitution Principle VII amendment | Gender is now collected and operator transcript access is a logged privilege. The governance that sanctions both is still a proposal |
| **S16** residual unprincipled read | `ainext_app` can read name/grade/interests of any *accounted* student with no principal set. Bounded and documented; SETUP.md says "review before the box deploy", and this is the box deploy |
| **D1** console hostname + Cloudflare Access (§2.2, and `cloudflared-ingress.example.yml`) | S18 and S19 were accepted for the pilot **on the stated assumption that Access is in front of the console**. Without it they are an account-enumeration oracle in front of an operator sign-in page. If Access is not ready, give the console no hostname and reach it over an SSH tunnel |

### Blocking only if you offer the feature

**S1** and **S15** (Google sign-in — unconfigured renders a disabled, labelled button, which is a
supported state), **S13** (the deprecated `arctic` pin, only relevant if S1 is on), **S7/S22** (GA4 —
unset renders no script and that is fine).

### Not blocking, but do not lose them

**S8** design artifact · **S11** CODEOWNERS · **S12** the two ADR-0007 files · **S14** contract tidy ·
**S17** materialised questions (accepted for the pilot) · **S20** `gh` workflow scope (pushes over
SSH work; this only blocks HTTPS pushes that touch `.github/workflows/`) · **S21** the shared IP
throttle (know it when testing from the office).

**S24** moves from "not blocking" to "blocking" the moment the course gate is off — see §4.

### New, from this deployment pass

| | |
|---|---|
| **D3** | No automated database backup and no tested restore (§3.4). Do not start the pilot without it |
| **D4** | `RELEASE_TAG` is carried by the stack and **not read by the app**. One line in `app/src/lib/env.ts` makes `renderer_version` name the deployed build instead of the package version; until then a replay cannot detect renderer drift, which is the only reason that column exists |
| **D5** | `family-tutor`'s workflow copy is gated on `refs/heads/main` (§1.2). Once `main` moves, CI can no longer deploy the frozen baseline |

---

## 8. What I could not verify from this machine

Said plainly, because a study that hides its blind spots is worse than no study.

1. **Anything at all about the box.** I never connected to it. I do not know whether
   `/opt/reletix/AI.NEXT-mvp1` exists, whether the `ainext-mvp1` project has ever been brought up,
   whether its volume or its database exist, what is in `deploy/.env` there, or how much disk and
   memory are free. Every claim about the box in this document is derived from files in this
   repository, and the repository can be wrong about it.
2. **`docker compose config` was not run — and could not have been: there is no `docker` binary on
   this machine's PATH.** The compose file parses as YAML (`yaml.safe_load`) and the keys used are
   standard Compose v2 — but
   `depends_on: condition: service_completed_successfully` is **new to this file**, and a version of
   Compose old enough to reject it would fail at the first `up`. Check the daemon's compose version
   before the first deploy: `docker compose version` (v2.17+ is comfortable).
3. **The image was not built.** The Dockerfile now runs `next build` twice. Both builds pass on a
   GitHub runner, so the risk is environmental rather than in the code: a second Next artefact in
   the image and a second Node process on a box that also runs production. `mem_limit: 1g` on the
   console is a starting guess, not a measurement. Watch `docker stats` after the first deploy.
4. **Nothing proves Cloudflare Access exists.** No test, no CI job and no health check can see it.
   The checklist in `cloudflared-ingress.example.yml` is the only control, and it is a human one.
5. **Latency from Egypt was not measured.** Users are on variable bandwidth in Cairo and the edge PoP
   that serves them is not the one that serves this laptop. "It loads fine here" has never been the
   question for this product.
6. **Mailu's current configuration was not inspected**, and the Talent repository was not touched.
   Whether adding `noor.reletix.com` as a Mailu domain is as clean as §6 assumes needs one look at
   that dashboard.
7. **Whether outbound port 25 is open**, and whether the Claude subscription seat is currently valid.
8. **`npm test` was not run here.** The brief states 514/514 pass locally against an unreachable
   database, and I confirmed the workflow still parses and the deploy gate is byte-for-byte
   unchanged — but I did not re-run the suite.

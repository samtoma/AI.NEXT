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

### 2.2 The console hostname — **decided**

**`admin-noor.reletix.com` (Samuel, 2026-09-22).** The student surface is
`noor.reletix.com`; the console is its sibling, not its child.

Both are one label under `reletix.com`, which is what makes them work: Universal SSL covers
`*.reletix.com`, a wildcard matches exactly **one** label, and a two-label name like
`console.noor.reletix.com` would need Advanced Certificate Manager — a paid add-on. A browser
certificate error in front of the operator sign-in page is the wrong lesson to teach anybody about
this product, so the sibling shape is the cheap correct answer rather than a compromise.

`AINEXT_CONSOLE_URL` keeps **no default in the compose file** even now that the name is known. The
value is an origin the operator's reset links are built from, and a stack that silently starts with
the wrong one sends password links to a host that has no such route. Refusing to start is the
louder failure, and it is the one worth having. `deploy/.env.example` carries the decided value to
copy.

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

**Rolling back** re-runs the OLDER build's migrations over the newer database, so it is only as safe
as the older build's files. v0.6.1 and later are safe to roll back to after v0.7.0; **v0.6.0 is
not** (its 014 is unguarded) and must never be redeployed after v0.7.0. The three levers — switch
the feature off, revert and deploy, and the manual path if v0.6.0 is ever unavoidable — are in
[`DEPLOY-MVP1.md` → "Rolling back"](DEPLOY-MVP1.md#rolling-back). CI checks the rollback against the
previous release on every change to `db/` (job `migrations`).

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

### 3.3a AMENDED 2026-09-22 — the secrets come from GitHub, and CI writes the file

Samuel: *"no I want the deployment to be from the CI, why should I run the cmd myself"* — a fair
challenge, and the answer is that the old shape's security argument does not survive contact with
this box. **The runner is self-hosted on the same machine.** Anybody who can change the workflow can
already run arbitrary code there, including reading an on-box `deploy/.env`. Keeping the values out
of GitHub bought almost nothing while costing a manual SSH step, a second place to rotate, and a file
with no backup story.

So the deploy job now **writes `deploy/.env` from repository secrets on every run**. What that buys:
rotation is one `gh secret set`, a rebuilt box needs no hand-editing, and nothing about a deployment
depends on somebody remembering what they typed into a terminal in September.

What protects them now that a workflow change can reach them: they are encrypted at rest, masked in
logs, and cannot be read back through the API — only overwritten. The step never echoes a value and
`set -x` appears nowhere in the job. The file is written 0600. And **every required secret is
validated before the file is touched**, so a missing one fails the deploy and leaves the previous
file intact rather than half-writing an env file at 2am.

**Set once, from anywhere — these do not echo:**

```bash
R=samtoma/AI.NEXT
gh secret set POSTGRES_PASSWORD        --repo $R
gh secret set AINEXT_APP_PASSWORD      --repo $R
gh secret set AINEXT_OPERATOR_PASSWORD --repo $R
gh secret set AINEXT_MAINT_PASSWORD    --repo $R
gh secret set AINEXT_AUTH_SECRET       --repo $R
# optional, as they become real:
gh secret set AINEXT_SMTP_URL --repo $R;  gh secret set AINEXT_MAIL_FROM --repo $R
# a product decision, so a VARIABLE rather than a secret — readable without unmasking:
gh variable set AINEXT_COURSE_GATING --body on --repo $R
```

Generate the four passwords and the signing key with `openssl rand -base64 48`. The hostnames are not
secrets and the job writes them itself.

**What is still yours and cannot be automated:** the Claude CLI login (§5 — interactive, a TTY),
Mailu's mailbox and the DNS records (§6), and the Cloudflare Access application in front of the
console (§2.2). Everything else is now a button in Actions.

## 3.3 Credentials — what can be reused and what cannot

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

**HOW YOU FIND OUT NOW — added 2026-09-22, after this went unnoticed for seven weeks.**
Nothing in the product detected the lapse; it was found because somebody ran the command above by
hand. Two things now watch for it, and both are described where they live rather than here:

* **The console's Security view** carries an *AI tutor* tile (`/security`). It states the last
  probe's verdict **and its age** — a probe that has not run recently reads `Unknown`, never
  healthy — what real tutor turns have been doing, and, in plain words, what keeps working while
  the tutor cannot teach. It reads a stored result; it never calls the CLI itself.
* **A scheduled probe**, `app/scripts/probe-runtime.mts`, every fifteen minutes from cron (the
  crontab line is in that script's own header). It asks the CLI the same question step 3 below
  does, through the same code path the product uses to teach, and stores a short code — never the
  CLI's own output. **Three failures in a row raises an email** (`tutor_unreachable`, one per hour).

Set the cron line up when the stack moves, or the tile will honestly report that nobody is looking.

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

## 6. Mail — SETTLED 2026-09-22, and it needs no password

**Superseded:** this section previously described SMTP AUTH as
`admin@noor.reletix.com` on :587. That was wrong, and the reason is worth
keeping so nobody re-derives it.

**What is true.** The app and console containers join the existing
`mailu-network`. Mailu's postfix has
`mynetworks = 127.0.0.1/32 172.22.0.0/16 172.16.0.0/12` and
`smtpd_relay_restrictions = permit_mynetworks, …`, so **membership of that
network IS the authorisation**. That is how Talent has sent for months — its
worker appears in the relay log as
`client=talent_reletix_celery.mailu-network[172.22.0.15]`, with no SASL at all.
Compose therefore defaults to `AINEXT_MAIL_TRANSPORT=smtp` and
`AINEXT_SMTP_URL=smtp://smtp:25`, and neither needs a secret.

**Measured, not assumed.** From inside the network: `smtp:25` answers with a
full feature list; `front:587` is refused outright. From the host,
`smtp.reletix.com:587` times out — the box cannot reach its own public IP.

**Outbound leaves via Resend** (`relayhost = [smtp.resend.com]:587`, every
domain, no per-sender exception). Two consequences that fail silently:
`noor.reletix.com` must be verified in the Resend dashboard, or the relay
accepts and Resend refuses; and SPF must carry `include:_spf.resend.com`,
because the delivering machine is Resend's. The published record is
`v=spf1 a:smtp.reletix.com include:_spf.resend.com ~all`.

**Done on the box (2026-09-22):** the domain added to Mailu, its DKIM key
generated and its ownership corrected to `mailu:mailu` to match the other two,
the mailbox `admin@noor.reletix.com` created with a generated password, and
`change_pw_next_login` cleared — that flag drives the web UI, and leaving it on
a service account is a surprise waiting for the day somebody needs it.

**The mailbox and its password are not dead.** They are what READS mail sent to
that address, and the fallback if anything ever sends from outside the box.

**Left to a human:** the four DNS records (MX `noor` → `smtp.reletix.com` prio
10; SPF as above; `dkim._domainkey.noor`; `_dmarc.noor` with
`p=quarantine; rua=mailto:admin@reletix.com`), all DNS-only rather than
proxied, and `AINEXT_MAIL_FROM` as a repository secret.


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
| **D4** | ~~`RELEASE_TAG` is carried by the stack and **not read by the app**.~~ **Closed in v0.7.0** (ADR-0021): `app/src/lib/env.ts` reads it, falling back to `v<package version>`; turns, learning sessions and the console header now name the deployed build. Rows written before v0.7.0 still carry the package version (`PDR1-0-v0.6.0` and earlier) |
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

---

## 9. Console sign-in from Cloudflare Access (v0.8.0, ADR-0022)

Samuel, 2026-09-24: *"the email verification is done through cloudflare, can you use this email
from cloudflare"*. From v0.8.0 an operator who has passed the Access one-time PIN in front of
`admin-noor.reletix.com` is **signed in to the console automatically**, as the operator whose email
matches — no password, no form. Every console action is then traced to an address Cloudflare
proved.

### 9.1 What the box needs

Two values, **not secrets**, on the `console` service only. CI writes them into `deploy/.env` from
repository **variables**, and falls back to these defaults when the variables are unset:

| Variable | Default written by CI | Where it comes from |
|---|---|---|
| `AINEXT_CF_ACCESS_TEAM_DOMAIN` | `https://reletix.cloudflareaccess.com` | The Zero Trust team domain (team `reletix`) |
| `AINEXT_CF_ACCESS_AUD` | `d810c05d…c004` (the admin-noor Access app) | The Access application for admin-noor, "Application Audience (AUD) Tag" in the Zero Trust dashboard |

```bash
# only if a value ever changes, or to switch the feature off (password only):
gh variable set AINEXT_CF_ACCESS_AUD --body <new AUD> --repo samtoma/AI.NEXT
gh variable set AINEXT_CF_ACCESS_TEAM_DOMAIN --body off --repo samtoma/AI.NEXT
```

**If the Access application is ever deleted and recreated, its AUD changes** and Cloudflare sign-in
stops — safely: every assertion then fails the audience check, the console shows the password form
with a one-line notice, and each attempt is recorded as `failed_login` /
`cloudflare-access:unverified:bad_audience`. Update the variable and redeploy.

The console fetches the team's signing keys from
`https://reletix.cloudflareaccess.com/cdn-cgi/access/certs` at runtime (cached, refetched only on
key rotation), so **the console container needs outbound HTTPS**. Nothing in the compose file
restricts egress, and the URL answered from a laptop on 2026-09-24 (a foreign token was refused as
`unknown_key`, which needs the key set to have been fetched) — but the box itself was not checked,
and a future egress lockdown must allow it. A console that cannot fetch the keys fails closed to the
password form; it never signs anybody in without them.

### 9.2 What must be checked on the live console after the first v0.8.0 deploy

1. **Operator emails equal Access emails.** `select id, email, status from operators;` — every
   person who should reach the console needs an active row whose email is the address they type
   into the Access PIN screen (case does not matter; anything else does). Nobody is created
   automatically: a proven address with no row gets the refusal page, and the refusal is recorded
   with that address in `auth_events.reason`.
2. **Open `admin-noor.reletix.com` in a fresh private window.** Access asks for the PIN; after it,
   you should land on the student list **without seeing the console's sign-in form**. In the
   Security view, the newest row is *Operator signed in* with reason
   `cloudflare-access:<your roles>`.
3. **Sign out** from *My account*. The browser must end on Cloudflare's "You have been logged out"
   page; opening the console again must ask for a new PIN. (If it signs you straight back in, the
   Access logout did not happen — check the variables.)
4. **Access with an address that has no operator row** (a second inbox): the page must say *This
   Cloudflare identity has no console account*, with no console data, and a `failed_login` row with
   `cloudflare-access:no_operator:<that address>`.
5. **Swap identity on one browser**: sign in as operator A, sign out of Access only
   (`https://reletix.cloudflareaccess.com/cdn-cgi/access/logout` directly), come back as operator B.
   The console must show B, and the record must show `session_revoked` for A's session with reason
   `cloudflare-access:identity_changed`, then B's sign-in.
6. `docker logs ainext-mvp1-console 2>&1 | grep cf-access` — no `Cloudflare sign-in is OFF` line
   (that line means the variables are missing or malformed).

### 9.3 What it does not change

- **Access is still the gate.** The console trusts nothing about Cloudflare except the signed
  assertion; the Access policy decides who may even try. FR-2208 (Access in front of the console,
  in addition to operator accounts) is unchanged and now carries more weight: the operator row is
  still required, and Access now proves which row.
- **The password path still works**, as the fallback for when the assertion cannot be verified.
  Removing it is a later decision for Samuel.
- **The student surface ignores all of this.** The sign-in route does not exist in the student
  build, and neither variable is set on the `app` service.
- **The dev operator picker** (`AINEXT_DEV_OPERATOR_PICKER`) is local-only and **is not in any
  production build** — `npm run check:surface:admin` fails if its endpoint appears. Never set that
  variable on the box; it would do nothing there, and that is the point.

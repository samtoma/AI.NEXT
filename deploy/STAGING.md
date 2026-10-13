# Staging — `staging-noor.reletix.com`

The staging stack, what it is isolated from and how, the three things only a human can do, and the
runbook for when it misbehaves. Decision record: [ADR-0024](../docs/decisions/0024-staging-environment.md).

> **The one-sentence version.** `staging` is a deployment target, not a development branch: every
> push to it destroys the staging database and rebuilds the whole stack from nothing, keeping only
> the Claude login. It cannot touch `noor.reletix.com` — nothing it names is shared.

---

## 1. What runs on this box, and which one is which

Four stacks share one Ubuntu box. Three of them matter to somebody other than us.

| Stack | Compose project | Directory | Loopback | Public | Status |
|---|---|---|---|---|---|
| Talent (prod) | `talent-prod` | `/opt/reletix/talent` | 30001–30004 | talent.reletix.com | **a different product, in production** |
| Talent (preprod) | `talent-preprod` | `/opt/reletix/talent-preprod` | 40001–40006 | — | someone else's preprod |
| Mailu | `mailu` | `/opt/reletix/infrastructure/mailu` | 25/143/465/587/993/995, 8080 | mail for the zone | **the whole zone's mail** |
| Noor baseline (frozen) | `ainext` | `/opt/reletix/AI.NEXT` | 3100 | — | frozen, no pipeline path |
| **Noor production** | `ainext-mvp1` | `/opt/reletix/AI.NEXT-mvp1` | **3101** student, **3102** console | noor.reletix.com, admin-noor.reletix.com | **pilot families** |
| **Noor staging** | `ainext-staging` | `/opt/reletix/AI.NEXT-staging` | **3201** student, **3202** console | staging-noor.reletix.com, admin-staging-noor.reletix.com | this file |

**Why 3201/3202.** Verified free on the box before they were chosen — nothing listens on them, no
compose file on the box mentions them, and no container, running or stopped, publishes them. The full
set in use is `25 110 143 465 587 993 995 2368 3100 3101 3102 6380 8000 8080 9000 9443 18789 18790
20241 30001–30004 40001–40006 51820 51821`. They also follow the convention already on the box: Talent
owns the `3xxxx`/`4xxxx` ranges, Noor owns `31xx` for production, so staging takes `32xx`.

Re-check before adding anything:

```bash
ss -ltn | grep -E ':(3201|3202)' || echo "free"
```

---

## 2. What makes staging unable to break production

Not care — nothing is shared, and the deploy refuses to run if it is.

| | production | staging |
|---|---|---|
| Compose project | `ainext-mvp1` | `ainext-staging` |
| Database | `ainext_mvp1` | `ainext_staging` |
| Image tags | `ainext-mvp1-app`, `-loader` | `ainext-staging-app`, `-loader` |
| Console container | `ainext-mvp1-console` | `ainext-staging-console` |
| Volumes | `ainext-mvp1_{ainext_mvp1_pg,ainext_mvp1_uploads,claude_cfg}` | `ainext-staging_{staging_pg,staging_uploads,claude_cfg}` |
| Environment tag | `mvp1` | `staging` |
| `down -v` | **forbidden** — a student's history | **normal** — every deploy |
| Access | student open, console gated | **the same**: student open, console gated |

`deploy-staging.yml`'s first step is a guard that exits non-zero unless the project is
`ainext-staging` and the deploy directory is `/opt/reletix/AI.NEXT-staging`. It runs **before** any
destructive command exists in the shell, because this is the only workflow in the repo that runs
`down -v`.

Both deploy jobs share `concurrency: deploy-oci`, so a staging deploy and a production deploy can
never be on the box at once.

> ⚠️ **The guard protects the pipeline, not the keyboard.** Typing
> `docker compose -p ainext-mvp1 … down -v` by hand still destroys production's database. Always
> pass `-p` and `-f` explicitly, and read them before pressing return.

---

## 3. The three things only a human can do

Everything else is automated. These are not, and the stack is only half-useful until they are done.

### 3.1 Cloudflare — student surface open, console gated

The tunnel is **token-managed** (`TUNNEL_TOKEN` in
`/opt/reletix/infrastructure/cloudflared/docker-compose.yml`, `network_mode: host`). There is no
local `config.yml`: public hostnames live in the Cloudflare Zero Trust dashboard, and nothing in this
repo can create or verify them.

**Staging mirrors production's access posture** (Samuel, 2026-10-11 — ADR-0024's Access amendment):

| Hostname | Posture | Mirrors |
|---|---|---|
| `staging-noor.reletix.com` | **open — no Access application at all** | `noor.reletix.com` (ADR-0019) |
| `admin-staging-noor.reletix.com` | **gated**, allow-list policy | `admin-noor.reletix.com` (ADR-0022) |

#### Two Cloudflare distinctions that cost an hour the first time

Read these before clicking anything; each produced a confusing symptom during the original setup.

1. **An application with no policy is not "open" — it is "closed to everyone, after asking."** The
   *application* intercepts the request and challenges for identity; *policies* only decide who
   passes. A policy-less application prompts for an email and then denies every address. To make a
   hostname genuinely open you **delete the application** — which is exactly what ADR-0019 did to
   `noor.reletix.com`: it has no application, not an empty one.
2. **An Access application creates no DNS record.** The tunnel's *public hostname* is what makes a
   name exist and routes it to a port. Create only the application and the hostname stays
   `NXDOMAIN` — which looks like a broken gate and is really a missing route.

#### The console (gated) — application FIRST, then the hostname

Order matters here, or the hostname is briefly live and unprotected.

**Step 1 — Zero Trust → Access → Applications → Add → Self-hosted**

| Field | Value |
|---|---|
| Name | `Noor Staging Console` |
| Domain | `admin-staging-noor.reletix.com` |
| Session duration | 24h (or your preference) |
| Policy | name `Founders`, Action **Allow**, Include → **Emails** → the founders' addresses |

**Step 2 — Networks → Tunnels → (the tunnel) → Public Hostname → Add**, **Type: HTTP** (TLS
terminates at Cloudflare's edge; HTTPS here would fail):

| Hostname | Service |
|---|---|
| `admin-staging-noor.reletix.com` | `http://localhost:3202` |

**Step 3 — set the repo variable** to the **console application's** AUD, so the console can verify
the Access JWT ([ADR-0022](../docs/decisions/0022-console-signin-from-cloudflare-access.md)):

```bash
gh variable set AINEXT_STAGING_CF_ACCESS_AUD --body '<the Noor Staging Console AUD>'
# AINEXT_CF_ACCESS_TEAM_DOMAIN already defaults to https://reletix.cloudflareaccess.com
```

It is written into `deploy/.env` at deploy time, so **it needs one more deploy to take effect**.

You do not have to find the AUD in the dashboard. Once the hostname is live, read it from the
redirect — the `meta` JWT's `aud` claim *is* the application's AUD tag:

```bash
h=admin-staging-noor.reletix.com
curl -sS -o /dev/null -m 20 -w '%{redirect_url}' "https://$h/" \
  | sed -n 's/.*meta=\([^&]*\).*/\1/p' | cut -d. -f2 \
  | tr '_-' '/+' | base64 -d 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["aud"])'
```

Verified against production before being trusted: `admin-noor.reletix.com` yields
`d810c05d…77c004`, byte-identical to the `AINEXT_CF_ACCESS_AUD` already in production's `deploy/.env`.

#### The student surface (open)

Add only the tunnel public hostname, **Type: HTTP**:

| Hostname | Service |
|---|---|
| `staging-noor.reletix.com` | `http://localhost:3201` |

No Access application. If one exists, delete it — leaving it without a policy locks everybody out.

Both names are **one DNS label deep** on purpose: Universal SSL on `*.reletix.com` covers one label
only, so `staging.noor.reletix.com` would need the paid Advanced Certificate Manager. Same reasoning
as the production hostnames (2026-09-22).

#### Verify from OFF the box, on a machine with no Access session

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://staging-noor.reletix.com
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://admin-staging-noor.reletix.com
```

**The expected answers differ per hostname, and each one's failure is the other's success:**

| Hostname | Expect | Failure |
|---|---|---|
| `staging-noor.reletix.com` | **200** | a **302** means an Access application is still in front of it |
| `admin-staging-noor.reletix.com` | **302** to `*.cloudflareaccess.com` | a **200** means the console is exposed — treat as urgent |

If your resolver has cached `NXDOMAIN` from before the hostname existed, query Cloudflare directly
rather than concluding it is missing: `dig +short @1.1.1.1 <host> A`.

### 3.2 The one-time Claude login

Staging has its **own** Claude credential, in its own volume. Do **not** copy production's: the OAuth
refresh token rotates, so two stacks holding one credential means whichever refreshes first can
invalidate the other — and the other could be `noor.reletix.com`.

Needs a TTY, so it cannot be a workflow step:

```bash
cd /opt/reletix/AI.NEXT-staging
docker compose -p ainext-staging -f deploy/docker-compose.staging.yml exec -it app claude
# follow the URL, paste the code back
```

It persists in `ainext-staging_claude_cfg`, which is declared `external` in the compose file
specifically so that Compose **refuses** to delete it on `down -v`. Every deploy prints whether the
login is present; check for it:

```bash
docker run --rm -v ainext-staging_claude_cfg:/c alpine test -f /c/.credentials.json \
  && echo "login present" || echo "NO LOGIN — do 3.2"
```

### 3.3 The first operator, if the console asks for a password

The deploy bootstraps operator accounts from the repo variable
`AINEXT_BOOTSTRAP_OPERATOR_EMAILS` on **every** run, because the database is new on every run. With
the Access AUD set (3.1), signing in needs nothing further — the console takes the identity from the
verified Access assertion.

Without the AUD, Access sign-in degrades to **off** (not to "open": `resolveCfAccessConfig` returns
`off`/`misconfigured` and the JWT path is never consulted), the console falls back to a password
form, and the password can only be set through a reset mail — sent for real since 2026-10-13
(`AINEXT_MAIL_TRANSPORT=smtp`); before that it was written to the container log, which you can still read:

```bash
docker compose -p ainext-staging -f deploy/docker-compose.staging.yml logs console | grep -i reset
```

**Set the AUD and skip all of that.**

---

## 4. Deploying

Push to `staging`. That is the whole procedure — unlike production, which is
`workflow_dispatch`-only by Samuel's 2026-09-13 call (T139).

```bash
git checkout staging
git merge --ff-only main          # or merge the branch being proven
git push origin staging           # ← this deploys
gh run watch                      # follow it
```

What the workflow does, in order: guard → sync the checkout → write `deploy/.env` with **freshly
generated** credentials → `down -v` → assert the pg/uploads volumes are gone and the Claude volume
survived → `up -d --build` → health-check 3201 then 3202 → load curriculum, generated maths content
and misconceptions → bootstrap operators → verify the staging course-gate rows → prune dangling
images.

**Staging reads no GitHub secret.** `POSTGRES_PASSWORD`, `AINEXT_AUTH_SECRET` and the three role
passwords are generated per deploy with `openssl rand -hex 32`. That is only safe because the volume
is destroyed first — a retained volume would stay initialised with the previous password and the app
could not authenticate. The teardown and the generated credentials are one mechanism, not two.

By hand on the box, if CI is the thing that is broken:

```bash
cd /opt/reletix/AI.NEXT-staging
git fetch --prune && git reset --hard origin/staging
docker compose -p ainext-staging -f deploy/docker-compose.staging.yml up -d --build
```

---

## 5. When it misbehaves

```bash
# where to stand
cd /opt/reletix/AI.NEXT-staging
alias dcs='docker compose -p ainext-staging -f deploy/docker-compose.staging.yml'

dcs ps                      # what is up
dcs logs -f app             # the student surface
dcs logs -f console         # the console
dcs logs migrate            # why a deploy stopped before serving
dcs exec db psql -U ainext -d ainext_staging -c '\dt'
```

| Symptom | Cause | Fix |
|---|---|---|
| Migration step fails with *"no course is allow-listed for environment 'staging'"* | Migration 033 did not run, or its row was deleted | Re-run the deploy; or insert the row (the error prints the exact SQL) |
| Student signs in and the catalogue is empty | Same as above — "no row means hidden" is the designed default | Same |
| Site unstyled / looks like the old Ledger identity | `AINEXT_ENVIRONMENT` is not reaching the container, so `IS_BASELINE` is true and no `data-ds` attribute is emitted | `dcs exec app printenv AINEXT_ENVIRONMENT` — must print `staging` |
| App refuses to start, *"AINEXT_ENVIRONMENT=… is not one of baseline \| mvp1 \| staging"* | Typo in the env file | Fix it; the refusal is deliberate — it prevents mis-attributed data |
| Content loader exits 2, *"REFUSING: AINEXT_ENVIRONMENT is …"* | The loader's own bound, widened to `{mvp1, staging}` by ADR-0024 | Check the variable is `staging`, not blank |
| 502 at the hostname | The stack is down, or the tunnel points at the wrong port | `dcs ps`, then check the dashboard hostname maps to `localhost:3201` |
| **Console** 200 from off-box with no Access prompt | **The console's Access application or policy is missing.** Treat as urgent | §3.1, and remove the public hostname until it is fixed |
| **Student surface** 302 to cloudflareaccess | An Access application is still in front of a surface that is meant to be open | Delete it; a policy-less application locks everyone out rather than opening it |
| Claude features fail | No login in this stack's volume | §3.2 |

**Nuclear option, and it is cheap here.** Staging holds nothing worth keeping:

```bash
dcs down -v --remove-orphans      # keeps claude_cfg: it is external
git push origin staging --force-with-lease   # or re-run the workflow
```

---

## 6. Keeping this file honest

`docker-compose.staging.yml` is a copy of `docker-compose.mvp1.yml` as of **v0.11.1** with these
changes, and nothing keeps the two in step automatically — a change to the production stack has to be
made twice ([ADR-0024](../docs/decisions/0024-staging-environment.md) records this as accepted debt,
with the eventual fix being a single parameterised file):

1. `name: ainext-staging`
2. database `ainext_staging` everywhere (`POSTGRES_DB`, the healthcheck, `PGDATABASE`, both
   `DATABASE_URL`/`DATABASE_URL_OPERATOR` on app and console, the loader DSN)
3. image tags `ainext-staging-app`, `ainext-staging-loader`
4. `container_name: ainext-staging-console`
5. ports `127.0.0.1:3201` / `127.0.0.1:3202`
6. `AINEXT_ENVIRONMENT: "staging"` on migrate, app, console and loader
7. `AINEXT_PUBLIC_URL` / `AINEXT_CONSOLE_URL` → the staging hostnames
8. `AINEXT_MAIL_TRANSPORT: smtp` on **both** app and console, from the same `AINEXT_MAIL_FROM` secret as
   production, through Mailu on the shared network — **staging sends real mail since 2026-10-13**
   (Samuel: "a real env similar to the prod, yet for demos and trials"). Every link in it points at
   the staging hostnames. Until then this was `console`, mail written to the container log
9. `AINEXT_GA_MEASUREMENT_ID: ""` and `AINEXT_ALERT_EMAIL: ""` hard-set on both — staging traffic
   enters no dashboard and pages nobody
10. volumes `staging_pg` / `staging_uploads` (disposable), and `claude_cfg` declared
    `external: true, name: ainext-staging_claude_cfg` (the one survivor)
11. the header rewritten: `down -v` is normal here and forbidden on `ainext-mvp1`

Re-derive the diff at any time:

```bash
diff deploy/docker-compose.mvp1.yml deploy/docker-compose.staging.yml
```

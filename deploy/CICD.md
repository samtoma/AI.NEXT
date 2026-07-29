# CI/CD — two GitHub Actions workflows → OCI

| Workflow | Trigger | Touches |
|---|---|---|
| **`ci-cd.yml`** — build + deploy | automatic, push to `main` | **code only** (image + containers) |
| **`refresh-content.yml`** — content refresh | **manual** (`workflow_dispatch`) | **data only** (the live Postgres) |

They share the concurrency group `deploy-oci`, so a deploy and a content refresh can never run
against the box at the same time.

## Why code and data are separate pipelines
The DB seeds from `deploy/db/ainext_poc.sql.gz` on **first boot only**. Making a deploy reload it
would mean `down -v` — which also destroys the `claude_cfg` volume holding the one-time Claude
subscription login (browser OAuth; not redoable from CI). So deploys never touch data, and data
changes are a deliberate, backed-up, manually-triggered act.

**Three independent guards keep a code deploy away from the database:**
1. `refresh-content.yml` has **no `push:` trigger** — `workflow_dispatch` only.
2. The `loader` service in `docker-compose.yml` sits behind `profiles: ["tools"]`, so
   `docker compose up -d` (what deploy runs) can never start it.
3. `refresh-content.sh` builds the loader's arguments itself and validates the course id against
   `^course:[a-z0-9-]+$`, so no workflow input can smuggle in `--approve-all` or a shell fragment.

**`.github/workflows/ci-cd.yml`** is a single workflow with two jobs:

- **`build`** (GitHub-hosted; every branch + PR touching `app/**`): `npm ci` → `tsc --noEmit`
  → `next build`. A fast breakage gate.
- **`deploy`** (`needs: build`, `if: github.ref == 'refs/heads/main'`): runs **on the OCI box**
  via the self-hosted runner. Because deploy `needs: build`, a broken build never reaches the box.
  Feature branches / PRs get the build check only.

The deploy job: `git fetch`es the persistent checkout at **`/opt/reletix/AI.NEXT`**, verifies
`deploy/.env`, `docker compose up -d --build`, health-checks `127.0.0.1:3100`, then trims dangling
images. No inbound SSH; the runner polls GitHub; secrets stay on the box.

## One-time setup on the OCI box

### 1. Self-hosted runner (outbound-only)
Already installed as **`ainext-oci-1`** at `/opt/reletix/actions-runner-ainext` — systemd service,
repo-scoped to `samtoma/AI.NEXT`, labels `self-hosted,oci`, runs as `ubuntu` (∈ docker group).
To recreate:
```bash
mkdir -p /opt/reletix/actions-runner-ainext && cd "$_"
VER=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
curl -fsSL -o r.tgz "https://github.com/actions/runner/releases/download/v${VER}/actions-runner-linux-arm64-${VER}.tar.gz"
tar xzf r.tgz && rm r.tgz
./config.sh --url https://github.com/samtoma/AI.NEXT --token <REG_TOKEN> --labels oci --name ainext-oci-1 --unattended
sudo ./svc.sh install ubuntu && sudo ./svc.sh start
```
> The box is **ARM64** — use the `linux-arm64` runner. Get `<REG_TOKEN>` from repo
> **Settings → Actions → Runners → New self-hosted runner**, or
> `gh api -X POST repos/samtoma/AI.NEXT/actions/runners/registration-token --jq .token`.
> A self-hosted runner executes repo workflow code — fine for a repo you control; runs as its own
> non-root user and never needs access to the talent stack.

### 2. Secret on the box (never in GitHub)
Self-contained in the app folder — gitignored, and preserved by the deploy's git sync:
```bash
umask 077; mkdir -p /opt/reletix/AI.NEXT/deploy
printf 'POSTGRES_PASSWORD=%s\n' 'a-strong-password' > /opt/reletix/AI.NEXT/deploy/.env
chmod 600 /opt/reletix/AI.NEXT/deploy/.env
```
There is **no API key** — `claude` runs on your subscription (one-time login, see `DEPLOY.md`).

### 3. First deploy + Claude login + tunnel/Access
- Push to `main` (or **Actions → CI/CD → Run workflow**). Build gates, then the runner deploys.
- One-time `claude` login (browser OAuth — can't run in CI): `DEPLOY.md` bootstrap step 3.
- Add the public hostname + Access application once: `DEPLOY.md` → "Expose it".

## After that
Every push to `main` touching `app/**`, `services/extraction/seed/content/**`, `deploy/**`, or the
workflow redeploys automatically. `ainext_pg` (DB) and `claude_cfg` (login) persist; the seed dump
runs only on first boot. **New curriculum does not ship this way** — see below.

> **Doc-only commit?** Put `[skip ci]` in the message to skip a needless build+deploy.

## Content refresh — `refresh-content.yml`
**Actions → "Content refresh (manual)" → Run workflow** (on `main`). Full procedure, ordering rules
and rollback: `DEPLOY.md` → **"Refreshing content"**. In short:

| Input | Meaning |
|---|---|
| `mode` | `preview` (default — runs the whole load in a transaction and rolls back) · `course` · `full-reseed` · `status` |
| `course` | course node id, e.g. `course:prep3-social-ar` |
| `confirm` | `course`: retype the course id · `full-reseed`: type `FULL-RESEED` · otherwise empty |

The job runs on the same self-hosted `oci` runner, syncs `/opt/reletix/AI.NEXT` to the dispatched
commit exactly as the deploy job does (so bundles, loader and script all come from one commit —
source only; the running image is not rebuilt), then runs `deploy/refresh-content.sh`. Every
mutating mode takes a `pg_dump --clean --if-exists` backup **first**; the run summary shows the
before/after counts and the one-line rollback command.

Committing a new seed bundle (`services/extraction/seed/*.json`) deliberately triggers **nothing** —
it becomes live only when you run this workflow. Lesson prose (`seed/content/**`) is the exception:
it is baked into the image, so it ships with a normal deploy, which must happen **first**.

> The loader image (`ainext-loader`, deps only ~150 MB, built on the box) follows the same stable-tag
> rule as the app: rebuilds leave one dangling image, cleaned by the next deploy's
> `docker image prune -f`. Loader **code** is bind-mounted read-only from the checkout, so a content
> change never rebuilds it.

## Image hygiene (shared box)
Build-on-box uses a **stable tag** (`ainext-app`), so each real rebuild leaves exactly one dangling
image, which the deploy removes with `docker image prune -f` → the box keeps a **single**
`ainext-app`. The pipeline **never** uses `-a` / `docker system prune` / global `docker builder
prune`, which would delete other stacks' (talent, mailu, …) images or shared build cache. BuildKit's
own GC bounds the shared build cache.

## Alternative (no runner on the box)
Switch the `deploy` job to `runs-on: ubuntu-latest` and SSH in via `appleboy/ssh-action` (deploy key
+ host as GitHub secrets), running the same git-sync + `docker compose up -d --build`. That needs the
box reachable by SSH; the self-hosted runner avoids opening any inbound port, which is why it's the default.

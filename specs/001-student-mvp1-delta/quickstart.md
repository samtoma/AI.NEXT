# Quickstart — Standing Up the Comparison Environment

**Feature**: `001-student-mvp1-delta` | **Date**: 2026-09-08

The goal of P0: two URLs, same content, both Access-gated, parity check green. Everything else builds
on that.

> **Read before touching the box.** It is shared with production `talent.reletix.com`.
> Never `docker compose down -v` (it destroys the volume holding the one-time Claude login).
> Never `docker system prune` / `image prune -a` / `builder prune` — they hit the *shared* daemon.
> Every command below names its compose project explicitly. If a command does not say which
> environment it targets, do not run it.

## 0. Check the box has room (research.md R5)

```bash
free -h && df -h /var/lib/docker
docker ps --format '{{.Names}}\t{{.Status}}'
```

A second stack asks for roughly **3 GB** more steady state (`db` 1g + `app` 2g). If headroom is thin,
lower **the new stack's** `app` limit — never the baseline's, which would change the frozen
environment's behaviour under load.

## 1. Create the branch

```bash
git checkout -b mvp1 origin/main
git push -u origin mvp1
```

`main` continues to serve the baseline. `mvp1` is the comparison environment's branch, and the only
change that ever lands on `main` during the comparison is the analytics instrumentation PR (step 6).

## 2. Bootstrap the second stack on the box

```bash
sudo mkdir -p /opt/reletix/AI.NEXT-mvp1 && cd /opt/reletix/AI.NEXT-mvp1
git init -q && git remote add origin https://github.com/samtoma/AI.NEXT.git
git fetch origin mvp1 && git checkout -B mvp1 origin/mvp1

cp deploy/.env.example deploy/.env       # set a DIFFERENT POSTGRES_PASSWORD than the baseline
docker compose -p ainext-mvp1 -f deploy/docker-compose.mvp1.yml up -d --build
docker compose -p ainext-mvp1 -f deploy/docker-compose.mvp1.yml ps
curl -sSf http://127.0.0.1:3101/ >/dev/null && echo "mvp1 healthy on :3101"
```

The `-p ainext-mvp1` project name namespaces the volumes, so the two databases cannot collide.

## 3. Log the AI runtime in — once

The new stack has its own `claude_cfg` volume, so it needs its own one-time OAuth login (the
baseline's does not carry over):

```bash
docker compose -p ainext-mvp1 -f deploy/docker-compose.mvp1.yml exec app claude
# follow the OAuth prompt; credentials persist in the volume across every redeploy
```

## 4. Add the hostname (Cloudflare Zero Trust dashboard — **not** a local file)

Ingress on this box is dashboard-managed. `cloudflared tunnel route dns` and
`systemctl reload cloudflared` **do not apply** and will waste your afternoon.

**The hostname must stay a single label under `reletix.com`.** Universal SSL covers
`*.reletix.com`, and a wildcard matches exactly one label — so `ainext-mvp1.reletix.com` is covered
and `mvp1.ainext.reletix.com` is not. A nested name fails TLS in the browser before Access is
reached, which reads as a broken environment rather than a missing certificate.

1. Zero Trust → Networks → Tunnels → the existing tunnel → Public Hostnames → **Add**
2. Hostname `ainext-mvp1.reletix.com` → Service `http://localhost:3101`
3. Access → Applications → the existing AI.Next app → add the new hostname to it, so one policy
   covers both environments and pilot families are added and revoked in one place.

Verify it never serves publicly:

```bash
curl -sI https://ainext-mvp1.reletix.com | head -1     # expect a 302 to cloudflareaccess.com
```

## 5. Load content and prove parity

```bash
# same bundles as the baseline — this is the whole point
docker compose -p ainext-mvp1 -f deploy/docker-compose.mvp1.yml \
  run --rm loader python load_seed.py --all --course course:prep3-math-en

uv run services/extraction/parity_check.py --baseline "$BASELINE_DSN" --candidate "$MVP1_DSN"
```

Expected, and the check fails loudly on any difference:

```
source sha256   ✓ identical
modules         10  ✓
learning objs   90  ✓
prerequisites  112  ✓
questions      450  ✓   (live: 450 ✓)
visuals        212  ✓
LO id digest    ✓ identical
PARITY: GREEN
```

If **live** counts differ while totals match, a `--course` refresh has demoted questions back to
`review` on one side (PROJECT_STATE records this happening to Unit 1's 29). Promote or reload until
live counts match — the comparison is invalid until they do.

## 6. Instrument the baseline (the one change to `main`)

Add analytics emission only. Prove it changed no teaching behaviour before merging:

```bash
cd app && npx tsc --noEmit && npm test
npm run capture-prompts -- --against main      # expect: 0 prompt diffs
```

Zero diffs is the evidence that the baseline is still a baseline (FR-908, Principle XI). If the
harness reports any diff, the instrumentation has reached further than it should — fix scope, do not
waive the check.

## 7. Verify both are live and independent

```bash
curl -sI https://ainext.reletix.com      | head -1
curl -sI https://ainext-mvp1.reletix.com | head -1
docker compose -p ainext      ps      # baseline untouched, same uptime as before
docker compose -p ainext-mvp1 ps
```

## Rollback

```bash
# stop the comparison environment WITHOUT touching data or the login
docker compose -p ainext-mvp1 -f deploy/docker-compose.mvp1.yml down    # no -v, ever
```

Remove the hostname in the dashboard to cut access instantly — that is also the fastest lever for
withdrawing unreviewed content from students if something reads badly (decisions.md Q8/Q9).

## Definition of done for P0

- [ ] Both hostnames resolve, both 302 to Cloudflare Access, neither is public
- [ ] `parity_check.py` GREEN, including live counts
- [ ] Baseline stack uptime unbroken through the whole procedure
- [ ] Prompt capture: 0 diffs on `main`
- [ ] Box memory headroom confirmed after both stacks are up

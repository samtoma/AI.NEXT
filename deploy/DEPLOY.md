# Deploy — AI.Next tutor on Oracle OCI (co-tenant with talent.reletix.com)

Isolated Docker stack — **Next.js app + pre-seeded Postgres + bundled `claude` CLI** — living at
**`/opt/reletix/AI.NEXT`**, beside `talent/` and `talent-preprod/`. The app binds to
**`127.0.0.1:3100`** only; the box's existing cloudflared container fronts it at
**`ainext.reletix.com`**, gated by Cloudflare Access. Nothing here touches the talent stacks.
`docker compose down -v` removes it with no trace.

> **Normal operation is the pipeline, not manual commands.** Push to `main` and the CI/CD workflow
> builds + deploys on the box (see `CICD.md`). The commands below are the one-time bootstrap + reference.

## What runs
| Piece | Detail |
|---|---|
| `app` | Next.js 16, `next start` on `127.0.0.1:3100` (ARM image built on the box), mem 2g. Spawns `claude -p` per AI turn on **your Claude subscription** — one-time login, persisted in the `claude_cfg` volume. **No API key.** |
| `db`  | postgres:17-alpine, seeded on first boot from `db/ainext_poc.sql.gz`. Data in the `ainext_pg` volume. Not published to the host. mem 1g. |
| tunnel | the box's **existing token-managed cloudflared container** (`network_mode: host`) + one public hostname → `http://localhost:3100`. |

## Prereqs (already true on this box)
- Docker + Compose v2, and the self-hosted runner `ainext-oci-1` (see `CICD.md`).
- The existing cloudflared tunnel (token-managed; also serves talent.reletix.com).
- Your Claude account (one-time CLI login — no API key, no extra bill).

## First-time bootstrap (once)
```bash
# 1. Secret — self-contained in the app folder, gitignored, survives every redeploy.
#    (The pipeline's git sync uses fetch + reset --hard, which touch only TRACKED
#    files, so an untracked deploy/.env placed here is preserved.)
umask 077
mkdir -p /opt/reletix/AI.NEXT/deploy
printf 'POSTGRES_PASSWORD=%s\n' 'A_STRONG_PASSWORD' > /opt/reletix/AI.NEXT/deploy/.env
chmod 600 /opt/reletix/AI.NEXT/deploy/.env

# 2. First deploy — push to main (or Actions -> CI/CD -> Run workflow). The runner
#    populates /opt/reletix/AI.NEXT, builds the image, starts the stack, health-checks :3100.

# 3. ONE-TIME Claude login (OAuth needs a browser; cannot run in CI):
cd /opt/reletix/AI.NEXT/deploy
docker compose exec app claude    # choose "Claude subscription", open the URL, paste the code, Ctrl-C
#    Creds land in the claude_cfg volume and survive every future deploy.

# 4. Verify locally, before it matters:
curl -sSf http://127.0.0.1:3100/ >/dev/null && echo "app OK"
docker compose exec -T app sh -lc 'claude -p "reply OK" --model claude-sonnet-5 --max-turns 1 </dev/null'
```

## Expose it (Cloudflare — DASHBOARD, not a local config file)
This tunnel runs in **token mode** (a containerized connector with `TUNNEL_TOKEN`), so ingress is
managed in the **Cloudflare Zero Trust dashboard**, *not* `~/.cloudflared/config.yml`.
`cloudflared tunnel route dns` / `systemctl reload cloudflared` do **not** apply here.

1. **Zero Trust → Networks → Tunnels →** the tunnel serving talent **→ Public Hostname → Add:**
   - Subdomain `ainext`, Domain `reletix.com`, Path empty
   - Type **HTTP**, URL **`localhost:3100`** ← HTTP, *not* HTTPS; host-network mode makes `localhost` reach the app
   - Save. DNS auto-created; talent's hostnames stay untouched; the connector hot-reloads (no restart).
2. **Lock it down — Zero Trust → Access → Applications → Add application → Self-hosted:**
   - Public hostname `ainext.reletix.com`
   - Policy: **Allow → Include → Emails →** the people who may enter (login = one-time PIN).
   - Create from a clean `.../access-controls/apps/self-hosted/add` — the "Self-hosted and private"
     wizard seeds a private-IP template that 400s a public app on
     `use_clientless_isolation_app_launcher_url`.

## Safety rails (production box!)
- **Never** modify/restart/reorder talent.reletix.com; **never** run `docker system prune`,
  `docker image prune -a`, or `docker builder prune` — those hit the *shared* box. The pipeline
  only runs `docker image prune -f` (untagged rebuild leftovers).
- The app port is `127.0.0.1`-only; the internet reaches it **only** through the tunnel + Access.
- `deploy/.env` is the only secret, gitignored — keep it that way.

## Rollback
- `docker compose down` (keep data) or `down -v` (also wipes the seeded DB **and** the Claude login).
- Remove the public hostname + the Access application in the dashboard.

## Updating later
Push to `main` — the pipeline rebuilds the app and swaps the container; the `ainext_pg` DB volume and
`claude_cfg` login persist. The DB seeds **only on first boot**; to reload content after schema/seed
changes: `docker compose down -v` on the box, then re-run the pipeline.

## Common gotchas
- **`claude` "not logged in"** → run the one-time login (bootstrap step 3). Persists in `claude_cfg`;
  only `down -v` wipes it.
- **502 through the tunnel** → the public-hostname Type must be **HTTP** → `localhost:3100`.
- **Access "Users" shows only you** → that page lists people who have logged in; the allow-list is
  the Access *policy*. Others appear there after their first sign-in.
- **Port 3100 taken** → change the host port in `docker-compose.yml` and the tunnel hostname target.

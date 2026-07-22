# Deploy — AI.Next tutor on Oracle OCI (co-existing with talent.reletix.com)

Isolated Docker stack: **Next.js app + Postgres (pre-seeded) + bundled `claude` CLI**.
App is bound to `127.0.0.1:3100`; a Cloudflare tunnel fronts it. Nothing here touches
the existing talent.reletix.com stack. `docker compose down -v` removes it with no trace.

## What runs
| Piece | Detail |
|---|---|
| `app` | Next.js 16, `next start` on `127.0.0.1:3100`, mem-capped 2g. Spawns `claude -p` per AI turn — runs on **your Claude subscription** (one-time login, persisted in a volume). No API key. |
| `db` | postgres:17, seeded on first boot from `db/ainext_poc.sql.gz` (full math + social book). mem-capped 1g. |
| tunnel | your existing cloudflared + one new ingress rule → `localhost:3100`. |

## Prereqs (on the box)
- Docker + Docker Compose v2 (`docker compose version`).
- The existing cloudflared tunnel (the one serving talent.reletix.com).
- Your Claude account (for a one-time `claude` CLI login — no API key, no extra bill).

## Steps
```bash
# 1. get the code
git clone https://github.com/samtoma/AI.NEXT.git   # or: git pull
cd AI.NEXT && git checkout feat/full-social-book-rich-pipeline

# 2. secret (gitignored — never commit) — just the DB password
cd deploy && cp .env.example .env
#   edit .env → POSTGRES_PASSWORD

# 3. (recon) make sure 3100 is free; else change the port in docker-compose.yml
ss -ltnp | grep -E ':3100|:5432' || echo "3100 free"

# 4. build + run
docker compose up -d --build
docker compose ps
docker compose logs -f app        # wait for "Ready" / listening on :3000

# 5. ONE-TIME: log the bundled claude CLI into your Claude subscription.
#    Opens the OAuth device flow (a URL + code you approve in your browser).
#    Creds land in the claude_cfg volume and survive every redeploy.
docker compose exec app claude       # follow the login prompt, then Ctrl-C to exit the TUI
#    (if it doesn't prompt, try:  docker compose exec app claude /login )

# 6. verify locally (before exposing) — including a real AI turn
curl -sSf http://localhost:3100/ >/dev/null && echo "app OK"
docker compose exec app sh -lc 'claude -p "reply OK" --model claude-sonnet-5 --max-turns 1'

# 7. expose via the tunnel (see cloudflared-ingress.example.yml)
#   add the hostname rule to your existing cloudflared config, then:
cloudflared tunnel route dns <TUNNEL_NAME> ainext.reletix.com
sudo systemctl reload cloudflared
```

## Safety rails (production box!)
- **Do not** modify, restart, or reorder anything for talent.reletix.com.
- The app port is `127.0.0.1`-only; the internet reaches it **only** through the tunnel.
- `.env` holds the only secrets and is gitignored — keep it that way.
- Rollback: `docker compose down` (keep data) or `down -v` (wipe the seeded DB too), and
  remove the ingress rule you added.

## Updating later
```bash
git pull && cd deploy && docker compose up -d --build   # rebuilds app; DB volume persists
```
> The DB seeds **only on first boot** (empty volume). To reload data after schema/content
> changes: `docker compose down -v` then `up -d --build`, or restore a fresh `db/ainext_poc.sql.gz`.

## Common gotchas
- **`claude` errors / "not logged in" in-container** → run the step-5 login once. It persists in
  the `claude_cfg` volume across redeploys; only `docker compose down -v` wipes it (then re-login).
  AI turns stream over a few seconds.
- **Redeploys keep the login** → `up -d --build` (and the CI/CD job) never touch the volume. Only
  `down -v` drops the login *and* the seeded DB.
- **Port 3100 taken** → change the host port in `docker-compose.yml` and the tunnel target.
- **502 through the tunnel** → the ingress `service:` port must match the compose host port.

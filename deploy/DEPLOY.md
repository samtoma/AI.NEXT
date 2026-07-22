# Deploy — AI.Next tutor on Oracle OCI (co-existing with talent.reletix.com)

Isolated Docker stack: **Next.js app + Postgres (pre-seeded) + bundled `claude` CLI**.
App is bound to `127.0.0.1:3100`; a Cloudflare tunnel fronts it. Nothing here touches
the existing talent.reletix.com stack. `docker compose down -v` removes it with no trace.

## What runs
| Piece | Detail |
|---|---|
| `app` | Next.js 16, `next start` on `127.0.0.1:3100`, mem-capped 2g. Spawns `claude -p` per AI turn (needs `ANTHROPIC_API_KEY`). |
| `db` | postgres:17, seeded on first boot from `db/ainext_poc.sql.gz` (full math + social book). mem-capped 1g. |
| tunnel | your existing cloudflared + one new ingress rule → `localhost:3100`. |

## Prereqs (on the box)
- Docker + Docker Compose v2 (`docker compose version`).
- The existing cloudflared tunnel (the one serving talent.reletix.com).
- An Anthropic API key with access to `claude-sonnet-5`.

## Steps
```bash
# 1. get the code
git clone https://github.com/samtoma/AI.NEXT.git   # or: git pull
cd AI.NEXT && git checkout feat/full-social-book-rich-pipeline

# 2. secrets (gitignored — never commit)
cd deploy && cp .env.example .env
#   edit .env → ANTHROPIC_API_KEY, POSTGRES_PASSWORD

# 3. (recon) make sure 3100 is free; else change the port in docker-compose.yml
ss -ltnp | grep -E ':3100|:5432' || echo "3100 free"

# 4. build + run
docker compose up -d --build
docker compose ps
docker compose logs -f app        # wait for "Ready" / listening on :3000

# 5. verify locally (before exposing)
curl -sSf http://localhost:3100/ >/dev/null && echo "app OK"
#   smoke-test the AI backend inside the container:
docker compose exec app sh -lc 'claude -p "reply OK" --model claude-sonnet-5 --max-turns 1'

# 6. expose via the tunnel (see cloudflared-ingress.example.yml)
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
- **`claude` errors in-container** → check `ANTHROPIC_API_KEY` is set and the key has
  `claude-sonnet-5` access; test with the step-5 smoke command. AI turns stream over a few seconds.
- **Port 3100 taken** → change the host port in `docker-compose.yml` and the tunnel target.
- **502 through the tunnel** → the ingress `service:` port must match the compose host port.

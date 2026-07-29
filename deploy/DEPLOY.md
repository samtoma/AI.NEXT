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
| `loader` | **not running** — a `profiles: ["tools"]` service used only by `./refresh-content.sh` to load new curriculum into the live DB. `docker compose up -d` never starts it. |

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
`claude_cfg` login persist. **Code and data ship separately**: a deploy never changes the database.
For new curriculum, see the next section.

---

# Refreshing content

> **Never `down -v` to reload content.** It wipes the `claude_cfg` volume, and the Claude
> subscription login is a browser OAuth flow that cannot be redone from CI. Everything below
> leaves every volume untouched.

The DB seeds itself from `db/ainext_poc.sql.gz` **on first boot only** — Postgres ignores that file
once the `ainext_pg` volume exists. New content reaches the live site through
**`deploy/refresh-content.sh`**, from the Actions tab or on the box.

### Content has two halves — ship them in this order
| Half | Lives in | Reaches the box via |
|---|---|---|
| graph, objectives, questions, visuals | Postgres | **this** refresh procedure |
| lesson prose (`services/extraction/seed/content/*.json`) | baked into the app **image** | a normal deploy (push to `main`) |

So: **push to `main` first** (the deploy rebuilds the image with the new lesson files), **then** run
the refresh. The script compares the running image's content files against the checkout and warns
you if you got the order wrong.

### From the Actions tab (the normal way — no SSH)
**Actions → "Content refresh (manual)" → Run workflow**, on `main`:

| Input | Meaning |
|---|---|
| `mode` | `preview` (default, writes nothing) · `course` · `full-reseed` · `status` |
| `course` | e.g. `course:prep3-social-ar`, `course:prep3-math-en` |
| `confirm` | `course` mode: retype the course id. `full-reseed`: type `FULL-RESEED`. Otherwise empty. |

1. **Run `preview` first.** It performs the entire load against the real database inside a
   transaction — same validation, same sacred gate, same live/review split — then **rolls back**.
   The log prints an exact before → after table. Nothing is written.
2. Read the `LIVE questions` line. If it goes **down**, the new bundle marks fewer questions
   `verified` than whatever is loaded now (e.g. content promoted in the past by `--approve-all`
   returns to `review`). That is the review gate working — decide before proceeding.
3. Re-run with `mode: course` and the confirm phrase. It backs up first, then loads.
4. The run summary shows the counts and the one-line rollback command.

### On the box (same script, when you are already SSH'd in)
```bash
cd /opt/reletix/AI.NEXT/deploy
./refresh-content.sh status                            # what is running / loaded / backed up
./refresh-content.sh preview course:prep3-social-ar    # rehearse, write nothing
./refresh-content.sh course  course:prep3-social-ar    # back up, then replace that course
./refresh-content.sh full-reseed                       # restore db/ainext_poc.sql.gz whole
./refresh-content.sh restore backups/ainext-….sql.gz   # roll back
```

### What a scoped refresh actually does
`--course` **replaces one course's subtree** (its modules, objectives, questions, visuals) and
leaves every other course alone, in **one transaction** — readers keep seeing the old content until
it commits, so it is safe with the site up, and a failure rolls itself back. No app restart is
needed: every data page is `force-dynamic`.

- Bundles are chosen **automatically** from the course id (`--all --course …`), including load order.
- Cross-subject `relates_to` bridges are detached and re-attached with their original rationale.
- **`--approve-all` is not reachable from this path.** Questions go live only if their bundle marks
  them verified; everything else lands as `review` and is never served to a student.
- Student attempts/mastery rows that point at *removed* content are deleted (PoC behaviour) — the
  count is printed.

### Rollback
Every mutating run takes `pg_dump --clean --if-exists` **first**, into
`/opt/reletix/AI.NEXT/backups/` (0600, gitignored — it contains student rows). The path and the
undo command are printed in the log and in the Actions run summary:
```bash
cd /opt/reletix/AI.NEXT/deploy
./refresh-content.sh restore backups/ainext-20260729-2210Z-course-course-prep3-social-ar.sql.gz
```
That stops the app, restores over the live DB, restarts the app, health-checks `:3100`. Backups are
never deleted automatically; prune by hand when you are sure. If a *load* fails, nothing was
written at all — the loader's transaction rolled back — so there is nothing to undo.

### Regenerating the first-boot seed dump
`db/ainext_poc.sql.gz` only matters for a **brand-new stack** (fresh volume, new box, disaster
recovery). Refresh it after a content milestone or a schema change, **on your laptop**:
```bash
cd deploy && ./make-seed-dump.sh          # from your local ainext_poc; then commit
```
It writes a `--clean --if-exists` dump (restorable over a populated DB, so the same artifact serves
first boot *and* `full-reseed`), always excludes `ai_interactions` (AI transcripts + cost logs),
and **refuses to run if the source DB holds any non-demo student** — use `--no-student-data` then.
A seed dump goes into git; pilot students are minors and must never end up there.

## Common gotchas
- **`claude` "not logged in"** → run the one-time login (bootstrap step 3). Persists in `claude_cfg`;
  only `down -v` wipes it — which is why content refreshes never use it.
- **New content is not visible on the site** → a deploy ships code, not data. Run the refresh
  (above). If the *lesson text* is missing but the objectives are there, the image is older than
  the DB: push to `main` first, then refresh.
- **502 through the tunnel** → the public-hostname Type must be **HTTP** → `localhost:3100`.
- **Access "Users" shows only you** → that page lists people who have logged in; the allow-list is
  the Access *policy*. Others appear there after their first sign-in.
- **Port 3100 taken** → change the host port in `docker-compose.yml` and the tunnel hostname target.

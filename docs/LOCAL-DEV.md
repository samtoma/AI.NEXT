# Running the comparison build locally

Everything except the Cloudflare ingress runs on a laptop. This is how the work
so far was actually verified — it is not a hypothetical setup.

## Two ways in

**Docker — nothing needed on your machine but Docker.** No Node, no Python, no
Postgres. The `claude` CLI is inside the image and runs on your own subscription;
you log it in once and it persists.

```bash
./scripts/local-docker.sh          # build, start, load content
./scripts/local-docker.sh --login  # one-time: log the CLI into your Claude account
```

> **Test status, stated plainly:** the compose file and script are written and
> schema-validated, and the first-boot migration mechanism was exercised against
> a real Postgres — but the stack has **not been run end to end**, because the
> container this was built in cannot reach Docker Hub (image pulls are blocked by
> its network policy). If it trips on your machine, send me the output.

**Native — fully tested end to end**, including from a clean database with and
without `uv` present.

```bash
./scripts/local-dev.sh
```

Creates the database, applies the schema and all nine migrations, loads the 450
questions, promotes them, runs the parity check, writes `app/.env.local` and
starts the dev server on http://localhost:3000. Safe to re-run — every step
skips work already done. `--reset` starts from an empty database, `--no-serve`
prepares without starting the server.

If it cannot reach Postgres it tells you the exact command for your platform.

The rest of this document is what that script does, step by step, for when you
need to do part of it by hand.

## 1. Postgres

Any Postgres ≥ 16. On a Mac with the project's existing convention:

```bash
brew services start postgresql@17
createdb ainext_mvp1
```

Or a throwaway instance on a spare port (what CI/containers use):

```bash
initdb -D /tmp/pgtest -U ainext --auth=trust
pg_ctl -D /tmp/pgtest -o "-p 55432 -k /tmp/pgsock -h 127.0.0.1" -l /tmp/pg.log start
createdb -h 127.0.0.1 -p 55432 -U ainext ainext_mvp1
```

## 2. Schema + every migration, in order

Migration **009** is the MVP 1.0 delta (BKT columns, misconceptions,
explanation_library, analytics_events, safety_flags, uploads). It is idempotent —
re-running it is safe and is worth doing once to confirm that.

```bash
export PG="-h 127.0.0.1 -p 55432 -U ainext -d ainext_mvp1"
psql $PG -f db/schema.sql
for m in db/migrations/*.sql; do psql $PG -v ON_ERROR_STOP=1 -f "$m"; done
```

## 3. Load the maths content

```bash
cd services/extraction
export AINEXT_DB_DSN="host=127.0.0.1 port=55432 dbname=ainext_mvp1 user=ainext"
uv run load_seed.py --all --course course:prep3-math-en
```

Expect **450 questions, 421 live, 29 at review**. That 29 is Unit 1's
bulk-promoted set being demoted by a scoped load — the behaviour PROJECT_STATE
records, and the reason the parity check compares live counts separately.

## 4. Prove parity

```bash
uv run parity_check.py --candidate "$AINEXT_DB_DSN"
```

Straight after a fresh load this is **RED**, and correctly so:

```
questions  450  (live: 421)
✗ questions_live (421) < questions_total (450) — a scoped refresh has demoted
  questions back to 'review'
```

Promote and it goes GREEN:

```bash
psql $PG -c "UPDATE questions SET status='live',
             reviewed_by='local dev', reviewed_at=now() WHERE status='review';"
uv run parity_check.py --candidate "$AINEXT_DB_DSN"     # PARITY: GREEN
```

## 5. Run the app

```bash
cd app
cat > .env.local <<'ENV'
DATABASE_URL=postgres://ainext@127.0.0.1:55432/ainext_mvp1
AINEXT_ENVIRONMENT=mvp1
ENV
npm install && npm run dev          # http://localhost:3000
```

`AINEXT_ENVIRONMENT` is what tags every analytics row and cost record. Set it to
`mvp1` locally; leaving it unset defaults to `baseline`, which would quietly file
your local experiments under the frozen environment.

The AI runtime (`claude` CLI) is only needed for lesson/chat turns. Everything
below works without it.

## 6. What to exercise, and what you should see

```bash
# create a student with grade + interests
curl -s -X POST localhost:3000/api/demo-students -H 'Content-Type: application/json' \
  -d '{"name":"Nour","grade":"9","interests":["sports"],
       "interestDetail":{"sports":{"which":["football"]}}}'

# a wrong answer, then correct ones, on one question
curl -s -X POST localhost:3000/api/attempts -H 'Content-Type: application/json' \
  -b 'ainext_demo_student=2' \
  -d '{"questionId":"q:u5-3-3:003","givenAnswer":"999999"}'
```

Verified behaviour on this exact path:

| What | Observed |
|---|---|
| Cold start | `0.3000` — the same prior the Elo model used, so the two builds start level |
| One wrong answer | `0.3000 → 0.1458` |
| Three correct | `0.4909 → 0.8314 → 0.9612` |
| Saturation | 15 correct reaches exactly `0.9800`, the clamp ceiling |
| Still revisable | one wrong answer from the ceiling → `0.8737` |
| History | one row per observation, previous rows closed, `evidence` carrying prior/posterior/observation |
| Grade validation | `{"grade":"99"}` → 400 |
| Interests optional | omitting them succeeds, event records `skipped_interests: true` |
| Authoring gap | with an empty library, each wrong answer writes one `misconception_gap` flag |

Useful queries:

```sql
-- mastery as a probability, with the evidence that moved it
SELECT round(score::numeric,4), evidence->>'observation', system_to IS NULL AS current
  FROM mastery WHERE student_id = 2 ORDER BY system_from;

-- every event carries its environment; metrics are never pooled
SELECT environment, event, count(*) FROM analytics_events GROUP BY 1,2;

-- how much unreviewed teaching is live (SC-011)
SELECT count(*) FILTER (WHERE NOT reviewed) AS unreviewed, count(*) FROM explanation_library;
```

## What this setup cannot cover

- **Cloudflare Access and the hostname** — ingress only exists on the box.
- **Lesson / chat turns** — need the `claude` CLI logged in.
- **The prompt byte-identity harness** — needs two checkouts against one database.
- **A real two-environment comparison** — one local database is one environment;
  parity is meaningful only between two.

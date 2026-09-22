# Deploying the MVP 1.0 environment (the `PDR1-0` solution)

> **Re-cut 2026-09-13 (T136, [ADR-0010](../docs/decisions/0010-one-branch-per-solution.md)).**
> The deploy branch is **`PDR1-0`**, not `mvp1` — that branch never existed. Each solution branch
> carries its own copy of `ci-cd.yml` and deploys only itself; there is no branch→environment
> matrix any more. The directory, compose project, volume, database and `AINEXT_ENVIRONMENT` tag
> below deliberately keep the name `mvp1`: they name the **environment and its stack**, not the
> branch, and `mvp1` is already written into every analytics row, ledger row and cost record in
> that database — the content loader refuses to run against any other value.

Companion to `DEPLOY.md` (the baseline) and `CICD.md`. First-time bootstrap is in
`specs/001-student-mvp1-delta/quickstart.md`; this file is the ongoing runbook.

## The two solutions

| | Baseline — **frozen** | `PDR1-0` |
|---|---|---|
| Branch | `main` (untouched — see ADR-0010) | `PDR1-0` |
| Checkout | `/opt/reletix/AI.NEXT` | `/opt/reletix/AI.NEXT-mvp1` |
| Compose project | `ainext` | `ainext-mvp1` |
| Compose file | `deploy/docker-compose.yml` | `deploy/docker-compose.mvp1.yml` |
| Database | `ainext_poc` (vol `ainext_pg`) | `ainext_mvp1` (vol `ainext-mvp1_ainext_mvp1_pg`) |
| App port | `127.0.0.1:3100` | `127.0.0.1:3101` |
| Console port | — (no console on the baseline) | `127.0.0.1:3102` |
| Hostname | ainext.reletix.com | **noor.reletix.com** (settled 2026-09-22) |
| Console hostname | — | **`admin-noor.reletix.com`** (Samuel, 2026-09-22), see [`TAKEOVER.md`](./TAKEOVER.md) §2.2 |
| `AINEXT_ENVIRONMENT` | `baseline` (default) | `mvp1` |

> **Taking the live deployment over — branches, hostname, database, the Claude CLI login and mail —
> is its own study: [`TAKEOVER.md`](./TAKEOVER.md).** Read it before touching `main`, before adding a
> public hostname, and before deciding whether to start the database fresh.

> **Hostnames stay one label deep.** Universal SSL covers `*.reletix.com`, and a wildcard matches
> exactly one label — `ainext-mvp1.reletix.com` is covered, `mvp1.ainext.reletix.com` is not. Any
> future environment on this zone follows the same rule.

Both sit behind the **same** Cloudflare Access application, so pilot families are
granted and revoked in one place. That revocability is what bounds the risk of
serving unreviewed generated content (ADR-0007, decisions.md Q8/Q9) — it is the
fastest lever you have if something reads badly.

## Rules that are not negotiable on this box

The box is shared with production `talent.reletix.com`.

- **Always name the project.** `docker compose -p ainext-mvp1 -f deploy/docker-compose.mvp1.yml …`
  An unqualified compose command in the wrong directory restarts the frozen baseline.
- **Never `down -v`.** It destroys the volume holding that stack's one-time Claude
  login, and on the baseline it would take pilot data with it.
- **Never `docker system prune` / `image prune -a` / `builder prune`.** They hit the
  *shared* daemon. The pipeline prunes dangling images only.
- **The baseline is frozen.** The only change it may receive while the comparison
  runs is analytics instrumentation, and only with the prompt capture harness
  reporting zero diffs (FR-908).

## Routine operations

```bash
cd /opt/reletix/AI.NEXT-mvp1/deploy
C="docker compose -p ainext-mvp1 -f docker-compose.mvp1.yml"

$C ps                       # status
$C logs --tail=120 app      # student surface logs
$C logs --tail=120 console  # admin console logs
$C logs migrate             # WHICH MIGRATIONS RAN on the last `up`, and every check
$C up -d --build            # redeploy (CI does this on push to PDR1-0)
$C down                     # stop — WITHOUT -v, ever
```

## Three services you did not have before

`up` now brings up more than `db` + `app`, and the ordering is load-bearing.

- **`migrate`** — a one-shot that applies `db/schema.sql` (only to an empty database) and every file
  in `db/migrations/` (every time; they are idempotent by construction), then runs four post-flight
  checks. `app`, `console` and the loader all declare `service_completed_successfully` on it, so a
  migration failure means the app is **not started at all** rather than started against a
  half-migrated database. It connects as the database owner, because no other role may create a
  table in schema `public` — the argument is in [`apply-migrations.sh`](./apply-migrations.sh).
  **If a deploy fails, read `$C logs migrate` first.** It says which file stopped it and what to do.
- **`console`** — the admin console, the same image as `app` with `npm run start:admin`
  (`AINEXT_SURFACE=admin`, artefact `.next-admin`). Same commit as the student surface by
  construction. Bound to `127.0.0.1:3102`. **It must sit behind Cloudflare Access before it gets a
  public hostname** — see [`cloudflared-ingress.example.yml`](./cloudflared-ingress.example.yml).
- The **`loader`** now waits for `migrate` too, so a content refresh can no longer run against a
  database that is behind on migrations.

The very first `up` on a fresh database will **stop** with "no password set for: ainext_app,
ainext_operator, ainext_maint" and print the three `ALTER ROLE` commands. That is expected: migration
017 creates those roles without passwords on purpose, so that no credential is ever written into
git. Set them, put the same values in `deploy/.env`, deploy again.

> **⏸️ Deploy is currently MANUAL-ONLY (2026-09-13, `T139`).** Samuel has parked infra work until
> the product is finalised and tested locally, so **a push does not deploy**. Run it by hand from
> Actions → CI/CD → Run workflow, on this branch. To re-arm automatic deploys, change
> `== 'workflow_dispatch'` back to `!= 'pull_request'` in the deploy job. Until then, use
> `docs/LOCAL-DEV.md` to run and verify the product.

When armed, deploys are automatic: pushing `PDR1-0` runs **this branch's own copy** of `ci-cd.yml`, which
targets this environment's directory, project, compose file and port directly — no branch mapping.
The baseline deploys from its own branch using the copy of the workflow that lives there.

⚠️ The shared-box safety rails (dangling-only pruning, never `system prune`, health gate before
traffic) now exist in one copy per solution branch. **If you change a rail, change it on every
solution branch** — the copy that drifts is the one that eventually prunes production's images.
The `concurrency: deploy-oci` group is shared across branches on purpose, so two solutions never
deploy onto the box at the same time.

## Content refresh and parity

Content no longer has to match the baseline — cross-solution parity was withdrawn
(ADR-0010 Clarification; the two solutions may diverge completely). What `parity_check.py` still
enforces is a **per-solution drift guard**: this environment must not silently drift from the
content set it is supposed to serve.

```bash
# load the same bundles the baseline serves
$C run --rm loader python load_seed.py --all --course course:prep3-math-en

# then PROVE they match — run this after every refresh in EITHER environment
uv run services/extraction/parity_check.py \
  --baseline "$BASELINE_DSN" --candidate "$MVP1_DSN"
```

Expect `PARITY: GREEN` with 10 modules / 90 LOs / 112 prerequisite edges /
450 questions / 212 visuals.

If **live** counts differ while totals match, a scoped refresh has demoted
questions back to `review` on one side. The environments are then serving
different question sets while looking identical by count — promote or reload
until live counts match. The check fails on this deliberately.

## Unreviewed content — what is live and to whom

Constitution v2.0.0 Principle III is suspended here for generated explanation
content only. It is queryable at any time:

```sql
SELECT count(*) FILTER (WHERE NOT reviewed) AS unreviewed,
       count(*)                             AS total
FROM explanation_library;
```

Questions and canonical solutions are **not** covered by the suspension — they
keep the normal `status` review gate.

## Safety escalation — OWNER NOT YET NAMED

`safety_flags` records crisis flags and the dispatch adapter sends them out of
band, separate from the analytics queue. **The human recipient has not been named
(tasks T067).** Until a person and a response expectation are recorded here, this
environment carries founders only — an unmonitored channel produces a record that
looks like a safeguard and is not one.

> **Recipient:** _(unassigned — Samuel to fill in before any student is invited)_
> **Response expectation:** _(unassigned)_

## Rollback

```bash
$C down                                  # stop the comparison stack, no -v
```

To cut access instantly, remove the hostname from the Cloudflare Zero Trust
dashboard — faster than any deploy, and the right lever for withdrawing content
from students. The baseline is unaffected either way.

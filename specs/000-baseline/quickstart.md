# Quickstart — AI.Next Tutor PoC

**Date**: 2026-08-02 · For the full runbooks see `deploy/DEPLOY.md` (box ops) and
`deploy/CICD.md` (pipelines). This page is the 5-minute orientation.

## Run it locally

```bash
# 1. Postgres with the seed (or point DATABASE_URL at an existing ainext_poc)
#    default: postgres://localhost:5432/ainext_poc

# 2. App
cd app && npm ci && npm run dev        # or: preview_start "tutor-poc" in Claude Code
# open http://localhost:3000/student

# 3. AI turns need the claude CLI on PATH (subscription login) — no API key.
```

Useful local commands:

```bash
cd app && npx tsc --noEmit && npm test && npm run build     # the quality gates
node --import ./scripts/ts-resolver.mjs scripts/capture-prompts.mts /tmp/prompts  # prompt byte-identity capture
cd services/extraction && uv run selfcheck_arabic.py         # 106-case contract self-check
cd services/extraction && uv run audit_arabic.py             # deterministic full-book audit
cd services/extraction && uv run load_seed.py --validate-only --all   # bundle validation
```

Dev harnesses (no DB/AI): `/dev/lesson-content`, `/dev/social-fixture`.

## Ship code

```
branch → PR → merge to main → self-hosted runner builds on the box → :3100 health gate
```
**Merging to main deploys the live site** (ainext.reletix.com, Cloudflare Access).
A code deploy can never touch data (loader is compose-profile-gated).

## Ship content

From the GitHub Actions tab → **Content refresh (manual)**:

| Mode | Confirmation | What it does |
|---|---|---|
| `status` | — | counts, drift check, backups list (read-only) |
| `preview <course:id>` | — | full rehearsal in a rolled-back transaction (zero writes) |
| `course <course:id>` | retype the course id | backup → scoped subtree replace |
| `full-reseed` | `FULL-RESEED` | backup → restore committed dump (whole DB) |
| `promote-poc` | `PROMOTE-POC` | backup → bulk review→live (PoC only) |

Every mutating run prints `roll back with: ./refresh-content.sh restore backups/…`.

## Extract a new book/lesson (the pipeline)

1. Conveyor: `services/extraction/runbook/arabic-lesson.workflow.js` (or
   `rich-lesson.workflow.js` for social) via the Workflow tool — segment → text →
   artefacts → questions → interactives → verify → coverage oracle.
2. Assemble: `assemble_arabic.py` (sacred lane: dual-authority fetch, seal, FLAG) →
   `seed/*.json` + `seed/content/*.json`.
3. Gate: selfcheck + audit + review workflow → commit → Actions `preview` then `course`.
4. New questions land at `status='review'` — promote through the gate.

## Cardinal rules (constitution shorthand)

- Never hand-type or "fix" Quranic text — fetch by citation, cross-verify, FLAG.
- Never `--approve-all` a sacred bundle. `selfcheck_arabic.py` stays 100%.
- Math+social prompts stay byte-identical through refactors (capture harness).
- Never `docker compose down -v` on the box (kills the Claude login volume).
- Samuel decides architecture; ADRs record it; PROJECT_STATE stays current.

---
name: project-status
description: Show where the AI Tutor project stands, or update the project state after progress/decisions. Use at session start ("where are we?"), after completing milestones, or when Samuel says "update the status".
---

# Project Status

The single source of truth is `docs/PROJECT_STATE.md`.

## To report status ("where do we stand?")
1. Read `docs/PROJECT_STATE.md` and `docs/decisions/` (list ADR titles/statuses).
2. Summarize in this order: current phase → days until target launch (late Sept 2026) → what's done since last update → in progress → the top 3 next actions → open questions blocking on Samuel.
3. Cross-check against reality: if the doc claims something is done but the files/code don't show it (or vice versa), say so explicitly.

## To update status
1. Read the current `docs/PROJECT_STATE.md`.
2. Move completed items to **Done** (with dates), refresh **In progress** and **Next** (keep Next aligned to PRD §10 milestone exit criteria), add/resolve **Open questions**, sync the **Decisions log** table with `docs/decisions/`.
3. Update the "Last updated" date. Keep the whole doc under two screens — prune history older than the current phase into a brief one-line-per-phase archive at the bottom.
4. Never mark something done that wasn't verified. If Samuel made a decision in conversation, also record it as an ADR (see the `adr` skill).

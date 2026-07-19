---
name: adr
description: Record an architecture/technology/design decision Samuel has made as an Architecture Decision Record in docs/decisions/. Use when Samuel confirms a choice ("let's go with X", "decided"), never for proposals he hasn't approved.
---

# Architecture Decision Record

ADRs live in `docs/decisions/NNNN-short-title.md` (zero-padded sequence; check existing files for the next number).

**Hard rule:** only Samuel's explicitly confirmed decisions become ADRs. If he hasn't clearly decided, stop and ask — do not infer a decision from a leaning.

## Template
```markdown
# ADR-NNNN: <Title>

- **Status:** Accepted | Superseded by ADR-XXXX
- **Date:** YYYY-MM-DD
- **Decided by:** Samuel (CTO/Architect)

## Context
What problem/choice forced a decision. Constraints that shaped it (MVP timeline, cost ceiling, RTL/3G requirements, minors' data...).

## Options considered
1. **Option A** — pros / cons (one line each)
2. **Option B** — pros / cons

## Decision
What was chosen, stated in one sentence. Key parameters (versions, tiers, limits) pinned.

## Consequences
What this enables, what it costs, what becomes harder, and what would trigger revisiting it.
```

## After writing
1. Add/refresh the row in the Decisions log table in `docs/PROJECT_STATE.md`.
2. If the decision changes agent guidance (e.g. the stack ADR), check whether `CLAUDE.md` or an agent file in `.claude/agents/` references the pending decision and update it.

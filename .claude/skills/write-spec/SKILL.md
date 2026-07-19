---
name: write-spec
description: Write an implementation-ready feature spec in docs/specs/ derived from the PRD. Use when starting work on a PRD feature (diagnostic, adaptive sessions, explanations, admin tool, reports...) or when Samuel asks to spec something out.
---

# Feature Spec

Specs live in `docs/specs/<feature-name>.md`. A spec is implementation-ready when an agent can build from it without re-reading the whole PRD.

## Before writing
1. Read the relevant PRD section (`AI.Next - Google Folder 17 Jul 2026/AI Tutor/PRD/PRD-ai-tutor-mvp.md`) — the PRD is product authority; the spec derives from it and must not silently expand scope.
2. Read `docs/PROJECT_STATE.md` and relevant ADRs in `docs/decisions/`. If the spec depends on an undecided ADR (e.g. stack), mark that dependency at the top rather than assuming.

## Template
```markdown
# Spec: <Feature>

- **Status:** Draft | Approved by Samuel
- **PRD source:** §X.Y
- **Depends on:** ADR-NNNN (status), other specs
- **Owner agents:** e.g. backend-engineer + frontend-engineer

## Scope
What this delivers, in behavioral terms.

## Out of scope
Explicit non-goals (pull from PRD §3/§11 where relevant).

## Behavior
User-visible flow, states (empty/loading/offline/error), Arabic copy needs, edge cases.

## Data
Entities touched, new fields, invariants (e.g. only status=live questions servable).

## Analytics
Events emitted (must map to PRD §8 P0 list).

## Acceptance criteria
Numbered, testable statements — qa-engineer builds tests from these.

## Risks / open questions
Anything needing Samuel's call, flagged explicitly.
```

## After writing
Mark the spec Draft until Samuel approves. Add it to "In progress" in `docs/PROJECT_STATE.md`.

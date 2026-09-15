## What and why

<!-- One paragraph. What changes for a student, a parent, or a founder reading a metric? -->

## The golden thread

Every change should be traceable from a requirement to a proof. Fill what applies;
strike what does not, and say why.

- **Requirement(s):** <!-- FR-xxx, or "none — explain" -->
- **Task(s):** <!-- Txxx from specs/001-student-mvp1-delta/tasks.md -->
- **ADR:** <!-- docs/decisions/NNNN-*.md if this changes architecture, or "none" -->
- **Proof it works:** <!-- the test, the query, the screenshot, the live run -->

## Checklist

- [ ] `cd app && npm test` passes, and new behaviour has a test that would fail without it
- [ ] `npx tsc --noEmit` clean
- [ ] `traceability.md` updated — a requirement that changed status says so, **with its proof**
- [ ] `tasks.md` ticked only for work actually done, with evidence in the line
- [ ] If content changed: `parity_check.py` GREEN (per-solution drift guard)
- [ ] If generated content ships: it is flagged unreviewed and sampled — no `reviewed_by` stamp asserting a review that did not happen (FR-1110)
- [ ] `docs/PROJECT_STATE.md` updated if this is a milestone or a decision

## Status honesty

- [ ] Nothing here is marked VERIFIED that I have not actually run
- [ ] Anything left broken or unfinished is named in the description, not left for someone to find

<!-- Branch discipline: work lands on its own solution branch. `main` is not to be touched (ADR-0010). -->

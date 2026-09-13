# WIP — one branch per solution (resume doc)

> **Purpose**: this file exists so the work can be picked up mid-flight after a
> quota cut, a new session, or a handover. It records the decision, the plan, and
> exactly which steps are done. **Update the checkboxes as you go.**
> Started 2026-09-13. Owner: Samuel (solution architect).

## The decision (Samuel, 2026-09-13)

**No more two environments inside one branch.** The comparison build and the
baseline are two *solutions*, not two deployment slots of one solution. Each gets
its own long-lived branch, kept in parallel indefinitely.

| Branch | Solution | State |
|---|---|---|
| `main` | shared trunk / to be retired | see open question Q1 |
| `family-tutor` | Founding Families — parent-sold, Arabic RTL, 3 subjects, Elo mastery | frozen baseline |
| `PDR1-0` | Student MVP — student-facing, English LTR, math only, BKT mastery | active development |

`PDR1-0` is the rename of `claude/tamer-shared-drive-access-ddpypu`.

**What this supersedes**: ADR-0007 framed the work as a *two-environment
comparison on one box* — two stacks, two hostnames, one branch pair, parity
enforced between two live databases. That framing is withdrawn. The phases built
on it (1, 3, and parts of 10 and 12) must be re-cut.

### Samuel's answers, verbatim intent
- Branch name for the active solution: **`PDR1-0`**
- Baseline: **both solutions get named branches** (not "baseline stays on main")
- Remote: **push the rename, delete or otherwise retire the old remote ref**, and
  produce a prompt for colleagues who already cloned the old name.

## Open questions for Samuel

- **Q1 — retire `main`?** `main` currently deploys to `ainext.reletix.com` via the
  CI branch→environment matrix. Deleting or repointing it is a production change.
  Recommendation: keep `main` in place as the trunk for now, create `family-tutor`
  from it, and retire `main` only once CI and the hostname are repointed. **Not
  done without an explicit go-ahead.**
- **Q2 — is `PDR1-0` the intended spelling?** If it was meant as `PRD1-0` (after
  the product requirements document), it is a one-command fix — but only cheap
  *before* colleagues re-point. Ask once, then leave it.

## Plan and status

- [x] S0 Record the decision and write this resume doc
- [x] S1 Reconcile `tasks.md` — **done 2026-09-13**. Ticked with evidence: `T043`
      (94/94 unreviewed, verified locally), `T073` (parity GREEN), `T107` (decided
      in ADR-0008 — Samuel reviews), `T121` (decided in ADR-0009 §1). Corrected
      stale numbers on `T104` (42 of 90, not 37) and `T111` (queue generated, 0 of
      5 reviewed). Verified still-open: parent view T055–T058, safety T063–T068,
      T090. Counts now **88 done / 47 open / 135 total**.
- [x] S2 **Done 2026-09-13.** Local rename, pushed `PDR1-0`, deleted
      `origin/claude/tamer-shared-drive-access-ddpypu` (both were at `544fe6e`;
      no open PRs). Required `gh auth switch --user samtoma` — the active gh
      account was `samuelflap`, which has read-only access. **That switch is
      still in effect on this machine.**
- [x] S3 **Done 2026-09-13.** `family-tutor` created from `origin/main` and
      pushed. `main` untouched, still the default branch. Remote now:
      `main`, `family-tutor`, `PDR1-0`.
- [x] S4 **Done.** `docs/decisions/0010-one-branch-per-solution.md`.
- [x] S5 **Done.** Phase 1 and Phase 3 re-cut in `tasks.md`; implementation-strategy
      section rewritten. New tasks T136 (re-point `mvp1` in CI/deploy), T137 (retire
      `main`? blocked on Samuel), T138 (re-specify or drop the side-by-side demo).
      **Still to check: Phase 10 and 12 wording for the same rot.**
- [x] S6 **Done 2026-09-13.** Full applicability sweep across every spec artifact:
      - `constitution.md` amended **v2.1.0 → v2.2.0** (Principle XI restated; Principle
        III's containment boundary renamed from "the comparison environment" to the
        non-production solution deployment; operational-safety and stack notes re-cut)
      - `spec.md` — User Story 7 re-cut, **scenario 3 withdrawn**, new scenario 4 on
        unpooled metrics; **FR-903, FR-904 and SC-001 amended**; terminology note added
        so the remaining "comparison environment" usages read correctly
      - `plan.md` — banner; Structure Decision and the P0/P3 phasing rows re-cut
      - `research.md` — banner; R5 and R7 headings marked no-longer-a-gate
      - `quickstart.md` — banner (**not walked** — `T070` still open)
      - `traceability.md` — §7 banner; FR-903 and FR-904 amended
      - `delta-matrix.md`, `data-model.md`, `contracts/analytics.md` — re-cut
      - `ADR-0007` — header now records that ADR-0010 amends its delivery model while
        every product-scope decision stands
      - `tasks.md` — Phase 10 re-cut, T062 and T071 updated, T070 annotated
- [x] S7 **Done.** `CLAUDE.md` topology table rewritten; `PROJECT_STATE.md` carries an
      ADR-0010 section at the top.
- [x] S8 **Done** — the re-point prompt was delivered in-session on 2026-09-13.
- [x] S10 **Done 2026-09-13 — ADR-0010 Clarification applied everywhere.** Samuel
      released cross-solution parity and ruled `main` out of bounds. Changed:
      ADR-0010 (Clarification section), constitution **v2.2.0 → v3.0.0** (Principle XI
      redefined as "Solution Integrity"), `spec.md` (FR-908 dropped, FR-904 + SC-001
      re-cut, US7 note), `tasks.md` (T059/T060 dropped, T137 answered *no*, T138
      answered *dropped*, T136 reframed to per-branch triggers, T018 reframed, Phase 10
      re-cut), `traceability.md` (FR-908 → DROPPED, FR-904 + FR-C05 re-worded, banner),
      `PROJECT_STATE.md`. Counts now **94 done / 44 open / 138**.
- [ ] S9 **Open**: `docs/README.md` was never updated with the new topology (part of
      `T071`). `T136` (CI/deploy still name `mvp1`), `T137` (retire `main`?) and
      `T138` (re-specify or drop the side-by-side demo) remain.

## Carried state — do not lose

- **Stash `stash@{0}`** holds Samuel's uncommitted `docs/PROJECT_STATE.md` edits
  (the ADR-0007 PRD-supersession section, ~34 lines) taken on `wip/hardening-5`
  before the sync on 2026-09-13. Not yet reapplied. Backup copies also in the
  session scratchpad under `presync-backup/`.
- **Two untracked files** in the working tree, Samuel's own work, not on any
  branch: `docs/decisions/0007-prd-supersession-student-mvp.md` and
  `docs/specs/gap-analysis-student-mvp-v0.5.md`.
- **ADR number collision**: the untracked `0007-prd-supersession-student-mvp.md`
  and the committed `0007-student-mvp1-comparison-build.md` are two different
  ADR-0007s. Renumber one before the new ADR takes 0010.

## Audit findings that must survive this refactor

From the 2026-09-13 verification pass — these are real and unfixed:

1. **Phase 7 is marked 8/8 but the feature is unreachable.** No task in the phase
   builds a UI; there is no file input anywhere in `app/src`.
2. **`T046` is broken**: `lib/uploads.ts:146` uses `/^UNREADABLE\b/i`, anchored to
   the start. A model reply that ends with UNREADABLE falls through to
   `status:"parsed"` and its commentary is stored as if it were the student's
   transcription. Proven live.
3. **`T048` is dead**: `api/ask/route.ts:152` calls `buildAskContext` with 5 of 6
   arguments; `uploadId` is never passed and that route is the only caller.
4. **Phase 11 (safety) is 0/6 and is a declared hard gate** — no real student
   until it closes. `T067` needs Samuel to name the escalation recipient.
5. **Task count**: 84 done / 135 total. `T069` is ticked with a lowercase `x`,
   which naive `grep "^- \[X\]"` counts miss.

## How to resume

```bash
cd "<repo>"
git branch --show-current        # expect PDR1-0 after S2
cat docs/WIP-branch-per-solution.md
```

Pick up at the first unchecked step above. Every step is independent enough to
stop after.

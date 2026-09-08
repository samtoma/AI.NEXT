# Scope Decisions — Student MVP 1.0 comparison build

**Status**: complete — all eleven questions answered by Samuel, 2026-09-08
**Feeds**: `spec.md` (re-cut against these), `../../docs/decisions/0007-student-mvp1-comparison-build.md`,
constitution v2.0.0

| # | Question | Samuel's answer | Consequence |
|---|---|---|---|
| 1 | What is this new version? | **A comparison experiment.** Build beside the existing PoC on a second URL, same math book. Current site stays frozen and alive; the go/no-go on the PRD comes after looking at both. | The second environment is a first-class deliverable, not a staging step. `ainext.reletix.com` must keep serving throughout. |
| 2 | What are we trying to find out? | **Does it teach better?** BKT + retrieval layer + reviewed misconception library, against today's Elo + grounded lessons. | Commercial scope is not what's being tested. Everything is judged by whether it serves this question. |
| 3 | How is "better" judged? | **Real students, the PRD's own metric** — the share of explain/summarise moments that convert into a completed practice attempt (PRD §12 "product thesis"). | Real (minor) students are involved. **Both** environments must emit this metric — the frozen baseline needs instrumentation added to it. |
| 4 | What differs between the two builds? | **The whole PRD experience** — teaching mechanics plus interface, ask-anything, uploads and dashboard. | Accepted trade-off: a metric difference cannot be attributed to a single cause. We are comparing products, not isolating variables. |
| 5 | How do pilot students get in? | **No auth.** A dropdown to pick an existing student plus a dead-simple "create new user". | Epic A (signup, verification, session handling, account-sharing deterrence) drops out. The existing demo-student picker is reused. Grade and interests are captured inside "create new user" because the student model needs them. **Identity is held constant across both environments, which makes the comparison cleaner.** |
| 6 | How far does the language change go? | **English UI, RTL kept working.** English LTR default; direction stays switchable, never hard-coded. | Math is already taught in English today, so this is chrome, navigation and copy. Arabic and Social Studies stay reintroducible. |
| 7 | What is in the first build? | **In:** uploads + OCR, student dashboard, parent view + alerts. **Out:** trial + payments. | Epic G deferred, which also defers the PRD §9 legal review blocking a paid cohort. |
| 8 | Who authors the refutation library? | **Pipeline-generated, human review skipped, ships directly.** "Let's make it also as a PoC, we don't have someone to review." | Suspends the review gate for generated explanation content in this environment. Raised once as a risk (a wrong refutation teaches the misconception it should correct, inside the very metric being measured); Samuel reaffirmed. Bounded by Q9. Every generated entry must be attributed, flagged unreviewed, and reversible. |
| 9 | Who can reach the new environment? | **Cloudflare Access, as today.** Invited emails only, one-time PIN. | The 10–20 pilot students and parents are added explicitly. Unreviewed content never reaches an uninvited person; access is revocable in one click. This is the containment that makes Q8 acceptable. |
| 10 | How is the constitution handled? | **Amend it.** "I want to proceed with this new PRD so go for it and update the principles." | Constitution rewritten to **v2.0.0** (MAJOR — principles redefined) rather than a time-boxed exemption. |
| 11 | Parent access mechanism? | **Same dropdown as students.** | Simplest possible and consistent with Q5. Accepted: any pilot parent can see any pilot student's data — acceptable only because the audience is 10–20 invited families behind Access. Must not survive into a public build. |
| 12 | Timeline? | **ASAP**, working continuously, using the agent team. | No fixed gate date. Sequence by what unblocks the comparison soonest; the second environment and the teaching mechanics lead, the rest follows immediately. |

## What this build is, in one paragraph

A second environment behind Cloudflare Access, serving the **same** Prep-3 Mathematics book as
`ainext.reletix.com` (10 modules, 90 LOs, 112 prerequisite edges, 450 questions, 212 visuals),
implementing the full PRD student experience — BKT mastery, a retrieval layer, a pipeline-generated
misconception/refutation library, English LTR chrome with direction kept switchable, ask-anything,
uploads with OCR, a per-topic student dashboard, and a parent view — reached through a simple
student picker with no authentication. No payments. Both environments emit the PRD's
comprehension-to-retrieval conversion metric, tagged by environment, and the comparison is judged on
that metric with real pilot students.

## Known risks accepted by these decisions

1. **Unreviewed generated teaching content reaches real students** (Q8). Bounded by Access (Q9) and
   the small invited cohort, but it is the single largest quality risk in the build, and it sits
   inside the metric being measured.
2. **The comparison cannot attribute a result to any one change** (Q4). Deliberate — we are comparing
   products, not isolating the algorithm.
3. **Any pilot parent can see any pilot student's data** (Q11). Acceptable at 10–20 invited families;
   must not survive into a public build.
4. **The "frozen" baseline is not entirely frozen** (Q3) — it needs the conversion metric
   instrumented before the comparison can start. That change must be metric-only and must not alter
   its teaching behaviour, or the baseline stops being a baseline.

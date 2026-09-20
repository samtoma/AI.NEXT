# Scope Decisions — Identity & Admin Console

**Status**: complete — all eleven questions answered by Samuel, 2026-09-20, in the identity &
admin-console brainstorm
**Feeds**: `spec.md` (cut against these), `traceability.md`, `constitution-amendment-proposal.md`,
`../../docs/decisions/0012-per-student-isolation-rls.md`, `0013-student-accounts-and-sign-in.md`,
`0014-admin-console-second-build-target.md`, `0015-interaction-timeline-and-replay.md`, and
`0016-analytics-and-monitoring-posture.md` — all five accepted 2026-09-20

| # | Question | Samuel's answer | Consequence |
|---|---|---|---|
| D1 | Who owns the account? | **The student, linkable to a parent.** The parent view is **not built now** — design it into the architecture and the requirements, marked deferred, and do not implement. | The picker is replaced by real accounts (FR-2001). The parent link exists in the data model and nothing fills it (FR-2901). The parent view and 001's FR-501 picker-based parent access are both withdrawn until a later release (FR-2902). Multi-child parent accounts stay a non-goal (constitution VIII). |
| D2 | How is one student's data kept from another's? | **Row-level security, database-enforced** — *"row level security indeed, same as reletix."* One database, policies on every student-scoped table, the app setting the current principal; a forgotten filter returns nothing, never another student's rows. | FR-2101…FR-2109. **A correction is recorded rather than repeated**: TalentReletix does not actually use database row-level security — it filters in application queries, and a cross-company leak had to be fixed by hand. Samuel's *intent* is the database-enforced version, which is stronger than what Talent has. ADR-0012 states this plainly. |
| D3 | How is the admin console packaged? | **One codebase, a second build target**, on its own hostname, behind Cloudflare Access *and* real accounts (defence in depth). **Local deploy must be trivial today and tomorrow**; the OCI deployment is a later step. | FR-2201, FR-2208, FR-2210. The console is its own release. Nothing in this workstream deploys it to the shared box. The build switch that shipped as FR-605 survives as a build-scope obligation and stops being described as protection. |
| D4 | What roles exist? | **Four**, per person, granted deliberately: `content-review` (the human gate — a safety control), `evidence-access` (extraction provenance), `student-data` (timeline, replay, student 360 — highest privilege), `cost-billing` (spend and budgets, reads no student content). | FR-2203…FR-2206. `content-review` is named as a safety control in the requirement itself (FR-2204), because it governs the exception constitution III depends on. `cost-billing` is explicitly denied student content (FR-2406). One authorisation point serves all four (FR-2106). |
| D5 | What must the admin see about cost? | **Each student's consumed cost** (AI and OCR/upload metered separately per constitution VI), over time, plus a **subscription/payment status per student**. There is no payment system yet — this is a status field and the hooks designed for it, so product cost can be estimated. | FR-2401…FR-2407. The status is a record, never a gate, and may not be described as a payment having happened. 001's billing requirements (FR-701…FR-707) stay deferred (FR-2904). |
| D6 | How is a student's interaction reviewed? | **Accepted as proposed**: one ordered per-student, per-session timeline merging tutor turns, attempts, widget renders, understanding checks, uploads and mastery moves; **read-only replay rendered with the same components the student saw**, labelled *reconstructed*; **a session identifier is added to the interaction ledger** (approved). Every admin read of a transcript is itself logged. | FR-2301…FR-2310. **Correction recorded**: there is no session to correlate against — the `sessions` table is dead schema, never written, and what the product calls a session today is a temporary string the browser supplies. So the first obligation is that a session exists at all (FR-2301); the plan owns the mechanics. |
| D7 | Is there a chat disclosure, and how much is kept? | **No disclosure at signup**; Samuel takes responsibility for disclosure. Do not add consent copy or a disclosure screen. **Full fidelity of the interaction is required, not minimum data** — for now. | FR-2307, FR-2308. Both are bounded exceptions to constitution VII, attributed and reversible — they revert when Samuel sets the disclosure text, or before any audience wider than the invited pilot. A retention decision is named as **owed** rather than invented. This is the main driver of `constitution-amendment-proposal.md`. |
| D8 | How is the product measured? | **Anonymous product analytics in the product too** — no student identifier, no content, no PII, event names and coarse properties only — *plus* the first-party event stream already required by FR-801/FR-901. Also a **state-of-the-art study** of monitoring and analytics per student and overall, per subject per year. | FR-2501…FR-2509. The first-party stream stays the record; the anonymous stream may never degrade the product when blocked (FR-2505) and may never carry a datum collected about a minor (FR-2506). The study informs the plan and ADR-0016; the spec states only the obligations. |
| D9 | How do students sign up and sign in? | **Same pattern as TalentReletix now**: email and password (Argon2id), email verification, a short-lived access token plus a rotating refresh token in HttpOnly cookies, session list and revoke, forgot/reset password, Google OAuth. **Phone + OTP is designed into the architecture now and implemented later.** | FR-2001…FR-2014, FR-2903. **Two departures recorded**, both fixing known gaps rather than mirroring them: Talent keeps its access token where page script can read it — AI.NEXT puts **both** credentials out of script's reach (FR-2007); and Talent has no lockout at all, with four named security events defined and never emitted — AI.NEXT requires throttling and lockout (FR-2011) and a test proving each event fires (FR-2501). |
| D10 | Does the tutor know who it is talking to? | **Collect gender at signup** and use it to adjust the tutor's language and interactions. | FR-2601…FR-2606, and a new collected datum about a minor, which is why VII needs amending. The finding behind it: the tutor assumes every student is a boy — **63** masculine pronouns in the lesson prompt (plus one `himself`), **21** in the ask prompt, **11** in the check-in prompt, including a masculine Arabic vocative offered to the model as the pattern to follow. *(001's traceability §9 item 11 says 23; the current count is 63. The higher figure is the one to cite.)* Gender governs address and voice only — never content, difficulty or selection, and never a third-party analytics tool. |
| D11 | How is the work run? | **Spec plus traceability plus `/speckit-plan` now.** Fable 5.1 orchestrates; Sonnet 5 agents do the work, Opus 5 for complex tasks. | This spec set is written before any code. No code is written in this workstream except registering the new spec with the traceability tool. Per `docs/BRANCHING.md` the `req/` branch merges before any `feat/` branch starts. |

Two things settled earlier that this workstream does not relitigate: **BKT stays as it is**
(feedback #17, closed), and **`/spine` stays a student surface** (FR-2206), not behind the console.

## What this build is, in one paragraph

Real student-owned accounts — email and password, Google as an alternative, email confirmation,
sessions a student can see and revoke, throttling and lockout — replacing the picker entirely, with
gender captured so the tutor stops addressing every student as a boy. Per-student isolation moves out
of remembered `WHERE` clauses and into the database, so a query with no student scope returns nothing
and a cross-student read answers as not-found; the two exposures that exist today, the operator
pipeline view's latest-turn read and the all-students roster, are closed by name. The operator
surfaces move into an admin console built from the same codebase as a second build target, on its own
hostname, behind Cloudflare Access *and* per-person accounts carrying four roles, with one
server-side authorisation point. The console shows each student's cost over time with AI and
upload/OCR separated, a subscription status with no payment system behind it, a single ordered
interaction timeline per session with read-only reconstructed replay, a record of every operator read
that the reader cannot remove, a security view of every sign-in attempt, and overviews per student,
per subject and per school year. The parent link is modelled and not built; phone and one-time-code
sign-in is designed for and not built; payment is not built. Both surfaces run locally from one
command.

## Known risks accepted by these decisions

1. **Full-fidelity transcripts of minors, with disclosure deferred** (D7). Every word a
   fourteen-year-old types is retained indefinitely and readable by an operator, and nothing at
   signup says so. Samuel has taken responsibility for the disclosure decision explicitly. It is
   bounded — it reverts when he sets the text or before any wider audience — but until then this is
   the largest privacy exposure in the product, and the retention policy that would bound it does not
   exist yet (FR-2307, and the constitution amendment's own follow-up).
2. **No rate limiter until one is built** (D9). Throttling and lockout are required at sign-in
   (FR-2011), but the rest of the product has no request limiting of any kind, and the pattern being
   mirrored has none either — its own architecture document lists that as a known gap. Cloudflare
   Access is the only thing in front of the pilot until this is addressed.
3. **Database-enforced isolation against a five-connection pool** (D2). Every data-access module in
   the app shares one bare connection pool with a maximum of five connections, and exactly one code
   path is transaction-scoped. Setting a principal per request means restructuring how nearly every
   module gets its connection, and three writes run detached from any request. The performance and
   correctness of that under load is unproven; the plan owns it and ADR-0012 acknowledges it.
4. **Anonymous analytics on a minors' product** (D8). Even with no identifier and no content, adding
   a third-party analytics tool to a product used by fourteen-year-olds is a deliberate widening of
   who observes them. It is bounded by FR-2504 and FR-2506 and it may never degrade the product when
   blocked (FR-2505), but the decision to have it at all is accepted here, not argued.
5. **Two surfaces, one database** (D3). The console and the student product read and write the same
   data with the same credentials. The isolation guarantee of D2 has to hold with an operator
   principal present, and an authorisation mistake in the console is a mistake against live student
   data, not against a copy.
6. **The console ships before it is deployed** (D3). Local-only is the requirement, which means the
   first time it meets the OCI box, Cloudflare Access and a real hostname is after this release. That
   is a deliberate sequencing choice and the deployment work is real work that is not in this scope.

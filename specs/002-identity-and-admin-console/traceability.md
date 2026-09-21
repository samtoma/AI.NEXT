# Traceability — Identity & Admin Console

**Status date**: 2026-09-20 (rev. 1) · **Branch**: `req/identity-and-admin-console`
**Authority**: [spec.md](./spec.md) · [decisions.md](./decisions.md) ·
constitution [v3.1.1](../../.specify/memory/constitution.md) ·
[ADR-0012](../../docs/decisions/0012-per-student-isolation-rls.md) (per-student isolation, database-enforced) ·
[ADR-0013](../../docs/decisions/0013-student-accounts-and-sign-in.md) (student-owned accounts, sign-in) ·
[ADR-0014](../../docs/decisions/0014-admin-console-second-build-target.md) (admin console, second build target) ·
[ADR-0015](../../docs/decisions/0015-interaction-timeline-and-replay.md) (interaction timeline, replay) ·
[ADR-0016](../../docs/decisions/0016-analytics-and-monitoring-posture.md) (analytics and monitoring
posture) — all five accepted 2026-09-20

> **This is the pre-implementation matrix.** Spec and traceability come before code on this
> workstream (D11); per `docs/BRANCHING.md`, the `req/` branch merges before any `feat/` branch
> starts, and no code lands here except the `scripts/traceability.py` registration that makes this
> file checkable. So every row below is **OPEN**, **DEFERRED** or **BLOCKED** by construction —
> there is no VERIFIED, BUILT or PARTIAL claim in this document that is not a named, deliberate
> exception, because claiming progress nobody has made is exactly the drift this tool exists to
> catch. The one exception is real and stated where it appears: three cost rows are **PARTIAL**
> because an existing file (`lib/cost-queries.ts`, shipped in `PDR1-0-v0.4.0`) already does part of
> this feature's work, for a different requirement, before this one was written. This document
> exists so the first `feat/` branch has rows to move — a place to write VERIFIED against, not a
> record of what already happened.

This document answers one question per row: **for this requirement, what code exists, and what
actually proves it works?** Deliberately harsher than the spec — a requirement whose code exists but
has never been executed is not "done" here. Today the honest answer for almost every row is "none
yet," and the row says so plainly rather than being omitted.

## Status vocabulary

| Status | Means |
|---|---|
| **VERIFIED** | Code exists **and** was executed in this environment — against a loaded database, a passing test, or a rendered page. |
| **BUILT** | Code exists and typechecks, but the thing that would prove it needs the box, the Claude runtime, or a browser session nobody has run. |
| **PARTIAL** | Some of the requirement is real; the rest is named in the Gap column. |
| **OPEN** | Not started. |
| **BLOCKED** | Cannot proceed here — the blocker is named. |
| **DEFERRED** | Out of scope by an explicit decision, with the decision cited. |

**Counting rule**: a requirement is counted once, at its weakest part. A row that is mostly built but
missing one piece is PARTIAL, not "BUILT with a note" — because the missing piece is the part that
was actually hard.

---

## 1. Accounts & sign-in — FR-2001…

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-2001 | One account per student; no way to become someone else | **OPEN** | — | — |
| FR-2002 | Signup captures email, password, name, grade, gender; interests optional | **OPEN** | — | — |
| FR-2003 | Password stored irreversibly; never in a log, event, or URL | **OPEN** | — | — |
| FR-2004 | Email confirmation required before learning; expiring link, resend offered | **OPEN** | — | — |
| FR-2005 | Email/password sign-in; failure never reveals which part was wrong | **OPEN** | — | — |
| FR-2006 | Google sign-in; one email resolves to one account, either way | **OPEN** | — | — |
| FR-2007 | Session credentials unreadable by page scripts, absent from any URL | **OPEN** | — | — |
| FR-2008 | Short-lived access credential; rotating, revocable, reuse-detecting refresh credential | **OPEN** | — | — |
| FR-2009 | Student sees and can end every active sign-in, per device | **OPEN** | — | — |
| FR-2010 | Self-service password reset; single-use, expiring, answer identical either way | **OPEN** | — | — |
| FR-2011 | Failed sign-ins throttle, then lock for a documented period | **OPEN** | — | — |
| FR-2012 | Student can sign out immediately, without waiting for expiry | **OPEN** | — | — |
| FR-2013 | Student can edit name, grade, gender, interests after signup | **OPEN** | — | — |
| FR-2014 | Picker-era demo students are claimed or retired; history retained | **OPEN** | — | — |

---

## 2. Isolation & authorisation — FR-2101…

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-2101 | Unscoped student-data access returns and changes nothing; fails closed | **OPEN** | — | — |
| FR-2102 | Every request establishes its acting student before touching data | **OPEN** | — | — |
| FR-2103 | Cross-student read answers not-found; write refused and logged | **OPEN** | — | — |
| FR-2104 | Close the two named cross-student exposures, covered by failing tests | **OPEN** | — | — |
| FR-2105 | Detached background work keeps the same student scope as its request | **OPEN** | — | — |
| FR-2106 | One server-side authorisation point serves every operator surface | **OPEN** | — | — |
| FR-2107 | Hiding a control is never authorisation, and never claimed as such | **OPEN** | — | — |
| FR-2108 | Cross-student reads are a named, role-gated, enumerated exception list | **OPEN** | — | — |
| FR-2109 | Every new record carries environment; no pooling, no cross-solution data | **OPEN** | — | — |

---

## 3. Admin console & roles — FR-2201…

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-2201 | Console addresses do not resolve at all in the student build | **OPEN** | — | — |
| FR-2202 | Reaching any operator surface needs a signed-in, role-holding account | **OPEN** | — | — |
| FR-2203 | Four roles — content-review, evidence-access, student-data, cost-billing — granted per person | **OPEN** | — | — |
| FR-2204 | content-review is a named safety control; its use is recorded | **OPEN** | — | — |
| FR-2205 | A student account can never hold a role or reach the console | **OPEN** | — | — |
| FR-2206 | `/spine` stays a student surface, never moves behind the console | **OPEN** | — | — |
| FR-2207 | Operator sign-in is recorded separately from student sign-in, with roles | **OPEN** | — | — |
| FR-2208 | Console stays behind Cloudflare Access in addition to operator accounts | **OPEN** | — | — |
| FR-2209 | Console is bound by the published design system, like every surface | **OPEN** | — | — |
| FR-2210 | Both surfaces run locally from one command; first account is repeatable | **OPEN** | — | — |
| FR-2211 | Every console figure carries its unit, period, and named identifiers | **OPEN** | — | — |

---

## 4. Interaction timeline & replay — FR-2301…

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-2301 | Every interaction belongs to a real, durable learning-session record | **OPEN** | — | — |
| FR-2302 | A session opens on start, closes on completion or inactivity | **OPEN** | — | — |
| FR-2303 | One ordered per-student, per-session timeline merges every interaction type | **OPEN** | — | — |
| FR-2304 | Read-only replay renders what the student saw, labelled reconstructed | **OPEN** | — | — |
| FR-2305 | A replay writes nothing at all to the student's record | **OPEN** | — | — |
| FR-2306 | Every operator read is logged; the log is unremovable by them | **OPEN** | — | — |
| FR-2307 | A retention decision (what's kept, how long, what's purged) is owed | **BLOCKED** | — | **Samuel** — the retention period is undecided (spec.md Open Decision 2). Full-fidelity storage itself is buildable now; the decision that bounds it is not, and it is owed before any audience wider than the invited pilot and the current operator roster. |
| FR-2308 | No disclosure copy added; reverts on Samuel's text or wider audience | **OPEN** | — | — |
| FR-2309 | An unattributable interaction is recorded as belonging to no session | **OPEN** | — | — |
| FR-2310 | Deleting an account removes the account and its record together | **OPEN** | — | — |

---

## 5. Cost & per-student status — FR-2401…

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-2401 | Per-student cost shown over time, not one window total | **PARTIAL** | `lib/cost-queries.ts`, `/admin/cost` (001, shipped `PDR1-0-v0.4.0`) | Only a 30-day single-window total exists today — no per-student **time series**, which is what this requirement actually asks for. |
| FR-2402 | AI spend and upload/OCR spend reported as separate figures | **PARTIAL** | `lib/cost-queries.ts` already groups by `surface_kind` (teaching vs upload) | The grouping exists, but two ledger defects (`research/analytics-state-of-the-art.md` §A0) sit underneath it: `ai_interactions.input_tokens` is written as input + cache_creation + cache_read (`api/ask/route.ts:446-447`), so the split over-counts; the sacred-guard redaction path writes literal zero cost/tokens (`:411`), so it under-reports on redacted turns. The two figures render but cannot be trusted apart. |
| FR-2403 | Overall period cost shown; per-student figures reconcile with it | **PARTIAL** | `lib/cost-queries.ts`, `/admin/cost` | Totals render today, but the same two ledger defects mean reconciliation is **unverifiable**, not merely unverified — fixing them is a precondition for this row, not a follow-on. |
| FR-2404 | Subscription/payment status per student; a record, never a gate | **OPEN** | — | No status field exists on `students` at all — this is new work, not a reporting gap. |
| FR-2405 | Changing status requires cost-billing role; every change is recorded | **OPEN** | — | — |
| FR-2406 | cost-billing role never grants access to any student content | **OPEN** | — | — |
| FR-2407 | Cost figures carry environment; never pooled across environments/solutions | **OPEN** | — | — |

---

## 6. Monitoring & analytics — FR-2501…

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-2501 | All 13 named security/sign-in events are actually emitted and tested | **OPEN** | — | — |
| FR-2502 | Security view shows sign-ins, failures, lockouts, denials within one minute | **OPEN** | — | — |
| FR-2503 | First-party event stream stays the sole record; every event tagged | **OPEN** | — | — |
| FR-2504 | Anonymous analytics may run alongside it, carrying no identifying data | **OPEN** | — | — |
| FR-2505 | Product never degrades when anonymous analytics is blocked or fails | **OPEN** | — | — |
| FR-2506 | No minor's-data datum ever reaches a third-party analytics tool | **OPEN** | — | — |
| FR-2507 | Console offers overviews per student, per subject, per school year | **OPEN** | — | — |
| FR-2508 | Safety flags still reach a human immediately, off the analytics path | **OPEN** | — | — |
| FR-2509 | Every new record and event carries its environment (constitution XI) | **OPEN** | — | — |

---

## 7. Tutor voice & gender — FR-2601…

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-2601 | Gender captured at signup; the product states what it is for | **OPEN** | — | — |
| FR-2602 | Tutor addresses the student correctly for gender, every surface, both languages | **OPEN** | — | — |
| FR-2603 | Gender affects address and voice only, never content or difficulty | **OPEN** | — | — |
| FR-2604 | Gender never sent to analytics, never in an event, log, or error | **OPEN** | — | — |
| FR-2605 | Unknown-gender students get a form correct for either, never masculine | **BLOCKED** | — | **Samuel** — the gender enumeration is undecided (spec.md Open Decision 1). The plan has designed the fallback rather than left it open: `research.md` R12 recommends `female \| male \| unspecified` and specifies the neutral register in English and Arabic, and plan A9 puts it in the shared address block. What is blocked is the confirmation of the option set — including whether declining is one of the options, which is the value this requirement's behaviour keys off. |
| FR-2606 | A gender change takes effect next turn, no sign-out needed | **OPEN** | — | — |

---

## 8. Deferred by design — architecture only — FR-2901…

| FR | Requirement | Status | Implementation | Proof |
|---|---|---|---|---|
| FR-2901 | A student account is linkable to one parent; data model only | **DEFERRED** | — | Decision **D1** (decisions.md) — the parent view is not built this release; only the link slot in the data model. |
| FR-2902 | Parent view not built; when built, performance data only, no transcripts | **DEFERRED** | — | Decision **D1** — withdrawn with the picker itself; carries 001's FR-501 scope forward to whenever it ships. |
| FR-2903 | Phone+OTP designed to fit the same session model; not built | **DEFERRED** | — | Decision **D9** — designed into the architecture now, implemented later. |
| FR-2904 | Payment not built; later work attaches to FR-2404's status field | **DEFERRED** | — | Decision **D5** — no payment system this release; 001's FR-701…707 stay deferred with it. |

---

## 9. Success criteria — SC-101…SC-114

| SC | Criterion | Status | Implementation | Proof |
|---|---|---|---|---|
| SC-101 | New student to first tutor message under 5 minutes, no intervention | **OPEN** | — | — |
| SC-102 | 100% of student-scoped reads covered by a CI-blocking automated check | **OPEN** | — | — |
| SC-103 | Zero cross-student rows reachable in a full red-team route pass | **OPEN** | — | — |
| SC-104 | Cross-student read indistinguishable from not-found in 100% of sampled attempts | **OPEN** | — | — |
| SC-105 | Every sign-in attempt visible in the security view within 60 seconds | **OPEN** | — | — |
| SC-106 | All 13 named events pass a test asserting they were emitted | **OPEN** | — | — |
| SC-107 | 100% of sessions after cutover reconstructable end to end | **OPEN** | — | — |
| SC-108 | 100% of operator reads have a matching read record, sampled | **OPEN** | — | — |
| SC-109 | Cost to date available for every student; reconciles with the total | **OPEN** | — | — |
| SC-110 | An operator reaches exactly their role's surfaces, refused everywhere else | **OPEN** | — | — |
| SC-111 | Both surfaces run locally from one command in under 10 minutes | **OPEN** | — | — |
| SC-112 | Tutor uses correct gender address in 100% of sampled turns | **OPEN** | — | — |
| SC-113 | Zero identifiers or personal data in the anonymous analytics stream | **OPEN** | — | — |
| SC-114 | Full student journey completes unchanged with anonymous analytics blocked | **OPEN** | — | — |

---

## 9b. What is unresolved, and who owns it

| # | Item | Owner | Why it matters |
|---|---|---|---|
| 1 | **The gender enumeration, and whether it can be skipped** (spec.md Open Decision 1) | **Samuel** | Blocks **FR-2605** outright, and shapes what FR-2002/FR-2601 actually capture. Also what the constitution VII amendment sanctions. |
| 2 | **The retention period for full-fidelity interaction records** (Open Decision 2) | **Samuel** | Blocks **FR-2307**. Owed before this data is opened to any audience wider than the invited pilot and the current operator roster — the constitution amendment carries the same follow-up. |
| 3 | **The disclosure text, its owner, and its date** (Open Decision 3) | **Samuel** | Bounds **FR-2308**'s exception. D7 stands as his decision; the exception reverts when he sets the text, or before a wider audience, whichever comes first. Neither exists yet. |
| 4 | **Who owns the anonymous-analytics measurement plan** — which questions it answers, which coarse properties it may carry (Open Decision 4) | **Undecided — explicitly "a product decision, not an engineering one,"** in Samuel's own words (decisions.md D8) | Informs ADR-0016 and shapes **FR-2504**, **FR-2507**. R2's posture (three layers, one system of record) is accepted; who curates the measurement plan going forward is not. |
| 5 | **Whether the first operator seeding uses Samuel's own email address** (Open Decision 5) | **Samuel** | ADR-0014's stated default says it does. Recorded because it is a production-credential decision he may want to make differently, not because the ADR itself is in doubt. Touches **FR-2210**. |
| 6 | **Constitution Principle VII amendment (v3.1.1 → v3.2.0) is drafted, not accepted** — `constitution-amendment-proposal.md` | **Samuel** | Nothing here presumes it has landed. **FR-2306, FR-2307, FR-2308** and **FR-2601…FR-2606** state obligations the amendment would sanction; until he approves it in the constitution itself, building them is ahead of its own governance. |
| 7 | **Egypt PDPL guardian-consent requirement collides with D7** — Decree 816/2025 treats a minor's data as sensitive in every case and requires written guardian consent for under-15s; grace period ends 2026-11-01, weeks after target launch (R2; spec.md **Open Decision 6**; plan A11) | **Not a decision — routed to Samuel** | D7 (no disclosure at signup) stands as his call; the conflict is recorded in the spec's Open Decisions (6) and in the constitution-amendment proposal's follow-ups. R2's recommendation: ship consent fields and hooks now (same pattern as FR-2404's status field) and obtain an Egyptian legal opinion before the pilot takes money. Bears on **FR-2307**, **FR-2308**, **FR-2901**. |
| 8 | **Two cost-ledger defects already live in production** (R2; `research/analytics-state-of-the-art.md` §A0): `ai_interactions.input_tokens` is written as input + cache_creation + cache_read (`api/ask/route.ts:446-447`), over-counting; the sacred-guard redaction path writes literal zero cost/tokens (`:411`), under-reporting on redacted turns | **Engineering** (ai-engineer / backend-engineer, scoped under FR-2401…FR-2403) | Named in the **FR-2401…FR-2403** rows above as the reason those rows are PARTIAL and not further along. Fixing both is a precondition for FR-2402/FR-2403 reaching VERIFIED, not a follow-on task. |
| 9 | **The application connects to Postgres as a superuser in both places it runs** — `POSTGRES_USER: ainext` in `deploy/docker-compose.mvp1.yml` and `$(whoami)` in `scripts/local-dev.sh` — and a superuser bypasses row-level security unconditionally (plan.md A3, research R6.3, ADR-0012) | **Engineering** (backend-engineer / devops-engineer, scoped under FR-2101…FR-2102) | Not a decision anyone owes — an engineering precondition that decides whether **FR-2101** is real. A non-superuser `ainext_app` role, `FORCE ROW LEVEL SECURITY`, and `DATABASE_URL` repointed in both compose files and in the `.env.local` the local script writes are load-bearing together; shipping the policies without the repoint produces a system that looks protected and refuses nothing. The isolation test (**SC-102**, **SC-103**) must therefore run **as `ainext_app`** — run as a superuser it passes for the wrong reason. |

---

## 10. Counts

<!-- GENERATED by scripts/traceability.py --write. Do not edit by hand:
     the next run overwrites it. Change the spec or the rows instead. -->

| | Count |
|---|---|
| Functional requirements | **70** |
| Success criteria | **14** |
| Traced (every one needs a row) | **84 / 84** |
| — verified | 0 |
| — built | 0 |
| — partial | 3 |
| — open | 75 |
| — blocked | 2 |
| — deferred | 4 |
| Requirements a test declares | **30** |
| Tasks complete / total | **0 / 0** |

**Of 0 requirements marked VERIFIED, 0 have an automated test declaring them.** The remaining 0 were verified by running the product — a browser session, a query against a loaded database — which is real evidence and is not re-checked on any later commit. That gap is the honest measure of this build's regression risk, and it is the number to drive down.

Counted from the artifacts by `scripts/traceability.py`, which fails CI when the spec, the matrix and the tests disagree. The hand-maintained table this replaced had drifted five requirements out of date, and an entire deferred block had no row at all.

The frozen baseline (`specs/000-baseline/`) defines 31 more requirements. It shipped and is not under change (ADR-0007), so it is reported by the tool but never gated — it has no matrix of its own yet.

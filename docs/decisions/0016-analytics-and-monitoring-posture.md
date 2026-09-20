# ADR-0016 — Analytics and monitoring: three layers, one system of record

**Status**: Accepted — Samuel, 2026-09-20, in the identity & admin-console brainstorm: *"GA in the product as well, anonymously fine for me"*
**Affects**: `app/src/lib/analytics.ts` · `app/src/app/layout.tsx` · `app/src/lib/cost-queries.ts` · `app/src/app/api/ask/route.ts` · `FR-2401…FR-2407` and `FR-2501…FR-2509` · constitution v3.1.0 Principles VI, VII and XI
**Depends on**: [ADR-0014](./0014-admin-console-second-build-target.md) (the console is the presentation layer) · [ADR-0015](./0015-interaction-timeline-and-replay.md) (replay, operator-read audit)

## Context

Samuel asked for two things in one breath: Google Analytics in the product —
*"just another visibility layer"* — and a study of the state of the art for
monitoring per student and an overall view per subject per year. D8 settled that
GA is in and that it is anonymous. What was left open is **how**, and that
matters more than it sounds: "anonymously" is either a configuration written
down in code or an intention nobody can check.

The constraints are already in force. Constitution v3.1.0 Principle VI requires
per-student spend instrumented from day one and binds no numeric ceiling until
PRD §10 sets a price. Principle VII limits what may be collected about a minor
at all. Principle XI requires environment attribution and forbids pooling
metrics across environments or solutions. `FR-801`/`FR-901` already put a
first-party event stream in place, and migration `009` built
`analytics_events` for it.

The closest comparable is worth stating: **Talent has no Google Analytics
anywhere** and built first-party `visitor-analytics` and `ux-analytics` instead
(`specs/002-identity-and-admin-console/research/talent-reletix-auth.md`). Not an
argument on its own — Talent serves recruiters, not fourteen-year-olds — but it
is the same founder reading both dashboards. The study behind this ADR is
`specs/002-identity-and-admin-console/research/analytics-state-of-the-art.md`.

## Options considered

**(a) GA4 as the primary product-analytics layer, with `user_id`.** The ordinary
install. Rejected: per-student and per-subject-per-year views need precisely the
identifiers we must not send, so it would turn every product question into a
transfer of a minor's behavioural profile to a third country — and it buries the
Principle XI separation inside a vendor's property settings.

**(b) Self-hosted product analytics — PostHog, Plausible, Umami, Matomo.**
PostHog's self-hosted build is documented by PostHog as being for hobbyists and
unsupported; Plausible wants ClickHouse; Matomo is heavier still. All four are
*web* analytics rather than learning analytics, and each adds a database engine
to a box already running Postgres 17, Next.js and the Claude CLI — to answer, at
200 students, what SQL already answers. Rejected.

**(c) First-party events only, no GA** — Talent's answer, and the one a privacy
officer would pick. It cannot see the visitor *before* there is an account:
referrer, device, and what share of arrivals become a first lesson. Rejected,
and D8 had already decided against it.

**(d) Three layers, each with exactly one job.** **Chosen.**

## Decision

**1. The first-party stream is the system of record.** Everything
student-identified, session-correlated or content-bearing lives in
`analytics_events` and nowhere else, and every number the console shows is
computed from it (FR-2503). It is extended, never replaced.

**2. GA4 is an audience-only layer, configured in code rather than in the GA
UI.** Consent signals are set *before* `config`, per surface: on public and
marketing pages `analytics_storage` is granted and the three advertising signals
are permanently denied; on authenticated student surfaces **all four are
denied** — no `_ga` cookie, no cross-page `client_id`; on the admin console GA
is **never loaded at all**. No `user_id` ever, no Google Ads link, no
advertising features, and **no Measurement Protocol**, which would need the
persistent `client_id` this posture exists to refuse. Only coarse events pass,
from an allow-list owned by **one wrapper module beside `app/src/lib/analytics.ts`**
— the only place permitted to touch `gtag`. The list's membership belongs to the
plan and `contracts/analytics.md`; what this ADR fixes is that there is exactly
one of it.

**3. The admin console is the presentation layer**, role-gated per ADR-0014,
with three views this release and no more: Student 360, a cohort overview, and a
subject/year heatmap of objectives against time. Cohort views key on **(subject,
grade, syllabus_version)** — `graph_edges.syllabus_version` is the curriculum
year and `students.grade` is the grade the book is written for, and conflating
them produces a number that means nothing — and bucket on **school-year weeks
anchored to the Egyptian school-year start**, never calendar weeks. Month-2
retention split across a January boundary reports two halves of the pilot's own
success metric.

**4. No Learning Record Store, no xAPI, no Caliper.** One system writes to one
Postgres that already holds a curriculum graph, a bitemporal mastery table and
an append-only attempts table built for exactly this. xAPI 2.0 (now IEEE
9274.1.1-2023) would add a second datastore, a vocabulary design exercise and
over 1,400 conformance tests, for portability nobody has asked for. **Revisit
trigger, named so it is not forgotten:** a ministry, school or LMS integration,
or a second organisation owning a subject.

**5. The `ai_interactions` ledger stays, and two defects in it are fixed.** Flat
columns for both cache counters, `cost_usd` and `latency_ms` per row are a real
advantage over Talent's `llm_logs`, which buries the same values in a JSONB
blob, aggregates them in a Python loop, and then never shows cost in its own LLM
tab (R1 §6). Keep it. But two honesty defects in ours are repo-verified:
`input_tokens` is written as input + cache_creation + cache_read
(`app/src/app/api/ask/route.ts:446-447`), so `/admin/cost` mislabels that column
and any price arithmetic over it over-counts; and the sacred-guard redaction
path writes literal zeros for tokens and cost (`:411`), so spend is
under-reported on exactly the turns most worth examining. FR-2401…FR-2403 cannot
be satisfied over a column that means something other than its name.

**6. Sign-in monitoring mirrors Talent's vocabulary, and every event actually
fires.** Talent defines seven security events and emits three; the other four
are dead, and there is no lockout anywhere to emit `account_locked` from (R1
§5). One vocabulary across both of Samuel's products is worth more than
improving on it, so the names are adopted, `cross_company_access_denied` becomes
`cross_student_access_denied`, and FR-2501 requires a test per event asserting
emission. That last event should be **structurally impossible** under ADR-0012 —
any occurrence is an attack or an application bug that RLS caught, which is why
it is the one alert with a zero threshold and why it doubles as the running
proof that the policies work.

**7. Replay is in-house and reconstructed; no DOM-recording tool, ever, on a
student surface.** ADR-0015 owns the mechanism; this ADR adds the boundary. A
DOM recorder streams a child's typed text — including the keystrokes before
submit, which we deliberately never store — to a third party. A "no" with no
revisit trigger.

**Four confirmations owed to Samuel**, recorded as owed rather than settled: (i)
cookieless GA on authenticated student surfaces — he may have meant an ordinary
GA install, and its price is a persistent `client_id` on a minor's device; (ii)
the retention numbers below; (iii) excluding `lo_id` from GA, which is curriculum
metadata rather than personal data and arguably fine to send; (iv) the PDPL
conflict below. **Owner: Samuel, before the console's release is cut.**

## Consequences

**The product must not degrade when GA is blocked** (FR-2505). An ad blocker, a
school proxy or a deleted script must cost nothing — no lesson, lesson step,
upload, dashboard or console view may depend on it. That is what "another
visibility layer" has to mean in practice.

**GA events carry no identifier, no content and no PII, and a test asserts the
allow-list.** The control is enforceable only because one module owns the call;
a second call site is the whole thing gone. FR-2504, FR-2506 and FR-2604 (gender)
all land on that one module.

**The retention numbers are proposals, not decisions.** R2 proposes uploads 90
days after parse, `analytics_events` 25 months, auth events 12 months, GA 14
months (GA's own maximum, not a choice), transcripts indefinite for the pilot per
D7. Nothing in this repo sets a precedent to fall back on. **Owner: Samuel;
decided before the pilot ends.** What ships now is the field and the hooks, so
setting a value later is configuration over a migration that already ran.

**The PDPL flag — a constraint on this whole posture, routed to Samuel, not
decided here.** Egypt's Law 151/2020 executive regulations (Decree 816/2025,
issued 2025-11-01) treat a child's data as sensitive in every case and require
**written guardian consent for under-15s**; the grace period ends
**2026-11-01** — weeks after target launch and inside the window the pilot's own
success metric is measured over. Our cohort is 14–15, so the stricter rule
governs. This collides with D7, which says there is no disclosure or consent at
signup. **D7 stands: it is Samuel's decision and this ADR does not reopen it.**
R2's recommendation passes through unchanged — ship the consent *fields and
hooks* now, the same way D5 handles payment status, and obtain an Egyptian
data-protection opinion before the pilot takes money. The conflict is recorded
in the spec's Open Decisions, in the constitution-amendment proposal and under
FR-2901. It should be a call, not a default.

**Two costs worth naming.** GA's in-product numbers at 200 students are
statistically useless, so the audience layer earns its keep on the public pages
and almost nowhere else. And the three views need a nightly rollup and a written
metric dictionary — at n=200 the gap between two defensible definitions of
"active" exceeds any effect the pilot could detect.

**What would trigger revisiting.** Item 4's integration trigger; LLM spend
approaching the roughly $30k/month crossover where a dedicated observability
platform starts to pay for itself; or counsel objecting to GA on student
surfaces at all — in which case the fallback is one flag rather than a redesign,
because each surface is configured separately in code.

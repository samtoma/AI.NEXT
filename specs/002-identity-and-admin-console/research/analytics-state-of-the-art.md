# Phase 0 Research — Monitoring & Analytics, State of the Art

**Feature**: `002-identity-and-admin-console` | **Date**: 2026-09-20 | **Status**: proposal
**Trigger**: Samuel, 2026-09-20 — *"GA is just another visibility layer, not sure how efficient is
it, I would ask you to study the state of art for monitoring and analytics per student and overall
view per subject per year, etc."* — then, deciding: *"for GA, I want it in the product as well,
anonymously fine for me."*

**GA-in-product is decided (D8).** Nothing below reopens it; what follows decides *how*, so that
"anonymously" is a configuration rather than an intention. Per Constitution Principle I every
decision here is a **proposal**. **Every URL was accessed 2026-09-20.** Sized for ~200 students / 50
families, one subject (Prep-3 Mathematics, 10 modules, 90 objectives), students aged 14–15
(**minors**), iPad Safari + desktop, Next.js 16 on one OCI box, Postgres 17, Claude CLI as the AI
runtime; where the state of the art assumes twenty thousand students and a data team, this document
declines it and says why. **Out of scope:** whether the tutor *teaches well* belongs to the teaching
evaluation harness (`docs/ROADMAP.md`); this owns **usage, mastery, cost, auth and access**.

---

## A0. Three defects found while grounding

Found during this study, not previously catalogued; all three belong in this feature's fix list.

1. **`attempts.session_id` is `BIGINT`; `analytics_events.session_id` and `uploads.session_id` are
   `TEXT`.** The D6 timeline merges all three, so the `session_id` added to `ai_interactions` must
   pick a type and the migration must reconcile the others, or the timeline joins on a cast.
2. **`ai_interactions.input_tokens` is written as `input + cache_creation + cache_read`**
   (`api/ask/route.ts:446-447`), so price arithmetic over it double- or triple-counts cached tokens
   — and `/admin/cost` labels that column "input tokens".
3. **The sacred-guard redaction path inserts literal zeros** for all four token counters and
   `cost_usd` (`api/ask/route.ts:411`). A redacted turn cost real money and is recorded as free, so
   spend is under-reported on exactly the turns we most want to examine.

Everything else is as `research/codebase-seams.md` describes: `analytics_events` (mig. `009`) with **16** event names
*(corrected 2026-09-20 by the consistency pass: this line originally said 17; the union in
`app/src/lib/analytics.ts` carries sixteen, and `contracts/analytics.md` is the count of record)* and a
6-event client allow-list; the `ai_interactions` ledger with full text, four token counters and
`cost_usd`; `/admin/cost` reading it 30 days at a time; `mastery` bitemporal with `score` = BKT
P(L); and `graph_edges.syllabus_version` + `students.grade` as the only year/grade axes that exist.

---

## A1. Product analytics for the in-product surfaces

**What the sources establish.** GA4 discards the IP — `anonymize_ip` does not exist there, IP
derives coarse geography at collection and is dropped before logging, and this cannot be weakened
([Google](https://support.google.com/analytics/answer/2763052?hl=en),
[Tag Gurus](https://www.taggurus.co.uk/blog/ip-anonymization-in-ga4-no-longer-necessary-in-2025));
IP truncation is the only behaviour on offer, not a setting to get right. PII is contractually
forbidden — the customer "will not … pass information, hashed or otherwise, to Google that Google
could use or recognize as personally identifiable information"
([GA ToS](https://marketingplatform.google.com/about/analytics/terms/us/)) — extended by Google to
URLs and query strings, custom dimensions, event category/action/label, User-ID overrides and
geolocation finer than ~1 sq mile
([PII guidance](https://support.google.com/analytics/answer/6366371?hl=en)). **From 15 June 2026
Google Signals no longer gates advertising data**: `ad_storage` / `ad_user_data` /
`ad_personalization` are the sole authority and Signals is reporting-only
([Usercentrics](https://usercentrics.com/knowledge-hub/google-signals-consent-mode-changes-2026/),
[Piwik PRO](https://piwik.pro/blog/google-is-changing-how-ga4-and-google-ads-share-data/)) — so
*"we turned Google Signals off" is no longer a privacy control.* GA4 also has **no cookieless
mode**: `client_storage:'none'` does not suppress the `_ga` cookies, but a
`gtag('consent','default',…)` denying `analytics_storage` **before** `config` does — no cookie, no
`client_id` persistence across page loads, unattributed pings
([Google](https://developers.google.com/tag-platform/security/guides/consent),
[Stape](https://stape.io/blog/google-consent-mode-v2)). Retention caps at **14 months** for
user-scoped data, and "reset on new activity" extends it on every return visit
([Usercentrics](https://usercentrics.com/guides/privacy-led-marketing/ga4-data-retention/)).

### Decision

**Three layers, each with exactly one job, and no fourth.**

**1. `analytics_events` (first-party Postgres) is the system of record.** Everything
student-identified, session-correlated or content-bearing lives here and nowhere else — extended
(A3, A4), never replaced. Every number in the admin console is computed from it.

**2. GA4 is the audience layer only** — how people reached us, on what devices, and what share of
arrivals become a first lesson. Configuration is fixed **in code**, not in the GA UI, per surface:

| Surface | GA4 | Consent defaults set *before* `config` |
|---|---|---|
| Public / marketing / landing | yes | `analytics_storage: granted`; `ad_storage`, `ad_user_data`, `ad_personalization` **denied, permanently** |
| Authenticated student (`/student`, `/dashboard`, `/spine`) | yes, **cookieless** | all four **denied** — no `_ga` cookie, no cross-page `client_id` |
| Admin console (`AINEXT_SURFACE=admin`) | **never** | — |

Non-negotiably: **no `user_id`, ever**; no Google Ads/AdSense link and no advertising features; no
Google Signals; **no Measurement Protocol** (it needs a `client_id` we would have to mint and
persist — the identifier this posture refuses); enhanced-measurement `page_view` **off**, replaced
by a manual send whose `page_location` has the query string stripped (`/student?lesson=…` would
otherwise hand Google a per-device curriculum path); retention **14 months, reset-on-activity OFF**;
two properties, `baseline` and `PDR1-0`, never pooled (Constitution XI).

**3. No self-hosted product-analytics server this release** — not PostHog, Matomo, Plausible, Umami.

**The GA event allow-list.** One wrapper module owns the `gtag` call; call sites never touch `gtag`
directly, exactly as `lib/analytics.ts` owns the first-party insert today. It accepts only
`session_started`, `session_ended`, `unit_started`, `unit_completed`, `lesson_step_viewed`,
`question_asked`, `explanation_delivered`, `retrieval_attempt_started`,
`retrieval_attempt_submitted`, `upload_submitted`, `dashboard_viewed`, with properties drawn only
from `surface`, `subject`, `grade`, `module_ordinal` (1–10), `environment`; everything else is
dropped with a console warning.

**Never to GA4, under any property name:** `student_id` or any account id, `session_id`, `lo_id`,
`question_id`, `attempt_id`, `is_correct`, any mastery value or band, any free text (prompt, answer,
OCR output, display name, interests) — and the events `student_created`, `student_selected`,
`parent_view_opened` and **`safety_flag_raised`**. The last is categorical: a signal that a child
may be distressed is not telemetry and does not leave this box. `lo_id` is excluded although it is
curriculum metadata, not personal data, because 90 objectives + timestamps + a persistent
`client_id` reconstructs one child's learning path inside Google's systems; `module_ordinal` keeps
the shape and loses the identification.

### Rationale

GA4 is good at the one thing the first-party table cannot do — it sees the visitor *before* there is
an account, across referrer and device — and bad at what Samuel asked for, because per-student and
per-subject-per-year views need precisely the identifiers we must not send. So the honest reading of
*"GA is just another visibility layer"* is: yes, and that layer is **acquisition, not learning**.
The cookieless split costs almost nothing (at 200 students the in-product GA numbers are
statistically useless anyway) and buys the strongest available answer to *what does Google hold
about a 14-year-old using your tutor*.

### Alternatives considered

- **GA4 as the primary product-analytics layer with `user_id`.** Rejected: it turns every product
  question into a transfer of a minor's behavioural profile to a third country (A2), and buries the
  Constitution XI separation inside a vendor's property settings.
- **Self-hosted product analytics.** PostHog's self-hosted build is explicitly "made for hobbyists",
  MIT, unsupported ([PostHog](https://posthog.com/docs/self-host/open-source/disclaimer)); Umami is
  Node + Postgres in ~512 MB, Plausible wants 2–4 GB for ClickHouse, Matomo is heaviest
  ([OpenPanel](https://openpanel.dev/articles/self-hosted-web-analytics)). All are *web* analytics,
  not learning analytics, and each adds a database engine to this box for pageview reports on 200
  students.
- **Server-side GA via Measurement Protocol**, making the allow-list unbypassable
  ([MP](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events)).
  Rejected: it requires the persistent `client_id` the posture refuses.

---

## A2. Regulatory constraints for minors' analytics

**Egypt's PDPL is now live and the clock is running.** Law No. 151/2020 sat without executive
regulations for five years; **Prime-Ministerial Decree No. 816 of 2025 issued them on 1 November
2025**, in force the next day, with a **one-year grace period ending 1 November 2026**
([Legal 500](https://www.legal500.com/developments/thought-leadership/overview-of-the-executive-regulations-of-the-egyptian-personal-data-protection-law/),
[Recording Law](https://www.recordinglaw.com/world-laws/world-data-privacy-laws/egypt-data-privacy-laws/)).
That is weeks after the pilot's target launch and inside the window its own success metric is
measured over — the most consequential finding in this document. The rest:

- **A child's data is sensitive data in every case**, whatever it contains
  ([DLA Piper](https://www.dlapiperdataprotection.com/?t=law&c=EG)). **Guardian consent:** under
  **15**, explicit **written** consent from the legal guardian before any collection or processing;
  **15–18**, guardian consent remains operative. Our cohort (14–15) straddles the line, so the
  stricter rule governs. A child's participation may not require personal data beyond what is
  strictly necessary for it (Recording Law) — Constitution VII with legal force.
- **Cross-border transfer needs a licence** from the Personal Data Protection Centre plus an
  adequacy assessment of the destination; electronic processing needs licences/permits with fees
  scaling by record volume (1–10,000 exempt); penalties reach EGP 5,000,000; and **a register is
  mandatory** — consent form/timing/scope, data categories, **retention periods**, security
  measures, structured for inspection (DLA Piper; Legal 500).
- **Reference points for "no profiling of children".** ICO AADC Standard 12 requires profiling **off
  by default** absent a compelling justified reason
  ([ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/12-profiling/));
  COPPA bars interest-based advertising to users known to be under 13 and makes the operator
  responsible for third-party analytics compliance
  ([Google](https://support.google.com/publisherpolicies/answer/10436800?hl=en),
  [FTC](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)).
  Neither binds us in Egypt; both are the conservative default and say the same thing: **no
  behavioural advertising, no profiling, no cross-device identity for children.**

**Where the sources are thin.** The regulation text is Arabic and the English accounts are law-firm
briefings that paraphrase rather than quote articles; the under-15 / 15–18 split is detailed by one
and rendered only as "guardian consent for children" by another, though the 1 Nov 2026 date is
consistent across all. Whether a 200-record pilot sits inside the licensing exemption is **not** a
conclusion to draw from secondary sources — that needs an Egyptian lawyer.

### Decision

**Nothing that identifies a student, describes a student's performance, or contains anything a
student wrote or photographed may leave this box — to GA or any third party.** Normative, and
enforced by the A1 wrapper:

| Must not go to GA4 | Because |
|---|---|
| `user_id`, `student_id`, account id, email, phone | PII under the GA ToS; identified child under PDPL |
| A persistent `client_id` on authenticated student surfaces | Re-identifiable behavioural profile of a minor; AADC Standard 12 |
| `is_correct`, mastery score or band, per-objective attempt counts | Performance data about an identified child — Constitution VII lets a *parent* see this, not a vendor |
| `lo_id`, `question_id`, lesson slug, query strings | Reconstructs the learning path per device |
| Any message, answer, OCR text, name or interest string | Content; grounds for A6's whole posture |
| `safety_flag_raised` | A distress signal is not telemetry |
| Any advertising signal granted, Ads link, Google Signals | No behavioural advertising for minors |

**Two obligations this feature must carry into the spec, both exceeding what D8 asks for:** a
**guardian-consent record** on the account (who consented, when, in what form, for what scope,
retrievable — a register entry, not a cookie-banner checkbox), and a **written retention period per
store** (A6), because the register requires one.

### Rationale

The decided posture is compatible with the above **only if** "anonymous" means A1's cookieless,
identifier-free, content-free configuration — not an ordinary marketing installation of GA4, and the
gap is invisible unless someone writes it down. **The conflict this section has to name:** D7 says
*no disclosure at signup; Samuel takes responsibility for disclosure* — and under the PDPL after
1 November 2026, guardian consent for a 14-year-old is a **written legal precondition to processing
at all**, not to analytics specifically but to the tutor existing. Recommendation: do not relitigate
D7; build the **fields and hooks** now (`guardian_consent_at`, `guardian_consent_form`,
`guardian_contact`) so turning disclosure on later is a copy change over a migration that has
already run — exactly how D5 handles payment status.

### Alternatives considered

- **Treat GDPR as the operative regime and ignore PDPL.** Rejected: students, families, payments and
  box are all Egyptian. GDPR stays useful as the conservative default where PDPL is silent.
- **Block GA on all student surfaces entirely.** The strictest option, and the one a privacy officer
  would pick. Not recommended — D8 decided GA in-product and cookieless lands close to the same
  place. Recorded so that if counsel objects the fallback is one flag, not a redesign.

---

## A3. Learning analytics — per-student and per-subject-per-year views

**What the state of the art measures.** The field's own self-criticism is the useful part: recent
systematic reviews find dashboards have been "about analytics and not learning", that plain
line/bar/progress visualisations are "limited in supporting student learning", and that what works
is **actionable, motivationally framed feedback with visible pacing cues**
([Ed & Info Tech](https://dl.acm.org/doi/10.1007/s10639-023-12401-4),
[Discover Education 2025](https://link.springer.com/article/10.1007/s44217-025-00964-y)). The
measure set is stable and small: knowledge state over time, time-on-task, attempts and accuracy per
objective, engagement/retention cohorts, help-seeking, session-length distribution, misconception
frequency — and **operator-facing** dashboards have a weaker evidence base than student-facing ones,
so treat the admin views as operational instruments, not as an intervention. On standards: xAPI 2.0
is now **IEEE 9274.1.1-2023** ([IEEE SA](https://standards.ieee.org/ieee/9274.1.1/7321/)), a
conformant LRS must pass **over 1,400 tests**
([Veracity](https://veracity.it/xapi_2_0_conformant_learning_record_store_lrs_veracity_learning)),
1EdTech says xAPI and Caliper are **not equivalent**
([1EdTech](https://www.imsglobal.org/initial-xapicaliper-comparison)), and adoption is thin — ~17%
of surveyed learning professionals had even experimented with it
([xAPI.com](https://xapi.com/blog/reflecting-on-10-years-of-xapi/)).

### Decision

**No Learning Record Store, no xAPI, no Caliper this release.** Three admin views over the existing
tables, plus one nightly rollup.

**What "per year" means here.** The repo carries two axes and they are not the same:
`graph_edges.syllabus_version` (`'2025-2026'`) is the **curriculum year**; `students.grade` is the
**grade the ministry book is written for**. Because the book is per grade, a "subject per year" view
is keyed on **(subject, grade, syllabus_version)**, and a **cohort** is the students in that triple
whose first session falls in that school year. Time buckets are **school-year weeks anchored to the
Egyptian school-year start (late September)**, never calendar weeks — otherwise "month-2 retention",
the pilot's own success metric, splits across a January boundary and reports two halves of a number.

**The minimum admin view set — three views, nothing else in v1.**

1. **Student 360** (one student; `student-data` role; **every open audited**, A6). Profile · BKT
   posterior trajectory per objective (`mastery` is already bitemporal — plot `score` by
   `system_from` and the trajectory is free) · attempts and accuracy per objective · time-on-task
   (`attempts.time_ms` *and* session wall-clock, as two numbers, never one blended one) · sessions ·
   help-seeking (questions per lesson, uploads) · misconception frequency · understanding-check
   outcomes · imputed cost to date (A4) · subscription status (D5) · safety flags (type and time
   only — the table deliberately holds nothing else) · last seen · link to the timeline.
2. **Cohort overview** (one `(subject, grade, syllabus_version)`). Activation (created → first
   completed lesson) · weekly-active by school-year week · **month-2 retention** as the pilot
   defines it · median and p90 session length · attempts and accuracy · median objectives at mastery
   threshold · cost per active student · the `SC-005` funnel **only once the harness has fixed its
   instrumentation** — `explanation_delivered` currently fires solely on refutations, so the ratio
   computable today is not a conversion rate and must not be displayed as one.
3. **Subject/year heatmap** (objectives × time). Rows = 90 objectives in syllabus order; columns =
   school-year weeks; cell = share of the cohort at or above the mastery threshold, with a
   **distinct rendering for "never reached"** as opposed to "reached and failing". That distinction
   is the point — it answers *is the curriculum being covered, and where does the cohort stall*.

**Supporting build:** nightly `student_day_rollup` and `cohort_day_rollup`, `environment`-tagged
(XI) — Student 360 computed live is four scans across `attempts`, `mastery`, `ai_interactions` and
`analytics_events`, and `mastery` needs an as-of predicate on every read. **Also required, and
cheaper than any of it: a written metric dictionary** — one definition each for active, session,
time-on-task, mastered, retained, activated, because at n=200 the difference between two defensible
definitions of "active" exceeds any effect the pilot could detect. **Not built:** predictive at-risk
scoring — no labels, no n, and it is the profiling AADC Standard 12 puts off by default.

### Rationale

An LRS is right when many systems write learning records and something must reconcile them. We have
one system writing to one Postgres, with a curriculum graph, a bitemporal mastery table and an
append-only attempts table designed for this. xAPI would add a second datastore, a vocabulary design
exercise, 1,400 conformance tests and a translation layer between our objective ids and someone's
activity IRIs — for portability nobody has asked for. The three views map to existing decisions:
Student 360 to D6/D5, the cohort view to the pilot success criteria, the heatmap to Samuel's "per
subject per year".

### Alternatives considered

- **xAPI 2.0 with a self-hosted LRS (Veracity / Learning Locker), or IMS Caliper 1.2.** Rejected as
  above; Caliper additionally has an LMS-shaped event model that fits a tutoring dialogue badly.
  **Revisit trigger, named so it is not forgotten:** a ministry, school or LMS integration, or a
  second organisation owning a subject.
- **Emit xAPI-shaped statements into `analytics_events.properties` now, without an LRS.** Rejected —
  half a standard is a second naming convention with none of the interoperability.
- **Buy a learning-analytics product.** Nothing is sized for 200 students, one subject and a bespoke
  curriculum graph, and all of them want the student data in their cloud.

---

## A4. LLM observability & cost

**What production LLM apps monitor per call**: model, input/output tokens, **cache-read and
cache-creation separately**, latency, finish reason, error, tool use, and increasingly refusal. The
OpenTelemetry GenAI conventions name these `gen_ai.request.model`, `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`, with content behind an opt-in
([registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)) — and they are
**still pre-stable**: as of v1.42.0 (12 June 2026) `gen_ai.*` moved to its own repository with no
1.0 ([semconv-genai](https://github.com/open-telemetry/semantic-conventions-genai)). Tooling splits
three ways — proxy logging (Helicone), span tracing (Langfuse, MIT core, self-hostable),
vendor-neutral OTel instrumentation (OpenLLMetry) — and published guidance puts the crossover to a
dedicated platform at roughly **$30k/month of LLM spend**
([particula](https://particula.tech/blog/helicone-vs-langfuse-vs-langsmith-llm-observability)).

### Decision

**Keep `ai_interactions` as the ledger. Add seven things. Adopt no observability platform.**

1. **`session_id` on `ai_interactions`** (approved, D6) — and reconcile the A0.1 type mismatch in
   the same migration. Without it: no per-session cost, no per-session latency, no timeline.
2. **An `outcome` column** — `ok | error | timeout | redacted | refused`. The CLI already returns
   `is_error`; today it drives control flow and is discarded. A refusal or timeout that burned
   tokens must appear as a cost line, not as a missing row.
3. **Fix the two honesty defects in A0**: store `input_tokens` as *uncached input only*, with the
   cache counters beside it as they already are; write real tokens and cost on the redaction path.
4. **Record the cost basis, not just the cost.** The runtime is the **Claude CLI on a
   subscription**, not an API key — Claude Code draws on the plan's usage allowance rather than
   per-token billing ([Claude pricing](https://claude.com/pricing)). The `total_cost_usd` the CLI
   reports, which `api/ask/route.ts:449` writes straight into `cost_usd`, is therefore an
   **imputation at published list price** — a good proxy for "what would this cost if we bought it",
   and **not** money that left a bank account. Add `price_basis` (e.g. `cli-list-price`) and
   `priced_at` per row so a change to Anthropic's list prices cannot silently rewrite the history
   the unit economics are computed from, and label every console figure **"imputed at list price"**,
   never "spent". When PRD §10 sets a price, this is the number it will be compared against.
5. **Per-day rollups** — `(environment, student_id, day, surface_kind) → turns, tokens, imputed
   cost, p50/p95 latency, errors`. Makes "cost over time per student" (D5) a query and gives an
   honest monthly figure; `/admin/cost` today derives a month from first/last-seen, which is fragile
   for a student who used the product twice.
6. **Budget thresholds with alerts, not ceilings.** Constitution VI binds no numeric ceiling until
   PRD §10 sets a price, and that stands. A configurable per-student-per-month and per-day
   **warning** that emails the founders and shows a banner costs nothing and is the difference
   between finding a runaway on the dashboard and finding it on the invoice.
7. **Name new columns after `gen_ai.*` where they correspond**, so a future export is a mapping
   table rather than a migration.

**No Langfuse, no Helicone, no OpenLLMetry this release.** Helicone is a proxy in front of a
provider API and there is no API here to sit in front of; Langfuse self-hosted brings ClickHouse,
Redis and blob storage onto a box already running Postgres 17, Next.js and the CLI, to trace a
single-step call whose full text we already store; OpenLLMetry's conventions are pre-stable.

### Rationale

The ledger already records more per call than most `gen_ai.*` spans do — full prompt and response
text and both cache counters — in the same database as the attempts and mastery it must be joined
against. The gap was never instrumentation; as `cost-queries.ts` says in its own header, nothing
*read* it. The cost-basis point is what will matter commercially: a figure labelled "cost" that is a
list-price imputation, computed from a column that triple-counts cache tokens, with redacted turns
recorded as free, is a plausible wrong number used to set a price — the precise failure
`cost-queries.ts` exists to prevent, reappearing one layer up.

### Alternatives considered

- **Self-host Langfuse.** The strongest alternative; revisit if the runtime moves to an API key with
  multi-step agents. Rejected now on cost of carry.
- **Emit OTel `gen_ai.*` spans to a collector on the box.** Rejected: pre-stable conventions, a new
  collector to operate, no backend chosen. Item 7 captures the future value for none of the cost.
- **Compute cost ourselves from tokens × a local price table.** Rejected as the *primary* figure —
  it duplicates the CLI's accounting including the parts we cannot see. Worth doing as a **monthly
  reconciliation check** (flag drift > 10% against the CLI's totals) — which would have caught the
  `input_tokens` defect.

---

## A5. Auth & security monitoring

**Baseline to mirror.** TalentReletix's `core/security_logger.py`: `failed_login`,
`successful_login`, `suspicious_activity`, `password_changed`, `account_locked`,
`permission_denied`, `cross_company_access_denied`; its `SECURITY_ARCHITECTURE.md` establishes
**cross-tenant reads return 404, not 403**, and records its own gaps — no rate limiter, refresh
rotation not fully enforced, permissive CORS default (`research/talent-reletix-auth.md`). **Standards.** OWASP ASVS 5.0 (May
2025) requires in V16 that **all authentication operations be logged, successful and unsuccessful,
with the factor or type used**; alerting is out of ASVS scope
([V16](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md)),
but OWASP Top 10:2025 renamed A09 to **"Security Logging and Alerting Failures"**
([A09:2025](https://owasp.org/Top10/2025/A09_2025-Security_Logging_and_Alerting_Failures/)).
Impossible-travel detection is a small build — geolocate the IP, Haversine distance, divide by
elapsed time, threshold ~1000 km/h, and **fail open**
([Ping Identity](https://www.pingidentity.com/en/resources/cybersecurity-fundamentals/detect-risk/impossible-travel-101.html)).

### Decision

**One `auth_events` table, Talent's vocabulary adopted verbatim plus additions, six dashboard tiles,
five alert rules, delivery by email and banner. No SIEM.** Mirrored verbatim: `failed_login`,
`successful_login`, `suspicious_activity`, `password_changed`, `account_locked`,
`permission_denied`. Renamed for our tenancy: **`cross_student_access_denied`**. Added:
`session_revoked`, `email_verification_sent` / `_succeeded`, `password_reset_requested` /
`_completed`, `oauth_login`, `role_granted` / `role_revoked`, and **`admin_transcript_viewed`** —
the D6 audit obligation is an auth event, not a separate mechanism. Columns: `environment` (XI),
actor, subject, event, outcome, reason, ip, user agent, `occurred_at`.

| Dashboard tile | Alert rule |
|---|---|
| Failed vs successful logins, 24h and 7d series | — |
| Accounts currently locked, with reason | ≥5 failed logins for one account in 15 min → **lock**, emit `account_locked` |
| Top source IPs by failed logins, last hour | ≥20 from one IP in 15 min → throttle that IP |
| Active sessions, and revocations in 7d | — |
| `permission_denied` by operator | ≥3 for one operator in 1h → email |
| **`cross_student_access_denied`** | **any occurrence → immediate email** |

Talent has no rate limiter and records it as a known gap; **do not mirror the gap.**
**Impossible-travel-lite: build it, run it in shadow** — >1000 km/h between successive
`successful_login` geolocations emits `suspicious_activity`, and for the pilot it **logs only**: no
block, no step-up, no email. With ~200 students in one country behind Egyptian mobile CGNAT the
expected signal is mostly carrier NAT and VPNs, and a false lockout of a 14-year-old the night
before an exam costs more than the attack it prevents. **`cross_student_access_denied` deserves its
own note:** with database-enforced RLS (D2) the database returns nothing rather than another
student's rows, so this event should be **structurally impossible** in normal operation. Any
occurrence is an attack or an application bug that RLS caught — which is why it is the one rule with
a zero threshold, and why it doubles as the running proof that D2 works.

### Rationale

Mirroring Talent's vocabulary is worth more than improving on it: Samuel reads both dashboards, and
two vocabularies for the same events is a cost paid at every glance. Where Talent has a documented
gap we close it rather than inherit it — the same posture as the RLS correction in D2. The
thresholds are deliberately crude: at 200 students the base rate of real attacks is low and a noisy
alert means every alert gets ignored, so rules sit where a human would want to look, and one sits at
zero because its base rate should be zero.

### Alternatives considered

- **Ship logs to a hosted SIEM / Datadog / Grafana Cloud.** Rejected: a monthly bill and a second
  place for minors' IP addresses to live, to serve six tiles over a table on the same box.
- **Reuse Talent's dual-Postgres split (business DB + logs DB).** Rejected at this scale: one
  database, one `auth_events` table, `environment`-tagged. Revisit if log volume competes for I/O.
- **Full impossible-travel with step-up MFA, or deferring auth monitoring until after the pilot.**
  Both rejected: no MFA exists and D9 makes phone+OTP architecture-only; and the events are free to
  emit at the moment the auth code is written.

---

## A6. Session / interaction replay for chat products

**What the state of the art does.** The mature LLM-product pattern is an **audit-ready log**: a
durable record preserving prompts, outputs, tool calls, timestamps, identity, policy decisions and
retrieval context, tamper-evident and retained under a stated rule
([NHI](https://nhimg.org/glossary/audit-ready-llm-log/)) — with the warning that logging turns
**without the session thread** misses the cumulative picture an investigation needs
([Cyberhaven](https://www.cyberhaven.com/blog/llm-access-controls-audit-logging)). That is D6's
`session_id` argument, arrived at independently. Session-replay *tooling* (LogRocket, PostHog,
Amplitude) is DOM recording: it captures the rendered page and input events, masks forms by default,
and the operational guidance is a whole programme — classify pages by sensitivity, exclude
high-risk paths, validate masking with synthetic data, document what stays visible to staff
([LogRocket](https://blog.logrocket.com/product-management/privacy-safe-session-replay-guide/),
[Amplitude](https://amplitudeauditor.com/blog/session-replay-masking-the-guide-nobody-wrote)).

### Decision

**Reconstructed replay, built in-house from stored records. No DOM-recording tool — not now, not
later, on any student surface.**

- **Source**: the D6 ordered merge — tutor turns (`ai_interactions` + new `session_id`), attempts,
  widget renders, understanding checks, uploads, mastery moves — read-only, with the same components
  the student saw.
- **Label every replay screen, persistently and visibly**: *"Reconstructed from stored records — not
  a recording of the student's screen."* Not a footnote. A re-render today can differ from
  September: prompts change, content is edited, widget components get new versions. Show each item's
  stored `occurred_at` and each tutor turn's recorded `model`.
- **Two-step access, and the second step is the audited one.** The session **list** shows metadata
  only — when, how long, which objectives, how many turns, cost, outcome. Opening a transcript is a
  deliberate action writing `admin_transcript_viewed(operator, student, session, at, reason)` (A5),
  which gives the audit a meaningful unit without hiding data from the role meant to have it. **Show
  the audit inside the console** — operators see who read whose transcripts, including their own.
- **`student-data` role only** — the highest privilege in D4, granted per person. `cost-billing`
  reads spend and never content; that separation is why four roles exist.
- **No redaction toggle in v1.** D7 requires full fidelity, and an operator-side mask on a surface
  whose purpose is reading what the student wrote is theatre. Redaction belongs at retention.

**Retention — the policy field ships now even though the value is "keep".**

| Store | Proposed `retention_class` | Note |
|---|---|---|
| `ai_interactions` (transcripts) | pilot: indefinite (D7); steady state **24 months** | The comparison and the harness both read history |
| `uploads` (photos of a child's work) | **90 days after parse**, keep `parsed_text` | Highest-risk store, easiest to cut: a photo may carry the child's name, school and handwriting |
| `analytics_events` | **25 months** | Two school years + margin, so year-on-year is possible once |
| `auth_events` | **12 months** | |
| GA4 | **14 months**, reset-on-activity OFF | Not a choice — GA's maximum for a standard property |

**What a later retention policy needs, so the hooks exist now**: a `retention_class` per store; an
`environment`-scoped deletion job (never cross-solution, XI); a per-student **export and erasure**
path, because PDPL gives data-subject rights a guardian will exercise; and a decided answer to what
erasure means for **`mastery`**, which is bitemporal and is the only record the pilot's learning
claims rest on. Recommendation: **erase transcripts and uploads, pseudonymise and keep aggregate
mastery/attempt rows.**

### Rationale

A DOM recorder on a minors' chat surface would stream the child's typed text — including keystrokes
before submit, which we deliberately never store — to a third party, and would then require the
masking-validation programme the vendors themselves describe. The reconstruction shows only what we
already hold: no new collection, no new processor, no new cross-border transfer. It loses only *how
the page looked*. The "reconstructed" label is not decoration: an operator who believes they are
watching a recording will read a changed prompt as evidence of what the tutor said in September.

### Alternatives considered

- **PostHog / LogRocket session replay.** Rejected as above — a "no" with **no revisit trigger** on
  student surfaces. Reconsiderable for the marketing site alone, where there is no minor.
- **Video-style playback at original pace.** Rejected for v1: cost without a decision it changes.
  The timeline already shows elapsed gaps, which is the signal — a 9-minute pause before an answer
  says something a playback would only re-enact.
- **Redact PII in transcripts at write time, or store nothing beyond the current turn.** Both
  rejected: they fight D7, a tutoring transcript's "PII" is inseparable from the teaching, and the
  harness needs transcripts as fixtures.

---

## A7. Recommendation summary for AI.NEXT

| # | Capability | Build / Buy / Defer | Why | Feeds |
|---|---|---|---|---|
| 1 | First-party `analytics_events` as system of record | **Build** (extend) | Exists, environment-tagged, joins to mastery and cost; the only layer that may hold identifiers | FR-2501 |
| 2 | GA4, anonymous, per-surface consent config in code | **Buy** (decided, D8) | Acquisition and device shape before an account exists — the one thing first-party cannot see | FR-2501 |
| 3 | GA event allow-list in one wrapper module | **Build** | Makes "anonymously" enforceable, not aspirational; mirrors the existing client allow-list | FR-2501 |
| 4 | Guardian-consent record + retention fields (hooks, no UI) | **Build** | PDPL grace ends 1 Nov 2026; D7 defers the disclosure, not the field | FR-2501, FR-2901 |
| 5 | Self-hosted product analytics (PostHog/Matomo/Plausible/Umami) | **Defer** | Adds a datastore to answer questions SQL already answers at n=200 | — |
| 6 | Student 360 view | **Build** | Samuel's "monitoring per student"; the console's reason to exist | FR-2501, FR-2301 |
| 7 | Cohort overview keyed (subject, grade, syllabus_version) | **Build** | The pilot's success metric is a cohort number | FR-2501 |
| 8 | Subject/year objectives × weeks heatmap | **Build** | Samuel's "per subject per year"; shows *never reached* vs *failing* | FR-2501 |
| 9 | Nightly `student_day_rollup` / `cohort_day_rollup` | **Build** | Makes the views queries not scans; `mastery` is bitemporal | FR-2501, FR-2401 |
| 10 | Metric dictionary (active, session, mastered, retained) | **Build** (write it) | At n=200 a definition difference exceeds any real effect | FR-2501 |
| 11 | xAPI / Caliper / LRS | **Defer** | One writer, one database; revisit on a school or ministry integration | — |
| 12 | Predictive at-risk scoring | **Do not build** | No labels, no n — and it is profiling of children | — |
| 13 | `session_id` on `ai_interactions` + type reconciliation | **Build, first** | Loses data daily; blocks timeline, per-session cost, replay | FR-2301 |
| 14 | `outcome` column; fix `input_tokens`; fix redacted-turn zeros | **Build** | Three live honesty defects in today's cost figures (A0) | FR-2401 |
| 15 | `price_basis` / `priced_at`; label figures "imputed at list price" | **Build** | The runtime is a subscription — cost is computed, not billed | FR-2401 |
| 16 | Per-day cost rollups + per-student budget **thresholds with alerts** | **Build** | Constitution VI bars a ceiling, not a warning | FR-2401 |
| 17 | Langfuse / Helicone / OpenLLMetry | **Defer** | 3 orders of magnitude below crossover; no provider API to proxy | — |
| 18 | `auth_events`, Talent's vocabulary + additions | **Build** | ASVS V16; one vocabulary across both of Samuel's products | FR-2501, FR-2101 |
| 19 | Six-tile auth dashboard + 5 alert rules, email + banner | **Build** | A09:2025 names alerting; three founders, no on-call | FR-2501 |
| 20 | Login rate limiting / lockout | **Build** | Talent's documented gap — do not inherit it | FR-2001 |
| 21 | Impossible-travel-lite, **shadow mode** | **Build (log only)** | Cheap at auth-write time; CGNAT makes blocking wrong here | FR-2501 |
| 22 | Reconstructed read-only replay: labelled, two-step, audited | **Build** | D6; no new processor, no new transfer | FR-2301 |
| 23 | DOM session-replay tooling on student surfaces | **Do not build** | Ships a minor's keystrokes to a third party | — |
| 24 | `retention_class` per store + erasure/export path | **Build (fields now)** | PDPL register requires stated retention; D7 sets today's value to "keep" | FR-2301, FR-2901 |

**The decided posture, in one paragraph.** `analytics_events` and the `ai_interactions` ledger are
the **system of record** — identified, content-bearing, environment-tagged, never leaving the box,
and the source of every number in the admin console. GA4 is the **audience layer** — no identifier,
no content, no advertising, cookieless on student surfaces, a hard allow-list, absent from the admin
console. The **admin console** is the presentation layer over the first, role-gated, with every read
of a student's transcript audited. GA tells us who arrived; the first-party stream tells us what
they learned; the ledger tells us what it cost. No layer does another layer's job — which is the
whole answer to *"GA is just another visibility layer."*

---

## Open for Samuel

1. **PDPL guardian consent vs D7.** The executive regulations require written guardian consent for
   under-15s and the grace period ends **1 November 2026**, weeks after launch. Recommendation: keep
   D7 this release, ship the consent **fields and hooks**, and get an Egyptian data-protection
   opinion before the pilot takes money. It should be a call, not a default.
2. **Cookieless GA on student surfaces.** Costs almost nothing at 200 students and is the strongest
   version of "anonymously". If comparable in-product GA funnels are wanted instead, the price is a
   persistent `client_id` on a minor's device — a trade to make explicitly, not by omission.
3. **The mastery-erasure rule.** Deleting a student's data on request destroys the only record the
   pilot's learning claims rest on. Recommendation: erase transcripts and uploads, pseudonymise and
   keep aggregate mastery. Decide before the first request, not during it.

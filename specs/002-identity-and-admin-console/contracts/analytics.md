# Contract: Analytics and security events

**Modules**: `app/src/lib/analytics.ts` (first-party, exists) · `app/src/lib/auth/events.ts` (new) ·
`app/src/lib/ga.ts` (new) · **Tables**: `analytics_events`, `auth_events`
**Extends**: [`specs/001-student-mvp1-delta/contracts/analytics.md`](../../001-student-mvp1-delta/contracts/analytics.md)
**ADR**: [0016](../../../docs/decisions/0016-analytics-and-monitoring-posture.md) — three layers, one
system of record · **Informed by**: `research/analytics-state-of-the-art.md` §A1, §A2, §A5 —
**cited, not re-derived**
**Enforces**: FR-2501…FR-2509, FR-2604, SC-106, SC-113, SC-114

## Three stores, three jobs, no overlap

| Store | Holds | Never holds |
|---|---|---|
| `analytics_events` | what the product did, student-identified, `environment`-tagged — **the system of record** (FR-2503) | authentication outcomes |
| `auth_events` | who tried to get in and what was refused — the security view's only source | product funnel steps |
| **GA4** | how people arrived and on what device — the **audience layer** | any identifier, any content, anything about a minor |

The same fact is never written to two of them. A sign-in is an `auth_events` row and not an
`analytics_events` row; an account being created is both, because "an account was created" is a
funnel step and "someone signed up from this IP" is a security fact, and they carry different columns.

## First-party product events

`lib/analytics.ts`'s union carries **16 names** today — verified in the file, and the count of
record. The research documents first said 14 (seams §6) and 17 (analytics study, intro); both were
corrected in place on 2026-09-20 with a note saying so. This feature adds **two**:

| Event | Fires when | Properties |
|---|---|---|
| `account_created` | signup succeeds, or a first Google sign-in creates an account | `method` (`password` \| `google`), `grade` |
| `email_verified` | a verification token is consumed successfully | `elapsed_ms` since signup |

Activation — the cohort view's first metric — is `account_created` → first `session_started` →
first `unit_completed`, which is why these two live here and not in `auth_events`.

**Changed**: `session_started` and `session_ended` stop being aspirational and fire from the session
lifecycle, carrying `session_ref`, `kind`, and (on end) `close_reason` and `duration_ms`
([sessions.md](./sessions.md)). Every emit carries the authenticated principal rather than a
picker-resolved id. **`student_selected` is retired with the picker** but stays in the type as
deprecated, because rows carrying it exist and a narrowed union would make them unreadable.

`emit()` keeps its two existing properties: `environment` is stamped server-side from configuration
and a client value is ignored; it never throws, because a dropped event costs a data point and a
thrown event costs a turn.

## Security events — the vocabulary

Talent's names adopted verbatim where they fit, renamed where our tenancy differs, extended where
Talent has a gap (research A5). **The thirteen FR-2501 requires**, each with a test asserting it
fires (SC-106 — 13 of 13):

| # | FR-2501 name | `auth_events.event` | Emitted from |
|---|---|---|---|
| 1 | sign-in succeeded | `successful_login` | `POST /api/auth/login`, Google callback |
| 2 | sign-in failed | `failed_login` | `POST /api/auth/login`, all three failure branches |
| 3 | account locked | `account_locked` | the throttle, on the fifth failure in 15 minutes |
| 4 | lockout cleared | `lockout_cleared` | expiry sweep, or an operator clearing it |
| 5 | password changed | `password_changed` | `POST /api/auth/reset-password` |
| 6 | password reset requested | `password_reset_requested` | `POST /api/auth/forgot-password` |
| 7 | email confirmation sent | `email_verification_sent` | signup, resend |
| 8 | email confirmation completed | `email_verification_succeeded` | `GET /api/auth/verify` |
| 9 | sign-in session revoked | `session_revoked` | logout, logout-all, the student's own list, reuse detection |
| 10 | permission denied | `permission_denied` | `authorize()`, every refusal |
| 11 | cross-student access denied | `cross_student_access_denied` | a blocked cross-student **write** |
| 12 | operator sign-in | `operator_login` | console sign-in, with the roles in effect |
| 13 | operator read of a student record | `admin_transcript_viewed` | every `operator_reads` write |

**Five more are emitted, not required**: `suspicious_activity` (refresh-token reuse; impossible-travel
in shadow mode), `oauth_login`, `role_granted`, `role_revoked`, `password_reset_completed`.

**Talent defines seven and emits three** (R1 §5): `suspicious_activity`, `password_changed`,
`account_locked` and `permission_denied` are dead code there, and there is no lockout logic anywhere
to emit the third from. That is the cautionary example FR-2501 was written against — **defining an
event is not emitting it**, so the test asserts emission, not existence.

**Impossible-travel-lite runs in shadow mode**: >1000 km/h between successive `successful_login`
geolocations emits `suspicious_activity` and does nothing else — no block, no step-up, no email. With
~200 students in one country behind Egyptian mobile CGNAT the expected signal is carrier NAT and
VPNs, and a false lockout of a fourteen-year-old the night before an exam costs more than the attack
it prevents (research A5).

**No password material in any event** — not the attempted password, not its length, not a hash of it.

## GA4 — the wrapper contract

```ts
/** The ONLY module that touches gtag. Call sites never do. */
export function track(event: GaEvent, props?: GaProps): void;

type GaEvent = "session_started" | "session_ended" | "unit_started" | "unit_completed"
  | "lesson_step_viewed" | "question_asked" | "explanation_delivered"
  | "retrieval_attempt_started" | "retrieval_attempt_submitted" | "upload_submitted"
  | "dashboard_viewed";                                  // eleven, and no twelfth

type GaProps = Partial<Record<"surface" | "subject" | "grade" | "module_ordinal" | "environment",
                              string | number>>;         // five, and no sixth
```

Anything outside either list is **dropped with a console warning**, not passed through — the same
shape `lib/analytics.ts` already has for its client allow-list. This is what makes "anonymously" a
configuration rather than an intention.

**Per-surface configuration, set in code before `config`** (research A1):

| Surface | GA4 | Consent defaults |
|---|---|---|
| Public / marketing | yes | `analytics_storage: granted`; the three advertising signals **permanently denied** |
| Authenticated student (`/student`, `/dashboard`, `/spine`) | yes, **cookieless** | all four **denied** — no `_ga` cookie, no cross-page `client_id` |
| Admin console (`AINEXT_SURFACE=admin`) | **never loaded** | — |

**Never sent, under any property name** (FR-2504, FR-2506, FR-2604, research A2): `student_id` or any
account id, `session_id`, `lo_id`, `question_id`, `attempt_id`, `is_correct`, any mastery value or
band, **gender**, email, display name, interests, any free text (prompt, answer, OCR output) — and
the events `student_created`, `student_selected`, `parent_view_opened` and **`safety_flag_raised`**.
The last is categorical: a signal that a child may be distressed is not telemetry and does not leave
this box.

Also fixed in code, not in the GA UI: no `user_id` ever, no Ads link, no advertising features, no
Google Signals, **no Measurement Protocol** (it needs the persistent `client_id` this posture
refuses), enhanced-measurement `page_view` **off** with a manual send whose query string is stripped,
retention 14 months with reset-on-activity off, two properties (`baseline`, `PDR1-0`) never pooled.

**The product must not degrade when GA is blocked** (FR-2505, SC-114). This is a design constraint,
not a hope: the script loads `async`, nothing awaits `track()`, nothing renders behind it, and no
lesson, lesson step, upload, dashboard or console view reads anything it returns. The test is a full
student journey with the domain blocked at the browser.

## Safety flags are not analytics

A safety flag reaches a human immediately on a path separate from this one, carrying flag type and
nothing more (FR-2508, 001 FR-602/FR-802). `safety_flags` holds no transcript and no excerpt by
design. Nothing in the console's new visibility changes that, and `safety_flag_raised` never reaches
GA4.

## Verification

- **SC-106**: 13 of 13 named events have a passing test asserting emission.
- **SC-105**: an attempt appears in the security view within 60 seconds.
- **SC-113**: zero student identifiers, content or personal data in the GA stream, verified by
  inspecting **every** event type the wrapper can send — eleven, which is why the list is short.
- **SC-114**: the full journey completes with GA blocked.
- **FR-2109 / FR-2509**: every row in both tables carries `environment`, and no view pools across
  environments or solutions.

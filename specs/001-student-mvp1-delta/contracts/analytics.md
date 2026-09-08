# Contract: Analytics Events (PRD §13)

**Module**: `app/src/lib/analytics.ts` · **Table**: `analytics_events`
**Emitted by**: both environments (FR-901, FR-908)

Every row carries `environment` (`baseline` | `mvp1`), stamped server-side from configuration.
**Metrics are never reported pooled across environments** (Principle XI).

| Event | Trigger | Properties |
|---|---|---|
| `student_created` | "create new user" completes | `grade`, `interests[]`, `skipped_interests` |
| `student_selected` | picker selection | — |
| `session_started` / `session_ended` | app open / timeout | `duration_seconds`, `platform` |
| `unit_started` / `unit_completed` | B1 | `unit_id` |
| `lesson_step_viewed` | B1 step advance | `step_id`, `unit_id` |
| `question_asked` | B3 | `mode` (`conceptual`\|`assignment_like`), `guardrail_triggered` |
| `explanation_delivered` | tutor serves a library entry | `lo_id`, `entry_type`, `misconception_id`, `reviewed` |
| `retrieval_attempt_started` / `retrieval_attempt_submitted` | practice attempt | `skill_id`, `correct`, `diagnosis_type` |
| `upload_submitted` | B10 | `file_type`, `parse_status` |
| `dashboard_viewed` | D1 | — |
| `parent_view_opened` | E1 | — |
| `safety_flag_raised` | F1 | `flag_type` **only** (FR-802) |
| `button_click` | any UI control | `button_id`, `screen` |

## Events deliberately absent

`user_signed_up`, `onboarding_completed`, `login`, `plans_page_viewed`, `trial_started`,
`trial_expired`, `payment_*`, `subscription_canceled` — Epics A and G are out of scope
(decisions.md Q5, Q7). `student_created` and `student_selected` replace the first three.

## The headline metric (SC-005)

> the share of comprehension interactions that convert into a completed retrieval attempt

**Numerator**: sessions containing an `explanation_delivered` or a `question_asked` with
`mode='conceptual'`, **followed within the same session** by a `retrieval_attempt_submitted`.
**Denominator**: sessions containing at least one such comprehension interaction.

Reported per `environment`, never pooled. Two properties make the comparison honest:
`explanation_delivered.reviewed` lets us see whether unreviewed content behaves differently from
reviewed content once any reviewed content exists, and the same-session window prevents a conversion
being credited to an interaction from a previous sitting.

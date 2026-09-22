# Contract: The admin console

**Build**: `AINEXT_SURFACE=admin` · **Routes**: `app/src/app/console/*.console.tsx`
**Read models**: `app/src/lib/{timeline,cost-queries,security-queries,overview-queries}.ts`
**ADRs**: [0014](../../../docs/decisions/0014-admin-console-second-build-target.md),
[0015](../../../docs/decisions/0015-interaction-timeline-and-replay.md)
**Enforces**: FR-2201…FR-2211, FR-2301…FR-2306, FR-2401…FR-2407, FR-2502, FR-2507, FR-2808…FR-2811

Every view below passes through `authorize()` ([authorization.md](./authorization.md)) and reads
through `ainext_operator`. No view computes a number from anything but the first-party stores
(FR-2503) — GA4 is never loaded on this build.

## Obligations on every view (FR-2211)

Stated once here rather than repeated per view. A console view is readable without reading code:

- every figure carries its **unit** and the **period** it covers;
- every identifier is shown **beside the name it belongs to**, never alone;
- **no column heading is a field name** — "Last signed in", not `last_login_at`;
- every cost figure says **"imputed at list price"**, never "spent" (research A4.4);
- every replay says **"Reconstructed from stored records"**, persistently and visibly (FR-2304);
- the visual language comes from the published Noor Play system: tokens never literals, every
  coloured background with its paired `on-` foreground (FR-2209, constitution XII). An internal tool
  may lag the system; it may not diverge from it on purpose.

## Views

### 1. Students — the list

**Roles**: `student-data` (full), `cost-billing` (a projection with **no content column**).
Name, grade, gender (or "not set"), account status, email-verified, subscription status, last seen,
sessions in the period, imputed cost in the period. Sortable and filterable; no bulk operations —
the console is for founders, not customer support (spec Assumptions).

### 2. Student 360

**Role**: `student-data`. **Opening it writes an `operator_reads` row** (`surface='student_360'`).

Profile · mastery by objective with its BKT trajectory (free: `mastery` is bitemporal — plot `score`
by `system_from`) · attempts and accuracy per objective · **time-on-task as two numbers**, summed
`attempts.time_ms` and session wall-clock, never blended · sessions · help-seeking (questions per
lesson, uploads) · misconception frequency · understanding-check outcomes · imputed cost to date ·
subscription status · safety flags (**type and time only** — the table deliberately holds nothing
else, FR-2508) · **her own feedback, in time order, notes printed in full** (FR-2809) ·
sign-in history · a link to the session list.

### 3. Session list

**Role**: `student-data`. **Metadata only, and that is the point** (research A6): when, how long,
kind, objectives touched, turns, attempts, imputed cost, close reason. Opening this list is *not* a
transcript read; it writes no `operator_reads` row, so the audit keeps a meaningful unit.

### 4. Session timeline

**Role**: `student-data`. **Opening writes `operator_reads`** (`surface='session_timeline'`) and
emits `admin_transcript_viewed`. Built by `lib/timeline.ts` — **a read model, not a table**: the
sources stay authoritative and nothing is copied for the timeline's convenience (ADR-0015 §2).

| Item | Source | Shown |
|---|---|---|
| Tutor turn | `ai_interactions` | user message, assistant message, model, tokens, imputed cost, latency, `outcome`, `renderer_version` |
| Answer / attempt | `attempts` | question, given answer, correct?, time, `modality` (question vs widget), misconception |
| Widget outcome | `attempts` where `modality='widget'` | the construction and the predicate it satisfied |
| Understanding check | `understanding_checks` | mode, score, verdict, gaps, next step |
| Upload | `uploads` | thumbnail, parse status, parsed text |
| Mastery movement | `mastery` | objective, prior → posterior, the evidence that moved it |
| Explanation | `explanation_log` **through its attempt** | grounded?, cached?, prompt version |

One time order, not several lists the reader merges by eye (FR-2303). **Elapsed gaps are rendered**:
a nine-minute pause before an answer is a signal a playback would only re-enact.

**`explanation_log` enters through the attempt or not at all** — it has no `student_id`, only a
nullable `attempt_id`, so an explanation with no attempt behind it is unreachable from a student's
timeline. Stated here so it is not later reported as a gap in the merge (§4e-1, ADR-0015).

### 5. Replay

**Role**: `student-data`. **Opening writes `operator_reads`** (`surface='session_replay'`).

Rendered with the same components the student saw, driven by the stored payload, labelled a
**reconstruction** wherever it appears (FR-2304). Each turn shows its stored `occurred_at`, its
recorded `model` and its `renderer_version`, so a replay that no longer matches what the student saw
can be recognised rather than believed.

**Read-only is a contract, not an intention** (FR-2305): replay opens no path that writes an attempt,
moves a mastery estimate, calls the AI runtime, or emits an event attributed to the student. The only
write it causes is the operator-read row, attributed to the operator. **No redaction toggle in v1** —
D7 requires full fidelity, and an operator-side mask on a surface whose purpose is reading what the
student wrote is theatre (research A6).

### 6. Cost

**Role**: `cost-billing`. Overall for a period, by surface, by `surface_kind`, **per student over
time** (`cost_daily` for closed days unioned with a live query for today), and per-student totals
that **reconcile with the period total** (FR-2403, SC-109). AI spend and upload/OCR spend are
**separate figures, never blended** (FR-2402). Subscription and payment status is readable and
settable here, with who changed it and when (FR-2405); it gates nothing (FR-2404).

Every figure is labelled **imputed at list price** and carries `price_basis`. A turn with
`outcome='redacted'`, `'error'` or `'timeout'` appears as a cost line, not as a missing row.

### 7. Security

**Role**: `student-data`. Six tiles over `auth_events`, per research A5, with an attempt visible
**within 60 seconds** of happening (FR-2502, SC-105):

| Tile | Alert rule |
|---|---|
| Failed vs successful sign-ins, 24h and 7d | — |
| Accounts currently locked, with reason | ≥5 failures for one account in 15 min → lock |
| Top source IPs by failed sign-ins, last hour | ≥20 from one IP in 15 min → throttle that IP |
| Active sessions, and revocations in 7d | — |
| `permission_denied` by operator | ≥3 for one operator in 1h → email |
| **`cross_student_access_denied`** | **any occurrence → immediate email** |

The last threshold is zero because under RLS the event should be structurally impossible: any
occurrence is an attack or a bug the database caught (research A5).

**The operator-read audit is shown inside this view** — operators see who read whose transcripts,
including their own. An audit nobody can see is an audit nobody checks.

### 8. Overviews

**Roles**: all four (they carry no individual content). Keyed `(subject, grade, syllabus_version)` on
school-year weeks anchored to the Egyptian school-year start (research A3, R13):

- **Cohort overview** — activation, weekly-active, month-2 retention as the pilot defines it, median
  and p90 session length, attempts and accuracy, median objectives at the mastery threshold, cost per
  active student. **The SC-005 funnel is not displayed** until `explanation_delivered` fires for more
  than refutations; the ratio computable today is not a conversion rate and must not look like one.
- **Subject/year heatmap** — 90 objectives × school-year weeks, cell = share of the cohort at or
  above the mastery threshold, with **"never reached" rendered distinctly from "reached and
  failing"**.
- **The metric dictionary** ships beside them: one written definition each for active, session,
  time-on-task, mastered, retained, activated. At n=200 the difference between two defensible
  definitions of "active" exceeds any effect the pilot could detect.

**No figure is pooled across environments or solutions** (FR-2407, FR-2109, constitution XI): every
query filters `environment` before it groups by anything.

### 9. Content review and evidence

`content-review` reaches the existing `/admin/content` review queue — the human gate the ADR-0007
exception depends on, now attached to a named person. `evidence-access` reaches `/pipeline`,
`/gallery` and `/dev/*`. **`/pipeline`'s cross-student read is deleted** in the same change that
re-homes it: reading extraction provenance needs no student's tutor turn on the page (FR-2104).

### 10. Feedback **[ADDED 2026-09-22]**

**Role**: `student-data`, **not** the overviews' all-four — and the contrast is the point. §8 is
permitted to every role *because* every cell in it is a count, a share, a duration or a curriculum
label. This view's content is the opposite: a named child's own free text. `cost-billing` reads no
student content (FR-2406) and `content-review` must not learn a student's name from a feature
(FR-2707).

**Nav group: Monitor**, beside Security and Overviews. Those three answer the same kind of question
— "what is happening across the pilot, and is any of it wrong?" — rather than "tell me about this
person" or "what may they see". Feedback is the only one carrying a human voice instead of a derived
number, which is the argument for putting it next to them rather than off on its own.

Up/down counts and their ratio over time, split by which of the three moments asked and by course ·
**the notes themselves, newest first, printed in full and never truncated**, each naming the student
and linking to the sitting it followed · the cadence rule in prose, so "why is there so little of
it" has an answer that is not a guess.

**It opens on the notes** (`notes=all` turns the counting view on, not the other way round), because
this page is the human path for a child's free text and a path that is optional at 6 p.m. on a Friday
is not a path. **Nothing classifies a note** — no keyword scan, no sentiment score, no `safety_flags`
row derived from one (FR-2811, migration 025) — and **nothing alerts**: this is a pull, and the
banner on the page says so rather than leaving an operator to assume otherwise.

**No `operator_reads` row**, for §3's reason applied to a cross-student list: the audit's unit is one
student's record, and a page showing forty would write forty rows and make the audit unreadable.
`/security` already makes the same call while showing student names.

**Nothing on it can change a note.** `ainext_operator` holds SELECT on `feedback` and nothing else
(FR-2810); removing one is a `ainext_maint` act a human decided to take.

## What the console does not have

No support ticketing, no bulk operations on students, no student impersonation, no "view as", no way
to edit a transcript, no way to delete an `operator_reads` row, **no way to edit or delete a piece of
student feedback** (FR-2810). Each absence is deliberate: the first two are a later feature (spec
Assumptions), the middle two would make an operator action indistinguishable from a student's (spec
edge cases), and the last three would make the record editable by the people it records — which is
the same sentence read twice, once about an operator's own reads and once about a child's words
about the product.

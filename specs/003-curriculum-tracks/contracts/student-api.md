# Contract: sign-up, the first-Google-sign-in step, and what the student surface can read

**Files**: `app/src/app/(auth)/signup/page.student.tsx`, `app/src/components/auth/SignupForm.tsx`,
`app/src/app/api/auth/signup/route.ts`, `app/src/lib/auth/google.ts`,
`app/src/app/api/auth/google/callback/route.ts`, new `app/src/app/(auth)/welcome/page.student.tsx`,
new `app/src/app/api/auth/onboarding/route.ts`, `app/src/lib/student-context.ts`,
`app/src/lib/auth/principal.ts` (`/api/auth/me`), `app/src/lib/ga.ts` (unchanged; a test only)
**Enforces**: FR-4003, FR-4005, FR-4008, FR-4014, FR-4016, FR-4017; carries 002 FR-2002, FR-2006,
FR-2015

## Sign-up page (server component) *(changed 2026-10-01, answer 36 — see decisions.md, supersedes
decision 1)*

The page computes `offered: Record<Grade, CurriculumId[]>` with `offeredCurricula` for every grade, and
passes it to the form **together with every curriculum in the registry** (`lib/curricula.ts`). The form
now always asks which curriculum, naming every curriculum it is given; `offered` is used only to flag,
with a short note, a curriculum that has nothing live for the chosen grade *(the orchestrator's default;
awaiting Samuel's confirmation of the note's wording)*. This is catalogue information, not student data.

## `POST /api/auth/signup` — one new required field

```jsonc
{ "email": "…", "password": "…", "displayName": "…", "grade": "10", "gender": "female",
  "interests": [], "curriculum": "us-american-en" }   // curriculum: required
```

| Case | Result |
|---|---|
| `curriculum` missing | `409 { "error": "curriculum_required", "offered": [every known id] }`; the account is not created |
| `curriculum` present and not a known id | `400 { "error": "invalid_curriculum" }` — same shape as `invalid_grade` |
| `curriculum` present and a known id | stored as `chosen`, whether or not FR-4004 says the grade offers it: a curriculum with nothing live for the grade is still a valid, selectable answer |

**Superseded by answer 36** (kept for the record): the three rows that made the field optional and
silently stored `implied` when the grade offered fewer than two curricula — a known curriculum the grade
no longer offered at submit time was resolved and recorded as `curriculum_resolved_from`. That race no
longer arises: every known curriculum is acceptable at sign-up regardless of what is live for the grade,
so `curriculum_resolved_from` is not written by this route any more.

The INSERT writes `curriculum_system` and `curriculum_source` (always `'chosen'` from this route now);
INSERT is `ainext_app`'s privilege already. The first-party event is `account_created`, with
`properties: { method: "password", grade, curriculum, curriculum_source }`. `?next=` handling is
unchanged (`safeNext`, FR-2015).

## The first-Google-sign-in step

**Callback.** When `GoogleUpsert.created` is true, the new row gets `onboarding_pending = true`, the
grade stays the placeholder today's code writes, and the redirect goes to `/welcome`. It does not go
to `next` or `/student`. A returning Google sign-in is unchanged.

**Pending means no lessons.** While `onboarding_pending` is true, every student page except
`/welcome` and sign-out redirects to `/welcome`, and every student API except `/api/auth/*` and
`/api/auth/onboarding` answers `403 { "error": "onboarding_pending" }`. The check reads the principal
(`/api/auth/me` gains `onboardingPending`), not a cookie.

**`/welcome`** is one screen. *(Changed 2026-10-01, answer 36.)* It asks for grade, and now **always**
asks for curriculum too, naming every curriculum in the registry; a curriculum `offeredCurricula` does
not list for the chosen grade is still shown and selectable, carrying the same "nothing to study here
yet" note as sign-up. It asks for nothing else (FR-4014). It uses the published design system (Play,
FR-4204).

### `POST /api/auth/onboarding`

```jsonc
{ "grade": "10", "curriculum": "us-american-en" }   // curriculum: always required
```

| Case | Result |
|---|---|
| not signed in | `401` |
| grade invalid or curriculum unknown | `400 invalid_grade` / `invalid_curriculum` |
| curriculum missing | `409 curriculum_required` *(changed 2026-10-01, answer 36 — no longer conditioned on whether the grade offers it)* |
| valid | calls `complete_student_onboarding(grade, curriculum)`, then `204`; the next request sees `onboardingPending: false` |
| **already completed** (the function raises) | **`409 { "error": "onboarding_already_completed" }`** — never a silent `204` (FR-4014, privacy review F10) |

The route resolves the curriculum with `resolveInitialCurriculum`, exactly as sign-up does, and
records `account_created`'s curriculum fields when the step completes. `ainext_app` cannot write
these columns any other way (FR-4017).

## What the student surface can read

`/api/auth/me` and `getStudentProfile` expose `curriculum`, `curriculumKnown` and
`onboardingPending`. They do **not** expose `curriculum_source` or the change history, which are
operator facts. No student surface shows a curriculum control (FR-4010).

## Anonymous analytics

- `ga.ts` is unchanged. `curriculum` is in neither `GA_EVENTS` nor `GA_PROPS`.
- `ga-curriculum-guard.test.mts` (new) fails if `"curriculum"` or any `curriculum_*` name enters
  either list. Its comment says why it is not the `lo_id` case: a curriculum is a proxy for something
  about the family (FR-4016, privacy review F4).
- Privacy review F5 (`grade=10` on anonymous events while grade 10 offers one curriculum) is **latent**:
  anonymous analytics is unconfigured. The plan assumes option (b), spec Open question 2.

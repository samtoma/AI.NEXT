# API Contracts — AI.Next Tutor PoC (As-Built)

**Date**: 2026-08-02 · All routes under `app/src/app/api/`, all `force-dynamic`.
Student identity for every route: validated demo cookie → `resolveStudentId()`
(fallback default student; never trusts the raw cookie value).

## POST `/api/ask` — grounded streaming chat (SSE)

The single AI endpoint for all chat surfaces.

**Request**
```jsonc
{
  "surface": "spine_chat" | "student_chat" | "lesson_learn" | "lesson_review",
  "chatSession": "string ≤64",          // grounding snapshot + cache key
  "messages": [ {"role": "user"|"assistant"|"note", "text": "…"} ],  // last 24 kept
  "questionId": "q:…",                   // optional (re-explanation flow)
  "wrongAnswer": "…",                    // optional
  "lesson": { "slug": "…", "mode": "learn"|"review" }   // lesson surfaces
}
```

**Response** — `text/event-stream`, `data:` JSON lines:
`{"type":"delta","t":"…"}` · `{"type":"done", …usage/cost}` · `{"type":"cap","text":"…"}` ·
`{"type":"error","message":"…"}`

**Server-enforced invariants**
- Turn caps per surface **per student**: student_chat 2, lesson_learn 14,
  lesson_review 5, spine_chat uncapped.
- Grounding assembled server-side only (`buildAskContext` / `buildLessonContext`),
  snapshotted per `chatSession` (3 h TTL) for prompt-cache byte-stability.
- **Sacred containment**: accumulated output scanned against the full sealed corpus;
  emission runs ≥96 chars behind; a ≥4-word LOOSE match kills the CLI child, emits a
  surface-appropriate redirect, and logs a redacted `ai_interactions` row.
- Every call logged to `ai_interactions` (tokens incl. cache cols, cost_usd, latency).
- Backend: local `claude` CLI (`claude-sonnet-5`, stream-json, 90 s timeout,
  thinking budget via `AINEXT_THINKING_BUDGET`).

## POST `/api/attempts` — deterministic grading + mastery

**Request** `{ "questionId": "q:…", "givenAnswer": "…", "timeMs": 1234? }`
**Response** `AttemptResult`:
```jsonc
{ "isCorrect": bool, "correctAnswer": "…", "solution": SolutionStep[],
  "loId": "lo:…", "loLabel": "…", "oldScore": 0.42, "newScore": 0.51 }
```
- Grading: numeric with 1e-6 tolerance, else case-insensitive trimmed compare.
  (Typed Arabic answers are graded client-side by `lib/irab.ts` today — tracked debt.)
- Transaction: insert `attempts` → close+insert bitemporal `mastery` (K = 0.15) →
  on wrong answers insert `explanation_log` from the canonical solution.
- Errors: 400 invalid body, 404 unknown/unservable question, 500.

## POST `/api/understanding` — end-of-lesson honest rating

**Request** `{ "mode": "learn"|"review", "chatSession": "…", "transcript": InMsg[] (last 60), "turns": n, "lesson": {…} }`
**Response** `{ "check": UnderstandingCheck, "costUsd": 0.0123 }` where check =
`{ id, mode, score 0–100, verdict got_it|nearly|needs_work, strengths[], gaps[], nextStep, turns }`
- CLI asked for STRICT JSON; one retry on invalid output; 502 when backend unavailable.
- Persists `understanding_checks` (+subject) and logs `ai_interactions`.

## GET `/api/visuals` — stored figure lookup

`?id=v:geo1-1:001` → `{ "visual": VisualRow }` · `?lo=lo:u1-1-2` → `{ "visuals": [...] }`
Serves `{{widget:viz_ref:…}}` and the whiteboard. 400/404/500.

## POST `/api/tts` — neural speech with disk cache

**Request** `{ "text": "≤1200 chars", "cacheKey"?: "advisory" }`
**Response** `audio/mpeg` + `X-TTS-Cache: HIT|MISS` (immutable cache headers) ·
`501 { "fallback": "webspeech" }` when no provider configured · 400/413.
Providers via env: openai | elevenlabs | webspeech | mock (`AINEXT_TTS_MOCK=1`).

## GET|POST `/api/demo-students` — demo roster (NOT auth)

`GET` → `{ "students": [{id, displayName, attempts, masteryRows, avgMastery}] }`
`POST { "name": "2–40 chars" }` → `201 { "id": n }` (grade pinned `prep-3`)
Every row is equally visible to whoever can open the Access-locked demo site.

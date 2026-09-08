# Contract: API Delta

**Baseline**: `specs/000-baseline/contracts/api.md`. Only additions and changes are listed.

## Changed

### `POST /api/attempts`

Unchanged request and response shape. Internally the Elo update is replaced by `bktUpdate`
(see `bkt.md`), and the attempt row additionally records `diagnosis_type`, `misconception_id`,
`stance_used` and `confidence`.

Response gains:

```jsonc
{
  "mastery": {
    "score": 0.38,            // P(L) after this attempt — same field name, same range
    "prior": 0.62,
    "misconceptionId": "misc:u1-4-1:sign-flip"   // null when none detected
  }
}
```

### `POST /api/ask` (SSE)

Grounding is composed by `lib/retrieval.ts` rather than assembled inline. Two additions:

- a **safety scan** on the inbound message; a `needs_immediate_review` classification writes a
  `safety_flags` row and dispatches out-of-band **before** the turn continues, while the streamed
  reply stays supportive in tone (PRD §8);
- an optional `uploadId` in the request body, whose parsed content the retrieval layer includes.

Turn caps, the sacred guard and cost logging are unchanged. The guard stays wired even though this
environment serves no sacred content — removing it would be a code change to a safety path for no
reason.

## New

### `POST /api/uploads`

`multipart/form-data`: `file` (JPEG/PNG/PDF, ≤ 10 MB), optional `sessionId`.

```jsonc
// 202 — accepted, parsing async
{ "uploadId": 41, "parseStatus": "pending" }
```

Errors: `413` too large · `415` unsupported type · `429` daily cap (10/student/day) reached.

### `GET /api/uploads/:id`

```jsonc
{ "uploadId": 41, "parseStatus": "parsed" | "pending" | "failed" | "unreadable",
  "linkedLoId": "lo:u1-4-1" }
```

`unreadable` is distinct from `failed` and drives different copy: unreadable asks the student to
retype or reshoot; failed offers a retry.

### `POST /api/analytics`

Client event sink. Server-side events are emitted directly via `lib/analytics.ts` and do not travel
through this route.

```jsonc
{ "event": "dashboard_viewed", "sessionId": "…", "properties": {} }
```

The server stamps `environment`, `student_id` and `occurred_at`. A client **cannot** set
`environment` — it is configuration, so a compromised or misconfigured client cannot pollute the
comparison.

### `GET /api/dashboard`

Per-topic mastery for the resolved student. Never returns a single blended figure (FR-401).

```jsonc
{ "topics": [ { "moduleId": "mod:u1", "label": "Factorisation",
                "mastery": 0.41, "attempted": 22, "weakestLo": "lo:u1-4-1" } ] }
```

### `GET /api/parent`

The same payload as `/api/dashboard` for the selected student, plus threshold alerts. Read-only —
there is no `POST`. Never includes transcripts (FR-501, FR-603).

```jsonc
{ "student": { "name": "Nour", "grade": 9 },
  "topics": [ /* as above */ ],
  "alerts": [ { "kind": "inactive", "days": 6 },
              { "kind": "struggling", "moduleId": "mod:u1" } ] }
```

## Cross-cutting

Every route emits its PRD §13 event through `lib/analytics.ts`. Every AI call writes
`ai_interactions` with `environment` and `surface_kind` — upload parsing is its own `surface_kind`
so image-token cost never hides inside the teaching figure.

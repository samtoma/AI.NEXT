# Data Model Delta — Student MVP 1.0

**Feature**: `001-student-mvp1-delta` | **Date**: 2026-09-08
**Migration**: `db/migrations/009-mvp1-bkt-library-analytics.sql`
**Applies to**: the comparison environment's database only, except where marked **[both]**

Baseline schema is `db/schema.sql` + migrations 002–008. This documents only the delta.

---

## 1. `mastery` — Elo score becomes a BKT belief

The table keeps its identity, its bitemporal row-closing semantics and its partial index. `score`
keeps its name and its 0..1 range, so every existing read path (`lib/ask.ts`, `lib/lesson.ts`,
`lib/mastery.ts` colouring) continues to work unchanged — it now reads P(Lₙ) instead of an Elo score.

```sql
ALTER TABLE mastery
  ADD COLUMN p_init    REAL NOT NULL DEFAULT 0.30,   -- P(L0)
  ADD COLUMN p_transit REAL NOT NULL DEFAULT 0.10,   -- P(T)
  ADD COLUMN p_guess   REAL NOT NULL DEFAULT 0.20,   -- P(G)
  ADD COLUMN p_slip    REAL NOT NULL DEFAULT 0.10,   -- P(S)
  ADD COLUMN evidence  JSONB;                        -- what moved this row
```

`evidence` shape (FR-301's "inspectable evidence trail"):

```json
{
  "attempt_id": 8123,
  "question_id": "q:u1-4-1:002",
  "observation": "incorrect",
  "prior": 0.62,
  "posterior": 0.31,
  "after_transit": 0.38,
  "misconception_id": "misc:u1-4-1:sign-flip",
  "confidence": 0.81
}
```

**Why keep one column rather than add `p_mastery`**: two columns holding "how well does this student
know this" would immediately diverge, and every read site would have to choose. One value, one
meaning, a changed update rule.

**Validation rules**
- `score` ∈ [0.02, 0.98] — the existing clamp is retained deliberately (research.md R1).
- All four parameters ∈ (0, 1); `p_guess + p_slip < 1` (else the update is degenerate).
- Exactly one row per (student, LO) with `system_to IS NULL` — unchanged invariant.
- A new row is written per observation; the previous row is closed. History is never mutated.

---

## 2. `misconceptions` — the diagnosable error

```sql
CREATE TABLE misconceptions (
  id            TEXT PRIMARY KEY,               -- misc:<lo>:<slug>
  lo_id         TEXT NOT NULL REFERENCES graph_nodes(id),
  label         TEXT NOT NULL,
  description   TEXT NOT NULL,                  -- what the student is doing wrong
  signal        TEXT,                           -- how it is recognised in an answer
  generated_by  TEXT NOT NULL,                  -- generator attribution
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_misconceptions_lo ON misconceptions(lo_id);
```

---

## 3. `explanation_library` — typed teaching content

```sql
CREATE TABLE explanation_library (
  id               TEXT PRIMARY KEY,
  lo_id            TEXT NOT NULL REFERENCES graph_nodes(id),
  misconception_id TEXT REFERENCES misconceptions(id),   -- NULL for non-refutation types
  entry_type       TEXT NOT NULL CHECK (entry_type IN
                     ('worked_example','faded','contrasting_case','refutation')),
  content          JSONB NOT NULL,                       -- typed steps, same shape discipline
                                                         -- as canonical_solution
  source_page      INT,                                  -- provenance, per Principle II
  generated_by     TEXT NOT NULL,
  reviewed         BOOLEAN NOT NULL DEFAULT FALSE,       -- Principle III suspension is visible here
  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_expl_lo_type ON explanation_library(lo_id, entry_type);
CREATE INDEX idx_expl_misconception ON explanation_library(misconception_id);
```

**`reviewed` is the whole governance story in one column.** It defaults FALSE, the loader sets it
FALSE for generated content, and `SELECT count(*) FROM explanation_library WHERE NOT reviewed` answers
"how much unreviewed teaching is live" at any moment — which is what SC-011 requires and what makes
the Principle III suspension reversible by policy rather than by a rewrite.

**Constraint**: `entry_type='refutation'` requires `misconception_id IS NOT NULL` — a refutation with
nothing to refute is a bug.

---

## 4. `students` — profile expansion

```sql
ALTER TABLE students
  ADD COLUMN interests        TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN interest_detail  JSONB,          -- {"sports":{"which":["football"],"mode":"play"}}
  ADD COLUMN language_pref    TEXT NOT NULL DEFAULT 'en'
                              CHECK (language_pref IN ('en','ar','franco')),
  ADD COLUMN curriculum_system TEXT NOT NULL DEFAULT 'eg-national-en';
```

Grade already exists. `interests` is an array of the five PRD categories plus `other`;
`interest_detail` carries the Sports/Music follow-up so FR-203 has a real signal to anchor to and is
never tempted to invent one. Empty array is valid and means "colder start", not "broken".

---

## 5. `attempts` — richer diagnosis

```sql
ALTER TABLE attempts
  ADD COLUMN diagnosis_type   TEXT,
  ADD COLUMN misconception_id TEXT REFERENCES misconceptions(id),
  ADD COLUMN stance_used      TEXT,
  ADD COLUMN confidence       REAL;           -- NULL or low is recorded honestly, per FR-307
```

`confidence` being nullable is deliberate: FR-307 and the PRD §8 low-confidence row both require that
uncertainty is *recorded*, not silently coerced into a number.

---

## 6. `analytics_events` — the measurement layer **[both]**

```sql
CREATE TABLE analytics_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment  TEXT NOT NULL,                  -- 'baseline' | 'mvp1'  (FR-901)
  event        TEXT NOT NULL,                  -- PRD §13 taxonomy
  student_id   BIGINT REFERENCES students(id),
  session_id   TEXT,
  properties   JSONB NOT NULL DEFAULT '{}',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_env_event_time ON analytics_events(environment, event, occurred_at);
CREATE INDEX idx_events_student ON analytics_events(student_id, occurred_at);
```

This is the **one table that also ships to the baseline** (FR-908), and the only change `main`
receives while frozen. `environment` is written from configuration, never inferred, so a misconfigured
stack produces obviously-wrong data rather than quietly pooled data.

**The headline metric (SC-005)** is computed here: comprehension events (`question_asked` with
`mode='conceptual'`, and explanation deliveries) paired against a subsequent
`retrieval_attempt_submitted` within the same session.

---

## 7. `safety_flags` — deliberately thin

```sql
CREATE TABLE safety_flags (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id   BIGINT NOT NULL REFERENCES students(id),
  flag_type    TEXT NOT NULL CHECK (flag_type IN ('misconception_gap','needs_immediate_review')),
  dispatched   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

No transcript, no excerpt, no detail — FR-802 and PRD §13 both say flag type and nothing more. The
content that triggered it stays where it already is; this table exists to prove a flag was raised and
whether it was dispatched, not to store what a distressed child wrote.

---

## 8. `uploads`

```sql
CREATE TABLE uploads (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id     BIGINT NOT NULL REFERENCES students(id),
  session_id     TEXT,
  file_type      TEXT NOT NULL,
  storage_path   TEXT NOT NULL,
  parse_status   TEXT NOT NULL CHECK (parse_status IN ('pending','parsed','failed','unreadable')),
  parsed_text    TEXT,
  linked_lo_id   TEXT REFERENCES graph_nodes(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`unreadable` is a distinct state from `failed` on purpose: FR-205 and PRD §8 require the product to
say plainly that it could not read something and ask the student to retype — which is different from
an upload that errored, and the two produce different user-facing copy.

---

## 9. `ai_interactions` — environment attribution **[both]**

```sql
ALTER TABLE ai_interactions
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'baseline',
  ADD COLUMN surface_kind TEXT;      -- distinguishes 'upload_parse' from chat surfaces
```

`surface_kind` exists so upload/OCR cost is separable from teaching cost from day one, per Principle
VI and research.md R2 — image tokens are materially more expensive and must not hide inside a blended
per-student figure.

---

## Entity relationships (delta only)

```
graph_nodes(learning_objective) 1─┬─* misconceptions
                                  └─* explanation_library
misconceptions 1─* explanation_library   (refutation entries)
misconceptions 1─* attempts              (diagnosis)
students 1─* mastery (bitemporal, one current row per LO)
students 1─* uploads, analytics_events, safety_flags
```

## What is deliberately absent

No `accounts`, `sessions_auth`, `subscriptions`, `payment_methods` or `parent_links` tables — Epic A
and Epic G are out of scope (decisions.md Q5, Q7), and the parent view rides the existing student
picker (Q11). Adding those tables "while we're here" would imply a product we decided not to build.

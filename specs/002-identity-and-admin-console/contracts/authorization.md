# Contract: Authorization

**Module**: `app/src/lib/auth/authorize.ts` — **the single seam** (FR-2106)
**Tables**: `operators`, `operator_roles`, `auth_events`, `operator_reads`
**Enforces**: FR-2103, FR-2106, FR-2107, FR-2108, FR-2201…FR-2205, FR-2406

## The seam

```ts
type Principal =
  | { kind: "student";  studentId: number; accountId: number; emailVerified: boolean }
  | { kind: "operator"; operatorId: number; roles: OperatorRole[] }
  | { kind: "anonymous" };

type OperatorRole =
  | "content-review" | "evidence-access" | "student-data" | "cost-billing"
  | "teaching-controls";   // added 2026-09-24, ADR-0021

/** Resolve the principal, check the requirement, record a denial. Throws or notFound()s. */
export async function authorize(req: Requirement): Promise<Principal>;
```

Every operator route handler and every console layout calls `authorize` and **nothing else performs
a role check** (FR-2106). A surface added later that forgets the call is caught by the matrix test
below, which enumerates routes from the build manifest rather than from a hand-maintained list.

`lib/auth/authorize.ts` also holds **the enumerated list of deliberately cross-student reads**
(FR-2108): a named entry per read, each with the role that permits it and the owner who asked for it.
A read that is not on the list has no `ainext_operator` policy behind it and returns nothing.

## Roles × surfaces

`✓` = permitted. Empty = refused by the seam, recorded as `permission_denied`, nothing returned — not
a preview, not a length, not a count (spec edge cases).

| Surface / action | `content-review` | `evidence-access` | `student-data` | `cost-billing` | `teaching-controls` |
|---|:--:|:--:|:--:|:--:|:--:|
| Console shell, own profile, own sessions | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/admin/content` — question & library review queue, approve/reject | ✓ | | | | |
| `/pipeline` — extraction provenance, coverage, evidence walk | | ✓ | | | |
| `/gallery`, `/dev/*` — widget and fixture harnesses | | ✓ | | | |
| Student list (names, grade, last seen, cost) | | | ✓ | ✓ | |
| Student 360 — profile, mastery, sessions, sign-in history | | | ✓ | | |
| Session list (metadata only: when, how long, turns, cost, close reason, release, probing) | | | ✓ | | |
| **Session transcript / timeline / replay** | | | ✓ | | |
| Uploads: a student's images and parsed text | | | ✓ | | |
| Cost: totals, per-surface, per-student, over time | | | | ✓ | |
| Subscription / payment status — read and change | | | | ✓ | |
| Security view — sign-ins, lockouts, denials | | | ✓ | | |
| Overviews — cohort, subject/year heatmap (no individual content) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/teaching` — read the teaching switch, its history, the test-account count (names need `student-data`); an operator holding **no** role is refused | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Move the teaching switch** (Socratic probing: off / test accounts / everyone) | | | | | ✓ |
| Mark or unmark a student as a test account (from the Student 360) — **`student-data` AND `teaching-controls` together**; neither alone | | | ✓ + | | + ✓ |
| Operator management — grant and revoke roles | | | | | |
| `operator_reads` audit — who read whose record | | | ✓ | | |

**`cost-billing` reads no student content** (FR-2406) — not a transcript, an upload, a message
preview, or a turn count of a conversation. It sees a cost figure and a name, which is what a
commercial question needs and no more. The one place the two roles meet is the student list, and the
`cost-billing` projection of it carries no content column.

**`content-review` is a safety control** (FR-2204, constitution III): it governs the human gate the
ADR-0007/0008 unreviewed-content exception depends on. Granting, revoking and exercising it are
recorded (`role_granted`, `role_revoked`, and the review action itself). It is never described in the
product as a content-management permission.

**`teaching-controls` is a safety control too** (ADR-0021, FR-3102): it decides how the tutor
answers a child who got a question wrong. It was specified under `content-review` and split out on
2026-09-24 so it can be narrowed on its own. Migration 029 granted it once to every active operator
then holding `content-review`; a later deploy never grants it again, and neither does withdrawing it
(`rollback/029`) and deploying again — 029's guard reads the `auth_events` trail too. The test-account mark it gives meaning to
needs **both** `student-data` (it names a person, and is set from the Student 360) **and**
`teaching-controls` (it decides which child the tutor tries an unfinished behaviour on) — the one
ALL-OF requirement in this matrix (`authorize({ roles: [...] })`; `allOf` on its route row). It was
`student-data` alone until the 2026-09-24 fix pass; every operator held every role that day.

**Operator management is in no row on purpose.** No role grants roles this release. The first
operator is seeded (ADR-0014, plan A5) and further grants are a deliberate operational act, because
a screen that hands out roles before anyone holds one is a screen that hands out roles to anyone.

**`/spine` is not in this table**: it is a student surface and does not move behind the console
(FR-2206, settled 2026-09-20).

## The three layers, and what each one is for

| Layer | Answers | Never asked to answer |
|---|---|---|
| **Build scope** (`AINEXT_SURFACE`) | does this route exist in this build? | who is asking |
| **Cloudflare Access** (FR-2208) | are you on the invite list? | which surfaces you may see |
| **Account + role** (this contract) | may *you* see *this*? | whether the route exists |

All three are required and none substitutes for another (ADR-0014). **Hiding a control, omitting a
link or not rendering a page is not authorisation and is never described as such** (FR-2107) — the
one sentence Talent's own architecture document gets right about its frontend (R1 §3).

## 404, not 403 — and where that rule stops

| Case | Answer | Recorded |
|---|---|---|
| Student A **reads** a record belonging to student B | exactly as a record that does not exist — `404`, same body, same timing | nothing (RLS simply returned no row) |
| Student A **writes** to a record belonging to student B | `403` | `cross_student_access_denied` — **alert threshold zero** |
| A student account reaches any console address | `404` on the student build (the route is absent); `403` on the console build | `permission_denied` |
| An operator reaches a surface their roles do not permit | `403` | `permission_denied` |
| An unauthenticated visitor reaches the console | `401` → sign-in; no console data renders first | — |

The asymmetry is Talent's, verified in its code and worth porting (R1 §3, `TEN-002`): a read path
bakes the scope into the query so "not yours" and "not there" are the same answer, while a write path
must distinguish them in order to refuse and record. Under RLS the read side is nearly free — the row
is not visible — and the write side still needs hand-written code to turn a blocked write into a
`403` rather than a database error.

**`cross_student_access_denied` should be structurally impossible** once RLS is on: the database
returns nothing rather than another student's rows. That is why its alert threshold is zero and why
it doubles as the running proof that isolation works (research A5).

## Tests this contract owes

1. **Role × surface matrix** — every combination in the table above, including every refusal
   (SC-110). Surfaces are enumerated from the build manifest, so a new console route with no
   `authorize` call fails the test rather than shipping open.
2. **Student-to-console** — a valid student session against every console address returns `404` on
   the student build and `403` on the console build, and each attempt is recorded (FR-2205).
3. **Cross-student read and write** — every student-facing route with a second student's identifiers:
   reads answer as not-found in 100% of attempts (SC-104), writes are refused and recorded.
4. **Unscoped read** — a query deliberately written without a `WHERE student_id` returns **zero**
   rows under `ainext_app` with no principal set (SC-102). A test that passes because the filter is
   present proves nothing about RLS (ADR-0012).
5. **Enumerated cross-student reads** — the list in `authorize.ts` matches the `ainext_operator`
   grants in the database, asserted by a query, so the two cannot drift.

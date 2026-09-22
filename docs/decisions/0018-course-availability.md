# ADR-0018 — Who may see which course, decided in the console

**Status**: Accepted — Samuel, 2026-09-21, asking to see the product as if all three subjects were available, with a toggle for what actually reaches students
**Affects**: `db/migrations/023-course-availability.sql` and `db/migrations/rollback/023-course-availability.down.sql` · `app/src/lib/catalog.ts`, `app/src/lib/catalog-queries.ts` · `app/src/app/(console)/courses/` · `app/src/app/api/console/courses/route.console.ts` · `app/src/app/api/console/students/[id]/courses/route.console.ts` · the reads in `app/src/lib/{lesson,queries,ask,subject-queries}.ts` and `app/src/app/api/attempts/route.ts` · `AINEXT_COURSE_GATING` in `app/src/lib/env.ts` · `scripts/course-gating.sh` · `FR-2701`…`FR-2710` in [`specs/002-identity-and-admin-console/spec.md`](../../specs/002-identity-and-admin-console/spec.md)
**Related**: [ADR-0012](./0012-per-student-isolation-rls.md) (the RLS idiom this copies) · [ADR-0014](./0014-admin-console-second-build-target.md) (the console this is managed from) · [ADR-0004](./0004-social-studies-vertical.md) and [ADR-0006](./0006-arabic-language-vertical.md) (the two courses this now holds back) · [ADR-0007](./0007-student-mvp1-comparison-build.md) (the review gate a half-loaded course would otherwise walk past)

## Context

Samuel asked to see the product as it will be sold — three subjects on the
screen, not one — with a switch deciding which of them a student actually
reaches, keyed to the year the student registered in, and with room for
subscription tiers later. Those are two opposite properties of the same list,
and until 2026-09-21 the product had no place to hold both.

**What decided visibility before this was the extraction pipeline.** A course
appeared to a student the moment its book was loaded into the spine, because
nothing existed that could say otherwise. That was invisible while maths was
the only book in the database; it stopped being invisible the day the console
grew a page listing all three subjects.

It stopped being theoretical at the same moment. Loading Arabic and Social
Studies (`62f780c`) put **279 Social Studies and 297 Arabic questions** into the
database at `status='review'`, held there by the review gate and, for the Quran
and hadith passages, by the named religious-content owner ADR-0006 requires. Any
rule that made "loaded" mean "visible" would have put half-reviewed content —
including scripture nobody had checked against a printed مصدر — in front of a
fourteen-year-old.

**Three leaks were found on the way, and none was reachable with one course
loaded.** `/api/attempts` graded any live question id and returned the correct
answer with the full canonical solution; `/spine` shipped every question across
every course with answers and solutions; `?mode=practice` served hidden stems.
All three become live the moment a second course exists. They are named here
because they are the argument for where the refusal has to live, not an
incident report.

## Options considered

1. **A `hidden` flag over an implicit default of visible.** The obvious shape,
   and wrong in the one direction that matters. The most likely state in the
   life of this table is "nobody has recorded anything about this course yet",
   so the missing row has to be the safe one. A book loaded by the pipeline at
   2 a.m. would otherwise be on a child's screen before a person decided it
   should be.
2. **Filter the lists the console and the student pages render.** Rejected:
   filtering a list is not access control. It leaves the underlying reads
   answering for every course, which is exactly how the three leaks above were
   reachable — none of them renders a course list at all.
3. **Key visibility to the subscription/payment status FR-2404 already
   records.** Rejected for this release. FR-2404 is explicit that the status is
   a record and never a gate, and `subscription-gate.test.mts` scans the student
   surfaces to keep it that way. Tying access to a commercial field would
   silently reverse a requirement that has a test behind it.
4. **A per-student allow-list only.** Rejected: Samuel manages years, not
   people. A rule he has to restate for every new student is a rule that stops
   being true the first busy week.
5. **A per-(course, grade) rule, plus a per-student exception, default-deny —
   chosen.** One lever for the decision he actually makes, one for the
   exceptions, and a default that is safe when nobody has made either.

## Decision

**A course is visible to a student only when a rule says so, and the console is
where that rule is written.**

The parameters, pinned:

- **Two levers.** `course_availability` carries a rule per **(course, grade)** —
  the broad decision, "Prep 3 sees maths". `student_course_access` carries an
  exception per **(student, course)**.
- **The exception wins, in both directions.** One test account can be shown a
  subject its whole year cannot reach, and one student can be held back from a
  course the year otherwise has, without inventing a per-student grade.
- **The default is hidden.** A course is visible only when a row says `live`.
  **No row means hidden.** Migration 023 therefore seeds maths for grade 9
  explicitly: the behaviour that was implicit before is now written down.
- **The gate is not the interface.** The refusal sits in the reads — the
  catalogue, the subject summaries, the lesson data, the spine, the practice
  plan and the ask data block. `getLessonData` returns null and the page answers
  **404** — the same answer a non-existent slug gets, so the 404 cannot be used
  to enumerate which courses exist but are switched off.
- **The rule is decided in a pure module.** `lib/catalog.ts` holds the
  arithmetic and has no database anywhere near it; `lib/catalog-queries.ts`
  fetches rows and applies it. A gate on what a child can reach has to be
  provable without a database, including the branches that are hard to reach in
  a running system.
- **Two roles, deliberately different.** A grade rule is `content-review` — a
  decision about a subject. One student's access is `student-data` — it names a
  person. The content role never learns a student's name through this feature.
- **Every change is recorded.** Both tables carry `updated_by` (an operator) and
  `updated_at`, plus a free-text note in the operator's own words, so "who
  turned this off and what for" is answerable months later.
- **The console lists every course the product recognises**, from the subject
  registry rather than from what the spine happens to hold, and each row states
  its real depth. That is what makes the full product visible while only maths
  has a book behind it. A cell nobody has set renders differently from one set
  to hidden, and turning an empty course live asks first and names the count.
- **`requires_plan` is a seam, not a feature.** The column exists so it does not
  have to be added under time pressure the day a price is set. It is always NULL
  and **nothing reads it**.

## Consequences

**Reversible, three ways, and they cost different amounts.**
`AINEXT_COURSE_GATING=off` suspends the gate and keeps every rule an operator
configured; the rollback migration drops both tables and returns the product to
"everything visible"; deleting the branch removes the code as well.
`scripts/course-gating.sh` drives the first two and deliberately refuses to do
the third.

**The gate's own default is the opposite of the row rule's, on purpose.** With
`AINEXT_COURSE_GATING` absent the gate is **off**. A row that is absent means
hidden; a *variable* that is absent means show everything. For a tutoring
product the safe failure is too much visible, never a paying student locked out
of her own course by a variable nobody set. Both defaults are documented where
they are implemented (`lib/env.ts`, migration 023's header) because an
asymmetry that is not written down reads as a bug.

**Default-deny is now the only thing between a half-reviewed course and a
student.** Arabic and Social Studies are loaded and live for grade 9 in the
local database; 297 Arabic and 279 Social Studies questions are held at `review`
by the sacred-content gate (ADR-0006) and by the review gate. `local-dev.sh`'s
promote step was narrowed to maths in the same work precisely so a local
convenience could not stamp `reviewed_by='local-dev'` on scripture nobody had
read — a false review assertion FR-1110 forbids. Two independent holds now stand
between that content and a child, and this ADR is one of them.

**There is a parallel here with ADR-0017, and it is worth naming.** Master ships
as a colour theme whose anatomy is unpublished, so ADR-0017 forbids onboarding a
Secondary cohort until it is published. Social Studies and Arabic ship as
courses whose question banks are largely unreviewed, so nothing but an operator's
deliberate `live` may put them in front of a student. In both cases the
mechanism is finished and the content behind it is not, and in both cases the
record has to say which.

**The two tables are not treated alike, and that is copied rather than
invented.** `course_availability` is a fact about the curriculum, so it follows
migration 017's content-table shape: read by both roles, written by the console
only, no row-level security. `student_course_access` is a per-child row, so it
gets ENABLE **and** FORCE row-level security and the same
`current_setting('app.student_id')` policy every student table in 017 carries.
`ainext_app` can read both and write neither — a student surface that could
write the allow-list is not gated by it.

**A confirmation step the surrounding browser can disable is not a confirmation
step.** The empty-course question was a `window.confirm` first, and Samuel's own
browser suppressed it: `confirm()` returned `false` to the page and the grid read
that as "the operator said no", so the control did nothing and said nothing about
why (`c510cf7`). The question is ordinary in-flow markup now, and no native
dialog remains in any student or console component.

**A per-student row is student data for row-level-security purposes and is not a
record of anything a child did.** Clearing an exception deletes the row, which is
safe here in a way it would not be on an audit table: the row is a live
permission, not history. The rollback file says the same thing — dropping these
two tables loses configuration and loses nothing a student produced.

**What would trigger revisiting.** Three things. A price being set: the moment
PRD §10 puts a real plan behind `requires_plan`, the seam stops being inert and
whether commercial status may gate access becomes a live question this ADR
answers "no" to only for now. A second dimension of visibility — per school,
per cohort, per term — which two levers cannot express and which would need a
rule engine rather than two tables. And the gate's default-off: if the product
is ever deployed where an unset variable is plausible, "too much visible" stops
being the safe failure and the asymmetry has to be re-argued rather than
inherited.

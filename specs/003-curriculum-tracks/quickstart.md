# Quickstart — 003 Curriculum Tracks

How to see the feature working locally, prove it, and take it to production. Written for someone who
has run `scripts/local-dev.sh` before. Commands run from the repository root. **Nothing here is built
yet**; this is the walk the build is held to.

## 1. Bring it up locally

```bash
./scripts/local-dev.sh --both          # student :3000, console :3002, one local database
```

- Migration 033 applies with the rest. Check it:
  ```bash
  psql "$DATABASE_URL_MAINT" -c "select has_column_privilege('ainext_app','students','curriculum_system','UPDATE')"
  ```
  The expected answer is `f`.
- Courses load **if absent**, one by one. The G10 course loads only when its bundles exist under
  `services/extraction/seed/g10-math/` **and** the source carries the scoped readers (the scope guard test).

## 2. Prove the rule without a database

```bash
cd app && npm test -- --test-name-pattern="catalog|scope|course-literal|curricula|ga-curriculum|curriculum-privilege"
```

This covers:
- the five-step rule, gate on and off;
- `offeredCurricula` and `resolveInitialCurriculum`;
- the tester who holds both maths courses, never interleaved;
- the GA exclusion;
- the privilege scan.

## 3. Walk it as a student

1. In the console (`:3002/courses`), under **American**, set Mathematics live for **Grade 10**. Under
   **National**, leave Prep-3 Mathematics hidden for grade 10 (FR-4211).
2. Sign up at `:3000/signup` with grade **10**. **No curriculum question appears**, because grade 10
   has live courses in one curriculum. The student is stored `us-american-en`, implied.
3. Open the lesson list, the skill map, the progress page and the home page, and ask the tutor
   something. Only the G10 course appears, and the tutor says "this book".
4. Paste a Prep-3 lesson address (`/student?lesson=u1-1`). The answer is **404**, identical to a
   lesson that does not exist.
5. To see the question: also set **Prep-3 Mathematics** live for grade 10 (a fixture; not the launch
   state). Sign up again at grade 10. The question appears with **National** and **American** and
   nothing pre-selected. Set the rule back afterwards.
6. As a **grade-9** student, nothing changes: sign up, open everything, compare with `v0.9.2`.

## 4. Walk it as an operator

1. Open Student 360 for the grade-10 student. It shows "Curriculum: American (us-american-en) ·
   implied". Change it to National. The page names what the student will stop and start seeing. After
   confirming, one history row appears.
2. As the student: the G10 course is gone and nothing else is live for grade 10, so the empty state
   shows. Change it back as the operator. The student's G10 mastery and lesson place are exactly as
   before (SC-209).
3. Try `POST /api/console/students/<id>/curriculum` as a `content-review`-only operator. The answer is
   403.
4. On `/courses`, hide the American course for grade 10. The page asks first: "1 student follows this
   curriculum in this grade and would have nothing to study". It shows no name.

## 5. The first Google sign-in

With a Google client configured (002 setup S1): sign in with a new Google account. You land on
`/welcome`, and no lesson opens until it is done. Submit grade 10. Then replay the same `POST
/api/auth/onboarding`. The answer is **409 `onboarding_already_completed`**.

## 5b. Parts of one section, and typed maths answers (rev. 2)

1. As a grade-10 test student, open **1.7 Factorisation**. The header reads "1.7 Factorisation · part
   1 of 3". Pass part 1. The next suggestion is "Continue Factorisation", which is part 2. Pass part 3
   through a direct link while part 2 is not passed: your place stays in 1.7 (FR-4313). The progress
   page reads "2 of 3 parts mastered" (FR-4314). The skill map shows the three parts as one group.
2. Answer a "factorise $x^2 - 9$" question with `(x-3)(x+3)`: correct. Answer with `x^2-9`: you are
   told the factorised form is asked (FR-4320). Type a decimal with a comma, and a coordinate pair as
   `(2; -1)`: each is marked by meaning.
3. As a grade-9 National student, repeat a lesson and a question. Nothing looks or marks differently.

## 6. Prove nothing else moved

```bash
cd app && npx tsx scripts/capture-prompts.mts --compare   # every existing prompt path byte-identical
cd app && npm test -- --test-name-pattern="answer-marker|book-sections"   # marker and grouping rules
./scripts/ci-migrations.sh all                             # fresh ×3, upgrade from v0.9.2, rollback onto it
python3 services/extraction/parity_check.py --course course:prep3-math-en   # 10/90/112/450/212
./scripts/traceability.py --check
```

## 7. Ingest the book (pipeline v2)

Follow `services/extraction/runbook/README.md`. It has one command per stage and the human gates
marked.
1. G0 manifest. *Passed 2026-09-25, 65 lessons.*
2. S0b, maths transcription, then G0b for its queue.
3. The Chapter 8 pilot through S11 on a **private scratch database**.
4. G1 per chapter.
5. Fan out.
6. G2 (three-way disagreements; items with no printed answer; a sample of EPUB solutions), G3, G4.
7. G5.
8. Promote per the ADR-0019 note.
9. `export_generated_content.py --course course:us-g10-math-en`.
10. Commit the exports, the run outputs and the cost ledger (`meter_run.py record` after each run).

## 8. Production (Samuel, or a founder with the runbook)

1. **Read-only checks first** (research Appendix A):
   - the gate variable (`gh variable get AINEXT_COURSE_GATING`);
   - today's grade-10 rules;
   - every student's curriculum and grade;
   - the courses loaded.
2. Deploy the release that carries the scoped readers and 033. A deploy loads no course.
3. **Actions → "Load a course"**, `course:us-g10-math-en`, mode **dry-run**. Read the delta.
4. The same with mode **load**, confirm = the course id. The run takes a verified backup and prints
   the rollback line. The post-flight shows every course's drift check **pass**, and **0** visibility
   rows for the course.
5. Console `/courses`: G10 live for grade 10; confirm Prep-3 maths is **not** live for grade 10.
6. Sign up a grade-10 test account on iPad Safari and walk section 3.

**Rollback**: hide the course in `/courses` first; that is enough for students. To remove its data,
run the restore line the load printed.

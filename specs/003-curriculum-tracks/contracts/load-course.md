# Contract: the "Load a course" action, `refresh-content` on noor, and the local path

**Files**: new `.github/workflows/load-course.yml`, new `deploy/load-course.sh`;
`.github/workflows/refresh-content.yml`, `deploy/refresh-content.sh`; `scripts/local-dev.sh`;
`.github/workflows/ci-cd.yml` (the first-boot and misconception steps); `deploy/DEPLOY-MVP1.md`
**Decision**: 17 · **ADR**: [0024](../../../docs/decisions/0024-curriculum-as-a-visibility-dimension.md) ·
**Enforces**: FR-4202, FR-4207…FR-4210; constitution X · **Privacy review**: F13–F17

## `load-course.yml`

```yaml
on:
  workflow_dispatch:
    inputs:
      course:  { description: "Course node id, e.g. course:us-g10-math-en", required: true }
      mode:    { type: choice, options: [dry-run, load], default: dry-run }
      confirm: { description: "load mode: retype the course id", default: "" }
concurrency: { group: deploy-oci, cancel-in-progress: false }   # never beside a deploy or refresh
jobs:
  load:
    runs-on: [self-hosted, oci]
    env:
      APP_DIR: /opt/reletix/AI.NEXT-mvp1     # noor's stack — NOT the frozen baseline's
      DB_NAME: ainext_mvp1
      COURSE: ${{ inputs.course }}           # passed as env, never interpolated into a script body
      MODE: ${{ inputs.mode }}
      CONFIRM: ${{ inputs.confirm }}
```

- **Manual only.** There is no `push:` trigger. It runs on the self-hosted runner and needs no new
  secret, because it uses the loader's existing database role (privacy review F16).
- **Input checks run before the box is touched**:
  - `COURSE` must match `^course:[a-z0-9-]+$` and be in `COURSES`, read from the checked-out
    `app/src/lib/courses.ts` through a small `node` print;
  - in `load` mode, `CONFIRM` must equal `COURSE`;
  - dispatching from a ref other than `main` warns, as `refresh-content` does.

## `deploy/load-course.sh <course-id> <dry-run|load>` — the steps, in order

1. **Presence, by this course's own id** (privacy review F14):
   `SELECT 1 FROM graph_nodes WHERE id = $COURSE AND kind = 'course'`. If present, print "already
   loaded — nothing to do", print the course's completeness and drift status, and **exit 0 without
   writing**. Never gate on a total count.
2. **Preconditions**, each a failure with a named reason:
   - the book config and its bundles exist in the checkout (`services/extraction/books/<book>.json`,
     `seed/<book>/`, `seed/generated/<book>/`);
   - no `course_availability` row exists for the course. A row would mean someone pre-wrote
     visibility, so refuse.
   - the running app container carries the image label `org.ainext.features=curriculum-scope`,
     read with `docker inspect`. `deploy/Dockerfile` sets the label in the same release that scopes
     the readers (T319). **Without it the load refuses**, because loading into a stack whose Ask
     context lists every book would name the book to every student (FR-4202, privacy review F13).
3. **Backup and verification** (`load` mode only):
   - `pg_dump -Fc` to `/opt/reletix/backups/mvp1/load-<course>-<UTC>.dump`;
   - `pg_restore --list` on the file must succeed and list the `graph_nodes` and `questions` data
     entries, or the script stops;
   - print the one-line rollback: `pg_restore --clean --if-exists -d ainext_mvp1 <file>` (FR-4208).
4. **Load**, in a `tools`-profile container with `AINEXT_ENVIRONMENT=mvp1`. Each step is shown in
   dry-run as the loader's `--dry-run` delta.
   1. `load_seed.py --all --course $COURSE --if-absent`. The loader is add-only by default (B9), and
      `--if-absent` changes nothing if the course node already exists. It writes `course part_of
      program:<curriculum>` and the lessons' book provenance (FR-4311).
   2. `load_misconceptions.py seed/generated/<book>/misconceptions.json`.
   3. `load_generated_questions.py seed/generated/<book>/{generated,widget}-questions.json
      --restore --sample 0`. These are exports: statuses and review stamps travel. Nothing asserts a
      review that did not happen (FR-1110).
5. **Post-flight** (both modes, reading only):
   - print the course's objectives, live and held counts by source;
   - run `parity_check.py --course` for **every** course, which must pass (FR-4207, F17);
   - print `SELECT count(*) FROM course_availability WHERE course_id = $COURSE`, which must be **0**.
6. **Exit codes**: `0` means loaded, or already present, or dry-run clean. `2` means a precondition
   refused. `3` means the backup failed verification. `4` means post-flight failed; the rollback line
   has already been printed.

**What it never does**: touch another course's subtree, write a visibility rule, run in a deploy, or
run `--course` on a course that is present.

## `refresh-content` on noor (FR-4210, privacy review F15)

`refresh-content.yml` and `deploy/refresh-content.sh` gain a `stack` input (`mvp1`, the default, or
`poc`) that sets `APP_DIR` and the database. By default it now points at noor. `course` mode runs
`load_seed.py --course <id> --update` for content edits, or `--replace` when content must be pruned.
The loader (B9, on the branch) **never deletes or rewrites a student row, a misconception or an
explanation**. `--update` refuses to change what an attempted question asks. `--replace` **refuses the
whole load, saying what would be lost**, when student data, the catalogue, generated questions or
another course still reference it. There is no override that deletes student data. The loader's old
behaviour ("attempts/mastery referencing deleted content are deleted with a printed warning") is gone.

## `ci-cd.yml`

- **First boot** ("Curriculum (only when none is loaded)") stays for a brand-new database. Its gate
  changes from `count ≥ 3` to **the three National course ids each present** (privacy review F14, the
  same weakness). It never names the G10 course.
- **Generated maths content** (one-time): its gate changes from `GEN ≥ 590` to "no generated rows under
  `course:prep3-math-en`". It keeps promoting Prep-3 only.
- **Misconception catalogue (every deploy)**: it iterates the book configs and syncs a book's
  catalogue **only when that book's course is present**, so G10 catalogue fixes reach production after
  the course is loaded (FR-3214) and never before.

## Local

`scripts/local-dev.sh` replaces `-ge 3` with a per-course "load if absent" over every book config, and
never touches a present course. The G10 course loads locally only when its bundles exist, **and only
after the scoped readers are in place**. Locally the check is that `student-scope-guard.test.mts`
exists in the source, because there is no image to label.

## Runbook

`deploy/DEPLOY-MVP1.md` gains a "Loading a course" section: the dry run, the real run, reading the
post-flight, the rollback, and "then set the rule in `/courses`". It is written for a founder at
midnight: every command is copy-pasteable, and each step says what success looks like.

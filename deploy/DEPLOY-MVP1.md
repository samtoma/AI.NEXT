# Deploying the MVP 1.0 environment (the `PDR1-0` solution)

> **Re-cut 2026-09-13 (T136, [ADR-0010](../docs/decisions/0010-one-branch-per-solution.md)).**
> The deploy branch is **`PDR1-0`**, not `mvp1` — that branch never existed. Each solution branch
> carries its own copy of `ci-cd.yml` and deploys only itself; there is no branch→environment
> matrix any more. The directory, compose project, volume, database and `AINEXT_ENVIRONMENT` tag
> below deliberately keep the name `mvp1`: they name the **environment and its stack**, not the
> branch, and `mvp1` is already written into every analytics row, ledger row and cost record in
> that database — the content loader refuses to run against any other value.

Companion to `DEPLOY.md` (the baseline) and `CICD.md`. First-time bootstrap is in
`specs/001-student-mvp1-delta/quickstart.md`; this file is the ongoing runbook.

## The two solutions

| | Baseline — **frozen** | `PDR1-0` |
|---|---|---|
| Branch | `main` (untouched — see ADR-0010) | `PDR1-0` |
| Checkout | `/opt/reletix/AI.NEXT` | `/opt/reletix/AI.NEXT-mvp1` |
| Compose project | `ainext` | `ainext-mvp1` |
| Compose file | `deploy/docker-compose.yml` | `deploy/docker-compose.mvp1.yml` |
| Database | `ainext_poc` (vol `ainext_pg`) | `ainext_mvp1` (vol `ainext-mvp1_ainext_mvp1_pg`) |
| App port | `127.0.0.1:3100` | `127.0.0.1:3101` |
| Console port | — (no console on the baseline) | `127.0.0.1:3102` |
| Hostname | ainext.reletix.com | **noor.reletix.com** (settled 2026-09-22) |
| Console hostname | — | **`admin-noor.reletix.com`** (Samuel, 2026-09-22), see [`TAKEOVER.md`](./TAKEOVER.md) §2.2 |
| `AINEXT_ENVIRONMENT` | `baseline` (default) | `mvp1` |

> **Taking the live deployment over — branches, hostname, database, the Claude CLI login and mail —
> is its own study: [`TAKEOVER.md`](./TAKEOVER.md).** Read it before touching `main`, before adding a
> public hostname, and before deciding whether to start the database fresh.

> **Hostnames stay one label deep.** Universal SSL covers `*.reletix.com`, and a wildcard matches
> exactly one label — `ainext-mvp1.reletix.com` is covered, `mvp1.ainext.reletix.com` is not. Any
> future environment on this zone follows the same rule.

Both sit behind the **same** Cloudflare Access application, so pilot families are
granted and revoked in one place. That revocability is what bounds the risk of
serving unreviewed generated content (ADR-0007, decisions.md Q8/Q9) — it is the
fastest lever you have if something reads badly.

## Rules that are not negotiable on this box

The box is shared with production `talent.reletix.com`.

- **Always name the project.** `docker compose -p ainext-mvp1 -f deploy/docker-compose.mvp1.yml …`
  An unqualified compose command in the wrong directory restarts the frozen baseline.
- **Never `down -v`.** It destroys the volume holding that stack's one-time Claude
  login, and on the baseline it would take pilot data with it.
- **Never `docker system prune` / `image prune -a` / `builder prune`.** They hit the
  *shared* daemon. The pipeline prunes dangling images only.
- **The baseline is frozen.** The only change it may receive while the comparison
  runs is analytics instrumentation, and only with the prompt capture harness
  reporting zero diffs (FR-908).

## Routine operations

```bash
cd /opt/reletix/AI.NEXT-mvp1/deploy
C="docker compose -p ainext-mvp1 -f docker-compose.mvp1.yml"

$C ps                       # status
$C logs --tail=120 app      # student surface logs
$C logs --tail=120 console  # admin console logs
$C logs migrate             # WHICH MIGRATIONS RAN on the last `up`, and every check
$C up -d --build            # redeploy (CI does this on push to PDR1-0)
$C down                     # stop — WITHOUT -v, ever
```

## Three services you did not have before

`up` now brings up more than `db` + `app`, and the ordering is load-bearing.

- **`migrate`** — a one-shot that applies `db/schema.sql` (only to an empty database) and every file
  in `db/migrations/` (every time; they are idempotent by construction), then runs four post-flight
  checks. `app`, `console` and the loader all declare `service_completed_successfully` on it, so a
  migration failure means the app is **not started at all** rather than started against a
  half-migrated database. It connects as the database owner, because no other role may create a
  table in schema `public` — the argument is in [`apply-migrations.sh`](./apply-migrations.sh).
  **If a deploy fails, read `$C logs migrate` first.** It says which file stopped it and what to do.
- **`console`** — the admin console, the same image as `app` with `npm run start:admin`
  (`AINEXT_SURFACE=admin`, artefact `.next-admin`). Same commit as the student surface by
  construction. Bound to `127.0.0.1:3102`. **It must sit behind Cloudflare Access before it gets a
  public hostname** — see [`cloudflared-ingress.example.yml`](./cloudflared-ingress.example.yml).
- The **`loader`** now waits for `migrate` too, so a content refresh can no longer run against a
  database that is behind on migrations.

The very first `up` on a fresh database will **stop** with "no password set for: ainext_app,
ainext_operator, ainext_maint" and print the three `ALTER ROLE` commands. That is expected: migration
017 creates those roles without passwords on purpose, so that no credential is ever written into
git. Set them, put the same values in `deploy/.env`, deploy again.

> **⏸️ Deploy is currently MANUAL-ONLY (2026-09-13, `T139`).** Samuel has parked infra work until
> the product is finalised and tested locally, so **a push does not deploy**. Run it by hand from
> Actions → CI/CD → Run workflow, on this branch. To re-arm automatic deploys, change
> `== 'workflow_dispatch'` back to `!= 'pull_request'` in the deploy job. Until then, use
> `docs/LOCAL-DEV.md` to run and verify the product.

When armed, deploys are automatic: pushing `PDR1-0` runs **this branch's own copy** of `ci-cd.yml`, which
targets this environment's directory, project, compose file and port directly — no branch mapping.
The baseline deploys from its own branch using the copy of the workflow that lives there.

⚠️ The shared-box safety rails (dangling-only pruning, never `system prune`, health gate before
traffic) now exist in one copy per solution branch. **If you change a rail, change it on every
solution branch** — the copy that drifts is the one that eventually prunes production's images.
The `concurrency: deploy-oci` group is shared across branches on purpose, so two solutions never
deploy onto the box at the same time.

## Content refresh and parity

Content no longer has to match the baseline — cross-solution parity was withdrawn
(ADR-0010 Clarification; the two solutions may diverge completely). What `parity_check.py` still
enforces is a **per-solution drift guard**: every loaded course must not silently drift from the
counts its book config (`services/extraction/books/<book>.json`, `parity`) says it has.

**Never load content by hand on the box.** Every content change goes through one of two manual
actions, both of which take a verified backup first and print the one-line rollback:

| The course is… | Use | Runbook |
|---|---|---|
| **not loaded yet** (a new book) | Actions → **Load a course (manual)** | [Loading a course](#loading-a-course) below |
| **already loaded** (a correction) | Actions → **Content refresh (manual)**, `stack: mvp1` | this section |

`Content refresh` acts on **noor** since 2026-09-25 (it used to act on the frozen baseline). Its
modes on noor, safest first:

| Mode | What it does | Confirm box |
|---|---|---|
| `status` | stack, counts, courses, backups — reads only | empty |
| `preview` / `preview-update` / `preview-replace` | the whole load inside a transaction, then rolled back; prints what would change | empty |
| `course` | **adds** what the bundles have and the database lacks; changes nothing that exists | the course id |
| `update` | also applies bundle edits to existing rows (never a question's status or review stamp; refuses to change what an attempted question asks) | `UPDATE <course-id>` |
| `replace` | also prunes what the bundles dropped: an attempted question is **retired** (kept, not served); an objective with progress makes it **refuse** | `REPLACE <course-id> <N>` — `N` is the number of students with progress, as `preview-replace` prints it |

It never moves the box's checkout: it loads the bundles of the **deployed** commit, and lesson
prose lives in the image — so **deploy first, then refresh**. `full-reseed` and `promote-poc` exist
only on the frozen baseline (`stack: poc`), which runs that checkout's own script, unmoved.

The drift guard, by hand, for every configured course:

```bash
cd /opt/reletix/AI.NEXT-mvp1/deploy
C="docker compose -p ainext-mvp1 -f docker-compose.mvp1.yml"
$C --profile tools run --rm -T --no-deps --entrypoint python loader parity_check.py --all-courses
```

Expect `PARITY: GREEN` for each course — Prep-3 maths at 10 modules / 90 LOs / 112 prerequisite
edges / 450 questions / 212 visuals. (`--all-courses` checks every book config, so a book whose
config is committed but which is not loaded yet shows RED until it is; the load action checks only
loaded courses.)

If **live** counts differ while totals match, a scoped refresh or a restore has demoted questions
back to `review`. The environment is then serving a different question set while looking identical
by count. The check fails on this deliberately for a course whose constant says `require_all_live`.

## Loading a course

For a book that is **not in the database yet** — the Grade 10 course (`course:us-g10-math-en`) is
the first. Three runs of one workflow: **dry-run → rehearse → load**. Then a rule in the console.
Nothing a student sees changes until that rule. (FR-4208, FR-4209; `contracts/load-course.md`.)

The same workflow has two more things in it, and they are **not the same thing** — read the one
you need, not both:

| You want to… | Mode(s) | Students' work since then |
|---|---|---|
| put **one course's** generated questions, catalogue and review stamps back to a reviewed export | `restore-dry-run` → `restore-rehearse` → `restore` ([below](#restoring-a-course-from-its-export--keeps-every-students-progress)) | **kept** — or it refuses and says why |
| undo a load that went wrong, or any emergency: the **whole database** back to a backup | `rollback` ([below](#rolling-back--the-whole-database-emergency-only)) | **lost** — every student, every course, since the backup |

### Before you start — all four must be true

1. **The book is merged to `main` and deployed.** The load uses the bundles of the commit the box
   is running; it does not pull. Actions → CI/CD → Run workflow (branch `main`), and wait for green.
2. **Its book config is complete**: `services/extraction/books/<book>.json` with `status` not
   `ingest`, its bundles listed, and a `parity` block. The workflow's first job checks this.
3. **The running image is new enough.** It must carry the label that says the student readers are
   scoped to what each student may see. The load checks it; to see it yourself:
   ```bash
   docker image inspect ainext-mvp1-app -f '{{index .Config.Labels "org.ainext.features"}}'
   # success: curriculum-scope
   ```
4. **Nobody has set a rule for the course yet** (console → `/courses`, and no Student 360
   exception). A rule written before the load would make it visible the moment it lands.

### 1. Dry run — writes nothing

Actions → **Load a course (manual)** → Run workflow:

| branch | course | mode | confirm |
|---|---|---|---|
| `main` | `course:us-g10-math-en` | `dry-run` | *(empty)* |

**Success looks like:** a green run; the summary says `OK`; the log ends with
`DRY RUN CLEAN` and, just above it, `OK nothing was written`. Every precondition line reads `OK`.

### 2. Rehearse — the whole load, on a throwaway copy

Same form, mode **`rehearse`**, confirm empty. It backs the database up, proves the backup reads
back, restores it into a scratch database, runs the real load **there**, checks it, then drops the
scratch database and its copy of the backup. The real database is only read. A few minutes; for
those minutes the database container holds a second copy of the data.

**Success looks like:** `OK the backup restores cleanly (this is the rollback path, proven)`, a
post-flight where every line is `OK`, then `REHEARSAL CLEAN`.

### 3. Load — the real thing

Same form, mode **`load`**, and **retype the course id** in confirm. **Success looks like:**

```
== LOADED — course:us-g10-math-en is in the database, complete, and HIDDEN from every student
   roll back with:  bash /opt/reletix/AI.NEXT-mvp1/deploy/load-course.sh rollback /opt/reletix/backups/mvp1/load-us-g10-math-en-<UTC>.dump
```

The run summary repeats the rollback line. **Copy it somewhere** before you do anything else.
Running the action again later is harmless: it says `already loaded — nothing to do` and writes
nothing.

### Reading the post-flight (printed by `rehearse` and `load`)

| Line | Means | If it is not `OK` |
|---|---|---|
| `the course is complete` | the course node, every catalogue entry and every generated question are in | a load step failed — see below |
| `objectives / questions … / visuals / misconceptions / explanations` | what students would get once a rule allows it; `held` = at `review` | information only |
| `visibility rows … 0 rules, 0 exceptions` | nobody can see it yet | somebody wrote a rule meanwhile — remove it or roll back |
| `PARITY: GREEN — <course>` (one per loaded course) | the drift guard, every course | the loaded course's counts differ from its book config: roll back, tell Samuel |
| `every other course's content is byte-identical` | nothing outside this course changed | **roll back** — the log shows which course changed |
| `every student table is byte-identical` (rehearse only) | no student row moved | roll back is not needed (it was a copy) — do not run `load`; tell Samuel |

### Exit codes (the summary's first row says which)

| | Means | What to do |
|---|---|---|
| 0 | loaded; or already loaded; or the dry run / rehearsal is clean | the next step |
| 2 | a precondition **refused** — nothing was written | read the `!!` lines: deploy first, remove a rule, fix the book config |
| 3 | the backup failed or did not read back — nothing was written | disk space: `df -h /opt/reletix/backups`; then run again |
| 4 | a load step or the post-flight failed **after writing** | below |

**Exit 4 in a load step:** each step is its own transaction, so the course may be half there — and
it is still hidden. Run `load` again (it resumes: every step is add-only and skips what is present),
or roll back.
**Exit 4 in the post-flight:** the course is loaded and hidden. If you are unsure, roll back.

### Rolling back — the whole database, emergency only

> **This undoes every student's work since the backup** — every attempt, every mastery change, every
> lesson advanced, every account created, in **every** course. It is the lever for "the load broke
> something and I cannot tell what". To put **one course's** content back and keep everyone's
> progress, use **restore** ([its own section](#restoring-a-course-from-its-export--keeps-every-students-progress)),
> not this. (Until 2026-09-27 this mode was called `restore`; the old spelling
> `load-course.sh restore <file>` is now refused with the right command, and does nothing.)

**Preferred, from a phone at midnight: Actions → "Load a course (manual)" → Run workflow, `mode: rollback`.**
No SSH, no terminal. Fill in:

| branch | course | mode | backup | confirm |
|---|---|---|---|---|
| `main` | the course you were loading (used only to find `latest`) | `rollback` | the exact backup file name, or `latest` | **retype the exact backup file name** |

If you do not remember the exact file name, put `backup: latest` and **anything** in confirm first —
the run refuses (nothing is touched) and its `::error::` names the file `latest` resolved to on the
box; run it again with that name in **both** `backup` and `confirm`. (`latest` means the newest
`load-<course>-*.dump` for the course you named — not the newest backup of any kind, and not a
`pre-restore-*` one; to restore one of those, or any other backup by name, put its exact file name in
both `backup` and `confirm` directly.)

**What it does, in order** (`deploy/load-course.sh rollback`, the same steps whether the GitHub Action
calls it or you run it by hand): verifies the backup end to end — refuses before touching anything if
it does not read back; takes a **pre-restore** backup of its own (so the restore can itself be
undone); stops the student app and the console; restores in **one transaction** (a failure rolls
itself back — the database is exactly as it was, and the app and console are restarted); re-applies
this checkout's migrations; starts both back up and checks they answer; then a **read-only**
post-flight — the drift guard for every course now in the database. **Everything students did since
the backup was taken is replaced by the backup** — the pre-restore backup keeps it, and both the log
and the run's summary print the one line that brings it back.

Success in the run's summary looks like: result `OK — rolled back`, then `OK restored`,
`OK student app answers on :3101`, `OK console answers on :3102` in the log, and — in the post-flight
— `OK drift guard GREEN for every loaded course`. If the drift guard is **not** green after a rollback,
the backup itself predates a content fix that is now missing again: read the warning, and decide with
Samuel before anyone uses the environment; the rollback itself still succeeded (the database matches
the backup exactly).

On the box directly, the same thing, with the line the `load` run printed:

```bash
bash /opt/reletix/AI.NEXT-mvp1/deploy/load-course.sh rollback /opt/reletix/backups/mvp1/load-<course>-<UTC>.dump
```

If the script itself cannot run, the raw restore command (also printed by the load). It does **only**
the `pg_restore` — no verification, no pre-restore backup, no stopping or restarting the app and
console, no re-applied migrations, no post-flight. Do all of that by hand around it if you must use
it: `verify-backup` first, `pg_dump` the current database yourself before you run this, stop `app` and
`console`, and re-run `migrate` and the drift guard afterwards:

```bash
cd /opt/reletix/AI.NEXT-mvp1/deploy && docker compose -p ainext-mvp1 -f docker-compose.mvp1.yml \
  exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --clean --if-exists --single-transaction -U ainext -d ainext_mvp1' \
  < /opt/reletix/backups/mvp1/load-<course>-<UTC>.dump
```

Backups live in `/opt/reletix/backups/mvp1/`, mode 0600. They hold students' rows (minors' data):
they never leave the box and never enter git. Nothing deletes them automatically; prune old ones by
hand when you are sure. `bash deploy/load-course.sh verify-backup <file>` says whether one still
reads back end to end — the GitHub Action's `check` job runs the equivalent name/shape checks before
the box is touched, but a corrupt file is only ever caught by an actual read-back, which happens on
the box, inside `rollback` itself, before anything is stopped.

### 4. Then set the rule

Console → **`/courses`** → the course → the grade → **live**, with a note saying why. To try it
first with one test account, give that account an exception in its **Student 360** instead. The
console's **Content** page shows the course's completeness, so the result can be checked without a
database shell (FR-4209). After the load, every deploy also syncs this book's misconception
catalogue, so fixes to it reach production without another load.

**What the action never does:** touch another course, touch a student row, write a rule, run
inside a deploy, or re-load a course that is present. A change to a loaded course is a content
refresh (above).

## Restoring a course from its export — keeps every student's progress

(T430 · decision 29 · Samuel's answer 27, 2026-09-27: "Build the safe restore" · FR-4208, FR-4210)

**When:** one course's **generated** content went wrong — a bulk status change, a bad review
import, a hand edit, a regenerated bank loaded over the reviewed one — and you want it back exactly
as it was when it was last **exported and reviewed**, without touching a single student row.

**What it puts back** — the course's export (`services/extraction/seed/generated/<book>/`, or
`seed/generated/` for Prep-3 maths): the three files `export_generated_content.py --course` writes —
its generated and widget questions, its misconception catalogue with the refutations, and the
catalogue's stamps on the book's own multiple-choice options. **Every row keeps its own status and
review stamp** (a `retired` question stays retired, a `review` one stays held, a human's
`reviewed_by` comes back). Rows the export does not have are removed — unless a student used them
(below). **What it does not touch:** the book itself (graph, book questions, figures, lessons —
a content refresh changes those), any other course, any visibility rule, **any student row**.

**The export must have an `export-record.json`.** An export taken with
`export_generated_content.py --course <id>` writes one beside the bundles: which course and book,
the source document, and the sha256 of each file. Restore replays only an export whose files match
their record and whose course in the database is from the same book file. **An export committed
before 2026-09-27 has no record and cannot be restored** — export the course again from the live
database, commit, deploy; that export is then the restore point. A freshly generated bundle (not an
export) never has a record and is always refused.

### Before you start

1. **The export you want is committed** and the box has it: in the deployed commit (the default),
   or at a tag or commit the box's checkout knows — every deploy fetches all tags
   (`git -C /opt/reletix/AI.NEXT-mvp1 tag --list 'v*'` on the box). The checkout is never moved:
   the export is read with `git show`.
2. **The course is loaded.** Restore never loads a course; that is `load`.

### 1. Dry run — every check and the whole replay, rolled back

Actions → **Load a course (manual)** → Run workflow:

| branch | course | mode | export_ref | confirm |
|---|---|---|---|---|
| `main` | `course:us-g10-math-en` | `restore-dry-run` | *empty* = the deployed commit, or a tag like `v0.9.3` | *(empty)* |

**Success looks like:** a green run; `OK export staged from <sha>`; a "what the replay does" table
(questions add / change / unchanged / remove, the status moves, the review stamps put back);
`students: nothing the replay removes or re-words is named by any student row`;
`read-back: … exports to exactly the restored files, byte for byte`; then
`OK nothing was written` and `RESTORE DRY RUN CLEAN`.

### 2. Rehearse — the whole restore on a throwaway copy

Same form, mode **`restore-rehearse`**. It backs the database up, proves the backup restores into a
scratch database, replays the export **there**, runs the post-flight, then drops the scratch database
and its copy of the backup. **Success:** `OK the backup restores cleanly`, a post-flight where every
line is `OK` — including `every student table is byte-identical to before` — then `REHEARSAL CLEAN`.

### 3. Restore — the real thing

Same form, mode **`restore`**, and **retype the course id** in confirm. It takes a verified backup
first, then replays the export in **one transaction** that commits only if (a) every student table is
identical before and after its writes and (b) the course exports back to exactly the restored files.
**Success looks like:**

```
   students: all 18 student tables identical before and after the replay (inside the transaction)
   read-back: course:us-g10-math-en exports to exactly the restored files, byte for byte
RESTORED — course:us-g10-math-en's generated content is the export's, row for row (database ainext_mvp1)
   OK read-back: course:us-g10-math-en exports to exactly the export that was restored
   OK drift guard GREEN for every loaded course
   OK every other course's content is byte-identical to before (N course(s))
== RESTORED — course:us-g10-math-en's generated content is its export at HEAD, row for row; every student's progress is kept
```

The run also prints a `roll back with:` line. That is the **whole-database emergency rollback**
(it undoes students' work since the backup) — keep it, and do not use it for anything a restore
refusal or a dry run tells you.

On the box directly:
`CONFIRM=course:us-g10-math-en bash /opt/reletix/AI.NEXT-mvp1/deploy/load-course.sh course:us-g10-math-en restore [<tag>]`
— the `CONFIRM=` is the typed confirmation; without it the script refuses.

### When it refuses (exit 2) — nothing was written

Every refusal names the row and the reason (counts only — never which student). The usual ones:

| The log says | Means | What to do |
|---|---|---|
| `export-record.json is not in <ref>` / `no export-record.json` | that ref holds a freshly generated bundle, or an export older than records | export the course from the live database, commit, deploy; or pick a ref whose export has a record |
| `<file>: sha256 … is not the … its export record says` | the file was edited after the export | re-export instead of editing; or restore the commit before the edit |
| `the export record is for …, not …` / `names book …` | wrong course or book | pick the right course |
| `not the one this export was taken from: its source document is …` | the course in the database was built from a different book file | that export cannot be replayed onto it — decide with Samuel |
| `question … is not in the export, and student data names it: attempts.question_id: 3 row(s), 2 student(s)` | removing it would orphan students' history | **the rule working** (FR-4210). Export first so it is in the bundle, or decide with Samuel |
| `… the export changes what it asks or accepts, and student data names it` | the export's stem, choices or answer differ from what students answered | the same: their past answers would stop meaning what they meant |
| `… maps … option …, which the database's book no longer has` | the book changed since the export | the export is too old for this book |

**Exit 5** — the replay did not read back as the export and was rolled back; nothing was written.
That is a defect, not an operator error: send Samuel the log. **Exit 4** — the replay committed but
the post-flight failed; the log prints the emergency rollback line, which also undoes students' work
since the backup, so decide with Samuel before using it.

## Unreviewed content — what is live and to whom

Constitution v2.0.0 Principle III is suspended here for generated explanation
content only. It is queryable at any time:

```sql
SELECT count(*) FILTER (WHERE NOT reviewed) AS unreviewed,
       count(*)                             AS total
FROM explanation_library;
```

Questions and canonical solutions are **not** covered by the suspension — they
keep the normal `status` review gate.

## Safety escalation — OWNER NOT YET NAMED

`safety_flags` records crisis flags and the dispatch adapter sends them out of
band, separate from the analytics queue. **The human recipient has not been named
(tasks T067).** Until a person and a response expectation are recorded here, this
environment carries founders only — an unmonitored channel produces a record that
looks like a safeguard and is not one.

> **Recipient:** _(unassigned — Samuel to fill in before any student is invited)_
> **Response expectation:** _(unassigned)_

## Rolling back

Every deploy re-applies **every** migration, in order, with the build being
deployed (`deploy/apply-migrations.sh`; there is no ledger). So a rollback is
never "undo the last migration": it is the OLD build's migrations running over
the NEW build's database. Whether that is safe is a property of the old build,
and CI checks it on every change to `db/` (`.github/workflows/ci-cd.yml`,
job `migrations`, step (c)). Pick the smallest lever that fixes the problem:

**1. A feature is misbehaving → switch it off. No deploy.**
Socratic probing (v0.7.0): console → **Teaching** → **Off** → Save. It is
recorded (who, when, from → to), it reaches every student on their next
message — a lesson in progress stops probing then — and switching it back on
is one click (On reaches a student from their next sitting, ADR-0021). A
single student: remove their test-account mark on their Student 360. To cut
all access at once, remove the hostname in the Cloudflare Zero Trust
dashboard — faster than any deploy, and the right lever for withdrawing
content from students. The baseline is unaffected either way.

**2. The code is wrong → revert the merge and deploy.**
`git revert -m 1 <merge sha>` on `main`, push, then Actions → CI/CD → Run
workflow. This is safe from v0.6.1 on: v0.6.1 and every later release guard
migration 014, so the previous build's migrations leave the newer role
vocabulary (and the `teaching-controls` rows that depend on it) as they are.
Nothing needs running by hand. The v0.7.0 tables and columns stay in the
database, unread by the older build, and are picked up again, intact, by
the next roll-forward.

**3. Never redeploy v0.6.0 itself after v0.7.0.**
Its migration 014 drops and re-adds a four-role CHECK unconditionally, and
Postgres refuses to add it while any operator holds `teaching-controls`: the
migrate step fails, the app never starts — the site is down (CI step (c)
shows exactly this against v0.6.0). Roll back to v0.6.1 instead (it is v0.6.0
plus the guard, nothing else). If v0.6.0 itself is ever unavoidable:

```bash
# on the box, against the mvp1 database, BEFORE deploying v0.6.0
# a) keep who held teaching-controls — the rollback below deletes the rows
psql <db> -c "\copy (SELECT * FROM operator_roles WHERE role = 'teaching-controls') TO '029-operator-roles.csv' CSV HEADER"
# b) remove the v0.7.0 schema, the toggle first (its tables reference nothing)
psql <db> -v ON_ERROR_STOP=1 -f db/migrations/rollback/030-teaching-toggle-and-testers.down.sql
psql <db> -v ON_ERROR_STOP=1 -f db/migrations/rollback/029-teaching-controls-role.down.sql
# c) deploy v0.6.0
```

After the next roll-forward (v0.7.0 or later) migration 029 grants the role
to **nobody** — it reads the `auth_events` trail, which the rollback leaves,
so an operator it was revoked from can never get it back that way. Put the
grants back from the dump, exactly as they were (revocations included), then
re-revoke anybody you removed it from in the meantime:

```bash
psql <db> -c "\copy operator_roles FROM '029-operator-roles.csv' CSV HEADER"
```

What 030's rollback loses and does not bring back: the switch position and its
history (it comes back **Off**, the safe default), every tester mark, and
which release opened each session. Dump them first if they matter — the
commands are in the rollback file's header. This whole path was run on a
scratch database on 2026-09-24: rollback/030, rollback/029, v0.6.0 twice,
v0.7.0, restore — every step passed.

To stop the stack outright (no `-v`: the volume is the database):

```bash
$C down                                  # stop the comparison stack, no -v
```

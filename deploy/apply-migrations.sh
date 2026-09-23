#!/bin/sh
# ===========================================================================
# Apply db/schema.sql (once) and db/migrations/*.sql (every time) to a database
# that ALREADY EXISTS AND ALREADY HAS DATA.
# ===========================================================================
#
# Run by the `migrate` one-shot service in docker-compose.mvp1.yml, before the
# `app` and `console` services are allowed to start. Read that file's `migrate`
# block for WHY it is a compose service rather than a step in the deploy job.
#
# ---------------------------------------------------------------------------
# THE PROBLEM THIS EXISTS TO FIX
# ---------------------------------------------------------------------------
# `docker-compose.local.yml` mounts `db/schema.sql` and `db/migrations` into
# `/docker-entrypoint-initdb.d`, which Postgres runs **only when the data
# directory is empty**. That is correct for a laptop stack you can throw away
# and wrong for the box: the moment the volume has been initialised once, every
# file in that directory is ignored forever. A stack whose only migration
# mechanism is a first-boot mount is a stack that can never receive migration
# 011 or anything after it.
#
# `docker-compose.mvp1.yml` did not even have the first-boot mount, so migrations
# 011-024 — learning sessions, accounts, RLS, the console grants, the cost
# ledger, alerts, course availability, the design variant — had no path onto the
# box at all. The app would have started against a database missing most of the
# tables it reads, and failed at the first request rather than at deploy time.
#
# ---------------------------------------------------------------------------
# WHY IT CONNECTS AS THE BOOTSTRAP SUPERUSER AND NOT AS `ainext_maint`
# ---------------------------------------------------------------------------
# The obvious candidate is `ainext_maint` — it is the maintenance role, it is
# BYPASSRLS, and the loader already uses it. It CANNOT do this job, and the
# reason is in migration 017 itself:
#
#   * 017 grants `USAGE ON SCHEMA public` to all three roles and never grants
#     CREATE. `ainext_maint` can read and write every table in `public`; it
#     cannot make one. Every migration from 011 on creates tables.
#   * 017 runs `CREATE ROLE` and `ALTER ROLE ... BYPASSRLS`. `ainext_maint` is
#     explicitly `NOCREATEROLE`, and only a superuser may grant BYPASSRLS at all.
#   * 017 runs `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ainext_app` and
#     then re-grants table by table. That needs ownership of those tables.
#
# So migrations run as the database's OWNER — the `POSTGRES_USER` the `db`
# service was initialised with. That credential already exists in `deploy/.env`
# as POSTGRES_PASSWORD, it never leaves the compose network, and — this is the
# part that matters — the RUNNING APPLICATION still never receives it. ADR-0012's
# rule is "the app is not a superuser", not "nothing on the box is": a schema
# change is by definition an owner's act, and pretending otherwise would mean
# granting `ainext_maint` CREATE on `public`, which hands the loader (a service
# that parses JSON bundles) the ability to create and drop tables.
#
# ---------------------------------------------------------------------------
# HOW IT FAILS
# ---------------------------------------------------------------------------
# Loudly, early, and at a whole number of migrations. Three mechanisms:
#
#   1. `set -eu` plus `ON_ERROR_STOP=1`: the first SQL error stops psql, which
#      stops this script, which exits non-zero, which makes the one-shot
#      container exit non-zero, which makes `docker compose up -d` fail (the app
#      depends on `service_completed_successfully`), which fails the deploy job.
#      At no point does a half-migrated database get traffic.
#   2. `--single-transaction` PER FILE: a migration that fails in its ninth
#      statement rolls back its first eight. The database is therefore always at
#      migration N or migration N-1, never in the middle of one, so "run it
#      again after you fix it" is always the correct recovery. (This holds only
#      while no migration needs to run outside a transaction. `CREATE INDEX
#      CONCURRENTLY` and `VACUUM` are the two that would; there are none in
#      `db/` today — if you add one, it needs its own step here, not a quiet
#      removal of --single-transaction for everything.)
#   3. The post-flight checks at the bottom. Applying SQL without error is not
#      the same as the stack being able to run, and the gap between those two is
#      where a 3 a.m. outage lives.
#
# ---------------------------------------------------------------------------
# WHY THERE IS NO `schema_migrations` LEDGER
# ---------------------------------------------------------------------------
# Every file in `db/migrations/` is idempotent by construction — each one says so
# in its own header, and `scripts/local-dev.sh` re-runs all of them on every
# single run, which is the strongest test of that claim we have. Re-applying all
# of them is therefore cheap and safe, and a ledger would only add a second
# source of truth that can disagree with the database: the classic failure is a
# migration applied by hand in psql during an incident, after which the ledger
# says "not applied" and the tool tries again, or says "applied" for a file
# somebody edited. The database's own catalogue is the record. What we keep
# instead is a printed log of what ran, on every deploy, in the CI run record.
#
# POSIX `sh`, not bash: this runs inside `postgres:17-alpine`, and depending on a
# shell we did not install is how a migration runner breaks on an image bump.
# ===========================================================================

set -eu

# psql takes its connection from PG* in the environment (set by the compose
# service), so no DSN is assembled here and no password is ever on a command
# line where `ps` or a shell history would keep it.
: "${PGHOST:?PGHOST is not set — expected the environment the migrate service provides}"
: "${PGUSER:?PGUSER is not set}"
: "${PGDATABASE:?PGDATABASE is not set}"
: "${PGPASSWORD:?PGPASSWORD is not set}"

SCHEMA_FILE=/db/schema.sql
MIGRATIONS_DIR=/db/migrations

PSQL="psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc"

say() { printf '  %s\n' "$*"; }
fail() { printf '\n!! %s\n' "$*" >&2; exit 1; }

printf '\n== migrate: %s@%s/%s ==\n' "$PGUSER" "$PGHOST" "$PGDATABASE"

# ---------------------------------------------------------------------------
# 0. Wait for the server.
# ---------------------------------------------------------------------------
# `depends_on: db: condition: service_healthy` already covers the compose path,
# so this loop normally spins zero times. It is here for the hand-run case
# (`docker compose run --rm migrate`), where there is no dependency condition and
# the alternative is a connection refused that reads like a misconfiguration.
i=0
until pg_isready --quiet; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || fail "database did not accept connections within 60s"
  sleep 1
done

# ---------------------------------------------------------------------------
# 1. The schema, ONCE AND ONLY ONCE.
# ---------------------------------------------------------------------------
# `db/schema.sql` is NOT idempotent — ten bare `CREATE TABLE` statements, no
# `IF NOT EXISTS` anywhere — so applying it to a populated database fails on the
# first table and, thanks to --single-transaction, changes nothing. That is a
# safe failure but a confusing one, so we probe instead of discovering it.
#
# The probe is `to_regclass('public.graph_nodes')`, character for character the
# same probe `scripts/local-dev.sh` uses. That is deliberate: if the laptop and
# the box ever disagree about whether a database "has the schema", the bug is
# nearly impossible to see, so the two must ask the identical question.
if [ "$($PSQL --tuples-only --no-align -c "SELECT to_regclass('public.graph_nodes')")" = "" ]; then
  say "empty database — applying schema.sql"
  $PSQL --single-transaction -f "$SCHEMA_FILE"
  say "schema.sql applied"
else
  say "schema already present — skipping schema.sql"
fi

# ---------------------------------------------------------------------------
# 2. Every migration, in filename order, every time.
# ---------------------------------------------------------------------------
# Filename order is the dependency order and always has been (018 grants on
# tables 013 and 014 created; 021 references students from 015). Sorting by
# anything else, or applying only "new" ones, would make that implicit ordering
# a thing somebody has to remember.
applied=0
for m in "$MIGRATIONS_DIR"/*.sql; do
  # An unmatched glob expands to itself in POSIX sh; this turns "the mount is
  # missing" into a clear error instead of psql complaining about a file called
  # `*.sql`. A stack that silently applied ZERO migrations and started the app
  # anyway is precisely the failure this whole file exists to prevent.
  [ -f "$m" ] || fail "no migrations found at $MIGRATIONS_DIR — is ../db mounted?"
  name=$(basename "$m")
  start=$(date +%s)
  $PSQL --single-transaction -f "$m" >/dev/null
  say "$name  ($(( $(date +%s) - start ))s)"
  applied=$((applied + 1))
done
say "$applied migrations applied"

# A FLOOR, NOT A MANIFEST. It catches a truncated or stale mount — a checkout
# that somehow carried only the first few files — without this script having to
# know the name of every migration, which would be a second list to maintain and
# therefore a second list to forget.
#
# 27, not 28: the files are numbered 002-028 because 001 was folded into
# schema.sql, so the count and the highest number will never agree. Raise this
# when a migration is added; it is one line and its failure message says so.
[ "$applied" -ge 27 ] || fail "only $applied migration files were found; this branch has at least 27 (002-028). Is ../db a complete checkout?"

# ---------------------------------------------------------------------------
# 3. Post-flight: is the stack actually able to run?
# ---------------------------------------------------------------------------
# Each check below has been an outage somewhere, and each one is cheaper to make
# here than to diagnose from a crash loop at midnight.

# 3a. The three roles exist AND have the privileges that decide whether
# row-level security is real. `.env.example` tells a human to run this query by
# hand and "check it took, before believing anything is isolated". A check a
# human runs once is a check that stops being run; this one runs on every deploy.
say "checking roles (ADR-0012)"
$PSQL <<'SQL'
DO $check$
DECLARE
  n int;
  bad text;
BEGIN
  SELECT count(*) INTO n FROM pg_roles
   WHERE rolname IN ('ainext_app', 'ainext_operator', 'ainext_maint');
  IF n <> 3 THEN
    RAISE EXCEPTION
      'expected the three roles created by migration 017; found % of 3', n;
  END IF;

  SELECT string_agg(rolname, ', ') INTO bad FROM pg_roles
   WHERE rolname IN ('ainext_app', 'ainext_operator')
     AND (rolsuper OR rolbypassrls);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'these roles are superuser or BYPASSRLS and must be neither: %. '
      'Every RLS policy in migration 017 is inert while that is true, and the '
      'isolation proof would pass for the wrong reason.', bad;
  END IF;
END
$check$;
SQL

# 3a'. SET the role passwords, from the values the deploy already wrote.
#
# Added 2026-09-23 after the first real deploy stopped here with "no password
# set for: ainext_app, ainext_maint, ainext_operator" and a remedy that told a
# human to SSH in and run three ALTER ROLEs. Samuel had already said, about the
# secrets file: "I want the deployment to be from the CI, why should I run the
# cmd myself." The three values were ALREADY in GitHub secrets and ALREADY in
# deploy/.env; this script simply never used them.
#
# It is idempotent — setting the same password again changes nothing — and that
# makes ROTATION one step: change the GitHub secret, deploy. The app and the
# console pick up the new value from the same file in the same run.
#
# The values arrive as psql variables and are quoted by psql's own `:'var'`
# form, so no password, whatever it contains, can close its own string and
# become SQL. They are briefly visible in this one-shot container's process
# list; anybody who can see that can already read deploy/.env, so it widens
# nothing. `log_statement` is `none` by default, so Postgres does not log them;
# do not turn statement logging on for this database without revisiting this.
#
# THREE DIFFERENT VALUES, enforced. `ainext_maint` is BYPASSRLS and reads every
# student's rows. If the app's password also unlocked it, a compromised app
# container would hold a key that walks straight past every RLS policy in
# migration 017 — the isolation would be decoration with a password on it.
if [ -n "${AINEXT_APP_PASSWORD:-}" ] && [ -n "${AINEXT_OPERATOR_PASSWORD:-}" ] \
   && [ -n "${AINEXT_MAINT_PASSWORD:-}" ]; then
  if [ "$AINEXT_APP_PASSWORD" = "$AINEXT_OPERATOR_PASSWORD" ] \
     || [ "$AINEXT_APP_PASSWORD" = "$AINEXT_MAINT_PASSWORD" ] \
     || [ "$AINEXT_OPERATOR_PASSWORD" = "$AINEXT_MAINT_PASSWORD" ]; then
    cat >&2 <<'SAME'

!! Two of the three database role passwords are IDENTICAL.
!! `ainext_maint` bypasses row-level security; sharing its password with the
!! app or the console makes every RLS policy decoration. Set three different
!! values and deploy again:
!!   gh secret set AINEXT_APP_PASSWORD      --repo samtoma/AI.NEXT
!!   gh secret set AINEXT_OPERATOR_PASSWORD --repo samtoma/AI.NEXT
!!   gh secret set AINEXT_MAINT_PASSWORD    --repo samtoma/AI.NEXT
SAME
    exit 1
  fi
  say "setting the three role passwords from deploy/.env"
  $PSQL -v app_pw="$AINEXT_APP_PASSWORD" \
        -v op_pw="$AINEXT_OPERATOR_PASSWORD" \
        -v maint_pw="$AINEXT_MAINT_PASSWORD" <<'SQL'
ALTER ROLE ainext_app      PASSWORD :'app_pw';
ALTER ROLE ainext_operator PASSWORD :'op_pw';
ALTER ROLE ainext_maint    PASSWORD :'maint_pw';
SQL
fi

# 3b. Those roles have passwords. Migration 017 creates them with NONE, on
# purpose — a migration that set one would put a known credential in git — so on
# a brand-new box the correct state after this script's first run is "schema
# applied, no passwords yet". Without this check the next thing that happens is
# the app container crash-looping on a password authentication failure while the
# deploy log says the migrations went fine.
if ! $PSQL --quiet <<'SQL'
DO $check$
DECLARE missing text;
BEGIN
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO missing
    FROM pg_authid
   WHERE rolname IN ('ainext_app', 'ainext_operator', 'ainext_maint')
     AND rolpassword IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'no password set for: %', missing;
  END IF;
END
$check$;
SQL
then
  cat >&2 <<'REMEDY'

!! One or more database roles still have no password.
!!
!! This script sets them itself from AINEXT_APP_PASSWORD, AINEXT_OPERATOR_PASSWORD
!! and AINEXT_MAINT_PASSWORD — so reaching this line means at least one of those
!! was EMPTY in deploy/.env. The deploy writes that file from GitHub secrets, so
!! set whichever is missing there and deploy again. No SSH:
!!
!!   gh secret set AINEXT_APP_PASSWORD      --repo samtoma/AI.NEXT
!!   gh secret set AINEXT_OPERATOR_PASSWORD --repo samtoma/AI.NEXT
!!   gh secret set AINEXT_MAINT_PASSWORD    --repo samtoma/AI.NEXT
!!
!! Use three DIFFERENT strong values (openssl rand -hex 32). `ainext_maint` is
!! BYPASSRLS: it reads every student's rows, and it is never given to the app.
REMEDY
  exit 1
fi

# 3c. The newest migration really landed. `course_availability` (023) and
# `students.design_variant` (024) are the two objects the current app reads on
# the first page render, so their absence is an immediate 500 rather than a
# latent one. `student_progress` (028) is read by the same first render of
# /student, and `attempts.retry_of_attempt_id` (027) is named by the attempt
# INSERT the moment Socratic probing is switched on. This is a canary, not an
# inventory: add to it only when a migration adds something the app cannot
# start without.
say "checking the newest objects (023, 024, 027, 028)"
$PSQL <<'SQL'
DO $check$
BEGIN
  IF to_regclass('public.course_availability') IS NULL THEN
    RAISE EXCEPTION 'course_availability is missing — migration 023 did not land';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'students'
       AND column_name = 'design_variant'
  ) THEN
    RAISE EXCEPTION 'students.design_variant is missing — migration 024 did not land';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'attempts'
       AND column_name = 'retry_of_attempt_id'
  ) THEN
    RAISE EXCEPTION 'attempts.retry_of_attempt_id is missing — migration 027 did not land';
  END IF;
  IF to_regclass('public.student_progress') IS NULL THEN
    RAISE EXCEPTION 'student_progress is missing — migration 028 did not land';
  END IF;
END
$check$;
SQL

# 3d. If — and ONLY if — the course gate is switched on for this stack, the
# allow-list must not be empty.
#
# This is the check that makes AINEXT_COURSE_GATING=on a safe thing to turn on.
# `lib/env.ts` defaults the gate OFF and argues the case at length: a forgotten
# variable that defaulted to `on` would be an allow-list nobody had populated
# yet, i.e. every student on the stack locked out of the course they are paying
# to study, on a Sunday evening, with no error message anywhere. That argument is
# correct, and it is an argument about a SILENT failure. Here the failure is not
# silent: the deploy stops before the app starts, and says what to insert. The
# founder's Sunday evening is spent reading a deploy log instead of a support
# thread from a parent.
if [ "$(printf '%s' "${AINEXT_COURSE_GATING:-}" | tr 'A-Z' 'a-z')" = "on" ] \
   || [ "${AINEXT_COURSE_GATING:-}" = "1" ] \
   || [ "$(printf '%s' "${AINEXT_COURSE_GATING:-}" | tr 'A-Z' 'a-z')" = "true" ]; then
  env_tag=${AINEXT_ENVIRONMENT:-mvp1}
  live=$($PSQL --tuples-only --no-align -c \
    "SELECT count(*) FROM course_availability WHERE environment = '$env_tag' AND state = 'live'")
  if [ "$live" = "0" ]; then
    cat >&2 <<REMEDY

!! AINEXT_COURSE_GATING is ON and no course is allow-listed for environment
!! '$env_tag'. Every student on this stack would sign in and be shown nothing.
!!
!! Add at least one rule before deploying — one row per (course, grade):
!!
!!   INSERT INTO course_availability (environment, course_id, grade, state, note)
!!   VALUES ('$env_tag', 'course:prep3-math-en', '9', 'live', 'pilot launch')
!!   ON CONFLICT (environment, course_id, grade) DO UPDATE SET state = 'live';
!!
!! Or set AINEXT_COURSE_GATING=off in deploy/.env, which restores the pre-023
!! behaviour: every student sees every course that is loaded, INCLUDING any whose
!! questions have not been through the review gate.
REMEDY
    exit 1
  fi
  say "course gate ON, $live live rule(s) for '$env_tag'"
else
  say "course gate OFF — every loaded course is visible to every student"
fi

printf '== migrate: done ==\n\n'

#!/usr/bin/env bash
#
# One command to get the MVP 1.0 comparison build running locally.
#
#   ./scripts/local-dev.sh              # set up (if needed) and serve the student surface
#   ./scripts/local-dev.sh --reset      # drop the database and start clean
#   ./scripts/local-dev.sh --no-serve   # prepare everything, don't start the server
#   ./scripts/local-dev.sh --admin      # serve the admin console only, on :3002
#   ./scripts/local-dev.sh --both       # student on :3000 AND console on :3002
#
# Safe to re-run: every step is idempotent and skips work already done.
# This touches ONLY a local database. It cannot reach the box or the baseline.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB=${AINEXT_LOCAL_DB:-ainext_mvp1}
PORT=${AINEXT_LOCAL_PGPORT:-5432}
HOST=${AINEXT_LOCAL_PGHOST:-127.0.0.1}
USER=${AINEXT_LOCAL_PGUSER:-$(whoami)}
RESET=0; SERVE=1; SURFACE=student
for a in "$@"; do
  case "$a" in
    --reset) RESET=1 ;;
    --no-serve) SERVE=0 ;;
    --admin) SURFACE=admin ;;
    --both) SURFACE=both ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

# The three database roles ADR-0012 creates (migration 017), and the DSNs that
# use them. LOCAL DEV PASSWORDS ONLY — each equals its role name, set below on
# every run. The box gets real ones from deploy/.env; nothing here ever reaches it.
APP_DSN="postgres://ainext_app:ainext_app@$HOST:$PORT/$DB"
OPERATOR_DSN="postgres://ainext_operator:ainext_operator@$HOST:$PORT/$DB"
MAINT_DSN="postgres://ainext_maint:ainext_maint@$HOST:$PORT/$DB"
PUBLIC_URL=${AINEXT_PUBLIC_URL:-http://localhost:3000}
CONSOLE_URL=${AINEXT_CONSOLE_URL:-http://localhost:3002}
BOOTSTRAP_EMAIL=${AINEXT_BOOTSTRAP_OPERATOR_EMAIL:-samuel.s.toma@gmail.com}

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

PSQL="psql -h $HOST -p $PORT -U $USER"

# --------------------------------------------------------------- 0. preflight
say "0/8  Prerequisites"

command -v node >/dev/null || die "node not found. Install Node 20+ (macOS: brew install node)"
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 20 ] || die "Node $NODE_MAJOR found; Next 16 needs Node 20+ (macOS: brew install node)"
ok "node $(node -v)"
command -v npm >/dev/null || die "npm not found"

# The extraction pipeline needs pydantic + psycopg. `uv` reads them straight from
# services/extraction/pyproject.toml and manages its own environment, so it is
# the path of least friction; a venv is the fallback when uv is absent.
PYRUN=""
if command -v uv >/dev/null; then
  PYRUN="uv run"
  ok "uv $(uv --version 2>/dev/null | awk '{print $2}') — Python deps handled automatically"
else
  VENV="$ROOT/services/extraction/.venv"
  if [ ! -x "$VENV/bin/python" ]; then
    warn "uv not found — creating a virtualenv instead (install uv to skip this: brew install uv)"
    python3 -m venv "$VENV" || die "could not create a virtualenv; install uv (brew install uv)"
    "$VENV/bin/pip" install --quiet --upgrade pip
    "$VENV/bin/pip" install --quiet "pydantic>=2.7" "psycopg[binary]>=3.2" \
      || die "could not install pydantic/psycopg into $VENV"
    ok "created $VENV with pydantic + psycopg"
  else
    ok "using existing virtualenv $VENV"
  fi
  PYRUN="$VENV/bin/python"
fi

# The `claude` CLI is only needed for lesson and chat turns — it runs on YOUR
# Claude subscription, no API key. Everything else works without it, so this is
# a warning rather than a failure.
if command -v claude >/dev/null; then
  ok "claude CLI on PATH — lesson/chat turns and upload parsing will use your account"
else
  warn "claude CLI not found — practice, grading, mastery and the dashboard all work;"
  echo "     lesson/chat turns and upload OCR will not. Install Claude Code and run \`claude\` once to log in."
fi

# ---------------------------------------------------------------- 1. postgres
say "1/8  PostgreSQL"
command -v psql >/dev/null || die "psql not found. macOS: brew install postgresql@17 && brew services start postgresql@17"
if ! $PSQL -d postgres -tc 'select 1' >/dev/null 2>&1; then
  warn "cannot connect to $HOST:$PORT as $USER"
  echo "     macOS:  brew services start postgresql@17"
  echo "     Linux:  sudo systemctl start postgresql"
  echo "     Docker: docker run -d --name ainext-pg -e POSTGRES_USER=$USER \\"
  echo "               -e POSTGRES_HOST_AUTH_METHOD=trust -p $PORT:5432 postgres:17"
  die "no database server"
fi
ok "connected to $HOST:$PORT as $USER"

if [ "$RESET" = 1 ]; then
  $PSQL -d postgres -q -c "DROP DATABASE IF EXISTS $DB;" && ok "dropped $DB"
fi
if ! $PSQL -d postgres -tAc "select 1 from pg_database where datname='$DB'" | grep -q 1; then
  $PSQL -d postgres -q -c "CREATE DATABASE $DB;"; ok "created $DB"
else
  ok "$DB exists"
fi

# --------------------------------------------------------------- 2. migrations
say "2/8  Schema and migrations"
DBQ="$PSQL -d $DB -v ON_ERROR_STOP=1 -q"
if $PSQL -d $DB -tAc "select to_regclass('public.graph_nodes')" | grep -q graph_nodes; then
  ok "schema already applied"
else
  $DBQ -f "$ROOT/db/schema.sql"; ok "schema.sql"
fi
for m in "$ROOT"/db/migrations/*.sql; do
  # every migration in this repo is idempotent by construction
  $DBQ -f "$m" >/dev/null && ok "$(basename "$m")"
done

# Migration 017 creates ainext_app / ainext_operator / ainext_maint and sets NO
# password — a migration that set one would put a known credential in git. These
# are DEV passwords, equal to the role name, and they exist only on this laptop.
# Re-set on every run so a rotated local password cannot strand the dev server.
for role in ainext_app ainext_operator ainext_maint; do
  $PSQL -d "$DB" -q -c "ALTER ROLE $role PASSWORD '$role';"
done
ok "dev passwords set on the three database roles (local only)"

# ------------------------------------------------------------------ 3. content
say "3/8  Curriculum content"
#
# ALL THREE BOOKS, not just the maths one.
#
# This step loaded `--course course:prep3-math-en` and nothing else from the
# branch split until 2026-09-21. That was right while the product was
# maths-only, and wrong the moment the console could decide which courses a
# student sees: an operator cannot toggle a course the database has never
# heard of, so Social Studies and Arabic showed as "0 objectives loaded" and
# the whole catalogue looked like a product that had dropped two subjects.
# Nothing had been dropped — the bundles, the ADRs and the loader's own
# support for all three were in the tree the entire time. Only this line was
# narrow.
#
# Loading a course is not the same as showing it. `course_availability`
# decides who sees what (migration 023), and a freshly loaded course stays
# hidden until somebody sets it live for a grade. So this is safe to widen:
# it puts the content within reach of the console, and changes nothing about
# what any student sees.
#
# WHY SOCIAL STUDIES TAKES TWO PASSES. `social-t1.json` names its source book
# with `source_file` but does not define it; `social-skeleton.json` does, and
# a scoped load excludes the skeleton because social-t1 supersedes it
# (SUPERSEDED_BY in load_seed.py). Loading the skeleton first registers the
# `source_documents` row, and the real bundle then replaces its 44 questions
# with the 762 that supersede them while the book row survives — a course
# subtree delete does not touch source documents. Arabic needs no such dance:
# `arabic-t1.json` defines its own book.
#
# The review gate still governs what is servable. Arabic lands ~297 questions
# at `review` because the sacred-content gate (ADR-0006) holds every Quran and
# hadith passage for a human; those are NOT promoted below, and must not be.
load_course() { # <course-id> [bundle…]
  local course="$1"; shift
  ( cd "$ROOT/services/extraction" \
    && AINEXT_DB_DSN="host=$HOST port=$PORT dbname=$DB user=$USER" \
       AINEXT_ENVIRONMENT="${AINEXT_ENVIRONMENT:-mvp1}" \
       $PYRUN load_seed.py "${@:---all}" --course "$course" ) \
    || die "content load failed for $course"
}

COURSES_LOADED=$($PSQL -d $DB -tAc \
  "select count(*) from graph_nodes where kind='course'" 2>/dev/null || echo 0)
if [ "$COURSES_LOADED" -ge 3 ]; then
  ok "$COURSES_LOADED course(s) already loaded"
else
  load_course course:prep3-math-en
  load_course course:prep3-arabic-ar
  load_course course:prep3-social-ar seed/social-skeleton.json   # registers the book
  load_course course:prep3-social-ar                             # …then supersedes it
  ok "loaded mathematics, arabic and social studies"
fi

# A scoped load demotes Unit 1's bulk-promoted questions back to 'review'.
# Locally that is just noise, so promote them and let the parity check pass.
#
# SCOPED TO THE BOOK, and the scope is load-bearing twice over. Promoting
# everything would stamp generated and widget questions `reviewed_by='local-dev'`
# — a surface asserting a human review that never happened, which FR-1110
# forbids outright. It would also try to promote a materialised inline widget,
# which the database refuses by CHECK (ADR-0009 §3). Generated content arrives
# below carrying the status and review stamp it actually has.
#
# SCOPED TO MATHEMATICS TOO, since 2026-09-21. This statement predates the
# other two books and used to see only maths, so `source in ('seed','authored')`
# WAS "the maths book". The moment Arabic and Social Studies load it stops
# being that: they land 576 questions at `review`, and 297 of the Arabic ones
# are held by the SACRED-CONTENT GATE (ADR-0006) — every Quran passage and
# every hadith whose book transcript no online authority could confirm, held
# for the named religious-content owner to check against a printed مصدر.
# Promoting those here would stamp `reviewed_by='local-dev'` on scripture no
# human has read, assert a review that did not happen (FR-1110), and serve it
# to a student. A local convenience must not be able to do that, so the
# statement now names the course it was always about.
PROMOTED=$($PSQL -d $DB -tAc "with p as (update questions q set status='live', reviewed_by='local-dev', reviewed_at=now() where q.status<>'live' and q.source in ('seed','authored') and exists (select 1 from node_subject ns where ns.node_id = q.lo_id and ns.course_id = 'course:prep3-math-en') returning 1) select count(*) from p")
[ "$PROMOTED" -gt 0 ] && ok "promoted $PROMOTED book question(s) to live" || ok "all book questions live"

# ----------------------------------------------------- 3b. generated content
# The misconception catalogue, the generated question bank and the widget bank
# (ADR-0008, ADR-0009). These are EXPORTS of the state that was generated,
# reviewed and served — not fresh generations — so they replay with --restore,
# which honours the review stamps each row carries. A plain load would force
# them all to unreviewed and quietly discard the human sample.
#
# Order matters: the catalogue first, or every distractor that names a real
# entry is reported as unknown (the loader refuses rather than guess).
GEN_DSN="host=$HOST port=$PORT dbname=$DB user=$USER"
# The catalogue is synced on EVERY run, as the deploy does: the loader is
# idempotent, and a fix to the catalogue (an explanation written, a duplicate
# folded in through `aliases`) should reach every laptop, not only fresh ones.
( cd "$ROOT/services/extraction" \
  && AINEXT_ENVIRONMENT=mvp1 $PYRUN load_misconceptions.py seed/generated/misconceptions.json --dsn "$GEN_DSN" ) \
  || die "misconception load failed"
ok "$($PSQL -d $DB -tAc "select count(*) from misconceptions") misconceptions in the catalogue"

GEN_COUNT=$($PSQL -d $DB -tAc "select count(*) from questions where source='variant'" 2>/dev/null || echo 0)
if [ "$GEN_COUNT" -ge 590 ]; then
  ok "$GEN_COUNT generated question(s) already loaded"
else
  for bundle in generated-questions.json widget-questions.json; do
    ( cd "$ROOT/services/extraction" \
      && AINEXT_ENVIRONMENT=mvp1 $PYRUN load_generated_questions.py "seed/generated/$bundle" \
           --dsn "$GEN_DSN" --restore --sample 0 ) \
      || die "$bundle restore failed"
  done
fi
TOTAL=$($PSQL -d $DB -tAc "select count(*) from questions where status='live'")
UNREVIEWED=$($PSQL -d $DB -tAc "select count(*) from questions where status='live' and source='variant' and reviewed_by is null")
ok "$TOTAL live questions, $UNREVIEWED of them generated and unreviewed"

# ------------------------------------------------------- 3c. a demo student
# WITHOUT THIS THE FIRST ANSWER 500s. `attempts.student_id` is a foreign key,
# and the demo-identity resolver falls back to whichever student exists — but
# on a brand-new database none does, so the insert violates the constraint and
# the app returns a bare "internal error" that says nothing about the cause.
# It cost a while to diagnose once; it should never cost anyone that again.
#
# The "(demo)" suffix is load-bearing: make-seed-dump.sh refuses to ship a
# database holding any student whose name lacks it, which is what keeps real
# pilot children — minors — out of git.
STUDENTS=$($PSQL -d $DB -tAc "select count(*) from students")
if [ "$STUDENTS" -eq 0 ]; then
  $PSQL -d $DB -qc "insert into students (display_name, grade, interests, language_pref, curriculum_system)
                    values ('Omar (demo)', '9', '{football,space}', 'en', 'eg-national-en')"
  ok "created the synthetic demo student"
else
  ok "$STUDENTS student(s) already present"
fi

# ------------------------------------------------------------------- 4. parity
say "4/8  Content parity"
# Same runner as the loader: bare python3 would not have psycopg and the check
# would fail for a reason that has nothing to do with parity.
( cd "$ROOT/services/extraction" \
  && $PYRUN parity_check.py --candidate "host=$HOST port=$PORT dbname=$DB user=$USER" \
     | sed 's/^/  /' ) || warn "parity RED — see above"

# ---------------------------------------------------------------------- 5. app
say "5/8  App configuration"
ENVF="$ROOT/app/.env.local"
touch "$ENVF"

# An existing .env.local is UPGRADED, never clobbered: missing keys are
# appended, values already there are left exactly as you set them. The one
# exception is DATABASE_URL, below, and it says why.
env_value() { sed -n "s/^$1=//p" "$ENVF" | tail -1; }
env_add() {   # key value comment…
  local k=$1 v=$2; shift 2
  if grep -q "^$k=" "$ENVF"; then return 0; fi
  if [ "$#" -gt 0 ]; then printf '\n' >> "$ENVF"; printf '# %s\n' "$@" >> "$ENVF"; fi
  printf '%s=%s\n' "$k" "$v" >> "$ENVF"
  ADDED="$ADDED $k"
}
env_replace() {
  local k=$1 v=$2 tmp; tmp=$(mktemp)
  grep -v "^$k=" "$ENVF" > "$tmp" || true
  printf '%s=%s\n' "$k" "$v" >> "$tmp"
  mv "$tmp" "$ENVF"
}
ADDED=""

# THE REPOINT (ADR-0012). The app must connect as `ainext_app` — a non-superuser,
# non-owner role — or migration 017's policies apply to nothing and every
# isolation test passes for the wrong reason. A .env.local written before this
# release points DATABASE_URL at $USER, a superuser, so this one value is
# rewritten rather than preserved.
CURRENT_DSN=$(env_value DATABASE_URL)
if [ "$CURRENT_DSN" != "$APP_DSN" ]; then
  env_replace DATABASE_URL "$APP_DSN"
  if [ -n "$CURRENT_DSN" ]; then
    warn "repointed DATABASE_URL at ainext_app (was: $CURRENT_DSN)"
    echo "     Row-level security does not apply to a superuser connection, so the"
    echo "     old value would have left every policy in migration 017 inert."
  else
    ok "DATABASE_URL -> ainext_app"
  fi
else
  ok "DATABASE_URL already points at ainext_app"
fi

env_add AINEXT_ENVIRONMENT mvp1 \
  "Tags every analytics row and cost record. Unset would default to 'baseline'," \
  "which would file your local experiments under the frozen environment."
env_add DATABASE_URL_OPERATOR "$OPERATOR_DSN" \
  "The console's connection (P2). Cross-student reads by grant, no bypass."
env_add DATABASE_URL_MAINT "$MAINT_DSN" \
  "BYPASSRLS. Loaders, backfills, rollups and scripts only — never the app."
env_add AINEXT_COURSE_GATING on \
  "The per-(course, grade) availability gate (migration 023). ON here so local" \
  "development exercises the real path; the code's own default when the" \
  "variable is ABSENT is OFF, deliberately, so a stack that never set it cannot" \
  "lock every student out of their own course. See app/src/lib/env.ts."

# Generated ONCE and then left alone: regenerating it on every run would
# invalidate every session you were in the middle of testing.
if [ -z "$(env_value AINEXT_AUTH_SECRET)" ]; then
  SECRET=$(openssl rand -hex 32 2>/dev/null \
           || node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')
  env_add AINEXT_AUTH_SECRET "$SECRET" \
    "HS256 signing key for the access token. Generated once, local only."
fi

env_add AINEXT_MAIL_TRANSPORT console \
  "No mail server on a laptop: verification and reset links are printed to the" \
  "dev-server log and written under app/.local-mail/."
env_add AINEXT_PUBLIC_URL "$PUBLIC_URL" "Absolute origin for the links in that mail."
env_add AINEXT_CONSOLE_URL "$CONSOLE_URL" \
  "The console's own origin, for operator mail. Configured, never taken from the" \
  "request: a reset link built from a client-supplied Host is reset poisoning."
env_add AINEXT_BOOTSTRAP_OPERATOR_EMAIL "$BOOTSTRAP_EMAIL" \
  "The first operator (ADR-0014). Seeded with all four roles and NO password;" \
  "you get one through the ordinary reset flow."
env_add AINEXT_DEV_OPERATOR_PICKER on \
  "!!! LOCAL DEVELOPMENT ONLY — NEVER SET THIS ON ANY DEPLOYED STACK !!!" \
  "ON shows 'Sign in as <operator>' on the console's /signin at :3002 and" \
  "signs you in as ANY operator with NO password (ADR-0022). It stands in for" \
  "Cloudflare Access, which proves who you are in production and is absent" \
  "here. Three locks: NODE_ENV is not production (the endpoint is not even" \
  "compiled into 'next build'), this is exactly 'on', and the request is to this" \
  "machine — which is only TRUE because this script starts the console with" \
  "-H 127.0.0.1 while this line exists. Starting it by hand? Add '-- -H 127.0.0.1'." \
  "Remove the line to use the password form (and to reach :3002 from another device)."

[ -n "$ADDED" ] && ok "app/.env.local updated:$ADDED" || ok "app/.env.local already complete"

if [ -d "$ROOT/app/node_modules" ]; then ok "dependencies present"
else ( cd "$ROOT/app" && npm install ) >/dev/null && ok "npm install"; fi

# ------------------------------------------------------ 6. accounts and roles
say "6/8  Accounts, the first operator, and the demo cast"

# Both scripts run under the MAINTENANCE DSN, deliberately. They write
# `operators` and `accounts` rows that `ainext_app` has no business creating —
# the bootstrap has no grant on `operators` at all — and a seed that had to be
# reachable from the application role would mean loosening a policy to make a
# convenience work.
# Anything after the label is passed through to the script itself (the cost
# rollup takes --all on a first setup).
run_app_script() {
  local f="$1" label="$2"; shift 2
  if [ ! -f "$ROOT/app/scripts/$f" ]; then
    warn "app/scripts/$f not present yet — skipping $label"
    return 1
  fi
  ( cd "$ROOT/app" \
    && DATABASE_URL="$MAINT_DSN" DATABASE_URL_MAINT="$MAINT_DSN" \
       AINEXT_ENVIRONMENT=mvp1 AINEXT_PUBLIC_URL="$PUBLIC_URL" \
       AINEXT_BOOTSTRAP_OPERATOR_EMAIL="$BOOTSTRAP_EMAIL" \
       node --import ./scripts/ts-resolver.mjs "scripts/$f" "$@" 2>&1 | sed 's/^/     /' ) \
    || { warn "$label failed — see above"; return 1; }
  ok "$label"
}

run_app_script bootstrap-operator.mts "first operator ($BOOTSTRAP_EMAIL, five roles, no password)" || true

# ORDER IS LOAD-BEARING: seed first, retire second.
#
# A10 retires the picker-era cast — `status='legacy'`, no account — and RLS then
# does the rest for free: a row with no account_id is matched by no student
# principal, so it is unreachable from every student surface while staying fully
# visible to the console. Nothing is deleted (FR-2014).
#
# But 'Omar (demo)' is the student every local lesson has been run against, and
# retiring him before the seed script binds an account to him would leave this
# laptop with no student anyone can sign in as. So the seed runs first and the
# retirement skips him, because by then he HAS an account.
SEEDED=0
if run_app_script seed-local-account.mts "local test account bound to 'Omar (demo)'"; then
  SEEDED=1
fi

# The invariant both halves enforce: status='legacy' EXACTLY WHEN there is no
# account. The second half matters more than it looks — it repairs a laptop
# where the retirement ran before the seed script existed, so re-running this
# script after the seed lands brings 'Omar (demo)' back rather than stranding
# him, and a student who signs up is never left marked as picker-era.
REVIVED=$($PSQL -d $DB -tAc "with r as (update students set status='active' where account_id is not null and status='legacy' returning 1) select count(*) from r")
[ "$REVIVED" -gt 0 ] && ok "$REVIVED student(s) with an account restored to status='active'" || true

RETIRED=$($PSQL -d $DB -tAc "with r as (update students set status='legacy' where account_id is null and status='active' returning 1) select count(*) from r")
if [ "$RETIRED" -gt 0 ]; then
  ok "retired $RETIRED picker-era student(s) to status='legacy' (history intact)"
fi
if [ "$SEEDED" = 0 ]; then
  warn "no local account exists yet: every student row is now 'legacy' and"
  echo "     unreachable from the student surface. Re-run this script once"
  echo "     app/scripts/seed-local-account.mts lands — it is idempotent."
fi

# ------------------------------------------------------- 6b. the cost rollup
# `cost_daily` is the per-student cost series the console draws (plan A7). It
# holds CLOSED days only — today is always answered by a live query — so this
# run is what gives a fresh laptop a populated table instead of a flat chart
# and a "rollup behind" banner.
#
# ON A BOX THIS IS A NIGHTLY CRON JOB, a little after midnight UTC:
#
#   cd /opt/reletix/AI.NEXT/app && npm run rollup:cost
#
# There is no scheduler in this repo, deliberately — one job does not earn one,
# and the console degrades honestly without it: the totals come from the ledger
# and stay right, and the page says how far behind the daily lines are.
#
# `--all` here and not in the cron job: a laptop restored from a seed dump has
# history older than the seven days a bare run covers, and setup happens once.
say "6b/8  Cost rollup"
run_app_script rollup-cost-daily.mts "cost_daily refreshed for closed days" --all || true

# ------------------------------------------------------ 6c. the alert sweep
# The five security alert rules (contracts/admin.md §7, ADR-0016 §6). Run once
# here for the same reason the cost rollup is: a laptop that has never run the
# sweep is a laptop where "the sweep runs" is an untested claim, and the first
# place to find out is the box.
#
# ON A BOX THIS IS A CRON JOB, every five minutes:
#
#   0,5,10,...,55 * * * *  cd /opt/reletix/AI.NEXT/app && npm run alerts:sweep
#
# (the header of app/scripts/alerts-sweep.mts carries the full crontab line.)
#
# It does NOT gate SC-105: the console's Security view reads `auth_events` live
# and un-cached, so an attempt is visible within a minute whether or not this
# has ever run. What the sweep adds is the push half — and with
# AINEXT_ALERT_EMAIL unset, as it is locally, it prints its alerts instead of
# mailing them, which is the honest local behaviour rather than a silent no-op.
say "6c/8  Security alert sweep"
run_app_script alerts-sweep.mts "security alert rules evaluated (idempotent; logs locally)" || true

# ---------------------------------------------------------- 6d. runtime probe
# "Can the tutor teach?", asked once, here, for the reason the sweep is here: a
# laptop that has never run the probe is a laptop where "the probe runs" is an
# untested claim — and the first place to find out otherwise would be the box,
# which is exactly how a lapsed sign-in went unnoticed for seven weeks
# (migration 026, FR-3001).
#
# ON A BOX THIS IS A CRON JOB, every FIFTEEN minutes — not five like the sweep:
#
#   0,15,30,45 * * * *  cd /opt/reletix/AI.NEXT/app && npm run probe:runtime
#
# (the header of app/scripts/probe-runtime.mts carries the full crontab line and
# argues the cadence.) The difference is cost: this one makes a real model call
# on Samuel's subscription every time it runs, where the sweep only reads rows.
#
# **This spends money, so it is the one step allowed to be skipped.** If the
# local CLI is not signed in, or somebody is offline, it records a failure
# rather than failing the setup — which is the correct behaviour and is also
# exactly what the console is then supposed to show.
say "6d/8  Runtime probe (one real model call)"
run_app_script probe-runtime.mts "runtime health recorded (see /security in the console)" || true

# -------------------------------------------------------------------- 7. serve
say "7/8  Ready"
STUDENTS=$($PSQL -d $DB -tAc "select count(*) from students")
ACTIVE=$($PSQL -d $DB -tAc "select count(*) from students where status='active'")
cat <<INFO
  database   $DB on $HOST:$PORT  (app connects as ainext_app — RLS applies)
  questions  $($PSQL -d $DB -tAc "select count(*) from questions where status='live'") live
  students   $STUDENTS ($ACTIVE with an account, the rest retired to 'legacy')

  Try:
    open http://localhost:3000/signin       sign in (the seed script prints the credentials)
    open http://localhost:3000/spine        the curriculum graph
    open http://localhost:3002/             the admin console (--admin or --both)

  Prove the build split (ADR-0014, FR-2201) — the console's routes are not in
  the student build at all, which is a fact about the artefact:
    cd app && npm run build && npm run check:surface
    cd app && npm run build:admin && npm run check:surface:admin

  Prove the isolation (ADR-0012) — as ainext_app, NOT as yourself:
    psql "$APP_DSN" -f app/scripts/rls-proof.sql

  Watch the model learn (BKT):
    psql -d $DB -c "SELECT round(score::numeric,4) AS mastery, \\
      evidence->>'observation' AS obs, system_to IS NULL AS current \\
      FROM mastery ORDER BY system_from DESC LIMIT 10;"

  Lesson and chat turns need the \`claude\` CLI logged in; everything else
  (practice, grading, mastery, dashboard) works without it.
INFO

# The console is a second build target (ADR-0014, research R10): one database,
# one command, two ports. Since P2, AINEXT_SURFACE bites — it selects the
# pageExtensions that decide which files are routes, and the distDir the build
# lands in (`.next` vs `.next-admin`).
#
# TWO `next dev` SERVERS AT ONCE: yes, and here is why, because R10 flagged it
# as unverified. Next 16 takes a dev lock at **<distDir>/dev/lock**, not at the
# project directory — measured, 2026-09-20: the console holds
# `.next-admin/dev/lock` and the student build holds `.next/dev/lock`, both
# carrying their own pid and port, and neither refuses the other. Because the
# surfaces already need different distDirs so their BUILDS do not clobber each
# other, the locks are different files for free. So `--both` is dev + dev, with
# hot reload on both surfaces, and the `next build && next start` fallback R10
# named for the console is not needed.
#
# THE CONSOLE LISTENS ON 127.0.0.1 WHENEVER THE DEV OPERATOR PICKER IS SET
# (ADR-0022, FR-3309). The picker signs you in as ANY operator with no
# credential, and its "the request is to this machine" lock can only read
# headers — Host, Origin, X-Forwarded-For — every one of which a client writes.
# `next dev` listens on every interface (0.0.0.0) by default, so without this
# bind anyone on the same Wi-Fi could send `Host: localhost` and be any
# operator. With it, nothing off this machine can open a connection at all.
# ANY non-empty value of the flag binds, not only `on`: being stricter than the
# picker costs nothing. The price is that the console is not reachable from
# another device (the iPad path) while the picker is set — remove the line from
# app/.env.local for that.
picker_flag_set() {
  [ -n "${AINEXT_DEV_OPERATOR_PICKER:-}" ] && return 0
  # Every file Next loads in development, not only .env.local. One at a time:
  # BSD grep exits 2 over a missing file even when another one matched.
  local f
  for f in "$ROOT/app/.env" "$ROOT/app/.env.local" \
           "$ROOT/app/.env.development" "$ROOT/app/.env.development.local"; do
    [ -f "$f" ] && grep -qE '^[[:space:]]*(export[[:space:]]+)?AINEXT_DEV_OPERATOR_PICKER=[^[:space:]#]' "$f" && return 0
  done
  return 1
}
serve_student() { NEXT_TELEMETRY_DISABLED=1 npm run dev; }
serve_admin()   {
  if picker_flag_set; then
    ok "dev operator picker is set: the console listens on 127.0.0.1 only (FR-3309)"
    AINEXT_SURFACE=admin PORT=3002 NEXT_TELEMETRY_DISABLED=1 npm run dev -- -H 127.0.0.1
  else
    AINEXT_SURFACE=admin PORT=3002 NEXT_TELEMETRY_DISABLED=1 npm run dev
  fi
}

if [ "$SERVE" = 1 ]; then
  cd "$ROOT/app"
  case "$SURFACE" in
    student) say "Starting the student surface on :3000 — Ctrl-C to stop"; serve_student ;;
    admin)   say "Starting the admin console on :3002 — Ctrl-C to stop";   serve_admin ;;
    both)
      say "Starting student (:3000) and console (:3002) — Ctrl-C stops both"
      serve_student &
      STUDENT_PID=$!
      # One trap for both, so Ctrl-C never leaves a server holding :3000.
      trap 'kill "$STUDENT_PID" 2>/dev/null || true' EXIT INT TERM
      serve_admin
      ;;
  esac
else
  echo "  (--no-serve: start it yourself with  cd app && npm run dev"
  echo "   — and the console, while the dev operator picker is set, with"
  echo "   cd app && AINEXT_SURFACE=admin PORT=3002 npm run dev -- -H 127.0.0.1 )"
fi

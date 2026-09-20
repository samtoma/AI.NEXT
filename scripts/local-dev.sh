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
LOADED=$($PSQL -d $DB -tAc "select count(*) from questions" 2>/dev/null || echo 0)
if [ "$LOADED" -ge 450 ]; then
  ok "$LOADED questions already loaded"
else
  ( cd "$ROOT/services/extraction" \
    && AINEXT_DB_DSN="host=$HOST port=$PORT dbname=$DB user=$USER" \
       $PYRUN load_seed.py --all --course course:prep3-math-en ) \
    || die "content load failed"
  ok "loaded"
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
PROMOTED=$($PSQL -d $DB -tAc "with p as (update questions set status='live', reviewed_by='local-dev', reviewed_at=now() where status<>'live' and source in ('seed','authored') returning 1) select count(*) from p")
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
MC_COUNT=$($PSQL -d $DB -tAc "select count(*) from misconceptions" 2>/dev/null || echo 0)
if [ "$MC_COUNT" -ge 90 ]; then
  ok "$MC_COUNT misconceptions already loaded"
else
  ( cd "$ROOT/services/extraction" \
    && AINEXT_ENVIRONMENT=mvp1 $PYRUN load_misconceptions.py seed/generated/misconceptions.json --dsn "$GEN_DSN" ) \
    || die "misconception load failed"
fi

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
env_add AINEXT_BOOTSTRAP_OPERATOR_EMAIL "$BOOTSTRAP_EMAIL" \
  "The first operator (ADR-0014). Seeded with all four roles and NO password;" \
  "you get one through the ordinary reset flow."

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
run_app_script() {
  local f="$1" label="$2"
  if [ ! -f "$ROOT/app/scripts/$f" ]; then
    warn "app/scripts/$f not present yet — skipping $label"
    return 1
  fi
  ( cd "$ROOT/app" \
    && DATABASE_URL="$MAINT_DSN" DATABASE_URL_MAINT="$MAINT_DSN" \
       AINEXT_ENVIRONMENT=mvp1 AINEXT_PUBLIC_URL="$PUBLIC_URL" \
       AINEXT_BOOTSTRAP_OPERATOR_EMAIL="$BOOTSTRAP_EMAIL" \
       node --import ./scripts/ts-resolver.mjs "scripts/$f" 2>&1 | sed 's/^/     /' ) \
    || { warn "$label failed — see above"; return 1; }
  ok "$label"
}

run_app_script bootstrap-operator.mts "first operator ($BOOTSTRAP_EMAIL, four roles, no password)" || true

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
# one command, two ports. AINEXT_SURFACE only bites once P2 lands the
# pageExtensions/distDir split — until then --admin is an ordinary dev server
# on :3002, which is harmless and keeps the flag honest from the start.
serve_student() { NEXT_TELEMETRY_DISABLED=1 npm run dev; }
serve_admin()   { AINEXT_SURFACE=admin PORT=3002 NEXT_TELEMETRY_DISABLED=1 npm run dev; }

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
  echo "  (--no-serve: start it yourself with  cd app && npm run dev)"
fi

#!/usr/bin/env bash
#
# One command to get the MVP 1.0 comparison build running locally.
#
#   ./scripts/local-dev.sh              # set up (if needed) and serve
#   ./scripts/local-dev.sh --reset      # drop the database and start clean
#   ./scripts/local-dev.sh --no-serve   # prepare everything, don't start the server
#
# Safe to re-run: every step is idempotent and skips work already done.
# This touches ONLY a local database. It cannot reach the box or the baseline.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB=${AINEXT_LOCAL_DB:-ainext_mvp1}
PORT=${AINEXT_LOCAL_PGPORT:-5432}
HOST=${AINEXT_LOCAL_PGHOST:-127.0.0.1}
USER=${AINEXT_LOCAL_PGUSER:-$(whoami)}
RESET=0; SERVE=1
for a in "$@"; do
  case "$a" in
    --reset) RESET=1 ;;
    --no-serve) SERVE=0 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

PSQL="psql -h $HOST -p $PORT -U $USER"

# ---------------------------------------------------------------- 1. postgres
say "1/6  PostgreSQL"
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
say "2/6  Schema and migrations"
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

# ------------------------------------------------------------------ 3. content
say "3/6  Curriculum content"
LOADED=$($PSQL -d $DB -tAc "select count(*) from questions" 2>/dev/null || echo 0)
if [ "$LOADED" -ge 450 ]; then
  ok "$LOADED questions already loaded"
else
  command -v uv >/dev/null && RUN="uv run" || RUN="python3"
  ( cd "$ROOT/services/extraction" \
    && AINEXT_DB_DSN="host=$HOST port=$PORT dbname=$DB user=$USER" \
       $RUN load_seed.py --all --course course:prep3-math-en ) \
    || die "content load failed"
  ok "loaded"
fi

# A scoped load demotes Unit 1's bulk-promoted questions back to 'review'.
# Locally that is just noise, so promote them and let the parity check pass.
# -tAc + `wc -l` over-counts by one on psql's trailing newline; ask the server
# for the row count instead of counting lines.
PROMOTED=$($PSQL -d $DB -tAc "with p as (update questions set status='live', reviewed_by='local-dev', reviewed_at=now() where status<>'live' returning 1) select count(*) from p")
[ "$PROMOTED" -gt 0 ] && ok "promoted $PROMOTED question(s) to live" || ok "all questions live"

# ------------------------------------------------------------------- 4. parity
say "4/6  Content parity"
( cd "$ROOT/services/extraction" \
  && python3 parity_check.py --candidate "host=$HOST port=$PORT dbname=$DB user=$USER" \
     | sed 's/^/  /' ) || warn "parity RED — see above"

# ---------------------------------------------------------------------- 5. app
say "5/6  App configuration"
ENVF="$ROOT/app/.env.local"
if [ -f "$ENVF" ] && grep -q AINEXT_ENVIRONMENT "$ENVF"; then
  ok ".env.local already configured"
else
  cat > "$ENVF" <<ENV
DATABASE_URL=postgres://$USER@$HOST:$PORT/$DB
# Tags every analytics row and cost record. Unset would default to 'baseline',
# which would file your local experiments under the frozen environment.
AINEXT_ENVIRONMENT=mvp1
ENV
  ok "wrote app/.env.local"
fi
if [ -d "$ROOT/app/node_modules" ]; then ok "dependencies present"
else ( cd "$ROOT/app" && npm install ) >/dev/null && ok "npm install"; fi

# -------------------------------------------------------------------- 6. serve
say "6/6  Ready"
STUDENTS=$($PSQL -d $DB -tAc "select count(*) from students")
cat <<INFO
  database   $DB on $HOST:$PORT
  questions  $($PSQL -d $DB -tAc "select count(*) from questions where status='live'") live
  students   $STUDENTS

  Try:
    open http://localhost:3000/student      pick or create a student
    open http://localhost:3000/spine        the curriculum graph

  Watch the model learn (BKT):
    psql -d $DB -c "SELECT round(score::numeric,4) AS mastery, \\
      evidence->>'observation' AS obs, system_to IS NULL AS current \\
      FROM mastery ORDER BY system_from DESC LIMIT 10;"

  Lesson and chat turns need the \`claude\` CLI logged in; everything else
  (student creation, practice, grading, mastery, dashboard) works without it.
INFO

if [ "$SERVE" = 1 ]; then
  say "Starting dev server — Ctrl-C to stop"
  cd "$ROOT/app" && NEXT_TELEMETRY_DISABLED=1 npm run dev
else
  echo "  (--no-serve: start it yourself with  cd app && npm run dev)"
fi

#!/usr/bin/env bash
#
# The whole stack in Docker — nothing needed on the host but Docker itself.
#
#   ./scripts/local-docker.sh            # build, start, load content
#   ./scripts/local-docker.sh --reset    # wipe the database and start clean
#   ./scripts/local-docker.sh --down     # stop (keeps data AND your Claude login)
#   ./scripts/local-docker.sh --login    # log the container's claude CLI into your account
#   ./scripts/local-docker.sh --logs     # follow the app log
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CF="$ROOT/deploy/docker-compose.local.yml"
DC="docker compose -f $CF"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

case "${1:-}" in
  --down)  $DC down; echo "stopped — data and your Claude login are kept (use --reset to wipe)"; exit 0 ;;
  --logs)  $DC logs -f app; exit 0 ;;
  --login) say "Logging the container's claude CLI into your account"
           echo "Follow the OAuth prompt. Credentials persist in the local_claude volume."
           exec $DC exec app claude ;;
  --reset) RESET=1 ;;
  "")      RESET=0 ;;
  -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
  *) die "unknown option: $1" ;;
esac

command -v docker >/dev/null || die "Docker not found — install Docker Desktop"
docker info >/dev/null 2>&1 || die "Docker is installed but not running — start Docker Desktop"
ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo ready)"

if [ "${RESET:-0}" = 1 ]; then
  say "Resetting"
  # -v drops the database AND the Claude login; say so rather than surprising anyone.
  warn "this removes the database and the container's Claude login"
  $DC down -v
  ok "wiped"
fi

say "Building and starting"
$DC up -d --build
ok "containers up"

say "Waiting for the database"
for i in $(seq 1 60); do
  $DC exec -T db pg_isready -U ainext -d ainext_mvp1 >/dev/null 2>&1 && { ok "database ready"; break; }
  sleep 2
  [ "$i" = 60 ] && die "database did not become ready — $DC logs db"
done

say "Curriculum content"
LOADED=$($DC exec -T db psql -U ainext -d ainext_mvp1 -tAc "select count(*) from questions" 2>/dev/null | tr -d '\r' || echo 0)
if [ "${LOADED:-0}" -ge 450 ]; then
  ok "$LOADED questions already loaded"
else
  $DC --profile tools run --rm loader --all --course course:prep3-math-en || die "content load failed"
  ok "loaded"
fi
# A scoped load demotes Unit 1's bulk-promoted questions to 'review'; locally
# that is noise, so promote them and let the parity check pass.
PROMOTED=$($DC exec -T db psql -U ainext -d ainext_mvp1 -tAc \
  "with p as (update questions set status='live', reviewed_by='local-docker', reviewed_at=now() where status<>'live' returning 1) select count(*) from p" | tr -d '\r')
ok "promoted $PROMOTED question(s) to live"

say "Waiting for the app"
for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:3000/ >/dev/null 2>&1 && { ok "app healthy"; break; }
  sleep 2
  [ "$i" = 60 ] && { $DC logs --tail=40 app; die "app did not become healthy"; }
done

# The CLI is bundled in the image but starts logged OUT — it runs on YOUR
# subscription, and only you can authorise it.
say "Claude account"
if $DC exec -T app test -s /repo/.claude/.credentials.json 2>/dev/null \
   || $DC exec -T app sh -c 'ls /repo/.claude/*.json >/dev/null 2>&1'; then
  ok "claude CLI appears logged in — lesson/chat turns and upload OCR will work"
else
  warn "claude CLI is not logged in yet"
  echo "     Run once:  ./scripts/local-docker.sh --login"
  echo "     Until then: practice, grading, mastery and uploads-intake work;"
  echo "     lesson/chat turns and upload OCR do not."
fi

cat <<INFO

$(printf '\033[1mReady\033[0m')
  app        http://localhost:3000
  database   postgres://ainext:localdev@127.0.0.1:55433/ainext_mvp1

  Try:
    http://localhost:3000/student     pick or create a student
    http://localhost:3000/spine       the curriculum graph

  Stop, keeping data and login:   ./scripts/local-docker.sh --down
  Follow the app log:             ./scripts/local-docker.sh --logs
INFO

#!/usr/bin/env bash
# =============================================================================
# AI.Next — get newly extracted content onto the LIVE site, safely.
#
# The deployed Postgres seeds itself from deploy/db/ainext_poc.sql.gz on FIRST
# BOOT ONLY. After that the file is ignored forever, so new content used to
# require `docker compose down -v` — which also destroys the claude_cfg volume
# holding the one-time Claude subscription login. This script is the answer:
# it NEVER touches volumes, so the Claude login is never at risk.
#
# Everything that writes takes a pg_dump backup FIRST and prints the one-line
# command that undoes it. Full runbook: DEPLOY.md -> "Refreshing content".
#
# Shared production box: this touches ONLY the `ainext` compose project. No
# system/image/builder prune, no talent stack, no host ports, no volumes.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # …/deploy
REPO="$(cd "$HERE/.." && pwd)"
BACKUP_DIR="${AINEXT_BACKUP_DIR:-$REPO/backups}"
SEED_DUMP="$HERE/db/ainext_poc.sql.gz"
APP_URL="http://127.0.0.1:3100/"
LAST_BACKUP=""
cd "$HERE"                                             # compose file + .env live here

# Colour only for a human at a terminal — CI logs and the Actions run summary
# stay plain text.
if [ -t 1 ]; then C_B=$'\033[1m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_0=$'\033[0m'
else C_B=""; C_Y=""; C_R=""; C_0=""; fi

say()  { printf '\n%s== %s%s\n' "$C_B" "$*" "$C_0"; }
info() { printf '   %s\n' "$*"; }
warn() { printf '%s   !! %s%s\n' "$C_Y" "$*" "$C_0"; }
die()  { printf '%s\nFAILED: %s%s\n' "$C_R" "$*" "$C_0" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage:  ./refresh-content.sh <mode> [argument]

  status                          what is running, what is in the DB, what backups exist
  preview  course:prep3-social-ar rehearse a refresh against the real DB, then roll back
                                  (writes NOTHING — same checks, same gate, real numbers)
  course   course:prep3-social-ar back up, then replace that course's content
  full-reseed                     back up, then restore deploy/db/ainext_poc.sql.gz whole
  restore  backups/ainext-….sql.gz  roll back to a backup
  backup                          take a backup and stop

Course ids come from the seed bundles: course:prep3-math-en, course:prep3-social-ar.
Nothing here can bulk-approve questions: the review gate stays in force (no --approve-all).
USAGE
  exit "${1:-1}"
}

# --- talking to the stack ----------------------------------------------------
dc() { docker compose "$@"; }

svc_running() {
  local cid; cid="$(dc ps -q "$1" 2>/dev/null || true)"
  [ -n "$cid" ] || return 1
  [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo false)" = "true" ]
}

# psql inside the db container. The password comes from the container's OWN
# environment, so it never appears in a command line, a process list or a CI log.
psql_in() { dc exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 "$@"' -- "$@"; }
dbq()     { psql_in -qAt -U ainext -d ainext_poc -c "$1"; }

preflight() {
  [ -f "$HERE/docker-compose.yml" ] || die "no docker-compose.yml beside this script"
  [ -f "$HERE/.env" ] || die "deploy/.env missing (POSTGRES_PASSWORD). See DEPLOY.md bootstrap step 1."
  docker info >/dev/null 2>&1 || die "cannot talk to Docker as $(id -un)"
  svc_running db || die "the 'db' service is not running. Start the stack: (cd $HERE && docker compose up -d)"
  [ "$(dbq 'SELECT 1' 2>/dev/null || true)" = "1" ] \
    || die "Postgres is up but not answering — check: (cd $HERE && docker compose logs --tail=50 db)"
}

# Schema migrations that content loads DEPEND on, applied idempotently before
# any load (each file is BEGIN…COMMIT and safe to re-run — see their headers).
# Only migrations written to be re-runnable belong in this list; the earlier
# ones (001–006) shipped inside the seed dump and are NOT idempotent.
IDEMPOTENT_MIGRATIONS="007-course-subject-column.sql 008-arabic-question-types.sql"

apply_migrations() {
  local root m
  root="$(cd "$HERE/.." && pwd)"
  for m in $IDEMPOTENT_MIGRATIONS; do
    [ -f "$root/db/migrations/$m" ] || die "missing migration db/migrations/$m"
    info "applying migration $m (idempotent)"
    psql_in -q -U ainext -d ainext_poc < "$root/db/migrations/$m" \
      || die "migration $m failed — nothing was loaded"
  done
}

counts() {
  dbq "SELECT 'nodes='||(SELECT count(*) FROM graph_nodes)
            ||' questions='||(SELECT count(*) FROM questions)
            ||' live='||(SELECT count(*) FROM questions WHERE status='live')
            ||' review='||(SELECT count(*) FROM questions WHERE status='review')
            ||' visuals='||(SELECT count(*) FROM visuals)
            ||' bridges='||(SELECT count(*) FROM graph_edges WHERE edge_type='relates_to')"
}

# --- content that lives in the app IMAGE, not in the database ----------------
# Lesson prose (services/extraction/seed/content/*.json) is COPYed into the image
# at build time and read at request time. A DB refresh alone cannot ship it: new
# lessons would get graph rows and no text. Deploy first, then refresh.
content_drift_check() {
  command -v sha256sum >/dev/null 2>&1 || { info "content-drift check skipped (no sha256sum)"; return 0; }
  svc_running app || { info "content-drift check skipped (app not running)"; return 0; }
  local in_image on_disk
  in_image="$(dc exec -T app sh -c 'cd /repo/services/extraction/seed/content 2>/dev/null && sha256sum *.json 2>/dev/null | sort' || true)"
  on_disk="$(cd "$REPO/services/extraction/seed/content" 2>/dev/null && sha256sum ./*.json 2>/dev/null | sed 's| \./| |' | sort || true)"
  [ -n "$in_image" ] || { info "content-drift check skipped (no content dir in the image)"; return 0; }
  if [ "$in_image" = "$on_disk" ]; then
    info "lesson-content files: running image matches this checkout"
  else
    warn "the RUNNING IMAGE serves different lesson-content files than this checkout."
    warn "Lesson prose lives in the image, not the database. If this refresh adds or changes"
    warn "lessons, DEPLOY FIRST (push to main -> CI/CD), then refresh — otherwise the new"
    warn "objectives render without their text."
    diff <(printf '%s\n' "$in_image") <(printf '%s\n' "$on_disk") | head -12 || true
  fi
}

# --- backups ----------------------------------------------------------------
# --clean --if-exists: the backup restores straight over a populated database,
# which is what makes rollback one command at 2am. Sets LAST_BACKUP.
backup() {
  local label="$1" f
  umask 077
  mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
  f="$BACKUP_DIR/ainext-$(date -u +%Y%m%d-%H%M%SZ)-${label}.sql.gz"
  say "Backing up the database first"
  dc exec -T db sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --clean --if-exists --no-owner --no-privileges -U ainext -d ainext_poc' \
    | gzip -9 > "$f" || die "pg_dump failed — nothing has been changed"
  gzip -t "$f" 2>/dev/null || die "backup $f is not valid gzip — refusing to change anything"
  # Read the tail into a variable first: `… | grep -q` can exit before the
  # upstream finishes, and under `pipefail` that SIGPIPE would look like a
  # corrupt backup. A false alarm here would block a legitimate refresh.
  local last; last="$(gzip -dc "$f" | tail -5)"
  printf '%s' "$last" | grep -q 'PostgreSQL database dump complete' \
    || die "backup $f is truncated (no completion marker) — refusing to change anything"
  chmod 600 "$f"
  LAST_BACKUP="$f"
  info "backup: $f  ($(du -h "$f" | cut -f1))"
  info "this file contains student rows — it stays on the box, 0600, and out of git"
}

list_backups() {
  shopt -s nullglob
  local files=("$BACKUP_DIR"/ainext-*.sql.gz)
  shopt -u nullglob
  if [ "${#files[@]}" -eq 0 ]; then info "no backups yet (in $BACKUP_DIR)"; return 0; fi
  info "${#files[@]} backup(s) in $BACKUP_DIR, $(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1) total. Newest:"
  ls -1t "${files[@]}" | head -5 | sed 's|^|     |' || true   # head closing the pipe is not an error
  [ "${#files[@]}" -gt 20 ] && warn "nothing is ever deleted automatically — prune old ones by hand when you are sure"
  return 0
}

# --- restoring a dump over the live database --------------------------------
restore_dump_file() {
  local f="$1" what="$2"
  [ -f "$f" ] || die "no such dump: $f"
  gzip -t "$f" 2>/dev/null || die "$f is not valid gzip"

  # Stop the app for the duration: it holds a pg connection pool, and pooled
  # connections would break on tables being dropped underneath them.
  say "Stopping the app (volumes — including the Claude login — are NOT touched)"
  dc stop app || true

  # grep -c reads the whole stream, so gzip never takes a SIGPIPE that pipefail
  # would report as "no DROP found". `-m1` here would make the answer a race.
  local drops; drops="$(gzip -dc "$f" | grep -c '^DROP ' || true)"
  if [ "${drops:-0}" -eq 0 ]; then
    info "dump has no DROP statements (first-boot format) — clearing the schema first"
    psql_in -U ainext -d ainext_poc \
      -c "SET lock_timeout='30s'; DROP SCHEMA public CASCADE; CREATE SCHEMA public;" \
      || { dc start app; die "could not clear the schema — app restarted, data untouched"; }
  fi

  say "Restoring $what"
  if ! gzip -dc "$f" | psql_in -q -U ainext -d ainext_poc; then
    dc start app || true
    die "restore FAILED — the database may be half-restored. Re-run:
       $0 restore $f
     or restore the pre-change backup printed above. The app has been restarted."
  fi

  say "Starting the app"
  dc start app
  local i ok=0
  for i in $(seq 1 40); do
    if curl -sSf "$APP_URL" >/dev/null 2>&1; then ok=1; break; fi
    sleep 3
  done
  if [ "$ok" = 1 ]; then
    info "app healthy on :3100"
  else
    warn "app did not answer on :3100 in 2 minutes — check: docker compose logs --tail=100 app"
  fi
  info "now: $(counts)"
}

# --- the loader (scoped, review gate intact) --------------------------------
# Closed surface on purpose: the loader's arguments are built HERE, so
# --approve-all / --demo-student cannot arrive from a workflow input, and a
# hostile "course id" cannot smuggle in a flag.
run_loader() {
  local course="$1" dry="${2:-}"
  [[ "$course" =~ ^course:[a-z0-9-]+$ ]] \
    || die "'$course' is not a course node id (expected e.g. course:prep3-social-ar)"
  say "Building the loader image (deps only; cached after the first time)"
  dc --profile tools build loader
  local args=(--all --course "$course")
  [ "$dry" = "dry" ] && args+=(--dry-run)
  say "Loading $course${dry:+   [DRY RUN — no writes]}"
  info "docker compose run --rm loader ${args[*]}"
  # -T: no pseudo-TTY (the loader reads no input, and CI has no terminal).
  # --no-deps: never let a one-off run recreate the db container on a production
  #            box. preflight already proved db is up and answering.
  dc --profile tools run --rm -T --no-deps loader "${args[@]}"
}

# =============================================================================
MODE="${1:-}"; shift || true
case "$MODE" in

  status)
    preflight
    say "Stack";    dc ps
    say "Database"; info "$(counts)"
    info "courses: $(dbq "SELECT string_agg(id, ', ' ORDER BY id) FROM graph_nodes WHERE kind='course'")"
    say "Content";  content_drift_check
    say "Backups";  list_backups
    ;;

  preview)
    # A truthful rehearsal: the loader runs the WHOLE load against the real
    # database inside a transaction and rolls it back. Same validation, same
    # sacred gate, same live/review split — and zero writes.
    [ $# -ge 1 ] || usage
    preflight
    say "PREVIEW — the database will not be modified (migrations, if any, DO apply)"
    apply_migrations
    info "before: $(counts)"
    content_drift_check
    run_loader "$1" dry
    info "after (must be identical): $(counts)"
    ;;

  course)
    [ $# -ge 1 ] || usage
    preflight
    say "Scoped refresh of $1"
    apply_migrations
    info "before: $(counts)"
    content_drift_check
    backup "course-$(printf '%s' "$1" | tr -c 'a-z0-9' '-')"
    # The loader replaces this course's subtree and reloads it in ONE
    # transaction — readers keep seeing the old content until it commits, so
    # this is safe with the site up. No app restart: every data page is
    # force-dynamic and the pg pool caches no rows.
    if ! run_loader "$1"; then
      warn "the load failed and rolled ITSELF back — the database is exactly as it was"
      die "nothing to undo. Fix the bundle and re-run. (Backup kept: $LAST_BACKUP)"
    fi
    info "after:  $(counts)"
    say "Done — content is live"
    info "questions that landed in 'review' are NOT served to students until a human promotes them"
    info "roll back with:  $0 restore $LAST_BACKUP"
    ;;

  full-reseed)
    preflight
    say "FULL RESEED from deploy/db/ainext_poc.sql.gz"
    warn "This replaces the ENTIRE database — including student attempts and mastery —"
    warn "with the committed seed dump. Volumes are not touched: the Claude login survives."
    info "before: $(counts)"
    backup full-reseed
    restore_dump_file "$SEED_DUMP" "the committed seed dump"
    say "Done"
    info "roll back with:  $0 restore $LAST_BACKUP"
    ;;

  promote-poc)
    # ============================ PoC ONLY ============================
    # Samuel's explicit call (2026-07-30): during the PoC phase every
    # extracted question is servable — he bulk-approves as the product's
    # review authority, exactly like the maths PoC's --approve-all. The
    # promotion is RECORDED (reviewed_by), backed up first, and reversible.
    # The pre-pilot admin review tool replaces this before real students.
    # The loader's sacred-bundle --approve-all refusal and the runtime
    # sacred-containment guard are deliberately untouched.
    preflight
    say "PoC promotion — every 'review' question goes live, attributed to Samuel"
    info "before: $(counts)"
    backup promote-poc
    n=$(dbq "WITH p AS (
               UPDATE questions
                  SET status='live',
                      reviewed_by='samuel (poc bulk promote)',
                      reviewed_at=now()
                WHERE status='review'
               RETURNING 1)
             SELECT count(*) FROM p")
    info "promoted: $n question(s)"
    info "after:  $(counts)"
    say "Done"
    info "roll back with:  $0 restore $LAST_BACKUP"
    ;;

  restore)
    [ $# -ge 1 ] || usage
    preflight
    say "Restoring $1 over the live database"
    info "before: $(counts)"
    restore_dump_file "$1" "$1"
    say "Done"
    ;;

  backup)
    preflight
    backup manual
    ;;

  ""|-h|--help|help) usage 0 ;;
  *) die "unknown mode '$MODE' — run '$0 --help'" ;;
esac

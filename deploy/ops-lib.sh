# shellcheck shell=bash
# =============================================================================
# deploy/ops-lib.sh — what load-course.sh and refresh-content.sh share.
#
# SOURCED, NEVER RUN. The two scripts that change noor's content in production
# use ONE implementation of the things that must never differ between them:
# which stack they talk to, how they reach Postgres, how a backup is taken and
# VERIFIED, and how a backup is restored. Two copies of "take a backup" is how
# one of them ends up not taking one.
#
# THE STACK is noor's (the `mvp1` environment): compose project `ainext-mvp1`,
# `docker-compose.mvp1.yml`, database `ainext_mvp1`, student surface on
# 127.0.0.1:3101, console on 127.0.0.1:3102. The frozen baseline (project
# `ainext`, database `ainext_poc`) is never reachable from here.
#
# The AINEXT_* overrides below exist for ONE purpose: rehearsing these scripts
# on a throwaway stack (a laptop, a scratch box). On the box, leave them unset.
#
# WHO DOES WHAT (least privilege, privacy review F16):
#   * backups, restores, and every read-only gate run as `ainext`, the
#     database owner, INSIDE the db container, with the password taken from
#     that container's own environment — it never appears on a command line,
#     in a process list or in a CI log;
#   * content is written only by the loaders, as `ainext_maint`, through the
#     `loader` service (the one service that has that credential, ADR-0012);
#   * no GitHub secret is read, passed or printed by anything here.
# =============================================================================

# ---- where -------------------------------------------------------------------
# OPS_HERE must be set by the sourcing script: the deploy/ directory.
: "${OPS_HERE:?ops-lib.sh: set OPS_HERE (the deploy/ directory) before sourcing}"
OPS_REPO="$(cd "$OPS_HERE/.." && pwd)"
OPS_PROJECT="${AINEXT_COMPOSE_PROJECT:-ainext-mvp1}"
OPS_FILES="${AINEXT_COMPOSE_FILES:-docker-compose.mvp1.yml}"
OPS_DB="ainext_mvp1"                      # the compose file's POSTGRES_DB; not overridable
OPS_BACKUP_DIR="${AINEXT_BACKUP_DIR:-/opt/reletix/backups/mvp1}"
OPS_APP_PORT="${AINEXT_APP_PORT:-3101}"
OPS_CONSOLE_PORT="${AINEXT_CONSOLE_PORT:-3102}"
OPS_HEALTH_HOST="${AINEXT_HEALTH_HOST:-127.0.0.1}"   # a rehearsal stack only
LAST_BACKUP=""

# ---- output --------------------------------------------------------------------
# Colour only for a human at a terminal; CI logs and run summaries stay plain.
if [ -t 1 ]; then C_B=$'\033[1m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_G=$'\033[32m'; C_0=$'\033[0m'
else C_B=""; C_Y=""; C_R=""; C_G=""; C_0=""; fi
say()  { printf '\n%s== %s%s\n' "$C_B" "$*" "$C_0"; }
info() { printf '   %s\n' "$*"; }
ok()   { printf '   %sOK%s %s\n' "$C_G" "$C_0" "$*"; }
warn() { printf '%s   !! %s%s\n' "$C_Y" "$*" "$C_0"; }
# Exit codes are part of the contract (contracts/load-course.md):
#   1 usage or an unexpected error · 2 a precondition refused, nothing written
#   3 the backup failed or did not verify, nothing written
die()    { printf '%s\nFAILED: %s%s\n' "$C_R" "$*" "$C_0" >&2; exit 1; }
refuse() { printf '%s\nREFUSED: %s%s\n' "$C_R" "$*" "$C_0" >&2; exit 2; }
backup_fail() { printf '%s\nBACKUP FAILED: %s\nNothing has been changed.%s\n' "$C_R" "$*" "$C_0" >&2; exit 3; }

# The baseline must be unreachable even by a mistyped override.
case "$OPS_PROJECT" in
  ainext) die "AINEXT_COMPOSE_PROJECT=ainext is the FROZEN BASELINE. These scripts act on noor (ainext-mvp1) only." ;;
  *[!a-z0-9_-]*|"") die "AINEXT_COMPOSE_PROJECT '$OPS_PROJECT' is not a compose project name" ;;
esac

# ---- talking to the stack ------------------------------------------------------
# -p is never optional: with two stacks on one box, an unqualified compose
# command is how you restart the wrong environment.
dc() {
  local args=(-p "$OPS_PROJECT") f
  for f in $OPS_FILES; do args+=(-f "$OPS_HERE/$f"); done
  docker compose "${args[@]}" "$@"
}

svc_running() {
  local cid; cid="$(dc ps -q "$1" 2>/dev/null || true)"
  [ -n "$cid" ] || return 1
  [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo false)" = "true" ]
}

# psql inside the db container, as the owner, password from the container's env.
psql_in() { dc exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -v ON_ERROR_STOP=1 "$@"' -- "$@"; }
dbq()     { psql_in -qAt -U ainext -d "${2:-$OPS_DB}" -c "$1"; }
# SQL from stdin, extra psql args (e.g. -v c=...) after the database name.
sql_on()  { local db="$1"; shift; psql_in -qAt -U ainext -d "$db" "$@"; }

ops_preflight() {
  local f
  for f in $OPS_FILES; do
    [ -f "$OPS_HERE/$f" ] || die "no $f beside this script ($OPS_HERE)"
  done
  [ -f "$OPS_HERE/.env" ] || die "deploy/.env missing. It is written by every CI/CD deploy — deploy first."
  docker info >/dev/null 2>&1 || die "cannot talk to Docker as $(id -un)"
  svc_running db || die "the 'db' service of $OPS_PROJECT is not running. Deploy (Actions -> CI/CD -> Run workflow), then retry."
  [ "$(dbq 'SELECT 1' 2>/dev/null || true)" = "1" ] \
    || die "Postgres is up but not answering — check: $(dc_hint) logs --tail=50 db"
}

# The exact compose prefix, for a human to paste.
dc_hint() {
  local s="docker compose -p $OPS_PROJECT" f
  for f in $OPS_FILES; do s="$s -f $f"; done
  printf 'cd %s && %s' "$OPS_HERE" "$s"
}

# ---- the loader service (ainext_maint) ------------------------------------------
ops_build_loader() {
  say "Building the loader image (dependencies only; cached after the first time)"
  dc --profile tools build -q loader >/dev/null || die "the loader image did not build"
  ok "loader image ready"
}

# loader_run <database> <python args…>
# --no-deps: a one-off run must never recreate the db container or re-run
#            migrate on a production box (preflight already proved db is up).
# -T:        no pseudo-TTY; nothing here reads input.
# The DSN names the database only; the password is the service's own PGPASSWORD.
loader_run() {
  local db="$1"; shift
  [[ "$db" =~ ^[a-z0-9_]+$ ]] || die "internal: bad database name '$db'"
  dc --profile tools run --rm -T --no-deps \
    -e AINEXT_ENVIRONMENT=mvp1 \
    -e AINEXT_DB_DSN="host=db port=5432 dbname=$db user=ainext_maint" \
    --entrypoint python loader "$@"
}

# ---- backups -------------------------------------------------------------------
# Custom format (pg_dump -Fc): restorable over a populated database with
# --clean --if-exists --single-transaction, which is what makes the rollback
# ONE command and all-or-nothing. The file holds student rows (minors' data):
# it stays on the box, 0600 in a 0700 directory, and never enters git.

# ops_verify_backup <file> — 0 when the file reads back end to end.
#   1. it is a non-empty custom-format archive (magic PGDMP);
#   2. `pg_restore --list` reads its table of contents, and the TOC holds the
#      DATA of graph_nodes, questions, attempts and mastery — the content and
#      the student progress a rollback exists to bring back;
#   3. `pg_restore -f /dev/null` reads EVERY data block. The TOC is written
#      first, so a truncated file still lists cleanly: step 2 alone would pass
#      a backup that cannot be restored. This step is the one that proves it can.
ops_verify_backup() {
  local f="$1" list t err
  [ -s "$f" ] || { warn "backup $f is missing or empty"; return 1; }
  [ "$(head -c 5 "$f" 2>/dev/null)" = "PGDMP" ] || { warn "backup $f is not a pg_dump custom-format archive"; return 1; }
  if ! list="$(dc exec -T db pg_restore --list < "$f" 2>&1)"; then
    warn "pg_restore --list could not read $f:"; printf '%s\n' "$list" | tail -5 | sed 's/^/      /'
    return 1
  fi
  for t in graph_nodes questions attempts mastery; do
    grep -qE "TABLE DATA public $t " <<<"$list" \
      || { warn "backup $f has no data entry for table '$t'"; return 1; }
  done
  if ! err="$(dc exec -T db pg_restore -f /dev/null < "$f" 2>&1 >/dev/null)"; then
    warn "backup $f does not read back to the end (truncated or corrupt):"
    printf '%s\n' "$err" | tail -5 | sed 's/^/      /'
    return 1
  fi
  return 0
}

# ops_backup <label> [transient] — dump, verify, set LAST_BACKUP. Exits 3 on any
# failure. `transient`: a rehearsal's working copy, removed when it ends.
# A file that failed is renamed *.failed, never left looking like a backup:
# a midnight restore must not be able to pick it up.
ops_backup() {
  local label="$1" f
  umask 077
  mkdir -p "$OPS_BACKUP_DIR" 2>/dev/null || backup_fail "cannot create $OPS_BACKUP_DIR as $(id -un)"
  chmod 700 "$OPS_BACKUP_DIR" 2>/dev/null || true
  f="$OPS_BACKUP_DIR/${label}-$(date -u +%Y%m%dT%H%M%SZ).dump"
  say "Backing up $OPS_DB (pg_dump -Fc) and verifying it reads back"
  if ! dc exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -Fc -U ainext -d "$1"' -- "$OPS_DB" > "$f"; then
    mv -f "$f" "$f.failed" 2>/dev/null || true
    backup_fail "pg_dump did not complete (kept as $f.failed for diagnosis, 0600)"
  fi
  chmod 600 "$f"
  if ! ops_verify_backup "$f"; then
    mv -f "$f" "$f.failed" 2>/dev/null || true
    backup_fail "the backup did not verify (kept as $f.failed for diagnosis, 0600)"
  fi
  LAST_BACKUP="$f"
  ok "backup $f ($(du -h "$f" | cut -f1)) — TOC lists graph_nodes, questions, attempts, mastery; every block reads back"
  if [ "${2:-}" = transient ]; then
    info "a rehearsal's working copy (student rows, 0600): removed when the rehearsal ends"
  else
    info "it holds student rows: it stays on this box, 0600, out of git; nothing deletes it automatically"
  fi
}

ops_list_backups() {
  shopt -s nullglob
  local files=("$OPS_BACKUP_DIR"/*.dump)
  shopt -u nullglob
  if [ "${#files[@]}" -eq 0 ]; then info "no backups yet in $OPS_BACKUP_DIR"; return 0; fi
  info "${#files[@]} backup(s) in $OPS_BACKUP_DIR, $(du -sh "$OPS_BACKUP_DIR" 2>/dev/null | cut -f1) total. Newest:"
  ls -1t "${files[@]}" | head -5 | sed 's|^|     |' || true
  [ "${#files[@]}" -gt 20 ] && warn "nothing is ever deleted automatically — prune old ones by hand when you are sure"
  return 0
}

ops_health() {  # <port> <what>
  local i
  for i in $(seq 1 40); do
    if curl -sSf -o /dev/null "http://$OPS_HEALTH_HOST:$1/" 2>/dev/null; then ok "$2 answers on :$1"; return 0; fi
    sleep 3
  done
  warn "$2 did not answer on :$1 within 2 minutes — check: $(dc_hint) logs --tail=100 $3"
  return 1
}

# ops_restore <file> — put a backup back over the live database.
#   verify it → take a pre-restore backup (so this is undoable too) → stop app
#   and console (their pools would break on dropped tables) → pg_restore
#   --clean --if-exists --single-transaction (all or nothing: a failure leaves
#   the database exactly as it was) → re-apply this checkout's migrations (the
#   backup may predate one) → start both → health.
# Everything students did after the backup was taken is LOST by a restore. The
# pre-restore backup keeps it recoverable by hand.
ops_restore() {
  local f="$1" pre
  [ -f "$f" ] || die "no such backup: $f"
  case "$f" in *.dump) ;; *) die "$f is not a .dump backup taken by these scripts";; esac
  say "Checking $f before using it"
  ops_verify_backup "$f" || die "refusing to restore a backup that does not verify"
  ok "backup verifies"
  ops_backup "pre-restore"
  pre="$LAST_BACKUP"
  say "Stopping the student app and the console (volumes are NOT touched)"
  dc stop app console >/dev/null 2>&1 || true
  say "Restoring $f over $OPS_DB (one transaction)"
  if ! dc exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --clean --if-exists --single-transaction --exit-on-error -U ainext -d "$1"' -- "$OPS_DB" < "$f"; then
    dc start app console >/dev/null 2>&1 || true
    die "the restore failed and rolled itself back — the database is exactly as it was before this command.
       App and console restarted. Nothing to undo. (Pre-restore backup, unused: $pre)"
  fi
  ok "restored"
  say "Re-applying this checkout's migrations (idempotent)"
  dc run --rm -T --no-deps migrate >/dev/null 2>&1 \
    || warn "migrate reported a problem — read: $(dc_hint) run --rm --no-deps migrate"
  say "Starting the student app and the console"
  dc start app console >/dev/null 2>&1 || dc up -d --no-deps app console >/dev/null 2>&1 || true
  ops_health "$OPS_APP_PORT" "student app" app || true
  ops_health "$OPS_CONSOLE_PORT" "console" console || true
  info "undo this restore with:  bash $OPS_HERE/refresh-content.sh restore $pre"
}

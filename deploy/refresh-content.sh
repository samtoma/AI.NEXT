#!/usr/bin/env bash
# refresh-content interface: 2
# =============================================================================
# AI.Next — change the content of a course that is ALREADY LOADED on noor,
# safely. (Constitution X; FR-4210; privacy review F15)
#
#   bash deploy/refresh-content.sh status
#   bash deploy/refresh-content.sh preview         <course-id>   add-only, rehearsed and rolled back
#   bash deploy/refresh-content.sh preview-update  <course-id>   --update, rehearsed and rolled back
#   bash deploy/refresh-content.sh preview-replace <course-id>   --replace, rehearsed; prints the
#                                                                confirmation phrase
#   bash deploy/refresh-content.sh course          <course-id>   back up, then ADD what the bundles
#                                                                have and the database lacks
#   bash deploy/refresh-content.sh update          <course-id>   back up, then also apply edits
#   bash deploy/refresh-content.sh replace <course-id> <N>       back up, then also prune; N = the
#                                                                number of students with progress
#   bash deploy/refresh-content.sh restore <file.dump>           roll back to a backup
#   bash deploy/refresh-content.sh backup | verify-backup <file>
#   bash deploy/refresh-content.sh --stack poc <mode> …          the FROZEN BASELINE (see below)
#
# Normally started from GitHub: Actions -> "Content refresh (manual)".
# A course that is NOT loaded yet goes through deploy/load-course.sh instead.
#
# WHAT CHANGED (2026-09-25, feature 003, T326). This script used to act on the
# frozen baseline (/opt/reletix/AI.NEXT, project `ainext`, database
# `ainext_poc`), so the product had no backed-up content path at all (F15). It
# now acts on NOOR — project `ainext-mvp1`, database `ainext_mvp1`, app :3101,
# console :3102 — and:
#   * `course` is ADD-ONLY. It used to replace the course's subtree. Editing
#     existing rows is `update`; pruning is `replace`, and `replace` needs the
#     number of students with progress in the course typed back (FR-4210). The
#     loader itself never deletes a student row: `--replace` RETIRES an
#     attempted question (kept, not served) and REFUSES, saying what would be
#     lost, when an objective with progress would go. The typed count is the
#     operator saying "I have seen who this touches".
#   * migrations come from the stack's own `migrate` service (the files in
#     this checkout), not from a hand-kept list;
#   * a restore stops and restarts BOTH the student app and the console;
#   * `full-reseed` and `promote-poc` are gone from noor. The first would replace
#     the whole database with a July seed dump; the second marks every `review`
#     question live — on noor that includes the 297 Arabic questions the sacred
#     gate holds (ADR-0006).
#   * backups are pg_dump custom format, VERIFIED before anything is written
#     (deploy/ops-lib.sh), in /opt/reletix/backups/mvp1 — outside the checkout.
#
# THE CHECKOUT IS NEVER MOVED. This script loads the bundles of the commit that
# is deployed. Lesson prose lives in the app IMAGE, so new content goes: deploy
# first (Actions -> CI/CD), then refresh.
#
# `--stack poc` runs the frozen baseline's OWN copy of this script, in its own
# checkout at /opt/reletix/AI.NEXT, without moving it — its own loader, its own
# modes (status, preview, course, full-reseed, promote-poc, restore, backup).
# The baseline is frozen; nothing here changes what that copy does.
# =============================================================================
set -euo pipefail

STACK="${AINEXT_STACK:-mvp1}"
if [ "${1:-}" = "--stack" ]; then STACK="${2:-}"; shift 2 || true; fi

case "$STACK" in
  mvp1) ;;
  poc)
    BASE="${AINEXT_BASELINE_DIR:-/opt/reletix/AI.NEXT}"
    case "${1:-}" in
      status|preview|course|full-reseed|promote-poc|restore|backup) ;;
      *) printf 'FAILED: the baseline (poc) takes status, preview, course, full-reseed, promote-poc, restore or backup — got %s\n' "'${1:-}'" >&2; exit 1 ;;
    esac
    [ -f "$BASE/deploy/refresh-content.sh" ] \
      || { printf 'FAILED: no baseline checkout with deploy/refresh-content.sh at %s\n' "$BASE" >&2; exit 1; }
    printf '\n== The FROZEN BASELINE: running its own refresh-content.sh in %s (checkout NOT moved)\n' "$BASE"
    printf '   baseline checkout: %s\n' "$(git -C "$BASE" log -1 --format='%h %s' 2>/dev/null || echo unknown)"
    cd "$BASE/deploy"
    exec bash ./refresh-content.sh "$@" ;;
  *) printf 'FAILED: --stack must be mvp1 (noor, the default) or poc (the frozen baseline), got %s\n' "'$STACK'" >&2; exit 1 ;;
esac

OPS_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/ops-lib.sh
. "$OPS_HERE/ops-lib.sh"

usage() {
  sed -n '7,19p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-1}"
}

apply_migrations() {
  say "Migrations — the stack's own migrate service (idempotent; every file in db/migrations)"
  local out
  if ! out="$(dc run --rm -T --no-deps migrate 2>&1)"; then
    printf '%s\n' "$out" | tail -30 | sed 's/^/     /'
    die "migrate failed — nothing was loaded. The full log: $(dc_hint) run --rm --no-deps migrate"
  fi
  printf '%s\n' "$out" | tail -3 | sed 's/^/     /'
}

counts() {
  dbq "SELECT 'nodes='||(SELECT count(*) FROM graph_nodes)
            ||' questions='||(SELECT count(*) FROM questions)
            ||' live='||(SELECT count(*) FROM questions WHERE status='live')
            ||' review='||(SELECT count(*) FROM questions WHERE status='review')
            ||' retired='||(SELECT count(*) FROM questions WHERE status='retired')
            ||' visuals='||(SELECT count(*) FROM visuals)
            ||' misconceptions='||(SELECT count(*) FROM misconceptions)"
}

# Lesson prose (services/extraction/seed/content/*.json) is COPYed into the app
# image at build time and read at request time. A database refresh alone cannot
# ship it. Deploy first, then refresh.
content_drift_check() {
  command -v sha256sum >/dev/null 2>&1 || { info "content-drift check skipped (no sha256sum on this host)"; return 0; }
  svc_running app || { info "content-drift check skipped (app not running)"; return 0; }
  local in_image on_disk
  in_image="$(dc exec -T app sh -c 'cd /repo/services/extraction/seed/content 2>/dev/null && sha256sum *.json 2>/dev/null | sort' || true)"
  on_disk="$(cd "$OPS_REPO/services/extraction/seed/content" 2>/dev/null && sha256sum ./*.json 2>/dev/null | sed 's| \./| |' | sort || true)"
  [ -n "$in_image" ] || { info "content-drift check skipped (no content directory in the image)"; return 0; }
  if [ "$in_image" = "$on_disk" ]; then
    ok "lesson-content files: the running image matches this checkout"
  else
    warn "the RUNNING IMAGE serves different lesson-content files than this checkout."
    warn "Lesson prose lives in the image, not the database. If this refresh adds or changes"
    warn "lessons, DEPLOY FIRST (Actions -> CI/CD -> Run workflow), then refresh."
    diff <(printf '%s\n' "$in_image") <(printf '%s\n' "$on_disk") | head -12 | sed 's/^/     /' || true
  fi
}

check_course_id() {
  [[ "$1" =~ ^course:[a-z0-9-]+$ ]] || refuse "'$1' is not a course node id (e.g. course:prep3-math-en)"
  [ "$(dbq "SELECT count(*) FROM graph_nodes WHERE id = '$1' AND kind = 'course'")" = 1 ] \
    || refuse "$1 is not loaded on noor. A course that is not loaded yet goes through deploy/load-course.sh (Actions -> Load a course)."
}

# "<students with progress> <attempts> <mastery rows>" in the course.
progress_in() {
  sql_on "$OPS_DB" -v c="$1" <<'SQL'
WITH los AS (SELECT node_id FROM node_subject WHERE course_id = :'c')
SELECT (SELECT count(DISTINCT s) FROM (
          SELECT a.student_id AS s FROM attempts a JOIN questions q ON q.id = a.question_id
           WHERE q.lo_id IN (SELECT node_id FROM los)
          UNION
          SELECT m.student_id FROM mastery m WHERE m.lo_id IN (SELECT node_id FROM los)) t)
    || ' ' || (SELECT count(*) FROM attempts a JOIN questions q ON q.id = a.question_id
                WHERE q.lo_id IN (SELECT node_id FROM los))
    || ' ' || (SELECT count(*) FROM mastery WHERE lo_id IN (SELECT node_id FROM los));
SQL
}

# The loader's arguments are built HERE, from a closed set: --approve-all,
# --demo-student and --wipe-students can never arrive from an input, and a
# hostile "course id" cannot smuggle in a flag.
run_loader() {  # <course> <add|update|replace> [dry]
  local course="$1" how="$2" dry="${3:-}" args
  args=(load_seed.py --all --course "$course")
  case "$how" in add) ;; update) args+=(--update) ;; replace) args+=(--replace) ;; esac
  [ "$dry" = dry ] && args+=(--dry-run)
  say "Loading $course ($how)${dry:+   [DRY RUN — rolled back]}"
  info "loader: ${args[*]}"
  loader_run "$OPS_DB" "${args[@]}"
}

# =============================================================================
MODE="${1:-}"; shift || true
case "$MODE" in

  status)
    ops_preflight
    say "Stack ($OPS_PROJECT)"; dc ps
    say "Database ($OPS_DB)";   info "$(counts)"
    info "courses: $(dbq "SELECT string_agg(id, ', ' ORDER BY id) FROM graph_nodes WHERE kind='course'")"
    say "Content";  content_drift_check
    say "Backups";  ops_list_backups
    ;;

  preview|preview-update|preview-replace)
    [ $# -eq 1 ] || usage
    how=add; [ "$MODE" = preview-update ] && how=update; [ "$MODE" = preview-replace ] && how=replace
    ops_preflight
    check_course_id "$1"
    say "PREVIEW ($how) of $1 — the database will not be modified (migrations, if any, DO apply)"
    apply_migrations
    ops_build_loader
    info "before: $(counts)"
    content_drift_check
    read -r STUDENTS ATTEMPTS MASTERY <<<"$(progress_in "$1")"
    info "progress in $1: $STUDENTS student(s), $ATTEMPTS attempt(s), $MASTERY mastery row(s)"
    rc=0; run_loader "$1" "$how" dry || rc=$?
    info "after (must be identical): $(counts)"
    [ "$rc" = 0 ] || die "the $how load would fail or refuse (above) — nothing was changed"
    case "$how" in
      add)     info "to run it:  mode course,  confirm: $1" ;;
      update)  info "to run it:  mode update,  confirm: UPDATE $1" ;;
      replace) info "to run it:  mode replace, confirm: REPLACE $1 $STUDENTS"
               info "(the number is the students with progress in this course; it is checked again when you run it)" ;;
    esac
    ;;

  course|update)
    [ $# -eq 1 ] || usage
    how=add; [ "$MODE" = update ] && how=update
    ops_preflight
    check_course_id "$1"
    say "Refresh of $1 ($how)"
    apply_migrations
    ops_build_loader
    info "before: $(counts)"
    content_drift_check
    ops_backup "refresh-$how-$(printf '%s' "${1#course:}" | tr -c 'a-z0-9-' '-')"
    if ! run_loader "$1" "$how"; then
      warn "the load failed or refused and rolled ITSELF back — the database is exactly as it was"
      die "nothing to undo. Fix the bundle and re-run. (Backup kept: $LAST_BACKUP)"
    fi
    info "after:  $(counts)"
    say "Done"
    info "a question that landed in 'review' is not served until a human promotes it"
    info "roll back with:  bash $OPS_HERE/refresh-content.sh restore $LAST_BACKUP"
    ;;

  replace)
    [ $# -eq 2 ] || usage
    ops_preflight
    check_course_id "$1"
    [[ "$2" =~ ^[0-9]+$ ]] || refuse "replace needs the number of students with progress in $1 (run preview-replace to see it)"
    read -r STUDENTS ATTEMPTS MASTERY <<<"$(progress_in "$1")"
    info "progress in $1: $STUDENTS student(s), $ATTEMPTS attempt(s), $MASTERY mastery row(s)"
    [ "$2" = "$STUDENTS" ] \
      || refuse "you confirmed $2 student(s) with progress in $1, but there are now $STUDENTS. Run preview-replace again, read what it prints, then confirm with: REPLACE $1 $STUDENTS"
    say "Replace of $1 — $STUDENTS student(s) with progress, confirmed"
    info "the loader keeps every student row: a question they attempted is RETIRED (kept, not served),"
    info "and it REFUSES, saying what would be lost, if an objective with progress would be deleted."
    apply_migrations
    ops_build_loader
    info "before: $(counts)"
    content_drift_check
    ops_backup "refresh-replace-$(printf '%s' "${1#course:}" | tr -c 'a-z0-9-' '-')"
    if ! run_loader "$1" replace; then
      warn "the load failed or refused and rolled ITSELF back — the database is exactly as it was"
      die "nothing to undo. (Backup kept: $LAST_BACKUP)"
    fi
    info "after:  $(counts)"
    say "Done"
    info "roll back with:  bash $OPS_HERE/refresh-content.sh restore $LAST_BACKUP"
    ;;

  restore)
    [ $# -eq 1 ] || usage
    ops_preflight
    say "ROLLBACK — restoring $1 over $OPS_DB"
    warn "everything students did after that backup was taken is replaced by the backup."
    info "before: $(counts)"
    ops_restore "$1"
    info "after:  $(counts)"
    say "Done"
    ;;

  backup)
    ops_preflight
    ops_backup manual
    ;;

  verify-backup)
    [ $# -eq 1 ] || usage
    ops_preflight
    if ops_verify_backup "$1"; then ok "$1 reads back end to end"; else exit 3; fi
    ;;

  full-reseed|promote-poc)
    die "'$MODE' does not exist on noor. It replaced the whole database / promoted every held question
       (297 of them sacred-gated Arabic items). It survives only on the frozen baseline: --stack poc." ;;

  ""|-h|--help|help) usage 0 ;;
  *) die "unknown mode '$MODE' — run '$0 --help'" ;;
esac

#!/usr/bin/env bash
# =============================================================================
# Regenerate deploy/db/ainext_poc.sql.gz — the dump Postgres loads on FIRST BOOT
# of a fresh stack (empty ainext_pg volume). Run this on your LAPTOP, against
# your local ainext_poc, after a content milestone or a schema change; then
# commit the result. It is NOT part of the refresh path — refreshing content on
# a live box is deploy/refresh-content.sh.
#
#   ./make-seed-dump.sh                  # regenerate the committed seed dump
#   ./make-seed-dump.sh --no-student-data   # content only (no students/attempts)
#   ./make-seed-dump.sh --out /tmp/x.sql.gz # write somewhere else (dry check)
#
# TWO THINGS THIS ENFORCES
#  1. The artifact is restorable over a POPULATED database (--clean --if-exists),
#     so the same file serves first boot AND `refresh-content.sh full-reseed`.
#  2. It never ships real people. AI transcripts (ai_interactions) are always
#     excluded, and if the source database holds any student that is not the
#     synthetic demo one, the script REFUSES unless you pass --no-student-data.
#     The pilot is 50 families of minors: that data must never enter git.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/db/ainext_poc.sql.gz"
DB="${AINEXT_LOCAL_DB:-ainext_poc}"
NO_STUDENT_DATA=0

while [ $# -gt 0 ]; do
  case "$1" in
    --no-student-data) NO_STUDENT_DATA=1; shift ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag $1" >&2; exit 1 ;;
  esac
done

info() { printf '   %s\n' "$*"; }
die()  { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

command -v pg_dump >/dev/null || die "pg_dump not on PATH"
psql -d "$DB" -qAt -c 'SELECT 1' >/dev/null 2>&1 || die "cannot query local database '$DB'"

# --- the privacy gate -------------------------------------------------------
REAL="$(psql -d "$DB" -qAt -c \
  "SELECT count(*) FROM students WHERE display_name NOT LIKE '%(demo)%'")"
if [ "$REAL" != "0" ] && [ "$NO_STUDENT_DATA" = "0" ]; then
  die "database '$DB' holds $REAL non-demo student row(s).
     A seed dump goes into git. Real students — the pilot is minors — must not.
     Re-run with --no-student-data (ships schema + curriculum, no people)."
fi

# ai_interactions is always excluded: AI transcripts + per-turn cost logs have no
# business in a seed artifact, demo or not.
EXCLUDE=(--exclude-table-data=ai_interactions)
if [ "$NO_STUDENT_DATA" = "1" ]; then
  for t in students attempts mastery sessions understanding_checks explanation_log; do
    EXCLUDE+=(--exclude-table-data="$t")
  done
  info "student data EXCLUDED (schema kept, rows dropped)"
else
  info "keeping the synthetic demo student (the /student and Evidence Walk demos need it)"
fi

echo "== Dumping $DB"
psql -d "$DB" -qAt -c "SELECT '   nodes='||(SELECT count(*) FROM graph_nodes)
  ||' questions='||(SELECT count(*) FROM questions)
  ||' live='||(SELECT count(*) FROM questions WHERE status='live')
  ||' review='||(SELECT count(*) FROM questions WHERE status='review')
  ||' bridges='||(SELECT count(*) FROM graph_edges WHERE edge_type='relates_to')"

TMP="$(mktemp -t ainext-seed.XXXXXX)"
trap 'rm -f "$TMP"' EXIT
# --clean --if-exists  -> restorable over an existing database (and a harmless
#                         no-op on the empty volume of a first boot)
# --no-owner/--no-privileges -> loads as whatever role the target uses (ainext
#                         in the container, your own user locally)
pg_dump --clean --if-exists --no-owner --no-privileges "${EXCLUDE[@]}" -d "$DB" > "$TMP"

grep -q 'PostgreSQL database dump complete' "$TMP" || die "pg_dump output looks truncated"
grep -q '^DROP ' "$TMP" || die "no DROP statements — this dump would not be restorable over a live DB"

mkdir -p "$(dirname "$OUT")"
gzip -9 -c "$TMP" > "$OUT"
echo "== Wrote $OUT ($(du -h "$OUT" | cut -f1))"
info "verify the restore before committing:"
info "  createdb ainext_seedcheck && gzip -dc '$OUT' | psql -q -v ON_ERROR_STOP=1 -d ainext_seedcheck"
info "  psql -d ainext_seedcheck -c \"select count(*) from questions\"  # then dropdb ainext_seedcheck"
info "then: git add $(basename "$OUT") && git commit"

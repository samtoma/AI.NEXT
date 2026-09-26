#!/usr/bin/env bash
#
# course-gating.sh — the undo switch for the course-availability feature.
#
#   ./scripts/course-gating.sh status     what is in force right now
#   ./scripts/course-gating.sh on         enforce the gate (students see only what is live)
#   ./scripts/course-gating.sh off        suspend the rules; every loaded course of a student's OWN curriculum visible
#   ./scripts/course-gating.sh rollback   drop the tables entirely (needs --yes)
#
# WHY THIS FILE EXISTS
# --------------------
# Samuel asked for this feature to be reversible before he had seen it. There
# are three ways back out, and they cost different amounts, so they are three
# commands rather than one:
#
#   off        Zero cost, instant, keeps every rule you have configured. Flips
#              AINEXT_COURSE_GATING in app/.env.local. The console keeps working
#              and says loudly that it is not in force. THIS IS THE ONE YOU WANT
#              if the feature is in the way. Restart the dev server after.
#              Since feature 003 (FR-4015) it suspends the RULES only: a student
#              still sees only her own curriculum's courses (every loaded one),
#              plus any per-student exception.
#
#   rollback   Drops course_availability and student_course_access. Loses every
#              rule and override you configured; loses nothing a student made.
#              The product returns to "every course visible to every student".
#              Requires --yes because it is not undoable without re-running the
#              migration and re-entering the configuration by hand.
#              ⚠ Only with a build OLDER than feature 003 running: since 003 the
#              student scope reads student_course_access even with the gate off
#              (a per-student exception still applies, FR-4015), so a 003 build
#              fails every student request once the table is gone.
#
#   the branch This work lives on its own git branch. Deleting the branch
#              removes the code as well as the data. `git branch -D` is the
#              third lever and this script deliberately does not do it for you:
#              deleting a branch is yours to run, not a script's to decide.
#
# The gate's own default, in code, is OFF when the variable is absent. That
# asymmetry is deliberate and is documented in lib/env.ts: for a tutoring
# product the safe failure is "too much visible", never "a paying student
# locked out of her own course by a missing environment variable".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/app/.env.local"
DOWN_SQL="$ROOT/db/migrations/rollback/023-course-availability.down.sql"

die() { printf 'course-gating: %s\n' "$*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || die "no app/.env.local — run ./scripts/local-dev.sh first"

maint_url() {
  local u
  u="$(grep -E '^DATABASE_URL_MAINT=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  [[ -n "$u" ]] || die "DATABASE_URL_MAINT is not set in app/.env.local"
  printf '%s' "$u"
}

current() {
  local v
  v="$(grep -E '^AINEXT_COURSE_GATING=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
  printf '%s' "${v:-<unset>}"
}

set_var() {
  local value="$1" tmp
  tmp="$(mktemp)"
  if grep -qE '^AINEXT_COURSE_GATING=' "$ENV_FILE"; then
    sed "s/^AINEXT_COURSE_GATING=.*/AINEXT_COURSE_GATING=$value/" "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"
    printf '\n# Course availability gate — ./scripts/course-gating.sh\nAINEXT_COURSE_GATING=%s\n' "$value" >> "$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
  printf 'AINEXT_COURSE_GATING=%s\n' "$value"
  printf 'Restart the dev servers for this to take effect.\n'
}

tables_present() {
  psql "$(maint_url)" -tAc \
    "SELECT count(*) FROM information_schema.tables
      WHERE table_schema='public'
        AND table_name IN ('course_availability','student_course_access')" 2>/dev/null || echo 0
}

case "${1:-status}" in
  status)
    printf 'gate variable   : %s\n' "$(current)"
    printf 'gate in force   : %s\n' \
      "$([[ "$(current)" == "on" ]] && echo 'YES — students see only courses set live for their grade, in their own curriculum' \
                                    || echo 'rules suspended — every loaded course of a student'"'"'s own curriculum is visible (FR-4015)')"
    printf 'tables present  : %s of 2\n' "$(tables_present)"
    printf 'branch          : %s\n' "$(cd "$ROOT" && git rev-parse --abbrev-ref HEAD)"
    if [[ "$(tables_present)" == "2" ]]; then
      printf '\nrules configured (one set per environment — constitution XI, never pooled):\n' 
      psql "$(maint_url)" -c \
        "SELECT environment, course_id, grade, state, updated_at::timestamp(0)
           FROM course_availability ORDER BY environment, course_id, grade" 2>/dev/null || true
      psql "$(maint_url)" -c \
        "SELECT environment, student_id, course_id, state, updated_at::timestamp(0)
           FROM student_course_access ORDER BY environment, student_id, course_id" 2>/dev/null || true
    fi
    ;;
  on)  set_var on ;;
  off) set_var off ;;
  rollback)
    [[ "${2:-}" == "--yes" ]] || die "rollback discards every rule and override you configured.
Re-run as: ./scripts/course-gating.sh rollback --yes
(If you only want to stop the gate taking effect, use 'off' — it keeps your configuration.)
Run it only with a build older than feature 003: a 003 build reads student_course_access
even with the gate off, and fails every student request without it."
    [[ -f "$DOWN_SQL" ]] || die "missing $DOWN_SQL"
    psql "$(maint_url)" -v ON_ERROR_STOP=1 -f "$DOWN_SQL"
    set_var off
    printf 'Tables dropped. Every course is visible to every student again.\n'
    printf 'The code is still present; delete the branch to remove that too.\n'
    ;;
  *) die "unknown command '${1}'. One of: status | on | off | rollback --yes" ;;
esac

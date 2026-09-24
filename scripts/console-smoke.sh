#!/usr/bin/env bash
#
# console-smoke.sh — Phase 2 QA smoke test for the two build targets
# (student :3000, console :3002) — I3b, per BRIEF-P2.md §B.
#
#   ./scripts/console-smoke.sh [STUDENT_URL] [CONSOLE_URL]
#     STUDENT defaults to http://localhost:3000
#     CONSOLE defaults to http://localhost:3002
#
# Both servers must already be running (`./scripts/local-dev.sh --both`, or two
# `npm run dev` processes — one plain, one `AINEXT_SURFACE=admin`) against a
# database that has run migrations 011-019 and the operator bootstrap
# (local-dev.sh does both). Exercises live HTTP + psql against the real
# database; a cookie jar per identity (Samuel, the cost-only operator, Omar).
#
# One line per check:  PASS|FAIL  <FR>  <what>
# Non-zero exit if any check FAILs.
#
# IDEMPOTENT: safe to re-run against the same database. Samuel's
# password_hash is reset to NULL and walked back through the real
# forgot/reset-password flow every run (ADR-0014's own mechanic — no hash is
# ever written by hand); the cost-billing-only operator is created with
# SELECT-then-INSERT, the same pattern app/scripts/bootstrap-operator.mts
# uses, and re-running grants it nothing new.
#
# CAVEAT, not a defect: forgot-password bumps the shared IP throttle bucket
# (20/15min, FR-2011) twice per run (the plain request and the Host:evil.test
# probe) and login attempts add more. About ten back-to-back runs from the
# same source exhaust that budget and forgot-password/login start 429ing —
# wait 15 minutes for the fixed window to roll over, or reset the counter
# (test infrastructure state, not product data):
#   psql "$DATABASE_URL_MAINT" -c "DELETE FROM auth_throttle WHERE scope IN ('ip','email')"
#
# Ownership: this file and its report only (I3b brief) — nothing else here is
# edited. Defects found while running it are reported with file:line, never
# patched in this script.

set -uo pipefail   # deliberately NOT -e: a failed check must not abort the run

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/app"
STUDENT="${1:-http://localhost:3000}"
CONSOLE="${2:-http://localhost:3002}"

ENVF="$APP/.env.local"
[ -f "$ENVF" ] || { echo "no app/.env.local — run ./scripts/local-dev.sh first" >&2; exit 2; }
env_value() { sed -n "s/^$1=//p" "$ENVF" | tail -1; }
MAINT_DSN=$(env_value DATABASE_URL_MAINT)
[ -n "$MAINT_DSN" ] || { echo "DATABASE_URL_MAINT missing from app/.env.local" >&2; exit 2; }
ENVIRONMENT=$(env_value AINEXT_ENVIRONMENT); ENVIRONMENT=${ENVIRONMENT:-mvp1}

psql_maint() { psql "$MAINT_DSN" -v ON_ERROR_STOP=1 -qtA "$@"; }

SAMUEL_EMAIL="samuel.s.toma@gmail.com"
SAMUEL_PASSWORD="ConsoleLocal!2026"
COSTONLY_EMAIL="cost-only@local.test"
COSTONLY_PASSWORD="CostOnly!2026"
OMAR_EMAIL="omar@local.test"
OMAR_PASSWORD="omar-local-test"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
BODY="$TMP/body"; HDRS="$TMP/hdrs"
JAR_SAMUEL="$TMP/jar-samuel.txt"; JAR_COST="$TMP/jar-cost.txt"; JAR_OMAR="$TMP/jar-omar.txt"
: > "$JAR_SAMUEL"; : > "$JAR_COST"; : > "$JAR_OMAR"

PASS=0; FAIL=0
check() {  # check <FR> <desc> <0|1>
  local fr="$1" desc="$2" ok="$3"
  if [ "$ok" = 1 ]; then printf 'PASS  %-9s %s\n' "$fr" "$desc"; PASS=$((PASS+1))
  else                   printf 'FAIL  %-9s %s\n' "$fr" "$desc"; FAIL=$((FAIL+1)); fi
}
note() { printf '      %-9s %s\n' "" "$*"; }
say_section() { printf '\n--- %s ---\n' "$*"; }

# req METHOD BASE PATH JAR [DATA] [EXTRA_HEADER] -> status on stdout, body in
# $BODY, response headers in $HDRS. JAR "-" means no cookie jar at all.
req() {
  local method="$1" base="$2" path="$3" jar="$4" data="${5:-}" xhdr="${6:-}"
  local args=(-sS -D "$HDRS" -o "$BODY" -w '%{http_code}' -X "$method")
  [ "$jar" != "-" ] && args+=(-b "$jar" -c "$jar")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' -d "$data")
  [ -n "$xhdr" ] && args+=(-H "$xhdr")
  curl "${args[@]}" "$base$path"
}

location_header() { awk 'BEGIN{IGNORECASE=1} /^location:/{print $2}' "$HDRS" | tr -d '\r' | tail -1; }
is_3xx() { [[ "$1" =~ ^3[0-9][0-9]$ ]]; }
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

echo "=== console-smoke.sh — student=$STUDENT console=$CONSOLE ==="

# ============================================================ 1. student build
say_section "1. Student build — console routes absent, product routes present"
for p in /console /content /pipeline /gallery /cost /profile /students/1 /dev/math-widgets; do
  code=$(req GET "$STUDENT" "$p" -)
  check FR-2201 "student build $p -> 404 (got $code)" "$([ "$code" = 404 ] && echo 1 || echo 0)"
done

for p in / /signin /signup; do
  code=$(req GET "$STUDENT" "$p" -)
  check FR-2201 "student build $p -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"
done

code=$(req GET "$STUDENT" /student -)
loc=$(location_header)
ok=0; is_3xx "$code" && [[ "$loc" == *"/signin"* ]] && ok=1
check FR-2205 "student build /student anonymous -> 3xx to /signin (got $code, Location: $loc)" "$ok"

code=$(req GET "$STUDENT" /api/demo-students -)
check FR-2104 "GET /api/demo-students -> 404 (got $code)" "$([ "$code" = 404 ] && echo 1 || echo 0)"

# ============================================================ 2. console build (reverse direction)
say_section "2. Console build — student routes absent at runtime, no self-registration"
code=$(req GET "$CONSOLE" / -)
loc=$(location_header)
ok=0; is_3xx "$code" && [[ "$loc" == *"/signin"* ]] && ok=1
check SC-110 "console build / anonymous -> 3xx to /signin (got $code, Location: $loc)" "$ok"

code=$(req GET "$CONSOLE" /signup -)
check FR-2201 "console build /signup -> 404 (got $code) — operators are seeded/granted, never self-registered" "$([ "$code" = 404 ] && echo 1 || echo 0)"

for p in /student /dashboard /spine; do
  code=$(req GET "$CONSOLE" "$p" -)
  check FR-2201 "console build $p -> 404 (got $code, runtime notFound() per R9)" "$([ "$code" = 404 ] && echo 1 || echo 0)"
done

# ============================================================ 3. operator bootstrap -> reset -> sign-in
say_section "3. Operator bootstrap -> reset -> sign-in, end to end (ADR-0014)"

psql_maint -c "UPDATE operators SET password_hash = NULL WHERE lower(email) = lower('$SAMUEL_EMAIL')" >/dev/null
note "simulated a fresh seed: $SAMUEL_EMAIL password_hash -> NULL"

MAILFILE="$APP/.local-mail/${SAMUEL_EMAIL}.txt"
rm -f "$MAILFILE"   # so "the newest link" is unambiguous for this run

code=$(req POST "$CONSOLE" /api/auth/forgot-password - "{\"email\":\"$SAMUEL_EMAIL\"}")
check FR-2010 "forgot-password (console) -> 202 (got $code)" "$([ "$code" = 202 ] && echo 1 || echo 0)"

# Host-header spoof probe: the mailed link must still say localhost:3002 —
# never a client-supplied Host (reset-poisoning check, lib/mail.ts consoleOrigin()).
code2=$(req POST "$CONSOLE" /api/auth/forgot-password - "{\"email\":\"$SAMUEL_EMAIL\"}" "Host: evil.test")
check FR-2010 "forgot-password with spoofed Host: evil.test -> 202 (got $code2)" "$([ "$code2" = 202 ] && echo 1 || echo 0)"

sleep 0.3
LAST_LINK=""
[ -f "$MAILFILE" ] && LAST_LINK=$(grep -o 'http[^ ]*reset-password?token=[^ ]*' "$MAILFILE" | tail -1)
ok=0; [[ "$LAST_LINK" == http://localhost:3002/* ]] && ok=1
check ADR-0014 "mailed reset link (incl. after Host:evil.test) points at localhost:3002 ($LAST_LINK)" "$ok"

TOKEN=$(printf '%s' "$LAST_LINK" | sed -n 's/.*token=//p')
ok=0; [ -n "$TOKEN" ] && ok=1
check ADR-0014 "reset token extracted from app/.local-mail/${SAMUEL_EMAIL}.txt" "$ok"

code=$(req POST "$CONSOLE" /api/auth/reset-password - "{\"token\":\"$TOKEN\",\"password\":\"$SAMUEL_PASSWORD\"}")
check FR-2011 "reset-password (console, operator arm) -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"

requested=$(psql_maint -c "SELECT count(*) FROM auth_events WHERE event='password_reset_requested' AND actor_kind='operator'")
completed=$(psql_maint -c "SELECT count(*) FROM auth_events WHERE event='password_reset_completed' AND actor_kind='operator'")
changed=$(psql_maint -c "SELECT count(*) FROM auth_events WHERE event='password_changed' AND actor_kind='operator'")
check FR-2501 "auth_events: password_reset_requested x${requested:-0}, actor_kind=operator" "$([ "${requested:-0}" -ge 1 ] && echo 1 || echo 0)"
check FR-2501 "auth_events: password_reset_completed x${completed:-0}, actor_kind=operator" "$([ "${completed:-0}" -ge 1 ] && echo 1 || echo 0)"
check FR-2501 "auth_events: password_changed x${changed:-0}, actor_kind=operator" "$([ "${changed:-0}" -ge 1 ] && echo 1 || echo 0)"

code=$(req POST "$CONSOLE" /api/auth/login "$JAR_SAMUEL" "{\"email\":\"$SAMUEL_EMAIL\",\"password\":\"$SAMUEL_PASSWORD\"}")
check FR-2207 "login (console, samuel, five roles) -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"
LOGIN_BODY=$(cat "$BODY")
# Five roles since v0.7.0 (`teaching-controls`, ADR-0021); the bootstrap
# grants all five to a new operator.
has5=0
for r in content-review evidence-access student-data cost-billing teaching-controls; do
  printf '%s' "$LOGIN_BODY" | grep -q "\"$r\"" && has5=$((has5+1))
done
check FR-2207 "login response carries all five roles ($LOGIN_BODY)" "$([ "$has5" = 5 ] && echo 1 || echo 0)"

opevt=$(psql_maint -c "SELECT reason FROM auth_events WHERE event='operator_login' ORDER BY occurred_at DESC LIMIT 1")
allfive=1
for r in content-review evidence-access student-data cost-billing teaching-controls; do
  [[ "$opevt" == *"$r"* ]] || allfive=0
done
check FR-2207 "auth_events.operator_login reason carries all five roles ($opevt)" "$allfive"

# ============================================================ 4. five-role operator on console
say_section "4. Four-role operator (samuel) on the console"

code=$(req GET "$CONSOLE" / "$JAR_SAMUEL")
b=$(cat "$BODY"); bl=$(lc "$b")
ok=0; [ "$code" = 200 ] && [[ "$b" == *"Omar (demo)"* ]] && [[ "$bl" == *"imputed at list price"* ]] && ok=1
check FR-2211 "/ (console, student-data+cost-billing) -> 200, lists Omar (demo), says imputed at list price" "$ok"

code=$(req GET "$CONSOLE" /students "$JAR_SAMUEL")
loc=$(location_header)
ok=0; is_3xx "$code" && [[ "$loc" == "/" || "$loc" == *"://"*"/" ]] && ok=1
check FR-2211 "/students -> 3xx to / (got $code, Location: $loc)" "$ok"

samuel_id=$(psql_maint -c "SELECT id FROM operators WHERE lower(email)=lower('$SAMUEL_EMAIL')")
before=$(psql_maint -c "SELECT count(*) FROM operator_reads WHERE surface='student_360' AND operator_id=$samuel_id")
before_evt=$(psql_maint -c "SELECT count(*) FROM auth_events WHERE event='admin_transcript_viewed'")
code=$(req GET "$CONSOLE" /students/1 "$JAR_SAMUEL")
after=$(psql_maint -c "SELECT count(*) FROM operator_reads WHERE surface='student_360' AND operator_id=$samuel_id")
after_evt=$(psql_maint -c "SELECT count(*) FROM auth_events WHERE event='admin_transcript_viewed'")
ok=0
[ "$code" = 200 ] && [ "$((after-before))" = 1 ] && [ "$((after_evt-before_evt))" -ge 1 ] && ok=1
check FR-2306 "/students/1 -> 200, operator_reads +1 (surface=student_360, operator_id=$samuel_id), admin_transcript_viewed emitted" "$ok"

for p in /content /pipeline /gallery /cost /profile /dev/math-widgets; do
  code=$(req GET "$CONSOLE" "$p" "$JAR_SAMUEL")
  check FR-2202 "$p (console, samuel) -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"
done

code=$(req GET "$CONSOLE" /pipeline "$JAR_SAMUEL")
b=$(cat "$BODY")
ok=0; [[ "$b" != *"Stage 05"* ]] && [[ "$b" != *"ContextStage"* ]] && ok=1
check FR-2104 "/pipeline HTML has no Stage 05 / ContextStage (the deleted cross-student latest-turn panel)" "$ok"

# ============================================================ 5. cost-billing-only operator
say_section "5. cost-billing-only operator (created via psql as maint, one role row)"

psql_maint -c "
INSERT INTO operators (email, display_name, status, environment)
SELECT '$COSTONLY_EMAIL', 'Cost Only (QA)', 'active', '$ENVIRONMENT'
WHERE NOT EXISTS (SELECT 1 FROM operators WHERE lower(email) = lower('$COSTONLY_EMAIL'))
" >/dev/null
COST_ID=$(psql_maint -c "SELECT id FROM operators WHERE lower(email) = lower('$COSTONLY_EMAIL')")
psql_maint -c "
INSERT INTO operator_roles (operator_id, role, environment)
SELECT $COST_ID, 'cost-billing', '$ENVIRONMENT'
WHERE NOT EXISTS (
  SELECT 1 FROM operator_roles WHERE operator_id = $COST_ID AND role = 'cost-billing' AND revoked_at IS NULL
)" >/dev/null
otherroles=$(psql_maint -c "SELECT count(*) FROM operator_roles WHERE operator_id=$COST_ID AND role<>'cost-billing' AND revoked_at IS NULL")
check FR-2203 "cost-only operator (id $COST_ID) holds exactly one role row (cost-billing)" "$([ "${otherroles:-0}" = 0 ] && echo 1 || echo 0)"

psql_maint -c "UPDATE operators SET password_hash = NULL WHERE id = $COST_ID" >/dev/null
MAILFILE_COST="$APP/.local-mail/${COSTONLY_EMAIL}.txt"
rm -f "$MAILFILE_COST"
req POST "$CONSOLE" /api/auth/forgot-password - "{\"email\":\"$COSTONLY_EMAIL\"}" >/dev/null
sleep 0.3
LINK=""
[ -f "$MAILFILE_COST" ] && LINK=$(grep -o 'http[^ ]*reset-password?token=[^ ]*' "$MAILFILE_COST" | tail -1)
TOKEN=$(printf '%s' "$LINK" | sed -n 's/.*token=//p')
rcode=$(req POST "$CONSOLE" /api/auth/reset-password - "{\"token\":\"$TOKEN\",\"password\":\"$COSTONLY_PASSWORD\"}")
check FR-2011 "cost-only operator: reset-password via the same flow -> 200 (got $rcode)" "$([ "$rcode" = 200 ] && echo 1 || echo 0)"

code=$(req POST "$CONSOLE" /api/auth/login "$JAR_COST" "{\"email\":\"$COSTONLY_EMAIL\",\"password\":\"$COSTONLY_PASSWORD\"}")
check FR-2207 "login (console, cost-only) -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"

code=$(req GET "$CONSOLE" / "$JAR_COST")
b=$(cat "$BODY"); bl=$(lc "$b")
ok=0
[ "$code" = 200 ] && [[ "$b" != *"Gender"* ]] && [[ "$b" != *"Verified"* ]] && [[ "$bl" == *"imputed"* ]] && ok=1
check FR-2406 "/ (console, cost-billing only) -> 200, no Gender/Verified heading, imputed present" "$ok"

denied_before=$(psql_maint -c "SELECT count(*) FROM auth_events WHERE event='permission_denied' AND actor_kind='operator' AND actor_id=$COST_ID")
for p in /students/1 /content /pipeline /gallery; do
  code=$(req GET "$CONSOLE" "$p" "$JAR_COST")
  b=$(cat "$BODY")
  ok=0; { [[ "$b" == *"do not hold the role"* ]] || [[ "$b" == *"Not permitted"* ]]; } && ok=1
  check FR-2202 "$p (console, cost-only) -> status $code, refusal body rendered (no data leaked)" "$ok"
done
denied_after=$(psql_maint -c "SELECT count(*) FROM auth_events WHERE event='permission_denied' AND actor_kind='operator' AND actor_id=$COST_ID")
newdenied=$((denied_after-denied_before))
check FR-2501 "auth_events gained a permission_denied per refusal ($newdenied new, actor_kind=operator)" "$([ "$newdenied" -ge 4 ] && echo 1 || echo 0)"

code=$(req GET "$CONSOLE" /cost "$JAR_COST")
check FR-2202 "/cost (console, cost-only) -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"

# ============================================================ 6. student credential on console
say_section "6. A student credential on the console must be refused (FR-2205)"

code=$(req POST "$CONSOLE" /api/auth/login - "{\"email\":\"$OMAR_EMAIL\",\"password\":\"$OMAR_PASSWORD\"}")
b=$(cat "$BODY")
ok=0; [ "$code" = 403 ] && [[ "$b" == *"permission_denied"* ]] && ok=1
check FR-2205 "POST /api/auth/login (Omar's credentials on CONSOLE) -> 403 permission_denied (got $code, $b)" "$ok"

reason=$(psql_maint -c "SELECT reason FROM auth_events WHERE event='permission_denied' AND reason='student_credential_on_console' ORDER BY occurred_at DESC LIMIT 1")
check FR-2501 "auth_events records reason=student_credential_on_console" "$([ "$reason" = "student_credential_on_console" ] && echo 1 || echo 0)"

code=$(req POST "$STUDENT" /api/auth/login "$JAR_OMAR" "{\"email\":\"$OMAR_EMAIL\",\"password\":\"$OMAR_PASSWORD\"}")
check FR-2205 "POST /api/auth/login (Omar's credentials on STUDENT) -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"

code=$(req GET "$STUDENT" /api/dashboard "$JAR_OMAR")
check FR-2205 "GET /api/dashboard (Omar, STUDENT, signed in) -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"

# ============================================================ 7. P1 regression
say_section "7. P1 regression — red-team-isolation.sh"
if [ -x "$ROOT/scripts/red-team-isolation.sh" ]; then
  RT_OUT=$("$ROOT/scripts/red-team-isolation.sh" "$STUDENT" 2>&1)
  RT_STATUS=$?
  RT_PASS=$(printf '%s\n' "$RT_OUT" | grep -c '^PASS')
  RT_FAIL=$(printf '%s\n' "$RT_OUT" | grep -c '^FAIL')
  printf '%s\n' "$RT_OUT" | tail -5
  if [ "$RT_FAIL" -gt 0 ]; then printf '%s\n' "$RT_OUT" | grep '^FAIL'; fi
  ok=0; [ "$RT_FAIL" = 0 ] && [ "$RT_STATUS" = 0 ] && ok=1
  check SC-104 "red-team-isolation.sh against $STUDENT: $RT_PASS pass / $RT_FAIL fail (exit $RT_STATUS)" "$ok"
else
  check SC-104 "scripts/red-team-isolation.sh missing or not executable" 0
fi

# ============================================================ summary
say_section "Summary"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
exit $?

#!/usr/bin/env bash
#
# red-team-isolation.sh — Phase 1 adversarial proof of the gate (I2e / QA).
#
#   ./scripts/red-team-isolation.sh [BASE_URL]     # default http://localhost:3014
#
# If BASE_URL already answers (checked with `curl -sf` on /signin — e.g. the
# orchestrator's own :3000 dev server), this runs against it as-is and starts
# nothing. Otherwise it builds and starts its own server on :3014 (`next dev`
# refuses a second instance per project dir; `npm run build && npm run start`
# is the documented fallback) and tears it down on exit.
#
# Exercises every checkable FR-21xx/FR-2501 guarantee against a LIVE server and
# database: two signed-up accounts, a cookie jar per identity, curl + psql.
# Prints one line per check:
#
#   PASS|FAIL  <FR>  <what>
#
# and exits non-zero if any check FAILs. Read-only towards Omar and content;
# writes only accounts/sessions/attempts/analytics rows it creates itself
# under qa-a@local.test / qa-b@local.test, and one extra attempt for Omar (to
# give the dashboard something non-zero to show — see step 5 below).
#
# IDEMPOTENT: a cleanup pass at the top removes any qa-a@local.test /
# qa-b@local.test account left over from a previous run (and their student's
# dependent rows) via the maintenance DSN, so this can be re-run against the
# same database without a --reset in between.
#
# CAVEAT, not a defect: step 7 deliberately burns 5 failed logins into the
# shared IP throttle bucket (20/15min, FR-2011) and step 9 adds one more (the
# old-password-after-reset probe). Three back-to-back runs from the same
# source IP exhaust that 20-failure budget and the FOURTH run's own signup
# starts 429ing — the throttle is doing exactly its job, it just does not know
# "QA" from "credential stuffing". If a run reports a wall of 429s where
# earlier runs were clean, that is why: either wait 15 minutes for the fixed
# window to roll over, or reset the counter yourself (test infrastructure
# state, not product data) with
#   psql "$DATABASE_URL_MAINT" -c "DELETE FROM auth_throttle WHERE scope='ip'"
#
# Ownership: this file and nothing else (I2e brief). Everything it finds wrong
# is reported, never patched here.

set -uo pipefail   # deliberately NOT -e: a failed check must not abort the run

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/app"
BASE="${1:-http://localhost:3014}"
ENVF="$APP/.env.local"

[ -f "$ENVF" ] || { echo "no app/.env.local — run ./scripts/local-dev.sh first" >&2; exit 2; }
env_value() { sed -n "s/^$1=//p" "$ENVF" | tail -1; }
MAINT_DSN=$(env_value DATABASE_URL_MAINT)
APP_DSN=$(env_value DATABASE_URL)
[ -n "$MAINT_DSN" ] && [ -n "$APP_DSN" ] || { echo "DATABASE_URL / DATABASE_URL_MAINT missing from app/.env.local" >&2; exit 2; }

psql_maint() { psql "$MAINT_DSN" -v ON_ERROR_STOP=1 -qtA "$@"; }
psql_app()   { psql "$APP_DSN"   -v ON_ERROR_STOP=1 -qtA "$@"; }

TMP=$(mktemp -d)
SERVER_PID=""
cleanup() {
  rm -rf "$TMP"
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT
BODY="$TMP/body"; HDRS="$TMP/hdrs"

# Reuse a server that is already up (e.g. the orchestrator's :3000) rather than
# always spinning up our own. Only fall back to build+start on 3014 when
# nothing answers at BASE.
if curl -sf -o /dev/null "$BASE/signin"; then
  echo "=== red-team-isolation.sh — $BASE already answers, using it as-is ==="
else
  echo "=== red-team-isolation.sh — $BASE not reachable, building + starting our own on :3014 ==="
  BASE="http://localhost:3014"
  ( cd "$APP" && npm run build ) || { echo "build failed" >&2; exit 2; }
  ( cd "$APP" && PORT=3014 NEXT_TELEMETRY_DISABLED=1 exec npm run start ) >"$TMP/server.log" 2>&1 &
  SERVER_PID=$!
  ready=0
  for _ in $(seq 1 30); do
    curl -sf -o /dev/null "$BASE/signin" && { ready=1; break; }
    sleep 1
  done
  [ "$ready" = 1 ] || { echo "server on :3014 never became ready — see $TMP/server.log" >&2; cat "$TMP/server.log" >&2; exit 2; }
fi

JAR_A="$TMP/jar-a.txt"; JAR_A2="$TMP/jar-a2.txt"; JAR_A3="$TMP/jar-a3.txt"; JAR_B="$TMP/jar-b.txt"; JAR_OMAR="$TMP/jar-omar.txt"
: > "$JAR_A"; : > "$JAR_A2"; : > "$JAR_A3"; : > "$JAR_B"; : > "$JAR_OMAR"

PASS=0; FAIL=0
check() {  # check <FR> <desc> <0|1>
  local fr="$1" desc="$2" ok="$3"
  if [ "$ok" = 1 ]; then printf 'PASS  %-9s %s\n' "$fr" "$desc"; PASS=$((PASS+1))
  else                   printf 'FAIL  %-9s %s\n' "$fr" "$desc"; FAIL=$((FAIL+1)); fi
}
note() { printf '      %-9s %s\n' "" "$*"; }

# req METHOD PATH JAR [DATA] [EXTRA_HEADER] — status code on stdout, body in
# $BODY, response headers in $HDRS. JAR "-" means no cookie jar at all.
req() {
  local method="$1" path="$2" jar="$3" data="${4:-}" xhdr="${5:-}"
  local args=(-sS -D "$HDRS" -o "$BODY" -w '%{http_code}' -X "$method")
  [ "$jar" != "-" ] && args+=(-b "$jar" -c "$jar")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' -d "$data")
  [ -n "$xhdr" ] && args+=(-H "$xhdr")
  curl "${args[@]}" "$BASE$path"
}

cookie_value() { # cookie_value JAR NAME
  awk -v n="$2" '$6==n{print $7}' "$1" | tail -1
}

echo "    target: $BASE"

# ------------------------------------------------------------- idempotent setup
say_section() { printf '\n--- %s ---\n' "$*"; }

say_section "0. cleanup any previous run's test accounts (idempotency)"
cleanup_account() {
  local email="$1"
  local aid sid
  aid=$(psql_maint -c "SELECT id FROM accounts WHERE lower(email)=lower('$email')")
  if [ -z "$aid" ]; then note "$email: nothing to clean up"; return 0; fi
  sid=$(psql_maint -c "SELECT id FROM students WHERE account_id=$aid")
  if [ -n "$sid" ]; then
    psql_maint -c "DELETE FROM explanation_log WHERE attempt_id IN (SELECT id FROM attempts WHERE student_id=$sid)" >/dev/null
    psql_maint -c "DELETE FROM attempts WHERE student_id=$sid" >/dev/null
    psql_maint -c "DELETE FROM mastery WHERE student_id=$sid" >/dev/null
    psql_maint -c "DELETE FROM ai_interactions WHERE student_id=$sid" >/dev/null
    psql_maint -c "DELETE FROM understanding_checks WHERE student_id=$sid" >/dev/null
    psql_maint -c "DELETE FROM uploads WHERE student_id=$sid" >/dev/null
    psql_maint -c "DELETE FROM analytics_events WHERE student_id=$sid" >/dev/null
    psql_maint -c "DELETE FROM sessions WHERE student_id=$sid" >/dev/null
    psql_maint -c "DELETE FROM safety_flags WHERE student_id=$sid" >/dev/null 2>/dev/null || true
    psql_maint -c "DELETE FROM guardians WHERE student_id=$sid" >/dev/null 2>/dev/null || true
    psql_maint -c "DELETE FROM students WHERE id=$sid" >/dev/null
  fi
  psql_maint -c "DELETE FROM accounts WHERE id=$aid" >/dev/null
  rm -f "$APP/.local-mail/${email}.txt"
  note "$email: removed prior account $aid (student ${sid:-none})"
}
cleanup_account "qa-a@local.test"
cleanup_account "qa-b@local.test"

# =====================================================================
# 1. FR-2104 — the picker is gone; /pipeline is off the student build
# =====================================================================
# Phase 2 re-homed /pipeline (and /admin/*, /gallery, /dev/*) onto the console
# build (FR-2201), so on the student build it must now 404 like any other
# route that does not exist there — not render 200 with content scrubbed out.
# The "no cross-student transcript leaks on /pipeline" proof belongs to the
# console build now and lives in scripts/console-smoke.sh, not here.
say_section "1. demo-students and /pipeline both gone from the student build"

code=$(req GET /api/demo-students -)
check FR-2104 "GET /api/demo-students -> 404 (was: $code)" "$([ "$code" = 404 ] && echo 1 || echo 0)"

code=$(req GET /pipeline -)
check FR-2104 "GET /pipeline (student build) -> 404 (was: $code)" "$([ "$code" = 404 ] && echo 1 || echo 0)"
note "cross-student transcript leak proof for /pipeline now lives in scripts/console-smoke.sh (console build, FR-2201)"

# =====================================================================
# 2. Anonymous: pages redirect, APIs 401
# =====================================================================
say_section "2. anonymous visitor"

for p in /student /dashboard; do
  code=$(req GET "$p" -)
  loc=$(grep -i '^location:' "$HDRS" | tr -d '\r' | awk '{print $2}')
  ok=0
  case "$code" in 3??) [[ "$loc" == *"/signin"* && "$loc" == *"next="* ]] && ok=1 ;; esac
  check FR-2107 "GET $p (anonymous) -> $code Location: ${loc:-<none>}" "$ok"
done

for p in "/api/dashboard GET" "/api/tts POST" "/api/visuals GET" "/api/analytics POST"; do
  set -- $p
  code=$(req "$2" "$1" -)
  check FR-2101 "$2 $1 (anonymous) -> 401 (was: $code)" "$([ "$code" = 401 ] && echo 1 || echo 0)"
done

# =====================================================================
# 3/4. Signup A and B, verify both
# =====================================================================
say_section "3. signup + verify A (qa-a@local.test)"

signup() {
  local email="$1" jar="$2" name="$3"
  req POST /api/auth/signup "$jar" \
    "{\"email\":\"$email\",\"password\":\"correct-horse-battery\",\"displayName\":\"$name\",\"grade\":\"9\"}"
}
token_count() {  # token_count EMAIL -> how many "token=" links the mail file holds so far
  local f="$APP/.local-mail/$1.txt" n=0
  [ -f "$f" ] && n=$(grep -c 'token=' "$f")
  echo "$n"
}
# Mail dispatch is fire-and-forget (`void sendMail(...)`, after the response
# commits), so the file may not have the newest link yet the instant curl
# returns — and for an address that already has mail (e.g. B's reset after
# B's verification), the file already contains an OLDER token, so merely
# waiting for "a token to exist" would race and grab the stale one. Callers
# pass the count from BEFORE they triggered the mail, and this waits for a
# NEW one to land before reading the last (newest) link.
wait_for_new_token() {  # wait_for_new_token EMAIL PREV_COUNT
  local email="$1" prev="$2"
  local f="$APP/.local-mail/${email}.txt"
  for _ in $(seq 1 30); do
    if [ "$(token_count "$email")" -gt "$prev" ]; then
      grep -o 'token=[^"[:space:]&]*' "$f" | tail -1 | sed 's/^token=//'
      return 0
    fi
    sleep 0.2
  done
  echo ""
}

mail_before=$(token_count "qa-a@local.test")
code=$(signup "qa-a@local.test" "$JAR_A" "QA Alpha")
cookies_ok=$([ "$(grep -ci '^set-cookie:.*httponly' "$HDRS")" = 2 ] && echo 1 || echo 0)
check FR-2001 "POST /api/auth/signup A -> 201, 2 HttpOnly Set-Cookie (was: $code)" "$([ "$code" = 201 ] && [ "$cookies_ok" = 1 ] && echo 1 || echo 0)"

code=$(req GET /api/auth/me "$JAR_A")
unverified=$(jq -r '.emailVerified' "$BODY" 2>/dev/null)
check FR-2004 "GET /api/auth/me (A, pre-verify) emailVerified:false (was: $unverified)" "$([ "$unverified" = "false" ] && echo 1 || echo 0)"

code=$(req POST /api/ask "$JAR_A" '{"chatSession":"qa-probe","messages":[{"role":"user","content":"hi"}]}')
err=$(jq -r '.error' "$BODY" 2>/dev/null)
check FR-2004 "POST /api/ask (A, unverified) -> 403 email_unverified (was: $code $err)" "$([ "$code" = 403 ] && [ "$err" = "email_unverified" ] && echo 1 || echo 0)"

tok_a=$(wait_for_new_token "qa-a@local.test" "$mail_before")
verify_ok=0
if [ -n "$tok_a" ]; then
  code=$(req GET "/api/auth/verify?token=$tok_a" -)
  loc=$(grep -i '^location:' "$HDRS" | tr -d '\r' | awk '{print $2}')
  [[ "$code" =~ ^3 ]] && [[ "$loc" == *"/student"* ]] && verify_ok=1
fi
check FR-2004 "GET /api/auth/verify?token=... (A) -> redirect /student (link found: $([ -n "$tok_a" ] && echo yes || echo no))" "$verify_ok"

code=$(req GET /api/auth/me "$JAR_A")
verified_now=$(jq -r '.emailVerified' "$BODY" 2>/dev/null)
check FR-2004 "GET /api/auth/me (A, post-verify) emailVerified:true (was: $verified_now)" "$([ "$verified_now" = "true" ] && echo 1 || echo 0)"

say_section "4. signup + verify B (qa-b@local.test)"

mail_before=$(token_count "qa-b@local.test")
code=$(signup "qa-b@local.test" "$JAR_B" "QA Bravo")
cookies_ok=$([ "$(grep -ci '^set-cookie:.*httponly' "$HDRS")" = 2 ] && echo 1 || echo 0)
check FR-2001 "POST /api/auth/signup B -> 201, 2 HttpOnly Set-Cookie (was: $code)" "$([ "$code" = 201 ] && [ "$cookies_ok" = 1 ] && echo 1 || echo 0)"

tok_b=$(wait_for_new_token "qa-b@local.test" "$mail_before")
verify_ok=0
if [ -n "$tok_b" ]; then
  code=$(req GET "/api/auth/verify?token=$tok_b" -)
  loc=$(grep -i '^location:' "$HDRS" | tr -d '\r' | awk '{print $2}')
  [[ "$code" =~ ^3 ]] && [[ "$loc" == *"/student"* ]] && verify_ok=1
fi
check FR-2004 "GET /api/auth/verify?token=... (B) -> redirect /student (link found: $([ -n "$tok_b" ] && echo yes || echo no))" "$verify_ok"

code=$(req GET /api/auth/me "$JAR_B")
verified_now=$(jq -r '.emailVerified' "$BODY" 2>/dev/null)
check FR-2004 "GET /api/auth/me (B, post-verify) emailVerified:true (was: $verified_now)" "$([ "$verified_now" = "true" ] && echo 1 || echo 0)"

req GET /api/auth/me "$JAR_A" >/dev/null
A_STUDENT_ID=$(jq -r '.studentId' "$BODY")
req GET /api/auth/me "$JAR_B" >/dev/null
B_STUDENT_ID=$(jq -r '.studentId' "$BODY")
A_ACCOUNT_ID=$(psql_maint -c "SELECT id FROM accounts WHERE lower(email)='qa-a@local.test'")
B_ACCOUNT_ID=$(psql_maint -c "SELECT id FROM accounts WHERE lower(email)='qa-b@local.test'")
OMAR_STUDENT_ID=$(psql_maint -c "SELECT id FROM students WHERE display_name='Omar (demo)'")
note "resolved ids: A student=$A_STUDENT_ID account=$A_ACCOUNT_ID; B student=$B_STUDENT_ID account=$B_ACCOUNT_ID; Omar student=$OMAR_STUDENT_ID"

# =====================================================================
# 5. Omar signs in; dashboard shows his own data
# =====================================================================
say_section "5. sign in as omar@local.test"

code=$(req POST /api/auth/login "$JAR_OMAR" '{"email":"omar@local.test","password":"omar-local-test"}')
check "auth.md" "POST /api/auth/login (omar) -> 200 (was: $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"

# Give the dashboard something non-zero to show — a fresh --reset (Part A)
# starts Omar at zero attempts, so this is the proof's own fixture data, not a
# leftover from manual testing. One extra live attempt, harmless and additive
# on every re-run.
OMAR_QID=$(psql_maint -c "SELECT id FROM questions WHERE status='live' AND question_type='numeric' ORDER BY id LIMIT 1")
OMAR_ANSWER=$(psql_maint -c "SELECT correct_answer FROM questions WHERE id='$OMAR_QID'")
req POST /api/attempts "$JAR_OMAR" "{\"questionId\":\"$OMAR_QID\",\"givenAnswer\":\"$OMAR_ANSWER\",\"timeMs\":1000}" >/dev/null

code=$(req GET /api/dashboard "$JAR_OMAR")
total_attempts=$(jq '[.topics[].attempts] | add // 0' "$BODY" 2>/dev/null)
check FR-401 "GET /api/dashboard (omar) -> 200, non-zero attempts (was: $code, attempts=$total_attempts)" "$([ "$code" = 200 ] && [ "${total_attempts:-0}" -gt 0 ] 2>/dev/null && echo 1 || echo 0)"

# =====================================================================
# 6. Attribution: attempts/analytics always write the PRINCIPAL's id;
#    uploads cross-student read is 404, indistinguishable from a fake id
# =====================================================================
say_section "6. attribution on write, 404 on cross-student read"

A_QID=$(psql_maint -c "SELECT id FROM questions WHERE status='live' AND question_type='numeric' ORDER BY id DESC LIMIT 1")
A_ANSWER=$(psql_maint -c "SELECT correct_answer FROM questions WHERE id='$A_QID'")
code=$(req POST /api/attempts "$JAR_A" "{\"questionId\":\"$A_QID\",\"givenAnswer\":\"$A_ANSWER\",\"timeMs\":1000}")
row_owner=$(psql_maint -c "SELECT student_id FROM attempts WHERE question_id='$A_QID' ORDER BY id DESC LIMIT 1")
check FR-2102 "POST /api/attempts (A) -> 200, row.student_id = A (was: $code, owner=$row_owner)" "$([ "$code" = 200 ] && [ "$row_owner" = "$A_STUDENT_ID" ] && echo 1 || echo 0)"

code=$(req POST /api/analytics "$JAR_A" "{\"event\":\"dashboard_viewed\",\"studentId\":$OMAR_STUDENT_ID,\"properties\":{\"probe\":\"redteam-attribution\"}}")
row_owner=$(psql_maint -c "SELECT student_id FROM analytics_events WHERE event='dashboard_viewed' AND properties->>'probe'='redteam-attribution' ORDER BY id DESC LIMIT 1")
check FR-2102 "POST /api/analytics (A, claims Omar's id) -> row.student_id = A, not Omar (was: $code, owner=$row_owner, claimed=$OMAR_STUDENT_ID)" "$([ "$code" = 200 ] && [ "$row_owner" = "$A_STUDENT_ID" ] && echo 1 || echo 0)"

code1=$(req GET /api/uploads/1 "$JAR_B"); body1=$(cat "$BODY")
code2=$(req GET /api/uploads/99999 "$JAR_B"); body2=$(cat "$BODY")
same=$([ "$body1" = "$body2" ] && echo 1 || echo 0)
check FR-2103 "GET /api/uploads/1 vs /api/uploads/99999 (as B) -> both 404, byte-identical body (was: $code1/$code2, identical=$same)" "$([ "$code1" = 404 ] && [ "$code2" = 404 ] && [ "$same" = 1 ] && echo 1 || echo 0)"

# =====================================================================
# 7. Lockout: 5 wrong passwords, then a DB-side clear so later steps can
#    sign in as A again (no operator console exists yet to clear it via API —
#    see report: lockout_cleared is pre-classified unobservable in P1)
# =====================================================================
say_section "7. lockout (5 failed sign-ins for A)"

fifth_code=""; fifth_until=""
for i in 1 2 3 4 5; do
  code=$(req POST /api/auth/login - '{"email":"qa-a@local.test","password":"wrong-password-'"$i"'"}')
  if [ "$i" = 5 ]; then fifth_code="$code"; fifth_until=$(jq -r '.until' "$BODY" 2>/dev/null); fi
done
check FR-2011 "5th wrong password for A -> 423 with 'until' (was: $fifth_code, until=$fifth_until)" "$([ "$fifth_code" = 423 ] && [ -n "$fifth_until" ] && [ "$fifth_until" != "null" ] && echo 1 || echo 0)"

failed_count=$(psql_maint -c "SELECT count(*) FROM auth_events WHERE event='failed_login' AND actor_id=$A_ACCOUNT_ID")
locked_count=$(psql_maint -c "SELECT count(*) FROM auth_events WHERE event='account_locked' AND actor_id=$A_ACCOUNT_ID")
check FR-2011 "auth_events: failed_login x$failed_count (>=4), account_locked x$locked_count (>=1) for A" "$([ "${failed_count:-0}" -ge 4 ] && [ "${locked_count:-0}" -ge 1 ] && echo 1 || echo 0)"

# Test-fixture cleanup, not an application code path: mirrors clearExpiredLockout's
# own SQL exactly (throttle.ts) so step 10 can sign in as A again. No
# `lockout_cleared` event is expected from this — that event's only producers
# are the automatic expiry sweep and an operator console action, neither of
# which exists to call here (P2). Noted, not asserted.
psql_maint -c "UPDATE accounts SET locked_until = NULL, failed_attempts = 0, status = 'active' WHERE id = $A_ACCOUNT_ID" >/dev/null
note "A unlocked via maint DSN (test fixture reset, mirrors throttle.ts's own clear-lockout SQL) so step 10 can sign in as A again"

# =====================================================================
# 8. Refresh reuse: rotating then replaying the OLD refresh token revokes
#    every session for B
# =====================================================================
say_section "8. refresh-token reuse detection (B)"

old_rt=$(cookie_value "$JAR_B" ainext_rt)
code=$(req POST /api/auth/refresh "$JAR_B")
new_rt=$(cookie_value "$JAR_B" ainext_rt)
rotated_ok=$([ "$code" = 200 ] && [ -n "$new_rt" ] && [ "$new_rt" != "$old_rt" ] && echo 1 || echo 0)
check FR-2008 "POST /api/auth/refresh (B) -> 200, new ainext_rt != old (was: $code)" "$rotated_ok"

code=$(req POST /api/auth/refresh - "" "Cookie: ainext_rt=$old_rt")
check FR-2008 "POST /api/auth/refresh replaying B's OLD ainext_rt -> 401 (was: $code)" "$([ "$code" = 401 ] && echo 1 || echo 0)"

live_sessions=$(psql_maint -c "SELECT count(*) FROM auth_sessions WHERE account_id=$B_ACCOUNT_ID AND revoked_at IS NULL")
check FR-2008 "auth_sessions: 0 non-revoked for B after reuse (was: $live_sessions)" "$([ "${live_sessions:-1}" = 0 ] && echo 1 || echo 0)"

susp=$(psql_maint -c "SELECT count(*) FROM auth_events WHERE event='suspicious_activity' AND actor_id=$B_ACCOUNT_ID")
revk=$(psql_maint -c "SELECT count(*) FROM auth_events WHERE event='session_revoked' AND actor_id=$B_ACCOUNT_ID")
check FR-2008 "auth_events: suspicious_activity x$susp, session_revoked x$revk for B" "$([ "${susp:-0}" -ge 1 ] && [ "${revk:-0}" -ge 1 ] && echo 1 || echo 0)"

# =====================================================================
# 9. Forgot / reset password for B
# =====================================================================
say_section "9. forgot-password / reset-password (B)"

mail_before=$(token_count "qa-b@local.test")
code=$(req POST /api/auth/forgot-password - '{"email":"qa-b@local.test"}')
check FR-2010 "POST /api/auth/forgot-password (B) -> 202 (was: $code)" "$([ "$code" = 202 ] && echo 1 || echo 0)"

reset_tok=$(wait_for_new_token "qa-b@local.test" "$mail_before")
new_pw="new-correct-horse-42"
code=$(req POST /api/auth/reset-password - "{\"token\":\"$reset_tok\",\"password\":\"$new_pw\"}")
check FR-2010 "POST /api/auth/reset-password (B, valid token) -> 200 (was: $code, token found: $([ -n "$reset_tok" ] && echo yes || echo no))" "$([ "$code" = 200 ] && echo 1 || echo 0)"

code=$(req POST /api/auth/login "$JAR_B" '{"email":"qa-b@local.test","password":"correct-horse-battery"}')
check FR-2010 "POST /api/auth/login (B, OLD password after reset) -> 401 (was: $code)" "$([ "$code" = 401 ] && echo 1 || echo 0)"

code=$(req POST /api/auth/login "$JAR_B" "{\"email\":\"qa-b@local.test\",\"password\":\"$new_pw\"}")
check FR-2010 "POST /api/auth/login (B, NEW password) -> 200 (was: $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"

prr=$(psql_maint -c "SELECT count(*) FROM auth_events WHERE event='password_reset_requested' AND actor_id=$B_ACCOUNT_ID")
pc=$(psql_maint -c "SELECT count(*) FROM auth_events WHERE event='password_changed' AND actor_id=$B_ACCOUNT_ID")
check FR-2010 "auth_events: password_reset_requested x$prr, password_changed x$pc for B" "$([ "${prr:-0}" -ge 1 ] && [ "${pc:-0}" -ge 1 ] && echo 1 || echo 0)"

# =====================================================================
# 10. logout, and the session list's own-resource boundary
# =====================================================================
say_section "10. logout, session list, DELETE ownership boundary"

code=$(req POST /api/auth/logout "$JAR_A")
check FR-2012 "POST /api/auth/logout (A's original session) -> 204 (was: $code)" "$([ "$code" = 204 ] && echo 1 || echo 0)"
code=$(req GET /api/auth/me "$JAR_A")
check FR-2012 "GET /api/auth/me (A, after logout) -> 401 (was: $code)" "$([ "$code" = 401 ] && echo 1 || echo 0)"

code=$(req POST /api/auth/login "$JAR_A2" '{"email":"qa-a@local.test","password":"correct-horse-battery"}')
ok1=$([ "$code" = 200 ] && echo 1 || echo 0)
code=$(req POST /api/auth/login "$JAR_A3" '{"email":"qa-a@local.test","password":"correct-horse-battery"}')
ok2=$([ "$code" = 200 ] && echo 1 || echo 0)
check "auth.md" "sign in as A twice (fresh jars, post-unlock) -> both 200" "$([ "$ok1" = 1 ] && [ "$ok2" = 1 ] && echo 1 || echo 0)"

code=$(req GET /api/auth/sessions "$JAR_A2")
n=$(jq '.sessions | length' "$BODY" 2>/dev/null)
check FR-2009 "GET /api/auth/sessions (A) lists 2 (was: $code, n=$n)" "$([ "$code" = 200 ] && [ "$n" = 2 ] && echo 1 || echo 0)"
other_a_id=$(jq -r '.sessions[] | select(.current==false) | .id' "$BODY" 2>/dev/null | head -1)

code=$(req GET /api/auth/sessions "$JAR_B")
b_session_id=$(jq -r '.sessions[0].id' "$BODY" 2>/dev/null)

code=$(req DELETE "/api/auth/sessions/$b_session_id" "$JAR_A2")
check FR-2009 "DELETE /api/auth/sessions/{B's id} as A -> 404, not 403 (was: $code)" "$([ "$code" = 404 ] && echo 1 || echo 0)"

code=$(req DELETE "/api/auth/sessions/$other_a_id" "$JAR_A2")
check FR-2009 "DELETE /api/auth/sessions/{A's OTHER own session} as A -> 204 (was: $code)" "$([ "$code" = 204 ] && echo 1 || echo 0)"

# =====================================================================
# 11. Database-level isolation (as ainext_app, the app's own role)
# =====================================================================
say_section "11. database-level isolation (ainext_app)"

no_principal_attempts=$(psql_app -c "SELECT count(*) FROM attempts")
check SC-102 "psql as ainext_app, no principal: SELECT count(*) FROM attempts = 0 (was: $no_principal_attempts)" "$([ "${no_principal_attempts:-1}" = 0 ] && echo 1 || echo 0)"

no_principal_students=$(psql_app -c "SELECT count(*) FROM students")
accounted_students=$(psql_maint -c "SELECT count(*) FROM students WHERE account_id IS NOT NULL")
legacy_students=$(psql_maint -c "SELECT count(*) FROM students WHERE account_id IS NULL")
check FR-2101 "psql as ainext_app, no principal: students visible ($no_principal_students) = accounted rows ($accounted_students), legacy ($legacy_students) invisible" "$([ "$no_principal_students" = "$accounted_students" ] && echo 1 || echo 0)"

principal_a_attempts=$(psql_app -c "BEGIN; SELECT set_config('app.student_id','$A_STUDENT_ID', true); SELECT count(*) FROM attempts; ROLLBACK;" | tail -1)
truth_a_attempts=$(psql_maint -c "SELECT count(*) FROM attempts WHERE student_id=$A_STUDENT_ID")
check SC-102 "psql as ainext_app, principal=A: sees only A's attempts ($principal_a_attempts = $truth_a_attempts)" "$([ "$principal_a_attempts" = "$truth_a_attempts" ] && echo 1 || echo 0)"

cat > "$TMP/cross.sql" <<SQL
\set ON_ERROR_STOP on
\set VERBOSITY verbose
BEGIN;
SELECT set_config('app.student_id', '$A_STUDENT_ID', true);
INSERT INTO attempts (student_id, question_id, is_correct) VALUES ($B_STUDENT_ID, '$A_QID', true);
ROLLBACK;
SQL
psql "$APP_DSN" -f "$TMP/cross.sql" >"$TMP/cross.out" 2>"$TMP/cross.err"
cross_rc=$?
cross_denied=$([ "$cross_rc" -ne 0 ] && grep -qi '42501' "$TMP/cross.err" && grep -qi 'row-level security' "$TMP/cross.err" && echo 1 || echo 0)
check FR-2103 "psql as ainext_app, principal=A: INSERT attempts(student_id=B) -> 42501 (no HTTP route accepts a foreign student id — see note)" "$cross_denied"
note "FR-2103's write branch has NO reachable HTTP trigger: every student route resolves studentId from the access token, never the request body (confirmed by reading attempts/analytics/uploads/dashboard routes). This is the database-level proof the contract's addendum asks for in its place; the app-layer 403+cross_student_access_denied code in lib/rls-errors.ts is defence-in-depth that no current route path can exercise."

for probe in "SELECT * FROM operators" "DELETE FROM attempts"; do
  psql "$APP_DSN" -v ON_ERROR_STOP=1 -c "$probe" >"$TMP/p.out" 2>"$TMP/p.err"
  denied=$(grep -qi 'permission denied' "$TMP/p.err" && echo 1 || echo 0)
  check FR-2101 "psql as ainext_app: $probe -> permission denied" "$denied"
done

# =====================================================================
# 12. The 13 FR-2501 security events — which fired in this run
# =====================================================================
say_section "12. FR-2501 — 13 required security events"

declare -a REQUIRED=(successful_login failed_login account_locked lockout_cleared \
  password_changed password_reset_requested email_verification_sent \
  email_verification_succeeded session_revoked permission_denied \
  cross_student_access_denied operator_login admin_transcript_viewed)
declare -a MAY_BE_ABSENT_P1=(lockout_cleared permission_denied cross_student_access_denied operator_login admin_transcript_viewed)

observed=$(psql_maint -c "SELECT DISTINCT event FROM auth_events ORDER BY 1")
observed_ok=0; observed_missing=0
for ev in "${REQUIRED[@]}"; do
  if echo "$observed" | grep -qx "$ev"; then
    printf '  observed      %s\n' "$ev"
    observed_ok=$((observed_ok+1))
  else
    absentok=0
    for m in "${MAY_BE_ABSENT_P1[@]}"; do [ "$m" = "$ev" ] && absentok=1; done
    if [ "$absentok" = 1 ]; then
      printf '  not observed  %s  (legitimately unobservable pre-P2 — no console/operator surface exists to exercise it, or FR-2103 write branch has no HTTP trigger per the contract addendum)\n' "$ev"
    else
      printf '  MISSING       %s  (required, NOT pre-classified as P1-unobservable)\n' "$ev"
      observed_missing=$((observed_missing+1))
    fi
  fi
done
check FR-2501 "8 of 13 events observed (the other 5 are pre-classified P1-unobservable), 0 unexplained misses" "$([ "$observed_ok" -ge 8 ] && [ "$observed_missing" -eq 0 ] && echo 1 || echo 0)"

# =====================================================================
echo ""
echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]

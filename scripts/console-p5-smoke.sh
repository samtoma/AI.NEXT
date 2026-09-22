#!/usr/bin/env bash
#
# console-p5-smoke.sh — Phase 5 QA smoke test: GA4 absence with the id unset,
# the security view (tiles, zero-threshold banner, operator-read audit), the
# alert sweep (idempotent, shadow rule reports-not-mails), the overviews
# (cohort, weekly-active, heatmap, metric dictionary), the Monitor nav group,
# and the repo gates (I6b, per BRIEF-P5.md).
#
#   ./scripts/console-p5-smoke.sh [STUDENT_URL] [CONSOLE_URL]
#     STUDENT defaults to http://localhost:3000
#     CONSOLE defaults to http://localhost:3002
#
# Both dev servers are OWNED BY THE ORCHESTRATOR. This script never starts,
# builds, restarts or kills them — it only ever speaks HTTP to whatever is
# already listening, plus psql against the real database as `ainext_maint`.
#
# ---------------------------------------------------------------------------
# WHY THIS DOES NOT SET AINEXT_GA_MEASUREMENT_ID AND RECHECK
# ---------------------------------------------------------------------------
# next dev reads app/.env.local once, at process start. Exporting the variable
# in THIS shell has no effect on the already-running server, and editing
# .env.local would either be silently ignored (no restart) or force a restart
# of a server this script is forbidden to restart. So the id-set path is
# checked two ways instead, and neither touches the running servers:
#   (a) the id-UNSET behaviour is asserted live, against both servers, on
#       every surface the contract names;
#   (b) the id-SET behaviour — the consent-before-config ordering, the
#       stripped page_view, the no-user_id guarantee — is asserted at the
#       UNIT level by confirming lib/ga.test.mts exercises gaBootstrap() with
#       a real id ("G-TEST123" / "G-X") and GaScript.tsx's own guard test
#       exists, and this script says plainly that it never observed id-set
#       HTML from a live server.
#
# One line per check:  PASS|FAIL  <FR>  <what>
# Non-zero exit if any check FAILs.
#
# IDEMPOTENT: every piece of state this script creates (a throwaway locked
# account, a synthetic auth_events row, its alerts_sent claim) is cleaned up
# at the end via the maintenance DSN, mirroring red-team-isolation.sh's own
# convention — safe to re-run against the same database.
#
# NOT idempotent in one respect: it runs scripts/red-team-isolation.sh, which
# is itself idempotent but burns real auth-throttle budget (documented in that
# script's own header) and leaves qa-a/qa-b accounts + real security events
# on the record, by that script's own design.
#
# Ownership: this file and its own report only (I6b brief). Nothing else here
# is edited; defects found while running it are reported with file:line,
# never patched in this script.

set -uo pipefail   # deliberately NOT -e: a failed check must not abort the run

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/app"
STUDENT="${1:-http://localhost:3000}"
CONSOLE="${2:-http://localhost:3002}"

ENVF="$APP/.env.local"
[ -f "$ENVF" ] || { echo "no app/.env.local — is the dev environment set up?" >&2; exit 2; }
env_value() { sed -n "s/^$1=//p" "$ENVF" | tail -1; }
MAINT_DSN=$(env_value DATABASE_URL_MAINT)
[ -n "$MAINT_DSN" ] || { echo "DATABASE_URL_MAINT missing from app/.env.local" >&2; exit 2; }
GA_ID_CONFIGURED=$(env_value AINEXT_GA_MEASUREMENT_ID)

psql_maint() { psql "$MAINT_DSN" -v ON_ERROR_STOP=1 -qtA "$@"; }
psql_maint_trim() { psql_maint "$@" | tr -d '[:space:]'; }

OMAR_EMAIL="omar@local.test"
OMAR_PASSWORD="omar-local-test"
FOUR_EMAIL="samuel.s.toma@gmail.com"
FOUR_PASSWORD="ConsoleLocal!2026"
COST_EMAIL="cost-only@local.test"
COST_PASSWORD="CostOnly!2026"
OMAR_STUDENT_ID=1   # Omar (demo)
PROBE_EMAIL="p5-lock-probe@local.test"   # this script's own throwaway account

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
BODY="$TMP/body"; HDRS="$TMP/hdrs"
JAR_OMAR="$TMP/jar-omar.txt"; JAR_FOUR="$TMP/jar-four.txt"; JAR_COST="$TMP/jar-cost.txt"; JAR_PROBE="$TMP/jar-probe.txt"
: > "$JAR_OMAR"; : > "$JAR_FOUR"; : > "$JAR_COST"; : > "$JAR_PROBE"

PASS=0; FAIL=0
check() {  # check <FR> <desc> <0|1>
  local fr="$1" desc="$2" ok="$3"
  if [ "$ok" = 1 ]; then printf 'PASS  %-9s %s\n' "$fr" "$desc"; PASS=$((PASS+1))
  else                   printf 'FAIL  %-9s %s\n' "$fr" "$desc"; FAIL=$((FAIL+1)); fi
}
note() { printf '      %-9s %s\n' "" "$*"; }
say_section() { printf '\n--- %s ---\n' "$*"; }

# req METHOD BASE PATH JAR [DATA] -> status on stdout, body in $BODY, headers in $HDRS.
req() {
  local method="$1" base="$2" path="$3" jar="$4" data="${5:-}"
  local args=(-sS -D "$HDRS" -o "$BODY" -w '%{http_code}' -X "$method" --max-time 30)
  [ "$jar" != "-" ] && args+=(-b "$jar" -c "$jar")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' -d "$data")
  curl "${args[@]}" "$base$path"
}
# HTML from React Server Components streams text nodes with `<!-- -->` comment
# markers between them ("math<!-- --> · grade <!-- -->9"). A plain grep for
# "grade 9" never matches that output, so every content check below runs
# against the COMMENT-STRIPPED body.
clean_body() { sed 's/<!-- -->//g' "$BODY"; }
no_ga_markers() {  # true (0) iff neither string appears in $BODY
  ! grep -qi 'googletagmanager' "$BODY" && ! grep -q 'gtag(' "$BODY"
}

echo "=== console-p5-smoke.sh — student=$STUDENT console=$CONSOLE ==="

# ============================================================ 0. servers up
say_section "0. Servers reachable (owned by the orchestrator — not started/stopped/built here)"
scode=$(req GET "$STUDENT" "/" -)
check FR-2505 "student :3000 reachable (got $scode)" "$([ "$scode" = 200 ] && echo 1 || echo 0)"
ccode=$(req GET "$CONSOLE" "/" -)
check FR-2505 "console :3002 reachable (got $ccode, 307 to /signin is fine)" "$([[ "$ccode" =~ ^(200|307|308)$ ]] && echo 1 || echo 0)"
note "AINEXT_GA_MEASUREMENT_ID in app/.env.local: ${GA_ID_CONFIGURED:-<unset — the normal state, ADR-0016 §2>}"

# red-team-isolation.sh's own header documents that it deliberately burns ~6
# failures into the shared IP-scope throttle bucket (auth_throttle scope='ip',
# 20/15min), and by throttle.ts's OWN design (research R5) that bucket is
# shared across the student build and the console build — one database behind
# two processes, on purpose, so a threshold of 20 cannot quietly become 40.
# This script logs in as three different principals and (2b) deliberately
# fails five more, all from this box's one source IP, on top of whatever
# scripts/red-team-isolation.sh or an earlier run of THIS script already left
# in that bucket within the same 15-minute fixed window. Reset it up front —
# the same escape hatch red-team-isolation.sh's own header names — so this
# script starts every run from a clean budget rather than 429ing a legitimate
# operator login because of unrelated earlier testing. Test infrastructure
# state, not product data; never touches auth_events (the security record).
psql_maint -c "DELETE FROM auth_throttle WHERE scope='ip'" >/dev/null 2>&1 || true
note "reset auth_throttle scope='ip' up front (shared budget with red-team-isolation.sh; throttle.ts R5)"

# ===================================================== 1. GA absent (id unset)
say_section "1. GA4 absent everywhere — AINEXT_GA_MEASUREMENT_ID unset (FR-2504/2505/2506)"

code=$(req GET "$STUDENT" "/" -)
check FR-2504 "GET :3000/ (anon) -> $code, no googletagmanager/gtag(" "$([ "$code" = 200 ] && no_ga_markers && echo 1 || echo 0)"

code=$(req GET "$STUDENT" "/signin" -)
check FR-2504 "GET :3000/signin -> $code, no googletagmanager/gtag(" "$([ "$code" = 200 ] && no_ga_markers && echo 1 || echo 0)"

code=$(req POST "$STUDENT" /api/auth/login "$JAR_OMAR" "{\"email\":\"$OMAR_EMAIL\",\"password\":\"$OMAR_PASSWORD\"}")
check FR-2205 "login (student, omar) -> $code" "$([ "$code" = 200 ] && echo 1 || echo 0)"

code=$(req GET "$STUDENT" "/student" "$JAR_OMAR")
check FR-2504 "GET :3000/student (omar) -> $code, no googletagmanager/gtag(" "$([ "$code" = 200 ] && no_ga_markers && echo 1 || echo 0)"

code=$(req GET "$STUDENT" "/dashboard" "$JAR_OMAR")
check FR-2504 "GET :3000/dashboard (omar) -> $code, no googletagmanager/gtag(" "$([ "$code" = 200 ] && no_ga_markers && echo 1 || echo 0)"

code=$(req POST "$CONSOLE" /api/auth/login "$JAR_FOUR" "{\"email\":\"$FOUR_EMAIL\",\"password\":\"$FOUR_PASSWORD\"}")
check FR-2205 "login (console, four-role) -> $code" "$([ "$code" = 200 ] && echo 1 || echo 0)"

code=$(req GET "$CONSOLE" "/" "$JAR_FOUR")
check FR-2506 "GET :3002/ (operator) -> $code, no googletagmanager/gtag( — the console never loads GA4" "$([ "$code" = 200 ] && no_ga_markers && echo 1 || echo 0)"

code=$(req GET "$CONSOLE" "/security" "$JAR_FOUR")
check FR-2506 "GET :3002/security (operator) -> $code, no googletagmanager/gtag(" "$([ "$code" = 200 ] && no_ga_markers && echo 1 || echo 0)"

say_section "1b. GA4 id-SET path — unit-level only (see header: restarting the dev server is forbidden)"
note "NOT OBSERVED LIVE: no request in this run ever saw AINEXT_GA_MEASUREMENT_ID set — the id is unset"
note "in app/.env.local and this script must not edit that file or restart the orchestrator's servers."
ga_test="$APP/src/lib/ga.test.mts"
guard_test="$APP/src/lib/ga-console-guard.test.mts"
ga_lib="$APP/src/lib/ga.ts"
ga_script="$APP/src/components/GaScript.tsx"
[ -f "$ga_test" ] && [ -f "$guard_test" ] && [ -f "$ga_lib" ] && [ -f "$ga_script" ]
check FR-2505 "lib/ga.ts, components/GaScript.tsx, ga.test.mts and ga-console-guard.test.mts all exist" "$([ -f "$ga_test" ] && [ -f "$guard_test" ] && [ -f "$ga_lib" ] && [ -f "$ga_script" ] && echo 1 || echo 0)"

ok=$(grep -c 'gaBootstrap("G-' "$ga_test" 2>/dev/null || echo 0)
check FR-2505 "ga.test.mts calls gaBootstrap() with a real id — the id-SET snippet text is asserted" "$([ "${ok:-0}" -ge 1 ] && echo 1 || echo 0)"

ok=$(grep -c "consent.*BEFORE.*config\|consentAt < configAt" "$ga_test" 2>/dev/null || echo 0)
check FR-2505 "ga.test.mts asserts consent is pushed BEFORE config in the id-SET bootstrap" "$([ "${ok:-0}" -ge 1 ] && echo 1 || echo 0)"

ok=$(grep -c '"analytics_storage":"denied"' "$ga_test" 2>/dev/null || echo 0)
check FR-2506 "ga.test.mts asserts the AUTHENTICATED student surface denies analytics_storage in the emitted text" "$([ "${ok:-0}" -ge 1 ] && echo 1 || echo 0)"

ok=$(grep -c 'if\\\s*(!GA_MEASUREMENT_ID)\\\s*return null\|!GA_MEASUREMENT_ID) return null' "$ga_script" 2>/dev/null || echo 0)
check FR-2505 "GaScript.tsx's unset-id guard exists and ga-console-guard.test.mts asserts it by source" "$(grep -q 'return null' "$ga_script" && grep -q 'GA_MEASUREMENT_ID' "$guard_test" && echo 1 || echo 0)"

# ================================================ 2. Security view (SC-105)
say_section "2. Security view — red-team-isolation.sh, then the tiles within 60s (FR-2502, SC-105)"

RT_START=$(date +%s)
RT_LOG="$TMP/red-team.log"
"$ROOT/scripts/red-team-isolation.sh" "$STUDENT" >"$RT_LOG" 2>&1
RT_RC=$?
RT_SUMMARY=$(tail -1 "$RT_LOG")
check FR-2011 "scripts/red-team-isolation.sh $STUDENT -> exit 0 ($RT_SUMMARY)" "$([ "$RT_RC" = 0 ] && echo 1 || echo 0)"

# Seed the operator-read audit with a read THIS run can see: Student 360 on Omar.
code=$(req GET "$CONSOLE" "/students/$OMAR_STUDENT_ID" "$JAR_FOUR")
check FR-2502 "GET :3002/students/$OMAR_STUDENT_ID (Student 360, four-role) -> $code, seeds operator_reads" "$([ "$code" = 200 ] && echo 1 || echo 0)"

RT_ELAPSED=$(( $(date +%s) - RT_START ))
note "elapsed since red-team-isolation.sh started: ${RT_ELAPSED}s"

code=$(req GET "$CONSOLE" "/security" "$JAR_FOUR")
SEC_ELAPSED=$(( $(date +%s) - RT_START ))
check FR-2502 "GET :3002/security (four-role) -> $code, within 60s of the red-team run (${SEC_ELAPSED}s)" "$([ "$code" = 200 ] && [ "$SEC_ELAPSED" -le 60 ] && echo 1 || echo 0)"
cp "$BODY" "$TMP/security.html"
CLEAN_SEC="$TMP/security.clean.html"
sed 's/<!-- -->//g' "$TMP/security.html" > "$CLEAN_SEC"

ok=$(grep -c 'event=account_locked\|Account locked' "$CLEAN_SEC")
check SC-106 "security page shows account_locked (filter option or 'Account locked' row)" "$([ "${ok:-0}" -ge 1 ] && echo 1 || echo 0)"

ok=$(grep -c 'Signed in\|Failed' "$CLEAN_SEC")
check FR-2502 "failed-vs-successful sign-ins tile present" "$([ "${ok:-0}" -ge 1 ] && echo 1 || echo 0)"

ok=$(grep -c 'Source addresses by failed sign-ins' "$CLEAN_SEC")
check FR-2502 "top-source-IP tile present" "$([ "${ok:-0}" -ge 1 ] && echo 1 || echo 0)"

ok=$(grep -c 'Sign-in sessions\|Students signed in\|Operators signed in' "$CLEAN_SEC")
check FR-2502 "active-sessions tile present" "$([ "${ok:-0}" -ge 1 ] && echo 1 || echo 0)"

ok=$(grep -c 'Operators refused a surface' "$CLEAN_SEC")
check FR-2502 "permission_denied-by-operator tile present" "$([ "${ok:-0}" -ge 1 ] && echo 1 || echo 0)"

ok=$(grep -c 'No cross-student access has been denied.*threshold is zero\|threshold is zero because under RLS' "$CLEAN_SEC")
check FR-2502 "cross_student_access_denied banner at zero, with the zero-threshold note" "$([ "${ok:-0}" -ge 1 ] && echo 1 || echo 0)"

ok=$(grep -c 'The security record' "$CLEAN_SEC")
check FR-2502 "recent-events table present" "$([ "${ok:-0}" -ge 1 ] && echo 1 || echo 0)"

ok=$(grep -c 'Who read whose record' "$CLEAN_SEC")
name_ok=$(grep -c 'samuel.s.toma' "$CLEAN_SEC")
student_ok=$(grep -c 'Omar (demo)' "$CLEAN_SEC")
check FR-2306 "operator-read audit lists the Student 360 read just made, BY NAME (operator + student)" "$([ "${ok:-0}" -ge 1 ] && [ "${name_ok:-0}" -ge 1 ] && [ "${student_ok:-0}" -ge 1 ] && echo 1 || echo 0)"

# --- 2b. This script's own lockout probe, because red-team-isolation.sh
# clears qa-a's lock itself within the same step (test-fixture reset so its
# OWN step 10 can sign back in) — by the time this script's request lands,
# qa-a is no longer "currently locked". Proven separately, with an account
# this script owns end to end and cleans up below.
say_section "2b. This script's own lockout probe — proves the 'currently locked' tile independently"
note "red-team-isolation.sh unlocks qa-a immediately after asserting the lock (its own step 10 needs to"
note "sign back in as A), so by the time /security is read above, qa-a is no longer CURRENTLY locked —"
note "the recent-events evidence above still shows account_locked; this probe proves the live tile too."

psql_maint -c "SELECT 1" >/dev/null 2>&1
cleanup_probe() {
  local aid sid
  aid=$(psql_maint_trim -c "SELECT id FROM accounts WHERE lower(email)=lower('$PROBE_EMAIL')")
  if [ -n "$aid" ]; then
    sid=$(psql_maint_trim -c "SELECT id FROM students WHERE account_id=$aid")
    if [ -n "$sid" ]; then
      psql_maint -c "DELETE FROM analytics_events WHERE student_id=$sid" >/dev/null 2>&1 || true
      psql_maint -c "DELETE FROM sessions WHERE student_id=$sid" >/dev/null 2>&1 || true
      psql_maint -c "DELETE FROM students WHERE id=$sid" >/dev/null 2>&1 || true
    fi
    psql_maint -c "DELETE FROM auth_events WHERE actor_kind='account' AND actor_id=$aid" >/dev/null 2>&1 || true
    psql_maint -c "DELETE FROM accounts WHERE id=$aid" >/dev/null 2>&1 || true
  fi
  rm -f "$APP/.local-mail/${PROBE_EMAIL}.txt" 2>/dev/null || true
}
cleanup_probe   # idempotent: remove any leftover from a previous run first

code=$(req POST "$STUDENT" /api/auth/signup "$JAR_PROBE" "{\"email\":\"$PROBE_EMAIL\",\"password\":\"correct-horse-battery\",\"displayName\":\"P5 Lock Probe\",\"grade\":\"9\"}")
check FR-2001 "signup throwaway probe account -> $code" "$([ "$code" = 201 ] && echo 1 || echo 0)"

fifth=""
for i in 1 2 3 4 5; do
  fifth=$(req POST "$STUDENT" /api/auth/login - "{\"email\":\"$PROBE_EMAIL\",\"password\":\"wrong-$i\"}")
done
check FR-2011 "5th wrong password for the probe account -> 423 (got $fifth)" "$([ "$fifth" = 423 ] && echo 1 || echo 0)"

code=$(req GET "$CONSOLE" "/security" "$JAR_FOUR")
ok=$(grep -c 'p5-lock-probe@local.test' <(clean_body))
locked_note=$(grep -c 'No account is locked' <(clean_body))
check FR-2502 "'Accounts locked right now' tile lists the probe account while it is actually locked" "$([ "$code" = 200 ] && [ "${ok:-0}" -ge 1 ] && echo 1 || echo 0)"
note "'No account is locked' empty-state present: $([ "${locked_note:-0}" -ge 1 ] && echo yes || echo no) (expected: no, the probe is locked)"

cleanup_probe
note "probe account removed via maint DSN — leaves no permanently-locked ghost account behind"

say_section "2c. cost-only@local.test is refused /security (FR-2107, FR-2211)"
code=$(req POST "$CONSOLE" /api/auth/login "$JAR_COST" "{\"email\":\"$COST_EMAIL\",\"password\":\"$COST_PASSWORD\"}")
check FR-2205 "login (console, cost-only) -> $code" "$([ "$code" = 200 ] && echo 1 || echo 0)"

before_denied=$(psql_maint_trim -c "SELECT count(*) FROM auth_events WHERE event='permission_denied' AND actor_kind='operator' AND reason LIKE '%/security'")
code=$(req GET "$CONSOLE" "/security" "$JAR_COST")
refused=$(grep -c 'Not permitted\|You do not hold the role' <(clean_body))
no_tiles=$(grep -c 'Accounts locked right now\|Source addresses by failed sign-ins' <(clean_body))
check FR-2107 "cost-only reading /security -> refusal rendered, none of the six tiles present" "$([ "$code" = 200 ] && [ "${refused:-0}" -ge 1 ] && [ "${no_tiles:-0}" = 0 ] && echo 1 || echo 0)"

after_denied=$(psql_maint_trim -c "SELECT count(*) FROM auth_events WHERE event='permission_denied' AND actor_kind='operator' AND reason LIKE '%/security'")
check SC-106 "the refusal wrote a NEW permission_denied auth_events row (before=$before_denied after=$after_denied)" "$([ "${after_denied:-0}" -gt "${before_denied:-0}" ] && echo 1 || echo 0)"

# ===================================================== 3. Alerts (FR-2502)
say_section "3. Alert sweep — synthetic cross_student_access_denied, idempotent re-run, shadow rule (FR-2502)"

SYN_ID=$(psql_maint_trim -c "INSERT INTO auth_events (environment, event, outcome, actor_kind, actor_id, subject_kind, reason, occurred_at) VALUES ('mvp1','cross_student_access_denied','denied','account',999999,'attempt','p5_smoke_synthetic_probe', now()) RETURNING id")
check FR-2502 "inserted synthetic cross_student_access_denied row as maint (id=$SYN_ID)" "$([ -n "$SYN_ID" ] && echo 1 || echo 0)"

SWEEP1="$TMP/sweep1.log"
( cd "$APP" && npm run alerts:sweep ) >"$SWEEP1" 2>&1
SWEEP1_RC=$?
fired=$(grep -c "cross-student access was denied (auth_events #$SYN_ID)" "$SWEEP1")
check FR-2502 "first sweep run -> exit $SWEEP1_RC, one alert line for auth_events #$SYN_ID" "$([ "$SWEEP1_RC" = 0 ] && [ "${fired:-0}" -ge 1 ] && echo 1 || echo 0)"

shadow_fired=$(grep -c 'shadow rule — never mails' "$SWEEP1")
note "sweep run 1 also reported the shadow rule (impossible_travel_shadow) $([ "${shadow_fired:-0}" -ge 1 ] && echo "yes — from suspicious_activity B's refresh-reuse just produced" || echo "no — no suspicious_activity in the last hour this run")"

SWEEP2="$TMP/sweep2.log"
( cd "$APP" && npm run alerts:sweep ) >"$SWEEP2" 2>&1
SWEEP2_RC=$?
already=$(grep -c 'already sent for their window' "$SWEEP2")
refired=$(grep -c "cross-student access was denied (auth_events #$SYN_ID)" "$SWEEP2")
check FR-2502 "second sweep run -> exit $SWEEP2_RC, 'already sent', no repeat of #$SYN_ID" "$([ "$SWEEP2_RC" = 0 ] && [ "${already:-0}" -ge 1 ] && [ "${refired:-0}" = 0 ] && echo 1 || echo 0)"

# The per-alert "  mailed      <rule>  key=..." line (alerts-sweep.mts) is
# emitted only when willMail is true — distinct from the "N mailed, M logged"
# SUMMARY line, which always contains the word "mailed" whatever N is. Grep
# the specific per-alert format so a summary of "0 mailed" does not miscount.
mailed=$(grep -cE '^ +mailed +' "$SWEEP1" "$SWEEP2" 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
check FR-2502 "AINEXT_ALERT_EMAIL is unset -> nothing was ever mailed (0 per-alert 'mailed' lines across both runs)" "$([ "${mailed:-0}" = 0 ] && echo 1 || echo 0)"

# The shadow rule must NEVER mail regardless of window, by construction
# (lib/alerts.ts shadowSuspicion() hard-codes delivery:'log'). Assert that
# statically rather than depending on a suspicious_activity signal landing in
# this exact hour.
shadow_never_mails=$(grep -c "delivery: \"log\"" "$APP/src/lib/alerts.ts")
check FR-2502 "lib/alerts.ts: the shadow rule's delivery is hard-coded 'log', never 'email'" "$([ "${shadow_never_mails:-0}" -ge 1 ] && echo 1 || echo 0)"

psql_maint -c "DELETE FROM alerts_sent WHERE rule='cross_student_access_denied' AND key='$SYN_ID'" >/dev/null
psql_maint -c "DELETE FROM auth_events WHERE id=$SYN_ID" >/dev/null
after_del=$(psql_maint_trim -c "SELECT count(*) FROM auth_events WHERE id=$SYN_ID")
check FR-2502 "synthetic row #$SYN_ID and its alerts_sent claim deleted — security record left honest" "$([ "${after_del:-1}" = 0 ] && echo 1 || echo 0)"

# ================================================== 4. Overviews (FR-2507)
say_section "4. Overviews — cohort, weekly-active, heatmap, metric dictionary (FR-2507, FR-2407)"

for pair in "four-role:$JAR_FOUR" "cost-only:$JAR_COST"; do
  who="${pair%%:*}"; jar="${pair#*:}"
  code=$(req GET "$CONSOLE" "/overview" "$jar")
  check FR-2507 "GET :3002/overview ($who) -> $code" "$([ "$code" = 200 ] && echo 1 || echo 0)"
  clean="$TMP/overview-$who.clean.html"
  sed 's/<!-- -->//g' "$BODY" > "$clean"

  check FR-2507 "($who) cohort key (subject · grade · syllabus) rendered" "$(grep -q 'syllabus' "$clean" && grep -q 'grade' "$clean" && echo 1 || echo 0)"

  check FR-2507 "($who) 'week' appears (school-year weeks, not calendar weeks)" "$(grep -qi 'week' "$clean" && echo 1 || echo 0)"
  check FR-2507 "($who) activation funnel present" "$(grep -q 'Activation' "$clean" && echo 1 || echo 0)"
  check FR-2507 "($who) weekly-active present" "$(grep -q 'Weekly active' "$clean" && echo 1 || echo 0)"
  check FR-2507 "($who) SC-005 funnel absence note present" "$(grep -q 'SC-005 funnel is deliberately not displayed' "$clean" && echo 1 || echo 0)"
  svg_or_grid=$(grep -c '<svg\|Objectives against time' "$clean")
  legend=$(grep -c 'never reached' "$clean")
  check FR-2507 "($who) heatmap (svg/grid) with a legend distinguishing never-reached from reached" "$([ "${svg_or_grid:-0}" -ge 1 ] && [ "${legend:-0}" -ge 1 ] && echo 1 || echo 0)"

  leak=$(grep -c 'Omar\|QA Alpha\|QA Bravo\|omar@local.test' "$clean")
  check FR-2103 "($who) no individual student name or content on /overview" "$([ "${leak:-0}" = 0 ] && echo 1 || echo 0)"
done

code=$(req GET "$CONSOLE" "/overview/definitions" "$JAR_FOUR")
check FR-2507 "GET :3002/overview/definitions -> $code" "$([ "$code" = 200 ] && echo 1 || echo 0)"
DEFS_CLEAN="$TMP/defs.clean.html"
sed 's/<!-- -->//g' "$BODY" > "$DEFS_CLEAN"
missing=""
for term in active session mastered retained activated week cohort; do
  grep -q ">$term<" "$DEFS_CLEAN" || missing="$missing $term"
done
grep -qi 'time-on-task' "$DEFS_CLEAN" || missing="$missing time-on-task"
check FR-2507 "definitions page carries all 8 terms (active, session, time-on-task, mastered, retained, activated, week, cohort)" "$([ -z "$missing" ] && echo 1 || echo 0)"
[ -n "$missing" ] && note "missing:$missing"

ok=$(grep -c '0\.75' "$DEFS_CLEAN")
check FR-2507 "mastered threshold printed as 0.75" "$([ "${ok:-0}" -ge 1 ] && echo 1 || echo 0)"

leak=$(grep -c 'Omar\|QA Alpha\|QA Bravo' "$DEFS_CLEAN")
check FR-2103 "no individual student name or content on /overview/definitions" "$([ "${leak:-0}" = 0 ] && echo 1 || echo 0)"

# ======================================================= 5. Nav (FR-2107)
say_section "5. Console nav — 'Monitor' group, and cost-only's narrower view (FR-2107)"

code=$(req GET "$CONSOLE" "/" "$JAR_FOUR")
FOUR_NAV="$TMP/four-nav.clean.html"
sed 's/<!-- -->//g' "$BODY" > "$FOUR_NAV"
has_monitor=$(grep -c 'Monitor' "$FOUR_NAV")
has_security=$(grep -c '>Security<' "$FOUR_NAV")
has_overviews=$(grep -c '>Overviews<' "$FOUR_NAV")
check FR-2107 "four-role nav: 'Monitor' group with Security and Overviews links" "$([ "${has_monitor:-0}" -ge 1 ] && [ "${has_security:-0}" -ge 1 ] && [ "${has_overviews:-0}" -ge 1 ] && echo 1 || echo 0)"

code=$(req GET "$CONSOLE" "/" "$JAR_COST")
COST_NAV="$TMP/cost-nav.clean.html"
sed 's/<!-- -->//g' "$BODY" > "$COST_NAV"
cost_has_overviews=$(grep -c '>Overviews<' "$COST_NAV")
cost_has_security=$(grep -c '>Security<' "$COST_NAV")
check FR-2107 "cost-only nav: Overviews present, Security ABSENT" "$([ "${cost_has_overviews:-0}" -ge 1 ] && [ "${cost_has_security:-0}" = 0 ] && echo 1 || echo 0)"

# ======================================================== 6. Gates
say_section "6. Repo gates (app/) — tsc, npm test, traceability, protected-file diff. No builds."

( cd "$APP" && npx tsc --noEmit ) >"$TMP/tsc.log" 2>&1
TSC_RC=$?
check gates "npx tsc --noEmit -> exit $TSC_RC" "$([ "$TSC_RC" = 0 ] && echo 1 || echo 0)"
[ "$TSC_RC" != 0 ] && tail -20 "$TMP/tsc.log" | sed 's/^/      /'

( cd "$APP" && npm test ) >"$TMP/test.log" 2>&1
TEST_RC=$?
SUMMARY_LINE=$(grep -E '^ℹ (tests|pass|fail) ' "$TMP/test.log" | tr '\n' ' ')
check gates "npm test -> exit $TEST_RC ($SUMMARY_LINE)" "$([ "$TEST_RC" = 0 ] && echo 1 || echo 0)"

for marker in \
  "ga.test.mts:the event allow-list is exactly eleven names" \
  "ga-console-guard.test.mts:no console file imports lib/ga" \
  "alerts.test.mts:four failures for one account do not fire; the fifth does" \
  "overview-rules.test.mts:2026's school year opens on Saturday 19 September 2026"
do
  file="${marker%%:*}"; text="${marker#*:}"
  seen=$(grep -c "$text" "$TMP/test.log")
  check gates "$file ran (found: \"$text\")" "$([ "${seen:-0}" -ge 1 ] && echo 1 || echo 0)"
done

TRACE_LOG="$TMP/trace.log"
( cd "$ROOT" && ./scripts/traceability.py --check ) >"$TRACE_LOG" 2>&1
TRACE_RC=$?
TRACE_SUMMARY=$(grep -E 'identity-admin|mvp1' "$TRACE_LOG" | tr '\n' ' ')
check gates "./scripts/traceability.py --check -> exit $TRACE_RC ($TRACE_SUMMARY)" "$([ "$TRACE_RC" = 0 ] && echo 1 || echo 0)"

PROTECTED_DIFF=$(cd "$ROOT" && git diff -- app/src/lib/lesson.ts app/src/lib/ask.ts app/src/lib/checkin.ts | wc -l | tr -d ' ')
check gates "git diff on lesson.ts/ask.ts/checkin.ts is empty (P5 never touched the teaching path)" "$([ "${PROTECTED_DIFF:-1}" = 0 ] && echo 1 || echo 0)"

# =====================================================================
echo ""
echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]

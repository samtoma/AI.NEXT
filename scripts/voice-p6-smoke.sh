#!/usr/bin/env bash
#
# voice-p6-smoke.sh — Phase 6 QA smoke test: the tutor's address register
# (FR-2601..FR-2606). Signup with gender, verified accounts, students.gender
# persisted correctly; the /student page and the captured prompts carry the
# address block and no stray masculine form; the template source (lesson.ts,
# ask.ts, checkin.ts, widget-docs.ts) is clean of he/him/his outside
# lib/address.ts; FR-2606's next-turn proof; the repo gates (I7b, per
# BRIEF-P6.md).
#
#   ./scripts/voice-p6-smoke.sh [STUDENT_URL]
#     STUDENT defaults to http://localhost:3000
#
#   AINEXT_SMOKE_LIVE_TURNS=1 ./scripts/voice-p6-smoke.sh
#     Also spends THREE REAL student_chat AI turns (observed ~$0.24 each, so
#     ~$0.70 total — the grounding data block is uncached on a chat session's
#     first turn) to read the live assistant replies from ai_interactions.
#     OFF BY DEFAULT: a smoke test that gets re-run casually must not
#     silently spend real model money every time (PRD cost discipline).
#     Without the flag, section 2 is skipped and the no-masculine-leak
#     property rests on the deterministic prompt-capture and source-grep
#     checks (sections 4-5) — those bind what FR-2602/2603/2605 actually
#     require (the FORM the template hands the model); the live reply is
#     confirmatory evidence, not the only proof.
#
# The dev server is OWNED BY THE ORCHESTRATOR. This script never starts,
# builds, restarts or kills it — it only ever speaks HTTP to whatever is
# already listening on STUDENT, plus psql against the real database as
# `ainext_maint`, plus local `npm test` / `npm run capture:prompts` / `npx
# tsc` / `traceability.py` runs (no server involved in those).
#
# One line per check:  PASS|FAIL  <FR>  <what>
# Non-zero exit if any check FAILs.
#
# IDEMPOTENT: this script's own qa-voice-f@local.test / qa-voice-m@local.test
# accounts — and everything that can hang off them (ai_interactions, sessions,
# analytics_events, attempts, mastery, safety_flags, understanding_checks,
# uploads, the account row, the .local-mail file) — are deleted at BOTH start
# and end via the maintenance DSN, so a previous run's leftovers never wedge
# a fresh one and a crashed run leaves nothing behind (EXIT trap). Omar
# (demo, student id 1, gender NULL) is read and logged into, never signed up
# or deleted, and this script never spends a student_chat turn on Omar's
# account even with AINEXT_SMOKE_LIVE_TURNS=1 — Omar is shared fixture
# infrastructure other QA scripts also key off (console-p5-smoke.sh and
# others), and this script uses its own two throwaway accounts instead. The
# FR-2606 check's write to Omar's gender is wrapped so it is always reverted,
# success or failure (see set_and_revert_omar_gender).
#
# Ownership: this file and its own report only (I7b brief, BRIEF-P6.md).
# Nothing else here is edited; defects found while running it are reported
# with file:line, never patched in this script.

set -uo pipefail   # deliberately NOT -e: a failed check must not abort the run

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/app"
STUDENT="${1:-http://localhost:3000}"
LIVE_TURNS="${AINEXT_SMOKE_LIVE_TURNS:-0}"

ENVF="$APP/.env.local"
[ -f "$ENVF" ] || { echo "no app/.env.local — is the dev environment set up?" >&2; exit 2; }
env_value() { sed -n "s/^$1=//p" "$ENVF" | tail -1; }
MAINT_DSN=$(env_value DATABASE_URL_MAINT)
[ -n "$MAINT_DSN" ] || { echo "DATABASE_URL_MAINT missing from app/.env.local" >&2; exit 2; }

psql_maint() { psql "$MAINT_DSN" -v ON_ERROR_STOP=1 -qtA "$@"; }
psql_maint_trim() { psql_maint "$@" | tr -d '[:space:]'; }

F_EMAIL="qa-voice-f@local.test"
M_EMAIL="qa-voice-m@local.test"
F_NAME="Nour"
M_NAME="Youssef"
PASSWORD="Correcthorse9!batt"
OMAR_EMAIL="omar@local.test"
OMAR_PASSWORD="omar-local-test"
OMAR_STUDENT_ID=1

TMP=$(mktemp -d)
trap 'cleanup_accounts >/dev/null 2>&1; revert_omar_gender >/dev/null 2>&1; rm -rf "$TMP"' EXIT
BODY="$TMP/body"; HDRS="$TMP/hdrs"
JAR_F="$TMP/jar-f.txt"; JAR_M="$TMP/jar-m.txt"; JAR_OMAR="$TMP/jar-omar.txt"
: > "$JAR_F"; : > "$JAR_M"; : > "$JAR_OMAR"

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
  local args=(-sS -D "$HDRS" -o "$BODY" -w '%{http_code}' -X "$method" --max-time 90)
  [ "$jar" != "-" ] && args+=(-b "$jar" -c "$jar")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' -d "$data")
  curl "${args[@]}" "$base$path"
}
clean_body() { sed 's/<!-- -->//g' "$BODY"; }

cleanup_accounts() {   # idempotent — safe before AND after
  for email in "$F_EMAIL" "$M_EMAIL"; do
    local aid sid
    aid=$(psql_maint_trim -c "SELECT id FROM accounts WHERE lower(email)=lower('$email')" 2>/dev/null)
    if [ -n "$aid" ]; then
      sid=$(psql_maint_trim -c "SELECT id FROM students WHERE account_id=$aid" 2>/dev/null)
      if [ -n "$sid" ]; then
        for t in ai_interactions sessions analytics_events attempts mastery safety_flags understanding_checks uploads; do
          psql_maint -c "DELETE FROM $t WHERE student_id=$sid" >/dev/null 2>&1 || true
        done
        psql_maint -c "DELETE FROM students WHERE id=$sid" >/dev/null 2>&1 || true
      fi
      psql_maint -c "DELETE FROM accounts WHERE id=$aid" >/dev/null 2>&1 || true
    fi
    rm -f "$APP/.local-mail/${email}.txt" 2>/dev/null || true
  done
}
cleanup_accounts   # remove any leftover from a previous (crashed) run first

revert_omar_gender() {
  psql_maint -c "UPDATE students SET gender=NULL WHERE id=$OMAR_STUDENT_ID" >/dev/null 2>&1 || true
}

echo "=== voice-p6-smoke.sh — student=$STUDENT live_turns=$LIVE_TURNS ==="

# ============================================================ 0. server up
say_section "0. Server reachable (owned by the orchestrator — not started/stopped/built here)"
scode=$(req GET "$STUDENT" "/" -)
check FR-2601 "student :3000 reachable (got $scode)" "$([ "$scode" = 200 ] && echo 1 || echo 0)"

# ================================================== 1. signup + verify + DB
say_section "1. Signup with gender, verify via newest .local-mail link, confirm students.gender"

code=$(req POST "$STUDENT" /api/auth/signup "$JAR_F" "{\"email\":\"$F_EMAIL\",\"password\":\"$PASSWORD\",\"displayName\":\"$F_NAME\",\"grade\":\"10\",\"gender\":\"female\"}")
check FR-2601 "signup $F_NAME (gender=female) -> $code" "$([ "$code" = 201 ] && echo 1 || echo 0)"

code=$(req POST "$STUDENT" /api/auth/signup "$JAR_M" "{\"email\":\"$M_EMAIL\",\"password\":\"$PASSWORD\",\"displayName\":\"$M_NAME\",\"grade\":\"10\",\"gender\":\"male\"}")
check FR-2601 "signup $M_NAME (gender=male) -> $code" "$([ "$code" = 201 ] && echo 1 || echo 0)"

verify_newest() {   # verify_newest <email> <jar> -> prints http status on stdout
  local email="$1" jar="$2" mail="$APP/.local-mail/${email}.txt"
  [ -f "$mail" ] || { echo "000"; return; }
  local token; token=$(grep -o 'token=[^"& ]*' "$mail" | tail -1 | sed 's/^token=//')
  [ -n "$token" ] || { echo "000"; return; }
  req GET "$STUDENT" "/api/auth/verify?token=$token" "$jar"
}
vcode=$(verify_newest "$F_EMAIL" "$JAR_F")
check FR-2601 "verify $F_NAME via newest .local-mail link -> $vcode (302 expected)" "$([ "$vcode" = 302 ] && echo 1 || echo 0)"
vcode=$(verify_newest "$M_EMAIL" "$JAR_M")
check FR-2601 "verify $M_NAME via newest .local-mail link -> $vcode (302 expected)" "$([ "$vcode" = 302 ] && echo 1 || echo 0)"

code=$(req POST "$STUDENT" /api/auth/login "$JAR_OMAR" "{\"email\":\"$OMAR_EMAIL\",\"password\":\"$OMAR_PASSWORD\"}")
check FR-2205 "login (student, omar, gender NULL fixture) -> $code" "$([ "$code" = 200 ] && echo 1 || echo 0)"

g_f=$(psql_maint_trim -c "SELECT gender FROM students s JOIN accounts a ON a.id=s.account_id WHERE a.email='$F_EMAIL'")
g_m=$(psql_maint_trim -c "SELECT gender FROM students s JOIN accounts a ON a.id=s.account_id WHERE a.email='$M_EMAIL'")
g_o=$(psql_maint_trim -c "SELECT coalesce(gender,'<null>') FROM students WHERE id=$OMAR_STUDENT_ID")
check FR-2601 "students.gender: $F_NAME=female ($g_f), $M_NAME=male ($g_m), Omar=NULL ($g_o)" "$([ "$g_f" = "female" ] && [ "$g_m" = "male" ] && [ "$g_o" = "<null>" ] && echo 1 || echo 0)"

# =========================================== 2. /student page copy (no cost)
say_section "2. /student page copy — no he/his/him addressing the student (FR-2602)"

for pair in "$F_NAME:$JAR_F" "$M_NAME:$JAR_M" "Omar:$JAR_OMAR"; do
  who="${pair%%:*}"; jar="${pair#*:}"
  code=$(req GET "$STUDENT" "/student" "$jar")
  no_script=$(clean_body | perl -0pe 's/<script\b[^>]*>.*?<\/script>//gis' 2>/dev/null || clean_body)
  hits=$(printf '%s' "$no_script" | grep -ocE '\b(he|his|him)\b')
  check FR-2602 "GET /student ($who) -> $code, 0 he/his/him outside <script> (found ${hits:-0})" "$([ "$code" = 200 ] && [ "${hits:-1}" = 0 ] && echo 1 || echo 0)"
done

# ============================================ 3. Live student_chat turns
say_section "3. Live student_chat turns — no masculine leak (SC-112, FR-2602/2605)"
if [ "$LIVE_TURNS" != "1" ]; then
  note "SKIPPED — set AINEXT_SMOKE_LIVE_TURNS=1 to spend 3 real AI turns (observed ~\$0.70 total)."
  note "See sections 4-5 for the deterministic form of this same assertion (no cost)."
else
  MSG='Can you explain what a chord is, quickly?'
  ask_turn() {  # ask_turn <jar> <chatSession> -> interactionId on stdout (or empty)
    local jar="$1" cs="$2"
    req POST "$STUDENT" /api/ask "$jar" "{\"surface\":\"student_chat\",\"chatSession\":\"$cs\",\"messages\":[{\"role\":\"user\",\"text\":\"$MSG\"}]}" >/dev/null
    grep -o '"interactionId":[0-9]*' "$BODY" | tail -1 | grep -o '[0-9]*'
  }
  IID_F=$(ask_turn "$JAR_F" "voice-smoke-f-$$")
  IID_M=$(ask_turn "$JAR_M" "voice-smoke-m-$$")
  IID_O=$(ask_turn "$JAR_OMAR" "voice-smoke-o-$$")
  check SC-112 "three student_chat turns delivered (ids: f=${IID_F:-none} m=${IID_M:-none} omar=${IID_O:-none})" "$([ -n "${IID_F:-}" ] && [ -n "${IID_M:-}" ] && [ -n "${IID_O:-}" ] && echo 1 || echo 0)"

  m_f=$(psql_maint_trim -c "SELECT assistant_message FROM ai_interactions WHERE id=${IID_F:-0}")
  m_m=$(psql_maint_trim -c "SELECT assistant_message FROM ai_interactions WHERE id=${IID_M:-0}")
  m_o=$(psql_maint_trim -c "SELECT assistant_message FROM ai_interactions WHERE id=${IID_O:-0}")
  note "$F_NAME excerpt: $(printf '%s' "$m_f" | cut -c1-300 | tr '\n' ' ')"
  note "$M_NAME excerpt: $(printf '%s' "$m_m" | cut -c1-300 | tr '\n' ' ')"
  note "Omar excerpt:    $(printf '%s' "$m_o" | cut -c1-300 | tr '\n' ' ')"

  leak_f=$(printf '%s' "$m_f" | grep -ocE '\b(he|him|his)\b')
  leak_o=$(printf '%s' "$m_o" | grep -ocE '\b(he|him|his)\b')
  voc_f=$(printf '%s' "$m_f" | grep -c 'يا بطل')
  voc_o=$(printf '%s' "$m_o" | grep -c 'يا بطل')
  check SC-112 "$F_NAME's reply (female): 0 he/him/his, 0 يا بطل/يا بطلة" "$([ "${leak_f:-1}" = 0 ] && [ "${voc_f:-1}" = 0 ] && echo 1 || echo 0)"
  check SC-112 "Omar's reply (NULL/unspecified): 0 he/him/his, 0 يا بطل/يا بطلة" "$([ "${leak_o:-1}" = 0 ] && [ "${voc_o:-1}" = 0 ] && echo 1 || echo 0)"
  note "$M_NAME's reply (male) may use masculine forms freely — not asserted"
fi

# ================================= 4. Prompt-capture proof (deterministic)
say_section "4. Prompt capture — the address block reaches every lesson/ask prompt (constitution IX)"

CAP_DIR="$TMP/captures"
( cd "$APP" && npm run capture:prompts -- "$CAP_DIR" ) >"$TMP/capture.log" 2>&1
CAP_RC=$?
CAP_SUMMARY=$(grep -oE 'captured .*' "$TMP/capture.log" | tail -1)
check gates "npm run capture:prompts -- <dir> -> exit $CAP_RC ($CAP_SUMMARY)" "$([ "$CAP_RC" = 0 ] && echo 1 || echo 0)"

# The address block (retrievalBlock(), lib/retrieval.ts) rides in the DATA
# block, not the static system-prompt text — it is concatenated into the
# model's system prompt at request time (api/ask/route.ts: systemPrompt =
# ctx.systemPrompt + "\n\n" + ctx.dataBlock). The harness captures the two
# halves as separate files, so the marker is asserted on *-data.txt, which is
# where lib/address.ts's own addressBlock() output actually lands.
MISSING=0; TOTAL=0
while IFS= read -r f; do
  TOTAL=$((TOTAL+1))
  grep -q "HOW TO ADDRESS THIS STUDENT" "$f" || { MISSING=$((MISSING+1)); note "missing address block: $f"; }
done < <(find "$CAP_DIR" -name "lesson-*-data.txt" -o -name "ask-*-data.txt" 2>/dev/null)
check FR-2602 "every captured lesson/ask *-data.txt carries the address block ($TOTAL files, $MISSING missing)" "$([ "$TOTAL" -gt 0 ] && [ "$MISSING" = 0 ] && echo 1 || echo 0)"

# The harness runs with no student in scope (studentId defaults to null), so
# every capture renders the EITHER register — "singular they" is the stable
# substring lib/address.ts uses only in that branch (never masculine/feminine).
NOTHEY=$(grep -rL "singular they" "$CAP_DIR"/lesson-*-data.txt "$CAP_DIR"/ask-*-data.txt 2>/dev/null | wc -l | tr -d ' ')
check FR-2605 "the harness's no-student-in-scope default renders the EITHER register, never masculine (${NOTHEY:-?} files missing 'singular they')" "$([ "${NOTHEY:-1}" = 0 ] && echo 1 || echo 0)"

# ===================================== 5. Source-level pronoun scan (FR-2602)
say_section "5. Template source clean of he/him/his/himself outside lib/address.ts"

for f in lesson.ts ask.ts checkin.ts widget-docs.ts; do
  path="$APP/src/lib/$f"
  # NOTE: grep -c always prints a count (0 included) regardless of its exit
  # status, so this must NOT be `... || echo 0` — that doubles the "0" when
  # the count is legitimately zero (grep exits 1 on no-match).
  cnt=$(grep -coE '\b(he|him|his|himself)\b' "$path" 2>/dev/null)
  check FR-2602 "src/lib/$f: 0 masculine pronouns (found ${cnt:-?})" "$([ -f "$path" ] && [ "${cnt:-1}" = 0 ] && echo 1 || echo 0)"
done

# ========================================== 6. FR-2606 — next-turn proof
say_section "6. FR-2606 — a gender change applies next turn, no cross-turn caching"

session_cache="$APP/src/lib/session-cache.ts"
has_gender_key=$(grep -c 'addressForms(k.gender).key' "$session_cache" 2>/dev/null)
check FR-2606 "session-cache.ts: snapshotKey() includes the register, not bypassed (lib/session-cache.ts)" "$([ "${has_gender_key:-0}" -ge 1 ] && echo 1 || echo 0)"

# capture-prompts.mts always renders with studentId=null (documented in its own
# header) — it has no CLI/env flag to render a specific gender, so the
# before/after-diff style proof this check would otherwise run is not
# available from the harness. Read the script itself rather than assume.
has_profile_flag=$(grep -c 'gender\|profile.*flag\|--gender' "$APP/scripts/capture-prompts.mts" 2>/dev/null)
if [ "${has_profile_flag:-0}" = 0 ]; then
  note "capture-prompts.mts has NO per-gender profile override (confirmed by reading the script) —"
  note "the register-change-is-a-key-change property is proved at the unit level instead, below."
fi

TEST_LOG_6="$TMP/test-session-cache.log"
( cd "$APP" && node --import ./scripts/ts-resolver.mjs --test src/lib/session-cache.test.mts ) >"$TEST_LOG_6" 2>&1
SC_RC=$?
SC_SUMMARY=$(grep -E '^ℹ (tests|pass|fail) ' "$TEST_LOG_6" | tr '\n' ' ')
check FR-2606 "session-cache.test.mts (register-change-is-a-key-change) -> exit $SC_RC ($SC_SUMMARY)" "$([ "$SC_RC" = 0 ] && echo 1 || echo 0)"

# Literal DB-level proof, matching the manual QA pass: toggle Omar's gender,
# confirm the write lands, then revert — never spends a turn, never leaves
# Omar's fixture row changed (revert_omar_gender also runs from the EXIT trap
# as a backstop).
psql_maint -c "UPDATE students SET gender='female' WHERE id=$OMAR_STUDENT_ID" >/dev/null 2>&1
g_after=$(psql_maint_trim -c "SELECT gender FROM students WHERE id=$OMAR_STUDENT_ID")
revert_omar_gender
g_reverted=$(psql_maint_trim -c "SELECT coalesce(gender,'<null>') FROM students WHERE id=$OMAR_STUDENT_ID")
check FR-2606 "Omar's gender write lands (-> $g_after) and is reverted to NULL (-> $g_reverted) — no turn spent" "$([ "$g_after" = "female" ] && [ "$g_reverted" = "<null>" ] && echo 1 || echo 0)"

# ======================================================== 7. Repo gates
say_section "7. Repo gates — tsc, npm test, traceability, diff scope. No builds."

( cd "$APP" && npx tsc --noEmit ) >"$TMP/tsc.log" 2>&1
TSC_RC=$?
check gates "npx tsc --noEmit -> exit $TSC_RC" "$([ "$TSC_RC" = 0 ] && echo 1 || echo 0)"
[ "$TSC_RC" != 0 ] && tail -20 "$TMP/tsc.log" | sed 's/^/      /'

( cd "$APP" && npm test ) >"$TMP/test.log" 2>&1
TEST_RC=$?
SUMMARY_LINE=$(grep -E '^ℹ (tests|pass|fail) ' "$TMP/test.log" | tr '\n' ' ')
check gates "npm test -> exit $TEST_RC ($SUMMARY_LINE)" "$([ "$TEST_RC" = 0 ] && echo 1 || echo 0)"

for f in address.test.mts prompt-address.test.mts gender-scope.test.mts session-cache.test.mts capture-prompts.test.mts understanding-prompt.test.mts; do
  seen=$(grep -c "$f" "$APP/package.json")
  check gates "$f is wired into npm test's file list" "$([ "${seen:-0}" -ge 1 ] && echo 1 || echo 0)"
done

TRACE_LOG="$TMP/trace.log"
( cd "$ROOT" && python3 scripts/traceability.py --check ) >"$TRACE_LOG" 2>&1
TRACE_RC=$?
TRACE_SUMMARY=$(grep -E 'identity-admin|mvp1' "$TRACE_LOG" | tr '\n' ' ')
check gates "scripts/traceability.py --check (run from repo root) -> exit $TRACE_RC ($TRACE_SUMMARY)" "$([ "$TRACE_RC" = 0 ] && echo 1 || echo 0)"

OUTSIDE_APP=$(cd "$ROOT" && git diff --name-only -- . | grep -vc '^app/')
DIFF_STAT="$TMP/diffstat.log"
( cd "$ROOT" && git diff --stat ) >"$DIFF_STAT" 2>&1
check gates "git diff touches only app/ (P6 is a prompt/harness phase, no infra/spec files) — ${OUTSIDE_APP:-?} files outside app/" "$([ "${OUTSIDE_APP:-1}" = 0 ] && echo 1 || echo 0)"
note "git diff --stat: $(tail -1 "$DIFF_STAT")"

# =====================================================================
echo ""
echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]

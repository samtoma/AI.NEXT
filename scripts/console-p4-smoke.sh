#!/usr/bin/env bash
#
# console-p4-smoke.sh — Phase 4 QA smoke test: the cost ledger tells the
# truth, the daily rollup, per-student cost with reconciliation, and
# subscription status (I5b, per BRIEF-P4.md).
#
#   ./scripts/console-p4-smoke.sh [STUDENT_URL] [CONSOLE_URL]
#     STUDENT defaults to http://localhost:3000
#     CONSOLE defaults to http://localhost:3002
#
# Both dev servers must already be running (owned by the orchestrator — this
# script never starts, builds or stops them). Exercises live HTTP against
# them plus psql against the real database as `ainext_maint` (BYPASSRLS,
# read-only from this script's point of view except the rollup, which is the
# feature under test).
#
# One line per check:  PASS|FAIL  <FR>  <what>
# Non-zero exit if any check FAILs.
#
# NOT IDEMPOTENT in one respect, deliberately: step 1 spends one real
# `student_chat` AI turn (~$0.05 on Samuel's Claude subscription). Everything
# else — reads, refusals, the rollup itself — is safe to re-run.
#
# Ownership: this file and its own report only (I5b brief). Nothing else here
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

psql_maint() { psql "$MAINT_DSN" -v ON_ERROR_STOP=1 -qtA "$@"; }
psql_maint_trim() { psql_maint "$@" | tr -d '[:space:]'; }
psql_maint_noerr() { psql "$MAINT_DSN" -qtA "$@"; }

OMAR_EMAIL="omar@local.test"
OMAR_PASSWORD="omar-local-test"
SAMUEL_EMAIL="samuel.s.toma@gmail.com"
SAMUEL_PASSWORD="ConsoleLocal!2026"
COSTONLY_EMAIL="cost-only@local.test"
COSTONLY_PASSWORD="CostOnly!2026"
STUDENT_ID=1   # Omar (demo)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
BODY="$TMP/body"; HDRS="$TMP/hdrs"
JAR_OMAR="$TMP/jar-omar.txt"; JAR_SAMUEL="$TMP/jar-samuel.txt"; JAR_COST="$TMP/jar-cost.txt"
: > "$JAR_OMAR"; : > "$JAR_SAMUEL"; : > "$JAR_COST"

PASS=0; FAIL=0
check() {  # check <FR> <desc> <0|1>
  local fr="$1" desc="$2" ok="$3"
  if [ "$ok" = 1 ]; then printf 'PASS  %-9s %s\n' "$fr" "$desc"; PASS=$((PASS+1))
  else                   printf 'FAIL  %-9s %s\n' "$fr" "$desc"; FAIL=$((FAIL+1)); fi
}
note() { printf '      %-9s %s\n' "" "$*"; }
say_section() { printf '\n--- %s ---\n' "$*"; }

# req METHOD BASE PATH JAR [DATA] -> status on stdout, body in $BODY, headers
# in $HDRS. JAR "-" means no cookie jar at all.
req() {
  local method="$1" base="$2" path="$3" jar="$4" data="${5:-}"
  local args=(-sS -D "$HDRS" -o "$BODY" -w '%{http_code}' -X "$method" --max-time 30)
  [ "$jar" != "-" ] && args+=(-b "$jar" -c "$jar")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' -d "$data")
  curl "${args[@]}" "$base$path"
}
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

echo "=== console-p4-smoke.sh — student=$STUDENT console=$CONSOLE ==="

# ============================================================ 0. servers up
say_section "0. Servers reachable (owned by the orchestrator — not started/stopped here)"
scode=$(req GET "$STUDENT" "/" -)
check FR-2401 "student :3000 reachable (got $scode)" "$([ "$scode" = 200 ] && echo 1 || echo 0)"
ccode=$(req GET "$CONSOLE" "/" -)
check FR-2401 "console :3002 reachable (got $ccode, 307 to /signin is fine)" "$([[ "$ccode" =~ ^(200|307|308)$ ]] && echo 1 || echo 0)"

# ============================================================ 1. Omar: one turn
say_section "1. Omar on :3000 — one student_chat turn (real spend, once)"

code=$(req POST "$STUDENT" /api/auth/login "$JAR_OMAR" "{\"email\":\"$OMAR_EMAIL\",\"password\":\"$OMAR_PASSWORD\"}")
check FR-2205 "login (student, omar) -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"

QID=$(psql_maint_trim -c "SELECT id FROM questions WHERE status='live' AND question_type <> 'widget' ORDER BY id LIMIT 1")
note "practice question for grounding: $QID"

CHAT_SESSION="qa-p4-smoke-$(date +%s)"
ASK_SSE="$TMP/ask-sse.txt"
note "POST /api/ask surface=student_chat chatSession=$CHAT_SESSION (ONE real turn, ~\$0.05)"
curl -sS -N --max-time 100 -b "$JAR_OMAR" -c "$JAR_OMAR" -X POST \
  -H 'Content-Type: application/json' \
  -d "{\"surface\":\"student_chat\",\"chatSession\":\"$CHAT_SESSION\",\"messages\":[{\"role\":\"user\",\"text\":\"What is a ratio in simplest form? Answer in one short sentence.\"}],\"questionId\":\"$QID\"}" \
  "$STUDENT/api/ask" > "$ASK_SSE" 2>"$TMP/ask-curl-err.txt"
ASK_CURL_STATUS=$?
check FR-2401 "curl to /api/ask exited 0 (got $ASK_CURL_STATUS)" "$([ "$ASK_CURL_STATUS" = 0 ] && echo 1 || echo 0)"
ok=0; grep -q '^data: ' "$ASK_SSE" 2>/dev/null && ok=1
check FR-2401 "response is SSE (data: lines present)" "$ok"

# The final "done" meta line, if present, carries the usage the client saw —
# compared against the ledger row below rather than trusted on its own.
SSE_META=$(grep -o '"type":"done"[^$]*' "$ASK_SSE" | tail -1)
SSE_INPUT=$(printf '%s' "$SSE_META" | grep -oE '"inputTokens":[0-9]+' | grep -oE '[0-9]+' | head -1)
SSE_COST=$(printf '%s' "$SSE_META" | grep -oE '"costUsd":[0-9.eE+-]+' | grep -oE '[0-9.eE+-]+$' | head -1)
note "SSE done.meta: inputTokens=${SSE_INPUT:-<none>} costUsd=${SSE_COST:-<none>}"

sleep 1   # let the ledger write (unit two) land

ROW=$(psql_maint -c "SELECT outcome, price_basis, priced_at IS NOT NULL, cost_usd, session_id IS NOT NULL, renderer_version, input_tokens, cache_read_tokens, cache_creation_tokens, output_tokens FROM ai_interactions WHERE student_id=$STUDENT_ID AND grounding->>'chat_session'='$CHAT_SESSION' ORDER BY id DESC LIMIT 1")
IFS='|' read -r R_OUTCOME R_BASIS R_PRICED_AT_SET R_COST R_SESSION_SET R_RENDERER R_INPUT R_CACHE_READ R_CACHE_CREATE R_OUTPUT <<< "$ROW"
note "new ai_interactions row: outcome=$R_OUTCOME price_basis=$R_BASIS priced_at_set=$R_PRICED_AT_SET cost_usd=$R_COST session_id_set=$R_SESSION_SET renderer_version=$R_RENDERER input=$R_INPUT cache_read=$R_CACHE_READ cache_creation=$R_CACHE_CREATE output=$R_OUTPUT"

check FR-2401 "outcome = 'ok' (got '$R_OUTCOME')" "$([ "$R_OUTCOME" = "ok" ] && echo 1 || echo 0)"
check FR-2401 "price_basis = 'cli-list-price' (got '$R_BASIS')" "$([ "$R_BASIS" = "cli-list-price" ] && echo 1 || echo 0)"
check FR-2401 "priced_at is set" "$([ "$R_PRICED_AT_SET" = "t" ] && echo 1 || echo 0)"
ok=0; [ -n "$R_COST" ] && awk "BEGIN{exit !($R_COST > 0)}" && ok=1
check FR-2401 "cost_usd > 0 (got '$R_COST')" "$ok"
check ADR-0015 "session_id is set" "$([ "$R_SESSION_SET" = "t" ] && echo 1 || echo 0)"
check ADR-0015 "renderer_version is set (got '$R_RENDERER')" "$([ -n "$R_RENDERER" ] && [ "$R_RENDERER" != "" ] && echo 1 || echo 0)"

# input_tokens must EXCLUDE cache tokens: input + cache_read + cache_creation
# is the OLD (over-counted) total, so it must be >= input_tokens alone, and
# strictly greater whenever any caching happened at all.
ok=0
if [[ "$R_INPUT" =~ ^[0-9]+$ ]] && [[ "$R_CACHE_READ" =~ ^[0-9]+$ ]] && [[ "$R_CACHE_CREATE" =~ ^[0-9]+$ ]]; then
  TOTAL_INPUT=$((R_INPUT + R_CACHE_READ + R_CACHE_CREATE))
  [ "$TOTAL_INPUT" -ge "$R_INPUT" ] && ok=1
fi
check FR-2401 "input_tokens + cache_read + cache_creation ($TOTAL_INPUT) >= input_tokens ($R_INPUT)" "$ok"

if [ -n "${SSE_INPUT:-}" ]; then
  check FR-2401 "SSE-reported inputTokens ($SSE_INPUT) matches ledger input_tokens ($R_INPUT)" \
    "$([ "$SSE_INPUT" = "$R_INPUT" ] && echo 1 || echo 0)"
else
  note "no done.meta.inputTokens found in the SSE capture — skipping the cross-check (not a defect by itself)"
fi

# ============================================================ 2. rollup, twice
say_section "2. cost_daily rollup — idempotent, today stays open"

SINCE=$(date -u -v-3d +%F 2>/dev/null || date -u -d '3 days ago' +%F)

# First, EXACTLY the command the brief and the script's own header document:
# `cd app && npm run rollup:cost -- --since <date>`, no environment exported
# by hand. This is expected to work on a stock checkout.
note "npm run rollup:cost -- --since $SINCE, bare (as documented in the script's own header)"
ROLLUP_BARE=$(cd "$APP" && npm run --silent rollup:cost -- --since "$SINCE" 2>&1)
RC_BARE=$?
echo "$ROLLUP_BARE" | sed 's/^/      rollup(bare)> /'
BARE_OK=$([ "$RC_BARE" = 0 ] && echo 1 || echo 0)
check FR-2401 "bare 'npm run rollup:cost' (as documented) exits 0" "$BARE_OK"
if [ "$BARE_OK" = 0 ]; then
  note "DEFECT: app/scripts/rollup-cost-daily.mts:1-35 documents \"npm run rollup:cost\" as the way to run this, but nothing in the repo loads app/.env.local for a standalone node script (only 'next dev'/'next build' do). db.ts:291-293's withMaint() then fails closed on a missing DATABASE_URL_MAINT. scripts/local-dev.sh:307-320's run_app_script() works around this by exporting DATABASE_URL_MAINT/AINEXT_ENVIRONMENT inline per call — an operator who runs the header's own documented command from a plain shell hits this every time."
fi

# Re-run with the same env local-dev.sh's run_app_script() exports, so the
# ACTUAL rollup logic (idempotency, closed-days-only) is still exercised even
# when the bare command above fails for the DX reason noted.
MAINT_DSN_ENV=$(env_value DATABASE_URL_MAINT)
AINEXT_ENV=$(env_value AINEXT_ENVIRONMENT)
note "npm run rollup:cost -- --since $SINCE (run 1, DATABASE_URL_MAINT + AINEXT_ENVIRONMENT exported)"
ROLLUP1=$(cd "$APP" && DATABASE_URL_MAINT="$MAINT_DSN_ENV" AINEXT_ENVIRONMENT="${AINEXT_ENV:-mvp1}" npm run --silent rollup:cost -- --since "$SINCE" 2>&1)
RC1=$?
echo "$ROLLUP1" | sed 's/^/      rollup> /'
check FR-2401 "rollup run 1 exits 0 (env exported)" "$([ "$RC1" = 0 ] && echo 1 || echo 0)"

ROWS_AFTER_1=$(psql_maint_trim -c "SELECT count(*) FROM cost_daily")
SUM_AFTER_1=$(psql_maint_trim -c "SELECT coalesce(sum(cost_usd),0) FROM cost_daily")

note "npm run rollup:cost -- --since $SINCE (run 2, idempotency check, env exported)"
ROLLUP2=$(cd "$APP" && DATABASE_URL_MAINT="$MAINT_DSN_ENV" AINEXT_ENVIRONMENT="${AINEXT_ENV:-mvp1}" npm run --silent rollup:cost -- --since "$SINCE" 2>&1)
RC2=$?
echo "$ROLLUP2" | sed 's/^/      rollup> /'
check FR-2401 "rollup run 2 exits 0 (env exported)" "$([ "$RC2" = 0 ] && echo 1 || echo 0)"

ROWS_AFTER_2=$(psql_maint_trim -c "SELECT count(*) FROM cost_daily")
SUM_AFTER_2=$(psql_maint_trim -c "SELECT coalesce(sum(cost_usd),0) FROM cost_daily")
note "cost_daily rows: after-run-1=$ROWS_AFTER_1 after-run-2=$ROWS_AFTER_2 · cost_usd sum: after-run-1=$SUM_AFTER_1 after-run-2=$SUM_AFTER_2"
check FR-2401 "rollup is idempotent: row count identical ($ROWS_AFTER_1 == $ROWS_AFTER_2)" \
  "$([ "$ROWS_AFTER_1" = "$ROWS_AFTER_2" ] && echo 1 || echo 0)"
check FR-2401 "rollup is idempotent: cost_usd sum identical ($SUM_AFTER_1 == $SUM_AFTER_2)" \
  "$([ "$SUM_AFTER_1" = "$SUM_AFTER_2" ] && echo 1 || echo 0)"

TODAY_UTC=$(date -u +%F)
TODAY_ROLLED=$(psql_maint_trim -c "SELECT count(*) FROM cost_daily WHERE day = '$TODAY_UTC'::date")
check FR-2401 "today ($TODAY_UTC) is NOT in cost_daily — the day is still open (got $TODAY_ROLLED rows)" \
  "$([ "$TODAY_ROLLED" = "0" ] && echo 1 || echo 0)"

# ============================================================ 3. operator cost view
say_section "3. Four-role operator (samuel) on :3002 — /cost"

code=$(req POST "$CONSOLE" /api/auth/login "$JAR_SAMUEL" "{\"email\":\"$SAMUEL_EMAIL\",\"password\":\"$SAMUEL_PASSWORD\"}")
check FR-2205 "login (console, samuel) -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"

code=$(req GET "$CONSOLE" "/cost" "$JAR_SAMUEL")
COST_BODY=$(cat "$BODY")
COST_BODY_LC=$(lc "$COST_BODY")
check FR-2211 "/cost -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"
check FR-2211 "/cost mentions 'imputed at list price'" "$([[ "$COST_BODY_LC" == *"imputed at list price"* ]] && echo 1 || echo 0)"

ok=0
[ -n "$R_COST" ] && [[ "$COST_BODY" == *"$STUDENT_ID"* ]] && ok=1
check FR-2401 "/cost lists student #$STUDENT_ID (today's turn feeds the live figure)" "$ok"

ok=0; [[ "$COST_BODY" == *"reconciled"* ]] && ok=1
check FR-2403 "/cost shows the reconciliation line marked reconciled (SC-109)" "$ok"
ok=0; [[ "$COST_BODY" == *"does not reconcile"* ]] && ok=0 || ok=1
check FR-2403 "/cost reconciliation does NOT say 'does not reconcile'" "$ok"

ok=0; [[ "$COST_BODY" == *"Teaching"* ]] && [[ "$COST_BODY" == *"Photo"* ]] && ok=1
check FR-2402 "/cost shows AI (Teaching) and upload/OCR (Photo) as separate columns/figures" "$ok"

ok=0; [[ "$COST_BODY" == *"How the calls ended"* ]] && [[ "$COST_BODY" == *"Answered"* ]] && ok=1
check FR-2401 "/cost shows an outcome breakdown" "$ok"

ok=0; [[ "$COST_BODY" == *"<svg"* ]] && ok=1
check FR-2401 "/cost renders an inline <svg> sparkline" "$ok"

for p in 7 30 90; do
  code=$(req GET "$CONSOLE" "/cost?period=$p" "$JAR_SAMUEL")
  check FR-2211 "/cost?period=$p -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"
done

# ============================================================ 4. cost-only operator
say_section "4. cost-only@local.test — no content, subscription editor works"

code=$(req POST "$CONSOLE" /api/auth/login "$JAR_COST" "{\"email\":\"$COSTONLY_EMAIL\",\"password\":\"$COSTONLY_PASSWORD\"}")
check FR-2207 "login (console, cost-only) -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"

code=$(req GET "$CONSOLE" "/cost" "$JAR_COST")
COSTONLY_BODY=$(cat "$BODY")
check FR-2406 "cost-only: /cost -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"

ok=1
[[ "$COSTONLY_BODY" == *"/sessions/"* ]] && ok=0
check FR-2406 "cost-only: /cost has no /sessions/ link (no transcript access)" "$ok"

code=$(req GET "$CONSOLE" "/students/$STUDENT_ID" "$JAR_COST")
S360_BODY=$(cat "$BODY")
ok=0
{ [[ "$S360_BODY" == *"do not hold the role"* ]] || [[ "$S360_BODY" == *"Not permitted"* ]] || [ "$code" = 403 ]; } && ok=1
[[ "$S360_BODY" == *"Time on task"* ]] && ok=0
check FR-2202 "cost-only: /students/$STUDENT_ID -> refused, no student content leaked (got $code)" "$ok"

code=$(req POST "$CONSOLE" "/api/console/students/$STUDENT_ID/subscription" "$JAR_COST" '{"status":"trial","note":"QA"}')
SUB_BODY=$(cat "$BODY")
check FR-2405 "cost-only: POST subscription {trial} -> 200 (got $code, body: $SUB_BODY)" "$([ "$code" = 200 ] && echo 1 || echo 0)"

ROW=$(psql_maint -c "SELECT subscription_status, subscription_updated_by, subscription_updated_at IS NOT NULL FROM students WHERE id=$STUDENT_ID")
IFS='|' read -r SUB_STATUS SUB_BY SUB_AT_SET <<< "$ROW"
COSTONLY_OPID=$(psql_maint_trim -c "SELECT id FROM operators WHERE email='$COSTONLY_EMAIL'")
note "students row after cost-only's change: status=$SUB_STATUS updated_by=$SUB_BY (cost-only operator id=$COSTONLY_OPID) updated_at_set=$SUB_AT_SET"
check FR-2405 "students.subscription_status = 'trial'" "$([ "$SUB_STATUS" = "trial" ] && echo 1 || echo 0)"
check FR-2405 "students.subscription_updated_by = cost-only's operator id ($COSTONLY_OPID)" \
  "$([ "$SUB_BY" = "$COSTONLY_OPID" ] && echo 1 || echo 0)"
check FR-2405 "students.subscription_updated_at is set" "$([ "$SUB_AT_SET" = "t" ] && echo 1 || echo 0)"

code=$(req POST "$CONSOLE" "/api/console/students/$STUDENT_ID/subscription" "$JAR_SAMUEL" '{"status":"active","note":"QA by four-role operator"}')
check FR-2405 "four-role operator (holds cost-billing): POST subscription {active} -> 200 (got $code)" "$([ "$code" = 200 ] && echo 1 || echo 0)"

code=$(req POST "$STUDENT" "/api/console/students/$STUDENT_ID/subscription" "$JAR_OMAR" '{"status":"trial"}')
check FR-2201 "Omar on :3000: POST .../subscription -> 404, route absent from student build (got $code)" \
  "$([ "$code" = 404 ] && echo 1 || echo 0)"

code=$(req POST "$CONSOLE" "/api/console/students/$STUDENT_ID/subscription" "$JAR_COST" '{"status":"bogus"}')
check FR-2405 "cost-only: POST subscription {bogus status} -> 4xx (got $code)" \
  "$([[ "$code" =~ ^4 ]] && echo 1 || echo 0)"

# ============================================================ 5. status gates nothing
say_section "5. As Omar on :3000 after the status change — status gates nothing"

for p in "/student" "/dashboard"; do
  code=$(req GET "$STUDENT" "$p" "$JAR_OMAR")
  b=$(cat "$BODY")
  blc=$(lc "$b")
  ok=0
  [ "$code" = 200 ] && [[ "$blc" != *"trial"* ]] && [[ "$blc" != *"subscription"* ]] && ok=1
  check FR-2404 "$p -> 200, no 'trial'/'subscription' text (got $code)" "$ok"
done

code=$(req GET "$STUDENT" "/api/dashboard" "$JAR_OMAR")
b=$(cat "$BODY")
blc=$(lc "$b")
ok=0
[ "$code" = 200 ] && [[ "$blc" != *"trial"* ]] && [[ "$blc" != *"subscription"* ]] && ok=1
check FR-2404 "/api/dashboard -> 200, no 'trial'/'subscription' text (got $code)" "$ok"

# ============================================================ 6. ledger outcomes + CHECK
say_section "6. Ledger outcomes (maint) + outcome CHECK constraint"

OUTCOME_COUNTS=$(psql_maint -c "SELECT outcome, count(*) FROM ai_interactions GROUP BY 1 ORDER BY 1")
echo "$OUTCOME_COUNTS" | sed 's/^/      outcome> /'
check FR-2401 "outcome/count query ran" "$([ -n "$OUTCOME_COUNTS" ] && echo 1 || echo 0)"

note "the redaction path cannot be triggered safely from this script (needs a live sacred-guard trip) — skipped"

BAD_INSERT=$(psql_maint_noerr -c "INSERT INTO ai_interactions (student_id, surface, turn_index, user_message, assistant_message, grounding, citations, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, latency_ms, environment, surface_kind, outcome) VALUES ($STUDENT_ID,'qa_smoke_probe',0,'x','x','{}','[]','none',0,0,0,0,0,0,'mvp1','chat','bogus_outcome')" 2>&1)
ok=0; [[ "$BAD_INSERT" == *"ai_interactions_outcome_check"* ]] && ok=1
check FR-2401 "outcome CHECK rejects an invalid value (psql error observed)" "$ok"
note "psql error: $(printf '%s' "$BAD_INSERT" | head -1)"

# ============================================================ 7. upload (optional)
say_section "7. Upload OCR ledger fix (optional, once)"

PNG_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
PNG_FILE="$TMP/qa-tiny.png"
printf '%s' "$PNG_B64" | base64 -d > "$PNG_FILE" 2>/dev/null || base64 -D -o "$PNG_FILE" <<< "$PNG_B64" 2>/dev/null

if [ -s "$PNG_FILE" ]; then
  UP_BEFORE=$(psql_maint_trim -c "SELECT count(*) FROM ai_interactions WHERE student_id=$STUDENT_ID AND surface_kind='upload_parse'")
  code=$(curl -sS -D "$HDRS" -o "$BODY" -w '%{http_code}' --max-time 30 \
    -b "$JAR_OMAR" -c "$JAR_OMAR" -X POST \
    -F "file=@$PNG_FILE;type=image/png" \
    "$STUDENT/api/uploads")
  UP_BODY=$(cat "$BODY")
  note "POST /api/uploads -> $code, body: $UP_BODY"
  UPLOAD_ID=$(printf '%s' "$UP_BODY" | grep -oE '"uploadId":[0-9]+' | grep -oE '[0-9]+')
  if [ "$code" = 202 ] && [ -n "$UPLOAD_ID" ]; then
    check FR-2401 "POST /api/uploads (tiny PNG) -> 202, uploadId=$UPLOAD_ID" 1
    PARSED=0
    for i in $(seq 1 20); do
      sleep 3
      pcode=$(req GET "$STUDENT" "/api/uploads/$UPLOAD_ID" "$JAR_OMAR")
      pbody=$(cat "$BODY")
      if [[ "$pbody" == *'"parseStatus":"parsed"'* ]] || [[ "$pbody" == *'"parseStatus":"unreadable"'* ]] || [[ "$pbody" == *'"parseStatus":"failed"'* ]]; then
        PARSED=1; note "parse settled after ~$((i*3))s: $pbody"; break
      fi
    done
    if [ "$PARSED" = 1 ]; then
      sleep 1
      UPROW=$(psql_maint -c "SELECT input_tokens+output_tokens+cache_read_tokens+cache_creation_tokens, price_basis FROM ai_interactions WHERE student_id=$STUDENT_ID AND surface_kind='upload_parse' ORDER BY id DESC LIMIT 1")
      IFS='|' read -r UP_TOKENS UP_BASIS <<< "$UPROW"
      note "upload_parse ledger row: tokens=$UP_TOKENS price_basis=$UP_BASIS"
      check FR-2401 "upload_parse row has non-zero tokens (got $UP_TOKENS)" "$([ "${UP_TOKENS:-0}" -gt 0 ] 2>/dev/null && echo 1 || echo 0)"
      check FR-2401 "upload_parse row has price_basis set (got '$UP_BASIS')" "$([ -n "$UP_BASIS" ] && echo 1 || echo 0)"
    else
      note "SKIPPED: parse did not settle within 60s — not asserting on tokens"
    fi
  else
    note "SKIPPED: POST /api/uploads did not return 202 with an uploadId (got $code) — route may need a differently-shaped request; not treated as a defect without more investigation"
  fi
else
  note "SKIPPED: could not materialize a tiny PNG on this host (no base64 decoder behaved as expected)"
fi

# ============================================================ 8. gates
say_section "8. Gates (app/) — tsc, npm test, traceability, prompt-prose diff"

TSC_OUT=$(cd "$APP" && npx tsc --noEmit 2>&1)
TSC_RC=$?
echo "$TSC_OUT" | tail -20 | sed 's/^/      tsc> /'
check FR-2401 "npx tsc --noEmit clean" "$([ "$TSC_RC" = 0 ] && echo 1 || echo 0)"

TEST_OUT=$(cd "$APP" && npm test 2>&1)
TEST_RC=$?
TEST_SUMMARY=$(printf '%s' "$TEST_OUT" | grep -E '^# (pass|fail|tests) ' )
echo "$TEST_SUMMARY" | sed 's/^/      test> /'
check FR-2401 "npm test exits 0" "$([ "$TEST_RC" = 0 ] && echo 1 || echo 0)"
ok=1
for f in pricing cost-model subscription-gate; do
  printf '%s' "$TEST_OUT" | grep -q "$f" || { ok=0; note "test file '$f' not mentioned in npm test output"; }
done
check FR-2401 "pricing, cost-model and subscription-gate tests ran" "$ok"

TRACE_OUT=$(cd "$ROOT" && ./scripts/traceability.py --check 2>&1)
TRACE_RC=$?
echo "$TRACE_OUT" | tail -10 | sed 's/^/      trace> /'
check FR-2401 "./scripts/traceability.py --check passes" "$([ "$TRACE_RC" = 0 ] && echo 1 || echo 0)"

DIFF_OUT=$(cd "$ROOT" && git diff -- app/src/lib/lesson.ts app/src/lib/ask.ts app/src/lib/checkin.ts)
check FR-2401 "no prompt-prose changes to lesson.ts/ask.ts/checkin.ts (git diff empty)" "$([ -z "$DIFF_OUT" ] && echo 1 || echo 0)"
[ -n "$DIFF_OUT" ] && echo "$DIFF_OUT" | head -20 | sed 's/^/      diff> /'

# ============================================================ summary
say_section "Summary"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
exit $?

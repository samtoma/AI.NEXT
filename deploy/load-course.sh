#!/usr/bin/env bash
# load-course interface: 1
# =============================================================================
# AI.Next — "Load a course": put ONE course that is not yet in noor's database
# into it. Add-only, backed up and verified first, never visible to a student
# until an operator sets a rule. (FR-4208, FR-4209; contracts/load-course.md;
# privacy review F13-F17; ADR-0024)
#
#   bash deploy/load-course.sh <course-id> dry-run    what a load would do; writes NOTHING
#   bash deploy/load-course.sh <course-id> rehearse   the whole load on a throwaway COPY of
#                                                     the database, checked, then dropped
#   bash deploy/load-course.sh <course-id> load       back up, verify, load, check
#   bash deploy/load-course.sh restore <file.dump>    roll back to a backup (the printed line)
#   bash deploy/load-course.sh verify-backup <file>   does this backup read back end to end?
#
# Normally started from GitHub: Actions -> "Load a course (manual)". Runbook:
# deploy/DEPLOY-MVP1.md -> "Loading a course".
#
# EXIT CODES (the workflow summary explains each):
#   0  loaded; or already loaded, nothing to do; or the dry run / rehearsal is clean
#   1  usage, or an unexpected error
#   2  a precondition REFUSED — nothing was written
#   3  the backup failed or did not verify — nothing was written
#   4  a load step or the post-flight check failed — the rollback line was printed
#
# WHAT IT NEVER DOES: touch another course's content, touch a student row,
# write a visibility rule (course_availability / student_course_access), run
# inside a deploy, or re-load a course that is already present.
#
# THE ORDER, and why:
#   1. the course's book config is read and checked in the loader container
#      (book_config.check_book: bundles, generated files, parity constant);
#   2. PRESENCE, per component, by this course's OWN ids — the course node, its
#      misconception catalogue, its generated questions. Never a total count
#      (privacy review F14). All present -> "already loaded", exit 0;
#   3. PRECONDITIONS, each a named refusal (exit 2): no visibility row for the
#      course; the running app image carries the label
#      org.ainext.features=curriculum-scope (deploy/Dockerfile, T319) — without
#      it the student readers are not scoped and loading would name this book
#      to every student (FR-4202, F13); the book's lesson prose is in that
#      image; and the drift guard is GREEN for every loaded course BEFORE we
#      start, so a red after the load can only be this load;
#   4. BACKUP (rehearse, load): pg_dump -Fc, verified by pg_restore --list and a
#      full read of every block; the one-line rollback is printed (FR-4208);
#   5. LOAD, add-only, one loader per missing component, as ainext_maint:
#        load_seed.py --all --course C --if-absent
#        load_misconceptions.py <the book's catalogue> --add-only
#        load_generated_questions.py <each generated bundle> --restore --sample 0 --add-only
#      Each step is its own transaction. A failure between steps leaves the
#      course partly loaded and still hidden; re-running `load` resumes;
#   6. POST-FLIGHT, reading only: the course is complete; its counts; the drift
#      guard for EVERY loaded course (F17); zero visibility rows; every other
#      course's content byte-identical to before; (rehearse) every student row
#      byte-identical to before.
#
#   7. RESTORE (separate mode, not part of the numbered flow above): verifies
#      the named backup (never touches the database on a backup that does not
#      read back end to end), takes a pre-restore backup of its own so this too
#      is undoable, stops the student app and the console, restores in one
#      transaction, re-applies this checkout's migrations, restarts both,
#      checks they answer — then a READ-ONLY post-flight: the drift guard for
#      every course now in the database (F17), and what is now present. This
#      undoes a `load`, but it also undoes everything else students did since
#      the backup, which is why it always takes its own undo-the-undo backup
#      first.
# =============================================================================
set -euo pipefail

OPS_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/ops-lib.sh
. "$OPS_HERE/ops-lib.sh"

usage() {
  sed -n '9,14p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-1}"
}

# --- the book facts, read in the loader container (it has python + pydantic) -----
# Prints KEY=VALUE lines; never touches the database. The id lists come out as
# SQL array literals with quotes doubled, built from the committed catalogue and
# bundles — never from an input.
FACTS_PY='
import hashlib, json, re, sys
course = sys.argv[1] if len(sys.argv) > 1 else ""
SAFE = re.compile(r"^[A-Za-z0-9._/-]+$")
def out(k, v=""):
    print(f"{k}=" + str(v).replace("\n", " ").replace("\r", " "))
try:
    import book_config as bc
    books = bc.all_books()
except BaseException as e:
    out("PROBLEM", f"the book configs do not load: {e}"); sys.exit(0)
for b in books:
    out("CONFIGURED", f"{b.course_id} {b.book} {1 if b.parity else 0}")
if not course:
    # No course named (the restore post-flight: every configured book, no
    # one course to look up) — CONFIGURED is already printed. Stop here.
    sys.exit(0)
try:
    book = bc.book_for_course(course)
except BaseException as e:
    out("PROBLEM", str(e)); sys.exit(0)
if book is None:
    out("PROBLEM", f"no book config names {course} (services/extraction/books/*.json configure: "
        + ", ".join(b.course_id for b in books) + ")")
    sys.exit(0)
out("BOOK", book.book); out("TITLE", book.title); out("CURRICULUM", book.curriculum)
try:
    problems = bc.check_book(book, books)
except BaseException as e:
    problems = [f"check_book could not run: {e}"]
for p in problems:
    out("PROBLEM", p)
if book.parity is None:
    out("PROBLEM", f"{book.book}: no parity constant in its book config; the drift guard cannot check this course (FR-4207)")
mc = book.generated.misconceptions if book.generated else None
gq = list(book.generated.questions) if book.generated else []
for rel in ([mc] if mc else []) + gq + list(book.content_files):
    if not SAFE.match(rel):
        out("PROBLEM", f"path {rel!r} has characters this script will not pass on")
def ids(rel, key):
    return [x["id"] for x in json.loads(book.repo_path(rel).read_text()).get(key, [])]
def arr(xs):
    return "ARRAY[" + ",".join("\x27" + x.replace("\x27", "\x27\x27") + "\x27" for x in xs) + "]::text[]"
mc_ids, gq_ids = [], []
try:
    if mc:
        mc_ids = ids(mc, "misconceptions")
    for rel in gq:
        gq_ids += ids(rel, "questions")
except Exception as e:
    out("PROBLEM", f"cannot read the generated files: {e}")
out("MC_FILE", mc or ""); out("MC_N", len(mc_ids)); out("MC_IDS_SQL", arr(mc_ids))
for rel in gq:
    out("GQ_FILE", rel)
out("GQ_N", len(gq_ids)); out("GQ_IDS_SQL", arr(gq_ids))
for rel in book.content_files:
    p = book.repo_path(rel)
    if p.exists():
        out("CONTENT", hashlib.sha256(p.read_bytes()).hexdigest() + " " + rel)
'

BOOK=""; TITLE=""; CURRICULUM=""; MC_FILE=""; MC_N=0; GQ_N=0
MC_IDS_SQL="ARRAY[]::text[]"; GQ_IDS_SQL="ARRAY[]::text[]"
PROBLEMS=(); CONFIGURED=(); GQ_FILES=(); CONTENT=()

book_facts() {  # [course] — omit (or pass "") for every CONFIGURED book, no per-course lookup
  local facts line k v course="${1-$COURSE}"
  facts="$(dc --profile tools run --rm -T --no-deps --entrypoint python loader -c "$FACTS_PY" "$course")" \
    || die "could not read the book configs in the loader container"
  while IFS= read -r line; do
    k="${line%%=*}"; v="${line#*=}"
    case "$k" in
      PROBLEM)    PROBLEMS+=("$v") ;;
      CONFIGURED) CONFIGURED+=("$v") ;;
      BOOK) BOOK="$v" ;; TITLE) TITLE="$v" ;; CURRICULUM) CURRICULUM="$v" ;;
      MC_FILE) MC_FILE="$v" ;; MC_N) MC_N="$v" ;; MC_IDS_SQL) MC_IDS_SQL="$v" ;;
      GQ_FILE) GQ_FILES+=("$v") ;; GQ_N) GQ_N="$v" ;; GQ_IDS_SQL) GQ_IDS_SQL="$v" ;;
      CONTENT) CONTENT+=("$v") ;;
    esac
  done <<<"$facts"
}

# --- presence, per component, by the course's own ids -----------------------------
P_NODE=0; P_MC=0; P_GQ=0
presence() {  # <database>
  local r
  r="$(sql_on "$1" -v c="$COURSE" <<SQL
SELECT (SELECT count(*) FROM graph_nodes WHERE id = :'c' AND kind = 'course')
       || ' ' || (SELECT count(*) FROM misconceptions WHERE id = ANY($MC_IDS_SQL))
       || ' ' || (SELECT count(*) FROM questions      WHERE id = ANY($GQ_IDS_SQL));
SQL
)"
  read -r P_NODE P_MC P_GQ <<<"$r"
}
node_done() { [ "$P_NODE" = 1 ]; }
mc_done()   { [ "$P_MC" -ge "$MC_N" ]; }
gq_done()   { [ "$P_GQ" -ge "$GQ_N" ]; }
complete()  { node_done && mc_done && gq_done; }
print_presence() {
  info "course node             $([ "$P_NODE" = 1 ] && echo present || echo absent)"
  if [ -n "$MC_FILE" ]; then info "misconception catalogue $P_MC of $MC_N present ($MC_FILE)"
  else info "misconception catalogue none configured for this book"; fi
  if [ "${#GQ_FILES[@]}" -gt 0 ]; then info "generated questions     $P_GQ of $GQ_N present (${GQ_FILES[*]})"
  else info "generated questions     none configured for this book"; fi
}

visibility_rows() {  # <database> -> "<rules> <exceptions>"
  sql_on "$1" -v c="$COURSE" <<'SQL'
SELECT (SELECT count(*) FROM course_availability   WHERE course_id = :'c')
       || ' ' || (SELECT count(*) FROM student_course_access WHERE course_id = :'c');
SQL
}

course_summary() {  # <database>
  sql_on "$1" -v c="$COURSE" <<'SQL' | sed 's/^/     /'
WITH los AS (SELECT node_id FROM node_subject WHERE course_id = :'c')
SELECT 'objectives      ' || count(*) FROM los
UNION ALL
(SELECT format('questions %-9s live %5s   held %5s   never human-reviewed %5s', source,
               count(*) FILTER (WHERE status = 'live'), count(*) FILTER (WHERE status <> 'live'),
               count(*) FILTER (WHERE reviewed_by IS NULL))
   FROM questions WHERE lo_id IN (SELECT node_id FROM los) GROUP BY source ORDER BY source)
UNION ALL
SELECT 'visuals         ' || count(*) FROM visuals WHERE lo_id IN (SELECT node_id FROM los)
UNION ALL
SELECT 'misconceptions  ' || count(*) FROM misconceptions WHERE lo_id IN (SELECT node_id FROM los)
UNION ALL
SELECT 'explanations    ' || count(*) FROM explanation_library WHERE lo_id IN (SELECT node_id FROM los);
SQL
}

# Every OTHER course's content, as one digest per course: its objectives, the
# edges touching them, their questions, visuals, misconceptions and
# explanations — every column. Taken before and after; they must be equal.
other_courses_digest() {  # <database>
  sql_on "$1" -v c="$COURSE" <<'SQL'
SELECT c.id || ' ' || md5(
  coalesce((SELECT string_agg(n::text, E'\n' ORDER BY n.id) FROM graph_nodes n
             WHERE n.id IN (SELECT node_id FROM node_subject WHERE course_id = c.id)), '') ||
  coalesce((SELECT string_agg(e::text, E'\n' ORDER BY e::text) FROM graph_edges e
             WHERE e.src_id IN (SELECT node_id FROM node_subject WHERE course_id = c.id)
                OR e.dst_id IN (SELECT node_id FROM node_subject WHERE course_id = c.id)), '') ||
  coalesce((SELECT string_agg(q::text, E'\n' ORDER BY q.id) FROM questions q
             WHERE q.lo_id IN (SELECT node_id FROM node_subject WHERE course_id = c.id)), '') ||
  coalesce((SELECT string_agg(v::text, E'\n' ORDER BY v.id) FROM visuals v
             WHERE v.lo_id IN (SELECT node_id FROM node_subject WHERE course_id = c.id)), '') ||
  coalesce((SELECT string_agg(m::text, E'\n' ORDER BY m.id) FROM misconceptions m
             WHERE m.lo_id IN (SELECT node_id FROM node_subject WHERE course_id = c.id)), '') ||
  coalesce((SELECT string_agg(x::text, E'\n' ORDER BY x.id) FROM explanation_library x
             WHERE x.lo_id IN (SELECT node_id FROM node_subject WHERE course_id = c.id)), ''))
  FROM graph_nodes c WHERE c.kind = 'course' AND c.id <> :'c' ORDER BY c.id;
SQL
}

# Every table that holds a student's data, as rows + a digest. Exact on a
# throwaway copy (nobody is studying in it); on the live database students keep
# working during a load, so there it is reported, not compared.
STUDENT_TABLES="students accounts guardians attempts mastery understanding_checks explanation_log
  sessions student_progress ai_interactions analytics_events uploads safety_flags feedback
  student_course_access student_curriculum_changes student_testers course_availability"
student_digest() {  # <database>
  local have t sql=""
  have="$(dbq "SELECT string_agg(tablename, ' ' ORDER BY tablename) FROM pg_tables
               WHERE schemaname = 'public' AND tablename = ANY(string_to_array('$(echo $STUDENT_TABLES)', ' '))" "$1")"
  for t in $have; do
    sql="$sql SELECT '$t ' || count(*) || ' ' || coalesce(md5(string_agg(x::text, E'\\n' ORDER BY x::text)), '-') FROM public.$t x;"
  done
  [ -n "$sql" ] && printf '%s\n' "$sql" | sql_on "$1"
}

present_courses() {  # <database>
  dbq "SELECT string_agg(id, ' ' ORDER BY id) FROM graph_nodes WHERE kind = 'course'" "$1"
}

# The drift guard for every loaded course that has a book config with a
# constant. A course node with no config cannot be checked, and says so.
PARITY_OUT=""
drift_guard() {  # <database> -> 0 green, 1 red/error
  local db="$1" present c line id bk p has
  local args=() unconfigured=()
  present="$(present_courses "$db")"
  for c in $present; do
    has=""
    for line in "${CONFIGURED[@]}"; do
      read -r id bk p <<<"$line"
      [ "$id" = "$c" ] && has="$p"
    done
    if [ "$has" = 1 ]; then args+=(--course "$c"); else unconfigured+=("$c"); fi
  done
  [ "${#unconfigured[@]}" -gt 0 ] && info "loaded but not checkable (no book config with a parity constant): ${unconfigured[*]}"
  if [ "${#args[@]}" -eq 0 ]; then info "no loaded course has a parity constant — nothing to check"; PARITY_OUT=""; return 0; fi
  local rc=0
  PARITY_OUT="$(loader_run "$db" parity_check.py "${args[@]}" 2>&1)" || rc=$?
  if [ "$rc" = 0 ]; then
    # Green: one line per course. The full fingerprint is noise at midnight.
    grep -E 'PARITY: ' <<<"$PARITY_OUT" | sed 's/^/     /'
  else
    printf '%s\n' "$PARITY_OUT" | sed 's/^/     /'
  fi
  return "$rc"
}

# --- the loaders ----------------------------------------------------------------
load_steps() {  # <database>
  local db="$1" f
  if node_done; then info "step 1/3  course node present — book content not re-loaded (--if-absent)"
  else
    say "Step 1/3 — the book: load_seed.py --all --course $COURSE --if-absent"
    loader_run "$db" load_seed.py --all --course "$COURSE" --if-absent || return 1
  fi
  if [ -z "$MC_FILE" ]; then info "step 2/3  no misconception catalogue configured"
  elif mc_done; then info "step 2/3  misconception catalogue present ($P_MC of $MC_N) — not re-loaded"
  else
    say "Step 2/3 — the misconception catalogue: load_misconceptions.py $MC_FILE --add-only"
    loader_run "$db" load_misconceptions.py "/repo/$MC_FILE" --add-only || return 1
  fi
  if [ "${#GQ_FILES[@]}" -eq 0 ]; then info "step 3/3  no generated questions configured"
  elif gq_done; then info "step 3/3  generated questions present ($P_GQ of $GQ_N) — not re-loaded"
  else
    for f in "${GQ_FILES[@]}"; do
      say "Step 3/3 — generated questions: load_generated_questions.py $f --restore --sample 0 --add-only"
      loader_run "$db" load_generated_questions.py "/repo/$f" --restore --sample 0 --add-only || return 1
    done
  fi
}

# --- the post-flight: reads only; prints everything, then says pass or fail ------
postflight() {  # <database> <digest-before> <student-digest-before or "">
  local db="$1" before="$2" sbefore="$3" failed=0 vis after safter
  say "Post-flight on $db (read-only)"
  presence "$db"; print_presence
  if complete; then ok "the course is complete"; else warn "the course is NOT complete"; failed=1; fi
  info "what students would get once a rule allows it:"
  course_summary "$db"
  vis="$(visibility_rows "$db")"
  if [ "$vis" = "0 0" ]; then ok "visibility rows for $COURSE: 0 rules, 0 exceptions — hidden from every student"
  else warn "visibility rows for $COURSE: $vis (rules exceptions) — expected 0 0"; failed=1; fi
  info "drift guard, every loaded course:"
  if drift_guard "$db"; then ok "drift guard GREEN for every loaded course"
  else warn "drift guard RED (see above)"; failed=1; fi
  after="$(other_courses_digest "$db")"
  if [ "$after" = "$before" ]; then ok "every other course's content is byte-identical to before ($(wc -l <<<"$after" | tr -d ' ') course(s))"
  else warn "ANOTHER COURSE'S CONTENT CHANGED:"; diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | sed 's/^/      /' || true; failed=1; fi
  if [ -n "$sbefore" ]; then
    safter="$(student_digest "$db")"
    if [ "$safter" = "$sbefore" ]; then ok "every student table is byte-identical to before ($(wc -l <<<"$safter" | tr -d ' ') tables)"
    else warn "STUDENT DATA CHANGED:"; diff <(printf '%s\n' "$sbefore") <(printf '%s\n' "$safter") | sed 's/^/      /' || true; failed=1; fi
  fi
  return "$failed"
}

# =============================================================================
case "${1:-}" in
  ""|-h|--help|help) usage 0 ;;
  restore)
    [ $# -eq 2 ] || usage
    ops_preflight
    ops_build_loader
    say "ROLLBACK — restoring $2 over $OPS_DB"
    warn "everything students did after that backup was taken is replaced by the backup."
    warn "a pre-restore backup is taken first, so this too can be undone."
    ops_restore "$2"
    say "Post-flight (read-only): the drift guard for every course now in the database"
    book_facts ""
    info "courses in the database now: $(present_courses "$OPS_DB")"
    if [ "${#CONFIGURED[@]}" -eq 0 ]; then
      warn "no book config could be read from this checkout — the drift guard cannot run; check by hand once the box is calm"
    elif drift_guard "$OPS_DB"; then
      ok "drift guard GREEN for every loaded course"
    else
      warn "drift guard is NOT green after the restore (above) — this restore put back exactly what the backup held; if the guard is red, the backup itself predates a fix. Tell Samuel before anyone uses this environment."
    fi
    say "Done"
    exit 0 ;;
  verify-backup)
    [ $# -eq 2 ] || usage
    ops_preflight
    if ops_verify_backup "$2"; then ok "$2 reads back end to end"; exit 0; fi
    exit 3 ;;
esac

COURSE="${1:-}"; MODE="${2:-}"
[ $# -eq 2 ] || usage
[[ "$COURSE" =~ ^course:[a-z0-9-]+$ ]] || refuse "'$COURSE' is not a course node id (e.g. course:us-g10-math-en)"
case "$MODE" in dry-run|rehearse|load) ;; *) refuse "mode must be dry-run, rehearse or load (got '$MODE')" ;; esac
SLUG="$(printf '%s' "${COURSE#course:}" | tr -c 'a-z0-9-' '-')"

say "Load a course — $COURSE — $MODE"
info "stack      project $OPS_PROJECT, database $OPS_DB"
info "checkout   $OPS_REPO @ $(git -C "$OPS_REPO" rev-parse --short HEAD 2>/dev/null || echo '(not a git checkout)')"
info "backups    $OPS_BACKUP_DIR"
ops_preflight
ops_build_loader

say "1. The book config"
book_facts
if [ -n "$BOOK" ]; then info "book $BOOK — $TITLE (curriculum $CURRICULUM)"; fi
if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  for p in "${PROBLEMS[@]}"; do warn "$p"; done
  refuse "the book config for $COURSE is not loadable from this checkout (above). Nothing was written."
fi
ok "book config, bundles and generated files check out; parity constant present"

say "2. Is it already here? (by this course's own ids, per component)"
presence "$OPS_DB"
print_presence
if complete; then
  say "$COURSE is already loaded — nothing to do"
  course_summary "$OPS_DB"
  read -r RULES EXC <<<"$(visibility_rows "$OPS_DB")"
  info "visibility: $RULES rule(s), $EXC exception(s) — set in the console's /courses and Student 360"
  info "drift guard for this course:"
  rc=0; out="$(loader_run "$OPS_DB" parity_check.py --course "$COURSE" 2>&1)" || rc=$?
  printf '%s\n' "$out" | sed 's/^/     /'
  if [ "$rc" = 0 ]; then ok "drift guard GREEN for $COURSE"
  else warn "drift guard is NOT green for $COURSE (above) — this action changes nothing; raise it with Samuel"; fi
  info "nothing was written."
  exit 0
fi
if node_done; then warn "the course node is present but the course is incomplete — an earlier load stopped part-way; this run adds only what is missing"; fi

say "3. Preconditions"
refusals=()
read -r RULES EXC <<<"$(visibility_rows "$OPS_DB")"
if [ "$RULES" = 0 ] && [ "$EXC" = 0 ]; then ok "no visibility rule or exception names $COURSE"
else
  warn "$RULES course_availability rule(s) and $EXC student exception(s) already name $COURSE"
  refusals+=("visibility was written before the course was loaded — remove those rows in the console (/courses, Student 360) or ask Samuel; a load must land hidden")
fi

for svc in app console; do
  if ! svc_running "$svc"; then
    if [ "$svc" = app ]; then refusals+=("the student app is not running — deploy first"); fi
    continue
  fi
  cid="$(dc ps -q "$svc")"
  img="$(docker inspect -f '{{.Image}}' "$cid")"
  feats="$(docker image inspect -f '{{with .Config.Labels}}{{index . "org.ainext.features"}}{{end}}' "$img" 2>/dev/null || true)"
  case ",$feats," in
    *,curriculum-scope,*) ok "running $svc image ${img#sha256:} carries org.ainext.features=$feats" ;;
    *) warn "running $svc image ${img#sha256:} does not carry org.ainext.features=curriculum-scope (it has '${feats:-nothing}')"
       refusals+=("the running $svc predates scoped student readers (T314-T319): loading now would name this book to every student (FR-4202). Deploy the release that carries the label, then load") ;;
  esac
done

if [ "${#CONTENT[@]}" -gt 0 ] && svc_running app; then
  rels=(); for e in "${CONTENT[@]}"; do rels+=("${e#* }"); done
  in_image="$(dc exec -T app sh -c 'cd /repo && for f; do if [ -f "$f" ]; then sha256sum "$f"; else echo "MISSING  $f"; fi; done' -- "${rels[@]}" 2>/dev/null || true)"
  missing=0; differ=0
  for e in "${CONTENT[@]}"; do
    sha="${e%% *}"; rel="${e#* }"
    got="$(grep -F "  $rel" <<<"$in_image" | head -1 | cut -d' ' -f1 || true)"
    if [ -z "$got" ] || [ "$got" = MISSING ]; then missing=$((missing + 1))
    elif [ "$got" != "$sha" ]; then differ=$((differ + 1)); fi
  done
  if [ "$missing" -gt 0 ]; then
    refusals+=("$missing of the book's ${#CONTENT[@]} lesson-content file(s) are not in the running image: lessons would load without their text. Deploy first")
  elif [ "$differ" -gt 0 ]; then
    warn "$differ lesson-content file(s) in the running image differ from this checkout — the image serves older lesson text until the next deploy"
  else ok "the running image serves this book's ${#CONTENT[@]} lesson-content file(s)"; fi
else
  info "no lesson-content files configured for this book — nothing to check in the image"
fi

info "drift guard BEFORE the load (every loaded course):"
if drift_guard "$OPS_DB"; then ok "drift guard GREEN before the load"
else refusals+=("the drift guard is already RED before this load (above). A post-flight would fail for a reason that is not this load. Fix that first, or ask Samuel"); fi

if [ "${#refusals[@]}" -gt 0 ]; then
  for r in "${refusals[@]}"; do warn "$r"; done
  refuse "$COURSE was not loaded: ${#refusals[@]} precondition(s) failed (above). Nothing was written."
fi
ok "every precondition holds"

DIGEST_BEFORE="$(other_courses_digest "$OPS_DB")"

case "$MODE" in
# -----------------------------------------------------------------------------
dry-run)
  say "4. Dry run — every write below is rolled back"
  if node_done; then info "step 1/3 skipped: the course node is present"
  else loader_run "$OPS_DB" load_seed.py --all --course "$COURSE" --if-absent --dry-run \
         || { warn "the book's dry run failed (above)"; refuse "a load would fail at step 1. Nothing was written."; }
  fi
  if [ -n "$MC_FILE" ] && ! mc_done; then
    loader_run "$OPS_DB" load_misconceptions.py "/repo/$MC_FILE" --add-only --dry-run \
      || refuse "a load would fail at step 2. Nothing was written."
    info "(in a dry run step 1 has not written this course's questions, so a catalogue mapping onto them shows as 'matched nothing' — rehearse shows the real result)"
  fi
  if [ "${#GQ_FILES[@]}" -gt 0 ] && ! gq_done; then
    info "step 3/3: $GQ_N generated question(s) in ${GQ_FILES[*]} would be added (add-only)."
    info "(they are validated against the catalogue step 2 writes, so only rehearse can check them)"
  fi
  was="$P_NODE $P_MC $P_GQ"
  presence "$OPS_DB"
  if [ "$(other_courses_digest "$OPS_DB")" = "$DIGEST_BEFORE" ] && [ "$P_NODE $P_MC $P_GQ" = "$was" ]; then
    ok "nothing was written: every other course is byte-identical, and $COURSE is as it was ($was)"
  else
    die "the database CHANGED during a dry run — this is a defect in a loader's --dry-run; stop and tell Samuel"
  fi
  say "DRY RUN CLEAN — next: mode 'rehearse' (the whole load on a throwaway copy), then 'load'"
  exit 0 ;;

# -----------------------------------------------------------------------------
rehearse)
  SCRATCH=""; REHEARSE_DUMP=""
  rehearse_cleanup() {
    local rc=$?
    if [ -n "$SCRATCH" ]; then
      case "$SCRATCH" in
        ainext_rehearse_*)
          if dbq "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)" >/dev/null 2>&1; then info "dropped the throwaway database $SCRATCH"
          else warn "could not drop $SCRATCH — drop it by hand: $(dc_hint) exec db psql -U ainext -d $OPS_DB -c 'DROP DATABASE \"$SCRATCH\" WITH (FORCE)'"; fi ;;
      esac
    fi
    if [ -n "$REHEARSE_DUMP" ] && [ -f "$REHEARSE_DUMP" ]; then
      rm -f "$REHEARSE_DUMP" && info "removed the rehearsal's copy of the database ($REHEARSE_DUMP)"
    fi
    exit "$rc"
  }
  trap rehearse_cleanup EXIT
  say "4. Rehearsal — the real database is only READ; everything is written to a throwaway copy"
  ops_backup "rehearse-$SLUG" transient
  REHEARSE_DUMP="$LAST_BACKUP"
  SCRATCH="ainext_rehearse_$(date -u +%Y%m%d%H%M%S)_$$"
  dbq "CREATE DATABASE \"$SCRATCH\"" >/dev/null || die "could not create the throwaway database $SCRATCH"
  info "restoring the verified backup into $SCRATCH"
  dc exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --exit-on-error --single-transaction -U ainext -d "$1"' -- "$SCRATCH" < "$REHEARSE_DUMP" \
    || die "the verified backup did not restore into $SCRATCH — the rollback path is broken; do NOT run 'load' until this is understood"
  ok "the backup restores cleanly (this is the rollback path, proven)"
  [ "$(other_courses_digest "$SCRATCH")" = "$DIGEST_BEFORE" ] || die "the restored copy differs from the live database — the backup is not faithful"
  STUDENTS_BEFORE="$(student_digest "$SCRATCH")"
  if ! load_steps "$SCRATCH"; then
    printf '%s\nREHEARSAL FAILED at a load step (above). The real database was not touched.%s\n' "$C_R" "$C_0" >&2
    exit 4
  fi
  if ! postflight "$SCRATCH" "$DIGEST_BEFORE" "$STUDENTS_BEFORE"; then
    printf '%s\nREHEARSAL FAILED its post-flight (above). The real database was not touched.%s\n' "$C_R" "$C_0" >&2
    exit 4
  fi
  say "REHEARSAL CLEAN — the backup restores, the load applies, the post-flight passes"
  info "the real database was only read. Next: mode 'load'."
  exit 0 ;;

# -----------------------------------------------------------------------------
load)
  say "4. Backup"
  ops_backup "load-$SLUG"
  ROLLBACK="bash $OPS_HERE/load-course.sh restore $LAST_BACKUP"
  info "roll back with:  $ROLLBACK"
  info "(by hand, if this script cannot run: $(dc_hint) exec -T db sh -c 'PGPASSWORD=\"\$POSTGRES_PASSWORD\" pg_restore --clean --if-exists --single-transaction -U ainext -d $OPS_DB' < $LAST_BACKUP )"
  say "5. Load (add-only)"
  if ! load_steps "$OPS_DB"; then
    printf '%s\nA LOAD STEP FAILED (above). Each step is its own transaction, so the course may be partly\nloaded — and it is still hidden (no visibility rule exists). Either re-run mode load (it resumes:\nevery step is add-only and skips what is present), or roll back with:\n  %s%s\n' "$C_R" "$ROLLBACK" "$C_0" >&2
    exit 4
  fi
  if ! postflight "$OPS_DB" "$DIGEST_BEFORE" ""; then
    printf '%s\nPOST-FLIGHT FAILED (above). The course is loaded and hidden. Decide with Samuel; to undo:\n  %s%s\n' "$C_R" "$ROLLBACK" "$C_0" >&2
    exit 4
  fi
  info "students' own rows were not compared here (they keep studying during a load); the loaders never write them, and 'rehearse' proves it on a copy"
  say "LOADED — $COURSE is in the database, complete, and HIDDEN from every student"
  info "next: console -> /courses -> set the (course, grade) rule, or give a test account an exception in Student 360"
  info "roll back with:  $ROLLBACK"
  exit 0 ;;
esac

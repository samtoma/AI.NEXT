#!/bin/sh
# ===========================================================================
# The migration job CI runs (.github/workflows/ci-cd.yml, `migrations`), and
# the same thing on a laptop.
#
#   scripts/ci-migrations.sh all <prev-tree> <head-tree>
#   scripts/ci-migrations.sh apply <tree> <db>        one pass of <tree>'s own deploy
#   scripts/ci-migrations.sh seed <db>                 an operator holding every role
#   scripts/ci-migrations.sh proofs <tree> <db>        the 029 / 030 proofs
#
# <tree> is a directory holding `db/` and `deploy/apply-migrations.sh` — a
# checkout, or `git archive <tag> db deploy | tar -x`. Connection comes from
# PGHOST / PGPORT / PGUSER / PGPASSWORD, as a SUPERUSER (the box runs the
# migrations as the database owner — deploy/apply-migrations.sh says why).
# Scratch database names start with ${CI_DB_PREFIX:-ainext_ci}; every one this
# script creates it drops by its exact name, and it never drops anything else.
#
# ---------------------------------------------------------------------------
# WHY IT RUNS THE TREE'S OWN apply-migrations.sh
# ---------------------------------------------------------------------------
# The question is "what happens on the box when THIS build deploys onto THAT
# database", and the box answers it with that build's
# `deploy/apply-migrations.sh`: its schema probe, its every-file-every-time
# loop, `--single-transaction` per file, its floor and its post-flight checks.
# A re-implementation here would test the re-implementation. So the tree's own
# script runs, with exactly one edit: its two hard-coded container paths
# (`/db/schema.sql`, `/db/migrations`) point at the tree instead. The edit is
# asserted — if a future script moves those lines, this fails rather than
# silently applying nothing.
#
# ---------------------------------------------------------------------------
# WHAT `all` PROVES — the three things the 2026-09-23 outage taught
# ---------------------------------------------------------------------------
#  (a) HEAD onto an EMPTY database, three times. Every file is idempotent, and
#      the second and third runs are the claim being tested, not the first.
#  (b) UPGRADE: the previous release onto an empty database, an operator
#      seeded the way `bootstrap-operator.mts` seeds one, then HEAD twice.
#      This is the deploy that will actually happen.
#  (c) ROLLBACK: the previous release's migrations over HEAD's schema, twice,
#      with HEAD's data in it (an operator holding every role HEAD knows) —
#      and then HEAD again. This is the deploy that happens on a bad day, and
#      on 2026-09-23 it was the one that took the site down (migration 008
#      undid 010). v0.6.0's 014 re-adds a four-role CHECK unconditionally, so
#      (c) FAILS against v0.6.0 by design: that is the hazard v0.6.1 fixed.
#      See KNOWN_UNSAFE_ROLLBACK below.
#  (d) the proofs for 029 and 030 (`proofs`), on their own database.
#
# POSIX sh: it runs the trees' scripts under the same shell family the box
# does (the `migrate` service is postgres:17-alpine, busybox sh).
# ===========================================================================

set -eu

PREFIX=${CI_DB_PREFIX:-ainext_ci}
PSQL="psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc"

# Releases whose migration 014 rebuilds the operator-roles CHECK
# unconditionally. Rolling back ONTO one of them after v0.7.0 is refused by
# Postgres (a row holds the fifth role) — the hazard, not a bug in HEAD. For
# these, (c) is run, its failure is reported as a warning, and the job does not
# fail. Every later release must pass (c) outright. deploy/DEPLOY-MVP1.md,
# "Rolling back", says what to do if one of these ever has to be redeployed.
KNOWN_UNSAFE_ROLLBACK="v0.6.0 v0.5.0 v0.1.0"

say() { printf '  %s\n' "$*"; }
hdr() { printf '\n== %s ==\n' "$*"; }
fail() { printf '\n!! %s\n' "$*" >&2; exit 1; }

# Throwaway role passwords, in CI ONLY: apply-migrations.sh sets them (3a')
# and then refuses to finish while any is empty (3b). Three different values,
# as it insists; they protect nothing — the cluster lives for one job. Never
# on a laptop: the three roles are CLUSTER-wide, and resetting their passwords
# would pull the credentials out from under every other database and dev
# server on that cluster. Locally 3a' is skipped and 3b reads what is there.
if [ "${CI:-}" = "true" ]; then
  export AINEXT_APP_PASSWORD=ci-app-not-a-secret
  export AINEXT_OPERATOR_PASSWORD=ci-operator-not-a-secret
  export AINEXT_MAINT_PASSWORD=ci-maint-not-a-secret
fi
# The tree's script insists PGPASSWORD is set; a trust-auth laptop needs none.
export PGPASSWORD=${PGPASSWORD:-unused-under-trust-auth}

createdb_fresh() {
  case "$1" in "$PREFIX"_*) ;; *) fail "refusing to create $1: not a $PREFIX* name" ;; esac
  dropdb --if-exists "$1"
  createdb "$1"
}

dropdb_exact() {
  case "$1" in "$PREFIX"_*) dropdb --if-exists "$1" ;; *) fail "refusing to drop $1" ;; esac
}

# One deploy of <tree> onto <db>, through <tree>'s own script.
apply() {
  tree=$1 db=$2
  [ -f "$tree/deploy/apply-migrations.sh" ] || fail "$tree has no deploy/apply-migrations.sh"
  runner=$(mktemp "${TMPDIR:-/tmp}/apply-migrations.XXXXXX")
  sed -e "s#^SCHEMA_FILE=/db/schema.sql\$#SCHEMA_FILE='$tree/db/schema.sql'#" \
      -e "s#^MIGRATIONS_DIR=/db/migrations\$#MIGRATIONS_DIR='$tree/db/migrations'#" \
      "$tree/deploy/apply-migrations.sh" > "$runner"
  grep -q "^SCHEMA_FILE='$tree/db/schema.sql'\$" "$runner" \
    && grep -q "^MIGRATIONS_DIR='$tree/db/migrations'\$" "$runner" \
    || { rm -f "$runner"; fail "could not point $tree/deploy/apply-migrations.sh at the tree (its path lines moved?)"; }
  # `|| rc=$?` keeps `set -e` from ending this script before we can clean up
  # and say which pass failed.
  rc=0
  PGDATABASE=$db sh "$runner" || rc=$?
  rm -f "$runner"
  return $rc
}

# An operator the way app/scripts/bootstrap-operator.mts makes one: active,
# every role the CHECK on operator_roles admits RIGHT NOW (read from the
# constraint, so this never needs editing when a role is added), each grant
# recorded as `bootstrap:<role>`. Idempotent.
seed() {
  PGDATABASE=$1 $PSQL <<'SQL'
DO $seed$
DECLARE op bigint; def text; r text;
BEGIN
  SELECT id INTO op FROM operators WHERE lower(email) = 'ci-operator@example.invalid';
  IF op IS NULL THEN
    INSERT INTO operators (email, display_name, status, environment)
    VALUES ('ci-operator@example.invalid', 'CI operator', 'active', 'mvp1')
    RETURNING id INTO op;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.operator_roles'::regclass AND conname = 'operator_roles_role_check';
  FOR r IN SELECT (regexp_matches(def, '''([a-z-]+)''', 'g'))[1] LOOP
    IF NOT EXISTS (SELECT 1 FROM operator_roles
                    WHERE operator_id = op AND role = r AND revoked_at IS NULL) THEN
      INSERT INTO operator_roles (operator_id, role, environment) VALUES (op, r, 'mvp1');
      INSERT INTO auth_events (environment, event, outcome, actor_kind, actor_id,
                               subject_kind, subject_id, reason)
      VALUES ('mvp1', 'role_granted', 'success', 'operator', op, 'operator', op,
              'bootstrap:' || r);
    END IF;
  END LOOP;
  RAISE NOTICE 'seeded: operator % holds %', op,
    (SELECT string_agg(role, ', ' ORDER BY role) FROM operator_roles
      WHERE operator_id = op AND revoked_at IS NULL);
END
$seed$;
SQL
}

count_role_rows() {
  PGDATABASE=$1 $PSQL --tuples-only --no-align -c \
    "SELECT count(*) || '/' || count(*) FILTER (WHERE revoked_at IS NULL)
       FROM operator_roles WHERE role = '$2'"
}

# ---------------------------------------------------------------------------
# The proofs migrations 029 and 030 promise in their headers.
# ---------------------------------------------------------------------------
proofs() {
  tree=$1 db=$2
  P="$PSQL"
  m029="$tree/db/migrations/029-teaching-controls-role.sql"
  r029="$tree/db/migrations/rollback/029-teaching-controls-role.down.sql"
  [ -f "$m029" ] || { say "no migration 029 in $tree — nothing to prove"; return 0; }

  hdr "proof: 029 grants once, to active content-review holders, and never re-grants"
  # Five operators on a database 029 has not yet introduced the role in:
  # A, B active with content-review; C disabled; D with content-review
  # revoked; E active with student-data only. Only A and B qualify.
  # The database must be one 029 has not introduced the role in yet — a fresh
  # one, before any operator exists. Checked, never arranged: re-arming the
  # guard would mean deleting a security record, which is not a test's to do.
  armed=$(PGDATABASE=$db $P --tuples-only --no-align -c \
    "SELECT NOT EXISTS (SELECT 1 FROM operator_roles WHERE role = 'teaching-controls')
        AND NOT EXISTS (SELECT 1 FROM auth_events
                         WHERE reason IN ('migration-029:teaching-controls','bootstrap:teaching-controls'))")
  [ "$armed" = "t" ] || fail "029 proof needs a database where teaching-controls was never introduced"
  PGDATABASE=$db $P <<'SQL'
INSERT INTO operators (email, display_name, status, environment) VALUES
  ('p029-a@example.invalid','A','active','mvp1'), ('p029-b@example.invalid','B','active','mvp1'),
  ('p029-c@example.invalid','C','disabled','mvp1'), ('p029-d@example.invalid','D','active','mvp1'),
  ('p029-e@example.invalid','E','active','mvp1');
INSERT INTO operator_roles (operator_id, role, environment)
  SELECT id, r, 'mvp1' FROM operators, unnest(ARRAY['content-review','student-data']) r
   WHERE email IN ('p029-a@example.invalid','p029-b@example.invalid','p029-c@example.invalid','p029-d@example.invalid');
INSERT INTO operator_roles (operator_id, role, environment)
  SELECT id, 'student-data', 'mvp1' FROM operators WHERE email = 'p029-e@example.invalid';
UPDATE operator_roles SET revoked_at = now()
 WHERE role = 'content-review'
   AND operator_id = (SELECT id FROM operators WHERE email = 'p029-d@example.invalid');
SQL
  holders="SELECT coalesce(string_agg(o.display_name || CASE WHEN r.revoked_at IS NULL THEN '+' ELSE '-' END, ' ' ORDER BY o.display_name), '(none)')
             FROM operator_roles r JOIN operators o ON o.id = r.operator_id
            WHERE r.role = 'teaching-controls' AND o.email LIKE 'p029-%'"
  expect() {
    got=$(PGDATABASE=$db $P --tuples-only --no-align -c "$holders")
    [ "$got" = "$1" ] || fail "029 proof, $2: expected [$1], got [$got]"
    say "$2: $got"
  }
  PGDATABASE=$db $P -f "$m029" >/dev/null
  expect "A+ B+" "introduced (A, B; not disabled C, not revoked-content-review D, not E)"
  PGDATABASE=$db $P -c "UPDATE operator_roles SET revoked_at = now()
                          WHERE role = 'teaching-controls'
                            AND operator_id = (SELECT id FROM operators WHERE email = 'p029-b@example.invalid')" >/dev/null
  PGDATABASE=$db $P -f "$m029" >/dev/null
  PGDATABASE=$db $P -f "$m029" >/dev/null
  expect "A+ B-" "revoked from B, re-applied twice"
  PGDATABASE=$db $P -f "$r029" >/dev/null
  expect "(none)" "rollback/029"
  PGDATABASE=$db $P -f "$m029" >/dev/null
  expect "(none)" "re-applied after rollback — the auth_events trail keeps it shut, B is not re-granted"

  hdr "proof: a tester mark is removed once, and never reopened or rewritten (as ainext_operator)"
  PGDATABASE=$db $P <<'SQL'
DO $prep$
DECLARE sid bigint;
BEGIN
  INSERT INTO students (display_name, grade, environment) VALUES ('Proof child', '9', 'mvp1')
  RETURNING id INTO sid;
  INSERT INTO student_testers (environment, student_id, note, marked_by)
  VALUES ('mvp1', sid, 'proof', (SELECT id FROM operators WHERE email = 'p029-a@example.invalid'));
END
$prep$;
SET ROLE ainext_operator;
DO $proof$
DECLARE t bigint; a bigint := (SELECT id FROM operators WHERE email = 'p029-a@example.invalid');
        b bigint := (SELECT id FROM operators WHERE email = 'p029-b@example.invalid');
BEGIN
  SELECT id INTO t FROM student_testers WHERE note = 'proof';
  BEGIN
    UPDATE student_testers SET unmarked_by = a WHERE id = t;
    RAISE EXCEPTION 'PROOF FAILED: unmarked_by stamped without unmarked_at';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'refused: unmarked_by alone';
  END;
  UPDATE student_testers SET unmarked_at = now(), unmarked_by = a WHERE id = t;
  RAISE NOTICE 'allowed: the one removal (NULL -> a value)';
  BEGIN
    UPDATE student_testers SET unmarked_at = NULL, unmarked_by = NULL WHERE id = t;
    RAISE EXCEPTION 'PROOF FAILED: a removed mark was reopened';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'refused: reopening';
  END;
  BEGIN
    UPDATE student_testers SET unmarked_by = b WHERE id = t;
    RAISE EXCEPTION 'PROOF FAILED: who removed it was rewritten';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'refused: rewriting unmarked_by';
  END;
  BEGIN
    UPDATE student_testers SET unmarked_at = unmarked_at + interval '1 minute' WHERE id = t;
    RAISE EXCEPTION 'PROOF FAILED: when it was removed was rewritten';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'refused: rewriting unmarked_at';
  END;
  BEGIN
    UPDATE student_testers SET marked_by = b WHERE id = t;
    RAISE EXCEPTION 'PROOF FAILED: who made the mark was rewritten';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: rewriting marked_by (no column grant)';
  END;
  BEGIN
    DELETE FROM student_testers WHERE id = t;
    RAISE EXCEPTION 'PROOF FAILED: a mark was deleted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: DELETE';
  END;
END
$proof$;
RESET ROLE;
-- The trigger binds the owner too, not only the grant-limited console role.
DO $owner$
BEGIN
  UPDATE student_testers SET marked_by = NULL WHERE note = 'proof';
  RAISE EXCEPTION 'PROOF FAILED: the owner rewrote marked_by';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'refused, as the owner: rewriting marked_by';
END
$owner$;
SQL
  say "student_testers: removal once, never reopened or rewritten — proved"

  proof_032 "$tree" "$db"
  proof_033 "$tree" "$db"
  proof_034 "$tree" "$db"
}

# ---------------------------------------------------------------------------
# Migration 032 (v0.9.3 hotfix, FR-1207): the three q:t2u2-2-1:w001-w003
# widget answer keys held the SHIFTS, not the ROOTS. Today only an opt-in app
# test (app/src/lib/widget-excluded-values-db.test.mts, needs
# AINEXT_SCRATCH_PG) covers this; this proof runs in CI with no opt-in. Runs
# on the proofs database, before 033/034 (it touches ids under `questions`
# and `graph_nodes` that neither of those proofs uses).
# ---------------------------------------------------------------------------
proof_032() {
  tree=$1 db=$2
  P="$PSQL"
  m032="$tree/db/migrations/032-widget-excluded-values-sign.sql"
  r032="$tree/db/migrations/rollback/032-widget-excluded-values-sign.down.sql"
  [ -f "$m032" ] || { say "no migration 032 in $tree — nothing to prove"; return 0; }

  hdr "proof: 032 — nothing to fix on a fresh database; the three sign-flipped rows are corrected; re-runs write nothing; rollback restores them; re-apply corrects again"

  ids="'q:t2u2-2-1:w001','q:t2u2-2-1:w002','q:t2u2-2-1:w003','q:p032-decoy:w001'"

  before=$(PGDATABASE=$db $P --tuples-only --no-align -c "SELECT count(*) FROM questions WHERE id IN ($ids)")
  [ "$before" = 0 ] || fail "032 proof needs a database with none of $ids yet (found $before)"
  PGDATABASE=$db $P -f "$m032" >/dev/null
  after=$(PGDATABASE=$db $P --tuples-only --no-align -c "SELECT count(*) FROM questions WHERE id IN ($ids)")
  [ "$after" = 0 ] || fail "032 wrote a row on a fresh database (none of the three ids existed yet): now $after present"
  say "fresh: no q:t2u2-2-1:w* rows yet, migration finds nothing to fix"

  # w001, w002, w003 exactly as v0.9.2 left them (the shift, not the root; no
  # sign-flipped diagnosis yet), plus a decoy that holds w001's wrong key
  # under a DIFFERENT id — 032 is scoped by id, so this must never move.
  PGDATABASE=$db $P <<'SQL'
INSERT INTO graph_nodes (id, kind, label) VALUES ('lo:t2u2-2-1', 'learning_objective', 'p032 proof LO')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO questions (id, lo_id, tier, question_type, stem, choices, correct_answer, canonical_solution, status, source) VALUES
  ('q:t2u2-2-1:w001', 'lo:t2u2-2-1', 'standard', 'widget', 'p032 proof stem 1',
   '{"kind":"number_line_marker","spec":{"mode":"points","range":[-6,6],"targets":[-2,3]},"diagnostics":[{"predicate":"missed-values","misconception_id":"mc:t2u2-2-1:excluded-values-incomplete"}]}'::jsonb,
   'ok', '[{"step":1,"text_md":"p032 proof"}]'::jsonb, 'live', 'seed'),
  ('q:t2u2-2-1:w002', 'lo:t2u2-2-1', 'standard', 'widget', 'p032 proof stem 2',
   '{"kind":"number_line_marker","spec":{"mode":"points","range":[-6,6],"targets":[-4,1]},"diagnostics":[{"predicate":"missed-values","misconception_id":"mc:t2u2-2-1:excluded-values-incomplete"}]}'::jsonb,
   'ok', '[{"step":1,"text_md":"p032 proof"}]'::jsonb, 'live', 'seed'),
  ('q:t2u2-2-1:w003', 'lo:t2u2-2-1', 'standard', 'widget', 'p032 proof stem 3',
   '{"kind":"number_line_marker","spec":{"mode":"points","range":[-6,6],"targets":[-5,2]},"diagnostics":[{"predicate":"missed-values","misconception_id":"mc:t2u2-2-1:excluded-values-incomplete"}]}'::jsonb,
   'ok', '[{"step":1,"text_md":"p032 proof"}]'::jsonb, 'live', 'seed'),
  ('q:p032-decoy:w001', 'lo:t2u2-2-1', 'standard', 'widget', 'p032 proof decoy — w001''s wrong key, a different id',
   '{"kind":"number_line_marker","spec":{"mode":"points","range":[-6,6],"targets":[-2,3]},"diagnostics":[{"predicate":"missed-values","misconception_id":"mc:t2u2-2-1:excluded-values-incomplete"}]}'::jsonb,
   'ok', '[{"step":1,"text_md":"p032 proof"}]'::jsonb, 'live', 'seed');
SQL
  say "seeded: the three rows as v0.9.2 left them, and a decoy sharing w001's wrong key under a different id"

  w1_wrong='{"kind":"number_line_marker","spec":{"mode":"points","range":[-6,6],"targets":[-2,3]},"diagnostics":[{"predicate":"missed-values","misconception_id":"mc:t2u2-2-1:excluded-values-incomplete"}]}'
  w2_wrong='{"kind":"number_line_marker","spec":{"mode":"points","range":[-6,6],"targets":[-4,1]},"diagnostics":[{"predicate":"missed-values","misconception_id":"mc:t2u2-2-1:excluded-values-incomplete"}]}'
  w3_wrong='{"kind":"number_line_marker","spec":{"mode":"points","range":[-6,6],"targets":[-5,2]},"diagnostics":[{"predicate":"missed-values","misconception_id":"mc:t2u2-2-1:excluded-values-incomplete"}]}'
  w1_fixed='{"kind":"number_line_marker","spec":{"mode":"points","range":[-6,6],"targets":[-3,2]},"diagnostics":[{"predicate":"sign-flipped","misconception_id":"mc:u1-1-1:transposition-sign"},{"predicate":"missed-values","misconception_id":"mc:t2u2-2-1:excluded-values-incomplete"}]}'
  w2_fixed='{"kind":"number_line_marker","spec":{"mode":"points","range":[-6,6],"targets":[-1,4]},"diagnostics":[{"predicate":"sign-flipped","misconception_id":"mc:u1-1-1:transposition-sign"},{"predicate":"missed-values","misconception_id":"mc:t2u2-2-1:excluded-values-incomplete"}]}'
  w3_fixed='{"kind":"number_line_marker","spec":{"mode":"points","range":[-6,6],"targets":[-2,5]},"diagnostics":[{"predicate":"sign-flipped","misconception_id":"mc:u1-1-1:transposition-sign"},{"predicate":"missed-values","misconception_id":"mc:t2u2-2-1:excluded-values-incomplete"}]}'

  PGDATABASE=$db $P -f "$m032" >/dev/null
  check_032 "corrected, sign-flipped added first" "$w1_fixed" "$w2_fixed" "$w3_fixed" "$w1_wrong"

  xmin_once=$(PGDATABASE=$db $P --tuples-only --no-align -c \
    "SELECT string_agg(id || '=' || xmin::text, ',' ORDER BY id) FROM questions WHERE id IN ($ids)")
  PGDATABASE=$db $P -f "$m032" >/dev/null
  PGDATABASE=$db $P -f "$m032" >/dev/null
  xmin_twice=$(PGDATABASE=$db $P --tuples-only --no-align -c \
    "SELECT string_agg(id || '=' || xmin::text, ',' ORDER BY id) FROM questions WHERE id IN ($ids)")
  [ "$xmin_once" = "$xmin_twice" ] || fail "032 re-applied twice moved a row's xmin (a write with no change): [$xmin_once] -> [$xmin_twice]"
  say "re-applied twice more: no row's xmin moved — re-runs write nothing"

  PGDATABASE=$db $P -f "$r032" >/dev/null
  check_032 "rollback restores the pre-032 rows" "$w1_wrong" "$w2_wrong" "$w3_wrong" "$w1_wrong"
  xmin_down1=$(PGDATABASE=$db $P --tuples-only --no-align -c \
    "SELECT string_agg(id || '=' || xmin::text, ',' ORDER BY id) FROM questions WHERE id IN ($ids)")
  PGDATABASE=$db $P -f "$r032" >/dev/null
  xmin_down2=$(PGDATABASE=$db $P --tuples-only --no-align -c \
    "SELECT string_agg(id || '=' || xmin::text, ',' ORDER BY id) FROM questions WHERE id IN ($ids)")
  [ "$xmin_down1" = "$xmin_down2" ] || fail "rollback/032 re-run moved a row's xmin: [$xmin_down1] -> [$xmin_down2]"
  say "rollback/032 (twice): the old rows are back, second run writes nothing"

  PGDATABASE=$db $P -f "$m032" >/dev/null
  check_032 "re-applied after rollback" "$w1_fixed" "$w2_fixed" "$w3_fixed" "$w1_wrong"
  say "032: nothing to fix fresh; corrected once seeded; re-runs write nothing; rollback restores; re-apply corrects again — proved"
}

# <label> <w001-expected-jsonb> <w002-expected-jsonb> <w003-expected-jsonb> <decoy-expected-jsonb>
check_032() {
  got=$(PGDATABASE=$db $P --tuples-only --no-align -c "
    SELECT (SELECT choices = '$2'::jsonb FROM questions WHERE id = 'q:t2u2-2-1:w001')
        || ' ' || (SELECT choices = '$3'::jsonb FROM questions WHERE id = 'q:t2u2-2-1:w002')
        || ' ' || (SELECT choices = '$4'::jsonb FROM questions WHERE id = 'q:t2u2-2-1:w003')
        || ' ' || (SELECT choices = '$5'::jsonb FROM questions WHERE id = 'q:p032-decoy:w001')")
  [ "$got" = "true true true true" ] || fail "032 proof, $1: expected w001/w002/w003/decoy to all match, got [$got]"
  say "$1: w001, w002, w003 and the untouched decoy — all as expected"
}

# ---------------------------------------------------------------------------
# Migration 033 (feature 003): only an operator changes a curriculum, by
# privilege (FR-4017); the first-Google-sign-in step works once (FR-4014);
# the rollback restores 017's grant and keeps students.curriculum_system.
# Runs on the proofs database, after the 029/030 proofs (it reuses their
# operators A and B).
# ---------------------------------------------------------------------------
proof_033() {
  tree=$1 db=$2
  P="$PSQL"
  m033="$tree/db/migrations/033-curriculum-tracks.sql"
  r033="$tree/db/migrations/rollback/033-curriculum-tracks.down.sql"
  [ -f "$m033" ] || { say "no migration 033 in $tree — nothing to prove"; return 0; }

  hdr "proof: 033 — the student surface cannot change a curriculum; the Google step works once; the console can"
  PGDATABASE=$db $P <<'SQL'
DO $prep$
BEGIN
  -- S: an ordinary student (a password sign-up). G: a first Google sign-in,
  -- its grade-and-curriculum step still owed.
  INSERT INTO students (display_name, grade, environment) VALUES ('p033 S', '9', 'mvp1');
  INSERT INTO students (display_name, grade, environment, onboarding_pending)
  VALUES ('p033 G', '9', 'mvp1', true);
END
$prep$;
-- Resolved as the owner: under ainext_app with no principal yet, RLS hides
-- both rows (017: an account-less student is invisible to the app role).
SELECT id AS s_id FROM students WHERE display_name = 'p033 S' \gset
SELECT id AS g_id FROM students WHERE display_name = 'p033 G' \gset

SET ROLE ainext_app;
SELECT set_config('app.student_id', :'s_id', false);
DO $app$
DECLARE s bigint := nullif(current_setting('app.student_id', true), '')::bigint;
        n integer;
BEGIN
  IF s IS NULL THEN RAISE EXCEPTION 'PROOF BROKEN: no principal for S'; END IF;
  BEGIN
    UPDATE students SET curriculum_system = 'us-american-en' WHERE id = s;
    RAISE EXCEPTION 'PROOF FAILED: the student surface changed its own curriculum';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: ainext_app UPDATE curriculum_system';
  END;
  BEGIN
    UPDATE students SET curriculum_source = 'chosen' WHERE id = s;
    RAISE EXCEPTION 'PROOF FAILED: the student surface changed how its curriculum was set';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: ainext_app UPDATE curriculum_source';
  END;
  BEGIN
    UPDATE students SET onboarding_pending = true WHERE id = s;
    RAISE EXCEPTION 'PROOF FAILED: the student surface re-opened its own Google step';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: ainext_app UPDATE onboarding_pending';
  END;
  BEGIN
    UPDATE students SET subscription_status = 'active' WHERE id = s;
    RAISE EXCEPTION 'PROOF FAILED: the student surface wrote its own subscription status';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: ainext_app UPDATE subscription_status';
  END;
  UPDATE students SET design_variant = 'play' WHERE id = s;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'PROOF FAILED: design_variant updated % rows, not 1', n; END IF;
  RAISE NOTICE 'allowed: ainext_app UPDATE design_variant (the one column it writes)';
  BEGIN
    INSERT INTO student_curriculum_changes
      (environment, student_id, from_curriculum, to_curriculum, to_source, reason)
    VALUES ('mvp1', s, 'eg-national-en', 'us-american-en', 'chosen', 'grade_change_reresolved');
    RAISE EXCEPTION 'PROOF FAILED: the student surface wrote curriculum history';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: ainext_app INSERT history';
  END;
  -- S never had a pending step: the definer refuses, loudly.
  BEGIN
    PERFORM complete_student_onboarding('10', 'us-american-en', 'chosen');
    RAISE EXCEPTION 'PROOF FAILED: the Google step ran for an account that never owed it';
  EXCEPTION WHEN SQLSTATE 'AN409' THEN RAISE NOTICE 'refused: onboarding for S (nothing pending)';
  END;
END
$app$;

-- G: the step works ONCE.
SELECT set_config('app.student_id', :'g_id', false);
DO $google$
BEGIN
  PERFORM complete_student_onboarding('10', 'us-american-en', 'chosen');
  RAISE NOTICE 'allowed: the one Google step for G';
  BEGIN
    PERFORM complete_student_onboarding('9', 'eg-national-en', 'chosen');
    RAISE EXCEPTION 'PROOF FAILED: the Google step ran twice';
  EXCEPTION WHEN SQLSTATE 'AN409' THEN RAISE NOTICE 'refused: a second Google step for G';
  END;
END
$google$;

-- No principal: nothing to act on, and it says so.
SELECT set_config('app.student_id', '', false);
DO $nobody$
BEGIN
  PERFORM complete_student_onboarding('10', 'us-american-en', 'chosen');
  RAISE EXCEPTION 'PROOF FAILED: the Google step ran with no principal';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: onboarding with no principal';
END
$nobody$;
RESET ROLE;

DO $check_g$
DECLARE r record;
BEGIN
  SELECT grade, curriculum_system, curriculum_source, onboarding_pending INTO r
    FROM students WHERE display_name = 'p033 G';
  IF r.grade <> '10' OR r.curriculum_system <> 'us-american-en'
     OR r.curriculum_source <> 'chosen' OR r.onboarding_pending THEN
    RAISE EXCEPTION 'PROOF FAILED: G after its step is %', r;
  END IF;
  SELECT curriculum_system, curriculum_source INTO r FROM students WHERE display_name = 'p033 S';
  IF r.curriculum_system <> 'eg-national-en' OR r.curriculum_source <> 'implied' THEN
    RAISE EXCEPTION 'PROOF FAILED: S changed: %', r;
  END IF;
  RAISE NOTICE 'G: grade 10, us-american-en, chosen, step spent; S: eg-national-en, implied — unchanged';
END
$check_g$;

-- The console: records the change as itself, then makes it. The ids are
-- resolved as the owner and handed over in settings, so no policy on
-- `operators` can quietly turn one into NULL.
SELECT id AS a_id FROM operators WHERE email = 'p029-a@example.invalid' \gset
SELECT id AS b_id FROM operators WHERE email = 'p029-b@example.invalid' \gset
SELECT set_config('proof.student', :'s_id', false), set_config('proof.other_operator', :'b_id', false);
SET ROLE ainext_operator;
SELECT set_config('app.operator_id', :'a_id', false);
DO $console$
DECLARE s bigint := current_setting('proof.student')::bigint;
        a bigint := nullif(current_setting('app.operator_id', true), '')::bigint;
        b bigint := current_setting('proof.other_operator')::bigint;
        h bigint;
BEGIN
  IF s IS NULL OR a IS NULL OR b IS NULL OR a = b THEN
    RAISE EXCEPTION 'PROOF BROKEN: ids s=% a=% b=%', s, a, b;
  END IF;
  BEGIN
    INSERT INTO student_curriculum_changes
      (environment, student_id, from_curriculum, to_curriculum, to_source, changed_by, reason)
    VALUES ('mvp1', s, 'eg-national-en', 'us-american-en', 'chosen', b, 'operator');
    RAISE EXCEPTION 'PROOF FAILED: an operator recorded a change under another operator''s name';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: history attributed to somebody else';
  END;
  INSERT INTO student_curriculum_changes
    (environment, student_id, from_curriculum, to_curriculum, to_source, changed_by, reason, note)
  VALUES ('mvp1', s, 'eg-national-en', 'us-american-en', 'chosen', a, 'operator', 'proof')
  RETURNING id INTO h;
  UPDATE students SET curriculum_system = 'us-american-en', curriculum_source = 'chosen' WHERE id = s;
  RAISE NOTICE 'allowed: ainext_operator records and makes the change';
  BEGIN
    UPDATE student_curriculum_changes SET note = 'rewritten' WHERE id = h;
    RAISE EXCEPTION 'PROOF FAILED: the history was edited';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: UPDATE history';
  END;
  BEGIN
    DELETE FROM student_curriculum_changes WHERE id = h;
    RAISE EXCEPTION 'PROOF FAILED: the history was deleted';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: DELETE history';
  END;
  BEGIN
    UPDATE students SET onboarding_pending = true WHERE id = s;
    RAISE EXCEPTION 'PROOF FAILED: the console re-opened a Google step';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: ainext_operator UPDATE onboarding_pending';
  END;
  BEGIN
    PERFORM complete_student_onboarding('10', 'us-american-en', 'chosen');
    RAISE EXCEPTION 'PROOF FAILED: the console ran the student''s step';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: ainext_operator EXECUTE complete_student_onboarding';
  END;
END
$console$;
RESET ROLE;
SQL

  # Rollback keeps the curriculum and restores 017's grant; re-applying 033
  # narrows it again and brings the columns back at their defaults.
  PGDATABASE=$db $P -f "$r033" >/dev/null
  PGDATABASE=$db $P -f "$r033" >/dev/null
  after=$(PGDATABASE=$db $P --tuples-only --no-align -c \
    "SELECT string_agg(display_name || '=' || grade || '/' || curriculum_system, ' ' ORDER BY display_name)
              || ' app-table-update=' || has_table_privilege('ainext_app', 'students', 'UPDATE')
       FROM students WHERE display_name LIKE 'p033 %'")
  [ "$after" = "p033 G=10/us-american-en p033 S=9/us-american-en app-table-update=true" ] \
    || fail "033 rollback: expected curricula kept and 017's grant back, got [$after]"
  say "rollback/033 (twice): curricula kept, table-wide grant restored — $after"
  PGDATABASE=$db $P -f "$m033" >/dev/null
  again=$(PGDATABASE=$db $P --tuples-only --no-align -c \
    "SELECT string_agg(display_name || '=' || curriculum_source || '/' || onboarding_pending, ' ' ORDER BY display_name)
              || ' app-table-update=' || has_table_privilege('ainext_app', 'students', 'UPDATE')
              || ' app-curriculum-update=' || has_column_privilege('ainext_app', 'students', 'curriculum_system', 'UPDATE')
       FROM students WHERE display_name LIKE 'p033 %'")
  [ "$again" = "p033 G=implied/false p033 S=implied/false app-table-update=false app-curriculum-update=false" ] \
    || fail "033 re-applied after rollback: got [$again]"
  say "033 re-applied: columns back at their defaults, grant narrowed again — $again"
  say "033: only the console changes a curriculum; the Google step works once — proved"
}

# ---------------------------------------------------------------------------
# Migration 034 (feature 003, decision 18): the book-sections store. Content
# written by the loader alone (FR-4311); its structural CHECKs and one-part-n
# index refuse a malformed part; a re-run changes no row; `graph_edges` is
# never written (FR-4317: part prerequisites are derived at read time); the
# rollback drops the table and a re-apply brings it back empty. Runs on the
# proofs database, after the 033 proof.
# ---------------------------------------------------------------------------
proof_034() {
  tree=$1 db=$2
  P="$PSQL"
  m034="$tree/db/migrations/034-book-sections.sql"
  r034="$tree/db/migrations/rollback/034-book-sections.down.sql"
  [ -f "$m034" ] || { say "no migration 034 in $tree — nothing to prove"; return 0; }

  hdr "proof: 034 — only the loader writes lesson provenance; a malformed part is refused; re-runs change nothing"
  edges="SELECT count(*) || ':' || coalesce(md5(string_agg(src_id || '>' || dst_id || ':' || edge_type, ',' ORDER BY id)), '-') FROM graph_edges"
  rows="SELECT count(*) || ':' || coalesce(md5(string_agg(course_id || '/' || lesson_slug || '/' || title || '/' || sections::text || '/' || section_titles::text || '/' || coalesce(part_n::text, '-') || '/' || coalesce(part_of::text, '-') || '/' || chapter_intro || '/' || group_key, ',' ORDER BY course_id, lesson_slug)), '-') FROM course_lessons"
  edges_before=$(PGDATABASE=$db $P --tuples-only --no-align -c "$edges")

  PGDATABASE=$db $P <<'SQL'
-- The loader's role writes: a split section (1.7, three parts), a merge, a
-- chapter introduction, and two National lessons whose printed references
-- collide ("Lesson 3-1") — which the app never groups, having no part.
SET ROLE ainext_maint;
INSERT INTO course_lessons (course_id, lesson_slug, title, sections, section_titles, part_n, part_of, chapter_intro, group_key) VALUES
  ('course:p034', 'p034m1s7-1', 'Factorisation', '{1.7}', '{Factorisation}', 1, 3, false, '1.7'),
  ('course:p034', 'p034m1s7-2', 'Factorisation', '{1.7}', '{Factorisation}', 2, 3, false, '1.7'),
  ('course:p034', 'p034m1s7-3', 'Factorisation', '{1.7}', '{Factorisation}', 3, 3, false, '1.7'),
  ('course:p034', 'p034m1s3-1', 'The real number system', '{1.2,1.3}', '{"The real number system","Rational and irrational numbers"}', NULL, NULL, false, '1.2'),
  ('course:p034', 'p034m6s1-1', 'Introduction', '{6.1}', '{Introduction}', NULL, NULL, true, '6.1'),
  ('course:p034-nat', 'u3-1', 'Collecting data', '{"Lesson 3-1"}', '{"Collecting data"}', NULL, NULL, false, 'Lesson 3-1'),
  ('course:p034-nat', 't2u3-1', 'Term 2, lesson 3-1', '{"Lesson 3-1"}', '{"Term 2, lesson 3-1"}', NULL, NULL, false, 'Lesson 3-1');
DO $shape$
BEGIN
  BEGIN
    INSERT INTO course_lessons (course_id, lesson_slug, title, sections, section_titles, part_n, part_of, group_key)
    VALUES ('course:p034', 'p034-bad-1', 't', '{1.9}', '{t}', 2, NULL, '1.9');
    RAISE EXCEPTION 'PROOF FAILED: a part number without its "of m"';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'refused: part_n without part_of';
  END;
  BEGIN
    INSERT INTO course_lessons (course_id, lesson_slug, title, sections, section_titles, part_n, part_of, group_key)
    VALUES ('course:p034', 'p034-bad-1', 't', '{1.9}', '{t}', 4, 3, '1.9');
    RAISE EXCEPTION 'PROOF FAILED: part 4 of 3';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'refused: part 4 of 3';
  END;
  BEGIN
    INSERT INTO course_lessons (course_id, lesson_slug, title, sections, section_titles, group_key)
    VALUES ('course:p034', 'p034-bad-1', 't', '{1.9,1.10}', '{t}', '1.9');
    RAISE EXCEPTION 'PROOF FAILED: two section numbers with one title';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'refused: a section number without its title';
  END;
  BEGIN
    INSERT INTO course_lessons (course_id, lesson_slug, title, sections, section_titles, group_key)
    VALUES ('course:p034', 'p034-bad-1', 't', '{}', '{}', '1.9');
    RAISE EXCEPTION 'PROOF FAILED: a lesson with no printed section (FR-4311)';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'refused: no printed section';
  END;
  BEGIN
    INSERT INTO course_lessons (course_id, lesson_slug, title, sections, section_titles, part_n, part_of, group_key)
    VALUES ('course:p034', 'p034m1s7-9', 'Factorisation', '{1.7}', '{Factorisation}', 2, 3, '1.7');
    RAISE EXCEPTION 'PROOF FAILED: two lessons are both part 2 of 1.7';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'refused: a second part 2 of 1.7';
  END;
END
$shape$;
RESET ROLE;

-- The student surface and the console read it, and write nothing.
SET ROLE ainext_app;
DO $app$
BEGIN
  IF (SELECT count(*) FROM course_lessons WHERE course_id = 'course:p034') <> 5 THEN
    RAISE EXCEPTION 'PROOF FAILED: ainext_app cannot read the provenance rows';
  END IF;
  BEGIN
    UPDATE course_lessons SET part_n = NULL, part_of = NULL WHERE lesson_slug = 'p034m1s7-2';
    RAISE EXCEPTION 'PROOF FAILED: the student surface un-split a section';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: ainext_app UPDATE course_lessons';
  END;
  BEGIN
    INSERT INTO course_lessons (course_id, lesson_slug, title, sections, section_titles, group_key)
    VALUES ('course:p034', 'p034-app-1', 't', '{9.9}', '{t}', '9.9');
    RAISE EXCEPTION 'PROOF FAILED: the student surface wrote provenance';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: ainext_app INSERT course_lessons';
  END;
END
$app$;
RESET ROLE;
SET ROLE ainext_operator;
DO $op$
BEGIN
  IF (SELECT count(*) FROM course_lessons WHERE course_id = 'course:p034') <> 5 THEN
    RAISE EXCEPTION 'PROOF FAILED: the console cannot read the provenance rows';
  END IF;
  BEGIN
    DELETE FROM course_lessons WHERE lesson_slug = 'p034m1s7-3';
    RAISE EXCEPTION 'PROOF FAILED: the console deleted provenance';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'refused: ainext_operator DELETE course_lessons';
  END;
END
$op$;
RESET ROLE;
SQL

  before=$(PGDATABASE=$db $P --tuples-only --no-align -c "$rows")
  PGDATABASE=$db $P --single-transaction -f "$m034" >/dev/null
  PGDATABASE=$db $P --single-transaction -f "$m034" >/dev/null
  again=$(PGDATABASE=$db $P --tuples-only --no-align -c "$rows")
  [ "$before" = "$again" ] || fail "034 re-applied twice changed course_lessons: [$before] -> [$again]"
  say "034 re-applied twice over 7 rows: unchanged — ${before%%:*} rows"
  edges_after=$(PGDATABASE=$db $P --tuples-only --no-align -c "$edges")
  [ "$edges_before" = "$edges_after" ] || fail "034 touched graph_edges: [$edges_before] -> [$edges_after]"
  say "graph_edges untouched (part prerequisites are derived, never written): ${edges_after%%:*} edges"

  PGDATABASE=$db $P -f "$r034" >/dev/null
  PGDATABASE=$db $P -f "$r034" >/dev/null
  gone=$(PGDATABASE=$db $P --tuples-only --no-align -c "SELECT to_regclass('public.course_lessons') IS NULL")
  [ "$gone" = "t" ] || fail "034 rollback (twice): course_lessons still exists"
  say "rollback/034 (twice): course_lessons dropped"
  PGDATABASE=$db $P --single-transaction -f "$m034" >/dev/null
  back=$(PGDATABASE=$db $P --tuples-only --no-align -c \
    "SELECT (SELECT count(*) FROM course_lessons)
            || ' app-select=' || has_table_privilege('ainext_app', 'course_lessons', 'SELECT')
            || ' app-insert=' || has_table_privilege('ainext_app', 'course_lessons', 'INSERT')
            || ' maint-insert=' || has_table_privilege('ainext_maint', 'course_lessons', 'INSERT')")
  [ "$back" = "0 app-select=true app-insert=false maint-insert=true" ] \
    || fail "034 re-applied after rollback: got [$back]"
  say "034 re-applied after rollback: the table is back, empty until the loader runs — $back"
  say "034: only the loader writes lesson provenance; a malformed part is refused — proved"
}

all() {
  prev=$1 head=$2
  prev_tag=${PREV_TAG:-$(basename "$prev")}

  hdr "(a) HEAD onto an empty database, three times"
  createdb_fresh "${PREFIX}_fresh"
  for i in 1 2 3; do say "pass $i"; apply "$head" "${PREFIX}_fresh"; done
  dropdb_exact "${PREFIX}_fresh"

  hdr "(b) upgrade: $prev_tag, a bootstrapped operator, then HEAD twice"
  createdb_fresh "${PREFIX}_upgrade"
  apply "$prev" "${PREFIX}_upgrade"
  seed "${PREFIX}_upgrade"
  for i in 1 2; do say "HEAD pass $i"; apply "$head" "${PREFIX}_upgrade"; done
  seed "${PREFIX}_upgrade"   # now holds every role HEAD's CHECK admits
  before=$(count_role_rows "${PREFIX}_upgrade" teaching-controls)
  say "teaching-controls rows (all/active) after the upgrade: $before"

  hdr "(c) rollback: $prev_tag's migrations over HEAD's schema, twice, then HEAD again"
  rollback_ok=1
  for i in 1 2; do
    say "$prev_tag pass $i"
    if ! apply "$prev" "${PREFIX}_upgrade"; then rollback_ok=0; break; fi
  done
  if [ "$rollback_ok" = 1 ]; then
    say "roll forward: HEAD again"
    apply "$head" "${PREFIX}_upgrade"
    after=$(count_role_rows "${PREFIX}_upgrade" teaching-controls)
    [ "$after" = "$before" ] || fail "rollback and roll-forward changed the teaching-controls rows: $before -> $after"
    say "teaching-controls rows unchanged by rollback + roll-forward: $after"
  else
    case " $KNOWN_UNSAFE_ROLLBACK " in
      *" $prev_tag "*)
        printf '::warning::Rolling back onto %s FAILS, as expected: its migration 014 re-adds a narrower role CHECK unconditionally (fixed in v0.6.1). Never redeploy %s after v0.7.0 — deploy/DEPLOY-MVP1.md, "Rolling back".\n' "$prev_tag" "$prev_tag"
        ;;
      *) fail "rolling back onto $prev_tag fails — a redeploy of $prev_tag after this release would take the site down" ;;
    esac
  fi
  dropdb_exact "${PREFIX}_upgrade"

  hdr "(d) proofs"
  createdb_fresh "${PREFIX}_proofs"
  apply "$head" "${PREFIX}_proofs" >/dev/null
  proofs "$head" "${PREFIX}_proofs"
  dropdb_exact "${PREFIX}_proofs"

  hdr "migrations: all checks passed"
}

cmd=${1:-}
[ -n "$cmd" ] && shift || true
case "$cmd" in
  all)    [ $# -eq 2 ] || fail "usage: $0 all <prev-tree> <head-tree>"; all "$1" "$2" ;;
  apply)  [ $# -eq 2 ] || fail "usage: $0 apply <tree> <db>"; apply "$1" "$2" ;;
  seed)   [ $# -eq 1 ] || fail "usage: $0 seed <db>"; seed "$1" ;;
  proofs) [ $# -eq 2 ] || fail "usage: $0 proofs <tree> <db>"; proofs "$1" "$2" ;;
  *) fail "usage: $0 all|apply|seed|proofs …" ;;
esac

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

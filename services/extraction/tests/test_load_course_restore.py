""""Load a course"'s safe restore, and its emergency rollback (T430, decision 29, answer 27).

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/test_load_course_restore.py

A scratch server only (the server AINEXT_TEST_PG names; every database here is an
`ainext_test_*` one this file creates and drops, or a rehearsal's own `ainext_rehearse_*`).

THE GOLDEN DATABASE: the Prep-3 maths course with its bank (so the drift guard has a real
constant to check), the Grade 10 Chapter 8 fixture course with its bank, and two students with
real history on Grade 10 — attempts (one citing a misconception), mastery, a lesson pointer, a
session. Some Grade 10 rows are then given a history of their own (held for review, retired,
human-stamped), and the course is EXPORTED: that export, with its export-record.json, is the
"previously exported, reviewed bundle" every test restores. Each test runs on its own copy.

Proven here, on restore_course_bundle.py directly:
  * a replay puts back every row's status and review stamp, the content, the catalogue, its
    refutations and its book-option stamps; removes an unreferenced stray; bumps the solution
    version of a changed worked solution; and keeps every student table byte for byte — the
    course then exports to exactly the restored bytes;
  * a dry run writes nothing;
  * it REFUSES, naming the row, when the replay would remove a question a student attempted,
    a question only a session's JSON names, a misconception a student's attempt cites, or would
    re-word a question a student attempted;
  * it REFUSES on provenance: no export record, a file edited after the export, the wrong
    course, a different source document, an id that moved objective; and outside mvp1.
And through the REAL deploy/load-course.sh, driven by tests/fake_docker (docker answered
locally, databases mapped onto this test's own):
  * restore-dry-run, restore-rehearse and restore run clean; restore needs the typed course id;
    a ref without an export record is refused; a refusal reaches the operator as exit 2;
  * rollback (the old `restore`) still puts the WHOLE database back — a student row made after
    the backup is gone — takes its pre-restore backup and prints its undo line; and the old
    spelling `restore <file>` is refused, not guessed.

@covers FR-4208, FR-4210
"""

from __future__ import annotations

import contextlib
import filecmp
import http.server
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from datetime import timezone
from pathlib import Path

from _scratchdb import EX, REPO, SERVER, ScratchDB, mini_course, run_loader, skip_without_db, write_bundle
from test_export_generated_content import FILES, FIX, G10, GEN, PREP3, load_bank, run_main
import assemble_lesson_bundle as alb
import book_config
import restore_course_bundle as rcb

ZZ = "course:zz-test-en"
FAKE = Path(__file__).resolve().parent / "fake_docker"
EXPORT_DIR = "services/extraction/seed/generated/g10-math"

# the golden database, built once per run; each test gets a copy (CREATE DATABASE … TEMPLATE)
_golden: dict = {}


class Copy(ScratchDB):
    def __init__(self, template: str) -> None:
        super().__init__("rcopy")
        self.template = template

    def create(self) -> "Copy":
        self._psql("postgres", "-c", f'CREATE DATABASE "{self.name}" TEMPLATE "{self.template}"')
        return self


def golden() -> dict:
    if _golden:
        return _golden
    db = ScratchDB("rgold").create()
    tmp = Path(tempfile.mkdtemp(prefix="restore_test_"))
    run_loader(db.dsn, "--all", "--course", PREP3)
    load_bank(db.dsn, GEN)
    bundles, _ = alb.assemble(book_config.load_book("g10-math"), FIX / "manifest.json",
                              FIX / "objectives", FIX / "runs" / "lesson")
    paths = []
    for name, b in bundles.items():
        (tmp / name).write_text(alb.dump(b))
        paths.append(str(tmp / name))
    run_loader(db.dsn, *sorted(paths, key=lambda p: "course" not in p), "--course", G10)
    load_bank(db.dsn, FIX / "generated", G10)
    zz = write_bundle(tmp, "zz", mini_course("zz"))
    run_loader(db.dsn, str(zz), "--course", ZZ)
    # the reviewed history the export will carry
    db.q("UPDATE questions SET status = 'review' WHERE id = 'q:g10m8s3-2-2:g001-yesno'")
    db.q("UPDATE questions SET status = 'retired', reviewed_by = 'samuel', "
         "reviewed_at = '2026-09-26T10:00:00Z' WHERE id = 'q:g10m8s3-2-1:g002-perp-num'")
    # students, with real history on Grade 10
    db.q("INSERT INTO students (display_name, grade) VALUES ('Scratch One', '10'), ('Scratch Two', '10')")
    s1, s2 = [r[0] for r in db.q("SELECT id FROM students ORDER BY id")]
    db.q("INSERT INTO attempts (student_id, question_id, given_answer, is_correct, misconception_id) "
         "VALUES (%s, 'q:g10m8s1-1-1:g001-fourth', 'B', false, 'mc:g10m8s1-1-1:coordinates-swapped')", (s1,))
    db.q("INSERT INTO attempts (student_id, question_id, given_answer, is_correct) "
         "VALUES (%s, 'q:g10m8s1-1-1:w001', '(3,-2)', true), (%s, 'q:g10m8s3-2-1:ex8-4-1', 'A', true)",
         (s2, s1))
    db.q("INSERT INTO mastery (student_id, lo_id, score) VALUES (%s, 'lo:g10m8s1-1-1', 0.6)", (s1,))
    db.q("INSERT INTO student_progress (student_id, course_id, lesson_slug) VALUES (%s, %s, 'g10m8s1-1')",
         (s1, G10))
    db.q("INSERT INTO sessions (student_id, plan) VALUES (%s, %s)",
         (s2, json.dumps({"questions": ["q:g10m8s1-1-1:w001"]})))
    export = tmp / "export-e0"
    code, out = run_main("export_generated_content",
                         ["--course", G10, "--out-dir", str(export), "--prior", str(FIX / "generated"),
                          "--dsn", db.dsn], db.dsn)
    assert code == 0, out
    _golden.update(db=db, tmp=tmp, export=export, s1=s1, s2=s2)
    return _golden


def tearDownModule():
    if _golden:
        _golden["db"].drop()
        shutil.rmtree(_golden["tmp"], ignore_errors=True)


def restore(dsn: str, *argv: str, env: str = "mvp1") -> tuple[int, str]:
    old = dict(os.environ)
    os.environ.update(AINEXT_DB_DSN=dsn, AINEXT_ENVIRONMENT=env)
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            try:
                code = rcb.main(list(argv))
            except SystemExit as exc:
                code = exc.code if isinstance(exc.code, int) else 1
    finally:
        os.environ.clear()
        os.environ.update(old)
    return code, out.getvalue()


CONTENT = """SELECT md5(coalesce(string_agg(t, E'\\n' ORDER BY t), '')) FROM (
  SELECT q::text AS t FROM questions q UNION ALL SELECT m::text FROM misconceptions m
  UNION ALL SELECT x::text FROM explanation_library x UNION ALL SELECT n::text FROM graph_nodes n) s"""


def students(db: ScratchDB) -> list:
    with db.connect() as c, c.cursor() as cur:
        return rcb.student_digest(cur)


def other_course(db: ScratchDB, course: str) -> str:
    return db.one("""SELECT md5(coalesce(string_agg(q::text, E'\\n' ORDER BY q.id), ''))
                       FROM questions q WHERE lo_id IN
                            (SELECT node_id FROM node_subject WHERE course_id = %s)""", (course,))


# --------------------------------------------------------------------------------------------
@skip_without_db()
class RestoreBundleTest(unittest.TestCase):
    """restore_course_bundle.py against a copy of the golden database."""

    @classmethod
    def setUpClass(cls):
        cls.g = golden()
        cls.e0 = cls.g["export"]

    def setUp(self):
        self.db = Copy(self.g["db"].name).create()

    def tearDown(self):
        self.db.drop()

    def run_restore(self, *extra: str, course: str = G10, d: Path | None = None, env: str = "mvp1"):
        return restore(self.db.dsn, "--course", course, "--dir", str(d or self.e0), *extra, env=env)

    def damage(self):
        """What 'something went wrong' looks like: a bulk status flip that dropped the stamps, an
        edited stem and worked solution, a relabelled entry, a lost refutation, a re-pointed book
        stamp, and a stray generated question nobody has used."""
        db = self.db
        db.q("""UPDATE questions SET status = 'live', reviewed_by = NULL, reviewed_at = NULL
                 WHERE source = 'variant' AND lo_id LIKE 'lo:g10m%'""")
        db.q("UPDATE questions SET stem = 'edited by mistake', canonical_solution = '[]'::jsonb "
             "WHERE id = 'q:g10m8s3-2-2:g002-find-k'")
        db.q("UPDATE misconceptions SET label = 'relabelled' WHERE id = 'mc:g10m8s1-1-1:sign-dropped'")
        db.q("DELETE FROM explanation_library WHERE id = 'expl:mc:g10m8s2-1-1:forgot-square-root'")
        db.q("""UPDATE questions SET choices = (SELECT jsonb_agg(CASE WHEN c ? 'misconception_id'
                      THEN jsonb_set(c, '{misconception_id}', '"mc:g10m8s4-1-1:halved-difference"') ELSE c END)
                      FROM jsonb_array_elements(choices) c)
                 WHERE id = 'q:g10m8s3-2-1:ex8-4-1'""")
        self.add_stray("q:g10m8s3-1-1:g999-stray")

    def add_stray(self, qid: str):
        self.db.q("""INSERT INTO questions (id, lo_id, tier, question_type, stem, correct_answer,
                       canonical_solution, status, source)
                     VALUES (%s, 'lo:g10m8s3-1-1', 'basic', 'numeric', '1 + 1?', '2',
                             '[{"step": 1, "text_md": "2"}]', 'live', 'variant')""", (qid,))

    def reexport(self) -> Path:
        out = Path(tempfile.mkdtemp(prefix="reexport_", dir=self.g["tmp"]))
        code, text = run_main("export_generated_content",
                              ["--course", G10, "--out-dir", str(out), "--prior", str(self.e0),
                               "--dsn", self.db.dsn], self.db.dsn)
        self.assertEqual(code, 0, text)
        return out

    # ---- the replay ------------------------------------------------------------------------
    def test_restore_puts_back_every_row_and_keeps_every_student_row(self):
        before_students = students(self.db)
        before_zz, before_prep3 = other_course(self.db, ZZ), other_course(self.db, PREP3)
        version = self.db.one("SELECT solution_version FROM questions WHERE id = 'q:g10m8s3-2-2:g002-find-k'")
        self.damage()
        code, out = self.run_restore()
        self.assertEqual(code, 0, out)
        self.assertIn("RESTORED", out)
        self.assertIn("read-back", out)
        # statuses and review stamps, per row, exactly as exported
        exported = {q["id"]: q for n in ("generated-questions.json", "widget-questions.json")
                    for q in json.loads((self.e0 / n).read_text())["questions"]}
        rows = dict((r[0], r[1:]) for r in self.db.q(
            "SELECT id, status, reviewed_by, reviewed_at FROM questions WHERE id = ANY(%s)",
            (list(exported),)))
        for qid, q in exported.items():
            status, by, at = rows[qid]
            self.assertEqual(status, q["status"], qid)
            self.assertEqual(by, q["reviewed_by"], qid)
            self.assertEqual(at.astimezone(timezone.utc).isoformat() if at else None, q["reviewed_at"], qid)
        self.assertEqual(rows["q:g10m8s3-2-2:g001-yesno"][0], "review")
        self.assertEqual(rows["q:g10m8s3-2-1:g002-perp-num"][:2], ("retired", "samuel"))
        self.assertEqual(rows["q:g10m8s1-1-1:g001-fourth"][1], "fixture reviewer (sampled)")
        # the stray is gone, the changed worked solution got a new version
        self.assertIsNone(self.db.one("SELECT 1 FROM questions WHERE id = 'q:g10m8s3-1-1:g999-stray'"))
        self.assertEqual(self.db.one("SELECT solution_version FROM questions "
                                     "WHERE id = 'q:g10m8s3-2-2:g002-find-k'"), version + 1)
        # the course exports to exactly the restored files — an independent read-back
        again = self.reexport()
        for f in FILES:
            self.assertTrue(filecmp.cmp(again / f, self.e0 / f, shallow=False), f)
        # every student table byte for byte; the other courses untouched
        self.assertEqual(students(self.db), before_students)
        self.assertEqual(other_course(self.db, ZZ), before_zz)
        self.assertEqual(other_course(self.db, PREP3), before_prep3)
        # a second run has nothing to do
        code, out = self.run_restore()
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"questions\s+add 0 · change 0 · unchanged \d+ · remove 0")

    def test_a_dry_run_writes_nothing(self):
        self.damage()
        before = self.db.one(CONTENT)
        code, out = self.run_restore("--dry-run")
        self.assertEqual(code, 0, out)
        self.assertIn("DRY RUN", out)
        self.assertIn("remove 1", out)
        self.assertEqual(self.db.one(CONTENT), before)

    def test_verify_only_says_whether_the_course_is_the_export(self):
        code, out = self.run_restore("--verify-only")
        self.assertEqual(code, 0, out)
        self.damage()
        code, out = self.run_restore("--verify-only")
        self.assertEqual(code, 3, out)
        self.assertIn("does NOT export", out)

    # ---- students: keep their progress, or refuse ------------------------------------------
    def assertRefusedUnchanged(self, *expect: str, **kw):
        before = self.db.one(CONTENT), students(self.db)
        code, out = self.run_restore(**kw)
        self.assertEqual(code, 2, out)
        for e in expect:
            self.assertIn(e, out)
        self.assertEqual((self.db.one(CONTENT), students(self.db)), before, "a refusal wrote something")
        return out

    def test_refuses_to_remove_a_question_a_student_attempted(self):
        self.damage()
        self.db.q("INSERT INTO attempts (student_id, question_id, given_answer, is_correct) "
                  "VALUES (%s, 'q:g10m8s3-1-1:g999-stray', '2', true)", (self.g["s2"],))
        out = self.assertRefusedUnchanged("q:g10m8s3-1-1:g999-stray",
                                          "attempts.question_id: 1 row(s), 1 student(s)")
        self.assertNotIn("Scratch", out)       # counts, never a student

    def test_refuses_to_remove_a_question_only_a_session_names(self):
        self.add_stray("q:g10m8s3-1-1:g998-planned")
        self.db.q("INSERT INTO sessions (student_id, plan) VALUES (%s, %s)",
                  (self.g["s1"], json.dumps({"questions": ["q:g10m8s3-1-1:g998-planned"]})))
        self.assertRefusedUnchanged("q:g10m8s3-1-1:g998-planned", "sessions.plan: 1 row(s)")

    def test_refuses_to_remove_a_misconception_a_student_attempt_cites(self):
        self.db.q("INSERT INTO misconceptions (id, lo_id, label, description, generated_by) VALUES "
                  "('mc:g10m8s3-1-1:stray', 'lo:g10m8s3-1-1', 'stray', 'not in the export', 'tests')")
        self.db.q("INSERT INTO attempts (student_id, question_id, given_answer, is_correct, misconception_id) "
                  "VALUES (%s, 'q:g10m8s3-1-1:g001-through', '9', false, 'mc:g10m8s3-1-1:stray')",
                  (self.g["s1"],))
        self.assertRefusedUnchanged("misconception mc:g10m8s3-1-1:stray", "attempts.misconception_id")

    def test_refuses_to_reword_a_question_a_student_attempted(self):
        self.db.q("UPDATE questions SET stem = 'reworded after students answered it' "
                  "WHERE id = 'q:g10m8s1-1-1:g001-fourth'")
        self.assertRefusedUnchanged("q:g10m8s1-1-1:g001-fourth", "changes what it asks or accepts")

    def test_status_and_stamps_are_not_what_a_student_answered_so_they_are_put_back(self):
        self.db.q("UPDATE questions SET status = 'retired', reviewed_by = NULL "
                  "WHERE id = 'q:g10m8s1-1-1:g001-fourth'")      # attempted by a student
        code, out = self.run_restore()
        self.assertEqual(code, 0, out)
        self.assertEqual(self.db.q("SELECT status, reviewed_by FROM questions "
                                   "WHERE id = 'q:g10m8s1-1-1:g001-fourth'"),
                         [("live", "fixture reviewer (sampled)")])

    # ---- provenance ----------------------------------------------------------------------------
    def copy_export(self) -> Path:
        d = Path(tempfile.mkdtemp(prefix="export_copy_", dir=self.g["tmp"]))
        for f in self.e0.iterdir():
            shutil.copy(f, d / f.name)
        return d

    def test_refuses_a_bundle_with_no_export_record(self):
        self.assertRefusedUnchanged("no export-record.json", d=FIX / "generated")

    def test_refuses_a_file_edited_after_the_export(self):
        d = self.copy_export()
        p = d / "generated-questions.json"
        p.write_text(p.read_text().replace('"status": "review"', '"status": "live"', 1))
        self.assertRefusedUnchanged("generated-questions.json: sha256", d=d)

    def test_refuses_another_course(self):
        self.assertRefusedUnchanged(f"the export record is for '{G10}'", course=ZZ)

    def test_refuses_when_the_course_is_not_the_one_exported(self):
        d = self.copy_export()
        rec = json.loads((d / "export-record.json").read_text())
        rec["course"]["source_sha256"] = "0" * 64
        (d / "export-record.json").write_text(json.dumps(rec))
        self.assertRefusedUnchanged("not the one this export was taken from", d=d)

    def test_refuses_an_id_that_moved_objective(self):
        self.db.q("UPDATE questions SET lo_id = 'lo:g10m8s3-1-1' WHERE id = 'q:g10m8s3-2-2:g002-find-k'")
        self.assertRefusedUnchanged("an id is an identity")

    def test_refuses_outside_the_comparison_environment(self):
        self.assertRefusedUnchanged("not 'mvp1'", env="poc")

    def test_the_export_writes_a_record_and_check_is_clean(self):
        rec = json.loads((self.e0 / "export-record.json").read_text())
        self.assertEqual((rec["course_id"], rec["book"]), (G10, "g10-math"))
        for f in FILES:
            self.assertEqual(rec["files"][f]["sha256"], rcb._sha((self.e0 / f).read_bytes()))
        self.assertEqual(rec["files"]["generated-questions.json"]["status"],
                         {"live": 4, "retired": 1, "review": 1})
        code, text = run_main("export_generated_content",
                              ["--course", G10, "--out-dir", str(self.e0), "--dsn", self.db.dsn, "--check"],
                              self.db.dsn)
        self.assertEqual(code, 0, text)
        self.assertIn("unchanged", text)


# --------------------------------------------------------------------------------------------
def _client_is_current() -> str | None:
    """pg_dump refuses a server newer than itself; say so rather than fail."""
    try:
        cv = int(re.search(r"(\d+)", subprocess.run(["pg_dump", "--version"], capture_output=True,
                                                    text=True).stdout).group(1))
        sv = int(subprocess.run(["psql", "-X", "-Atc", "SHOW server_version_num", "-d",
                                 f"{SERVER} dbname=postgres"], capture_output=True, text=True,
                                check=True).stdout.strip()) // 10000
    except Exception as exc:        # noqa: BLE001
        return f"cannot compare pg_dump and server versions: {exc}"
    return None if cv >= sv else f"pg_dump {cv} is older than the server ({sv})"


class _Ok(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a):
        pass


@skip_without_db()
@unittest.skipUnless(shutil.which("git") and shutil.which("curl") and shutil.which("pg_dump"),
                     "needs git, curl and pg_dump")
class LoadCourseScriptTest(unittest.TestCase):
    """The real deploy/load-course.sh, with docker answered by tests/fake_docker."""

    @classmethod
    def setUpClass(cls):
        why = _client_is_current()
        if why:
            raise unittest.SkipTest(why)
        cls.g = golden()
        cls.work = Path(tempfile.mkdtemp(prefix="loadcourse_", dir=cls.g["tmp"]))
        # A throwaway checkout: the two scripts, byte for byte, and the export committed at a tag.
        # HEAD then drops the record, as a freshly generated bundle committed later would.
        repo = cls.repo = cls.work / "checkout"
        (repo / "deploy").mkdir(parents=True)
        for f in ("load-course.sh", "ops-lib.sh"):
            shutil.copy(REPO / "deploy" / f, repo / "deploy" / f)
        (repo / "deploy" / "docker-compose.mvp1.yml").write_text("# tests: never read\n")
        (repo / "deploy" / ".env").write_text("# tests\n")
        exp = repo / EXPORT_DIR
        exp.mkdir(parents=True)
        for f in cls.g["export"].iterdir():
            shutil.copy(f, exp / f.name)
        git = ["git", "-C", str(repo), "-c", "user.name=tests", "-c", "user.email=tests@localhost",
               "-c", "commit.gpgsign=false"]
        for args in (["init", "-q"], ["add", "-A"], ["commit", "-qm", "export e0"],
                     ["tag", "export-e0"], ["rm", "-q", f"{EXPORT_DIR}/export-record.json"],
                     ["commit", "-qm", "a fresh bundle, no record"]):
            subprocess.run([*git, *args], check=True, capture_output=True)
        cls.http = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Ok)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()

    def setUp(self):
        self.db = Copy(self.g["db"].name).create()
        self.backups = Path(tempfile.mkdtemp(prefix="backups_", dir=self.work))

    def tearDown(self):
        self.db.drop()

    def sh(self, *args: str, confirm: str | None = None) -> tuple[int, str]:
        env = dict(os.environ)
        env.update(PATH=f"{FAKE}{os.pathsep}{env['PATH']}", FAKE_PG=SERVER, FAKE_DB=self.db.name,
                   FAKE_PYTHON=sys.executable, FAKE_EX=str(EX), FAKE_REPO=str(self.repo),
                   FAKE_LOG=str(self.work / "fake-docker.log"),
                   AINEXT_BACKUP_DIR=str(self.backups), TMPDIR=str(self.work),
                   AINEXT_APP_PORT=str(self.http.server_port),
                   AINEXT_CONSOLE_PORT=str(self.http.server_port))
        env.pop("CONFIRM", None)
        if confirm is not None:
            env["CONFIRM"] = confirm
        r = subprocess.run(["bash", str(self.repo / "deploy" / "load-course.sh"), *args],
                           capture_output=True, text=True, env=env, timeout=600)
        return r.returncode, r.stdout + r.stderr

    def rehearsal_dbs(self) -> list:
        return self.db.q("SELECT datname FROM pg_database WHERE datname LIKE 'ainext_rehearse_%'")

    def test_restore_dry_run_rehearse_and_restore(self):
        self.db.q("UPDATE questions SET status = 'live', reviewed_by = NULL "
                  "WHERE source = 'variant' AND lo_id LIKE 'lo:g10m%'")
        before, before_students = self.db.one(CONTENT), students(self.db)

        code, out = self.sh(G10, "restore-dry-run", "export-e0")
        self.assertEqual(code, 0, out)
        self.assertIn("RESTORE DRY RUN CLEAN", out)
        self.assertIn("nothing was written", out)
        self.assertEqual(self.db.one(CONTENT), before)

        code, out = self.sh(G10, "restore-rehearse", "export-e0")
        self.assertEqual(code, 0, out)
        self.assertIn("REHEARSAL CLEAN", out)
        self.assertIn("every student table is byte-identical", out)
        self.assertIn("drift guard GREEN", out)
        self.assertEqual(self.db.one(CONTENT), before)
        self.assertEqual(self.rehearsal_dbs(), [])
        self.assertEqual(list(self.backups.glob("*.dump")), [], "the rehearsal's copy was not removed")

        code, out = self.sh(G10, "restore", "export-e0")
        self.assertEqual(code, 2, out)
        self.assertIn("Retype the course id", out)
        self.assertEqual(self.db.one(CONTENT), before)

        code, out = self.sh(G10, "restore", "export-e0", confirm=G10)
        self.assertEqual(code, 0, out)
        self.assertIn("RESTORED", out)
        self.assertIn("OK read-back", out)
        self.assertRegex(out, r"roll back with:  bash \S+/load-course.sh rollback \S+/restore-us-g10-math-en-\S+\.dump")
        self.assertEqual(len(list(self.backups.glob("restore-us-g10-math-en-*.dump"))), 1)
        self.assertEqual(self.db.q("SELECT status, reviewed_by FROM questions "
                                   "WHERE id IN ('q:g10m8s3-2-2:g001-yesno', 'q:g10m8s3-2-1:g002-perp-num') "
                                   "ORDER BY id"), [("retired", "samuel"), ("review", None)])
        self.assertEqual(students(self.db), before_students)

    def test_a_ref_without_an_export_record_is_refused(self):
        code, out = self.sh(G10, "restore-dry-run")          # HEAD: the record was removed
        self.assertEqual(code, 2, out)
        self.assertIn("export-record.json is not in HEAD", out)

    def test_a_refusal_reaches_the_operator_and_writes_nothing(self):
        self.db.q("""INSERT INTO questions (id, lo_id, tier, question_type, stem, correct_answer,
                       canonical_solution, status, source)
                     VALUES ('q:g10m8s3-1-1:g999-stray', 'lo:g10m8s3-1-1', 'basic', 'numeric', '?', '2',
                             '[]', 'live', 'variant')""")
        self.db.q("INSERT INTO attempts (student_id, question_id, given_answer, is_correct) "
                  "VALUES (%s, 'q:g10m8s3-1-1:g999-stray', '2', true)", (self.g["s1"],))
        before = self.db.one(CONTENT)
        code, out = self.sh(G10, "restore", "export-e0", confirm=G10)
        self.assertEqual(code, 2, out)
        self.assertIn("q:g10m8s3-1-1:g999-stray", out)
        self.assertIn("The backup above is unused", out)
        self.assertEqual(self.db.one(CONTENT), before)

    def test_rollback_still_puts_back_the_whole_database(self):
        dump = self.backups / "load-us-g10-math-en-20260927T000000Z.dump"
        with open(dump, "wb") as f:
            subprocess.run(["pg_dump", "-Fc", "-d", self.db.dsn], stdout=f, check=True)
        dump.chmod(0o600)
        self.db.q("INSERT INTO students (display_name, grade) VALUES ('After The Backup', '10')")
        code, out = self.sh("rollback", str(dump))
        self.assertEqual(code, 0, out)
        self.assertIn("ROLLBACK", out)
        self.assertIn("OK restored", out)
        self.assertRegex(out, r"undo this restore with:  bash \S+/load-course.sh rollback \S+/pre-restore-\S+\.dump")
        self.assertIn("drift guard GREEN", out)
        self.assertEqual(self.db.one("SELECT count(*) FROM students WHERE display_name = 'After The Backup'"), 0)
        self.assertEqual(len(list(self.backups.glob("pre-restore-*.dump"))), 1)

    def test_the_old_restore_spelling_is_refused_not_guessed(self):
        code, out = self.sh("restore", str(self.backups / "x.dump"))
        self.assertEqual(code, 2, out)
        self.assertIn("now called ROLLBACK", out)


if __name__ == "__main__":
    unittest.main()

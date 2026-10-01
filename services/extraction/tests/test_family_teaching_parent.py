"""A generated question family may be modelled on a book TEACHING item (Samuel's answer 40, 2026-10-01).

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/test_family_teaching_parent.py

The case: Chapter 8's `lo:g10m8s1-1-1` has six book items, all drawings, which G2 made teaching-only (a
drawn answer cannot be marked), so it has NO question row to be a family's parent. The parent may now be
a worked example of the explanation library, with the kind stated: `parent_kind: "teaching"` and an
`expl:` id, stored in `questions.parent_kind` (migration 038). Proven here:

  * the spec: a teaching parent is accepted; an unknown kind is refused; an id whose shape disagrees with
    its declared kind is refused with the fix named; a teaching parent of another objective is refused;
  * EVERY EXISTING FAMILY IS UNCHANGED: a spec with no `parent_kind` is a question-parent spec, its rows
    carry no `parent_kind` key (so every committed bundle and export stays byte for byte), and the committed
    Grade 10 families still load clean;
  * the landing step makes the kind explicit when the author wrote the item's question-shaped id;
  * the loader refuses an unknown kind or a kind/id mismatch before any write, and a teaching parent the
    database does not hold, whole and in words; it loads a teaching family live (answer 37a) with no human
    stamp, so it is in the review backlog;
  * the database: migration 038 checks a parent of either kind exists, refuses to delete a parent, leaves
    every existing row unchanged, and is idempotent;
  * export and restore carry the kind, and an export of rows with only question parents is unchanged.

@covers FR-1101, FR-4304
"""

from __future__ import annotations

import contextlib
import copy
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from _scratchdb import REPO, ScratchDB, run_loader, skip_without_db
from test_export_generated_content import FIX, G10, load_bank, run_main
import assemble_lesson_bundle as alb
import book_config
import fanout as F
import generate_questions as G
import load_generated_questions as L
import restore_course_bundle as rcb
from families import spec as FS

HERE = Path(__file__).resolve().parent
SPECS = HERE / "fixtures" / "families" / "g10-specs"
REAL_FAMILIES = HERE.parent / "families" / "g10-math"
LO = "lo:g10m8s1-1-1"
EXPL = "expl:g10m8s1-1-1:ex8-6-4a"
SEED = 20260925


def balance() -> dict:
    return json.loads((SPECS / "g10m4s2-1-1--balance.json").read_text())


def teaching_spec() -> dict:
    """The balance family, re-parented onto a teaching item of its own objective."""
    raw = balance()
    raw["parent_question_id"] = "expl:g10m4s2-1-1:ex4-1-1a"
    raw["parent_kind"] = "teaching"
    return raw


# ------------------------------------------------------------------------------------------- the spec
class TheSpec(unittest.TestCase):
    def test_a_teaching_item_is_an_accepted_parent_and_the_rows_say_so(self):
        raw = teaching_spec()
        self.assertEqual(FS.check_spec(raw), [])
        spec = FS.load_spec(raw)
        self.assertEqual((spec.parent, spec.parent_kind), ("expl:g10m4s2-1-1:ex4-1-1a", "teaching"))
        qs, rejected, counts = G.run_specs([spec], 4, SEED)
        self.assertEqual(rejected, [])
        self.assertTrue(qs)
        for q in qs:
            self.assertEqual(q["parent_question_id"], "expl:g10m4s2-1-1:ex4-1-1a")
            self.assertEqual(q["parent_kind"], "teaching")
            self.assertEqual(q["family"], "tpl:g10m4s2-1-1:balance")
        # regeneration stays byte-identical (FR-4404)
        again, _, _ = G.run_specs([FS.load_spec(teaching_spec())], 4, SEED)
        self.assertEqual(json.dumps(qs), json.dumps(again))

    def test_an_unknown_kind_is_refused(self):
        raw = teaching_spec()
        raw["parent_kind"] = "textbook"
        self.assertTrue(any("parent_kind must be one of" in p for p in FS.check_spec(raw)), FS.check_spec(raw))
        raw["parent_kind"] = None
        self.assertTrue(any("parent_kind must be one of" in p for p in FS.check_spec(raw)))

    def test_an_id_that_disagrees_with_its_declared_kind_is_refused_with_the_fix_named(self):
        # a library id with no kind: the question default is assumed, and the check says what to write
        raw = teaching_spec()
        del raw["parent_kind"]
        ps = FS.check_spec(raw)
        self.assertTrue(any("q:<objective tail>" in p and '"parent_kind": "teaching"' in p for p in ps), ps)
        # a question-shaped id with the teaching kind: it names the library entry it should have been
        raw = teaching_spec()
        raw["parent_question_id"] = "q:g10m4s2-1-1:ex4-1-1a"
        ps = FS.check_spec(raw)
        self.assertTrue(any("expl:<objective tail>" in p and "expl:g10m4s2-1-1:ex4-1-1a" in p for p in ps), ps)
        # nothing at all
        raw = teaching_spec()
        del raw["parent_question_id"]
        self.assertTrue(any("is required" in p for p in FS.check_spec(raw)))

    def test_a_teaching_parent_of_another_objective_is_refused(self):
        raw = teaching_spec()
        raw["parent_question_id"] = "expl:g10m4s2-1-2:ex4-1-1a"
        ps = FS.check_spec(raw)
        self.assertTrue(any("is not a teaching item of 'lo:g10m4s2-1-1'" in p for p in ps), ps)
        # and the question-kind message every existing test relies on is unchanged
        raw = balance()
        raw["parent_question_id"] = "q:g10m4s2-1-2:ex4-1-1a"
        self.assertTrue(any("is not a question of" in p for p in FS.check_spec(raw)))

    def test_existing_families_are_unchanged(self):
        specs, problems = FS.load_dir(SPECS)
        self.assertEqual(problems, [])
        self.assertTrue(all(s.parent_kind == "question" for s in specs))
        qs, rejected, _ = G.run_specs(specs, 3, SEED)
        self.assertEqual(rejected, [])
        self.assertTrue(all("parent_kind" not in q for q in qs),
                        "a question parent writes no parent_kind, so every committed bundle stays byte for byte")
        # the committed Grade 10 families (the real ones) still load clean, none declares a kind
        real, problems = FS.load_dir(REAL_FAMILIES)
        self.assertEqual(problems, [])
        self.assertTrue(real and all("parent_kind" not in s.raw and s.parent_kind == "question" for s in real))
        # Item has the default for hand-written families too
        self.assertEqual(G.Item(lo_id=LO, tier="basic", question_type="numeric", stem="s", correct_answer="1",
                                canonical_solution=[], parent_question_id="q:x:1").as_question("q:x:2").get("parent_kind"),
                         None)


class Landing(unittest.TestCase):
    QS = {"q:g10m8s1-1-1:ex8-1-2"}
    TS = {EXPL, "expl:g10m8s1-1-1:ex8-6-4b"}

    def spec(self, **kw) -> dict:
        raw = {"format": "ainext.family/1", "id": "tpl:g10m8s1-1-1:draw", "kind": "family", "lo_id": LO,
               "parent_question_id": "q:g10m8s1-1-1:ex8-6-4a", "source_page": 316, "tier": "standard"}
        raw.update(kw)
        return raw

    def test_the_question_shaped_id_the_author_was_shown_becomes_the_library_entry(self):
        out, note = FS.resolve_teaching_parent(self.spec(), self.QS, self.TS)
        self.assertEqual((out["parent_question_id"], out["parent_kind"]), (EXPL, "teaching"))
        self.assertIn(EXPL, note)
        keys = list(out)
        self.assertEqual(keys[keys.index("parent_question_id") + 1], "parent_kind", "the kind sits beside its id")
        self.assertEqual({k: v for k, v in out.items() if k not in ("parent_question_id", "parent_kind")},
                         {k: v for k, v in self.spec().items() if k != "parent_question_id"})

    def test_a_library_id_gains_its_kind(self):
        out, note = FS.resolve_teaching_parent(self.spec(parent_question_id=EXPL), self.QS, self.TS)
        self.assertEqual((out["parent_question_id"], out["parent_kind"]), (EXPL, "teaching"))
        self.assertIn("made explicit", note)

    def test_everything_else_is_left_for_the_check_to_refuse(self):
        for raw in (
            self.spec(parent_question_id="q:g10m8s1-1-1:ex8-1-2"),               # a real book question
            self.spec(parent_question_id="q:g10m8s1-1-1:nowhere"),               # neither question nor teaching item
            self.spec(parent_question_id="expl:g10m8s1-1-1:nowhere"),            # not a book teaching item
            self.spec(parent_kind="question"),                                    # a DECLARED kind is never overridden
            self.spec(parent_question_id=EXPL, parent_kind="question"),
            {k: v for k, v in self.spec().items() if k != "parent_question_id"},  # no parent at all
        ):
            out, note = FS.resolve_teaching_parent(raw, self.QS, self.TS)
            self.assertIs(out, raw)
            self.assertIsNone(note)

    def test_write_specs_lands_the_explicit_form_and_says_what_it_changed(self):
        class Book:
            book = "stub"

            def __init__(self, path: Path):
                self.path = path

            def bundle_paths(self):
                return [self.path]

        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            bundle = t / "b.json"
            bundle.write_text(json.dumps({
                "questions": [{"id": q} for q in self.QS],
                "explanation_entries": [{"id": e, "entry_type": "worked_example"} for e in self.TS]
                + [{"id": "expl:g10m8s1-1-1:a-refutation", "entry_type": "refutation"}]}))
            run = t / "author.json"
            run.write_text(json.dumps({"records": [{"lo_id": LO, "families": [self.spec()]}]}))
            out = io.StringIO()
            with mock.patch.object(book_config, "load_book", return_value=Book(bundle)), \
                    contextlib.redirect_stdout(out):
                written = F.write_specs(run, t / "fam", book_config_path=bundle)
            landed = json.loads(written[0].read_text())
            self.assertEqual((landed["parent_question_id"], landed["parent_kind"]), (EXPL, "teaching"))
            self.assertIn("parent:", out.getvalue())
            # a refutation is not a book teaching item: only worked examples count
            self.assertEqual(G.book_parents(Book(bundle))[1], self.TS)

    def test_the_book_check_names_a_missing_or_misdeclared_teaching_parent(self):
        class Book:
            book = "stub"

            def __init__(self, path):
                self.path = path

            def bundle_paths(self):
                return [self.path]

        with tempfile.TemporaryDirectory() as t:
            bundle = Path(t, "b.json")
            bundle.write_text(json.dumps({"questions": [{"id": "q:g10m8s1-1-1:ex8-1-2"}],
                                          "explanation_entries": [{"id": EXPL, "entry_type": "worked_example"}]}))
            book = Book(bundle)
            ok = FS.load_spec({**self.spec(parent_question_id=EXPL, parent_kind="teaching"), **_rest()})
            gone = FS.load_spec({**self.spec(parent_question_id="expl:g10m8s1-1-1:nowhere", parent_kind="teaching"),
                                 **_rest()})
            twin = FS.load_spec({**self.spec(parent_question_id="q:g10m8s1-1-1:ex8-6-4a"), **_rest()})
            fine = FS.load_spec({**self.spec(parent_question_id="q:g10m8s1-1-1:ex8-1-2"), **_rest()})
            unlisted = FS.load_spec({**self.spec(parent_question_id="q:g10m8s1-1-1:not-in-this-bundle"), **_rest()})
            self.assertEqual(G.parent_problems_in_book([ok, fine, unlisted], book), [],
                             "a question parent the book does not list is not refused here: it never was")
            ps = G.parent_problems_in_book([gone, twin], book)
            self.assertTrue(any("is not a teaching item" in p for p in ps), ps)
            self.assertTrue(any(f"expl:g10m8s1-1-1:ex8-6-4a is: write that id" in p for p in ps), ps)


def _rest() -> dict:
    """The parts of a spec these tests do not look at (check_spec is not run on it, only parent fields read)."""
    return {"answer_type": "numeric", "params": [], "stem": "s", "answer": "1", "solution": ["x"]}


# ----------------------------------------------------------------------------------- the loader, no DB
def row(qid="q:g10m8s1-1-1:g001-draw", parent=EXPL, kind=None, **kw) -> dict:
    q = {"id": qid, "lo_id": LO, "tier": "standard", "question_type": "numeric",
         "stem": "Plot $(1, 2)$ and give its quadrant.", "correct_answer": "1",
         "canonical_solution": [{"step": 1, "text_md": "$x > 0, y > 0$: quadrant I."}],
         "parent_question_id": parent, "source_page": 316,
         "source_note": "Generated from template family tpl:g10m8s1-1-1:draw.",
         "family": "tpl:g10m8s1-1-1:draw"}
    if kind is not None:
        q["parent_kind"] = kind
    q.update(kw)
    return q


class TheLoaderWithoutADatabase(unittest.TestCase):
    def problems(self, *qs) -> list[str]:
        return L.validate({"generator": "t", "questions": list(qs), "misconceptions": []})[0]

    def test_a_teaching_parent_is_accepted_and_the_default_is_a_question(self):
        self.assertEqual(self.problems(row(kind="teaching")), [])
        self.assertEqual(self.problems(row(parent="q:g10m8s1-1-1:ex8-1-2")), [])
        self.assertEqual(L.parent_kind_of(row(parent="q:g10m8s1-1-1:ex8-1-2")), "question")
        self.assertEqual(self.problems(row(parent=None)), [], "no parent is still no parent (the legacy rows)")

    def test_an_unknown_kind_is_refused(self):
        ps = self.problems(row(kind="textbook"))
        self.assertTrue(any("parent_kind 'textbook'" in p for p in ps), ps)

    def test_a_kind_that_disagrees_with_its_id_is_refused(self):
        ps = self.problems(row(kind="teaching", parent="q:g10m8s1-1-1:ex8-6-4a"))
        self.assertTrue(any("not a book teaching item id" in p for p in ps), ps)
        ps = self.problems(row(parent=EXPL))     # the default kind with a library id
        self.assertTrue(any("not a book question id" in p for p in ps), ps)
        ps = self.problems(row(kind="teaching", parent=None))
        self.assertTrue(any("no parent_question_id" in p for p in ps), ps)


# ------------------------------------------------------------------------------------ the database
CONTENT = [{"kind": "problem", "text_md": "Represent triangle $DEF$ with $D(1, 2)$ in the plane."},
           {"step": 1, "text_md": "Plot each vertex, then join them."}]


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


class Copy(ScratchDB):
    def __init__(self, template: str) -> None:
        super().__init__("tcopy")
        self.template = template

    def create(self) -> "Copy":
        self._psql("postgres", "-c", f'CREATE DATABASE "{self.name}" TEMPLATE "{self.template}"')
        return self


@skip_without_db()
class TheDatabase(unittest.TestCase):
    """Grade 10's Chapter 8 fixture course, its bank, and one worked example standing for the teaching item."""

    @classmethod
    def setUpClass(cls):
        cls.db = ScratchDB("tparent").create()
        cls.tmp = Path(tempfile.mkdtemp(prefix="tparent_"))
        bundles, _ = alb.assemble(book_config.load_book("g10-math"), FIX / "manifest.json",
                                  FIX / "objectives", FIX / "runs" / "lesson")
        paths = []
        for name, b in bundles.items():
            (cls.tmp / name).write_text(alb.dump(b))
            paths.append(str(cls.tmp / name))
        run_loader(cls.db.dsn, *sorted(paths, key=lambda p: "course" not in p), "--course", G10)
        load_bank(cls.db.dsn, FIX / "generated", G10)
        # the teaching item: what a not-markable book item becomes (assemble_lesson_bundle.py)
        cls.db.q("""INSERT INTO explanation_library (id, lo_id, entry_type, content, generated_by, source_page)
                    VALUES (%s, %s, 'worked_example', %s, 'book (book_worked_epub); test', 316)""",
                 (EXPL, LO, json.dumps(CONTENT)))
        # a snapshot BEFORE any teaching family: the restore tests start from it
        cls.before = Copy(cls.db.name).create()
        cls.base = cls.db.one("SELECT md5(string_agg(q::text, E'\\n' ORDER BY q.id)) FROM questions q")

    @classmethod
    def tearDownClass(cls):
        cls.before.drop()
        cls.db.drop()

    def load(self, questions, *extra, db=None, expect=0) -> str:
        db = db or self.db
        p = self.tmp / f"b{abs(hash(json.dumps(questions, sort_keys=True)))}.json"
        p.write_text(json.dumps({"generator": "S6 test", "questions": questions, "misconceptions": []}))
        code, out = run_main("load_generated_questions", [str(p), "--sample", "0", *extra], db.dsn)
        self.assertEqual(code, expect, out)
        return out

    def count(self, sql: str, *params) -> int:
        return self.db.one(sql, params)

    # ---- migration 038 on its own ------------------------------------------------------------
    def test_every_existing_row_is_a_question_parent_and_the_fk_is_gone(self):
        self.assertEqual(self.count("SELECT count(*) FROM questions WHERE parent_kind <> 'question'"), 0)
        self.assertGreater(self.count("SELECT count(*) FROM questions WHERE parent_question_id IS NOT NULL"), 0)
        self.assertEqual(self.count("""SELECT count(*) FROM pg_constraint WHERE conname = 'questions_parent_question_id_fkey'"""), 0)
        self.assertEqual(self.count("""SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
            ('questions_parent_exists', 'questions_parent_not_orphaned', 'explanation_teaching_parent_kept')"""), 3)

    def test_the_migration_is_idempotent_and_changes_no_row(self):
        before = (self.count("SELECT md5(string_agg(q::text, E'\\n' ORDER BY q.id)) FROM questions q"),
                  self.count("SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal"),
                  self.count("SELECT count(*) FROM pg_constraint WHERE conrelid = 'questions'::regclass"))
        for _ in range(2):
            subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-d", self.db.dsn,
                            "-f", str(REPO / "db" / "migrations" / "038-family-teaching-parent.sql")],
                           check=True, capture_output=True, text=True)
        self.assertEqual(before, (self.count("SELECT md5(string_agg(q::text, E'\\n' ORDER BY q.id)) FROM questions q"),
                                  self.count("SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal"),
                                  self.count("SELECT count(*) FROM pg_constraint WHERE conrelid = 'questions'::regclass")))

    def insert(self, qid, parent, kind="question", db=None):
        (db or self.db).q("""INSERT INTO questions (id, lo_id, tier, question_type, stem, correct_answer,
                               canonical_solution, status, source, parent_question_id, parent_kind)
                             VALUES (%s, %s, 'standard', 'numeric', 's', '1', '[{"step": 1, "text_md": "x"}]',
                                     'review', 'variant', %s, %s)""", (qid, LO, parent, kind))

    def test_a_parent_must_exist_in_the_table_its_kind_names(self):
        import psycopg
        self.insert("q:g10m8s1-1-1:t-ok-teaching", EXPL, "teaching")
        self.insert("q:g10m8s1-1-1:t-ok-question", "q:g10m8s1-1-1:ex8-1-2", "question")
        self.insert("q:g10m8s1-1-1:t-ok-none", None, "question")
        refusals = [
            ("q:g10m8s1-1-1:t-no1", "expl:g10m8s1-1-1:nowhere", "teaching"),       # no such worked example
            ("q:g10m8s1-1-1:t-no2", "q:g10m8s1-1-1:nowhere", "question"),          # no such question
            ("q:g10m8s1-1-1:t-no3", EXPL, "question"),                             # a library id as a question parent
            ("q:g10m8s1-1-1:t-no4", "q:g10m8s1-1-1:ex8-1-2", "teaching"),          # a question id as a teaching parent
        ]
        for qid, parent, kind in refusals:
            with self.assertRaises(psycopg.errors.ForeignKeyViolation, msg=qid):
                self.insert(qid, parent, kind)
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.insert("q:g10m8s1-1-1:t-no5", None, "teaching")                  # a kind with nothing to name
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.insert("q:g10m8s1-1-1:t-no6", EXPL, "textbook")                  # an unknown kind
        # only a worked example can be a teaching parent: a refutation is the tutor's, not the book's
        refutation = self.db.one("SELECT id FROM explanation_library WHERE entry_type = 'refutation' LIMIT 1")
        self.assertTrue(refutation)
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            self.insert("q:g10m8s1-1-1:t-no7", refutation, "teaching")
        self.db.q("DELETE FROM questions WHERE id LIKE 'q:g10m8s1-1-1:t-ok-%'")

    def test_a_parent_is_never_deleted_from_under_its_children(self):
        import psycopg
        self.insert("q:g10m8s1-1-1:t-kid-t", EXPL, "teaching")
        self.insert("q:g10m8s1-1-1:t-kid-q", "q:g10m8s1-1-1:ex8-1-2", "question")
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            self.db.q("DELETE FROM explanation_library WHERE id = %s", (EXPL,))
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            self.db.q("UPDATE explanation_library SET entry_type = 'faded' WHERE id = %s", (EXPL,))
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            self.db.q("DELETE FROM questions WHERE id = 'q:g10m8s1-1-1:ex8-1-2'")
        # an update that touches neither the id nor the type is no business of the trigger
        self.db.q("UPDATE explanation_library SET source_page = 316 WHERE id = %s", (EXPL,))
        # a parent goes together with its children, in one statement: the finished state is what counts
        self.db.q("DELETE FROM questions WHERE id IN ('q:g10m8s1-1-1:t-kid-q', 'q:g10m8s1-1-1:ex8-1-2')"
                  " OR id LIKE 'q:g10m8s1-1-1:ex8-1-2%'")
        self.assertEqual(self.count("SELECT count(*) FROM questions WHERE id = 'q:g10m8s1-1-1:ex8-1-2'"), 0)
        self.db.q("DELETE FROM questions WHERE id = 'q:g10m8s1-1-1:t-kid-t'")
        self.db.q("UPDATE explanation_library SET source_page = 316 WHERE id = %s", (EXPL,))

    # ---- the loader ---------------------------------------------------------------------------
    def test_a_teaching_family_loads_live_with_no_human_stamp_so_it_is_in_the_backlog(self):
        qid = "q:g10m8s1-1-1:g001-draw"
        out = self.load([row(qid, kind="teaching")], "--course", G10)
        self.assertIn("loaded 1 questions as status=live", out)
        self.assertEqual(self.db.q("""SELECT status, reviewed_by, parent_question_id, parent_kind
                                        FROM questions WHERE id = %s""", (qid,))[0],
                         ("live", None, EXPL, "teaching"),
                         "answer 37a: live under the students-full rule, and no human stamp, which is the backlog")
        # a reload changes nothing about what it was modelled on
        self.load([row(qid, kind="teaching")], "--course", G10)
        self.assertEqual(self.db.q("SELECT parent_question_id, parent_kind FROM questions WHERE id = %s", (qid,))[0],
                         (EXPL, "teaching"))
        self.db.q("DELETE FROM questions WHERE id = %s", (qid,))

    def test_a_question_family_loads_as_before(self):
        qid = "q:g10m8s1-1-1:g002-plot"
        self.load([row(qid, parent="q:g10m8s1-1-1:ex8-1-2")], "--course", G10)
        self.assertEqual(self.db.q("SELECT parent_question_id, parent_kind FROM questions WHERE id = %s", (qid,))[0],
                         ("q:g10m8s1-1-1:ex8-1-2", "question"))
        self.db.q("DELETE FROM questions WHERE id = %s", (qid,))

    def test_an_unknown_kind_or_a_mismatch_is_refused_before_any_write(self):
        for bad, why in ((row("q:g10m8s1-1-1:g003-a", kind="textbook"), "parent_kind 'textbook'"),
                         (row("q:g10m8s1-1-1:g003-b", kind="teaching", parent="q:g10m8s1-1-1:ex8-1-2"),
                          "not a book teaching item id")):
            out = self.load([bad], "--course", G10, expect=1)
            self.assertIn(why, out)
            self.assertEqual(self.count("SELECT count(*) FROM questions WHERE id = %s", bad["id"]), 0)

    def test_a_parent_the_database_does_not_hold_refuses_the_whole_bundle_in_words(self):
        good, bad = row("q:g10m8s1-1-1:g004-a", kind="teaching"), row(
            "q:g10m8s1-1-1:g004-b", kind="teaching", parent="expl:g10m8s1-1-1:nowhere")
        gone_q = row("q:g10m8s1-1-1:g004-c", parent="q:g10m8s1-1-1:nowhere")
        out = self.load([good, bad, gone_q], "--course", G10, expect=1)
        self.assertIn("parent teaching item expl:g10m8s1-1-1:nowhere is not a worked example", out)
        self.assertIn("parent question q:g10m8s1-1-1:nowhere is not in the database", out)
        self.assertEqual(self.count("SELECT count(*) FROM questions WHERE id LIKE 'q:g10m8s1-1-1:g004-%'"), 0,
                         "nothing was written, not even the good one")

    # ---- export and restore --------------------------------------------------------------------
    def export(self, db: ScratchDB, name: str) -> Path:
        out = self.tmp / name
        code, text = run_main("export_generated_content",
                              ["--course", G10, "--out-dir", str(out), "--prior", str(FIX / "generated"),
                               "--dsn", db.dsn], db.dsn)
        self.assertEqual(code, 0, text)
        return out

    def test_export_writes_the_kind_only_where_it_is_not_the_default_and_restore_puts_it_back(self):
        qid = "q:g10m8s1-1-1:g005-draw"
        self.load([row(qid, kind="teaching")], "--course", G10)
        try:
            exported = self.export(self.db, "export-teaching")
            qs = json.loads((exported / "generated-questions.json").read_text())["questions"]
            by = {q["id"]: q for q in qs}
            self.assertEqual(by[qid]["parent_kind"], "teaching")
            self.assertEqual(by[qid]["parent_question_id"], EXPL)
            self.assertEqual([i for i, q in by.items() if "parent_kind" in q], [qid],
                             "every question-parent row is exported exactly as before 038")

            # without the teaching family the export is the committed fixture, byte for byte (FR-4404)
            self.db.q("DELETE FROM questions WHERE id = %s", (qid,))
            plain = self.export(self.db, "export-plain")
            self.assertEqual((plain / "generated-questions.json").read_bytes(),
                             (FIX / "generated" / "generated-questions.json").read_bytes())

            # restore the teaching export onto the snapshot taken before the family existed
            target = Copy(self.before.name).create()
            try:
                code, out = restore(target.dsn, "--course", G10, "--dir", str(exported))
                self.assertEqual(code, 0, out)
                self.assertIn("RESTORED", out)
                self.assertEqual(target.q("SELECT parent_question_id, parent_kind FROM questions WHERE id = %s",
                                          (qid,))[0], (EXPL, "teaching"))
                # a second run has nothing to do: the kind is compared with its default, not as a change
                code, out = restore(target.dsn, "--course", G10, "--dir", str(exported))
                self.assertEqual(code, 0, out)
                self.assertRegex(out, r"questions\s+add 0 · change 0 · unchanged \d+ · remove 0")
                # and a restore whose teaching parent is not in the database is refused, naming it
                missing = Copy(self.before.name).create()
                try:
                    missing.q("DELETE FROM explanation_library WHERE id = %s", (EXPL,))
                    code, out = restore(missing.dsn, "--course", G10, "--dir", str(exported))
                    self.assertNotEqual(code, 0, out)
                    self.assertIn(f"parent teaching item {EXPL}", out)
                finally:
                    missing.drop()
            finally:
                target.drop()
        finally:
            self.db.q("DELETE FROM questions WHERE id = %s", (qid,))


if __name__ == "__main__":
    unittest.main()

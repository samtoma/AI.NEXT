"""Only a human stamp is a review; a maths course is always full; book pictures; auto-passed gates.

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/test_review_policy.py

Samuel's answers 33 and 37 (docs/WIP-g10-pilot/samuel-answers.md), migration 035, review_policy.py:
  * migration 035 splits every legacy `reviewed_by` string — AI checks to ai_checked_by, notes to
    review_note, the figure gate's mark to hold_reason — keeps human stamps, changes no status, is
    idempotent, and its rollback restores the old strings;
  * the loaders never write an AI string into reviewed_by; a maths course loads live unless an
    automatic safety check holds it (with a reason); any other course keeps its review queue;
  * the assembly attaches the book's own picture as a `book_image` stand-in, and holds a question
    whose picture would show its unknown (`figure_reveals_answer`);
  * auto_pass_gates.py writes the AI's recommendation as an AUTO verdict and records every decision
    (runs/<book>/gates/*.json and gate_decisions); a safety check still blocks; an auto decision can
    never be stored as a human's.

@covers FR-4302, FR-4304
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from _scratchdb import EX, REPO, SERVER, ScratchDB, mini_course, run_loader, skip_without_db, write_bundle
import assemble_lesson_bundle as alb
import auto_pass_gates as apg
import book_config
import review_policy

MIG = REPO / "db" / "migrations" / "035-human-review-stamps.sql"
DOWN = REPO / "db" / "migrations" / "rollback" / "035-human-review-stamps.down.sql"


def psql_file(db: ScratchDB, path: Path) -> str:
    r = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", db.dsn, "-f", str(path)],
                       capture_output=True, text=True)
    if r.returncode:
        raise AssertionError(r.stderr)
    return r.stderr


class SplitLegacyStamp(unittest.TestCase):
    def test_the_python_split_is_the_migrations_split(self):
        cases = {
            "ai dual-check (pending Samuel)": (None, "ai dual-check", False, None),
            "ai dual-check (pending Samuel) [held: figure missing]": (None, "ai dual-check", True, None),
            "Samuel Toma (G2 fix); held: its figure is missing": ("Samuel Toma (G2 fix)", None, True,
                                                                 "held: its figure is missing"),
            "Samuel Toma (G2 accept); stem fixed by orchestrator — not Samuel": (
                "Samuel Toma (G2 accept)", None, False, "stem fixed by orchestrator — not Samuel"),
            "samuel (poc bulk)": (None, None, False, "promoted without review: samuel (poc bulk)"),
            "local-docker": (None, None, False, "promoted without review: local-docker"),
            "Samuel Toma (family tpl:x via q:y)": ("Samuel Toma (family tpl:x via q:y)", None, False, None),
        }
        for raw, want in cases.items():
            got = review_policy.split_legacy_stamp(raw)
            with self.subTest(raw=raw):
                self.assertEqual((got["reviewed_by"], got["ai_checked_by"], got["figure_hold"], got["note"]), want)

    def test_auto_is_never_a_human(self):
        self.assertEqual(review_policy.auto_pass_by("g3"), "auto-pass G3 (AI recommendation)")
        self.assertTrue(review_policy.is_auto("auto-pass G2 (AI recommendation) (G2 accept)"))
        self.assertFalse(review_policy.is_auto("Samuel Toma (G2 accept)"))
        self.assertTrue(review_policy.students_always_full("course:us-g10-math-en"))
        self.assertTrue(review_policy.students_always_full("course:prep3-math-en"))
        self.assertFalse(review_policy.students_always_full("course:prep3-social-ar"))
        self.assertFalse(review_policy.students_always_full("course:prep3-arabic-ar"))
        self.assertFalse(review_policy.students_always_full(None))


@skip_without_db()
class Migration035(unittest.TestCase):
    def setUp(self):
        self.db = ScratchDB("m035").create()
        self.tmp = Path(tempfile.mkdtemp(prefix="m035_"))
        run_loader(self.db.dsn, str(write_bundle(self.tmp, "zz", mini_course("zz"))), "--course", "course:zz-test-en")
        self.ids = [r[0] for r in self.db.q("SELECT id FROM questions ORDER BY id")]

    def tearDown(self):
        self.db.drop()

    def legacy(self) -> dict[str, tuple]:
        a, b, c, d = self.ids
        rows = {a: ("live", "ai dual-check (pending Samuel)"),
                b: ("review", "ai dual-check (pending Samuel) [held: figure missing]"),
                c: ("review", "Samuel Toma (G2 accept); held: its figure is missing"),
                d: ("live", "Samuel Toma (G2 fix); stem fixed by orchestrator (data-engineer agent) — not Samuel")}
        for qid, (st, by) in rows.items():
            self.db.q("UPDATE questions SET status = %s, reviewed_by = %s, reviewed_at = '2026-09-27T00:00:00Z', "
                      "ai_checked_by = NULL, ai_checked_at = NULL, hold_reason = NULL, review_note = NULL "
                      "WHERE id = %s", (st, by, qid))
        return rows

    def cols(self, qid):
        return self.db.q("SELECT status, reviewed_by, ai_checked_by, hold_reason, review_note FROM questions "
                         "WHERE id = %s", (qid,))[0]

    def test_the_backfill_splits_every_legacy_stamp_once_and_the_rollback_restores_it(self):
        rows = self.legacy()
        a, b, c, d = self.ids
        psql_file(self.db, MIG)
        self.assertEqual(self.cols(a), ("live", None, "ai dual-check", None, None))
        self.assertEqual(self.cols(b), ("review", None, "ai dual-check", "figure_missing", None))
        self.assertEqual(self.cols(c), ("review", "Samuel Toma (G2 accept)", None, "figure_missing",
                                        "held: its figure is missing"))
        self.assertEqual(self.cols(d), ("live", "Samuel Toma (G2 fix)", None, None,
                                        "stem fixed by orchestrator (data-engineer agent) — not Samuel"))
        after = self.db.q("SELECT * FROM questions ORDER BY id")
        psql_file(self.db, MIG)
        self.assertEqual(self.db.q("SELECT * FROM questions ORDER BY id"), after, "a re-run changes nothing")
        psql_file(self.db, DOWN)
        for qid, (st, by) in rows.items():
            self.assertEqual(self.db.q("SELECT status, reviewed_by FROM questions WHERE id = %s", (qid,))[0], (st, by))
        psql_file(self.db, DOWN)          # idempotent: already gone
        psql_file(self.db, MIG)           # and forward again
        self.assertEqual(self.cols(a), ("live", None, "ai dual-check", None, None))

    def test_a_live_row_never_keeps_a_hold_and_an_auto_decision_is_never_a_humans(self):
        import psycopg
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.db.q("UPDATE questions SET status = 'live', hold_reason = 'figure_missing' WHERE id = %s",
                      (self.ids[0],))
        base = ("g10-math:ch08:G3", "G3", "g10-math", "course:us-g10-math-en", "ch08", "passed")
        sql = ("INSERT INTO gate_decisions (id, gate, book, course_id, scope, outcome, decided_by, auto, decided_at, "
               "record, record_sha256) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,now(),'{}'::jsonb,%s)")
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.db.q(sql, (*base, "Samuel Toma", True, "0" * 64))
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.db.q(sql, (*base, "auto-pass G3 (AI recommendation)", False, "0" * 64))
        self.db.q(sql, (*base, "auto-pass G3 (AI recommendation)", True, "0" * 64))


@skip_without_db()
class LoadersWriteNoAiStamp(unittest.TestCase):
    def setUp(self):
        self.db = ScratchDB("policy").create()
        self.tmp = Path(tempfile.mkdtemp(prefix="policy_"))

    def tearDown(self):
        self.db.drop()

    def rows(self):
        return {r[0]: r[1:] for r in self.db.q(
            "SELECT id, status, reviewed_by, ai_checked_by, hold_reason, review_note FROM questions ORDER BY id")}

    def test_a_course_that_is_not_maths_keeps_its_review_queue(self):
        run_loader(self.db.dsn, str(write_bundle(self.tmp, "zz", mini_course("zz"))), "--course", "course:zz-test-en")
        r = self.rows()
        self.assertEqual(r["q:zz1-1-1:001"], ("live", None, "ai dual-check", None, None))
        self.assertEqual(r["q:zz1-1-2:001"], ("review", None, None, None, None), "awaiting a human, no reason")

    def test_a_maths_course_is_always_full_and_a_bulk_promotion_is_a_note(self):
        with mock.patch.object(review_policy, "students_always_full", lambda c: c == "course:zz-test-en"):
            run_loader(self.db.dsn, str(write_bundle(self.tmp, "zz", mini_course("zz"))), "--course",
                       "course:zz-test-en")
        r = self.rows()
        self.assertEqual(r["q:zz1-1-2:001"], ("live", None, None, None, None), "answer 37a: live, no stamp")
        self.assertTrue(all(v[1] is None for v in r.values()), "a loader never writes reviewed_by")
        db2 = ScratchDB("bulk").create()
        try:
            run_loader(db2.dsn, str(write_bundle(self.tmp, "yy", mini_course("yy"))), "--approve-all")
            got = db2.q("SELECT status, reviewed_by, review_note FROM questions WHERE id = 'q:yy1-1-2:001'")[0]
            self.assertEqual(got, ("live", None, "promoted without review: samuel (poc bulk)"))
        finally:
            db2.drop()


class BookPictures(unittest.TestCase):
    """Answer 37d at the assembly: a stand-in for a figure no native kind drew, never one that shows the unknown."""

    STEMS = {   # Chapter 8's real stems (the book's own words), and whether the picture would give the answer
        "38b": ("In the diagram points $P(-3, 3)$ , $Q(1, -2)$ , $R(5, 1)$ and $S(x, y)$ are the vertices of a "
                "parallelogram. [figure] Find the coordinates of $M$ where the diagonals meet.", True),
        "38c": ("In the diagram points $P(-3, 3)$ , $Q(1, -2)$ , $R(5, 1)$ and $S(x, y)$ are the vertices of a "
                "parallelogram. [figure] Find $T$ , the mid-point of $PQ$ .", True),
        "38a": ("In the diagram points $P(-3, 3)$ , $Q(1, -2)$ , $R(5, 1)$ and $S(x, y)$ are the vertices of a "
                "parallelogram. [figure] Calculate the length of $PQ$ .", False),
        "40d": ("The following diagram shows $\\triangle PQR$ with $P(1, -1)$ . The equation of $QR$ is $x-3y=-6$ "
                "[figure] If the $y$ -coordinate of $R$ is 4, calculate the $x$ -coordinate of $R$ .", True),
        "45a": ("In the diagram below, $f(x)=\\frac{3}{2}x-4$ is sketched with $U(6, a)$ on $f(x)$ . [figure] "
                "Determine the value of a in $U(6, a)$ .", True),
        "45b": ("In the diagram below, $f(x)=\\frac{3}{2}x-4$ is sketched with $U(6, a)$ on $f(x)$ . [figure] A line, "
                "$g(x)$ , passing through $U$ , is perpendicular to $f(x)$ . $V(b, 4)$ lies on $g(x)$ . "
                "Determine the value of $b$ .", False),
        "46e": ("In the diagram below, $M$ and $N$ are the mid-points of $OA$ and $OB$ respectively. [figure] "
                "Write down the coordinates of $P$ such that $OAPB$ is a parallelogram.", False),
        "31c": ("Given the following diagram: [figure] Find the coordinates of the mid-point of diagonal $BD$ .", False),
    }
    E31 = [{"labels": ["A(-2;2)", "B(4;5)", "C(8;2)", "D(1;-3)", "E(a;b)"], "withheld": [], "caption": None}]

    def test_the_reveal_rule_on_chapter_8(self):
        for ref, (stem, reveals) in self.STEMS.items():
            with self.subTest(ref=ref):
                self.assertEqual(bool(alb.book_picture_reveals({"stem": stem}, [])), reveals)
        q31a = {"stem": "Given the following diagram: [figure] If $E$ is the mid-point of $AB$ , "
                        "find the values of $a$ and $b$ ."}
        self.assertTrue(alb.book_picture_reveals(q31a, self.E31), "E(a;b) is drawn: its letters are asked")
        self.assertIsNone(alb.book_picture_reveals(q31a, []), "a read-off exercise: no data but the figure")

    def test_police_figures_attaches_a_stand_in_or_holds(self):
        tmp = Path(tempfile.mkdtemp(prefix="pics_"))
        (tmp / "tikzpicture__a.png").write_bytes(b"\x89PNG fake")
        rep = alb.Report()
        rep.figures_dir, rep.book_name = tmp, "g10-math"
        bundle = {"questions": [], "visuals": []}
        for ref in ("38a", "38b"):
            qid = f"q:g10m8s4-1-1:ex8-6-{ref}"
            bundle["questions"].append({"id": qid, "lo": "lo:g10m8s4-1-1", "stem": self.STEMS[ref][0], "verified": True})
            rep.book_figures[qid] = {"files": ["tikzpicture__a.png"], "page": 324, "slug": "g10m8s4-1",
                                     "gap_kind": "polygon_scene"}
        alb.police_figures(bundle, rep)
        (v,) = bundle["visuals"]
        self.assertEqual((v["id"], v["kind"], v["question"]), ("v:g10m8s4-1:bk-ex8-6-38a", "book_image",
                                                               "q:g10m8s4-1-1:ex8-6-38a"))
        self.assertEqual(v["spec"], {"src": "/book-figures/g10-math/tikzpicture__a.png",
                                     "alt": "The textbook's diagram for this question, printed on page 324.",
                                     "stand_in": True, "native_kind_needed": "polygon_scene"})
        q38a, q38b = bundle["questions"]
        self.assertTrue(q38a["verified"])
        self.assertNotIn("hold_reason", q38a)
        self.assertEqual((q38b["verified"], q38b["hold_reason"]), (False, "figure_reveals_answer"))
        # --no-book-pictures: answer 29's native-only rule
        rep2 = alb.Report()
        rep2.figures_dir, rep2.book_name, rep2.book_pictures = tmp, "g10-math", False
        rep2.book_figures = rep.book_figures
        b2 = {"questions": [dict(q38a, verified=True)], "visuals": []}
        b2["questions"][0].pop("hold_reason", None)
        alb.police_figures(b2, rep2)
        self.assertEqual((b2["visuals"], b2["questions"][0]["hold_reason"]), ([], "figure_missing"))


class AutoPassGates(unittest.TestCase):
    def setUp(self):
        self.book = book_config.load_book("g10-math")
        self.gates = Path(tempfile.mkdtemp(prefix="gates_"))

    def test_g1_answers_owed_decisions_and_a_pipeline_failure_blocks(self):
        check = {"pool": {"Ex8-6:9": "lo:g10m8s3-1-2"},
                 "failures": ["distributed item Ex8-6:28a maps to no objective (rule 2): both mappers said none"],
                 "undecided": [{"key": "term:gradient", "kind": "terminology", "detail": "x"},
                               {"key": "pool:Ex8-6:9", "kind": "mappers_disagree", "item": "Ex8-6:9", "detail": "x"},
                               {"key": "single:lo:g10m8s1-1-1", "kind": "single", "objective": "lo:g10m8s1-1-1",
                                "detail": "x"}]}
        v, blocked, decided = apg.g1_verdicts(check)
        self.assertEqual(blocked, [])
        self.assertEqual((v["terminology"], v["move_items"], list(v["outside_items"])),
                         ({"gradient": "keep"}, {"Ex8-6:9": "lo:g10m8s3-1-2"}, ["Ex8-6:28a"]))
        self.assertTrue(v["auto"] and v["by"] == "auto-pass G1 (AI recommendation)")
        self.assertEqual(len(decided), 4)
        check["undecided"].append({"key": "links:failed", "kind": "links_failed", "detail": "the linker failed"})
        _, blocked, _ = apg.g1_verdicts(check)
        self.assertEqual(len(blocked), 1)

    def test_g2_keeps_a_humans_verdict_and_adds_the_rest_as_auto(self):
        rec = {"items": {"a:Ex1:1": {"verdict": "fix", "class": "book error", "fields": {"answer": "5"}},
                         "a:Ex1:2": {"verdict": "accept", "class": "no printed answer"},
                         "a:Ex1:3": {"verdict": "maybe"}}}
        doc, c, decided = apg.g2_merge(rec, {"by": "Samuel Toma", "items": {"a:Ex1:2": {"verdict": "hold"}}})
        self.assertEqual(doc["by"], "Samuel Toma")
        self.assertEqual(doc["items"]["a:Ex1:2"], {"verdict": "hold"}, "the human's verdict is untouched")
        self.assertEqual({k: (v["verdict"], v["auto"], v["fields"]) for k, v in doc["items"].items() if v.get("auto")},
                         {"a:Ex1:1": ("fix", True, {"answer": "5"})})
        self.assertEqual(c, {"added": 1, "kept_human": 1, "recommended": 3})
        doc2, _, _ = apg.g2_merge(rec, None)
        self.assertEqual((doc2["by"], doc2["auto"]), ("auto-pass G2 (AI recommendation)", True))

    def test_g5_blocks_on_a_safety_check_or_parity_and_lists_completeness_for_samuel(self):
        cov = {"status": "RED", "checks": [
            {"id": "tier_floor", "state": "fails", "want": 39, "got": 33, "failures": [{"scope": "lo:x", "detail": "y"}]},
            {"id": "katex", "state": "holds", "want": 0, "got": 0, "failures": []}]}
        blocking, review, _ = apg.g5_evaluate(cov, [("course:prep3-math-en", "GREEN", [])])
        self.assertEqual((blocking, len(review)), ([], 1))
        cov["checks"][1].update(state="fails", got=1, failures=[{"scope": "q:1", "detail": "bad TeX"}])
        blocking, _, _ = apg.g5_evaluate(cov, [("course:prep3-math-en", "RED", ["visuals 211 != 212"])])
        self.assertEqual(len(blocking), 2)

    def test_a_record_is_auto_signed_and_its_outcome_agrees_with_what_blocked(self):
        rec = apg.decision_record("G3", self.book, 8, "passed", "s", decided=[{"item": "q", "verdict": "accept",
                                                                                 "why": "w"}])
        self.assertEqual((rec["id"], rec["format"], rec["auto"], rec["decided_by"], rec["review"]),
                         ("g10-math:ch08:G3", "ainext.gate-decision/1", True, "auto-pass G3 (AI recommendation)",
                          {"status": "awaiting_samuel"}))
        with self.assertRaises(ValueError):
            apg.decision_record("G5", self.book, 8, "passed", "s", blocking=["parity RED"])
        path, where = apg.write_record(rec, self.gates, None)
        self.assertEqual(path.name, "g10-math__ch08__G3.json")
        self.assertEqual(json.loads(path.read_text())["id"], "g10-math:ch08:G3")

    @unittest.skipUnless(SERVER, "set AINEXT_TEST_PG")
    def test_a_record_reaches_gate_decisions_and_a_rerun_replaces_it(self):
        db = ScratchDB("gates").create()
        try:
            rec = apg.decision_record("G4", self.book, 8, "passed", "first")
            apg.write_record(rec, self.gates, db.dsn)
            apg.write_record(dict(rec, summary="second"), self.gates, db.dsn)
            rows = db.q("SELECT id, auto, decided_by, record->>'summary', length(record_sha256) FROM gate_decisions")
            self.assertEqual(rows, [("g10-math:ch08:G4", True, "auto-pass G4 (AI recommendation)", "second", 64)])
        finally:
            db.drop()


if __name__ == "__main__":
    unittest.main()

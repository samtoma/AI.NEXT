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
  * auto_pass_gates.py writes the AI's recommendation as an AUTO verdict and records every decision in the
    console's `ainext.gate-decision/1` shape (runs/<book>/gates/<id>.json, read by
    app/src/lib/review-gate-records.ts); a safety check still blocks; an auto decision is never a human's.

@covers FR-4302, FR-4304
"""

from __future__ import annotations

import json
import os
import shutil
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

    def test_a_live_row_never_keeps_a_hold(self):
        import psycopg
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.db.q("UPDATE questions SET status = 'live', hold_reason = 'figure_missing' WHERE id = %s",
                      (self.ids[0],))
        self.db.q("UPDATE questions SET status = 'review', hold_reason = 'figure_missing' WHERE id = %s", (self.ids[0],))


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


    def test_an_auto_g3_adds_to_the_ai_checks_and_a_human_g3_still_stamps(self):
        run_loader(self.db.dsn, str(write_bundle(self.tmp, "zz", mini_course("zz"))), "--course", "course:zz-test-en")
        for i in (1, 2):
            self.db.q("""INSERT INTO questions (id, lo_id, tier, question_type, stem, correct_answer, canonical_solution,
                                               status, source, source_note, ai_checked_by)
                         VALUES (%s, 'lo:zz1-1-1', 'basic', 'numeric', 'x', '1', '[]', 'live', 'variant',
                                 'Generated from template family tpl:zz:f.', 'ai blind grade (S6)')""",
                      (f"q:zz1-1-1:g00{i}",))
        env = dict(os.environ, AINEXT_DB_DSN=self.db.dsn)

        def apply(doc):
            f = self.tmp / "g3.json"
            f.write_text(json.dumps(doc))
            r = subprocess.run([sys.executable, str(EX / "apply_review_verdicts.py"), str(f)],
                               capture_output=True, text=True, env=env, cwd=EX)
            self.assertEqual(r.returncode, 0, r.stderr)
        auto = {"reviewer": "auto-pass G3 (AI recommendation)", "auto": True, "verdicts": {"q:zz1-1-1:g001": "accept"}}
        apply(auto)
        apply(auto)           # a re-run adds nothing twice
        got = dict(self.db.q("SELECT id, ai_checked_by FROM questions WHERE source = 'variant' ORDER BY id"))
        self.assertEqual(got, {
            "q:zz1-1-1:g001": "ai blind grade (S6); auto-pass G3 (AI recommendation) (sampled)",
            "q:zz1-1-1:g002": "ai blind grade (S6); auto-pass G3 (AI recommendation) (family tpl:zz:f via q:zz1-1-1:g001)"})
        self.assertEqual(self.db.one("SELECT count(*) FROM questions WHERE reviewed_by IS NOT NULL"), 0)
        apply({"reviewer": "Samuel Toma", "verdicts": {"q:zz1-1-1:g002": "accept"}})
        self.assertEqual(self.db.one("SELECT reviewed_by FROM questions WHERE id = 'q:zz1-1-1:g002'"),
                         "Samuel Toma (sampled)")
        self.assertEqual(self.db.one("SELECT reviewed_by FROM questions WHERE id = 'q:zz1-1-1:g001'"),
                         "Samuel Toma (family tpl:zz:f via q:zz1-1-1:g002)", "a human's verdict travels as before")


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
        v, blocked, decisions = apg.g1_verdicts(check)
        self.assertEqual(blocked, [])
        self.assertEqual((v["terminology"], v["move_items"], list(v["outside_items"])),
                         ({"gradient": "keep"}, {"Ex8-6:9": "lo:g10m8s3-1-2"}, ["Ex8-6:28a"]))
        self.assertTrue(v["auto"] and v["by"] == "auto-pass G1 (AI recommendation)")
        self.assertEqual(len(decisions), 4)
        check["undecided"].append({"key": "links:failed", "kind": "links_failed", "detail": "the linker failed"})
        _, blocked, _ = apg.g1_verdicts(check)
        self.assertEqual(len(blocked), 1)

    def test_g2_a_human_verdict_stands_then_the_recommendation_then_the_checks_rule(self):
        run = {"lessons": [{"lesson": "g10m8s2-1", "items": [{"ref": r} for r in ("Ex1", "Ex2", "Ex3", "Ex4", "Ex5")],
                            "verify": {"typing_problems": [{"ref": "Ex1", "problems": ["key does not read"]}],
                                       "no_printed_answer": [{"ref": "Ex2", "agreed_with_book_solution": True},
                                                             {"ref": "Ex5", "agreed_with_book_solution": False}],
                                       "disagreements": [{"ref": "Ex3"}, {"ref": "Ex4"}]}},
                           {"lesson": "g10m9s1-1", "items": [{"ref": "Ex9"}],
                            "verify": {"disagreements": [{"ref": "Ex9"}]}}]}
        owed = apg.g2_items(run, 8, "g10m")
        self.assertEqual(sorted(owed), ["g10m8s2-1:Ex1", "g10m8s2-1:Ex2", "g10m8s2-1:Ex3", "g10m8s2-1:Ex4",
                                        "g10m8s2-1:Ex5"], "this chapter's items only")
        rec = {"items": {"g10m8s2-1:Ex3": {"verdict": "fix", "class": "book error", "fields": {"answer": "5"}}}}
        human = {"by": "Samuel Toma", "items": {"g10m8s2-1:Ex4": {"verdict": "hold"}}}
        doc, c, decisions = apg.g2_merge(owed, rec, human)
        it = doc["items"]
        self.assertEqual(doc["by"], "Samuel Toma")
        self.assertEqual(it["g10m8s2-1:Ex4"], {"verdict": "hold"}, "the human's verdict is untouched")
        self.assertEqual((it["g10m8s2-1:Ex3"]["verdict"], it["g10m8s2-1:Ex3"]["fields"]), ("fix", {"answer": "5"}))
        self.assertEqual(it["g10m8s2-1:Ex1"]["verdict"], "exclude", "a typing problem is kept out, for Samuel")
        self.assertEqual(it["g10m8s2-1:Ex2"]["verdict"], "accept", "re-solve agreed with the book's solution")
        self.assertNotIn("g10m8s2-1:Ex5", it, "nothing supports a verdict: it stays held")
        self.assertTrue(all(v.get("auto") and v["by"] == "auto-pass G2 (AI recommendation)"
                            for k, v in it.items() if k != "g10m8s2-1:Ex4"))
        self.assertEqual(c, {"human": 1, "recommended": 1, "rule": 2, "held": 1})
        doc2, _, _ = apg.g2_merge(owed, None, None)
        self.assertEqual((doc2["by"], doc2["auto"]), ("auto-pass G2 (AI recommendation)", True))

    def test_g5_blocks_on_a_safety_check_or_parity_and_lists_completeness_for_samuel(self):
        cov = {"status": "RED", "checks": [
            {"id": "tier_floor", "state": "fails", "want": 39, "got": 33, "failures": [{"scope": "lo:x", "detail": "y"}]},
            {"id": "katex", "state": "holds", "want": 0, "got": 0, "failures": []}]}
        blocked, review, checks = apg.g5_evaluate(cov, [("course:prep3-math-en", "GREEN", [])])
        self.assertEqual((blocked, len(review), len(checks)), ([], 1, 3))
        cov["checks"][1].update(state="fails", got=1, failures=[{"scope": "q:1", "detail": "bad TeX"}])
        blocked, _, _ = apg.g5_evaluate(cov, [("course:prep3-math-en", "RED", ["visuals 211 != 212"])])
        self.assertEqual(len(blocked), 2)

    def test_a_record_is_the_consoles_shape_auto_signed_and_its_outcome_follows_what_held(self):
        rec = apg.decision_record("G3", self.book, 8, "s", decisions=[{"key": "q", "decision": "accept",
                                                                      "basis": "w", "detail": None}],
                                  evidence=[("verdicts", apg.HERE / "auto_pass_gates.py"), ("none", None)])
        self.assertEqual({k: rec[k] for k in ("format", "gate", "book", "id", "chapter", "by", "auto", "outcome")},
                         {"format": "ainext.gate-decision/1", "gate": "G3", "book": "g10-math", "id": "g3-ch08",
                          "chapter": 8, "by": "auto-pass G3 (AI recommendation)", "auto": True, "outcome": "pass"})
        self.assertEqual(rec["decisions"], [{"key": "q", "decision": "accept", "basis": "w"}])
        self.assertEqual(rec["evidence"], [{"label": "verdicts", "path": "services/extraction/auto_pass_gates.py"}])
        self.assertTrue(rec["decided_at"].endswith("Z"))
        self.assertEqual(apg.decision_record("G3", self.book, 8, "s", held=True)["outcome"], "pass_with_holds")
        self.assertEqual(apg.decision_record("G5", self.book, None, "s", blocked=["parity RED"])["outcome"], "blocked")
        self.assertEqual(apg.decision_record("G5", self.book, None, "s")["id"], "g5-book")
        path = apg.write_record(rec, self.gates)
        self.assertEqual(path.name, "g3-ch08.json")
        self.assertEqual(json.loads(path.read_text())["id"], "g3-ch08")

    @unittest.skipUnless(shutil.which("node"), "the console's parser runs in node")
    def test_the_consoles_own_parser_reads_the_record(self):
        rec = apg.decision_record("G2", self.book, 9, "s", decisions=[{"key": "g10m9s1-1:Ex9-1:1", "decision": "accept"}],
                                  checks=[{"name": "three-way check", "state": "done"}], held=True)
        path = apg.write_record(rec, self.gates)
        app = REPO / "app"
        script = (f"const {{ parseRecord }} = await import({json.dumps(str(app / 'src/lib/review-gate-records.ts'))});"
                  f"const fs = await import('node:fs');"
                  f"const r = parseRecord(JSON.parse(fs.readFileSync({json.dumps(str(path))}, 'utf8')), 'x', '');"
                  "console.log(JSON.stringify([r.ref, r.gate, r.chapter, r.outcome, r.auto, r.decisions.length]));")
        out = subprocess.run(["node", "--import", "./scripts/ts-resolver.mjs", "--input-type=module", "-e", script],
                             capture_output=True, text=True, cwd=app)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(json.loads(out.stdout.strip().splitlines()[-1]),
                         ["g10-math/g2-ch09", "G2", 9, "pass_with_holds", True, 1])


if __name__ == "__main__":
    unittest.main()

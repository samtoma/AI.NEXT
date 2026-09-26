"""What the Chapter 8 S5 draft taught (2026-09-26): the agents after S3 must SEE the book's diagrams, and
must be given only evidence G2 settled.

    uv run --with pytest python -m pytest -q tests/test_stage_figures.py

@covers FR-4302, FR-4303

  * S5 (s5-v4): a question whose stem shows [figure] names its image files ("Figure(s): …") in both
    modes, the author AND the verifier are told they may open them, and the by-ref prompt still splices
    back to the inline one. The book's teaching items (worked examples) are canonical solutions too, so
    an objective taught only by them is not skipped. A three-way disagreement is evidence of a STUDENT
    error only when G2 kept the book's answer (the re-solve was the odd one out); one G2 fixed or
    excluded is not.
  * S6 (s6-v4) and S7 (s7-v4): the author's book questions / anchors carry their figure images and the
    rule; a widget template's stem may never point at a [figure] (the blind verifier and the student see
    only the instrument).
  * Assembly: a marked expression question's answer text is never a printed answer G2 corrected.
"""

from __future__ import annotations

import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
EX = HERE.parent
for p in (str(EX), str(HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)

import assemble_misconceptions as am  # noqa: E402
import packet_ref  # noqa: E402

NODE = shutil.which("node")
FIG = "/w/figures/tikzpicture__points.png"


def lesson_run(items):
    return {"lesson": "zz1s1-1", "claims": [], "items": items}


def run_item(ref, lo, **kw):
    it = {"ref": ref, "lo": lo, "verification": "agreed", "figures": [], "printed_answer": "E",
          "blind_answer": "E", "epub_final_answer": "E", "printed_page": 3}
    it.update(kw)
    return it


class S5Inputs(unittest.TestCase):
    def setUp(self):
        import test_assemble_misconceptions as T
        self.T = T
        self.args = T.base_args("draft")
        self.q = self.args["questions"][0]

    def s5(self, runs, bundles=None):
        class Book:           # the parts of a book config s5_args reads
            book, language, notation = "zz", "en", None
            @staticmethod
            def owns_lo(lo):
                return lo.startswith("lo:zz")
        return am.s5_args(Book, bundles or [], runs, "draft")

    def test_figures_come_from_the_lesson_runs_by_question_id(self):
        runs = [lesson_run([run_item("Ex8-1:3", "lo:zz1s1-1-1", figures=[FIG])])]
        figs = am.figures_by_question(runs)
        qid = am.item_question_id(runs[0]["items"][0])
        self.assertEqual(figs[qid], [FIG])
        self.assertEqual(figs["expl:" + qid.removeprefix("q:")], [FIG])
        bundle = {"nodes": [], "questions": [{"id": qid, "lo": "lo:zz1s1-1-1", "stem": "Which point? [figure]",
                                              "answer": "E", "solution": ["It is E."], "source_page": 3,
                                              "choices": [{"key": "A", "text": "A"}, {"key": "E", "text": "E"}]}],
                  "explanation_entries": [{"id": "expl:zz1s1-1-1:ex8-6-4a", "lo": "lo:zz1s1-1-1",
                                           "entry_type": "worked_example",
                                           "content": [{"kind": "problem", "text_md": "Plot $D(1, 2)$."},
                                                       {"step": 1, "text_md": "Move 1 right and 2 up."}]}]}
        args = self.s5(runs, [bundle])
        by_id = {q["id"]: q for q in args["questions"]}
        self.assertEqual(by_id[qid]["figures"], [FIG])
        teaching = by_id["expl:zz1s1-1-1:ex8-6-4a"]
        self.assertEqual((teaching["kind"], teaching["canonical_solution"]), ("worked_example", ["Move 1 right and 2 up."]))

    def test_only_a_disagreement_g2_kept_is_evidence_of_a_student_error(self):
        lo = "lo:zz1s1-1-1"
        diff = {"pairs": [{"pair_id": "x|blind~printed", "verdict": "different"}]}
        same = {"pairs": [{"pair_id": "x|blind~printed", "verdict": "equivalent"}]}
        runs = [lesson_run([
            run_item("Ex8-6:33a", lo, verification="disputed", blind_answer="k = 7", verify=diff,
                     g2={"verdict": "accept", "by": "Samuel", "note": "Keep as printed"}),
            run_item("Ex8-6:42e", lo, verification="disputed", blind_answer="Rhombus", verify=diff,
                     g2={"verdict": "fix", "by": "S", "changed": ["less_specific"]}),     # the book's answer stood
            run_item("Ex8-6:5", lo, verification="disputed", blind_answer="9,60", verify=diff,
                     g2={"verdict": "fix", "by": "S", "changed": ["answer", "solution"]}),   # the book's error
            run_item("Ex8-6:39c", lo, verification="disputed", blind_answer="undefined", verify=diff,
                     g2={"verdict": "fix", "by": "S", "changed": ["stem"]}),               # the re-solve saw a defective stem
            run_item("Ex8-6:24a", lo, verification="disputed", blind_answer="\\sqrt{34}", verify=same,
                     g2={"verdict": "fix", "by": "S", "changed": ["answer_only"]}),        # it agreed with the book
            run_item("Ex8-5:5", lo, verification="disputed", blind_answer="(10; -1)", verify=diff,
                     g2={"verdict": "exclude", "by": "S"}),
            run_item("Ex8-6:9", lo, verification="disputed", blind_answer="3", verify=diff),   # never reviewed
        ])]
        src = [s for s in self.s5(runs)["sources"] if s["kind"] == "resolve_disagreement"]
        self.assertEqual([s["ref"] for s in src], [am.item_question_id(it) for it in runs[0]["items"][:2]])
        self.assertIn("kept at review (G2)", src[0]["text"])
        self.assertIn("Keep as printed", src[0]["text"])


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class S5Prompts(unittest.TestCase):
    def test_both_agents_see_the_figure_files_and_may_open_them_in_both_modes(self):
        import test_assemble_misconceptions as T
        from test_packet_ref import spliced_equals_inline
        draft = T.base_args("draft")
        lo = draft["objectives"][0]["id"]
        q = next(x for x in draft["questions"] if x["lo"] == lo)
        q["figures"] = [FIG]
        resp = T.fixture("s5-draft-responses.json")
        inline = T.run_stub(T.WORKFLOW, draft, resp)
        with tempfile.TemporaryDirectory() as d:
            compact = am.s5_args_by_ref(copy.deepcopy(draft), Path(d))
            self.assertEqual(compact["objective_refs"][lo]["figures"], 1)
            byref = T.run_stub(T.WORKFLOW, compact, resp)
            self.assertTrue(inline["ok"] and byref["ok"], (inline["error"], byref["error"]))
            shard = (Path(compact["by_ref"]["dir"]) / "o" / f"{lo.removeprefix('lo:')}.questions.txt").read_text()
            self.assertIn(f"  Figure(s): {FIG}", shard)
            spliced_equals_inline(self, inline, byref)
            for run in (inline, byref):
                p = next(c["prompt"] for c in run["calls"] if c["label"] == f"author:{lo}")
                self.assertIn("you may open those image files as well", p)
            p_other = [c["prompt"] for c in inline["calls"] if c["label"].startswith("author:") and c["label"] != f"author:{lo}"]
            self.assertTrue(all("Figure(s)" not in x for x in p_other), "the rule only where a figure is named")
        self.assertEqual(inline["result"]["prompts_version"], "s5-v4")


class S6S7Inputs(unittest.TestCase):
    def test_s6_author_book_questions_carry_their_figures(self):
        import book_config
        import generate_questions as G
        book = book_config.load_book("g10-math")
        objs = {"lo:g10m8s1-1-2": {"label": "Points", "description": "d", "module": "module:g10m8",
                                   "questions": [{"id": "q:g10m8s1-1-2:ex8-1-3", "tier": "basic", "type": "mcq",
                                                  "stem": "Which point? [figure]", "answer": "E", "verified": True,
                                                  "solution": ["E"], "source_page": 1}]}}
        a = G.author_args(book, [], objs, {}, True, [], {"q:g10m8s1-1-2:ex8-1-3": [FIG]})
        self.assertEqual(a["objectives"][0]["book_questions"][0]["figures"], [FIG])
        with tempfile.TemporaryDirectory() as d:
            c = G.author_args_by_ref(a, Path(d))
        self.assertEqual(c["objective_refs"][0]["figures"], 1)
        plain = G.author_args(book, [], objs, {}, True, [])
        self.assertNotIn("figures", plain["objectives"][0]["book_questions"][0], "no key when there is no figure")

    def test_s7_a_widget_stem_that_points_at_a_figure_is_refused(self):
        import generate_widget_questions as GW
        fix = HERE / "fixtures" / "families" / "widget-templates" / "g10m8s3-1-2--gradient-line.json"
        tpl = json.loads(fix.read_text())
        self.assertEqual([p for p in GW.check_template(tpl) if "[figure]" in p], [])
        bad = dict(tpl, stem="Use the diagram: [figure] " + tpl["stem"])
        self.assertTrue(any("[figure]" in p for p in GW.check_template(bad)))


class G2Changed(unittest.TestCase):
    def test_a_fix_records_only_the_fields_it_really_changed(self):
        import assemble_objectives as ao
        fix = HERE / "fixtures" / "g10-math" / "runs" / "lesson" / "g10m8s1-1.json"
        lesson = json.loads(fix.read_text())
        it = next(i for i in lesson["items"] if i["ref"] == "Ex8-1:1")
        run = {"prompts_version": "lesson-v4", "stage": "S2-S4,S8", "lessons": [lesson]}
        g2 = {"by": "Samuel", "items": {"g10m8s1-1:Ex8-1:1": {"verdict": "fix",
              "fields": {"answer": it["answer"], "less_specific": ["B"]}}}}
        out = ao.lesson_runs(run, g2)["g10m8s1-1"]
        got = next(i for i in out["items"] if i["ref"] == "Ex8-1:1")["g2"]
        self.assertEqual(got["changed"], ["less_specific"], "the key was set to what it already was")


class CatalogueNotation(unittest.TestCase):
    """FR-4308 in the misconception catalogue, enforced where it is assembled (the S5 verifier does not judge
    notation): no decimal comma outside a bracket, no book-style (x; y) pair — and a pair written (-2,3) in
    the app's notation, a set \\{1,2,3\\} or an interval [1,2] is not a decimal."""

    def test_the_rule(self):
        ok = ["$C(-2,3)$ and $P(-3,4)$", "$(2.5, 3)$", "With $X = \\{1,2,3\\}$ and $(1,2), (2,3)$", "$[1,2]$"]
        for t in ok:
            self.assertEqual(am.notation_problems(t), [], t)
        for t in ("the answer is 9,60", "$d=\\text{9,60}$", "$x=2{,}5$", "$(3; 4)$", "(2,5; 3)"):
            self.assertTrue(am.notation_problems(t), t)

    def test_the_assembled_catalogue_refuses_a_decimal_comma(self):
        entry = {"id": "mc:g10m8s2-1-1:rounds-early", "lo_id": "lo:g10m8s2-1-1", "label": "Rounds too early",
                 "description": "Rounds before the root", "signal": None, "kind": "conceptual", "maps": [],
                 "aliases": [], "refutation": [{"step": 1, "text_md": "Keep $\\sqrt{92.25}$ exact."},
                                                {"step": 2, "text_md": "Then round: 9,60."}]}
        problems = am.validate_catalogue({"misconceptions": [entry]})
        self.assertTrue(any("decimal comma '9,60'" in p for p in problems), problems)
        entry["refutation"][1]["text_md"] = "Then round: 9.60, the point $C(-2,3)$ unchanged."
        self.assertEqual([p for p in am.validate_catalogue({"misconceptions": [entry]}) if "FR-4308" in p], [])


class S7Catalogue(unittest.TestCase):
    def test_the_author_and_verifier_see_the_draft_before_any_catalogue_is_loaded(self):
        import book_config
        import generate_widget_questions as GW
        fix = HERE / "fixtures" / "families"
        graph = GW.FixtureGraph(json.loads((fix / "widget-graph.json").read_text()))
        book = book_config.Book.model_validate_json((book_config.BOOKS_DIR / "g10-math.json").read_text())
        lo = next(iter(sorted(graph.objectives())))
        draft = {"stage": "draft", "records": [{"lo": lo, "entries": [
            {"id": f"mc:{lo.removeprefix('lo:')}:zz-draft", "lo_id": lo, "label": "ZZ draft error",
             "description": "a draft entry"}]}]}
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "draft.json"
            p.write_text(json.dumps(draft))
            overlaid = GW._with_catalogue(graph, p)
        args = GW.author_args(book, overlaid, "course:us-g10-math-en")
        shown = {m["id"] for o in args["objectives"] for m in o["misconceptions"]}
        self.assertIn(f"mc:{lo.removeprefix('lo:')}:zz-draft", shown)
        self.assertNotIn(f"mc:{lo.removeprefix('lo:')}:zz-draft",
                         {m["id"] for o in GW.author_args(book, graph, "course:us-g10-math-en")["objectives"]
                          for m in o["misconceptions"]}, "without --catalogue the draft is invisible")


class AnswerText(unittest.TestCase):
    def test_a_corrected_key_is_the_answer_text_never_the_printed_answer(self):
        import assemble_lesson_bundle as alb
        import book_config
        fix = HERE / "fixtures" / "g10-math"
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "g10-math"
            shutil.copytree(fix, root)
            rp = root / "runs" / "lesson" / "g10m8s1-1.json"
            run = json.loads(rp.read_text())
            it = next(i for i in run["items"] if i["ref"] == "Ex8-1:2")        # expression, agreed
            key = it["marker"]["key"]
            build = lambda: alb.assemble(book_config.load_book("g10-math"), root / "manifest.json",  # noqa: E731
                                         root / "objectives", root / "runs" / "lesson", None)
            it["printed_answer"] = "PRINTED (1; 2)"
            rp.write_text(json.dumps(run))
            q = next(q for b in build()[0].values() for q in b.get("questions", []) if q["id"].endswith("ex8-1-2"))
            self.assertEqual(q["answer"], "PRINTED (1, 2)", "agreed and untouched at G2: the printed answer")
            it["g2"] = {"verdict": "fix", "by": "Samuel", "note": "book error"}
            rp.write_text(json.dumps(run))
            q = next(q for b in build()[0].values() for q in b.get("questions", []) if q["id"].endswith("ex8-1-2"))
            self.assertEqual(q["answer"], alb.normalise(key)[0], "fixed at G2: the approved key")


if __name__ == "__main__":
    unittest.main()

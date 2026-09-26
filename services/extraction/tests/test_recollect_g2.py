"""Re-collecting a saved lesson run with no model call (recollect_lessons.py), and G2's own inputs:
the draft split (lesson-runs --draft), the dossier's recommendations and the page-export -> G2 file.

    uv run --with pytest python -m pytest -q tests/test_recollect_g2.py

@covers FR-4302

What is pinned:
  * a re-collection reuses a recorded answer only when the current script sends the recorded
    prompt; a changed prompt is refused, never silently reused;
  * a judge verdict is reused only for the same pair id AND the same two answers; any other
    pending pair is reported and stays `unclear` (so its item stays held);
  * a call the recorded run never made is reported as missing, not invented;
  * a draft split lists what G2 still owes, and assembly refuses a draft;
  * the page export becomes G2's file only with a reviewer's name, and a Fix takes the recommended
    fields only when the reviewer chose Fix with no note of their own.
"""

from __future__ import annotations

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

import embed_workflow as E  # noqa: E402
import recollect_lessons as R  # noqa: E402
from test_lesson_collect2 import ALIGN_SOL, base_responses, item, lesson_args, run, typing  # noqa: E402

NODE = shutil.which("node")


def record(tmp: Path, args: dict, responses: dict) -> tuple[dict, Path, Path]:
    """Run the generated copy through the stub and write what a real run leaves behind: the
    saved return value, the journal and one transcript per agent (the harness's frame included)."""
    copies = tmp / "copies"
    copy = copies / "lesson.zz8s2-1.workflow.js"
    E.write(R.LESSON_WF, args, copy)
    rep = R.stub(copy, responses)
    run_dir = tmp / "wf_test"
    run_dir.mkdir()
    rows = []
    for i, c in enumerate(rep["calls"]):
        aid = f"a{i:04d}"
        rows.append({"type": "started", "agentId": aid, "label": c["label"]})
        rows.append({"type": "result", "agentId": aid, "result": c.get("response")})
        framed = ("[Workflow harness — computed task] … " + R.HARNESS_HEAD
                  + "\n".join("  " + line if line else "" for line in c["prompt"].split("\n")))
        (run_dir / f"agent-{aid}.jsonl").write_text(json.dumps({"type": "user", "message": {"role": "user", "content": framed}}) + "\n")
        (run_dir / f"agent-{aid}.meta.json").write_text(json.dumps({"description": c["label"]}))
    (run_dir / "journal.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    saved = dict(rep["result"], run_id="wf_test")
    return saved, run_dir, copies


@unittest.skipUnless(NODE, "node runs the workflow through the stub runtime")
class Recollect(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.items = [item("Ex8-2:1", "Calculate $AB$.", ALIGN_SOL, "6,71"),
                      item("Ex8-2:2", "Find it.", ["$y=2x+7$"], "y = 2x + 7")]
        self.types = [typing("Ex8-2:1", "6,71", "$d_{AB}\\approx\\text{6,71}$"),
                      typing("Ex8-2:2", "y = 2x + 7", "$y=2x+7$", "expression", marker_kind="equation", variables=["x", "y"])]
        self.args = lesson_args(self.items)

    def tearDown(self):
        self._tmp.cleanup()

    def blinds(self, second="y = 7 + 2x"):
        return [{"ref": "Ex8-2:1", "final_answer": "6.71", "markable": True},
                {"ref": "Ex8-2:2", "final_answer": second, "markable": True}]

    def test_the_same_script_reproduces_the_saved_run_and_proves_every_prompt(self):
        judge = {"verdicts": [{"pair_id": "Ex8-2:2|blind~printed", "verdict": "equivalent", "reason": "same line"},
                              {"pair_id": "Ex8-2:2|blind~book", "verdict": "equivalent", "reason": "same line"}]}
        saved, run_dir, copies = record(self.tmp, self.args, base_responses(self.items, self.types, self.blinds(), judge))
        out, prov = R.recollect(saved, R.find_args(saved, copies), run_dir)
        self.assertEqual(R.counts(out), R.counts(saved))
        self.assertEqual([i["verification"] for i in out["lessons"][0]["items"]], ["agreed", "agreed"])
        self.assertTrue(all(c["reused"] for c in prov["calls"]))
        self.assertEqual((prov["judge_pairs_reused"], prov["judge_pairs_unjudged"], prov["missing_calls"]), (2, [], []))
        self.assertEqual(out["run_id"], "wf_test")

    def test_a_changed_prompt_is_refused(self):
        saved, run_dir, copies = record(self.tmp, self.args, base_responses(self.items, self.types, self.blinds("y=2x+7")))
        tr = next(p for p in run_dir.glob("agent-*.meta.json") if "S3:blind" in p.read_text())
        body = tr.with_name(tr.name.replace(".meta.json", ".jsonl"))
        body.write_text(body.read_text().replace("Calculate", "Compute"))
        with self.assertRaisesRegex(R.RecollectError, "prompt\\(s\\) changed"):
            R.recollect(saved, R.find_args(saved, copies), run_dir)

    def test_a_judge_verdict_is_reused_only_for_the_same_two_answers(self):
        judge = {"verdicts": [{"pair_id": "Ex8-2:2|blind~printed", "verdict": "equivalent"},
                              {"pair_id": "Ex8-2:2|blind~book", "verdict": "equivalent"}]}
        saved, run_dir, copies = record(self.tmp, self.args, base_responses(self.items, self.types, self.blinds(), judge))
        # the recorded judge was shown different answers for one pair than today's collection sends
        tr = next(p for p in run_dir.glob("agent-*.meta.json") if "S3:judge" in p.read_text())
        body = tr.with_name(tr.name.replace(".meta.json", ".jsonl"))
        body.write_text(body.read_text().replace("answer 2: $y=2x+7$", "answer 2: $y=2x+9$"))
        out, prov = R.recollect(saved, R.find_args(saved, copies), run_dir)
        self.assertEqual(prov["judge_pairs_unjudged"], ["Ex8-2:2|blind~book"])
        pairs = {p["pair_id"]: p for p in out["lessons"][0]["items"][1]["verify"]["pairs"]}
        self.assertEqual(pairs["Ex8-2:2|blind~book"]["verdict"], "unclear")
        self.assertEqual(out["lessons"][0]["items"][1]["verification"], "disputed")

    def test_a_call_the_recorded_run_never_made_is_reported_missing(self):
        r = base_responses(self.items, self.types, [self.blinds("y=2x+7")[0]])      # the blind batch left Ex8-2:2 out
        r["S3:blind:zz8s2-1:1:again"] = None
        saved, run_dir, copies = record(self.tmp, self.args, r)
        rows = [json.loads(x) for x in (run_dir / "journal.jsonl").read_text().splitlines()]
        again = {x["agentId"] for x in rows if x.get("label", "").endswith(":again")}
        (run_dir / "journal.jsonl").write_text("".join(json.dumps(x) + "\n" for x in rows if x["agentId"] not in again))
        out, prov = R.recollect(saved, R.find_args(saved, copies), run_dir)
        self.assertEqual(prov["missing_calls"], ["S3:blind:zz8s2-1:1:again"])
        self.assertEqual(out["lessons"][0]["verify"]["unchecked"], [{"ref": "Ex8-2:2", "missing": ["no blind re-solve answer"]}])

    def test_a_resumed_run_is_read_by_its_latest_agent_per_label(self):
        """A Workflow resume appends to the same journal: the label run again live has a later agent,
        whose answer (and prompt) is the one the resumed run used."""
        saved, run_dir, copies = record(self.tmp, self.args, base_responses(self.items, self.types, self.blinds("y=2x+9")))
        rows = [json.loads(x) for x in (run_dir / "journal.jsonl").read_text().splitlines()]
        old = next(r for r in rows if r.get("label") == "S3:blind:zz8s2-1:1")
        again = {"answers": [{"ref": "Ex8-2:1", "final_answer": "6.71", "markable": True},
                             {"ref": "Ex8-2:2", "final_answer": "y=2x+7", "markable": True}]}
        rows += [{"type": "started", "agentId": "b9999", "label": "S3:blind:zz8s2-1:1"},
                 {"type": "result", "agentId": "b9999", "result": again}]
        (run_dir / "journal.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
        for ext in (".jsonl", ".meta.json"):
            shutil.copy(run_dir / f"agent-{old['agentId']}{ext}", run_dir / f"agent-b9999{ext}")
        answers, _ = R.journal(run_dir)
        self.assertEqual(answers["S3:blind:zz8s2-1:1"], again)
        out, _ = R.recollect(saved, R.find_args(saved, copies), run_dir)
        self.assertEqual(out["lessons"][0]["items"][1]["blind_answer"], "y=2x+7")

    def test_the_saved_runs_args_must_be_found_exactly(self):
        saved, run_dir, copies = record(self.tmp, self.args, base_responses(self.items, self.types, self.blinds("y=2x+7")))
        saved["embedded"] = dict(saved["embedded"], args_sha256="0" * 64)
        with self.assertRaisesRegex(R.RecollectError, "no generated copy"):
            R.find_args(saved, copies)


class G2Inputs(unittest.TestCase):
    def test_the_page_export_becomes_g2s_file_only_signed_and_fields_only_as_recommended(self):
        import render_review_page as rp
        rec = {"items": {"s:A": {"verdict": "fix", "note": "key 7,2", "fields": {"answer": "7,2"}},
                         "s:B": {"verdict": "fix", "note": "retype", "fields": {"answer_type": "expression"}},
                         "s:C": {"verdict": "hold", "note": "re-solve"}}}
        export = {"reviewer": "Samuel", "verdicts": {"s:A": "fix", "s:B": "fix", "s:C": "accept", "s:D": "fix"},
                  "notes": {"s:B": "use 15/2 instead"}}
        doc, todo = rp.g2_file(export, rec)
        self.assertEqual(doc["by"], "Samuel")
        self.assertEqual(doc["items"]["s:A"]["fields"], {"answer": "7,2"})
        self.assertNotIn("fields", doc["items"]["s:B"], "his own note: his fix, not the recommendation's")
        self.assertEqual(doc["items"]["s:C"], {"verdict": "accept"})
        self.assertEqual([t.split(":")[0] + ":" + t.split(":")[1] for t in todo], ["s:B", "s:D"])
        with self.assertRaisesRegex(ValueError, "no reviewer"):
            rp.g2_file(dict(export, reviewer=" "), rec)

    def test_a_draft_split_lists_what_g2_owes_and_assembly_refuses_it(self):
        import assemble_objectives as ao
        import assemble_lesson_bundle as alb
        it = {"ref": "Ex8-2:1", "kind": "exercise", "lo": "lo:zz8s2-1-1", "stem": "Find it.", "answer_type": "numeric",
              "answer": "-\\frac{1}{2}", "choices": None, "marker": None, "solution": ["$-\\frac{1}{2}$"],
              "solution_provenance": "book_worked_epub", "printed_answer": "−1 2", "epub_final_answer": "-\\frac{1}{2}",
              "blind_answer": "-1/2", "verification": "agreed", "tier": "basic", "printed_page": 1,
              "typing_problems": ['numeric key "-\\frac{1}{2}" is not a number'], "verify": {"pairs": []}}
        run_ = {"prompts_version": "lesson-v4", "collect_version": "collect-3", "stage": "S2-S4,S8", "run_id": "wf_x",
                "lessons": [{"lesson": "zz8s2-1", "claims": [], "items": [it], "visuals": [], "viz_gaps": []}]}
        with self.assertRaises(ao.StageError):
            ao.lesson_runs(run_)
        out = ao.lesson_runs(run_, draft=True)["zz8s2-1"]
        self.assertEqual((out["draft"], out["pending_g2"]), (True, ["zz8s2-1:Ex8-2:1"]))
        self.assertEqual(out["source_run"]["collect_version"], "collect-3")
        run_model = alb.LessonRun.model_validate(out)
        self.assertTrue((run_model.model_extra or {}).get("draft"))
        # assembly refuses a draft: mark the fixture's own run file as one
        import book_config
        fix = HERE / "fixtures" / "g10-math"
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "g10-math"
            shutil.copytree(fix, root)
            rp = root / "runs" / "lesson" / "g10m8s1-1.json"
            rp.write_text(json.dumps(dict(json.loads(rp.read_text()), draft=True)))
            with self.assertRaisesRegex(alb.AssemblyError, "DRAFT"):
                alb.assemble(book_config.load_book("g10-math"), root / "manifest.json", root / "objectives",
                             root / "runs" / "lesson", None)


if __name__ == "__main__":
    unittest.main()

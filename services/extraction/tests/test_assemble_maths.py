"""assemble_maths.py and transcribe-maths.workflow.js (B21, T418, T419): S0b, maths transcription.

    uv run --project services/extraction --with pytest python -m pytest -q services/extraction/tests/test_assemble_maths.py

What FR-4407 asks, tested without a model:
- an image is accepted only by its hash (re-verified, whoever claimed it), by two blind passes agreeing
  after normalisation, by a THIRD blind reading that agrees with one of two passes that did not agree
  (Samuel's answer 11: two of three, never one), or by a named human at G0b; everything else is queued,
  nothing is guessed; an image only an EPUB worked solution prints follows the same rule;
- normalisation removes presentation only, never a symbol;
- the PDF cross-check can contradict an agreement (queued) but not a hash (exact);
- the report counts each route, in the shape the coverage audit reads.
The workflow script runs in tests/workflow_stub.mjs against canned answers (skipped without node), and
its output goes through `assemble`. The real book's deterministic recovery is checked when present.

@covers FR-4407
"""

from __future__ import annotations

import hashlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import _scratchdb  # noqa: F401  (puts services/extraction on sys.path)
import assemble_maths as am
import book_config

EX = Path(am.HERE)
STUB = EX / "tests" / "workflow_stub.mjs"
SCRIPT = EX / "runbook" / "transcribe-maths.workflow.js"
NODE = shutil.which("node")
G10 = book_config.load_book("g10-math")
WORK = G10.work_dir()


def md5(s):
    return hashlib.md5(s.encode()).hexdigest()


class Normalise(unittest.TestCase):
    def test_presentation_differences_agree(self):
        same = [
            ("x = \\text{3}", "x=3"),
            ("\\left(x+1\\right)^{2}", "(x+1)^2"),
            ("\\dfrac{1}{2}", "\\frac{1}{2}"),
            ("a\\le b", "a\\leq b"),
            ("\\text{345,04}", "345{,}04"),
            ("30°", "30^{\\circ}"),
            ("\\begin{align*}x&=2\\\\y&=3\\end{align*}", "x=2\\\\y=3"),
            ("\\displaystyle x\\,+\\;y", "x+y"),
        ]
        for a, b in same:
            self.assertEqual(am.normalise(a), am.normalise(b), (a, b))

    def test_a_different_symbol_never_agrees(self):
        differ = [("x=3", "x=8"), ("x+1", "x-1"), ("(x;y)", "(x,y)"), ("\\text{3,5}", "\\text{3.5}"),
                  ("x^{2}", "x_{2}"), ("\\sin\\theta", "\\cos\\theta"), ("a<b", "a\\leq b"), ("2x", "x2")]
        for a, b in differ:
            self.assertNotEqual(am.normalise(a), am.normalise(b), (a, b))


class CrossCheck(unittest.TestCase):
    def test_signature_keeps_digits_letters_and_greek(self):
        self.assertEqual(am.signature("\\frac{\\text{12}}{x^{2}}+\\pi"), "12x2π")
        self.assertEqual(am.signature("\\mathbb{R}"), "R")
        self.assertEqual(am.signature("\\begin{align*}y&=2\\end{align*}"), "y2")

    def test_the_window_is_order_free_but_local(self):
        # the text layer puts a fraction's numerator and denominator on their own lines
        self.assertTrue(am.window_contains("Solve1x2forthevalue", "x12"))
        self.assertFalse(am.window_contains("x" + "q" * 200 + "12", "x12"))
        self.assertFalse(am.window_contains("x1", "x12"))


class Recovery(unittest.TestCase):
    def test_only_exact_hashes_are_kept_and_whitespace_is_stripped_too(self):
        targets = {md5("x=\\text{3}"), md5("(A\\cupB)'")}
        r = am.Recoverer(targets)
        r.offer("x=\\text{4}", "t")
        r.offer("(A\\cup B)'", "t")          # hashed as the source was: spaces removed
        r.offer("x=\\text{3}", "t")
        self.assertEqual(sorted(x["latex"] for x in r.found.values()), ["(A\\cupB)'", "x=\\text{3}"])

    def test_a_pdf_line_linearises_with_scripts_and_both_number_styles(self):
        # "x² = 25" set in Computer Modern: base x, superscript 2 (small, raised), then "= 25"
        fonts = ["CMMI10", "CMR7", "CMR10"]
        spans = [[0, 10.0, 0, 5, 100.0, "x"], [1, 7.0, 5, 8, 96.0, "2"], [2, 10.0, 9, 30, 100.0, "= 25"]]
        scan = {"fonts": fonts, "page_spans": [[[0, spans]]]}
        for latex in ("x^{2}=25", "x^{2}=\\text{25}", "{x}^{2}=25", "x^2=25"):
            r = am.Recoverer({md5(latex)})
            am.gen_pdf_lines(r, scan)
            self.assertEqual([x["latex"] for x in r.found.values()], [latex])


def mini_work(tmp: Path, images: dict) -> Path:
    """A work/<book>/ with equations.json and a one-page scan. images: md5 → (class, printed_pages)."""
    w = tmp / "work"
    (w / "maths").mkdir(parents=True)
    eqs = {h: {"refs": 1, "contexts": {}, "blocks": ["b00001"], "printed_pages": pp, "class": cls, "size": [40, 20],
               "bytes": 1} for h, (cls, pp) in images.items()}
    (w / "equations.json").write_text(json.dumps({"images": eqs, "unreferenced_in_zip": []}))
    # printed page 1 = PDF 12 for G10's offset (11): its text layer holds "x = 35" and nothing with a 9
    pages = [[] for _ in range(20)]
    pages[11] = [[0, [[0, 10.0, 0, 10, 100.0, "Here x = 35 and y 2 appear on the page"]]]]
    (w / "pdf_scan.json").write_text(json.dumps({"fonts": ["URWClassico-Regular"], "page_spans": pages}))
    return w


class Assemble(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def run_assemble(self, images, runs, recovered=None, human=None):
        w = mini_work(self.tmp, images)
        if recovered:
            (w / "maths" / "recovered.json").write_text(json.dumps({"accepted": recovered}))
        paths = []
        for i, run in enumerate(runs):
            p = self.tmp / f"run{i}.json"
            p.write_text(json.dumps(run))
            paths.append(p)
        hp = None
        if human:
            hp = self.tmp / "human.json"
            hp.write_text(json.dumps(human))
        return am.assemble(G10, w, paths, hp)

    def test_every_route_and_the_queue(self):
        H = {k: md5(k) for k in ("x=3", "y^{2}")}
        agree, disagree, contra, onlya, human, tg = ("a" * 32, "b" * 32, "c" * 32, "d" * 32, "e" * 32, "f" * 32)
        images = {H["x=3"]: ("printed", [1]), H["y^{2}"]: ("solution_only", []), agree: ("printed", [1]),
                  disagree: ("printed", [1]), contra: ("printed", [1]), onlya: ("solution_only", []),
                  human: ("printed", [1]), tg: ("teacher_only", [])}
        runA = {"pass": "A", "results": [
            {"md5": H["y^{2}"], "pass": "A", "latex": "y^{2}"},            # hashes: accepted by hash, found by A
            {"md5": agree, "pass": "A", "latex": "x = \\text{35}"},
            {"md5": disagree, "pass": "A", "latex": "x=3"},
            {"md5": contra, "pass": "A", "latex": "x=97"},
            {"md5": onlya, "pass": "A", "latex": "z"},
            {"md5": human, "pass": "A", "latex": "q", "status": "transcribed"}]}
        runB = {"pass": "B", "results": [
            {"md5": agree, "pass": "B", "latex": "x=35"},
            {"md5": disagree, "pass": "B", "latex": "x=8"},
            {"md5": contra, "pass": "B", "latex": "x = 97"},
            {"md5": onlya, "pass": "B", "latex": None, "status": "unreadable"}]}
        res = self.run_assemble(images, [runA, runB],
                                recovered={H["x=3"]: {"latex": "x=3", "accepted_by": "hash"}},
                                human={human: {"latex": "q=1", "by": "Samuel", "date": "2026-09-26"}})
        acc, q, s = res["accepted"], {x["md5"]: x for x in res["queue"]}, res["summary"]
        self.assertEqual((acc[H["x=3"]]["accepted_by"], acc[H["x=3"]]["found_by"]), ("hash", "recover"))
        self.assertEqual((acc[H["y^{2}"]]["accepted_by"], acc[H["y^{2}"]]["found_by"]), ("hash", "A"))
        self.assertEqual((acc[agree]["accepted_by"], acc[agree]["cross_check"]), ("agreement", "consistent"))
        self.assertEqual((acc[human]["accepted_by"], acc[human]["by"]), ("human", "Samuel"))
        self.assertEqual(q[disagree]["reason"], "the two passes disagree")
        self.assertIn("contradicts", q[contra]["reason"], "both passes agree on a 97 the page does not print")
        self.assertEqual(q[onlya]["reason"], "only one pass read it")
        self.assertNotIn(tg, acc)
        self.assertNotIn(tg, q)
        self.assertEqual({k: s[k] for k in ("unique", "accepted_by_hash", "accepted_by_agreement", "resolved_at_g0b",
                                            "unresolved")},
                         {"unique": 8, "accepted_by_hash": 2, "accepted_by_agreement": 1, "resolved_at_g0b": 1,
                          "unresolved": 3})
        self.assertEqual(s["teacher_only_not_transcribed"], 1)
        self.assertFalse(s["complete"])

    def test_the_third_reading_decides_only_as_two_of_three(self):
        dis_b, one_a, neither, sol, agreed = ("a" * 32, "b" * 32, "c" * 32, "d" * 32, "e" * 32)
        images = {dis_b: ("printed", [1]), one_a: ("printed", [1]), neither: ("printed", [1]),
                  sol: ("solution_only", []), agreed: ("printed", [1])}
        runA = {"pass": "A", "results": [
            {"md5": dis_b, "latex": "x=3"}, {"md5": one_a, "latex": "x=35"}, {"md5": neither, "latex": "x=1"},
            {"md5": sol, "latex": "k=2"}, {"md5": agreed, "latex": "y2"}]}
        runB = {"pass": "B", "results": [
            {"md5": dis_b, "latex": "x = 35"}, {"md5": one_a, "latex": None, "status": "unreadable"},
            {"md5": neither, "latex": "x=2"}, {"md5": sol, "latex": "k=7"}, {"md5": agreed, "latex": "y 2"}]}
        # C reads only what A and B did not agree on; it is never asked about `agreed`
        runC = {"pass": "C", "results": [
            {"md5": dis_b, "latex": "x=\\text{35}"},      # sides with B after normalisation
            {"md5": one_a, "latex": "x=35"},              # sides with A, the only pass that read it
            {"md5": neither, "latex": "x=9"},             # agrees with neither: G0b
            {"md5": sol, "latex": "k=2"}]}                # a solution-only image, same rule
        res = self.run_assemble(images, [runA, runB, runC])
        acc, q, s = res["accepted"], {x["md5"]: x for x in res["queue"]}, res["summary"]
        self.assertEqual((acc[dis_b]["accepted_by"], acc[dis_b]["sided_with"]), ("third_reading", "B"))
        self.assertEqual((acc[one_a]["accepted_by"], acc[one_a]["sided_with"]), ("third_reading", "A"))
        self.assertEqual((acc[sol]["accepted_by"], acc[sol]["cross_check"]), ("third_reading", "not_printed"))
        self.assertEqual(acc[agreed]["accepted_by"], "agreement")
        self.assertIn("agrees with neither", q[neither]["reason"])
        self.assertEqual(q[neither]["C"], "x=9")
        self.assertEqual((s["accepted_by_third_reading"], s["accepted_by_agreement"], s["unresolved"]), (3, 1, 1))
        self.assertEqual(s["to_transcribe"], sum(s[k] for k in am.ROUTE_KEYS) + s["unresolved"])
        self.assertEqual(s["routes_by_class"]["solution_only"]["accepted_by_third_reading"], 1)
        self.assertEqual(s["by_chapter"], {}, "the mini work dir has no blocks.jsonl, so no chapter is known")

    def test_the_third_reading_queue_is_only_what_a_and_b_did_not_agree_on(self):
        eqs = {h: {"class": "printed", "size": [10, 10], "refs": 1} for h in ("a" * 32, "b" * 32, "c" * 32,
                                                                             "d" * 32, "e" * 32)}
        eqs["f" * 32] = {"class": "teacher_only", "size": [10, 10], "refs": 1}
        runs = {"by_pass": {"A": {"a" * 32: "x", "b" * 32: "x", "c" * 32: "x", "f" * 32: "t"},
                            "B": {"a" * 32: "x", "b" * 32: "y", "d" * 32: "z", "f" * 32: "u"},
                            "C": {"c" * 32: "x"}}}
        q = am.third_reading_queue(eqs, {"e" * 32: {}}, runs)
        # a: A = B; b: they differ; c: only A, but C has read it already; d: only B; e: hash; f: teacher
        self.assertEqual([x["md5"] for x in q], ["b" * 32, "d" * 32])

    def test_counts_per_chapter_from_the_blocks(self):
        one, two = "a" * 32, "b" * 32
        w = mini_work(self.tmp, {one: ("printed", [1]), two: ("solution_only", [])})
        eqs = json.loads((w / "equations.json").read_text())
        eqs["images"][two]["blocks"] = ["b00002"]
        (w / "equations.json").write_text(json.dumps(eqs))
        (w / "blocks.jsonl").write_text(json.dumps({"id": "b00001", "type": "para", "chapter": 8}) + "\n"
                                        + json.dumps({"id": "b00002", "type": "para", "chapter": 9}) + "\n")
        p = self.tmp / "r.json"
        p.write_text(json.dumps({"pass": "A", "results": [{"md5": one, "latex": "q"}]}))
        s = am.assemble(G10, w, [p], None)["summary"]
        self.assertEqual(s["by_chapter"]["8"]["unresolved"], 1)
        self.assertEqual(s["by_chapter"]["9"]["unresolved"], 1)
        self.assertEqual(am.chapter_images(w, {9}), {two})

    def test_a_claimed_hash_is_reverified_and_a_wrong_one_is_not_accepted(self):
        h = md5("x=3")
        runA = {"pass": "A", "results": [{"md5": h, "latex": "x=4", "hash_match_claimed": True}]}
        runB = {"pass": "B", "results": [{"md5": h, "latex": "x=5"}]}
        res = self.run_assemble({h: ("solution_only", [])}, [runA, runB],
                                recovered={h: {"latex": "x=7", "accepted_by": "hash"}})   # a corrupted recovered map
        self.assertEqual(res["accepted"], {})
        self.assertEqual(res["queue"][0]["reason"], "the two passes disagree")

    def test_an_aligned_derivation_is_proven_by_the_books_hash_form_and_stored_with_a_real_amp(self):
        """S0b (COLLECT-2 round): the book names an aligned derivation's image md5(its lines, no
        environment, `&` written `&amp;`). A pass that reads it as align* is accepted BY HASH, and a pass
        that copies the entity is stored as real `&` inside align* — never an entity in accepted.json."""
        h = md5("c&amp;=5+4\\\\c&amp;=9")
        runA = {"pass": "A", "results": [{"md5": h, "latex": "\\begin{align*}c &= 5+4\\\\c &= 9\\end{align*}"}]}
        runB = {"pass": "B", "results": [{"md5": h, "latex": "c&amp;=5+4\\\\c&amp;=9"}]}
        acc = self.run_assemble({h: ("solution_only", [])}, [runA, runB])["accepted"]
        self.assertEqual(acc[h]["accepted_by"], "hash")
        self.assertNotIn("&amp;", acc[h]["latex"])
        self.assertTrue(acc[h]["latex"].startswith("\\begin{align*}"))

    def test_a_pass_that_contradicts_itself_does_not_count(self):
        h = "a" * 32
        runs = [{"pass": "A", "results": [{"md5": h, "latex": "x"}]}, {"pass": "A", "results": [{"md5": h, "latex": "y"}]},
                {"pass": "B", "results": [{"md5": h, "latex": "x"}]}]
        res = self.run_assemble({h: ("solution_only", [])}, runs)
        self.assertEqual(res["accepted"], {})
        self.assertEqual(res["summary"]["self_disagreements"]["A"], [h])

    def test_a_human_resolution_must_name_who(self):
        h = "a" * 32
        with self.assertRaises(SystemExit):
            self.run_assemble({h: ("printed", [1])}, [], human={h: {"latex": "x"}})

    def test_the_vision_queue_skips_accepted_and_teacher_only(self):
        eqs = {"a" * 32: {"class": "printed", "size": [10, 10], "refs": 1},
               "b" * 32: {"class": "teacher_only", "size": [10, 10], "refs": 1},
               "c" * 32: {"class": "solution_only", "size": [10, 200], "refs": 1},
               "d" * 32: {"class": "printed", "size": [10, 10], "refs": 1}}
        q = am.vision_queue(eqs, {"d" * 32: {}})
        self.assertEqual([x["md5"] for x in q], ["a" * 32, "c" * 32])

    def test_md5check_prints_the_matching_candidate(self):
        lines = json.dumps({"md5": md5("k^{2}"), "candidates": ["k^2", "k^{2}"]}) + "\n" + \
            json.dumps({"md5": md5("z"), "candidates": ["y"]}) + "\n"
        old = sys.stdin
        sys.stdin = io.StringIO(lines)
        buf = io.StringIO()
        try:
            with redirect_stdout(buf):
                am.main(["md5check"])
        finally:
            sys.stdin = old
        out = [json.loads(l) for l in buf.getvalue().splitlines()]
        self.assertEqual([o["match"] for o in out], ["k^{2}", None])

    def test_image_tokens_follow_the_api_resize(self):
        self.assertEqual(am.image_tokens(150, 50, 1), 10)
        self.assertEqual(am.image_tokens(150, 50, 2), 40)
        self.assertLessEqual(am.image_tokens(400, 4000, 2), 1_150_000 // 750 + 1, "tall images are scaled down")


@unittest.skipUnless(NODE, "node is needed to run the workflow script in the stub runtime")
class WorkflowScript(unittest.TestCase):
    def run_stub(self, args, responses):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"args": args, "responses": responses}, f)
        r = subprocess.run([NODE, str(STUB), str(SCRIPT), f.name], capture_output=True, text=True, timeout=60)
        Path(f.name).unlink()
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def args(self, n=3, batch=2):
        imgs = [{"md5": md5(f"v{i}"), "path": f"/w/equations/{md5(f'v{i}')}.png", "w": 20, "h": 10} for i in range(n)]
        return {"book": {"book": "g10-math", "maths_source": "epub-images-md5"}, "pass": ["A", "B"], "batch": batch,
                "images": imgs, "md5check": "uv run assemble_maths.py md5check"}

    def test_two_blind_passes_per_batch_and_a_result_assemble_reads(self):
        a = self.args()
        ims = a["images"]
        ans = lambda batch, latex: {"results": [{"md5": im["md5"], "status": "transcribed", "latex": latex(i)}
                                                for i, im in batch]}
        responses = {
            "A-b0001": ans(list(enumerate(ims[:2])), lambda i: f"v{i}"),
            "A-b0002": ans([(2, ims[2])], lambda i: "x=1"),
            "B-b0001": {"results": [{"md5": ims[0]["md5"], "status": "transcribed", "latex": "v0"},
                                    {"md5": ims[1]["md5"], "status": "unreadable", "latex": "", "note": "smudge"},
                                    {"md5": "f" * 32, "status": "transcribed", "latex": "stray"}]},
            "B-b0002": None,     # an agent that died
        }
        out = self.run_stub(a, responses)
        self.assertTrue(out["ok"], out.get("error"))
        labels = [c["label"] for c in out["calls"]]
        self.assertEqual(sorted(labels), ["A-b0001", "A-b0002", "B-b0001", "B-b0002"])
        self.assertTrue(all(c["model"] == "sonnet" for c in out["calls"]))
        promptB = next(c["prompt"] for c in out["calls"] if c["label"] == "B-b0001")
        self.assertNotIn('"v0"', promptB, "pass B never sees pass A's answers")
        res = out["result"]
        self.assertEqual(res["stage"], "S0b")
        rows = {(r["pass"], r["md5"]): r for r in res["results"]}
        self.assertEqual(rows[("B", ims[1]["md5"])]["latex"], None)
        self.assertEqual(rows[("B", ims[2]["md5"])]["status"], "missing")
        self.assertNotIn(("B", "f" * 32), rows, "an md5 the agent was not given is dropped")
        self.assertTrue(any("not given" in p for p in res["problems"]))
        # the run feeds assemble: image 0 by hash (A read md5('v0') as 'v0'), image 2 queued (one pass)
        tmp = Path(tempfile.mkdtemp())
        w = mini_work(tmp, {im["md5"]: ("solution_only", []) for im in ims})
        p = tmp / "run.json"
        p.write_text(json.dumps(res))
        got = am.assemble(G10, w, [p], None)
        self.assertEqual(got["summary"]["accepted_by_hash"], 2)       # v0 and v1 hash (A read them right)
        self.assertEqual([q["md5"] for q in got["queue"]], [ims[2]["md5"]])

    def test_the_third_reading_is_its_own_blind_pass(self):
        a = self.args(n=2, batch=2)
        a["pass"] = "C"
        ims = a["images"]
        out = self.run_stub(a, {"C-b0001": {"results": [{"md5": ims[0]["md5"], "status": "transcribed", "latex": "v0"},
                                                        {"md5": ims[1]["md5"], "status": "unreadable", "latex": ""}]}})
        self.assertTrue(out["ok"], out.get("error"))
        self.assertEqual([(c["label"], c["phase"]) for c in out["calls"]], [("C-b0001", "Pass C")])
        self.assertIn("REGION BY REGION", out["calls"][0]["prompt"])
        self.assertEqual(out["result"]["pass"], "C")
        mixed = self.args()
        mixed["pass"] = ["A", "C"]
        self.assertIn("runs alone", self.run_stub(mixed, {})["error"])

    def test_bad_args_fail_before_any_agent(self):
        a = self.args()
        a["book"]["maths_source"] = None
        out = self.run_stub(a, {})
        self.assertFalse(out["ok"])
        self.assertIn("maths_source", out["error"])
        a = self.args()
        a["images"][0]["path"] = "/w/other.png"
        self.assertIn("args.images", self.run_stub(a, {})["error"])


@unittest.skipUnless((WORK / "maths" / "recovered.json").exists(),
                     "run `uv run assemble_maths.py recover g10-math` first (needs the adapter's outputs)")
class Grade10Recovery(unittest.TestCase):
    def test_every_recovered_image_hashes_and_the_counts_add_up(self):
        d = json.loads((WORK / "maths" / "recovered.json").read_text())
        s, acc = d["summary"], d["accepted"]
        for h, a in acc.items():
            self.assertEqual(md5(a["latex"]), h)
            self.assertEqual(a["accepted_by"], "hash")
        q = json.loads((WORK / "maths" / "vision-queue.json").read_text())
        self.assertEqual(s["unique"], 8561)
        self.assertEqual(s["accepted_by_hash"] + len(q) + s["teacher_only_skipped"], s["unique"])
        self.assertGreaterEqual(s["accepted_by_hash"], 583, "at least the S0 report's reproductions")
        self.assertLessEqual(s["cross_check_of_hash_acceptances"].get("contradicted", 0), 10,
                             "the cross-check barely ever contradicts an exact hash")


if __name__ == "__main__":
    unittest.main()

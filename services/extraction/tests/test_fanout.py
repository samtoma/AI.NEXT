"""The Grade 10 fan-out driver (fanout.py): the schedule's rules, the S0b partition, the plan's shape.

    uv run --with pytest python -m pytest -q tests/test_fanout.py

The schedule tests are synthetic. The partition and plan tests read the book's real working files
(work/g10-math/, gitignored) and are skipped where they are absent (CI).
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
EX = HERE.parent
if str(EX) not in sys.path:
    sys.path.insert(0, str(EX))

import fanout as F  # noqa: E402

HAVE_WORK = (F.WORK / "blocks.jsonl").exists() and (F.WORK / "maths" / "recovered.json").exists() \
    and (F.PILOT_SEED / "g10m-c08.json").exists()


def overlaps(runs: list[dict]) -> int:
    """The most runs at once in a simulated schedule."""
    ev = sorted([(r["sim_start_min"], 1) for r in runs] + [(r["sim_end_min"], -1) for r in runs],
                key=lambda x: (x[0], x[1]))
    cur = best = 0
    for _, d in ev:
        cur += d
        best = max(best, cur)
    return best


class Schedule(unittest.TestCase):
    def runs(self):
        mk = lambda rid, pri, deps=(), s0b=False, minutes=10: {"id": rid, "priority": pri, "depends_on": list(deps),
                                                               "s0b": s0b, "minutes": minutes}
        return [mk("a1", 2, s0b=True), mk("b1", 2, ["a1"], s0b=True), mk("a2", 2, ["b1"], s0b=True),
                mk("s1", 1, ["b1"]), mk("l1", 3, ["s1"], minutes=30), mk("l2", 3, ["s1"], minutes=30),
                mk("l3", 3, ["s1"], minutes=30), mk("x", 0)]

    def test_lanes_dependencies_and_one_s0b_at_a_time(self):
        rs = self.runs()
        sch = F.schedule(rs, lanes=2)
        by = {r["id"]: r for r in rs}
        self.assertEqual(sorted(sch["order"]), sorted(by))
        self.assertLessEqual(overlaps(rs), 2)
        for r in rs:
            for d in r["depends_on"]:
                self.assertGreaterEqual(r["sim_start_min"], by[d]["sim_end_min"], f"{r['id']} starts before {d} ends")
        s0b = [r for r in rs if r["s0b"]]
        self.assertLessEqual(overlaps(s0b), 1, "two S0b passes ran at once")
        self.assertEqual(sch["order"][0], "x", "the highest priority runs first")

    def test_a_cycle_is_reported_not_looped(self):
        rs = [{"id": "p", "priority": 1, "depends_on": ["q"], "minutes": 1},
              {"id": "q", "priority": 1, "depends_on": ["p"], "minutes": 1}]
        with self.assertRaises(SystemExit):
            F.schedule(rs)


@unittest.skipUnless(HAVE_WORK, "needs the book's working files (work/g10-math/, gitignored)")
class RealBook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.part = F.s0b_partition()
        cls.inv = F.inventory()
        cls.plan = F.plan()

    def test_partition_reads_every_remaining_image_once_and_nothing_of_chapter_8(self):
        q = {x["md5"] for x in self.part["queue"]}
        parts = [x["md5"] for xs in self.part["by_chapter"].values() for x in xs]
        self.assertEqual(len(parts), len(set(parts)))
        self.assertEqual(set(parts), q)
        self.assertNotIn(F.PILOT_CH, self.part["by_chapter"])
        self.assertFalse(q & set(self.part["pilot_accepted"]), "an image Chapter 8 already accepted would be read again")
        groups = [c for _, chs in F.S0B_GROUPS for c in chs]
        self.assertEqual(sorted(groups), F.FANOUT_CHS)
        self.assertEqual(sum(g["images"] for g in self.inv["s0b"]["groups"]), len(q))

    def test_the_plan_starts_with_the_two_chapter_8_runs_and_never_reruns_chapter_8(self):
        runs = self.plan["runs"]
        self.assertEqual([r["id"] for r in runs[:2]], ["s6-author-ch08-s111", "wcheck-ch08"])
        ch8 = [r["id"] for r in runs if r.get("chapter") == 8 or 8 in (r.get("chapters") or [])]
        self.assertEqual(sorted(ch8), ["s6-author-ch08-s111", "wcheck-ch08"])
        pilot_files = {"runs/g10-math/maths/accepted.json", "runs/g10-math/g2.json", "runs/g10-math/assembly-report.json",
                       "seed/generated/g10-math/misconceptions.json", "seed/generated/g10-math/generated-questions.json",
                       "seed/generated/g10-math/widget-questions.json"}
        text = json.dumps(runs)
        for f in pilot_files:
            self.assertNotIn(f" --out {f}", text)
            self.assertNotIn(f"--out-dir {Path(f).parent} ", text.replace("runs/g10-math/maths/book", "BOOK"))

    def test_the_auto_passed_gates_sign_as_the_console_reads_them_and_g2_never_writes_the_pilots_file(self):
        """The console (review-gate-records.ts isAutoPassStamp) and review_policy.is_auto read only a stamp that starts
        "auto-pass ": a G1 approval signed "AI auto-pass …" would be a person's review in the console's eyes."""
        import re
        import review_policy
        text = json.dumps(self.plan["runs"])
        # the stamp is auto_pass_gates.py's own (approve_argv, tests/test_typing_seam.py); no command in the plan spells another
        for st in re.findall(r'--by \\"([^"\\]+)\\"', text):
            self.assertTrue(review_policy.is_auto(st), st)
        self.assertNotIn("AI auto-pass", text)
        by = {r["id"]: r for r in self.plan["runs"]}
        # G1 is the auto-pass command itself, with the book's own maths
        s1 = " ".join(by["s1-ch01"]["after"])
        self.assertIn("auto_pass_gates.py g1 g10-math --chapter 1 --maths runs/g10-math/maths/book/accepted.json --approve", s1)
        # G2 is run once per chapter with every lesson's run, into the chapter's own file
        asm = " ".join(by["wcheck-ch01"]["before"])
        self.assertIn("auto_pass_gates.py g2 g10-math --chapter 1", asm)
        self.assertIn("--into runs/g10-math/g2-ch01.json --split", asm)
        self.assertNotIn("--into runs/g10-math/g2.json", asm)
        self.assertEqual(asm.count("--lesson-run"), sum(1 for r in self.plan["runs"] if r["stage"] == "S2-S4" and r["chapter"] == 1))

    def test_the_working_checks_are_two_batched_passes_costed_from_the_chapter_8_measurements(self):
        """sw-v1 metered $31.0 / 192 = $0.161 a solution against a plan of $0.03-0.05; the plan now runs two independent
        sw-v3 passes (batch 5, effort high, the second reshuffled) whose flags are unioned."""
        import working_check as W
        sw = {r["id"]: r for r in self.plan["runs"] if r["stage"] == "SW"}
        self.assertEqual(sorted(sw), sorted(["wcheck-ch08"] + [f"wcheck-ch{c:02d}" for c in F.FANOUT_CHS]))
        self.assertEqual((W.BATCH, W.EFFORT, W.PASSES), (5, "high", ("A", "B")))
        lo, hi = F.UNIT_COST["sw_solution"]
        self.assertEqual((lo, hi), (round(2 * W.SW_PASS_COST_PER_SOLUTION[0], 3), round(2 * W.SW_PASS_COST_PER_SOLUTION[1], 3)))
        self.assertLess(hi, W.MEASURED_SW_V1_PER_SOLUTION / 2, "two passes must still cost under half of one agent per solution")
        sols = {c["chapter"]: c["solutions"] for c in self.inv["chapters"]}
        for ch in F.FANOUT_CHS:
            r = sw[f"wcheck-ch{ch:02d}"]
            self.assertIn("sw-v3", r["workflow"], r["id"])
            self.assertEqual(r["agents"], W.agents_for(sols[ch], passes=2), r["id"])
            self.assertAlmostEqual(r["cost"][1], round(hi * sols[ch], 2), places=1, msg=r["id"])
            self.assertIn("<pass A|B>", r["save_to"])
            self.assertIn("wcheck-ch%02d-B.args.json" % ch, " ".join(r["after"]), "collect must name both passes' args")
        ch8 = sw["wcheck-ch08"]
        self.assertIn("sw-v1", ch8["workflow"])
        self.assertIn("wf_957393ec-d74", ch8["workflow"])
        self.assertIn("BESIDE", ch8["what"])
        self.assertIn("ch08.sw3.flags.json", " ".join(ch8["after"]))                # never over the sw-v1 record
        self.assertLessEqual(self.plan["cost_usd"]["by_stage"]["SW"][1], hi * (sum(sols.values()) + 1))

    def test_a_chapter_8_re_run_is_built_beside_the_sw_v1_packet_never_over_it(self):
        old = F.PACKETS
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            F.PACKETS = tmp / "packets"
            try:
                run = dict(F._run("wcheck-ch08"))
                self.assertTrue(run["embedded_script"].endswith("-wcheck-ch08-v2.workflow.js"), run["embedded_script"])
                out = F.prep_wcheck(dict(run, embedded_script=str(tmp / Path(run["embedded_script"]).name)))
            finally:
                F.PACKETS = old
            self.assertTrue((tmp / "packets" / "wcheck-ch08-v2" / "s" / "0001.txt").exists())
            self.assertTrue((tmp / "packets" / "wcheck-ch08-v2-B" / "s" / "0001.txt").exists())
            self.assertFalse((tmp / "packets" / "wcheck-ch08").exists(), "the sw-v1 packet's name must stay untouched")
            self.assertTrue((tmp / "packets" / "wcheck-ch08-v2.args.json").exists())
            self.assertTrue((tmp / "packets" / "wcheck-ch08-v2-B.args.json").exists())
            a = json.loads((tmp / "packets" / "wcheck-ch08-v2.args.json").read_text())
            b = json.loads((tmp / "packets" / "wcheck-ch08-v2-B.args.json").read_text())
            self.assertEqual((a["pass_id"], a["order"], b["pass_id"], b["order"]), ("A", "bundle", "B", "shuffled"))
            self.assertEqual(sorted(a["solutions"]), sorted(b["solutions"]))
            self.assertNotEqual(a["solutions"], b["solutions"])
            self.assertTrue(out["script"].endswith("-wcheck-ch08-v2.workflow.js"), out["script"])
            self.assertTrue(out["passes"]["B"][0].endswith("-wcheck-ch08-v2-B.workflow.js"), out["passes"])
            self.assertNotIn("-v2-v2", json.dumps(out["passes"]))
            for scripts in out["passes"].values():
                self.assertTrue(Path(scripts[0]).exists() or (tmp / Path(scripts[0]).name).exists())
            self.assertFalse((tmp / "002-wcheck-ch08.workflow.js").exists())

    def test_every_run_says_where_to_save_and_how_to_meter(self):
        for r in self.plan["runs"]:
            self.assertIn("<wf_id>", r["save_to"], r["id"])
            self.assertTrue(r["meter"].startswith(f"uv run meter_run.py record --book {F.BOOK} --stage "), r["id"])
            self.assertIn("--resumed", r["meter"])
            self.assertTrue(r["embedded_script"].startswith("work/g10-math/packets/embedded/fanout/"))
            self.assertRegex(Path(r["embedded_script"]).name, r"^\d{3}-")

    def test_s1_goes_chapter_by_chapter_and_lessons_wait_for_their_chapters_g1(self):
        by = {r["id"]: r for r in self.plan["runs"]}
        s1 = [r for r in self.plan["runs"] if r["stage"] == "S1"]
        self.assertEqual([r["chapter"] for r in s1], F.FANOUT_CHS)
        for a, b in zip(s1, s1[1:]):
            self.assertIn(a["id"], b["depends_on"])
        first = f"ch{F.FANOUT_CHS[0]:02d}"
        for r in self.plan["runs"]:
            if r["stage"] == "S2-S4":
                own = [f"s1-ch{r['chapter']:02d}"]
                # the go / no-go: every other chapter's lessons wait for the first chapter end to end
                want = own if r["chapter"] == F.FANOUT_CHS[0] else own + [f"s5-final-{first}"]
                self.assertEqual(r["depends_on"], want)
                self.assertGreater(r["order"], by[f"s1-ch{r['chapter']:02d}"]["order"])
        self.assertTrue(by[f"s5-final-{first}"]["checkpoint"])
        self.assertLess(by[f"s5-final-{first}"]["order"], 50, "chapter 1's go / no-go comes early in the plan")

    def test_two_runs_at_a_time_and_one_s0b(self):
        self.assertLessEqual(overlaps(self.plan["runs"]), 2)
        self.assertLessEqual(overlaps([r for r in self.plan["runs"] if r.get("s0b")]), 1)

    def test_the_s111_parent_candidates_are_its_teaching_items(self):
        items = F._teaching_items_s111()
        self.assertEqual(len(items), 6)
        for q in items:
            self.assertTrue(q["id"].startswith("q:g10m8s1-1-1:"))
            self.assertTrue(q["teaching_only"])
            self.assertTrue(q["library_entry"].startswith("expl:g10m8s1-1-1:"))
            self.assertTrue(q["figures"] and all(Path(f).exists() for f in q["figures"]))


class Specs(unittest.TestCase):
    def test_write_specs_never_overwrites(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            run = t / "author.json"
            spec = {"id": "tpl:g10m1s3-1-1:convert", "lo_id": "lo:g10m1s3-1-1"}
            run.write_text(json.dumps({"records": [{"lo_id": "lo:g10m1s3-1-1", "families": [spec]}]}))
            out = F.write_specs(run, t / "fam")
            self.assertEqual([p.name for p in out], ["g10m1s3-1-1--convert.json"])
            with self.assertRaises(SystemExit):
                F.write_specs(run, t / "fam")

    def test_a_chapter_config_needs_its_assembled_bundles(self):
        if (F.HERE / "seed" / F.BOOK / "g10m-c01.json").exists():
            self.skipTest("chapter 1 is assembled")
        with self.assertRaises(F.NotReady):
            F.write_config(1)


if __name__ == "__main__":
    unittest.main()

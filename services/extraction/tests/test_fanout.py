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
        for r in self.plan["runs"]:
            if r["stage"] == "S2-S4":
                self.assertEqual(r["depends_on"], [f"s1-ch{r['chapter']:02d}"])
                self.assertGreater(r["order"], by[f"s1-ch{r['chapter']:02d}"]["order"])

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

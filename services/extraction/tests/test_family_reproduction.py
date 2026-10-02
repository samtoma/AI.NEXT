"""The declarative format reproduces the Prep-3 generated bank (decision 16 proof).

@covers FR-4304

Samuel's condition on decision 16: express hand-written families in the new spec
and show the instances are identical, or explain each difference. Ten of the 35
are expressed in families/prep3-math-en/. This module proves, against the bank
production loads (seed/generated/generated-questions.json, the export):

1. each spec produces its hand-written twin's items exactly, every field, except
   misconception ids, which map one-to-one onto the catalogue's ids by the
   catalogue's own aliases (the FR-1115 fold that happened when the bank loaded);
2. spliced into the registry in place of their twins, the ten specs' 153 items
   equal the committed bank field for field — option order, keys and misconception
   ids included — and every other item differs from it only by that same fold;
3. the 35 hand-written families are unchanged: their output is byte-identical to
   the output recorded before this work (sha256 below).

    uv run --with pytest python -m pytest -q tests/test_family_reproduction.py
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import _scratchdb  # noqa: F401
import generate_questions as G
from families import spec as FS

EX = Path(__file__).resolve().parents[1]
PREP3 = EX / "families" / "prep3-math-en"
EXPORT = EX / "seed" / "generated" / "generated-questions.json"
CATALOGUE = EX / "seed" / "generated" / "misconceptions.json"
LEGACY_SEED = 20260912

# sha256 of `generate_questions.py --out X [--per-family N]`, recorded on 2026-09-25
# BEFORE the driver was shared with declarative families.
GOLDEN = {10: "8331fcd36e0b0640a2c554d3a3d19144435eec682e2f4ee68dae438ec2985d8f",
          16: "0a434c2c066453fcd92d45570c5caeed6c6258223bea563fc68e60005b634db9"}


class TenFamiliesReproduced(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.specs, problems = FS.load_dir(PREP3)
        assert not problems, problems
        cls.report = G.compare_legacy(cls.specs, 16, LEGACY_SEED, EXPORT)
        cat = json.loads(CATALOGUE.read_text())["misconceptions"]
        cls.alias = {a: m["id"] for m in cat for a in (m.get("aliases") or [])}

    def test_at_least_three_and_in_fact_ten(self):
        self.assertGreaterEqual(len(self.specs), 3)
        self.assertEqual(len(self.specs), 10)
        self.assertTrue(all(s.id in {f.id for f in G.REGISTRY} for s in self.specs))

    def test_each_spec_equals_its_hand_written_twin(self):
        for fid, rec in self.report["families"].items():
            self.assertEqual(rec["status"], "identical", f"{fid}: {rec['differences'][:3]}")
            self.assertEqual(rec["items"][0], rec["items"][1])

    def test_the_only_difference_is_the_catalogues_own_alias_fold(self):
        for fid, rec in self.report["families"].items():
            for legacy_id, live_id in rec["misconception_map"].items():
                self.assertEqual(self.alias.get(legacy_id), live_id, f"{fid}: {legacy_id}")

    def test_spliced_into_the_bank_they_equal_what_production_loads(self):
        e = self.report["export"]
        self.assertEqual(e["items"], 531)
        self.assertEqual(e["spliced_items"], 153)
        self.assertEqual(e["spliced_differences"], [])
        self.assertEqual(e["other_differences"], [])
        self.assertTrue(e["spliced_items_identical"])
        self.assertTrue(self.report["all_identical"])

    def test_features_the_ten_exercise(self):
        kinds = {s.answer_type for s in self.specs}
        self.assertEqual(kinds, {"numeric", "mcq"})
        raws = [json.dumps(s.raw) for s in self.specs]
        for feature in ('"resample_while"', '"require"', '"shuffle"', '"each"', '"constraints"', "Fraction("):
            self.assertTrue(any(feature in r for r in raws), feature)


class TheHandWrittenFamiliesAreUnchanged(unittest.TestCase):
    def test_their_output_is_byte_identical(self):
        for n, want in GOLDEN.items():
            with tempfile.TemporaryDirectory() as d:
                out = Path(d, "bank.json")
                args = [sys.executable, str(EX / "generate_questions.py"), "--out", str(out)]
                if n != 10:
                    args += ["--per-family", str(n)]
                subprocess.run(args, check=True, capture_output=True, cwd=EX)
                self.assertEqual(hashlib.sha256(out.read_bytes()).hexdigest(), want, f"--per-family {n}")


class TheEightOldIds(unittest.TestCase):
    """Coordinator, 2026-09-25: eight registry ids with no alias in the single catalogue."""

    SIX = {"M_PROD_SUM": "mc:u1-1-3:product-is-sum", "M_RANGE_CODOMAIN": "mc:u1-3-2:range-is-codomain",
           "M_SLOPE_INTERCEPT": "mc:u1-4-2:intercept-is-slope",
           "M_PROPORTION_CROSS": "mc:u2-2-2:cross-multiplication-reversed",
           "M_VARIATION_SWAP": "mc:u2-3-2:inverse-solved-as-direct",
           "M_DMS_DECIMAL": "mc:u4-1-1:degree-split-decimally"}
    TWO = {"M_SUBST_SIGN": "mc:substitution-sign", "M_VERTEX_SIGN": "mc:vertex-sign"}

    @classmethod
    def setUpClass(cls):
        cls.cat = {m["id"]: m for m in json.loads(CATALOGUE.read_text())["misconceptions"]}
        cls.alias = {a: m["id"] for m in cls.cat.values() for a in (m.get("aliases") or [])}

    def test_six_point_at_the_live_entry_in_its_own_words(self):
        for const, live in self.SIX.items():
            self.assertEqual(getattr(G, const), live)
            m, entry = G.MISCONCEPTIONS[live], self.cat[live]
            self.assertEqual((m["lo_id"], m["label"], m["description"]),
                             (entry["lo_id"], entry["label"], entry["description"]))

    def test_two_have_no_entry_and_are_never_emitted(self):
        for const, old in self.TWO.items():
            self.assertEqual(getattr(G, const), old)
            self.assertNotIn(old, self.cat)
            self.assertNotIn(old, self.alias)

    def test_every_id_the_generator_emits_resolves_on_its_own_objective(self):
        qs, _, _ = G.instantiate(G.REGISTRY, 16, LEGACY_SEED)
        emitted = {(c["misconception_id"], q["lo_id"]) for q in qs for c in (q.get("choices") or [])
                   if c.get("misconception_id")}
        for mid, lo in emitted:
            live = self.alias.get(mid, mid)
            self.assertIn(live, self.cat, mid)
            self.assertEqual(self.cat[live]["lo_id"], lo, mid)
        self.assertFalse({m for m, _ in emitted} & set(self.TWO.values()))


if __name__ == "__main__":
    unittest.main()

"""The generator's answer keys agree with the stems it writes (v0.9.3 hotfix).

@covers FR-1207, FR-1206, FR-1215

Family `domain-excluded` printed 1/((x + r)(x + s)) and stored the SHIFTS r
and s as the values x cannot take, where the excluded values are the ROOTS −r
and −s. Three live questions (q:t2u2-2-1:w001–w003) therefore marked a correct
student wrong and the sign error right; migration 032 corrects the rows already
loaded. This reads each generated stem's denominator WITHOUT looking at the
spec, derives the roots, and holds the key, the solution and the diagnostics to
them — and holds the stored seed to the generator, so a regenerate and the live
bank cannot disagree about these rows again.

The whole stored bank (every family, not only this one) is read the same way
by `app/src/lib/widget-bank-stems.test.mts`, which runs in CI.

    python3 -m unittest discover -s tests -v          # from services/extraction
    uv run python -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import generate_widget_questions as G  # noqa: E402
import widget_spec as W  # noqa: E402

SEED = HERE.parent / "seed" / "generated" / "widget-questions.json"
FACTOR = re.compile(r"\(x\s*([+-])\s*(\d+)\)")


def roots_from_stem(stem: str) -> list[int]:
    """(x − a) is zero at x = a; (x + a) at x = −a. Read from the stem alone."""
    factors = FACTOR.findall(stem)
    if len(factors) != 2:
        raise AssertionError(f"expected two linear factors in: {stem}")
    return sorted(-int(n) if sign == "+" else int(n) for sign, n in factors)


def family(q: dict) -> str | None:
    m = re.search(r"template family ([a-z0-9-]+)", q.get("source_note") or "")
    return m.group(1) if m else None


class DomainExcludedFamily(unittest.TestCase):
    def setUp(self):
        self.generated = [q for q in G.build() if family(q) == "domain-excluded"]

    def test_three_questions(self):
        self.assertEqual([q["id"] for q in self.generated],
                         ["q:t2u2-2-1:w001", "q:t2u2-2-1:w002", "q:t2u2-2-1:w003"])

    def test_the_key_is_the_roots_the_stem_asks_for(self):
        for q in self.generated:
            with self.subTest(q["id"]):
                roots = roots_from_stem(q["stem"])
                self.assertEqual(q["choices"]["spec"]["targets"], roots)
                # the sign error is NOT the key (the v0.9.2 defect)
                self.assertNotEqual(sorted(-v for v in roots), roots)

    def test_the_solution_excludes_the_same_values(self):
        for q in self.generated:
            with self.subTest(q["id"]):
                text = " ".join(s["text_md"] for s in q["canonical_solution"])
                stated = sorted(int(x) for x in re.findall(r"\$x = (-?\d+)\$", text))
                self.assertEqual(stated, roots_from_stem(q["stem"]))

    def test_the_sign_error_and_the_omission_are_both_diagnosed(self):
        for q in self.generated:
            with self.subTest(q["id"]):
                self.assertEqual(q["choices"]["diagnostics"], [
                    {"predicate": "sign-flipped", "misconception_id": "mc:u1-1-1:transposition-sign"},
                    {"predicate": "missed-values", "misconception_id": "mc:t2u2-2-1:excluded-values-incomplete"},
                ])
                self.assertEqual(W.validate_widget(q), [])
        self.assertIn("sign-flipped", W.predicates_for("number_line_marker"))

    def test_the_stored_seed_is_what_the_generator_writes(self):
        stored = {q["id"]: q for q in json.loads(SEED.read_text())["questions"]}
        for q in self.generated:
            with self.subTest(q["id"]):
                s = stored[q["id"]]
                for key in ("lo_id", "tier", "stem", "choices", "correct_answer", "canonical_solution"):
                    self.assertEqual(s[key], q[key], key)


if __name__ == "__main__":
    unittest.main()

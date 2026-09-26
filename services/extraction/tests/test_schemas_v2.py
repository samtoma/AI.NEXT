"""schemas.py, generalised for the v2 line (B7 + T401; tasks T336, T401).

@covers FR-4302, FR-4303, FR-4311, FR-4320, FR-4405

FR-4405: every shipped bundle validates and dumps exactly as under the committed schema, no new
         field leaks into it, and selfcheck_arabic.py stays at 100%.
FR-4302: a book question records its solution's source (book_worked, book_worked_epub,
         teachers_guide, answer_anchored) and whether it is a verbatim book item (source='seed').
FR-4303 / FR-4320: the expression marker's answer spec (contracts/answer-marker.md) travels in
         `choices` as {"marker": …} on a 'short' question, and its shape is checked.
FR-4311: a lesson's book provenance — sections, part n of m, merged sections, chapter
         introduction — with a split section's parts numbered 1..m and consecutive.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

EX = Path(__file__).resolve().parents[1]
REPO = EX.parents[1]
if str(EX) not in sys.path:
    sys.path.insert(0, str(EX))

from pydantic import ValidationError  # noqa: E402

import schemas  # noqa: E402
from schemas import (AnswerSpec, ClaimStep, Lesson, Misconception, Question, SeedBundle,  # noqa: E402
                     exercise_question_id, lo_id, section_of_slug, worked_example_question_id)

V2_FIELDS = {"source", "solution_provenance", "family", "lessons", "claim", "lang", "claim_type", "anchor"}


def shipped_bundles() -> list[Path]:
    out = []
    for p in sorted((EX / "seed").glob("*.json")) + sorted((EX / "seed" / "generated").glob("*.json")):
        if '"extraction_run"' in p.read_text():
            out.append(p)
    return out


def committed_schemas():
    """schemas.py as committed at HEAD, imported under another name (None without git)."""
    try:
        src = subprocess.run(["git", "show", "HEAD:services/extraction/schemas.py"], cwd=REPO,
                             capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    if src == (EX / "schemas.py").read_text():
        return None                                  # nothing to compare: the change is committed
    d = Path(tempfile.mkdtemp())
    (d / "schemas_head.py").write_text(src)
    spec = importlib.util.spec_from_file_location("schemas_head", d / "schemas_head.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["schemas_head"] = mod               # pydantic resolves annotations through it
    spec.loader.exec_module(mod)
    return mod


def keys_everywhere(obj, out=None) -> set:
    out = set() if out is None else out
    if isinstance(obj, dict):
        out |= set(obj)
        for v in obj.values():
            keys_everywhere(v, out)
    elif isinstance(obj, list):
        for v in obj:
            keys_everywhere(v, out)
    return out


class ShippedBundlesUnchanged(unittest.TestCase):
    def test_every_shipped_bundle_dumps_as_under_the_committed_schema(self):
        head = committed_schemas()
        bundles = shipped_bundles()
        self.assertGreaterEqual(len(bundles), 10)
        for p in bundles:
            with self.subTest(bundle=p.name):
                b = SeedBundle.model_validate_json(p.read_text())
                dump = b.model_dump(mode="json", exclude_defaults=True)
                raw_keys = keys_everywhere(json.loads(p.read_text()))
                self.assertFalse((keys_everywhere(dump) & V2_FIELDS) - raw_keys,
                                 "a v2 field leaked into a shipped bundle's dump")
                again = SeedBundle.model_validate(b.model_dump(mode="json")).model_dump(
                    mode="json", exclude_defaults=True)
                self.assertEqual(again, dump, "dump -> validate -> dump is not a fixed point")
                if head is not None:
                    old = head.SeedBundle.model_validate_json(p.read_text()).model_dump(
                        mode="json", exclude_defaults=True)
                    self.assertEqual(json.dumps(dump, sort_keys=True), json.dumps(old, sort_keys=True))

    def test_the_arabic_selfcheck_stays_at_100_percent(self):
        p = subprocess.run([sys.executable, "selfcheck_arabic.py"], cwd=EX, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout[-2000:] + p.stderr[-2000:])
        self.assertRegex(p.stdout, r"\n\d+ passed, 0 failed")


class ClaimStepGeneralised(unittest.TestCase):
    def test_the_arabic_spelling_is_unchanged(self):
        c = ClaimStep(claim_ar="نص", evidence_page=3, evidence_kind="text")
        self.assertEqual(c.model_dump(exclude_defaults=True),
                         {"claim_ar": "نص", "evidence_page": 3, "evidence_kind": "text"})
        self.assertEqual((c.text, c.language), ("نص", "ar"))

    def test_an_english_claim_names_its_language_and_anchor(self):
        c = ClaimStep(claim="The gradient is the ratio of rise to run.", lang="en", evidence_page=293,
                      evidence_kind="definition", claim_type="definition", anchor="EMA6B")
        self.assertEqual((c.text, c.language), ("The gradient is the ratio of rise to run.", "en"))

    def test_bad_claims(self):
        for kw in ({"claim_ar": "نص", "claim": "x", "lang": "en"},      # both
                   {"claim": "x"},                                       # no language
                   {"claim_ar": "نص", "lang": "en"},                     # Arabic field, English lang
                   {},                                                   # neither
                   {"claim": "   ", "lang": "en"}):                      # blank
            with self.subTest(kw=kw), self.assertRaises(ValidationError):
                ClaimStep(evidence_page=1, evidence_kind="text", **kw)


def q(**kw) -> dict:
    base = {"id": "q:g10m8s2-1-1:ex8-2-1", "lo": "lo:g10m8s2-1-1", "tier": "basic", "type": "short",
            "stem": "Find the distance.", "answer": "\\sqrt{29}", "solution": ["$d = \\sqrt{29}$"],
            "source_page": 292, "source_note": "Exercise 8-2, question 1 (FX21) · p.292 · solution: book_worked_epub"}
    base.update(kw)
    return base


class BookQuestions(unittest.TestCase):
    def test_a_marker_graded_book_question(self):
        m = {"kind": "surd", "key": "\\sqrt{29}", "form": None, "variables": [], "tolerance": None}
        x = Question.model_validate(q(choices={"marker": m}, source="seed", solution_provenance="book_worked_epub"))
        self.assertEqual(x.marker.kind, "surd")
        self.assertEqual(x.model_dump(mode="json")["choices"], {"marker": m})     # the DB `choices` shape

    def test_the_marker_is_only_for_a_short_answer_with_its_text(self):
        m = {"marker": {"kind": "expression", "key": "x^2"}}
        with self.assertRaises(ValidationError):
            Question.model_validate(q(type="numeric", choices=m))
        with self.assertRaises(ValidationError):
            Question.model_validate(q(type="mcq", choices=m))
        with self.assertRaises(ValidationError):
            Question.model_validate(q(choices=m, answer=" "))

    def test_the_answer_spec(self):
        ok = [{"kind": "expression", "key": "(x-3)(x+3)", "form": "factorised", "variables": ["x"]},
              {"kind": "equation", "key": "x = \\frac{y-c}{m}", "form": {"subject": "x"}, "variables": ["x", "y", "m", "c"]},
              {"kind": "values", "key": "x = 2 \\text{ or } x = -3", "variables": ["x"]},
              {"kind": "coordinates", "key": "(1; 2)", "tolerance": {"abs": 0.01}},
              {"kind": "interval", "key": "[2; 5)"}, {"kind": "recurring", "key": "0.\\dot{2}"},
              {"kind": "expression", "key": "\\theta^2", "variables": ["\\theta", "x_1"]}]
        for m in ok:
            with self.subTest(m=m):
                AnswerSpec.model_validate(m)
        bad = [{"kind": "surd", "key": "2\\sqrt{3}", "tolerance": {"abs": 0.01}},   # exact kind, tolerance
               {"kind": "coordinates", "key": "(1; 2)", "form": "factorised"},
               {"kind": "equation", "key": "y = 2x", "form": {"subject": "z"}, "variables": ["x", "y"]},
               {"kind": "expression", "key": " "}, {"kind": "matrix", "key": "A"},
               {"kind": "expression", "key": "x", "variables": ["xy"]},
               {"kind": "expression", "key": "x", "unknown": 1}]
        for m in bad:
            with self.subTest(m=m), self.assertRaises(ValidationError):
                AnswerSpec.model_validate(m)

    def test_provenance_and_source(self):
        for p in ("book_worked", "book_worked_epub", "teachers_guide", "answer_anchored"):
            Question.model_validate(q(solution_provenance=p, source="seed"))
        with self.assertRaises(ValidationError):
            Question.model_validate(q(solution_provenance="derived"))
        with self.assertRaises(ValidationError):
            Question.model_validate(q(source="variant"))                 # a bundle never claims 'variant'
        with self.assertRaises(ValidationError):                         # a family computes its own solution
            Question.model_validate(q(family="distance-formula", solution_provenance="book_worked_epub"))
        Question.model_validate(q(family="distance-formula", source="authored"))

    def test_mc_ids(self):
        for i in ("mc:g10m8s2-1-1:swap-coordinates", "misc:u1-1-1:x"):
            Misconception(id=i, lo="lo:g10m8s2-1-1", label="l", description="d", generated_by="t")
        with self.assertRaises(ValidationError):
            Misconception(id="m:g10m8s2-1-1:x", lo="lo:x", label="l", description="d", generated_by="t")


def lesson(slug, secs, part=None, intro=False, **kw):
    return {"slug": slug, "title": "T", "sections": [{"number": n, "title": f"S{n}"} for n in secs],
            "part": part, "chapter_intro": intro, **kw}


def bundle(lessons, los) -> dict:
    return {"extraction_run": {"extractor": "t", "extractor_version": "1", "schema_version": "1"},
            "syllabus_version": "v1.1", "external_node_refs": ["course:us-g10-math-en"],
            "nodes": [{"id": "module:g10m-c08", "kind": "module", "label": "Chapter 8"}] +
                     [{"id": l, "kind": "learning_objective", "label": l} for l in los],
            "edges": [{"src": "module:g10m-c08", "dst": "course:us-g10-math-en", "type": "part_of"}],
            "questions": [], "lessons": lessons}


class BookAskedForms(unittest.TestCase):
    """Backlog 30/31: the Grade 10 book asks for a product of primes and for a decimal; the marker
    spec carries those forms, and only on the kinds where they mean something."""

    def test_the_forms_are_exactly_the_apps(self):
        AnswerSpec.model_validate({"kind": "recurring", "key": "0,\\dot{2}\\dot{1}", "form": "decimal"})
        with self.assertRaises(ValidationError):
            AnswerSpec.model_validate({"kind": "coordinates", "key": "(1;2)", "form": "decimal"})
        with self.assertRaises(ValidationError, msg="the app's reader throws on an unknown form"):
            AnswerSpec.model_validate({"kind": "expression", "key": "11\\times13", "form": "prime_factors"})
        with self.assertRaises(ValidationError, msg="a subject form needs an equation"):
            AnswerSpec.model_validate({"kind": "expression", "key": "x", "form": {"subject": "x"}, "variables": ["x"]})


class LessonProvenance(unittest.TestCase):
    def test_shapes(self):
        self.assertEqual(Lesson.model_validate(lesson("g10m8s3-2", ["8.3"], {"n": 2, "of": 2})).group_key, "8.3")
        merged = Lesson.model_validate(lesson("g10m1s3-1", ["1.2", "1.3"]))
        self.assertEqual(merged.group_key, "1.3")                         # the section its slug names
        Lesson.model_validate(lesson("g10m6s1-1", ["6.1"], intro=True))
        Lesson.model_validate(lesson("u1-1", ["1.1"]))                    # a National lesson, one section
        Lesson.model_validate(lesson("g10m8s2-1", ["8.2"], order_in_module=2, printed_pages=[288, 293],
                                     module="module:g10m-c08"))
        bad = [lesson("G10-1", ["8.2"]), lesson("g10m8s3-1", ["8.3", "8.4"], {"n": 1, "of": 2}),
               lesson("g10m6s1-1", ["6.1"], {"n": 1, "of": 2}, intro=True),
               lesson("g10m8s3-1", ["8.3"], {"n": 3, "of": 2}), lesson("g10m8s3-1", ["8.3"], {"n": 1, "of": 1}),
               lesson("g10m1s3-1", ["1.2", "1.2"]), lesson("g10m8s2-1", ["8"]),
               lesson("g10m8s3-2", ["8.3"], {"n": 2, "of": 2}, group_key="8.4")]
        for x in bad:
            with self.subTest(x=x), self.assertRaises(ValidationError):
                Lesson.model_validate(x)

    def test_a_bundle_keeps_a_sections_parts_together(self):
        los = ["lo:g10m8s2-1-1", "lo:g10m8s3-1-1", "lo:g10m8s3-2-1"]
        good = [lesson("g10m8s2-1", ["8.2"]), lesson("g10m8s3-1", ["8.3"], {"n": 1, "of": 2}),
                lesson("g10m8s3-2", ["8.3"], {"n": 2, "of": 2})]
        SeedBundle.model_validate(bundle(good, los))
        cases = {
            "not consecutive": ([good[1], good[0], good[2]], los),
            "a part missing": ([good[0], good[2]], ["lo:g10m8s2-1-1", "lo:g10m8s3-2-1"]),
            "an objective with no lesson": (good[:2], los),
            "a lesson with no objective": (good, los[:2]),
            "a lesson twice": (good + [good[0]], los),
        }
        for name, (ls, ol) in cases.items():
            with self.subTest(name), self.assertRaises(ValidationError):
                SeedBundle.model_validate(bundle(ls, ol))


class Ids(unittest.TestCase):
    def test_the_handoff_ids(self):
        self.assertEqual(lo_id("g10m8s2-1", 3), "lo:g10m8s2-1-3")
        self.assertEqual(worked_example_question_id("lo:g10m8s3-1-1", 3), "q:g10m8s3-1-1:we03")
        self.assertEqual(exercise_question_id("lo:g10m8s2-1-1", "Ex8-2:5b"), "q:g10m8s2-1-1:ex8-2-5b")
        self.assertEqual(section_of_slug("g10m13s2-2"), "13.2")
        self.assertIsNone(section_of_slug("u1-1"))
        for bad in (lambda: lo_id("G10", 1), lambda: exercise_question_id("lo:x-1-1", "8-2:5")):
            with self.assertRaises(ValueError):
                bad()

    def test_viz_kinds_are_unchanged(self):
        self.assertEqual(len(schemas.VIZ_KINDS), 12)


if __name__ == "__main__":
    unittest.main()

"""The G2 recommendation run (answers 37a and 42): g2_recommend.py and runbook/g2-recommend.workflow.js.

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/test_g2_recommend.py

No model is called. What is proved:
  * WHICH ITEMS owe a recommendation: the ones the checks HELD (a three-way disagreement) or EXCLUDED (a typing problem), in book
    order, and never an item the rule accepts, a teaching item, or one a person decided; the packet is the same however often
    it is built, and whether or not a recommendation has already been applied;
  * the WORKFLOW under the stub runtime: one recommending agent per batch, one independent verifying agent per batch of
    verdicts that would go live (never for an exclude, a hold or a teaching-only retype), the verifier never sees the
    recommender's reasoning or the blind answer, a batch answered in part is asked again once, a dead agent leaves
    its items without a verdict, the classes the prompt offers are the classes the collector knows;
  * the COLLECTOR's policy: a verdict that would put a question live must quote the book, leave the item well formed for the
    pipeline's own models, be the book's answer re-typed, be readable by the app's marker and be confirmed by the verifier —
    anything else is recommended hold (or exclude, where the item's typed shape is unusable) with the reason; an exclude may
    carry the agent's own derivation (never applied); a stem repair is flagged and small; nothing here edits a G2 file;
  * the file reaches G2 through auto_pass_gates.g2_merge and assemble_objectives.lesson_runs exactly like the pilot's
    recommendations did (fields applied, auto stamp, `stem_fix_by`), and the commands it prints name the right files.

@covers FR-4302
"""

from __future__ import annotations

import copy
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
EX = HERE.parent
for p in (str(EX), str(HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)

import auto_pass_gates as A  # noqa: E402
import book_config  # noqa: E402
import embed_workflow  # noqa: E402
import g2_recommend as G  # noqa: E402

NODE = shutil.which("node")
STUB = HERE / "workflow_stub.mjs"
WORKFLOW = EX / "runbook" / "g2-recommend.workflow.js"


# ---------------------------------------------------------------------------------------------- a synthetic chapter
def pairs(ref: str, bp="different", bb="missing", bk="missing") -> dict:
    return {"pairs": [{"pair_id": f"{ref}|blind~printed", "route": "judge", "verdict": bp, "reason": "values differ"},
                      {"pair_id": f"{ref}|blind~book", "route": "judge", "verdict": bb},
                      {"pair_id": f"{ref}|book~printed", "route": "judge", "verdict": bk}]}


def item(ref: str, **kw) -> dict:
    d = {"ref": ref, "kind": "exercise", "lo": "lo:g10m9s1-1-1", "stem": "Simplify: $x\\cdot x$", "answer_type": "expression",
         "answer": "x^{2}", "choices": None,
         "marker": {"kind": "expression", "key": "x^{2}", "form": None, "variables": ["x"], "tolerance": None},
         "solution": ["$x\\cdot x=x^{2}$"], "solution_provenance": "book_worked_epub", "printed_answer": "x2",
         "epub_final_answer": "$x^{2}$", "blind_answer": "BLIND-MARK-77", "verification": "disputed", "tier": "basic",
         "printed_page": 10, "shortcode": None, "typing_problems": [], "verify": pairs(ref, bk="equivalent"), "figures": []}
    d.update(kw)
    return d


FOURTEEN = [{"key": "ABCDE"[i % 5] if i < 5 else "", "text": f"n{i}"} for i in range(14)]


def make_run() -> tuple[dict, dict]:
    items = [
        item("Ex9-1:1"),                                                                       # held: blind differs, the book's key is right
        item("Ex9-1:2", answer_type="numeric", answer="\\frac{1}{2}", marker=None, verification="agreed",
             printed_answer="1 2", epub_final_answer="$\\frac{1}{2}$", blind_answer="\\frac{1}{2}", stem="Simplify: $\\frac{2}{4}$",
             solution=["$\\frac{2}{4}=\\frac{1}{2}$"], typing_problems=['numeric key "\\frac{1}{2}" is not a number'],
             verify=pairs("Ex9-1:2", "equivalent", "equivalent", "equivalent")),            # excluded: a fraction typed numeric
        item("Ex9-1:3", answer_type="choice", answer=None, marker=None, choices=FOURTEEN, options_source="stem",
             stem="Which of n0 ... n13 are non-real? [list]", solution=["Only n3 is non-real."], printed_answer="n3",
             epub_final_answer="Only n3 is non-real.", typing_problems=["a choice needs 2–5 options, not 14"]),   # excluded: a list to select from
        item("Ex9-1:4", verification="no_printed_answer", printed_answer=None, verify={"pairs": []}),       # the rule accepts it
        item("Ex9-1:5", answer_type="not_markable", answer=None, marker=None, not_markable_reason="a sketch",
             verification="no_printed_answer", printed_answer=None, verify={"pairs": []}),                 # teaching: no verdict owed
        item("Ex9-1:6"),                                                                       # a person decided this one
        item("Ex9-1:7", answer_type="choice", answer=None, marker=None, options_source="lesson",
             stem="State whether $3$ is rational or irrational. If rational, state whether it is a natural number, whole number or an integer.",
             choices=[{"key": "A", "text": "irrational"}, {"key": "B", "text": "rational, integer"},
                      {"key": "C", "text": "rational, integer, whole number and natural number"}],
             printed_answer="rational, an integer, a whole number and a natural number", epub_final_answer=None,
             solution=["$3$ is rational, an integer, a whole number and a natural number."],
             typing_problems=["a choice needs 2–5 options with the key among them"], verify=pairs("Ex9-1:7", "equivalent")),
    ]
    verify = {"disagreements": [{"ref": "Ex9-1:1"}, {"ref": "Ex9-1:6"}],
              "typing_problems": [{"ref": "Ex9-1:2", "problems": items[1]["typing_problems"]},
                                  {"ref": "Ex9-1:3", "problems": items[2]["typing_problems"]},
                                  {"ref": "Ex9-1:7", "problems": items[6]["typing_problems"]}],
              "no_printed_answer": [{"ref": "Ex9-1:4", "agreed_with_book_solution": True},
                                    {"ref": "Ex9-1:5", "agreed_with_book_solution": False}]}
    run = {"stage": "S2-S4,S8", "lessons": [{"lesson": "g10m9s1-1", "items": items, "verify": verify}]}
    g2 = {"by": "auto-pass G2 (AI recommendation)", "auto": True,
          "items": {"g10m9s1-1:Ex9-1:6": {"verdict": "hold", "by": "Samuel Toma", "note": "I will look"}}}
    return run, g2


def entries_of(run=None, g2=None) -> list[dict]:
    r, g = make_run()
    return G.recommendable([run or r], 9, "g10m", g2 if g2 is not None else g)


def by_key(entries) -> dict:
    return {e["key"]: e for e in entries}


def rec(verdict="accept", klass="book answer confirmed", conf="high", note="checked", **kw) -> dict:
    d = {"verdict": verdict, "class": klass, "confidence": conf, "note": note}
    d.update(kw)
    return d


CONFIRMED = {"verdict": "confirmed", "own_answer": "x^2", "other_correct_answers": False, "note": "ok"}
NO_MARKER = staticmethod(lambda rows: {})


def collect(entries, results: dict, **kw) -> dict:
    """results: {key: (rec, ver)} -> the recommendation file, with the app's marker faked (or real when NODE and asked)."""
    run = {"results": [{"key": k, "state": by_key(entries)[k]["state"], "rec": r, "ver": v} for k, (r, v) in results.items()]}
    return G.collect(entries, [run], marker_fn=kw.pop("marker_fn", lambda rows: {}), identity_fn=kw.pop("identity_fn", lambda rows: {}), **kw)


# ---------------------------------------------------------------------------------------------- which items, the packet
class WhichItems(unittest.TestCase):
    def test_held_and_excluded_only_in_book_order(self):
        es = entries_of()
        self.assertEqual([e["key"] for e in es], ["g10m9s1-1:Ex9-1:1", "g10m9s1-1:Ex9-1:2", "g10m9s1-1:Ex9-1:3", "g10m9s1-1:Ex9-1:7"])
        self.assertEqual({e["ref"]: e["state"] for e in es},
                         {"Ex9-1:1": "held", "Ex9-1:2": "excluded", "Ex9-1:3": "excluded", "Ex9-1:7": "excluded"})

    def test_never_the_rule_accepted_the_teaching_or_a_persons_item(self):
        keys = {e["key"] for e in entries_of()}
        self.assertNotIn("g10m9s1-1:Ex9-1:4", keys, "no printed answer and the re-solve agreed: the rule accepts it")
        self.assertNotIn("g10m9s1-1:Ex9-1:5", keys, "typed not markable: teaching, no verdict owed")
        self.assertNotIn("g10m9s1-1:Ex9-1:6", keys, "a human's verdict stands")

    def test_an_auto_verdict_is_not_a_decision_so_the_same_items_come_back(self):
        r, g = make_run()
        g["items"]["g10m9s1-1:Ex9-1:1"] = {"verdict": "accept", "auto": True, "by": "auto-pass G2 (AI recommendation)"}
        g["items"]["g10m9s1-1:Ex9-1:2"] = {"verdict": "fix", "by": "auto-pass G2 (AI recommendation)", "auto": True}
        self.assertEqual([e["key"] for e in G.recommendable([r], 9, "g10m", g)], [e["key"] for e in entries_of()],
                         "building the packet after a recommendation was applied gives the same packet")

    def test_the_chapter_filter(self):
        r, g = make_run()
        self.assertEqual(G.recommendable([r], 8, "g10m", g), [])

    def test_the_packet_and_its_hash(self):
        es = entries_of()
        book = book_config.load_book("g10-math")
        a = G.build_args(book, 9, es)
        self.assertEqual((a["stage"], a["prompts_version"], a["batch"], a["verify_batch"], a["model"], a["effort"]),
                         ("G2R", "g2rec-v1", 8, 8, "sonnet", "high"))
        self.assertEqual([x["key"] for x in a["items"]], [e["key"] for e in es])
        self.assertEqual(a["items_sha256"], G.items_sha256(es))
        self.assertEqual(G.items_sha256(es), G.items_sha256(copy.deepcopy(es)))
        changed = copy.deepcopy(es)
        changed[0]["item"]["stem"] += " (changed)"
        self.assertNotEqual(G.items_sha256(changed), a["items_sha256"], "a changed item is a different packet")
        it = a["items"][0]["item"]
        self.assertEqual(set(it), set(G.PROMPT_FIELDS) | {"pairs"}, "a prompt gets what it needs of an item and nothing else")
        self.assertEqual(it["pairs"][0], {"p": "blind~printed", "v": "different", "r": "values differ"})

    def test_parts_are_whole_batches(self):
        es = [{"key": str(i), "state": "held", "lesson": "g10m9s1-1", "ref": str(i), "item": {}} for i in range(70)]
        parts = G.split_parts(es, batch=8, max_batches=4)
        self.assertEqual([len(p) for p in parts], [32, 32, 6])
        self.assertEqual(G.part_path(Path("w/g2rec-ch01.workflow.js"), 1).name, "g2rec-ch01.workflow.js")
        self.assertEqual(G.part_path(Path("w/g2rec-ch01.workflow.js"), 3).name, "g2rec-ch01.part3.workflow.js")

    def test_the_estimate_is_modelled_and_ordered(self):
        e = G.estimate(82)
        self.assertEqual((e["recommend_agents"], e["verify_agents_max"]), (11, 7))
        self.assertLess(e["usd_low"], e["usd_high"])


# ---------------------------------------------------------------------------------------------- the checks on a typed shape
class TypedShape(unittest.TestCase):
    def setUp(self):
        self.it = item("Ex9-1:2", answer_type="numeric", answer="\\frac{1}{2}", marker=None)

    def test_a_fraction_typed_numeric_is_typed_expression_like_the_pilots_fix(self):
        f, probs = G.typed_fields(self.it, {"answer_type": "expression", "key": "\\frac{1}{2}", "marker_kind": "expression", "variables": []})
        self.assertEqual(probs, [])
        self.assertEqual(f, {"answer_type": "expression",
                             "marker": {"kind": "expression", "key": "\\frac{1}{2}", "form": None, "variables": [], "tolerance": None}})
        # the pilot's 35c fix: answer_type, answer, marker (here `answer` already equals the key, so only the changes remain)

    def test_a_numeric_key_is_one_number(self):
        _, probs = G.typed_fields(self.it, {"answer_type": "numeric", "key": "\\frac{1}{2}"})
        self.assertTrue(any("ONE number" in p for p in probs))
        f, probs = G.typed_fields(self.it, {"answer_type": "numeric", "key": "1,49"})
        self.assertEqual((probs, f["answer"]), ([], "1,49"))

    def test_the_books_asked_form_wins_and_prime_factors_is_refused(self):
        it = item("Ex9-1:9", asked_form="factorised")
        f, _ = G.typed_fields(it, {"answer_type": "expression", "key": "(x+1)(x-1)", "marker_kind": "expression", "form": "expanded"})
        self.assertEqual(f["marker"]["form"], "factorised")
        _, probs = G.typed_fields(item("Ex9-1:9", asked_form="prime_factors"),
                                  {"answer_type": "expression", "key": "11\\times13", "marker_kind": "expression"})
        self.assertTrue(any("prime factors" in p for p in probs))

    def test_the_raised_dot_is_multiplication(self):
        _, probs = G.typed_fields(item("Ex9-1:9", raised_dot=True),
                                  {"answer_type": "expression", "key": "2.3^{x}", "marker_kind": "expression"})
        self.assertTrue(any("raised dot" in p for p in probs))

    def test_several_true_categories_become_a_choice_with_less_specific(self):
        it = by_key(entries_of())["g10m9s1-1:Ex9-1:7"]["item"]
        fix = {"answer_type": "choice", "key": "natural number", "options_source": "stem",
               "options": ["irrational", "rational", "integer", "whole number", "natural number"],
               "less_specific": ["rational", "integer", "whole number"]}
        f, probs = G.typed_fields(it, fix)
        self.assertEqual(probs, [])
        self.assertEqual((f["answer"], f["less_specific"], f["options_source"]), ("E", ["B", "C", "D"], "stem"))
        self.assertEqual([c["key"] for c in f["choices"]], list("ABCDE"))
        self.assertEqual(G.structural_problems({**it, **f}, "fix"), [], "the pipeline's own models take it")

    def test_a_choice_fix_cannot_invent_its_options(self):
        it = by_key(entries_of())["g10m9s1-1:Ex9-1:7"]["item"]
        _, p = G.typed_fields(it, {"answer_type": "choice", "key": "rational", "options": ["rational", "irrational"]})
        self.assertTrue(any("where its options come from" in x for x in p))
        _, p = G.typed_fields(it, {"answer_type": "choice", "key": "x", "options": ["rational", "irrational"], "options_source": "stem"})
        self.assertTrue(any("not the text of one of the options" in x for x in p))
        _, p = G.typed_fields(it, {"answer_type": "choice", "key": "rational", "options": ["rational", "irrational", "x"] * 3,
                                   "options_source": "stem"})
        self.assertTrue(any("2–5 options" in x for x in p) or any("repeat" in x for x in p))
        f, _ = G.typed_fields(it, {"answer_type": "choice", "key": "real", "options": ["real", "non-real"], "options_source": "stem"})
        self.assertTrue(any("not all in the stem" in x for x in G.structural_problems({**it, **f}, "fix")),
                        "a 'stem' option the stem does not contain is the typing agent's invention")
        _, p = G.typed_fields(it, {"answer_type": "choice", "key": "rational", "options": ["rational", "irrational"],
                                   "options_source": "figure"})
        self.assertTrue(any("no figure" in x for x in p))
        f, _ = G.typed_fields(it, {"answer_type": "choice", "key": "rational", "options": ["rational", "9", "irrational"],
                                   "options_source": "lesson"})
        self.assertTrue(any("closed set" in x for x in G.structural_problems({**it, **f}, "fix")),
                        "a number among the options of a lesson's closed set is invented")

    def test_the_key_is_not_a_less_specific_option(self):
        it = by_key(entries_of())["g10m9s1-1:Ex9-1:7"]["item"]
        _, p = G.typed_fields(it, {"answer_type": "choice", "key": "rational", "options": ["rational", "irrational"],
                                   "options_source": "stem", "less_specific": ["rational"]})
        self.assertTrue(any("most specific" in x for x in p))

    def test_not_markable_and_answer_only(self):
        f, p = G.typed_fields(self.it, {"answer_type": "not_markable", "not_markable_reason": "several points in one answer"})
        self.assertEqual((p, f["answer_type"], f["answer"]), ([], "not_markable", None))
        _, p = G.typed_fields(self.it, {"answer_type": "not_markable"})
        self.assertTrue(any("reason" in x for x in p))
        f, _ = G.typed_fields(item("Ex9-1:1"), {"answer_type": "expression", "key": "x^{2}", "marker_kind": "expression",
                                                "variables": ["x"], "answer_only": True})
        self.assertTrue(f["answer_only"])
        self.assertTrue(any("blind~printed" in x or "agreed" in x for x in G.structural_problems({**item("Ex9-1:1"), **f}, "fix")),
                        "answer_only needs the printed answer and the blind re-solve to agree (decision 43)")

    def test_a_stem_repair_is_small_and_keeps_the_figure(self):
        it = item("Ex9-1:8", stem="Simplify: $\\frac{a-4}{a+5a+4}$ [figure]")
        f, p = G.typed_fields(it, {"stem": "Simplify: $\\frac{a-4}{a^2+5a+4}$ [figure]"})
        self.assertEqual((p, list(f)), ([], ["stem"]), "no typing named: the typing stays and only the stem changes")
        _, p = G.typed_fields(it, {"stem": "Rewrite the whole question in a completely different way, please"})
        self.assertTrue(any("rewritten" in x for x in p))
        _, p = G.typed_fields(it, {"stem": "Simplify: $\\frac{a-4}{a^2+5a+4}$"})
        self.assertTrue(any("[figure]" in x for x in p))
        _, p = G.typed_fields(it, {})
        self.assertTrue(any("nothing else to change" in x for x in p))

    def test_a_repair_alone_keeps_the_choice_flags(self):
        it = item("Ex9-1:8", answer_type="choice", answer="B", marker=None, options_source="stem", less_specific=["A"],
                  choices=[{"key": "A", "text": "trapezium"}, {"key": "B", "text": "isosceles trapezium"}],
                  stem="What is $ABCD$? trapezium isosceles trapezium")
        f, _ = G.typed_fields(it, {"stem": "What is $ABCD$ ? trapezium isosceles trapezium"})
        self.assertNotIn("less_specific", f, "the stem repair does not clear the less_specific options")

    def test_the_quote_is_the_books(self):
        it = item("Ex9-1:1")
        self.assertTrue(G.grounded(it, "x^{2}"))
        self.assertTrue(G.grounded(it, "$x\\cdot x = x^{2}$"), "spacing and $ are not part of a quote")
        self.assertTrue(G.grounded(it, "x2"), "the printed answer is a book source too")
        self.assertFalse(G.grounded(it, "x^{3}"))
        self.assertFalse(G.grounded(it, ""))


# ---------------------------------------------------------------------------------------------- the policy
class Policy(unittest.TestCase):
    def setUp(self):
        self.es = entries_of()
        self.k1, self.k2, self.k3, self.k7 = ("g10m9s1-1:Ex9-1:" + n for n in "1237")

    def one(self, key, r, v=None, **kw):
        doc = collect(self.es, {key: (r, v)}, **kw)
        return doc["items"].get(key), doc

    def test_accept_needs_a_book_quote_and_the_verifier(self):
        e, doc = self.one(self.k1, rec(book_quote="x^{2}"), CONFIRMED)
        self.assertEqual((e["verdict"], e["confidence"], e["class"]), ("accept", "high", "book answer confirmed"))
        self.assertEqual(e["verified"]["verdict"], "confirmed")
        self.assertIn("Verified independently", e["note"])
        self.assertNotIn("fields", e)
        self.assertEqual(doc["report"]["live"], [self.k1])

    def test_no_quote_or_a_quote_the_book_does_not_hold_is_not_live(self):
        e, _ = self.one(self.k1, rec(), CONFIRMED)
        self.assertEqual((e["verdict"], e["class"]), ("hold", "not grounded"))
        self.assertEqual(e["confidence"], "low")
        e, doc = self.one(self.k1, rec(book_quote="x^{5}"), CONFIRMED)
        self.assertEqual((e["verdict"], e["class"]), ("hold", "not grounded"))
        self.assertIn("NOT RECOMMENDED LIVE", e["note"])
        self.assertIn(self.k1, doc["report"]["not_live"])

    def test_the_verifier_has_the_last_word_on_anything_that_would_go_live(self):
        for ver, why in ((None, "gave no answer"),
                         ({**CONFIRMED, "verdict": "wrong", "own_answer": "x^3", "note": "the book has a sign wrong"}, "said wrong"),
                         ({**CONFIRMED, "verdict": "unsure"}, "said unsure"),
                         ({**CONFIRMED, "other_correct_answers": True}, "another answer is also correct")):
            e, _ = self.one(self.k1, rec(book_quote="x^{2}"), ver)
            self.assertEqual((e["verdict"], e["class"]), ("hold", "unconfirmed"), why)
            self.assertIn(why.split()[-1], e["note"] + e["why_low"] + (why if ver is None else ""))

    def test_an_item_already_excluded_stays_excluded_when_nothing_confirms_it(self):
        e, _ = self.one(self.k2, rec("fix", "typing error", book_quote="\\frac{1}{2}",
                                     fix={"answer_type": "expression", "key": "\\frac{1}{2}", "marker_kind": "expression"}), None)
        self.assertEqual((e["verdict"], e["class"]), ("exclude", "unconfirmed"),
                         "a held item falls back to hold; an excluded one to exclude (its typed shape may be unusable)")

    def test_a_fix_carries_the_pilots_fields_and_the_book_quote(self):
        fix = {"answer_type": "expression", "key": "\\frac{1}{2}", "marker_kind": "expression", "form": "", "variables": []}
        e, _ = self.one(self.k2, rec("fix", "typing error", book_quote="\\frac{1}{2}", fix=fix), CONFIRMED)
        self.assertEqual(e["verdict"], "fix")
        self.assertEqual(e["fields"]["answer_type"], "expression")
        self.assertEqual(e["fields"]["marker"]["key"], "\\frac{1}{2}")
        self.assertNotIn("stem_fix_by", e)

    def test_a_fix_must_be_the_quoted_answer_retyped(self):
        fix = {"answer_type": "expression", "key": "\\frac{1}{3}", "marker_kind": "expression"}
        e, _ = self.one(self.k2, rec("fix", "typing error", book_quote="\\frac{1}{2}", fix=fix), CONFIRMED)
        self.assertEqual((e["verdict"], e["class"]), ("exclude", "not grounded"), "a key from nowhere is never a fix")

    def test_a_fix_the_pipeline_refuses_is_not_live(self):
        e, _ = self.one(self.k2, rec("fix", "typing error", book_quote="\\frac{1}{2}", fix={"answer_type": "numeric", "key": "\\frac{1}{2}"}),
                        CONFIRMED)
        self.assertEqual((e["verdict"], e["class"]), ("exclude", "refused"))
        self.assertIn("ONE number", e["note"])

    def test_an_accept_of_a_shape_the_pipeline_cannot_emit_is_refused(self):
        e, _ = self.one(self.k3, rec(book_quote="Only n3 is non-real"), CONFIRMED)
        self.assertEqual((e["verdict"], e["class"]), ("exclude", "refused"), "14 options and no key: not a choice")
        e, _ = self.one(self.k7, rec(book_quote="a natural number"), CONFIRMED)
        self.assertEqual((e["verdict"], e["class"]), ("exclude", "refused"), "invented options are not accepted by an accept")

    def test_compound_categories_with_less_specific_are_a_live_fix(self):
        fix = {"answer_type": "choice", "key": "natural number", "options_source": "stem",
               "options": ["irrational", "rational", "integer", "whole number", "natural number"],
               "less_specific": ["rational", "integer", "whole number"]}
        e, _ = self.one(self.k7, rec("fix", "compound answer", "low", why_low="the option set is a policy call",
                                     book_quote="a whole number and a natural number", fix=fix), CONFIRMED)
        self.assertEqual((e["verdict"], e["confidence"]), ("fix", "low"))
        self.assertEqual((e["fields"]["answer"], e["fields"]["less_specific"]), ("E", ["B", "C", "D"]))
        self.assertIn("your call", "your call" if e["why_low"] else "")

    def test_an_exclude_may_carry_the_agents_derivation_and_it_is_never_applied(self):
        e, doc = self.one(self.k1, rec("exclude", "book error", note="the book drops a power",
                                       correct_answer="x^{3}", defect="the book's last line"))
        self.assertEqual(e["verdict"], "exclude")
        self.assertEqual(e["if_corrected"]["answer"], "x^{3}")
        self.assertIn("NOT APPLIED", e["if_corrected"]["status"])
        self.assertNotIn("fields", e)
        self.assertEqual(doc["report"]["corrections_proposed"], [self.k1])

    def test_a_hold_of_an_unusable_typed_shape_is_an_exclude(self):
        e, _ = self.one(self.k3, rec("hold", "marker cannot check", note="x"))
        self.assertEqual(e["verdict"], "exclude")
        self.assertIn("cannot be emitted", e["note"])
        e, _ = self.one(self.k1, rec("hold", "marker cannot check", note="x"))
        self.assertEqual(e["verdict"], "hold", "a held item with a well-formed shape can be held")

    def test_a_stem_repair_is_small_flagged_and_low_confidence(self):
        es = [{"key": "g10m9s1-1:Ex9-1:8", "lesson": "g10m9s1-1", "ref": "Ex9-1:8", "state": "held",
               "item": item("Ex9-1:8", stem="Simplify: $\\frac{a-4}{a+5a+4}$", solution=["$\\frac{a-4}{(a+4)(a+1)}=\\frac{1}{a+4}$"],
                            printed_answer="1 a+4", epub_final_answer="$=\\frac{1}{a+4}$", answer="\\frac{1}{a+4}",
                            marker={"kind": "expression", "key": "\\frac{1}{a+4}", "form": None, "variables": ["a"], "tolerance": None})}]
        run = {"results": [{"key": es[0]["key"], "rec": rec("fix", "item wording", "high", book_quote="\\frac{a-4}{(a+4)(a+1)}",
                                                            fix={"stem": "Simplify: $\\frac{a-4}{a^2+5a+4}$"}), "ver": CONFIRMED}]}
        e = G.collect(es, [run], marker_fn=lambda rows: {}, identity_fn=lambda rows: {})["items"][es[0]["key"]]
        self.assertEqual((e["verdict"], e["confidence"]), ("fix", "low"), "a stem repair is always 'your call'")
        self.assertEqual(list(e["fields"]), ["stem"])
        self.assertIn("not Samuel", e["stem_fix_by"])
        self.assertIn("repaired", e["why_low"])
        run["results"][0]["rec"]["fix"]["stem"] = "A different question about $a$ entirely, please do it"
        e = G.collect(es, [run], marker_fn=lambda rows: {}, identity_fn=lambda rows: {})["items"][es[0]["key"]]
        self.assertEqual((e["verdict"], e["class"]), ("hold", "refused"), "a rewrite is not a repair")

    def test_a_teaching_only_retype_is_not_verified_and_is_low_confidence(self):
        e, _ = self.one(self.k2, rec("fix", "several parts", "high", fix={"answer_type": "not_markable", "not_markable_reason": "several parts"}))
        self.assertEqual((e["verdict"], e["confidence"]), ("fix", "low"))
        self.assertNotIn("verified", e)
        self.assertEqual(e["fields"]["answer_type"], "not_markable")

    def test_the_apps_marker_has_a_say(self):
        e, _ = self.one(self.k1, rec(book_quote="x^{2}"), CONFIRMED,
                        marker_fn=lambda rows: {r["id"]: "the app's marker cannot read the key 'x^{2}': nope" for r in rows})
        self.assertEqual((e["verdict"], e["class"]), ("hold", "marker cannot check"))

    def test_unanswered_items_are_listed_and_a_prior_file_fills_them(self):
        doc = collect(self.es, {self.k1: (rec(book_quote="x^{2}"), CONFIRMED)})
        self.assertEqual(set(doc["unanswered"]), {self.k2, self.k3, self.k7})
        self.assertEqual(doc["report"]["unanswered"], doc["unanswered"])
        again = collect(self.es, {self.k2: (rec("exclude", "book error"), None)}, prior=doc)
        self.assertEqual(set(again["items"]), {self.k1, self.k2}, "keys the new run did not answer keep the earlier recommendation")
        self.assertEqual(again["items"][self.k1], doc["items"][self.k1])

    def test_off_task_answers_are_ignored_and_a_stale_prompts_version_refused(self):
        run = {"results": [{"key": "g10m9s1-1:Ex9-1:99", "rec": rec("exclude")}]}
        self.assertEqual(G.collect(self.es, [run], marker_fn=lambda r: {}, identity_fn=lambda r: {})["report"]["off_task"], ["g10m9s1-1:Ex9-1:99"])
        with self.assertRaises(G.RecommendError):
            G.collect(self.es, [{"prompts_version": "g2rec-v0", "results": []}], marker_fn=lambda r: {}, identity_fn=lambda r: {})

    def test_every_entry_is_what_g2_merge_reads(self):
        doc = collect(self.es, {self.k1: (rec(book_quote="x^{2}"), CONFIRMED), self.k2: (rec("exclude", "book error"), None)})
        for e in doc["items"].values():
            self.assertIn(e["verdict"], ("accept", "fix", "hold", "exclude"))
            self.assertIn(e["confidence"], ("high", "low"))
            self.assertTrue(e["note"])
        self.assertIsNone(doc["by"], "unsigned: g2_merge signs every verdict auto-pass G2 (AI recommendation)")
        self.assertIn("never a review", doc["status"])


# ---------------------------------------------------------------------------------------------- the two deterministic oracles
class Oracles(unittest.TestCase):
    """The app's own marker as an identity oracle: is the key equal to the expression the stem asks to transform, and to the answer
    the book states? No model: a verdict an agent would put live is held when the marker says no."""

    def test_which_stems_are_identities(self):
        self.assertEqual(G.identity_expr("Simplify: $\\dfrac{a}{b}$"), "\\dfrac{a}{b}")
        self.assertEqual(G.identity_expr("Answer the following: Expand: $(3a-\\dfrac{1}{2a})^2$"), "(3a-\\dfrac{1}{2a})^2")
        self.assertEqual(G.identity_expr("Factorise the following: $16x^6-3y^8$"), "16x^6-3y^8")
        self.assertEqual(G.identity_expr("Simplify (assume all denominators are non-zero): $\\dfrac{1}{x}$"), "\\dfrac{1}{x}")
        self.assertIsNone(G.identity_expr("Solve: $x+1=2$"))
        self.assertIsNone(G.identity_expr("Simplify $a$ and $b$"), "two segments: not one expression")
        self.assertIsNone(G.identity_expr("What is $x$?"))

    def test_where_the_book_states_its_answer(self):
        it = item("Ex9-1:1", epub_final_answer="$=\\frac{1}{a+4}$",
                  solution=["$\\begin{align*}x&=2\\\\&=\\frac{1}{a+4}\\end{align*}$", "Note restriction: $a\\ne-4$ ."])
        c = G.book_candidates(it, "\\frac{1}{a+4}")
        self.assertEqual(c[0], "\\frac{1}{a+4}")
        self.assertEqual(len(c), len(set(c)), "each place once")
        self.assertIn("Note restriction: a\\ne-4", c[-1], "prose is a candidate the marker simply cannot read")
        self.assertEqual(G.book_candidates(item("x", epub_final_answer="x = \\frac{2}{3}", solution=["x"]), None)[0], "\\frac{2}{3}")

    def test_the_policy_holds_what_the_oracle_refuses(self):
        es = entries_of()
        k1 = "g10m9s1-1:Ex9-1:1"
        r = rec(book_quote="x^{2}")
        e = collect(es, {k1: (r, CONFIRMED)}, identity_fn=lambda rows: {x["id"]: "different" for x in rows if "#" not in x["id"]}
                    )["items"][k1]
        self.assertEqual((e["verdict"], e["class"]), ("hold", "unconfirmed"))
        self.assertIn("NOT equal to the expression the stem asks to transform", e["note"])
        e = collect(es, {k1: (r, CONFIRMED)}, identity_fn=lambda rows: {x["id"]: "different" for x in rows if "#" in x["id"]}
                    )["items"][k1]
        self.assertEqual((e["verdict"], e["class"]), ("hold", "not grounded"))
        self.assertIn("Samuel's to approve", e["note"])
        e = collect(es, {k1: (r, CONFIRMED)}, identity_fn=lambda rows: {x["id"]: "equal" for x in rows})["items"][k1]
        self.assertEqual(e["verdict"], "accept")
        self.assertEqual((e["verified"]["app_marker_identity"], e["verified"]["app_marker_book_answer"]), ("equal", "equal"))
        e = collect(es, {k1: (r, CONFIRMED)}, identity_fn=lambda rows: {x["id"]: "unreadable" for x in rows})["items"][k1]
        self.assertEqual(e["verdict"], "accept", "no signal is not a veto")
        self.assertNotIn("app_marker_identity", e["verified"])

    def test_agreement_is_equal_if_any_place_agrees_and_different_only_if_all_it_read_differ(self):
        res = {"k#0": "different", "k#1": "unreadable", "j#0": "different", "j#1": "equal", "m#0": "unreadable"}
        self.assertEqual(G.agreement_of(res, "k"), "different")
        self.assertEqual(G.agreement_of(res, "j"), "equal")
        self.assertIsNone(G.agreement_of(res, "m"))
        self.assertIsNone(G.agreement_of(res, "absent"))

    @unittest.skipUnless(NODE and (EX.parent.parent / "app" / "src" / "lib" / "answer-marker.ts").exists(), "needs node and the app's marker")
    def test_the_real_marker_on_the_pilot_style_cases(self):
        def after(stem, key, variables, **kw):
            return item("Ex9-1:1", stem=stem, marker={"kind": "expression", "key": key, "form": None, "variables": variables, "tolerance": None},
                        answer=key, **kw)
        right = after("Simplify: $\\dfrac{5}{t-2}-\\dfrac{1}{t-3}$", "\\frac{4t-13}{(t-2)(t-3)}", ["t"])
        wrong = after("Simplify: $\\dfrac{5}{t-2}-\\dfrac{1}{t-3}$", "\\frac{4t-12}{(t-2)(t-3)}", ["t"])
        res = G.run_identity_check(G.identity_rows({"right": right, "wrong": wrong}))
        self.assertEqual(res, {"right": "equal", "wrong": "different"})
        # a key the typing agent corrected is not the book's: the book's own last line says 2jklabc
        typed = after("Factorise: $8j^{3}k^{3}l^{3}-b^{3}$", "(2jkl-b)(4j^2k^2l^2+2jklb+b^2)", ["b", "j", "k", "l"],
                      epub_final_answer=None, solution=["$\\begin{align*}8j^3k^3l^3-b^3&=(2jkl-b)(4j^2k^2l^2+2jklabc+b^2)\\end{align*}$"])
        quote = "(2jkl-b)(4j^2k^2l^2+2jklabc+b^2)"
        rows = G.agreement_rows({"k": typed}, {"k": quote})
        self.assertTrue(rows)
        self.assertEqual(G.agreement_of(G.run_identity_check(rows), "k"), "different")
        # ... while the identity oracle is satisfied (the key IS equal to the stem's expression): the two oracles are independent
        self.assertEqual(G.run_identity_check(G.identity_rows({"k": typed}))["k"], "equal")

    @unittest.skipUnless(NODE and (EX.parent.parent / "app" / "src" / "lib" / "answer-marker.ts").exists(), "needs node and the app's marker")
    def test_a_silent_correction_never_goes_live(self):
        typed = item("Ex9-1:1", stem="Factorise: $8j^{3}k^{3}l^{3}-b^{3}$", answer="(2jkl-b)(4j^2k^2l^2+2jklb+b^2)",
                     marker={"kind": "expression", "key": "(2jkl-b)(4j^2k^2l^2+2jklb+b^2)", "form": "factorised", "variables": ["b", "j", "k", "l"],
                             "tolerance": None},
                     epub_final_answer=None, printed_answer="(2jkl −b)(4j2k2l2 + 2jklabc + b2)",
                     solution=["$\\begin{align*}8j^3k^3l^3-b^3&=(2jkl-b)(4j^2k^2l^2+2jklabc+b^2)\\end{align*}$"],
                     typing_problems=["book_final is not in the book solution", "the key does not read as the printed answer"])
        es = [{"key": "g10m9s1-1:Ex9-1:1", "lesson": "g10m9s1-1", "ref": "Ex9-1:1", "state": "excluded", "item": typed}]
        run = {"results": [{"key": es[0]["key"], "rec": rec("accept", "check too strict", book_quote="(2jkl-b)(4j^2k^2l^2+2jklabc+b^2)"),
                            "ver": CONFIRMED}]}
        doc = G.collect(es, [run])                                   # the real marker, the real oracles
        e = doc["items"][es[0]["key"]]
        self.assertEqual((e["verdict"], e["class"]), ("exclude", "not grounded"),
                         "the key is right for the stem but is not the book's: an accept would correct the book silently")
        self.assertEqual(doc["report"]["app_marker_identity_of_the_typed_key"]["equal"], [es[0]["key"]])


# ---------------------------------------------------------------------------------------------- the file reaches G2
class ReachesG2(unittest.TestCase):
    """The collected file through auto_pass_gates.g2_merge and assemble_objectives.lesson_runs: the pilot's route."""

    def test_through_g2_merge_and_the_lesson_runs_split(self):
        import assemble_objectives as ao
        run, g2 = make_run()
        es = G.recommendable([run], 9, "g10m", g2)
        k1, k2, k7 = ("g10m9s1-1:Ex9-1:" + n for n in "127")
        fix = {"answer_type": "expression", "key": "\\frac{1}{2}", "marker_kind": "expression", "variables": []}
        doc = collect(es, {k1: (rec(book_quote="x^{2}"), CONFIRMED),
                           k2: (rec("fix", "typing error", book_quote="\\frac{1}{2}", fix=fix), CONFIRMED),
                           k7: (rec("exclude", "partial answer"), None)})
        owed = A.g2_items(run, 9, "g10m")
        merged, counts, decisions = A.g2_merge(owed, doc, g2)
        self.assertEqual(counts["recommended"], 3)
        self.assertEqual(merged["items"][k1]["verdict"], "accept")
        self.assertEqual(merged["items"][k2]["fields"]["answer_type"], "expression")
        self.assertEqual(merged["items"]["g10m9s1-1:Ex9-1:6"]["by"], "Samuel Toma", "a person's verdict is kept")
        self.assertTrue(all(merged["items"][k]["by"] == "auto-pass G2 (AI recommendation)" for k in (k1, k2, k7)))
        basis = {d["key"]: d["basis"] for d in decisions}
        self.assertIn("confidence high", basis[k1])
        # the split: the fix is applied to the item and validated by the pipeline's own model; the unrecommended item (Ex9-1:3) is
        # still excluded by its typing problems' rule
        merged["items"]["g10m9s1-1:Ex9-1:3"] = {"verdict": "exclude", "auto": True, "by": "auto-pass G2 (AI recommendation)", "note": "rule"}
        recs = ao.lesson_runs(copy.deepcopy(run), merged)
        items = {i["ref"]: i for i in recs["g10m9s1-1"]["items"]}
        self.assertEqual(items["Ex9-1:2"]["answer_type"], "expression")
        self.assertEqual(items["Ex9-1:2"]["marker"]["key"], "\\frac{1}{2}")
        self.assertTrue(items["Ex9-1:2"]["g2"]["auto"])
        self.assertEqual(items["Ex9-1:2"]["g2"]["verdict"], "fix")
        self.assertIn("answer_type", items["Ex9-1:2"]["g2"]["changed"])
        self.assertEqual(items["Ex9-1:1"]["g2"]["verdict"], "accept")

    def test_the_gate_record_lists_the_low_confidence_verdicts_for_samuel(self):
        # decisions carry the basis "<class> · confidence low": the console shows them as 'your call'
        run, g2 = make_run()
        es = G.recommendable([run], 9, "g10m", g2)
        k1 = "g10m9s1-1:Ex9-1:1"
        doc = collect(es, {k1: (rec("hold", "needs the page image", "low", why_low="only the page can settle it"), None)})
        _, _, decisions = A.g2_merge(A.g2_items(run, 9, "g10m"), doc, g2)
        d = next(x for x in decisions if x["key"] == k1)
        self.assertEqual(d["decision"], "hold")
        self.assertIn("confidence low", d["basis"])

    def test_the_commands_name_the_chapters_own_files_and_the_right_order(self):
        cmds = G.follow_ups("g10-math", 1, ["runs/g10-math/lessons/a.json", "runs/g10-math/lessons/b.json"],
                            recommended="runs/g10-math/g2-ch01.recommended.json", g2_file="runs/g10-math/g2-ch01.json", run_label="wf_a, wf_b")
        text = "\n".join(cmds)
        self.assertEqual(text.count("--lesson-run"), 4)
        self.assertNotIn("runs/g10-math/g2.json", text, "the pilot's file is never the target")
        order = [text.index(x) for x in ("g2-recommend-collect", " g2 g10-math", "assemble_lesson_bundle", "--validate-only", "pg_dump",
                                         "load_seed.py seed/g10-math/g10m-course.json seed/g10-math/g10m-c01.json --course",
                                         "apply_review_verdicts")]
        self.assertEqual(order, sorted(order))
        self.assertIn("--update --dry-run", text)
        self.assertIn("--split", text)
        self.assertIn("fanout.py close-chapter 1", text)
        self.assertTrue(any(c.startswith("pg_dump") for c in cmds), "a fresh dump before the update")


class TheCommands(unittest.TestCase):
    """auto_pass_gates.py g2 / g2-recommend-args / g2-recommend-collect, end to end on a synthetic chapter (no model, no database)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="g2rec_cli_"))
        self.run, self.g2 = make_run()
        (self.tmp / "run.json").write_text(json.dumps(self.run))
        (self.tmp / "g2.json").write_text(json.dumps(self.g2))
        self.es = G.recommendable([self.run], 9, "g10m", self.g2)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def cli(self, *argv) -> tuple[int, str, str]:
        import contextlib
        import io
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = A.main([str(x) for x in argv])
        return code, out.getvalue(), err.getvalue()

    def test_g2_with_a_recommendation_writes_the_record_with_low_confidence_for_samuel(self):
        k1, k2, k3, k7 = (e["key"] for e in self.es)
        doc = collect(self.es, {k1: (rec(book_quote="x^{2}"), CONFIRMED),
                                k3: (rec("hold", "needs the page image", "low", why_low="only the page can settle it"), None),
                                k7: (rec("exclude", "partial answer"), None)})
        (self.tmp / "rec.json").write_text(json.dumps(doc))
        gates = self.tmp / "gates"
        code, out, err = self.cli("g2", "g10-math", "--chapter", 9, "--lesson-run", self.tmp / "run.json", "--recommend", self.tmp / "rec.json",
                                  "--into", self.tmp / "g2.json", "--gates-dir", gates)
        self.assertEqual(code, 0, err)
        record = json.loads((gates / "g2-ch09.json").read_text())
        self.assertEqual(record["gate"], "G2")
        self.assertEqual(record["outcome"], "pass_with_holds")
        self.assertIn(k3, record["for_review"], "a recommended hold is listed for Samuel")
        self.assertIn(k7, record["for_review"], "so is an exclusion")
        self.assertTrue(any(c["name"].startswith("G2 recommendation run") for c in record["checks"]))
        self.assertIn("low confidence", record["summary"])
        verdicts = json.loads((self.tmp / "g2.json").read_text())["items"]
        self.assertEqual(verdicts[k1]["verdict"], "accept")
        self.assertEqual(verdicts["g10m9s1-1:Ex9-1:6"]["by"], "Samuel Toma", "the person's verdict is kept")
        # idempotent
        before = (self.tmp / "g2.json").read_text()
        self.cli("g2", "g10-math", "--chapter", 9, "--lesson-run", self.tmp / "run.json", "--recommend", self.tmp / "rec.json",
                 "--into", self.tmp / "g2.json", "--gates-dir", gates)
        self.assertEqual((self.tmp / "g2.json").read_text(), before)

    def test_without_the_recommendation_a_rerun_goes_back_to_the_checks_rule(self):
        # why fanout.py close-chapter passes the recommendation file once it exists
        k1 = self.es[0]["key"]
        (self.tmp / "rec.json").write_text(json.dumps(collect(self.es, {k1: (rec(book_quote="x^{2}"), CONFIRMED)})))
        args = ["g2", "g10-math", "--chapter", 9, "--lesson-run", self.tmp / "run.json", "--into", self.tmp / "g2.json",
                "--gates-dir", self.tmp / "gates"]
        self.cli(*args, "--recommend", self.tmp / "rec.json")
        self.assertIn(k1, json.loads((self.tmp / "g2.json").read_text())["items"])
        self.cli(*args)
        self.assertNotIn(k1, json.loads((self.tmp / "g2.json").read_text())["items"],
                         "an auto verdict nothing supports any more is dropped: the recommendation must be passed every time")

    def test_args_builds_the_copy_and_prints_the_cost_and_the_follow_ups(self):
        copy_ = self.tmp / "out" / "g2rec-ch09.workflow.js"
        code, out, err = self.cli("g2-recommend-args", "g10-math", "--chapter", 9, "--lesson-run", self.tmp / "run.json",
                                  "--g2", self.tmp / "g2.json", "--embed", copy_, "--args-out", self.tmp / "out" / "a.json")
        self.assertEqual(code, 0, err)
        self.assertIn("4 item(s) (1 held with no verdict, 3 excluded for typing)", out)
        self.assertIn("run it with Workflow scriptPath and NO args", out)
        self.assertIn("g2-recommend-collect", out)
        self.assertEqual(embed_workflow.verify(copy_), [])
        self.assertEqual(json.loads((self.tmp / "out" / "a.json").read_text())["items_sha256"], G.items_sha256(self.es))
        code, out, _ = self.cli("g2-recommend-args", "g10-math", "--chapter", 9, "--lesson-run", self.tmp / "run.json",
                                "--g2", self.tmp / "g2.json")
        self.assertIn("nothing written", out)

    def test_only_missing_leaves_out_what_a_file_already_covers(self):
        k1 = self.es[0]["key"]
        (self.tmp / "rec.json").write_text(json.dumps({"items": {k1: {"verdict": "exclude"}}}))
        code, out, _ = self.cli("g2-recommend-args", "g10-math", "--chapter", 9, "--lesson-run", self.tmp / "run.json",
                                "--g2", self.tmp / "g2.json", "--only-missing", self.tmp / "rec.json")
        self.assertIn("3 item(s)", out)

    @unittest.skipUnless(NODE, "node is needed to run the workflow under the stub runtime")
    def test_collect_from_a_saved_run_and_a_stale_packet_is_refused(self):
        info = G.prepare(book_config.load_book("g10-math"), 9, [self.tmp / "run.json"], self.tmp / "g2.json", self.tmp / "g2rec-ch09.workflow.js")
        k1, k2, k3, k7 = (e["key"] for e in self.es)
        rows = {k1: rec(book_quote="x^{2}"), k2: rec("fix", "typing error", book_quote="\\frac{1}{2}".replace("\\\\", "\\"),
                fix={"answer_type": "expression", "key": "\\frac{1}{2}".replace("\\\\", "\\"), "marker_kind": "expression"}),
                k3: rec("exclude", "stem damaged"), k7: rec("exclude", "partial answer")}
        out = run_stub(Path(info["copies"][0]["script"]),
                       {"stub": {"rec": rows, "ver": {k1: WorkflowUnderTheStub.VER, k2: WorkflowUnderTheStub.VER}}}, self.tmp)
        self.assertTrue(out["ok"], out["error"])
        saved = self.tmp / "ch09-wf_test.json"
        saved.write_text(json.dumps(out["result"]))
        target = self.tmp / "g2-ch09.recommended.json"
        code, text, err = self.cli("g2-recommend-collect", "g10-math", "--chapter", 9, "--lesson-run", self.tmp / "run.json",
                                   "--g2", self.tmp / "g2.json", "--run", saved, "--out", target)
        self.assertEqual(code, 0, err)
        doc = json.loads(target.read_text())
        self.assertEqual({k: v["verdict"] for k, v in doc["items"].items()}, {k1: "accept", k2: "fix", k3: "exclude", k7: "exclude"})
        self.assertIn("would be LIVE", text)
        self.assertEqual(list(doc["from_runs"].values())[0], out["result"]["embedded"]["generated_sha256"])
        # a person decided an item after the packet was built: the run no longer matches, and the collector says so
        g2 = json.loads((self.tmp / "g2.json").read_text())
        g2["items"][k1] = {"verdict": "accept", "by": "Samuel Toma"}
        (self.tmp / "g2.json").write_text(json.dumps(g2))
        code, text, err = self.cli("g2-recommend-collect", "g10-math", "--chapter", 9, "--lesson-run", self.tmp / "run.json",
                                   "--g2", self.tmp / "g2.json", "--run", saved, "--out", self.tmp / "other.json")
        self.assertEqual(code, 2)
        self.assertIn("no longer matches", err)
        code, text, err = self.cli("g2-recommend-collect", "g10-math", "--chapter", 9, "--lesson-run", self.tmp / "run.json",
                                   "--g2", self.tmp / "g2.json", "--run", saved, "--out", self.tmp / "other.json", "--allow-stale")
        self.assertEqual(code, 0, err)
        self.assertIn(k1, json.loads((self.tmp / "other.json").read_text())["report"]["off_task"], "a person's item is off task")


class FanoutHook(unittest.TestCase):
    """fanout.py close-chapter: passes the recommendation file to G2 once it exists (or a re-run would undo it) and prepares the copy."""

    def setUp(self):
        import fanout as F
        self.F = F
        self.tmp = Path(tempfile.mkdtemp(prefix="g2rec_fanout_"))
        t = self.tmp
        (t / "lessons").mkdir()
        run, g2 = make_run()
        (t / "lessons" / "wf_aaaaaaaa-aaa.json").write_text(json.dumps(run))
        (t / "g2-ch09.json").write_text(json.dumps(g2))
        plan = {"runs": [{"id": "lesson-g10m9s1-1", "stage": "S2-S4", "chapter": 9}]}
        (t / "plan.json").write_text(json.dumps(plan))
        self.keep = (F.PLAN_PATH, F.RUNS, F.status, F.EMBED, F.PACKETS)
        F.PLAN_PATH, F.RUNS, F.EMBED, F.PACKETS = t / "plan.json", t, t / "embedded", t / "packets"
        F.status = lambda: {"runs": [{"id": "lesson-g10m9s1-1", "saved": "runs/g10-math/lessons/wf_aaaaaaaa-aaa.json"}]}

    def tearDown(self):
        F = self.F
        F.PLAN_PATH, F.RUNS, F.status, F.EMBED, F.PACKETS = self.keep
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_the_dry_run_sizes_the_recommendation_and_passes_the_file_only_once_it_exists(self):
        out = self.F.close_chapter(9, dry_run=True)
        self.assertNotIn("--recommend", out["commands"][0])
        self.assertEqual(out["g2_recommend"]["items"], 4)
        self.assertEqual(out["g2_recommend"]["by_state"], {"held": 1, "excluded": 3})
        self.assertFalse(out["g2_recommend"]["recommendation_file_exists"])
        self.assertEqual(out["then"], ["fanout.py config 9", "fanout.py prepare wcheck-ch09", "fanout.py prepare s5-draft-ch09"],
                         "the plan's own steps are unchanged")
        (self.tmp / "g2-ch09.recommended.json").write_text(json.dumps({"items": {}}))
        out = self.F.close_chapter(9, dry_run=True)
        self.assertIn("--recommend", out["commands"][0], "a re-run without it would undo the recommendation")
        self.assertIn("g2-ch09.recommended.json", out["commands"][0])
        self.assertTrue(out["g2_recommend"]["recommendation_file_exists"])

    def test_prepare_g2rec_builds_the_copy_and_the_commands(self):
        files = [self.tmp / "lessons" / "wf_aaaaaaaa-aaa.json"]
        info = self.F.prepare_g2rec(9, files, ["wf_aaaaaaaa-aaa"])
        self.assertEqual((info["stage"], info["items"], info["by_state"]), ("G2R", 4, {"held": 1, "excluded": 3}))
        self.assertEqual(len(info["copies"]), 1)
        self.assertTrue(info["copies"][0].endswith("g2rec-ch09.workflow.js"))
        self.assertTrue((self.tmp / "packets" / "g2rec-ch09.args.json").exists())
        self.assertEqual(info["agents"], 1 + 1)
        self.assertLess(info["cost_usd"][0], info["cost_usd"][1])
        self.assertIn("--stage G2R", info["meter"])
        self.assertIn("g2rec/ch09-<runId>.json", info["save_to"])
        self.assertIn("BEFORE", info["launch"])
        self.assertTrue(any("g2-recommend-collect" in c for c in info["after"]))
        # idempotent: the same bytes
        copy_ = self.tmp / "embedded" / "g2rec-ch09.workflow.js"
        before = copy_.read_bytes()
        self.F.prepare_g2rec(9, files, ["wf_aaaaaaaa-aaa"])
        self.assertEqual(copy_.read_bytes(), before)


# ---------------------------------------------------------------------------------------------- the workflow, under the stub
RESPONDER = """
// a canned responder: rec rows from stub.rec (by item id), ver rows from stub.ver; stub.omit_first drops an item from the first answer
export async function respond({ label, prompt, schema, phase, args, stub }) {
  const keys = [...prompt.matchAll(/^\\[([^\\]\\n]+)\\] /gm)].map((m) => m[1])
  stub.seen = stub.seen || {}
  if (label.includes(':rec:')) {
    const first = !label.endsWith(':again')
    const rows = keys.filter((k) => !(first && (stub.omit_first || []).includes(k))).map((k) => Object.assign({ key: stub.bracket ? `[${k}]` : k }, stub.rec[k]))
    return { results: rows.concat(first ? (stub.extra_rec || []) : []) }
  }
  return { results: keys.map((k) => Object.assign({ key: k }, stub.ver[k])) }
}
"""


def run_stub(script: Path, fixture: dict, tmp: Path) -> dict:
    (tmp / "responder.mjs").write_text(RESPONDER)
    fixture = dict(fixture, responder=str(tmp / "responder.mjs"), args={})
    (tmp / "fx.json").write_text(json.dumps(fixture))
    r = subprocess.run([NODE, str(STUB), str(script), str(tmp / "fx.json")], capture_output=True, text=True, timeout=120)
    return json.loads(r.stdout)


@unittest.skipUnless(NODE, "node is needed to run the workflow under the stub runtime")
class WorkflowUnderTheStub(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="g2rec_"))
        cls.lrun, cls.g2 = make_run()
        (cls.tmp / "run.json").write_text(json.dumps(cls.lrun))
        (cls.tmp / "g2.json").write_text(json.dumps(cls.g2))
        cls.book = book_config.load_book("g10-math")
        cls.info = G.prepare(cls.book, 9, [cls.tmp / "run.json"], cls.tmp / "g2.json", cls.tmp / "g2rec-ch09.workflow.js", batch=3)
        cls.script = Path(cls.info["copies"][0]["script"])
        cls.keys = [e["key"] for e in G.recommendable([cls.lrun], 9, "g10m", cls.g2)]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def stub(self, rec, ver, **kw):
        return run_stub(self.script, {"stub": {"rec": rec, "ver": ver, **kw}, **{k: v for k, v in kw.items() if k == "responses"}}, self.tmp)

    def rows(self, **over):
        k1, k2, k3, k7 = self.keys
        base = {k1: rec(book_quote="x^{2}", note="REC-NOTE-88"),
                k2: rec("fix", "typing error", book_quote="\\frac{1}{2}",
                        fix={"answer_type": "expression", "key": "\\frac{1}{2}", "marker_kind": "expression"}),
                k3: rec("exclude", "stem damaged", note="the list is not in the stem"),
                k7: rec("hold", "marker cannot check")}
        base.update(over)
        return base

    VER = {"own_answer": "x^2", "verdict": "confirmed", "other_correct_answers": False, "note": "ok"}

    def test_the_copy_is_the_script_with_its_packet_and_verifies(self):
        self.assertEqual(embed_workflow.verify(self.script), [])
        a = embed_workflow.read_args(self.script)
        self.assertEqual((a["stage"], a["chapter"], len(a["items"]), a["batch"]), ("G2R", 9, 4, 3))
        text = self.script.read_text()
        self.assertTrue(text.startswith("export const meta = "))
        self.assertEqual(G.prepare(self.book, 9, [], None, None)["items"], 0, "no run: nothing owes a recommendation")

    def test_a_copy_refuses_args_and_a_plain_script_refuses_to_run(self):
        # the generated copy takes no args; the runbook script itself is only ever run as a copy
        plain = run_stub(WORKFLOW, {"stub": {}}, self.tmp)
        self.assertFalse(plain["ok"])
        self.assertIn("generated copy", plain["error"])

    def test_one_recommender_per_batch_and_a_verifier_only_for_what_would_go_live(self):
        k1, k2, k3, k7 = self.keys
        out = self.stub(self.rows(), {k1: self.VER, k2: self.VER})
        self.assertTrue(out["ok"], out["error"])
        calls = out["calls"]
        recs = [c for c in calls if ":rec:" in c["label"]]
        vers = [c for c in calls if ":ver:" in c["label"]]
        self.assertEqual(len(recs), 2, "4 items in batches of 3")
        self.assertEqual(len(vers), 1, "only k1 (accept) and k2 (fix) are verified, and they sit in the first batch")
        for c in calls:
            self.assertEqual((c["model"], c["effort"]), ("sonnet", "high"))
        self.assertEqual({c["phase"] for c in recs}, {"G2R Recommend"})
        self.assertEqual({c["phase"] for c in vers}, {"G2R Verify"})
        for k in (k3, k7):
            self.assertNotIn(f"[{k}]", vers[0]["prompt"], "an exclude and a hold are never verified: they put nothing in front of a student")
        r = out["result"]
        self.assertEqual((r["stage"], r["workflow"], r["prompts_version"], r["chapter"]), ("G2R", "g2-recommend", "g2rec-v1", 9))
        self.assertEqual(r["keys"], self.keys)
        self.assertEqual(r["agents"], {"recommend": 2, "verify": 1})
        self.assertEqual(r["tally"], {"accept/confirmed": 1, "fix/confirmed": 1, "exclude": 1, "hold": 1})
        self.assertEqual(r["embedded"]["generated_sha256"], embed_workflow.embedded_info(self.script.read_text())["generated_sha256"],
                         "a saved run says which script ran")
        self.assertEqual(r["items_sha256"], embed_workflow.read_args(self.script)["items_sha256"])

    def test_the_recommender_sees_everything_the_verifier_is_blind_to(self):
        k1, k2, *_ = self.keys
        out = self.stub(self.rows(), {k1: self.VER, k2: self.VER})
        rec_prompt = next(c["prompt"] for c in out["calls"] if ":rec:b01" in c["label"])
        ver_prompt = next(c["prompt"] for c in out["calls"] if ":ver:" in c["label"])
        for must in ("BLIND-MARK-77", "BOOK WORKING", "PRINTED ANSWER", "THE THREE-WAY CHECK", "TYPING PROBLEMS", "x\\cdot x=x^{2}"):
            self.assertIn(must, rec_prompt)
        self.assertIn("APP MARKER, DETERMINISTIC", rec_prompt)
        self.assertIn("the typed key is EQUAL to the stem's expression", rec_prompt, "the marker's fact about the typed key is shown to the recommender")
        self.assertNotIn("APP MARKER", ver_prompt, "the verifier is not told what the marker found")
        self.assertNotIn("BLIND-MARK-77", ver_prompt, "the verifier never sees the blind solver's answer")
        self.assertNotIn("REC-NOTE-88", ver_prompt, "nor the recommender's reasoning")
        self.assertNotIn("THE THREE-WAY CHECK", ver_prompt)
        for must in ("THE KEY", "own_answer BEFORE you look at the key", "THE BOOK'S WORKING"):
            self.assertIn(must, ver_prompt)
        self.assertIn("\\frac{1}{2}", ver_prompt, "the key a fix proposes is what the verifier is asked about")
        self.assertIn("NEVER an option of your own", rec_prompt)
        self.assertIn("never accept it", rec_prompt)

    def test_an_item_the_agent_left_out_is_asked_again_once(self):
        k1, k2, *_ = self.keys
        out = self.stub(self.rows(), {k1: self.VER, k2: self.VER}, omit_first=[k2])
        again = [c for c in out["calls"] if c["label"].endswith(":again")]
        self.assertEqual(len(again), 1)
        self.assertIn(f"[{k2}]", again[0]["prompt"])
        self.assertNotIn(f"[{k1}]", again[0]["prompt"], "only the items left out are asked again")
        self.assertEqual(out["result"]["problems"], [])
        self.assertEqual(sum(1 for r in out["result"]["results"] if r["rec"]), 4)

    def test_a_dead_recommender_leaves_its_items_without_a_verdict(self):
        k1, k2, k3, k7 = self.keys
        labels = [c["label"] for c in self.stub(self.rows(), {k1: self.VER, k2: self.VER})["calls"] if ":rec:" in c["label"]]
        out = self.stub(self.rows(), {k1: self.VER, k2: self.VER},
                        responses={labels[1]: None, labels[1] + ":again": None})
        self.assertTrue(out["ok"], out["error"])
        res = {r["key"]: r for r in out["result"]["results"]}
        self.assertIsNone(res[k7]["rec"], "the second batch's agent died twice")
        self.assertTrue(any(k7 in p for p in out["result"]["problems"]))
        self.assertIsNotNone(res[k1]["rec"])

    def test_a_dead_verifier_leaves_the_verdict_unconfirmed(self):
        k1, k2, *_ = self.keys
        ver_label = next(c["label"] for c in self.stub(self.rows(), {k1: self.VER, k2: self.VER})["calls"] if ":ver:" in c["label"])
        out = self.stub(self.rows(), {k1: self.VER, k2: self.VER}, responses={ver_label: None})
        self.assertTrue(out["ok"], out["error"])
        self.assertTrue(any("unconfirmed" in p for p in out["result"]["problems"]))
        self.assertEqual(out["result"]["tally"].get("accept/unverified"), 1)
        # the collector then recommends hold, never accept
        es = G.recommendable([self.lrun], 9, "g10m", self.g2)
        doc = G.collect(es, [out["result"]], marker_fn=lambda rows: {}, identity_fn=lambda rows: {})
        self.assertEqual(doc["items"][k1]["verdict"], "hold")
        self.assertEqual(doc["items"][k1]["class"], "unconfirmed")

    def test_a_teaching_only_retype_is_not_sent_to_the_verifier(self):
        k1, k2, *_ = self.keys
        rows = self.rows(**{k2: rec("fix", "several parts", fix={"answer_type": "not_markable", "not_markable_reason": "several parts"})})
        out = self.stub(rows, {k1: self.VER})
        ver = next(c["prompt"] for c in out["calls"] if ":ver:" in c["label"])
        self.assertNotIn(f"[{k2}]", ver)
        self.assertIn(f"[{k1}]", ver)

    def test_an_answer_for_another_batch_or_twice_is_ignored_and_reported(self):
        k1, k2, k3, k7 = self.keys
        extra = [dict(key=k7, **rec("accept", note="WRONG BATCH")), dict(key=k1, **rec("exclude", note="TWICE"))]
        out = self.stub(self.rows(), {k1: self.VER, k2: self.VER}, extra_rec=extra)
        self.assertTrue(out["ok"], out["error"])
        probs = " | ".join(out["result"]["problems"])
        self.assertIn("not an item of this batch", probs)
        self.assertIn("answered twice", probs)
        res = {r["key"]: r for r in out["result"]["results"]}
        self.assertEqual(res[k1]["rec"]["verdict"], "accept", "the first answer is kept")
        self.assertEqual(res[k7]["rec"]["verdict"], "hold", "the batch that owns k7 answered it")

    def test_an_id_written_with_its_brackets_is_read(self):
        k1, k2, *_ = self.keys
        out = self.stub(self.rows(), {k1: self.VER, k2: self.VER}, bracket=True)
        self.assertEqual(out["result"]["problems"], [])
        self.assertEqual(sum(1 for r in out["result"]["results"] if r["rec"]), 4)

    def test_the_classes_the_prompt_offers_are_the_classes_the_collector_knows(self):
        src = WORKFLOW.read_text()
        block = re.search(r"const CLASSES = \[(.*?)\n\]", src, re.S).group(1)
        js = tuple(re.findall(r"^\s*'([^']+)',", block, re.M))
        self.assertEqual(js, G.CLASSES)

    def test_collected_from_the_stubs_run_end_to_end(self):
        k1, k2, k3, k7 = self.keys
        out = self.stub(self.rows(), {k1: self.VER, k2: self.VER})
        es = G.recommendable([self.lrun], 9, "g10m", self.g2)
        doc = G.collect(es, [out["result"]], marker_fn=lambda rows: {}, identity_fn=lambda rows: {})
        self.assertEqual({k: v["verdict"] for k, v in doc["items"].items()}, {k1: "accept", k2: "fix", k3: "exclude", k7: "exclude"},
                         "k7's hold becomes exclude: its typed shape (invented options, no key) cannot be emitted")


# ---------------------------------------------------------------------------------------------- the app's own marker
@unittest.skipUnless(NODE and (EX.parent.parent / "app" / "src" / "lib" / "answer-marker.ts").exists(), "needs node and the app's marker")
class TheAppsMarker(unittest.TestCase):
    def test_a_readable_key_passes_and_a_spec_the_app_does_not_know_is_rejected(self):
        ok = {"kind": "expression", "key": "\\frac{27}{4}", "form": None, "variables": [], "tolerance": None}
        bad = {"kind": "expression", "key": "x", "form": "bogus_form", "variables": ["x"], "tolerance": None}
        unreadable = {"kind": "expression", "key": "\\sqrt{-}", "form": None, "variables": [], "tolerance": None}
        out = G.run_marker_check([{"id": "a", "choices": {"marker": ok}}, {"id": "b", "choices": {"marker": bad}},
                                  {"id": "c", "choices": {"marker": unreadable}}])
        self.assertNotIn("a", out)
        self.assertIn("b", out)
        self.assertIn("rejects the spec", out["b"])

    def test_a_fix_whose_key_the_marker_cannot_read_is_not_live(self):
        run, g2 = make_run()
        es = G.recommendable([run], 9, "g10m", g2)
        k2 = "g10m9s1-1:Ex9-1:2"
        fix = {"answer_type": "expression", "key": "\\frac{1}{2}", "marker_kind": "expression", "form": "", "variables": []}
        r = {"results": [{"key": k2, "rec": rec("fix", "typing error", book_quote="\\frac{1}{2}", fix=fix), "ver": CONFIRMED}]}
        doc = G.collect(es, [r])                                    # the real marker
        self.assertEqual(doc["items"][k2]["verdict"], "fix", doc["items"][k2]["note"])
        self.assertEqual(doc["report"]["live"], [k2])


# ---------------------------------------------------------------------------------------------- Grade 10's real chapters
CH1 = EX / "runs" / "g10-math" / "gates" / "g2-ch01.json"
CH2 = EX / "runs" / "g10-math" / "gates" / "g2-ch02.json"


@unittest.skipUnless(CH1.exists() and CH2.exists(), "Chapters 1 and 2 are not in this checkout")
class RealChapters(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.book = book_config.load_book("g10-math")

    def entries(self, ch):
        lr = G.record_runs(self.book, ch)
        g2p = EX / "runs" / "g10-math" / f"g2-ch{ch:02d}.json"
        g2 = json.loads(g2p.read_text()) if g2p.exists() else None
        return lr, G.recommendable([G.load_run(p) for p in lr], ch, "g10m", g2)

    def test_the_two_chapters_have_items_of_both_kinds_and_none_twice(self):
        for ch in (1, 2):
            _, es = self.entries(ch)
            self.assertTrue(es)
            self.assertEqual(len({e["key"] for e in es}), len(es))
            self.assertEqual({e["state"] for e in es}, {"held", "excluded"})
            self.assertTrue(all(e["key"].startswith(f"g10m{ch}s") for e in es))

    def test_the_known_cases_are_in_the_packet(self):
        _, es = self.entries(1)
        keys = {e["key"]: e for e in es}
        self.assertEqual(keys["g10m1s7-3:Ex1-9:11"]["state"], "held")
        self.assertEqual(keys["g10m1s7-3:Ex1-9:17"]["state"], "excluded")
        self.assertEqual(keys["g10m1s3-1:Ex1-1:4c"]["state"], "excluded")

    def test_the_packet_embeds_and_verifies_for_both_chapters(self):
        with tempfile.TemporaryDirectory() as t:
            for ch in (1, 2):
                lr, es = self.entries(ch)
                info = G.prepare(self.book, ch, lr, EX / "runs" / "g10-math" / f"g2-ch{ch:02d}.json", Path(t) / f"g2rec-ch{ch:02d}.workflow.js")
                self.assertEqual(info["items"], len(es))
                self.assertEqual(info["parts"], 1)
                for c in info["copies"]:
                    self.assertEqual(embed_workflow.verify(Path(c["script"])), [])
                    self.assertLess(c["bytes"], 1_000_000)

    def test_the_book_text_of_every_item_is_in_its_packet(self):
        _, es = self.entries(2)
        a = G.build_args(self.book, 2, es)
        for x in a["items"]:
            it = x["item"]
            self.assertTrue(it["solution"] and it["stem"], x["key"])


if __name__ == "__main__":
    unittest.main()

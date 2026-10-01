"""multipart.py: a part of a multi-part exercise carries what it depends on (2026-10-01).

    uv run --with pytest python -m pytest -q tests/test_multipart.py
    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/test_multipart.py   # + the DB half

The defect: the lesson assembly serves every part of a question on its own, so a later part's words can name points,
values or results that only an earlier part defines (Ex8-6:39d "Prove that ST ∥ PR", S and T being part (b)'s
mid-points). The calibration of the working checker found it (ch08.calibration.json); the rule is deterministic —
the question's shared words, then the names an earlier part introduces (R1), the preamble's unknowns an earlier
marked part works out (R2) and the gradients a worked answer uses without computing (R3) — and what it cannot settle
it lists. Every example here is invented for the test; none is the book's exercise.

@covers FR-4303
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

import _scratchdb  # noqa: F401  (puts services/extraction on sys.path)
from _scratchdb import EX, ScratchDB, run_loader, skip_without_db
import multipart as mp
from multipart import Part, plan

PRE = "Triangle $ABC$ has vertices $A(1;2)$ , $B(3;4)$ and $C(5;0)$ ."


def part(ref, tail, working="", *, pre=PRE, fate="verified", kind=None, key=None):
    return Part(ref=ref, stem=(pre + " " + tail).strip() if pre else tail, working=working, fate=fate, kind=kind, key=key)


def carried(parts):
    c, u = plan(parts)
    return c, u


class Preamble(unittest.TestCase):
    def test_the_shared_words_end_at_a_sentence(self):
        stems = ["Given $A(1;2)$ . Find the length of $AB$ .", "Given $A(1;2)$ . Find the gradient of $AB$ ."]
        ends = mp.preamble_end(stems)
        self.assertEqual([s[:e] for s, e in zip(stems, ends)], ["Given $A(1;2)$ ."] * 2)

    def test_the_words_the_tails_happen_to_share_are_not_the_preamble(self):
        # both tails begin "Find the" — the cut falls back to the sentence end before them
        stems = ["Given $A(1;2)$ . Find the length of $AB$ .", "Given $A(1;2)$ . Find the gradient of $AB$ ."]
        self.assertEqual(mp.preamble_end(stems)[0], len("Given $A(1;2)$ ."))

    def test_a_figure_or_a_colon_closes_the_preamble(self):
        a = "Refer to the diagram: [figure] Show that $ABC$ is right-angled ."
        b = "Refer to the diagram: [figure] Find the area of $ABC$ ."
        self.assertEqual(a[:mp.preamble_end([a, b])[0]], "Refer to the diagram: [figure]")

    def test_parts_with_nothing_in_common_share_no_preamble(self):
        self.assertEqual(mp.preamble_end(["Find $x$ .", "Solve for $y$ ."]), [0, 0])


class Names(unittest.TestCase):
    def test_glued_commands_do_not_hide_names(self):
        # S0b stores `\triangle PQR` and `ST \parallel PR` whitespace-stripped
        self.assertEqual(mp.names_in(r"Prove that $ST\parallelPR$ ."), {"S", "T", "P", "R"})
        self.assertEqual(mp.names_in(r"$\trianglePQR$"), {"P", "Q", "R"})
        self.assertEqual(mp.names_in(r"$\thereforeMP\perpLN$"), {"M", "P", "L", "N"})

    def test_an_operator_is_no_point(self):
        self.assertEqual(mp.names_in(r"$m_{AB}\timesm_{CD}=M_{AC}$"), {"A", "B", "C", "D"})
        self.assertEqual(mp.names_in(r"$\text{Area}=\frac{1}{2}bh$"), set(), "words are no point")
        self.assertEqual(mp.names_in(r"$x\in\mathbb{R}$"), set())

    def test_prose_names_are_all_capitals_of_two_or_more(self):
        self.assertEqual(mp.names_in("A line through PQRS is drawn"), {"P", "Q", "R", "S"})
        self.assertEqual(mp.names_in("A line is drawn"), set(), "the article A is no point")

    def test_a_function_of_one_variable_is_no_unknown_point(self):
        self.assertEqual(mp.unknown_points("Given $P(x)=x^3-2x$ and $Q(x;y)$ ."), {"Q": {"x", "y"}})

    def test_unknown_and_concrete_points(self):
        h = "$L(-1;-1)$ , $N(x;y)$ and $U(6;a)$ and $S(t+1,\\text{2,5})$ ; $P(4;0)$ ."
        self.assertEqual(mp.unknown_points(h), {"N": {"x", "y"}, "U": {"a"}, "S": {"t"}})
        self.assertEqual(mp.concrete_points(h), {"L", "P"})


class Definitions(unittest.TestCase):
    def read(self, tail):
        return [d.clause() for d in mp.definitions(tail)]

    def test_the_book_s_patterns(self):
        self.assertEqual(self.read("Find the coordinates of points $S$ and $T$ , the mid-points of $PQ$ and $QR$ ."),
                         ["$S$ and $T$ are the mid-points of $PQ$ and $QR$."])
        self.assertEqual(self.read("Determine the coordinates of $E$ , the mid-point of $BD$ ."),
                         ["$E$ is the mid-point of $BD$."])
        self.assertEqual(self.read("Find $T$ , the mid-point of $PQ$ ."), ["$T$ is the mid-point of $PQ$."])
        self.assertEqual(self.read("Find the mid-point $M$ of $AB$ ."), ["$M$ is the mid-point of $AB$."])
        self.assertEqual(self.read("Find the line from $P$ to $S$ ( the mid-point of $QR$ ) ."),
                         ["$S$ is the mid-point of $QR$."])
        self.assertEqual(self.read("Find the coordinates of $M$ where the diagonals meet ."),
                         ["$M$ is where the diagonals meet."])
        self.assertEqual(self.read("$S$ and $T$ are the mid-points of $PQ$ and $QR$ . Find the gradient of $ST$ ."),
                         ["$S$ and $T$ are the mid-points of $PQ$ and $QR$."])

    def test_a_question_or_a_condition_defines_nothing(self):
        for tail in ("Determine whether $M$ is the mid-point of $AB$ .", "If $M$ is the mid-point of $AB$ , find $x$ .",
                     "Is $M$ the mid-point of $AB$ ?", "Check if $D$ , the mid-point of $AB$ , lies on $l$ ."):
            self.assertEqual(self.read(tail), [], tail)
        self.assertEqual(self.read("Show that $M$ is the mid-point of $AB$ ."), ["$M$ is the mid-point of $AB$."])

    def test_a_point_of_intersection_reads_like_a_mid_point(self):
        self.assertEqual(self.read("Find the coordinates of $E$ , the point of intersection of $AB$ and $CD$ ."),
                         ["$E$ is the point of intersection of $AB$ and $CD$."])

    def test_what_the_rule_writes_it_reads_back_as_the_same_definition(self):
        """The invariant behind 'running it twice changes nothing': every sentence a Definition produces is read by
        `definitions` as that same Definition (so a part that already carries it is bound), and in its value form
        the point has its coordinates (bound by `point_bound`)."""
        tails = ["Find the coordinates of points $S$ and $T$ , the mid-points of $PQ$ and $QR$ .",
                 "Determine the coordinates of $E$ , the mid-point of $BD$ .",
                 "Find the line from $P$ to $S$ ( the mid-point of $QR$ ) .",
                 "Find the mid-point $M$ of $AB$ .",
                 "Find the coordinates of $M$ where the diagonals meet .",
                 "Find the coordinates of $M$ where the diagonals intersect .",
                 "$S$ and $T$ are the mid-points of $PQ$ and $QR$ ."]
        for tail in tails:
            for d in mp.definitions(tail):
                self.assertIn(d, mp.definitions(d.clause()), d.clause())
                if len(d.names) == 1:
                    self.assertIn(d.names[0], mp.point_bound(d.with_value("(1; 2)")), d.with_value("(1; 2)"))

    def test_a_value_goes_with_one_name_only(self):
        d = mp.definitions("Determine the coordinates of $E$ , the mid-point of $BD$ .")[0]
        self.assertEqual(d.with_value("(\\frac{1}{2};-\\frac{3}{2})"),
                         "$E(\\frac{1}{2};-\\frac{3}{2})$ is the mid-point of $BD$.")

    def test_words_that_define_nothing_read_as_nothing(self):
        self.assertEqual(self.read("Find the length of $AB$ ."), [])
        self.assertEqual(self.read("Show that $ABC$ is isosceles ."), [])


class R1Definitions(unittest.TestCase):
    def test_a_part_that_names_what_an_earlier_part_introduces_carries_it(self):
        a = part("Ex8-6:5a", "Find the coordinates of points $D$ and $E$ , the mid-points of $AB$ and $BC$ .",
                 "$D(2;3)$ and $E(4;2)$", fate="teaching")
        b = part("Ex8-6:5b", "Prove that $DE\\parallelAC$ .", "$m_{DE}=-\\frac{1}{2}=m_{AC}$")
        c, u = carried([a, b])
        self.assertEqual(set(c), {"Ex8-6:5b"})
        self.assertEqual(c["Ex8-6:5b"].after,
                         PRE + " $D$ and $E$ are the mid-points of $AB$ and $BC$. Prove that $DE\\parallelAC$ .")
        self.assertEqual([i["rule"] for i in c["Ex8-6:5b"].items], ["R1"])
        self.assertEqual(c["Ex8-6:5b"].before, b.stem)

    def test_the_names_a_worked_answer_uses_count_too(self):
        a = part("Ex8-6:6a", "Determine the coordinates of $E$ , the mid-point of $BC$ .", "$E(4;2)$", kind="coordinates",
                 key="(4; 2)")
        b = part("Ex8-6:6b", "Prove that $ABC$ is isosceles .", "$AE=CE$ because $M_{BC}=E$")
        c, u = carried([a, b])
        self.assertIn("$E(4; 2)$ is the mid-point of $BC$.", c["Ex8-6:6b"].after, "the book's key travels with its name")
        self.assertEqual(u, [])

    def test_the_value_travels_only_for_one_marked_point(self):
        for kw in ({"fate": "held", "kind": "coordinates", "key": "(1; 1)"},
                   {"kind": "expression", "key": "(1; 1)"},
                   {"kind": "coordinates", "key": "(1; 1), (2; 2)"}):
            a = part("Ex8-6:6a", "Determine the coordinates of $E$ , the mid-point of $BC$ .", **kw)
            b = part("Ex8-6:6b", "Prove that $E$ lies on $AB$ .")
            c, _ = carried([a, b])
            self.assertEqual(c["Ex8-6:6b"].sentences, ["$E$ is the mid-point of $BC$."], kw)

    def test_a_part_that_asks_for_the_point_itself_is_not_handed_its_value(self):
        a = part("Ex8-6:6a", "Determine the coordinates of $E$ , the mid-point of $BC$ .", kind="coordinates", key="(4; 2)")
        b = part("Ex8-6:6b", "Find the coordinates of $E$ if $E$ also lies on $AB$ .", kind="coordinates", key="(3; 3)")
        c, _ = carried([a, b])
        self.assertEqual(c["Ex8-6:6b"].sentences, ["$E$ is the mid-point of $BC$."], "the name, not the value it asks for")

    def test_a_part_that_has_the_name_already_carries_nothing(self):
        a = part("Ex8-6:5a", "Find the coordinates of $D$ , the mid-point of $AB$ .")
        own = part("Ex8-6:5b", "$D(2;3)$ is a point on $BC$ . Find $BD$ .")
        defd = part("Ex8-6:5c", "$D$ is the mid-point of $AB$ . Find $CD$ .")
        in_pre = part("Ex8-6:5d", "Find $AC$ .")          # A, B, C are the preamble's
        c, _ = carried([a, own, defd, in_pre])
        self.assertEqual(c, {})

    def test_independent_alternatives_carry_nothing(self):
        ps = [part("Ex8-2:5a", "$A(2;7)$ and $B(-3;5)$", pre="Find the length of $AB$ for each of the following ."),
              part("Ex8-2:5b", "$A(-3;5)$ and $B(-9;1)$", pre="Find the length of $AB$ for each of the following ."),
              part("Ex8-2:5c", "$A(x;y)$ and $B(x+4;y-1)$", pre="Find the length of $AB$ for each of the following .")]
        c, u = carried(ps)
        self.assertEqual((c, u), ({}, []))

    def test_a_figure_labels_its_own_names(self):
        pre = "Given the diagram : [figure]"
        ps = [part("Ex8-6:7a", "If $E$ is the mid-point of $AB$ , find $a$ .", pre=pre),
              part("Ex8-6:7b", "Find the gradient of $BC$ .", pre=pre),
              part("Ex8-6:7c", "Find the mid-point of $BD$ .", pre=pre)]
        c, u = carried(ps)
        self.assertEqual((c, u), ({}, []), "B, C, D are the figure's: nothing to carry, nothing to list")

    def test_two_earlier_parts_with_two_meanings_are_listed_not_guessed(self):
        a = part("Ex8-6:8a", "Find $D$ , the mid-point of $AB$ .")
        b = part("Ex8-6:8b", "Find $D$ , the mid-point of $BC$ .")
        c = part("Ex8-6:8c", "Prove that $AD=CD$ .")
        carries, unresolved = carried([a, b, c])
        self.assertNotIn("Ex8-6:8c", carries)
        self.assertEqual([x.reason for x in unresolved], ["conflict"])

    def test_running_the_rule_on_what_it_wrote_changes_nothing(self):
        a = part("Ex8-6:5a", "Find the coordinates of points $D$ and $E$ , the mid-points of $AB$ and $BC$ .")
        b = part("Ex8-6:5b", "Prove that $DE\\parallelAC$ .")
        first, _ = carried([a, b])
        again = Part("Ex8-6:5b", first["Ex8-6:5b"].after, b.working)
        second, _ = carried([a, again])
        self.assertEqual(second, {})
        # a packet-time carry of the same sentence, then the assembly: bound, so nothing again
        both = [Part("Ex8-6:5a", a.stem, ""), again]
        self.assertEqual(carried(both)[0], {})


class R2Unknowns(unittest.TestCase):
    PRE = "$L(-1;-1)$ , $M(-2;4)$ , $N(x;y)$ and $P(4;0)$ are the vertices of parallelogram $LMNP$ ."

    def test_a_point_the_preamble_leaves_unknown_takes_the_value_an_earlier_part_works_out(self):
        a = part("Ex8-6:9a", "Determine the coordinates of $N$ .", pre=self.PRE, kind="coordinates", key="(3; 5)")
        b = part("Ex8-6:9b", "Show that $MP\\perpLN$ .", pre=self.PRE)
        c, u = carried([a, b])
        self.assertEqual(c["Ex8-6:9b"].sentences, ["$N=(3; 5)$."])
        self.assertTrue(c["Ex8-6:9b"].after.startswith(self.PRE + " $N=(3; 5)$. Show that"))
        self.assertNotIn("Ex8-6:9a", c)

    def test_a_variable_in_a_point_takes_its_value(self):
        pre = "$f(x)=2x-1$ with $U(6;a)$ on $f$ ."
        a = part("Ex8-6:9a", "Determine the value of $a$ in $U(6;a)$ .", pre=pre, key="11")
        b = part("Ex8-6:9b", "Find the gradient of the line through $U$ and the origin .", pre=pre)
        c, _ = carried([a, b])
        self.assertEqual(c["Ex8-6:9b"].sentences, ["$a=11$."])

    def test_a_part_that_solves_for_the_unknown_itself_is_left_alone(self):
        pre = "The points $P(0;1)$ and $Q(2;k)$ lie on a line ."
        a = part("Ex8-6:9a", "What should $k$ be so that $PQ$ has gradient 2 ?  Find the value of $k$ .", pre=pre, key="5")
        b = part("Ex8-6:9b", "Find the value of $k$ so that $PQ$ has length 3 .", pre=pre, key="4")
        c, _ = carried([a, b])
        self.assertEqual(c, {}, "two different questions about k are not one chain")

    def test_an_earlier_part_with_no_key_is_listed(self):
        a = part("Ex8-6:9a", "Determine the coordinates of $N$ .", pre=self.PRE, fate="teaching")
        b = part("Ex8-6:9b", "Show that $MP\\perpLN$ .", pre=self.PRE)
        c, u = carried([a, b])
        self.assertEqual(c, {})
        self.assertEqual([x.reason for x in u], ["no_key"])
        self.assertEqual(u[0].sources[0]["ref"], "Ex8-6:9a")

    def test_a_list_of_values_is_not_restated(self):
        pre = "$L(a;b)$ is a point ."
        a = part("Ex8-6:9a", "Determine the value of $a$ .", pre=pre, kind="values", key="a = 3, b = 4")
        b = part("Ex8-6:9b", "Find $OL$ .", pre=pre)
        c, u = carried([a, b])
        self.assertEqual(c, {})


class R3Gradients(unittest.TestCase):
    def test_a_gradient_the_working_uses_but_never_works_out_is_carried(self):
        a = part("Ex8-6:10a", "Calculate the gradient of $MN$ .", kind="expression", key="-\\frac{1}{3}")
        b = part("Ex8-6:10b", "Show that $AB\\parallelMN$ .",
                 "$m_{AB}=\\frac{8-4}{-2-10}=-\\frac{1}{3}=m_{MN}$")
        c, _ = carried([a, b])
        self.assertEqual(c["Ex8-6:10b"].sentences, ["$m_{MN}=-\\frac{1}{3}$."])

    def test_a_gradient_it_works_out_itself_is_not(self):
        a = part("Ex8-6:10a", "Calculate the gradient of $MN$ .", kind="expression", key="2")
        b = part("Ex8-6:10b", "Show that $AB\\parallelMN$ .", "$m_{MN}=\\frac{4-2}{3-2}=2$ and $m_{AB}=2$")
        self.assertEqual(carried([a, b])[0], {})

    def test_a_product_does_not_work_out_its_factors(self):
        a = part("Ex8-6:10a", "Calculate the gradient of $AC$ .", kind="expression", key="3")
        b = part("Ex8-6:10b", "Is it a rhombus ?", "$m_{AC}\\timesm_{BD}=3\\times\\frac{-1}{3}=-1$")
        c, u = carried([a, b])
        self.assertEqual(c["Ex8-6:10b"].sentences, ["$m_{AC}=3$."])
        self.assertEqual([x.reason for x in u], ["no_source"])
        self.assertIn("m_{BD}", u[0].detail, "m_{BD}: nothing earlier asks for it")

    def test_a_chain_computes_its_left_end_only(self):
        a = part("Ex8-6:10a", "Find the gradient of $PQ$ .", kind="expression", key="-\\frac{1}{2}")
        b = part("Ex8-6:10b", "Find $b$ .", "$m_{QR}&=m_{PQ}\\\\\\frac{b+1}{3-7}&=-\\frac{1}{2}$")
        c, _ = carried([a, b])
        self.assertEqual(c["Ex8-6:10b"].sentences, ["$m_{PQ}=-\\frac{1}{2}$."])

    def test_the_key_of_a_part_that_is_not_one_value_is_not_carried(self):
        a = part("Ex8-6:10a", "Calculate the gradient of $MN$ .", kind="equation", key="y = 2x")
        b = part("Ex8-6:10b", "Show it .", "$m_{AB}=2=m_{MN}$")
        c, u = carried([a, b])
        self.assertEqual(c, {})
        self.assertEqual([x.reason for x in u], ["no_key"])

    def test_the_other_way_round_names_the_same_line(self):
        a = part("Ex8-6:10a", "Calculate the gradient of $NM$ .", kind="expression", key="5")
        b = part("Ex8-6:10b", "Show it .", "$m_{AB}=5=m_{MN}$")
        c, _ = carried([a, b])
        self.assertEqual(c["Ex8-6:10b"].sentences, ["$m_{MN}=5$."])


class Stable(unittest.TestCase):
    """Whatever the rule writes, running it again on the result changes nothing."""

    def check(self, parts):
        first, _ = plan(parts)
        self.assertTrue(first, "the example must carry something")
        after = [Part(p.ref, first[p.ref].after if p.ref in first else p.stem, p.working, p.fate, p.kind, p.key)
                 for p in parts]
        self.assertEqual(plan(after)[0], {})

    def test_every_rule(self):
        pre = "$L(-1;-1)$ , $N(x;y)$ and $P(4;0)$ are the vertices of parallelogram $LMNP$ ."
        self.check([part("Ex8-6:9a", "Determine the coordinates of $N$ .", pre=pre, kind="coordinates", key="(3; 5)"),
                    part("Ex8-6:9b", "Show that $LN\\perpMP$ .", pre=pre)])
        pre = "$U(6;a)$ is on $f$ ."
        self.check([part("Ex8-6:9a", "Determine the value of $a$ .", pre=pre, key="11"),
                    part("Ex8-6:9b", "Find $OU$ .", pre=pre)])
        self.check([part("Ex8-6:10a", "Calculate the gradient of $MN$ .", kind="expression", key="-\\frac{1}{3}"),
                    part("Ex8-6:10b", "Show that $AB\\parallelMN$ .", "$m_{AB}=-\\frac{1}{3}=m_{MN}$")])
        self.check([part("Ex8-6:11a", "Find the coordinates of $M$ where the diagonals meet .", kind="coordinates", key="(1; 2)"),
                    part("Ex8-6:11b", "Show that $M$ lies on $AB$ .")])
        self.check([part("Ex8-6:12a", "Find $S$ and $T$ , the mid-points of $AB$ and $BC$ ."),
                    part("Ex8-6:12b", "Prove that $ST\\parallelAC$ .")])


class Listed(unittest.TestCase):
    def test_words_that_point_back_are_listed_with_the_parts_before(self):
        a = part("Ex8-6:11a", "Find the mid-point of $AB$ .", key="(2; 3)", kind="coordinates")
        b = part("Ex8-6:11b", "Hence show that $ABC$ is not isosceles .")
        c, u = carried([a, b])
        self.assertEqual([(x.ref, x.reason) for x in u], [("Ex8-6:11b", "refers_by_words")])
        self.assertEqual(u[0].sources[0]["ref"], "Ex8-6:11a")
        self.assertEqual(u[0].sources[0]["key"], "(2; 3)")
        self.assertEqual(c, {}, "which earlier part, and what it gave, is a human's call")

    def test_a_working_that_leans_on_an_earlier_part_by_words_is_listed(self):
        a = part("Ex8-6:11a", "Find the gradient of $AB$ .")
        b = part("Ex8-6:11b", "Find the gradient of $BC$ .", "From the previous question we know that $m=2$ .")
        self.assertEqual([x.reason for x in carried([a, b])[1]], ["refers_by_words"])

    def test_the_ordinary_instructions_are_not_references(self):
        a = part("Ex8-6:11a", "Find the length of $AB$ . Leave your answer in surd form .")
        b = part("Ex8-6:11b", "Is $ABC$ isosceles ? Give reasons for your answer .")
        self.assertEqual(carried([a, b]), ({}, []))

    def test_a_whole_question_can_point_back_too(self):
        p = Part("Ex8-6:12", "Using your answer to the previous question , find $x$ .", "")
        self.assertEqual([x.reason for x in plan([p])[1]], ["refers_by_words"])

    def test_the_carry_that_would_hand_over_the_answer_is_refused(self):
        pre = "$U(6;a)$ is on $f$ ."
        c = part("Ex8-6:13a", "Find the value of $a$ .", pre=pre, key="5")
        d = part("Ex8-6:13b", "Show that $U$ is on $g$ .", pre=pre, key="yes")
        e = part("Ex8-6:13c", "Find $OU$ .", pre=pre, key="5")      # its own key is 5: "a=5" would give it away
        carries, unresolved = carried([c, d, e])
        self.assertEqual(carries["Ex8-6:13b"].sentences, ["$a=5$."])
        self.assertNotIn("Ex8-6:13c", carries)
        self.assertEqual({x.reason for x in unresolved if x.ref == "Ex8-6:13c"}, {"would_reveal_key"})


class Order(unittest.TestCase):
    def test_parts_are_read_in_the_book_s_order_wherever_they_were_served(self):
        a = part("Ex8-6:14a", "Find $D$ , the mid-point of $AB$ .")
        b = part("Ex8-6:14b", "Find $AD$ .")
        c = part("Ex8-6:14c", "Show that $D$ lies on $AB$ .")
        shuffled, _ = carried([c, a, b])
        ordered, _ = carried([a, b, c])
        self.assertEqual(shuffled, ordered)
        self.assertEqual(set(ordered), {"Ex8-6:14b", "Ex8-6:14c"}, "AD and D both use the name")

    def test_an_earlier_part_never_leans_on_a_later_one(self):
        a = part("Ex8-6:14a", "Show that $D$ lies on $AB$ .")
        b = part("Ex8-6:14b", "Find $D$ , the mid-point of $AB$ .")
        self.assertEqual(carried([a, b])[0], {})

    def test_questions_do_not_borrow_from_each_other(self):
        a = part("Ex8-6:15a", "Find $D$ , the mid-point of $AB$ .")
        b = part("Ex8-6:16b", "Show that $D$ lies on $AB$ .")
        c = part("Ex8-6:16a", "Find $AB$ .")
        self.assertEqual(carried([a, b, c])[0], {})

    def test_a_single_item_is_no_part(self):
        self.assertEqual(carried([Part("Ex8-6:17", "Find $D$ .", "")]), ({}, []))


class FromARun(unittest.TestCase):
    def test_a_run_item_becomes_a_part_with_the_key_g2_approved(self):
        marker = {"kind": "coordinates", "key": "(3; 5)", "form": None, "variables": []}
        base = {"ref": "Ex8-6:9a", "stem": "Find $N$ .", "solution": ["s1", "s2"], "answer_type": "expression",
                "marker": marker, "verification": "agreed"}
        p = mp.part_of(base)
        self.assertEqual((p.fate, p.kind, p.key, p.working), ("verified", "coordinates", "(3; 5)", "s1 s2"))
        self.assertEqual(mp.part_of({**base, "g2": {"verdict": "exclude"}}).fate, "excluded")
        self.assertEqual(mp.part_of({**base, "answer_type": "not_markable"}).key, None)
        self.assertEqual(mp.part_of({**base, "verification": "disputed"}).fate, "held")
        num = mp.part_of({**base, "answer_type": "numeric", "answer": "5", "marker": None})
        self.assertEqual((num.kind, num.key), (None, "5"))
        self.assertIsNone(mp.part_of({**base, "answer_type": "choice", "answer": "B"}).key, "a letter is no value")


class PacketAndAssembly(unittest.TestCase):
    """The lesson packet (S2–S4) carries the NAMES, before any key exists, so the blind solver and the typing check
    read what a student will; the assembly then adds the book's values — to the sentence the packet wrote, in place."""

    A = part("Ex8-6:5a", "Determine the coordinates of $E$ , the mid-point of $BC$ .", "$E(4;2)$", kind="coordinates", key="(4; 2)")
    B = part("Ex8-6:5b", "Prove that $ABE$ is a triangle .", "$E$ lies off $AB$")

    def test_the_packet_carries_names_only(self):
        a = Part(self.A.ref, self.A.stem, self.A.working)          # no key at S2–S4
        c, _ = plan([a, self.B], rules=("R1",))
        self.assertEqual(c["Ex8-6:5b"].sentences, ["$E$ is the mid-point of $BC$."])

    def test_the_packet_does_not_carry_values_or_gradients(self):
        pre = "$f(x)=2x-1$ with $U(6;a)$ on $f$ ."
        a = part("Ex8-6:9a", "Determine the value of $a$ in $U(6;a)$ .", pre=pre, key="11")
        b = part("Ex8-6:9b", "Find the gradient of the line through $U$ and the origin .", "$m_{OU}=\\frac{11}{6}=m_{AB}$", pre=pre)
        self.assertEqual(set(plan([a, b])[0]), {"Ex8-6:9b"})
        self.assertEqual(plan([a, b], rules=("R1",))[0], {})

    def test_the_assembly_adds_the_key_to_the_sentence_the_packet_wrote(self):
        packet = Part("Ex8-6:5b", plan([Part(self.A.ref, self.A.stem, ""), self.B], rules=("R1",))[0]["Ex8-6:5b"].after,
                      self.B.working)
        c, _ = plan([self.A, packet])
        x = c["Ex8-6:5b"]
        self.assertEqual(x.after, PRE + " $E(4; 2)$ is the mid-point of $BC$. Prove that $ABE$ is a triangle .")
        self.assertEqual(x.items[0]["was"], "$E$ is the mid-point of $BC$.")
        again = Part("Ex8-6:5b", x.after, self.B.working)
        self.assertEqual(plan([self.A, again])[0], {}, "swapped once, then stable")

    def test_a_part_whose_stem_the_packet_already_completed_is_not_touched_without_a_key(self):
        packet = Part("Ex8-6:5b", plan([Part(self.A.ref, self.A.stem, ""), self.B], rules=("R1",))[0]["Ex8-6:5b"].after, "")
        held = Part(self.A.ref, self.A.stem, self.A.working, fate="held", kind="coordinates", key="(4; 2)")
        self.assertEqual(plan([held, packet])[0], {})

    def test_assemble_objectives_writes_the_packet_stems(self):
        import assemble_objectives as ao
        def blk(sub, text, sol):
            return {"type": "exercise_item", "exercise": "8-6", "q": 5, "sub": sub, "problem": {"text": text},
                    "solution": {"text": sol, "maths": [], "math_kinds": []}}
        items = [blk("a", "Determine the coordinates of $E$ , the mid-point of $BC$ .", "$E=(4;2)$"),
                 blk("b", "Prove that $ABE$ is a triangle .", "$E$ lies off $AB$")]
        headers = {("8-6", 5): PRE}
        out = ao.carried_stems(items, headers, {})
        self.assertEqual(out, {"Ex8-6:5b": PRE + " $E$ is the mid-point of $BC$. Prove that $ABE$ is a triangle ."})


class Assembly(unittest.TestCase):
    """The assembly applies the plan to the chapter's stems — across lessons — and says so in its report."""

    @classmethod
    def setUpClass(cls):
        import test_assemble_lesson_bundle as t
        cls.t = t
        cls.root = t.fixture_copy()
        cls.add_question(cls.root)
        cls.bundles, cls.report = t.assemble(cls.root)
        cls.ch8 = cls.bundles["g10m-c08.json"]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root.parent, ignore_errors=True)

    PRE = "Triangle $ABC$ has vertices $A(0; 0)$, $B(4; 0)$ and $C(4; 6)$."

    @classmethod
    def add_question(cls, root: Path):
        """Question 3 of the end-of-chapter set, in two lessons: (a) names D, (b) uses it."""
        base = json.loads((root / "runs" / "lesson" / "g10m8s4-1.json").read_text())
        marker_item = next(i for i in base["items"] if i["ref"] == "Ex8-6:2")
        a = dict(marker_item, ref="Ex8-6:3a", lo="lo:g10m8s4-1-1", printed_page=317, shortcode="FX90",
                 stem=cls.PRE + " Find the coordinates of $D$, the mid-point of $AC$.",
                 solution=["$D=\\left(\\frac{0+4}{2}; \\frac{0+6}{2}\\right)=(2; 3)$"],
                 marker={"kind": "coordinates", "key": "(2; 3)", "form": None, "variables": []},
                 printed_answer="(2; 3)", epub_final_answer="(2; 3)", blind_answer="(2; 3)")
        base["items"].append(a)
        (root / "runs" / "lesson" / "g10m8s4-1.json").write_text(json.dumps(base, ensure_ascii=False, indent=2))
        other = json.loads((root / "runs" / "lesson" / "g10m8s3-2.json").read_text())
        num = next(i for i in other["items"] if i["ref"] == "Ex8-4:3")
        b = dict(num, ref="Ex8-6:3b", lo="lo:g10m8s3-2-2", printed_page=318, shortcode="FX91",
                 stem=cls.PRE + " Find the gradient of $BD$.",
                 solution=["$m_{BD}=\\frac{3-0}{2-4}=-\\frac{3}{2}$, using $D(2; 3)$"],
                 answer="-3/2", printed_answer="-3/2", epub_final_answer="-3/2", blind_answer="-3/2")
        other["items"].append(b)
        (root / "runs" / "lesson" / "g10m8s3-2.json").write_text(json.dumps(other, ensure_ascii=False, indent=2))

    def q(self, qid):
        return next(x for x in self.ch8["questions"] if x["id"] == qid)

    def test_the_part_in_the_other_lesson_carries_the_definition_and_the_book_s_key(self):
        stem = self.q("q:g10m8s3-2-2:ex8-6-3b")["stem"]
        self.assertTrue(stem.startswith("Triangle $ABC$ has vertices $A(0, 0)$"), stem)
        self.assertTrue(stem.endswith(" $D(2, 3)$ is the mid-point of $AC$. Find the gradient of $BD$."), stem)

    def test_the_part_that_defines_it_and_every_other_stem_are_untouched(self):
        a = self.q("q:g10m8s4-1-1:ex8-6-3a")["stem"]
        self.assertNotIn("is the mid-point of", a)
        self.assertTrue(a.endswith("Find the coordinates of $D$, the mid-point of $AC$."), a)
        # the fixture's question 2 (two parts, two different stems) is two questions, not one chain
        self.assertEqual([x["ref"] for x in self.report.carried_stems], ["Ex8-6:3b"])

    def test_the_report_says_what_changed_and_why(self):
        got = {x["ref"]: x for x in self.report.carried_stems}
        self.assertEqual(list(got), ["Ex8-6:3b"])
        x = got["Ex8-6:3b"]
        self.assertEqual((x["question"], x["lesson"], x["rules"], x["from"]),
                         ("q:g10m8s3-2-2:ex8-6-3b", "g10m8s3-2", ["R1"], ["Ex8-6:3a"]))
        self.assertNotIn("mid-point of $AC$", x["before"])
        self.assertIn("$D(2, 3)$ is the mid-point of $AC$.", x["after"])
        self.assertEqual(self.report.counts["stems_carried"], 1)
        self.assertEqual(self.report.as_dict()["stem_carry"]["carried"], self.report.carried_stems)
        self.assertEqual(self.report.multipart_unresolved, [])

    def test_the_bundle_is_valid_and_its_katex_clean(self):
        import schemas
        schemas.SeedBundle.model_validate_json(json.dumps(self.ch8))
        self.assertEqual(self.report.katex_errors, [])

    def test_the_command_writes_the_same_plan_from_the_saved_runs(self):
        out = self.root / "plan.json"
        self.assertEqual(mp.main(["--book", "g10-math", "--runs", str(self.root / "runs" / "lesson"), "--chapter", "8",
                                  "--out", str(out)]), 0)
        doc = json.loads(out.read_text())
        self.assertEqual([(x["ref"], x["lesson"], x["rules"]) for x in doc["carried"]],
                         [("Ex8-6:3b", "g10m8s3-2", ["R1"])])
        self.assertEqual(doc["unresolved"], [])

    def test_assembling_again_gives_the_same_bundle(self):
        again, _ = self.t.assemble(self.root)
        self.assertEqual(again["g10m-c08.json"], self.ch8)


@skip_without_db()
class HumanStampsReturnToTheBacklog(unittest.TestCase):
    """A part whose stem the assembly changes keeps G2's stamp and gets the note the console reads as
    'changed after a human signed it' — the orchestrator-stem-fix rule (`stem_fix_by` / review_note)."""

    @classmethod
    def setUpClass(cls):
        import test_assemble_lesson_bundle as t
        cls.root = t.fixture_copy()
        Assembly.add_question(cls.root)
        cls.db = ScratchDB("mp").create()
        bundles, _ = t.assemble(cls.root)
        paths = []
        for name, b in bundles.items():
            p = cls.root / name
            p.write_text(t.alb.dump(b))
            paths.append(str(p))
        run_loader(cls.db.dsn, *sorted(paths, key=lambda p: "course" not in p), "--course", "course:us-g10-math-en")

    @classmethod
    def tearDownClass(cls):
        cls.db.drop()
        shutil.rmtree(cls.root.parent, ignore_errors=True)

    def apply(self, g2):
        p = self.root / "g2.json"
        p.write_text(json.dumps(g2))
        env = dict(os.environ, AINEXT_DB_DSN=self.db.dsn)
        return subprocess.run([sys.executable, str(EX / "apply_review_verdicts.py"), "--g2", str(p), "--book", "g10-math",
                               "--runs", str(self.root / "runs" / "lesson")],
                              capture_output=True, text=True, env=env, cwd=EX)

    def row(self, qid):
        return self.db.q("SELECT status, reviewed_by, review_note FROM questions WHERE id = %s", (qid,))[0]

    def test_a_human_stamp_on_a_carried_stem_carries_the_note_and_a_rerun_changes_nothing(self):
        g2 = {"by": "Samuel Toma", "items": {
            "g10m8s3-2:Ex8-6:3b": {"verdict": "accept", "note": "ok"},
            "g10m8s4-1:Ex8-6:3a": {"verdict": "accept", "note": "ok"}}}
        r = self.apply(g2)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        status, by, note = self.row("q:g10m8s3-2-2:ex8-6-3b")
        self.assertEqual((status, by), ("live", "Samuel Toma (G2 accept)"))
        self.assertIn("stem fixed by pipeline carry-over", note)
        self.assertIn("not Samuel", note)
        self.assertIsNone(self.row("q:g10m8s4-1-1:ex8-6-3a")[2], "the part whose stem is the book's has no note")
        again = self.apply(g2)
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertEqual(self.row("q:g10m8s3-2-2:ex8-6-3b")[2], note, "re-running changes nothing")

    def test_an_auto_pass_leaves_no_human_note(self):
        self.db.q("UPDATE questions SET reviewed_by = NULL, review_note = NULL WHERE id = %s",
                  ("q:g10m8s3-2-2:ex8-6-3b",))
        g2 = {"by": "auto-pass G2 (AI recommendation)", "auto": True,
              "items": {"g10m8s3-2:Ex8-6:3b": {"verdict": "accept", "note": "auto"}}}
        r = self.apply(g2)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertNotIn("carry-over", self.row("q:g10m8s3-2-2:ex8-6-3b")[2] or "")


if __name__ == "__main__":
    unittest.main()

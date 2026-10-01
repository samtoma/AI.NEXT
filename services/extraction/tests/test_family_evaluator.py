"""The safe evaluator behind declarative families (decision 16, B12).

@covers FR-4304

FR-4304: "no model-written code MAY be executed". A family spec is written by a
model, so its expressions are untrusted input; these tests pin that the
evaluator walks a whitelist and refuses everything else, bounds its own work,
and that the plain-maths side (marker keys, blind-grader answers) parses,
prints and compares deterministically.

    uv run --with pytest python -m pytest -q tests/test_family_evaluator.py
"""

from __future__ import annotations

import math
import unittest
from fractions import Fraction

import _scratchdb  # noqa: F401  (puts services/extraction on sys.path)
from families import evaluator as E


class RefusesCode(unittest.TestCase):
    """Nothing but the whitelist runs."""

    def refused(self, src, env=None):
        with self.assertRaises(E.EvalError, msg=src):
            E.evaluate(src, env or {})

    def test_no_attribute_access_import_or_dunder(self):
        for src in ["x.__class__", "().__class__.__bases__", "__import__('os')", "__builtins__",
                    "_hidden", "open('/etc/passwd')", "eval('1')", "exec('1')", "getattr(x, 'y')",
                    "globals()", "compile('1', 'f', 'eval')"]:
            self.refused(src, {"x": 1})

    def test_no_lambda_assignment_or_starred_calls(self):
        for src in ["(lambda: 1)()", "(y := 3)", "max(*[1, 2])", "sorted([2, 1], reverse=True)",
                    "{1, 2}", "{k: v for k, v in [(1, 2)]}", "f'{1}'"]:
            self.refused(src)

    def test_unknown_names_fail_rather_than_default(self):
        self.refused("a + 1")

    def test_work_is_bounded(self):
        self.refused("2 ** 10 ** 9")
        self.refused("10 ** 60 * 10 ** 60")           # integer size
        self.refused("range(10 ** 7)")
        self.refused("[0] * 100001")
        self.refused("sum([a * b for a in range(9000) for b in range(9000)])")  # step budget
        self.refused("'x' * 1000")                      # no string repetition
        self.refused("1 / 0")
        self.refused("sqrt(-1)")

    def test_comprehensions_have_at_most_two_loops(self):
        self.refused("[1 for a in [1] for b in [1] for c in [1]]")

    def test_there_is_no_randomness_to_reach(self):
        for src in ["random()", "randint(1, 2)", "choice([1, 2])"]:
            self.refused(src)


class ComputesExactly(unittest.TestCase):
    def test_whole_number_division_is_exact(self):
        self.assertEqual(E.evaluate("7 / 2"), Fraction(7, 2))
        self.assertEqual(E.evaluate("a / b", {"a": 6, "b": 3}), Fraction(2))
        self.assertIsInstance(E.evaluate("float(7) / 2"), float)

    def test_the_small_language(self):
        env = {"xs": [3, 1, 2], "t": {"sin": "a"}}
        self.assertEqual(E.evaluate("sorted(xs)[0] + len(xs)", env), 4)
        self.assertEqual(E.evaluate("[x * x for x in xs if x > 1]", env), [9, 4])
        self.assertEqual(E.evaluate("sum(x for x in xs)", env), 6)
        self.assertEqual(E.evaluate("t['sin'] if 1 < 2 < 3 else 'no'", env), "a")
        self.assertEqual(E.evaluate("gcd(12, 18) == 6 and not is_square(12)"), True)
        self.assertEqual(E.evaluate("Fraction(1, 3) + Fraction(1, 6)"), Fraction(1, 2))
        self.assertEqual(E.evaluate("unique([3, 1, 3])"), [1, 3])
        self.assertAlmostEqual(E.evaluate("pi"), math.pi)

    def test_formatting_is_the_house_num(self):
        import generate_questions as G
        for v in (3, -3, Fraction(-1, 5), Fraction(4, 2), 2.5, 2.0):
            self.assertEqual(E.show(v), G.num(v))
        self.assertEqual(E.evaluate("fixed(sqrt(2), 2)"), "1.41")


class Templates(unittest.TestCase):
    def test_holes_and_latex_braces_coexist(self):
        out = E.render(r"$\frac{{=b}}{2} = {=b / 2}$ and ${=pair(x, y)}$", {"b": 5, "x": -1, "y": Fraction(1, 2)})
        self.assertEqual(out, r"$\frac{5}{2} = \frac{5}{2}$ and $(-1,\ \frac{1}{2})$")

    def test_a_brace_inside_a_hole_is_refused(self):
        with self.assertRaises(E.EvalError):
            E.render("{={1: 2}[1]}", {})

    def test_unclosed_or_empty_holes_are_refused(self):
        for t in ["{=a", "x {=} y"]:
            with self.assertRaises(E.EvalError):
                E.render(t, {"a": 1})

    def test_a_hole_never_renders_true_false_or_a_list(self):
        for src in ["{=1 < 2}", "{=[1, 2]}"]:
            with self.assertRaises(E.EvalError):
                E.render(src, {})


class PlainMaths(unittest.TestCase):
    """Marker keys and blind answers: one parser, one printer, a numeric comparison."""

    def latex(self, s, vs=("x", "y")):
        return E.to_latex(E.parse_plain(s, list(vs)))

    def test_latex_keeps_structure_and_drops_noise(self):
        cases = {
            "(x+3)(x-2)": "(x + 3)(x - 2)", "2x^2 - 9": "2x^{2} - 9", "x*(x+1)": "x(x + 1)",
            "-3/4": r"-\frac{3}{4}", "2sqrt(3)": r"2\sqrt{3}", "x + -3": "x - 3", "1*x - (-2)": "x + 2",
            "-1*x + 0": "-x", "(2x)^2": "(2x)^{2}", "xy + 3": "xy + 3", "y = 2x - 1": "y = 2x - 1",
            "(2; -3)": "(2, -3)", "interval(-2, 5, true, false)": "[-2, 5)",
            "interval(-inf, 4, false, false)": r"(-\infty, 4)", "sqrt(x+1)/2": r"\frac{\sqrt{x + 1}}{2}",
        }
        for plain, tex in cases.items():
            self.assertEqual(self.latex(plain), tex, plain)

    def test_unreadable_is_never_a_wrong_answer(self):
        for s in ["", "hello", "x >= 2", "import os", "x.real", "f(x)"]:
            with self.assertRaises(E.Unreadable, msg=s):
                E.parse_plain(s, ["x"])

    def test_equivalence_by_kind(self):
        eq = E.equivalent
        self.assertTrue(eq("expression", "(x+3)*(x-2)", "x^2 + x - 6", ["x"]))
        self.assertFalse(eq("expression", "(x+3)*(x-2)", "x^2 - x - 6", ["x"]))
        self.assertTrue(eq("values", "[2, -3]", "-3, 2"))
        self.assertFalse(eq("values", "[2, -3]", "[2, 3]"))
        self.assertTrue(eq("coordinates", "(2, -3)", "(2; -3)"))
        self.assertFalse(eq("coordinates", "(2, -3)", "(-3, 2)"))
        self.assertTrue(eq("surd", "2*sqrt(3)", "sqrt(12)"))
        self.assertTrue(eq("equation", "y = 2x - 1", "2y = 4x - 2", ["x", "y"]))
        self.assertFalse(eq("equation", "y = 2x - 1", "y = 2x + 1", ["x", "y"]))
        self.assertTrue(eq("interval", "interval(-inf, 4, false, false)", "interval(-inf, 4, false, false)"))
        self.assertFalse(eq("interval", "interval(-2, 5, true, false)", "interval(-2, 5, false, false)"))
        self.assertTrue(eq("recurring", "7/9", "0.7777777777777778"))

    def test_equivalence_ignores_form_which_is_the_markers_job(self):
        # FR-4320's form check belongs to the app's marker; the pipeline's
        # comparison asks only "the same mathematics?". The judge checks the form.
        self.assertTrue(E.equivalent("expression", "(x-3)*(x+3)", "x^2 - 9", ["x"]))

    def test_recurring_decimals_print_with_dots(self):
        self.assertEqual(E.recurring_latex(Fraction(1, 3)), r"0.\dot{3}")
        self.assertEqual(E.recurring_latex(Fraction(5, 6)), r"0.8\dot{3}")
        self.assertEqual(E.recurring_latex(Fraction(1, 7)), r"0.\dot{1}4285\dot{7}")
        self.assertEqual(E.recurring_latex(Fraction(3, 4)), "0.75")


class RecurringDecimalNotation(unittest.TestCase):
    """The book's own recurring-decimal notation is read as the exact fraction it stands for — in a family's
    marker answer, in the key it prints, and in a blind grader's answer — the same set the app's marker reads
    (answer-marker.ts: \\dot on the first and last digit of the block, \\overline over it, 0.(45), 0.4545...)."""

    def value(self, text):
        return E.eval_plain(E.parse_plain(text), {})

    def test_dots_bars_brackets_and_ellipses_are_exact_fractions(self):
        cases = {
            r"0.\dot{3}": Fraction(1, 3),
            r"0.8\dot{3}": Fraction(5, 6),
            r"0.\dot{1}4285\dot{7}": Fraction(1, 7),
            r"9.2\dot{8}\dot{7}": Fraction(613, 66),
            r"0.\overline{45}": Fraction(5, 11),
            r"0.1\overline{045}": Fraction(58, 555),
            r"3.\bar{6}": Fraction(11, 3),
            "0.(45)": Fraction(5, 11),
            "0.4545...": Fraction(5, 11),
            "0.8333...": Fraction(5, 6),
            "0.2\u0307": Fraction(2, 9),             # a combining dot above the digit
            r"0.\dot{9}": Fraction(1),               # exact, so it IS one
            r"-0.\dot{3}": Fraction(-1, 3),
            r"2*0.\dot{3}": Fraction(2, 3),
            r"$0.\dot{7}$": Fraction(7, 9),          # copied with its math delimiters
            r"0.\dot{3} + 0.\dot{6}": Fraction(1),
        }
        for text, want in cases.items():
            self.assertEqual(self.value(text), want, text)
            self.assertIsInstance(self.value(text), Fraction, text)

    def test_a_terminating_decimal_is_left_alone(self):
        self.assertEqual(self.value("0.75"), 0.75)
        self.assertEqual(self.value("12.5 + 0.25"), 12.75)
        self.assertEqual(self.value("3/4"), Fraction(3, 4))

    def test_a_mark_that_cannot_be_read_is_unreadable_never_guessed(self):
        for text in [r"0.\dot{1}2",                 # a digit after the last dot belongs to no block
                     "0.123...",                    # no block repeats twice
                     r"0.\dot{1}\overline{3}",     # two kinds of mark on one decimal
                     r"\overline{45}",              # a bar over nothing
                     r"x.\dot{3}", "..."]:
            with self.assertRaises(E.Unreadable, msg=text):
                E.parse_plain(text)

    def test_the_same_number_in_any_notation_is_equivalent(self):
        eq = lambda key, ans: E.equivalent("recurring", key, ans)  # noqa: E731
        key = r"9.2\dot{8}\dot{7}"
        for ans in [r"9.2\dot{8}\dot{7}", r"9.2\overline{87}", "9.2(87)", "9.2878787...", "613/66", "9 + 19/66"]:
            self.assertTrue(eq(key, ans), ans)
        for ans in ["9.29", "9.2878", r"9.\overline{28}", "613/65"]:
            self.assertFalse(eq(key, ans), ans)
        # a bar over the pair is the same number as dots over its two digits, and the reverse
        self.assertTrue(eq(r"0.1\overline{045}", r"0.1\dot{0}4\dot{5}"))
        self.assertTrue(eq("5/11", r"0.\dot{4}\dot{5}"))

    def test_a_key_prints_in_the_notation_it_was_written_in(self):
        v = Fraction(58, 555)
        self.assertEqual(E.recurring_latex(v), r"0.1\dot{0}4\dot{5}")
        self.assertEqual(E.recurring_latex(v, "bar"), r"0.1\overline{045}")
        self.assertEqual(E.recurring_latex(Fraction(1, 3), "bar"), r"0.\overline{3}")
        self.assertEqual(E.recurring_latex(Fraction(3, 4), "bar"), "0.75")      # it stops: nothing to mark
        # and what is printed is read back to the same number, in both notations
        for v in (Fraction(1, 3), Fraction(5, 6), Fraction(1, 7), Fraction(613, 66), Fraction(-58, 555)):
            for style in ("dot", "bar"):
                self.assertEqual(self.value(E.recurring_latex(v, style)), v, (v, style))


if __name__ == "__main__":
    unittest.main()

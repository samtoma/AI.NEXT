"""The safe evaluator for declarative families (decision 16: no model-written code is executed).

A family spec is written by a model (S6, ``families.workflow.js``). Its
expressions are therefore untrusted input, and this module is the only thing
that gives them meaning. It never calls ``eval``/``exec``/``compile`` on them.
It parses each expression with :func:`ast.parse` and walks the tree itself,
accepting a fixed list of node types and a fixed table of functions:

* no attribute access (``x.__class__`` cannot even be written), no imports,
  no lambdas, no assignment, no names beginning with ``_``;
* calls only by bare name, only to the functions in :data:`FUNCTIONS`, only
  with positional arguments;
* bounded work: a step budget per evaluation, a cap on integer size, on list
  and string length, on ``range`` and on exponents, so a spec cannot hang or
  exhaust memory;
* no randomness: sampling happens only in the spec's ``params``, through the
  family's own seeded stream, in declared order (see :mod:`families.spec`).

Two languages share the walker:

* **family expressions** (``params``, ``constraints``, ``answer``, and the
  ``{=…}`` holes in templates) compute with exact integers and Fractions:
  ``7 / 2`` is ``Fraction(7, 2)``, never ``3.5``, so an answer key cannot pick
  up float noise. A float appears only when a spec asks for one (``float()``,
  ``sqrt()``, ``pi``);
* **plain maths** (``marker.answer`` and a blind grader's typed answer) has free
  variables, accepts ``^`` for powers and ``2x`` for ``2*x``, and is only ever
  evaluated numerically, to compare two answers, or printed as LaTeX
  (:func:`to_latex`) to write the marker's key. The key and the checked form are
  the same tree, so they cannot disagree.
"""

from __future__ import annotations

import ast
import math
import re
from fractions import Fraction
from functools import lru_cache
from typing import Any, Callable


class EvalError(ValueError):
    """An expression is not allowed, or could not be evaluated. Never repaired."""


class Unreadable(EvalError):
    """A plain-maths answer that cannot be parsed. Marked for re-entry, never as wrong."""


# ---------------------------------------------------------------- limits
MAX_SOURCE = 2000          # characters in one expression
MAX_NODES = 400            # syntax-tree nodes in one expression
MAX_STEPS = 200_000        # nodes visited in one evaluation (comprehensions included)
MAX_INT = 10 ** 40         # any integer (or Fraction part) beyond this is refused
MAX_LEN = 10_000           # list, tuple, string and range length
MAX_EXP = 64               # |exponent| for an exact power

Number = (int, Fraction, float)


def _fmt():
    # The house formatting lives with the 35 Python families, so notation can
    # never drift between a hand-written family and a declarative one. Imported
    # lazily: generate_questions imports this package only inside main().
    import generate_questions as G
    return G


def _num_ok(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, int):
        if abs(v) > MAX_INT:
            raise EvalError(f"integer too large ({len(str(v))} digits)")
    elif isinstance(v, Fraction):
        if abs(v.numerator) > MAX_INT or v.denominator > MAX_INT:
            raise EvalError("fraction too large")
    elif isinstance(v, float):
        if not math.isfinite(v):
            raise EvalError("the result is not a finite number")
    return v


def _is_num(v) -> bool:
    return isinstance(v, Number) and not isinstance(v, bool)


def _len_ok(v):
    if isinstance(v, (list, tuple, str, dict)) and len(v) > MAX_LEN:
        raise EvalError(f"a value longer than {MAX_LEN}")
    return v


# ---------------------------------------------------------------- functions
def _need(name: str, args: tuple, lo: int, hi: int | None = None):
    hi = lo if hi is None else hi
    if not lo <= len(args) <= hi:
        want = str(lo) if lo == hi else f"{lo}–{hi}"
        raise EvalError(f"{name}() takes {want} argument(s), got {len(args)}")


def _nums(name: str, *vals):
    for v in vals:
        if not _is_num(v):
            raise EvalError(f"{name}() needs numbers, got {type(v).__name__}")


def _f_range(*a):
    _need("range", a, 1, 3)
    for v in a:
        if not isinstance(v, int) or isinstance(v, bool):
            raise EvalError("range() takes whole numbers")
    r = range(*a)
    if len(r) > MAX_LEN:
        raise EvalError(f"range() longer than {MAX_LEN}")
    return list(r)


def _f_fixed(*a):
    _need("fixed", a, 2)
    x, n = a
    _nums("fixed", x)
    if not isinstance(n, int) or not 0 <= n <= 10:
        raise EvalError("fixed(x, n) needs 0 <= n <= 10 decimal places")
    return f"{float(x):.{n}f}"


def _f_sqrt(*a):
    _need("sqrt", a, 1)
    _nums("sqrt", a[0])
    if a[0] < 0:
        raise EvalError("sqrt() of a negative number")
    return math.sqrt(a[0])


def _f_isqrt(*a):
    _need("isqrt", a, 1)
    if not isinstance(a[0], int) or a[0] < 0:
        raise EvalError("isqrt() takes a whole number >= 0")
    return math.isqrt(a[0])


def _f_is_square(*a):
    _need("is_square", a, 1)
    return isinstance(a[0], int) and a[0] >= 0 and math.isqrt(a[0]) ** 2 == a[0]


def _f_fraction(*a):
    _need("Fraction", a, 1, 2)
    for v in a:
        if not isinstance(v, (int, Fraction)) or isinstance(v, bool):
            raise EvalError("Fraction() takes whole numbers or fractions (never a float)")
    if len(a) == 2 and a[1] == 0:
        raise EvalError("Fraction() with a zero denominator")
    return _num_ok(Fraction(*a))


def _f_int(*a):
    _need("int", a, 1)
    _nums("int", a[0])
    return int(a[0])


def _f_float(*a):
    _need("float", a, 1)
    _nums("float", a[0])
    return float(a[0])


def _f_str(*a):
    _need("str", a, 1)
    if not isinstance(a[0], (int, str, Fraction)) or isinstance(a[0], bool):
        raise EvalError("str() takes a whole number, a fraction or a string")
    return str(a[0])


def _seq(name, v):
    if isinstance(v, (list, tuple)):
        return list(v)
    if isinstance(v, str):
        return list(v)
    if isinstance(v, dict):
        return list(v.keys())
    raise EvalError(f"{name}() needs a list")


def _f_minmax(fn, name):
    def f(*a):
        if not a:
            raise EvalError(f"{name}() needs arguments")
        items = _seq(name, a[0]) if len(a) == 1 else list(a)
        if not items:
            raise EvalError(f"{name}() of an empty list")
        return fn(items)
    return f


def _f_round(*a):
    _need("round", a, 1, 2)
    _nums("round", a[0])
    if len(a) == 2 and (not isinstance(a[1], int) or not 0 <= a[1] <= 10):
        raise EvalError("round(x, n) needs 0 <= n <= 10")
    return round(*a)


def _f_sum(*a):
    _need("sum", a, 1)
    items = _seq("sum", a[0])
    _nums("sum", *items)
    return _num_ok(sum(items))


def _f_len(*a):
    _need("len", a, 1)
    if not isinstance(a[0], (list, tuple, str, dict)):
        raise EvalError("len() needs a list or a string")
    return len(a[0])


def _f_sorted(*a):
    _need("sorted", a, 1)
    try:
        return sorted(_seq("sorted", a[0]))
    except TypeError as e:
        raise EvalError(f"sorted(): {e}") from None


def _f_unique(*a):
    _need("unique", a, 1)
    try:
        return sorted(set(_seq("unique", a[0])))
    except TypeError as e:
        raise EvalError(f"unique(): {e}") from None


def _f_gcd(*a):
    _need("gcd", a, 2)
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in a):
        raise EvalError("gcd() takes whole numbers")
    return math.gcd(*a)


def _f_lcm(*a):
    _need("lcm", a, 2)
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in a):
        raise EvalError("lcm() takes whole numbers")
    return _num_ok(math.lcm(*a))


def _f_floor(*a):
    _need("floor", a, 1)
    _nums("floor", a[0])
    return math.floor(a[0])


def _f_ceil(*a):
    _need("ceil", a, 1)
    _nums("ceil", a[0])
    return math.ceil(a[0])


def _f_parts(which):
    def f(*a):
        _need(which, a, 1)
        if not isinstance(a[0], (int, Fraction)) or isinstance(a[0], bool):
            raise EvalError(f"{which}() takes a whole number or a fraction")
        return Fraction(a[0]).numerator if which == "numerator" else Fraction(a[0]).denominator
    return f


def _f_is_int(*a):
    _need("is_int", a, 1)
    v = a[0]
    if isinstance(v, bool):
        return False
    if isinstance(v, int):
        return True
    if isinstance(v, Fraction):
        return v.denominator == 1
    if isinstance(v, float):
        return v.is_integer()
    return False


def _fmt_fn(name, lo, hi=None):
    def f(*a):
        _need(name, a, lo, hi)
        for v in a:
            if isinstance(v, bool):
                raise EvalError(f"{name}() was given a true/false value")
        try:
            return getattr(_fmt(), name)(*a)
        except (TypeError, ValueError) as e:
            raise EvalError(f"{name}(): {e}") from None
    return f


FUNCTIONS: dict[str, Callable[..., Any]] = {
    # the house notation (generate_questions.py), identical for both kinds of family
    "num": _fmt_fn("num", 1),
    "paren": _fmt_fn("paren", 1),
    "signed": _fmt_fn("signed", 1),
    "linear": _fmt_fn("linear", 2, 3),
    "quadratic": _fmt_fn("quadratic", 3, 4),
    "pair": _fmt_fn("pair", 2),
    "setof": _fmt_fn("setof", 1),
    "frac": _fmt_fn("frac", 2),
    "fixed": _f_fixed,
    # numbers
    "Fraction": _f_fraction,
    "int": _f_int,
    "float": _f_float,
    "str": _f_str,
    "abs": lambda *a: (_need("abs", a, 1), _nums("abs", a[0]), abs(a[0]))[2],
    "min": _f_minmax(min, "min"),
    "max": _f_minmax(max, "max"),
    "round": _f_round,
    "sqrt": _f_sqrt,
    "isqrt": _f_isqrt,
    "is_square": _f_is_square,
    "gcd": _f_gcd,
    "lcm": _f_lcm,
    "floor": _f_floor,
    "ceil": _f_ceil,
    "numerator": _f_parts("numerator"),
    "denominator": _f_parts("denominator"),
    "is_int": _f_is_int,
    # lists
    "sum": _f_sum,
    "len": _f_len,
    "sorted": _f_sorted,
    "unique": _f_unique,
    "range": _f_range,
    "list": lambda *a: (_need("list", a, 1), _seq("list", a[0]))[1],
    "reversed": lambda *a: (_need("reversed", a, 1), list(reversed(_seq("reversed", a[0]))))[1],
}

CONSTANTS = {"pi": math.pi, "True": True, "False": False, "None": None}

# ---------------------------------------------------------------- validation
_ALLOWED = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.BoolOp, ast.Compare, ast.IfExp, ast.Call,
    ast.Name, ast.Load, ast.Store, ast.Constant, ast.List, ast.Tuple, ast.Dict, ast.Subscript,
    ast.Slice, ast.ListComp, ast.GeneratorExp, ast.comprehension,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
    ast.USub, ast.UAdd, ast.Not, ast.And, ast.Or,
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn,
)


def _validate_tree(tree: ast.AST, src: str) -> None:
    nodes = list(ast.walk(tree))
    if len(nodes) > MAX_NODES:
        raise EvalError(f"expression too large ({len(nodes)} nodes): {src[:60]!r}")
    for n in nodes:
        if not isinstance(n, _ALLOWED):
            raise EvalError(f"{type(n).__name__} is not allowed in a family expression: {src[:60]!r}")
        if isinstance(n, ast.Name) and n.id.startswith("_"):
            raise EvalError(f"names may not start with '_': {n.id!r}")
        if isinstance(n, ast.Call):
            if not isinstance(n.func, ast.Name):
                raise EvalError(f"only a named function may be called: {src[:60]!r}")
            if n.func.id not in FUNCTIONS:
                raise EvalError(f"unknown function {n.func.id}() — allowed: {', '.join(sorted(FUNCTIONS))}")
            if n.keywords or any(isinstance(a, ast.Starred) for a in n.args):
                raise EvalError(f"{n.func.id}() takes positional arguments only")
        if isinstance(n, ast.Constant) and not isinstance(n.value, (int, float, str, bool, type(None))):
            raise EvalError(f"constant {n.value!r} is not allowed")
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and len(n.value) > MAX_LEN:
            raise EvalError("string constant too long")
        if isinstance(n, (ast.ListComp, ast.GeneratorExp)):
            if len(n.generators) > 2:
                raise EvalError("a comprehension may have at most two 'for' clauses")
            for g in n.generators:
                if g.is_async:
                    raise EvalError("async comprehension")
                for t in ast.walk(g.target):
                    if not isinstance(t, (ast.Name, ast.Tuple, ast.Store)):
                        raise EvalError("a comprehension target must be a name or a tuple of names")


@lru_cache(maxsize=4096)
def parse(src: str) -> ast.Expression:
    """Parse and whitelist-check one family expression (cached)."""
    if not isinstance(src, str):
        raise EvalError(f"an expression must be a string, got {type(src).__name__}")
    if len(src) > MAX_SOURCE:
        raise EvalError(f"expression longer than {MAX_SOURCE} characters")
    try:
        tree = ast.parse(src.strip(), mode="eval")
    except SyntaxError as e:
        raise EvalError(f"cannot parse {src[:60]!r}: {e.msg}") from None
    _validate_tree(tree, src)
    return tree


# ---------------------------------------------------------------- the walker
class _Walker:
    def __init__(self, env: dict, exact: bool = True):
        self.env = env
        self.exact = exact  # family expressions: int / int -> Fraction
        self.steps = 0

    def run(self, node: ast.AST):
        self.steps += 1
        if self.steps > MAX_STEPS:
            raise EvalError("expression did too much work")
        m = getattr(self, "_" + type(node).__name__, None)
        if m is None:  # pragma: no cover - the whitelist makes this unreachable
            raise EvalError(f"{type(node).__name__} is not evaluable")
        return m(node)

    # -- leaves
    def _Expression(self, n):
        return self.run(n.body)

    def _Constant(self, n):
        return n.value

    def _Name(self, n):
        if n.id in self.env:
            return self.env[n.id]
        if n.id in CONSTANTS:
            return CONSTANTS[n.id]
        raise EvalError(f"unknown name {n.id!r}")

    def _List(self, n):
        return _len_ok([self.run(e) for e in n.elts])

    def _Tuple(self, n):
        return tuple(self.run(e) for e in n.elts)

    def _Dict(self, n):
        if any(k is None for k in n.keys):
            raise EvalError("'**' in a dict is not allowed")
        try:
            return {self.run(k): self.run(v) for k, v in zip(n.keys, n.values)}
        except TypeError as e:
            raise EvalError(f"dict key: {e}") from None

    # -- operators
    def _BinOp(self, n):
        a, b = self.run(n.left), self.run(n.right)
        return self.binop(type(n.op), a, b)

    def binop(self, op, a, b):
        if isinstance(a, bool) or isinstance(b, bool):
            raise EvalError("arithmetic on true/false")
        if op is ast.Add:
            if isinstance(a, str) and isinstance(b, str):
                return _len_ok(a + b)
            if isinstance(a, list) and isinstance(b, list):
                return _len_ok(a + b)
        if op is ast.Mult and isinstance(a, list) and isinstance(b, int):
            if b < 0 or len(a) * b > MAX_LEN:
                raise EvalError("list repetition out of range")
            return a * b
        if not (_is_num(a) and _is_num(b)):
            raise EvalError(f"{op.__name__} needs numbers, got {type(a).__name__} and {type(b).__name__}")
        try:
            if op is ast.Add:
                r = a + b
            elif op is ast.Sub:
                r = a - b
            elif op is ast.Mult:
                r = a * b
            elif op is ast.Div:
                if b == 0:
                    raise EvalError("division by zero")
                if self.exact and isinstance(a, (int, Fraction)) and isinstance(b, (int, Fraction)):
                    r = Fraction(a) / Fraction(b)
                else:
                    r = a / b
            elif op is ast.FloorDiv:
                if b == 0:
                    raise EvalError("division by zero")
                r = a // b
            elif op is ast.Mod:
                if b == 0:
                    raise EvalError("modulo by zero")
                r = a % b
            elif op is ast.Pow:
                r = self.power(a, b)
            else:  # pragma: no cover
                raise EvalError(f"operator {op.__name__}")
        except (OverflowError, ZeroDivisionError) as e:
            raise EvalError(str(e)) from None
        return _num_ok(r)

    def power(self, a, b):
        if isinstance(b, int):
            if abs(b) > MAX_EXP:
                raise EvalError(f"exponent larger than {MAX_EXP}")
            if isinstance(a, (int, Fraction)):
                if b < 0:
                    if a == 0:
                        raise EvalError("zero to a negative power")
                    return Fraction(1) / (Fraction(a) ** -b)
                if isinstance(a, int) and a != 0 and b * math.log2(abs(a) + 1) > 140:
                    raise EvalError("power too large")
                return a ** b
            return float(a) ** b
        # a fractional or float exponent: a real number, or nothing
        if a < 0:
            raise EvalError("a negative number to a fractional power")
        if a == 0 and b < 0:
            raise EvalError("zero to a negative power")
        return float(a) ** float(b)

    def _UnaryOp(self, n):
        v = self.run(n.operand)
        if isinstance(n.op, ast.Not):
            return not v
        if isinstance(v, bool) or not _is_num(v):
            raise EvalError("unary minus/plus needs a number")
        return -v if isinstance(n.op, ast.USub) else +v

    def _BoolOp(self, n):
        if isinstance(n.op, ast.And):
            v = True
            for e in n.values:
                v = self.run(e)
                if not v:
                    return v
            return v
        v = False
        for e in n.values:
            v = self.run(e)
            if v:
                return v
        return v

    def _Compare(self, n):
        left = self.run(n.left)
        for op, rnode in zip(n.ops, n.comparators):
            right = self.run(rnode)
            try:
                ok = {
                    ast.Eq: lambda: left == right, ast.NotEq: lambda: left != right,
                    ast.Lt: lambda: left < right, ast.LtE: lambda: left <= right,
                    ast.Gt: lambda: left > right, ast.GtE: lambda: left >= right,
                    ast.In: lambda: left in right, ast.NotIn: lambda: left not in right,
                }[type(op)]()
            except TypeError as e:
                raise EvalError(f"comparison: {e}") from None
            if not ok:
                return False
            left = right
        return True

    def _IfExp(self, n):
        return self.run(n.body) if self.run(n.test) else self.run(n.orelse)

    def _Subscript(self, n):
        v = self.run(n.value)
        if isinstance(n.slice, ast.Slice):
            parts = [None if p is None else self.run(p) for p in (n.slice.lower, n.slice.upper, n.slice.step)]
            if any(p is not None and (not isinstance(p, int) or isinstance(p, bool)) for p in parts):
                raise EvalError("a slice takes whole numbers")
            if not isinstance(v, (list, tuple, str)):
                raise EvalError("only a list or a string can be sliced")
            return v[slice(*parts)]
        k = self.run(n.slice)
        if isinstance(v, dict):
            try:
                return v[k]
            except (KeyError, TypeError):
                raise EvalError(f"no key {k!r} in the table") from None
        if isinstance(v, (list, tuple, str)):
            if not isinstance(k, int) or isinstance(k, bool):
                raise EvalError("an index must be a whole number")
            try:
                return v[k]
            except IndexError:
                raise EvalError(f"index {k} out of range") from None
        raise EvalError(f"cannot index a {type(v).__name__}")

    def _Call(self, n):
        fn = FUNCTIONS[n.func.id]
        args = [self.run(a) for a in n.args]
        try:
            return _len_ok(_post(fn(*args)))
        except EvalError:
            raise
        except (TypeError, ValueError, ZeroDivisionError, OverflowError) as e:
            raise EvalError(f"{n.func.id}(): {e}") from None

    # -- comprehensions
    def _comp(self, n):
        out: list = []
        saved = dict(self.env)

        def bind(target, value):
            if isinstance(target, ast.Name):
                if target.id.startswith("_"):
                    raise EvalError("names may not start with '_'")
                self.env[target.id] = value
            else:
                vals = list(value) if isinstance(value, (list, tuple)) else None
                if vals is None or len(vals) != len(target.elts):
                    raise EvalError("cannot unpack in a comprehension")
                for t, v in zip(target.elts, vals):
                    bind(t, v)

        def loop(i):
            if i == len(n.generators):
                out.append(self.run(n.elt))
                if len(out) > MAX_LEN:
                    raise EvalError(f"comprehension longer than {MAX_LEN}")
                return
            g = n.generators[i]
            it = self.run(g.iter)
            items = _seq("for", it) if not isinstance(it, (list, tuple)) else it
            for v in items:
                self.steps += 1
                if self.steps > MAX_STEPS:
                    raise EvalError("expression did too much work")
                bind(g.target, v)
                if all(self.run(c) for c in g.ifs):
                    loop(i + 1)

        try:
            loop(0)
        finally:
            self.env.clear()
            self.env.update(saved)
        return out

    _ListComp = _comp
    _GeneratorExp = _comp


def _post(v):
    if _is_num(v):
        return _num_ok(v)
    return v


def evaluate(src: str, env: dict | None = None) -> Any:
    """Evaluate one family expression against ``env`` (the family's parameters)."""
    tree = parse(src)
    return _Walker(dict(env or {}), exact=True).run(tree)


# ---------------------------------------------------------------- templates
_HOLE = "{="


def holes(template: str) -> list[str]:
    """The expressions inside a template's ``{=…}`` holes, in order."""
    return [src for _, _, src in _scan(template)]


def _scan(template: str):
    """Yield (start, end, source) for every ``{=…}`` hole.

    An expression never contains a brace (a table belongs in a ``let`` param),
    so the hole ends at the first ``}`` outside a string literal.
    """
    i = 0
    while True:
        j = template.find(_HOLE, i)
        if j < 0:
            return
        k = j + 2
        quote = None
        while k < len(template):
            ch = template[k]
            if quote:
                if ch == "\\":
                    k += 2
                    continue
                if ch == quote:
                    quote = None
            elif ch in "'\"":
                quote = ch
            elif ch == "{":
                raise EvalError(f"a '{{' inside a {{=…}} hole (put tables in a let param): {template[j:j + 40]!r}")
            elif ch == "}":
                break
            k += 1
        else:
            raise EvalError(f"unclosed {{=…}} hole: {template[j:j + 40]!r}")
        src = template[j + 2:k].strip()
        if not src:
            raise EvalError(f"empty {{=}} hole in {template[:40]!r}")
        yield j, k + 1, src
        i = k + 1


def show(v: Any) -> str:
    """The default rendering of a hole's value: numbers through the house num()."""
    if isinstance(v, bool) or v is None:
        raise EvalError(f"a template hole produced {v!r}; render a word explicitly")
    if isinstance(v, str):
        return v
    if _is_num(v):
        return _fmt().num(v)
    raise EvalError(f"a template hole produced a {type(v).__name__}; format it (setof, pair, …)")


def render(template: str, env: dict) -> str:
    if not isinstance(template, str):
        raise EvalError("a template must be a string")
    out, last = [], 0
    for start, end, src in _scan(template):
        out.append(template[last:start])
        out.append(show(evaluate(src, env)))
        last = end
    out.append(template[last:])
    return _len_ok("".join(out))


# ================================================================ plain maths
# A typed answer ("(x+3)(x-2)", "x^2 - 9", "2sqrt(3)") and a marker key share
# this parser. Only numbers, the declared variables, + - * / ^, brackets,
# sqrt/abs/pi and — for intervals — interval(lo, hi, closed_lo, closed_hi).
MATHS_FUNCTIONS = {"sqrt", "abs", "interval"}
MATHS_CONSTANTS = {"pi", "inf", "true", "false"}
_IMPLICIT = [
    (re.compile(r"(\d)\s*([A-Za-z(])"), r"\1*\2"),       # 2x, 2(…), 2sqrt(3)
    (re.compile(r"\)\s*([A-Za-z0-9(])"), r")*\1"),       # (…)(…), (…)x
]


def _normalise_plain(text: str) -> str:
    s = text.strip()
    s = s.replace("−", "-").replace("×", "*").replace("·", "*").replace("÷", "/")
    s = s.replace("√", "sqrt").replace("π", "pi").replace("∞", "inf")
    s = s.replace("^", "**")
    # (x; y) reads as (x, y) (decision 15). A decimal comma is NOT guessed here:
    # "2,5" could be a pair or a number, so graders are told to write points.
    s = s.replace(";", ",")
    for pat, rep in _IMPLICIT:
        prev = None
        while prev != s:
            prev, s = s, pat.sub(rep, s)
    return s


def _split_products(tree: ast.AST, variables: set[str]) -> ast.AST:
    """'xy' means x*y when every letter is a declared single-letter variable."""

    class T(ast.NodeTransformer):
        def visit_Name(self, node):
            nid = node.id
            if nid in variables or nid in MATHS_CONSTANTS or nid in MATHS_FUNCTIONS:
                return node
            if len(nid) > 1 and all(ch in variables for ch in nid):
                expr: ast.AST = ast.Name(nid[0], ast.Load())
                for ch in nid[1:]:
                    expr = ast.BinOp(expr, ast.Mult(), ast.Name(ch, ast.Load()))
                return expr
            return node

    return ast.fix_missing_locations(T().visit(tree))


def parse_plain(text: str, variables: list[str] | tuple[str, ...] = ()) -> ast.AST:
    """Parse a plain-maths answer. Raises :class:`Unreadable` rather than guessing."""
    if not isinstance(text, str) or not text.strip():
        raise Unreadable("empty answer")
    if len(text) > 400:
        raise Unreadable("answer too long")
    s = _normalise_plain(text)
    eq = None
    # an equation: split at a single top-level '='
    if re.search(r"(?<![<>=!])=(?!=)", s):
        parts = re.split(r"(?<![<>=!])=(?!=)", s)
        if len(parts) != 2:
            raise Unreadable("more than one '='")
        eq = parts
    try:
        if eq:
            left = ast.parse(eq[0].strip(), mode="eval").body
            right = ast.parse(eq[1].strip(), mode="eval").body
            tree = ast.Expression(ast.Compare(left, [ast.Eq()], [right]))
        else:
            tree = ast.parse(s, mode="eval")
    except SyntaxError:
        raise Unreadable(f"cannot read {text!r}") from None
    tree = _split_products(tree, set(variables))
    allowed_names = set(variables) | MATHS_CONSTANTS
    for n in ast.walk(tree):
        if isinstance(n, ast.Name):
            if n.id not in allowed_names and n.id not in MATHS_FUNCTIONS:
                raise Unreadable(f"unknown symbol {n.id!r} (letters allowed: {sorted(variables)})")
        elif isinstance(n, ast.Call):
            if not isinstance(n.func, ast.Name) or n.func.id not in MATHS_FUNCTIONS or n.keywords:
                raise Unreadable("only sqrt(), abs() and interval() may be used")
        elif isinstance(n, (ast.Compare,)):
            if not all(isinstance(o, ast.Eq) for o in n.ops) or n is not getattr(tree, "body", None):
                raise Unreadable("comparisons are not answers here")
        elif not isinstance(n, (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Tuple,
                                ast.List, ast.Load, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow,
                                ast.USub, ast.UAdd, ast.Eq)):
            raise Unreadable(f"{type(n).__name__} cannot appear in an answer")
        if isinstance(n, ast.Constant) and not (_is_num(n.value) or isinstance(n.value, bool)):
            raise Unreadable("only numbers may appear as constants")
    if len(list(ast.walk(tree))) > MAX_NODES:
        raise Unreadable("answer too large")
    return tree


def _maths_env(point: dict) -> dict:
    env = dict(point)
    env.update({"pi": math.pi, "inf": math.inf, "true": True, "false": False})
    return env


class _MathsWalker(_Walker):
    def __init__(self, env):
        super().__init__(env, exact=True)

    def _Call(self, n):
        name = n.func.id
        args = [self.run(a) for a in n.args]
        if name == "sqrt":
            _need("sqrt", tuple(args), 1)
            x = args[0]
            if not _is_num(x) or x < 0:
                raise EvalError("sqrt of a negative number")
            if isinstance(x, (int, Fraction)):
                fx = Fraction(x)
                rn, rd = math.isqrt(fx.numerator), math.isqrt(fx.denominator)
                if rn * rn == fx.numerator and rd * rd == fx.denominator:
                    return Fraction(rn, rd)
            return math.sqrt(x)
        if name == "abs":
            _need("abs", tuple(args), 1)
            return abs(args[0])
        if name == "interval":
            _need("interval", tuple(args), 4)
            lo, hi, cl, ch = args
            if not (_is_num(lo) and _is_num(hi)) or not isinstance(cl, bool) or not isinstance(ch, bool):
                raise EvalError("interval(lo, hi, closed_lo, closed_hi)")
            return ("interval", lo, hi, cl, ch)
        raise EvalError(f"{name}() is not allowed")  # pragma: no cover

    def _Compare(self, n):  # an equation: lhs - rhs
        return ("equation", self.run(n.left), self.run(n.comparators[0]))

    def _BinOp(self, n):
        a, b = self.run(n.left), self.run(n.right)
        if isinstance(a, float) or isinstance(b, float):
            self.exact = False
        return self.binop(type(n.op), a, b)


def eval_plain(tree: ast.AST, point: dict) -> Any:
    return _MathsWalker(_maths_env(point)).run(tree)


# ---------------------------------------------------------------- equivalence
# Fixed, awkward sample points: deterministic, never 0 or ±1, never a lattice
# point, so a coincidental agreement between two different expressions needs
# the difference to vanish at every one of them.
_POINTS = [1.37, -0.83, 2.61, 0.29, -1.94, 3.17, -2.53, 0.71]


def _close(a: float, b: float, tol: float | None) -> bool:
    if tol is not None:
        return abs(a - b) <= tol
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)


def _as_float(v) -> float:
    if isinstance(v, bool) or not _is_num(v):
        raise EvalError("not a number")
    return float(v)


def _points(variables: list[str]):
    for i in range(len(_POINTS)):
        yield {v: _POINTS[(i + 3 * j) % len(_POINTS)] + j * 0.113 for j, v in enumerate(variables)}


def equivalent(kind: str, key_plain: str, answer_plain: str, variables: list[str] | None = None,
               tolerance: float | None = None) -> bool:
    """Do two plain-maths answers mean the same thing, for a marker kind?

    Deterministic and numeric. The PIPELINE uses this to compare a blind
    grader's answer with a family's computed key; the APP's marker (FR-4320,
    contracts/answer-marker.md) is a separate build. Raises :class:`Unreadable`
    if the answer cannot be parsed.
    """
    variables = list(variables or [])
    key = parse_plain(key_plain, variables)
    ans = parse_plain(answer_plain, variables)
    try:
        if kind in ("expression", "surd", "recurring"):
            return _same_function(key, ans, variables, tolerance)
        if kind == "equation":
            return _same_equation(key, ans, variables)
        if kind == "values":
            k = sorted(_as_float(v) for v in _flatten(eval_plain(key, {})))
            a = sorted(_as_float(v) for v in _flatten(eval_plain(ans, {})))
            return len(k) == len(a) and all(_close(x, y, tolerance) for x, y in zip(k, a))
        if kind == "coordinates":
            k, a = eval_plain(key, {}), eval_plain(ans, {})
            if not (isinstance(k, tuple) and isinstance(a, tuple) and len(k) == len(a)):
                return False
            return all(_close(_as_float(x), _as_float(y), tolerance) for x, y in zip(k, a))
        if kind == "interval":
            k, a = eval_plain(key, {}), eval_plain(ans, {})
            if not (isinstance(k, tuple) and isinstance(a, tuple) and k[:1] == a[:1] == ("interval",)):
                return False
            return (_close(float(k[1]), float(a[1]), tolerance) or k[1] == a[1]) and \
                   (_close(float(k[2]), float(a[2]), tolerance) or k[2] == a[2]) and \
                   k[3] == a[3] and k[4] == a[4]
    except EvalError:
        return False
    raise EvalError(f"unknown marker kind {kind!r}")


def _flatten(v):
    if isinstance(v, (list, tuple)):
        for x in v:
            yield from _flatten(x)
    else:
        yield v


def _same_function(key, ans, variables, tol) -> bool:
    agreed = 0
    for p in _points(variables) if variables else [{}]:
        try:
            kv, av = _as_float(eval_plain(key, p)), _as_float(eval_plain(ans, p))
        except EvalError:
            continue  # a pole of the key: skip the point
        if not _close(kv, av, tol):
            return False
        agreed += 1
    return agreed >= (4 if variables else 1)


def _same_equation(key, ans, variables) -> bool:
    ratio = None
    agreed = 0
    for p in _points(variables):
        try:
            k = eval_plain(key, p)
            a = eval_plain(ans, p)
        except EvalError:
            continue
        if not (isinstance(k, tuple) and isinstance(a, tuple) and k[0] == a[0] == "equation"):
            return False
        kd = _as_float(k[1]) - _as_float(k[2])
        ad = _as_float(a[1]) - _as_float(a[2])
        if abs(kd) < 1e-12 and abs(ad) < 1e-12:
            continue
        if abs(kd) < 1e-12 or abs(ad) < 1e-12:
            return False
        r = ad / kd
        if ratio is None:
            ratio = r
        elif not math.isclose(r, ratio, rel_tol=1e-9):
            return False
        agreed += 1
    return agreed >= 4


# ---------------------------------------------------------------- LaTeX
_PREC = {ast.Add: 1, ast.Sub: 1, ast.Mult: 2, ast.Div: 4, ast.Pow: 3}


def _is_neg_const(n) -> bool:
    """A negative literal, or any negated term (-y): both print with a leading minus."""
    return (isinstance(n, ast.Constant) and _is_num(n.value) and n.value < 0) or \
        (isinstance(n, ast.UnaryOp) and isinstance(n.op, ast.USub))


def _neg_of(n):
    if isinstance(n, ast.Constant):
        return ast.Constant(-n.value)
    return n.operand


def _const_value(n):
    """The number a literal (or a signed literal) stands for, else None."""
    if isinstance(n, ast.Constant) and _is_num(n.value):
        return n.value
    if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.USub, ast.UAdd)):
        v = _const_value(n.operand)
        if v is not None:
            return -v if isinstance(n.op, ast.USub) else v
    return None


def _prec(n) -> int:
    if isinstance(n, ast.BinOp):
        return _PREC[type(n.op)]
    if isinstance(n, ast.UnaryOp):
        return 1
    if isinstance(n, ast.Constant) and _is_num(n.value) and n.value < 0:
        return 1
    return 5


def _const_str(v) -> str:
    if isinstance(v, bool):
        return r"\text{true}" if v else r"\text{false}"
    if isinstance(v, float):
        if v == math.inf:
            return r"\infty"
        if v.is_integer():
            return str(int(v))
        return repr(v)
    return str(v)


def _starts_with_digit(tex: str) -> bool:
    return bool(tex) and (tex[0].isdigit() or tex.startswith(r"\frac") or tex.startswith("-"))


def to_latex(tree: ast.AST) -> str:
    """Print a plain-maths tree as LaTeX, keeping its structure (a factorised
    answer stays factorised). Trivial noise is dropped: ``1*x`` → ``x``,
    ``x + -3`` → ``x - 3``, ``x^1`` → ``x``."""
    if isinstance(tree, ast.Expression):
        tree = tree.body
    return _tex(tree)


def _wrap(n, min_prec: int) -> str:
    s = _tex(n)
    return f"({s})" if _prec(n) < min_prec else s


def _tex(n) -> str:
    if isinstance(n, ast.Constant):
        return _const_str(n.value)
    if isinstance(n, ast.Name):
        return {"pi": r"\pi", "inf": r"\infty"}.get(n.id, n.id)
    if isinstance(n, ast.Tuple):
        return "(" + ", ".join(_tex(e) for e in n.elts) + ")"
    if isinstance(n, ast.List):
        return ", ".join(_tex(e) for e in n.elts)
    if isinstance(n, ast.Compare):
        return f"{_tex(n.left)} = {_tex(n.comparators[0])}"
    if isinstance(n, ast.UnaryOp):
        if isinstance(n.op, ast.UAdd):
            return _tex(n.operand)
        return "-" + _wrap(n.operand, 2)
    if isinstance(n, ast.Call):
        name = n.func.id
        if name == "sqrt":
            return r"\sqrt{" + _tex(n.args[0]) + "}"
        if name == "abs":
            return r"\left|" + _tex(n.args[0]) + r"\right|"
        if name == "interval":
            lo, hi, cl, ch = n.args
            left = "[" if _is_true(cl) else "("
            right = "]" if _is_true(ch) else ")"
            return f"{left}{_tex(lo)}, {_tex(hi)}{right}"
    if isinstance(n, ast.BinOp):
        op = type(n.op)
        L, R = n.left, n.right
        if op is ast.Add:
            if _const_value(R) == 0:
                return _tex(L)
            if _is_neg_const(R):
                return f"{_tex(L)} - {_wrap(_neg_of(R), 2)}"
            return f"{_tex(L)} + {_tex(R)}"
        if op is ast.Sub:
            if _const_value(R) == 0:
                return _tex(L)
            if _is_neg_const(R):
                return f"{_tex(L)} + {_wrap(_neg_of(R), 2)}"
            return f"{_tex(L)} - {_wrap(R, 2)}"
        if op is ast.Mult:
            if _const_value(L) == 1:
                return _tex(R)
            if _const_value(L) == -1:
                return "-" + _wrap(R, 2)
            if _const_value(R) == 1:
                return _tex(L)
            left = _wrap(L, 2)
            right = _wrap(R, 3) if not _is_neg_const(R) else f"({_tex(R)})"
            juxtapose = not _starts_with_digit(right) and not right.startswith(r"\frac")
            return f"{left}{right}" if juxtapose else f"{left} \\times {right}"
        if op is ast.Div:
            if _is_neg_const(L):
                return r"-\frac{" + _tex(_neg_of(L)) + "}{" + _tex(R) + "}"
            return r"\frac{" + _tex(L) + "}{" + _tex(R) + "}"
        if op is ast.Pow:
            if _const_value(R) == 1:
                return _tex(L)
            base = _tex(L)
            if _prec(L) < 5 or _is_neg_const(L) or (isinstance(L, ast.Call) and L.func.id == "sqrt"):
                base = f"({base})"
            return base + "^{" + _tex(R) + "}"
    raise EvalError(f"cannot print {type(n).__name__} as LaTeX")


def _is_true(n) -> bool:
    return (isinstance(n, ast.Constant) and n.value is True) or (isinstance(n, ast.Name) and n.id == "true")


def recurring_latex(value: Fraction) -> str:
    """A rational as a recurring decimal with dots over the repetend (0.\\dot{1}\\dot{4})."""
    value = Fraction(value)
    sign = "-" if value < 0 else ""
    value = abs(value)
    whole, rem = divmod(value.numerator, value.denominator)
    digits, seen = [], {}
    while rem and rem not in seen and len(digits) < 60:
        seen[rem] = len(digits)
        rem *= 10
        digits.append(str(rem // value.denominator))
        rem %= value.denominator
    if not rem:
        return f"{sign}{whole}" + ("." + "".join(digits) if digits else "")
    start = seen[rem]
    fixed, rep = "".join(digits[:start]), digits[start:]
    if len(rep) == 1:
        dotted = r"\dot{" + rep[0] + "}"
    else:
        dotted = r"\dot{" + rep[0] + "}" + "".join(rep[1:-1]) + r"\dot{" + rep[-1] + "}"
    return f"{sign}{whole}.{fixed}{dotted}"

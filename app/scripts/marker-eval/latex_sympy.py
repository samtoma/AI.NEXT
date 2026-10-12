"""A small parser for the LaTeX subset the printed answers use (as rebuilt by extract_answers.py) -> SymPy.

Independent of every candidate library on purpose: SymPy is the oracle that labels the generated test
variants, so the parser feeding it must not be one of the things under test.
"""
import re

import sympy as sp

GREEK = {"pi": sp.pi, "theta": sp.Symbol("theta"), "alpha": sp.Symbol("alpha"), "beta": sp.Symbol("beta"),
         "gamma": sp.Symbol("gamma"), "lambda": sp.Symbol("lambda"), "phi": sp.Symbol("phi"),
         "mu": sp.Symbol("mu"), "sigma": sp.Symbol("sigma")}
FUNCS = {"sin": sp.sin, "cos": sp.cos, "tan": sp.tan}


class ParseError(Exception):
    pass


def tokenize(s):
    toks = []
    i = 0
    s = s.replace("\u0338=", r"\ne ").replace("̸=", r"\ne ")
    while i < len(s):
        c = s[i]
        if c.isspace():
            i += 1
            continue
        if c == "\\":
            m = re.match(r"\\([A-Za-z]+|.)", s[i:])
            name = m.group(1)
            i += len(m.group(0))
            if name == "text":
                depth, j = 0, i
                assert s[j] == "{"
                while True:
                    if s[j] == "{":
                        depth += 1
                    elif s[j] == "}":
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
                toks.append(("text", s[i + 1:j].strip()))
                i = j + 1
                continue
            if name == "mathbb":
                m2 = re.match(r"\{([A-Z])\}", s[i:])
                toks.append(("set", m2.group(1)))
                i += len(m2.group(0))
                continue
            if name in ("left", "right", ",", ";", "!", " "):
                continue  # sizing and spacing
            if name == "leq":
                name = "le"
            if name == "geq":
                name = "ge"
            toks.append(("cmd", name))
            continue
        if c.isdigit():
            m = re.match(r"\d+(?:[.,]\d+)?", s[i:])
            toks.append(("num", m.group(0).replace(",", ".")))
            i += len(m.group(0))
            continue
        if c.isalpha():
            fn = re.match(r"(sin|cos|tan)(?![a-z])", s[i:])
            if fn:
                toks.append(("cmd", fn.group(1)))
                i += 3
                continue
            toks.append(("var", c))
            i += 1
            continue
        toks.append(("op", c))
        i += 1
    return toks


class Parser:
    def __init__(self, toks):
        self.t = toks
        self.i = 0

    def peek(self, k=0):
        return self.t[self.i + k] if self.i + k < len(self.t) else (None, None)

    def eat(self, kind=None, val=None):
        tk = self.peek()
        if tk[0] is None or (kind and tk[0] != kind) or (val is not None and tk[1] != val):
            raise ParseError(f"expected {kind} {val}, got {tk}")
        self.i += 1
        return tk

    def group(self):
        """{...} or a single token argument."""
        if self.peek() == ("op", "{"):
            self.eat("op", "{")
            e = self.expr()
            self.eat("op", "}")
            return e
        tk = self.eat()
        return self.atom_of(tk)

    def atom_of(self, tk):
        k, v = tk
        if k == "num":
            return sp.Rational(v) if "." in v else sp.Integer(v)
        if k == "var":
            return sp.Symbol(v)
        if k == "cmd" and v in GREEK:
            return GREEK[v]
        raise ParseError(f"atom {tk}")

    def expr(self):
        e = self.term()
        while self.peek()[0] == "op" and self.peek()[1] in "+-":
            op = self.eat()[1]
            r = self.term()
            e = e + r if op == "+" else e - r
        return e

    def mixed(self):
        """A mixed number: an integer immediately followed by \\frac{int}{int} is a sum, not a product."""
        if self.peek()[0] == "num" and "." not in self.peek()[1] and self.peek(1) == ("cmd", "frac") \
                and self.peek(2) == ("op", "{") and self.peek(3)[0] == "num" and self.peek(4) == ("op", "}") \
                and self.peek(5) == ("op", "{") and self.peek(6)[0] == "num" and self.peek(7) == ("op", "}"):
            w = sp.Integer(self.eat()[1])
            self.eat()
            self.eat(); n = sp.Integer(self.eat()[1]); self.eat()
            self.eat(); d = sp.Integer(self.eat()[1]); self.eat()
            return w + n / d
        return None

    def term(self):
        if self.peek() == ("op", "-"):
            self.eat()
            return -self.term()
        if self.peek() == ("op", "+"):
            self.eat()
            return self.term()
        e = self.mixed()
        if e is None:
            e = self.power()
        while True:
            tk = self.peek()
            if tk == ("cmd", "times") or tk == ("cmd", "cdot") or tk == ("op", "*"):
                self.eat()
                e = e * self.power()
            elif tk == ("op", "/"):
                self.eat()
                e = e / self.power()
            elif tk[0] in ("num", "var") or tk == ("op", "(") or (tk[0] == "cmd" and tk[1] in
                                                                   ("frac", "sqrt", "pi", "theta", "alpha", "beta", "lambda", "phi", "mu", "sigma", "sin", "cos", "tan", "dot", "bar")):
                e = e * self.power()
            else:
                return e

    def power(self):
        b = self.primary()
        while True:
            if self.peek() == ("op", "^"):
                self.eat()
                if self.peek() == ("cmd", "circ"):
                    self.eat()
                    b = b * sp.pi / 180  # degrees
                    continue
                b = b ** self.group()
            elif self.peek() == ("op", "_"):
                self.eat()
                sub = self.group()
                if not isinstance(b, sp.Symbol):
                    raise ParseError("subscript on non-symbol")
                b = sp.Symbol(f"{b.name}_{sub}")
            else:
                return b

    def primary(self):
        tk = self.peek()
        if tk == ("op", "("):
            self.eat()
            e = self.expr()
            self.eat("op", ")")
            return e
        if tk == ("cmd", "frac"):
            self.eat()
            n = self.group()
            d = self.group()
            return n / d
        if tk == ("cmd", "sqrt"):
            self.eat()
            if self.peek() == ("op", "["):
                self.eat()
                idx = self.expr()
                self.eat("op", "]")
                return self.group() ** (sp.Integer(1) / idx)
            return sp.sqrt(self.group())
        if tk[0] == "cmd" and tk[1] in FUNCS:
            self.eat()
            arg = self.power()
            return FUNCS[tk[1]](arg)
        if tk == ("cmd", "dot"):
            raise ParseError("recurring dot handled by the caller")
        if tk == ("cmd", "bar"):
            self.eat()
            g = self.group()
            return sp.Symbol(f"bar_{g}")
        if tk == ("cmd", "infty"):
            self.eat()
            return sp.oo
        self.eat()
        return self.atom_of(tk)


def parse_expr(latex):
    p = Parser(tokenize(latex))
    e = p.expr()
    if p.i != len(p.t):
        raise ParseError(f"trailing {p.t[p.i:]}")
    return e


def recurring_value(latex):
    """0,\\dot{2}\\dot{1} -> 21/99 ; 4,8\\dot{3} -> 4.8333... ; a dot marks the first and last repeating digit."""
    s = latex.replace(" ", "")
    m = re.fullmatch(r"(-?)(\d+)[,.]((?:\d|\\dot\{\d\})+)", s)
    if not m:
        raise ParseError("not a recurring decimal")
    sign, ip, frac = m.groups()
    digits = re.findall(r"\\dot\{(\d)\}|(\d)", frac)
    seq = [(d or e, bool(d)) for d, e in digits]
    dotted = [k for k, (_, dt) in enumerate(seq) if dt]
    a, b = dotted[0], dotted[-1]
    pre = "".join(d for d, _ in seq[:a])
    rep = "".join(d for d, _ in seq[a:b + 1])
    # x = ip.pre(rep)(rep)...
    val = sp.Integer(ip) + (sp.Integer(pre) if pre else 0) / sp.Integer(10) ** len(pre) \
        + sp.Integer(rep) / (sp.Integer(10) ** len(pre) * (sp.Integer(10) ** len(rep) - 1))
    return -val if sign else val

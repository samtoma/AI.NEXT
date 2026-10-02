"""Oracle-side structure parsing and variant generation for values, coordinates, intervals, equations and
recurring decimals. Variants are written in the key's LaTeX dialect, verified by these parsers against the key
(set / multiset / residual semantics), then emitted as LaTeX and as typed text (build_testset.typed)."""
import random
import re

import sympy as sp

from classify import split_top
from latex_sympy import ParseError, parse_expr, recurring_value

SEPS = [";", r" \text{ or } ", r" \text{ and } ", ","]


def typed(latex, style):
    from build_testset import typed as t
    return t(latex, style)


def equal(a, b):
    from build_testset import equal as e
    return e(a, b)


# ------------------------------------------------------------------ values
def parse_values(tex):
    """-> list of (name|None, value) with +- expanded; a set's braces are dropped; pairs are tuples."""
    tex = tex.strip()
    if tex.startswith(r"\{") and tex.endswith(r"\}"):
        tex = tex[2:-2]
    out = []
    for part in split_top(tex, SEPS):
        if not part:
            continue
        name = None
        m = re.fullmatch(r"([A-Za-z](?:_\{[^}]*\})?|\\theta)\s*=\s*(.+)", part)
        if m:
            name, part = m.group(1), m.group(2)
        pm = part.startswith(r"\pm")
        body = part[3:].strip() if pm else part
        pair = re.fullmatch(r"(?:[A-Z]\s*)?\((.+);(.+)\)", body)
        if pair:
            v = (parse_expr(pair.group(1)), parse_expr(pair.group(2)))
        elif r"\dot" in body:
            v = recurring_value(body)
        else:
            v = parse_expr(body)
        out.append((name, v))
        if pm:
            out.append((name, -v))
    return out


def same_values(a, b):
    if len(a) != len(b):
        return False
    rest = list(b)
    for n, v in a:
        hit = None
        for k, (m, w) in enumerate(rest):
            if (n is None or m is None or n == m) and vals_equal(v, w):
                hit = k
                break
        if hit is None:
            return False
        rest.pop(hit)
    return True


def vals_equal(v, w):
    if isinstance(v, tuple) != isinstance(w, tuple):
        return False
    if isinstance(v, tuple):
        return all(equal(p, q) for p, q in zip(v, w))
    return equal(v, w)


def fmt(v):
    """A SymPy value -> the key's LaTeX dialect (decimal comma kept)."""
    if isinstance(v, tuple):
        return "(" + ";".join(fmt(x) for x in v) + ")"
    s = sp.latex(v)
    s = s.replace(r"\left(", "(").replace(r"\right)", ")")
    s = re.sub(r"(\d)\.(\d)", r"\1,\2", s)
    return s


def decimal_of(v):
    """An exact decimal rendering of a rational with a terminating expansion, else None."""
    if isinstance(v, tuple) or not v.is_Rational or v.is_Integer:
        return None
    q = int(v.q)
    while q % 2 == 0:
        q //= 2
    while q % 5 == 0:
        q //= 5
    if q != 1:
        return None
    s = str(sp.N(v, 20)).rstrip("0")
    return s.replace(".", ",")


def build_values(key):
    K = parse_values(key)
    cases = []
    parts = [p for p in split_top(key.strip()[2:-2] if key.strip().startswith(r"\{") else key, SEPS) if p]
    is_set = key.strip().startswith(r"\{")
    var_names = {n for n, _ in K if n}
    eq = []
    if len(parts) > 1:
        rev = list(reversed(parts))
        eq.append(("reordered", (r"\{" + ";".join(rev) + r"\}") if is_set else r" \text{ or } ".join(rev) if var_names else ";".join(rev)))
        if not is_set:
            eq.append(("comma-separated", ", ".join(parts)))
    if len(var_names) == 1 and not is_set:
        bare = []
        for n, v in K:
            bare.append(fmt(v))
        eq.append(("values without the variable name", ";".join(bare)))
    dec = []
    changed = False
    for n, v in K:
        d = decimal_of(v)
        dec.append((n + "=" if n else "") + (d if d else fmt(v)))
        changed |= d is not None
    if changed and not is_set:
        eq.append(("fractions written as decimals", r" \text{ or } ".join(dec) if var_names else ";".join(dec)))
    for why, t in eq:
        try:
            ok = same_values(parse_values(t), K)
        except (ParseError, Exception):
            ok = False
        if ok:
            cases.append({"input": typed(t, "ascii"), "expect": "correct", "why": "equivalent:" + why})
    # near misses: a value changed, a value dropped
    nm = []
    if K:
        n0, v0 = K[0]
        if not isinstance(v0, tuple):
            bumped = [((n + "=") if n else "") + fmt(v + 1 if k == 0 else v) for k, (n, v) in enumerate(K)]
            nm.append(("one value changed", ";".join(bumped)))
            neg = [((n + "=") if n else "") + fmt(-v if k == len(K) - 1 else v) for k, (n, v) in enumerate(K)]
            nm.append(("one sign flipped", ";".join(neg)))
        if len(K) > 1:
            nm.append(("one value missing", ";".join(((n + "=") if n else "") + fmt(v) for n, v in K[:-1])))
    for why, t in nm:
        try:
            differs = not same_values(parse_values(t), K)
        except Exception:
            differs = False
        if differs:
            cases.append({"input": typed(t, "ascii"), "expect": "incorrect", "why": "near_miss:" + why})
    return cases


# ------------------------------------------------------------------ coordinates
def build_coordinates(key):
    m = re.fullmatch(r"([A-Z](?:_\{[^}]*\})?)?\s*=?\s*\((.+);(.+)\)", key.strip())
    name, a, b = m.group(1), m.group(2), m.group(3)
    A, B = parse_expr(a), parse_expr(b)
    cases = []
    if name:
        cases.append({"input": typed(f"({a};{b})", "ascii"), "expect": "correct", "why": "equivalent:without the point's name"})
    alt = []
    for comp in (A, B):
        d = decimal_of(comp)
        alt.append(d if d else fmt(comp))
    if alt != [a, b]:
        cases.append({"input": typed(f"({alt[0]};{alt[1]})", "ascii"), "expect": "correct", "why": "equivalent:components rewritten"})
    cases.append({"input": f"({typed(a, 'ascii')}, {typed(b, 'ascii')})", "expect": "correct", "why": "equivalent:comma separator"})
    if not equal(A, B):
        cases.append({"input": typed(f"({b};{a})", "ascii"), "expect": "incorrect", "why": "near_miss:components swapped"})
    if A != 0:
        cases.append({"input": typed(f"({fmt(-A)};{b})", "ascii"), "expect": "incorrect", "why": "near_miss:one sign flipped"})
    else:
        cases.append({"input": typed(f"({a};{fmt(B + 1)})", "ascii"), "expect": "incorrect", "why": "near_miss:one value changed"})
    return cases


# ------------------------------------------------------------------ intervals
REL = {"<": "lt", ">": "gt", r"\le": "le", r"\ge": "ge", r"\ne": "ne"}


def parse_interval(tex):
    """-> (variable or None, SymPy set, domain) for the dialect's inequalities, interval notation and set-builder."""
    t = tex.strip()
    t = re.sub(r"^\\\{\s*([a-z]|\\theta)\s*:\s*", r"", t)
    t = re.sub(r"\\\}\s*$", "", t)
    domain = sp.S.Reals
    var = None
    pieces = [p for p in split_top(t, [";", ","]) if p]
    conj = []
    for p in pieces:
        m = re.fullmatch(r"([a-z]|\\theta)\s*\\in\s*\\mathbb\{?([RZN])\}?", p.replace(r"\mathbb{", r"\mathbb{"))
        m = re.fullmatch(r"([a-z]|\\theta)\s*\\in\s*\\mathbb\{([RZN])\}", p)
        if m:
            var = m.group(1)
            domain = {"R": sp.S.Reals, "Z": sp.S.Integers, "N": sp.S.Naturals}[m.group(2)]
            continue
        conj.append(p)
    S = domain
    for p in conj:
        v, s = parse_piece(p)
        var = var or v
        S = sp.Intersection(S, s)
    return var, sp.simplify(S) if False else S


def parse_piece(p):
    """One piece: a union of ranges, 'x \\in <interval>', an inequality chain, or x \\ne a."""
    p = p.strip()
    if r" \text{ and } " in p or r" \text{ or } " in p:
        subs = [q for q in re.split(r" \\text\{ (?:and|or) \} ", p) if q]
        if all(r"\ne" in q for q in subs):
            S, var = sp.S.Reals, None
            for q in subs:
                v, s = parse_piece(q)
                var = var or v
                S = sp.Intersection(S, s)
            return var, S
        S, var = sp.S.EmptySet, None
        for q in subs:
            v, s = parse_piece(q)
            var = var or v
            S = sp.Union(S, s)
        return var, S
    m = re.fullmatch(r"([a-z]|\\theta)\s*\\in\s*(.+)", p)
    if m:
        return m.group(1), parse_notation(m.group(2))
    if p[0] in "([" and ";" in p:
        return None, parse_notation(p)
    toks = re.split(r"(\\le|\\ge|\\ne|<|>)", p)
    toks = [x.strip() for x in toks]
    exprs, ops = toks[0::2], toks[1::2]
    var = next((e for e in exprs if re.fullmatch(r"[a-z]|\\theta", e)), None)
    if var is None:
        raise ParseError("no variable in inequality")
    S = sp.S.Reals
    X = sp.Symbol("X")
    for k, op in enumerate(ops):
        L, R = exprs[k], exprs[k + 1]
        if op == r"\ne":
            if L == var:
                S = sp.Intersection(S, sp.Complement(sp.S.Reals, sp.FiniteSet(*expand_pm(R))))
            continue
        lv = X if L == var else parse_expr(L)
        rv = X if R == var else parse_expr(R)
        rel = {"<": sp.Lt, ">": sp.Gt, r"\le": sp.Le, r"\ge": sp.Ge}[op](lv, rv)
        S = sp.Intersection(S, rel.as_set() if False else sp.solveset(rel, X, sp.S.Reals))
    return var, S


def expand_pm(t):
    t = t.strip()
    if t.startswith(r"\pm"):
        v = parse_expr(t[3:])
        return [v, -v]
    return [parse_expr(t)]


def parse_notation(t):
    t = t.strip()
    parts = [q.strip() for q in t.split(r"\cup")]
    S = sp.S.EmptySet
    for q in parts:
        m = re.fullmatch(r"([\[(])(.+);(.+)([\])])", q)
        if not m:
            raise ParseError(f"interval notation {q}")
        lo = -sp.oo if m.group(2).strip() in (r"-\infty", r"- \infty") else parse_expr(m.group(2))
        hi = sp.oo if m.group(3).strip() in (r"\infty", r"+\infty") else parse_expr(m.group(3))
        S = sp.Union(S, sp.Interval(lo, hi, m.group(1) == "(", m.group(4) == ")"))
    return S


def render_notation(S):
    parts = S.args if isinstance(S, sp.Union) else (S,)
    out = []
    for I in parts:
        if not isinstance(I, sp.Interval):
            return None
        lo = r"-\infty" if I.start == -sp.oo else fmt(I.start)
        hi = r"\infty" if I.end == sp.oo else fmt(I.end)
        out.append(("(" if I.left_open else "[") + lo + ";" + hi + (")" if I.right_open else "]"))
    return r" \cup ".join(out)


def render_inequality(S, var):
    parts = S.args if isinstance(S, sp.Union) else (S,)
    out = []
    for I in parts:
        if not isinstance(I, sp.Interval):
            return None
        a = None if I.start == -sp.oo else fmt(I.start)
        b = None if I.end == sp.oo else fmt(I.end)
        lo = "<" if I.left_open else r"\le "
        hi = "<" if I.right_open else r"\le "
        if a and b:
            out.append(f"{a}{lo}{var}{hi}{b}")
        elif a:
            out.append(f"{var}{'>' if I.left_open else chr(92) + 'ge '}{a}")
        elif b:
            out.append(f"{var}{hi}{b}")
        else:
            return None
    return r" \text{ or } ".join(out)


def build_interval(key):
    var, S = parse_interval(key)
    v = var or "x"
    cases = []
    base = S
    if isinstance(S, sp.Intersection) or isinstance(S, sp.Complement):
        base = None
    eq = []
    if base is not None and (isinstance(base, (sp.Interval, sp.Union))):
        n = render_notation(base)
        q = render_inequality(base, v)
        if n:
            eq.append(("interval notation", n))
            eq.append(("variable in interval", f"{v}\\in {n}"))
        if q:
            eq.append(("inequality", q))
        if q and r" \text{ or } " not in q:
            eq.append(("set-builder", f"\\{{{v}:{v}\\in \\mathbb{{R}},{q}\\}}"))
    for why, t in eq:
        try:
            _, T = parse_interval(t)
            ok = T == S or sp.simplify(sp.SymmetricDifference(T, S)) == sp.S.EmptySet
        except Exception:
            ok = False
        if ok and t != key:
            cases.append({"input": typed(t, "ascii"), "expect": "correct", "why": "equivalent:" + why})
    # near misses: an endpoint's inclusion flipped, an endpoint moved, the direction reversed
    if base is not None and isinstance(base, sp.Interval):
        I = base
        nm = []
        if I.start != -sp.oo:
            nm.append(("endpoint inclusion flipped", sp.Interval(I.start, I.end, not I.left_open, I.right_open)))
            nm.append(("endpoint moved", sp.Interval(I.start + 1, I.end, I.left_open, I.right_open)))
        elif I.end != sp.oo:
            nm.append(("endpoint inclusion flipped", sp.Interval(I.start, I.end, I.left_open, not I.right_open)))
            nm.append(("endpoint moved", sp.Interval(I.start, I.end + 1, I.left_open, I.right_open)))
        if I.start == -sp.oo and I.end != sp.oo:
            nm.append(("direction reversed", sp.Interval(I.end, sp.oo, I.right_open, True)))
        elif I.end == sp.oo and I.start != -sp.oo:
            nm.append(("direction reversed", sp.Interval(-sp.oo, I.start, True, I.left_open)))
        for why, J in nm:
            q = render_inequality(J, v)
            if q and J != S:
                cases.append({"input": typed(q, "ascii"), "expect": "incorrect", "why": "near_miss:" + why})
    return cases


# ------------------------------------------------------------------ equations
def residual(tex_or_typed, is_latex):
    from build_testset import oracle_typed
    s = tex_or_typed
    if is_latex:
        l, r = s.split("=", 1)
        return l, r
    l, r = s.split("=", 1)
    return l, r


def eq_holds(eq_latex, var, branches, other, is_typed=False):
    """Does the equation hold on the key's graph (var = each branch) and fail just off it?"""
    from build_testset import oracle_typed
    l, r = eq_latex.split("=", 1)
    P = (lambda t: oracle_typed(t)) if is_typed else parse_expr
    f = P(l) - P(r)
    V = sp.Symbol(var)
    rng = random.Random(11)
    on = off = 0
    for _ in range(8):
        sub = {sp.Symbol(o): sp.Rational(rng.randint(11, 97), rng.randint(7, 23)) for o in other}
        for B in branches:
            val = B.subs(sub)
            try:
                a = complex(f.subs(sub).subs(V, val).evalf(30))
                b = complex(f.subs(sub).subs(V, val + sp.Rational(37, 100)).evalf(30))
            except Exception:
                continue
            if a != a or b != b:
                continue
            scale = max(1.0, abs(complex(val.evalf())))
            if abs(a) > 1e-8 * scale:
                return False
            on += 1
            if abs(b) > 1e-8 * scale:
                off += 1
    return on >= 4 and off >= on // 2


def build_equation(item, key):
    form = item["form"]
    sides = [s.strip() for s in key.split("=")]
    lhs, rhs = sides
    fn = re.fullmatch(r"([a-z])\(x\)", lhs)
    lone = r"[A-Za-z](?:_\{[^}]*\})?|\\theta|\\alpha|\\beta|\\lambda"
    if not re.fullmatch(lone, lhs) and not fn and re.fullmatch(lone, rhs):
        lhs, rhs = rhs, lhs
    if fn:
        lhs_sym = "y"
        key_norm = "y=" + rhs
    else:
        lhs_sym = lhs.strip("\\")
        key_norm = lhs + "=" + rhs
    cases = []
    if fn:
        cases.append({"input": typed(key_norm, "ascii"), "expect": "correct", "why": "equivalent:y for the function's name"})
    pm = rhs.startswith(r"\pm")
    R = parse_expr(rhs[3:] if pm else rhs)
    branches = [R, -R] if pm else [R]
    others = sorted({str(s) for s in R.free_symbols})
    V = sp.Symbol(lhs_sym)
    cases.append({"input": typed(rhs + "=" + (lhs if not fn else "y"), "ascii"), "expect": "correct", "why": "equivalent:sides swapped"})
    if not pm:
        e = sp.expand(R)
        if e != R:
            cases.append({"input": f"{lhs_sym} = {sp.sstr(e).replace('**', '^')}", "expect": "correct", "why": "equivalent:right side expanded"})
        moved = f"{sp.sstr(sp.expand(V - R)).replace('**', '^')} = 0"
        doubled = f"{sp.sstr(2 * V).replace('**', '^')} = {sp.sstr(sp.expand(2 * R)).replace('**', '^')}"
        if form:
            cases.append({"input": moved, "expect": "wrong_form", "form": "subject", "why": "form:not solved for the subject"})
            cases.append({"input": doubled, "expect": "wrong_form", "form": "subject", "why": "form:a multiple of the subject"})
        else:
            cases.append({"input": moved, "expect": "correct", "why": "equivalent:everything on one side"})
            cases.append({"input": doubled, "expect": "correct", "why": "equivalent:both sides doubled"})
    else:
        sq = f"{lhs_sym}^2 = {sp.sstr(sp.expand(R ** 2)).replace('**', '^')}"
        cases.append({"input": sq, "expect": "wrong_form" if form else "correct", "form": "subject",
                      "why": "form:squared, not solved" if form else "equivalent:squared form"})
        cases.append({"input": f"{lhs_sym} = {sp.sstr(R).replace('**', '^')}", "expect": "incorrect", "why": "near_miss:the negative root dropped"})
    from build_testset import slips
    for how, t in ([] if pm else slips(typed(rhs, "ascii"))):
        cases.append({"input": f"{lhs_sym} = {'+-' if pm else ''}{t}", "expect": "incorrect", "why": "near_miss:" + how})
    # verify every non-unreadable case against the graph of the key
    kept = []
    for c in cases:
        try:
            holds = eq_holds(c["input"], lhs_sym, branches, others, is_typed=True) and all(
                eq_holds(c["input"], lhs_sym, [b], others, is_typed=True) for b in branches)
        except Exception:
            continue
        if c["why"] == "near_miss:the negative root dropped":
            # holds on one branch only: a different solution set
            if not holds:
                kept.append(c)
            continue
        if holds == (c["expect"] in ("correct", "wrong_form")):
            kept.append(c)
    if fn:
        pass
    return kept


# ------------------------------------------------------------------ recurring decimals
def build_recurring(key):
    v = recurring_value(key)
    m = re.fullmatch(r"(-?\d+)[,.]((?:\d|\\dot\{\d\})+)", key.replace(" ", ""))
    ip, frac = m.group(1), m.group(2)
    digits = re.findall(r"\\dot\{(\d)\}|(\d)", frac)
    seq = [(d or e, bool(d)) for d, e in digits]
    dotted = [k for k, (_, dt) in enumerate(seq) if dt]
    a, b = dotted[0], dotted[-1]
    pre = "".join(d for d, _ in seq[:a])
    rep = "".join(d for d, _ in seq[a:b + 1])
    cases = [
        {"input": f"{ip}.{pre}{rep * 3}...", "expect": "correct", "why": "equivalent:ellipsis"},
        {"input": f"{ip}.{pre}({rep})", "expect": "correct", "why": "equivalent:period in brackets"},
        {"input": f"{sp.fraction(v)[0]}/{sp.fraction(v)[1]}", "expect": "correct", "why": "equivalent:the fraction (equal rational value, per contract)"},
        {"input": f"{ip}.{pre}{rep}", "expect": "incorrect", "why": "near_miss:terminating, not recurring"},
        {"input": f"{ip}.{pre}({rep}{int(rep[-1]) + 1 if rep[-1] != '9' else 0})", "expect": "incorrect", "why": "near_miss:wrong period"},
    ]
    return cases


def build_structured(item, key):
    k = item["kind"]
    if k == "values":
        return build_values(key)
    if k == "coordinates":
        return build_coordinates(key)
    if k == "interval":
        return build_interval(key)
    if k == "equation":
        return build_equation(item, key)
    if k == "recurring":
        return build_recurring(key)
    return []

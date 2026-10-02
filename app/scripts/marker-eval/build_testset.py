"""Step 3 of 3 (needs SymPy: python3 -m venv venv && venv/bin/pip install sympy).

Build the marker test set from the classified printed answers (classify.py -> classified.json).

For every in-scope item it writes the contract MarkerSpec and a list of cases {input, expect, why}:
  typed_as_printed   the key LaTeX itself (a MathLive-style entry), an ASCII typing, a Unicode typing
  equivalent:*       rewrites SymPy proves equal (reordered, expanded, factorised, other notations)
  near_miss:*        realistic slips SymPy proves NOT equal (a sign, a coefficient, an exponent, a value)
  form:*             equivalent answers in a form the question does not accept
  unreadable:*       truncated or malformed input
Every label is checked by SymPy through its OWN parser (sympy_parser for typed strings, latex_sympy for LaTeX),
never by the marker under test. A variant whose SymPy label disagrees with its intent is dropped, not relabelled.

Deterministic: no randomness except a fixed-seed PRNG.

Reproduce (from a scratch directory; the S0 scan outputs are described in services/extraction/runbook/g10-s0-report.md §7):
  M=app/scripts/marker-eval
  python3 $M/extract_answers.py <Gr10_Mathematics_Learner_Eng_v11.pdf> <scan>/pdf_scan.json leaves.json
  G10_SCAN_DIR=<scan> venv/bin/python $M/classify.py        # -> classified.json
  G10_SCAN_DIR=<scan> venv/bin/python $M/build_testset.py   # -> testset.json and g10-marker-testset.json
Outputs go to the working directory; the committed fixture is the last one. The run takes about a minute.
"""
import json
import random
import re
import sys

import sympy as sp
from sympy.parsing.sympy_parser import (convert_xor, implicit_multiplication_application, parse_expr as sp_parse,
                                        split_symbols_custom, standard_transformations, _token_splittable)

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from latex_sympy import ParseError, parse_expr, recurring_value  # noqa: E402
from classify import split_top  # noqa: E402

RNG = random.Random(20260925)


# ------------------------------------------------------------------ LaTeX -> typed text (structure preserved)
def _arg(s, i):
    """Brace group starting at s[i] == '{' -> (content, next index)."""
    assert s[i] == "{", (s, i)
    depth, j = 0, i
    while True:
        if s[j] == "{" and (j == 0 or s[j - 1] != "\\"):
            depth += 1
        elif s[j] == "}" and s[j - 1] != "\\":
            depth -= 1
            if depth == 0:
                return s[i + 1:j], j + 1
        j += 1


SUP = {"0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹"}


def atomic(t):
    return re.fullmatch(r"-?\d+([.,]\d+)?|[A-Za-zπθ]|\d+[A-Za-z]", t) is not None


def typed(latex, style):
    """style 'ascii': keyboard only (^, sqrt(), pi, *, <=, decimal point, (x, y));
       style 'unicode': what a phone keyboard offers (², √, π, ×, −, ≤, decimal comma kept as printed)."""
    u = style == "unicode"
    out, i, s = [], 0, latex
    while i < len(s):
        c = s[i]
        if s.startswith("\\frac", i):
            a, j = _arg(s, i + 5)
            b, k = _arg(s, j)
            A, B = typed(a, style), typed(b, style)
            # a mixed number: an integer right before an integer fraction
            if out and re.search(r"\d$", "".join(out)) and re.fullmatch(r"\d+", A) and re.fullmatch(r"\d+", B):
                out.append(" ")
            A = A if re.fullmatch(r"-?\d+([.,]\d+)?|[A-Za-zπθ]", A) else f"({A})"
            B = B if re.fullmatch(r"\d+([.,]\d+)?|[A-Za-zπθ]", B) else f"({B})"
            frac = f"{A}/{B}"
            nxt = s[k:k + 1]
            if nxt and (nxt.isalnum() or nxt in "(\\") and not s.startswith("\\text", k):
                frac = f"({frac})"
            out.append(frac)
            i = k
        elif s.startswith("\\sqrt", i):
            j = i + 5
            n = None
            if s[j] == "[":
                n = s[j + 1:s.index("]", j)]
                j = s.index("]", j) + 1
            a, k = _arg(s, j)
            A = typed(a, style)
            nxt = s[k:k + 1]
            bare = re.fullmatch(r"\d+|[A-Za-z]", A) and not (nxt and (nxt.isalnum() or nxt in "(\\"))
            if n:
                out.append(("∛" + (A if bare else f"({A})")) if (u and n == "3") else f"({A})^(1/{n})")
            else:
                out.append(("√" + (A if bare else f"({A})")) if u else f"sqrt({A})")
            i = k
        elif s.startswith("\\dot", i):
            a, k = _arg(s, i + 4)
            out.append(a + "̇" if u else f"\u0000{a}")
            i = k
        elif s.startswith("\\bar", i):
            a, k = _arg(s, i + 4)
            out.append(a + "̄" if u else a + "bar")
            i = k
        elif s.startswith("\\text", i):
            a, k = _arg(s, i + 5)
            out.append(" " + a.strip() + " ")
            i = k
        elif s.startswith("\\mathbb", i):
            a, k = _arg(s, i + 7)
            out.append({"R": "ℝ", "Z": "ℤ", "N": "ℕ"}.get(a, a) if u else a)
            i = k
        elif c == "\\":
            m = re.match(r"\\([A-Za-z]+|.)", s[i:])
            name = m.group(1)
            rep = {"pi": ("pi", "π"), "theta": ("theta", "θ"), "alpha": ("alpha", "α"), "beta": ("beta", "β"),
                   "lambda": ("lambda", "λ"), "pm": ("+-", "±"), "times": ("*", "×"), "cdot": ("*", "·"),
                   "le": ("<=", "≤"), "ge": (">=", "≥"), "ne": ("!=", "≠"), "in": (" in ", "∈"),
                   "infty": ("inf", "∞"), "cup": (" U ", "∪"), "{": ("{", "{"), "}": ("}", "}"), "%": ("%", "%")}
            if name not in rep:
                raise ValueError(f"typed(): {name}")
            out.append(rep[name][1 if u else 0])
            i += len(m.group(0))
        elif c == "^":
            if s[i + 1] == "{":
                a, k = _arg(s, i + 1)
            else:
                a, k = s[i + 1], i + 2
            A = typed(a, style)
            if u and all(ch in SUP for ch in A):
                out.append("".join(SUP[ch] for ch in A))
            else:
                out.append("^" + (A if re.fullmatch(r"\d+|[A-Za-z]", A) else f"({A})"))
            i = k
        elif c == "_":
            if s[i + 1] == "{":
                a, k = _arg(s, i + 1)
            else:
                a, k = s[i + 1], i + 2
            out.append("_" + (a if re.fullmatch(r"[A-Za-z0-9]+", a) else f"({typed(a, style)})"))
            i = k
        elif c == "-":
            out.append("−" if u else "-")
            i += 1
        elif c == "," and out and re.search(r"\d$", out[-1]) and i + 1 < len(s) and (s[i + 1].isdigit() or s.startswith("\\dot", i + 1)):
            out.append("," if u else ".")
            i += 1
        elif c == ";":
            out.append("; " if u else ", ")
            i += 1
        else:
            out.append(c)
            i += 1
    t = "".join(out)
    # recurring digits in ascii style: 0.\0 2\0 1 -> 0.(21)
    t = re.sub(r"((?:\u0000\d)+)", lambda m: "(" + m.group(1).replace("\u0000", "") + ")", t)
    return re.sub(r"\s+", " ", t).strip()


# ------------------------------------------------------------------ SymPy oracle for typed strings
TRANSFORMS = standard_transformations + (convert_xor, implicit_multiplication_application)


def oracle_typed(t):
    """A typed string -> SymPy (the oracle's own reading, not the marker's)."""
    s = t.replace("−", "-").replace("×", "*").replace("·", "*").replace("π", "pi").replace("θ", "theta")
    s = re.sub(r"√\(", "sqrt(", s)
    s = re.sub(r"√([0-9A-Za-z]+)", r"sqrt(\1)", s)
    s = re.sub(r"∛\(", "cbrt(", s)
    s = re.sub(r"∛([0-9A-Za-z]+)", r"cbrt(\1)", s)
    inv = {v: k for k, v in SUP.items()}
    s = re.sub("[" + "".join(SUP.values()) + "]+", lambda m: "^(" + "".join(inv[c] for c in m.group(0)) + ")", s)
    s = re.sub(r"(\d)([A-Za-z(])", r"\1*\2", s)  # 2j is not a complex literal here
    s = re.sub(r"(\d),(\d)", r"\1.\2", s)
    # single-letter variables: split letter runs that are not function names
    def split_run(m):
        w = m.group(0)
        if w in ("sqrt", "cbrt", "pi", "theta", "alpha", "beta", "sin", "cos", "tan", "lambda"):
            return w
        return "*".join(w)
    s = re.sub(r"[A-Za-z]+", split_run, s)
    s = s.replace("c*b*r*t", "cbrt")
    return sp_parse(s, transformations=TRANSFORMS, local_dict={"theta": sp.Symbol("theta"), "lambda": sp.Symbol("lambda"),
                                                                 "E": sp.Symbol("E"), "I": sp.Symbol("I"), "S": sp.Symbol("S"),
                                                                 "N": sp.Symbol("N"), "Q": sp.Symbol("Q"), "O": sp.Symbol("O"),
                                                                 "beta": sp.Symbol("beta"), "alpha": sp.Symbol("alpha")})


def equal(a, b):
    """Exact equality, with a seeded numeric fallback when simplify() cannot decide."""
    try:
        d = sp.simplify(a - b)
        if d == 0:
            return True
    except Exception:
        pass
    syms = sorted((a - b).free_symbols, key=str)
    rng = random.Random(7)
    ok = 0
    for _ in range(12):
        sub = {v: sp.Rational(rng.randint(11, 97), rng.randint(7, 23)) for v in syms}
        try:
            x, y = complex(a.subs(sub).evalf(30)), complex(b.subs(sub).evalf(30))
        except Exception:
            continue
        if any(map(lambda z: z != z or abs(z) == float("inf"), [x, y])):
            continue
        if abs(x - y) > 1e-9 * max(1, abs(x), abs(y)):
            return False
        ok += 1
    return ok >= 4


def ascii_of(e):
    return sp.sstr(e).replace("**", "^")


# ------------------------------------------------------------------ string-level slips (realistic, structure kept)
def slips(t):
    """Near-miss candidates from a typed string: a sign flipped, a digit changed, an exponent bumped."""
    out = []
    m = [k for k, ch in enumerate(t) if ch in "+-" and k > 0 and t[k - 1] not in "^(e"]
    if m:
        k = m[0]
        out.append(("sign", t[:k] + ("-" if t[k] == "+" else "+") + t[k + 1:]))
    elif t.startswith("-"):
        out.append(("sign", t[1:]))
    else:
        out.append(("sign", "-" + t if not t.startswith("(") or ")" not in t else "-" + t))
    d = [mm for mm in re.finditer(r"(?<![\^.,\d])\d+", t)]
    if d:
        mm = d[-1]
        out.append(("digit", t[:mm.start()] + str(int(mm.group(0)) + 1) + t[mm.end():]))
    e = re.search(r"\^(\d)", t)
    if e:
        out.append(("exponent", t[:e.start(1)] + str(int(e.group(1)) + 1) + t[e.end(1):]))
    return out


# ------------------------------------------------------------------ form-violating rewrites
def nonconst_factors(e):
    fs = []
    for f in sp.Mul.make_args(e):
        b, n = f.as_base_exp()
        if f.free_symbols:
            if n.is_Integer and n > 0 and b.free_symbols:
                fs += [b] * int(n)
            else:
                fs.append(f)
    return fs


def mul_str(parts):
    def w(p):
        s = ascii_of(p)
        return s if re.fullmatch(r"[A-Za-z0-9_^]+", s) else f"({s})"
    return "*".join(w(p) for p in parts)


def build_expression(item, K):
    """Cases for kind expression (and the value side of surd)."""
    cases = []
    form = item["form"]
    f = K
    # equivalents
    eq = []
    if form == "factorised":
        fac = sp.factor(f)
        parts = list(sp.Mul.make_args(fac))
        eq.append(("reordered factors", mul_str(list(reversed(parts)))))
        eq.append(("sympy factor()", ascii_of(fac)))
        adds = [p for p in parts if p.is_Add]
        if len(adds) >= 2:
            rest = [p for p in parts if p is not adds[0] and p is not adds[1]]
            eq.append(("two factors negated", mul_str(rest + [sp.expand(-adds[0]), sp.expand(-adds[1])])))
    elif form == "expanded":
        ex = sp.expand(f)
        terms = ex.as_ordered_terms()
        eq.append(("sympy expand()", ascii_of(ex)))
        if len(terms) > 1:
            eq.append(("reordered terms", " + ".join(f"({ascii_of(t)})" for t in reversed(terms))))
    elif form == "simplest":
        eq.append(("sympy cancel()", ascii_of(sp.cancel(f))))
        eq.append(("sympy factor()", ascii_of(sp.factor(f))))
        terms = sp.Add.make_args(f)
        if len(terms) > 1:
            eq.append(("reordered terms", " + ".join(f"({ascii_of(t)})" for t in reversed(terms))))
    else:
        eq.append(("sympy expand()", ascii_of(sp.expand(f))))
        eq.append(("sympy factor()", ascii_of(sp.factor(f))))
        eq.append(("sympy cancel()", ascii_of(sp.cancel(f))))
    eq.append(("sympy latex()", sp.latex(sp.factor(f) if form == "factorised" else sp.expand(f) if form == "expanded" else f)))
    seen = set()
    for why, t in eq:
        if t in seen:
            continue
        seen.add(t)
        cases.append({"input": t, "expect": "correct", "why": "equivalent:" + why, "_oracle": "latex" if why == "sympy latex()" else "typed"})
    # wrong forms
    wf = []
    key_is_product = not K_is_sum(item)
    key_primitive = key_brackets_primitive(item)
    if form == "factorised" and not key_is_product:
        item.setdefault("findings", []).append("a factorise item whose printed answer is not a product")
    if form == "factorised" and not key_primitive:
        item.setdefault("findings", []).append("the printed factorised answer leaves a common factor inside a bracket")
    if form == "factorised" and key_is_product:
        ex = sp.expand(f)
        if sp.Add.make_args(ex) and len(sp.Add.make_args(ex)) > 1:
            wf.append(("expanded instead of factorised", ascii_of(ex)))
        fs = nonconst_factors(sp.factor(f))
        adds = [p for p in fs if p.is_Add]
        if adds and len(fs) >= 2 and "\\frac" not in item["key"]:
            ia = fs.index(adds[0])
            io = next(k for k in range(len(fs)) if k != ia)
            a0, other = fs[ia], fs[io]
            rest = [p for k, p in enumerate(fs) if k not in (ia, io)]
            const = sp.Mul(*[p for p in sp.Mul.make_args(sp.factor(f)) if not p.free_symbols])
            merged = sp.expand(a0 * other)
            if merged.is_Add:
                wf.append(("partly factorised", mul_str(([const] if const != 1 else []) + [merged] + rest)))
        c, prim = sp.factor(f).as_content_primitive()
        adds = [p for p in sp.Mul.make_args(sp.factor(f)) if p.is_Add]
        if c.is_Integer and abs(c) > 1 and adds and key_primitive:
            rest = [p for p in sp.Mul.make_args(sp.factor(f)) if p.free_symbols and p is not adds[0]]
            wf.append(("common factor left inside a bracket", mul_str([sp.expand(c * adds[0])] + rest)))
    elif form == "expanded":
        fac = sp.factor(f)
        if fac.is_Mul or fac.is_Pow:
            if len(nonconst_factors(fac)) >= 1 and sp.expand(fac) != fac:
                wf.append(("factorised instead of expanded", ascii_of(fac)))
        terms = sp.expand(f).as_ordered_terms()
        for k, t in enumerate(terms):
            c, m = t.as_coeff_Mul()
            if c.is_Integer and abs(c) >= 2 and m.free_symbols:
                split = f"({ascii_of((c - sp.sign(c)) * m)}) + ({ascii_of(sp.sign(c) * m)})"
                rest = " + ".join(f"({ascii_of(u)})" for j, u in enumerate(terms) if j != k)
                wf.append(("like terms not collected", split + (" + " + rest if rest else "")))
                break
    elif form == "simplest":
        v = sp.Symbol(item["variables"][0]) if item["variables"] else None
        mfrac = re.fullmatch(r"\\frac\{(.*)\}\{(.*)\}", item["key"])
        if mfrac:
            try:
                A, B = sp.expand(parse_expr(mfrac.group(1))), sp.expand(parse_expr(mfrac.group(2)))
                if sp.gcd(A, B).free_symbols:
                    item.setdefault("findings", []).append("the printed answer is not in lowest terms")
                    v = None
            except Exception:
                pass
        if v is not None:
            n, d = sp.fraction(sp.together(f))
            g = v + 1
            wf.append(("a common factor not cancelled", f"({ascii_of(sp.expand(n * g))})/({ascii_of(sp.expand(d * g))})"))
        if v is not None or mfrac:
            # a single-term key: a repeated variable (a^5 -> a^2*a^3)
            if not f.is_Add and v is not None:
                for p in sp.Mul.make_args(f):
                    b, e = p.as_base_exp()
                    if b.is_Symbol and e.is_Integer and e >= 2:
                        rest = [q for q in sp.Mul.make_args(f) if q is not p]
                        wf.append(("like factors not combined", "*".join([ascii_of(q) if not q.is_Add else f"({ascii_of(q)})" for q in rest]
                                                                       + [f"{b}^{e - 1}", str(b)])))
                        break
    for why, t in wf:
        cases.append({"input": t, "expect": "wrong_form", "form": form, "why": "form:" + why, "_oracle": "typed"})
    return cases


def K_is_sum(item):
    """Is the printed key itself a sum at the top level (then it is not in factorised form)?"""
    k = item["key"].strip()
    depth = 0
    for i, ch in enumerate(k):
        if ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth -= 1
        elif ch in "+-" and depth == 0 and i > 0:
            return True
    return False


def key_brackets_primitive(item):
    """Are all of the printed key's brackets primitive (no common factor left inside)?"""
    for m in re.finditer(r"\(([^()]*)\)", item["key"]):
        try:
            e = sp.expand(parse_expr(m.group(1)))
        except Exception:
            continue
        if e.is_Add:
            c, _ = e.as_content_primitive()
            if c.is_Integer and abs(c) > 1:
                return False
    return True


def build_values_like(item):
    return []


def main():
    C = json.load(open("classified.json"))
    out, dropped = [], []
    for it in C:
        if it["kind"] != "out_of_scope" and re.search(r"\d\.\d", it["key"]):
            it = dict(it, kind="out_of_scope", reason="the book's multiplication dot (2.3^x means 2*3^x): S3 writes \\cdot in the key")
        if it["kind"] == "out_of_scope":
            out.append({k: it[k] for k in ("id", "exercise", "q", "sub", "printed_page", "s0_type", "printed_latex", "kind", "reason")})
            continue
        try:
            item_out = build_item(it, dropped)
        except Exception as err:
            item_out = {k: it[k] for k in ("id", "exercise", "q", "sub", "printed_page", "s0_type", "printed_latex")} \
                | {"kind": "out_of_scope", "reason": f"the oracle cannot read the key ({type(err).__name__}: {str(err)[:50]})"}
        out.append(item_out)
    finish(out, dropped)


def build_item(it, dropped):
    if True:
        key = it["key"]
        spec = {"kind": it["kind"], "key": key, "form": it["form"], "variables": it["variables"], "tolerance": None}
        cases = [
            {"input": key, "expect": "correct", "why": "typed_as_printed:latex", "_oracle": "latex"},
            {"input": typed(key, "ascii"), "expect": "correct", "why": "typed_as_printed:ascii", "_oracle": "typed"},
            {"input": typed(key, "unicode"), "expect": "correct", "why": "typed_as_printed:unicode", "_oracle": "typed"},
        ]
        K = None
        if it["kind"] in ("expression", "surd"):
            K = parse_expr(key)
            cases += build_expression(it, K)
            for how, t in slips(typed(key, "ascii")):
                cases.append({"input": t, "expect": "incorrect", "why": "near_miss:" + how, "_oracle": "typed"})
            if it["kind"] == "surd":
                approx = sp.N(K, 4)
                cases.append({"input": str(approx).replace("I", "i"), "expect": "wrong_form", "form": "exact",
                              "why": "form:decimal approximation of an exact answer", "_oracle": "skip"})
        else:
            from structures import build_structured  # values, intervals, coordinates, equations, recurring
            cases += build_structured(it, key)
        # label check by the oracle
        kept = []
        for c in cases:
            o = c.pop("_oracle", "typed")
            if K is None or o == "skip" or c["expect"] == "unreadable":
                kept.append(c)
                continue
            try:
                v = parse_expr(c["input"]) if o == "latex" else oracle_typed(c["input"])
            except Exception as err:  # the oracle cannot read its own variant: drop it
                dropped.append((it["id"], c["input"], c["why"], f"oracle parse: {err}"[:80]))
                continue
            same = equal(v, K)
            want_same = c["expect"] in ("correct", "wrong_form")
            if same != want_same:
                dropped.append((it["id"], c["input"], c["why"], "oracle label disagrees"))
                continue
            kept.append(c)
        # unreadable: a truncated typing (cut before its last closing bracket or last operand)
        a = typed(key, "ascii")
        if ")" in a:
            kept.append({"input": a[:a.rindex(")")], "expect": "unreadable", "why": "unreadable:unclosed bracket"})
        else:
            kept.append({"input": a + " +", "expect": "unreadable", "why": "unreadable:dangling operator"})
        return {k: it[k] for k in ("id", "exercise", "q", "sub", "printed_page", "s0_type", "printed_latex", "stem_words")} \
            | {"spec": spec, "cases": kept} | ({"findings": it["findings"]} if it.get("findings") else {})


def finish(out, dropped):
    # a non-real surd (sqrt(-24)) answers "which numbers are non-real": a choice question
    for i, t in enumerate(out):
        if t.get("spec") and "\\sqrt{-" in t["spec"]["key"]:
            out[i] = {k: t[k] for k in ("id", "exercise", "q", "sub", "printed_page", "s0_type", "printed_latex")} | {
                "kind": "out_of_scope", "reason": 'a non-real number: "which numbers are non-real" is a choice question'}
    write_fixture(out)
    json.dump(out, open("testset.json", "w"), ensure_ascii=False, indent=1)
    json.dump(dropped, open("testset.dropped.json", "w"), ensure_ascii=False, indent=1)
    import collections
    n = collections.Counter()
    for o in out:
        for c in o.get("cases", []):
            n[(o["spec"]["kind"], c["why"].split(":")[0], c["expect"])] += 1
    for k, v in sorted(n.items()):
        print(k, v)
    print("items", len(out), "in scope", sum(1 for o in out if "spec" in o), "cases", sum(n.values()), "dropped", len(dropped))


def write_fixture(out, dst="g10-marker-testset.json"):
    """The committed fixture: one item per line, so a change to one answer is a one-line diff."""
    meta = {"source": "Siyavula Everything Maths Grade 10 v1.1 CAPS, Solutions to exercises (printed pp. 497-514)",
            "built_by": "app/scripts/marker-eval/{extract_answers,classify,build_testset}.py (deterministic; SymPy labels every case)",
            "items": len(out), "in_scope": sum(1 for t in out if t.get("spec")),
            "cases": sum(len(t.get("cases", [])) for t in out)}
    rows = []
    for t in out:
        if t.get("spec"):
            o = {"id": t["id"], "page": t["printed_page"], "printed": t["printed_latex"], "spec": t["spec"],
                 "cases": [{k: c[k] for k in ("input", "expect", "why", "form") if k in c} for c in t["cases"]]}
            if t.get("findings"):
                o["findings"] = t["findings"]
        else:
            o = {"id": t["id"], "page": t["printed_page"], "printed": t["printed_latex"], "out_of_scope": t["reason"]}
        rows.append(o)
    with open(dst, "w") as f:
        f.write('{"meta":' + json.dumps(meta, ensure_ascii=False) + ',\n"items":[\n')
        f.write(",\n".join(json.dumps(o, ensure_ascii=False, separators=(",", ":")) for o in rows))
        f.write("\n]}\n")


if __name__ == "__main__":
    main()

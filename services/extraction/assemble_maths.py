"""S0b maths transcription: everything that is not a model call (spec §3.3, build item B21; T419).

    uv run assemble_maths.py recover g10-math            # 1. deterministic: every image whose LaTeX a hash proves
    uv run assemble_maths.py estimate g10-math           # 2. what the vision passes on the rest would cost
    uv run assemble_maths.py vision-args g10-math --pass A [--batch 25] [--chapter 8] > args.json
                                                         # 3. the Workflow args for runbook/transcribe-maths.workflow.js
    uv run assemble_maths.py assemble g10-math runs/g10-math/maths/*.json [--human runs/g10-math/maths/human.json]
                                                         # 4. accept, cross-check, queue → runs/<book>/maths/
    uv run assemble_maths.py vision-args g10-math --pass C --runs runs/g10-math/maths/*.json > args-c.json
                                                         # 5. the THIRD reading, only where A and B did not agree
    uv run assemble_maths.py assemble g10-math runs/g10-math/maths/*.json …   # 6. again, with pass C
    … | uv run assemble_maths.py md5check                # a transcriber's own hash probe (stdin JSON lines)

THE RULES (decision 21 as amended by Samuel's answer 11, 2026-09-25; FR-4407, SC-213). The
EPUB names every equation image md5(its LaTeX source). A transcription is ACCEPTED only
  by hash       md5(latex) == the file name — an exact proof, however the string was found; or
  by agreement  two INDEPENDENT vision passes (A and B, blind to each other) agree after
                normalisation (spacing, \\left/\\right, \\dfrac, \\text{} wrappers, alignment
                markup — never a symbol); or
  by a third reading   when A and B did NOT agree (they differ, or only one of them could read
                the image), a THIRD independent pass C — blind to both — reads it, and the
                image is accepted only when C agrees with A or with B after the same
                normalisation: two of three independent readings, never one. C is run
                only on those images (`vision-args --pass C --runs …`); or
  by a human    at gate G0b, recorded with who and when.
Nothing else is accepted, and nothing is guessed: an image no rule accepts is QUEUED
for G0b, and a lesson that needs it waits. An image the EPUB prints only inside a worked
solution (class `solution_only`) follows exactly the same rule — hash, agreement or the
third reading — and, because the PDF prints it nowhere, is never cross-checked (reported
per class in the summary's `routes_by_class`).

THE CROSS-CHECK. Every accepted image the PDF prints (it is used outside an EPUB worked
solution) is checked against the PDF text layer of the pages it is used on: the digits
and letters of the transcription must all occur within a short window of those pages'
text (an order-free window, because the text layer puts a fraction's numerator and
denominator on separate lines). A contradiction queues an agreement acceptance. A hash
acceptance is exact, so a contradiction there is recorded as a page-link problem, not
queued. An image used only in EPUB worked solutions is printed nowhere in the PDF and
cannot be cross-checked; it rests on its hash or on agreement alone (reported).

THE DETERMINISTIC RECOVERY (`recover`) hashes candidate strings and keeps exact matches:
  symbols    single letters, digits, Greek, relation and set symbols, the number sets, ""
  numbers    every number in the PDF text layer, bare and in Siyavula's \\text{…} style,
             with sign, degree, percent and Rand variants
  grammar    small expressions over letters and numbers in the book's compact style
             (a=0, k^{2}, \\sqrt{7}, (x;y), \\frac{a}{b}, …)
  pdf_lines  every run of maths on every PDF line, linearised from the span geometry
             (superscripts and subscripts by baseline and size, recurring dots, roots),
             every contiguous window of it, with and without \\text{} on each number
A candidate can only ever be accepted by its hash, so recall is the only thing these
heuristics affect; precision is exact.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import itertools
import json
import math
import re
import string
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

MATH_FONT_PREFIXES = ("CM", "MS")
UNITS = {"cm", "mm", "m", "km", "kg", "g", "ml", "mℓ", "ℓ", "l", "L", "s", "h", "min", "units", "unit", "cm2", "cm3",
         "m2", "m3", "mm2", "mm3", "km2"}
GREEK = ["alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota",
         "kappa", "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi",
         "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Phi", "Psi", "Omega"]
GREEK_CHAR = {"alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "varepsilon": "ε", "theta": "θ",
              "vartheta": "ϑ", "lambda": "λ", "mu": "μ", "pi": "π", "rho": "ρ", "sigma": "σ", "tau": "τ", "phi": "φ",
              "varphi": "ϕ", "omega": "ω", "Delta": "∆", "Sigma": "Σ", "Theta": "Θ", "Omega": "Ω", "Gamma": "Γ",
              "Phi": "Φ", "Pi": "Π", "Lambda": "Λ"}
SYMBOLS = ["+", "-", "=", "<", ">", "\\times", "\\div", "\\pm", "\\mp", "\\le", "\\leq", "\\ge", "\\geq", "\\neq",
           "\\ne", "\\infty", "\\circ", "^{\\circ}", "\\angle", "\\triangle", "\\parallel", "\\perp", "\\cdot",
           "\\ldots", "\\dots", "\\cdots", "\\in", "\\notin", "\\cup", "\\cap", "\\emptyset", "\\varnothing",
           "\\therefore", "\\because", "\\equiv", "\\approx", "\\sim", "\\cong", "\\rightarrow", "\\Rightarrow",
           "\\to", "\\leftrightarrow", "\\Leftrightarrow", "(", ")", "[", "]", "\\{", "\\}", ",", ";", ":", ".",
           "\\%", "%", "!", "|", "/", "'", "\\prime", "\\sqrt{}", "\\hat{}", "\\overline{}", "\\ast", "*",
           "\\subset", "\\subseteq", "\\forall", "\\exists", "\\neg", "\\wedge", "\\vee", "\\checkmark",
           "\\mathbb{N}", "\\mathbb{N}_0", "\\mathbb{N}_{0}", "\\mathbb{Z}", "\\mathbb{Q}", "\\mathbb{R}",
           "\\mathbb{Q}'", "\\mathbb{Q}^{\\prime}", "\\mathbb{I}", "\\mathbb{C}", "\\mathbb{R}^{+}", "\\mathbb{R}^{-}"]
UNICODE_TEX = {"−": "-", "–": "-", "×": "\\times", "÷": "\\div", "±": "\\pm", "∓": "\\mp", "≤": "\\leq", "≥": "\\geq",
               "≠": "\\neq", "≈": "\\approx", "≡": "\\equiv", "∼": "\\sim", "≅": "\\cong", "π": "\\pi", "θ": "\\theta",
               "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "λ": "\\lambda", "μ": "\\mu",
               "σ": "\\sigma", "φ": "\\phi", "ω": "\\omega", "∆": "\\Delta", "Δ": "\\Delta", "Σ": "\\Sigma",
               "∞": "\\infty", "∈": "\\in", "∉": "\\notin", "∠": "\\angle", "△": "\\triangle", "·": "\\cdot",
               "∴": "\\therefore", "⇒": "\\Rightarrow", "→": "\\rightarrow", "⇔": "\\Leftrightarrow",
               "∪": "\\cup", "∩": "\\cap", "∅": "\\emptyset", "∥": "\\parallel", "⊥": "\\perp", "′": "'",
               "∗": "\\ast", "…": "\\ldots", "{": "\\{", "}": "\\}", "|": "|", "ˆ": "\\hat"}


def md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


# ============================================================================ normalisation
def normalise(latex: str) -> str:
    """The agreement key: two transcriptions of one image are the same maths when these agree.

    It removes presentation only — spacing commands, \\left/\\right, \\displaystyle, the
    alignment markup of a multi-line derivation (environments and &), \\text{}/\\mathrm{}
    wrappers — and unifies spellings of one symbol (\\le/\\leq, \\dfrac/\\frac, ° forms,
    x^{2}/x^2). It never removes or changes a symbol, a digit or a letter.
    """
    s = latex.strip()
    s = re.sub(r"\\begin\{array\}\{[^}]*\}", "", s)
    s = re.sub(r"\\(begin|end)\{[a-zA-Z*]+\}", "", s)
    s = s.replace("&", "")
    s = re.sub(r"\\(displaystyle|textstyle|left|right|big|Big|bigg|Bigg)(?![a-zA-Z])", "", s)
    s = re.sub(r"\\(,|;|:|!| |quad|qquad)", "", s)
    s = s.replace("~", "")
    s = re.sub(r"\\[dt]frac(?![a-zA-Z])", r"\\frac", s)
    s = re.sub(r"\\le(?![a-zA-Z])", r"\\leq", s)
    s = re.sub(r"\\ge(?![a-zA-Z])", r"\\geq", s)
    s = re.sub(r"\\ne(?![a-zA-Z])", r"\\neq", s)
    s = s.replace("°", "^{\\circ}").replace("^\\circ", "^{\\circ}")
    s = s.replace("{,}", ",")
    for _ in range(3):   # \text{…} and friends: keep the content (nested braces allowed once)
        s = re.sub(r"\\(text|textrm|mathrm|textnormal|mbox)\{((?:[^{}]|\{[^{}]*\})*)\}", r"\2", s)
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"([\^_])\{(.)\}", r"\1\2", s)   # x^{2} ≡ x^2
    s = s.rstrip("\\")
    return s


def signature(latex: str) -> str:
    """The digits and letters a transcription puts on the page, for the PDF cross-check."""
    s = re.sub(r"\\(begin|end)\{[^}]*\}(\{[^}]*\})?", " ", latex)
    s = re.sub(r"\\mathbb\{(\w)\}", r"\1", s)
    s = re.sub(r"\\(text|textrm|mathrm|mathbf|textbf|mbox|operatorname)\{", "{", s)
    s = re.sub(r"\\([a-zA-Z]+)", lambda m: GREEK_CHAR.get(m.group(1), " "), s)
    return "".join(ch for ch in s if ch.isalnum())


def page_stream(scan: dict, pdf_page: int) -> str:
    lines = scan["page_spans"][pdf_page - 1] if 1 <= pdf_page <= len(scan["page_spans"]) else []
    return "".join(ch for _, spans in lines for sp in spans for ch in sp[5] if ch.isalnum())


def window_contains(stream: str, sig: str) -> bool:
    """Is every character of `sig` (as a multiset) inside some window of `stream`?"""
    if not sig:
        return True
    need = collections.Counter(sig)
    W = min(len(stream), 2 * len(sig) + 12)
    if W < len(sig):
        return False
    have = collections.Counter(stream[:W])
    missing = sum(max(0, n - have[c]) for c, n in need.items())
    if missing == 0:
        return True
    for i in range(W, len(stream)):
        out_c, in_c = stream[i - W], stream[i]
        if out_c in need and have[out_c] <= need[out_c]:
            missing += 1
        have[out_c] -= 1
        if in_c in need and have[in_c] < need[in_c]:
            missing -= 1
        have[in_c] += 1
        if missing == 0:
            return True
    return False


def cross_check(latex: str, rec: dict, scan: dict, offset: int, streams: dict) -> str:
    """consistent | contradicted | inconclusive | not_printed"""
    if rec["class"] != "printed" or not rec.get("printed_pages"):
        return "not_printed"
    sig = signature(latex)
    if len(sig) < 3:
        return "inconclusive"
    pages = set()
    for p in rec["printed_pages"]:
        pages.update({p - 1, p, p + 1})
    for p in sorted(pages):
        pdf = p + offset
        if pdf not in streams:
            streams[pdf] = page_stream(scan, pdf)
        if window_contains(streams[pdf], sig):
            return "consistent"
    return "contradicted"


# ============================================================================ deterministic recovery
class Recoverer:
    def __init__(self, targets):
        self.targets = set(targets)
        self.found: dict = {}
        self.tried = 0
        self.by_source = collections.Counter()

    def offer(self, s: str, source: str):
        self._offer(s, source)
        t = re.sub(r"\s+", "", s)
        if t != s:
            # Siyavula hashed its LaTeX with the whitespace removed: `(A\cupB)'` is a real file name
            self._offer(t, source)

    def _offer(self, s: str, source: str):
        self.tried += 1
        h = md5(s)
        if h in self.targets and h not in self.found:
            self.found[h] = {"latex": s, "source": source}
            self.by_source[source] += 1


def gen_symbols(r: Recoverer):
    for t in list(string.ascii_letters) + list(string.digits) + ["\\" + g for g in GREEK] + SYMBOLS + [""]:
        r.offer(t, "symbols")
    for a in string.ascii_uppercase:
        for pre in ("\\hat{%s}", "\\angle %s", "\\angle{%s}", "\\overline{%s}", "%s'", "%s^{\\prime}"):
            r.offer(pre % a, "symbols")


def numbers_in(scan: dict) -> set:
    nums = {str(i) for i in range(0, 2001)}
    for t in scan["page_text"]:
        for m in re.finditer(r"\d[\d ,\.]*\d|\d", t):
            s = m.group(0).strip()
            nums.add(s)
            nums.update(re.split(r"\s+", s))
            nums.update(x for x in re.split(r"[ ,]+", s) if x)
    return nums


def gen_numbers(r: Recoverer, nums: set):
    for n in nums:
        for v in {n, n.replace(" ", "\\ "), n.replace(" ", "\\,"), n.replace(" ", "\\;"), n.replace(" ", "")}:
            for pat in ("\\text{%s}", "%s", "-\\text{%s}", "\\text{-%s}", "-%s", "\\text{%s}^{\\circ}", "%s^{\\circ}",
                        "-\\text{%s}^{\\circ}", "\\text{%s}\\%%", "%s\\%%", "\\text{R }\\text{%s}", "\\text{R}\\text{%s}",
                        "\\text{R}%s", "\\text{R }%s", "\\text{R}\\,\\text{%s}", "\\text{%s}°", "(\\text{%s})",
                        "(%s)", "+\\text{%s}", "+%s", "\\pm\\text{%s}", "\\pm%s", "=\\text{%s}", "=%s", "=-\\text{%s}",
                        "\\text{%s}\\text{ cm}", "\\text{%s}\\text{ m}", "\\text{%s}\\text{ mm}", "\\text{%s}\\text{ km}",
                        "\\text{%s}\\text{ cm}^{2}", "\\text{%s}\\text{ m}^{2}", "\\text{%s}\\text{ cm}^{3}",
                        "\\text{%s}\\text{ m}^{3}", "\\text{%s}\\text{ kg}", "\\text{%s}\\text{ g}",
                        # Rand and units written inside one \\text{}: `\\text{R 5}` hashes as `\\text{R5}`
                        "\\text{R %s}", "\\text{R }\\text{%s}", "\\text{%s cm}", "\\text{%s m}", "\\text{%s mm}",
                        "\\text{%s km}", "\\text{%s kg}", "\\text{%s cm}^{2}", "\\text{%s cm}^{3}", "\\text{%s m}^{2}",
                        "\\text{%s m}^{3}", "\\text{%s}\\%%", "=\\text{R %s}", "-\\text{R %s}", "\\text{%s }\\%%"):
                r.offer(pat % v, "numbers")


def gen_grammar(r: Recoverer):
    L = list(string.ascii_letters)
    D = [str(i) for i in range(0, 101)]
    ND = [(d, "\\text{%s}" % d) for d in D]
    for a in L:
        for d, td in ND:
            for b in (d, td):
                r.offer("%s^{%s}" % (a, b), "grammar"); r.offer("%s^%s" % (a, b), "grammar")
                r.offer("%s_{%s}" % (a, b), "grammar"); r.offer("%s_%s" % (a, b), "grammar")
                r.offer("%s%s" % (b, a), "grammar"); r.offer("-%s%s" % (b, a), "grammar")
                r.offer("%s%s^{2}" % (b, a), "grammar"); r.offer("%s^{-%s}" % (a, b), "grammar")
                for op in ("=", "<", ">", "\\leq", "\\geq", "\\neq", "+", "-", "\\times"):
                    r.offer("%s%s%s" % (a, op, b), "grammar"); r.offer("%s%s-%s" % (a, op, b), "grammar")
                    r.offer("%s%s%s" % (b, op, a), "grammar")
                r.offer("\\sqrt{%s}" % b, "grammar"); r.offer("\\sqrt[3]{%s}" % b, "grammar")
                r.offer("%s\\sqrt{%s}" % (b, a), "grammar")
        for c in L:
            r.offer(a + c, "grammar")
            for op in ("+", "-", "=", "\\times", "\\div", "<", ">", "\\leq", "\\geq", ";", ",", "\\parallel",
                       "\\perp", "\\neq"):
                r.offer(a + op + c, "grammar")
            r.offer("(%s;%s)" % (a, c), "grammar"); r.offer("(%s,%s)" % (a, c), "grammar")
            r.offer("\\frac{%s}{%s}" % (a, c), "grammar"); r.offer("%s(%s)" % (a, c), "grammar")
            r.offer("%s_{%s}" % (a, c), "grammar")
    nums = [x for pair in ND[:41] for x in pair] + ["-" + d for d in D[:41]] + ["-\\text{%s}" % d for d in D[:41]]
    for x in nums:
        for y in nums:
            for pat in ("\\frac{%s}{%s}", "(%s;%s)", "\\left(%s;%s\\right)", "(%s,%s)", "%s\\times %s",
                        "%s+%s", "%s-%s", "\\dfrac{%s}{%s}", "-\\frac{%s}{%s}", "%s:%s", "[%s;%s]", "(%s;%s]",
                        "[%s;%s)", "%s^{%s}"):
                r.offer(pat % (x, y), "grammar")
    for a in string.ascii_uppercase:
        for b in string.ascii_uppercase:
            r.offer("%s\\hat{%s}" % (a, b), "grammar")
            for c in string.ascii_uppercase:
                r.offer(a + b + c, "grammar"); r.offer("\\triangle " + a + b + c, "grammar")
                r.offer("\\angle " + a + b + c, "grammar"); r.offer(a + "\\hat{" + b + "}" + c, "grammar")
                r.offer("\\triangle{" + a + b + c + "}", "grammar")
    for f in ("\\sin", "\\cos", "\\tan"):
        for arg in ["\\theta", "\\alpha", "\\beta", "x", "A", "B", "C", "\\hat{A}", "\\hat{B}", "\\hat{C}"] + \
                ["\\text{%s}^{\\circ}" % d for d in D] + ["%s^{\\circ}" % d for d in D]:
            for sep in (" ", "", "{", "("):
                s = f + sep + arg + ("}" if sep == "{" else ")" if sep == "(" else "")
                r.offer(s, "grammar")
                for v in ("x", "y", "\\theta"):
                    r.offer("%s=%s" % (s, v), "grammar")
    for fn in "fghpP":
        for v in "xyzabknt":
            r.offer("%s(%s)" % (fn, v), "grammar")
            for d, td in ND[:21]:
                for b in (d, td, "-" + d, "-" + td):
                    r.offer("%s(%s)" % (fn, b), "grammar")


def line_atoms(spans: list, fonts: list):
    """One PDF text line as maths runs: lists of atoms (kind, tex, role)."""
    big = [s for s in spans if s[1] >= 8.5]
    if not big:
        return []
    base = collections.Counter(round(s[4]) for s in big).most_common(1)[0][0]
    toks = []   # (is_math, role, char)
    for font_ix, size, x0, x1, y, text in spans:
        f = fonts[font_ix]
        is_math = f.startswith(MATH_FONT_PREFIXES)
        role = "base"
        if size < 8.5:
            role = "sup" if y < base - 1 else ("sub" if y > base + 1 else "base")
        if is_math:
            for ch in text:
                toks.append((True, role, ch))
        else:
            for w in re.split(r"(\s+)", text):
                if not w:
                    continue
                if w.isspace():
                    toks.append((False, "space", " "))
                elif re.fullmatch(r"[\d,\.;()=+\-−]+", w):
                    for ch in w:
                        toks.append((True, role, ch))
                elif w.rstrip(".,;") in UNITS:
                    toks.append((True, role, "\x00" + w.rstrip(".,;")))
                else:
                    toks.append((False, "word", w))
    runs, cur = [], []
    for t in toks:
        if t[0]:
            cur.append(t)
        elif t[1] == "space":
            continue
        else:
            if cur:
                runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    out = []
    for run in runs:
        atoms = []
        i = 0
        while i < len(run):
            _, role, ch = run[i]
            if ch.isspace():
                i += 1
                continue
            if ch.isdigit():
                j = i
                s = ""
                while j < len(run) and run[j][1] == role and (run[j][2].isdigit() or
                                                              (run[j][2] == "," and j + 1 < len(run) and run[j + 1][2].isdigit())):
                    s += run[j][2]
                    j += 1
                atoms.append(("num", s, role))
                i = j
                continue
            if ch == "˙" and i + 1 < len(run) and run[i + 1][2].isdigit():
                atoms.append(("dot", run[i + 1][2], role))
                i += 2
                continue
            if ch in ("◦", "°") and role != "sub":
                atoms.append(("deg", "^{\\circ}", "base"))
                i += 1
                continue
            if ch.startswith("\x00"):
                atoms.append(("unit", ch[1:], role))
                i += 1
                continue
            tex = UNICODE_TEX.get(ch, ch)
            atoms.append(("cmd" if tex.startswith("\\") else "chr", tex, role))
            i += 1
        if atoms:
            out.append(atoms)
    return out


def render(atoms: list, wrap: tuple, lr: bool, brace_base: bool = False, bare_script: bool = False,
           unit_space: bool = False) -> str:
    """Compact LaTeX from atoms; wrap[k] says whether the k-th number goes in \\text{}."""
    parts = []
    k = 0
    cur_role, buf = "base", []

    def flush():
        if not buf:
            return
        s = join(buf)
        if cur_role in ("sup", "sub"):
            mark = "^" if cur_role == "sup" else "_"
            if brace_base and parts and not parts[-1].endswith("}"):
                m = re.search(r"(\\[a-zA-Z]+|[A-Za-z0-9])$", parts[-1])
                if m:
                    parts[-1] = parts[-1][:m.start()] + "{" + m.group(1) + "}"
            if bare_script and len(s) == 1:
                parts.append(mark + s)
            else:
                parts.append(mark + "{" + s + "}")
        else:
            parts.append(s)

    def join(bits):
        s = ""
        for b in bits:
            if s and re.search(r"\\[a-zA-Z]+$", s) and re.match(r"[a-zA-Z]", b):
                s += " "
            s += b
        return s

    for kind, tex, role in atoms:
        if kind == "num":
            tex = "\\text{%s}" % tex if wrap[k] else tex
            k += 1
        elif kind == "dot":
            tex = "\\dot{%s}" % tex
        elif kind == "unit":
            tex = "\\text{%s%s}" % (" " if unit_space else "", re.sub(r"([23])$", "", tex)) + \
                ("^{%s}" % tex[-1] if re.search(r"[23]$", tex) else "")
        elif kind == "deg":
            flush()
            buf = []
            parts.append(tex)
            cur_role = "base"
            continue
        if role != cur_role:
            flush()
            buf, cur_role = [], role
        if lr and tex in ("(", ")"):
            tex = "\\left(" if tex == "(" else "\\right)"
        buf.append(tex)
    flush()
    return join(parts)


def gen_pdf_lines(r: Recoverer, scan: dict, max_window: int = 30):
    fonts = scan["fonts"]
    for page in scan["page_spans"]:
        for _, spans in page:
            if not any(fonts[s[0]].startswith(MATH_FONT_PREFIXES) for s in spans):
                continue
            for atoms in line_atoms(spans, fonts):
                n = len(atoms)
                for a in range(n):
                    for b in range(a + 1, min(n, a + max_window) + 1):
                        win = atoms[a:b]
                        k = sum(1 for x in win if x[0] == "num")
                        if k <= 3:
                            wraps = list(itertools.product((False, True), repeat=k))
                        else:
                            wraps = [(False,) * k, (True,) * k]
                        has_paren = any(x[1] in ("(", ")") for x in win)
                        has_script = any(x[2] != "base" for x in win)
                        styles = [(False, False)] + ([(True, False), (False, True), (True, True)] if has_script else [])
                        for w in wraps:
                            for bb, bs in styles:
                                r.offer(render(win, w, False, bb, bs), "pdf_lines")
                                if has_paren:
                                    r.offer(render(win, w, True, bb, bs), "pdf_lines")


def recover(book, work: Path) -> dict:
    eqs = json.loads((work / "equations.json").read_text())["images"]
    scan = json.loads((work / "pdf_scan.json").read_text())
    r = Recoverer(eqs)
    steps = []
    for name, fn in (("symbols", lambda: gen_symbols(r)),
                     ("numbers", lambda: gen_numbers(r, numbers_in(scan))),
                     ("grammar", lambda: gen_grammar(r)),
                     ("pdf_lines", lambda: gen_pdf_lines(r, scan))):
        before, tried = len(r.found), r.tried
        fn()
        steps.append({"source": name, "new": len(r.found) - before, "candidates": r.tried - tried})
    offset = book.page_offsets[0].pdf_minus_printed if book.page_offsets else 0
    streams: dict = {}
    accepted = {}
    for h, x in sorted(r.found.items()):
        assert md5(x["latex"]) == h
        accepted[h] = {"latex": x["latex"], "accepted_by": "hash", "found_by": x["source"],
                       "cross_check": cross_check(x["latex"], eqs[h], scan, offset, streams)}
    return {"accepted": accepted, "steps": steps, "candidates_tried": r.tried}


# ============================================================================ the vision stage
def vision_queue(eqs: dict, accepted: dict) -> list:
    """Images still needing the vision passes: not accepted, and not only in teachers' notes
    (S2 drops those, FR-4408, so nothing downstream reads them)."""
    out = []
    for h, rec in sorted(eqs.items()):
        if h in accepted or rec["class"] == "teacher_only":
            continue
        w, hh = rec["size"] or (0, 0)
        out.append({"md5": h, "w": w, "h": hh, "class": rec["class"], "refs": rec["refs"]})
    # big derivations last, so a batch holds images of like size
    return sorted(out, key=lambda x: (x["h"] > 60, x["h"], x["w"], x["md5"]))


def image_tokens(w: int, h: int, upscale: float) -> int:
    """Claude vision tokens ≈ width × height / 750, after the API's resize (long edge ≤ 1568 px,
    area ≤ ~1.15 MP)."""
    w, h = w * upscale, h * upscale
    s = min(1.0, 1568 / max(w, h, 1), math.sqrt(1_150_000 / max(w * h, 1)))
    return max(1, math.ceil((w * s) * (h * s) / 750))


def estimate(queue: list, accepted: dict, eqs: dict, upscale: float, batch: int, passes: int = 2) -> dict:
    """What the two blind passes would cost, with the spec's prices (meter_run.PRICES, §5)."""
    from meter_run import PRICES, CACHE_READ, CACHE_WRITE_5M
    p = PRICES["claude-sonnet-5"]
    # LaTeX length per pixel, measured on the images the hash already proved
    ch, area = 0, 0
    for h, a in accepted.items():
        w, hh = eqs[h]["size"]
        ch += len(a["latex"])
        area += w * hh
    chars_per_px = ch / area if area else 0.004
    OVERHEAD = 15_000          # spec §5: tokens every agent call carries
    FRAME = 30                 # output tokens per image besides its LaTeX (the md5 and JSON)
    img_tok = sum(image_tokens(x["w"], x["h"], upscale) for x in queue)
    out_tok = sum(FRAME + math.ceil(x["w"] * x["h"] * chars_per_px / 3.0) for x in queue)
    calls = math.ceil(len(queue) / batch) if queue else 0
    per_pass_in = calls * OVERHEAD + img_tok
    # low: every input token read once at full price; high: written to the cache once (1.25×) and read
    # back on two more turns (the md5 probe and the structured answer), 0.1× each
    low_in = per_pass_in * p["input"]
    high_in = per_pass_in * p["input"] * (CACHE_WRITE_5M + 2 * CACHE_READ)
    out_usd = out_tok * p["output"]
    usd = lambda x: round(x * passes / 1_000_000, 2)
    return {
        "model": "claude-sonnet-5", "prices_per_million": p, "passes": passes, "upscale": upscale,
        "images": len(queue), "calls_per_pass": calls, "batch": batch,
        "image_tokens_per_pass": img_tok, "overhead_tokens_per_pass": calls * OVERHEAD,
        "output_tokens_per_pass": out_tok, "latex_chars_per_px_measured": round(chars_per_px, 5),
        "usd_low": usd(low_in + out_usd), "usd_high": usd(high_in + out_usd),
        "note": ("API-equivalent; two blind passes; a reconcile pass is not part of the design (a disagreement "
                 "goes to G0b); the md5 self-probe adds a turn, counted in the high figure"),
    }


def third_reading_queue(eqs: dict, accepted: dict, runs: dict) -> list:
    """Images the THIRD reading (pass C) must read: no hash proved them, they are not teacher-only,
    and passes A and B did not agree on them — they differ, or only one of them read the image.
    An image that no pass has read yet is NOT here (A and B come first), and an image C has
    already read is not asked again. Same order and shape as `vision_queue`."""
    A, B, C = (runs["by_pass"].get(p, {}) for p in ("A", "B", "C"))
    out = []
    for x in vision_queue(eqs, accepted):
        h = x["md5"]
        a, b = A.get(h), B.get(h)
        if h in C or (a is None and b is None):
            continue
        if a is not None and b is not None and normalise(a) == normalise(b):
            continue
        out.append(x)
    return out


def chapter_images(work: Path, chapters: set[int]) -> set[str]:
    """The equation images a chapter's blocks use (equations.json names each image's blocks)."""
    chapter_of = {}
    with open(work / "blocks.jsonl", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                b = json.loads(line)
                chapter_of[b["id"]] = b.get("chapter")
    eqs = json.loads((work / "equations.json").read_text())["images"]
    return {h for h, r in eqs.items() if any(chapter_of.get(bid) in chapters for bid in r.get("blocks") or [])}


def vision_args(book, work: Path, queue: list, pass_, batch: int, limit: int | None,
                batch_dir: Path | None = None) -> dict:
    """The Workflow args for transcribe-maths.workflow.js.

    With `batch_dir`, the image list is written to one small JSON file per batch
    (`<batch_dir>/<pass>-b0001.json` …, each {"images": [{md5, path, w, h}]}) and the args carry
    only `batch_files: [{file, n}]` plus the two book fields the workflow reads. That keeps the
    args a few KB instead of ~120 KB for a chapter, so they can be passed to the Workflow tool
    by hand. Each agent reads its own batch file; `assemble` re-verifies every md5."""
    import book_config
    args = book_config.workflow_args(book)
    eq_dir = work / "equations"
    items = queue[:limit] if limit else queue
    images = [{"md5": x["md5"], "path": str(eq_dir / f"{x['md5']}.png"), "w": x["w"], "h": x["h"]}
              for x in items]
    args.update({
        "pass": pass_,
        "batch": batch,
        "md5check": f"uv run --project {HERE} {HERE / 'assemble_maths.py'} md5check",
    })
    if batch_dir is None:
        args["images"] = images
        return args
    batch_dir.mkdir(parents=True, exist_ok=True)
    tag = "".join(pass_) if isinstance(pass_, list) else str(pass_)
    files = []
    for k, i in enumerate(range(0, len(images), batch), start=1):
        chunk = images[i:i + batch]
        f = (batch_dir / f"{tag}-b{k:04d}.json").resolve()
        f.write_text(json.dumps({"pass": pass_, "batch_no": k, "images": chunk}, ensure_ascii=False, indent=1))
        files.append({"file": str(f), "n": len(chunk)})
    full_book = args.get("book") or {}
    args["book"] = {"book": full_book.get("book", book.book), "maths_source": full_book.get("maths_source")}
    args["batch_files"] = files
    return args


# ============================================================================ assemble
def load_runs(paths: list) -> dict:
    """{pass: {md5: latex}} from saved Workflow results. A run is the return value of
    transcribe-maths.workflow.js: {pass, results: [{md5, latex | null, …}], …}."""
    by_pass = collections.defaultdict(dict)
    meta = []
    for p in paths:
        d = json.loads(Path(p).read_text())
        if "results" not in d or "pass" not in d:
            raise SystemExit(f"{p}: not a transcribe-maths run (no pass / results)")
        for pass_ in (d["pass"] if isinstance(d["pass"], list) else [d["pass"]]):
            if pass_ not in ("A", "B", "C"):
                raise SystemExit(f"{p}: pass must be A, B or C, not {pass_!r}")
        for x in d["results"]:
            ps = x.get("pass") or d["pass"]
            if x.get("latex") is None:
                continue
            prev = by_pass[ps].get(x["md5"])
            if prev is not None and prev != x["latex"]:
                # a pass that read one image twice and disagreed with itself does not count
                by_pass[ps][x["md5"]] = False
            elif prev is None:
                by_pass[ps][x["md5"]] = x["latex"]
        meta.append({"file": str(p), "pass": d["pass"], "run_id": d.get("run_id"), "results": len(d["results"])})
    return {"by_pass": {k: {h: v for h, v in d.items() if v is not False} for k, d in by_pass.items()},
            "self_disagreements": {k: sorted(h for h, v in d.items() if v is False) for k, d in by_pass.items()},
            "runs": meta}


ROUTE_KEYS = ("accepted_by_hash", "accepted_by_agreement", "accepted_by_third_reading", "resolved_at_g0b")


def _counts(routes: collections.Counter) -> dict:
    """The S0b equality's terms for one scope (the book, a chapter or a class).

    `to_transcribe` is every image that needs a transcription: all of them, less the
    teacher-only ones no rule accepted (S2 drops those, FR-4408, so they are never read).
    The equality coverage_report.py checks is  to_transcribe = the four routes + unresolved,
    and it holds by construction; the audit's point is `unresolved` = 0."""
    out = {"accepted_by_hash": routes["hash"], "accepted_by_agreement": routes["agreement"],
           "accepted_by_third_reading": routes["third_reading"], "resolved_at_g0b": routes["human"],
           "unresolved": routes["queued"], "teacher_only_not_transcribed": routes["skipped_teacher_only"]}
    out["to_transcribe"] = sum(out[k] for k in ROUTE_KEYS) + out["unresolved"]
    return out


def assemble(book, work: Path, run_paths: list, human_path: Path | None) -> dict:
    eqs = json.loads((work / "equations.json").read_text())["images"]
    scan = json.loads((work / "pdf_scan.json").read_text())
    offset = book.page_offsets[0].pdf_minus_printed if book.page_offsets else 0
    rec_path = work / "maths" / "recovered.json"
    recovered = json.loads(rec_path.read_text())["accepted"] if rec_path.exists() else {}
    runs = load_runs(run_paths)
    A, B, C = (runs["by_pass"].get(p, {}) for p in ("A", "B", "C"))
    human = json.loads(human_path.read_text()) if human_path and human_path.exists() else {}
    chapter_of_block: dict[str, int] = {}
    if (work / "blocks.jsonl").exists():
        with open(work / "blocks.jsonl", encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    b = json.loads(line)
                    chapter_of_block[b["id"]] = b.get("chapter")
    streams: dict = {}
    accepted, queue = {}, []
    route = collections.Counter()
    xc = collections.Counter()
    by_class: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    by_chapter: dict[int, collections.Counter] = collections.defaultdict(collections.Counter)

    def tally(h: str, rec: dict, key: str) -> None:
        # every image is counted once per scope it belongs to: its class, and each chapter using it
        route[key] += 1
        by_class[rec["class"]][key] += 1
        for ch in sorted({chapter_of_block.get(bid) for bid in rec.get("blocks") or []} - {None}):
            by_chapter[ch][key] += 1

    def enqueue(h: str, rec: dict, reason: str, **readings) -> None:
        queue.append({"md5": h, "reason": reason, **readings, "printed_pages": rec["printed_pages"],
                      "class": rec["class"]})
        route["queued_" + re.sub(r"[^a-z0-9]+", "_", reason.lower()).strip("_")] += 1
        tally(h, rec, "queued")

    for h, rec in sorted(eqs.items()):
        cand_hash = None
        # 1. hash: re-verified here for every source (deterministic, the three passes, human)
        for src, latex in (("recover", recovered.get(h, {}).get("latex")), ("A", A.get(h)), ("B", B.get(h)),
                           ("C", C.get(h)), ("human", (human.get(h) or {}).get("latex"))):
            if latex is not None and md5(latex) == h:
                cand_hash = (src, latex)
                break
        if cand_hash:
            latex = cand_hash[1]
            chk = cross_check(latex, rec, scan, offset, streams)
            accepted[h] = {"latex": latex, "accepted_by": "hash", "found_by": cand_hash[0], "cross_check": chk}
            tally(h, rec, "hash")
            xc[("hash", chk)] += 1
            continue
        # 2. a human at G0b (recorded, with who)
        if h in human:
            hm = human[h]
            if not hm.get("by") or not hm.get("latex"):
                raise SystemExit(f"human resolution for {h} must carry latex and by")
            accepted[h] = {"latex": hm["latex"], "accepted_by": "human", "by": hm["by"], "date": hm.get("date"),
                           "cross_check": cross_check(hm["latex"], rec, scan, offset, streams)}
            tally(h, rec, "human")
            continue
        if rec["class"] == "teacher_only":
            tally(h, rec, "skipped_teacher_only")
            continue
        a, b, c = A.get(h), B.get(h), C.get(h)
        # 3. agreement of two blind passes, then the cross-check
        if a is not None and b is not None and normalise(a) == normalise(b):
            chk = cross_check(a, rec, scan, offset, streams)
            xc[("agreement", chk)] += 1
            if chk == "contradicted":
                enqueue(h, rec, "passes agree but the PDF text layer contradicts them", A=a, B=b)
            else:
                accepted[h] = {"latex": a, "accepted_by": "agreement", "B": b if b != a else None, "cross_check": chk}
                tally(h, rec, "agreement")
            continue
        # 4. A and B did not agree: the third independent reading decides (answer 11). It must
        #    agree with one of them — two of three blind readings — or the image waits for G0b.
        if c is not None and (a is not None or b is not None):
            side = ("A" if a is not None and normalise(c) == normalise(a) else
                    "B" if b is not None and normalise(c) == normalise(b) else None)
            if side:
                chk = cross_check(c, rec, scan, offset, streams)
                xc[("third_reading", chk)] += 1
                if chk == "contradicted":
                    enqueue(h, rec, "the third reading agrees with pass " + side
                            + " but the PDF text layer contradicts them", A=a, B=b, C=c)
                else:
                    accepted[h] = {"latex": c, "accepted_by": "third_reading", "sided_with": side,
                                   "A": a, "B": b, "cross_check": chk}
                    tally(h, rec, "third_reading")
                continue
            enqueue(h, rec, ("the two passes disagree; the third reading agrees with neither"
                             if a is not None and b is not None else
                             "only one pass read it; the third reading does not agree with it"), A=a, B=b, C=c)
            continue
        reason = ("the two passes disagree" if a is not None and b is not None else
                  "only one pass read it" if (a is not None or b is not None) else "no pass read it")
        if c is not None and a is None and b is None:
            reason = "only the third reading read it"
        enqueue(h, rec, reason, A=a, B=b, **({"C": c} if c is not None else {}))
    needed = sum(1 for r in eqs.values() if r["class"] != "teacher_only")
    book_counts = _counts(route)
    summary = {
        "unique": len(eqs),
        **{k: book_counts[k] for k in ROUTE_KEYS},
        "unresolved": len(queue),
        "teacher_only_not_transcribed": book_counts["teacher_only_not_transcribed"],
        "to_transcribe": book_counts["to_transcribe"],
        "needed": needed,
        "complete": len(queue) == 0,
        # waiting for pass C: A and B did not agree and no third reading exists yet
        "awaiting_third_reading": sum(1 for q in queue if q.get("C") is None and q["reason"] in
                                      ("the two passes disagree", "only one pass read it")),
        # every route by name, with the queue split by its reason ("queued" is their total)
        "routes": {k: v for k, v in sorted(route.items()) if k != "queued"},
        "routes_by_class": {cls: _counts(c) for cls, c in sorted(by_class.items())},
        "by_chapter": {str(ch): _counts(c) for ch, c in sorted(by_chapter.items())},
        "cross_check": {f"{k[0]}:{k[1]}": v for k, v in sorted(xc.items())},
        "runs": runs["runs"],
        "self_disagreements": runs["self_disagreements"],
    }
    return {"accepted": accepted, "queue": queue, "summary": summary}


# ============================================================================ CLI
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("recover"); s.add_argument("book"); s.add_argument("--work")
    s = sub.add_parser("estimate"); s.add_argument("book"); s.add_argument("--work")
    s.add_argument("--upscale", type=float, default=None); s.add_argument("--batch", type=int, default=25)
    s.add_argument("--chapter", type=int, action="append", help="only this chapter's images (repeatable)")
    s = sub.add_parser("vision-args"); s.add_argument("book"); s.add_argument("--work")
    s.add_argument("--pass", dest="pass_", choices=["A", "B", "AB", "C"], default="AB",
                   help="C = the third reading, only of the images passes A and B did not agree on (needs --runs)")
    s.add_argument("--runs", nargs="*", default=[], help="with --pass C: the saved A and B (and earlier C) runs")
    s.add_argument("--chapter", type=int, action="append",
                   help="only the images this chapter's blocks use (repeatable); default the whole book")
    s.add_argument("--batch", type=int, default=25); s.add_argument("--limit", type=int)
    s.add_argument("--batch-dir", help="write the image list as one JSON file per batch into this directory, "
                                       "and put only the file paths in the args (keeps the args small)")
    s = sub.add_parser("assemble"); s.add_argument("book"); s.add_argument("runs", nargs="*")
    s.add_argument("--work"); s.add_argument("--human"); s.add_argument("--out-dir")
    sub.add_parser("md5check")
    a = ap.parse_args(argv)

    if a.cmd == "md5check":
        for line in sys.stdin:
            if not line.strip():
                continue
            d = json.loads(line)
            hit = next((c for c in d.get("candidates", []) if md5(c) == d["md5"]), None)
            print(json.dumps({"md5": d["md5"], "match": hit}))
        return 0

    import book_config
    book = book_config.load_book(a.book)
    work = Path(a.work) if a.work else book.work_dir()
    if not (work / "equations.json").exists():
        raise SystemExit(f"{work}/equations.json missing: run `uv run source_adapter.py {book.book}` first")
    eqs = json.loads((work / "equations.json").read_text())["images"]

    if a.cmd == "recover":
        res = recover(book, work)
        acc = res["accepted"]
        q = vision_queue(eqs, acc)
        classes = collections.Counter(r["class"] for r in eqs.values())
        acc_by_class = collections.Counter(eqs[h]["class"] for h in acc)
        xc = collections.Counter(x["cross_check"] for x in acc.values())
        refs = sum(eqs[h]["refs"] for h in acc)
        out = {
            "book": book.book, "unique": len(eqs), "references": sum(r["refs"] for r in eqs.values()),
            "by_class": dict(classes),
            "accepted_by_hash": len(acc), "accepted_references": refs,
            "accepted_by_class": dict(acc_by_class),
            "by_source": dict(collections.Counter(x["found_by"] for x in acc.values())),
            "steps": res["steps"], "candidates_tried": res["candidates_tried"],
            "cross_check_of_hash_acceptances": dict(xc),
            "vision_queue": len(q),
            "vision_queue_by_class": dict(collections.Counter(x["class"] for x in q)),
            "teacher_only_skipped": sum(1 for h, r in eqs.items() if r["class"] == "teacher_only" and h not in acc),
        }
        (work / "maths").mkdir(parents=True, exist_ok=True)
        (work / "maths" / "recovered.json").write_text(json.dumps({"summary": out, "accepted": acc}, indent=1,
                                                                   ensure_ascii=False))
        (work / "maths" / "vision-queue.json").write_text(json.dumps(q, indent=0))
        print(json.dumps(out, indent=1))
        return 0

    rec_path = work / "maths" / "recovered.json"
    acc = json.loads(rec_path.read_text())["accepted"] if rec_path.exists() else {}
    only = chapter_images(work, set(a.chapter)) if getattr(a, "chapter", None) else None
    if a.cmd == "estimate":
        q = [x for x in vision_queue(eqs, acc) if only is None or x["md5"] in only]
        ups = [a.upscale] if a.upscale else [1.0, 2.0]
        print(json.dumps([estimate(q, acc, eqs, u, a.batch) for u in ups], indent=1))
        return 0
    if a.cmd == "vision-args":
        if a.pass_ == "C":
            if not a.runs:
                raise SystemExit("--pass C needs --runs: the third reading is only of the images passes A and B "
                                 "did not agree on, so it reads their saved runs")
            q = third_reading_queue(eqs, acc, load_runs(a.runs))
            passes = ["C"]
        else:
            q = vision_queue(eqs, acc)
            passes = ["A", "B"] if a.pass_ == "AB" else [a.pass_]
        if only is not None:
            q = [x for x in q if x["md5"] in only]
        if not q:
            print(f"no image needs pass {'+'.join(passes)}"
                  + (f" in chapter(s) {sorted(a.chapter)}" if a.chapter else ""), file=sys.stderr)
            return 3
        print(json.dumps(vision_args(book, work, q, passes, a.batch, a.limit,
                                     Path(a.batch_dir) if a.batch_dir else None), ensure_ascii=False))
        print(f"{min(len(q), a.limit or len(q))} images for pass {'+'.join(passes)}; save the run's return value as "
              f"runs/{book.book}/maths/<pass>-<runId>.json, then "
              f"`uv run meter_run.py record --book {book.book} --stage S0b --run <wf_id>`", file=sys.stderr)
        return 0
    if a.cmd == "assemble":
        res = assemble(book, work, a.runs, Path(a.human) if a.human else None)
        out_dir = Path(a.out_dir) if a.out_dir else HERE / "runs" / book.book / "maths"
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "accepted.json").write_text(json.dumps(res["accepted"], indent=1, ensure_ascii=False, sort_keys=True))
        (out_dir / "queue.json").write_text(json.dumps(res["queue"], indent=1, ensure_ascii=False))
        (out_dir / "summary.json").write_text(json.dumps(res["summary"], indent=1))
        print(json.dumps(res["summary"], indent=1))
        return 0 if res["summary"]["complete"] else 4
    return 2


if __name__ == "__main__":
    sys.exit(main())

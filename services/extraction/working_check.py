"""The step-level working checker (Samuel's answer 30, 2026-09-27; integration backlog 78).

    uv run working_check.py precheck --seed <chapter bundle.json> [--out flags.json]        # free, no model
    uv run working_check.py args     --book g10-math --seed <chapter bundle.json> --chapter N \\
                                     --by-ref DIR --out A.json [--lesson-runs runs/<book>/lesson] [--max-per-run 300]
                                     [--batch 8] [--effort medium] [--model sonnet] [--only FILE] [--embed COPY]
    uv run working_check.py collect  --args A.json [--args A.part2.json] --runs R.json [R2.json …] \\
                                     --out runs/<book>/working-check/chNN.flags.json
    uv run working_check.py calibrate --truth runs/<book>/working-check/chNN.calibration.json --flags <flags.json>

WHY. The three-way check of S3 compares FINAL answers only (printed answer, EPUB solution, blind
re-solve), so a typo INSIDE the book's working passes whenever the final answer is right — and the
grounded tutor teaches that working. The Chapter 8 pilot found two only because an S5 author noticed
them (Ex8-6:32d "Substitute A(−2; 2)" for A(−1; 7); Ex8-6:45a "9 − 5" for 9 − 4). Samuel's answer 30:
"Yes, add it" — one checking agent per book solution plus a free numeric pre-check; flagged steps go to
review (since answer 37c, the console backlog), NEVER silently corrected; ≈ $0.03–0.05 per solution;
re-run on Chapter 8 too.

WHAT IS CHECKED. Every canonical solution a student can be taught from in an assembled chapter
bundle (seed/<book>/<prefix>-cNN.json): each book question's `solution` and each worked-example
library entry's steps (`explanation_entries`). These are the texts as SERVED (after G2's approved
corrections, the assembly's LaTeX re-spacing and notation), so a flag points at what a student reads.
A solution with no working to check (its only step a drawing, "[figure]") is listed as `skipped`.

THE FREE PRE-CHECK (`precheck`, deterministic). In every maths segment ($…$, aligned blocks line by
line, a line that starts with "=" continuing the chain above it), each pair of neighbouring sides of a
relation chain that are BOTH purely numeric (digits, + − × ÷, \\frac, \\sqrt, powers, brackets, \\pi,
sin/cos/tan of a degree value) is evaluated: "=" must hold, "≈" must hold to the places shown, < > ≠
must hold. The book rounds on purpose with "=" ("\\sqrt{90} = 9.5"): a right side with d decimals that
is the left side rounded to d places is not a flag. A side with a letter, a unit, a pair or anything
the evaluator does not know is skipped, never guessed. It catches "9 − 5 = 5" and a zero denominator
(the §8.3 misprint m = (3−7)/(3−3)); it cannot catch a wrong value substituted from the question —
that is the agent's job. One more free rule (sw-v2, `precheck_stub`): a book question whose working holds
no maths at all and never states a digit of its numeric key is a stub ("First draw a sketch: [figure]"
for a length the key gives as √34): a final_answer flag, source "stub".

THE AGENT (runbook/working-check.workflow.js, prompts sw-v2). One Sonnet agent per BATCH of up to 8 solutions
reads each one's question, its options (multiple choice), the key and the numbered working (one shard each,
packet by reference) and judges each step against the question and the steps before it: a substituted value that
is not the question's, a line whose arithmetic does not equal the next, a sign or bracket lost, a label that
changes (T for Q), a last step that does not state the key. It never re-solves the problem its own way and
never writes a correction; it reports the step, an exact quote, the kind, whether the fault sits in a step or in
the question text, and why. It is blind to the pre-check (two independent signals).

WHY BATCHES (the Chapter 8 calibration, 2026-10-01). sw-v1 ran one agent per solution and metered $31.0 for 192
solutions ($0.161 each; the plan said $0.03-0.05). The harness gives every agent ~30K tokens of cache writes
and ~95K of cache reads before it has read one shard ($0.094: 65% of an agent that opened no figure) and the
agent's thinking added $0.034 on average; opening figures added ~$0.06 to the 66 agents that did. No prompt
can lower the fixed part of one-agent-per-solution below $0.09, so sw-v2 shares it: 8 solutions per agent
(~$0.012 each), a capped figure policy (a figure is offered only when the question text does not give its
points, and a batch opens at most 3 images, all in one turn), reasoning effort `medium`, and notes only on
flags. Measured sw-v1 precision on the same chapter: 23 of 25 flags were real book defects; the two false ones
came from the shard (it omitted the multiple-choice options), which sw-v2 now prints.

WHAT COMES OUT (`collect`): runs/<book>/working-check/chNN.flags.json, format
"ainext.working-check/1": every flagged step with its sources (agent, numeric, stub), the agents'
verdicts, what could not be checked (`unclear`, an agent that returned nothing → `unchecked`) and what
was `skipped`. Each flag is a backlog item ("working step flagged — needs a human"), never applied to
the content: the content stays exactly as the book (and G2) has it until a human decides.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

PROMPTS_VERSION = "sw-v2"
FORMAT = "ainext.working-check/1"
MAX_PER_RUN = 300                       # keeps a part's compact args well under packet_ref.COMPACT_LIMIT
FLAG_KINDS = ("wrong_value", "arithmetic", "sign", "label", "copy", "final_answer", "other")
FLAG_WHERE = ("working", "question", "unsure")      # where the fault sits (sw-v2): a step, or the question text
BATCH = 8                               # solutions per checking agent: shares the ~$0.09 fixed cost of an agent
FIG_CAP = 3                             # figure images one agent may open, all in one turn
EFFORT = "medium"                       # the agents' reasoning effort ("low" once a calibration run allows it)
MODEL = "sonnet"
EFFORTS = ("low", "medium", "high")
MODELS = ("sonnet", "haiku")
# What one checking agent cost (API-equivalent USD per solution), for the fan-out plan. sw-v1 measured: 31.0 / 192.
# sw-v2 is MODELLED from sw-v1's measured token mix (fixed 30K cache-write + 95K cache-read per agent shared by a
# batch; thinking 1.2-3.4K tokens per solution at medium..default effort; at most 3 images per batch) and stays
# unvalidated until the calibration subset run (ch08.calibration.json, 51 solutions) is metered.
MEASURED_SW_V1_PER_SOLUTION = 0.161


# ============================================================================ the solutions
def _step_texts(q: dict) -> list[str]:
    sol = q.get("solution") or q.get("canonical_solution") or []
    out = []
    for s in sol:
        out.append(s.get("text_md", "") if isinstance(s, dict) else str(s))
    return out


def _options(choices) -> list[tuple[str, str]]:
    """[(key, text)] of a multiple-choice question: `choices` is a list of {key, text}, or a dict whose
    `options` is that list (the dict also carries `less_specific`, a grading hint the checker does not need).
    Any other shape (a short-answer `marker`, null) has no options."""
    if isinstance(choices, dict):
        choices = choices.get("options")
    if not isinstance(choices, list):
        return []
    return [(str(c["key"]), str(c.get("text") or "")) for c in choices if isinstance(c, dict) and c.get("key") is not None]


def solutions_from_bundle(bundle: dict, figures: dict[str, list[str]] | None = None) -> list[dict]:
    """Every canonical solution in an assembled chapter bundle, in bundle order: book questions, then
    worked-example library entries. `figures`: question id (and expl: id) -> the stem's image files."""
    figures = figures or {}
    out = []
    for q in bundle.get("questions") or []:
        out.append({"id": q["id"], "lo": q.get("lo") or q.get("lo_id"), "kind": "question",
                    "stem": q.get("stem") or "", "key": q.get("answer") or q.get("correct_answer"),
                    "options": _options(q.get("choices")), "type": q.get("type"),
                    "steps": _step_texts(q), "page": q.get("source_page"),
                    "figures": list(figures.get(q["id"]) or [])})
    for e in bundle.get("explanation_entries") or []:
        content = e.get("content") or []
        stem = " ".join(c.get("text_md", "") for c in content if c.get("kind") == "problem")
        steps = [c.get("text_md", "") for c in content if c.get("kind") != "problem"]
        out.append({"id": e["id"], "lo": e.get("lo"), "kind": "worked_example", "stem": stem, "key": None,
                    "options": [], "type": None,
                    "steps": steps, "page": e.get("source_page"), "figures": list(figures.get(e["id"]) or [])})
    return out


_FIG = re.compile(r"\[figure\]")


def has_working(sol: dict) -> bool:
    """Something to check: at least one step with text besides a drawing."""
    return any(_FIG.sub("", s).strip(" .:\n") for s in sol["steps"])


_PLAIN = [(re.compile(r"\\(?:left|right)\s*"), ""), (re.compile(r"\\(?:text|mathrm)\{([^{}]*)\}"), r"\1"),
          (re.compile(r"\\[,;! ]"), " "), (re.compile(r"\u2212"), "-")]
_PAIR = re.compile(r"\(\s*-?\s*\d+(?:[.,]\d+)?\s*[,;]\s*-?\s*[\w.]+\s*\)")


def points_in(stem: str) -> int:
    """How many distinct coordinate pairs (-2, 4), (7; y), … the question text itself gives."""
    t = stem
    for rx, to in _PLAIN:
        t = rx.sub(to, t)
    return len({re.sub(r"\s+", "", m) for m in _PAIR.findall(t)})


def figures_offered(sol: dict) -> list[str]:
    """The figure images the agent may open for this solution. A question that already gives two or more
    points in its text needs no figure to check the working's substitutions: in the Chapter 8 calibration 66 of
    192 sw-v1 agents opened one (~$0.06 each) and, of the 18 real flags, only Ex8-4:19b (its points are shown
    only in the picture) needed it. A figure-only question (points, lengths or shapes shown only in the
    picture) offers its figure."""
    figs = list(sol.get("figures") or [])
    return [] if points_in(sol["stem"]) >= 2 else figs


def key_line(sol: dict) -> str:
    """The key as the student is marked against it; a letter key also says which option it stands for."""
    key = str(sol["key"])
    text = dict(sol.get("options") or []).get(key)
    return f"{key} ({text})" if text else key


def render_shard(sol: dict) -> str:
    """What the checking agent reads for one solution (its shard)."""
    lines = [f"SOLUTION {sol['id']} ({'book question' if sol['kind'] == 'question' else 'worked example'}"
             + (f", printed page {sol['page']}" if sol.get("page") is not None else "") + ")",
             "", "QUESTION:", sol["stem"] or "(none)", ""]
    if sol.get("options"):
        lines += ["OPTIONS (the student picks one; the key below is one of these letters):"]
        lines += [f"  {k}. {t}" for k, t in sol["options"]]
        lines.append("")
    if sol.get("key") is not None:
        lines += ["FINAL ANSWER (the key the student is marked against):", key_line(sol), ""]
    lines.append("WORKING (numbered steps, as the student is taught them):")
    for i, s in enumerate(sol["steps"], start=1):
        lines.append(f"step {i}: {s}")
    figs = figures_offered(sol)
    if figs:
        lines += ["", "FIGURE (the question shows it; open it ONLY if a value the working uses is in no text above):"]
        lines += [f"  {f}" for f in figs]
    elif sol.get("figures"):
        lines += ["", "FIGURE: not offered (the question text already gives its points)."]
    return "\n".join(lines) + "\n"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


# ============================================================================ the free numeric pre-check
class NotNumeric(Exception):
    """A side the evaluator does not know (a letter, a unit, a pair): skipped, never guessed."""


class Undefined(Exception):
    """A side whose value does not exist (a zero denominator, a root of a negative)."""


_RELS = [(r"\approx", "≈"), (r"\neq", "≠"), (r"\ne", "≠"), (r"\leq", "≤"), (r"\geq", "≥"), (r"\le", "≤"),
         (r"\ge", "≥"), ("=", "="), ("<", "<"), (">", ">")]
_SEPARATORS = (r"\qquad", r"\quad", r"\text{ and }", r"\text{and}", r"\text{ or }", r"\therefore", r"\Rightarrow",
               r"\rightarrow", r"\implies", r"\iff", r"\Leftrightarrow", r"\because")


def _top_split(s: str, seps: tuple[str, ...]) -> list[str]:
    """Split at separators that sit at bracket depth 0 (a command name is matched whole)."""
    parts, depth, cur, i = [], 0, [], 0
    while i < len(s):
        ch = s[i]
        if ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth -= 1
        if depth == 0:
            hit = next((x for x in seps if s.startswith(x, i)
                        and not (x[0] == "\\" and i + len(x) < len(s) and s[i + len(x)].isalpha())), None)
            if hit:
                parts.append("".join(cur))
                cur = []
                i += len(hit)
                continue
        cur.append(ch)
        i += 1
    parts.append("".join(cur))
    return parts


def _chain(line: str) -> list[tuple[str | None, str]]:
    """[(relation before this side or None, side text)] at depth 0."""
    out: list[tuple[str | None, str]] = []
    depth, cur, rel, i = 0, [], None, 0
    while i < len(line):
        ch = line[i]
        if ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth -= 1
        if depth == 0:
            hit = next(((t, sym) for t, sym in _RELS if line.startswith(t, i)
                        and not (t[0] == "\\" and i + len(t) < len(line) and line[i + len(t)].isalpha())), None)
            if hit:
                out.append((rel, "".join(cur)))
                cur, rel = [], hit[1]
                i += len(hit[0])
                continue
        cur.append(ch)
        i += 1
    out.append((rel, "".join(cur)))
    return out


class _Eval:
    """A small recursive-descent evaluator for numeric LaTeX. Anything else raises NotNumeric."""
    _TOKEN = re.compile(r"\s*(\\[A-Za-z]+|\\[,;!: ]|\d+(?:\.\d+)?|\.\d+|[-+*/^(){}\[\]!%|]|\S)")

    def __init__(self, s: str):
        s = re.sub(r"\\(?:left|right|big|Big|bigg|Bigg)\s*(?=[()\[\]|.])", "", s)
        s = re.sub(r"\\(?:left|right)\\?[{}]", "", s)
        s = s.replace(r"\left.", "").replace(r"\right.", "")
        s = re.sub(r"\\(?:text|mathrm|textrm|mathbf)\{\s*([0-9][0-9 .]*)\s*\}",
                   lambda m: m.group(1).replace(" ", ""), s)       # \text{12 566} -> 12566 (Siyavula style)
        s = re.sub(r"(?<=\d)\s+(?=\d{3}(?!\d))", "", s)             # thousands written with a space
        s = s.replace("{,}", "")
        # a mixed number (4\frac{1}{3}) is a sum, not a product
        s = re.sub(r"(?<![\w^_}.])(\d+)\s*\\[dt]?frac\{(\d+)\}\{(\d+)\}", r"(\1+\\frac{\2}{\3})", s)
        self.toks = [t for t in self._TOKEN.findall(s) if t.strip() and t not in ("\\,", "\\;", "\\!", "\\:", "\\ ")]
        self.i = 0

    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else None

    def take(self, want=None):
        t = self.peek()
        if t is None or (want is not None and t != want):
            raise NotNumeric(f"expected {want!r}, got {t!r}")
        self.i += 1
        return t

    def value(self) -> float:
        if not self.toks:
            raise NotNumeric("empty")
        v = self.expr()
        if self.peek() is not None:
            raise NotNumeric(f"left over {self.peek()!r}")
        return v

    def expr(self) -> float:
        v = self.term()
        while self.peek() in ("+", "-"):
            op = self.take()
            w = self.term()
            v = v + w if op == "+" else v - w
        return v

    _MUL = {"*": "*", "\\times": "*", "\\cdot": "*", "/": "/", "\\div": "/"}

    def term(self) -> float:
        v = self.unary()
        while True:
            t = self.peek()
            if t in self._MUL:
                self.take()
                w = self.unary()
                if self._MUL[t] == "*":
                    v *= w
                else:
                    if w == 0:
                        raise Undefined("division by zero")
                    v /= w
            elif t is not None and (t in ("(", "\\frac", "\\dfrac", "\\tfrac", "\\sqrt", "\\pi", "\\sin", "\\cos", "\\tan")):
                v *= self.unary()                                    # implicit multiplication: 3\sqrt{2}, 2(3+4)
            else:
                return v

    def unary(self) -> float:
        t = self.peek()
        if t in ("-", "+"):
            self.take()
            v = self.unary()
            return -v if t == "-" else v
        return self.power()

    def power(self) -> float:
        base = self.postfix(self.atom())
        if self.peek() == "^":
            self.take()
            if self.peek() == "{":
                self.take("{")
                if self.peek() == "\\circ":
                    raise NotNumeric("degrees outside a trig function")
                e = self.expr()
                self.take("}")
            else:
                e = self.atom()
            if abs(e) > 64:
                raise NotNumeric("huge power")
            try:
                if base < 0 and not float(e).is_integer():
                    raise Undefined("a fractional power of a negative number")
                if base == 0 and e < 0:
                    raise Undefined("zero to a negative power")
                return self.postfix(base ** e)
            except OverflowError as exc:
                raise NotNumeric("overflow") from exc
        return base

    def postfix(self, v: float) -> float:
        if self.peek() == "\\%":
            self.take()
            return v / 100
        return v

    def group(self) -> float:
        self.take("{")
        v = self.expr()
        self.take("}")
        return v

    def atom(self) -> float:
        t = self.peek()
        if t is None:
            raise NotNumeric("missing operand")
        if re.fullmatch(r"\d+(?:\.\d+)?|\.\d+", t):
            self.take()
            if self.peek() is not None and re.fullmatch(r"\d+(?:\.\d+)?", self.peek()):
                raise NotNumeric("two numbers side by side")
            return float(t)
        if t in ("(", "[", "{"):
            close = {"(": ")", "[": "]", "{": "}"}[t]
            self.take()
            v = self.expr()
            self.take(close)
            return v
        if t in ("\\frac", "\\dfrac", "\\tfrac"):
            self.take()
            n = self.group()
            d = self.group()
            if d == 0:
                raise Undefined("division by zero")
            return n / d
        if t == "\\sqrt":
            self.take()
            idx = 2.0
            if self.peek() == "[":
                self.take("[")
                idx = self.expr()
                self.take("]")
            v = self.group() if self.peek() == "{" else self.atom()
            if v < 0 and float(idx) % 2 == 0:
                raise Undefined("an even root of a negative number")
            return math.copysign(abs(v) ** (1 / idx), v)
        if t == "\\pi":
            self.take()
            return math.pi
        if t in ("\\sin", "\\cos", "\\tan"):
            self.take()
            arg = self.group() if self.peek() == "{" else self.atom_number()
            if not (self.peek() == "^" and self.toks[self.i + 1:self.i + 4] == ["{", "\\circ", "}"]):
                raise NotNumeric("a trig value is read only in degrees")
            self.i += 4
            r = math.radians(arg)
            if t == "\\tan" and abs(math.cos(r)) < 1e-12:
                raise Undefined("tan of 90°")
            return {"\\sin": math.sin, "\\cos": math.cos, "\\tan": math.tan}[t](r)
        raise NotNumeric(f"not a number: {t!r}")

    def atom_number(self) -> float:
        t = self.take()
        if not re.fullmatch(r"\d+(?:\.\d+)?", t):
            raise NotNumeric("trig argument")
        return float(t)


def evaluate(side: str) -> float:
    s = side.strip().rstrip(".").strip()
    if not s or re.search(r"[A-Za-z]", re.sub(r"\\[A-Za-z]+", "", s)):
        raise NotNumeric("has a letter")
    return _Eval(s).value()


def _decimals(side: str) -> int | None:
    """The places a plain decimal side shows (9.5 -> 1), else None."""
    s = re.sub(r"\\text\{([^}]*)\}", r"\1", side).strip().rstrip(".")
    m = re.fullmatch(r"-?\s*\d+\.(\d+)", s.replace(" ", ""))
    return len(m.group(1)) if m else None


_LITERAL = re.compile(r"\s*-?\s*(?:\\text\{)?\s*-?\d+(?:\.\d+)?\s*\}?\s*")


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))


def _rounds_to(a: float, b: float, places: int | None) -> bool:
    return places is not None and abs(a - b) <= 0.5 * 10 ** (-places) + 1e-9 * max(1.0, abs(a))


def maths_lines(step: str) -> list[str]:
    """The relation chains of one step: each $…$ segment; an aligned block line by line, a line that
    starts with a relation continuing the chain above it."""
    out: list[str] = []
    for seg in re.findall(r"\$([^$]+)\$", step):
        m = re.search(r"\\begin\{(aligned|align\*?|array)\}(?:\{[^}]*\})?(.*?)\\end\{\1\}", seg, re.S)
        if not m:
            out.append(seg)
            continue
        chain = ""
        for raw in re.split(r"\\\\", m.group(2)):
            line = raw.replace("&", "").strip()
            if not line:
                continue
            if chain and any(line.startswith(t) for t, _ in _RELS):
                chain += line
            else:
                if chain:
                    out.append(chain)
                chain = line
        if chain:
            out.append(chain)
    return out


def check_line(line: str) -> list[dict]:
    """Flags for one relation chain (empty: nothing wrong the evaluator can see)."""
    flags = []
    for part in _top_split(line, _SEPARATORS + (",", ";")):
        sides = _chain(part)
        vals: list[tuple[float | None, str | None]] = []
        for _, text in sides:
            try:
                vals.append((evaluate(text), None))
            except Undefined as e:
                vals.append((None, str(e)))
            except (NotNumeric, ValueError, ZeroDivisionError, IndexError):
                vals.append((None, None))
        for k in range(1, len(sides)):
            rel = sides[k][0]
            (a, ua), (b, ub) = vals[k - 1], vals[k]
            lt, rt = sides[k - 1][1].strip(), sides[k][1].strip()
            if ua or ub:
                # an undefined side set equal to a NUMBER is a flag (the §8.3 misprint: (3−7)/(3−3) = −4/−6);
                # set equal to another undefined side, or to words ("= undefined"), it is the book's point
                if (ua and b is not None) or (ub and a is not None):
                    flags.append({"kind": "arithmetic", "relation": rel, "left": lt, "right": rt,
                                  "why": f"{'the left' if ua else 'the right'} side is undefined ({ua or ub})"})
                continue
            if a is None or b is None:
                continue
            if rel == "=" and _LITERAL.fullmatch(lt) and _LITERAL.fullmatch(rt) and not _close(a, b):
                continue        # "0 = 10": a contradiction the working states on purpose, not arithmetic
            ok = True
            if rel == "=":
                ok = _close(a, b) or _rounds_to(a, b, _decimals(rt)) or _rounds_to(b, a, _decimals(lt))
            elif rel == "≈":
                ok = _close(a, b) or _rounds_to(a, b, _decimals(rt)) or _rounds_to(b, a, _decimals(lt)) \
                    or abs(a - b) <= 0.005 * max(abs(a), abs(b))
            elif rel == "≠":
                ok = not _close(a, b)
            elif rel == "<":
                ok = a < b
            elif rel == ">":
                ok = a > b
            elif rel == "≤":
                ok = a <= b or _close(a, b)
            elif rel == "≥":
                ok = a >= b or _close(a, b)
            if not ok:
                flags.append({"kind": "arithmetic", "relation": rel, "left": lt, "right": rt,
                              "left_value": round(a, 10), "right_value": round(b, 10),
                              "why": f"{lt} {rel} {rt} does not hold ({a:.6g} vs {b:.6g})"})
    return flags


def stub_flag(sol: dict) -> dict | None:
    """A book question whose working has no maths segment at all and never states a digit of its numeric
    key: the book's own solution stops at a sketch (Ex8-6:24a: "First draw a sketch: [figure]", key √34).
    A letter or word key (multiple choice, "parallel") is not judged: it can be reasoned in words."""
    key = sol.get("key")
    if key is None or sol.get("kind") != "question" or not sol["steps"]:
        return None
    digits = re.findall(r"\d+", str(key))
    if not digits or any("$" in st for st in sol["steps"]):
        return None
    text = " ".join(sol["steps"])
    if any(d in text for d in digits):
        return None
    n = len(sol["steps"])
    return {"solution_id": sol["id"], "lo": sol.get("lo"), "step": n, "kind": "final_answer", "source": "stub",
            "quote": _FIG.sub("", sol["steps"][-1]).strip()[:200],
            "why": "the working shows no calculation and never states the key (the solution stops short of the answer)"}


def precheck_solution(sol: dict) -> list[dict]:
    out = []
    for n, step in enumerate(sol["steps"], start=1):
        for line in maths_lines(step):
            for f in check_line(line):
                out.append({"solution_id": sol["id"], "lo": sol.get("lo"), "step": n,
                            "quote": f"{f['left']} {f['relation']} {f['right']}"[:200], **f})
    stub = stub_flag(sol)
    return out + ([stub] if stub else [])


# ============================================================================ the workflow's args
def precheck_path(shard_dir: Path) -> Path:
    """Where a part's pre-check result and solution index live: beside its shard directory, never in it."""
    d = Path(shard_dir)
    return d.with_name(d.name + ".precheck.json")


def figures_for(lesson_runs_dir: Path | None) -> dict[str, list[str]]:
    if not lesson_runs_dir or not Path(lesson_runs_dir).exists():
        return {}
    import assemble_misconceptions as am
    return am.figures_by_question([json.loads(p.read_text()) for p in sorted(Path(lesson_runs_dir).glob("*.json"))])


def build_args(book, bundle: dict, chapter: int, directory: Path, figures: dict | None = None,
               max_per_run: int = MAX_PER_RUN) -> list[dict]:
    """The compact args of runbook/working-check.workflow.js, one per part (≤ max_per_run solutions),
    and the shard directories they name. Every solution with working gets one shard; the pre-check's
    result goes BESIDE the shard directory (<dir>.precheck.json, outside it, so no agent is ever pointed at
    it) for the collector — never into an agent's prompt: the agent is blind to it."""
    import packet_ref
    sols = solutions_from_bundle(bundle, figures)
    todo = [s for s in sols if has_working(s)]
    skipped = [{"id": s["id"], "why": "no working to check (the solution is a drawing)"} for s in sols if not has_working(s)]
    parts = [todo[i:i + max_per_run] for i in range(0, len(todo), max_per_run)] or [[]]
    out = []
    for k, chunk in enumerate(parts, start=1):
        d = Path(directory) if len(parts) == 1 else Path(directory) / f"part{k}"
        shards = packet_ref.Shards(d, "SW")
        for i, s in enumerate(chunk, start=1):
            shards.put(f"s/{i:04d}.txt", render_shard(s))
        ref = shards.finish({"book": book.book, "chapter": chapter, "part": k, "of": len(parts)})
        pre = [f for s in chunk for f in precheck_solution(s)]
        precheck_path(d).write_text(json.dumps({
            "format": "ainext.working-precheck/1", "book": book.book, "chapter": chapter,
            "solutions": [{"id": s["id"], "lo": s.get("lo"), "kind": s["kind"], "steps": len(s["steps"]),
                           "shard": f"s/{i:04d}.txt", "sha256": sha(render_shard(s))}
                          for i, s in enumerate(chunk, start=1)],
            "skipped": skipped if k == 1 else [], "flags": pre}, ensure_ascii=False, indent=1) + "\n")
        out.append({"book": {"book": book.book}, "stage": "SW", "prompts_version": PROMPTS_VERSION,
                    "chapter": chapter, "part": k, "parts": len(parts),
                    "solutions": [s["id"] for s in chunk], "by_ref": ref})
    return out


# ============================================================================ collect
def collect(args_list: list[dict], runs: list[dict]) -> dict:
    """Merge the agents' verdicts and the pre-check into one flags file. Nothing is corrected."""
    by_id: dict[str, dict] = {}
    pre: list[dict] = []
    skipped: list[dict] = []
    for a in args_list:
        meta = json.loads(precheck_path(Path(a["by_ref"]["dir"])).read_text())
        for s in meta["solutions"]:
            by_id[s["id"]] = s
        pre += meta["flags"]
        skipped += meta["skipped"]
    answered: dict[str, dict] = {}
    problems: list[str] = []
    for r in runs:
        r = r.get("result", r)
        if r.get("stage") != "SW":
            raise SystemExit("not a working-check run (stage is not SW)")
        for x in r.get("results") or []:
            sid = x.get("solution_id")
            if sid not in by_id:
                problems.append(f"a result names {sid!r}, which is not a solution of these args")
                continue
            answered[sid] = x
    flags: list[dict] = []
    verdicts = {"consistent": 0, "flagged": 0, "unclear": 0}
    unclear, unchecked = [], []
    for sid, meta in by_id.items():
        x = answered.get(sid)
        if not x or not x.get("verdict"):
            unchecked.append({"id": sid, "why": "the checking agent returned nothing: re-run it"})
            continue
        verdicts[x["verdict"]] = verdicts.get(x["verdict"], 0) + 1
        if x["verdict"] == "unclear":
            unclear.append({"id": sid, "why": x.get("note") or ""})
        for f in x.get("flags") or []:
            step = f.get("step")
            if not isinstance(step, int) or not 1 <= step <= meta["steps"]:
                problems.append(f"{sid}: a flag names step {step!r}, which the solution does not have (1–{meta['steps']})")
                continue
            flags.append({"solution_id": sid, "lo": meta.get("lo"), "step": step, "kind": f.get("kind") or "other",
                          "quote": f.get("quote") or "", "expected": f.get("expected") or "",
                          "why": f.get("why") or "", "sources": ["agent"]})
    for p in pre:                                           # the numeric pre-check: merged by step
        same = next((f for f in flags if f["solution_id"] == p["solution_id"] and f["step"] == p["step"]), None)
        if same:
            same["sources"].append("numeric")
            same["numeric"] = {k: p[k] for k in ("left", "relation", "right", "why") if k in p}
        else:
            flags.append({"solution_id": p["solution_id"], "lo": p.get("lo"), "step": p["step"], "kind": "arithmetic",
                          "quote": p["quote"], "expected": "", "why": p["why"], "sources": ["numeric"],
                          "numeric": {k: p[k] for k in ("left", "relation", "right", "why") if k in p}})
    flags.sort(key=lambda f: (f["solution_id"], f["step"]))
    a0 = args_list[0]
    return {
        "format": FORMAT, "book": a0["book"]["book"], "chapter": a0["chapter"], "prompts_version": PROMPTS_VERSION,
        "rule": "Each flag is a backlog item for a human (answer 30; answer 37c). Nothing here was corrected: the "
                "content stays as the book and G2 have it until a human decides.",
        "solutions": len(by_id), "skipped": skipped, "verdicts": verdicts,
        "flags": flags, "flagged_solutions": len({f["solution_id"] for f in flags}),
        "unclear": unclear, "unchecked": unchecked, "problems": problems,
        "runs": [r.get("result", r).get("run_id") or r.get("result", r).get("embedded", {}).get("generated_sha256")
                 for r in runs],
    }


# ============================================================================ CLI
def _book(name: str):
    import book_config
    return book_config.load_book(name)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("precheck", help="the free numeric pre-check only (no model)")
    p.add_argument("--seed", type=Path, required=True, action="append", help="an assembled chapter bundle (repeatable)")
    p.add_argument("--out", type=Path)
    p = sub.add_parser("args", help="the workflow's compact args (by reference) for one chapter bundle")
    p.add_argument("--book", required=True)
    p.add_argument("--seed", type=Path, required=True, help="the assembled chapter bundle")
    p.add_argument("--chapter", type=int, required=True)
    p.add_argument("--by-ref", type=Path, required=True, metavar="DIR", help="the shard directory (rebuilt)")
    p.add_argument("--out", type=Path, required=True, help="the args file (a second part gets .part2 …)")
    p.add_argument("--lesson-runs", type=Path, help="runs/<book>/lesson/ (the stems' figure images); default that")
    p.add_argument("--max-per-run", type=int, default=MAX_PER_RUN)
    p.add_argument("--embed", type=Path, metavar="FILE",
                   help="also write a generated copy of runbook/working-check.workflow.js with the args embedded "
                        "(a second part gets .part2 …)")
    p = sub.add_parser("collect", help="merge the runs and the pre-check into the flags file")
    p.add_argument("--args", type=Path, action="append", required=True)
    p.add_argument("--runs", type=Path, nargs="+", required=True)
    p.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)

    if a.cmd == "precheck":
        flags, n = [], 0
        for f in a.seed:
            for s in solutions_from_bundle(json.loads(f.read_text())):
                n += 1
                flags += precheck_solution(s)
        rep = {"format": "ainext.working-precheck/1", "solutions": n, "flags": flags}
        text = json.dumps(rep, ensure_ascii=False, indent=1) + "\n"
        if a.out:
            a.out.parent.mkdir(parents=True, exist_ok=True)
            a.out.write_text(text)
        print(f"{n} solution(s), {len(flags)} numeric flag(s)" + (f" → {a.out}" if a.out else ""))
        for f in flags[:20]:
            print(f"  {f['solution_id']} step {f['step']}: {f['why']}")
        return 0

    if a.cmd == "args":
        import packet_ref
        book = _book(a.book)
        runs_dir = a.lesson_runs or HERE / "runs" / book.book / "lesson"
        parts = build_args(book, json.loads(a.seed.read_text()), a.chapter, a.by_ref, figures_for(runs_dir),
                           a.max_per_run)
        for k, args in enumerate(parts, start=1):
            out = a.out if k == 1 else a.out.with_name(f"{a.out.stem}.part{k}{a.out.suffix}")
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(packet_ref.dumps(args) + "\n")
            pre = json.loads(precheck_path(Path(args["by_ref"]["dir"])).read_text())
            print(f"wrote {out} — part {k} of {len(parts)}: {len(args['solutions'])} solution(s), "
                  f"{len(pre['skipped'])} skipped, {len(pre['flags'])} numeric flag(s); " + packet_ref.report(args, "by ref"))
            if a.embed:
                import embed_workflow
                e = a.embed if k == 1 else a.embed.with_name(a.embed.name.replace(".workflow.js", f".part{k}.workflow.js"))
                print(embed_workflow.summary(embed_workflow.write(HERE / "runbook" / "working-check.workflow.js", args, e)))
        return 0

    if a.cmd == "collect":
        args_list = [json.loads(p.read_text()) for p in a.args]
        runs = [json.loads(p.read_text()) for p in a.runs]
        rep = collect(args_list, runs)
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(json.dumps(rep, ensure_ascii=False, indent=1) + "\n")
        v = rep["verdicts"]
        print(f"chapter {rep['chapter']}: {rep['solutions']} solution(s) checked — {v['consistent']} consistent, "
              f"{v['flagged']} flagged, {v['unclear']} unclear, {len(rep['unchecked'])} unchecked; "
              f"{len(rep['flags'])} flag(s) on {rep['flagged_solutions']} solution(s) → {a.out}")
        for p in rep["problems"]:
            print(f"  x {p}", file=sys.stderr)
        return 1 if rep["problems"] or rep["unchecked"] else 0
    return 2


if __name__ == "__main__":
    sys.exit(main())

"""The step-level working checker (Samuel's answer 30, 2026-09-27; integration backlog 78).

    uv run working_check.py precheck --seed <chapter bundle.json> [--out flags.json]        # free, no model
    uv run working_check.py args     --book g10-math --seed <chapter bundle.json> --chapter N \\
                                     --by-ref DIR --out A.json [--lesson-runs runs/<book>/lesson] [--max-per-run 300]
                                     [--batch 5] [--effort high] [--model sonnet] [--only FILE] [--embed COPY]
                                     [--order shuffled --order-seed 11] [--pass-id B] [--aliases mutants.json]
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

THE AGENT (runbook/working-check.workflow.js, prompts sw-v3). One Sonnet agent per BATCH of up to 5 solutions
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
(~$0.012 each at 8), a figure policy (a figure is offered only when the question text does not give its points,
and every offered figure is read in the agent's first turn), reasoning effort `medium`, and notes only on
flags. Measured sw-v1 precision on the same chapter: 23 of 25 flags were real book defects; the two false ones
came from the shard (it omitted the multiple-choice options), which sw-v2 now prints.

SW-V3 (2026-10-01, after the two sw-v2 calibration runs: batch 8 / medium recall 12 of 16 real solutions by the
agents alone, batch 5 / high 14 of 16, both $0.019-0.027 a solution). Both missed Ex8-4:19b, whose points exist
only in its figure: the agents were told to open a figure "only if" a value was in no text, reconstructed
A, B, C from the working itself (circular, and the swapped labels vanish) and judged it consistent. So an
offered figure is now READ in the first turn, with the shards, and the prompt forbids back-solving a
figure's values. Their other misses (Ex8-6:17, 36c, 46e, 24a's stub) differed between the runs: lapses
of a shallow pass over 5-8 solutions, which an independent second pass catches (the union of the two runs
misses only 19b). So the whole-book configuration is TWO independent blind passes whose flags are UNIONED
(`args --order shuffled --pass-id B`, then `collect` with both runs), a flag two passes both raised
ranking above one a single pass raised. The truth set is sw-v1's own findings: recall against it is 100%
for sw-v1 by construction and overstates it, so `working_check_mutate.py` builds an unbiased set (known-good
solutions with one injected defect each, the truth written down) to measure recall by defect class.

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

PROMPTS_VERSION = "sw-v3"
FORMAT = "ainext.working-check/1"
MAX_PER_RUN = 300                       # keeps a part's compact args well under packet_ref.COMPACT_LIMIT
FLAG_KINDS = ("wrong_value", "arithmetic", "sign", "label", "copy", "final_answer", "other")
FLAG_WHERE = ("working", "question", "unsure")      # where the fault sits (sw-v2): a step, or the question text
BATCH = 5                               # solutions per checking agent: shares the ~$0.09 fixed cost of an agent
EFFORT = "high"                         # the agents' reasoning effort (batch 8 / medium missed simple typos: see SW-V3)
PASSES = ("A", "B")                     # two independent blind passes over every chapter, flags unioned
SHUFFLE_SEED = 11                       # pass B's order: the same solutions, other batch neighbours
MODEL = "sonnet"
EFFORTS = ("low", "medium", "high")
MODELS = ("sonnet", "haiku")
ORDERS = ("bundle", "shuffled")         # shuffled: a second, independent pass batches the solutions differently
# What the checker costs (API-equivalent USD per solution), for the fan-out plan. METERED on the Chapter 8
# calibration subset (51 solutions, Sonnet 5.5): sw-v1 one agent per solution $0.161 (31.0 / 192); sw-v2 batch 8 /
# medium $0.0188; sw-v2 batch 5 / high $0.0271. A sw-v3 PASS (batch 5 / high, figures read in the first turn,
# the trace rule) is modelled at $0.027-0.035; the recommended two passes at $0.054-0.07 until the sw-v3
# calibration runs are metered.
MEASURED_SW_V1_PER_SOLUTION = 0.161
MEASURED_SW_V2_PER_SOLUTION = {"batch8_medium": 0.0188, "batch5_high": 0.0271}
SW_PASS_COST_PER_SOLUTION = (0.027, 0.035)


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
                    "steps": steps, "page": e.get("source_page"),
                    "figures": list(figures.get(e["id"]) or [])})
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
        lines += ["", "FIGURE (the question's points, lengths or labels are shown only in this picture; the prompt "
                      "names it so you read it in your first turn):"]
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


def load_only(path: Path | None) -> set[str] | None:
    """The solution ids a run is limited to (a calibration subset): a JSON list, or a calibration file's `subset`."""
    if path is None:
        return None
    v = json.loads(Path(path).read_text())
    ids = v.get("subset") if isinstance(v, dict) else v
    if not isinstance(ids, list) or not all(isinstance(x, str) for x in ids):
        raise SystemExit(f"{path}: not a list of solution ids (or a calibration file with a `subset`)")
    return set(ids)


def load_aliases(path: Path | None) -> dict[str, str]:
    """{mutant id: the solution whose figures it uses} from a mutants truth file (working_check_mutate.py)."""
    if path is None:
        return {}
    return {m["id"]: m["base"] for m in json.loads(Path(path).read_text()).get("mutants") or []}


def shuffled(sols: list[dict], seed: int) -> list[dict]:
    """A deterministic permutation: a second pass batches the solutions with other neighbours, so its misses
    are not the first pass's misses (the S0b lesson: two independent readings, not one reading twice)."""
    return sorted(sols, key=lambda x: sha(f"{seed}:{x['id']}"))


def build_args(book, bundle: dict, chapter: int, directory: Path, figures: dict | None = None,
               max_per_run: int = MAX_PER_RUN, batch: int = BATCH, effort: str = EFFORT, model: str = MODEL,
               only: set[str] | None = None, order: str = "bundle", order_seed: int = 0,
               pass_id: str = "A") -> list[dict]:
    """The compact args of runbook/working-check.workflow.js, one per part (≤ max_per_run solutions, a
    whole number of batches), and the shard directories they name. Every solution with working gets one
    shard; the agents read `batch` of them each, and the figure of every solution that offers one
    (`figs`: shard number → image file, under `fig_dir`). The pre-check's result goes BESIDE the shard
    directory (<dir>.precheck.json, outside it, so no agent is ever pointed at it) for the collector —
    never into an agent's prompt: the agent is blind to it. `only`: limit the run to those solution ids (a
    calibration subset); the others are neither sent nor listed as skipped. `order` "shuffled" (with
    `order_seed`) is the second independent pass; `pass_id` names the pass in the flags `collect` merges."""
    import packet_ref
    if not 1 <= batch <= 12:
        raise SystemExit(f"--batch {batch}: between 1 and 12 solutions per agent")
    if effort not in EFFORTS or model not in MODELS or order not in ORDERS:
        raise SystemExit(f"--effort must be one of {EFFORTS}, --model one of {MODELS}, --order one of {ORDERS}")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,12}", pass_id):
        raise SystemExit(f"--pass-id {pass_id!r}: letters, digits, - or _ (at most 12)")
    per_run = max(batch, max_per_run - max_per_run % batch)
    sols = [s for s in solutions_from_bundle(bundle, figures) if only is None or s["id"] in only]
    if only is not None and (missing := only - {s["id"] for s in sols}):
        raise SystemExit(f"--only names {len(missing)} solution(s) the bundle does not have: {sorted(missing)[:3]}")
    todo = [s for s in sols if has_working(s)]
    if order == "shuffled":
        todo = shuffled(todo, order_seed)
    skipped = [{"id": s["id"], "why": "no working to check (the solution is a drawing)"} for s in sols if not has_working(s)]
    parts = [todo[i:i + per_run] for i in range(0, len(todo), per_run)] or [[]]
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
            "prompts_version": PROMPTS_VERSION, "batch": batch, "pass_id": pass_id,
            "solutions": [{"id": s["id"], "lo": s.get("lo"), "kind": s["kind"], "steps": len(s["steps"]),
                           "shard": f"s/{i:04d}.txt", "sha256": sha(render_shard(s))}
                          for i, s in enumerate(chunk, start=1)],
            "skipped": skipped if k == 1 else [], "flags": pre}, ensure_ascii=False, indent=1) + "\n")
        figs = {str(i): [Path(f).as_posix() for f in figures_offered(s)] for i, s in enumerate(chunk, start=1)
                if figures_offered(s)}
        parents = [str(Path(f).parent) for v in figs.values() for f in v]
        fig_dir = max(set(parents), key=parents.count) if parents else ""
        figs = {i: [Path(f).name if str(Path(f).parent) == fig_dir else f for f in v] for i, v in figs.items()}
        out.append({"book": {"book": book.book}, "stage": "SW", "prompts_version": PROMPTS_VERSION,
                    "chapter": chapter, "part": k, "parts": len(parts), "batch": batch,
                    "effort": effort, "model": model, "pass_id": pass_id, "order": order,
                    "fig_dir": fig_dir, "figs": figs,
                    "solutions": [s["id"] for s in chunk], "by_ref": ref})
    return out


def agents_for(solutions: int, batch: int = BATCH, passes: int = 1) -> int:
    """Checking agents a chapter of `solutions` solutions with working needs (`passes` independent passes)."""
    return math.ceil(solutions / batch) * passes


# ============================================================================ collect
def collect(args_list: list[dict], runs: list[dict]) -> dict:
    """Merge the agents' verdicts and the pre-check into one flags file. Nothing is corrected.

    `runs` may hold several PASSES over the same solutions (each run names its `pass_id`, default "A"; the
    parts of one pass share it). A solution answered by more than one pass gets the UNION of their flags (a
    flag at the same step is one flag, naming every pass that raised it — `passes`: a flag two independent
    passes both raised outranks one a single pass raised), "flagged" if any pass flagged it, else "unclear"
    if any said so, else "consistent"."""
    by_id: dict[str, dict] = {}
    pre: list[dict] = []
    skipped: list[dict] = []
    for a in args_list:
        meta = json.loads(precheck_path(Path(a["by_ref"]["dir"])).read_text())
        for s in meta["solutions"]:
            by_id[s["id"]] = s
        for f in meta["flags"]:
            if not any((f["solution_id"], f["step"], f["why"]) == (g["solution_id"], g["step"], g["why"]) for g in pre):
                pre.append(f)
        skipped += [x for x in meta["skipped"] if x not in skipped]
    answered: dict[str, dict[str, dict]] = {}
    problems: list[str] = []
    pass_ids: list[str] = []
    for r in runs:
        r = r.get("result", r)
        if r.get("stage") != "SW":
            raise SystemExit("not a working-check run (stage is not SW)")
        pid = r.get("pass_id") or "A"
        if pid not in pass_ids:
            pass_ids.append(pid)
        for x in r.get("results") or []:
            sid = x.get("solution_id")
            if sid not in by_id:
                problems.append(f"a result names {sid!r}, which is not a solution of these args")
                continue
            answered.setdefault(sid, {})[pid] = x
    flags: list[dict] = []
    verdicts = {"consistent": 0, "flagged": 0, "unclear": 0}
    unclear, unchecked, checked, single = [], [], [], []
    for sid, meta in by_id.items():
        xs = {pid: x for pid, x in (answered.get(sid) or {}).items() if x.get("verdict")}
        if not xs:
            unchecked.append({"id": sid, "why": "the checking agent returned nothing: re-run it"})
            continue
        checked.append(sid)
        if len(xs) < len(pass_ids):
            single.append(sid)
        mine: list[dict] = []
        for pid in sorted(xs):
            for f in xs[pid].get("flags") or []:
                step = f.get("step")
                if not isinstance(step, int) or not 1 <= step <= meta["steps"]:
                    problems.append(f"{sid}: a flag names step {step!r}, which the solution does not have (1–{meta['steps']})")
                    continue
                kind = f.get("kind") or "other"
                same = next((m for m in mine if m["step"] == step), None)
                if same:
                    same["passes"].append(pid)
                    same["sources"] = same["sources"] if "agent" in same["sources"] else same["sources"] + ["agent"]
                    if kind != same["kind"] and kind not in same.setdefault("also_kinds", []):
                        same["also_kinds"].append(kind)
                    continue
                mine.append({"solution_id": sid, "lo": meta.get("lo"), "step": step, "kind": kind,
                             "where": f.get("where") if f.get("where") in FLAG_WHERE else "working",
                             "quote": f.get("quote") or "", "expected": f.get("expected") or "",
                             "why": f.get("why") or "", "sources": ["agent"], "passes": [pid]})
        flags += mine
        merged = "flagged" if mine or any(x["verdict"] == "flagged" for x in xs.values()) else (
            "unclear" if any(x["verdict"] == "unclear" for x in xs.values()) else "consistent")
        verdicts[merged] += 1
        if merged == "unclear":
            unclear.append({"id": sid, "why": next((x.get("note") for x in xs.values() if x.get("verdict") == "unclear" and x.get("note")), "")})
    for p in pre:                                           # the free pre-check: merged by step
        src = p.get("source") or "numeric"
        detail = {k: p[k] for k in ("left", "relation", "right", "why") if k in p}
        same = next((f for f in flags if f["solution_id"] == p["solution_id"] and f["step"] == p["step"]), None)
        if same:
            if src not in same["sources"]:
                same["sources"].append(src)
            same.setdefault("numeric", detail)
        else:
            flags.append({"solution_id": p["solution_id"], "lo": p.get("lo"), "step": p["step"],
                          "kind": p.get("kind") or "arithmetic", "where": "working",
                          "quote": p["quote"], "expected": "", "why": p["why"], "sources": [src], "passes": [],
                          "numeric": detail})
    flags.sort(key=lambda f: (f["solution_id"], f["step"]))
    a0 = args_list[0]
    rv = {r.get("result", r).get("prompts_version") for r in runs} - {None}
    return {
        "format": FORMAT, "book": a0["book"]["book"], "chapter": a0["chapter"],
        "prompts_version": sorted(rv)[0] if len(rv) == 1 else a0.get("prompts_version", PROMPTS_VERSION),
        "rule": "Each flag is a backlog item for a human (answer 30; answer 37c). Nothing here was corrected: the "
                "content stays as the book and G2 have it until a human decides.",
        "passes": pass_ids, "single_pass_ids": sorted(single),
        "solutions": len(by_id), "skipped": skipped, "verdicts": verdicts,
        "flags": flags, "flagged_solutions": len({f["solution_id"] for f in flags}),
        "unclear": unclear, "unchecked": unchecked, "problems": problems,
        "checked_ids": sorted(checked),
        "runs": [r.get("result", r).get("run_id") or r.get("result", r).get("embedded", {}).get("generated_sha256")
                 for r in runs],
    }


# ============================================================================ calibrate
def calibrate(truth: dict, rep: dict, mutants: dict | None = None) -> dict:
    """Score a flags file (`collect`'s output) against a calibration truth file (the classified flags of an earlier
    run on the same chapter) and, if given, a mutants file (working_check_mutate.py: known-good solutions with one
    injected defect each). The measure that matters is recall of the REAL defects: a cheaper checker that misses
    the typos is no saving. Two cautions are built in. (1) The Chapter 8 truth is sw-v1's OWN findings: sw-v1 scores
    100% against it by construction, so a v2 below it is not proof v2 is worse; the mutants are the unbiased set.
    (2) A flag only a free check raised (numeric, stub) is not the agents' recall: both are reported. Nothing
    here calls a model."""
    flags: dict[str, list[dict]] = {}
    for f in rep["flags"]:
        flags.setdefault(f["solution_id"], []).append(f)
    unclear_ids = {u["id"] for u in rep.get("unclear") or []}
    checked = set(rep.get("checked_ids") or [])                 # absent: a run that predates it, treat all as run
    ran = (lambda sid: sid in checked) if checked else (lambda sid: True)
    agent = lambda sid: [f for f in flags.get(sid, []) if "agent" in f["sources"]]
    out: dict = {"prompts_version": rep.get("prompts_version"), "real": [], "elsewhere": [], "false_repeat": [],
                 "unclear": [], "controls_new_flags": [], "not_run": [], "mutants": []}
    for lab in truth["labels"]:
        sid, step, v = lab["solution_id"], lab["step"], lab["verdict"]
        if not ran(sid):
            out["not_run"].append(sid)
            continue
        hit = flags.get(sid, [])
        row = {"solution_id": sid, "step": step, "solution_flagged": bool(hit), "agent_flagged": bool(agent(sid)),
               "said_unclear": sid in unclear_ids,
               "step_flagged": any(f["step"] == step for f in hit), "sources": sorted({s for f in hit for s in f["sources"]}),
               "passes": sorted({p for f in agent(sid) for p in f.get("passes") or []})}
        if v == "REAL":
            out["real"].append(row)
        elif v == "REAL-BUT-ELSEWHERE":
            out["elsewhere"].append(row)
        else:
            out["false_repeat"].append(row)
    for u in truth.get("unclear") or []:
        if ran(u["solution_id"]):
            hit = flags.get(u["solution_id"], [])
            out["unclear"].append({"solution_id": u["solution_id"], "flagged": bool(hit),
                                   "said_unclear": u["solution_id"] in unclear_ids})
    for sid in (truth.get("controls") or {}).get("ids", []):
        if ran(sid) and flags.get(sid):
            out["controls_new_flags"].append({"solution_id": sid, "flags": [(f["step"], f["kind"], f["why"][:120]) for f in flags[sid]]})
    real_sols = {r["solution_id"] for r in out["real"]}
    caught = {r["solution_id"] for r in out["real"] if r["solution_flagged"]}
    caught_agent = {r["solution_id"] for r in out["real"] if r["agent_flagged"]}
    pids = sorted({p for r in out["real"] for p in r["passes"]})
    elsewhere_seen = {r["solution_id"] for r in out["elsewhere"]}
    elsewhere_hit = {r["solution_id"] for r in out["elsewhere"] if r["agent_flagged"] or r["said_unclear"]}
    out["summary"] = {
        "real_solutions": len(real_sols), "real_solutions_caught": len(caught),
        "real_recall_solution": round(len(caught) / len(real_sols), 3) if real_sols else None,
        "real_solutions_caught_by_agents": len(caught_agent),
        "real_recall_agents_only": round(len(caught_agent) / len(real_sols), 3) if real_sols else None,
        "real_recall_by_pass": {p: len({r["solution_id"] for r in out["real"] if p in r["passes"]}) for p in pids},
        "real_flags": len(out["real"]), "real_flags_at_the_step": sum(r["step_flagged"] for r in out["real"]),
        "elsewhere_caught": f"{sum(r['solution_flagged'] for r in out['elsewhere'])}/{len(out['elsewhere'])}",
        "elsewhere_solutions_flagged_or_unclear": f"{len(elsewhere_hit)}/{len(elsewhere_seen)}",
        "false_flags_repeated": sum(r["solution_flagged"] for r in out["false_repeat"]),
        "unclear_kept_unclear_or_flagged": sum(u["flagged"] or u["said_unclear"] for u in out["unclear"]),
        "controls_flagged_for_a_human_to_read": len(out["controls_new_flags"]),
        "missed_real": sorted(real_sols - caught),
        "missed_real_by_agents": sorted(real_sols - caught_agent),
    }
    if mutants:
        by_op: dict[str, list[bool]] = {}
        for m in mutants.get("mutants") or []:
            if not ran(m["id"]):
                continue
            hit = agent(m["id"])
            row = {"id": m["id"], "operator": m["operator"], "kind": m["kind"], "step": m.get("step"), "caught": bool(hit),
                   "at_step": any(f["step"] == m["step"] for f in hit) if m.get("step") else None,
                   "passes": sorted({p for f in hit for p in f.get("passes") or []}), "base": m.get("base")}
            out["mutants"].append(row)
            by_op.setdefault(m["operator"], []).append(bool(hit))
        n = len(out["mutants"])
        out["summary"]["mutants"] = {
            "total": n, "caught_by_agents": sum(r["caught"] for r in out["mutants"]),
            "recall": round(sum(r["caught"] for r in out["mutants"]) / n, 3) if n else None,
            "by_operator": {op: f"{sum(v)}/{len(v)}" for op, v in sorted(by_op.items())},
            "by_pass": {p: sum(p in r["passes"] for r in out["mutants"]) for p in sorted({p for r in out["mutants"] for p in r["passes"]})},
            "missed": [r["id"] for r in out["mutants"] if not r["caught"]]}
    return out


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
    p.add_argument("--batch", type=int, default=BATCH, help=f"solutions per checking agent (default {BATCH})")
    p.add_argument("--effort", default=EFFORT, choices=EFFORTS, help=f"the agents' reasoning effort (default {EFFORT})")
    p.add_argument("--model", default=MODEL, choices=MODELS, help=f"the agents' model (default {MODEL})")
    p.add_argument("--only", type=Path, metavar="FILE",
                   help="limit the run to these solutions: a JSON list of ids, or a calibration file's `subset`")
    p.add_argument("--order", default="bundle", choices=ORDERS,
                   help="shuffled = the second, independent pass: other batch neighbours (default bundle order)")
    p.add_argument("--order-seed", type=int, default=0, help="the shuffle's seed (only with --order shuffled)")
    p.add_argument("--pass-id", default="A", help="names this pass in `collect`'s merged flags (A, B, …)")
    p.add_argument("--aliases", type=Path, metavar="FILE",
                   help="a mutants truth file: its mutant ids offer their base solution's figures")
    p.add_argument("--embed", type=Path, metavar="FILE",
                   help="also write a generated copy of runbook/working-check.workflow.js with the args embedded "
                        "(a second part gets .part2 …)")
    p = sub.add_parser("collect", help="merge the runs and the pre-check into the flags file")
    p.add_argument("--args", type=Path, action="append", required=True)
    p.add_argument("--runs", type=Path, nargs="+", required=True)
    p.add_argument("--out", type=Path, required=True)
    p = sub.add_parser("calibrate", help="score a flags file against a calibration truth file (recall of the real defects)")
    p.add_argument("--truth", type=Path, required=True)
    p.add_argument("--flags", type=Path, required=True)
    p.add_argument("--mutants", type=Path, help="a mutants truth file (working_check_mutate.py): recall by injected defect")
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
        print(f"{n} solution(s), {len(flags)} free pre-check flag(s)" + (f" → {a.out}" if a.out else ""))
        for f in flags[:20]:
            print(f"  {f['solution_id']} step {f['step']}: {f['why']}")
        return 0

    if a.cmd == "args":
        import packet_ref
        book = _book(a.book)
        runs_dir = a.lesson_runs or HERE / "runs" / book.book / "lesson"
        figures = figures_for(runs_dir)
        for mid, base in load_aliases(a.aliases).items():
            figures[mid] = figures.get(base, [])
        parts = build_args(book, json.loads(a.seed.read_text()), a.chapter, a.by_ref, figures,
                           a.max_per_run, a.batch, a.effort, a.model, load_only(a.only), a.order, a.order_seed, a.pass_id)
        for k, args in enumerate(parts, start=1):
            out = a.out if k == 1 else a.out.with_name(f"{a.out.stem}.part{k}{a.out.suffix}")
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(packet_ref.dumps(args) + "\n")
            pre = json.loads(precheck_path(Path(args["by_ref"]["dir"])).read_text())
            print(f"wrote {out} — part {k} of {len(parts)}: {len(args['solutions'])} solution(s) in "
                  f"{agents_for(len(args['solutions']), a.batch)} agent(s) of ≤ {a.batch} ({a.model}, effort {a.effort}, pass "
                  f"{a.pass_id}, {a.order} order, {sum(len(v) for v in args['figs'].values())} figure(s) read), "
                  f"{len(pre['skipped'])} skipped, {len(pre['flags'])} free pre-check flag(s); "
                  + packet_ref.report(args, "by ref"))
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

    if a.cmd == "calibrate":
        rep = calibrate(json.loads(a.truth.read_text()), json.loads(a.flags.read_text()),
                        json.loads(a.mutants.read_text()) if a.mutants else None)
        sm = rep["summary"]
        print(f"prompts {rep['prompts_version']}: real defects caught {sm['real_solutions_caught']}/{sm['real_solutions']} "
              f"solutions (recall {sm['real_recall_solution']}; by the agents alone {sm['real_solutions_caught_by_agents']}, "
              f"by pass {sm['real_recall_by_pass']}), {sm['real_flags_at_the_step']}/{sm['real_flags']} at the step; "
              f"real-but-elsewhere {sm['elsewhere_caught']} flagged, {sm['elsewhere_solutions_flagged_or_unclear']} flagged-or-unclear; "
              f"false flags repeated {sm['false_flags_repeated']}; controls flagged (read them) "
              f"{sm['controls_flagged_for_a_human_to_read']}")
        if sm["missed_real"]:
            print("  MISSED (any signal): " + ", ".join(sm["missed_real"]))
        if sm["missed_real_by_agents"]:
            print("  missed by the agents: " + ", ".join(sm["missed_real_by_agents"]))
        if "mutants" in sm:
            mu = sm["mutants"]
            print(f"  injected defects (unbiased): caught {mu['caught_by_agents']}/{mu['total']} (recall {mu['recall']}); "
                  f"by operator {mu['by_operator']}; by pass {mu['by_pass']}")
            if mu["missed"]:
                print("  mutants missed: " + ", ".join(mu["missed"]))
        for c in rep["controls_new_flags"]:
            print(f"  control flagged: {c['solution_id']}: {c['flags']}")
        print(json.dumps(sm, ensure_ascii=False))
        return 0 if not sm["missed_real"] and not sm["false_flags_repeated"] else 1
    return 2


if __name__ == "__main__":
    sys.exit(main())

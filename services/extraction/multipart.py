"""What a part of a multi-part exercise depends on (2026-10-01; found by the working-checker calibration).

    uv run multipart.py --book g10-math --chapter 8            # the plan: stems changed (before → after), unresolved
    uv run multipart.py --book g10-math --chapter 8 --json     # the same, machine-readable

THE DEFECT. The book prints a question once and its parts (a), (b), (c) … beneath it, and many parts lean on
the ones before them: "Prove that ST ∥ PR" names S and T, which part (b) defines ("the mid-points of PQ and QR");
"Prove that ABCD is a parallelogram" has a worked answer that ends "= E", E being part (a)'s mid-point. The
pipeline serves every part on its own, so a student who meets part (d) alone cannot answer it (Ex8-6:39d, 44b, 46c;
`runs/g10-math/working-check/ch08.calibration.json`, "findings for others" in docs/WIP-g10-pilot/README.md).

WHAT A PART ALREADY CARRIES. The question's shared words (the preamble, and the figure it shows): the lesson
packet (`assemble_objectives.item_stem`) puts the set's instruction and the question's header in front of every
part's own text, so the preamble `H` is exactly the text every part of a question has in common. This module finds
the rest. It is deterministic, reads only what the book printed (the parts' own words and G2's keys), never
solves and never invents, and what it cannot settle it LISTS instead of guessing.

THE RULES (a part P of a question, the parts before it Q):

  R1 DEFINITIONS. Q's own words introduce a name — "S and T, the mid-points of PQ and QR", "M where the diagonals
     meet", "E (the mid-point of BD)", "the mid-point M of AB" — and P (its words, or its worked answer) uses that
     name without P's own words or the preamble giving it. P gets one sentence in the book's words: "$S$ and $T$ are
     the mid-points of $PQ$ and $QR$ ." When Q is a marked question whose key is that one point's coordinates, the
     key travels too: "$E(\\frac{1}{2};-\\frac{3}{2})$ is the mid-point of $BD$ ." (the book's printed answer, G2's key).
     This is the shape Samuel's G2 fix gave Ex8-6:39c by hand ("S and T are the mid-points of PQ and QR").
  R2 VALUES OF THE PREAMBLE'S UNKNOWNS. The preamble gives a point unknown coordinates (`N(x;y)`, `U(6;a)`), an
     earlier part asks for exactly that ("the coordinates of N", "the value of a"), has a marked key, and P uses the
     point and does not ask for it itself: "$N=(3;5)$ ." / "$a=5$ ."
  R3 NAMED GRADIENTS. P's worked answer uses a gradient symbol `m_{MN}` it never computes (it is never followed by
     "="), and an earlier marked part asked for "the gradient of MN": "$m_{MN}=-\\frac{1}{3}$ ."

The sentences go straight after the preamble, before the part's own words, joined with a space: the same place and
style as the hand fix on 39c. A part with no earlier part to lean on, or that leans on nothing, is untouched; running
the rule on a stem that already carries a sentence changes nothing (a part's own words bind a name too).

WHAT IT LISTS (`Unresolved`, for the review backlog — never changed):
  refers_by_words    the part's words or its worked answer point back by words ("Hence", "from the previous question",
                     "from above", "we have just calculated"): the fix is a human's (which earlier part, what it
                     gave), and the earlier parts are listed with their keys so that it takes one look;
  no_key             a name or value is needed from an earlier part that is held, excluded, teaching-only or unkeyed,
                     so there is nothing the book printed to carry;
  conflict           two earlier parts give the same name two meanings;
  not_extractable    an earlier part introduces a name in words this module's patterns cannot restate safely;
  unbound_name       (no figure only) the part's words name a point nothing defines.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------------------------- the refs
_PART_REF = re.compile(r"^Ex(?P<ex>\d+-\d+):(?P<q>\d+)(?P<sub>[a-z]{1,3})(?:-(?P<roman>[ivx]+))?$")
_ANY_REF = re.compile(r"^Ex(?P<ex>\d+-\d+):(?P<q>\d+)(?P<sub>[a-z]{0,3})(?:-(?P<roman>[ivx]+))?$")
CARRY_BY = "pipeline carry-over (multipart.py: a part carries what it depends on)"


@dataclass
class Part:
    """One book item as the rule sees it. `stem` and `working` are the run's own text; `key` is the book's
    printed answer as G2 approved it (a numeric answer or the marker's key), and only on a verified, markable
    item: anything else is not a value to carry."""
    ref: str
    stem: str
    working: str = ""
    fate: str = "verified"             # verified | held | excluded | teaching
    kind: str | None = None            # the marker's kind (coordinates, expression, equation, values, surd)
    key: str | None = None

    @property
    def keyed(self) -> bool:
        return self.fate == "verified" and bool(self.key)


@dataclass
class Carry:
    ref: str
    sentences: list[str]
    items: list[dict]                   # provenance, one per sentence: {rule, from, names|symbol, text}
    before: str
    after: str


@dataclass
class Unresolved:
    ref: str
    reason: str
    detail: str
    sources: list[dict] = field(default_factory=list)   # the earlier parts to look at: {ref, words, key}

    def as_dict(self) -> dict:
        return {"ref": self.ref, "reason": self.reason, "detail": self.detail, "sources": self.sources}


# ------------------------------------------------------------------------------------------- the text
# S0b stores LaTeX whitespace-stripped, so commands come back glued to the names after them (`\parallelPR`,
# `\trianglePQR`, `\thereforeMP`). The assembly re-spaces them with KaTeX's own list; this module only needs
# to see the names, and splits at the longest command it knows.
_CMDS = sorted((
    "triangle", "parallel", "perp", "therefore", "because", "times", "cdot", "angle", "hat", "widehat", "overline",
    "vec", "frac", "dfrac", "tfrac", "sqrt", "text", "left", "right", "begin", "end", "quad", "qquad", "geq",
    "leq", "ge", "le", "neq", "ne", "approx", "pm", "mp", "div", "Rightarrow", "rightarrow", "Leftrightarrow",
    "implies", "infty", "pi", "theta", "alpha", "beta", "gamma", "circ", "degree", "ldots", "cdots", "mathrm",
    "mathbf", "mathbb", "boxed", "in", "notin", "cup", "cap", "subset", "parallelogram", "textbf", "mathit"),
    key=len, reverse=True)
_SUBSCRIPT = re.compile(r"([A-Za-z])_\{?([A-Za-z0-9]+?)\}?(?![A-Za-z0-9])")


def _segments(text: str):
    """(segment, is_math) pairs; a `$…$` span is maths, the rest is prose."""
    for i, seg in enumerate(re.split(r"\$", text or "")):
        yield seg, i % 2 == 1


def _unlatex(seg: str) -> str:
    """A maths segment with its commands removed (the longest known one is cut off a glued run) and every
    `\\text{words}` turned into the words; subscripts keep their letters (`m_{AB}` → ` AB `)."""
    seg = re.sub(r"\\(?:mathbb|mathrm|mathbf|mathit|operatorname)\{[^{}]*\}", " ", seg)
    # \text{words}: the words, minus the capitalised ones ("Area", "Therefore" are no point); an all-capital
    # run ("AB") is a name and stays
    seg = re.sub(r"\\text(?:bf)?\{([^{}]*)\}",
                 lambda m: " " + re.sub(r"\b[A-Z][a-z]+\b", " ", m.group(1)) + " ", seg)

    def cmd(m: re.Match) -> str:
        run = m.group(1)
        for c in _CMDS:
            if run.startswith(c):
                return " " + run[len(c):]
        return " "                          # an unknown command (\Delta …): a name of no point
    seg = re.sub(r"\\([A-Za-z]+)", cmd, seg)
    seg = _SUBSCRIPT.sub(lambda m: " " + m.group(2) + " ", seg)
    return seg


def plain(text: str) -> str:
    """The words of a stem: maths delimiters and commands removed, spaces collapsed, no space before a stop."""
    out = []
    for seg, is_math in _segments(text):
        out.append(_unlatex(seg) if is_math else seg)
    s = re.sub(r"\s+", " ", " ".join(out)).strip()
    return re.sub(r"\s+([.,;:?!])", r"\1", s)


def names_in(text: str) -> set[str]:
    """The point names a text uses: every capital letter inside maths (an operator's base — the M of M_{AC}, the
    m of m_{AB} — is no point), and the capitals of an all-capital word in prose ("ABCD is a quadrilateral")."""
    out: set[str] = set()
    for seg, is_math in _segments(text):
        if is_math:
            out |= set(re.findall(r"[A-Z]", _unlatex(seg)))
        else:
            for word in re.findall(r"(?<![A-Za-z])[A-Z]{2,5}(?![A-Za-z])", seg):
                out |= set(word)
    return out


def _math_plain(text: str) -> str:
    """Only the maths of a text, commands removed — for what follows a capital (`N(x;y)`)."""
    return " ".join(_unlatex(seg) for seg, m in _segments(text) if m)


def point_bound(text: str) -> dict[str, list[str]]:
    """Capitals the text gives coordinates to — `P(5;1)`, `N(x;y)` — with what is inside the brackets."""
    out: dict[str, list[str]] = {}
    for m in re.finditer(r"(?<![A-Za-z])([A-Z])\s*\(([^()]*)\)", _math_plain(text)):
        out.setdefault(m.group(1), []).append(m.group(2))
    return out


def concrete_points(text: str) -> set[str]:
    """Capitals the text gives numbers only: `U(6;5)`, not `U(6;a)`."""
    return {L for L, ins in point_bound(text).items() if any(not re.search(r"[A-Za-z]", x) for x in ins)}


def unknown_points(text: str) -> dict[str, set[str]]:
    """Points the text leaves unknown — `N(x;y)`, `U(6;a)`, `S(t+1;2.5)` — and the variables in them. A point has two
    coordinates: `P(x)` is a function of one variable, not a point."""
    out: dict[str, set[str]] = {}
    for L, ins in point_bound(text).items():
        for x in ins:
            if not re.search(r"[;,]", x):
                continue
            vs = set(re.findall(r"[a-z]", x))
            if vs:
                out.setdefault(L, set()).update(vs)
    return out


# --------------------------------------------------------------------------- the book's own definitions
_N = r"[A-Z]"
_NAMES = rf"{_N}(?:\s*,\s*{_N})*(?:\s*,?\s*and\s+{_N})?"
_SEG = r"[A-Z]{2,3}"
_SEGS = rf"{_SEG}(?:\s*(?:,|and)\s*{_SEG})*"
_NOUN = r"(?:mid-?points?|midpoints?|points? of intersection|intersections?)"
_B = r"(?<![A-Za-z])"
_DEFS = (
    # S and T, the mid-points of PQ and QR   (Find the coordinates of points S and T, the mid-points of …)
    ("appositive", re.compile(rf"{_B}(?:points?\s+)?(?P<names>{_NAMES})\s*,\s*the\s+(?P<noun>{_NOUN})\s+of\s+"
                              rf"(?P<rest>{_SEGS})(?![A-Za-z])")),
    # E (the mid-point of BD)
    ("bracket", re.compile(rf"{_B}(?P<names>{_NAMES})\s*\(\s*the\s+(?P<noun>{_NOUN})\s+of\s+(?P<rest>{_SEGS})\s*\)")),
    # S and T are the mid-points of PQ and QR
    ("copula", re.compile(rf"{_B}(?P<names>{_NAMES})\s+(?:is|are)\s+the\s+(?P<noun>{_NOUN})\s+of\s+"
                          rf"(?P<rest>{_SEGS})(?![A-Za-z])")),
    # the mid-point M of AB
    ("prefix", re.compile(rf"\bthe\s+(?P<noun>{_NOUN})\s+(?P<names>{_N})\s+of\s+(?P<rest>{_SEG})(?![A-Za-z])")),
    # M where the diagonals meet
    ("where", re.compile(rf"{_B}(?P<names>{_NAMES})\s+(?:(?:is|are)\s+)?where\s+the\s+diagonals\s+(?P<verb>meet|intersect)"
                         rf"(?![A-Za-z])")),
)


@dataclass(frozen=True)
class Definition:
    names: tuple[str, ...]
    noun: str | None                    # "mid-points", "mid-point", or None for "where the diagonals meet"
    rest: str | None
    verb: str | None = None

    def clause(self) -> str:
        """The definition as a sentence in the book's own words, names and segments in maths."""
        if len(self.names) > 2:
            who = ", ".join(f"${n}$" for n in self.names[:-1]) + f" and ${self.names[-1]}$"
        else:
            who = " and ".join(f"${n}$" for n in self.names)
        return self._tail(who)

    def with_value(self, key: str) -> str:
        n = self.names[0]
        return self._tail(f"${n}{key if key.startswith('(') else '(' + key + ')'}$")

    def _tail(self, who: str) -> str:
        be = "is" if len(self.names) == 1 else "are"
        if self.noun is None:
            return f"{who} {be} where the diagonals {self.verb}."
        rest = re.sub(_SEG, lambda m: f"${m.group(0)}$", self.rest or "")
        return f"{who} {be} the {self.noun} of {rest}."


def _split_names(raw: str) -> tuple[str, ...]:
    return tuple(re.findall(_N, raw))


def definitions(tail: str) -> list[Definition]:
    """The names a part's own words introduce, in the book's patterns (above). Reads the words only."""
    text = plain(tail)
    out: list[Definition] = []
    seen: set[tuple] = set()
    for _kind, rx in _DEFS:
        for m in rx.finditer(text):
            names = _split_names(m.group("names"))
            if not names:
                continue
            # a question or a condition is no definition: "Is M the mid-point of AB?", "whether M is …", "if M is …"
            sentence_start = max(text.rfind(x, 0, m.start()) for x in (". ", "? ", ": ", "! ")) + 1
            if re.search(r"\b(whether|if|is it|can you|true or false|not)\b", text[sentence_start:m.start()], re.I):
                continue
            d = Definition(names, (m.groupdict().get("noun") or None), (m.groupdict().get("rest") or None),
                           m.groupdict().get("verb"))
            sig = (d.names, d.noun, d.rest, d.verb)
            if sig not in seen:
                seen.add(sig)
                out.append(d)
    return out


# ------------------------------------------------------------------------------ what a part asks for
def asked_coordinates(tail: str) -> set[str]:
    out: set[str] = set()
    for m in re.finditer(rf"coordinates of (?:the )?(?:points? )?(?P<n>{_NAMES})(?![A-Za-z])", plain(tail)):
        names = _split_names(m.group("n"))
        if len(names) == 1:
            out.add(names[0])
    return out


def asked_values(tail: str) -> set[str]:
    out: set[str] = set()
    for m in re.finditer(r"\bvalues? of (?:the )?(?P<v>[a-z])(?![A-Za-z])(?!\s*(?:,|and)\s*[a-z]\b)", plain(tail)):
        out.add(m.group("v"))
    return out


def asked_gradients(tail: str) -> set[str]:
    return {m.group("xy") for m in re.finditer(r"\bgradient of (?:the )?(?:line |side |segment )?(?P<xy>[A-Z]{2})(?![A-Za-z])",
                                               plain(tail))}


_GRADIENT_SYM = re.compile(r"m_\{?([A-Z]{2})\}?")


def gradients_used_not_computed(working: str) -> list[str]:
    """Gradient symbols `m_{XY}` the worked answer uses but never computes: computing is `m_{XY} = …` at the
    start of a statement — followed by "=" and not itself an operand (`m_{AC}\\times m_{BD} = …` computes
    neither; `m_{QR} = m_{PQ}` computes only the first)."""
    text = re.sub(r"\\text\{[^{}]*\}", " ", working or "")
    text = re.sub(r"\\(?:times|cdot|div)", " * ", text)
    used, computed = [], set()
    for m in _GRADIENT_SYM.finditer(text):
        xy = m.group(1)
        before = text[:m.start()].rstrip()
        operand = bool(before) and before[-1] in "*+-/("
        if not operand and re.match(r"\s*&?\s*=", text[m.end():]):
            computed.add(xy)
        used.append(xy)
    out = []
    for xy in used:
        if xy not in computed and xy not in out:
            out.append(xy)
    return out


def _scalar(key: str | None) -> bool:
    """A key that is one value — a number or an expression — not an equation, a list or a point."""
    return bool(key) and not re.search(r"[=,;<>]", key)


def _one_point(key: str | None) -> bool:
    """A key that is exactly one point `(a; b)`."""
    k = (key or "").strip()
    if not (k.startswith("(") and k.endswith(")")):
        return False
    depth = 0
    for i, ch in enumerate(k):
        depth += ch == "("
        depth -= ch == ")"
        if depth == 0 and i < len(k) - 1:
            return False
    return depth == 0 and (";" in k or "," in k)


# ------------------------------------------------------------------------------------ referential words
_REF_TAIL = re.compile(
    r"\b(hence|thus|(?:using|use|from|with) (?:your|the) (?:answer|result)s?|the (?:previous|preceding) (?:question|part)|"
    r"(?:in|from|of) (?:part|question) \(?[a-e]\)?|(?:your|the) (?:answer|result) (?:to|from|of|in) (?:part|question|\(?[a-e]\)))\b", re.I)
_REF_WORK = re.compile(
    r"\b(from (?:the )?(?:previous|preceding|first|above|earlier)|from above|from earlier|we found earlier|"
    r"earlier we|(?:just|already) (?:calculated|found)|we have (?:just |already )?(?:calculated|found|worked out)|"
    r"(?:the )?previous (?:question|part)s?|as above|in the previous|from question|from part)\b", re.I)


def referential(tail: str, working: str) -> list[str]:
    hits = [m.group(0) for m in _REF_TAIL.finditer(plain(tail))]
    hits += [m.group(0) for m in _REF_WORK.finditer(re.sub(r"\$[^$]*\$", " ", working or ""))]
    return hits


# --------------------------------------------------------------------------------------- the preamble
def _tokens(stem: str) -> list[tuple[str, int, int]]:
    return [(m.group(0), m.start(), m.end()) for m in re.finditer(r"\S+", stem)]


_STOP = (".", ":", "?", "!")


def _closes_sentence(tok: str) -> bool:
    return tok.endswith(_STOP) or tok == "[figure]"


def preamble_end(stems: list[str]) -> list[int]:
    """Where the words every part shares end, in each stem: the longest common run of tokens, cut back to a
    sentence end (a stop, a colon, or a figure). 0 where the parts share no sentence."""
    toks = [_tokens(s) for s in stems]
    k = 0
    while all(len(t) > k for t in toks) and len({t[k][0] for t in toks}) == 1:
        k += 1
    while k > 0 and not _closes_sentence(toks[0][k - 1][0]):
        k -= 1
    return [t[k - 1][2] if k else 0 for t in toks]


# ------------------------------------------------------------------------------------------- the plan
def _source(p: Part, tail: str) -> dict:
    return {"ref": p.ref, "words": plain(tail), "key": p.key if p.keyed else None, "fate": p.fate}


def _flat(text: str) -> str:
    return re.sub(r"[\s$\\{}]", "", text or "")


def _reveals(P: Part, sentence: str) -> bool:
    """Would the carried sentence hand P's own answer to the student? (the key standing alone in it)"""
    if not P.keyed:
        return False
    key = _flat(P.key)
    return bool(key) and re.search(r"(?<![\w.])" + re.escape(key) + r"(?!\w|\.\d)", _flat(sentence)) is not None


def _states(own: str, symbol: str) -> bool:
    """Does P's own text already say what `symbol` is ("$N=(3;5)$", "$a=5$", "$m_{MN}=…$")?"""
    return re.search(rf"(?<![A-Za-z]){re.escape(symbol)}\s*=", _math_plain(own)) is not None


def _states_gradient(own: str, xy: str) -> bool:
    return re.search(rf"m_\{{?{xy}\}}?\s*=", own) is not None


def _group_parts(parts: list[Part]) -> list[list[Part]]:
    groups: dict[tuple, list[tuple[tuple, Part]]] = {}
    for p in parts:
        m = _PART_REF.match(p.ref)
        if m:
            groups.setdefault((m["ex"], int(m["q"])), []).append(((m["sub"], m["roman"] or ""), p))
    out = []
    for key in sorted(groups, key=lambda k: (tuple(int(x) for x in k[0].split("-")), k[1])):
        ps = [p for _, p in sorted(groups[key], key=lambda kp: kp[0])]
        if len(ps) >= 2:
            out.append(ps)
    return out


def plan(parts: list[Part], rules: tuple[str, ...] = ("R1", "R2", "R3")) -> tuple[dict[str, Carry], list[Unresolved]]:
    """What every part carries and what stays unresolved, over any set of parts (a chapter, a book): they are
    grouped by the exercise and question number in their refs, and a part is only ever helped by the parts
    before it in its own question. Deterministic: the same parts give the same plan. `rules` limits what is
    carried: the lesson packet (S2–S4, before any key exists) carries names only, `("R1",)`."""
    carries: dict[str, Carry] = {}
    unresolved: list[Unresolved] = []
    for ps in _group_parts(parts):
        ends = preamble_end([p.stem for p in ps])
        tail = {p.ref: p.stem[e:].strip() for p, e in zip(ps, ends)}
        H = ps[0].stem[:ends[0]]
        figure = "[figure]" in H
        h_names = names_in(H)
        unknown_h = unknown_points(H)
        defs = {p.ref: definitions(tail[p.ref]) for p in ps}

        for i, P in enumerate(ps):
            earlier = ps[:i]
            own = tail[P.ref]
            sentences: list[str] = []
            swaps: list[tuple[str, str]] = []       # a sentence the packet carried, now with the book's key
            items: list[dict] = []
            notes: list[Unresolved] = []

            def add(rule: str, Q: Part, text: str, **more) -> None:
                if _reveals(P, text):
                    notes.append(Unresolved(P.ref, "would_reveal_key",
                                            f"the {rule} sentence from {Q.ref} would state this part's own answer: {text}",
                                            [_source(Q, tail[Q.ref])]))
                    return
                sentences.append(text)
                items.append({"rule": rule, "from": Q.ref, "text": text, **more})

            if earlier:
                uses = names_in(own) | names_in(P.working)
                bound = set(h_names) | set(point_bound(own)) | {n for d in defs[P.ref] for n in d.names}

                # R1 — an earlier part introduces a name P uses without having it
                wanted: dict[str, tuple[Definition, Part]] = {}
                conflicts: set[str] = set()
                for Q in earlier:
                    for d in defs[Q.ref]:
                        for n in d.names:
                            if n not in uses or n in bound:
                                continue
                            if n not in wanted:
                                wanted[n] = (d, Q)
                            elif wanted[n][0] != d:
                                conflicts.add(n)
                                notes.append(Unresolved(P.ref, "conflict",
                                                        f"{n} is introduced differently by {wanted[n][1].ref} and {Q.ref}",
                                                        [_source(wanted[n][1], tail[wanted[n][1].ref]),
                                                         _source(Q, tail[Q.ref])]))
                done: list[Definition] = []
                for n, (d, Q) in wanted.items():
                    if n in conflicts or d in done:
                        continue
                    done.append(d)
                    val = (Q.key.strip() if Q.keyed and Q.kind == "coordinates" and _one_point(Q.key) and len(d.names) == 1
                           and d.names[0] not in asked_coordinates(own) else None)
                    text = d.with_value(val) if val else d.clause()
                    if val and _reveals(P, text):
                        val, text = None, d.clause()          # the name, not its value
                    add("R1", Q, text, names=list(d.names), **({"with_key": True} if val else {}))
                # the packet (S2–S4) carries the sentence without a value; the assembly adds the book's key to it
                for Q in earlier:
                    for d in defs[Q.ref]:
                        val = (Q.key.strip() if Q.keyed and Q.kind == "coordinates" and _one_point(Q.key)
                               and len(d.names) == 1 and d.names[0] not in asked_coordinates(own) else None)
                        if not val or d.clause() not in P.stem or d.names[0] in {n for n in conflicts}:
                            continue
                        new = d.with_value(val)
                        if _reveals(P, new):
                            continue
                        swaps.append((d.clause(), new))
                        sentences.append(new)
                        items.append({"rule": "R1", "from": Q.ref, "text": new, "names": list(d.names),
                                      "with_key": True, "was": d.clause()})

                # R2 — the preamble's unknowns, solved by an earlier part
                for L, vs in sorted(unknown_h.items() if "R2" in rules else []):
                    if L not in uses or L in concrete_points(own):
                        continue
                    if L in asked_coordinates(own) or any(v in asked_values(own) for v in vs):
                        continue                                  # P solves for it itself
                    for Q in reversed(earlier):
                        t = tail[Q.ref]
                        byc = L in asked_coordinates(t)
                        byv = sorted(v for v in vs if v in asked_values(t))
                        if not (byc or byv):
                            continue
                        symbol = L if byc else byv[0]
                        if _states(own, symbol):
                            break
                        if not Q.keyed:
                            notes.append(Unresolved(P.ref, "no_key",
                                                    f"uses {L}, which {Q.ref} works out, but {Q.ref} is {Q.fate} with no "
                                                    "key to carry", [_source(Q, t)]))
                        elif byc and Q.kind == "coordinates" and _one_point(Q.key):
                            add("R2", Q, f"${L}={Q.key.strip()}$.", names=[L])
                        elif byv and Q.kind in (None, "expression") and _scalar(Q.key):
                            add("R2", Q, f"${byv[0]}={Q.key.strip()}$.", names=[L], variable=byv[0])
                        else:
                            notes.append(Unresolved(P.ref, "no_key",
                                                    f"uses {L}, which {Q.ref} works out, but its key is not one value "
                                                    f"this module can restate ({Q.key})", [_source(Q, t)]))
                        break

                # R3 — a gradient the worked answer uses and never computes
                for xy in (gradients_used_not_computed(P.working) if "R3" in rules else []):
                    if _states_gradient(own, xy):
                        continue
                    src = next((Q for Q in reversed(earlier)
                                if {xy, xy[::-1]} & asked_gradients(tail[Q.ref])), None)
                    if src is None:
                        notes.append(Unresolved(P.ref, "no_source",
                                                f"its worked answer uses the gradient m_{{{xy}}} without working it out, and "
                                                "no earlier part asks for it", [_source(Q, tail[Q.ref]) for Q in earlier]))
                    elif not (src.keyed and src.kind in (None, "expression") and _scalar(src.key)):
                        notes.append(Unresolved(P.ref, "no_key",
                                                f"uses m_{{{xy}}}, which {src.ref} works out, but {src.ref} is {src.fate} "
                                                "with no key to carry", [_source(src, tail[src.ref])]))
                    else:
                        add("R3", src, f"$m_{{{xy}}}={src.key.strip()}$.", symbol=f"m_{{{xy}}}")

            # what words alone point back to, and a point nothing gives
            hits = referential(own, P.working)
            if hits:
                said = "says " + "; ".join(sorted({h.lower() for h in hits}))
                if sentences:
                    said += f" (partly carried: {', '.join(sorted({it['rule'] for it in items}))} — check the words still point at it)"
                notes.append(Unresolved(P.ref, "refers_by_words", said, [_source(Q, tail[Q.ref]) for Q in earlier]))
            elif earlier and not figure:
                mention = {n for Q in earlier for n in names_in(tail[Q.ref])}
                taken = {m for it in items for m in it.get("names", [])} | {n for Q in earlier for d in defs[Q.ref] for n in d.names}
                free = sorted(n for n in names_in(own) if n not in bound and n in mention and n not in taken)
                if free:
                    notes.append(Unresolved(P.ref, "not_extractable",
                                            f"its words use {', '.join(free)}, which an earlier part mentions but no "
                                            "definition could be read from", [_source(Q, tail[Q.ref]) for Q in earlier]))
            unresolved.extend(notes)

            if sentences:
                stem = P.stem
                for old_s, new_s in swaps:
                    stem = stem.replace(old_s, new_s, 1)
                inserted = [x for x in sentences if x not in {n for _, n in swaps}]
                end = ends[i]
                after = " ".join(x for x in (stem[:end].strip(), " ".join(inserted), stem[end:].strip()) if x)
                carries[P.ref] = Carry(P.ref, sentences, items, P.stem, after)

    # an item that is no part at all (a whole question) can still point back by words
    for p in parts:
        m = _ANY_REF.match(p.ref)
        if m and not m["sub"]:
            hits = referential(p.stem, p.working)
            if hits:
                unresolved.append(Unresolved(p.ref, "refers_by_words", "says " + "; ".join(sorted({h.lower() for h in hits})), []))
    unresolved.sort(key=lambda u: (u.ref, u.reason))
    return carries, unresolved


# ------------------------------------------------------------------------------- from a lesson run
def part_of(item) -> Part:
    """A `RunItem` (assemble_lesson_bundle.py) or the same fields as a dict, as a Part."""
    get = (lambda k: item.get(k)) if isinstance(item, dict) else (lambda k: getattr(item, k, None))
    ref = get("ref")
    fate_fn = getattr(item, "fate", None)
    if callable(fate_fn):
        fate = fate_fn()
    else:
        g2 = get("g2") or {}
        v = g2.get("verdict") if isinstance(g2, dict) else None
        if v == "exclude":
            fate = "excluded"
        elif get("answer_type") == "not_markable":
            fate = "teaching"
        elif v in ("accept", "fix") or (get("verification") == "agreed" and not g2):
            fate = "verified"
        else:
            fate = "held"
    marker = get("marker") or {}
    atype = get("answer_type")
    if atype == "expression":
        key, kind = (marker.get("key") or None), marker.get("kind")
    elif atype == "numeric":
        key, kind = (get("answer") or None), None
    else:
        key, kind = None, None
    working = " ".join(get("solution") or [])
    return Part(ref=ref, stem=get("stem") or "", working=working, fate=fate, kind=kind, key=key)


def plan_items(items) -> tuple[dict[str, Carry], list[Unresolved]]:
    return plan([part_of(it) for it in items])


# --------------------------------------------------------------------------------------------- the CLI
def main(argv: list[str] | None = None) -> int:
    """The plan for a book's saved lesson runs — what the assembly will do, before it does it (stems are the runs'
    own, not yet through the assembly's notation pass)."""
    import book_config
    from assemble_lesson_bundle import LessonRun
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--book", required=True)
    ap.add_argument("--chapter", type=int, help="only this chapter's exercises")
    ap.add_argument("--runs", type=Path, help="default runs/<book>/lesson/")
    ap.add_argument("--json", action="store_true", help="print the plan as JSON")
    ap.add_argument("--out", type=Path, help="write the plan (JSON) here: the list for the review backlog")
    a = ap.parse_args(argv)
    book = book_config.load_book(a.book)
    runs = a.runs or HERE / "runs" / book.book / "lesson"
    items, slug_of = [], {}
    for f in sorted(runs.glob("*.json")):
        run = LessonRun.model_validate_json(f.read_text())
        for it in run.items:
            if a.chapter is None or it.ref.startswith(f"Ex{a.chapter}-"):
                items.append(it)
                slug_of[it.ref] = run.lesson
    carries, unresolved = plan_items(items)
    emitted = {it.ref for it in items if it.fate() != "excluded"}       # an excluded item is no question: never shown
    doc = {"book": book.book, "chapter": a.chapter,
           "carried": [{"ref": r, "lesson": slug_of.get(r), "rules": sorted({i["rule"] for i in c.items}),
                        "from": sorted({i["from"] for i in c.items}), "sentences": c.sentences,
                        "before": c.before, "after": c.after} for r, c in sorted(carries.items()) if r in emitted],
           "unresolved": [{**u.as_dict(), "lesson": slug_of.get(u.ref)} for u in unresolved if u.ref in emitted]}
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    if a.json:
        print(json.dumps(doc, indent=2, ensure_ascii=False))
        return 0
    print(f"{len(doc['carried'])} part(s) carry what they depend on; "
          f"{len({u['ref'] for u in doc['unresolved']})} part(s) unresolved")
    for x in doc["carried"]:
        print(f"\n{x['ref']}  [{', '.join(x['rules'])} from {', '.join(x['from'])}]")
        print(f"  before: {x['before']}")
        print(f"  after:  {x['after']}")
    print("\nUNRESOLVED (for the review backlog)")
    for u in doc["unresolved"]:
        print(f"  {u['ref']}  {u['reason']}: {u['detail']}")
    if a.out:
        print(f"\nwrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

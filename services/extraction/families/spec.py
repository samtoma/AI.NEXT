"""Load, check and instantiate declarative family specs (decision 16, FR-4304).

The format is described in :mod:`families`. This module enforces it. Every rule
below exists because the family's instances reach a student unreviewed except
for a sample (ADR-0008, ADR-0019), so a defect has to be caught here or by the
blind grader, not by a child:

* **one objective, one parent.** The id names the objective (``tpl:<lo tail>:…``)
  and the parent book question must be a question of that objective
  (``q:<lo tail>:…``), so a rejected family traces to its book item (FR-1101).
* **distractors name a misconception of the same objective** (``mc:<lo tail>:…``),
  the rule the loader enforces (FR-1106) moved to where the spec is written.
* **the answer is computed**, by the same evaluator from the same parameters as
  the stem. A numeric answer is a whole number or a string the spec formatted
  itself; a Fraction or a float is refused, because how many decimals a key
  carries is a decision, not an accident.
* **a word problem's context is fixed**: when ``context`` is set, every hole in
  the stem must produce a number, so only the numbers vary (§3.9).
* **nothing unknown**: an unrecognised key is an error, never ignored. A typo
  such as ``"distracters"`` would otherwise ship an item with no wrong options.
* **deterministic**: parameters are drawn in declared order from the family's own
  seeded stream; the same spec, seed and count give byte-identical items.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Any

from . import FORMAT
from . import evaluator as E

TIERS = ("basic", "standard", "advanced")
ANSWER_TYPES = ("numeric", "mcq", "expression")
KINDS = ("family", "authored")
MARKER_KINDS = ("expression", "equation", "values", "interval", "coordinates", "surd", "recurring")
NUMERIC_MARKER_KINDS = ("values", "interval", "coordinates", "recurring")   # schemas.NUMERIC_MARKER_KINDS
FORMS = (None, "factorised", "expanded", "simplest", "decimal")   # the app's FORM_NAMES (answer-marker.ts)
DRAWS = ("randint", "choice", "sample", "shuffle", "let")
TOP_KEYS = {
    "format", "id", "kind", "lo_id", "parent_question_id", "source_page", "tier", "answer_type",
    "context", "params", "constraints", "stem", "answer", "solution", "choices", "marker",
    "proposed_misconceptions", "notes", "version",
}
FAMILY_ID_RE = re.compile(r"^tpl:([a-z0-9-]+):([a-z0-9][a-z0-9-]*)$")
LO_RE = re.compile(r"^lo:([a-z0-9-]+)$")
QID_RE = re.compile(r"^q:([a-z0-9-]+):[A-Za-z0-9._-]+$")
MC_RE = re.compile(r"^mc:([a-z0-9-]+):[a-z0-9][a-z0-9-]*$")
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
# The formatting calls whose output is a number however it is dressed.
NUMERIC_FORMATTERS = {"num", "fixed", "frac", "pair", "setof", "paren", "signed"}
RESAMPLE_LIMIT = 1000


class SpecError(ValueError):
    def __init__(self, where: str, problems: list[str]):
        super().__init__(f"{where}: " + "; ".join(problems))
        self.where = where
        self.problems = problems


def _canonical(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()


@dataclass
class FamilySpec:
    raw: dict
    path: Path | None = None
    sha: str = ""
    problems: list[str] = field(default_factory=list)

    # convenient views over the raw spec
    @property
    def id(self) -> str:
        return self.raw["id"]

    @property
    def lo_id(self) -> str:
        return self.raw["lo_id"]

    @property
    def lo_tail(self) -> str:
        return self.raw["lo_id"].removeprefix("lo:")

    @property
    def kind(self) -> str:
        return self.raw.get("kind", "family")

    @property
    def parent(self) -> str:
        return self.raw["parent_question_id"]

    @property
    def page(self) -> int | None:
        return self.raw.get("source_page")

    @property
    def tier(self) -> str:
        return self.raw["tier"]

    @property
    def answer_type(self) -> str:
        return self.raw["answer_type"]

    @property
    def slug(self) -> str:
        return self.raw["id"].split(":")[-1]

    def misconception_ids(self) -> list[str]:
        out = []
        for d in (self.raw.get("choices") or {}).get("distractors") or []:
            if isinstance(d, dict) and d.get("misconception_id"):
                out.append(d["misconception_id"])
        return out


# ---------------------------------------------------------------- checking
def _check_expr(src: Any, where: str, problems: list[str]) -> None:
    if not isinstance(src, str):
        problems.append(f"{where}: an expression must be a string, got {type(src).__name__}")
        return
    try:
        E.parse(src)
    except E.EvalError as e:
        problems.append(f"{where}: {e}")


def _check_template(tpl: Any, where: str, problems: list[str]) -> None:
    if not isinstance(tpl, str) or not tpl.strip():
        problems.append(f"{where}: a template must be a non-empty string")
        return
    try:
        for src in E.holes(tpl):
            _check_expr(src, f"{where} hole {{={src}}}", problems)
    except E.EvalError as e:
        problems.append(f"{where}: {e}")
    if tpl.count("$") % 2:
        problems.append(f"{where}: unbalanced $ delimiters")


def _check_value_or_expr(v: Any, where: str, problems: list[str]) -> None:
    """A draw's source: a JSON list of literal values, or an expression string."""
    if isinstance(v, list):
        if not v:
            problems.append(f"{where}: an empty list")
    elif isinstance(v, str):
        _check_expr(v, where, problems)
    else:
        problems.append(f"{where}: a list of values or an expression string")


def check_spec(raw: Any, where: str = "<spec>") -> list[str]:
    """Every structural problem with one spec, as sentences. Empty means well-formed."""
    p: list[str] = []
    if not isinstance(raw, dict):
        return [f"{where}: a spec is a JSON object"]
    unknown = set(raw) - TOP_KEYS
    if unknown:
        p.append(f"unknown key(s) {sorted(unknown)} — allowed: {sorted(TOP_KEYS)}")
    if raw.get("format") != FORMAT:
        p.append(f"format must be {FORMAT!r}")
    kind = raw.get("kind", "family")
    if kind not in KINDS:
        p.append(f"kind must be one of {KINDS}")

    lo_m = LO_RE.match(str(raw.get("lo_id", "")))
    if not lo_m:
        p.append("lo_id must look like lo:<objective>")
    lo_tail = lo_m.group(1) if lo_m else None

    id_m = FAMILY_ID_RE.match(str(raw.get("id", "")))
    if not id_m:
        p.append("id must look like tpl:<objective tail>:<slug> (lower case, digits, hyphens)")
    elif lo_tail and id_m.group(1) != lo_tail:
        p.append(f"id {raw['id']!r} does not name its objective {raw.get('lo_id')!r}")

    parent = raw.get("parent_question_id")
    q_m = QID_RE.match(str(parent or ""))
    if not q_m:
        p.append("parent_question_id is required and must look like q:<objective tail>:<n> (FR-1101)")
    elif lo_tail and q_m.group(1) != lo_tail:
        p.append(f"parent {parent!r} is not a question of {raw.get('lo_id')!r}: a family derives from "
                 "a book question of its own objective")

    if raw.get("source_page") is not None and (not isinstance(raw["source_page"], int)
                                               or isinstance(raw["source_page"], bool)):
        p.append("source_page must be a whole number or null")
    if raw.get("tier") not in TIERS:
        p.append(f"tier must be one of {TIERS}")
    at = raw.get("answer_type")
    if at not in ANSWER_TYPES:
        p.append(f"answer_type must be one of {ANSWER_TYPES}")
    if raw.get("context") is not None and not (isinstance(raw["context"], str) and raw["context"].strip()):
        p.append("context, when present, is the word problem's fixed situation in words")
    if raw.get("version") is not None and (not isinstance(raw["version"], int) or raw["version"] < 1):
        p.append("version, when present, is a whole number >= 1")

    # ---- params
    names: set[str] = set()
    params = raw.get("params", [])
    if not isinstance(params, list):
        p.append("params must be a list")
        params = []
    for i, prm in enumerate(params):
        w = f"params[{i}]"
        if not isinstance(prm, dict):
            p.append(f"{w}: must be an object")
            continue
        if "require" in prm:
            if set(prm) - {"require", "why"}:
                p.append(f"{w}: a require step carries only 'require' (and 'why')")
            _check_expr(prm["require"], f"{w}.require", p)
            continue
        name = prm.get("name")
        if not isinstance(name, str) or not NAME_RE.match(name):
            p.append(f"{w}: name must be a letter followed by letters, digits or _")
        elif name in names:
            p.append(f"{w}: {name!r} is defined twice")
        elif name in E.FUNCTIONS or name in E.CONSTANTS:
            p.append(f"{w}: {name!r} would hide a built-in")
        else:
            names.add(name)
        draws = [k for k in DRAWS if k in prm]
        extra = set(prm) - set(DRAWS) - {"name", "resample_while", "why"}
        if len(draws) != 1:
            p.append(f"{w}: exactly one of {DRAWS}")
        if extra:
            p.append(f"{w}: unknown key(s) {sorted(extra)}")
        if kind == "authored" and any(d != "let" for d in draws):
            p.append(f"{w}: an authored one-off samples nothing (only 'let' is allowed)")
        for d in draws:
            v = prm[d]
            if d == "let":
                _check_expr(v, f"{w}.let", p)
            elif d == "randint":
                if not (isinstance(v, list) and len(v) == 2):
                    p.append(f"{w}.randint: [low, high]")
                else:
                    for b in v:
                        if isinstance(b, str):
                            _check_expr(b, f"{w}.randint bound", p)
                        elif not isinstance(b, int) or isinstance(b, bool):
                            p.append(f"{w}.randint: bounds are whole numbers or expressions")
            elif d in ("choice", "shuffle"):
                _check_value_or_expr(v, f"{w}.{d}", p)
            elif d == "sample":
                if not (isinstance(v, dict) and set(v) == {"from", "k"}):
                    p.append(f"{w}.sample: {{'from': list|expression, 'k': n|expression}}")
                else:
                    _check_value_or_expr(v["from"], f"{w}.sample.from", p)
                    if isinstance(v["k"], str):
                        _check_expr(v["k"], f"{w}.sample.k", p)
                    elif not isinstance(v["k"], int) or isinstance(v["k"], bool):
                        p.append(f"{w}.sample.k: a whole number or an expression")
        if "resample_while" in prm:
            if not draws or draws[0] not in ("randint", "choice"):
                p.append(f"{w}: resample_while applies to randint or choice only")
            _check_expr(prm["resample_while"], f"{w}.resample_while", p)

    constraints = raw.get("constraints", [])
    if not isinstance(constraints, list):
        p.append("constraints must be a list of expressions")
    else:
        for i, c in enumerate(constraints):
            _check_expr(c, f"constraints[{i}]", p)

    # ---- the question
    _check_template(raw.get("stem"), "stem", p)
    sol = raw.get("solution")
    if not isinstance(sol, list) or not sol:
        p.append("solution must be a non-empty list of step templates")
    else:
        for i, s in enumerate(sol):
            _check_template(s, f"solution[{i}]", p)

    choices, marker = raw.get("choices"), raw.get("marker")
    if at == "numeric":
        if "answer" not in raw:
            p.append("a numeric family needs an 'answer' expression")
        else:
            _check_expr(raw["answer"], "answer", p)
        if choices is not None or marker is not None:
            p.append("a numeric family has no choices and no marker")
    elif at == "mcq":
        if "answer" in raw or marker is not None:
            p.append("an mcq family's answer is choices.correct; it has no 'answer' and no marker")
        _check_choices(choices, lo_tail, p)
    elif at == "expression":
        if "answer" in raw or choices is not None:
            p.append("an expression family's answer is marker.answer; it has no 'answer' and no choices")
        _check_marker(marker, p)

    proposed = raw.get("proposed_misconceptions")
    if proposed is not None and not isinstance(proposed, list):
        p.append("proposed_misconceptions must be a list")
        proposed = []
    for entry in proposed or []:
        # An id S5 has not written yet, with the author's reading of the error,
        # which S5's final pass attaches or authors (one error, one entry).
        if isinstance(entry, dict):
            if set(entry) != {"id", "label", "description"} or not all(isinstance(v, str) and v.strip()
                                                                       for v in entry.values()):
                p.append("a proposed misconception is {id, label, description}")
                continue
            mid = entry["id"]
        else:
            mid = entry
        m = MC_RE.match(str(mid))
        if not m or (lo_tail and m.group(1) != lo_tail):
            p.append(f"proposed misconception {mid!r} must be mc:{lo_tail}:<slug>")
    return p


def _check_choices(choices: Any, lo_tail: str | None, p: list[str]) -> None:
    if not isinstance(choices, dict) or set(choices) - {"correct", "distractors"}:
        p.append("choices must be {'correct': template, 'distractors': [...]}")
        return
    _check_template(choices.get("correct"), "choices.correct", p)
    ds = choices.get("distractors")
    if not isinstance(ds, list) or not ds:
        p.append("choices.distractors must be a non-empty list")
        return
    static = 0
    for i, d in enumerate(ds):
        w = f"choices.distractors[{i}]"
        if not isinstance(d, dict):
            p.append(f"{w}: must be an object")
            continue
        extra = set(d) - {"text", "misconception_id", "each", "as"}
        if extra:
            p.append(f"{w}: unknown key(s) {sorted(extra)}")
        _check_template(d.get("text"), f"{w}.text", p)
        if "each" in d:
            _check_expr(d["each"], f"{w}.each", p)
            if not isinstance(d.get("as"), str) or not NAME_RE.match(d["as"]):
                p.append(f"{w}: 'each' needs 'as', the name each item is bound to")
        else:
            static += 1
            if "as" in d:
                p.append(f"{w}: 'as' only goes with 'each'")
        mid = d.get("misconception_id")
        if mid is not None:
            m = MC_RE.match(str(mid))
            if not m:
                p.append(f"{w}: misconception_id {mid!r} must look like mc:<objective tail>:<slug>")
            elif lo_tail and m.group(1) != lo_tail:
                p.append(f"{w}: misconception {mid!r} belongs to another objective; a distractor names "
                         f"an error of its own objective (mc:{lo_tail}:…, FR-1106)")
    if static < 3 and not any(isinstance(d, dict) and "each" in d for d in ds):
        p.append("an mcq needs at least three distractors (four options)")


def _check_marker(marker: Any, p: list[str]) -> None:
    if not isinstance(marker, dict):
        p.append("an expression family needs marker: {kind, answer, form, variables, tolerance}")
        return
    extra = set(marker) - {"kind", "answer", "form", "variables", "tolerance"}
    if extra:
        p.append(f"marker: unknown key(s) {sorted(extra)}")
    if marker.get("kind") not in MARKER_KINDS:
        p.append(f"marker.kind must be one of {MARKER_KINDS} (contracts/answer-marker.md)")
    _check_template(marker.get("answer"), "marker.answer", p)
    form = marker.get("form")
    if isinstance(form, dict):
        if set(form) != {"subject"} or not re.fullmatch(r"[a-zA-Z]", str(form.get("subject"))):
            p.append("marker.form as an object is {'subject': '<one letter>'}")
    elif form not in FORMS:
        p.append(f"marker.form must be one of {FORMS} or {{'subject': 'x'}}")
    vs = marker.get("variables", [])
    if not isinstance(vs, list) or not all(isinstance(v, str) and re.fullmatch(r"[a-zA-Z]", v) for v in vs):
        p.append("marker.variables is a list of single letters")
    if isinstance(form, dict) and form.get("subject") not in (vs or []):
        p.append("marker.form.subject must be one of marker.variables")
    if isinstance(form, dict) and marker.get("kind") != "equation":
        p.append("a subject form needs kind 'equation' (the app's readMarkerSpec refuses any other)")
    # The coherence rules of schemas.AnswerSpec, so a spec fails at --check, not at build.
    tol = marker.get("tolerance")
    if tol is not None:
        if not (isinstance(tol, dict) and set(tol) == {"abs"} and isinstance(tol["abs"], (int, float))
                and not isinstance(tol["abs"], bool) and tol["abs"] > 0):
            p.append("marker.tolerance is null or {'abs': a number > 0}")
        if marker.get("kind") not in NUMERIC_MARKER_KINDS:
            p.append(f"marker kind {marker.get('kind')!r} is exact; a tolerance belongs only to "
                     f"{sorted(NUMERIC_MARKER_KINDS)}")
    if (isinstance(form, dict) or form in ("factorised", "expanded")) and \
            marker.get("kind") not in ("expression", "equation"):
        p.append(f"form {form!r} applies to an expression or an equation, not to kind {marker.get('kind')!r}")


def load_spec(raw: Any, path: Path | None = None) -> FamilySpec:
    where = str(path) if path else str(raw.get("id") if isinstance(raw, dict) else "<spec>")
    problems = check_spec(raw, where)
    if problems:
        raise SpecError(where, problems)
    return FamilySpec(raw=raw, path=path, sha=hashlib.sha256(_canonical(raw)).hexdigest())


def load_dir(directory: Path) -> tuple[list[FamilySpec], list[str]]:
    """Every ``*.json`` directly in ``directory`` (``_``-prefixed files skipped).

    Returns the specs that are well-formed and the problems of those that are
    not. Specs load in file-name order so a run is reproducible.
    """
    directory = Path(directory)
    if not directory.is_dir():
        raise SystemExit(f"--families {directory}: not a directory")
    specs: list[FamilySpec] = []
    problems: list[str] = []
    seen: dict[str, Path] = {}
    for path in sorted(directory.glob("*.json")):
        if path.name.startswith("_"):
            continue
        try:
            raw = json.loads(path.read_text())
        except json.JSONDecodeError as e:
            problems.append(f"{path.name}: not JSON ({e})")
            continue
        try:
            spec = load_spec(raw, path)
        except SpecError as e:
            problems.extend(f"{path.name}: {x}" for x in e.problems)
            continue
        if spec.id in seen:
            problems.append(f"{path.name}: family {spec.id} is also defined in {seen[spec.id].name}")
            continue
        seen[spec.id] = path
        specs.append(spec)
    # two families on one objective must not mint the same item ids
    prefixes: dict[tuple[str, str], str] = {}
    for s in specs:
        key = (s.lo_tail, ("a" if s.kind == "authored" else "g") + s.slug[:6])
        if key in prefixes:
            problems.append(f"{s.id} and {prefixes[key]} share an objective and the first six letters "
                            "of their slug, so their item ids would collide; rename one")
        prefixes[key] = s.id
    return specs, problems


# ---------------------------------------------------------------- instantiation
class Rejected(Exception):
    """This attempt produced no item (a constraint or a require failed)."""


def _value(v: Any, env: dict) -> Any:
    return E.evaluate(v, env) if isinstance(v, str) else v


def _int_bound(b: Any, env: dict) -> int:
    v = _value(b, env)
    if isinstance(v, Fraction) and v.denominator == 1:
        v = int(v)
    if not isinstance(v, int) or isinstance(v, bool):
        raise E.EvalError(f"randint bound {b!r} is not a whole number")
    return v


def _seq(v: Any, env: dict, what: str) -> list:
    seq = _value(v, env)
    if isinstance(seq, tuple):
        seq = list(seq)
    if not isinstance(seq, list) or not seq:
        raise E.EvalError(f"{what} needs a non-empty list")
    return seq


def _draw(prm: dict, env: dict, rng: random.Random) -> Any:
    if "randint" in prm:
        lo, hi = (_int_bound(b, env) for b in prm["randint"])
        if lo > hi:
            raise Rejected()
        return rng.randint(lo, hi)
    if "choice" in prm:
        return rng.choice(_seq(prm["choice"], env, "choice"))
    if "sample" in prm:
        pop = _seq(prm["sample"]["from"], env, "sample.from")
        k = _int_bound(prm["sample"]["k"], env)
        if not 0 <= k <= len(pop):
            raise Rejected()
        return rng.sample(pop, k)
    if "shuffle" in prm:
        items = list(_seq(prm["shuffle"], env, "shuffle"))
        rng.shuffle(items)
        return items
    return E.evaluate(prm["let"], env)


def sample_params(spec: FamilySpec, rng: random.Random) -> dict | None:
    """Draw the parameters in declared order, or None if this attempt is rejected."""
    env: dict = {}
    try:
        for prm in spec.raw.get("params", []):
            if "require" in prm:
                if not E.evaluate(prm["require"], env):
                    return None
                continue
            name = prm["name"]
            env[name] = _draw(prm, env, rng)
            if "resample_while" in prm:
                tries = 0
                while E.evaluate(prm["resample_while"], env):
                    tries += 1
                    if tries > RESAMPLE_LIMIT:
                        return None
                    env[name] = _draw(prm, env, rng)
        for c in spec.raw.get("constraints", []):
            if not E.evaluate(c, env):
                return None
    except Rejected:
        return None
    return env


def _stem_holes_are_numbers(spec: FamilySpec, env: dict) -> None:
    """Word problems: the context is fixed, only numbers vary (§3.9)."""
    for src in E.holes(spec.raw["stem"]):
        tree = E.parse(src).body
        if isinstance(tree, E.ast.Call) and tree.func.id in NUMERIC_FORMATTERS:
            continue
        v = E.evaluate(src, env)
        if isinstance(v, bool) or not E._is_num(v):
            raise E.EvalError(f"{spec.id}: the stem hole {{={src}}} produced {v!r}; a family with a "
                              "fixed context may vary only numbers")


def numeric_answer(v: Any, fid: str) -> str:
    G = E._fmt()
    if isinstance(v, bool):
        raise E.EvalError(f"{fid}: the answer is true/false")
    if isinstance(v, int):
        return G.num(v)
    if isinstance(v, Fraction) and v.denominator == 1:
        return G.num(v.numerator)
    if isinstance(v, str):
        try:
            float(v)
        except ValueError:
            raise E.EvalError(f"{fid}: the numeric answer {v!r} is not a number") from None
        return v
    raise E.EvalError(f"{fid}: the answer is a {type(v).__name__} ({v}); format a non-whole answer "
                      "explicitly, e.g. fixed(x, 2) — how many decimals a key carries is a decision")


def marker_key(kind: str, plain: str, variables: list[str]) -> str:
    """The marker's canonical LaTeX key, printed from the same tree the grader is checked against."""
    tree = E.parse_plain(plain, variables)
    if kind == "recurring":
        v = E.eval_plain(tree, {})
        if isinstance(v, int):
            v = Fraction(v)
        if not isinstance(v, Fraction):
            raise E.EvalError("a recurring answer must be an exact fraction, e.g. 7/9")
        return E.recurring_latex(v)
    if kind == "values":
        body = tree.body if isinstance(tree, E.ast.Expression) else tree
        items = body.elts if isinstance(body, (E.ast.Tuple, E.ast.List)) else [body]
        parts = [E.to_latex(i) for i in items]
        if len(variables) == 1:
            return r" \text{ or } ".join(f"{variables[0]} = {x}" for x in parts)
        return ",\\ ".join(parts)
    return E.to_latex(tree)


def build_item(spec: FamilySpec, rng: random.Random):
    """One instance of ``spec`` as a generate_questions.Item, or None if this attempt is rejected.

    Consumes the stream exactly as a hand-written family with the same draws
    would: params in order, then (for an mcq) the option shuffle.
    """
    G = E._fmt()
    env = sample_params(spec, rng)
    if env is None:
        return None
    raw = spec.raw
    if raw.get("context"):
        _stem_holes_are_numbers(spec, env)
    stem = E.render(raw["stem"], env)
    steps = [G.step(i, E.render(t, env)) for i, t in enumerate(raw["solution"], 1)]
    common = dict(lo_id=spec.lo_id, tier=spec.tier, canonical_solution=steps,
                  parent_question_id=spec.parent, source_page=spec.page, family=spec.id)
    at = spec.answer_type
    if at == "numeric":
        return G.Item(question_type="numeric", stem=stem,
                      correct_answer=numeric_answer(E.evaluate(raw["answer"], env), spec.id), **common)
    if at == "mcq":
        ch = raw["choices"]
        correct = E.render(ch["correct"], env)
        wrong: list[tuple[str, str | None]] = []
        for d in ch["distractors"]:
            if "each" in d:
                for item in _seq(d["each"], env, "each"):
                    wrong.append((E.render(d["text"], {**env, d["as"]: item}), d.get("misconception_id")))
            else:
                wrong.append((E.render(d["text"], env), d.get("misconception_id")))
        built = G.mcq(correct, wrong, rng)
        if not built:
            return None
        choices, key = built
        return G.Item(question_type="mcq", stem=stem, correct_answer=key, choices=choices, **common)
    m = raw["marker"]
    plain = E.render(m["answer"], env)
    variables = list(m.get("variables") or [])
    key = marker_key(m["kind"], plain, variables)
    item = G.Item(question_type="short", stem=stem, correct_answer=key, **common)
    item.choices = {"marker": {"kind": m["kind"], "key": key, "form": m.get("form"),
                               "variables": variables, "tolerance": m.get("tolerance")}}
    item.answer_check = plain  # the plain form the blind grader is compared against
    return item


def to_question(item, qid: str, spec: FamilySpec) -> dict:
    """The bundle row: the legacy shape, plus the family as a FIELD (§3.9)."""
    q = item.as_question(qid)
    if spec.kind == "authored":
        q["source_note"] = (f"Authored one-off {spec.id} (S6): no family could be written without "
                            "nonsense; blind re-solved.")
        q["family"] = None
        q["authored"] = True
    else:
        q["family"] = spec.id
    q["family_spec_sha"] = spec.sha
    if getattr(item, "answer_check", None) is not None:
        q["answer_check"] = item.answer_check
    return q


def as_family(spec: FamilySpec):
    """Adapt a spec to the driver's Family record, so both kinds share one loop."""
    G = E._fmt()
    return G.Family(spec.id, spec.lo_id, spec.parent, spec.page, lambda rng: build_item(spec, rng))


def item_id(spec: FamilySpec, n: int) -> str:
    """``q:<lo tail>:g001-<slug6>`` as the hand-written families mint, ``a001`` for a one-off."""
    return f"q:{spec.lo_tail}:{'a' if spec.kind == 'authored' else 'g'}{n:03d}-{spec.slug[:6]}"

"""Generate answers for book prompts the book leaves unanswered, for a person to review (Generated answers).

    uv run --with pymupdf answer_gen.py plan groundtruth/prep3-math-en/unit1/lesson-1-1.json
    uv run --with pymupdf answer_gen.py run  groundtruth/prep3-math-en/unit1/lesson-1-1.json [--cap 5] [--model sonnet]
                                             [--only u1-1:drill-1:B …] [--force]

Run from services/extraction/. Reads one lesson's book record (ground truth or the pipeline's extraction) and finds
every exercise, activity, open prompt or worked-example part with no printed answer. For each it:

  1. AUTHOR   one model call per lesson writes the answer and the worked steps a student is taught, using ONLY the
              lesson's own definitions, rules, conventions and worked examples (cited by id in `grounded_in`);
  2. RE-SOLVE a second call, which never sees the first, gives its own final answer;
  3. CHECKS   with no model: the two answers are compared (as numbers, assignments, ordered pairs or text), and
              every numeric "=" in the steps is evaluated by the step checker's free pre-check (working_check.py).

Parts that need the printed figure (reading points off a grid) are sent in their own pair of calls, with the page
image. A drawing or an explanation cannot be checked by machine and goes straight to a person.

Writes the teaching layer, never the book record: teaching/<book>/answers/<lesson slug>.json
(format `ainext.generated-answers/1`), one entry per part, keyed by the book-record id (`u1-1:drill-1:B`). Nothing
here reaches a student: an answer is taught only once a person approves it in the review tool's Generated answers
task. Re-running skips parts whose question has not changed (`--force` redoes them).

COST. Every call runs the `claude` CLI on the developer's own sign-in, with a minimal system prompt and no tools
(the page images are read with the Read tool only in the figure calls). `--cap` (USD, default 5) stops the run
before it can spend more; each call also passes the remaining cap to the CLI as `--max-budget-usd`.

GROUNDING, NOT SOLVING FROM SCRATCH. Project rule 3 says the tutor teaches from stored solutions a human has
reviewed. These answers are stored, grounded in the lesson, checked twice, and wait for a person's approval; until
Samuel rules on it (docs/design/review-console.md) none of them is loaded for students.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
import working_check as WC  # noqa: E402  (the free numeric pre-check; standard library only)

FORMAT = "ainext.generated-answers/1"
PROMPT_VERSION = "ans-v3"  # v3: the author, re-solve and judge prompts are runbook/answers.workflow.js
PROMPTS = ("exercise", "activity", "open_prompt", "worked_example")
STATEMENTS = ("definition", "rule", "caution", "convention", "method")
NEEDS_PAGE = re.compile(r"\b(figures?|nets?|graphs?|diagrams?|grids?|tables?|shown|opposite|pictures?|previous|following|above|below)\b", re.I)

# ANSWER_RULES: in runbook/answers.workflow.js since ans-v3 (one copy of every prompt)

# AUTHOR_SYSTEM: in runbook/answers.workflow.js since ans-v3 (one copy of every prompt)

# RESOLVE_SYSTEM: in runbook/answers.workflow.js since ans-v3 (one copy of every prompt)

# AUTHOR_SCHEMA: in runbook/answers.workflow.js since ans-v3
# JUDGE_SYSTEM: in runbook/answers.workflow.js since ans-v3 (one copy of every prompt)

# JUDGE_SCHEMA: in runbook/answers.workflow.js since ans-v3

# RESOLVE_SCHEMA: in runbook/answers.workflow.js since ans-v3


# ============================================================================ what needs an answer
def book_of(path: Path) -> str:
    rel = path.resolve().relative_to(HERE)
    if rel.parts[0] in ("groundtruth", "book-records"):
        return rel.parts[1]
    raise SystemExit(f"{path}: not under groundtruth/<book>/ or book-records/<book>/")


# A misprint is recorded as the page shows it ("X × Z"); the record keeps maths as LaTeX ("$X \\times Z$"). Matched
# exactly, 26 of Prep 3's 36 never applied and the tutor and the answer generator read the printed mistake (found
# 2026-10-29 on pp3u1-2:think-1). So: exact first, else the same characters with the notation and spacing allowed to
# differ, and the intended text written back in the notation the match used.
_FLEX = {"×": r"(?:×|\\times(?![A-Za-z])\s*)", "∠": r"(?:∠|\\angle(?![A-Za-z])\s*)", "∈": r"(?:∈|\\in(?![A-Za-z])\s*)",
         "≠": r"(?:≠|\\neq?(?![A-Za-z])\s*)", "{": r"(?:\\\{|\{)", "}": r"(?:\\\}|\})", "-": r"(?:-|−)", "−": r"(?:-|−)",
         "°": r"(?:°|\^\s*\\circ|\^\{\\circ\})", "√": r"(?:√|\\sqrt(?![A-Za-z]))"}
_TO_TEX = {"×": "\\times ", "∠": "\\angle ", "∈": "\\in ", "≠": "\\neq ", "°": "^\\circ", "√": "\\sqrt"}


def _flex_pattern(printed: str) -> str:
    out = []
    for ch in printed:
        if ch.isspace():
            continue
        out.append(_FLEX.get(ch, re.escape(ch)))
    return r"[\s,]*".join(out)   # "SHIFT sin 0,5…" is "SHIFT, sin, 0,5…" in the record


def _replace_misprint(value: str, printed: str, intended: str) -> str | None:
    """`value` with the misprint corrected, or None when the printed text is not in it."""
    if printed in value:
        return value.replace(printed, intended)
    if len(printed.strip()) < 3:
        return None
    m = re.search(_flex_pattern(printed), value)
    if not m or "$" in m.group(0):
        return None
    span = m.group(0)
    fixed = intended
    if "\\" in span:   # the match was LaTeX: write the correction the same way
        for ch, tex in _TO_TEX.items():
            fixed = fixed.replace(ch, tex)
        if "\\{" in span:
            fixed = fixed.replace("{", "\\{").replace("}", "\\}")
    out = value[:m.start()] + fixed + value[m.end():]
    return re.sub(r"(\\[a-z]+) {2,}", r"\1 ", out)


def _has(value: str, text: str) -> bool:
    """`text` is in `value`, notation, spacing and letter case aside."""
    return text in value or (len(text.strip()) >= 3 and re.search(_flex_pattern(text), value, re.I) is not None)


def misprint_decisions() -> dict[str, dict]:
    """The decision in force on each misprint, every book's (the review tool's Misprints task appends them to
    groundtruth/<book>/misprint-decisions.json; the last one on a ref is the one in force), keyed by the task's ref:
    "<item id>[:<part label>]#<field>". Read fresh each call: the review tool keeps running while people decide."""
    out: dict[str, dict] = {}
    for p in sorted((HERE / "groundtruth").glob("*/misprint-decisions.json")):
        try:
            for d in json.loads(p.read_text()).get("decisions") or []:
                out[d["ref"]] = d
        except (OSError, ValueError):
            continue
    return out


def misprint_ref(rec: dict, label: str | None, field: str) -> str:
    return f"{rec.get('id')}{':' + label if label else ''}#{field}"


def apply_misprints(rec: dict, decisions: dict[str, dict] | None = None) -> tuple[dict, list[dict]]:
    """The record with every misprint it can place corrected, following the review decisions, and the misprints it
    could not place (each with its ref, field, printed and intended text, and the decision on it).

    The review decides (2026-10-29; before, decisions on a book record never reached the pipeline):
      * "not a misprint": the record's text stays as printed;
      * "different correction": the reviewer's intended text, not the extractor's;
      * a decision's `match`: the exact text in the record the reviewer says is the misprint, for one the page's
        words do not find (the review tool asks for it when a confirmed misprint is not applied).
    An undecided misprint is applied as the extractor proposed it, as before. What cannot be placed reaches the tutor
    as printed: compile lists it, and the coverage audit fails a decided one (misprints_applied)."""
    if decisions is None:
        decisions = misprint_decisions()
    r = copy.deepcopy(rec)
    missed = []
    for label, holder in [(None, r)] + [(p.get("label"), p) for p in r.get("parts") or []]:
        for m in holder.get("misprints") or []:
            field = m.get("field", "")
            mm = re.match(r"^([a-z_]+)(?:\[(\d+)\])?$", field)
            if not mm or mm.group(1) == "quote" or mm.group(1) not in holder or not m.get("printed"):
                continue
            ref = misprint_ref(rec, label, field)
            dec = decisions.get(ref)
            if dec and dec.get("decision") == "not_a_misprint":
                continue
            m = {**m, "intended": dec["intended"] if dec and dec.get("decision") == "corrected" and dec.get("intended") else m.get("intended", ""),
                 "printed": (dec or {}).get("match") or m["printed"]}
            if re.fullmatch(r"(?i)\s*(?:same|unchanged|no change|none|n/?a)\s*", m.get("intended") or ""):
                continue   # a reader's "no error found", not a correction: it once replaced a worked step with "same"
            key, idx = mm.group(1), mm.group(2)
            done = None
            if isinstance(holder[key], str):
                done = _replace_misprint(holder[key], m["printed"], m["intended"])
                if done is not None:
                    holder[key] = done
                elif _has(holder[key], m["intended"]) and not _has(holder[key], m["printed"]):
                    done = holder[key]   # the extractor already wrote the intended text and only recorded the misprint
            elif isinstance(holder[key], list):
                # the named step first, then any step: a misprint's index is often one off from the step that has it
                order = ([int(idx)] if idx is not None and int(idx) < len(holder[key]) else []) + list(range(len(holder[key])))
                for k in order:
                    done = _replace_misprint(str(holder[key][k]), m["printed"], m["intended"])
                    if done is not None:
                        holder[key][k] = done
                        break
                if done is None and any(_has(str(x), m["intended"]) for x in holder[key]) and not any(_has(str(x), m["printed"]) for x in holder[key]):
                    done = ""   # already intended
            if done is None:
                missed.append({"item": rec.get("id"), "ref": ref, "field": field, "printed": m["printed"], "intended": m["intended"],
                               "decision": (dec or {}).get("decision")})
    return r, missed


def with_intended(rec: dict) -> dict:
    """The record as the tutor should read it: a confirmed misprint's intended text in place of the printed one."""
    return apply_misprints(rec)[0]


def page_context(doc: dict, page, own_id: str) -> list[str]:
    """What else the book records on the same page: the figures, tables and prompts a question may refer to."""
    out = []
    for r in doc.get("items") or []:
        if r["id"] == own_id or r.get("source_page") != page or r.get("type") not in ("figure", "table", "activity", "exercise", "linking_text", "worked_example"):
            continue
        body = r.get("caption") or r.get("text") or r.get("stem") or ""
        if r.get("rows"):
            body += " | table: " + " / ".join(", ".join(row) for row in [r.get("header") or []] + r["rows"])
        out.append(f"[{r['id'].split(':', 1)[1]}] ({r['type']}) {body[:400]}")
    return out


def units(doc: dict) -> list[dict]:
    """One unit per unanswered part (or per unanswered prompt with no parts)."""
    out = []
    los = {o["id"]: o for o in doc.get("learning_objectives") or []}
    for raw in doc.get("items") or []:
        if raw.get("type") not in PROMPTS:
            continue
        r = with_intended(raw)
        parts = r.get("parts") or [None]
        for p in parts:
            h = p or r
            if h.get("answer") or h.get("answer_figure") or (p is None and (r.get("answer") or r.get("solution"))):
                continue
            ref = f"{r['id']}:{p['label']}" if p else r["id"]
            text = r.get("text") or r.get("stem") or ""
            stem = (p or {}).get("stem") or ""
            notes = " ".join(x for x in [r.get("notes"), (p or {}).get("notes")] if x)
            lo = los.get(r.get("lo") or "")
            out.append({
                "ref": ref, "record_id": r["id"], "part": (p or {}).get("label"), "type": r["type"],
                "page": r.get("source_page"), "text": text, "stem": stem, "notes": notes,
                "notation": r.get("notation"), "belongs_to": r.get("belongs_to"),
                "objective": f"{lo['label']}: {lo['description']}" if lo else None,
                "context": page_context(doc, r.get("source_page"), r["id"]),
                "needs_page": bool(NEEDS_PAGE.search(" ".join([text, stem, notes]))),
            })
    # a figure one part needs is the whole item's figure: every part of that item gets the page
    page_items = {u["record_id"] for u in out if u["needs_page"]}
    for u in out:
        u["needs_page"] = u["record_id"] in page_items
    for u in out:
        u["fingerprint"] = hashlib.md5(json.dumps({k: u[k] for k in ("text", "stem", "notes", "notation", "page")},
                                                  sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return out


def grounding(doc: dict) -> str:
    """The lesson as the model may use it: statements, worked examples (with their printed solutions), key terms,
    objectives. Misprints are given as intended."""
    lines = [f"LESSON {doc['lesson'].get('syllabus_ref', '')}: {doc['lesson'].get('title', '')}", "", "OBJECTIVES"]
    for o in doc.get("learning_objectives") or []:
        lines.append(f"[{o['id']}] {o['label']}: {o['description']}")
    lines += ["", "KEY TERMS: " + ", ".join(r.get("term", "") for r in doc.get("items") or [] if r.get("type") == "key_term"),
              "", "WHAT THE LESSON STATES"]
    for raw in doc.get("items") or []:
        r = with_intended(raw)
        if r.get("type") in STATEMENTS:
            extra = f" Formula: {r['formula']}" if r.get("formula") else ""
            note = f" ({r['notation']['printed']} means {r['notation']['normalised']})" if r.get("notation") else ""
            lines.append(f"[{r['id']}] ({r['type']}) {r.get('claim', '')}{extra}{note}")
    lines += ["", "WORKED EXAMPLES (the methods the lesson teaches)"]
    for raw in doc.get("items") or []:
        r = with_intended(raw)
        if r.get("type") != "worked_example":
            continue
        lines.append(f"[{r['id']}] {r.get('stem', '')}")
        for s in r.get("solution") or []:
            lines.append(f"    - {s}")
        if r.get("answer"):
            lines.append(f"    answer: {r['answer']}")
        for p in r.get("parts") or []:
            if p.get("answer"):
                lines.append(f"    {p['label']}: {p.get('stem', '')} → {p['answer']}")
    return "\n".join(lines)


def unit_block(us: list[dict], page_files: dict[int, Path]) -> str:
    lines = ["PARTS TO ANSWER"]
    for u in us:
        lines.append(f"\n[{u['ref']}] ({u['type']}, printed page {u['page']})")
        if u["objective"]:
            lines.append(f"  objective: {u['objective']}")
        lines.append(f"  question: {u['text']}")
        if u["part"]:
            lines.append(f"  answer only part {u['part']}" + (f": {u['stem']}" if u["stem"] else " (the part the question labels so)"))
        if u["notation"]:
            lines.append(f"  notation: {u['notation'].get('printed')} means {u['notation'].get('normalised')}")
        if u["notes"]:
            lines.append(f"  note: {u['notes']}")
        if u.get("context"):
            lines.append("  also on this page (what 'previous', 'following' or 'the diagrams' may mean):")
            lines += [f"    {c}" for c in u["context"]]
        if u["needs_page"] and u["page"] in page_files:
            lines.append(f"  the printed page: {page_files[u['page']]} (read it with the Read tool before answering)")
    lines.append("\nAnswer every part above, using its [ref] exactly.")
    return "\n".join(lines)


# ============================================================================ the model calls
class Budget:
    def __init__(self, cap: float):
        self.cap, self.spent, self.calls = cap, 0.0, []

    def left(self) -> float:
        return round(self.cap - self.spent, 4)


# call_claude: every model call is runbook/answers.workflow.js since ans-v3 (workflow())


# ============================================================================ the checks (no model)
def _norm(s: str) -> str:
    s = str(s or "")
    for a, b in (("\\left", ""), ("\\right", ""), ("\\{", "{"), ("\\}", "}"), ("\\,", ""), ("\\;", ""), ("\\ ", ""),
                 ("\\times", "×"), ("−", "-"), ("$", ""), ("\\text", "")):
        s = s.replace(a, b)
    return re.sub(r"\s+", "", s).strip(".").lower()


def _num(s: str):
    try:
        return WC.evaluate(str(s).replace("$", "").strip())
    except Exception:
        return None


def _same_value(a: str, b: str) -> bool:
    if _norm(a) == _norm(b):
        return True
    x, y = _num(a), _num(b)
    return x is not None and y is not None and abs(x - y) <= 1e-9 * max(1, abs(x), abs(y))


# ---- the same answer written two ways (Tamer, 2026-10-18: "strip added working, compare numbers, √ and fractions by
# value, angle and notation forms"). A blind re-solve often appends its working in brackets, writes √3 ≈ 1.732 for √3,
# adds the unit, or spells an angle 45°41'46" where the author wrote 45° 41' 46''; none of that is a disagreement.
def _drop_asides(s: str) -> str:
    """Bracketed asides in words — "(mean = 90/30 = 3, Σ(x−x̄)²k = 66)", "(the line is vertical)" — dropped, nested
    brackets and all; a bracket of maths, "(x - 3)", kept."""
    out, i = [], 0
    while i < len(s):
        if s[i] == "(":
            depth, j = 0, i
            while j < len(s):
                depth += {"(": 1, ")": -1}.get(s[j], 0)
                if depth == 0:
                    break
                j += 1
            inner = s[i + 1:j]
            top = re.sub(r"\([^()]*\)", "", inner)
            if re.search(r"[A-Za-z]{3}", re.sub(r"sqrt|frac", "", top)):
                while out and out[-1] == " ":
                    out.pop()
                i = j + 1
                continue
        out.append(s[i])
        i += 1
    return "".join(out)
_DMS = re.compile(r"(-?\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:''|\"|″)\s*)?")


def _plain(s: str) -> str:
    """LaTeX and the book's symbols to one plain spelling."""
    s = str(s or "").replace("$", "")
    for _ in range(3):
        s = re.sub(r"\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}", r"(\1)/(\2)", s)
        s = re.sub(r"\\sqrt\{([^{}]*)\}", r"√(\1)", s)
        s = re.sub(r"\\(?:overline|bar|mathrm|text|operatorname)\{([^{}]*)\}", r"\1", s)
    for a, b in (("\\approx", "≈"), ("\\simeq", "≈"), ("≃", "≈"), ("\\times", "×"), ("\\cdot", "×"), ("\\pi", "π"),
                 ("\\circ", "°"), ("^°", "°"), ("−", "-"), ("\\left", ""), ("\\right", ""), ("\\,", " "), ("\\ ", " ")):
        s = s.replace(a, b)
    return s


def _value(expr: str):
    """A number written with digits, fractions, √, π, × and powers, exactly as far as floats go; None otherwise."""
    import ast  # noqa: PLC0415
    import math  # noqa: PLC0415
    e = expr.strip().rstrip(".")
    if not e or re.search(r"[A-Za-z]", e.replace("π", "")):
        return None
    e = re.sub(r"√\s*(\d+(?:\.\d+)?)", r"sqrt(\1)", e)
    e = e.replace("√(", "sqrt(").replace("√", "sqrt").replace("×", "*").replace("^", "**").replace("π", "(pi)")
    e = re.sub(r"(\d|\))\s*(sqrt|\(pi\)|\()", r"\1*\2", e)   # 2√3, 2(3)
    try:
        tree = ast.parse(e, mode="eval")
    except SyntaxError:
        return None
    ok = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Call, ast.Name, ast.Load, ast.Add, ast.Sub, ast.Mult,
          ast.Div, ast.Pow, ast.USub, ast.UAdd)
    if not all(isinstance(n, ok) for n in ast.walk(tree)) or any(isinstance(n, ast.Name) and n.id not in ("sqrt", "pi") for n in ast.walk(tree)):
        return None
    try:
        v = eval(compile(tree, "<answer>", "eval"), {"__builtins__": {}}, {"sqrt": math.sqrt, "pi": math.pi})   # nosec: AST-checked
        return float(v) if isinstance(v, (int, float)) else None
    except (ValueError, ZeroDivisionError, OverflowError, TypeError):
        return None


def _decimals(s: str) -> int:
    m = re.findall(r"\d+\.(\d+)", s)
    return min((len(x) for x in m), default=12)


def _label(side: str) -> str | None:
    """A name standing for the value — "σ", "n(0)", "Class A: mean", "m(∠C)" — normalised; None when the text is not
    one: an expression in letters ("(x - 3)(x - 1)", "2x - 1") never names a value."""
    side = side.strip()
    outside = re.sub(r"\([^()]*\)", "", side)
    if len(side) > 40 or not re.search(r"[A-Za-zσμθαβ∠]", outside) or re.search(r"[+*/^×÷√]|\s-\s|\d", outside):
        return None
    return re.sub(r"[^0-9a-zσμθαβ∠()]", "", side.lower())


def _quantity(seg: str) -> tuple[set[float], int, str | None] | None:
    """One quantity's values: every side of an `=` / `≈` chain that is a number (σ = √2.2 ≈ 1.483 is one quantity),
    or an angle in degrees, minutes and seconds; with the precision shown. None when it is not a number."""
    seg = seg.strip()
    m = _DMS.fullmatch(seg) or _DMS.fullmatch(re.sub(r"^[^=≈]*[=≈]\s*", "", seg))
    if m and m.group(1):
        v = float(m.group(1)) + float(m.group(2) or 0) / 60 + float(m.group(3) or 0) / 3600
        lab = re.match(r"^([^=≈]*)[=≈]", seg)
        return {v}, (6 if m.group(3) else 3), _label(lab.group(1)) if lab else None
    vals, prec, label = set(), 12, None
    sides = re.split(r"[=≈]", seg)
    for k, side in enumerate(sides):
        side = re.sub(r"(?<=[\d)])\s+[A-Za-z][A-Za-z ]*$", "", side.strip())   # a unit after the number: "1.483 goals"
        if not side:
            continue
        v = _value(side)
        if v is not None:
            vals.add(v)
            prec = min(prec, _decimals(side))
        elif k == 0 and len(sides) > 1 and _label(side) is not None:
            label = _label(side)   # a name for the value: "σ", "n(0)", "Class A: mean"
        else:
            return None   # an expression in letters is not a number: "(x - 3)(x - 1) = 0" is no "= 0"
    return (vals, prec, label) if vals else None


def _same_quantities(a: str, b: str) -> bool:
    split = lambda s: [x for x in re.split(r"\s*(?:[,;]|\band\b|\bor\b)\s*(?![^()]*\))", s) if x.strip()]
    qa, qb = [_quantity(x) for x in split(a)], [_quantity(x) for x in split(b)]
    if not qa or len(qa) != len(qb) or any(q is None for q in qa + qb):
        return False
    def close(x, y):
        (vx, px, lx), (vy, py, ly) = x, y
        if lx and ly and lx != ly:   # both name the value, differently: not the same quantity
            return False
        tol = 0.5 * 10 ** -min(px, py) + 1e-9 * max(1.0, *(abs(v) for v in vx | vy))
        return any(abs(u - w) <= tol for u in vx for w in vy)
    if all(close(x, y) for x, y in zip(qa, qb)):   # in the order written
        return True
    # in any order only when nothing longer than one letter names a value ("x = 3 or x = 1"): a "Class A" value is
    # never matched with a "Class B" one
    if any(q[2] and len(q[2]) > 1 for q in qa + qb):
        return False
    return all(close(x, y) for x, y in zip(sorted(qa, key=lambda q: min(q[0])), sorted(qb, key=lambda q: min(q[0]))))


def _same_written(a: str, b: str) -> bool:
    """The same answer written two ways: asides in words dropped, notation unified, then text or values compared."""
    pa, pb = _drop_asides(_plain(a)), _drop_asides(_plain(b))
    num_paren = lambda t: re.sub(r"(?<![A-Za-z])\((-?[\d.]+)\)", r"\1", t)   # \frac{1}{2} → (1)/(2) → 1/2; n(0) kept
    pa, pb = num_paren(pa), num_paren(pb)
    if _norm(pa) == _norm(pb):
        return True
    return _same_quantities(pa, pb)


_NEGATION = re.compile(r"\b(?:not|no|never|neither|nor|none|cannot)\b|n't\b")


def _opens_with(short: str, sentence: str) -> bool:
    """A short answer — a name or a choice, "Class A", "segment DC", "(2)" — and a sentence that opens with it and
    affirms it: "Class A is more homogeneous, because …" (Tamer, 2026-10-18). Not when the sentence negates it
    ("Class A is not …") or offers another ("Class A or B")."""
    sh = re.sub(r"\s+", " ", _drop_asides(_plain(short))).strip().rstrip(".").lower()
    se = re.sub(r"\s+", " ", _plain(sentence)).strip().lower()
    if not sh or len(sh.split()) > 5 or "=" in sh or re.search(r"\d", sh.replace("(", "").replace(")", "")) and len(sh) > 4:
        return False
    if not (se.startswith(sh) and (len(se) == len(sh) or se[len(sh)] in " ,.:;")):
        return False
    claim = re.split(r"\b(?:because|since|as|so)\b|[,;]", se[len(sh):], maxsplit=1)[0]
    return not _NEGATION.search(claim) and not re.match(r"\s*(?:or|and)\b", se[len(sh):])


def same_answer(a: str, b: str) -> bool:
    """Do two final answers say the same thing? Assignments by variable, pairs and sets as sets, numbers by value."""
    if _same_value(a, b) or _same_written(a, b) or _opens_with(a, b) or _opens_with(b, a):
        return True
    asg = lambda s: dict(re.findall(r"\b([a-zA-Z])\s*=\s*([^,;]+)", s.replace("$", "")))
    da, db = asg(a), asg(b)
    if da and db and set(da) == set(db):
        return all(_same_value(da[k], db[k]) for k in da)
    tup = lambda s: {_norm(t) for t in re.findall(r"\([^()]*,[^()]*\)", s.replace("$", ""))}   # pairs only: "(x)" of f(x) is none
    ta, tb = tup(a), tup(b)
    if ta and tb:
        return ta == tb
    rhs = lambda s: s.replace("$", "").split("=")[-1]  # "n(X × Z) = 6" says 6
    if ("=" in a) != ("=" in b) and _same_value(rhs(a), rhs(b)):
        return True
    sentence = lambda s: _norm(re.split(r"(?<=[.;])\s", str(s).replace("$", ""), maxsplit=1)[0])
    if sentence(a) and sentence(a) == sentence(b):  # "Only diagram (2)." and "Only diagram (2). Each x…" say the same
        return True
    first = lambda s: _norm(s.split(",")[0].split(".")[0])
    if re.match(r"^(yes|no)\b", _norm(a)) and re.match(r"^(yes|no)\b", _norm(b)):
        return _norm(a)[:2] == _norm(b)[:2] or first(a) == first(b)
    return False


def gradable_key(answer: str):
    """The part of an answer the app would mark — Yes/No, a number, a set, named values — as compile reads it
    (compile_book_records.answer_type, exercises), or None for a drawing or an explanation with nothing to mark."""
    import compile_book_records as CB  # noqa: PLC0415  (compile imports this module: imported when first needed)
    t = CB.answer_type(answer) if answer and not str(answer).startswith("CANNOT ANSWER") else None
    if t and t[1] and re.search(r"[A-Za-z]{3,}", re.sub(r"\\[A-Za-z]+", "", t[2])):
        return None   # a sentence the marker would read as letters ("Both sides equal m + 1"): nothing gradable
    return t[2] if t else None


YES_NO_Q = re.compile(r"(?i)^(?:is|are|was|were|does|do|did|can|could|will|would|has|have|should|must|may)\b")


def asks_yes_or_no(question) -> bool:
    """A Yes/No answer answers this question: it asks a yes/no question ("Is figure 1 cyclic? Explain your answer.",
    "If a/b = 3/5, is a = 3?", "Which of the following figures is cyclic?" asked of one figure) and asks nothing else
    a Yes/No leaves unanswered ("… What feature is hidden?", "What do you deduce?", "Under what conditions?").
    "Explain", "why" and "mention the reason" ask for the working, which is not marked."""
    q = question if isinstance(question, str) else " ".join(str((question or {}).get(k) or "") for k in ("text", "stem"))
    stem = "" if isinstance(question, str) else str((question or {}).get("stem") or "")
    one_of_several = bool(re.match(r"(?i)\s*(?:figure|fig\.?|case|part)\s*\(?\d", stem))
    yes_no = other = False
    for sent in re.split(r"(?<=[?.:])\s+", re.sub(r"\$[^$]*\$", "X", q)):
        core = sent.strip()
        if YES_NO_Q.match(core) or re.match(r"(?i)if\b.*?\b(?:is|are|can|could|does|do|will|would)\s", core) \
                or (one_of_several and re.match(r"(?i)which of the following", core)):
            yes_no = True
        elif core.endswith("?") and re.match(r"(?i)(?:what|which|where|when|how|find|calculate|write|under what)\b", core):
            other = True
    return yes_no and not other


def check(author: dict, resolve: dict | None) -> dict:
    flags = WC.precheck_solution({"id": author["ref"], "steps": author.get("solution") or [], "kind": "generated"})
    c = {"resolve_answer": (resolve or {}).get("answer"), "resolve_kind": (resolve or {}).get("kind"),
         "numeric_flags": [{"step": f["step"], "quote": f["quote"], "why": f["why"]} for f in flags]}
    if str(author.get("answer", "")).startswith("CANNOT ANSWER") or str(c["resolve_answer"] or "").startswith("CANNOT ANSWER"):
        c["agree"], status = None, "cannot_answer"
    elif author["kind"] != "value":
        # a drawing or an explanation has no machine check of its words — but when both readings come down to the same
        # thing the app would mark ("Is figure 1 cyclic? Explain." → Yes, Yes), that is the check a value gets, and
        # the question is asked on that key (Tamer, 2026-10-29: 32 Prep 3 answers both solvers agreed on waited for a
        # person). Anything else, or a numeric flag on the working, still needs a person.
        ka = gradable_key(author.get("answer"))
        kb = gradable_key((resolve or {}).get("answer"))
        if ka in ("Yes", "No") and not asks_yes_or_no(author.get("question")):
            ka = None   # "…? What feature is hidden?" answered "No, …": the question asked is not the yes/no one
        if ka and kb and same_answer(ka, kb) and not flags:
            c["agree"], c["agreed_on"], status = True, f"the gradable answer ({ka}); the explanation is not checked", "agreed"
        else:
            c["agree"], status = None, "needs_person"
    elif resolve is None:
        c["agree"], status = False, "disagreed"
    else:
        c["agree"] = same_answer(author["answer"], resolve["answer"])
        status = "agreed" if c["agree"] and not flags else ("flagged" if c["agree"] else "disagreed")
    return {"checks": c, "status": status}


# ============================================================================ the run
def render_pages(doc: dict, pages: set[int], book: str) -> dict[int, Path]:
    if not pages:
        return {}
    try:
        import pymupdf  # noqa: PLC0415  (only needed for the figure calls: uv run --with pymupdf)
    except ImportError:
        raise SystemExit("parts need the page image: run with `uv run --with pymupdf answer_gen.py …`")
    src = doc["source_document"]
    pdf = REPO / src["file_path"]
    if not pdf.exists():
        raise SystemExit(f"{pdf} not found (the book PDFs are not in git: put it in docs/Source/)")
    out_dir = HERE / "work" / book / "answer-pages"
    lmap = HERE / "book-records" / book / "lessons.json"
    if lmap.exists() and json.loads(lmap.read_text()).get("page_offset") not in (None, src["page_offset"]):
        out_dir = out_dir / f"offset{src['page_offset']}"   # a lesson under its own numbering (extract_book_record.page_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    d = pymupdf.open(pdf)
    files = {}
    for printed in sorted(pages):
        f = out_dir / f"p{printed:03d}-200dpi.png"  # small printed diagrams need the resolution
        if not f.exists():
            d[printed + src["page_offset"] - 1].get_pixmap(dpi=200).save(f)
        files[printed] = f
    return files


def workflow(book: str, mode: str, model: str, budget: Budget, name: str, read_dirs: list[Path], groups=None, judge=None) -> dict:
    """runbook/answers.workflow.js (the prompts live there): its embedded copy, run here through the workflow runner,
    metered into runs/<book>/cost.jsonl and counted against this run's cap."""
    import embed_workflow as EW  # noqa: PLC0415
    import workflow_runner as WR  # noqa: PLC0415
    if budget.left() <= 0.05:
        raise SystemExit(f"cost cap reached (${budget.spent:.3f} of ${budget.cap:.2f}): stopped before {name}")
    args = {"stage": "S3-answers", "mode": mode, "book": {"book": book}, "model": model,
            **({"groups": groups} if groups is not None else {}), **({"judge": judge} if judge is not None else {})}
    copy = EW.default_out(book, "answers", name)
    EW.write(HERE / "runbook" / "answers.workflow.js", args, copy)
    _run, res, cost = WR.run_copy(copy, read_dirs, budget.left(), name, book, "answers", stage="S3")
    budget.spent += cost
    budget.calls.append({"call": name, "cost_usd": round(cost, 4), "model": model})
    return res


def answer_lesson(doc: dict, us: list[dict], model: str, budget: Budget, book: str) -> list[dict]:
    ground = grounding(doc)
    text_units = [u for u in us if not u["needs_page"]]
    page_units = [u for u in us if u["needs_page"]]
    files = render_pages(doc, {u["page"] for u in page_units if u["page"]}, book)
    results = []
    slug = doc["lesson"]["slug"]
    plan = [(g, label) for g, label in ((text_units, "text"), (page_units, "page")) if g]
    groups = [{"label": f"{slug}:{label}", "material": f"{ground}\n\n{unit_block(g, files if label == 'page' else {})}"} for g, label in plan]
    res = workflow(book, "answer", model, budget, f"answers.{slug}", [d for d in [files and next(iter(files.values())).parent] if d], groups=groups)
    out = {g["label"]: g for g in res.get("groups") or []}
    for group, label in plan:
        authored = (out.get(f"{slug}:{label}") or {}).get("authored") or {}
        resolved = (out.get(f"{slug}:{label}") or {}).get("resolved") or {}
        by_a = {a["ref"]: a for a in authored.get("answers") or []}
        by_r = {a["ref"]: a for a in resolved.get("answers") or []}
        for u in group:
            a = by_a.get(u["ref"])
            if not a:
                results.append({**_entry(u), "status": "missing", "kind": None, "answer": None, "solution": [],
                                "grounded_in": [], "checks": {"resolve_answer": (by_r.get(u["ref"]) or {}).get("answer")}})
                continue
            results.append({**_entry(u), "kind": a["kind"], "answer": a["answer"], "solution": a.get("solution") or [],
                            "grounded_in": a.get("grounded_in") or [],
                            **check({**a, "question": _entry(u)["question"]}, by_r.get(u["ref"]))})
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for r in results:
        r["made"] = {"at": stamp, "model": model, "prompts": PROMPT_VERSION}
    return results


def _entry(u: dict) -> dict:
    return {"ref": u["ref"], "record_id": u["record_id"], "part": u["part"], "type": u["type"], "page": u["page"],
            "question": {"text": u["text"], "stem": u["stem"], "notes": u["notes"] or None},
            "needs_page": u["needs_page"], "question_fingerprint": u["fingerprint"]}


# ============================================================================ the printed answers, checked blind
CHECKS_FORMAT = "ainext.printed-checks/1"
CHECK_VERSION = "chk-v1"


def printed_units(doc: dict) -> list[dict]:
    """One unit per part (or prompt) whose answer the book prints as text: the answer to check, and what the blind
    solver may see. A printed drawing (answer_figure only) is not compared."""
    out = []
    los = {o["id"]: o for o in doc.get("learning_objectives") or []}
    items = {r["id"]: r for r in doc.get("items") or []}
    answer_figs = {f for r in items.values() for h in [r] + list(r.get("parts") or [])
                   for f in ([h["answer_figure"]] if isinstance(h.get("answer_figure"), str) else h.get("answer_figure") or [])}
    for raw in doc.get("items") or []:
        if raw.get("type") not in ("exercise", "worked_example"):
            continue
        r = with_intended(raw)
        for p in r.get("parts") or [None]:
            printed = (p or r).get("answer") or (r.get("answer") if p is None else None)
            if not printed:
                continue
            ref = f"{r['id']}:{p['label']}" if p else r["id"]
            figs = [f for f, it in items.items() if it.get("type") == "figure" and f not in answer_figs
                    and (it.get("belongs_to") == r["id"] or f in ([r["uses_figure"]] if isinstance(r.get("uses_figure"), str) else r.get("uses_figure") or []))]
            lo = los.get(r.get("lo") or "")
            u = {"ref": ref, "record_id": r["id"], "part": (p or {}).get("label"), "type": r["type"], "page": r.get("source_page"),
                 "text": r.get("text") or r.get("stem") or "", "stem": (p or {}).get("stem") or "", "notes": "",
                 "notation": r.get("notation"), "objective": f"{lo['label']}: {lo['description']}" if lo else None,
                 "context": [], "needs_page": False, "figures": figs, "printed": printed}
            u["fingerprint"] = hashlib.md5(json.dumps({k: u[k] for k in ("text", "stem", "printed", "figures")},
                                                      sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            out.append(u)
    return out


def check_printed(doc: dict, us: list[dict], model: str, budget: Budget, book: str) -> list[dict]:
    """Grade 10's S3 blind re-solve, for a book record: each item solved from its question alone (never its printed
    solution or answer: the worked examples being checked are left out of the lesson material, and the solver sees
    the item's figure crops, never the page), compared with the printed answer; a disagreement the comparison cannot
    settle goes to a judge. agreed | disagreed | cannot_answer."""
    import crop_figures as CF  # noqa: PLC0415
    hidden = {u["record_id"] for u in us}
    shown = copy.deepcopy(doc)
    shown["items"] = [r for r in shown.get("items") or [] if r["id"] not in hidden]
    ground = grounding(shown)
    fig_dir = CF.figures_dir(book)
    lines = ["PARTS TO ANSWER"]
    for u in us:
        lines.append(f"\n[{u['ref']}] ({u['type'].replace('_', ' ')}, printed page {u['page']})")
        if u["objective"]:
            lines.append(f"  objective: {u['objective']}")
        lines.append(f"  question: {u['text']}")
        if u["part"]:
            lines.append(f"  answer only part {u['part']}" + (f": {u['stem']}" if u["stem"] else " (the part the question labels so)"))
        crops = [fig_dir / CF.crop_name(f) for f in u["figures"] if (fig_dir / CF.crop_name(f)).exists()]
        for c in crops:
            lines.append(f"  its figure: {c} (read it with the Read tool)")
        if u["figures"] and not crops:
            lines.append("  (its figure is not available: if the part cannot be answered without it, say CANNOT ANSWER)")
    lines.append("\nAnswer every part above, using its [ref] exactly.")
    slug = doc["lesson"]["slug"]
    res = workflow(book, "blind", model, budget, f"check-printed.{slug}", [fig_dir] if any(u["figures"] for u in us) else [],
                   groups=[{"label": f"{slug}:printed", "material": f"{ground}\n\n" + "\n".join(lines)}])
    resolved = ((res.get("groups") or [{}])[0] or {}).get("resolved") or {}
    by_r = {a["ref"]: a for a in resolved.get("answers") or []}
    results = []
    for u in us:
        b = by_r.get(u["ref"])
        row = {"ref": u["ref"], "record_id": u["record_id"], "part": u["part"], "type": u["type"], "page": u["page"],
               "printed": u["printed"], "blind": (b or {}).get("answer"), "blind_kind": (b or {}).get("kind"),
               "figures": u["figures"], "question_fingerprint": u["fingerprint"]}
        if not b:
            row.update(status="cannot_answer", note="the solver gave no answer for it")
        elif str(b["answer"]).startswith("CANNOT ANSWER"):
            row.update(status="cannot_answer", note=b["answer"][:200])
        elif same_answer(u["printed"], b["answer"]):
            row.update(status="agreed", how="the same answer")
        else:
            row.update(status="disagreed")
        results.append(row)
    unsure = [r for r in results if r["status"] == "disagreed"]
    if unsure:
        by_ref = {u["ref"]: u for u in us}
        prompt = "\n\n".join(f"[{r['ref']}] question: {by_ref[r['ref']]['text']}" + (f" (part {r['part']}: {by_ref[r['ref']]['stem']})" if r["part"] else "")
                              + f"\n  printed: {r['printed']}\n  solver: {r['blind']}" for r in unsure) + "\n\nGive one verdict per [ref], ref as shown without the brackets."
        judged = (workflow(book, "judge", model, budget, f"judge.{slug}", [], judge={"label": slug, "material": prompt}).get("judge") or {})
        verdicts = {v["ref"].strip("[]"): v for v in judged.get("verdicts") or []}
        for r in unsure:
            v = verdicts.get(r["ref"])
            r["judge"] = v
            if v and v["verdict"] == "equivalent":
                r.update(status="agreed", how=f"judged equivalent: {v['reason']}")
            elif v and v["verdict"] == "unclear":
                r.update(status="cannot_answer", note=f"the judge could not decide: {v['reason']}")
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for r in results:
        r["made"] = {"at": stamp, "model": model, "prompts": CHECK_VERSION}
    return results


def checks_path(book: str, slug: str) -> Path:
    return HERE / "teaching" / book / "printed-checks" / f"{slug}.json"


def out_path(book: str, slug: str) -> Path:
    return HERE / "teaching" / book / "answers" / f"{slug}.json"


COMPARE_VERSION = "same-answer-v3"   # v2: asides in words dropped, notation unified, values and angles compared;
                                     # v3: an explanation or drawing is agreed on its gradable answer (check)


def rejudge(book: str, dry: bool = False) -> dict:
    """The stored readings judged again with the current comparison, no model call: only answers marked `disagreed`
    (a value both readings gave) or `needs_person` (an explanation or drawing: v3 agrees one on its gradable answer),
    so an agreement already made is never undone. Each one re-judged says so. ingest.py refresh runs it."""
    from datetime import datetime, timezone  # noqa: PLC0415
    out = {"looked_at": 0, "now_agreed": [], "now_flagged": [], "still_disagreed": 0}
    for f in sorted((HERE / "teaching" / book / "answers").glob("*.json")):
        doc = json.loads(f.read_text())
        changed = False
        for a in doc.get("answers") or []:
            r = (a.get("checks") or {}).get("resolve_answer")
            was = a.get("status")
            if not r or not (was == "disagreed" and a.get("kind") == "value" or was == "needs_person"):
                continue
            out["looked_at"] += 1
            res = check(a, {"answer": r, "kind": (a.get("checks") or {}).get("resolve_kind")})
            if res["status"] in ("disagreed", "needs_person"):
                out["still_disagreed"] += 1
                continue
            out["now_agreed" if res["status"] == "agreed" else "now_flagged"].append(a["ref"])
            a["checks"] = {**res["checks"], "rejudged": {"from": was, "by": COMPARE_VERSION,
                                                         "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}}
            a["status"] = res["status"]
            changed = True
        if changed and not dry:
            f.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    return out


def judge_generated(book: str, model: str, cap: float, dry: bool = False) -> dict:
    """The printed-answer check's judge, for generated answers (Tamer, 2026-10-18): each answer still `disagreed`
    after the comparison goes, with its question and both readings, to a model that decides equivalent, different or
    unclear (runbook/answers.workflow.js, judge kind 'generated'). Equivalent ones become `agreed`; every verdict is
    kept on the answer, `checks.judge`. One call per lesson."""
    from datetime import datetime, timezone  # noqa: PLC0415
    budget = Budget(cap)
    out = {"judged": 0, "equivalent": [], "different": 0, "unclear": 0, "no_verdict": 0}
    for f in sorted((HERE / "teaching" / book / "answers").glob("*.json")):
        doc = json.loads(f.read_text())
        todo = [a for a in doc.get("answers") or [] if a.get("status") == "disagreed" and a.get("kind") == "value"
                and (a.get("checks") or {}).get("resolve_answer")]
        if not todo:
            continue
        q = lambda a: (a.get("question") or {})
        material = "\n\n".join(
            f"[{a['ref']}] question: {q(a).get('text') or ''}" + (f" (part {a['part']}: {q(a).get('stem')})" if a.get("part") and q(a).get("stem") else "")
            + f"\n  first: {a['answer']}\n  second: {a['checks']['resolve_answer']}" for a in todo
        ) + "\n\nGive one verdict per [ref], ref as shown without the brackets."
        if dry:
            out["judged"] += len(todo)
            continue
        slug = doc.get("lesson") or f.stem
        res = workflow(book, "judge", model, budget, f"judge-gen.{slug}", [], judge={"label": f"gen:{slug}", "material": material, "kind": "generated"})
        verdicts = {v["ref"].strip("[]"): v for v in ((res.get("judge") or {}).get("verdicts") or [])}
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for a in todo:
            out["judged"] += 1
            v = verdicts.get(a["ref"])
            if not v:
                out["no_verdict"] += 1
                continue
            a["checks"]["judge"] = {**v, "model": model, "at": stamp}
            if v["verdict"] == "equivalent":
                a["status"] = "agreed"
                out["equivalent"].append(a["ref"])
            else:
                out[v["verdict"] if v["verdict"] in ("different", "unclear") else "unclear"] += 1
        f.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    out["cost_usd"] = round(budget.spent, 4)
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    jg = sub.add_parser("judge", help="a model judges each remaining disagreement: equivalent ones become agreed")
    jg.add_argument("book")
    jg.add_argument("--model", default="sonnet")
    jg.add_argument("--cap", type=float, default=3.0)
    jg.add_argument("--dry-run", action="store_true")
    if argv and argv[0] == "judge":
        a = ap.parse_args(argv)
        res = judge_generated(a.book, a.model, a.cap, a.dry_run)
        print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in res.items()}), file=sys.stderr)
        return 0
    rj = sub.add_parser("rejudge", help="judge the stored readings again with the current comparison (no model call)")
    rj.add_argument("book")
    rj.add_argument("--dry-run", action="store_true")
    if argv and argv[0] == "rejudge":
        a = ap.parse_args(argv)
        res = rejudge(a.book, a.dry_run)
        print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in res.items()}), file=sys.stderr)
        return 0
    for name in ("plan", "run"):
        s = sub.add_parser(name)
        s.add_argument("record", type=Path, help="a lesson's book record (groundtruth/… or book-records/…)")
        s.add_argument("--only", nargs="*", help="only these refs")
        s.add_argument("--force", action="store_true", help="redo parts that already have an answer")
        s.add_argument("--model", default="sonnet")
        s.add_argument("--cap", type=float, default=5.0, help="stop before spending more than this many USD (default 5)")
    c = sub.add_parser("check-printed", help="re-solve every printed answer blind and compare (Grade 10's S3 rule)")
    c.add_argument("record", type=Path)
    c.add_argument("--force", action="store_true")
    c.add_argument("--model", default="sonnet")
    c.add_argument("--cap", type=float, default=3.0)
    a = ap.parse_args(argv)
    path = a.record.resolve()
    if a.cmd == "check-printed":
        return cmd_check_printed(path, a)
    doc = json.loads(path.read_text())
    book, slug = book_of(path), doc["lesson"]["slug"]
    out = out_path(book, slug)
    prev = json.loads(out.read_text()) if out.exists() else None
    done = {x["ref"]: x for x in (prev or {}).get("answers") or []}
    todo = [u for u in units(doc) if (not a.only or u["ref"] in a.only)
            and (a.force or u["ref"] not in done or done[u["ref"]].get("question_fingerprint") != u["fingerprint"])]
    print(f"{slug}: {len(units(doc))} unanswered part(s); {len(todo)} to answer now "
          f"({sum(u['needs_page'] for u in todo)} need the printed page)", file=sys.stderr)
    if a.cmd == "plan":
        for u in todo:
            print(f"  {u['ref']:28} p.{u['page']}  {'[page] ' if u['needs_page'] else ''}{(u['stem'] or u['text'])[:70]}")
        return 0
    if not todo:
        return 0
    budget = Budget(a.cap)
    results = answer_lesson(doc, todo, a.model, budget, book)
    for r in results:
        done[r["ref"]] = r
    order = {u["ref"]: i for i, u in enumerate(units(doc))}
    data = {"format": FORMAT, "book": book, "lesson": slug, "source": str(path.relative_to(HERE)),
            "made_by": "answer_gen.py", "runs": (prev or {}).get("runs", []) + [
                {"at": date.today().isoformat(), "model": a.model, "prompts": PROMPT_VERSION, "parts": len(results),
                 "cost_usd": round(budget.spent, 4), "calls": budget.calls}],
            "answers": sorted(done.values(), key=lambda x: order.get(x["ref"], 10 ** 6))}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    from collections import Counter
    print(f"{len(results)} answered -> {out.relative_to(HERE)}  {dict(Counter(r['status'] for r in results))}  "
          f"${budget.spent:.3f}", file=sys.stderr)
    return 0


def cmd_check_printed(path: Path, a) -> int:
    doc = json.loads(path.read_text())
    book, slug = book_of(path), doc["lesson"]["slug"]
    out = checks_path(book, slug)
    prev = json.loads(out.read_text()) if out.exists() else None
    done = {x["ref"]: x for x in (prev or {}).get("checks") or []}
    us = printed_units(doc)
    todo = [u for u in us if a.force or u["ref"] not in done or done[u["ref"]].get("question_fingerprint") != u["fingerprint"]]
    print(f"{slug}: {len(us)} printed answer(s); {len(todo)} to check now", file=sys.stderr)
    if not todo:
        return 0
    budget = Budget(a.cap)
    for r in check_printed(doc, todo, a.model, budget, book):
        done[r["ref"]] = r
    order = {u["ref"]: i for i, u in enumerate(us)}
    data = {"format": CHECKS_FORMAT, "book": book, "lesson": slug, "source": str(path.relative_to(HERE)), "made_by": "answer_gen.py check-printed",
            "runs": (prev or {}).get("runs", []) + [{"at": date.today().isoformat(), "model": a.model, "prompts": CHECK_VERSION,
                                                      "parts": len(todo), "cost_usd": round(budget.spent, 4), "calls": budget.calls}],
            "checks": sorted((v for k, v in done.items() if k in order), key=lambda x: order[x["ref"]])}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    from collections import Counter
    print(f"-> {out.relative_to(HERE)}  {dict(Counter(r['status'] for r in data['checks']))}  ${budget.spent:.3f}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

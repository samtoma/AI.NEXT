"""Compile ingested book records into the bundles the app already loads, so the tutor can teach from them.

    uv run compile_book_records.py prep3-math-en u1-1 u1-2 u1-3 u1-4

Run from services/extraction/. For each lesson named, ONLY the newly ingested content is used (Tamer, 2026-10-16):
  * the book record (book-records/<book>/<slug>.json): its objectives and the book's own questions;
  * the generated answers (teaching/<book>/answers/<slug>.json), filtered by their review decisions
    (reviews/<book>/generated-answers.json): an approved answer, or one both readings agreed on with no failed
    check (loaded unreviewed, as the maths bank is served today, ADR-0019).
Today's content for those lessons (their bundle questions and figures, generated questions, widget questions,
misconceptions and prerequisite links) is LEFT OUT, not re-homed. Every other lesson of the book is unchanged.

Writes compiled/<book>/: the bundles (schemas.py SeedBundle) and the generated exports (minus the compiled
lessons' rows), and compile-report.json listing every book prompt that did not become a question, with why.
Nothing about how Noor teaches changes: the app reads these exactly as it reads today's bundles.

HOW A BOOK PROMPT BECOMES A QUESTION
  * Objective: the book record's objectives become the app's: `u1-1:objective-3` → `lo:u1-1-3`. A prompt the
    extractor left without one takes the objective of the nearest assigned record on its page.
  * Which: every exercise and worked-example part with an answer, printed or generated as above; a "Think and
    discuss" activity or a "Think" prompt only with a generated answer a person approved or two readings agreed on.
  * Marking, with what the app has: a number is `numeric` (today's grade()); assigned values ("a = 4, b = -4"),
    a function's values ("f(-2) = 9, f(0) = 3": the values, any order), a point and a set ("{(1, 2), (1, 3)}", any
    order) go to the app's marker (`choices.marker`, kinds values / coordinates); a short name or yes/no is `short`
    with today's plain check. A key the app's marker then cannot read is held (`unanswerable`), not dropped.
  * Not markable (a drawing, an explanation, a worked example with no answer apart from its solution): the worked
    example goes to the explanation library as a worked example (`expl:<lo tail>:bk-<item>`, Grade 10's
    `not_markable` rule), as does an approved or agreed generated answer that cannot be marked.
  * A worked example is a question too: its printed solution is the worked solution the tutor teaches from.
  * A printed answer is re-solved blind first (`answer_gen.py check-printed`, Grade 10's S3 rule): agreed → live
    and AI-checked; disagreed → held `answer_mismatch`; not re-solved or not answerable → held `unverified`.
  * Figures (`lesson_figures`): S4's drawing (book_record_figures.py) is shown with the questions of the prompt the
    figure is printed in or that needs it (`uses_figure`); a question whose figure S4 did not draw, or whose drawing
    withholds what a read-off question asks for, gets the book's own picture (answer 37d) from its checked crop
    (crop_figures.py), copied to app/public/book-figures/<book>/; a picture that draws the asked-for point is held
    (`figure_reveals_answer`); a question with no figure at all is held (`figure_missing`).
  * Reviewed figures: every S4 drawing and gap is reviewed in the review tool (Generated content → Figures). A
    drawing a person rejected, or sent back for a fix, on the drawing as it is now (its fingerprint), is not shown:
    its questions get the book's picture as if S4 had not drawn it, and the report lists why (`figures`,
    `stand_ins`). Every figure decision is listed in `figure_reviews`, with the visuals an approved drawing shows as.
  * Human stamps: each decision in the review tool's Generated answers task, on the answer as it is now, is written
    to review-stamps.json with the question it decided; `apply_review_verdicts.py --book-reviews` stamps the rows.
    The figure decisions travel in the same file (`figures`), but no row is stamped from them: the visuals table has
    no review columns.
  * Multi-part carry-over (Samuel's multipart.py, rules R1–R3, unchanged): a part asked on its own carries the
    sentence an earlier part of its question gives it (a name, an unknown's value, a gradient) after the preamble;
    what the rules cannot settle is listed in the report (`multipart.unresolved`), never changed.
  * G2, a person first: a decision in the review tool's Book questions (G2) task on a held book question (release,
    fix with the right key, hold, exclude) is applied while the question is what was decided, and a release or fix is
    stamped as that person's review.
  * G2 recommendations (book_record_g2.py: Samuel's recommender on the questions compile holds): an accept or fix an
    independent agent confirmed releases the hold, an exclude leaves the question out; each signed as the AI line's,
    applied only while the question is what the agents read, and listed in the report (`g2`).
  * Tier (tier_questions.py, Grade 10's S3 rule read twice): a person's choice in the review tool's Question tiers
    task, else the tier both readings agreed on, else the blind reading's; "standard" only for a question never tiered.
  * The book's statements (definitions, rules, cautions, conventions, printed methods, key terms, prior knowledge),
    by objective, misprints corrected, notation normalised and KaTeX-checked, go to compiled/<book>/content/<slug>.json
    (`ainext.book-statements/1`). The maths tutor reads them in learn and review mode, for book-record lessons only:
    only where AINEXT_BOOK_STATEMENTS_DIR points at that folder (app/src/lib/book-statements.ts; Tamer, 2026-10-16).
    With them, each objective's context (book_record_context.py, S1C; Tamer, 2026-10-22): the book's real-life
    openers and concept introductions as printed, and the live questions set in a real situation (`real_life_questions`), from the
    two readings' agreements and the review tool's Context decisions; a held passage is never written.

WHAT THE OLD ASSEMBLY DID ON THE WAY TO THE TUTOR, DONE HERE TOO (teachability, 2026-10-16)
  * Notation, by the book's PRINTED notation (book config `printed_notation.decimal`, default "point"): a
    decimal-comma book goes through assemble_lesson_bundle.normalise (decision 15); a decimal-point book (Prep-3)
    only has its list commas spaced ("{2,3}" → "{2, 3}": unspaced, the app's readers take 2,3 for a decimal), its
    `(x; y)` pairs written `(x, y)`, the Arabic separators ٫ and ، read as the comma they stand for, aligned maths
    made inline and nested `$` undone. Objective labels and descriptions never get the decimal rule.
  * KaTeX: every `$…$` a student or the tutor reads is rendered with the app's own KaTeX (katex_check.mjs). A
    question that fails is held (`hold_reason: katex_error`); an objective that fails stops the compile.
  * Guards: every bundle is validated with schemas.SeedBundle before it is written, and a field or value the app
    does not know (an unknown key, `solution_provenance: book_printed`, a tier or type outside its lists) stops the
    compile. A misprint's printed text reaching a question it was corrected for stops it too.
  * Identity: lessons no existing bundle holds (a new curriculum) get their own bundle per module, with the book
    config's own program and course and the lesson map's modules; nothing is borrowed from another course. The
    report says when the course is not yet in the app's course registry (app/src/lib/courses.ts) or a lesson has
    no title in the book config: until then the app cannot teach it.
After loading, `app/scripts/lesson-smoke.mts` builds every compiled lesson with the app's own lesson code.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "groundtruth"))
import answer_gen as AG  # noqa: E402  (with_intended, NEEDS_PAGE)
import assemble_lesson_bundle as ALB  # noqa: E402  (normalise, …, katex_errors, the figure rules A8 / answer 37d)
import book_record_figures as BRF  # noqa: E402  (figure_users, answer_figures)
import figure_tasks as FT  # noqa: E402  (the tasks a student works on a figure)
import crop_figures as CF  # noqa: E402  (figures_dir, crop_name)
import multipart as MP  # noqa: E402  (Samuel's carry-over rules R1–R3)
import schemas  # noqa: E402
import score_book_record as SC  # noqa: E402
from collections import Counter  # noqa: E402
from pydantic import ValidationError  # noqa: E402

FORMAT_REPORT = "ainext.compile-report/2"
# a part names its figure: "(figure 2)", "Figure 3:", "fig. 1"
FIGURE_OF_PART = re.compile(r"\bfig(?:ure)?\.?\s*\(?\s*(\d+)", re.I)
VERSION = "compile-v3"  # v3: figures, unanswerable holds, library entries, printed-answer checks, human stamps
NUM = r"-?\d+(?:\.\d+)?(?:/\d+)?"
# A question that points the student at a printed picture ("on the Z × Z net", "in the previous diagram"): without
# the picture it cannot be answered, so it is held. Narrower than answer_gen.NEEDS_PAGE, which only decides when
# the answering model is shown the page ("the following" there is a list, not a picture).
FIGURE_NEEDED = re.compile(r"\b(?:in|on|from|by) the (?:[\w×]+ ){0,4}(?:figures?|graphs?|diagrams?|nets?|grids?|drawings?|pictures?)\b"
                           r"|\b(?:following|previous|opposite) (?:\w+ )?(?:figures?|graphs?|diagrams?|nets?|grids?)\b", re.I)


# ============================================================================ teachability: notation, KaTeX, guards
# A list comma with no space after it, between two things a list holds (a digit, a letter, a closing bracket and an
# opening one): "{2,3}", "(a,-1),(b,0)". Never a LaTeX `\,` (thin space) or `{,}` (a decimal comma).
LIST_COMMA = re.compile(r"(?<=[0-9A-Za-z)\]}]),(?=[-0-9A-Za-z(\[\\])")
ARABIC_SEPARATOR = re.compile(r"\s*[٫،]\s*")


def normalise(text: str | None, decimal: str, counts: Counter, objective: bool = False) -> str | None:
    """Student-facing text in the app's notation, by the book's printed decimal (see the module docstring)."""
    if not isinstance(text, str) or not text:
        return text
    t, n = ARABIC_SEPARATOR.subn(", ", text)
    counts["arabic_separator"] += n
    if decimal == "comma" and not objective:
        t, c = ALB.normalise(t)
        counts.update(c)
    else:
        t, n = ALB._ALIGN_ENV.subn(lambda m: f"\\{m.group(1)}{{{ALB._INLINE_ENV[m.group(2)]}}}", t)
        counts["aligned"] += n
        t, n = LIST_COMMA.subn(", ", t)
        counts["list_comma"] += n
        t, c = ALB.normalise_pairs(t)
        counts.update(c)
    t, n = ALB.normalise_nested_dollars(t)
    counts["nested_dollars"] += n
    return t


def normalise_question(q: dict, decimal: str, counts: Counter) -> None:
    q["stem"] = normalise(q["stem"], decimal, counts)
    q["solution"] = [normalise(s, decimal, counts) for s in q["solution"]]
    if q["type"] != "numeric":  # a numeric key is read by grade() as a number: never rewritten
        q["answer"] = normalise(q["answer"], decimal, counts)
    if isinstance(q.get("choices"), dict) and "marker" in q["choices"]:
        q["choices"]["marker"]["key"] = normalise(q["choices"]["marker"]["key"], decimal, counts)


def normalise_spec(spec, decimal: str, counts: Counter):
    """The text a figure draws (ALB.SPEC_TEXT_KEYS: a point's label, a scene's text), in the book's notation."""
    if isinstance(spec, dict):
        return {k: (normalise(x, decimal, counts) if k in ALB.SPEC_TEXT_KEYS and isinstance(x, str) else normalise_spec(x, decimal, counts))
                for k, x in spec.items()}
    if isinstance(spec, list):
        return [normalise_spec(x, decimal, counts) for x in spec]
    return spec


def katex_rows(questions: list[dict], objectives: list[dict]) -> list[dict]:
    rows = []
    for q in questions:
        rows.append({"where": f"{q['id']}|stem", "text": q["stem"]})
        rows += [{"where": f"{q['id']}|solution[{i}]", "text": s} for i, s in enumerate(q["solution"])]
        if q["type"] != "numeric":
            rows.append({"where": f"{q['id']}|answer", "text": q["answer"]})
    for o in objectives:
        rows += [{"where": f"{o['id']}|{k}", "text": o.get(k)} for k in ("label", "description")]
    return rows


QUESTION_KEYS = set(schemas.Question.model_fields)
NODE_KEYS = set(schemas.Node.model_fields)


def guard_bundle(b: dict, name: str) -> list[str]:
    """Everything the app would not know, before the bundle is written: unknown keys, values outside its lists."""
    errs = []
    for q in b.get("questions") or []:
        extra = set(q) - QUESTION_KEYS
        if extra:
            errs.append(f"{name}: {q.get('id')}: fields the app does not know: {sorted(extra)}")
    for n in b.get("nodes") or []:
        extra = set(n) - NODE_KEYS
        if extra:
            errs.append(f"{name}: {n.get('id')}: node fields the app does not know: {sorted(extra)}")
    try:
        schemas.SeedBundle.model_validate(b)
    except ValidationError as e:
        errs += [f"{name}: {'/'.join(map(str, x['loc']))}: {x['msg'][:200]}" for x in e.errors()[:20]]
    return errs


def misprint_leaks(record: dict, questions: list[dict]) -> list[str]:
    """A misprint's printed text in a question made from the item it was corrected for: the tutor would teach it."""
    out, by_item = [], {}
    for q in questions:
        by_item.setdefault(q["_item"], []).append(q)
    for r in record.get("items") or []:
        for holder in [r] + list(r.get("parts") or []):
            for m in holder.get("misprints") or []:
                if m.get("field") == "quote" or not m.get("printed") or m["printed"] == m.get("intended"):
                    continue
                for q in by_item.get(r["id"], []):
                    text = " ".join([q["stem"], *q["solution"]])
                    if m["printed"] in text and m.get("intended", "") not in text:
                        out.append(f"{q['id']}: still says {m['printed']!r} (meant {m.get('intended')!r})")
    return out


def rel(p: str | Path) -> Path:
    p = Path(p)
    return p if p.is_absolute() else REPO / p


def lo_of(slug: str, objective_id: str) -> str:
    return f"lo:{slug}-{int(objective_id.rsplit('-', 1)[1])}"


def in_lessons(lo: str, slugs: list[str]) -> bool:
    return any(str(lo).startswith(f"lo:{s}-") for s in slugs)


# ============================================================================ marking, with what the app has
def answer_type(ans: str, marker_kinds: bool = True):
    """(type, choices, answer) the app can mark today, or None. Deterministic: no model. `marker_kinds=False` keeps
    to the forms typed before the marker kinds were added (a worked example: Tamer, 2026-10-18, no change for them)."""
    a = str(ans or "").replace("$", "").strip().rstrip(".")
    a = re.sub(r"\\[,;! ]", " ", a).replace("−", "-").replace("\\{", "{").replace("\\}", "}")
    a = re.sub(r"\s+", " ", a).strip()
    if re.fullmatch(NUM, a):
        # a fraction goes to the marker: grade() reads parseFloat("3/7") as 3, so a numeric "3/7" marked the right
        # answer wrong and "3" right (found 2026-10-29, ten live Prep 3 questions); the marker compares values
        if "/" in a:
            spec = {"kind": "expression", "key": a, "variables": []}
            if _reads(spec):
                return "short", {"marker": spec}, a
        return "numeric", None, a
    # values of a function, "f(-2) = 9, f(0) = 3, f(\\sqrt{3}) = 6-\\sqrt{3}": the values, in any order (the app's
    # marker reads no function name; Grade 10's typing makes several values a `values` key the same way)
    fv = re.findall(r"\b[a-zA-Z]_?\d?\(([^()=]*)\)\s*=\s*([^,;]+?)(?=\s*(?:[,;]|\band\b|$))", a)
    if len(fv) >= 2 and re.sub(r"\b[a-zA-Z]_?\d?\([^()=]*\)\s*=\s*[^,;]+?(?=\s*(?:[,;]|\band\b|$))|[,;\s]|\band\b", "", a) == "":
        key = ", ".join(v.strip() for _, v in fv)
        return "short", {"marker": {"kind": "values", "key": key}}, key
    asg = re.findall(rf"\b([a-zA-Z])\s*=\s*({NUM})", a)
    if asg and re.sub(rf"\b[a-zA-Z]\s*=\s*{NUM}|[,;\s]|\band\b", "", a) == "":
        key = ", ".join(f"{v} = {x}" for v, x in asg)
        return "short", {"marker": {"kind": "values", "key": key, "variables": list(dict.fromkeys(v for v, _ in asg))}}, key   # each once
    pair = re.fullmatch(rf"(?:[A-Za-z]\w*\s*(?:is|=)\s*)?\(\s*({NUM})\s*,\s*({NUM})\s*\)", a)
    if pair:
        key = f"({pair.group(1)}, {pair.group(2)})"
        return "short", {"marker": {"kind": "coordinates", "key": key}}, key
    body = re.sub(r"^[A-Za-z]\w*(?:\s*[×x]\s*[A-Za-z]\w*)?\s*(?:=|∈)\s*", "", a)  # "X × Y = {…}", "X ∈ {…}" → "{…}"
    if re.fullmatch(r"\{.*\}", body) and re.search(r"\d|\(", body):
        elems = re.findall(r"\([^()]*\)|[^{},()\s][^{},()]*", body[1:-1])
        letters = sorted({c for e in elems for c in re.findall(r"(?<![A-Za-z\\])[a-zA-Z](?![A-Za-z])", e)})
        if elems and all(re.fullmatch(rf"\(\s*(?:{NUM}|[a-zA-Z])\s*,\s*(?:{NUM}|[a-zA-Z])\s*\)|{NUM}", e.strip()) for e in elems):
            key = "\\{" + ", ".join(re.sub(r"\s*,\s*", ", ", e.strip()) for e in elems) + "\\}"
            return "short", {"marker": {"kind": "values", "key": key, "variables": letters}}, key
    yn = re.match(r"(?i)(yes|no)\b", a)
    if yn:  # "Yes, it is a polynomial (degree 3)": the plain check marks the word
        return "short", None, yn.group(1).capitalize()
    if re.fullmatch(r"[A-Za-z][A-Za-z\- ]{0,40}", a) and len(a.split()) <= 4:
        return "short", None, a
    if not marker_kinds:
        return None
    return measure_type(a) or marker_type(a)


# A single measure, a count or a comparison sign (Tamer, 2026-10-29: "mark more answer forms"). Exercises only, like
# the marker kinds. Each is a plain `numeric` key, which today's grade() reads from the start of what is typed, so
# "40°", "40 degrees", "5 cm" and "2 circles" all mark against 40 / 5 / 2. Not taken: several values in one answer
# ("," ";" "and" "or"), an approximation ("≈"), more than two decimal places (the precision asked is not known), an
# angle in degrees, minutes and seconds, and a count followed by a working sentence.
UNIT = r"(?:°|degrees?|cm²|cm\^?2|cm|mm|km|m)"


def measure_type(a: str):
    if re.fullmatch(r"[<>=]", a):                       # "complete with <, > or =": the sign is the answer
        return "short", None, a
    if re.search(r"[,;≈']|\b(?:and|or)\b", a):
        return None
    last = a.rsplit("=", 1)[-1].strip()                 # "m(arc BD) = 32°", "m(AB) = m(∠AMB) = 50°": the value
    m = re.fullmatch(rf"({NUM})\s*{UNIT}", last)       # a unit always: "x - 3 = 0" is an equation, not the number 0
    if m and "/" not in m.group(1) and len((m.group(1).split(".") + [""])[1]) <= 2:
        return "numeric", None, m.group(1)
    c = re.fullmatch(r"(\d+)\s+(?:[A-Za-z]+)?\s*(?:\([^()]*\))?", a)   # "2 circles", "1 (one tangent only)"
    if c and c.group(0).strip() != c.group(1):
        return "numeric", None, c.group(1)
    return None


# An answer of several parts, split so each part the app can mark is asked on its own (Tamer, 2026-10-29: "split
# multi-part answers"). Only where the parts line up with the question without guessing:
#   numbered   "1) …; 2) …", "Part 1: …. Part 2: …"         → "Answer only part (2)."
#   named      every part "name = value" ("x = 45, m(arc AB) = 158°", "n(x) = …, domain R - {0}") → "Answer only: x = ?"
#   blanks     as many parts as the question has blanks (……), in order ("on; MA = r") → "Answer only the 2nd blank."
# A part with "≈", sin/cos/tan, or a value the app cannot mark is left out (the others are still asked); an answer
# with an inequality, a question that asks for a proof, or one whose parts line up with nothing is not split at all.
# The whole answer still teaches, as the library worked example it was.
BLANK = re.compile(r"(?:\\ldots|\\dots|…|\.{3,}|\\cdots)(?:\s*(?:\\ldots|\\dots|…|\.{2,}|\\cdots))*")
ORD = {1: "1st", 2: "2nd", 3: "3rd"}


def _split_top(a: str, seps: str = r",|;|\band\b|\.\s+(?=[A-Za-z(])") -> list[str]:
    """Split at separators outside brackets: "R - {-3, 3}" and "(2, -2)" stay whole."""
    out, depth, cur, i = [], 0, "", 0
    sep = re.compile(seps)
    while i < len(a):
        ch = a[i]
        if ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth = max(0, depth - 1)
        if depth == 0:
            m = sep.match(a, i)
            if m and m.end() > i:
                out.append(cur)
                cur, i = "", m.end()
                continue
        cur += ch
        i += 1
    out.append(cur)
    return [x.strip().rstrip(".") for x in out if x.strip().rstrip(".")]


def _value_type(v: str):
    v = re.sub(r"\s*\((?=[^()]*[A-Za-z=])[^()]*\)\s*$", "", v).strip()   # "6 cm (ME = MO)" → "6 cm"
    if not v or "≈" in v or re.search(r"\b(?:sin|cos|tan)\b", v):
        return None
    t = answer_type(v)
    if t and t[0] == "short" and not t[1] and len(t[2].split()) > 2:
        return None   # a phrase checked letter for letter ("the point M"): too easy to type right and be marked wrong
    if t and (t[1] or {}).get("marker", {}).get("kind") == "interval" and "!=" in t[2]:
        return None   # "R - {3}": the app's marker cannot read the book's notation in an answer yet (2026-10-29)
    return t


def answer_parts(ans: str, stem: str) -> list[tuple[str, tuple]]:
    a = str(ans or "").replace("$", "").strip()
    if re.search(r"[<>≤≥≠]|\\(?:le|ge|neq)\b|\bsee steps\b|\b(?:Row|Case|Observation)\b", a) or re.search(r"\bprove\b", stem or "", re.I):
        return []
    num = [m for m in re.finditer(r"(?:^|[;.]\s*)\(?(\d)\)\s*|(?:^|\.\s*)Part (\d):\s*", a)]
    if len(num) >= 2:
        bodies = [a[m.end():(num[k + 1].start() if k + 1 < len(num) else len(a))].strip().rstrip(";.") for k, m in enumerate(num)]
        out = []
        for m, b in zip(num, bodies):
            t = _value_type(b) if "=" not in b else (measure_type(b) or _value_type(b.rsplit("=", 1)[1]) if len(_split_top(b)) == 1 and b.count("=") == 1 and re.fullmatch(r"[A-Za-z][\w() ∠]*", b.split("=")[0].strip()) else None)
            if t:
                out.append((f"Answer only part ({m.group(1) or m.group(2)}).", t))
        return out
    segs = [x for x in _split_top(a) if not re.match(r"(?i)(?:so|thus|we notice|therefore|where)\b", x)]
    if len(segs) < 2:
        return []
    blanks = len(BLANK.findall(stem or ""))
    out = []
    named = all("=" in x or re.match(r"(?i)domain\b", x) for x in segs)
    if named:
        fn = None   # the function a following "domain …" belongs to: "n1(x) = …, domain R - {3}"
        fns = {re.match(r"([A-Za-z]\w*)\(x\)", x).group(1) for x in segs if re.match(r"[A-Za-z]\w*\(x\)\s*=", x)}
        for x in segs:
            if re.match(r"(?i)domain\b", x) and "=" not in x:
                name, val = "the domain", re.sub(r"(?i)^domain\s*", "", x)
            else:
                name, val = x.split("=", 1)[0].strip(), x.rsplit("=", 1)[1].strip()
                name = "the domain" if name.lower() == "domain" else name
                m = re.match(r"([A-Za-z]\w*)\(x\)$", name)
                fn = m.group(1) if m else fn
            if name == "the domain" and len(fns) > 1 and fn:
                name = f"the domain of {fn}"
            if re.search(r"\bis\b", val):
                continue
            t = _value_type(val)
            if t:
                out.append((f"Answer only: {name} = ?", t))
        return out
    if blanks == len(segs):
        for k, x in enumerate(segs, 1):
            pre = re.escape(x.split("=", 1)[0].strip()) if "=" in x else None
            if "=" in x and not re.search(pre + r"\s*=\s*" + BLANK.pattern, stem or ""):
                continue   # "MA = r" filling "because ……": the blank is the whole relation, not a value
            t = _value_type(x.rsplit("=", 1)[1] if "=" in x else x)
            if t:
                out.append((f"Answer only the {ORD.get(k, f'{k}th')} blank.", t))
        return out
    return []


# The app's marker reads more than the forms above (answer-marker.ts MARKER_KINDS): an expression, an equation, a surd,
# an interval or a set of real numbers, and values with names. Tamer, 2026-10-18: "extend compile's answer typer to the
# app marker's expression, equation, surd and interval kinds and sets with named elements". Each key is proposed here
# and kept only when the app's own marker reads it and marks it correct (marker_check.mjs, the check compile runs on
# every key); otherwise the answer stays as before: not markable, kept as a worked example. Not proposed: an angle in
# degrees, minutes and seconds, and a ratio (a : b : c), which no marker kind marks as the book means them.
SQRT = re.compile(r"√\s*(\d+(?:\.\d+)?|[A-Za-z]|\([^()]*\))")
LETTER = re.compile(r"(?<![A-Za-z\\])[a-zA-Z](?![A-Za-z])")


def _latex(a: str) -> str:
    a = SQRT.sub(lambda m: "\\sqrt{" + m.group(1).strip("()") + "}", a)
    return a.replace("×", "\\times ").replace("÷", "\\div ").replace("·", "\\cdot ")


def _letters(a: str) -> list[str]:
    bare = re.sub(r"\\[a-zA-Z]+", " ", a)
    return sorted(set(LETTER.findall(bare)))


_KEY_OK: dict[str, bool] = {}


def _reads(spec: dict) -> bool:
    """The app's marker reads this key and marks it correct (marker_check.mjs, one row)."""
    k = json.dumps(spec, sort_keys=True)
    if k not in _KEY_OK:
        _KEY_OK[k] = not marker_check([{"id": "q:typer", "choices": {"marker": spec}}])
    return _KEY_OK[k]


def marker_type(a: str):
    if re.search(r"°|'|:|\b(?:is|are|so|because|than|the|and then)\b", a):   # degrees, ratios, sentences
        return None
    cands = []
    # R − {0, −1}: the reals but some values, as the interval kind's restrictions
    m = re.fullmatch(r"(?:\\mathbb\{R\}|R|ℝ)\s*(?:-|\\setminus|\\backslash)\s*\{([^{}]*)\}", a)
    if m:
        vals = [v.strip() for v in m.group(1).split(",") if v.strip()]
        if vals:
            cands.append({"kind": "interval", "key": " and ".join(f"x != {_latex(v)}" for v in vals), "variables": ["x"]})
    # x = 3 or x = 1: named values, any order
    named = re.findall(rf"\b([a-zA-Z])\s*=\s*([^,;=]+?)(?=\s*(?:,|;|\bor\b|\band\b|$))", a)
    if named and re.sub(rf"\b[a-zA-Z]\s*=\s*[^,;=]+?(?=\s*(?:,|;|\bor\b|\band\b|$))|[,;\s]|\bor\b|\band\b", "", a) == "":
        cands.append({"kind": "values", "key": ", ".join(f"{v} = {_latex(x.strip())}" for v, x in named),
                      "variables": sorted({v for v, _ in named})})
    # a set whose elements are names or pairs of names: {(a, Science), (b, History)}
    body = re.sub(r"^[A-Za-z]\w*(?:\s*[×x]\s*[A-Za-z]\w*)?\s*=\s*", "", a)
    if re.fullmatch(r"\{.*\}", body):
        elems = re.findall(r"\([^()]*\)|[^{},()\s][^{},()]*", body[1:-1])
        names = sorted({w for e in elems for w in re.findall(r"[A-Za-z]\w*", re.sub(r"\\[a-zA-Z]+", " ", e))})
        if elems:
            key = "\\{" + ", ".join(re.sub(r"\s*,\s*", ", ", e.strip()) for e in elems) + "\\}"
            cands.append({"kind": "values", "key": key, "variables": names})
    if a.count("=") == 1 and _letters(a):
        cands.append({"kind": "equation", "key": _latex(a), "variables": _letters(a)})
    if "=" not in a and _letters(a) and re.search(r"[+\-*/^()]|\\frac|√|\d", a):
        cands.append({"kind": "expression", "key": _latex(a), "variables": _letters(a)})
    if "=" not in a and not _letters(re.sub(r"\\sqrt|\\frac", "", a)) and ("√" in a or "\\sqrt" in a):
        cands.append({"kind": "surd", "key": _latex(a)})
    if "=" not in a and not _letters(re.sub(r"\\frac", "", a)) and re.search(r"\d", a) and re.search(r"/|\\frac", a):
        cands.append({"kind": "expression", "key": _latex(a), "variables": []})
    for spec in cands:   # a variable the bundle schema refuses (a word such as "Science") cannot be keyed at all
        if any(not schemas._VARIABLE_RE.match(v) for v in spec.get("variables") or []):
            continue
        if _reads(spec):
            return "short", {"marker": spec}, spec["key"]
    return None


# ============================================================================ answers
def _review_task(name: str):
    """groundtruth/review/<name>.py, a task of the review tool (answers: Generated answers; generated: Generated
    content, its Figures): its fingerprint is what a decision signs."""
    import importlib.util  # noqa: PLC0415
    spec = importlib.util.spec_from_file_location(f"review_{name}", HERE / "groundtruth" / "review" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def usable_answers(book: str, slug: str, record: dict, record_path: Path, decided: dict | None = None) -> dict[str, dict]:
    """ref (in THIS record's ids) → answer: approved, or agreed by both readings with no failed check and no decision.
    A decision counts only for the answer it was made on (its fingerprint, as the review tool shows it): an answer
    made again after it comes back as undecided. `decided` collects every decision on this lesson (ref → decision),
    for the human stamps (review-stamps.json)."""
    p = HERE / "teaching" / book / "answers" / f"{slug}.json"
    if not p.exists():
        return {}
    data = json.loads(p.read_text())
    alias = {}
    src = HERE / data["source"]
    if src.resolve() != record_path.resolve() and src.exists():  # made from the lesson's ground truth: pair its ids
        pairs, _m, _i = SC.match(record.get("items") or [], json.loads(src.read_text()).get("items") or [])
        alias = {g["id"]: e["id"] for g, e, _ in pairs}
    dp = HERE / "reviews" / book / "generated-answers.json"
    decisions = {d["ref"]: d for d in json.loads(dp.read_text()).get("decisions", [])} if dp.exists() else {}
    RA = _review_task("answers")
    out = {}
    for a in data.get("answers") or []:
        rid = alias.get(a["record_id"], a["record_id"])
        ref = f"{rid}:{a['part']}" if a.get("part") else rid
        dec = decisions.get(a["ref"])
        if dec and dec.get("fingerprint") != RA.fingerprint(a):
            dec = None   # decided on an earlier answer: this one is undecided
        if dec and decided is not None:
            decided[ref] = dec
        if dec and dec["decision"] == "approve":
            how = f"generated, approved by {dec['by']}"
        elif not dec and a.get("status") == "agreed":
            how = "generated, both readings agree, not yet reviewed"
        else:
            continue
        out[ref] = {"answer": a["answer"], "solution": a["solution"], "how": how, "needs_page": a.get("needs_page"), "decision": dec}
    return out


def question_tiers(book: str, slug: str) -> dict[str, tuple[str, str]]:
    """ref → (tier, where it came from), from tier_questions.py (Grade 10's S3 rule, read twice): a person's choice in
    the review tool's Question tiers task (on the question as it is now), else the tier both readings agreed on, else
    the blind reading's (Grade 10: the check wins). A ref with none is "standard" (the caller's default)."""
    p = HERE / "teaching" / book / "tiers" / f"{slug}.json"
    if not p.exists():
        return {}
    dp = HERE / "reviews" / book / "question-tiers.json"
    decisions = {d["ref"]: d for d in json.loads(dp.read_text()).get("decisions", [])} if dp.exists() else {}
    out = {}
    for t in json.loads(p.read_text()).get("tiers") or []:
        d = decisions.get(t["ref"])
        if d and d.get("fingerprint") == t["question_fingerprint"]:
            out[t["ref"]] = (d["tier"], f"chosen by {d['by']}")
        elif t.get("status") == "agreed":
            out[t["ref"]] = (t["tier"], "both readings")
        elif t.get("tier"):
            out[t["ref"]] = (t["tier"], "the blind reading (the readings disagree; not decided yet)")
    return out


def printed_checks(book: str, slug: str) -> dict[str, dict]:
    """ref → the blind re-solve of a printed answer (answer_gen.py check-printed): agreed | disagreed | cannot_answer."""
    p = HERE / "teaching" / book / "printed-checks" / f"{slug}.json"
    return {c["ref"]: c for c in json.loads(p.read_text()).get("checks") or []} if p.exists() else {}


# ============================================================================ the lesson
def objectives_for_items(record: dict) -> dict[str, str]:
    """item id → objective id; an item the extractor left without one takes the nearest assigned record on its page."""
    items = record.get("items") or []
    out = {r["id"]: r["lo"] for r in items if r.get("lo")}
    for i, r in enumerate(items):
        if r["id"] in out or r["type"] not in QUESTION_SOURCES:
            continue
        near = sorted((abs(j - i), j) for j, x in enumerate(items) if x.get("lo") and x.get("source_page") == r.get("source_page"))
        near = near or sorted((abs(j - i), j) for j, x in enumerate(items) if x.get("lo"))
        if near:
            out[r["id"]] = items[near[0][1]]["lo"]
    return out


def lesson_objectives(slug: str, record: dict, syllabus_ref: str | None) -> list[dict]:
    nodes = []
    for o in record["learning_objectives"]:
        pages = sorted({it["source_page"] for it in record["items"] if it["id"] in o["evidence"]})
        nodes.append({"id": lo_of(slug, o["id"]), "kind": "learning_objective", "label": o["label"], "description": o["description"],
                      "source_page": pages[0] if pages else record["lesson"]["pages"][0],
                      "syllabus_ref": syllabus_ref or record["lesson"].get("syllabus_ref"), "order_in_parent": o["order_in_parent"]})
    return nodes


QUESTION_SOURCES = ("exercise", "worked_example", "activity", "open_prompt")


def apply_g2(book: str, questions: dict[str, list[dict]], report: dict) -> None:
    """Samuel's G2 recommendations on held book questions (book_record_g2.py → teaching/<book>/g2/unit<NN>.json), applied
    to the question each was made for and only while it is still what the agents read. Every verdict is an AI line's:
    signed `auto-pass G2 (AI recommendation)`, never a person's sign-off."""
    import hashlib  # noqa: PLC0415
    import review_policy  # noqa: PLC0415
    by = review_policy.auto_pass_by("G2")
    # a PERSON's decision in the review tool's Book questions (G2) task wins over any recommendation
    pf = HERE / "reviews" / book / "book-questions-g2.json"
    people = {d["question"]: d for d in json.loads(pf.read_text()).get("decisions", [])} if pf.exists() else {}
    held_fp = lambda q: hashlib.sha256(json.dumps({"stem": q.get("stem"), "answer": q.get("answer"), "hold_reason": q.get("hold_reason")},
                                                  sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]   # groundtruth/review/book_questions.fingerprint
    recs = {}
    for f in sorted((HERE / "teaching" / book / "g2").glob("unit*.json")):
        d = json.loads(f.read_text())
        for k, v in d.get("items", {}).items():
            if k in d.get("questions", {}):
                recs[d["questions"][k]["question"]] = (v, d["questions"][k])
    for slug, qs in questions.items():
        keep = []
        for q in qs:
            d = people.get(q["id"])
            if d and q.get("hold_reason") and d.get("fingerprint") == held_fp(q):
                line = {"question": q["id"], "ref": d.get("ref"), "verdict": d["choice"], "by": f"{d['by']} (review tool)", "applied": True,
                        **({"note": d["note"]} if d.get("note") else {})}
                report["g2"].append(line)
                if d["choice"] == "exclude":
                    report["skipped"].append({"lesson": slug, "ref": d.get("ref") or q["id"], "why": f"left out at G2 by {d['by']}: {d.get('note') or ''}".strip(": ")})
                    report["held"] = [h for h in report["held"] if h.get("question") != q["id"]]
                    continue
                if d["choice"] in ("release", "fix"):
                    if d["choice"] == "fix":
                        typed = answer_type(d["key"])
                        if not typed:
                            line.update(applied=False, why=f"the fixed key {d['key']!r} is not one the app can mark: decide it again")
                            keep.append(q)
                            continue
                        q["type"], q["answer"] = typed[0], typed[2]
                        q.pop("choices", None)
                        if typed[1]:
                            q["choices"] = typed[1]
                        bad = marker_check([q])   # the app's own reader, as for every key
                        if q["id"] in bad:
                            q["hold_reason"] = "unanswerable"
                            line.update(applied=False, why=f"the app's marker cannot mark the fixed key: {bad[q['id']]}")
                            keep.append(q)
                            continue
                    q.pop("hold_reason", None)
                    q.pop("_why", None)
                    q["verified"] = True
                    q["source_note"] += (f" {'Answer fixed' if d['choice'] == 'fix' else 'Released'} at G2 by {d['by']}"
                                         + (f": {d['note']}" if d.get("note") else "") + ".")
                    q["_decision"] = {"decision": "approve", "by": d["by"], "at": d["at"], "fingerprint": d["fingerprint"]}
                    q["_stamp_what"] = "book question at G2"
                    report["held"] = [h for h in report["held"] if h.get("question") != q["id"]]
                keep.append(q)   # hold: stays held, no recommendation applies
                continue
            hit = recs.get(q["id"])
            if not hit:
                keep.append(q)
                continue
            v, meta = hit
            now = {"stem": q.get("stem"), "answer": q.get("answer"), "hold_reason": q.get("hold_reason")}
            if now != meta["facts"]:
                report["g2"].append({"question": q["id"], "verdict": v["verdict"], "applied": False,
                                     "why": "the question changed since the agents read it: run book_record_g2.py again"})
                keep.append(q)
                continue
            line = {"question": q["id"], "ref": meta["book_ref"], "verdict": v["verdict"], "class": v.get("class"),
                    "confidence": v.get("confidence"), "note": v.get("note"), "by": by, "applied": True}
            if v["verdict"] == "exclude":
                report["skipped"].append({"lesson": slug, "ref": meta["book_ref"], "why": f"excluded by the G2 recommendation ({by}): {v.get('note')}"})
                report["g2"].append(line)
                continue
            if v["verdict"] in ("accept", "fix"):
                f = v.get("fields") or {}
                if f.get("stem"):
                    q["stem"] = f["stem"]
                if f.get("answer_type") == "numeric":
                    q["type"], q["answer"] = "numeric", f["answer"]
                    q.pop("choices", None)
                elif f.get("answer_type") == "expression" and f.get("marker"):
                    q["type"], q["answer"], q["choices"] = "short", f["marker"]["key"], {"marker": f["marker"]}
                q.pop("hold_reason", None)
                q.pop("_why", None)
                q["verified"] = True
                q["source_note"] += f" Released by the G2 recommendation ({v['verdict']}, {by}; confirmed by an independent agent)."
                report["held"] = [h for h in report["held"] if h.get("question") != q["id"]]
            report["g2"].append(line)
            keep.append(q)
        qs[:] = keep


PREAMBLE_END = "⁂."   # closes a preamble the book prints without a stop, for multipart.py's eyes only


def carry_over(record: dict, out: list[dict], stems: dict[str, tuple[str, str, str]], unresolved: list | None) -> None:
    """Samuel's multipart.py on a lesson's multi-part items: a part asked on its own carries what an earlier part of
    its question defines (a name, an unknown's value, a gradient), in the book's words, after the shared preamble.
    His rules group parts by Grade 10 refs (`Ex<a>-<b>:<q><sub>`), so each item gets a stand-in ref, its parts lettered
    in printed order; every part takes part, the asked and the not asked, since an earlier part defines a name either
    way. What the rules cannot settle is listed (`unresolved`), never changed.
    His rules find the shared preamble by its closing stop or colon; Prep-3 prints "… Find" with none, so the preamble
    is closed with a marker for the rules to read, taken out again before a stem reaches a student."""
    qs_by_ref = {q["_ref"]: q for q in out}
    parts, back = [], {}
    for i, it in enumerate(x for x in record.get("items") or [] if len(x.get("parts") or []) >= 2):
        for k, p in enumerate(it["parts"]):
            ref = f"{it['id']}:{p['label']}"
            sub = chr(97 + k) if k < 26 else "z" + chr(97 + k - 26)
            stand_in = f"Ex{i + 1}-1:1{sub}"
            back[stand_in] = ref
            q = qs_by_ref.get(ref)
            marker = ((q or {}).get("choices") or {}).get("marker") or {}
            key = q["answer"] if q and q["type"] == "numeric" else marker.get("key")
            pre, own, working = stems.get(ref, ("", "", ""))
            closed = f"{pre} {PREAMBLE_END} {own}" if pre and not pre.rstrip().endswith((".", ":", "?", "!")) else f"{pre} {own}"
            parts.append(MP.Part(ref=stand_in, stem=closed.strip(), working=working,
                                 fate="verified" if q and not q.get("hold_reason") else ("held" if q else "teaching"),
                                 kind=marker.get("kind"), key=key or None))
    if not parts:
        return
    carries, unres = MP.plan(parts)
    for stand_in, c in carries.items():
        q = qs_by_ref.get(back[stand_in])
        if q is None:
            continue
        q["stem"] = re.sub(r"\s+", " ", c.after.replace(PREAMBLE_END, "")).strip()
        q["source_note"] += f" The part carries {len(c.sentences)} sentence(s) from earlier parts ({MP.CARRY_BY})."
        q["_carry"] = {"ref": back[stand_in], "sentences": c.sentences, "from": [back.get(x.get("from"), x.get("from")) for x in c.items]}
    if unresolved is not None:
        unresolved += [{**u.as_dict(), "ref": back.get(u.ref, u.ref),
                        "sources": [{**s, "ref": back.get(s.get("ref"), s.get("ref"))} for s in u.sources]} for u in unres]


def book_questions(slug: str, record: dict, answers: dict, skipped: list, entries: list, checks: dict | None = None,
                   tiers: dict | None = None, unresolved: list | None = None) -> list[dict]:
    """The book's prompts as questions; a worked example (or an answered prompt) the app cannot mark goes to the
    explanation library as a worked example instead (Grade 10's `not_markable` -> library entry, FR-4303)."""
    out = []
    stems: dict[str, tuple[str, str, str]] = {}   # every part's preamble, own words and working, for the carry-over
    checks = checks or {}
    lo_by_item = objectives_for_items(record)
    for raw in record.get("items") or []:
        if raw["type"] not in QUESTION_SOURCES:
            continue
        r = AG.with_intended(raw)
        if r["type"] in ("activity", "open_prompt") and not any(ref.startswith(r["id"]) for ref in answers):
            continue   # a "Think and discuss" or "Think" prompt becomes a question only with an answer a person approved or two readings agreed on
        if r["id"] not in lo_by_item:
            skipped.append({"ref": r["id"], "why": "no objective"})
            continue
        lo = lo_of(slug, lo_by_item[r["id"]])
        text = r.get("text") or r.get("stem") or ""
        holders = [(p, f"{r['id']}:{p['label']}") for p in r.get("parts") or []] or [(None, r["id"])]
        kept_as_entry = False
        for p, ref in holders:
            h = p or r
            printed = h.get("answer") or (r.get("answer") if p is None else None)
            gen = answers.get(ref)
            # a part with its own words is asked on its own: the book's label ("(A)") is how the page lists it, not
            # part of the question. A part with none keeps it, since the label is what is asked ("point C").
            stem = f"{text} {p['stem'] if p and p.get('stem') else ('(' + p['label'] + ')' if p else '')}".strip()
            local = re.sub(r"[^a-z0-9]+", "-", ref.split(":", 1)[1].lower()).strip("-")
            stems[ref] = (text, stem[len(text):].strip() if p else "", " ".join((p or {}).get("solution") or []))
            if printed:
                ans, how = printed, "printed in the book"
                sol = (p or {}).get("solution") or r.get("solution") or []
            elif gen:
                ans, how, sol = gen["answer"], gen["how"], gen["solution"]
            elif r["type"] == "worked_example" and r.get("solution"):
                ans, how, sol = None, "printed in the book", r["solution"]
            else:
                skipped.append({"ref": ref, "why": "no usable answer yet (none printed; the generated one is not approved or not agreed)"})
                continue
            typed = answer_type(ans, marker_kinds=r["type"] != "worked_example") if ans else None
            # an answer of several parts the app cannot mark whole: each part it can mark is asked on its own
            # (answer_parts; Tamer, 2026-10-29: "split multi-part answers"). The whole answer still teaches, below.
            parts = [] if typed or not ans or r["type"] == "worked_example" else answer_parts(ans, stem)
            if not typed:
                # a worked example the book solves, or an answer a person approved / two readings agreed on, that the
                # app cannot mark: the tutor still teaches from it, as a worked example in the library
                if r["type"] == "worked_example":
                    if not kept_as_entry:
                        tail = re.sub(r"[^a-z0-9]+", "-", r["id"].split(":", 1)[1].lower()).strip("-")
                        entries.append({"id": f"expl:{lo.removeprefix('lo:')}:bk-{tail}", "lo": lo, "entry_type": "worked_example",
                                        "content": [{"kind": "problem", "text_md": text}]
                                                   + [{"step": i + 1, "text_md": x} for i, x in enumerate(r.get("solution") or sol) if x],
                                        "source_page": r["source_page"],
                                        "generated_by": f"book (book_worked: {r['id']}, printed p.{r['source_page']}); compile_book_records.py {VERSION}",
                                        "_item": r["id"]})
                        kept_as_entry = True
                    skipped.append({"ref": ref, "why": "not markable: kept as a worked example in the library", "teaching": True})
                elif gen and sol:
                    entries.append({"id": f"expl:{lo.removeprefix('lo:')}:bk-{local}", "lo": lo, "entry_type": "worked_example",
                                    "content": [{"kind": "problem", "text_md": stem}] + [{"step": i + 1, "text_md": x} for i, x in enumerate(sol) if x],
                                    "source_page": r["source_page"], "generated_by": f"answer_gen.py ({how}); compile_book_records.py {VERSION}",
                                    "_item": r["id"]})
                    skipped.append({"ref": ref, "why": f"not markable ({str(ans)[:60]}): kept as a worked example in the library", "teaching": True})
                elif not parts:
                    skipped.append({"ref": ref, "why": f"an answer the app cannot mark: {str(ans)[:90]}"})
                if parts:   # asked part by part: not a skipped prompt
                    skipped[:] = [x for x in skipped if x.get("ref") != ref]
                else:
                    continue
            variants = [("", "", typed)] if typed else [(f"-p{k}", f" {ask}", t) for k, (ask, t) in enumerate(parts, 1)]
            for suffix, ask, (qtype, choices, key) in variants:
                tier, tier_from = (tiers or {}).get(ref, ("standard", "no tier yet"))
                q = {"_item": r["id"], "_ref": ref, "_tier_from": tier_from, "id": f"q:{lo.removeprefix('lo:')}:bk-{local}{suffix}", "lo": lo, "tier": tier,
                     "type": qtype, "stem": stem + ask,
                     "answer": key, "solution": [x for x in sol if x] or [f"The book's answer: {key}"],
                     "source_page": r["source_page"], "source": "seed",
                     "source_note": f"The book's own {r['type'].replace('_', ' ')} ({ref}, printed p.{r['source_page']}); answer {how}. "
                                    + (f"Part {suffix[2:]} of {len(variants)} of its answer, asked on its own. " if suffix else "") +
                                    "Compiled from the book record (compile_book_records.py)."}
                if choices:
                    q["choices"] = choices
                if p:
                    # which part of the prompt this is, and its own words: a drill of several numbered figures shows
                    # each part only its own figure (lesson_figures, `_figure_of_part`)
                    q["_part"] = {"i": (r.get("parts") or []).index(p), "n": len(r.get("parts") or []), "words": p.get("stem") or p.get("label") or ""}
                if r["type"] == "worked_example" and printed:
                    q["solution_provenance"] = "book_worked"
                if not printed and gen:  # two independent readings agreed (or a person approved): the loader records the AI check
                    q["verified"] = True
                    if gen.get("decision"):
                        q["_decision"] = gen["decision"]
                if printed:  # the blind re-solve of a printed answer (answer_gen.py check-printed), Grade 10's S3 rule
                    c = checks.get(ref)
                    if c and c["status"] == "agreed":
                        q["verified"] = True
                    elif c and c["status"] == "disagreed":
                        q["hold_reason"] = "answer_mismatch"
                        q["_why"] = f"a blind re-solve answered {c['blind']!r}, the book prints {printed!r}"
                    elif c is None or c["status"] != "agreed":
                        q["hold_reason"] = "unverified"
                        q["_why"] = "the printed answer was not re-solved" if c is None else f"the blind re-solve could not answer ({c.get('note') or c['status']})"
                out.append(q)
    carry_over(record, out, stems, unresolved)
    return out


# ============================================================================ figures (S4's drawings and the book's pictures)
GIVEN = re.compile(r"\(\s*-?\$?\d|=")   # a coordinate or an equation in the stem: ALB.book_picture_reveals's read-off test


def with_tasks(kind: str, spec: dict, exercise: bool, context: dict | None = None) -> dict:
    """The figure's spec with the tasks a student works on it (figure_tasks.py: derived from the drawing, no model;
    VIZ_SPEC v4 `tasks`, written here and never by S4). An exercise's figure gets `marks` only. A copy: the teaching
    layer's drawing is never changed. `context`: what the lesson teaches (lesson_context)."""
    tasks = FT.tasks_for(kind, spec, exercise, context)
    return {**{k: v for k, v in spec.items() if k != "tasks"}, **({"tasks": tasks} if tasks else {})}


def lesson_context(record: dict) -> dict:
    """What a lesson's objectives teach, for the arrow-diagram tasks: whether a figure may ask "is it a function?" and
    "which values make the range?" (figure_tasks.arrow_tasks), read off the objectives' own labels and descriptions."""
    text = " ".join(f"{o.get('label') or ''} {o.get('description') or ''}" for o in record.get("learning_objectives") or []).lower()
    return {"functions": bool(re.search(r"\bfunctions?\b", text)), "range": bool(re.search(r"\brange\b", text))}


def figure_of_part(part: dict | None, n_figures: int) -> int | None:
    """Which of its prompt's numbered figures (1-based) a part is about, or None when it is about all of them: the
    figure its own words name ("(figure 2)", "Figure 3:"), else — when the prompt has one figure per part — the one
    in its own place. A prompt with one figure, or a question that is not a part, is about every figure it has."""
    if n_figures < 2 or not part:
        return None
    m = FIGURE_OF_PART.search(part.get("words") or "")
    n = int(m.group(1)) if m else (part["i"] + 1 if part["n"] == n_figures else None)
    return n if n is not None and 1 <= n <= n_figures else None


def lesson_figures(book: str, slug: str, record: dict, questions: list[dict], report: dict, stand_in_files: set,
                   book_pictures: bool = True) -> list[dict]:
    """The lesson's visuals and the figure holds, by Grade 10's rules:
      * a figure S4 drew is shown with the questions of the prompt it is printed in or that needs it (`uses_figure`),
        and on its objective when no question shows it; an exercise's drawing that draws the unknown is never shown
        (A8, ALB.visual_gives_answer), nor one that withholds the points a READ-OFF question asks for (the figure is
        the data: the book's picture is shown instead, as ALB.book_picture_reveals allows);
      * a question whose figure S4 did not draw gets the book's own picture as a stand-in (answer 37d), from its crop,
        if the crop passed its check, unless that picture draws the question's unknown (`figure_reveals_answer`);
      * a question that still has no figure is held (`figure_missing`), as is one that points at a figure no record
        links (FIGURE_NEEDED)."""
    tv_path = HERE / "teaching" / book / "visuals" / f"{slug}.json"
    tv = json.loads(tv_path.read_text()) if tv_path.exists() else {"visuals": [], "gaps": []}
    drawn = {v["figure"]: v for v in tv["visuals"]}
    gaps = {g["figure"]: g for g in tv["gaps"]}
    # the review tool's decisions on these drawings and gaps (Generated content → Figures), on each as it is now: a
    # drawing a person rejected, or sent back for a fix, is not shown; its questions get the book's picture instead
    verdicts = _review_task("generated").figure_decisions(book, {"lesson": slug, **tv})
    reviewed_out: dict[str, tuple[dict, str]] = {}
    for fid, dec in verdicts.items():
        if fid in drawn and dec["decision"] in ("reject", "fix_requested"):
            what = "rejected" if dec["decision"] == "reject" else "sent back for a fix"
            reviewed_out[fid] = (drawn.pop(fid), f"S4's drawing was {what} in review ({dec['by']}, {dec['at']}"
                                                 f"{': ' + dec['note'] if dec.get('note') else ''})")
    shown_drawing: dict[str, list[str]] = {}   # figure → the visuals that show S4's drawing of it
    ctx = lesson_context(record)
    items = {it["id"]: it for it in record.get("items") or []}
    users = BRF.figure_users(record)
    answer_figs = BRF.answer_figures(record)
    by_item: dict[str, list[dict]] = {}
    for q in questions:
        by_item.setdefault(q["_item"], []).append(q)
    visuals, n_of = [], Counter()

    def vid(base: str) -> str:
        n_of[base] += 1
        return base if n_of[base] == 1 else f"{base}-{n_of[base]}"

    def hold(q: dict, reason: str, why: str) -> None:
        if not q.get("hold_reason"):
            q["hold_reason"] = reason
            q.pop("verified", None)
            report["held"].append({"question": q["id"], "why": why})

    # ONE FIGURE PER PART (Tamer, 2026-10-20). "Study each of the following figures": the book prints several numbered
    # figures for one prompt and asks a part about each ("(figure 2)"). Each part is its own question, so it shows its
    # own figure only — all of them at once had the student hunting for the right one.
    figs_of_item: dict[str, list[str]] = {}
    for fid in items:   # record order is the book's figure order
        for it in users.get(fid, []):
            figs_of_item.setdefault(it, []).append(fid)

    def own_figure(q: dict, fid: str) -> bool:
        figs = figs_of_item.get(q["_item"], [])
        n = figure_of_part(q.get("_part"), len(figs))
        return n is None or figs[n - 1] == fid

    shown: set[str] = set()   # question ids with a figure
    for fid, fig in items.items():
        if fig["type"] != "figure" or BRF.DECORATIVE.search(fig.get("caption") or ""):
            continue
        local = fid.split(":", 1)[1]
        d = drawn.get(fid)
        qs = []
        for it in users.get(fid, []):
            if fid in answer_figs and items[it]["type"] != "worked_example":
                continue   # an exercise's drawn answer is never shown with its question
            qs += [q for q in by_item.get(it, []) if own_figure(q, fid)]
        crop = CF.figures_dir(book) / CF.crop_name(fid)
        checked = crop.exists() and (fig.get("region") or {}).get("checked")
        on_question = False
        for q in qs:
            exercise = items[q["_item"]]["type"] != "worked_example"
            if d:
                why = ALB.visual_gives_answer(q, {"spec": d["spec"]}) if exercise else None
                readoff = exercise and d.get("withheld") and not GIVEN.search(q["stem"])
                if not why and not readoff:
                    visuals.append({"id": vid(f"v:{slug}:{local}"), "lo": q["lo"], "question": q["id"], "kind": d["kind"],
                                    "spec": with_tasks(d["kind"], d["spec"], exercise, ctx),
                                    "caption": d.get("caption"), "source_page": fig["source_page"]})
                    shown_drawing.setdefault(fid, []).append(visuals[-1]["id"])
                    shown.add(q["id"])
                    on_question = True
                    continue
                report["figures"].append({"figure": fid, "question": q["id"], "native_not_shown":
                                          why or f"read off the figure, but the drawing withholds {d['withheld']}: the book's picture instead"})
            elif fid in reviewed_out:
                report["figures"].append({"figure": fid, "question": q["id"], "native_not_shown": reviewed_out[fid][1]})
            if not (checked and book_pictures):
                continue
            natives = [{"labels": [str(pt.get("label")) for pt in ALB._spec_points(d["spec"]) if pt.get("label")], "withheld": d.get("withheld") or []}] if d else []
            why = ALB.book_picture_reveals(q, natives) if exercise else None
            if why:
                hold(q, "figure_reveals_answer", f"the book's picture of {fid}: {why}")
                continue
            tail = q["id"].split(":", 2)[-1]
            native = d or (reviewed_out.get(fid) or ({}, ""))[0]
            visuals.append({"id": vid(f"v:{slug}:{tail}"), "lo": q["lo"], "question": q["id"], "kind": "book_image",
                            "spec": {"src": f"/book-figures/{book}/{crop.name}", "alt": ALB.stand_in_alt(fig["source_page"]),
                                     "stand_in": True, "native_kind_needed": (gaps.get(fid) or {}).get("needed_kind") or native.get("kind")},
                            "caption": None, "source_page": fig["source_page"]})
            stand_in_files.add(crop)
            report["stand_ins"].append({"question": q["id"], "figure": fid, "file": crop.name,
                                        "why": (gaps.get(fid) or {}).get("reason") or (reviewed_out.get(fid) or ({}, ""))[1]
                                               or "the drawing is not shown with this question"})
            shown.add(q["id"])
        if d and not on_question:   # an illustration of its objective (a body figure, or one whose prompt is teaching material)
            # the record's own filing first (the objectives call files every figure); S4's guess only for one it left out
            # S4's own guess names an objective of its day; it counts only while that objective still exists (G1 may have
            # replaced it): a figure G1 left unfiled is not shown on its own until it is filed (book_record_filing.py)
            current = {lo_of(slug, o["id"]) for o in record.get("learning_objectives") or []}
            lo = lo_of(slug, fig["lo"]) if fig.get("lo") else (d.get("lo") if d.get("lo") in current else None)
            if lo:
                # a figure an EXERCISE prints is that exercise's even when no question of it was kept (pp3u1-3 drill 1
                # asks which of its three arrow diagrams is a function, and has no answer to compile): no task answers it
                in_exercise = any(items[it]["type"] != "worked_example" for it in users.get(fid, []) if it in items)
                visuals.append({"id": vid(f"v:{slug}:{local}"), "lo": lo, "question": None, "kind": d["kind"],
                                "spec": with_tasks(d["kind"], d["spec"], in_exercise, ctx),
                                "caption": d.get("caption"), "source_page": fig["source_page"]})
                shown_drawing.setdefault(fid, []).append(visuals[-1]["id"])
        elif fid in reviewed_out and not qs:
            report["figures"].append({"figure": fid, "question": None, "native_not_shown": reviewed_out[fid][1]})
    for fid, dec in sorted(verdicts.items()):
        gap = fid in gaps
        effect = ("the book's picture stands in" if gap else f"shown as {', '.join(shown_drawing[fid])}" if fid in shown_drawing
                  else "not shown: the book's picture instead" if fid in reviewed_out else "not shown with any question")
        report["figure_reviews"].append({"lesson": slug, "figure": fid, "what": "S4 gap" if gap else "S4 drawing", "decision": dec["decision"],
                                         "by": dec["by"], "at": dec["at"], "fingerprint": dec["fingerprint"],
                                         "visuals": shown_drawing.get(fid, []), "effect": effect,
                                         **({"note": dec["note"]} if dec.get("note") else {})})
    for q in questions:
        linked = [f for f, its in users.items() if q["_item"] in its and f not in answer_figs and own_figure(q, f)]
        if q["id"] in shown:
            continue
        if linked:
            hold(q, "figure_missing", f"needs {', '.join(linked)}: not drawn, and no checked crop to show the book's picture")
        elif FIGURE_NEEDED.search(q["stem"]):
            hold(q, "figure_missing", "points at a printed figure no record links")
    return visuals


# ============================================================================ the book's statements, for the tutor
STATEMENT_TYPES = ("definition", "rule", "caution", "convention", "method", "key_term", "prior_knowledge")
STATEMENTS_FORMAT = "ainext.book-statements/1"


def lesson_statements(slug: str, record: dict, decimal: str, counts: Counter) -> dict:
    """The book's own definitions, rules, cautions, conventions, printed methods, key terms and prior knowledge for
    the lesson, misprints corrected, in the app's notation, grouped by objective in objective order (a statement the
    extractor filed under none takes the nearest filed record on its page; "the whole lesson" when there is none).
    The maths tutor reads them in learn and review mode (app/src/lib/book-statements.ts), only where the deployment
    points AINEXT_BOOK_STATEMENTS_DIR at compiled/<book>/content/."""
    items = record.get("items") or []
    order = {o["id"]: o["order_in_parent"] for o in record.get("learning_objectives") or []}
    labels = {o["id"]: o["label"] for o in record.get("learning_objectives") or []}
    groups: dict[str | None, list[dict]] = {}
    for i, raw in enumerate(items):
        if raw["type"] not in STATEMENT_TYPES:
            continue
        r = AG.with_intended(raw)
        text = r.get("claim") or r.get("text") or (f"{r['term']}" if r.get("term") else "")
        squash = lambda t: re.sub(r"\\[ ,;!]|[\s$]", "", t or "")   # spacing commands and blanks never make a formula new
        if r.get("formula") and squash(r["formula"]) not in squash(text):   # a formula the statement already gives is not repeated
            text = f"{text} Formula: {r['formula']}".strip()
        if r.get("examples"):
            text = f"{text} Examples: {'; '.join(r['examples'])}"
        text = normalise(text.strip(), decimal, counts)
        if not text:
            continue
        lo = r.get("lo")
        if not lo and r["type"] != "key_term":   # the key terms are the lesson's list: they stay with the whole lesson
            near = sorted((abs(j - i), j) for j, x in enumerate(items) if x.get("lo") and x.get("source_page") == r.get("source_page"))
            lo = items[near[0][1]]["lo"] if near else None
        groups.setdefault(lo, []).append({"id": r["id"], "type": r["type"], "text": text, "page": r.get("source_page")})
    ordered = sorted(groups, key=lambda k: (k is None, order.get(k, 0)))
    return {"format": STATEMENTS_FORMAT, "lesson": slug, "source": f"book-records/{record['source_document'].get('course_id', '')}",
            "groups": [{"lo": lo_of(slug, k) if k else None, "label": labels.get(k) if k else None, "statements": groups[k]} for k in ordered]}


def objective_context(book: str, slug: str, st: dict, questions: list[dict], decimal: str, counts: Counter,
                      report: dict) -> None:
    """The book's context per objective (book_record_context.py, S1C; Tamer, 2026-10-22) into the lesson's statements
    file: each group gains `context` (the book's real-life openers, concept introductions and guiding questions, and its
    closing reflections, as printed, notation
    normalised, KaTeX-checked) and `real_life_questions` (live questions of that objective set in a real situation). A passage for
    the whole lesson goes to the group with no objective. A lesson the stage has not run on is left exactly as it was."""
    import book_record_context as BRC  # noqa: PLC0415
    L = BRC.for_lesson(book, slug)
    if L is None:
        return
    id_of = {o["n"]: lo_of(slug, o["id"]) for o in L["objectives"]}
    groups = {g["lo"]: g for g in st["groups"]}
    label = {lo_of(slug, o["id"]): o["label"] for o in L["objectives"]}

    def group(lo: str | None) -> dict:
        if lo not in groups:
            groups[lo] = {"lo": lo, "label": label.get(lo) if lo else None, "statements": []}
        return groups[lo]

    live_items = {q.get("_item") for q in questions if not q.get("hold_reason")}
    # an open prompt that became a live question stays in the question bank: never the same text twice
    rows = [{**p, "text": normalise(p["text"], decimal, counts)} for p in BRC.resolved(book, L) if p["key"] not in live_items]
    bad = {e["where"] for e in ALB.katex_errors([{"where": p["key"], "text": p["text"]} for p in rows])}
    report["warnings"] += [f"{k}: left out of the tutor's context, KaTeX cannot render it" for k in sorted(bad)]
    for p in rows:
        if p["key"] in bad:
            continue
        group(id_of.get(p["objective"])).setdefault("context", []).append(
            {"id": p["key"], "kind": p["kind"], "text": p["text"], "page": p["page"], "by": p["by"],
             **({"generated": True} if p.get("generated") else {})})
    live = [q for q in questions if not q.get("hold_reason")]
    for b in L.get("bridges") or []:
        for q in live:
            if q.get("_item") == b["key"]:
                g = group(q["lo"])
                if q["id"] not in g.setdefault("real_life_questions", []):
                    g["real_life_questions"].append(q["id"])
    order = {lo_of(slug, o["id"]): o["n"] for o in L["objectives"]}
    st["groups"] = sorted(groups.values(), key=lambda g: (g["lo"] is None, order.get(g["lo"], 0)))


def marker_check(questions: list[dict]) -> dict[str, str]:
    """The app's own reader and key check (marker_check.mjs) on every marker question: id → why it was refused."""
    rows = [{"id": q["id"], "choices": q["choices"]} for q in questions if isinstance(q.get("choices"), dict)]
    if not rows:
        return {}
    res = subprocess.run(["node", "--no-warnings", str(HERE / "marker_check.mjs"), "-"], input="\n".join(json.dumps(r) for r in rows),
                         capture_output=True, text=True, cwd=REPO)
    out = json.loads(res.stdout or "{}")
    bad = {x["id"]: x["why"] for x in out.get("specs_rejected") or []}
    bad.update({x["id"]: f"key unreadable: {x['why']}" for x in out.get("keys_unreadable") or []})
    return bad


def course_registered(course_id: str) -> bool:
    """Is the course in the app's course registry (the only place a `course:` literal may be written)?"""
    f = REPO / "app" / "src" / "lib" / "courses.ts"
    return f.exists() and f'"{course_id}"' in f.read_text()


def standalone_bundles(cfg: dict, slugs: list[str], lmap: dict, records: dict, new_nodes: dict, new_questions: dict,
                       new_visuals: dict, new_entries: dict) -> dict[str, dict]:
    """A new curriculum's own bundles, one per module (the lesson slug without its number: pp3u1-2 → pp3u1), with the
    book config's program and course and the lesson map's module titles. Nothing is borrowed from another course."""
    by_module: dict[str, list[str]] = {}
    for slug in slugs:
        by_module.setdefault(slug.rsplit("-", 1)[0], []).append(slug)
    lessons = {x["slug"]: x for x in lmap.get("lessons") or []}
    out, first = {}, True
    for order, (mod, ss) in enumerate(by_module.items(), start=1):
        src = records[ss[0]]["source_document"]
        doc = {k: src[k] for k in ("title", "publisher", "edition", "language", "grade", "subject", "file_path") if src.get(k)}
        nodes, edges = [], []
        if first:
            prog = cfg.get("program")
            if prog:
                nodes.append({"id": prog["id"], "kind": "program", "label": prog["label"]})
            nodes.append({"id": cfg["course_id"], "kind": "course", "label": cfg["title"]})
            if prog:
                edges.append({"src": cfg["course_id"], "dst": prog["id"], "type": "part_of"})
        l0 = lessons.get(ss[0], {})
        module = {"id": f"module:{mod}", "kind": "module", "label": l0.get("module") or mod, "order_in_parent": order}
        if l0.get("pages"):
            module["source_page"] = l0["pages"][0]
        nodes.append(module)
        edges.append({"src": module["id"], "dst": cfg["course_id"], "type": "part_of"})
        questions, visuals, entries = [], [], []
        for s in ss:
            nodes += new_nodes[s]
            edges += [{"src": module["id"], "dst": n["id"], "type": "teaches"} for n in new_nodes[s]]
            questions += new_questions[s]
            visuals += new_visuals[s]
            entries += new_entries[s]
        b = {"extraction_run": {"extractor": "compile_book_records.py, from book records", "extractor_version": VERSION,
                                "schema_version": "book-record-2"},
             "syllabus_version": cfg.get("syllabus_version") or src.get("edition") or "book-record-2",
             "nodes": nodes, "edges": edges, "questions": questions, "visuals": visuals,
             **({"explanation_entries": entries} if entries else {})}
        if first:
            b = {"source_document": doc, **b}
        else:
            b = {"source_file": doc["file_path"], **b}
        out[f"{mod}.json"] = b
        first = False
    return out


class GeneratedReview:
    """The review tool's Generated content decisions (reviews/<book>/generated-content.json), applied to the book's
    own generated rows as compile adds them, each only while the row is as it was decided (its fingerprint):
      a generated or widget question: approve is a stamp; a fix request is a stamp that holds it (status review, a
        person's hold); reject leaves it out, and is a stamp too, for a row an earlier load put in the database —
        as Generated answers are (apply_review_verdicts.py --book-reviews);
      a misconception: reject or a fix request leaves it out of the catalogue, and every link to it from a question
        is dropped (the question kept); approve is listed (the catalogue has no review columns);
      a widget mapping (a predicate → misconception claim): reject or a fix request drops that claim from its
        widget; approve is listed;
      a held hint or diagnosis (the verifier did not confirm it, decision 47; kind `held`): keep moves it into the
        widget's live claims (`diagnostics` or `hints`), drop removes it from the held list. Applied after the widget's
        own decision is read, so the widget it belongs to is not sent back for review by it.
    A decision on an item that has changed since is not applied: the item is back in the task, open."""

    def __init__(self, book: str):
        self.task = _review_task("generated")
        self.dec = self.task.latest_decisions(book)
        self.stamps: list[dict] = []
        self.listed: list[dict] = []
        self.left_mc: set[str] = set()
        self.report = {"left_out": [], "held": [], "stamped": 0, "links_dropped": [], "changed_since": [],
                       "claims_kept": [], "claims_dropped": []}

    def _current(self, kind: str, row: dict) -> dict | None:
        d = self.dec.get((kind, row["id"]))
        if not d:
            return None
        if d.get("fingerprint") != self.task.fingerprint(row, kind):
            self.report["changed_since"].append(f"{kind} {row['id']}")
            return None
        return d

    def _stamp(self, qid: str, d: dict, what: str) -> None:
        self.stamps.append({"question": qid, "ref": qid, "decision": d["decision"], "by": d["by"], "at": d["at"],
                            "fingerprint": d["fingerprint"], "what": what, **({"note": d["note"]} if d.get("note") else {})})

    def apply(self, rows: list[dict], key: str) -> list[dict]:
        out = []
        for r in rows:
            if key == "misconceptions":
                d = self._current("misconception", r)
                if d and d["decision"] in ("reject", "fix_requested"):
                    self.left_mc.add(r["id"])
                    self.report["left_out"].append({"misconception": r["id"], "decision": d["decision"], "by": d["by"]})
                    continue
                if d:
                    self.listed.append({"kind": "misconception", "ref": r["id"], "decision": d["decision"], "by": d["by"], "at": d["at"]})
                out.append(r)
                continue
            kind = "widget" if r.get("question_type") == "widget" else "question"
            ch = r.get("choices")
            if kind == "widget" and isinstance(ch, dict) and ch.get("diagnostics"):
                keep = []
                for dg in ch["diagnostics"]:
                    ref = f"{r['id']}#{dg.get('predicate')}"
                    item = {"id": ref, "widget_id": r["id"], "lo_id": r.get("lo_id"), **dg}
                    dm = self.dec.get(("mapping", ref))
                    if dm and dm.get("fingerprint") == self.task.fingerprint(item, "mapping"):
                        if dm["decision"] in ("reject", "fix_requested"):
                            self.report["links_dropped"].append({"question": r["id"], "predicate": dg.get("predicate"), "by": dm["by"]})
                            continue
                        self.listed.append({"kind": "mapping", "ref": ref, "decision": dm["decision"], "by": dm["by"], "at": dm["at"]})
                    keep.append(dg)
                d = self._current(kind, r)   # the widget's own decision signs it with every claim it was shown with
                ch["diagnostics"] = keep
            else:
                d = self._current(kind, r)
            if kind == "widget" and isinstance(ch, dict):
                self._held(r, ch)
            if d:
                self._stamp(r["id"], d, f"generated {kind}")
                self.report["stamped"] += 1
                if d["decision"] == "reject":
                    self.report["left_out"].append({"question": r["id"], "decision": "reject", "by": d["by"]})
                    continue
                if d["decision"] == "fix_requested":
                    self.report["held"].append({"question": r["id"], "by": d["by"], "note": d.get("note")})
            out.append(r)
        return out

    def _held(self, r: dict, ch: dict) -> None:
        """The held hints and diagnoses a person decided: keep → live, drop → gone (each only as it was decided)."""
        live = {"pending_review": "diagnostics", "pending_hints": "hints"}
        for ref, item, key, e in self.task.held_items(r):
            dm = self.dec.get(("held", ref))
            if not dm or dm.get("fingerprint") != self.task.fingerprint(item, "held"):
                continue
            ch[key] = [x for x in ch.get(key) or [] if x is not e]
            if not ch[key]:
                del ch[key]
            if dm["decision"] == "keep":
                ch.setdefault(live[key], []).append({k: v for k, v in e.items() if k not in ("why", "verifier_runs")})
                self.report["claims_kept"].append({"ref": ref, "by": dm["by"]})
            else:
                self.report["claims_dropped"].append({"ref": ref, "by": dm["by"]})
            self.listed.append({"kind": "held", "ref": ref, "decision": dm["decision"], "by": dm["by"], "at": dm["at"]})

    def unlink_left_out(self, generated: dict) -> None:
        """A misconception left out takes its links with it: no question may name what the catalogue no longer holds."""
        if not self.left_mc:
            return
        for g in generated.values():
            for q in g.get("questions") or []:
                ch = q.get("choices")
                if isinstance(ch, dict) and ch.get("diagnostics"):
                    for dg in [x for x in ch["diagnostics"] if x.get("misconception_id") in self.left_mc]:
                        ch["diagnostics"].remove(dg)
                        self.report["links_dropped"].append({"question": q["id"], "predicate": dg.get("predicate"), "misconception": dg["misconception_id"]})
                elif isinstance(ch, list):
                    for c in ch:
                        if isinstance(c, dict) and c.get("misconception_id") in self.left_mc:
                            self.report["links_dropped"].append({"question": q["id"], "option": c.get("key"), "misconception": c.pop("misconception_id")})
            if "misconceptions" in g:   # a questions file declares the misconceptions it uses
                g["misconceptions"] = [m for m in g["misconceptions"] if m.get("id") not in self.left_mc]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("book")
    ap.add_argument("lessons", nargs="+")
    ap.add_argument("--no-book-pictures", action="store_true",
                    help="native figures only (answer 29): a question whose figure S4 did not draw stays held as figure_missing")
    a = ap.parse_args(argv)
    slugs = a.lessons
    cfg = json.loads((HERE / "books" / f"{a.book}.json").read_text())
    decimal = (cfg.get("printed_notation") or {}).get("decimal", "point")
    out_dir = HERE / "compiled" / a.book
    out_dir.mkdir(parents=True, exist_ok=True)
    lmap_path = HERE / "book-records" / a.book / "lessons.json"
    lmap = json.loads(lmap_path.read_text()) if lmap_path.exists() else {"lessons": []}
    if not cfg.get("bundles"):   # a book of its own: its compiled folder IS the book, so every lesson compiled before is
        before = set()           # compiled again with these (compile makes no model calls), or a unit would erase the others
        for f in out_dir.glob("*.json"):
            try:
                b = json.loads(f.read_text())
            except ValueError:
                continue
            for n in (b.get("nodes") or []) if isinstance(b, dict) else []:
                if n.get("kind") == "learning_objective":
                    before |= {l["slug"] for l in lmap["lessons"] if n["id"].startswith(f"lo:{l['slug']}-")}
        order = [l["slug"] for l in lmap["lessons"]]
        slugs = sorted(set(slugs) | before, key=lambda s: order.index(s) if s in order else len(order))
        if before - set(a.lessons):
            print(f"also compiling the lessons compiled before: {sorted(before - set(a.lessons))}", file=sys.stderr)
    report = {"format": FORMAT_REPORT, "version": VERSION, "book": a.book, "printed_decimal": decimal, "lessons": {},
              "skipped": [], "left_out_today": {}, "held": [], "figures": [], "stand_ins": [], "figure_reviews": [], "tiers": [], "warnings": [], "errors": [], "misprints_unplaced": [],
              "multipart": {"carried": [], "unresolved": []}, "g2": []}

    bundles = {p: json.loads(rel(p).read_text()) for p in cfg.get("bundles") or []}
    in_bundle = lambda s: any(any(n.get("kind") == "learning_objective" and n["id"].startswith(f"lo:{s}-") for n in b["nodes"])
                              for b in bundles.values())
    new_nodes, new_questions, new_entries, new_visuals, records, counts = {}, {}, {}, {}, {}, Counter()
    new_statements: dict[str, dict] = {}
    stand_in_files: set[Path] = set()
    stamps: list[dict] = []          # the review tool's decisions, for apply_review_verdicts.py --book-reviews
    decided_all: dict[str, dict] = {}
    for slug in slugs:
        rec_path = HERE / "book-records" / a.book / f"{slug}.json"
        record = json.loads(rec_path.read_text())
        records[slug] = record
        old = next((n for b in bundles.values() for n in b["nodes"] if n.get("kind") == "learning_objective" and n["id"].startswith(f"lo:{slug}-")), {})
        nodes = lesson_objectives(slug, record, old.get("syllabus_ref"))
        for n in nodes:
            n["label"] = normalise(n["label"], decimal, counts, objective=True)
            n["description"] = normalise(n["description"], decimal, counts, objective=True)
        new_nodes[slug] = nodes
        skipped: list = []
        entries: list = []
        decided: dict = {}
        unresolved: list = []
        qs = book_questions(slug, record, usable_answers(a.book, slug, record, rec_path, decided), skipped, entries, printed_checks(a.book, slug),
                            question_tiers(a.book, slug), unresolved)
        report["multipart"]["carried"] += [{"lesson": slug, **q.pop("_carry")} for q in qs if q.get("_carry")]
        report["multipart"]["unresolved"] += [{"lesson": slug, **u} for u in unresolved]
        lo_by_item = objectives_for_items(record)
        for ref, d in decided.items():   # a rejected or fix-requested answer: the question an earlier load may hold
            item = next((it["id"] for it in record["items"] if ref == it["id"] or ref.startswith(it["id"] + ":")), None)
            if d["decision"] != "approve" and item in lo_by_item:
                local = re.sub(r"[^a-z0-9]+", "-", ref.split(":", 1)[1].lower()).strip("-")
                decided_all[f"q:{lo_of(slug, lo_by_item[item]).removeprefix('lo:')}:bk-{local}"] = {**d, "ref": ref}
        for q in qs:
            normalise_question(q, decimal, counts)
        for e in entries:
            for c in e["content"]:
                c["text_md"] = normalise(c["text_md"], decimal, counts)
        # the app's marker cannot read the key: held (`unanswerable`), listed, released by a load once the key reads
        bad = marker_check(qs)
        for q in qs:
            if q["id"] in bad and not q.get("hold_reason"):
                q["hold_reason"] = "unanswerable"
                q.pop("verified", None)
                report["held"].append({"question": q["id"], "why": f"the app's marker cannot mark the key: {bad[q['id']]}"})
        report["errors"] += [f"misprint reaches a question: {x}" for x in misprint_leaks(record, qs)]
        # a misprint answer_gen.with_intended could not place (a description, or text that differs by more than
        # notation): it reaches the tutor as printed until a person rewrites its `printed` or fixes the record
        report["misprints_unplaced"] += [{"lesson": slug, **m} for it in record.get("items") or [] for m in AG.apply_misprints(it)[1]]
        for q in qs:
            if q.get("_why"):
                report["held"].append({"question": q["id"], "why": f"{q['hold_reason']}: {q['_why']}"})
        new_questions[slug] = qs
        new_entries[slug] = entries
        report["skipped"] += [{"lesson": slug, **x} for x in skipped]

    # KaTeX: the app's own renderer over everything a student or the tutor reads
    all_q = [q for s in slugs for q in new_questions[s]]
    errs = ALB.katex_errors(katex_rows(all_q, [n for s in slugs for n in new_nodes[s]]))
    broken = {e["where"].split("|")[0]: e for e in errs}
    for q in all_q:
        if q["id"] in broken and not q.get("hold_reason"):
            q["hold_reason"] = "katex_error"
            q.pop("verified", None)
            report["held"].append({"question": q["id"], "why": f"KaTeX: {broken[q['id']]['why']}", "segment": broken[q["id"]]["segment"]})
    report["errors"] += [f"objective {e['where']}: KaTeX cannot render {e['segment']!r}: {e['why']}" for e in errs if e["where"].startswith("lo:")]
    apply_g2(a.book, new_questions, report)   # Samuel's G2 recommendations on held book questions (book_record_g2.py)
    for slug in slugs:   # the book's statements: KaTeX-checked like everything the tutor reads; a failing one is left out
        st = lesson_statements(slug, records[slug], decimal, counts)
        bad = {e["where"] for e in ALB.katex_errors([{"where": x["id"], "text": x["text"]} for g in st["groups"] for x in g["statements"]])}
        for g in st["groups"]:
            report["warnings"] += [f"{x['id']}: left out of the tutor's statements, KaTeX cannot render it" for x in g["statements"] if x["id"] in bad]
            g["statements"] = [x for x in g["statements"] if x["id"] not in bad]
        st["groups"] = [g for g in st["groups"] if g["statements"]]
        objective_context(a.book, slug, st, new_questions[slug], decimal, counts, report)
        st["source"] = f"book-records/{a.book}/{slug}.json"
        new_statements[slug] = st
    for slug in slugs:
        new_visuals[slug] = lesson_figures(a.book, slug, records[slug], new_questions[slug], report, stand_in_files, not a.no_book_pictures)
        for v in new_visuals[slug]:   # S4's captions and drawn labels are read too: the same notation
            v["caption"] = normalise(v.get("caption"), decimal, counts)
            if v["kind"] != "book_image":
                v["spec"] = normalise_spec(v["spec"], decimal, counts)
    for q in all_q:
        if q.get("_decision"):
            d = q["_decision"]
            stamps.append({"question": q["id"], "ref": q["_ref"], "decision": d["decision"], "by": d["by"], "at": d["at"],
                           "fingerprint": d["fingerprint"], "what": q.get("_stamp_what") or "generated answer"})
        report["tiers"].append({"question": q["id"], "tier": q["tier"], "from": q["_tier_from"]})
        for k in ("_item", "_ref", "_why", "_decision", "_tier_from", "_stamp_what", "_part"):
            q.pop(k, None)
    for slug in slugs:
        for e in new_entries[slug]:
            e.pop("_item", None)
        qs = new_questions[slug]
        report["lessons"][slug] = {"objectives": len(new_nodes[slug]), "questions": len(qs),
                                   "live": sum(1 for q in qs if not q.get("hold_reason")),
                                   "held": sum(1 for q in qs if q.get("hold_reason")),
                                   "held_by_reason": dict(Counter(q["hold_reason"] for q in qs if q.get("hold_reason"))),
                                   "by_type": {t: sum(1 for q in qs if q["type"] == t) for t in ("numeric", "short")},
                                   "marker": sum(1 for q in qs if isinstance(q.get("choices"), dict)),
                                   "by_tier": dict(Counter(q["tier"] for q in qs)),
                                   "statements": sum(len(g["statements"]) for g in new_statements[slug]["groups"]),
                                   "context": sum(len(g.get("context") or []) for g in new_statements[slug]["groups"]),
                                   "real_life_questions": sum(len(g.get("real_life_questions") or []) for g in new_statements[slug]["groups"]),
                                   "library_entries": len(new_entries[slug]),
                                   "visuals": sum(1 for v in new_visuals[slug] if v["kind"] != "book_image"),
                                   "book_pictures": sum(1 for v in new_visuals[slug] if v["kind"] == "book_image")}
    report["notation_changes"] = {k: v for k, v in counts.items() if v}

    # The prerequisite links a person kept at G1 (book_record_objectives.py apply → teaching/<book>/links/): Samuel's
    # S1 linker and checker, on book records. Only a link whose two ends are objectives compiled here.
    compiled_los = {n["id"] for s in slugs for n in new_nodes[s]}
    link_edges = []
    for f in sorted((HERE / "teaching" / a.book / "links").glob("*.json")):
        for k in json.loads(f.read_text()).get("links") or []:
            if k["src"] in compiled_los and k["dst"] in compiled_los:
                link_edges.append({"src": k["src"], "dst": k["dst"], "type": "prerequisite_of"})
    report["prerequisite_links"] = len(link_edges)
    to_write: dict[str, dict] = {}
    existing = [s for s in slugs if in_bundle(s)]
    standalone = [s for s in slugs if s not in existing]
    for bpath, b in bundles.items():
        here = [s for s in existing if any(n["id"].startswith(f"lo:{s}-") for n in b["nodes"])]
        if not here:
            continue
        b = copy.deepcopy(b)
        left = report["left_out_today"].setdefault(Path(bpath).name, {})
        left["objectives"] = sum(1 for n in b["nodes"] if n.get("kind") == "learning_objective" and in_lessons(n["id"], here))
        left["questions"] = sum(1 for q in b["questions"] if in_lessons(q["lo"], here))
        left["visuals"] = sum(1 for v in b.get("visuals") or [] if in_lessons(v["lo"], here))
        left["edges"] = sum(1 for e in b["edges"] if in_lessons(e["src"], here) or in_lessons(e["dst"], here))
        module = next(e["src"] for e in b["edges"] if e["type"] == "teaches" and in_lessons(e["dst"], here))
        b["nodes"] = [n for n in b["nodes"] if not (n.get("kind") == "learning_objective" and in_lessons(n["id"], here))]
        b["edges"] = [e for e in b["edges"] if not (in_lessons(e["src"], here) or in_lessons(e["dst"], here))]
        b["questions"] = [q for q in b["questions"] if not in_lessons(q["lo"], here)]
        b["visuals"] = [v for v in b.get("visuals") or [] if not in_lessons(v["lo"], here)]
        left["explanation_entries"] = sum(1 for x in b.get("explanation_entries") or [] if in_lessons(x["lo"], here))
        b["explanation_entries"] = [x for x in b.get("explanation_entries") or [] if not in_lessons(x["lo"], here)]
        b["edges"] += link_edges
        for s in here:
            b["nodes"] += new_nodes[s]
            b["edges"] += [{"src": module, "dst": n["id"], "type": "teaches"} for n in new_nodes[s]]
            b["questions"] += new_questions[s]
            b["visuals"] += new_visuals[s]
            b["explanation_entries"] += new_entries[s]
        if not b["explanation_entries"]:
            b.pop("explanation_entries")
        to_write[Path(bpath).name] = b
    if standalone:
        sb = standalone_bundles(cfg, standalone, lmap, records, new_nodes, new_questions, new_visuals, new_entries)
        if sb and not existing:   # a new curriculum's links: each rides in the bundle of the objective it leads to, and
            home = {n["id"]: name for name, b in sb.items() for n in b["nodes"]}   # a bundle names what it borrows from
            for e in link_edges:                                                  # another (external_node_refs, as the
                sb[home.get(e["dst"]) or next(iter(sb))]["edges"].append(e)        # live course's unit bundles do)
            for b in sb.values():
                own = {n["id"] for n in b["nodes"]}
                ext = sorted({x for e in b["edges"] for x in (e["src"], e["dst"]) if x not in own and x in home})
                if ext:
                    b["external_node_refs"] = ext
        to_write.update(sb)
        missing = [s for s in standalone if s not in (cfg.get("lesson_titles") or {})]
        if missing:
            report["warnings"].append(f"no title in books/{a.book}.json lesson_titles for {missing}: the app lists a lesson by it")
    if not course_registered(cfg["course_id"]):
        report["warnings"].append(f"{cfg['course_id']} is not in the app's course registry (app/src/lib/courses.ts): "
                                  "the app cannot teach it until it is registered (an app change)")
    for name, b in to_write.items():
        report["errors"] += guard_bundle(b, name)

    generated: dict[str, dict] = {}
    if existing and cfg.get("generated"):
        gen_paths = (cfg["generated"]["questions"] if isinstance(cfg["generated"]["questions"], list) else [cfg["generated"]["questions"]]) \
            + [cfg["generated"]["misconceptions"]]
        dropped_mc = set()
        for p in gen_paths:
            g = json.loads(rel(p).read_text())
            dropped_mc |= {m["id"] for m in g.get("misconceptions") or [] if in_lessons(m.get("lo_id"), existing)}
            left = report["left_out_today"].setdefault(Path(p).name, {})
            if "questions" in g:
                left["questions"] = sum(1 for q in g["questions"] if in_lessons(q.get("lo_id"), existing))
                g["questions"] = [q for q in g["questions"] if not in_lessons(q.get("lo_id"), existing)]
            if "misconceptions" in g:
                left["misconceptions"] = sum(1 for m in g["misconceptions"] if in_lessons(m.get("lo_id"), existing))
                g["misconceptions"] = [m for m in g["misconceptions"] if not in_lessons(m.get("lo_id"), existing)]
            generated[Path(p).name] = g
        # a question outside the compiled lessons may name a misconception of theirs (a Term 2 widget diagnosing a
        # Unit 1 error): that one link is dropped, the question kept, and listed
        report["links_dropped"] = []
        for g in generated.values():
            for q in g.get("questions") or []:
                ch = q.get("choices")
                if isinstance(ch, dict) and ch.get("diagnostics"):
                    keep = [d for d in ch["diagnostics"] if d.get("misconception_id") not in dropped_mc]
                    report["links_dropped"] += [{"question": q["id"], "predicate": d.get("predicate"), "misconception": d["misconception_id"]}
                                                for d in ch["diagnostics"] if d not in keep]
                    ch["diagnostics"] = keep
                elif isinstance(ch, list):
                    for c in ch:
                        if isinstance(c, dict) and c.get("misconception_id") in dropped_mc:
                            report["links_dropped"].append({"question": q["id"], "option": c.get("key"), "misconception": c.pop("misconception_id")})

    if not cfg.get("generated"):   # a book of its own (no shared generated bank): its generated content starts its own
        for name, key in (("generated-questions.json", "questions"), ("widget-questions.json", "questions"),   # files,
                          ("misconceptions.json", "misconceptions")):                                          # shaped as
            f = HERE / "teaching" / a.book / "generated" / name                                               # S5–S7 wrote them
            if f.exists() and name not in generated:
                doc = json.loads(f.read_text())
                doc[key] = []
                generated[name] = doc
    # The compiled lessons' OWN generated content: S5–S7 run on these bundles (book_record_generation.py), assembled
    # and reconciled by the runbook's own tools into teaching/<book>/generated/. Added after the old rows were cut
    # and their links dropped, so nothing above can touch them.
    tg = HERE / "teaching" / a.book / "generated"
    report["generated_added"] = {}
    gen_review = GeneratedReview(a.book)
    for name, key in (("generated-questions.json", "questions"), ("widget-questions.json", "questions"), ("misconceptions.json", "misconceptions")):
        f = tg / name
        if not f.exists() or name not in generated:
            continue
        rows = [r for r in json.loads(f.read_text()).get(key) or [] if in_lessons(r.get("lo_id"), slugs)]
        rows = gen_review.apply(rows, key)
        have = {r["id"] for r in generated[name].get(key) or []}
        clash = [r["id"] for r in rows if r["id"] in have]
        if clash:
            report["errors"].append(f"{name}: generated ids already in the book's file: {clash[:5]}")
            continue
        if decimal != "comma":   # what a student or the tutor reads, in the app's notation (never an answer key)
            for r in rows:
                for k in ("label", "description", "signal", "stem"):
                    if isinstance(r.get(k), str):
                        r[k], n = LIST_COMMA.subn(", ", r[k])
                        counts["list_comma"] += n
                for k in ("refutation", "solution"):
                    if isinstance(r.get(k), list):
                        for i, x in enumerate(r[k]):
                            if isinstance(x, str):
                                r[k][i], n = LIST_COMMA.subn(", ", x)
                                counts["list_comma"] += n
                            elif isinstance(x, dict):
                                for tk in ("text_md", "text"):
                                    if isinstance(x.get(tk), str):
                                        x[tk], n = LIST_COMMA.subn(", ", x[tk])
                                        counts["list_comma"] += n
        generated[name].setdefault(key, []).extend(rows)
        report["generated_added"][name] = len(rows)

    gen_review.unlink_left_out(generated)
    report["generated_review"] = gen_review.report
    stamps += gen_review.stamps
    ok = not report["errors"]
    if ok:   # cleared only now: a compile that fails leaves the last good one in place
        for f in out_dir.glob("*.json"):
            f.unlink()
        for name, b in {**to_write, **generated}.items():
            (out_dir / name).write_text(json.dumps(b, ensure_ascii=False, indent=2) + "\n")
        if stand_in_files:   # the app serves the book's pictures itself, as Grade 10's (assemble_lesson_bundle.py)
            fig_out = REPO / "app" / "public" / "book-figures" / a.book
            fig_out.mkdir(parents=True, exist_ok=True)
            for f in sorted(stand_in_files):
                if not (fig_out / f.name).exists() or (fig_out / f.name).read_bytes() != f.read_bytes():
                    shutil.copyfile(f, fig_out / f.name)
            report["stand_in_files"] = sorted(f.name for f in stand_in_files)
        content_dir = out_dir / "content"   # the book's statements, for AINEXT_BOOK_STATEMENTS_DIR (app/src/lib/book-statements.ts)
        content_dir.mkdir(exist_ok=True)
        for slug, st in new_statements.items():
            (content_dir / f"{slug}.json").write_text(json.dumps(st, ensure_ascii=False, indent=2) + "\n")
        stamps += [{"question": qid, "ref": d["ref"], "decision": d["decision"], "by": d["by"], "at": d["at"],
                    "fingerprint": d["fingerprint"], "what": "generated answer"} for qid, d in decided_all.items()]
        (out_dir / "review-stamps.json").write_text(json.dumps(
            {"format": "ainext.review-stamps/1", "book": a.book, "course_id": cfg["course_id"], "from": "reviews/" + a.book + "/generated-answers.json",
             "note": "apply_review_verdicts.py --book-reviews: each decision a person made in the review tool, as the stamp of the question it decided",
             "stamps": sorted(stamps, key=lambda x: x["question"]),
             "figures_from": "reviews/" + a.book + "/generated-content.json",
             "figures_note": "each decision a person made on an S4 figure (Generated content → Figures), with the visuals it shows as; "
                             "the visuals table has no review columns, so apply_review_verdicts.py lists these and writes none",
             "figures": report["figure_reviews"],
             "generated_note": "each decision a person made on a generated misconception or widget mapping (Generated content); "
                               "neither has review columns, so these are listed and none is written: a rejected one, or one a "
                               "fix was asked for, is left out of the compiled files",
             "generated": gen_review.listed}, ensure_ascii=False, indent=2) + "\n")
    report["files"] = sorted(str(x.relative_to(HERE)) for x in out_dir.glob("*.json"))
    (out_dir / "compile-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    for slug, r in report["lessons"].items():
        print(f"{slug}: {r['objectives']} objectives; {r['questions']} book questions ({r['live']} live, {r['held']} held "
              f"{r['held_by_reason'] or ''}); {r['visuals']} drawn figure(s), {r['book_pictures']} book picture(s); "
              f"{r['library_entries']} library worked example(s)", file=sys.stderr)
    print(f"notation: {report['notation_changes'] or 'nothing to change'}", file=sys.stderr)
    teaching = sum(1 for x in report["skipped"] if x.get("teaching"))
    print(f"not questions: {len(report['skipped'])} book prompt(s), {teaching} of them kept as library worked examples; "
          f"held: {len(report['held'])}; book pictures: {len(report['stand_ins'])}", file=sys.stderr)
    if report["misprints_unplaced"]:
        print(f"misprints not placed (reach the tutor as printed): {len(report['misprints_unplaced'])} — see misprints_unplaced",
              file=sys.stderr)
    for w in report["warnings"]:
        print(f"WARNING: {w}", file=sys.stderr)
    for e in report["errors"][:20]:
        print(f"ERROR: {e}", file=sys.stderr)
    if not ok:
        print(f"{len(report['errors'])} error(s): no bundle written; see compiled/{a.book}/compile-report.json", file=sys.stderr)
        return 2
    print(f"wrote {len(to_write) + len(generated)} file(s) to compiled/{a.book}/", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

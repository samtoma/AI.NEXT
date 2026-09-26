"""Step 2 of 3 (run in a working directory holding leaves.json).

Classify each maths-expression printed answer into a marker kind (contracts/answer-marker.md), or say why it
is out of the marker's scope. Also reads the form requirement from the question's own words.

Input: leaves.json (extract_answers.py), ../epub_scan.json (question words), the S0 answer typing.
"""
import json
import re
import sys

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from latex_sympy import ParseError, parse_expr, recurring_value, tokenize  # noqa: E402

import sympy as sp  # noqa: E402

import os
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
# the S0 scout's answer typing (untracked scouting code, services/extraction/scratch_g10/, per the S0 report §7)
SCOUT = os.path.join(REPO, "services", "extraction", "scratch_g10", "build_manifest_draft.py")
# the S0 scan outputs (pdf_scan.json, epub_scan.json): the directory the S0 report's §7 wrote them to
SCAN_DIR = os.environ.get("G10_SCAN_DIR", "..")
src = open(SCOUT).read()
ns = {"re": re}
exec(src[src.index("SYM = {"):src.index("GRADABLE = {")], ns)
answer_type = ns["answer_type"]
EXPRESSION_TYPES = {"algebraic", "multi_value", "coordinates", "inequality_interval_set", "exact_surd_or_pi",
                    "recurring_decimal"}

HASH = re.compile(r"⟦[0-9a-f]{32}⟧")


def load_stems():
    E = json.load(open(os.path.join(SCAN_DIR, "epub_scan.json")))
    stems = {}
    for f in E["files"]:
        for ex in f["exercises"]:
            eh = ex.get("exercise_header") or ""
            for q in ex["questions"]:
                qh = q.get("header_text") or ""
                for k, e in enumerate(q["entries"]):
                    stems[(ex["label"], q["q"], k)] = HASH.sub("M", " ".join([eh, qh, e["problem_text"]])).strip()
                stems[(ex["label"], q["q"], "n")] = len(q["entries"])
    return stems


STEMS = load_stems()


def stem_for(leaf, leaves_of_q):
    """The scout's own leaf -> entry alignment (build_manifest_draft.exercise_record)."""
    n = STEMS.get((leaf["exercise"], leaf["q"], "n"))
    if n is None:
        return ""
    idx = leaves_of_q.index(leaf)
    L = len(leaves_of_q)
    if L == n or idx < n:
        return STEMS.get((leaf["exercise"], leaf["q"], idx), "")
    return ""


UNIT_WORDS = {"units", "cubed", "squared", "cm", "m", "km", "mm", "kg", "g", "l", "ml", "s", "h", "min", "years",
              "months", "days", "people", "learners"}


def split_top(s, seps):
    """Split a LaTeX string on top-level separators (outside (), [], {}); a comma between digits is a decimal."""
    out, depth, cur, i = [], 0, "", 0
    while i < len(s):
        c = s[i]
        if s.startswith(r"\{", i) or s.startswith(r"\}", i):
            depth += 1 if s[i + 1] == "{" else -1
            cur += s[i:i + 2]
            i += 2
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        hit = None
        if depth == 0:
            for sep in seps:
                if s.startswith(sep, i):
                    if sep == "," and i > 0 and s[i - 1].isdigit() and i + 1 < len(s) and (s[i + 1].isdigit() or s.startswith("\\dot", i + 1)):
                        continue
                    hit = sep
                    break
        if hit:
            out.append(cur)
            cur = ""
            i += len(hit)
            continue
        cur += c
        i += 1
    out.append(cur)
    return [x.strip() for x in out]


def free(e):
    return sorted(str(x) for x in e.free_symbols)


def classify(leaf, stem):
    """-> dict(kind, key, form, variables, ...) or dict(kind='out_of_scope', reason=...)."""
    tex = leaf["latex"].strip().replace("̸=", "\\ne ").replace("\u0338=", "\\ne ")
    tex = re.sub(r"(\\text\{\.\}|\.)\s*$", "", tex).strip()
    tex = re.sub(r"^=\s*", "", tex)
    low = stem.lower()
    # connectives
    t = re.sub(r"\\text\{\s*(or)\s*\}", " OR ", tex)
    t = re.sub(r"\\text\{\s*(and)\s*\}", " AND ", t)
    words = re.findall(r"\\text\{([^}]*)\}", t)
    if words:
        ws = [w.strip().lower() for w in words]
        if all(w in UNIT_WORDS or re.fullmatch(r"[a-z]+ ?(cubed|squared)", w) for w in ws):
            return {"kind": "out_of_scope", "reason": "a number with a unit (today's numeric path after unit stripping)"}
        if any(re.fullmatch(r"\(?i+\.?\)?|ii+\.?|i\.", w) for w in ws) or re.search(r"\(\\text\{i+\}\s*\)", tex):
            return {"kind": "out_of_scope", "reason": "a multi-part answer ((i), (ii) ...): S3 splits it into separate questions"}
        if any(re.search(r"mean|median|mode|range|domain|q_|group", w) for w in ws):
            return {"kind": "out_of_scope", "reason": "several named quantities in one answer (mean, median ...): S3 splits it"}
        return {"kind": "out_of_scope", "reason": "words in the answer (verbal or mixed): multiple choice or a worked example"}
    if "\\triangle" in t or "\\parallel" in t or "\\therefore" in t or "\\equiv" in t:
        return {"kind": "out_of_scope", "reason": "a geometric statement, not a value"}
    if "\\approx" in t:
        return {"kind": "out_of_scope", "reason": "an approximation sign in the key"}
    t = t.replace("^\\circ", "")  # angle values: the degree sign is notation (decision 15)
    t = t.replace("\\%", "")
    t = re.sub(r"\s+", " ", t).strip()

    # alternatives of whole answers ("{...} or {...}") are a different contract
    if t.count("\\{") >= 2 and " OR " in t:
        return {"kind": "out_of_scope", "reason": "two alternative complete answers"}

    # set-builder / inequalities / intervals
    if re.search(r"\\le|\\ge|<|>|\\infty|\\in|\\cup|\\ne", t) or re.fullmatch(r"[\[(][^;]*;[^;]*[\])]", t) and ("[" in t or "]" in t):
        if "\\frac{" in t and re.search(r"\\frac\{[^}]*[<>]", t):
            return {"kind": "out_of_scope", "reason": "a number line (figure) read as text"}
        if re.search(r"[A-Z]\(", t) or (re.search(r"\(.*;.*\)", t) and " AND " in t and not "\\infty" in t):
            return {"kind": "out_of_scope", "reason": "a point and a range in one answer: S3 splits it"}
        if re.search(r"\\ne", t) and not re.search(r"\\le|\\ge|<|>|\\infty|\\cup", t):
            # "x \ne 2", "x \ne 0 and x \ne \pm 1": restrictions -> an interval kind (the complement of points)
            return {"kind": "interval", "key": tex_clean(t), "form": None, "variables": vars_of(t)}
        return {"kind": "interval", "key": tex_clean(t), "form": None, "variables": vars_of(t)}

    if "..." in t:
        return {"kind": "out_of_scope", "reason": "a truncated decimal (...) in the key"}
    if re.fullmatch(r"[a-z]\(x\)", t) or re.fullmatch(r"[A-Z]{2,3}", t):
        return {"kind": "out_of_scope", "reason": "a name (a function or a segment): multiple choice"}
    parts = split_top(t, [";", " OR ", " AND ", ","])
    parts = [p for p in parts if p]
    if len(parts) > 1 and any("=" in q and re.search(r"[a-z]", q.split("=")[-1].replace("\\sqrt", "").replace("\\frac", "").replace("\\pm", "")) for q in parts):
        return {"kind": "out_of_scope", "reason": "several equations in one answer: S3 splits it"}
    if len(parts) > 1:
        # a list: of equations (named values), of pairs, or of plain values
        return {"kind": "values", "key": tex_clean(t), "form": None, "variables": vars_of(t)}
    p = parts[0]
    if re.fullmatch(r"\\\{.*\\\}", p):
        return {"kind": "values", "key": tex_clean(t), "form": None, "variables": vars_of(t)}
    if re.fullmatch(r"([A-Z](_\{[^}]*\})?)?\s*\(.*;.*\)", p) or re.fullmatch(r"[A-Z]\s*=\s*\(.*;.*\)", p):
        return {"kind": "coordinates", "key": tex_clean(t), "form": None, "variables": []}
    if "=" in p:
        sides = [s.strip() for s in p.split("=")]
        lhs, rhs = sides[0], sides[-1]
        try:
            R = parse_expr(rhs.replace("\\pm", ""))
        except ParseError:
            R = None
        lone = r"[A-Za-z](_\{[^}]*\})?|\\theta|\\alpha|\\beta"
        if not re.fullmatch(lone, lhs) and re.fullmatch(lone, rhs) and len(sides) == 2:
            lhs, rhs = rhs, lhs
            try:
                R = parse_expr(rhs.replace("\\pm", ""))
            except ParseError:
                R = None
        fn = re.fullmatch(r"([a-z])\(x\)", lhs)
        single_var = re.fullmatch(lone, lhs) or fn
        if len(sides) > 2:
            return {"kind": "out_of_scope", "reason": "a chain of equalities (d_AC = d_BD = ...): S3 keeps one value"}
        if single_var and R is not None and not R.free_symbols:
            return {"kind": "values", "key": tex_clean(t), "form": None, "variables": [latex_name(lhs)]}
        if single_var and R is not None:
            form = None
            if "standard form" in low:
                return {"kind": "out_of_scope", "reason": "a form outside the contract (standard form of an equation)"}
            v = latex_name(lhs)
            if re.search(r"solve for|subject|make .* the subject|express .* in terms|in terms of", low):
                form = {"subject": v}
            return {"kind": "equation", "key": tex_clean(t), "form": form, "variables": sorted(set(vars_of(t)))}
        if R is not None and re.search(r"\\sin|\\cos|\\tan|\\bar|f\(|g\(|h\(|_\{", lhs):
            # a named quantity (sin a = 4/5, x-bar = 42,6, T_1 = ...): the key is its value
            return classify_value(rhs, low, named=lhs)
        if R is not None:
            if "standard form" in low:
                return {"kind": "out_of_scope", "reason": "a form outside the contract (standard form of an equation)"}
            return {"kind": "equation", "key": tex_clean(t), "form": None, "variables": sorted(set(vars_of(t)))}
        return {"kind": "out_of_scope", "reason": "an equation the oracle cannot parse"}
    return classify_value(p, low)


def classify_value(p, low, named=None):
    if "\\dot" in p:
        try:
            recurring_value(p)
            return {"kind": "recurring", "key": tex_clean(p), "form": None, "variables": [], "named": named}
        except ParseError:
            return {"kind": "out_of_scope", "reason": "a recurring decimal inside a larger expression"}
    try:
        e = parse_expr(p)
    except ParseError as err:
        return {"kind": "out_of_scope", "reason": f"the oracle cannot parse it ({err})"}
    if e.has(sp.zoo) or e.has(sp.nan):
        return {"kind": "out_of_scope", "reason": "an undefined value (division by zero) printed as the answer"}
    if not e.free_symbols:
        if "\\sqrt" in p or "\\pi" in p:
            form = "simplest" if re.search(r"simplif|simplest", low) else None
            return {"kind": "surd", "key": tex_clean(p), "form": form, "variables": [], "named": named}
        return {"kind": "out_of_scope", "reason": "a plain number (today's numeric path)"}
    form = None
    if re.search(r"expanded form|not factoris", low):
        form = "expanded"  # "Write your answer in expanded form (not factorised)"
    elif re.search(r"factoris", low) and not re.search(r"solve by factoris", low):
        form = "factorised"
    elif re.search(r"\bexpand", low):
        form = "expanded"
    elif re.search(r"simplif|simplest", low):
        form = "simplest"
    return {"kind": "expression", "key": tex_clean(p), "form": form, "variables": vars_of(p), "named": named}


def latex_name(s):
    s = s.strip()
    m = re.fullmatch(r"\\(theta|alpha|beta)", s)
    return m.group(1) if m else s


def vars_of(t):
    t = t.replace(" OR ", " ").replace(" AND ", " ")
    t = re.sub(r"\\text\{[^}]*\}", " ", t)
    s = re.sub(r"\\(theta|alpha|beta)", " ", t)
    s = re.sub(r"\\(frac|sqrt|pi|infty|le|ge|in|mathbb\{.\}|cup|ne|pm|mp|times|cdot|dot|circ|sin|cos|tan|text\{[^}]*\})", " ", s)
    s = re.sub(r"_\{[^}]*\}", "", s)
    out = set(re.findall(r"[A-Za-z]", s))
    for g in ("theta", "alpha", "beta"):
        if "\\" + g in t:
            out.add(g)
    return sorted(out)


def tex_clean(t):
    t = t.replace(" OR ", r" \text{ or } ").replace(" AND ", r" \text{ and } ")
    return re.sub(r"\s+", " ", t).strip()


def main():
    leaves = json.load(open("leaves.json"))
    byq = {}
    for l in leaves:
        byq.setdefault((l["exercise"], l["q"]), []).append(l)
    out = []
    for l in leaves:
        st = answer_type(l["text"])
        if st not in EXPRESSION_TYPES:
            continue
        stem = stem_for(l, byq[(l["exercise"], l["q"])])
        c = classify(l, stem)
        out.append({"id": f"{l['exercise']}/{l['q']}{l['sub'] or ''}", "exercise": l["exercise"], "q": l["q"],
                    "sub": l["sub"], "pdf_page": l["pdf"], "printed_page": l["pdf"] - 11, "s0_type": st,
                    "printed_text_layer": l["text"], "printed_latex": l["latex"], "stem_words": stem, **c})
    json.dump(out, open("classified.json", "w"), ensure_ascii=False, indent=1)
    import collections
    print("maths-expression leaves:", len(out))
    print(collections.Counter(o["kind"] for o in out))
    print(collections.Counter((o["kind"], str(o.get("form"))) for o in out if o["kind"] != "out_of_scope"))
    print(collections.Counter(o["reason"] for o in out if o["kind"] == "out_of_scope").most_common())


if __name__ == "__main__":
    main()

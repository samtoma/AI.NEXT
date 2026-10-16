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


def with_intended(rec: dict) -> dict:
    """The record as the tutor should read it: a confirmed misprint's intended text in place of the printed one."""
    r = copy.deepcopy(rec)
    for holder in [r] + list(r.get("parts") or []):
        for m in holder.get("misprints") or []:
            field = m.get("field", "")
            mm = re.match(r"^([a-z_]+)(?:\[(\d+)\])?$", field)
            if not mm or mm.group(1) == "quote" or mm.group(1) not in holder:
                continue
            key, idx = mm.group(1), mm.group(2)
            if idx is None and isinstance(holder[key], str):
                holder[key] = holder[key].replace(m["printed"], m["intended"])
            elif idx is not None and isinstance(holder[key], list) and int(idx) < len(holder[key]):
                holder[key][int(idx)] = str(holder[key][int(idx)]).replace(m["printed"], m["intended"])
    return r


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


def same_answer(a: str, b: str) -> bool:
    """Do two final answers say the same thing? Assignments by variable, pairs and sets as sets, numbers by value."""
    if _same_value(a, b):
        return True
    asg = lambda s: dict(re.findall(r"\b([a-zA-Z])\s*=\s*([^,;]+)", s.replace("$", "")))
    da, db = asg(a), asg(b)
    if da and db and set(da) == set(db):
        return all(_same_value(da[k], db[k]) for k in da)
    tup = lambda s: {_norm(t) for t in re.findall(r"\([^()]*\)", s.replace("$", ""))}
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


def check(author: dict, resolve: dict | None) -> dict:
    flags = WC.precheck_solution({"id": author["ref"], "steps": author.get("solution") or [], "kind": "generated"})
    c = {"resolve_answer": (resolve or {}).get("answer"), "resolve_kind": (resolve or {}).get("kind"),
         "numeric_flags": [{"step": f["step"], "quote": f["quote"], "why": f["why"]} for f in flags]}
    if str(author.get("answer", "")).startswith("CANNOT ANSWER") or str(c["resolve_answer"] or "").startswith("CANNOT ANSWER"):
        c["agree"], status = None, "cannot_answer"
    elif author["kind"] != "value":
        c["agree"], status = None, "needs_person"   # a drawing or an explanation: no machine check
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
                            "grounded_in": a.get("grounded_in") or [], **check(a, by_r.get(u["ref"]))})
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


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
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

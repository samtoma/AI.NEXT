"""Extract a lesson's book record (v2, role "extraction") from the page images, for a book with no usable text layer.

    uv run --with pymupdf --with jsonschema extract_book_record.py run prep3-math-en u1-2 [--cap 10] [--model sonnet] [--force]
    uv run --with pymupdf --with jsonschema extract_book_record.py run prep3-math-en --all [--cap 10]

Run from services/extraction/. The lessons and their printed page ranges come from
book-records/<book>/lessons.json. Writes book-records/<book>/<slug>.json, the format of
groundtruth/book-record.schema.json, so it can be labelled in the review tool and scored against ground truth
(score_book_record.py).

WHY THIS STEP. The extraction line (docs/specs/extraction-pipeline.md) reads a book from its EPUB and the PDF's
text layer. The Prep-3 ministry book has neither: 178 pages, 15 with usable text. This step reads the pages as
images instead.

HOW.
  1. One model call per printed page. It reads the page image and returns what is printed on it, one record
     per printed thing, following groundtruth/README.md: types, counting rules, a quote on every item,
     tables cell by cell, misprints proposed as printed → intended (never corrected). It also gives the label
     the book prints ("Example 2", "Drill"). It knows the previous page's last item, so a worked example that
     runs over a page break continues.
  2. With no model, the script assigns ids by the README scheme (printed label and number, else type and a
     lesson-wide count), resolves links (belongs_to, answer_figure), joins page-break continuations, and fills
     what the schema requires.
  3. One text-only call per lesson draws the "can do" objectives from the printed objective box and the
     items, each citing its evidence, and says which objective each item teaches.
  4. The record is checked with groundtruth/validate.py; problems are printed, not hidden.

COST. Every call runs the `claude` CLI on the developer's sign-in, with a minimal system prompt and only the Read
tool (for the page image). `--cap` (USD, default 10) stops the run before it spends more. A lesson already
extracted is skipped unless --force.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE / "groundtruth"))
import validate as V  # noqa: E402

VERSION = "ext-v3"
ITEM_TYPES = ["definition", "rule", "caution", "convention", "method", "exercise", "activity", "open_prompt",
              "worked_example", "figure", "table", "key_term", "printed_objective", "heading", "linking_text",
              "prior_knowledge"]
STATEMENTS = {"definition", "rule", "caution", "convention", "method"}
MAIN = {**{t: "claim" for t in STATEMENTS}, "key_term": "term", "figure": "caption", "table": "caption", "worked_example": "stem"}

PAGE_SYSTEM = """You read one printed page of a school maths textbook (Egypt, Preparatory Year 3, English edition) and record everything it prints, as structured data. You never solve, add or correct anything: you record what the page prints.

ONE RECORD PER PRINTED THING, in reading order (top to bottom; a side column before the main column only when it is printed first, like "What you'll learn" and "Key terms").
Types (use exactly one):
- definition, rule, caution, convention, method (a printed method box only): a statement. Put it in `claim`, in your words but faithful; a printed formula also in `formula` as $...$.
- exercise (Drill, Exercise, a "Complete:" task, any question for the student), activity ("Think and Discuss" points), open_prompt (a printed "Think", "Why?" with no printed answer): the instruction in `text`, the lettered/numbered sub-questions in `parts` [{label, stem}].
- worked_example ("Example n"): `stem` = the question; `solution` = the printed solution steps; `answer` = the final printed answer; a multi-part example uses `parts` with each part's printed `answer`.
- figure: a picture that carries maths or that the text refers to. `caption` describes it with every value, label and point read from it.
- table: `caption` (what it shows, row/column titles), `header` (column headings, corner cell first), `rows` (each row left to right, row label first). Cells exactly as printed.
- key_term (each printed key term, `term`), printed_objective (the "What you'll learn" box, `text`), heading (a printed section heading, `text`), linking_text (prose leading between items, `text`), prior_knowledge (what the page says the student already knows, `text`).
COUNTING RULES:
- Skip page furniture: running headers, page numbers, footers ("Student's Book", "For More Exercises, go to MOE website" stays as linking_text), decorative pictures, QR codes.
- Each printed bullet or numbered point of a box is its own statement record.
- A prompt with its own printed label or box ("Think", "Notice") printed inside a worked example's frame is its own record with `belongs_to` = that example's key. An unlabelled question inside the stem stays in the stem.
- Each printed question number is one exercise; its lettered sub-questions are parts. A drill with letters only is one exercise with parts. Nested labels are joined with a space ("First A").
- NUMBERED QUESTIONS ARE SEPARATE RECORDS: points printed 1, 2, 3 in a "Think and Discuss" or "Think" box are three records (label "Think and Discuss", number 1, 2, 3), never one record with parts. Only letters (A, B, C) or labelled things inside ONE question are parts. A worked example's own steps are its `solution`, not parts, unless the book prints labelled sub-questions ("First:", "A", "B").
- When an exercise or example asks the same thing of several labelled things (points A, B, C, D; points A(3, 3), B(3, -2), …), each is its own part, labelled as printed ("A", "B", …). A task that also asks for something else (shade a region, draw the net, complete C and O) gets a part for that too ("region", "plot", "C", "O"). A worked example's printed answers then go on the parts.
- A sentence that fixes notation or a name ("where n denotes the number of elements", "X × X is written X² and read X two") is a convention, its own record, even inside a numbered box.
- A worked example's `answer` is only the final answer it prints, as a short value; leave it out when the solution ends without one.
- A figure or table inside an example: `belongs_to` = the example's key. A printed answer that is a drawing: put the figure's key in the example's (or part's) `answer_figure_keys`.
FIELDS ON EVERY RECORD:
- key: "k1", "k2", … in reading order on this page.
- label: the label the book prints for prompts and examples only ("Example", "Drill", "Think", "Think and Discuss", "Exercise"), else "". number: the printed number for that label, else null.
- quote: a few EXACT printed words (5–12) that locate it, misprints and spelling slips included.
- continues: true only for the first record, when it continues the previous page's last record (same example or exercise running over the page break); then give only what is on this page.
MATHS in $...$ (LaTeX). Keep the book's notation; where a printed form needs reading, `notation` {printed, normalised}.
MISPRINTS: if the page prints something plainly wrong (a wrong value in a solution, a missing "=", a bracket that does not close, a label that contradicts the text), record it as printed and add to `misprints` [{field, printed, intended, notes}]: field names where it sits ("stem", "solution[1]", "caption", "quote", "rows[2][1]"), notes say how you know. Spelling slips that change no meaning need no entry.
NOTES: anything a reviewer should check, e.g. "point read from the figure; verify".
Read the page image with the Read tool first."""

OBJ_SYSTEM = """You draw the "can do" learning objectives of one textbook lesson from what it prints. You are given the printed objective box and every printed item (key, type, label, quote, content).
- Objectives follow the book's teaching order; each is one thing a student can do, phrased "Find…", "Represent…", "Decide…". Usually 3–6 for a lesson.
- Ground them in the printed "What you'll learn" box and in what the items actually teach. Never invent content the items do not cover.
- evidence_keys: the items that teach it; at least two, of different types where possible.
- item_objective: for every statement, worked example, exercise, activity, open prompt, figure and table, the objective it teaches (by index). Headings, key terms, linking text and printed objectives get none."""

PAGE_SCHEMA = {"type": "object", "required": ["records"], "properties": {"records": {"type": "array", "items": {
    "type": "object", "required": ["key", "type", "quote"],
    "properties": {
        "key": {"type": "string"}, "type": {"enum": ITEM_TYPES}, "label": {"type": "string"}, "number": {"type": ["integer", "null"]},
        "continues": {"type": "boolean"}, "belongs_to_key": {"type": "string"}, "quote": {"type": "string"},
        "claim": {"type": "string"}, "term": {"type": "string"}, "stem": {"type": "string"}, "text": {"type": "string"},
        "caption": {"type": "string"}, "header": {"type": "array", "items": {"type": "string"}},
        "rows": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}},
        "formula": {"type": "string"}, "examples": {"type": "array", "items": {"type": "string"}},
        "notation": {"type": "object", "properties": {"printed": {"type": "string"}, "normalised": {"type": "string"}, "notes": {"type": "string"}}},
        "parts": {"type": "array", "items": {"type": "object", "required": ["label"], "properties": {
            "label": {"type": "string"}, "stem": {"type": "string"}, "answer": {"type": "string"},
            "solution": {"type": "array", "items": {"type": "string"}}, "answer_figure_keys": {"type": "array", "items": {"type": "string"}},
            "notes": {"type": "string"},
            "misprints": {"type": "array", "items": {"type": "object", "properties": {"field": {"type": "string"}, "printed": {"type": "string"}, "intended": {"type": "string"}, "notes": {"type": "string"}}}}}}},
        "solution": {"type": "array", "items": {"type": "string"}}, "answer": {"type": "string"},
        "answer_figure_keys": {"type": "array", "items": {"type": "string"}},
        "misprints": {"type": "array", "items": {"type": "object", "properties": {"field": {"type": "string"}, "printed": {"type": "string"}, "intended": {"type": "string"}, "notes": {"type": "string"}}}},
        "notes": {"type": "string"}}}}}}
OBJ_SCHEMA = {"type": "object", "required": ["objectives", "item_objective"], "properties": {
    "objectives": {"type": "array", "items": {"type": "object", "required": ["label", "description", "evidence_keys"], "properties": {
        "label": {"type": "string"}, "description": {"type": "string"}, "evidence_keys": {"type": "array", "items": {"type": "string"}}}}},
    "item_objective": {"type": "array", "items": {"type": "object", "required": ["key", "objective"], "properties": {
        "key": {"type": "string"}, "objective": {"type": "integer"}}}}}}


# ============================================================================ calls
class Budget:
    def __init__(self, cap: float):
        self.cap, self.spent, self.calls = cap, 0.0, []

    def left(self) -> float:
        return round(self.cap - self.spent, 4)


def call_claude(system: str, prompt: str, schema: dict, model: str, budget: Budget, label: str, image_dir: Path | None = None) -> dict:
    if budget.left() <= 0.1:
        raise SystemExit(f"cost cap reached (${budget.spent:.3f} of ${budget.cap:.2f}): stopped before {label}")
    cmd = ["claude", "-p", "--output-format", "json", "--model", model, "--no-session-persistence", "--setting-sources", "",
           "--system-prompt", system, "--json-schema", json.dumps(schema), "--max-budget-usd", f"{budget.left():.2f}"]
    cmd += ["--tools", "Read", "--allowedTools", "Read", "--add-dir", str(image_dir)] if image_dir else ["--tools", ""]
    cwd = tempfile.mkdtemp(prefix="extract-")  # outside the repo: no project instructions are loaded
    try:
        res = subprocess.run(cmd, input=prompt, capture_output=True, text=True, cwd=cwd, timeout=1200)
    finally:
        shutil.rmtree(cwd, ignore_errors=True)
    try:
        out = json.loads(res.stdout)
    except json.JSONDecodeError:
        raise SystemExit(f"{label}: the CLI returned no JSON (exit {res.returncode}): {(res.stderr or res.stdout)[-600:]}")
    cost = float(out.get("total_cost_usd") or 0)
    budget.spent += cost
    budget.calls.append({"call": label, "cost_usd": round(cost, 4), "turns": out.get("num_turns"), "error": out.get("is_error") or None})
    print(f"  {label}: ${cost:.4f} (total ${budget.spent:.3f} of ${budget.cap:.2f})", file=sys.stderr)
    if out.get("is_error") or not isinstance(out.get("structured_output"), dict):
        raise SystemExit(f"{label}: no structured answer ({out.get('subtype')}): {str(out.get('result'))[:500]}")
    return out["structured_output"]


def render(pdf: Path, printed: int, offset: int, out_dir: Path) -> Path:
    import pymupdf  # noqa: PLC0415  (uv run --with pymupdf)
    f = out_dir / f"p{printed:03d}.png"
    if not f.exists():
        pymupdf.open(pdf)[printed + offset - 1].get_pixmap(dpi=150).save(f)
    return f


# ============================================================================ ids and assembly (no model)
def kebab(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def assign_ids(slug: str, recs: list[dict]) -> None:
    """README "Ids": printed label + number when the number is unique in the lesson, else label + lesson-wide count;
    no label → type + count; a clash gets "unlabelled-"."""
    labelled = defaultdict(list)
    for r in recs:
        if r.get("label"):
            labelled[kebab(r["label"])].append(r)
    taken = set()
    for base, rs in labelled.items():
        nums = [r.get("number") for r in rs]
        use_numbers = all(isinstance(n, int) for n in nums) and len(set(nums)) == len(nums)
        for i, r in enumerate(rs, start=1):
            r["id"] = f"{slug}:{base}-{r['number'] if use_numbers else i}"
            taken.add(r["id"])
    count = Counter()
    for r in recs:
        if r.get("id"):
            continue
        t = r["type"].replace("_", "-")
        count[t] += 1
        rid = f"{slug}:{t}-{count[t]}"
        r["id"] = rid if rid not in taken else f"{slug}:unlabelled-{t}-{count[t]}"
        taken.add(r["id"])


def merge_continuations(pages: list[tuple[int, list[dict]]]) -> list[dict]:
    out: list[dict] = []
    for page, recs in pages:
        for i, r in enumerate(recs):
            r["source_page"] = page
            if i == 0 and r.get("continues") and out:
                prev = out[-1]
                for k in ("solution", "parts", "examples"):
                    if r.get(k):
                        prev[k] = (prev.get(k) or []) + r[k]
                for k in ("answer", "answer_figure_keys", "misprints"):
                    if r.get(k) and not prev.get(k):
                        prev[k] = r[k]
                prev["pages"] = [prev["source_page"], page]
                prev.setdefault("_alias", []).append(r["_key"])
                continue
            out.append(r)
    return out


def clean_misprints(holder: dict) -> None:
    ms = [m for m in holder.get("misprints") or [] if m.get("field") and m.get("printed") and m.get("intended")]
    good = [m for m in ms if V.resolves(holder, m["field"])]
    bad = [m for m in ms if m not in good]
    if bad:
        holder["notes"] = (holder.get("notes", "") + " Possible misprint(s), field not recorded: "
                           + "; ".join(f"{m['printed']} → {m['intended']}" for m in bad)).strip()
    if good:
        holder["misprints"] = [{k: m[k] for k in ("field", "printed", "intended", "notes") if m.get(k)} for m in good]
    else:
        holder.pop("misprints", None)


def finish_item(r: dict, by_key: dict[str, str], types: dict[str, str], prov: dict) -> dict:
    t = r["type"]
    item = {"id": r["id"], "type": t}
    if r.get("belongs_to_key") in by_key and by_key[r["belongs_to_key"]] != r["id"]:
        item["belongs_to"] = by_key[r["belongs_to_key"]]
    item["source_page"] = r["source_page"]
    if r.get("pages") and r["pages"][0] != r["pages"][1]:
        item["pages"] = r["pages"]
    item["quote"] = (r.get("quote") or "").strip() or None
    if not item["quote"]:
        item.pop("quote")
        item["anchor"] = f"p{r['source_page']}-{r['_key']}"
    for k in ("claim", "term", "stem", "text", "caption", "formula", "examples", "solution", "answer"):
        if r.get(k):
            item[k] = r[k]
    if t == "table":
        item["header"] = r.get("header") or []
        item["rows"] = r.get("rows") or [[""]]
    if r.get("notation", {}).get("printed") and r["notation"].get("normalised"):
        item["notation"] = {k: v for k, v in r["notation"].items() if v}
    main = MAIN.get(t, "text")
    if not item.get(main):  # the schema requires the main text field
        item[main] = r.get("text") or r.get("stem") or r.get("claim") or r.get("caption") or r.get("quote") or ""
    figs = lambda keys: [by_key[k] for k in keys or [] if k in by_key and types.get(by_key[k]) in ("figure", "table")]
    if r.get("parts"):
        item["parts"] = []
        for p in r["parts"]:
            q = {"label": str(p.get("label") or "?")}
            for k in ("stem", "answer", "solution", "notes", "misprints"):
                if p.get(k):
                    q[k] = p[k]
            af = figs(p.get("answer_figure_keys"))
            if af:
                q["answer_figure"] = af if len(af) > 1 else af[0]
            if q.get("answer") or q.get("answer_figure"):
                q["solution_provenance"] = "book_worked" if t == "worked_example" else "book_printed"
            clean_misprints(q)
            item["parts"].append(q)
    af = figs(r.get("answer_figure_keys"))
    if af:
        item["answer_figure"] = af if len(af) > 1 else af[0]
    if item.get("answer") or item.get("answer_figure"):
        item["solution_provenance"] = "book_worked" if t == "worked_example" else "book_printed"
    if r.get("misprints"):
        item["misprints"] = r["misprints"]
    clean_misprints(item)
    if r.get("notes"):
        item["notes"] = r["notes"]
    item["provenance"] = prov
    return item


def item_summary(r: dict) -> str:
    body = r.get("claim") or r.get("stem") or r.get("text") or r.get("caption") or r.get("term") or ""
    parts = "; ".join(f"{p.get('label')}: {p.get('stem', '')}" for p in r.get("parts") or [])
    return f"[{r['_key']}] {r['type']}{' ' + r['label'] if r.get('label') else ''} (p.{r['source_page']}): {body[:240]}{' | parts: ' + parts[:200] if parts else ''}"


def extract_lesson(book: str, cfg: dict, lesson: dict, offset: int, model: str, budget: Budget) -> dict:
    slug = lesson["slug"]
    pdf = REPO / cfg["sources"]["pdf"]
    img_dir = HERE / "work" / book / "page-images"
    img_dir.mkdir(parents=True, exist_ok=True)
    first, last = lesson["pages"]
    pages: list[tuple[int, list[dict]]] = []
    prev_last = None
    for printed in range(first, last + 1):
        f = render(pdf, printed, offset, img_dir)
        ctx = (f"The previous page's last record: {prev_last['type']}{' ' + prev_last['label'] if prev_last.get('label') else ''} "
               f"\"{(prev_last.get('quote') or '')[:80]}\". If this page starts by continuing it, set continues=true on the first record."
               if prev_last else "This is the lesson's first page.")
        prompt = (f"Book: {cfg['title']}\nLesson: {lesson['syllabus_ref']} {lesson['title']} ({lesson['module']}), printed pages {first}–{last}.\n"
                  f"This is printed page {printed}. The page image: {f}\n{ctx}\n"
                  + ("Records on this page that belong to the next lesson or unit: leave them out.\n" if printed == last else "")
                  + "Record everything this page prints for this lesson.")
        out = call_claude(PAGE_SYSTEM, prompt, PAGE_SCHEMA, model, budget, f"{slug} p.{printed}", img_dir)
        recs = out.get("records") or []
        for r in recs:
            r["_key"] = f"p{printed}-{r.get('key') or len(recs)}"
            r["belongs_to_key"] = f"p{printed}-{r['belongs_to_key']}" if r.get("belongs_to_key") else None
            r["answer_figure_keys"] = [f"p{printed}-{k}" for k in r.get("answer_figure_keys") or []]
            for p in r.get("parts") or []:
                p["answer_figure_keys"] = [f"p{printed}-{k}" for k in p.get("answer_figure_keys") or []]
        pages.append((printed, recs))
        if recs:
            prev_last = recs[-1]
    recs = merge_continuations(pages)
    assign_ids(slug, recs)
    by_key = {r["_key"]: r["id"] for r in recs}
    for r in recs:
        for a in r.get("_alias") or []:
            by_key[a] = r["id"]
    types = {r["id"]: r["type"] for r in recs}
    stamp = date.today().isoformat()
    prov = {"by": f"extract_book_record.py {VERSION}, {model}, {stamp}", "method": "page image"}
    items = [finish_item(r, by_key, types, prov) for r in recs]

    # objectives (text only)
    lines = [item_summary(r) for r in recs]
    obj = call_claude(OBJ_SYSTEM, f"Lesson: {lesson['syllabus_ref']} {lesson['title']}\n\nITEMS\n" + "\n".join(lines),
                      OBJ_SCHEMA, model, budget, f"{slug} objectives")
    objectives = []
    for n, o in enumerate(obj.get("objectives") or [], start=1):
        ev = list(dict.fromkeys(by_key[k] for k in o.get("evidence_keys") or [] if k in by_key))
        if ev:
            objectives.append({"id": f"{slug}:objective-{n}", "label": o["label"], "description": o["description"],
                               "order_in_parent": n, "evidence": ev, "provenance": prov})
    valid = {o["order_in_parent"]: o["id"] for o in objectives}
    lo_of = {by_key[x["key"]]: valid[x["objective"]] for x in obj.get("item_objective") or []
             if x.get("key") in by_key and x.get("objective") in valid}
    ordered = []
    for it in items:
        if it["id"] in lo_of and it["type"] not in ("heading", "key_term", "linking_text", "printed_objective"):
            it = {"id": it["id"], "type": it["type"], "lo": lo_of[it["id"]], **{k: v for k, v in it.items() if k not in ("id", "type")}}
        ordered.append(it)

    src = {"title": cfg["title"], "publisher": cfg.get("publisher") or "Arab Republic of Egypt, Ministry of Education & Technical Education",
           "language": cfg.get("language", "en"), "grade": cfg.get("grade"), "subject": cfg.get("subject"),
           "course_id": cfg.get("course_id"), "file_path": cfg["sources"]["pdf"], "page_offset": offset,
           "text_layer": "almost empty; read from the page images"}
    return {"schema": "book-record", "schema_version": 2, "role": "extraction",
            "source_document": {k: v for k, v in src.items() if v is not None},
            "lesson": {"slug": slug, "syllabus_ref": lesson["syllabus_ref"], "title": lesson["title"], "module": lesson["module"],
                       "pages": lesson["pages"], "provenance": prov},
            "items": ordered, "learning_objectives": objectives, "provenance": prov,
            "review": {"status": "draft", "reviewed_by": None, "reviewed_at": None},
            "open_questions": [], "history": [f"{stamp}: extracted from the page images ({VERSION}, {model})"]}


def check(doc: dict) -> list[str]:
    errs = V.rule_errors(doc)
    try:
        from jsonschema import Draft202012Validator  # noqa: PLC0415
        val = Draft202012Validator(json.loads((HERE / "groundtruth" / "book-record.schema.json").read_text()))
        errs += [f"schema: /{'/'.join(map(str, e.absolute_path))}: {e.message[:160]}" for e in val.iter_errors(doc)]
    except ImportError:
        errs.append("jsonschema not installed: schema not checked (uv run --with jsonschema)")
    return errs


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("book")
    r.add_argument("lessons", nargs="*", help="lesson slugs (default with --all: every lesson in the map)")
    r.add_argument("--all", action="store_true")
    r.add_argument("--cap", type=float, default=10.0)
    r.add_argument("--model", default="sonnet")
    r.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    cfg = json.loads((HERE / "books" / f"{a.book}.json").read_text())
    lmap = json.loads((HERE / "book-records" / a.book / "lessons.json").read_text())
    todo = [l for l in lmap["lessons"] if a.all or l["slug"] in a.lessons]
    if not todo:
        raise SystemExit("no lessons: name them or pass --all")
    budget = Budget(a.cap)
    report = []
    for lesson in todo:
        out = HERE / "book-records" / a.book / f"{lesson['slug']}.json"
        if out.exists() and not a.force:
            print(f"{lesson['slug']}: already extracted (--force to redo)", file=sys.stderr)
            continue
        print(f"{lesson['slug']}: pages {lesson['pages'][0]}–{lesson['pages'][1]}", file=sys.stderr)
        before = budget.spent
        doc = extract_lesson(a.book, cfg, lesson, lmap["page_offset"], a.model, budget)
        doc["history"][-1] += f", ${budget.spent - before:.3f}"
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
        errs = check(doc)
        report.append((lesson["slug"], len(doc["items"]), len(doc["learning_objectives"]), budget.spent - before, errs))
        print(f"  -> {out.relative_to(HERE)}: {len(doc['items'])} items, {len(doc['learning_objectives'])} objectives, "
              f"${budget.spent - before:.3f}, {len(errs)} problem(s)", file=sys.stderr)
        for e in errs[:15]:
            print(f"     {e}", file=sys.stderr)
    runlog = HERE / "book-records" / a.book / "extraction-runs.jsonl"
    with runlog.open("a") as f:
        f.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "version": VERSION, "model": a.model,
                            "lessons": [x[0] for x in report], "cost_usd": round(budget.spent, 4), "calls": budget.calls}) + "\n")
    print(f"done: ${budget.spent:.3f} of ${budget.cap:.2f}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""Extract a lesson's book record (v2, role "extraction") from the page images, for a book with no usable text layer.

    uv run --with pymupdf --with jsonschema extract_book_record.py run prep3-math-en u1-2 [--cap 10] [--model sonnet] [--force]
    uv run --with pymupdf --with jsonschema extract_book_record.py run prep3-math-en --all [--cap 10]
    uv run --with jsonschema extract_book_record.py objectives prep3-math-en u1-1 [--cap 2]   # step 3 again, from the saved record

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
     items, each citing its evidence, says which objective each item teaches, and which figure printed apart
     from a prompt a student must look at to answer it (`uses_figure`). `objectives` runs this step again on a
     saved record, with nothing read from the pages.
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

VERSION = "ext-v5"  # v5: the page and filing agents are runbook/book-record.workflow.js (v4: objectives numbered from 1, uses_figure)
ITEM_TYPES = ["definition", "rule", "caution", "convention", "method", "exercise", "activity", "open_prompt",
              "worked_example", "figure", "table", "key_term", "printed_objective", "heading", "linking_text",
              "prior_knowledge"]
STATEMENTS = {"definition", "rule", "caution", "convention", "method"}
MAIN = {**{t: "claim" for t in STATEMENTS}, "key_term": "term", "figure": "caption", "table": "caption", "worked_example": "stem"}

# PAGE_SYSTEM: in runbook/book-record.workflow.js since ext-v5 (one copy of every prompt)

# OBJ_SYSTEM: in runbook/book-record.workflow.js since ext-v5 (one copy of every prompt)

# PAGE_SCHEMA, OBJ_SCHEMA: in runbook/book-record.workflow.js since ext-v5


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
    inside = f" (inside {r['belongs_to_key']})" if r.get("belongs_to_key") else ""
    return f"[{r['_key']}] {r['type']}{' ' + r['label'] if r.get('label') else ''} (p.{r['source_page']}){inside}: {body[:240]}{' | parts: ' + parts[:200] if parts else ''}"


def page_dir(book: str, lesson: dict) -> Path:
    """Where a lesson's page images are cached. Images are named by printed page, so a lesson printed under its own
    numbering (lessons.json `page_offset` on the lesson: a second term restarting at 1) gets its own folder."""
    base = HERE / "work" / book / "page-images"
    return base / f"offset{lesson['page_offset']}" if "page_offset" in lesson else base


def lesson_args(book: str, cfg: dict, lesson: dict, offset: int) -> dict:
    """One lesson of the workflow's args: its pages rendered to images (work/<book>/page-images/)."""
    pdf = REPO / cfg["sources"]["pdf"]
    offset = lesson.get("page_offset", offset)
    img_dir = page_dir(book, lesson)
    img_dir.mkdir(parents=True, exist_ok=True)
    first, last = lesson["pages"]
    images = {str(p): str(render(pdf, p, offset, img_dir).resolve()) for p in range(first, last + 1)}
    return {k: lesson[k] for k in ("slug", "syllabus_ref", "title", "module", "pages")} | {"images": images}


def build_args(book: str, cfg: dict, lessons: list[dict], offset: int, model: str) -> dict:
    return {"stage": "S0a-pages", "book": {"book": book, "title": cfg["title"]},
            "lessons": [lesson_args(book, cfg, l, offset) for l in lessons], "options": {"model": model}}


def accept_lesson(book: str, cfg: dict, lesson: dict, offset: int, run_lesson: dict, version: str, model: str) -> dict:
    """A lesson of a saved workflow return → its book record (ids, continuations, links, provisional filing)."""
    slug = lesson["slug"]
    offset = lesson.get("page_offset", offset)
    pages = [(p["printed"], p["records"]) for p in run_lesson["pages"]]
    recs = merge_continuations(pages)
    assign_ids(slug, recs)
    by_key = {r["_key"]: r["id"] for r in recs}
    for r in recs:
        for a in r.get("_alias") or []:
            by_key[a] = r["id"]
    types = {r["id"]: r["type"] for r in recs}
    stamp = date.today().isoformat()
    prov = {"by": f"runbook/book-record.workflow.js {version}, {model}, {stamp}", "method": "page image"}
    items = [finish_item(r, by_key, types, prov) for r in recs]
    objectives, ordered = filed(run_lesson.get("filing") or {}, slug, by_key, items, prov)
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
            "open_questions": [], "history": [f"{stamp}: extracted from the page images ({version}, {model})"]}


PROMPTS = ("exercise", "activity", "open_prompt", "worked_example")
NO_OBJECTIVE = ("heading", "key_term", "linking_text", "printed_objective")


def filed(obj: dict, slug: str, by_key: dict, items: list[dict], prov: dict) -> tuple[list[dict], list[dict]]:
    """The filing agent's answer (runbook/book-record.workflow.js, phase Filing) applied: the lesson's provisional
    objectives, each item's objective, and the figures a prompt needs (uses_figure). Objectives are numbered from 1;
    ext-v3's model counted from 0 and filed every item one objective early (found by the Unit 1 smoke test,
    2026-10-16), so an answer that counts from 0 is refused. S1 replaces these objectives at G1."""
    objectives = []
    for n, o in enumerate(obj.get("objectives") or [], start=1):
        ev = list(dict.fromkeys(by_key[k] for k in o.get("evidence_keys") or [] if k in by_key))
        if ev:
            objectives.append({"id": f"{slug}:objective-{n}", "label": o["label"], "description": o["description"],
                               "order_in_parent": n, "evidence": ev, "provenance": prov})
    lazy = [o["label"] for o in objectives if re.fullmatch(r"(?i)\s*(?:obj(?:ective)?)\s*\d+\s*", o["label"])]
    if lazy:
        raise SystemExit(f"{slug} objectives: placeholder labels {lazy}: run again")
    nums = [x.get("objective") for x in obj.get("item_objective") or []]
    if nums and 0 in nums and len(objectives) not in nums:
        raise SystemExit(f"{slug} objectives: item_objective counts from 0 although the prompt counts from 1: not filed")
    valid = {o["order_in_parent"]: o["id"] for o in objectives}
    lo_of = {by_key[x["key"]]: valid[x["objective"]] for x in obj.get("item_objective") or []
             if x.get("key") in by_key and x.get("objective") in valid}
    types = {it["id"]: it["type"] for it in items}
    figs_of: dict[str, list[str]] = {}
    for x in obj.get("prompt_figures") or []:
        rid = by_key.get(x.get("key"))
        figs = [by_key[k] for k in x.get("figures") or [] if k in by_key and types.get(by_key[k]) == "figure"]
        if rid and types.get(rid) in PROMPTS and figs:
            inside = {it["id"] for it in items if it.get("belongs_to") == rid}
            figs = [f for f in dict.fromkeys(figs) if f not in inside]
            if figs:
                figs_of[rid] = figs
    ordered = []
    for it in items:
        it = {k: v for k, v in it.items() if k not in ("lo", "uses_figure")}
        if it["id"] in lo_of and it["type"] not in NO_OBJECTIVE:
            it = {"id": it["id"], "type": it["type"], "lo": lo_of[it["id"]], **{k: v for k, v in it.items() if k not in ("id", "type")}}
        if it["id"] in figs_of:
            it["uses_figure"] = figs_of[it["id"]] if len(figs_of[it["id"]]) > 1 else figs_of[it["id"]][0]
        ordered.append(it)
    return objectives, ordered


def record_summary(it: dict) -> str:
    """item_summary for a saved record: the item's id is its key."""
    body = it.get("claim") or it.get("stem") or it.get("text") or it.get("caption") or it.get("term") or ""
    parts = "; ".join(f"{p.get('label')}: {p.get('stem') or p.get('text') or ''}" for p in it.get("parts") or [])
    inside = f" (inside {it['belongs_to']})" if it.get("belongs_to") else ""
    return f"[{it['id']}] {it['type']} (p.{it['source_page']}){inside}: {body[:240]}{' | parts: ' + parts[:200] if parts else ''}"


def redraw_objectives(book: str, lesson: dict, filing: dict, version: str, model: str) -> dict:
    """A saved record's objectives, item filing and figure links, drawn again from the workflow's filing answer
    (mode "filing": no page is read)."""
    path = HERE / "book-records" / book / f"{lesson['slug']}.json"
    doc = json.loads(path.read_text())
    stamp = date.today().isoformat()
    prov = {"by": f"runbook/book-record.workflow.js {version} (filing redrawn), {model}, {stamp}", "method": "page image"}
    items = doc["items"]
    objectives, ordered = filed(filing, lesson["slug"], {it["id"]: it["id"] for it in items}, items, prov)
    doc["learning_objectives"], doc["items"] = objectives, ordered
    doc.setdefault("history", []).append(f"{stamp}: objectives, item filing and figure links redrawn ({version}, {model})")
    return doc


def check(doc: dict) -> list[str]:
    errs = V.rule_errors(doc)
    try:
        from jsonschema import Draft202012Validator  # noqa: PLC0415
        val = Draft202012Validator(json.loads((HERE / "groundtruth" / "book-record.schema.json").read_text()))
        errs += [f"schema: /{'/'.join(map(str, e.absolute_path))}: {e.message[:160]}" for e in val.iter_errors(doc)]
    except ImportError:
        errs.append("jsonschema not installed: schema not checked (uv run --with jsonschema)")
    return errs


def run_workflow(book: str, args: dict, name: str, cap: float, args_only: bool) -> dict | None:
    """The embedded copy of runbook/book-record.workflow.js (for Claude Code), and, unless args_only, its run here."""
    import embed_workflow as EW  # noqa: PLC0415
    import workflow_runner as WR  # noqa: PLC0415
    copy = EW.default_out(book, "book-record", name)
    print(EW.summary(EW.write(HERE / "runbook" / "book-record.workflow.js", args, copy)), file=sys.stderr)
    if args_only:
        return None
    _run, res, _cost = WR.run_copy(copy, [HERE / "work" / book / "page-images"], cap, name, book, "book-record", stage="S0a")
    return res


def accept(book: str, cfg: dict, lmap: dict, res: dict, force: bool) -> list[tuple]:
    """A saved return of the workflow → the lessons' book records (ids, continuations, links, provisional filing)."""
    report = []
    by_slug = {l["slug"]: l for l in lmap["lessons"]}
    for rl in res.get("lessons") or []:
        lesson = by_slug[rl["slug"]]
        out = HERE / "book-records" / book / f"{rl['slug']}.json"
        if out.exists() and not force:
            print(f"{rl['slug']}: already extracted (--force to replace)", file=sys.stderr)
            continue
        if any(p.get("failed") for p in rl["pages"]):
            print(f"{rl['slug']}: a page agent returned nothing: not written, run it again", file=sys.stderr)
            continue
        doc = accept_lesson(book, cfg, lesson, lmap["page_offset"], rl, res.get("prompts_version"), "sonnet")
        errs = check(doc)
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
        report.append((rl["slug"], len(doc["items"]), len(doc["learning_objectives"]), errs))
        print(f"  -> {out.relative_to(HERE)}: {len(doc['items'])} items, {len(doc['learning_objectives'])} provisional objectives, "
              f"{len(errs)} problem(s)", file=sys.stderr)
        for e in errs[:15]:
            print(f"     {e}", file=sys.stderr)
    return report


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, help_ in (("run", "read the pages (the workflow, run here) and write the records"),
                        ("args", "write the workflow's embedded copy, for Claude Code"),
                        ("objectives", "file a saved record's items again (the workflow's filing mode)")):
        r = sub.add_parser(name, help=help_)
        r.add_argument("book")
        r.add_argument("lessons", nargs="*", help="lesson slugs (default with --all: every lesson in the map)")
        r.add_argument("--all", action="store_true")
        r.add_argument("--cap", type=float, default=10.0)
        r.add_argument("--model", default="sonnet")
        r.add_argument("--force", action="store_true")
    acc = sub.add_parser("accept", help="a saved return of the workflow → book records")
    acc.add_argument("book")
    acc.add_argument("run_file", type=Path)
    acc.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    cfg = json.loads((HERE / "books" / f"{a.book}.json").read_text())
    lmap = json.loads((HERE / "book-records" / a.book / "lessons.json").read_text())
    if a.cmd == "accept":
        accept(a.book, cfg, lmap, json.loads(a.run_file.read_text()), a.force)
        return 0
    todo = [l for l in lmap["lessons"] if a.all or l["slug"] in a.lessons]
    if not todo:
        raise SystemExit("no lessons: name them or pass --all")
    if a.cmd == "objectives":
        lessons = []
        for l in todo:
            doc = json.loads((HERE / "book-records" / a.book / f"{l['slug']}.json").read_text())
            lessons.append({k: l[k] for k in ("slug", "syllabus_ref", "title", "module", "pages")}
                           | {"images": {}, "items_text": [record_summary(it) for it in doc["items"]]})
        args = {"stage": "S0a-pages", "mode": "filing", "book": {"book": a.book, "title": cfg["title"]}, "lessons": lessons,
                "options": {"model": a.model}}
        res = run_workflow(a.book, args, "filing", a.cap, False)
        for rl in res["lessons"]:
            l = next(x for x in todo if x["slug"] == rl["slug"])
            doc = redraw_objectives(a.book, l, rl["filing"] or {}, res.get("prompts_version"), a.model)
            errs = check(doc)
            if errs:
                print(f"{rl['slug']}: NOT written:\n  " + "\n  ".join(errs[:15]), file=sys.stderr)
                continue
            (HERE / "book-records" / a.book / f"{rl['slug']}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
            print(f"{rl['slug']}: {len(doc['learning_objectives'])} objectives, {sum(1 for it in doc['items'] if it.get('lo'))} items filed, "
                  f"{sum(1 for it in doc['items'] if it.get('uses_figure'))} prompt(s) linked to a figure", file=sys.stderr)
        return 0
    if a.cmd == "run" and not a.force:
        todo = [l for l in todo if not (HERE / "book-records" / a.book / f"{l['slug']}.json").exists()]
        if not todo:
            print("every lesson named is already extracted (--force to redo)", file=sys.stderr)
            return 0
    args = build_args(a.book, cfg, todo, lmap["page_offset"], a.model)
    tag = todo[0]["slug"] if len(todo) == 1 else f"{todo[0]['slug']}..{todo[-1]['slug']}"
    res = run_workflow(a.book, args, f"pages.{tag}", a.cap, a.cmd == "args")
    if res is not None:
        accept(a.book, cfg, lmap, res, True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

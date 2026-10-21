"""BOOK WIDGETS — the book's own construction exercises as widget questions, with method hints (an S7 variant).

    uv run book_widgets.py args   <book> <lesson> …  --dsn …        # the author packet, for a look (no model call)
    uv run book_widgets.py author <book> <lesson> …  --dsn … [--cap 4]
    uv run book_widgets.py verify <book> <lesson> …  --dsn … [--cap 4]
    uv run book_record_generation.py finish <book> <lesson> … --dsn …   # Samuel's finishing passes, unchanged

Tamer, 2026-10-21 ("let's try 1+2 for unit 1 … through the independent solver as usual, and held for review in case
anything does not seem right"). Samuel's S7 (runbook/widgets.workflow.js, book_record_generation.py s7-author /
s7-verify) starts from a misconception; this variant starts from the BOOK'S EXERCISES (option 1) and gives the
predicates no misconception names a METHOD HINT grounded in a solution step (option 2). It runs
runbook/widgets-book.workflow.js; his workflow is untouched and stays the S7 default, and this is NOT in the ingest plan.

What it shares with S7, so every review rule holds: the templates land in teaching/<book>/widgets/ like his, are
checked by generate_widget_questions.py (a malformed one is held in widgets-held/), verified by his blind verifier's
prompt (word for word, plus a step that judges the hints), and `finish` applies the verdicts by decision 47: a mapping
or hint the verifier did not confirm is HELD (`pending_review` / `pending_hints`), never shown, until a human keeps it.
The verify runs are saved as runs/<book>/widgets/s7b-verify.*.json, which `finish` reads beside s7-verify.

THE PACKET, per objective of the named lessons: its misconceptions (own and its prerequisites', from the database),
its worked examples (the method every solution and hint is grounded in), and its book exercises (book-records/), each
part with the book's answer where compile kept one and THE PARENT the template must copy — the part's own question
row, else the objective's worked example (parent_kind "teaching", migration 038), else the objective's first book
question.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_config  # noqa: E402
import book_record_generation as BRG  # noqa: E402
import embed_workflow as EW  # noqa: E402
import generate_widget_questions as GW  # noqa: E402
import widget_spec as W  # noqa: E402
import workflow_runner as WR  # noqa: E402

WORKFLOW = HERE / "runbook" / "widgets-book.workflow.js"
EXERCISE_TYPES = ("exercise", "activity", "open_prompt")


def lo_of(record_lo: str | None) -> str | None:
    """`pp3u1-4:objective-3` (a book record's) -> `lo:pp3u1-4-3`."""
    m = re.match(r"^([a-z0-9-]+):objective-([0-9]+)$", record_lo or "")
    return f"lo:{m.group(1)}-{m.group(2)}" if m else None


def compiled(book: str, slugs: list[str]) -> tuple[dict, list[dict]]:
    """(question id -> compiled question, worked examples) of the named lessons."""
    qs, wes = {}, []
    for b in BRG.unit_bundles(book, slugs):
        for q in b.get("questions") or []:
            qs[q["id"]] = q
        wes += [e for e in b.get("explanation_entries") or [] if e.get("entry_type") == "worked_example"]
    return qs, wes


def author_args(book_name: str, slugs: list[str], dsn: str) -> dict:
    book = book_config.load_book(BRG.book_view(book_name, slugs))
    graph = GW.PgGraph(dsn)
    mcs, los, db_qs, teaching = graph.misconceptions(), graph.objectives(), graph.questions(), graph.teaching()
    qs, wes = compiled(book_name, slugs)
    # a part that already has a book widget is not offered again (a re-run adds, never duplicates)
    done = {json.loads(f.read_text()).get("book_item") for f in BRG.widgets_dir(book_name).glob("*.json")}
    lessons = []
    for slug in slugs:
        rec = json.loads((HERE / "book-records" / book_name / f"{slug}.json").read_text())
        objs: dict[str, dict] = {}
        for lo in sorted(l for l in los if re.match(rf"^lo:{re.escape(slug)}-[0-9]+$", l)):
            closure = graph.closure(lo)
            objs[lo] = {"lo_id": lo, "label": los[lo]["label"], "description": los[lo]["description"],
                        "misconceptions": [{"id": i, "lo_id": m["lo_id"], "label": m["label"],
                                            "description": m["description"], "own": m["lo_id"] == lo}
                                           for i, m in sorted(mcs.items()) if m["lo_id"] in closure],
                        "worked_examples": [{"id": e["id"],
                                             "problem": next((c["text_md"] for c in e["content"] if c.get("kind") == "problem"), ""),
                                             "steps": [c["text_md"] for c in e["content"] if "step" in c]}
                                            for e in wes if e.get("lo") == lo and e["id"] in teaching],
                        "exercises": []}
        for it in rec["items"]:
            lo = lo_of(it.get("lo"))
            if it["type"] not in EXERCISE_TYPES or lo not in objs:
                continue
            tail, item = lo.removeprefix("lo:"), it["id"].split(":", 1)[1]
            o = objs[lo]
            # no row of its own: a book question of the same activity (think-and-discuss-1 for -2), else the first
            base = re.sub(r"-[0-9]+$", "", item)
            seeds = sorted(i for i in db_qs if db_qs[i]["lo_id"] == lo and db_qs[i]["source"] == "seed")
            first_q = next((i for i in seeds if i.startswith(f"q:{tail}:bk-{base}")), seeds[0] if seeds else None)

            def parent(part: str | None):
                own = f"q:{tail}:bk-{item}" + (f"-{part.lower()}" if part else "")
                if own in db_qs:
                    return own, "question"
                if o["worked_examples"]:
                    return o["worked_examples"][0]["id"], "teaching"
                return (first_q, "question") if first_q else (None, None)
            parts = []
            for p in it.get("parts") or [{"label": None, "stem": None}]:
                if f"{it['id']}#{p['label']}" in done or (p.get("label") is None and it["id"] in done):
                    continue
                pid, pk = parent(p.get("label"))
                if not pid:
                    continue   # nothing in the database to hang it on: no widget can be shipped for it
                q = qs.get(f"q:{tail}:bk-{item}" + (f"-{p['label'].lower()}" if p.get("label") else ""))
                parts.append({"part": p.get("label"), "stem": p.get("stem"), "parent": pid, "parent_kind": pk,
                              **({"book_answer": q["answer"]} if q else {})})
            if parts:
                o["exercises"].append({"item": it["id"], "type": it["type"], "page": it.get("source_page"),
                                       "text": it.get("stem") or it.get("text") or "", "parts": parts})
        mod = {m["id"]: m["label"] for m in graph.modules(book.course_id)}.get(graph.module_of().get(next(iter(objs), "")), "")
        lessons.append({"lesson": slug, "module_label": mod, "objectives": list(objs.values())})
    contract = {k: {"predicates": v["predicates"], "can_emit": v.get("can_emit"), "instrument": GW.INSTRUMENTS.get(k, "")}
                for k, v in W.contract()["kinds"].items()}
    return book_config.workflow_args(book, extra={"mode": "author", "contract": contract, "lessons": lessons})


def write_templates(book: str, slugs: list[str], run: Path) -> list[str]:
    """The run's templates into teaching/<book>/widgets/, never overwriting one (as BRG.merge_author does, without
    touching Samuel's runs/<book>/widgets/author-merged.json)."""
    merged = GW.merge_author_runs([run])
    fresh = HERE / "work" / book / "unit-view" / slugs[0] / "widgets-book-new"
    fresh.mkdir(parents=True, exist_ok=True)
    for f in fresh.glob("*.json"):
        f.unlink()
    written, problems = GW.write_templates(merged, fresh)
    if problems:
        raise SystemExit("\n".join(problems))
    wdir = BRG.widgets_dir(book)
    wdir.mkdir(parents=True, exist_ok=True)
    added = []
    for f in sorted(written):
        if not (wdir / f.name).exists():
            (wdir / f.name).write_bytes(f.read_bytes())
            added.append(f.name)
    print(f"wrote {len(added)} book widget template(s) to {wdir.relative_to(HERE)}: {added}", file=sys.stderr)
    return added


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cmd", choices=("args", "author", "verify"))
    ap.add_argument("book")
    ap.add_argument("lessons", nargs="+")
    ap.add_argument("--dsn", required=True, help="the database holding the compiled lessons and their catalogue")
    ap.add_argument("--cap", type=float, default=4.0)
    a = ap.parse_args(argv)
    runs = HERE / "runs" / a.book / "widgets"
    runs.mkdir(parents=True, exist_ok=True)
    if a.cmd in ("args", "author"):
        args = author_args(a.book, a.lessons, a.dsn)
        path = runs / "s7b-author.args.json"
        path.write_text(json.dumps(args, indent=1, ensure_ascii=False) + "\n")
        n = sum(len(e["parts"]) for l in args["lessons"] for o in l["objectives"] for e in o["exercises"])
        print(f"wrote {path.relative_to(HERE)}: {len(args['lessons'])} lesson(s), {n} exercise part(s)", file=sys.stderr)
        if a.cmd == "args":
            return 0
        copy = EW.default_out(a.book, "widgets", "s7b-author.bookrecord")
        print(EW.summary(EW.write(WORKFLOW, args, copy)), file=sys.stderr)
        run, _res, _cost = WR.run_copy(copy, [], a.cap, "s7b-author", a.book, "widgets", stage="S7")
        write_templates(a.book, a.lessons, run)
        return 0
    # verify: the unit's templates (Samuel's checks first; a malformed one is held in widgets-held/), then the variant
    view = BRG.book_view(a.book, a.lessons)
    wdir = BRG.widgets_dir(a.book)
    vargs = runs / "s7b-verify.args.json"
    common = ["--templates", str(BRG.unit_dir(a.book, wdir, a.lessons, "widgets")), "--book", str(view), "--dsn", a.dsn]
    BRG.hold_malformed_templates(a.book, a.lessons, wdir, [*common, "--verify-args", str(vargs)])
    common[1] = str(BRG.unit_dir(a.book, wdir, a.lessons, "widgets"))
    if not any(Path(common[1]).glob("*.json")):
        print("verify: no template left for these lessons", file=sys.stderr)
        return 0
    BRG.gw(*common, "--verify-args", str(vargs))
    copy = EW.default_out(a.book, "widgets", "s7b-verify.bookrecord")
    print(EW.summary(EW.write(WORKFLOW, json.loads(vargs.read_text()), copy)), file=sys.stderr)
    WR.run_copy(copy, [], a.cap, "s7b-verify", a.book, "widgets", stage="S7")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

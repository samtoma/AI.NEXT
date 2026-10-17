"""After G1: file a unit's statements, tables and figures under the objectives a person approved (Samuel's way).

    uv run book_record_filing.py run    prep3-math-en 1 [--cap 2]       # two blind readings, then accept
    uv run book_record_filing.py args   prep3-math-en 1                 # the embedded copy, for Claude Code
    uv run book_record_filing.py accept prep3-math-en 1 runs/<book>/filing/<saved return>.json
    uv run book_record_filing.py apply  prep3-math-en 1 [--dry-run]     # agreements + the review tool's decisions → records

Decided by Tamer, 2026-10-17 ("Sam's way"). book_record_objectives.py apply writes the approved objectives and S1's own
filing, which covers exercises and worked examples only (Samuel's S1). On Grade 10 the book's statements get their
objective at S2 and its figures at S4, both after G1, from agents that read the approved objectives; a book-record
lesson's statements, tables and figures came from the page reader under provisional objectives G1 replaced, so after
apply they are filed under nothing, and the tutor would neither quote them nor show them with a topic.

runbook/filing.workflow.js reads every item that is not a heading, key term, linking text or printed objective box and
has no objective (a prompt S1 left unmapped included), twice and blind, against the approved objectives. Here:
  - both readings give the same objective (or both say none): written into the book record, a history line says so;
  - they differ, or one returned nothing: listed in teaching/<book>/filing/ch<NN>.json, shown in the review tool's
    Objectives (G1) task as kind "Filing", where a person picks the objective or none
    (reviews/<book>/objectives-g1.json); `apply` writes those decisions, only while the item and the lesson's objectives
    are what the readers saw (a fingerprint).
Run it after every `book_record_objectives.py apply`, which rewrites the filing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_config  # noqa: E402

FORMAT = "ainext.filing/1"
NO_OBJECTIVE = ("heading", "key_term", "linking_text", "printed_objective")


def record_path(book: str, slug: str) -> Path:
    return HERE / "book-records" / book / f"{slug}.json"


def text_of(it: dict) -> str:
    t = it.get("claim") or it.get("text") or it.get("stem") or it.get("caption") or it.get("term") or ""
    if it["type"] == "table":
        rows = [it.get("header") or []] + (it.get("rows") or [])
        t = f"{t} " + " / ".join(", ".join(str(c) for c in r) for r in rows if r)
    if it.get("formula"):
        t = f"{t} {it['formula']}"
    return " ".join(str(t).split())[:400]


def lesson_view(book: str, slug: str) -> dict:
    rec = json.loads(record_path(book, slug).read_text())
    objs = sorted(rec.get("learning_objectives") or [], key=lambda o: o.get("order_in_parent", 0))
    by_lo: dict[str, list[str]] = {}
    for it in rec["items"]:
        if it.get("lo"):
            by_lo.setdefault(it["lo"], []).append(f"{it['type'].replace('_', ' ')}: {text_of(it)[:90]}")
    items = [{"key": it["id"], "type": it["type"].replace("_", " "), "page": it.get("source_page"), "text": text_of(it)}
             for it in rec["items"] if it["type"] not in NO_OBJECTIVE and not it.get("lo")]
    return {"slug": slug, "title": rec["lesson"].get("title") or slug,
            "objectives": [{"n": o.get("order_in_parent") or k, "id": o["id"], "label": o.get("label") or "",
                            "description": o.get("description") or "", "examples": by_lo.get(o["id"], [])[:4]}
                           for k, o in enumerate(objs, 1)],
            "items": items}


def fingerprint(item: dict, objectives: list[dict]) -> str:
    blob = json.dumps({"item": item, "objectives": [(o["n"], o["label"], o["description"]) for o in objectives]}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def unit_slugs(book: str, unit: int) -> list[str]:
    import ingest  # noqa: PLC0415
    b = book_config.load_book(book)
    return ingest.unit_lessons(b, ingest.route(b.book), unit)[0]


def out_path(book: str, unit: int) -> Path:
    return HERE / "teaching" / book / "filing" / f"ch{unit:02d}.json"


def build_args(book: str, unit: int, model: str) -> dict:
    b = book_config.load_book(book)
    lessons = [lesson_view(book, s) for s in unit_slugs(book, unit)]
    return {"stage": "filing", "book": {"book": book, "title": b.title},
            "lessons": [{**L, "objectives": [{k: o[k] for k in ("n", "label", "description", "examples")} for o in L["objectives"]]}
                        for L in lessons], "options": {"model": model}}


def accept(book: str, unit: int, run_file: Path) -> dict:
    """Compare the two readings; write the agreements; list the rest for the review tool."""
    res = json.loads(run_file.read_text())
    if res.get("stage") != "filing":
        raise SystemExit(f"{run_file} is not a filing return")
    runs = {L["slug"]: L for L in res["lessons"]}
    lessons = []
    for slug in unit_slugs(book, unit):
        view = lesson_view(book, slug)
        r = runs.get(slug) or {}
        a = {x["key"]: x for x in r.get("A") or []}
        b = {x["key"]: x for x in r.get("B") or []}
        valid = {o["n"] for o in view["objectives"]} | {0}
        entries = []
        for it in view["items"]:
            ra, rb = a.get(it["key"]), b.get(it["key"])
            na = ra["objective"] if ra and ra.get("objective") in valid else None
            nb = rb["objective"] if rb and rb.get("objective") in valid else None
            status = "agreed" if na is not None and na == nb else "unread" if na is None and nb is None else "disagreed"
            entries.append({**it, "A": {"objective": na, "why": (ra or {}).get("why")}, "B": {"objective": nb, "why": (rb or {}).get("why")},
                            "status": status, "filed": na if status == "agreed" else None,
                            "fingerprint": fingerprint(it, view["objectives"])})
        lessons.append({"slug": slug, "title": view["title"],
                        "objectives": [{k: o[k] for k in ("n", "id", "label", "description")} for o in view["objectives"]],
                        "entries": entries})
    doc = {"format": FORMAT, "book": book, "chapter": unit, "made": date.today().isoformat(),
           "made_by": f"book_record_filing.py accept ({res.get('prompts_version')})",
           "run": str(run_file.relative_to(HERE)) if run_file.is_relative_to(HERE) else str(run_file), "lessons": lessons}
    out = out_path(book, unit)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    return apply(book, unit, False)


def g1_filing_decisions(book: str) -> dict[str, dict]:
    p = HERE / "reviews" / book / "objectives-g1.json"
    return {d["ref"]: d for d in json.loads(p.read_text()).get("decisions", []) if d.get("kind") == "filing"} if p.exists() else {}


def apply(book: str, unit: int, dry_run: bool) -> dict:
    """Write the agreed filings and a person's decisions into the book records. Re-runnable: an item already filed as
    decided is left as it is; one the decision no longer fits (its text or its lesson's objectives changed) is reported."""
    import extract_book_record as X  # noqa: PLC0415  (check: the record still validates)
    f = out_path(book, unit)
    if not f.exists():
        raise SystemExit(f"{f} not found: run book_record_filing.py run {book} {unit}")
    doc = json.loads(f.read_text())
    dec = g1_filing_decisions(book)
    report = {"filed": 0, "filed_none": 0, "by_person": 0, "waiting": [], "stale": [], "lessons": {}}
    stamp = date.today().isoformat()
    for L in doc["lessons"]:
        rec = json.loads(record_path(book, L["slug"]).read_text())
        id_of = {o["n"]: o["id"] for o in L["objectives"]}
        now_objs = sorted(rec.get("learning_objectives") or [], key=lambda o: o.get("order_in_parent", 0))
        if [o["id"] for o in now_objs] != [o["id"] for o in L["objectives"]]:
            report["stale"].append(f"{L['slug']}: its objectives changed since the readings: run book_record_filing.py run again")
            continue
        items = {it["id"]: it for it in rec["items"]}
        n_lesson = 0
        for e in L["entries"]:
            d = dec.get(e["key"])
            if d and d.get("fingerprint") == e["fingerprint"]:
                n, by = int(d["objective"]), f"{d['by']} (review tool)"
                report["by_person"] += 1
            elif d:
                report["stale"].append(f"{e['key']}: decided on another reading of it; decide it again")
                continue
            elif e["status"] == "agreed":
                n, by = e["filed"], f"two readings ({doc['made_by']})"
            else:
                report["waiting"].append(e["key"])
                continue
            it = items.get(e["key"])
            if it is None:
                report["stale"].append(f"{e['key']}: no longer in the record")
                continue
            if n == 0:
                report["filed_none"] += 1
                continue
            if it.get("lo") != id_of[n]:
                it["lo"] = id_of[n]
                n_lesson += 1
            report["filed"] += 1
        report["lessons"][L["slug"]] = n_lesson
        if n_lesson and not dry_run:
            rec["items"] = [{"id": it["id"], "type": it["type"], **({"lo": it["lo"]} if it.get("lo") else {}),
                             **{k: v for k, v in it.items() if k not in ("id", "type", "lo")}} for it in rec["items"]]
            rec.setdefault("history", []).append(f"{stamp}: {n_lesson} statement(s), table(s) and figure(s) filed under the "
                                                 f"approved objectives (book_record_filing.py: two readings, or a person)")
            errs = X.check(rec)
            if errs:
                raise SystemExit(f"{L['slug']}: the record would not validate: {errs[:3]}")
            record_path(book, L["slug"]).write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n")
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("run", "args", "accept", "apply"):
        s = sub.add_parser(name)
        s.add_argument("book")
        s.add_argument("unit", type=int)
        if name == "accept":
            s.add_argument("run_file", type=Path)
        if name in ("run", "args"):
            s.add_argument("--cap", type=float, default=2.0)
            s.add_argument("--model", default="sonnet")
        if name == "apply":
            s.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "apply":
        rep = apply(a.book, a.unit, a.dry_run)
    elif a.cmd == "accept":
        rep = accept(a.book, a.unit, a.run_file.resolve())
    else:
        import embed_workflow as EW  # noqa: PLC0415
        import workflow_runner as WR  # noqa: PLC0415
        args = build_args(a.book, a.unit, a.model)
        n = sum(len(L["items"]) for L in args["lessons"])
        if not n:
            print("nothing to file: every statement, table and figure has an objective", file=sys.stderr)
            return 0
        copy = EW.default_out(a.book, "filing", f"ch{a.unit:02d}")
        print(EW.summary(EW.write(HERE / "runbook" / "filing.workflow.js", args, copy)), file=sys.stderr)
        if a.cmd == "args":
            return 0
        run_file, _res, _cost = WR.run_copy(copy, [], a.cap, f"filing-ch{a.unit:02d}", a.book, "filing", stage="S1F")
        rep = accept(a.book, a.unit, run_file)
    print(json.dumps(rep, indent=1, ensure_ascii=False))
    print(f"{rep['filed']} filed, {rep['filed_none']} under no objective, {len(rep['waiting'])} waiting for you "
          f"(the review tool's Objectives task, kind Filing), {len(rep['stale'])} stale", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

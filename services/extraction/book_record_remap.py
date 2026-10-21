"""After G1: move a unit's generated content onto the objectives a person approved, through what each piece came from.

    uv run book_record_remap.py prep3-math-en 1 --dry-run     # what would move, and what cannot be placed
    uv run book_record_remap.py prep3-math-en 1               # write it

Decided by Tamer, 2026-10-17. Generated content names its objective (`lo_id`). When it was made before G1, that is a
provisional objective, and objectives are numbered by position, so after G1 the same number can name another skill,
or none. Nothing is guessed from numbers; each piece follows its own source:
  - a generated or widget question follows the BOOK QUESTION it was made from (`parent_question_id`): that item's
    objective in the book record now, after G1 (book_record_objectives.py apply). Its parent id becomes the id compile
    now mints for that book question;
  - a misconception follows the BOOK ITEMS S5 drew it from (`sources` in the S5 final run): the objective most of them
    are filed under now (after book_record_filing.py). A tie, or sources filed nowhere, is listed for a person and the
    misconception keeps an objective only if it still exists;
  - a widget gap (an objective still needing a widget kind) names no source: listed, not moved.
Ids never change: an id is how the database and any student attempt know a question, and its prefix only has to stay
in its lesson (schemas.SeedBundle), which a re-map never changes. A question whose objective moved says so in its
source note. Run after book_record_filing.py, then compile. Report: teaching/<book>/generated/remap-ch<NN>.json.
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_config  # noqa: E402

GEN = ("generated-questions.json", "widget-questions.json")
MOVED = "Its objective was re-mapped after G1 through the book question it was made from (book_record_remap.py)."


def local_of(ref: str) -> str:
    """compile_book_records.book_questions' own: the part of a question id after `bk-`."""
    return re.sub(r"[^a-z0-9]+", "-", ref.split(":", 1)[1].lower()).strip("-")


def lo_of(slug: str, objective_id: str) -> str:
    return f"lo:{slug}-{int(objective_id.rsplit('-', 1)[1])}"


def book_index(book: str, slugs: list[str]) -> dict:
    """For each lesson: question local → (book ref, item id), and item id → its objective now."""
    idx = {}
    for s in slugs:
        rec = json.loads((HERE / "book-records" / book / f"{s}.json").read_text())
        locals_, lo = {}, {}
        for it in rec["items"]:
            if it.get("lo"):
                lo[it["id"]] = lo_of(s, it["lo"])
            for ref in [f"{it['id']}:{p['label']}" for p in it.get("parts") or []] + [it["id"]]:
                locals_.setdefault(local_of(ref), (ref, it["id"]))
        idx[s] = {"locals": locals_, "lo": lo, "current": {lo_of(s, o["id"]) for o in rec.get("learning_objectives") or []}}
    return idx


def lesson_of(lo_or_id: str | None, slugs: list[str]) -> str | None:
    body = re.sub(r"^(lo|q|mc|tpl|wt|expl):", "", lo_or_id or "")
    return next((s for s in sorted(slugs, key=len, reverse=True) if body.startswith(s + "-")), None)


def remap_questions(rows: list[dict], idx: dict, slugs: list[str], report: dict) -> int:
    n = 0
    for q in rows:
        s = lesson_of(q.get("lo_id", ""), slugs)
        if s is None:
            continue
        parent = q.get("parent_question_id") or ""
        # a teaching parent (a worked example, migration 038: a book widget of an objective with no book question)
        # follows its book item the same way; its id keeps its own prefix
        m = re.match(r"^(q|expl):[^:]+:bk-(.+)$", parent)
        hit = idx[s]["locals"].get(m.group(2)) if m else None
        new = idx[s]["lo"].get(hit[1]) if hit else None
        if new is None:
            report["questions_unplaced"].append({"id": q["id"], "lo_id": q["lo_id"], "parent": parent,
                                                 "why": "its book question is filed under no objective" if hit else "its parent is not a book question of the lesson"})
            continue
        new_parent = f"{m.group(1)}:{new.removeprefix('lo:')}:bk-{m.group(2)}"
        if q["lo_id"] != new or parent != new_parent:
            report["questions_moved"].append({"id": q["id"], "from": q["lo_id"], "to": new, "book_question": hit[0]})
            q["lo_id"], q["parent_question_id"] = new, new_parent
            if MOVED not in (q.get("source_note") or ""):
                q["source_note"] = f"{q.get('source_note') or ''} {MOVED}".strip()
            n += 1
    return n


def source_item(ref: str, lesson: dict) -> str | None:
    """The book item an S5 source names, in any of the forms S5 writes: "u1-1:rule-5", "remark u1-1:rule-5 p.8",
    "u1-1:drill-1:B", or a compiled question or library entry ("q:u1-1-2:bk-think-2", "expl:u1-1-2:bk-example-2")."""
    m = re.match(r"^(?:q|expl):[^:]+:bk-(.+)$", ref.strip())
    if m:
        hit = lesson["locals"].get(m.group(1))
        return hit[1] if hit else None
    m = re.search(r"\b(u\d+-\d+:[a-z][a-z0-9-]*)", ref)
    return m.group(1) if m else None


def misconception_targets(book: str, idx: dict, slugs: list[str], report: dict) -> dict[str, str]:
    """Each misconception's objective now, by the book items S5 drew it from (its latest final run)."""
    runs = sorted((HERE / "runs" / book / "misconceptions").glob("s5-final.*Z.json"))
    if not runs:
        return {}
    out = {}
    for r in json.loads(runs[-1].read_text()).get("records") or []:
        for e in r.get("entries") or []:
            s = lesson_of(e["lo_id"], slugs)
            if s is None:
                continue
            votes = collections.Counter()
            for src in e.get("sources") or []:
                item = source_item(str(src.get("ref") or ""), idx[s])
                if item in idx[s]["lo"]:
                    votes[idx[s]["lo"][item]] += 1
            top = votes.most_common(2)
            if top and (len(top) == 1 or top[0][1] > top[1][1]):
                out[e["id"]] = top[0][0]
            else:
                report["misconceptions_unplaced"].append({"id": e["id"], "lo_id": e["lo_id"], "votes": dict(votes),
                                                          "why": ("its sources are split evenly" if top else "none of its sources is filed under an objective")
                                                                 + ("; it keeps its objective, which still exists" if e["lo_id"] in idx[s]["current"] else "")})
    return out


def run(book: str, unit: int, dry_run: bool) -> dict:
    import ingest  # noqa: PLC0415
    b = book_config.load_book(book)
    slugs = ingest.unit_lessons(b, ingest.route(b.book), unit)[0]
    idx = book_index(book, slugs)
    gdir = HERE / "teaching" / book / "generated"
    report = {"format": "ainext.remap/1", "book": book, "unit": unit, "made": date.today().isoformat(),
              "questions_moved": [], "questions_unplaced": [], "misconceptions_moved": [], "misconceptions_unplaced": [],
              "widget_gaps_stale": []}
    files = {n: json.loads((gdir / n).read_text()) for n in (*GEN, "misconceptions.json", "widget-gaps.json") if (gdir / n).exists()}
    if not files:   # a book whose content has not been generated yet: nothing to move
        report["note"] = "nothing generated yet"
        return report
    for n in GEN:
        if n in files:
            remap_questions(files[n].get("questions") or [], idx, slugs, report)
    target = misconception_targets(book, idx, slugs, report)
    for n in ("misconceptions.json", *GEN):
        for m in (files.get(n) or {}).get("misconceptions") or []:
            new = target.get(m["id"])
            if new and new != m["lo_id"]:
                if n == "misconceptions.json":
                    report["misconceptions_moved"].append({"id": m["id"], "from": m["lo_id"], "to": new})
                m["lo_id"] = new
    current = set().union(*(idx[s]["current"] for s in slugs))
    for m in (files.get("misconceptions.json") or {}).get("misconceptions") or []:
        if lesson_of(m["lo_id"], slugs) and m["lo_id"] not in current and not any(u["id"] == m["id"] for u in report["misconceptions_unplaced"]):
            report["misconceptions_unplaced"].append({"id": m["id"], "lo_id": m["lo_id"], "why": "no S5 sources found and its objective no longer exists"})
    for g in (files.get("widget-gaps.json") or {}).get("gaps") or []:
        if lesson_of(g.get("lo_id", ""), slugs) and g["lo_id"] not in current:
            report["widget_gaps_stale"].append({"lo_id": g["lo_id"], "need_kind": g.get("need_kind")})
    if not dry_run:
        for n in (*GEN, "misconceptions.json"):
            if n in files:
                (gdir / n).write_text(json.dumps(files[n], ensure_ascii=False, indent=1) + "\n")
        (gdir / f"remap-ch{unit:02d}.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n")
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("book")
    ap.add_argument("unit", type=int)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    r = run(a.book, a.unit, a.dry_run)
    print(f"questions moved {len(r['questions_moved'])}, not placed {len(r['questions_unplaced'])}; misconceptions moved "
          f"{len(r['misconceptions_moved'])}, not placed {len(r['misconceptions_unplaced'])}; widget gaps naming an old objective "
          f"{len(r['widget_gaps_stale'])}" + (" (dry run: nothing written)" if a.dry_run else ""), file=sys.stderr)
    for k in ("questions_unplaced", "misconceptions_unplaced"):
        for x in r[k]:
            print(f"  ? {x['id']} ({x['lo_id']}): {x['why']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

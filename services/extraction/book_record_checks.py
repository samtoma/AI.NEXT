"""SW for book records: Samuel's step-level working checker on every worked solution a compiled lesson teaches from.

    uv run book_record_checks.py sw prep3-math-en 1 u1-1 u1-2 u1-3 u1-4 [--cap 4] [--args-only]

Run from services/extraction/, after compile_book_records.py. Decided by Tamer, 2026-10-16: the tutor teaches from
worked solutions, so a wrong step in the book's own working must be caught, not taught.

The checker (working_check.py, runbook/working-check.workflow.js; Samuel's answer 30) reads an assembled chapter
bundle: each question's worked solution and each worked example kept in the library. The compiled bundle, cut to the
named lessons (book_record_generation.book_view), is that bundle. Its free numeric pre-check and one checking agent
per batch of 5 solutions judge every step against the question and the steps before it; a flag is never a
correction. Its own `collect` writes runs/<book>/working-check/ch<NN>.flags.json.

A flag on the BOOK'S working (a book question's solution, or a worked example in the library — not a generated
answer's) is a misprint candidate: exported to book-records/<book>/misprint-candidates.json (format
`ainext.misprint-candidates/1`, what the review tool's Misprints task reads), where a person decides it. A flag on a
generated answer's steps goes to the Generated answers task's attention list by being listed in the report.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_record_generation as BG  # noqa: E402  (book_view)
import workflow_runner as WR  # noqa: E402


def run(*argv: str) -> None:
    p = subprocess.run(["uv", "run", "working_check.py", *argv], cwd=HERE, text=True, capture_output=True)
    sys.stderr.write(p.stdout[-2500:] + p.stderr[-2500:])
    if p.returncode != 0:
        raise SystemExit(f"working_check.py {argv[0]} failed ({p.returncode})")


def book_item(solution_id: str, bundle: dict) -> tuple[str | None, bool]:
    """(book-record item id, is it the book's own working?) for a solution id of the compiled bundle."""
    tail = solution_id.split(":", 2)[-1].removeprefix("bk-")
    q = next((x for x in bundle.get("questions") or [] if x["id"] == solution_id), None)
    if q is not None:
        m = re.search(r"\((u[^,)]+?:[^,)]+?), printed", q.get("source_note") or "")
        ref = m.group(1) if m else None
        return (ref.split(":", 1)[0] + ":" + ref.split(":")[1] if ref else None), "printed in the book" in (q.get("source_note") or "")
    e = next((x for x in bundle.get("explanation_entries") or [] if x["id"] == solution_id), None)
    if e is not None:
        m = re.search(r"book_worked: ([^,)]+)", e.get("generated_by") or "")
        return (m.group(1) if m else None), bool(m)
    return None, False


def export_candidates(book: str, chapter: int, flags_file: Path, bundle: dict) -> int:
    flags = json.loads(flags_file.read_text())
    out = HERE / "book-records" / book / "misprint-candidates.json"
    data = json.loads(out.read_text()) if out.exists() else {"format": "ainext.misprint-candidates/1", "book": book, "candidates": []}
    data["candidates"] = [c for c in data["candidates"] if not str(c.get("ref", "")).startswith(f"sw:ch{chapter:02d}:")]
    n = 0
    for f in flags.get("flags") or []:
        item, book_own = book_item(f["solution_id"], bundle)
        if not item or not book_own:
            continue
        lesson = item.split(":", 1)[0]
        rec = json.loads((HERE / "book-records" / book / f"{lesson}.json").read_text())
        it = next((x for x in rec["items"] if x["id"] == item), {})
        n += 1
        data["candidates"].append({
            "ref": f"sw:ch{chapter:02d}:{f['solution_id']}#{f['step']}", "book": book, "chapter": chapter, "lesson": lesson,
            "item_ref": item, "where": item.split(":", 1)[1], "printed_page": it.get("source_page"), "pdf_page": None,
            "field": f"solution[{int(f['step']) - 1}]", "stem": it.get("stem") or it.get("text") or "",
            "printed": f.get("quote"), "intended": f.get("expected") or "", "why": f.get("why"),
            "class": "book error", "confidence": "high" if len(f.get("passes") or []) > 1 else "medium",
            "source": f"working check ({flags.get('prompts_version')}): {f.get('kind')}"})
    data.update(made=date.today().isoformat(), made_by="book_record_checks.py sw")
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    return n


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sw")
    s.add_argument("book")
    s.add_argument("chapter", type=int)
    s.add_argument("lessons", nargs="+")
    s.add_argument("--cap", type=float, default=4.0)
    s.add_argument("--args-only", action="store_true")
    a = ap.parse_args(argv)
    view = BG.book_view(a.book, a.lessons)
    bundle_file = view.parent / "bundle-1.json"
    ch = f"ch{a.chapter:02d}"
    runs = HERE / "runs" / a.book / "working-check"
    runs.mkdir(parents=True, exist_ok=True)
    shards = HERE / "work" / a.book / "packets" / f"sw-{ch}"
    copy = HERE / "work" / a.book / "packets" / "embedded" / f"working-check.{ch}.bookrecord.workflow.js"
    run("args", "--book", str(view), "--seed", str(bundle_file), "--chapter", str(a.chapter), "--by-ref", str(shards),
        "--out", str(runs / f"{ch}.args.json"), "--lesson-runs", str(runs), "--embed", str(copy))
    if a.args_only:
        return 0
    result, _res, _cost = WR.run_copy(copy, [shards], a.cap, f"sw-{ch}", a.book, "working-check", stage="SW")
    run("collect", "--args", str(runs / f"{ch}.args.json"), "--runs", str(result), "--out", str(runs / f"{ch}.flags.json"))
    n = export_candidates(a.book, a.chapter, runs / f"{ch}.flags.json", json.loads(bundle_file.read_text()))
    print(f"{n} flag(s) on the book's own working → book-records/{a.book}/misprint-candidates.json (the Misprints task)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

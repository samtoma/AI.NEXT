"""Export the pipeline's findings about mistakes the BOOK prints, for the review tool's Misprints task.

    uv run python groundtruth/export_misprint_candidates.py g10-math            # every chapter with a G2 recommendation
    uv run python groundtruth/export_misprint_candidates.py g10-math --chapter 1 --chapter 2

Run from services/extraction/. Reads runs/<book>/g2-chNN.recommended.json and the lesson runs they were made from
(the same lookup as `auto_pass_gates.py g2-recommend-errata`), and writes
book-records/<book>/misprint-candidates.json (format `ainext.misprint-candidates/1`).

Only findings about the book itself are candidates: class `book error`, `printed answer misaligned` (and its
PDF/EPUB variant) and `printed text damaged`. Text the pipeline lost or garbled (`stem damaged`), its own typing
mistakes and its checks' limits are not the book's mistakes and are left out.

A candidate is a lead, not a ruling: a person decides it in the review tool (Misprints), and the decision is kept in
groundtruth/<book>/misprint-decisions.json. Re-running this export never touches decisions.
"""
import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent  # services/extraction
sys.path.insert(0, str(HERE))

import book_config  # noqa: E402
import g2_recommend as G  # noqa: E402

FORMAT = "ainext.misprint-candidates/1"
BOOK_CLASSES = {"book error", "printed answer misaligned", "printed answer misaligned (PDF/EPUB parts)", "printed text damaged"}


def pdf_offset(book) -> int | None:
    for regime in book.page_offsets or []:
        off = regime.get("pdf_minus_printed") if isinstance(regime, dict) else getattr(regime, "pdf_minus_printed", None)
        if off is not None:
            return int(off)
    return None


def where(item: dict) -> str:
    ref = str(item.get("ref") or "")
    m = re.match(r"^Ex(\d+-\d+):(\d+)(.*)$", ref)
    if m:
        return f"Exercise {m.group(1)}, question {m.group(2)}{m.group(3)}"
    w = re.match(r"^WE(\d+)$", ref)
    return f"Worked example {w.group(1)}" if w else ref


def chapter_items(book, ch: int) -> dict[str, dict]:
    g2f = HERE / "runs" / book.book / f"g2-ch{ch:02d}.json"
    runs = [G.load_run(p) for p in G.record_runs(book, ch)]
    ents = G.recommendable(runs, ch, book.id_prefixes[0], json.loads(g2f.read_text()) if g2f.exists() else None)
    by = {e["key"]: e["item"] for e in ents}
    for run in runs:
        for lesson in run.get("lessons") or []:
            for it in lesson.get("items") or []:
                by.setdefault(f"{lesson['lesson']}:{it['ref']}", it)
    return by


def candidates(book, ch: int, offset: int | None) -> list[dict]:
    rec = json.loads((HERE / "runs" / book.book / f"g2-ch{ch:02d}.recommended.json").read_text())
    items = chapter_items(book, ch)
    out = []
    for key, v in (rec.get("items") or {}).items():
        if v.get("class") not in BOOK_CLASSES:
            continue
        it = items.get(key) or {}
        ic = v.get("if_corrected") or {}
        lesson, _, item_ref = key.partition(":")
        if v["class"] == "printed text damaged":
            field, printed, intended = "stem", it.get("stem") or "", (v.get("fields") or {}).get("stem") or ""
        else:
            field = "answer"
            printed = it.get("epub_final_answer") or it.get("printed_answer") or ""
            intended = ic.get("answer") or ""
        page = it.get("printed_page")
        out.append({
            "ref": f"{key}#{field}",
            "book": book.book,
            "chapter": ch,
            "lesson": lesson,
            "item_ref": item_ref,
            "where": where(it or {"ref": item_ref}),
            "printed_page": page,
            "pdf_page": page + offset if isinstance(page, int) and offset is not None else None,
            "field": field,
            "stem": it.get("stem") or "",
            "printed": printed,
            "intended": intended,
            "why": ic.get("defect") or v.get("note") or "",
            "class": v["class"],
            "confidence": v.get("confidence"),
            "in_bank": {"exclude": "left out of the question bank", "hold": "held, waiting for a person",
                        "fix": "live, with a pipeline fix", "accept": "live as printed"}.get(v.get("verdict"), v.get("verdict")),
        })
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("book")
    ap.add_argument("--chapter", type=int, action="append", help="a chapter (repeat); default: every chapter with a recommendation file")
    a = ap.parse_args(argv)
    book = book_config.load_book(a.book)
    runs_dir = HERE / "runs" / book.book
    chapters = a.chapter or sorted(int(m.group(1)) for p in runs_dir.glob("g2-ch*.recommended.json")
                                   if (m := re.match(r"g2-ch(\d+)\.recommended\.json$", p.name)))
    offset = pdf_offset(book)
    found = []
    for ch in chapters:
        try:
            found += candidates(book, ch, offset)
        except (FileNotFoundError, G.RecommendError) as e:  # Chapter 8: Samuel decided its G2 himself, no record
            print(f"chapter {ch}: skipped ({e})", file=sys.stderr)
    out = HERE / "book-records" / book.book / "misprint-candidates.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"format": FORMAT, "book": book.book, "made": date.today().isoformat(),
                               "made_by": "groundtruth/export_misprint_candidates.py", "chapters": chapters,
                               "pdf": book.sources.get("pdf") if isinstance(book.sources, dict) else getattr(book.sources, "pdf", None),
                               "candidates": found}, ensure_ascii=False, indent=2) + "\n")
    by = {}
    for c in found:
        by[c["class"]] = by.get(c["class"], 0) + 1
    print(f"{len(found)} candidates -> {out.relative_to(HERE)}  {by}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

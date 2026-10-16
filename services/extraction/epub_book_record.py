"""S0a, EPUB route: Samuel's source-adapter blocks → book records (the writer book-records/README.md listed as still to
build).

    uv run epub_book_record.py write g10-math 1 [--lessons g10m1s3-1,…] [--out-dir DIR] [--force]
    uv run epub_book_record.py write <book> <chapter> --blocks B --manifest M --maths A --out-dir DIR   # explicit inputs

Run from services/extraction/, after `source_adapter.py` (work/<book>/blocks.jsonl, figures/), G0 (the manifest) and
S0b (runs/<book>/maths/accepted.json: the LaTeX of every equation image). Deterministic, no model.

For each lesson of the chapter, Samuel's own membership (assemble_objectives.assign_chapter: which blocks belong to
which lesson after G0) gives its blocks, in reading order. Each becomes one book-record item, built in the same shape
the page reader returns, so extract_book_record.py's own code assigns the ids (groundtruth/README.md "Ids"), links
and validates the record:
    heading → heading · para, list, summary item, unparsed → linking_text · definition → definition
    box → caution (important, note, warning, tip) or rule · table → table · figure → figure (its EPUB image copied
    to work/<book>/figures/<record id>.png, where S4 and the book pictures read crops) · worked example → worked_example
    (its question as the stem, each step "title: text" as the solution) · exercise items → one exercise per printed
    question, its sub-questions as parts, each with its printed answer and the EPUB's worked solution, and the
    practice code as `code` · teacher-only → never carried over (FR-4408) · exercise headers → the stems' instruction.
Maths: every ⟦m:md5⟧ becomes $LaTeX$ from S0b. A lesson with an image S0b has not accepted is NOT written (FR-4407:
nothing is guessed). The chapter's end-of-chapter items are listed, not written: S1's mappers place them.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import assemble_objectives as AO  # noqa: E402
import book_config  # noqa: E402
import crop_figures as CF  # noqa: E402
import extract_book_record as X  # noqa: E402

VERSION = "epub-v1"
CAUTION_BOXES = ("important", "note", "warning", "tip", "caution")


def quote_of(text: str, n: int = 8) -> str:
    """The record's first n words, verbatim; never cut inside a $…$ formula."""
    words, out = (text or "").split(), []
    for w in words:
        out.append(w)
        if len(out) >= n and " ".join(out).count("$") % 2 == 0:
            break
    return " ".join(out)


def lesson_records(blocks: list[dict], maths: dict, headers: dict, missing: set, work: Path) -> tuple[list[dict], list[tuple]]:
    """Page-reader-shaped records for one lesson's blocks, and the figure copies to make (src file, record key)."""
    R = lambda x: AO.render(x, maths, missing)
    recs, figs, by_q = [], [], {}
    for b in blocks:
        t, page, key = b["type"], b.get("printed_page"), b["id"]
        base = {"_key": key, "source_page": page, "label": "", "number": None}
        if t == "teacher_only" or t == "exercise_header":
            continue
        if t == "heading":
            text = R(b.get("title") or b.get("text"))
            recs.append({**base, "type": "heading", "text": text, "quote": quote_of(text)})
        elif t in ("para", "list", "summary_item", "unparsed"):
            text = R(b.get("text"))
            if text:
                recs.append({**base, "type": "linking_text", "text": text, "quote": quote_of(text),
                             **({"notes": "unparsed EPUB block"} if t == "unparsed" else {})})
        elif t == "definition":
            text = R(b.get("text"))
            recs.append({**base, "type": "definition", "claim": text, "quote": quote_of(text)})
        elif t == "box":
            text = R(b.get("text"))
            kind = "caution" if str(b.get("kind") or "").lower() in CAUTION_BOXES else "rule"
            recs.append({**base, "type": kind, "claim": text, "quote": quote_of(text)})
        elif t == "table":
            text = R(b.get("text"))
            rows = [[R(c) for c in row] for row in b.get("rows") or []] or [[text]]
            recs.append({**base, "type": "table", "caption": R(b.get("caption")) or text[:200], "rows": rows,
                         "header": [R(c) for c in b.get("header") or []], "quote": quote_of(text)})
        elif t == "figure":
            cap = R(b.get("caption") or b.get("text"))
            recs.append({**base, "type": "figure", "caption": cap or "Figure", "quote": quote_of(cap) or "Figure"})
            for f in b.get("figures") or []:
                figs.append((work / "figures" / str(f.get("src", "")).replace("/", "__"), key))
                break
        elif t == "worked_example":
            q = R((b.get("question") or {}).get("text"))
            steps = [f"{R(s.get('title'))}: {R(s)}".strip(": ") for s in b.get("steps") or []]
            if b.get("loose_solution"):
                steps.append(R(b["loose_solution"]))
            recs.append({**base, "type": "worked_example", "label": "Worked example", "number": b.get("n"),
                         "stem": q, "solution": [s for s in steps if s], "quote": quote_of(q)})
        elif t == "exercise_item":
            gk = (b.get("exercise"), b.get("q"))
            problem = R(b.get("problem"))
            sol = AO.solution_steps(b.get("solution"), maths, missing) if b.get("solution") else []
            printed = R((b.get("printed_answer") or {}).get("text"))
            instr = " ".join(x for x in (headers.get((b.get("exercise"), None)), headers.get(gk)) if x)
            if gk not in by_q:
                rec = {**base, "type": "exercise", "label": f"Exercise {b.get('exercise')}", "number": b.get("q"),
                       "text": instr or problem, "quote": quote_of(instr or problem), "parts": [],
                       **({"code": b["shortcode"]} if b.get("shortcode") else {})}
                by_q[gk] = rec
                recs.append(rec)
            rec = by_q[gk]
            if b.get("sub"):
                rec["parts"].append({"label": str(b["sub"]), "stem": problem, **({"answer": printed} if printed else {}),
                                     **({"solution": sol} if sol else {}), **({"code": b["shortcode"]} if b.get("shortcode") else {})})
            else:
                if instr:
                    rec["text"] = f"{instr} {problem}".strip()
                if printed:
                    rec["answer"] = printed
                if sol:
                    rec["solution"] = sol
    return recs, figs


def write_chapter(book_name: str, chapter: int, blocks_path: Path, manifest_path: Path, maths_path: Path | None,
                  out_dir: Path, only: list[str] | None, force: bool, figures_dir: Path | None = None) -> dict:
    book = book_config.load_book(book_name)
    cfg = json.loads(book.path.read_text())
    blocks = AO.load_blocks(blocks_path)
    maths = AO.load_maths(maths_path) if maths_path else {}
    module = AO.chapter_module(json.loads(manifest_path.read_text()), chapter)
    lessons = AO.module_lessons(module, book)
    a = AO.assign_chapter(blocks, module, lessons)
    headers = AO._headers(a["headers"], maths, set())
    work = blocks_path.parent
    stamp = date.today().isoformat()
    prov = {"by": f"epub_book_record.py {VERSION}, {stamp}", "method": "EPUB blocks (source_adapter.py) + S0b maths"}
    report = {"chapter": chapter, "lessons": {}, "not_written": {}, "end_of_chapter_items": [AO.item_ref(b) for b in a["pool"]],
              "teacher_only_dropped": len(a["teacher_only"])}
    out_dir.mkdir(parents=True, exist_ok=True)
    for l in lessons:
        slug = l["id"]
        if only and slug not in only:
            continue
        out = out_dir / f"{slug}.json"
        if out.exists() and not force:
            report["not_written"][slug] = "already written (--force to replace)"
            continue
        missing: set[str] = set()
        recs, figs = lesson_records(a["lessons"][slug], maths, headers, missing, work)
        if missing:
            report["not_written"][slug] = f"{len(missing)} maths image(s) S0b has not accepted (G0b owes them)"
            continue
        X.assign_ids(slug, recs)
        by_key = {r["_key"]: r["id"] for r in recs}
        types = {r["id"]: r["type"] for r in recs}
        items = [X.finish_item(r, by_key, types, prov) for r in recs]
        for it, r in zip(items, recs):   # the practice code, and an online-only worked solution's provenance
            for x, src in [(it, r), *zip(it.get("parts") or [], r.get("parts") or [])]:
                if src.get("code"):
                    x["code"] = src["code"]
                if x.get("solution") and not x.get("solution_provenance"):
                    x["solution_provenance"] = "book_worked" if it["type"] == "worked_example" else "book_online"
        for src, key in figs:   # the EPUB's own image, where S4 and the book pictures read a figure's crop
            if src.exists():
                dst = (figures_dir or CF.figures_dir(book_name)) / CF.crop_name(by_key[key])
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dst)
        pp = l.get("printed_pages") or []
        pages = [p for p in (pp if isinstance(pp, list) else [pp]) if p] or sorted({b["printed_page"] for b in a["lessons"][slug] if b.get("printed_page")})
        doc = {"schema": "book-record", "schema_version": 2, "role": "extraction",
               "source_document": {k: v for k, v in {"title": cfg["title"], "language": cfg.get("language"), "grade": cfg.get("grade"),
                                                     "subject": cfg.get("subject"), "course_id": cfg.get("course_id"),
                                                     "file_path": (cfg.get("sources") or {}).get("epub")}.items() if v}
                                  | {"page_offset": int(cfg.get("page_offset") or 0)},   # EPUB blocks carry printed pages
               "lesson": {"slug": slug, "syllabus_ref": " ".join(str(x.get("number")) for x in l.get("sections") or []) or slug, "title": l.get("title") or slug,
                          "module": module.get("title") or module["id"], "pages": [pages[0], pages[-1]] if pages else [0, 0],
                          "provenance": prov},
               "items": items, "learning_objectives": [], "provenance": prov,
               "review": {"status": "draft", "reviewed_by": None, "reviewed_at": None}, "open_questions": [],
               "history": [f"{stamp}: written from the EPUB blocks ({VERSION}); objectives come from S1"]}
        errs = X.check(doc)
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
        report["lessons"][slug] = {"items": len(items), "problems": errs[:10]}
    return report


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("write")
    w.add_argument("book")
    w.add_argument("chapter", type=int)
    w.add_argument("--lessons", help="comma-separated lesson slugs (default: every lesson of the chapter)")
    w.add_argument("--blocks", type=Path)
    w.add_argument("--manifest", type=Path)
    w.add_argument("--maths", type=Path)
    w.add_argument("--out-dir", type=Path)
    w.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    book = book_config.load_book(a.book)
    blocks = a.blocks or HERE / "work" / book.book / "blocks.jsonl"
    manifest = a.manifest or book_config.REPO_ROOT / (book.manifest or f"services/extraction/manifest/{book.book}.json")
    maths = a.maths or HERE / "runs" / book.book / "maths" / "accepted.json"
    if not blocks.exists():
        raise SystemExit(f"{blocks} not found: run source_adapter.py {book.book} first (it needs the book's EPUB in docs/Source/)")
    rep = write_chapter(book.book, a.chapter, blocks, manifest, maths if maths.exists() else None,
                        a.out_dir or HERE / "book-records" / book.book, a.lessons.split(",") if a.lessons else None, a.force)
    print(json.dumps(rep, ensure_ascii=False, indent=1))
    return 0 if not rep["not_written"] or all("already" in v for v in rep["not_written"].values()) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

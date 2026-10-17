"""S2 provenance for book records: does each of the book's statements say what the page prints, with nothing added?

    uv run --with pymupdf book_record_provenance.py run    prep3-math-en u1-1 u1-2 … [--cap 2] [--force]
    uv run --with pymupdf book_record_provenance.py args   prep3-math-en u1-1 …       # the embedded copy, for Claude Code
    uv run book_record_provenance.py accept prep3-math-en runs/<book>/provenance/<saved return>.json

Decided by Tamer, 2026-10-17: adopt Samuel's S2 provenance check (runbook/lesson.workflow.js, phase 'S2 Provenance'),
so Label extraction can focus on what it flags. The statements are what the tutor quotes (compile's statements:
definitions, rules, methods, conventions, cautions, key terms, prior knowledge); the page reader wrote them in its own
words, faithful but paraphrased, and a paraphrase can drift. His rule, per statement:
  containment  the anchored text contains its quote: kept with no model. An EPUB book's statements are the book's own
               text (epub_book_record.py copies it), so every one is kept this way;
  checked      otherwise Haiku judges it against the anchored text: supported, with nothing added;
  re-audited   what Haiku cannot confirm, Sonnet re-audits with Haiku's note: SUPPORTED;
  unsupported  neither confirms it: kept, and flagged.
A page-image book has no text to anchor to, so the anchored text is the printed page, read from its image
(runbook/provenance.workflow.js, his prompts otherwise word for word). The verdicts go to
book-records/<book>/provenance/<lesson>.json (format `ainext.provenance/1`), each with the statement's fingerprint so a
statement edited since is checked again. The review tool's Label extraction task marks every unsupported statement and
can show only those; the coverage audit counts a statement the check flagged until a person labels it.
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

FORMAT = "ainext.provenance/1"
STATEMENTS = ("definition", "rule", "caution", "convention", "method", "key_term", "prior_knowledge")


def out_path(book: str, slug: str) -> Path:
    return HERE / "book-records" / book / "provenance" / f"{slug}.json"


def claim_of(it: dict) -> str:
    return " ".join(str(it.get("claim") or it.get("term") or it.get("text") or "").split())


def fingerprint(it: dict) -> str:
    return hashlib.sha256(f"{it['id']}\n{claim_of(it)}\n{it.get('quote') or ''}".encode()).hexdigest()[:16]


def statements(book: str, slug: str) -> tuple[dict, list[dict]]:
    rec = json.loads((HERE / "book-records" / book / f"{slug}.json").read_text())
    return rec, [it for it in rec["items"] if it["type"] in STATEMENTS and claim_of(it)]


def verbatim(rec: dict) -> bool:
    """An EPUB book's statements are the book's own words (epub_book_record.py): containment holds by construction."""
    return "EPUB" in str((rec.get("provenance") or {}).get("method") or "")


def checked_already(book: str, slug: str) -> dict[str, dict]:
    f = out_path(book, slug)
    return {e["id"]: e for e in json.loads(f.read_text())["entries"]} if f.exists() else {}


def build_args(book: str, slugs: list[str], force: bool) -> tuple[dict, dict[str, list[dict]]]:
    """The workflow's pages, and the statements kept by containment (no model)."""
    import extract_book_record as X  # noqa: PLC0415  (render, page_dir: the page reader's own images)
    b = book_config.load_book(book)
    lmap = json.loads((HERE / "book-records" / book / "lessons.json").read_text())
    pdf = book_config.REPO_ROOT / b.sources.pdf if b.sources.pdf else None
    pages, contained = [], {}
    i = 0
    for slug in slugs:
        rec, sts = statements(book, slug)
        done = {} if force else checked_already(book, slug)
        todo = [s for s in sts if not (done.get(s["id"]) and done[s["id"]]["fingerprint"] == fingerprint(s))]
        if verbatim(rec):
            contained[slug] = todo
            continue
        lesson = next(l for l in lmap["lessons"] if l["slug"] == slug)
        img_dir = X.page_dir(book, lesson)
        img_dir.mkdir(parents=True, exist_ok=True)
        for printed in sorted({s.get("source_page") for s in todo if isinstance(s.get("source_page"), int)}):
            img = X.render(pdf, printed, lesson.get("page_offset", lmap["page_offset"]), img_dir)
            here = []
            for s in todo:
                if s.get("source_page") == printed:
                    i += 1
                    here.append({"i": i, "id": s["id"], "type": s["type"].replace("_", " "), "claim": claim_of(s), "quote": s.get("quote") or ""})
            pages.append({"lesson": slug, "printed": printed, "image": str(img.resolve()), "statements": here})
    return {"stage": "S2-provenance", "book": {"book": book, "title": b.title}, "pages": pages,
            "options": {"model": "haiku", "audit_model": "sonnet"}}, contained


def record(book: str, slug: str, results: list[dict], run: str | None) -> dict:
    """Merge verdicts into book-records/<book>/provenance/<slug>.json (a statement's latest verdict wins)."""
    rec, sts = statements(book, slug)
    by_id = {s["id"]: s for s in sts}
    f = out_path(book, slug)
    doc = json.loads(f.read_text()) if f.exists() else {"format": FORMAT, "book": book, "lesson": slug, "entries": [], "runs": []}
    entries = {e["id"]: e for e in doc["entries"] if e["id"] in by_id}
    for r in results:
        s = by_id.get(r["id"])
        if s:
            entries[r["id"]] = {"id": s["id"], "type": s["type"], "page": s.get("source_page"), "claim": claim_of(s),
                                "quote": s.get("quote"), "provenance": r["provenance"],
                                **{k: r[k] for k in ("note", "first_note") if r.get(k)}, "fingerprint": fingerprint(s)}
    doc["entries"] = [entries[s["id"]] for s in sts if s["id"] in entries]
    doc["made"] = date.today().isoformat()
    if run:
        doc["runs"] = list(dict.fromkeys([*doc.get("runs", []), run]))
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    tally = {k: sum(1 for e in doc["entries"] if e["provenance"] == k) for k in ("containment", "checked", "re-audited", "unsupported")}
    stale = sum(1 for s in sts if s["id"] in entries and entries[s["id"]]["fingerprint"] != fingerprint(s))
    return {**tally, "unchecked": len(sts) - len(doc["entries"]) + stale}


def accept(book: str, run_file: Path) -> dict:
    res = json.loads(run_file.read_text())
    if res.get("stage") != "S2-provenance":
        raise SystemExit(f"{run_file} is not a provenance return")
    by_lesson: dict[str, list[dict]] = {}
    for r in res.get("results") or []:
        by_lesson.setdefault(r["id"].split(":", 1)[0], []).append(r)
    run = str(run_file.relative_to(HERE)) if run_file.is_relative_to(HERE) else str(run_file)
    return {slug: record(book, slug, rs, run) for slug, rs in by_lesson.items()}


def flags(book: str, slug: str) -> dict[str, dict]:
    """The statements the check could not confirm, still as checked (the review tool and the coverage audit read this)."""
    rec, sts = statements(book, slug)
    fp = {s["id"]: fingerprint(s) for s in sts}
    return {e["id"]: e for e in checked_already(book, slug).values() if e["provenance"] == "unsupported" and fp.get(e["id"]) == e["fingerprint"]}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("run", "args"):
        s = sub.add_parser(name)
        s.add_argument("book")
        s.add_argument("lessons", nargs="+")
        s.add_argument("--cap", type=float, default=2.0)
        s.add_argument("--force", action="store_true", help="check again statements already checked")
    c = sub.add_parser("accept")
    c.add_argument("book")
    c.add_argument("run_file", type=Path)
    a = ap.parse_args(argv)
    if a.cmd == "accept":
        rep = accept(a.book, a.run_file.resolve())
    else:
        import embed_workflow as EW  # noqa: PLC0415
        import workflow_runner as WR  # noqa: PLC0415
        args, contained = build_args(a.book, a.lessons, a.force)
        rep = {slug: record(a.book, slug, [{"id": s["id"], "provenance": "containment"} for s in sts], None)
               for slug, sts in contained.items()} if a.cmd == "run" else {}
        n = sum(len(P["statements"]) for P in args["pages"])
        if n:
            tag = a.lessons[0] if len(a.lessons) == 1 else f"{a.lessons[0]}..{a.lessons[-1]}"
            copy = EW.default_out(a.book, "provenance", tag)
            print(EW.summary(EW.write(HERE / "runbook" / "provenance.workflow.js", args, copy)), file=sys.stderr)
            if a.cmd == "args":
                return 0
            run_file, _res, _cost = WR.run_copy(copy, [HERE / "work" / a.book / "page-images"], a.cap, f"prov.{tag}", a.book,
                                                "provenance", stage="S2")
            rep.update(accept(a.book, run_file))
        elif not rep:
            print("every statement is already checked (--force to check again)", file=sys.stderr)
            return 0
    for slug, t in sorted(rep.items()):
        print(f"{slug}: {t['containment']} by containment, {t['checked']} checked, {t['re-audited']} re-audited, "
              f"{t['unsupported']} UNSUPPORTED (flagged in Label extraction), {t['unchecked']} not checked yet", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

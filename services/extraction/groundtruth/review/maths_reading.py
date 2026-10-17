"""The review tool's Maths reading task: where the two readings of a printed formula disagree, a person chooses.

Reads `services/extraction/book-records/<book>/maths-reading/<lesson>.json` (format `ainext.maths-reading/1`, written by
book_record_maths.py: every formula of a page-image book's records read a second time, blind, from the page) and the
book record each entry belongs to. Only disagreements and unread formulas need a decision; an agreed one is listed
under "All". The choice is what the page PRINTS: the first reading (the record's), the second, or what the reviewer
types. A book's own mistake is a misprint (the Misprints task), not this.

Decisions are appended to `services/extraction/reviews/<book>/maths-reading.json` (format `ainext.maths-reading-review/1`)
with the entry's fingerprint, so a formula whose reading changes comes back. `book_record_maths.py apply` writes a
chosen second or typed reading into the book record. Standard library only.
"""
import json
import os
import re
from datetime import date
from pathlib import Path

EXTRACTION = Path(__file__).resolve().parents[2]
RECORDS = EXTRACTION / "book-records"
REVIEWS = EXTRACTION / "reviews"
NAME = re.compile(r"^[a-z0-9][a-z0-9.-]{0,63}$")
CHOICES = ("first", "second", "other")


def books() -> list[str]:
    return sorted(p.name for p in RECORDS.glob("*") if (p / "maths-reading").is_dir() and NAME.match(p.name)) if RECORDS.is_dir() else []


def _load(book: str) -> list[tuple[dict, dict]]:
    if not NAME.match(book):
        raise FileNotFoundError(book)
    out = []
    for p in sorted((RECORDS / book / "maths-reading").glob("*.json")):
        d = json.loads(p.read_text())
        out += [(d, e) for e in d.get("entries") or []]
    return out


def decisions_path(book: str) -> Path:
    if not NAME.match(book):
        raise ValueError(f"bad book {book!r}")
    return REVIEWS / book / "maths-reading.json"


def latest(book: str) -> dict[str, dict]:
    p = decisions_path(book)
    return {d["ref"]: d for d in json.loads(p.read_text()).get("decisions", [])} if p.exists() else {}


def state_of(e: dict, dec: dict | None) -> str:
    """decided | changed (decided on another reading) | open (disagreed or unread) | agreed."""
    if dec:
        return "decided" if dec.get("fingerprint") == e["fingerprint"] else "changed"
    return "agreed" if e.get("status") in ("agreed", "settled") else "open"


def summary(book: str) -> list[dict]:
    dec = latest(book)
    return [{"ref": e["ref"], "lesson": d["lesson"], "status": e["status"], "state": state_of(e, dec.get(e["ref"])),
             "page": e.get("page"), "title": f"{e['record_id'].split(':', 1)[1]} · {e['field']}"} for d, e in _load(book)]


def detail(book: str, ref: str) -> dict:
    for d, e in _load(book):
        if e["ref"] != ref:
            continue
        src = EXTRACTION / d["source"]
        rec, off = None, None
        if src.exists():
            doc = json.loads(src.read_text())
            rec = next((r for r in doc.get("items") or [] if r["id"] == e["record_id"]), None)
            off = (doc.get("source_document") or {}).get("page_offset")
        page = e.get("page")
        dec = latest(book).get(ref)
        return {"entry": e, "record": rec, "lesson": d["lesson"], "state": state_of(e, dec), "printed_page": page,
                "pdf_page": page + off if isinstance(page, int) and isinstance(off, int) else None, "decision": dec}
    raise FileNotFoundError(ref)


def decide(body: dict) -> dict:
    book, ref, choice, by = body.get("book"), body.get("ref"), body.get("choice"), (body.get("by") or "").strip()
    if choice not in CHOICES or not ref or not by:
        raise ValueError("needs book, ref, a choice (first, second, other) and your initials")
    e = next((e for _, e in _load(book) if e["ref"] == ref), None)
    if e is None:
        raise ValueError(f"no maths reading {ref} in {book}")
    latex = (body.get("latex") or "").strip().strip("$").strip()
    if choice == "other" and not latex:
        raise ValueError("type the formula as printed (LaTeX)")
    if choice == "second" and not e.get("second"):
        raise ValueError("there is no second reading to choose")
    entry = {"ref": ref, "choice": choice, "by": by, "at": date.today().isoformat(), "fingerprint": e["fingerprint"],
             "first": e["first"], "second": e.get("second")}
    if choice == "other":
        entry["latex"] = latex
    note = (body.get("note") or "").strip()
    if note:
        entry["note"] = note
    p = decisions_path(book)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(p.read_text()) if p.exists() else {"format": "ainext.maths-reading-review/1", "book": book, "decisions": []}
    data["decisions"].append(entry)  # append-only: a changed mind is a new entry
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, p)
    return entry

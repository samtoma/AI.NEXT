"""The review tool's Held generation task: every family and widget template S6 and S7 held, with why, and a decision.

A family or template the checks refuse is held (Samuel's convention, FR-1101): `teaching/<book>/families/_held--<file>`
or `teaching/<book>/widgets-held/<file>`. Nothing is generated from it, so no student sees it, but its objective goes
without that practice. The reasons are the checks' own lines, kept in teaching/<book>/held.json when it was held
(book_record_held.py backfill for what was held before). A person decides:
  drop       it stays held, decided;
  send_back  it is authored again, with the note as what to change (book_record_held.py reauthor, then Refresh).
Decisions are appended to services/extraction/reviews/<book>/held-generation.json (format `ainext.held-review/1`) with
the held file's fingerprint, so a file that changes comes back. book_record_held.py reads the same files (the two
fingerprints are pinned together by tests/test_book_record_held.py). Standard library only.
"""
import hashlib
import json
import os
import re
from datetime import date
from pathlib import Path

EXTRACTION = Path(__file__).resolve().parents[2]
TEACHING = EXTRACTION / "teaching"
REVIEWS = EXTRACTION / "reviews"
NAME = re.compile(r"^[a-z0-9][a-z0-9.-]{0,63}$")
KINDS = ("family", "template")
CHOICES = ("drop", "send_back")


def _files(book: str) -> list[tuple[str, str, Path]]:
    if not NAME.match(book or ""):
        raise FileNotFoundError(book)
    out = []
    fd, td = TEACHING / book / "families", TEACHING / book / "widgets-held"
    for p in sorted(fd.glob("_held--*.json")) if fd.is_dir() else []:
        out.append(("family", p.name.removeprefix("_held--"), p))
    for p in sorted(td.glob("*.json")) if td.is_dir() else []:
        out.append(("template", p.name, p))
    return out


def fingerprint(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def books() -> list[str]:
    return sorted(p.name for p in TEACHING.iterdir() if p.is_dir() and NAME.match(p.name) and _files(p.name)) if TEACHING.is_dir() else []


def _ledger(book: str) -> dict:
    p = TEACHING / book / "held.json"
    return json.loads(p.read_text()).get("items") or {} if p.exists() else {}


def decisions_path(book: str) -> Path:
    if not NAME.match(book or ""):
        raise ValueError(f"bad book {book!r}")
    return REVIEWS / book / "held-generation.json"


def latest(book: str) -> dict[tuple[str, str], dict]:
    p = decisions_path(book)
    return {(d["kind"], d["file"]): d for d in json.loads(p.read_text()).get("decisions") or []} if p.exists() else {}


def _row(book: str, kind: str, name: str, p: Path, led: dict, dec: dict) -> dict:
    e = led.get(f"{kind}:{name}") or {}
    d = dec.get((kind, name))
    fp = fingerprint(p)
    st = "open" if not d else "changed" if d.get("fingerprint") != fp else (
        "reauthored" if d["decision"] == "send_back" and e.get("reauthored") else d["decision"])
    obj = name.removesuffix(".json").partition("--")[0]
    return {"kind": kind, "file": name, "objective": f"lo:{obj}", "lesson": obj.rsplit("-", 1)[0],
            "title": f"{name.removesuffix('.json').partition('--')[2]} · {(e.get('reasons') or ['no reason recorded'])[0]}"[:110],
            "reasons": e.get("reasons") or [], "state": st, "fingerprint": fp}


def summary(book: str) -> list[dict]:
    led, dec = _ledger(book), latest(book)
    nat = lambda s: [(0, int(x)) if x.isdigit() else (1, x) for x in re.split(r"(\d+)", s) if x]
    rows = [_row(book, k, n, p, led, dec) for k, n, p in _files(book)]
    return sorted(rows, key=lambda r: (nat(r["lesson"]), r["kind"], r["file"]))


def detail(book: str, kind: str, name: str) -> dict:
    hit = next(((k, n, p) for k, n, p in _files(book) if k == kind and n == name), None)
    if hit is None:
        raise FileNotFoundError(f"{kind} {name}")
    row = _row(book, kind, name, hit[2], _ledger(book), latest(book))
    spec = json.loads(hit[2].read_text())
    objective, parent, page = None, None, None
    for f in sorted((EXTRACTION / "compiled" / book).glob("*.json")):
        try:
            b = json.loads(f.read_text())
        except ValueError:
            continue
        for n in b.get("nodes") or [] if isinstance(b, dict) else []:
            if n.get("id") == row["objective"]:
                objective = {"label": n.get("label"), "description": n.get("description")}
        for q in b.get("questions") or [] if isinstance(b, dict) else []:
            if q.get("id") == spec.get("parent_question_id"):
                parent = {k: q.get(k) for k in ("id", "stem", "answer", "solution", "source_page", "tier")}
                page = q.get("source_page")
    off = None
    rec = EXTRACTION / "book-records" / book / f"{row['lesson']}.json"
    if rec.exists():
        off = (json.loads(rec.read_text()).get("source_document") or {}).get("page_offset")
    led = _ledger(book).get(f"{kind}:{name}") or {}
    return {**row, "spec": spec, "objective_node": objective, "parent": parent, "held_by": led.get("held_by"),
            "held_at": led.get("at"), "reauthored": led.get("reauthored"), "decision": latest(book).get((kind, name)),
            "printed_page": page, "pdf_page": page + off if isinstance(page, int) and isinstance(off, int) else None}


def decide(body: dict) -> dict:
    book, kind, name = body.get("book"), body.get("kind"), body.get("file")
    choice, by, note = body.get("decision"), (body.get("by") or "").strip(), (body.get("note") or "").strip()
    if kind not in KINDS or choice not in CHOICES or not name or not by:
        raise ValueError("needs book, kind, file, a decision (drop, send_back) and your initials")
    hit = next(((k, n, p) for k, n, p in _files(book) if k == kind and n == name), None)
    if hit is None:
        raise ValueError(f"no held {kind} {name} in {book}")
    if choice == "send_back" and not note:
        raise ValueError("say what to change: the author reads your note beside the held spec")
    entry = {"kind": kind, "file": name, "decision": choice, "by": by, "at": date.today().isoformat(),
             "fingerprint": fingerprint(hit[2]), **({"note": note} if note else {})}
    p = decisions_path(book)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(p.read_text()) if p.exists() else {"format": "ainext.held-review/1", "book": book, "decisions": []}
    data["decisions"].append(entry)   # append-only: a changed mind is a new entry
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, p)
    return entry

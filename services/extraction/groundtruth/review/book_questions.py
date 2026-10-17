"""The review tool's Book questions (G2) task: a person decides each book question compile holds on its answer.

Compile (compile_book_records.py) holds a book question whose answer it cannot trust: `answer_mismatch` (a blind re-solve
disagrees with the printed answer), `unverified` (the re-solve could not answer) or `unanswerable` (the app's marker cannot
read the key). Samuel's G2 recommender (book_record_g2.py) recommends a verdict for each, and compile releases what a
second agent confirmed; what is left stays held, and this is where a person decides it, as Samuel does at G2 on Grade 10.

Reads compiled/<book>/compile-report.json (the held list) and the compiled bundles (the question as a student would see
it), the book record's item and page, the blind re-solve (teaching/<book>/printed-checks/), and the recommendation
(teaching/<book>/g2/). The decision is one of:
  release  the book's answer is right: the question goes live
  fix      the book's answer is wrong or mistyped: the right key, typed here, is what the app marks (a correction of the
           book's own answer: say why in the note; the Misprints task records the book's error itself)
  hold     leave it held for now
  exclude  leave it out of practice
Decisions are appended to services/extraction/reviews/<book>/book-questions-g2.json (format `ainext.g2-review/1`) with
the question's fingerprint (its stem, answer and hold), so a question that changes comes back. compile applies them,
a person's decision winning over the recommendation. Standard library only.
"""
import hashlib
import json
import os
import re
from datetime import date
from pathlib import Path

EXTRACTION = Path(__file__).resolve().parents[2]
COMPILED = EXTRACTION / "compiled"
REVIEWS = EXTRACTION / "reviews"
NAME = re.compile(r"^[a-z0-9][a-z0-9.-]{0,63}$")
HOLDS = ("answer_mismatch", "unverified", "unanswerable")
CHOICES = ("release", "fix", "hold", "exclude")
NOTE_REF = re.compile(r"\(([a-z0-9-]+:[^,()]+?), printed p\.")


def fingerprint(q: dict) -> str:
    """compile_book_records.apply_g2 computes the same, on the question as compile holds it."""
    blob = json.dumps({"stem": q.get("stem"), "answer": q.get("answer"), "hold_reason": q.get("hold_reason")}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _held(book: str) -> list[dict]:
    if not NAME.match(book):
        raise FileNotFoundError(book)
    d = COMPILED / book
    qs = {}
    for p in sorted(d.glob("*.json")) if d.is_dir() else []:
        if p.name in ("compile-report.json", "review-stamps.json"):
            continue
        try:
            b = json.loads(p.read_text())
        except ValueError:
            continue
        for q in (b.get("questions") or []) if isinstance(b, dict) else []:
            if q.get("hold_reason") in HOLDS and "lo" in q:
                qs[q["id"]] = q
    out = []
    for q in qs.values():
        m = NOTE_REF.search(q.get("source_note") or "")
        ref = m.group(1) if m else None
        out.append({"question": q, "ref": ref, "lesson": ref.split(":", 1)[0] if ref else "?", "fingerprint": fingerprint(q)})
    return sorted(out, key=lambda r: (r["lesson"], r["question"]["id"]))


def books() -> list[str]:
    if not COMPILED.is_dir():
        return []
    return sorted(p.name for p in COMPILED.iterdir() if p.is_dir() and NAME.match(p.name) and _held(p.name))


def decisions_path(book: str) -> Path:
    if not NAME.match(book):
        raise ValueError(f"bad book {book!r}")
    return REVIEWS / book / "book-questions-g2.json"


def latest(book: str) -> dict[str, dict]:
    p = decisions_path(book)
    return {d["question"]: d for d in json.loads(p.read_text()).get("decisions", [])} if p.exists() else {}


def state_of(row: dict, dec: dict | None) -> str:
    if not dec:
        return "open"
    return dec["choice"] if dec.get("fingerprint") == row["fingerprint"] else "changed"


def summary(book: str) -> list[dict]:
    dec = latest(book)
    return [{"question": r["question"]["id"], "lesson": r["lesson"], "hold": r["question"]["hold_reason"],
             "title": f"{(r['ref'] or r['question']['id']).split(':', 1)[-1]} · {r['question']['hold_reason'].replace('_', ' ')}",
             "state": state_of(r, dec.get(r["question"]["id"]))} for r in _held(book)]


def _recommendation(book: str, qid: str) -> dict | None:
    for f in sorted((EXTRACTION / "teaching" / book / "g2").glob("unit*.json")) if (EXTRACTION / "teaching" / book / "g2").is_dir() else []:
        d = json.loads(f.read_text())
        for k, meta in (d.get("questions") or {}).items():
            if meta.get("question") == qid and k in (d.get("items") or {}):
                return d["items"][k]
    return None


def detail(book: str, qid: str) -> dict:
    r = next((x for x in _held(book) if x["question"]["id"] == qid), None)
    if r is None:
        raise FileNotFoundError(qid)
    item, off, check = None, None, None
    if r["ref"]:
        slug = r["lesson"]
        rec_p = EXTRACTION / "book-records" / book / f"{slug}.json"
        if rec_p.exists():
            rec = json.loads(rec_p.read_text())
            off = (rec.get("source_document") or {}).get("page_offset")
            item = next((it for it in rec.get("items") or [] if r["ref"] == it["id"] or r["ref"].startswith(it["id"] + ":")), None)
        chk = EXTRACTION / "teaching" / book / "printed-checks" / f"{slug}.json"
        if chk.exists():
            check = next((c for c in json.loads(chk.read_text()).get("checks") or [] if c.get("ref") == r["ref"]), None)
    page = r["question"].get("source_page")
    dec = latest(book).get(qid)
    return {"question": r["question"], "ref": r["ref"], "lesson": r["lesson"], "item": item, "check": check,
            "recommendation": _recommendation(book, qid), "decision": dec, "state": state_of(r, dec),
            "printed_page": page, "pdf_page": page + off if isinstance(page, int) and isinstance(off, int) else None}


def decide(body: dict) -> dict:
    book, qid, choice, by = body.get("book"), body.get("question"), body.get("choice"), (body.get("by") or "").strip()
    if choice not in CHOICES or not qid or not by:
        raise ValueError("needs book, question, a choice (release, fix, hold, exclude) and your initials")
    r = next((x for x in _held(book) if x["question"]["id"] == qid), None)
    if r is None:
        raise ValueError(f"no held book question {qid} in {book}")
    key = (body.get("key") or "").strip().strip("$").strip()
    note = (body.get("note") or "").strip()
    if choice == "fix" and not key:
        raise ValueError("type the right answer, as the app should mark it")
    if choice == "fix" and not note:
        raise ValueError("say why the book's answer is wrong (the note travels with the fix)")
    entry = {"question": qid, "ref": r["ref"], "choice": choice, "by": by, "at": date.today().isoformat(),
             "fingerprint": r["fingerprint"], "hold": r["question"]["hold_reason"], "book_answer": r["question"].get("answer")}
    if key:
        entry["key"] = key
    if note:
        entry["note"] = note
    p = decisions_path(book)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(p.read_text()) if p.exists() else {"format": "ainext.g2-review/1", "book": book, "decisions": []}
    data["decisions"].append(entry)  # append-only: a changed mind is a new entry
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, p)
    return entry

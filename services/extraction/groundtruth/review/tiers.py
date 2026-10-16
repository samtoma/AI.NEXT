"""The review tool's Question tiers task: where the two readings of a question's tier disagree, a person chooses.

Reads the teaching layer, `services/extraction/teaching/<book>/tiers/<lesson>.json` (format
`ainext.question-tiers/1`, written by tier_questions.py: Grade 10's S3 tier rule, read twice on every book question,
once with the answer and worked solution and once blind), and the book record each entry was made from, so the
reviewer sees the question as the book prints it and both readings. Only disagreements need a decision; an agreed
tier is listed under "All" and can be overruled the same way.

Decisions are appended to `services/extraction/reviews/<book>/question-tiers.json` (format `ainext.tier-review/1`)
with the question's fingerprint, so a question whose text changes comes back. compile_book_records.py reads them:
a person's tier wins over both readings. A tier is a teaching judgement, not a review of the question: it never
stamps `reviewed_by`. Standard library only.
"""
import json
import os
import re
from datetime import date
from pathlib import Path

EXTRACTION = Path(__file__).resolve().parents[2]
TEACHING = EXTRACTION / "teaching"
REVIEWS = EXTRACTION / "reviews"
NAME = re.compile(r"^[a-z0-9][a-z0-9.-]{0,63}$")
TIERS = ("basic", "standard", "advanced")


def books() -> list[str]:
    return sorted(p.name for p in TEACHING.glob("*") if (p / "tiers").is_dir() and NAME.match(p.name)) if TEACHING.is_dir() else []


def _load(book: str) -> list[tuple[dict, dict]]:
    if not NAME.match(book):
        raise FileNotFoundError(book)
    out = []
    for p in sorted((TEACHING / book / "tiers").glob("*.json")):
        d = json.loads(p.read_text())
        for t in d.get("tiers") or []:
            out.append((d, t))
    return out


def decisions_path(book: str) -> Path:
    if not NAME.match(book):
        raise ValueError(f"bad book {book!r}")
    return REVIEWS / book / "question-tiers.json"


def latest(book: str) -> dict[str, dict]:
    p = decisions_path(book)
    return {d["ref"]: d for d in json.loads(p.read_text()).get("decisions", [])} if p.exists() else {}


def state_of(t: dict, dec: dict | None) -> str:
    """decided | changed (decided on another wording) | open (the readings disagree) | agreed."""
    if dec:
        return "decided" if dec.get("fingerprint") == t["question_fingerprint"] else "changed"
    return "agreed" if t.get("status") == "agreed" else "open"


def summary(book: str) -> list[dict]:
    dec = latest(book)
    out = []
    for d, t in _load(book):
        x = dec.get(t["ref"])
        st = state_of(t, x)
        out.append({"ref": t["ref"], "lesson": d["lesson"], "status": t.get("status"), "state": st,
                    "tier": x["tier"] if st == "decided" else t.get("tier"),
                    "readings": [r.get("tier") for r in t.get("readings") or []],
                    "title": f"{t['ref'].split(':', 1)[1]} · {t['type'].replace('_', ' ')}"})
    return out


def detail(book: str, ref: str) -> dict:
    for d, t in _load(book):
        if t["ref"] != ref:
            continue
        src = EXTRACTION / d["source"]
        rec, off, pdf = None, None, None
        if src.exists():
            doc = json.loads(src.read_text())
            rec = next((r for r in doc.get("items") or [] if r["id"] == t["record_id"]), None)
            off = (doc.get("source_document") or {}).get("page_offset")
            pdf = (doc.get("source_document") or {}).get("file_path")
        page = t.get("page")
        dec = latest(book).get(ref)
        return {"tier": t, "record": rec, "lesson": d["lesson"], "rule": d.get("rule"), "state": state_of(t, dec),
                "printed_page": page, "pdf_page": page + off if isinstance(page, int) and isinstance(off, int) else None,
                "pdf": pdf, "decision": dec}
    raise FileNotFoundError(ref)


def decide(body: dict) -> dict:
    book, ref, tier, by = body.get("book"), body.get("ref"), body.get("tier"), (body.get("by") or "").strip()
    if tier not in TIERS or not ref or not by:
        raise ValueError("needs book, ref, a tier (basic, standard, advanced) and your initials")
    t = next((t for _, t in _load(book) if t["ref"] == ref), None)
    if t is None:
        raise ValueError(f"no tier entry {ref} in {book}")
    entry = {"ref": ref, "tier": tier, "by": by, "at": date.today().isoformat(), "fingerprint": t["question_fingerprint"],
             "readings": [r.get("tier") for r in t.get("readings") or []]}
    note = (body.get("note") or "").strip()
    if note:
        entry["note"] = note
    p = decisions_path(book)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(p.read_text()) if p.exists() else {"format": "ainext.tier-review/1", "book": book, "decisions": []}
    data["decisions"].append(entry)  # append-only: a changed mind is a new entry
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, p)
    return entry

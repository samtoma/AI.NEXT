"""The statements S2's provenance check could not confirm, for the review tool's Label extraction task.

Reads book-records/<book>/provenance/<lesson>.json (format `ainext.provenance/1`, written by book_record_provenance.py:
Samuel's S2 check, Haiku then a Sonnet re-audit, against the printed page) and the lesson's book record, and returns
the statements still flagged `unsupported` as they were checked: one edited since is no longer flagged by this check
(it is re-checked on the next run). The fingerprint is book_record_provenance.fingerprint's, recomputed here because the
review server is standard library only (tests/test_book_record_provenance.py pins the two together).
"""
import hashlib
import json
import re
from pathlib import Path

EXTRACTION = Path(__file__).resolve().parents[2]
NAME = re.compile(r"^[a-z0-9][a-z0-9.-]{0,63}$")


def claim_of(it: dict) -> str:
    return " ".join(str(it.get("claim") or it.get("term") or it.get("text") or "").split())


def fingerprint(it: dict) -> str:
    return hashlib.sha256(f"{it['id']}\n{claim_of(it)}\n{it.get('quote') or ''}".encode()).hexdigest()[:16]


def flags(book: str, slug: str) -> dict[str, dict]:
    if not (NAME.match(book) and NAME.match(slug)):
        return {}
    f = EXTRACTION / "book-records" / book / "provenance" / f"{slug}.json"
    rec = EXTRACTION / "book-records" / book / f"{slug}.json"
    if not (f.exists() and rec.exists()):
        return {}
    fp = {it["id"]: fingerprint(it) for it in json.loads(rec.read_text()).get("items") or []}
    return {e["id"]: e for e in json.loads(f.read_text()).get("entries") or []
            if e.get("provenance") == "unsupported" and fp.get(e["id"]) == e.get("fingerprint")}

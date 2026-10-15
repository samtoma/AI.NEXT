"""The review tool's Generated answers task: every answer `answer_gen.py` wrote, beside the book's question.

Reads the teaching layer, `services/extraction/teaching/<book>/answers/<lesson>.json` (format
`ainext.generated-answers/1`), and the book record each was made from (its `source`), so the reviewer sees the
question as the book prints it, the generated answer and steps, what the blind re-solve said and what the
machine checks found. Decisions are appended to `services/extraction/reviews/<book>/generated-answers.json`
(format `ainext.answer-review/1`) with the answer's fingerprint, so a regenerated answer comes back for review.
Nothing reaches students until a pipeline step reads the approved answers. Standard library only.
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
DECISIONS = {"approve", "fix_requested", "reject"}
STATUS_LABEL = {"agreed": "both readings agree", "disagreed": "the two readings disagree", "flagged": "a step failed the numeric check",
                "needs_person": "a drawing or explanation: no machine check", "cannot_answer": "the model could not answer",
                "missing": "the model returned nothing"}


def books() -> list[str]:
    return sorted(p.name for p in TEACHING.glob("*") if (p / "answers").is_dir() and NAME.match(p.name)) if TEACHING.is_dir() else []


def _files(book: str) -> list[Path]:
    if not NAME.match(book):
        raise FileNotFoundError(book)
    return sorted((TEACHING / book / "answers").glob("*.json"))


def fingerprint(a: dict) -> str:
    return hashlib.md5(json.dumps({k: a.get(k) for k in ("kind", "answer", "solution", "question_fingerprint")},
                                  sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _load(book: str) -> list[tuple[dict, dict]]:
    out = []
    for p in _files(book):
        d = json.loads(p.read_text())
        for a in d.get("answers") or []:
            out.append((d, a))
    return out


def decisions_path(book: str) -> Path:
    if not NAME.match(book):
        raise ValueError(f"bad book {book!r}")
    return REVIEWS / book / "generated-answers.json"


def latest(book: str) -> dict[str, dict]:
    p = decisions_path(book)
    return {d["ref"]: d for d in json.loads(p.read_text()).get("decisions", [])} if p.exists() else {}


def summary(book: str) -> list[dict]:
    dec = latest(book)
    out = []
    for d, a in _load(book):
        x = dec.get(a["ref"])
        state = "open" if not x else ("changed" if x.get("fingerprint") != fingerprint(a) else x["decision"])
        q = (a.get("question") or {})
        out.append({"ref": a["ref"], "lesson": d["lesson"], "status": a.get("status"), "kind": a.get("kind"),
                    "title": f"{a['ref'].split(':', 1)[1]} · {re.sub(r'[$*]', '', q.get('stem') or q.get('text') or '')[:60]}",
                    "state": state})
    return out


def detail(book: str, ref: str) -> dict:
    for d, a in _load(book):
        if a["ref"] != ref:
            continue
        src = EXTRACTION / d["source"]
        rec, off, pdf = None, None, None
        if src.exists():
            doc = json.loads(src.read_text())
            rec = next((r for r in doc.get("items") or [] if r["id"] == a["record_id"]), None)
            off = (doc.get("source_document") or {}).get("page_offset")
            pdf = (doc.get("source_document") or {}).get("file_path")
        page = a.get("page")
        dec = latest(book).get(ref)
        return {"answer": a, "record": rec, "lesson": d["lesson"], "status_label": STATUS_LABEL.get(a.get("status"), a.get("status")),
                "printed_page": page, "pdf_page": page + off if isinstance(page, int) and isinstance(off, int) else None,
                "pdf": pdf, "decision": dec, "fingerprint": fingerprint(a),
                "changed": bool(dec and dec.get("fingerprint") != fingerprint(a)),
                "run": (d.get("runs") or [{}])[-1]}
    raise FileNotFoundError(ref)


def decide(body: dict) -> dict:
    book, ref, decision, by = body.get("book"), body.get("ref"), body.get("decision"), (body.get("by") or "").strip()
    if decision not in DECISIONS or not ref or not by:
        raise ValueError("needs book, ref, a decision (approve, fix_requested, reject) and your initials")
    a = next((a for _, a in _load(book) if a["ref"] == ref), None)
    if a is None:
        raise ValueError(f"no generated answer {ref} in {book}")
    note, correction = (body.get("note") or "").strip(), (body.get("correction") or "").strip()
    if decision == "fix_requested" and not (note or correction):
        raise ValueError("say what needs fixing, or give the right answer")
    entry = {"ref": ref, "decision": decision, "by": by, "at": date.today().isoformat(), "fingerprint": fingerprint(a),
             "answer": a.get("answer")}
    if note:
        entry["note"] = note
    if correction:
        entry["correction"] = correction
    p = decisions_path(book)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(p.read_text()) if p.exists() else {"format": "ainext.answer-review/1", "book": book, "decisions": []}
    data["decisions"].append(entry)  # append-only: a changed mind is a new entry
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, p)
    return entry

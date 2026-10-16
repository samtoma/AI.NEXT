"""The review tool's Objectives task: gate G1 for a book record's objectives, as a review.

Reads S1's checked result, `services/extraction/teaching/<book>/objectives/ch<NN>.json` (format `ainext.s1-result/1`,
written by book_record_objectives.py: Samuel's S1 — two blind finders, a reconciler, two blind mappers, an evidence
check, and his prerequisite linker with its independent checker — then his deterministic checks), and lists three
kinds of item:

  objective  each objective S1 found: its statement and label, its evidence (quotes at their anchors), the items the
             mappers filed under it, the finders' agreement, and any check it fails (Samuel's rule 1: two kinds of
             evidence, one of them a worked example or exercise). approve | fix_requested (with the statement or label
             to use, or a note) | reject.
  link       each prerequisite link the checker confirmed (and each it dropped, so a person can restore one), with its
             evidence. keep | drop.
  question   each decision S1 says G1 owes (a term not in the book's vocabulary, an objective no item practises):
             the reviewer's answer, as text.

Decisions are appended to `services/extraction/reviews/<book>/objectives-g1.json` (format `ainext.g1-review/1`) with the
item's fingerprint, so an item S1 changes comes back. `book_record_objectives.py apply` writes only what was approved:
the objectives and their items into the book records, the kept links into the teaching layer. Standard library only.
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
DECISIONS = {"objective": {"approve", "fix_requested", "reject"}, "link": {"keep", "drop"}, "question": {"answer"}}


def books() -> list[str]:
    return sorted(p.name for p in TEACHING.glob("*") if (p / "objectives").is_dir() and NAME.match(p.name)) if TEACHING.is_dir() else []


def _files(book: str) -> list[Path]:
    if not NAME.match(book):
        raise FileNotFoundError(book)
    return sorted((TEACHING / book / "objectives").glob("ch*.json"))


def _items(book: str) -> list[dict]:
    out = []
    for f in _files(book):
        d = json.loads(f.read_text())
        ch = d.get("chapter")
        for l in d.get("lessons") or []:
            for o in l.get("objectives") or []:
                out.append({"kind": "objective", "ref": o["id"], "chapter": ch, "lesson": l["slug"], "item": o,
                            "fingerprint": o["fingerprint"]})
        for k in d.get("links") or []:
            out.append({"kind": "link", "ref": k["key"], "chapter": ch, "lesson": k["dst"].removeprefix("lo:").rsplit("-", 1)[0],
                        "item": {**k, "kept_by_s1": True}, "fingerprint": k["fingerprint"]})
        for k in d.get("links_dropped") or []:
            if k.get("key"):
                out.append({"kind": "link", "ref": k["key"], "chapter": ch, "lesson": str(k["key"]).split("->")[-1].removeprefix("lo:").rsplit("-", 1)[0],
                            "item": {**k, "kept_by_s1": False}, "fingerprint": "dropped:" + k["key"]})
        for q in d.get("decisions") or []:
            out.append({"kind": "question", "ref": q["key"], "chapter": ch, "lesson": f"ch{ch}", "item": q,
                        "fingerprint": "q:" + q["key"] + ":" + str(q.get("detail"))})
    return out


def decisions_path(book: str) -> Path:
    if not NAME.match(book):
        raise ValueError(f"bad book {book!r}")
    return REVIEWS / book / "objectives-g1.json"


def latest(book: str) -> dict[tuple[str, str], dict]:
    p = decisions_path(book)
    return {(d["kind"], d["ref"]): d for d in json.loads(p.read_text()).get("decisions", [])} if p.exists() else {}


def state_of(row: dict, dec: dict | None) -> str:
    if not dec:
        return "open"
    return dec["decision"] if dec.get("fingerprint") == row["fingerprint"] else "changed"


def summary(book: str) -> list[dict]:
    dec = latest(book)
    out = []
    for r in _items(book):
        it = r["item"]
        title = {"objective": lambda: f"{r['ref'].removeprefix('lo:')} · {it.get('label') or ''}",
                 "link": lambda: f"{it.get('src', '').removeprefix('lo:')} → {it.get('dst', '').removeprefix('lo:')}" if it.get("src")
                 else r["ref"].replace("lo:", ""),
                 "question": lambda: f"{it.get('kind')} · {str(it.get('key', '')).split(':', 1)[-1]}"}[r["kind"]]()
        flag = bool(it.get("failures")) if r["kind"] == "objective" else (not it.get("kept_by_s1") if r["kind"] == "link" else False)
        out.append({"kind": r["kind"], "ref": r["ref"], "lesson": r["lesson"], "title": title, "flag": flag,
                    "state": state_of(r, dec.get((r["kind"], r["ref"])))})
    return out


def detail(book: str, kind: str, ref: str) -> dict:
    r = next((x for x in _items(book) if x["kind"] == kind and x["ref"] == ref), None)
    if r is None:
        raise FileNotFoundError(ref)
    d = latest(book).get((kind, ref))
    return {**r, "decision": d, "state": state_of(r, d)}


def decide(body: dict) -> dict:
    book, kind, ref, decision, by = body.get("book"), body.get("kind"), body.get("ref"), body.get("decision"), (body.get("by") or "").strip()
    if kind not in DECISIONS or decision not in DECISIONS[kind] or not ref or not by:
        raise ValueError(f"needs book, kind, ref, a decision ({', '.join(sorted(DECISIONS.get(kind, [])))}) and your initials")
    r = next((x for x in _items(book) if x["kind"] == kind and x["ref"] == ref), None)
    if r is None:
        raise ValueError(f"no {kind} {ref} in {book}")
    note = (body.get("note") or "").strip()
    entry = {"kind": kind, "ref": ref, "decision": decision, "by": by, "at": date.today().isoformat(), "fingerprint": r["fingerprint"]}
    for k in ("statement", "label"):
        if (body.get(k) or "").strip():
            entry[k] = body[k].strip()
    if note:
        entry["note"] = note
    if decision in ("fix_requested", "answer") and not (note or entry.get("statement") or entry.get("label")):
        raise ValueError("say what to change, or give the answer")
    p = decisions_path(book)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(p.read_text()) if p.exists() else {"format": "ainext.g1-review/1", "book": book, "decisions": []}
    data["decisions"].append(entry)  # append-only: a changed mind is a new entry
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, p)
    return entry

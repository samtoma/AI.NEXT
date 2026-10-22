"""The review tool's Context task: the book's own context for each objective, as two readings sorted it (S1C).

Also the examples S1G wrote where the book has none (generated-ch<NN>.json, marked generated: a blind checker
recomputed them; a doubted one is held). Reads `services/extraction/teaching/<book>/context/ch<NN>.json` (format `ainext.context/1`, written by
book_record_context.py: the lesson's linking text, each passage read twice and blind — real-life opener, concept
introduction, or not context — and filed under the objective it introduces, or the whole lesson). A passage both
readings agree on is already used; one they disagree on is HELD and never shown until a person decides it. Nothing here
blocks the pipeline (Tamer, 2026-10-22: it passes like other generated content and is reviewed later).

A decision is keep (with the kind and the objective a person chooses, which may differ from both readings) or drop,
appended to `services/extraction/reviews/<book>/context-review.json` (format `ainext.context-review/1`) with the
passage's fingerprint, so a passage whose text or lesson objectives change comes back. compile_book_records.py reads
them (book_record_context.resolved): a person's decision wins over the readings. Standard library only.
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
KINDS = ("real_life", "concept_intro", "closing_reflection")
DECISIONS = ("keep", "drop")


def books() -> list[str]:
    return sorted(p.name for p in TEACHING.glob("*") if (p / "context").is_dir() and NAME.match(p.name)) if TEACHING.is_dir() else []


def _load(book: str) -> list[tuple[dict, dict, dict]]:
    """(chapter file, lesson, passage) for every passage that is not one of the book's instructions."""
    if not NAME.match(book):
        raise FileNotFoundError(book)
    out = []
    import sys  # noqa: PLC0415
    sys.path.insert(0, str(EXTRACTION))
    import book_record_context as BRC  # noqa: PLC0415  (the generated examples, S1G, read as passages)
    for p in sorted((TEACHING / book / "context").glob("ch*.json")):
        d = json.loads(p.read_text())
        for L in d.get("lessons") or []:
            for e in (L.get("passages") or []) + BRC.generated_passages(book, L["slug"]):
                if e.get("status") != "instruction":
                    out.append((d, L, e))
    return out


def decisions_path(book: str) -> Path:
    if not NAME.match(book):
        raise ValueError(f"bad book {book!r}")
    return REVIEWS / book / "context-review.json"


def latest(book: str) -> dict[str, dict]:
    p = decisions_path(book)
    return {d["ref"]: d for d in json.loads(p.read_text()).get("decisions", [])} if p.exists() else {}


def state_of(e: dict, dec: dict | None) -> str:
    """decided | changed (decided on another wording) | held (the readings disagree: not shown) | used | not_context."""
    if dec:
        return "decided" if dec.get("fingerprint") == e["fingerprint"] else "changed"
    if e.get("status") != "agreed":
        return "held"
    return "used" if e.get("kind") in KINDS else "not_context"


def _objective_name(L: dict, n) -> str:
    if n in (None, ""):
        return "?"
    if int(n) == 0:
        return "the whole lesson"
    o = next((o for o in L.get("objectives") or [] if o["n"] == int(n)), None)
    return f"{n}. {o['label']}" if o else str(n)


def summary(book: str) -> list[dict]:
    dec = latest(book)
    out = []
    for d, L, e in _load(book):
        x = dec.get(e["key"])
        st = state_of(e, x)
        kind = x.get("kind") if st == "decided" and x["decision"] == "keep" else ("dropped" if st == "decided" else e.get("kind"))
        obj = x.get("objective") if st == "decided" and x["decision"] == "keep" else e.get("objective")
        out.append({"ref": e["key"], "chapter": d.get("chapter"), "lesson": L["slug"], "state": st, "kind": kind,
                    "objective": _objective_name(L, obj), "title": ("[generated] " if e.get("generated") else "") + e["text"][:90],
                    "generated": bool(e.get("generated"))})
    return out


def detail(book: str, ref: str) -> dict:
    for d, L, e in _load(book):
        if e["key"] != ref:
            continue
        dec = latest(book).get(ref)
        reading = lambda r: None if not r else {"kind": r.get("kind"), "objective": _objective_name(L, r.get("objective")), "why": r.get("why")}
        return {"passage": {k: e.get(k) for k in ("key", "page", "text", "status", "kind", "generated", "numbers")},
                "objective": _objective_name(L, e.get("objective")), "A": reading(e.get("A")), "B": reading(e.get("B")),
                "lesson": L["slug"], "title": L.get("title"), "chapter": d.get("chapter"), "state": state_of(e, dec),
                "objectives": [{"n": o["n"], "label": o["label"]} for o in L.get("objectives") or []],
                "real_life_questions": [b["key"] for b in L.get("bridges") or []], "decision": dec}
    raise FileNotFoundError(ref)


def decide(body: dict) -> dict:
    book, ref, decision, by = body.get("book"), body.get("ref"), body.get("decision"), (body.get("by") or "").strip()
    if decision not in DECISIONS or not ref or not by:
        raise ValueError("needs book, ref, a decision (keep or drop) and your initials")
    found = next(((L, e) for _, L, e in _load(book) if e["key"] == ref), None)
    if found is None:
        raise ValueError(f"no context passage {ref} in {book}")
    L, e = found
    entry = {"ref": ref, "decision": decision, "by": by, "at": date.today().isoformat(), "fingerprint": e["fingerprint"]}
    if decision == "keep":
        kind = body.get("kind")
        try:
            n = int(body.get("objective"))
        except (TypeError, ValueError):
            n = -1
        if kind not in KINDS or n not in {o["n"] for o in L.get("objectives") or []} | {0}:
            raise ValueError("keep needs a kind (real_life, concept_intro or closing_reflection) and an objective of the lesson (0: the whole lesson)")
        entry["kind"], entry["objective"] = kind, n
    note = (body.get("note") or "").strip()
    if note:
        entry["note"] = note
    p = decisions_path(book)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(p.read_text()) if p.exists() else {"format": "ainext.context-review/1", "book": book, "decisions": []}
    data["decisions"].append(entry)  # append-only: a changed mind is a new entry
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, p)
    return entry

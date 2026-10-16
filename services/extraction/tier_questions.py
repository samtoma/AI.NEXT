"""Tier every book question with Grade 10's S3 rule, read twice, for the teaching layer.

    uv run tier_questions.py run prep3-math-en u1-1 u1-2 u1-3 u1-4 [--cap 1] [--force]

Run from services/extraction/. A tier is not printed in the book: it is a teaching judgement, so it lives in the
teaching layer, keyed by book-record ids (`u1-1:drill-2:A`), beside the generated answers.

THE RULE is Grade 10's (runbook/lesson.workflow.js, S3 Typing and S3 Tier check), word for word; a test pins it:
    basic = one method step; standard = a multi-step application of one method; advanced = methods combined, a word
    problem, or an end-of-chapter item.

TWO READINGS, ON EVERY QUESTION. Grade 10 tiers each item in its typing call and re-tiers a sample of one item in
five blind; a Prep-3 lesson has a few dozen prompts, so here every one is read twice:
  1. the typing reading (Haiku, as S3 Typing): the question with its answer and worked solution, printed or
     generated: what the steps actually take;
  2. the blind reading (Sonnet, as S3 Tier check): the question alone; it never sees the first reading.
The same tier → `agreed`, used as it is. Different → `disagreed`: listed for a person in the review tool's Tiers
task, and until a person decides, the blind reading's tier is used (Grade 10's rule: the check wins).

Writes teaching/<book>/tiers/<slug>.json (format `ainext.question-tiers/1`), one entry per exercise, worked
example, activity or open-prompt part. A part whose question has not changed is skipped unless --force.
compile_book_records.py reads it: a person's decision (reviews/<book>/question-tiers.json), else the agreed tier,
else the blind reading's, else "standard".

COST. Two `claude` CLI calls per lesson, minimal system prompt, no tools. `--cap` (USD, default 1).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "groundtruth"))
import answer_gen as AG  # noqa: E402  (call_claude, Budget, with_intended)
import score_book_record as SC  # noqa: E402

FORMAT = "ainext.question-tiers/1"
VERSION = "tier-v1"
TIERS = ("basic", "standard", "advanced")
PROMPTS = ("exercise", "worked_example", "activity", "open_prompt")
# Grade 10's tier rule, as runbook/lesson.workflow.js writes it (S3 Typing's `tier:` line and S3 Tier check)
RULE = ("basic = one method step; standard = a multi-step application of one method; advanced = methods combined, "
        "a word problem, or an end-of-chapter item.")
SYSTEM = "You assign difficulty tiers to textbook items for a Prep-3 (Grade 9) maths course. Return the structured output asked for."
TIER_SCHEMA = {"type": "object", "required": ["tiers"], "properties": {"tiers": {"type": "array", "items": {
    "type": "object", "required": ["ref", "tier"], "properties": {"ref": {"type": "string"}, "tier": {"enum": list(TIERS)}}}}}}


def fingerprint(text: str, stem: str) -> str:
    return hashlib.md5(json.dumps({"text": text, "stem": stem}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def generated_answers(book: str, slug: str, record: dict, record_path: Path) -> dict[str, dict]:
    """ref (this record's ids) → the generated answer for it, whatever its review state: the steps say what a
    question takes even before a person has approved them (the tier is reviewed on its own)."""
    p = HERE / "teaching" / book / "answers" / f"{slug}.json"
    if not p.exists():
        return {}
    data = json.loads(p.read_text())
    alias, src = {}, HERE / data["source"]
    if src.resolve() != record_path.resolve() and src.exists():
        pairs, _m, _i = SC.match(record.get("items") or [], json.loads(src.read_text()).get("items") or [])
        alias = {g["id"]: e["id"] for g, e, _ in pairs}
    out = {}
    for a in data.get("answers") or []:
        rid = alias.get(a["record_id"], a["record_id"])
        out[f"{rid}:{a['part']}" if a.get("part") else rid] = a
    return out


def units(book: str, record: dict, record_path: Path) -> list[dict]:
    gen = generated_answers(book, record["lesson"]["slug"], record, record_path)
    out = []
    for raw in record.get("items") or []:
        if raw["type"] not in PROMPTS:
            continue
        r = AG.with_intended(raw)
        text = r.get("text") or r.get("stem") or ""
        for p in r.get("parts") or [None]:
            ref = f"{r['id']}:{p['label']}" if p else r["id"]
            stem = (p or {}).get("stem") or ""
            g = gen.get(ref) or {}
            answer = (p or r).get("answer") or (r.get("answer") if p is None else None) or g.get("answer")
            solution = (p or {}).get("solution") or r.get("solution") or g.get("solution") or []
            out.append({"ref": ref, "record_id": r["id"], "part": (p or {}).get("label"), "type": r["type"], "page": r.get("source_page"),
                        "question": f"{text}" + (f" (part {p['label']}: {stem})" if p and stem else (f" (part {p['label']})" if p else "")),
                        "answer": answer, "solution": solution, "fingerprint": fingerprint(text, stem)})
    return out


def read_twice(slug: str, us: list[dict], budget: AG.Budget) -> dict[str, dict]:
    typing = AG.call_claude(SYSTEM, (
        f"Assign each book item below a difficulty tier from its QUESTION, its ANSWER and its WORKED SOLUTION: what the steps "
        f"actually take. tier: {RULE} Do not read any file.\n\nLESSON {slug}\n"
        + "\n\n".join(f"[{u['ref']}] ({u['type'].replace('_', ' ')})\n  QUESTION: {u['question']}\n  ANSWER: {u['answer'] or '(none)'}"
                      f"\n  WORKED SOLUTION: {' ⏎ '.join(u['solution']) or '(none)'}" for u in us)
        + "\n\nReturn one row per item; ref is the item's id as shown in brackets, written without the brackets."),
        TIER_SCHEMA, "haiku", budget, f"{slug} tiers: typing reading ({len(us)})")
    blind = AG.call_claude(SYSTEM, (
        f"Assign each item a difficulty tier: {RULE} Do not read any file.\n\n"
        + "\n\n".join(f"[{u['ref']}] {u['question']}" for u in us)
        + "\n\nReturn one row per item; ref is the item's id as shown in brackets, written without the brackets."),
        TIER_SCHEMA, "sonnet", budget, f"{slug} tiers: blind reading ({len(us)})")
    first = {t["ref"].strip("[]"): t["tier"] for t in typing.get("tiers") or []}
    second = {t["ref"].strip("[]"): t["tier"] for t in blind.get("tiers") or []}
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out = {}
    for u in us:
        a, b = first.get(u["ref"]), second.get(u["ref"])
        status = "agreed" if a and a == b else ("disagreed" if a and b else "missing")
        out[u["ref"]] = {"ref": u["ref"], "record_id": u["record_id"], "part": u["part"], "type": u["type"], "page": u["page"],
                         "question_fingerprint": u["fingerprint"],
                         "readings": [{"reading": "typing", "model": "haiku", "sees": "question, answer and worked solution", "tier": a},
                                      {"reading": "blind", "model": "sonnet", "sees": "question only", "tier": b}],
                         "status": status, "tier": a if status == "agreed" else (b or a),
                         "made": {"at": stamp, "version": VERSION}}
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("book")
    r.add_argument("lessons", nargs="+")
    r.add_argument("--cap", type=float, default=1.0)
    r.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    budget = AG.Budget(a.cap)
    for slug in a.lessons:
        rec_path = HERE / "book-records" / a.book / f"{slug}.json"
        record = json.loads(rec_path.read_text())
        out = HERE / "teaching" / a.book / "tiers" / f"{slug}.json"
        prev = json.loads(out.read_text()) if out.exists() else None
        done = {x["ref"]: x for x in (prev or {}).get("tiers") or []}
        us = units(a.book, record, rec_path)
        todo = [u for u in us if a.force or u["ref"] not in done or done[u["ref"]]["question_fingerprint"] != u["fingerprint"]]
        if todo:
            before = budget.spent
            done.update(read_twice(slug, todo, budget))
            runs = (prev or {}).get("runs", []) + [{"at": date.today().isoformat(), "version": VERSION, "parts": len(todo),
                                                    "cost_usd": round(budget.spent - before, 4)}]
        else:
            runs = (prev or {}).get("runs", [])
        order = {u["ref"]: i for i, u in enumerate(us)}
        doc = {"format": FORMAT, "book": a.book, "lesson": slug, "source": str(rec_path.relative_to(HERE)), "rule": RULE,
               "made_by": "tier_questions.py", "runs": runs,
               "tiers": sorted((v for k, v in done.items() if k in order), key=lambda x: order[x["ref"]])}
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
        st = Counter(t["status"] for t in doc["tiers"])
        tiers = Counter(t["tier"] for t in doc["tiers"])
        print(f"{slug}: {len(doc['tiers'])} part(s), {len(todo)} read now; {dict(st)}; {dict(tiers)}", file=sys.stderr)
    print(f"cost ${budget.spent:.3f}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

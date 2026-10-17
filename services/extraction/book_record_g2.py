"""G2 recommendations for book-record units: Samuel's recommender on the book questions compile holds.

    uv run book_record_g2.py list    prep3-math-en 1                 # which held book questions owe a recommendation
    uv run book_record_g2.py run     prep3-math-en 1 [--cap 4]       # the workflow, run here, then collected
    uv run book_record_g2.py args    prep3-math-en 1                 # its embedded copy, for Claude Code
    uv run book_record_g2.py collect prep3-math-en 1 runs/<book>/g2/<saved return>.json

Decided by Tamer, 2026-10-17: Samuel's G2 recommender, for held questions. In his line G2 is the review of the BOOK's
own questions: his checks HOLD a question when the printed answer and the blind re-solve disagree and EXCLUDE one when
its typing is flagged, and runbook/g2-recommend.workflow.js has one agent per batch recommend accept / fix / hold /
exclude for each, with a second, independent agent confirming every verdict that would put a question live.
g2_recommend.collect then refuses anything that is not grounded in a quote of the book, that his item model or the
app's own marker rejects, or that the verifier did not confirm. All of that is his, unchanged.

The book-record line's held questions are compile's: `answer_mismatch` (a blind re-solve disagrees with the printed
answer), `unverified` (the printed answer could not be re-solved) and `unanswerable` (the app's marker cannot read the
key). Each becomes an item in his shape (`RunItem`): a stand-in reference (his pattern, `Ex<lesson>-1:<n><part>`,
or `WE<n>`), `verification: disputed`, an exercise's printed answer as `answer_anchored` and a worked example's as
`book_worked`; an unreadable key is his `typing_problems`, so the item is "excluded" in his terms. The recommendation
file is teaching/<book>/g2/unit<NN>.json; compile_book_records.py applies it to the question it was made for, only
while that question is still what the agents read (its stem, answer and hold), and signs nothing a person decided:
    accept   the hold is lifted, `verified`, stamped "auto-pass G2 (AI recommendation)" — never a person's sign-off
    fix      the book's own key re-typed (and a stem repaired, low confidence), then as accept
    hold     the question stays held
    exclude  the question is left out, listed in the report with the agent's reason (a book error is Samuel's to fix)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_config  # noqa: E402

HOLDS = ("answer_mismatch", "unverified", "unanswerable")
NOTE_REF = re.compile(r"\(([a-z0-9-]+:[^,()]+?), printed p\.")


def out_path(book: str, unit: int) -> Path:
    return HERE / "teaching" / book / "g2" / f"unit{unit:02d}.json"


def facts_of(q: dict) -> dict:
    """What the agents judged: if any of it changes, the recommendation is for another question."""
    return {"stem": q.get("stem"), "answer": q.get("answer"), "hold_reason": q.get("hold_reason")}


def entries(book: str, slugs: list[str], compiled: Path) -> list[dict]:
    """The held book questions of the unit, each as Samuel's G2 item: [{key, lesson, ref, state, item, question, book_ref}]."""
    import compile_book_records as C  # noqa: PLC0415
    in_unit = lambda lo: any(str(lo or "").startswith(f"lo:{s}-") for s in slugs)
    qs = [q for p in sorted(compiled.glob("*.json")) if p.name not in ("compile-report.json", "review-stamps.json")
          for q in (json.loads(p.read_text()).get("questions") or []) if "lo" in q and in_unit(q["lo"]) and q.get("hold_reason") in HOLDS]
    out, n_ex, n_we = [], {}, 0
    for q in qs:
        m = NOTE_REF.search(q.get("source_note") or "")
        if not m:
            continue
        ref = m.group(1)
        slug = ref.split(":", 1)[0]
        li = slugs.index(slug) + 1
        rec = json.loads((HERE / "book-records" / book / f"{slug}.json").read_text())
        item_id = next((it["id"] for it in rec["items"] if ref == it["id"] or ref.startswith(it["id"] + ":")), None)
        it = next(x for x in rec["items"] if x["id"] == item_id)
        part = next((p for p in it.get("parts") or [] if ref == f"{item_id}:{p['label']}"), None)
        kind = "worked_example" if it["type"] == "worked_example" else "exercise"
        if kind == "worked_example":
            n_we += 1
            stand_in = f"WE{n_we}"
        else:
            n_ex[li] = n_ex.get(li, 0) + 1
            stand_in = f"Ex{li}-1:{n_ex[li]}"
        marker = (q.get("choices") or {}).get("marker") if isinstance(q.get("choices"), dict) else None
        check = C.printed_checks(book, slug).get(ref) or {}
        item = {"ref": stand_in, "kind": kind, "lo": q["lo"], "stem": q["stem"], "tier": q.get("tier") or "standard",
                "answer_type": "numeric" if q["type"] == "numeric" else "expression",
                "answer": q.get("answer"), "marker": marker, "choices": None,
                "solution": [x for x in q.get("solution") or [] if x] or ["(no working printed)"],
                "solution_provenance": "book_worked" if kind == "worked_example" else "answer_anchored",
                "printed_answer": (part or it).get("answer") or it.get("answer"), "blind_answer": check.get("blind"),
                "verification": "disputed", "printed_page": q.get("source_page") or it.get("source_page") or 0,
                "figures": [], **({"typing_problems": [f"the app's marker cannot mark the key {q.get('answer')!r}"]}
                                  if q["hold_reason"] == "unanswerable" else {})}
        out.append({"key": f"{slug}:{stand_in}", "lesson": slug, "ref": stand_in,
                    "state": "excluded" if q["hold_reason"] == "unanswerable" else "held", "item": item,
                    "question": q["id"], "book_ref": ref, "facts": facts_of(q)})
    return out


def collect(book: str, unit: int, es: list[dict], run_file: Path) -> dict:
    import g2_recommend as G  # noqa: PLC0415
    run = json.loads(run_file.read_text())
    rec = G.collect(es, [run], chapter=unit, run_names={"run": str(run_file.relative_to(HERE)) if run_file.is_relative_to(HERE) else str(run_file)})
    by_key = {e["key"]: e for e in es}
    rec["questions"] = {k: {"question": by_key[k]["question"], "book_ref": by_key[k]["book_ref"], "facts": by_key[k]["facts"]}
                        for k in rec["items"] if k in by_key}
    rec["line"] = "book-records (book_record_g2.py)"
    out = out_path(book, unit)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rec, ensure_ascii=False, indent=1) + "\n")
    return rec


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("list", "run", "args", "collect"):
        s = sub.add_parser(name)
        s.add_argument("book")
        s.add_argument("unit", type=int)
        if name == "collect":
            s.add_argument("run_file", type=Path)
        if name in ("run", "args"):
            s.add_argument("--cap", type=float, default=4.0)
    a = ap.parse_args(argv)
    book = book_config.load_book(a.book)
    import ingest  # noqa: PLC0415
    slugs, _t = ingest.unit_lessons(book, ingest.route(book.book), a.unit)
    es = entries(book.book, slugs, HERE / "compiled" / book.book)
    if a.cmd == "list" or not es:
        for e in es:
            print(f"{e['book_ref']}  {e['state']:<8} {e['item']['verification']}  {e['question']}")
        print(f"{len(es)} held book question(s) in unit {a.unit} owe a recommendation", file=sys.stderr)
        return 0
    if a.cmd == "collect":
        rec = collect(book.book, a.unit, es, a.run_file.resolve())
    else:
        import embed_workflow as EW  # noqa: PLC0415
        import g2_recommend as G  # noqa: PLC0415
        import workflow_runner as WR  # noqa: PLC0415
        lmap = json.loads((HERE / "book-records" / book.book / "lessons.json").read_text())
        titles = {l["slug"]: l["title"] for l in lmap["lessons"]}
        args = G.build_args(book, a.unit, es, titles=titles)
        copy = EW.default_out(book.book, "g2-recommend", f"unit{a.unit:02d}.bookrecord")
        print(EW.summary(EW.write(G.WORKFLOW, args, copy)), file=sys.stderr)
        if a.cmd == "args":
            return 0
        run_file, _res, _cost = WR.run_copy(copy, [], a.cap, f"g2r.unit{a.unit:02d}", book.book, "g2", stage="G2R")
        rec = collect(book.book, a.unit, es, run_file)
    r = rec["report"]
    print(f"{r['recommended']} of {r['items']} recommended: {r['by_verdict']}; live: {len(r['live'])}; not live after the checks: "
          f"{len(r['not_live'])} → {out_path(book.book, a.unit).relative_to(HERE)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

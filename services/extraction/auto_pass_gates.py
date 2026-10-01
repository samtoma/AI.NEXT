"""Auto-pass the human gates during the fan-out: the AI checks' recommendation becomes the verdict.

Samuel's answer 37c (2026-10-01): *"Auto-pass, review later"* — during the full-book fan-out the
pipeline proceeds on the AI checks' recommendation at G1–G4, every decision lands in the console's
review backlog (answer 37b), and the AUTOMATIC SAFETY CHECKS STILL BLOCK (broken maths, answers vs
the book, a missing or answer-revealing figure, parity). An auto verdict is signed
"auto-pass G<n> (AI recommendation)" and marked `"auto": true`: the loaders write it to
`ai_checked_by`, NEVER to `reviewed_by` (migration 035, answer 33 — only a human stamp is a review).

Each subcommand writes the verdicts file the gate's own consumer already reads, so nothing
downstream changes shape; a human verdict already in a file is never overwritten.

    uv run auto_pass_gates.py g1 <book> --chapter 8 [--out runs/<book>/objectives/g1-ch08.auto.json]
        every decision G1 owes (objectives/<book>/chNN.check.json `undecided`), answered by the AI
        line's own recommendation: a single-finder objective the evidence check kept → approve; a
        terminology flag → keep; two mappers disagreeing → the placement the pool already uses
        (mapper 1); a backward link the independent checker agreed → approve; an unpractised
        objective or a finder objective with no home → acknowledged; an end-of-chapter item both
        blind mappers placed nowhere → outside the chapter's objectives, with that reason.
        A pipeline failure (links not run / failed, any other rule failure) is NOT auto-passed: it is
        printed and the command exits 1. Then:
          uv run assemble_objectives.py approve <book> --chapter 8 \\
              --by "auto-pass G1 (AI recommendation)" --verdicts <the file>
    uv run auto_pass_gates.py g2 <book> --recommend runs/<book>/g2-ch08.recommended.json \\
              [--into runs/<book>/g2.json]
        every recommended item with no human verdict yet gets the recommendation as an auto verdict
        (`"auto": true`, `"by": "auto-pass G2 (AI recommendation)"`); an item with no recommendation
        gets nothing and stays HELD by the assembly (answer_mismatch / unverified — the "answers vs
        the book" check blocks). Then `assemble_objectives.py lesson-runs … --g2 <file>`, assemble,
        load, and `apply_review_verdicts.py --g2 <file>` exactly as for a human G2 file.
    uv run auto_pass_gates.py g3 --queue seed/generated/<book>/generated-questions.review-queue.json \\
              --queue seed/generated/<book>/widget-questions.review-queue.json --out runs/<book>/g3-ch08.auto.json
        the sampled items accepted on the AI checks (S6's blind grade passed every family in the
        bundle, S7's verifier every template); apply with `apply_review_verdicts.py <file>`, which
        writes ai_checked_by on the sample and its families. The held predicate→misconception claims
        (decision 47) follow the verifier's recommendation: they stay held (inactive) and go to the
        backlog — so there is no `--mapping-review` step.
    uv run auto_pass_gates.py g4 --catalogue seed/generated/<book>/misconceptions.json \\
              --s5 runs/<book>/misconceptions/final-<run>.json --out runs/<book>/g4-ch08.auto.json
        a record only: the catalogue holds exactly the entries S5's verifier kept (the loader already
        refuses anything else); the file lists them, and the dropped ones, for the backlog.

No model is called; every subcommand is deterministic over files the AI stages already wrote.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import book_config
import review_policy

HERE = Path(__file__).resolve().parent
NONE_PLACED = re.compile(r"^distributed item (\S+) maps to no objective \(rule 2\): both mappers said none")
# decisions an auto-pass may take (the AI line's own recommendation exists); anything else blocks
AUTO_KINDS = {"single", "terminology", "mappers_disagree", "link_backward", "unpractised", "finder_dropped"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def g1_verdicts(check: dict) -> tuple[dict, list[str]]:
    """The G1 verdicts file (assemble_objectives.py approve --verdicts) answering every owed decision on
    the AI recommendation, and what blocks an auto-pass (a pipeline failure is never papered over)."""
    by = review_policy.auto_pass_by("G1")
    v: dict = {"auto": True, "by": by, "terminology": {}, "move_items": {}, "links": {}, "acknowledged": [],
               "objectives": {}, "outside_items": {}}
    blocked: list[str] = []
    pool = check.get("pool") or {}
    for f in check.get("failures") or []:
        m = NONE_PLACED.match(f)
        if m:
            v["outside_items"][m.group(1)] = {
                "why": f"{by}: both blind mappers placed it nowhere, so no objective of this chapter practises it"}
        else:
            blocked.append(f"failure: {f}")
    for d in check.get("undecided") or []:
        kind = d.get("kind")
        if kind not in AUTO_KINDS:
            blocked.append(f"{kind}: {d.get('detail')} (key {d.get('key')})")
        elif kind == "single":
            v["objectives"][d["objective"]] = {"action": "approve", "why": f"{by}: the evidence check kept it"}
        elif kind == "terminology":
            v["terminology"][d["key"].split(":", 1)[1]] = "keep"
        elif kind == "mappers_disagree":
            if pool.get(d["item"]):
                v["move_items"][d["item"]] = pool[d["item"]]
            else:
                blocked.append(f"mappers_disagree: {d['item']} has no placement in the pool to keep")
        elif kind == "link_backward":
            v["links"][d["link"]] = "approve"
        else:
            v["acknowledged"].append(d["key"])
    return v, blocked


def g2_merge(recommended: dict, existing: dict | None) -> tuple[dict, dict]:
    """G2's file with every recommended item that has no verdict yet added as an auto verdict. A human
    verdict already there is kept as it is. Returns (file, counts)."""
    by = review_policy.auto_pass_by("G2")
    out = dict(existing or {})
    items = dict(out.get("items") or {})
    if not out.get("by"):
        out["by"], out["auto"] = by, True          # nobody human signed this file: all of it is auto
    added = kept = 0
    for key, r in sorted((recommended.get("items") or {}).items()):
        if key in items:
            kept += 1
            continue
        if (r or {}).get("verdict") not in ("accept", "fix", "hold", "exclude"):
            continue
        entry = {"verdict": r["verdict"], "auto": True, "by": by,
                 "note": f"{by}: " + (r.get("note") or r.get("class") or "")}
        if r.get("fields"):
            entry["fields"] = r["fields"]
        for k in ("samuel_verdict", "stem_fix_by"):
            if r.get(k):
                entry[k] = r[k]
        items[key] = entry
        added += 1
    out["items"] = items
    return out, {"added": added, "kept_human": kept, "recommended": len(recommended.get("items") or {})}


def g3_verdicts(queues: list[dict]) -> dict:
    ids = sorted({q for f in queues for q in f.get("question_ids") or []})
    return {"bundle": ", ".join(f.get("bundle") or "?" for f in queues), "auto": True,
            "reviewer": review_policy.auto_pass_by("G3"), "at": _now(),
            "rule": "answer 37c: S6's blind grade and S7's verifier passed every family and template in the "
                    "bundles; the held claims (decision 47) stay held",
            "verdicts": {q: "accept" for q in ids}}


def g4_record(catalogue: dict, s5: dict) -> dict:
    kept = sorted(m["id"] for m in catalogue.get("misconceptions") or [])
    dropped = sorted({d.get("id") or d.get("entry_id") or json.dumps(d, sort_keys=True)[:80]
                      for r in (s5.get("records") or []) for d in r.get("dropped") or []})
    return {"gate": "G4", "auto": True, "by": review_policy.auto_pass_by("G4"), "at": _now(),
            "rule": "answer 37c: the catalogue is exactly what S5's verifier kept; a record for the backlog",
            "kept": kept, "dropped_by_verifier": dropped}


def _write(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="gate", required=True)
    a1 = sub.add_parser("g1", help="objectives: answer every owed decision on the AI recommendation")
    a1.add_argument("book")
    a1.add_argument("--chapter", type=int, required=True)
    a1.add_argument("--objectives-dir", type=Path)
    a1.add_argument("--out", type=Path)
    a2 = sub.add_parser("g2", help="book questions: the recommendation as auto verdicts")
    a2.add_argument("book")
    a2.add_argument("--recommend", type=Path, required=True)
    a2.add_argument("--into", type=Path, help="G2's file (default runs/<book>/g2.json); human verdicts kept")
    a3 = sub.add_parser("g3", help="generated sample: accepted on the AI checks")
    a3.add_argument("--queue", type=Path, action="append", required=True)
    a3.add_argument("--out", type=Path, required=True)
    a4 = sub.add_parser("g4", help="catalogue: a record of what S5 kept")
    a4.add_argument("--catalogue", type=Path, required=True)
    a4.add_argument("--s5", type=Path, required=True)
    a4.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)

    if a.gate == "g1":
        book = book_config.load_book(a.book)
        odir = a.objectives_dir or HERE / "objectives" / book.book
        check = json.loads((odir / f"ch{a.chapter:02d}.check.json").read_text())
        v, blocked = g1_verdicts(check)
        if blocked:
            print(f"G1 NOT auto-passed for chapter {a.chapter}: {len(blocked)} item(s) need the pipeline fixed "
                  "or a human, not a recommendation:", file=sys.stderr)
            for b in blocked:
                print(f"  BLOCKED {b}", file=sys.stderr)
            return 1
        out = a.out or HERE / "runs" / book.book / "objectives" / f"g1-ch{a.chapter:02d}.auto.json"
        _write(out, v)
        n = (len(v["objectives"]) + len(v["terminology"]) + len(v["move_items"]) + len(v["links"])
             + len(v["acknowledged"]) + len(v["outside_items"]))
        print(f"G1 auto-pass, chapter {a.chapter}: {n} decision(s) on the AI recommendation -> {out}\n"
              f"  next: uv run assemble_objectives.py approve {book.book} --chapter {a.chapter} "
              f"--by \"{review_policy.auto_pass_by('G1')}\" --verdicts {out}")
        return 0
    if a.gate == "g2":
        book = book_config.load_book(a.book)
        into = a.into or HERE / "runs" / book.book / "g2.json"
        existing = json.loads(into.read_text()) if into.exists() else None
        doc, c = g2_merge(json.loads(a.recommend.read_text()), existing)
        _write(into, doc)
        print(f"G2 auto-pass: {c['added']} recommended verdict(s) added as auto, {c['kept_human']} already decided "
              f"(kept), of {c['recommended']} recommended -> {into}. Items with no recommendation stay held.")
        return 0
    if a.gate == "g3":
        doc = g3_verdicts([json.loads(p.read_text()) for p in a.queue])
        _write(a.out, doc)
        print(f"G3 auto-pass: {len(doc['verdicts'])} sampled item(s) accepted on the AI checks -> {a.out}\n"
              f"  next: uv run apply_review_verdicts.py {a.out}   (writes ai_checked_by, never reviewed_by)")
        return 0
    doc = g4_record(json.loads(a.catalogue.read_text()), json.loads(a.s5.read_text()))
    _write(a.out, doc)
    print(f"G4 auto-pass (record): {len(doc['kept'])} catalogue entr(ies) kept by S5, "
          f"{len(doc['dropped_by_verifier'])} dropped by its verifier -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Held generation: the families and widget templates S6 and S7 held, why, and what a person decided.

    uv run book_record_held.py status    prep3-parallel                 # what is held, decided, sent back
    uv run book_record_held.py backfill  prep3-parallel                 # reasons for what was held before the ledger
    uv run book_record_held.py reauthor  prep3-parallel [--dsn …] [--cap 4] [--dry-run]   # the sent-back ones

Decided by Tamer, 2026-10-18. A family or widget template the checks refuse is held (Samuel's convention, FR-1101:
families `teaching/<book>/families/_held--<file>`, templates `teaching/<book>/widgets-held/<file>`): nothing is
generated from it, so no student sees it, but its objective goes without that practice. The review tool's Held
generation task lists each with the check's reasons (teaching/<book>/held.json, written when it is held), and a person
decides (reviews/<book>/held-generation.json, format `ainext.held-review/1`):
  drop       it stays held, decided: the objective does without it (or has enough);
  send_back  it is authored again: `reauthor` runs S6's author (families) or S7's author (templates) for the sent-back
             items' objectives only, the person's note beside the held spec as what to change, then grades or verifies
             the new ones, re-runs the unit's finishing passes and records the run; Refresh (ingest.py refresh) then
             brings the result into the compiled book.
The coverage audit (held_decided) counts every held item a person has not decided, and every one sent back and not yet
authored again.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_config  # noqa: E402

FORMAT = "ainext.held-review/1"
KINDS = ("family", "template")
# held before the ledger, with no line in any log that names why (Tamer, 2026-10-17: held by hand)
KNOWN = {"pp3u1-1-1--solve-then-plot.json": "the verifier confirmed none of its predicate → misconception mappings, so it "
                                            "was held as the runbook holds a template with no confirmed mapping"}


def held_dir(book: str, kind: str) -> Path:
    return HERE / "teaching" / book / ("families" if kind == "family" else "widgets-held")


def held_files(book: str) -> list[tuple[str, str, Path]]:
    """(kind, file name as authored, path) of every held item."""
    out = []
    fd = held_dir(book, "family")
    for p in sorted(fd.glob("_held--*.json")) if fd.is_dir() else []:
        out.append(("family", p.name.removeprefix("_held--"), p))
    td = held_dir(book, "template")
    for p in sorted(td.glob("*.json")) if td.is_dir() else []:
        out.append(("template", p.name, p))
    return out


def fingerprint(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def ledger(book: str) -> dict:
    p = HERE / "teaching" / book / "held.json"
    return json.loads(p.read_text()) if p.exists() else {"format": "ainext.held/1", "book": book, "items": {}}


def decisions_path(book: str) -> Path:
    return HERE / "reviews" / book / "held-generation.json"


def decisions(book: str) -> dict[tuple[str, str], dict]:
    p = decisions_path(book)
    return {(d["kind"], d["file"]): d for d in json.loads(p.read_text()).get("decisions") or []} if p.exists() else {}


def state(book: str) -> list[dict]:
    """Every held item with its reasons and where it stands: open, drop, send_back, reauthored, or changed (the held
    file is not the one decided)."""
    led, dec = ledger(book)["items"], decisions(book)
    rows = []
    for kind, name, p in held_files(book):
        e = led.get(f"{kind}:{name}") or {}
        d = dec.get((kind, name))
        fp = fingerprint(p)
        st = "open" if not d else "changed" if d.get("fingerprint") != fp else (
            "reauthored" if d["decision"] == "send_back" and e.get("reauthored") else d["decision"])
        obj = name.removesuffix(".json").partition("--")[0]
        rows.append({"kind": kind, "file": name, "path": str(p.relative_to(HERE)), "objective": f"lo:{obj}",
                     "lesson": obj.rsplit("-", 1)[0], "reasons": e.get("reasons") or [], "state": st, "fingerprint": fp,
                     "decision": d, "reauthored": e.get("reauthored")})
    return rows


def unit_slugs(book: str, lesson: str) -> list[str]:
    unit = lesson.rsplit("-", 1)[0]
    lmap = json.loads((HERE / "book-records" / book / "lessons.json").read_text())
    return [l["slug"] for l in lmap["lessons"] if l["slug"].rsplit("-", 1)[0] == unit]


def backfill(book: str) -> dict:
    """Reasons for every held item the ledger does not explain: a family is checked again on its own (the S6 check and
    the parent rule, against its unit); a template's reasons come from the fan-out's logs."""
    import book_record_generation as G  # noqa: PLC0415
    led = ledger(book)
    todo = [(k, n, p) for k, n, p in held_files(book) if f"{k}:{n}" not in led["items"]]
    by_unit: dict[str, list] = {}
    for k, n, p in todo:
        by_unit.setdefault(n.partition("--")[0].rsplit("-", 2)[0], []).append((k, n, p))
    logs = "\n".join(f.read_text(errors="replace") for f in sorted((HERE / "runs" / book / "fanout").glob("*.log")))
    done = []
    for _u, items in sorted(by_unit.items()):
        fams = [(n, p) for k, n, p in items if k == "family"]
        if fams:
            slugs = unit_slugs(book, fams[0][0].partition("--")[0].rsplit("-", 1)[0])
            view = G.book_view(book, slugs)
            tmp = HERE / "work" / book / "unit-view" / slugs[0] / "held-check"
            shutil.rmtree(tmp, ignore_errors=True)
            tmp.mkdir(parents=True)
            for n, p in fams:
                shutil.copyfile(p, tmp / n)
            r = subprocess.run(["uv", "run", "generate_questions.py", "--families", str(tmp), "--book", str(view), "--check"],
                               cwd=HERE, text=True, capture_output=True)
            out = r.stdout + r.stderr
            qids = {q["id"] for b in json.loads(view.read_text()).get("bundles") or []
                    for q in json.loads((book_config.REPO_ROOT / b).read_text()).get("questions") or []}
            for n, p in fams:
                parent = json.loads(p.read_text()).get("parent_question_id")
                if parent not in qids:
                    out += f"\n  x {n}: its parent {parent!r} is not a book question of the unit (FR-1101)"
            for n, _p in fams:
                hit = [l for l in out.splitlines() if l.strip().startswith("x ") and (n in l or f"tpl:{n.removesuffix('.json').replace('--', ':')}" in l)]
                if not hit:   # it passes alone: it was held for colliding with a sibling's ids, or the log says why
                    hit = sorted({l for l in logs.splitlines() if l.strip().startswith("x ") and (n in l or n.removesuffix(".json").partition("--")[2] in l and "share an objective" in l)})
                G.record_held(book, "family", n, "\n".join(hit) or "", "S6 check (backfilled)")
                done.append(n)
        for k, n, _p in items:
            if k != "template":
                continue
            hit = sorted({l for l in logs.splitlines() if l.strip().startswith("x ") and n in l})
            G.record_held(book, "template", n, "\n".join(hit) or f"  x {n}: {KNOWN.get(n, 'held by hand at S7')}", "S7 (backfilled)")
            done.append(n)
    return {"backfilled": done}


def decide(book: str, kind: str, name: str, decision: str, by: str, note: str = "") -> dict:
    if kind not in KINDS or decision not in ("drop", "send_back") or not by.strip():
        raise ValueError("needs kind (family, template), a decision (drop, send_back) and your initials")
    row = next((r for r in state(book) if r["kind"] == kind and r["file"] == name), None)
    if row is None:
        raise ValueError(f"no held {kind} {name} in {book}")
    if decision == "send_back" and not note.strip():
        raise ValueError("say what to change (the author reads your note beside the held spec)")
    entry = {"kind": kind, "file": name, "decision": decision, "by": by.strip(), "at": date.today().isoformat(),
             "fingerprint": row["fingerprint"], **({"note": note.strip()} if note.strip() else {})}
    p = decisions_path(book)
    p.parent.mkdir(parents=True, exist_ok=True)
    doc = json.loads(p.read_text()) if p.exists() else {"format": FORMAT, "book": book, "decisions": []}
    doc["decisions"].append(entry)   # append-only: a changed mind is a new entry
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    return entry


def reauthor(book: str, dsn: str | None, cap: float, dry: bool) -> dict:
    """S6's (or S7's) author again, for the sent-back items' objectives only, with the held spec and the person's note
    as what to change; then the unit's grading (or verification) and finishing passes. Each unit at most once a call."""
    import book_record_generation as G  # noqa: PLC0415
    rows = [r for r in state(book) if r["state"] == "send_back"]
    if not rows:
        return {"reauthored": [], "note": "nothing sent back"}
    units: dict[str, list[dict]] = {}
    for r in rows:
        units.setdefault(r["lesson"].rsplit("-", 1)[0], []).append(r)
    plan, ran = [], []
    for u, rs in sorted(units.items()):
        slugs = unit_slugs(book, rs[0]["lesson"])
        plan.append({"unit": u, "lessons": slugs, "families": [r["file"] for r in rs if r["kind"] == "family"],
                     "templates": [r["file"] for r in rs if r["kind"] == "template"]})
    if dry:
        return {"would_reauthor": plan}
    led_p = HERE / "teaching" / book / "held.json"
    for step in plan:
        slugs = step["lessons"]
        objs = sorted({f"lo:{f.partition('--')[0]}" for f in step["families"]})
        if objs:
            notes = {r["file"]: (r["decision"] or {}).get("note") for r in units[step["unit"]] if r["kind"] == "family"}
            run = G.author_again(book, slugs, objs, notes, cap)
            ran.append({"unit": step["unit"], "stage": "S6", "objectives": objs, "run": str(run.relative_to(HERE))})
            G.main(["s6-grade", book, *slugs, "--cap", str(cap)])
        if step["templates"]:
            if not dsn:
                raise SystemExit("a widget template is authored against the unit in a scratch database: pass --dsn")
            cat = G.covering(G.latest(book, "misconceptions", "s5-draft"), slugs)[-1]
            G.main(["s7-author", book, *slugs, "--catalogue", str(cat), "--dsn", dsn, "--cap", str(cap)])
            G.main(["s7-verify", book, *slugs, "--catalogue", str(cat), "--dsn", dsn, "--cap", str(cap)])
            ran.append({"unit": step["unit"], "stage": "S7", "templates": step["templates"]})
        G.finish(book, slugs, dsn)
        led = json.loads(led_p.read_text())
        for f in step["families"]:
            led["items"].setdefault(f"family:{f}", {})["reauthored"] = date.today().isoformat()
        for f in step["templates"]:
            led["items"].setdefault(f"template:{f}", {})["reauthored"] = date.today().isoformat()
        led_p.write_text(json.dumps(led, ensure_ascii=False, indent=1) + "\n")
    return {"reauthored": ran, "next": f"ingest.py refresh {book} (or the review tool's Refresh)"}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("status", "backfill"):
        sub.add_parser(name).add_argument("book")
    r = sub.add_parser("reauthor")
    r.add_argument("book")
    r.add_argument("--dsn")
    r.add_argument("--cap", type=float, default=4.0)
    r.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "status":
        rows = state(a.book)
        for r in rows:
            print(f"{r['state']:<10} {r['kind']:<8} {r['file']}: {'; '.join(r['reasons'])[:140]}")
        from collections import Counter  # noqa: PLC0415
        print(dict(Counter(r["state"] for r in rows)), file=sys.stderr)
        return 0
    res = backfill(a.book) if a.cmd == "backfill" else reauthor(a.book, a.dsn, a.cap, a.dry_run)
    print(json.dumps(res, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

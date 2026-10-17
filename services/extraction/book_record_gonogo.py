"""G5, go / no-go for a book-record unit: Samuel's runbook §8 gate, on what the book-record line writes.

    uv run book_record_gonogo.py report prep3-math-en 1 [--dsn postgres://…]     # write runs/<book>/g5/unit01.md (+ .json)
    uv run book_record_gonogo.py decide prep3-math-en 1 go --by TD [--note …]   # a person's decision, on that report

Samuel's G5 (runbook §8): "the dry-run delta, coverage/<book>.json, the drift check for every course, the review verdicts
and the cost ledger. He decides go or no-go." This puts those in front of the person for one unit:
  - the coverage audit (book_record_coverage.py): GREEN or RED, and whether it is stale;
  - the load preview (book_record_load.py's previews, rolled back) when a database is named: what would change;
  - the review queues still open: Maths reading, Objectives (G1), Generated answers, Question tiers, Misprints;
  - what compile held or left out, the multi-part parts no rule could settle, the G2 recommendations applied;
  - S8's coverage verdicts;
  - the cost ledger by stage (runs/<book>/cost.jsonl, Samuel's meter_run lines), for this book.
It recommends NO-GO when the audit is not GREEN and fresh; everything else is for the person to weigh. Nothing here
decides: `decide` records a person's GO or NO-GO in reviews/<book>/g5-unit<NN>.json with the report's fingerprint, and
book_record_load.py --go refuses a unit without a GO on the report as it stands now. A GO for one unit is not for another.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_config  # noqa: E402


def g5_path(book: str, unit: int) -> Path:
    return HERE / "reviews" / book / f"g5-unit{unit:02d}.json"


def report_path(book: str, unit: int) -> Path:
    return HERE / "runs" / book / "g5" / f"unit{unit:02d}.json"


def open_queues(book: str, slugs: list[str]) -> dict[str, int]:
    sys.path.insert(0, str(HERE / "groundtruth" / "review"))
    out = {}
    in_unit = lambda lesson: lesson in slugs or any(str(lesson).startswith(s) for s in slugs)
    for name, mod in (("Maths reading", "maths_reading"), ("Question tiers", "tiers"),
                      ("Generated answers", "answers"), ("Objectives (G1)", "objectives")):
        try:
            m = __import__(mod)
            rows = m.summary(book) if book in m.books() else []
        except (FileNotFoundError, ImportError, KeyError, ValueError):
            rows = []
        out[name] = sum(1 for r in rows if r.get("state") in ("open", "changed") and (name == "Objectives (G1)" or in_unit(r.get("lesson"))))
    dfile = HERE / "groundtruth" / book / "misprint-decisions.json"
    decided = {d["ref"] for d in json.loads(dfile.read_text()).get("decisions") or []} if dfile.exists() else set()
    refs = []
    for s in slugs:
        f = HERE / "book-records" / book / f"{s}.json"
        if f.exists():
            for it in json.loads(f.read_text())["items"]:
                refs += [f"{it['id']}#{m.get('field')}" for m in it.get("misprints") or []]
                refs += [f"{it['id']}:{p['label']}#{m.get('field')}" for p in it.get("parts") or [] for m in p.get("misprints") or []]
    cf = HERE / "book-records" / book / "misprint-candidates.json"
    if cf.exists():
        refs += [x["ref"] for x in json.loads(cf.read_text()).get("candidates") or [] if x.get("lesson") in slugs]
    out["Misprints"] = sum(1 for r in refs if r not in decided)
    return out


def cost_by_stage(book: str) -> dict[str, float]:
    f = HERE / "runs" / book / "cost.jsonl"
    out: dict[str, float] = defaultdict(float)
    for line in f.read_text().splitlines() if f.exists() else []:
        d = json.loads(line)
        out[d.get("stage") or "?"] += float((d.get("totals") or {}).get("usd") or 0)
    return {k: round(v, 2) for k, v in sorted(out.items())}


def build(book_name: str, unit: int, dsn: str | None) -> dict:
    import book_record_coverage as COV  # noqa: PLC0415
    import book_record_load as L  # noqa: PLC0415
    import ingest  # noqa: PLC0415
    book = book_config.load_book(book_name)
    slugs, title = ingest.unit_lessons(book, ingest.route(book.book), unit)
    compiled = HERE / "compiled" / book.book
    ok, cov_why = L.audit_ok(book.book, unit, compiled)
    covf = HERE / "coverage" / f"{book.book}.unit{unit:02d}.book-records.json"
    cov = json.loads(covf.read_text()) if covf.exists() else {}
    crep = json.loads((compiled / "compile-report.json").read_text()) if (compiled / "compile-report.json").exists() else {}
    s8f = HERE / "runs" / book.book / "coverage" / "s8-summary.json"
    s8 = {k: v.get("verdict") for k, v in json.loads(s8f.read_text()).items() if k in slugs} if s8f.exists() else {}
    preview = None
    if dsn and ok:
        import io  # noqa: PLC0415
        import contextlib  # noqa: PLC0415
        buf = io.StringIO()
        try:
            with contextlib.redirect_stderr(buf):
                L.main([book.book, str(unit), "--dsn", dsn])
            preview = {"passed": True, "lines": [x.strip() for x in buf.getvalue().splitlines() if "->" in x or "unchanged" in x or "would load" in x][:20]}
        except SystemExit as e:
            preview = {"passed": False, "why": str(e), "lines": buf.getvalue().splitlines()[-8:]}
    queues = open_queues(book.book, slugs)
    reasons = [] if ok else [cov_why]
    if preview and not preview["passed"]:
        reasons.append(f"the load preview failed: {preview['why']}")
    rep = {"format": "ainext.g5-report/1", "book": book.book, "course_id": book.course_id, "unit": unit, "title": title, "lessons": slugs,
           "made": date.today().isoformat(),
           "recommendation": "NO-GO" if reasons else "GO is possible: weigh the rest",
           "why": reasons,
           "coverage": {"status": cov.get("status"), "fresh_and_green": ok, "detail": cov_why,
                        "failing": [{"check": c["id"], "want": c["want"], "got": c["got"], "first": c["failures"][:3]}
                                    for c in cov.get("checks") or [] if c["state"] == "fails"],
                        "excepted": [c["id"] for c in cov.get("checks") or [] if c["state"] == "excepted"]},
           "load_preview": preview or {"skipped": "no database named, or the audit is not GREEN"},
           "open_reviews": queues,
           "compile": {"held": len(crep.get("held") or []), "left_out": len([x for x in crep.get("skipped") or [] if x.get("lesson") in slugs]),
                       "multipart_unresolved": len((crep.get("multipart") or {}).get("unresolved") or []),
                       "g2_applied": [g for g in crep.get("g2") or [] if g.get("applied")]},
           "s8": s8, "cost_usd_by_stage": cost_by_stage(book.book)}
    rep["fingerprint"] = hashlib.sha256(json.dumps({k: rep[k] for k in ("coverage", "open_reviews", "compile", "s8")}, sort_keys=True)
                                        .encode() + json.dumps(cov.get("inputs") or {}, sort_keys=True).encode()).hexdigest()[:16]
    return rep


def markdown(r: dict) -> str:
    L = [f"# G5, go / no-go: {r['book']} unit {r['unit']} ({r['title']})", "",
         f"**Recommendation: {r['recommendation']}**" + ("" if not r["why"] else " — " + "; ".join(r["why"])), "",
         f"Lessons: {', '.join(r['lessons'])}. Made {r['made']}. Fingerprint `{r['fingerprint']}` (a decision is on this report).", "",
         "## Coverage audit", f"{r['coverage']['detail']}"]
    for f in r["coverage"]["failing"]:
        L.append(f"- **{f['check']}**: want {f['want']}, got {f['got']}" + "".join(f"\n  - {x['scope']}: {x['detail']}" for x in f["first"]))
    L += ["", "## Load preview (rolled back)"]
    lp = r["load_preview"]
    L += [f"- {x}" for x in lp.get("lines", [])] or [f"- {lp.get('skipped') or lp.get('why')}"]
    L += ["", "## Reviews still open"] + [f"- {k}: {v}" for k, v in r["open_reviews"].items()]
    c = r["compile"]
    L += ["", "## What compile held or left out",
          f"- held: {c['held']}; left out with a reason: {c['left_out']}; multi-part parts no rule settled: {c['multipart_unresolved']}",
          f"- G2 recommendations applied: {len(c['g2_applied'])}"]
    L += ["", "## S8 coverage"] + [f"- {k}: {v}" for k, v in r["s8"].items()] or ["- not run"]
    L += ["", "## Cost so far, this book (USD, by stage)"] + [f"- {k}: {v}" for k, v in r["cost_usd_by_stage"].items()]
    L += ["", "Decide: `uv run book_record_gonogo.py decide <book> <unit> go|no-go --by <initials>`"]
    return "\n".join(L) + "\n"


def current_go(book: str, unit: int) -> tuple[bool, str]:
    """Is there a person's GO on the report as it stands now? (book_record_load.py --go asks.)"""
    f = g5_path(book, unit)
    if not f.exists():
        return False, f"no G5 decision: book_record_gonogo.py report {book} {unit}, then decide"
    last = json.loads(f.read_text())["decisions"][-1]
    if last["decision"] != "go":
        return False, f"G5 says NO-GO ({last['by']}, {last['at']})"
    now = build(book, unit, None)["fingerprint"]
    if now != last["fingerprint"]:
        return False, "the unit changed since G5's GO (its report's fingerprint differs): report and decide again"
    return True, f"G5 GO by {last['by']} on {last['at']}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("report")
    r.add_argument("book")
    r.add_argument("unit", type=int)
    r.add_argument("--dsn")
    d = sub.add_parser("decide")
    d.add_argument("book")
    d.add_argument("unit", type=int)
    d.add_argument("decision", choices=("go", "no-go"))
    d.add_argument("--by", required=True)
    d.add_argument("--note")
    a = ap.parse_args(argv)
    if a.cmd == "report":
        rep = build(a.book, a.unit, a.dsn)
        out = report_path(a.book, a.unit)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(rep, ensure_ascii=False, indent=1) + "\n")
        out.with_suffix(".md").write_text(markdown(rep))
        print(markdown(rep))
        print(f"wrote {out.relative_to(HERE)} and .md", file=sys.stderr)
        return 0
    rep = build(a.book, a.unit, None)
    if a.decision == "go" and rep["recommendation"] == "NO-GO":
        raise SystemExit("a GO on a unit whose audit is not GREEN and fresh is refused: " + "; ".join(rep["why"]))
    f = g5_path(a.book, a.unit)
    f.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(f.read_text()) if f.exists() else {"format": "ainext.g5-decisions/1", "book": a.book, "unit": a.unit, "decisions": []}
    data["decisions"].append({"decision": a.decision, "by": a.by, "at": date.today().isoformat(), "fingerprint": rep["fingerprint"],
                              **({"note": a.note} if a.note else {})})
    f.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"G5 {a.decision.upper()} recorded for {a.book} unit {a.unit} by {a.by}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

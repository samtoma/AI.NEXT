"""Carry the live course's misconceptions and widget templates into a book-record book, as candidates.

    uv run book_record_carryover.py map     prep3-parallel prep3-math-en      # the objective map (no model)
    uv run book_record_carryover.py prepare prep3-parallel prep3-math-en      # the candidate files (no model)
    uv run book_record_carryover.py status  prep3-parallel

Decided by Tamer, 2026-10-18: "build the carry-over of the live course's misconceptions, widgets and visuals as
candidates through the new pipeline's checks"; the visuals withdrawn the same day ("I don't want to carry visuals
from live course"). The live Prep-3 course (prep3-math-en) is the same printed book, and its
catalogue (103 misconceptions) and its 48 widget templates (Samuel's, in generate_widget_questions.py) were authored
for it. A book-record book of the same book derives far fewer of each (S5 only keeps what this book evidences; S7 only
adapts kinds, and its widgets need S5's misconceptions). None
is copied in as it stands: each goes where the new pipeline already checks its own, and is kept only if it passes.

  map         every live objective to one objective of the new book: the lessons line up one to one (the book's
              own lesson order; books/<live>.json units to the new lesson map's), and within a lesson the objective
              whose label and description share the most words. Written to teaching/<book>/carryover/objective-map.json
              with each match's score; a weak one is flagged, never dropped.
  prepare     misconceptions → teaching/<book>/carryover/misconceptions.json, as S5 draft entries on the new
              objectives (their question mappings left behind: they named the live course's questions). S5's FINAL
              pass reads them added to the unit's own draft (`run`: runs/<book>/misconceptions/s5-draft-carried.*) and its verifier
              keeps only those it can ground in this book's evidence, as it does its own.
              widget templates → teaching/<book>/widgets/<objective>--live-<family>.json, as S7 writes its own: the
              objective and misconceptions renamed, the parent a book question of the new objective. S7's blind
              verifier and generate_widget_questions.py's checks decide each (a mapping whose misconception S5 did
              not keep is refused, as for S7's own).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))

# the live course's units, in book order, to the new book's units (prep3-parallel: Units 1–10)
LIVE_UNITS = ["u1", "u2", "u3", "u4", "u5", "t2u1", "t2u2", "t2u3", "geo1", "geo2"]
STOP = set("a an the of to and or in on for with by from is are as its their this that be find use using".split())


def words(t: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", str(t or "").lower()) if w not in STOP and len(w) > 2}


def live_bundles(live: str) -> list[dict]:
    return [json.loads((REPO / p).read_text()) for p in json.loads((HERE / "books" / f"{live}.json").read_text())["bundles"]]


def new_bundles(book: str) -> list[dict]:
    docs = [json.loads(f.read_text()) for f in sorted((HERE / "compiled" / book).glob("*.json"))]
    return [d for d in docs if isinstance(d, dict) and "nodes" in d]


def los(bundles: list[dict]) -> dict[str, dict]:
    return {n["id"]: n for b in bundles for n in b.get("nodes") or [] if n.get("kind") == "learning_objective"}


def lesson_of(lo: str) -> str:
    return lo.removeprefix("lo:").rsplit("-", 1)[0]


def objective_map(book: str, live: str) -> dict:
    lmap = json.loads((HERE / "book-records" / book / "lessons.json").read_text())
    new_lessons = [l["slug"] for l in lmap["lessons"]]
    by_unit: dict[int, list[str]] = {}
    for s in new_lessons:
        by_unit.setdefault(int(re.search(r"u(\d+)-", s).group(1)), []).append(s)
    old, new = los(live_bundles(live)), los(new_bundles(book))
    old_lessons: dict[str, list[str]] = {}
    for lo in old:
        old_lessons.setdefault(lesson_of(lo), []).append(lo)
    lesson_pairs = {}
    for k, lu in enumerate(LIVE_UNITS, start=1):
        ol = sorted({l for l in old_lessons if re.fullmatch(rf"{lu}-\d+", l)}, key=lambda s: int(s.rsplit("-", 1)[1]))
        nl = by_unit.get(k, [])
        for a, b in zip(ol, nl):
            lesson_pairs[a] = b
    out, scores = {}, []
    for lo, n in sorted(old.items()):
        nl = lesson_pairs.get(lesson_of(lo))
        cands = [x for x in new if lesson_of(x) == nl]
        if not cands:
            out[lo] = {"to": None, "score": 0, "why": "no lesson of the new book lines up with this one"}
            continue
        w = words(f"{n.get('label')} {n.get('description')}")
        best = max(cands, key=lambda c: (len(w & words(f"{new[c].get('label')} {new[c].get('description')}"))
                                         / (len(w | words(f"{new[c].get('label')} {new[c].get('description')}")) or 1), c))
        bw = words(f"{new[best].get('label')} {new[best].get('description')}")
        sc = round(len(w & bw) / (len(w | bw) or 1), 3)
        scores.append(sc)
        out[lo] = {"to": best, "score": sc, "lesson": f"{lesson_of(lo)} → {nl}", "from_label": n.get("label"),
                   "to_label": new[best].get("label"), **({"weak": True} if sc < 0.12 else {})}
    doc = {"format": "ainext.carryover-map/1", "book": book, "from": live, "lessons": lesson_pairs, "objectives": out,
           "note": "lessons paired in book order per unit; within a lesson, the objective sharing the most words (Jaccard)"}
    p = HERE / "teaching" / book / "carryover" / "objective-map.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    return doc


def _slug(mc_id: str) -> str:
    return mc_id.split(":")[-1]


def prepare(book: str, live: str) -> dict:
    import generate_widget_questions as GW  # noqa: PLC0415  (Samuel's 48 hand-written templates)
    m = json.loads((HERE / "teaching" / book / "carryover" / "objective-map.json").read_text())["objectives"]
    to = lambda lo: (m.get(lo) or {}).get("to")
    out_dir = HERE / "teaching" / book / "carryover"
    report = Counter()
    # misconceptions: S5 draft entries on the new objectives
    live_mc = json.loads((REPO / json.loads((HERE / "books" / f"{live}.json").read_text())["generated"]["misconceptions"]).read_text())["misconceptions"]
    mc_rename, entries = {}, []
    for mc in live_mc:
        lo = to(mc.get("lo_id"))
        if not lo:
            report["misconceptions without an objective"] += 1
            continue
        nid = f"mc:{lo.removeprefix('lo:')}:{_slug(mc['id'])}"
        mc_rename[mc["id"]] = nid
        entries.append({"id": nid, "lo_id": lo, "label": mc.get("label"), "description": mc.get("description"),
                        "signal": mc.get("signal"), "kind": mc.get("kind") or "conceptual", "refutation": mc.get("refutation") or [],
                        "carried_from": mc["id"]})
    (out_dir / "misconceptions.json").write_text(json.dumps({"format": "ainext.carryover-misconceptions/1", "book": book,
                                                             "from": live, "entries": entries}, ensure_ascii=False, indent=1) + "\n")
    report["misconceptions carried"] = len(entries)
    # widget templates: S7's own format, on the new objectives
    qs_by_lo: dict[str, list[dict]] = {}
    for b in new_bundles(book):
        for q in b.get("questions") or []:
            if not q.get("hold_reason"):
                qs_by_lo.setdefault(q["lo"], []).append(q)
    wdir = HERE / "teaching" / book / "widgets"
    wdir.mkdir(parents=True, exist_ok=True)
    seen: Counter = Counter()
    provenance: dict[str, dict] = {}   # the template schema takes no extra keys: where each came from is kept here
    for t in GW.TEMPLATES:
        lo = to(t.lo)
        if not lo:
            report["templates without an objective"] += 1
            continue
        pool = qs_by_lo.get(lo) or []   # the objective's own anchor book question (FR-1101, §3.10), never a neighbour's
        if not pool:
            report["templates whose objective has no book question to anchor on"] += 1
            continue
        parent = next((q for q in pool if q.get("tier") == t.tier), pool[0])
        diags = [{"predicate": p, "misconception_id": mc_rename[mc]} for p, mc in t.diagnostics if mc in mc_rename]
        # one family has a template per tier (and may repeat one): each its own file and id
        base = f"live-{t.family}-{t.tier}"
        seen[(lo, base)] += 1
        tail = base if seen[(lo, base)] == 1 else f"{base}-{seen[(lo, base)]}"
        name = f"{lo.removeprefix('lo:')}--{tail}.json"
        doc = {"format": "ainext.widget-template/1", "id": f"wt:{lo.removeprefix('lo:')}:{tail}", "lo_id": lo,
               "parent_question_id": parent["id"], "tier": t.tier, "kind": t.kind, "spec": t.spec, "stem": t.stem,
               "solution": t.solution, "diagnostics": diags}
        provenance[doc["id"]] = {"from": f"{t.lo} {t.family} ({t.tier})", "file": name}
        if not (wdir / name).exists():
            (wdir / name).write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
            report["templates carried"] += 1
        else:
            report["templates already carried"] += 1
    (out_dir / "templates.json").write_text(json.dumps({"format": "ainext.carryover-templates/1", "book": book, "from": live,
                                                         "templates": provenance}, ensure_ascii=False, indent=1) + "\n")
    return dict(report)


def merged_draft(book: str, slugs: list[str]) -> Path:
    """The unit's own S5 draft with the carried misconceptions of its objectives added (S5's final pass verifies both)."""
    import book_record_generation as G  # noqa: PLC0415
    draft = G.covering(G.latest(book, "misconceptions", "s5-draft"), slugs)[-1]
    d = json.loads(draft.read_text())
    carried = json.loads((HERE / "teaching" / book / "carryover" / "misconceptions.json").read_text())["entries"]
    mine = [e for e in carried if lesson_of(e["lo_id"]) in slugs]
    recs = {r["lo"]: r for r in d["records"]}
    for e in mine:
        r = recs.get(e["lo_id"])
        if r is None:
            r = recs[e["lo_id"]] = {"lo": e["lo_id"], "entries": [], "dropped": [], "stripped": [], "flags": [], "notes": []}
            d["records"].append(r)
        if e["id"] not in {x["id"] for x in r["entries"]}:
            r["entries"].append({k: v for k, v in e.items() if k != "carried_from"})
    d["carried_from_live"] = len(mine)
    out = HERE / "runs" / book / "misconceptions" / f"s5-draft-carried.{slugs[0]}.json"
    out.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n")
    return out


def run_unit(book: str, slugs: list[str], dsn: str, cap: float) -> dict:
    """The carried candidates through the unit's own checks: S7's blind verifier on its templates (carried ones
    included), their mappings offered to S5, S5's final pass on the draft with the carried misconceptions, then
    Samuel's finishing passes. Paid: the verifier and S5's final pass."""
    import subprocess  # noqa: PLC0415
    import book_record_generation as G  # noqa: PLC0415
    draft = merged_draft(book, slugs)
    U = lambda *a: subprocess.run(["uv", "run", "book_record_generation.py", *a], cwd=HERE, text=True, capture_output=True)
    res = {"lessons": slugs, "draft": str(draft.relative_to(HERE))}
    dist = HERE / "runs" / book / "widgets" / "s5-distractors.json"
    dist.write_text(json.dumps({"distractors": []}) + "\n")   # this unit's offers only
    if any(G.unit_dir(book, G.widgets_dir(book), slugs, "widgets").glob("*.json")):
        r = U("s7-verify", book, *slugs, "--catalogue", str(draft), "--dsn", dsn, "--cap", str(cap))
        res["s7_verify"] = r.returncode
        if r.returncode:
            res["error"] = (r.stdout + r.stderr)[-800:]
            return res
    r = U("s5", book, *slugs, "--stage", "final", "--draft", str(draft), "--distractors", str(dist), "--cap", str(cap))
    if r.returncode:
        res["error"] = (r.stdout + r.stderr)[-800:]
        return res
    res["s5_final"] = [l for l in r.stderr.splitlines() if "S5 final:" in l][-1:]
    G.finish(book, slugs, dsn)
    return res


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("map", "prepare"):
        s = sub.add_parser(name)
        s.add_argument("book")
        s.add_argument("live")
    r = sub.add_parser("run")
    r.add_argument("book")
    r.add_argument("units", type=int, nargs="+")
    r.add_argument("--dsn", required=True)
    r.add_argument("--cap", type=float, default=4.0)
    a = ap.parse_args(argv)
    if a.cmd == "run":
        lmap = json.loads((HERE / "book-records" / a.book / "lessons.json").read_text())
        for u in a.units:
            slugs = [l["slug"] for l in lmap["lessons"] if re.fullmatch(rf"pp3u{u}-\d+", l["slug"])]
            print(json.dumps({"unit": u, **run_unit(a.book, slugs, a.dsn, a.cap)}, ensure_ascii=False), flush=True)
        return 0
    if a.cmd == "map":
        d = objective_map(a.book, a.live)
        o = d["objectives"]
        print(f"{len(o)} live objectives: {sum(1 for x in o.values() if x['to'])} mapped, "
              f"{sum(1 for x in o.values() if x.get('weak'))} weak, {sum(1 for x in o.values() if not x['to'])} unmapped", file=sys.stderr)
    else:
        print(json.dumps(prepare(a.book, a.live), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

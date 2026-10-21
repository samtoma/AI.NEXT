"""Prerequisite links into earlier units: Samuel's S1 linker and link checker, alone, after G1.

    uv run book_record_links.py run    prep3-parallel 2 [3 …] [--cap 2]    # the linker and checker, then accept
    uv run book_record_links.py args   prep3-parallel 2                    # the embedded copy, for Claude Code
    uv run book_record_links.py accept prep3-parallel 2 runs/<book>/links/<saved return>.json
    uv run book_record_links.py apply  prep3-parallel [2 …] [--dry-run]    # the links G1 kept → teaching/<book>/links/

Decided by Tamer, 2026-10-18: "fix S1 to pass earlier units' approved objectives, run Sam's linker and checker only for
units 2 to 10, and put the new links in the Objectives (G1) task". Samuel's S1 (runbook/objectives.workflow.js) gives
its linker `prior_objectives`, the earlier chapters' objectives approved at G1, as the only other ids a link may start
at. book_record_objectives.py passed none, so every unit's links stayed inside the unit (it passes them now, for a unit
run from here on). For units already through G1, runbook/links.workflow.js runs his linker and his checker only, his
prompts word for word, on the unit's approved objectives with every earlier unit's as prior ones. Each return is
judged by his own deterministic checks (assemble_objectives.evaluate_links: evidence at its anchor in the dependent
objective's lesson, the checker's CONFIRMED, no duplicate, a backward link flagged, no cycle), and only links that
START in an earlier unit are kept here (the unit's own links went through G1 already). They are written to
teaching/<book>/cross-links/ch<NN>.json and shown in the review tool's Objectives (G1) task as links; `apply` adds the
ones a person kept to teaching/<book>/links/ch<NN>.json, which compile turns into `prerequisite_of` edges (Refresh).

THE DEFAULT (Tamer, 2026-10-21: today's changes run in the pipeline by default and replace Samuel's workflows): the
ingest plan runs this with --cross (S1X), and S1 no longer gives its own linker the earlier units' objectives
(book_record_objectives.s1_args), so every link into an earlier unit comes from the cross-unit linker below.
CROSS (links-v2-cross, Tamer 2026-10-21): `run … --cross` / `args … --cross` run runbook/links-cross.workflow.js instead,
a variant that looks ONLY for links into earlier units, makes every link quote the step it rests on and name the earlier
result, and gives the checker a removal test (could the step stand without it?). Samuel's links.workflow.js is
unchanged. `accept` then also drops, with the reason kept for review:
  * a link the approved graph already implies (A -> C when A -> … -> C is there: only the most direct is kept);
  * a link already decided — approved in teaching/<book>/links/, or proposed before in cross-links/;
  * all but the 3 best-evidenced links into one objective (more says the run was too loose);
and MERGES its links into cross-links/ch<NN>.json beside the earlier proposals (and their G1 decisions), never over them.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_config  # noqa: E402

FORMAT = "ainext.cross-links/1"
CROSS_WORKFLOW = "links-cross.workflow.js"
CROSS_CAP = 3            # cross-unit links into one objective
SIGNAL_RANK = {"recall": 0, "reference": 1, "uses_method": 2}


def has_cross_run(book: str, unit: int) -> bool:
    """Has the cross-unit linker (links-v2-cross) run for this unit? What ingest.py checks before it runs it."""
    p = out_path(book, unit)
    return p.exists() and any("xlinks-" in r for r in (json.loads(p.read_text()).get("runs") or []))


def approved_graph(book: str) -> set[tuple[str, str]]:
    """Every prerequisite link a person has approved for the book: each unit's own (G1) and the cross-unit ones applied."""
    out = set()
    for f in (HERE / "teaching" / book / "links").glob("ch*.json"):
        out |= {(k["src"], k["dst"]) for k in json.loads(f.read_text()).get("links") or []}
    return out


def implied(edges: set[tuple[str, str]], src: str, dst: str) -> bool:
    """Is there a path src -> … -> dst of two or more links, not using the link src -> dst itself?"""
    nxt: dict[str, set[str]] = {}
    for a, b in edges:
        if (a, b) != (src, dst):
            nxt.setdefault(a, set()).add(b)
    seen, todo = set(), [b for b in nxt.get(src, ()) if b != dst]
    while todo:
        n = todo.pop()
        if n == dst:
            return True
        if n in seen:
            continue
        seen.add(n)
        todo += list(nxt.get(n, ()))
    return False


def cross_filters(kept: list[dict], decided: set[tuple[str, str]], approved: set[tuple[str, str]]) -> tuple[list[dict], list[dict]]:
    """The v2 filters, in order: already decided, implied by the approved graph (with the run's other links), then the
    cap per objective. Pure: returns (kept, dropped-with-why)."""
    out, dropped = [], []
    for k in kept:
        if (k["src"], k["dst"]) in decided:
            dropped.append({**k, "why": "already decided: approved, or proposed before for G1"})
        else:
            out.append(k)
    graph = approved | {(k["src"], k["dst"]) for k in out}
    keep2 = []
    for k in out:
        if implied(graph, k["src"], k["dst"]):
            dropped.append({**k, "why": "implied: the approved links already lead from its source to its objective"})
            graph.discard((k["src"], k["dst"]))
        else:
            keep2.append(k)
    by_dst: dict[str, list[dict]] = {}
    for k in keep2:
        by_dst.setdefault(k["dst"], []).append(k)
    final = []
    for dst, ks in by_dst.items():
        ks.sort(key=lambda k: (SIGNAL_RANK.get(k.get("signal"), 9), -len(k.get("evidence") or [])))
        final += ks[:CROSS_CAP]
        dropped += [{**k, "why": f"over the cap of {CROSS_CAP} cross-unit links into {dst}"} for k in ks[CROSS_CAP:]]
    return final, dropped


def approved(book: str, slug: str) -> list[dict]:
    """A lesson's objectives as G1 approved them, with their app ids (lo:<slug>-<n>) and statements."""
    rec = json.loads((HERE / "book-records" / book / f"{slug}.json").read_text())
    return [{"id": f"lo:{slug}-{o.get('order_in_parent') or k}", "statement": o.get("description") or o.get("label") or "",
             "lesson": slug} for k, o in enumerate(rec.get("learning_objectives") or [], start=1)]


def unit_slugs(book: str, unit: int) -> list[str]:
    import ingest  # noqa: PLC0415
    b = book_config.load_book(book)
    return ingest.unit_lessons(b, ingest.route(book), unit)[0]


def prior_objectives(book: str, unit: int) -> list[dict]:
    """Every earlier unit's approved objectives, in book order (those past G1)."""
    out = []
    for u in range(1, unit):
        if (HERE / "teaching" / book / "links" / f"ch{u:02d}.json").exists():
            for s in unit_slugs(book, u):
                out += approved(book, s)
    return out


def build_args(book: str, unit: int) -> dict:
    import book_record_objectives as BO  # noqa: PLC0415
    slugs = unit_slugs(book, unit)
    s1 = BO.s1_args(book, unit, slugs)
    return {"stage": "S1-links", "book": s1["book"], "chapter": s1["chapter"],
            "objectives": {s: approved(book, s) for s in slugs}, "prior_objectives": prior_objectives(book, unit)}


def out_path(book: str, unit: int) -> Path:
    return HERE / "teaching" / book / "cross-links" / f"ch{unit:02d}.json"


def accept(book: str, unit: int, run_file: Path) -> dict:
    """Samuel's link checks on the return; the links from an earlier unit go to the Objectives (G1) task."""
    import assemble_objectives as AO  # noqa: PLC0415
    import book_record_objectives as BO  # noqa: PLC0415
    run = json.loads(run_file.read_text())
    if run.get("stage") != "S1-links":
        raise SystemExit(f"{run_file} is not a links return")
    args = build_args(book, unit)
    ids = {o["id"]: o["id"] for objs in args["objectives"].values() for o in objs}
    ev = AO.evaluate_links(args["chapter"], run, ids, args["prior_objectives"], {})
    we = {w["anchor"]: w["record_id"] for l in args["chapter"]["lessons"] for w in l["worked_examples"] if w.get("record_id")}
    ev = BO.book_ids({"links": ev}, we)["links"]
    mine = {o["id"] for objs in args["objectives"].values() for o in objs}
    statement = {o["id"]: o["statement"] for o in args["prior_objectives"]} | {o["id"]: o["statement"] for objs in args["objectives"].values() for o in objs}
    fp = lambda x: hashlib.md5(json.dumps(x, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    cross = lambda k: k.get("src") not in mine
    kept = [{**k, "cross": True, "src_statement": statement.get(k["src"]), "dst_statement": statement.get(k["dst"]),
             "fingerprint": fp({x: k.get(x) for x in ("src", "dst", "signal", "evidence")})} for k in ev["kept"] if cross(k)]
    dropped = [{"key": d.get("key"), "src": d.get("src"), "dst": d.get("dst"), "why": d.get("dropped"), "check": d.get("check"),
                "cross": True} for d in ev["dropped"] if d.get("src") not in mine]
    v2 = run.get("workflow") == "links-cross"
    p = out_path(book, unit)
    before = json.loads(p.read_text()) if p.exists() else None
    if v2:
        # the step and the earlier result each link names, for the person who reviews it
        reasons = {(x.get("src"), x.get("dst")): x.get("reason") for x in (run.get("links") or {}).get("proposed") or []}
        for k in kept:
            k["reason"] = reasons.get((k["src"], k["dst"]))
        decided = approved_graph(book) | {(k["src"], k["dst"]) for k in (before or {}).get("links") or []}
        kept, filtered = cross_filters(kept, decided, approved_graph(book))
        dropped += [{"key": k["key"], "src": k["src"], "dst": k["dst"], "why": k["why"], "check": k.get("check"), "cross": True}
                    for k in filtered]
    if v2 and before:
        # beside the earlier proposals and their G1 decisions, never over them
        old = [{**o, "run": o.get("run") or before.get("run")} for o in before.get("links") or []]
        kept = old + [k for k in kept if k["key"] not in {o["key"] for o in old}]
        dropped = (before.get("links_dropped") or []) + dropped
        ev["decisions"] = (before.get("decisions") or []) + (ev.get("decisions") or [])
    run_ref = str(run_file.relative_to(HERE)) if run_file.is_relative_to(HERE) else str(run_file)
    for k in kept:
        k.setdefault("run", run_ref)   # which run proposed each link: v1 and v2 links can sit in one file
    doc = {"format": FORMAT, "book": book, "chapter": unit, "run": run_ref,
           "runs": sorted({*((before or {}).get("runs") or ([before["run"]] if before else [])), run_ref}),
           "prompts_version": run.get("prompts_version"), "prior_objectives": len(args["prior_objectives"]),
           "links": kept, "links_dropped": dropped, "inside_unit_found": sum(1 for k in ev["kept"] if not cross(k)),
           "outside_book": ev.get("outside_book") or [], "failures": ev.get("failures") or [],
           "decisions": [d for d in ev.get("decisions") or [] if d.get("kind") == "link_backward"], "made": date.today().isoformat()}
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    return {"unit": unit, "proposed": ev.get("proposed"), "kept_cross": len(kept), "dropped_cross": len(dropped),
            "new_for_review": sum(1 for k in kept if k.get("run") == run_ref),
            "inside_unit_found": doc["inside_unit_found"], "failures": doc["failures"]}


def run(book: str, unit: int, cap: float, cross: bool = False) -> dict:
    import embed_workflow as EW  # noqa: PLC0415
    import workflow_runner as WR  # noqa: PLC0415
    args = build_args(book, unit)
    if not args["prior_objectives"]:
        return {"unit": unit, "skipped": "no earlier unit is past G1: nothing a link could start at"}
    name = "xlinks" if cross else "links"
    copy = EW.default_out(book, name, f"ch{unit:02d}")
    print(EW.summary(EW.write(HERE / "runbook" / (CROSS_WORKFLOW if cross else "links.workflow.js"), args, copy)), file=sys.stderr)
    run_file, _res, _cost = WR.run_copy(copy, [], cap, f"{name}-ch{unit:02d}", book, "links", stage="S1")
    return accept(book, unit, run_file)


def apply(book: str, units: list[int], dry: bool) -> dict:
    """The cross-unit links a person kept at G1 (Objectives task, decision `keep`, on the link as listed) into
    teaching/<book>/links/ch<NN>.json, beside the unit's own; a link dropped, or not yet decided, is not written."""
    import book_record_objectives as BO  # noqa: PLC0415
    dec = BO.g1_decisions(book)
    report = {}
    for u in units:
        p = out_path(book, u)
        if not p.exists():
            continue
        doc = json.loads(p.read_text())
        lp = HERE / "teaching" / book / "links" / f"ch{u:02d}.json"
        links = json.loads(lp.read_text()) if lp.exists() else {"format": "ainext.prerequisite-links/1", "book": book, "chapter": u, "links": []}
        mine = [k for k in links["links"] if not k.get("cross")]
        add = []
        for k in doc["links"]:
            d = dec.get(("link", k["key"]))
            if d and d["decision"] == "keep" and d.get("fingerprint") == k["fingerprint"]:
                add.append({"src": k["src"], "dst": k["dst"], "signal": k.get("signal"), "evidence": k.get("evidence"),
                            "by": d["by"], "s1_key": k["key"], "cross": True, "source": doc["run"]})
        report[u] = {"kept": len(add), "undecided": sum(1 for k in doc["links"] if ("link", k["key"]) not in dec)}
        if not dry:
            links["links"] = mine + add
            lp.write_text(json.dumps(links, ensure_ascii=False, indent=1) + "\n")
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("book")
    r.add_argument("units", type=int, nargs="+")
    r.add_argument("--cap", type=float, default=2.0)
    r.add_argument("--cross", action="store_true", help="the links-v2-cross variant (links into earlier units only)")
    g = sub.add_parser("args")
    g.add_argument("book")
    g.add_argument("unit", type=int)
    g.add_argument("--cross", action="store_true")
    c = sub.add_parser("accept")
    c.add_argument("book")
    c.add_argument("unit", type=int)
    c.add_argument("run_file", type=Path)
    a_ = sub.add_parser("apply")
    a_.add_argument("book")
    a_.add_argument("units", type=int, nargs="*")
    a_.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "args":
        import embed_workflow as EW  # noqa: PLC0415
        print(EW.summary(EW.write(HERE / "runbook" / (CROSS_WORKFLOW if a.cross else "links.workflow.js"), build_args(a.book, a.unit),
                                  EW.default_out(a.book, "xlinks" if a.cross else "links", f"ch{a.unit:02d}"))), file=sys.stderr)
        return 0
    if a.cmd == "accept":
        res = accept(a.book, a.unit, a.run_file.resolve())
    elif a.cmd == "apply":
        units = a.units or sorted(int(p.stem[2:]) for p in (HERE / "teaching" / a.book / "cross-links").glob("ch*.json"))
        res = apply(a.book, units, a.dry_run)
    else:
        res = [run(a.book, u, a.cap, a.cross) for u in a.units]
    print(json.dumps(res, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

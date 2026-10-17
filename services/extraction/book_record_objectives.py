"""S1 for book records: Samuel's objectives stage (two blind finders, a reconciler, two blind mappers, an evidence
check) and his prerequisite links (a linker and an independent checker), run on a unit's book records.

    uv run book_record_objectives.py run   prep3-math-en 1 u1-1 u1-2 u1-3 u1-4 [--cap 8] [--args-only]
    uv run book_record_objectives.py apply prep3-math-en 1 [--dry-run]   # after G1

Run from services/extraction/. Decided by Tamer, 2026-10-16 (docs/design/maths-ingestion-pipeline.md): every book's
objectives come from Grade 10's S1, not from a single reading.

THE PACKET. `runbook/objectives.workflow.js` reads a chapter packet (assemble_objectives.build_s1_packet): per lesson
its text blocks, worked examples and exercise problems — never a solution or a printed answer — each with an anchor
the evidence must cite. Here the packet is built from the book records, every anchor a book-record id:
  heading → heading; definition → definition; rule, caution, convention, method → box (its kind); linking text,
  prior knowledge, printed objective, key term → para; table → table; worked example → worked example (its question
  and steps); every exercise, activity and open-prompt part → an exercise item (its question only).
A unit is a chapter (the book-record lesson map's module); it has no end-of-chapter pool, introduction or summary.
A book whose config says it PRINTS its objectives (Prep-3 prints a topic box, not "can do" objectives) is run in S1's
"derived" mode: the printed box is one more text block the finders read.

THE CHECKS are Samuel's own: `assemble_objectives.evaluate_chapter` (evidence at its anchor, quote contained or
confirmed, finder agreement, the mappers' agreement, links confirmed and evidenced). What fails is dropped and listed;
what a person must decide is listed as G1's decisions — the review tool's Objectives task.

APPLY writes what passed: the objectives (`<slug>:objective-N`, label, description, evidence) and each item's
objective into the book records (role extraction; a lesson's ids are frozen once reviewed, so this rewrites only an
unreviewed extraction), and the prerequisite links into the teaching layer, teaching/<book>/links/ch<NN>.json —
a link is a judgement about the book, not something it prints. compile_book_records.py turns the links into the
app's `prerequisite_of` edges.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "groundtruth"))
import answer_gen as AG  # noqa: E402  (with_intended: misprints corrected)
import assemble_objectives as AO  # noqa: E402
import book_config  # noqa: E402
import embed_workflow as EW  # noqa: E402
import workflow_runner as WR  # noqa: E402

BLOCK_TYPE = {"heading": "heading", "definition": "definition", "rule": "box", "caution": "box", "convention": "box",
              "method": "box", "linking_text": "para", "prior_knowledge": "para", "printed_objective": "para",
              "key_term": "para", "table": "table"}
PROMPT_TYPES = ("exercise", "activity", "open_prompt")


def record(book: str, slug: str) -> dict:
    return json.loads((HERE / "book-records" / book / f"{slug}.json").read_text())


def lesson_packet(book: str, slug: str, lmap: dict) -> dict:
    rec = record(book, slug)
    meta = next((l for l in lmap["lessons"] if l["slug"] == slug), {})
    blocks, wes, items = [], [], []
    for raw in rec.get("items") or []:
        it = AG.with_intended(raw)
        t, page = it["type"], it.get("source_page")
        if t in BLOCK_TYPE:
            text = it.get("claim") or it.get("text") or it.get("term") or it.get("caption") or ""
            if t == "key_term":
                text = f"Key term: {text}"
            if t == "table":
                rows = [it.get("header") or []] + (it.get("rows") or [])
                text = f"{it.get('caption') or ''} " + " / ".join(", ".join(r) for r in rows if r)
            if it.get("formula"):
                text = f"{text} {it['formula']}"
            b = {"id": it["id"], "type": BLOCK_TYPE[t], "section": meta.get("syllabus_ref"), "printed_page": page, "text": text.strip()}
            if b["type"] == "heading":
                b.update(anchor=it["id"], level=2)
            if b["type"] == "box":
                b["kind"] = t
            if b["type"] == "definition":
                b["term"] = None
            blocks.append(dict(b, cite=AO.cite_kinds(b["type"], "lesson")))
        elif t == "worked_example":
            steps = [{"title": "", "text": s} for s in it.get("solution") or []]
            q = it.get("stem") or ""
            for p in it.get("parts") or []:
                q += f" ({p.get('label')}) {p.get('stem') or ''}"
            label = f"{it.get('label') or 'Example'} {it['number']}" if it.get("number") is not None else it["id"].split(":", 1)[1]
            wes.append({"anchor": it["id"], "n": None, "section": meta.get("syllabus_ref"), "title": label,
                        "printed_page": page, "question": q.strip(), "steps": steps, "loose_solution": ""})
        elif t in PROMPT_TYPES:
            text = it.get("text") or it.get("stem") or ""
            for p in it.get("parts") or [None]:
                items.append({"item_id": f"{it['id']}:{p['label']}" if p else it["id"], "section": meta.get("syllabus_ref"),
                              "printed_page": page, "problem": f"{text} {(p or {}).get('stem') or ''}".strip()})
    return {"slug": slug, "title": rec["lesson"].get("title"),
            "provenance": {"sections": [meta.get("syllabus_ref")], "part": None, "chapter_intro": False},
            "printed_pages": rec["lesson"].get("pages"), "blocks": blocks, "worked_examples": wes, "items": items}


def s1_args(book_name: str, chapter: int, slugs: list[str]) -> dict:
    book = book_config.load_book(book_name)
    lmap = json.loads((HERE / "book-records" / book_name / "lessons.json").read_text())
    lessons = [lesson_packet(book_name, s, lmap) for s in slugs]
    # Samuel's S1 names a worked example `WE<n>`, numbered through the chapter (assemble_objectives.we_ref), and its
    # prompt tells the agents to cite it so. Each keeps its book-record id beside it; evaluate() maps a cited WE<n> back.
    k = 0
    for l in lessons:
        for w in l["worked_examples"]:
            k += 1
            w.update(n=k, record_id=w["anchor"], anchor=f"WE{k}")
    module = (next((l for l in lmap["lessons"] if l["slug"] == slugs[0]), {}) or {}).get("module")
    packet = {"n": chapter, "module": f"module:{slugs[0].rsplit('-', 1)[0]}", "title": module, "intro": [], "summary": [],
              "lessons": lessons, "pool": []}
    return {"book": {"book": book.book, "course_id": book.course_id, "language": book.language,
                     "objectives_mode": "derived", "id_prefixes": book.id_prefixes},
            "stage": "S1", "chapter": packet, "packet_sha256": AO.packet_sha(packet), "teacher_only_dropped": 0,
            "prior_objectives": [], "options": {"second_mapper": True, "pool_batch": 60, "links": True},
            "source": "book records (book_record_objectives.py)"}


RESULT_FORMAT = "ainext.s1-result/1"


def book_ids(ev, we: dict[str, str]):
    """Every `WE<n>` S1 cites (an evidence anchor, a worked example filed, a link's evidence) as its book-record id,
    so the review tool and `apply` work on book-record items; the cited name is kept as `cited_as`."""
    if isinstance(ev, list):
        return [book_ids(x, we) for x in ev]
    if not isinstance(ev, dict):
        return we.get(ev, ev) if isinstance(ev, str) else ev
    out = {}
    for key, v in ev.items():
        if key == "anchor" and v in we:
            out["cited_as"], out[key] = v, we[v]
        elif key in ("worked_examples", "evidence", "evidence_dropped", "lessons", "objectives", "links", "kept", "dropped"):
            out[key] = book_ids(v, we)
        else:
            out[key] = v
    return out


def evaluate(book_name: str, args_file: Path, run_file: Path) -> Path:
    """Samuel's deterministic S1 checks on a run, saved for G1 (the review tool's Objectives task):
    teaching/<book>/objectives/ch<NN>.json."""
    import hashlib  # noqa: PLC0415
    args = json.loads(args_file.read_text())
    run = json.loads(run_file.read_text())
    if run.get("packet_sha256") != args["packet_sha256"]:
        raise SystemExit("the run was made from another packet (packet_sha256 differs): run S1 again")
    ev = AO.evaluate_chapter(args["chapter"], run, AO.egyptian_vocabulary(), {}, args.get("prior_objectives") or [])
    ev = book_ids(ev, {w["anchor"]: w["record_id"] for l in args["chapter"]["lessons"] for w in l["worked_examples"] if w.get("record_id")})
    fails: dict[str, list[str]] = {}
    for f in ev["failures"]:
        fails.setdefault(f.split(":", 1)[0] + ":" + f.split(":", 2)[1] if f.startswith("lo:") else "(chapter)", []).append(f)
    fp = lambda x: hashlib.md5(json.dumps(x, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    lessons = []
    for l in ev["lessons"]:
        objs = []
        for o in l["objectives"]:
            keep = {k: o.get(k) for k in ("id", "n", "label", "statement", "evidence", "evidence_dropped", "exercise_items",
                                          "worked_examples", "confidence", "terms")}
            keep["failures"] = [f.split(": ", 1)[1] for f in fails.get(o["id"], [])]
            keep["fingerprint"] = fp({k: keep[k] for k in ("label", "statement", "evidence", "exercise_items", "worked_examples")})
            objs.append(keep)
        lessons.append({"slug": l["slug"], "objectives": objs})
    links = [{**k, "fingerprint": fp({x: k.get(x) for x in ("src", "dst", "signal", "evidence")})} for k in ev["links"]["kept"]]
    out = HERE / "teaching" / book_name / "objectives" / f"ch{int(args['chapter']['n']):02d}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "format": RESULT_FORMAT, "book": book_name, "chapter": args["chapter"]["n"], "module": args["chapter"]["module"],
        "run": str(run_file.relative_to(HERE)), "prompts_version": run.get("prompts_version"),
        "status": "failures" if ev["failures"] else "awaiting_g1",
        "lessons": lessons, "links": links,
        "links_dropped": [{"key": d.get("key"), "src": d.get("src"), "dst": d.get("dst"), "why": d.get("why") or d.get("reason"),
                           "check": d.get("check")} for d in ev["links"]["dropped"]],
        "decisions": ev["decisions"], "failures": ev["failures"], "warnings": ev["warnings"]}, ensure_ascii=False, indent=1) + "\n")
    return out


def g1_decisions(book: str) -> dict[tuple[str, str], dict]:
    p = HERE / "reviews" / book / "objectives-g1.json"
    return {(d["kind"], d["ref"]): d for d in json.loads(p.read_text()).get("decisions", [])} if p.exists() else {}


def apply(book: str, chapter: int, dry_run: bool = False) -> dict:
    """Write what G1 approved: the objectives and their items into the book records, the kept links into
    teaching/<book>/links/ch<NN>.json. A decision counts only on the item as S1 left it (its fingerprint). A lesson
    with no approved objective is left as it is, and said so. A `refile` decision moves one item to another approved
    objective after S1's filing."""
    import extract_book_record as X  # noqa: PLC0415  (check: the record still validates)
    res = json.loads((HERE / "teaching" / book / "objectives" / f"ch{chapter:02d}.json").read_text())
    dec = g1_decisions(book)
    ok = lambda kind, ref, fp, yes: (lambda d: bool(d) and d.get("fingerprint") == fp and d["decision"] in yes)(dec.get((kind, ref)))
    report = {"lessons": {}, "links": 0, "left_alone": []}
    new_id: dict[str, str] = {}   # S1's lo id -> the app's lo id after renumbering (lo:<slug>-<n>)
    for les in res["lessons"]:
        slug = les["slug"]
        kept = [o for o in les["objectives"] if ok("objective", o["id"], o["fingerprint"], ("approve", "fix_requested"))]
        if not kept:
            report["left_alone"].append(slug)
            continue
        path = HERE / "book-records" / book / f"{slug}.json"
        rec = json.loads(path.read_text())
        ids = {it["id"] for it in rec["items"]}
        prov = {"by": f"book_record_objectives.py, S1 ({res.get('prompts_version')}), approved at G1", "method": "page image"}
        objs, lo_of = [], {}
        for n, o in enumerate(kept, start=1):
            d = dec[("objective", o["id"])]
            oid = f"{slug}:objective-{n}"
            new_id[o["id"]] = f"lo:{slug}-{n}"
            ev = list(dict.fromkeys(e["anchor"].rsplit(":", 1)[0] if e["anchor"] not in ids else e["anchor"]
                                    for e in o.get("evidence") or [] if (e["anchor"] in ids or e["anchor"].rsplit(":", 1)[0] in ids)))
            for ref in [*(o.get("worked_examples") or []), *(o.get("exercise_items") or [])]:
                rid = ref if ref in ids else ref.rsplit(":", 1)[0]
                if rid in ids:
                    lo_of.setdefault(rid, oid)
            for a in ev:
                lo_of.setdefault(a, oid)
            objs.append({"id": oid, "label": d.get("label") or o.get("label") or o["statement"][:60],
                         "description": d.get("statement") or o["statement"], "order_in_parent": n,
                         "evidence": ev or [r for r, x in lo_of.items() if x == oid][:2], "provenance": prov})
        # a person's refile at G1 (kind "refile": an item S1 filed under one approved objective, moved to another by its
        # S1 id) wins over S1's own filing, here and on every later apply
        s1_oid = {o["id"]: f"{slug}:objective-{n}" for n, o in enumerate(kept, start=1)}
        for (kind, ref), d in dec.items():
            if kind == "refile" and ref in ids and d.get("objective") in s1_oid:
                lo_of[ref] = s1_oid[d["objective"]]
                report.setdefault("refiled", []).append(f"{ref} → {d['objective']} ({d['by']})")
        items = []
        for it in rec["items"]:
            it = {k: v for k, v in it.items() if k != "lo"}
            if it["id"] in lo_of and it["type"] not in X.NO_OBJECTIVE:
                it = {"id": it["id"], "type": it["type"], "lo": lo_of[it["id"]], **{k: v for k, v in it.items() if k not in ("id", "type")}}
            items.append(it)
        rec["learning_objectives"], rec["items"] = objs, items
        rec.setdefault("history", []).append(f"objectives from S1 ({res['run']}), approved at G1 ({len(objs)})")
        errs = X.check(rec)
        if errs:
            raise SystemExit(f"{slug}: the record would not validate, nothing written:\n  " + "\n  ".join(errs[:8]))
        if not dry_run:
            path.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n")
        report["lessons"][slug] = {"objectives": len(objs), "items_filed": len(lo_of)}
    links = []
    for k in res.get("links") or []:
        if not ok("link", k["key"], k["fingerprint"], ("keep",)):
            continue
        if k["src"] in new_id and k["dst"] in new_id:
            links.append({"src": new_id[k["src"]], "dst": new_id[k["dst"]], "signal": k.get("signal"), "evidence": k.get("evidence"),
                          "by": dec[("link", k["key"])]["by"], "s1_key": k["key"]})
    for k in res.get("links_dropped") or []:   # one a person restored
        d = dec.get(("link", k.get("key")))
        if d and d["decision"] == "keep" and d.get("fingerprint") == "dropped:" + k["key"]:
            src, dst = k["key"].split("->")
            if src in new_id and dst in new_id:
                links.append({"src": new_id[src], "dst": new_id[dst], "signal": None, "evidence": [], "by": d["by"], "s1_key": k["key"], "restored": True})
    out = HERE / "teaching" / book / "links" / f"ch{chapter:02d}.json"
    if not dry_run:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"format": "ainext.prerequisite-links/1", "book": book, "chapter": chapter, "source": res["run"],
                                   "links": links}, ensure_ascii=False, indent=1) + "\n")
    report["links"] = len(links)
    return report


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("book")
    r.add_argument("chapter", type=int)
    r.add_argument("lessons", nargs="+")
    r.add_argument("--cap", type=float, default=8.0)
    r.add_argument("--args-only", action="store_true")
    e = sub.add_parser("evaluate", help="Samuel's S1 checks on a saved run, for G1 (teaching/<book>/objectives/)")
    e.add_argument("book")
    e.add_argument("run_file", type=Path)
    ap_ = sub.add_parser("apply", help="write what G1 approved into the book records and the teaching layer")
    ap_.add_argument("book")
    ap_.add_argument("chapter", type=int)
    ap_.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "apply":
        print(json.dumps(apply(a.book, a.chapter, a.dry_run), indent=1))
        return 0
    if a.cmd == "evaluate":
        ch = json.loads(a.run_file.read_text())["chapter"]
        out = evaluate(a.book, HERE / "runs" / a.book / "objectives" / f"s1-ch{int(ch):02d}.args.json", a.run_file.resolve())
        d = json.loads(out.read_text())
        print(f"{out.relative_to(HERE)}: {sum(len(l['objectives']) for l in d['lessons'])} objective(s), "
              f"{sum(1 for l in d['lessons'] for o in l['objectives'] if o['failures'])} failing a check, "
              f"{len(d['links'])} link(s) kept, {len(d['links_dropped'])} dropped, {len(d['decisions'])} decision(s) for G1")
        return 0
    if a.cmd == "run":
        args = s1_args(a.book, a.chapter, a.lessons)
        out = HERE / "runs" / a.book / "objectives"
        out.mkdir(parents=True, exist_ok=True)
        (out / f"s1-ch{a.chapter:02d}.args.json").write_text(json.dumps(args, ensure_ascii=False, indent=1) + "\n")
        c = args["chapter"]
        print(f"S1 chapter {a.chapter}: {len(c['lessons'])} lesson(s), "
              f"{sum(len(l['blocks']) for l in c['lessons'])} text block(s), {sum(len(l['worked_examples']) for l in c['lessons'])} "
              f"worked example(s), {sum(len(l['items']) for l in c['lessons'])} item(s)", file=sys.stderr)
        copy = EW.default_out(a.book, "objectives", f"s1-ch{a.chapter:02d}.bookrecord")
        print(EW.summary(EW.write(HERE / "runbook" / "objectives.workflow.js", args, copy)), file=sys.stderr)
        if a.args_only:
            return 0
        run, _res, _cost = WR.run_copy(copy, [], a.cap, f"s1-ch{a.chapter:02d}", a.book, "objectives", stage="S1")
        out = evaluate(a.book, HERE / "runs" / a.book / "objectives" / f"s1-ch{a.chapter:02d}.args.json", run)
        print(f"checked: {out.relative_to(HERE)} (the review tool's Objectives task)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

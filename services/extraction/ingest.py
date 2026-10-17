"""The maths book ingestion pipeline's front door: S0a's source switch and the per-unit run plan.

    uv run ingest.py route prep3-math-en          # which source route the book takes, and why
    uv run ingest.py plan  prep3-math-en 1        # unit 1's stages in order: the command, what it leaves, done or not
    uv run ingest.py plan  g10-math 1 --json
    uv run ingest.py run   prep3-math-en 2 3 4 5 --parallel 2 --dsn postgres://127.0.0.1/…   # the fan-out (below)

Decided by Tamer, 2026-10-16 (docs/design/maths-ingestion-pipeline.md): every book ends in book records, whatever
it came in as, and every stage after the source reads only book records and the teaching layer. The switch:

  epub   the config names an EPUB → Samuel's source_adapter.py (blocks, figures), S0b when the book carries its maths
         as equation images (maths_source epub-images-md5: assemble_maths.py), G0's manifest, then
         epub_book_record.py writes the book records. A named EPUB that is not on disk BLOCKS the book: the PDF is
         not silently read instead, since the two routes give different records (the right edition goes in docs/Source/).
  pages  otherwise the PDF → S0's lesson map (book_record_lessons.py run, a person approves it), the page reader
         (extract_book_record.py: runbook/book-record.workflow.js), the maths second reading
         (book_record_maths.py), G0 label review. A PDF with a text layer still goes this way for now: the text
         layer is reported, not used (its maths is unreliable in both prep-3 PDFs).

Nothing in `route` or `plan` calls a model; `plan` only prints. Each row is a command a person (or Claude Code) runs, in
order; a gate row (G0, G1, …) is a person's decision in the review tool.

`run` is the fan-out (Samuel's runbook §10, for book-record units): every named unit's agent stages in plan order, the
units in parallel (`--parallel`, default 2), each stage skipped when its output is on disk. A unit STOPS at the first
gate a person owes before the next stage may use it: G0 (the lesson map approved) before the page reader, and G1 (the
objectives approved and applied) before anything after S1, as the Objectives task promises. Unlike Samuel's fan-out it
auto-passes no gate: that was his decision for Grade 10 (answer 37c) and nobody has made it for this line. The other
review queues (answers, tiers, maths reading, generated content) never stop it: compile already serves only what a
person approved or two readings agreed on, and the coverage audit and G5 stand before the load. S7 builds against
the unit loaded in a local scratch database (`--dsn`, loaded with book_record_load.py --scratch after the first
compile), as Samuel's fan-out loads his local preview database. The run ends at the coverage audit: G5 and the real
load are a person's. Every stage writes Samuel's cost ledger; `--cap` bounds each stage.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_config  # noqa: E402

UV = "uv run"


def route(name: str) -> dict:
    b = book_config.load_book(name)
    src = b.sources
    root = book_config.REPO_ROOT
    out = {"book": b.book, "maths_source": b.maths_source}
    if src.epub:
        on_disk = (root / src.epub).exists()
        out |= {"route": "epub", "source": src.epub, "on_disk": on_disk,
                "why": "the config names an EPUB: its structure and maths are read, not inferred from page images"}
        if not on_disk:
            out["blocked"] = f"{src.epub} is not on disk: place that exact edition in docs/Source/ (the PDF is not read instead)"
        out["maths"] = "S0b (assemble_maths.py)" if b.maths_source == "epub-images-md5" else "inline in the EPUB"
        return out
    if not src.pdf:
        return out | {"route": None, "blocked": "the config names no source"}
    pdf = root / src.pdf
    out |= {"route": "pages", "source": src.pdf, "on_disk": pdf.exists(), "maths": "second reading (book_record_maths.py)",
            "why": "no EPUB: the page images are read by the page agents"}
    if not pdf.exists():
        out["blocked"] = f"{src.pdf} is not on disk"
        return out
    try:
        import pymupdf  # noqa: PLC0415  (optional here)
        with pymupdf.open(pdf) as d:
            sample = [d[i].get_text() for i in range(min(len(d), 12))]
        out["text_layer"] = sum(len(t.strip()) > 200 for t in sample) >= 6
        if out["text_layer"]:
            out["note"] = "the PDF has a text layer; reported, not used (page images stay the reading)"
    except ImportError:
        out["text_layer"] = "unknown (run with --with pymupdf)"
    return out


def unit_lessons(b, r: dict, unit: int) -> tuple[list[str], str]:
    if r["route"] == "epub":
        import assemble_objectives as AO  # noqa: PLC0415
        mpath = book_config.REPO_ROOT / (b.manifest or f"services/extraction/manifest/{b.book}.json")
        if not mpath.exists():
            return [], "no manifest yet (G0)"
        module = AO.chapter_module(json.loads(mpath.read_text()), unit)
        return [l["id"] for l in AO.module_lessons(module, b)], module.get("title") or module["id"]
    lmap = HERE / "book-records" / b.book / "lessons.json"
    if not lmap.exists():
        return [], "no lesson map yet (S0)"
    lessons = json.loads(lmap.read_text())["lessons"]
    modules = list(dict.fromkeys(l["module"] for l in lessons))
    if unit > len(modules):
        return [], f"the lesson map has {len(modules)} unit(s) so far"
    return [l["slug"] for l in lessons if l["module"] == modules[unit - 1]], modules[unit - 1]


def plan(name: str, unit: int) -> dict:
    b = book_config.load_book(name)
    r = route(name)
    slugs, title = unit_lessons(b, r, unit)
    L, bk, ch = " ".join(slugs) or "<lessons>", b.book, f"ch{unit:02d}"
    ex = lambda *p: (HERE.joinpath(*p)).exists()
    ran = lambda folder, prefix: any((HERE / "runs" / bk / folder).glob(f"{prefix}.*Z.json"))
    all_of = lambda f: bool(slugs) and all(f(s) for s in slugs)
    rows = []
    add = lambda stage, what, cmd, done, gate=False: rows.append({"stage": stage, "what": what, "command": cmd, "done": done, "gate": gate})
    if r["route"] == "epub":
        add("S0a", "EPUB → blocks and figures", f"{UV} --with pymupdf source_adapter.py {bk}", ex("work", bk, "blocks.jsonl"))
        if b.maths_source == "epub-images-md5":
            add("S0b", "equation images → LaTeX (recover, vision passes, assemble)", f"{UV} assemble_maths.py recover {bk}  … assemble",
                ex("runs", bk, "maths", "accepted.json"))
        add("G0", "approve the lesson manifest (Samuel's G0: build_manifest.py + the book config's lesson_unit)",
            f"{UV} build_manifest.py {bk}", bool(slugs), gate=True)
        add("S0", "the lesson map from the manifest (method: manifest, no model)", f"{UV} book_record_lessons.py run {bk}",
            ex("book-records", bk, "lessons.proposed.json"))
        add("G0", "approve the lesson map", f"{UV} book_record_lessons.py approve {bk} --by <initials>",
            ex("book-records", bk, "lessons.json"), gate=True)
        add("S0a", "blocks → book records", f"{UV} --with jsonschema epub_book_record.py write {bk} {unit}",
            all_of(lambda s: ex("book-records", bk, f"{s}.json")))
    else:
        add("S0", "propose the lesson map from the contents pages (method: scout)", f"{UV} --with pymupdf book_record_lessons.py run {bk}",
            ex("book-records", bk, "lessons.json"))
        add("G0", "approve the lesson map (units, lessons, printed pages, offset)", f"{UV} book_record_lessons.py approve {bk}",
            ex("book-records", bk, "lessons.json"), gate=True)
        add("S0a", "read the pages → book records", f"{UV} --with pymupdf --with jsonschema extract_book_record.py run {bk} <lesson> (each of: {L})",
            all_of(lambda s: ex("book-records", bk, f"{s}.json")))
        add("S0a", "second, blind reading of the maths; a third where they differ (Samuel's pass C); the rest to review",
            f"{UV} --with pymupdf book_record_maths.py run {bk} {L}",
            all_of(lambda s: ex("book-records", bk, "maths-reading", f"{s}.json")))
        add("S2", "provenance: each statement against the page (Haiku), doubts re-audited (Sonnet); flags to Label extraction",
            f"{UV} --with pymupdf book_record_provenance.py run {bk} {L}", all_of(lambda s: ex("book-records", bk, "provenance", f"{s}.json")))
        add("G0", "label review (start with the provenance check's flags) and misprints", "review tool: Label extraction, Misprints", False, gate=True)
    add("S1", "objectives (two finders, reconciler, two mappers, evidence check) and prerequisite links",
        f"{UV} book_record_objectives.py run {bk} {unit} {L}", ex("teaching", bk, "objectives", f"{ch}.json"))
    add("G1", "review the objectives, links and S1's questions", "review tool: Objectives (G1)", ex("reviews", bk, "objectives-g1.json"), gate=True)
    add("S1", "write what G1 approved", f"{UV} book_record_objectives.py apply {bk} {unit}", ex("teaching", bk, "links", f"{ch}.json"))
    add("S1F", "file statements, tables and figures under the approved objectives (two readings; Samuel's S2/S4 filing)",
        f"{UV} book_record_filing.py run {bk} {unit}", ex("teaching", bk, "filing", f"{ch}.json"))
    add("G1", "decide the filings the two readings disagree on, then apply", f"review tool: Objectives (G1), kind Filing · "
        f"{UV} book_record_filing.py apply {bk} {unit}", False, gate=True)
    add("S1R", "move generated content made before G1 onto the approved objectives (through its book question / sources)",
        f"{UV} book_record_remap.py {bk} {unit}", ex("teaching", bk, "generated", f"remap-ch{unit:02d}.json"))
    add("S2", "answers for unanswered questions (answer, blind, judge) + blind check of printed answers",
        f"{UV} --with pymupdf answer_gen.py run book-records/{bk}/<lesson>.json  ·  … check-printed …",
        all_of(lambda s: ex("teaching", bk, "answers", f"{s}.json")))
    add("S3", "question tiers (two readings)", f"{UV} tier_questions.py run {bk} {L}", all_of(lambda s: ex("teaching", bk, "tiers", f"{s}.json")))
    add("G2", "review generated answers and tier disagreements", "review tool: Generated answers, Question tiers", False, gate=True)
    add("S4", "figures: crops (PDF only) and visual specs", f"{UV} book_record_figures.py run {bk} {L}",
        all_of(lambda s: ex("teaching", bk, "visuals", f"{s}.json")))
    add("SW", "step check of every worked solution; book flags → Misprints", f"{UV} book_record_checks.py sw {bk} {unit} {L}",
        ex("runs", bk, "working-check", f"{ch}.flags.json"))
    add("C", "compile the unit", f"{UV} compile_book_records.py {bk} {L}", ex("compiled", bk, f"unit{unit}.json"))
    add("S5", "misconceptions (draft)", f"{UV} book_record_generation.py s5 {bk} {L} --stage draft", ran("misconceptions", "s5-draft"))
    add("S6", "question families and widgets", f"{UV} book_record_generation.py s6-author {bk} {L} --catalogue <S5 draft>  ·  s6-grade",
        ex("teaching", bk, "families"))
    add("S7", "refutations", f"{UV} book_record_generation.py s7-author {bk} {L} --catalogue <S5 draft>  ·  s7-verify", ran("widgets", "s7-verify"))
    add("S5", "misconceptions (final)", f"{UV} book_record_generation.py s5 {bk} {L} --stage final --draft <S5 draft>", ran("misconceptions", "s5-final"))
    add("G3s", "draw the review sample of generated questions (Samuel's stratified 10%: one per family, then random)",
        f"{UV} book_record_sample.py {bk}", ex("reviews", bk, "generated-review-sample.json"))
    add("G3", "review generated content: the sampled questions, every misconception, mapping and figure", "review tool: Generated content", False, gate=True)
    add("C", "compile again with the generated content", f"{UV} compile_book_records.py {bk} {L}", False)
    add("S8", "coverage oracle: every sub-heading covered?", f"{UV} book_record_checks.py s8 {bk} {L}", ex("runs", bk, "coverage", "s8-summary.json"))
    add("A", "coverage audit: Samuel's integer checks; GREEN, or a person signs each exception",
        f"{UV} book_record_coverage.py {bk} {unit}", ex("coverage", f"{bk}.unit{unit:02d}.book-records.json"))
    add("L", "validate, preview every loader (rolled back), then --go: load, stamp reviews, parity check",
        f"{UV} book_record_load.py {bk} {unit} --dsn <database> [--go]", False)
    return {"route": r, "unit": unit, "title": title, "lessons": slugs, "stages": rows}


def latest(book: str, folder: str, prefix: str) -> str | None:
    runs = sorted((HERE / "runs" / book / folder).glob(f"{prefix}.*Z.json"))
    return str(runs[-1].relative_to(HERE)) if runs else None


def stages(name: str, unit: int, dsn: str | None, cap: float | None) -> tuple[list[str], list[tuple[str, object, object]]]:
    """The unit's fan-out steps: (stage, done, argv lists or a gate's reason). Commands that need an earlier step's output
    resolve it when they run (a callable)."""
    b = book_config.load_book(name)
    r = route(name)
    slugs, _t = unit_lessons(b, r, unit)
    bk, ch = b.book, f"ch{unit:02d}"
    ex = lambda *p: (HERE.joinpath(*p)).exists()
    all_of = lambda f: bool(slugs) and all(f(s) for s in slugs)
    c = (lambda: ["--cap", str(cap)]) if cap else (lambda: [])
    U = lambda script, *a, w=(): ["uv", "run", *[x for m in w for x in ("--with", m)], script, *a]
    out: list[tuple[str, object, object]] = []
    if r["route"] == "epub":
        out.append(("G0", ex("book-records", bk, "lessons.json"),
                    "the lesson map is not approved (book_record_lessons.py run, method manifest, then approve)"))
        out.append(("S0a", all_of(lambda s: ex("book-records", bk, f"{s}.json")),
                    [U("epub_book_record.py", "write", bk, str(unit), w=("jsonschema",))]))
    else:
        out.append(("G0", ex("book-records", bk, "lessons.json") and bool(slugs), "the lesson map is not approved (book_record_lessons.py run, then approve)"))
        out.append(("S0a", all_of(lambda s: ex("book-records", bk, f"{s}.json")),
                    [U("extract_book_record.py", "run", bk, s, *c(), w=("pymupdf", "jsonschema")) for s in slugs]))
        out.append(("S0a maths", all_of(lambda s: ex("book-records", bk, "maths-reading", f"{s}.json")),
                    [U("book_record_maths.py", "run", bk, *slugs, *c(), w=("pymupdf",))]))
        out.append(("S2", all_of(lambda s: ex("book-records", bk, "provenance", f"{s}.json")),
                    [U("book_record_provenance.py", "run", bk, *slugs, *c(), w=("pymupdf",))]))
    out.append(("S1", ex("teaching", bk, "objectives", f"{ch}.json"), [U("book_record_objectives.py", "run", bk, str(unit), *slugs, *c())]))
    out.append(("G1", ex("teaching", bk, "links", f"{ch}.json"),
                "the objectives are not approved: the review tool's Objectives (G1) task, then book_record_objectives.py apply"))
    out.append(("S1F", ex("teaching", bk, "filing", f"{ch}.json"), [U("book_record_filing.py", "run", bk, str(unit), *c())]))
    out.append(("S1R", False, [U("book_record_remap.py", bk, str(unit))]))
    out.append(("S2", all_of(lambda s: ex("teaching", bk, "answers", f"{s}.json")),
                [U("answer_gen.py", "run", f"book-records/{bk}/{s}.json", *c(), w=("pymupdf",)) for s in slugs]
                + [U("answer_gen.py", "check-printed", f"book-records/{bk}/{s}.json", *c(), w=("pymupdf",)) for s in slugs]))
    out.append(("S3", all_of(lambda s: ex("teaching", bk, "tiers", f"{s}.json")), [U("tier_questions.py", "run", bk, *slugs, *c())]))
    out.append(("S4", all_of(lambda s: ex("teaching", bk, "visuals", f"{s}.json")), [U("book_record_figures.py", "run", bk, *slugs, *c())]))
    out.append(("SW", ex("runs", bk, "working-check", f"{ch}.flags.json"), [U("book_record_checks.py", "sw", bk, str(unit), *slugs, *c())]))
    out.append(("C", False, [U("compile_book_records.py", bk, *slugs)]))
    out.append(("G2R", False, [U("book_record_g2.py", "run", bk, str(unit), *c())]))
    out.append(("S5 draft", latest(bk, "misconceptions", "s5-draft") is not None,
                [U("book_record_generation.py", "s5", bk, *slugs, "--stage", "draft", *c())]))
    cat = lambda: latest(bk, "misconceptions", "s5-draft")
    out.append(("C", False, [U("compile_book_records.py", bk, *slugs)]))
    if dsn:
        out.append(("load scratch", False, [U("book_record_load.py", bk, str(unit), "--dsn", dsn, "--scratch")]))
    out.append(("S6", ex("teaching", bk, "families"),
                lambda: [U("book_record_generation.py", "s6-author", bk, *slugs, "--catalogue", cat(), *c()),
                         U("book_record_generation.py", "s6-grade", bk, *slugs, *c())]))
    if dsn:
        out.append(("S7", latest(bk, "widgets", "s7-verify") is not None,
                    lambda: [U("book_record_generation.py", "s7-author", bk, *slugs, "--catalogue", cat(), "--dsn", dsn, *c()),
                             U("book_record_generation.py", "s7-verify", bk, *slugs, "--catalogue", cat(), "--dsn", dsn, *c())]))
    else:
        out.append(("S7", latest(bk, "widgets", "s7-verify") is not None, "S7 builds against the unit in a scratch database: pass --dsn"))
    out.append(("S5 final", latest(bk, "misconceptions", "s5-final") is not None,
                lambda: [U("book_record_generation.py", "s5", bk, *slugs, "--stage", "final", "--draft", cat(), *c())]))
    out.append(("C", False, [U("compile_book_records.py", bk, *slugs)]))
    out.append(("G3s", False, [U("book_record_sample.py", bk)]))
    out.append(("S8", ex("runs", bk, "coverage", "s8-summary.json"), [U("book_record_checks.py", "s8", bk, *slugs, *c())]))
    out.append(("A", False, [U("book_record_coverage.py", bk, str(unit))]))
    return slugs, out


def run_unit(name: str, unit: int, dsn: str | None, cap: float | None, dry: bool) -> dict:
    import subprocess  # noqa: PLC0415
    slugs, steps = stages(name, unit, dsn, cap)
    log = HERE / "runs" / name / "fanout" / f"unit{unit:02d}.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    done = []
    if not slugs:
        return {"unit": unit, "stopped": "no lessons for this unit in the lesson map (S0, G0)", "ran": done}
    for stage, finished, what in steps:
        if finished:
            continue
        if isinstance(what, str):
            return {"unit": unit, "stopped": f"{stage}: {what}", "ran": done}
        cmds = what() if callable(what) else what
        for argv in cmds:
            if dry:
                done.append(f"{stage}: {' '.join(argv)}")
                continue
            with log.open("a") as fh:
                fh.write(f"\n== {stage}: {' '.join(argv)}\n")
                fh.flush()
                p = subprocess.run(argv, cwd=HERE, stdout=fh, stderr=subprocess.STDOUT)
            if p.returncode != 0 and not (stage == "A" and p.returncode == 1):
                return {"unit": unit, "stopped": f"{stage} failed (exit {p.returncode}); see {log.relative_to(HERE)}", "ran": done}
            done.append(f"{stage}: {' '.join(argv[2:4])}…")
    cov = HERE / "coverage" / f"{name}.unit{unit:02d}.book-records.json"
    status = json.loads(cov.read_text()).get("status") if cov.exists() and not dry else None
    return {"unit": unit, "stopped": None, "ran": done, "coverage": status,
            "next": f"book_record_gonogo.py report {name} {unit}, then a person decides G5"}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("route")
    r.add_argument("book")
    p = sub.add_parser("plan")
    p.add_argument("book")
    p.add_argument("unit", type=int)
    p.add_argument("--json", action="store_true")
    rn = sub.add_parser("run", help="the fan-out: each unit's stages in order, units in parallel, stopping at a person's gate")
    rn.add_argument("book")
    rn.add_argument("units", type=int, nargs="+")
    rn.add_argument("--parallel", type=int, default=2)
    rn.add_argument("--dsn", help="a LOCAL scratch database the units are loaded into for S7")
    rn.add_argument("--cap", type=float, help="USD cap per stage (default: each stage's own)")
    rn.add_argument("--dry-run", action="store_true", help="print what would run, run nothing")
    a = ap.parse_args(argv)
    if a.cmd == "run":
        from concurrent.futures import ThreadPoolExecutor  # noqa: PLC0415
        with ThreadPoolExecutor(max_workers=max(1, a.parallel)) as pool:
            results = list(pool.map(lambda u: run_unit(a.book, u, a.dsn, a.cap, a.dry_run), a.units))
        for r in results:
            print(f"unit {r['unit']}: " + (f"STOPPED at {r['stopped']}" if r["stopped"] else f"done, coverage {r.get('coverage')}; next: {r['next']}"))
            for x in r["ran"]:
                print(f"    {x}")
        return 0 if all(not r["stopped"] for r in results) else 1
    if a.cmd == "route":
        print(json.dumps(route(a.book), indent=1))
        return 0
    pl = plan(a.book, a.unit)
    if a.json:
        print(json.dumps(pl, indent=1, ensure_ascii=False))
        return 0
    rt = pl["route"]
    print(f"{a.book} · route {rt['route']} · unit {a.unit}: {pl['title']} · lessons {' '.join(pl['lessons']) or '—'}")
    if rt.get("blocked"):
        print(f"BLOCKED: {rt['blocked']}")
    for i, s in enumerate(pl["stages"], 1):
        mark = "✓" if s["done"] else ("◆" if s["gate"] else "·")
        print(f"{i:>2} {mark} {s['stage']:<4} {s['what']}\n       {s['command']}")
    print("✓ output on disk   ◆ a person's gate   · to run")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

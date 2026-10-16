"""The maths book ingestion pipeline's front door: S0a's source switch and the per-unit run plan.

    uv run ingest.py route prep3-math-en          # which source route the book takes, and why
    uv run ingest.py plan  prep3-math-en 1        # unit 1's stages in order: the command, what it leaves, done or not
    uv run ingest.py plan  g10-math 1 --json

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

Nothing here calls a model; `plan` only prints. Each row is a command a person (or Claude Code) runs, in order;
a gate row (G0, G1, …) is a person's decision in the review tool.
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
        add("G0", "approve the lesson manifest", "review tool / build_manifest.py", bool(slugs), gate=True)
        add("S0a", "blocks → book records", f"{UV} --with jsonschema epub_book_record.py write {bk} {unit}",
            all_of(lambda s: ex("book-records", bk, f"{s}.json")))
    else:
        add("S0", "propose the lesson map from the contents pages", f"{UV} --with pymupdf book_record_lessons.py run {bk}",
            ex("book-records", bk, "lessons.json"))
        add("G0", "approve the lesson map (units, lessons, printed pages, offset)", f"{UV} book_record_lessons.py approve {bk}",
            ex("book-records", bk, "lessons.json"), gate=True)
        add("S0a", "read the pages → book records", f"{UV} --with pymupdf --with jsonschema extract_book_record.py run {bk} <lesson> (each of: {L})",
            all_of(lambda s: ex("book-records", bk, f"{s}.json")))
        add("S0a", "second, blind reading of the maths; disagreements to review", f"{UV} --with pymupdf book_record_maths.py run {bk} {L}",
            all_of(lambda s: ex("book-records", bk, "maths-reading", f"{s}.json")))
        add("G0", "label review and misprints", "review tool: Label extraction, Misprints", False, gate=True)
    add("S1", "objectives (two finders, reconciler, two mappers, evidence check) and prerequisite links",
        f"{UV} book_record_objectives.py run {bk} {unit} {L}", ex("teaching", bk, "objectives", f"{ch}.json"))
    add("G1", "review the objectives, links and S1's questions", "review tool: Objectives (G1)", ex("reviews", bk, "objectives-g1.json"), gate=True)
    add("S1", "write what G1 approved", f"{UV} book_record_objectives.py apply {bk} {unit}", ex("teaching", bk, "links", f"{ch}.json"))
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
    add("G3", "review generated content", "review tool: Generated content", False, gate=True)
    add("C", "compile again with the generated content", f"{UV} compile_book_records.py {bk} {L}", False)
    add("S8", "coverage oracle: every sub-heading covered?", f"{UV} book_record_checks.py s8 {bk} {L}", ex("runs", bk, "coverage", "s8-summary.json"))
    add("L", "load the compiled unit", f"{UV} load_generated_questions.py compiled/{bk}/unit{unit}.json --course {b.course_id}", False)
    return {"route": r, "unit": unit, "title": title, "lessons": slugs, "stages": rows}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("route")
    r.add_argument("book")
    p = sub.add_parser("plan")
    p.add_argument("book")
    p.add_argument("unit", type=int)
    p.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
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

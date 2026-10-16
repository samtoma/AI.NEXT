"""S4 for a PDF book: the Grade 10 visuals step, run on the book records' figure crops.

    uv run book_record_figures.py args   prep3-math-en u1-1 u1-2 …            # the embedded copy, for Claude Code
    uv run book_record_figures.py run    prep3-math-en u1-1 u1-2 … [--cap 3]  # the same copy, run here, then accepted
    uv run book_record_figures.py accept prep3-math-en runs/<book>/lessons/<saved return>.json

Run from services/extraction/. The figures are cropped first (crop_figures.py: an EPUB book's figures are already
image files and go through the Grade 10 line instead).

THE SAME S4. Grade 10 redraws its figures in runbook/lesson.workflow.js: S4 Visuals (Sonnet reads each figure's
image and writes a spec of one existing VIZ kind, or names it a gap) and S4 Compare (Haiku checks the spec against the
image). Run alone for chosen figures it is "visuals-only" mode (consistency review A3). This file builds that mode's
args from book records instead of the EPUB, and writes them into a copy of the script with embed_workflow.py, exactly
as Grade 10's `embed_workflow.py lesson-args … --visuals-only` does. Nothing in the script changes: its prompts, its
rules (never draw an exercise's unknown, never force a figure into the nearest kind) and its collection are Grade 10's.
  * args: the copy only. Run it in Claude Code with Workflow({scriptPath}) and no args; save the return value, then
    `accept` it.
  * run: the copy, run here through tests/workflow_stub.mjs (the Workflow runtime's contract) with each agent answered
    by the `claude` CLI (runbook/cli_responder.mjs), the return saved under runs/<book>/lessons/, then accepted.

WHAT EACH FIGURE IS (the script's `context`): a figure printed inside a worked example ("we", drawn whole: it may show
its answer, as the book's does); one printed inside an exercise or activity, or one a prompt needs (`uses_figure`):
"exercise_problem", whose unknown is withheld; any other is "body", illustrating its objective. A figure whose caption
calls it decorative is not sent.

ACCEPT writes the teaching layer, keyed by book-record ids: teaching/<book>/visuals/<slug>.json (format
`ainext.teaching-visuals/1`): each drawn figure (kind, spec, caption, objective, the item it belongs to, what it
withholds) and each gap (why, and the kind it needs). compile_book_records.py reads it: a drawn figure is shown, a
gap's question gets the book's own picture as a stand-in (answer 37d).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import crop_figures as CF  # noqa: E402
import embed_workflow as EW  # noqa: E402

FORMAT = "ainext.teaching-visuals/1"
WORKFLOW = HERE / "runbook" / "lesson.workflow.js"
PROMPTS = ("exercise", "activity", "open_prompt", "worked_example")
DECORATIVE = re.compile(r"\bdecorative\b", re.I)


def ids_of(v) -> list[str]:
    return [v] if isinstance(v, str) else list(v or [])


def lo_of(slug: str, objective_id: str) -> str:
    return f"lo:{slug}-{int(str(objective_id).rsplit('-', 1)[1])}"


def prompt_text(it: dict) -> str:
    body = it.get("text") or it.get("stem") or ""
    parts = " ".join(f"({p.get('label')}) {p.get('stem') or p.get('text') or ''}".strip() for p in it.get("parts") or [])
    return f"{body} {parts}".strip()


def figure_users(record: dict) -> dict[str, list[str]]:
    """figure id → the prompts that show it with their question: the one it is printed inside (belongs_to), then those
    that need it (uses_figure), in book order. Shared by this file and compile_book_records.py."""
    items = record.get("items") or []
    types = {it["id"]: it["type"] for it in items}
    out: dict[str, list[str]] = {}
    for it in items:
        if it["type"] == "figure" and types.get(it.get("belongs_to")) in PROMPTS:
            out.setdefault(it["id"], []).append(it["belongs_to"])
    for it in items:
        if it["type"] in PROMPTS:
            for f in ids_of(it.get("uses_figure")):
                if it["id"] not in out.setdefault(f, []):
                    out[f].append(it["id"])
    return out


def answer_figures(record: dict) -> set[str]:
    """Figures that ARE a printed answer (a drawing): shown with the worked solution, never with a question's stem."""
    out = set()
    for it in record.get("items") or []:
        for holder in [it] + list(it.get("parts") or []):
            out |= set(ids_of(holder.get("answer_figure")))
    return out


def lesson_packet(book: str, record: dict) -> dict:
    slug = record["lesson"]["slug"]
    items = {it["id"]: it for it in record.get("items") or []}
    users = figure_users(record)
    figs = []
    for it in record.get("items") or []:
        if it["type"] != "figure" or DECORATIVE.search(it.get("caption") or ""):
            continue
        path = CF.figures_dir(book) / CF.crop_name(it["id"])
        ref = (users.get(it["id"]) or [None])[0]
        context = "body" if not ref else ("we" if items[ref]["type"] == "worked_example" else "exercise_problem")
        figs.append({"figure_id": it["id"], "src": CF.crop_name(it["id"]), "path": str(path.resolve()) if path.exists() else None,
                     "context": context, "ref": ref, "printed_page": it["source_page"], "caption": it.get("caption") or ""})
    used = {r for f in figs for r in ([f["ref"]] if f["ref"] else [])}
    return {"slug": slug, "title": record["lesson"].get("title", slug),
            "objectives": [{"id": lo_of(slug, o["id"]), "statement": f"{o['label']}: {o['description']}"} for o in record.get("learning_objectives") or []],
            "items": [{"ref": r, "stem": prompt_text(items[r])} for r in sorted(used)],
            "worked_examples": [], "figures": figs, "rerun_figures": [f["figure_id"] for f in figs]}


def build_args(book: str, slugs: list[str]) -> dict:
    import assemble_objectives as ao  # noqa: PLC0415  (viz_kind_specs: the kinds, read from VIZ_SPEC.md)
    cfg = json.loads((HERE / "books" / f"{book}.json").read_text())
    if not CF.is_pdf_book(cfg):
        raise SystemExit(f"{book}: not a PDF-only book; its figures go through the Grade 10 line (embed_workflow.py lesson-args --visuals-only)")
    lessons = []
    for s in slugs:
        rec = json.loads((HERE / "book-records" / book / f"{s}.json").read_text())
        L = lesson_packet(book, rec)
        missing = [f["figure_id"] for f in L["figures"] if not f["path"]]
        if missing:
            print(f"{s}: no crop for {missing} (crop_figures.py run {book} {s}): S4 records them as gaps", file=sys.stderr)
        lessons.append(L)
    return {"book": {"book": book, "course_id": cfg["course_id"], "language": cfg.get("language", "en"),
                     "id_prefixes": cfg.get("id_prefixes") or [], "notation": cfg.get("notation"), "multiplication_dot": False},
            "stage": "S2-S4,S8", "visuals_only": True, "lessons": lessons, "viz_kinds": ao.viz_kind_specs(),
            "options": {"blind_batch": 16, "typing_batch": 30, "figures_per_call": 16, "tier_sample_every": 5}}


def write_copy(book: str, slugs: list[str]) -> tuple[Path, dict]:
    args = build_args(book, slugs)
    tag = slugs[0] if len(slugs) == 1 else f"{slugs[0]}..{slugs[-1]}"
    out = EW.default_out(book, "lesson-visuals", tag)
    info = EW.write(WORKFLOW, args, out)
    return out, info


def accept(book: str, run_file: Path) -> list[str]:
    ret = json.loads(run_file.read_text())
    if ret.get("mode") != "visuals":
        raise SystemExit(f"{run_file}: not a visuals-only return of lesson.workflow.js")
    made = {"by": f"runbook/lesson.workflow.js S4 ({ret.get('prompts_version')}, {ret.get('collect_version')})",
            "run": str(run_file.relative_to(HERE)) if run_file.is_relative_to(HERE) else str(run_file),
            "script_sha256": (ret.get("embedded") or {}).get("generated_sha256")}
    written = []
    for L in ret.get("lessons") or []:
        slug = L["lesson"]
        out = HERE / "teaching" / book / "visuals" / f"{slug}.json"
        doc = json.loads(out.read_text()) if out.exists() else {"format": FORMAT, "book": book, "lesson": slug,
                                                                 "source": f"book-records/{book}/{slug}.json", "visuals": [], "gaps": [], "runs": []}
        redone = set(L.get("rerun_figures") or []) | {v["figure_id"] for v in L.get("visuals") or []} | {g["figure_id"] for g in L.get("viz_gaps") or []}
        doc["visuals"] = [v for v in doc["visuals"] if v["figure"] not in redone]
        doc["gaps"] = [g for g in doc["gaps"] if g["figure"] not in redone]
        for v in L.get("visuals") or []:
            doc["visuals"].append({"figure": v["figure_id"], "for_item": v.get("question"), "lo": v["lo"], "kind": v["kind"], "spec": v["spec"],
                                   "caption": v.get("caption"), "withheld": v.get("withheld") or [], "page": v.get("printed_page"), "made": made})
        for g in L.get("viz_gaps") or []:
            doc["gaps"].append({"figure": g["figure_id"], "for_item": g.get("ref"), "reason": g.get("reason"), "needed_kind": g.get("needed_kind"),
                                "page": g.get("printed_page"), **({"rejected_spec": g["rejected_spec"]} if g.get("rejected_spec") else {}), "made": made})
        doc["visuals"].sort(key=lambda v: v["figure"])
        doc["gaps"].sort(key=lambda g: g["figure"])
        doc["runs"].append({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **made, "counts": L.get("counts")})
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
        written.append(f"{out.relative_to(HERE)}: {len(doc['visuals'])} drawn, {len(doc['gaps'])} gap(s)")
    return written


def run_here(book: str, slugs: list[str], cap: float) -> Path:
    import workflow_runner  # noqa: PLC0415
    copy, _info = write_copy(book, slugs)
    out, _result, _cost = workflow_runner.run_copy(copy, [CF.figures_dir(book)], cap, "s4-visuals", book, "lessons", stage="S4")
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("args", "run"):
        c = sub.add_parser(name)
        c.add_argument("book")
        c.add_argument("lessons", nargs="+")
        if name == "run":
            c.add_argument("--cap", type=float, default=3.0)
    c = sub.add_parser("accept")
    c.add_argument("book")
    c.add_argument("run_file")
    a = ap.parse_args(argv)
    if a.cmd == "args":
        out, info = write_copy(a.book, a.lessons)
        print(EW.summary(info))
        print(f"then: uv run book_record_figures.py accept {a.book} <the saved return>.json")
        return 0
    run_file = run_here(a.book, a.lessons, a.cap) if a.cmd == "run" else Path(a.run_file).resolve()
    for line in accept(a.book, run_file):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

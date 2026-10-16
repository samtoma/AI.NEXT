"""The generation steps (S5 misconceptions, S6 question families, S7 widget questions) for book-record lessons.

    uv run book_record_generation.py s5 prep3-math-en u1-1 u1-2 u1-3 u1-4 --stage draft [--cap 5] [--args-only]
    uv run book_record_generation.py s6-author prep3-math-en u1-1 u1-2 u1-3 u1-4 --catalogue runs/<book>/misconceptions/s5-draft.<stamp>.json
    uv run book_record_generation.py s6-grade  prep3-math-en u1-1 u1-2 u1-3 u1-4
    uv run book_record_generation.py s7-author prep3-math-en u1-1 u1-2 u1-3 u1-4 --catalogue <S5 draft run>
    uv run book_record_generation.py s7-verify prep3-math-en u1-1 u1-2 u1-3 u1-4 --catalogue <S5 draft run>
    uv run book_record_generation.py s5 prep3-math-en u1-1 … --stage final --draft runs/<book>/misconceptions/s5-draft.<stamp>.json \
        --distractors runs/<book>/families/s5-distractors.json --distractors runs/<book>/widgets/s5-distractors.json

Run from services/extraction/, after compile_book_records.py. Grade 10's S5–S7 (runbook §4) build their args from
the ASSEMBLED BUNDLES: the objectives, the book questions with their canonical solutions, and the worked examples kept
as teaching items. compile_book_records.py writes exactly those for book-record lessons (compiled/<book>/), so these
steps run on them unchanged — the same builders (assemble_misconceptions.s5_args, …), the same embedded copies of the
same workflow scripts, run in Claude Code (`--args-only` writes the copy and stops) or here through workflow_runner.py.

What the adapter supplies in place of Grade 10's lesson runs (which a book record has no use for):
  * the book's evidence of a student error: the record's own `caution` statements (Grade 10: caution claims), and,
    as `remark` sources, its printed contrasts ("X × Y ≠ Y × X", "(a, b) is not equal to {a, b}") and its "Notice
    that" lines (Tamer, 2026-10-16: the Prep-3 book prints no caution box and no multiple choice, and S5 keeps only
    entries the evidence supports — with cautions alone Unit 1 got none); a three-way disagreement never arises here,
    since every printed answer agreed with its blind re-solve;
  * each question's figures: the crop of the figure it shows (crop_figures.py), from the compiled visuals.
Only the lessons named are given: their bundle is the compiled one, filtered to their objectives.

THE BOOK VIEW. S6 and S7's commands take `--book` and read the book config's bundles. `book_view` writes a copy of the
book config (work/<book>/bookrecord/<book>.json) whose bundles are the compiled bundles cut to the named lessons, so
every existing command runs on them unchanged: `generate_questions.py --book <that file> …`.

WHERE THE OUTPUT GOES (the teaching layer): families/specs teaching/<book>/families/, runs under runs/<book>/{misconceptions,
families,widgets}/ as the runbook names them.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import assemble_misconceptions as AM  # noqa: E402
import book_config  # noqa: E402
import crop_figures as CF  # noqa: E402
import subprocess  # noqa: E402
import embed_workflow as EW  # noqa: E402
import workflow_runner as WR  # noqa: E402


def in_lessons(lo: str | None, slugs: list[str]) -> bool:
    return any(str(lo or "").startswith(f"lo:{s}-") for s in slugs)


def unit_bundles(book: str, slugs: list[str]) -> list[dict]:
    """The compiled bundles, cut to the named lessons' objectives, questions, visuals and worked examples."""
    out = []
    for f in sorted((HERE / "compiled" / book).glob("*.json")):
        b = json.loads(f.read_text())
        if "nodes" not in b:
            continue
        los = [n for n in b["nodes"] if n.get("kind") == "learning_objective" and in_lessons(n["id"], slugs)]
        if not los:
            continue
        out.append({**b, "nodes": los,
                    "questions": [q for q in b.get("questions") or [] if in_lessons(q["lo"], slugs) and not q.get("hold_reason")],
                    "visuals": [v for v in b.get("visuals") or [] if in_lessons(v["lo"], slugs)],
                    "explanation_entries": [e for e in b.get("explanation_entries") or [] if in_lessons(e["lo"], slugs)]})
    if not out:
        raise SystemExit(f"no compiled objectives for {slugs} in compiled/{book}/: run compile_book_records.py first")
    return out


def evidence_runs(book: str, slugs: list[str]) -> list[dict]:
    """The book's own cautions, as Grade 10's caution claims (the only field s5_args reads from them)."""
    claims = []
    for s in slugs:
        rec = json.loads((HERE / "book-records" / book / f"{s}.json").read_text())
        for it in rec.get("items") or []:
            if it["type"] == "caution" and it.get("lo"):
                claims.append({"lo": f"lo:{s}-{int(it['lo'].rsplit('-', 1)[1])}", "type": "caution", "supported": True,
                               "anchor": it["id"], "printed_page": it.get("source_page"), "text": it.get("claim") or ""})
    return [{"claims": claims, "items": []}]


# A printed contrast ("X × Y ≠ Y × X", "(a, b) is not equal to {a, b}") is the book telling the student what NOT to
# conclude: a caution in all but its box. A "Notice that…" line is a worked-example remark. Both are S5's `remark`
# evidence (misconceptions.workflow.js: "the book's caution boxes and worked-example remarks"; Tamer, 2026-10-16,
# for a book that prints no caution boxes and no multiple choice).
CONTRAST = re.compile(r"≠|\\neq|\\ne\b|\bnot equal\b|\bis not\b|\bare not\b|\bdoes not\b|\bcannot\b|\bnever\b", re.I)
REMARK = re.compile(r"^\s*(notice|note|remember|attention)\b", re.I)
STATEMENTS = ("definition", "rule", "caution", "convention", "method", "linking_text")


def remark_sources(book: str, slugs: list[str]) -> list[dict]:
    """The book's printed contrasts and its "Notice that" remarks, as S5 `remark` sources, filed under their objective."""
    import answer_gen as AG  # noqa: PLC0415  (with_intended: misprints corrected)
    out, seen = [], set()
    for s in slugs:
        rec = json.loads((HERE / "book-records" / book / f"{s}.json").read_text())
        items = rec.get("items") or []
        for i, raw in enumerate(items):
            it = AG.with_intended(raw)
            lo = it.get("lo")
            if not lo:   # linking text has none: the nearest filed record on its page
                near = sorted((abs(j - i), j) for j, x in enumerate(items) if x.get("lo") and x.get("source_page") == it.get("source_page"))
                lo = items[near[0][1]]["lo"] if near else None
            if not lo:
                continue
            lo_id = f"lo:{s}-{int(lo.rsplit('-', 1)[1])}"
            texts = []
            if it["type"] in STATEMENTS:
                t = it.get("claim") or it.get("text") or ""
                if CONTRAST.search(t) or REMARK.search(t) or REMARK.search(it.get("quote") or ""):
                    texts.append(t)
            for line in it.get("solution") or []:
                if REMARK.search(line):
                    texts.append(line)
            for t in texts:
                if t and (it["id"], t) not in seen:
                    seen.add((it["id"], t))
                    out.append({"lo": lo_id, "kind": "remark", "ref": it["id"], "page": it.get("source_page"), "text": t})
    return out


def question_figures(book: str, bundles: list[dict]) -> dict[str, list[str]]:
    """question id → the crop files of the figures it shows (a drawing's own figure, or the book picture's file)."""
    figs: dict[str, list[str]] = {}
    for b in bundles:
        for v in b.get("visuals") or []:
            if not v.get("question"):
                continue
            if v["kind"] == "book_image":
                name = str(v["spec"].get("src", "")).rsplit("/", 1)[-1]
            else:
                m = re.match(r"^v:([^:]+):(figure-\d+)", v["id"])
                name = CF.crop_name(f"{m.group(1)}:{m.group(2)}") if m else ""
            path = CF.figures_dir(book) / name
            if name and path.exists() and str(path) not in figs.get(v["question"], []):
                figs.setdefault(v["question"], []).append(str(path.resolve()))
    return figs


def book_view(book: str, slugs: list[str]) -> Path:
    """A copy of the book config whose bundles are the compiled ones, cut to the named lessons (see the docstring)."""
    d = HERE / "work" / book / "bookrecord"
    d.mkdir(parents=True, exist_ok=True)
    rels = []
    for i, b in enumerate(unit_bundles(book, slugs)):
        f = d / f"bundle-{i + 1}.json"
        f.write_text(json.dumps(b, ensure_ascii=False, indent=1) + "\n")
        rels.append(str(f.relative_to(book_config.REPO_ROOT)))
    cfg = json.loads((HERE / "books" / f"{book}.json").read_text())
    cfg.update({"bundles": rels, "superseded_bundles": {}, "content_files": [], "generated": None, "parity": None,
                "lesson_titles": {k: v for k, v in (cfg.get("lesson_titles") or {}).items() if k in slugs}})
    view = d / f"{book}.json"
    view.write_text(json.dumps(cfg, ensure_ascii=False, indent=1) + "\n")
    return view


def families_dir(book: str) -> Path:
    return HERE / "teaching" / book / "families"


def gq(*argv: str) -> None:
    """generate_questions.py, the same command the runbook names."""
    p = subprocess.run(["uv", "run", "generate_questions.py", *argv], cwd=HERE, text=True, capture_output=True)
    sys.stderr.write(p.stdout[-3000:] + p.stderr[-3000:])
    if p.returncode not in (0,):
        raise SystemExit(f"generate_questions.py {' '.join(argv[:4])} … failed ({p.returncode})")


TRIAL_DSN = "postgres://ainext_maint:ainext_maint@127.0.0.1:5432/ainext_bookrecord_trial"


def gw(*argv: str) -> None:
    """generate_widget_questions.py, the same command the runbook names."""
    p = subprocess.run(["uv", "run", "generate_widget_questions.py", *argv], cwd=HERE, text=True, capture_output=True)
    sys.stderr.write(p.stdout[-3000:] + p.stderr[-3000:])
    if p.returncode != 0:
        raise SystemExit(f"generate_widget_questions.py {' '.join(argv[:4])} … failed ({p.returncode})")


def widgets_dir(book: str) -> Path:
    return HERE / "teaching" / book / "widgets"


def s5_args(book_name: str, slugs: list[str], stage: str, distractors: list[dict], draft: dict | None) -> dict:
    book = book_config.load_book(book_name)
    bundles = unit_bundles(book_name, slugs)
    args = AM.s5_args(book, bundles, evidence_runs(book_name, slugs), stage, distractors, draft)
    args["sources"] += remark_sources(book_name, slugs)
    figs = question_figures(book_name, bundles)
    by_id = {q["id"]: q for b in bundles for q in b["questions"]}
    for q in args["questions"]:
        src = by_id.get(q["id"], {})
        if "worked example" in (src.get("source_note") or "") or q["id"].startswith("expl:"):
            q["kind"] = "worked_example"   # compile's note says "The book's own worked example (…)"
        if figs.get(q["id"]):
            q["figures"] = figs[q["id"]]
    return args


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s5 = sub.add_parser("s5", help="S5 misconceptions (runbook/misconceptions.workflow.js), draft or final")
    s5.add_argument("book")
    s5.add_argument("lessons", nargs="+")
    s5.add_argument("--stage", choices=("draft", "final"), required=True)
    s5.add_argument("--draft", type=Path, help="final: the draft run's saved return")
    s5.add_argument("--distractors", type=Path, action="append", default=[], help="final: S6/S7's s5-distractors files")
    s5.add_argument("--cap", type=float, default=5.0)
    s5.add_argument("--args-only", action="store_true", help="write the embedded copy for Claude Code and stop")
    s6a = sub.add_parser("s6-author", help="S6 author (runbook/families.workflow.js, mode author), then --check")
    s6a.add_argument("book")
    s6a.add_argument("lessons", nargs="+")
    s6a.add_argument("--catalogue", type=Path, required=True, help="the S5 draft run (or a catalogue)")
    s6a.add_argument("--cap", type=float, default=6.0)
    s6a.add_argument("--args-only", action="store_true")
    s6g = sub.add_parser("s6-grade", help="S6 grade (families.workflow.js, mode grade) on the checked specs")
    s6g.add_argument("book")
    s6g.add_argument("lessons", nargs="+")
    s6g.add_argument("--cap", type=float, default=6.0)
    s6g.add_argument("--args-only", action="store_true")
    for name in ("s7-author", "s7-verify"):
        c = sub.add_parser(name, help=f"S7 {name.split('-')[1]} (runbook/widgets.workflow.js) against the database's graph")
        c.add_argument("book")
        c.add_argument("lessons", nargs="+")
        c.add_argument("--catalogue", type=Path, required=True, help="the S5 draft run")
        c.add_argument("--dsn", default=TRIAL_DSN, help="the database holding the compiled lessons (default: the trial)")
        c.add_argument("--cap", type=float, default=6.0)
        c.add_argument("--args-only", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd in ("s7-author", "s7-verify"):
        view = book_view(a.book, a.lessons)
        runs = HERE / "runs" / a.book / "widgets"
        runs.mkdir(parents=True, exist_ok=True)
        wdir = widgets_dir(a.book)
        wdir.mkdir(parents=True, exist_ok=True)
        mode = a.cmd.split("-")[1]
        wargs = runs / f"s7-{mode}.args.json"
        common = ["--templates", str(wdir), "--book", str(view), "--dsn", a.dsn, "--catalogue", str(a.catalogue)]
        if mode == "author":
            gw(*common, "--only-lessons", ",".join(a.lessons), "--author-args", str(wargs))
        else:
            gw(*common, "--verify-args", str(wargs))
        copy = EW.default_out(a.book, "widgets", f"s7-{mode}.bookrecord")
        print(EW.summary(EW.write(HERE / "runbook" / "widgets.workflow.js", json.loads(wargs.read_text()), copy)), file=sys.stderr)
        if a.args_only:
            return 0
        run, _res, _cost = WR.run_copy(copy, [CF.figures_dir(a.book)], a.cap, f"s7-{mode}", a.book, "widgets")
        if mode == "author":   # the runbook's merge (one run) writes the templates, never overwriting
            gw("--merge-author-runs", str(run), "--merged", str(runs / "author-merged.json"), "--write-templates", str(wdir))
        return 0
    if a.cmd == "s6-author":
        import fanout  # noqa: PLC0415  (write_specs: the fan-out's own spec writer)
        import generate_questions as GQ  # noqa: PLC0415
        from families import spec as FS  # noqa: PLC0415
        view = book_view(a.book, a.lessons)
        book = book_config.load_book(view)
        fam = families_dir(a.book)
        fam.mkdir(parents=True, exist_ok=True)
        specs, _problems = FS.load_dir(fam)
        entries, _alias = GQ.load_catalogue(a.catalogue)
        objectives = GQ.book_objectives(book)
        args = GQ.author_args(book, specs, objectives, entries, False, [], question_figures(a.book, unit_bundles(a.book, a.lessons)))
        print(f"S6 author: {len(args['objectives'])} objective(s) below the tier floor", file=sys.stderr)
        copy = EW.default_out(a.book, "families", "s6-author.bookrecord")
        print(EW.summary(EW.write(HERE / "runbook" / "families.workflow.js", args, copy)), file=sys.stderr)
        if a.args_only:
            return 0
        run, _res, _cost = WR.run_copy(copy, [CF.figures_dir(a.book)], a.cap, "s6-author", a.book, "families")
        written = fanout.write_specs(run, fam, view)
        print(f"wrote {len(written)} spec(s) to {fam.relative_to(HERE)}", file=sys.stderr)
        gq("--families", str(fam), "--book", str(view), "--check")
        return 0
    if a.cmd == "s6-grade":
        view = book_view(a.book, a.lessons)
        runs = HERE / "runs" / a.book / "families"
        runs.mkdir(parents=True, exist_ok=True)
        gargs = runs / "s6-grade.args.json"
        gq("--families", str(families_dir(a.book)), "--book", str(view), "--grading-set", str(runs / "grading-set.json"),
           "--grade-args", str(gargs))
        copy = EW.default_out(a.book, "families", "s6-grade.bookrecord")
        print(EW.summary(EW.write(HERE / "runbook" / "families.workflow.js", json.loads(gargs.read_text()), copy)), file=sys.stderr)
        if a.args_only:
            return 0
        WR.run_copy(copy, [CF.figures_dir(a.book)], a.cap, "s6-grade", a.book, "families")
        return 0
    if a.cmd == "s5":
        draft = json.loads(a.draft.read_text()) if a.draft else None
        # S6 writes {"distractors": […]}, S7 a bare list: both are S5's distractors
        loaded = [json.loads(f.read_text()) for f in a.distractors]
        dists = [d for x in loaded for d in (x.get("distractors", []) if isinstance(x, dict) else x)]
        args = s5_args(a.book, a.lessons, a.stage, dists, draft)
        print(f"S5 {a.stage}: {len(args['objectives'])} objective(s), {len(args['questions'])} canonical solution(s), "
              f"{len(args['sources'])} evidence item(s) (cautions and remarks), {len(args['distractors'])} distractor(s)", file=sys.stderr)
        copy = EW.default_out(a.book, "misconceptions", f"s5-{a.stage}.bookrecord")
        print(EW.summary(EW.write(HERE / "runbook" / "misconceptions.workflow.js", args, copy)), file=sys.stderr)
        if a.args_only:
            return 0
        WR.run_copy(copy, [CF.figures_dir(a.book)], a.cap, f"s5-{a.stage}", a.book, "misconceptions")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

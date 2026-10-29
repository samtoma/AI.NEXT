"""The generation steps (S5 misconceptions, S6 question families, S7 widget questions) for book-record lessons.

    uv run book_record_generation.py s5 prep3-math-en u1-1 u1-2 u1-3 u1-4 --stage draft [--cap 5] [--args-only]
    uv run book_record_generation.py s6-author prep3-math-en u1-1 u1-2 u1-3 u1-4 --catalogue runs/<book>/misconceptions/s5-draft.<stamp>.json
    uv run book_record_generation.py s6-grade  prep3-math-en u1-1 u1-2 u1-3 u1-4
    uv run book_record_generation.py s7-author prep3-math-en u1-1 u1-2 u1-3 u1-4 --catalogue <S5 draft run>
    uv run book_record_generation.py s7-verify prep3-math-en u1-1 u1-2 u1-3 u1-4 --catalogue <S5 draft run>
    uv run book_record_generation.py s5 prep3-math-en u1-1 … --stage final --draft runs/<book>/misconceptions/s5-draft.<stamp>.json \
        --distractors runs/<book>/families/s5-distractors.json --distractors runs/<book>/widgets/s5-distractors.json
    uv run book_record_generation.py finish prep3-math-en u1-1 … [--dsn …]   # Samuel's §4 finishing passes → the bundles

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


def latest(book: str, folder: str, prefix: str) -> list[Path]:
    return sorted((HERE / "runs" / book / folder).glob(f"{prefix}.*Z.json"))


def covering(runs: list[Path], slugs: list[str]) -> list[Path]:
    """The runs made for these lessons: a book's runs sit side by side, one set per unit, and each names its objectives."""
    marks = [f'"lo:{s}-' for s in slugs]
    return [r for r in runs if any(m in r.read_text() for m in marks)]


def unit_dir(book: str, src: Path, slugs: list[str], name: str) -> Path:
    """The unit's own files of a book-wide folder (families, widget templates: named <lesson>-<objective>--<id>.json), linked into a
    work folder, so a pass that reads a whole folder sees this unit only and never re-grades or re-writes another's."""
    d = HERE / "work" / book / "unit-view" / slugs[0] / name   # one per unit: units may run side by side
    d.mkdir(parents=True, exist_ok=True)
    for f in d.iterdir():
        f.unlink()
    for f in sorted(src.glob("*.json")) if src.is_dir() else []:
        if any(f.name.startswith(f"{s}-") for s in slugs):   # <lesson>-<objective>--<id>.json
            (d / f.name).symlink_to(f.resolve())
    return d


def merge_unit(src: Path, dst: Path, slugs: list[str]) -> int:
    """A unit's finished file into the book's: the other units' rows kept, this unit's replaced."""
    new = json.loads(src.read_text())
    old = json.loads(dst.read_text()) if dst.exists() else {}
    n = 0
    for key in ("questions", "misconceptions"):
        if key in new or key in old:
            mine = new.get(key) or []
            n += len(mine)
            new[key] = [r for r in old.get(key) or [] if not in_lessons(r.get("lo_id"), slugs)] + mine
    dst.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n")
    return n


def finish(book: str, slugs: list[str], dsn: str | None) -> int:
    """Samuel's runbook §4 finishing passes, after S5 final, into teaching/<book>/generated/ (what compile reads):
      1. the misconception catalogue from S5's final run (assemble_misconceptions.py --catalogue-only: pass 1);
      2. the generated questions from the families the blind grade passed (generate_questions.py --grades);
      3. the widget questions from the templates the verifier confirmed (generate_widget_questions.py --verdicts), when
         a template is left (one with no confirmed mapping is held, `widgets-held/`, as his runbook says);
      4. the catalogue again with the bundles (pass 2: strips the distractor links S5 refused).
    Each is his command, unchanged; a failure stops here and says which."""
    view = book_view(book, slugs)
    gdir = HERE / "teaching" / book / "generated"
    gdir.mkdir(parents=True, exist_ok=True)
    final = covering(latest(book, "misconceptions", "s5-final"), slugs)
    if not final:
        raise SystemExit(f"no S5 final run for {slugs}: run `s5 … --stage final` first")
    # the passes write this unit's files in a work folder; they are merged into the book's after (other units kept)
    wout = HERE / "work" / book / "unit-view" / slugs[0] / "generated"
    wout.mkdir(parents=True, exist_ok=True)
    for f in wout.glob("*.json"):
        f.unlink()
    cat, gq_out, wq_out = wout / "misconceptions.json", wout / "generated-questions.json", wout / "widget-questions.json"
    fam_dir = unit_dir(book, families_dir(book), slugs, "families")

    def run(*argv: str) -> None:
        p = subprocess.run(["uv", "run", *argv], cwd=HERE, text=True, capture_output=True)
        sys.stderr.write(p.stdout[-2500:] + p.stderr[-2500:])
        if p.returncode != 0:
            raise SystemExit(f"{argv[0]} failed ({p.returncode})")
    run("assemble_misconceptions.py", str(final[-1]), "--book", str(view), "--out", str(cat), "--catalogue-only")
    grades = latest(book, "families", "s6-grade")
    fams = list(fam_dir.glob("*.json"))
    bundles = []
    if fams and grades:
        run("generate_questions.py", "--families", str(fam_dir), "--book", str(view), "--catalogue", str(cat),
            "--grades", *map(str, grades), "--out", str(gq_out))
        bundles.append(gq_out)
    wdir = unit_dir(book, widgets_dir(book), slugs, "widgets")
    # s7b-*: the book-widget variant's runs (book_widgets.py, runbook/widgets-book.workflow.js), read beside S7's own
    # and like them FAIL CLOSED: a claim any run refused stays held until a person decides. A run made with a prompt
    # found defective is moved to runs/<book>/widgets/superseded/ with the reason, never silently outvoted.
    verdicts = latest(book, "widgets", "s7-verify") + latest(book, "widgets", "s7b-verify")
    if any(wdir.glob("*.json")) and verdicts and dsn:
        # --catalogue: the unit's own entries (pass 1, above) are not in the scratch database yet, so without it every
        # widget diagnostic naming one is dropped as "not in the catalogue" and the bundle pass cannot strip it
        run("generate_widget_questions.py", "--templates", str(wdir), "--book", str(view), "--dsn", dsn, "--catalogue", str(cat),
            "--verdicts", *map(str, verdicts), "--gaps", *map(str, latest(book, "widgets", "s7-author") + latest(book, "widgets", "s7b-author")),
            "--pending-review", str(HERE / "reviews" / book / f"widget-mappings-pending.{slugs[0]}.json"), "--out", str(wq_out))
        bundles.append(wq_out)
    if bundles:
        # --graph: a widget may name a prerequisite's misconception (FR-1215), checked against the book's SeedBundles'
        # prerequisite edges, as Samuel's fan-out passes them (fanout_advance.py)
        seeds = [book_config.REPO_ROOT / b for b in json.loads(view.read_text()).get("bundles") or []]
        run("assemble_misconceptions.py", str(final[-1]), "--book", str(view), "--out", str(cat),
            *[x for b in bundles for x in ("--bundle", str(b))], *[x for g in seeds for x in ("--graph", str(g))])
    for f in [cat, *bundles]:
        n = merge_unit(f, gdir / f.name, slugs)
        print(f"finished: {n} row(s) of {slugs[0]}… into {(gdir / f.name).relative_to(HERE)}", file=sys.stderr)
    for f in (gq_out, wq_out):   # a file the unit no longer makes (every family held): its old rows go
        if f not in bundles and (gdir / f.name).exists():
            d = json.loads((gdir / f.name).read_text())
            before = len(d.get("questions") or [])
            d["questions"] = [q for q in d.get("questions") or [] if not in_lessons(q.get("lo_id"), slugs)]
            if len(d["questions"]) != before:
                (gdir / f.name).write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
                print(f"finished: {before - len(d['questions'])} old row(s) of {slugs[0]}… removed from {(gdir / f.name).relative_to(HERE)}", file=sys.stderr)
    return 0


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


def held_ledger(book: str) -> Path:
    return HERE / "teaching" / book / "held.json"


def record_held(book: str, kind: str, name: str, out: str, how: str) -> None:
    """Why a family or widget template was held (teaching/<book>/held.json, format `ainext.held/1`), for the review
    tool's Held generation task: the check's lines that name it."""
    stem = name.removesuffix(".json")
    obj, _, slug = stem.partition("--")
    tpl = f"tpl:{obj}:{slug}"
    reasons = [l.strip().removeprefix("x ").strip() for l in out.splitlines()
               if l.strip().startswith("x ") and (name in l or re.search(re.escape(tpl) + r"\b", l))]
    p = held_ledger(book)
    doc = json.loads(p.read_text()) if p.exists() else {"format": "ainext.held/1", "book": book, "items": {}}
    doc["items"][f"{kind}:{name}"] = {"kind": kind, "file": name, "objective": f"lo:{obj}", "lesson": obj.rsplit("-", 1)[0],
                                      "reasons": list(dict.fromkeys(reasons)) or ["the check refused it (no line named it)"],
                                      "held_by": how, "at": __import__("datetime").date.today().isoformat()}
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")


def author_again(book: str, slugs: list[str], objectives: list[str], notes: dict[str, str | None], cap: float) -> Path:
    """S6's author for the named objectives only (book_record_held.py reauthor: the families a person sent back), with
    each held family and why it was held, and the person's note, beside the objective's description: Samuel's author
    prompt shows the description, so this is how the author learns what to change. Writes and checks the specs as
    s6-author does; returns the run."""
    import fanout  # noqa: PLC0415
    import generate_questions as GQ  # noqa: PLC0415
    from families import spec as FS  # noqa: PLC0415
    view = book_view(book, slugs)
    bk = book_config.load_book(view)
    fam = families_dir(book)
    specs, _problems = FS.load_dir(fam)
    cat = covering(latest(book, "misconceptions", "s5-draft"), slugs)
    if not cat:
        raise SystemExit(f"no S5 draft for {slugs}")
    entries, _alias = GQ.load_catalogue(cat[-1])
    args = GQ.author_args(bk, specs, GQ.book_objectives(bk), entries, False, [], question_figures(book, unit_bundles(book, slugs)))
    led = json.loads(held_ledger(book).read_text()) if held_ledger(book).exists() else {"items": {}}
    keep = []
    for o in args["objectives"]:
        if o["lo_id"] not in objectives:
            continue
        sent = [(n, led["items"].get(f"family:{n}", {})) for n in notes if f"lo:{n.partition('--')[0]}" == o["lo_id"]]
        o["description"] = (o.get("description") or "") + "".join(
            f"\n\nA PERSON SENT BACK an earlier family for this objective ({n}): it was held because "
            f"{'; '.join(e.get('reasons') or ['the checks refused it'])}. Their note: {notes[n]}. Its spec was: "
            f"{(fam / ('_held--' + n)).read_text()[:3000] if (fam / ('_held--' + n)).exists() else '(gone)'}. "
            "Write a family that does what it meant to, without those faults." for n, e in sent)
        o["tier_gaps"] = o.get("tier_gaps") or ["standard"]   # a sent-back family is wanted even past the floor
        keep.append(o)
    if not keep:
        raise SystemExit(f"none of {objectives} is an objective of {slugs}")
    args["objectives"] = keep
    copy = EW.default_out(book, "families", "s6-reauthor.bookrecord")
    print(EW.summary(EW.write(HERE / "runbook" / "families.workflow.js", args, copy)), file=sys.stderr)
    run, _res, _cost = WR.run_copy(copy, [CF.figures_dir(book)], cap, "s6-author", book, "families", stage="S6")
    written = fanout.write_specs(run, fam, view)
    print(f"wrote {len(written)} spec(s) to {fam.relative_to(HERE)}", file=sys.stderr)
    hold_malformed(book, slugs, view)
    return run


TOPUP_BELOW = 3   # an objective with fewer live book questions than this, and no usable family, is topped up


def topup_targets(objectives: dict, specs, below: int = TOPUP_BELOW) -> list[str]:
    """The objectives S6 left thin: fewer than `below` live (verified) book questions, no family that is not held, and
    something to model one on (a book question or a teaching item). Pure: tests/test_s6_topup.py."""
    have = {s.lo_id for s in specs}
    out = []
    for lo, rec in sorted(objectives.items()):
        live = sum(1 for q in rec.get("questions") or [] if q.get("verified", True))
        if live < below and lo not in have and (rec.get("questions") or rec.get("teaching")):
            out.append(lo)
    return out


def s6_topup(book: str, slugs: list[str], catalogue: Path, cap: float, args_only: bool = False,
             only: list[str] | None = None) -> list[Path]:
    """S6 again, only for the objectives it left thin (topup_targets), now that a family may be modelled on a worked
    example (answer 40; the S6 author shows them, generate_questions.teaching_parents): author, land (fanout.write_specs
    makes a teaching parent explicit), hold what --check refuses, then grade ONLY the new families, blind, as s6-grade
    does. `finish` reads every s6-grade run, so their grades join the unit's. ingest.py runs it as "S6 top-up" after S6,
    for every book: Prep 3 found 43 of 104 objectives with two live questions or fewer, none with a generated one,
    because a family needed a book QUESTION as its parent (Tamer, 2026-10-29)."""
    import fanout  # noqa: PLC0415
    import generate_questions as GQ  # noqa: PLC0415
    from families import spec as FS  # noqa: PLC0415
    view = book_view(book, slugs)
    bk = book_config.load_book(view)
    fam = families_dir(book)
    fam.mkdir(parents=True, exist_ok=True)
    specs, _problems = FS.load_dir(fam)
    objectives = GQ.book_objectives(bk)
    targets = topup_targets({lo: r for lo, r in objectives.items() if in_lessons(lo, slugs)}, specs)
    if only:   # a person named the objectives (one whose book questions came later than S6): they need a parent only
        targets = [lo for lo in only if lo in objectives and (objectives[lo].get("questions") or objectives[lo].get("teaching"))]
    print(f"S6 top-up: {len(targets)} thin objective(s) with no usable family: {', '.join(targets) or '-'}", file=sys.stderr)
    if not targets:
        return []
    entries, _alias = GQ.load_catalogue(catalogue)
    args = GQ.author_args(bk, specs, objectives, entries, True, [], question_figures(book, unit_bundles(book, slugs)))
    floor = GQ.tier_floor(objectives, [])
    gaps = {b["lo_id"]: b["missing"] for b in floor["below_floor"]}
    args["objectives"] = [{**o, "tier_gaps": gaps.get(o["lo_id"]) or ["basic", "standard"]}
                          for o in args["objectives"] if o["lo_id"] in targets]
    copy = EW.default_out(book, "families", "s6-topup.bookrecord")
    print(EW.summary(EW.write(HERE / "runbook" / "families.workflow.js", args, copy)), file=sys.stderr)
    if args_only:
        return []
    run, _res, _cost = WR.run_copy(copy, [CF.figures_dir(book)], cap, "s6-author", book, "families", stage="S6")
    written = fanout.write_specs(run, fam, view)
    print(f"wrote {len(written)} spec(s) to {fam.relative_to(HERE)}", file=sys.stderr)
    hold_malformed(book, slugs, view)
    new = [p for p in written if p.exists()]   # a held one was renamed _held--…
    if not new:
        return []
    grade_only(book, slugs, view, new, cap, "topup")
    return new


def grade_only(book: str, slugs: list[str], view: Path, files: list[Path], cap: float, label: str) -> None:
    """Grade ONLY these families, blind, as s6-grade does; `finish` reads every s6-grade run. For new families (the
    top-up) and for ones a person fixed or released from hold (s6-regrade): the unit's accepted families are never
    graded again, so a second blind run can never reject one."""
    d = HERE / "work" / book / "unit-view" / slugs[0] / f"families-{label}"
    d.mkdir(parents=True, exist_ok=True)
    for f in d.iterdir():
        f.unlink()
    for p in files:
        (d / p.name).symlink_to(p.resolve())
    runs = HERE / "runs" / book / "families"
    gargs = runs / f"s6-{label}-grade.args.json"
    gq("--families", str(d), "--book", str(view), "--grading-set", str(runs / f"grading-set.{label}.json"), "--grade-args", str(gargs))
    gcopy = EW.default_out(book, "families", f"s6-grade.{label}.bookrecord")
    print(EW.summary(EW.write(HERE / "runbook" / "families.workflow.js", json.loads(gargs.read_text()), gcopy)), file=sys.stderr)
    WR.run_copy(gcopy, [CF.figures_dir(book)], cap, "s6-grade", book, "families", stage="S6")


def repoint_parents(view: Path, files: list[Path]) -> list[str]:
    """A family modelled on a worked example whose book item has since become a question (compile asks a form it
    could not mark before: `expl:<objective>:bk-<item>` is now `q:<objective>:bk-<item>`, Tamer, 2026-10-29) points
    at the question instead, recorded in the spec's notes. The item is the same; only how the book record holds it
    changed, so nothing is held for it. The changed spec is graded again like any other (its sha changes)."""
    import generate_questions as GQ  # noqa: PLC0415
    qids, teaching = GQ.book_parents(book_config.load_book(view))
    done = []
    for f in files:
        spec = json.loads(f.read_text())
        parent = str(spec.get("parent_question_id") or "")
        q = "q:" + parent.removeprefix("expl:")
        if spec.get("parent_kind") == "teaching" and parent.startswith("expl:") and parent not in teaching and q in qids:
            spec["parent_question_id"], spec["parent_kind"] = q, "question"
            spec["notes"] = (spec.get("notes") or "") + (f" PIPELINE NORMALISATION (not an author edit): the parent {parent} became the "
                                                        f"book question {q} when compile learned to mark its answer; re-pointed.")
            f.write_text(json.dumps(spec, indent=1, ensure_ascii=False) + "\n")
            done.append(f.name)
    if done:
        print(f"re-pointed {len(done)} famil(ies) from a worked example to the book question it became: {done}", file=sys.stderr)
    return done


def hold_malformed(book: str, slugs: list[str], view: Path) -> list[str]:
    """generate_questions.py --check on the unit's families; a family it refuses is held, `_held--<file>` (Samuel's
    convention, FR-1101: nothing is instantiated from a malformed spec), so one bad family never stops the unit (nor
    makes the fan-out pay to author them all again). The held files and their problems are printed; a person may fix
    and un-hold one."""
    fam = families_dir(book)
    held: list[str] = []
    # Samuel's fan-out normalises before it checks (fanout_advance s6-author): a format slip the pipeline fixes the
    # same way every time (families/normalise.py) is fixed and recorded in the spec's notes, never held. Prep 3 held
    # six families for a top-level "answer" beside the real one (2026-10-29)
    mine = [f for f in sorted(fam.glob("*.json")) if any(f.name.startswith(f"{s}-") for s in slugs)]
    repoint_parents(view, mine)
    if mine:
        p = subprocess.run(["uv", "run", "python", "-m", "families.normalise", *map(str, mine)], cwd=HERE, text=True, capture_output=True)
        changed = [l for l in p.stdout.splitlines() if l.strip() and not l.endswith("nothing to normalise")]
        if changed or p.returncode:
            print("families.normalise:\n" + "\n".join(changed) + (("\n" + p.stderr.strip()) if p.stderr.strip() else ""), file=sys.stderr)
    for _round in range(4):   # holding one can bring the next problem to light (a check stops at some)
        argv = ["uv", "run", "generate_questions.py", "--families", str(unit_dir(book, fam, slugs, "families")), "--book", str(view), "--check"]
        p = subprocess.run(argv, cwd=HERE, text=True, capture_output=True)
        out = p.stdout + p.stderr
        bad = set(re.findall(r"^\s*x ([A-Za-z0-9._-]+\.json):", out, re.M))
        # two families whose item ids would collide ("tpl:<obj>:<a> and tpl:<obj>:<b> share …"): the second is held
        bad |= {f"{o}--{b}.json" for o, b in re.findall(r"^\s*x tpl:[a-z0-9-]+:[a-z0-9-]+ and tpl:([a-z0-9-]+):([a-z0-9-]+) share", out, re.M)}
        # families that evaluate to nothing ("families that produced nothing: tpl:<obj>:<slug>, …"): held
        for line in re.findall(r"families that produced nothing: (.*)$", out, re.M):
            bad |= {f"{o}--{b}.json" for o, b in re.findall(r"tpl:([a-z0-9-]+):([a-z0-9-]+)", line)}
        # families whose instances fail to evaluate ("rejected: tpl:<obj>:<slug>: evaluation error: …" — a spec bug,
        # e.g. a numeric answer written as '28/29'): held, or the unit's --check fails on them every round
        bad |= {f"{o}--{b}.json" for o, b in re.findall(r"^\s*x rejected: tpl:([a-z0-9-]+):([a-z0-9-]+): evaluation error", out, re.M)}
        # a family whose parent is neither a book question nor a book teaching item (a worked example) of the unit
        # (FR-1101 as amended by answer 40: S6 used to write "q:<objective>:none" for an objective with no question)
        import generate_questions as GQ  # noqa: PLC0415
        qids, teaching = GQ.book_parents(book_config.load_book(view))
        for f in unit_dir(book, fam, slugs, "families").glob("*.json"):
            spec = json.loads(f.read_text())
            parent, kind = spec.get("parent_question_id"), spec.get("parent_kind", "question")
            if not (parent in qids if kind == "question" else kind == "teaching" and parent in teaching):
                bad.add(f.name)
                out += (f"\n  x {f.name}: its parent {parent!r} is not a book {'teaching item' if kind == 'teaching' else 'question'}"
                        " of the unit (FR-1101)")
        bad = sorted(n for n in bad if (fam / n).exists())
        if not bad:
            break
        for name in bad:
            (fam / name).rename(fam / f"_held--{name}")
            record_held(book, "family", name, out, "S6 check (generate_questions.py --check)")
        held += bad
        print(f"held {len(bad)} malformed famil(ies) (_held--): {bad}\n" + "\n".join(l for l in out.splitlines() if l.strip().startswith("x ")),
              file=sys.stderr)
    unit_dir(book, fam, slugs, "families")   # relinked without the held ones
    gq(*argv[3:])   # what is left must pass
    return held


def merge_author(book: str, slugs: list[str], run: Path) -> list[str]:
    """The runbook's merge of an S7 author run writes the unit's templates. It refuses a templates folder holding any it
    did not write (another unit's), so it writes into the unit's own, empty folder; the templates are then copied into
    the book's (teaching/<book>/widgets/), never overwriting one."""
    wdir = widgets_dir(book)
    wdir.mkdir(parents=True, exist_ok=True)
    fresh = HERE / "work" / book / "unit-view" / slugs[0] / "widgets-new"
    fresh.mkdir(parents=True, exist_ok=True)
    for f in fresh.glob("*.json"):
        f.unlink()
    gw("--merge-author-runs", str(run), "--merged", str(HERE / "runs" / book / "widgets" / "author-merged.json"),
       "--write-templates", str(fresh))
    added = []
    for f in sorted(fresh.glob("*.json")):
        if not (wdir / f.name).exists():
            (wdir / f.name).write_bytes(f.read_bytes())
            added.append(f.name)
    print(f"wrote {len(added)} template(s) of {slugs[0]}… to {wdir.relative_to(HERE)}", file=sys.stderr)
    return added


def hold_malformed_templates(book: str, slugs: list[str], wdir: Path, argv: list[str]) -> list[str]:
    """A widget template generate_widget_questions.py rejects ("a malformed template renders nothing") moves to
    teaching/<book>/widgets-held/, as Samuel's runbook holds them, so the unit's other templates are still verified."""
    p = subprocess.run(["uv", "run", "generate_widget_questions.py", *argv], cwd=HERE, text=True, capture_output=True)
    out = p.stdout + p.stderr
    bad = sorted(set(re.findall(r"^\s*x ([A-Za-z0-9._-]+\.json):", out, re.M))) if p.returncode else []
    held = HERE / "teaching" / book / "widgets-held"
    held.mkdir(parents=True, exist_ok=True)
    for name in bad:
        if (wdir / name).exists():
            (wdir / name).rename(held / name)
            record_held(book, "template", name, out, "S7 verify (generate_widget_questions.py)")
    if bad:
        print(f"held {len(bad)} malformed widget template(s) → widgets-held/: {bad}\n"
              + "\n".join(l for l in out.splitlines() if l.strip().startswith("x ")), file=sys.stderr)
    return bad


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
    fin = sub.add_parser("finish", help="Samuel's §4 finishing passes after S5 final: catalogue, questions, widgets")
    fin.add_argument("book")
    fin.add_argument("lessons", nargs="+")
    fin.add_argument("--dsn", default=None, help="the database holding the lessons, for the widget pass")
    s6g = sub.add_parser("s6-grade", help="S6 grade (families.workflow.js, mode grade) on the checked specs")
    s6g.add_argument("book")
    s6g.add_argument("lessons", nargs="+")
    s6g.add_argument("--cap", type=float, default=6.0)
    s6g.add_argument("--args-only", action="store_true")
    s6r = sub.add_parser("s6-regrade", help="check, then grade ONLY the named families (fixed or released from hold)")
    s6r.add_argument("book")
    s6r.add_argument("lessons", nargs="+")
    s6r.add_argument("--families", nargs="+", required=True, help="family file names in teaching/<book>/families/")
    s6r.add_argument("--cap", type=float, default=2.0)
    s6t = sub.add_parser("s6-topup", help="S6 author + grade again for the objectives S6 left thin, worked examples as parents")
    s6t.add_argument("book")
    s6t.add_argument("lessons", nargs="+")
    s6t.add_argument("--catalogue", type=Path, required=True, help="the S5 draft run (or a catalogue)")
    s6t.add_argument("--cap", type=float, default=4.0)
    s6t.add_argument("--args-only", action="store_true")
    s6t.add_argument("--objectives", nargs="+", help="these objectives (lo:…), whatever their count; each needs a book parent")
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
        common = ["--templates", str(wdir if mode == "author" else unit_dir(a.book, wdir, a.lessons, "widgets")),
                  "--book", str(view), "--dsn", a.dsn, "--catalogue", str(a.catalogue)]
        if mode == "author":
            gw(*common, "--only-lessons", ",".join(a.lessons), "--author-args", str(wargs))
        else:
            if not any(unit_dir(a.book, wdir, a.lessons, "widgets").glob("*.json")):
                print(f"S7 verify: no widget template for {a.lessons} (the author's gaps go to Samuel): nothing to verify",
                      file=sys.stderr)
                return 0
            hold_malformed_templates(a.book, a.lessons, wdir, [*common, "--verify-args", str(wargs)])
            if not any(unit_dir(a.book, wdir, a.lessons, "widgets").glob("*.json")):
                print("S7 verify: every template of the unit was malformed and is held: nothing to verify", file=sys.stderr)
                return 0
            common[1] = str(unit_dir(a.book, wdir, a.lessons, "widgets"))
            gw(*common, "--verify-args", str(wargs))
        copy = EW.default_out(a.book, "widgets", f"s7-{mode}.bookrecord")
        print(EW.summary(EW.write(HERE / "runbook" / "widgets.workflow.js", json.loads(wargs.read_text()), copy)), file=sys.stderr)
        if a.args_only:
            return 0
        run, _res, _cost = WR.run_copy(copy, [CF.figures_dir(a.book)], a.cap, f"s7-{mode}", a.book, "widgets", stage="S7")
        if mode == "author":
            merge_author(a.book, a.lessons, run)
        else:   # the verified templates' predicate mappings, for S5's final pass (Samuel's runbook §4: S7 offers S5
            # the misconceptions its widgets diagnose; without them S5 drops those entries and every widget mapping
            # names a misconception S5 did not keep). Written from the S5 DRAFT the templates were authored against.
            out = HERE / "work" / a.book / "unit-view" / a.lessons[0] / "widgets-verified.json"
            gw(*common, "--verdicts", str(run), "--s5-distractors", str(runs / "s5-distractors.json"), "--out", str(out))
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
        run, _res, _cost = WR.run_copy(copy, [CF.figures_dir(a.book)], a.cap, "s6-author", a.book, "families", stage="S6")
        written = fanout.write_specs(run, fam, view)
        print(f"wrote {len(written)} spec(s) to {fam.relative_to(HERE)}", file=sys.stderr)
        hold_malformed(a.book, a.lessons, view)
        return 0
    if a.cmd == "s6-regrade":
        view = book_view(a.book, a.lessons)
        hold_malformed(a.book, a.lessons, view)
        fam = families_dir(a.book)
        files = [fam / n for n in a.families if (fam / n).exists()]
        print(f"s6-regrade: {len(files)} of {len(a.families)} famil(ies) passed the check: {[f.name for f in files]}", file=sys.stderr)
        if files:
            grade_only(a.book, a.lessons, view, files, a.cap, "regrade")
        return 0
    if a.cmd == "s6-topup":
        s6_topup(a.book, a.lessons, a.catalogue, a.cap, a.args_only, a.objectives)
        return 0
    if a.cmd == "s6-grade":
        view = book_view(a.book, a.lessons)
        runs = HERE / "runs" / a.book / "families"
        runs.mkdir(parents=True, exist_ok=True)
        gargs = runs / "s6-grade.args.json"
        gq("--families", str(unit_dir(a.book, families_dir(a.book), a.lessons, "families")), "--book", str(view), "--grading-set", str(runs / "grading-set.json"),
           "--grade-args", str(gargs), "--s5-distractors", str(runs / "s5-distractors.json"))   # S5 final reads these
        copy = EW.default_out(a.book, "families", "s6-grade.bookrecord")
        print(EW.summary(EW.write(HERE / "runbook" / "families.workflow.js", json.loads(gargs.read_text()), copy)), file=sys.stderr)
        if a.args_only:
            return 0
        WR.run_copy(copy, [CF.figures_dir(a.book)], a.cap, "s6-grade", a.book, "families", stage="S6")
        return 0
    if a.cmd == "finish":
        return finish(a.book, a.lessons, a.dsn)
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
        WR.run_copy(copy, [CF.figures_dir(a.book)], a.cap, f"s5-{a.stage}", a.book, "misconceptions", stage="S5")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

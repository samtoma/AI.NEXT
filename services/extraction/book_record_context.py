"""After G1: the book's own context for each objective — its real-life openers and concept introductions — and the questions
set in a real situation (S1C; part of the pipeline by default).

    uv run book_record_context.py run    egb-g11-math 2 [--cap 2]      # two blind readings, then accept
    uv run book_record_context.py args   egb-g11-math 2                # the embedded copy, for Claude Code
    uv run book_record_context.py accept egb-g11-math 2 runs/<book>/context/<saved return>.json

Decided by Tamer, 2026-10-22: each learning objective opens with context, the book's real-life example where it prints
one; the lesson comes back to it at a few points (one "bridge" question set in a real situation, a closing callback) and
the drills stay as they are. It runs on every book through ingest.py with no setting, and nothing waits for a review.

The page reader keeps the book's linking text and files none of it (extract_book_record.NO_OBJECTIVE), so the tutor never
saw it; and an open prompt (the book's "Guiding question" at a lesson's start, its reflection question at the end) reached
the tutor only when it had an approved answer and became a question. Both are read here (Tamer, 2026-10-22: "use both,
and add the closing reflection kind"): an opener and a guiding question open the objective together, a closing
reflection closes it. An open prompt that is also a live question is left to the question bank by compile. Most of it is not context at all ("Solve the following problems.", a worked step, a side note); the obvious
instructions are dropped here without a model, and runbook/context.workflow.js reads the rest twice, blind:
  - a passage both readings give the same kind and the same objective (or both call "none") is AGREED and used as is;
  - the same kind with only its place disputed between the whole lesson and one objective is filed under the whole
    lesson (the tutor places a lesson-wide passage where it fits); any other is HELD: never shown until a person decides it in the review tool's Context task
    (reviews/<book>/context-review.json), decision 47's rule for anything generated: a doubtful one is never shown;
  - a question both readings list as set in a real situation is a BRIDGE candidate for its objective.
The result is teaching/<book>/context/ch<NN>.json. compile_book_records.py reads it with the person's decisions and writes
each objective's context and bridge questions into the lesson's content file (compiled/<book>/content/<slug>.json), which
the tutor reads (app/src/lib/book-statements.ts). The book's text is used as printed: nothing here writes new words.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_config  # noqa: E402

FORMAT = "ainext.context/1"
KINDS = ("real_life", "concept_intro", "closing_reflection", "none")
USED = ("real_life", "concept_intro", "closing_reflection")   # the kinds a lesson uses
PASSAGE_TYPES = ("linking_text", "open_prompt")   # an open prompt is the book's "Guiding question" or its closing reflection
QUESTION_TYPES = ("exercise", "activity", "open_prompt")   # worked examples go to the library, never the question bank
# the book's instructions to the class, never context: dropped without a model
INSTRUCTION = re.compile(r"^\s*(?:solve the following|answer the following|complete the following|find the following|"
                         r"work with a partner|collaborate with your group|discuss with|think and discuss|try\b|"
                         r"side notes?\b|margin note|point!)", re.I)   # the page reader's names for the book's margin notes
MIN_CHARS = 40   # shorter than this is a label or a fragment, never an opener


def record_path(book: str, slug: str) -> Path:
    return HERE / "book-records" / book / f"{slug}.json"


def out_path(book: str, unit: int) -> Path:
    return HERE / "teaching" / book / "context" / f"ch{unit:02d}.json"


def review_path(book: str) -> Path:
    return HERE / "reviews" / book / "context-review.json"


def squash(t: str | None) -> str:
    return " ".join(str(t or "").split())


def is_instruction(text: str) -> bool:
    return len(text) < MIN_CHARS or bool(INSTRUCTION.match(text))


def lesson_view(book: str, slug: str) -> dict:
    rec = json.loads(record_path(book, slug).read_text())
    objs = sorted(rec.get("learning_objectives") or [], key=lambda o: o.get("order_in_parent", 0))
    n_of = {o["id"]: o.get("order_in_parent") or k for k, o in enumerate(objs, 1)}
    passages, dropped, questions = [], [], []
    for it in rec["items"]:
        if it["type"] in PASSAGE_TYPES:
            text = squash(it.get("text"))
            row = {"key": it["id"], "page": it.get("source_page"), "text": text, "type": it["type"].replace("_", " ")}
            (dropped if is_instruction(text) else passages).append(row)
        if it["type"] in QUESTION_TYPES and it.get("lo"):
            parts = " ".join(f"({p.get('label')}) {squash(p.get('stem'))}" for p in it.get("parts") or [] if p.get("stem"))
            questions.append({"key": it["id"], "type": it["type"].replace("_", " "), "page": it.get("source_page"),
                              "objective": n_of.get(it["lo"]), "text": f"{squash(it.get('text') or it.get('stem'))} {parts}".strip()[:500]})
    return {"slug": slug, "title": rec["lesson"].get("title") or slug,
            "objectives": [{"n": n_of[o["id"]], "id": o["id"], "label": o.get("label") or "", "description": o.get("description") or ""}
                           for o in objs],
            "passages": passages, "dropped": dropped, "questions": questions}


def fingerprint(passage: dict, objectives: list[dict]) -> str:   # the key and the text: a decision survives a new kind
    blob = json.dumps({"p": [passage["key"], passage["text"]], "o": [(o["n"], o["label"], o["description"]) for o in objectives]},
                      sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def unit_slugs(book: str, unit: int) -> list[str]:
    import ingest  # noqa: PLC0415
    b = book_config.load_book(book)
    return ingest.unit_lessons(b, ingest.route(b.book), unit)[0]


def build_args(book: str, unit: int, model: str) -> dict:
    b = book_config.load_book(book)
    lessons = [lesson_view(book, s) for s in unit_slugs(book, unit)]
    return {"stage": "context", "book": {"book": book, "title": b.title},
            "lessons": [{"slug": L["slug"], "title": L["title"],
                         "objectives": [{k: o[k] for k in ("n", "label", "description")} for o in L["objectives"]],
                         "passages": L["passages"], "questions": L["questions"]} for L in lessons],
            "options": {"model": model}}


def reading(r: dict | None, valid: set[int]) -> tuple[dict[str, dict], set[str]]:
    """One reading's passages {key: {kind, objective, why}} (an answer outside the lists is no answer) and its questions."""
    if not r:
        return {}, set()
    ps = {}
    for x in r.get("passages") or []:
        if x.get("kind") in KINDS and x.get("objective") in valid:
            ps[x["key"]] = {"kind": x["kind"], "objective": 0 if x["kind"] == "none" else x["objective"], "why": x.get("why")}
    return ps, set(r.get("real_life_questions") or [])


def accept(book: str, unit: int, run_file: Path) -> dict:
    """Compare the two readings and write teaching/<book>/context/ch<NN>.json: agreements used, the rest held."""
    res = json.loads(run_file.read_text())
    if res.get("stage") != "context":
        raise SystemExit(f"{run_file} is not a context return")
    runs = {L["slug"]: L for L in res["lessons"]}
    lessons, report = [], {"agreed": 0, "held": 0, "dropped": 0, "bridges": 0, "lessons": {}}
    for slug in unit_slugs(book, unit):
        view = lesson_view(book, slug)
        valid = {o["n"] for o in view["objectives"]} | {0}
        a, qa = reading((runs.get(slug) or {}).get("A"), valid)
        b, qb = reading((runs.get(slug) or {}).get("B"), valid)
        entries = []
        for p in view["passages"]:
            ra, rb = a.get(p["key"]), b.get(p["key"])
            agreed = bool(ra and rb) and (ra["kind"], ra["objective"]) == (rb["kind"], rb["objective"])
            # the same kind, and only WHERE disputed between the whole lesson and one objective: the whole lesson. The
            # doubt is about placement, not about the passage; the tutor places a lesson-wide passage where it fits.
            # Two different objectives stay held.
            placed = (not agreed and bool(ra and rb) and ra["kind"] == rb["kind"] and ra["kind"] != "none"
                      and 0 in (ra["objective"], rb["objective"]))
            entries.append({**p, "A": ra, "B": rb, "status": "agreed" if agreed or placed else "held",
                            "kind": ra["kind"] if agreed or placed else None,
                            "objective": (ra["objective"] if agreed else 0) if agreed or placed else None,
                            **({"placed": "the whole lesson: the readings named it and one objective"} if placed else {}),
                            "fingerprint": fingerprint(p, view["objectives"])})
        entries += [{**p, "A": None, "B": None, "status": "instruction", "kind": "none", "objective": 0,
                     "fingerprint": fingerprint(p, view["objectives"])} for p in view["dropped"]]
        known = {q["key"] for q in view["questions"]}
        bridges = [{"key": k, "objective": next(q["objective"] for q in view["questions"] if q["key"] == k)}
                   for k in sorted(qa & qb & known)]
        n_used = sum(1 for e in entries if e["status"] == "agreed" and e["kind"] in USED)
        report["agreed"] += sum(1 for e in entries if e["status"] == "agreed")
        report["held"] += sum(1 for e in entries if e["status"] == "held")
        report["dropped"] += len(view["dropped"])
        report["bridges"] += len(bridges)
        report["lessons"][slug] = {"context": n_used, "held": sum(1 for e in entries if e["status"] == "held"), "bridges": len(bridges)}
        lessons.append({"slug": slug, "title": view["title"],
                        "objectives": [{k: o[k] for k in ("n", "id", "label", "description")} for o in view["objectives"]],
                        "passages": entries, "bridges": bridges,
                        "bridges_disputed": sorted((qa ^ qb) & known)})
    doc = {"format": FORMAT, "book": book, "chapter": unit, "made": date.today().isoformat(),
           "made_by": f"book_record_context.py accept ({res.get('prompts_version')})",
           "run": str(run_file.relative_to(HERE)) if run_file.is_relative_to(HERE) else str(run_file), "lessons": lessons}
    out = out_path(book, unit)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    return report


def decisions(book: str) -> dict[str, dict]:
    """The review tool's Context decisions, the latest per passage: keep (with its kind and objective) or drop."""
    p = review_path(book)
    out: dict[str, dict] = {}
    for d in (json.loads(p.read_text()).get("decisions") or []) if p.exists() else []:
        out[d["ref"]] = d   # append-only: the last word wins
    return out


def resolved(book: str, lesson: dict) -> list[dict]:
    """A lesson's passages as the tutor gets them: a person's decision (while the passage and the objectives are what
    they decided on), else an agreement; held, dropped and "none" passages are left out. Each is
    {key, kind, objective (n, 0 for the whole lesson), page, text, by}."""
    dec = decisions(book)
    out = []
    for e in lesson["passages"]:
        d = dec.get(e["key"])
        if d and d.get("fingerprint") == e["fingerprint"]:
            if d["decision"] != "keep" or d.get("kind") not in USED:
                continue
            out.append({"key": e["key"], "kind": d["kind"], "objective": int(d.get("objective") or 0), "page": e["page"],
                        "text": e["text"], "by": f"{d['by']} (review tool)", "generated": bool(e.get("generated"))})
        elif e["status"] == "agreed" and e["kind"] in USED:
            out.append({"key": e["key"], "kind": e["kind"], "objective": e["objective"], "page": e["page"], "text": e["text"],
                        "by": "written and checked blind" if e.get("generated") else "two readings",
                        "generated": bool(e.get("generated"))})
    return out


def for_lesson(book: str, slug: str) -> dict | None:
    """The chapter file's entry for one lesson, with its generated examples (S1G) among its passages; None when S1C has
    not run on it."""
    for f in sorted((HERE / "teaching" / book / "context").glob("ch*.json")):
        for L in json.loads(f.read_text()).get("lessons") or []:
            if L["slug"] == slug:
                return {**L, "passages": L["passages"] + generated_passages(book, slug)}
    return None


# ======================================================================== S1G: generated openers where the book has none
# Tamer, 2026-10-22: "implement the generation step for context that is missing … as part of the ingestion pipeline".
# An objective with no real-life opener of its own (the first objective of a lesson whose story is lesson-wide counts as
# having one) gets, from runbook/context-gen.workflow.js, either the lesson's own story (when a writer shows it serves
# the objective and a blind checker confirms) or ONE short example written from the objective's own maths, which the
# checker recomputes and judges. Only what the checker confirms is used; the rest is held for the Context task. A
# generated example is marked as such everywhere: the review tool, the content file, and the tutor's data block.

GEN_STATEMENTS = ("definition", "rule", "method", "caution", "convention")


def gen_out_path(book: str, unit: int) -> Path:
    return HERE / "teaching" / book / "context" / f"generated-ch{unit:02d}.json"


def gaps(book: str, L: dict) -> tuple[list[int], str | None]:
    """(the objectives with no real-life opener, the lesson's own story or None), from what S1C made of the lesson."""
    used = [p for p in resolved(book, {"passages": [p for p in L["passages"] if not p.get("generated")]}) if p["kind"] == "real_life"]
    own = {p["objective"] for p in used if p["objective"]}
    story = " ".join(p["text"] for p in used if not p["objective"]) or None
    return [o["n"] for o in L["objectives"] if o["n"] not in own and not (story and o["n"] == 1)], story


def objective_material(book: str, slug: str) -> dict[int, dict]:
    """{n: {statements, worked}}: each approved objective's own rules and worked examples, as printed (the writer's and
    checker's only maths)."""
    rec = json.loads(record_path(book, slug).read_text())
    n_of = {o["id"]: o.get("order_in_parent") or k for k, o in enumerate(sorted(rec.get("learning_objectives") or [],
                                                                               key=lambda o: o.get("order_in_parent", 0)), 1)}
    out: dict[int, dict] = {n: {"statements": [], "worked": []} for n in n_of.values()}
    for it in rec["items"]:
        n = n_of.get(it.get("lo"))
        if n is None:
            continue
        if it["type"] in GEN_STATEMENTS:
            t = squash(it.get("claim") or it.get("text"))
            out[n]["statements"].append(f"{t} {squash(it.get('formula'))}".strip()[:300])
        elif it["type"] == "worked_example" and len(out[n]["worked"]) < 3:
            steps = " ".join(squash(x) for x in (it.get("solution") or []))
            out[n]["worked"].append(f"{squash(it.get('stem') or it.get('text'))} → {steps}"[:600])
    return out


def gen_args(book: str, unit: int, model: str) -> dict:
    b = book_config.load_book(book)
    f = out_path(book, unit)
    if not f.exists():
        raise SystemExit(f"{f} not found: run book_record_context.py run {book} {unit} first (S1C)")
    lessons = []
    for L in json.loads(f.read_text())["lessons"]:
        g, story = gaps(book, L)
        mat = objective_material(book, L["slug"])
        lessons.append({"slug": L["slug"], "title": L["title"], "lesson_story": story, "gaps": g,
                        "objectives": [{"n": o["n"], "label": o["label"], "description": o["description"],
                                        **mat.get(o["n"], {"statements": [], "worked": []})} for o in L["objectives"]]})
    return {"stage": "context-gen", "book": {"book": book, "title": b.title, "grade": b.grade}, "lessons": lessons,
            "options": {"model": model}}


def gen_accept(book: str, unit: int, run_file: Path) -> dict:
    """Keep what the blind checker confirmed; hold the rest. Writes teaching/<book>/context/generated-ch<NN>.json."""
    res = json.loads(run_file.read_text())
    if res.get("stage") != "context-gen":
        raise SystemExit(f"{run_file} is not a context-gen return")
    runs = {L["slug"]: L for L in res["lessons"]}
    lessons, report = [], {"generated": 0, "lesson_story": 0, "none": 0, "held": 0, "lessons": {}}
    for L in json.loads(out_path(book, unit).read_text())["lessons"]:
        g, _story = gaps(book, L)
        r = runs.get(L["slug"]) or {}
        verdict = {v["objective"]: v for v in r.get("checked") or [] if isinstance(v.get("objective"), int)}
        entries = []
        for x in r.get("written") or []:
            n = x.get("objective")
            if n not in g or x.get("decision") not in ("generate", "lesson_story", "none"):
                continue
            if x["decision"] == "none":
                report["none"] += 1
                entries.append({"objective": n, "decision": "none", "why": x.get("why"), "status": "none"})
                continue
            v = verdict.get(n) or {}
            ok = v.get("verdict") == "confirmed" and (x["decision"] == "lesson_story" or bool((x.get("text") or "").strip()))
            e = {"objective": n, "decision": x["decision"], "text": squash(x.get("text")) if x["decision"] == "generate" else None,
                 "numbers": x.get("numbers") or [], "why": x.get("why"),
                 "check": {k: v.get(k) for k in ("verdict", "numbers_ok", "maths_fits", "true_to_world", "suits_student", "why")},
                 "status": "confirmed" if ok else "held"}
            e["fingerprint"] = hashlib.sha256(json.dumps([n, x["decision"], e["text"]], ensure_ascii=False).encode()).hexdigest()[:16]
            entries.append(e)
            report["held" if not ok else "generated" if x["decision"] == "generate" else "lesson_story"] += 1
        report["lessons"][L["slug"]] = {"gaps": len(g), "generated": sum(1 for e in entries if e["status"] == "confirmed" and e["decision"] == "generate"),
                                        "held": sum(1 for e in entries if e["status"] == "held")}
        lessons.append({"slug": L["slug"], "gaps": g, "entries": entries})
    doc = {"format": "ainext.context-generated/1", "book": book, "chapter": unit, "made": date.today().isoformat(),
           "made_by": f"book_record_context.py generate-accept ({res.get('prompts_version')})",
           "run": str(run_file.relative_to(HERE)) if run_file.is_relative_to(HERE) else str(run_file), "lessons": lessons}
    out = gen_out_path(book, unit)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    return report


def generated_passages(book: str, slug: str) -> list[dict]:
    """A lesson's generated examples in the shape of its passages, so compile and the review tool read them like the
    book's: a confirmed one is "agreed" (used), a doubted one "held". A "lesson_story" or "none" answer adds nothing:
    the lesson's own story already sits at the whole lesson."""
    out = []
    for f in sorted((HERE / "teaching" / book / "context").glob("generated-ch*.json")):
        for L in json.loads(f.read_text()).get("lessons") or []:
            if L["slug"] != slug:
                continue
            for e in L["entries"]:
                if e.get("decision") != "generate":
                    continue
                ok = e["status"] == "confirmed"
                out.append({"key": f"{slug}:generated-{e['objective']}", "page": None, "text": e["text"], "type": "generated",
                            "generated": True, "status": "agreed" if ok else "held",
                            "kind": "real_life" if ok else None, "objective": e["objective"] if ok else None,
                            "A": {"kind": "real_life", "objective": e["objective"], "why": f"written: {e.get('why') or ''}"},
                            "B": {"kind": "real_life" if ok else "none", "objective": e["objective"],
                                  "why": f"checked blind: {(e.get('check') or {}).get('why') or ''}"},
                            "numbers": e.get("numbers") or [], "fingerprint": e["fingerprint"]})
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("run", "args", "accept", "generate", "generate-args", "generate-accept"):
        s = sub.add_parser(name)
        s.add_argument("book")
        s.add_argument("unit", type=int)
        if name in ("accept", "generate-accept"):
            s.add_argument("run_file", type=Path)
        else:
            s.add_argument("--cap", type=float, default=2.0)
            s.add_argument("--model", default="sonnet")
    a = ap.parse_args(argv)
    if a.cmd.startswith("generate"):
        return generate_main(a)
    if a.cmd == "accept":
        rep = accept(a.book, a.unit, a.run_file.resolve())
    else:
        import embed_workflow as EW  # noqa: PLC0415
        import workflow_runner as WR  # noqa: PLC0415
        args = build_args(a.book, a.unit, a.model)
        copy = EW.default_out(a.book, "context", f"ch{a.unit:02d}")
        print(EW.summary(EW.write(HERE / "runbook" / "context.workflow.js", args, copy)), file=sys.stderr)
        if a.cmd == "args":
            return 0
        if not any(L["passages"] or L["questions"] for L in args["lessons"]):
            print("nothing to read: no linking text and no questions", file=sys.stderr)
        run_file, _res, _cost = WR.run_copy(copy, [], a.cap, f"context-ch{a.unit:02d}", a.book, "context", stage="S1C")
        rep = accept(a.book, a.unit, run_file)
    print(json.dumps(rep, indent=1, ensure_ascii=False))
    print(f"{rep['agreed']} passage(s) agreed, {rep['held']} held for the review tool's Context task, {rep['dropped']} "
          f"instruction(s) dropped, {rep['bridges']} bridge question(s)", file=sys.stderr)
    return 0


def generate_main(a) -> int:
    """S1G: generate-args (the embedded copy), generate (write, check blind, accept), generate-accept (a saved return)."""
    if a.cmd == "generate-accept":
        rep = gen_accept(a.book, a.unit, a.run_file.resolve())
    else:
        import embed_workflow as EW  # noqa: PLC0415
        import workflow_runner as WR  # noqa: PLC0415
        args = gen_args(a.book, a.unit, a.model)
        if not any(L["gaps"] for L in args["lessons"]):
            print("nothing to generate: every objective has the book's own real-life opener", file=sys.stderr)
            gen_out_path(a.book, a.unit).write_text(json.dumps({"format": "ainext.context-generated/1", "book": a.book, "chapter": a.unit,
                                                                 "lessons": []}, indent=1) + "\n")
            return 0
        copy = EW.default_out(a.book, "context", f"gen-ch{a.unit:02d}")
        print(EW.summary(EW.write(HERE / "runbook" / "context-gen.workflow.js", args, copy)), file=sys.stderr)
        if a.cmd == "generate-args":
            return 0
        run_file, _res, _cost = WR.run_copy(copy, [], a.cap, f"context-gen-ch{a.unit:02d}", a.book, "context", stage="S1G")
        rep = gen_accept(a.book, a.unit, run_file)
    print(json.dumps(rep, indent=1, ensure_ascii=False))
    print(f"{rep['generated']} example(s) written and confirmed, {rep['lesson_story']} served by the lesson's own story, "
          f"{rep['none']} with no honest real-life fit, {rep['held']} held for the review tool's Context task", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

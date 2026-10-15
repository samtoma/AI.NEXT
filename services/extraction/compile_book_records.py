"""Compile ingested book records into the bundles the app already loads, so the tutor can teach from them.

    uv run compile_book_records.py prep3-math-en u1-1 u1-2 u1-3 u1-4

Run from services/extraction/. For each lesson named, ONLY the newly ingested content is used (Tamer, 2026-10-16):
  * the book record (book-records/<book>/<slug>.json): its objectives and the book's own questions;
  * the generated answers (teaching/<book>/answers/<slug>.json), filtered by their review decisions
    (reviews/<book>/generated-answers.json): an approved answer, or one both readings agreed on with no failed
    check (loaded unreviewed, as the maths bank is served today, ADR-0019).
Today's content for those lessons (their bundle questions and figures, generated questions, widget questions,
misconceptions and prerequisite links) is LEFT OUT, not re-homed. Every other lesson of the book is unchanged.

Writes compiled/<book>/: the bundles (schemas.py SeedBundle) and the generated exports (minus the compiled
lessons' rows), and compile-report.json listing every book prompt that did not become a question, with why.
Nothing about how Noor teaches changes: the app reads these exactly as it reads today's bundles.

HOW A BOOK PROMPT BECOMES A QUESTION
  * Objective: the book record's objectives become the app's: `u1-1:objective-3` → `lo:u1-1-3`. A prompt the
    extractor left without one takes the objective of the nearest assigned record on its page.
  * Which: every exercise and worked-example part with an answer, printed or generated as above.
  * Marking, with what the app has: a number is `numeric` (today's grade()); assigned values ("a = 4, b = -4"),
    a point and a set ("{(1, 2), (1, 3)}", any order) go to the app's marker (`choices.marker`, kinds values /
    coordinates); a short name or yes/no is `short` with today's plain check. Anything else is listed, not loaded.
  * A worked example is a question too: its printed solution is the worked solution the tutor teaches from.
  * A prompt that needs its printed figure is held (`hold_reason: figure_missing`): the app has no figure for it.
  * Not used yet: the book's statements (definitions, rules). Today's maths prompt teaches from objective
    descriptions and worked solutions only; using them would change how Noor teaches.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "groundtruth"))
import answer_gen as AG  # noqa: E402  (with_intended, NEEDS_PAGE)
import score_book_record as SC  # noqa: E402

FORMAT_REPORT = "ainext.compile-report/1"
NUM = r"-?\d+(?:\.\d+)?(?:/\d+)?"
# A question that points the student at a printed picture ("on the Z × Z net", "in the previous diagram"): without
# the picture it cannot be answered, so it is held. Narrower than answer_gen.NEEDS_PAGE, which only decides when
# the answering model is shown the page ("the following" there is a list, not a picture).
FIGURE_NEEDED = re.compile(r"\b(?:in|on|from|by) the (?:[\w×]+ ){0,4}(?:figures?|graphs?|diagrams?|nets?|grids?|drawings?|pictures?)\b"
                           r"|\b(?:following|previous|opposite) (?:\w+ )?(?:figures?|graphs?|diagrams?|nets?|grids?)\b", re.I)


def rel(p: str | Path) -> Path:
    p = Path(p)
    return p if p.is_absolute() else REPO / p


def lo_of(slug: str, objective_id: str) -> str:
    return f"lo:{slug}-{int(objective_id.rsplit('-', 1)[1])}"


def in_lessons(lo: str, slugs: list[str]) -> bool:
    return any(str(lo).startswith(f"lo:{s}-") for s in slugs)


# ============================================================================ marking, with what the app has
def answer_type(ans: str):
    """(type, choices, answer) the app can mark today, or None. Deterministic: no model."""
    a = str(ans or "").replace("$", "").strip().rstrip(".")
    a = re.sub(r"\\[,;! ]", " ", a).replace("−", "-").replace("\\{", "{").replace("\\}", "}")
    a = re.sub(r"\s+", " ", a).strip()
    if re.fullmatch(NUM, a):
        return "numeric", None, a
    asg = re.findall(rf"\b([a-zA-Z])\s*=\s*({NUM})", a)
    if asg and re.sub(rf"\b[a-zA-Z]\s*=\s*{NUM}|[,;\s]|\band\b", "", a) == "":
        key = ", ".join(f"{v} = {x}" for v, x in asg)
        return "short", {"marker": {"kind": "values", "key": key, "variables": [v for v, _ in asg]}}, key
    pair = re.fullmatch(rf"(?:[A-Za-z]\w*\s*(?:is|=)\s*)?\(\s*({NUM})\s*,\s*({NUM})\s*\)", a)
    if pair:
        key = f"({pair.group(1)}, {pair.group(2)})"
        return "short", {"marker": {"kind": "coordinates", "key": key}}, key
    body = re.sub(r"^[A-Za-z]\w*(?:\s*[×x]\s*[A-Za-z]\w*)?\s*=\s*", "", a)  # "X × Y = {…}" → "{…}"
    if re.fullmatch(r"\{.*\}", body) and re.search(r"\d|\(", body):
        elems = re.findall(r"\([^()]*\)|[^{},()\s][^{},()]*", body[1:-1])
        letters = sorted({c for e in elems for c in re.findall(r"(?<![A-Za-z\\])[a-zA-Z](?![A-Za-z])", e)})
        if elems and all(re.fullmatch(rf"\(\s*(?:{NUM}|[a-zA-Z])\s*,\s*(?:{NUM}|[a-zA-Z])\s*\)|{NUM}", e.strip()) for e in elems):
            key = "\\{" + ", ".join(re.sub(r"\s*,\s*", ", ", e.strip()) for e in elems) + "\\}"
            return "short", {"marker": {"kind": "values", "key": key, "variables": letters}}, key
    yn = re.match(r"(?i)(yes|no)\b", a)
    if yn:  # "Yes, it is a polynomial (degree 3)": the plain check marks the word
        return "short", None, yn.group(1).capitalize()
    if re.fullmatch(r"[A-Za-z][A-Za-z\- ]{0,40}", a) and len(a.split()) <= 4:
        return "short", None, a
    return None


# ============================================================================ answers
def usable_answers(book: str, slug: str, record: dict, record_path: Path) -> dict[str, dict]:
    """ref (in THIS record's ids) → answer: approved, or agreed by both readings with no failed check."""
    p = HERE / "teaching" / book / "answers" / f"{slug}.json"
    if not p.exists():
        return {}
    data = json.loads(p.read_text())
    alias = {}
    src = HERE / data["source"]
    if src.resolve() != record_path.resolve() and src.exists():  # made from the lesson's ground truth: pair its ids
        pairs, _m, _i = SC.match(record.get("items") or [], json.loads(src.read_text()).get("items") or [])
        alias = {g["id"]: e["id"] for g, e, _ in pairs}
    dp = HERE / "reviews" / book / "generated-answers.json"
    decisions = {d["ref"]: d for d in json.loads(dp.read_text()).get("decisions", [])} if dp.exists() else {}
    out = {}
    for a in data.get("answers") or []:
        dec = decisions.get(a["ref"])
        if dec and dec["decision"] == "approve":
            how = f"generated, approved by {dec['by']}"
        elif not dec and a.get("status") == "agreed":
            how = "generated, both readings agree, not yet reviewed"
        else:
            continue
        rid = alias.get(a["record_id"], a["record_id"])
        out[f"{rid}:{a['part']}" if a.get("part") else rid] = {"answer": a["answer"], "solution": a["solution"], "how": how,
                                                              "needs_page": a.get("needs_page")}
    return out


# ============================================================================ the lesson
def objectives_for_items(record: dict) -> dict[str, str]:
    """item id → objective id; an item the extractor left without one takes the nearest assigned record on its page."""
    items = record.get("items") or []
    out = {r["id"]: r["lo"] for r in items if r.get("lo")}
    for i, r in enumerate(items):
        if r["id"] in out or r["type"] not in ("exercise", "worked_example"):
            continue
        near = sorted((abs(j - i), j) for j, x in enumerate(items) if x.get("lo") and x.get("source_page") == r.get("source_page"))
        near = near or sorted((abs(j - i), j) for j, x in enumerate(items) if x.get("lo"))
        if near:
            out[r["id"]] = items[near[0][1]]["lo"]
    return out


def lesson_objectives(slug: str, record: dict, syllabus_ref: str | None) -> list[dict]:
    nodes = []
    for o in record["learning_objectives"]:
        pages = sorted({it["source_page"] for it in record["items"] if it["id"] in o["evidence"]})
        nodes.append({"id": lo_of(slug, o["id"]), "kind": "learning_objective", "label": o["label"], "description": o["description"],
                      "source_page": pages[0] if pages else record["lesson"]["pages"][0],
                      "syllabus_ref": syllabus_ref or record["lesson"].get("syllabus_ref"), "order_in_parent": o["order_in_parent"]})
    return nodes


def book_questions(slug: str, record: dict, answers: dict, skipped: list) -> list[dict]:
    out = []
    lo_by_item = objectives_for_items(record)
    for raw in record.get("items") or []:
        if raw["type"] not in ("exercise", "worked_example"):
            continue
        r = AG.with_intended(raw)
        if r["id"] not in lo_by_item:
            skipped.append({"ref": r["id"], "why": "no objective"})
            continue
        lo = lo_of(slug, lo_by_item[r["id"]])
        holders = [(p, f"{r['id']}:{p['label']}") for p in r.get("parts") or []] or [(None, r["id"])]
        for p, ref in holders:
            h = p or r
            printed = h.get("answer") or (r.get("answer") if p is None else None)
            gen = answers.get(ref)
            if printed:
                ans, how = printed, "printed in the book"
                sol = (p or {}).get("solution") or r.get("solution") or []
            elif gen:
                ans, how, sol = gen["answer"], gen["how"], gen["solution"]
            else:
                skipped.append({"ref": ref, "why": "no usable answer yet (none printed; the generated one is not approved or not agreed)"})
                continue
            typed = answer_type(ans)
            if not typed:
                skipped.append({"ref": ref, "why": f"an answer the app cannot mark: {str(ans)[:90]}"})
                continue
            qtype, choices, key = typed
            text = r.get("text") or r.get("stem") or ""
            stem = f"{text} {('(' + p['label'] + ') ' + p['stem']) if p and p.get('stem') else ('(' + p['label'] + ')' if p else '')}".strip()
            local = re.sub(r"[^a-z0-9]+", "-", ref.split(":", 1)[1].lower()).strip("-")
            q = {"id": f"q:{lo.removeprefix('lo:')}:bk-{local}", "lo": lo, "tier": "standard", "type": qtype, "stem": stem,
                 "answer": key, "solution": [s for s in sol if s] or [f"The book's answer: {key}"],
                 "source_page": r["source_page"], "source": "seed",
                 "source_note": f"The book's own {r['type'].replace('_', ' ')} ({ref}, printed p.{r['source_page']}); answer {how}. "
                                "Compiled from the book record (compile_book_records.py)."}
            if choices:
                q["choices"] = choices
            if r["type"] == "worked_example" and printed:
                q["solution_provenance"] = "book_worked"
            if not printed and gen:  # two independent readings agreed (or a person approved): the loader records the AI check
                q["verified"] = True
            if FIGURE_NEEDED.search(" ".join([text, (p or {}).get("stem", "")])):
                q["hold_reason"] = "figure_missing"
                q.pop("verified", None)  # a held question is not verified (schemas.Question)
            out.append(q)
    return out


def marker_check(questions: list[dict]) -> dict[str, str]:
    """The app's own reader and key check (marker_check.mjs) on every marker question: id → why it was refused."""
    rows = [{"id": q["id"], "choices": q["choices"]} for q in questions if isinstance(q.get("choices"), dict)]
    if not rows:
        return {}
    res = subprocess.run(["node", "--no-warnings", str(HERE / "marker_check.mjs"), "-"], input="\n".join(json.dumps(r) for r in rows),
                         capture_output=True, text=True, cwd=REPO)
    out = json.loads(res.stdout or "{}")
    bad = {x["id"]: x["why"] for x in out.get("specs_rejected") or []}
    bad.update({x["id"]: f"key unreadable: {x['why']}" for x in out.get("keys_unreadable") or []})
    return bad


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("book")
    ap.add_argument("lessons", nargs="+")
    a = ap.parse_args(argv)
    slugs = a.lessons
    cfg = json.loads((HERE / "books" / f"{a.book}.json").read_text())
    out_dir = HERE / "compiled" / a.book
    out_dir.mkdir(parents=True, exist_ok=True)
    for f in out_dir.glob("*.json"):
        f.unlink()
    report = {"format": FORMAT_REPORT, "book": a.book, "lessons": {}, "skipped": [], "left_out_today": {}}

    bundles = {p: json.loads(rel(p).read_text()) for p in cfg["bundles"]}
    new_nodes, new_questions = {}, {}
    for slug in slugs:
        rec_path = HERE / "book-records" / a.book / f"{slug}.json"
        record = json.loads(rec_path.read_text())
        old = next((n for b in bundles.values() for n in b["nodes"] if n.get("kind") == "learning_objective" and n["id"].startswith(f"lo:{slug}-")), {})
        new_nodes[slug] = lesson_objectives(slug, record, old.get("syllabus_ref"))
        skipped: list = []
        qs = book_questions(slug, record, usable_answers(a.book, slug, record, rec_path), skipped)
        bad = marker_check(qs)
        for q in qs:
            if q["id"] in bad:
                skipped.append({"ref": q["id"], "why": f"the app's marker refused it: {bad[q['id']]}"})
        new_questions[slug] = [q for q in qs if q["id"] not in bad]
        report["lessons"][slug] = {"objectives": len(new_nodes[slug]), "questions": len(new_questions[slug]),
                                   "held_for_figure": sum(1 for q in new_questions[slug] if q.get("hold_reason")),
                                   "by_type": {t: sum(1 for q in new_questions[slug] if q["type"] == t) for t in ("numeric", "short")},
                                   "marker": sum(1 for q in new_questions[slug] if isinstance(q.get("choices"), dict))}
        report["skipped"] += [{"lesson": slug, **s} for s in skipped]

    for bpath, b in bundles.items():
        if not any(n.get("kind") == "learning_objective" and in_lessons(n["id"], slugs) for n in b["nodes"]):
            continue
        b = copy.deepcopy(b)
        here = [s for s in slugs if any(n["id"].startswith(f"lo:{s}-") for n in b["nodes"])]
        left = report["left_out_today"].setdefault(Path(bpath).name, {})
        left["objectives"] = sum(1 for n in b["nodes"] if n.get("kind") == "learning_objective" and in_lessons(n["id"], here))
        left["questions"] = sum(1 for q in b["questions"] if in_lessons(q["lo"], here))
        left["visuals"] = sum(1 for v in b.get("visuals") or [] if in_lessons(v["lo"], here))
        left["edges"] = sum(1 for e in b["edges"] if in_lessons(e["src"], here) or in_lessons(e["dst"], here))
        module = next(e["src"] for e in b["edges"] if e["type"] == "teaches" and in_lessons(e["dst"], here))
        b["nodes"] = [n for n in b["nodes"] if not (n.get("kind") == "learning_objective" and in_lessons(n["id"], here))]
        b["edges"] = [e for e in b["edges"] if not (in_lessons(e["src"], here) or in_lessons(e["dst"], here))]
        b["questions"] = [q for q in b["questions"] if not in_lessons(q["lo"], here)]
        b["visuals"] = [v for v in b.get("visuals") or [] if not in_lessons(v["lo"], here)]
        for s in here:
            b["nodes"] += new_nodes[s]
            b["edges"] += [{"src": module, "dst": n["id"], "type": "teaches"} for n in new_nodes[s]]
            b["questions"] += new_questions[s]
        (out_dir / Path(bpath).name).write_text(json.dumps(b, ensure_ascii=False, indent=2) + "\n")

    gen_paths = (cfg["generated"]["questions"] if isinstance(cfg["generated"]["questions"], list) else [cfg["generated"]["questions"]]) \
        + [cfg["generated"]["misconceptions"]]
    for p in gen_paths:
        g = json.loads(rel(p).read_text())
        left = report["left_out_today"].setdefault(Path(p).name, {})
        if "questions" in g:
            left["questions"] = sum(1 for q in g["questions"] if in_lessons(q.get("lo_id"), slugs))
            g["questions"] = [q for q in g["questions"] if not in_lessons(q.get("lo_id"), slugs)]
        if "misconceptions" in g:
            left["misconceptions"] = sum(1 for m in g["misconceptions"] if in_lessons(m.get("lo_id"), slugs))
            g["misconceptions"] = [m for m in g["misconceptions"] if not in_lessons(m.get("lo_id"), slugs)]
        (out_dir / Path(p).name).write_text(json.dumps(g, ensure_ascii=False, indent=2) + "\n")

    # a question outside the compiled lessons may name a misconception of theirs (a Term 2 widget diagnosing a Unit 1
    # error): that one link is dropped, the question kept, and listed
    dropped_mc = set()
    for p in gen_paths:
        g0 = json.loads(rel(p).read_text())
        dropped_mc |= {m["id"] for m in g0.get("misconceptions") or [] if in_lessons(m.get("lo_id"), slugs)}
    report["links_dropped"] = []
    for p in gen_paths:
        f = out_dir / Path(p).name
        g = json.loads(f.read_text())
        for q in g.get("questions") or []:
            ch = q.get("choices")
            if isinstance(ch, dict) and ch.get("diagnostics"):
                keep = [d for d in ch["diagnostics"] if d.get("misconception_id") not in dropped_mc]
                for d in ch["diagnostics"]:
                    if d not in keep:
                        report["links_dropped"].append({"question": q["id"], "predicate": d.get("predicate"), "misconception": d["misconception_id"]})
                ch["diagnostics"] = keep
            elif isinstance(ch, list):
                for c in ch:
                    if isinstance(c, dict) and c.get("misconception_id") in dropped_mc:
                        report["links_dropped"].append({"question": q["id"], "option": c.get("key"), "misconception": c.pop("misconception_id")})
        f.write_text(json.dumps(g, ensure_ascii=False, indent=2) + "\n")

    report["files"] = sorted(str(x.relative_to(HERE)) for x in out_dir.glob("*.json"))
    (out_dir / "compile-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    for slug, r in report["lessons"].items():
        print(f"{slug}: {r['objectives']} objectives; {r['questions']} book questions ({r['by_type']['numeric']} numeric, "
              f"{r['marker']} on the marker, {r['held_for_figure']} held for a figure)", file=sys.stderr)
    print(f"not loaded: {len(report['skipped'])} book prompt(s), see compiled/{a.book}/compile-report.json", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

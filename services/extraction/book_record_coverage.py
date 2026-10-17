"""The coverage audit for book-record units: Samuel's S8 integer equalities (coverage_report.py, B14), on book records.

    uv run book_record_coverage.py prep3-math-en 1                 # unit 1: write coverage/<book>.unit01.book-records.json
    uv run book_record_coverage.py prep3-math-en 1 --check         # print, write nothing

Exit code: 0 GREEN, 1 RED, 2 could not read an input. Run after compile_book_records.py; the load waits for GREEN
(Samuel's rule, runbook §5: "A RED line either goes back to the stage that owns it, or gets a signed exception").

Samuel's audit reads the Grade 10 line's files (the manifest, objectives/<book>/, runs/<book>/lesson/, seed/), so it
cannot read a book-record unit. This is the same audit on what the book-record line writes: the lesson map and book
records (the book layer), the teaching layer, the review decisions and the compiled unit. It keeps his check ids
where the check is his, his `Check` (coverage_report.Check, imported), his four states (holds, excepted,
auto_passed, fails) and his exceptions, signed by a person in the coverage file's `exceptions` list and kept by a
re-run:
    {"check": "module_widgets", "scope": "unit 1", "reason": "…", "signed_by": "Samuel", "signed_at": "2026-10-17"}
It trusts no stage's own count: every number is recomputed from the rows. The file has no timestamps.

THE CHECKS (Samuel's id where it is his check; † a check the book-record line adds):
    pages                   the unit's printed pages = pages in a lesson + pages excluded with a reason (a unit opener
                            the S0 scout confirmed, or lessons.json `excluded_pages`); a page two lessons share is an
                            error unless the later one starts mid-page (the manifest method records it)
    lesson_provenance       every lesson has its record, the record names its source file and offset, its pages are
                            the lesson map's, and every item sits on one of them
    items_mapped_once       prompts (exercise, worked example, activity, open prompt) = prompts filed under one objective
    mapped_items_accounted  every prompt and part of a filed prompt = asked as a book question + left out with a
                            reason (compile's `skipped`, or an activity no answer was approved for)
    worked_examples         worked examples = asked as a question, or kept in the explanation library
    objective_evidence      objectives = objectives with a statement, a book question, and evidence of two kinds, one a
                            worked example or an exercise (Samuel's rule 1)
    tier_floor              objectives × 3 tiers = cells with a live question, book or generated (review_policy's rule)
    module_widgets          the unit = a unit with a live widget question (or a signed exception)
    distractor_refutations  tagged distractors = those whose misconception has a refutation
    misconception_refutations  the unit's catalogue entries = entries with a refutation
    figures                 figures in the records = figures drawn + gaps with a reason (teaching/<book>/visuals/)
    book_pictures           book pictures standing in for a figure that are not servable = 0 (alt, stand_in, a
                            /book-figures/ file in app/public)
    maths_reading †         page-image books: formulas read twice = agreed + settled by a third reading + decided in the
                            Maths reading task
    misprints_decided †     misprints on the records and the checks' candidates = those a person decided
    items_typed_once        book questions = distinct prompts asked once, each with one type
    solution_sources        book questions = answers printed in the book + generated answers a person approved or two
                            readings agreed on
    notation                un-normalised decimal commas, `(x; y)` and display environments left in the unit = 0
    statements_served †     the records' statements filed under an objective = statements in the content files
    statements_checked †    the statements the tutor quotes = those S2's provenance check kept (containment, checked,
                            re-audited) + those it flagged that a person has since labelled in Label extraction
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_config  # noqa: E402
import review_policy  # noqa: E402
from assemble_lesson_bundle import residual_notation  # noqa: E402
from coverage_report import Check  # noqa: E402

TIERS = ("basic", "standard", "advanced")
PROMPTS = ("exercise", "worked_example", "activity", "open_prompt")
STATEMENTS = ("definition", "rule", "caution", "convention", "method", "key_term", "prior_knowledge")
NOTE_REF = re.compile(r"\(([a-z0-9-]+:[^,()]+?), printed p\.")
VERSION = 1


def _range(pages) -> set[int]:
    return set(range(pages[0], pages[1] + 1)) if pages and all(isinstance(p, int) for p in pages) else set()


def objective_of(slug: str, record: dict) -> dict[str, str]:
    import compile_book_records as C  # noqa: PLC0415  (the compile's own filing, so the audit counts what it compiled)
    return {item: C.lo_of(slug, o) for item, o in C.objectives_for_items(record).items()}


def input_files(book: str, slugs: list[str], compiled: Path) -> list[Path]:
    """Every file the audit reads, for its fingerprint: the load refuses an audit whose inputs have changed since."""
    fs = [HERE / "book-records" / book / "lessons.json", HERE / "book-records" / book / "misprint-candidates.json",
          HERE / "groundtruth" / book / "misprint-decisions.json", HERE / "reviews" / book / "maths-reading.json"]
    fs += [HERE / "book-records" / book / f"{s}.json" for s in slugs]
    fs += [HERE / "book-records" / book / "maths-reading" / f"{s}.json" for s in slugs]
    fs += [HERE / "teaching" / book / "visuals" / f"{s}.json" for s in slugs]
    fs += sorted(compiled.glob("*.json")) + [compiled / "content" / f"{s}.json" for s in slugs]
    return [f for f in fs if f.exists()]


def fingerprint(book: str, slugs: list[str], compiled: Path) -> dict[str, str]:
    import hashlib  # noqa: PLC0415
    return {str(f.relative_to(HERE)): hashlib.sha256(f.read_bytes()).hexdigest() for f in input_files(book, slugs, compiled)}


def load_inputs(book: str, slugs: list[str], compiled: Path) -> dict:
    lmap = json.loads((HERE / "book-records" / book / "lessons.json").read_text())
    records = {s: json.loads(p.read_text()) for s in slugs if (p := HERE / "book-records" / book / f"{s}.json").exists()}
    in_unit = lambda lo: any(str(lo or "").startswith(f"lo:{s}-") for s in slugs)
    bundles = [json.loads(p.read_text()) for p in sorted(compiled.glob("*.json"))
               if p.name not in ("compile-report.json", "review-stamps.json", "generated-questions.json",
                                 "widget-questions.json", "misconceptions.json")]
    bundles = [b for b in bundles if isinstance(b, dict) and "nodes" in b]
    gen = lambda name: json.loads(p.read_text()) if (p := compiled / name).exists() else {}
    report = gen("compile-report.json")
    return {
        "lmap": lmap, "records": records,
        "nodes": [n for b in bundles for n in b["nodes"] if n.get("kind") == "learning_objective" and in_unit(n["id"])],
        "questions": [q for b in bundles for q in b.get("questions") or [] if in_unit(q.get("lo"))],
        "visuals": [v for b in bundles for v in b.get("visuals") or [] if in_unit(v.get("lo"))],
        "entries": [e for b in bundles for e in b.get("explanation_entries") or [] if in_unit(e.get("lo"))],
        "generated": [q for q in (gen("generated-questions.json").get("questions") or []) if in_unit(q.get("lo_id"))],
        "widgets": [q for q in (gen("widget-questions.json").get("questions") or []) if in_unit(q.get("lo_id"))],
        "catalogue": [m for m in (gen("misconceptions.json").get("misconceptions") or []) if in_unit(m.get("lo_id"))],
        "content": {s: json.loads(p.read_text()) for s in slugs if (p := compiled / "content" / f"{s}.json").exists()},
        "skipped": [x for x in report.get("skipped") or [] if x.get("lesson") in slugs],
        "report": report,
    }


def audit(book, unit: int, slugs: list[str], I: dict, public: Path) -> list[Check]:
    course = book.course_id
    recs, lmap = I["records"], I["lmap"]
    lessons = [l for l in lmap["lessons"] if l["slug"] in slugs]
    checks: list[Check] = []
    U = f"unit {unit}"
    lo_of_item = {s: objective_of(s, recs[s]) for s in slugs if s in recs}
    items = [(s, it) for s in slugs if s in recs for it in recs[s]["items"]]
    asked = {}   # prompt ref → the book question asking it
    for q in I["questions"]:
        m = NOTE_REF.search(q.get("source_note") or "")
        if m:
            asked.setdefault(m.group(1), []).append(q)

    # ---- pages -------------------------------------------------------------------------------------------------
    c = Check("pages", "The unit's printed pages = pages in a lesson + pages excluded with a reason")
    offset_groups: dict[int, list[dict]] = {}
    for l in lessons:
        offset_groups.setdefault(l.get("page_offset", lmap["page_offset"]), []).append(l)
    prop = HERE / "book-records" / book.book / "lessons.proposed.json"
    openers = {o["printed"] for o in (json.loads(prop.read_text()).get("unit_openers") or []) if o.get("opener")} if prop.exists() else set()
    excluded = {p for x in lmap.get("excluded_pages") or [] if x.get("reason") for p in _range(x.get("pages"))} | openers
    for off, ls in offset_groups.items():
        spans = [_range(l.get("pages")) for l in ls]
        body = set(range(min(min(s) for s in spans if s), max(max(s) for s in spans if s) + 1)) if any(spans) else set()
        assigned = set().union(*spans) if spans else set()
        c.want += len(body)
        c.got += len(assigned | (excluded & body))
        for p in sorted(body - assigned - excluded):
            c.fail(f"page {p}", "inside the unit, in no lesson and excluded with no reason")
        seen: dict[int, str] = {}
        for l, s in zip(ls, spans):
            for p in s:
                # a lesson that starts mid-page shares its first page with the lesson before it (an EPUB section)
                if p in seen and not (l.get("starts_mid_page") and p == min(s)):
                    c.fail(f"page {p}", f"in two lessons: {seen[p]} and {l['slug']}")
                seen[p] = l["slug"]
    checks.append(c)

    # ---- lesson_provenance ---------------------------------------------------------------------------------------
    c = Check("lesson_provenance", "Lessons = lessons whose record names its source, offset and the map's pages")
    for l in lessons:
        c.want += 1
        r = recs.get(l["slug"])
        if r is None:
            c.fail(l["slug"], "no book record")
            continue
        sd, problems = r.get("source_document") or {}, []
        if not sd.get("file_path"):
            problems.append("no source file")
        if sd.get("page_offset") != l.get("page_offset", lmap["page_offset"]):
            problems.append(f"offset {sd.get('page_offset')} where the map says {l.get('page_offset', lmap['page_offset'])}")
        if list(r["lesson"].get("pages") or []) != list(l["pages"]):
            problems.append(f"pages {r['lesson'].get('pages')} where the map says {l['pages']}")
        off_page = [it["id"] for it in r["items"] if isinstance(it.get("source_page"), int) and it["source_page"] not in _range(l["pages"])]
        if off_page:
            problems.append(f"{len(off_page)} item(s) on a page outside the lesson: {', '.join(off_page[:3])}")
        if problems:
            c.fail(l["slug"], "; ".join(problems))
        else:
            c.got += 1
    checks.append(c)

    # ---- items_mapped_once -------------------------------------------------------------------------------------
    c = Check("items_mapped_once", "Prompts = prompts filed under exactly one objective")
    prompts = [(s, it) for s, it in items if it["type"] in PROMPTS]
    for s, it in prompts:
        c.want += 1
        if it["id"] in lo_of_item.get(s, {}):
            c.got += 1
        else:
            c.fail(f"item {it['id']}", f"{it['type'].replace('_', ' ')} filed under no objective")
    checks.append(c)

    # ---- mapped_items_accounted ----------------------------------------------------------------------------------
    c = Check("mapped_items_accounted", "Prompts and parts filed = asked as book questions + left out with a reason")
    left_out = {x["ref"]: x["why"] for x in I["skipped"]}
    for s, it in prompts:
        if it["id"] not in lo_of_item.get(s, {}):
            continue
        refs = [f"{it['id']}:{p['label']}" for p in it.get("parts") or []] or [it["id"]]
        for ref in refs:
            c.want += 1
            if ref in asked or ref in left_out or it["id"] in left_out:
                c.got += 1
            elif it["type"] in ("activity", "open_prompt"):
                c.got += 1   # compile asks one only with an answer a person approved or two readings agreed on
                c.notes.append(f"{ref}: not asked, no answer approved yet")
            else:
                c.fail(f"item {ref}", "neither asked nor left out with a reason")
    checks.append(c)

    # ---- worked_examples -----------------------------------------------------------------------------------------
    c = Check("worked_examples", "Worked examples = asked as a question, or kept in the explanation library")
    in_library = {m.group(1) for e in I["entries"] if (m := re.search(r"book_worked: ([^,)]+)", e.get("generated_by") or ""))}
    for s, it in items:
        if it["type"] != "worked_example":
            continue
        c.want += 1
        if it["id"] in in_library or any(r == it["id"] or r.startswith(it["id"] + ":") for r in asked):
            c.got += 1
        else:
            c.fail(f"item {it['id']}", "neither asked nor in the library")
    checks.append(c)

    # ---- objective_evidence --------------------------------------------------------------------------------------
    c = Check("objective_evidence", "Objectives = objectives with a statement, a book question and evidence of two "
                                    "kinds, one a worked example or exercise (Samuel's rule 1)")
    stated = {g["lo"] for doc in I["content"].values() for g in doc.get("groups") or [] if g.get("statements")}
    questioned = {q["lo"] for q in I["questions"]}
    kinds: dict[str, set] = {}
    for s, it in items:
        lo = lo_of_item.get(s, {}).get(it["id"])
        if lo:
            kinds.setdefault(lo, set()).add(it["type"])
    for n in I["nodes"]:
        c.want += 1
        k = kinds.get(n["id"], set())
        miss = [w for w, ok in (("a statement", n["id"] in stated), ("a book question", n["id"] in questioned),
                                ("two kinds of evidence", len(k) >= 2),
                                ("a worked example or exercise", bool(k & {"worked_example", "exercise"}))) if not ok]
        if miss:
            c.fail(n["id"], "lacks " + ", ".join(miss))
        else:
            c.got += 1
    checks.append(c)

    # ---- tier_floor ----------------------------------------------------------------------------------------------
    c = Check("tier_floor", "Objectives × 3 tiers = cells with a live question, book or generated")
    live = {(q["lo"], q.get("tier")) for q in I["questions"] if review_policy.book_item_is_live(q)}
    live |= {(q["lo_id"], q.get("tier")) for q in I["generated"] + I["widgets"] if review_policy.generated_item_is_live(q, course)}
    for n in I["nodes"]:
        for t in TIERS:
            c.want += 1
            if (n["id"], t) in live:
                c.got += 1
            else:
                c.fail(f"{n['id']} {t}", "no live question at this tier")
    checks.append(c)

    # ---- module_widgets ------------------------------------------------------------------------------------------
    c = Check("module_widgets", "The unit = a unit with a live widget question")
    c.want = 1
    if any(review_policy.generated_item_is_live(q, course) for q in I["widgets"]):
        c.got = 1
    else:
        c.fail(U, "no live widget question")
    checks.append(c)

    # ---- distractor_refutations, misconception_refutations -----------------------------------------------------
    refuted = {m["id"] for m in I["catalogue"] if m.get("refutation")}
    c = Check("distractor_refutations", "Tagged distractors = those whose misconception has a refutation")
    for q in I["generated"] + I["widgets"]:
        ch = q.get("choices")
        tags = [x["misconception_id"] for x in ch if isinstance(x, dict) and x.get("misconception_id")] if isinstance(ch, list) else \
               [d["misconception_id"] for d in (ch or {}).get("diagnostics") or [] if d.get("misconception_id")] if isinstance(ch, dict) else []
        for t in tags:
            c.want += 1
            if t in refuted:
                c.got += 1
            else:
                c.fail(q["id"], f"its distractor names {t}, which has no refutation")
    checks.append(c)
    c = Check("misconception_refutations", "The unit's catalogue entries = entries with a refutation")
    for m in I["catalogue"]:
        c.want += 1
        if m["id"] in refuted:
            c.got += 1
        else:
            c.fail(m["id"], "no refutation")
    checks.append(c)

    # ---- figures -------------------------------------------------------------------------------------------------
    c = Check("figures", "Figures in the records = figures drawn + gaps with a reason")
    for s in slugs:
        vf = HERE / "teaching" / book.book / "visuals" / f"{s}.json"
        v = json.loads(vf.read_text()) if vf.exists() else {}
        drawn = {x.get("figure") for x in v.get("visuals") or []}
        gaps = {x.get("figure") for x in v.get("gaps") or [] if x.get("reason")}
        for it in recs.get(s, {}).get("items") or []:
            if it["type"] != "figure":
                continue
            c.want += 1
            if it["id"] in drawn or it["id"] in gaps:
                c.got += 1
            else:
                c.fail(f"item {it['id']}", "not drawn and no gap recorded" + ("" if vf.exists() else " (no S4 output for the lesson)"))
    checks.append(c)

    # ---- book_pictures -------------------------------------------------------------------------------------------
    c = Check("book_pictures", "Book pictures standing in for a figure that are not servable = 0")
    for v in I["visuals"]:
        if v.get("kind") != "book_image":
            continue
        c.want += 1
        sp = v.get("spec") or {}
        src = str(sp.get("src") or "")
        bad = [w for w, ok in (("alt text", sp.get("alt")), ("stand_in", sp.get("stand_in")),
                               ("a /book-figures/ src", src.startswith("/book-figures/")),
                               ("its file in app/public", src.startswith("/book-figures/") and (public / src.lstrip("/")).exists())) if not ok]
        if bad:
            c.fail(v["id"], "lacks " + ", ".join(bad))
        else:
            c.got += 1
    checks.append(c)

    # ---- maths_reading (page-image books) ------------------------------------------------------------------------
    c = Check("maths_reading", "Formulas read twice = agreed + decided in the Maths reading task")
    if (book.sources.epub and not book.sources.pdf) or book.maths_source == "epub-images-md5":
        c.notes.append("an EPUB book: its maths is S0b's (coverage_report.py maths_images)")
    else:
        dfile = HERE / "reviews" / book.book / "maths-reading.json"
        dec = {d["ref"]: d for d in json.loads(dfile.read_text())["decisions"]} if dfile.exists() else {}
        for s in slugs:
            mf = HERE / "book-records" / book.book / "maths-reading" / f"{s}.json"
            if not mf.exists():
                c.fail(s, "no second reading (book_record_maths.py run)")
                continue
            for e in json.loads(mf.read_text())["entries"]:
                c.want += 1
                d = dec.get(e["ref"])
                if e["status"] in ("agreed", "settled") or (d and d.get("fingerprint") == e["fingerprint"]):
                    c.got += 1
                else:
                    c.fail(e["ref"], f"{e['status']}: ${e['first']}$ / ${e.get('second') or '—'}$")
    checks.append(c)

    # ---- misprints_decided ---------------------------------------------------------------------------------------
    c = Check("misprints_decided", "Misprints and candidates = those a person decided")
    dfile = HERE / "groundtruth" / book.book / "misprint-decisions.json"
    decided = {d["ref"] for d in json.loads(dfile.read_text()).get("decisions") or []} if dfile.exists() else set()
    refs = []
    for s, it in items:
        refs += [f"{it['id']}#{m.get('field')}" for m in it.get("misprints") or []]
        refs += [f"{it['id']}:{p['label']}#{m.get('field')}" for p in it.get("parts") or [] for m in p.get("misprints") or []]
    cf = HERE / "book-records" / book.book / "misprint-candidates.json"
    if cf.exists():
        refs += [x["ref"] for x in json.loads(cf.read_text()).get("candidates") or [] if x.get("lesson") in slugs]
    for ref in refs:
        c.want += 1
        if ref in decided:
            c.got += 1
        else:
            c.fail(ref, "not decided in the Misprints task")
    checks.append(c)

    # ---- items_typed_once ----------------------------------------------------------------------------------------
    c = Check("items_typed_once", "Book questions = distinct prompts asked once, each with one type")
    ids = [q["id"] for q in I["questions"]]
    c.want = len(I["questions"])
    for qid in sorted({i for i in ids if ids.count(i) > 1}):
        c.fail(qid, "the same question id twice")
    for ref, qs in asked.items():
        if len(qs) > 1:
            c.fail(ref, f"asked {len(qs)} times: {', '.join(q['id'] for q in qs)}")
    for q in I["questions"]:
        if not q.get("type"):
            c.fail(q["id"], "no type")
    c.got = c.want - len(c.failures)
    checks.append(c)

    # ---- solution_sources ----------------------------------------------------------------------------------------
    c = Check("solution_sources", "Book questions = answers printed in the book + generated answers approved or agreed")
    for q in I["questions"]:
        c.want += 1
        note = q.get("source_note") or ""
        if "answer printed in the book" in note or (re.search(r"answer generated|answer_gen|generated,", note) and q.get("verified")):
            c.got += 1
        elif q.get("hold_reason"):
            c.got += 1   # held: never served, so its answer's source cannot mislead a student
            c.notes.append(f"{q['id']}: held ({q['hold_reason']})")
        else:
            c.fail(q["id"], f"its answer's source is not a printed answer or an approved or agreed generated one: {note[:120]}")
    checks.append(c)

    # ---- notation ------------------------------------------------------------------------------------------------
    c = Check("notation", "Un-normalised decimal commas, `(x; y)` and display environments left in the unit = 0")
    texts = []
    for q in I["questions"]:
        texts += [(q["id"], t) for t in [q.get("stem"), q.get("answer")] + list(q.get("solution") or [])]
    for q in I["generated"] + I["widgets"]:
        texts += [(q["id"], q.get("stem")), (q["id"], str(q.get("correct_answer") or ""))]
        texts += [(q["id"], s.get("text_md")) for s in q.get("canonical_solution") or [] if isinstance(s, dict)]
    for e in I["entries"]:
        texts += [(e["id"], x.get("text_md")) for x in e.get("content") or []]
    c.want = len(texts)
    for where, t in texts:
        hits = residual_notation(t)
        if hits:
            c.fail(where, f"left: {', '.join(hits[:3])}")
    c.got = c.want - len(c.failures)
    checks.append(c)

    # ---- statements_served ---------------------------------------------------------------------------------------
    c = Check("statements_served", "The records' statements filed under an objective = statements in the content files")
    served = {x["id"] for doc in I["content"].values() for g in doc.get("groups") or [] for x in g.get("statements") or []}
    for s, it in items:
        if it["type"] in STATEMENTS and it["id"] in lo_of_item.get(s, {}):
            c.want += 1
            if it["id"] in served:
                c.got += 1
            else:
                c.fail(f"item {it['id']}", "filed under an objective, not served to the tutor")
    checks.append(c)

    # ---- statements_checked (book_record_provenance.py: Samuel's S2 provenance check) ---------------------------
    import book_record_provenance as BRP  # noqa: PLC0415
    c = Check("statements_checked", "Statements = statements the provenance check kept + those it flagged that a person labelled")
    labelled = ground_truth_labels(book.book, slugs, recs)
    for s in slugs:
        if s not in recs:
            continue
        done = BRP.checked_already(book.book, s)
        for it in recs[s]["items"]:
            if it["type"] not in BRP.STATEMENTS or not BRP.claim_of(it):
                continue
            c.want += 1
            e = done.get(it["id"])
            if e is None or e["fingerprint"] != BRP.fingerprint(it):
                c.fail(f"item {it['id']}", "not checked (book_record_provenance.py run)" if e is None else "edited since it was checked")
            elif e["provenance"] != "unsupported" or labelled.get(it["id"]) in ("confirmed", "flagged"):
                c.got += 1
            else:
                c.fail(f"item {it['id']}", f"the check could not confirm it says what the page prints: {e.get('note') or ''}"[:200])
    checks.append(c)
    return checks


def ground_truth_labels(book: str, slugs: list[str], recs: dict[str, dict]) -> dict[str, str]:
    """A person's label (review status) on each extracted record of these lessons, from the book's ground-truth files.
    A labelled record may carry another id than the extracted one: they are matched as the review tool matches them
    (score_book_record.match)."""
    sys.path.insert(0, str(Path(__file__).resolve().parent / "groundtruth"))
    import score_book_record as SC  # noqa: PLC0415
    out: dict[str, str] = {}
    for f in (HERE / "groundtruth" / book).rglob("*.json") if (HERE / "groundtruth" / book).is_dir() else []:
        try:
            d = json.loads(f.read_text())
        except ValueError:
            continue
        slug = (d.get("lesson") or {}).get("slug") if isinstance(d, dict) else None
        if d.get("role") == "ground_truth" and slug in slugs and slug in recs:
            status = {it["id"]: (it.get("review") or {}).get("status") for it in d.get("items") or []}
            pairs, _missing, _invented = SC.match(recs[slug].get("items") or [], d.get("items") or [])
            words = lambda t: " ".join(re.sub(r"[^a-z0-9]+", " ", str(t or "").lower()).split())
            for g, e, _how in pairs:   # a label counts only on the same printed words (a ground truth labelled on an
                same = words(g.get("quote")) == words(e.get("quote")) or words(g.get("claim")) == words(e.get("claim"))  # earlier extraction can reuse an id)
                if status.get(g["id"]) and same:
                    out[e["id"]] = status[g["id"]]
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("book")
    ap.add_argument("unit", type=int)
    ap.add_argument("--lessons", help="comma-separated slugs (default: the unit's lessons in the lesson map)")
    ap.add_argument("--compiled", type=Path, help="default compiled/<book>/")
    ap.add_argument("--public", type=Path, help="the app's static files (default app/public)")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--check", action="store_true", help="print the audit, write nothing")
    a = ap.parse_args(argv)
    book = book_config.load_book(a.book)
    if a.lessons:
        slugs = a.lessons.split(",")
    else:
        import ingest  # noqa: PLC0415
        slugs, _title = ingest.unit_lessons(book, ingest.route(book.book), a.unit)
    if not slugs:
        print(f"ERROR: no lessons for unit {a.unit} of {book.book}", file=sys.stderr)
        return 2
    compiled = a.compiled or HERE / "compiled" / book.book
    if not (compiled / "compile-report.json").exists():
        print(f"ERROR: {compiled} has no compile report: run compile_book_records.py first", file=sys.stderr)
        return 2
    I = load_inputs(book.book, slugs, compiled)
    checks = audit(book, a.unit, slugs, I, a.public or book_config.REPO_ROOT / "app" / "public")
    out_p = a.out or HERE / "coverage" / f"{book.book}.unit{a.unit:02d}.book-records.json"
    previous = json.loads(out_p.read_text()) if out_p.exists() else {}
    exceptions = previous.get("exceptions", [])
    rows = [c.as_dict(exceptions) for c in checks]
    failing = [r["id"] for r in rows if r["state"] == "fails"]
    status = "RED" if failing else "GREEN"
    report = {"coverage_version": VERSION, "line": "book-records", "book": book.book, "course_id": book.course_id,
              "unit": a.unit, "lessons": slugs, "status": status,
              "summary": {"checks": len(rows), "hold": sum(r["state"] == "holds" for r in rows),
                          "excepted": sum(r["state"] == "excepted" for r in rows), "fail": len(failing)},
              "checks": rows, "inputs": fingerprint(book.book, slugs, compiled), "exceptions": exceptions}
    for r in rows:
        mark = {"holds": "=", "excepted": "~", "auto_passed": "a", "fails": "x"}[r["state"]]
        print(f"  {mark} {r['id']:<26} want {r['want']:>5}  got {r['got']:>5}  {r['state']}")
        for f in r["failures"][:4]:
            print(f"      {f['scope']}: {f['detail']}")
        if len(r["failures"]) > 4:
            print(f"      … +{len(r['failures']) - 4} more")
    unsigned = [e for e in exceptions if not e.get("signed_by")]
    if unsigned:
        print(f"  ! {len(unsigned)} exception(s) without signed_by — ignored")
    print(f"COVERAGE: {status} — {book.book} unit {a.unit}: {report['summary']['hold']} hold, "
          f"{report['summary']['excepted']} excepted, {len(failing)} fail")
    if not a.check:
        out_p.parent.mkdir(parents=True, exist_ok=True)
        out_p.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {out_p.relative_to(HERE) if out_p.is_relative_to(HERE) else out_p}")
    return 0 if status == "GREEN" else 1


if __name__ == "__main__":
    sys.exit(main())

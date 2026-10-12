"""S0 manifest (docs/specs/extraction-pipeline.md §3.3, build item B3; tasks T333, T402, T403).

    uv run source_adapter.py g10-math                  # S0a first: work/<book>/…
    uv run build_manifest.py g10-math                  # → manifest (book config's `manifest`) + .review.html
    uv run build_manifest.py g10-math --check-draft <draft.json>   # prove the default build reproduces it
    uv run build_manifest.py g10-math --dry-run        # print the summary, write nothing

TWO STEPS, deterministic, no model:

1. The DEFAULT build: one numbered teaching section = one lesson (decisions.md B). This is the
   S0 scout's manifest (scratch_g10/build_manifest_draft.py), made from the adapter's outputs
   instead of the scouting scans. `--check-draft` compares it, record by record, with the
   draft G0 was shown; it must be identical where the draft says anything (T333).

2. THE GATE'S DECISIONS: the book config's `lesson_unit` (G0's splits, promotions and merges;
   declined proposals are recorded, not applied) turns sections into lessons. Every lesson
   carries its BOOK PROVENANCE (FR-4311, decision 18):

       book_provenance = { sections:      [{number, title, code}]   printed order
                           part:          {n, of} | null            a part of a split section
                           chapter_intro: bool                      a promoted introduction
                           group_key:     "1.7"                     the section a part belongs to;
                                                                    the lesson's own section otherwise }

   A part's inventory is the stretch of the section's EPUB blocks from its first anchor (a
   sub-heading code, a worked-example number or an exercise set the config names) to the next
   part's; an exercise the EPUB keeps in its own file goes to the part that names it. A merged
   lesson is the union of its sections. A set that closes a split section and belongs to no
   part (6-6) is listed under the module's `section_exercises_to_map` for S1, like the
   end-of-chapter set.

Ids follow specs/003-curriculum-tracks/contracts/pipeline-handoff.md: lesson g10m<ch>s<sec>-<part>
(a merged lesson takes its slug_section's number), module module:g10m-cNN, LOs lo:<lesson>-<n>.
"""

from __future__ import annotations

import argparse
import collections
import html
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import book_config  # noqa: E402

TOP_Y = 60          # a heading at y <= this sits at the top of the body area (body top is y = 46)
SPLIT_OVER = 12     # printed pages; spec §3.3
SLUG_RE = re.compile(r"^[a-z0-9]{1,12}-[0-9]{1,3}$")   # app/src/lib/lesson-slug.ts


# ============================================================================ inputs
def load_inputs(book, work: Path) -> dict:
    need = ["pdf_scan.json", "epub_index.json", "edition-check.json", "blocks.jsonl", "adapter-summary.json",
            "equations.json", "page_map.json"]
    missing = [n for n in need if not (work / n).exists()]
    if missing:
        raise SystemExit(f"{work}: {', '.join(missing)} missing — run `uv run source_adapter.py {book.book}` first")
    summary = json.loads((work / "adapter-summary.json").read_text())
    if not summary.get("all_checks_pass"):
        raise SystemExit(f"{work}/adapter-summary.json: the adapter's own checks are not all green; fix S0a first")
    return {
        "P": json.loads((work / "pdf_scan.json").read_text()),
        "E": json.loads((work / "epub_index.json").read_text()),
        "C": json.loads((work / "edition-check.json").read_text()),
        "blocks": [json.loads(l) for l in (work / "blocks.jsonl").read_text().splitlines() if l.strip()],
        "summary": summary,
        "equations": json.loads((work / "equations.json").read_text()),
        "page_map": json.loads((work / "page_map.json").read_text()),
    }


# ============================================================================ answer typing (the scout's)
SYM = {"−": "-", "◦": "°", "′": "'", "×": "x"}


def norm(t):
    for a, b in SYM.items():
        t = t.replace(a, b)
    return re.sub(r"\s+", " ", t).strip().rstrip(".").strip()


WORDS_OK = {"sin", "cos", "tan", "and", "or", "for", "if", "is", "cm", "mm", "km", "kg", "ml", "units", "unit",
            "feet", "years", "months", "days"}
UNIT = r"(?:°|%|cm2|cm3|cm²|cm³|m2|m3|mm|cm|km|m|L|ml|kg|g|s|h|units?|years?|months?|days?|people|learners|feet|ft)"


def answer_type(t):
    """Heuristic type of a printed answer (PDF text layer). Spot-checked at 8 per type in the S0
    report; expect a few percent misfiled. S3 types every item properly (FR-4303, FR-4320)."""
    s = norm(t)
    s = re.sub(r"^=\s*", "", s)
    s = s.replace("ˆ", "")
    if not s:
        return "none"
    if "˙" in s:
        return "recurring_decimal"
    if re.fullmatch(r"\(?[ivx]+\)?", s) or re.fullmatch(r"[A-D]", s):
        return "choice_label"
    if re.search(r"\([^()]*;[^()]*\)", s):
        return "coordinates"
    if re.search(r"[<>≤≥∈]|\binfinity\b|∞|\{", s):
        return "inequality_interval_set"
    if re.search(r"\b(or|and)\b", s) and re.search(r"\d", s) or s.count(";") >= 1 or re.search(r"=.*,.*=", s):
        return "multi_value"
    alpha = [w for w in re.findall(r"[A-Za-z]{3,}", s) if w.lower() not in WORDS_OK]
    if alpha and not re.search(r"[=^]", s) and not re.fullmatch(r"R ?[\d ,]+", s):
        if not re.search(r"\d", s) or len(" ".join(alpha)) > 6:
            return "text"
    if re.fullmatch(r"[A-Za-zθαβ]{1,3}\d?\s*=\s*-?\d[\d ]*(,\d+)?\s*" + UNIT + r"?", s):
        return "var_equals_number"
    if "√" in s or "π" in s:
        return "exact_surd_or_pi"
    if re.fullmatch(r"-?\d{1,3}( \d{3})+(,\d+)?|-?\d+", s):
        return "number_integer" if "," not in s else "number_decimal_comma"
    if re.fullmatch(r"-?\d+(,\d+)?(\.\.\.)?", s):
        return "number_decimal_comma"
    if re.fullmatch(r"(R ?)?-?\d[\d ]*(,\d+)?\s*" + UNIT + r"?", s) and re.search(r"R|" + UNIT + "$", s):
        return "number_with_unit"
    if re.fullmatch(r"-?\d+ \d+", s) or re.fullmatch(r"-?\d+ \d+ \d+", s) or re.fullmatch(r"= ?-?\d+ \d+", s):
        return "fraction_flattened"
    if re.search(r"[A-Za-z]", s):
        return "algebraic"
    return "other"


GRADABLE = {
    "number_integer": "yes",
    "number_decimal_comma": "after_normalisation",
    "number_with_unit": "after_normalisation",
    "fraction_flattened": "after_normalisation",
    "var_equals_number": "after_normalisation",
    "text": "exact_text_only",
    "choice_label": "exact_text_only",
    "algebraic": "no",
    "exact_surd_or_pi": "no",
    "coordinates": "no",
    "multi_value": "no",
    "inequality_interval_set": "no",
    "recurring_decimal": "no",
    "other": "no",
    "none": "no",
}
NO_ANSWER_VERB = re.compile(r"\b(prove|show that|show|sketch|draw|construct|plot|explain|describe|investigate|"
                            r"complete the table|complete|justify|verify|discuss|represent)\b", re.I)


# ============================================================================ step 1: the default build
class Default:
    """The one-section-one-lesson manifest, rule for rule the S0 scout's (build_manifest_draft.py)."""

    def __init__(self, inp: dict, book):
        self.P, self.E, self.C = inp["P"], inp["E"], inp["C"]
        self.book = book
        self.offset = book.page_offsets[0].pdf_minus_printed if book.page_offsets else 0
        self.blocks = inp["blocks"]
        self.items_by_ex = collections.defaultdict(list)
        for b in self.blocks:
            if b["type"] == "exercise_item":
                self.items_by_ex[b["exercise"]].append(b)

    def printed(self, pdfp):
        return pdfp - self.offset

    def build(self):
        P, E, C = self.P, self.E, self.C
        printed = self.printed
        efiles = [f for f in E["files"] if f["file"].endswith(".cnxmlplus.html")]
        openers = [o["pdf"] for o in P["outline"] if o["level"] == 2][:14]
        chapter_titles = [o["title"] for o in P["outline"] if o["level"] == 2][:14]
        answers_start = P["answers_start_pdf"]
        no_folio = [p["pdf"] for p in P["page_map"] if p["printed"] is None]
        self.openers, self.no_folio = openers, no_folio

        secs = P["sections"]
        span = {}
        for i, s in enumerate(secs):
            ch = int(s["num"].split(".")[0])
            nxt = secs[i + 1] if i + 1 < len(secs) else None
            if nxt is not None and int(nxt["num"].split(".")[0]) == ch:
                end = nxt["pdf"] if nxt["y"] > TOP_Y else nxt["pdf"] - 1
                ends_mid = nxt["y"] > TOP_Y
            else:
                end = (openers[ch] - 1) if ch < 14 else answers_start - 1
                while end in no_folio:
                    end -= 1
                ends_mid = False
            start = s["pdf"]
            starts_mid = s["y"] > TOP_Y
            first_in_chapter = i == 0 or int(secs[i - 1]["num"].split(".")[0]) != ch
            preamble = None
            if first_in_chapter and s["pdf"] > openers[ch - 1] + 1 or (first_in_chapter and s["y"] > 200):
                pre_start = openers[ch - 1] + 1
                preamble = {"pdf_pages": [pre_start, s["pdf"]],
                            "printed_pages": [printed(pre_start), printed(s["pdf"])]}
                start = pre_start
                starts_mid = False
            span[s["num"]] = {"pdf": [start, end], "printed": [printed(start), printed(end)],
                              "page_count": end - start + 1, "starts_mid_page": starts_mid,
                              "ends_mid_page": ends_mid, "heading_pdf_page": s["pdf"], "heading_y": s["y"],
                              "preamble": preamble}
        self.span = span

        pwe = collections.defaultdict(dict)
        sec_iter = sorted([(s["pdf"], s["y"], int(s["num"].split(".")[0])) for s in secs])
        for w in P["worked_examples"]:
            ch = [c for p, y, c in sec_iter if p <= w["pdf"]][-1]
            pwe[ch][w["n"]] = w
        self.pex = {e["label"]: e for e in P["exercises"] if e["where"] == "body"}
        self.pans = {a["label"]: a for a in P["answers"]}

        chapters = collections.OrderedDict()
        for f in efiles:
            chapters.setdefault(int(f["file"][:2]), []).append(f)
        pdf_by_code = {}
        for s in secs:
            pdf_by_code.setdefault(s["code"], s)

        def pdf_section_for(ch, es, is_summary):
            if is_summary:
                return [s for s in secs if int(s["num"].split(".")[0]) == ch][-1]
            return pdf_by_code["EMA" + es["id"][5:]] if es.get("id") else None

        modules = []
        for ch, files in chapters.items():
            opener = openers[ch - 1]
            ch_end = (openers[ch] - 1) if ch < 14 else answers_start - 1
            while ch_end in no_folio:
                ch_end -= 1
            mod = {"id": f"module:g10m-c{ch:02d}", "chapter": ch, "title": chapter_titles[ch - 1],
                   "order_in_parent": ch, "pdf_pages": [opener, ch_end], "printed_pages": [printed(opener), printed(ch_end)],
                   "opener_pdf_page": opener, "epub_files": [f["file"] for f in files],
                   # body pages no lesson, introduction or summary holds, each with its reason (the
                   # coverage audit's page equality, §3.11). The opener is the chapter's contents list.
                   "excluded_pages": [{"pages": [printed(opener), printed(opener)],
                                       "reason": "chapter opener: the chapter's contents list (section titles "
                                                 "and page numbers), nothing to teach"}],
                   "introduction": None, "lessons": [], "chapter_summary": None, "end_of_chapter_exercise": None}
            current = None
            for f in files:
                if f["sections"]:
                    es = f["sections"][0]
                    is_summary = es["title"].strip().lower() in ("chapter summary", "summary")
                    ps = pdf_section_for(ch, es, is_summary)
                    num = ps["num"]
                    sp = span[num]
                    wes = []
                    for k, w in enumerate(f["worked_examples"], 1):
                        pw = pwe[ch].get(w["n"])
                        wes.append({"n": w["n"], "title": w["title"], "pdf_page": pw["pdf"] if pw else None,
                                    "printed_page": printed(pw["pdf"]) if pw else None,
                                    "epub_locator": f"{f['file']}::div.worked_example[{k}]",
                                    "worksteps": w["worksteps"], "figures": w["figures"]})
                    exs = [self.exercise_record(x, f["file"]) for x in f["exercises"]]
                    figc = collections.Counter(x["context"] for x in f["figures"])
                    rec = {
                        "section": num, "title": ps["title"] if not is_summary else "Chapter summary",
                        "code": ps["code"], "pdf_pages": sp["pdf"], "printed_pages": sp["printed"],
                        "page_count": sp["page_count"], "starts_mid_page": sp["starts_mid_page"],
                        "ends_mid_page": sp["ends_mid_page"],
                        "epub": {"file": f["file"], "anchor": f"#{es['id']}" if es.get("id") else None,
                                 "heading_id": es.get("heading_id"), "epub_section_number": es.get("num")},
                        "subheadings": [{"title": s["title"],
                                         "code": s["id"][2:] if (s.get("id") or "").startswith("sc") else None}
                                        for s in f["subheadings"]],
                        "worked_examples": wes,
                        "exercises": [x for x in exs if not x["end_of_chapter"]],
                        "figures": {"book": sum(v for k, v in figc.items() if k != "exercise_solution"),
                                    "epub_solution_only": figc.get("exercise_solution", 0), "by_context": dict(figc)},
                        "boxes": f["boxes"],
                        "media_shortcodes": [v["id"][2:] for v in f["videos"] if v.get("id")],
                        "maths_images": {"inline": f["math_inline"], "block": f["math_block"]},
                        "flags": [],
                    }
                    if sp["preamble"] and sp["preamble"]["pdf_pages"][0] < sp["preamble"]["pdf_pages"][1]:
                        rec["flags"].append(f"includes the chapter preamble before the section heading "
                                            f"(printed {sp['preamble']['printed_pages'][0]}–{sp['preamble']['printed_pages'][1]})")
                    if es.get("num") and es["num"] != num:
                        rec["flags"].append(f"EPUB numbers this section {es['num']}, the PDF {num} (same code {ps['code']})")
                    if is_summary and not es.get("id"):
                        rec["flags"].append(f"EPUB summary heading has no number and no section-code id; the PDF prints "
                                            f"'{num} {ps['title']}' with code {ps['code']}"
                                            + (" (the same code as the section before it)"
                                               if sum(1 for x in secs if x["code"] == ps["code"]) > 1 else ""))
                    eoc = [x for x in exs if x["end_of_chapter"]]
                    if is_summary:
                        rec["role"] = "not a lesson: S1 evidence (summary bullets)"
                        rec["summary_bullets_pages"] = sp["printed"]
                        mod["chapter_summary"] = rec
                        current = rec
                    elif num.endswith(".1") and ps["title"] == "Introduction":
                        rec["role"] = "not a lesson under the default: S1 evidence (introduction)"
                        if rec["worked_examples"] or rec["exercises"]:
                            rec["flags"].append("carries worked examples and/or an exercise set: proposal P2 promotes it to a lesson")
                        mod["introduction"] = rec
                        current = rec
                    else:
                        sec_no = int(num.split(".")[1])
                        rec["id"] = f"g10m{ch}s{sec_no}-1"
                        rec["lo_id_pattern"] = f"lo:g10m{ch}s{sec_no}-1-<n>"
                        rec["order_in_module"] = len(mod["lessons"]) + 1
                        if sp["page_count"] > SPLIT_OVER:
                            rec["flags"].append(f"split candidate: {sp['page_count']} pages > {SPLIT_OVER}")
                        if len(rec["exercises"]) > 3 and sum(x["items"] for x in rec["exercises"]) > 30:
                            rec["flags"].append(f"split candidate: {len(rec['exercises'])} separately exercised methods (> 3)")
                        if not rec["worked_examples"] and not rec["exercises"]:
                            rec["flags"].append("no worked example and no exercise item: cannot ground an objective alone (merge candidate)")
                        mod["lessons"].append(rec)
                        current = rec
                    if eoc:
                        mod["end_of_chapter_exercise"] = eoc[0]
                else:
                    for x in f["exercises"]:
                        xr = self.exercise_record(x, f["file"])
                        if xr["end_of_chapter"]:
                            xr["attach"] = ("chapter (module); every item is assigned to one lesson by S1's exercise map; "
                                            "the printed pages sit inside the Chapter summary section")
                            mod["end_of_chapter_exercise"] = xr
                        else:
                            xr["note"] = "EPUB puts this exercise in its own file after the section's file"
                            current["exercises"].append(xr)
            modules.append(mod)

        ex_rows = {r["label"]: r for r in C["exercises"]["rows"]}
        for mod in modules:
            for sec in [mod["introduction"]] + mod["lessons"] + [mod["chapter_summary"]]:
                if not sec:
                    continue
                for x in sec["exercises"]:
                    r = ex_rows[x["label"]]
                    if not r["questions_match"]:
                        x.setdefault("flags", []).append(
                            f"question count differs: EPUB {r['epub_questions']}, PDF shortcode list {r['pdf_max_q']} "
                            f"(leaves equal: EPUB {r['epub_entries']} items)")
            x = mod["end_of_chapter_exercise"]
            if x and not ex_rows[x["label"]]["questions_match"]:
                x.setdefault("flags", []).append("question count differs between formats")
        for mod in modules:
            for sec in mod["lessons"] + [mod["introduction"]]:
                if sec:
                    for x in sec["exercises"]:
                        if x["label"] == "5-1":
                            x.setdefault("flags", []).append(
                                "EPUB markup: only question 1 sits under the exercise title; questions 2–7 follow in "
                                "untitled sibling blocks (folded in by the scan)")
                        if x["label"] == "13-3":
                            x.setdefault("flags", []).append(
                                "nesting differs: PDF prints 1a–c + 2–4 (4 questions), EPUB 6 flat items; same 6 items")
        self.modules = modules
        return modules

    def exercise_record(self, ex, fname):
        lab = ex["label"]
        pe = self.pex[lab]
        pa = self.pans.get(lab, {"leaves": [], "pdf_first": None, "pdf_last": None})
        leaves_by_q = collections.defaultdict(list)
        for l in pa["leaves"]:
            leaves_by_q[l["q"]].append(l)
        types, grad, no_ans_kinds = collections.Counter(), collections.Counter(), collections.Counter()
        items = matched = 0
        for q in ex["questions"]:
            n = len(q["entries"])
            L = leaves_by_q.get(q["q"], [])
            items += n
            for i, e in enumerate(q["entries"]):
                # the scout's POSITIONAL pairing, kept so the draft reproduces; blocks.jsonl pairs
                # by sub-part letter, which S3 reads (see printed_answers.items_with_answer_by_label)
                if len(L) == n or (i < len(L)):
                    leaf = L[i] if len(L) > i else None
                elif len(L) == 1 and n > 1:
                    leaf = L[0] if i == 0 else None
                else:
                    leaf = None
                if leaf is not None and norm(leaf["text"]):
                    matched += 1
                    t = answer_type(leaf["text"])
                else:
                    stem = (q.get("header_text", "") + " " + e["problem_text"])
                    m = NO_ANSWER_VERB.search(stem)
                    no_ans_kinds[m.group(1).lower() if m else "unspecified"] += 1
                    t = "none"
                types[t] += 1
                grad[GRADABLE[t]] += 1
        sc = pe["shortcodes"]
        last_body = max([s["pdf"] for s in sc] or [pe["pdf"]])
        blk = self.items_by_ex.get(lab, [])
        return {
            "label": lab,
            "end_of_chapter": pe["end_of_chapter"],
            "pdf_pages": [pe["pdf"], last_body], "printed_pages": [self.printed(pe["pdf"]), self.printed(last_body)],
            "epub": {"file": fname, "locator": f"{fname}::span.exerciseTitle[Exercise {lab.replace('-', '.')}]"},
            "questions": len(ex["questions"]),
            "items": items,
            "items_per_question": [len(q["entries"]) for q in ex["questions"]],
            "shortcodes": {s["label"]: s["code"] for s in sc},
            "printed_answers": {
                "appendix_pdf_pages": [pa["pdf_first"], pa["pdf_last"]],
                "appendix_printed_pages": [self.printed(pa["pdf_first"]), self.printed(pa["pdf_last"])] if pa["pdf_first"] else None,
                "leaves_parsed": len(pa["leaves"]),
                "items_with_printed_answer": matched,
                "items_without_printed_answer": items - matched,
                "no_answer_stem_verbs": dict(no_ans_kinds),
                "items_with_answer_by_label": sum(1 for b in blk if b.get("printed_answer")
                                                  and b["printed_answer"]["scope"] == "item"),
            },
            "epub_inline_worked_solutions": sum(1 for q in ex["questions"] for e in q["entries"] if e["has_solution"]),
            "answer_types": dict(types),
            "gradable_today": dict(grad),
            "figures": {"in_problems": sum(e["problem_figures"] for q in ex["questions"] for e in q["entries"])
                        + sum(q.get("header_figures", 0) for q in ex["questions"]),
                        "in_epub_solutions": sum(e["solution_figures"] for q in ex["questions"] for e in q["entries"])},
            "maths_images": {"problems": sum(e["problem_math"] for q in ex["questions"] for e in q["entries"]),
                             "solutions": sum(e["solution_math"] for q in ex["questions"] for e in q["entries"])},
            "item_keys": [b["item_key"] for b in blk],
            # the SAME items as S1 and S3 name them (assemble_objectives.item_ref): exercise label,
            # question number, sub-part — what the coverage audit counts against (§3.11)
            "item_refs": [f"Ex{b['exercise']}:{b['q']}{b.get('sub') or ''}" for b in blk],
        }

    def totals(self):
        P, E, C, modules = self.P, self.E, self.C, self.modules
        all_ex = []
        for m in modules:
            for sec in [m["introduction"]] + m["lessons"] + [m["chapter_summary"]]:
                if sec:
                    all_ex.extend(sec["exercises"])
            if m["end_of_chapter_exercise"]:
                all_ex.append(m["end_of_chapter_exercise"])
        types_total, grad_total, noans_total = collections.Counter(), collections.Counter(), collections.Counter()
        for x in all_ex:
            types_total.update(x["answer_types"])
            grad_total.update(x["gradable_today"])
            noans_total.update(x["printed_answers"]["no_answer_stem_verbs"])
        refs = sum(f["math_inline"] + f["math_block"] for f in E["files"])
        return {
            "chapters": len(modules),
            "numbered_sections": len(P["sections"]),
            "lessons_default": sum(len(m["lessons"]) for m in modules),
            "introductions": sum(1 for m in modules if m["introduction"]),
            "chapter_summaries": sum(1 for m in modules if m["chapter_summary"]),
            "worked_examples": sum(len(sec["worked_examples"]) for m in modules
                                   for sec in [m["introduction"]] + m["lessons"] + [m["chapter_summary"]] if sec),
            "exercise_sets": len(all_ex),
            "exercise_sets_in_lessons": sum(len(l["exercises"]) for m in modules for l in m["lessons"]),
            "exercise_sets_in_introductions": sum(len(m["introduction"]["exercises"]) for m in modules if m["introduction"]),
            "exercise_sets_end_of_chapter": sum(1 for m in modules if m["end_of_chapter_exercise"]),
            "exercise_questions_numbered": sum(x["questions"] for x in all_ex),
            "exercise_items": sum(x["items"] for x in all_ex),
            "exercise_items_end_of_chapter": sum(m["end_of_chapter_exercise"]["items"] for m in modules
                                                 if m["end_of_chapter_exercise"]),
            "exercise_shortcodes": sum(len(x["shortcodes"]) for x in all_ex),
            "printed_answer_leaves_parsed": sum(x["printed_answers"]["leaves_parsed"] for x in all_ex),
            "items_with_printed_answer": sum(x["printed_answers"]["items_with_printed_answer"] for x in all_ex),
            "items_without_printed_answer": sum(x["printed_answers"]["items_without_printed_answer"] for x in all_ex),
            "items_with_epub_worked_solution": sum(x["epub_inline_worked_solutions"] for x in all_ex),
            "figures_book_pdf": sum(r["pdf_total"] for r in self.fig_rows()),
            "figures_book_epub": sum(r["epub_excl_solutions"] for r in self.fig_rows()),
            "figures_epub_solutions_only": sum(r["epub_all"] - r["epub_excl_solutions"] for r in self.fig_rows()),
            "equation_images_refs": refs,
            "equation_images_unique": None,   # filled from equations.json by the caller
            "answer_types": dict(types_total.most_common()),
            "gradable_today": dict(grad_total.most_common()),
            "no_printed_answer_stem_verbs": dict(noans_total.most_common()),
            "past_exam_papers": {"papers": 2, "questions": 16, "mark_tagged_parts": 77, "answers_printed": False,
                                 "in_epub": False},
        }

    def fig_rows(self):
        """Figures per chapter, PDF placements vs EPUB references (the edition check's table)."""
        if hasattr(self, "_fig_rows"):
            return self._fig_rows
        P, E = self.P, self.E
        openers = [o["pdf"] for o in P["outline"] if o["level"] == 2][:14]
        span = {}
        for ch in range(1, len(openers) + 1):
            start = openers[ch - 1]
            end = (openers[ch] - 1) if ch < len(openers) else P["answers_start_pdf"] - 1
            span[ch] = (start, end)
        pfig, pras, efig, eall = (collections.Counter() for _ in range(4))
        for fg in P["figures"]:
            for ch, (a, b) in span.items():
                if a <= fg["pdf"] <= b:
                    pfig[ch] += 1
        for r in P["rasters"]:
            for ch, (a, b) in span.items():
                if a <= r["pdf"] <= b:
                    pras[ch] += 1
        for f in E["files"]:
            if not f["file"].endswith(".cnxmlplus.html"):
                continue
            ch = int(f["file"][:2])
            for x in f["figures"]:
                eall[ch] += 1
                if x["context"] != "exercise_solution":
                    efig[ch] += 1
        self._fig_rows = [{"chapter": ch, "pdf_total": pfig[ch] + pras[ch], "epub_excl_solutions": efig[ch],
                           "epub_all": eall[ch]} for ch in span]
        return self._fig_rows


# ============================================================================ step 2: G0's decisions
def block_inventory(blocks: list) -> dict:
    figc = collections.Counter(f["context"] for b in blocks for f in b.get("figures", []))
    boxes = collections.Counter()
    for b in blocks:
        if b["type"] == "box":
            boxes[b["kind"]] += 1
        elif b["type"] == "definition":
            boxes["definition"] += 1
        elif b["type"] == "teacher_only":
            boxes["teachers_guide"] += 1
    kinds = collections.Counter(k for b in blocks for k in b.get("math_kinds", []))
    media = []
    for b in blocks:
        if b["type"] == "media" and b.get("code"):
            media.append(b["code"])
        for m in b.get("media", []) or []:
            if m.get("code"):
                media.append(m["code"])
    return {
        "figures": {"book": sum(v for k, v in figc.items() if k != "exercise_solution"),
                    "epub_solution_only": figc.get("exercise_solution", 0), "by_context": dict(figc)},
        "boxes": dict(boxes),
        "media_shortcodes": media,
        "maths_images": {"inline": kinds.get("inline", 0), "block": kinds.get("block", 0)},
    }


def provenance(sections: list, part=None, chapter_intro=False, group_key=None) -> dict:
    return {"sections": [{"number": s["section"], "title": s["title"], "code": s["code"]} for s in sections],
            "part": part, "chapter_intro": chapter_intro,
            "group_key": group_key or sections[0]["section"]}


def slug_for(section: str, part: int = 1) -> str:
    ch, sec = section.split(".")
    return f"g10m{int(ch)}s{int(sec)}-{part}"


class Apply:
    def __init__(self, default: Default, book, blocks: list):
        self.d, self.book = default, book
        self.lu = book.lesson_unit
        self.blocks_by_section = collections.defaultdict(list)
        for b in blocks:
            self.blocks_by_section[b["section"]].append(b)
        P = default.P
        self.sub_pos = {s["code"]: (s["pdf"], s["y"]) for s in P["subheadings"]}
        self.applied_log = []

    def split(self, rec: dict, sp, mod: dict) -> list:
        """Parts of one section. Returns lesson records, in part order."""
        blocks = self.blocks_by_section[rec["section"]]
        n_parts = len(sp.parts)
        owner_of_set = {}
        for k, p in enumerate(sp.parts, 1):
            for lab in p.exercise_sets:
                owner_of_set[lab] = k
        # the first block of each part (k >= 2), in EPUB order, among the blocks of the section's own file
        own = [b for b in blocks if b["file"] == rec["epub"]["file"]]
        starts = {1: 0}
        for k, p in enumerate(sp.parts[1:], 2):
            idx = None
            for i, b in enumerate(own):
                hit = (b["type"] == "heading" and b.get("code") in p.subheadings) or \
                      (b["type"] == "worked_example" and b.get("n") in p.worked_examples) or \
                      (b["type"] in ("exercise_header", "exercise_item") and b.get("exercise") in p.exercise_sets)
                if hit:
                    idx = i
                    break
            if idx is None:
                raise SystemExit(f"split {sp.id} part {k}: none of its anchors is in {rec['epub']['file']}")
            starts[k] = idx
        order = [starts[k] for k in range(1, n_parts + 1)]
        if order != sorted(order):
            raise SystemExit(f"split {sp.id}: the parts' anchors are not in book order ({order})")
        part_blocks = {k: [] for k in range(1, n_parts + 1)}
        unassigned_blocks = []
        for i, b in enumerate(own):
            k = max(kk for kk in starts if starts[kk] <= i)
            lab = b.get("exercise")
            if lab and lab in sp.unassigned_exercise_sets:
                unassigned_blocks.append(b)
            elif lab and lab in owner_of_set:
                part_blocks[owner_of_set[lab]].append(b)
            else:
                part_blocks[k].append(b)
        for b in blocks:                       # exercises the EPUB keeps in their own file
            if b["file"] == rec["epub"]["file"]:
                continue
            lab = b.get("exercise")
            if lab in sp.unassigned_exercise_sets:
                unassigned_blocks.append(b)
            elif lab in owner_of_set:
                part_blocks[owner_of_set[lab]].append(b)
            elif not b.get("end_of_chapter"):
                raise SystemExit(f"split {sp.id}: block {b['id']} ({b['type']}) is outside the section file "
                                 f"and names no part's exercise set")
        # every worked example, sub-heading and exercise set lands where the config says
        for k, p in enumerate(sp.parts, 1):
            got_we = [b["n"] for b in part_blocks[k] if b["type"] == "worked_example"]
            if sorted(got_we) != sorted(p.worked_examples):
                raise SystemExit(f"split {sp.id} part {k}: the config names worked examples {p.worked_examples}, "
                                 f"the EPUB order gives {got_we}")
        got = [(b["title"], b.get("code")) for k in part_blocks for b in part_blocks[k]
               if b["type"] == "heading" and b.get("level", 2) >= 3]
        want = [(x["title"], x["code"]) for x in rec["subheadings"]]
        if sorted(got, key=str) != sorted(want, key=str):
            raise SystemExit(f"split {sp.id}: the parts' sub-headings {got} are not the section's {want}")
        # pages: part k starts at its first anchor's page
        starts_pdf = {1: (rec["pdf_pages"][0], rec["starts_mid_page"])}
        for k in range(2, n_parts + 1):
            b = own[starts[k]]
            page = b["pdf_page"]
            if b["type"] == "heading" and b.get("code") in self.sub_pos:
                mid = self.sub_pos[b["code"]][1] > TOP_Y
            else:
                mid = True        # a worked example or exercise starts inside the page
            starts_pdf[k] = (page, mid)
        ex_by_label = {x["label"]: x for x in rec["exercises"]}
        lessons = []
        for k, p in enumerate(sp.parts, 1):
            first, first_mid = starts_pdf[k]
            if k < n_parts:
                nxt, nxt_mid = starts_pdf[k + 1]
                last = nxt if nxt_mid else nxt - 1
                ends_mid = nxt_mid
            else:
                last, ends_mid = rec["pdf_pages"][1], rec["ends_mid_page"]
            inv = block_inventory(part_blocks[k])
            lesson = {
                "section": rec["section"], "title": rec["title"], "part_title": p.title, "code": rec["code"],
                "pdf_pages": [first, last], "printed_pages": [self.d.printed(first), self.d.printed(last)],
                "page_count": last - first + 1, "starts_mid_page": first_mid, "ends_mid_page": ends_mid,
                "epub": dict(rec["epub"], part_starts_at=(None if k == 1 else own[starts[k]]["id"])),
                # the part's own sub-headings, in book order (6.6 repeats uncoded titles in every part)
                "subheadings": [{"title": b["title"], "code": b.get("code")} for b in part_blocks[k]
                                if b["type"] == "heading" and b.get("level", 2) >= 3],
                "worked_examples": [w for w in rec["worked_examples"] if w["n"] in p.worked_examples],
                "exercises": [ex_by_label[l] for l in p.exercise_sets if l in ex_by_label],
                **inv,
                "flags": [],
                "id": slug_for(rec["section"], k),
                "lo_id_pattern": f"lo:{slug_for(rec['section'], k)}-<n>",
                "book_provenance": provenance([rec], part={"n": k, "of": n_parts}, group_key=rec["section"]),
                "decision": sp.id,
            }
            if k == 1 and any("preamble" in f for f in rec["flags"]):
                lesson["flags"] += [f for f in rec["flags"] if "preamble" in f]
            if not lesson["exercises"] and sp.unassigned_exercise_sets:
                lesson["flags"].append(f"practice comes from {', '.join(sp.unassigned_exercise_sets)}, which closes "
                                       f"the section: S1's exercise map assigns its items to the parts")
            lessons.append(lesson)
        if sp.unassigned_exercise_sets:
            mod.setdefault("section_exercises_to_map", []).append({
                "section": rec["section"], "decision": sp.id,
                "lessons": [l["id"] for l in lessons],
                "exercises": [ex_by_label[l] for l in sp.unassigned_exercise_sets if l in ex_by_label],
                "note": sp.note,
            })
        mod.setdefault("section_groups", []).append({
            "group_key": rec["section"], "title": rec["title"], "decision": sp.id,
            "lessons": [l["id"] for l in lessons], "pdf_pages": rec["pdf_pages"],
            "printed_pages": rec["printed_pages"], "page_count": rec["page_count"],
            "worked_examples": len(rec["worked_examples"]),
            "exercise_items": sum(x["items"] for x in rec["exercises"]),
        })
        self.applied_log.append({"id": sp.id, "kind": "split", "section": rec["section"],
                                 "lessons": [l["id"] for l in lessons],
                                 "items": [sum(x["items"] for x in l["exercises"]) for l in lessons],
                                 "worked_examples": [[w["n"] for w in l["worked_examples"]] for l in lessons],
                                 "unassigned_exercise_sets": list(sp.unassigned_exercise_sets)})
        return lessons

    def merge(self, recs: list, mg) -> dict:
        host = next(r for r in recs if r["section"] == mg.slug_section)
        first, last = recs[0], recs[-1]
        wes = [w for r in recs for w in r["worked_examples"]]
        exs = [x for r in recs for x in r["exercises"]]
        figs = collections.Counter()
        for r in recs:
            figs.update(r["figures"]["by_context"])
        boxes = collections.Counter()
        for r in recs:
            boxes.update(r["boxes"])
        lesson = {
            "section": host["section"], "title": host["title"], "code": host["code"],
            "sections_merged": [r["section"] for r in recs],
            "pdf_pages": [first["pdf_pages"][0], last["pdf_pages"][1]],
            "printed_pages": [first["printed_pages"][0], last["printed_pages"][1]],
            "page_count": last["pdf_pages"][1] - first["pdf_pages"][0] + 1,
            "starts_mid_page": first["starts_mid_page"], "ends_mid_page": last["ends_mid_page"],
            "epub": {"files": [r["epub"]["file"] for r in recs], "anchors": [r["epub"]["anchor"] for r in recs]},
            "subheadings": [s for r in recs for s in r["subheadings"]],
            "worked_examples": wes, "exercises": exs,
            "figures": {"book": sum(v for k, v in figs.items() if k != "exercise_solution"),
                        "epub_solution_only": figs.get("exercise_solution", 0), "by_context": dict(figs)},
            "boxes": dict(boxes),
            "media_shortcodes": [m for r in recs for m in r["media_shortcodes"]],
            "maths_images": {"inline": sum(r["maths_images"]["inline"] for r in recs),
                             "block": sum(r["maths_images"]["block"] for r in recs)},
            "flags": [f for r in recs for f in r["flags"] if "merge candidate" not in f],
            "id": slug_for(host["section"]),
            "lo_id_pattern": f"lo:{slug_for(host['section'])}-<n>",
            "book_provenance": provenance(recs, group_key=host["section"]),
            "decision": mg.id,
        }
        self.applied_log.append({"id": mg.id, "kind": "merge", "sections": [r["section"] for r in recs],
                                 "lesson": lesson["id"], "items": sum(x["items"] for x in exs),
                                 "worked_examples": len(wes)})
        return lesson

    def promote(self, intro: dict, pr) -> dict:
        lesson = dict(intro)
        lesson.pop("role", None)
        lesson["flags"] = [f for f in intro["flags"] if "promotes it" not in f]
        lesson["id"] = slug_for(intro["section"])
        lesson["lo_id_pattern"] = f"lo:{lesson['id']}-<n>"
        lesson["book_provenance"] = provenance([intro], chapter_intro=True)
        lesson["decision"] = pr.id
        self.applied_log.append({"id": pr.id, "kind": "promote_introduction", "section": intro["section"],
                                 "lesson": lesson["id"], "items": sum(x["items"] for x in intro["exercises"]),
                                 "worked_examples": len(intro["worked_examples"])})
        return lesson

    def run(self, modules: list) -> list:
        lu = self.lu
        splits = {s.section: s for s in lu.splits} if lu else {}
        promos = {p.section: p for p in lu.promotions} if lu else {}
        merges = {}
        if lu:
            for mg in lu.merges:
                for s in mg.sections:
                    merges[s] = mg
        out = []
        seen_sections = set()
        for mod in modules:
            m = {k: v for k, v in mod.items() if k != "lessons"}
            lessons = []
            intro = mod["introduction"]
            if intro and intro["section"] in promos:
                lessons.append(self.promote(intro, promos[intro["section"]]))
                m["introduction"] = None
                m["introduction_promoted_to"] = lessons[-1]["id"]
                seen_sections.add(intro["section"])
            by_sec = {r["section"]: r for r in mod["lessons"]}
            done = set()
            for rec in mod["lessons"]:
                s = rec["section"]
                seen_sections.add(s)
                if s in done:
                    continue
                if s in merges:
                    mg = merges[s]
                    missing = [x for x in mg.sections if x not in by_sec]
                    if missing:
                        raise SystemExit(f"merge {mg.id}: sections {missing} are not teaching sections of chapter "
                                         f"{mod['chapter']}")
                    lessons.append(self.merge([by_sec[x] for x in mg.sections], mg))
                    done.update(mg.sections)
                elif s in splits:
                    lessons.extend(self.split(rec, splits[s], m))
                    done.add(s)
                else:
                    lesson = dict(rec)
                    lesson["book_provenance"] = provenance([rec])
                    lessons.append(lesson)
                    done.add(s)
            for i, l in enumerate(lessons, 1):
                l["order_in_module"] = i
            m["lessons"] = lessons
            out.append(m)
        named = set(splits) | set(promos) | set(merges)
        unknown = sorted(named - seen_sections)
        if unknown:
            raise SystemExit(f"lesson_unit names sections the book does not have as teaching sections or "
                             f"introductions: {unknown}")
        return out


# ============================================================================ checks
def compare_draft(modules: list, totals: dict, draft: dict) -> list:
    """Every value the draft states must be the default build's (extra keys are allowed)."""
    diffs = []

    def cmp(a, b, path):
        if isinstance(b, dict):
            if not isinstance(a, dict):
                diffs.append(f"{path}: draft has an object, build has {type(a).__name__}")
                return
            for k, v in b.items():
                if k not in a:
                    diffs.append(f"{path}.{k}: missing from the build")
                else:
                    cmp(a[k], v, f"{path}.{k}")
        elif isinstance(b, list):
            if not isinstance(a, list) or len(a) != len(b):
                diffs.append(f"{path}: list differs (draft {len(b) if isinstance(b, list) else b!r}, "
                             f"build {len(a) if isinstance(a, list) else a!r})")
                return
            for i, (x, y) in enumerate(zip(a, b)):
                cmp(x, y, f"{path}[{i}]")
        elif a != b:
            diffs.append(f"{path}: draft {b!r}, build {a!r}")

    cmp(modules, draft["modules"], "modules")
    t = dict(draft["totals"])
    t.pop("equation_images_unique", None)
    cmp(totals, t, "totals")
    return diffs


def check_manifest(manifest: dict, book) -> list:
    problems = []
    lessons = [l for m in manifest["modules"] for l in m["lessons"]]
    ids = [l["id"] for l in lessons]
    if len(ids) != len(set(ids)):
        problems.append("lesson ids repeat")
    for l in lessons:
        if not SLUG_RE.match(l["id"]) or not book.slug_re().match(l["id"]):
            problems.append(f"{l['id']}: not a valid lesson slug for {book.book}")
        if l["id"].startswith(("geo", "t2")):
            problems.append(f"{l['id']}: would be read as a Prep-3 term")
        bp = l.get("book_provenance")
        if not bp or not bp.get("sections"):
            problems.append(f"{l['id']}: no book provenance (FR-4311)")
    for m in manifest["modules"]:
        if m["id"].startswith(("module:geo", "module:t2-")):
            problems.append(f"{m['id']}: a term-shaped module id")
        groups = collections.defaultdict(list)
        for i, l in enumerate(m["lessons"]):
            if (l.get("book_provenance") or {}).get("part"):
                groups[l["book_provenance"]["group_key"]].append((i, l["book_provenance"]["part"]))
        for g, parts in groups.items():
            idx = [i for i, _ in parts]
            if idx != list(range(idx[0], idx[0] + len(idx))):
                problems.append(f"section {g}: parts are not consecutive (FR-4312)")
            if [p["n"] for _, p in parts] != list(range(1, len(parts) + 1)) or \
                    any(p["of"] != len(parts) for _, p in parts):
                problems.append(f"section {g}: parts are not 1..m of m")
    exp = book.lesson_unit.expected_lessons if book.lesson_unit else None
    if exp is not None and len(lessons) != exp:
        problems.append(f"{len(lessons)} lessons, but the gate approved {exp}")
    # every exercise item lands exactly once: in a lesson, the end-of-chapter set, or a set to map
    seen = collections.Counter()
    for m in manifest["modules"]:
        for l in m["lessons"]:
            for x in l["exercises"]:
                seen.update(x["item_keys"])
        if m.get("introduction"):
            for x in m["introduction"]["exercises"]:
                seen.update(x["item_keys"])
        if m["end_of_chapter_exercise"]:
            seen.update(m["end_of_chapter_exercise"]["item_keys"])
        for g in m.get("section_exercises_to_map", []):
            for x in g["exercises"]:
                seen.update(x["item_keys"])
    total = manifest["totals"]["exercise_items"]
    if sum(seen.values()) != total or any(v != 1 for v in seen.values()):
        problems.append(f"exercise items placed {sum(seen.values())} times for {total} items "
                        f"({sum(1 for v in seen.values() if v != 1)} placed more than once)")
    return problems


# ============================================================================ output
def build(book, work: Path, generated: str, draft: Path = None):
    inp = load_inputs(book, work)
    d = Default(inp, book)
    default_modules = d.build()
    totals = d.totals()
    diffs = compare_draft(default_modules, totals, json.loads(draft.read_text())) if draft else None
    applied = Apply(d, book, inp["blocks"])
    modules = applied.run(json.loads(json.dumps(default_modules)))
    totals["equation_images_unique"] = len(inp["equations"]["images"])
    lessons = [l for m in modules for l in m["lessons"]]
    kinds = collections.Counter("part" if l["book_provenance"]["part"] else
                                "chapter_intro" if l["book_provenance"]["chapter_intro"] else
                                "merged" if len(l["book_provenance"]["sections"]) > 1 else "section"
                                for l in lessons)
    totals.update({
        "lessons": len(lessons),
        "lessons_by_provenance": dict(kinds),
        "exercise_items_in_lessons": sum(x["items"] for l in lessons for x in l["exercises"]),
        "exercise_items_in_sets_to_map": sum(x["items"] for m in modules for g in m.get("section_exercises_to_map", [])
                                             for x in g["exercises"]),
        "exercise_items_in_unpromoted_introductions": sum(x["items"] for m in modules if m.get("introduction")
                                                          for x in m["introduction"]["exercises"]),
        "worked_examples_in_lessons": sum(len(l["worked_examples"]) for l in lessons),
    })
    C, P, pm = inp["C"], inp["P"], inp["page_map"]
    S = inp["summary"]
    lu = book.lesson_unit
    manifest = {
        "manifest": Path(book.manifest).stem if book.manifest else book.book,
        "stage": "S0",
        "status": (f"{lu.gate.name} passed {lu.gate.passed} ({lu.gate.by}): {len(lessons)} lessons"
                   if lu and lu.gate else "DRAFT: no gate has passed"),
        "generated": generated,
        "generated_by": "services/extraction/build_manifest.py (B3) from services/extraction/source_adapter.py (B2) "
                        "outputs, and the book config's lesson_unit. Deterministic; no model.",
        "book": {
            "book": book.book, "title": book.title,
            "publisher": "Siyavula Education (with volunteers)" if book.book == "g10-math" else None,
            "edition": "Version 1.1 CAPS" if book.book == "g10-math" else None,
            "course_id": book.course_id, "curriculum": book.curriculum,
            "program": book.program.model_dump() if book.program else None,
            "subject": book.subject, "grade": book.grade, "language": book.language, "direction": book.direction,
            "id_prefix": book.id_prefixes[0], "objectives_mode": book.objectives_mode,
            "maths_source": book.maths_source, "notation_target": book.notation,
            "notation_as_printed": {"decimal": "comma (3,317)", "pairs": "(x; y)", "lists": "semicolon-separated",
                                    "currency": "R (Rand)"} if book.book == "g10-math" else None,
            "sources": {
                "pdf": {"path": book.sources.pdf, **S["sources"]["pdf"],
                        "role": "citation authority: printed page numbers, printed answers, figures (vector forms)"},
                "epub": {"path": book.sources.epub, **S["sources"]["epub"],
                         "role": "structure and prose; per-item worked solutions; maths only as images (S0b)"},
            },
            "edition_check": {
                "verdict": C["verdict"], "summary": C["summary"], "rules": C["rules"],
                "required": C["required"],
                "content": {k: v["pass"] for k, v in C["content"].items()},
                "section_codes": f"{C['section_codes']['pdf']}/{C['section_codes']['epub']}",
                "media_codes": f"{C['media_codes']['pdf']}/{C['media_codes']['epub']}",
                "worked_examples": f"{C['worked_examples']['pdf_total']}/{C['worked_examples']['epub_total']}",
                "details": f"services/extraction/work/{book.book}/edition-check.json (regenerated by source_adapter.py)",
            },
        },
        "page_map": {
            "rule": " · ".join(f"printed = pdf - {r['pdf_minus_printed']}" for r in pm["regimes"] if r["folios"] >= 3),
            "regimes": [{k: r[k] for k in ("pdf_from", "pdf_to", "printed_from", "printed_to", "pdf_minus_printed")}
                        | {"verified_at": f"every page with a folio ({r['folios']})"} for r in pm["regimes"]],
            "verification": {
                "method": "printed folio read from every page's footer text (PyMuPDF), not from anchors",
                "pages_with_folio": pm["pages_with_folio"],
                "exceptions": pm["exceptions"],
                "pages_without_folio": pm["pages_without_folio"],
                "outline_note": "PDF bookmarks for 'Solutions to exercises' and 'Past exam papers' point one page early; "
                                "the adapter reads running heads",
            },
        },
        "id_scheme": {
            "lesson": "g10m<ch>s<sec>-<part>; a merged lesson takes its slug_section's number",
            "lo": "lo:g10m<ch>s<sec>-<part>-<n>  (S1)",
            "module": "module:g10m-c<NN>",
            "question": "q:<lo tail>:we<NN> | q:<lo tail>:ex<C>-<N>-<q><sub> (item_keys) | …:g001-<family> | …:w001",
            "contract": "specs/003-curriculum-tracks/contracts/pipeline-handoff.md",
        },
        "answer_type_legend": {
            "source": "printed answer in the Solutions appendix (PDF text layer), heuristic classifier in build_manifest.py",
            "pairing": ("items_with_printed_answer uses the S0 scout's positional pairing (kept so the draft "
                        "reproduces); items_with_answer_by_label pairs by sub-part letter, as blocks.jsonl does"),
            "mapping": GRADABLE,
        },
        "lesson_unit": {
            "rule": lu.rule if lu else "one numbered teaching section = one lesson",
            "gate": lu.gate.model_dump() if lu and lu.gate else None,
            "applied": applied.applied_log,
            "declined": [x.model_dump() for x in lu.declined] if lu else [],
            "lessons_default": totals["lessons_default"],
            "lessons": len(lessons),
            "provenance_shape": "book_provenance = {sections: [{number, title, code}], part: {n, of} | null, "
                                "chapter_intro: bool, group_key} (FR-4311, decision 18)",
        },
        "modules": modules,
        "back_matter": {
            "solutions_appendix": {"pdf_pages": [P["answers_start_pdf"], P["past_papers_start_pdf"] - 1],
                                   "printed_pages": [d.printed(P["answers_start_pdf"]),
                                                     d.printed(P["past_papers_start_pdf"] - 1)],
                                   "content": "final answers only, per exercise"},
            "past_exam_papers": {"pdf_pages": [P["past_papers_start_pdf"], P["pages"] - 3],
                                 "answers_printed": False, "in_epub": False,
                                 "note": "labelled 'Exercise 1 – 1' and 'Exercise 2 – 1', colliding with chapter 1 and 2 labels"},
        },
        "totals": totals,
    }
    problems = check_manifest(manifest, book)
    return manifest, diffs, problems


def review_html(manifest: dict) -> str:
    tpl = (HERE / "review_page_template.html").read_text()
    m = re.search(r"(:root \{.*?\n  \}\n  @media \(prefers-color-scheme: dark\) \{.*?\n  \}\n  :root\[data-theme=\"dark\"\] \{.*?\n  \})",
                  tpl, re.S)
    tokens = m.group(1) if m else ""
    fonts = re.search(r'(<link rel="stylesheet"[^>]+>)', tpl)
    e = html.escape
    rows = []
    for mod in manifest["modules"]:
        rows.append(f'<tr class="ch"><th colspan="8">{mod["chapter"]}. {e(mod["title"])} '
                    f'<span>printed {mod["printed_pages"][0]}–{mod["printed_pages"][1]}</span></th></tr>')
        for l in mod["lessons"]:
            bp = l["book_provenance"]
            secs = ", ".join(s["number"] for s in bp["sections"])
            tag = (f'part {bp["part"]["n"]} of {bp["part"]["of"]}' if bp["part"] else
                   "chapter introduction" if bp["chapter_intro"] else
                   "merged" if len(bp["sections"]) > 1 else "section")
            rows.append(
                f'<tr><td><code>{e(l["id"])}</code></td><td>{e(secs)}</td><td>{e(l["title"])}'
                f'{"<br><small>" + e(l["part_title"]) + "</small>" if l.get("part_title") else ""}</td>'
                f'<td><span class="tag">{e(tag)}</span></td>'
                f'<td>{l["printed_pages"][0]}–{l["printed_pages"][1]}</td><td>{len(l["worked_examples"])}</td>'
                f'<td>{", ".join(x["label"] for x in l["exercises"]) or "–"}</td>'
                f'<td>{sum(x["items"] for x in l["exercises"])}</td></tr>')
        for g in mod.get("section_exercises_to_map", []):
            rows.append(f'<tr class="note"><td colspan="8">Exercise {", ".join(x["label"] for x in g["exercises"])} '
                        f'({sum(x["items"] for x in g["exercises"])} items) closes §{g["section"]}: S1 maps its items to '
                        f'{", ".join(g["lessons"])}</td></tr>')
        if mod["end_of_chapter_exercise"]:
            x = mod["end_of_chapter_exercise"]
            rows.append(f'<tr class="note"><td colspan="8">End-of-chapter exercise {x["label"]}: {x["items"]} items, '
                        f'mapped to lessons by S1</td></tr>')
    t = manifest["totals"]
    b = manifest["book"]
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Manifest review: {e(b['book'])}</title>
{fonts.group(1) if fonts else ''}
<style>
  {tokens}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--ground); color:var(--ink); font-family:var(--font-body); line-height:1.6; }}
  .shell {{ max-width:1100px; margin:0 auto; padding-inline:16px; }}
  header {{ background:var(--contrast); color:var(--on-contrast); padding-block:28px; }}
  header p {{ color:var(--on-contrast-dim); }}
  h1 {{ font-family:var(--font-display); margin:0 0 6px; }}
  code {{ font-family:var(--font-mono); font-size:.86em; }}
  .scroll {{ overflow-x:auto; }}
  table {{ width:100%; border-collapse:collapse; margin-block:20px; background:var(--surface); }}
  th, td {{ text-align:start; padding:6px 10px; border-bottom:1px solid var(--rule); vertical-align:top; }}
  tr.ch th {{ background:var(--sunk); font-family:var(--font-display); }}
  tr.ch th span, small {{ color:var(--ink-soft); font-weight:400; }}
  tr.note td {{ color:var(--ink-soft); font-size:.9em; }}
  .tag {{ font-family:var(--font-mono); font-size:.8em; color:var(--teal-deep); }}
</style></head><body>
<header><div class="shell"><h1>{e(b['title'])}</h1>
<p>{e(manifest['status'])} · {t['lessons']} lessons · {t['exercise_items']} exercise items · edition check:
{e(b['edition_check']['verdict'])} · page map: {e(manifest['page_map']['rule'])}</p></div></header>
<main class="shell"><div class="scroll"><table>
<tr><th>Lesson</th><th>§</th><th>Title</th><th>Provenance</th><th>Printed</th><th>WE</th><th>Sets</th><th>Items</th></tr>
{''.join(rows)}
</table></div></main></body></html>
"""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("book")
    ap.add_argument("--work", help="the adapter's output directory (default services/extraction/work/<book>)")
    ap.add_argument("--out", help="manifest path (default: the book config's `manifest`)")
    ap.add_argument("--check-draft", help="a draft manifest the default build must reproduce")
    ap.add_argument("--generated", default="2026-09-25", help="the date stamped on the manifest")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    book = book_config.load_book(a.book)
    work = Path(a.work) if a.work else book.work_dir()
    manifest, diffs, problems = build(book, work, a.generated, Path(a.check_draft) if a.check_draft else None)
    t = manifest["totals"]
    print(f"S0 {book.book}: {t['lessons']} lessons ({t['lessons_by_provenance']}), default {t['lessons_default']}; "
          f"{t['exercise_items']} items: {t['exercise_items_in_lessons']} in lessons, "
          f"{t['exercise_items_end_of_chapter']} end-of-chapter, {t['exercise_items_in_sets_to_map']} in sets to map, "
          f"{t['exercise_items_in_unpromoted_introductions']} in unpromoted introductions")
    for x in manifest["lesson_unit"]["applied"]:
        print(f"  {x['id']:<4} {x['kind']:<20} " + json.dumps({k: v for k, v in x.items() if k not in ('id', 'kind')}))
    rc = 0
    if diffs is not None:
        if diffs:
            print(f"  RED the default build differs from the draft in {len(diffs)} place(s):")
            for x in diffs[:40]:
                print("    " + x)
            rc = 1
        else:
            print("  ok  the default build reproduces the draft wherever the draft states a value")
    if problems:
        print("  RED manifest checks:")
        for p in problems:
            print("    " + p)
        rc = 1
    else:
        print("  ok  manifest checks: slugs, provenance on every lesson, parts consecutive, items placed once, "
              f"{t['lessons']} = the gate's count")
    if a.dry_run or rc:
        return rc
    out = Path(a.out) if a.out else book.repo_path(book.manifest)
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n")
    review = out.with_suffix(".review.html")
    review.write_text(review_html(manifest))
    print(f"  → {out}\n  → {review}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

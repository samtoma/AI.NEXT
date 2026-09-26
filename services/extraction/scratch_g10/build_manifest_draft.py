"""S0 scouting: assemble the draft Stage-0 manifest for Everything Maths Grade 10 (g10m). Deterministic.

Scratch code, not B3. Reads pdf_scan.json, epub_scan.json and edition-check.json from <scan_dir> and writes
the manifest JSON to <manifest_out>, plus <scan_dir>/manifest_tables.json (the report's tables).

Lesson unit: the spec's default (docs/specs/extraction-pipeline.md §3.3, D2 option a): one numbered teaching
section = one lesson, part 1. "x.1 Introduction" and "Chapter summary" are not lessons. Split / merge /
promotion proposals are listed separately and are NOT applied.

Usage:  python3 build_manifest_draft.py <scan_dir> <manifest_out> <pdf_path> <epub_path>
"""
import collections
import hashlib
import json
import os
import re
import sys

SCAN, OUT, PDF_PATH, EPUB_PATH = sys.argv[1:5]
P = json.load(open(f"{SCAN}/pdf_scan.json"))
E = json.load(open(f"{SCAN}/epub_scan.json"))
C = json.load(open(f"{SCAN}/edition-check.json"))
OFFSET = 11
TOP_Y = 60          # a heading at y <= this sits at the top of the body area (body top is y = 46)
SPLIT_OVER = 12     # printed pages; spec §3.3


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def printed(pdfp):
    return pdfp - OFFSET


efiles = [f for f in E["files"] if f["file"].endswith(".cnxmlplus.html")]
openers = [o["pdf"] for o in P["outline"] if o["level"] == 2][:14]
chapter_titles = [o["title"] for o in P["outline"] if o["level"] == 2][:14]
answers_start = P["answers_start_pdf"]
past_start = P["past_papers_start_pdf"]
no_folio = [p["pdf"] for p in P["page_map"] if p["printed"] is None]

# ------------------------------------------------------------------ section spans (PDF)
secs = P["sections"]
span = {}
for i, s in enumerate(secs):
    ch = int(s["num"].split(".")[0])
    nxt = secs[i + 1] if i + 1 < len(secs) else None
    if nxt is not None and int(nxt["num"].split(".")[0]) == ch:
        end = nxt["pdf"] if nxt["y"] > TOP_Y else nxt["pdf"] - 1
        ends_mid = nxt["y"] > TOP_Y
    else:  # last section of the chapter: up to the page before the next opener, minus a blank verso
        end = (openers[ch] - 1) if ch < 14 else answers_start - 1
        while end in no_folio:
            end -= 1
        ends_mid = False
    start = s["pdf"]
    starts_mid = s["y"] > TOP_Y
    # first section of a chapter with no "x.1 Introduction": the chapter preamble before it belongs to it
    first_in_chapter = i == 0 or int(secs[i - 1]["num"].split(".")[0]) != ch
    preamble = None
    if first_in_chapter and s["pdf"] > openers[ch - 1] + 1 or (first_in_chapter and s["y"] > 200):
        pre_start = openers[ch - 1] + 1
        preamble = {"pdf_pages": [pre_start, s["pdf"]], "printed_pages": [printed(pre_start), printed(s["pdf"])]}
        start = pre_start
        starts_mid = False
    span[s["num"]] = {"pdf": [start, end], "printed": [printed(start), printed(end)],
                      "page_count": end - start + 1, "starts_mid_page": starts_mid, "ends_mid_page": ends_mid,
                      "heading_pdf_page": s["pdf"], "heading_y": s["y"], "preamble": preamble}

# ------------------------------------------------------------------ PDF indexes
pwe = collections.defaultdict(dict)
sec_iter = sorted([(s["pdf"], s["y"], int(s["num"].split(".")[0])) for s in secs])
for w in P["worked_examples"]:
    ch = [c for p, y, c in sec_iter if p <= w["pdf"]][-1]
    pwe[ch][w["n"]] = w
pex = {e["label"]: e for e in P["exercises"] if e["where"] == "body"}
pans = {a["label"]: a for a in P["answers"]}

# ------------------------------------------------------------------ answer typing (printed answers, PDF text layer)
SYM = {"−": "-", "◦": "°", "′": "'", "×": "x"}


def norm(t):
    for a, b in SYM.items():
        t = t.replace(a, b)
    return re.sub(r"\s+", " ", t).strip().rstrip(".").strip()


WORDS_OK = {"sin", "cos", "tan", "and", "or", "for", "if", "is", "cm", "mm", "km", "kg", "ml", "units", "unit",
            "feet", "years", "months", "days"}
UNIT = r"(?:°|%|cm2|cm3|cm²|cm³|m2|m3|mm|cm|km|m|L|ml|kg|g|s|h|units?|years?|months?|days?|people|learners|feet|ft)"


def answer_type(t):
    s = norm(t)
    s = re.sub(r"^=\s*", "", s)                 # "= 66": the working's last line printed as the answer
    s = s.replace("ˆ", "")                         # angle hats: "ˆc = 140°"
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
        # English words: a verbal answer ("rational", "mutually exclusive", "rhombus")
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
    "number_decimal_comma": "after_normalisation",   # D5: key stored with a point; a typed comma is marked wrong
    "number_with_unit": "after_normalisation",       # unit / currency stripped from the key
    "fraction_flattened": "after_normalisation",     # key stored as a decimal; a typed a/b is evaluated
    "var_equals_number": "after_normalisation",      # key = the number; a typed "x = 3" is marked wrong
    "text": "exact_text_only",                       # case-insensitive string equality; better as MCQ (D4b)
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

# ------------------------------------------------------------------ per-exercise inventory
def exercise_record(ex, fname):
    lab = ex["label"]
    pe = pex[lab]
    pa = pans.get(lab, {"leaves": [], "pdf_first": None, "pdf_last": None})
    leaves_by_q = collections.defaultdict(list)
    for l in pa["leaves"]:
        leaves_by_q[l["q"]].append(l)
    types = collections.Counter()
    grad = collections.Counter()
    no_ans_kinds = collections.Counter()
    items = 0
    matched = 0
    for q in ex["questions"]:
        n = len(q["entries"])
        L = leaves_by_q.get(q["q"], [])
        items += n
        for i, e in enumerate(q["entries"]):
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
    return {
        "label": lab,
        "end_of_chapter": pe["end_of_chapter"],
        "pdf_pages": [pe["pdf"], last_body], "printed_pages": [printed(pe["pdf"]), printed(last_body)],
        "epub": {"file": fname, "locator": f"{fname}::span.exerciseTitle[Exercise {lab.replace('-', '.')}]"},
        "questions": len(ex["questions"]),
        "items": items,
        "items_per_question": [len(q["entries"]) for q in ex["questions"]],
        "shortcodes": {s["label"]: s["code"] for s in sc},
        "printed_answers": {
            "appendix_pdf_pages": [pa["pdf_first"], pa["pdf_last"]],
            "appendix_printed_pages": [printed(pa["pdf_first"]), printed(pa["pdf_last"])] if pa["pdf_first"] else None,
            "leaves_parsed": len(pa["leaves"]),
            "items_with_printed_answer": matched,
            "items_without_printed_answer": items - matched,
            "no_answer_stem_verbs": dict(no_ans_kinds),
        },
        "epub_inline_worked_solutions": sum(1 for q in ex["questions"] for e in q["entries"] if e["has_solution"]),
        "answer_types": dict(types),
        "gradable_today": dict(grad),
        "figures": {"in_problems": sum(e["problem_figures"] for q in ex["questions"] for e in q["entries"])
                    + sum(q.get("header_figures", 0) for q in ex["questions"]),
                    "in_epub_solutions": sum(e["solution_figures"] for q in ex["questions"] for e in q["entries"])},
        "maths_images": {"problems": sum(e["problem_math"] for q in ex["questions"] for e in q["entries"]),
                         "solutions": sum(e["solution_math"] for q in ex["questions"] for e in q["entries"])},
    }


# ------------------------------------------------------------------ walk EPUB files into chapters / sections
chapters = collections.OrderedDict()
for f in efiles:
    ch = int(f["file"][:2])
    chapters.setdefault(ch, []).append(f)

# EPUB section number differs from PDF in chapter 2 (EPUB "2.5 Exponential equations" = PDF 2.4); map by code
pdf_by_code = {}
for s in secs:
    pdf_by_code.setdefault(s["code"], s)   # 2.5 "Summary" reuses 2.4's EMAW; keep 2.4 for the code


def pdf_section_for(ch, es, is_summary):
    if is_summary:
        return [s for s in secs if int(s["num"].split(".")[0]) == ch][-1]
    return pdf_by_code["EMA" + es["id"][5:]] if es.get("id") else None


modules = []
tables = {"lessons": [], "chapters": []}
flags_global = []
for ch, files in chapters.items():
    opener = openers[ch - 1]
    ch_end = (openers[ch] - 1) if ch < 14 else answers_start - 1
    while ch_end in no_folio:
        ch_end -= 1
    mod = {"id": f"module:g10m-c{ch:02d}", "chapter": ch, "title": chapter_titles[ch - 1], "order_in_parent": ch,
           "pdf_pages": [opener, ch_end], "printed_pages": [printed(opener), printed(ch_end)],
           "opener_pdf_page": opener, "epub_files": [f["file"] for f in files],
           "introduction": None, "lessons": [], "chapter_summary": None, "end_of_chapter_exercise": None}
    current = None  # the section record the next exercise-only file belongs to
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
            exs = [exercise_record(x, f["file"]) for x in f["exercises"]]
            figc = collections.Counter(x["context"] for x in f["figures"])
            rec = {
                "section": num, "title": ps["title"] if not is_summary else "Chapter summary",
                "code": ps["code"], "pdf_pages": sp["pdf"], "printed_pages": sp["printed"],
                "page_count": sp["page_count"], "starts_mid_page": sp["starts_mid_page"],
                "ends_mid_page": sp["ends_mid_page"],
                "epub": {"file": f["file"], "anchor": f"#{es['id']}" if es.get("id") else None,
                         "heading_id": es.get("heading_id"), "epub_section_number": es.get("num")},
                "subheadings": [{"title": s["title"], "code": s["id"][2:] if (s.get("id") or "").startswith("sc") else None}
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
                                    + (" (the same code as the section before it)" if sum(1 for x in secs if x["code"] == ps["code"]) > 1 else ""))
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
            # a file with no section heading: an exercise that belongs to the section before it
            for x in f["exercises"]:
                xr = exercise_record(x, f["file"])
                if xr["end_of_chapter"]:
                    xr["attach"] = ("chapter (module); every item is assigned to one lesson by S1's exercise map; "
                                    "the printed pages sit inside the Chapter summary section")
                    mod["end_of_chapter_exercise"] = xr
                else:
                    xr["note"] = "EPUB puts this exercise in its own file after the section's file"
                    current["exercises"].append(xr)
    modules.append(mod)

# ------------------------------------------------------------------ exercise-level anomaly flags
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

# ------------------------------------------------------------------ proposals (not applied)
# Curated from the EPUB's document order of sub-headings, worked examples and exercise titles (see report §3).
# Spec §3.3 split rule: > 12 printed pages, or > 3 separately exercised methods.
proposals = [
    {"id": "P1a", "kind": "split", "lesson": "g10m1s7-1", "section": "1.7", "rule": "5 separately exercised methods (> 3); 11 pages",
     "parts": [
         {"id": "g10m1s7-1", "subheadings": ["EMAH", "EMAJ", "EMAK"], "worked_examples": [10, 11, 12], "exercise_sets": ["1-5", "1-6", "1-7"], "items": 52},
         {"id": "g10m1s7-2", "subheadings": ["EMAM", "EMAN"], "worked_examples": [13], "exercise_sets": ["1-8"], "items": 26},
         {"id": "g10m1s7-3", "subheadings": ["EMAP"], "worked_examples": [14, 15, 16, 17], "exercise_sets": ["1-9"], "items": 27}]},
    {"id": "P1b", "kind": "split", "lesson": "g10m6s6-1", "section": "6.6", "rule": "21 pages",
     "parts": [
         {"id": "g10m6s6-1", "subheadings": ["EMA53", "EMA54", "EMA55", "EMA56"], "worked_examples": [16, 17], "exercise_sets": []},
         {"id": "g10m6s6-2", "subheadings": ["EMA57", "EMA58", "EMA59", "EMA5B", "EMA5C"], "worked_examples": [18, 19], "exercise_sets": []},
         {"id": "g10m6s6-3", "subheadings": ["EMA5D", "EMA5F", "EMA5G", "EMA5H"], "worked_examples": [20, 21], "exercise_sets": []}],
     "note": "one exercise set (6-6, 41 items) closes the whole section: S1's exercise map must distribute it"},
    {"id": "P1c", "kind": "split", "lesson": "g10m8s3-1", "section": "8.3", "rule": "16 pages",
     "parts": [
         {"id": "g10m8s3-1", "subheadings": [], "worked_examples": [3, 4], "exercise_sets": ["8-3"], "items": 9},
         {"id": "g10m8s3-2", "subheadings": ["EMA6C", "EMA6D", "EMA6F", "EMA6G"], "worked_examples": [5, 6, 7, 8, 9], "exercise_sets": ["8-4"], "items": 27}]},
    {"id": "P1d", "kind": "split", "lesson": "g10m13s2-1", "section": "13.2", "rule": "13 pages counting the shared last page (12 full pages): borderline",
     "parts": [
         {"id": "g10m13s2-1", "subheadings": ["EMA7N"], "worked_examples": [2, 3, 4], "exercise_sets": ["13-2"], "items": 8},
         {"id": "g10m13s2-2", "subheadings": ["EMA7P"], "worked_examples": [5, 6, 7], "exercise_sets": ["13-3"], "items": 6}]},
    {"id": "P1e", "kind": "split", "lesson": "g10m13s3-1", "section": "13.3", "rule": "20 pages",
     "parts": [
         {"id": "g10m13s3-1", "subheadings": ["EMA7R"], "worked_examples": [8, 9, 10, 11], "exercise_sets": ["13-4"], "items": 7},
         {"id": "g10m13s3-2", "subheadings": ["EMA7S"], "worked_examples": [12, 13, 14, 15, 16, 17], "exercise_sets": ["13-5"], "items": 11}]},
    {"id": "P2a", "kind": "promote_introduction", "lesson": "g10m6s1-1", "section": "6.1",
     "why": "teaches set, interval and function notation, domain and range (EMA42-EMA47) and carries Exercise 6-1 (36 items)"},
    {"id": "P2b", "kind": "promote_introduction", "lesson": "g10m7s1-1", "section": "7.1",
     "why": "teaches angles and parallel lines (EMA5N-EMA5Q), with Worked example 1 and Exercise 7-1 (19 items)"},
    {"id": "P3a", "kind": "merge", "lessons": ["g10m1s2-1", "g10m1s3-1"], "why": "1.2 has no worked example and no exercise item: under spec §3.4 rule 1 it cannot yield an objective on its own"},
    {"id": "P3b", "kind": "merge", "lessons": ["g10m5s2-1", "g10m5s3-1", "g10m5s4-1"], "why": "5.2 (3 pages) and 5.4 (1 page) have no worked example and no exercise item"},
    {"id": "P3c", "kind": "merge_optional", "lessons": ["g10m14s4-1", "g10m14s5-1"], "why": "2 + 2 in-section items, 4 pages together; end-of-chapter items will add to both"},
    {"id": "P3d", "kind": "merge_optional", "lessons": ["g10m14s6-1", "g10m14s7-1"], "why": "4 + 4 in-section items, 5 pages together"},
    {"id": "N1", "kind": "keep", "lesson": "g10m7s3-1", "section": "7.3",
     "why": "4 exercise sets (7-3..7-6) but 14 items, mostly proofs; below the spirit of the > 3 methods rule"},
]
lesson_count_if_all = (sum(len(m["lessons"]) for m in modules) + (2 + 2 + 1 + 1 + 1) + 2 - 1 - 2)
# ------------------------------------------------------------------ totals
def lessons_iter():
    for m in modules:
        for l in m["lessons"]:
            yield m, l


all_ex = []
for m in modules:
    for sec in [m["introduction"]] + m["lessons"] + [m["chapter_summary"]]:
        if sec:
            all_ex.extend(sec["exercises"])
    if m["end_of_chapter_exercise"]:
        all_ex.append(m["end_of_chapter_exercise"])
types_total = collections.Counter()
grad_total = collections.Counter()
noans_total = collections.Counter()
for x in all_ex:
    types_total.update(x["answer_types"])
    grad_total.update(x["gradable_today"])
    noans_total.update(x["printed_answers"]["no_answer_stem_verbs"])
fig_book = sum(r["epub_excl_solutions"] for r in C["figures_per_chapter"])
fig_pdf = sum(r["pdf_total"] for r in C["figures_per_chapter"])
totals = {
    "chapters": len(modules),
    "numbered_sections": len(secs),
    "lessons_default": sum(len(m["lessons"]) for m in modules),
    "introductions": sum(1 for m in modules if m["introduction"]),
    "chapter_summaries": sum(1 for m in modules if m["chapter_summary"]),
    "worked_examples": sum(len(sec["worked_examples"]) for m in modules
                           for sec in [m["introduction"]] + m["lessons"] + [m["chapter_summary"]] if sec),
    "exercise_sets": len(all_ex),
    "exercise_sets_in_lessons": sum(len(l["exercises"]) for _, l in lessons_iter()),
    "exercise_sets_in_introductions": sum(len(m["introduction"]["exercises"]) for m in modules if m["introduction"]),
    "exercise_sets_end_of_chapter": sum(1 for m in modules if m["end_of_chapter_exercise"]),
    "exercise_questions_numbered": sum(x["questions"] for x in all_ex),
    "exercise_items": sum(x["items"] for x in all_ex),
    "exercise_items_end_of_chapter": sum(m["end_of_chapter_exercise"]["items"] for m in modules if m["end_of_chapter_exercise"]),
    "exercise_shortcodes": sum(len(x["shortcodes"]) for x in all_ex),
    "printed_answer_leaves_parsed": sum(x["printed_answers"]["leaves_parsed"] for x in all_ex),
    "items_with_printed_answer": sum(x["printed_answers"]["items_with_printed_answer"] for x in all_ex),
    "items_without_printed_answer": sum(x["printed_answers"]["items_without_printed_answer"] for x in all_ex),
    "items_with_epub_worked_solution": sum(x["epub_inline_worked_solutions"] for x in all_ex),
    "figures_book_pdf": fig_pdf,
    "figures_book_epub": fig_book,
    "figures_epub_solutions_only": sum(r["epub_all"] - r["epub_excl_solutions"] for r in C["figures_per_chapter"]),
    "equation_images_refs": E["equation_refs"],
    "equation_images_unique": E["unique_equation_hashes"],
    "answer_types": dict(types_total.most_common()),
    "gradable_today": dict(grad_total.most_common()),
    "no_printed_answer_stem_verbs": dict(noans_total.most_common()),
    "past_exam_papers": {"papers": 2, "questions": 16, "mark_tagged_parts": 77, "answers_printed": False,
                         "in_epub": False},
}

manifest = {
    "manifest": "g10-math-american",
    "stage": "S0",
    "status": "DRAFT, awaiting gate G0 (Samuel): lesson unit (D2), split/merge/promotion proposals, offset regime, edition verdict",
    "generated": "2026-09-25",
    "generated_by": "services/extraction/scratch_g10/{scout_pdf,scout_epub,compare,build_manifest_draft}.py "
                    "(scouting code; B2/B3 are not built). No LLM was used.",
    "book": {
        "book": "g10-math",
        "title": "Everything Maths, Grade 10 Mathematics",
        "publisher": "Siyavula Education (with volunteers)",
        "edition": "Version 1.1 CAPS",
        "curriculum_printed": "South African CAPS (spec §10 D8: confirm this is the intended 'American' Grade 10 book)",
        "language": "en", "direction": "ltr",
        "course_id": "PLACEHOLDER: owned by specs/003-curriculum-tracks",
        "id_prefix": "g10m",
        "notation_as_printed": {"decimal": "comma (3,317)", "pairs": "(x; y)", "lists": "semicolon-separated",
                                "currency": "R (Rand)"},
        "sources": {
            "pdf": {"path": "docs/Source/Gr10_Mathematics_Learner_Eng_v11.pdf", "bytes": os.path.getsize(PDF_PATH),
                    "sha256": sha256(PDF_PATH), "pages": P["pages"],
                    "creation_date": "2015-06-11 (Acrobat 10.1.10)",
                    "role": "citation authority: printed page numbers, printed answers, figures (vector forms)"},
            "epub": {"path": "docs/Source/Gr10_Mathematics_Learner_Eng_CC-BY.epub",
                     "bytes": os.path.getsize(EPUB_PATH), "sha256": sha256(EPUB_PATH), "zip_entries": 10247,
                     "dcterms_modified": "2015-09-15T13:22:49Z",
                     "role": "structure and prose; per-item worked solutions; maths only as images (see report)"},
        },
        "edition_check": {
            "verdict": "same_content_different_packaging",
            "summary": ("Same v1.1 CAPS text: 81/81 section titles in order (chapter titles 12/14: 'Exponents'/"
                        "'Exponentials', 'Measurements'/'Measurement'), 172/172 section codes, 78/78 video "
                        "and presentation codes, 174/174 worked examples, 87/87 exercise sets with 86/87 equal "
                        "question counts and equal item structure, 761/764 figure placements, sampled prose, "
                        "exercise stems and worked-example questions word-identical. The EPUB adds a worked "
                        "solution to every exercise item and drops the answer appendix, past papers, shortcodes "
                        "and page numbers; chapter 2 numbering differs."),
            "details": "regenerate with scratch_g10/compare.py (edition-check.json is scratch output, not committed)",
        },
    },
    "page_map": {
        "rule": "printed = pdf - 11",
        "regimes": [{"pdf_from": 13, "pdf_to": 532, "printed_from": 2, "printed_to": 521, "pdf_minus_printed": 11, "verified_at": "every page with a folio (497)"}],
        "verification": {
            "method": "printed folio read from every page's footer text (PyMuPDF), not from anchors",
            "pages_with_folio": sum(1 for p in P["page_map"] if p["printed"] is not None),
            "folios_consistent_with_rule": sum(1 for p in P["page_map"] if p["printed"] is not None
                                               and p["pdf"] - p["printed"] == OFFSET),
            "exceptions": [],
            "pages_without_folio": {
                "front_matter": [p for p in no_folio if p <= 12],
                "blank_pages": [15, 53, 83, 117, 245, 339, 365, 413, 479],
                "chapter_openers": openers,
                "back_matter": [533, 534, 535],
            },
            "anchors": [
                {"pdf": 17, "printed": 6, "content": "1.1 Introduction (EMA2)"},
                {"pdf": 247, "printed": 236, "content": "7.1 Introduction (EMA5M)"},
                {"pdf": 304, "printed": 293, "content": "8.3 Gradient of a line (EMA6B)"},
                {"pdf": 511, "printed": 500, "content": "Solutions, Exercise 2 – 4 area"},
                {"pdf": 526, "printed": 515, "content": "Past exam papers, Paper 1"},
            ],
            "outline_note": "PDF bookmarks for 'Solutions to exercises' (507) and 'Past exam papers' (525) point one "
                            "page early; the chapter and section bookmarks are correct",
        },
    },
    "id_scheme": {
        "lesson": "g10m<ch>s<sec>-<part>  (part 1 until G0 approves a split)",
        "lo": "lo:g10m<ch>s<sec>-<part>-<n>  (S1; not derived here)",
        "module": "module:g10m-c<NN>",
        "question": "q:<lo tail>:we<NN> | q:<lo tail>:ex<C>-<N>-<q><sub>",
        "slug_check": "every lesson id matches SLUG_RE ^[a-z0-9]{1,12}-[0-9]{1,3}$ (app/src/lib/lesson-slug.ts)",
    },
    "answer_type_legend": {
        "source": "printed answer in the Solutions appendix (PDF text layer), heuristic classifier in build_manifest_draft.py",
        "gradable_today": "against app/src/app/api/attempts/route.ts grade(): numeric = parseFloat with a decimal "
                          "point, or a whitelisted arithmetic expression; anything else = case-insensitive exact string",
        "mapping": GRADABLE,
    },
    "lesson_unit": {
        "default_applied": "one numbered teaching section = one lesson (spec §3.3, D2 option a)",
        "not_lessons": "x.1 Introduction (8) and Chapter summary (14): S1 evidence; the end-of-chapter exercise "
                       "attaches to the chapter and S1 maps its items to lessons",
        "page_convention": "a lesson runs from its heading page to the page before the next heading, or to the "
                           "next heading's page when that heading sits below the top of the page (the page is then "
                           "shared, flagged starts_mid_page / ends_mid_page and counted in both lessons)",
        "proposals_not_applied": proposals,
        "lesson_count_if_all_proposals_accepted": lesson_count_if_all,
    },
    "modules": modules,
    "back_matter": {
        "solutions_appendix": {"pdf_pages": [answers_start, past_start - 1],
                               "printed_pages": [printed(answers_start), printed(past_start - 1)],
                               "content": "final answers only, per exercise, for 87 exercise sets"},
        "past_exam_papers": {"pdf_pages": [past_start, 532], "printed_pages": [printed(past_start), 521],
                             "papers": [{"title": "Mathematics, Paper 1, Exemplar 2012", "questions": 7, "marks": 100},
                                        {"title": "Mathematics, Paper 2, Exemplar 2012", "questions": 9, "marks": 100}],
                             "answers_printed": False, "in_epub": False,
                             "note": "labelled 'Exercise 1 – 1' and 'Exercise 2 – 1', colliding with chapter 1 and 2 labels"},
        "list_of_definitions": {"pdf_page": 533, "printed_page": 522},
        "image_attribution": {"pdf_page": 534, "printed_page": 523},
    },
    "totals": totals,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(manifest, open(OUT, "w"), ensure_ascii=False, indent=1)

# report tables
for m in modules:
    ls = m["lessons"]
    exs = [x for l in ls for x in l["exercises"]]
    tables["chapters"].append({
        "chapter": m["chapter"], "title": m["title"], "printed": m["printed_pages"], "lessons": len(ls),
        "worked_examples": sum(len(l["worked_examples"]) for l in ls)
        + (len(m["introduction"]["worked_examples"]) if m["introduction"] else 0),
        "exercise_sets": len(exs) + (len(m["introduction"]["exercises"]) if m["introduction"] else 0)
        + (1 if m["end_of_chapter_exercise"] else 0),
        "items": sum(x["items"] for x in exs) + (sum(x["items"] for x in m["introduction"]["exercises"]) if m["introduction"] else 0)
        + (m["end_of_chapter_exercise"]["items"] if m["end_of_chapter_exercise"] else 0),
        "eoc_items": m["end_of_chapter_exercise"]["items"] if m["end_of_chapter_exercise"] else 0,
        "figures": sum(l["figures"]["book"] for l in ls),
    })
    for l in ls:
        tables["lessons"].append({"id": l["id"], "section": l["section"], "title": l["title"],
                                  "printed": l["printed_pages"], "pages": l["page_count"],
                                  "we": len(l["worked_examples"]), "sets": [x["label"] for x in l["exercises"]],
                                  "items": sum(x["items"] for x in l["exercises"]), "figures": l["figures"]["book"],
                                  "flags": l["flags"]})
json.dump({"tables": tables, "totals": totals, "proposals": proposals}, open(f"{SCAN}/manifest_tables.json", "w"),
          ensure_ascii=False, indent=1)
print(json.dumps(totals, ensure_ascii=False, indent=1))

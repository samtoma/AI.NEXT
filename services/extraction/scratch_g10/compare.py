"""S0a scouting: the EPUB-vs-PDF edition check. Read-only, deterministic (fixed seed).

Reads pdf_scan.json and epub_scan.json (from scout_pdf.py / scout_epub.py) plus the PDF itself for page
text, and writes <out>/edition-check.json. Every check reports what it compared and what differed.

Usage:  python3 compare.py <pdf> <out_dir>
"""
import collections
import difflib
import hashlib
import json
import random
import re
import sys

import fitz

PDF, OUT = sys.argv[1], sys.argv[2]
P = json.load(open(f"{OUT}/pdf_scan.json"))
E = json.load(open(f"{OUT}/epub_scan.json"))
doc = fitz.open(PDF)
SEED = 20260925


def md5(s):
    return hashlib.md5(s.encode()).hexdigest()


def words(s):
    s = re.sub(r"⟦[^⟧]*⟧", " ", s)
    s = s.replace("-\n", "")
    return [w.lower() for w in re.findall(r"[A-Za-z]{2,}", s)]


def norm_title(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


pdf_text = {i + 1: doc[i].get_text() for i in range(doc.page_count)}
pm = {p["pdf"]: p["printed"] for p in P["page_map"]}

efiles = [f for f in E["files"] if f["file"].endswith(".cnxmlplus.html")]
chap_of = lambda fname: int(fname[:2])

# ------------------------------------------------------------------ 1 TOC
esecs = [(chap_of(f["file"]), s, f["file"]) for f in efiles for s in f["sections"]]
psecs = P["sections"]
toc = []
for i in range(max(len(esecs), len(psecs))):
    ps = psecs[i] if i < len(psecs) else None
    ec, es, ef = esecs[i] if i < len(esecs) else (None, None, None)
    toc.append({
        "pdf_num": ps and ps["num"], "pdf_title": ps and ps["title"], "pdf_code": ps and ps["code"],
        "epub_num": es and es.get("num"), "epub_title": es and es["title"],
        "epub_id": es and es["id"], "epub_file": ef,
        "title_match": bool(ps and es and norm_title(ps["title"]).replace("chaptersummary", "summary")
                            == norm_title(es["title"]).replace("chaptersummary", "summary")),
        "num_match": bool(ps and es and ps["num"] == es.get("num")),
        "code_match": bool(ps and es and es["id"] == "sc" + ps["code"]),
    })

# ------------------------------------------------------------------ 2 section codes
pdf_codes = {s["code"] for s in P["sections"]} | {s["code"] for s in P["subheadings"]}
epub_codes = {s["id"][2:] for f in efiles for s in f["sections"] + f["subheadings"]
              if s.get("id") and s["id"].startswith("scEMA")}
# ------------------------------------------------------------------ 3 media shortcodes
pdf_media = {m["code"] for m in P["media"]}
epub_media = {v["id"][2:] for f in efiles for v in f["videos"] if v.get("id")}

# ------------------------------------------------------------------ 4 worked examples
pwe = collections.defaultdict(list)
# chapter of a PDF WE = chapter of the most recent numbered section before it
sec_starts = [(s["pdf"], int(s["num"].split(".")[0])) for s in P["sections"]]


def chapter_at(pdfp):
    c = None
    for p, ch in sec_starts:
        if p <= pdfp:
            c = ch
    return c


for w in P["worked_examples"]:
    pwe[chapter_at(w["pdf"])].append(w)
ewe = collections.defaultdict(list)
for f in efiles:
    for w in f["worked_examples"]:
        ewe[chap_of(f["file"])].append(w)
we_rows, we_title_diffs = [], []
for ch in range(1, 15):
    a, b = pwe[ch], ewe[ch]
    we_rows.append({"chapter": ch, "pdf": len(a), "epub": len(b),
                    "pdf_numbers": [w["n"] for w in a] == list(range(1, len(a) + 1)),
                    "epub_numbers": [w["n"] for w in b] == list(range(1, len(b) + 1))})
    for x, y in zip(a, b):
        if norm_title(x["title"]) != norm_title(y["title"]):
            r = difflib.SequenceMatcher(None, norm_title(x["title"]), norm_title(y["title"])).ratio()
            we_title_diffs.append({"chapter": ch, "n": x["n"], "pdf": x["title"], "epub": y["title"],
                                   "similarity": round(r, 2)})

# ------------------------------------------------------------------ 5 exercises
pex = {e["label"]: e for e in P["exercises"] if e["where"] == "body"}
pans = {a["label"]: a for a in P["answers"]}
ex_rows = []
for f in efiles:
    for ex in f["exercises"]:
        lab = ex["label"]
        sc = pex[lab]["shortcodes"] if lab in pex else []
        sq = collections.Counter(int(re.match(r"\d+", s["label"]).group()) for s in sc)
        el = [len(q["entries"]) for q in ex["questions"]]
        ac = collections.Counter(l["q"] for l in pans[lab]["leaves"]) if lab in pans else collections.Counter()
        ex_rows.append({
            "label": lab, "epub_file": f["file"], "pdf_page": pex[lab]["pdf"] if lab in pex else None,
            "end_of_chapter": pex[lab]["end_of_chapter"] if lab in pex else None,
            "epub_questions": len(el), "pdf_questions": len(sq), "pdf_max_q": max(sq) if sq else 0,
            "epub_entries": sum(el), "pdf_shortcodes": len(sc),
            "pdf_answer_leaves": sum(ac.values()),
            "questions_match": len(el) == len(sq) == (max(sq) if sq else 0),
            "entries_per_q_epub": el, "answer_leaves_per_q_pdf": [ac.get(i, 0) for i in range(1, len(el) + 1)],
            "shortcodes_per_q_pdf": [sq.get(i, 0) for i in range(1, len(el) + 1)],
        })

# ------------------------------------------------------------------ 6 figures per chapter
# chapters run from their opener page (the level-2 bookmarks; chapter bookmarks are accurate, only the
# back-matter ones are a page early) to the page before the next opener
chap_pdf_span = {}
openers = [o["pdf"] for o in P["outline"] if o["level"] == 2][:14]
for ch in range(1, 15):
    start = openers[ch - 1]
    end = (openers[ch] - 1) if ch < 14 else P["answers_start_pdf"] - 1
    chap_pdf_span[ch] = (start, end)
pfig = collections.Counter()
for fg in P["figures"]:
    for ch, (a, b) in chap_pdf_span.items():
        if a <= fg["pdf"] <= b:
            pfig[ch] += 1
praster = collections.Counter()
for r in P["rasters"]:
    for ch, (a, b) in chap_pdf_span.items():
        if a <= r["pdf"] <= b:
            praster[ch] += 1
efig = collections.Counter()
efig_all = collections.Counter()
for f in efiles:
    ch = chap_of(f["file"])
    for x in f["figures"]:
        efig_all[ch] += 1
        if x["context"] != "exercise_solution":
            efig[ch] += 1
fig_rows = [{"chapter": ch, "pdf_vector_forms": pfig[ch], "pdf_rasters": praster[ch],
             "pdf_total": pfig[ch] + praster[ch], "epub_excl_solutions": efig[ch], "epub_all": efig_all[ch]}
            for ch in range(1, 15)]

# ------------------------------------------------------------------ 7 paragraph sample
rng = random.Random(SEED)
paras = [(f["file"], p) for f in efiles for p in f["text_paras"]]
sample = rng.sample(paras, 10)
full_words = []
page_of_word = []
for p in range(17, P["answers_start_pdf"]):
    ws = words(pdf_text[p])
    full_words.extend(ws)
    page_of_word.extend([p] * len(ws))
para_rows = []
for fname, text in sample:
    ew = words(text)
    a, b = chap_pdf_span[chap_of(fname)]
    cw, cp = [], []
    for p in range(a, b + 1):
        ws = words(pdf_text[p])
        cw.extend(ws)
        cp.extend([p] * len(ws))
    best = (0.0, None)
    anchors = set()
    for k in range(0, max(1, len(ew) - 3)):
        g = " ".join(ew[k:k + 4])
        anchors.update(max(0, i - k) for i in range(len(cw) - 3) if " ".join(cw[i:i + 4]) == g)
        if len(anchors) > 40:
            break
    for c in sorted(anchors):
        win = cw[c:c + len(ew)]
        r = difflib.SequenceMatcher(None, ew, win, autojunk=False).ratio()
        if r > best[0]:
            best = (r, c)
    para_rows.append({"epub_file": fname, "epub_excerpt": text[:90], "words": len(ew),
                      "similarity": round(best[0], 3),
                      "pdf_page": cp[best[1]] if best[1] is not None else None,
                      "printed_page": pm.get(cp[best[1]]) if best[1] is not None else None})

# ------------------------------------------------------------------ 8 exercise-item sample (problem words)
entries = [(f["file"], ex["label"], q["q"], i, e) for f in efiles for ex in f["exercises"]
           for q in ex["questions"] for i, e in enumerate(q["entries"])]
wordy = [x for x in entries if len(words(x[4]["problem_text"])) >= 8]
item_rows = []
for fname, lab, qn, i, e in rng.sample(wordy, 10):
    ew = words(e["problem_text"])
    pe = pex[lab]
    # the exercise runs from its heading page to the page of its shortcode list
    last = max([s["pdf"] for s in pe["shortcodes"]] or [pe["pdf"]])
    pw = []
    for p in range(pe["pdf"], last + 1):
        pw.extend(words(pdf_text[p]))
    sm = difflib.SequenceMatcher(None, ew, pw, autojunk=False)
    matched = sum(b.size for b in sm.get_matching_blocks())
    item_rows.append({"exercise": lab, "q": qn, "part": i + 1, "epub_excerpt": e["problem_text"][:90],
                      "words": len(ew), "words_found_in_order": matched,
                      "share": round(matched / len(ew), 3)})

# ------------------------------------------------------------------ 9 answers: PDF printed answer vs EPUB solution
# A numeric printed answer "12,566" should appear in the EPUB's worked solution of the same item as the
# equation image md5("\text{12,566}").png. Only plain numbers are testable this way.
RE_NUM = re.compile(r"^−?\d{1,3}(?: \d{3})*(?:,\d+)?$")
num_tests = []
for f in efiles:
    for ex in f["exercises"]:
        lab = ex["label"]
        if lab not in pans:
            continue
        for q in ex["questions"]:
            sol_hashes = {h for e in q["entries"] for h in e["solution_hashes"]}
            for leaf in pans[lab]["leaves"]:
                if leaf["q"] != q["q"]:
                    continue
                t = leaf["text"].strip().rstrip(".")
                if not RE_NUM.match(t):
                    continue
                cands = {"\\text{" + t.replace("−", "-") + "}", "-\\text{" + t.lstrip("−") + "}", t}
                hit = any(md5(c) in sol_hashes for c in cands)
                num_tests.append({"exercise": lab, "q": leaf["q"], "sub": leaf["sub"], "answer": t, "found": hit})
num_found = sum(1 for x in num_tests if x["found"])

# ------------------------------------------------------------------ 9b answers: verbal printed answers vs EPUB solution words
# Where a question's printed answer leaves and EPUB items pair one-to-one, a verbal answer ("irrational",
# "mutually exclusive", "rhombus") should appear word for word in the EPUB's worked solution of that item.
word_tests = []
for f in efiles:
    for ex in f["exercises"]:
        lab = ex["label"]
        if lab not in pans:
            continue
        byq = collections.defaultdict(list)
        for leaf in pans[lab]["leaves"]:
            byq[leaf["q"]].append(leaf)
        for q in ex["questions"]:
            L = byq.get(q["q"], [])
            if len(L) != len(q["entries"]):
                continue
            for leaf, e in zip(L, q["entries"]):
                t = leaf["text"]
                if re.search(r"[0-9=√π<>≤≥;()]", t):
                    continue
                aw = [w.lower() for w in re.findall(r"[A-Za-z]{4,}", t)]
                if not aw:
                    continue
                sw = set(words(e["solution_text"]))
                word_tests.append({"exercise": lab, "q": q["q"], "answer": t[:60],
                                   "found": all(w in sw for w in aw)})
word_found = sum(1 for x in word_tests if x["found"])

# ------------------------------------------------------------------ 10 worked-example question sample
we_rows_sample = []
pairs = []
for ch in range(1, 15):
    for x, y in zip(pwe[ch], ewe[ch]):
        pairs.append((ch, x, y))
for ch, x, y in rng.sample(pairs, 10):
    ew = words(y["question_text"])
    pw = []
    for p in range(x["pdf"], x["pdf"] + 2):
        pw.extend(words(pdf_text.get(p, "")))
    sm = difflib.SequenceMatcher(None, ew, pw, autojunk=False)
    matched = sum(b.size for b in sm.get_matching_blocks())
    we_rows_sample.append({"chapter": ch, "n": x["n"], "title": y["title"], "words": len(ew),
                           "words_found_in_order": matched, "share": round(matched / max(1, len(ew)), 3)})

out = {
    "seed": SEED,
    "markers": {
        "pdf": {"cover": "VERSION 1.1 CAPS / EVERYTHING MATHS BY / GRADE 10 MATHEMATICS",
                "half_title_pdf2": "EVERYTHING MATHS GRADE 10 MATHEMATICS TEACHER'S GUIDE VERSION 1.1 CAPS",
                "outline_parts": [o["title"] for o in P["outline"] if o["level"] == 1],
                "licence_page_pdf3": "CC BY-ND 4.0", "creation_date": P["metadata"].get("creationDate"),
                "producer": P["metadata"].get("producer"), "pages": P["pages"]},
        "epub": {"dc_identifier": "www.siyavula.com.epubmaker.maths10", "dc_title": "maths10",
                 "dcterms_modified": "2015-09-15T13:22:49Z", "cover_image_text": "MATHEMATICS GRADE 10 Learner's book (CC BY icons)",
                 "copyright_page_title": "Physical Sciences 10 / Physical Sciences - Grade 10 CAPS",
                 "licence_page": "CC-BY 4.0", "version_string": None,
                 "equation_png_rendered": "2015-09-07 (PNG tEXt date:create)",
                 "html_zip_mtime": "2015-10-15"},
    },
    "toc": toc,
    "toc_summary": {"pdf_sections": len(psecs), "epub_sections": len(esecs),
                    "title_mismatch": [t for t in toc if not t["title_match"]],
                    "num_mismatch": [t for t in toc if not t["num_match"]],
                    "code_mismatch": [t for t in toc if not t["code_match"]]},
    "section_codes": {"pdf": len(pdf_codes), "epub": len(epub_codes),
                      "only_pdf": sorted(pdf_codes - epub_codes), "only_epub": sorted(epub_codes - pdf_codes)},
    "media_codes": {"pdf": len(pdf_media), "epub": len(epub_media),
                    "only_pdf": sorted(pdf_media - epub_media), "only_epub": sorted(epub_media - pdf_media)},
    "worked_examples": {"per_chapter": we_rows, "pdf_total": sum(r["pdf"] for r in we_rows),
                        "epub_total": sum(r["epub"] for r in we_rows), "title_diffs": we_title_diffs},
    "exercises": {"rows": ex_rows,
                  "labels_equal": sorted(pex) == sorted(r["label"] for r in ex_rows),
                  "questions_match": sum(1 for r in ex_rows if r["questions_match"]),
                  "totals": {k: sum(r[k] for r in ex_rows) for k in
                             ("epub_questions", "pdf_questions", "epub_entries", "pdf_shortcodes", "pdf_answer_leaves")}},
    "figures_per_chapter": fig_rows,
    "paragraph_sample": para_rows,
    "exercise_item_sample": item_rows,
    "worked_example_question_sample": we_rows_sample,
    "verbal_answer_word_check": {"tested": len(word_tests), "found_in_epub_solution": word_found,
                                 "not_found": [x for x in word_tests if not x["found"]]},
    "numeric_answer_hash_check": {"tested": len(num_tests), "found_in_epub_solution": num_found,
                                  "not_found": [x for x in num_tests if not x["found"]][:60]},
}
json.dump(out, open(f"{OUT}/edition-check.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: out[k] for k in ("toc_summary",)}, ensure_ascii=False)[:3000])
print("codes", out["section_codes"])
print("media", out["media_codes"])
print("WE", out["worked_examples"]["pdf_total"], out["worked_examples"]["epub_total"], len(we_title_diffs))
print("EX", out["exercises"]["labels_equal"], out["exercises"]["questions_match"], out["exercises"]["totals"])
print("FIG", fig_rows)
print("PARA", [r["similarity"] for r in para_rows])
print("ITEM", [r["share"] for r in item_rows])
print("WEQ", [r["share"] for r in we_rows_sample])
print("NUM", len(num_tests), num_found)
print("WORDS", len(word_tests), word_found, [x for x in word_tests if not x["found"]][:12])

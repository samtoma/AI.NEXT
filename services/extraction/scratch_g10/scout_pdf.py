"""S0a scouting, PDF side (Everything Maths Grade 10 v1.1). Read-only, deterministic.

Scratch code, not the B2 adapter. Uses PyMuPDF (fitz) from the user site-packages and nothing else.

Writes <out>/pdf_scan.json with:
  page_map        every PDF page -> printed number read from its own footer (or null), plus the running head
  outline         the PDF's bookmark tree (chapter / section -> PDF page)
  sections        numbered section headings found in the body text, with section code (EMA..)
  subheadings     section-coded sub-headings (text + EMA code)
  worked_examples "Worked example N: title" with page
  exercises       "Exercise C – N:" labels (body + appendix), end-of-chapter flag, shortcode list per exercise
  answers         the "Solutions to exercises" appendix, parsed into per-exercise answer leaves (label + text)
  figures         Form XObjects per page (externalised TikZ figures), with icon xrefs filtered out
  codes           every shortcode-like token seen on each page (section codes, video / presentation codes)

Usage:  python3 scout_pdf.py <pdf> <out_dir>
"""
import collections
import json
import re
import sys

import fitz

PDF, OUT = sys.argv[1], sys.argv[2]
doc = fitz.open(PDF)
H = doc[0].rect.height

DASH = "–"  # en dash used in "Exercise 1 – 1"
RE_SECTION = re.compile(r"^(\d{1,2})\.(\d{1,2})\s+(.+?)\s+(EMA[0-9A-Z]{1,3})$")
RE_CODE_TAIL = re.compile(r"^(.+?)\s+(EMA[0-9A-Z]{1,3})$")
RE_WE = re.compile(r"^Worked example (\d+): (.+)$")
RE_EX = re.compile(r"^(End of chapter )?Exercise (\d+) " + DASH + r" (\d+):")
RE_SHORT = re.compile(r"(?<![0-9A-Za-z])(\d{1,2}[a-z]?(?:\.[ivx]+|\([ivx]+\))?)\.\s+([0-9][0-9A-Z]{3})(?![0-9A-Za-z])")
RE_MEDIA = re.compile(r"See (video|presentation|simulation): ([0-9][0-9A-Z]{3})")


def page_lines(i):
    """Text lines of page i (0-based) in reading order, from PyMuPDF blocks."""
    out = []
    for b in doc[i].get_text("blocks"):
        if b[6] != 0:
            continue
        for ln in b[4].split("\n"):
            ln = re.sub(r"\s+", " ", ln).strip()
            if ln:
                out.append((ln, b[1]))
    return out


# ---------------------------------------------------------------- page map
page_map = []
for i in range(doc.page_count):
    blocks = [b for b in doc[i].get_text("blocks") if b[1] > H * 0.92 and b[6] == 0]
    printed, head = None, None
    for b in sorted(blocks, key=lambda b: -b[1]):
        t = re.sub(r"\s+", " ", b[4]).strip()
        m = re.fullmatch(r"(\d{1,3}) (.+)", t) or re.fullmatch(r"(.+?) (\d{1,3})", t)
        if m:
            num, rest = (m.group(1), m.group(2)) if m.group(1).isdigit() else (m.group(2), m.group(1))
            if rest.startswith("Chapter") or rest in ("Solutions", "Past exam papers", "Contents") \
                    or re.match(r"^\d+\.\d+\. ", rest):
                printed, head = int(num), rest
                break
        if re.fullmatch(r"\d{1,3}", t):  # a bare folio with no running head (chapter-opener spill page)
            printed, head = int(t), None
            break
    page_map.append({"pdf": i + 1, "printed": printed, "running_head": head})

# ---------------------------------------------------------------- outline
outline = [{"level": l, "title": t, "pdf": p} for l, t, p in doc.get_toc()]

# ---------------------------------------------------------------- body scan
sections, subheads, wes, exercises, codes = [], [], [], [], collections.defaultdict(list)
media = []
# The bookmarks for the back matter point one page early (see report), so use the running heads.
answers_start = next(p["pdf"] for p in page_map if p["running_head"] == "Solutions")
past_start = next(p["pdf"] for p in page_map if p["running_head"] == "Past exam papers")

cur_ex = None
for i in range(doc.page_count):
    pdfp = i + 1
    lines = page_lines(i)
    text = "\n".join(l for l, _ in lines)
    for m in RE_MEDIA.finditer(text):
        media.append({"kind": m.group(1), "code": m.group(2), "pdf": pdfp})
    # headings are one block each: "1.4\nRounding off\nEMA8" or "Converting ...\nEMA6"
    if pdfp < answers_start:
        for b in doc[i].get_text("blocks"):
            if b[6] != 0:
                continue
            parts = [re.sub(r"\s+", " ", p).strip() for p in b[4].split("\n") if p.strip()]
            if len(parts) < 2 or not re.fullmatch(r"EMA[0-9A-Z]{1,3}", parts[-1]):
                continue
            code = parts[-1]
            codes[pdfp].append(code)
            if re.fullmatch(r"\d{1,2}\.\d{1,2}", parts[0]):
                sections.append({"num": parts[0], "title": " ".join(parts[1:-1]), "code": code, "pdf": pdfp,
                                 "y": round(b[1])})
            else:
                subheads.append({"title": " ".join(parts[:-1]), "code": code, "pdf": pdfp, "y": round(b[1])})
    for ln, y in lines:
        m = RE_WE.match(ln)
        if m and pdfp < answers_start:
            wes.append({"n": int(m.group(1)), "title": m.group(2), "pdf": pdfp})
            continue
        m = RE_EX.match(ln)
        if m:
            where = "body" if pdfp < answers_start else ("answers" if pdfp < past_start else "past")
            cur_ex = {"label": f"{m.group(2)}-{m.group(3)}", "end_of_chapter": bool(m.group(1)),
                      "pdf": pdfp, "where": where, "shortcodes": []}
            exercises.append(cur_ex)
            continue
        # shortcode lists close every exercise ("For more exercises, visit ..."); in reading order the
        # list belongs to the most recent exercise heading, which may be on an earlier page
        if pdfp < answers_start and cur_ex is not None and cur_ex["where"] == "body":
            for m in RE_SHORT.finditer(ln):
                cur_ex["shortcodes"].append({"label": m.group(1), "code": m.group(2), "pdf": pdfp})

# ---------------------------------------------------------------- answers appendix
# Line-level parse with sequence constraints: a question label "N." is accepted only when N follows the
# previous question (questions with no printed answer leave gaps), a sub label "x)" only when
# it is the next letter in the current question (gaps of up to 15 questions allowed). Anything else is continuation text of the current leaf.
LETTERS = "abcdefghijklmnopqrstuvwxyz"
answers = []
cur = None
for i in range(answers_start - 1, past_start - 1):
    pdfp = i + 1
    for b in doc[i].get_text("blocks"):
        if b[6] != 0 or b[1] < H * 0.035:
            continue
        t = b[4].strip()
        if b[1] > H * 0.95 and re.fullmatch(r"\d{1,3}\s+(Solutions|Past exam papers)", re.sub(r"\s+", " ", t)):
            continue  # footer
        if re.fullmatch(r"\d{1,2}\n[A-Z][A-Za-z ]+", t) or t == "Solutions to exercises":
            continue  # chapter heading inside the appendix
        m = re.match(r"^(?:End of chapter )?Exercise (\d+) " + DASH + r" (\d+):", t)
        if m:
            cur = {"label": f"{m.group(1)}-{m.group(2)}", "pdf_first": pdfp, "pdf_last": pdfp, "leaves": []}
            body_ex = next((e for e in exercises if e["where"] == "body" and e["label"] == cur["label"]), None)
            # the exercise's own shortcode list bounds its question numbers (guards against "6." in answer text)
            cur["max_q"] = max((int(re.match(r"\d+", sc["label"]).group()) for sc in body_ex["shortcodes"]),
                               default=99) if body_ex else 99
            answers.append(cur)
            continue
        if cur is None:
            continue
        cur["pdf_last"] = pdfp
        for line in t.split("\n"):
            line = line.strip()
            if not line:
                continue
            while line:
                qn = cur["leaves"][-1]["q"] if cur["leaves"] else 0
                sub = cur["leaves"][-1]["sub"] if cur["leaves"] else None
                mq = re.match(r"^(\d{1,2})\.(?!\d)\s*(.*)$", line)
                if mq and 1 <= int(mq.group(1)) - qn <= 15 and int(mq.group(1)) <= cur["max_q"]:
                    cur["leaves"].append({"q": int(mq.group(1)), "sub": None, "text": "", "pdf": pdfp})
                    line = mq.group(2).strip()
                    continue
                ms = re.match(r"^([a-z])\)\s*(.*)$", line)
                if ms and cur["leaves"]:
                    # the next letter, or up to two letters further on (a sub-part with no printed answer)
                    lo = 0 if sub is None else LETTERS.index(sub) + 1
                    prev = cur["leaves"][-1]["text"]
                    unfinished = prev.count("(") > prev.count(")") or re.search(r"[+\-−×=(]$", prev)
                    if ms.group(1) in LETTERS[lo:lo + 3] and not unfinished:
                        last = cur["leaves"][-1]
                        if last["sub"] is None and not last["text"]:
                            last["sub"] = ms.group(1)
                        else:
                            cur["leaves"].append({"q": qn, "sub": ms.group(1), "text": "", "pdf": pdfp})
                        line = ms.group(2).strip()
                        continue
                # continuation text; split off a later label on the same line ("7. 30°  8. 45°" etc.)
                mm = re.search(r"\s(\d{1,2})\.\s|\s([a-z])\)\s", " " + line + " ")
                if mm and mm.start() > 0:
                    head, line = (" " + line)[:mm.start()].strip(), (" " + line)[mm.start():].strip()
                else:
                    head, line = line, ""
                if cur["leaves"]:
                    cur["leaves"][-1]["text"] = (cur["leaves"][-1]["text"] + " " + head).strip()
                if head == "" and line:  # avoid an endless loop on an unaccepted label
                    cur["leaves"][-1]["text"] = (cur["leaves"][-1]["text"] + " " + line).strip() if cur["leaves"] else ""
                    line = ""

# ---------------------------------------------------------------- figures (Form XObjects)
occ = collections.Counter()
where = collections.defaultdict(list)
bbox = {}
for i in range(doc.page_count):
    for xref, name, invoker, bb in doc[i].get_xobjects():
        if invoker == 0:
            occ[xref] += 1
            where[xref].append(i + 1)
            bbox[xref] = [round(v) for v in bb]
# icons: the same xref placed on many pages (exercise box, visit icon, chapter badge, calculator keys)
icons = {x for x, n in occ.items() if n >= 6}
figures = []
for x in occ:
    if x in icons:
        continue
    for p in where[x]:
        figures.append({"xref": x, "pdf": p, "bbox": bbox[x]})
figures.sort(key=lambda f: (f["pdf"], f["xref"]))
rasters = []
for i in range(doc.page_count):
    for im in doc[i].get_images(full=True):
        rasters.append({"pdf": i + 1, "xref": im[0], "w": im[2], "h": im[3]})

json.dump({
    "pdf": PDF, "pages": doc.page_count, "metadata": doc.metadata,
    "page_map": page_map, "outline": outline, "sections": sections, "subheadings": subheads,
    "worked_examples": wes, "exercises": exercises, "answers": answers, "media": media,
    "figures": figures, "icon_xrefs": sorted(icons), "icon_counts": {str(x): occ[x] for x in sorted(icons)},
    "rasters": rasters, "codes": codes,
    "answers_start_pdf": answers_start, "past_papers_start_pdf": past_start,
}, open(f"{OUT}/pdf_scan.json", "w"), ensure_ascii=False, indent=1)
print("pages", doc.page_count, "sections", len(sections), "subheads", len(subheads), "WE", len(wes),
      "exercises", len(exercises), "answer blocks", len(answers), "figures", len(figures), "icons", len(icons))

"""S0a source adapter (docs/specs/extraction-pipeline.md §3.3, build item B2). Deterministic, no model.

    uv run --with pymupdf source_adapter.py g10-math           # everything, in one go
    uv run source_adapter.py g10-math                          # same, reusing work/<book>/pdf_scan.json
    python3 source_adapter.py pdf-scan <pdf> <out.json>        # the PDF layer alone (PyMuPDF only)

WHAT IT MAKES, under services/extraction/work/<book>/ (gitignored scratch: the
directory ignores itself):

    pdf_scan.json      the PDF text layer: per-page folios and running heads, bookmarks, section
                       and sub-heading codes, worked examples, exercises with their shortcode
                       lists, the parsed answer appendix, media codes, Form XObject figures,
                       every page's text and every text line's spans (font, size, position) —
                       the maths cross-check and S0b's hash recovery read those
    page_map.json      printed page ↔ PDF page, as regimes derived from EVERY footer, checked
                       against the book config's page_offsets
    blocks.jsonl       the EPUB as typed blocks in reading order, each linked to a printed page:
                       heading · para · list · summary_item · definition · box · table · figure ·
                       media · worked_example (question + worksteps) · exercise_header ·
                       exercise_item (problem + the EPUB worked solution + the PDF shortcode +
                       the printed answer) · teacher_only (FR-4408: S2 drops these) · unparsed
                       Maths stays an image reference, ⟦m:<md5>⟧ in text and `maths: [md5…]`:
                       the EPUB has no MathML, LaTeX or alt text; S0b supplies the LaTeX.
    epub_index.json    per spine file: sections, sub-headings, worked examples, exercises,
                       figures by context, boxes, media, maths counts (the S0 scout's inventory,
                       made by the same parse as the blocks; build_manifest.py reads it)
    equations.json     every unique equation image: size, references, contexts, blocks, pages,
                       and whether it is printed in the PDF, EPUB-solution-only or teacher-only
    equations/         the equation PNGs, extracted once (S0b's vision passes read them)
    figures/           the EPUB figure PNGs (already cropped); figures.json maps each to its
                       blocks, context, page and the PDF Form XObject boxes on that page
    edition-check.json the edition check (decision 21), below
    adapter-summary.json  counts, and every check this run made

THE EDITION CHECK (spec §3.3 step 6, as revised by decision 21):
    required   the section-code sets (EMA…) are equal, and the media-code sets are equal
    content    numbered section titles in order; worked examples per chapter; exercise-set
               labels; a seeded sample of paragraphs, exercise stems and worked-example
               questions; printed answers found in the EPUB solutions where testable
    recorded   the build markers of both files (producer, dates, identifiers, version
               strings). They are NOT required to match: the EPUB has no version string.
               Item shortcodes are PDF-only and are not compared.
    verdict    "match" (same content, different packaging) or "content_mismatch". Exit 3 on a
               mismatch: the adapter then needs the PDF-only route (--pdf-only, not built — no
               book so far has needed it; Grade 10's verdict is match).

WHY TWO LAYERS. PyMuPDF is the only reader of the PDF text layer we have, and it is not
a dependency of this project (pyproject.toml). `pdf-scan` needs nothing else and runs
under any Python ≥3.9 that has it; everything else runs in the project's uv
environment. A pdf_scan.json is reused only when its sha256 is the PDF's.

The scouting scripts (scratch_g10/) did S0a by hand for Grade 10; this is their
build. `build_manifest.py` must reproduce the manifest G0 approved from these
outputs (T333), which is the adapter's end-to-end test on a real book.
"""

from __future__ import annotations

import argparse
import collections
import difflib
import hashlib
import json
import os
import posixpath
import random
import re
import struct
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
ADAPTER_VERSION = 1
SEED = 20260925                    # the S0 report's sample seed
NS = "{http://www.w3.org/1999/xhtml}"
DASH = "–"                         # "Exercise 1 – 1"
MATH_FONT_PREFIXES = ("CM", "MS")  # Computer Modern + AMS: the PDF's maths spans
EXIT_CONTENT_MISMATCH = 3
EXIT_USAGE = 2


# ============================================================================ helpers
def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def png_size(data: bytes):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    w, h = struct.unpack(">II", data[16:24])
    return w, h


def png_text_chunks(data: bytes) -> dict:
    """tEXt chunks (key → value) of a PNG: where the EPUB's render date lives."""
    out = {}
    i = 8
    while i + 8 <= len(data):
        n, typ = struct.unpack(">I4s", data[i:i + 8])
        if typ == b"tEXt":
            k, _, v = data[i + 8:i + 8 + n].partition(b"\x00")
            out[k.decode("latin-1")] = v.decode("latin-1")
        if typ == b"IEND":
            break
        i += 12 + n
    return out


def words(s: str) -> list:
    """Lower-case words of 2+ letters, maths tokens dropped, PDF hyphenation joined."""
    s = re.sub(r"⟦[^⟧]*⟧", " ", s)
    s = s.replace("-\n", "")
    return [w.lower() for w in re.findall(r"[A-Za-z]{2,}", s)]


def norm_title(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def local(tag: str) -> str:
    return tag.split("}")[-1]


def classes(el) -> list:
    return (el.get("class") or "").split()


# ============================================================================ PDF layer
def pdf_scan(pdf_path: Path) -> dict:
    """The PDF text layer, read once. Needs PyMuPDF and nothing else from this project.

    The first half is the S0 scout's scout_pdf.py, kept rule for rule so the manifest
    reproduces (T333). The rest is new: page texts, line spans (font, size, position)
    and a font table, for page linking, the S0b hash recovery and its cross-check.
    """
    import fitz  # PyMuPDF — see the module docstring

    doc = fitz.open(str(pdf_path))
    H = doc[0].rect.height
    RE_WE = re.compile(r"^Worked example (\d+): (.+)$")
    RE_EX = re.compile(r"^(End of chapter )?Exercise (\d+) " + DASH + r" (\d+):")
    RE_SHORT = re.compile(r"(?<![0-9A-Za-z])(\d{1,2}[a-z]?(?:\.[ivx]+|\([ivx]+\))?)\.\s+([0-9][0-9A-Z]{3})(?![0-9A-Za-z])")
    RE_MEDIA = re.compile(r"See (video|presentation|simulation): ([0-9][0-9A-Z]{3})")

    def page_lines(i):
        out = []
        for b in doc[i].get_text("blocks"):
            if b[6] != 0:
                continue
            for ln in b[4].split("\n"):
                ln = re.sub(r"\s+", " ", ln).strip()
                if ln:
                    out.append((ln, b[1]))
        return out

    # ---- page map: the printed folio from every footer, never the bookmarks
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
            if re.fullmatch(r"\d{1,3}", t):
                printed, head = int(t), None
                break
        page_map.append({"pdf": i + 1, "printed": printed, "running_head": head})

    outline = [{"level": l, "title": t, "pdf": p} for l, t, p in doc.get_toc()]

    sections, subheads, wes, exercises = [], [], [], []
    codes = collections.defaultdict(list)
    media = []
    heads = [p for p in page_map if p["running_head"] == "Solutions"]
    pasts = [p for p in page_map if p["running_head"] == "Past exam papers"]
    answers_start = heads[0]["pdf"] if heads else doc.page_count + 1
    past_start = pasts[0]["pdf"] if pasts else doc.page_count + 1

    cur_ex = None
    for i in range(doc.page_count):
        pdfp = i + 1
        lines = page_lines(i)
        text = "\n".join(l for l, _ in lines)
        for m in RE_MEDIA.finditer(text):
            media.append({"kind": m.group(1), "code": m.group(2), "pdf": pdfp})
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
            if pdfp < answers_start and cur_ex is not None and cur_ex["where"] == "body":
                for m in RE_SHORT.finditer(ln):
                    cur_ex["shortcodes"].append({"label": m.group(1), "code": m.group(2), "pdf": pdfp})

    # ---- the answer appendix, parsed into per-exercise leaves (scout rules, unchanged)
    LETTERS = "abcdefghijklmnopqrstuvwxyz"
    answers = []
    cur = None
    for i in range(answers_start - 1, min(past_start - 1, doc.page_count)):
        pdfp = i + 1
        for b in doc[i].get_text("blocks"):
            if b[6] != 0 or b[1] < H * 0.035:
                continue
            t = b[4].strip()
            if b[1] > H * 0.95 and re.fullmatch(r"\d{1,3}\s+(Solutions|Past exam papers)", re.sub(r"\s+", " ", t)):
                continue
            if re.fullmatch(r"\d{1,2}\n[A-Z][A-Za-z ]+", t) or t == "Solutions to exercises":
                continue
            m = re.match(r"^(?:End of chapter )?Exercise (\d+) " + DASH + r" (\d+):", t)
            if m:
                cur = {"label": f"{m.group(1)}-{m.group(2)}", "pdf_first": pdfp, "pdf_last": pdfp, "leaves": []}
                body_ex = next((e for e in exercises if e["where"] == "body" and e["label"] == cur["label"]), None)
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
                    mm = re.search(r"\s(\d{1,2})\.\s|\s([a-z])\)\s", " " + line + " ")
                    if mm and mm.start() > 0:
                        head, line = (" " + line)[:mm.start()].strip(), (" " + line)[mm.start():].strip()
                    else:
                        head, line = line, ""
                    if cur["leaves"]:
                        cur["leaves"][-1]["text"] = (cur["leaves"][-1]["text"] + " " + head).strip()
                    if head == "" and line:
                        if cur["leaves"]:
                            cur["leaves"][-1]["text"] = (cur["leaves"][-1]["text"] + " " + line).strip()
                        line = ""

    # ---- figures: every Form XObject placement; an xref placed on 6+ pages is an icon
    occ = collections.Counter()
    where = collections.defaultdict(list)
    bbox = {}
    for i in range(doc.page_count):
        for xref, name, invoker, bb in doc[i].get_xobjects():
            if invoker == 0:
                occ[xref] += 1
                where[xref].append(i + 1)
                bbox[(xref, i + 1)] = [round(v) for v in bb]
    icons = {x for x, n in occ.items() if n >= 6}
    figures = []
    for x in occ:
        if x in icons:
            continue
        for p in where[x]:
            figures.append({"xref": x, "pdf": p, "bbox": bbox[(x, p)]})
    figures.sort(key=lambda f: (f["pdf"], f["xref"]))
    rasters = []
    for i in range(doc.page_count):
        for im in doc[i].get_images(full=True):
            rasters.append({"pdf": i + 1, "xref": im[0], "w": im[2], "h": im[3]})

    # ---- new: page texts and line spans (font table keeps the file small)
    fonts: list = []
    font_ix: dict = {}
    page_text = []
    page_spans = []
    for i in range(doc.page_count):
        page_text.append(doc[i].get_text())
        lines_out = []
        d = doc[i].get_text("dict")
        for bno, b in enumerate(d["blocks"]):
            for l in b.get("lines", []):
                spans = []
                for s in l["spans"]:
                    if not s["text"]:
                        continue
                    f = s["font"]
                    if f not in font_ix:
                        font_ix[f] = len(fonts)
                        fonts.append(f)
                    spans.append([font_ix[f], round(s["size"], 2), round(s["bbox"][0], 1), round(s["bbox"][2], 1),
                                  round(s["origin"][1], 1), s["text"]])
                if spans and any(sp[5].strip() for sp in spans):
                    lines_out.append([bno, spans])
        page_spans.append(lines_out)

    return {
        "scan_version": ADAPTER_VERSION,
        "pdf": {"path": str(pdf_path), "sha256": sha256_file(pdf_path), "bytes": os.path.getsize(pdf_path)},
        "pages": doc.page_count, "metadata": doc.metadata,
        "page_map": page_map, "outline": outline, "sections": sections, "subheadings": subheads,
        "worked_examples": wes, "exercises": exercises, "answers": answers, "media": media,
        "figures": figures, "icon_xrefs": sorted(icons), "icon_counts": {str(x): occ[x] for x in sorted(icons)},
        "rasters": rasters, "codes": codes,
        "answers_start_pdf": answers_start, "past_papers_start_pdf": past_start,
        "fonts": fonts, "page_text": page_text, "page_spans": page_spans,
    }


# ============================================================================ page map
def derive_page_map(scan: dict) -> dict:
    """Offset regimes from EVERY footer: consecutive folioed pages with one pdf−printed."""
    folios = [(p["pdf"], p["printed"]) for p in scan["page_map"] if p["printed"] is not None]
    regimes = []
    for pdf, printed in folios:
        off = pdf - printed
        if regimes and regimes[-1]["pdf_minus_printed"] == off:
            regimes[-1]["pdf_to"] = pdf
            regimes[-1]["printed_to"] = printed
            regimes[-1]["folios"] += 1
        else:
            regimes.append({"pdf_from": pdf, "pdf_to": pdf, "printed_from": printed, "printed_to": printed,
                            "pdf_minus_printed": off, "folios": 1})
    no_folio = [p["pdf"] for p in scan["page_map"] if p["printed"] is None]
    return {"regimes": regimes, "pages_with_folio": len(folios), "pages_without_folio": no_folio,
            "exceptions": [r for r in regimes if r["folios"] < 3]}


class PageMap:
    def __init__(self, pm: dict):
        self.regimes = [r for r in pm["regimes"] if r["folios"] >= 3]

    def printed(self, pdf):
        """The printed number of a PDF page under the regime covering it (openers and blanks
        inside a regime take its offset); None outside every regime (front and back matter)."""
        if pdf is None:
            return None
        for i, r in enumerate(self.regimes):
            hi = self.regimes[i + 1]["pdf_from"] - 1 if i + 1 < len(self.regimes) else r["pdf_to"]
            if r["pdf_from"] <= pdf <= hi:
                return pdf - r["pdf_minus_printed"]
        return None


def check_page_offsets(book, pm: dict) -> list:
    """The book config's page_offsets must agree with the derived regimes, anchor by anchor."""
    problems = []
    derived = {r["pdf_minus_printed"] for r in pm["regimes"] if r["folios"] >= 3}
    pmap = PageMap(pm)
    for reg in book.page_offsets:
        if reg.pdf_minus_printed is None:
            continue
        if reg.pdf_minus_printed not in derived:
            problems.append(f"book config regime '{reg.label}' says pdf - printed = {reg.pdf_minus_printed}; "
                            f"the footers give {sorted(derived)}")
        for printed, pdf in reg.verified_at:
            got = pmap.printed(pdf)
            if got != printed:
                problems.append(f"book config anchor printed {printed} = PDF {pdf}, but the footers give {got}")
    return problems


# ============================================================================ EPUB
class Epub:
    """An EPUB read straight from its zip. Only the OPF, the spine and the XHTML are parsed."""

    def __init__(self, path: Path):
        self.path = path
        self.z = zipfile.ZipFile(path)
        c = ET.fromstring(self.z.read("META-INF/container.xml"))
        rf = c.find(".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile")
        self.opf_path = rf.get("full-path")
        self.opf_dir = posixpath.dirname(self.opf_path)
        opf = self.z.read(self.opf_path).decode("utf-8")
        self.opf_text = opf
        items = {}
        for m in re.finditer(r"<item\b([^>]*)/?>", opf):
            a = m.group(1)
            i = re.search(r'\bid="([^"]+)"', a)
            h = re.search(r'href="([^"]+)"', a)
            if i and h:
                items[i.group(1)] = h.group(1)
        self.spine = [items[s] for s in re.findall(r'<itemref idref="([^"]+)"', opf)]

        def meta(pat):
            m = re.search(pat, opf)
            return m.group(1) if m else None
        self.metadata = {
            "dc_identifier": meta(r"<dc:identifier[^>]*>([^<]+)<"),
            "dc_title": meta(r"<dc:title[^>]*>([^<]+)<"),
            "dc_language": meta(r"<dc:language[^>]*>([^<]+)<"),
            "dcterms_modified": meta(r'property="dcterms:modified"[^>]*>([^<]+)<'),
            "opf_version": meta(r'<package[^>]*\bversion="([^"]+)"'),
        }

    def zip_path(self, href: str, base_href: str = "") -> str:
        base = posixpath.dirname(posixpath.join(self.opf_dir, base_href)) if base_href else self.opf_dir
        return posixpath.normpath(posixpath.join(base, href))

    def read(self, zpath: str) -> bytes:
        return self.z.read(zpath)

    def entries(self):
        return self.z.infolist()


# ---------------------------------------------------------------------------- scout inventory
def text_of(el, math_token=True) -> str:
    """The scout's plain text (⟦md5⟧ for maths, ⟦fig⟧ for figures): used for the inventory and
    the edition samples, so both stay comparable with the S0 report."""
    out = []

    def walk(e):
        if local(e.tag) == "img":
            src = e.get("src", "")
            if src.startswith("equation/") and math_token:
                out.append(" ⟦" + os.path.basename(src)[:-4] + "⟧ ")
            elif not src.startswith("equation/"):
                out.append(" ⟦fig⟧ ")
        if e.text:
            out.append(e.text)
        for c in e:
            walk(c)
            if c.tail:
                out.append(c.tail)

    walk(el)
    return re.sub(r"\s+", " ", "".join(out)).strip()


def imgs(el) -> dict:
    eq_inline = eq_block = 0
    figs, hashes = [], []
    for i in el.iter(NS + "img"):
        src = i.get("src", "")
        if src.startswith("equation/"):
            hashes.append(os.path.basename(src)[:-4])
            if "math-block" in classes(i):
                eq_block += 1
            else:
                eq_inline += 1
        else:
            figs.append(src)
    return {"math_inline": eq_inline, "math_block": eq_block, "figures": figs, "hashes": hashes}


def scout_context(el, parent) -> str:
    """Innermost structural context of an element (the S0 scout's rule, unchanged)."""
    e = el
    while e in parent:
        e = parent[e]
        c = classes(e)
        if "solution" in c:
            return "exercise_solution"
        if "problem" in c:
            return "exercise_problem"
        if "header" in c and any("problemset" in classes(a) for a in [parent.get(e)] if a is not None):
            return "exercise_header"
        if "workstep" in c:
            return "we_solution"
        if "question" in c:
            return "we_question"
        if "definition" in c:
            return "definition"
        if "note" in c:
            return "note"
        if "teachers-guide" in c:
            return "teachers_guide"
        if "activity" in c:
            return "activity"
    return "body"


def exercise_members(outer, parent):
    """An exercise's questions. Exercise 5.1 continues after its titled problemset in untitled
    sibling problemsets and bare entries; they are folded in, and the titled block's own entries
    become question 1's sub-parts (S0 report §2.4). Returns (members, continuation_elements)."""
    sibs = list(parent[outer])
    k = sibs.index(outer) + 1
    cont = []
    while k < len(sibs) and ("entry" in classes(sibs[k]) or (
            "problemset" in classes(sibs[k]) and not any("exerciseTitle" in classes(y) for y in sibs[k]))):
        cont.append(sibs[k])
        k += 1
    if cont:
        q1 = ET.Element(NS + "div", {"class": "problemset"})
        for y in outer:
            if "entry" in classes(y) or "header" in classes(y):
                q1.append(y)
        return [q1] + cont, cont
    return list(outer), []


def index_file(root, fname: str, href: str) -> dict:
    """The per-file inventory, exactly as the S0 scout (scout_epub.py) counted it."""
    rec = {"file": fname, "href": href, "sections": [], "subheadings": [], "worked_examples": [],
           "exercises": [], "figures": [], "boxes": collections.Counter(), "videos": [],
           "math_inline": 0, "math_block": 0, "text_paras": []}
    body = root.find(NS + "body")
    parent = {c: p for p in body.iter() for c in p}
    for el in body.iter():
        tag, c = local(el.tag), classes(el)
        if tag == "div" and "section" in c:
            h = next((x for x in el if local(x.tag) in ("h2", "h3", "h4") and "title" in classes(x)), None)
            if h is None:
                continue
            title = text_of(h, math_token=False)
            entry = {"id": el.get("id"), "heading_id": h.get("id"), "level": local(h.tag), "title": title}
            if local(h.tag) == "h2":
                m = re.match(r"^(\d{1,2})\.(\d{1,2}) (.+)$", title)
                entry["num"] = f"{m.group(1)}.{m.group(2)}" if m else None
                entry["title"] = m.group(3) if m else title
                rec["sections"].append(entry)
            else:
                rec["subheadings"].append(entry)
        elif tag == "div" and "worked_example" in c:
            h = el.find(NS + "h1")
            title = text_of(h, math_token=False) if h is not None else ""
            m = re.match(r"^Worked example (\d+): (.+)$", title)
            q = next((x for x in el if "question" in classes(x)), None)
            steps = [x for x in el if "workstep" in classes(x)]
            im = imgs(el)
            rec["worked_examples"].append({
                "n": int(m.group(1)) if m else None, "title": m.group(2) if m else title,
                "question_text": text_of(q) if q is not None else "",
                "worksteps": len(steps),
                "step_titles": [text_of(s.find(NS + "h2"), math_token=False) for s in steps if s.find(NS + "h2") is not None],
                "math_inline": im["math_inline"], "math_block": im["math_block"], "figures": len(im["figures"]),
            })
        elif tag == "span" and "exerciseTitle" in c:
            outer = parent[el]
            label = (el.text or "").strip()
            m = re.match(r"^Exercise (\d+)\.(\d+)$", label)
            qrecs = []

            def entry_rec(e):
                p = next((x for x in e if "problem" in classes(x)), None)
                s = next((x for x in e if "solution" in classes(x)), None)
                pi, si = imgs(p) if p is not None else None, imgs(s) if s is not None else None
                return {
                    "problem_text": text_of(p) if p is not None else "",
                    "solution_text": text_of(s) if s is not None else "",
                    "has_solution": s is not None and bool(text_of(s)),
                    "problem_math": (pi["math_inline"] + pi["math_block"]) if pi else 0,
                    "solution_math": (si["math_inline"] + si["math_block"]) if si else 0,
                    "problem_figures": len(pi["figures"]) if pi else 0,
                    "solution_figures": len(si["figures"]) if si else 0,
                    "problem_hashes": pi["hashes"] if pi else [],
                    "solution_hashes": si["hashes"] if si else [],
                }

            def leaf_entries(x):
                out = []
                for y in x:
                    if "entry" in classes(y):
                        out.append(entry_rec(y))
                    elif "problemset" in classes(y):
                        out.extend(leaf_entries(y))
                return out

            ex_header = next((x for x in outer if "header" in classes(x)), None)
            depth = 1
            members, cont = exercise_members(outer, parent)
            for x in members:
                if "problemset" in classes(x):
                    header = next((y for y in x if "header" in classes(y)), None)
                    depth = 3 if any("problemset" in classes(y) for y in x) else max(depth, 2)
                    qrecs.append({"q": len(qrecs) + 1, "kind": "problemset",
                                  "header_text": text_of(header) if header is not None else "",
                                  "header_figures": len(imgs(header)["figures"]) if header is not None else 0,
                                  "entries": leaf_entries(x)})
                elif "entry" in classes(x):
                    qrecs.append({"q": len(qrecs) + 1, "kind": "entry", "header_text": "", "header_figures": 0,
                                  "entries": [entry_rec(x)]})
            rec["exercises"].append({"label": f"{m.group(1)}-{m.group(2)}" if m else label, "questions": qrecs,
                                     "exercise_header": text_of(ex_header) if ex_header is not None else "",
                                     "nesting_depth": depth, "untitled_continuations": len(cont)})
        elif tag == "img":
            src = el.get("src", "")
            if src.startswith("equation/"):
                if "math-block" in c:
                    rec["math_block"] += 1
                else:
                    rec["math_inline"] += 1
            else:
                rec["figures"].append({"src": src, "context": scout_context(el, parent)})
        elif tag == "dl" and "definition" in c:
            rec["boxes"]["definition"] += 1
        elif tag == "div" and "note" in c:
            rec["boxes"]["note:" + "-".join(x for x in c if x != "note") or "note"] += 1
        elif "teachers-guide" in c:
            rec["boxes"]["teachers_guide"] += 1
        elif tag == "div" and "activity" in c:
            rec["boxes"]["activity:" + "-".join(x for x in c if x != "activity")] += 1
        elif el.get("data-class") in ("video", "presentation", "simulation"):
            rec["videos"].append({"kind": el.get("data-class"), "id": el.get("id")})
        elif tag == "p" and scout_context(el, parent) == "body":
            t = text_of(el)
            if len(t) > 120:
                rec["text_paras"].append(t)
    rec["boxes"] = dict(rec["boxes"])
    return rec


# ---------------------------------------------------------------------------- typed blocks
class Blocks:
    """Typed blocks of one spine file, in reading order.

    Every equation image and every figure in the file lands in exactly one block (the
    adapter checks that against the inventory). Maths is kept as a reference: ⟦m:<md5>⟧ in
    `text`, and the md5 in `maths`, in order, repeats included.
    """

    MEDIA = ("video", "presentation", "simulation")

    def __init__(self, root, fname: str, href: str, chapter: int):
        self.body = root.find(NS + "body")
        self.parent = {c: p for p in self.body.iter() for c in p}
        self.fname, self.href, self.chapter = fname, href, chapter
        self.out: list = []
        self.consumed: set = set()
        self.sub_code = None        # nearest h3/h4 section code above the current point
        self.in_summary = False

    # -- content of an element: text with maths tokens, maths list, figures list
    def content(self, el, skip=()) -> dict:
        parts, maths, figs, math_kinds = [], [], [], []

        def walk(e, top=False):
            if e in skip:
                return
            if local(e.tag) == "img":
                src = e.get("src", "")
                if src.startswith("equation/"):
                    h = os.path.basename(src)[:-4]
                    parts.append(" ⟦m:" + h + "⟧ ")
                    maths.append(h)
                    math_kinds.append("block" if "math-block" in classes(e) else "inline")
                else:
                    parts.append(" ⟦fig:" + src + "⟧ ")
                    figs.append({"src": src, "context": scout_context(e, self.parent)})
            if e.text:
                parts.append(e.text)
            for c in e:
                walk(c)
                if c.tail:
                    parts.append(c.tail)

        walk(el, top=True)
        text = re.sub(r"\s+", " ", "".join(parts)).strip()
        return {"text": text, "maths": maths, "math_kinds": math_kinds, "figures": figs}

    def emit(self, type_: str, el, **kw) -> dict:
        b = {"type": type_, "file": self.fname, "chapter": self.chapter,
             "subsection_code": self.sub_code, "xml_tag": local(el.tag) if el is not None else None}
        b.update(kw)
        self.out.append(b)
        return b

    # -- the walk
    def run(self) -> list:
        self.walk(self.body)
        return self.out

    def walk(self, el):
        for child in list(el):
            if child in self.consumed:
                continue
            self.handle(child)

    def handle(self, el):
        tag, c = local(el.tag), classes(el)
        if tag == "div" and "teachers-guide" in c:
            # FR-4408: addressed to teachers; kept as a block so it is visible and countable,
            # and every later stage drops it (S2 never reads a teacher_only block).
            self.emit("teacher_only", el, **self.content(el))
            return
        if tag == "div" and "section" in c:
            h = next((x for x in el if local(x.tag) in ("h2", "h3", "h4") and "title" in classes(x)), None)
            if h is None:
                self.walk(el)
                return
            code = el.get("id")[2:] if (el.get("id") or "").startswith("scEMA") else None
            title = text_of(h, math_token=False)
            cont = self.content(h)
            if local(h.tag) == "h2":
                m = re.match(r"^(\d{1,2})\.(\d{1,2}) (.+)$", title)
                t = (m.group(3) if m else title).strip()
                self.in_summary = t.lower() in ("chapter summary", "summary")
                self.sub_code = None
                self.emit("heading", h, level=2, epub_number=f"{m.group(1)}.{m.group(2)}" if m else None,
                          title=t, code=code, heading_id=h.get("id"), text=cont["text"], maths=cont["maths"],
                          math_kinds=cont["math_kinds"], figures=cont["figures"])
            else:
                if code:
                    self.sub_code = code
                self.emit("heading", h, level=int(local(h.tag)[1]), title=title.strip(), code=code,
                          heading_id=h.get("id"), text=cont["text"], maths=cont["maths"],
                          math_kinds=cont["math_kinds"], figures=cont["figures"])
            self.consumed.add(h)
            self.walk(el)
            return
        if tag == "div" and "worked_example" in c:
            self.worked_example(el)
            return
        if tag == "div" and "problemset" in c:
            if any("exerciseTitle" in classes(x) for x in el):
                self.exercise(el)
            elif any("exerciseTitle" in classes(x) for x in el.iter()):
                # a wrapper around a titled exercise (5.1): its continuation blocks are
                # siblings of the titled one inside it, and exercise() folds them in
                self.walk(el)
            else:
                self.emit("unparsed", el, reason="problemset outside a titled exercise", **self.content(el))
            return
        if tag == "div" and "entry" in c:
            self.emit("unparsed", el, reason="exercise entry outside a titled exercise", **self.content(el))
            return
        if tag == "dl" and "definition" in c:
            dt = el.find(NS + "dt")
            self.emit("definition", el, term=text_of(dt, math_token=False) if dt is not None else "",
                      **self.content(el))
            return
        if tag == "div" and ("note" in c or "activity" in c or "mathidentity" in c):
            kind = ("note:" + "-".join(x for x in c if x != "note")) if "note" in c else \
                ("activity:" + "-".join(x for x in c if x != "activity")) if "activity" in c else "identity"
            media = [{"kind": x.get("data-class"), "code": (x.get("id") or "")[2:] or None}
                     for x in el.iter() if x.get("data-class") in self.MEDIA]
            h1 = el.find(NS + "h1")
            self.emit("box", el, kind=kind, title=text_of(h1, math_token=False) if h1 is not None else None,
                      media=media, **self.content(el))
            return
        if tag in ("ul", "ol"):
            if self.in_summary:
                for li in el.iter(NS + "li"):
                    # a nested list's items are their own summary items
                    sub = [x for x in li.iter() if local(x.tag) in ("ul", "ol") and x is not li]
                    skip = set()
                    for s in sub:
                        skip.add(s)
                    cont = self.content(li, skip=skip)
                    if cont["text"] or cont["maths"] or cont["figures"]:
                        self.emit("summary_item", li, **cont)
            else:
                items = [self.content(li) for li in el if local(li.tag) == "li"]
                self.emit("list", el, ordered=tag == "ol", items=[i["text"] for i in items], **self.content(el))
            return
        if tag == "table":
            rows = [[text_of(td) for td in tr if local(td.tag) in ("td", "th")] for tr in el.iter(NS + "tr")]
            self.emit("table", el, rows=rows, **self.content(el))
            return
        if tag == "div" and "figure" in c:
            cap = next((x for x in el if "figcaption" in classes(x) or "caption" in classes(x)), None)
            self.emit("figure", el, caption=text_of(cap) if cap is not None else None, **self.content(el))
            return
        if el.get("data-class") in self.MEDIA:
            self.emit("media", el, kind=el.get("data-class"), code=(el.get("id") or "")[2:] or None,
                      **self.content(el))
            return
        if tag == "img":
            cont = self.content(el)
            self.emit("figure" if cont["figures"] else "para", el, display=True, **cont)
            return
        if tag in ("p", "h1", "h2", "h3", "h4", "span", "strong", "em", "a"):
            cont = self.content(el)
            if cont["text"] or cont["maths"] or cont["figures"]:
                self.emit("para", el, **cont)
            return
        if len(el):
            self.walk(el)
        else:
            cont = self.content(el)
            if cont["text"]:
                self.emit("para", el, **cont)

    def worked_example(self, el):
        h = el.find(NS + "h1")
        title = text_of(h, math_token=False) if h is not None else ""
        m = re.match(r"^Worked example (\d+): (.+)$", title)
        q = next((x for x in el if "question" in classes(x)), None)
        steps, loose = [], []
        for x in el:
            if x is h or x is q:
                continue
            if "workstep" in classes(x):
                sh = x.find(NS + "h2")
                cont = self.content(x, skip={sh} if sh is not None else set())
                steps.append({"title": text_of(sh, math_token=False) if sh is not None else None, **cont})
            else:
                loose.append(x)
        loose_c = None
        if loose:
            wrap = ET.Element(NS + "div")
            for x in loose:
                wrap.append(x)
            loose_c = self.content(wrap)
        whole = self.content(el)
        self.emit("worked_example", el, n=int(m.group(1)) if m else None, title=m.group(2) if m else title,
                  question=self.content(q) if q is not None else None, steps=steps, loose_solution=loose_c,
                  text=whole["text"], maths=whole["maths"], math_kinds=whole["math_kinds"],
                  figures=whole["figures"])

    def exercise(self, outer):
        span = next(x for x in outer if "exerciseTitle" in classes(x))
        label_raw = (span.text or "").strip()
        m = re.match(r"^Exercise (\d+)\.(\d+)$", label_raw)
        label = f"{m.group(1)}-{m.group(2)}" if m else label_raw
        members, cont = exercise_members(outer, self.parent)
        for x in cont:
            self.consumed.add(x)
        ex_header = next((x for x in outer if "header" in classes(x)), None)
        if ex_header is not None:
            self.emit("exercise_header", ex_header, exercise=label, q=None, level=1, **self.content(ex_header))
        questions = [x for x in members if "problemset" in classes(x) or "entry" in classes(x)]
        for qn, x in enumerate(questions, 1):
            entries = []

            def collect(ps, level):
                for y in ps:
                    if "header" in classes(y) and y is not ex_header:
                        self.emit("exercise_header", y, exercise=label, q=qn, level=level, **self.content(y))
                    elif "entry" in classes(y):
                        entries.append(y)
                    elif "problemset" in classes(y):
                        collect(y, level + 1)

            if "problemset" in classes(x):
                collect(x, 2)
            elif "entry" in classes(x):
                entries.append(x)
            n = len(entries)
            for k, e in enumerate(entries, 1):
                p = next((y for y in e if "problem" in classes(y)), None)
                s = next((y for y in e if "solution" in classes(y)), None)
                sub = "abcdefghijklmnopqrstuvwxyz"[k - 1] if n > 1 else None
                ch, num = (m.group(1), m.group(2)) if m else ("?", "?")
                self.emit("exercise_item", e, exercise=label, q=qn, sub_index=k, sub=sub, items_in_question=n,
                          item_key=f"ex{ch}-{num}-{qn}{sub or ''}",
                          problem=self.content(p) if p is not None else None,
                          solution=self.content(s) if s is not None else None,
                          **self.content(e))


# ============================================================================ the adapter
def chapter_of(fname: str) -> int:
    return int(fname[:2])


def load_scan(book, work: Path, pdf: Path, explicit: Path = None) -> dict:
    target = explicit or (work / "pdf_scan.json")
    want = sha256_file(pdf)
    if target.exists():
        scan = json.loads(target.read_text())
        if scan.get("pdf", {}).get("sha256") == want and scan.get("scan_version") == ADAPTER_VERSION:
            return scan
        print(f"  {target} is for another PDF or scan version: re-scanning", file=sys.stderr)
    try:
        import fitz  # noqa: F401
    except ImportError:
        raise SystemExit(
            "PyMuPDF is not in this environment and there is no current pdf_scan.json.\n"
            f"  either: uv run --with pymupdf source_adapter.py {book.book}\n"
            f"  or, with any Python that has PyMuPDF: python3 source_adapter.py pdf-scan {pdf} {target}")
    scan = pdf_scan(pdf)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(scan, ensure_ascii=False))
    return scan


def write_atomic(path: Path, data: str | bytes) -> None:
    """Write through a temporary file in the same directory and os.replace it into place, so a reader
    (a stage reading blocks.jsonl, an agent reading a figure) never sees a half-written file."""
    path = Path(path)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    if isinstance(data, bytes):
        tmp.write_bytes(data)
    else:
        tmp.write_text(data)
    os.replace(tmp, path)


def prepare_work(work: Path):
    work.mkdir(parents=True, exist_ok=True)
    gi = work.parent / ".gitignore"
    if not gi.exists():
        # work/ is scratch: every file in it is regenerated from the gitignored sources.
        gi.write_text("# written by source_adapter.py: services/extraction/work/ is regenerated scratch\n*\n")


def section_spans(scan: dict, pmap: PageMap) -> dict:
    """PDF page span of every numbered section (the S0 scout's page convention)."""
    TOP_Y = 60
    secs = scan["sections"]
    openers = [o["pdf"] for o in scan["outline"] if o["level"] == 2][:14]
    no_folio = {p["pdf"] for p in scan["page_map"] if p["printed"] is None}
    span = {}
    for i, s in enumerate(secs):
        ch = int(s["num"].split(".")[0])
        nxt = secs[i + 1] if i + 1 < len(secs) else None
        if nxt is not None and int(nxt["num"].split(".")[0]) == ch:
            end = nxt["pdf"] if nxt["y"] > TOP_Y else nxt["pdf"] - 1
        else:
            end = (openers[ch] - 1) if ch < len(openers) else scan["answers_start_pdf"] - 1
            while end in no_folio:
                end -= 1
        first_in_chapter = i == 0 or int(secs[i - 1]["num"].split(".")[0]) != ch
        start = s["pdf"]
        if first_in_chapter and s["pdf"] > openers[ch - 1] + 1 or (first_in_chapter and s["y"] > 200):
            start = openers[ch - 1] + 1
        span[s["num"]] = (start, end)
    return span


class Linker:
    """Links every block to a PDF (and so a printed) page.

    Anchors first — section and sub-heading codes, worked-example numbers, exercise headings
    and media codes, all of which both formats carry. Between anchors, a block with words is
    matched on word trigrams against the candidate pages; a block without (maths only) takes
    the page before it. Pages never go backwards inside a file. Every block records how its
    page was found: anchor | text | carried | not_printed.
    """

    def __init__(self, scan: dict, pmap: PageMap):
        self.scan, self.pmap = scan, pmap
        self.code_page = {}
        for s in scan["sections"] + scan["subheadings"]:
            self.code_page.setdefault(s["code"], s["pdf"])
        secs = sorted([(s["pdf"], int(s["num"].split(".")[0])) for s in scan["sections"]])
        self.we_page = {}
        for w in scan["worked_examples"]:
            ch = [c for p, c in secs if p <= w["pdf"]][-1]
            self.we_page.setdefault((ch, w["n"]), w["pdf"])
        self.ex = {e["label"]: e for e in scan["exercises"] if e["where"] == "body"}
        self.media_page = {}
        for m in scan["media"]:
            self.media_page.setdefault(m["code"], m["pdf"])
        self.page_tri = []
        for t in scan["page_text"]:
            w = words(t)
            self.page_tri.append({tuple(w[i:i + 3]) for i in range(len(w) - 2)})

    def ex_range(self, label):
        e = self.ex.get(label)
        if not e:
            return None
        last = max([s["pdf"] for s in e["shortcodes"]] or [e["pdf"]])
        return e["pdf"], last

    def text_page(self, text: str, lo: int, hi: int):
        w = words(text)
        tri = {tuple(w[i:i + 3]) for i in range(len(w) - 2)}
        if not tri:
            return None
        best, best_p = 0, None
        for p in range(lo, hi + 1):
            if 1 <= p <= len(self.page_tri):
                n = len(tri & self.page_tri[p - 1])
                if n > best:
                    best, best_p = n, p
        if best_p is not None and best >= max(1, len(tri) * 0.3):
            return best_p
        return None

    def link_file(self, blocks: list, span):
        """span = (first, last) PDF page of the file's section, or None."""
        cur = span[0] if span else None
        hi = span[1] if span else None
        for b in blocks:
            page, how = None, None
            t = b["type"]
            if t == "teacher_only":
                b.update(pdf_page=None, printed_page=None, page_method="not_printed")
                continue
            if t == "heading" and b.get("code") in self.code_page:
                page, how = self.code_page[b["code"]], "anchor"
            elif t == "worked_example" and (b["chapter"], b.get("n")) in self.we_page:
                page, how = self.we_page[(b["chapter"], b["n"])], "anchor"
            elif t in ("exercise_header", "exercise_item") and b.get("exercise") in self.ex:
                first, last = self.ex_range(b["exercise"])
                if t == "exercise_header" and b.get("q") is None:
                    page, how = first, "anchor"
                else:
                    lo = min(max(first, cur or first), last)
                    text = b["problem"]["text"] if t == "exercise_item" and b.get("problem") else b.get("text", "")
                    page = self.text_page(text, lo, last)
                    how = "text" if page else "carried"
                    if page is None:
                        page = lo
                    b["pdf_page_range"] = [first, last]
            elif t in ("media",) and b.get("code") in self.media_page:
                page, how = self.media_page[b["code"]], "anchor"
            elif t == "box" and b.get("media") and b["media"][0].get("code") in self.media_page:
                page, how = self.media_page[b["media"][0]["code"]], "anchor"
            if page is None and cur is not None:
                lo = cur
                page = self.text_page(b.get("text", ""), lo, hi if hi and hi >= lo else lo + 2)
                how = "text" if page else "carried"
                if page is None:
                    page = cur
            if page is not None and cur is not None and page < cur and how != "anchor":
                page, how = cur, "carried"
            if page is not None:
                # anchors are exact, so they may move the cursor back; nothing else may
                cur = page if (how == "anchor" or cur is None) else max(cur, page)
            b.update(pdf_page=page, printed_page=self.pmap.printed(page), page_method=how or "carried")
            if b.get("pdf_page_range"):
                b["printed_page_range"] = [self.pmap.printed(x) for x in b["pdf_page_range"]]


def pair_answers(scan: dict, blocks: list) -> dict:
    """Printed answers and PDF shortcodes onto exercise items, by label.

    A leaf "3b)" goes to question 3's second item; an unlettered leaf goes to a one-item
    question, or is recorded at question level when the question has several items. The
    manifest keeps the scout's positional count for reproduction; this is the per-item
    pairing S3 reads.
    """
    ans = {a["label"]: a for a in scan["answers"]}
    ex = {e["label"]: e for e in scan["exercises"] if e["where"] == "body"}
    by_q = collections.defaultdict(list)
    for b in blocks:
        if b["type"] == "exercise_item":
            by_q[(b["exercise"], b["q"])].append(b)
    stats = collections.Counter()
    for (label, q), items in by_q.items():
        leaves = [l for l in ans.get(label, {"leaves": []})["leaves"] if l["q"] == q]
        codes = {s["label"]: s["code"] for s in ex.get(label, {"shortcodes": []})["shortcodes"]}
        for it in items:
            key = f"{q}{it['sub'] or ''}"
            if key in codes:
                it["shortcode"], it["shortcode_scope"] = codes[key], "item"
            elif str(q) in codes:
                it["shortcode"], it["shortcode_scope"] = codes[str(q)], "question"
            else:
                it["shortcode"], it["shortcode_scope"] = None, None
            it["printed_answer"] = None
        for leaf in leaves:
            text = leaf["text"].strip()
            if leaf["sub"] is not None:
                hit = [it for it in items if it["sub"] == leaf["sub"]]
                if hit:
                    hit[0]["printed_answer"] = {"text": text, "pdf_page": leaf["pdf"], "scope": "item"}
                    stats["by_letter"] += 1
                else:
                    stats["letter_without_item"] += 1
            elif len(items) == 1:
                items[0]["printed_answer"] = {"text": text, "pdf_page": leaf["pdf"], "scope": "item"}
                stats["single_item_question"] += 1
            else:
                for it in items:
                    if it["printed_answer"] is None:
                        it["printed_answer"] = {"text": text, "pdf_page": leaf["pdf"], "scope": "question"}
                stats["question_level"] += 1
    items = [b for b in blocks if b["type"] == "exercise_item"]
    stats["items"] = len(items)
    stats["items_with_printed_answer"] = sum(1 for b in items if b["printed_answer"])
    stats["items_with_item_level_answer"] = sum(1 for b in items if b["printed_answer"] and
                                                b["printed_answer"]["scope"] == "item")
    stats["items_with_shortcode"] = sum(1 for b in items if b["shortcode"])
    return dict(stats)


# ---------------------------------------------------------------------------- edition check
def edition_check(scan: dict, index: list, epub: Epub, pmap: PageMap) -> dict:
    """Decision 21's edition check. The PDF and the EPUB must carry the same CONTENT; the
    packaging (maths as images, no page numbers, no shortcodes, no version string) is expected
    to differ and is recorded, not judged."""
    pdf_text = {i + 1: t for i, t in enumerate(scan["page_text"])}
    efiles = [f for f in index if f["file"].endswith(".cnxmlplus.html")]

    # ---- required: section codes and media codes, set-equal
    pdf_codes = {s["code"] for s in scan["sections"]} | {s["code"] for s in scan["subheadings"]}
    epub_codes = {s["id"][2:] for f in efiles for s in f["sections"] + f["subheadings"]
                  if s.get("id") and s["id"].startswith("scEMA")}
    pdf_media = {m["code"] for m in scan["media"]}
    epub_media = {v["id"][2:] for f in efiles for v in f["videos"] if v.get("id")}

    # ---- content: numbered sections in order
    esecs = [(chapter_of(f["file"]), s, f["file"]) for f in efiles for s in f["sections"]]
    psecs = scan["sections"]
    toc = []
    for i in range(max(len(esecs), len(psecs))):
        ps = psecs[i] if i < len(psecs) else None
        ec, es, ef = esecs[i] if i < len(esecs) else (None, None, None)
        toc.append({
            "pdf_num": ps and ps["num"], "pdf_title": ps and ps["title"], "pdf_code": ps and ps["code"],
            "epub_num": es and es.get("num"), "epub_title": es and es["title"], "epub_id": es and es["id"],
            "epub_file": ef,
            "title_match": bool(ps and es and norm_title(ps["title"]).replace("chaptersummary", "summary")
                                == norm_title(es["title"]).replace("chaptersummary", "summary")),
            "num_match": bool(ps and es and ps["num"] == es.get("num")),
            "code_match": bool(ps and es and es["id"] == "sc" + ps["code"]),
        })

    # ---- worked examples per chapter
    secs_p = [(s["pdf"], int(s["num"].split(".")[0])) for s in scan["sections"]]

    def chapter_at(pdfp):
        c = None
        for p, ch in secs_p:
            if p <= pdfp:
                c = ch
        return c

    pwe, ewe = collections.defaultdict(list), collections.defaultdict(list)
    for w in scan["worked_examples"]:
        pwe[chapter_at(w["pdf"])].append(w)
    for f in efiles:
        for w in f["worked_examples"]:
            ewe[chapter_of(f["file"])].append(w)
    chapters = sorted(set(pwe) | set(ewe))
    we_rows, we_title_diffs = [], []
    for ch in chapters:
        a, b = pwe[ch], ewe[ch]
        we_rows.append({"chapter": ch, "pdf": len(a), "epub": len(b)})
        for x, y in zip(a, b):
            if norm_title(x["title"]) != norm_title(y["title"]):
                r = difflib.SequenceMatcher(None, norm_title(x["title"]), norm_title(y["title"])).ratio()
                we_title_diffs.append({"chapter": ch, "n": x["n"], "pdf": x["title"], "epub": y["title"],
                                       "similarity": round(r, 2)})

    # ---- exercise sets and their questions
    pex = {e["label"]: e for e in scan["exercises"] if e["where"] == "body"}
    pans = {a["label"]: a for a in scan["answers"]}
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
                "epub_entries": sum(el), "pdf_shortcodes": len(sc), "pdf_answer_leaves": sum(ac.values()),
                "questions_match": len(el) == len(sq) == (max(sq) if sq else 0),
                "entries_per_q_epub": el, "answer_leaves_per_q_pdf": [ac.get(i, 0) for i in range(1, len(el) + 1)],
                "shortcodes_per_q_pdf": [sq.get(i, 0) for i in range(1, len(el) + 1)],
            })
    labels_equal = sorted(pex) == sorted(r["label"] for r in ex_rows)

    # ---- seeded samples (the report's seed; words compared in order)
    openers = [o["pdf"] for o in scan["outline"] if o["level"] == 2][:14]
    chap_span = {}
    for ch in range(1, len(openers) + 1):
        start = openers[ch - 1]
        end = (openers[ch] - 1) if ch < len(openers) else scan["answers_start_pdf"] - 1
        chap_span[ch] = (start, end)
    rng = random.Random(SEED)
    paras = [(f["file"], p) for f in efiles for p in f["text_paras"]]
    para_rows = []
    for fname, text in rng.sample(paras, min(10, len(paras))):
        ew = words(text)
        a, b = chap_span.get(chapter_of(fname), (1, scan["pages"]))
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
        for c0 in sorted(anchors):
            r = difflib.SequenceMatcher(None, ew, cw[c0:c0 + len(ew)], autojunk=False).ratio()
            if r > best[0]:
                best = (r, c0)
        para_rows.append({"epub_file": fname, "epub_excerpt": text[:90], "words": len(ew),
                          "similarity": round(best[0], 3),
                          "printed_page": pmap.printed(cp[best[1]]) if best[1] is not None else None})
    entries = [(f["file"], ex["label"], q["q"], i, e) for f in efiles for ex in f["exercises"]
               for q in ex["questions"] for i, e in enumerate(q["entries"])]
    wordy = [x for x in entries if len(words(x[4]["problem_text"])) >= 8]
    item_rows = []
    for fname, lab, qn, i, e in rng.sample(wordy, min(10, len(wordy))):
        ew = words(e["problem_text"])
        pe = pex.get(lab)
        if not pe:
            continue
        last = max([s["pdf"] for s in pe["shortcodes"]] or [pe["pdf"]])
        pw = []
        for p in range(pe["pdf"], last + 1):
            pw.extend(words(pdf_text[p]))
        sm = difflib.SequenceMatcher(None, ew, pw, autojunk=False)
        matched = sum(b.size for b in sm.get_matching_blocks())
        item_rows.append({"exercise": lab, "q": qn, "part": i + 1, "epub_excerpt": e["problem_text"][:90],
                          "words": len(ew), "share": round(matched / len(ew), 3)})
    pairs = [(ch, x, y) for ch in chapters for x, y in zip(pwe[ch], ewe[ch])]
    weq_rows = []
    for ch, x, y in rng.sample(pairs, min(10, len(pairs))):
        ew = words(y["question_text"])
        pw = []
        for p in range(x["pdf"], x["pdf"] + 2):
            pw.extend(words(pdf_text.get(p, "")))
        sm = difflib.SequenceMatcher(None, ew, pw, autojunk=False)
        matched = sum(b.size for b in sm.get_matching_blocks())
        weq_rows.append({"chapter": ch, "n": x["n"], "title": y["title"], "words": len(ew),
                         "share": round(matched / max(1, len(ew)), 3)})

    # ---- printed answers inside the EPUB solutions (numbers by hash, words by words)
    RE_NUM = re.compile(r"^−?\d{1,3}(?: \d{3})*(?:,\d+)?$")
    num_tests, word_tests = [], []
    for f in efiles:
        for ex in f["exercises"]:
            lab = ex["label"]
            if lab not in pans:
                continue
            byq = collections.defaultdict(list)
            for leaf in pans[lab]["leaves"]:
                byq[leaf["q"]].append(leaf)
            for q in ex["questions"]:
                sol_hashes = {h for e in q["entries"] for h in e["solution_hashes"]}
                for leaf in byq.get(q["q"], []):
                    t = leaf["text"].strip().rstrip(".")
                    if RE_NUM.match(t):
                        cands = {"\\text{" + t.replace("−", "-") + "}", "-\\text{" + t.lstrip("−") + "}", t}
                        num_tests.append({"exercise": lab, "q": leaf["q"], "sub": leaf["sub"], "answer": t,
                                          "found": any(md5(c) in sol_hashes for c in cands)})
                L = byq.get(q["q"], [])
                if len(L) == len(q["entries"]):
                    for leaf, e in zip(L, q["entries"]):
                        t = leaf["text"]
                        if re.search(r"[0-9=√π<>≤≥;()]", t):
                            continue
                        aw = [w.lower() for w in re.findall(r"[A-Za-z]{4,}", t)]
                        if aw:
                            sw = set(words(e["solution_text"]))
                            word_tests.append({"exercise": lab, "q": q["q"], "answer": t[:60],
                                               "found": all(w in sw for w in aw)})

    # ---- build markers: recorded, never required to match
    pdf_first_pages = {n: re.sub(r"\s+", " ", pdf_text.get(n, "")).strip()[:240] for n in (1, 2, 3)}
    version_re = re.compile(r"VERSION\s+[0-9.]+\s*\w*", re.I)
    xhtml_dates = sorted(zi.date_time for zi in epub.entries() if zi.filename.endswith(".html"))
    eq_entries = [zi for zi in epub.entries() if "/equation/" in zi.filename and zi.filename.endswith(".png")]
    eq_png_date = None
    if eq_entries:
        eq_png_date = png_text_chunks(epub.read(eq_entries[0].filename)).get("date:create")
    epub_version = None
    for zi in epub.entries():
        if zi.filename.endswith((".html", ".xhtml", ".opf")):
            m = version_re.search(epub.read(zi.filename).decode("utf-8", "replace"))
            if m:
                epub_version = m.group(0)
                break
    copyright_title = None
    for href in epub.spine:
        if "copyright" in href.lower() or "front-matter" in href.lower():
            try:
                t = epub.read(epub.zip_path(href)).decode("utf-8", "replace")
                m = re.search(r"<title>([^<]+)</title>", t)
                copyright_title = m.group(1).strip() if m else None
            except KeyError:
                pass
            break
    markers = {
        "pdf": {"metadata": scan["metadata"], "pages": scan["pages"],
                "version_strings": sorted({m.group(0) for n in (1, 2, 3)
                                           for m in version_re.finditer(pdf_text.get(n, ""))}),
                "first_pages": pdf_first_pages,
                "outline_parts": [o["title"] for o in scan["outline"] if o["level"] == 1]},
        "epub": {**epub.metadata, "version_string": epub_version, "zip_entries": len(epub.entries()),
                 "xhtml_zip_dates": [list(xhtml_dates[0]), list(xhtml_dates[-1])] if xhtml_dates else None,
                 "equation_png_date_create": eq_png_date, "copyright_page_title": copyright_title},
    }

    # ---- verdict
    required = {
        "section_codes_equal": pdf_codes == epub_codes,
        "media_codes_equal": pdf_media == epub_media,
    }
    title_ok = sum(1 for t in toc if t["title_match"])
    content = {
        "section_titles_in_order": {"equal": title_ok, "of": len(toc), "pass": title_ok >= 0.95 * len(toc)},
        "worked_examples_per_chapter": {"pass": all(r["pdf"] == r["epub"] for r in we_rows)},
        "exercise_labels": {"pass": labels_equal},
        "paragraph_sample": {"median": sorted(r["similarity"] for r in para_rows)[len(para_rows) // 2]
                             if para_rows else None},
        "exercise_stem_sample": {"median": sorted(r["share"] for r in item_rows)[len(item_rows) // 2]
                                 if item_rows else None},
        "worked_example_question_sample": {"median": sorted(r["share"] for r in weq_rows)[len(weq_rows) // 2]
                                           if weq_rows else None},
    }
    for k in ("paragraph_sample", "exercise_stem_sample", "worked_example_question_sample"):
        content[k]["pass"] = content[k]["median"] is not None and content[k]["median"] >= 0.9
    ok = all(required.values()) and all(v["pass"] for v in content.values())
    return {
        "check_version": ADAPTER_VERSION, "seed": SEED,
        "verdict": "match" if ok else "content_mismatch",
        "summary": ("same content, different packaging" if ok else
                    "the formats disagree on content: the PDF-only route is needed (spec §3.3)"),
        "rules": ("decision 21: required = section-code and media-code set equality; content = titles, "
                  "worked examples, exercise labels and seeded samples; build markers recorded, not required; "
                  "item shortcodes are PDF-only and not compared; no version-string rule"),
        "required": required, "content": content, "markers": markers,
        "section_codes": {"pdf": len(pdf_codes), "epub": len(epub_codes),
                          "only_pdf": sorted(pdf_codes - epub_codes), "only_epub": sorted(epub_codes - pdf_codes)},
        "media_codes": {"pdf": len(pdf_media), "epub": len(epub_media),
                        "only_pdf": sorted(pdf_media - epub_media), "only_epub": sorted(epub_media - pdf_media)},
        "toc": toc,
        "toc_summary": {"pdf_sections": len(psecs), "epub_sections": len(esecs),
                        "title_mismatch": [t for t in toc if not t["title_match"]],
                        "num_mismatch": [t for t in toc if not t["num_match"]],
                        "code_mismatch": [t for t in toc if not t["code_match"]]},
        "worked_examples": {"per_chapter": we_rows, "pdf_total": sum(r["pdf"] for r in we_rows),
                            "epub_total": sum(r["epub"] for r in we_rows), "title_diffs": we_title_diffs},
        "exercises": {"rows": ex_rows, "labels_equal": labels_equal,
                      "questions_match": sum(1 for r in ex_rows if r["questions_match"]),
                      "totals": {k: sum(r[k] for r in ex_rows) for k in
                                 ("epub_questions", "pdf_questions", "epub_entries", "pdf_shortcodes",
                                  "pdf_answer_leaves")}},
        "paragraph_sample": para_rows, "exercise_item_sample": item_rows,
        "worked_example_question_sample": weq_rows,
        "numeric_answer_hash_check": {"tested": len(num_tests), "found_in_epub_solution":
                                      sum(1 for x in num_tests if x["found"])},
        "verbal_answer_word_check": {"tested": len(word_tests), "found_in_epub_solution":
                                     sum(1 for x in word_tests if x["found"]),
                                     "not_found": [x for x in word_tests if not x["found"]]},
    }


# ---------------------------------------------------------------------------- figures, equations
def figure_catalogue(epub: Epub, blocks: list, scan: dict, work: Path, extract: bool) -> dict:
    forms = collections.defaultdict(list)
    for f in scan["figures"]:
        forms[f["pdf"]].append({"xref": f["xref"], "bbox": f["bbox"]})
    cat = {}
    for b in blocks:
        figs = list(b.get("figures", []))
        for f in figs:
            src = f["src"]
            rec = cat.setdefault(src, {"src": src, "refs": 0, "contexts": collections.Counter(), "blocks": [],
                                       "printed_pages": set(), "epub_file": b["file"]})
            rec["refs"] += 1
            rec["contexts"][f["context"]] += 1
            rec["blocks"].append(b["id"])
            if b.get("printed_page") is not None:
                rec["printed_pages"].add(b["printed_page"])
                rec.setdefault("pdf_pages", set()).add(b["pdf_page"])
    out_dir = work / "figures"
    if extract:
        out_dir.mkdir(parents=True, exist_ok=True)
    for src, rec in cat.items():
        zp = next((epub.zip_path(src, h) for h in epub.spine if h.endswith(rec["epub_file"])), None)
        data = epub.read(zp) if zp else b""
        rec["bytes"] = len(data)
        rec["size"] = png_size(data)
        rec["file"] = "figures/" + src.replace("/", "__")
        if extract and data:
            f = work / rec["file"]
            if not f.exists() or f.read_bytes() != data:     # never rewrite a figure an agent may be reading
                write_atomic(f, data)
        pages = sorted(rec.pop("pdf_pages", set()))
        rec["pdf_forms_on_page"] = {str(p): forms.get(p, []) for p in pages}
        rec["printed_pages"] = sorted(rec["printed_pages"])
        rec["contexts"] = dict(rec["contexts"])
    return cat


def equation_catalogue(epub: Epub, blocks: list, work: Path, extract: bool) -> dict:
    """Every unique equation image: where it is used, and whether the PDF prints it.

    printed        used at least once outside an EPUB exercise solution and outside a
                   teacher's note: the PDF body prints it, so S0b can cross-check it
    solution_only  used only in EPUB worked solutions: not printed anywhere in the PDF
    teacher_only   used only in teacher's-guide notes: S2 drops them, S0b need not read them
    """
    cat = {}
    for b in blocks:
        def add(hs, ctx):
            for h in hs:
                rec = cat.setdefault(h, {"refs": 0, "contexts": collections.Counter(), "blocks": [],
                                         "printed_pages": set()})
                rec["refs"] += 1
                rec["contexts"][ctx] += 1
                if not rec["blocks"] or rec["blocks"][-1] != b["id"]:
                    rec["blocks"].append(b["id"])
                if ctx != "exercise_solution" and b.get("printed_page") is not None:
                    rec["printed_pages"].add(b["printed_page"])
        if b["type"] == "exercise_item":
            add(b["problem"]["maths"] if b.get("problem") else [], "exercise_problem")
            add(b["solution"]["maths"] if b.get("solution") else [], "exercise_solution")
        elif b["type"] == "teacher_only":
            add(b["maths"], "teacher_only")
        else:
            add(b["maths"], b["type"])
    eq_dir = work / "equations"
    if extract:
        eq_dir.mkdir(parents=True, exist_ok=True)
    zips = {os.path.basename(zi.filename)[:-4]: zi.filename for zi in epub.entries()
            if "/equation/" in zi.filename and zi.filename.endswith(".png")}
    for h, rec in cat.items():
        ctx = set(rec["contexts"])
        rec["class"] = ("teacher_only" if ctx == {"teacher_only"} else
                        "solution_only" if ctx <= {"exercise_solution", "teacher_only"} else "printed")
        rec["contexts"] = dict(rec["contexts"])
        rec["printed_pages"] = sorted(rec["printed_pages"])
        data = epub.read(zips[h]) if h in zips else b""
        rec["size"] = png_size(data)
        rec["bytes"] = len(data)
        if extract and data:
            p = eq_dir / f"{h}.png"
            if not p.exists():
                write_atomic(p, data)
    unused = sorted(set(zips) - set(cat))
    return {"images": cat, "unreferenced_in_zip": unused}


# ---------------------------------------------------------------------------- run
def run(book, work: Path, scan_path: Path = None, extract: bool = True) -> int:
    from book_config import resolve_source  # the uv environment (pydantic) from here on

    pdf = resolve_source(book.sources.pdf)
    epub_path = resolve_source(book.sources.epub)
    if pdf is None:
        raise SystemExit(f"{book.book}: source PDF {book.sources.pdf} not found (gitignored: put it in docs/Source/)")
    if epub_path is None:
        raise SystemExit(f"{book.book}: no EPUB — the PDF-only adapter route is not built (spec §3.3); "
                         "no book so far has needed it")
    prepare_work(work)
    print(f"S0a {book.book}: reading {pdf.name} and {epub_path.name}")
    scan = load_scan(book, work, pdf, scan_path)
    pm = derive_page_map(scan)
    pmap = PageMap(pm)
    offset_problems = check_page_offsets(book, pm)
    write_atomic(work / "page_map.json", json.dumps(pm, indent=1))

    epub = Epub(epub_path)
    index, blocks = [], []
    spans = section_spans(scan, pmap)
    pdf_by_code = {}
    for s in scan["sections"]:
        pdf_by_code.setdefault(s["code"], s)
    linker = Linker(scan, pmap)
    last_section = None
    for href in epub.spine:
        fname = os.path.basename(href)
        if not fname.endswith(".cnxmlplus.html"):
            index.append({"file": fname, "href": href, "sections": [], "subheadings": [], "worked_examples": [],
                          "exercises": [], "figures": [], "boxes": {}, "videos": [], "math_inline": 0,
                          "math_block": 0, "text_paras": []})
            continue
        root = ET.fromstring(epub.read(epub.zip_path(href)))
        rec = index_file(root, fname, href)
        index.append(rec)
        ch = chapter_of(fname)
        fb = Blocks(root, fname, href, ch).run()
        # the file's PDF section: by code (chapter 2 numbers differ), else the chapter's last
        # (the summary: the EPUB's chapter-2 summary has no id), else the section before
        section = None
        if rec["sections"]:
            es = rec["sections"][0]
            is_summary = es["title"].strip().lower() in ("chapter summary", "summary")
            if is_summary:
                section = [s for s in scan["sections"] if int(s["num"].split(".")[0]) == ch][-1]
            elif es.get("id"):
                section = pdf_by_code.get("EMA" + es["id"][5:])
        eoc_file = not rec["sections"]
        if section is None:
            section = last_section
        last_section = section
        span = spans.get(section["num"]) if section else None
        for b in fb:
            b["section"] = section["num"] if section else None
            b["section_code"] = section["code"] if section else None
            if b["type"] in ("exercise_item", "exercise_header"):
                pe = linker.ex.get(b["exercise"])
                b["end_of_chapter"] = bool(pe and pe["end_of_chapter"])
        if eoc_file:
            rng = [linker.ex_range(x["label"]) for x in rec["exercises"] if linker.ex_range(x["label"])]
            span = (min(r[0] for r in rng), max(r[1] for r in rng)) if rng else span
        linker.link_file(fb, span)
        blocks.extend(fb)
    for i, b in enumerate(blocks):
        b["id"] = f"b{i + 1:05d}"
    # stable key order: id first
    blocks = [{"id": b.pop("id"), **b} for b in blocks]
    answer_stats = pair_answers(scan, blocks)

    ed = edition_check(scan, index, epub, pmap)
    figs = figure_catalogue(epub, blocks, scan, work, extract)
    eqs = equation_catalogue(epub, blocks, work, extract)

    # ---- self-checks: nothing in the EPUB is lost between the inventory and the blocks
    inv_math = sum(f["math_inline"] + f["math_block"] for f in index)
    blk_math = sum(len(b["maths"]) for b in blocks)
    inv_figs = sum(len(f["figures"]) for f in index)
    blk_figs = sum(len(b["figures"]) for b in blocks)
    inv_items = sum(len(q["entries"]) for f in index for ex in f["exercises"] for q in ex["questions"])
    inv_we = sum(len(f["worked_examples"]) for f in index)
    inv_tg = sum(f["boxes"].get("teachers_guide", 0) for f in index)
    types = collections.Counter(b["type"] for b in blocks)
    checks = {
        "every_equation_reference_in_one_block": {"inventory": inv_math, "blocks": blk_math,
                                                  "pass": inv_math == blk_math},
        "every_figure_reference_in_one_block": {"inventory": inv_figs, "blocks": blk_figs,
                                                "pass": inv_figs == blk_figs},
        "every_exercise_item_is_a_block": {"inventory": inv_items, "blocks": types["exercise_item"],
                                           "pass": inv_items == types["exercise_item"]},
        "every_worked_example_is_a_block": {"inventory": inv_we, "blocks": types["worked_example"],
                                            "pass": inv_we == types["worked_example"]},
        "every_teacher_note_is_teacher_only": {"inventory": inv_tg, "blocks": types["teacher_only"],
                                               "pass": inv_tg == types["teacher_only"]},
        "no_unparsed_block": {"blocks": types["unparsed"], "pass": types["unparsed"] == 0},
        "page_offsets_agree_with_book_config": {"problems": offset_problems, "pass": not offset_problems},
        "every_printed_block_has_a_page": {
            "missing": sum(1 for b in blocks if b["page_method"] != "not_printed" and b["printed_page"] is None),
            "pass": all(b["printed_page"] is not None for b in blocks if b["page_method"] != "not_printed")},
    }
    classes_ = collections.Counter(r["class"] for r in eqs["images"].values())
    summary = {
        "book": book.book, "adapter_version": ADAPTER_VERSION,
        "sources": {"pdf": {"file": pdf.name, "sha256": scan["pdf"]["sha256"], "bytes": scan["pdf"]["bytes"],
                            "pages": scan["pages"]},
                    "epub": {"file": epub_path.name, "sha256": sha256_file(epub_path),
                             "bytes": os.path.getsize(epub_path)}},
        "edition_verdict": ed["verdict"],
        "page_map": {"regimes": [{k: r[k] for k in ("pdf_from", "pdf_to", "printed_from", "printed_to",
                                                     "pdf_minus_printed", "folios")} for r in pm["regimes"]],
                     "pages_with_folio": pm["pages_with_folio"]},
        "blocks": dict(sorted(types.items())),
        "page_methods": dict(collections.Counter(b["page_method"] for b in blocks)),
        "exercise_items": answer_stats,
        "equations": {"unique": len(eqs["images"]), "references": blk_math, "by_class": dict(classes_),
                      "unreferenced_in_zip": len(eqs["unreferenced_in_zip"])},
        "figures": {"unique": len(figs), "references": blk_figs},
        "checks": checks,
        "all_checks_pass": all(v["pass"] for v in checks.values()),
    }
    # atomic (backlog 67): later stages read these while a re-run of S0a may be writing them
    write_atomic(work / "blocks.jsonl", "".join(json.dumps(b, ensure_ascii=False) + "\n" for b in blocks))
    write_atomic(work / "epub_index.json", json.dumps({"spine": epub.spine, "opf": epub.metadata, "files": index},
                                                      ensure_ascii=False, indent=1))
    write_atomic(work / "edition-check.json", json.dumps(ed, ensure_ascii=False, indent=1))
    write_atomic(work / "equations.json", json.dumps(eqs, indent=1))
    write_atomic(work / "figures.json", json.dumps(figs, indent=1))
    write_atomic(work / "adapter-summary.json", json.dumps(summary, ensure_ascii=False, indent=1))

    print(f"  edition check: {ed['verdict']} ({ed['summary']}); section codes "
          f"{ed['section_codes']['pdf']}/{ed['section_codes']['epub']}, media codes "
          f"{ed['media_codes']['pdf']}/{ed['media_codes']['epub']}")
    print(f"  page map: " + "; ".join(f"PDF {r['pdf_from']}–{r['pdf_to']} printed = PDF − {r['pdf_minus_printed']} "
                                      f"({r['folios']} folios)" for r in pm["regimes"]))
    print(f"  blocks: {len(blocks)} {dict(sorted(types.items()))}")
    print(f"  equations: {len(eqs['images'])} unique, {blk_math} references, {dict(classes_)}")
    for k, v in checks.items():
        print(f"  {'ok ' if v['pass'] else 'RED'} {k}")
    print(f"  → {work}")
    if ed["verdict"] != "match":
        return EXIT_CONTENT_MISMATCH
    return 0 if summary["all_checks_pass"] else 1


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "pdf-scan":
        ap = argparse.ArgumentParser(prog="source_adapter.py pdf-scan",
                                     description="the PDF layer alone; needs PyMuPDF and nothing else")
        ap.add_argument("pdf")
        ap.add_argument("out")
        a = ap.parse_args(argv[1:])
        scan = pdf_scan(Path(a.pdf))
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(json.dumps(scan, ensure_ascii=False))
        print(f"pdf-scan: {scan['pages']} pages, {len(scan['sections'])} sections, "
              f"{len(scan['worked_examples'])} worked examples, {len(scan['exercises'])} exercise headings → {a.out}")
        return 0
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("book", help="book name or books/<book>.json")
    ap.add_argument("--work", help="output directory (default services/extraction/work/<book>)")
    ap.add_argument("--pdf-scan", help="a pdf_scan.json made by `pdf-scan` (default <work>/pdf_scan.json)")
    ap.add_argument("--no-extract", action="store_true", help="do not write equations/ and figures/")
    ap.add_argument("--pdf-only", action="store_true", help="the PDF-only route (not built)")
    a = ap.parse_args(argv)
    sys.path.insert(0, str(HERE))
    from book_config import load_book
    book = load_book(a.book)
    if a.pdf_only:
        print("the PDF-only adapter route is not built: no book has needed it yet (spec §3.3)", file=sys.stderr)
        return EXIT_USAGE
    work = Path(a.work) if a.work else book.work_dir()
    return run(book, work, Path(a.pdf_scan) if a.pdf_scan else None, extract=not a.no_extract)


if __name__ == "__main__":
    sys.exit(main())

"""Step 1 of 3.

Rebuild the Grade 10 printed answers (PDF appendix, printed pp. 497-514) as LaTeX, from glyph geometry.

Deterministic, no model. The S0 scout (services/extraction/scratch_g10/scout_pdf.py) parsed the appendix
into 2,281 answer leaves from the flattened text layer, which loses the maths structure: `x2 + 8 + 16 x2`
is x^2 + 8 + 16/x^2. This script replays the scout's exact leaf segmentation on PyMuPDF "dict" lines, so
every leaf keeps its glyphs (bbox, baseline, size, font), and then rebuilds the layout:

  * horizontal rules are fraction bars, or radical vinculums when a radical sign touches their left end;
  * a glyph whose baseline sits above / below its row's baseline is a superscript / subscript;
  * a dot accent above a digit is a recurring-decimal dot.

Each leaf's rebuilt LaTeX is checked against its text-layer glyphs: the multiset of non-space glyphs must be
identical (nothing dropped, nothing invented).

Usage: python3 extract_answers.py <book.pdf> <pdf_scan.json> <out.json>
"""
import collections
import json
import re
import sys

import fitz

PDF, SCAN, OUT = sys.argv[1:4]
doc = fitz.open(PDF)
P = json.load(open(SCAN))
H = doc[0].rect.height
DASH = "[–-]"
answers_start = P["answers_start_pdf"]
past_start = P["past_papers_start_pdf"]
body_ex = {e["label"]: e for e in P["exercises"] if e["where"] == "body"}


# ------------------------------------------------------------------ glyphs and lines
def page_blocks(i):
    """Blocks of page i as lists of lines; each line is a list of glyph dicts, in the text layer's order."""
    out = []
    for b in doc[i].get_text("rawdict")["blocks"]:
        if b["type"] != 0:
            continue
        lines = []
        for l in b["lines"]:
            gl = []
            for s in l["spans"]:
                for c in s["chars"]:
                    g = {"c": c["c"], "x0": c["bbox"][0], "y0": c["bbox"][1], "x1": c["bbox"][2],
                         "y1": c["bbox"][3], "ox": c["origin"][0], "oy": c["origin"][1],
                         "size": s["size"], "font": s["font"], "big": False}
                    # Radical signs and CMEX (big) glyphs hang from their origin: their font-metric bbox
                    # says nothing about where they are drawn. Rebuild their vertical extent from the origin.
                    cmex = s["font"].startswith("CMEX")
                    if c["c"] == "√":
                        g["y0"], g["y1"] = g["oy"], g["oy"] + (1.8 if cmex else 0.85) * s["size"]
                        g["big"] = cmex
                    elif cmex:
                        g["y0"], g["y1"] = g["oy"], g["oy"] + 1.4 * s["size"]
                        g["big"] = True
                    gl.append(g)
            lines.append(gl)
        out.append((b["bbox"], lines))
    return out


def line_text(gl):
    return "".join(g["c"] for g in gl)


def rules_of_page(i):
    """Horizontal rules: fraction bars and radical vinculums."""
    rs = []
    for d in doc[i].get_drawings():
        for it in d["items"]:
            if it[0] == "l":
                p1, p2 = it[1], it[2]
                if abs(p1.y - p2.y) < 0.3 and abs(p2.x - p1.x) > 1.5:
                    rs.append({"x0": min(p1.x, p2.x), "x1": max(p1.x, p2.x), "y": (p1.y + p2.y) / 2})
            elif it[0] == "re":
                r = it[1]
                if r.height < 0.8 and r.width > 1.5:
                    rs.append({"x0": r.x0, "x1": r.x1, "y": (r.y0 + r.y1) / 2})
    return rs


# ------------------------------------------------------------------ the scout's leaf segmentation, glyph-carrying
LETTERS = "abcdefghijklmnopqrstuvwxyz"


class Piece:
    """A run of glyphs with its text; whitespace-normalised the way the scout normalised lines."""

    def __init__(self, glyphs):
        # normalise: collapse whitespace, strip; keep a glyph per text char (spaces map to None)
        text, gmap = [], []
        prev_space = True
        for g in glyphs:
            if g["c"].isspace():
                if not prev_space:
                    text.append(" ")
                    gmap.append(None)
                prev_space = True
            else:
                text.append(g["c"])
                gmap.append(g)
                prev_space = False
        while text and text[-1] == " ":
            text.pop()
            gmap.pop()
        self.text = "".join(text)
        self.gmap = gmap

    def cut(self, start):
        """(head, tail) split at a text offset; both stripped."""
        h, t = Piece.__new__(Piece), Piece.__new__(Piece)
        h.text, h.gmap = self.text[:start], self.gmap[:start]
        t.text, t.gmap = self.text[start:], self.gmap[start:]
        for p in (h, t):
            while p.text.startswith(" "):
                p.text, p.gmap = p.text[1:], p.gmap[1:]
            while p.text.endswith(" "):
                p.text, p.gmap = p.text[:-1], p.gmap[:-1]
        return h, t

    def glyphs(self):
        return [g for g in self.gmap if g is not None]


answers = []
cur = None
page_rules = {}
for i in range(answers_start - 1, past_start - 1):
    pdfp = i + 1
    page_rules[pdfp] = rules_of_page(i)
    for bbox, lines in page_blocks(i):
        if bbox[1] < H * 0.035:
            continue
        t = "\n".join(line_text(l) for l in lines).strip()
        if bbox[1] > H * 0.95 and re.fullmatch(r"\d{1,3}\s+(Solutions|Past exam papers)", re.sub(r"\s+", " ", t)):
            continue
        if re.fullmatch(r"\d{1,2}\n[A-Z][A-Za-z ]+", t) or t == "Solutions to exercises":
            continue
        m = re.match(r"^(?:End of chapter )?Exercise (\d+) " + DASH + r" (\d+):", t)
        if m:
            label = f"{m.group(1)}-{m.group(2)}"
            be = body_ex.get(label)
            max_q = max((int(re.match(r"\d+", sc["label"]).group()) for sc in be["shortcodes"]), default=99) if be else 99
            cur = {"label": label, "pdf_first": pdfp, "pdf_last": pdfp, "leaves": [], "max_q": max_q}
            answers.append(cur)
            continue
        if cur is None:
            continue
        cur["pdf_last"] = pdfp
        for gl in lines:
            piece = Piece(gl)
            if not piece.text:
                continue
            while piece.text:
                qn = cur["leaves"][-1]["q"] if cur["leaves"] else 0
                sub = cur["leaves"][-1]["sub"] if cur["leaves"] else None
                mq = re.match(r"^(\d{1,2})\.(?!\d)\s*(.*)$", piece.text)
                if mq and 1 <= int(mq.group(1)) - qn <= 15 and int(mq.group(1)) <= cur["max_q"]:
                    cur["leaves"].append({"q": int(mq.group(1)), "sub": None, "pieces": [], "pdf": pdfp})
                    _, piece = piece.cut(mq.start(2))
                    continue
                ms = re.match(r"^([a-z])\)\s*(.*)$", piece.text)
                if ms and cur["leaves"]:
                    lo = 0 if sub is None else LETTERS.index(sub) + 1
                    prev = " ".join(p.text for p in cur["leaves"][-1]["pieces"]).strip()
                    unfinished = prev.count("(") > prev.count(")") or re.search(r"[+\-−×=(]$", prev)
                    if ms.group(1) in LETTERS[lo:lo + 3] and not unfinished:
                        last = cur["leaves"][-1]
                        if last["sub"] is None and not last["pieces"]:
                            last["sub"] = ms.group(1)
                        else:
                            cur["leaves"].append({"q": qn, "sub": ms.group(1), "pieces": [], "pdf": pdfp})
                        _, piece = piece.cut(ms.start(2))
                        continue
                padded = " " + piece.text + " "
                mm = re.search(r"\s(\d{1,2})\.\s|\s([a-z])\)\s", padded)
                if mm and mm.start() > 0:
                    head, piece = piece.cut(mm.start())
                else:
                    head, piece = piece, Piece([])
                if cur["leaves"]:
                    cur["leaves"][-1]["pieces"].append(head)
                if head.text == "" and piece.text:
                    if cur["leaves"]:
                        cur["leaves"][-1]["pieces"].append(piece)
                    piece = Piece([])


# ------------------------------------------------------------------ layout -> LaTeX
SYM = {
    "−": "-", "×": r"\times ", "·": r"\cdot ", "±": r"\pm ", "∓": r"\mp ", "≤": r"\le ", "≥": r"\ge ",
    "∞": r"\infty ", "π": r"\pi ", "θ": r"\theta ", "α": r"\alpha ", "β": r"\beta ", "γ": r"\gamma ",
    "∈": r"\in ", "∉": r"\notin ", "∪": r"\cup ", "∩": r"\cap ", "△": r"\triangle ", "∥": r"\parallel ",
    "≡": r"\equiv ", "≈": r"\approx ", "∴": r"\therefore ", "|": "|", "{": r"\{", "}": r"\}", "%": r"\%",
    "°": r"^\circ ", "◦": r"^\circ ", "ˆ": r"\hat{}", "¯": r"\bar{}", "∠": r"\angle ", "⊥": r"\perp ",
    "′": "'", "λ": r"\lambda ", "φ": r"\phi ", "μ": r"\mu ", "σ": r"\sigma ", "Σ": r"\Sigma ", "∆": r"\Delta ",
    "Δ": r"\Delta ", "…": r"\ldots ", "→": r"\to ", "⇒": r"\Rightarrow ",
}
BB = {"R": r"\mathbb{R}", "N": r"\mathbb{N}", "Z": r"\mathbb{Z}", "Q": r"\mathbb{Q}", "C": r"\mathbb{C}"}


def is_text_font(g):
    return g["font"].startswith("URWClassico") or g["font"].startswith("LMSans")


def glyph_tex(g):
    c = g["c"]
    if g["font"].startswith("MSBM") and c in BB:
        return BB[c]
    if c in SYM:
        return SYM[c]
    return c


class Node:
    """kind: glyph | frac | sqrt | group; x0/x1/y0/y1 for layout; base = baseline y (for script detection)."""

    def __init__(self, kind, x0, x1, y0, y1, base, size, **kw):
        self.kind, self.x0, self.x1, self.y0, self.y1, self.base, self.size = kind, x0, x1, y0, y1, base, size
        self.__dict__.update(kw)


def gnode(g):
    return Node("glyph", g["x0"], g["x1"], g["y0"], g["y1"], g["oy"], g["size"], g=g)


def build(glyphs, rules):
    """Glyphs + rules in one region -> list of Nodes in reading order (rows top to bottom, then x)."""
    glyphs = [g for g in glyphs if not g["c"].isspace()]
    if not glyphs:
        return []
    xs0 = min(g["x0"] for g in glyphs) - 1
    xs1 = max(g["x1"] for g in glyphs) + 1
    ys0 = min(g["y0"] for g in glyphs) - 1
    ys1 = max(g["y1"] for g in glyphs) + 1
    rules = [r for r in rules if r["x1"] > xs0 and r["x0"] < xs1 and ys0 <= r["y"] <= ys1]
    used = set()
    nodes = []
    for r in sorted(rules, key=lambda r: -(r["x1"] - r["x0"])):
        if id(r) in used:
            continue
        # radical: a radical sign whose right edge meets the rule's left end, and whose top is near the rule
        # the radical sign's reference point is its top, where the vinculum starts (its bbox is font metrics)
        rad = [g for g in glyphs if id(g) not in used and g["c"] == "√" and abs(g["x1"] - r["x0"]) < 1.6
               and abs(g["oy"] - r["y"]) < 1.2]
        inside_all = [g for g in glyphs if id(g) not in used
                      and g["x0"] >= r["x0"] - 0.6 and g["x1"] <= r["x1"] + 0.6]
        inside = [g for g in inside_all if g["c"] != "√"]
        if rad:
            sign = rad[0]
            body = [g for g in inside_all if g is not sign and (g["y0"] + g["y1"]) / 2 > r["y"]
                    and g["y0"] < sign["y1"] - 0.5]
            # a root index (cube root): a small glyph above-left of the sign
            depth = sign["y1"] - sign["oy"]
            idx = [g for g in glyphs if id(g) not in used and g is not sign and g["c"].isdigit()
                   and g["size"] < sign["size"] - 0.5 and sign["x0"] - 1.5 <= (g["x0"] + g["x1"]) / 2 <= r["x0"]
                   and sign["oy"] - 0.5 <= g["oy"] <= sign["oy"] + 0.65 * depth]
            inner_rules = [q for q in rules if q is not r and id(q) not in used and q["y"] > r["y"] + 0.5
                           and q["x0"] >= r["x0"] - 0.5 and q["x1"] <= r["x1"] + 0.5]
            for q in inner_rules:
                used.add(id(q))
            for g in body + [sign] + idx:
                used.add(id(g))
            used.add(id(r))
            b = build(body, inner_rules)
            ys = [g["y1"] for g in body] or [sign["y1"]]
            base = max((g["oy"] for g in body), default=sign["y1"])
            nodes.append(Node("sqrt", sign["x0"], r["x1"], r["y"], max(ys + [sign["y1"]]), base,
                              max((g["size"] for g in body), default=sign["size"]), body=b,
                              index=build(idx, []) if idx else None))
            continue
        # a radical sign inside a numerator or denominator starts just left of its own vinculum, so for
        # stacking it is allowed to hang 7pt left of the bar
        stack = inside + [g for g in glyphs if id(g) not in used and g["c"] == "√"
                          and g["x0"] >= r["x0"] - 1.0 and g["x1"] <= r["x1"] + 0.6]
        num = [g for g in stack if (g["y0"] + g["y1"]) / 2 < r["y"] and r["y"] - g["y1"] < 9]
        den = [g for g in stack if (g["y0"] + g["y1"]) / 2 > r["y"] and g["y0"] - r["y"] < 9]
        if not num or not den:
            continue  # a stray rule (underline, number line)
        # keep only the glyphs vertically adjacent to the bar: stop at the first vertical gap
        num = trim_stack(num, r["y"], up=True)
        den = trim_stack(den, r["y"], up=False)
        if not num or not den:
            continue
        inner = [q for q in rules if q is not r and id(q) not in used and q["x0"] >= r["x0"] - 0.5
                 and q["x1"] <= r["x1"] + 0.5 and abs(q["y"] - r["y"]) < 12]
        nrules = [q for q in inner if q["y"] < r["y"]]
        drules = [q for q in inner if q["y"] > r["y"]]
        for q in inner:
            used.add(id(q))
        for g in num + den:
            used.add(id(g))
        used.add(id(r))
        # a fraction's "baseline" for script detection: the bar sits on the math axis, ~2.1pt above the
        # surrounding baseline at 7pt
        nodes.append(Node("frac", r["x0"], r["x1"], min(g["y0"] for g in num), max(g["y1"] for g in den),
                          r["y"] + 2.1, 7.0, num=build(num, nrules), den=build(den, drules)))
    rest = [g for g in glyphs if id(g) not in used]
    # recurring-decimal dots: "˙" above a digit
    dots = [g for g in rest if g["c"] == "˙"]
    rest = [g for g in rest if g["c"] != "˙"]
    for d in dots:
        cx = (d["x0"] + d["x1"]) / 2
        tgt = [g for g in rest if g["c"].isdigit() and g["x0"] - 1 <= cx <= g["x1"] + 1]
        if tgt:
            tgt[0]["dot"] = True
        else:
            rest.append(d)  # keep it, so the glyph check fails loudly
    # overbars (x-bar): "¯" above a letter
    bars = [g for g in rest if g["c"] == "¯"]
    rest = [g for g in rest if g["c"] != "¯"]
    for d in bars:
        cx = (d["x0"] + d["x1"]) / 2
        tgt = [g for g in rest if g["c"].isalpha() and g["x0"] - 1.5 <= cx <= g["x1"] + 1.5 and g is not d]
        if tgt:
            tgt[0]["bar"] = True
        else:
            rest.append(d)
    nodes += [gnode(g) for g in rest]
    return layout_rows(nodes)


def trim_stack(gs, ry, up):
    """The one line of glyphs sitting on one side of a bar: seeded by the glyphs touching the bar, grown by
    vertical overlap (superscripts overlap their base), never by a glyph larger than the seed (a wrapped row
    of the answer above or below is full size; an inline fraction's parts are script size)."""
    dist = (lambda g: ry - g["y1"]) if up else (lambda g: g["y0"] - ry)
    if not gs:
        return []
    d0 = min(dist(g) for g in gs)
    seed = [g for g in gs if dist(g) <= d0 + 1.2 and dist(g) < 3.0]
    if not seed:
        return []
    top = max(g["size"] for g in seed) + 0.1
    keep = list(seed)
    grown = True
    while grown:
        grown = False
        for g in gs:
            if g in keep or g["size"] > top:
                continue
            h = g["y1"] - g["y0"]
            if any(min(g["y1"], k["y1"]) - max(g["y0"], k["y0"]) > 0.4 * min(h, k["y1"] - k["y0"]) for k in keep):
                keep.append(g)
                grown = True
    return keep


def layout_rows(nodes):
    """Split into text rows by vertical centre, then order each row by x and attach scripts."""
    if not nodes:
        return []
    nodes = sorted(nodes, key=lambda n: (n.y0 + n.y1) / 2)
    rows, cur_row = [], [nodes[0]]
    for n in nodes[1:]:
        prev_c = sum((m.y0 + m.y1) / 2 for m in cur_row) / len(cur_row)
        if (n.y0 + n.y1) / 2 - prev_c > 5.5 and not overlaps_row(n, cur_row):
            rows.append(cur_row)
            cur_row = [n]
        else:
            cur_row.append(n)
    rows.append(cur_row)
    out = []
    for k, row in enumerate(rows):
        if k:
            out.append(Node("newline", 0, 0, 0, 0, 0, 0))
        out += scripts(sorted(row, key=lambda n: n.x0))
    return out


def overlaps_row(n, row):
    lo = min(m.y0 for m in row)
    hi = max(m.y1 for m in row)
    return n.y0 < hi - 1.0 and n.kind != "glyph"


def scripts(row):
    """Attach superscripts / subscripts by baseline offset from the row's main baseline."""
    glyph_bases = [n for n in row if n.kind == "glyph" and n.g["c"] not in "◦°" and not n.g["big"]]
    if glyph_bases:
        # the baseline is the leftmost full-size glyph's (a script never starts a row); a majority vote
        # fails on a^{14}, where the raised digits outnumber the base letter
        big = max(n.size for n in glyph_bases)
        base = min((n for n in glyph_bases if n.size >= big - 0.01), key=lambda n: n.x0).base
    else:
        base = sum(n.base for n in row) / len(row)
    out = []
    for n in row:
        if n.kind in ("frac",):
            out.append(n)
            continue
        off = n.base - base
        if n.kind == "glyph" and (n.g["c"] in "◦°" or n.g["big"]):
            out.append(n)  # a degree sign is its own superscript
            continue
        if off < -0.9 and out and out[-1].kind != "newline":
            attach(out, n, "sup")
        elif off > 0.9 and out and out[-1].kind != "newline" and n.kind == "glyph" and n.size < 6.5 + (0 if base else 0):
            attach(out, n, "sub")
        else:
            out.append(n)
    return out


def attach(out, n, which):
    prev = out[-1]
    # consecutive script glyphs join one script group
    if getattr(prev, "script_kind", None) == which and prev.x1 >= n.x0 - 1.8:
        prev.items.append(n)
        prev.x1 = n.x1
        return
    out.append(Node("script", n.x0, n.x1, n.y0, n.y1, n.base, n.size, script_kind=which, items=[n]))


def to_tex(nodes, text_mode=None):
    s = []
    for i, n in enumerate(nodes):
        if n.kind == "newline":
            s.append(" ")
        elif n.kind == "glyph":
            g = n.g
            prev_g = nodes[i - 1].g if i and nodes[i - 1].kind == "glyph" else None
            next_g = nodes[i + 1].g if i + 1 < len(nodes) and nodes[i + 1].kind == "glyph" else None
            numeric_punct = g["c"] in ",." and prev_g is not None and (prev_g["c"].isdigit() or prev_g["c"] == ".") \
                and (next_g is None or next_g["c"].isdigit() or next_g["c"] == "." or g["c"] == ".")
            if is_text_font(g) and (g["c"].isalpha() or g["c"] in ",.:;") and not numeric_punct:
                # text-font words: keep a space before a word that starts after a visible gap
                prev = nodes[i - 1] if i else None
                gap = prev is not None and prev.kind == "glyph" and n.x0 - prev.x1 > 1.2
                s.append(("\u0001" if gap else "") + "\u0002" + g["c"])
            else:
                t = glyph_tex(g)
                if g.get("dot"):
                    t = r"\dot{" + t + "}"
                if g.get("bar"):
                    t = r"\bar{" + t + "}"
                prev = nodes[i - 1] if i else None
                if prev is not None and prev.kind == "glyph" and is_text_font(prev.g) and prev.g["c"].isalpha():
                    s.append(" ")
                s.append(t)
        elif n.kind == "frac":
            s.append(r"\frac{" + to_tex(n.num) + "}{" + to_tex(n.den) + "}")
        elif n.kind == "sqrt":
            idx = ("[" + to_tex(n.index) + "]") if n.index else ""
            s.append(r"\sqrt" + idx + "{" + to_tex(n.body) + "}")
        elif n.kind == "script":
            inner = to_tex(n.items)
            s.append(("^{" if n.script_kind == "sup" else "_{") + inner + "}")
    raw = "".join(s)
    # wrap text-font letter runs in \text{}
    raw = re.sub(r"((?:\u0001?\u0002.)+)", lambda m: r"\text{" + m.group(1).replace("\u0001", " ").replace("\u0002", "") + "}", raw)
    raw = raw.replace("\u0001", " ").replace("\u0002", "")
    return raw


def flatten_glyphs(nodes):
    out = []
    for n in nodes:
        if n.kind == "glyph":
            out.append(n.g["c"])
            if n.g.get("dot"):
                out.append("˙")
            if n.g.get("bar"):
                out.append("¯")
        elif n.kind == "frac":
            out += flatten_glyphs(n.num) + flatten_glyphs(n.den)
        elif n.kind == "sqrt":
            out.append("√")
            out += flatten_glyphs(n.index or []) + flatten_glyphs(n.body)
        elif n.kind == "script":
            out += flatten_glyphs(n.items)
    return out


# ------------------------------------------------------------------ run
leaves_out = []
bad = 0
for a in answers:
    for lf in a["leaves"]:
        text = " ".join(p.text for p in lf["pieces"]).strip()
        glyphs = [g for p in lf["pieces"] for g in p.glyphs()]
        pages = {lf["pdf"]}
        nodes = build(glyphs, page_rules[lf["pdf"]])
        tex = re.sub(r"\s+", " ", to_tex(nodes)).strip()
        want = collections.Counter(c for c in text if not c.isspace())
        got = collections.Counter(c for c in flatten_glyphs(nodes) if not c.isspace())
        ok = want == got
        bad += not ok
        leaves_out.append({"exercise": a["label"], "q": lf["q"], "sub": lf["sub"], "pdf": lf["pdf"],
                           "text": text, "latex": tex, "glyph_check": ok,
                           "bbox": [min((g["x0"] for g in glyphs), default=0), min((g["y0"] for g in glyphs), default=0),
                                    max((g["x1"] for g in glyphs), default=0), max((g["y1"] for g in glyphs), default=0)]})

# agreement with the scout's own leaves
scout = [(a["label"], l["q"], l["sub"], re.sub(r"\s+", " ", l["text"]).strip()) for a in P["answers"] for l in a["leaves"]]
mine = [(l["exercise"], l["q"], l["sub"], l["text"]) for l in leaves_out]
same = sum(1 for x, y in zip(scout, mine) if x[:3] == y[:3])
same_text = sum(1 for x, y in zip(scout, mine) if x == y)
print(f"leaves: scout {len(scout)}, rebuilt {len(mine)}, same label {same}, same label+text {same_text}, glyph-check failures {bad}")
json.dump(leaves_out, open(OUT, "w"), ensure_ascii=False, indent=1)

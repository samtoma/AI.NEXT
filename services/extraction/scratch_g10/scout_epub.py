"""S0a scouting, EPUB side (Everything Maths Grade 10, CC-BY EPUB). Read-only, deterministic, stdlib only.

Scratch code, not the B2 adapter. Reads the unzipped EPUB (pass the OPS directory) and writes
<out>/epub_scan.json with, per spine file in reading order:
  sections        numbered h2 sections (div.section id=scEMAxx) and their sub-headings (h3/h4, scEMAxx)
  worked_examples h1 "Worked example N: title", question text, worksteps, maths and figure counts
  exercises       span.exerciseTitle "Exercise C.N", its questions (nested div.problemset) and entries
                  (div.entry = one problem + one solution), with maths / figure counts per part
  figures         every non-equation <img> with its context (body / we / exercise problem / solution ...)
  boxes           definitions, notes (by kind), videos / presentations (shortcode ids), activities,
                  teachers-guide blocks
  maths           math-inline / math-block <img> counts, and the unique equation hashes

Equation images are named md5(LaTeX source).png; see verify_hash_oracle.py.

Usage:  python3 scout_epub.py <epub OPS dir> <out_dir>
"""
import collections
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

OPS, OUT = sys.argv[1], sys.argv[2]
NS = "{http://www.w3.org/1999/xhtml}"


def local(tag):
    return tag.split("}")[-1]


def classes(el):
    return (el.get("class") or "").split()


def text_of(el, math_token=True):
    """Plain text; an equation image becomes ⟦hash⟧ so text can be compared around it."""
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


def imgs(el):
    eq_inline = eq_block = 0
    figs = []
    hashes = []
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


opf = open(os.path.join(OPS, "maths10-package.opf"), encoding="utf-8").read()
items = {}
for m in re.finditer(r"<item\b([^>]*)/?>", opf):
    a = m.group(1)
    i = re.search(r'\bid="([^"]+)"', a)
    h = re.search(r'href="([^"]+)"', a)
    if i and h:
        items[i.group(1)] = h.group(1)
spine = [items[s] for s in re.findall(r'<itemref idref="([^"]+)"', opf)]

files = []
all_hashes = collections.Counter()
for href in spine:
    path = os.path.join(OPS, href)
    fname = os.path.basename(href)
    rec = {"file": fname, "href": href, "sections": [], "subheadings": [], "worked_examples": [],
           "exercises": [], "figures": [], "boxes": collections.Counter(), "videos": [],
           "math_inline": 0, "math_block": 0, "text_paras": []}
    if not fname.endswith(".cnxmlplus.html"):
        files.append(rec)
        continue
    root = ET.parse(path).getroot()
    body = root.find(NS + "body")
    parent = {c: p for p in body.iter() for c in p}

    def ctx(el):
        """Innermost structural context of an element."""
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
            sol = [x for x in el if "solution" in classes(x)]
            im = imgs(el)
            rec["worked_examples"].append({
                "n": int(m.group(1)) if m else None, "title": m.group(2) if m else title,
                "question_text": text_of(q) if q is not None else "",
                "worksteps": len(steps), "has_solution_div": bool(sol),
                "step_titles": [text_of(s.find(NS + "h2"), math_token=False) for s in steps if s.find(NS + "h2") is not None],
                "math_inline": im["math_inline"], "math_block": im["math_block"], "figures": len(im["figures"]),
            })
        elif tag == "span" and "exerciseTitle" in c:
            outer = parent[el]
            label = (el.text or "").strip()
            m = re.match(r"^Exercise (\d+)\.(\d+)$", label)
            # an exercise's children are either nested div.problemset (a numbered question whose
            # div.entry children are its sub-parts) or bare div.entry (a question with no sub-parts)
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

            def leaf_entries(el):
                out = []
                for x in el:
                    if "entry" in classes(x):
                        out.append(entry_rec(x))
                    elif "problemset" in classes(x):
                        out.extend(leaf_entries(x))
                return out

            ex_header = next((x for x in outer if "header" in classes(x)), None)
            depth = 1
            # Exercise 5.1 continues after its titled problemset in untitled sibling problemsets and bare
            # entries, each of which is one question (see report). Fold them in; the titled block's own
            # entries are then question 1's sub-parts.
            sibs = list(parent[outer])
            k = sibs.index(outer) + 1
            cont = []
            while k < len(sibs) and ("entry" in classes(sibs[k]) or (
                    "problemset" in classes(sibs[k]) and not any("exerciseTitle" in classes(y) for y in sibs[k]))):
                cont.append(sibs[k])
                k += 1
            continuation = len(cont)
            if cont:
                q1 = ET.Element(NS + "div", {"class": "problemset"})
                for y in outer:
                    if "entry" in classes(y) or "header" in classes(y):
                        q1.append(y)
                members = [q1] + cont
            else:
                members = list(outer)
            for x in members:
                if "problemset" in classes(x):
                    header = next((y for y in x if "header" in classes(y)), None)
                    if any("problemset" in classes(y) for y in x):
                        depth = 3
                    else:
                        depth = max(depth, 2)
                    qrecs.append({"q": len(qrecs) + 1, "kind": "problemset",
                                  "header_text": text_of(header) if header is not None else "",
                                  "header_figures": len(imgs(header)["figures"]) if header is not None else 0,
                                  "entries": leaf_entries(x)})
                elif "entry" in classes(x):
                    qrecs.append({"q": len(qrecs) + 1, "kind": "entry", "header_text": "", "header_figures": 0,
                                  "entries": [entry_rec(x)]})
            rec["exercises"].append({"label": f"{m.group(1)}-{m.group(2)}" if m else label, "questions": qrecs,
                                     "exercise_header": text_of(ex_header) if ex_header is not None else "",
                                     "nesting_depth": depth, "untitled_continuations": continuation})
        elif tag == "img":
            src = el.get("src", "")
            if src.startswith("equation/"):
                all_hashes[os.path.basename(src)[:-4]] += 1
                if "math-block" in c:
                    rec["math_block"] += 1
                else:
                    rec["math_inline"] += 1
            else:
                rec["figures"].append({"src": src, "context": ctx(el)})
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
        elif tag == "p" and ctx(el) == "body":
            t = text_of(el)
            if len(t) > 120:
                rec["text_paras"].append(t)
    rec["boxes"] = dict(rec["boxes"])
    files.append(rec)

json.dump({"spine": spine, "files": files, "unique_equation_hashes": len(all_hashes),
           "equation_refs": sum(all_hashes.values()), "hash_counts": all_hashes},
          open(os.path.join(OUT, "epub_scan.json"), "w"), ensure_ascii=False, indent=1)
tot = collections.Counter()
for f in files:
    tot["sections"] += len(f["sections"])
    tot["subheadings"] += len(f["subheadings"])
    tot["worked_examples"] += len(f["worked_examples"])
    tot["exercises"] += len(f["exercises"])
    tot["questions"] += sum(len(e["questions"]) for e in f["exercises"])
    tot["entries"] += sum(len(q["entries"]) for e in f["exercises"] for q in e["questions"])
    tot["figures"] += len(f["figures"])
    tot["math_inline"] += f["math_inline"]
    tot["math_block"] += f["math_block"]
print(dict(tot), "unique eq", len(all_hashes))

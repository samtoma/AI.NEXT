"""S0, the lesson map (book-records/<book>/lessons.json): two methods, chosen by the book's type.

    uv run --with pymupdf book_record_lessons.py run     prep3-math-en [--contents 1-8] [--probes 5] [--cap 2]
    uv run book_record_lessons.py run     g10-math                     # an EPUB book: from Samuel's G0 manifest
    uv run book_record_lessons.py run     <book> --method scout|manifest   # override the choice
    uv run --with pymupdf book_record_lessons.py args    prep3-math-en …          # the embedded copy, for Claude Code
    uv run book_record_lessons.py accept  prep3-math-en runs/<book>/lesson-map/<saved return>.json
    uv run book_record_lessons.py approve prep3-math-en --by TD [--force]           # G0: the person's decision

THE METHOD (Tamer, 2026-10-17: both available, chosen by the book's type; `--method` overrides):
  manifest  a book whose config names an EPUB (ingest.route says "epub"): Samuel's own S0. build_manifest.py reads the
            EPUB's sections into the manifest and applies his G0 decisions (the book config's `lesson_unit`: splits,
            merges, promotions); it is deterministic and calls no model. This turns that manifest into the lesson map:
            one entry per manifest lesson (same id), a chapter per unit, the pages a chapter excludes with their reason
            (its opener; its summary and end-of-chapter exercises, which are S1 evidence), each lesson's mid-page start
            (so a boundary page two lessons share is not an error), and the offset of the book's PDF (`page_offsets`)
            for the page images the review tool shows. A manifest Samuel passed at G0 says so in the proposal.
  scout     every other book (page images): below.
Either way the result is a proposal, and `approve` is the person's gate.

Decided by Tamer, 2026-10-16: S0 is a scout that proposes and a person approves; nothing downstream reads a proposal.
The workflow (runbook/lesson-map.workflow.js) reads the first PDF pages twice, blind, for the printed units, lessons
and start pages, and a few body pages once each for their printed page number. `accept` (no model):
  - compares the two readings unit by unit and lesson by lesson (reference, title, start page); where they differ,
    the proposal carries reader A's value and a disagreement names both, for the person to settle;
  - takes the offset (PDF page = printed page + offset) from the probe pages, and reports any that disagree;
  - gives each lesson its end page: the page before the next lesson (or unit) starts. The book's last lesson ends on
    the last page and is flagged, since a contents page never prints where a lesson ends;
  - slugs are <prefix><unit position>-<lesson position>, the prefix the book config's first id prefix (u1-1 for the
    launch book, pp3u1-1 for prep3-parallel, so two courses from one book share no objective id); a unit review is <prefix><U>-r<n>;
  - when a lessons.json exists, lists every way the proposal differs from it (the check on a book already mapped).
It writes book-records/<book>/lessons.proposed.json (format `ainext.lesson-map/1`, status "proposed").
`approve` refuses while a disagreement is left (settle it in the proposal file, then delete the entry). An existing
lessons.json is never replaced: its approved lessons are kept as they are and only the proposal's new lessons are
added, and only with --force, and only when the offsets agree.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_config  # noqa: E402

FORMAT = "ainext.lesson-map/1"


def method_for(book: str) -> str:
    """The book's type picks the method: an EPUB has its own structure (Samuel's manifest); a page-image book has only
    its printed contents (the scout)."""
    import ingest  # noqa: PLC0415
    return "manifest" if ingest.route(book).get("route") == "epub" else "scout"


def from_manifest(book: str) -> dict:
    """Samuel's G0 manifest as the lesson map's proposal (no model)."""
    b = book_config.load_book(book)
    if not b.manifest:
        raise SystemExit(f"{book}: the config names no manifest: run Samuel's S0 first (source_adapter.py, then build_manifest.py)")
    mpath = book_config.REPO_ROOT / b.manifest
    if not mpath.exists():
        raise SystemExit(f"{mpath} not found: run Samuel's S0 first (source_adapter.py {book}, then build_manifest.py {book}; "
                         "they need the book's EPUB in docs/Source/)")
    m = json.loads(mpath.read_text())
    offs = [o.get("pdf_minus_printed") for o in (json.loads(b.path.read_text()).get("page_offsets") or []) if isinstance(o.get("pdf_minus_printed"), int)]
    lessons, excluded, dis = [], [], []
    for mod in m.get("modules") or []:
        module = f"Chapter {mod.get('chapter')} {mod.get('title')}".strip()
        for x in mod.get("excluded_pages") or []:
            if x.get("reason"):
                excluded.append({"pages": x["pages"], "reason": x["reason"]})
        for key, why in (("chapter_summary", "the chapter summary: S1 evidence, not a lesson"),
                         ("end_of_chapter_exercise", "the end-of-chapter exercise: S1's mappers place its items")):
            v = mod.get(key)
            if isinstance(v, dict) and v.get("printed_pages"):
                excluded.append({"pages": v["printed_pages"], "reason": why})
        for l in sorted(mod.get("lessons") or [], key=lambda x: x.get("order_in_module") or 0):
            bp = l.get("book_provenance") or {}
            secs = [s["number"] for s in bp.get("sections") or []] or [l.get("section")]
            part = bp.get("part")
            ref = "Section " + " + ".join(str(s) for s in secs if s) + (f", part {part['n']} of {part['of']}" if part else "")
            if not l.get("printed_pages"):
                dis.append({"where": f"{l['id']} pages", "A": None, "B": None, "why": "the manifest gives no printed pages"})
            lessons.append({"slug": l["id"], "syllabus_ref": ref, "title": l.get("part_title") or l.get("title"), "kind": "lesson",
                            "module": module, "pages": l.get("printed_pages"),
                            **({"starts_mid_page": True} if l.get("starts_mid_page") else {}),
                            **({"chapter_intro": True} if bp.get("chapter_intro") else {})})
    if len(set(offs)) != 1:
        dis.append({"where": "page_offset", "A": offs or None, "B": None,
                    "why": "the book config gives no single PDF offset (`page_offsets`): give it by hand"})
    gate = (m.get("lesson_unit") or {}).get("gate") if isinstance(m.get("lesson_unit"), dict) else None
    return {"page_offset": offs[0] if len(set(offs)) == 1 else None, "lessons": lessons, "excluded_pages": excluded,
            "disagreements": dis, "method": "manifest", "source": str(mpath.relative_to(book_config.REPO_ROOT)),
            "upstream_g0": gate or (m.get("status") if "G0 passed" in str(m.get("status")) else None)}


def mapdir(book: str) -> Path:
    return HERE / "book-records" / book


def build_args(book: str, contents: tuple[int, int], n_probes: int, model: str) -> dict:
    import pymupdf  # noqa: PLC0415
    import extract_book_record as X  # noqa: PLC0415  (render: a PDF page to an image)
    b = book_config.load_book(book)
    pdf = book_config.REPO_ROOT / b.sources.pdf
    n = len(pymupdf.open(pdf))
    img = HERE / "work" / book / "page-images" / "pdf"
    img.mkdir(parents=True, exist_ok=True)
    page = lambda p: {"pdf_page": p, "image": str(X.render(pdf, p, 0, img).resolve())}
    first, last = contents
    # just after the contents, so they share its numbering: a PDF of two terms restarts its page numbers at the second
    probes = sorted({min(n, last + k) for k in (3, 8, 14, 21, 29)[:n_probes]})
    return {"stage": "S0-lesson-map", "book": {"book": book, "title": b.title, "language": b.language},
            "contents": [page(p) for p in range(first, min(last, n) + 1)], "probes": [page(p) for p in probes],
            "pdf_pages": n, "options": {"model": model}}


def norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().casefold()


def numbers(s) -> str:
    """A printed reference by its numbers: "(1 - 1)", "1 - 1" and "Lesson 1-1" are the same reference."""
    return "-".join(re.findall(r"\d+", str(s or ""))) or norm(s)


def syllabus_ref(ref: str) -> str:
    n = re.findall(r"\d+", ref or "")
    return f"Lesson {n[0]}-{n[1]}" if len(n) == 2 else re.sub(r"^[(\[]\s*|\s*[)\]]$", "", (ref or "").strip())


def offset_of(probes: list[dict]) -> tuple[int | None, list[str]]:
    votes = [p["pdf_page"] - p["printed"] for p in probes if isinstance(p.get("printed"), int)]
    if not votes:
        return None, ["no probe page printed a page number: give page_offset by hand"]
    best = max(set(votes), key=votes.count)
    odd = [f"PDF page {p['pdf_page']} reads as printed {p['printed']} (offset {p['pdf_page'] - p['printed']})"
           for p in probes if isinstance(p.get("printed"), int) and p["pdf_page"] - p["printed"] != best]
    return best, odd


def lesson_prefix(book: str) -> str:
    """The book's first id prefix names its lessons (`u` → u1-1; prep3-parallel's `pp3u` → pp3u1-1), so two courses
    made from one book never share an objective id. A book that declares none is `u`."""
    try:   # the first as the config file writes it (the loaded config does not keep their order)
        return (json.loads(book_config.load_book(book).path.read_text()).get("id_prefixes") or ["u"])[0]
    except (Exception, SystemExit):  # noqa: BLE001  (a made-up book: the loader exits on an unknown one)
        return "u"


def compare(res: dict, first_unit: int = 1, openers: dict | None = None, prefix: str = "u") -> dict:
    """openers: {unit position: printed page} of each unit opener page the 'openers' pass confirmed."""
    openers = openers or {}
    A, B = (res["readings"].get("A") or {}), (res["readings"].get("B") or {})
    ua, ub = A.get("units") or [], B.get("units") or []
    dis, lessons = [], []
    if len(ua) != len(ub):
        dis.append({"where": "units", "A": [u["title"] for u in ua], "B": [u["title"] for u in ub],
                    "why": f"reader A found {len(ua)} unit(s), reader B {len(ub)}"})
    offset, odd = offset_of(res.get("probes") or [])
    for o in odd:
        dis.append({"where": "page_offset", "A": offset, "B": None, "why": o})
    for i, u in enumerate(ua):
        ui, v = first_unit + i, ub[i] if i < len(ub) else {}
        for k in ("number", "title", "start", "strand"):
            same = numbers(u.get(k)) == numbers(v.get(k)) if k == "number" else norm(u.get(k)) == norm(v.get(k))
            if not same:
                dis.append({"where": f"unit {ui} {k}", "A": u.get(k), "B": v.get(k)})
        la, lb = u.get("lessons") or [], v.get("lessons") or []
        if len(la) != len(lb):
            dis.append({"where": f"unit {ui} lessons", "A": [l["ref"] for l in la], "B": [l["ref"] for l in lb],
                        "why": f"reader A found {len(la)} lesson(s), reader B {len(lb)}"})
        n_l = n_r = 0
        for li, l in enumerate(la):
            m = lb[li] if li < len(lb) else {}
            if l.get("kind") == "review":
                n_r += 1
                slug = f"{prefix}{ui}-r{n_r}"
            else:
                n_l += 1
                slug = f"{prefix}{ui}-{n_l}"
            for k in ("ref", "title", "start"):
                if (numbers if k == "ref" else norm)(l.get(k)) != (numbers if k == "ref" else norm)(m.get(k)):
                    dis.append({"where": f"{slug} {k}", "A": l.get(k), "B": m.get(k)})
            module = f"Unit {numbers(u['number'])} {u['title']}".strip() + (f" ({u['strand']})" if u.get("strand") else "")
            lessons.append({"slug": slug, "syllabus_ref": syllabus_ref(l["ref"]), "title": l["title"], "kind": l.get("kind") or "lesson",
                            "module": module, "_start": l.get("start"), "_unit": ui,
                            "_unit_start": u.get("start"), **({"term": u["term"]} if u.get("term") else {})})
    last_printed = res["pdf_pages"] - offset if offset is not None else None
    for i, l in enumerate(lessons):
        nxt = lessons[i + 1] if i + 1 < len(lessons) else None
        ends = []
        if nxt and isinstance(nxt["_start"], int):
            ends.append(nxt["_start"] - 1)
        if nxt and nxt["module"] != l["module"] and isinstance(nxt["_unit_start"], int):
            ends.append(nxt["_unit_start"] - 1)
        if nxt and nxt["_unit"] != l["_unit"] and nxt["_unit"] in openers:
            ends.append(openers[nxt["_unit"]] - 1)   # a unit opener page the contents does not list
        end = min(ends) if ends else last_printed
        if not nxt:
            dis.append({"where": f"{l['slug']} end", "A": end, "B": None,
                        "why": "the book's last lesson: the contents does not print where it ends; check its last page"})
        if not isinstance(l["_start"], int) or not isinstance(end, int) or end < l["_start"]:
            dis.append({"where": f"{l['slug']} pages", "A": [l["_start"], end], "B": None, "why": "no usable page range"})
        l["pages"] = [l.pop("_start"), end]
        l.pop("_unit_start")
        l.pop("_unit")
    coverage = None
    if offset is not None and lessons and isinstance(lessons[-1]["pages"][0], int):
        first_pdf, last_pdf = lessons[0]["pages"][0] + offset, lessons[-1]["pages"][0] + offset
        coverage = {"pdf_pages": [first_pdf, last_pdf], "of": res["pdf_pages"]}
        if res["pdf_pages"] - last_pdf > 20:
            coverage["note"] = (f"these contents reach PDF page {last_pdf} (where its last lesson starts) of {res['pdf_pages']}: the rest "
                                "is another part (a second term?). Run S0 again with --contents on that part's contents pages "
                                f"and --first-unit {first_unit + len(ua)}; approve --force adds it under its own page_offset.")
    return {"page_offset": offset, "coverage": coverage, "lessons": lessons, "disagreements": dis,
            "contents_pages": {"A": A.get("contents_pages"), "B": B.get("contents_pages")},
            "reader_notes": {k: (r or {}).get("notes") for k, r in (("A", A), ("B", B)) if (r or {}).get("notes")}}


def against_existing(book: str, prop: dict) -> list[str]:
    f = mapdir(book) / "lessons.json"
    if not f.exists():
        return []
    old = json.loads(f.read_text())
    out = [] if old.get("page_offset") == prop["page_offset"] else [f"page_offset: approved {old.get('page_offset')}, proposed {prop['page_offset']}"]
    new = {l["slug"]: l for l in prop["lessons"]}
    for l in old["lessons"]:
        p = new.get(l["slug"])
        if not p:
            out.append(f"{l['slug']}: approved, not in the proposal")
            continue
        for k in ("syllabus_ref", "title", "module", "pages"):
            if norm(l.get(k)) != norm(p.get(k)):
                out.append(f"{l['slug']} {k}: approved {l.get(k)!r}, proposed {p.get(k)!r}")
    return out


def opener_candidates(res: dict, prefix: str = "u") -> list[dict]:
    """The page before each later unit's first lesson, as the contents put it: maybe that unit's opener."""
    c = compare(res, int(res.get("first_unit") or 1), prefix=prefix)
    out, seen = [], set()
    for l in c["lessons"]:
        unit = int(l["slug"][len(prefix):].split("-")[0])
        if unit in seen or unit == int(res.get("first_unit") or 1) or not isinstance(l["pages"][0], int):
            seen.add(unit)
            continue
        seen.add(unit)
        out.append({"unit": unit, "unit_title": l["module"], "printed": l["pages"][0] - 1})
    return out


def write_proposal(book: str, c: dict, made_by: str, extra: dict) -> dict:
    prop = {"format": FORMAT, "book": book, "status": "proposed",
            "note": "Proposed by S0 (book_record_lessons.py). PDF page = printed page + page_offset. "
                    "Settle each disagreement, delete it, then approve.",
            "page_offset": c["page_offset"], "lessons": c["lessons"], "disagreements": c["disagreements"],
            **{k: v for k, v in c.items() if k in ("coverage", "contents_pages", "reader_notes", "excluded_pages", "method", "source", "upstream_g0")},
            "made": date.today().isoformat(), "made_by": made_by, **extra}
    prop["differs_from_approved"] = against_existing(book, prop)
    out = mapdir(book) / "lessons.proposed.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(prop, ensure_ascii=False, indent=1) + "\n")
    return prop


def accept(book: str, run_file: Path, openers_file: Path | None = None) -> dict:
    res = json.loads(run_file.read_text())
    if res.get("stage") != "S0-lesson-map" or res.get("mode") == "openers":
        raise SystemExit(f"{run_file} is not a lesson-map contents return")
    op = json.loads(openers_file.read_text())["openers"] if openers_file else []
    c = compare(res, int(res.get("first_unit") or 1), {o["unit"]: o["printed"] for o in op if o.get("opener")}, lesson_prefix(book))
    return write_proposal(book, {**c, "method": "scout"}, f"book_record_lessons.py accept ({res.get('prompts_version')})", {
        "source_run": str(run_file.relative_to(HERE)) if run_file.is_relative_to(HERE) else str(run_file),
        "unit_openers": [{"unit": o["unit"], "printed": o["printed"], "opener": o.get("opener")} for o in op]})


def approve(book: str, by: str, force: bool) -> dict:
    pf, af = mapdir(book) / "lessons.proposed.json", mapdir(book) / "lessons.json"
    prop = json.loads(pf.read_text())
    if prop.get("disagreements"):
        raise SystemExit(f"{len(prop['disagreements'])} disagreement(s) left in {pf.name}: settle each and delete it first")
    keep = lambda l: {k: l[k] for k in ("slug", "syllabus_ref", "title", "module", "pages", "kind", "term", "starts_mid_page", "chapter_intro") if k in l}
    stamp = date.today().isoformat()
    if af.exists():
        old = json.loads(af.read_text())
        if not force:
            raise SystemExit(f"{af.name} exists: --force adds only the proposal's new lessons and keeps the approved ones")
        have = {l["slug"] for l in old["lessons"]}
        added = [keep(l) for l in prop["lessons"] if l["slug"] not in have]
        if old.get("page_offset") != prop["page_offset"]:   # another part under its own numbering (a second term)
            added = [l | {"page_offset": prop["page_offset"]} for l in added]
        old["lessons"] += added
        old.setdefault("history", []).append(f"{stamp}: {len(added)} lesson(s) added from S0's proposal, approved by {by}")
        doc = old
    else:
        added = [keep(l) for l in prop["lessons"]]
        doc = {"format": FORMAT, "book": book, "note": prop["note"].split(" Settle")[0], "page_offset": prop["page_offset"],
               "lessons": added, **({"excluded_pages": prop["excluded_pages"]} if prop.get("excluded_pages") else {}),
               **({"method": prop["method"], "source": prop.get("source")} if prop.get("method") else {}),
               "approved_by": by, "approved_at": stamp,
               "history": [f"{stamp}: approved from S0's proposal by {by}"]}
    af.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    titled = record_titles(book, doc["lessons"])
    return {"added": [l["slug"] for l in added], "lessons": len(doc["lessons"]), "titles_recorded": titled}


def record_titles(book: str, lessons: list[dict]) -> int:
    """The approved lessons' printed titles into the book config's `lesson_titles`, where the loader reads a lesson's
    title (load_seed.py); a title already there is kept. Only that one key of the file is rewritten."""
    import re  # noqa: PLC0415
    try:
        path = book_config.load_book(book).path
    except (Exception, SystemExit):  # noqa: BLE001  (a made-up book)
        return 0
    text = path.read_text()
    cfg = json.loads(text)
    titles = dict(cfg.get("lesson_titles") or {})
    new = {l["slug"]: l["title"] for l in lessons if l.get("title") and l["slug"] not in titles}
    if not new:
        return 0
    titles.update(new)
    block = json.dumps(titles, ensure_ascii=False, indent=2).replace("\n", "\n  ")
    text, n = re.subn(r'"lesson_titles": \{[^}]*\}', lambda m: f'"lesson_titles": {block}', text, count=1)
    if n:
        path.write_text(text)
    return len(new) if n else 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("run", "args"):
        s = sub.add_parser(name)
        s.add_argument("book")
        s.add_argument("--contents", default="1-8", help="the PDF pages that hold the contents (default 1-8)")
        s.add_argument("--probes", type=int, default=5)
        s.add_argument("--first-unit", type=int, default=1, help="the position of these contents' first unit (a second part continues the count)")
        s.add_argument("--model", default="sonnet")
        s.add_argument("--cap", type=float, default=2.0)
        s.add_argument("--method", choices=("scout", "manifest"), help="default: chosen by the book's type")
    c = sub.add_parser("accept")
    c.add_argument("book")
    c.add_argument("run_file", type=Path)
    c.add_argument("--openers", type=Path, help="the saved return of the 'openers' pass")
    p = sub.add_parser("approve")
    p.add_argument("book")
    p.add_argument("--by", required=True)
    p.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "accept":
        prop = accept(a.book, a.run_file.resolve(), a.openers.resolve() if a.openers else None)
    elif a.cmd == "approve":
        print(json.dumps(approve(a.book, a.by, a.force), indent=1))
        return 0
    elif (a.method or method_for(a.book)) == "manifest":
        if a.cmd == "args":
            raise SystemExit("the manifest method calls no model: there is no workflow copy to make; use run")
        c = from_manifest(a.book)
        prop = write_proposal(a.book, c, "book_record_lessons.py run (method: manifest)", {})
        print(f"method: manifest ({c['source']}){'; G0 passed upstream: ' + str(c['upstream_g0'].get('by') if isinstance(c['upstream_g0'], dict) else c['upstream_g0']) if c['upstream_g0'] else ''}",
              file=sys.stderr)
    else:
        import embed_workflow as EW  # noqa: PLC0415
        import workflow_runner as WR  # noqa: PLC0415
        first, last = (int(x) for x in a.contents.split("-"))
        args = build_args(a.book, (first, last), a.probes, a.model) | {"first_unit": a.first_unit}
        copy = EW.default_out(a.book, "lesson-map", f"s0.contents{first}-{last}")
        print(EW.summary(EW.write(HERE / "runbook" / "lesson-map.workflow.js", args, copy)), file=sys.stderr)
        if a.cmd == "args":
            return 0
        img = HERE / "work" / a.book / "page-images" / "pdf"
        run_file, res, cost = WR.run_copy(copy, [img], a.cap, "s0", a.book, "lesson-map", stage="S0")
        openers_file = None
        offset, _odd = offset_of(res.get("probes") or [])
        cands = opener_candidates(res, lesson_prefix(a.book)) if offset is not None else []
        if cands:   # the second pass: is the page before each later unit's first lesson its opener?
            import pymupdf  # noqa: PLC0415
            import extract_book_record as X  # noqa: PLC0415
            pdf = book_config.REPO_ROOT / book_config.load_book(a.book).sources.pdf
            for o in cands:
                o["image"] = str(X.render(pdf, o["printed"] + offset, 0, img).resolve())
            ocopy = EW.default_out(a.book, "lesson-map", f"s0-openers.contents{first}-{last}")
            EW.write(HERE / "runbook" / "lesson-map.workflow.js", {"stage": "S0-lesson-map", "mode": "openers", "openers": cands}, ocopy)
            openers_file, _r, _c = WR.run_copy(ocopy, [img], max(0.5, a.cap - cost), "s0-openers", a.book, "lesson-map", stage="S0")
        prop = accept(a.book, run_file, openers_file)
    print(f"{len(prop['lessons'])} lesson(s), offset {prop['page_offset']}, {len(prop['disagreements'])} disagreement(s) "
          f"→ book-records/{a.book}/lessons.proposed.json", file=sys.stderr)
    for d in prop["disagreements"]:
        print(f"  ? {d['where']}: A {d['A']!r} · B {d['B']!r}{' — ' + d['why'] if d.get('why') else ''}", file=sys.stderr)
    for d in prop["differs_from_approved"]:
        print(f"  ≠ {d}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

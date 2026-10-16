"""The review tool's Generated content task: everything the pipeline wrote, every item reviewed.

Read from the files each book config names (`books/<book>.json` → `generated`): generated questions, widget
questions (and each widget's predicate → misconception mappings), and the misconception catalogue. Each item is
shown beside what it was made from in the book: a question's parent book question (`parent_question_id`), a
misconception's mapped book questions (`maps`), and the objective either one teaches.

Figures: every figure S4 redrew for a PDF book (book_record_figures.py accept → teaching/<book>/visuals/<slug>.json,
format `ainext.teaching-visuals/1`), one item per book-record figure: a drawing (kind, spec, caption, what it
withholds) or a gap (why S4 could not draw it, and the kind it needs), shown beside the book's own crop of the figure
(crop_figures.py: work/<book>/figures/) and the prompt it belongs to. compile_book_records.py reads these decisions:
a rejected drawing, or one a fix was asked for, is not shown, and its question gets the book's picture instead.

Decisions are appended to `services/extraction/reviews/<book>/generated-content.json`
(format `ainext.generated-review/1`): approve, fix requested (with a note and a correction), or reject. Each
decision carries the item's fingerprint, so an item that changes after it was decided comes back for review
(a figure S4 redraws included; S4's run record, `made`, is not part of a figure's fingerprint).
The admin console's own backlog is untouched; nothing here changes what students see until a pipeline step
reads these decisions. Standard library only.
"""
import hashlib
import json
import os
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlencode

EXTRACTION = Path(__file__).resolve().parents[2]
REPO = EXTRACTION.parents[1]
REVIEWS = EXTRACTION / "reviews"
TEACHING = EXTRACTION / "teaching"
NAME = re.compile(r"^[a-z0-9][a-z0-9.-]{0,63}$")
FIGURE_ID = re.compile(r"^[a-z0-9][a-z0-9.-]{0,63}:[a-z0-9][a-z0-9.-]{0,63}$")
KINDS = ("question", "widget", "mapping", "misconception", "figure")
KIND_LABEL = {"question": "Generated question", "widget": "Widget question", "mapping": "Widget mapping", "misconception": "Misconception",
              "figure": "Figure"}
DECISIONS = {"approve", "fix_requested", "reject"}
SKIP_IN_PRINT = {"status", "reviewed_at", "reviewed_by", "ai_checked_at", "ai_checked_by"}
SKIP_IN_FIGURE = SKIP_IN_PRINT | {"made"}   # S4's run record: the same drawing from a later run is the same drawing

_cache: dict[str, tuple[tuple, dict]] = {}


def _visual_files(book: str) -> list[Path]:
    return sorted((TEACHING / book / "visuals").glob("*.json")) if NAME.match(book) else []


def books() -> list[str]:
    out = []
    for p in sorted((EXTRACTION / "books").glob("*.json")):
        try:
            if json.loads(p.read_text()).get("generated") or _visual_files(p.stem):
                out.append(p.stem)
        except (OSError, ValueError):
            continue
    return out


def _config(book: str) -> dict:
    if not NAME.match(book):
        raise FileNotFoundError(book)
    return json.loads((EXTRACTION / "books" / f"{book}.json").read_text())


def _paths(book: str, cfg: dict) -> dict[str, list[Path]]:
    g = cfg.get("generated") or {}
    as_list = lambda v: v if isinstance(v, list) else [v] if v else []
    # book-record lessons' own S5–S7 output (book_record_generation.py → teaching/<book>/generated/), and the compiled
    # bundles their parent book questions live in; a missing file is skipped by every reader
    tg = TEACHING / book / "generated"
    compiled = sorted((EXTRACTION / "compiled" / book).glob("*.json")) if NAME.match(book) else []
    return {"questions": [REPO / p for p in as_list(g.get("questions"))]
                         + [tg / "generated-questions.json", tg / "widget-questions.json"],
            "misconceptions": [REPO / p for p in as_list(g.get("misconceptions"))] + [tg / "misconceptions.json"],
            "bundles": [REPO / p for p in cfg.get("bundles") or []]
                       + [c for c in compiled if c.name not in ("generated-questions.json", "widget-questions.json",
                                                                 "misconceptions.json", "compile-report.json", "review-stamps.json")],
            "visuals": _visual_files(book)}


def lesson_of(lo: str) -> str:
    return re.sub(r"-\d+$", "", str(lo or "").removeprefix("lo:")) or "?"


def fingerprint(item: dict, kind: str | None = None) -> str:
    skip = SKIP_IN_FIGURE if kind == "figure" else SKIP_IN_PRINT
    content = {k: v for k, v in item.items() if k not in skip}
    return hashlib.md5(json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def figure_item(lesson: str, row: dict, drawn: bool) -> dict:
    """One S4 figure as the review tool shows it and a decision signs it: a `visuals[]` row (drawn) or a `gaps[]` row
    of a teaching-visuals file, keyed by its book-record figure id."""
    return {"id": row["figure"], "lesson": lesson, "drawn": drawn, **row}


def figure_items(doc: dict) -> list[dict]:
    lesson = doc.get("lesson") or "?"
    return [figure_item(lesson, r, True) for r in doc.get("visuals") or []] + [figure_item(lesson, r, False) for r in doc.get("gaps") or []]


def figure_decisions(book: str, doc: dict) -> dict[str, dict]:
    """figure id → the latest decision on that figure AS THE TEACHING-VISUALS FILE `doc` HOLDS IT NOW: a decision made on
    an earlier drawing or gap (another fingerprint) does not count. For compile_book_records.py."""
    dec = latest_decisions(book)
    out = {}
    for it in figure_items(doc):
        d = dec.get(("figure", it["id"]))
        if d and d.get("fingerprint") == fingerprint(it, "figure"):
            out[it["id"]] = d
    return out


def crop_path(book: str, figure: str) -> Path:
    """The book's own picture of a figure (crop_figures.py: work/<book>/figures/<id, ':' as '__'>.png)."""
    if not NAME.match(book) or not FIGURE_ID.match(figure):
        raise FileNotFoundError(figure)
    p = EXTRACTION / "work" / book / "figures" / (figure.replace(":", "__") + ".png")
    if not p.is_file():
        raise FileNotFoundError(f"no crop for {figure} (crop_figures.py run {book} {figure.split(':')[0]})")
    return p


def _offset_for(cfg: dict, book: str):
    """printed page → PDF page, from the book config's regimes; a regime with no recorded offset falls back to
    the ground truth's page_offset for that book (Prep-3 Term 1)."""
    gt_off = None
    for p in (EXTRACTION / "groundtruth" / book).rglob("*.json"):
        try:
            d = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        if d.get("schema") == "book-record" and isinstance((d.get("source_document") or {}).get("page_offset"), int):
            gt_off = d["source_document"]["page_offset"]
            break
    regimes = cfg.get("page_offsets") or []

    def pdf_page(printed, term=None):
        """`term` names the regime when printed numbers restart in one PDF (Prep-3's two terms)."""
        if not isinstance(printed, int):
            return None
        pick = [r for r in regimes if term and term.lower() in str(r.get("label", "")).lower()] or regimes
        for r in pick:
            off = r.get("pdf_minus_printed")
            if off is None:
                if len(pick) == 1 or term:
                    return printed + gt_off if gt_off is not None else None
                continue
            if r.get("pdf_from", 0) <= printed + off <= r.get("pdf_to", 10 ** 6):
                return printed + off
        return printed + gt_off if gt_off is not None else None
    return pdf_page


def _term(path: Path, bundle: dict) -> str | None:
    """Which term a Prep-3 bundle prints in: its title says, or its file name does (t2-*, geo-* are the Second Term book)."""
    title = str((bundle.get("source_document") or {}).get("title") or "")
    for t in ("First Term", "Second Term"):
        if t.lower() in title.lower():
            return t
    return "Second Term" if path.name.startswith(("t2-", "geo-")) else None


def load(book: str) -> dict:
    cfg = _config(book)
    paths = _paths(book, cfg)
    stamp = tuple((str(p), p.stat().st_mtime) for ps in paths.values() for p in ps if p.exists())
    hit = _cache.get(book)
    if hit and hit[0] == stamp:
        return hit[1]
    items: dict[tuple[str, str], dict] = {}
    for p in paths["questions"]:
        if not p.exists():
            continue
        for q in json.loads(p.read_text()).get("questions") or []:
            kind = "widget" if q.get("question_type") == "widget" else "question"
            items[(kind, q["id"])] = q
            if kind == "widget":
                for dg in (q.get("choices") or {}).get("diagnostics") or []:
                    ref = f"{q['id']}#{dg.get('predicate')}"
                    items[("mapping", ref)] = {"id": ref, "widget_id": q["id"], "lo_id": q.get("lo_id"), **dg}
    catalogue = {}
    for p in paths["misconceptions"]:
        if p.exists():
            for m in json.loads(p.read_text()).get("misconceptions") or []:
                catalogue[m["id"]] = m
                items[("misconception", m["id"])] = m
    figure_source = {}   # lesson → the book record its figures were drawn from
    for p in paths["visuals"]:
        d = json.loads(p.read_text())
        figure_source[d.get("lesson") or p.stem] = d.get("source")
        for it in figure_items(d):
            items[("figure", it["id"])] = it
    book_q, los, term, lesson_order = {}, {}, {}, {}  # lessons in the book's order: the bundles' order
    for p in paths["bundles"]:
        if not p.exists():
            continue
        d = json.loads(p.read_text())
        t = _term(p, d)
        for q in d.get("questions") or []:
            book_q[q["id"]] = q
            term[q["id"]] = t
        for n in d.get("nodes") or []:
            if n.get("kind") == "learning_objective":
                los[n["id"]] = n
                term[n["id"]] = t
                lesson_order.setdefault(lesson_of(n["id"]), len(lesson_order))
    data = {"cfg": cfg, "items": items, "catalogue": catalogue, "book_q": book_q, "los": los, "term": term, "lesson_order": lesson_order,
            "figure_source": figure_source, "pdf": (cfg.get("sources") or {}).get("pdf"), "pdf_page": _offset_for(cfg, book)}
    _cache[book] = (stamp, data)
    return data


def decisions_path(book: str) -> Path:
    if not NAME.match(book):
        raise ValueError(f"bad book {book!r}")
    return REVIEWS / book / "generated-content.json"


def latest_decisions(book: str) -> dict[tuple[str, str], dict]:
    p = decisions_path(book)
    out = {}
    if p.exists():
        for d in json.loads(p.read_text()).get("decisions") or []:
            out[(d["kind"], d["ref"])] = d
    return out


def _title(kind: str, it: dict) -> str:
    if kind == "misconception":
        return it.get("label") or it["id"]
    if kind == "mapping":
        return f"{it.get('predicate')} → {str(it.get('misconception_id', '')).split(':')[-1]}"
    if kind == "figure":
        local = it["id"].split(":", 1)[-1]
        if not it["drawn"]:
            return f"{local} · not drawn: {it.get('needed_kind') or 'the drawing failed its check'}"[:90]
        return f"{local} · {it.get('kind')} · {it.get('caption') or ''}"[:90]
    return re.sub(r"\s+", " ", re.sub(r"\$|\\[a-z]+|[{}*]", "", str(it.get("stem") or "")))[:90]


def summary(book: str) -> list[dict]:
    data = load(book)
    dec = latest_decisions(book)
    out = []
    for (kind, ref), it in data["items"].items():
        d = dec.get((kind, ref))
        state = "open" if not d else ("changed" if d.get("fingerprint") != fingerprint(it, kind) else d["decision"])
        out.append({"kind": kind, "ref": ref, "lesson": it["lesson"] if kind == "figure" else lesson_of(it.get("lo_id")),
                    "title": _title(kind, it), "status": it.get("status"), "state": state,
                    **({"drawn": it["drawn"]} if kind == "figure" else {})})
    order = {k: i for i, k in enumerate(KINDS)}
    nat = lambda s: [(0, int(x)) if x.isdigit() else (1, x) for x in re.split(r"(\d+)", s) if x]
    lo_ord = data["lesson_order"]
    return sorted(out, key=lambda r: (order[r["kind"]], lo_ord.get(r["lesson"], 10 ** 6), nat(r["lesson"]), nat(r["ref"])))


def _ids(v) -> list[str]:
    return [v] if isinstance(v, str) else list(v or [])


def _prompt(it: dict) -> dict:
    return {"id": it["id"], "type": it.get("type"), "quote": it.get("quote"), "text": it.get("text") or it.get("stem"),
            "parts": [{"label": p.get("label"), "stem": p.get("stem") or p.get("text")} for p in it.get("parts") or []],
            "source_page": it.get("source_page")}


def figure_detail(book: str, data: dict, it: dict) -> dict:
    """A figure beside what it was drawn from: the book record's figure (caption, quote, region), the book's crop of it,
    the prompts it belongs to (printed inside, `belongs_to`, or needing it, `uses_figure`) and its objective."""
    src = data["figure_source"].get(it["lesson"]) or f"book-records/{book}/{it['lesson']}.json"
    p = EXTRACTION / src
    record = json.loads(p.read_text()) if p.is_file() else {}
    items = {r["id"]: r for r in record.get("items") or []}
    fig = items.get(it["id"]) or {}
    users = [items[fig["belongs_to"]]] if fig.get("belongs_to") in items else []
    users += [r for r in items.values() if it["id"] in _ids(r.get("uses_figure")) and r not in users]
    answer_of = [r["id"] for r in items.values() for h in [r, *(r.get("parts") or [])] if it["id"] in _ids(h.get("answer_figure"))]
    slug = it["lesson"]
    lo_of = lambda oid: f"lo:{slug}-{int(str(oid).rsplit('-', 1)[1])}"
    objs = record.get("learning_objectives") or []
    # the record's own filing first, as compile_book_records.py files the figure; S4's guess only when it has none
    obj = next((o for o in objs if o["id"] == fig.get("lo")), None) or next((o for o in objs if it.get("lo") and lo_of(o["id"]) == it["lo"]), None)
    s4_obj = next((o for o in objs if it.get("lo") and lo_of(o["id"]) == it["lo"]), None)
    page = it.get("page") or fig.get("source_page")
    off = (record.get("source_document") or {}).get("page_offset")
    try:
        crop = crop_path(book, it["id"])
    except FileNotFoundError:
        crop = None
    dec = latest_decisions(book).get(("figure", it["id"]))
    fp = fingerprint(it, "figure")
    return {"kind": "figure", "ref": it["id"], "item": it, "book_items": [],
            "objective": {"label": obj["label"], "description": obj.get("description"), "id": obj["id"]} if obj else None,
            "s4_objective": {"label": s4_obj["label"], "id": s4_obj["id"]} if s4_obj and s4_obj is not obj else None,
            "figure_record": {k: fig.get(k) for k in ("caption", "quote", "notes", "source_page", "region", "belongs_to", "uses_figure")} if fig else None,
            "users": [_prompt(r) for r in users], "answer_of": answer_of, "for_item": items.get(it.get("for_item")) and _prompt(items[it["for_item"]]),
            "crop": f"/api/generated/crop?{urlencode({'book': book, 'figure': it['id']})}" if crop else None,
            "crop_checked": bool(crop and (fig.get("region") or {}).get("checked")),
            "source": src, "printed_page": page,
            "pdf_page": page + off if isinstance(page, int) and isinstance(off, int) else data["pdf_page"](page, None),
            "pdf": (record.get("source_document") or {}).get("file_path") or data["pdf"],
            "fingerprint": fp, "decision": dec, "changed": bool(dec and dec.get("fingerprint") != fp)}


def detail(book: str, kind: str, ref: str) -> dict:
    data = load(book)
    it = data["items"].get((kind, ref))
    if it is None:
        raise FileNotFoundError(f"{kind} {ref}")
    if kind == "figure":
        return figure_detail(book, data, it)
    lo = data["los"].get(it.get("lo_id"))
    sources = []  # the book items it was made from
    if kind in ("question", "widget") and it.get("parent_question_id"):
        sources.append(it["parent_question_id"])
    if kind == "mapping":
        w = data["items"].get(("widget", it["widget_id"]), {})
        if w.get("parent_question_id"):
            sources.append(w["parent_question_id"])
    if kind == "misconception":
        sources += [m.get("question_id") for m in it.get("maps") or [] if m.get("question_id")]
    book_items = []
    for qid in dict.fromkeys(sources):
        q = data["book_q"].get(qid)
        if q:
            book_items.append({"id": qid, "stem": q.get("stem"), "answer": q.get("answer"), "solution": q.get("solution"),
                               "source_page": q.get("source_page"), "source": q.get("source"),
                               "solution_provenance": q.get("solution_provenance"),
                               "choice_text": next((m.get("choice_text") for m in it.get("maps") or [] if m.get("question_id") == qid), None)})
        else:
            book_items.append({"id": qid, "missing": True})
    first = next((b for b in book_items if b.get("source_page")), None)
    page = (first or {}).get("source_page") or it.get("source_page") or (lo or {}).get("source_page")
    term = data["term"].get((first or {}).get("id")) or data["term"].get(it.get("lo_id"))
    extra = {}
    if kind == "mapping":
        extra["widget"] = data["items"].get(("widget", it["widget_id"]))
        extra["misconception"] = data["catalogue"].get(it.get("misconception_id"))
    if kind in ("question", "widget"):
        tags = {c.get("misconception_id") for c in it.get("choices") or [] if isinstance(c, dict)} if isinstance(it.get("choices"), list) else \
            {dg.get("misconception_id") for dg in (it.get("choices") or {}).get("diagnostics") or []}
        extra["misconceptions"] = {t: {"label": data["catalogue"][t].get("label")} for t in tags if t and t in data["catalogue"]}
    dec = latest_decisions(book).get((kind, ref))
    return {"kind": kind, "ref": ref, "item": it, "objective": lo, "book_items": book_items, "extra": extra,
            "printed_page": page, "pdf_page": data["pdf_page"](page, term), "pdf": data["pdf"],
            "fingerprint": fingerprint(it), "decision": dec,
            "changed": bool(dec and dec.get("fingerprint") != fingerprint(it))}


def decide(body: dict) -> dict:
    book, kind, ref = body.get("book"), body.get("kind"), body.get("ref")
    decision, by = body.get("decision"), (body.get("by") or "").strip()
    if kind not in KINDS or decision not in DECISIONS or not ref or not by:
        raise ValueError("needs book, kind, ref, a decision (approve, fix_requested, reject) and your initials")
    it = load(book)["items"].get((kind, ref))
    if it is None:
        raise ValueError(f"no {kind} {ref} in {book}")
    note, correction = (body.get("note") or "").strip(), (body.get("correction") or "").strip()
    if decision == "fix_requested" and not note:
        raise ValueError("say what needs fixing")
    entry = {"kind": kind, "ref": ref, "decision": decision, "by": by, "at": date.today().isoformat(), "fingerprint": fingerprint(it, kind)}
    if note:
        entry["note"] = note
    if correction:
        entry["correction"] = correction
    p = decisions_path(book)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(p.read_text()) if p.exists() else {"format": "ainext.generated-review/1", "book": book, "decisions": []}
    data["decisions"].append(entry)  # append-only: a changed mind is a new entry
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, p)
    return entry

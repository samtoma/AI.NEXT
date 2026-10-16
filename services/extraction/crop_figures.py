"""Crop every figure of a PDF book's book records into its own image file, for S4 and the book-picture stand-ins.

    uv run --with pymupdf --with pillow --with jsonschema crop_figures.py run prep3-math-en u1-1 u1-2 [--cap 3] [--force]
    uv run --with pymupdf --with pillow --with jsonschema crop_figures.py run prep3-math-en --all

Run from services/extraction/. Only for a book whose config has a PDF and no EPUB: an EPUB ships each figure
as its own image file (source_adapter.py writes them to work/<book>/figures/), so S4 and the stand-ins read
those and need no crop. A PDF has no figure files: the Prep-3 book's pages are built from dozens of small image
tiles and hundreds of vector paths, and no PDF Form XObject marks a figure (extraction-pipeline.md §3.7 planned
on one).

HOW.
  1. Locate: one call per page that has figures (Sonnet, vision). It reads the page image with a labelled 5%
     grid drawn over it, and the page's figure records (id and caption), and returns each figure's box.
  2. Refine: the same box widened by 6% is rendered as a close-up with its own 10% grid, and one call per page
     places each figure's box again on its close-up. A whole page is too coarse for a tight box (the first
     Unit 1 run caught slivers of the paragraph beside a figure in 3 of 8 crops); a close-up is not.
  3. Crop: the box plus a small margin, from the PDF at 200 dpi, to work/<book>/figures/<record id>.png
     (':' written as '__').
  4. Check: one call per page (Sonnet, vision). It reads each crop with its caption and says, edge by edge,
     whether the figure is cut ("extend") or something that is not part of it is inside ("trim"), and whether
     the crop shows the figure at all. A crop that missed it goes back to step 1, told where not to look; a
     cut or crowded one is refined again with the check's verdict. At most three checks per figure. `region.checked` says whether the
     last check passed; a figure that never passed keeps its last box and is listed.
The box is written onto the figure record as `region` (book-record schema v2: [left, top, right, bottom] as
fractions of the page) and the record is checked with groundtruth/validate.py. A figure that already has a
region is skipped unless --force; a region a reviewer placed (`by` not this script) is never overwritten.

COST. The `claude` CLI on the developer's sign-in, minimal system prompt, the Read tool only. `--cap` (USD,
default 3) stops the run before it spends more. Costs go to book-records/<book>/extraction-runs.jsonl.
"""
from __future__ import annotations

import argparse
import re
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import extract_book_record as X

HERE = Path(__file__).resolve().parent
VERSION = "crop-v2"  # v2: the locate, refine and check prompts are runbook/crops.workflow.js
MARGIN = 0.006         # added on every side of the refined box
WIDEN = 0.06           # the close-up around the located box
CHECKS = 3             # checks per figure; a failed one is refined (or located again) before the next

# LOCATE_SYSTEM: in runbook/crops.workflow.js since crop-v2 (one copy of every prompt)

# CHECK_SYSTEM: in runbook/crops.workflow.js since crop-v2 (one copy of every prompt)

# REFINE_SYSTEM: in runbook/crops.workflow.js since crop-v2 (one copy of every prompt)

EDGE = {"type": "string", "enum": ["ok", "extend", "trim"]}
LOCATE_SCHEMA = {"type": "object", "required": ["figures"], "properties": {"figures": {"type": "array", "items": {
    "type": "object", "required": ["id", "found"], "properties": {
        "id": {"type": "string"}, "found": {"type": "boolean"},
        "left": {"type": "number"}, "top": {"type": "number"}, "right": {"type": "number"}, "bottom": {"type": "number"}}}}}}
CHECK_SCHEMA = {"type": "object", "required": ["crops"], "properties": {"crops": {"type": "array", "items": {
    "type": "object", "required": ["id", "shows_figure", "ok", "left", "top", "right", "bottom"], "properties": {
        "id": {"type": "string"}, "shows_figure": {"type": "boolean"}, "ok": {"type": "boolean"},
        "left": EDGE, "top": EDGE, "right": EDGE, "bottom": EDGE, "note": {"type": "string"}}}}}}


def ask(mode: str, material: str, label: str, read_dir: Path, model: str, budget: X.Budget, book: str) -> dict:
    """One task of runbook/crops.workflow.js (the prompts live there), run here and metered; counted against the cap."""
    import embed_workflow as EW  # noqa: PLC0415
    import workflow_runner as WR  # noqa: PLC0415
    if budget.left() <= 0.1:
        raise SystemExit(f"cost cap reached (${budget.spent:.3f} of ${budget.cap:.2f}): stopped before {label}")
    args = {"stage": "S0a-crops", "mode": mode, "book": {"book": book}, "model": model, "task": {"label": label, "material": material}}
    name = re.sub(r"[^a-z0-9.-]+", "-", f"crops-{mode}-{label}".lower()).strip("-")
    copy = EW.default_out(book, "crops", name)
    EW.write(HERE / "runbook" / "crops.workflow.js", args, copy)
    _run, res, cost = WR.run_copy(copy, [read_dir], budget.left(), name, book, "crops", stage="S0a")
    budget.spent += cost
    budget.calls.append({"call": label, "cost_usd": round(cost, 4), "mode": mode})
    return res.get("result") or {}


def is_pdf_book(cfg: dict) -> bool:
    src = cfg.get("sources") or {}
    return bool(src.get("pdf")) and not src.get("epub")


def crop_name(record_id: str) -> str:
    return record_id.replace(":", "__") + ".png"


def figures_dir(book: str) -> Path:
    return HERE / "work" / book / "figures"


def gridded(page_png: Path, out: Path) -> Path:
    """The page image with a labelled 5% grid, for locating."""
    from PIL import Image, ImageDraw  # noqa: PLC0415  (uv run --with pillow)
    if out.exists() and out.stat().st_mtime >= page_png.stat().st_mtime:
        return out
    im = Image.open(page_png).convert("RGB")
    w, h = im.size
    d = ImageDraw.Draw(im, "RGBA")
    for k in range(0, 101, 5):
        x, y = round(w * k / 100), round(h * k / 100)
        strong = k % 10 == 0
        col = (0, 90, 255, 110 if strong else 55)
        d.line([(x, 0), (x, h)], fill=col, width=1)
        d.line([(0, y), (w, y)], fill=col, width=1)
        if strong:
            for tx, ty in ((x + 2, 2), (x + 2, h - 14)):
                d.text((tx, ty), str(k), fill=(0, 60, 200, 255))
            for tx, ty in ((2, y + 2), (w - 22, y + 2)):
                d.text((tx, ty), str(k), fill=(0, 60, 200, 255))
    im.save(out)
    return out


def crop(pdf: Path, printed: int, offset: int, box: list[float], out: Path) -> None:
    import pymupdf  # noqa: PLC0415
    page = pymupdf.open(pdf)[printed + offset - 1]
    r = page.rect
    clip = pymupdf.Rect(r.x0 + r.width * box[0], r.y0 + r.height * box[1], r.x0 + r.width * box[2], r.y0 + r.height * box[3])
    page.get_pixmap(dpi=200, clip=clip).save(out)


def clamp(box: list[float]) -> list[float]:
    l, t, r, b = (min(1.0, max(0.0, v)) for v in box)
    return [round(l, 4), round(t, 4), round(max(r, l + 0.01), 4), round(max(b, t + 0.01), 4)]


def locate(pdf: Path, printed: int, offset: int, figs: list[dict], grid: Path, misses: dict[str, str], model: str,
           budget: X.Budget, label: str, grid_dir: Path) -> dict[str, list[float]]:
    """Each figure's box on the whole page (page fractions); `misses` names boxes that showed something else."""
    listing = "\n".join(f"[{f['id']}] {f.get('caption', '')}"
                        + (f"\n  NOT the region {misses[f['id']]} (percent): a crop there showed something else" if misses.get(f["id"]) else "")
                        for f in figs)
    loc = ask("locate", f"Printed page {printed}. The page image with its grid: {grid}\n\nFIGURES\n{listing}\n\n"
              "Return one row per figure, id as shown in brackets, without the brackets.", label, grid_dir, model, budget, BOOK[0])
    rows = {r["id"].strip("[]"): r for r in loc.get("figures") or []}
    out = {}
    for f in figs:
        r = rows.get(f["id"])
        if r and r.get("found") and all(r.get(k) is not None for k in ("left", "top", "right", "bottom")):
            out[f["id"]] = clamp([r["left"] / 100, r["top"] / 100, r["right"] / 100, r["bottom"] / 100])
    return out


def widen(box: list[float], by: float = WIDEN) -> list[float]:
    return clamp([box[0] - by, box[1] - by, box[2] + by, box[3] + by])


def closeup(pdf: Path, printed: int, offset: int, view: list[float], out: Path) -> Path:
    """The page region `view` at 200 dpi with a labelled 10% grid of its own."""
    from PIL import Image, ImageDraw  # noqa: PLC0415
    crop(pdf, printed, offset, view, out)
    im = Image.open(out).convert("RGB")
    w, h = im.size
    d = ImageDraw.Draw(im, "RGBA")
    for k in range(0, 101, 10):
        x, y = min(w - 1, round(w * k / 100)), min(h - 1, round(h * k / 100))
        d.line([(x, 0), (x, h)], fill=(0, 90, 255, 90), width=1)
        d.line([(0, y), (w, y)], fill=(0, 90, 255, 90), width=1)
        d.text((x + 2, 2), str(k), fill=(0, 60, 200, 255))
        d.text((2, y + 2), str(k), fill=(0, 60, 200, 255))
    im.save(out)
    return out


def refine(pdf: Path, printed: int, offset: int, slug: str, figs: list[dict], views: dict[str, list[float]], hints: dict[str, str],
           zoom_dir: Path, model: str, budget: X.Budget, label: str) -> dict[str, list[float]]:
    """Place each figure's box on a close-up of `views[id]`; returns page-fraction boxes (with MARGIN)."""
    cap = {f["id"]: f.get("caption", "") for f in figs}
    files = {fid: closeup(pdf, printed, offset, v, zoom_dir / crop_name(fid)) for fid, v in views.items()}
    res = ask("refine", "\n".join(f"[{fid}] {files[fid]}\n  the figure: {cap[fid]}" + (f"\n  a check of the last crop said: {hints[fid]}" if hints.get(fid) else "")
                                   for fid in views)
              + "\n\nReturn one row per close-up, id as shown in brackets, without the brackets.", label, zoom_dir, model, budget, BOOK[0])
    rows = {r["id"].strip("[]"): r for r in res.get("figures") or []}
    out = {}
    for fid, (l, t, r, b) in views.items():
        row = rows.get(fid)
        if not row or not row.get("found") or any(row.get(k) is None for k in ("left", "top", "right", "bottom")):
            out[fid] = clamp([l, t, r, b])
            continue
        w, h = r - l, b - t
        out[fid] = clamp([l + w * row["left"] / 100 - MARGIN, t + h * row["top"] / 100 - MARGIN,
                          l + w * row["right"] / 100 + MARGIN, t + h * row["bottom"] / 100 + MARGIN])
    return out


def page_figures(doc: dict, force: bool, failed_only: bool = False) -> dict[int, list[dict]]:
    by_page = defaultdict(list)
    for it in doc["items"]:
        if it["type"] != "figure":
            continue
        reg = it.get("region") or {}
        mine = str(reg.get("by", "")).startswith("crop_figures.py")
        if reg and not ((force and mine) or (failed_only and mine and not reg.get("checked"))):
            continue
        by_page[it["source_page"]].append(it)
    return by_page


BOOK = [""]   # the book being cropped, for the workflow's args (set by crop_lesson)


def crop_lesson(book: str, cfg: dict, slug: str, offset: int, model: str, budget: X.Budget, force: bool,
                failed_only: bool = False, img_dir: Path | None = None) -> dict:
    BOOK[0] = book
    path = HERE / "book-records" / book / f"{slug}.json"
    doc = json.loads(path.read_text())
    pdf = X.REPO / cfg["sources"]["pdf"]
    img_dir = img_dir or HERE / "work" / book / "page-images"
    grid_dir = HERE / "work" / book / "page-grids" / img_dir.relative_to(HERE / "work" / book / "page-images")
    zoom_dir = HERE / "work" / book / "figure-closeups"
    out_dir = figures_dir(book)
    for d in (img_dir, grid_dir, zoom_dir, out_dir):
        d.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).date().isoformat()
    by = f"crop_figures.py {VERSION}, {model}, {stamp}"
    report = {"lesson": slug, "cropped": [], "not_found": [], "unchecked": []}
    for printed, figs in sorted(page_figures(doc, force, failed_only).items()):
        page = X.render(pdf, printed, offset, img_dir)
        grid = gridded(page, grid_dir / page.name)
        located = locate(pdf, printed, offset, figs, grid, {}, model, budget, f"{slug} p.{printed} locate", grid_dir)
        report["not_found"] += [f["id"] for f in figs if f["id"] not in located]
        if not located:
            continue
        boxes = refine(pdf, printed, offset, slug, figs, {k: widen(v) for k, v in located.items()}, {},
                       zoom_dir, model, budget, f"{slug} p.{printed} refine")
        checked: dict[str, bool] = {}
        cap = {f["id"]: f.get("caption", "") for f in figs}
        pending = list(boxes)
        for rnd in range(CHECKS):
            for fid in pending:
                crop(pdf, printed, offset, boxes[fid], out_dir / crop_name(fid))
            res = ask("check", "\n".join(f"[{fid}] {out_dir / crop_name(fid)}\n  description: {cap[fid]}" for fid in pending)
                      + "\n\nReturn one row per crop, id as shown in brackets, without the brackets.",
                      f"{slug} p.{printed} check {rnd + 1}", out_dir, model, budget, book)
            verdicts = {v["id"].strip("[]"): v for v in res.get("crops") or []}
            elsewhere, refit = {}, {}
            for fid in pending:
                v = verdicts.get(fid)
                checked[fid] = bool(v and v["ok"] and v.get("shows_figure") and all(v[e] == "ok" for e in ("left", "top", "right", "bottom")))
                if checked[fid] or not v:
                    continue
                if not v.get("shows_figure"):
                    elsewhere[fid] = "[" + ", ".join(f"{x * 100:.0f}" for x in boxes[fid]) + "]" + (f" ({v['note']})" if v.get("note") else "")
                else:
                    refit[fid] = "; ".join(f"{e}: {v[e]}" for e in ("left", "top", "right", "bottom") if v[e] != "ok") + (f" ({v['note']})" if v.get("note") else "")
            if not (elsewhere or refit) or rnd == CHECKS - 1:
                break
            if elsewhere:   # the box missed the figure: look for it on the whole page again, never near the miss
                again = locate(pdf, printed, offset, [f for f in figs if f["id"] in elsewhere], grid, elsewhere, model, budget,
                               f"{slug} p.{printed} locate again", grid_dir)
                if again:
                    boxes.update(refine(pdf, printed, offset, slug, figs, {k: widen(v) for k, v in again.items()}, {},
                                        zoom_dir, model, budget, f"{slug} p.{printed} refine relocated"))
            if refit:
                boxes.update(refine(pdf, printed, offset, slug, figs, {k: widen(boxes[k], WIDEN) for k in refit}, refit,
                                    zoom_dir, model, budget, f"{slug} p.{printed} refine again"))
            pending = list(elsewhere) + list(refit)
        for fid, box in boxes.items():   # the last check never adjusts, so each file is the box it ends with
            rec = next(f for f in figs if f["id"] == fid)
            rec["region"] = {"box": box, "by": by, "checked": checked.get(fid, False)}
            report["cropped"].append({"id": fid, "page": printed, "file": crop_name(fid), "checked": checked.get(fid, False)})
            if not checked.get(fid):
                report["unchecked"].append(fid)
    errs = X.check(doc)
    if errs:
        report["errors"] = errs
        print(f"{slug}: NOT written, the record no longer validates:\n  " + "\n  ".join(errs[:10]), file=sys.stderr)
        return report
    doc.setdefault("history", []).append(f"{stamp}: figure regions placed ({VERSION}, {model}): {len(report['cropped'])} cropped")
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    return report


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("book")
    r.add_argument("lessons", nargs="*")
    r.add_argument("--all", action="store_true")
    r.add_argument("--cap", type=float, default=3.0)
    r.add_argument("--model", default="sonnet")
    r.add_argument("--force", action="store_true", help="place again the regions this script placed (never a reviewer's)")
    r.add_argument("--failed", action="store_true", help="place again only the regions this script placed that failed the check")
    a = ap.parse_args(argv)
    cfg = json.loads((HERE / "books" / f"{a.book}.json").read_text())
    if not is_pdf_book(cfg):
        print(f"{a.book}: not a PDF-only book. An EPUB's figures are their own image files (source_adapter.py, "
              f"work/{a.book}/figures/): S4 and the stand-ins read those, no crop is needed.", file=sys.stderr)
        return 2
    lmap = json.loads((HERE / "book-records" / a.book / "lessons.json").read_text())
    slugs = [l["slug"] for l in lmap["lessons"]] if a.all else a.lessons
    if not slugs:
        ap.error("name lessons or pass --all")
    budget = X.Budget(a.cap)
    reports = []
    try:
        for slug in slugs:
            lesson = next((l for l in lmap["lessons"] if l["slug"] == slug), {})
            rep = crop_lesson(a.book, cfg, slug, lesson.get("page_offset", lmap["page_offset"]), a.model, budget, a.force, a.failed,
                              X.page_dir(a.book, lesson))
            reports.append(rep)
            print(f"{slug}: {len(rep['cropped'])} figure(s) cropped, {len(rep['unchecked'])} not passing the check, "
                  f"{len(rep['not_found'])} not found")
    finally:
        log = HERE / "book-records" / a.book / "extraction-runs.jsonl"
        with log.open("a") as fh:
            fh.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "version": VERSION, "step": "crop",
                                 "model": a.model, "lessons": slugs, "cost_usd": round(budget.spent, 4), "calls": budget.calls,
                                 "reports": reports}, ensure_ascii=False) + "\n")
    print(f"cost ${budget.spent:.3f}")
    return 1 if any(r.get("errors") for r in reports) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

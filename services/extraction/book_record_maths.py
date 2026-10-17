"""S0a's maths second reading for page-image books: every formula a book record holds, read again blind from the page.

    uv run --with pymupdf book_record_maths.py run    prep3-math-en u1-1 u1-2 [--cap 3] [--force]
    uv run --with pymupdf book_record_maths.py args   prep3-math-en u1-1 …          # the embedded copy, for Claude Code
    uv run book_record_maths.py accept prep3-math-en runs/<book>/maths-reading/<saved return>.json
    uv run --with pymupdf book_record_maths.py third prep3-math-en u1-1 …             # the third reading, on what is not agreed
    uv run book_record_maths.py apply  prep3-math-en [--dry-run]                      # what the Maths reading task decided

Decided by Tamer, 2026-10-16 (build now: the maths second reading). Grade 10's maths came from EPUB images that S0b
transcribed twice with a third pass on disagreement; a page-image book's maths is read once, by the page agent, among
everything else it records. This gives it the same two-reading discipline (runbook/maths-reading.workflow.js).

Every $…$ span in a record's text fields is a place: its item, its field ("stem", "solution[2]", "parts[1].answer",
"rows[2][1]"), and the field's words with every formula masked. One agent per printed page reads them all blind.
`accept` (no model) compares each pair after normalising only what LaTeX writes two ways for the same print (spacing,
\\left/\\right, \\dfrac, \\leq, braces round one character, ×/\\times …) and writes
book-records/<book>/maths-reading/<lesson>.json (format `ainext.maths-reading/1`): agreed | disagreed | unread.
THE THIRD READING (Tamer, 2026-10-17: Samuel's S0b pass C, answer 11). Where the first two readings did not agree (they
differ, or the second could not read it), a third agent reads the place, blind to both, with the same prompt (`run` goes
on to it by itself; `third` runs it on lessons read before). It SETTLES the formula when it agrees with one of them
(status `settled`, `sided_with` first or second): siding with the first leaves the record as it is, siding with the
second makes `apply` write the second into the record without anyone deciding. Only a formula all three read
differently, or that the third reading too cannot read, stays `disagreed` or `unread` for a person.
A disagreement is not a correction: the review tool's Maths reading task shows the readings against the page and a person
chooses the first reading, the second, or types what is printed (reviews/<book>/maths-reading.json). `apply` writes
a chosen second or typed reading into the book record (a history line names who decided), only where the record still
holds the first reading; anything else is reported, not written. A book's own error is a misprint, not this: the
reading records what is printed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_config  # noqa: E402

FORMAT = "ainext.maths-reading/1"
SPAN = re.compile(r"\$([^$]+)\$")
TEXT_FIELDS = ("claim", "term", "stem", "text", "caption", "answer")   # not `formula`: the reader's compact form, not the print


def places_of(item: dict) -> list[tuple[str, str]]:
    """(field path, its text) for every text field of an item that may hold maths."""
    # a worked example's `answer` is the reader's short value lifted from its solution (which is read), not a print
    keys = [k for k in TEXT_FIELDS if not (k == "answer" and item.get("type") == "worked_example")]
    out = [(k, item[k]) for k in keys if isinstance(item.get(k), str)]
    for k in ("solution", "examples", "header"):
        out += [(f"{k}[{i}]", s) for i, s in enumerate(item.get(k) or []) if isinstance(s, str)]
    out += [(f"rows[{r}][{c}]", s) for r, row in enumerate(item.get("rows") or []) for c, s in enumerate(row) if isinstance(s, str)]
    for j, p in enumerate(item.get("parts") or []):
        out += [(f"parts[{j}].{k}", p[k]) for k in ("stem", "answer") if isinstance(p.get(k), str)
                and not (k == "answer" and item.get("type") == "worked_example")]
        out += [(f"parts[{j}].solution[{i}]", s) for i, s in enumerate(p.get("solution") or []) if isinstance(s, str)]
    return [(f, t) for f, t in out if SPAN.search(t)]


def get_field(item: dict, path: str):
    cur = item
    for name, idx in re.findall(r"([a-z_]+)((?:\[\d+\])*)", path):
        cur = cur[name]
        for i in re.findall(r"\[(\d+)\]", idx):
            cur = cur[int(i)]
    return cur


def set_field(item: dict, path: str, value: str) -> None:
    steps = []
    for name, idx in re.findall(r"([a-z_]+)((?:\[\d+\])*)", path):
        steps.append(name)
        steps += [int(i) for i in re.findall(r"\[(\d+)\]", idx)]
    cur = item
    for s in steps[:-1]:
        cur = cur[s]
    cur[steps[-1]] = value


def masked(text: str, n: int) -> str:
    k = iter(range(10 ** 6))
    return SPAN.sub(lambda m: "⟨?⟩" if next(k) == n else "⟨…⟩", text)


UNICODE = {"×": r"\times", "÷": r"\div", "−": "-", "≤": r"\le", "≥": r"\ge", "≠": r"\ne", "∈": r"\in", "∉": r"\notin",
           "⊂": r"\subset", "∅": r"\emptyset", "√": r"\sqrt", "∞": r"\infty", "→": r"\to", "π": r"\pi"}
ALIASES = [(r"\dfrac", r"\frac"), (r"\tfrac", r"\frac"), (r"\leq", r"\le"), (r"\geq", r"\ge"), (r"\neq", r"\ne"),
           (r"\lbrace", r"\{"), (r"\rbrace", r"\}"), (r"\rightarrow", r"\to"), (r"\varnothing", r"\emptyset")]


def norm_tex(s: str) -> str:
    """Only what LaTeX writes two ways for the same print; never a change to what is printed."""
    s = s or ""
    for u, t in UNICODE.items():
        s = s.replace(u, t + " ")
    for a, b in ALIASES:
        s = s.replace(a, b)
    s = re.sub(r"\\(left|right|big|Big|bigl|bigr|Bigl|Bigr)(?![a-zA-Z])", "", s)
    s = re.sub(r"\\[,;:! ]|\\quad|\\qquad|~", "", s)
    s = re.sub(r"\\(text|mathrm|textrm|mathit|operatorname)\{([^{}]*)\}", r"\2", s)
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"([_^])\{(\\?[A-Za-z0-9])\}", r"\1\2", s)
    return s


def lesson_places(book: str, slug: str) -> tuple[dict, list[dict]]:
    doc = json.loads((HERE / "book-records" / book / f"{slug}.json").read_text())
    out = []
    for it in doc["items"]:
        # located by what the page prints (its opening words, maths masked), never by a label the record may have given it
        opening = SPAN.sub("⟨…⟩", it.get("quote") or "")
        where = f"{it['type'].replace('_', ' ')}{(' ' + it['label']) if it.get('label') else ''} that begins “{opening}”"
        pages = list(range(it["pages"][0], it["pages"][1] + 1)) if it.get("pages") else [it.get("source_page")]
        for field, text in places_of(it):
            for n, m in enumerate(SPAN.finditer(text)):
                out.append({"ref": f"{it['id']}|{field}|{n}", "record_id": it["id"], "field": field, "n": n,
                            "page": it.get("source_page"), "pages": pages, "first": m.group(1), "item": where,
                            "context": masked(text, n)[:600]})
    return doc, out


def build_args(book: str, slugs: list[str], model: str, only: set[str] | None = None, mode: str | None = None) -> dict:
    import extract_book_record as X  # noqa: PLC0415  (render, page_dir: the page reader's own images)
    b = book_config.load_book(book)
    lmap = json.loads((HERE / "book-records" / book / "lessons.json").read_text())
    pdf = book_config.REPO_ROOT / b.sources.pdf
    pages = []
    for slug in slugs:
        lesson = next(l for l in lmap["lessons"] if l["slug"] == slug)
        img_dir = X.page_dir(book, lesson)
        img_dir.mkdir(parents=True, exist_ok=True)
        _doc, places = lesson_places(book, slug)
        for printed in sorted({g for p in places for g in p["pages"] if isinstance(g, int)}):   # an item over a page break: each page
            img = X.render(pdf, printed, lesson.get("page_offset", lmap["page_offset"]), img_dir)
            here = [{k: p[k] for k in ("ref", "item", "field", "context")} for p in places
                    if printed in p["pages"] and (only is None or p["ref"] in only)]
            if here:
                pages.append({"lesson": slug, "printed": printed, "image": str(img.resolve()), "places": here})
    return {"stage": "S0a-maths-reading", "book": {"book": book, "title": b.title}, "pages": pages, "options": {"model": model},
            **({"mode": mode} if mode else {})}


def unsettled(book: str, slugs: list[str]) -> dict[str, set[str]]:
    """Per lesson, the places the first two readings did not agree on and no third reading has settled."""
    out = {}
    for s in slugs:
        f = out_path(book, s)
        if f.exists():
            refs = {e["ref"] for e in json.loads(f.read_text())["entries"] if e["status"] in ("disagreed", "unread") and "third" not in e}
            if refs:
                out[s] = refs
    return out


def readings_of(res: dict) -> dict[str, dict]:
    got: dict[str, dict] = {}
    for P in res["pages"]:   # an item over a page break was offered each page: the page that read it counts
        for r in P["readings"]:
            if r["ref"] not in got or (got[r["ref"]].get("unreadable") or not got[r["ref"]].get("latex")):
                got[r["ref"]] = r
    return got


def settle(book: str, run_file: Path) -> dict:
    """A third reading's return → each place it read is settled when it agrees with the first or the second reading."""
    res = json.loads(run_file.read_text())
    if res.get("stage") != "S0a-maths-reading" or res.get("mode") != "third":
        raise SystemExit(f"{run_file} is not a third-reading return")
    third = readings_of(res)
    report = {}
    for slug in dict.fromkeys(P["lesson"] for P in res["pages"]):
        f = out_path(book, slug)
        doc = json.loads(f.read_text())
        n = {"settled_first": 0, "settled_second": 0, "still_open": 0}
        for e in doc["entries"]:
            r = third.get(e["ref"])
            if r is None or e["status"] not in ("disagreed", "unread"):
                continue
            c = None if r.get("unreadable") else (r.get("latex") or "").strip().strip("$") or None
            e["third"] = c
            if r.get("notes"):
                e["third_notes"] = r["notes"]
            if c and norm_tex(c) == norm_tex(e["first"]):
                e.update(status="settled", sided_with="first")
                n["settled_first"] += 1
            elif c and e.get("second") and norm_tex(c) == norm_tex(e["second"]):
                e.update(status="settled", sided_with="second")
                n["settled_second"] += 1
            else:
                n["still_open"] += 1
        doc.setdefault("third_runs", []).append(str(run_file.relative_to(HERE)) if run_file.is_relative_to(HERE) else str(run_file))
        f.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
        report[slug] = n
    return report


def run_third(book: str, slugs: list[str], model: str, cap: float, args_only: bool = False) -> dict:
    import embed_workflow as EW  # noqa: PLC0415
    import workflow_runner as WR  # noqa: PLC0415
    todo = unsettled(book, slugs)
    if not todo:
        return {}
    args = build_args(book, list(todo), model, only=set().union(*todo.values()), mode="third")
    tag = "-".join(todo) if len(todo) <= 2 else f"{list(todo)[0]}..{list(todo)[-1]}"
    copy = EW.default_out(book, "maths-reading", f"third.{tag}")
    print(EW.summary(EW.write(HERE / "runbook" / "maths-reading.workflow.js", args, copy)), file=sys.stderr)
    if args_only:
        return {}
    run_file, _res, _cost = WR.run_copy(copy, [HERE / "work" / book / "page-images"], cap, f"mread-third.{tag}", book,
                                        "maths-reading", stage="S0a")
    return settle(book, run_file)


def out_path(book: str, slug: str) -> Path:
    return HERE / "book-records" / book / "maths-reading" / f"{slug}.json"


def fingerprint(p: dict) -> str:
    return hashlib.sha256(f"{p['ref']}\n{p['first']}\n{p['context']}".encode()).hexdigest()[:16]


def accept(book: str, run_file: Path) -> dict:
    res = json.loads(run_file.read_text())
    if res.get("stage") != "S0a-maths-reading" or res.get("mode") == "third":
        raise SystemExit(f"{run_file} is not a second-reading return")
    second = readings_of(res)
    failed = {(P["lesson"], P["printed"]) for P in res["pages"] if P.get("failed")}
    report = {}
    for slug in dict.fromkeys(P["lesson"] for P in res["pages"]):
        _doc, places = lesson_places(book, slug)
        entries = []
        for p in places:
            s = second.get(p["ref"])
            if all((slug, g) in failed for g in p["pages"]) or not s or s.get("unreadable") or not (s.get("latex") or "").strip():
                status, latex = "unread", (s or {}).get("latex")
            else:
                latex = s["latex"].strip().strip("$")
                status = "agreed" if norm_tex(latex) == norm_tex(p["first"]) else "disagreed"
            entries.append({"ref": p["ref"], "record_id": p["record_id"], "field": p["field"], "n": p["n"], "page": p["page"],
                            "item": p["item"], "context": p["context"], "first": p["first"], "second": latex, "status": status,
                            "fingerprint": fingerprint(p), **({"notes": s["notes"]} if s and s.get("notes") else {})})
        doc = {"format": FORMAT, "book": book, "lesson": slug, "made": date.today().isoformat(),
               "made_by": f"book_record_maths.py accept ({res.get('prompts_version')})",
               "source": f"book-records/{book}/{slug}.json",
               "source_run": str(run_file.relative_to(HERE)) if run_file.is_relative_to(HERE) else str(run_file),
               "entries": entries}
        out = out_path(book, slug)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
        report[slug] = {k: sum(1 for e in entries if e["status"] == k) for k in ("agreed", "disagreed", "unread")}
    return report


def apply(book: str, dry_run: bool) -> dict:
    dfile = HERE / "reviews" / book / "maths-reading.json"
    latest = {d["ref"]: d for d in json.loads(dfile.read_text())["decisions"]} if dfile.exists() else {}
    applied, skipped, docs = [], [], {}
    for f in sorted((HERE / "book-records" / book / "maths-reading").glob("*.json")):
        mr = json.loads(f.read_text())
        for e in mr["entries"]:
            d = latest.get(e["ref"])
            if d and d.get("fingerprint") != e["fingerprint"]:
                skipped.append(f"{e['ref']}: decided on another reading; decide it again")
                continue
            if d:   # a person's decision wins over the readings
                if d["choice"] == "first":
                    continue
                new, who = (e["second"] if d["choice"] == "second" else d.get("latex")), f"decided by {d['by']}"
            elif e.get("status") == "settled" and e.get("sided_with") == "second":
                new, who = e["second"], "settled by a third reading that agreed with the second"
            else:
                continue
            slug = mr["lesson"]
            doc = docs.setdefault(slug, json.loads((HERE / "book-records" / book / f"{slug}.json").read_text()))
            it = next((x for x in doc["items"] if x["id"] == e["record_id"]), None)
            text = get_field(it, e["field"]) if it else None
            spans = list(SPAN.finditer(text or ""))
            if it and e["n"] < len(spans) and spans[e["n"]].group(1) == new:
                continue   # applied already
            if not it or e["n"] >= len(spans) or spans[e["n"]].group(1) != e["first"]:
                skipped.append(f"{e['ref']}: the record no longer holds the first reading")
                continue
            m = spans[e["n"]]
            set_field(it, e["field"], text[:m.start()] + f"${new}$" + text[m.end():])
            doc.setdefault("history", []).append(
                f"{date.today().isoformat()}: {e['record_id']} {e['field']}: ${e['first']}$ → ${new}$ (maths reading, {who})")
            applied.append(e["ref"])
    if not dry_run:
        for slug, doc in docs.items():
            (HERE / "book-records" / book / f"{slug}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    return {"applied": applied, "skipped": skipped, "dry_run": dry_run}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("run", "args", "third"):
        s = sub.add_parser(name)
        s.add_argument("book")
        s.add_argument("lessons", nargs="+")
        s.add_argument("--no-third", action="store_true", help="run: stop after the second reading")
        s.add_argument("--model", default="sonnet")
        s.add_argument("--cap", type=float, default=3.0)
        s.add_argument("--force", action="store_true")
    c = sub.add_parser("accept")
    c.add_argument("book")
    c.add_argument("run_file", type=Path)
    p = sub.add_parser("apply")
    p.add_argument("book")
    p.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "apply":
        print(json.dumps(apply(a.book, a.dry_run), indent=1))
        return 0
    if a.cmd == "third":
        rep = run_third(a.book, a.lessons, a.model, a.cap)
        for slug, n in rep.items():
            print(f"{slug}: third reading settled {n['settled_first']} for the first reading, {n['settled_second']} for the second; "
                  f"{n['still_open']} left for a person (the Maths reading task)", file=sys.stderr)
        if not rep:
            print("nothing to settle: every formula the lessons hold is agreed or already read a third time", file=sys.stderr)
        return 0
    if a.cmd == "accept":
        rep = accept(a.book, a.run_file.resolve())
    else:
        import embed_workflow as EW  # noqa: PLC0415
        import workflow_runner as WR  # noqa: PLC0415
        todo = [s for s in a.lessons if a.force or not out_path(a.book, s).exists()]
        if not todo:
            print("every lesson named has its second reading (--force to redo)", file=sys.stderr)
            return 0
        args = build_args(a.book, todo, a.model)
        tag = todo[0] if len(todo) == 1 else f"{todo[0]}..{todo[-1]}"
        copy = EW.default_out(a.book, "maths-reading", tag)
        print(EW.summary(EW.write(HERE / "runbook" / "maths-reading.workflow.js", args, copy)), file=sys.stderr)
        if a.cmd == "args":
            return 0
        run_file, _res, _cost = WR.run_copy(copy, [HERE / "work" / a.book / "page-images"], a.cap, f"mread.{tag}", a.book,
                                            "maths-reading", stage="S0a")
        rep = accept(a.book, run_file)
        if not a.no_third:   # Samuel's pass C: what the first two did not agree on, read a third time
            third = run_third(a.book, todo, a.model, a.cap)
            for slug, n in third.items():
                rep[slug]["settled"] = n["settled_first"] + n["settled_second"]
                rep[slug]["disagreed"] = n["still_open"]
    for slug, n in rep.items():
        print(f"{slug}: {n['agreed']} agreed, {n.get('settled', 0)} settled by a third reading, {n['disagreed']} for a person, "
              f"{n['unread']} unread → book-records/{a.book}/maths-reading/{slug}.json",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

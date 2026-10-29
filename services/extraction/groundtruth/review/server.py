"""The review tool: one local page for every review task, one task at a time.

    python3 services/extraction/groundtruth/review/server.py [--port 3020] [--pdf-dir DIR ...] [--records DIR ...]

Tasks (docs/design/review-console.md, built here as a local tool):

  Label extraction  check the pipeline's book records (book-records/<book>/<slug>.json, role "extraction")
                    against the page; what a reviewer labels is written into the ground truth
                    (groundtruth/<book>/…, role "ground_truth"). A lesson with no extraction yet is labelled
                    in its ground-truth file directly.
  Misprints         decide every mistake the book prints: the pipeline's candidates
                    (book-records/<book>/misprint-candidates.json) and the misprints on book records.
                    Decisions are appended to groundtruth/<book>/misprint-decisions.json.
  Generated content every generated question, widget question, widget mapping and misconception the book
                    configs name, each beside the book item it was made from, and every figure S4 drew (or
                    could not draw) for a PDF book (teaching/<book>/visuals/), beside the book's own crop of
                    it; decisions are appended to reviews/<book>/generated-content.json (generated.py).
  Generated answers every answer answer_gen.py wrote for a book prompt the book leaves unanswered
                    (teaching/<book>/answers/), beside the book's question; decisions are appended to
                    reviews/<book>/generated-answers.json (answers.py).
  Objectives (G1)   every objective S1 found (book_record_objectives.py, teaching/<book>/objectives/), its evidence
                    and its items, every prerequisite link, and the questions S1 says G1 owes; decisions are appended
                    to reviews/<book>/objectives-g1.json (objectives.py).
  Question tiers    where the two readings of a book question's tier disagree (tier_questions.py,
                    teaching/<book>/tiers/), a person chooses; decisions are appended to
                    reviews/<book>/question-tiers.json (tiers.py).
  Book questions    each book question compile holds on its answer (answer mismatch, unverified, unanswerable), with
  (G2)              the blind re-solve and Samuel's G2 recommendation: release, fix the key, hold or exclude; decisions
                    are appended to reviews/<book>/book-questions-g2.json (book_questions.py) and compile applies them.
  Held generation   every question family and widget template S6/S7 held (nothing generated from it), with the
                    checks' reasons: drop it, or send it back with a note to be authored again (book_record_held.py
                    reauthor); decisions are appended to reviews/<book>/held-generation.json (held.py).
  Real-life context the book's linking text sorted twice (book_record_context.py, S1C, teaching/<book>/context/): what
                    the two sorts disagree on is held out of lessons until a person keeps (with its kind and goal) or
                    drops it; decisions are appended to reviews/<book>/context-review.json (context.py), compile applies.
  Maths reading     where the two readings of a page-image book's formula disagree (book_record_maths.py,
                    book-records/<book>/maths-reading/), a person says what is printed; decisions are appended to
                    reviews/<book>/maths-reading.json (maths_reading.py).

The home page filters every count by book, and for one book offers Refresh: `ingest.py refresh <book>` (no model
call), which brings the decisions made here into the book records and the compiled book (--scratch-dsn: and loads
a local scratch database again). Label extraction offers "apply to the book record" for a corrected statement, so
the correction reaches what compile, and the tutor, read.

Everything is a file in the repository, so a review is committed like any other change. Serves on 127.0.0.1
only. The book PDFs are not in git (docs/Source/*.pdf is ignored); the server looks for each in docs/Source/,
then in every --pdf-dir, then in ~/Downloads. Standard library only.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import threading
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import answers  # noqa: E402
import tiers  # noqa: E402
import objectives  # noqa: E402
import maths_reading  # noqa: E402
import provenance  # noqa: E402
import book_questions  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import score_book_record  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))   # services/extraction/
import answer_gen  # noqa: E402  (apply_misprints: what the pipeline does with each misprint, decisions included)
import generated  # noqa: E402
import held  # noqa: E402
import context as context_task  # noqa: E402  (the Context task: the book's context per objective, S1C)

HERE = Path(__file__).resolve().parent
GT_DIR = HERE.parent
EXTRACTION = GT_DIR.parent
REPO = GT_DIR.parents[2]
TOKENS_CSS = REPO / "app" / "src" / "app" / "globals.css"
SKIP = {"TEMPLATE.json", "book-record.schema.json"}
SKIP_PREFIX = ("EXAMPLE",)
NAME = re.compile(r"^[a-z0-9][a-z0-9.-]{0,63}$")
DECISIONS = {"confirmed", "corrected", "not_a_misprint"}

PDF_DIRS: list[Path] = []
# Where book records live: (role, folder). A file is named to the page as "<root index>/<path inside that
# root>", so the page can never name a file outside these folders. Root 0 is the ground truth.
ROOTS: list[tuple[str, Path]] = [("ground_truth", GT_DIR), ("extraction", EXTRACTION / "book-records")]


def write_json(p: Path, data) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, p)


def book_records():
    """Every book record: (key, role, book, path, doc). The book is the first folder inside the root."""
    out = []
    for i, (role, root) in enumerate(ROOTS):
        if not root.is_dir():
            continue
        for p in sorted(root.rglob("*.json")):
            rel = p.relative_to(root)
            if p.name in SKIP or p.name.startswith(SKIP_PREFIX) or "review" in rel.parts or len(rel.parts) < 2:
                continue
            try:
                d = json.loads(p.read_text())
            except Exception as e:  # a broken file is reported, not hidden
                sys.stderr.write(f"skipped {p}: {e}\n")
                continue
            if d.get("schema") == "book-record":
                out.append((f"{i}/{rel.as_posix()}", d.get("role") or role, rel.parts[0], p, d))
    return out


def all_ids(d: dict) -> list[str]:
    return [r["id"] for r in (d.get("items") or []) + (d.get("learning_objectives") or []) if r.get("id")]


def lessons():
    """One row per (book, lesson slug): its extraction file and its ground-truth file, and how far labelling got."""
    by: dict[tuple[str, str], dict] = {}
    for key, role, book, _p, d in book_records():
        slug = (d.get("lesson") or {}).get("slug", "?")
        row = by.setdefault((book, slug), {"book": book, "slug": slug, "gt": None, "ext": None,
                                           "title": f"{d['lesson'].get('syllabus_ref', '')} · {d['lesson'].get('title', '')}"})
        row["gt" if role == "ground_truth" else "ext"] = key
        row["_" + ("gt" if role == "ground_truth" else "ext")] = d
    out = []
    for row in by.values():
        gt, ext = row.pop("_gt", None), row.pop("_ext", None)
        source = ext or gt
        status = {r["id"]: (r.get("review") or {}).get("status") for r in (gt or {}).get("items", []) + (gt or {}).get("learning_objectives", [])}
        gone = {n["id"] for n in (gt or {}).get("not_in_book", [])}
        ids = all_ids(source)
        if ext and gt:  # extracted ids that are the ground truth's records under another id count as those records
            # by content only, as the overlay shows them: an extracted record that merely shares an id with a
            # ground-truth record is not that record, so its label does not count for it
            pairs, _m, _i = score_book_record.match_by_content(ext.get("items") or [], gt.get("items") or [])
            alias = {e["id"]: g["id"] for g, e, _how in pairs}
            fresh = {e["id"] for e in ext.get("items") or []} - set(alias)
            ids = [alias.get(i, f"unlabelled:{i}" if i in fresh else i) for i in ids]
        row["total"] = len(ids)
        row["labelled"] = sum(1 for i in ids if status.get(i) in ("confirmed", "flagged") or i in gone)
        row["flagged"] = sum(1 for i in ids if status.get(i) == "flagged")
        row["source"] = "extraction" if ext else "ground truth"
        out.append(row)
    return sorted(out, key=lambda r: (r["book"], r["slug"]))


def resolve_key(key: str) -> Path:
    idx, _, rel = key.partition("/")
    if not idx.isdigit() or int(idx) >= len(ROOTS):
        raise FileNotFoundError(key)
    root = ROOTS[int(idx)][1].resolve()
    p = (root / rel).resolve()
    if root not in p.parents or p.suffix != ".json" or not p.exists():
        raise FileNotFoundError(key)
    return p


def find_pdf(fp: str) -> Path:
    name = Path(fp).name
    blocked = None
    for cand in [REPO / fp, *[x / name for x in PDF_DIRS], Path.home() / "Downloads" / name]:
        try:
            with cand.open("rb"):
                return cand
        except FileNotFoundError:
            continue
        except PermissionError:  # macOS blocks ~/Downloads for processes without Files access
            blocked = cand
    if blocked:
        raise FileNotFoundError(f"{blocked} exists but macOS blocks reading it; copy it to {REPO / fp}")
    raise FileNotFoundError(f"{name} not found in docs/Source, --pdf-dir or ~/Downloads")


def book_pdf(book: str) -> str:
    """The book's PDF path (repo-relative), from its book config or any of its book records."""
    if not NAME.match(book):
        raise FileNotFoundError(book)
    cfg = EXTRACTION / "books" / f"{book}.json"
    if cfg.exists():
        fp = (json.loads(cfg.read_text()).get("sources") or {}).get("pdf")
        if fp:
            return fp
    for _k, _r, b, _p, d in book_records():
        if b == book:
            return d["source_document"]["file_path"]
    raise FileNotFoundError(f"no PDF known for {book}")


# ------------------------------------------------------------------ misprints

def decisions_path(book: str) -> Path:
    if not NAME.match(book):
        raise ValueError(f"bad book {book!r}")
    return GT_DIR / book / "misprint-decisions.json"


def load_decisions(book: str) -> list[dict]:
    p = decisions_path(book)
    return json.loads(p.read_text()).get("decisions", []) if p.exists() else []


def record_misprints(key: str, role: str, book: str, d: dict) -> list[dict]:
    out = []
    off = (d.get("source_document") or {}).get("page_offset") or 0
    slug = d["lesson"]["slug"]
    for r in d.get("items") or []:
        holders = [(None, r)] + [(p.get("label"), p) for p in r.get("parts") or []]
        for label, h in holders:
            for m in h.get("misprints") or []:
                page = r.get("source_page")
                ref = f"{r['id']}{':' + label if label else ''}#{m.get('field')}"
                out.append({
                    "ref": ref, "book": book, "lesson": slug, "where": f"{r['id'].split(':', 1)[1]}{', part ' + label if label else ''}",
                    "printed_page": page, "pdf_page": page + off if isinstance(page, int) else None,
                    "field": m.get("field"), "printed": m.get("printed", ""), "intended": m.get("intended", ""),
                    "why": m.get("notes", ""), "class": "on a book record", "confidence": None,
                    "stem": r.get("quote") or "", "source": "ground truth" if role == "ground_truth" else "extraction",
                    "file": key, "record_id": r["id"], "part": label, "type": r.get("type"),
                })
    return out


def natural(text: str) -> list:
    """"g10m2s1-1" < "g10m10s2-1": numbers compare as numbers."""
    return [(0, int(x)) if x.isdigit() else (1, x) for x in re.split(r"(\d+)", str(text)) if x]


def misprints() -> list[dict]:
    found: dict[str, dict] = {}
    for key, role, book, _p, d in book_records():
        for m in record_misprints(key, role, book, d):
            if m["ref"] not in found or m["source"] == "ground truth":  # a labelled copy wins over the extraction's
                found[m["ref"]] = m
    for p in sorted((EXTRACTION / "book-records").glob("*/misprint-candidates.json")):
        try:
            data = json.loads(p.read_text())
        except Exception as e:
            sys.stderr.write(f"skipped {p}: {e}\n")
            continue
        for c in data.get("candidates") or []:
            found.setdefault(c["ref"], {**c, "source": "pipeline check"})
    out = list(found.values())
    latest: dict[tuple[str, str], dict] = {}
    for book in {m["book"] for m in out}:
        for dec in load_decisions(book):
            latest[(book, dec["ref"])] = dec
    for m in out:
        m["decision"] = latest.get((m["book"], m["ref"]))
    # whether the pipeline places it (answer_gen.apply_misprints, the one every step reads the record through): a
    # decided misprint it cannot place reaches students as printed, and fails the coverage audit (misprints_applied)
    decisions = answer_gen.misprint_decisions()
    docs: dict[str, dict] = {}
    for m in out:
        if m.get("class") != "on a book record" or not m.get("file"):
            continue
        if m["file"] not in docs:
            docs[m["file"]] = json.loads(resolve_key(m["file"]).read_text())
        it = next((x for x in docs[m["file"]].get("items") or [] if x["id"] == m.get("record_id")), None)
        if not it:
            continue
        missed = {x["ref"] for x in answer_gen.apply_misprints(it, decisions)[1]}
        m["applied"] = m["ref"] not in missed
        h = it if not m.get("part") else next((p for p in it.get("parts") or [] if p.get("label") == m["part"]), {})
        key = re.match(r"[a-z_]+", m.get("field") or "")
        val = h.get(key.group(0)) if key else None
        m["record_text"] = val if isinstance(val, str) else "\n".join(f"[{i}] {x}" for i, x in enumerate(val or []) if isinstance(x, str))
    # a decision whose misprint is no longer on any record ("not a misprint" removes it) stays listed as decided
    have = {(m["book"], m["ref"]) for m in out}
    for (book, ref), dec in latest.items():
        if (book, ref) not in have:
            rid, _, field = ref.partition("#")
            out.append({"ref": ref, "book": book, "lesson": rid.split(":", 1)[0], "where": rid.split(":", 1)[-1], "field": field,
                        "printed_page": None, "pdf_page": None, "printed": dec.get("printed", ""), "intended": dec.get("intended", ""),
                        "why": "", "class": "removed from the record", "confidence": None, "stem": "", "source": "ground truth",
                        "decision": dec})
    return sorted(out, key=lambda m: (m["book"], natural(m["lesson"]), natural(m["ref"])))


def decide_misprint(body: dict) -> dict:
    book, ref, decision, by = body.get("book"), body.get("ref"), body.get("decision"), (body.get("by") or "").strip()
    if decision not in DECISIONS or not ref or not by:
        raise ValueError("needs book, ref, a decision (confirmed, corrected, not_a_misprint) and your initials")
    m = next((x for x in misprints() if x["book"] == book and x["ref"] == ref), None)
    if not m:
        raise ValueError(f"no misprint {ref} in {book}")
    intended = (body.get("intended") or "").strip()
    match = (body.get("match") or "").strip()
    if decision == "corrected" and not intended:
        raise ValueError("a different correction needs what the book means")
    entry = {"ref": ref, "decision": decision, "by": by, "at": date.today().isoformat()}
    if decision == "corrected":
        entry["intended"] = intended
    elif decision == "confirmed":
        entry["intended"] = m["intended"]
    entry["printed"] = m["printed"]
    if match and decision != "not_a_misprint":
        # the exact text in the record that is the misprint, for one the page's words do not find: kept only when
        # the pipeline then places it, so a decision can never claim a fix that does not happen
        rec = json.loads(resolve_key(m["file"]).read_text()) if m.get("file") else {}
        it = next((x for x in rec.get("items") or [] if x["id"] == m.get("record_id")), None)
        entry["match"] = match
        if not it or ref in {x["ref"] for x in answer_gen.apply_misprints(it, {**answer_gen.misprint_decisions(), ref: entry})[1]}:
            raise ValueError("that text is not in the record: copy it exactly from “What the record says”")
    if (body.get("note") or "").strip():
        entry["note"] = body["note"].strip()
    p = decisions_path(book)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(p.read_text()) if p.exists() else {"format": "ainext.misprint-decisions/1", "book": book, "decisions": []}
    data["decisions"].append(entry)  # append-only: a changed mind is a new entry
    write_json(p, data)
    if m["source"] == "ground truth" and decision != "confirmed":
        apply_to_record(m, entry)
    return entry


def apply_to_record(m: dict, entry: dict) -> None:
    """A decision on a misprint the ground truth carries changes that record: removed, or its correction replaced."""
    p = resolve_key(m["file"])
    d = json.loads(p.read_text())
    r = next(x for x in d["items"] if x["id"] == m["record_id"])
    h = r if not m["part"] else next(x for x in r["parts"] if x.get("label") == m["part"])
    ms = h.get("misprints") or []
    hit = next((x for x in ms if x.get("field") == m["field"] and x.get("printed") == m["printed"]), None)
    if not hit:
        return
    if entry["decision"] == "not_a_misprint":
        ms.remove(hit)
        if not ms:
            h.pop("misprints", None)
    else:
        hit["intended"] = entry["intended"]
    where = "misprints" if h is r else f"parts[{m['part']}].misprints"
    ((r.setdefault("review", {})).setdefault("edits", [])).append(
        {"by": entry["by"], "at": entry["at"], "fields": [f"{where}: {entry['decision'].replace('_', ' ')}"]})
    write_json(p, d)


# A statement is what the tutor quotes (compile's statements): its wording fields are what a label can correct.
STATEMENT_TYPES = {"definition", "rule", "caution", "convention", "method", "key_term", "prior_knowledge"}
STATEMENT_FIELDS = ("claim", "term", "text", "quote", "formula", "examples", "notation", "notes")


def statement_pair(ext: dict, gt: dict, gt_id: str) -> tuple[dict, dict]:
    """The ground truth's statement and the book record's item for the same printed thing: paired by content, as the
    overlay pairs them; failing that (its wording was corrected past recognition), the extracted item of that id and
    type that no other ground-truth record claims."""
    g = next((r for r in gt.get("items") or [] if r.get("id") == gt_id), None)
    if g is None or g.get("type") not in STATEMENT_TYPES:
        raise ValueError(f"{gt_id} is not a statement of the ground truth")
    pairs, _m, _i = score_book_record.match_by_content(ext.get("items") or [], gt.get("items") or [])
    paired = {gg["id"]: e for gg, e, _how in pairs}
    e = paired.get(gt_id)
    if e is None:
        claimed = {x["id"] for x in paired.values()}
        e = next((r for r in ext.get("items") or [] if r.get("id") == gt_id and r.get("type") == g["type"] and r["id"] not in claimed), None)
    if e is None:
        raise ValueError(f"no item of the book record is {gt_id}: nothing to apply it to")
    return g, e


def statement_diff(ext_key: str, gt_key: str, gt_id: str) -> dict:
    ext, gt = json.loads(resolve_key(ext_key).read_text()), json.loads(resolve_key(gt_key).read_text())
    g, e = statement_pair(ext, gt, gt_id)
    return {"record_id": e["id"], "fields": {k: {"book_record": e.get(k), "labelled": g.get(k)}
                                             for k in STATEMENT_FIELDS if e.get(k) != g.get(k)}}


def apply_statement(body: dict) -> dict:
    """A labelled statement's wording into the book record (Tamer, 2026-10-17: a corrected definition must reach the tutor,
    not only the scoring copy). Compile reads the book record; the provenance check sees the statement changed and
    checks it again on its next run. The item keeps a trace in its review.edits."""
    by = (body.get("by") or "").strip()
    if not by:
        raise ValueError("type your initials")
    ext_p, gt_p = resolve_key(body["ext"]), resolve_key(body["gt"])
    if not (body["ext"].startswith("1/") and body["gt"].startswith("0/")):
        raise ValueError("ext must be a book record, gt its ground truth")
    ext, gt = json.loads(ext_p.read_text()), json.loads(gt_p.read_text())
    if (ext.get("lesson") or {}).get("slug") != (gt.get("lesson") or {}).get("slug"):
        raise ValueError("the two files are not the same lesson")
    g, e = statement_pair(ext, gt, body["id"])
    changed = [k for k in STATEMENT_FIELDS if e.get(k) != g.get(k)]
    if not changed:
        return {"record_id": e["id"], "fields": []}
    for k in changed:
        if g.get(k) is None:
            e.pop(k, None)
        else:
            e[k] = g[k]
    ((e.setdefault("review", {})).setdefault("edits", [])).append(
        {"by": by, "at": date.today().isoformat(), "fields": [f"applied from the ground truth ({g['id']}): {', '.join(changed)}"]})
    write_json(ext_p, ext)
    return {"record_id": e["id"], "fields": changed}


REFRESH_LOCK = threading.Lock()
SCRATCH_DSN: list[str] = []   # --scratch-dsn: a refresh also loads this LOCAL scratch database again


# ---- what a refresh has not taken in yet (Tamer, 2026-10-21: "clear … whether we should re-compile after or not") ----
# Every decision saved here is also written, with the time, to reviews/<book>/decision-log.jsonl; a refresh that
# finishes records its time in reviews/<book>/last-refresh.json. A decision logged after the last refresh is one
# the book does not have yet. (Decisions made before the log existed are not counted: the log starts empty.)
TASK_OF = {"/api/misprint-decision": "misprints", "/api/answers/decision": "answers", "/api/objectives/decision": "objectives",
           "/api/g2/decision": "g2", "/api/maths/decision": "maths", "/api/tiers/decision": "tiers",
           "/api/held/decision": "held", "/api/generated/decision": "generated", "/api/context/decision": "context"}


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def journal(book: str, task: str, body: dict) -> None:
    if not NAME.match(book or ""):
        return
    d = EXTRACTION / "reviews" / book
    d.mkdir(parents=True, exist_ok=True)
    row = {"ts": _now(), "task": task, "ref": body.get("ref") or body.get("question") or body.get("file"),
           "decision": body.get("decision") or body.get("choice") or body.get("tier"), "by": body.get("by")}
    with (d / "decision-log.jsonl").open("a") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def last_refresh(book: str) -> str | None:
    p = EXTRACTION / "reviews" / book / "last-refresh.json"
    return json.loads(p.read_text()).get("ts") if p.exists() else None


def pending(book: str) -> dict:
    """{since, by_task: {task: n}, total}: the decisions logged since the last refresh finished."""
    if not NAME.match(book or ""):
        raise ValueError(f"no book {book!r}")
    since = last_refresh(book)
    p = EXTRACTION / "reviews" / book / "decision-log.jsonl"
    by_task: dict[str, int] = {}
    for line in (p.read_text().splitlines() if p.exists() else []):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if since is None or r.get("ts", "") > since:
            by_task[r["task"]] = by_task.get(r["task"], 0) + 1
    return {"since": since, "by_task": by_task, "total": sum(by_task.values())}


def refresh_book(book: str) -> dict:
    """`ingest.py refresh <book>`: the decisions made here into the book records and the compiled book (no model call)."""
    if not NAME.match(book or "") or not (EXTRACTION / "books" / f"{book}.json").exists():
        raise ValueError(f"no book {book!r}")
    if not REFRESH_LOCK.acquire(blocking=False):
        raise ValueError("a refresh is already running")
    try:
        argv = ["uv", "run", "ingest.py", "refresh", book, "--json", *(["--dsn", SCRATCH_DSN[0]] if SCRATCH_DSN else [])]
        p = subprocess.run(argv, cwd=EXTRACTION, text=True, capture_output=True, timeout=1800)
        # the report is the JSON object on stdout; a library may write a line before it (MuPDF prints "format error:
        # cmsOpenProfileFromMem failed" to stdout on a book whose PDF carries a colour profile), which is not a failure
        out = p.stdout
        start = 0 if out.startswith("{") else out.find("\n{") + 1
        try:   # a refresh that finishes records its start in reviews/<book>/last-refresh.json (ingest.py refresh)
            return json.loads(out[start:]) if start or out.startswith("{") else json.loads(out)
        except ValueError:
            return {"ok": False, "steps": [], "error": (p.stderr or p.stdout).strip()[-600:] or f"exit {p.returncode}"}
    finally:
        REFRESH_LOCK.release()


def create_ground_truth(book: str, slug: str, data: dict) -> str:
    if not NAME.match(book) or not NAME.match(slug):
        raise ValueError("bad book or lesson slug")
    if data.get("schema") != "book-record" or data.get("role") != "ground_truth":
        raise ValueError("not a ground-truth book record")
    p = GT_DIR / book / f"{slug}.json"
    if p.exists():
        raise ValueError(f"{p.relative_to(GT_DIR)} exists already")
    p.parent.mkdir(parents=True, exist_ok=True)
    write_json(p, data)
    return f"0/{p.relative_to(GT_DIR).as_posix()}"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if not self.path.startswith("/pdf"):
            sys.stderr.write("%s\n" % (fmt % args))

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path, ctype: str):
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_pdf(self, path: Path):
        size = path.stat().st_size
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
        if m:
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = size - int(m.group(2))
            end = min(end, size - 1)
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with path.open("rb") as f:
            f.seek(start)
            left = end - start + 1
            try:
                while left > 0:
                    chunk = f.read(min(1 << 20, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass  # PDF.js aborts the first full request once it knows ranges work

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/":
                return self.send_file(HERE / "review.html", "text/html; charset=utf-8")
            if u.path == "/tokens.css":
                return self.send_file(TOKENS_CSS, "text/css; charset=utf-8")
            if u.path == "/api/lessons":
                return self.send_json(lessons())
            if u.path == "/api/lesson-match":
                # which extracted record is which ground-truth record, by content only (the scorer's quote/text match):
                # every pair, equal ids included; an extracted record left out has no labelled counterpart
                ext = json.loads(resolve_key(q["ext"]).read_text())
                gt = json.loads(resolve_key(q["gt"]).read_text())
                pairs, _missing, _invented = score_book_record.match_by_content(ext.get("items") or [], gt.get("items") or [])
                return self.send_json({e["id"]: g["id"] for g, e, _how in pairs})
            if u.path == "/api/statement-diff":
                # what the book record (what compile teaches from) says of a labelled statement, where it differs
                return self.send_json(statement_diff(q["ext"], q["gt"], q["id"]))
            if u.path == "/api/provenance":
                # the statements S2's provenance check could not confirm (book_record_provenance.py), for Label extraction
                return self.send_json(provenance.flags(q["book"], q["slug"]))
            if u.path == "/api/misprints":
                return self.send_json(misprints())
            if u.path == "/api/pending":
                return self.send_json(pending(q["book"]))
            if u.path == "/api/answers/books":
                return self.send_json(answers.books())
            if u.path == "/api/answers":
                return self.send_json(answers.summary(q["book"]))
            if u.path == "/api/answers/item":
                return self.send_json(answers.detail(q["book"], q["ref"]))
            if u.path == "/api/objectives/books":
                return self.send_json(objectives.books())
            if u.path == "/api/objectives":
                return self.send_json(objectives.summary(q["book"]))
            if u.path == "/api/objectives/item":
                return self.send_json(objectives.detail(q["book"], q["kind"], q["ref"]))
            if u.path == "/api/g2/books":
                return self.send_json(book_questions.books())
            if u.path == "/api/g2":
                return self.send_json(book_questions.summary(q["book"]))
            if u.path == "/api/g2/item":
                return self.send_json(book_questions.detail(q["book"], q["question"]))
            if u.path == "/api/maths/books":
                return self.send_json(maths_reading.books())
            if u.path == "/api/maths":
                return self.send_json(maths_reading.summary(q["book"]))
            if u.path == "/api/maths/item":
                return self.send_json(maths_reading.detail(q["book"], q["ref"]))
            if u.path == "/api/context/books":
                return self.send_json(context_task.books())
            if u.path == "/api/context":
                return self.send_json(context_task.summary(q["book"]))
            if u.path == "/api/context/item":
                return self.send_json(context_task.detail(q["book"], q["ref"]))
            if u.path == "/api/tiers/books":
                return self.send_json(tiers.books())
            if u.path == "/api/tiers":
                return self.send_json(tiers.summary(q["book"]))
            if u.path == "/api/tiers/item":
                return self.send_json(tiers.detail(q["book"], q["ref"]))
            if u.path == "/api/held/books":
                return self.send_json(held.books())
            if u.path == "/api/held":
                return self.send_json(held.summary(q["book"]))
            if u.path == "/api/held/item":
                return self.send_json(held.detail(q["book"], q["kind"], q["file"]))
            if u.path == "/api/generated/books":
                return self.send_json(generated.books())
            if u.path == "/api/generated":
                return self.send_json(generated.summary(q["book"]))
            if u.path == "/api/generated/item":
                return self.send_json(generated.detail(q["book"], q["kind"], q["ref"]))
            if u.path == "/api/generated/crop":
                return self.send_file(generated.crop_path(q["book"], q["figure"]), "image/png")
            if u.path == "/api/file":
                return self.send_json(json.loads(resolve_key(q["path"]).read_text()))
            if u.path == "/pdf":
                fp = book_pdf(q["book"]) if "book" in q else json.loads(resolve_key(q["path"]).read_text())["source_document"]["file_path"]
                return self.send_pdf(find_pdf(fp))
        except (FileNotFoundError, KeyError) as e:
            return self.send_json({"error": str(e)}, 404)
        self.send_json({"error": "not found"}, 404)

    def do_HEAD(self):
        self.send_response(200 if urlparse(self.path).path == "/" else 404)
        self.end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if u.path == "/api/file":
                p = resolve_key(q["path"])
                if not isinstance(body, dict) or "items" not in body or body.get("schema") != "book-record":
                    raise ValueError("not a book record")
                write_json(p, body)
                return self.send_json({"ok": True})
            if u.path == "/api/ground-truth":
                return self.send_json({"ok": True, "path": create_ground_truth(q["book"], q["slug"], body)})
            if u.path == "/api/refresh":
                return self.send_json(refresh_book(body.get("book")))
            if u.path == "/api/statement-apply":
                return self.send_json({"ok": True, **apply_statement(body)})
            if u.path in TASK_OF:
                decide = {"/api/misprint-decision": decide_misprint, "/api/answers/decision": answers.decide,
                          "/api/objectives/decision": objectives.decide, "/api/g2/decision": book_questions.decide,
                          "/api/maths/decision": maths_reading.decide, "/api/tiers/decision": tiers.decide,
                          "/api/held/decision": held.decide, "/api/generated/decision": generated.decide,
                          "/api/context/decision": context_task.decide}[u.path]
                entry = decide(body)
                journal(body.get("book"), TASK_OF[u.path], body)   # saved: the next refresh has it to take in
                return self.send_json({"ok": True, "decision": entry})
        except (FileNotFoundError, KeyError, ValueError, StopIteration) as e:
            return self.send_json({"error": str(e)}, 400)
        self.send_json({"error": "not found"}, 404)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=3020)
    ap.add_argument("--pdf-dir", action="append", default=[], help="extra folder to look for book PDFs in")
    ap.add_argument("--records", action="append", default=[], help="extra folder of book records to open")
    ap.add_argument("--scratch-dsn", help="a LOCAL scratch database the home page's Refresh also loads again")
    a = ap.parse_args()
    if a.scratch_dsn:
        SCRATCH_DSN.append(a.scratch_dsn)
    PDF_DIRS.extend(Path(x).expanduser() for x in a.pdf_dir)
    ROOTS.extend(("extraction", Path(x).expanduser().resolve()) for x in a.records)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"Noor review: http://127.0.0.1:{a.port}  (Ctrl+C to stop)")
    for name, root in ROOTS:
        print(f"  {name}: {root}{'' if root.is_dir() else '  (not there yet)'}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

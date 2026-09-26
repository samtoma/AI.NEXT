"""S1 objectives: the packets the line's model stages read, and the deterministic checks on what S1 found.

    uv run assemble_objectives.py s1-args     <book> --chapter 8 [--by-ref [DIR]] [--out args.json]
    uv run assemble_objectives.py assemble    <book> runs/<book>/objectives/ch08-<runId>.json
    uv run assemble_objectives.py approve     <book> --chapter 8 --by "<name>" [--verdicts g1.json]
    uv run assemble_objectives.py lesson-args <book> --lessons g10m8s2-1,g10m8s3-1 [--out args.json]
    uv run assemble_objectives.py lesson-runs <book> runs/<book>/lessons/<runId>.json [--g2 g2.json]

    inputs, each defaulted from the book config:  --blocks work/<book>/blocks.jsonl
        --manifest <config manifest>  --maths runs/<book>/maths/accepted.json
        --objectives-dir objectives/<book>  --runs-dir runs/<book>
        --book-config <file>  (a config outside books/, for tests)

Design: docs/specs/extraction-pipeline.md §3.4 (S1), build items B4/B5, tasks T334/T335.
The lesson packets and run files serve B6 (T337, runbook/lesson.workflow.js).

POLICY, NOT A REQUIREMENT. Deriving objectives from a book that prints none is pipeline
policy (Samuel, decision 12; ADR-0005 amendment #1). Spec 003 carries no FR about
objectives, and nothing here cites one.

THE COMMANDS
  s1-args      one chapter's S1 packet for runbook/objectives.workflow.js: every lesson's
               text blocks, worked examples and exercise problems (never a solution or an
               answer), the chapter introduction and summary, and the items S1 must
               distribute: the end-of-chapter set, and a split section's shared set (6-6).
               Maths image references become S0b's accepted LaTeX. A chapter that needs an
               image S0b has not accepted is refused: it waits for G0b (FR-4407). Teacher-only
               blocks never enter a packet (FR-4408). With --by-ref the text goes to shard
               files (packet_ref.py) and the args keep only what the workflow's control flow
               reads; `packet_sha256` still covers the whole packet.
  assemble     applies the §3.4 rules to a saved S1 return value. Writes
               objectives/<book>/<lesson>.json (the shape assemble_lesson_bundle.py reads),
               chNN.review.html (the G1 page), chNN.check.json and terminology-flags.json.
               Exits 1 when a rule fails; the files are still written, marked `rejected`,
               so G1 can see why.
  approve      records gate G1 for a chapter. It applies the reviewer's verdicts (approve,
               edit or drop an objective; move an item; rule an end-of-chapter item outside the
               chapter's objectives, with a reason — answer 15; keep a flagged term; acknowledge a
               finding), re-runs every rule, and refuses while a rule fails or a decision G1
               owes has no verdict. It never adds evidence: only the book can, through a new
               S1 run.
  lesson-args  builds runbook/lesson.workflow.js's args (S2–S4, S8) for lessons G1 approved,
               and refuses any other.
  lesson-runs  splits a saved lesson-workflow return value into runs/<book>/lesson/<slug>.json,
               the per-lesson file assemble_lesson_bundle.py reads, with any G2 verdicts
               recorded on the items. Every file is validated against that assembler's own
               input models, so the handoff cannot drift silently.

THE RULES (§3.4), checked here
  1 grounded     >= 2 valid evidence items of DIFFERENT kinds, one of them a worked example or
                 an exercise. Valid: known kind; the anchor resolves in the chapter packet and
                 is of that kind; the page is the anchor's printed page; the quote is at the
                 anchor (a normalised substring test, else the Haiku check's `present`); the
                 Haiku check says it `supports` the objective; and a finder cited it (the
                 reconciler chooses evidence, never invents it).
  2 partition    every exercise item of the lesson, and every distributed item given to it,
                 maps to exactly one objective. The one relaxation (Samuel's answer 15 (b),
                 2026-09-26): a distributed item G1 rules "outside this chapter's objectives"
                 (`outside_items`, with a reason) maps to none; it is kept out of practice, named in
                 the lesson records with who, when and why, and listed by coverage_report.py as a
                 named exception. Answer 15 (c): the finders also read the end-of-chapter items in
                 their lesson's scope and may cite one as exercise evidence (never list it: the two
                 mappers place them); an objective no item ends up mapped to is a G1 decision.
  3 terminology  the book's terms are kept. A term missing from the Egyptian maths book's own
                 words (the English-medium Prep-3 bundles), or one the reconciler flags, goes to
                 terminology-flags.json for G1. No statement is rewritten.
  4 granularity  2 to 5 objectives per lesson; "understand"-type verbs are warned.
  5 independence confidence is recomputed from which finders found each objective. None =
                 failure (invented). `single`, a finder objective dropped without a reason, and
                 an item the two mappers placed differently are decisions G1 owes. The
                 distributed items are mapped by TWO blind mappers by default (Samuel's answer
                 12); a run that asked for the second and has none fails rule 2.
  6 order        numbered in book order (warning when the first practice runs backwards).

PREREQUISITE LINKS (Samuel's answer 4, 2026-09-25). The S1 run also carries the links a linker
found between objectives from the book's own evidence ("recall", a reference back to an earlier
section, a method used before it is taught here) and an independent checker's verdict on each.
A link is KEPT only when: both ends are objectives (the destination in this chapter, the source
in this chapter or in an earlier chapter already approved at G1), its signal is known, at least
one cited evidence item is at its anchor (the destination's lesson, the anchor's page, the quote
contained), the checker said CONFIRMED, and G1 did not drop it. A link between two parts of one
split section is DROPPED: part n-1 -> n is derived from the book-sections store and never written
(FR-4317). A link that runs backwards in book order is a decision G1 owes. Kept links go into the
destination lesson's objectives file as `prerequisites` (with their evidence), which the bundle
assembler writes as `prerequisite_of` edges; the review page shows every link, kept or dropped.

THE BLOCKS (source_adapter.py, WP-P1): work/<book>/blocks.jsonl, one typed block per line in
reading order. Fields read here: id, type, chapter, section, printed_page(_range), text (maths
as ⟦m:<md5>⟧, figures as ⟦fig:<src>⟧), heading {level, code, title}, definition {term},
box {kind, title}, worked_example {n, title, question{text}, steps[{title, text}],
loose_solution{text}}, exercise_header {exercise, q}, exercise_item {exercise, q, sub,
problem{text, figures}, solution{text, maths, math_kinds}, printed_answer{text, scope},
shortcode, end_of_chapter}. Only the functions in "blocks" below read these fields.

THE LESSONS AFTER G0: the manifest's lessons when they carry their book provenance
(`sections`, `part`, `chapter_intro`: build_manifest.py, T402). Until that manifest exists
the scouting draft's lessons are read with the book config's `lesson_unit` (G0's decisions)
applied — a bridge, used only when no lesson in the chapter carries `sections`.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import book_config
from schemas import LESSON_SLUG_RE, VIZ_KINDS, Lesson, lo_id

HERE = Path(__file__).resolve().parent
OBJECTIVES_VERSION = 1

EVIDENCE_KINDS = ("heading", "intro", "summary", "definition", "worked_example", "exercise")
PRACTICE_KINDS = ("worked_example", "exercise")
MIN_OBJECTIVES, MAX_OBJECTIVES = 2, 5
VAGUE_VERBS = ("understand", "know", "appreciate", "be aware", "learn about", "grasp",
               "comprehend")
MATH_REF_RE = re.compile(r"⟦m:([0-9a-f]{32})⟧")
FIG_REF_RE = re.compile(r"⟦fig:([^⟧]+)⟧")
TEXT_TYPES = ("heading", "para", "box", "definition", "list", "table", "summary_item", "unparsed")
# The maths kinds of VIZ_SPEC.md (v1). The social kinds are VIZ_KINDS too, but a maths
# figure is never drawn as a map, a timeline or a flow chain.
MATH_VIZ_KINDS = ("coordinate_plot", "function_graph", "arrow_map", "product_grid",
                  "ratio_bars", "stat_chart", "trig_triangle", "geo_scene", "number_line")
assert set(MATH_VIZ_KINDS) <= VIZ_KINDS


class StageError(Exception):
    """A refusal a human must act on. The command prints it and exits 2."""


# ============================================================================ blocks
def load_blocks(path: Path) -> list[dict]:
    if not path.exists():
        raise StageError(f"no blocks at {path}: run `uv run source_adapter.py <book>` (S0a) first")
    out = []
    for i, line in enumerate(path.read_text().splitlines(), 1):
        if line.strip():
            b = json.loads(line)
            if "id" not in b or "type" not in b:
                raise StageError(f"{path}:{i}: a block without id or type")
            out.append(b)
    if len({b["id"] for b in out}) != len(out):
        raise StageError(f"{path}: block ids repeat")
    return out


def load_maths(path: Path | None) -> dict[str, str]:
    """S0b's accepted map, md5 -> LaTeX. Reads {md5: latex}, {md5: {latex, accepted_by}} or
    {"accepted": {...}}, whichever assemble_maths.py (WP-P8) writes."""
    if path is None or not path.exists():
        return {}
    raw = json.loads(path.read_text())
    if isinstance(raw, dict) and isinstance(raw.get("accepted"), dict):
        raw = raw["accepted"]
    out = {}
    for k, v in raw.items():
        latex = v.get("latex") if isinstance(v, dict) else v
        if isinstance(latex, str) and re.fullmatch(r"[0-9a-f]{32}", k):
            out[k] = latex
    return out


def _t(x) -> str:
    """The text of a block field that is either a string or an adapter content dict."""
    if isinstance(x, dict):
        return x.get("text") or ""
    return x or ""


def render(text, maths: dict[str, str], missing: set[str] | None) -> str:
    """Prose with every ⟦m:md5⟧ replaced by $LaTeX$ from S0b, and every figure by [figure].
    An image S0b has not accepted is collected into `missing`, never guessed (FR-4407)."""
    text = _t(text)
    if not text:
        return ""

    def sub(m: re.Match) -> str:
        h = m.group(1)
        if h not in maths:
            if missing is not None:
                missing.add(h)
            return f"⟦m:{h}⟧"
        return f"${maths[h]}$"
    text = FIG_REF_RE.sub(" [figure] ", MATH_REF_RE.sub(sub, text))
    return re.sub(r"\s+", " ", text).strip()


def solution_steps(content, maths, missing) -> list[str]:
    """An EPUB solution as the book lays it out: prose runs and display maths, one step each.
    Nothing is reworded; a display equation (often a whole aligned derivation) is one step."""
    if not isinstance(content, dict):
        s = render(content, maths, missing)
        return [s] if s else []
    text = content.get("text") or ""
    kinds = list(content.get("math_kinds") or [])
    steps, buf, k = [], [], 0
    pos = 0
    for m in MATH_REF_RE.finditer(text):
        kind = kinds[k] if k < len(kinds) else "inline"
        k += 1
        buf.append(text[pos:m.start()])
        if kind == "block":
            prose = render("".join(buf), maths, missing)
            if prose:
                steps.append(prose)
            buf = []
            eq = render(m.group(0), maths, missing)
            if eq:
                steps.append(eq)
        else:
            buf.append(m.group(0))
        pos = m.end()
    buf.append(text[pos:])
    tail = render("".join(buf), maths, missing)
    if tail:
        steps.append(tail)
    return steps


def item_ref(b: dict) -> str:
    """`Ex8-2:5a`: exercise label, question number, sub-part (the book's own identity for an
    item; assemble_lesson_bundle.py mints q:<lo tail>:ex8-2-5a from it)."""
    return f"Ex{b['exercise']}:{b['q']}{b.get('sub') or ''}"


def we_ref(b: dict) -> str:
    """`WE3`: worked examples are numbered per chapter."""
    return f"WE{b['n']}"


def _figure_srcs(*contents) -> list[str]:
    out = []
    for c in contents:
        if isinstance(c, dict):
            out += [f["src"] for f in c.get("figures") or [] if f.get("src")]
    return out


def norm_quote(s: str) -> str:
    """Case, spacing, dashes, quotes and maths delimiters do not count in the containment test."""
    s = unicodedata.normalize("NFKC", s or "")
    for a, b in (("−", "-"), ("–", "-"), ("—", "-"), ("“", '"'), ("”", '"'), ("’", "'"),
                 ("‘", "'"), ("$", "")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip().lower()


# ============================================================================ lessons after G0
def _codes(xs) -> list[str]:
    return [x.get("code") if isinstance(x, dict) else x for x in (xs or []) if x]


def _numbers(xs) -> list[int]:
    return [int(x.get("n")) if isinstance(x, dict) else int(x) for x in (xs or [])]


def _labels(xs) -> list[str]:
    return [x.get("label") if isinstance(x, dict) else x for x in (xs or [])]


def chapter_module(manifest: dict, chapter: int) -> dict:
    for m in manifest.get("modules", []):
        if int(m.get("chapter", -1)) == int(chapter):
            return m
    raise StageError(f"the manifest has no chapter {chapter}")


def module_lessons(module: dict, book) -> list[dict]:
    """The chapter's lessons after G0, each with its book provenance and the inventory that
    places its blocks: {id, title, sections, part, chapter_intro, order_in_module,
    printed_pages, subheadings, worked_examples, exercise_sets, shared_sets, starts_at}.

    Read from the post-G0 manifest (build_manifest.py: `book_provenance`, and for a part the
    block it starts at, `epub.part_starts_at`). A draft manifest without provenance is read
    with the book config's `lesson_unit` applied (the bridge below)."""
    lessons = module.get("lessons", [])
    shared = {}
    for g in module.get("section_exercises_to_map") or []:
        for slug in g.get("lessons") or []:
            shared[slug] = [e.get("label") for e in g.get("exercises") or []]
    if lessons and all(("book_provenance" in l) or ("sections" in l) for l in lessons):
        out = []
        for i, l in enumerate(lessons, 1):
            bp = l.get("book_provenance") or l
            out.append({"id": l["id"], "title": l.get("part_title") or l["title"],
                        "sections": [{"number": x["number"], "title": x["title"]} for x in bp["sections"]],
                        "part": bp.get("part"), "chapter_intro": bool(bp.get("chapter_intro")),
                        "order_in_module": l.get("order_in_module") or i,
                        "printed_pages": l.get("printed_pages"),
                        "subheadings": _codes(l.get("subheadings")),
                        "worked_examples": _numbers(l.get("worked_examples")),
                        "exercise_sets": [x for x in _labels(l.get("exercises") or l.get("exercise_sets")) if x],
                        "shared_sets": shared.get(l["id"], list(l.get("shared_exercise_sets") or [])),
                        "starts_at": (l.get("epub") or {}).get("part_starts_at")})
        return _checked(out)
    # the bridge: a scouting draft + the book config's G0 decisions (until T402's manifest)
    unit = getattr(book, "lesson_unit", None)
    if unit is None:
        raise StageError(f"chapter {module.get('chapter')}: the manifest's lessons carry no book "
                         "provenance and the book config records no G0 lesson_unit")
    ch = int(module["chapter"])
    prefix = book.id_prefixes[0]
    splits = {s.section: s for s in unit.splits}
    promos = {p.section for p in unit.promotions}
    merges = {s: m for m in unit.merges for s in m.sections}
    draft = list(lessons)
    intro = module.get("introduction")
    if intro and intro.get("section") in promos:
        draft.insert(0, dict(intro, _promoted=True))
    out, merged_done = [], set()
    for l in draft:
        sec = l["section"]
        if sec in splits:
            sp = splits[sec]
            for k, p in enumerate(sp.parts, 1):
                out.append({"id": f"{prefix}{ch}s{sec.split('.')[1]}-{k}", "title": p.title,
                            "sections": [{"number": sec, "title": l["title"]}],
                            "part": {"n": k, "of": len(sp.parts)}, "chapter_intro": False,
                            "printed_pages": l.get("printed_pages"), "subheadings": list(p.subheadings),
                            "worked_examples": list(p.worked_examples), "exercise_sets": list(p.exercise_sets),
                            "shared_sets": list(sp.unassigned_exercise_sets), "starts_at": None})
            continue
        if sec in merges:
            m = merges[sec]
            if m.id in merged_done:
                continue
            merged_done.add(m.id)
            members = [x for x in draft if x["section"] in m.sections]
            head = next(x for x in members if x["section"] == m.slug_section)
            pages = [p for x in members for p in (x.get("printed_pages") or [])]
            out.append({"id": f"{prefix}{ch}s{m.slug_section.split('.')[1]}-1", "title": head["title"],
                        "sections": [{"number": x["section"], "title": x["title"]} for x in members],
                        "part": None, "chapter_intro": False,
                        "printed_pages": [min(pages), max(pages)] if pages else None,
                        "subheadings": [c for x in members for c in _codes(x.get("subheadings"))],
                        "worked_examples": [n for x in members for n in _numbers(x.get("worked_examples"))],
                        "exercise_sets": [s for x in members for s in _labels(x.get("exercises"))],
                        "shared_sets": [], "starts_at": None})
            continue
        out.append({"id": f"{prefix}{ch}s{sec.split('.')[1]}-1", "title": l["title"],
                    "sections": [{"number": sec, "title": l["title"]}], "part": None,
                    "chapter_intro": bool(l.get("_promoted")), "printed_pages": l.get("printed_pages"),
                    "subheadings": _codes(l.get("subheadings")), "worked_examples": _numbers(l.get("worked_examples")),
                    "exercise_sets": _labels(l.get("exercises")), "shared_sets": [], "starts_at": None})
    for i, l in enumerate(out, 1):
        l["order_in_module"] = i
    return _checked(out)


def _checked(lessons: list[dict]) -> list[dict]:
    for l in lessons:
        Lesson(slug=l["id"], title=l["title"], sections=l["sections"], part=l.get("part"),
               chapter_intro=l["chapter_intro"], order_in_module=l["order_in_module"])
    return lessons


def provenance(l: dict) -> dict:
    return {"sections": l["sections"], "part": l.get("part"), "chapter_intro": l["chapter_intro"]}


# ============================================================================ membership
def assign_chapter(blocks: list[dict], module: dict, lessons: list[dict]) -> dict:
    """Which of a chapter's blocks belong to which lesson after G0.

    A block's section decides. A split section is cut in reading order: part k starts at its
    first sub-heading, else its first worked example, else its first exercise set (the book's
    own order, as G0 named the parts). An exercise set no part lists is shared: S1 distributes
    its items among that section's parts. The chapter introduction (when not promoted) and the
    summary are chapter evidence; the end-of-chapter set is distributed among all the lessons.
    Question headers are kept apart (they belong to their items). Teacher-only blocks are kept
    apart and are never assigned (FR-4408).
    """
    ch = int(module["chapter"])
    mine = [b for b in blocks if int(b.get("chapter", -1)) == ch]
    out = {"lessons": {l["id"]: [] for l in lessons}, "intro": [], "summary": [], "pool": [],
           "pool_scope": {}, "headers": [], "teacher_only": [], "unassigned": [],
           # which lesson (or part) each teacher-only note sits in, by the same reading-order rule as
           # every other block: the S2 leak check and the coverage count are per lesson (FR-4408)
           "teacher_only_by_lesson": {l["id"]: [] for l in lessons}}
    intro_sec = (module.get("introduction") or {}).get("section")
    summary_sec = (module.get("chapter_summary") or {}).get("section")
    by_section: dict[str, list[dict]] = {}
    for l in lessons:
        for s in l["sections"]:
            by_section.setdefault(s["number"], []).append(l)
    all_slugs = [l["id"] for l in lessons]
    cursor: dict[str, int] = {}

    def starts(b: dict, part: dict) -> bool:
        if part.get("starts_at"):
            return b["id"] == part["starts_at"]
        if part["subheadings"]:
            return b["type"] == "heading" and b.get("code") in part["subheadings"]
        if part["worked_examples"]:
            return b["type"] == "worked_example" and b.get("n") in part["worked_examples"]
        return b["type"] == "exercise_item" and b.get("exercise") in part["exercise_sets"]

    for b in mine:
        t = b["type"]
        if t == "teacher_only":
            out["teacher_only"].append(b)
        if t == "exercise_header":
            out["headers"].append(b)
            continue
        if t == "exercise_item" and b.get("end_of_chapter"):
            out["pool"].append(b)
            out["pool_scope"][item_ref(b)] = list(all_slugs)
            continue
        sec = b.get("section")
        if sec and sec == summary_sec and sec not in by_section:
            if t != "teacher_only":
                out["summary"].append(b)
            continue
        if sec and sec == intro_sec and sec not in by_section:
            if t != "teacher_only":
                out["intro"].append(b)
            continue
        owners = by_section.get(sec or "")
        if not owners:
            if t != "teacher_only":
                out["unassigned"].append(b)
            continue
        if len(owners) == 1:
            if t == "teacher_only":
                out["teacher_only_by_lesson"][owners[0]["id"]].append(b)
            else:
                out["lessons"][owners[0]["id"]].append(b)
            continue
        parts = sorted(owners, key=lambda l: (l.get("part") or {}).get("n", 0))
        k = cursor.get(sec, 0)
        for j in range(k + 1, len(parts)):
            if starts(b, parts[j]):
                k = j
        cursor[sec] = k
        if t == "teacher_only":
            out["teacher_only_by_lesson"][parts[k]["id"]].append(b)
            continue
        if t == "exercise_item":
            listed = [p for p in parts if b.get("exercise") in p["exercise_sets"]]
            if listed and b.get("exercise") not in parts[0]["shared_sets"]:
                out["lessons"][listed[0]["id"]].append(b)
            else:
                # a set that closes the whole section (6-6): S1 distributes it among the parts
                out["pool"].append(b)
                out["pool_scope"][item_ref(b)] = [p["id"] for p in parts]
            continue
        out["lessons"][parts[k]["id"]].append(b)

    for l in lessons:
        have = {b.get("n") for b in out["lessons"][l["id"]] if b["type"] == "worked_example"}
        lost = set(l["worked_examples"]) - have
        if lost:
            raise StageError(f"{l['id']}: G0 gives it worked example(s) {sorted(lost)}, which the "
                             "blocks place elsewhere")
    return out


# ============================================================================ packets
def _headers(headers: list[dict], maths, missing) -> dict:
    """(exercise, q) -> the words a question's parts share; (exercise, None) -> the set's."""
    out: dict = {}
    for h in headers:
        key = (h.get("exercise"), h.get("q"))
        txt = render(h.get("text"), maths, missing)
        if txt:
            out[key] = (out[key] + " " + txt) if key in out else txt
    return out


def item_stem(b: dict, headers: dict, maths, missing) -> str:
    """What the item asks: the set's instruction, the question's, then the part itself."""
    parts = [headers.get((b.get("exercise"), None)), headers.get((b.get("exercise"), b.get("q"))),
             render(b.get("problem"), maths, missing)]
    return " ".join(p for p in parts if p).strip()


def _we(b: dict, maths, missing) -> dict:
    return {"anchor": we_ref(b), "n": b.get("n"), "section": b.get("section"),
            "title": render(b.get("title"), maths, missing),
            "printed_page": b.get("printed_page"),
            "question": render(b.get("question"), maths, missing),
            "steps": [{"title": render(s.get("title"), maths, missing),
                       "text": render(s, maths, missing)} for s in b.get("steps") or []],
            "loose_solution": render(b.get("loose_solution"), maths, missing)}


def _we_text(w: dict) -> str:
    return " ".join([w["title"], w["question"]] + [f"{s['title']} {s['text']}" for s in w["steps"]]
                    + [w["loose_solution"]]).strip()


def _block(b: dict, maths, missing) -> dict:
    out = {"id": b["id"], "type": b["type"], "section": b.get("section"),
           "printed_page": b.get("printed_page"),
           "text": render(b.get("text"), maths, missing)}
    if b["type"] == "heading":
        out.update(anchor=b.get("code"), level=b.get("level"),
                   text=render(b.get("title") or b.get("text"), maths, missing))
    if b["type"] == "box":
        out["kind"] = b.get("kind")
    if b["type"] == "definition":
        out["term"] = b.get("term")
    return out


def packet_sha(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def cite_kinds(block_type: str, scope: str) -> list[str]:
    """The evidence kinds a text block may be cited as, from rule 1's own table (_KIND_TYPES and the
    scope rules of check_evidence): what each S1 text line shows after "cite as:" (S1-v4). A lesson's
    paragraph is `intro` evidence; `definition` is the book's definition and boxed text; `summary`
    only the chapter summary."""
    out = []
    for kind in ("heading", "intro", "summary", "definition"):
        if block_type not in _KIND_TYPES[kind]:
            continue
        if kind == "summary" and scope != "summary":
            continue
        if kind == "intro" and scope not in ("intro", "lesson"):
            continue
        out.append(kind)
    return out


def _cited(b: dict, scope: str) -> dict:
    return dict(b, cite=cite_kinds(b["type"], scope))


def build_s1_packet(book, manifest: dict, blocks: list[dict], maths: dict, chapter: int) -> dict:
    module = chapter_module(manifest, chapter)
    lessons = module_lessons(module, book)
    a = assign_chapter(blocks, module, lessons)
    missing: set[str] = set()
    headers = _headers(a["headers"], maths, missing)
    out_lessons = []
    for l in lessons:
        bs = a["lessons"][l["id"]]
        out_lessons.append({
            "slug": l["id"], "title": l["title"], "provenance": provenance(l),
            "printed_pages": l.get("printed_pages"),
            "blocks": [_cited(_block(b, maths, missing), "lesson") for b in bs if b["type"] in TEXT_TYPES],
            "worked_examples": [_we(b, maths, missing) for b in bs if b["type"] == "worked_example"],
            # the problem only: finders read what is asked, never the solution or the answer
            "items": [{"item_id": item_ref(b), "section": b.get("section"),
                       "printed_page": b.get("printed_page"),
                       "problem": item_stem(b, headers, maths, missing)}
                      for b in bs if b["type"] == "exercise_item"],
        })
    pool = [{"item_id": item_ref(b), "section": b.get("section"), "printed_page": b.get("printed_page"),
             "problem": item_stem(b, headers, maths, missing), "scope": a["pool_scope"][item_ref(b)]}
            for b in a["pool"]]
    packet = {"n": int(module["chapter"]), "module": module["id"], "title": module.get("title"),
              "intro": [_cited(_block(b, maths, missing), "intro") for b in a["intro"] if b["type"] in TEXT_TYPES],
              "summary": [_cited(_block(b, maths, missing), "summary") for b in a["summary"] if b["type"] in TEXT_TYPES],
              "lessons": out_lessons, "pool": pool}
    if missing:
        raise StageError(f"chapter {chapter} needs {len(missing)} maths image(s) S0b has not "
                         f"accepted; it waits for G0b (FR-4407): "
                         f"{', '.join(sorted(missing)[:6])}{' …' if len(missing) > 6 else ''}")
    return {"packet": packet, "teacher_only_dropped": len(a["teacher_only"]),
            "unassigned": [b["id"] for b in a["unassigned"]]}


def prior_objectives(objectives_dir: Path | None, chapter: int) -> list[dict]:
    """The objectives of EARLIER chapters that passed G1: the only sources a prerequisite link may
    name outside its own chapter. Read from the committed objectives files."""
    out: list[dict] = []
    if objectives_dir is None or not Path(objectives_dir).exists():
        return out
    for f in sorted(Path(objectives_dir).glob("*.json")):
        try:
            rec = json.loads(f.read_text())
        except json.JSONDecodeError:
            continue
        if not isinstance(rec, dict) or rec.get("status") != "approved" or "objectives" not in rec:
            continue
        if int(rec.get("chapter") or 0) >= int(chapter):
            continue
        for o in rec["objectives"]:
            out.append({"id": o["id"], "statement": o["statement"], "lesson": rec["lesson"],
                        "section": (o.get("node") or {}).get("syllabus_ref"), "chapter": rec["chapter"]})
    return sorted(out, key=lambda o: (o["chapter"], o["id"]))


def s1_args(book, manifest, blocks, maths, chapter: int, options: dict | None = None,
            prior: list[dict] | None = None) -> dict:
    if book.objectives_mode != "derived":
        raise StageError(f"{book.book} prints its objectives (objectives_mode "
                         f"'{book.objectives_mode}'): S1 transcribes them, it does not derive")
    built = build_s1_packet(book, manifest, blocks, maths, chapter)
    if built["unassigned"]:
        raise StageError(f"chapter {chapter}: {len(built['unassigned'])} block(s) belong to no "
                         f"lesson, introduction or summary: {built['unassigned'][:6]}")
    packet = built["packet"]
    return {"book": {"book": book.book, "course_id": book.course_id, "language": book.language,
                     "objectives_mode": book.objectives_mode, "id_prefixes": book.id_prefixes},
            "stage": "S1", "chapter": packet, "packet_sha256": packet_sha(packet),
            "teacher_only_dropped": built["teacher_only_dropped"],
            "prior_objectives": list(prior or []),
            "options": {"second_mapper": True, "pool_batch": 60, "links": True, **(options or {})}}


# ============================================================================ S1 packet by reference
# `s1-args --by-ref [DIR]` (packet_ref.py): the chapter's text goes to shard files, one per unit of
# agent work, each EXACTLY the text objectives.workflow.js would have put in that prompt; the args
# keep what the script's control flow needs. The renderers below are the workflow's own (blockLine,
# weText, provText, chapterContext, lessonText, the mapper's item lines, the ANCHORS index),
# re-implemented; tests/test_packet_ref.py splices the shards back and compares the prompts.
#
#   context.txt              chapterContext()                          both finders of every lesson
#   lessons/<slug>.A.txt     lessonText(l, ['text', 'we', 'ex'])       finder A; the linker (all lessons)
#   lessons/<slug>.B.txt     lessonText(l, ['we', 'ex', 'text'])       finder B
#   pool/b0001.txt …         one mapper batch's item lines             both blind mappers
#   anchors/a0001.txt …      ANCHORS[key], in the index's own key order the evidence check, the link check
#
# None of them holds an agent's output (they are written before any agent runs), a solution, a
# printed answer or a teacher-only block (the S1 packet never has them).
def _js_block_line(b: dict) -> str:
    from packet_ref import js, js_or, js_truthy
    cite = b.get("cite")
    note = f"; cite as: {' or '.join(cite) if cite else 'nothing'}" if isinstance(cite, list) else ""
    return (f"[{js(js_or(b.get('anchor'), b.get('id')))}] ({js(b.get('type'))}"
            f"{(':' + js(b.get('kind'))) if js_truthy(b.get('kind')) else ''}"
            f"{(': ' + js(b.get('term'))) if js_truthy(b.get('term')) else ''}, p.{js(b.get('printed_page'))}{note}) "
            f"{js(b.get('text'))}")


def _js_we_text(w: dict) -> str:
    from packet_ref import js, js_truthy
    steps = "\n".join(f"  - {(js(s.get('title')) + ': ') if js_truthy(s.get('title')) else ''}{js(s.get('text'))}"
                      for s in w["steps"])
    return (f"[{js(w.get('anchor'))}] Worked example {js(w.get('n'))}: {js(w.get('title'))} "
            f"(p.{js(w.get('printed_page'))})\n  QUESTION: {js(w.get('question'))}\n" + steps
            + (f"\n  {js(w.get('loose_solution'))}" if js_truthy(w.get("loose_solution")) else ""))


def _js_prov_text(p: dict) -> str:
    from packet_ref import js, js_truthy
    return (" + ".join(f"{js(s.get('number'))} {js(s.get('title'))}" for s in p["sections"])
            + (f" (part {js(p['part'].get('n'))} of {js(p['part'].get('of'))})" if js_truthy(p.get("part")) else "")
            + (" (the chapter introduction, taught as a lesson)" if js_truthy(p.get("chapter_intro")) else ""))


def _js_chapter_context(ch: dict) -> str:
    from packet_ref import js
    intro = "\n".join(map(_js_block_line, ch["intro"])) if ch["intro"] else \
        "(no separate introduction: the first lesson opens the chapter)"
    summary = "\n".join(map(_js_block_line, ch["summary"])) if ch["summary"] else "(none)"
    return (f"CHAPTER {js(ch['n'])}: {js(ch.get('title'))}\n\nCHAPTER INTRODUCTION (evidence kind \"intro\"):\n{intro}"
            f"\n\nCHAPTER SUMMARY (evidence kind \"summary\"):\n{summary}")


# Answer 15 (c), s1-v5: the finders also read the end-of-chapter items in their lesson's scope, so an
# objective practised only there can be found. The heading is objectives.workflow.js's POOL_HEAD.
S1_POOL_HEAD = 'END-OF-CHAPTER ITEMS IN THIS LESSON\'S SCOPE — the problems only (evidence kind "exercise", anchor = the item id). Cite one only where it practises a skill this lesson\'s own text or worked examples teach. They are NOT this lesson\'s items: never list one in exercise_items (the chapter\'s two blind mappers place every one of them):'


def pool_in_scope(pool: list[dict], slug: str) -> list[dict]:
    return [p for p in pool if slug in (p.get("scope") or [])]


def _js_lesson_text(l: dict, order: list[str], pool: list[dict] | None = None) -> str:
    from packet_ref import js
    blocks = "\n".join(map(_js_block_line, l["blocks"])) if l["blocks"] else "(none)"
    wes = "\n\n".join(map(_js_we_text, l["worked_examples"])) if l["worked_examples"] else "(none)"
    items = "\n".join(f"[{js(i['item_id'])}] (p.{js(i.get('printed_page'))}) {js(i.get('problem'))}"
                      for i in l["items"]) if l["items"] else "(none)"
    mine = pool_in_scope(pool or [], l["slug"])
    eoc = "\n".join(f"[{js(i['item_id'])}] (p.{js(i.get('printed_page'))}) {js(i.get('problem'))}"
                    for i in mine) if mine else "(none)"
    parts = {"text": f"TEXT, DEFINITIONS AND HEADINGS:\n{blocks}",
             "we": f"WORKED EXAMPLES (evidence kind \"worked_example\", anchor WE<n>):\n{wes}",
             "ex": "EXERCISE ITEMS — the problems only (evidence kind \"exercise\", anchor = the item id, e.g. "
                   f"Ex8-2:5a, or the question Ex8-2:5 for all its parts):\n{items}",
             "pool": f"{S1_POOL_HEAD}\n{eoc}"}
    return (f"LESSON {js(l['slug'])}: {js(l.get('title'))}\nBook section: {_js_prov_text(l['provenance'])}\n\n"
            + "\n\n".join(parts[k] for k in order))


def _js_pool_lines(items: list[dict]) -> str:
    from packet_ref import js
    return "\n".join(f"[{js(i['item_id'])}] (p.{js(i.get('printed_page'))}; may go to: {', '.join(i['scope'])}) "
                     f"{js(i.get('problem'))}" for i in items)


def _js_anchor_index(ch: dict) -> dict[str, str]:
    """objectives.workflow.js's ANCHORS: key -> the text the evidence and link checks show, in its
    insertion order (the order a question's sub-items are joined in)."""
    from packet_ref import js, js_or, js_truthy
    idx: dict[str, str] = {}

    def put(k, v):
        if js_truthy(k) and k not in idx:
            idx[k] = v
    for b in ch["intro"] + ch["summary"]:
        put(b["id"], b["text"])
        put(b.get("anchor"), b["text"])
    for l in ch["lessons"]:
        for b in l["blocks"]:
            put(b["id"], b["text"])
            put(b.get("anchor"), b["text"])
        for w in l["worked_examples"]:
            put(w["anchor"], f"{js(w.get('title'))} {js(w.get('question'))} "
                             + " ".join(f"{js(s.get('title'))} {js(s.get('text'))}" for s in w["steps"])
                             + f" {js(js_or(w.get('loose_solution'), ''))}")
        for i in l["items"]:
            put(i["item_id"], i["problem"])
    for i in ch["pool"]:                          # answer 15 (c): an end-of-chapter item may be cited
        put(i["item_id"], i["problem"])
    return idx


# The finders' two reading orders (answer 15 (c): each reads the end-of-chapter items in its own
# order, practice first for B), and the linker's (no end-of-chapter items: a link's evidence comes
# from the dependent objective's own lesson).
S1_FINDER_ORDER = {"A": ["text", "we", "ex", "pool"], "B": ["we", "ex", "pool", "text"], "L": ["text", "we", "ex"]}


def s1_shards(packet: dict, pool_batch: int) -> tuple[dict[str, str], list[str]]:
    """{shard name: text} for one chapter packet, and the ANCHORS key order."""
    texts = {"context.txt": _js_chapter_context(packet)}
    for l in packet["lessons"]:
        for side, order in S1_FINDER_ORDER.items():
            texts[f"lessons/{l['slug']}.{side}.txt"] = _js_lesson_text(l, order, packet["pool"])
    for k, i in enumerate(range(0, len(packet["pool"]), pool_batch), start=1):
        texts[f"pool/b{k:04d}.txt"] = _js_pool_lines(packet["pool"][i:i + pool_batch])
    idx = _js_anchor_index(packet)
    for n, key in enumerate(idx, start=1):
        texts[f"anchors/a{n:04d}.txt"] = idx[key]
    return texts, list(idx)


def s1_args_by_ref(args: dict, directory: Path) -> dict:
    """Compact S1 args: the shards written to `directory`, the chapter reduced to what
    objectives.workflow.js's control flow reads. `packet_sha256` still covers the FULL packet."""
    import packet_ref
    ch = args["chapter"]
    pool_batch = int(args["options"]["pool_batch"])
    texts, keys = s1_shards(ch, pool_batch)
    shards = packet_ref.Shards(directory, "S1")
    for name, text in texts.items():
        shards.put(name, text)
    ref = shards.finish({"book": args["book"]["book"], "chapter": ch["n"], "packet_sha256": args["packet_sha256"],
                         "pool_batch": pool_batch})
    ref["pool_batch"] = pool_batch            # echoed by the run: the pool shards' batch size
    compact = {k: v for k, v in args.items() if k != "chapter"}
    compact["by_ref"] = ref
    compact["chapter_ref"] = {
        "n": ch["n"], "module": ch["module"], "title": ch.get("title"),
        "pool_n": len(ch["pool"]), "pool_batch": pool_batch, "anchor_keys": keys,
        "lessons": [{"slug": l["slug"], "title": l["title"], "provenance": l["provenance"],
                     "item_ids": [i["item_id"] for i in l["items"]],
                     "we_anchors": [w["anchor"] for w in l["worked_examples"]]} for l in ch["lessons"]],
    }
    return compact


def check_s1_by_ref(run: dict, packet_args: dict) -> None:
    """A by-ref S1 run read the shards its args named; prove they were this packet's own rendering."""
    import packet_ref
    for ref in run.get("_by_refs") or ([run["by_ref"]] if run.get("by_ref") else []):
        texts, _ = s1_shards(packet_args["chapter"], int(ref.get("pool_batch") or packet_args["options"]["pool_batch"]))
        if packet_ref.shards_sha256_of_texts(texts) != ref.get("shards_sha256"):
            raise StageError("the run read shard files that are not this chapter packet's rendering "
                             "(by_ref.shards_sha256 differs): re-run S1 from fresh `s1-args --by-ref` output")


# ============================================================================ vocabulary (rule 3)
_VOCAB_CACHE: dict[str, str] = {}


def egyptian_vocabulary(books: list | None = None) -> str:
    """The Egyptian maths book's own words as one lower-cased text: every stem, choice, solution
    step and objective of the English-medium National maths bundles. A G10 term absent from it
    is flagged for G1, never rewritten."""
    if books is None:
        books = [b for b in book_config.all_books()
                 if b.subject == "math" and b.curriculum == "eg-national-en" and b.language == "en"]
    key = ",".join(sorted(b.book for b in books))
    if key not in _VOCAB_CACHE:
        parts: list[str] = []
        for b in books:
            for p in b.bundle_paths():
                if not p.exists():
                    continue
                d = json.loads(p.read_text())
                for n in d.get("nodes", []):
                    parts += [n.get("label") or "", n.get("description") or ""]
                for q in d.get("questions", []):
                    parts.append(q.get("stem") or "")
                    parts += [c.get("text", "") for c in (q.get("choices") or []) if isinstance(c, dict)]
                    parts += [s for s in q.get("solution", []) if isinstance(s, str)]
        _VOCAB_CACHE[key] = " " + re.sub(r"\s+", " ", " ".join(parts).lower()) + " "
    return _VOCAB_CACHE[key]


def in_vocabulary(term: str, vocab: str) -> bool:
    t = re.sub(r"\s+", " ", (term or "").strip().lower())
    return bool(t) and re.search(r"(?<![a-z0-9-])" + re.escape(t) + r"(?![a-z0-9-])", vocab) is not None


# ============================================================================ the rules
def anchor_index(packet: dict) -> dict[str, dict]:
    """Every anchor a chapter's evidence may cite: block ids, heading codes, WE<n>, item refs."""
    idx: dict[str, dict] = {}

    def put(key, entry):
        if key and key not in idx:
            idx[key] = entry
    for scope in ("intro", "summary"):
        for b in packet[scope]:
            e = {"text": b["text"], "pages": [b.get("printed_page")], "lesson": None, "scope": scope,
                 "type": b["type"]}
            put(b["id"], e)
            put(b.get("anchor"), e)
    for l in packet["lessons"]:
        for b in l["blocks"]:
            e = {"text": b["text"], "pages": [b.get("printed_page")], "lesson": l["slug"],
                 "scope": "lesson", "type": b["type"]}
            put(b["id"], e)
            put(b.get("anchor"), e)
        for w in l["worked_examples"]:
            put(w["anchor"], {"text": _we_text(w), "pages": [w.get("printed_page"), (w.get("printed_page") or 0) + 1],
                              "lesson": l["slug"], "scope": "lesson", "type": "worked_example"})
        for it in l["items"]:
            put(it["item_id"], {"text": it["problem"], "pages": [it.get("printed_page")],
                                "lesson": l["slug"], "scope": "lesson", "type": "exercise_item"})
    # answer 15 (c): an end-of-chapter item is practice evidence for any lesson in its scope
    for it in packet["pool"]:
        put(it["item_id"], {"text": it["problem"], "pages": [it.get("printed_page")], "lesson": None,
                            "lessons": list(it.get("scope") or []), "scope": "pool", "type": "exercise_item"})
    return idx


_KIND_TYPES = {
    "heading": ("heading",),
    "intro": ("para", "box", "heading", "definition", "list", "table"),
    "summary": ("summary_item", "para", "list", "box"),
    "definition": ("definition", "box"),
    "worked_example": ("worked_example",),
    "exercise": ("exercise_item",),
}


def _sub_items(anchor: str, idx: dict) -> list[str]:
    """`Ex8-2:5` cites question 5 as a whole: Ex8-2:5a, Ex8-2:5b … (never Ex8-2:50)."""
    pat = re.compile(re.escape(anchor) + r"[a-z]{1,2}")
    return [k for k in idx if idx[k]["type"] == "exercise_item" and pat.fullmatch(k)]


def unbracket(ev: dict, idx: dict) -> dict:
    """An anchor copied WITH its brackets ("[EMA69]"): one bracket pair is stripped when the id inside is
    a known anchor (or a whole question), and the anchor as written is kept as `anchor_written`. The
    workflow does the same from s1-v4 on; this reads older runs the same way. Nothing else changes: the
    anchor must still resolve, be of its kind, and carry the quote."""
    a = str(ev.get("anchor") or "").strip()
    m = re.fullmatch(r"\[([^\[\]]+)\]", a)
    if not m or a in idx or not (m.group(1) in idx or _sub_items(m.group(1), idx)):
        return ev
    return dict(ev, anchor=m.group(1), anchor_written=ev.get("anchor"))


def check_evidence(ev: dict, lesson_slug: str, idx: dict, haiku: dict | None,
                   finder_keys: set) -> str | None:
    """None when the evidence item is valid, else why it is dropped. Records `contained`."""
    kind, anchor = ev.get("kind"), ev.get("anchor")
    if kind not in EVIDENCE_KINDS:
        return f"unknown evidence kind '{kind}'"
    if (kind, anchor, norm_quote(ev.get("quote", ""))) not in finder_keys:
        return "not cited by either finder (the reconciler may choose evidence, not add it)"
    target = idx.get(anchor)
    if target is None and kind == "exercise" and anchor:
        subs = _sub_items(anchor, idx)
        if subs:
            target = {"text": " ".join(idx[k]["text"] for k in subs),
                      "pages": sorted({p for k in subs for p in idx[k]["pages"] if p}),
                      "lesson": idx[subs[0]]["lesson"], "scope": idx[subs[0]]["scope"],
                      "lessons": idx[subs[0]].get("lessons"), "type": "exercise_item"}
    if target is None:
        return f"anchor '{anchor}' is not in the chapter packet"
    if target["type"] not in _KIND_TYPES[kind]:
        return f"anchor '{anchor}' is a {target['type']} block, not {kind} evidence"
    if kind in PRACTICE_KINDS and target["scope"] == "pool":
        if lesson_slug not in (target.get("lessons") or []):
            return f"end-of-chapter item '{anchor}' is not in this lesson's scope"
    elif kind in PRACTICE_KINDS and target["lesson"] != lesson_slug:
        return f"{kind} evidence '{anchor}' belongs to another lesson"
    if kind == "summary" and target["scope"] != "summary":
        return f"'{anchor}' is not in the chapter summary"
    if kind == "intro" and target["scope"] not in ("intro", "lesson"):
        return f"'{anchor}' is not introductory text of this chapter"
    pages = [p for p in target["pages"] if p is not None]
    page = ev.get("printed_page")
    if pages and (page is None or not (min(pages) <= page <= max(pages))):
        return f"printed page {page} is not the anchor's page ({min(pages)}–{max(pages)})"
    ev["contained"] = bool(ev.get("quote")) and norm_quote(ev["quote"]) in norm_quote(target["text"])
    if haiku is None:
        return "the evidence check returned no verdict for it"
    if not ev["contained"] and not haiku.get("present"):
        return "the quote is not at its anchor (substring test and evidence check both fail)"
    if not haiku.get("supports"):
        return ("the evidence check says it does not support the objective: "
                + (haiku.get("note") or "")).strip()
    return None


def confidence_of(frm: dict) -> str | None:
    """agreed (one from each finder), merged (both, one side as several), single (one finder),
    or None (no finder: the reconciler invented it)."""
    a, b = len(frm.get("a") or []), len(frm.get("b") or [])
    if a and b:
        return "agreed" if a == 1 and b == 1 else "merged"
    return "single" if (a or b) else None


def id_map(slug: str, run_lesson: dict | None, verdicts: dict) -> dict[str, str | None]:
    """The run's provisional id (position in the reconciled list) -> the final id after G1's
    drops (None when dropped). Every verdict and every mapper answer uses provisional ids."""
    objs = ((run_lesson or {}).get("reconciled") or {}).get("objectives") or []
    ov = (verdicts or {}).get("objectives") or {}
    out, n = {}, 0
    for i, _ in enumerate(objs, 1):
        pid = lo_id(slug, i)
        if (ov.get(pid) or {}).get("action") == "drop":
            out[pid] = None
        else:
            n += 1
            out[pid] = lo_id(slug, n)
    return out


def evaluate_lesson(lp: dict, run_lesson: dict | None, idx: dict, ids: dict,
                    pool_items: dict[str, str | None], vocab: str, verdicts: dict) -> dict:
    """The rules for one lesson (pure). `pool_items`: distributed item -> final objective id."""
    slug = lp["slug"]
    failures, warnings, decisions, terms = [], [], [], []
    rec = (run_lesson or {}).get("reconciled") or {}
    if not rec.get("objectives"):
        return {"slug": slug, "objectives": [], "terms": [], "warnings": [], "decisions": [],
                "failures": [f"{slug}: the reconciler returned nothing (re-run S1 for this lesson)"]}
    finders = run_lesson.get("finders") or {}
    ov = verdicts.get("objectives") or {}
    finder_keys, finder_objs = set(), {}
    for side in ("a", "b"):
        for fo in ((finders.get(side) or {}).get("objectives") or []):
            finder_objs[fo.get("key", "")] = fo
            for ev in fo.get("evidence") or []:
                ev = unbracket(ev, idx)
                finder_keys.add((ev.get("kind"), ev.get("anchor"), norm_quote(ev.get("quote", ""))))
    checks = {(c.get("objective_n"), c.get("evidence_index")): c
              for c in ((run_lesson.get("evidence_check") or {}).get("checks") or [])}

    accounted = {r.get("key") for r in rec.get("rejected") or [] if r.get("reason")}
    for o in rec["objectives"]:
        accounted |= set((o.get("from") or {}).get("a") or []) | set((o.get("from") or {}).get("b") or [])
    for fk, fo in sorted(finder_objs.items()):
        if fk and fk not in accounted:
            decisions.append({"key": f"finder:{slug}:{fk}", "kind": "finder_dropped", "lesson": slug,
                              "detail": f"finder objective {fk} ({fo.get('statement', '')!r}) is in no "
                                        "reconciled objective and was not rejected with a reason"})

    objs, item_owner, we_owner = [], {}, {}
    lesson_items = [it["item_id"] for it in lp["items"]]
    lesson_wes = [w["anchor"] for w in lp["worked_examples"]]
    for pos, o in enumerate(rec["objectives"], 1):
        pid = lo_id(slug, pos)
        oid = ids.get(pid)
        if oid is None:
            continue
        v = ov.get(pid) or {}
        statement, label = (o.get("statement") or "").strip(), (o.get("label") or "").strip()
        if v.get("action") == "edit":
            statement, label = (v.get("statement") or statement).strip(), (v.get("label") or label).strip()
        conf = confidence_of(o.get("from") or {})
        if conf is None:
            failures.append(f"{oid}: no finder found it; the reconciler may align, never invent")
        elif o.get("confidence") and o["confidence"] != conf:
            warnings.append(f"{oid}: the reconciler said '{o['confidence']}', the finders say '{conf}'")
        if conf == "single":
            decisions.append({"key": f"single:{pid}", "kind": "single", "lesson": slug, "objective": pid,
                              "detail": f"{pid} {statement!r}: only finder "
                                        f"{'A' if (o.get('from') or {}).get('a') else 'B'} found it"})
        kept, dropped = [], []
        for i, ev in enumerate(o.get("evidence") or []):
            ev = dict(unbracket(ev, idx))
            h = checks.get((pos, i))
            why = check_evidence(ev, slug, idx, h, finder_keys)
            ev["present"], ev["supports"] = (h or {}).get("present"), (h or {}).get("supports")
            (dropped.append({**ev, "dropped": why}) if why else kept.append(ev))
        kinds = {e["kind"] for e in kept}
        if len(kinds) < 2:
            failures.append(f"{oid}: {len(kinds)} kind(s) of valid evidence "
                            f"({', '.join(sorted(kinds)) or 'none'}); rule 1 needs two different kinds")
        if not kinds & set(PRACTICE_KINDS):
            failures.append(f"{oid}: no valid worked-example or exercise evidence; an objective the "
                            "book never demonstrates or practises cannot be assessed")
        if not statement:
            failures.append(f"{oid}: empty statement")
        if not label:
            warnings.append(f"{oid}: no label")
        low = f" {statement.lower()} "
        for verb in VAGUE_VERBS:
            if f" {verb} " in low:
                warnings.append(f"{oid}: '{verb}' is not an observable behaviour (rule 4)")
                break
        for it in o.get("exercise_items") or []:
            item_owner.setdefault(it, []).append(oid)
        for w in o.get("worked_examples") or []:
            we_owner.setdefault(w, []).append(oid)
        for term in o.get("terms") or []:
            if not in_vocabulary(term, vocab):
                terms.append({"term": term, "lesson": slug, "objective": oid,
                              "why": "not in the Egyptian Prep-3 maths book's vocabulary"})
        for tf in o.get("term_flags") or []:
            if tf.get("term"):
                terms.append({"term": tf["term"], "lesson": slug, "objective": oid,
                              "why": tf.get("why") or "flagged by the reconciler"})
        practice = [e for e in kept if e["kind"] in PRACTICE_KINDS]
        objs.append({"id": oid, "provisional_id": pid, "n": int(oid.rsplit("-", 1)[1]),
                     "statement": statement, "label": label, "evidence": kept,
                     "evidence_dropped": dropped,
                     "exercise_items": list(o.get("exercise_items") or []),
                     "worked_examples": list(o.get("worked_examples") or []),
                     "confidence": conf, "from": o.get("from") or {}, "derivation": "derived",
                     "terms": list(o.get("terms") or []), "edited_at_g1": v.get("action") == "edit",
                     "_practice": practice[0]["anchor"] if practice else None})

    # G1 moves of the lesson's own items, then the distributed items given to this lesson
    moves = verdicts.get("move_items") or {}
    known = {o["id"] for o in objs}
    for item, target in moves.items():
        if item in lesson_items:
            final = ids.get(target, target)
            item_owner[item] = [final]
            for o in objs:
                if item in o["exercise_items"]:
                    o["exercise_items"].remove(item)
            for o in objs:
                if o["id"] == final:
                    o["exercise_items"].append(item)
    for item, oid in pool_items.items():
        if oid in known:
            item_owner.setdefault(item, []).append(oid)
            for o in objs:
                if o["id"] == oid:
                    o["exercise_items"].append(item)
    for it, owners in sorted(item_owner.items()):
        if it not in lesson_items and it not in pool_items:
            failures.append(f"{slug}: {it} is not an item of this lesson")
        unknown = [x for x in owners if x not in known]
        if unknown:
            failures.append(f"{slug}: {it} is mapped to {unknown}, not an objective of this lesson")
        if len(owners) > 1:
            failures.append(f"{slug}: {it} maps to {len(owners)} objectives {owners} (rule 2: exactly one)")
    for it in lesson_items:
        if it not in item_owner:
            failures.append(f"{slug}: {it} maps to no objective (rule 2)")
    # answer 15 (c): an objective found from end-of-chapter practice alone can end up with no item
    # the mappers gave it. G1 decides: move an item to it, drop it, or acknowledge it.
    for o in objs:
        if not o["exercise_items"] and not o["worked_examples"]:
            decisions.append({"key": f"unpractised:{o['provisional_id']}", "kind": "unpractised", "lesson": slug,
                              "objective": o["provisional_id"],
                              "detail": f"{o['id']} {o['statement']!r}: no exercise item or worked example is "
                                        "mapped to it (its practice evidence may be an end-of-chapter item the "
                                        "mappers placed elsewhere)"})
    for w, owners in sorted(we_owner.items()):
        if w not in lesson_wes:
            warnings.append(f"{slug}: {w} is not a worked example of this lesson")
        if len(owners) > 1:
            failures.append(f"{slug}: worked example {w} maps to {len(owners)} objectives {owners}")
    for w in lesson_wes:
        if w not in we_owner:
            warnings.append(f"{slug}: worked example {w} maps to no objective, so S3 cannot attach it")
    if not (MIN_OBJECTIVES <= len(objs) <= MAX_OBJECTIVES):
        failures.append(f"{slug}: {len(objs)} objective(s); rule 4 wants {MIN_OBJECTIVES}–{MAX_OBJECTIVES}")
    order = {a: i for i, a in enumerate(lesson_wes + lesson_items)}
    pos = [order[o["_practice"]] for o in objs if o["_practice"] in order]
    if pos != sorted(pos):
        warnings.append(f"{slug}: objectives are not numbered in the order the book practises them (rule 6)")
    for t in terms:
        decisions.append({"key": f"term:{t['term'].lower()}", "kind": "terminology", "lesson": slug,
                          "objective": t["objective"], "detail": f"{t['term']}: {t['why']}"})
    return {"slug": slug, "objectives": objs, "failures": failures, "warnings": warnings,
            "decisions": decisions, "terms": terms}


def outside_verdicts(verdicts: dict) -> dict[str, str]:
    """G1's `outside_items` (answer 15 (b)): {item: why}. A verdict is `{"why": "…"}` or the reason
    itself; a verdict with no reason is no verdict (rule 2 stays)."""
    out = {}
    for item, v in ((verdicts or {}).get("outside_items") or {}).items():
        why = (v.get("why") if isinstance(v, dict) else v) or ""
        out[item] = str(why).strip()
    return out


def pool_mapping(run: dict, packet: dict, ids: dict, verdicts: dict) -> tuple[dict, list, list, int]:
    """(distributed item -> FINAL objective id or None, failures, decisions, empty mapper rows set aside).

    RULE 2 is relaxed for one thing only, answer 15 (b): a distributed item G1 rules "outside this
    chapter's objectives" (`outside_items`, with a reason) maps to no objective without failing. It is
    kept out of practice, recorded with who, when and why (the G1 record), and listed by name in the
    coverage audit. Nothing else relaxes rule 2."""
    scope = {p["item_id"]: p["scope"] for p in packet["pool"]}
    # A row naming neither an item nor an objective ("none"/"none" — seen in the Chapter 8 pilot as a
    # model's leftover placeholder) places nothing, so it is set aside and counted, never read as a
    # mapping. Every real item still needs its own row below; this invents and hides nothing.
    blank = (None, "", "none")
    mappers = [{**m, "mapping": [r for r in (m.get("mapping") or [])
                                 if not (r.get("item_id") in blank and r.get("objective") in blank)]}
               for m in ((run.get("pool") or {}).get("mappers") or []) if m]
    empty_rows = sum(len((m or {}).get("mapping") or []) for m in ((run.get("pool") or {}).get("mappers") or [])) \
        - sum(len(m["mapping"]) for m in mappers)
    answers: list[dict] = []
    for m in mappers:
        answers.append({r.get("item_id"): (None if r.get("objective") in (None, "", "none")
                                           else r.get("objective")) for r in m.get("mapping") or []})
    moves = verdicts.get("move_items") or {}
    out, failures, decisions = {}, [], []
    if scope and not answers:
        failures.append(f"{len(scope)} distributed item(s) but no mapper output (re-run S1)")
    elif scope and (run.get("pool") or {}).get("second_mapper") and len(answers) < 2:
        failures.append(f"{len(scope)} distributed item(s) and the second blind mapper returned nothing "
                        "(two blind mappers are the default, answer 12): re-run S1's mapping")
    why_none = {}
    for m in mappers:
        for r in m.get("mapping") or []:
            if r.get("objective") in (None, "", "none"):
                why_none.setdefault(r.get("item_id"), []).append((r.get("reason") or "").strip())
    outside = outside_verdicts(verdicts)
    for item, why in sorted(outside.items()):
        if item not in scope:
            failures.append(f"G1 ruled {item} outside this chapter's objectives, but only a distributed "
                            "(end-of-chapter) item may be (answer 15)")
        elif not why:
            failures.append(f"G1 ruled {item} outside this chapter's objectives without a reason (answer 15 "
                            "needs one)")
        elif item in moves:
            failures.append(f"G1 both moved {item} to {moves[item]} and ruled it outside this chapter's objectives")
    for item, sc in scope.items():
        if outside.get(item) and item not in moves:
            out[item] = None                      # kept out of practice, never silently: the verdict names it
            continue
        pid = moves.get(item, answers[0].get(item) if answers else None)
        final = ids.get(pid) if pid in ids else None
        out[item] = final
        if pid is None:
            said = why_none.get(item) or []
            failures.append(f"distributed item {item} maps to no objective (rule 2)"
                            + (f": {'both mappers' if len(said) > 1 else 'the mapper'} said none — "
                               + " | ".join(f"{w[:160]!r}" for w in said)
                               + ". G1 may place it (move_items), or rule it outside this chapter's objectives "
                                 "(outside_items, with a reason, answer 15); if no objective of the chapter practises "
                                 "its skill, S1 is missing one" if said else ""))
            continue
        if final is None:
            failures.append(f"distributed item {item} is mapped to {pid}, which "
                            + ("G1 dropped" if pid in ids else "is not an objective of this chapter"))
            continue
        if book_config.lesson_slug(final) not in sc:
            failures.append(f"distributed item {item} is mapped to {final}, outside its scope {sc}")
        if len(answers) > 1 and item not in moves and answers[1].get(item) != answers[0].get(item):
            decisions.append({"key": f"pool:{item}", "kind": "mappers_disagree", "item": item,
                              "detail": f"{item}: mapper 1 says {answers[0].get(item)}, mapper 2 says "
                                        f"{answers[1].get(item)}"})
    for a in answers[:1]:
        for item in set(a) - set(scope):
            failures.append(f"the mapper placed {item}, which is not a distributed item of this chapter")
    return out, failures, decisions, empty_rows


LINK_SIGNALS = ("recall", "reference", "uses_method")
_LINK_KIND_TYPES = {"text": ("heading", "para", "box", "definition", "list", "table", "summary_item", "unparsed"),
                    "worked_example": ("worked_example",), "exercise": ("exercise_item",)}


def link_key(src: str, dst: str) -> str:
    return f"{src}->{dst}"


def _link_evidence(ev: dict, dst_lesson: str, idx: dict) -> str | None:
    """None when a link's evidence item is at its anchor in the destination's lesson, else why not."""
    kind, anchor = ev.get("kind"), ev.get("anchor")
    if kind not in _LINK_KIND_TYPES:
        return f"unknown evidence kind '{kind}'"
    target = idx.get(anchor)
    if target is None and kind == "exercise" and anchor:
        subs = _sub_items(anchor, idx)
        if subs:
            target = {"text": " ".join(idx[k]["text"] for k in subs), "lesson": idx[subs[0]]["lesson"],
                      "pages": sorted({p for k in subs for p in idx[k]["pages"] if p}), "type": "exercise_item"}
    if target is None:
        return f"anchor '{anchor}' is not in the chapter packet"
    if target["type"] not in _LINK_KIND_TYPES[kind]:
        return f"anchor '{anchor}' is a {target['type']} block, not {kind} evidence"
    if target["lesson"] != dst_lesson:
        return f"'{anchor}' is not in the dependent objective's lesson {dst_lesson}"
    pages = [p for p in target["pages"] if p is not None]
    page = ev.get("printed_page")
    if pages and (page is None or not (min(pages) <= page <= max(pages))):
        return f"printed page {page} is not the anchor's page ({min(pages)}–{max(pages)})"
    if not ev.get("quote") or norm_quote(ev["quote"]) not in norm_quote(target["text"]):
        return "the quote is not at its anchor"
    return None


def evaluate_links(packet: dict, run: dict, ids: dict, prior: list[dict], verdicts: dict) -> dict:
    """Answer 4: the prerequisite links S1 proposed, checked (pure). Returns kept links (final ids),
    dropped links with the reason, the decisions G1 owes and any failure (a cycle)."""
    L = run.get("links") or {}
    out = {"kept": [], "dropped": [], "decisions": [], "failures": [],
           "outside_book": list(L.get("outside_book") or []), "proposed": 0}
    if not L.get("asked"):
        out["decisions"].append({"key": "links:not-run", "kind": "links_not_run",
                                 "detail": "this S1 run did not look for prerequisite links (answer 4): re-run "
                                           "S1, or acknowledge that the chapter has none"})
        return out
    proposed = L.get("proposed")
    if proposed is None:
        out["decisions"].append({"key": "links:failed", "kind": "links_failed",
                                 "detail": "the linker returned nothing: re-run S1, or acknowledge that the "
                                           "chapter goes on with no prerequisite links"})
        return out
    out["proposed"] = len(proposed)
    checks = {c.get("i"): c for c in ((L.get("checks") or {}).get("checks") or [])}
    idx = anchor_index(packet)
    lv = (verdicts or {}).get("links") or {}
    prior_ids = {o["id"] for o in prior}
    # book order: every earlier chapter's objective, then this chapter's in lesson and objective order
    order: dict[str, tuple] = {o["id"]: (0, i) for i, o in enumerate(prior)}
    part: dict[str, tuple] = {}
    for li, lp in enumerate(packet["lessons"], 1):
        prov = lp["provenance"]
        for pid, fid in ids.items():
            if fid and book_config.lesson_slug(pid) == lp["slug"]:
                order[fid] = (1, li, int(fid.rsplit("-", 1)[1]))
        if prov.get("part"):
            part[lp["slug"]] = (prov["sections"][0]["number"], prov["part"]["n"])
    kept_pairs: set[tuple[str, str]] = set()
    for i, ln in enumerate(proposed):
        src_run, dst_run = ln.get("src"), ln.get("dst")
        key = link_key(src_run, dst_run)
        chk = checks.get(i) or {}
        rec = {"key": key, "src": src_run, "dst": dst_run, "signal": ln.get("signal"),
               "reason": ln.get("reason"), "evidence": [unbracket(e, idx) for e in ln.get("evidence") or []],
               "check": {"verdict": chk.get("verdict"), "note": chk.get("note")}}

        def drop(why: str) -> None:
            out["dropped"].append({**rec, "dropped": why})
        if dst_run not in ids:
            drop(f"{dst_run} is not an objective of this chapter")
            continue
        dst = ids[dst_run]
        if dst is None:
            drop(f"{dst_run} was dropped at G1")
            continue
        if src_run in ids:
            src = ids[src_run]
            if src is None:
                drop(f"{src_run} was dropped at G1")
                continue
        elif src_run in prior_ids:
            src = src_run
        else:
            drop(f"{src_run} is not an objective of this chapter or of an earlier chapter approved at G1")
            continue
        rec.update(src=src, dst=dst)
        if src == dst:
            drop("a link from an objective to itself")
            continue
        if rec["signal"] not in LINK_SIGNALS:
            drop(f"unknown signal '{rec['signal']}'")
            continue
        sp, dp = part.get(book_config.lesson_slug(src)), part.get(book_config.lesson_slug(dst))
        if sp and dp and sp[0] == dp[0] and sp[1] < dp[1]:
            drop("derived: an earlier part of the same split section always comes first (FR-4317); "
                 "part links are never written")
            continue
        good, bad = [], []
        for ev in rec["evidence"]:
            why = _link_evidence(ev, book_config.lesson_slug(dst), idx)
            (bad.append({**ev, "dropped": why}) if why else good.append(ev))
        if not good:
            drop("no cited evidence is at its anchor: " + "; ".join(b["dropped"] for b in bad[:2])
                 if bad else "it cites no evidence")
            continue
        if chk.get("verdict") != "CONFIRMED":
            drop(f"the link checker said {chk.get('verdict') or 'nothing'}"
                 + (f": {chk['note']}" if chk.get("note") else ""))
            continue
        if (src, dst) in kept_pairs:
            drop("a duplicate of a link already kept")
            continue
        if lv.get(key) == "drop":
            drop("dropped at G1")
            continue
        backward = order.get(src, (9,)) > order.get(dst, (9,))
        if backward and lv.get(key) != "approve":
            out["decisions"].append({"key": f"link:{key}", "kind": "link_backward", "link": key,
                                     "detail": f"{src} -> {dst}: the book teaches {src} AFTER {dst}; approve "
                                               "the link or drop it"})
        kept_pairs.add((src, dst))
        out["kept"].append({"src": src, "dst": dst, "signal": rec["signal"], "evidence": good,
                            "evidence_dropped": bad, "check": rec["check"], "key": key,
                            "backward": backward})
    from assemble_lesson_bundle import find_cycle   # one cycle finder for the book's graph
    if cyc := find_cycle([(k["src"], k["dst"]) for k in out["kept"]]):
        out["failures"].append("prerequisite links make a cycle: " + " -> ".join(cyc))
    return out


def evaluate_chapter(packet: dict, run: dict, vocab: str, verdicts: dict | None = None,
                     prior: list[dict] | None = None) -> dict:
    verdicts = verdicts or {}
    idx = anchor_index(packet)
    runs = {l.get("slug"): l for l in (run.get("lessons") or []) if l}
    ids: dict[str, str | None] = {}
    for lp in packet["lessons"]:
        ids.update(id_map(lp["slug"], runs.get(lp["slug"]), verdicts))
    pool, pool_fail, pool_dec, empty_rows = pool_mapping(run, packet, ids, verdicts)
    lessons = []
    for lp in packet["lessons"]:
        mine = {i: o for i, o in pool.items() if o and book_config.lesson_slug(o) == lp["slug"]}
        lessons.append(evaluate_lesson(lp, runs.get(lp["slug"]), idx, ids, mine, vocab, verdicts))
    pos = 0
    for l in lessons:
        for o in l["objectives"]:
            pos += 1
            o["order_in_parent"] = pos
    links = evaluate_links(packet, run, ids, prior or [], verdicts)
    seen, decisions = set(), []
    for d in [d for l in lessons for d in l["decisions"]] + pool_dec + links["decisions"]:
        if d["key"] not in seen:
            seen.add(d["key"])
            decisions.append(d)
    scope = {p["item_id"]: p["scope"] for p in packet["pool"]}
    moves = verdicts.get("move_items") or {}
    outside = [{"item": i, "why": w, "scope": scope[i]} for i, w in sorted(outside_verdicts(verdicts).items())
               if w and i in scope and i not in moves]
    return {"lessons": lessons, "pool": pool, "ids": ids, "decisions": decisions, "links": links,
            "outside": outside, "mapper_empty_rows": empty_rows,
            "failures": [f for l in lessons for f in l["failures"]] + pool_fail + links["failures"],
            "warnings": [w for l in lessons for w in l["warnings"]]}


def undecided(decisions: list[dict], verdicts: dict | None) -> list[dict]:
    """The G1 decisions a verdicts file has not taken yet."""
    v = verdicts or {}
    obj_v = v.get("objectives") or {}
    terms = {k.lower(): x for k, x in (v.get("terminology") or {}).items()}
    moves = v.get("move_items") or {}
    ack = set(v.get("acknowledged") or [])
    out = []
    for d in decisions:
        if d["key"] in ack:
            continue
        if d["kind"] == "single" and (obj_v.get(d["objective"]) or {}).get("action") in ("approve", "edit", "drop"):
            continue
        if d["kind"] == "terminology" and terms.get(d["key"].split(":", 1)[1]) == "keep":
            continue
        if d["kind"] == "mappers_disagree" and d["item"] in moves:
            continue
        if d["kind"] == "unpractised" and (d["objective"] in set(moves.values())
                                           or (obj_v.get(d["objective"]) or {}).get("action") == "drop"):
            continue
        if d["kind"] == "link_backward" and ((v.get("links") or {}).get(d["link"]) in ("approve", "drop")):
            continue
        out.append(d)
    return out


# ============================================================================ records
def node_of(o: dict, lp: dict) -> dict:
    """The LO node the bundle carries (§3.4 Output): description = statement, source_page = the
    earliest evidence page, syllabus_ref = the section of the first practice evidence."""
    section = lp["provenance"]["sections"][0]["number"]
    for w in lp["worked_examples"]:
        if w["anchor"] == o.get("_practice") and w.get("section"):
            section = w["section"]
    for it in lp["items"]:
        if it["item_id"] == o.get("_practice") and it.get("section"):
            section = it["section"]
    pages = [e["printed_page"] for e in o["evidence"] if e.get("printed_page") is not None]
    return {"id": o["id"], "kind": "learning_objective", "label": o["label"] or o["statement"][:60],
            "description": o["statement"], "source_page": min(pages) if pages else None,
            "syllabus_ref": section, "order_in_parent": o.get("order_in_parent")}


def lesson_record(book, packet: dict, lp: dict, ev: dict, run_ref: dict, status: str,
                  pool_items: list[str], g1: dict | None, links: list[dict] | None = None,
                  outside: list[dict] | None = None) -> dict:
    objs = []
    for o in ev["objectives"]:
        rec = {k: v for k, v in o.items() if not k.startswith("_")}
        rec["node"] = node_of(o, lp)
        objs.append(rec)
    return {
        "objectives_version": OBJECTIVES_VERSION, "book": book.book, "chapter": packet["n"],
        "module": packet["module"], "lesson": lp["slug"], "title": lp["title"],
        "provenance": lp["provenance"], "status": status, "g1": g1 if status == "approved" else None,
        "source_run": run_ref, "objectives": objs, "pool_items": pool_items,
        # The book's own prerequisite links INTO this lesson's objectives (answer 4): found by
        # S1's linker, confirmed by its checker, approved at G1. assemble_lesson_bundle.py writes
        # {src, dst} as prerequisite_of edges; the evidence stays here. Part n-1 -> n links are
        # never here: they are derived (FR-4317).
        "prerequisites": [{"src": k["src"], "dst": k["dst"], "signal": k["signal"], "evidence": k["evidence"],
                           "check": k["check"], "backward": k["backward"]}
                          for k in (links or []) if book_config.lesson_slug(k["dst"]) == lp["slug"]],
        "checks": {"ok": not ev["failures"], "failures": ev["failures"], "warnings": ev["warnings"]},
        # answer 15 (b): the end-of-chapter items in this lesson's scope G1 ruled outside the chapter's
        # objectives: kept out of practice, named here with who, when and why, and in the coverage audit
        "outside_items": [{"item": x["item"], "why": x["why"],
                           "by": (g1 or {}).get("approved_by") if status == "approved" else None,
                           "at": (g1 or {}).get("approved_at") if status == "approved" else None}
                          for x in (outside or []) if lp["slug"] in x["scope"]],
    }


# ============================================================================ review page (G1)
_TOKENS_RE = re.compile(r"(:root\s*\{.*?:root\[data-theme=\"dark\"\]\s*\{[^}]*\})", re.S)


def _tokens_css() -> str:
    """The Play tokens the existing review page carries (review_page_template.html), so this page
    follows the same design system without restating a colour."""
    m = _TOKENS_RE.search((HERE / "review_page_template.html").read_text())
    if not m:
        raise StageError("review_page_template.html no longer carries the :root token blocks this "
                         "page reuses; update _tokens_css()")
    return m.group(1)


_PAGE_CSS = """
  * { box-sizing: border-box; }
  body { margin:0; background:var(--ground); color:var(--ink); font-family:var(--font-body);
         line-height:1.6; -webkit-font-smoothing:antialiased; }
  .shell { max-width:960px; margin:0 auto; padding-inline:16px; }
  h1,h2,h3 { font-family:var(--font-display); font-weight:800; margin:0; line-height:1.25; }
  header.top { background:var(--contrast); color:var(--on-contrast); padding-block:28px 22px; }
  header.top p { color:var(--on-contrast-dim); max-width:70ch; margin:.5em 0 0; }
  .meta { font-family:var(--font-mono); font-size:12px; color:var(--on-contrast-dim); margin-top:14px; }
  section.card { background:var(--surface); border:1px solid var(--rule); border-radius:16px;
                 padding:18px 20px; margin-block:18px; }
  .prov, .id, .items { font-family:var(--font-mono); font-size:12px; color:var(--ink-faint); }
  .items { color:var(--ink-soft); word-break:break-word; }
  .obj { border-top:1px solid var(--rule); padding-top:12px; margin-top:12px; }
  .obj h3 { font-size:17px; }
  .badge { font-family:var(--font-mono); font-size:11px; padding:2px 8px; border-radius:999px;
           background:var(--sunk); color:var(--ink-soft); margin-inline-start:6px; }
  .badge.single, .badge.none { background:var(--amber); color:var(--on-amber); }
  .badge.agreed { background:var(--teal-wash); color:var(--teal-deep); }
  .table-wrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:14px; margin-top:8px; }
  th, td { text-align:start; padding:6px 8px; border-bottom:1px solid var(--rule); vertical-align:top; }
  th { font-family:var(--font-mono); font-size:11px; color:var(--ink-faint); font-weight:500; }
  td.q { color:var(--ink-soft); }
  tr.dropped td { color:var(--ink-faint); text-decoration:line-through; }
  ul.checks { margin:.5em 0; padding-inline-start:1.2em; }
  .fail { color:var(--amber-deep); }
"""


def _e(s) -> str:
    return html.escape("" if s is None else str(s))


def review_page(book, packet: dict, ev: dict, run_ref: dict, owed: list[dict]) -> str:
    lps = {l["slug"]: l for l in packet["lessons"]}
    cards = []
    for l in ev["lessons"]:
        lp = lps[l["slug"]]
        prov = lp["provenance"]
        where = ", ".join(f"{s['number']} {s['title']}" for s in prov["sections"])
        if prov.get("part"):
            where += f" · part {prov['part']['n']} of {prov['part']['of']}"
        if prov.get("chapter_intro"):
            where += " · chapter introduction"
        body = [f"<h2>{_e(lp['title'])}</h2><div class=prov>{_e(l['slug'])} · {_e(where)} · "
                f"{len(lp['items'])} exercise items · {len(lp['worked_examples'])} worked examples</div>"]
        if l["failures"]:
            body.append("<ul class=checks>" + "".join(f"<li class=fail>{_e(f)}</li>" for f in l["failures"]) + "</ul>")
        if l["warnings"]:
            body.append("<ul class=checks>" + "".join(f"<li>{_e(w)}</li>" for w in l["warnings"]) + "</ul>")
        for o in l["objectives"]:
            rows = [f"<tr><td>{_e(e['kind'])}</td><td class=id>{_e(e.get('anchor'))}</td>"
                    f"<td>{_e(e.get('printed_page'))}</td><td class=q>{_e(e.get('quote'))}</td>"
                    f"<td>{'substring' if e.get('contained') else 'evidence check'}</td></tr>"
                    for e in o["evidence"]]
            rows += [f"<tr class=dropped><td>{_e(e.get('kind'))}</td><td class=id>{_e(e.get('anchor'))}</td>"
                     f"<td>{_e(e.get('printed_page'))}</td><td class=q>{_e(e.get('quote'))}</td>"
                     f"<td>{_e(e.get('dropped'))}</td></tr>" for e in o["evidence_dropped"]]
            conf = o.get("confidence") or "none"
            body.append(
                f"<div class=obj><h3>{_e(o['statement'])}</h3><span class=id>{_e(o['id'])}"
                f"{'' if o['id'] == o['provisional_id'] else ' (run: ' + _e(o['provisional_id']) + ')'}</span>"
                f"<span class='badge {_e(conf)}'>{_e(conf)}</span><span class=badge>{_e(o['label'])}</span>"
                "<div class=table-wrap><table><tr><th>kind</th><th>anchor</th><th>page</th><th>quote</th>"
                "<th>found by</th></tr>" + "".join(rows) + "</table></div>"
                f"<p class=items>items: {_e(', '.join(o['exercise_items']) or 'none')} · worked examples: "
                f"{_e(', '.join(o['worked_examples']) or 'none')}</p></div>")
        cards.append("<section class=card>" + "".join(body) + "</section>")
    owed_html = "".join(f"<li>{_e(d['kind'])}: {_e(d['detail'])} <span class=id>{_e(d['key'])}</span></li>"
                        for d in owed) or "<li>none</li>"
    outside_html = ("<section class=card><h2>Outside this chapter's objectives (G1, answer 15)</h2><p>End-of-chapter "
                    "items G1 ruled outside what the chapter teaches: kept out of practice, listed by name in the "
                    "coverage audit.</p><ul class=checks>"
                    + "".join(f"<li>{_e(x['item'])}: {_e(x['why'])}</li>" for x in ev.get("outside") or [])
                    + "</ul></section>") if ev.get("outside") else ""
    chapter_fail = "".join(f"<p class=fail>{_e(f)}</p>" for f in ev["failures"]
                           if f.startswith(("distributed", "the mapper", "prerequisite links"))
                           or "mapper" in f)
    statements = {o["id"]: o["statement"] for l in ev["lessons"] for o in l["objectives"]}
    statements.update({o["id"]: o["statement"] for o in packet.get("_prior", [])})
    lk = ev.get("links") or {"kept": [], "dropped": [], "outside_book": []}

    def link_row(k: dict, dropped: bool) -> str:
        evs = "; ".join(f"{e.get('kind')} {e.get('anchor')} p.{e.get('printed_page')}: “{e.get('quote')}”"
                        for e in k.get("evidence") or [])
        why = k.get("dropped") if dropped else (
            "kept" + (" · runs BACKWARDS in book order: G1 must approve or drop it" if k.get("backward") else ""))
        return (f"<tr{' class=dropped' if dropped else ''}><td class=id>{_e(k['src'])}<br>"
                f"{_e(statements.get(k['src'], ''))}</td><td class=id>{_e(k['dst'])}<br>"
                f"{_e(statements.get(k['dst'], ''))}</td><td>{_e(k.get('signal'))}</td><td class=q>{_e(evs)}</td>"
                f"<td>{_e((k.get('check') or {}).get('verdict'))}</td><td>{_e(why)}</td></tr>")
    link_rows = "".join(link_row(k, False) for k in lk["kept"]) + "".join(link_row(k, True) for k in lk["dropped"])
    outside = "".join(f"<li>{_e(o.get('dst'))}: “{_e(o.get('quote'))}” ({_e(o.get('anchor'))})</li>"
                      for o in lk.get("outside_book") or [])
    links_html = (
        "<section class=card><h2>Prerequisite links</h2><p>Found in the book by the linker (a recall, a "
        "reference back, or a method used before this lesson teaches it) and confirmed by a second agent "
        "from the anchored text. Approving the chapter approves every kept link; drop one with "
        "<code>links: {\"&lt;src&gt;-&gt;&lt;dst&gt;\": \"drop\"}</code> in the verdicts (run ids). Part n−1 → n "
        "links are derived by the app and never listed here.</p>"
        + (f"<div class=table-wrap><table><tr><th>first (src)</th><th>then (dst)</th><th>signal</th>"
           f"<th>evidence</th><th>check</th><th>outcome</th></tr>{link_rows}</table></div>" if link_rows
           else "<p>No link was proposed.</p>")
        + (f"<p>Recalled from an earlier grade (not in this book, so not a link):</p><ul class=checks>{outside}</ul>"
           if outside else "") + "</section>")
    return f"""<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Objectives review, chapter {_e(packet['n'])}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@600;700;800&family=Cairo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<style>
{_tokens_css()}
{_PAGE_CSS}
</style></head><body>
<header class=top><div class=shell><h1>Chapter {_e(packet['n'])}: {_e(packet.get('title'))}</h1>
<p>Gate G1. Two finders derived each lesson's objectives from the book, blind to each other; a
reconciler aligned them and a separate check read every piece of evidence. Look at every
<b>single</b> objective, every terminology flag and every failure, then approve with
<code>assemble_objectives.py approve</code>. Nothing downstream runs until you do.</p>
<div class=meta>book {_e(book.book)} · run {_e(run_ref.get('file'))} · prompts {_e(run_ref.get('prompts_version'))}
 · {len(ev['failures'])} failure(s) · {len(owed)} decision(s) owed</div></div></header>
<main class=shell>
<section class=card><h2>Decisions G1 owes</h2><ul class=checks>{owed_html}</ul>{chapter_fail}</section>
{outside_html}
{''.join(cards)}
{links_html}
</main>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
 onload="renderMathInElement(document.body,{{delimiters:[{{left:'$',right:'$',display:false}}],throwOnError:false}})"></script>
</body></html>
"""


# ============================================================================ assemble / approve
def read_runs(files: list) -> dict:
    """Saved S1 return values for ONE chapter. A later file replaces an earlier one's lessons (a
    re-run of some lessons) and, if it has one, its pool mapping."""
    merged: dict = {}
    for f in files:
        r = json.loads(Path(f).read_text())
        r = r.get("result", r) if isinstance(r, dict) else r
        if r.get("stage") != "S1":
            raise StageError(f"{f} is not an S1 run output (stage {r.get('stage')!r})")
        if not merged:
            merged = dict(r, _files=[str(f)], _by_refs=[r["by_ref"]] if r.get("by_ref") else [])
            continue
        if r.get("by_ref"):
            merged["_by_refs"].append(r["by_ref"])
        if r.get("chapter") != merged.get("chapter"):
            raise StageError(f"{f} is chapter {r.get('chapter')}, not {merged.get('chapter')}")
        if r.get("packet_sha256") != merged.get("packet_sha256"):
            raise StageError(f"{f} was run on a different chapter packet than {merged['_files'][0]}")
        by = {l["slug"]: l for l in merged.get("lessons") or [] if l}
        by.update({l["slug"]: l for l in r.get("lessons") or [] if l})
        merged["lessons"] = list(by.values())
        if (r.get("pool") or {}).get("mappers"):
            merged["pool"] = r["pool"]
        merged["_files"].append(str(f))
    return merged


def _run_ref(run: dict) -> dict:
    files = run.get("_files", [])
    sha = hashlib.sha256(b"".join(Path(f).read_bytes() for f in files)).hexdigest()
    return {"file": ", ".join(files), "sha256": sha, "prompts_version": run.get("prompts_version"),
            "packet_sha256": run.get("packet_sha256")}


def assemble(book, packet_args: dict, run: dict, out_dir: Path, vocab: str,
             verdicts: dict | None = None, g1: dict | None = None) -> dict:
    packet = packet_args["chapter"]
    if run.get("packet_sha256") != packet_args["packet_sha256"]:
        raise StageError("the run was made from a different chapter packet than today's blocks, "
                         "manifest and maths give (packet_sha256 differs): re-run S1, or assemble "
                         "against the inputs it was run on")
    check_s1_by_ref(run, packet_args)
    ev = evaluate_chapter(packet, run, vocab, verdicts, packet_args.get("prior_objectives") or [])
    owed = undecided(ev["decisions"], verdicts)
    status = "rejected" if ev["failures"] else ("approved" if g1 and not owed else "awaiting_g1")
    run_ref = _run_ref(run)
    out_dir.mkdir(parents=True, exist_ok=True)
    lps = {l["slug"]: l for l in packet["lessons"]}
    for l in ev["lessons"]:
        pool_items = sorted(i for i, o in ev["pool"].items() if o and book_config.lesson_slug(o) == l["slug"])
        rec = lesson_record(book, packet, lps[l["slug"]], l, run_ref, status, pool_items, g1,
                            ev["links"]["kept"], ev["outside"])
        (out_dir / f"{l['slug']}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1) + "\n")
    ch = f"ch{int(packet['n']):02d}"
    objs = [o for l in ev["lessons"] for o in l["objectives"]]
    check = {"chapter": packet["n"], "status": status, "failures": ev["failures"],
             "warnings": ev["warnings"], "decisions": ev["decisions"], "undecided": owed,
             "pool": ev["pool"], "source_run": run_ref, "outside_items": ev["outside"],
             "links": {"kept": ev["links"]["kept"], "dropped": ev["links"]["dropped"],
                       "outside_book": ev["links"]["outside_book"]},
             "counts": {"lessons": len(ev["lessons"]), "objectives": len(objs),
                        "agreed": sum(o["confidence"] == "agreed" for o in objs),
                        "merged": sum(o["confidence"] == "merged" for o in objs),
                        "single": sum(o["confidence"] == "single" for o in objs),
                        "evidence_kept": sum(len(o["evidence"]) for o in objs),
                        "evidence_dropped": sum(len(o["evidence_dropped"]) for o in objs),
                        "items_mapped": sum(len(o["exercise_items"]) for o in objs),
                        "items_distributed": len(ev["pool"]),
                        "items_outside": len(ev["outside"]),
                        "mapper_empty_rows_set_aside": ev.get("mapper_empty_rows", 0),
                        "mappers": len(((run.get("pool") or {}).get("mappers") or [])),
                        "links_proposed": ev["links"]["proposed"], "links_kept": len(ev["links"]["kept"]),
                        "links_dropped": len(ev["links"]["dropped"]),
                        "teacher_only_dropped": packet_args.get("teacher_only_dropped", 0)}}
    (out_dir / f"{ch}.check.json").write_text(json.dumps(check, ensure_ascii=False, indent=1) + "\n")
    page_packet = dict(packet, _prior=packet_args.get("prior_objectives") or [])
    (out_dir / f"{ch}.review.html").write_text(review_page(book, page_packet, ev, run_ref, owed))
    tf = out_dir / "terminology-flags.json"
    flags = json.loads(tf.read_text()) if tf.exists() else {"book": book.book, "flags": []}
    decided = {k.lower(): x for k, x in ((verdicts or {}).get("terminology") or {}).items()}
    flags["flags"] = [f for f in flags["flags"] if f.get("chapter") != packet["n"]] + [
        {**t, "chapter": packet["n"], "decision": decided.get(t["term"].lower())}
        for l in ev["lessons"] for t in l["terms"]]
    tf.write_text(json.dumps(flags, ensure_ascii=False, indent=1) + "\n")
    return {"status": status, "check": check}


# ============================================================================ lesson-args
_VIZ_LINE_RE = re.compile(r"^(\d+)\.\s+\*\*(\w+)\*\*\s+—\s+(.*)$")


def viz_kind_specs() -> list[dict]:
    """The maths VIZ kinds and their spec shapes, read from VIZ_SPEC.md (one source)."""
    out, cur = [], None
    for line in (HERE / "VIZ_SPEC.md").read_text().splitlines():
        m = _VIZ_LINE_RE.match(line.strip())
        if m:
            cur = {"kind": m.group(2), "doc": m.group(3).strip()} if m.group(2) in MATH_VIZ_KINDS else None
            if cur:
                out.append(cur)
        elif cur and line.startswith("   ") and line.strip():
            cur["doc"] += " " + line.strip()
        elif not line.strip() or line.startswith("#"):
            cur = None
    missing = set(MATH_VIZ_KINDS) - {k["kind"] for k in out}
    if missing:
        raise StageError(f"VIZ_SPEC.md no longer documents {sorted(missing)}")
    return out


def figure_path(work: Path, src: str | None) -> str | None:
    """The EPUB figure the adapter extracted (figures/<src with / as __>), or None."""
    if not src:
        return None
    p = work / "figures" / src.replace("/", "__")
    return str(p.resolve()) if p.exists() else None


RAISED_DOT_RE = re.compile(r"\d\s+\.\s+\d")


def answer_rule_flags(book, ref: str, stem: str, printed: str | None) -> dict:
    """The book's S3 answer rules for one exercise item (backlog 30/31), deterministically:
      asked_form           the form its stem asks for (a product of primes, a decimal …), which the
                           marker spec must carry whatever the typing agent said;
      printed_form_defect  its printed answer is not in that form: held and listed for G2, never
                           corrected silently (FR-4302);
      raised_dot           its printed answer uses the book's raised multiplication dot, which the
                           PDF text layer flattens to " . " between digits: the key writes \\cdot."""
    rules = getattr(book, "answer_rules", None)
    out: dict = {}
    if rules is None:
        return out
    for r in rules.forms_from_stem:
        if re.search(r.match, stem or "", re.I):
            out["asked_form"] = r.form
            break
    for d in rules.printed_not_in_asked_form:
        if d.item == ref:
            out["asked_form"] = d.asked_form
            out["printed_form_defect"] = {"asked_form": d.asked_form, "printed": d.printed, "note": d.note}
    if rules.multiplication_dot and printed and RAISED_DOT_RE.search(printed):
        out["raised_dot"] = True
    return out


def build_lesson_packet(book, manifest, blocks, maths, rec: dict, work: Path) -> dict:
    """One lesson's S2–S4 input, from its G1-approved objectives file."""
    module = chapter_module(manifest, rec["chapter"])
    lessons = module_lessons(module, book)
    a = assign_chapter(blocks, module, lessons)
    slug = rec["lesson"]
    bs = a["lessons"][slug]
    missing: set[str] = set()
    headers = _headers(a["headers"], maths, missing)
    owner = {it: o["id"] for o in rec["objectives"] for it in o["exercise_items"]}
    we_owner = {w: o["id"] for o in rec["objectives"] for w in o["worked_examples"]}
    items = []
    for b in [x for x in bs if x["type"] == "exercise_item"] + a["pool"]:
        ref = item_ref(b)
        if ref not in owner:
            continue
        pa = b.get("printed_answer")
        figs = _figure_srcs(b.get("problem"))
        items.append({
            "ref": ref, "lo": owner[ref], "printed_page": b.get("printed_page"),
            "section": b.get("section"), "shortcode": b.get("shortcode"),
            "end_of_chapter": bool(b.get("end_of_chapter")),
            "stem": item_stem(b, headers, maths, missing),
            # decision 19: the EPUB worked solution is canonical (the Teacher's Guide is not in
            # this book's sources; the adapter would carry it as teachers_guide_solution)
            "solution": solution_steps(b.get("solution"), maths, missing),
            "solution_provenance": "book_worked_epub",
            "printed_answer": _t(pa) or None, "printed_answer_scope": (pa or {}).get("scope"),
            "figures": [p for p in (figure_path(work, s) for s in figs) if p],
            "figures_missing": [s for s in figs if not figure_path(work, s)],
            **answer_rule_flags(book, ref, item_stem(b, headers, maths, missing), _t(pa)),
        })
    wes, unmapped = [], []
    for b in bs:
        if b["type"] != "worked_example":
            continue
        w = _we(b, maths, missing)
        if w["anchor"] not in we_owner:
            unmapped.append(w["anchor"])
            continue
        steps = [f"{s['title']}: {s['text']}" if s["title"] else s["text"] for s in w["steps"] if s["text"]]
        if w["loose_solution"]:
            steps.append(w["loose_solution"])
        figs = _figure_srcs(b.get("question"), *(b.get("steps") or []))
        wes.append({"ref": w["anchor"], "lo": we_owner[w["anchor"]], "n": w["n"], "title": w["title"],
                    "printed_page": w["printed_page"], "section": w["section"],
                    "stem": w["question"], "solution": steps, "solution_provenance": "book_worked",
                    "figures": [p for p in (figure_path(work, s) for s in figs) if p]})
    # Every figure the student sees in this lesson: its text, boxes and activities, its worked
    # examples (question and solution), its own exercise problems, the problems of the distributed
    # items G1 gave it, and the figures printed in an exercise question's HEADER (shared by the
    # question's parts: they go to the lesson of the question's first part). Never a figure only an
    # EPUB exercise solution prints (the student does not see it). The block's own `figures` list
    # (source_adapter.py) names every reference with its context, so none is missed.
    def fig_refs(b: dict) -> list[tuple[str, str]]:
        out = [(f["src"], f.get("context") or "body") for f in b.get("figures") or [] if f.get("src")]
        nested = ([(s, "exercise_problem") for s in _figure_srcs(b.get("problem"))] if b["type"] == "exercise_item"
                  else [(s, "we_question") for s in _figure_srcs(b.get("question"))]
                  + [(s, "we_solution") for s in _figure_srcs(*(b.get("steps") or []))]
                  if b["type"] == "worked_example" else [])
        seen = {src for src, _ in out}
        out += [(src, ctx) for src, ctx in nested if src not in seen]
        return [(src, ctx) for src, ctx in out if ctx != "exercise_solution"]
    first_item: dict[tuple, str] = {}
    for b in [x for x in bs if x["type"] == "exercise_item"] + a["pool"]:
        first_item.setdefault((b.get("exercise"), b.get("q")), item_ref(b))
        first_item.setdefault((b.get("exercise"), None), item_ref(b))
    figures = []

    def add_fig(b: dict, src: str, ctx: str, ref: str | None) -> None:
        figures.append({"figure_id": f"{b['id']}:{len(figures) + 1}", "block": b["id"], "src": src,
                        "path": figure_path(work, src), "context": "we" if ctx.startswith("we_") else ctx,
                        "printed_page": b.get("printed_page"), "ref": ref,
                        "caption": render(b.get("caption"), maths, missing) if b["type"] == "figure" else None})
    for b in bs:
        if b["type"] == "exercise_item" and item_ref(b) not in owner:
            continue
        ref = item_ref(b) if b["type"] == "exercise_item" else we_ref(b) if b["type"] == "worked_example" else None
        for src, ctx in fig_refs(b):
            add_fig(b, src, ctx, ref)
    for b in a["pool"]:
        if owner.get(item_ref(b), "").startswith(f"lo:{slug}-"):
            for src, ctx in fig_refs(b):
                add_fig(b, src, ctx, item_ref(b))
    for h in a["headers"]:
        first = first_item.get((h.get("exercise"), h.get("q")))
        if first and owner.get(first, "").startswith(f"lo:{slug}-"):
            for src, ctx in fig_refs(h):
                add_fig(h, src, ctx, first)
    text_blocks = [_block(b, maths, missing) for b in bs if b["type"] in TEXT_TYPES]
    if missing:
        raise StageError(f"{slug} needs {len(missing)} maths image(s) S0b has not accepted; it "
                         f"waits for G0b (FR-4407): {', '.join(sorted(missing)[:6])}")
    return {
        "slug": slug, "title": rec["title"], "module": rec["module"], "chapter": rec["chapter"],
        "provenance": rec["provenance"],
        "objectives": [{"id": o["id"], "statement": o["statement"], "label": o["label"],
                        "exercise_items": o["exercise_items"], "worked_examples": o["worked_examples"]}
                       for o in rec["objectives"]],
        "blocks": text_blocks,
        "subheadings": [{"anchor": b.get("code") or b["id"], "title": b.get("title")}
                        for b in bs if b["type"] == "heading"],
        "worked_examples": wes, "items": items, "figures": figures,
        # FR-4408: the teacher-only notes travel ONLY for the leak check; the lesson workflow
        # never puts them in a prompt
        "teacher_only": [{"anchor": b["id"], "text": render(b.get("text"), maths, set())}
                         for b in a["teacher_only_by_lesson"][slug]],
        "unmapped_worked_examples": unmapped,
    }


def lesson_args(book, manifest, blocks, maths, objectives_dir: Path, lessons: list[str],
                work: Path, options: dict | None = None) -> dict:
    packets = []
    for slug in lessons:
        if not LESSON_SLUG_RE.match(slug):
            raise StageError(f"{slug!r} is not a lesson slug")
        f = objectives_dir / f"{slug}.json"
        if not f.exists():
            raise StageError(f"{slug}: no objectives file {f} (run S1 and assemble its chapter)")
        rec = json.loads(f.read_text())
        if rec.get("status") != "approved" or not rec.get("g1"):
            raise StageError(f"{slug}: its objectives are '{rec.get('status')}', not approved at G1; "
                             "nothing downstream of S1 runs before G1 (extraction-pipeline.md §3.4)")
        packets.append(build_lesson_packet(book, manifest, blocks, maths, rec, work))
    rules = getattr(book, "answer_rules", None)
    return {"book": {"book": book.book, "course_id": book.course_id, "language": book.language,
                     "id_prefixes": book.id_prefixes, "notation": book.notation,
                     "multiplication_dot": bool(rules and rules.multiplication_dot)},
            "stage": "S2-S4,S8", "lessons": packets, "viz_kinds": viz_kind_specs(),
            "options": {"blind_batch": 16, "typing_batch": 30, "figures_per_call": 16,
                        "tier_sample_every": 5, **(options or {})}}


# ============================================================================ lesson-runs (G2 handoff)
def lesson_runs(run: dict, g2: dict | None = None) -> dict[str, dict]:
    """A saved lesson-workflow return value -> {slug: runs/<book>/lesson/<slug>.json}, with G2's
    verdicts on the items. Validated against assemble_lesson_bundle.py's LessonRun. An item whose
    typing is invalid must carry a G2 `fix` (with the corrected fields) or `exclude`."""
    from assemble_lesson_bundle import LessonRun  # WP-P4's model: the handoff's other side
    g2 = g2 or {}
    by = g2.get("by")
    verdicts = g2.get("items") or {}
    out, problems = {}, []
    for l in run.get("lessons") or []:
        if not l:
            continue
        items = []
        for it in l.get("items") or []:
            key = f"{l['lesson']}:{it['ref']}"
            v = verdicts.get(key)
            it = dict(it)
            if v:
                if not by:
                    raise StageError("G2 verdicts need a reviewer: set `by` in the verdicts file")
                if v.get("verdict") == "fix":
                    it.update(v.get("fields") or {})
                it["g2"] = {"verdict": v["verdict"], "by": by, "note": v.get("note")}
            if it.get("typing_problems") and not v:
                problems.append(f"{key}: {'; '.join(it['typing_problems'])} (needs a G2 fix or exclude)")
            items.append(it)
        rec = {k: l[k] for k in ("lesson", "claims", "visuals", "viz_gaps", "teacher_only") if k in l}
        rec["items"] = items
        rec["source_run"] = {"prompts_version": run.get("prompts_version"), "stage": run.get("stage"),
                             **({"embedded": run["embedded"]} if run.get("embedded") else {})}
        rec["checks"] = {k: l.get(k) for k in ("verify", "oracle", "counts", "claims_dropped",
                                                  "figure_blocked", "rejected") if k in l}
        try:
            LessonRun.model_validate(rec)
        except Exception as e:                            # noqa: BLE001 — report every lesson
            problems.append(f"{l['lesson']}: {str(e).splitlines()[0]} … {str(e)[:300]}")
        out[l["lesson"]] = rec
    if problems:
        raise StageError("lesson runs not written:\n  " + "\n  ".join(problems))
    return out


# ============================================================================ commands
def _book(a):
    return book_config.load_book(a.book_config or a.book)


def _paths(book, a) -> dict:
    work = Path(a.blocks).parent if a.blocks else HERE / "work" / book.book
    return {"blocks": Path(a.blocks) if a.blocks else work / "blocks.jsonl", "work": work,
            "manifest": Path(a.manifest) if a.manifest else (book.repo_path(book.manifest) if book.manifest else None),
            "maths": Path(a.maths) if a.maths else HERE / "runs" / book.book / "maths" / "accepted.json",
            "objectives": Path(a.objectives_dir) if a.objectives_dir else HERE / "objectives" / book.book,
            "runs": Path(a.runs_dir) if a.runs_dir else HERE / "runs" / book.book}


def _inputs(book, a):
    p = _paths(book, a)
    if p["manifest"] is None or not p["manifest"].exists():
        raise StageError(f"no manifest for {book.book} (config 'manifest', or --manifest)")
    return p, json.loads(p["manifest"].read_text()), load_blocks(p["blocks"]), load_maths(p["maths"])


def _emit(obj, out: str | None, summary: str) -> None:
    import packet_ref
    text = packet_ref.dumps(obj) if "by_ref" in obj else json.dumps(obj, ensure_ascii=False, indent=1)
    if out:
        Path(out).write_text(text + "\n")
        print(f"{summary} → {out}")
    else:
        print(text)


def cmd_s1_args(a) -> int:
    book = _book(a)
    p, manifest, blocks, maths = _inputs(book, a)
    args = s1_args(book, manifest, blocks, maths, a.chapter,
                   {"second_mapper": not a.no_second_mapper, "links": not a.no_links},
                   prior_objectives(p["objectives"], a.chapter))
    c = args["chapter"]
    summary = (f"S1 args, chapter {a.chapter}: {len(c['lessons'])} lesson(s), "
               f"{sum(len(l['items']) for l in c['lessons'])} lesson item(s), {len(c['pool'])} to "
               f"distribute, {args['teacher_only_dropped']} teacher-only block(s) left out")
    if a.by_ref is not None:
        import packet_ref
        d = Path(a.by_ref) if a.by_ref else packet_ref.default_dir(book.book, "s1", f"ch{int(a.chapter):02d}")
        args = s1_args_by_ref(args, d)
        summary += f"; {args['by_ref']['files']} shard(s) in {args['by_ref']['dir']}; " + \
            packet_ref.report(args, "by ref")
    _emit(args, a.out, summary)
    return 0


def cmd_assemble(a) -> int:
    book = _book(a)
    p, manifest, blocks, maths = _inputs(book, a)
    run = read_runs(a.runs)
    res = assemble(book, s1_args(book, manifest, blocks, maths, int(run["chapter"]),
                                 prior=prior_objectives(p["objectives"], int(run["chapter"]))), run,
                   p["objectives"], egyptian_vocabulary())
    c = res["check"]
    n = c["counts"]
    print(f"chapter {c['chapter']}: {c['status']} · {n['objectives']} objectives in {n['lessons']} lessons "
          f"({n['agreed']} agreed, {n['merged']} merged, {n['single']} single) · {n['evidence_dropped']} "
          f"evidence item(s) dropped · {len(c['undecided'])} G1 decision(s) owed")
    for f in c["failures"]:
        print(f"  FAIL {f}")
    print(f"  review page: {p['objectives'] / ('ch%02d.review.html' % c['chapter'])}")
    return 1 if c["failures"] else 0


def cmd_approve(a) -> int:
    book = _book(a)
    p, manifest, blocks, maths = _inputs(book, a)
    check_path = p["objectives"] / f"ch{int(a.chapter):02d}.check.json"
    if not check_path.exists():
        raise StageError(f"no {check_path}: assemble the chapter first")
    check = json.loads(check_path.read_text())
    run = read_runs([f.strip() for f in check["source_run"]["file"].split(",") if f.strip()])
    verdicts = json.loads(Path(a.verdicts).read_text()) if a.verdicts else {}
    packet_args = s1_args(book, manifest, blocks, maths, int(a.chapter),
                          prior=prior_objectives(p["objectives"], int(a.chapter)))
    ev = evaluate_chapter(packet_args["chapter"], run, egyptian_vocabulary(), verdicts,
                          packet_args.get("prior_objectives") or [])
    owed = undecided(ev["decisions"], verdicts)
    if ev["failures"] or owed:
        for f in ev["failures"]:
            print(f"  FAIL {f}")
        for d in owed:
            print(f"  OWED {d['kind']}: {d['detail']}  (key {d['key']})")
        print(f"G1 NOT recorded for chapter {a.chapter}: {len(ev['failures'])} failure(s), "
              f"{len(owed)} decision(s) without a verdict")
        return 1
    g1 = {"approved_by": a.by, "approved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
          "verdicts": verdicts or None}
    res = assemble(book, packet_args, run, p["objectives"], egyptian_vocabulary(), verdicts, g1)
    print(f"G1 recorded for chapter {a.chapter} by {a.by}: {res['check']['counts']['objectives']} "
          f"objectives approved. Record the gate in the feature's decisions.md → Gate record, and "
          f"commit {p['objectives']}.")
    return 0


def cmd_lesson_args(a) -> int:
    book = _book(a)
    p, manifest, blocks, maths = _inputs(book, a)
    args = lesson_args(book, manifest, blocks, maths, p["objectives"],
                       [s.strip() for s in a.lessons.split(",") if s.strip()], p["work"])
    _emit(args, a.out, f"lesson args: {len(args['lessons'])} lesson(s), "
                       f"{sum(len(l['items']) for l in args['lessons'])} exercise item(s), "
                       f"{sum(len(l['worked_examples']) for l in args['lessons'])} worked example(s)")
    return 0


def cmd_lesson_runs(a) -> int:
    book = _book(a)
    p = _paths(book, a)
    run = json.loads(Path(a.run).read_text())
    run = run.get("result", run)
    g2 = json.loads(Path(a.g2).read_text()) if a.g2 else None
    files = lesson_runs(run, g2)
    out = p["runs"] / "lesson"
    out.mkdir(parents=True, exist_ok=True)
    for slug, rec in files.items():
        (out / f"{slug}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(files)} lesson run file(s) → {out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("book", help="the book config name (books/<book>.json)")
        for opt in ("--book-config", "--blocks", "--manifest", "--maths", "--objectives-dir", "--runs-dir"):
            p.add_argument(opt)

    p = sub.add_parser("s1-args", help="one chapter's S1 workflow args")
    common(p)
    p.add_argument("--chapter", type=int, required=True)
    p.add_argument("--no-second-mapper", action="store_true",
                   help="map the distributed items with one mapper only (the default is two blind "
                        "mappers, answer 12; a disagreement goes to G1)")
    p.add_argument("--no-links", action="store_true",
                   help="do not look for prerequisite links (the default does, answer 4)")
    p.add_argument("--by-ref", nargs="?", const="", default=None, metavar="DIR",
                   help="packet by reference (packet_ref.py): write the chapter's text to shard files in DIR "
                        "(default work/<book>/packets/s1-chNN/) and emit compact args naming them")
    p.add_argument("--out")
    p.set_defaults(fn=cmd_s1_args)
    p = sub.add_parser("assemble", help="apply the §3.4 rules to saved S1 output")
    common(p)
    p.add_argument("runs", nargs="+", help="saved S1 workflow return values for ONE chapter")
    p.set_defaults(fn=cmd_assemble)
    p = sub.add_parser("approve", help="record gate G1 for a chapter")
    common(p)
    p.add_argument("--chapter", type=int, required=True)
    p.add_argument("--by", required=True, help="who passed G1")
    p.add_argument("--verdicts", help="G1 verdicts JSON: objectives, move_items, outside_items (answer 15: "
                                      "{item: {why}} for an end-of-chapter item outside the chapter's objectives), "
                                      "terminology, links, acknowledged")
    p.set_defaults(fn=cmd_approve)
    p = sub.add_parser("lesson-args", help="S2–S4 workflow args for G1-approved lessons")
    common(p)
    p.add_argument("--lessons", required=True)
    p.add_argument("--out")
    p.set_defaults(fn=cmd_lesson_args)
    p = sub.add_parser("lesson-runs", help="split a lesson-workflow output into per-lesson run files")
    common(p)
    p.add_argument("run", help="the saved lesson.workflow.js return value")
    p.add_argument("--g2", help="G2 verdicts JSON: {by, items: {'<slug>:<ref>': {verdict, note, fields}}}")
    p.set_defaults(fn=cmd_lesson_runs)
    a = ap.parse_args(argv)
    try:
        return a.fn(a)
    except StageError as e:
        print(f"assemble_objectives: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

"""S9 Assemble: run outputs -> one SeedBundle per chapter (extraction-pipeline.md §3.12, B8).

    uv run assemble_lesson_bundle.py --book g10-math                    # every chapter
    uv run assemble_lesson_bundle.py --book g10-math --chapter 8        # the pilot chapter
    uv run assemble_lesson_bundle.py --book g10-math --check            # assemble + validate, write nothing
    uv run assemble_lesson_bundle.py --book <path/to/config.json> --manifest … --objectives … \\
        --runs … --out …                                                # any input or output moved

WHAT IT READS (every path from the book config unless overridden):

    manifest      books/<book>.json `manifest` — the S0 manifest WITH G0 APPLIED (T402/T403,
                  build_manifest.py). Per lesson: `id` (the slug), `title`, `order_in_module`,
                  and its `book_provenance` {sections: [{number, title}], part {n, of} | null,
                  chapter_intro}. (The scouting draft's single `section` + `title` is read as
                  one section, no part, no introduction.)
    objectives    objectives/<book>/<slug>.json — S1 after gate G1 (B5, WP-P2):
                  {lesson, objectives: [{id, label, statement, evidence: [...],
                   exercise_items: [...]}], prerequisites: [{src, dst}]}
    runs          runs/<book>/lesson/<slug>.json — S2–S4 after gate G2 (B6, WP-P3):
                  {lesson, claims: [...], items: [...], visuals: [...], viz_gaps: [...],
                   teacher_only: {seen, dropped, reached_claim}}
                  Item, visual and claim shapes: the RunItem / RunVisual / RunClaim models below.

WHAT IT WRITES (`--out`, default seed/<book>/):

    <prefix>-course.json   the program node, the course node and `course part_of program`
                           (ADR-0024). Every chapter bundle names the course in
                           external_node_refs, so this bundle loads first.
    <prefix>-cNN.json      one SeedBundle per chapter: its module, objectives, the book's own
                           prerequisite edges (S1's links, approved at G1), book questions,
                           visuals, the non-markable items as worked-example library entries,
                           and every lesson's book provenance (`lessons`, FR-4311), plus
                           `claims` and `assembled_from`.
    ../content/<slug>.json one lesson-content file per lesson (`--content-out`, default the
                           bundles' sibling `content/`, i.e. seed/content/): the HOME OF S2's
                           CLAIMS, where the lesson surfaces read a lesson's content
                           (app/src/lib/lesson-content.ts, the Social and Arabic shape). Its
                           `claims` are the grounded statements, each with its anchor, printed
                           page and provenance; `subtopics` groups them per objective (the
                           exposition is the claims' own words in book order, nothing added).
                           The bundle keeps `claims` too, as the checkable record.

IDS (specs/003 contracts/pipeline-handoff.md) are MINTED here, through the helpers in
schemas.py, and nowhere else:
    question     q:<lo tail>:we03 | q:<lo tail>:ex8-2-5b
    worked ex.   expl:<lo tail>:we03 | expl:<lo tail>:ex8-2-5b   (a not-markable item: teaching
                 material, not a question row, FR-4303)
    visual       v:<slug>:001
An id is a function of the item's place in the book and its objective, so re-assembling the
same inputs gives the same ids (FR-4404).

ANSWER TYPES (FR-4303, FR-4320): numeric -> `numeric`; choice -> `mcq`; expression -> `short`
with `choices: {"marker": {...}}` (contracts/answer-marker.md) and the printed answer as the
text answer; not_markable -> a worked-example library entry, never a question row.

THE APP'S MARKER CHECKS EVERY SPEC (marker_check.mjs: the app's own `readMarkerSpec` and
`validateKey`, answer-marker.ts). A spec the app would reject refuses the assembly: it would be a
server error the first time a student answered. A key the marker cannot read, or that does not
mark itself correct, HOLDS its question (verified false, so it loads at review and G2 sees it):
no student can ever be marked right against it. `--no-marker-check` skips this and says so in the
report; nothing the line ships should use it.

NOTATION (decision 15, FR-4308): a decimal comma becomes a point and `(x; y)` becomes
`(x, y)` — likewise intervals `[a; b)` and sets `\\{a; b\\}` — in stems, choices, answers,
marker keys, solutions, captions, claims and worked-example entries. Words and contexts (the
Rand, "gradient") stay as printed. A bracket whose content reads as prose is left alone.
An aligned derivation `\\begin{align*}…\\end{align*}` inside `$…$` becomes `\\begin{aligned}…
\\end{aligned}`: the app renders every `$…$` inline, and KaTeX draws align* only in display mode —
inline it shows a red parse error with the raw source (the Chapter 8 pilot's "&amp;": KaTeX's error
text, HTML-escaped). The coverage audit counts any align left in a bundle as residual.

PART PREREQUISITES (FR-4317) are DERIVED — every objective of part n-1 before every objective
of part n — and checked for cycles together with the book's own edges. They are never written
into `edges`: the book's edges stay exactly the book's (migration 034, data-model.md §2).

VALIDATION: every bundle through the real `schemas.SeedBundle` (referential integrity, the DAG,
lesson provenance, marker specs), then the book-level rules no single bundle can see: slugs
unique, a section's parts consecutive and numbered 1..m, no section claimed by two lessons, and
the prerequisite graph (book ∪ derived, across chapters) acyclic. Any failure writes nothing.

TWO EXTRA KEYS that `SeedBundle` does not model and the loader does not read: `claims` (S2's
grounded statements, the record; they are SERVED from the lesson-content files) and
`assembled_from` (the sha256 of every input, so a bundle is a checkable replay of committed run
outputs, QA point 16). The
solution's source is also written into `source_note` in the fixed form
    "<where in the book> · p.<page> · solution: <provenance>"
which `lib/provenance.ts` can parse (FR-4310).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

import book_config
import schemas
from schemas import Lesson

HERE = Path(__file__).resolve().parent
EXTRACTOR = "extraction line v2 (assemble_lesson_bundle.py)"
EXTRACTOR_VERSION = "b8-1"

AnswerType = Literal["numeric", "choice", "expression", "not_markable"]
ITEM_REF = r"^(WE\d{1,3}|Ex\d{1,2}-\d{1,2}:\d{1,3}[a-z]{0,3}(?:-[ivx]+)?)$"
SOLUTION_NOTE_RE = re.compile(
    r" · solution: (book_worked|book_worked_epub|teachers_guide|answer_anchored)$")


# =============================================================================
# Notation (decision 15)
# =============================================================================

_DEC_COMMA = re.compile(r"(?<=\d),(?=\d)")            # 3,317  -> 3.317
_DEC_LATEX = re.compile(r"(?<=\d)\{,\}(?=\d)")         # 3{,}317 -> 3.317  (LaTeX from S0b)
_LATEX_CMD = re.compile(r"\\[A-Za-z]+")
_WORD = re.compile(r"[A-Za-z]{3,}")

# What a residual decimal comma looks like; the coverage audit counts these (and
# `;`-separated bracket groups, via semicolon_groups) in the assembled bundles and
# requires 0.
RESIDUAL_DECIMAL = re.compile(r"\d(?:,|\{,\})\d")
# display-only environments KaTeX refuses inside the app's inline `$…$` (align, align*, eqnarray…)
DISPLAY_ENV = re.compile(r"\\(begin|end)\{(align\*?|eqnarray\*?|gather\*?|multline\*?)\}")
_ALIGN_ENV = re.compile(r"\\(begin|end)\{align\*?\}")


def _mathy(inner: str) -> bool:
    """A bracket group reads as maths, not as a parenthetical sentence."""
    return not _WORD.search(_LATEX_CMD.sub(" ", inner))


def semicolon_groups(text: str) -> list[tuple[int, int, list[int]]]:
    r"""Bracket groups with `;` at their own top level: (open, close, [positions of `;`]).

    A small scanner rather than a regex, because the components of a pair are often
    fractions — `\left(\frac{x_1 + x_2}{2}; \frac{y_1 + y_2}{2}\right)` — whose braces a
    regex cannot balance. `(` and `[` open a group and `)` or `]` close it, in any
    combination, because an interval is a pair too: `[2; 5)`. `\{ … \}` is a set. A
    LaTeX group `{ … }` is transparent: its `;` belongs to it, not to the enclosing
    bracket. Anything unbalanced is left alone.
    """
    out: list[tuple[int, int, list[int]]] = []
    stack: list[tuple[str, int, list[int]]] = []     # (kind, open index, semicolons)
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if text.startswith("\\{", i) or text.startswith("\\}", i):
            if ch == "\\" and text[i + 1] == "{":
                stack.append(("set", i, []))
            else:
                while stack and stack[-1][0] == "group":
                    stack.pop()
                if stack and stack[-1][0] == "set":
                    kind, o, semis = stack.pop()
                    if semis:
                        out.append((o, i + 1, semis))
            i += 2
            continue
        if ch == "\\":                       # any other command: skip its name
            j = i + 1
            while j < n and text[j].isalpha():
                j += 1
            i = max(j, i + 2) if j == i + 1 else j
            continue
        if ch == "{":
            stack.append(("group", i, []))
        elif ch == "}":
            if stack and stack[-1][0] == "group":
                stack.pop()
        elif ch in "([":
            stack.append(("bracket", i, []))
        elif ch in ")]":
            if stack and stack[-1][0] == "bracket":
                kind, o, semis = stack.pop()
                if semis:
                    out.append((o, i, semis))
        elif ch == ";" and stack and stack[-1][0] in ("bracket", "set"):
            stack[-1][2].append(i)
        i += 1
    return [(o, c, semis) for o, c, semis in out if _mathy(text[o + 1:c])]


def normalise(text: str | None) -> tuple[str | None, Counter]:
    """(normalised text, Counter of what changed: decimal, pair)."""
    counts: Counter = Counter()
    if not text:
        return text, counts
    text, n0 = _ALIGN_ENV.subn(lambda m: f"\\{m.group(1)}{{aligned}}", text)
    if n0:
        counts["aligned"] += n0 // 2 or 1
    out, n1 = _DEC_LATEX.subn(".", text)
    out, n2 = _DEC_COMMA.subn(".", out)
    if n1 + n2:
        counts["decimal"] += n1 + n2
    groups = semicolon_groups(out)
    if groups:
        positions = sorted(p for _, _, semis in groups for p in semis)
        counts["pair"] += len(groups)
        for p in reversed(positions):
            a, b = p, p + 1
            while a > 0 and out[a - 1] == " ":
                a -= 1
            while b < len(out) and out[b] == " ":
                b += 1
            out = out[:a] + ", " + out[b:]
    return out, counts


def residual_notation(text: str | None) -> list[str]:
    """Un-normalised decimal commas or `;`-pairs left in a text (the coverage audit's probe)."""
    if not text:
        return []
    hits = [m.group(0) for m in RESIDUAL_DECIMAL.finditer(text)]
    hits += [m.group(0) for m in DISPLAY_ENV.finditer(text)]
    hits += [text[o:c + 1] for o, c, _ in semicolon_groups(text)]
    return hits




# =============================================================================
# Book provenance across the whole book (FR-4311, FR-4312, FR-4317)
# =============================================================================

def check_lessons(lessons: list[Lesson]) -> list[str]:
    """Book-level rules over lessons IN CATALOGUE ORDER. Empty list = fine.

    SeedBundle checks one bundle; these hold across all of them: slugs unique, a split
    section's parts consecutive, numbered 1..m and in one module, a lesson without a part
    never sharing a section with another lesson.
    """
    problems: list[str] = []
    slugs = Counter(l.slug for l in lessons)
    problems += [f"lesson slug {s} appears {n} times" for s, n in slugs.items() if n > 1]
    parts: dict[str, list[tuple[int, Lesson]]] = defaultdict(list)
    for i, l in enumerate(lessons):
        if l.part:
            parts[l.group_key].append((i, l))
    for key, members in parts.items():
        ns = [l.part.n for _, l in members]
        m = {l.part.of for _, l in members}
        if len(m) != 1 or sorted(ns) != list(range(1, next(iter(m)) + 1)):
            problems.append(f"section {key}: parts {ns} of {sorted(m)}, expected 1..m, each once")
        idx = [i for i, _ in members]
        if idx != list(range(idx[0], idx[0] + len(idx))) or ns != sorted(ns):
            problems.append(f"section {key}: parts are not consecutive in catalogue order, in part "
                            f"order (FR-4312): {[l.slug for _, l in members]}")
        if len({l.module for _, l in members}) != 1:
            problems.append(f"section {key}: parts sit in different modules")
    owner: dict[str, str] = {}
    for l in lessons:
        for s in l.sections:
            prev = owner.get(s.number)
            if prev and not (l.part and prev in {x.slug for _, x in parts.get(s.number, [])}):
                problems.append(f"section {s.number} is claimed by both {prev} and {l.slug}")
            owner.setdefault(s.number, l.slug)
    return problems


def derived_part_edges(lessons: list[Lesson], los_by_lesson: dict[str, list[str]]
                       ) -> list[tuple[str, str]]:
    """FR-4317: every objective of part n-1 before every objective of part n."""
    edges: list[tuple[str, str]] = []
    by_group: dict[str, dict[int, str]] = defaultdict(dict)
    for l in lessons:
        if l.part:
            by_group[l.group_key][l.part.n] = l.slug
    for parts in by_group.values():
        for n in sorted(parts):
            if n - 1 in parts:
                edges += [(a, b) for a in los_by_lesson.get(parts[n - 1], [])
                          for b in los_by_lesson.get(parts[n], [])]
    return edges


def find_cycle(edges: list[tuple[str, str]]) -> list[str] | None:
    adj: dict[str, list[str]] = defaultdict(list)
    for s, d in edges:
        adj[s].append(d)
    state: dict[str, int] = {}
    stack: list[str] = []

    def dfs(u: str) -> list[str] | None:
        state[u] = 0
        stack.append(u)
        for v in adj.get(u, []):
            if state.get(v) == 0:
                return stack[stack.index(v):] + [v]
            if v not in state and (c := dfs(v)):
                return c
        stack.pop()
        state[u] = 1
        return None

    for s in list(adj):
        if s not in state and (c := dfs(s)):
            return c
    return None


# =============================================================================
# Inputs
# =============================================================================

class Evidence(BaseModel):
    model_config = ConfigDict(extra="allow")
    kind: Literal["heading", "intro", "summary", "definition", "worked_example", "exercise"]
    anchor: str
    printed_page: int
    quote: Optional[str] = None


class Objective(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(pattern=r"^lo:[a-z0-9]+-[0-9]+-[0-9]+$")
    label: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    evidence: list[Evidence] = Field(min_length=1)
    exercise_items: list[str] = []


class PrereqRef(BaseModel):
    model_config = ConfigDict(extra="allow")
    src: str
    dst: str


class ObjectivesFile(BaseModel):
    model_config = ConfigDict(extra="allow")
    lesson: str
    objectives: list[Objective] = Field(min_length=1)
    prerequisites: list[PrereqRef] = []


class Gate2(BaseModel):
    model_config = ConfigDict(extra="allow")
    verdict: Literal["accept", "fix", "exclude", "hold"]
    by: str = Field(min_length=1)
    note: Optional[str] = None


class RunItem(BaseModel):
    """One S3 book item after gate G2 (extraction-pipeline.md §3.6)."""
    model_config = ConfigDict(extra="allow")
    ref: str = Field(pattern=ITEM_REF)
    kind: Literal["worked_example", "exercise"]
    lo: str
    stem: str = Field(min_length=1)
    answer_type: AnswerType
    answer: Optional[str] = None
    choices: Optional[list[dict]] = None
    marker: Optional[dict] = None
    solution: list[str] = Field(min_length=1)
    solution_provenance: schemas.SolutionProvenance
    printed_answer: Optional[str] = None
    epub_final_answer: Optional[str] = None
    blind_answer: Optional[str] = None
    verification: Literal["agreed", "disputed", "no_printed_answer"]
    g2: Optional[Gate2] = None
    tier: schemas.Tier
    printed_page: int
    shortcode: Optional[str] = None
    teacher_only: bool = False
    # G2 (decisions 41 and 43; contracts/pipeline-handoff.md). `less_specific`: the keys of OTHER
    # options that are also true, less precisely — the app returns such a pick for re-entry and never
    # marks it wrong. `answer_only`: the book has no working, so the item is marked on its answer and
    # the tutor gives no step-by-step explanation.
    less_specific: Optional[list[str]] = None
    answer_only: Optional[bool] = None

    @model_validator(mode="after")
    def _typed(self) -> "RunItem":
        if self.teacher_only:
            raise ValueError(f"{self.ref}: a teacher-only block reached S3 (FR-4408)")
        if self.ref.startswith("WE") != (self.kind == "worked_example"):
            raise ValueError(f"{self.ref}: kind {self.kind} does not match its reference")
        if (self.kind == "worked_example") != (self.solution_provenance == "book_worked"):
            raise ValueError(f"{self.ref}: a worked example's solution is `book_worked`, and only "
                             f"a worked example's is (got {self.solution_provenance})")
        if self.answer_type == "choice":
            keys = [c.get("key") for c in self.choices or []]
            if len(keys) < 2 or self.answer not in keys:
                raise ValueError(f"{self.ref}: a choice item needs >= 2 choices and its key "
                                 f"among them")
        elif self.choices:
            raise ValueError(f"{self.ref}: only a choice item carries choices")
        if self.answer_type == "expression":
            if not self.marker:
                raise ValueError(f"{self.ref}: an expression item carries its marker spec "
                                 "(contracts/answer-marker.md)")
            schemas.AnswerSpec.model_validate(self.marker)
        elif self.marker:
            raise ValueError(f"{self.ref}: only an expression item carries a marker spec")
        if self.answer_type in ("numeric", "choice") and not self.answer:
            raise ValueError(f"{self.ref}: a {self.answer_type} item needs its answer key")
        if self.verification == "no_printed_answer" and self.printed_answer:
            raise ValueError(f"{self.ref}: 'no_printed_answer' but a printed answer is given")
        if self.less_specific is not None:
            keys = [c.get("key") for c in self.choices or []]
            if self.answer_type != "choice":
                raise ValueError(f"{self.ref}: less_specific belongs to a choice item, not {self.answer_type}")
            bad = [k for k in self.less_specific if k not in keys]
            if not self.less_specific or bad or len(set(self.less_specific)) != len(self.less_specific):
                raise ValueError(f"{self.ref}: less_specific {self.less_specific} must name other options "
                                 f"(keys {keys}), each once")
            if self.answer in self.less_specific:
                raise ValueError(f"{self.ref}: the key {self.answer!r} is the most specific answer, not a "
                                 "less specific one")
        if self.answer_only is not None:
            if self.answer_only is not True or self.answer_type != "expression":
                raise ValueError(f"{self.ref}: answer_only is `true` on a marked expression item only")
            pair = next((p for p in ((self.model_extra or {}).get("verify") or {}).get("pairs") or []
                         if str(p.get("pair_id", "")).endswith("|blind~printed")), None)
            if not (self.printed_answer and self.blind_answer and pair and pair.get("verdict") == "equivalent"):
                raise ValueError(f"{self.ref}: answer_only marks the answer alone, so its key must be agreed "
                                 "by the printed answer AND the blind re-solve (blind~printed equivalent)")
        return self

    def question_id(self) -> str:
        if self.kind == "worked_example":
            return schemas.worked_example_question_id(self.lo, int(self.ref[2:]))
        return schemas.exercise_question_id(self.lo, self.ref)

    def where(self) -> str:
        if self.kind == "worked_example":
            return f"Worked example {int(self.ref[2:])}"
        label, q = self.ref[2:].split(":")
        code = f" ({self.shortcode})" if self.shortcode else ""
        return f"Exercise {label}, question {q}{code}"

    def fate(self) -> str:
        """verified | held | excluded | teaching — what becomes of the item (handoff table)."""
        if self.g2 and self.g2.verdict == "exclude":
            return "excluded"
        if self.answer_type == "not_markable":
            return "teaching"
        if self.g2 and self.g2.verdict in ("accept", "fix"):
            return "verified"
        if self.verification == "agreed" and not self.g2:
            return "verified"
        return "held"


class RunVisual(BaseModel):
    model_config = ConfigDict(extra="allow")
    n: int = Field(ge=1)
    lo: str
    question: Optional[str] = None          # an item ref (WE3, Ex8-2:5b) or None
    kind: str
    spec: dict
    caption: Optional[str] = None
    printed_page: Optional[int] = None


class RunClaim(BaseModel):
    model_config = ConfigDict(extra="allow")
    lo: str
    provenance: Optional[str] = None    # containment | checked | re-audited (lesson.workflow.js)
    type: schemas.ClaimType
    text: str = Field(min_length=1)
    anchor: str
    printed_page: int
    evidence_kind: Optional[schemas.EvidenceKind] = None
    supported: bool = True
    teacher_only: bool = False

    def kind(self) -> str:
        if self.evidence_kind:
            return self.evidence_kind
        if self.anchor.startswith("WE"):
            return "worked_example"
        if self.anchor.startswith("Ex"):
            return "exercise"
        return "box" if self.type == "caution" else "heading"


class TeacherOnly(BaseModel):
    model_config = ConfigDict(extra="allow")
    seen: int = 0
    dropped: int = 0
    reached_claim: int = 0


class LessonRun(BaseModel):
    model_config = ConfigDict(extra="allow")
    lesson: str
    claims: list[RunClaim] = []
    items: list[RunItem] = []
    visuals: list[RunVisual] = []
    viz_gaps: list[dict] = []
    teacher_only: TeacherOnly = Field(default_factory=TeacherOnly)


# =============================================================================
# The manifest, read leniently: WP-P1 owns its shape (T402)
# =============================================================================

def manifest_lessons(manifest: dict) -> list[tuple[dict, dict]]:
    """(module, lesson) pairs in book order."""
    out = []
    for mod in sorted(manifest["modules"], key=lambda m: m.get("order_in_parent") or m["chapter"]):
        for les in sorted(mod.get("lessons", []), key=lambda l: l.get("order_in_module", 0)):
            out.append((mod, les))
    return out


def book_lesson(mod: dict, les: dict) -> Lesson:
    """A manifest lesson's provenance as schemas.Lesson.

    B3 (build_manifest.py) writes it under `book_provenance` {sections: [{number, title,
    code}], part, chapter_intro, group_key}; top-level `sections`/`part`/`chapter_intro` are
    read too, and a scouting-draft lesson (one `section`) is one section, no part.
    """
    bp = les.get("book_provenance") or les
    sections = bp.get("sections") or [{"number": les["section"], "title": les["title"]}]
    sections = [{"number": x["number"], "title": x["title"]} for x in sections]
    return Lesson(slug=les["id"], title=les["title"], module=mod["id"], sections=sections,
                  part=bp.get("part"), chapter_intro=bool(bp.get("chapter_intro")))


# =============================================================================
# Assembly
# =============================================================================

class AssemblyError(Exception):
    pass


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def rel(p: Path) -> str:
    try:
        return str(p.resolve().relative_to(book_config.REPO_ROOT))
    except ValueError:
        return str(p)


def source_document(book, manifest: dict) -> dict:
    mb = manifest.get("book", {})
    return {"title": mb.get("title") or book.title, "publisher": mb.get("publisher") or "unknown",
            "edition": mb.get("edition"), "language": book.language, "grade": book.grade,
            "subject": "mathematics" if book.subject == "math" else book.subject,
            "file_path": book.sources.pdf}


def program_of(book) -> tuple[str, str]:
    if book.program:
        return book.program.id, book.program.label
    return f"program:{book.curriculum}", book.curriculum


def extraction_run() -> dict:
    return {"extractor": EXTRACTOR, "extractor_version": EXTRACTOR_VERSION, "schema_version": "1"}


def course_bundle(book, manifest: dict) -> dict:
    pid, plabel = program_of(book)
    edition = manifest.get("book", {}).get("edition")
    return {
        "source_document": source_document(book, manifest),
        "extraction_run": extraction_run(),
        "syllabus_version": edition or "unversioned",
        "nodes": [{"id": pid, "kind": "program", "label": plabel},
                  {"id": book.course_id, "kind": "course", "label": book.title,
                   "syllabus_ref": edition}],
        "edges": [{"src": book.course_id, "dst": pid, "type": "part_of"}],
        "questions": [],
    }


class Report:
    def __init__(self) -> None:
        self.counts: Counter = Counter()
        self.notation: Counter = Counter()
        self.notation_items: set[str] = set()
        self.excluded: list[dict] = []
        self.by_provenance: Counter = Counter()
        self.by_answer_type: Counter = Counter()
        self.derived_part_edges = 0
        self.content: dict[str, dict] = {}     # slug -> the lesson-content file (S2's claims)
        self.held_by_marker: list[dict] = []   # questions held: the app's marker cannot mark their key
        self.marker_check = "run"

    def as_dict(self) -> dict:
        return {"counts": dict(sorted(self.counts.items())),
                "notation": {"changes": dict(self.notation),
                             "items_normalised": len(self.notation_items)},
                "by_solution_provenance": dict(sorted(self.by_provenance.items())),
                "by_answer_type": dict(sorted(self.by_answer_type.items())),
                "excluded": self.excluded, "derived_part_edges": self.derived_part_edges,
                "marker_check": self.marker_check, "held_by_marker": self.held_by_marker}


def _norm(text: str | None, where: str, report: Report) -> str | None:
    out, c = normalise(text)
    if c:
        report.notation.update(c)
        if c.get("decimal") or c.get("pair"):       # decision 15's items; `aligned` is presentation only
            report.notation_items.add(where)
    return out


def assemble_chapter(book, manifest: dict, mod: dict, lessons: list[Lesson],
                     objectives: dict[str, ObjectivesFile], runs: dict[str, LessonRun],
                     report: Report, inputs: dict[str, Path]) -> dict:
    course = book.course_id
    nodes: list[dict] = [{
        "id": mod["id"], "kind": "module", "label": f"Chapter {mod['chapter']} — {mod['title']}",
        "syllabus_ref": f"Chapter {mod['chapter']}",
        "source_page": (mod.get("printed_pages") or [None])[0],
        "order_in_parent": mod.get("order_in_parent") or mod["chapter"]}]
    edges: list[dict] = [{"src": mod["id"], "dst": course, "type": "part_of"}]
    questions: list[dict] = []
    visuals: list[dict] = []
    entries: list[dict] = []
    claims: list[dict] = []
    los_here: set[str] = set()
    order = 0
    for les in lessons:
        obj = objectives.get(les.slug)
        if obj is None:
            raise AssemblyError(f"{les.slug}: no objectives file (S1 after G1)")
        if obj.lesson != les.slug:
            raise AssemblyError(f"objectives file for {les.slug} says lesson {obj.lesson!r}")
        want = [schemas.lo_id(les.slug, i) for i in range(1, len(obj.objectives) + 1)]
        got = [o.id for o in obj.objectives]
        if got != want:
            raise AssemblyError(f"{les.slug}: objectives must be numbered in book order "
                                f"{want}, got {got}")
        sref = ", ".join(s.number for s in les.sections)
        for o in obj.objectives:
            order += 1
            los_here.add(o.id)
            nodes.append({"id": o.id, "kind": "learning_objective", "label": o.label,
                          "description": o.statement, "syllabus_ref": sref,
                          "source_page": min(e.printed_page for e in o.evidence),
                          "order_in_parent": order})
            edges.append({"src": mod["id"], "dst": o.id, "type": "teaches"})
        for pr in obj.prerequisites:
            if pr.dst not in set(want):
                raise AssemblyError(f"{les.slug}: prerequisite {pr.src} -> {pr.dst} must end at "
                                    "one of this lesson's own objectives")
            edges.append({"src": pr.src, "dst": pr.dst, "type": "prerequisite_of"})
        report.counts["objectives"] += len(obj.objectives)

    for les in lessons:
        run = runs.get(les.slug)
        if run is None:
            raise AssemblyError(f"{les.slug}: no lesson run output (S2–S4 after G2)")
        if run.lesson != les.slug:
            raise AssemblyError(f"run file for {les.slug} says lesson {run.lesson!r}")
        own = {schemas.lo_id(les.slug, i)
               for i in range(1, len(objectives[les.slug].objectives) + 1)}
        if run.teacher_only.reached_claim:
            raise AssemblyError(f"{les.slug}: {run.teacher_only.reached_claim} teacher-only "
                                "block(s) reached a claim (FR-4408)")
        for c in run.claims:
            if c.teacher_only:
                raise AssemblyError(f"{les.slug}: a teacher-only claim (FR-4408)")
            if c.lo not in own:
                raise AssemblyError(f"{les.slug}: claim on {c.lo}, not this lesson's objective")
            if not c.supported:
                report.counts["claims_unsupported_dropped"] += 1
                continue
            step = {"claim": _norm(c.text, f"{les.slug}:claim:{c.anchor}", report), "lang": "en",
                    "claim_type": c.type, "anchor": c.anchor, "evidence_page": c.printed_page,
                    "evidence_kind": c.kind()}
            schemas.ClaimStep.model_validate(step)
            claims.append({"lo": c.lo, **step, **({"provenance": c.provenance}
                                                  if getattr(c, "provenance", None) else {})})
        refs: dict[str, str] = {}
        detached: set[str] = set()          # items that are not question rows (teaching, excluded)
        seen_refs: set[str] = set()
        for it in run.items:
            if it.ref in seen_refs:
                raise AssemblyError(f"{les.slug}: item {it.ref} appears twice")
            seen_refs.add(it.ref)
            if it.lo not in own:
                raise AssemblyError(f"{les.slug}: item {it.ref} is mapped to {it.lo}, which is not "
                                    "one of this lesson's objectives")
            qid = it.question_id()
            fate = it.fate()
            report.counts[f"{it.kind}:{fate}"] += 1
            report.by_answer_type[it.answer_type] += 1
            wkey = f"{les.slug}:{it.ref}"
            stem = _norm(it.stem, wkey, report)
            solution = [_norm(s, wkey, report) for s in it.solution]
            if fate in ("excluded", "teaching"):
                detached.add(it.ref)
            if fate == "excluded":
                report.excluded.append({"lesson": les.slug, "ref": it.ref, "kind": it.kind,
                                        "reason": f"excluded at G2 by {it.g2.by}"
                                                  + (f": {it.g2.note}" if it.g2.note else "")})
                continue
            if fate == "teaching":
                entries.append({
                    "id": "expl:" + qid.removeprefix("q:"), "lo": it.lo,
                    "entry_type": "worked_example",
                    "content": [{"kind": "problem", "text_md": stem}]
                               + [{"step": i + 1, "text_md": s} for i, s in enumerate(solution)],
                    "source_page": it.printed_page,
                    "generated_by": f"book ({it.solution_provenance}); {EXTRACTOR}"})
                report.excluded.append({"lesson": les.slug, "ref": it.ref, "kind": it.kind,
                                        "reason": "not markable: kept as a worked example"})
                continue
            refs[it.ref] = qid
            report.by_provenance[it.solution_provenance] += 1
            q: dict = {"id": qid, "lo": it.lo, "tier": it.tier,
                       "type": {"numeric": "numeric", "choice": "mcq",
                                "expression": "short"}[it.answer_type],
                       "stem": stem}
            if it.answer_type == "choice":
                options = [{"key": c["key"], "text": _norm(c["text"], wkey, report)} for c in it.choices]
                # decision 41: other TRUE options travel as `less_specific` (pipeline-handoff.md)
                q["choices"] = ({"options": options, "less_specific": list(it.less_specific)}
                                if it.less_specific else options)
                q["answer"] = it.answer
            elif it.answer_type == "expression":
                marker = dict(it.marker)
                marker["key"] = _norm(marker["key"], wkey, report)
                q["choices"] = {"marker": marker, **({"answer_only": True} if it.answer_only else {})}
                # the answer as text, for the tutor and the console (schemas.Question): the printed
                # answer when all three agreed and G2 changed nothing; otherwise the key G2 approved —
                # never a printed answer G2 corrected (the S5 pilot read "y = 2x + 12" beside the key
                # y = 2x + 7 of a book error G2 had fixed)
                trusted = it.verification == "agreed" and not (it.g2 and it.g2.verdict == "fix")
                q["answer"] = _norm((it.printed_answer if trusted else None) or marker["key"], wkey, report)
            else:
                ans = _norm(it.answer, wkey, report).replace(" ", "")
                if not re.fullmatch(r"-?\d+(?:\.\d+)?(?:/\d+)?", ans.replace("−", "-")):
                    raise AssemblyError(f"{les.slug}: {it.ref} is typed numeric but its key "
                                        f"{it.answer!r} is not a number after normalisation — "
                                        "type it 'expression', or put the unit in the stem")
                q["answer"] = ans
            q.update({
                "solution": solution, "source_page": it.printed_page,
                "source_note": f"{it.where()} · p.{it.printed_page} · solution: "
                               f"{it.solution_provenance}",
                "verified": fate == "verified", "source": "seed",
                "solution_provenance": it.solution_provenance})
            questions.append(q)
        for v in run.visuals:
            if v.lo not in own:
                raise AssemblyError(f"{les.slug}: visual {v.n} on {v.lo}, not this lesson's")
            if v.question and v.question not in refs and v.question not in detached:
                raise AssemblyError(f"{les.slug}: visual {v.n} names item {v.question}, which is "
                                    "not an item of this lesson")
            if v.question in detached:
                # the figure is the book's and stays with the objective; the item it
                # illustrated is teaching material or was excluded at G2
                report.counts["visuals_detached_from_non_questions"] += 1
            visuals.append({"id": f"v:{les.slug}:{v.n:03d}", "lo": v.lo,
                            "question": refs.get(v.question) if v.question else None,
                            "kind": v.kind, "spec": v.spec,
                            "caption": _norm(v.caption, f"{les.slug}:v{v.n}", report),
                            "source_page": v.printed_page})
        report.counts["viz_gaps"] += len(run.viz_gaps)
        report.counts["teacher_only_dropped"] += run.teacher_only.dropped

    external = {course} | {e["src"] for e in edges
                           if e["type"] == "prerequisite_of" and e["src"] not in los_here}
    ids = [q["id"] for q in questions] + [v["id"] for v in visuals] + [x["id"] for x in entries]
    dup = [i for i, n in Counter(ids).items() if n > 1]
    if dup:
        raise AssemblyError(f"chapter {mod['chapter']}: duplicate minted ids {dup[:5]}")
    report.counts["questions"] += len(questions)
    report.counts["visuals"] += len(visuals)
    report.counts["worked_example_entries"] += len(entries)
    report.counts["claims"] += len(claims)
    return {
        "source_document": source_document(book, manifest),
        "extraction_run": extraction_run(),
        "syllabus_version": manifest.get("book", {}).get("edition") or "unversioned",
        "nodes": nodes, "edges": edges, "questions": questions, "visuals": visuals,
        "external_node_refs": sorted(external),
        "explanation_entries": entries,
        "lessons": [l.model_dump(mode="json", exclude_defaults=True) for l in lessons],
        "claims": claims,
        # what this bundle is a replay of (QA point 16): logical input name -> sha256
        "assembled_from": {k: sha256_file(p) for k, p in sorted(inputs.items())},
    }


CLAIM_ORDER = ("definition", "rule", "method", "convention", "caution")


def lesson_content(book, les: Lesson, objectives: ObjectivesFile, claims: list[dict],
                   inputs: dict[str, Path]) -> dict:
    """One lesson's content file: S2's claims, where the lesson surfaces read lesson content.

    The shape is the one the Social and Arabic content files already have (lesson-content.ts);
    only `claims`, `language` and `provenance` are new, and the app's reader ignores what it does
    not know. `subtopics` is one entry per objective, whose exposition is that objective's
    claims in the book's order — the book's own statements, joined, nothing written."""
    by_lo: dict[str, list[dict]] = defaultdict(list)
    for c in claims:
        by_lo[c["lo"]].append(c)
    subtopics = []
    for o in objectives.objectives:
        mine = sorted(by_lo.get(o.id, []), key=lambda c: CLAIM_ORDER.index(c["claim_type"])
                      if c["claim_type"] in CLAIM_ORDER else len(CLAIM_ORDER))
        text = " ".join(c["claim"] for c in mine if c["claim_type"] != "caution")
        if text:
            subtopics.append({"key": o.id, "title": o.label, "exposition": text})
    return {
        "lessonId": les.slug, "title": les.title, "language": book.language, "direction": book.direction,
        "provenance": {"sections": [s.model_dump() for s in les.sections],
                       "part": les.part.model_dump() if les.part else None,
                       "chapter_intro": les.chapter_intro},
        "subtopics": subtopics, "key_terms": [], "enrichment": [], "misconceptions": [],
        "interactives": [], "passages": [], "out_of_scope": [], "qadaya": [],
        "claims": [{k: c[k] for k in ("lo", "claim_type", "claim", "anchor", "evidence_page", "evidence_kind")}
                   | ({"provenance": c["provenance"]} if c.get("provenance") else {}) for c in claims],
        "source": {"book": book.book, "assembled_by": f"{EXTRACTOR} {EXTRACTOR_VERSION}",
                   "assembled_from": {k: sha256_file(p) for k, p in sorted(inputs.items())}},
    }


MARKER_CHECK = HERE / "marker_check.mjs"


def marker_check(rows: list[dict]) -> dict:
    """Run the app's marker (marker_check.mjs) over [{id, choices}]. Raises AssemblyError when it
    cannot run: a bundle whose specs nobody checked is not assembled."""
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        raise AssemblyError("the marker check needs node (it runs the app's own answer-marker.ts); "
                            "install it, or pass --no-marker-check and say why")
    r = subprocess.run([node, "--no-warnings", str(MARKER_CHECK), "-"], input="".join(
        json.dumps(x, ensure_ascii=False) + "\n" for x in rows), capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise AssemblyError(f"the marker check could not run: {r.stderr.strip()[-400:]}")
    return json.loads(r.stdout)


def apply_marker_check(bundles: dict[str, dict], report: Report) -> None:
    rows = [{"id": q["id"], "choices": q.get("choices")} for b in bundles.values() for q in b["questions"]
            if isinstance(q.get("choices"), dict) and "marker" in q["choices"]]
    if not rows:
        return
    res = marker_check(rows)
    if res["specs_rejected"]:
        raise AssemblyError("the app's marker rejects these specs: " + "; ".join(
            f"{x['id']}: {x['why']}" for x in res["specs_rejected"][:6]))
    held = {x["id"]: x for x in res["keys_unreadable"]}
    for b in bundles.values():
        for q in b["questions"]:
            if q["id"] in held:
                q["verified"] = False
                report.held_by_marker.append({"id": q["id"], "key": held[q["id"]]["key"],
                                              "why": held[q["id"]]["why"]})
    report.counts["marker_specs_checked"] = res["checked"]
    report.counts["marker_keys_held"] = len(held)


def validate_bundles(bundles: dict[str, dict], all_lessons: list[Lesson]) -> list[str]:
    """schemas.SeedBundle per bundle, then the book-level rules. Empty list = fine."""
    problems: list[str] = []
    for name, b in bundles.items():
        try:
            schemas.SeedBundle.model_validate_json(json.dumps(b))
        except ValidationError as exc:
            e = exc.errors()[0]
            problems.append(f"{name}: {e.get('msg')} at {'.'.join(map(str, e.get('loc', ())))}")
    problems += check_lessons(all_lessons)
    los_by_lesson: dict[str, list[str]] = defaultdict(list)
    book_edges: list[tuple[str, str]] = []
    for b in bundles.values():
        for n in b["nodes"]:
            if n["kind"] == "learning_objective":
                los_by_lesson[book_config.lesson_slug(n["id"])].append(n["id"])
        book_edges += [(e["src"], e["dst"]) for e in b["edges"] if e["type"] == "prerequisite_of"]
    derived = derived_part_edges(all_lessons, los_by_lesson)
    if cyc := find_cycle(book_edges + derived):
        problems.append("prerequisite cycle (book edges + derived part edges, FR-4317): "
                        + " -> ".join(cyc))
    return problems


def load_inputs(manifest_path: Path, objectives_dir: Path, runs_dir: Path,
                chapters: set[int] | None):
    manifest = json.loads(manifest_path.read_text())
    pairs = manifest_lessons(manifest)
    try:
        all_lessons = [book_lesson(m, l) for m, l in pairs]
    except ValidationError as exc:
        raise AssemblyError(f"manifest lesson provenance: {exc}") from exc
    wanted = [(m, l) for (m, _), l in zip(pairs, all_lessons)
              if chapters is None or m["chapter"] in chapters]
    if not wanted:
        raise AssemblyError(f"no lessons for chapter(s) {sorted(chapters or [])} in the manifest")
    objectives: dict[str, ObjectivesFile] = {}
    runs: dict[str, LessonRun] = {}
    inputs: dict[str, dict[str, Path]] = defaultdict(dict)
    for mod, les in wanted:
        op = objectives_dir / f"{les.slug}.json"
        rp = runs_dir / f"{les.slug}.json"
        for p in (op, rp):
            if not p.exists():
                raise AssemblyError(f"{les.slug}: missing {rel(p)}")
        try:
            objectives[les.slug] = ObjectivesFile.model_validate_json(op.read_text())
            runs[les.slug] = LessonRun.model_validate_json(rp.read_text())
        except ValidationError as exc:
            raise AssemblyError(f"{les.slug}: {exc}") from exc
        if (runs[les.slug].model_extra or {}).get("draft"):
            raise AssemblyError(f"{les.slug}: {rel(rp)} is a DRAFT for G2's page (lesson-runs --draft), "
                                "written before G2 ruled on its items; assemble from the G2-signed split")
        inputs[mod["id"]].update({f"objectives/{op.name}": op, f"runs/lesson/{rp.name}": rp})
    return manifest, all_lessons, wanted, objectives, runs, inputs


def assemble(book, manifest_path: Path, objectives_dir: Path, runs_dir: Path,
             chapters: set[int] | None = None, check_markers: bool = True) -> tuple[dict[str, dict], Report]:
    manifest, all_lessons, wanted, objectives, runs, inputs = load_inputs(
        manifest_path, objectives_dir, runs_dir, chapters)
    prefix = book.id_prefixes[0]
    report = Report()
    bundles: dict[str, dict] = {f"{prefix}-course.json": course_bundle(book, manifest)}
    by_mod: dict[str, list[Lesson]] = defaultdict(list)
    mods: dict[str, dict] = {}
    for mod, les in wanted:
        by_mod[mod["id"]].append(les)
        mods[mod["id"]] = mod
    for mid, lessons in by_mod.items():
        name = f"{mid.removeprefix('module:')}.json"
        try:
            bundles[name] = assemble_chapter(book, manifest, mods[mid], lessons, objectives, runs,
                                             report, inputs[mid] | {"manifest": manifest_path})
        except (ValidationError, ValueError) as exc:
            raise AssemblyError(f"{name}: {exc}") from exc
    if check_markers:
        apply_marker_check(bundles, report)
    else:
        report.marker_check = "SKIPPED (--no-marker-check)"
    report.counts["lessons"] = sum(len(v) for v in by_mod.values())
    report.counts["chapters"] = len(by_mod)
    los_by_lesson: dict[str, list[str]] = defaultdict(list)
    for b in bundles.values():
        for n in b["nodes"]:
            if n["kind"] == "learning_objective":
                los_by_lesson[book_config.lesson_slug(n["id"])].append(n["id"])
    report.derived_part_edges = len(derived_part_edges(all_lessons, los_by_lesson))
    # S2's claims, served per lesson from the lesson-content files (their home)
    claims_by_lesson: dict[str, list[dict]] = defaultdict(list)
    for b in bundles.values():
        for c in b.get("claims", []):
            claims_by_lesson[book_config.lesson_slug(c["lo"])].append(c)
    for mod, les in wanted:
        lesson_inputs = {k: v for k, v in inputs[mod["id"]].items() if k.endswith(f"/{les.slug}.json")}
        report.content[les.slug] = lesson_content(book, les, objectives[les.slug],
                                                  claims_by_lesson.get(les.slug, []), lesson_inputs)
    report.counts["content_files"] = len(report.content)
    # every lesson of the book is checked, not only the assembled chapters
    problems = validate_bundles(bundles, all_lessons)
    if problems:
        raise AssemblyError("validation failed:\n  " + "\n  ".join(problems))
    return bundles, report


def dump(bundle: dict) -> str:
    return json.dumps(bundle, ensure_ascii=False, indent=2) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--book", required=True, help="book name or path to its config JSON")
    ap.add_argument("--chapter", type=int, action="append", help="assemble only this chapter")
    ap.add_argument("--manifest", type=Path)
    ap.add_argument("--objectives", type=Path, help="default objectives/<book>/")
    ap.add_argument("--runs", type=Path, help="default runs/<book>/lesson/")
    ap.add_argument("--out", type=Path, help="default seed/<book>/")
    ap.add_argument("--content-out", type=Path,
                    help="where the lesson-content files go (default: the bundles' sibling content/, "
                         "which for seed/<book>/ is seed/content/)")
    ap.add_argument("--report", type=Path, help="write the assembly report JSON here too")
    ap.add_argument("--check", action="store_true", help="assemble and validate, write nothing")
    ap.add_argument("--no-marker-check", action="store_true",
                    help="do not run the app's marker over the typed answers (the report says so)")
    a = ap.parse_args(argv)

    book = book_config.load_book(a.book)
    manifest = a.manifest or (book.repo_path(book.manifest) if book.manifest else None)
    if manifest is None:
        print(f"ERROR: {book.book} has no manifest; pass --manifest", file=sys.stderr)
        return 2
    objectives = a.objectives or HERE / "objectives" / book.book
    runs = a.runs or HERE / "runs" / book.book / "lesson"
    out = a.out or HERE / "seed" / book.book
    try:
        bundles, report = assemble(book, manifest, objectives, runs,
                                   set(a.chapter) if a.chapter else None, not a.no_marker_check)
    except AssemblyError as exc:
        print(f"ASSEMBLY FAILED — nothing written\n  {exc}", file=sys.stderr)
        return 1
    rep = report.as_dict()
    c = rep["counts"]
    print(f"{book.book}: {c.get('chapters', 0)} chapter(s), {c.get('lessons', 0)} lesson(s), "
          f"{c.get('objectives', 0)} objective(s), {c.get('questions', 0)} book question(s), "
          f"{c.get('visuals', 0)} visual(s), {c.get('worked_example_entries', 0)} worked-example "
          f"entr(ies), {c.get('claims', 0)} claim(s)")
    print(f"  solution sources: {rep['by_solution_provenance']}")
    print(f"  answer types:     {rep['by_answer_type']}")
    print(f"  notation:         {rep['notation']['changes'] or 'nothing to normalise'} across "
          f"{rep['notation']['items_normalised']} item(s)")
    print(f"  derived part prerequisites (not written as edges): {rep['derived_part_edges']}")
    for x in rep["excluded"]:
        print(f"  not a question: {x['lesson']} {x['ref']} — {x['reason']}")
    print(f"  the app's marker: {rep['counts'].get('marker_specs_checked', 0)} spec(s) checked, "
          f"{len(rep['held_by_marker'])} question(s) HELD because it cannot mark their key"
          + ("" if rep["marker_check"] == "run" else f" — {rep['marker_check']}"))
    for x in rep["held_by_marker"][:12]:
        print(f"    held: {x['id']} key {x['key']!r} — {x['why']}")
    if a.report:
        a.report.parent.mkdir(parents=True, exist_ok=True)
        a.report.write_text(json.dumps(rep, indent=2, ensure_ascii=False) + "\n")
    if a.check:
        print("check: valid — nothing written")
        return 0
    out.mkdir(parents=True, exist_ok=True)
    for name, b in bundles.items():
        (out / name).write_text(dump(b))
    print(f"wrote {len(bundles)} bundle(s) to {rel(out)}: {', '.join(bundles)}")
    content_out = a.content_out or out.parent / "content"
    content_out.mkdir(parents=True, exist_ok=True)
    for slug, c in report.content.items():
        (content_out / f"{slug}.json").write_text(dump(c))
    print(f"wrote {len(report.content)} lesson-content file(s) to {rel(content_out)} "
          f"({sum(len(c['claims']) for c in report.content.values())} claim(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())

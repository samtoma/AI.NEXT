"""Per-book configuration for the extraction line (extraction-pipeline.md §3.1, build item B1).

    uv run book_config.py list                     # every configured book
    uv run book_config.py show <book>              # one config, with its paths resolved
    uv run book_config.py check                    # validate every config against the repo
    uv run book_config.py workflow-args <book> [--only a,b] [--with-manifest] [--extra k=v ...]
                                                   # the JSON a Workflow run takes as `args`

WHY. Before this file every workflow and several tools hard-coded the book they
worked on: an absolute path into the main checkout, a lesson table, a page
offset, a course id, a list of bundles in a particular order (G3). None of them
ran in a worktree, and none ran on a new book without editing. A book is now one
committed JSON file, `services/extraction/books/<book>.json`, and everything
reads it.

THE FORMAT (config_version 1). Every path is RELATIVE TO THE REPOSITORY ROOT, so
a config means the same thing in the main checkout, in a worktree and in the
loader container (which mounts the repo at /repo).

    book               the config's own name, equal to the file stem
    title              human title of the book
    course_id          the course node the book builds, ^course:[a-z0-9-]+$
    curriculum         the curriculum id (specs/003: `eg-national-en`, `us-american-en`, …)
    subject            the subject key the app's registry uses (math | social | arabic | …)
    grade              the grade string stamped on source_documents (prep-3, 10, …)
    language, direction   en|ar, ltr|rtl
    id_prefixes        the lesson-slug prefixes this book owns. A lesson slug is an LO id
                       minus `lo:` and its last `-<n>`; it must match
                       ^<prefix>[0-9][a-z0-9]*-[0-9]+$ for one of these prefixes, and no
                       other book's prefix may match it. (`id_prefix`, a single string, is
                       accepted as a shorthand.)
    load_order         position among books when everything is loaded at once
    sources            {pdf, epub, teacher_pdf}: the source files, gitignored (docs/Source/)
    page_offsets       offset regimes: [{label, pdf_from, pdf_to, pdf_minus_printed,
                       verified_at: [[printed, pdf], …], note}]. null = not recorded.
    objectives_mode    printed (copied from the book's objectives box) | derived (§3.4)
    sacred_content     true when the book carries Quran/hadith (the sacred gate applies)
    bundles            the SeedBundles that build the course, in LOAD ORDER. Order matters:
                       a bundle with neither source_document nor source_file inherits the
                       previous bundle's document.
    superseded_bundles {old: new}: a bundle kept for history that a later bundle replaces.
                       A course load never loads its content (see load_seed.py).
    content_files      lesson-content files the app reads at request time (seed/content/)
    manifest           the Stage-0 manifest, or null
    program            optional {id, label}: the curriculum's program node; the loader adds it
                       and `course part_of program` if the bundles do not (ADR-0024)
    generated          {misconceptions, questions: [...]} or null
    parity             the per-course drift constant parity_check.py compares against:
                       {modules, learning_objectives, prerequisite_edges, questions_total,
                        visuals, require_all_live}
    status             "loadable" (default: the bundles exist and define the course) or
                       "ingest" (the book is going through the line; no bundle is built yet).
                       `check` accepts an ingest book with no bundles; a load refuses it.
    maths_source       how the source carries its mathematics, when the line must do something
                       about it: "epub-images-md5" = equation PNGs named md5(LaTeX), transcribed
                       by S0b (decision 21). null = the text layer is usable as it is.
    lesson_unit        the lesson unit gate G0 approved (decisions.md B; spec §3.3), as data the
                       manifest build applies: {rule, gate, splits, promotions, merges, declined,
                       expected_lessons}. null = one numbered teaching section per lesson.
    answer_rules       how S3 reads this book's answers: {multiplication_dot, forms_from_stem:
                       [{match, form}], printed_not_in_asked_form: [{item, asked_form, printed,
                       note}]} (backlog 30/31). null = none.
    lesson_titles      {slug: printed title} for a book whose bundles carry no lesson titles; the
                       loader writes them to course_lessons.title. Every slug must be a lesson of
                       the book.

SOURCES IN A WORKTREE. The source PDFs are gitignored, so a linked worktree does
not have them. `resolve_source()` looks, in order, in $AINEXT_SOURCES_ROOT, this
checkout, and the main checkout of the same repository (found from the
worktree's `.git` file, without calling git). It only ever READS there.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

HERE = Path(__file__).resolve().parent            # services/extraction
REPO_ROOT = HERE.parents[1]
BOOKS_DIR = HERE / "books"

COURSE_RE = re.compile(r"^course:[a-z0-9-]+$")
CURRICULUM_RE = re.compile(r"^[a-z]{2}-[a-z0-9]+-[a-z]{2}$")
PREFIX_RE = re.compile(r"^[a-z][a-z0-9]{0,10}$")
BOOK_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")


class Sources(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pdf: Optional[str] = None
    epub: Optional[str] = None
    teacher_pdf: Optional[str] = None


class OffsetRegime(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    pdf_from: Optional[int] = None
    pdf_to: Optional[int] = None
    pdf_minus_printed: Optional[int] = None
    verified_at: list[tuple[int, int]] = Field(default_factory=list)
    note: Optional[str] = None

    @model_validator(mode="after")
    def anchors_agree(self) -> "OffsetRegime":
        # An anchor that disagrees with its own regime is exactly the silent
        # corruption the per-page map exists to prevent: a REAL but WRONG page.
        if self.pdf_minus_printed is not None:
            bad = [(p, d) for p, d in self.verified_at if d - p != self.pdf_minus_printed]
            if bad:
                raise ValueError(f"page regime '{self.label}': anchors {bad} disagree with "
                                 f"pdf - printed = {self.pdf_minus_printed}")
        return self


class Generated(BaseModel):
    model_config = ConfigDict(extra="forbid")
    misconceptions: Optional[str] = None
    questions: list[str] = Field(default_factory=list)
    note: Optional[str] = None


class Program(BaseModel):
    """The curriculum's graph node (ADR-0024): the course is `part_of` it."""
    model_config = ConfigDict(extra="forbid")
    id: str
    label: str

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not re.match(r"^program:[a-z0-9-]+$", v):
            raise ValueError(f"program id {v!r} must match ^program:[a-z0-9-]+$")
        return v


class Parity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    modules: int
    learning_objectives: int
    prerequisite_edges: int
    questions_total: int
    visuals: int
    require_all_live: bool = False
    note: Optional[str] = None

    def expected(self) -> dict[str, int]:
        return {"modules": self.modules, "learning_objectives": self.learning_objectives,
                "prerequisite_edges": self.prerequisite_edges,
                "questions_total": self.questions_total, "visuals": self.visuals}


SECTION_RE = re.compile(r"^[0-9]{1,2}\.[0-9]{1,2}$")


def _section(v: str) -> str:
    if not SECTION_RE.match(v):
        raise ValueError(f"section {v!r} must be a printed section number like 1.7")
    return v


class SplitPart(BaseModel):
    """One part of a split section, named by the book's own anchors (EPUB order)."""
    model_config = ConfigDict(extra="forbid")
    title: str
    subheadings: list[str] = Field(default_factory=list)       # section codes (EMA…) it starts at / covers
    worked_examples: list[int] = Field(default_factory=list)   # worked-example numbers (per chapter)
    exercise_sets: list[str] = Field(default_factory=list)     # exercise labels, "1-5"


class Split(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    section: str
    parts: list[SplitPart]
    # A set that closes the whole section and belongs to no one part: S1 maps its items (6-6).
    unassigned_exercise_sets: list[str] = Field(default_factory=list)
    note: Optional[str] = None

    @field_validator("section")
    @classmethod
    def section_number(cls, v: str) -> str:
        return _section(v)

    @model_validator(mode="after")
    def _parts(self) -> "Split":
        if len(self.parts) < 2:
            raise ValueError(f"split {self.id}: a split has at least two parts")
        for i, p in enumerate(self.parts[1:], 2):
            if not (p.subheadings or p.worked_examples or p.exercise_sets):
                raise ValueError(f"split {self.id} part {i}: names no anchor, so it has no start")
        return self


class Promotion(BaseModel):
    """A chapter introduction that teaches and carries practice becomes a lesson."""
    model_config = ConfigDict(extra="forbid")
    id: str
    section: str
    @field_validator("section")
    @classmethod
    def section_number(cls, v: str) -> str:
        return _section(v)


class Merge(BaseModel):
    """Sections with no worked example and no exercise merged into a neighbour.

    `slug_section` is the section whose number the lesson slug takes: the one that
    carries the practice (contracts/pipeline-handoff.md: g10m1s3-1 covers 1.2 and 1.3).
    """
    model_config = ConfigDict(extra="forbid")
    id: str
    sections: list[str]
    slug_section: str

    @model_validator(mode="after")
    def _m(self) -> "Merge":
        for s in self.sections:
            _section(s)
        if len(self.sections) < 2:
            raise ValueError(f"merge {self.id}: a merge covers at least two sections")
        if self.slug_section not in self.sections:
            raise ValueError(f"merge {self.id}: slug_section {self.slug_section} is not one of {self.sections}")
        return self


class Declined(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: str
    sections: list[str]
    note: Optional[str] = None


class Gate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    passed: str
    by: str
    record: str


class LessonUnit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rule: str
    gate: Optional[Gate] = None
    splits: list[Split] = Field(default_factory=list)
    promotions: list[Promotion] = Field(default_factory=list)
    merges: list[Merge] = Field(default_factory=list)
    declined: list[Declined] = Field(default_factory=list)
    expected_lessons: Optional[int] = None

    @model_validator(mode="after")
    def _unique(self) -> "LessonUnit":
        ids = [x.id for x in [*self.splits, *self.promotions, *self.merges, *self.declined]]
        if len(ids) != len(set(ids)):
            raise ValueError(f"lesson_unit: decision ids repeat: {ids}")
        touched: list[str] = [s.section for s in self.splits] + [p.section for p in self.promotions] + \
            [x for m in self.merges for x in m.sections]
        dup = sorted({s for s in touched if touched.count(s) > 1})
        if dup:
            raise ValueError(f"lesson_unit: sections {dup} are named by more than one applied decision")
        return self


ITEM_REF_RE = re.compile(r"^Ex\d{1,2}-\d{1,2}:\d{1,3}[a-z]{0,3}$")
ASKED_FORMS = ("factorised", "expanded", "simplest", "prime_factors", "decimal")


class FormRule(BaseModel):
    """S3: an item whose stem matches `match` (a case-insensitive regex) asks for `form`, and its
    marker spec carries that form check whatever the typing agent said (backlog 30/31)."""
    model_config = ConfigDict(extra="forbid")
    match: str
    form: Literal["factorised", "expanded", "simplest", "prime_factors", "decimal"]
    note: Optional[str] = None

    @field_validator("match")
    @classmethod
    def _regex(cls, v: str) -> str:
        re.compile(v)
        return v


class FormDefect(BaseModel):
    """A printed answer that is not in the form its question asks for. Never corrected silently
    (FR-4302): S3 holds the item and lists it for G2."""
    model_config = ConfigDict(extra="forbid")
    item: str
    asked_form: Literal["factorised", "expanded", "simplest", "prime_factors", "decimal"]
    printed: str
    note: str

    @field_validator("item")
    @classmethod
    def _item(cls, v: str) -> str:
        if not ITEM_REF_RE.match(v):
            raise ValueError(f"{v!r} is not an exercise item ref like Ex1-5:15 or Ex1-10:3h")
        return v


class AnswerRules(BaseModel):
    """How S3 must read this book's answers (lesson-args hands them to lesson.workflow.js)."""
    model_config = ConfigDict(extra="forbid")
    # the book prints multiplication as a raised dot ("2·3^x"): keys write \cdot, never a decimal point
    multiplication_dot: bool = False
    forms_from_stem: list[FormRule] = Field(default_factory=list)
    printed_not_in_asked_form: list[FormDefect] = Field(default_factory=list)
    source: Optional[str] = None


class Book(BaseModel):
    model_config = ConfigDict(extra="forbid")
    config_version: Literal[1] = 1
    book: str
    title: str
    course_id: str
    curriculum: str
    subject: str
    grade: str
    language: Literal["en", "ar"]
    direction: Literal["ltr", "rtl"]
    id_prefixes: list[str] = Field(default_factory=list)
    id_prefix: Optional[str] = None
    load_order: int = 100
    sources: Sources = Field(default_factory=Sources)
    page_offsets: list[OffsetRegime] = Field(default_factory=list)
    objectives_mode: Literal["printed", "derived"] = "printed"
    notation: Optional[dict] = None
    sacred_content: bool = False
    bundles: list[str] = Field(default_factory=list)
    superseded_bundles: dict[str, str] = Field(default_factory=dict)
    content_files: list[str] = Field(default_factory=list)
    manifest: Optional[str] = None
    generated: Optional[Generated] = None
    parity: Optional[Parity] = None
    # Optional: the loader makes sure this program node exists and the course is
    # `part_of` it. Unset for the Prep-3 books, whose bundles already carry it.
    program: Optional[Program] = None
    status: Literal["loadable", "ingest"] = "loadable"
    maths_source: Optional[Literal["epub-images-md5"]] = None
    lesson_unit: Optional[LessonUnit] = None
    answer_rules: Optional[AnswerRules] = None
    # printed lesson titles by lesson slug, for a book whose bundles do not carry them: the loader
    # writes them to course_lessons.title (migration 034). A bundle's own `lessons` still win.
    lesson_titles: dict[str, str] = Field(default_factory=dict)
    lesson_titles_note: Optional[str] = None
    # where this config was read from (not part of the file)
    path: Optional[Path] = Field(default=None, exclude=True)

    @field_validator("book")
    @classmethod
    def _book(cls, v: str) -> str:
        if not BOOK_RE.match(v):
            raise ValueError(f"book name {v!r} must match {BOOK_RE.pattern}")
        return v

    @field_validator("course_id")
    @classmethod
    def _course(cls, v: str) -> str:
        # Same rule refresh-content.sh and the app apply (module-order.ts:130).
        if not COURSE_RE.match(v):
            raise ValueError(f"course_id {v!r} must match {COURSE_RE.pattern}")
        return v

    @field_validator("curriculum")
    @classmethod
    def _curriculum(cls, v: str) -> str:
        if not CURRICULUM_RE.match(v):
            raise ValueError(f"curriculum {v!r} must look like <country>-<system>-<language>, "
                             "e.g. eg-national-en (specs/003 research D1)")
        return v

    @model_validator(mode="after")
    def _prefixes(self) -> "Book":
        prefixes = list(self.id_prefixes)
        if self.id_prefix:
            prefixes.append(self.id_prefix)
        if not prefixes:
            raise ValueError(f"{self.book}: id_prefixes is empty — every book owns at least one")
        for p in prefixes:
            if not PREFIX_RE.match(p):
                raise ValueError(f"{self.book}: id prefix {p!r} must match {PREFIX_RE.pattern}")
        self.id_prefixes = sorted(set(prefixes))
        self.id_prefix = None
        for old, new in self.superseded_bundles.items():
            if old in self.bundles:
                raise ValueError(f"{self.book}: {old} is superseded, so it cannot also be a bundle")
            if new not in self.bundles:
                raise ValueError(f"{self.book}: {old} is superseded by {new}, which is not a bundle")
        return self

    # ---- paths ------------------------------------------------------------
    def repo_path(self, rel: str) -> Path:
        return REPO_ROOT / rel

    def bundle_paths(self) -> list[Path]:
        return [self.repo_path(b) for b in self.bundles]

    def superseded_paths(self) -> dict[Path, Path]:
        return {self.repo_path(o): self.repo_path(n) for o, n in self.superseded_bundles.items()}

    def slug_re(self) -> re.Pattern:
        alt = "|".join(re.escape(p) for p in self.id_prefixes)
        return re.compile(rf"^(?:{alt})[0-9][a-z0-9]*-[0-9]+$")

    def owns_lo(self, lo_id: str) -> bool:
        return bool(self.slug_re().match(lesson_slug(lo_id)))

    def work_dir(self) -> Path:
        """Where the deterministic stages (S0a, S0b's recovery) write: gitignored scratch."""
        return HERE / "work" / self.book


def lesson_slug(lo_id: str) -> str:
    """The app's rule (app/src/lib/lesson-slug.ts slugOfLo): LO id minus `lo:` and its last part."""
    return re.sub(r"-[0-9]+$", "", lo_id.removeprefix("lo:"))


# ---------------------------------------------------------------- loading
def load_book(name_or_path: str | Path) -> Book:
    p = Path(name_or_path)
    if p.suffix != ".json":
        p = BOOKS_DIR / f"{name_or_path}.json"
    elif not p.is_absolute() and not p.exists():
        p = BOOKS_DIR / p.name
    if not p.exists():
        known = ", ".join(b.book for b in all_books()) or "none"
        raise SystemExit(f"no book config {p} (configured books: {known})")
    book = Book.model_validate_json(p.read_text())
    if book.book != p.stem:
        raise SystemExit(f"{p}: 'book' is {book.book!r} but the file is named {p.stem!r}")
    book.path = p
    return book


@lru_cache(maxsize=1)
def _all_books_cached(books_dir: str) -> tuple[Book, ...]:
    out = [load_book(p) for p in sorted(Path(books_dir).glob("*.json"))]
    return tuple(sorted(out, key=lambda b: (b.load_order, b.book)))


def all_books() -> list[Book]:
    return list(_all_books_cached(str(BOOKS_DIR)))


def book_for_course(course_id: str) -> Book | None:
    hits = [b for b in all_books() if b.course_id == course_id]
    if len(hits) > 1:
        raise SystemExit(f"{course_id} is claimed by more than one book config: "
                         f"{', '.join(b.book for b in hits)}")
    return hits[0] if hits else None


def course_subjects() -> dict[str, str]:
    """course id -> subject key, the map the loader stamps on course nodes (migration 007)."""
    return {b.course_id: b.subject for b in all_books()}


def bundle_order() -> list[Path]:
    """Every configured bundle, superseded ones included, in load order.

    A superseded bundle sits immediately before the bundle that replaces it:
    for an unscoped legacy `--all` it still has to register its source document
    first (social-skeleton declares the document social-t1 only names).
    """
    order: list[Path] = []
    for b in all_books():
        if b.status == "ingest":
            # its bundles are the line's PLANNED output, in load order; nothing loads them yet
            continue
        replaced_by = {n: o for o, n in b.superseded_paths().items()}
        for p in b.bundle_paths():
            if p in replaced_by and replaced_by[p] not in order:
                order.append(replaced_by[p])
            order.append(p)
    return order


def superseded_by() -> dict[Path, Path]:
    out: dict[Path, Path] = {}
    for b in all_books():
        out.update(b.superseded_paths())
    return out


# ---------------------------------------------------------------- sources
def main_checkout_root(repo_root: Path = REPO_ROOT) -> Path | None:
    """The main checkout of a linked worktree, or None when this IS the main checkout.

    A linked worktree's `.git` is a FILE: `gitdir: <main>/.git/worktrees/<name>`,
    and that directory's `commondir` points back at `<main>/.git`. Read without
    the git binary, which the loader image does not have.
    """
    dotgit = repo_root / ".git"
    if not dotgit.is_file():
        return None
    try:
        line = dotgit.read_text().strip()
        if not line.startswith("gitdir:"):
            return None
        gitdir = Path(line.split(":", 1)[1].strip())
        if not gitdir.is_absolute():
            gitdir = (repo_root / gitdir).resolve()
        common = gitdir
        cd = gitdir / "commondir"
        if cd.exists():
            common = Path(cd.read_text().strip())
            if not common.is_absolute():
                common = (gitdir / common).resolve()
        main = common.parent
        return main if main != repo_root and main.exists() else None
    except OSError:
        return None


def source_roots() -> list[Path]:
    roots: list[Path] = []
    env = os.environ.get("AINEXT_SOURCES_ROOT")
    if env:
        roots.append(Path(env).expanduser().resolve())
    roots.append(REPO_ROOT)
    main = main_checkout_root()
    if main:
        roots.append(main)
    return roots


def resolve_source(rel: str | None) -> Path | None:
    """The first existing copy of a repo-relative source file, or None."""
    if not rel:
        return None
    for root in source_roots():
        p = root / rel
        if p.exists():
            return p
    return None


# ---------------------------------------------------------------- workflow args
def workflow_args(book: Book, only: list[str] | None = None, with_manifest: bool = False,
                  extra: dict | None = None) -> dict:
    """What a Workflow script receives as `args`.

    Workflow scripts cannot read files, so the operating session resolves the
    config here and passes it in whole. Absolute paths appear ONLY in this
    runtime value — never in a committed script — and they point at whichever
    checkout the operator is standing in (a worktree included).
    """
    missing = []
    paths = {"repo_root": str(REPO_ROOT), "extraction_dir": str(HERE)}
    for key in ("pdf", "epub", "teacher_pdf"):
        rel = getattr(book.sources, key)
        found = resolve_source(rel)
        paths[key] = str(found) if found else None
        if rel and not found:
            missing.append(rel)
    out: dict = {"book": json.loads(book.model_dump_json(exclude={"path"})) | {"paths": paths}}
    if missing:
        out["book"]["paths"]["missing_sources"] = missing
    if only:
        out["only"] = only
    if with_manifest and book.manifest:
        out["manifest"] = json.loads(book.repo_path(book.manifest).read_text())
    if extra:
        out.update(extra)
    return out


# ---------------------------------------------------------------- checks
def _bundle_json(p: Path) -> dict:
    return json.loads(p.read_text())


def structural_bundles_for_course(course_id: str, paths: list[Path]) -> list[Path]:
    """Bundles defining at least one node under `course_id` (part_of down, then teaches)."""
    defines: dict[Path, set[str]] = {}
    children: dict[str, set[str]] = {}
    teaches: dict[str, set[str]] = {}
    for p in paths:
        d = _bundle_json(p)
        defines[p] = {n["id"] for n in d.get("nodes", [])}
        for e in d.get("edges", []):
            if e["type"] == "part_of":
                children.setdefault(e["dst"], set()).add(e["src"])
            elif e["type"] == "teaches":
                teaches.setdefault(e["src"], set()).add(e["dst"])
    subtree, frontier = {course_id}, [course_id]
    while frontier:
        nxt = []
        for nid in frontier:
            for child in children.get(nid, set()) | teaches.get(nid, set()):
                if child not in subtree:
                    subtree.add(child)
                    nxt.append(child)
        frontier = nxt
    return [p for p in paths if defines[p] & subtree]


def check_book(book: Book, others: list[Book], allow_ingest: bool = False) -> list[str]:
    """Problems with one config. Empty list = fine.

    A book with `status: "ingest"` is going through the line: its `bundles` and
    `content_files` are the PLANNED outputs, in load order (the course bundle first:
    every chapter bundle names the course node, so it must already be loaded), and
    they need not exist yet. By default an ingest book is itself a problem, because
    the default caller is a load (deploy/load-course.sh): there is nothing to load.
    `check_all` passes allow_ingest=True, so the repository's own config check stays
    green while a book is going through the line.
    """
    problems: list[str] = []
    planned = set(book.bundles) | set(book.content_files) if book.status == "ingest" else set()
    for rel in book.bundles + list(book.superseded_bundles) + book.content_files + (
            [book.manifest] if book.manifest else []):
        if rel not in planned and not book.repo_path(rel).exists():
            problems.append(f"{book.book}: {rel} does not exist")
    if book.generated:
        for rel in [book.generated.misconceptions, *book.generated.questions]:
            if rel and not book.repo_path(rel).exists():
                problems.append(f"{book.book}: generated file {rel} does not exist")
    if book.lesson_titles:
        for slug in book.lesson_titles:
            if not book.slug_re().match(slug):
                problems.append(f"{book.book}: lesson_titles names {slug!r}, which is not one of its lessons")
    if book.status == "ingest":
        course_first = f"{book.id_prefixes[0]}-course.json"
        if book.bundles and Path(book.bundles[0]).name != course_first:
            problems.append(f"{book.book}: the planned bundles start with {Path(book.bundles[0]).name}; "
                            f"{course_first} loads first (every chapter bundle names the course node)")
        if len(set(book.bundles)) != len(book.bundles):
            problems.append(f"{book.book}: a planned bundle is listed twice")
        if not allow_ingest:
            problems.append(f"{book.book}: status is 'ingest': its bundles are not built yet, so there "
                            "is nothing to load")
        for other in others:
            if other.book != book.book:
                shared = set(book.id_prefixes) & set(other.id_prefixes)
                if shared:
                    problems.append(f"{book.book}: id prefixes {sorted(shared)} are also {other.book}'s")
        return problems
    if problems:
        return problems

    los: set[str] = set()
    course_defined = False
    for p in book.bundle_paths():
        d = _bundle_json(p)
        for n in d.get("nodes", []):
            if n["kind"] == "learning_objective":
                los.add(n["id"])
            if n["id"] == book.course_id:
                course_defined = True
    if not course_defined:
        problems.append(f"{book.book}: no bundle defines {book.course_id}")
    slug_re = book.slug_re()
    for lo in sorted(los):
        if not slug_re.match(lesson_slug(lo)):
            problems.append(f"{book.book}: {lo} (slug {lesson_slug(lo)!r}) matches none of "
                            f"id_prefixes {book.id_prefixes}")
        for other in others:
            if other.book != book.book and other.owns_lo(lo):
                problems.append(f"{book.book}: {lo} is also matched by {other.book}'s id_prefixes "
                                f"{other.id_prefixes} — two books would claim one lesson")

    # The configured bundle list must equal what the bundles themselves say
    # belongs to the course: a bundle missing from the list is content a course
    # refresh never loads; an extra one is content it loads into the wrong course.
    universe = sorted({p for b in all_books() if b.status != "ingest" for p in b.bundle_paths()} |
                      set(book.bundle_paths()))
    structural = structural_bundles_for_course(book.course_id, universe)
    listed = book.bundle_paths()
    if set(structural) != set(listed):
        extra = sorted(str(p.relative_to(REPO_ROOT)) for p in set(structural) - set(listed))
        absent = sorted(str(p.relative_to(REPO_ROOT)) for p in set(listed) - set(structural))
        problems.append(f"{book.book}: bundles list disagrees with the graph — defines nodes "
                        f"under the course but not listed: {extra or '-'}; listed but defines "
                        f"nothing under it: {absent or '-'}")

    lesson_slugs = {lesson_slug(lo) for lo in los}
    for slug in sorted(set(book.lesson_titles) - lesson_slugs):
        problems.append(f"{book.book}: lesson_titles names {slug}, which no bundle teaches")

    if book.parity:
        got = expected_from_bundles(book)
        for k, want in book.parity.expected().items():
            if got[k] != want:
                problems.append(f"{book.book}: parity.{k} is {want} but the bundles hold {got[k]}")
    return problems


def expected_from_bundles(book: Book) -> dict[str, int]:
    """The parity constant as the committed bundles define it (same rules as parity_check)."""
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    qs: list[dict] = []
    vs: list[dict] = []
    for p in book.bundle_paths():
        d = _bundle_json(p)
        nodes.update({n["id"]: n for n in d.get("nodes", [])})
        edges += d.get("edges", [])
        qs += d.get("questions", [])
        vs += d.get("visuals", [])
    mods = {e["src"] for e in edges if e["type"] == "part_of" and e["dst"] == book.course_id
            and nodes.get(e["src"], {}).get("kind") == "module"}
    los = {e["dst"] for e in edges if e["type"] == "teaches" and e["src"] in mods}
    return {
        "modules": len(mods),
        "learning_objectives": len(los),
        "prerequisite_edges": len({(e["src"], e["dst"]) for e in edges
                                   if e["type"] == "prerequisite_of" and e["src"] in los}),
        "questions_total": len([q for q in qs if q["lo"] in los]),
        "visuals": len([v for v in vs if v["lo"] in los]),
    }


def check_all() -> list[str]:
    books = all_books()
    problems: list[str] = []
    seen_course: dict[str, str] = {}
    for b in books:
        if b.course_id in seen_course:
            problems.append(f"{b.book}: course {b.course_id} is also claimed by {seen_course[b.course_id]}")
        seen_course[b.course_id] = b.book
        problems += check_book(b, books, allow_ingest=True)
    claimed: dict[Path, str] = {}
    for b in books:
        for p in b.bundle_paths() + [Path(x) for x in b.superseded_paths()]:
            if p in claimed:
                problems.append(f"{p.relative_to(REPO_ROOT)} is listed by both {claimed[p]} and {b.book}")
            claimed[p] = b.book
    return problems


# ---------------------------------------------------------------- CLI
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    s = sub.add_parser("show")
    s.add_argument("book")
    sub.add_parser("check")
    w = sub.add_parser("workflow-args")
    w.add_argument("book")
    w.add_argument("--only", help="comma-separated lesson ids to run")
    w.add_argument("--with-manifest", action="store_true", help="inline the book's manifest")
    w.add_argument("--extra", action="append", default=[],
                   help="k=<json value> merged into the args object (repeatable)")
    a = ap.parse_args()

    if a.cmd == "list":
        for b in all_books():
            print(f"{b.book:<20} {b.course_id:<26} {b.subject:<8} {b.curriculum:<16} "
                  f"{len(b.bundles)} bundle(s)")
        return 0
    if a.cmd == "show":
        b = load_book(a.book)
        print(json.dumps(workflow_args(b)["book"], indent=2, ensure_ascii=False))
        return 0
    if a.cmd == "check":
        problems = check_all()
        for b in all_books():
            for key in ("pdf", "epub", "teacher_pdf"):
                rel = getattr(b.sources, key)
                if rel and not resolve_source(rel):
                    print(f"  note: {b.book}: source {rel} not found in {', '.join(map(str, source_roots()))} "
                          "(gitignored; needed only to extract or to hash)")
        if problems:
            print("BOOK CONFIG: RED")
            for p in problems:
                print(f"  x {p}")
            return 1
        print(f"BOOK CONFIG: GREEN — {len(all_books())} book(s): "
              f"{', '.join(b.book for b in all_books())}")
        return 0
    if a.cmd == "workflow-args":
        b = load_book(a.book)
        extra = {}
        for kv in a.extra:
            k, _, v = kv.partition("=")
            extra[k] = json.loads(v)
        print(json.dumps(workflow_args(b, a.only.split(",") if a.only else None,
                                       a.with_manifest, extra), ensure_ascii=False))
        # The meter is the other half of every run (G8, FR-4403): a Workflow
        # cannot write its own cost, so say how to record it, on stderr so the
        # JSON on stdout stays pipeable.
        print(f"after the run: save its result under services/extraction/runs/{b.book}/<stage>/, then\n"
              f"  uv run meter_run.py record --book {b.book} --stage <S#> --run <wf_id>",
              file=sys.stderr)
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())

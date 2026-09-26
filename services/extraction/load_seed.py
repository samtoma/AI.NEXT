"""Validate seed bundles and load them into Postgres with full provenance.

Usage:
  uv run load_seed.py seed/unit1.json seed/unit2.json ... [flags]
  uv run load_seed.py --all [flags]            # every configured bundle, in load order
  uv run load_seed.py seed/unit2.json --validate-only
  uv run load_seed.py --all --course course:prep3-social-ar            # add-only
  uv run load_seed.py --all --course course:prep3-social-ar --dry-run  # the honest preview

Flags:
  --validate-only  schema-validate only, no DB access at all (for extraction agents)
  --approve-all    force ALL questions live (PoC bulk; logged as such)
  --demo-student   seed the demo cast (Omar mid-journey + a cold-start student
                   with zero history + a strong student); full reloads only
  --seed-demo-students
                   top up the SAME demo cast on a database that already has
                   content: no truncate, no bundles, curriculum untouched.
                   Idempotent (matches on display_name) — the way to add the
                   cast without a destructive reload. Takes no other flags.
  --course <id>    scoped load of ONE course. Other courses are never touched, and
                   NO student row is ever deleted or rewritten (attempts, mastery,
                   understanding checks, explanation log, sessions, progress).
                   Three modes, ADD-ONLY BY DEFAULT:
      (default)    add-only: insert the nodes, edges, questions and visuals the
                   database does not have yet. Existing rows are left exactly as
                   they are, including their status and review stamps; where a
                   bundle differs from the database the difference is REPORTED
                   ("drift"), not applied. Re-running it changes nothing.
      --update     add-only, plus apply bundle edits to existing content rows
                   (labels, stems, solutions, visuals). Never touches a
                   question's status, review stamps, source or parent. REFUSES
                   to change what an attempted question asks or accepts (stem,
                   choices, answer key, type, objective): make it a new question
                   and retire the old one with --replace instead.
                   (--allow-attempted-edits overrides, loudly.)
      --replace    --update, plus prune what the bundles no longer contain:
                   unreferenced content is deleted; a book question students
                   attempted is RETIRED (kept, not served); an objective or node
                   that student data, the misconception catalogue, generated
                   questions or another course still references makes the whole
                   load REFUSE, saying what would be lost (FR-4210).
                   Generated (source='variant') questions, the misconception
                   catalogue and its explanations are never deleted by this
                   loader — they belong to load_generated_questions.py and
                   load_misconceptions.py.
  --if-absent      with --course: if the course node already exists, change
                   nothing and say so (FR-4208's "Load a course" contract).
  --all            every configured bundle (books/*.json), in load order.
                   Combined with --course, that course's bundles from its book
                   config — the one-argument way to load or refresh a course.
                   A bundle the config marks superseded is never loaded as
                   content by a course load; only its source document is
                   registered (social-skeleton -> social-t1).
  --dry-run        do the entire load against the real database inside a
                   transaction, print the before/after delta, then ROLL BACK.
                   The honest preview: same checks, same gate, no writes.
  --wipe-students  unscoped (full-truncate) mode only: required when the
                   database holds any student who is not the demo cast. Without
                   it a full reload REFUSES rather than delete real attempts.

Database: connection comes from $AINEXT_DB_DSN, else $DATABASE_URL, else the local
`dbname=ainext_poc`. The resolved target (user@host/db, never the password) is printed
before anything is written — read it before you answer "yes".

Source documents: each bundle defines its own `source_document`, names one via
`source_file` (file_path of a doc defined earlier in the batch or already in the
DB), or inherits the previous bundle's. Multiple documents per load are supported;
rows dedupe on sha256. Every row is stamped with ITS bundle's source sha.

Question status: verified=true -> live (reviewed_by='ai dual-check (pending Samuel)'),
else review — for questions this load INSERTS. A question already in the database
keeps the status it has (a human or ADR-0019 may have promoted it since), with one
exception that no mode overrides: a question the sacred gate holds is never left
live. WITHOUT --course, re-running truncates and reloads ALL content tables
(legacy single-course semantics — a loud warning fires if >1 course is in the DB,
and it refuses outright while real students exist, see --wipe-students).

Course lists come from the book configs (books/*.json, book_config.py), not from
constants in this file: the subject stamped on a course node, the bundles of a
course and their order, and which bundles are superseded.

Book provenance (T404, FR-4311): every lesson in the batch gets its row in
`course_lessons` (migration 034) — from the bundle's `lessons` where it carries
them (sections, "part n of m", chapter introduction), else one-section
provenance derived from the objectives (every National course). Same add /
--update / --replace rules as the content; a load whose bundles carry parts or
merges REFUSES if 034 is missing. Part prerequisites are derived by the app from
these rows and never written to graph_edges (FR-4317).

A marker-graded question (question_type 'short', FR-4320) stores its answer spec
as the `choices` object {"marker": {...}} (contracts/answer-marker.md); the spec
is part of what the question accepts, so --update refuses to change it once a
student has attempted the question.

A source file absent from this machine takes its sha256 from, in order: the
database (the same document already loaded), then the book's Stage-0 manifest,
which records it — so a first load on the production box, which has no PDF,
still stamps the book's real sha rather than an `unavailable:` one.

SACRED-CONTENT GATE (ADR-0006): --approve-all HARD-REFUSES any bundle carrying
quran/hadith content, and sacred rows load as 'review' whatever the flags say.
A passage's approval is bound to its text_sha256, so one changed harakah demotes
it and everything built on it. See sacred_gate() below.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
import os
import random
import re
import sys
from pathlib import Path

import book_config
from arabic_text import SEALED_SENSITIVITY_CLASSES
from schemas import ClaimStep, SeedBundle, SourceDocument

HERE = Path(__file__).resolve().parent

STUDENT_DATA_TABLES = ("attempts", "mastery", "understanding_checks", "explanation_log")

DEFAULT_DSN = "dbname=ainext_poc"


def db_dsn() -> str:
    """Where we write. Local dev needs no env; deployed runs set AINEXT_DB_DSN."""
    return os.environ.get("AINEXT_DB_DSN") or os.environ.get("DATABASE_URL") or DEFAULT_DSN


def describe_dsn(dsn: str) -> str:
    """Human-readable target WITHOUT the password (this string goes in CI logs)."""
    try:
        from psycopg.conninfo import conninfo_to_dict
        d = conninfo_to_dict(dsn)
    except Exception:
        return "(unparseable dsn)"
    host = d.get("host") or "local socket"
    port = f":{d['port']}" if d.get("port") else ""
    user = f"{d['user']}@" if d.get("user") else ""
    return f"{user}{host}{port}/{d.get('dbname', '?')}"


def canonical_solution_json(solution: list) -> str:
    """Serialize a Question.solution for the canonical_solution jsonb column.

    Math (list[str])       -> [{"step": n, "text_md": ...}]           (byte-compatible, unchanged)
    Social (list[ClaimStep]) -> [{"step": n, "claim_ar": ..., "evidence_page": ...,
                                  "evidence_kind": ..., "facts": [...]}]
    matching ClaimStep in app/src/lib/types.ts / fmtSteps in app/src/lib/lesson.ts.
    English (v2 line, T336) -> [{"step": n, "text_md": <claim>, "lang": "en", "evidence_page": ...,
                                  "evidence_kind": ..., "facts": [...], "claim_type"?, "anchor"?}]
    A claim written as `claim` (not `claim_ar`) is stored under `text_md`, the key every
    step reader already takes first (types.ts stepText, lesson.ts fmtSteps), so an English
    book's claim steps render without an app change. An Arabic step is written exactly as
    before, byte for byte.
    """
    if solution and isinstance(solution[0], ClaimStep):
        steps = []
        for i, s in enumerate(solution):
            facts = [f.model_dump() for f in (s.facts or [])]
            if s.claim_ar is not None:
                steps.append({"step": i + 1, "claim_ar": s.claim_ar, "evidence_page": s.evidence_page,
                              "evidence_kind": s.evidence_kind, "facts": facts})
                continue
            step = {"step": i + 1, "text_md": s.claim, "lang": s.language,
                    "evidence_page": s.evidence_page, "evidence_kind": s.evidence_kind,
                    "facts": facts}
            step.update({k: v for k, v in (("claim_type", s.claim_type), ("anchor", s.anchor)) if v})
            steps.append(step)
        return json.dumps(steps)
    return json.dumps([{"step": i + 1, "text_md": t} for i, t in enumerate(solution)])


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def doc_sha(doc: SourceDocument, repo_root: Path,
            known_by_path: dict[str, str] | None = None) -> str:
    """Content-address the source file; deterministic per-doc fallback if absent.

    PROVENANCE CONTINUITY: the ministry PDFs are gitignored (85 MB+), so on a
    deployed box the file is simply not there — and minting the `unavailable:`
    fallback would stamp freshly loaded content with a sha that disagrees with
    the sha the same book already has in that database, i.e. a second passport
    for one document. When the DB already knows a sha256 for this exact
    file_path, that sha IS the document's identity; reuse it.
    """
    f = repo_root / doc.file_path if doc.file_path else None
    if f is not None and f.exists():
        return sha256_of(f)
    # A linked worktree has no gitignored PDFs; the same file in the main
    # checkout (or $AINEXT_SOURCES_ROOT) is the same document. Read-only.
    if doc.file_path and repo_root == book_config.REPO_ROOT:
        found = book_config.resolve_source(doc.file_path)
        if found is not None:
            return sha256_of(found)
    if known_by_path and doc.file_path and doc.file_path in known_by_path:
        sha = known_by_path[doc.file_path]
        print(f"  {doc.file_path}: source file not present here — reusing the sha256 this "
              f"database already records for it ({sha[:12]}…)")
        return sha
    # A book with a Stage-0 manifest records its PDF's sha256 there (S0a hashes both
    # files). On the production box the PDF is absent and the course is new, so without
    # this the FIRST load would stamp an `unavailable:` sha — a passport the drift guard
    # (parity_check.py, FR-4207) can never match to the book.
    if doc.file_path and (sha := manifest_sha(doc.file_path)):
        print(f"  {doc.file_path}: source file not present here — using the sha256 its "
              f"book's manifest records ({sha[:12]}…)")
        return sha
    basis = f"{doc.title}|{doc.file_path or ''}"
    return "unavailable:" + hashlib.sha256(basis.encode()).hexdigest()[:32]


def manifest_sha(file_path: str) -> str | None:
    """The sha256 a book's Stage-0 manifest records for this source file, if any.

    The manifest (`book.sources.pdf|epub` = {path, sha256}) is committed; the PDF is not.
    """
    for book in book_config.all_books():
        if not book.manifest:
            continue
        mp = book.repo_path(book.manifest)
        if not mp.exists():
            continue
        try:
            srcs = json.loads(mp.read_text()).get("book", {}).get("sources", {})
        except (OSError, json.JSONDecodeError):
            continue
        for s in srcs.values():
            if isinstance(s, dict) and s.get("path") == file_path and s.get("sha256"):
                return s["sha256"]
    return None


def validate_all(paths: list[Path]) -> list[SeedBundle]:
    bundles = []
    for p in paths:
        b = SeedBundle.model_validate_json(p.read_text())
        n_ver = sum(q.verified for q in b.questions)
        extra = ""
        if b.text_passages:  # Arabic vertical (ADR-0006)
            n_sacred = sum(tp.is_sacred for tp in b.text_passages)
            extra = (f", {len(b.text_passages)} sealed passages "
                     f"({n_sacred} sacred, {sum(tp.approval_valid for tp in b.text_passages)} "
                     f"approved)")
        print(f"  {p.name}: {len(b.nodes)} nodes, {len(b.edges)} edges, "
              f"{len(b.questions)} questions ({n_ver} verified), {len(b.visuals)} visuals"
              f"{extra} — OK")
        bundles.append(b)
    return bundles


# ---------------------------------------------------------------------------
# Cross-course prerequisites (the 2026-09-26 isolation audit; spec 003 FR-4006)
#
# A prerequisite is a fact about ONE book's teaching order. An edge from an
# objective of one course to an objective of another — two curricula, or two
# grades — is a path the app's graph readers could walk from a course a student
# may see into one she may not. The app now gates each reader by the student's
# scope itself (retrieval's one hop, the skill map, the progression), so this
# is defence in depth, not the gate: the loader refuses such an edge unless it
# is named here, deliberately, in review. Empty: none is allowed today.
# ---------------------------------------------------------------------------

ALLOWED_CROSS_COURSE_PREREQUISITES: frozenset[tuple[str, str]] = frozenset()


def course_of_objectives(edges, known: dict[str, str] | None = None) -> dict[str, str]:
    """Objective id -> course id: objective <- module (`teaches`), then
    `part_of` upward until a `course:` node, through any number of levels.

    `edges` are (src, dst, type) triples; `known` adds courses already
    resolved elsewhere (the database, for a scoped load), and loses to the
    batch when both know an objective.
    """
    parent: dict[str, str] = {}
    module_of: dict[str, str] = {}
    for src, dst, typ in edges:
        if typ == "part_of":
            parent[src] = dst
        elif typ == "teaches":
            module_of.setdefault(dst, src)
    out = dict(known or {})
    for lo, node in module_of.items():
        for _ in range(16):
            if node is None or node.startswith("course:"):
                break
            node = parent.get(node)
        if node is not None and node.startswith("course:"):
            out[lo] = node
    return out


def cross_course_prerequisites(edges, known: dict[str, str] | None = None,
                               allowed=ALLOWED_CROSS_COURSE_PREREQUISITES) -> list[str]:
    """Every `prerequisite_of` edge whose two ends resolve to DIFFERENT
    courses and that `allowed` does not name, as readable lines. An end whose
    course cannot be resolved is not reported here: that is not a crossing it
    can prove (the external-reference check owns missing nodes)."""
    edges = list(edges)
    course = course_of_objectives(edges, known)
    bad = []
    for src, dst, typ in edges:
        if typ != "prerequisite_of" or (src, dst) in allowed:
            continue
        a, b = course.get(src), course.get(dst)
        if a and b and a != b:
            bad.append(f"{src} ({a}) -> {dst} ({b})")
    return sorted(set(bad))


def refuse_cross_course_prerequisites(edges, known: dict[str, str] | None = None) -> None:
    """Stop the load (or the validation) on a cross-course prerequisite."""
    bad = cross_course_prerequisites(edges, known)
    if bad:
        raise SystemExit(
            f"REFUSING: {len(bad)} prerequisite edge(s) join objectives of two different courses — "
            "a prerequisite is one book's teaching order, and a student who may see one course must "
            "not be walked into another (spec 003 FR-4006). If one is truly intended, name it in "
            "ALLOWED_CROSS_COURSE_PREREQUISITES in load_seed.py, in review:\n  "
            + "\n  ".join(bad[:20]) + (" ..." if len(bad) > 20 else ""))


def db_courses_of(cur, lo_ids: list[str]) -> dict[str, str]:
    """The course of each of `lo_ids` already in the database (open edges)."""
    if not lo_ids:
        return {}
    cur.execute(
        """WITH RECURSIVE up(lo, node) AS (
               SELECT te.dst_id, te.src_id FROM graph_edges te
                WHERE te.edge_type = 'teaches' AND te.system_to IS NULL AND te.dst_id = ANY(%s)
               UNION
               SELECT u.lo, e.dst_id FROM up u
                 JOIN graph_edges e ON e.src_id = u.node AND e.edge_type = 'part_of'
                                   AND e.system_to IS NULL
           )
           SELECT u.lo, min(n.id) FROM up u
             JOIN graph_nodes n ON n.id = u.node AND n.kind = 'course'
            GROUP BY u.lo""", (lo_ids,))
    return {lo: c for lo, c in cur.fetchall()}


def sacred_gate(paths: list[Path], bundles: list[SeedBundle], approve_all: bool) -> set[str]:
    """The promotion gate for sacred and sealed content (ADR-0006).

    Returns the ids of questions that are held at status='review' no matter what
    the flags say. Three rules, none of which has an override:

    1. `--approve-all` HARD-REFUSES a bundle carrying quran/hadith content.
       `--approve-all` is how the math PoC loaded 29 questions; one habitual
       command must not be able to promote unreviewed scripture to a student
       (sensitive-content S2). It keeps working for everything else.
    2. Sacred rows load as 'review' even with verified=true. Promotion needs two
       NAMED human signatures, which is an ops process this loader cannot
       observe — so it cannot be the thing that grants them.
    3. CHECKSUM BINDING: a human approves an exact byte sequence, not "this
       passage". If text_sha256 no longer equals approved_sha256, the approval
       is void and everything built on that passage is demoted — no flag, no
       exception (verification §5.1).
    """
    held: set[str] = set()
    refusals: list[str] = []
    for p, b in zip(paths, bundles):
        by_id = {tp.id: tp for tp in b.text_passages}
        sacred = [tp for tp in b.text_passages if tp.is_sacred]
        stale = [tp for tp in b.text_passages if tp.approval_stale]
        flagged = [tp for tp in b.text_passages if tp.verification_flagged]
        n_sacred_q = n_unapproved_q = 0
        for q in b.questions:
            src = by_id.get(q.passage_ref or "")
            if q.sensitivity_class in SEALED_SENSITIVITY_CLASSES or (src and src.is_sacred):
                held.add(q.id)
                n_sacred_q += 1
            elif src is not None and not src.approval_valid:
                held.add(q.id)          # nobody signed the text it rests on
                n_unapproved_q += 1

        # A flagged cross-check is a real disagreement between published
        # editions, waiting for a human. It never blocks the run — the rest of
        # the bundle loads and the flagged passage simply stays out of 'live'.
        if flagged:
            print(f"  {p.name}: {len(flagged)} passage(s) FLAGGED by verification — "
                  "held for a human, load continues")
            for tp in flagged:
                reason = tp.verification.flag_reason if tp.verification else "?"
                disagreeing = [s.name for s in (tp.verification.sources if tp.verification else [])
                               if not s.agrees]
                print(f"      {tp.id} ({tp.attribution_ar}): {reason}"
                      + (f" [disagreeing: {', '.join(disagreeing)}]" if disagreeing else ""))
        if stale:
            print("!" * 72)
            print(f"!! {p.name}: {len(stale)} sealed passage(s) CHANGED since approval — "
                  "auto-demoted")
            for tp in stale:
                print(f"!!   {tp.id}: approved {tp.approved_sha256[:12]}… by "
                      f"{tp.approved_by or '?'}, now {tp.text_sha256[:12]}…")
            print("!! A human approved bytes that no longer exist. Re-approve, do not override.")
            print("!" * 72)
        if approve_all and (sacred or n_sacred_q):
            refusals.append(
                f"  {p.name}: {len(sacred)} sacred passage(s)"
                + (f" [{', '.join(tp.id for tp in sacred[:4])}]" if sacred else "")
                + f", {n_sacred_q} question(s) derived from them")
        if n_sacred_q or n_unapproved_q:
            print(f"  {p.name}: sacred gate holds {n_sacred_q} question(s) at review"
                  + (f" (+{n_unapproved_q} on unapproved passages)" if n_unapproved_q else ""))

    if refusals:
        raise SystemExit(
            "REFUSING --approve-all: this batch contains sacred content.\n"
            + "\n".join(refusals)
            + "\n\nQuran- and Hadith-derived content is never bulk-approved. It reaches a "
              "student only after two named human sign-offs:\n"
              "  1. verbatim verification — the printed page beside the transcript and the "
              "independent authorities it was cross-checked against\n"
              "  2. pedagogical/boundary review of the شرح, the questions and the class\n"
              "Re-run without --approve-all (everything else still loads; sacred rows land as "
              "'review'), or split the sacred passages into their own bundle.")
    return held


# graph_nodes.subject on course rows (migration 007): the app's subject
# registry (app/src/lib/subjects.ts) is the authority on this mapping; the
# loader is the one writer for NEW courses ("carry their subject from the
# loader, not from a parser" — 007 §2). A course with no book config loads
# with subject NULL and renders as UNFILED, never as maths.
#
# Read from books/*.json (B1) rather than restated here, so a new book is one
# config file and not an edit to this loader.
COURSE_SUBJECTS = book_config.course_subjects()


def correct_answer_text(q) -> str:
    """questions.correct_answer stays a text column; typed Arabic answers are
    stored in it as tagged JSON, never flattened to a surface string.

    (The original loader REFUSED typed answers because "the slot grader does
    not exist yet" — it now does: app/src/lib/irab.ts grades IrabAnswer slots,
    39/39. The runtime parses this JSON by question_type; a surface-string
    flattening would have failed every student who phrased the formula
    differently, which is why it was never an option.)
    """
    if isinstance(q.answer, str):
        return q.answer
    return json.dumps({"type": q.type} | q.answer.model_dump(exclude_none=True),
                      ensure_ascii=False)


def resolve_source_docs(
    paths: list[Path], bundles: list[SeedBundle],
    repo_root: Path, db_docs_by_path: dict[str, str],
    reuse_db_rows: bool = True,
) -> list[tuple[str, SourceDocument | None]]:
    """Per bundle: (source sha, doc-to-insert or None if it already exists in DB).

    `db_docs_by_path` maps file_path -> sha256 of documents already in the DB. It
    serves two purposes: resolving a bundle's `source_file` against a document
    nobody in this batch declares (scoped loads only — `reuse_db_rows`), and
    keeping a document's sha stable where the source file itself is absent
    (see doc_sha). A full-truncate load must NOT skip the insert on the strength
    of a DB row it is about to wipe, hence the flag.
    """
    resolved: list[tuple[str, SourceDocument | None]] = []
    batch_by_path: dict[str, tuple[str, SourceDocument]] = {}
    # Legacy compatibility: bundles BEFORE the first declaring bundle inherit the
    # batch's first declared document (old loader stamped everything with it).
    current: tuple[str, SourceDocument | None] | None = next(
        ((doc_sha(b.source_document, repo_root, db_docs_by_path), b.source_document)
         for b in bundles if b.source_document), None)
    for p, b in zip(paths, bundles):
        if b.source_document:
            d = b.source_document
            sha = doc_sha(d, repo_root, db_docs_by_path)
            if d.file_path:
                batch_by_path[d.file_path] = (sha, d)
            current = (sha, d)
        elif b.source_file:
            if b.source_file in batch_by_path:
                current = batch_by_path[b.source_file]
            elif reuse_db_rows and b.source_file in db_docs_by_path:
                current = (db_docs_by_path[b.source_file], None)
            else:
                raise SystemExit(
                    f"{p.name}: source_file '{b.source_file}' matches no source_document "
                    "in this batch or in the database")
        elif current is None:
            raise SystemExit(
                f"{p.name}: no source_document/source_file and no earlier bundle to inherit from")
        resolved.append(current)
    return resolved


# --all load order and supersession, from the book configs (B1).
#
# Order is NOT alphabetical and never was: a bundle with neither
# `source_document` nor `source_file` INHERITS the previous bundle's document
# (see resolve_source_docs), so the document-declaring bundle of each book must
# come first. Each config's `bundles` list is in load order; books follow their
# `load_order`.
#
# Supersession: `social-t1.json` redefines the skeleton's nodes, but its 762
# questions carry different ids from the skeleton's 44, so loading both ADDS
# the superseded questions back instead of replacing them. The deployed
# database holds 762 social questions, i.e. social-t1 alone. A course load
# therefore never loads a superseded bundle's CONTENT — only its source
# document, which social-t1 names by `source_file` without defining.
BUNDLE_ORDER = [p.name for p in book_config.bundle_order()]
SUPERSEDED_BY = {o.name: n.name for o, n in book_config.superseded_by().items()}


def _is_bundle(p: Path) -> bool:
    return '"extraction_run"' in p.read_text()


def all_bundle_paths() -> list[Path]:
    """Every configured bundle in load order, then any unconfigured seed/*.json bundle.

    seed/ also holds non-bundle artefacts (social-skeleton-traps.json is a QA
    containment set: `_meta` + `traps`; misconceptions-math.json is a catalogue).
    Globbing them fed a non-bundle to Pydantic and killed `--all` before it
    reached the DB. Mirrors the filter in selfcheck_arabic.check_shipped_bundles.
    """
    ordered = [p for p in book_config.bundle_order() if p.exists()]
    missing = [p for p in book_config.bundle_order() if not p.exists()]
    if missing:
        raise SystemExit("--all: book configs list bundles that do not exist: "
                         + ", ".join(str(p.relative_to(book_config.REPO_ROOT)) for p in missing))
    seed = HERE / "seed"
    found = sorted(seed.glob("*.json"))
    skipped = [p.name for p in found if p not in ordered and not _is_bundle(p)]
    if skipped:
        print(f"--all: skipped {len(skipped)} non-bundle file(s): {', '.join(skipped)}")
    # a bundle in seed/ that no book config lists: load it last, but say so
    # loudly rather than dropping it silently
    for p in found:
        if p not in ordered and _is_bundle(p):
            print(f"--all: WARNING {p.name} is in no book config (books/*.json) — appending "
                  "last; add it to its book's `bundles` if it declares or inherits a document")
            ordered.append(p)
    return ordered


def warn_superseded(paths: list[Path]) -> None:
    """Unscoped `--all` keeps its legacy meaning: every bundle. Say what that costs."""
    names = {p.name for p in paths}
    for old, new in SUPERSEDED_BY.items():
        if old in names and new in names:
            print(f"--all: WARNING loading {old} AND its replacement {new}. Their question ids "
                  f"differ, so the superseded ones are ADDED, not replaced. "
                  f"`--all --course <id>` excludes superseded bundles; unscoped `--all` "
                  f"keeps its legacy 'every bundle' meaning.")


def bundles_for_course(course_id: str, paths: list[Path] | None = None) -> list[Path]:
    """The bundles that build `course_id`, in load order — from its book config.

    The config's list is cross-checked against the bundles themselves (walk
    `part_of` down from the course, add what it `teaches`, keep every bundle that
    defines a node in that subtree). A disagreement means a bundle would be left
    out of the course's load or loaded into the wrong course, so it refuses
    rather than guess. A course with no book config falls back to the structural
    walk, with a warning.
    """
    paths = paths if paths is not None else all_bundle_paths()
    superseded = set(book_config.superseded_by())
    content = [p for p in paths if p not in superseded]
    structural = book_config.structural_bundles_for_course(course_id, content)
    book = book_config.book_for_course(course_id)
    if book is None:
        if not structural:
            courses = sorted({n["id"] for p in paths for n in json.loads(p.read_text()).get("nodes", [])
                              if n["id"].startswith("course:")})
            raise SystemExit(
                f"--all --course {course_id}: no book config names this course and no bundle "
                f"defines any node under it. Courses seen: {', '.join(courses) or 'none'}.")
        print(f"--all --course {course_id}: WARNING no book config (books/*.json) names this "
              f"course — using the {len(structural)} bundle(s) that define nodes under it")
        selected = structural
    else:
        if book.status == "ingest":
            raise SystemExit(
                f"--all --course {course_id}: books/{book.book}.json has status 'ingest' — the book is "
                "still going through the extraction line and its bundles are not approved (gate G5). "
                "Load the assembled bundles by path into a scratch database instead, or set the status "
                "to 'loadable' once G5 has said go.")
        selected = book.bundle_paths()
        if set(selected) != set(structural):
            raise SystemExit(
                f"--all --course {course_id}: books/{book.book}.json lists "
                f"{sorted(p.name for p in selected)} but the bundles that define nodes under the "
                f"course are {sorted(p.name for p in structural)}. Fix the config "
                f"(uv run book_config.py check).")
        for old, new in book.superseded_paths().items():
            print(f"  {old.name}: superseded by {new.name} — its content is not loaded "
                  f"(its source document is still registered)")
    print(f"--all --course {course_id}: {len(selected)} bundle(s) — "
          f"{', '.join(p.name for p in selected)}")
    return selected


def superseded_doc_bundles(course_id: str | None, paths: list[Path]) -> list[Path]:
    """Superseded bundles to take a SOURCE DOCUMENT from, never content.

    `social-t1.json` names its book with `source_file` and the skeleton it
    supersedes is what defines that document. Loading the skeleton first used to
    be a separate command (local-dev.sh, ci-cd.yml); a course load now registers
    the document itself, and a superseded bundle passed explicitly is reduced to
    exactly that.
    """
    if not course_id:
        return []
    book = book_config.book_for_course(course_id)
    if book is None:
        return []
    out = []
    for old in book.superseded_paths():
        if old in paths:
            continue
        if json.loads(old.read_text()).get("source_document"):
            out.append(old)
    return out


def course_subtree(cur, course_id: str) -> set[str]:
    """Course node + part_of descendants + LOs they teach + course-exclusive topics."""
    cur.execute(
        """WITH RECURSIVE sub(id) AS (
               SELECT %s::text
               UNION
               SELECT e.src_id FROM graph_edges e JOIN sub s ON e.dst_id = s.id
                WHERE e.edge_type = 'part_of'
           ) SELECT id FROM sub""", (course_id,))
    subtree = {r[0] for r in cur.fetchall()}
    cur.execute("SELECT dst_id FROM graph_edges WHERE edge_type='teaches' AND src_id = ANY(%s)",
                (list(subtree),))
    subtree |= {r[0] for r in cur.fetchall()}
    # topics referenced (via 'about') ONLY from inside this subtree belong to it
    cur.execute(
        """SELECT dst_id FROM graph_edges WHERE edge_type='about'
           GROUP BY dst_id HAVING bool_and(src_id = ANY(%s))""", (list(subtree),))
    subtree |= {r[0] for r in cur.fetchall()}
    return subtree


def course_ancestors(cur, course_id: str) -> set[str]:
    """The course's `part_of` ancestors (program roots) — shared, not owned.

    `unit1.json` declares `program:bakaloreya-track` as well as its course, and
    the social bundles hang off the same program. The root therefore sits OUTSIDE
    the course subtree while legitimately appearing in the course's own bundles;
    without this, every scoped math refresh dies on the id-collision guard.
    Re-declaring it is harmless: node inserts are ON CONFLICT DO NOTHING, so the
    existing row (and its provenance) is left exactly as it was.
    """
    cur.execute(
        """WITH RECURSIVE up(id) AS (
               SELECT %s::text
               UNION
               SELECT e.dst_id FROM graph_edges e JOIN up u ON e.src_id = u.id
                WHERE e.edge_type = 'part_of'
           ) SELECT id FROM up WHERE id <> %s""", (course_id, course_id))
    return {r[0] for r in cur.fetchall()}


# ---------------------------------------------------------------------------
# Scoped reload (B9, G9). One course, compared row by row with the database.
#
# THE OLD PATH deleted the course's subtree and re-inserted it. That deleted
# every attempt, mastery row and explanation log entry on the course's
# questions (printed as a "PoC-only" warning), silently took the course's
# generated and widget questions with it (they share its objectives), and once
# the misconception catalogue was loaded it could not run at all: the node
# DELETE hits misconceptions.lo_id and explanation_library.lo_id, neither of
# which cascades (migration 009). It also demoted every promoted question back
# to 'review' and wiped the misconception stamps load_misconceptions.py writes
# onto book choices.
#
# NOW a course load compares, and only adds unless told otherwise:
#   add (default)  insert what is missing; report what differs ("drift")
#   update         also apply edits to existing content rows
#   replace        also prune what the bundles dropped — student-safe
# Student rows are never deleted or rewritten in any mode, and the rows this
# loader does not own (generated questions, the catalogue, its explanations)
# are never deleted by it.
# ---------------------------------------------------------------------------

MODES = ("add", "update", "replace")

NODE_FIELDS = ("label", "description", "syllabus_ref", "order_in_parent", "source_page")
VISUAL_FIELDS = ("lo_id", "question_id", "kind", "spec", "caption", "source_page")
# What makes a question the item a student answered. Change one of these on an
# attempted question and every past `is_correct` stops meaning what it meant —
# the BKT/IRT fit would learn from answers to a question nobody was asked.
MATERIAL_QUESTION_FIELDS = ("lo_id", "question_type", "stem", "choices", "correct_answer")
OTHER_QUESTION_FIELDS = ("tier", "canonical_solution", "source_page", "source_note")


class LoadReport:
    """Per row class: added / updated / unchanged / drift / retired / pruned."""

    def __init__(self) -> None:
        self.counts: dict[str, Counter] = defaultdict(Counter)
        self.samples: dict[tuple[str, str], list[str]] = defaultdict(list)

    def note(self, table: str, kind: str, ident: str | None = None, n: int = 1) -> None:
        self.counts[table][kind] += n
        if ident is not None and len(self.samples[(table, kind)]) < 6:
            self.samples[(table, kind)].append(ident)

    def total(self, kind: str) -> int:
        return sum(c[kind] for c in self.counts.values())

    def print(self, mode: str) -> None:
        print(f"\nload plan ({mode}):")
        order = ("added", "updated", "unchanged", "drift", "retired", "pruned")
        for table in ("source_documents", "nodes", "edges", "questions", "visuals", LESSONS_TABLE,
                      "misconceptions", "explanation_entries"):
            c = self.counts.get(table)
            if not c:
                continue
            parts = [f"{k} {c[k]}" for k in order if c[k]]
            print(f"  {table:<20} " + (", ".join(parts) or "nothing"))
            for k in ("drift", "updated", "retired", "pruned"):
                if self.samples.get((table, k)):
                    more = c[k] - len(self.samples[(table, k)])
                    print(f"      {k}: {', '.join(self.samples[(table, k)])}"
                          + (f" … +{more}" if more > 0 else ""))
        if self.total("drift"):
            print(f"\n  {self.total('drift')} existing row(s) differ from the bundles and were "
                  f"LEFT AS THEY ARE (add-only). Re-run with --update to apply the edits.")


def _choice_pairs(choices) -> list[tuple] | dict | None:
    """The item-defining part of a choice list: (key, text). Misconception stamps
    are the catalogue's annotation, not part of the question. A `choices` OBJECT —
    the expression marker's {"marker": {...}} (contracts/answer-marker.md) — is
    item-defining as a whole: its key IS what the question accepts."""
    if not choices:
        return None
    if isinstance(choices, dict):
        if isinstance(choices.get("options"), list):       # McqChoices: stamps live on its options
            return dict(choices, options=[(c.get("key"), c.get("text")) for c in choices["options"]])
        return choices
    return [(c.get("key"), c.get("text")) for c in choices]


def bundle_choices_json(q) -> list | dict | None:
    """A bundle question's `choices` in the shape of the jsonb column."""
    if not q.choices:
        return None
    if isinstance(q.choices, list):
        return [c.model_dump() for c in q.choices]
    # MarkerChoices {"marker": {...}[, "answer_only": true]} or McqChoices {"options", "less_specific"};
    # an absent answer_only is left out, so every marker question already loaded keeps its exact JSON
    out = q.choices.model_dump(mode="json")
    if out.get("answer_only") is None:
        out.pop("answer_only", None)
    return out


def merged_choices(bundle_choices: list[dict] | dict | None,
                   db_choices: list | dict | None) -> list | dict | None:
    """Bundle choices, carrying over the misconception stamps the database holds.

    load_misconceptions.py stamps `misconception_id` onto book choices IN THE
    DATABASE, matched by exact text; the bundle never has them. Overwriting
    `choices` with the bundle's would silently strip every diagnosis until the
    next catalogue load. Matching by text is the catalogue's own contract.
    A marker spec carries no stamps: it is written as the bundle has it.
    """
    if not bundle_choices:
        return None
    if isinstance(bundle_choices, dict):
        if isinstance(bundle_choices.get("options"), list):     # McqChoices: its options carry stamps
            db_opts = db_choices.get("options") if isinstance(db_choices, dict) else db_choices
            return dict(bundle_choices, options=merged_choices(bundle_choices["options"], db_opts))
        return bundle_choices
    if not isinstance(db_choices, list):
        db_choices = []
    stamps = {c.get("text"): c["misconception_id"]
              for c in (db_choices or []) if c.get("misconception_id")}
    return [dict(c, misconception_id=stamps[c["text"]]) if c["text"] in stamps else dict(c)
            for c in bundle_choices]


def question_row(q) -> dict:
    """A bundle question in the shape of its `questions` row."""
    return {
        "lo_id": q.lo, "tier": q.tier, "question_type": q.type, "stem": q.stem,
        "choices": bundle_choices_json(q),
        "correct_answer": correct_answer_text(q),
        "canonical_solution": json.loads(canonical_solution_json(q.solution)),
        "source_page": q.source_page, "source_note": q.source_note,
    }


def question_diff(new: dict, old: dict) -> tuple[list[str], list[str]]:
    """(material fields that differ, other fields that differ)."""
    material = []
    for f in MATERIAL_QUESTION_FIELDS:
        a, b = new[f], old[f]
        if f == "choices":
            a, b = _choice_pairs(a), _choice_pairs(b)
        if a != b:
            material.append(f)
    other = [f for f in OTHER_QUESTION_FIELDS if new[f] != old[f]]
    return material, other


class Prune:
    """What --replace would remove, and what stops it."""

    def __init__(self) -> None:
        self.delete_questions: list[str] = []
        self.retire_questions: dict[str, str] = {}
        self.delete_visuals: list[str] = []
        self.delete_edges: list[int] = []
        self.delete_bridges: list[tuple[str, str]] = []
        self.delete_nodes: list[str] = []
        self.blockers: dict[str, list[str]] = defaultdict(list)


def plan_prune(cur, course: str, subtree: set[str], shared: set[str], batch_nodes: set[str],
               batch_edges: set[tuple[str, str, str]], batch_qids: set[str],
               batch_vids: set[str]) -> Prune:
    """Work out --replace's removals WITHOUT touching anything.

    Rules (FR-4210: keep every student's progress, or refuse saying what would
    be lost):
      * a book question the bundles dropped is DELETED if nothing refers to it,
        RETIRED (kept, status='retired', never served) if a student attempted
        it, an explanation was logged against it, or a generated question names
        it as its parent;
      * a node the bundles dropped is DELETED only if nothing still refers to it.
        Mastery, comprehension checks, uploads, sessions, lesson progress, the
        misconception catalogue, its explanations, any remaining question and
        any edge from another course each BLOCK the whole load.
    Generated questions are never pruned here: they are not in seed bundles.
    """
    p = Prune()
    sub = list(subtree)
    stale_nodes = subtree - batch_nodes - shared - {course}

    cur.execute(
        """SELECT q.id,
                  (SELECT count(*) FROM attempts a WHERE a.question_id = q.id),
                  (SELECT count(*) FROM explanation_log x WHERE x.question_id = q.id),
                  (SELECT count(*) FROM questions c WHERE c.parent_question_id = q.id)
             FROM questions q
            WHERE q.lo_id = ANY(%s) AND q.source IN ('seed', 'authored')
              AND NOT (q.id = ANY(%s))""", (sub, list(batch_qids)))
    for qid, n_att, n_log, n_child in cur.fetchall():
        why = [f"{n} {w}" for n, w in ((n_att, "attempt(s)"), (n_log, "logged explanation(s)"),
                                        (n_child, "generated child question(s)")) if n]
        if why:
            p.retire_questions[qid] = ", ".join(why)
        else:
            p.delete_questions.append(qid)

    cur.execute(
        """SELECT id FROM visuals
            WHERE (lo_id = ANY(%s) AND NOT (id = ANY(%s))) OR question_id = ANY(%s)""",
        (sub, list(batch_vids), p.delete_questions or ["__none__"]))
    p.delete_visuals = sorted({r[0] for r in cur.fetchall()})

    cur.execute(
        """SELECT id, src_id, dst_id, edge_type FROM graph_edges
            WHERE (src_id = ANY(%s) OR dst_id = ANY(%s)) AND edge_type <> 'relates_to'""",
        (sub, list(stale_nodes) or ["__none__"]))
    for eid, src, dst, et in cur.fetchall():
        if src in subtree and (src, dst, et) not in batch_edges:
            p.delete_edges.append(eid)
        elif src not in subtree and dst in stale_nodes:
            p.blockers[dst].append(f"{et} edge from {src} (another course)")

    if stale_nodes:
        stale = list(stale_nodes)
        cur.execute(
            """SELECT src_id, dst_id FROM graph_edges
                WHERE edge_type = 'relates_to' AND (src_id = ANY(%s) OR dst_id = ANY(%s))""",
            (stale, stale))
        p.delete_bridges = cur.fetchall()
        kept_q = set(p.retire_questions)
        checks = (
            ("mastery row(s)", "SELECT lo_id, count(*) FROM mastery WHERE lo_id = ANY(%s) GROUP BY 1"),
            ("comprehension check(s)",
             "SELECT lo_id, count(*) FROM understanding_checks WHERE lo_id = ANY(%s) GROUP BY 1"),
            ("upload(s)", "SELECT linked_lo_id, count(*) FROM uploads WHERE linked_lo_id = ANY(%s) GROUP BY 1"),
            ("session(s)", "SELECT lo_id, count(*) FROM sessions WHERE lo_id = ANY(%s) GROUP BY 1"),
            ("misconception(s) in the catalogue",
             "SELECT lo_id, count(*) FROM misconceptions WHERE lo_id = ANY(%s) GROUP BY 1"),
            ("explanation library entr(ies)",
             "SELECT lo_id, count(*) FROM explanation_library WHERE lo_id = ANY(%s) GROUP BY 1"),
        )
        for what, sql in checks:
            cur.execute(sql, (stale,))
            for node, n in cur.fetchall():
                p.blockers[node].append(f"{n} {what}")
        cur.execute(
            """SELECT lo_id, id, source FROM questions
                WHERE lo_id = ANY(%s) AND NOT (id = ANY(%s))""",
            (stale, p.delete_questions or ["__none__"]))
        remaining: dict[str, Counter] = defaultdict(Counter)
        for node, qid, source in cur.fetchall():
            remaining[node]["generated question(s)" if source == "variant"
                            else "question(s) students used, which would be retired" if qid in kept_q
                            else "question(s)"] += 1
        for node, c in remaining.items():
            p.blockers[node] += [f"{n} {what}" for what, n in sorted(c.items())]
        # Lesson progress is keyed by slug, not by node: a lesson disappears when
        # the last of its objectives does.
        stale_slugs = {book_config.lesson_slug(n) for n in stale if n.startswith("lo:")}
        live_slugs = {book_config.lesson_slug(n) for n in batch_nodes if n.startswith("lo:")}
        gone = sorted(stale_slugs - live_slugs)
        if gone:
            cur.execute(
                """SELECT lesson_slug, count(*) FROM student_progress
                    WHERE course_id = %s AND lesson_slug = ANY(%s) GROUP BY 1""", (course, gone))
            for slug, n in cur.fetchall():
                p.blockers[f"lesson {slug}"].append(f"{n} student(s) currently on it")
        p.delete_nodes = sorted(n for n in stale_nodes if n not in p.blockers)
    return p


def apply_prune(cur, p: Prune, report: LoadReport) -> None:
    if p.delete_visuals:
        cur.execute("DELETE FROM visuals WHERE id = ANY(%s)", (p.delete_visuals,))
        for v in p.delete_visuals:
            report.note("visuals", "pruned", v)
    for qid, why in sorted(p.retire_questions.items()):
        cur.execute("UPDATE questions SET status = 'retired' WHERE id = %s AND status <> 'retired'",
                    (qid,))
        report.note("questions", "retired", f"{qid} ({why})")
    if p.delete_questions:
        cur.execute("DELETE FROM questions WHERE id = ANY(%s)", (p.delete_questions,))
        for q in p.delete_questions:
            report.note("questions", "pruned", q)
    if p.delete_edges:
        cur.execute("DELETE FROM graph_edges WHERE id = ANY(%s)", (p.delete_edges,))
        report.note("edges", "pruned", n=len(p.delete_edges))
    if p.delete_nodes:
        for src, dst in p.delete_bridges:
            print(f"  WARNING: cross-subject bridge {src} ↔ {dst} removed with its node — "
                  f"re-curate it in db/bridges.sql if it should survive")
        cur.execute("DELETE FROM graph_edges WHERE src_id = ANY(%s) OR dst_id = ANY(%s)",
                    (p.delete_nodes, p.delete_nodes))
        cur.execute("DELETE FROM graph_nodes WHERE id = ANY(%s)", (p.delete_nodes,))
        for n in p.delete_nodes:
            report.note("nodes", "pruned", n)


# ---------------------------------------------------------------------------
# Book provenance of every lesson -> course_lessons (migration 034; T404, FR-4311)
#
# A bundle that carries `lessons` (the v2 line) says, per lesson, which printed
# section(s) it covers, "part n of m" and whether it is a promoted chapter
# introduction. Every other lesson — each National course today — gets ONE-SECTION
# provenance derived from what its bundles already hold: the printed lesson number
# from the objectives' syllabus_ref ("Lesson 4-1" -> "4-1"; the slug's digits
# otherwise), and a title: the book config's printed `lesson_titles` first (Prep-3
# maths' short titles, which lived only in the app's registry, and the Arabic book's
# real printed lesson names, Samuel's answer 13), else the syllabus_ref ("ara1-1 ·
# <title>"), else the lesson's first objective's label, which is what the app shows
# for a lesson with no printed title. Such a lesson has no part, so migration 034's rule makes it its own
# unit whatever its group_key: two National lessons printed with the same number in
# different terms (u4-1 and geo1-1 are both "Lesson 4-1") are never grouped.
#
# Part n-1 -> part n prerequisites are NOT written anywhere: the app derives them from
# these rows at read time (FR-4317), so graph_edges stays exactly the book's.
# ---------------------------------------------------------------------------

LESSONS_TABLE = "course_lessons"
LESSON_FIELDS = ("title", "sections", "section_titles", "part_n", "part_of", "chapter_intro",
                 "group_key")


def lessons_table_present(cur) -> bool:
    cur.execute("SELECT to_regclass(%s) IS NOT NULL", (f"public.{LESSONS_TABLE}",))
    return cur.fetchone()[0]


def _national_number(slug: str, syllabus_ref: str | None) -> str:
    m = re.search(r"Lesson\s+([0-9][0-9A-Za-z.\-]*)", syllabus_ref or "")
    return m.group(1) if m else re.sub(r"^[a-z]+", "", slug)


def _national_title(node) -> str:
    ref = node.syllabus_ref or ""
    if " · " in ref and ref.split(" · ", 1)[1].strip():
        return ref.split(" · ", 1)[1].strip()
    return node.label


def lesson_rows(content: list[tuple[Path, SeedBundle]], course: str | None
                ) -> dict[tuple[str, str], dict]:
    """(course_id, slug) -> the course_lessons row, for every lesson in the batch."""
    module_course: dict[str, str] = {}
    lo_module: dict[str, str] = {}
    first_lo: dict[str, object] = {}
    kinds = {n.id: n.kind for _, b in content for n in b.nodes}
    for _, b in content:
        for e in b.edges:
            if e.type == "part_of" and kinds.get(e.src) == "module":
                module_course[e.src] = e.dst
            elif e.type == "teaches":
                lo_module[e.dst] = e.src
        for n in b.nodes:
            if n.kind == "learning_objective":
                slug = book_config.lesson_slug(n.id)
                prev = first_lo.get(slug)
                if prev is None or int(n.id.rsplit("-", 1)[1]) < int(prev.id.rsplit("-", 1)[1]):
                    first_lo[slug] = n

    def course_of(slug: str, module: str | None = None) -> str | None:
        mod = module or (lo_module.get(first_lo[slug].id) if slug in first_lo else None)
        return course or module_course.get(mod or "")

    rows: dict[tuple[str, str], dict] = {}
    for _, b in content:
        for l in b.lessons:
            c = course_of(l.slug, l.module)
            if c is None:
                raise SystemExit(f"lesson {l.slug}: cannot tell which course it belongs to")
            rows[(c, l.slug)] = {
                "title": l.title, "sections": [s.number for s in l.sections],
                "section_titles": [s.title for s in l.sections],
                "part_n": l.part.n if l.part else None, "part_of": l.part.of if l.part else None,
                "chapter_intro": l.chapter_intro, "group_key": l.group_key}
    carried = {slug for _, slug in rows}
    printed = {(b.course_id, slug): t for b in book_config.all_books() for slug, t in b.lesson_titles.items()}
    for slug, node in first_lo.items():
        if slug in carried:
            continue
        c = course_of(slug)
        if c is None:
            print(f"  WARNING: lesson {slug}: no course in this batch — no provenance row written")
            continue
        number = _national_number(slug, node.syllabus_ref)
        title = printed.get((c, slug)) or _national_title(node)
        rows[(c, slug)] = {"title": title, "sections": [number], "section_titles": [title],
                           "part_n": None, "part_of": None, "chapter_intro": False,
                           "group_key": number}
    return rows


def write_lessons(cur, rows: dict[tuple[str, str], dict], editing: bool,
                  report: LoadReport) -> None:
    """Insert missing rows; report (add) or apply (update/replace) differing ones."""
    if not rows:
        return
    if not lessons_table_present(cur):
        grouped = sorted(slug for (_, slug), r in rows.items()
                         if r["part_n"] or len(r["sections"]) > 1 or r["chapter_intro"])
        if grouped:
            raise SystemExit(
                f"REFUSING: these bundles carry book provenance the database cannot hold — "
                f"{len(grouped)} lesson(s) are parts, merges or chapter introductions "
                f"({', '.join(grouped[:6])}{' …' if len(grouped) > 6 else ''}), and "
                f"{LESSONS_TABLE} (migration 034) does not exist here. Without it a split "
                f"section's parts are not kept together and part n-1 is not a prerequisite of "
                f"part n (FR-4311…FR-4317). Apply migration 034 first. Nothing was changed.")
        print(f"  note: {LESSONS_TABLE} (migration 034) is absent — {len(rows)} one-section "
              "lesson row(s) not written; nothing these lessons show depends on them")
        return
    keys = list(rows)
    cur.execute(
        f"""SELECT course_id, lesson_slug, {', '.join(LESSON_FIELDS)} FROM {LESSONS_TABLE}
             WHERE (course_id, lesson_slug) IN (SELECT * FROM unnest(%s::text[], %s::text[]))""",
        ([c for c, _ in keys], [s for _, s in keys]))
    have = {(r[0], r[1]): dict(zip(LESSON_FIELDS, r[2:])) for r in cur.fetchall()}
    for key in sorted(rows):
        new, old = rows[key], have.get(key)
        ident = f"{key[0]} {key[1]}"
        if old is None:
            cur.execute(
                f"""INSERT INTO {LESSONS_TABLE} (course_id, lesson_slug, {', '.join(LESSON_FIELDS)})
                    VALUES (%s, %s, {', '.join(['%s'] * len(LESSON_FIELDS))})""",
                (*key, *(new[f] for f in LESSON_FIELDS)))
            report.note(LESSONS_TABLE, "added", key[1])
            continue
        changed = [f for f in LESSON_FIELDS if new[f] != old[f]]
        if not changed:
            report.note(LESSONS_TABLE, "unchanged")
        elif not editing:
            report.note(LESSONS_TABLE, "drift", f"{ident} ({', '.join(changed)})")
        else:
            cur.execute(
                f"""UPDATE {LESSONS_TABLE} SET {', '.join(f'{f} = %s' for f in LESSON_FIELDS)}
                     WHERE course_id = %s AND lesson_slug = %s""",
                (*(new[f] for f in LESSON_FIELDS), *key))
            report.note(LESSONS_TABLE, "updated", f"{ident} ({', '.join(changed)})")


def prune_lessons(cur, course: str, rows: dict[tuple[str, str], dict], report: LoadReport) -> None:
    """--replace: a lesson the bundles no longer contain loses its provenance row.

    Runs only after plan_prune found no blocker, so no student is on the lesson
    (student_progress is one of plan_prune's blockers)."""
    if not lessons_table_present(cur):
        return
    keep = [slug for (c, slug) in rows if c == course]
    cur.execute(f"DELETE FROM {LESSONS_TABLE} WHERE course_id = %s AND NOT (lesson_slug = ANY(%s)) "
                "RETURNING lesson_slug", (course, keep))
    for (slug,) in cur.fetchall():
        report.note(LESSONS_TABLE, "pruned", slug)


def student_rows_outside_demo(cur) -> dict[str, int]:
    """Student data a full truncate would destroy, not counting the demo cast."""
    cur.execute("SELECT id FROM students WHERE NOT (display_name = ANY(%s) OR display_name LIKE %s)",
                ([OMAR, COLD_START, STRONG], "%(demo)"))
    real = [r[0] for r in cur.fetchall()]
    if not real:
        return {}
    out = {"students": len(real)}
    for t in ("attempts", "mastery"):
        cur.execute(f"SELECT count(*) FROM {t} WHERE student_id = ANY(%s)", (real,))
        out[t] = cur.fetchone()[0]
    return out


SNAPSHOT_SQL = """
SELECT (SELECT count(*) FROM graph_nodes),
       (SELECT count(*) FROM graph_edges),
       (SELECT count(*) FROM graph_edges WHERE edge_type='relates_to'),
       (SELECT count(*) FROM questions),
       (SELECT count(*) FROM questions WHERE status='live'),
       (SELECT count(*) FROM questions WHERE status='review'),
       (SELECT count(*) FROM visuals),
       (SELECT count(*) FROM source_documents),
       (SELECT count(*) FROM attempts),
       (SELECT count(*) FROM mastery)
"""
SNAPSHOT_LABELS = ("nodes", "edges", "bridges", "questions", "LIVE questions",
                   "review questions", "visuals", "source documents",
                   "student attempts", "mastery rows")


def print_delta(before: tuple, after: tuple) -> None:
    """What this load actually changed — the line a human reads before saying yes."""
    print("\nwhat changed:")
    for label, b, a in zip(SNAPSHOT_LABELS, before, after):
        mark = "" if a == b else f"   {a - b:+d}"
        print(f"  {label:<18} {b:>6} -> {a:>6}{mark}")
    if after[4] < before[4]:
        print(f"\n  !! {before[4] - after[4]} question(s) LEFT the live set. Only the sacred gate "
              f"(a held question is never live) or --replace\n     (a dropped question is retired) "
              f"does that. It IS a visible content change: restore the pre-load backup if it was "
              f"not what you wanted.")


def load(paths: list[Path], approve_all: bool, demo_student: bool,
         course: str | None = None, dry_run: bool = False, mode: str = "add",
         if_absent: bool = False, wipe_students: bool = False,
         allow_attempted_edits: bool = False) -> None:
    import psycopg

    if mode not in MODES:
        raise SystemExit(f"unknown load mode {mode!r}")
    # A superseded bundle named on a COURSE load contributes its source document
    # and nothing else; its replacement carries the content.
    superseded = set(book_config.superseded_by())
    doc_only = {p for p in paths if course and p.resolve() in superseded}
    for p in doc_only:
        print(f"  {p.name}: superseded by {book_config.superseded_by()[p.resolve()].name} — "
              f"registering its source document only, no content")
    bundles = validate_all(paths)
    content = [(p, b) for p, b in zip(paths, bundles) if p not in doc_only]
    held = sacred_gate([p for p, _ in content], [b for _, b in content], approve_all)
    repo_root = HERE.parents[1]

    dsn = db_dsn()
    print(f"target database: {describe_dsn(dsn)}"
          + ("" if dsn == DEFAULT_DSN else "   [from environment]")
          + (f"   mode: {mode}" if course else "   mode: FULL TRUNCATE")
          + ("   *** DRY RUN — the transaction will be rolled back ***" if dry_run else ""))
    report = LoadReport()
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(SNAPSHOT_SQL)
        before = cur.fetchone()

        if course and if_absent:
            cur.execute("SELECT 1 FROM graph_nodes WHERE id = %s", (course,))
            if cur.fetchone():
                print(f"--if-absent: {course} is already loaded — nothing changed.")
                conn.rollback()
                return

        # --- resolve source documents. Known shas are read for BOTH modes (they keep
        #     a document's identity stable where its file is absent — see doc_sha),
        #     but only a scoped load may skip an insert on the strength of a DB row:
        #     full-truncate mode is about to wipe source_documents.
        cur.execute("SELECT file_path, sha256 FROM source_documents")
        db_docs_by_path = {fp: sha for fp, sha in cur.fetchall() if fp}
        resolved = resolve_source_docs(paths, bundles, repo_root, db_docs_by_path,
                                       reuse_db_rows=bool(course))

        batch_nodes = {n.id for _, b in content for n in b.nodes}
        batch_qids = {q.id for _, b in content for q in b.questions}
        batch_vids = {v.id for _, b in content for v in b.visuals}
        batch_edges = {(e.src, e.dst, e.type) for _, b in content for e in b.edges}
        # The book config's program (ADR-0024): the course hangs off its
        # curriculum's program node. Counted as part of the batch so --replace
        # never prunes the edge, and so a reload finds it present.
        book = book_config.book_for_course(course) if course else None
        program = book.program if book else None
        if program:
            batch_edges.add((course, program.id, "part_of"))
        subtree: set[str] = set()
        shared: set[str] = set()

        if course and not content:
            # Only superseded bundles were named: register their documents, which
            # is all the old two-pass social load (local-dev.sh, ci-cd.yml) needed
            # the skeleton for. No course content moves.
            for sha, doc in resolved:
                if doc is None:
                    continue
                cur.execute(
                    """INSERT INTO source_documents
                       (sha256, title, publisher, edition, language, grade, subject, file_path)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (sha256) DO NOTHING""",
                    (sha, doc.title, doc.publisher, doc.edition, doc.language,
                     doc.grade, doc.subject, doc.file_path))
                print(f"  source document {doc.file_path}: "
                      f"{'registered' if cur.rowcount else 'already registered'}")
            if dry_run:
                conn.rollback()
                print("DRY RUN: rolled back.")
            return

        # --- pre-flight checks + scope preparation (all before any write)
        if course:
            cur.execute("SELECT id FROM graph_nodes")
            db_ids = {r[0] for r in cur.fetchall()}
            present = course in db_ids
            subtree = course_subtree(cur, course) if present else set()
            if course not in batch_nodes and not present:
                raise SystemExit(f"--course {course}: node not defined in bundles nor in DB")
            if mode == "replace" and course not in batch_nodes:
                raise SystemExit(f"--replace {course}: the bundles must define the course node, "
                                 f"or everything under it would count as dropped")
            # id-namespace hygiene: a bundle may not redefine another course's rows.
            # Shared ancestors (the program root every course hangs off) are exempt —
            # see course_ancestors.
            shared = course_ancestors(cur, course) if present else set()
            # On a FIRST load the course is not in the database yet, so its
            # ancestors cannot be read from it. Take them from the batch: a
            # program another course already hangs off is shared, not a collision.
            up = {course}
            while True:
                nxt = {d for (s_, d, t) in batch_edges if t == "part_of" and s_ in up} - up
                if not nxt:
                    break
                up |= nxt
            shared |= (up - {course}) & db_ids
            collisions = sorted(batch_nodes & (db_ids - subtree - shared))
            if collisions:
                raise SystemExit(
                    f"node id collision with content OUTSIDE course {course}: "
                    f"{', '.join(collisions[:10])}{' ...' if len(collisions) > 10 else ''}")
            if redeclared := sorted(batch_nodes & shared):
                print(f"  shared ancestor(s) re-declared by these bundles: "
                      f"{', '.join(redeclared)} — kept as-is (ON CONFLICT DO NOTHING)")
            owned = subtree | batch_nodes
            for table, ids in (("questions", batch_qids), ("visuals", batch_vids)):
                cur.execute(f"SELECT id, lo_id FROM {table} WHERE id = ANY(%s)", (list(ids),))
                foreign = sorted(i for i, lo in cur.fetchall() if lo not in owned)
                if foreign:
                    raise SystemExit(
                        f"{table} id collision with content OUTSIDE course {course}: "
                        f"{', '.join(foreign[:10])}{' ...' if len(foreign) > 10 else ''}")
            resolvable = db_ids | batch_nodes
        else:
            cur.execute("SELECT id FROM graph_nodes WHERE kind='course'")
            db_courses = [r[0] for r in cur.fetchall()]
            real = student_rows_outside_demo(cur)
            if real and not wipe_students:
                raise SystemExit(
                    "REFUSING a full-truncate load: this database holds real student data ("
                    + ", ".join(f"{n} {t}" for t, n in real.items())
                    + "). A full load TRUNCATEs students, attempts and mastery. Load one course "
                      "with --course <id> (it never deletes student rows), or pass "
                      "--wipe-students if destroying them is really what you mean.")
            if len(db_courses) > 1:
                print("!" * 72)
                print(f"!! FULL-TRUNCATE MODE with {len(db_courses)} courses in DB: "
                      f"{', '.join(db_courses)}")
                print("!! This WIPES ALL of them. Use --course <course-node-id> to load")
                print("!! a single course without touching the others.")
                print("!" * 72)
            resolvable = batch_nodes

        # external refs must resolve against ANY bundle in the batch or live DB rows
        # (batch is order-independent: nodes all land before any edge, see below)
        for p, b in content:
            missing = [r for r in b.external_node_refs if r not in resolvable]
            if missing:
                raise SystemExit(f"{p.name}: external_node_refs not found in batch or DB: "
                                 f"{', '.join(missing)}")

        # a prerequisite never joins two courses (see ALLOWED_CROSS_COURSE_PREREQUISITES).
        # A scoped load also resolves ends it references in the database; a full
        # load is about to truncate it, so only the batch counts.
        prereq_ends = sorted({x for s_, d, t in batch_edges if t == "prerequisite_of" for x in (s_, d)})
        refuse_cross_course_prerequisites(
            batch_edges, db_courses_of(cur, prereq_ends) if course else None)

        # --- writes (single transaction: any failure rolls everything back)
        if not course:
            cur.execute("TRUNCATE understanding_checks, ai_interactions, explanation_log, "
                        "attempts, mastery, sessions, students, visuals, questions, "
                        "graph_edges, graph_nodes, extraction_runs, source_documents"
                        + (f", {LESSONS_TABLE}" if lessons_table_present(cur) else "")
                        + " RESTART IDENTITY CASCADE")

        inserted_shas: set[str] = set()
        for (sha, doc) in resolved:
            if doc is None or sha in inserted_shas:
                continue
            cur.execute(
                """INSERT INTO source_documents
                   (sha256, title, publisher, edition, language, grade, subject, file_path)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (sha256) DO NOTHING""",
                (sha, doc.title, doc.publisher, doc.edition, doc.language,
                 doc.grade, doc.subject, doc.file_path))
            report.note("source_documents", "added" if cur.rowcount else "unchanged")
            inserted_shas.add(sha)

        # --- what the database already holds for this batch
        cur.execute(
            f"SELECT id, kind, {', '.join(NODE_FIELDS)}, subject FROM graph_nodes WHERE id = ANY(%s)",
            (list(batch_nodes),))
        db_nodes = {r[0]: dict(zip(("kind", *NODE_FIELDS, "subject"), r[1:])) for r in cur.fetchall()}
        # Every endpoint the batch's edges touch, not only the nodes it defines: an edge
        # between two EXTERNAL nodes (a chapter bundle's `course part_of program`, the
        # book config's program edge on a chapter-only reload) was invisible here and was
        # inserted again on every run.
        endpoints = batch_nodes | {x for s_, d, _ in batch_edges for x in (s_, d)}
        cur.execute(
            """SELECT src_id, dst_id, edge_type FROM graph_edges
                WHERE src_id = ANY(%s) OR dst_id = ANY(%s)""",
            (list(endpoints), list(endpoints)))
        db_edges = {tuple(r) for r in cur.fetchall()}
        cur.execute(
            f"""SELECT id, {', '.join(MATERIAL_QUESTION_FIELDS + OTHER_QUESTION_FIELDS)},
                       solution_version, status
                  FROM questions WHERE id = ANY(%s)""", (list(batch_qids),))
        qcols = MATERIAL_QUESTION_FIELDS + OTHER_QUESTION_FIELDS + ("solution_version", "status")
        db_questions = {r[0]: dict(zip(qcols, r[1:])) for r in cur.fetchall()}
        cur.execute("SELECT DISTINCT question_id FROM attempts WHERE question_id = ANY(%s)",
                    (list(batch_qids),))
        attempted = {r[0] for r in cur.fetchall()}
        cur.execute(f"SELECT id, {', '.join(VISUAL_FIELDS)} FROM visuals WHERE id = ANY(%s)",
                    (list(batch_vids),))
        db_visuals = {r[0]: dict(zip(VISUAL_FIELDS, r[1:])) for r in cur.fetchall()}

        editing = mode in ("update", "replace")
        refused_edits: list[str] = []
        total_q = total_v = 0
        total_m = total_x = 0   # misconceptions, explanation-library entries
        seen_nodes: set[str] = set()
        seen_edges: set[tuple] = set()
        seen_q: set[str] = set()
        seen_v: set[str] = set()
        deferred_edges: list[tuple] = []  # edges may cross bundles; insert after all nodes

        for (p, b), (sha, _) in zip(
                [(p, b) for p, b in zip(paths, bundles)],
                resolved):
            if p in doc_only:
                continue
            run = b.extraction_run
            run_ids: list[int] = []

            def run_id() -> int:
                # One extraction_runs row per bundle that CHANGES something: a
                # re-run that adds nothing must leave no trace (FR-4208).
                if not run_ids:
                    cur.execute(
                        """INSERT INTO extraction_runs
                           (source_sha256, extractor, extractor_version, schema_version, finished_at)
                           VALUES (%s,%s,%s,%s, now()) RETURNING id""",
                        (sha, run.extractor, run.extractor_version, run.schema_version))
                    run_ids.append(cur.fetchone()[0])
                return run_ids[0]

            for n in b.nodes:
                if n.id in seen_nodes:
                    continue
                seen_nodes.add(n.id)
                subject = COURSE_SUBJECTS.get(n.id) if n.kind == "course" else None
                old = db_nodes.get(n.id)
                if old is None:
                    cur.execute(
                        """INSERT INTO graph_nodes
                           (id, kind, label, description, syllabus_ref, order_in_parent,
                            source_sha256, source_page, extraction_run_id, subject)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                           ON CONFLICT (id) DO NOTHING""",
                        (n.id, n.kind, n.label, n.description, n.syllabus_ref,
                         n.order_in_parent, sha, n.source_page, run_id(), subject))
                    report.note("nodes", "added", n.id)
                    continue
                if n.id in shared:
                    report.note("nodes", "unchanged")
                    continue
                if old["kind"] != n.kind:
                    raise SystemExit(f"{n.id}: bundle says kind '{n.kind}', database says "
                                     f"'{old['kind']}'. A reload never changes what a node is.")
                new = {f: getattr(n, f) for f in NODE_FIELDS}
                changed = [f for f in NODE_FIELDS if new[f] != old[f]]
                subject_fix = subject is not None and old["subject"] != subject
                if not changed and not subject_fix:
                    report.note("nodes", "unchanged")
                elif not editing:
                    report.note("nodes", "drift", f"{n.id} ({', '.join(changed + (['subject'] if subject_fix else []))})")
                else:
                    cur.execute(
                        f"""UPDATE graph_nodes SET {', '.join(f'{f} = %s' for f in NODE_FIELDS)},
                                   subject = COALESCE(%s, subject),
                                   source_sha256 = %s, extraction_run_id = %s
                             WHERE id = %s""",
                        (*new.values(), subject, sha, run_id(), n.id))
                    report.note("nodes", "updated", n.id)

            for e in b.edges:
                key = (e.src, e.dst, e.type)
                if key in seen_edges:
                    continue
                seen_edges.add(key)
                if key in db_edges:
                    report.note("edges", "unchanged")
                    continue
                deferred_edges.append((e.src, e.dst, e.type, b.syllabus_version, run_id()))
                report.note("edges", "added")

            for q in b.questions:
                if q.id in seen_q:
                    print(f"  WARNING: {p.name} redefines question {q.id} — first definition kept")
                    continue
                seen_q.add(q.id)
                new = question_row(q)
                old = db_questions.get(q.id)
                if old is None:
                    # Provenance of a book item: 'authored' (agent-written, every
                    # bundle so far) unless the bundle says 'seed' — a verbatim book
                    # item (extraction-pipeline.md §3.6). The field arrives with B7;
                    # nothing else is accepted, and a bundle can never claim 'variant'.
                    source = getattr(q, "source", None) or "authored"
                    if source not in ("seed", "authored"):
                        raise SystemExit(f"{q.id}: a seed bundle question has source "
                                         f"'{source}'; only 'seed' or 'authored' is allowed")
                    # `held` is the sacred gate: no flag promotes what it holds.
                    live = (approve_all or q.verified) and q.id not in held
                    reviewer = (None if q.id in held
                                else "samuel (poc bulk)" if approve_all
                                else "ai dual-check (pending Samuel)" if q.verified else None)
                    cur.execute(
                        """INSERT INTO questions
                           (id, lo_id, tier, question_type, stem, choices, correct_answer,
                            canonical_solution, status, source, source_sha256, source_page,
                            source_note, extraction_run_id, reviewed_by, reviewed_at)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                                   CASE WHEN %s THEN now() END)""",
                        (q.id, q.lo, q.tier, q.type, q.stem,
                         json.dumps(new["choices"]) if new["choices"] else None,
                         new["correct_answer"], json.dumps(new["canonical_solution"]),
                         "live" if live else "review", source, sha, q.source_page, q.source_note,
                         run_id(), reviewer, live))
                    report.note("questions", "added", q.id)
                    total_q += 1
                    total_v += live
                    continue
                material, other = question_diff(new, old)
                if not material and not other:
                    report.note("questions", "unchanged")
                    continue
                if not editing:
                    report.note("questions", "drift", f"{q.id} ({', '.join(material + other)})")
                    continue
                if material and q.id in attempted and not allow_attempted_edits:
                    refused_edits.append(f"{q.id}: {', '.join(material)}")
                    continue
                cur.execute(
                    """UPDATE questions
                          SET lo_id = %s, tier = %s, question_type = %s, stem = %s, choices = %s,
                              correct_answer = %s, canonical_solution = %s,
                              solution_version = solution_version
                                                 + CASE WHEN canonical_solution IS DISTINCT FROM %s::jsonb
                                                        THEN 1 ELSE 0 END,
                              source_page = %s, source_note = %s,
                              source_sha256 = %s, extraction_run_id = %s
                        WHERE id = %s""",
                    (new["lo_id"], new["tier"], new["question_type"], new["stem"],
                     json.dumps(merged_choices(new["choices"], old["choices"]))
                     if new["choices"] else None,
                     new["correct_answer"], json.dumps(new["canonical_solution"]),
                     json.dumps(new["canonical_solution"]),
                     new["source_page"], new["source_note"], sha, run_id(), q.id))
                report.note("questions", "updated", f"{q.id} ({', '.join(material + other)})")

            for v in b.visuals:
                if v.id in seen_v:
                    continue
                seen_v.add(v.id)
                new = {"lo_id": v.lo, "question_id": v.question, "kind": v.kind, "spec": v.spec,
                       "caption": v.caption, "source_page": v.source_page}
                old = db_visuals.get(v.id)
                if old is None:
                    cur.execute(
                        """INSERT INTO visuals
                           (id, lo_id, question_id, kind, spec, caption, source_page,
                            extraction_run_id)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (v.id, v.lo, v.question, v.kind, json.dumps(v.spec),
                         v.caption, v.source_page, run_id()))
                    report.note("visuals", "added", v.id)
                    continue
                changed = [f for f in VISUAL_FIELDS if new[f] != old[f]]
                if not changed:
                    report.note("visuals", "unchanged")
                elif not editing:
                    report.note("visuals", "drift", f"{v.id} ({', '.join(changed)})")
                else:
                    cur.execute(
                        """UPDATE visuals SET lo_id = %s, question_id = %s, kind = %s, spec = %s,
                                              caption = %s, source_page = %s, extraction_run_id = %s
                            WHERE id = %s""",
                        (v.lo, v.question, v.kind, json.dumps(v.spec), v.caption,
                         v.source_page, run_id(), v.id))
                    report.note("visuals", "updated", v.id)

            # ---- explanation library (ADR-0007) ----------------------------
            # Constitution v2.0.0 Principle III is suspended for these rows in
            # the comparison environment only: they are pipeline-generated and
            # ship WITHOUT human review.
            #
            # `reviewed` is hard-coded FALSE here and is not readable from the
            # bundle at all. That is the point: generated content must not be
            # able to assert that it was reviewed. Review is a human act
            # performed later against the database, and until it happens
            #     SELECT count(*) FROM explanation_library WHERE NOT reviewed
            # is an honest answer to "how much unreviewed teaching is live".
            # Add-only in every mode: the catalogue's owner is load_misconceptions.py.
            for m in b.misconceptions:
                cur.execute(
                    """INSERT INTO misconceptions
                       (id, lo_id, label, description, signal, generated_by)
                       VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING""",
                    (m.id, m.lo, m.label, m.description, m.signal, m.generated_by))
                report.note("misconceptions", "added" if cur.rowcount else "unchanged")
                total_m += cur.rowcount
            for x in b.explanation_entries:
                content_steps = [
                    c if isinstance(c, dict) else c.model_dump(exclude_none=True)
                    for c in x.content
                ]
                cur.execute(
                    """INSERT INTO explanation_library
                       (id, lo_id, misconception_id, entry_type, content,
                        source_page, generated_by, reviewed)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,FALSE) ON CONFLICT (id) DO NOTHING""",
                    (x.id, x.lo, x.misconception, x.entry_type,
                     json.dumps(content_steps), x.source_page, x.generated_by))
                report.note("explanation_entries", "added" if cur.rowcount else "unchanged")
                total_x += cur.rowcount

        if refused_edits:
            raise SystemExit(
                f"REFUSING --{mode}: {len(refused_edits)} question(s) that students have attempted "
                f"would change what they ask or accept:\n    "
                + "\n    ".join(refused_edits[:20])
                + ("\n    …" if len(refused_edits) > 20 else "")
                + "\nTheir attempts would then score answers to a different question. Give the "
                  "edited question a new id and let --replace retire the old one, or pass "
                  "--allow-attempted-edits if the change really is cosmetic.")

        if program:
            cur.execute("""INSERT INTO graph_nodes (id, kind, label) VALUES (%s, 'program', %s)
                           ON CONFLICT (id) DO NOTHING""", (program.id, program.label))
            if cur.rowcount:
                report.note("nodes", "added", program.id)
            key = (course, program.id, "part_of")
            if key not in db_edges and key not in seen_edges:
                deferred_edges.append((*key, content[0][1].syllabus_version, None))
                report.note("edges", "added", f"{course} part_of {program.id}")

        for row in deferred_edges:
            cur.execute(
                """INSERT INTO graph_edges
                   (src_id, dst_id, edge_type, syllabus_version, extraction_run_id)
                   VALUES (%s,%s,%s,%s,%s)""", row)

        # Every lesson's book provenance (T404, FR-4311). Same add / update rules as
        # the content above; it refuses, before commit, if the bundles carry parts or
        # merges and migration 034 is missing.
        lessons = lesson_rows(content, course)
        write_lessons(cur, lessons, editing, report)

        if course and mode == "replace" and subtree:
            prune = plan_prune(cur, course, subtree, shared, batch_nodes, batch_edges,
                               batch_qids, batch_vids)
            if prune.blockers:
                lines = [f"{node}: {'; '.join(why)}" for node, why in sorted(prune.blockers.items())]
                raise SystemExit(
                    f"REFUSING --replace {course}: the bundles dropped {len(prune.blockers)} "
                    f"node(s) that are still in use, and removing them would lose or orphan "
                    f"what is listed (FR-4210):\n    " + "\n    ".join(lines[:30])
                    + ("\n    …" if len(lines) > 30 else "")
                    + "\nNothing was changed. Keep those nodes in the bundles, or move what "
                      "depends on them first.")
            apply_prune(cur, prune, report)
            prune_lessons(cur, course, lessons, report)

        # THE SACRED GATE IS NOT A LOAD-TIME DEFAULT. A question it holds is never
        # left live by any load, in any mode — including one inserted earlier and
        # promoted since, whose passage approval has now gone stale (ADR-0006).
        if held:
            cur.execute("UPDATE questions SET status = 'review' WHERE id = ANY(%s) "
                        "AND status = 'live' RETURNING id", (list(held),))
            demoted = [r[0] for r in cur.fetchall()]
            if demoted:
                print("!" * 72)
                print(f"!! sacred gate: {len(demoted)} live question(s) demoted to review — "
                      f"{', '.join(demoted[:6])}{' …' if len(demoted) > 6 else ''}")
                print("!" * 72)

        if demo_student:
            seed_demo_student(cur)

        report.print(mode if course else "full")
        cur.execute(SNAPSHOT_SQL)
        after = cur.fetchone()
        print_delta(before, after)
        # Belt and braces: this loader never deletes a student row. If the
        # counts went down on a course load, something is badly wrong — refuse.
        if course and (after[8] < before[8] or after[9] < before[9]):
            raise SystemExit("REFUSING: student attempts or mastery rows decreased during a "
                             "course load. Nothing was committed.")
        if dry_run:
            conn.rollback()
            print("\nDRY RUN: transaction rolled back — the database is untouched.\n"
                  "Everything above (validation, the sacred gate, collision checks, the "
                  "live/review split) ran for real against real data.")
            return
        conn.commit()
    scope = f" [scoped to {course}, {mode}]" if course else ""
    print(f"loaded {len(content)} bundle(s){scope}: {total_q} question(s) inserted "
          f"({total_v} live)")
    if total_m or total_x:
        # Say it out loud on every load. The suspension of the review gate is a
        # standing exception, not a default, and a silent load is how a standing
        # exception quietly becomes the norm.
        print(f"  explanation library: {total_m} misconceptions, {total_x} entries "
              f"— ALL stored reviewed=false (ADR-0007, constitution III suspended)")
    # The review gate, stated out loud on every load: whatever did not clear
    # verification is in the database but unreachable by a student.
    held_back = total_q - total_v
    print(f"review gate: {held_back} inserted question(s) landed as status='review' — not "
          f"served to any student until a human promotes them"
          + ("" if not approve_all else "   [--approve-all was used: PoC bulk approval]"))


"""The demo cast — the three students that make the WHOLE journey demonstrable.

Order matters: Omar is inserted first, so on a full reload (which TRUNCATEs
... RESTART IDENTITY) he is always the lowest id and therefore the app's
default student. Names are matched on display_name, so seeding is idempotent:
`--seed-demo-students` tops up whoever is missing without touching curriculum.
"""
OMAR = "Omar (demo)"
COLD_START = "نور (جديدة)"
STRONG = "يوسف (متفوّق)"


def find_student(cur, display_name: str):
    cur.execute("SELECT id FROM students WHERE display_name = %s", (display_name,))
    row = cur.fetchone()
    return row[0] if row else None


def all_los(cur) -> list[str]:
    cur.execute("SELECT id FROM graph_nodes WHERE kind='learning_objective' ORDER BY id")
    return [r[0] for r in cur.fetchall()]


def seed_demo_student(cur) -> None:
    """Seed every missing member of the demo cast (idempotent, by display_name).

      1. Omar (demo)  — mid-journey: baseline + current mastery on every LO,
                        a few hundred attempts. UNCHANGED (rng seed 42).
      2. نور (جديدة)   — THE COLD START: a real student row with NO mastery,
                        NO attempts, NO understanding checks. The grey graph at
                        0%, "no attempts yet", diagnostic-as-first-action demo.
                        Deliberately nothing but the row — that IS the fixture.
      3. يوسف (متفوّق) — a confident learner: high current mastery over a lower
                        baseline (so the as-of toggle shows real growth).
    """
    seed_omar(cur)
    seed_cold_start_student(cur)
    seed_strong_student(cur)


def seed_omar(cur) -> None:
    """Demo student with baseline + current mastery on every LO (weaker on later units)."""
    if (existing := find_student(cur, OMAR)) is not None:
        print(f"demo student '{OMAR}' already present (id={existing}) — left untouched")
        return
    rng = random.Random(42)
    cur.execute("INSERT INTO students (display_name, grade) VALUES (%s,'prep-3') "
                "RETURNING id", (OMAR,))
    sid = cur.fetchone()[0]
    cur.execute("SELECT id, order_in_parent FROM graph_nodes WHERE kind='learning_objective' "
                "ORDER BY id")
    los = cur.fetchall()
    for i, (lo, _) in enumerate(los):
        frac = i / max(len(los) - 1, 1)
        base = max(0.08, 0.55 - 0.45 * frac + rng.uniform(-0.05, 0.05))
        curr = min(0.95, base + max(0.02, 0.35 - 0.30 * frac + rng.uniform(-0.05, 0.05)))
        cur.execute(
            """INSERT INTO mastery (student_id, lo_id, score, system_from, system_to)
               VALUES (%s,%s,%s, now() - interval '14 days', now() - interval '1 day')""",
            (sid, lo, round(base, 2)))
        cur.execute(
            """INSERT INTO mastery (student_id, lo_id, score, system_from)
               VALUES (%s,%s,%s, now() - interval '1 day')""",
            (sid, lo, round(curr, 2)))
    cur.execute("SELECT q.id, q.lo_id, q.correct_answer FROM questions q WHERE q.status='live'")
    for qid, lo, ans in cur.fetchall():
        cur.execute("SELECT score FROM mastery WHERE student_id=%s AND lo_id=%s "
                    "AND system_to IS NULL", (sid, lo))
        p = cur.fetchone()[0]
        for day in (10, 6, 3, 1):
            if rng.random() < 0.35:
                ok = rng.random() < p
                cur.execute(
                    """INSERT INTO attempts (student_id, question_id, given_answer,
                       is_correct, time_ms, attempted_at)
                       VALUES (%s,%s,%s,%s,%s, now() - make_interval(days => %s))""",
                    (sid, qid, ans if ok else "?", ok, rng.randint(15000, 120000), day))
    print(f"demo student seeded (id={sid})")


def seed_cold_start_student(cur) -> None:
    """The cold start: a student row and NOTHING else.

    No mastery, no attempts, no checks — on purpose. Every "day one" claim the
    product makes (grey graph, empty ledger, the diagnostic as the obvious
    first action) is only demonstrable against a student who genuinely has no
    history. Anything seeded here would quietly destroy that fixture.
    """
    if (existing := find_student(cur, COLD_START)) is not None:
        print(f"demo student '{COLD_START}' already present (id={existing}) — left untouched")
        return
    cur.execute("INSERT INTO students (display_name, grade) VALUES (%s,'prep-3') "
                "RETURNING id", (COLD_START,))
    sid = cur.fetchone()[0]
    print(f"cold-start demo student seeded (id={sid}) — 0 mastery, 0 attempts, 0 checks")


def seed_strong_student(cur) -> None:
    """A confident learner: high current mastery over a middling baseline."""
    if (existing := find_student(cur, STRONG)) is not None:
        print(f"demo student '{STRONG}' already present (id={existing}) — left untouched")
        return
    rng = random.Random(7)   # its own stream: Omar's numbers must not shift
    cur.execute("INSERT INTO students (display_name, grade) VALUES (%s,'prep-3') "
                "RETURNING id", (STRONG,))
    sid = cur.fetchone()[0]
    for lo in all_los(cur):
        base = min(0.9, 0.55 + rng.uniform(-0.08, 0.08))
        curr = min(0.96, base + 0.25 + rng.uniform(-0.05, 0.05))
        cur.execute(
            """INSERT INTO mastery (student_id, lo_id, score, system_from, system_to)
               VALUES (%s,%s,%s, now() - interval '14 days', now() - interval '1 day')""",
            (sid, lo, round(base, 2)))
        cur.execute(
            """INSERT INTO mastery (student_id, lo_id, score, system_from)
               VALUES (%s,%s,%s, now() - interval '1 day')""",
            (sid, lo, round(curr, 2)))
    cur.execute("SELECT q.id, q.lo_id, q.correct_answer FROM questions q WHERE q.status='live'")
    for qid, lo, ans in cur.fetchall():
        cur.execute("SELECT score FROM mastery WHERE student_id=%s AND lo_id=%s "
                    "AND system_to IS NULL", (sid, lo))
        row = cur.fetchone()
        if row is None:
            continue          # question on an LO seeded after this student's mastery
        p = float(row[0])
        for day in (9, 5, 2):
            if rng.random() < 0.3:
                ok = rng.random() < p
                cur.execute(
                    """INSERT INTO attempts (student_id, question_id, given_answer,
                       is_correct, time_ms, attempted_at)
                       VALUES (%s,%s,%s,%s,%s, now() - make_interval(days => %s))""",
                    (sid, qid, ans if ok else "?", ok, rng.randint(9000, 60000), day))
    print(f"strong demo student seeded (id={sid})")


def seed_demo_students_only() -> None:
    """`--seed-demo-students`: top up the demo cast in place.

    Curriculum is NOT touched — no truncate, no bundle load. This is how the
    cast reaches a database that already holds content (and real attempt
    history) without the destructive full reload that `--demo-student` implies.
    """
    import psycopg
    dsn = db_dsn()
    print(f"target database: {describe_dsn(dsn)}"
          + ("" if dsn == DEFAULT_DSN else "   [from environment]"))
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        seed_demo_student(cur)
        cur.execute("SELECT s.id, s.display_name, "
                    "  (SELECT count(*) FROM attempts a WHERE a.student_id = s.id), "
                    "  (SELECT count(*) FROM mastery m WHERE m.student_id = s.id) "
                    "FROM students s ORDER BY s.id")
        print("\ndemo cast:")
        for sid, name, attempts, mastery in cur.fetchall():
            print(f"  id={sid:<3} {name:<16} attempts={attempts:<6} mastery_rows={mastery}")
        conn.commit()


KNOWN_FLAGS = {"--validate-only", "--approve-all", "--demo-student", "--seed-demo-students",
               "--all", "--dry-run", "--update", "--replace", "--if-absent",
               "--wipe-students", "--allow-attempted-edits"}


def main(argv: list[str]) -> None:
    if {"-h", "--help"} & set(argv):
        print(__doc__)
        return
    args = iter(argv)
    flags: set[str] = set()
    paths: list[Path] = []
    course: str | None = None
    for a in args:
        if a == "--course":
            course = next(args, None)
            if not course or course.startswith("--"):
                raise SystemExit("--course requires a course node id (e.g. course:prep3-social-ar)")
        elif a.startswith("--"):
            if a not in KNOWN_FLAGS:
                # An unknown flag used to be ignored silently. On a loader that
                # can prune a course, a typo (`--dryrun`) must stop the run.
                raise SystemExit(f"unknown flag {a} (known: {', '.join(sorted(KNOWN_FLAGS))})")
            flags.add(a)
        else:
            paths.append(Path(a))
    if "--seed-demo-students" in flags:
        # Additive, curriculum-free path: the demo cast on an existing DB.
        if paths or course or flags - {"--seed-demo-students"}:
            raise SystemExit("--seed-demo-students takes no bundles and no other flags "
                             "(it only tops up the demo students; curriculum is untouched)")
        seed_demo_students_only()
        raise SystemExit(0)
    mode = "replace" if "--replace" in flags else "update" if "--update" in flags else "add"
    if {"--update", "--replace"} <= flags:
        raise SystemExit("--update and --replace are exclusive (--replace already updates)")
    if not course and flags & {"--update", "--replace", "--if-absent", "--allow-attempted-edits"}:
        raise SystemExit("--update, --replace, --if-absent and --allow-attempted-edits need "
                         "--course <id>: they describe a course load")
    if "--if-absent" in flags and mode != "add":
        raise SystemExit("--if-absent is the first-load contract; it cannot be combined with "
                         "--update or --replace")
    if course and "--wipe-students" in flags:
        raise SystemExit("--wipe-students belongs to the unscoped full-truncate load; a course "
                         "load never deletes student rows")
    if "--all" in flags:
        if paths:
            raise SystemExit("--all takes no bundle paths (it IS the path list)")
        paths = all_bundle_paths()
        if course:
            # "load or refresh this whole course" — its bundles from its book
            # config, plus the source document of any bundle they supersede.
            paths = bundles_for_course(course, paths)
            paths = superseded_doc_bundles(course, paths) + paths
        else:
            warn_superseded(paths)
    if not paths:
        paths = [HERE / "seed" / "unit1.json"]
    if "--validate-only" in flags:
        bundles = validate_all(paths)  # deliberately DB-free: no collision/external-ref DB checks
        # Run the gate here too: `--validate-only --approve-all` must not report
        # a clean bill of health for a load that would be refused.
        sacred_gate(paths, bundles, "--approve-all" in flags)
        # the batch alone (no DB here): a cross-course prerequisite is refused
        refuse_cross_course_prerequisites(
            {(e.src, e.dst, e.type) for b in bundles for e in b.edges})
        print("validation passed")
    else:
        if course and "--demo-student" in flags:
            raise SystemExit("--demo-student is for full reloads only (it seeds mastery on "
                             "every LO in the DB); do not combine with --course")
        load(paths, "--approve-all" in flags, "--demo-student" in flags, course,
             dry_run="--dry-run" in flags, mode=mode, if_absent="--if-absent" in flags,
             wipe_students="--wipe-students" in flags,
             allow_attempted_edits="--allow-attempted-edits" in flags)


if __name__ == "__main__":
    main(sys.argv[1:])

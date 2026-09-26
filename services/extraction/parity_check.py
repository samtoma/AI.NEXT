#!/usr/bin/env python3
"""Content parity between the two comparison environments (FR-904, constitution XI).

The whole premise of the Student MVP 1.0 comparison (ADR-0007) is that the two
environments teach IDENTICAL material, so any difference a reviewer or a metric
sees is the experience and not the content. This script is what makes that claim
checkable instead of assumed.

It computes a fingerprint of each database and exits non-zero on any difference:

    source document sha256
    counts: modules, learning objectives, prerequisite_of edges, visuals
    questions: TOTAL and status='live', compared SEPARATELY
    a sorted digest of learning-objective ids

Why live counts are compared separately, and why that is the point of this file:
a `--course` scoped refresh used to demote previously bulk-promoted questions back
to `review` (PROJECT_STATE records exactly this happening to Unit 1's 29; the
loader is add-only now, but a restore or a hand edit can still do it). Two
environments can therefore hold identical TOTAL question counts while serving
different question sets. Counts alone would call that parity. It is not.

The LO-id digest catches the other silent failure: an environment holding the
right NUMBER of learning objectives, but not the same ones.

PER COURSE, NOT PER SUBJECT (B10, G10). The fingerprint used to be scoped by
subject = 'math', and `source_sha256` was the first document ingested into the
whole database. A second maths course (Grade 10) would have been counted into
the Prep-3 fingerprint and turned it RED although nothing about Prep-3 had
drifted. Every count is now scoped to ONE course node, and the expected
constant comes from that course's book config (`parity` in books/<book>.json).

Usage:
    uv run parity_check.py --baseline "$BASELINE_DSN" --candidate "$MVP1_DSN"
    uv run parity_check.py --candidate "$MVP1_DSN"      # Prep-3 maths vs its constant
    uv run parity_check.py --candidate "$MVP1_DSN" --course course:prep3-social-ar
    uv run parity_check.py --candidate "$MVP1_DSN" --all-courses   # every configured course

Exit codes: 0 parity green · 1 drift detected · 2 could not connect / query /
no constant configured for the course.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from dataclasses import dataclass, asdict

import book_config

# The course a bare `parity_check.py --candidate …` checks: the Prep-3 maths
# book, whose constant (10 / 90 / 112 / 450 / 212, specs/001 spec.md) is what
# this script has always meant. Its numbers now live in
# books/prep3-math-en.json `parity`, read out of the seed bundles and checked
# against them by `book_config.py check`.
DEFAULT_COURSE = "course:prep3-math-en"


def expected_for(course: str) -> "book_config.Parity":
    book = book_config.book_for_course(course)
    if book is None or book.parity is None:
        raise LookupError(
            f"no parity constant for {course}: add a `parity` block to its book config "
            f"(services/extraction/books/<book>.json)")
    return book.parity


# Kept for anything that imported it: the Prep-3 maths constant.
EXPECTED = expected_for(DEFAULT_COURSE).expected()


# Fields that describe the GENERATED bank rather than the book. They are
# reported but never compared, because after ADR-0008 the comparison
# environment is expected to carry questions the baseline does not have. The
# constant is the book; the generated bank is an environment-scoped extension.
GENERATED_FIELDS = frozenset(
    {"generated_total", "generated_live", "generated_unreviewed"}
)


@dataclass
class Fingerprint:
    source_sha256: str | None
    modules: int
    learning_objectives: int
    prerequisite_edges: int
    questions_total: int
    questions_live: int
    visuals: int
    lo_digest: str
    # book-extension counts (source='variant'), mvp1 only
    generated_total: int = 0
    generated_live: int = 0
    generated_unreviewed: int = 0

    def diff(self, other: "Fingerprint") -> list[str]:
        out = []
        for k, mine in asdict(self).items():
            if k in GENERATED_FIELDS:
                continue
            theirs = getattr(other, k)
            if mine != theirs:
                out.append(f"{k}: {mine!r} != {theirs!r}")
        return out


def fingerprint(dsn: str, course: str = DEFAULT_COURSE) -> Fingerprint:
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        # The node_subject view resolves each learning objective to its course by
        # walking 'teaches' back to a module and 'part_of' up to the course node.
        # Everything else (modules, questions, visuals, edges) is scoped by
        # deriving from that LO set. Scoping by COURSE, not by subject: two maths
        # courses share a subject and must not share a fingerprint.
        LOS = (
            "SELECT node_id FROM node_subject WHERE course_id = %(course)s"
        )
        params = {"course": course}

        # The course's own document(s): every sha stamped on its objectives and on
        # the course node. Not "the first document in the database", which was
        # whichever book happened to be loaded first.
        cur.execute(
            f"""SELECT string_agg(DISTINCT source_sha256, '+' ORDER BY source_sha256)
                  FROM graph_nodes
                 WHERE (id IN ({LOS}) OR id = %(course)s) AND source_sha256 IS NOT NULL""",
            params,
        )
        source_sha = cur.fetchone()[0]

        cur.execute(f"SELECT count(*) FROM ({LOS}) t", params)
        los = cur.fetchone()[0]

        cur.execute(
            f"""SELECT count(*) FROM graph_nodes n
                 WHERE n.kind = 'module'
                   AND EXISTS (SELECT 1 FROM graph_edges e
                                WHERE e.dst_id = n.id AND e.edge_type = 'part_of'
                                  AND e.src_id = %(course)s)""",
            params,
        )
        modules = cur.fetchone()[0]
        if modules == 0:
            # Older bundles orient part_of the other way; count both rather than
            # silently reporting zero modules.
            cur.execute(
                f"""SELECT count(*) FROM graph_nodes n
                     WHERE n.kind = 'module'
                       AND EXISTS (SELECT 1 FROM graph_edges e
                                    WHERE e.src_id = n.id AND e.edge_type = 'part_of'
                                      AND e.dst_id = %(course)s)""",
                params,
            )
            modules = cur.fetchone()[0]

        cur.execute(
            f"""SELECT count(*) FROM graph_edges e
                 WHERE e.edge_type = 'prerequisite_of'
                   AND e.src_id IN ({LOS})""",
            params,
        )
        edges = cur.fetchone()[0]

        # THE CONSTANT IS THE BOOK, NOT THE BANK (ADR-0008). Only questions that
        # came out of the ministry textbook — source 'seed' or 'authored' — are
        # counted into the fingerprint that both environments must match.
        # Generated items (source='variant') are counted separately below and
        # are never part of the equality check, because the comparison build is
        # now expected to carry questions the frozen baseline does not.
        BOOK = "source IN ('seed', 'authored')"
        cur.execute(
            f"SELECT count(*) FROM questions WHERE {BOOK} AND lo_id IN ({LOS})",
            params,
        )
        q_total = cur.fetchone()[0]

        cur.execute(
            f"""SELECT count(*) FROM questions
                 WHERE {BOOK} AND status = 'live' AND lo_id IN ({LOS})""",
            params,
        )
        q_live = cur.fetchone()[0]

        cur.execute(
            f"""SELECT count(*),
                       count(*) FILTER (WHERE status = 'live'),
                       count(*) FILTER (WHERE status = 'live' AND reviewed_by IS NULL)
                  FROM questions
                 WHERE source = 'variant' AND lo_id IN ({LOS})""",
            params,
        )
        g_total, g_live, g_unreviewed = cur.fetchone()

        cur.execute(f"SELECT count(*) FROM visuals WHERE lo_id IN ({LOS})", params)
        visuals = cur.fetchone()[0]

        cur.execute(f"SELECT node_id FROM ({LOS}) t ORDER BY node_id", params)
        ids = "\n".join(r[0] for r in cur.fetchall())
        digest = hashlib.sha256(ids.encode("utf-8")).hexdigest()[:16]

    return Fingerprint(
        source_sha256=source_sha,
        modules=modules,
        learning_objectives=los,
        prerequisite_edges=edges,
        questions_total=q_total,
        questions_live=q_live,
        visuals=visuals,
        lo_digest=digest,
        generated_total=g_total,
        generated_live=g_live,
        generated_unreviewed=g_unreviewed,
    )


def render(name: str, fp: Fingerprint) -> str:
    return (
        f"  {name}\n"
        f"    source sha256   {(fp.source_sha256 or '—')[:16]}\n"
        f"    modules         {fp.modules}\n"
        f"    learning objs   {fp.learning_objectives}\n"
        f"    prerequisites   {fp.prerequisite_edges}\n"
        f"    book questions  {fp.questions_total}  (live: {fp.questions_live})\n"
        f"    generated       {fp.generated_total}  (live: {fp.generated_live}, "
        f"unreviewed: {fp.generated_unreviewed})\n"
        f"    visuals         {fp.visuals}\n"
        f"    LO id digest    {fp.lo_digest}\n"
    )


def check_expected(fp: Fingerprint, parity: "book_config.Parity | None" = None) -> list[str]:
    parity = parity or expected_for(DEFAULT_COURSE)
    problems = []
    for key, want in parity.expected().items():
        got = getattr(fp, key)
        if got != want:
            problems.append(f"{key}: {got} != expected {want}")
    if parity.require_all_live and fp.questions_live != fp.questions_total:
        problems.append(
            f"questions_live ({fp.questions_live}) < questions_total "
            f"({fp.questions_total}) — a scoped refresh has demoted questions "
            f"back to 'review'; promote them or the environments serve different sets"
        )
    return problems


def expected_source_sha(course: str) -> str | None:
    """The PDF sha256 the course's Stage-0 manifest records, or None (no manifest).

    FR-4207: the drift guard knows the book "by its source fingerprint and its counts". The
    counts come from the book config; the fingerprint from the manifest S0a wrote when it
    hashed the source. Books built before the line (Prep-3) have no manifest, and are
    checked on counts and, against a baseline, on the sha the two databases hold.
    """
    book = book_config.book_for_course(course)
    if book is None or not book.manifest:
        return None
    mp = book.repo_path(book.manifest)
    if not mp.exists():
        return None
    import json
    pdf = (json.loads(mp.read_text()).get("book", {}).get("sources", {}) or {}).get("pdf") or {}
    return pdf.get("sha256") if isinstance(pdf, dict) else None


def check_source(fp: Fingerprint, course: str) -> list[str]:
    want = expected_source_sha(course)
    if want is None or fp.source_sha256 == want:
        return []
    return [f"source_sha256: {(fp.source_sha256 or '—')[:16]} != the manifest's {want[:16]} — the "
            f"course's rows are stamped with another document (or an `unavailable:` sha), so they "
            f"cannot be traced to the book the manifest describes"]


def check_baseline_clean(fp: Fingerprint) -> list[str]:
    """The generated bank must never reach the frozen baseline.

    Constitution III bounds the review-gate suspension to the comparison
    environment. A generated row on `ainext.reletix.com` is not a parity
    problem — it is a governance breach, and it is louder than a count
    mismatch because it means unreviewed mathematics reached an audience
    that never consented to see any.
    """
    if fp.generated_total:
        return [
            f"BASELINE CARRIES {fp.generated_total} GENERATED QUESTION(S). "
            f"The review-gate suspension (constitution III, ADR-0008) applies "
            f"to the comparison environment ONLY. Remove them before anything else."
        ]
    return []


def check_course(course: str, candidate_dsn: str, baseline_dsn: str | None) -> tuple[int, bool]:
    """(exit code, has live generated) for one course. Prints its section."""
    try:
        parity = expected_for(course)
    except LookupError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2, False
    try:
        cand = fingerprint(candidate_dsn, course)
    except Exception as exc:  # noqa: BLE001 — any failure here is fatal to the check
        print(f"ERROR: could not fingerprint candidate for {course}: {exc}", file=sys.stderr)
        return 2, False

    print(f"Content parity check (FR-904) — {course}\n")
    print(render("candidate (mvp1)", cand))

    problems: list[str] = []
    if baseline_dsn:
        try:
            base = fingerprint(baseline_dsn, course)
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR: could not fingerprint baseline for {course}: {exc}", file=sys.stderr)
            return 2, False
        print(render("baseline", base))
        problems += [f"baseline vs candidate — {d}" for d in cand.diff(base)]
        problems += check_baseline_clean(base)
    else:
        print("  (no --baseline given; comparing against the course's expected constant)\n")

    problems += check_expected(cand, parity)
    problems += check_source(cand, course)

    if problems:
        print(f"PARITY: RED — {course}\n")
        for p in problems:
            print(f"  ✗ {p}")
        print(
            "\nThe comparison is INVALID until this is resolved: a metric difference "
            "could be the content rather than the experience."
        )
        return 1, False

    print(f"PARITY: GREEN — {course}")
    if not parity.require_all_live and cand.questions_live < cand.questions_total:
        print(f"  note: {cand.questions_total - cand.questions_live} of this course's "
              f"{cand.questions_total} book question(s) are not live; this course's constant "
              f"does not require them to be ({parity.note or 'see its book config'}).")
    if cand.generated_live:
        # Not a warning about correctness — a standing disclosure. Whoever reads
        # a green check should also read how much of what students saw was never
        # gated by a human (SC-011).
        print(
            f"  note: {cand.generated_live} generated question(s) live in the "
            f"comparison environment, {cand.generated_unreviewed} of them unreviewed. "
            f"The book constant matched exactly; the generated bank is an "
            f"environment-scoped extension and is not part of it."
        )
    return 0, bool(cand.generated_live)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--baseline", help="DSN of the frozen baseline database")
    ap.add_argument("--candidate", help="DSN of the mvp1 database")
    ap.add_argument("--course", action="append", default=[],
                    help=f"course node id to check (repeatable; default {DEFAULT_COURSE})")
    ap.add_argument("--all-courses", action="store_true",
                    help="check every course that has a book config with a parity constant")
    args = ap.parse_args()

    candidate_dsn = args.candidate or os.environ.get("AINEXT_DB_DSN")
    if not candidate_dsn:
        print("ERROR: pass --candidate or set AINEXT_DB_DSN", file=sys.stderr)
        return 2

    courses = list(args.course)
    if args.all_courses:
        courses += [b.course_id for b in book_config.all_books()
                    if b.parity and b.course_id not in courses]
    if not courses:
        courses = [DEFAULT_COURSE]

    worst = 0
    results = []
    for i, course in enumerate(courses):
        if i:
            print("\n" + "-" * 72 + "\n")
        code, _ = check_course(course, candidate_dsn, args.baseline)
        results.append((course, code))
        worst = max(worst, code)
    if len(courses) > 1:
        print("\n" + "=" * 72)
        for course, code in results:
            print(f"  {('GREEN' if code == 0 else 'RED' if code == 1 else 'ERROR'):<6} {course}")
    return worst


if __name__ == "__main__":
    sys.exit(main())

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
a `--course` scoped refresh demotes previously bulk-promoted questions back to
`review` (PROJECT_STATE records exactly this happening to Unit 1's 29). Two
environments can therefore hold identical TOTAL question counts while serving
different question sets. Counts alone would call that parity. It is not.

The LO-id digest catches the other silent failure: an environment holding the
right NUMBER of learning objectives, but not the same ones.

Usage:
    uv run parity_check.py --baseline "$BASELINE_DSN" --candidate "$MVP1_DSN"
    uv run parity_check.py --candidate "$MVP1_DSN"      # compare to the expected constants

Exit codes: 0 parity green · 1 drift detected · 2 could not connect / query.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from dataclasses import dataclass, asdict

# The verified constant for this comparison (specs/001-student-mvp1-delta/spec.md).
# Read out of services/extraction/seed/*.json, not remembered.
EXPECTED = {
    "modules": 10,
    "learning_objectives": 90,
    "prerequisite_edges": 112,
    "questions_total": 450,
    "visuals": 212,
}

# The value stamped on the COURSE node by the loader, and the key used in the
# app's subject registry — "math", not "mathematics". Learned the hard way:
# filtering on the wrong string silently returns zero rows rather than erroring,
# which reads as "the environment is empty" instead of "the query is wrong".
COURSE_SUBJECT = "math"


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


def fingerprint(dsn: str) -> Fingerprint:
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        def scalar(sql: str, default=0):
            cur.execute(sql)
            row = cur.fetchone()
            return row[0] if row and row[0] is not None else default

        # source_documents is keyed by sha256 — there is no id column.
        source_sha = scalar(
            "SELECT sha256 FROM source_documents ORDER BY ingested_at, sha256 LIMIT 1",
            None,
        )

        # `subject` is stamped on the COURSE node only. The node_subject view
        # resolves it for learning objectives by walking the 'teaches' edge back
        # to their course; everything else (modules, questions, visuals, edges)
        # is scoped by deriving from that LO set, not by a subject column it
        # does not have.
        LOS = (
            "SELECT node_id FROM node_subject WHERE subject = %(subject)s"
        )
        params = {"subject": COURSE_SUBJECT}

        cur.execute(f"SELECT count(*) FROM ({LOS}) t", params)
        los = cur.fetchone()[0]

        cur.execute(
            f"""SELECT count(*) FROM graph_nodes n
                 WHERE n.kind = 'module'
                   AND EXISTS (SELECT 1 FROM graph_edges e
                                WHERE e.dst_id = n.id AND e.edge_type = 'part_of'
                                  AND e.src_id IN (SELECT course_id FROM node_subject
                                                    WHERE subject = %(subject)s))""",
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
                                      AND e.dst_id IN (SELECT course_id FROM node_subject
                                                        WHERE subject = %(subject)s))""",
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


def check_expected(fp: Fingerprint) -> list[str]:
    problems = []
    for key, want in EXPECTED.items():
        got = getattr(fp, key)
        if got != want:
            problems.append(f"{key}: {got} != expected {want}")
    if fp.questions_live != fp.questions_total:
        problems.append(
            f"questions_live ({fp.questions_live}) < questions_total "
            f"({fp.questions_total}) — a scoped refresh has demoted questions "
            f"back to 'review'; promote them or the environments serve different sets"
        )
    return problems


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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--baseline", help="DSN of the frozen baseline database")
    ap.add_argument("--candidate", help="DSN of the mvp1 database")
    args = ap.parse_args()

    candidate_dsn = args.candidate or os.environ.get("AINEXT_DB_DSN")
    if not candidate_dsn:
        print("ERROR: pass --candidate or set AINEXT_DB_DSN", file=sys.stderr)
        return 2

    try:
        cand = fingerprint(candidate_dsn)
    except Exception as exc:  # noqa: BLE001 — any failure here is fatal to the check
        print(f"ERROR: could not fingerprint candidate: {exc}", file=sys.stderr)
        return 2

    print("Content parity check (FR-904)\n")
    print(render("candidate (mvp1)", cand))

    problems: list[str] = []

    if args.baseline:
        try:
            base = fingerprint(args.baseline)
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR: could not fingerprint baseline: {exc}", file=sys.stderr)
            return 2
        print(render("baseline", base))
        problems += [f"baseline vs candidate — {d}" for d in cand.diff(base)]
        problems += check_baseline_clean(base)
    else:
        print("  (no --baseline given; comparing against the expected constants)\n")

    problems += check_expected(cand)

    if problems:
        print("PARITY: RED\n")
        for p in problems:
            print(f"  ✗ {p}")
        print(
            "\nThe comparison is INVALID until this is resolved: a metric difference "
            "could be the content rather than the experience."
        )
        return 1

    print("PARITY: GREEN")
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
    return 0


if __name__ == "__main__":
    sys.exit(main())

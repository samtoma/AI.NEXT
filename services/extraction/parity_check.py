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

COURSE_SUBJECT = "mathematics"


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

    def diff(self, other: "Fingerprint") -> list[str]:
        out = []
        for k, mine in asdict(self).items():
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

        source_sha = scalar(
            "SELECT sha256 FROM source_documents ORDER BY id LIMIT 1", None
        )

        modules = scalar(
            f"SELECT count(*) FROM graph_nodes "
            f"WHERE kind = 'module' AND subject = '{COURSE_SUBJECT}'"
        )
        los = scalar(
            f"SELECT count(*) FROM graph_nodes "
            f"WHERE kind = 'learning_objective' AND subject = '{COURSE_SUBJECT}'"
        )
        edges = scalar(
            "SELECT count(*) FROM graph_edges e "
            "JOIN graph_nodes n ON n.id = e.src "
            f"WHERE e.edge_type = 'prerequisite_of' AND n.subject = '{COURSE_SUBJECT}'"
        )
        q_total = scalar(
            "SELECT count(*) FROM questions q JOIN graph_nodes n ON n.id = q.lo_id "
            f"WHERE n.subject = '{COURSE_SUBJECT}'"
        )
        q_live = scalar(
            "SELECT count(*) FROM questions q JOIN graph_nodes n ON n.id = q.lo_id "
            f"WHERE n.subject = '{COURSE_SUBJECT}' AND q.status = 'live'"
        )
        visuals = scalar(
            "SELECT count(*) FROM visuals v JOIN graph_nodes n ON n.id = v.lo_id "
            f"WHERE n.subject = '{COURSE_SUBJECT}'"
        )

        cur.execute(
            f"SELECT id FROM graph_nodes "
            f"WHERE kind = 'learning_objective' AND subject = '{COURSE_SUBJECT}' "
            f"ORDER BY id"
        )
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
    )


def render(name: str, fp: Fingerprint) -> str:
    return (
        f"  {name}\n"
        f"    source sha256   {(fp.source_sha256 or '—')[:16]}\n"
        f"    modules         {fp.modules}\n"
        f"    learning objs   {fp.learning_objectives}\n"
        f"    prerequisites   {fp.prerequisite_edges}\n"
        f"    questions       {fp.questions_total}  (live: {fp.questions_live})\n"
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
    return 0


if __name__ == "__main__":
    sys.exit(main())

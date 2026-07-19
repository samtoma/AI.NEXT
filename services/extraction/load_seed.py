"""Validate seed bundles and load them into Postgres with full provenance.

Usage:
  uv run load_seed.py seed/unit1.json seed/unit2.json ... [flags]
  uv run load_seed.py --all [flags]            # loads seed/*.json in name order
  uv run load_seed.py seed/unit2.json --validate-only

Flags:
  --validate-only  schema-validate only, no DB writes (for extraction agents)
  --approve-all    force ALL questions live (PoC bulk; logged as such)
  --demo-student   seed the demo student with mastery history
Question status: verified=true → live (reviewed_by='ai dual-check (pending Samuel)'),
else review. Re-running truncates and reloads all content tables.
"""
from __future__ import annotations

import hashlib
import json
import random
import sys
from pathlib import Path

from schemas import SeedBundle

HERE = Path(__file__).resolve().parent


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def validate_all(paths: list[Path]) -> list[SeedBundle]:
    bundles = []
    for p in paths:
        b = SeedBundle.model_validate_json(p.read_text())
        n_ver = sum(q.verified for q in b.questions)
        print(f"  {p.name}: {len(b.nodes)} nodes, {len(b.edges)} edges, "
              f"{len(b.questions)} questions ({n_ver} verified), {len(b.visuals)} visuals — OK")
        bundles.append(b)
    return bundles


def load(paths: list[Path], approve_all: bool, demo_student: bool) -> None:
    import psycopg
    bundles = validate_all(paths)
    first_src = next((b.source_document for b in bundles if b.source_document), None)
    if first_src is None:
        raise SystemExit("no bundle defines source_document")
    repo_root = HERE.parents[1]
    src_file = repo_root / first_src.file_path if first_src.file_path else None
    sha = sha256_of(src_file) if src_file and src_file.exists() else "sha256:unavailable"

    with psycopg.connect("dbname=ainext_poc") as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE understanding_checks, ai_interactions, explanation_log, "
                    "attempts, mastery, sessions, students, visuals, questions, "
                    "graph_edges, graph_nodes, extraction_runs, source_documents "
                    "RESTART IDENTITY CASCADE")
        s = first_src
        cur.execute(
            """INSERT INTO source_documents
               (sha256, title, publisher, edition, language, grade, subject, file_path)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
            (sha, s.title, s.publisher, s.edition, s.language, s.grade, s.subject, s.file_path))

        total_q = total_v = 0
        for b in bundles:
            run = b.extraction_run
            cur.execute(
                """INSERT INTO extraction_runs
                   (source_sha256, extractor, extractor_version, schema_version, finished_at)
                   VALUES (%s,%s,%s,%s, now()) RETURNING id""",
                (sha, run.extractor, run.extractor_version, run.schema_version))
            run_id = cur.fetchone()[0]

            for n in b.nodes:
                cur.execute(
                    """INSERT INTO graph_nodes
                       (id, kind, label, description, syllabus_ref, order_in_parent,
                        source_sha256, source_page, extraction_run_id)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (id) DO NOTHING""",
                    (n.id, n.kind, n.label, n.description, n.syllabus_ref,
                     n.order_in_parent, sha, n.source_page, run_id))
            for e in b.edges:
                cur.execute(
                    """INSERT INTO graph_edges
                       (src_id, dst_id, edge_type, syllabus_version, extraction_run_id)
                       VALUES (%s,%s,%s,%s,%s)""",
                    (e.src, e.dst, e.type, b.syllabus_version, run_id))
            for q in b.questions:
                live = approve_all or q.verified
                reviewer = ("samuel (poc bulk)" if approve_all
                            else "ai dual-check (pending Samuel)" if q.verified else None)
                cur.execute(
                    """INSERT INTO questions
                       (id, lo_id, tier, question_type, stem, choices, correct_answer,
                        canonical_solution, status, source, source_sha256, source_page,
                        source_note, extraction_run_id, reviewed_by, reviewed_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'authored',%s,%s,%s,%s,%s,
                               CASE WHEN %s THEN now() END)""",
                    (q.id, q.lo, q.tier, q.type, q.stem,
                     json.dumps([c.model_dump() for c in q.choices]) if q.choices else None,
                     q.answer,
                     json.dumps([{"step": i + 1, "text_md": t} for i, t in enumerate(q.solution)]),
                     "live" if live else "review", sha, q.source_page, q.source_note,
                     run_id, reviewer, live))
                total_q += 1
                total_v += live
            for v in b.visuals:
                cur.execute(
                    """INSERT INTO visuals
                       (id, lo_id, question_id, kind, spec, caption, source_page,
                        extraction_run_id)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (v.id, v.lo, v.question, v.kind, json.dumps(v.spec),
                     v.caption, v.source_page, run_id))

        if demo_student:
            seed_demo_student(cur)
        conn.commit()
    print(f"loaded {len(bundles)} bundles: {total_q} questions ({total_v} live)")


def seed_demo_student(cur) -> None:
    """Demo student with baseline + current mastery on every LO (weaker on later units)."""
    rng = random.Random(42)
    cur.execute("INSERT INTO students (display_name, grade) VALUES ('Omar (demo)','prep-3') "
                "RETURNING id")
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


if __name__ == "__main__":
    args = sys.argv[1:]
    flags = {a for a in args if a.startswith("--")}
    paths = [Path(a) for a in args if not a.startswith("--")]
    if "--all" in flags:
        paths = sorted((HERE / "seed").glob("*.json"))
    if not paths:
        paths = [HERE / "seed" / "unit1.json"]
    if "--validate-only" in flags:
        validate_all(paths)
        print("validation passed")
    else:
        load(paths, "--approve-all" in flags, "--demo-student" in flags)

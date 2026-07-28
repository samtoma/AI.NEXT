"""Validate seed bundles and load them into Postgres with full provenance.

Usage:
  uv run load_seed.py seed/unit1.json seed/unit2.json ... [flags]
  uv run load_seed.py --all [flags]            # loads seed/*.json in name order
  uv run load_seed.py seed/unit2.json --validate-only
  uv run load_seed.py bundles... --course course:prep3-social-ar

Flags:
  --validate-only  schema-validate only, no DB access at all (for extraction agents)
  --approve-all    force ALL questions live (PoC bulk; logged as such)
  --demo-student   seed the demo student with mastery history (full reloads only)
  --course <id>    scoped load: delete ONLY that course's subtree (modules/LOs/
                   questions/visuals via part_of+teaches walk, plus course-exclusive
                   topics) and load the given bundles additively. Other courses'
                   content is untouched. Student attempts/mastery referencing the
                   deleted content are deleted with a printed warning (PoC path).

Source documents: each bundle defines its own `source_document`, names one via
`source_file` (file_path of a doc defined earlier in the batch or already in the
DB), or inherits the previous bundle's. Multiple documents per load are supported;
rows dedupe on sha256. Every row is stamped with ITS bundle's source sha.

Question status: verified=true -> live (reviewed_by='ai dual-check (pending Samuel)'),
else review. WITHOUT --course, re-running truncates and reloads ALL content tables
(legacy single-course semantics — a loud warning fires if >1 course is in the DB).

SACRED-CONTENT GATE (ADR-0006): --approve-all HARD-REFUSES any bundle carrying
quran/hadith content, and sacred rows load as 'review' whatever the flags say.
A passage's approval is bound to its text_sha256, so one changed harakah demotes
it and everything built on it. See sacred_gate() below.
"""
from __future__ import annotations

import hashlib
import json
import random
import sys
from pathlib import Path

from arabic_text import SEALED_SENSITIVITY_CLASSES
from schemas import AR_ANSWER_BY_TYPE, ClaimStep, SeedBundle, SourceDocument

HERE = Path(__file__).resolve().parent

STUDENT_DATA_TABLES = ("attempts", "mastery", "understanding_checks", "explanation_log")


def canonical_solution_json(solution: list) -> str:
    """Serialize a Question.solution for the canonical_solution jsonb column.

    Math (list[str])       -> [{"step": n, "text_md": ...}]           (byte-compatible, unchanged)
    Social (list[ClaimStep]) -> [{"step": n, "claim_ar": ..., "evidence_page": ...,
                                  "evidence_kind": ..., "facts": [...]}]
    matching ClaimStep in app/src/lib/types.ts / fmtSteps in app/src/lib/lesson.ts.
    """
    if solution and isinstance(solution[0], ClaimStep):
        return json.dumps([
            {"step": i + 1, "claim_ar": s.claim_ar, "evidence_page": s.evidence_page,
             "evidence_kind": s.evidence_kind,
             "facts": [f.model_dump() for f in (s.facts or [])]}
            for i, s in enumerate(solution)
        ])
    return json.dumps([{"step": i + 1, "text_md": t} for i, t in enumerate(solution)])


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def doc_sha(doc: SourceDocument, repo_root: Path) -> str:
    """Content-address the source file; deterministic per-doc fallback if absent."""
    f = repo_root / doc.file_path if doc.file_path else None
    if f is not None and f.exists():
        return sha256_of(f)
    basis = f"{doc.title}|{doc.file_path or ''}"
    return "unavailable:" + hashlib.sha256(basis.encode()).hexdigest()[:32]


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
        n_sacred_q = n_unapproved_q = 0
        for q in b.questions:
            src = by_id.get(q.passage_ref or "")
            if q.sensitivity_class in SEALED_SENSITIVITY_CLASSES or (src and src.is_sacred):
                held.add(q.id)
                n_sacred_q += 1
            elif src is not None and not src.approval_valid:
                held.add(q.id)          # nobody signed the text it rests on
                n_unapproved_q += 1

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
              "  1. verbatim verification against the printed page and a trusted مصحف\n"
              "  2. pedagogical/boundary review of the شرح, the questions and the class\n"
              "Re-run without --approve-all (everything else still loads; sacred rows land as "
              "'review'), or split the sacred passages into their own bundle.")
    return held


def blocked_arabic_answers(bundles: list[SeedBundle]) -> list[str]:
    """Typed Arabic answers cannot be written to questions.correct_answer (text).

    Flattening an IrabAnswer to its surface string would load cleanly and then
    fail every student who phrased the formula differently, because the slot
    grader does not exist yet. Refuse loudly instead: the typed column and the
    scripted slot grader land together in Wave 1. --validate-only is unaffected,
    so extraction agents can still validate Arabic bundles today.
    """
    return [q.id for b in bundles for q in b.questions if q.type in AR_ANSWER_BY_TYPE]


def resolve_source_docs(
    paths: list[Path], bundles: list[SeedBundle],
    repo_root: Path, db_docs_by_path: dict[str, str],
) -> list[tuple[str, SourceDocument | None]]:
    """Per bundle: (source sha, doc-to-insert or None if it already exists in DB)."""
    resolved: list[tuple[str, SourceDocument | None]] = []
    batch_by_path: dict[str, tuple[str, SourceDocument]] = {}
    # Legacy compatibility: bundles BEFORE the first declaring bundle inherit the
    # batch's first declared document (old loader stamped everything with it).
    current: tuple[str, SourceDocument | None] | None = next(
        ((doc_sha(b.source_document, repo_root), b.source_document)
         for b in bundles if b.source_document), None)
    for p, b in zip(paths, bundles):
        if b.source_document:
            d = b.source_document
            sha = doc_sha(d, repo_root)
            if d.file_path:
                batch_by_path[d.file_path] = (sha, d)
            current = (sha, d)
        elif b.source_file:
            if b.source_file in batch_by_path:
                current = batch_by_path[b.source_file]
            elif b.source_file in db_docs_by_path:
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


def delete_course_subtree(cur, course_id: str, subtree: set[str]) -> None:
    ids = list(subtree)
    cur.execute("SELECT id FROM questions WHERE lo_id = ANY(%s)", (ids,))
    qids = [r[0] for r in cur.fetchall()] or ["__none__"]
    counts: dict[str, int] = {}

    def d(key: str, sql: str, params: tuple) -> None:
        cur.execute(sql, params)
        counts[key] = cur.rowcount

    d("explanation_log", "DELETE FROM explanation_log WHERE question_id = ANY(%s)", (qids,))
    d("attempts", "DELETE FROM attempts WHERE question_id = ANY(%s)", (qids,))
    d("mastery", "DELETE FROM mastery WHERE lo_id = ANY(%s)", (ids,))
    d("understanding_checks", "DELETE FROM understanding_checks WHERE lo_id = ANY(%s)", (ids,))
    d("visuals", "DELETE FROM visuals WHERE lo_id = ANY(%s) OR question_id = ANY(%s)",
      (ids, qids))
    d("questions", "DELETE FROM questions WHERE id = ANY(%s)", (qids,))
    # Preserve cross-subject 'relates_to' bridges: a bridge has one endpoint in
    # another course, so a scoped reload must not delete it (see db/bridges.sql).
    d("edges", "DELETE FROM graph_edges WHERE (src_id = ANY(%s) OR dst_id = ANY(%s)) "
      "AND edge_type <> 'relates_to'", (ids, ids))
    d("nodes", "DELETE FROM graph_nodes WHERE id = ANY(%s)", (ids,))

    print(f"--course {course_id}: replaced subtree of {counts['nodes']} nodes, "
          f"{counts['edges']} edges, {counts['questions']} questions, {counts['visuals']} visuals")
    student_rows = {t: counts[t] for t in STUDENT_DATA_TABLES if counts.get(t)}
    if student_rows:
        detail = ", ".join(f"{n} {t}" for t, n in student_rows.items())
        print(f"  WARNING: deleted student data referencing removed content: {detail}")
        print("  (PoC-only destructive path — v2 must archive, not delete)")


def load(paths: list[Path], approve_all: bool, demo_student: bool,
         course: str | None = None) -> None:
    import psycopg
    bundles = validate_all(paths)
    held = sacred_gate(paths, bundles, approve_all)   # may exit non-zero (ADR-0006)
    if pending := blocked_arabic_answers(bundles):
        raise SystemExit(
            f"{len(pending)} question(s) carry a typed Arabic answer "
            f"({', '.join(pending[:4])}{' …' if len(pending) > 4 else ''}).\n"
            "questions.correct_answer is a text column and the scripted slot grader does not "
            "exist yet — storing the surface string would load fine and then mark correct "
            "students wrong. The typed column + grader land together in Wave 1.\n"
            "Use --validate-only until then.")
    repo_root = HERE.parents[1]

    with psycopg.connect("dbname=ainext_poc") as conn, conn.cursor() as cur:
        # --- resolve source documents (against DB docs only in scoped mode:
        #     full-truncate mode wipes source_documents, so DB docs can't be reused)
        db_docs_by_path: dict[str, str] = {}
        if course:
            cur.execute("SELECT file_path, sha256 FROM source_documents")
            db_docs_by_path = {fp: sha for fp, sha in cur.fetchall() if fp}
        resolved = resolve_source_docs(paths, bundles, repo_root, db_docs_by_path)

        # --- pre-flight checks + scope preparation (all before any write)
        if course:
            cur.execute("SELECT id FROM graph_nodes")
            db_ids = {r[0] for r in cur.fetchall()}
            subtree = course_subtree(cur, course) if course in db_ids else set()
            batch_ids = {n.id for b in bundles for n in b.nodes}
            if course not in batch_ids and course not in subtree:
                raise SystemExit(f"--course {course}: node not defined in bundles nor in DB")
            # id-namespace hygiene: a bundle may not redefine another course's nodes
            collisions = sorted(batch_ids & (db_ids - subtree))
            if collisions:
                raise SystemExit(
                    f"node id collision with content OUTSIDE course {course}: "
                    f"{', '.join(collisions[:10])}{' ...' if len(collisions) > 10 else ''}")
            survivors = db_ids - subtree  # live DB nodes external refs may resolve against
        else:
            cur.execute("SELECT id FROM graph_nodes WHERE kind='course'")
            db_courses = [r[0] for r in cur.fetchall()]
            if len(db_courses) > 1:
                print("!" * 72)
                print(f"!! FULL-TRUNCATE MODE with {len(db_courses)} courses in DB: "
                      f"{', '.join(db_courses)}")
                print("!! This WIPES ALL of them. Use --course <course-node-id> to reload")
                print("!! a single course without touching the others.")
                print("!" * 72)
            survivors = set()

        # external refs must resolve against ANY bundle in the batch or live DB rows
        # (batch is order-independent: nodes all land before any edge, see below)
        all_batch_ids = {n.id for b in bundles for n in b.nodes}
        resolvable = survivors | all_batch_ids
        for p, b in zip(paths, bundles):
            missing = [r for r in b.external_node_refs if r not in resolvable]
            if missing:
                raise SystemExit(f"{p.name}: external_node_refs not found in batch or DB: "
                                 f"{', '.join(missing)}")

        # --- writes (single transaction: any failure rolls everything back)
        if course:
            if subtree:
                delete_course_subtree(cur, course, subtree)
        else:
            cur.execute("TRUNCATE understanding_checks, ai_interactions, explanation_log, "
                        "attempts, mastery, sessions, students, visuals, questions, "
                        "graph_edges, graph_nodes, extraction_runs, source_documents "
                        "RESTART IDENTITY CASCADE")

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
            inserted_shas.add(sha)

        total_q = total_v = 0
        deferred_edges: list[tuple] = []  # edges may cross bundles; insert after all nodes
        for b, (sha, _) in zip(bundles, resolved):
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
                deferred_edges.append((e.src, e.dst, e.type, b.syllabus_version, run_id))
            for q in b.questions:
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
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'authored',%s,%s,%s,%s,%s,
                               CASE WHEN %s THEN now() END)""",
                    (q.id, q.lo, q.tier, q.type, q.stem,
                     json.dumps([c.model_dump() for c in q.choices]) if q.choices else None,
                     q.answer,
                     canonical_solution_json(q.solution),
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

        for row in deferred_edges:
            cur.execute(
                """INSERT INTO graph_edges
                   (src_id, dst_id, edge_type, syllabus_version, extraction_run_id)
                   VALUES (%s,%s,%s,%s,%s)""", row)

        if demo_student:
            seed_demo_student(cur)
        conn.commit()
    scope = f" [scoped to {course}]" if course else ""
    print(f"loaded {len(bundles)} bundles{scope}: {total_q} questions ({total_v} live)")


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
    args = iter(sys.argv[1:])
    flags: set[str] = set()
    paths: list[Path] = []
    course: str | None = None
    for a in args:
        if a == "--course":
            course = next(args, None)
            if not course or course.startswith("--"):
                raise SystemExit("--course requires a course node id (e.g. course:prep3-social-ar)")
        elif a.startswith("--"):
            flags.add(a)
        else:
            paths.append(Path(a))
    if "--all" in flags:
        paths = sorted((HERE / "seed").glob("*.json"))
    if not paths:
        paths = [HERE / "seed" / "unit1.json"]
    if "--validate-only" in flags:
        bundles = validate_all(paths)  # deliberately DB-free: no collision/external-ref DB checks
        # Run the gate here too: `--validate-only --approve-all` must not report
        # a clean bill of health for a load that would be refused.
        sacred_gate(paths, bundles, "--approve-all" in flags)
        print("validation passed")
    else:
        if course and "--demo-student" in flags:
            raise SystemExit("--demo-student is for full reloads only (it seeds mastery on "
                             "every LO in the DB); do not combine with --course")
        load(paths, "--approve-all" in flags, "--demo-student" in flags, course)

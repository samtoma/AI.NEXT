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
  --all            every SeedBundle in seed/, in dependency order. Combined with
                   --course, only that course's bundles (see bundles_for_course) —
                   which is the one-argument way to refresh a whole course.
  --dry-run        do the entire load against the real database inside a
                   transaction, print the before/after delta, then ROLL BACK.
                   The honest preview: same checks, same gate, no writes.

Database: connection comes from $AINEXT_DB_DSN, else $DATABASE_URL, else the local
`dbname=ainext_poc`. The resolved target (user@host/db, never the password) is printed
before anything is written — read it before you answer "yes".

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
import os
import random
import sys
from pathlib import Path

from arabic_text import SEALED_SENSITIVITY_CLASSES
from schemas import AR_ANSWER_BY_TYPE, ClaimStep, SeedBundle, SourceDocument

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
    if known_by_path and doc.file_path and doc.file_path in known_by_path:
        sha = known_by_path[doc.file_path]
        print(f"  {doc.file_path}: source file not present here — reusing the sha256 this "
              f"database already records for it ({sha[:12]}…)")
        return sha
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


# --all load order. NOT alphabetical: a bundle with neither `source_document`
# nor `source_file` INHERITS the previous bundle's document (see
# resolve_source_docs), so the document-declaring bundle of each book must come
# first. Alphabetically `geo-unit1.json` sorts first and inherits — which made
# `--all` die with "no source_document/source_file and no earlier bundle to
# inherit from" even once non-bundle files were filtered out.
# Order within each book also follows the documented cross-reference chain
# (unit1 -> ... -> geo-unit2b); external_node_refs resolve against the whole
# batch, but the source-document chain is strictly positional.
BUNDLE_ORDER = [
    # math — unit1 declares the ministry maths document; the rest inherit it
    "unit1.json", "unit2.json", "unit3.json", "unit4.json", "unit5.json",
    "geo-unit1.json", "t2-unit12.json", "t2-unit3.json",
    "geo-unit2a.json", "geo-unit2b.json",
    # social — skeleton declares the social document, social-t1 reuses it by
    # source_file. social-t1 supersedes the skeleton's two lessons on load.
    "social-skeleton.json", "social-t1.json",
]


# Bundles that a later bundle REPLACES. Supersession is invisible to the loader
# otherwise: `social-t1.json` redefines all 15 of the skeleton's nodes (so nodes
# dedupe), but its 762 questions carry different ids from the skeleton's 44
# hand-authored ones, so loading both ADDS the superseded questions back instead
# of replacing them. The deployed database holds 762 social questions, i.e.
# social-t1 alone — this map is what lets a course refresh reproduce that.
# Keep the file for history; put its replacement here.
SUPERSEDED_BY = {
    "social-skeleton.json": "social-t1.json",
}


def all_bundle_paths() -> list[Path]:
    """seed/*.json that are actually SeedBundles, in dependency order.

    seed/ also holds non-bundle artefacts (social-skeleton-traps.json is a QA
    containment set: `_meta` + `traps`). Globbing them fed a non-bundle to
    Pydantic and killed `--all` before it reached the DB. Mirrors the filter in
    selfcheck_arabic.check_shipped_bundles.
    """
    seed = HERE / "seed"
    found = sorted(seed.glob("*.json"))
    bundles = [p for p in found if '"extraction_run"' in p.read_text()]
    skipped = [p.name for p in found if p not in bundles]
    if skipped:
        print(f"--all: skipped {len(skipped)} non-bundle file(s): {', '.join(skipped)}")

    known = {p.name: p for p in bundles}
    ordered = [known.pop(n) for n in BUNDLE_ORDER if n in known]
    # anything new in seed/ that nobody listed: load it last, but say so loudly
    # rather than dropping it silently (the failure mode this whole fix is about)
    for name in sorted(known):
        print(f"--all: WARNING {name} is not in BUNDLE_ORDER — appending last; "
              "add it to BUNDLE_ORDER if it declares or inherits a source document")
        ordered.append(known[name])
    return ordered


def warn_superseded(paths: list[Path]) -> None:
    """Unscoped `--all` keeps its legacy meaning: every file in seed/. Say what that costs."""
    names = {p.name for p in paths}
    for old, new in SUPERSEDED_BY.items():
        if old in names and new in names:
            print(f"--all: WARNING loading {old} AND its replacement {new}. Their question ids "
                  f"differ, so the superseded ones are ADDED, not replaced. "
                  f"`--all --course <id>` excludes superseded bundles; unscoped `--all` "
                  f"keeps its legacy 'every file in seed/' meaning.")


def bundles_for_course(course_id: str, paths: list[Path] | None = None) -> list[Path]:
    """The bundles that build `course_id`, in dependency order.

    A course refresh must load EVERY bundle of that course: `--course` first
    deletes the course subtree, so a bundle left off the command line is content
    deleted and not put back. Nobody should have to remember that
    `course:prep3-math-en` means ten files in a particular order at midnight —
    so derive it from the bundles themselves rather than from a hand-kept list.

    Membership is structural: walk `part_of` DOWN from the course across the
    union of all bundles (a module declares `module:u3 part_of course:...`),
    add what those nodes `teaches`, then keep every bundle that defines at
    least one node in the resulting subtree.
    """
    paths = paths if paths is not None else all_bundle_paths()
    defines: dict[Path, set[str]] = {}
    children: dict[str, set[str]] = {}      # parent -> part_of children
    teaches: dict[str, set[str]] = {}       # teacher -> taught LOs
    for p in paths:
        d = json.loads(p.read_text())
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

    selected = [p for p in paths if defines[p] & subtree]
    names = {p.name for p in selected}
    for old, new in SUPERSEDED_BY.items():
        if old in names and new in names:
            selected = [p for p in selected if p.name != old]
            print(f"  {old}: superseded by {new} — excluded (its questions were replaced, "
                  f"not merged; see SUPERSEDED_BY)")
    if not selected:
        raise SystemExit(
            f"--all --course {course_id}: no bundle in seed/ defines any node under that "
            f"course. Check the id (courses seen: "
            f"{', '.join(sorted({n for s in defines.values() for n in s if n.startswith('course:')})) or 'none'}).")
    print(f"--all --course {course_id}: {len(selected)} of {len(paths)} bundle(s) belong to "
          f"this course — {', '.join(p.name for p in selected)}")
    return selected


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


# Columns carried across a scoped reload when a cross-subject bridge is detached
# and re-attached. Deliberately includes the temporal columns: a bridge that
# survives a reload must keep the day it was drawn, not claim to be new.
BRIDGE_COLS = ("src_id", "dst_id", "edge_type", "syllabus_version", "valid_from",
               "valid_to", "system_from", "system_to", "extraction_run_id", "rationale")


def restore_bridges(cur, saved: list[tuple]) -> None:
    """Re-attach the cross-subject bridges detached by delete_course_subtree.

    Call AFTER every node of the batch is in. A bridge whose endpoint the new
    bundles no longer define cannot be re-attached — say so loudly instead of
    letting it disappear quietly; `db/bridges.sql` is the place to re-curate it.
    """
    if not saved:
        return
    endpoints = {e for row in saved for e in (row[0], row[1])}
    cur.execute("SELECT id FROM graph_nodes WHERE id = ANY(%s)", (list(endpoints),))
    present = {r[0] for r in cur.fetchall()}
    cur.execute("SELECT src_id, dst_id FROM graph_edges WHERE edge_type='relates_to'")
    already = {(s, d) for s, d in cur.fetchall()}
    kept = 0
    for row in saved:
        src, dst = row[0], row[1]
        if src not in present or dst not in present:
            missing = [e for e in (src, dst) if e not in present]
            print(f"  WARNING: cross-subject bridge {src} ↔ {dst} NOT restored — "
                  f"{', '.join(missing)} no longer exists in the reloaded content. "
                  f"Re-curate it in db/bridges.sql if it should survive.")
            continue
        if (src, dst) in already:
            continue
        cur.execute(
            f"INSERT INTO graph_edges ({','.join(BRIDGE_COLS)}) "
            f"VALUES ({','.join(['%s'] * len(BRIDGE_COLS))})", row)
        kept += 1
    if kept:
        print(f"  re-attached {kept} cross-subject bridge(s) with their original "
              f"rationale and valid-from date")


def delete_course_subtree(cur, course_id: str, subtree: set[str]) -> list[tuple]:
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

    # Cross-subject 'relates_to' bridges (db/bridges.sql) have one endpoint in
    # ANOTHER course, so they must survive a scoped reload — but keeping the ROW
    # while deleting the node it points at is impossible: graph_edges FKs both
    # endpoints, so the node DELETE below simply failed (this is the bug that made
    # every social reload need a manual drop → load → re-apply bridges.sql).
    # Detach them, remember them verbatim, and re-attach after the reload.
    cur.execute(
        f"SELECT {','.join(BRIDGE_COLS)} FROM graph_edges WHERE edge_type='relates_to' "
        "AND (src_id = ANY(%s) OR dst_id = ANY(%s))", (ids, ids))
    saved_bridges = cur.fetchall()

    d("edges", "DELETE FROM graph_edges WHERE src_id = ANY(%s) OR dst_id = ANY(%s)", (ids, ids))
    d("nodes", "DELETE FROM graph_nodes WHERE id = ANY(%s)", (ids,))

    print(f"--course {course_id}: replaced subtree of {counts['nodes']} nodes, "
          f"{counts['edges']} edges, {counts['questions']} questions, {counts['visuals']} visuals"
          + (f" (detached {len(saved_bridges)} cross-subject bridge(s) for re-attachment)"
             if saved_bridges else ""))
    student_rows = {t: counts[t] for t in STUDENT_DATA_TABLES if counts.get(t)}
    if student_rows:
        detail = ", ".join(f"{n} {t}" for t, n in student_rows.items())
        print(f"  WARNING: deleted student data referencing removed content: {detail}")
        print("  (PoC-only destructive path — v2 must archive, not delete)")
    return saved_bridges


SNAPSHOT_SQL = """
SELECT (SELECT count(*) FROM graph_nodes),
       (SELECT count(*) FROM graph_edges),
       (SELECT count(*) FROM graph_edges WHERE edge_type='relates_to'),
       (SELECT count(*) FROM questions),
       (SELECT count(*) FROM questions WHERE status='live'),
       (SELECT count(*) FROM questions WHERE status='review'),
       (SELECT count(*) FROM visuals),
       (SELECT count(*) FROM source_documents)
"""
SNAPSHOT_LABELS = ("nodes", "edges", "bridges", "questions", "LIVE questions",
                   "review questions", "visuals", "source documents")


def print_delta(before: tuple, after: tuple) -> None:
    """What this load actually changed — the line a human reads before saying yes."""
    print("\nwhat changed:")
    for label, b, a in zip(SNAPSHOT_LABELS, before, after):
        mark = "" if a == b else f"   {a - b:+d}"
        print(f"  {label:<18} {b:>6} -> {a:>6}{mark}")
    if after[4] < before[4]:
        print(f"\n  !! {before[4] - after[4]} question(s) LEFT the live set. Questions go live only "
              f"when the bundle marks them verified;\n     anything promoted in the past by "
              f"--approve-all lands back in 'review' here. That is the gate working —\n"
              f"     but it IS a visible content change. Restore the pre-load backup if it was "
              f"not what you wanted.")


def load(paths: list[Path], approve_all: bool, demo_student: bool,
         course: str | None = None, dry_run: bool = False) -> None:
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

    dsn = db_dsn()
    print(f"target database: {describe_dsn(dsn)}"
          + ("" if dsn == DEFAULT_DSN else "   [from environment]")
          + ("   *** DRY RUN — the transaction will be rolled back ***" if dry_run else ""))
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(SNAPSHOT_SQL)
        before = cur.fetchone()
        # --- resolve source documents. Known shas are read for BOTH modes (they keep
        #     a document's identity stable where its file is absent — see doc_sha),
        #     but only a scoped load may skip an insert on the strength of a DB row:
        #     full-truncate mode is about to wipe source_documents.
        cur.execute("SELECT file_path, sha256 FROM source_documents")
        db_docs_by_path = {fp: sha for fp, sha in cur.fetchall() if fp}
        resolved = resolve_source_docs(paths, bundles, repo_root, db_docs_by_path,
                                       reuse_db_rows=bool(course))

        # --- pre-flight checks + scope preparation (all before any write)
        if course:
            cur.execute("SELECT id FROM graph_nodes")
            db_ids = {r[0] for r in cur.fetchall()}
            subtree = course_subtree(cur, course) if course in db_ids else set()
            batch_ids = {n.id for b in bundles for n in b.nodes}
            if course not in batch_ids and course not in subtree:
                raise SystemExit(f"--course {course}: node not defined in bundles nor in DB")
            # id-namespace hygiene: a bundle may not redefine another course's nodes.
            # Shared ancestors (the program root every course hangs off) are exempt —
            # see course_ancestors.
            shared = course_ancestors(cur, course) if course in db_ids else set()
            collisions = sorted(batch_ids & (db_ids - subtree - shared))
            if collisions:
                raise SystemExit(
                    f"node id collision with content OUTSIDE course {course}: "
                    f"{', '.join(collisions[:10])}{' ...' if len(collisions) > 10 else ''}")
            if redeclared := sorted(batch_ids & shared):
                print(f"  shared ancestor(s) re-declared by these bundles: "
                      f"{', '.join(redeclared)} — kept as-is (ON CONFLICT DO NOTHING)")
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
        saved_bridges: list[tuple] = []
        if course:
            if subtree:
                saved_bridges = delete_course_subtree(cur, course, subtree)
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

        restore_bridges(cur, saved_bridges)   # every node of the batch is in by now

        if demo_student:
            seed_demo_student(cur)

        cur.execute(SNAPSHOT_SQL)
        print_delta(before, cur.fetchone())
        if dry_run:
            conn.rollback()
            print("\nDRY RUN: transaction rolled back — the database is untouched.\n"
                  "Everything above (validation, the sacred gate, collision checks, the "
                  "live/review split) ran for real against real data.")
            return
        conn.commit()
    scope = f" [scoped to {course}]" if course else ""
    print(f"loaded {len(bundles)} bundles{scope}: {total_q} questions ({total_v} live)")
    # The review gate, stated out loud on every load: whatever did not clear
    # verification is in the database but unreachable by a student.
    held_back = total_q - total_v
    print(f"review gate: {held_back} question(s) landed as status='review' — not served to "
          f"any student until a human promotes them"
          + ("" if not approve_all else "   [--approve-all was used: PoC bulk approval]"))


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
        if paths:
            raise SystemExit("--all takes no bundle paths (it IS the path list)")
        paths = all_bundle_paths()
        if course:
            # "refresh this whole course" — the only safe meaning of --all when a
            # scope is set, since --course deletes the subtree before loading.
            paths = bundles_for_course(course, paths)
        else:
            warn_superseded(paths)
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
        load(paths, "--approve-all" in flags, "--demo-student" in flags, course,
             dry_run="--dry-run" in flags)

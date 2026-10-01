"""Load a book's OUTLINE — every chapter and lesson, in reading order — into course_outline.

    uv run load_course_outline.py --book g10-math              # write the outline
    uv run load_course_outline.py --book g10-math --dry-run    # the honest preview: write, report, roll back
    uv run load_course_outline.py --book g10-math --check      # build the rows from the manifest, no database

WHY (Samuel, 2026-10-01: "I want the students to see all chapters as well not only 8!")
A student sees the whole book, in order, before every chapter has been through the teaching
pipeline. The book's STRUCTURE is known from its Stage-0 manifest (gate G0); its CONTENT
reaches the database one chapter at a time through load_seed.py. This loader writes the
structure to `course_outline` (migration 037) and nothing else.

READINESS IS NOT WRITTEN HERE, and that is the design. A lesson is prepared exactly when its
objectives are loaded — the rule that has always decided what a lesson is
(app/src/lib/lesson.ts `getLessonCatalog`) — and the app derives it at read time
(app/src/lib/course-outline.ts). So the fan-out needs no extra step: once load_seed.py loads a
chapter, its lessons become startable, with no change to this table and no code change.

WHAT A ROW IS. One per manifest lesson, in the manifest's order (chapters by order_in_parent,
lessons by order_in_module — the same walk assemble_lesson_bundle.py makes):
    module_id / module_label / module_order   the module node the chapter becomes when loaded,
                                              labelled as assemble_lesson_bundle.py labels it
    book_order                                its place in the whole book, 1…N
    title, sections, section_titles, part_n, part_of, chapter_intro, group_key
                                              its book provenance, through the SAME function the
                                              content assembly uses (`book_lesson`), so the
                                              columns match course_lessons (034) exactly once the
                                              lesson is loaded — checked below, reported on drift
    page_from / page_to                       its printed pages
    source                                    the manifest and its gate

THE LOAD. One transaction. The course's outline is made EXACTLY the manifest's: missing rows
are inserted, differing rows updated, rows the manifest no longer lists deleted. That is safe
because nothing references an outline row — no student data, no content — and a prepared
lesson stays prepared whatever this table says. Re-running with an unchanged manifest writes
nothing. Only a manifest whose lesson unit passed its gate (G0) is accepted: an ungated
manifest is a proposal, not the book's structure.

Course isolation: the rows carry the book config's course id and are read by the app only for
courses the student may see. Content, not student data: no environment column (034's rule —
the database is the environment).

Database: $AINEXT_DB_DSN, else $DATABASE_URL, else the local `dbname=ainext_poc` (load_seed.py's
rule, the same function). The target (never the password) is printed before anything is written.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import book_config
from assemble_lesson_bundle import book_lesson, manifest_lessons
from load_seed import DEFAULT_DSN, db_dsn, describe_dsn

TABLE = "course_outline"
FIELDS = ("module_id", "module_label", "module_order", "book_order", "title", "sections",
          "section_titles", "part_n", "part_of", "chapter_intro", "group_key", "page_from",
          "page_to", "source")
# The book-provenance columns course_lessons (034) also holds — compared on drift.
PROVENANCE = ("title", "sections", "section_titles", "part_n", "part_of", "chapter_intro",
              "group_key")


class OutlineError(SystemExit):
    pass


def module_label(mod: dict) -> str:
    """The label the chapter's module node takes when it is loaded (assemble_chapter's rule)."""
    return f"Chapter {mod['chapter']} — {mod['title']}"


def gate_passed(manifest: dict) -> str | None:
    """The date the manifest's lesson unit passed its gate, or None."""
    gate = (manifest.get("lesson_unit") or {}).get("gate") or {}
    return gate.get("passed") or None


def outline_rows(book, manifest: dict, manifest_rel: str, manifest_sha: str) -> list[dict]:
    """Every lesson of the manifest as a course_outline row, in reading order."""
    mb = manifest.get("book") or {}
    if mb.get("course_id") and mb["course_id"] != book.course_id:
        raise OutlineError(f"REFUSING: the manifest is for {mb['course_id']}, the book config "
                           f"{book.book} for {book.course_id}. Nothing was changed.")
    passed = gate_passed(manifest)
    if not passed:
        raise OutlineError(f"REFUSING: {manifest_rel} has not passed its lesson-unit gate "
                           "(lesson_unit.gate.passed is empty). An ungated manifest is not the "
                           "book's structure yet. Nothing was changed.")
    source = f"{manifest_rel} (sha256 {manifest_sha[:12]}…, G0 passed {passed})"
    rows: list[dict] = []
    seen: set[str] = set()
    for i, (mod, les) in enumerate(manifest_lessons(manifest), start=1):
        lesson = book_lesson(mod, les)   # validates the slug and derives the group key
        if lesson.slug in seen:
            raise OutlineError(f"REFUSING: lesson {lesson.slug} appears twice in {manifest_rel}.")
        seen.add(lesson.slug)
        pages = les.get("printed_pages") or [None, None]
        rows.append({
            "lesson_slug": lesson.slug,
            "module_id": mod["id"],
            "module_label": module_label(mod),
            "module_order": int(mod.get("order_in_parent") or mod["chapter"]),
            "book_order": i,
            "title": lesson.title,
            "sections": [s.number for s in lesson.sections],
            "section_titles": [s.title for s in lesson.sections],
            "part_n": lesson.part.n if lesson.part else None,
            "part_of": lesson.part.of if lesson.part else None,
            "chapter_intro": lesson.chapter_intro,
            "group_key": lesson.group_key,
            "page_from": pages[0],
            "page_to": pages[1] if len(pages) > 1 else None,
            "source": source,
        })
    if not rows:
        raise OutlineError(f"REFUSING: {manifest_rel} lists no lessons. Nothing was changed.")
    return rows


def read_manifest(book) -> tuple[dict, str, str]:
    if not book.manifest:
        raise OutlineError(f"REFUSING: book config {book.book} names no manifest.")
    path = book.repo_path(book.manifest)
    if not path.exists():
        raise OutlineError(f"REFUSING: the manifest {book.manifest} is not on this machine.")
    raw = path.read_bytes()
    return json.loads(raw), book.manifest, hashlib.sha256(raw).hexdigest()


def table_present(cur) -> bool:
    cur.execute("SELECT to_regclass(%s) IS NOT NULL", (f"public.{TABLE}",))
    return cur.fetchone()[0]


def sync(cur, course: str, rows: list[dict]) -> dict[str, list[str]]:
    """Make the course's outline exactly `rows`. Returns slugs by what happened to them."""
    cur.execute(f"SELECT lesson_slug, {', '.join(FIELDS)} FROM {TABLE} WHERE course_id = %s",
                (course,))
    have = {r[0]: dict(zip(FIELDS, r[1:])) for r in cur.fetchall()}
    done: dict[str, list[str]] = {"added": [], "updated": [], "unchanged": [], "removed": []}
    want = {r["lesson_slug"] for r in rows}
    gone = sorted(set(have) - want)
    # Removed first, and every moved row is parked out of the way before it is
    # written: book_order is unique per course, so an insert or an update that takes
    # an order another row still holds would collide mid-sync.
    if gone:
        cur.execute(f"DELETE FROM {TABLE} WHERE course_id = %s AND lesson_slug = ANY(%s)",
                    (course, gone))
        done["removed"] = gone
    moving = sorted(r["lesson_slug"] for r in rows if r["lesson_slug"] in have
                    and have[r["lesson_slug"]]["book_order"] != r["book_order"])
    if moving:
        cur.execute(f"UPDATE {TABLE} SET book_order = book_order + 1000000 "
                    "WHERE course_id = %s AND lesson_slug = ANY(%s)", (course, moving))
    for r in rows:
        slug = r["lesson_slug"]
        old = have.get(slug)
        if old is None:
            cur.execute(
                f"""INSERT INTO {TABLE} (course_id, lesson_slug, {', '.join(FIELDS)})
                    VALUES (%s, %s, {', '.join(['%s'] * len(FIELDS))})""",
                (course, slug, *(r[f] for f in FIELDS)))
            done["added"].append(slug)
        elif any(old[f] != r[f] for f in FIELDS) or slug in moving:
            cur.execute(
                f"""UPDATE {TABLE} SET {', '.join(f'{f} = %s' for f in FIELDS)}, loaded_at = now()
                     WHERE course_id = %s AND lesson_slug = %s""",
                (*(r[f] for f in FIELDS), course, slug))
            done["updated"].append(slug)
        else:
            done["unchanged"].append(slug)
    return done


def provenance_drift(cur, course: str, rows: list[dict]) -> list[str]:
    """Lessons already loaded whose course_lessons provenance differs from the outline's.

    Reported, never fixed here: course_lessons is load_seed.py's. A difference means the
    manifest and the loaded bundle disagree about a lesson, and the student would see one name
    while it is being prepared and another once it is loaded."""
    cur.execute("SELECT to_regclass('public.course_lessons') IS NOT NULL")
    if not cur.fetchone()[0]:
        return []
    cur.execute(f"SELECT lesson_slug, {', '.join(PROVENANCE)} FROM course_lessons "
                "WHERE course_id = %s", (course,))
    loaded = {r[0]: dict(zip(PROVENANCE, r[1:])) for r in cur.fetchall()}
    out = []
    for r in rows:
        old = loaded.get(r["lesson_slug"])
        if old is None:
            continue
        diff = [f for f in PROVENANCE if old[f] != r[f]]
        if diff:
            out.append(f"{r['lesson_slug']} ({', '.join(diff)})")
    return out


def prepared(cur, course: str) -> set[str]:
    """Lessons of the course with objectives loaded — the app's readiness rule, for the report."""
    cur.execute(
        """SELECT DISTINCT regexp_replace(substr(lo.id, 4), '-[0-9]+$', '')
             FROM graph_nodes lo
             JOIN graph_edges e ON e.dst_id = lo.id AND e.edge_type = 'teaches' AND e.system_to IS NULL
             JOIN graph_nodes m ON m.id = e.src_id AND m.kind = 'module'
             JOIN graph_edges ec ON ec.src_id = m.id AND ec.edge_type = 'part_of' AND ec.system_to IS NULL
            WHERE lo.kind = 'learning_objective' AND ec.dst_id = %s""", (course,))
    return {r[0] for r in cur.fetchall()}


def load(book_name: str, dry_run: bool = False, check: bool = False) -> dict[str, list[str]]:
    book = book_config.load_book(book_name)
    manifest, manifest_rel, sha = read_manifest(book)
    rows = outline_rows(book, manifest, manifest_rel, sha)
    chapters = len({r["module_id"] for r in rows})
    print(f"{book.course_id}: {chapters} chapter(s), {len(rows)} lesson(s) from {manifest_rel}")
    if check:
        for r in rows:
            print(f"  {r['book_order']:>3}  {r['lesson_slug']:<12} {r['module_label']}  ·  "
                  f"{', '.join(r['sections'])} {r['title']}"
                  + (f"  (part {r['part_n']} of {r['part_of']})" if r["part_n"] else ""))
        return {}

    import psycopg
    dsn = db_dsn()
    print(f"target database: {describe_dsn(dsn)}"
          + ("" if dsn == DEFAULT_DSN else "   [from environment]")
          + ("   *** DRY RUN — the transaction will be rolled back ***" if dry_run else ""))
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        if not table_present(cur):
            raise OutlineError(f"REFUSING: {TABLE} (migration 037) does not exist here. Apply it "
                               "first. Nothing was changed.")
        done = sync(cur, book.course_id, rows)
        drift = provenance_drift(cur, book.course_id, rows)
        ready = prepared(cur, book.course_id)
        listed = {r["lesson_slug"] for r in rows}
        stray = sorted(ready - listed)
        for k in ("added", "updated", "unchanged", "removed"):
            print(f"  {k:<10} {len(done[k]):>3}"
                  + (f"   {', '.join(done[k][:8])}{' …' if len(done[k]) > 8 else ''}"
                     if done[k] and k != "unchanged" else ""))
        print(f"  prepared   {len(ready & listed):>3} of {len(rows)} (objectives loaded; derived, "
              "not stored)")
        if drift:
            print(f"  WARNING: {len(drift)} loaded lesson(s) are named differently in "
                  f"course_lessons than in the manifest: {', '.join(drift)}")
        if stray:
            print(f"  WARNING: {len(stray)} loaded lesson(s) of {book.course_id} are not in the "
                  f"outline and will be listed after it: {', '.join(stray)}")
        if dry_run:
            conn.rollback()
            print("dry run: rolled back, nothing written")
        else:
            conn.commit()
    return done


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--book", required=True, help="book config name (books/<name>.json)")
    ap.add_argument("--dry-run", action="store_true", help="write, report, then roll back")
    ap.add_argument("--check", action="store_true", help="build the rows only; no database")
    a = ap.parse_args(argv)
    load(a.book, dry_run=a.dry_run, check=a.check)
    return 0


if __name__ == "__main__":
    sys.exit(main())

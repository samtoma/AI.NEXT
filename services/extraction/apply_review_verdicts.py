"""Apply a human reviewer's verdicts: G3 on a generated bundle, or G2 on a book's own questions.

    uv run apply_review_verdicts.py verdicts.json [--dry-run]                      # G3 (generated)
    uv run apply_review_verdicts.py --g2 runs/<book>/g2.json --book <book> [--dry-run]   # G2 (book)

The input names a reviewer and a verdict per sampled question:

    {"bundle": "...", "reviewer": "Samuel Toma",
     "verdicts": {"q:u1-1-1:g002-equali": "accept", ...}}

WHAT A VERDICT REACHES. Under the template-family model an item is not an
island: every member of a family shares one structure and differs only in its
sampled numbers, and the answer key is computed by the code that writes the
stem. That is the whole reason a 10% sample is a control rather than a gesture
(ADR-0008) — so a verdict has to travel to the family, or the review buys
nothing beyond the items read.

Travelling, though, is not the same as pretending. Two distinct stamps:

    <reviewer> (sampled)                     a human read THIS item
    <reviewer> (family <tpl> via <qid>)      a human read its family's sample

Collapsing those into one would put "checked by a human" on 478 items nobody
opened. Keeping them apart costs one string and keeps `/admin/content` honest,
which is the only reason that screen is worth having.

REJECT RETIRES THE FAMILY. A defect in a template is a defect in every
instance, so a rejection pulls the whole family out of `live` rather than the
single item. That rule was left open in ADR-0008 pending the first rejection;
it is implemented here as the proposal, and the ADR should be amended to ratify
or replace it the first time it actually fires.

"Needs a fix" is deliberately narrower: it pulls only the named item back to
`review` and leaves its family serving, because a fix usually means wording on
one instance rather than a broken template. If the reviewer meant the template,
they should reject it.

G2, THE BOOK'S OWN QUESTIONS (integration backlog 3; extraction-pipeline.md §3.13). Samuel's
verdicts on the three-way disagreements, the items with no printed answer and the sample of
EPUB solutions live in one committed file, the same one `assemble_objectives.py lesson-runs --g2`
reads to put them on the lesson runs:

    {"by": "Samuel", "items": {"<lesson>:<ref>": {"verdict": "accept"|"fix"|"hold"|"exclude",
                                                   "note": "…", "fields": {…}}}}

Until now the stamp stopped at the run files: the loader stamps every verified book question
"ai dual-check (pending Samuel)", so the database never said a human read one. `--g2` carries
the verdicts to the rows, by the question id the assembler minted from the item's own objective
and place in the book (the run files under runs/<book>/lesson/ say which objective):

    accept, fix  status 'live', reviewed_by '<by> (G2 accept|fix)'
    hold         status 'review', reviewed_by '<by> (G2 hold)'
    exclude      the item is not a question row; a row loaded earlier goes to 'rejected'
A not-markable item is a worked example, not a question row, and is reported, never invented.
It only ever touches the book's own rows (source 'seed') of the book's course, never deletes
one, and re-running it changes nothing: it is a replay of the committed file.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

VALID = {"accept", "reject", "fix"}


G2_VERDICTS = {"accept", "fix", "hold", "exclude"}


def g2_targets(g2: dict, runs_dir: Path) -> tuple[list[dict], list[str]]:
    """Each G2 verdict with the question id it lands on (the assembler's own minting), and the
    problems that stop the whole apply (an unknown lesson or item, an unknown verdict)."""
    from assemble_lesson_bundle import LessonRun
    targets, problems, cache = [], [], {}
    for key, v in sorted((g2.get("items") or {}).items()):
        slug, _, ref = key.partition(":")
        verdict = (v or {}).get("verdict")
        if verdict not in G2_VERDICTS:
            problems.append(f"{key}: verdict {verdict!r} is not one of {sorted(G2_VERDICTS)}")
            continue
        if slug not in cache:
            f = runs_dir / f"{slug}.json"
            cache[slug] = LessonRun.model_validate_json(f.read_text()) if f.exists() else None
        run = cache[slug]
        if run is None:
            problems.append(f"{key}: no lesson run {runs_dir / (slug + '.json')}")
            continue
        item = next((it for it in run.items if it.ref == ref), None)
        if item is None:
            problems.append(f"{key}: {ref} is not an item of lesson {slug}")
            continue
        targets.append({"key": key, "verdict": verdict, "note": (v or {}).get("note"),
                        "question_id": item.question_id(), "teaching": item.answer_type == "not_markable"})
    return targets, problems


def apply_g2(cur, g2: dict, runs_dir: Path, course: str, dry_run: bool) -> dict:
    by = (g2.get("by") or "").strip()
    if not by:
        raise SystemExit("ERROR: the G2 file must name its reviewer (`by`) — an unattributed review is not a review")
    targets, problems = g2_targets(g2, runs_dir)
    if problems:
        raise SystemExit("G2 NOT APPLIED — nothing was written:\n  " + "\n  ".join(problems))
    cur.execute("SELECT node_id FROM node_subject WHERE course_id = %s", (course,))
    course_los = {r[0] for r in cur.fetchall()}
    out = {"stamped": [], "held": [], "rejected": [], "teaching": [], "absent": [], "unchanged": 0}
    for t in targets:
        qid = t["question_id"]
        cur.execute("SELECT status, reviewed_by, source, lo_id FROM questions WHERE id = %s", (qid,))
        row = cur.fetchone()
        if t["teaching"]:
            out["teaching"].append(qid)
            continue
        if row is None:
            if t["verdict"] != "exclude":
                out["absent"].append(qid)
            continue
        status, reviewed_by, source, lo = row
        if source != "seed" or lo not in course_los:
            raise SystemExit(f"G2 NOT APPLIED: {qid} is not a book question of {course} "
                             f"(source {source}, objective {lo}); nothing was written")
        if t["verdict"] == "exclude":
            want = ("rejected", reviewed_by)
            bucket = "rejected"
        elif t["verdict"] == "hold":
            want = ("review", f"{by} (G2 hold)")
            bucket = "held"
        else:
            want = ("live", f"{by} (G2 {t['verdict']})")
            bucket = "stamped"
        if (status, reviewed_by) == want:
            out["unchanged"] += 1
            continue
        out[bucket].append(qid)
        if not dry_run:
            cur.execute("""UPDATE questions SET status = %s, reviewed_by = %s,
                                  reviewed_at = CASE WHEN %s IS DISTINCT FROM reviewed_by THEN now()
                                                     ELSE reviewed_at END
                            WHERE id = %s""", (want[0], want[1], want[1], qid))
    return out


def main_g2(args) -> int:
    import book_config
    book = book_config.load_book(args.book)
    runs_dir = Path(args.runs) if args.runs else book_config.HERE / "runs" / book.book / "lesson"
    g2 = json.loads(args.g2.read_text())
    import psycopg
    with psycopg.connect(args.dsn) as conn, conn.cursor() as cur:
        res = apply_g2(cur, g2, runs_dir, book.course_id, args.dry_run)
        if not args.dry_run:
            conn.commit()
    verb = "would" if args.dry_run else "did"
    print(f"{args.g2.name}: G2 by {g2.get('by')} on {book.course_id} — {verb} stamp "
          f"{len(res['stamped'])} live, hold {len(res['held'])} at review, reject {len(res['rejected'])}; "
          f"{res['unchanged']} already as recorded")
    if res["teaching"]:
        print(f"  {len(res['teaching'])} verdict(s) on worked examples (not question rows): {res['teaching'][:6]}")
    if res["absent"]:
        print(f"  ! {len(res['absent'])} question(s) not in this database — load the course first: "
              f"{res['absent'][:6]}", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("verdicts", type=Path, nargs="?")
    ap.add_argument("--dsn", default=os.environ.get("AINEXT_DB_DSN"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--g2", type=Path, help="G2 verdicts on the book's own questions ({by, items})")
    ap.add_argument("--book", help="with --g2: the book config (its course and its runs)")
    ap.add_argument("--runs", help="with --g2: the lesson run files (default runs/<book>/lesson/)")
    args = ap.parse_args()
    if args.g2:
        if not args.book or not args.dsn:
            print("ERROR: --g2 needs --book and a database (--dsn or AINEXT_DB_DSN)", file=sys.stderr)
            return 2
        return main_g2(args)
    if not args.verdicts:
        ap.error("a verdicts file, or --g2")

    doc = json.loads(args.verdicts.read_text())
    reviewer = (doc.get("reviewer") or "").strip()
    if not reviewer:
        print("ERROR: the file must name a reviewer — an unattributed review is not a review",
              file=sys.stderr)
        return 2
    verdicts: dict[str, str] = doc["verdicts"]
    bad = {v for v in verdicts.values()} - VALID
    if bad:
        print(f"ERROR: unknown verdict(s) {sorted(bad)}; expected {sorted(VALID)}", file=sys.stderr)
        return 2

    if not args.dsn:
        print("ERROR: pass --dsn or set AINEXT_DB_DSN", file=sys.stderr)
        return 2

    import psycopg

    with psycopg.connect(args.dsn) as conn, conn.cursor() as cur:
        # Family membership lives in source_note ("Generated from template
        # family <id>.") because the schema has no family column yet. Reading it
        # here keeps the coupling in one place; if a family column is ever added
        # this is the only query that changes.
        def family_of(qid: str) -> str | None:
            cur.execute("SELECT source_note FROM questions WHERE id = %s", (qid,))
            row = cur.fetchone()
            if not row or not row[0] or "template family " not in row[0]:
                return None
            return row[0].split("template family ", 1)[1].rstrip(". ")

        direct = 0
        by_family = 0
        retired = 0
        pulled = 0
        unknown: list[str] = []
        accepted_families: dict[str, str] = {}

        for qid, verdict in sorted(verdicts.items()):
            fam = family_of(qid)
            if fam is None:
                unknown.append(qid)
                continue

            if verdict == "accept":
                direct += 1
                accepted_families.setdefault(fam, qid)
                if not args.dry_run:
                    cur.execute(
                        """UPDATE questions
                              SET reviewed_by = %s, reviewed_at = now()
                            WHERE id = %s""",
                        (f"{reviewer} (sampled)", qid),
                    )
            elif verdict == "reject":
                if not args.dry_run:
                    cur.execute(
                        """UPDATE questions SET status = 'rejected'
                            WHERE source = 'variant' AND source_note LIKE %s""",
                        (f"%template family {fam}.%",),
                    )
                    retired += cur.rowcount
                else:
                    cur.execute(
                        """SELECT count(*) FROM questions
                            WHERE source = 'variant' AND source_note LIKE %s""",
                        (f"%template family {fam}.%",),
                    )
                    retired += cur.fetchone()[0]
                accepted_families.pop(fam, None)
            elif verdict == "fix":
                pulled += 1
                if not args.dry_run:
                    cur.execute(
                        "UPDATE questions SET status = 'review' WHERE id = %s", (qid,)
                    )

        # Family validation runs last, so a rejection anywhere in a family always
        # beats an acceptance elsewhere in it: the same template cannot be both
        # validated and retired, and the safe reading wins.
        for fam, via in sorted(accepted_families.items()):
            if args.dry_run:
                cur.execute(
                    """SELECT count(*) FROM questions
                        WHERE source = 'variant' AND status = 'live'
                          AND reviewed_by IS NULL AND source_note LIKE %s""",
                    (f"%template family {fam}.%",),
                )
                by_family += cur.fetchone()[0]
                continue
            cur.execute(
                """UPDATE questions
                      SET reviewed_by = %s, reviewed_at = now()
                    WHERE source = 'variant' AND status = 'live'
                      AND reviewed_by IS NULL AND source_note LIKE %s""",
                (f"{reviewer} (family {fam} via {via})", f"%template family {fam}.%"),
            )
            by_family += cur.rowcount

        if not args.dry_run:
            conn.commit()

    verb = "would mark" if args.dry_run else "marked"
    print(f"{args.verdicts.name}: {len(verdicts)} verdict(s) from {reviewer}")
    print(f"  {verb} {direct} item(s) reviewed directly")
    print(f"  {verb} {by_family} sibling(s) validated through their family")
    if retired:
        print(f"  {verb} {retired} item(s) retired — a rejected template is wrong in every instance")
    if pulled:
        print(f"  {verb} {pulled} item(s) pulled back to 'review' for a fix")
    if unknown:
        print(f"  {len(unknown)} verdict(s) named a question with no template family:", file=sys.stderr)
        for u in unknown:
            print(f"    x {u}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

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

Until now the stamp stopped at the run files: the loader records every verified book question as
AI-checked only (ai_checked_by 'ai dual-check'), so the database never said a human read one. `--g2`
carries the verdicts to the rows, by the question id the assembler minted from the item's own objective
and place in the book (the run files under runs/<book>/lesson/ say which objective):

    accept, fix  status 'live', reviewed_by '<by> (G2 accept|fix)'
    hold         status 'review', hold_reason 'human_hold', reviewed_by '<by> (G2 hold)'
    exclude      the item is not a question row; a row loaded earlier goes to 'rejected'
A not-markable item is a worked example, not a question row, and is reported, never invented.
It only ever touches the book's own rows (source 'seed') of the book's course, never deletes
one, and re-running it changes nothing: it is a replay of the committed file.

ONLY A HUMAN STAMP IS A REVIEW (migration 035, answer 33). `reviewed_by` carries the reviewer's own
stamp and nothing else; who else changed the item ("stem fixed by orchestrator … — not Samuel") goes
to `review_note`, and a figure that is still missing to `hold_reason` (figure_missing — a book-picture
stand-in counts as the figure, answer 37d). AN AUTO-PASSED GATE IS NOT A REVIEW (answer 37c): a file
(or one of its items) marked `"auto": true`, or signed "auto-pass G<n> (AI recommendation)"
(auto_pass_gates.py), writes the AI's verdict to `ai_checked_by` and never touches `reviewed_by`; an
auto "hold" is held as `unverified`, an auto G3 "fix" likewise — only a human's hold is `human_hold`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import review_policy

VALID = {"accept", "reject", "fix"}


G2_VERDICTS = {"accept", "fix", "hold", "exclude"}


# A part whose stem the assembly changes (multipart.py: it carries what it depends on) is no longer the text a
# human read at G2: the stamp stays, the NOTE says who changed it and the console lists the item as "changed after
# a human signed it" (review-gate.ts changedAfterHumanReview), exactly as for an orchestrator's stem fix. A constant
# string, so re-running the apply changes nothing.
CARRY_NOTE = "stem fixed by pipeline carry-over (multipart.py: the part carries what it depends on), 2026-10-01 — not {who}"


def carried_refs(runs_dir: Path) -> set[str]:
    """The refs of every item whose stem the assembly carries into (multipart.plan over the whole runs dir: the
    parts of a question are spread across lessons, so every run is read). A run that does not validate is
    skipped here — the assembly reports it."""
    import multipart
    from assemble_lesson_bundle import LessonRun
    from pydantic import ValidationError
    items = []
    for f in sorted(runs_dir.glob("*.json")):
        try:
            items += LessonRun.model_validate_json(f.read_text()).items
        except (ValidationError, ValueError):
            continue
    return set(multipart.plan_items(items)[0])


def g2_targets(g2: dict, runs_dir: Path) -> tuple[list[dict], list[str]]:
    """Each G2 verdict with the question id it lands on (the assembler's own minting), and the
    problems that stop the whole apply (an unknown lesson or item, an unknown verdict)."""
    from assemble_lesson_bundle import LessonRun
    targets, problems, cache = [], [], {}
    carried = carried_refs(runs_dir)
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
                        "question_id": item.question_id(), "teaching": item.answer_type == "not_markable",
                        "reviewer_verdict": (v or {}).get("samuel_verdict") or verdict,
                        "stem_fix_by": (v or {}).get("stem_fix_by"),
                        "stem_carried": item.ref in carried,
                        "auto": bool((v or {}).get("auto")) or review_policy.is_auto((v or {}).get("by")),
                        "by": (v or {}).get("by")})
    return targets, problems


def apply_g2(cur, g2: dict, runs_dir: Path, course: str, dry_run: bool) -> dict:
    by = (g2.get("by") or "").strip()
    if not by:
        raise SystemExit("ERROR: the G2 file must name its reviewer (`by`) — an unattributed review is not a review")
    review_policy.require_review_columns(cur)
    file_auto = bool(g2.get("auto")) or review_policy.is_auto(by)
    auto_by = review_policy.auto_pass_by("G2")
    targets, problems = g2_targets(g2, runs_dir)
    if problems:
        raise SystemExit("G2 NOT APPLIED — nothing was written:\n  " + "\n  ".join(problems))
    cur.execute("SELECT node_id FROM node_subject WHERE course_id = %s", (course,))
    course_los = {r[0] for r in cur.fetchall()}
    out = {"stamped": [], "held": [], "rejected": [], "teaching": [], "absent": [], "unchanged": 0,
           "held_for_figure": []}
    for t in targets:
        qid = t["question_id"]
        cur.execute("""SELECT status, reviewed_by, source, lo_id, stem, ai_checked_by, hold_reason, review_note
                         FROM questions WHERE id = %s""", (qid,))
        row = cur.fetchone()
        if t["teaching"]:
            out["teaching"].append(qid)
            continue
        if row is None:
            if t["verdict"] != "exclude":
                out["absent"].append(qid)
            continue
        status, reviewed_by, source, lo, stem, ai_by, hold, note = row
        if source != "seed" or lo not in course_los:
            raise SystemExit(f"G2 NOT APPLIED: {qid} is not a book question of {course} "
                             f"(source {source}, objective {lo}); nothing was written")
        auto = file_auto or t["auto"]
        # the reviewer's own verdict, and who else changed the item (2026-09-27): the stamp is "Samuel Toma
        # (G2 accept)" and "stem fixed by orchestrator …" is a NOTE — never "(G2 fix)" for a fix the reviewer
        # did not make, and never part of the human stamp (migration 035)
        verdict = t["reviewer_verdict"] if t["verdict"] in ("accept", "fix") else t["verdict"]
        # who: a human's own name; an auto verdict's signer (the item's, else the file's), which is the AI
        # recommendation's "auto-pass G2 (AI recommendation)" unless a stub names itself (the dry run)
        who = by if not auto else ((t.get("by") if t["auto"] else None) or (by if file_auto else None) or auto_by)
        stamp = f"{who} (G2 {verdict})"
        # the pre-035 "held: its figure is missing" annotation is hold_reason's job now (figure_missing)
        kept = "; ".join(n for n in (note or "").split("; ") if n.strip() != "held: its figure is missing")
        who_read = (by.split() or ["the reviewer"])[0]
        want_note = review_policy.join_notes(
            kept, f"stem fixed by {t['stem_fix_by']}" if t.get("stem_fix_by") else None,
            CARRY_NOTE.format(who=who_read) if t.get("stem_carried") and not auto else None)
        # (status, reviewed_by, ai_checked_by, hold_reason, review_note)
        human = reviewed_by if auto else stamp
        robot = stamp if auto else ai_by
        if t["verdict"] == "exclude":
            want = ("rejected", reviewed_by, ai_by if not auto else stamp, None, note)
            bucket = "rejected"
        elif t["verdict"] == "hold":
            want = ("review", human, robot,
                    review_policy.UNVERIFIED if auto else review_policy.HUMAN_HOLD, want_note)
            bucket = "held"
        else:
            want = ("live", human, robot, None, want_note)
            bucket = "stamped"
            # consistency review A3: a question whose stem shows [figure] and has no figure stays at review, G2's
            # verdict recorded, until its figure exists — it cannot be answered without it. A book-picture
            # stand-in (answer 37d) is its figure; one that would show the unknown was never attached, and
            # the load holds the question as figure_reveals_answer — kept here.
            if "[figure]" in (stem or ""):
                cur.execute("SELECT 1 FROM visuals WHERE question_id = %s LIMIT 1", (qid,))
                if cur.fetchone() is None:
                    keep = hold if hold == review_policy.FIGURE_REVEALS_ANSWER else review_policy.FIGURE_MISSING
                    want = ("review", human, robot, keep, want_note)
                    bucket = "held_for_figure"
        if (status, reviewed_by, ai_by, hold, note) == want:
            out["unchanged"] += 1
            continue
        out[bucket].append(qid)
        if not dry_run:
            cur.execute("""UPDATE questions
                              SET status = %s, reviewed_by = %s,
                                  reviewed_at = CASE WHEN %s::text IS NULL THEN NULL
                                                     WHEN %s::text IS DISTINCT FROM reviewed_by THEN now()
                                                     ELSE reviewed_at END,
                                  ai_checked_by = %s,
                                  ai_checked_at = CASE WHEN %s::text IS NULL THEN ai_checked_at
                                                       WHEN %s::text IS DISTINCT FROM ai_checked_by THEN now()
                                                       ELSE ai_checked_at END,
                                  hold_reason = %s, review_note = %s
                            WHERE id = %s""",
                        (want[0], want[1], want[1], want[1], want[2], want[2], want[2], want[3], want[4], qid))
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
          f"{len(res['stamped'])} live, hold {len(res['held'])} at review, reject {len(res['rejected'])}, "
          f"keep {len(res['held_for_figure'])} at review for a missing figure; "
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
    # An auto-passed G3 (answer 37c) is the AI's verdict: it goes to ai_checked_by, never reviewed_by.
    auto = bool(doc.get("auto")) or review_policy.is_auto(reviewer)
    stamp_col, stamp_at = ("ai_checked_by", "ai_checked_at") if auto else ("reviewed_by", "reviewed_at")
    # an AI verdict is ADDED to the AI checks the item already carries ("ai blind grade (S6); auto-pass G3 …");
    # a human's stamp is the stamp
    set_stamp = (f"{stamp_col} = concat_ws('; ', {stamp_col}, %s::text), {stamp_at} = now()" if auto
                 else f"{stamp_col} = %s, {stamp_at} = now()")
    not_yet = (f"(ai_checked_by IS NULL OR strpos(ai_checked_by, %s) = 0) AND reviewed_by IS NULL" if auto
               else "reviewed_by IS NULL AND %s::text IS NOT NULL")
    # (an auto file keeps its signer: "auto-pass G3 (AI recommendation)" from auto_pass_gates.py, or a stub's name)
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
        review_policy.require_review_columns(cur)
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
                        # a human's direct read always wins (it replaces a family stamp); an AI's is added once
                        f"""UPDATE questions SET {set_stamp}
                            WHERE id = %s AND {not_yet if auto else "%s::text IS NOT NULL"}""",
                        (f"{reviewer} (sampled)", qid, reviewer),
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
                    # a human's "fix" is a human hold (no loader releases it); an auto one is `unverified`
                    cur.execute(
                        "UPDATE questions SET status = 'review', hold_reason = %s WHERE id = %s",
                        (review_policy.UNVERIFIED if auto else review_policy.HUMAN_HOLD, qid),
                    )

        # Family validation runs last, so a rejection anywhere in a family always
        # beats an acceptance elsewhere in it: the same template cannot be both
        # validated and retired, and the safe reading wins.
        for fam, via in sorted(accepted_families.items()):
            if args.dry_run:
                cur.execute(
                    f"""SELECT count(*) FROM questions
                        WHERE source = 'variant' AND status = 'live'
                          AND {not_yet} AND source_note LIKE %s""",
                    (reviewer, f"%template family {fam}.%"),
                )
                by_family += cur.fetchone()[0]
                continue
            cur.execute(
                f"""UPDATE questions SET {set_stamp}
                    WHERE source = 'variant' AND status = 'live'
                      AND {not_yet} AND source_note LIKE %s""",
                (f"{reviewer} (family {fam} via {via})", reviewer, f"%template family {fam}.%"),
            )
            by_family += cur.rowcount

        if not args.dry_run:
            conn.commit()

    verb = "would mark" if args.dry_run else "marked"
    print(f"{args.verdicts.name}: {len(verdicts)} verdict(s) from {reviewer}")
    if auto:
        print(f"  {verb} {direct} sampled item(s) and {by_family} sibling(s) AI-checked by the auto-pass "
              "(ai_checked_by; not a review — they stay in the console backlog)")
    else:
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

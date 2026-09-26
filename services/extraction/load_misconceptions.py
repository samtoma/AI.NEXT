"""Load the misconception catalogue and wire it to the questions that reveal it.

    uv run load_misconceptions.py seed/generated/misconceptions.json [--dry-run] [--add-only]
    uv run load_misconceptions.py seed/generated/g10-math/misconceptions.json \
        --course course:us-g10-math-en                  # refuses an entry outside the course

`seed/generated/misconceptions.json` is the single source of the Prep-3 maths catalogue
(decision 22, FR-4409); it is loaded on every deploy. Another book's catalogue sits under
`seed/generated/<book>/`.

Three things happen, and the order matters:

  1. **Misconceptions are upserted**, with generator-invented ids folded in as
     aliases. Before this catalogue existed the question generator named its own
     errors ad hoc, so the same mistake could exist twice under two ids. Two ids
     for one misconception split its refutation and its evidence, and the split
     is invisible until somebody wonders why a common mistake has half the
     attempts it should.

  2. **A refutation entry is written for each one** into `explanation_library`.
     A named misconception with nothing to teach is a label, not a teaching
     move: the diagnosis would land and the tutor would still have nothing
     grounded to say.

  3. **Book distractors are stamped** with the misconception they encode, matched
     on exact choice text. 750 distractors across 250 book MCQs carried none,
     which meant a student picking a deliberately-wrong option told us nothing.
     Matching on text rather than position is deliberate: option keys are
     rearranged by the generator's key-balancing pass, and a stale position
     would silently mislabel an answer.

FOLDING AN ALIAS NEVER FAILS A DEPLOY. Folding deletes the alias's row, and
`attempts.misconception_id` references it with no cascade, so once one student's
attempt cites the alias the delete fails — and it used to take the whole
every-deploy catalogue load down with it. Now the fold runs under a savepoint: the
alias's option stamps are re-pointed to its entry either way, and if a recorded
attempt still cites the alias its row (and its refutation, which that history
needs) is KEPT and reported. A student row is never rewritten to make a fold fit.

COURSE SCOPE (B15). With `--course <id>` every entry must sit on one of the course's
objectives, or the load refuses before writing; the course's own counts are printed
at the end (entries, entries with a refutation, stamped options).

A mapping that finds no matching choice is REPORTED, never silently skipped —
an unmatched map means either the catalogue quotes the option wrongly or the
question changed underneath it, and both are worth knowing.

The environment guard is the same as the question loader's: this content ships
under the review-gate suspension, which is bounded to the comparison build.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("catalogue", type=Path)
    ap.add_argument("--dsn", default=os.environ.get("AINEXT_DB_DSN"))
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change, including unmatched mappings, and write nothing")
    ap.add_argument("--course", help="refuse any entry outside this course; print its counts")
    ap.add_argument("--add-only", action="store_true",
                    help="insert entries and explanations the database lacks; never overwrite one, "
                         "never fold an alias (that deletes a row), and never re-stamp a choice that "
                         "already names a misconception. The 'Load a course' action's mode")
    args = ap.parse_args()

    bundle = json.loads(args.catalogue.read_text())
    entries = bundle["misconceptions"]
    generator = bundle.get("generator") or "unattributed"

    if not args.dsn:
        print("ERROR: pass --dsn or set AINEXT_DB_DSN", file=sys.stderr)
        return 2

    import psycopg

    with psycopg.connect(args.dsn) as conn, conn.cursor() as cur:
        skipped_refutations: list[str] = []
        kept_aliases: list[str] = []
        if args.course:
            cur.execute("SELECT node_id FROM node_subject WHERE course_id = %s", (args.course,))
            course_los = {r[0] for r in cur.fetchall()}
            outside = sorted(m["id"] for m in entries if m["lo_id"] not in course_los)
            if outside:
                print(f"REFUSING: {len(outside)} entr(ies) are not on an objective of {args.course}: "
                      f"{outside[:6]}{' …' if len(outside) > 6 else ''}. Nothing was written.",
                      file=sys.stderr)
                return 1
        env = (os.environ.get("AINEXT_ENVIRONMENT") or "").strip().lower()
        if env != "mvp1" and not args.dry_run:
            print(
                f"REFUSING: AINEXT_ENVIRONMENT is {env or '<unset>'}, not 'mvp1'. "
                "Unreviewed teaching content is bounded to the comparison "
                "environment (constitution III, ADR-0008).",
                file=sys.stderr,
            )
            return 2

        stamped = 0
        unmatched: list[str] = []
        alias_rows = 0
        unfolded: list[str] = []
        restamp: list[str] = []

        for m in entries:
            if not args.dry_run:
                cur.execute(
                    """INSERT INTO misconceptions (id, lo_id, label, description, signal, generated_by)
                       VALUES (%s, %s, %s, %s, %s, %s)
                       """ + ("ON CONFLICT (id) DO NOTHING" if args.add_only else """ON CONFLICT (id) DO UPDATE
                         SET label = EXCLUDED.label,
                             description = EXCLUDED.description,
                             signal = EXCLUDED.signal,
                             generated_by = EXCLUDED.generated_by"""),
                    (m["id"], m["lo_id"], m["label"], m["description"],
                     m.get("signal"), generator),
                )
                # The refutation. reviewed stays false: this is exactly the
                # content the standing exception covers.
                #
                # An entry with NO steps is never written. A misconception can
                # legitimately arrive without one — an alias folded in from the
                # generator keeps its row but carries no refutation of its own —
                # and writing an empty entry for it would be worse than writing
                # none: the diagnosis would resolve, the lookup would succeed,
                # and the student would be served a blank explanation for a
                # mistake they really made.
                if not m.get("refutation"):
                    skipped_refutations.append(m["id"])
                    continue
                cur.execute(
                    """INSERT INTO explanation_library
                         (id, lo_id, misconception_id, entry_type, content, generated_by, reviewed)
                       VALUES (%s, %s, %s, 'refutation', %s, %s, false)
                       """ + ("ON CONFLICT (id) DO NOTHING" if args.add_only else """ON CONFLICT (id) DO UPDATE
                         SET content = EXCLUDED.content,
                             generated_by = EXCLUDED.generated_by"""),
                    (f"expl:{m['id']}", m["lo_id"], m["id"],
                     json.dumps(m["refutation"]), generator),
                )

            # Aliases: any row the generator created for the same error is
            # re-pointed here rather than left as a rival entry.
            for alias in m.get("aliases", []):
                cur.execute("SELECT 1 FROM misconceptions WHERE id = %s", (alias,))
                if cur.fetchone() is None:
                    continue
                alias_rows += 1
                if args.dry_run or args.add_only:
                    # Folding an alias deletes its row, and fails outright once an
                    # attempt names it (attempts.misconception_id has no cascade).
                    if args.add_only:
                        unfolded.append(f"{alias} -> {m['id']}")
                    continue
                cur.execute(
                    """UPDATE questions q
                          SET choices = (
                                SELECT jsonb_agg(
                                  CASE WHEN c->>'misconception_id' = %s
                                       THEN jsonb_set(c, '{misconception_id}', to_jsonb(%s::text))
                                       ELSE c END)
                                  FROM jsonb_array_elements(q.choices) c)
                        WHERE q.choices @> jsonb_build_array(jsonb_build_object('misconception_id', %s::text))""",
                    (alias, m["id"], alias),
                )
                # The stamps above are content and always move. The row goes only if no
                # recorded attempt cites it (FK, no cascade): a savepoint keeps a refused
                # delete from rolling back the whole load, and the deploy with it.
                cur.execute("SAVEPOINT fold_alias")
                try:
                    cur.execute("DELETE FROM explanation_library WHERE misconception_id = %s",
                                (alias,))
                    cur.execute("DELETE FROM misconceptions WHERE id = %s", (alias,))
                    cur.execute("RELEASE SAVEPOINT fold_alias")
                except psycopg.errors.ForeignKeyViolation:
                    cur.execute("ROLLBACK TO SAVEPOINT fold_alias")
                    kept_aliases.append(f"{alias} -> {m['id']}")

            for mp in m["maps"]:
                cur.execute(
                    "SELECT choices FROM questions WHERE id = %s", (mp["question_id"],)
                )
                row = cur.fetchone()
                if row is None or not row[0]:
                    unmatched.append(f"{m['id']} -> {mp['question_id']} (no such question, or it has no choices)")
                    continue
                choices = row[0]
                hit = [c for c in choices if c.get("text") == mp["choice_text"]]
                if args.add_only and any(c.get("misconception_id") not in (None, m["id"]) for c in hit):
                    restamp.append(f"{mp['question_id']} {mp['choice_text']!r} already names "
                                   f"{[c.get('misconception_id') for c in hit]}, not {m['id']}")
                    continue
                if not hit:
                    unmatched.append(
                        f"{m['id']} -> {mp['question_id']} option {mp['choice_text']!r} not found"
                    )
                    continue
                stamped += len(hit)
                if args.dry_run:
                    continue
                updated = [
                    dict(c, misconception_id=m["id"]) if c.get("text") == mp["choice_text"] else c
                    for c in choices
                ]
                cur.execute(
                    "UPDATE questions SET choices = %s WHERE id = %s",
                    (json.dumps(updated), mp["question_id"]),
                )

        course_counts = None
        if args.course:
            cur.execute(
                """SELECT count(*),
                          count(*) FILTER (WHERE EXISTS (
                              SELECT 1 FROM explanation_library x
                               WHERE x.misconception_id = m.id AND x.entry_type = 'refutation')),
                          (SELECT count(*) FROM questions q, jsonb_array_elements(
                                   CASE WHEN jsonb_typeof(q.choices) = 'array' THEN q.choices
                                        ELSE '[]'::jsonb END) c
                            WHERE q.lo_id IN (SELECT node_id FROM node_subject WHERE course_id = %s)
                              AND c ? 'misconception_id')
                     FROM misconceptions m
                    WHERE m.lo_id IN (SELECT node_id FROM node_subject WHERE course_id = %s)""",
                (args.course, args.course))
            course_counts = cur.fetchone()
        if not args.dry_run:
            conn.commit()

    verb = "would stamp" if args.dry_run else "stamped"
    print(f"{args.catalogue.name}: {len(entries)} misconceptions")
    print(f"  {verb} {stamped} book distractor(s)")
    print(f"  generator aliases found in the database: {alias_rows}")
    if skipped_refutations:
        print(f"  {len(skipped_refutations)} misconception(s) carry no refutation and got no entry: "
              f"{', '.join(skipped_refutations[:4])}")
    if kept_aliases:
        print(f"  {len(kept_aliases)} alias row(s) KEPT, not folded: a recorded attempt cites each "
              f"(student rows are never rewritten); their option stamps were re-pointed: "
              f"{kept_aliases[:4]}")
    if course_counts:
        total, refuted, stamps = course_counts
        print(f"  course counts: {args.course} misconceptions={total} with_refutation={refuted} "
              f"stamped_options={stamps}" + ("   (dry run: as the database stands)" if args.dry_run else ""))
    if args.add_only and (unfolded or restamp):
        print(f"  add-only: {len(unfolded)} alias fold(s) and {len(restamp)} re-stamp(s) NOT applied "
              f"(they change or delete existing rows): {(unfolded + restamp)[:4]}")
    if unmatched:
        print(f"  {len(unmatched)} mapping(s) matched nothing:", file=sys.stderr)
        for u in unmatched:
            print(f"    x {u}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

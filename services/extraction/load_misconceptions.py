"""Load the misconception catalogue and wire it to the questions that reveal it.

    uv run load_misconceptions.py seed/misconceptions-math.json [--dry-run]

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
    args = ap.parse_args()

    bundle = json.loads(args.catalogue.read_text())
    entries = bundle["misconceptions"]
    generator = bundle.get("generator") or "unattributed"

    if not args.dsn:
        print("ERROR: pass --dsn or set AINEXT_DB_DSN", file=sys.stderr)
        return 2

    import psycopg

    with psycopg.connect(args.dsn) as conn, conn.cursor() as cur:
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

        for m in entries:
            if not args.dry_run:
                cur.execute(
                    """INSERT INTO misconceptions (id, lo_id, label, description, signal, generated_by)
                       VALUES (%s, %s, %s, %s, %s, %s)
                       ON CONFLICT (id) DO UPDATE
                         SET label = EXCLUDED.label,
                             description = EXCLUDED.description,
                             signal = EXCLUDED.signal,
                             generated_by = EXCLUDED.generated_by""",
                    (m["id"], m["lo_id"], m["label"], m["description"],
                     m.get("signal"), generator),
                )
                # The refutation. reviewed stays false: this is exactly the
                # content the standing exception covers.
                cur.execute(
                    """INSERT INTO explanation_library
                         (id, lo_id, misconception_id, entry_type, content, generated_by, reviewed)
                       VALUES (%s, %s, %s, 'refutation', %s, %s, false)
                       ON CONFLICT (id) DO UPDATE
                         SET content = EXCLUDED.content,
                             generated_by = EXCLUDED.generated_by""",
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
                if args.dry_run:
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
                cur.execute("DELETE FROM explanation_library WHERE misconception_id = %s", (alias,))
                cur.execute("DELETE FROM misconceptions WHERE id = %s", (alias,))

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

        if not args.dry_run:
            conn.commit()

    verb = "would stamp" if args.dry_run else "stamped"
    print(f"{args.catalogue.name}: {len(entries)} misconceptions")
    print(f"  {verb} {stamped} book distractor(s)")
    print(f"  generator aliases found in the database: {alias_rows}")
    if unmatched:
        print(f"  {len(unmatched)} mapping(s) matched nothing:", file=sys.stderr)
        for u in unmatched:
            print(f"    x {u}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

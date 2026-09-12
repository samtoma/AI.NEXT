"""Apply a human reviewer's verdicts to a generated question bundle.

    uv run apply_review_verdicts.py verdicts.json [--dry-run]

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
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

VALID = {"accept", "reject", "fix"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("verdicts", type=Path)
    ap.add_argument("--dsn", default=os.environ.get("AINEXT_DB_DSN"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

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

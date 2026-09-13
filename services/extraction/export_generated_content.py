"""Export the generated content back into loader-compatible bundles.

    uv run export_generated_content.py --out-dir seed [--dsn ...]

WHY THIS EXISTS. The generated question bank and the widget bank are produced by
generators that are deterministic given their flags — but *given their flags*.
Re-deriving the live bank meant remembering that one run used a raised
`--per-family`, and getting it wrong silently produces a DIFFERENT bank: the ids
drift, and the committed review verdicts (which name specific question ids) stop
applying to anything.

So the database is the source of truth for what was actually generated,
reviewed and served, and this writes that state back out as bundles the existing
loaders replay exactly. A fresh clone then reproduces the live bank without
anyone having to remember a flag.

Three bundles, in the shapes `load_generated_questions.py` and
`load_misconceptions.py` already accept:

    generated-questions.json   source='variant', question_type <> 'widget'
    widget-questions.json      source='variant', question_type  = 'widget'
    misconceptions.json        the catalogue + its refutations

REVIEW STAMPS TRAVEL. `reviewed_by` / `reviewed_at` are exported per question,
because the 10% human sample (ADR-0008) is the only thing separating "a human
read this" from "a machine wrote it", and a reload that silently dropped it
would quietly re-assert content as unreviewed — or worse, leave a surface
claiming a review that no longer has a record behind it.

MATERIALISED ROWS ARE NOT EXPORTED. A widget the tutor improvised for one
student (ADR-0009 §3) is that session's artefact awaiting review, not content to
seed another machine with.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def rows(cur, sql: str, args: tuple = ()) -> list[dict]:
    cur.execute(sql, args)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def question_bundle(cur, widgets: bool, generator: str) -> dict:
    op = "=" if widgets else "<>"
    qs = rows(
        cur,
        f"""SELECT id, lo_id, tier, question_type, stem, choices, correct_answer,
                   canonical_solution, status, parent_question_id, source_page,
                   source_note, reviewed_by, reviewed_at
              FROM questions
             WHERE source = 'variant'
               AND question_type {op} 'widget'
               AND materialised_from IS NULL
             ORDER BY lo_id, id""",
    )
    for q in qs:
        # The loader re-derives these; exporting them keeps the bundle a faithful
        # record of what was served rather than a request to re-derive.
        q["reviewed_at"] = q["reviewed_at"].isoformat() if q["reviewed_at"] else None
    return {"generator": generator, "questions": qs, "misconceptions": []}


def misconception_bundle(cur, generator: str) -> dict:
    ms = rows(
        cur,
        """SELECT id, lo_id, label, description, signal
             FROM misconceptions ORDER BY lo_id, id""",
    )
    refs = {
        r["misconception_id"]: r
        for r in rows(
            cur,
            """SELECT misconception_id, content, source_page, reviewed
                 FROM explanation_library
                WHERE entry_type = 'refutation' AND misconception_id IS NOT NULL""",
        )
    }
    # THE BOOK DISTRACTOR MAPS.
    #
    # A misconception's link to a printed distractor lives on the QUESTION —
    # `choices[].misconception_id` — not in the misconceptions table, so a
    # naive export drops all 94 of them and the restored database can no longer
    # diagnose a single book multiple-choice answer. Nothing errors; the tutor
    # just stops recognising the mistakes the ministry's own authors encoded.
    #
    # They are read back here by exact choice TEXT (never position — the
    # key-balancing pass rearranges keys), which is the same contract
    # load_misconceptions.py stamps them with.
    maps: dict[str, list[dict]] = {}
    for q in rows(
        cur,
        """SELECT id, choices FROM questions
            WHERE question_type = 'mcq' AND source IN ('seed', 'authored')
              AND choices IS NOT NULL""",
    ):
        for c in q["choices"] or []:
            mid = c.get("misconception_id")
            if mid:
                maps.setdefault(mid, []).append(
                    {"question_id": q["id"], "choice_text": c.get("text")}
                )

    out = []
    for m in ms:
        r = refs.get(m["id"])
        content = r["content"] if r else None
        steps = content if isinstance(content, list) else (content or {}).get("steps", [])
        out.append({
            **m,
            "kind": "book_distractor" if maps.get(m["id"]) else "conceptual",
            "refutation": steps,
            "maps": maps.get(m["id"], []),
            "aliases": [],
        })
    total = sum(len(v) for v in maps.values())
    print(f"  book distractor mappings recovered from questions.choices: {total}")
    return {"generator": generator, "misconceptions": out}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out-dir", type=Path, default=Path("seed/generated"),
                    help="book bundles live in seed/; GENERATED content lives in seed/generated/ "
                         "so that load_seed.py --all does not have to skip past it")
    ap.add_argument("--dsn", default=os.environ.get("AINEXT_DB_DSN"))
    args = ap.parse_args()
    if not args.dsn:
        print("ERROR: pass --dsn or set AINEXT_DB_DSN", file=sys.stderr)
        return 2

    import psycopg

    args.out_dir.mkdir(parents=True, exist_ok=True)
    gen = "exported from the live comparison database — services/extraction/export_generated_content.py"

    with psycopg.connect(args.dsn) as conn, conn.cursor() as cur:
        written = []
        for name, bundle in (
            ("generated-questions.json", question_bundle(cur, False, gen)),
            ("widget-questions.json", question_bundle(cur, True, gen)),
            ("misconceptions.json", misconception_bundle(cur, gen)),
        ):
            path = args.out_dir / name
            path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")
            n = len(bundle.get("questions") or bundle.get("misconceptions") or [])
            reviewed = sum(
                1 for q in (bundle.get("questions") or []) if q.get("reviewed_by")
            )
            written.append((path, n, reviewed))

    for path, n, reviewed in written:
        extra = f", {reviewed} carrying a review stamp" if reviewed else ""
        print(f"wrote {path} — {n} record(s){extra}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

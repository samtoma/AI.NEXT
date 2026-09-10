"""Load a generated question bundle into the COMPARISON environment only.

    uv run load_generated_questions.py <bundle.json> [--promote] [--dsn ...]

Generated questions are the second, larger half of the review-gate suspension
(constitution III as amended, ADR-0008). They are mathematics that no human has
checked, and they are about to be put in front of children, so every safeguard
this file has exists to make that fact impossible to lose track of:

  * `source = 'variant'` and `reviewed_by IS NULL` on every row, forced here
    rather than taken from the bundle. Provenance is not something a generator
    gets to assert about itself.
  * `parent_question_id` points at the book question the item was derived from,
    so "which reviewed item is this a variant of?" is answerable per row.
  * The loader REFUSES to run against an environment that is not `mvp1`. The
    suspension is bounded to the comparison build; the baseline never receives
    generated content, and a wrong `--dsn` is exactly how that would happen by
    accident at 2am.
  * Rows land as `status='review'` unless `--promote` is passed. Generation and
    exposure-to-students are two separate acts and should require two separate
    decisions, even when the same person makes both a second apart.

Sampling: `--sample N` marks N% of the loaded items for human review by writing
them to a review queue file. Samuel reviews a sample rather than the whole bank
(his decision, 2026-09-10); this makes the sample reproducible and its size
auditable rather than a claim in a commit message.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from pathlib import Path

REQUIRED_QUESTION_KEYS = {
    "id",
    "lo_id",
    "tier",
    "question_type",
    "stem",
    "correct_answer",
    "canonical_solution",
}
VALID_TIERS = {"basic", "standard", "advanced"}
VALID_TYPES = {"mcq", "numeric"}


def validate(bundle: dict) -> list[str]:
    """Structural validation. Correctness of the mathematics is the reviewer's job.

    What this can catch is the class of defect that makes an item unservable or
    silently wrong at the mechanical level: a tier the selector cannot ask for,
    an MCQ whose correct answer is not among its own choices, a missing
    solution. What it cannot catch is a plausible-looking wrong answer — which
    is the entire reason a human sample exists.
    """
    problems: list[str] = []
    seen: set[str] = set()
    lo_of_misconception = {m["id"]: m.get("lo_id") for m in bundle.get("misconceptions", [])}

    for q in bundle.get("questions", []):
        qid = q.get("id", "<no id>")
        missing = REQUIRED_QUESTION_KEYS - q.keys()
        if missing:
            problems.append(f"{qid}: missing {sorted(missing)}")
            continue
        if qid in seen:
            problems.append(f"{qid}: duplicate id within the bundle")
        seen.add(qid)
        if q["tier"] not in VALID_TIERS:
            problems.append(f"{qid}: tier {q['tier']!r} is not one of {sorted(VALID_TIERS)}")
        if q["question_type"] not in VALID_TYPES:
            problems.append(f"{qid}: question_type {q['question_type']!r} unsupported")
        if not q["canonical_solution"]:
            problems.append(f"{qid}: canonical_solution is empty — a wrong answer would have nothing to teach from")
        if q["question_type"] == "mcq":
            choices = q.get("choices") or []
            keys = [c.get("key") for c in choices]
            if len(choices) < 3:
                problems.append(f"{qid}: {len(choices)} choices; an MCQ needs at least 3")
            if len(set(keys)) != len(keys):
                problems.append(f"{qid}: duplicate choice keys {keys}")
            if q["correct_answer"] not in keys:
                problems.append(f"{qid}: correct_answer {q['correct_answer']!r} is not among its own choices {keys}")
            texts = [c.get("text") for c in choices]
            if len(set(texts)) != len(texts):
                problems.append(f"{qid}: two choices carry identical text — one distractor is unselectable")
            for c in choices:
                mc = c.get("misconception_id")
                if mc and mc not in lo_of_misconception:
                    problems.append(f"{qid}: choice {c.get('key')} names unknown misconception {mc!r}")
                elif mc and lo_of_misconception[mc] not in (None, q["lo_id"]):
                    problems.append(
                        f"{qid}: choice {c.get('key')} names misconception {mc!r} belonging to "
                        f"{lo_of_misconception[mc]}, not to this question's {q['lo_id']}"
                    )
        elif q.get("choices"):
            problems.append(f"{qid}: numeric question carries choices")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("bundle", type=Path)
    ap.add_argument("--dsn", default=os.environ.get("AINEXT_DB_DSN"))
    ap.add_argument("--promote", action="store_true",
                    help="load as status='live' instead of 'review' — this is the act that puts "
                         "unreviewed mathematics in front of students")
    ap.add_argument("--sample", type=int, default=10,
                    help="percent of loaded items to write to the human review queue (default 10)")
    ap.add_argument("--seed", type=int, default=None,
                    help="RNG seed for a reproducible sample")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    bundle = json.loads(args.bundle.read_text())
    problems = validate(bundle)
    if problems:
        print("BUNDLE REJECTED\n", file=sys.stderr)
        for p in problems:
            print(f"  x {p}", file=sys.stderr)
        return 1

    questions = bundle["questions"]
    misconceptions = bundle.get("misconceptions", [])
    print(f"{args.bundle.name}: {len(questions)} questions, {len(misconceptions)} misconceptions — structurally valid")

    if args.dry_run:
        by_tier: dict[str, int] = {}
        for q in questions:
            by_tier[q["tier"]] = by_tier.get(q["tier"], 0) + 1
        print(f"  dry run — would load as status={'live' if args.promote else 'review'}; tiers {by_tier}")
        return 0

    if not args.dsn:
        print("ERROR: pass --dsn or set AINEXT_DB_DSN", file=sys.stderr)
        return 2

    import psycopg

    with psycopg.connect(args.dsn) as conn, conn.cursor() as cur:
        # The bounding check, before anything is written. An environment column
        # already exists on ai_interactions; the presence of mvp1 rows is not
        # proof, so this reads the loader's own env var and refuses the default.
        env = (os.environ.get("AINEXT_ENVIRONMENT") or "").strip().lower()
        if env != "mvp1":
            print(
                f"REFUSING: AINEXT_ENVIRONMENT is {env or '<unset>'}, not 'mvp1'.\n"
                "Generated questions are bounded to the comparison environment "
                "(constitution III, ADR-0008). Set it explicitly if this really "
                "is the mvp1 database.",
                file=sys.stderr,
            )
            return 2

        status = "live" if args.promote else "review"

        # `generated_by` is NOT NULL in the schema on purpose (migration 009):
        # attribution for machine-authored content is a column, not a convention,
        # so it cannot be omitted by a loader that forgets.
        generator = bundle.get("generator") or "unattributed-generator"

        for m in misconceptions:
            cur.execute(
                """INSERT INTO misconceptions (id, lo_id, label, description, generated_by)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (id) DO UPDATE
                     SET label = EXCLUDED.label,
                         description = EXCLUDED.description,
                         generated_by = EXCLUDED.generated_by""",
                (m["id"], m.get("lo_id"), m["label"], m.get("description"), generator),
            )

        loaded = 0
        for q in questions:
            cur.execute(
                """INSERT INTO questions
                     (id, lo_id, tier, question_type, stem, choices, correct_answer,
                      canonical_solution, solution_version, status, source,
                      parent_question_id, source_page, source_note, reviewed_by, reviewed_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,1,%s,'variant',%s,%s,%s,NULL,NULL)
                   ON CONFLICT (id) DO UPDATE
                     SET stem = EXCLUDED.stem,
                         choices = EXCLUDED.choices,
                         correct_answer = EXCLUDED.correct_answer,
                         canonical_solution = EXCLUDED.canonical_solution,
                         status = EXCLUDED.status""",
                (
                    q["id"], q["lo_id"], q["tier"], q["question_type"], q["stem"],
                    json.dumps(q.get("choices")) if q.get("choices") else None,
                    str(q["correct_answer"]),
                    json.dumps(q["canonical_solution"]),
                    status,
                    q.get("parent_question_id"),
                    q.get("source_page"),
                    q.get("source_note"),
                ),
            )
            loaded += 1
        conn.commit()

    print(f"  loaded {loaded} questions as status={status}, source='variant', reviewed_by=NULL")

    if args.sample > 0:
        rng = random.Random(args.seed)
        n = max(1, round(len(questions) * args.sample / 100))
        picked = rng.sample([q["id"] for q in questions], n)
        out = args.bundle.with_suffix(".review-queue.json")
        out.write_text(json.dumps(
            {"bundle": args.bundle.name, "sample_percent": args.sample,
             "seed": args.seed, "question_ids": sorted(picked)}, indent=2) + "\n")
        print(f"  review queue: {n} of {len(questions)} items ({args.sample}%) -> {out.name}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

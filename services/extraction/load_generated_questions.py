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

Course scope (B15): `--course <id>` refuses any item whose objective is not one of
that course's, before anything is written, and prints the course's own counts at
the end — the figures a per-course gate reads instead of a database-wide total
(ci-cd.yml's old `GEN >= 590`, specs/003 T327):

    course counts: <id> generated=N live=L review=R unreviewed=U widgets=W

Sampling: `--sample N` marks N% of the loaded items for human review by writing
them to a review queue file. Samuel reviews a sample rather than the whole bank
(his decision, 2026-09-10); this makes the sample reproducible and its size
auditable rather than a claim in a commit message.

THE v2 LINE'S BUNDLES (S6 declarative families, S7 widget templates; integration backlog 2):
  * typed answers: `question_type 'short'` with `choices = {"marker": {...}}`, the expression
    marker's spec (contracts/answer-marker.md), validated by schemas.MarkerChoices;
  * the family is a FIELD (`family`), read before the legacy `source_note` text, and it must
    agree with the note the database keeps ("Generated from template family <id>."), which is
    what apply_review_verdicts.py reads back;
  * with a database, every misconception a distractor or widget diagnostic names must be in
    the loaded catalogue (load_misconceptions.py runs FIRST) or be declared by the bundle; an
    unknown one refuses the load. `--catalogue-only` also refuses bundle-declared entries the
    catalogue does not hold (the S5 rule: nothing unverified becomes a row);
  * every typed answer goes through the APP'S OWN marker (marker_check.mjs runs answer-marker.ts's
    `readMarkerSpec` and `validateKey`): a fresh bundle whose spec the app would reject, or whose
    key does not mark itself correct, is refused (a generated key is computed; one the marker
    cannot read is a broken family). A restore runs the same check where node exists;
  * a catalogue entry is NEVER edited here: a declared entry the database already has is left
    exactly as it is — its label, its description and its `generated_by` (the S5 author's
    attribution is not overwritten by the question generator's).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from pathlib import Path

import widget_spec

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
VALID_TYPES = {"mcq", "numeric", "widget", "short"}
FAMILY_NOTE = "template family "


def family_of(q: dict) -> str | None:
    """The item's family: the v2 field, else the legacy note ("Generated from template family X.")."""
    if q.get("family"):
        return q["family"]
    note = q.get("source_note") or ""
    return note.split(FAMILY_NOTE, 1)[1].rstrip(". ") if FAMILY_NOTE in note else None


def validate(
    bundle: dict,
    known_misconceptions: dict[str, str] | None = None,
    restoring: bool = False,
) -> tuple[list[str], list[str]]:
    """Structural validation. Correctness of the mathematics is the reviewer's job.

    What this can catch is the class of defect that makes an item unservable or
    silently wrong at the mechanical level: a tier the selector cannot ask for,
    an MCQ whose correct answer is not among its own choices, a missing
    solution. What it cannot catch is a plausible-looking wrong answer — which
    is the entire reason a human sample exists.
    """
    problems: list[str] = []
    # On a RESTORE some findings are reports, not refusals. The bundle is a
    # record of content that was already generated, reviewed and served; a
    # cross-objective misconception reference in it is a real inconsistency
    # worth fixing at the source, but refusing to reload it would make the
    # committed artifact unrestorable — which is worse, because then the only
    # copy of what students actually saw is one database.
    notes: list[str] = []
    seen: set[str] = set()
    # A freshly generated bundle declares the misconceptions it invented. A
    # RESTORE declares none — the catalogue is already loaded — so the caller
    # passes the database's view instead. Validating a restore against an empty
    # list would reject every distractor that names a real, loaded entry.
    lo_of_misconception = known_misconceptions if known_misconceptions is not None else {
        m["id"]: m.get("lo_id") for m in bundle.get("misconceptions", [])
    }

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
        if q.get("family"):
            note = q.get("source_note") or ""
            if FAMILY_NOTE in note and note.split(FAMILY_NOTE, 1)[1].rstrip(". ") != q["family"]:
                problems.append(f"{qid}: family {q['family']!r} disagrees with its source_note {note!r} "
                                "(the database keeps the note; a review verdict travels by it)")
        if q["question_type"] == "widget":
            # A widget's wrong answers are PREDICATES rather than options
            # (ADR-0009), so its structural checks live with the contract that
            # defines them. The checks that need the curriculum graph — does
            # this misconception exist, is it on this objective or one of its
            # prerequisites — ran in the generator, which has a database.
            problems += widget_spec.validate_widget(q, known_misconceptions=None)
        elif q["question_type"] == "mcq":
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
                    msg = (
                        f"{qid}: choice {c.get('key')} names misconception {mc!r} belonging to "
                        f"{lo_of_misconception[mc]}, not to this question's {q['lo_id']}"
                    )
                    (notes if restoring else problems).append(msg)
        elif q["question_type"] == "short":
            # a typed maths answer, marked by the expression marker (FR-4320): the spec is the
            # `choices` object, exactly as the loader stores it and the app reads it
            from pydantic import ValidationError
            from schemas import MarkerChoices
            try:
                MarkerChoices.model_validate(q.get("choices"))
            except ValidationError as exc:
                problems.append(f"{qid}: a typed answer carries its marker spec as choices "
                                f"{{'marker': …}} (contracts/answer-marker.md): {exc.errors()[0]['msg']}")
            if not str(q["correct_answer"]).strip():
                problems.append(f"{qid}: a typed answer still carries its answer as text, for the tutor")
        elif q.get("choices"):
            problems.append(f"{qid}: numeric question carries choices")
        tags = ([(c.get("key"), c.get("misconception_id")) for c in q.get("choices") or []
                 if isinstance(c, dict) and c.get("misconception_id")]
                if isinstance(q.get("choices"), list) else
                [(d.get("predicate"), d.get("misconception_id"))
                 for d in (q.get("choices") or {}).get("diagnostics") or [] if d.get("misconception_id")]
                if q["question_type"] == "widget" and isinstance(q.get("choices"), dict) else [])
        if q["question_type"] == "widget" and known_misconceptions is not None:
            # only against a real catalogue: a widget bundle declares none of its own
            for where, mc in tags:
                if mc not in lo_of_misconception:
                    problems.append(f"{qid}: diagnostic {where} names unknown misconception {mc!r}")
    return problems, notes


def catalogue_problems(bundle: dict, catalogue: dict[str, str], catalogue_only: bool) -> list[str]:
    """A FRESH bundle against the database's catalogue (id -> lo_id): every entry the bundle
    declares must agree with the catalogue on its objective, and — with `catalogue_only` —
    must already be in it. (The tags themselves are checked by `validate`, against the
    catalogue plus what the bundle declares.)"""
    problems = []
    for m in bundle.get("misconceptions", []):
        if m["id"] in catalogue:
            if catalogue[m["id"]] != m.get("lo_id"):
                problems.append(f"{m['id']}: the bundle puts it on {m.get('lo_id')}, the catalogue on "
                                f"{catalogue[m['id']]}")
        elif catalogue_only:
            problems.append(f"{m['id']}: declared by the bundle but not in the loaded catalogue — load "
                            "the S5 catalogue first (load_misconceptions.py); nothing unverified becomes a row")
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
    ap.add_argument("--restore", action="store_true",
                    help="the bundle is an EXPORT of state that was already loaded and "
                         "reviewed (export_generated_content.py), so honour its review "
                         "stamps instead of forcing reviewed_by=NULL. Never use this on "
                         "a freshly generated bundle: provenance is not something a "
                         "generator gets to assert about itself")
    ap.add_argument("--add-only", action="store_true",
                    help="insert questions the database does not have and leave every existing "
                         "row exactly as it is (status and review stamps included). The mode the "
                         "'Load a course' action uses, so a re-run can never revert a promotion")
    ap.add_argument("--course", help="refuse any item outside this course; print its counts")
    ap.add_argument("--catalogue-only", action="store_true",
                    help="refuse a misconception the bundle declares that the loaded catalogue does not "
                         "hold (the v2 line: S5 is the only source of catalogue rows)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    bundle = json.loads(args.bundle.read_text())

    known = None
    catalogue: dict[str, str] | None = None
    if args.dsn:
        import psycopg as _pg

        with _pg.connect(args.dsn) as _c, _c.cursor() as _cur:
            _cur.execute("SELECT id, lo_id FROM misconceptions")
            catalogue = dict(_cur.fetchall())
    if args.restore and args.dsn:
        known = catalogue
        if not known:
            print(
                "REFUSING: --restore with an empty misconception catalogue. Load the "
                "misconceptions bundle FIRST, or every distractor that names a real "
                "entry is reported as unknown.",
                file=sys.stderr,
            )
            return 2
    elif catalogue is not None:
        # a FRESH bundle is validated against the loaded catalogue plus what it declares
        known = dict(catalogue)
        known.update({m["id"]: m.get("lo_id") for m in bundle.get("misconceptions", [])
                      if m["id"] not in catalogue})

    problems, notes = validate(bundle, known, restoring=args.restore)
    typed = [{"id": q.get("id"), "choices": q.get("choices")} for q in bundle.get("questions", [])
             if q.get("question_type") == "short"]
    if typed:
        import shutil
        if shutil.which("node"):
            from assemble_lesson_bundle import marker_check
            mc = marker_check(typed)
            problems += [f"{x['id']}: the app's marker rejects its spec — {x['why']}" for x in mc["specs_rejected"]]
            problems += [f"{x['id']}: the app's marker cannot mark its key {x['key']!r} — {x['why']}"
                         for x in mc["keys_unreadable"]]
        elif not args.restore:
            problems.append(f"{len(typed)} typed answer(s) and no node to run the app's marker over them "
                            "(marker_check.mjs): a fresh bundle is not loaded unchecked")
        else:
            notes.append(f"{len(typed)} typed answer(s) restored without the marker check (no node here)")
    if catalogue is not None and not args.restore:
        problems += catalogue_problems(bundle, catalogue, args.catalogue_only)
    elif args.catalogue_only and catalogue is None:
        problems.append("--catalogue-only needs the database (--dsn): the catalogue is what it checks against")
    if problems:
        print("BUNDLE REJECTED\n", file=sys.stderr)
        for p in problems:
            print(f"  x {p}", file=sys.stderr)
        return 1

    if notes:
        # Printed every time, never suppressed: a restore that quietly tolerated
        # these would let the inconsistency live forever in the artifact.
        print(
            f"\n{len(notes)} cross-objective misconception reference(s) restored as-is "
            f"— fix at the source, not here:",
            file=sys.stderr,
        )
        for n in notes[:10]:
            print(f"  ! {n}", file=sys.stderr)
        if len(notes) > 10:
            print(f"  ! … and {len(notes) - 10} more", file=sys.stderr)
        print("", file=sys.stderr)

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

        if args.course:
            cur.execute("SELECT node_id FROM node_subject WHERE course_id = %s", (args.course,))
            course_los = {r[0] for r in cur.fetchall()}
            outside = sorted(q["id"] for q in questions if q["lo_id"] not in course_los)
            outside += sorted(m["id"] for m in misconceptions if m.get("lo_id") not in course_los)
            if outside:
                print(f"REFUSING: {len(outside)} item(s) are not on an objective of {args.course}: "
                      f"{outside[:6]}{' …' if len(outside) > 6 else ''}. Nothing was written.",
                      file=sys.stderr)
                return 1

        # `generated_by` is NOT NULL in the schema on purpose (migration 009):
        # attribution for machine-authored content is a column, not a convention,
        # so it cannot be omitted by a loader that forgets.
        generator = bundle.get("generator") or "unattributed-generator"

        # A catalogue entry is never edited here, in any mode: the catalogue's own loader owns
        # it (B19: one source), and the S5 author's `generated_by` is never overwritten by the
        # question generator's. A declared entry the database lacks is created, attributed to
        # this bundle's generator (the legacy path; --catalogue-only refuses it instead).
        created_mc = 0
        for m in misconceptions:
            cur.execute(
                """INSERT INTO misconceptions (id, lo_id, label, description, generated_by)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (id) DO NOTHING""",
                (m["id"], m.get("lo_id"), m["label"], m.get("description"), generator),
            )
            created_mc += cur.rowcount

        loaded = kept = 0
        conflict = ("ON CONFLICT (id) DO NOTHING" if args.add_only else
                    """ON CONFLICT (id) DO UPDATE"""
                    )
        for q in questions:
            cur.execute(
                """INSERT INTO questions
                     (id, lo_id, tier, question_type, stem, choices, correct_answer,
                      canonical_solution, solution_version, status, source,
                      parent_question_id, source_page, source_note, reviewed_by, reviewed_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,1,%s,'variant',%s,%s,%s,%s,%s)
                   """ + conflict + ("" if args.add_only else """
                     SET stem = EXCLUDED.stem,
                         choices = EXCLUDED.choices,
                         correct_answer = EXCLUDED.correct_answer,
                         canonical_solution = EXCLUDED.canonical_solution,
                         status = EXCLUDED.status,
                         reviewed_by = EXCLUDED.reviewed_by,
                         reviewed_at = EXCLUDED.reviewed_at"""),
                (
                    q["id"], q["lo_id"], q["tier"], q["question_type"], q["stem"],
                    json.dumps(q.get("choices")) if q.get("choices") else None,
                    str(q["correct_answer"]),
                    json.dumps(q["canonical_solution"]),
                    # A restore replays the status each row actually had; a fresh
                    # load applies one status to the whole bundle.
                    (q.get("status") or status) if args.restore else status,
                    q.get("parent_question_id"),
                    q.get("source_page"),
                    q.get("source_note"),
                    # RESTORE honours the stamps an export carries; a normal load
                    # forces them NULL, because the point of this loader is that a
                    # generator never asserts its own provenance (ADR-0008).
                    q.get("reviewed_by") if args.restore else None,
                    q.get("reviewed_at") if args.restore else None,
                ),
            )
            if cur.rowcount:
                loaded += 1
            else:
                kept += 1
        course_counts = None
        if args.course:
            cur.execute(
                """SELECT count(*) FILTER (WHERE question_type <> 'widget'),
                          count(*) FILTER (WHERE question_type <> 'widget' AND status = 'live'),
                          count(*) FILTER (WHERE question_type <> 'widget' AND status = 'review'),
                          count(*) FILTER (WHERE question_type <> 'widget' AND reviewed_by IS NULL),
                          count(*) FILTER (WHERE question_type = 'widget')
                     FROM questions
                    WHERE source = 'variant' AND materialised_from IS NULL
                      AND lo_id IN (SELECT node_id FROM node_subject WHERE course_id = %s)""",
                (args.course,))
            course_counts = cur.fetchone()
        conn.commit()

    if args.add_only:
        print(f"  add-only: inserted {loaded}, left {kept} existing question(s) exactly as they are")
    if course_counts:
        g, live, rev, unrev, w = course_counts
        print(f"  course counts: {args.course} generated={g} live={live} review={rev} "
              f"unreviewed={unrev} widgets={w}")
    if misconceptions:
        print(f"  catalogue: {created_mc} declared misconception(s) created, "
              f"{len(misconceptions) - created_mc} already loaded and left exactly as they are")
    print(f"  loaded {loaded} questions as status={status if not args.restore else 'as exported'}, "
          f"source='variant', reviewed_by={'as exported' if args.restore else 'NULL'}")

    if args.sample > 0:
        # STRATIFIED BY FAMILY, not uniform across items.
        #
        # The first round drew 53 items uniformly and covered only 30 of 35
        # families: some families were sampled three times and five were never
        # sampled at all, leaving 66 items with no path to review. Under the
        # template model a uniform draw is the wrong instrument — validation
        # travels along families, so the sample has to reach every family
        # exactly the way a stratified sample reaches every stratum.
        #
        # One item per family first, then the remainder spread at random to
        # reach the requested percentage.
        rng = random.Random(args.seed)
        by_family: dict[str, list[str]] = {}
        for q in questions:
            fam = family_of(q) or f"(no family) {q['id']}"
            by_family.setdefault(fam, []).append(q["id"])

        picked = {rng.choice(ids) for ids in by_family.values()}
        target = max(len(picked), round(len(questions) * args.sample / 100))
        rest = [q["id"] for q in questions if q["id"] not in picked]
        rng.shuffle(rest)
        picked.update(rest[: max(0, target - len(picked))])

        out = args.bundle.with_suffix(".review-queue.json")
        out.write_text(json.dumps(
            {"bundle": args.bundle.name, "sample_percent": args.sample,
             "seed": args.seed, "families": len(by_family),
             "question_ids": sorted(picked)}, indent=2) + "\n")
        print(f"  review queue: {len(picked)} of {len(questions)} items "
              f"covering all {len(by_family)} families -> {out.name}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

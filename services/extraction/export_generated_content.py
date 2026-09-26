"""Export one course's generated content back into loader-compatible bundles (B15).

    uv run export_generated_content.py --course course:us-g10-math-en [--dsn ...]
    uv run export_generated_content.py --course course:prep3-math-en            # seed/generated/
    uv run export_generated_content.py --course <id> --check                    # diff, write nothing

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

ONE COURSE AT A TIME (B15, G11). Every row is scoped to the course's own objectives
(`node_subject.course_id`), so a second maths course can never leak into another
course's files. Where the files go comes from the book config: the directory of its
`generated.misconceptions` file when it names one (Prep-3 maths: seed/generated/),
else seed/generated/<book>/ (Grade 10). Three bundles, in the shapes
`load_generated_questions.py` and `load_misconceptions.py` accept:

    generated-questions.json   source='variant', question_type <> 'widget'
    widget-questions.json      source='variant', question_type  = 'widget'
    misconceptions.json        the catalogue + its refutations

Without --course the old whole-database export still runs, but only while the
generated content belongs to one course; with two it refuses rather than mix them.

WHAT THE DATABASE DOES NOT HOLD IS CARRIED, NOT INVENTED (T422, decision 22). The
misconceptions table has no `kind` and no `aliases` (an alias is folded away on
load: its row is deleted). The committed catalogue is the single source for both,
so they are read from the file being replaced and written back unchanged — as is
every other field and every top-level key (`catalogue`, `course_id`,
`source_of_truth`, `reviewed`, `generator`, …), in its original order. An id the
database holds and the file does not is REFUSED: the file is the single source,
so such an id was added outside it. Only a course's FIRST export, with no file yet,
derives a kind from use (a book distractor map, else a generated distractor or
widget predicate, else conceptual) with no aliases. An entry of the file the
database does not hold is refused the same way: an export never edits the
source's id set. So file ->
database -> export returns the same file, byte for byte
(tests/test_export_generated_content.py).

REVIEW STAMPS TRAVEL. `reviewed_by` / `reviewed_at` are exported per question,
because the 10% human sample (ADR-0008) is the only thing separating "a human
read this" from "a machine wrote it", and a reload that silently dropped it
would quietly re-assert content as unreviewed — or worse, leave a surface
claiming a review that no longer has a record behind it. `reviewed_at` is written
in UTC, so the file does not depend on the exporting session's time zone.

MATERIALISED ROWS ARE NOT EXPORTED. A widget the tutor improvised for one
student (ADR-0009 §3) is that session's artefact awaiting review, not content to
seed another machine with.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import timezone
from pathlib import Path

import book_config

HERE = Path(__file__).resolve().parent
GENERATOR = ("exported from the live comparison database — "
             "services/extraction/export_generated_content.py")
ENTRY_ORDER = ("id", "lo_id", "label", "description", "signal", "kind", "refutation", "maps",
               "aliases")
FILES = ("generated-questions.json", "widget-questions.json", "misconceptions.json")


def rows(cur, sql: str, args: tuple = ()) -> list[dict]:
    cur.execute(sql, args)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def course_los(cur, course: str | None) -> list[str] | None:
    """The course's objective ids, or None for the unscoped (whole-database) export."""
    if course is None:
        return None
    cur.execute("SELECT node_id FROM node_subject WHERE course_id = %s ORDER BY node_id", (course,))
    los = [r[0] for r in cur.fetchall()]
    if not los:
        raise SystemExit(f"{course}: no objectives in this database — nothing to export")
    return los


def _scope(los: list[str] | None, col: str = "lo_id") -> tuple[str, tuple]:
    return ("", ()) if los is None else (f" AND {col} = ANY(%s)", (los,))


def question_bundle(cur, widgets: bool, generator: str, los: list[str] | None = None,
                    prior: dict | None = None) -> dict:
    op = "=" if widgets else "<>"
    where, args = _scope(los)
    qs = rows(
        cur,
        f"""SELECT id, lo_id, tier, question_type, stem, choices, correct_answer,
                   canonical_solution, status, parent_question_id, source_page,
                   source_note, reviewed_by, reviewed_at
              FROM questions
             WHERE source = 'variant'
               AND question_type {op} 'widget'
               AND materialised_from IS NULL{where}
             ORDER BY lo_id, id""", args,
    )
    for q in qs:
        # The loader re-derives these; exporting them keeps the bundle a faithful
        # record of what was served rather than a request to re-derive.
        ts = q["reviewed_at"]
        q["reviewed_at"] = ts.astimezone(timezone.utc).isoformat() if ts else None
    return _header(prior, {"generator": generator, "questions": qs, "misconceptions": []},
                   "questions")


def _header(prior: dict | None, fresh: dict, body: str) -> dict:
    """The fresh bundle, keeping the previous file's top-level keys, their values and their
    order; only the body (`questions` / `misconceptions`) comes from the database."""
    if not prior:
        return fresh
    out = {}
    for k, v in prior.items():
        out[k] = fresh[k] if k in (body, "misconceptions", "questions") and k in fresh else v
    for k, v in fresh.items():
        out.setdefault(k, v)
    return out


def _kind(mid: str, maps: dict, generated_uses: set[str]) -> str:
    if maps.get(mid):
        return "book_distractor"
    return "generated_distractor" if mid in generated_uses else "conceptual"


class CatalogueDrift(Exception):
    """The database holds catalogue ids its source file does not (decision 22)."""


def misconception_bundle(cur, generator: str, los: list[str] | None = None,
                         prior: dict | None = None) -> tuple[dict, list[str]]:
    """(bundle, ids of the previous file's entries the database no longer holds).

    With a previous file, that file is the catalogue's single source (decision 22): an id
    only the database holds was added outside it, and the export refuses rather than
    promote it into the source with a guessed kind (CatalogueDrift).
    """
    where, args = _scope(los)
    ms = rows(cur, f"""SELECT id, lo_id, label, description, signal
                         FROM misconceptions WHERE TRUE{where} ORDER BY lo_id, id""", args)
    refs = {
        r["misconception_id"]: r
        for r in rows(
            cur,
            f"""SELECT misconception_id, content, source_page, reviewed
                  FROM explanation_library
                 WHERE entry_type = 'refutation' AND misconception_id IS NOT NULL{where}""", args)
    }
    # THE BOOK DISTRACTOR MAPS.
    #
    # A misconception's link to a printed distractor lives on the QUESTION —
    # `choices[].misconception_id` — not in the misconceptions table, so a
    # naive export drops all of them and the restored database can no longer
    # diagnose a single book multiple-choice answer. Nothing errors; the tutor
    # just stops recognising the mistakes the ministry's own authors encoded.
    #
    # They are read back here by exact choice TEXT (never position — the
    # key-balancing pass rearranges keys), which is the same contract
    # load_misconceptions.py stamps them with.
    maps: dict[str, list[dict]] = {}
    for q in rows(
        cur,
        f"""SELECT id, choices FROM questions
             WHERE question_type = 'mcq' AND source IN ('seed', 'authored')
               AND choices IS NOT NULL{where} ORDER BY id""", args,
    ):
        for c in q["choices"] or []:
            mid = c.get("misconception_id")
            if mid:
                maps.setdefault(mid, []).append(
                    {"question_id": q["id"], "choice_text": c.get("text")}
                )
    generated_uses: set[str] = set()
    variant_stamps: dict[tuple[str, str], str] = {}
    for q in rows(cur, f"""SELECT id, choices FROM questions
                            WHERE source = 'variant' AND choices IS NOT NULL{where}""", args):
        ch = q["choices"]
        items = ch if isinstance(ch, list) else (ch or {}).get("diagnostics") or []
        generated_uses |= {c.get("misconception_id") for c in items if isinstance(c, dict)}
        if isinstance(ch, list):
            variant_stamps.update({(q["id"], c.get("text")): c["misconception_id"]
                                   for c in ch if c.get("misconception_id")})

    prior_entries = {m["id"]: m for m in (prior or {}).get("misconceptions", [])}
    # A catalogue map may also point at a GENERATED question's option. Such a stamp cannot
    # be told apart from the generator's own tag, so it is recovered only where the previous
    # file names it AND the database still carries it — confirmed, never inferred.
    for mid, old in prior_entries.items():
        for x in old.get("maps", []):
            if variant_stamps.get((x.get("question_id"), x.get("choice_text"))) == mid \
                    and x not in maps.get(mid, []):
                maps.setdefault(mid, []).append(
                    {"question_id": x["question_id"], "choice_text": x["choice_text"]})
    fresh: dict[str, dict] = {}
    for m in ms:
        r = refs.get(m["id"])
        content = r["content"] if r else None
        steps = content if isinstance(content, list) else (content or {}).get("steps", [])
        old = prior_entries.get(m["id"])
        mp = maps.get(m["id"], [])
        if old is not None:
            # keep the previous file's order of the maps it already had
            known = [x for x in old.get("maps", []) if x in mp]
            mp = known + [x for x in mp if x not in known]
        entry = {**m, "kind": _kind(m["id"], maps, generated_uses), "refutation": steps,
                 "maps": mp, "aliases": []}
        if old is not None:
            # the database is the truth for what it stores; the file for the rest
            carried = {k: v for k, v in old.items() if k not in entry or k in ("kind", "aliases")}
            order = list(old) + [k for k in ENTRY_ORDER if k not in old]
            entry = {k: (carried[k] if k in carried else entry[k]) for k in order
                     if k in carried or k in entry}
        fresh[m["id"]] = entry
    # An alias row the loader could not fold away (a student's attempt cites it, so it is
    # kept: load_misconceptions.py) is the file's alias, not a rival entry.
    alias_ids = {a for m in prior_entries.values() for a in m.get("aliases", [])}
    for a in alias_ids - set(prior_entries):
        fresh.pop(a, None)
    # the previous file's order first; new entries after, by objective and id
    ordered = [fresh[i] for i in prior_entries if i in fresh]
    ordered += [fresh[i] for i in sorted(set(fresh) - set(prior_entries),
                                         key=lambda i: (fresh[i]["lo_id"], i))]
    gone = sorted(set(prior_entries) - set(fresh))
    if prior is not None and gone:
        raise CatalogueDrift(
            f"{len(gone)} misconception id(s) in the catalogue file are not in the database: "
            f"{gone[:8]}{' …' if len(gone) > 8 else ''}. Load the file first "
            "(load_misconceptions.py); an export never edits the source's id set. Nothing was "
            "written.")
    if prior is not None and (new := sorted(set(fresh) - set(prior_entries))):
        raise CatalogueDrift(
            f"{len(new)} misconception id(s) are in the database but not in the catalogue file, "
            f"which is the single source (decision 22): {new[:8]}{' …' if len(new) > 8 else ''}. "
            "Add them to the file (with their kind and aliases) and load it, or remove them from "
            "the database. Nothing was written.")
    total = sum(len(v) for v in maps.values())
    print(f"  book distractor mappings recovered from questions.choices: {total}")
    return _header(prior, {"generator": generator, "misconceptions": ordered},
                   "misconceptions"), gone


def out_dir_for(course: str | None) -> Path:
    if course is None:
        return HERE / "seed" / "generated"
    book = book_config.book_for_course(course)
    if book is None:
        raise SystemExit(f"{course}: no book config names this course (books/*.json)")
    if book.generated and book.generated.misconceptions:
        return book.repo_path(book.generated.misconceptions).parent
    return HERE / "seed" / "generated" / book.book


def courses_with_generated(cur) -> list[str]:
    cur.execute("""SELECT DISTINCT ns.course_id
                     FROM node_subject ns
                    WHERE ns.node_id IN (SELECT lo_id FROM questions WHERE source = 'variant'
                                         UNION SELECT lo_id FROM misconceptions)
                    ORDER BY 1""")
    return [r[0] for r in cur.fetchall()]


def dump(bundle: dict) -> str:
    return json.dumps(bundle, indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", help="the course whose generated content to export (B15)")
    ap.add_argument("--out-dir", type=Path,
                    help="default: from the course's book config (see above)")
    ap.add_argument("--prior", type=Path,
                    help="where the files being replaced are (default: --out-dir). Their kind, "
                         "aliases, extra fields and order are carried over")
    ap.add_argument("--dsn", default=os.environ.get("AINEXT_DB_DSN"))
    ap.add_argument("--check", action="store_true",
                    help="write nothing; exit 1 if the export would change a file")
    args = ap.parse_args(argv)
    if not args.dsn:
        print("ERROR: pass --dsn or set AINEXT_DB_DSN", file=sys.stderr)
        return 2

    import psycopg

    out_dir = args.out_dir or out_dir_for(args.course)
    prior_dir = args.prior or out_dir

    def prior(name: str) -> dict | None:
        p = prior_dir / name
        return json.loads(p.read_text()) if p.exists() else None

    with psycopg.connect(args.dsn) as conn, conn.cursor() as cur:
        if args.course is None:
            owners = courses_with_generated(cur)
            if len(owners) > 1:
                print(f"REFUSING: generated content belongs to {len(owners)} courses "
                      f"({', '.join(owners)}). An unscoped export would write them into one "
                      "set of files. Pass --course <id>.", file=sys.stderr)
                return 2
        los = course_los(cur, args.course)
        try:
            mc_bundle, gone = misconception_bundle(cur, GENERATOR, los,
                                                   prior("misconceptions.json"))
        except CatalogueDrift as exc:
            print(f"REFUSING: {exc}", file=sys.stderr)
            return 1
        bundles = {
            "generated-questions.json": question_bundle(cur, False, GENERATOR, los,
                                                        prior("generated-questions.json")),
            "widget-questions.json": question_bundle(cur, True, GENERATOR, los,
                                                     prior("widget-questions.json")),
            "misconceptions.json": mc_bundle,
        }

    changed = []
    for name in FILES:
        bundle, path = bundles[name], out_dir / name
        text = dump(bundle)
        same = path.exists() and path.read_text() == text
        n = len(bundle.get("questions") or bundle.get("misconceptions") or [])
        reviewed = sum(1 for q in (bundle.get("questions") or []) if q.get("reviewed_by"))
        extra = f", {reviewed} carrying a review stamp" if reviewed else ""
        if not same:
            changed.append(name)
        if args.check:
            print(f"{'unchanged' if same else 'WOULD CHANGE'} {path} — {n} record(s){extra}")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        print(f"wrote {path} — {n} record(s){extra}" + ("" if not same else " (unchanged)"))
    scope = args.course or "the whole database"
    print(f"exported {scope}: {len(changed)} of {len(FILES)} file(s) "
          f"{'would change' if args.check else 'changed'}")
    return 1 if args.check and changed else 0


if __name__ == "__main__":
    raise SystemExit(main())

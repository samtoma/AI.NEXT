"""Load a book-record unit the way Samuel's runbook §6 loads a chapter: audited, validated, previewed, then loaded.

    uv run book_record_load.py prep3-math-en 1 --dsn postgres://…            # the honest preview: nothing is kept
    uv run book_record_load.py prep3-math-en 1 --dsn postgres://… --go       # load, stamp the reviews, parity check (needs G5 GO)
    uv run book_record_load.py prep3-math-en 1 --dsn postgres://127.0.0.1/… --scratch   # a local scratch database, no G5

Run from services/extraction/ after compile_book_records.py and book_record_coverage.py. In order, stopping at the
first that fails:
  1. the unit's coverage audit (coverage/<book>.unit<NN>.book-records.json) is GREEN, and every file it read is
     unchanged since (its `inputs` fingerprint): a stale audit is no audit. --scratch skips this: a local scratch
     load comes mid-run, before the audit can hold, as Samuel's fan-out loads his preview database before the gates;
  2. `load_seed.py --validate-only` on the course's bundles: a compiled unit replaces the course bundle of the same
     name (compiled/<book>/unit1.json for seed/unit1.json), every other bundle of the course comes as it is;
  3. every loader's dry run on the real database, inside a transaction that is rolled back: `load_seed.py --course
     <id> --replace --dry-run`, `load_misconceptions.py --dry-run`, `load_generated_questions.py --add-only --catalogue-only --dry-run` (add-only:
     a re-run never reverts a promotion; catalogue-only: no misconception the catalogue does not hold);
  4. only with --go, and only on a person's GO at G5 for the unit as it stands (book_record_gonogo.py; Samuel's runbook §8),
     or with --scratch into a database on this machine (localhost: what S7 builds against and the fan-out loads,
     as Samuel's fan-out loads his local preview database before G5; no parity check, the course's shape is not
     final mid-run): the same loads for real, `apply_review_verdicts.py --book-reviews` (the review tool's decisions
     as human stamps), then `parity_check.py --candidate <dsn> --course <id>` — Samuel's per-course drift check.
     A course whose expected numbers the book config's `parity` gives must still match them; this unit changing the
     course on purpose is a change to that constant, made by a person, never by this script.
The loaders are Samuel's, unchanged; this only puts them in his order behind the audit.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_config  # noqa: E402
import book_record_coverage as COV  # noqa: E402


def course_bundles(book, compiled: Path) -> list[Path]:
    """The course's bundles with the compiled units in place of the ones they replace, then any new compiled bundle."""
    cfg = json.loads(book.path.read_text())
    out, names = [], set()
    for rel in cfg.get("bundles") or []:
        p = book_config.REPO_ROOT / rel
        c = compiled / p.name
        out.append(c if c.exists() else p)
        names.add(p.name)
    skip = {"compile-report.json", "review-stamps.json", "generated-questions.json", "widget-questions.json", "misconceptions.json"}
    for c in sorted(compiled.glob("*.json")):
        if c.name not in names and c.name not in skip and "nodes" in json.loads(c.read_text()):
            out.append(c)
    return out


def audit_ok(book: str, unit: int, compiled: Path) -> tuple[bool, str]:
    f = HERE / "coverage" / f"{book}.unit{unit:02d}.book-records.json"
    if not f.exists():
        return False, f"no coverage audit: run book_record_coverage.py {book} {unit}"
    rep = json.loads(f.read_text())
    if rep.get("status") != "GREEN":
        fails = [c["id"] for c in rep["checks"] if c["state"] == "fails"]
        return False, f"the coverage audit is RED ({', '.join(fails)}): fix each at its stage, or a person signs an exception"
    now = COV.fingerprint(book, rep["lessons"], compiled)
    changed = sorted(k for k in set(now) | set(rep.get("inputs") or {}) if now.get(k) != (rep.get("inputs") or {}).get(k))
    if changed:
        return False, f"the audit is stale: {len(changed)} file(s) changed since ({', '.join(changed[:4])}…): run it again"
    return True, f"coverage GREEN ({rep['summary']['hold']} hold, {rep['summary']['excepted']} excepted)"


def step(label: str, argv: list[str], env: dict) -> None:
    print(f"\n== {label}\n   uv run {' '.join(argv)}", file=sys.stderr)
    p = subprocess.run(["uv", "run", *argv], cwd=HERE, env=env, text=True, capture_output=True)
    sys.stderr.write(p.stdout[-3000:] + p.stderr[-3000:])
    if p.returncode != 0:
        raise SystemExit(f"STOPPED at {label} (exit {p.returncode}); nothing after it ran")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("book")
    ap.add_argument("unit", type=int)
    ap.add_argument("--dsn", default=os.environ.get("AINEXT_DB_DSN"), help="the database (default $AINEXT_DB_DSN)")
    ap.add_argument("--compiled", type=Path)
    ap.add_argument("--go", action="store_true", help="load for real after the previews pass (needs G5 GO)")
    ap.add_argument("--scratch", action="store_true", help="load for real into a database on this machine, without G5")
    a = ap.parse_args(argv)
    book = book_config.load_book(a.book)
    compiled = a.compiled or HERE / "compiled" / book.book
    ok, why = audit_ok(book.book, a.unit, compiled)
    print(f"== coverage: {why}", file=sys.stderr)
    if not ok and not a.scratch:   # a local scratch load comes mid-run, before the audit can hold (S7 builds against it)
        return 1
    if not a.dsn:
        raise SystemExit("--dsn (or AINEXT_DB_DSN) is needed: the previews run on the real database and are rolled back")
    if a.go and a.scratch:
        raise SystemExit("--go or --scratch, not both")
    if a.scratch:
        from urllib.parse import urlparse  # noqa: PLC0415
        if urlparse(a.dsn).hostname not in ("127.0.0.1", "localhost", "::1"):
            raise SystemExit("--scratch loads only into a database on this machine; any other needs --go and G5")
    if a.go:
        import book_record_gonogo as G5  # noqa: PLC0415
        go, why = G5.current_go(book.book, a.unit)
        print(f"== G5: {why}", file=sys.stderr)
        if not go:
            return 1
    load = a.go or a.scratch
    env = {**os.environ, "AINEXT_DB_DSN": a.dsn, "AINEXT_ENVIRONMENT": os.environ.get("AINEXT_ENVIRONMENT", "mvp1")}
    bundles = [str(p.relative_to(HERE)) if p.is_relative_to(HERE) else str(p) for p in course_bundles(book, compiled)]
    gen = [n for n in ("misconceptions.json", "generated-questions.json", "widget-questions.json") if (compiled / n).exists()]
    rel = lambda n: str((compiled / n).relative_to(HERE))
    step("validate the bundles", ["load_seed.py", *bundles, "--validate-only"], env)
    for dry in ([True, False] if load else [True]):
        tag = "preview (rolled back)" if dry else "LOAD"
        d = ["--dry-run"] if dry else []
        step(f"{tag}: the course's book content", ["load_seed.py", *bundles, "--course", book.course_id, "--replace", *d], env)
        if "misconceptions.json" in gen:
            step(f"{tag}: misconceptions", ["load_misconceptions.py", rel("misconceptions.json"), "--course", book.course_id, *d], env)
        for n in gen[1:] if "misconceptions.json" in gen else gen:
            step(f"{tag}: {n}", ["load_generated_questions.py", rel(n), "--course", book.course_id, "--add-only", "--catalogue-only", *d], env)
    if load:
        if (compiled / "review-stamps.json").exists():
            step("the review tool's decisions as human stamps", ["apply_review_verdicts.py", "--book-reviews", rel("review-stamps.json")], env)
        if a.go:   # a scratch load is mid-run: a course's parity constant is a person's, set once its shape is final
            step("parity: the course has not drifted", ["parity_check.py", "--candidate", a.dsn, "--course", book.course_id], env)
        print(f"\nloaded {book.book} unit {a.unit} into the database; parity holds", file=sys.stderr)
    else:
        print("\nevery preview passed; nothing was kept. --go loads it.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

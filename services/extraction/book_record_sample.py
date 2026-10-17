"""The review sample of generated questions: Samuel's stratified 10% (Tamer, 2026-10-17: "use sampling like the Grade 10
pipeline to stay affordable").

    uv run book_record_sample.py prep3-math-en [--percent 10] [--seed 20261017]

On Grade 10 generated maths loads live (Samuel's answer 37a) and a sample goes to a person (load_generated_questions.py
--sample, his decision of 2026-09-10): one question from every family, so no family escapes review, then the rest at
random up to the percentage. This draws that sample, with his own function (load_generated_questions.review_sample),
over the generated and widget questions the review tool's Generated content task lists for the book, and writes it to
reviews/<book>/generated-review-sample.json (format `ainext.review-sample/1`): the percentage, the seed, and the question
ids. The task then asks a person for the sampled questions only; the others stay live and can still be reviewed.
Misconceptions, widget mappings and figures are not sampled: every one is reviewed, as on Grade 10.

Re-runnable: a question already in the sample stays in it while it exists, so a person's past reviews still count;
only a family with no sampled question, and the top-up to the percentage, are drawn again (with the recorded seed).
Run it after compile, and again whenever generation adds questions.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "groundtruth" / "review"))
import generated as GEN  # noqa: E402  (the review task's own list of generated content)
import load_generated_questions as LG  # noqa: E402  (Samuel's review_sample)

FORMAT = "ainext.review-sample/1"


def path(book: str) -> Path:
    return GEN.REVIEWS / book / "generated-review-sample.json"


def questions(book: str) -> list[dict]:
    return [it for (kind, _ref), it in GEN.load(book)["items"].items() if kind in ("question", "widget")]


def draw(book: str, percent: int, seed: int | None) -> dict:
    p = path(book)
    prev = json.loads(p.read_text()) if p.exists() else {}
    seed = seed if seed is not None else prev.get("seed", int(date.today().strftime("%Y%m%d")))
    qs = questions(book)
    picked, families = LG.review_sample(qs, percent, seed, keep=set(prev.get("question_ids") or []))
    doc = {"format": FORMAT, "book": book, "percent": percent, "seed": seed, "families": families,
           "questions": len(qs), "sampled": len(picked), "question_ids": sorted(picked),
           "made": date.today().isoformat(), "rule": "Samuel's stratified sample (load_generated_questions.review_sample)"}
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    return doc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("book")
    ap.add_argument("--percent", type=int, default=10)
    ap.add_argument("--seed", type=int, help="default: the recorded one, else today's date")
    a = ap.parse_args(argv)
    d = draw(a.book, a.percent, a.seed)
    print(f"{d['sampled']} of {d['questions']} generated questions sampled for review ({d['percent']}%, every one of "
          f"{d['families']} families, seed {d['seed']}) → {path(a.book).relative_to(HERE)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

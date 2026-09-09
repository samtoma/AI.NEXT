#!/usr/bin/env python3
"""Stage-0 manifest for the refutation workflow (ADR-0007, Phase 6).

Flattens the maths seed bundles into one manifest of learning objectives, each
carrying the questions and canonical solutions students are actually graded on.
The refutation workflow authors against THIS, so the library it produces is
anchored to the same rows both environments serve — not to a re-reading of the
PDF, which could drift from what is loaded.

Same role as manifest/social-prep3-t1.json in the extraction line: config the
workflow consumes, generated rather than hand-maintained because it is 90
objectives deep.

Usage:
    uv run build_lo_manifest.py [--out manifest/math-los.json] [--lo lo:u1-1-1 ...]
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(__file__)
SEED = os.path.join(HERE, "seed")
BUNDLES = [
    "unit1.json", "unit2.json", "unit3.json", "unit4.json", "unit5.json",
    "geo-unit1.json", "t2-unit12.json", "t2-unit3.json",
    "geo-unit2a.json", "geo-unit2b.json",
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=os.path.join(HERE, "manifest", "math-los.json"))
    ap.add_argument("--lo", action="append", help="restrict to these LO ids (repeatable)")
    args = ap.parse_args()

    only = set(args.lo or [])
    los: dict[str, dict] = {}

    for name in BUNDLES:
        path = os.path.join(SEED, name)
        if not os.path.exists(path):
            print(f"  skip (missing): {name}", file=sys.stderr)
            continue
        b = json.load(open(path, encoding="utf-8"))
        for n in b.get("nodes", []):
            if n.get("kind") != "learning_objective":
                continue
            if only and n["id"] not in only:
                continue
            los[n["id"]] = {
                "id": n["id"],
                "label": n.get("label"),
                "description": n.get("description"),
                "page": n.get("source_page"),
                "questions": [],
            }
        for q in b.get("questions", []):
            lo = los.get(q.get("lo"))
            if lo is None:
                continue
            lo["questions"].append({
                "id": q["id"],
                "tier": q.get("tier"),
                "type": q.get("type"),
                "stem": q.get("stem"),
                "answer": q.get("answer"),
                "solution": q.get("solution"),
                "source_page": q.get("source_page"),
            })

    ordered = [los[k] for k in sorted(los)]
    # An objective with no questions has nothing for a refutation to be anchored
    # to, so the workflow would be authoring against thin air. Surface it here
    # rather than letting it produce plausible-looking unanchored content.
    empty = [lo["id"] for lo in ordered if not lo["questions"]]

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"learning_objectives": ordered}, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    total_q = sum(len(lo["questions"]) for lo in ordered)
    print(f"wrote {args.out}")
    print(f"  learning objectives : {len(ordered)}")
    print(f"  questions attached  : {total_q}")
    if empty:
        print(f"  ⚠ {len(empty)} objective(s) carry no questions — nothing to anchor a "
              f"refutation to: {', '.join(empty[:6])}{' …' if len(empty) > 6 else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

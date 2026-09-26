#!/usr/bin/env python3
"""Merge a reviewed Social Studies full-book run into one lessons file.

    uv run merge_final.py --base runs/prep3-social-ar/lessons/fullbook.json \
        --audit runs/prep3-social-ar/audit-claims/audit_bad.json \
        [--rerun runs/prep3-social-ar/lessons/rerun_soc21_23.json] \
        --out runs/prep3-social-ar/fullbook_final.json [--book prep3-social-ar]

  - base:   the rich-lesson workflow's return value (every lesson)
  - rerun:  optional clean re-runs of some lessons -> replace those lessons
  - audit:  claims the audit-claims workflow ruled bad -> remove each claim, and
            any question whose solution rests SOLELY on dropped claims
  - out:    the merged file assemble_fullbook.py reads

Every path is an argument (B20, G2): the inputs used to be hard-coded under
/tmp, which is why the Social Studies book cannot be reproduced today — the
2026-07 run's inputs were never committed. Save workflow outputs under
services/extraction/runs/<book>/ and commit them (extraction-pipeline.md §4).

The lesson order comes from the book config's `content_files`.
"""
import argparse
import json
from pathlib import Path

import book_config


def merge(base: dict, rerun: dict | None, bad: dict, order: list[str]) -> tuple[dict, int, int]:
    lessons = {L["lessonId"]: L for L in base["lessons"]}

    # 1) swap in clean re-runs
    for L in (rerun or {}).get("lessons", []):
        lessons[L["lessonId"]] = L
        print(f"replaced {L['lessonId']} with clean re-run")

    # 2) drop audit-flagged bad claims + questions that depend only on them
    dropped_c = dropped_q = 0
    for lid, items in bad.items():
        badset = {i["claim_ar"] for i in items}
        L = lessons.get(lid)
        if not L:
            continue
        for s in L.get("subtopics", []):
            cl = (s.get("claims") or {}).get("claims", [])
            s["claims"]["claims"] = [c for c in cl if c["claim_ar"] not in badset]
            dropped_c += len(cl) - len(s["claims"]["claims"])
            qs = (s.get("questions") or {}).get("questions", [])
            keep = []
            for q in qs:
                steps = q.get("solution") or []
                sol_claims = {st.get("claim_ar") for st in steps if isinstance(st, dict)}
                # drop the question only if EVERY solution step rests on a bad claim
                if sol_claims and sol_claims <= badset:
                    dropped_q += 1
                    continue
                keep.append(q)
            s["questions"]["questions"] = keep
    missing = [k for k in order if k not in lessons]
    if missing:
        raise SystemExit(f"lessons missing from the merge: {', '.join(missing)}")
    return {"lessons": [lessons[k] for k in order]}, dropped_c, dropped_q


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", type=Path, required=True)
    ap.add_argument("--rerun", type=Path, help="optional clean re-runs that replace lessons")
    ap.add_argument("--audit", type=Path, required=True, help="{lessonId: [{claim_ar, …}]} ruled bad")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--book", default="prep3-social-ar")
    a = ap.parse_args()

    book = book_config.load_book(a.book)
    order = [Path(p).stem for p in book.content_files]
    rerun = json.loads(a.rerun.read_text()) if a.rerun else None
    if a.rerun is None:
        print("no --rerun given — every lesson comes from --base")
    out, dropped_c, dropped_q = merge(json.loads(a.base.read_text()), rerun,
                                      json.loads(a.audit.read_text()), order)
    print(f"dropped {dropped_c} bad claims, {dropped_q} dependent questions")
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(out, ensure_ascii=False))
    print(f"wrote {a.out} with {len(out['lessons'])} lessons")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

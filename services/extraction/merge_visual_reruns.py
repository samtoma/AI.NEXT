"""Merge a visuals-only lesson run (lesson.workflow.js with args.visuals_only) into the lesson runs.

    uv run merge_visual_reruns.py <rerun.json> [--lessons-dir runs/<book>/lesson] [--dry-run]

WHY (consistency review 2026-09-27, A3/A8). S4 failed for figures of Chapter 8 — the visuals agent returned nothing
for lesson 8.2, and 8.3b's figures were dropped as "unknown objective" — and eight figures drew the question's
unknown. Re-running whole lessons would re-run S2/S3 (claims, typing, blind checks) that G2 has already passed;
instead lesson.workflow.js runs S4 alone for the named figures, and this merges its return:

  - for each figure the re-run names (its `rerun_figures`), the lesson run's old visual and old gap are removed,
    and whatever the re-run produced for it — a visual or a reasoned gap — takes their place;
  - a kept visual keeps its number (its bundle id v:<lesson>:<n> is stable); a new visual takes the next number;
  - the lesson run records the re-run (`visual_reruns`), and the file before the merge is kept under
    <lessons-dir>/superseded/.

Nothing else in the lesson run changes: items, claims, G2's verdicts and the verification record stay as they were.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def merge_one(run: dict, rerun: dict, run_id: str | None) -> tuple[dict, dict]:
    figs = set(rerun.get("rerun_figures") or [])
    if not figs:
        raise ValueError(f"{rerun.get('lesson')}: the re-run names no figure")
    out = dict(run)
    kept = [v for v in run.get("visuals") or [] if v.get("figure_id") not in figs]
    gaps = [g for g in run.get("viz_gaps") or [] if g.get("figure_id") not in figs]
    n = max([v.get("n", 0) for v in run.get("visuals") or []] + [0])
    added = []
    for v in rerun.get("visuals") or []:
        if v.get("figure_id") not in figs:
            raise ValueError(f"{rerun.get('lesson')}: the re-run returned a visual for {v.get('figure_id')}, "
                             "which it was not asked for")
        n += 1
        added.append({**v, "n": n})
    new_gaps = [g for g in rerun.get("viz_gaps") or [] if g.get("figure_id") in figs]
    out["visuals"] = kept + added
    out["viz_gaps"] = gaps + new_gaps
    out["visual_reruns"] = list(run.get("visual_reruns") or []) + [
        {"run_id": run_id, "figures": sorted(figs), "visuals": len(added), "gaps": len(new_gaps)}]
    counts = dict(out.get("counts") or {})
    counts["visuals"], counts["viz_gaps"] = len(out["visuals"]), len(out["viz_gaps"])
    out["counts"] = counts
    return out, {"lesson": rerun.get("lesson"), "figures": len(figs), "visuals": len(added), "gaps": len(new_gaps),
                 "replaced_visuals": len(run.get("visuals") or []) - len(kept),
                 "replaced_gaps": len(run.get("viz_gaps") or []) - len(gaps)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("rerun", type=Path, help="the visuals-only run's return value")
    ap.add_argument("--lessons-dir", type=Path, help="default runs/<book>/lesson")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    rr = json.loads(a.rerun.read_text())
    if rr.get("mode") != "visuals":
        print(f"{a.rerun}: not a visuals-only lesson run (mode {rr.get('mode')!r})", file=sys.stderr)
        return 2
    d = a.lessons_dir or HERE / "runs" / str(rr.get("book")) / "lesson"
    for les in rr.get("lessons") or []:
        path = d / f"{les['lesson']}.json"
        if not path.exists():
            print(f"{les['lesson']}: no lesson run at {path}", file=sys.stderr)
            return 2
        try:
            merged, rep = merge_one(json.loads(path.read_text()), les, rr.get("run_id"))
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        print(f"{rep['lesson']}: {rep['figures']} figure(s) re-run → {rep['visuals']} visual(s), {rep['gaps']} gap(s) "
              f"(replacing {rep['replaced_visuals']} visual(s), {rep['replaced_gaps']} gap(s))")
        if not a.dry_run:
            (d / "superseded").mkdir(exist_ok=True)
            shutil.copy2(path, d / "superseded" / f"{les['lesson']}.before-visuals-{rr.get('run_id') or 'rerun'}.json")
            path.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n")
    if rr.get("failed_lessons"):
        print(f"not merged — these lessons failed in the re-run: {rr['failed_lessons']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

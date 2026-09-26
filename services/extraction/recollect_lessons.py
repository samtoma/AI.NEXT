"""Re-collect a saved lesson run with the CURRENT script, from its agents' recorded answers — no model call.

    uv run recollect_lessons.py runs/<book>/lessons/<runId>.json [...] [--out-dir DIR] [--dry-run]

WHY. lesson.workflow.js does two things: it asks agents (claims, typing, blind re-solve, tier, judge,
visuals, oracle), and it COLLECTS their answers deterministically (the three-way check, the typing
check, what goes to the judge). When the collection is fixed (COLLECT_VERSION), the saved runs'
agent answers are still good; only the collection must be re-done. A Workflow resume would replay
the cached agents too — but only up to the first agent whose prompt changed, and a collection fix
usually changes the JUDGE's prompt (the pairs it is asked about are decided by the collection), so
the judge, the visuals and the oracle after it would run live. This tool re-runs the current script
through the stub runtime (tests/workflow_stub.mjs) with every agent answered from the run's own
journal, and PROVES what it reused:

  * the script is the CURRENT runbook script with the saved run's own args embedded, exactly as
    embed_workflow.py generates a copy: the args are taken from a generated copy whose args_sha256
    is the saved run's (`embedded.args_sha256`) — work/<book>/packets/embedded/, or a superseded copy
    under it — so the output names the very copy (generated_sha256) a Workflow resume would run;
  * every agent prompt the current script sends is compared with the prompt the recorded agent was
    given (its transcript). An identical prompt replays its recorded answer. A changed prompt is
    refused — except the judge's, which is checked PAIR BY PAIR: a verdict is reused only for a pair
    whose id AND two answers are exactly those the judge was shown; any other pending pair is
    reported as needing a live judge call (it stays `unclear`, so the item stays held);
  * a call the recorded run never made (a `…:again` retry) has no answer: it is reported, and the
    output is not written unless --allow-missing (then that agent is treated as having returned
    nothing, which the script reports as unchecked, never as agreement).

The output keeps the saved run's `run_id` and `meter` (the spend was the recorded run's) and adds
`recollected`: {from_run, script, collect_version, prompts_version, calls, judge_pairs_reused,
judge_pairs_unjudged, missing_calls}. It is written to runs/<book>/lessons/recollected/<runId>.json
(never over the saved run), and `assemble_objectives.py lesson-runs` reads it like any saved run.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import embed_workflow as E  # noqa: E402
import meter_run  # noqa: E402

LESSON_WF = HERE / "runbook" / "lesson.workflow.js"
STUB = HERE / "tests" / "workflow_stub.mjs"
HARNESS_HEAD = "The computed task text follows:\n"
PAIR_RE = re.compile(r"pair_id=(\S+)\n  problem: .*\n  answer 1: (.*)\n  answer 2: (.*)")


class RecollectError(Exception):
    pass


def recorded_prompt(text: str) -> str:
    """The script's prompt inside the harness's frame (every line indented by two spaces)."""
    i = text.find(HARNESS_HEAD)
    if i < 0:
        return text
    lines = []
    for line in text[i + len(HARNESS_HEAD):].split("\n"):
        if line.startswith("  ") or line == "":
            lines.append(line[2:])
        else:
            break
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines)


def journal(run_dir: Path) -> tuple[dict, dict]:
    """(label -> recorded answer, label -> the prompt its agent was given). A resumed run appends to
    the same journal: a label run again live has a later agent, and the LATEST agent per label is
    the one its run used (answer and prompt both taken from that agent)."""
    rows = [json.loads(line) for line in open(run_dir / "journal.jsonl")]
    latest = {}
    for r in rows:
        if r.get("type") == "started":
            latest[r["label"]] = r["agentId"]
    result = {r["agentId"]: r.get("result") for r in rows if r.get("type") == "result"}
    answers = {lab: result.get(aid) for lab, aid in latest.items() if aid in result}
    prompts = {}
    for lab, aid in latest.items():
        tr = run_dir / f"agent-{aid}.jsonl"
        if not tr.exists():
            continue
        for line in open(tr):
            r = json.loads(line)
            c = (r.get("message") or {}).get("content")
            if r.get("type") == "user" and isinstance(c, str):
                prompts[lab] = recorded_prompt(c)
                break
    return answers, prompts


def judge_pairs(prompt: str) -> dict:
    return {m.group(1): (m.group(2), m.group(3)) for m in PAIR_RE.finditer(prompt or "")}


def find_args(saved: dict, copies: Path) -> dict:
    """The saved run's args, from any generated copy under `copies` that carries exactly them."""
    want = (saved.get("embedded") or {}).get("args_sha256")
    if not want:
        raise RecollectError("the saved run does not say which args it ran with (no embedded.args_sha256)")
    for c in sorted(copies.rglob("*.workflow.js")):
        try:
            if E.embedded_info(c.read_text()).get("args_sha256") == want:
                return E.read_args(c)
        except Exception:                                   # noqa: BLE001 — not a generated copy
            continue
    raise RecollectError(f"no generated copy under {copies} carries the saved run's args ({want[:12]})")


def stub(copy: Path, responses: dict) -> dict:
    with tempfile.TemporaryDirectory() as d:
        fx = Path(d, "fixture.json")
        fx.write_text(json.dumps({"args": None, "responses": responses,
                                  "responder": str(HERE / "dryrun" / "null_responder.mjs")}))
        out = subprocess.run(["node", str(STUB), str(copy), str(fx)], capture_output=True, text=True)
    if out.returncode:
        raise RecollectError(out.stderr[-2000:])
    rep = json.loads(out.stdout)
    if not rep["ok"]:
        raise RecollectError(f"the script failed: {rep['error']}")
    return rep


def recollect(saved: dict, args: dict, run_dir: Path) -> tuple[dict, dict]:
    """(the re-collected run, its provenance) — raises when an answer would be reused unproven."""
    with tempfile.TemporaryDirectory() as d:
        copy = Path(d) / "lesson.recollect.workflow.js"
        info = E.write(LESSON_WF, args, copy)
        return _recollect(saved, copy, info, run_dir)


def _recollect(saved: dict, copy: Path, info: dict, run_dir: Path) -> tuple[dict, dict]:
    if info["args_sha256"] != (saved.get("embedded") or {}).get("args_sha256"):
        raise RecollectError("the args found are not the saved run's")
    answers, prompts = journal(run_dir)
    judge_labels = [k for k in answers if k.startswith("S3:judge:")]
    old_pairs = {}
    for k in judge_labels:
        old_pairs.update(judge_pairs(prompts.get(k)))
    all_verdicts = [v for k in judge_labels for v in ((answers.get(k) or {}).get("verdicts") or [])]

    # pass 1: which pairs does the current collection send to the judge, with which answers?
    responses = {k: v for k, v in answers.items() if not k.startswith("S3:judge:")}
    first = stub(copy, {**responses, **{k: {"verdicts": []} for k in judge_labels}})
    new_pairs = {}
    for c in first["calls"]:
        if c["label"].startswith("S3:judge:"):
            new_pairs.update(judge_pairs(c["prompt"]))
    reusable = {pid for pid, ab in new_pairs.items() if old_pairs.get(pid) == ab}
    unjudged = sorted(set(new_pairs) - reusable)
    verdicts = {"verdicts": [v for v in all_verdicts if v.get("pair_id") in reusable]}

    # pass 2: the real re-collection
    new_judge = [c["label"] for c in first["calls"] if c["label"].startswith("S3:judge:")]
    rep = stub(copy, {**responses, **{k: verdicts for k in new_judge}})
    calls, changed, missing = [], [], []
    for c in rep["calls"]:
        lab = c["label"]
        if lab.startswith("S3:judge:"):
            calls.append({"label": lab, "reused": "pair by pair"})
            continue
        if lab not in answers:
            missing.append(lab)
            calls.append({"label": lab, "reused": False, "why": "the recorded run made no such call"})
            continue
        same = prompts.get(lab) == c["prompt"]
        if not same:
            changed.append(lab)
        calls.append({"label": lab, "reused": same})
    if changed:
        raise RecollectError(f"prompt(s) changed since the recorded run, so their answers cannot be reused: {changed}")
    prov = {"from_run": saved.get("run_id"), "journal": str(run_dir / "journal.jsonl"),
            "script": {k: info[k] for k in ("source", "source_sha256", "args_sha256", "generated_sha256")},
            "collect_version": rep["result"].get("collect_version"), "prompts_version": rep["result"].get("prompts_version"),
            "calls": calls, "judge_pairs_reused": len(reusable), "judge_pairs_unjudged": unjudged,
            "missing_calls": missing, "tool": "services/extraction/recollect_lessons.py"}
    out = dict(rep["result"])
    for k in ("run_id", "meter"):
        if k in saved:
            out[k] = saved[k]
    out["recollected"] = prov
    return out, prov


def recorded_cost(run_id: str, book: str) -> dict:
    """label -> USD the recorded agent cost (runs/<book>/cost.jsonl, meter_run.py)."""
    led = HERE / "runs" / book / "cost.jsonl"
    out = {}
    for line in (led.read_text().splitlines() if led.exists() else []):
        r = json.loads(line)
        if r.get("run_id") == run_id:
            for a in r.get("agents") or []:
                out[a["label"]] = sum((m.get("usd") or 0) for m in (a.get("by_model") or {}).values())
    return out


def resume_preview(saved: dict, copy: Path, run_dir: Path, book: str) -> dict:
    """What a Workflow resume of the saved run with `copy` would do: the agent calls, in the order the
    script makes them, up to the first whose prompt differs from the recorded one replay from cache;
    that call and every later one run live (the runtime's longest-unchanged-prefix rule). Priced with
    the recorded run's own per-agent cost."""
    problems = E.verify(copy, LESSON_WF)
    if problems:
        raise RecollectError(f"{copy}: {problems}")
    answers, prompts = journal(run_dir)
    rep = stub(copy, answers)
    order = [(c["label"], prompts.get(c["label"]) == c["prompt"]) for c in rep["calls"]]
    first = next((i for i, (_, same) in enumerate(order) if not same), len(order))
    cost = recorded_cost(saved.get("run_id"), book)
    live = [lab for lab, _ in order[first:]]
    return {"replay": [lab for lab, _ in order[:first]], "live": live,
            "first_changed": order[first][0] if first < len(order) else None,
            "changed": [lab for lab, same in order if not same],
            "live_usd_estimate": round(sum(cost.get(lab, 0) for lab in live), 2),
            "recorded_usd": round(sum(cost.values()), 2)}


def counts(run: dict) -> dict:
    c = {"items": 0, "agreed": 0, "disputed": 0, "no_printed_answer": 0, "typing_problems": 0, "unchecked": 0}
    for l in run.get("lessons") or []:
        for it in l["items"]:
            c["items"] += 1
            c[it["verification"]] += 1
            c["typing_problems"] += bool(it["typing_problems"])
        c["unchecked"] += len(l["verify"].get("unchecked") or [])
    return c


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="+", type=Path, help="saved lesson runs (runs/<book>/lessons/<runId>.json)")
    ap.add_argument("--book", default="g10-math")
    ap.add_argument("--copies", type=Path, help="the generated copies (default work/<book>/packets/embedded)")
    ap.add_argument("--out-dir", type=Path, help="default runs/<book>/lessons/recollected")
    ap.add_argument("--allow-missing", action="store_true",
                    help="write even when the current script makes a call the recorded run never made")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    ap.add_argument("--resume-preview", action="store_true",
                    help="instead: say what a Workflow resume of each run with today's generated copy "
                         "(work/<book>/packets/embedded/lesson.<slug>.workflow.js) would replay and run live")
    a = ap.parse_args(argv)
    copies = a.copies or HERE / "work" / a.book / "packets" / "embedded"
    out_dir = a.out_dir or HERE / "runs" / a.book / "lessons" / "recollected"
    status = 0
    for path in a.runs:
        saved = json.loads(path.read_text())
        saved = saved.get("result", saved)
        slugs = [l["lesson"] for l in saved.get("lessons") or [] if l]
        tag = slugs[0] if len(slugs) == 1 else f"{slugs[0]}..{slugs[-1]}"
        if a.resume_preview:
            try:
                _, run_dir = meter_run.find_run(saved["run_id"])
                pv = resume_preview(saved, copies / f"lesson.{tag}.workflow.js", run_dir, a.book)
            except (RecollectError, SystemExit) as e:
                print(f"{path.name}: no preview — {e}")
                status = 1
                continue
            print(f"{path.name} ({tag}): a resume replays {len(pv['replay'])} call(s) {pv['replay']}; "
                  f"first changed prompt {pv['first_changed']}; runs {len(pv['live'])} live "
                  f"(≈ ${pv['live_usd_estimate']} of the recorded ${pv['recorded_usd']})")
            continue
        try:
            _, run_dir = meter_run.find_run(saved["run_id"])
            out, prov = recollect(saved, find_args(saved, copies), run_dir)
        except (RecollectError, SystemExit) as e:
            print(f"{path.name}: NOT re-collected — {e}")
            status = 1
            continue
        before, after = counts(saved), counts(out)
        print(f"{path.name} ({tag}): {before} → {after}")
        print(f"   replayed {sum(1 for c in prov['calls'] if c['reused'] is True)} agent call(s) with identical prompts; "
              f"judge verdicts reused for {prov['judge_pairs_reused']} pair(s)"
              + (f"; {len(prov['judge_pairs_unjudged'])} pair(s) need a live judge: {prov['judge_pairs_unjudged']}"
                 if prov["judge_pairs_unjudged"] else "; no pair needs a new verdict"))
        if prov["missing_calls"]:
            print(f"   calls the recorded run never made (need a live agent): {prov['missing_calls']}")
            if not a.allow_missing:
                status = 1
                continue
        if not a.dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / path.name).write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
            print(f"   → {out_dir / path.name}")
    return status


if __name__ == "__main__":
    sys.exit(main())

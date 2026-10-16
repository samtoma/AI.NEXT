"""Run a runbook workflow script here, outside Claude Code, with every agent answered by the `claude` CLI.

    from workflow_runner import run_copy
    result, cost = run_copy(copy_path, read_dirs=[...], cap=3.0, name="s5-draft", book="prep3-math-en")

The script is a copy of a `runbook/*.workflow.js` with its args embedded (embed_workflow.py), exactly what Claude Code
runs with `Workflow({scriptPath})`. Here it runs through `tests/workflow_stub.mjs`, the Workflow runtime's contract
(agent, parallel, pipeline, phase, log; its rules enforced), with `runbook/cli_responder.mjs` answering each agent:
`claude -p`, a minimal system prompt, the Read tool on `read_dirs` only, the agent's model and schema, metered against
`cap`. The prompts, schemas and deterministic checks are the runbook script's own. The return value is saved to
runs/<book>/<folder>/<name>.<stamp>.json with its cost ledger beside it.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
STUB = HERE / "tests" / "workflow_stub.mjs"
RESPONDER = HERE / "runbook" / "cli_responder.mjs"


def run_copy(copy: Path, read_dirs: list[Path], cap: float, name: str, book: str, folder: str) -> tuple[Path, dict, float]:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    runs = HERE / "runs" / book / folder
    runs.mkdir(parents=True, exist_ok=True)
    ledger = runs / f"{name}.{stamp}.cost.jsonl"
    fixture = runs / f"{name}.{stamp}.fixture.json"
    fixture.write_text(json.dumps({"responses": {}, "responder": str(RESPONDER.resolve()),
                                   "stub": {"cap_usd": cap, "read_dirs": [str(Path(d).resolve()) for d in read_dirs],
                                            "ledger": str(ledger)}}))
    try:
        p = subprocess.run(["node", str(STUB), str(copy), str(fixture)], capture_output=True, text=True, cwd=HERE)
    finally:
        fixture.unlink(missing_ok=True)
    sys.stderr.write(p.stderr[-6000:])
    rep = json.loads(p.stdout or "{}")
    for line in rep.get("logs") or []:
        print(f"  [workflow] {line}", file=sys.stderr)
    if not rep.get("ok"):
        raise SystemExit(f"the workflow failed: {rep.get('error')}")
    out = runs / f"{name}.{stamp}.json"
    out.write_text(json.dumps(rep["result"], ensure_ascii=False, indent=1) + "\n")
    cost = sum(json.loads(l)["cost_usd"] for l in ledger.read_text().splitlines()) if ledger.exists() else 0.0
    print(f"saved {out.relative_to(HERE)}; ${cost:.3f} ({ledger.relative_to(HERE)})", file=sys.stderr)
    return out, rep["result"], cost

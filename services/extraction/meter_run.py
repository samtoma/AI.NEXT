"""Cost meter for extraction-line Workflow runs (extraction-pipeline.md §5, build item B16, gap G8).

    uv run meter_run.py list-runs [--name rich-lesson]              # Workflow runs on this machine
    uv run meter_run.py record --book <book> --stage <S#> --run <wf_id> [--lesson <slug>] [--dry-run]
    uv run meter_run.py summary --book <book> [--by stage|phase|lesson|model|agent|run]
    uv run meter_run.py prices

WHY. ADR-0005 said ingest runs are "logged to ai_interactions". Workflow runs
write nothing there, so no book's ingest has ever been costed (G8). A Workflow
script cannot write files either. What a run DOES leave behind is a transcript
per agent, and every model call in it carries its API usage. This reads them,
prices them, and appends one line per run to `runs/<book>/cost.jsonl`, the
ledger G5 shows Samuel before a go / no-go.

WHERE THE DATA IS (Claude Code, verified 2026-09-25 on this repo's own runs):
    ~/.claude/projects/<project>/<session>/workflows/<runId>.json
        the run record: workflowName, status, durationMs, and workflowProgress,
        whose `workflow_agent` entries give each agent's label, phase and model
    ~/.claude/projects/<project>/<session>/subagents/workflows/<runId>/agent-<agentId>.jsonl
        the agent's transcript. Each API response appears once per streamed
        content block with the SAME message id; the last one carries the final
        usage. Calls are therefore de-duplicated by message id, keeping the
        largest output count.
A worktree session lives under its own <project> directory; `--run` searches
all of them.

WHAT IS COUNTED, per call: input, cache writes (5-minute and 1-hour), cache
reads and output tokens, priced per model. Nothing is estimated when usage is
present. An agent whose transcript carries no usage at all is counted from its
text at 4 characters a token — what it was sent as input, what it wrote as
output — and flagged `estimated`; `--estimate-overhead N` adds the N tokens of
system prompt and tools every agent call carries (spec §5 assumes 15,000),
which a transcript's text does not show. One with no transcript is listed
under `missing_transcripts` and the run is marked incomplete.

THE DRY FORM. `record --dry-run --run-record R --transcripts T` meters a run
without touching the ledger. The no-spend dry run of the line
(dryrun_chapter.py) writes a Workflow-shaped record and one transcript per stub
agent — its real prompt, its stubbed answer, no usage — so this shows where a
real run's cost would land, per stage, phase and lesson, before any is spent.
Image tokens (S0b's and S4's vision reads) are not text and are not in it: the
dry run adds S0b's from `assemble_maths.py estimate`.

PER STAGE, LESSON, MODEL. `--stage` is the spec stage the run implements (S1,
S3, …; one run may carry several — pass the one you are metering). Each agent
also keeps its Workflow phase. The lesson comes from the agent's label: the
first `lo:` id or lesson slug in it that the book config's id_prefixes own
(`segment:soc1-2`, `misc:lo:u1-1-1` → `u1-1`), else `--lesson`, else "(book)".

A resumed run reuses cached agents without calling the model again. Agent ids
already in the ledger are skipped, so a resume is never billed twice.

ONLY A FINISHED RUN IS RECORDED. The ledger takes one line per run id and never a
second, so metering a run that is still going would freeze a partial cost into the
ledger for good. A run record whose status is not terminal is refused (T347 review).

PRICES are the API-equivalent list prices in the spec's table (checked
2026-09-25 against the claude-api reference). Claude Code's own billing may
differ (a subscription is not per token); this is what the same work would cost
on the API, which is the number that compares across runs and books.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import book_config

# USD per million tokens. The first three are the spec's table (§5); Fable 5 is
# listed because earlier runs of this line defaulted to it. Cache multipliers
# are the API's standard ones: read 0.1× input, 5-minute write 1.25×, 1-hour
# write 2×. (Claude Fable 5.1 reads cache at a different rate; it is not listed,
# so a run on it shows as unpriced rather than mispriced.)
PRICES: dict[str, dict[str, float]] = {
    "claude-haiku-4-5": {"input": 1.00, "output": 5.00},
    "claude-sonnet-5": {"input": 2.00, "output": 10.00},
    "claude-opus-5": {"input": 5.00, "output": 25.00},
    "claude-fable-5": {"input": 10.00, "output": 50.00},
}
CACHE_READ = 0.10
CACHE_WRITE_5M = 1.25
CACHE_WRITE_1H = 2.00
PRICES_AS_OF = "2026-09-25"
TOKEN_KEYS = ("input", "cache_write_5m", "cache_write_1h", "cache_read", "output")

CLAUDE_HOME = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude"))


def price_key(model: str | None) -> str | None:
    """The PRICES entry for a model id: exact, or the longest listed prefix
    (`claude-haiku-4-5-20251001` → `claude-haiku-4-5`)."""
    if not model:
        return None
    if model in PRICES:
        return model
    hits = [k for k in PRICES if model.startswith(k + "-")]
    return max(hits, key=len) if hits else None


def usd(tokens: dict[str, int], model: str | None) -> float | None:
    k = price_key(model)
    if k is None:
        return None
    p = PRICES[k]
    per = 1_000_000
    return round((tokens["input"] * p["input"]
                  + tokens["cache_write_5m"] * p["input"] * CACHE_WRITE_5M
                  + tokens["cache_write_1h"] * p["input"] * CACHE_WRITE_1H
                  + tokens["cache_read"] * p["input"] * CACHE_READ
                  + tokens["output"] * p["output"]) / per, 6)


def zero() -> dict[str, int]:
    return {k: 0 for k in TOKEN_KEYS}


# ------------------------------------------------------------------ reading runs
def find_run(run_id: str) -> tuple[Path, Path]:
    """(run record, transcript dir) for a Workflow run id, searched across every project."""
    records = sorted(CLAUDE_HOME.glob(f"projects/*/*/workflows/{run_id}.json"))
    dirs = sorted(CLAUDE_HOME.glob(f"projects/*/*/subagents/workflows/{run_id}"))
    if not records and not dirs:
        raise SystemExit(f"no Workflow run {run_id} under {CLAUDE_HOME}/projects "
                         "(set CLAUDE_CONFIG_DIR, or pass --run-record / --transcripts)")
    if len(records) > 1 or len(dirs) > 1:
        raise SystemExit(f"{run_id} matches more than one session: "
                         f"{[str(p) for p in records + dirs]} — pass --run-record and --transcripts")
    return (records[0] if records else None), (dirs[0] if dirs else None)


def agent_calls(path: Path) -> tuple[list[dict], int, int]:
    """(one entry per API call with its final usage, characters sent to the model, characters
    it wrote) — the two character counts are only used when no call carries usage."""
    calls: dict[str, dict] = {}
    chars = 0
    out_chars = 0
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = rec.get("message")
            if not isinstance(msg, dict):
                continue
            content = msg.get("content")
            n = 0
            if isinstance(content, str):
                n = len(content)
            elif isinstance(content, list):
                for c in content:
                    if isinstance(c, dict):
                        n += len(json.dumps(c.get("text") or c.get("input") or c.get("content") or ""))
            if rec.get("type") == "assistant":
                out_chars += n
            else:
                chars += n
            if rec.get("type") != "assistant" or not msg.get("usage"):
                continue
            mid = msg.get("id") or rec.get("requestId") or rec.get("uuid")
            u = msg["usage"]
            cc = u.get("cache_creation") or {}
            w1h = cc.get("ephemeral_1h_input_tokens", 0) or 0
            w5m = cc.get("ephemeral_5m_input_tokens")
            if w5m is None:
                w5m = max(0, (u.get("cache_creation_input_tokens") or 0) - w1h)
            call = {"model": msg.get("model"),
                    "input": u.get("input_tokens", 0) or 0,
                    "cache_write_5m": w5m, "cache_write_1h": w1h,
                    "cache_read": u.get("cache_read_input_tokens", 0) or 0,
                    "output": u.get("output_tokens", 0) or 0}
            prev = calls.get(mid)
            if prev is None or call["output"] >= prev["output"]:
                calls[mid] = call
    return list(calls.values()), chars, out_chars


def lesson_of(label: str, book: "book_config.Book | None") -> str | None:
    for tok in re.split(r"[:\s/|,]+", label or ""):
        if not tok:
            continue
        if tok.startswith("lo") and re.match(r"^lo$", tok):
            continue
        cands = [tok]
        m = re.match(r"^([a-z0-9]+-[0-9]+)-[0-9]+$", tok)       # an LO tail u1-1-1 → u1-1
        if m:
            cands.append(m.group(1))
        for c in cands:
            if book is not None and book.slug_re().match(c):
                return c
    # an explicit lo: id anywhere in the label
    m = re.search(r"lo:([a-z0-9]+-[0-9]+)-[0-9]+", label or "")
    if m and (book is None or book.slug_re().match(m.group(1))):
        return m.group(1)
    return None


def meter(record_path: Path | None, transcripts: Path | None, book, stage: str,
          lesson_override: str | None, already: dict[str, str], estimate_overhead: int = 0) -> dict:
    rec = json.loads(record_path.read_text()) if record_path else {}
    run_id = rec.get("runId") or (transcripts.name if transcripts else "?")
    agents_meta = {a["agentId"]: a for a in rec.get("workflowProgress", [])
                   if a.get("type") == "workflow_agent" and a.get("agentId")}
    files = {p.name[len("agent-"):-len(".jsonl")]: p
             for p in (transcripts.glob("agent-*.jsonl") if transcripts else [])}
    ids = sorted(set(agents_meta) | set(files))

    agents, missing, skipped = [], [], []
    for aid in ids:
        if aid in already:
            skipped.append({"agent_id": aid, "metered_in": already[aid]})
            continue
        meta = agents_meta.get(aid, {})
        label = meta.get("label") or ""
        entry = {"agent_id": aid, "label": label, "phase": meta.get("phaseTitle"),
                 "lesson": lesson_override or lesson_of(label, book) or "(book)",
                 "state": meta.get("state"), "calls": 0, "estimated": False,
                 "by_model": {}}
        f = files.get(aid)
        if f is None:
            if meta.get("state") in (None, "done", "failed", "error"):
                missing.append(aid)
            agents.append(entry)
            continue
        calls, chars, out_chars = agent_calls(f)
        by_model: dict[str, dict[str, int]] = defaultdict(zero)
        for c in calls:
            m = c["model"] or meta.get("model") or "unknown"
            for k in TOKEN_KEYS:
                by_model[m][k] += c[k]
        if not calls:
            m = meta.get("model") or "unknown"
            by_model[m]["input"] = chars // 4 + estimate_overhead
            by_model[m]["output"] = out_chars // 4
            entry["estimated"] = True
        entry["calls"] = len(calls)
        entry["by_model"] = {m: dict(t, usd=usd(t, m)) for m, t in by_model.items()}
        agents.append(entry)

    def roll(key) -> dict:
        out: dict[str, dict] = {}
        for a in agents:
            for m, t in a["by_model"].items():
                k = key(a, m)
                slot = out.setdefault(k, dict(zero(), usd=0.0, unpriced=False))
                for tk in TOKEN_KEYS:
                    slot[tk] += t[tk]
                if t["usd"] is None:
                    slot["unpriced"] = True
                else:
                    slot["usd"] = round(slot["usd"] + t["usd"], 6)
        return out

    totals = roll(lambda a, m: "total").get("total", dict(zero(), usd=0.0, unpriced=False))
    unpriced = sorted({m for a in agents for m, t in a["by_model"].items() if t["usd"] is None})
    return {
        "ledger_version": 1,
        "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "book": book.book if book else None,
        "stage": stage,
        "run_id": run_id,
        "workflow": rec.get("workflowName"),
        "status": rec.get("status"),
        "duration_ms": rec.get("durationMs"),
        "prices": {"as_of": PRICES_AS_OF, "per_million_usd": PRICES,
                   "cache": {"read": CACHE_READ, "write_5m": CACHE_WRITE_5M, "write_1h": CACHE_WRITE_1H}},
        "totals": totals,
        "by_model": roll(lambda a, m: m),
        "by_phase": roll(lambda a, m: a["phase"] or "(none)"),
        "by_lesson": roll(lambda a, m: a["lesson"]),
        "agents": agents,
        "unpriced_models": unpriced,
        "estimated_agents": [a["agent_id"] for a in agents if a["estimated"]],
        "missing_transcripts": missing,
        "skipped_already_metered": skipped,
        "complete": not missing and not unpriced,
    }


# ------------------------------------------------------------------ ledger
def ledger_path(book) -> Path:
    return book_config.HERE / "runs" / book.book / "cost.jsonl"


def read_ledger(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def fmt_tokens(n: int) -> str:
    return f"{n / 1e6:.2f}M" if n >= 1e6 else f"{n / 1e3:.1f}k" if n >= 1e3 else str(n)


def print_rollup(title: str, rows: dict[str, dict]) -> None:
    print(f"\n  {title}")
    print(f"    {'':<28} {'input':>8} {'c.write':>8} {'c.read':>8} {'output':>8} {'USD':>10}")
    for k, t in sorted(rows.items(), key=lambda kv: -(kv[1].get("usd") or 0)):
        cost = f"${t['usd']:.4f}" + ("*" if t.get("unpriced") else "")
        print(f"    {k[:28]:<28} {fmt_tokens(t['input']):>8} "
              f"{fmt_tokens(t['cache_write_5m'] + t['cache_write_1h']):>8} "
              f"{fmt_tokens(t['cache_read']):>8} {fmt_tokens(t['output']):>8} {cost:>10}")


TERMINAL = {"completed", "failed", "error", "errored", "cancelled", "canceled", "killed",
            "stopped", "aborted"}


def cmd_record(a) -> int:
    book = book_config.load_book(a.book)
    if a.run_record or a.transcripts:
        rec = Path(a.run_record) if a.run_record else None
        tdir = Path(a.transcripts) if a.transcripts else None
    else:
        rec, tdir = find_run(a.run)
    path = Path(a.ledger) if a.ledger else ledger_path(book)
    ledger = read_ledger(path)
    rec_json = json.loads(rec.read_text()) if rec else {}
    run_id = rec_json.get("runId") or a.run
    status = rec_json.get("status")
    if rec and status not in TERMINAL:
        print(f"REFUSING: {run_id} has status {status!r}, not finished. The ledger records a run "
              "once, so a partial cost recorded now could never be completed. Record it when it "
              "has finished.", file=sys.stderr)
        return 1
    if any(l.get("run_id") == run_id for l in ledger) and not a.resumed:
        print(f"{run_id} is already in {path} — not recorded twice (a finished RESUME of it keeps the same "
              "run id: record it with --resumed, which meters only agents not already in the ledger)")
        return 0
    already = {ag["agent_id"]: l["run_id"] for l in ledger for ag in l.get("agents", [])}
    line = meter(rec, tdir, book, a.stage, a.lesson, already, a.estimate_overhead)
    if a.resumed:
        # A resume reuses the run id; its cached agents are already in the ledger and are skipped
        # by `already`, so this line carries only the agents the resume actually ran.
        line["resume_of"] = run_id
        line["resume_no"] = 1 + sum(1 for l in ledger if l.get("run_id") == run_id)
        if not line["agents"]:
            print(f"{run_id}: the resume ran no new agent — nothing to record")
            return 0
    t = line["totals"]
    print(f"{run_id} ({line['workflow'] or '?'}, {line['status'] or '?'}) — book {book.book}, "
          f"stage {a.stage}: {len(line['agents'])} agent(s), "
          f"${t['usd']:.4f} API-equivalent" + (" (PARTIAL: unpriced models)" if t.get("unpriced") else ""))
    print_rollup("by model", line["by_model"])
    print_rollup("by phase", line["by_phase"])
    print_rollup("by lesson", line["by_lesson"])
    for k, what in (("unpriced_models", "UNPRICED model(s) — tokens kept, $ excluded"),
                    ("estimated_agents", "agent(s) with no usage in their transcript — ESTIMATED"),
                    ("missing_transcripts", "agent(s) with NO transcript — run marked incomplete"),
                    ("skipped_already_metered", "agent(s) already metered in an earlier run (resume)")):
        if line[k]:
            print(f"  ! {len(line[k])} {what}: {line[k][:5]}")
    if a.dry_run:
        print(f"\n(dry run — nothing appended to {path})")
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(line, ensure_ascii=False) + "\n")
    print(f"\nappended to {path}")
    return 0


def cmd_summary(a) -> int:
    book = book_config.load_book(a.book)
    path = Path(a.ledger) if a.ledger else ledger_path(book)
    ledger = read_ledger(path)
    if not ledger:
        print(f"no ledger entries in {path}")
        return 0
    rows: dict[str, dict] = {}
    for l in ledger:
        for ag in l["agents"]:
            for m, t in ag["by_model"].items():
                key = {"stage": l["stage"], "phase": ag["phase"] or "(none)", "lesson": ag["lesson"],
                       "model": m, "agent": ag["label"] or ag["agent_id"], "run": l["run_id"]}[a.by]
                slot = rows.setdefault(key, dict(zero(), usd=0.0, unpriced=False))
                for k in TOKEN_KEYS:
                    slot[k] += t[k]
                if t["usd"] is None:
                    slot["unpriced"] = True
                else:
                    slot["usd"] = round(slot["usd"] + t["usd"], 6)
    total = sum(r["usd"] for r in rows.values())
    print(f"{book.book}: {len(ledger)} metered run(s), ${total:.4f} API-equivalent "
          f"(prices as of {PRICES_AS_OF})"
          + ("; * = includes unpriced tokens" if any(r["unpriced"] for r in rows.values()) else ""))
    print_rollup(f"by {a.by}", rows)
    incomplete = [l["run_id"] for l in ledger if not l.get("complete")]
    if incomplete:
        print(f"\n  ! incomplete run(s): {incomplete}")
    return 0


def cmd_list_runs(a) -> int:
    for rec in sorted(CLAUDE_HOME.glob("projects/*/*/workflows/wf_*.json"),
                      key=lambda p: p.stat().st_mtime):
        try:
            r = json.loads(rec.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if a.name and r.get("workflowName") != a.name:
            continue
        print(f"{r.get('runId'):<18} {r.get('workflowName') or '?':<22} {r.get('status') or '?':<10} "
              f"{r.get('agentCount') or 0:>4} agents  {r.get('timestamp', '')[:19]}  {rec.parent.parent.parent.name[-40:]}")
    return 0


def cmd_prices(_a) -> int:
    print(f"API list prices, USD per million tokens (as of {PRICES_AS_OF}); cache read "
          f"{CACHE_READ}×, cache write {CACHE_WRITE_5M}× (5 min) / {CACHE_WRITE_1H}× (1 h) of input")
    for m, p in PRICES.items():
        print(f"  {m:<20} input ${p['input']:.2f}   output ${p['output']:.2f}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record", help="meter one Workflow run into the book's ledger")
    r.add_argument("--book", required=True)
    r.add_argument("--stage", required=True, help="the spec stage this run implements (S1, S3, …)")
    r.add_argument("--run", help="Workflow run id (wf_…)")
    r.add_argument("--run-record", help="path to the run record JSON (instead of --run)")
    r.add_argument("--transcripts", help="path to the run's transcript directory (instead of --run)")
    r.add_argument("--lesson", help="attribute every agent to this lesson")
    r.add_argument("--ledger", help="ledger file (default runs/<book>/cost.jsonl)")
    r.add_argument("--dry-run", action="store_true")
    r.add_argument("--resumed", action="store_true",
                   help="the run was resumed after an earlier record: meter only its agents not yet in the ledger")
    r.add_argument("--estimate-overhead", type=int, default=0,
                   help="tokens of system prompt and tools added to each ESTIMATED agent (spec §5: 15000)")
    s = sub.add_parser("summary")
    s.add_argument("--book", required=True)
    s.add_argument("--by", choices=["stage", "phase", "lesson", "model", "agent", "run"], default="stage")
    s.add_argument("--ledger")
    lr = sub.add_parser("list-runs")
    lr.add_argument("--name", help="only runs of this workflow")
    sub.add_parser("prices")
    a = ap.parse_args(argv)
    if a.cmd == "record" and not (a.run or a.run_record or a.transcripts):
        ap.error("record needs --run, or --run-record/--transcripts")
    return {"record": cmd_record, "summary": cmd_summary, "list-runs": cmd_list_runs,
            "prices": cmd_prices}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())

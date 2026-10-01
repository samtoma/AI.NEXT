"""`fanout.py advance` and `fanout.py ready`: process a finished Workflow run with ONE command (2026-10-01).

    uv run fanout.py advance <run-id> --wf <wf_id> [--task-output <path>] [--resumed] [--dry-run]
                             [--running <run-id>[@copy] ...] [--redo] [--no-close-chapter] [--honor-gate]
                             [--refresh-stale] [--force] [--copy <label>] [-v]
    uv run fanout.py ready   [--running <run-id>[@copy] ...] [--prepare] [--refresh-stale] [--honor-gate] [--paths]

WHAT IT REPLACES. The main session ran each finished Workflow run by hand, every time the same chain: save the
return value, save the record, meter it, run the plan's `after` commands for that kind of run, prepare every run whose
dependencies were now saved, and work out what to launch next. `advance` does all of it, in that order, stops at the
FIRST failing step (it prints that step and never guesses past it), and prints a short machine-readable summary:
what was saved and metered (with the cost), the key numbers each after-step reported, any warning or failure, the
runs it prepared, and the scripts that are READY to launch, in plan order. It calls no model and launches nothing.

WHAT EACH RUN KIND DOES AFTER ITS SAVE AND METER (mirrors the plan's `after`/`before` and runbook §3, §4, §7b, §10):

    s0b-A / s0b-B   B: the S0b assembly (the plan's `before` of the third reading) → runs/<book>/maths/book/
    s0b-C           the assembly; the group's chapters must show unresolved 0 (anything else is G0b, a human: a WARNING)
    s1-chNN         G1, see below
    lesson-<slug>   lesson-runs --draft; when every lesson of the chapter is saved: `close-chapter N` (G2 auto-pass,
                    assembly, validation, then the chapter's working check and S5 draft prepared and verified)
    wcheck-chNN     nothing until BOTH passes (and every part) are saved; then working_check.py collect
    s5-draft-chNN   the chapter's bundle into the pilot DB if it is not there yet — load dry run, pg_dump, load,
                    apply_review_verdicts --g2 — then S6/S7 author are prepared (they need the chapter loaded)
    s6-author-chNN  write-specs (never over a spec that exists), families.normalise, generate_questions --check
    s6-grade-chNN   (all parts) generate_questions --grades → the S5 distractors
    s7-author-chNN  merge the author run into templates (never overwriting), normalise them
    s7-verify-chNN  generate_widget_questions --verdicts → the S5 distractors and the held-mapping queue
    s5-final-chNN   catalogue, the S6/S7 bundles, the generated-bundle loads, G3 + G4 auto-pass, coverage (a safety
                    check failing blocks), parity (RED blocks)
    one-offs        s6-author-ch08-s111 and wcheck-ch08 are finished; save + meter only, their steps are manual

G1 (S1). NEVER a bare `assemble_objectives.py assemble` on a chapter that is already approved: it re-derives the rejected
state and overwrites the approved files (it did, on chapter 5). So: a chapter whose lessons are all approved is left alone
(`--redo` does not change that); one with runs/<book>/objectives/g1-chNN.auto.json newer than its S1 run is approved with
`assemble_objectives.py approve --verdicts` of that file (the verdicts, rulings included, are what is re-used); only a chapter
with neither is assembled and auto-passed (`auto_pass_gates.py g1 --approve`). A G1 that is BLOCKED (a pipeline failure, or an
exercise-only objective — rule 1, one evidence kind — which blocks by design) STOPS the advance and is reported with the
gate's own BLOCKED lines; advance never resolves it: that is a ruling or a pipeline fix. Advance again once it is made.

Then every run whose dependencies are now satisfied and that has no copy is PREPARED (`fanout.prepare`) and verified
(`embed_workflow.verify`); a run that cannot be prepared yet is listed with the reason; a run whose input says it is
not needed (a third reading nobody asked for, no family to grade, no template to verify) is marked SKIPPED, so what
waits on it is released.

IDEMPOTENT. Re-running `advance` on a saved run changes nothing it already did: the save is not rewritten if its
content is the same, the meter is append-once, and every step with files as outputs is skipped when they exist and
are newer than its inputs (a gate record re-written would change its fingerprint in the console, so G1/G3/G4 are
never re-run for nothing). DB loads are skipped when the rows are already there, the DB writes that follow a load are
remembered in the run's ledger. `--redo` ignores all of that (but never re-assembles an approved chapter, and never
re-closes a chapter whose working check or S5 draft has been launched: their copies would be regenerated).

LOADS ONLY AFTER A FRESH pg_dump. Every step that WRITES to the pilot DB (the chapter load, the S5 catalogue, the
generated bundles, the verdicts) is preceded, once per invocation, by `pg_dump -Fc` of the DB into
work/<book>/backups/pilot-before-<chapter>-<what>.dump (a timestamp is added when that name exists) — checked with
`pg_restore -l`. The DB must be local (127.0.0.1); anything else is refused. A step that only reads it (parity,
normalise, a load dry run) takes no dump.

THE CHAPTER-1 GO / NO-GO. The plan makes every other chapter's lessons wait for `s5-final-ch01` (the go/no-go). The
main session lifted it on 2026-10-01 (chapters 2-4's lessons ran with it unsaved), so `ready` and `advance` do not
wait for it; `--honor-gate` puts it back.

LEDGER. runs/<book>/fanout/advance/<run-id>.json records, per run, which copy was saved by which Workflow run, whether
its after-steps completed (`after_done`) and which step failed, the DB writes already done, or that the run was skipped
and why. A saved run whose after-steps did not complete does NOT release what depends on it (`ready` lists it under
`incomplete`); a run saved by hand before this existed has no ledger and counts as done.

SOURCES. The return value comes from `--task-output` (the harness's task output file: summary, agentCount, logs,
result, workflowProgress, totalTokens, totalToolCalls) or, without it, from the run's own record under
~/.claude/projects/*/*/workflows/<wf_id>.json, which holds the same keys. The record also gives the status (only a
`completed` run is saved) and the script that ran, so the copy (pass / part) is identified twice: by the embedded
sha the result echoes and by that script path; they must agree.

Exit codes: 0 done (or waiting for another part), 1 a step failed (the summary names it), 2 refused (nothing changed).
"""

from __future__ import annotations

import argparse
import contextlib
import dataclasses
import io
import json
import os
import re
import shlex
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import fanout as F  # noqa: E402

BOOK = F.BOOK
COURSE = "course:us-g10-math-en"
GATE_RUN = "s5-final-ch01"              # the chapter-1 go/no-go the plan puts in front of every other chapter's lessons
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
SAMPLE_PCT, SAMPLE_SEED = 10, 20260926  # the review-queue sample the pilot's generated-bundle loads used (runbook §6, WIP step d)
MAX_LANES = 2                           # the plan's rule: at most two Workflow runs at a time
SAVE_DIRS = ("maths", "objectives", "lessons", "working-check", "misconceptions", "families", "widgets")
ONE_OFF = {"s6-author-ch08-s111", "wcheck-ch08"}
WF_RE = re.compile(r"^wf_[0-9a-f]{8}-[0-9a-f]{3}$")
KINDS = [("s0b-A-", "s0b"), ("s0b-B-", "s0b"), ("s0b-C-", "s0b_c"), ("s1-", "s1"), ("lesson-", "lesson"),
         ("wcheck-", "wcheck"), ("s5-draft-", "s5_draft"), ("s6-author-", "s6_author"), ("s6-grade-", "s6_grade"),
         ("s7-author-", "s7_author"), ("s7-verify-", "s7_verify"), ("s5-final-", "s5_final")]
KEY_LINE = re.compile(r"BLOCKED|FAIL|OWED|NOT recorded|NOT auto-passed|REFUS|ERROR|Error|Traceback|validation error|Value error|✗|!!")


class Refuse(Exception):
    """The input is wrong (not this run's result, a run that did not complete, a copy nobody can identify): nothing was changed."""


class StepFailed(Exception):
    def __init__(self, step: str, detail: str):
        super().__init__(f"{step}: {detail}")
        self.step, self.detail = step, detail


def kind_of(rid: str) -> str:
    if rid in ONE_OFF:
        return "oneoff"
    for prefix, kind in KINDS:
        if rid.startswith(prefix):
            return kind
    raise Refuse(f"{rid}: not a kind of run this knows ({', '.join(sorted({k for _, k in KINDS}))})")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ================================================================ paths, IO
class Paths:
    """Resolved from fanout's module constants on every call, so a test can point them at a scratch tree."""

    def __init__(self):
        self.here = F.HERE
        self.runs = F.RUNS
        self.work = F.WORK
        self.packets = F.PACKETS
        self.embed = F.EMBED
        self.plan = F.PLAN_PATH
        self.fan = F.FAN
        self.maths_book = F.MATHS_BOOK
        self.records = self.runs / "records"
        self.ledgers = self.runs / "fanout" / "advance"
        self.cost = self.runs / "cost.jsonl"
        self.backups = self.work / "backups"

    def rel(self, p) -> str:
        try:
            return str(Path(p).resolve().relative_to(self.here.resolve()))
        except ValueError:
            return str(p)


def write_json(path: Path, obj, indent: int | None = 1) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=indent) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def unwrap(j):
    """A saved run is the result itself; an older one is the harness's wrapper around it."""
    return j["result"] if isinstance(j, dict) and isinstance(j.get("result"), dict) else j


def chap(P: Paths, ch: int) -> SimpleNamespace:
    """The files one chapter's steps read and write (the plan's `fam`, `wid`, `cfg`, `gen`)."""
    t = F.ch_tag(ch)
    return SimpleNamespace(
        n=ch, t=t, fam=P.here / "families" / BOOK / t, wid=P.here / "widgets" / BOOK / t,
        cfg=P.fan / "books" / t / f"{BOOK}.json", gen=P.here / "seed" / "generated" / BOOK / t,
        seed=P.here / "seed" / BOOK / f"g10m-c{ch:02d}.json", course_seed=P.here / "seed" / BOOK / "g10m-course.json",
        g2=P.runs / f"g2-{t}.json", gates=P.runs / "gates", cov=P.here / "coverage" / f"{BOOK}.{t}.json",
        widget_gaps=P.here / "coverage" / f"{BOOK}.{t}.widget-gaps.json",
        tier_floor=P.here / "coverage" / f"{BOOK}.{t}.tier-floor.json",
        merged=P.runs / "widgets" / f"author-merged-{t}.json", pending=P.runs / "widgets" / f"pending-review-{t}.json",
        w_dist=P.runs / "widgets" / f"s5-distractors-{t}.json", f_dist=P.runs / "families" / f"s5-distractors-{t}.json",
        objectives=P.here / "objectives" / BOOK, g1_auto=P.runs / "objectives" / f"g1-{t}.auto.json",
        accepted=P.maths_book / "accepted.json", assembly=P.runs / "fanout" / f"assembly-{t}.json")


# ================================================================ running things
@dataclasses.dataclass
class Result:
    rc: int
    out: str = ""
    dry: bool = False
    skipped: bool = False

    def tail(self, n: int = 700) -> str:
        return (self.out or "").strip()[-n:]

    def key_lines(self, n: int = 1500) -> str:
        """What a failing step said that matters: its BLOCKED / FAIL / OWED / error lines, else the tail of its output."""
        hits = [l.rstrip() for l in (self.out or "").splitlines() if KEY_LINE.search(l)]
        return ("\n".join(hits)[-n:]) if hits else self.tail()


class Exec:
    """The pipeline's own scripts, exactly as the plan quotes them (`uv run <script> …`, from services/extraction/)."""

    def py(self, argv: list[str], env: dict | None = None, timeout: int = 1800) -> Result:
        r = subprocess.run(["uv", "run", "--project", str(F.HERE), "python", *argv], cwd=F.HERE, capture_output=True,
                           text=True, env=dict(os.environ, **(env or {})), timeout=timeout)
        return Result(r.returncode, (r.stdout or "") + (r.stderr or ""))

    def tool(self, argv: list[str], timeout: int = 600) -> Result:
        r = subprocess.run(argv, cwd=F.HERE, capture_output=True, text=True, timeout=timeout)
        return Result(r.returncode, (r.stdout or "") + (r.stderr or ""))


class Db:
    """The only questions asked of the pilot DB: which of these ids are already there (a load is skipped when all are)."""

    TABLES = {"questions", "graph_nodes", "misconceptions"}

    def __init__(self, dsn: str):
        self.dsn = dsn

    def present(self, table: str, ids: list[str]) -> int:
        if table not in self.TABLES:
            raise ValueError(table)
        if not ids:
            return 0
        import psycopg
        with psycopg.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(f"SELECT count(*) FROM {table} WHERE id = ANY(%s)", (list(ids),))
            return int(cur.fetchone()[0])


def short_cmd(argv: list[str], limit: int = 14) -> str:
    if len(argv) <= limit:
        return shlex.join(argv)
    return shlex.join(argv[:limit - 2]) + f" … (+{len(argv) - limit + 2} more)"


def parse_dsn(dsn: str) -> dict:
    d = dict(re.findall(r"(\w+)=(\S+)", dsn))
    return {"host": d.get("host", "127.0.0.1"), "port": d.get("port", "5432"), "dbname": d.get("dbname", "")}


def _quiet(fn, *a):
    """Call a fanout.py function and keep what it prints out of the summary."""
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*a)


class Flow:
    """Runs the steps of one advance in order, records each, skips a step whose outputs are newer than its inputs, and stops
    (StepFailed) at the first one that fails. In a dry run nothing executes: each step is recorded as `dry` with its command."""

    def __init__(self, P: Paths, ex, dry: bool = False, redo: bool = False, say=None):
        self.P, self.ex, self.dry, self.redo = P, ex, dry, redo
        self.say = say or (lambda m: None)
        self.steps: list[dict] = []
        self.dirty = False                   # a step with outputs ran in this advance: later ones that read them must run too
        self.backups: dict[str, dict] = {}
        self.marks: dict[str, float] = {}    # DB writes this run's ledger remembers (epoch seconds), by step name

    @staticmethod
    def fresh(inputs, outputs) -> bool:
        """Every output exists and none is older than any input."""
        outs = [Path(o) for o in outputs]
        if not outs or not all(o.exists() for o in outs):
            return False
        t_out = min(o.stat().st_mtime_ns for o in outs)
        return all(Path(i).stat().st_mtime_ns <= t_out for i in inputs if Path(i).exists())

    def marked(self, name: str, inputs=()) -> bool:
        t = self.marks.get(name)
        return bool(t) and not self.redo and all(t >= Path(i).stat().st_mtime for i in inputs if Path(i).exists())

    def _rec(self, name: str, status: str, note: str = "", cmd: str | None = None, secs: float | None = None) -> None:
        r: dict = {"step": name, "status": status}
        if note:
            r["note"] = note
        if cmd and (self.dry or status == "failed"):
            r["cmd"] = cmd
        if secs is not None and secs >= 1:
            r["secs"] = round(secs)
        self.steps.append(r)
        self.say(f"  [{status}] {name}" + (f" — {note}" if note else ""))

    def run(self, name: str, argv: list[str], *, env: dict | None = None, inputs=(), outputs=(), ok=(0,), fresh: bool = True,
            note: str = "", mark: str | None = None, mark_inputs=()) -> Result:
        cmd = short_cmd(argv)
        if self.dry:
            self._rec(name, "dry", note, cmd)
            return Result(0, "", dry=True)
        if mark and self.marked(mark, mark_inputs):
            self._rec(name, "skipped", "already done (this run's ledger)")
            return Result(0, "", skipped=True)
        if fresh and outputs and not self.dirty and not self.redo and self.fresh(inputs, outputs):
            self._rec(name, "skipped", "outputs exist and are newer than the inputs")
            return Result(0, "", skipped=True)
        t0 = time.time()
        r = self.ex.py(list(argv), env)
        if r.rc not in ok:
            self._rec(name, "failed", f"exit {r.rc}", cmd)
            raise StepFailed(name, f"exit {r.rc}: {cmd}\n{r.key_lines()}")
        self._rec(name, "ok", note, cmd, time.time() - t0)
        if outputs:
            self.dirty = True
        if mark:
            self.marks[mark] = time.time()
        return r

    def call(self, name: str, fn, *, note: str = "", dirty: bool = False):
        """An in-process step (a fanout.py function). Dry: recorded, not called, returns None."""
        if self.dry:
            self._rec(name, "dry", note)
            return None
        t0 = time.time()
        try:
            out = fn()
        except (F.NotReady, SystemExit) as e:
            self._rec(name, "failed", str(e)[:200])
            raise StepFailed(name, str(e)) from e
        self._rec(name, "ok", note, secs=time.time() - t0)
        if dirty:
            self.dirty = True
        return out

    def skipped(self, name: str, why: str) -> None:
        self._rec(name, "skipped", why)

    def backup(self, tag: str) -> dict:
        """pg_dump of the pilot DB, once per tag per advance, before the first step that writes to it."""
        if tag in self.backups:
            return self.backups[tag]
        cfg = parse_dsn(F.DSN)
        if cfg["host"] not in LOCAL_HOSTS:
            raise StepFailed("pg_dump", f"the pilot DB must be local (127.0.0.1), not {cfg['host']!r}")
        out = self.P.backups / f"pilot-before-{tag}.dump"
        if out.exists():
            out = out.with_name(f"pilot-before-{tag}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.dump")
        argv = ["pg_dump", "-h", cfg["host"], "-p", cfg["port"], "-Fc", "-f", str(out), cfg["dbname"]]
        if self.dry:
            self._rec("pg_dump", "dry", f"→ {self.P.rel(out)}", shlex.join(argv))
            self.backups[tag] = {"path": self.P.rel(out), "dry": True}
            return self.backups[tag]
        out.parent.mkdir(parents=True, exist_ok=True)
        r = self.ex.tool(argv)
        size = out.stat().st_size if out.exists() else 0
        if r.rc != 0 or size == 0:
            self._rec("pg_dump", "failed", f"exit {r.rc}", shlex.join(argv))
            raise StepFailed("pg_dump", f"exit {r.rc}, {size} bytes: {r.tail()} — nothing was loaded")
        chk = self.ex.tool(["pg_restore", "-l", str(out)])
        if chk.rc != 0:
            self._rec("pg_dump", "failed", "the dump does not list", shlex.join(argv))
            raise StepFailed("pg_dump", f"pg_restore -l refused {self.P.rel(out)}: {chk.tail()} — nothing was loaded")
        self.backups[tag] = {"path": self.P.rel(out), "bytes": size}
        self._rec("pg_dump", "ok", f"{self.P.rel(out)} ({size} bytes)")
        return self.backups[tag]


# ================================================================ the plan, the copies, what is saved
@dataclasses.dataclass
class Copy:
    run_id: str
    path: Path
    label: str          # "" (the only copy), "A" / "A.part2" / "B" / "B.part2" (working check), "part1" … (S6 grade)
    sha: str | None
    exists: bool


def read_sha(path: Path) -> str | None:
    import embed_workflow
    try:
        return embed_workflow.embedded_info(Path(path).read_text())["generated_sha256"]
    except (OSError, embed_workflow.EmbedError, ValueError, KeyError):
        return None


def copies_of(P: Paths, r: dict) -> list[Copy]:
    """Every generated copy that belongs to a plan run: one, or — for the working check — pass A and B and each part, and for
    S6 grading each part. A copy that is not written yet is returned as the (missing) main one."""
    main = P.here / r["embedded_script"]
    try:
        kind = kind_of(r["id"])
    except Refuse:
        kind = "other"
    if kind not in ("wcheck", "s6_grade"):
        return [Copy(r["id"], main, "", read_sha(main), main.exists())]
    stem = re.sub(r"\.part\d+$", "", main.name[:-len(".workflow.js")])
    pat = re.compile(rf"^{re.escape(stem)}(?P<b>-B)?(?:\.part(?P<k>\d+))?\.workflow\.js$")
    found: list[Copy] = []
    for f in sorted(main.parent.glob(f"{stem}*.workflow.js")):
        m = pat.match(f.name)
        if not m or (kind == "s6_grade" and m.group("b")):
            continue
        k = m.group("k")
        label = ("B" if m.group("b") else "A") + (f".part{k}" if k else "") if kind == "wcheck" else (f"part{k}" if k else "")
        found.append(Copy(r["id"], f, label, read_sha(f), True))
    if kind == "s6_grade" and any(c.label for c in found):      # parts exist: a stale unsuffixed copy is not one of them
        found = [c for c in found if c.label]
    found.sort(key=lambda c: c.label)
    return found or [Copy(r["id"], main, "A" if kind == "wcheck" else "", None, False)]


def saved_index(P: Paths) -> dict[str, Path]:
    """generated_sha256 → the saved result file that echoes it (the newest when several do). Only the directories the plan
    saves into, not recursively, and never records/ (a record also holds the result)."""
    idx: dict[str, Path] = {}
    for d in SAVE_DIRS:
        for f in sorted((P.runs / d).glob("*.json")) if (P.runs / d).is_dir() else []:
            try:
                j = read_json(f)
            except (OSError, ValueError):
                continue
            res = unwrap(j) if isinstance(j, dict) else None
            e = res.get("embedded") if isinstance(res, dict) else None
            sha = e.get("generated_sha256") if isinstance(e, dict) else None
            if sha and (sha not in idx or f.stat().st_mtime_ns >= idx[sha].stat().st_mtime_ns):
                idx[sha] = f
    return idx


def read_ledgers(P: Paths) -> dict[str, dict]:
    out = {}
    for f in sorted(P.ledgers.glob("*.json")) if P.ledgers.is_dir() else []:
        try:
            out[f.stem] = read_json(f)
        except (OSError, ValueError):
            continue
    return out


class State:
    """Which plan runs are saved / skipped / done, from the files (the saved results' embedded shas, the advance ledger)."""

    def __init__(self, P: Paths, plan: dict):
        self.P, self.plan = P, plan
        self.runs = plan["runs"]
        self.by = {r["id"]: r for r in self.runs}
        self.idx = saved_index(P)
        self.led = read_ledgers(P)
        self._copies: dict[str, list[Copy]] = {}

    def copies(self, r: dict) -> list[Copy]:
        if r["id"] not in self._copies:
            self._copies[r["id"]] = copies_of(self.P, r)
        return self._copies[r["id"]]

    def forget_copies(self) -> None:
        self._copies.clear()

    def copy_saved(self, c: Copy) -> Path | None:
        f = self.idx.get(c.sha) if c.sha else None
        if f:
            return f
        e = (self.led.get(c.run_id) or {}).get("copies", {}).get(c.label or "main")
        if e and (self.P.here / e["file"]).exists():
            return self.P.here / e["file"]
        return None

    def saved_files(self, r: dict) -> dict[str, Path] | None:
        cs = self.copies(r)
        if not cs or not all(c.exists for c in cs):
            return None
        out = {}
        for c in cs:
            f = self.copy_saved(c)
            if f is None:
                return None
            out[c.label] = f
        return out

    def is_saved(self, r: dict) -> bool:
        return self.saved_files(r) is not None

    def skipped(self, r: dict) -> str | None:
        return (self.led.get(r["id"]) or {}).get("skipped")

    def after_done(self, r: dict) -> bool:
        l = self.led.get(r["id"])
        return True if l is None else bool(l.get("after_done"))

    def satisfied(self, r: dict) -> bool:
        return bool(self.skipped(r)) or (self.is_saved(r) and self.after_done(r))

    def deps_ok(self, r: dict, honor_gate: bool = False) -> bool:
        for d in r.get("depends_on") or []:
            if d == GATE_RUN and not honor_gate and r.get("stage") == "S2-S4":
                continue
            dep = self.by.get(d)
            if dep is None or not self.satisfied(dep):
                return False
        return True

    def ledger(self, rid: str) -> dict:
        return self.led.setdefault(rid, {"format": "ainext.fanout-advance/1", "run": rid, "copies": {}, "after_done": False})

    def mark_saved(self, rid: str, label: str, wf: str, f: Path) -> None:
        self.ledger(rid).setdefault("copies", {})[label or "main"] = {"wf": wf, "file": self.P.rel(f), "at": now()}


def parse_running(tokens) -> set[tuple[str, str | None]]:
    out = set()
    for t in tokens or ():
        rid, _, lab = str(t).partition("@")
        out.add((rid, lab or None))
    return out


def is_running(running: set, rid: str, label: str | None = None) -> bool:
    return (rid, None) in running or (label is not None and (rid, label) in running)


def copy_status(c: Copy) -> tuple[str, str]:
    """ok | stale (the runbook script changed since the copy was generated: it runs the script as it was) | broken."""
    import embed_workflow
    try:
        problems = embed_workflow.verify(c.path)
    except Exception as e:  # noqa: BLE001 — a copy that cannot even be read is broken
        return "broken", f"{type(e).__name__}: {e}"[:200]
    if not problems:
        return "ok", ""
    if all("has changed since this copy was generated" in p for p in problems):
        return "stale", problems[0].split(": ", 1)[-1][:160]
    return "broken", problems[0][:200]


# ================================================================ the Workflow run and its return value
def find_record(wf: str) -> dict | None:
    import meter_run
    try:
        rec, _ = meter_run.find_run(wf)
    except SystemExit:
        return None
    return read_json(rec) if rec else None


def load_return(task_output: Path | None, rec: dict | None, wf: str) -> tuple[dict, dict]:
    """(wrapper, result): the harness's task output file, else the run record's own copy of the same keys."""
    if task_output is not None:
        try:
            w = read_json(Path(task_output))
        except (OSError, ValueError) as e:
            raise Refuse(f"cannot read --task-output {task_output}: {e}") from e
    elif rec is not None:
        w = {k: rec[k] for k in ("summary", "agentCount", "logs", "result", "workflowProgress", "totalTokens", "totalToolCalls")
             if k in rec}
    else:
        raise Refuse(f"{wf}: no --task-output, and no run record under ~/.claude/projects/*/*/workflows/{wf}.json to read it from")
    if not isinstance(w, dict):
        raise Refuse("the task output is not a JSON object")
    if "result" not in w and isinstance(w.get("embedded"), dict):      # the saved result itself
        w = {"result": w}
    res = w.get("result")
    if isinstance(res, str):
        try:
            res = json.loads(res)
        except ValueError as e:
            raise Refuse(f"the result is a string that is not JSON: {e}") from e
    if not isinstance(res, dict):
        raise Refuse(f"{wf}: the run returned no result object (a failed or killed run has none) — resume it with the same copy")
    return dict(w, result=res), res


def resolve_copy(copies: list[Copy], result: dict, rec: dict | None, label: str | None, force: bool) -> Copy:
    want = (result.get("embedded") or {}).get("generated_sha256")
    by_sha = [c for c in copies if want and c.sha == want]
    script = (rec or {}).get("scriptPath")
    by_script = [c for c in copies if script and Path(script).name == c.path.name]     # by name: a moved worktree keeps the file names
    if script and not by_script and not force:
        raise Refuse(f"the run record says it ran {Path(script).name}, which is not a copy of this run "
                     f"({', '.join(c.path.name for c in copies)}): wrong run id for this --wf? (--force to override)")
    if label is not None:
        by_label = [c for c in copies if c.label == label]
        if not by_label:
            raise Refuse(f"--copy {label!r}: this run's copies are {[c.label or 'main' for c in copies]}")
        if by_sha and by_label[0] is not by_sha[0] and not force:
            raise Refuse(f"--copy {label!r} disagrees with the embedded sha, which is copy {by_sha[0].label or 'main'}")
        return by_label[0]
    if by_sha and by_script and by_sha[0] is not by_script[0]:
        raise Refuse(f"the result echoes copy {by_sha[0].path.name}, but the run record says it ran {Path(script).name}: "
                     "two different copies of this run — not one save")
    if by_sha:
        return by_sha[0]
    if force and by_script:
        return by_script[0]
    if force and len(copies) == 1:
        return copies[0]
    if by_script:
        raise Refuse(f"the run ran {Path(script).name}, but its result does not echo that copy's embedded sha (the copy was "
                     "regenerated after the launch, or this is another run's result); --force to save it anyway")
    raise Refuse(f"this result echoes embedded sha {str(want)[:12]}…, which is none of the copies of this run "
                 f"({', '.join(c.path.name for c in copies)}): wrong run id for this --wf? (--force to override)")


def save_path(P: Paths, r: dict, label: str, wf: str) -> Path:
    """The plan's `save_to` with the run id (and the pass, for the working check) substituted."""
    s = re.sub(r"\s+\(.*\)\s*$", "", r["save_to"].strip())
    pass_id = label.split(".")[0] if kind_of(r["id"]) == "wcheck" else ""
    s = s.replace("<pass A|B>", pass_id).replace("<wf_id>", wf)
    if "<" in s or ">" in s or not s.endswith(".json"):
        raise Refuse(f"cannot read a path out of the plan's save_to: {r['save_to']!r}")
    return P.here / s


def meter_args(r: dict) -> tuple[str, str | None]:
    stage = re.search(r"--stage\s+(\S+)", r["meter"])
    lesson = re.search(r"--lesson\s+(\S+)", r["meter"])
    if not stage:
        raise Refuse(f"no --stage in the plan's meter line: {r['meter']!r}")
    return stage.group(1), (lesson.group(1) if lesson else None)


def read_cost(P: Paths) -> list[dict]:
    if not P.cost.exists():
        return []
    return [json.loads(l) for l in P.cost.read_text().splitlines() if l.strip()]


# ================================================================ the after-steps, per kind
@dataclasses.dataclass
class Opts:
    resumed: bool = False
    dry: bool = False
    redo: bool = False
    no_close: bool = False
    honor_gate: bool = False
    refresh_stale: bool = False
    force: bool = False
    copy: str | None = None
    running: tuple = ()
    verbose: bool = False


@dataclasses.dataclass
class Adv:
    P: Paths
    plan: dict
    run: dict
    kind: str
    S: State
    fl: Flow
    result: dict
    wf: str
    copy: Copy
    saved: Path
    rep: dict
    db: Db
    opts: Opts

    @property
    def ch(self) -> int:
        return int(self.run["chapter"])

    @property
    def K(self) -> SimpleNamespace:
        return chap(self.P, self.ch)

    def warn(self, msg: str) -> None:
        self.rep["warnings"].append(msg)

    def note(self, msg: str) -> None:
        self.rep.setdefault("notes", []).append(msg)

    def count(self, **kv) -> None:
        self.rep["counts"].update(kv)

    def rels(self, *paths) -> list[str]:
        return [self.P.rel(p) for p in paths]


def generic_counts(res: dict) -> dict:
    out: dict = {}
    for k in ("results", "records", "lessons", "gaps"):
        if isinstance(res.get(k), list):
            out[k] = len(res[k])
    if isinstance(res.get("totals"), dict):
        out["totals"] = res["totals"]
    return out


def one_file(P: Paths, pattern: str, dry: bool = False) -> Path:
    """The ONE saved run matching runs/<book>/<pattern> (a second one is an ambiguity the pipeline refuses to guess at)."""
    files = sorted(p for p in P.runs.glob(pattern) if p.is_file())
    if len(files) != 1:
        if dry:
            return P.runs / pattern.replace("*", "<wf_id>")
        raise StepFailed("find saved run", f"{len(files)} saved run(s) match runs/{BOOK}/{pattern}: "
                                           f"{[P.rel(f) for f in files]} — keep exactly one")
    return files[0]


# ---- S0b
def assemble_maths(P: Paths, fl: Flow) -> None:
    """The S0b assembly of every saved A/B/C run: the plan's `before` of the third reading and its `after`."""
    files = sorted(P.runs.glob("maths/[ABC]-*.json"))
    out = P.maths_book
    fl.run("S0b assembly (A+B+C)", ["assemble_maths.py", "assemble", BOOK, *[P.rel(f) for f in files], "--out-dir", P.rel(out)],
           inputs=files, outputs=[out / "summary.json", out / "accepted.json", out / "queue.json"])


def maths_summary(P: Paths, rep: dict, chapters: list[int]) -> None:
    f = P.maths_book / "summary.json"
    if not f.exists():
        return
    s = read_json(f)
    rep["counts"]["maths"] = {"accepted": sum(s.get(k, 0) for k in ("accepted_by_hash", "accepted_by_agreement", "accepted_by_third_reading")),
                              "unresolved": s.get("unresolved"), "awaiting_third_reading": s.get("awaiting_third_reading")}
    for ch in chapters:
        b = (s.get("by_chapter") or {}).get(str(ch)) or {}
        if b.get("unresolved"):
            rep["warnings"].append(f"{F.ch_tag(ch)}: {b['unresolved']} maths image(s) unresolved after S0b → G0b "
                                   "(a human; nothing is guessed, FR-4407)")


def h_s0b(A: Adv) -> bool:
    if A.run["id"].split("-")[1] == "B":            # the plan's `before` of pass C: the assembly the third reading reads
        assemble_maths(A.P, A.fl)
        maths_summary(A.P, A.rep, [])
    A.count(images=A.result.get("images"), results=len(A.result.get("results") or []), pass_id=A.result.get("pass"))
    if A.result.get("problems"):
        A.warn(f"{len(A.result['problems'])} image(s) the pass reported a problem with")
    return True


def h_s0b_c(A: Adv) -> bool:
    assemble_maths(A.P, A.fl)
    maths_summary(A.P, A.rep, dict(F.S0B_GROUPS)[A.run["id"].rsplit("-", 1)[1]])
    A.count(images=A.result.get("images"), results=len(A.result.get("results") or []))
    return True


# ---- S1 and the lessons
def lesson_slugs_of(plan: dict, ch: int) -> list[str]:
    return [r["lesson"] for r in plan["runs"] if r["stage"] == "S2-S4" and r.get("chapter") == ch]


def g1_approved(K: SimpleNamespace, lessons: list[str]) -> bool:
    """Every lesson of the chapter carries G1's approval (objectives/<book>/<slug>.json, status approved)."""
    def ok(s: str) -> bool:
        f = K.objectives / f"{s}.json"
        return f.exists() and read_json(f).get("status") == "approved"
    return bool(lessons) and all(ok(s) for s in lessons)


def auto_by() -> str:
    try:
        import review_policy
        return review_policy.auto_pass_by("G1")
    except Exception:  # noqa: BLE001
        return "auto-pass G1 (AI recommendation)"


def h_s1(A: Adv) -> bool:
    """G1 without ever re-assembling an approved chapter (see the module docstring)."""
    K, fl = A.K, A.fl
    check = K.objectives / f"{K.t}.check.json"
    gate = K.gates / f"g1-{K.t}.json"
    lessons = lesson_slugs_of(A.plan, A.ch)
    hint = ("\nG1 is not passed and advance does not resolve it: a pipeline failure, or a decision for a person (an exercise-only "
            "objective — rule 1, one evidence kind — blocks by design; the ruling goes in the verdicts file "
            f"{A.P.rel(K.g1_auto)}). Advance again once it is settled.")
    try:
        if g1_approved(K, lessons):
            fl.skipped("S1 assemble + G1", "the chapter is already approved at G1: assemble is never re-run on an approved chapter "
                                           "(it re-derives the rejected state and overwrites the approved files)")
        elif K.g1_auto.exists() and not fl.dry and A.saved.exists() and K.g1_auto.stat().st_mtime_ns >= A.saved.stat().st_mtime_ns:
            # the verdicts exist (and may carry a ruling): approve WITH them; assembling or re-running the auto-pass would re-derive them
            fl.run("G1 approve (the recorded verdicts)", ["assemble_objectives.py", "approve", BOOK, "--chapter", str(A.ch), "--by", auto_by(),
                                                          "--verdicts", A.P.rel(K.g1_auto), "--maths", A.P.rel(K.accepted)], fresh=False)
        else:
            fl.run("S1 assemble", ["assemble_objectives.py", "assemble", BOOK, A.P.rel(A.saved), "--maths", A.P.rel(K.accepted)],
                   inputs=[A.saved, K.accepted], outputs=[check])
            fl.run("G1 auto-pass --approve", ["auto_pass_gates.py", "g1", BOOK, "--chapter", str(A.ch), "--maths", A.P.rel(K.accepted),
                                              "--approve"], fresh=False)
    except StepFailed as e:
        raise StepFailed(e.step, e.detail + hint) from e
    if check.exists():
        c = read_json(check)
        A.count(objectives=(c.get("counts") or {}).get("objectives"), lessons=(c.get("counts") or {}).get("lessons"),
                g1_decisions_owed=len(c.get("undecided") or []), check_status=c.get("status"))
    if gate.exists():
        g = read_json(gate)
        A.count(g1={"outcome": g.get("outcome"), "decisions": len(g.get("decisions") or [])})
    if K.g1_auto.exists():
        v = read_json(K.g1_auto)
        if isinstance(v, dict) and v.get("rulings"):
            A.count(g1_rulings=len(v["rulings"]))
    return True


def chapter_closed(A: Adv, ch: int) -> bool:
    K = chap(A.P, ch)
    copies = [A.P.here / r["embedded_script"] for r in A.plan["runs"] if r["id"] in (f"wcheck-{K.t}", f"s5-draft-{K.t}")]
    return K.g2.exists() and K.assembly.exists() and K.seed.exists() and len(copies) == 2 and all(c.exists() for c in copies)


def h_lesson(A: Adv) -> bool:
    slugs = [L.get("lesson") for L in A.result.get("lessons") or []] or [A.run["lesson"]]
    drafts = [A.P.runs / "lesson-draft" / f"{s}.json" for s in slugs]
    A.fl.run("lesson-runs --draft", ["assemble_objectives.py", "lesson-runs", BOOK, A.P.rel(A.saved), "--draft",
                                      "--maths", A.P.rel(A.K.accepted)], inputs=[A.saved, A.K.accepted], outputs=drafts)
    items: dict = {}
    types: dict = {}
    for L in A.result.get("lessons") or []:
        its = L.get("items") or []
        items[L.get("lesson")] = len(its)
        for it in its:
            types[it.get("answer_type")] = types.get(it.get("answer_type"), 0) + 1
    A.count(items=items, answer_types=types,
            worked_examples=sum(len(L.get("worked_examples") or []) for L in A.result.get("lessons") or []))
    mine = [r for r in A.plan["runs"] if r["stage"] == "S2-S4" and r.get("chapter") == A.ch]
    waiting = [r["id"] for r in mine if r["id"] != A.run["id"] and not A.S.satisfied(r)]
    if waiting:
        A.rep["waiting"] = f"{len(waiting)} lesson run(s) of chapter {A.ch} not saved yet: {', '.join(waiting[:6])}"
        return True
    if A.opts.no_close:
        A.rep["waiting"] = f"chapter {A.ch}: every lesson saved — close-chapter not run (--no-close-chapter)"
        return True
    t = A.K.t
    if chapter_closed(A, A.ch):
        launched = [rid for rid in (f"wcheck-{t}", f"s5-draft-{t}") if rid in A.S.by
                    and (A.S.is_saved(A.S.by[rid]) or is_running(parse_running(A.opts.running), rid))]
        if not A.opts.redo:
            A.fl.skipped(f"close-chapter {A.ch}", "already closed (G2 file, assembly report, seed bundle and both prepared copies exist)")
        elif launched:
            A.warn(f"chapter {A.ch} not re-closed: {', '.join(launched)} already launched (their copies would be regenerated) — "
                   "run `uv run fanout.py close-chapter` by hand if that is what you want")
        else:
            close_chapter(A)
        return True
    close_chapter(A)
    return True


def close_chapter(A: Adv) -> None:
    info = A.fl.call(f"close-chapter {A.ch}", lambda: _quiet(F.close_chapter, A.ch), dirty=True)
    if not info:
        return
    n = info.get("numbers") or {}
    asm = n.get("assembly") or {}
    A.count(close_chapter={"g2": (n.get("g2") or {}).get("decisions"),
                           "assembly": {k: v for k, v in asm.items() if k in ("questions", "live", "held_by_reason", "excluded",
                                                                              "stand_ins", "katex_errors")},
                           "prepared": {k: {"agents": v.get("agents"), "usd": v.get("cost_usd")}
                                        for k, v in (info.get("prepared") or {}).items()}})
    if asm.get("katex_errors"):
        A.warn(f"chapter {A.ch}: {asm['katex_errors']} KaTeX error(s) in the assembled bundle")
    held = (n.get("g2") or {}).get("decisions", {}).get("held") or 0
    if held:
        A.note(f"chapter {A.ch}: {held} G2 item(s) held with no verdict")


# ---- working check
def h_wcheck(A: Adv) -> bool:
    K = A.K
    cs = A.S.copies(A.run)
    files = {c.label: (A.saved if c.label == A.copy.label else A.S.copy_saved(c)) for c in cs}
    missing = [l for l, f in files.items() if f is None]
    A.count(results=len(A.result.get("results") or []), pass_id=A.result.get("pass_id"), part=A.result.get("part"),
            parts=A.result.get("parts"))
    if A.result.get("problems"):
        A.warn(f"the {A.copy.label} copy reported {len(A.result['problems'])} problem(s)")
    if missing:
        A.rep["waiting"] = f"working check: copies still to save: {', '.join(missing)}"
        return False
    args = sorted(A.P.packets.glob(f"wcheck-{K.t}.args*.json")) + sorted(A.P.packets.glob(f"wcheck-{K.t}-B.args*.json"))
    out = A.P.runs / "working-check" / f"{K.t}.flags.json"
    runs = [files[c.label] for c in cs]
    argv = ["working_check.py", "collect"]
    for a in args:
        argv += ["--args", A.P.rel(a)]
    A.fl.run("working_check collect", argv + ["--runs", *A.rels(*runs), "--out", A.P.rel(out)], inputs=runs, outputs=[out])
    if out.exists():
        d = read_json(out)
        A.count(working_check={"solutions": d.get("solutions"), "verdicts": d.get("verdicts"), "flagged_solutions": d.get("flagged_solutions"),
                               "flags": len(d.get("flags") or []), "single_pass": len(d.get("single_pass_ids") or [])})
        if d.get("unchecked"):
            A.warn(f"{len(d['unchecked'])} solution(s) no checking agent answered — re-run those agents")
        if d.get("problems"):
            A.warn(f"the collection reported {len(d['problems'])} problem(s): {str(d['problems'][0])[:120]}")
    return True


# ---- S5 draft and the chapter's load
def last_line(text: str, prefix: str = "") -> str | None:
    hits = [l.strip() for l in (text or "").splitlines() if l.strip().startswith(prefix)]
    return hits[-1][:200] if hits else None


def ensure_loaded(A: Adv) -> None:
    """The chapter's bundle in the pilot DB: skipped when it is all there; else load dry run, fresh pg_dump, load, the G2 stamps.
    A chapter loaded before advance existed (no mark in this run's ledger) is left exactly as it is."""
    K, fl = A.K, A.fl
    if not K.seed.exists():
        raise StepFailed("load chapter", f"no assembled bundle {A.P.rel(K.seed)}: close the chapter first")
    b = read_json(K.seed)
    qids, nids = [q["id"] for q in b.get("questions") or []], [n["id"] for n in b.get("nodes") or []]
    if fl.dry:
        fl.skipped("load chapter", f"dry run: the DB is not asked whether chapter {A.ch} is loaded")
        return
    have_q, have_n = A.db.present("questions", qids), A.db.present("graph_nodes", nids)
    loaded = have_q == len(qids) and have_n == len(nids)
    env = {"AINEXT_DB_DSN": F.DSN, "AINEXT_ENVIRONMENT": "mvp1"}
    apply_ = ["apply_review_verdicts.py", "--g2", A.P.rel(K.g2), "--book", BOOK, "--runs", A.P.rel(A.P.runs / "lesson")]
    if loaded and "load chapter" not in fl.marks and not A.opts.redo:
        fl.skipped("load chapter", f"already in the pilot DB ({have_q} questions, {have_n} nodes)")
        A.count(loaded={"already": True, "questions": have_q})
        return
    if loaded and "load chapter" in fl.marks and not A.opts.redo:
        fl.skipped("load chapter", f"loaded by an earlier advance ({have_q} questions)")
        if "apply G2 verdicts" not in fl.marks:      # the load went through, the stamps did not
            fl.backup(f"{K.t}-load")
            fl.run("apply G2 verdicts", apply_, env=env, fresh=False, mark="apply G2 verdicts")
        return
    if have_q or have_n:
        A.warn(f"chapter {A.ch} was partly loaded ({have_q}/{len(qids)} questions, {have_n}/{len(nids)} nodes): the add-only load completes it")
    load = ["load_seed.py", A.P.rel(K.course_seed), A.P.rel(K.seed), "--course", COURSE]
    fl.run("load dry run", [*load, "--dry-run"], env=env, fresh=False)
    fl.backup(f"{K.t}-load")
    r = fl.run("load chapter", load, env=env, fresh=False, mark="load chapter")
    fl.run("apply G2 verdicts", apply_, env=env, fresh=False, mark="apply G2 verdicts")
    A.count(loaded={"already": False, "questions": len(qids), "nodes": len(nids), "summary": last_line(r.out, "loaded ")})


def h_s5_draft(A: Adv) -> bool:
    A.count(**generic_counts(A.result))
    ensure_loaded(A)
    return True


# ---- S6
def specs_of(res: dict) -> list[tuple[str, dict]]:
    """(file name, spec) for every family the S6 author wrote — the names fanout.write_specs gives them."""
    out = []
    for rec in res.get("records") or []:
        for spec in rec.get("families") or []:
            tail, slug = spec["id"].split(":")[1:]
            out.append((f"{tail}--{slug}.json", spec))
    return out


def chapter_config(A: Adv) -> Path:
    K = A.K
    if K.cfg.exists() and not A.fl.dry:
        return K.cfg
    return A.fl.call("chapter config", lambda: F.write_config(A.ch)) or K.cfg


def h_s6_author(A: Adv) -> bool:
    K = A.K
    specs = specs_of(A.result)
    A.count(records=len(A.result.get("records") or []), families=len(specs))
    cfg = A.fl.call("chapter config", lambda: F.write_config(A.ch)) or K.cfg
    targets = [K.fam / n for n, _ in specs]
    if not specs:
        A.fl.skipped("write-specs", "the author wrote no family (every gap infeasible)")
    else:
        have = [t for t in targets if t.exists() or (K.fam / f"_held--{t.name}").exists()]
        if len(have) == len(targets) and not A.opts.redo:
            A.fl.skipped("write-specs", f"all {len(targets)} spec(s) already in {A.P.rel(K.fam)}")
        elif have:
            raise StepFailed("write-specs", f"{len(have)} of {len(targets)} spec(s) already exist (e.g. {have[0].name}): "
                                            "never overwritten — settle the directory, then advance again")
        else:
            A.fl.call("write-specs", lambda: _quiet(F.write_specs, A.saved, K.fam, cfg), note=f"{len(targets)} spec(s)", dirty=True)
    files = sorted(K.fam.glob("*.json")) if K.fam.exists() else []
    if not files and not A.fl.dry:
        A.note("no family spec: S6 grading will be skipped")
        return True
    A.fl.run("families.normalise", ["-m", "families.normalise", *(A.rels(*files) or [A.P.rel(K.fam) + "/*.json"])], fresh=False)
    r = A.fl.run("generate_questions --check", ["generate_questions.py", "--families", A.P.rel(K.fam), "--book", A.P.rel(cfg), "--check"],
                 fresh=False)
    A.count(check=last_line(r.out))
    return True


def h_s6_grade(A: Adv) -> bool:
    K = A.K
    cs = A.S.copies(A.run)
    files = {c.label: (A.saved if c.label == A.copy.label else A.S.copy_saved(c)) for c in cs}
    missing = [l or "main" for l, f in files.items() if f is None]
    A.count(results=len(A.result.get("results") or []), part=A.result.get("part"))
    if missing:
        A.rep["waiting"] = f"S6 grade: parts still to save: {', '.join(missing)}"
        return False
    grades = sorted(A.P.runs.glob(f"families/grade-{K.t}-*.json")) or [A.saved]
    fam = sorted(K.fam.glob("*.json")) if K.fam.exists() else []
    cfg = chapter_config(A)
    r = A.fl.run("generate_questions --grades", ["generate_questions.py", "--families", A.P.rel(K.fam), "--book", A.P.rel(cfg),
                                                  "--grades", *A.rels(*grades), "--s5-distractors", A.P.rel(K.f_dist)],
                 inputs=[*grades, *fam], outputs=[K.f_dist])
    A.count(graded=last_line(r.out))
    if K.f_dist.exists():
        d = read_json(K.f_dist)
        A.count(s5_distractors=len(d) if isinstance(d, (list, dict)) else None)
    return True


# ---- S7
def h_s7_author(A: Adv) -> bool:
    K = A.K
    A.fl.run("merge author run → templates", ["generate_widget_questions.py", "--merge-author-runs", A.P.rel(A.saved), "--merged",
                                              A.P.rel(K.merged), "--write-templates", A.P.rel(K.wid)], inputs=[A.saved], outputs=[K.merged])
    templates = sorted(K.wid.glob("*.json")) if K.wid.exists() else []
    merged = read_json(K.merged) if K.merged.exists() else {}
    A.count(templates=len(templates), gaps=len(merged.get("gaps") or []), lessons=len(merged.get("records") or []))
    if templates:
        draft = one_file(A.P, f"misconceptions/draft-{K.t}-*.json", A.fl.dry)
        A.fl.run("normalise templates", ["generate_widget_questions.py", "--dsn", F.DSN, "--catalogue", A.P.rel(draft),
                                         "--normalise-templates", *A.rels(*templates)], env={"AINEXT_DB_DSN": F.DSN}, fresh=False)
    elif not A.fl.dry:
        A.note("no template (every lesson a gap): S7 verification will be skipped")
    return True


def h_s7_verify(A: Adv) -> bool:
    K = A.K
    templates = sorted(K.wid.glob("*.json")) if K.wid.exists() else []
    cfg = chapter_config(A)
    A.fl.run("verify verdicts → distractors, held mappings", [
        "generate_widget_questions.py", "--templates", A.P.rel(K.wid), "--book", A.P.rel(cfg), "--dsn", F.DSN, "--verdicts",
        A.P.rel(A.saved), "--gaps", A.P.rel(K.merged), "--s5-distractors", A.P.rel(K.w_dist), "--pending-review", A.P.rel(K.pending)],
        env={"AINEXT_DB_DSN": F.DSN}, inputs=[A.saved, K.merged, *templates], outputs=[K.w_dist, K.pending])
    A.count(results=len(A.result.get("results") or []))
    if K.pending.exists():
        d = read_json(K.pending)
        A.count(held_mappings=len(d) if isinstance(d, (list, dict)) else None)
    return True


# ---- S5 final
def present_all(A: Adv, table: str, ids: list[str]) -> bool:
    return not A.fl.dry and bool(ids) and A.db.present(table, ids) == len(ids)


def h_s5_final(A: Adv) -> bool:
    """The plan's `after` of S5 final, in order, with the runbook's G3/G4 (§7b). Every step with files as outputs is skipped when
    they are newer than its inputs; every DB write is preceded by one fresh pg_dump. The catalogue (written first, rewritten by the
    reconcile) is NOT an input of the bundles' freshness: a bundle built before the reconcile would otherwise look stale forever."""
    K, fl, P = A.K, A.fl, A.P
    cfg = chapter_config(A)
    env = {"AINEXT_DB_DSN": F.DSN, "AINEXT_ENVIRONMENT": "mvp1"}
    graphs = ["--graph", P.rel(K.seed), "--graph", P.rel(K.course_seed)]
    cat = K.gen / "misconceptions.json"
    gq, wq = K.gen / "generated-questions.json", K.gen / "widget-questions.json"
    families = sorted(K.fam.glob("*.json")) if K.fam.exists() else []
    templates = sorted(K.wid.glob("*.json")) if K.wid.exists() else []
    grades = sorted(P.runs.glob(f"families/grade-{K.t}-*.json"))
    verdict = one_file(P, f"widgets/verify-{K.t}-*.json", fl.dry) if templates else None
    if not fl.dry:
        K.gen.mkdir(parents=True, exist_ok=True)

    fl.run("S5 catalogue", ["assemble_misconceptions.py", P.rel(A.saved), "--book", P.rel(cfg), "--out", P.rel(cat), *graphs],
           inputs=[A.saved], outputs=[cat])
    cat_ids = [m["id"] for m in ((read_json(cat).get("misconceptions") if cat.exists() else None) or [])]
    if present_all(A, "misconceptions", cat_ids) and not A.opts.redo:
        fl.skipped("load catalogue", f"all {len(cat_ids)} entries are in the pilot DB")
    else:
        fl.run("load catalogue dry run", ["load_misconceptions.py", P.rel(cat), "--course", COURSE, "--dry-run"], env=env, fresh=False)
        fl.backup(f"{K.t}-final-load")
        fl.run("load catalogue", ["load_misconceptions.py", P.rel(cat), "--course", COURSE], env=env, fresh=False)
    bundles: list[Path] = []
    if families:
        if not grades and not fl.dry:
            raise StepFailed("generated questions", f"families exist in {P.rel(K.fam)} but there is no graded run "
                                                    f"runs/{BOOK}/families/grade-{K.t}-*.json")
        fl.run("generated questions", ["generate_questions.py", "--families", P.rel(K.fam), "--book", P.rel(cfg), "--catalogue", P.rel(cat),
                                       "--grades", *A.rels(*grades), "--out", P.rel(gq), "--floor-report", P.rel(K.tier_floor)],
               inputs=[*families, *grades, A.saved], outputs=[gq])
        bundles.append(gq)
    else:
        A.note("no family: no generated-questions bundle")
    if templates:
        fl.run("widget questions", ["generate_widget_questions.py", "--templates", P.rel(K.wid), "--book", P.rel(cfg), "--dsn", F.DSN,
                                    "--verdicts", P.rel(verdict), "--gaps", P.rel(K.merged), "--gap-report", P.rel(K.widget_gaps),
                                    "--pending-review", P.rel(K.pending), "--out", P.rel(wq)],
               env={"AINEXT_DB_DSN": F.DSN}, inputs=[*templates, K.merged, verdict, A.saved], outputs=[wq, K.widget_gaps])
        bundles.append(wq)
    else:                           # no template (S7 verify skipped): the gap report alone; a widget bundle is never written unverified
        fl.run("widget gap report", ["generate_widget_questions.py", "--templates", P.rel(K.wid), "--book", P.rel(cfg), "--dsn", F.DSN,
                                     "--gaps", P.rel(K.merged), "--gap-report", P.rel(K.widget_gaps)],
               env={"AINEXT_DB_DSN": F.DSN}, inputs=[K.merged], outputs=[K.widget_gaps])
    if bundles:
        fl.run("reconcile tags with the catalogue", ["assemble_misconceptions.py", P.rel(A.saved), "--book", P.rel(cfg), "--out", P.rel(cat),
                                                      *[x for b in bundles for x in ("--bundle", P.rel(b))], *graphs],
               inputs=[A.saved, *bundles], outputs=[cat])
    queues: list[Path] = []
    for b in bundles:
        ids = [x["id"] for x in ((read_json(b).get("questions") if b.exists() else None) or [])]
        if present_all(A, "questions", ids) and not A.opts.redo:
            fl.skipped(f"load {b.name}", f"all {len(ids)} questions are in the pilot DB")
        else:
            load = ["load_generated_questions.py", P.rel(b), "--course", COURSE, "--sample", str(SAMPLE_PCT), "--seed", str(SAMPLE_SEED),
                    "--catalogue-only"]
            fl.run(f"validate {b.name}", [*load, "--dry-run"], env=env, fresh=False)
            fl.backup(f"{K.t}-final-load")
            fl.run(f"load {b.name}", load, env=env, fresh=False)
        queues.append(b.with_suffix(".review-queue.json"))
    if queues:
        auto3 = P.runs / f"g3-{K.t}.auto.json"
        widgets = [x for b in bundles if b == wq for x in ("--widgets", P.rel(b))]
        fl.run("G3 auto-pass", ["auto_pass_gates.py", "g3", BOOK, "--chapter", str(A.ch), *[x for q in queues for x in ("--queue", P.rel(q))],
                                *widgets], inputs=[*queues, *bundles], outputs=[K.gates / f"g3-{K.t}.json", auto3])
        if fl.dry or auto3.exists():
            if not fl.marked("apply G3 verdicts", [auto3]):
                fl.backup(f"{K.t}-final-load")
            fl.run("apply G3 verdicts", ["apply_review_verdicts.py", P.rel(auto3)], env=env, fresh=False, mark="apply G3 verdicts",
                   mark_inputs=[auto3])
    fl.run("G4 auto-pass", ["auto_pass_gates.py", "g4", BOOK, "--chapter", str(A.ch), "--catalogue", P.rel(cat), "--s5", P.rel(A.saved)],
           inputs=[cat, A.saved], outputs=[K.gates / f"g4-{K.t}.json"])
    fl.run("coverage", ["coverage_report.py", "--book", P.rel(cfg), "--chapter", str(A.ch), "--maths", P.rel(P.maths_book / "summary.json"),
                        "--widget-gaps", P.rel(K.widget_gaps), "--s5", P.rel(A.saved), "--generated", P.rel(K.gen), "--out", P.rel(K.cov)],
           inputs=[A.saved, K.widget_gaps, *bundles, K.seed, P.maths_book / "summary.json"], outputs=[K.cov], ok=(0, 1))
    coverage_verdict(A, K.cov)
    fl.run("parity (every course)", ["parity_check.py", "--candidate", F.DSN, "--all-courses"], fresh=False)
    A.count(bundles=[b.name for b in bundles])
    return True


def coverage_verdict(A: Adv, cov: Path) -> None:
    """A coverage SAFETY check failing blocks (as the runbook's G5 does); a completeness check failing is listed for Samuel."""
    if A.fl.dry:
        return
    if not cov.exists():
        raise StepFailed("coverage", f"no {A.P.rel(cov)} was written")
    d = read_json(cov)
    try:
        import auto_pass_gates
        safety = set(auto_pass_gates.SAFETY_CHECKS)
    except Exception:  # noqa: BLE001 — another agent is editing that file; the list is stable, so a fallback is safe
        safety = {"katex", "notation", "answer_text", "asked_forms", "book_pictures", "captions", "teacher_only", "s5_catalogue",
                  "solution_sources", "distractor_refutations"}
    failing = [c for c in d.get("checks") or [] if c.get("state") == "fails"]
    A.count(coverage={"status": d.get("status"), **(d.get("summary") or {}), "failing": [c["id"] for c in failing]})
    for c in failing:
        if c["id"] not in safety:
            A.warn(f"coverage {c['id']} fails ({c.get('got')}/{c.get('want')}) — a completeness finding for Samuel")
    blocked = [c for c in failing if c["id"] in safety]
    if blocked:
        raise StepFailed("coverage", "a coverage SAFETY check fails: " + "; ".join(
            f"{c['id']} ({c.get('got')}/{c.get('want')})" for c in blocked))


def h_oneoff(A: Adv) -> bool:
    A.warn(f"{A.run['id']} is a finished one-off: saved and metered; its after-steps are manual (see the plan)")
    return True


HANDLERS = {"s0b": h_s0b, "s0b_c": h_s0b_c, "s1": h_s1, "lesson": h_lesson, "wcheck": h_wcheck, "s5_draft": h_s5_draft,
            "s6_author": h_s6_author, "s6_grade": h_s6_grade, "s7_author": h_s7_author, "s7_verify": h_s7_verify,
            "s5_final": h_s5_final, "oneoff": h_oneoff}


# ================================================================ preparing what comes next, and what is ready
def skip_run(P: Paths, S: State, r: dict, reason: str, dry: bool = False) -> None:
    S.led[r["id"]] = {"format": "ainext.fanout-advance/1", "run": r["id"], "copies": {}, "after_done": True, "skipped": reason,
                      "updated": now()}
    if not dry:
        write_json(P.ledgers / f"{r['id']}.json", S.led[r["id"]])


def prepare_ready(P: Paths, S: State, fl: Flow, rep: dict, running: set, opts: Opts) -> None:
    """Prepare (and verify) every run whose dependencies are satisfied and that has no copy yet — never regenerating one that
    exists (a copy launched mid-run keeps its hash; `--refresh-stale` is the one opt-in, for runs not running and not saved)."""
    S.forget_copies()
    for _ in range(12):                                   # a skipped run releases the next: repeat until nothing changes
        changed = False
        for r in S.runs:
            rid = r["id"]
            if rid in ONE_OFF or is_running(running, rid) or S.satisfied(r) or S.is_saved(r) or not S.deps_ok(r, opts.honor_gate):
                continue
            have = [c for c in S.copies(r) if c.exists]
            stale = bool(opts.refresh_stale and have and any(copy_status(c)[0] == "stale" for c in have))
            if have and not stale:
                continue
            if fl.dry:
                if rid not in rep["would_prepare"]:
                    rep["would_prepare"].append(rid)
                continue
            try:
                info = _quiet(F.prepare, rid)
            except F.NotReady as e:
                rep["not_ready"][rid] = str(e).replace("\n", " ")[:220]
                continue
            except (SystemExit, Exception) as e:  # noqa: BLE001 — a builder crashing is reported, never fatal to the advance
                rep["not_ready"][rid] = f"ERROR {type(e).__name__}: {e}"[:220]
                continue
            rep["not_ready"].pop(rid, None)
            if isinstance(info, dict) and info.get("skipped"):
                if kind_of(rid) == "s0b_c":         # the plan still says: run the third reading's after-steps (the S0b assembly)
                    assemble_maths(P, fl)
                    maths_summary(P, rep, dict(F.S0B_GROUPS)[rid.rsplit("-", 1)[1]])
                skip_run(P, S, r, str(info["skipped"])[:300])
                rep["skipped"].append({"id": rid, "why": str(info["skipped"])[:200]})
                changed = True
                continue
            S.forget_copies()
            cps = copies_of(P, r)
            bad = [f"{c.path.name}: {st} {detail}" for c in cps if c.exists for st, detail in [copy_status(c)] if st != "ok"]
            if bad:
                raise StepFailed(f"verify {rid}", "; ".join(bad))
            rep["prepared"].append({"id": rid, "scripts": [str(c.path) for c in cps], "agents": r.get("agents"), "cost_usd": r.get("cost")})
            changed = True
        if not changed:
            break


def ready_list(P: Paths, S: State, running: set, opts: Opts) -> dict:
    """The scripts that can be launched now, in plan order: dependencies satisfied (the chapter-1 gate lifted unless asked),
    the run neither saved nor in flight. A copy that does not exist yet is `unprepared`; a saved run whose after-steps did not
    complete is `incomplete`."""
    ready, unprepared, incomplete, stale = [], [], [], []
    s0b_running = any(S.by.get(rid, {}).get("s0b") for rid, _ in running)
    for r in S.runs:
        rid = r["id"]
        if S.satisfied(r) or is_running(running, rid):
            continue
        if S.is_saved(r):
            incomplete.append(rid)
            continue
        if not S.deps_ok(r, opts.honor_gate):
            continue
        cs = S.copies(r)
        if not cs or not all(c.exists for c in cs):
            unprepared.append(rid)
            continue
        scripts = []
        for c in cs:
            if S.copy_saved(c) or is_running(running, rid, c.label or None):
                continue
            st, detail = copy_status(c)
            scripts.append({"path": str(c.path), "copy": c.label or "main", "verify": st, **({"detail": detail} if detail else {})})
            if st == "stale":
                stale.append(c.path.name)
        if scripts:
            e = {"id": rid, "stage": r["stage"], "copies": [s["copy"] for s in scripts], "agents": r.get("agents"),
                 "cost_usd": r.get("cost"), "_scripts": scripts}
            bad = sorted({s["verify"] for s in scripts} - {"ok"})
            if bad:
                e["verify"] = bad
            if r.get("s0b") and s0b_running:
                e["hold"] = "an S0b run is in flight (never two at once)"
            ready.append(e)
    n = len(running)
    paths = [s["path"] for e in ready for s in e["_scripts"] if s["verify"] != "broken"]
    for e in ready:
        del e["_scripts"]
    out = {"ready": ready, "ready_scripts": paths, "unprepared": unprepared, "incomplete": incomplete,
           "lanes": {"max": MAX_LANES, "in_flight": n, "free": max(0, MAX_LANES - n)}}
    if stale:
        out["stale_copies"] = stale
    return out


# ================================================================ advance
def new_report(run_id: str, wf: str, dry: bool) -> dict:
    return {"run": run_id, "wf": wf, "ok": True, "dry_run": dry, "saved": None, "record": None, "metered": None, "counts": {},
            "warnings": [], "waiting": None, "failure": None, "checkpoint": None, "prepared": [], "skipped": [], "not_ready": {},
            "would_prepare": []}


def advance(run_id: str, wf: str, task_output: Path | None = None, opts: Opts | None = None, ex=None, db: Db | None = None,
            say=None) -> tuple[int, dict]:
    opts = opts or Opts()
    ex = ex or Exec()
    db = db or Db(F.DSN)
    P = Paths()
    rep = new_report(run_id, wf, opts.dry)
    fl = Flow(P, ex, dry=opts.dry, redo=opts.redo, say=say)
    S: State | None = None
    try:
        if not WF_RE.match(wf):
            raise Refuse(f"--wf {wf!r} is not a Workflow run id (wf_xxxxxxxx-xxx)")
        if not P.plan.exists():
            raise Refuse(f"no {P.rel(P.plan)}: run `uv run fanout.py plan` first")
        plan = read_json(P.plan)
        r = next((x for x in plan["runs"] if x["id"] == run_id), None)
        if r is None:
            raise Refuse(f"{run_id}: not a run of the plan")
        kind = kind_of(run_id)
        if run_id == "wcheck-ch08":
            raise Refuse("wcheck-ch08 is finished (both sw-v3 passes saved as working-check/ch08-v3-A/B-…, flags in ch08.flags.json): "
                         "nothing to advance")
        S = State(P, plan)
        rep["checkpoint"] = r.get("checkpoint")
        rec = find_record(wf)
        wrapper, result = load_return(task_output, rec, wf)
        if rec is None:
            raise Refuse(f"{wf}: no run record under ~/.claude/projects/*/*/workflows/ — its status and its transcripts (the "
                         "meter reads them) cannot be found")
        if rec.get("status") != "completed":
            raise Refuse(f"{wf} has status {rec.get('status')!r}, not completed: nothing to save — resume it with the same copy "
                         "(resumeFromRunId), then advance with --resumed")
        cs = S.copies(r)
        if not cs or not all(c.exists for c in cs):
            raise Refuse(f"{run_id}: no generated copy on disk ({P.rel(P.here / r['embedded_script'])}): was it prepared? "
                         "(`uv run fanout.py prepare`)")
        cp = resolve_copy(cs, result, rec, opts.copy, opts.force)

        # ---- 1. save the return value and the whole wrapper (the record lives in records/, never beside the results)
        existing = S.copy_saved(cp)
        target = existing or save_path(P, r, cp.label, wf)
        rec_path = P.records / (target.stem + ".record.json")
        same = bool(existing) and not opts.resumed and unwrap(read_json(existing)) == result
        if opts.dry:
            rep["saved"] = f"{P.rel(target)} ({'already saved' if same else 'would write'})"
            rep["record"] = P.rel(rec_path)
        else:
            if not same:
                write_json(target, result, indent=1)
            wrapped = dict(wrapper)
            wrapped.setdefault("runId", wf)
            if not (rec_path.exists() and read_json(rec_path) == wrapped):
                rec_path.parent.mkdir(parents=True, exist_ok=True)
                tmp = rec_path.with_name(rec_path.name + ".tmp")
                tmp.write_text(json.dumps(wrapped, ensure_ascii=False), encoding="utf-8")
                os.replace(tmp, rec_path)
            rep["saved"] = P.rel(target) + (" (already saved)" if same else "")
            rep["record"] = P.rel(rec_path)
            S.mark_saved(run_id, cp.label, wf, target)
            if cp.sha:
                S.idx[cp.sha] = target
            fl.marks = S.ledger(run_id).setdefault("steps", {})

        # ---- 2. meter (the ledger takes one line per run id; --resumed meters only the agents it has not seen)
        stage, lesson = meter_args(r)
        have = [l for l in read_cost(P) if l.get("run_id") == wf]
        if have and not opts.resumed:
            rep["metered"] = {"stage": stage, "already": True, "usd": round(sum(l["totals"]["usd"] for l in have), 4)}
        elif opts.dry:
            rep["metered"] = {"stage": stage, "would": True}
        else:
            argv = ["meter_run.py", "record", "--book", BOOK, "--stage", stage, "--run", wf] + (["--lesson", lesson] if lesson else []) \
                + (["--resumed"] if opts.resumed else [])
            m = ex.py(argv)
            if m.rc != 0:
                fl._rec("meter", "failed", f"exit {m.rc}", shlex.join(argv))
                raise StepFailed("meter", f"exit {m.rc}: {shlex.join(argv)}\n{m.key_lines()}")
            after = [l for l in read_cost(P) if l.get("run_id") == wf]
            new = after[len(have):]
            rep["metered"] = {"stage": stage, "already": False, "usd": round(sum(l["totals"]["usd"] for l in new), 4),
                              "run_total_usd": round(sum(l["totals"]["usd"] for l in after), 4),
                              "agents": sum(len(l.get("agents") or []) for l in new)}
            if after and not after[-1].get("complete", True):
                rep["warnings"].append("the meter marked the run incomplete (missing transcripts or an unpriced model)")
            if opts.resumed and not new:
                rep["metered"]["note"] = "the resume ran no new agent"

        # ---- 3. the after-steps for this kind of run
        A = Adv(P=P, plan=plan, run=r, kind=kind, S=S, fl=fl, result=result, wf=wf, copy=cp, saved=target, rep=rep, db=db, opts=opts)
        done = bool(HANDLERS[kind](A))
        rep["after_done"] = done

        # ---- 4. what comes next
        if done and not opts.dry:
            S.ledger(run_id)["after_done"] = True
        running = parse_running(opts.running)
        if opts.dry:                                 # nothing was saved: do not offer this very copy as launchable
            running.add((run_id, cp.label or None))
        prepare_ready(P, S, fl, rep, running, opts)
        rep.update(ready_list(P, S, running, opts))
    except Refuse as e:
        rep.update(ok=False, refused=str(e))
        return 2, finish(rep, fl, P, None, run_id, opts)
    except StepFailed as e:
        rep.update(ok=False, after_done=False, failure={"step": e.step, "detail": e.detail[-1800:]})
    except Exception as e:  # noqa: BLE001 — a bug must still produce the summary of what was done
        rep.update(ok=False, after_done=False, failure={"step": "internal error", "detail":
                   f"{type(e).__name__}: {e}\n{traceback.format_exc()[-900:]}"})
    return (0 if rep["ok"] else 1), finish(rep, fl, P, S, run_id, opts)


ORDER = ("run", "wf", "ok", "refused", "dry_run", "saved", "record", "metered", "steps", "counts", "backups", "warnings", "notes",
         "waiting", "failure", "checkpoint", "prepared", "skipped", "not_ready", "would_prepare", "after_done", "ready",
         "ready_scripts", "unprepared", "incomplete", "stale_copies", "lanes")


def finish(rep: dict, fl: Flow, P: Paths, S: State | None, run_id: str, opts: Opts) -> dict:
    rep["steps"] = fl.steps
    if fl.backups:
        rep["backups"] = list(fl.backups.values())
    ordered = {k: rep[k] for k in ORDER if k in rep}
    ordered.update({k: v for k, v in rep.items() if k not in ordered})
    rep.clear()
    rep.update(ordered)
    if S is not None and not opts.dry and rep.get("saved") and not rep.get("refused"):
        l = S.ledger(run_id)
        l["after_done"] = bool(rep.get("after_done")) and not rep.get("failure")
        l["failed_step"] = (rep.get("failure") or {}).get("step")
        l["updated"] = now()
        l["format"], l["run"] = "ainext.fanout-advance/1", run_id
        write_json(P.ledgers / f"{run_id}.json", l)
    return rep


# ================================================================ CLI
def dump(summary: dict) -> str:
    """Valid JSON with one top-level key per line (short, greppable)."""
    body = ",\n".join(f" {json.dumps(k)}: {json.dumps(v, ensure_ascii=False, default=str)}" for k, v in summary.items())
    return "{\n" + body + "\n}"


def cli_advance(a) -> int:
    opts = Opts(resumed=a.resumed, dry=a.dry_run, redo=a.redo, no_close=a.no_close_chapter, honor_gate=a.honor_gate,
                refresh_stale=a.refresh_stale, force=a.force, copy=a.copy, running=tuple(a.running or ()), verbose=a.verbose)
    say = (lambda m: print(m, file=sys.stderr)) if a.verbose else None
    rc, rep = advance(a.run_id, a.wf, a.task_output, opts, say=say)
    print(dump(rep))
    return rc


def cli_ready(a) -> int:
    opts = Opts(honor_gate=a.honor_gate, refresh_stale=a.refresh_stale, running=tuple(a.running or ()))
    P = Paths()
    if not P.plan.exists():
        print(f"no {P.rel(P.plan)}: run `uv run fanout.py plan` first")
        return 2
    plan = read_json(P.plan)
    running = parse_running(opts.running)
    S = State(P, plan)
    rep = new_report("(ready)", "", False)
    if a.prepare or a.refresh_stale:
        try:
            prepare_ready(P, S, Flow(P, Exec()), rep, running, opts)
        except StepFailed as e:
            rep["failure"] = {"step": e.step, "detail": e.detail[-600:]}
        S = State(P, plan)
    out = ready_list(P, S, running, opts)
    if a.paths:
        print("\n".join(out["ready_scripts"]))
        return 1 if rep.get("failure") else 0
    gate = S.by.get(GATE_RUN)
    out["chapter1_gate"] = ("honored" if opts.honor_gate else "lifted") if gate and not S.satisfied(gate) else "passed"
    for k in ("prepared", "skipped", "not_ready", "failure"):
        if rep.get(k):
            out[k] = rep[k]
    print(dump(out))
    return 1 if rep.get("failure") else 0


def add_parsers(sub) -> None:
    p = sub.add_parser("advance", help="process a finished Workflow run: save, meter, the plan's after-steps, prepare what is next, "
                                       "print what is ready")
    p.add_argument("run_id", help="the plan's run id (e.g. s1-ch04, lesson-g10m4s3-1, wcheck-ch03)")
    p.add_argument("--wf", required=True, help="the Workflow run id (wf_xxxxxxxx-xxx)")
    p.add_argument("--task-output", type=Path, help="the harness's task output file; default: the run's own record under ~/.claude")
    p.add_argument("--resumed", action="store_true", help="the run was resumed after an earlier record: meter only the new agents")
    p.add_argument("--dry-run", action="store_true", help="show every step that would run; save, meter and execute nothing")
    p.add_argument("--running", nargs="*", default=[], metavar="RUN[@COPY]",
                   help="runs (or one copy: wcheck-ch01@B.part2) in flight: never prepared, never listed ready")
    p.add_argument("--redo", action="store_true", help="ignore the skip-when-fresh rules and the 'already loaded' checks")
    p.add_argument("--no-close-chapter", action="store_true", help="after the last lesson, do not run close-chapter")
    p.add_argument("--honor-gate", action="store_true", help="make other chapters' lessons wait for s5-final-ch01 (the plan's go/no-go)")
    p.add_argument("--refresh-stale", action="store_true", help="regenerate a copy whose runbook script changed, for runs not "
                                                               "running and not saved")
    p.add_argument("--force", action="store_true", help="save a result whose embedded sha is not a current copy of this run")
    p.add_argument("--copy", help="which copy of the run this is (A, A.part2, B, B.part2, part1…) when it cannot be told")
    p.add_argument("-v", "--verbose", action="store_true", help="progress lines on stderr")
    p.set_defaults(fn=cli_advance)
    p = sub.add_parser("ready", help="the generated scripts that can be launched now, in plan order")
    p.add_argument("--running", nargs="*", default=[], metavar="RUN[@COPY]", help="runs in flight (excluded)")
    p.add_argument("--prepare", action="store_true", help="first prepare every run whose dependencies are saved and has no copy")
    p.add_argument("--refresh-stale", action="store_true", help="implies --prepare; regenerate stale copies of runs not running or saved")
    p.add_argument("--honor-gate", action="store_true", help="wait for s5-final-ch01 before other chapters' lessons")
    p.add_argument("--paths", action="store_true", help="only the absolute script paths, one per line")
    p.set_defaults(fn=cli_ready)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    add_parsers(sub)
    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())

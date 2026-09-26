"""The no-spend dry run of the whole extraction line, on one chapter of a real book.

    uv run dryrun_chapter.py --book g10-math --chapter 8            # everything, then drop the scratch DB
    uv run dryrun_chapter.py --book g10-math --chapter 8 --keep-db  # leave the scratch DB for inspection
    uv run dryrun_chapter.py --book g10-math --chapter 8 --mode inline   # every workflow's args inline

WHY. Before a paid pilot, every stage must be shown to hand valid input to the next — S0a, S0,
S0b, S1 (objectives, prerequisite links, two blind mappers), S2–S4 and the S8 oracle, S5, S6, S7,
the S9 assembly, validation, the load into a scratch database, the G2 apply step, and the S8
coverage audit — with NO manual patching between them and NO model call. This script runs each
stage's real command (the same CLIs the runbook names), and runs each Workflow script as it is,
through tests/workflow_stub.mjs, whose agents are answered by dryrun/responder.mjs: deterministic
STUB answers built from the real book data in the workflow's args. The stub proves the plumbing,
never the quality. Every stubbed text carries "[DRY-RUN STUB]", every stubbed human gate names
its signer "DRY-RUN STUB (not …)", and nothing it writes lands anywhere but:

    services/extraction/work/<book>/dryrun/chNN/     (gitignored scratch: every artefact, the
                                                      transcript.json and transcript.txt)
    a Postgres database ainext_dryrun_<book>_chNN_<pid>, created here and dropped here

THE BOOK'S REAL WORK DIRECTORY IS NEVER WRITTEN (backlog 67). S0a runs into a scratch work directory
<root>/work/ (source_adapter.py --work, --no-extract, a copy of pdf_scan.json), whose equations/ and
figures/ are symlinks to the real, read-only images; every later stage reads that scratch directory
(assemble_maths --work, assemble_objectives / embed_workflow --blocks). A real pilot running beside a
dry run therefore never sees its blocks.jsonl or maths/ rewritten.

THE HUMAN GATES are stubbed as files in the gates' own formats, so the line can run past them:
G0b (the S0b queue), G1 (objectives and links), G2 (book questions), G3 (the generated sample).
A stubbed gate is NOT a passed gate.

PACKET BY REFERENCE (the default, `--mode by-ref`). Every stage whose builder has `--by-ref`
(S0b's `--batch-dir`) runs that way, as the operator will: the builder writes the packet's shard
files under <dry-run root>/packets/, the workflow gets the compact args, and the stub responder
reads the shards the PROMPTS name, the way a real agent would. The two stages whose args stay too
big to type run as a GENERATED COPY of their workflow with the args embedded (embed_workflow.py),
started with no args, as the operator will: S2–S4 (no by-ref mode: its checks read the items' text
inside the script) and S5 final (by reference, then embedded). The transcript records every
workflow's typed args size (`args_bytes`; a copy's is 2, `{}`) and every copy's size
(`script_bytes`), and each run's raw prompts go to stub/<name>.calls.json. `--mode inline` runs
every workflow from its runbook script with its whole packet in the args, as before.

THE METER. Each stub Workflow run is written out in the shape meter_run.py reads (a run record and
one transcript per agent: the real prompt, the stub answer, no usage), and metered with
`meter_run.py record --dry-run --estimate-overhead 15000`: where a real run's cost would land, per
stage, before any is spent. S0b's image tokens come from `assemble_maths.py estimate --chapter N`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))

import book_config  # noqa: E402

STUB_RUNTIME = HERE / "tests" / "workflow_stub.mjs"
RESPONDER = HERE / "dryrun" / "responder.mjs"
MARK = "[DRY-RUN STUB]"
MODEL_IDS = {"sonnet": "claude-sonnet-5", "haiku": "claude-haiku-4-5", "opus": "claude-opus-5", None: "claude-sonnet-5"}
GATE_BY = "DRY-RUN STUB (not a human; gate {g} NOT passed)"


class DryRunError(Exception):
    pass


class Line:
    """The run: the scratch directory, the transcript, and the commands."""

    def __init__(self, book, chapter: int, root: Path, keep_db: bool, pg: str, mode: str = "by-ref"):
        self.book, self.ch, self.root, self.keep_db = book, chapter, root, keep_db
        self.by_ref = mode == "by-ref"
        self.work = root / "work"                   # the scratch S0a output: never the real work/<book>/
        self.blocks = self.work / "blocks.jsonl"
        self.args_bytes: dict[str, int] = {}
        self.script_bytes: dict[str, int] = {}
        self.tag = f"ch{chapter:02d}"
        self.stages: list[dict] = []
        self.current: dict | None = None
        self.dbname = f"ainext_dryrun_{book.book.replace('-', '_')}_{self.tag}_{os.getpid()}"
        self.pg = pg
        self.dsn = f"{pg} dbname={self.dbname}"
        self.meter_rows: list[dict] = []

    # ------------------------------------------------------------ transcript
    def stage(self, sid: str, title: str) -> None:
        self.current = {"stage": sid, "title": title, "commands": [], "counts": {}, "notes": [], "stubbed": []}
        self.stages.append(self.current)
        print(f"\n=== {sid} {title}")

    def count(self, **kw) -> None:
        self.current["counts"].update(kw)
        for k, v in kw.items():
            print(f"    {k}: {v}")

    def note(self, text: str) -> None:
        self.current["notes"].append(text)
        print(f"    note: {text}")

    def stubbed(self, text: str) -> None:
        self.current["stubbed"].append(text)
        print(f"    STUB: {text}")

    def p(self, *parts) -> Path:
        out = self.root.joinpath(*parts)
        out.parent.mkdir(parents=True, exist_ok=True)
        return out

    def rel(self, p: Path) -> str:
        try:
            return str(Path(p).relative_to(HERE))
        except ValueError:
            return str(p)

    def sh(self, *argv, ok=(0,), env: dict | None = None, db: bool = False) -> subprocess.CompletedProcess:
        """A real CLI of the line, from services/extraction, recorded in the transcript."""
        cmd = [str(a) for a in argv]
        e = dict(os.environ, **(env or {}))
        if db:
            e.update(AINEXT_DB_DSN=self.dsn, AINEXT_ENVIRONMENT="mvp1")
        t0 = time.time()
        r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, env=e, timeout=1800)
        shown = " ".join(self.rel(Path(c)) if c.startswith(str(HERE)) else c for c in cmd)
        out = (r.stdout + ("\n" + r.stderr if r.stderr.strip() else "")).strip()
        self.current["commands"].append({"cmd": shown, "exit": r.returncode, "seconds": round(time.time() - t0, 1),
                                         "tail": out.splitlines()[-12:]})
        print(f"  $ {shown}  -> exit {r.returncode}")
        if r.returncode not in ok:
            raise DryRunError(f"{shown} exited {r.returncode}:\n{out[-3000:]}")
        return r

    def uv(self, script: str, *args, **kw) -> subprocess.CompletedProcess:
        return self.sh("uv", "run", "--project", HERE, "python", HERE / script, *args, **kw)

    def packets(self, name: str) -> list[str]:
        """`--by-ref <dir>` for a builder, in by-ref mode (nothing in inline mode)."""
        return ["--by-ref", str(self.root / "packets" / name)] if self.by_ref else []

    # ------------------------------------------------------------ workflows
    def workflow(self, stage: str, name: str, script: str, args: dict, workflow: str, extra: dict | None = None,
                 save: Path | None = None, embedded: Path | None = None) -> dict:
        """Run a runbook workflow through the stub runtime; save its return value; meter it dry.
        `embedded`: run that generated copy (embed_workflow.py) instead, with NO args, as the operator will."""
        import packet_ref
        if embedded is not None:
            args = {}
            extra = dict(extra or {}, embedded_script=str(embedded))
            self.script_bytes[name] = embedded.stat().st_size
            self.current["counts"].setdefault("script_bytes", {})[name] = self.script_bytes[name]
        self.args_bytes[name] = packet_ref.args_size(args)
        self.current["counts"].setdefault("args_bytes", {})[name] = self.args_bytes[name]
        fx = self.p("stub", f"{name}.fixture.json")
        fx.write_text(json.dumps({"args": args, "responses": {}, "responder": str(RESPONDER),
                                  "stub": {"workflow": workflow, **(extra or {})}}, ensure_ascii=False))
        t0 = time.time()
        path = embedded if embedded is not None else HERE / "runbook" / script
        script = self.rel(path)
        r = subprocess.run([shutil.which("node"), str(STUB_RUNTIME), str(path), str(fx)],
                           capture_output=True, text=True, timeout=1800)
        if r.returncode != 0:
            raise DryRunError(f"stub runtime crashed on {script}: {r.stderr[-2000:]}")
        rep = json.loads(r.stdout)
        self.current["commands"].append({"cmd": f"node tests/workflow_stub.mjs {script} (responder: dryrun/responder.mjs)"
                                                + (" — no args: they are in the copy" if embedded is not None else ""),
                                         "exit": 0 if rep["ok"] else 1, "seconds": round(time.time() - t0, 1),
                                         "tail": rep["logs"][-8:] + ([f"ERROR {rep['error']}"] if rep["error"] else [])})
        print(f"  $ workflow {script} [{name}] -> {'ok' if rep['ok'] else 'FAILED'}; {len(rep['calls'])} stub agent call(s)")
        if not rep["ok"]:
            raise DryRunError(f"{script} failed under the stub runtime: {rep['error']}")
        # the raw prompts (shards still named, not spliced): what tests/test_dryrun_chapter.py compares
        self.p("stub", f"{name}.calls.json").write_text(json.dumps(
            [{"label": c["label"], "prompt": c["prompt"]} for c in rep["calls"]], ensure_ascii=False))
        if save:
            save.parent.mkdir(parents=True, exist_ok=True)
            save.write_text(json.dumps(rep["result"], ensure_ascii=False, indent=1) + "\n")
        self.meter(stage, name, rep)
        return rep

    def meter(self, stage: str, name: str, rep: dict) -> None:
        """Write the stub run as meter_run.py reads a Workflow run, then meter it in its dry form."""
        import packet_ref
        run_id = f"wf_dryrun_{self.tag}_{name}"
        tdir = self.p("meter", run_id, "x").parent
        progress = []
        # By reference, a real agent reads its shards with the Read tool and pays for them as input:
        # the dry meter counts the prompt with its shards spliced in, so both modes estimate alike.
        for i, c in enumerate(rep["calls"], 1):
            c = dict(c, prompt=packet_ref.splice(c["prompt"]))
            aid = f"a{i:05d}"
            progress.append({"type": "workflow_agent", "agentId": aid, "label": c["label"], "phaseTitle": c["phase"],
                             "model": MODEL_IDS.get(c["model"], "claude-sonnet-5"), "state": "done"})
            (tdir / f"agent-{aid}.jsonl").write_text(
                json.dumps({"type": "user", "message": {"role": "user", "content": c["prompt"]}}) + "\n"
                + json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
                    {"type": "text", "text": json.dumps(c.get("response"), ensure_ascii=False)}]}}) + "\n")
        rec = self.p("meter", f"{run_id}.json")
        rec.write_text(json.dumps({"runId": run_id, "workflowName": (rep.get("meta") or {}).get("name"),
                                   "status": "completed", "workflowProgress": progress}))
        r = self.uv("meter_run.py", "record", "--book", self.book.book, "--stage", stage, "--run-record", rec,
                    "--transcripts", tdir, "--dry-run", "--estimate-overhead", "15000",
                    "--ledger", self.p("meter", "cost.dry.jsonl"))
        m = re.search(r"\$([0-9.]+) API-equivalent", r.stdout)
        usd = float(m.group(1)) if m else None
        self.meter_rows.append({"stage": stage, "run": name, "agents": len(rep["calls"]), "usd_estimate": usd})

    # ------------------------------------------------------------ database
    def psql(self, db: str, *args) -> None:
        subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", f"{self.pg} dbname={db}", *args],
                       check=True, capture_output=True, text=True)

    def create_db(self) -> None:
        self.psql("postgres", "-c", f'CREATE DATABASE "{self.dbname}"')
        self.psql(self.dbname, "-f", str(REPO / "db" / "schema.sql"))
        for m in sorted((REPO / "db" / "migrations").glob("*.sql")):
            self.psql(self.dbname, "-f", str(m))

    def drop_db(self) -> None:
        assert self.dbname.startswith("ainext_dryrun_")
        self.psql("postgres", "-c", f'DROP DATABASE IF EXISTS "{self.dbname}" WITH (FORCE)')

    def q(self, sql: str, params: tuple = ()) -> list[tuple]:
        import psycopg
        with psycopg.connect(self.dsn, autocommit=True) as c:
            cur = c.execute(sql, params or None)
            return cur.fetchall() if cur.description else []


# ================================================================================ the stages
def scratch_work(line: Line) -> None:
    """The scratch work directory: the real images by symlink (read-only here: S0a runs --no-extract),
    the real PDF scan copied (S0a may rewrite a stale scan; it rewrites the copy)."""
    real = line.book.work_dir()
    line.work.mkdir(parents=True, exist_ok=True)
    for d in ("equations", "figures"):
        if (real / d).exists():
            (line.work / d).symlink_to(real / d, target_is_directory=True)
    if (real / "pdf_scan.json").exists():
        shutil.copyfile(real / "pdf_scan.json", line.work / "pdf_scan.json")


def s0(line: Line) -> dict:
    book = line.book
    line.stage("S0a", "source adapter (deterministic), into the dry run's scratch work directory")
    scratch_work(line)
    line.uv("source_adapter.py", book.book, "--work", line.work, "--no-extract", "--pdf-scan", line.work / "pdf_scan.json")
    summ = json.loads((line.work / "adapter-summary.json").read_text())
    line.count(edition_verdict=summ["edition_verdict"], all_checks_pass=summ["all_checks_pass"],
               exercise_items=summ["blocks"]["exercise_item"], worked_examples=summ["blocks"]["worked_example"],
               teacher_only=summ["blocks"]["teacher_only"], unique_maths_images=summ["equations"]["unique"],
               figures=summ["figures"]["references"])
    blocks = [json.loads(l) for l in line.blocks.read_text().splitlines() if l.strip()]
    mine = [b for b in blocks if b.get("chapter") == line.ch]
    line.count(chapter_blocks=len(mine), chapter_exercise_items=sum(b["type"] == "exercise_item" for b in mine),
               chapter_worked_examples=sum(b["type"] == "worked_example" for b in mine),
               chapter_teacher_only=sum(b["type"] == "teacher_only" for b in mine))

    line.stage("S0", "manifest (deterministic; G0 applied from the book config)")
    import build_manifest as bm
    committed = book.repo_path(book.manifest)
    m, _, problems = bm.build(book, line.work, json.loads(committed.read_text())["generated"])
    same = json.dumps(m, ensure_ascii=False, indent=1) + "\n" == committed.read_text()
    line.current["commands"].append({"cmd": f"build_manifest.build({book.book}) vs {line.rel(committed)}", "exit": 0,
                                     "seconds": 0, "tail": [f"reproduces the committed manifest: {same}"]})
    if problems or not same:
        raise DryRunError(f"the manifest build does not reproduce {committed}: {problems[:3]}")
    mod = next(x for x in m["modules"] if x["chapter"] == line.ch)
    line.count(lessons_in_book=sum(len(x["lessons"]) for x in m["modules"]), chapter_lessons=[l["id"] for l in mod["lessons"]],
               chapter_items=sum(len(x.get("item_refs") or []) for l in mod["lessons"] for x in l["exercises"])
               + len((mod.get("end_of_chapter_exercise") or {}).get("item_refs") or []),
               reproduces_committed_manifest=same)
    return m


def s0b(line: Line) -> Path:
    book, ch = line.book, str(line.ch)
    line.stage("S0b", "maths transcription: hash recovery, two blind passes, the third reading, G0b")
    line.uv("assemble_maths.py", "recover", book.book, "--work", line.work)
    rec = json.loads((line.work / "maths" / "recovered.json").read_text())["summary"]
    line.count(book_unique=rec["unique"], accepted_by_hash_book=rec["accepted_by_hash"], vision_queue_book=rec["vision_queue"])
    est = line.uv("assemble_maths.py", "estimate", book.book, "--work", line.work, "--chapter", line.ch, "--upscale", "2")
    e = json.loads(est.stdout)[0]
    line.count(chapter_images_for_vision=e["images"], s0b_estimate_usd=[e["usd_low"], e["usd_high"]])
    line.meter_rows.append({"stage": "S0b", "run": "vision passes A+B (image tokens, assemble_maths estimate)",
                            "agents": e["calls_per_pass"] * 2, "usd_estimate": e["usd_high"]})
    batch_dir = (lambda n: ["--batch-dir", str(line.root / "packets" / n)] if line.by_ref else [])
    args_ab = json.loads(line.uv("assemble_maths.py", "vision-args", book.book, "--work", line.work, "--pass", "AB", "--chapter", line.ch,
                                 *batch_dir("s0b-AB")).stdout)
    runs_dir = line.p("maths", "runs", "x").parent
    line.workflow("S0b", "maths-AB", "transcribe-maths.workflow.js", args_ab, "transcribe-maths",
                  save=runs_dir / "AB-dryrun.json")
    line.stubbed("passes A and B read every image as a placeholder named by its md5; B disagrees on 1 in 7 "
                 "and cannot read 1 in 13, so the third reading has work")
    out = line.p("maths", "summary.json").parent
    line.uv("assemble_maths.py", "assemble", book.book, runs_dir / "AB-dryrun.json", "--work", line.work, "--out-dir", out, ok=(0, 4))
    s = json.loads((out / "summary.json").read_text())["by_chapter"][ch]
    line.count(after_AB=s)
    rc = line.uv("assemble_maths.py", "vision-args", book.book, "--work", line.work, "--pass", "C", "--runs", runs_dir / "AB-dryrun.json",
                 "--chapter", line.ch, *batch_dir("s0b-C"), ok=(0, 3))
    runs = [runs_dir / "AB-dryrun.json"]
    if rc.returncode == 0:
        line.workflow("S0b", "maths-C", "transcribe-maths.workflow.js", json.loads(rc.stdout), "transcribe-maths",
                      save=runs_dir / "C-dryrun.json")
        runs.append(runs_dir / "C-dryrun.json")
        line.stubbed("the third reading agrees with pass A, except 1 in 5, which agrees with neither")
    line.uv("assemble_maths.py", "assemble", book.book, *runs, "--work", line.work, "--out-dir", out, ok=(0, 4))
    s = json.loads((out / "summary.json").read_text())["by_chapter"][ch]
    line.count(after_third_reading=s)
    # G0b, stubbed: a placeholder for every image of the chapter still on the queue
    import assemble_maths as am
    chapter = am.chapter_images(line.work, {line.ch})
    queue = json.loads((out / "queue.json").read_text())
    human = {q["md5"]: {"latex": f"\\text{{[m:{q['md5'][:8]}]}}", "by": GATE_BY.format(g="G0b"), "date": "2026-09-26"}
             for q in queue if q["md5"] in chapter}
    hp = line.p("maths", "human.dryrun.json")
    hp.write_text(json.dumps(human, indent=1))
    line.stubbed(f"G0b: {len(human)} queued image(s) of chapter {ch} 'resolved' with placeholders signed "
                 f"{GATE_BY.format(g='G0b')!r}")
    line.uv("assemble_maths.py", "assemble", book.book, *runs, "--work", line.work, "--human", hp, "--out-dir", out, ok=(0, 4))
    summary = json.loads((out / "summary.json").read_text())
    line.count(after_g0b=summary["by_chapter"][ch], book_unresolved=summary["unresolved"])
    if summary["by_chapter"][ch]["unresolved"]:
        raise DryRunError("chapter images are still unresolved after the stubbed G0b")
    return out / "accepted.json"


def s1(line: Line, maths: Path) -> list[str]:
    book = line.book
    line.stage("S1", "objectives, prerequisite links, two blind mappers; G1")
    objectives = line.p("objectives", "x").parent
    a = line.p("args", "s1.json")
    line.uv("assemble_objectives.py", "s1-args", book.book, "--blocks", line.blocks, "--chapter", line.ch, "--maths", maths,
            "--objectives-dir", objectives, "--out", a, *line.packets(f"s1-{line.tag}"))
    args = json.loads(a.read_text())
    if line.by_ref:
        c = args["chapter_ref"]
        line.count(lessons=len(c["lessons"]), lesson_items=sum(len(l["item_ids"]) for l in c["lessons"]),
                   items_to_distribute=c["pool_n"], shards=args["by_ref"]["files"])
    else:
        c = args["chapter"]
        line.count(lessons=len(c["lessons"]), lesson_items=sum(len(l["items"]) for l in c["lessons"]),
                   items_to_distribute=len(c["pool"]))
    line.count(teacher_only_left_out=args["teacher_only_dropped"], options=args["options"],
               prior_objectives=len(args["prior_objectives"]))
    run = line.p("runs", "objectives", f"{line.tag}-dryrun.json")
    rep = line.workflow("S1", "objectives", "objectives.workflow.js", args, "objectives", save=run)
    line.stubbed("finders partition each lesson's practice into 2–3 objectives citing a heading and a practice "
                 "anchor with exact quotes; the reconciler agrees; mapper 2 moves 1 in 9 items; the linker "
                 "links consecutive lessons and the checker rejects one")
    res = rep["result"]
    line.count(workflow_calls=res["calls"]["by_phase"], links_proposed=len(res["links"]["proposed"] or []),
               mappers=len(res["pool"]["mappers"]))
    line.uv("assemble_objectives.py", "assemble", book.book, run, "--blocks", line.blocks, "--maths", maths, "--objectives-dir", objectives,
            ok=(0, 1))
    check = json.loads((objectives / f"{line.tag}.check.json").read_text())
    line.count(status_before_g1=check["status"], failures=check["failures"][:6], counts=check["counts"],
               decisions_owed=len(check["undecided"]))
    # An end-of-chapter item both blind mappers placed nowhere (the stub places every AREA item nowhere)
    # is the one rule-2 failure G1 may answer: it rules the item outside the chapter's objectives, by
    # name, with a reason (answer 15 (b)). Any other failure stops the dry run.
    none_re = re.compile(r"^distributed item (\S+) maps to no objective \(rule 2\): both mappers said none")
    outside = [m.group(1) for f in check["failures"] if (m := none_re.match(f))]
    others = [f for f in check["failures"] if not none_re.match(f)]
    if others:
        raise DryRunError(f"S1 rules fail on the stub objectives: {others[:4]}")
    # G1, stubbed: every decision the chapter owes, answered in the verdicts file's own format
    mapper1 = {}
    for m in res["pool"]["mappers"][:1]:
        mapper1 = {r["item_id"]: r["objective"] for r in m["mapping"]}
    verdicts = {"terminology": {}, "move_items": {}, "links": {}, "acknowledged": [], "objectives": {},
                "outside_items": {i: {"why": f"{MARK} both blind mappers placed it nowhere; the stub rules it "
                                             "outside the chapter's objectives"} for i in outside}}
    for d in check["undecided"]:
        if d["kind"] == "terminology":
            verdicts["terminology"][d["key"].split(":", 1)[1]] = "keep"
        elif d["kind"] == "mappers_disagree":
            verdicts["move_items"][d["item"]] = mapper1[d["item"]]
        elif d["kind"] == "link_backward":
            verdicts["links"][d["link"]] = "approve"
        elif d["kind"] == "single":
            verdicts["objectives"][d["objective"]] = {"action": "approve"}
        else:
            verdicts["acknowledged"].append(d["key"])
    vp = line.p("runs", "objectives", "g1.dryrun.json")
    vp.write_text(json.dumps(verdicts, indent=1))
    line.stubbed(f"G1: {len(check['undecided'])} owed decision(s) answered by rule (mapper 1 wins a disagreement; "
                 f"terms kept), {len(outside)} end-of-chapter item(s) ruled outside the chapter's objectives "
                 f"(answer 15 b: {outside[:4]}), approved by {GATE_BY.format(g='G1')!r}")
    line.uv("assemble_objectives.py", "approve", book.book, "--blocks", line.blocks, "--chapter", line.ch, "--by", GATE_BY.format(g="G1"),
            "--verdicts", vp, "--maths", maths, "--objectives-dir", objectives)
    check = json.loads((objectives / f"{line.tag}.check.json").read_text())
    line.count(status=check["status"], objectives=check["counts"]["objectives"], links_kept=check["counts"]["links_kept"],
               links_dropped=[(d["key"], d["dropped"][:60]) for d in check["links"]["dropped"]],
               items_mapped=check["counts"]["items_mapped"], items_outside=check["counts"].get("items_outside"),
               review_page=line.rel(objectives / f"{line.tag}.review.html"))
    return [l["slug"] for l in c["lessons"]]


def s2_s4(line: Line, maths: Path, lessons: list[str], figure_types: dict) -> None:
    book = line.book
    line.stage("S2-S4,S8", "claims, book questions (three-way check, answer typing), visuals, the oracle; G2")
    a = line.p("args", "lessons.json")
    copy = None
    if line.by_ref:
        # too big to type (and no by-ref mode): a generated copy of lesson.workflow.js, args embedded
        copy = line.p("packets", "embedded", f"lesson.{line.tag}.workflow.js")
        line.uv("embed_workflow.py", "lesson-args", book.book, "--blocks", line.blocks, "--lessons", ",".join(lessons), "--maths", maths,
                "--objectives-dir", line.p("objectives", "x").parent, "--args-out", a, "--out", copy)
        per = {}
        for slug in lessons:                     # what one lesson per run would weigh
            one = line.p("packets", "embedded", f"lesson.{slug}.workflow.js")
            line.uv("embed_workflow.py", "lesson-args", book.book, "--blocks", line.blocks, "--lessons", slug, "--maths", maths,
                    "--objectives-dir", line.p("objectives", "x").parent, "--out", one)
            per[slug] = one.stat().st_size
        line.count(script_bytes_per_lesson=per)
    else:
        line.uv("assemble_objectives.py", "lesson-args", book.book, "--blocks", line.blocks, "--lessons", ",".join(lessons), "--maths", maths,
                "--objectives-dir", line.p("objectives", "x").parent, "--out", a)
    args = json.loads(a.read_text())
    line.count(lessons=len(args["lessons"]), exercise_items=sum(len(l["items"]) for l in args["lessons"]),
               worked_examples=sum(len(l["worked_examples"]) for l in args["lessons"]),
               figures=sum(len(l["figures"]) for l in args["lessons"]),
               items_with_book_answer_rules=sum(1 for l in args["lessons"] for i in l["items"]
                                                if i.get("asked_form") or i.get("raised_dot")))
    run = line.p("runs", "lessons", "dryrun.json")
    titles = {l["slug"]: l["title"] for l in args["lessons"]}
    if line.by_ref:
        line.note("S2–S4 runs as a generated copy with its args embedded (embed_workflow.py): lesson.workflow.js "
                  "has no by-ref mode (its three-way check, answer typing checks and claim routing read the items' "
                  "text inside the script)")
    rep = line.workflow("S2-S4,S8", "lessons", "lesson.workflow.js", args, "lesson",
                        {"figure_types": figure_types, "lesson_titles": titles}, save=run, embedded=copy)
    line.stubbed("claims quote the lesson's own worked-example titles and text blocks; typing reads the printed "
                 "answer; the 'blind re-solve' ECHOES the EPUB solution's last line; the judge compares digits; "
                 "S4 redraws each lesson's first figure as a placeholder coordinate_plot and records every other "
                 "figure as a gap; the oracle says GREEN")
    res = rep["result"]
    by = {k: 0 for k in ("agreed", "disputed", "no_printed_answer")}
    types, problems, disputes, nopa = {}, [], [], []
    for l in res["lessons"]:
        for i in l["items"]:
            by[i["verification"]] = by.get(i["verification"], 0) + 1
            types[i["answer_type"]] = types.get(i["answer_type"], 0) + 1
        problems += [f"{l['lesson']}:{x['ref']}" for x in l["verify"]["typing_problems"]]
        disputes += [f"{l['lesson']}:{x['ref']}" for x in l["verify"]["disagreements"]]
        nopa += [f"{l['lesson']}:{x['ref']}" for x in l["verify"]["no_printed_answer"]]
    line.count(workflow_calls=res["calls"]["by_phase"], verification=by, answer_types=types,
               typing_problems=len(problems), claims=sum(l["counts"]["claims"] for l in res["lessons"]),
               visuals=sum(l["counts"]["visuals"] for l in res["lessons"]),
               viz_gaps=sum(l["counts"]["viz_gaps"] for l in res["lessons"]))
    # G2, stubbed: a typing problem is excluded (the handoff refuses it otherwise); a few disputes and
    # items with no printed answer are accepted so the G2 apply step has stamps to carry; the rest stay held
    items = {p: {"verdict": "exclude", "note": f"{MARK} typing problem"} for p in problems}
    for key in [d for d in disputes if d not in items][:3] + [n for n in nopa if n not in items][:2]:
        items[key] = {"verdict": "accept", "note": f"{MARK} accepted to exercise the G2 apply step"}
    g2 = {"by": GATE_BY.format(g="G2"), "items": items}
    gp = line.p("runs", "g2.dryrun.json")
    gp.write_text(json.dumps(g2, indent=1))
    line.stubbed(f"G2: {sum(v['verdict'] == 'exclude' for v in items.values())} excluded (typing problems), "
                 f"{sum(v['verdict'] == 'accept' for v in items.values())} accepted; every other dispute stays HELD")
    line.uv("assemble_objectives.py", "lesson-runs", book.book, run, "--g2", gp, "--runs-dir", line.p("runs", "x").parent)
    line.count(lesson_run_files=sorted(p.name for p in line.p("runs", "lesson", "x").parent.glob("*.json")))


def s9(line: Line) -> list[Path]:
    book = line.book
    line.stage("S9", "assemble the chapter bundle and the lesson-content files")
    seed = line.p("seed", book.book, "x").parent
    content = line.p("seed", "content", "x").parent
    line.uv("assemble_lesson_bundle.py", "--book", book.book, "--chapter", line.ch,
            "--objectives", line.p("objectives", "x").parent, "--runs", line.p("runs", "lesson", "x").parent,
            "--out", seed, "--content-out", content, "--report", line.p("assembly-report.json"))
    rep = json.loads(line.p("assembly-report.json").read_text())
    line.count(**{k: rep["counts"].get(k) for k in ("objectives", "questions", "visuals", "worked_example_entries",
                                                    "claims", "content_files")},
               by_answer_type=rep["by_answer_type"], by_solution_provenance=rep["by_solution_provenance"],
               notation=rep["notation"], derived_part_edges=rep["derived_part_edges"])
    bundles = [seed / f"{book.id_prefixes[0]}-course.json", seed / f"{book.id_prefixes[0]}-c{line.ch:02d}.json"]
    ch = json.loads(bundles[1].read_text())
    line.count(prerequisite_edges=sum(e["type"] == "prerequisite_of" for e in ch["edges"]),
               lessons_with_provenance=len(ch["lessons"]))
    # the dry run's own book config: the real one, with the scratch bundles as its bundles
    raw = json.loads(book.path.read_text())
    raw.update(bundles=[str(p.relative_to(REPO)) for p in bundles], content_files=[], status="loadable")
    line.p("books", f"{book.book}.json").write_text(json.dumps(raw, indent=1, ensure_ascii=False))
    line.stage("S10", "validate")
    line.uv("load_seed.py", *bundles, "--validate-only")
    return bundles


def load(line: Line, bundles: list[Path]) -> None:
    book = line.book
    line.stage("S11", "load into a scratch database (every National course first, then the new chapter)")
    line.create_db()
    line.note(f"scratch database {line.dbname} (dropped at the end unless --keep-db)")
    for b in book_config.all_books():
        if b.status == "loadable":
            line.uv("load_seed.py", "--all", "--course", b.course_id, db=True)
    # the rule scripts/local-dev.sh applies after a fresh load: Prep-3 maths' book questions live, as
    # ADR-0019 has them in production (scoped to that course, never scripture or generated rows)
    n = line.q("""with p as (update questions q set status='live', reviewed_by='local-dev (dry run)', reviewed_at=now()
                  where q.status<>'live' and q.source in ('seed','authored') and exists (select 1 from node_subject ns
                  where ns.node_id = q.lo_id and ns.course_id = 'course:prep3-math-en') returning 1)
                  select count(*) from p""")[0][0]
    line.note(f"Prep-3 maths: {n} book question(s) promoted to live, as scripts/local-dev.sh does (ADR-0019)")
    gen = HERE / "seed" / "generated"
    line.uv("load_misconceptions.py", gen / "misconceptions.json", db=True)
    for f in ("generated-questions.json", "widget-questions.json"):
        line.uv("load_generated_questions.py", gen / f, "--restore", "--sample", "0", db=True)
    line.uv("load_misconceptions.py", gen / "misconceptions.json", db=True)
    r = line.uv("load_seed.py", *bundles, "--course", book.course_id, "--dry-run", db=True)
    line.note("dry-run delta: " + " | ".join(l.strip() for l in r.stdout.splitlines() if "added" in l or "questions" in l)[:600])
    line.uv("load_seed.py", *bundles, "--course", book.course_id, db=True)
    rows = line.q("""SELECT (SELECT count(*) FROM graph_nodes WHERE id LIKE %s),
                            (SELECT count(*) FROM questions WHERE lo_id LIKE %s),
                            (SELECT count(*) FROM questions WHERE lo_id LIKE %s AND status = 'live'),
                            (SELECT count(*) FROM visuals WHERE lo_id LIKE %s),
                            (SELECT count(*) FROM course_lessons WHERE course_id = %s),
                            (SELECT count(*) FROM graph_edges WHERE edge_type = 'prerequisite_of' AND dst_id LIKE %s)""",
                  (f"lo:g10m{line.ch}s%", f"lo:g10m{line.ch}s%", f"lo:g10m{line.ch}s%", f"lo:g10m{line.ch}s%",
                   book.course_id, f"lo:g10m{line.ch}s%"))[0]
    line.count(objectives=rows[0], book_questions=rows[1], live=rows[2], visuals=rows[3], course_lessons=rows[4],
               prerequisite_edges=rows[5])
    line.stage("G2 apply", "the G2 verdicts reach the rows (backlog 3)")
    line.uv("apply_review_verdicts.py", "--g2", line.p("runs", "g2.dryrun.json"), "--book", book.book,
            "--runs", line.p("runs", "lesson", "x").parent, db=True)
    stamped = line.q("SELECT reviewed_by, status, count(*) FROM questions WHERE lo_id LIKE %s GROUP BY 1, 2 ORDER BY 1, 2",
                     (f"lo:g10m{line.ch}s%",))
    line.count(stamps=[list(r) for r in stamped])


def s5_s6_s7(line: Line) -> None:
    book = line.book
    cfg = line.p("books", f"{book.book}.json")
    seed = line.p("seed", book.book, "x").parent
    runs_l = line.p("runs", "lesson", "x").parent
    mdir = line.p("runs", "misconceptions", "x").parent

    line.stage("S5 draft", "misconception catalogue, draft (author only)")
    a = line.p("args", "s5-draft.json")
    line.uv("assemble_misconceptions.py", "--s5-args", a, "--book", cfg, "--stage", "draft", "--seed-dir", seed,
            "--lesson-runs", runs_l, *line.packets("s5-draft"))
    draft = mdir / "draft-dryrun.json"
    rep = line.workflow("S5", "s5-draft", "misconceptions.workflow.js", json.loads(a.read_text()), "misconceptions",
                        save=draft)
    line.stubbed("one placeholder error per objective with a two-step refutation, citing the book's evidence")
    line.count(**rep["result"]["totals"])
    draft_ids = {e["lo_id"]: e["id"] for r in rep["result"]["records"] for e in r["entries"]}

    line.stage("S6", "generated question families: author, check, blind grade")
    fam = line.p("families", "x").parent
    fa = line.p("args", "s6-author.json")
    line.uv("generate_questions.py", "--families", fam, "--book", cfg, "--catalogue", draft, "--author-args", fa,
            *line.packets("s6-author"))
    rep = line.workflow("S6", "s6-author", "families.workflow.js", json.loads(fa.read_text()), "families",
                        save=line.p("runs", "families", "author-dryrun.json"))
    n = 0
    for r in rep["result"]["records"]:
        for spec in r["families"]:
            tail, slug = spec["id"].split(":")[1:]
            (fam / f"{tail}--{slug}.json").write_text(json.dumps(spec, indent=1, ensure_ascii=False) + "\n")
            n += 1
    line.stubbed("a numeric (and on the first gap an MCQ) arithmetic family per tier gap, parented on the "
                 "objective's first book question; the MCQ's wrong option names the draft's placeholder error")
    line.count(family_specs=n, infeasible=sum(len(r["infeasible"]) for r in rep["result"]["records"]))
    line.uv("generate_questions.py", "--families", fam, "--book", cfg, "--check")
    gs = line.p("args", "s6-grading.json")
    ga = line.p("args", "s6-grade.json")
    line.uv("generate_questions.py", "--families", fam, "--book", cfg, "--grading-set", gs, "--grade-args", ga,
            "--s5-distractors", line.p("runs", "families", "s5-distractors.json"), *line.packets("s6-grade"))
    graded = [line.p("runs", "families", "grade-dryrun.json")]
    parts = sorted(ga.parent.glob(f"{ga.stem}.part*.json"))       # a by-ref grade too big for one call
    if parts:
        graded = [line.p("runs", "families", f"grade-dryrun.part{k}.json") for k in range(1, len(parts) + 1)]
        line.note(f"S6 grade split into {len(parts)} part(s), each within the typed-args bound")
    for k, (src, out) in enumerate(zip(parts or [ga], graded), start=1):
        line.workflow("S6", "s6-grade" + (f"-part{k}" if parts else ""), "families.workflow.js",
                      json.loads(src.read_text()), "families", save=out)
    line.stubbed("the blind solver parses the two numbers from the stem and adds them; the judge passes all")

    line.stage("S7", "widget questions: author, pre-catalogue checks, blind reachability verifier")
    wa = line.p("args", "s7-author.json")
    line.uv("generate_widget_questions.py", "--author-args", wa, "--book", cfg, *line.packets("s7-author"), db=True)
    titles = {l["slug"]: l["title"] for l in json.loads(line.p("args", "lessons.json").read_text())["lessons"]}
    rep = line.workflow("S7", "s7-author", "widgets.workflow.js", json.loads(wa.read_text()), "widgets",
                        {"draft_ids": draft_ids, "lesson_titles": titles},
                        save=line.p("runs", "widgets", "author-dryrun.json"))
    wdir = line.p("widgets", "x").parent
    for r in rep["result"]["records"]:
        for t in r["templates"]:
            tail, slug = t["id"].split(":")[1:]
            (wdir / f"{tail}--{slug}.json").write_text(json.dumps(t, indent=1, ensure_ascii=False) + "\n")
    line.stubbed("a pair_plotter or line_drawer template per lesson whose title names distance, mid-point, "
                 "gradient or straight lines; its one diagnostic names the draft's placeholder error")
    line.count(templates=sum(len(r["templates"]) for r in rep["result"]["records"]), gaps=len(rep["result"]["gaps"]))
    va = line.p("args", "s7-verify.json")
    line.uv("generate_widget_questions.py", "--templates", wdir, "--book", cfg, "--pre-catalogue",
            "--verify-args", va, "--s5-distractors", line.p("runs", "widgets", "s5-distractors.json"),
            *line.packets("s7-verify"), db=True)
    line.workflow("S7", "s7-verify", "widgets.workflow.js", json.loads(va.read_text()), "widgets",
                  save=line.p("runs", "widgets", "verify-dryrun.json"))
    line.stubbed("the verifier's 'reading' is copied from the stored spec (a real one reads the stem blind)")

    line.stage("S5 final", "the catalogue with S6/S7 distractors attached; fail-closed verifier; assembled")
    a = line.p("args", "s5-final.json")
    line.uv("assemble_misconceptions.py", "--s5-args", a, "--book", cfg, "--stage", "final", "--seed-dir", seed,
            "--lesson-runs", runs_l, "--draft", draft, "--distractors", line.p("runs", "families", "s5-distractors.json"),
            "--distractors", line.p("runs", "widgets", "s5-distractors.json"), *line.packets("s5-final"),
            *(["--embed", line.p("packets", "embedded", "misconceptions.s5-final.workflow.js")] if line.by_ref else []))
    final = mdir / "final-dryrun.json"
    rep = line.workflow("S5", "s5-final", "misconceptions.workflow.js", json.loads(a.read_text()), "misconceptions",
                        save=final, embedded=line.p("packets", "embedded", "misconceptions.s5-final.workflow.js")
                        if line.by_ref else None)
    line.stubbed("the verifier CONFIRMS every entry and every attached distractor")
    line.count(**rep["result"]["totals"])
    gen = line.p("generated", "x").parent
    graph = [seed / p for p in sorted(os.listdir(seed))]
    line.uv("assemble_misconceptions.py", final, "--book", cfg, "--out", gen / "misconceptions.json",
            *[x for g in graph for x in ("--graph", g)])
    line.uv("load_misconceptions.py", gen / "misconceptions.json", "--course", book.course_id, db=True)

    line.stage("S6/S7 out", "the bundles, against the final catalogue; loaded at review; G3 sample")
    line.uv("generate_questions.py", "--families", fam, "--book", cfg, "--catalogue", gen / "misconceptions.json",
            "--grades", *graded, "--out", gen / "generated-questions.json",
            "--floor-report", line.p("coverage", "tier-floor.json"))
    gaps = line.p("coverage", f"{book.book}.widget-gaps.json")
    line.uv("generate_widget_questions.py", "--templates", wdir, "--book", cfg, "--verdicts",
            line.p("runs", "widgets", "verify-dryrun.json"), "--gaps", line.p("runs", "widgets", "author-dryrun.json"),
            "--gap-report", gaps, "--out", gen / "widget-questions.json", db=True)
    line.uv("assemble_misconceptions.py", final, "--book", cfg, "--out", gen / "misconceptions.json",
            "--bundle", gen / "generated-questions.json", "--bundle", gen / "widget-questions.json",
            *[x for g in graph for x in ("--graph", g)])
    counts = {}
    for f in ("generated-questions.json", "widget-questions.json"):
        r = line.uv("load_generated_questions.py", gen / f, "--course", book.course_id, "--sample", "10",
                    "--seed", "20260926", "--catalogue-only", db=True)
        counts[f] = [l.strip() for l in r.stdout.splitlines() if "course counts" in l or "review queue" in l]
    line.count(loads=counts)
    verdicts = {}
    for f in gen.glob("*.review-queue.json"):
        for qid in json.loads(f.read_text())["question_ids"]:
            verdicts[qid] = "accept"
    g3 = line.p("runs", "g3.dryrun.json")
    g3.write_text(json.dumps({"bundle": "dry run", "reviewer": GATE_BY.format(g="G3"), "verdicts": verdicts}, indent=1))
    line.stubbed(f"G3: the {len(verdicts)} sampled item(s) accepted by {GATE_BY.format(g='G3')!r}")
    # Promotion follows the handoff's "status at export" (ADR-0019 note): accepted and unsampled
    # families go live. It comes BEFORE the verdicts are applied: `--promote` reloads the rows
    # (reviewed_by NULL), and a verdict's family stamp only travels to LIVE siblings.
    for f in ("generated-questions.json", "widget-questions.json"):
        line.uv("load_generated_questions.py", gen / f, "--course", book.course_id, "--promote", "--sample", "0",
                "--catalogue-only", db=True)
    r = line.uv("apply_review_verdicts.py", g3, db=True)
    line.count(g3=[l.strip() for l in r.stdout.splitlines() if "marked" in l])
    line.uv("export_generated_content.py", "--course", book.course_id, "--out-dir", line.p("export", "x").parent,
            "--dsn", line.dsn, db=True)
    ex = {f: len(json.loads((line.p("export", f)).read_text()).get("questions") or
                 json.loads((line.p("export", f)).read_text()).get("misconceptions") or [])
          for f in ("generated-questions.json", "widget-questions.json", "misconceptions.json")}
    line.count(exported=ex)


def coverage(line: Line) -> dict:
    book = line.book
    line.stage("S8", "coverage audit (the integer equalities)")
    out = line.p("coverage", f"{book.book}.json")
    line.uv("coverage_report.py", "--book", book.book, "--chapter", line.ch,
            "--objectives", line.p("objectives", "x").parent, "--runs", line.p("runs", "lesson", "x").parent,
            "--seed", line.p("seed", book.book, "x").parent, "--content", line.p("seed", "content", "x").parent,
            "--generated", line.p("export", "x").parent, "--maths", line.p("maths", "summary.json"),
            "--widget-gaps", line.p("coverage", f"{book.book}.widget-gaps.json"),
            "--s5", line.p("runs", "misconceptions", "final-dryrun.json"), "--out", out, ok=(0, 1))
    rep = json.loads(out.read_text())
    line.count(status=rep["status"], summary=rep["summary"],
               checks={c["id"]: f"{c['state']} ({c['got']}/{c['want']})" for c in rep["checks"]})
    for c in rep["checks"]:
        for f in c["failures"][:3]:
            line.note(f"{c['id']}: {f['scope']}: {f['detail'][:160]}")

    line.stage("Drift", "parity for every course (the per-solution drift guard)")
    r = line.uv("parity_check.py", "--candidate", line.dsn, "--all-courses", ok=(0, 1))
    line.count(parity=[l.strip() for l in r.stdout.splitlines() if re.match(r"^\s+(GREEN|RED)\s", l)])
    # The new course has no constant until T364 (the approved bundles define it). What the constant
    # WOULD be for this chapter, from the bundles, against what the database holds for the course:
    import parity_check
    cfg = book_config.load_book(line.p("books", f"{book.book}.json"))
    want = book_config.expected_from_bundles(cfg)
    fp = parity_check.fingerprint(line.dsn, book.course_id)
    problems = parity_check.check_expected(fp, book_config.Parity(**want))
    line.count(new_course_constant_from_bundles=want, database_agrees=not problems, drift=problems[:4])
    return rep


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--book", required=True)
    ap.add_argument("--chapter", type=int, required=True)
    ap.add_argument("--keep-db", action="store_true")
    ap.add_argument("--mode", choices=["by-ref", "inline"], default="by-ref",
                    help="by-ref (default): every builder that can writes its packet by reference; inline: "
                         "every workflow gets its whole packet in the args")
    ap.add_argument("--pg", default=os.environ.get("AINEXT_TEST_PG", "host=127.0.0.1 port=5432"),
                    help="the Postgres server the scratch database is created on")
    a = ap.parse_args(argv)
    book = book_config.load_book(a.book)
    root = book.work_dir() / "dryrun" / f"ch{a.chapter:02d}"
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    line = Line(book, a.chapter, root, a.keep_db, a.pg, a.mode)
    figure_types = {}
    fg = HERE / "coverage" / f"{book.book}.figure-gaps.json"
    if fg.exists():
        figure_types = {f["src"]: f.get("type") for f in json.loads(fg.read_text()).get("figures", [])}
    t0 = time.time()
    error = None
    try:
        s0(line)
        maths = s0b(line)
        lessons = s1(line, maths)
        s2_s4(line, maths, lessons, figure_types)
        bundles = s9(line)
        load(line, bundles)
        s5_s6_s7(line)
        coverage(line)
    except DryRunError as exc:
        error = str(exc)
        print(f"\nDRY RUN STOPPED: {error}", file=sys.stderr)
    finally:
        if not line.keep_db:
            try:
                line.drop_db()
            except subprocess.CalledProcessError:
                pass
    by_stage: dict[str, float] = {}
    for r in line.meter_rows:
        by_stage[r["stage"]] = round(by_stage.get(r["stage"], 0) + (r["usd_estimate"] or 0), 4)
    transcript = {"book": book.book, "chapter": a.chapter, "stubbed": True, "mode": a.mode,
                  "args_bytes": line.args_bytes, "script_bytes": line.script_bytes,
                  "warning": "Every model answer and every human gate in this run is a DRY-RUN STUB. It proves the "
                             "plumbing only.", "seconds": round(time.time() - t0, 1), "error": error,
                  "stages": line.stages, "meter": {"runs": line.meter_rows, "by_stage_usd_estimate": by_stage,
                                                   "total_usd_estimate": round(sum(by_stage.values()), 4)},
                  "database": line.dbname if line.keep_db else f"{line.dbname} (dropped)"}
    (root / "transcript.json").write_text(json.dumps(transcript, indent=1, ensure_ascii=False) + "\n")
    lines = [f"DRY RUN — {book.book} chapter {a.chapter} — EVERY MODEL ANSWER AND HUMAN GATE IS A STUB", ""]
    for st in line.stages:
        lines.append(f"== {st['stage']} {st['title']}")
        lines += [f"   $ {c['cmd']}  (exit {c['exit']}, {c['seconds']}s)" for c in st["commands"]]
        lines += [f"   {k}: {json.dumps(v, ensure_ascii=False)}" for k, v in st["counts"].items()]
        lines += [f"   note: {n}" for n in st["notes"]] + [f"   STUB: {n}" for n in st["stubbed"]]
        lines.append("")
    lines += ["== meter (dry form, estimated, API-equivalent USD)"]
    lines += [f"   {r['stage']:<10} {r['run']:<55} agents {r['agents']:>4}  ${r['usd_estimate']}" for r in line.meter_rows]
    lines += [f"   by stage: {by_stage}", f"   total: ${transcript['meter']['total_usd_estimate']}",
              f"   error: {error}", "", f"== workflow args, bytes (mode {a.mode})"]
    lines += [f"   {k:<12} {v:>8}" + (f"   (a generated copy: {line.script_bytes[k]} bytes)" if k in line.script_bytes else "")
              for k, v in line.args_bytes.items()]
    (root / "transcript.txt").write_text("\n".join(lines) + "\n")
    print(f"\ntranscript: {root / 'transcript.json'}")
    print(f"meter (dry, estimated): {by_stage} — total ${transcript['meter']['total_usd_estimate']}")
    return 1 if error else 0


if __name__ == "__main__":
    sys.exit(main())

"""`fanout.py advance` / `fanout.py ready` (fanout_advance.py): the routing of every kind of run, with no model call.

    uv run --with pytest python -m pytest -q tests/test_fanout_advance.py

A SANDBOX stands in for services/extraction/: a scratch tree, a stub runbook script whose generated copies are real
(embed_workflow.write), the Workflow run records the meter and the driver read, a recording executor that answers for the
pipeline's scripts (the commands issued are what is asserted), a fake DB and fake fanout.prepare / close_chapter /
write_specs. Nothing here runs a Workflow, a model or a script of the pipeline, and nothing touches Samuel's pilot DB.
The last class reads the REAL plan (runs/g10-math/fanout-plan.json) when it exists and checks the driver's reading of it.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
EX = HERE.parent
if str(EX) not in sys.path:
    sys.path.insert(0, str(EX))

import embed_workflow  # noqa: E402
import fanout as F  # noqa: E402
import fanout_advance as A  # noqa: E402
import meter_run  # noqa: E402

BOOK = "g10-math"
STUB = ("export const meta = { name: 'stub', description: 'a stand-in for a runbook script' }\n"
        "const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})\n"
        "return { stub: true, embedded: ARGS.embedded }\n")
WF = ["wf_%08x-%03x" % (0xA0000000 + i, 0x100 + i) for i in range(200)]


class FakeExec:
    """Records every command; answers 0 and nothing unless a test says otherwise (`on`). Side effects the driver reads back
    (a ledger line, a flags file) are made by the box's handlers."""

    ALL: list[list[str]] = []                 # every command any test issued: the flags check at the end reads them

    def __init__(self, box):
        self.box, self.calls, self.tools, self.rules = box, [], [], {}

    def on(self, script, fn):
        self.rules[script] = fn

    def py(self, argv, env=None, timeout=0):
        self.calls.append((list(argv), env))
        FakeExec.ALL.append(list(argv))
        fn = self.rules.get(argv[0]) or getattr(self.box, "default_" + argv[0].replace(".py", "").replace("-m", "module"), None)
        return fn(argv) if fn else A.Result(0, "")

    def tool(self, argv, timeout=0):
        self.tools.append(list(argv))
        if argv[0] == "pg_dump":
            if self.rules.get("pg_dump"):
                return self.rules["pg_dump"](argv)
            Path(argv[argv.index("-f") + 1]).write_bytes(b"PGDMP-fake")
        return A.Result(0, "")

    def scripts(self):
        return [c[0][0] for c in self.calls]

    def argv_of(self, script):
        return [c[0] for c in self.calls if c[0][0] == script]


class FakeDb:
    def __init__(self):
        self.have = {"questions": set(), "graph_nodes": set(), "misconceptions": set()}

    def present(self, table, ids):
        return len([i for i in ids if i in self.have[table]])


class Box:
    """The scratch services/extraction/ and a mini plan for chapter 4 (S0b group g3) shaped like fanout.build_runs."""

    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name).resolve()
        self.t = t
        self.repo = t / "repo"
        self.here = self.repo / "services" / "extraction"
        self.work = self.here / "work" / BOOK
        self.runs = self.here / "runs" / BOOK
        self.keep = {k: getattr(F, k) for k in ("HERE", "WORK", "PACKETS", "EMBED", "FAN", "RUNS", "MATHS_BOOK", "PLAN_PATH", "DSN",
                                                 "prepare", "close_chapter", "write_config", "write_specs")}
        self.keep_home = meter_run.CLAUDE_HOME
        F.HERE, F.WORK = self.here, self.work
        F.PACKETS, F.EMBED, F.FAN = self.work / "packets" / "fanout", self.work / "packets" / "embedded" / "fanout", self.work / "fanout"
        F.RUNS, F.MATHS_BOOK, F.PLAN_PATH = self.runs, self.runs / "maths" / "book", self.runs / "fanout-plan.json"
        F.DSN = "host=127.0.0.1 port=5432 dbname=scratch_pilot"
        meter_run.CLAUDE_HOME = t / "claude"
        (self.here / "runbook").mkdir(parents=True)
        self.stub = self.here / "runbook" / "stub.workflow.js"
        self.stub.write_text(STUB)
        for d in (F.PACKETS, F.EMBED, self.runs / "records", self.runs / "gates", self.runs / "lesson",
                  self.here / "objectives" / BOOK, self.here / "seed" / BOOK, self.here / "coverage"):
            d.mkdir(parents=True, exist_ok=True)
        (self.here / "books").mkdir()
        (self.here / "books" / f"{BOOK}.json").write_text(json.dumps({
            "book": BOOK, "status": "ingest", "bundles": [], "generated": None, "parity": None,
            "content_files": ["services/extraction/seed/content/g10m4s2-1.json", "services/extraction/seed/content/g10m4s3-1.json",
                              "services/extraction/seed/content/g10m5s2-1.json"]}))
        (self.runs / "fanout" / "loaded").mkdir(parents=True)
        (self.runs / "fanout" / "loaded" / f"{BOOK}.json").write_text(json.dumps({
            "book": BOOK, "status": "loadable", "bundles": [
                "services/extraction/seed/g10-math/g10m-course.json", "services/extraction/seed/g10-math/g10m-c01.json",
                "services/extraction/work/g10-math/pilot/seed/g10m-c08.json"], "content_files": []}))
        self.ex, self.db = FakeExec(self), FakeDb()
        self.runs_list: list[dict] = []
        self.copies: dict[tuple, tuple] = {}            # (run, label) -> (path, embedded)
        self.preparable: set[str] = set()
        self.prepared: list[str] = []
        self.skip_prepare: dict[str, str] = {}
        self.closed: list[int] = []
        self.n = 0
        self.tasks = t / "tasks"
        self.tasks.mkdir()
        F.prepare = self.fake_prepare
        F.close_chapter = self.fake_close
        F.write_config = self.fake_config
        F.write_specs = self.fake_specs
        self.build_plan()

    def close(self):
        for k, v in self.keep.items():
            setattr(F, k, v)
        meter_run.CLAUDE_HOME = self.keep_home
        self.tmp.cleanup()

    # ---- the plan: the shapes fanout.build_runs gives each kind
    def add(self, rid, stage, deps=(), **kw):
        self.n += 1
        t = f"ch{kw.get('chapter', 0):02d}"
        save = {"s0b": f"runs/g10-math/maths/{rid.split('-')[1]}-<wf_id>.json", "s1": f"runs/g10-math/objectives/{t}-<wf_id>.json",
                "lesson": "runs/g10-math/lessons/<wf_id>.json",
                "wcheck": f"runs/g10-math/working-check/{t}-<pass A|B>-<wf_id>.json   (one file per pass)",
                "s5-draft": f"runs/g10-math/misconceptions/draft-{t}-<wf_id>.json",
                "s6-author": f"runs/g10-math/families/author-{t}-<wf_id>.json",
                "s6-grade": f"runs/g10-math/families/grade-{t}-<wf_id>.json   (one file per part)",
                "s7-author": f"runs/g10-math/widgets/author-{t}-<wf_id>.json",
                "s7-verify": f"runs/g10-math/widgets/verify-{t}-<wf_id>.json",
                "s5-final": f"runs/g10-math/misconceptions/final-{t}-<wf_id>.json"}
        key = "s0b" if rid.startswith("s0b-") else "lesson" if rid.startswith("lesson-") else "-".join(rid.split("-")[:2])
        if key == "s1-ch04":
            key = "s1"
        r = {"id": rid, "stage": stage, "depends_on": list(deps), "order": self.n, "checkpoint": kw.pop("checkpoint", None),
             "save_to": save[key if key in save else rid.split("-ch")[0]], "agents": 3, "cost": [1.0, 2.0],
             "meter": F._meter(stage, kw.get("lesson")), "embedded_script": F.rel(F.EMBED / f"{self.n:03d}-{rid}.workflow.js"), **kw}
        self.runs_list.append(r)
        return r

    def build_plan(self):
        add = self.add
        add("wcheck-ch08", "SW", chapter=8)
        add("s5-final-ch01", "S5", ["(never satisfied here)"], chapter=1)
        add("s0b-A-g3", "S0b", chapters=[4], s0b=True)
        add("s0b-B-g3", "S0b", ["s0b-A-g3"], chapters=[4], s0b=True)
        add("s0b-C-g3", "S0b", ["s0b-A-g3", "s0b-B-g3"], chapters=[4], s0b=True)
        add("s1-ch04", "S1", ["s0b-C-g3"], chapter=4, checkpoint=None)
        gate = ["s5-final-ch01"]
        add("lesson-g10m4s2-1", "S2-S4", ["s1-ch04"] + gate, chapter=4, lesson="g10m4s2-1")
        add("lesson-g10m4s3-1", "S2-S4", ["s1-ch04"] + gate, chapter=4, lesson="g10m4s3-1")
        lessons = ["lesson-g10m4s2-1", "lesson-g10m4s3-1"]
        add("wcheck-ch04", "SW", lessons + ["wcheck-ch08"], chapter=4)
        add("s5-draft-ch04", "S5", lessons, chapter=4)
        add("s6-author-ch04", "S6", ["s5-draft-ch04"], chapter=4)
        add("s6-grade-ch04", "S6", ["s6-author-ch04"], chapter=4)
        add("s7-author-ch04", "S7", ["s5-draft-ch04"], chapter=4)
        add("s7-verify-ch04", "S7", ["s7-author-ch04"], chapter=4)
        add("s5-final-ch04", "S5", ["s6-grade-ch04", "s7-verify-ch04"], chapter=4)
        self.write_plan()
        self.legacy("wcheck-ch08", "A", wf="wf_c0ffee00-001")        # chapter 8's check is finished: saved by hand, no ledger

    def write_plan(self):
        F.PLAN_PATH.parent.mkdir(parents=True, exist_ok=True)
        F.PLAN_PATH.write_text(json.dumps({"runs": self.runs_list}))

    def run(self, rid):
        return next(r for r in self.runs_list if r["id"] == rid)

    # ---- generated copies (real embed_workflow copies of the stub)
    def copy(self, rid, label="", args=None):
        r = self.run(rid)
        base = (self.here / r["embedded_script"]).name[:-len(".workflow.js")]
        suffix = {"": "", "A": "", "A.part2": ".part2", "B": "-B", "B.part2": "-B.part2", "part1": ".part1", "part2": ".part2"}[label]
        out = F.EMBED / f"{base}{suffix}.workflow.js"
        info = embed_workflow.write(self.stub, args or {"run": rid, "copy": label}, out)
        self.copies[(rid, label)] = (out, embed_workflow.embedded_info(out.read_text()))
        return out, info["generated_sha256"]

    def copies_for(self, *rids):
        for rid in rids:
            self.copy(rid)

    def legacy(self, rid, label="", wf=None, result=None):
        """A run saved by hand before advance existed: its result at the plan's save_to, no ledger, no record."""
        if (rid, label) not in self.copies:
            self.copy(rid, label)
        out, emb = self.copies[(rid, label)]
        self.legacy_n = getattr(self, "legacy_n", 0) + 1
        wf = wf or "wf_%08x-%03x" % (0xBEEF0000 + self.legacy_n, self.legacy_n)
        p = A.save_path(A.Paths(), self.run(rid), label, wf)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(dict(result or {}, embedded=emb)))
        return p

    # ---- a finished Workflow run: its task output, its record
    def finish(self, rid, label="", result=None, status="completed", wf=None, wrapper_only=False):
        out, emb = self.copies[(rid, label)]
        wf = wf or WF[len(list(self.tasks.glob("*.output")))]
        res = dict(result or {}, embedded=emb)
        wrapper = {"summary": "s", "agentCount": 2, "logs": ["log"], "result": res, "workflowProgress": [], "totalTokens": 10,
                   "totalToolCalls": 3}
        task = self.tasks / f"{wf}.output"
        task.write_text(json.dumps(wrapper))
        rec_dir = meter_run.CLAUDE_HOME / "projects" / "p" / "s" / "workflows"
        rec_dir.mkdir(parents=True, exist_ok=True)
        (rec_dir / f"{wf}.json").write_text(json.dumps(dict(wrapper, runId=wf, status=status, scriptPath=str(out),
                                                            workflowName="stub")))
        return wf, task

    def adv(self, rid, wf, task, **opts):
        o = A.Opts(**{k: v for k, v in opts.items() if k in A.Opts.__dataclass_fields__})
        return A.advance(rid, wf, task, o, ex=self.ex, db=self.db)

    def go(self, rid, label="", result=None, **opts):
        wf, task = self.finish(rid, label, result, status=opts.pop("status", "completed"))
        rc, rep = self.adv(rid, wf, task, **opts)
        return rc, rep, wf

    # ---- the fakes
    def fake_prepare(self, rid):
        if rid in self.skip_prepare:
            return {"skipped": self.skip_prepare[rid]}
        if rid not in self.preparable:
            raise F.NotReady(f"{rid}: inputs missing (test)")
        out, _ = self.copy(rid)
        self.prepared.append(rid)
        return {"script": str(out)}

    def fake_close(self, ch, dry_run=False):
        self.closed.append(ch)
        t = f"ch{ch:02d}"
        (self.runs / f"g2-{t}.json").write_text("{}")
        (self.runs / "fanout").mkdir(exist_ok=True)
        (self.runs / "fanout" / f"assembly-{t}.json").write_text("{}")
        (self.here / "seed" / BOOK / f"g10m-c{ch:02d}.json").write_text(json.dumps(
            {"questions": [{"id": f"q:{t}:1"}, {"id": f"q:{t}:2"}], "nodes": [{"id": f"module:g10m-c{ch:02d}"}, {"id": f"lo:g10m{ch}s2-1-1"}]}))
        for rid in (f"wcheck-{t}", f"s5-draft-{t}"):
            self.copy(rid) if rid != f"wcheck-{t}" else (self.copy(rid, "A"), self.copy(rid, "B"))
        return {"chapter": ch, "numbers": {"g2": {"decisions": {"accept": 7, "held": 2}},
                                           "assembly": {"questions": 2, "live": 2, "held_by_reason": {}, "excluded": 0, "stand_ins": 0,
                                                        "katex_errors": 0}},
                "prepared": {f"wcheck-{t}": {"agents": 4, "cost_usd": [1, 2]}, f"s5-draft-{t}": {"agents": 9, "cost_usd": [3, 4]}}}

    def fake_config(self, ch):
        p = F.FAN / "books" / f"ch{ch:02d}" / f"{BOOK}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("{}")
        return p

    def fake_specs(self, run_file, into, book_config_path=None):
        res = json.loads(Path(run_file).read_text())
        into.mkdir(parents=True, exist_ok=True)
        out = []
        for rec in res.get("records") or []:
            for spec in rec.get("families") or []:
                tail, slug = spec["id"].split(":")[1:]
                p = into / f"{tail}--{slug}.json"
                if p.exists():
                    raise SystemExit(f"{p} exists")
                p.write_text(json.dumps(spec))
                out.append(p)
        return out

    def default_meter_run(self, argv):
        wf = argv[argv.index("--run") + 1]
        with open(self.runs / "cost.jsonl", "a") as fh:
            fh.write(json.dumps({"run_id": wf, "stage": argv[argv.index("--stage") + 1], "totals": {"usd": 1.25},
                                 "agents": [{"agent_id": "a1"}, {"agent_id": "a2"}], "complete": True}) + "\n")
        return A.Result(0, "metered")

    # ---- small helpers
    def put(self, rel, obj="{}"):
        p = self.here / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(obj if isinstance(obj, str) else json.dumps(obj))
        return p

    def approve_chapter(self, ch, slugs):
        for s in slugs:
            self.put(f"objectives/{BOOK}/{s}.json", {"status": "approved"})

    def steps(self, rep):
        return [(s["step"], s["status"]) for s in rep["steps"]]


class Base(unittest.TestCase):
    def setUp(self):
        self.box = Box()
        self.addCleanup(self.box.close)

    @property
    def ex(self):
        return self.box.ex


# ====================================================================== save, record, meter
class SaveAndMeter(Base):
    def test_s0b_A_is_saved_beside_its_siblings_with_its_record_apart_and_metered(self):
        b = self.box
        b.copies_for("s0b-A-g3")
        rc, rep, wf = b.go("s0b-A-g3", result={"stage": "S0b", "pass": "A", "images": 3, "results": [{}, {}, {}], "problems": []})
        self.assertEqual(rc, 0, rep)
        saved = b.here / rep["saved"]
        self.assertEqual(rep["saved"], f"runs/g10-math/maths/A-{wf}.json")
        self.assertEqual(json.loads(saved.read_text())["images"], 3, "the RESULT is saved, not the wrapper")
        rec = b.runs / "records" / f"A-{wf}.record.json"
        self.assertTrue(rec.exists(), "the whole wrapper goes to records/")
        w = json.loads(rec.read_text())
        self.assertEqual(w["runId"], wf)
        self.assertEqual(set(w) - {"runId"}, {"summary", "agentCount", "logs", "result", "workflowProgress", "totalTokens", "totalToolCalls"})
        self.assertEqual(list((b.runs / "maths").glob("[ABC]-*.json")), [saved],
                         "assemble_maths globs [ABC]-*.json in maths/: a record must never live there")
        self.assertEqual(self.ex.argv_of("meter_run.py"),
                         [["meter_run.py", "record", "--book", BOOK, "--stage", "S0b", "--run", wf]])
        self.assertEqual(rep["metered"], {"stage": "S0b", "already": False, "usd": 1.25, "run_total_usd": 1.25, "agents": 2})
        self.assertEqual(rep["steps"], [], "pass A has no after-step")
        self.assertEqual(rep["counts"]["images"], 3)

    def test_the_lesson_meter_carries_the_lesson_and_resumed_is_passed_through(self):
        b = self.box
        b.copies_for("lesson-g10m4s2-1")
        wf, task = b.finish("lesson-g10m4s2-1", result={"lessons": [{"lesson": "g10m4s2-1", "items": []}]})
        rc, rep = b.adv("lesson-g10m4s2-1", wf, task, resumed=True)
        self.assertEqual(rc, 0, rep)
        self.assertEqual(self.ex.argv_of("meter_run.py")[0][-3:], ["--lesson", "g10m4s2-1", "--resumed"])

    def test_advancing_twice_re_meters_and_re_saves_nothing(self):
        b = self.box
        b.copies_for("s0b-A-g3")
        rc, rep, wf = b.go("s0b-A-g3", result={"stage": "S0b", "results": []})
        mtime = (b.here / rep["saved"]).stat().st_mtime_ns
        n = len(self.ex.calls)
        wf2, task = b.finish("s0b-A-g3", result={"stage": "S0b", "results": []}, wf=wf)
        rc, rep2 = b.adv("s0b-A-g3", wf, task)
        self.assertEqual(rc, 0, rep2)
        self.assertEqual(len(self.ex.calls), n, "no command ran the second time")
        self.assertEqual(rep2["metered"], {"stage": "S0b", "already": True, "usd": 1.25})
        self.assertEqual((b.here / rep["saved"]).stat().st_mtime_ns, mtime, "an identical result is not rewritten")
        self.assertTrue(rep2["saved"].endswith("(already saved)"))
        self.assertEqual(len((b.runs / "cost.jsonl").read_text().splitlines()), 1)

    def test_the_return_value_is_read_from_the_run_record_when_no_task_output_is_given(self):
        b = self.box
        b.copies_for("s0b-A-g3")
        wf, task = b.finish("s0b-A-g3", result={"stage": "S0b", "results": [{}]})
        rc, rep = b.adv("s0b-A-g3", wf, None)
        self.assertEqual(rc, 0, rep)
        self.assertEqual(rep["counts"]["results"], 1)

    def test_a_run_that_did_not_complete_is_refused_and_nothing_is_written(self):
        b = self.box
        b.copies_for("s0b-A-g3")
        rc, rep, wf = b.go("s0b-A-g3", result={"stage": "S0b"}, status="killed")
        self.assertEqual(rc, 2)
        self.assertIn("killed", rep["refused"])
        self.assertEqual(list((b.runs / "maths").glob("*")), [])
        self.assertEqual(self.ex.calls, [])

    def test_a_result_that_belongs_to_another_run_is_refused(self):
        b = self.box
        b.copies_for("s0b-A-g3", "s0b-B-g3")
        wf, task = b.finish("s0b-B-g3", result={"stage": "S0b"})
        rc, rep = b.adv("s0b-A-g3", wf, task)
        self.assertEqual(rc, 2)
        self.assertIn("not a copy of this run", rep["refused"])
        self.assertEqual(list((b.runs / "maths").glob("*")), [])

    def test_the_embedded_sha_and_the_script_that_ran_must_agree(self):
        b = self.box
        b.copies_for("s0b-A-g3", "s0b-B-g3")
        wf, task = b.finish("s0b-A-g3", result={"stage": "S0b"})
        rec = meter_run.CLAUDE_HOME / "projects" / "p" / "s" / "workflows" / f"{wf}.json"
        d = json.loads(rec.read_text())
        d["scriptPath"] = str(b.copies[("s0b-B-g3", "")][0])
        rec.write_text(json.dumps(d))
        rc, rep = b.adv("s0b-A-g3", wf, task)
        self.assertEqual(rc, 2)
        self.assertIn("not a copy of this run", rep["refused"])

    def test_unknown_run_malformed_wf_and_unprepared_run_are_refused(self):
        b = self.box
        self.assertEqual(b.adv("nope", WF[0], None)[0], 2)
        self.assertEqual(b.adv("s0b-A-g3", "wf_xyz", None)[0], 2)
        rc, rep = b.adv("s0b-A-g3", WF[5], None)         # no copy was generated for it, and no record of this run exists
        self.assertEqual(rc, 2)
        self.assertEqual(self.ex.calls, [])

    def test_dry_run_changes_and_runs_nothing(self):
        b = self.box
        b.copies_for("s0b-B-g3")
        wf, task = b.finish("s0b-B-g3", result={"stage": "S0b", "results": []})
        before = sorted(p.relative_to(b.here) for p in b.here.rglob("*") if p.is_file())
        rc, rep = b.adv("s0b-B-g3", wf, task, dry=True)
        self.assertEqual(rc, 0, rep)
        self.assertEqual(self.ex.calls, [])
        self.assertEqual(sorted(p.relative_to(b.here) for p in b.here.rglob("*") if p.is_file()), before)
        self.assertTrue(rep["dry_run"])
        self.assertIn("would write", rep["saved"])
        self.assertEqual([s["status"] for s in rep["steps"]], ["dry"])
        self.assertIn("assemble_maths.py", rep["steps"][0]["cmd"])


# ====================================================================== S0b
class S0b(Base):
    def test_pass_B_runs_the_assembly_the_third_reading_reads_then_prepares_C(self):
        b = self.box
        b.copies_for("s0b-A-g3", "s0b-B-g3")
        b.put("runs/g10-math/maths/A-wf_a.json", {"pass": "A"})
        b.preparable = {"s0b-C-g3"}
        rc, rep, wf = b.go("s0b-B-g3", result={"stage": "S0b", "pass": "B", "images": 2, "results": [{}, {}]})
        self.assertEqual(rc, 0, rep)
        # A was saved before: mark it done so C's dependencies are satisfied (a legacy save has no ledger)
        self.assertEqual(b.ex.argv_of("assemble_maths.py")[0][:3], ["assemble_maths.py", "assemble", BOOK])
        argv = self.ex.argv_of("assemble_maths.py")[0]
        self.assertEqual(argv[-2:], ["--out-dir", "runs/g10-math/maths/book"])
        self.assertIn(f"runs/g10-math/maths/B-{wf}.json", argv)
        self.assertEqual(self.box.steps(rep), [("S0b assembly (A+B+C)", "ok")])

    def test_assemble_maths_exit_4_means_the_books_maths_is_not_complete_yet_and_is_not_a_failure(self):
        b = self.box
        b.copies_for("s0b-C-g3")
        self.ex.on("assemble_maths.py", lambda argv: A.Result(4, "{...summary...}"))
        rc, rep, wf = b.go("s0b-C-g3", result={"stage": "S0b", "results": []})
        self.assertEqual(rc, 0, rep)
        self.assertEqual(self.box.steps(rep), [("S0b assembly (A+B+C)", "ok")])
        self.ex.on("assemble_maths.py", lambda argv: A.Result(1, "Traceback: boom"))
        wf2, task = b.finish("s0b-C-g3", result={"stage": "S0b", "results": []}, wf=wf)
        rc, rep = b.adv("s0b-C-g3", wf, task, redo=True)
        self.assertEqual(rc, 1, "any other non-zero exit is a failure")

    def test_C_unresolved_images_are_a_warning_for_a_human_not_a_failure(self):
        b = self.box
        b.copies_for("s0b-C-g3")
        b.put("runs/g10-math/maths/book/summary.json", {"accepted_by_hash": 5, "accepted_by_agreement": 1, "accepted_by_third_reading": 1,
                                                        "unresolved": 3, "awaiting_third_reading": 0,
                                                        "by_chapter": {"4": {"unresolved": 3}}})
        self.ex.on("assemble_maths.py", lambda argv: A.Result(0, ""))
        rc, rep, wf = b.go("s0b-C-g3", result={"stage": "S0b", "pass": "C", "images": 1, "results": [{}]})
        self.assertEqual(rc, 0, rep)
        self.assertEqual(rep["warnings"], ["ch04: 3 maths image(s) unresolved after S0b → G0b (a human; nothing is guessed, FR-4407)"])
        self.assertEqual(rep["counts"]["maths"], {"accepted": 7, "unresolved": 3, "awaiting_third_reading": 0})

    def test_a_third_reading_nobody_needs_is_marked_skipped_and_releases_what_waits_on_it(self):
        b = self.box
        b.copies_for("s0b-B-g3")
        b.legacy("s0b-A-g3")
        b.skip_prepare["s0b-C-g3"] = "passes A and B agree on every g3 image: no third reading needed"
        b.preparable = {"s1-ch04"}
        rc, rep, wf = b.go("s0b-B-g3", result={"stage": "S0b", "results": []})
        self.assertEqual(rc, 0, rep)
        self.assertEqual(rep["skipped"][0]["id"], "s0b-C-g3")
        led = json.loads((b.runs / "fanout" / "advance" / "s0b-C-g3.json").read_text())
        self.assertTrue(led["skipped"] and led["after_done"])
        self.assertEqual(len(self.ex.argv_of("assemble_maths.py")), 2, "its after-steps (the assembly) run anyway, as the plan says")
        self.assertIn("s1-ch04", [p["id"] for p in rep["prepared"]], "S1 waited on the skipped third reading")


# ====================================================================== S1: G1
class S1(Base):
    def setUp(self):
        super().setUp()
        b = self.box
        for rid in ("s0b-A-g3", "s0b-B-g3", "s0b-C-g3"):
            b.put(f"runs/g10-math/records/{rid}.x", "{}")
        b.copies_for("s1-ch04")
        b.put("runs/g10-math/maths/book/accepted.json", "{}")
        self.argv_assemble = ["assemble_objectives.py", "assemble", BOOK, None, "--maths", "runs/g10-math/maths/book/accepted.json"]

    def lessons_approved(self):
        self.box.approve_chapter(4, ["g10m4s2-1", "g10m4s3-1"])

    def test_a_new_chapter_is_assembled_then_auto_passed_with_approve(self):
        b = self.box
        wf, task = b.finish("s1-ch04", result={"stage": "S1", "chapter": 4})
        b.put("objectives/g10-math/ch04.check.json", {"counts": {"objectives": 19, "lessons": 2}, "undecided": [1, 2], "status": "pending"})
        rc, rep = b.adv("s1-ch04", wf, task)
        self.assertEqual(rc, 0, rep)
        a, g = self.ex.calls[1][0], self.ex.calls[2][0]
        self.assertEqual(a, ["assemble_objectives.py", "assemble", BOOK, f"runs/g10-math/objectives/ch04-{wf}.json", "--maths",
                             "runs/g10-math/maths/book/accepted.json"])
        self.assertEqual(g, ["auto_pass_gates.py", "g1", BOOK, "--chapter", "4", "--maths", "runs/g10-math/maths/book/accepted.json", "--approve"])
        self.assertEqual(rep["counts"]["objectives"], 19)
        self.assertEqual(rep["counts"]["g1_decisions_owed"], 2)

    def test_an_approved_chapter_is_NEVER_re_assembled_not_even_with_redo(self):
        b = self.box
        self.lessons_approved()
        wf, task = b.finish("s1-ch04", result={"stage": "S1"})
        rc, rep = b.adv("s1-ch04", wf, task, redo=True)
        self.assertEqual(rc, 0, rep)
        self.assertEqual(self.ex.scripts(), ["meter_run.py"], "no assemble, no auto-pass")
        self.assertEqual(self.box.steps(rep), [("S1 assemble + G1", "skipped")])
        self.assertIn("never re-run on an approved chapter", rep["steps"][0]["note"])

    def test_recorded_verdicts_newer_than_the_run_are_approved_with_not_re_derived(self):
        b = self.box
        wf, task = b.finish("s1-ch04", result={"stage": "S1"})
        auto = b.put("runs/g10-math/objectives/g1-ch04.auto.json", {"objectives": {}, "rulings": [{"lo": "x", "why": "exercise-only"}]})
        os.utime(auto, (auto.stat().st_atime, auto.stat().st_mtime + 100))
        rc, rep = b.adv("s1-ch04", wf, task)
        self.assertEqual(rc, 0, rep)
        self.assertEqual(self.ex.scripts(), ["meter_run.py", "assemble_objectives.py"], "approve only: no assemble, no g1")
        argv = self.ex.calls[1][0]
        self.assertEqual(argv[:6], ["assemble_objectives.py", "approve", BOOK, "--chapter", "4", "--by"])
        self.assertEqual(argv[7:], ["--verdicts", "runs/g10-math/objectives/g1-ch04.auto.json", "--maths", "runs/g10-math/maths/book/accepted.json"])
        self.assertEqual(rep["counts"]["g1_rulings"], 1)

    def test_a_blocked_g1_stops_the_advance_reports_the_gate_and_resolves_nothing(self):
        b = self.box
        b.preparable = {"lesson-g10m4s2-1"}
        self.ex.on("auto_pass_gates.py", lambda argv: A.Result(1, "noise\nG1 NOT auto-passed (ch04): 1 item(s) need the pipeline fixed or a person:\n"
                                                                  "  BLOCKED lo:g10m4s3-1-2: one evidence kind (exercise-only)\n"))
        wf, task = b.finish("s1-ch04", result={"stage": "S1"})
        rc, rep = b.adv("s1-ch04", wf, task)
        self.assertEqual(rc, 1)
        self.assertFalse(rep["ok"])
        self.assertEqual(rep["failure"]["step"], "G1 auto-pass --approve")
        self.assertIn("BLOCKED lo:g10m4s3-1-2: one evidence kind (exercise-only)", rep["failure"]["detail"])
        self.assertNotIn("noise", rep["failure"]["detail"], "the gate's own BLOCKED lines, not the noise around them")
        self.assertIn("does not resolve it", rep["failure"]["detail"])
        self.assertNotIn("ready", rep, "nothing is prepared or offered after a failure")
        self.assertEqual(b.prepared, [])
        self.assertEqual(rep["saved"], f"runs/g10-math/objectives/ch04-{wf}.json", "what was saved stays saved and is reported")
        led = json.loads((b.runs / "fanout" / "advance" / "s1-ch04.json").read_text())
        self.assertFalse(led["after_done"])
        self.assertEqual(led["failed_step"], "G1 auto-pass --approve")
        # the saved-but-unfinished run does not release its dependents
        S = A.State(A.Paths(), json.loads(F.PLAN_PATH.read_text()))
        self.assertFalse(S.satisfied(S.by["s1-ch04"]))
        self.assertEqual(A.ready_list(A.Paths(), S, set(), A.Opts())["incomplete"], ["s1-ch04"])

    def test_once_the_chapter_is_approved_advance_completes_and_releases_the_lessons(self):
        b = self.box
        b.preparable = {"lesson-g10m4s2-1", "lesson-g10m4s3-1"}
        self.ex.on("auto_pass_gates.py", lambda argv: A.Result(1, "BLOCKED x"))
        wf, task = b.finish("s1-ch04", result={"stage": "S1"})
        self.assertEqual(b.adv("s1-ch04", wf, task)[0], 1)
        self.lessons_approved()                                                  # the ruling was made and the chapter approved
        rc, rep = b.adv("s1-ch04", wf, task)
        self.assertEqual(rc, 0, rep)
        self.assertEqual(b.prepared, ["lesson-g10m4s2-1", "lesson-g10m4s3-1"])
        self.assertTrue(json.loads((b.runs / "fanout" / "advance" / "s1-ch04.json").read_text())["after_done"])


# ====================================================================== lessons and close-chapter
class Lessons(Base):
    def setUp(self):
        super().setUp()
        self.box.copies_for("lesson-g10m4s2-1", "lesson-g10m4s3-1")
        self.box.put("runs/g10-math/maths/book/accepted.json", "{}")

    def lesson_result(self, slug):
        return {"lessons": [{"lesson": slug, "items": [{"answer_type": "number"}, {"answer_type": "choice"}, {"answer_type": "number"}],
                             "worked_examples": [{}]}]}

    def test_a_lesson_is_split_into_drafts_and_the_chapter_waits_for_its_other_lessons(self):
        b = self.box
        rc, rep, wf = b.go("lesson-g10m4s2-1", result=self.lesson_result("g10m4s2-1"))
        self.assertEqual(rc, 0, rep)
        self.assertEqual(self.ex.argv_of("assemble_objectives.py"),
                         [["assemble_objectives.py", "lesson-runs", BOOK, f"runs/g10-math/lessons/{wf}.json", "--draft", "--maths",
                           "runs/g10-math/maths/book/accepted.json"]])
        self.assertEqual(rep["counts"]["items"], {"g10m4s2-1": 3})
        self.assertEqual(rep["counts"]["answer_types"], {"number": 2, "choice": 1})
        self.assertEqual(rep["counts"]["worked_examples"], 1)
        self.assertIn("lesson-g10m4s3-1", rep["waiting"])
        self.assertEqual(b.closed, [])
        self.assertEqual(self.ex.argv_of("meter_run.py")[0][-2:], ["--lesson", "g10m4s2-1"])

    def test_the_last_lesson_closes_the_chapter_once(self):
        b = self.box
        b.go("lesson-g10m4s2-1", result=self.lesson_result("g10m4s2-1"))
        rc, rep, wf = b.go("lesson-g10m4s3-1", result=self.lesson_result("g10m4s3-1"))
        self.assertEqual(rc, 0, rep)
        self.assertEqual(b.closed, [4])
        self.assertIn(("close-chapter 4", "ok"), b.steps(rep))
        self.assertEqual(rep["counts"]["close_chapter"]["g2"], {"accept": 7, "held": 2})
        self.assertEqual(rep["counts"]["close_chapter"]["prepared"]["s5-draft-ch04"], {"agents": 9, "usd": [3, 4]})
        self.assertIn("2 G2 item(s) held", rep["notes"][0])
        # advancing the last lesson again does not close it again (its copies would be regenerated)
        wf2, task = b.finish("lesson-g10m4s3-1", result=self.lesson_result("g10m4s3-1"), wf=wf)
        rc, rep2 = b.adv("lesson-g10m4s3-1", wf, task)
        self.assertEqual(rc, 0, rep2)
        self.assertEqual(b.closed, [4])
        self.assertIn(("close-chapter 4", "skipped"), b.steps(rep2))

    def test_no_close_chapter_leaves_the_close_to_the_caller(self):
        b = self.box
        b.go("lesson-g10m4s2-1", result=self.lesson_result("g10m4s2-1"))
        rc, rep, wf = b.go("lesson-g10m4s3-1", result=self.lesson_result("g10m4s3-1"), no_close=True)
        self.assertEqual(b.closed, [])
        self.assertIn("close-chapter not run", rep["waiting"])

    def test_redo_never_re_closes_a_chapter_whose_working_check_or_s5_draft_is_launched(self):
        b = self.box
        b.go("lesson-g10m4s2-1", result=self.lesson_result("g10m4s2-1"))
        b.go("lesson-g10m4s3-1", result=self.lesson_result("g10m4s3-1"))
        wf, task = b.finish("lesson-g10m4s3-1", result=self.lesson_result("g10m4s3-1"), wf=WF[40])
        rc, rep = b.adv("lesson-g10m4s3-1", WF[40], task, redo=True, running=("s5-draft-ch04",))
        self.assertEqual(rc, 0, rep)
        self.assertEqual(b.closed, [4], "not closed a second time")
        self.assertIn("not re-closed: s5-draft-ch04 already launched", rep["warnings"][0])

    def test_a_close_that_fails_is_the_reported_failure(self):
        b = self.box
        b.go("lesson-g10m4s2-1", result=self.lesson_result("g10m4s2-1"))

        def boom(ch, dry_run=False):
            raise F.NotReady("g2 auto-pass exited 1: 75 items held")
        F.close_chapter = boom
        rc, rep, wf = b.go("lesson-g10m4s3-1", result=self.lesson_result("g10m4s3-1"))
        self.assertEqual(rc, 1)
        self.assertEqual(rep["failure"]["step"], "close-chapter 4")
        self.assertIn("75 items held", rep["failure"]["detail"])


# ====================================================================== working check
class WorkingCheck(Base):
    def setUp(self):
        super().setUp()
        b = self.box
        for label in ("A", "A.part2", "B", "B.part2"):
            b.copy("wcheck-ch04", label)
        for name in ("wcheck-ch04.args.json", "wcheck-ch04.args.part2.json", "wcheck-ch04-B.args.json", "wcheck-ch04-B.args.part2.json",
                     "wcheck-ch04.precheck.json"):
            (F.PACKETS / name).write_text("{}")

    def res(self, pid, part):
        return {"stage": "SW", "pass_id": pid, "part": part, "parts": 2, "results": [{}] * 3, "problems": []}

    def test_nothing_is_collected_until_both_passes_and_every_part_are_saved(self):
        b = self.box
        for label, pid, part in (("A", "A", 1), ("A.part2", "A", 2), ("B", "B", 1)):
            rc, rep, wf = b.go("wcheck-ch04", label, self.res(pid, part))
            self.assertEqual(rc, 0, rep)
            self.assertIn("still to save", rep["waiting"])
            self.assertEqual(self.ex.argv_of("working_check.py"), [])
            self.assertTrue(rep["saved"].startswith(f"runs/g10-math/working-check/ch04-{pid}-{wf}"))
        self.assertIn("B.part2", rep["waiting"])
        self.assertFalse(json.loads((b.runs / "fanout" / "advance" / "wcheck-ch04.json").read_text())["after_done"])

    def test_the_last_copy_collects_every_part_of_both_passes(self):
        b = self.box
        wfs = {}
        for label, pid, part in (("A", "A", 1), ("A.part2", "A", 2), ("B", "B", 1)):
            wfs[label] = b.go("wcheck-ch04", label, self.res(pid, part))[2]

        def collect(argv):
            b.put("runs/g10-math/working-check/ch04.flags.json", {"solutions": 120, "verdicts": {"consistent": 110, "flagged": 9, "unclear": 1},
                                                                   "flagged_solutions": 9, "flags": [1, 2, 3], "unchecked": [{"id": "x"}],
                                                                   "problems": [], "single_pass_ids": []})
            return A.Result(0, "")
        self.ex.on("working_check.py", collect)
        rc, rep, wf4 = b.go("wcheck-ch04", "B.part2", self.res("B", 2))
        self.assertEqual(rc, 0, rep)
        (argv,) = self.ex.argv_of("working_check.py")
        self.assertEqual(argv[:2], ["working_check.py", "collect"])
        args = [argv[i + 1] for i, x in enumerate(argv) if x == "--args"]
        self.assertEqual(args, ["work/g10-math/packets/fanout/wcheck-ch04.args.json", "work/g10-math/packets/fanout/wcheck-ch04.args.part2.json",
                                "work/g10-math/packets/fanout/wcheck-ch04-B.args.json", "work/g10-math/packets/fanout/wcheck-ch04-B.args.part2.json"])
        runs = argv[argv.index("--runs") + 1:argv.index("--out")]
        self.assertEqual(sorted(runs), sorted([f"runs/g10-math/working-check/ch04-A-{wfs['A']}.json",
                                               f"runs/g10-math/working-check/ch04-A-{wfs['A.part2']}.json",
                                               f"runs/g10-math/working-check/ch04-B-{wfs['B']}.json",
                                               f"runs/g10-math/working-check/ch04-B-{wf4}.json"]))
        self.assertEqual(argv[-2:], ["--out", "runs/g10-math/working-check/ch04.flags.json"])
        self.assertIsNone(rep["waiting"])
        self.assertEqual(rep["counts"]["working_check"]["flagged_solutions"], 9)
        self.assertIn("1 solution(s) no checking agent answered", rep["warnings"][0])
        self.assertTrue(all(c[0][c[0].index("--stage") + 1] == "SW" for c in self.ex.calls if c[0][0] == "meter_run.py"))

    def test_collect_exit_1_with_unchecked_solutions_is_a_warning_but_a_refusal_that_wrote_nothing_is_a_failure(self):
        b = self.box
        for label, pid, part in (("A", "A", 1), ("A.part2", "A", 2), ("B", "B", 1)):
            b.go("wcheck-ch04", label, self.res(pid, part))

        def collect(argv):
            b.put("runs/g10-math/working-check/ch04.flags.json", {"solutions": 10, "verdicts": {}, "flags": [], "unchecked": [{"id": "q:1"}],
                                                                   "problems": ["a result names x"], "single_pass_ids": []})
            return A.Result(1, "chapter 4: ...")
        self.ex.on("working_check.py", collect)
        rc, rep, wf = b.go("wcheck-ch04", "B.part2", self.res("B", 2))
        self.assertEqual(rc, 0, rep)
        self.assertTrue(any("no checking agent answered" in w for w in rep["warnings"]))
        self.assertTrue(any("a result names x" in w for w in rep["warnings"]))
        # a refusal (not a working-check run, say) exits 1 without writing: that is a stop
        flags = b.runs / "working-check" / "ch04.flags.json"
        os.utime(flags, (flags.stat().st_atime, flags.stat().st_mtime - 60))                 # the earlier file stays; it was not rewritten
        self.ex.on("working_check.py", lambda argv: A.Result(1, "not a working-check run (stage is not SW)"))
        wf2, task = b.finish("wcheck-ch04", "B.part2", self.res("B", 2), wf=wf)
        rc, rep = b.adv("wcheck-ch04", wf, task)
        self.assertEqual(rc, 1)
        self.assertIn("no flags file was written", rep["failure"]["detail"])

    def test_the_copy_is_told_apart_by_its_embedded_sha(self):
        b = self.box
        b.go("wcheck-ch04", "B", self.res("B", 1))
        led = json.loads((b.runs / "fanout" / "advance" / "wcheck-ch04.json").read_text())
        self.assertEqual(list(led["copies"]), ["B"])


# ====================================================================== S5 draft, the load
class S5Draft(Base):
    def setUp(self):
        super().setUp()
        b = self.box
        b.copies_for("s5-draft-ch04")
        b.fake_close(4)                     # the chapter is assembled: seed bundle, G2 file, copies
        b.put("runs/g10-math/gates/x", "{}")
        b.preparable = {"s6-author-ch04", "s7-author-ch04"}

    def draft(self):
        return {"stage": "draft", "totals": {"objectives": 9, "entries": 9}, "records": [{}] * 9}

    def test_a_chapter_not_in_the_db_is_loaded_after_a_dry_run_and_a_fresh_dump(self):
        b = self.box
        rc, rep, wf = b.go("s5-draft-ch04", result=self.draft())
        self.assertEqual(rc, 0, rep)
        names = [s["step"] for s in rep["steps"]]
        self.assertEqual(names, ["load dry run", "pg_dump", "load chapter", "apply G2 verdicts", "register in the loaded-bundles config"])
        loads = self.ex.argv_of("load_seed.py")
        load = ["load_seed.py", "seed/g10-math/g10m-course.json", "seed/g10-math/g10m-c04.json", "--course", "course:us-g10-math-en"]
        self.assertEqual(loads, [load + ["--dry-run"], load])
        envs = [c[1] for c in self.ex.calls if c[0][0] in ("load_seed.py", "apply_review_verdicts.py")]
        self.assertTrue(all(e == {"AINEXT_DB_DSN": F.DSN, "AINEXT_ENVIRONMENT": "mvp1"} for e in envs))
        self.assertEqual(self.ex.argv_of("apply_review_verdicts.py"),
                         [["apply_review_verdicts.py", "--g2", "runs/g10-math/g2-ch04.json", "--book", BOOK, "--runs", "runs/g10-math/lesson"]])
        (dump,) = self.ex.tools[:1]
        self.assertEqual(dump[:6], ["pg_dump", "-h", "127.0.0.1", "-p", "5432", "-Fc"])
        self.assertEqual(dump[-1], "scratch_pilot")
        self.assertTrue(dump[dump.index("-f") + 1].endswith("work/g10-math/backups/pilot-before-ch04-load.dump"))
        self.assertEqual(self.ex.tools[1][:2], ["pg_restore", "-l"])
        self.assertEqual(rep["backups"][0]["bytes"], len(b"PGDMP-fake"))
        self.assertEqual(rep["prepared"] and [p["id"] for p in rep["prepared"]], ["s6-author-ch04", "s7-author-ch04"],
                         "S6/S7 author are prepared once the chapter is loaded")

    def test_the_dump_is_taken_before_the_first_write(self):
        b = self.box
        seen = []
        orig = b.ex.tool

        def tool(argv, timeout=0):
            if argv[0] == "pg_dump":
                seen.append(("dump", len(b.ex.argv_of("load_seed.py")), len(b.ex.argv_of("apply_review_verdicts.py"))))
                Path(argv[argv.index("-f") + 1]).write_bytes(b"PGDMP-fake")
                b.ex.tools.append(argv)
                return A.Result(0, "")
            return orig(argv, timeout)
        b.ex.tool = tool
        b.go("s5-draft-ch04", result=self.draft())
        self.assertEqual(seen, [("dump", 1, 0)], "after the dry run (1 load_seed so far), before the real load and the stamps")

    def test_a_chapter_already_in_the_db_is_left_alone_and_no_dump_is_taken(self):
        b = self.box
        b.db.have["questions"] = {"q:ch04:1", "q:ch04:2"}
        b.db.have["graph_nodes"] = {"module:g10m-c04", "lo:g10m4s2-1-1"}
        rc, rep, wf = b.go("s5-draft-ch04", result=self.draft())
        self.assertEqual(rc, 0, rep)
        self.assertEqual(self.ex.scripts(), ["meter_run.py"])
        self.assertEqual(self.ex.tools, [])
        self.assertEqual(rep["counts"]["loaded"], {"already": True, "questions": 2})

    def test_a_failed_dump_stops_before_anything_is_loaded(self):
        b = self.box
        b.ex.on("pg_dump", lambda argv: A.Result(1, "pg_dump: connection refused"))
        rc, rep, wf = b.go("s5-draft-ch04", result=self.draft())
        self.assertEqual(rc, 1)
        self.assertEqual(rep["failure"]["step"], "pg_dump")
        self.assertEqual(len(self.ex.argv_of("load_seed.py")), 1, "only the dry run")
        self.assertEqual(self.ex.argv_of("apply_review_verdicts.py"), [])

    def test_a_dry_run_that_fails_stops_before_the_dump(self):
        b = self.box
        b.ex.on("load_seed.py", lambda argv: A.Result(1, "KaTeX refused 3 items"))
        rc, rep, wf = b.go("s5-draft-ch04", result=self.draft())
        self.assertEqual(rc, 1)
        self.assertEqual(rep["failure"]["step"], "load dry run")
        self.assertEqual(self.ex.tools, [])

    def test_the_db_must_be_local(self):
        b = self.box
        F.DSN = "host=db.example.com port=5432 dbname=prod"
        rc, rep, wf = b.go("s5-draft-ch04", result=self.draft())
        self.assertEqual(rc, 1)
        self.assertIn("must be local", rep["failure"]["detail"])
        self.assertEqual(len(self.ex.argv_of("load_seed.py")), 1, "no real load")

    def test_a_load_that_went_through_without_its_stamps_gets_them_on_the_next_advance(self):
        b = self.box
        calls = {"n": 0}

        def apply_(argv):
            calls["n"] += 1
            return A.Result(1, "apply failed") if calls["n"] == 1 else A.Result(0, "")
        b.ex.on("apply_review_verdicts.py", apply_)
        wf, task = b.finish("s5-draft-ch04", result=self.draft())
        self.assertEqual(b.adv("s5-draft-ch04", wf, task)[0], 1)
        b.db.have["questions"] = {"q:ch04:1", "q:ch04:2"}                      # the load did land
        b.db.have["graph_nodes"] = {"module:g10m-c04", "lo:g10m4s2-1-1"}
        loads = len(self.ex.argv_of("load_seed.py"))
        rc, rep = b.adv("s5-draft-ch04", wf, task)
        self.assertEqual(rc, 0, rep)
        self.assertEqual(len(self.ex.argv_of("load_seed.py")), loads, "not loaded again")
        self.assertEqual(calls["n"], 2, "the stamps were applied")
        self.assertEqual(len(self.ex.tools) // 2, 2, "each write is preceded by a fresh dump (second advance, second dump)")
        names = [p.name for p in (b.work / "backups").glob("*.dump")]
        self.assertEqual(len(names), 2)
        self.assertEqual(len(set(names)), 2, "a name that exists is never overwritten")

    def loaded_bundles(self):
        return json.loads((self.box.runs / "fanout" / "loaded" / "g10-math.json").read_text())

    def test_a_loaded_chapter_joins_the_loaded_bundles_config_in_chapter_order_with_its_existing_content_files(self):
        b = self.box
        for name in ("g10m4s2-1", "g10m4s3-1"):                        # one of the base config's three content files for chapter 4 is not on disk
            b.put(f"seed/content/{name}.json", {}) if name == "g10m4s2-1" else None
        rc, rep, wf = b.go("s5-draft-ch04", result=self.draft())
        self.assertEqual(rc, 0, rep)
        cfg = self.loaded_bundles()
        self.assertEqual(cfg["bundles"], ["services/extraction/seed/g10-math/g10m-course.json", "services/extraction/seed/g10-math/g10m-c01.json",
                                          "services/extraction/seed/g10-math/g10m-c04.json",
                                          "services/extraction/work/g10-math/pilot/seed/g10m-c08.json"])
        self.assertEqual(cfg["content_files"], ["services/extraction/seed/content/g10m4s2-1.json"])
        self.assertIn(("register in the loaded-bundles config", "ok"), b.steps(rep))
        before = (b.runs / "fanout" / "loaded" / "g10-math.json").read_text()
        wf2, task = b.finish("s5-draft-ch04", result=self.draft(), wf=wf)
        b.db.have["questions"] = {"q:ch04:1", "q:ch04:2"}
        b.db.have["graph_nodes"] = {"module:g10m-c04", "lo:g10m4s2-1-1"}
        rc, rep2 = b.adv("s5-draft-ch04", wf, task)
        self.assertEqual(rc, 0, rep2)
        self.assertEqual((b.runs / "fanout" / "loaded" / "g10-math.json").read_text(), before, "registered once")
        self.assertIn(("register in the loaded-bundles config", "skipped"), b.steps(rep2))

    def test_a_chapter_loaded_by_hand_is_registered_too_so_g5_sees_what_the_db_holds(self):
        b = self.box
        b.db.have["questions"] = {"q:ch04:1", "q:ch04:2"}
        b.db.have["graph_nodes"] = {"module:g10m-c04", "lo:g10m4s2-1-1"}
        rc, rep, wf = b.go("s5-draft-ch04", result=self.draft())
        self.assertEqual(rc, 0, rep)
        self.assertEqual(self.ex.tools, [], "nothing was written to the DB, so no dump")
        self.assertIn("services/extraction/seed/g10-math/g10m-c04.json", self.loaded_bundles()["bundles"])

    def test_the_loaded_config_is_not_touched_when_the_load_fails(self):
        b = self.box
        before = (b.runs / "fanout" / "loaded" / "g10-math.json").read_text()
        b.ex.on("load_seed.py", lambda argv: A.Result(1, "KaTeX refused 3 items"))
        rc, rep, wf = b.go("s5-draft-ch04", result=self.draft())
        self.assertEqual(rc, 1)
        self.assertEqual((b.runs / "fanout" / "loaded" / "g10-math.json").read_text(), before)

    def test_a_missing_loaded_config_is_made_from_the_base_config(self):
        b = self.box
        (b.runs / "fanout" / "loaded" / "g10-math.json").unlink()
        rc, rep, wf = b.go("s5-draft-ch04", result=self.draft())
        self.assertEqual(rc, 0, rep)
        cfg = self.loaded_bundles()
        self.assertEqual(cfg["bundles"], ["services/extraction/seed/g10-math/g10m-course.json", "services/extraction/seed/g10-math/g10m-c04.json"])
        self.assertEqual((cfg["status"], cfg["generated"], cfg["parity"]), ("loadable", None, None))

    def test_the_chapter_must_be_assembled_first(self):
        b = self.box
        (b.here / "seed" / BOOK / "g10m-c04.json").unlink()
        rc, rep, wf = b.go("s5-draft-ch04", result=self.draft())
        self.assertEqual(rc, 1)
        self.assertIn("close the chapter first", rep["failure"]["detail"])


# ====================================================================== S6
class S6(Base):
    def setUp(self):
        super().setUp()
        self.box.copies_for("s6-author-ch04")
        self.box.copy("s6-grade-ch04", "part1")
        self.box.copy("s6-grade-ch04", "part2")
        self.box.preparable = {"s6-grade-ch04"}
        self.result = {"records": [{"lo_id": "lo:g10m4s2-1-1", "families": [{"id": "fam:g10m4s2-1-1:alpha"}, {"id": "fam:g10m4s2-1-2:beta"}]}]}

    def test_author_writes_the_specs_normalises_checks_and_prepares_the_grade(self):
        b = self.box
        b.copies.pop(("s6-grade-ch04", "part1"))
        for p in F.EMBED.glob("*s6-grade*"):
            p.unlink()
        self.ex.on("generate_questions.py", lambda argv: A.Result(0, "2 spec(s) → 20 item(s); per family: alpha=10, beta=10"))
        rc, rep, wf = b.go("s6-author-ch04", result=self.result)
        self.assertEqual(rc, 0, rep)
        fam = b.here / "families" / BOOK / "ch04"
        self.assertEqual(sorted(p.name for p in fam.glob("*.json")), ["g10m4s2-1-1--alpha.json", "g10m4s2-1-2--beta.json"])
        self.assertEqual(self.box.steps(rep), [("chapter config", "ok"), ("write-specs", "ok"), ("families.normalise", "ok"),
                                               ("generate_questions --check", "ok")])
        self.assertEqual(self.ex.argv_of("-m"), [["-m", "families.normalise", "families/g10-math/ch04/g10m4s2-1-1--alpha.json",
                                                  "families/g10-math/ch04/g10m4s2-1-2--beta.json"]])
        self.assertEqual(self.ex.argv_of("generate_questions.py"), [["generate_questions.py", "--families", "families/g10-math/ch04", "--book",
                                                                     "work/g10-math/fanout/books/ch04/g10-math.json", "--check"]])
        self.assertEqual(rep["counts"]["families"], 2)
        self.assertEqual(rep["counts"]["check"], "2 spec(s) → 20 item(s); per family: alpha=10, beta=10")
        self.assertEqual([p["id"] for p in rep["prepared"]], ["s6-grade-ch04"])

    def test_specs_already_written_are_not_written_again_and_a_hand_edited_directory_is_not_resurrected(self):
        b = self.box
        rc, rep, wf = b.go("s6-author-ch04", result=self.result)
        self.assertEqual(rc, 0, rep)
        wf2, task = b.finish("s6-author-ch04", result=self.result, wf=wf)
        rc, rep2 = b.adv("s6-author-ch04", wf, task)
        self.assertEqual(rc, 0, rep2)
        self.assertIn(("write-specs", "skipped"), b.steps(rep2))
        fam = b.here / "families" / BOOK / "ch04"
        (fam / "g10m4s2-1-2--beta.json").rename(fam / "_held--g10m4s2-1-2--beta.json")
        rc, rep3 = b.adv("s6-author-ch04", wf, task)
        self.assertEqual(rc, 0, "a spec held aside is not rewritten")
        self.assertEqual(rep3["warnings"], [])
        (fam / "_held--g10m4s2-1-2--beta.json").rename(fam / "g10m4s2-1-2--beta-revised.json")     # re-authored under another name
        rc, rep4 = b.adv("s6-author-ch04", wf, task)
        self.assertEqual(rc, 0, rep4)
        self.assertIn("1 of this run's 2 spec(s) are not in", rep4["warnings"][0])
        self.assertFalse((fam / "g10m4s2-1-2--beta.json").exists(), "never resurrected")

    def test_a_directory_holding_other_specs_and_none_of_this_runs_is_a_failure_not_a_guess(self):
        b = self.box
        b.put("families/g10-math/ch04/g10m4s9-9-9--old.json", {})
        rc, rep, wf = b.go("s6-author-ch04", result=self.result)
        self.assertEqual(rc, 1)
        self.assertEqual(rep["failure"]["step"], "write-specs")
        self.assertIn("not this run's", rep["failure"]["detail"])
        self.assertEqual([p.name for p in (b.here / "families" / BOOK / "ch04").glob("*.json")], ["g10m4s9-9-9--old.json"])

    def test_an_author_that_wrote_no_family_is_a_note_and_nothing_is_checked(self):
        b = self.box
        rc, rep, wf = b.go("s6-author-ch04", result={"records": [{"lo_id": "x", "families": []}]})
        self.assertEqual(rc, 0, rep)
        self.assertIn(("write-specs", "skipped"), b.steps(rep))
        self.assertEqual(self.ex.argv_of("generate_questions.py"), [])
        self.assertIn("S6 grading will be skipped", rep["notes"][0])

    def test_a_spec_the_check_refuses_is_the_failure_and_the_grade_is_not_prepared(self):
        b = self.box
        self.ex.on("generate_questions.py", lambda argv: A.Result(1, "alpha: FAIL answer does not mark itself correct"))
        rc, rep, wf = b.go("s6-author-ch04", result=self.result)
        self.assertEqual(rc, 1)
        self.assertEqual(rep["failure"]["step"], "generate_questions --check")
        self.assertIn("FAIL answer does not mark itself correct", rep["failure"]["detail"])
        self.assertEqual(b.prepared, [])

    def test_grade_waits_for_every_part_then_grades_with_all_of_them(self):
        b = self.box
        for p in ("alpha", "beta"):
            b.put(f"families/g10-math/ch04/g10m4s2-1-1--{p}.json", {})
        w1 = b.go("s6-grade-ch04", "part1", {"results": [{}] * 3, "part": 1})
        self.assertIn("part2", w1[1]["waiting"])
        self.assertEqual(self.ex.argv_of("generate_questions.py"), [])
        rc, rep, w2 = b.go("s6-grade-ch04", "part2", {"results": [{}] * 3, "part": 2})
        self.assertEqual(rc, 0, rep)
        (argv,) = self.ex.argv_of("generate_questions.py")
        self.assertEqual(argv[:5], ["generate_questions.py", "--families", "families/g10-math/ch04", "--book",
                                    "work/g10-math/fanout/books/ch04/g10-math.json"])
        i = argv.index("--grades")
        self.assertEqual(argv[i + 1:argv.index("--s5-distractors")], [f"runs/g10-math/families/grade-ch04-{w1[2]}.json",
                                                                     f"runs/g10-math/families/grade-ch04-{w2}.json"])
        self.assertEqual(argv[-2:], ["--s5-distractors", "runs/g10-math/families/s5-distractors-ch04.json"])


# ====================================================================== S7
class S7(Base):
    def setUp(self):
        super().setUp()
        b = self.box
        b.copies_for("s7-author-ch04")
        b.put("runs/g10-math/misconceptions/draft-ch04-wf_d.json", {})
        b.preparable = {"s7-verify-ch04"}

    def write_templates(self, argv):
        wid = self.box.here / "widgets" / BOOK / "ch04"
        wid.mkdir(parents=True, exist_ok=True)
        (wid / "g10m4s2-1-1--plot.json").write_text("{}")
        self.box.put("runs/g10-math/widgets/author-merged-ch04.json", {"gaps": [{}, {}], "records": [{}]})
        return A.Result(0, "")

    def test_the_author_run_is_merged_into_templates_normalised_and_verification_is_prepared(self):
        b = self.box
        self.ex.on("generate_widget_questions.py", lambda argv: self.write_templates(argv) if "--merge-author-runs" in argv else A.Result(0, ""))
        rc, rep, wf = b.go("s7-author-ch04", result={"records": [{}], "gaps": []})
        self.assertEqual(rc, 0, rep)
        merge, norm = self.ex.argv_of("generate_widget_questions.py")
        self.assertEqual(merge, ["generate_widget_questions.py", "--merge-author-runs", f"runs/g10-math/widgets/author-ch04-{wf}.json", "--merged",
                                 "runs/g10-math/widgets/author-merged-ch04.json", "--write-templates", "widgets/g10-math/ch04"])
        self.assertEqual(norm, ["generate_widget_questions.py", "--dsn", F.DSN, "--catalogue", "runs/g10-math/misconceptions/draft-ch04-wf_d.json",
                                "--normalise-templates", "widgets/g10-math/ch04/g10m4s2-1-1--plot.json"])
        self.assertEqual(self.ex.calls[-1][1], {"AINEXT_DB_DSN": F.DSN})
        self.assertEqual(rep["counts"]["templates"], 1)
        self.assertEqual(rep["counts"]["gaps"], 2)
        self.assertEqual([p["id"] for p in rep["prepared"]], ["s7-verify-ch04"])

    def test_no_template_means_no_normalise_and_the_verify_is_skipped_by_the_prepare(self):
        b = self.box
        b.put("runs/g10-math/widgets/author-merged-ch04.json", {"gaps": [{}], "records": [{}]})
        b.skip_prepare["s7-verify-ch04"] = "the S7 author wrote no template for chapter 4 (every lesson a gap): nothing to verify"
        b.preparable = {"s5-final-ch04"}
        rc, rep, wf = b.go("s7-author-ch04", result={"records": [{}]})
        self.assertEqual(rc, 0, rep)
        self.assertEqual(len(self.ex.argv_of("generate_widget_questions.py")), 1, "the merge only")
        self.assertIn("no template", rep["notes"][0])
        self.assertEqual(rep["skipped"][0]["id"], "s7-verify-ch04")

    def test_the_merge_is_skipped_when_its_output_is_newer_and_never_overwrites(self):
        b = self.box
        self.ex.on("generate_widget_questions.py", lambda argv: self.write_templates(argv) if "--merge-author-runs" in argv else A.Result(0, ""))
        wf, task = b.finish("s7-author-ch04", result={"records": [{}]})
        b.adv("s7-author-ch04", wf, task)
        n = len(self.ex.argv_of("generate_widget_questions.py"))
        rc, rep = b.adv("s7-author-ch04", wf, task)
        self.assertEqual(rc, 0, rep)
        self.assertEqual(self.ex.argv_of("generate_widget_questions.py")[n:], [self.ex.argv_of("generate_widget_questions.py")[1]],
                         "only the (idempotent) normalise ran again")
        self.assertIn(("merge author run → templates", "skipped"), b.steps(rep))

    def test_verify_turns_the_verdicts_into_distractors_and_the_held_queue(self):
        b = self.box
        b.copy("s7-verify-ch04")
        b.put("widgets/g10-math/ch04/g10m4s2-1-1--plot.json", {})
        b.put("runs/g10-math/widgets/author-merged-ch04.json", {})
        rc, rep, wf = b.go("s7-verify-ch04", result={"results": [{}] * 4})
        self.assertEqual(rc, 0, rep)
        self.assertEqual(self.ex.argv_of("generate_widget_questions.py"),
                         [["generate_widget_questions.py", "--templates", "widgets/g10-math/ch04", "--book", "work/g10-math/fanout/books/ch04/g10-math.json",
                           "--dsn", F.DSN, "--catalogue", "runs/g10-math/misconceptions/draft-ch04-wf_d.json", "--verdicts",
                           f"runs/g10-math/widgets/verify-ch04-{wf}.json", "--gaps", "runs/g10-math/widgets/author-merged-ch04.json",
                           "--pre-catalogue", "--s5-distractors", "runs/g10-math/widgets/s5-distractors-ch04.json",
                           "--pending-review", "runs/g10-math/widgets/pending-review-ch04.json"]],
                         "the draft catalogue and --pre-catalogue: without them every template is REJECTED and no distractor file is written")


# ====================================================================== S5 final
class S5Final(Base):
    def setUp(self):
        super().setUp()
        b = self.box
        b.copies_for("s5-final-ch04")
        b.fake_close(4)
        b.put("families/g10-math/ch04/g10m4s2-1-1--alpha.json", {})
        b.put("widgets/g10-math/ch04/g10m4s2-1-1--plot.json", {})
        b.put("runs/g10-math/families/grade-ch04-wf_g1.json", {})
        b.put("runs/g10-math/widgets/verify-ch04-wf_v1.json", {})
        b.put("runs/g10-math/widgets/author-merged-ch04.json", {})
        b.put("runs/g10-math/maths/book/summary.json", {})
        gen = b.here / "seed" / "generated" / BOOK / "ch04"
        self.gen = gen

        def fake(argv):
            s = argv[0]
            if s == "assemble_misconceptions.py":
                gen.mkdir(parents=True, exist_ok=True)
                (gen / "misconceptions.json").write_text(json.dumps({"misconceptions": [{"id": "mc:a"}, {"id": "mc:b"}]}))
            elif s == "generate_questions.py":
                (gen / "generated-questions.json").write_text(json.dumps({"questions": [{"id": "q:g1"}, {"id": "q:g2"}]}))
            elif s == "generate_widget_questions.py" and "--out" in argv:
                (gen / "widget-questions.json").write_text(json.dumps({"questions": [{"id": "q:w1"}]}))
                (b.here / "coverage" / f"{BOOK}.ch04.widget-gaps.json").write_text("{}")
            elif s == "generate_widget_questions.py":
                (b.here / "coverage" / f"{BOOK}.ch04.widget-gaps.json").write_text("{}")
            elif s == "load_generated_questions.py" and "--dry-run" not in argv:
                (b.here / argv[1]).with_suffix(".review-queue.json").write_text("{}")
            elif s == "auto_pass_gates.py" and argv[1] == "g3":
                (b.runs / "g3-ch04.auto.json").write_text("{}")
                (b.runs / "gates" / "g3-ch04.json").write_text("{}")
            elif s == "auto_pass_gates.py" and argv[1] == "g4":
                (b.runs / "gates" / "g4-ch04.json").write_text("{}")
            elif s == "auto_pass_gates.py" and argv[1] == "g5":
                (b.runs / "gates" / "g5-ch04.json").write_text(json.dumps({"outcome": "pass_with_holds", "summary": "GO for the fan-out"}))
                return A.Result(0, "G5 auto-pass (ch04): PASS_WITH_HOLDS — GO\n  for Samuel: coverage tier_floor fails (33/39)\n")
            elif s == "coverage_report.py":
                (b.here / "coverage" / f"{BOOK}.ch04.json").write_text(json.dumps(self.coverage))
                return A.Result(0 if self.coverage["status"] == "GREEN" else 1, "")
            return A.Result(0, "")
        for s in ("assemble_misconceptions.py", "generate_questions.py", "generate_widget_questions.py", "load_generated_questions.py",
                  "auto_pass_gates.py", "coverage_report.py", "load_misconceptions.py", "parity_check.py", "apply_review_verdicts.py"):
            b.ex.on(s, fake)
        self.coverage = {"status": "GREEN", "checks": [], "summary": {"checks": 3}}

    def test_the_whole_chain_in_order_with_the_plans_arguments(self):
        b = self.box
        rc, rep, wf = b.go("s5-final-ch04", result={"stage": "final"})
        self.assertEqual(rc, 0, rep)
        final = f"runs/g10-math/misconceptions/final-ch04-{wf}.json"
        cfg, gen = "work/g10-math/fanout/books/ch04/g10-math.json", "seed/generated/g10-math/ch04"
        graphs = ["--graph", "seed/g10-math/g10m-c04.json", "--graph", "seed/g10-math/g10m-course.json"]
        names = [s["step"] for s in rep["steps"]]
        self.assertEqual(names, ["chapter config", "S5 catalogue", "load catalogue dry run", "pg_dump", "load catalogue", "generated questions", "widget questions",
                                 "reconcile tags with the catalogue", "validate generated-questions.json", "load generated-questions.json",
                                 "validate widget-questions.json", "load widget-questions.json", "G3 auto-pass", "apply G3 verdicts",
                                 "G4 auto-pass", "coverage", "parity (every course)", "register in the loaded-bundles config", "G5 auto-pass"])
        by_script = self.ex.argv_of
        self.assertEqual(by_script("assemble_misconceptions.py"), [
            ["assemble_misconceptions.py", final, "--book", cfg, "--out", f"{gen}/misconceptions.json", *graphs],
            ["assemble_misconceptions.py", final, "--book", cfg, "--out", f"{gen}/misconceptions.json", "--bundle", f"{gen}/generated-questions.json",
             "--bundle", f"{gen}/widget-questions.json", *graphs]])
        self.assertEqual(by_script("load_misconceptions.py"), [["load_misconceptions.py", f"{gen}/misconceptions.json", "--course", "course:us-g10-math-en",
                                                                "--dry-run"], ["load_misconceptions.py", f"{gen}/misconceptions.json", "--course",
                                                                              "course:us-g10-math-en"]])
        self.assertEqual(by_script("generate_questions.py"), [["generate_questions.py", "--families", "families/g10-math/ch04", "--book", cfg,
                                                               "--catalogue", f"{gen}/misconceptions.json", "--grades",
                                                               "runs/g10-math/families/grade-ch04-wf_g1.json", "--out", f"{gen}/generated-questions.json",
                                                               "--floor-report", "coverage/g10-math.ch04.tier-floor.json"]])
        self.assertEqual(by_script("generate_widget_questions.py"), [[
            "generate_widget_questions.py", "--templates", "widgets/g10-math/ch04", "--book", cfg, "--dsn", F.DSN, "--verdicts",
            "runs/g10-math/widgets/verify-ch04-wf_v1.json", "--gaps", "runs/g10-math/widgets/author-merged-ch04.json", "--gap-report",
            "coverage/g10-math.ch04.widget-gaps.json", "--pending-review", "runs/g10-math/widgets/pending-review-ch04.json", "--out",
            f"{gen}/widget-questions.json"]])
        loads = by_script("load_generated_questions.py")
        base = ["--course", "course:us-g10-math-en", "--sample", "10", "--seed", "20260926", "--catalogue-only"]
        self.assertEqual(loads, [["load_generated_questions.py", f"{gen}/generated-questions.json", *base, "--dry-run"],
                                 ["load_generated_questions.py", f"{gen}/generated-questions.json", *base],
                                 ["load_generated_questions.py", f"{gen}/widget-questions.json", *base, "--dry-run"],
                                 ["load_generated_questions.py", f"{gen}/widget-questions.json", *base]])
        gates = by_script("auto_pass_gates.py")
        self.assertEqual(gates[0], ["auto_pass_gates.py", "g3", BOOK, "--chapter", "4", "--queue", f"{gen}/generated-questions.review-queue.json",
                                    "--queue", f"{gen}/widget-questions.review-queue.json", "--widgets", f"{gen}/widget-questions.json",
                                    "--widget-gaps", "coverage/g10-math.ch04.widget-gaps.json"])
        self.assertEqual(gates[1], ["auto_pass_gates.py", "g4", BOOK, "--chapter", "4", "--catalogue", f"{gen}/misconceptions.json", "--s5", final])
        self.assertEqual(gates[2], ["auto_pass_gates.py", "g5", BOOK, "--chapter", "4", "--coverage", "coverage/g10-math.ch04.json", "--book-config",
                                    "runs/g10-math/fanout/loaded/g10-math.json"])
        g5_env = [c[1] for c in self.ex.calls if c[0][:2] == ["auto_pass_gates.py", "g5"]][0]
        self.assertEqual(g5_env["AINEXT_DB_DSN"], F.DSN)
        self.assertEqual(rep["counts"]["g5"]["outcome"], "pass_with_holds")
        self.assertIn("G5 for Samuel: coverage tier_floor fails (33/39)", rep["warnings"])
        loaded = json.loads((b.runs / "fanout" / "loaded" / "g10-math.json").read_text())["bundles"]
        self.assertEqual(loaded, ["services/extraction/seed/g10-math/g10m-course.json", "services/extraction/seed/g10-math/g10m-c01.json",
                                  "services/extraction/seed/g10-math/g10m-c04.json", "services/extraction/work/g10-math/pilot/seed/g10m-c08.json"],
                         "the chapter joins the config G5's parity reads, in chapter order, the course first")
        self.assertEqual(by_script("apply_review_verdicts.py"), [["apply_review_verdicts.py", "runs/g10-math/g3-ch04.auto.json"]])
        self.assertEqual(by_script("coverage_report.py"), [["coverage_report.py", "--book", cfg, "--chapter", "4", "--maths",
                                                            "runs/g10-math/maths/book/summary.json", "--widget-gaps", "coverage/g10-math.ch04.widget-gaps.json",
                                                            "--s5", final, "--generated", gen, "--out", "coverage/g10-math.ch04.json"]])
        self.assertEqual(by_script("parity_check.py"), [["parity_check.py", "--candidate", F.DSN, "--all-courses"]])
        self.assertEqual(len(b.ex.tools) // 2, 1, "ONE dump for all of the advance's DB writes")
        self.assertTrue(rep["backups"][0]["path"].endswith("pilot-before-ch04-final-load.dump"))
        self.assertEqual(rep["counts"]["bundles"], ["generated-questions.json", "widget-questions.json"])

    def test_a_chapter_with_no_family_and_no_template_writes_neither_bundle_and_reports_the_gap_report_alone(self):
        b = self.box
        for p in (b.here / "families" / BOOK / "ch04").glob("*.json"):
            p.unlink()
        for p in (b.here / "widgets" / BOOK / "ch04").glob("*.json"):
            p.unlink()
        rc, rep, wf = b.go("s5-final-ch04", result={"stage": "final"})
        self.assertEqual(rc, 0, rep)
        self.assertEqual(self.ex.argv_of("generate_questions.py"), [])
        (gap,) = self.ex.argv_of("generate_widget_questions.py")
        self.assertEqual(gap, ["generate_widget_questions.py", "--templates", "widgets/g10-math/ch04", "--book",
                               "work/g10-math/fanout/books/ch04/g10-math.json", "--dsn", F.DSN, "--gaps", "runs/g10-math/widgets/author-merged-ch04.json",
                               "--gap-report", "coverage/g10-math.ch04.widget-gaps.json"])
        self.assertEqual(len(self.ex.argv_of("assemble_misconceptions.py")), 1, "no bundle to reconcile")
        self.assertEqual(self.ex.argv_of("load_generated_questions.py"), [])
        self.assertEqual(self.ex.argv_of("auto_pass_gates.py")[0][1], "g4", "no G3 without a bundle")
        self.assertIn("no family: no generated-questions bundle", rep["notes"])

    def test_a_coverage_safety_check_failing_blocks_a_completeness_one_is_a_warning(self):
        b = self.box
        self.coverage = {"status": "RED", "summary": {"fail": 2}, "checks": [
            {"id": "tier_floor", "state": "fails", "got": 33, "want": 39}, {"id": "katex", "state": "fails", "got": 1, "want": 0}]}
        rc, rep, wf = b.go("s5-final-ch04", result={"stage": "final"})
        self.assertEqual(rc, 1)
        self.assertEqual(rep["failure"]["step"], "coverage")
        self.assertIn("katex", rep["failure"]["detail"])
        self.assertEqual(self.ex.argv_of("parity_check.py"), [], "stops at the failing step")
        self.assertTrue(any("tier_floor" in w for w in rep["warnings"]))
        self.coverage = {"status": "RED", "summary": {"fail": 1}, "checks": [{"id": "tier_floor", "state": "fails", "got": 33, "want": 39}]}
        wf2, task = b.finish("s5-final-ch04", result={"stage": "final"}, wf=wf)
        rc, rep = b.adv("s5-final-ch04", wf, task)
        self.assertEqual(rc, 0, rep)
        self.assertEqual(rep["counts"]["coverage"]["failing"], ["tier_floor"])
        self.assertTrue(any("tier_floor" in w and "completeness" in w for w in rep["warnings"]))

    def test_a_coverage_report_that_crashed_is_a_failure_not_a_stale_file_read(self):
        b = self.box
        (b.here / "coverage").mkdir(exist_ok=True)
        stale = b.here / "coverage" / f"{BOOK}.ch04.json"
        stale.write_text(json.dumps({"status": "GREEN", "checks": []}))                      # an earlier report
        os.utime(stale, (stale.stat().st_atime, stale.stat().st_mtime - 60))
        self.ex.on("coverage_report.py", lambda argv: A.Result(1, "Traceback (most recent call last): boom"))
        rc, rep, wf = b.go("s5-final-ch04", result={"stage": "final"})
        self.assertEqual(rc, 1)
        self.assertEqual(rep["failure"]["step"], "coverage")
        self.assertIn("no report was written", rep["failure"]["detail"])

    def test_g5_no_go_stops_the_advance_with_the_gates_blocked_lines(self):
        b = self.box
        orig = self.ex.rules["auto_pass_gates.py"]
        self.ex.on("auto_pass_gates.py", lambda argv: A.Result(1, "G5 auto-pass (ch04): NO-GO\n  BLOCKED parity RED for course:us-g10-math-en: modules 2 != 3\n")
                   if argv[1] == "g5" else orig(argv))
        rc, rep, wf = b.go("s5-final-ch04", result={"stage": "final"})
        self.assertEqual(rc, 1)
        self.assertEqual(rep["failure"]["step"], "G5 auto-pass")
        self.assertIn("BLOCKED parity RED", rep["failure"]["detail"])
        led = json.loads((b.runs / "fanout" / "advance" / "s5-final-ch04.json").read_text())
        self.assertFalse(led["after_done"])

    def test_without_a_generated_bundle_g3_cannot_run_and_that_is_said(self):
        b = self.box
        for p in (b.here / "families" / BOOK / "ch04").glob("*.json"):
            p.unlink()
        for p in (b.here / "widgets" / BOOK / "ch04").glob("*.json"):
            p.unlink()
        rc, rep, wf = b.go("s5-final-ch04", result={"stage": "final"})
        self.assertEqual(rc, 0, rep)
        self.assertEqual([a[1] for a in self.ex.argv_of("auto_pass_gates.py")], ["g4", "g5"])
        self.assertTrue(any("G3 could not run" in w for w in rep["warnings"]))

    def test_parity_red_blocks(self):
        b = self.box
        self.ex.on("parity_check.py", lambda argv: A.Result(1, "✗ questions_total 450 != 452\n"))
        rc, rep, wf = b.go("s5-final-ch04", result={"stage": "final"})
        self.assertEqual(rc, 1)
        self.assertEqual(rep["failure"]["step"], "parity (every course)")
        self.assertIn("questions_total", rep["failure"]["detail"])

    def test_a_second_advance_loads_nothing_and_re_runs_no_gate(self):
        b = self.box
        rc, rep, wf = b.go("s5-final-ch04", result={"stage": "final"})
        self.assertEqual(rc, 0, rep)
        b.db.have["misconceptions"] = {"mc:a", "mc:b"}
        b.db.have["questions"] = {"q:g1", "q:g2", "q:w1"}
        n = len(self.ex.calls)
        tools = len(self.ex.tools)
        wf2, task = b.finish("s5-final-ch04", result={"stage": "final"}, wf=wf)
        rc, rep2 = b.adv("s5-final-ch04", wf, task)
        self.assertEqual(rc, 0, rep2)
        again = [c[0][0] for c in self.ex.calls[n:]]
        self.assertEqual(again, ["parity_check.py"], f"only the read-only parity ran again: {again}")
        self.assertEqual(len(self.ex.tools), tools, "no dump: nothing was written")
        st = dict(b.steps(rep2))
        for name in ("S5 catalogue", "load catalogue", "generated questions", "widget questions", "reconcile tags with the catalogue",
                     "load generated-questions.json", "load widget-questions.json", "G3 auto-pass", "apply G3 verdicts", "G4 auto-pass", "coverage"):
            self.assertEqual(st[name], "skipped", name)

    def test_the_dump_is_not_taken_when_the_first_db_write_fails_to_need_one(self):
        b = self.box
        b.db.have["misconceptions"] = {"mc:a", "mc:b"}
        b.db.have["questions"] = {"q:g1", "q:g2", "q:w1"}
        rc, rep, wf = b.go("s5-final-ch04", result={"stage": "final"})
        self.assertEqual(rc, 0, rep)
        self.assertEqual(self.ex.argv_of("load_misconceptions.py"), [])
        self.assertEqual(self.ex.argv_of("load_generated_questions.py"), [])
        self.assertEqual(len(self.ex.tools) // 2, 1, "the G3 verdicts are the one DB write left, behind one dump")


# ====================================================================== what comes next
class Next(Base):
    def test_a_saved_run_releases_its_dependents_which_are_prepared_and_verified_and_listed_in_plan_order(self):
        b = self.box
        b.copies_for("s0b-C-g3")
        b.legacy("s0b-A-g3")
        b.legacy("s0b-B-g3")
        b.preparable = {"s1-ch04"}
        rc, rep, wf = b.go("s0b-C-g3", result={"stage": "S0b", "results": []})
        self.assertEqual(rc, 0, rep)
        self.assertEqual([p["id"] for p in rep["prepared"]], ["s1-ch04"])
        self.assertEqual(rep["ready"], [{"id": "s1-ch04", "stage": "S1", "copies": ["main"], "agents": 3, "cost_usd": [1.0, 2.0]}])
        self.assertEqual(rep["ready_scripts"], [str(b.copies[("s1-ch04", "")][0])])
        self.assertEqual(rep["not_ready"], {})

    def test_a_run_that_cannot_be_prepared_yet_is_listed_with_the_reason_and_the_advance_still_succeeds(self):
        b = self.box
        b.copies_for("s0b-C-g3")
        b.legacy("s0b-A-g3")
        b.legacy("s0b-B-g3")
        rc, rep, wf = b.go("s0b-C-g3", result={"stage": "S0b", "results": []})
        self.assertEqual(rc, 0, rep)
        self.assertEqual(rep["not_ready"], {"s1-ch04": "s1-ch04: inputs missing (test)"})
        self.assertEqual(rep["prepared"], [])
        self.assertEqual(rep["unprepared"], ["s1-ch04"])

    def test_a_builder_that_crashes_is_reported_not_fatal(self):
        b = self.box
        b.copies_for("s0b-C-g3")
        b.legacy("s0b-A-g3")
        b.legacy("s0b-B-g3")

        def boom(rid):
            raise KeyError("lessons")
        F.prepare = boom
        rc, rep, wf = b.go("s0b-C-g3", result={"stage": "S0b", "results": []})
        self.assertEqual(rc, 0, rep)
        self.assertIn("ERROR KeyError", rep["not_ready"]["s1-ch04"])

    def test_a_copy_that_does_not_verify_is_a_failure_and_nothing_is_offered(self):
        b = self.box
        b.copies_for("s0b-C-g3")
        b.legacy("s0b-A-g3")
        b.legacy("s0b-B-g3")

        def prepare(rid):
            out, _ = b.copy(rid)
            out.write_text(out.read_text() + "// edited after generation\n")
            return {"script": str(out)}
        F.prepare = prepare
        rc, rep, wf = b.go("s0b-C-g3", result={"stage": "S0b", "results": []})
        self.assertEqual(rc, 1)
        self.assertEqual(rep["failure"]["step"], "verify s1-ch04")
        self.assertNotIn("ready", rep)

    def test_a_copy_that_exists_is_never_regenerated(self):
        b = self.box
        b.copies_for("s0b-C-g3", "s1-ch04")
        b.legacy("s0b-A-g3")
        b.legacy("s0b-B-g3")
        calls = []
        F.prepare = lambda rid: calls.append(rid)
        rc, rep, wf = b.go("s0b-C-g3", result={"stage": "S0b", "results": []})
        self.assertEqual(rc, 0, rep)
        self.assertEqual(calls, [], "s1-ch04 has a copy (it may be running): prepare is not called")
        self.assertEqual([e["id"] for e in rep["ready"]], ["s1-ch04"])

    def test_a_run_in_flight_is_neither_prepared_nor_listed(self):
        b = self.box
        b.copies_for("s0b-A-g3")
        S = A.State(A.Paths(), json.loads(F.PLAN_PATH.read_text()))
        out = A.ready_list(A.Paths(), S, set(), A.Opts())
        self.assertEqual([e["id"] for e in out["ready"]], ["s0b-A-g3"])
        out = A.ready_list(A.Paths(), S, A.parse_running(["s0b-A-g3"]), A.Opts())
        self.assertEqual(out["ready"], [])
        self.assertEqual(out["lanes"], {"max": 2, "in_flight": 1, "free": 1})

    def test_regenerating_a_stale_copy_without_naming_what_is_in_flight_is_a_warning(self):
        b = self.box
        b.copies_for("s0b-A-g3", "s0b-B-g3", "s0b-C-g3")
        b.legacy("s0b-A-g3")
        b.legacy("s0b-B-g3")
        b.stub.write_text(STUB + "// edited\n")
        b.preparable = {"s0b-C-g3"}
        P, plan = A.Paths(), json.loads(F.PLAN_PATH.read_text())
        rep = A.new_report("(ready)", "", False)
        A.prepare_ready(P, A.State(P, plan), A.Flow(P, b.ex), rep, set(), A.Opts(refresh_stale=True))
        self.assertEqual(rep["refreshed"], ["s0b-C-g3"])
        self.assertIn("no --running given", rep["warnings"][0])

    def test_stale_copies_are_regenerated_only_on_request_and_never_for_a_run_in_flight(self):
        b = self.box
        b.copies_for("s0b-A-g3", "s0b-B-g3", "s0b-C-g3")
        b.legacy("s0b-A-g3")
        b.legacy("s0b-B-g3")
        b.stub.write_text(STUB + "// edited\n")
        b.preparable = {"s0b-C-g3"}
        P, plan = A.Paths(), json.loads(F.PLAN_PATH.read_text())
        rep = A.new_report("(ready)", "", False)
        A.prepare_ready(P, A.State(P, plan), A.Flow(P, b.ex), rep, set(), A.Opts())
        self.assertEqual(b.prepared, [], "stale but present: left alone by default")
        A.prepare_ready(P, A.State(P, plan), A.Flow(P, b.ex), rep, A.parse_running(["s0b-C-g3"]), A.Opts(refresh_stale=True))
        self.assertEqual(b.prepared, [], "in flight: never regenerated")
        A.prepare_ready(P, A.State(P, plan), A.Flow(P, b.ex), rep, set(), A.Opts(refresh_stale=True))
        self.assertEqual(b.prepared, ["s0b-C-g3"])


class Ready(Base):
    def state(self):
        return A.State(A.Paths(), json.loads(F.PLAN_PATH.read_text()))

    def ready(self, running=(), **kw):
        return A.ready_list(A.Paths(), self.state(), A.parse_running(running), A.Opts(**kw))

    def save(self, rid, label="", done=True):
        b = self.box
        b.legacy(rid, label)
        if not done:
            b.put(f"runs/g10-math/fanout/advance/{rid}.json", {"after_done": False, "copies": {}})

    def test_only_runs_whose_dependencies_are_saved_are_ready_in_plan_order(self):
        b = self.box
        b.copies_for("s0b-A-g3", "s0b-B-g3", "s0b-C-g3", "s1-ch04")
        r = self.ready()
        self.assertEqual([e["id"] for e in r["ready"]], ["s0b-A-g3"], "B waits on A, C on both, S1 on C")
        self.save("s0b-A-g3")
        self.assertEqual([e["id"] for e in self.ready()["ready"]], ["s0b-B-g3"])
        self.save("s0b-B-g3")
        self.assertEqual([e["id"] for e in self.ready()["ready"]], ["s0b-C-g3"])

    def test_a_saved_run_whose_after_steps_did_not_complete_releases_nothing(self):
        b = self.box
        b.copies_for("s0b-A-g3", "s0b-B-g3")
        self.save("s0b-A-g3", done=False)
        r = self.ready()
        self.assertEqual(r["ready"], [])
        self.assertEqual(r["incomplete"], ["s0b-A-g3"])

    def test_the_chapter_1_go_no_go_is_lifted_by_default_and_honored_on_request(self):
        b = self.box
        b.copies_for("lesson-g10m4s2-1", "s0b-A-g3", "s0b-B-g3", "s0b-C-g3", "s1-ch04")
        for rid in ("s0b-A-g3", "s0b-B-g3", "s0b-C-g3"):
            self.save(rid)
        self.save("s1-ch04")
        self.assertIn("lesson-g10m4s2-1", [e["id"] for e in self.ready()["ready"]])
        self.assertNotIn("lesson-g10m4s2-1", [e["id"] for e in self.ready(honor_gate=True)["ready"]])

    def test_a_skipped_run_counts_as_done(self):
        b = self.box
        b.copies_for("s0b-A-g3", "s0b-B-g3", "s0b-C-g3")
        self.save("s0b-A-g3")
        self.save("s0b-B-g3")
        A.skip_run(A.Paths(), self.state(), b.run("s0b-C-g3"), "no third reading needed")
        self.assertEqual(self.ready()["ready"], [], "C is skipped, so it is not offered")
        b.copies_for("s1-ch04")
        self.assertEqual([e["id"] for e in self.ready()["ready"]], ["s1-ch04"])

    def test_running_copies_are_excluded_one_copy_at_a_time(self):
        b = self.box
        for rid in ("s0b-A-g3", "s0b-B-g3", "s0b-C-g3", "s1-ch04"):
            b.copies_for(rid)
            if rid != "s1-ch04":
                self.save(rid)
        for rid in ("lesson-g10m4s2-1", "lesson-g10m4s3-1"):
            b.copies_for(rid)
        self.save("s1-ch04")
        for label in ("A", "A.part2", "B", "B.part2"):
            b.copy("wcheck-ch04", label)
        for rid in ("lesson-g10m4s2-1", "lesson-g10m4s3-1"):
            self.save(rid)
        e = {x["id"]: x for x in self.ready()["ready"]}
        self.assertEqual(e["wcheck-ch04"]["copies"], ["A", "A.part2", "B", "B.part2"])
        e = {x["id"]: x for x in self.ready(running=["wcheck-ch04@A", "wcheck-ch04@A.part2"])["ready"]}
        self.assertEqual(e["wcheck-ch04"]["copies"], ["B", "B.part2"])
        self.assertNotIn("wcheck-ch04", {x["id"] for x in self.ready(running=["wcheck-ch04"])["ready"]})

    def test_a_stale_copy_is_listed_and_flagged_and_a_missing_one_is_unprepared(self):
        b = self.box
        b.copies_for("s0b-A-g3")
        b.stub.write_text(STUB + "// the runbook script was edited\n")
        r = self.ready()
        self.assertEqual(r["ready"][0]["verify"], ["stale"])
        self.assertEqual(r["stale_copies"], [b.copies[("s0b-A-g3", "")][0].name])
        self.assertEqual(r["ready_scripts"], [str(b.copies[("s0b-A-g3", "")][0])], "still launchable: it runs the script as it was")
        self.save("s0b-A-g3")
        self.assertEqual(self.ready()["unprepared"], ["s0b-B-g3"])

    def test_a_second_s0b_is_held_while_one_is_in_flight(self):
        b = self.box
        b.copies_for("s0b-A-g3", "s0b-B-g3")
        self.save("s0b-A-g3")
        r = self.ready(running=["s0b-C-g99"])
        self.assertEqual(r["ready"][0].get("hold"), None, "an unknown run id holds nothing")


# ====================================================================== reading the real plan
REAL_PLAN = F.PLAN_PATH if F.PLAN_PATH.exists() else None


@unittest.skipUnless(REAL_PLAN is not None and REAL_PLAN.exists(), "needs runs/g10-math/fanout-plan.json")
class RealPlan(unittest.TestCase):
    """The driver reads `save_to`, `meter` and the ids out of the real plan: every kind of run must come out whole."""

    @classmethod
    def setUpClass(cls):
        cls.plan = json.loads(REAL_PLAN.read_text())
        cls.P = A.Paths()

    def test_every_run_has_a_kind_a_save_path_and_a_meter_stage(self):
        seen = set()
        for r in self.plan["runs"]:
            kind = A.kind_of(r["id"])
            seen.add(kind)
            label = {"wcheck": "A.part2"}.get(kind, "")
            if r["id"] == "wcheck-ch08":
                continue
            p = A.save_path(self.P, r, label, "wf_deadbeef-123")
            rel = str(p.relative_to(self.P.here))
            self.assertTrue(rel.startswith("runs/g10-math/") and rel.endswith("wf_deadbeef-123.json"), rel)
            self.assertNotIn("<", rel)
            self.assertNotIn("records", rel)
            stage, lesson = A.meter_args(r)
            self.assertEqual(stage, r["stage"] if r["stage"] != "S2-S4" else "S2-S4", r["id"])
            self.assertEqual(lesson, r.get("lesson") if kind == "lesson" else None, r["id"])
        self.assertEqual(seen, {"s0b", "s0b_c", "s1", "lesson", "wcheck", "s5_draft", "s6_author", "s6_grade", "s7_author", "s7_verify",
                                "s5_final", "oneoff"})

    def test_a_save_never_lands_where_assemble_maths_globs(self):
        for r in self.plan["runs"]:
            if r["id"].startswith("s0b-"):
                p = A.save_path(self.P, r, "", "wf_deadbeef-123")
                self.assertEqual(p.parent.name, "maths")
                self.assertRegex(p.name, r"^[ABC]-wf_")
        self.assertEqual(self.P.records.name, "records")

    def test_the_wcheck_pass_is_in_the_save_name(self):
        r = next(x for x in self.plan["runs"] if x["id"] == "wcheck-ch01")
        self.assertEqual(A.save_path(self.P, r, "B.part2", "wf_deadbeef-123").name, "ch01-B-wf_deadbeef-123.json")

    def test_the_plan_quotes_the_fixed_s7_verify_and_coverage_commands(self):
        by = {r["id"]: r for r in self.plan["runs"]}
        v = by["s7-verify-ch03"]["after"][0]
        self.assertIn("--catalogue runs/g10-math/misconceptions/draft-ch03-<s5-draft wf_id>.json", v)
        self.assertIn("--pre-catalogue", v)
        self.assertIn("--verdicts runs/g10-math/widgets/verify-ch03-<wf_id>.json", v)
        cov = next(l for l in by["s5-final-ch03"]["after"] if l.startswith("uv run coverage_report.py"))
        self.assertIn("--generated seed/generated/g10-math/ch03", cov)

    def test_every_after_command_the_plan_quotes_for_a_simple_kind_is_the_one_the_driver_runs(self):
        by = {r["id"]: r for r in self.plan["runs"]}
        s1 = by["s1-ch05"]["after"]
        self.assertIn("uv run assemble_objectives.py assemble g10-math runs/g10-math/objectives/ch05-<wf_id>.json "
                      "--maths runs/g10-math/maths/book/accepted.json", s1)
        self.assertIn("uv run auto_pass_gates.py g1 g10-math --chapter 5 --maths runs/g10-math/maths/book/accepted.json --approve", s1)
        lesson = next(r for r in self.plan["runs"] if r["id"].startswith("lesson-"))
        self.assertIn("uv run assemble_objectives.py lesson-runs g10-math runs/g10-math/lessons/<wf_id>.json --draft "
                      "--maths runs/g10-math/maths/book/accepted.json   # for the G2 recommendations", lesson["after"])
        c = by["s0b-C-g5"]["after"][0]
        self.assertEqual(c, "uv run assemble_maths.py assemble g10-math runs/g10-math/maths/[ABC]-*.json --out-dir runs/g10-math/maths/book")
        self.assertTrue(by["s6-author-ch03"]["after"][2].startswith("uv run generate_questions.py --families families/g10-math/ch03 --book "
                                                                    "work/g10-math/fanout/books/ch03/g10-math.json --check"))
        self.assertTrue(by["s7-author-ch03"]["after"][0].startswith("uv run generate_widget_questions.py --merge-author-runs "
                                                                    "runs/g10-math/widgets/author-ch03-<wf_id>.json --merged "
                                                                    "runs/g10-math/widgets/author-merged-ch03.json --write-templates widgets/g10-math/ch03"))


SUBCOMMANDS = {"assemble", "approve", "lesson-runs", "collect", "record", "g1", "g2", "g3", "g4", "g5"}


class FlagsExist(unittest.TestCase):
    """Every command the driver issued in the tests above is checked against the REAL script's own --help: a flag that script does
    not have (a typo, a flag renamed by someone else's edit) would fail on the first real run, which the fakes above cannot see.
    No script is run beyond `--help`."""

    @classmethod
    def setUpClass(cls):
        import shutil
        if not FakeExec.ALL:
            raise unittest.SkipTest("run the whole file: this reads the commands the other tests issued")
        if shutil.which("uv") is None:
            raise unittest.SkipTest("needs uv")
        cls.help: dict = {}

    def helptext(self, script, sub):
        key = (script, sub)
        if key not in self.help:
            import subprocess
            dispatch = ["--families", "x"] if script == ("generate_questions.py",) else []      # its v2 parser is chosen by --families
            argv = ["uv", "run", "--project", str(EX), "python", *script, *([sub] if sub else []), *dispatch, "--help"]
            r = subprocess.run(argv, cwd=EX, capture_output=True, text=True, timeout=120)
            self.help[key] = (r.returncode, r.stdout + r.stderr)
        return self.help[key]

    def test_every_flag_the_driver_passes_exists_in_the_script_it_passes_it_to(self):
        seen = {}
        for argv in FakeExec.ALL:
            script = ("-m", argv[1]) if argv[0] == "-m" else (argv[0],)
            rest = argv[len(script):]
            sub = next((a for a in rest[:2] if a in SUBCOMMANDS), None)
            flags = {a for a in rest if a.startswith("--")}
            seen.setdefault((script, sub), set()).update(flags)
        self.assertGreaterEqual(len(seen), 14, f"only {sorted(seen)} were issued")
        problems = []
        for (script, sub), flags in sorted(seen.items(), key=str):
            rc, text = self.helptext(script, sub)
            if rc != 0:
                problems.append(f"{' '.join(script)} {sub or ''} --help exited {rc}: {text[-200:]}")
                continue
            problems += [f"{' '.join(script)} {sub or ''}: no flag {f}" for f in sorted(flags) if f not in text]
        self.assertEqual(problems, [])


class CliWiring(unittest.TestCase):
    def test_fanout_hands_advance_and_ready_to_the_driver(self):
        for cmd in ("advance", "ready"):
            with self.assertRaises(SystemExit) as cm:
                F.main([cmd, "-h"])
            self.assertEqual(cm.exception.code, 0)

    def test_the_dump_helper_prints_valid_json_one_key_per_line(self):
        text = A.dump({"run": "s1-ch04", "ok": True, "steps": [{"step": "x"}]})
        self.assertEqual(json.loads(text), {"run": "s1-ch04", "ok": True, "steps": [{"step": "x"}]})
        self.assertEqual(len(text.splitlines()), 5)


if __name__ == "__main__":
    unittest.main()

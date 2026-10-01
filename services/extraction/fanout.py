"""The Grade 10 full-book fan-out (Samuel's answer 37e, 2026-10-01): inventory, run plan, run preparation.

    uv run fanout.py inventory                   # per chapter: lessons, items, worked examples, maths, figures
    uv run fanout.py plan                        # runs/g10-math/fanout-plan.json: every run, in order, with costs
    uv run fanout.py prepare <run-id> [...]      # build that run's packet and its embedded copy (if its inputs exist)
    uv run fanout.py prepare --ready             # every run whose inputs exist and that has no copy yet
    uv run fanout.py status                      # which runs are prepared, saved, metered
    uv run fanout.py config <chapter>            # the per-chapter book config S5–S7 read (bundles: course + chapter)
    uv run fanout.py write-specs <S6 author run.json> --into families/g10-math/chNN    # the specs the author wrote

WHAT IT IS. Chapter 8 was the pilot (docs/WIP-g10-pilot/). Samuel approved running the line over the other
13 chapters (answer 37e), with gates G1–G4 passing on the AI checks' recommendation into the console backlog
(37c) and the book's own picture standing in for a figure no native type can draw (37d). This file is the
deterministic part of that: what each chapter holds, the ordered list of Workflow runs with their inputs,
expected agents and cost, and the packets and embedded copies the main session launches. It calls no model
and launches nothing: the main session runs each copy with `Workflow({scriptPath})` and NO args, saves the
return value where the plan says, and meters it.

WHAT IT NEVER TOUCHES. Chapter 8's outputs: the pilot's S0b assembly (runs/g10-math/maths/{accepted,queue,
summary}.json — the full book's goes to runs/g10-math/maths/book/), the pilot seed and config under
work/g10-math/pilot/, seed/generated/g10-math/* (the chapter's catalogue and bundles; new chapters write
seed/generated/g10-math/chNN/), families/g10-math/*.json and widgets/g10-math/*.json (new chapters write
their chNN/ subdirectory), runs/g10-math/g2.json and assembly-report.json, the scratch database
ainext_pilot_g10_ch08. A run is never re-run on Chapter 8 except the step-level working checker (answer 30
says "re-run on Chapter 8 too") and the one S6 run for lo:g10m8s1-1-1 the main session asked for.

LAYOUT (all under services/extraction/; work/ is gitignored):
    work/g10-math/packets/fanout/<run>/              the run's shards (packet by reference) or S0b batch files
    work/g10-math/packets/embedded/fanout/NNN-<run>.workflow.js   the copy to launch (NNN = plan order)
    work/g10-math/fanout/books/chNN/g10-math.json    per-chapter config (bundles: course + chapter) for S5–S7
    work/g10-math/fanout/seed/chNN/                  per-chapter seed dir for S5 (--seed-dir)
    runs/g10-math/maths/book/                        the full book's S0b assembly (accepted, queue, summary)
    runs/g10-math/fanout/inventory.json, runs/g10-math/fanout-plan.json
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))

BOOK = "g10-math"
PILOT_CH = 8
CHAPTERS = list(range(1, 15))
FANOUT_CHS = [c for c in CHAPTERS if c != PILOT_CH]
# S0b: one run per pass per group, at batch 50 (the pilot's calibration: half the cost of batch 25 at the
# same quality), the passes ONE AT A TIME (the pilot lost ≈ $36 running passes and other runs together).
# A group is ≤ ~18 batches: one wave of the Workflow's concurrent agents, ≈ 15–20 minutes.
S0B_GROUPS = [("g1", [1]), ("g2", [2, 3]), ("g3", [4]), ("g4", [5]), ("g5", [6]), ("g6", [7, 9]),
              ("g7", [10, 11, 12]), ("g8", [13, 14])]
BATCH = 50
WORK = HERE / "work" / BOOK
PACKETS = WORK / "packets" / "fanout"
EMBED = WORK / "packets" / "embedded" / "fanout"
FAN = WORK / "fanout"
RUNS = HERE / "runs" / BOOK
MATHS_BOOK = RUNS / "maths" / "book"
PLAN_PATH = RUNS / "fanout-plan.json"
INVENTORY_PATH = RUNS / "fanout" / "inventory.json"
FANOUT_DB = "ainext_fanout_g10"
DSN = f"host=127.0.0.1 port=5432 dbname={FANOUT_DB}"
PILOT_CONFIG = WORK / "pilot" / "books" / f"{BOOK}.json"
PILOT_SEED = WORK / "pilot" / "seed"
S111 = "lo:g10m8s1-1-1"

# ---------------------------------------------------------------- the pilot's measured unit costs
# API-equivalent USD (runs/g10-math/cost.jsonl; docs/WIP-g10-pilot/pilot-report.md). (low, high).
UNIT_COST = {
    "s0b_image_pass": (0.024, 0.035),   # batch 50, useful spend: A50 calibration $2.43 / 100 images; high +45%
    "s0b_c_share": 0.036,               # share of images the third reading reads (Chapter 8: 15 of 422)
    "s0b_c_image": (0.064, 0.09),       # pass C: $0.96 / 15 images
    "s1_lesson": (1.30, 1.80),          # $7.16 / 5 lessons (s1-v5); high: later chapters' linkers read prior objectives
    "s2s4_item": (0.056, 0.10),         # 5 clean lesson-v4 runs $11.22 / 201 items; high: + resumes and S4 re-runs
    "sw_solution": (0.03, 0.05),        # answer 30 (≈ 1.5–2.5× the blind re-solve's $0.017 per item)
    "s5_objective": (0.96, 1.32),       # draft + final $12.54 / 13 clean; $17.13 / 13 with the superseded draft
    "s6_objective": (0.66, 0.90),       # author + grade + revise $8.63 / 13
    "s7_objective": (0.36, 0.50),       # author + verify $4.66 / 13, + the re-authors ≈ $1.5
}
OBJECTIVES_PER_LESSON = 2.6             # Chapter 8: 13 objectives in 5 lessons
# minutes, for the wall-clock estimate (the pilot's run records: duration_ms)
MINUTES = {"s0b_wave": 18, "s0b_c": 8, "s1_base": 8, "s1_lesson": 1.0, "lesson_base": 1.5, "lesson_item": 0.22,
           "lesson_min": 5, "sw_wave": 2.0, "s5-draft": 13, "s6-author": 8, "s6-grade": 5, "s7-author": 9,
           "s7-verify": 5, "s5-final": 20, "s6-author-s111": 6, "between": 3}
CONCURRENT_AGENTS = 16                  # the Workflow tool's per-run cap


class NotReady(Exception):
    """A run whose inputs do not exist yet (an earlier run, gate or deterministic step comes first)."""


def _book():
    import book_config
    return book_config.load_book(BOOK)


def rel(p: Path | str) -> str:
    try:
        return str(Path(p).resolve().relative_to(HERE))
    except ValueError:
        return str(p)


def ch_tag(ch: int) -> str:
    return f"ch{ch:02d}"


def group_of(ch: int) -> str | None:
    return next((g for g, chs in S0B_GROUPS if ch in chs), None)


# ================================================================ inventory
def _blocks() -> list[dict]:
    with open(WORK / "blocks.jsonl", encoding="utf-8") as fh:
        return [json.loads(l) for l in fh if l.strip()]


def s0b_partition() -> dict:
    """The images still to transcribe (not proved by hash, not accepted by Chapter 8's runs, not teacher-only),
    each assigned to the FIRST chapter whose blocks use it, so no image is read twice by one pass."""
    import assemble_maths as am
    eqs = json.loads((WORK / "equations.json").read_text())["images"]
    rec = json.loads((WORK / "maths" / "recovered.json").read_text())["accepted"]
    pilot_acc = json.loads((RUNS / "maths" / "accepted.json").read_text())
    ch_of = {b["id"]: b.get("chapter") for b in _blocks()}
    queue = [x for x in am.vision_queue(eqs, rec) if x["md5"] not in pilot_acc]
    first: dict[int, list[dict]] = collections.defaultdict(list)
    for x in queue:
        chs = sorted({ch_of.get(b) for b in eqs[x["md5"]]["blocks"]} - {None})
        first[chs[0]].append(x)
    return {"queue": queue, "by_chapter": dict(first), "eqs": eqs, "recovered": rec, "pilot_accepted": pilot_acc,
            "chapter_of_block": ch_of}


def inventory() -> dict:
    m = json.loads((HERE / "manifest" / "g10-math-american.json").read_text())
    part = s0b_partition()
    eqs, ch_of = part["eqs"], part["chapter_of_block"]
    figs = json.loads((WORK / "figures.json").read_text())
    blocks = _blocks()
    by_type = collections.defaultdict(collections.Counter)
    for b in blocks:
        by_type[b.get("chapter")][b["type"]] += 1
    imgs_by_ch: dict[int, set] = collections.defaultdict(set)
    for h, r in eqs.items():
        for c in {ch_of.get(b) for b in r.get("blocks") or []} - {None}:
            imgs_by_ch[c].add(h)
    fig_by_ch: dict[int, collections.Counter] = collections.defaultdict(collections.Counter)
    for src, f in figs.items():
        for c in {ch_of.get(b) for b in f.get("blocks") or []} - {None}:
            for ctx, n in (f.get("contexts") or {}).items():
                fig_by_ch[c][ctx] += 1
    out = []
    for mod in m["modules"]:
        ch = int(mod["chapter"])
        les = mod["lessons"]
        eoc = mod.get("end_of_chapter_exercise") or {}
        # a split section's shared set (6-6: 41 items S1's mappers distribute over its three parts)
        to_map = sum(e.get("items", 0) for s in mod.get("section_exercises_to_map") or [] for e in s.get("exercises") or [])
        lesson_items = sum(e["items"] for l in les for e in l["exercises"])
        wes = sum(len(l["worked_examples"]) for l in les)
        printed = sum((e.get("printed_answers") or {}).get("items_with_printed_answer", 0) for l in les
                      for e in l["exercises"]) + (eoc.get("printed_answers") or {}).get("items_with_printed_answer", 0)
        lessons = []
        for l in les:
            prov = l.get("book_provenance") or {}
            kind = "chapter_intro" if prov.get("chapter_intro") else ("part" if prov.get("part") else
                                                                      ("merged" if len(prov.get("sections") or []) > 1 else "section"))
            lessons.append({"slug": l["id"], "title": l["title"], "kind": kind,
                            "sections": [s["number"] for s in prov.get("sections") or []],
                            "worked_examples": len(l["worked_examples"]),
                            "exercise_items": sum(e["items"] for e in l["exercises"]),
                            "figures": (l.get("figures") or {}).get("book", 0),
                            "maths_images": sum((l.get("maths_images") or {}).values())})
        imgs = imgs_by_ch[ch]
        to_read = part["by_chapter"].get(ch, [])
        n_obj = round(OBJECTIVES_PER_LESSON * len(les))
        items_total = lesson_items + eoc.get("items", 0) + to_map
        out.append({
            "chapter": ch, "title": mod["title"], "module": mod["id"], "s0b_group": group_of(ch),
            "lessons": len(les), "lesson_slugs": [l["id"] for l in les],
            "numbered_sections": sorted({s for l in lessons for s in l["sections"]}, key=lambda s: [int(x) for x in s.split(".")]),
            "worked_examples": wes, "exercise_items_in_lessons": lesson_items,
            "end_of_chapter_items": eoc.get("items", 0), "shared_section_items_to_map": to_map,
            "items_total": items_total, "items_with_printed_answer": printed,
            "solutions": items_total + wes,
            "figures": {"book": sum(v for k, v in fig_by_ch[ch].items() if not k.endswith("solution")),
                        "in_epub_solutions": sum(v for k, v in fig_by_ch[ch].items() if k.endswith("solution")),
                        "by_context": dict(fig_by_ch[ch])},
            "maths_images": {"unique": len(imgs),
                             "proved_by_hash": sum(1 for h in imgs if h in part["recovered"]),
                             "accepted_by_chapter_8": sum(1 for h in imgs if h in part["pilot_accepted"]
                                                          and h not in part["recovered"]),
                             "teacher_only": sum(1 for h in imgs if eqs[h]["class"] == "teacher_only"),
                             "to_read_first_here": len(to_read),
                             "tall_derivations_to_read": sum(1 for x in to_read if x["h"] > 60)},
            "teacher_only_blocks": by_type[ch]["teacher_only"],
            "objectives_estimate": n_obj if ch != PILOT_CH else 13,
            "lessons_detail": lessons,
            "status": "pilot — done (S0b–S7; G1, G2 passed)" if ch == PILOT_CH else "to fan out",
        })
    return {"format": "ainext.fanout-inventory/1", "book": BOOK,
            "sources": {"blocks": rel(WORK / "blocks.jsonl"), "equations": rel(WORK / "equations.json"),
                        "figures": rel(WORK / "figures.json"), "manifest": "manifest/g10-math-american.json",
                        "epub_index": rel(WORK / "epub_index.json")},
            "s0b": {"to_read": len(part["queue"]), "batch": BATCH,
                    "groups": [{"group": g, "chapters": chs, "images": sum(len(part["by_chapter"].get(c, [])) for c in chs),
                                "batches": math.ceil(sum(len(part["by_chapter"].get(c, [])) for c in chs) / BATCH)}
                               for g, chs in S0B_GROUPS]},
            "chapters": out,
            "totals": {k: sum(c[k] for c in out) for k in ("lessons", "worked_examples", "items_total", "solutions",
                                                            "objectives_estimate")}}


# ================================================================ the plan
def _cost(unit: str, n: float) -> list[float]:
    lo, hi = UNIT_COST[unit]
    return [round(lo * n, 2), round(hi * n, 2)]


def _meter(stage: str, lesson: str | None = None) -> str:
    return (f"uv run meter_run.py record --book {BOOK} --stage {stage} --run <wf_id>"
            + (f" --lesson {lesson}" if lesson else "") + "   # add --resumed when it was a resume")


def build_runs(inv: dict) -> list[dict]:
    """Every run of the fan-out, unordered; `schedule` orders them."""
    chs = {c["chapter"]: c for c in inv["chapters"]}
    runs: list[dict] = []

    def add(**r):
        r.setdefault("depends_on", [])
        r.setdefault("checkpoint", None)
        runs.append(r)

    # --- 0. the two Chapter 8 runs the main session asked for first ---------------------------------------
    add(id="s6-author-ch08-s111", stage="S6", chapter=8, workflow="families.workflow.js (mode author, s6-v5)",
        what="S6 family authoring for lo:g10m8s1-1-1 ('Drawing figures from coordinates') only — the last empty "
             "objective of Chapter 8. Its six items are drawings G2 made teaching-only, so the packet lists them "
             "(with the book's drawn answers) as the author's models and parent candidates.",
        agents=1, cost=[0.6, 1.5], minutes=MINUTES["s6-author-s111"], priority=0,
        save_to="runs/g10-math/families/author-s111-<wf_id>.json", meter=_meter("S6"),
        after=["uv run fanout.py write-specs runs/g10-math/families/author-s111-<wf_id>.json "
               "--into work/g10-math/fanout/families-s111     # staging: never families/g10-math/ until it is graded",
               "uv run generate_questions.py --families work/g10-math/fanout/families-s111 --book "
               "work/g10-math/pilot/books/g10-math.json --check",
               "# then grade it alone (s6-v5 grade path): generate_questions.py --families work/g10-math/fanout/families-s111 "
               "--book work/g10-math/pilot/books/g10-math.json --grading-set work/g10-math/fanout/s111-grading-set.json "
               "--grade-args work/g10-math/fanout/s111-grade.json --by-ref work/g10-math/packets/fanout/s6-grade-ch08-s111 "
               "→ embed_workflow.py embed --script runbook/families.workflow.js --args work/g10-math/fanout/s111-grade.json "
               "--out work/g10-math/packets/embedded/fanout/000b-s6-grade-ch08-s111.workflow.js (≈ $0.2–0.4)",
               "# BLOCKED at load (see the plan's decisions): a family's parent_question_id must be a question row "
               "(FR-1101; db/schema.sql questions.parent_question_id REFERENCES questions(id)) and s1-1-1 has none"],
        checkpoint="Did the author write a family, or report it infeasible again (as wf_41c0663f-36d did with an empty "
                   "packet)? A family's parent is one of the teaching items: it cannot load until the parent decision "
                   "is taken.")
    add(id="wcheck-ch08", stage="SW", chapter=8, workflow="working-check.workflow.js (sw-v1)",
        what="The step-level working checker on Chapter 8's 198 served solutions (answer 30: re-run on Chapter 8). "
             "Reads the pilot seed; writes nothing to it.",
        agents=None, cost=None, minutes=None, priority=1,
        save_to="runs/g10-math/working-check/ch08-<wf_id>.json", meter=_meter("SW"),
        after=["uv run working_check.py collect --args work/g10-math/packets/fanout/wcheck-ch08.args.json "
               "--runs runs/g10-math/working-check/ch08-<wf_id>.json --out runs/g10-math/working-check/ch08.flags.json",
               "# every flag → the console backlog ('working step flagged'); nothing is corrected"],
        checkpoint="Calibrate before the other chapters: read every flag. The free pre-check already flags 3 real "
                   "book typos the pilot's G2 missed (Ex8-6:42a '\\sqrt{5^2(-1)^2}', Ex8-6:38d, Ex8-6:42d). If the "
                   "agent's false-flag rate is high, fix the prompt (sw-v2) before wcheck-ch01.")
    # wcheck-ch08's size from the pilot seed
    import working_check as W
    sols = W.solutions_from_bundle(json.loads((PILOT_SEED / "g10m-c08.json").read_text()))
    n8 = sum(1 for s in sols if W.has_working(s))
    runs[-1].update(agents=n8, cost=_cost("sw_solution", n8), minutes=MINUTES["sw_wave"] * math.ceil(n8 / CONCURRENT_AGENTS))

    # --- 1. S0b: per group, pass A, pass B, the third reading C ---------------------------------------------
    prev = None
    s0b_by_g = {g["group"]: g for g in inv["s0b"]["groups"]}
    for g, gchs in S0B_GROUPS:
        n = s0b_by_g[g]["images"]
        b = s0b_by_g[g]["batches"]
        tag = "-".join(ch_tag(c) for c in gchs)
        for p in ("A", "B"):
            rid = f"s0b-{p}-{g}"
            add(id=rid, stage="S0b", chapters=gchs, workflow="transcribe-maths.workflow.js",
                what=f"S0b pass {p} over {n} images first used in {tag} (batch {BATCH}, {b} batches)",
                agents=b, cost=_cost("s0b_image_pass", n), minutes=MINUTES["s0b_wave"] * math.ceil(b / CONCURRENT_AGENTS),
                priority=2, depends_on=[prev] if prev else [], s0b=True,
                save_to=f"runs/g10-math/maths/{p}-<wf_id>.json", meter=_meter("S0b"))
            prev = rid
        nc = max(1, round(n * UNIT_COST["s0b_c_share"]))
        add(id=f"s0b-C-{g}", stage="S0b", chapters=gchs, workflow="transcribe-maths.workflow.js",
            what=f"S0b third reading (pass C) of the {tag} images passes A and B did not agree on (≈ {nc}; prepared "
                 "after both are saved; skipped when there are none)",
            agents=math.ceil(nc / BATCH), cost=_cost("s0b_c_image", nc), minutes=MINUTES["s0b_c"], priority=2,
            depends_on=[f"s0b-A-{g}", f"s0b-B-{g}"], s0b=True,
            before=["uv run assemble_maths.py assemble g10-math runs/g10-math/maths/*.json --out-dir runs/g10-math/maths/book"],
            save_to="runs/g10-math/maths/C-<wf_id>.json", meter=_meter("S0b"),
            after=["uv run assemble_maths.py assemble g10-math runs/g10-math/maths/*.json --out-dir runs/g10-math/maths/book",
                   f"# summary.json by_chapter: {', '.join(ch_tag(c) for c in gchs)} must show unresolved 0; anything "
                   "queued goes to G0b (a human; it is not a gate 37c auto-passes — nothing is guessed, FR-4407)"],
            checkpoint="first group only: per-image cost against $0.024, hash-claim and agreement rates" if g == "g1" else None)
        prev = f"s0b-C-{g}"

    # --- 2. per chapter: S1, the lessons, the working check, S5–S7 ---------------------------------------
    order = FANOUT_CHS
    for i, ch in enumerate(order):
        c = chs[ch]
        t = ch_tag(ch)
        nobj = c["objectives_estimate"]
        pool = c["end_of_chapter_items"] + c["shared_section_items_to_map"]
        s1_deps = [f"s0b-C-{c['s0b_group']}"] + ([f"s1-{ch_tag(order[i - 1])}"] if i else [])
        add(id=f"s1-{t}", stage="S1", chapter=ch, workflow="objectives.workflow.js (s1-v5, prior objectives by reference)",
            what=f"S1 objectives for chapter {ch} ({c['lessons']} lesson(s), {pool} end-of-chapter/shared items to map; "
                 f"links may name the {'earlier chapters' if i else 'no earlier'} chapters' approved objectives)",
            agents=4 * c["lessons"] + 2 * math.ceil(pool / 60) + 2, cost=_cost("s1_lesson", c["lessons"]),
            minutes=MINUTES["s1_base"] + MINUTES["s1_lesson"] * c["lessons"], priority=1, depends_on=s1_deps,
            save_to=f"runs/g10-math/objectives/{t}-<wf_id>.json", meter=_meter("S1"),
            after=[f"uv run assemble_objectives.py assemble g10-math runs/g10-math/objectives/{t}-<wf_id>.json "
                   "--maths runs/g10-math/maths/book/accepted.json",
                   f"# G1 AUTO-PASS (answer 37c): verdicts for every owed decision from the AI recommendation → "
                   f"runs/g10-math/objectives/g1-{t}.auto.json (the gates' auto-pass mode — another data-engineer's "
                   "work; until it lands, the main session writes them as it did for Chapter 8), then:",
                   f"uv run assemble_objectives.py approve g10-math --chapter {ch} --maths runs/g10-math/maths/book/accepted.json "
                   f"--by \"AI auto-pass (answer 37c) — awaiting human review\" --verdicts runs/g10-math/objectives/g1-{t}.auto.json",
                   "# every G1 decision → the console backlog"],
            checkpoint="chapter 1: objectives per lesson, decisions owed, and that the auto-pass verdicts cover them"
                       if i == 0 else None)
        lesson_ids = []
        for l in c["lessons_detail"]:
            n_items = l["exercise_items"] + l["worked_examples"]
            # the end-of-chapter items S1 maps into a lesson are not known yet: spread them by lesson share
            share = (l["exercise_items"] + l["worked_examples"]) / max(1, c["exercise_items_in_lessons"] + c["worked_examples"])
            n_items = round(n_items + share * pool)
            rid = f"lesson-{l['slug']}"
            lesson_ids.append(rid)
            add(id=rid, stage="S2-S4", chapter=ch, lesson=l["slug"], workflow="lesson.workflow.js (lesson-v7, collect-5)",
                what=f"S2–S4 for {l['slug']} '{l['title']}' (≈ {n_items} items incl. its share of the end-of-chapter set; "
                     f"{l['figures']} book figure(s))",
                agents=round(7 + n_items / 9), cost=_cost("s2s4_item", n_items),
                minutes=max(MINUTES["lesson_min"], MINUTES["lesson_base"] + MINUTES["lesson_item"] * n_items),
                priority=3, depends_on=[f"s1-{t}"], items=n_items,
                save_to="runs/g10-math/lessons/<wf_id>.json", meter=_meter("S2-S4", l["slug"]),
                after=[f"uv run assemble_objectives.py lesson-runs g10-math runs/g10-math/lessons/<wf_id>.json --draft "
                       "--maths runs/g10-math/maths/book/accepted.json   # for the G2 recommendations",
                       f"# G2 AUTO-PASS (37c): the recommendation per disputed / no-printed-answer item → "
                       f"runs/g10-math/g2-{t}.json (never the pilot's g2.json); every verdict → the console backlog",
                       f"uv run assemble_objectives.py lesson-runs g10-math runs/g10-math/lessons/<wf_id>.json "
                       f"--g2 runs/g10-math/g2-{t}.json"],
                checkpoint=("first lesson of the book: script size, disputed rate, cost per item against "
                            "$0.056–0.10") if (i == 0 and len(lesson_ids) == 1) else None)
        assemble = [f"uv run assemble_lesson_bundle.py --book g10-math --chapter {ch} --report runs/g10-math/fanout/assembly-{t}.json",
                    "#   → seed/g10-math/g10m-course.json, seed/g10-math/g10m-c%02d.json, seed/content/<slug>.json "
                    "(answer 37d: the book picture stands in where no native figure exists — the assembly's figure step, "
                    "another data-engineer's work)" % ch,
                    f"uv run fanout.py config {ch}",
                    f"uv run load_seed.py seed/g10-math/g10m-course.json seed/g10-math/g10m-c{ch:02d}.json --validate-only",
                    f"AINEXT_DB_DSN=\"{DSN}\" AINEXT_ENVIRONMENT=mvp1 uv run load_seed.py --all --course course:us-g10-math-en "
                    f"--book work/g10-math/fanout/books/{t}/g10-math.json   # scratch DB only (127.0.0.1)",
                    f"AINEXT_DB_DSN=\"{DSN}\" AINEXT_ENVIRONMENT=mvp1 uv run apply_review_verdicts.py --g2 runs/g10-math/g2-{t}.json "
                    f"--book g10-math --runs runs/g10-math/lesson"]
        add(id=f"wcheck-{t}", stage="SW", chapter=ch, workflow="working-check.workflow.js (sw-v1)",
            what=f"the step-level working checker on chapter {ch}'s ≈ {c['solutions']} solutions (one agent each)",
            agents=c["solutions"], cost=_cost("sw_solution", c["solutions"]),
            minutes=MINUTES["sw_wave"] * math.ceil(c["solutions"] / CONCURRENT_AGENTS), priority=5,
            depends_on=lesson_ids + ["wcheck-ch08"], before=assemble,
            save_to=f"runs/g10-math/working-check/{t}-<wf_id>.json", meter=_meter("SW"),
            after=[f"uv run working_check.py collect --args work/g10-math/packets/fanout/wcheck-{t}.args.json "
                   f"--runs runs/g10-math/working-check/{t}-<wf_id>.json --out runs/g10-math/working-check/{t}.flags.json",
                   "# every flag → the console backlog; nothing is corrected"])
        fam = f"families/g10-math/{t}"
        wid = f"widgets/g10-math/{t}"
        cfg = f"work/g10-math/fanout/books/{t}/g10-math.json"
        gen = f"seed/generated/g10-math/{t}"
        add(id=f"s5-draft-{t}", stage="S5", chapter=ch, workflow="misconceptions.workflow.js (s5-v5, draft)",
            what=f"S5 draft misconceptions for chapter {ch}'s ≈ {nobj} objectives",
            agents=nobj, cost=[round(x * 0.45, 2) for x in _cost("s5_objective", nobj)], minutes=MINUTES["s5-draft"],
            priority=4, depends_on=lesson_ids, before=assemble,
            save_to=f"runs/g10-math/misconceptions/draft-{t}-<wf_id>.json", meter=_meter("S5"))
        add(id=f"s6-author-{t}", stage="S6", chapter=ch, workflow="families.workflow.js (s6-v5, author)",
            what=f"S6 family authoring for chapter {ch}'s objectives below the tier floor",
            agents=round(0.8 * nobj), cost=[round(x * 0.45, 2) for x in _cost("s6_objective", nobj)],
            minutes=MINUTES["s6-author"], priority=4, depends_on=[f"s5-draft-{t}"],
            save_to=f"runs/g10-math/families/author-{t}-<wf_id>.json", meter=_meter("S6"),
            after=[f"uv run fanout.py write-specs runs/g10-math/families/author-{t}-<wf_id>.json --into {fam}",
                   f"uv run python -m families.normalise {fam}/*.json   # the two mechanical refusals only (recorded)",
                   f"uv run generate_questions.py --families {fam} --book {cfg} --check",
                   "# a spec --check still refuses: move it aside as _held--<file>.json; re-author it with --revise-args "
                   "(a contingency run, ≈ $0.7 each; not in the estimate)"])
        add(id=f"s6-grade-{t}", stage="S6", chapter=ch, workflow="families.workflow.js (s6-v5, grade; parts if > 15 KB)",
            what=f"S6 blind grading of chapter {ch}'s families (blind solver per sampled instance + judge); "
                 "skipped when the author wrote no family",
            agents=round(1.8 * nobj), cost=[round(x * 0.55, 2) for x in _cost("s6_objective", nobj)],
            minutes=MINUTES["s6-grade"], priority=4, depends_on=[f"s6-author-{t}"],
            save_to=f"runs/g10-math/families/grade-{t}-<wf_id>.json   (one file per part)", meter=_meter("S6"),
            after=[f"uv run generate_questions.py --families {fam} --book {cfg} --grades runs/g10-math/families/grade-{t}-*.json "
                   f"--s5-distractors runs/g10-math/families/s5-distractors-{t}.json",
                   "# G3 AUTO-PASS (37c) on the graded families; refusals → backlog (a re-author is a contingency run)"])
        add(id=f"s7-author-{t}", stage="S7", chapter=ch, workflow="widgets.workflow.js (s7-v7, author)",
            what=f"S7 widget templates for chapter {ch}'s {c['lessons']} lesson(s) (kinds that genuinely fit, or a gap)",
            agents=c["lessons"], cost=[round(x * 0.55, 2) for x in _cost("s7_objective", nobj)],
            minutes=MINUTES["s7-author"], priority=4, depends_on=[f"s5-draft-{t}"],
            save_to=f"runs/g10-math/widgets/author-{t}-<wf_id>.json", meter=_meter("S7"),
            after=[f"uv run generate_widget_questions.py --merge-author-runs runs/g10-math/widgets/author-{t}-<wf_id>.json "
                   f"--merged runs/g10-math/widgets/author-merged-{t}.json --write-templates {wid}",
                   f"AINEXT_DB_DSN=\"{DSN}\" uv run generate_widget_questions.py --dsn \"{DSN}\" --catalogue "
                   f"runs/g10-math/misconceptions/draft-{t}-<wf_id>.json --normalise-templates {wid}/*.json   # recorded; only the two mechanical kinds"])
        add(id=f"s7-verify-{t}", stage="S7", chapter=ch, workflow="widgets.workflow.js (s7-v7, verify)",
            what=f"S7 blind reachability verification of chapter {ch}'s widget templates; skipped when the "
                 "author wrote no template (every lesson a gap — the dry run meets this on every non-geometry chapter)",
            agents=round(1.4 * c["lessons"]), cost=[round(x * 0.45, 2) for x in _cost("s7_objective", nobj)],
            minutes=MINUTES["s7-verify"], priority=4, depends_on=[f"s7-author-{t}"],
            save_to=f"runs/g10-math/widgets/verify-{t}-<wf_id>.json", meter=_meter("S7"),
            after=[f"AINEXT_DB_DSN=\"{DSN}\" uv run generate_widget_questions.py --templates {wid} --book {cfg} --dsn \"{DSN}\" "
                   f"--verdicts runs/g10-math/widgets/verify-{t}-<wf_id>.json --gaps runs/g10-math/widgets/author-merged-{t}.json "
                   f"--s5-distractors runs/g10-math/widgets/s5-distractors-{t}.json "
                   f"--pending-review runs/g10-math/widgets/pending-review-{t}.json   # refused mappings held (decision 47) → backlog"])
        add(id=f"s5-final-{t}", stage="S5", chapter=ch, workflow="misconceptions.workflow.js (s5-v5, final; embedded)",
            what=f"S5 final for chapter {ch}: the catalogue with S6/S7 distractors attached, fail-closed verifier",
            agents=nobj + 2, cost=[round(x * 0.55, 2) for x in _cost("s5_objective", nobj)], minutes=MINUTES["s5-final"],
            priority=4, depends_on=[f"s6-grade-{t}", f"s7-verify-{t}"],
            save_to=f"runs/g10-math/misconceptions/final-{t}-<wf_id>.json", meter=_meter("S5"),
            after=[f"uv run assemble_misconceptions.py runs/g10-math/misconceptions/final-{t}-<wf_id>.json --book {cfg} "
                   f"--out {gen}/misconceptions.json --graph seed/g10-math/g10m-c{ch:02d}.json --graph seed/g10-math/g10m-course.json",
                   f"AINEXT_DB_DSN=\"{DSN}\" AINEXT_ENVIRONMENT=mvp1 uv run load_misconceptions.py {gen}/misconceptions.json --course course:us-g10-math-en",
                   f"uv run generate_questions.py --families {fam} --book {cfg} --catalogue {gen}/misconceptions.json "
                   f"--grades runs/g10-math/families/grade-{t}-*.json --out {gen}/generated-questions.json "
                   f"--floor-report coverage/g10-math.{t}.tier-floor.json",
                   f"AINEXT_DB_DSN=\"{DSN}\" uv run generate_widget_questions.py --templates {wid} --book {cfg} --dsn \"{DSN}\" "
                   f"--verdicts runs/g10-math/widgets/verify-{t}-<wf_id>.json --gaps runs/g10-math/widgets/author-merged-{t}.json "
                   f"--gap-report coverage/g10-math.{t}.widget-gaps.json --pending-review runs/g10-math/widgets/pending-review-{t}.json "
                   f"--out {gen}/widget-questions.json",
                   f"uv run assemble_misconceptions.py runs/g10-math/misconceptions/final-{t}-<wf_id>.json --book {cfg} "
                   f"--out {gen}/misconceptions.json --bundle {gen}/generated-questions.json --bundle {gen}/widget-questions.json "
                   f"--graph seed/g10-math/g10m-c{ch:02d}.json --graph seed/g10-math/g10m-course.json",
                   f"# load both bundles (37a/37c: students see them; review status internal) — the loader's status "
                   f"policy is another data-engineer's work: load_generated_questions.py {gen}/<bundle> --course "
                   "course:us-g10-math-en … against the fan-out DB",
                   f"uv run coverage_report.py --book {cfg} --chapter {ch} --maths runs/g10-math/maths/book/summary.json "
                   f"--widget-gaps coverage/g10-math.{t}.widget-gaps.json --s5 runs/g10-math/misconceptions/final-{t}-<wf_id>.json "
                   f"--out coverage/g10-math.{t}.json",
                   f"uv run parity_check.py --candidate \"{DSN}\" --all-courses"],
            checkpoint=("chapter 1 complete: its whole cost against the estimate, coverage, parity, the console backlog — "
                        "go / no-go for the remaining 12 chapters") if i == 0 else None)
    return runs


def schedule(runs: list[dict], lanes: int = 2) -> dict:
    """List scheduling with at most `lanes` runs at once and at most one S0b run at a time (passes one at a
    time). Highest priority (lowest number) first among the runs whose dependencies have finished."""
    by = {r["id"]: r for r in runs}
    done: dict[str, float] = {}
    running: list[tuple[float, str]] = []
    t = 0.0
    order: list[str] = []
    pending = [r["id"] for r in runs]
    gap = MINUTES["between"]
    while pending or running:
        ready = [rid for rid in pending if all(d in done for d in by[rid]["depends_on"])
                 and (not by[rid].get("s0b") or not any(by[x].get("s0b") for _, x in running))]
        ready.sort(key=lambda rid: (by[rid]["priority"], max([done[d] for d in by[rid]["depends_on"]] or [0]),
                                    pending.index(rid)))
        while ready and len(running) < lanes:
            rid = ready.pop(0)
            if by[rid].get("s0b") and any(by[x].get("s0b") for _, x in running):
                continue
            start = max([t] + [done[d] + gap for d in by[rid]["depends_on"]])
            by[rid]["sim_start_min"] = round(start)
            end = start + (by[rid]["minutes"] or 5)
            by[rid]["sim_end_min"] = round(end)
            running.append((end, rid))
            pending.remove(rid)
            order.append(rid)
        if not running:
            raise SystemExit(f"plan deadlock: {pending[:5]} wait on {[by[p]['depends_on'] for p in pending[:5]]}")
        running.sort()
        end, rid = running.pop(0)
        t = end
        done[rid] = end
    return {"order": order, "makespan_min": round(max(done.values()))}


def plan() -> dict:
    inv = json.loads(INVENTORY_PATH.read_text()) if INVENTORY_PATH.exists() else inventory()
    runs = build_runs(inv)
    sch = schedule(runs)
    by = {r["id"]: r for r in runs}
    ordered = []
    for n, rid in enumerate(sch["order"], start=1):
        r = by[rid]
        r["order"] = n
        r["embedded_script"] = rel(EMBED / f"{n:03d}-{rid}.workflow.js")
        r["launch"] = f"Workflow({{scriptPath: \"<abs>/services/extraction/{r['embedded_script']}\"}})   # NO args"
        r["prepared"] = (EMBED / f"{n:03d}-{rid}.workflow.js").exists()
        ordered.append(r)
    lo = round(sum(r["cost"][0] for r in ordered if r.get("cost")), 2)
    hi = round(sum(r["cost"][1] for r in ordered if r.get("cost")), 2)
    by_stage: dict[str, list[float]] = collections.defaultdict(lambda: [0.0, 0.0])
    for r in ordered:
        if r.get("cost"):
            by_stage[r["stage"]][0] += r["cost"][0]
            by_stage[r["stage"]][1] += r["cost"][1]
    return {
        "format": "ainext.fanout-plan/1", "book": BOOK,
        "approved": "Samuel, 2026-10-01, docs/WIP-g10-pilot/samuel-answers.md answer 37e (fan out the other 13 chapters, "
                    "≈ $0.85–1.1k); gates G1–G4 auto-pass on the AI checks' recommendation into the console backlog (37c); "
                    "the book picture stands in for a figure no native type draws (37d); answer 30 (the working checker)",
        "rules": [
            "At most 2 Workflow runs at a time, and never two S0b runs at once (the pilot's usage-limit kills).",
            "Launch each run as its generated copy with NO args, in a turn whose latest user message is the go-ahead "
            "(the harness relays that message to every agent — runbook §3).",
            "Save the WHOLE return value where save_to says, then meter it (meter, plus --resumed for a resume). "
            "Resume a stopped run with the SAME copy and resumeFromRunId; never regenerate a copy mid-run.",
            "A run marked not prepared is prepared by `uv run fanout.py prepare <id>` once its inputs exist "
            "(it refuses, saying what is missing, before that).",
            "Every gate decision (G1–G4) and every working-check flag lands in the console backlog; nothing is "
            "silently corrected. Automatic safety checks (maths, answers vs the book, parity) still block.",
            "Stop and ask Samuel if the metered total passes $1,100 (the top of the approved range) or a checkpoint fails.",
            "Scratch DB only: " + DSN + " (create it after the migrations in flight land: schema.sql + db/migrations, "
            "then every National course and the pilot's Grade 10 course + Chapter 8, as dryrun_chapter.py does).",
        ],
        "cost_usd": {"low": lo, "high": hi, "by_stage": {k: [round(v[0], 2), round(v[1], 2)] for k, v in sorted(by_stage.items())},
                     "basis": "the pilot's measured unit costs (UNIT_COST in fanout.py; pilot-report.md); API-equivalent",
                     "not_included": ["contingency re-runs (S6 revise, S7 re-author, S4 visual re-runs, resumes after a "
                                      "usage-limit kill): allow +10–15%",
                                      "G1/G2 recommendation agents, if the auto-pass mode needs one per chapter"]},
        "wall_clock": {"simulated_run_minutes": sch["makespan_min"],
                       "simulated_hours": round(sch["makespan_min"] / 60, 1),
                       "note": "two lanes, the pilot's run durations, 3 minutes between runs for the deterministic "
                               "steps; checkpoints and the main session's own pace come on top"},
        "runs": ordered,
    }


# ================================================================ preparation
def _embed(script: str, args: dict, run: dict) -> dict:
    import embed_workflow
    out = HERE / run["embedded_script"]
    info = embed_workflow.write(HERE / "runbook" / script, args, out)
    return {"script": rel(out), "bytes": info["bytes"], "args_bytes": info["args_bytes"],
            "generated_sha256": info["generated_sha256"]}


def _run(rid: str) -> dict:
    if not PLAN_PATH.exists():
        raise SystemExit(f"no {rel(PLAN_PATH)}: run `uv run fanout.py plan` first")
    p = json.loads(PLAN_PATH.read_text())
    r = next((x for x in p["runs"] if x["id"] == rid), None)
    if r is None:
        raise SystemExit(f"{rid}: not a run of the plan")
    return r


def _saved_runs(pattern: str) -> list[Path]:
    return sorted(p for p in RUNS.glob(pattern) if p.is_file())


def prep_s0b(run: dict) -> dict:
    import assemble_maths as am
    book = _book()
    g = run["id"].rsplit("-", 1)[1]
    p = run["id"].split("-")[1]
    chs = dict(S0B_GROUPS)[g]
    part = s0b_partition()
    group_imgs = {x["md5"] for c in chs for x in part["by_chapter"].get(c, [])}
    batch_dir = PACKETS / f"s0b-{g}"
    if p in ("A", "B"):
        q = [x for x in part["queue"] if x["md5"] in group_imgs]
        for f in batch_dir.glob(f"{p}-b*.json"):
            f.unlink()
    else:
        mine = [f for f in _saved_runs("maths/*.json") if _run_in_dir(f, batch_dir)]
        passes = {json.loads(f.read_text()).get("pass") for f in mine}
        if not {"A", "B"} <= passes:
            raise NotReady(f"pass C reads passes A and B of {g}: save both runs (runs/g10-math/maths/A-…, B-…) first; "
                           f"have {sorted(x for x in passes if x)}")
        q = [x for x in am.third_reading_queue(part["eqs"], part["recovered"], am.load_runs(_saved_runs("maths/*.json")))
             if x["md5"] in group_imgs]
        if not q:
            return {"skipped": f"passes A and B agree on every {g} image: no third reading needed"}
    args = am.vision_args(book, WORK, q, [p], BATCH, None, batch_dir)
    out = _embed("transcribe-maths.workflow.js", args, run)
    return {**out, "images": len(q), "batches": len(args["batch_files"])}


def _run_in_dir(run_file: Path, d: Path) -> bool:
    try:
        r = json.loads(run_file.read_text())
    except json.JSONDecodeError:
        return False
    return any(str(f).startswith(str(d.resolve()) + "/") for f in r.get("batch_files") or [])


def _approved(slug: str) -> bool:
    f = HERE / "objectives" / BOOK / f"{slug}.json"
    return f.exists() and json.loads(f.read_text()).get("status") == "approved"


def prep_s1(run: dict) -> dict:
    import assemble_objectives as ao
    book = _book()
    ch = run["chapter"]
    i = FANOUT_CHS.index(ch)
    m = json.loads((HERE / "manifest" / "g10-math-american.json").read_text())
    if i:
        prev = FANOUT_CHS[i - 1]
        mod = next(x for x in m["modules"] if int(x["chapter"]) == prev)
        missing = [l["id"] for l in mod["lessons"] if not _approved(l["id"])]
        if missing:
            raise NotReady(f"chapter {prev} has not passed G1 (auto-pass) yet: {missing[:4]} — chapter {ch}'s links may "
                           "name only earlier chapters that passed G1")
    maths = ao.load_maths(MATHS_BOOK / "accepted.json") if (MATHS_BOOK / "accepted.json").exists() else None
    if maths is None:
        raise NotReady("no runs/g10-math/maths/book/accepted.json: assemble S0b for the full book first")
    try:
        args = ao.s1_args(book, m, ao.load_blocks(WORK / "blocks.jsonl"), maths, ch, None,
                          ao.prior_objectives(HERE / "objectives" / BOOK, ch))
    except ao.StageError as e:
        raise NotReady(str(e)) from e
    compact = ao.s1_args_by_ref(args, PACKETS / f"s1-{ch_tag(ch)}")
    (PACKETS / f"s1-{ch_tag(ch)}.args.json").write_text(json.dumps(compact, ensure_ascii=False) + "\n")
    out = _embed("objectives.workflow.js", compact, run)
    return {**out, "prior_objectives": len(args["prior_objectives"]), "lessons": len(args["chapter"]["lessons"]),
            "pool": len(args["chapter"]["pool"])}


def prep_lesson(run: dict) -> dict:
    import assemble_objectives as ao
    book = _book()
    slug = run["lesson"]
    if not _approved(slug):
        raise NotReady(f"{slug}: its chapter has not passed G1 (objectives/g10-math/{slug}.json not approved)")
    m = json.loads((HERE / "manifest" / "g10-math-american.json").read_text())
    try:
        args = ao.lesson_args(book, m, ao.load_blocks(WORK / "blocks.jsonl"), ao.load_maths(MATHS_BOOK / "accepted.json"),
                              HERE / "objectives" / BOOK, [slug], WORK)
    except ao.StageError as e:
        raise NotReady(str(e)) from e
    out = _embed("lesson.workflow.js", args, run)
    return {**out, "items": sum(len(l["items"]) for l in args["lessons"]),
            "worked_examples": sum(len(l["worked_examples"]) for l in args["lessons"])}


def prep_wcheck(run: dict) -> dict:
    import working_check as W
    book = _book()
    ch = run["chapter"]
    seed = PILOT_SEED / "g10m-c08.json" if ch == PILOT_CH else HERE / "seed" / BOOK / f"g10m-c{ch:02d}.json"
    if not seed.exists():
        raise NotReady(f"no assembled bundle {rel(seed)}: assemble chapter {ch} first")
    parts = W.build_args(book, json.loads(seed.read_text()), ch, PACKETS / f"wcheck-{ch_tag(ch)}",
                         W.figures_for(RUNS / "lesson"))
    outs = []
    for k, a in enumerate(parts, start=1):
        suffix = "" if k == 1 else f".part{k}"
        (PACKETS / f"wcheck-{ch_tag(ch)}.args{suffix}.json").write_text(json.dumps(a, ensure_ascii=False) + "\n")
        r = dict(run)
        if k > 1:
            r["embedded_script"] = run["embedded_script"].replace(".workflow.js", f".part{k}.workflow.js")
        outs.append(_embed("working-check.workflow.js", a, r))
    pre = [json.loads(W.precheck_path(Path(a["by_ref"]["dir"])).read_text()) for a in parts]
    return {**outs[0], "parts": [o["script"] for o in outs], "solutions": sum(len(a["solutions"]) for a in parts),
            "skipped": sum(len(p["skipped"]) for p in pre), "numeric_flags": sum(len(p["flags"]) for p in pre),
            "seed": rel(seed)}


def _teaching_items_s111() -> list[dict]:
    """lo:g10m8s1-1-1's items as the S6 author's models and parent candidates: G2 made all six teaching-only
    (drawings), so each is listed with its problem figure(s) and the book's drawn answer (the EPUB solution's
    image), under the question id it would have, marked teaching_only."""
    import assemble_objectives as ao
    seed = json.loads((PILOT_SEED / "g10m-c08.json").read_text())
    run = json.loads((RUNS / "lesson" / "g10m8s1-1.json").read_text())
    tier = {it["ref"]: it.get("tier") for it in run["items"]}
    blocks = {b.get("item_key"): b for b in _blocks() if b["type"] == "exercise_item" and b.get("chapter") == PILOT_CH}
    out = []
    for e in seed["explanation_entries"]:
        if e["lo"] != S111:
            continue
        key = e["id"].split(":")[-1]                         # ex8-6-4a
        b = blocks.get(key) or {}
        ref = f"Ex{key[2:].replace('-', ':', 2).replace(':', '-', 1)}"   # ex8-6-4a -> Ex8-6:4a
        prob = [ao.figure_path(WORK, f["src"]) for f in (b.get("problem") or {}).get("figures") or []]
        sol = [ao.figure_path(WORK, f["src"]) for f in (b.get("solution") or {}).get("figures") or []]
        stem = next(c["text_md"] for c in e["content"] if c.get("kind") == "problem")
        out.append({"id": "q:" + e["id"].removeprefix("expl:"), "tier": tier.get(ref) or "standard",
                    "type": "drawing (teaching only at G2: not markable — no question row exists)",
                    "stem": stem, "choices": None, "answer": None,
                    "solution": ["The book's answer is the drawn figure: open the image file listed in figures "
                                 "(the last one is the book's drawn answer)."],
                    "source_page": e.get("source_page"), "teaching_only": True, "library_entry": e["id"],
                    "figures": [f for f in prob + sol if f]})
    return out


def prep_s6_s111(run: dict) -> dict:
    import book_config
    import generate_questions as G
    from families import spec as FS
    book = book_config.load_book(PILOT_CONFIG)
    specs, problems = FS.load_dir(HERE / "families" / BOOK)
    if problems:
        raise NotReady(f"families/g10-math does not load: {problems[:3]}")
    objectives = G.book_objectives(book)
    if S111 not in objectives:
        raise NotReady(f"{S111} is not an objective of the pilot seed")
    entries, _ = G.load_catalogue(HERE / "seed" / "generated" / BOOK / "misconceptions.json")
    a = G.author_args(book, specs, {S111: objectives[S111]}, entries, True, [], {})
    obj = a["objectives"][0]
    obj["book_questions"] = _teaching_items_s111()
    obj["tier_gaps"] = obj.get("tier_gaps") or ["basic", "standard", "advanced"]
    if not obj["book_questions"]:
        raise NotReady(f"{S111}: no teaching items found in the pilot seed")
    compact = G.author_args_by_ref(a, PACKETS / "s6-author-ch08-s111")
    (PACKETS / "s6-author-ch08-s111.args.json").write_text(json.dumps(compact, ensure_ascii=False) + "\n")
    out = _embed("families.workflow.js", compact, run)
    return {**out, "objective": S111, "teaching_items": len(obj["book_questions"]),
            "figures": sum(len(q["figures"]) for q in obj["book_questions"]),
            "misconceptions": len(obj["misconceptions"]), "tier_gaps": obj["tier_gaps"]}


def _py(*argv: str, env: dict | None = None) -> subprocess.CompletedProcess:
    import os
    r = subprocess.run(["uv", "run", "--project", str(HERE), "python", *argv], cwd=HERE, capture_output=True, text=True,
                       env=dict(os.environ, **(env or {})), timeout=1800)
    if r.returncode != 0:
        raise NotReady(f"{' '.join(argv[:3])} … exited {r.returncode}: {(r.stderr or r.stdout)[-800:]}")
    return r


def _latest(pattern: str) -> Path:
    files = _saved_runs(pattern)
    if not files:
        raise NotReady(f"no saved run {pattern} under runs/g10-math/")
    if len(files) > 1:
        raise NotReady(f"more than one saved run matches {pattern}: {[rel(f) for f in files]} — keep one, "
                       "move the others to a superseded/ folder")
    return files[0]


def _chapter_inputs(ch: int) -> tuple[Path, Path]:
    cfg = write_config(ch)
    t = ch_tag(ch)
    seed_dir = FAN / "seed" / t
    if seed_dir.exists():
        shutil.rmtree(seed_dir)
    seed_dir.mkdir(parents=True)
    for name in ("g10m-course.json", f"g10m-c{ch:02d}.json"):
        shutil.copyfile(HERE / "seed" / BOOK / name, seed_dir / name)
    return cfg, seed_dir


def prep_s5_draft(run: dict) -> dict:
    ch = run["chapter"]
    t = ch_tag(ch)
    cfg, seed_dir = _chapter_inputs(ch)
    a = PACKETS / f"s5-draft-{t}.args.json"
    _py("assemble_misconceptions.py", "--s5-args", str(a), "--book", str(cfg), "--stage", "draft", "--seed-dir", str(seed_dir),
        "--lesson-runs", str(RUNS / "lesson"), "--by-ref", str(PACKETS / f"s5-draft-{t}"))
    return _embed("misconceptions.workflow.js", json.loads(a.read_text()), run)


def prep_s6_author(run: dict) -> dict:
    ch = run["chapter"]
    t = ch_tag(ch)
    cfg, _ = _chapter_inputs(ch)
    fam = HERE / "families" / BOOK / t
    fam.mkdir(parents=True, exist_ok=True)
    draft = _latest(f"misconceptions/draft-{t}-*.json")
    a = PACKETS / f"s6-author-{t}.args.json"
    _py("generate_questions.py", "--families", str(fam), "--book", str(cfg), "--catalogue", str(draft),
        "--author-args", str(a), "--by-ref", str(PACKETS / f"s6-author-{t}"))
    return _embed("families.workflow.js", json.loads(a.read_text()), run)


def prep_s6_grade(run: dict) -> dict:
    ch = run["chapter"]
    t = ch_tag(ch)
    cfg, _ = _chapter_inputs(ch)
    fam = HERE / "families" / BOOK / t
    if not any(fam.glob("*.json")):
        if _saved_runs(f"families/author-{t}-*.json"):
            return {"skipped": f"the S6 author wrote no family for chapter {ch} (every gap infeasible): nothing to grade"}
        raise NotReady(f"no family specs in {rel(fam)}: write the author run's specs (fanout.py write-specs) first")
    a = PACKETS / f"s6-grade-{t}.args.json"
    _py("generate_questions.py", "--families", str(fam), "--book", str(cfg), "--grading-set",
        str(PACKETS / f"s6-grading-set-{t}.json"), "--grade-args", str(a), "--s5-distractors",
        str(RUNS / "families" / f"s5-distractors-{t}.ungraded.json"), "--by-ref", str(PACKETS / f"s6-grade-{t}"))
    parts = sorted(a.parent.glob(f"{a.stem}.part*.json")) or [a]
    outs = []
    for k, pa in enumerate(parts, start=1):
        r = dict(run)
        if len(parts) > 1:
            r["embedded_script"] = run["embedded_script"].replace(".workflow.js", f".part{k}.workflow.js")
        outs.append(_embed("families.workflow.js", json.loads(pa.read_text()), r))
    return {**outs[0], "parts": [o["script"] for o in outs]}


def prep_s7_author(run: dict) -> dict:
    ch = run["chapter"]
    t = ch_tag(ch)
    cfg, _ = _chapter_inputs(ch)
    draft = _latest(f"misconceptions/draft-{t}-*.json")
    a = PACKETS / f"s7-author-{t}.args.json"
    _py("generate_widget_questions.py", "--author-args", str(a), "--book", str(cfg), "--dsn", DSN, "--catalogue", str(draft),
        "--by-ref", str(PACKETS / f"s7-author-{t}"), env={"AINEXT_DB_DSN": DSN})
    return _embed("widgets.workflow.js", json.loads(a.read_text()), run)


def prep_s7_verify(run: dict) -> dict:
    ch = run["chapter"]
    t = ch_tag(ch)
    cfg, _ = _chapter_inputs(ch)
    wid = HERE / "widgets" / BOOK / t
    if not any(wid.glob("*.json")):
        if (RUNS / "widgets" / f"author-merged-{t}.json").exists():
            return {"skipped": f"the S7 author wrote no template for chapter {ch} (every lesson a gap): nothing to verify"}
        raise NotReady(f"no templates in {rel(wid)}: merge and write the author run's templates first")
    draft = _latest(f"misconceptions/draft-{t}-*.json")
    a = PACKETS / f"s7-verify-{t}.args.json"
    _py("generate_widget_questions.py", "--templates", str(wid), "--book", str(cfg), "--dsn", DSN, "--catalogue", str(draft),
        "--gaps", str(RUNS / "widgets" / f"author-merged-{t}.json"), "--pre-catalogue", "--verify-args", str(a),
        "--s5-distractors", str(RUNS / "widgets" / f"s5-distractors-{t}.precatalogue.json"),
        "--by-ref", str(PACKETS / f"s7-verify-{t}"), env={"AINEXT_DB_DSN": DSN})
    return _embed("widgets.workflow.js", json.loads(a.read_text()), run)


def prep_s5_final(run: dict) -> dict:
    ch = run["chapter"]
    t = ch_tag(ch)
    cfg, seed_dir = _chapter_inputs(ch)
    draft = _latest(f"misconceptions/draft-{t}-*.json")
    # the graded families' and the verified widgets' distractors — each only where its stage produced anything
    dist = []
    for has, d in ((any((HERE / "families" / BOOK / t).glob("*.json")), RUNS / "families" / f"s5-distractors-{t}.json"),
                   (any((HERE / "widgets" / BOOK / t).glob("*.json")), RUNS / "widgets" / f"s5-distractors-{t}.json")):
        if has and not d.exists():
            raise NotReady(f"S5 final reads {rel(d)} (the s6-grade / s7-verify after-step) — write it first")
        if has:
            dist += ["--distractors", str(d)]
    a = PACKETS / f"s5-final-{t}.args.json"
    _py("assemble_misconceptions.py", "--s5-args", str(a), "--book", str(cfg), "--stage", "final", "--seed-dir", str(seed_dir),
        "--lesson-runs", str(RUNS / "lesson"), "--draft", str(draft), *dist, "--by-ref", str(PACKETS / f"s5-final-{t}"))
    return _embed("misconceptions.workflow.js", json.loads(a.read_text()), run)


PREP = [("s6-author-ch08-s111", prep_s6_s111), ("s0b-", prep_s0b), ("s1-", prep_s1), ("lesson-", prep_lesson),
        ("wcheck-", prep_wcheck), ("s5-draft-", prep_s5_draft), ("s6-author-", prep_s6_author),
        ("s6-grade-", prep_s6_grade), ("s7-author-", prep_s7_author), ("s7-verify-", prep_s7_verify),
        ("s5-final-", prep_s5_final)]


def prepare(rid: str) -> dict:
    run = _run(rid)
    fn = next(f for prefix, f in PREP if rid == prefix or (rid.startswith(prefix) and prefix.endswith("-")))
    PACKETS.mkdir(parents=True, exist_ok=True)
    EMBED.mkdir(parents=True, exist_ok=True)
    return fn(run)


# ================================================================ per-chapter config, specs, status
def write_config(ch: int) -> Path:
    """work/g10-math/fanout/books/chNN/g10-math.json: the committed config with the chapter's bundles only
    (course + chapter), loadable, so the S5–S7 builders and the loader read exactly that chapter."""
    raw = json.loads((HERE / "books" / f"{BOOK}.json").read_text())
    bundles = [f"services/extraction/seed/{BOOK}/g10m-course.json", f"services/extraction/seed/{BOOK}/g10m-c{ch:02d}.json"]
    for b in bundles:
        if not (REPO / b).exists():
            raise NotReady(f"no {b}: assemble chapter {ch} first")
    raw.update(bundles=bundles, status="loadable", generated=None, parity=None,
               content_files=[c for c in raw.get("content_files") or [] if re.search(rf"/g10m{ch}s\d", c)])
    out = FAN / "books" / ch_tag(ch) / f"{BOOK}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(raw, indent=1, ensure_ascii=False) + "\n")
    return out


def write_specs(run_file: Path, into: Path) -> list[Path]:
    r = json.loads(run_file.read_text())
    r = r.get("result", r)
    into.mkdir(parents=True, exist_ok=True)
    written = []
    for rec in r.get("records") or []:
        for spec in rec.get("families") or []:
            tail, slug = spec["id"].split(":")[1:]
            p = into / f"{tail}--{slug}.json"
            if p.exists():
                raise SystemExit(f"{rel(p)} exists: never overwritten (move it aside first)")
            p.write_text(json.dumps(spec, indent=1, ensure_ascii=False) + "\n")
            written.append(p)
    return written


def status() -> dict:
    p = json.loads(PLAN_PATH.read_text())
    saved: dict[str, str] = {}
    for f in RUNS.rglob("*.json"):
        try:
            d = json.loads(f.read_text())
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if isinstance(d, dict):
            e = (d.get("result", d) or {}).get("embedded") if isinstance(d.get("result", d), dict) else None
            if isinstance(e, dict) and e.get("generated_sha256"):
                saved[e["generated_sha256"]] = rel(f)
    metered = set()
    led = RUNS / "cost.jsonl"
    if led.exists():
        metered = {json.loads(l).get("run_id") for l in led.read_text().splitlines() if l.strip()}
    rows = []
    for r in p["runs"]:
        copy = HERE / r["embedded_script"]
        side = copy.with_suffix(".json")
        sha = json.loads(side.read_text())["generated_sha256"] if side.exists() else None
        f = saved.get(sha) if sha else None
        run_id = None
        if f:
            d = json.loads((HERE / f).read_text())
            run_id = (d.get("result", d) or {}).get("run_id") or d.get("run_id")
        rows.append({"order": r["order"], "id": r["id"], "prepared": copy.exists(), "saved": f,
                     "metered": bool(run_id and run_id in metered) if run_id else None})
    return {"runs": rows, "prepared": sum(x["prepared"] for x in rows), "saved": sum(bool(x["saved"]) for x in rows),
            "total": len(rows)}


# ================================================================ CLI
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("inventory")
    sub.add_parser("plan")
    p = sub.add_parser("prepare")
    p.add_argument("ids", nargs="*")
    p.add_argument("--ready", action="store_true", help="every run whose inputs exist and that has no copy yet")
    sub.add_parser("status")
    p = sub.add_parser("config")
    p.add_argument("chapter", type=int)
    p = sub.add_parser("write-specs")
    p.add_argument("run", type=Path)
    p.add_argument("--into", type=Path, required=True)
    a = ap.parse_args(argv)

    if a.cmd == "inventory":
        inv = inventory()
        INVENTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        INVENTORY_PATH.write_text(json.dumps(inv, indent=1, ensure_ascii=False) + "\n")
        print(f"{'ch':>3} {'lessons':>7} {'WE':>4} {'items':>6} {'eoc':>5} {'sol':>5} {'imgs':>5} {'to read':>7} "
              f"{'figs':>5} {'obj~':>5}  title")
        for c in inv["chapters"]:
            print(f"{c['chapter']:>3} {c['lessons']:>7} {c['worked_examples']:>4} {c['items_total']:>6} "
                  f"{c['end_of_chapter_items']:>5} {c['solutions']:>5} {c['maths_images']['unique']:>5} "
                  f"{c['maths_images']['to_read_first_here']:>7} {c['figures']['book']:>5} {c['objectives_estimate']:>5}  "
                  f"{c['title']}{' (pilot)' if c['chapter'] == PILOT_CH else ''}")
        print(f"S0b: {inv['s0b']['to_read']} images to read at batch {BATCH}: "
              + ", ".join(f"{g['group']} {g['chapters']} {g['images']}/{g['batches']}b" for g in inv["s0b"]["groups"]))
        print(f"→ {rel(INVENTORY_PATH)}")
        return 0
    if a.cmd == "plan":
        INVENTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        INVENTORY_PATH.write_text(json.dumps(inventory(), indent=1, ensure_ascii=False) + "\n")
        pl = plan()
        PLAN_PATH.write_text(json.dumps(pl, indent=1, ensure_ascii=False) + "\n")
        print(f"{len(pl['runs'])} runs; cost ${pl['cost_usd']['low']:.0f}–{pl['cost_usd']['high']:.0f} "
              f"(+10–15% contingency); simulated wall clock {pl['wall_clock']['simulated_hours']} h → {rel(PLAN_PATH)}")
        for st, (lo, hi) in pl["cost_usd"]["by_stage"].items():
            print(f"  {st:6} ${lo:8.2f} – ${hi:8.2f}")
        return 0
    if a.cmd == "prepare":
        ids = list(a.ids)
        if a.ready:
            pl = json.loads(PLAN_PATH.read_text())
            ids += [r["id"] for r in pl["runs"] if not (HERE / r["embedded_script"]).exists()]
        rc = 0
        for rid in ids:
            try:
                info = prepare(rid)
                print(f"READY {rid}: " + json.dumps(info, ensure_ascii=False))
            except NotReady as e:
                print(f"not ready {rid}: {e}")
                rc = rc or (0 if a.ready else 3)
        return rc
    if a.cmd == "status":
        st = status()
        for r in st["runs"]:
            print(f"{r['order']:>3} {r['id']:<28} prepared={'y' if r['prepared'] else '-'} saved={r['saved'] or '-'} "
                  f"metered={r['metered']}")
        print(f"{st['prepared']} prepared, {st['saved']} saved, of {st['total']}")
        return 0
    if a.cmd == "config":
        print(rel(write_config(a.chapter)))
        return 0
    if a.cmd == "write-specs":
        for p in write_specs(a.run, a.into):
            print(f"wrote {rel(p)}")
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())

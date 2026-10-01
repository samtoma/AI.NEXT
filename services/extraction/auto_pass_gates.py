"""Auto-pass the human gates G1–G5 during the fan-out, and record every decision for Samuel's review.

Samuel's answer 37c (2026-10-01): *"Auto-pass, review later"* — during the full-book fan-out the pipeline
proceeds on the AI checks' recommendation, every decision lands in the console's review backlog (37b),
and the AUTOMATIC SAFETY CHECKS STILL BLOCK (broken maths, answers vs the book, a missing or
answer-revealing figure, parity). His follow-up the same day (answer 39): the auto-pass covers G5, the
final go/no-go, too — and every auto-passed decision is RECORDED, machine-readably, for his review in the
console. G5's auto-pass is a pipeline GO for the next stage on the dev/pilot database only: it never
deploys or promotes anything to production.

AN AUTO-PASS IS NEVER A HUMAN STAMP (migration 035, answer 33). Every verdict this writes is signed
"auto-pass G<n> (AI recommendation)" and marked `"auto": true`; the loaders write it to `ai_checked_by`,
never `reviewed_by`. A human verdict already in a gate's file is never overwritten.

    uv run auto_pass_gates.py g1 <book> --chapter 9 [--approve]
        every decision G1 owes (objectives/<book>/chNN.check.json `undecided`) answered by the AI line's
        own recommendation: a single-finder objective the evidence check kept → approve; a terminology flag
        → keep; two mappers disagreeing → the placement the pool already uses (mapper 1); a backward link
        the independent checker agreed → approve; an unpractised objective or a finder objective with no
        home → acknowledged; an end-of-chapter item both blind mappers placed nowhere → outside the
        chapter's objectives, with that reason. A pipeline failure (links not run or failed, any other rule
        failure) is NOT auto-passed: the record says `blocked` and the command exits 1. Writes
        runs/<book>/objectives/g1-chNN.auto.json; `--approve` then runs
          assemble_objectives.py approve <book> --chapter N --by "auto-pass G1 (AI recommendation)" --verdicts …
    uv run auto_pass_gates.py g2 <book> --chapter 9 --lesson-run runs/<book>/lessons/<runId>.json \\
              [--recommend runs/<book>/g2-ch09.recommended.json]
        the S2–S4 run's items that owe G2 a verdict, decided in this order: a HUMAN verdict already in G2's
        file (default runs/<book>/g2.json) stands; else the recommendation file's verdict; else the AI
        checks' own rule — an item with no printed answer whose blind re-solve AGREED with the EPUB worked
        solution → accept; an item the typing check flagged → exclude (kept out of the bank and listed for
        Samuel: a fix needs fields a person or a recommendation must write); a three-way DISAGREEMENT → no
        verdict, so the assembly holds it (`answer_mismatch`: the "answers vs the book" check blocks). Every
        auto verdict is `{"verdict", "auto": true, "by": "auto-pass G2 (AI recommendation)", "note"}` in G2's
        own file. Then `assemble_objectives.py lesson-runs … --g2`, assemble, load, and
        `apply_review_verdicts.py --g2` exactly as for a human G2 file.
    uv run auto_pass_gates.py g3 <book> --chapter 9 --queue <bundle>.review-queue.json [--queue …] \\
              [--widgets seed/generated/<book>/widget-questions.json]
        the sampled items accepted on the AI checks (S6's blind grade passed every family in the bundle,
        S7's verifier every template) → runs/<book>/g3-chNN.auto.json; apply with
        `apply_review_verdicts.py <that file>`, which ADDS the auto-pass to ai_checked_by. Held
        predicate→misconception claims (decision 47) follow the verifier: they stay held (inactive) and are
        listed in the record — there is no `--mapping-review` step.
    uv run auto_pass_gates.py g4 <book> --chapter 9 --catalogue seed/generated/<book>/misconceptions.json \\
              --s5 runs/<book>/misconceptions/final-<run>.json
        a record: the catalogue holds exactly what S5's verifier kept (the loader refuses anything else).
    AINEXT_DB_DSN=<the load's database> uv run auto_pass_gates.py g5 <book> --chapter 9 \\
              --coverage coverage/<book>.json [--book-config <the loaded config>] [--dryrun <report>]
        the go/no-go on the evidence: the drift guard for every course (parity_check; GREEN required), the
        coverage audit (a SAFETY check failing — katex, notation, answer_text, asked_forms, book_pictures,
        captions, teacher_only, s5_catalogue, solution_sources, distractor_refutations — blocks; a
        completeness check failing is listed for Samuel and does not), and the cost ledger. Exit 1 = NO-GO.

THE GATE DECISION RECORD — what the console reads (`app/src/lib/review-gate-records.ts`, format
`ainext.gate-decision/1`). Every subcommand writes one JSON file per gate and scope to
`runs/<book>/gates/<id>.json`, id `g<n>-chNN` (or `g<n>-book`), replacing an earlier one for the same
gate and scope (the console fingerprints the content, so a changed decision is back in front of Samuel):

    {"format": "ainext.gate-decision/1", "gate": "G3", "book": "g10-math", "id": "g3-ch08",
     "chapter": 8, "run": "<optional>", "decided_at": "<UTC ISO, Z>",
     "by": "auto-pass G3 (AI recommendation)", "auto": true,
     "outcome": "pass" | "pass_with_holds" | "blocked",
     "summary": "<one sentence>",
     "decisions": [{"key", "decision", "detail", "basis"}],
     "checks": [{"name", "state", "detail"}],
     "evidence": [{"label", "path"}],             (repository-relative paths)
     "blocked": ["<what did NOT auto-pass>"],
     "course_id": "...", "for_review": ["..."]}    (extra fields the console ignores)

No model is called; every subcommand is deterministic over files the AI stages already wrote.
"""

from __future__ import annotations

import contextlib
import io
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import book_config
import review_policy
from assemble_lesson_bundle import choice_option_problems

HERE = Path(__file__).resolve().parent
FORMAT = "ainext.gate-decision/1"
NONE_PLACED = re.compile(r"^distributed item (\S+) maps to no objective \(rule 2\): both mappers said none")
# decisions an auto-pass may take (the AI line's own recommendation exists); anything else blocks
AUTO_KINDS = {"single", "terminology", "mappers_disagree", "link_backward", "unpractised", "finder_dropped"}
# coverage checks that are SAFETY checks (answer 37c: they still block); every other check is completeness
SAFETY_CHECKS = {"katex", "notation", "answer_text", "asked_forms", "book_pictures", "captions", "teacher_only",
                 "s5_catalogue", "solution_sources", "distractor_refutations"}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _rel(p: Path | str | None) -> str | None:
    if p is None:
        return None
    p = Path(p).resolve()
    try:
        return str(p.relative_to(book_config.REPO_ROOT))
    except ValueError:
        return str(p)


def record_id(gate: str, chapter: int | None) -> str:
    return f"{gate.lower()}-" + (f"ch{chapter:02d}" if chapter is not None else "book")


# ============================================================================ the decision record
def decision_record(gate: str, book, chapter: int | None, summary: str, *, decisions: list[dict] | None = None,
                    checks: list[dict] | None = None, evidence: list[tuple[str, Path | str | None]] | None = None,
                    blocked: list[str] | None = None, held: bool = False, for_review: list[str] | None = None,
                    run: str | None = None, at: str | None = None) -> dict:
    """The console's record (review-gate-records.ts). `held`: something was kept out of students or left for
    a person (a hold, an exclusion, a held claim, a completeness finding) — `pass_with_holds`."""
    gate = gate.upper()
    if not re.fullmatch(r"G[1-5]", gate):
        raise ValueError(f"not a gate: {gate}")
    outcome = "blocked" if blocked else ("pass_with_holds" if held or for_review else "pass")
    rec = {"format": FORMAT, "gate": gate, "book": book.book, "id": record_id(gate, chapter), "chapter": chapter,
           **({"run": run} if run else {}), "decided_at": at or _now(), "by": review_policy.auto_pass_by(gate),
           "auto": True, "outcome": outcome, "summary": summary,
           "decisions": [{k: v for k, v in d.items() if v not in (None, "")} for d in decisions or []],
           "checks": [{k: v for k, v in c.items() if v not in (None, "")} for c in checks or []],
           "evidence": [{"label": label, "path": _rel(p)} for label, p in evidence or [] if p],
           "blocked": list(blocked or []),
           "course_id": book.course_id, "for_review": list(for_review or [])}
    return rec


def write_record(rec: dict, gates_dir: Path) -> Path:
    path = gates_dir / f"{rec['id']}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rec, ensure_ascii=False, indent=1) + "\n")
    return path


# ============================================================================ G1
def g1_verdicts(check: dict) -> tuple[dict, list[str], list[dict]]:
    """The G1 verdicts file (assemble_objectives.py approve --verdicts) answering every owed decision on the
    AI recommendation; what blocks an auto-pass (a pipeline failure is never papered over); the decisions."""
    by = review_policy.auto_pass_by("G1")
    v: dict = {"auto": True, "by": by, "terminology": {}, "move_items": {}, "links": {}, "acknowledged": [],
               "objectives": {}, "outside_items": {}}
    blocked: list[str] = []
    decisions: list[dict] = []
    pool = check.get("pool") or {}
    for f in check.get("failures") or []:
        m = NONE_PLACED.match(f)
        if m:
            why = "both blind mappers placed it nowhere, so no objective of this chapter practises it"
            v["outside_items"][m.group(1)] = {"why": f"{by}: {why}"}
            decisions.append({"key": m.group(1), "decision": "outside the chapter's objectives", "basis": why})
        else:
            blocked.append(f"failure: {f}")
    for d in check.get("undecided") or []:
        kind = d.get("kind")
        if kind not in AUTO_KINDS:
            blocked.append(f"{kind}: {d.get('detail')} (key {d.get('key')})")
            continue
        if kind == "single":
            v["objectives"][d["objective"]] = {"action": "approve", "why": f"{by}: the evidence check kept it"}
            dec, basis = "approve", "one finder found it; the independent evidence check kept its evidence"
        elif kind == "terminology":
            v["terminology"][d["key"].split(":", 1)[1]] = "keep"
            dec, basis = "keep", "a flag on a term the book itself uses"
        elif kind == "mappers_disagree":
            if not pool.get(d["item"]):
                blocked.append(f"mappers_disagree: {d['item']} has no placement in the pool to keep")
                continue
            v["move_items"][d["item"]] = pool[d["item"]]
            dec, basis = f"place on {pool[d['item']]}", "the primary blind mapper's placement (mapper 1)"
        elif kind == "link_backward":
            v["links"][d["link"]] = "approve"
            dec, basis = "approve", "the independent link checker agreed with the book's evidence"
        else:
            v["acknowledged"].append(d["key"])
            dec, basis = "acknowledge", kind
        decisions.append({"key": d.get("key"), "decision": dec, "detail": d.get("detail"), "basis": basis})
    return v, blocked, decisions


# ============================================================================ G2
def g2_rule(item: dict) -> tuple[str, str] | None:
    """The AI checks' own verdict on an S3 item that owes G2 one, or None (no verdict: the assembly holds it)."""
    if item.get("answer_type") == "not_markable" and not item.get("typing_problems"):
        return None                          # teaching only: nothing is marked, so G2 owes it no verdict (see g2_merge)
    if item.get("typing_problems"):
        return "exclude", "the answer-typing check flagged it (" + "; ".join(item["typing_problems"])[:300] + \
            "); a fix needs fields a person or a recommendation must write"
    if item.get("verification") == "no_printed_answer" and item.get("agreed_with_book_solution"):
        return "accept", "no printed answer; the blind re-solve agreed with the book's worked solution"
    return None


def g2_items(run: dict, chapter: int | None, prefix: str) -> dict[str, dict]:
    """'<lesson>:<ref>' -> the facts G2 rules on, from an S2–S4 run (a workflow result, or its saved file)."""
    run = run.get("result", run)
    out: dict[str, dict] = {}
    for l in run.get("lessons") or []:
        if not l or (chapter is not None and not str(l.get("lesson", "")).startswith(f"{prefix}{chapter}s")):
            continue
        v = l.get("verify") or {}
        typing = {x["ref"]: x.get("problems") or [] for x in v.get("typing_problems") or []}
        nopa = {x["ref"]: x for x in v.get("no_printed_answer") or []}
        dis = {x["ref"] for x in v.get("disagreements") or []}
        for it in l.get("items") or []:
            ref = it.get("ref")
            # options the book never printed that an older collection let through (COLLECT-6 refuses them at the source;
            # lesson-runs adds the same problem to the item, so G2 must rule on it)
            audit = choice_option_problems(it)
            if ref in typing or ref in nopa or ref in dis or audit:
                out[f"{l['lesson']}:{ref}"] = {
                    "typing_problems": [*(typing.get(ref) or it.get("typing_problems") or []), *audit],
                    "answer_type": it.get("answer_type"),
                    "verification": "disputed" if ref in dis else ("no_printed_answer" if ref in nopa
                                                                   else it.get("verification")),
                    "agreed_with_book_solution": bool((nopa.get(ref) or {}).get("agreed_with_book_solution"))}
    return out


def g2_retyped(run: dict, chapter: int | None, prefix: str) -> list[dict]:
    """The choices the collection typed again from the book's printed key (lesson.workflow.js COLLECT-6): informational
    decisions for the record — they carry no verdict, and Samuel sees them beside the verdicts."""
    run = run.get("result", run)
    out: list[dict] = []
    for l in run.get("lessons") or []:
        if not l or (chapter is not None and not str(l.get("lesson", "")).startswith(f"{prefix}{chapter}s")):
            continue
        for r in (l.get("verify") or {}).get("retyped") or []:
            out.append({"key": f"{l['lesson']}:{r['ref']}", "decision": f"typed again as {r['as']} (key {r.get('key')})",
                        "basis": "the options were the typing agent's inventions, not the book's"
                                 + (f" ({'; '.join(r.get('because') or [])[:200]})" if r.get("because") else "")})
    return out


def g2_merge(owed: dict[str, dict], recommended: dict | None, existing: dict | None) -> tuple[dict, dict, list[dict]]:
    """G2's file with an auto verdict for every owed item no human has decided: the recommendation's when there
    is one, else the AI checks' rule; an item neither covers stays without a verdict (held). A human verdict
    already there is kept as it is. Returns (file, counts, decisions)."""
    by = review_policy.auto_pass_by("G2")
    out = dict(existing or {})
    items = dict(out.get("items") or {})
    if not out.get("by"):
        out["by"], out["auto"] = by, True          # nobody human signed this file: all of it is auto
    recs = (recommended or {}).get("items") or {}
    c = {"human": 0, "recommended": 0, "rule": 0, "held": 0}
    decisions: list[dict] = []
    for key in sorted(set(owed) | set(recs)):
        if key in items and not (items[key].get("auto") or review_policy.is_auto(items[key].get("by"))):
            c["human"] += 1
            continue
        r = recs.get(key)
        if r and r.get("verdict") in ("accept", "fix", "hold", "exclude"):
            entry = {"verdict": r["verdict"], "auto": True, "by": by,
                     "note": f"{by}: " + (r.get("note") or r.get("class") or "")}
            entry.update({k: r[k] for k in ("fields", "samuel_verdict", "stem_fix_by") if r.get(k)})
            basis = " · ".join(x for x in (r.get("class"), r.get("confidence") and f"confidence {r['confidence']}")
                               if x) or "the recommendation"
            c["recommended"] += 1
        elif key in owed and (rule := g2_rule(owed[key])):
            entry = {"verdict": rule[0], "auto": True, "by": by, "note": f"{by}: {rule[1]}"}
            basis = rule[1]
            c["rule"] += 1
        elif key in owed and owed[key].get("answer_type") == "not_markable" and not owed[key].get("typing_problems"):
            # typed not markable: it becomes teaching material whatever G2 says, and nothing is marked, so nothing is held
            c["teaching"] = c.get("teaching", 0) + 1
            decisions.append({"key": key, "decision": "no verdict needed — teaching only (typed not markable)",
                              "basis": "the answer is not marked; the book's solution is shown as the book has it"})
            continue
        else:
            c["held"] += 1
            decisions.append({"key": key, "decision": "no verdict — held (answer_mismatch / unverified)",
                              "basis": "the three-way check disagreed and nothing recommends a verdict"})
            if key in items:              # an earlier auto verdict nothing supports any more
                del items[key]
            continue
        items[key] = entry
        decisions.append({"key": key, "decision": entry["verdict"], "detail": r.get("note") if r else None,
                          "basis": basis})
    out["items"] = items
    return out, c, decisions


# ============================================================================ G3, G4
def g3_verdicts(queues: list[dict]) -> dict:
    ids = sorted({q for f in queues for q in f.get("question_ids") or []})
    return {"bundle": ", ".join(f.get("bundle") or "?" for f in queues), "gate": "G3", "auto": True,
            "reviewer": review_policy.auto_pass_by("G3"), "at": _now(),
            "rule": "answer 37c: S6's blind grade and S7's verifier passed every family and template in the "
                    "bundles; the held claims (decision 47) stay held",
            "verdicts": {q: "accept" for q in ids}}


def held_claims(bundles: list[dict]) -> list[dict]:
    """The predicate→misconception claims a widget bundle holds (decision 47): `choices.pending_review`."""
    out = []
    for b in bundles:
        for q in b.get("questions") or []:
            ch = q.get("choices") if isinstance(q.get("choices"), dict) else {}
            for c in ch.get("pending_review") or []:
                out.append({"key": f"{q['id']}|{c.get('predicate')}|{c.get('misconception_id')}",
                            "decision": "held (inactive)", "basis": "the AI verifier did not confirm the claim"})
    return out


def g4_lists(catalogue: dict, s5: dict) -> tuple[list[str], list[str]]:
    s5 = s5.get("result", s5)
    kept = sorted(m["id"] for m in catalogue.get("misconceptions") or [])
    dropped = sorted({d.get("id") or d.get("entry_id") or json.dumps(d, sort_keys=True)[:80]
                      for r in (s5.get("records") or []) for d in r.get("dropped") or []})
    return kept, dropped


# ============================================================================ G5
def g5_evaluate(coverage: dict, parity: list[tuple[str, str, list[str]]]) -> tuple[list[str], list[str], list[dict]]:
    """(blocked, for_review, checks) from the coverage report and the drift guard [(course, state, problems)]."""
    blocked, review, checks = [], [], []
    for course, state, problems in parity:
        checks.append({"name": f"drift guard {course}", "state": state.lower(), "detail": "; ".join(problems[:4])})
        if state != "GREEN":
            blocked.append(f"parity {state} for {course}: {'; '.join(problems[:4])}")
    for c in coverage.get("checks") or []:
        state = c.get("state")
        first = "; ".join(f"{f['scope']}: {f['detail']}" for f in (c.get("failures") or [])[:3])
        safety = c["id"] in SAFETY_CHECKS
        checks.append({"name": f"coverage {c['id']}" + (" (safety)" if safety else ""),
                       "state": {"holds": "green", "excepted": "excepted", "fails": "red"}.get(state, state),
                       "detail": f"{c.get('got')}/{c.get('want')}" + (f" — {first}" if first else "")})
        if state != "fails":
            continue
        (blocked if safety else review).append(
            f"coverage {'safety ' if safety else ''}check {c['id']} fails ({c.get('got')}/{c.get('want')}): {first}")
    return blocked, review, checks


def parity_results(dsn: str, book, book_config_path: Path | None) -> list[tuple[str, str, list[str]]]:
    """The drift guard for every course with a constant, and this book's course against its bundles when it
    has none yet (T364) — as dryrun_chapter does."""
    import parity_check
    out = []
    for b in book_config.all_books():
        if not b.parity:
            continue
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            code, _ = parity_check.check_course(b.course_id, dsn, None)
        problems = [l.strip().lstrip("✗").strip() for l in buf.getvalue().splitlines()
                    if l.strip().startswith(("✗", "ERROR"))]
        out.append((b.course_id, {0: "GREEN", 1: "RED"}.get(code, "ERROR"), problems))
    if not book.parity:
        cfg = book_config.load_book(book_config_path) if book_config_path else book
        want = book_config.expected_from_bundles(cfg)
        fp = parity_check.fingerprint(dsn, book.course_id)
        problems = parity_check.check_expected(fp, book_config.Parity(**want))
        out.append((book.course_id, "GREEN" if not problems else "RED",
                    problems or [f"matches its bundles: {want}"]))
    return out


def cost_of(ledger: Path, book, chapter: int | None) -> dict:
    if not ledger.exists():
        return {}
    usd_book = usd_ch = 0.0
    prefix = f"{book.id_prefixes[0]}{chapter}s" if chapter is not None else None
    for line in ledger.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        usd_book += sum((v or {}).get("usd") or 0 for v in (r.get("by_lesson") or {}).values())
        if prefix:
            usd_ch += sum((v or {}).get("usd") or 0 for k, v in (r.get("by_lesson") or {}).items()
                          if str(k).startswith(prefix))
    return {"book_usd": round(usd_book, 2), **({"chapter_lessons_usd": round(usd_ch, 2)} if prefix else {})}


# ============================================================================ CLI
def main(argv: list[str] | None = None) -> int:
    import argparse
    import os
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="gate", required=True)

    def common(p):
        p.add_argument("book")
        p.add_argument("--chapter", type=int, help="the chapter the decision is for (else the whole book)")
        p.add_argument("--run", help="the run the decision belongs to (recorded as `run`)")
        p.add_argument("--gates-dir", type=Path, help="where the decision records go (default runs/<book>/gates)")
        return p
    a1 = common(sub.add_parser("g1", help="objectives: answer every owed decision on the AI recommendation"))
    a1.add_argument("--objectives-dir", type=Path)
    a1.add_argument("--out", type=Path)
    a1.add_argument("--approve", action="store_true", help="then run assemble_objectives.py approve with it")
    a2 = common(sub.add_parser("g2", help="book questions: auto verdicts from the recommendation and the AI checks"))
    a2.add_argument("--lesson-run", "--from-run", dest="lesson_run", type=Path, action="append", default=[],
                    help="the S2–S4 run(s) (runs/<book>/lessons/<runId>.json): the items that owe G2 a verdict")
    a2.add_argument("--recommend", type=Path, help="a recommendation file ({items: {key: {verdict, …}}})")
    a2.add_argument("--into", type=Path, help="G2's file (default runs/<book>/g2.json); human verdicts kept")
    a3 = common(sub.add_parser("g3", help="generated sample: accepted on the AI checks"))
    a3.add_argument("--queue", type=Path, action="append", required=True)
    a3.add_argument("--widgets", type=Path, action="append", default=[],
                    help="widget bundle(s), to list their held claims in the record")
    a3.add_argument("--out", type=Path)
    a4 = common(sub.add_parser("g4", help="catalogue: a record of what S5 kept"))
    a4.add_argument("--catalogue", type=Path, required=True)
    a4.add_argument("--s5", type=Path, required=True)
    a5 = common(sub.add_parser("g5", help="go/no-go on coverage, the drift guard and cost (deploys nothing)"))
    a5.add_argument("--coverage", type=Path, required=True)
    a5.add_argument("--book-config", type=Path, help="the book config whose bundles were loaded (the pilot's)")
    a5.add_argument("--dryrun", type=Path, help="the dry run's report, as evidence")
    a5.add_argument("--ledger", type=Path, help="the cost ledger (default runs/<book>/cost.jsonl)")
    a5.add_argument("--dsn", default=os.environ.get("AINEXT_DB_DSN"), help="the database the chapter was loaded into")
    a = ap.parse_args(argv)

    book = book_config.load_book(a.book)
    gates_dir = a.gates_dir or HERE / "runs" / book.book / "gates"
    ch = a.chapter
    scope = f"ch{ch:02d}" if ch is not None else "book"

    if a.gate == "g1":
        if ch is None:
            ap.error("g1 needs --chapter")
        odir = a.objectives_dir or HERE / "objectives" / book.book
        check_path = odir / f"ch{ch:02d}.check.json"
        v, blocked, decisions = g1_verdicts(json.loads(check_path.read_text()))
        out = a.out or HERE / "runs" / book.book / "objectives" / f"g1-ch{ch:02d}.auto.json"
        if not blocked:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(v, ensure_ascii=False, indent=1) + "\n")
        moved = [d["key"] for d in decisions if d["decision"].startswith(("place on", "outside"))]
        rec = decision_record(
            "G1", book, ch, (f"G1 not auto-passed: {len(blocked)} item(s) need the pipeline fixed or a person"
                             if blocked else f"{len(decisions)} owed objective decision(s) taken on the AI "
                                             "line's recommendation"),
            decisions=decisions, blocked=blocked, for_review=moved, run=a.run,
            checks=[{"name": "S1 two blind finders + reconciler", "state": "done"},
                    {"name": "S1 independent evidence check", "state": "done"},
                    {"name": "two blind end-of-chapter mappers", "state": "done"},
                    {"name": "independent prerequisite-link checker", "state": "done"}],
            evidence=[("G1 check", check_path), ("G1 verdicts (auto)", None if blocked else out),
                      ("G1 page", odir / f"ch{ch:02d}.review.html")])
        where = write_record(rec, gates_dir)
        if blocked:
            print(f"G1 NOT auto-passed ({scope}): {len(blocked)} item(s) need the pipeline fixed or a person:",
                  file=sys.stderr)
            for b in blocked:
                print(f"  BLOCKED {b}", file=sys.stderr)
            print(f"  record: {_rel(where)}", file=sys.stderr)
            return 1
        print(f"G1 auto-pass ({scope}): {len(decisions)} decision(s) on the AI recommendation -> {_rel(out)}\n"
              f"  record: {_rel(where)}")
        if a.approve:
            import assemble_objectives
            return assemble_objectives.main(["approve", book.book, "--chapter", str(ch), "--by",
                                             review_policy.auto_pass_by("G1"), "--verdicts", str(out)])
        print(f"  next: uv run assemble_objectives.py approve {book.book} --chapter {ch} "
              f"--by \"{review_policy.auto_pass_by('G1')}\" --verdicts {_rel(out)}")
        return 0

    if a.gate == "g2":
        if not a.lesson_run and not a.recommend:
            ap.error("g2 needs --lesson-run (the S2–S4 run) and/or --recommend")
        owed: dict[str, dict] = {}
        for p in a.lesson_run:
            owed.update(g2_items(json.loads(p.read_text()), ch, book.id_prefixes[0]))
        into = a.into or HERE / "runs" / book.book / "g2.json"
        existing = json.loads(into.read_text()) if into.exists() else None
        rec_in = json.loads(a.recommend.read_text()) if a.recommend else None
        if rec_in and ch is not None:      # a recommendation file may hold other chapters: this one only
            rec_in = {**rec_in, "items": {k: v for k, v in (rec_in.get("items") or {}).items()
                                          if k.startswith(f"{book.id_prefixes[0]}{ch}s")}}
        doc, c, decisions = g2_merge(owed, rec_in, existing)
        into.parent.mkdir(parents=True, exist_ok=True)
        into.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
        held = [d["key"] for d in decisions if d["decision"].startswith(("no verdict", "hold", "exclude"))]
        rec = decision_record(
            "G2", book, ch, f"{c['recommended'] + c['rule']} book item(s) decided on the AI recommendation "
                            f"({c['recommended']} from the recommendation file, {c['rule']} by the checks' own rule); "
                            f"{c['held']} held for a person; {c['human']} already decided by a person",
            decisions=decisions, held=bool(held), for_review=held, run=a.run,
            checks=[{"name": "S3 three-way answer check (printed, EPUB solution, blind re-solve)", "state": "done"},
                    {"name": "S3 answer typing check", "state": "done"},
                    {"name": "the app's marker on every typed key (assembly)", "state": "on load"}],
            evidence=[("G2 verdicts", into), ("recommendation", a.recommend)]
                     + [(f"S2–S4 run {p.stem}", p) for p in a.lesson_run])
        where = write_record(rec, gates_dir)
        print(f"G2 auto-pass ({scope}): {c['recommended']} from the recommendation, {c['rule']} by the AI checks' "
              f"rule, {c['held']} left held, {c['human']} human verdict(s) kept -> {_rel(into)}\n"
              f"  record: {_rel(where)}")
        return 0

    if a.gate == "g3":
        doc = g3_verdicts([json.loads(p.read_text()) for p in a.queue])
        out = a.out or HERE / "runs" / book.book / f"g3-{scope}.auto.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
        held = held_claims([json.loads(p.read_text()) for p in a.widgets])
        rec = decision_record(
            "G3", book, ch, f"{len(doc['verdicts'])} sampled item(s) accepted on the AI checks; {len(held)} "
                            "predicate claim(s) stay held, as the verifier recommends",
            decisions=[{"key": q, "decision": "accept", "basis": "its family passed S6's blind grade / S7's verifier"}
                       for q in doc["verdicts"]] + held,
            held=bool(held), for_review=[h["key"] for h in held], run=a.run,
            checks=[{"name": "S6 blind grader, every family in the bundle", "state": "pass"},
                    {"name": "S7 verifier, every template", "state": "pass"},
                    {"name": "the app's marker on every typed key (load)", "state": "pass"}],
            evidence=[("G3 verdicts (auto)", out)] + [(f"review queue {p.name}", p) for p in a.queue]
                     + [(f"widget bundle {p.name}", p) for p in a.widgets])
        where = write_record(rec, gates_dir)
        print(f"G3 auto-pass ({scope}): {len(doc['verdicts'])} sampled item(s) accepted on the AI checks -> {_rel(out)}\n"
              f"  record: {_rel(where)}\n"
              f"  next: uv run apply_review_verdicts.py {_rel(out)}   (adds to ai_checked_by, never reviewed_by)")
        return 0

    if a.gate == "g4":
        kept, dropped = g4_lists(json.loads(a.catalogue.read_text()), json.loads(a.s5.read_text()))
        rec = decision_record(
            "G4", book, ch, f"{len(kept)} catalogue entr(ies) kept by S5's verifier, {len(dropped)} dropped by it",
            decisions=[{"key": k, "decision": "keep", "basis": "S5's verifier confirmed it"} for k in kept]
                      + [{"key": d, "decision": "dropped", "basis": "S5's verifier did not confirm it"} for d in dropped],
            held=bool(dropped), run=a.run,
            checks=[{"name": "S5 author + fail-closed verifier", "state": "pass"},
                    {"name": "load_generated_questions --catalogue-only", "state": "pass"}],
            evidence=[("catalogue", a.catalogue), ("S5 final", a.s5)])
        where = write_record(rec, gates_dir)
        print(f"G4 auto-pass ({scope}, record): {len(kept)} kept, {len(dropped)} dropped by the verifier\n"
              f"  record: {_rel(where)}")
        return 0

    # G5
    if not a.dsn:
        ap.error("g5 needs the database the chapter was loaded into (--dsn or AINEXT_DB_DSN)")
    coverage = json.loads(a.coverage.read_text())
    blocked, review, checks = g5_evaluate(coverage, parity_results(a.dsn, book, a.book_config))
    ledger = a.ledger or HERE / "runs" / book.book / "cost.jsonl"
    cost = cost_of(ledger, book, ch)
    if cost:
        checks.append({"name": "cost ledger", "state": "recorded",
                       "detail": f"${cost['book_usd']} metered for the book"
                                 + (f", ${cost['chapter_lessons_usd']} on this chapter's lessons"
                                    if "chapter_lessons_usd" in cost else "")})
    gates = [(f"{g} record", gates_dir / f"{record_id(g, ch)}.json") for g in ("G1", "G2", "G3", "G4")]
    rec = decision_record(
        "G5", book, ch,
        ("NO-GO: an automatic safety check fails" if blocked else
         "GO for the fan-out on the dev/pilot database (deploys and promotes nothing)")
        + f"; coverage {coverage.get('status')}, {len(review)} completeness finding(s) for Samuel",
        decisions=[{"key": "go/no-go", "decision": "no-go" if blocked else "go",
                    "basis": "parity GREEN for every course and no coverage safety check failing"}],
        checks=checks, blocked=blocked, for_review=review, run=a.run,
        evidence=[("coverage", a.coverage), ("dry run", a.dryrun), ("cost ledger", ledger if cost else None)]
                 + [(label, p) for label, p in gates if p.exists()])
    where = write_record(rec, gates_dir)
    print(f"G5 auto-pass ({scope}): {rec['outcome'].upper()} — {rec['summary']}\n  record: {_rel(where)}")
    for b in blocked:
        print(f"  BLOCKED {b}")
    for r in review:
        print(f"  for Samuel: {r}")
    return 1 if blocked else 0


if __name__ == "__main__":
    sys.exit(main())

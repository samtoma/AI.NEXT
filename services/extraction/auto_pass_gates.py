"""Auto-pass the human gates G1–G5 during the fan-out, and record every decision for Samuel's review.

Samuel's answer 37c (2026-10-01): *"Auto-pass, review later"* — during the full-book fan-out the pipeline
proceeds on the AI checks' recommendation, every decision lands in the console's review backlog (37b),
and the AUTOMATIC SAFETY CHECKS STILL BLOCK (broken maths, answers vs the book, a missing or
answer-revealing figure, parity). His follow-up the same day (answer 39): the auto-pass covers G5, the
final go/no-go, too — and every auto-passed decision is RECORDED, machine-readably, for his review.
G5's auto-pass is a pipeline go for the next stage only: it never deploys or promotes anything to
production.

AN AUTO-PASS IS NEVER A HUMAN STAMP (migration 035, answer 33). Every verdict this writes is signed
"auto-pass G<n> (AI recommendation)" and marked `"auto": true`; the loaders write it to `ai_checked_by`,
never `reviewed_by`, and `gate_decisions` refuses an auto row signed as anybody else.

    uv run auto_pass_gates.py g1 <book> --chapter 8
        every decision G1 owes (objectives/<book>/chNN.check.json `undecided`) answered by the AI line's
        own recommendation: a single-finder objective the evidence check kept → approve; a terminology flag
        → keep; two mappers disagreeing → the placement the pool already uses (mapper 1); a backward link
        the independent checker agreed → approve; an unpractised objective or a finder objective with no
        home → acknowledged; an end-of-chapter item both blind mappers placed nowhere → outside the
        chapter's objectives, with that reason. A pipeline failure (links not run or failed, any other rule
        failure) is NOT auto-passed: the record says `blocked`, and the command exits 1. Then:
          uv run assemble_objectives.py approve <book> --chapter 8 \\
              --by "auto-pass G1 (AI recommendation)" --verdicts runs/<book>/objectives/g1-ch08.auto.json
    uv run auto_pass_gates.py g2 <book> --chapter 8 --recommend runs/<book>/g2-ch08.recommended.json
        every recommended item with no human verdict yet gets the recommendation as an auto verdict, in
        G2's own file (default runs/<book>/g2.json; a human's verdict there is kept). An item with no
        recommendation gets nothing and stays HELD by the assembly (answer_mismatch / unverified — the
        "answers vs the book" check blocks). Then `assemble_objectives.py lesson-runs … --g2`, assemble,
        load and `apply_review_verdicts.py --g2` as for a human G2 file.
    uv run auto_pass_gates.py g3 <book> --chapter 8 --queue <bundle>.review-queue.json [--queue …]
        the sampled items accepted on the AI checks (S6's blind grade passed every family in the bundle,
        S7's verifier every template); apply with `apply_review_verdicts.py runs/<book>/g3-ch08.auto.json`,
        which ADDS the auto-pass to ai_checked_by. Held predicate→misconception claims (decision 47) follow
        the verifier: they stay held (inactive) and are listed in the record, so there is no
        `--mapping-review` step.
    uv run auto_pass_gates.py g4 <book> --chapter 8 --catalogue seed/generated/<book>/misconceptions.json \\
              --s5 runs/<book>/misconceptions/final-<run>.json
        a record: the catalogue holds exactly what S5's verifier kept (the loader refuses anything else).
    uv run auto_pass_gates.py g5 <book> --chapter 8 --coverage coverage/<book>.json \\
              [--book-config work/<book>/pilot/books/<book>.json] [--dryrun <dry-run report>] [--dsn …]
        the go/no-go on the evidence: the drift guard for every course (parity_check, GREEN required),
        the coverage audit (a SAFETY check failing — katex, notation, answer_text, asked_forms,
        book_pictures, captions, teacher_only, s5_catalogue, solution_sources, distractor_refutations —
        blocks; a completeness check failing is listed for Samuel and does not), and the cost ledger.
        `passed` lets the fan-out continue on the pilot/dev database; it deploys nothing.

GATE DECISION RECORDS (every subcommand; runbook/README.md "Gate decision records"). One JSON file per
gate and scope, `runs/<book>/gates/<book>:<scope>:<gate>.json` with ':' as '__' in the file name, and —
when a database is given (`--dsn` or AINEXT_DB_DSN) and migration 035 is applied — the same record as a
row of `gate_decisions` (id = "<book>:<scope>:<gate>"). A re-run replaces the record for that gate and
scope. Shape (format ainext.gate-decision/1):

    {"format": "ainext.gate-decision/1", "id": "g10-math:ch08:G3", "gate": "G3", "book": "g10-math",
     "course_id": "course:us-g10-math-en", "scope": "ch08", "chapter": 8,
     "outcome": "passed" | "blocked", "auto": true, "decided_by": "auto-pass G3 (AI recommendation)",
     "decided_at": "<UTC ISO>", "summary": "<one sentence>",
     "decided": [{"item": "<what>", "verdict": "<what was decided>", "why": "<the recommendation>"}],
     "rests_on": ["<the automatic / AI checks the decision relies on>"],
     "blocking": ["<an automatic check that failed — non-empty iff outcome is blocked>"],
     "for_review": ["<what Samuel should look at first>"],
     "evidence": {"<name>": "<repo-relative path>"},
     "review": {"status": "awaiting_samuel"}}

No model is called; every subcommand is deterministic over files the AI stages already wrote.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import book_config
import review_policy

HERE = Path(__file__).resolve().parent
FORMAT = "ainext.gate-decision/1"
NONE_PLACED = re.compile(r"^distributed item (\S+) maps to no objective \(rule 2\): both mappers said none")
# decisions an auto-pass may take (the AI line's own recommendation exists); anything else blocks
AUTO_KINDS = {"single", "terminology", "mappers_disagree", "link_backward", "unpractised", "finder_dropped"}
# coverage checks that are SAFETY checks (answer 37c: they still block); every other check is completeness
SAFETY_CHECKS = {"katex", "notation", "answer_text", "asked_forms", "book_pictures", "captions", "teacher_only",
                 "s5_catalogue", "solution_sources", "distractor_refutations"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _rel(p: Path | str | None) -> str | None:
    if p is None:
        return None
    p = Path(p).resolve()
    try:
        return str(p.relative_to(book_config.REPO_ROOT))
    except ValueError:
        return str(p)


def scope_of(chapter: int | None) -> str:
    return f"ch{chapter:02d}" if chapter is not None else "book"


# ============================================================================ the decision record
def decision_record(gate: str, book, chapter: int | None, outcome: str, summary: str, *,
                    decided: list[dict] | None = None, rests_on: list[str] | None = None,
                    blocking: list[str] | None = None, for_review: list[str] | None = None,
                    evidence: dict | None = None, at: str | None = None) -> dict:
    gate = gate.upper()
    if outcome not in ("passed", "blocked") or (outcome == "blocked") != bool(blocking):
        raise ValueError(f"{gate}: outcome {outcome!r} and blocking {blocking!r} disagree")
    scope = scope_of(chapter)
    return {"format": FORMAT, "id": f"{book.book}:{scope}:{gate}", "gate": gate, "book": book.book,
            "course_id": book.course_id, "scope": scope, "chapter": chapter, "outcome": outcome,
            "auto": True, "decided_by": review_policy.auto_pass_by(gate), "decided_at": at or _now(),
            "summary": summary, "decided": decided or [], "rests_on": rests_on or [],
            "blocking": blocking or [], "for_review": for_review or [],
            "evidence": {k: v for k, v in (evidence or {}).items() if v},
            "review": {"status": "awaiting_samuel"}}


def record_path(gates_dir: Path, rec: dict) -> Path:
    return gates_dir / (rec["id"].replace(":", "__") + ".json")


def write_record(rec: dict, gates_dir: Path, dsn: str | None) -> tuple[Path, str]:
    """The JSON file, and the `gate_decisions` row when a database (with 035) is given."""
    text = json.dumps(rec, ensure_ascii=False, indent=1, sort_keys=False) + "\n"
    path = record_path(gates_dir, rec)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    where = f"{_rel(path)}"
    if dsn:
        import psycopg
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT to_regclass('public.gate_decisions') IS NOT NULL")
            if not cur.fetchone()[0]:
                return path, where + " (no gate_decisions table: apply migration 035 to record it in the database)"
            cur.execute(
                """INSERT INTO gate_decisions (id, gate, book, course_id, scope, outcome, decided_by, auto,
                                               decided_at, record, record_sha256)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                   ON CONFLICT (id) DO UPDATE
                      SET gate = EXCLUDED.gate, book = EXCLUDED.book, course_id = EXCLUDED.course_id,
                          scope = EXCLUDED.scope, outcome = EXCLUDED.outcome, decided_by = EXCLUDED.decided_by,
                          auto = EXCLUDED.auto, decided_at = EXCLUDED.decided_at, record = EXCLUDED.record,
                          record_sha256 = EXCLUDED.record_sha256""",
                (rec["id"], rec["gate"], rec["book"], rec["course_id"], rec["scope"], rec["outcome"],
                 rec["decided_by"], rec["auto"], rec["decided_at"], json.dumps(rec, ensure_ascii=False),
                 hashlib.sha256(text.encode("utf-8")).hexdigest()))
            conn.commit()
        where += " + gate_decisions"
    return path, where


# ============================================================================ G1
def g1_verdicts(check: dict) -> tuple[dict, list[str], list[dict]]:
    """The G1 verdicts file (assemble_objectives.py approve --verdicts) answering every owed decision on
    the AI recommendation, what blocks an auto-pass (a pipeline failure is never papered over), and the
    decisions for the record."""
    by = review_policy.auto_pass_by("G1")
    v: dict = {"auto": True, "by": by, "terminology": {}, "move_items": {}, "links": {}, "acknowledged": [],
               "objectives": {}, "outside_items": {}}
    blocked: list[str] = []
    decided: list[dict] = []
    pool = check.get("pool") or {}
    for f in check.get("failures") or []:
        m = NONE_PLACED.match(f)
        if m:
            why = "both blind mappers placed it nowhere, so no objective of this chapter practises it"
            v["outside_items"][m.group(1)] = {"why": f"{by}: {why}"}
            decided.append({"item": m.group(1), "verdict": "outside this chapter's objectives", "why": why})
        else:
            blocked.append(f"failure: {f}")
    for d in check.get("undecided") or []:
        kind = d.get("kind")
        if kind not in AUTO_KINDS:
            blocked.append(f"{kind}: {d.get('detail')} (key {d.get('key')})")
            continue
        if kind == "single":
            v["objectives"][d["objective"]] = {"action": "approve", "why": f"{by}: the evidence check kept it"}
            verdict, why = "approve", "one finder found it and the independent evidence check kept its evidence"
        elif kind == "terminology":
            v["terminology"][d["key"].split(":", 1)[1]] = "keep"
            verdict, why = "keep", "a flag for a term the book itself uses"
        elif kind == "mappers_disagree":
            if not pool.get(d["item"]):
                blocked.append(f"mappers_disagree: {d['item']} has no placement in the pool to keep")
                continue
            v["move_items"][d["item"]] = pool[d["item"]]
            verdict, why = f"place on {pool[d['item']]}", "the primary blind mapper's placement (mapper 1)"
        elif kind == "link_backward":
            v["links"][d["link"]] = "approve"
            verdict, why = "approve", "the independent link checker agreed with the book's evidence"
        else:
            v["acknowledged"].append(d["key"])
            verdict, why = "acknowledge", d.get("detail") or kind
        decided.append({"item": d.get("key"), "verdict": verdict, "why": why})
    return v, blocked, decided


# ============================================================================ G2
def g2_merge(recommended: dict, existing: dict | None) -> tuple[dict, dict, list[dict]]:
    """G2's file with every recommended item that has no verdict yet added as an auto verdict. A human
    verdict already there is kept as it is. Returns (file, counts, decided)."""
    by = review_policy.auto_pass_by("G2")
    out = dict(existing or {})
    items = dict(out.get("items") or {})
    if not out.get("by"):
        out["by"], out["auto"] = by, True          # nobody human signed this file: all of it is auto
    added = kept = 0
    decided: list[dict] = []
    for key, r in sorted((recommended.get("items") or {}).items()):
        if key in items:
            kept += 1
            continue
        if (r or {}).get("verdict") not in ("accept", "fix", "hold", "exclude"):
            continue
        entry = {"verdict": r["verdict"], "auto": True, "by": by,
                 "note": f"{by}: " + (r.get("note") or r.get("class") or "")}
        if r.get("fields"):
            entry["fields"] = r["fields"]
        for k in ("samuel_verdict", "stem_fix_by"):
            if r.get(k):
                entry[k] = r[k]
        items[key] = entry
        added += 1
        decided.append({"item": key, "verdict": r["verdict"],
                        "why": " · ".join(x for x in (r.get("class"), r.get("confidence") and
                                                      f"confidence {r['confidence']}", r.get("note")) if x)})
    out["items"] = items
    return out, {"added": added, "kept_human": kept, "recommended": len(recommended.get("items") or {})}, decided


# ============================================================================ G3, G4
def g3_verdicts(queues: list[dict]) -> dict:
    ids = sorted({q for f in queues for q in f.get("question_ids") or []})
    return {"bundle": ", ".join(f.get("bundle") or "?" for f in queues), "auto": True,
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
                out.append({"item": f"{q['id']}|{c.get('predicate')}|{c.get('misconception_id')}",
                            "verdict": "held (inactive)", "why": "the AI verifier did not confirm the claim"})
    return out


def g4_record_lists(catalogue: dict, s5: dict) -> tuple[list[str], list[str]]:
    kept = sorted(m["id"] for m in catalogue.get("misconceptions") or [])
    dropped = sorted({d.get("id") or d.get("entry_id") or json.dumps(d, sort_keys=True)[:80]
                      for r in (s5.get("records") or []) for d in r.get("dropped") or []})
    return kept, dropped


# ============================================================================ G5
def g5_evaluate(coverage: dict, parity: list[tuple[str, str, list[str]]]) -> tuple[list[str], list[str], list[dict]]:
    """(blocking, for_review, decided) from the coverage report and the drift guard's results
    [(course, GREEN|RED|ERROR, problems)]."""
    blocking, review, decided = [], [], []
    for course, state, problems in parity:
        decided.append({"item": f"drift guard {course}", "verdict": state, "why": "; ".join(problems[:4]) or "holds"})
        if state != "GREEN":
            blocking.append(f"parity {state} for {course}: {'; '.join(problems[:4])}")
    for c in coverage.get("checks") or []:
        if c.get("state") != "fails":
            continue
        first = "; ".join(f"{f['scope']}: {f['detail']}" for f in (c.get("failures") or [])[:3])
        if c["id"] in SAFETY_CHECKS:
            blocking.append(f"coverage safety check {c['id']} fails ({c.get('got')}/{c.get('want')}): {first}")
        else:
            review.append(f"coverage {c['id']} fails ({c.get('got')}/{c.get('want')}): {first}")
        decided.append({"item": f"coverage {c['id']}", "verdict": "fails",
                        "why": "safety — blocks" if c["id"] in SAFETY_CHECKS else "completeness — for Samuel"})
    return blocking, review, decided


def parity_results(dsn: str, book, book_config_path: Path | None) -> list[tuple[str, str, list[str]]]:
    """The drift guard for every course with a constant, and this book's course against its bundles when
    it has none yet (T364) — as dryrun_chapter does."""
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
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="gate", required=True)

    def common(p):
        p.add_argument("book")
        p.add_argument("--chapter", type=int, help="the chapter the decision is for (scope chNN; else 'book')")
        p.add_argument("--gates-dir", type=Path, help="where the decision records go (default runs/<book>/gates)")
        p.add_argument("--dsn", default=os.environ.get("AINEXT_DB_DSN"),
                       help="also record the decision in gate_decisions (migration 035)")
        return p
    a1 = common(sub.add_parser("g1", help="objectives: answer every owed decision on the AI recommendation"))
    a1.add_argument("--objectives-dir", type=Path)
    a1.add_argument("--out", type=Path)
    a2 = common(sub.add_parser("g2", help="book questions: the recommendation as auto verdicts"))
    a2.add_argument("--recommend", type=Path, required=True)
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
    a = ap.parse_args(argv)

    book = book_config.load_book(a.book)
    gates_dir = a.gates_dir or HERE / "runs" / book.book / "gates"
    ch = a.chapter
    scope = scope_of(ch)

    if a.gate == "g1":
        if ch is None:
            ap.error("g1 needs --chapter")
        odir = a.objectives_dir or HERE / "objectives" / book.book
        check_path = odir / f"ch{ch:02d}.check.json"
        v, blocked, decided = g1_verdicts(json.loads(check_path.read_text()))
        out = a.out or HERE / "runs" / book.book / "objectives" / f"g1-ch{ch:02d}.auto.json"
        if not blocked:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(v, ensure_ascii=False, indent=1) + "\n")
        rec = decision_record(
            "G1", book, ch, "blocked" if blocked else "passed",
            (f"{len(blocked)} item(s) need the pipeline fixed or a human" if blocked else
             f"{len(decided)} owed objective decision(s) taken on the AI line's recommendation"),
            decided=decided, blocking=blocked,
            rests_on=["S1: two blind objective finders + a reconciler; an independent evidence check",
                      "two blind end-of-chapter mappers; an independent prerequisite-link checker"],
            for_review=[d["item"] for d in decided if d["verdict"].startswith(("place on", "outside"))],
            evidence={"check": _rel(check_path), "verdicts": None if blocked else _rel(out),
                      "review_page": _rel(odir / f"ch{ch:02d}.review.html")})
        _, where = write_record(rec, gates_dir, a.dsn)
        if blocked:
            print(f"G1 NOT auto-passed ({scope}): {len(blocked)} item(s) need the pipeline fixed or a human:",
                  file=sys.stderr)
            for b in blocked:
                print(f"  BLOCKED {b}", file=sys.stderr)
            print(f"  record: {where}", file=sys.stderr)
            return 1
        print(f"G1 auto-pass ({scope}): {len(decided)} decision(s) on the AI recommendation -> {_rel(out)}\n"
              f"  record: {where}\n"
              f"  next: uv run assemble_objectives.py approve {book.book} --chapter {ch} "
              f"--by \"{review_policy.auto_pass_by('G1')}\" --verdicts {_rel(out)}")
        return 0

    if a.gate == "g2":
        into = a.into or HERE / "runs" / book.book / "g2.json"
        rec_in = json.loads(a.recommend.read_text())
        existing = json.loads(into.read_text()) if into.exists() else None
        doc, c, decided = g2_merge(rec_in, existing)
        into.parent.mkdir(parents=True, exist_ok=True)
        into.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
        rec = decision_record(
            "G2", book, ch, "passed",
            f"{c['added']} recommended verdict(s) taken as auto; {c['kept_human']} already decided by a human",
            decided=decided,
            rests_on=["S3: the three-way answer check (printed answer, EPUB worked solution, blind re-solve)",
                      "the AI recommendation file " + str(rec_in.get("prepared_by") or "")],
            for_review=[d["item"] for d in decided if d["verdict"] in ("fix", "exclude", "hold")],
            evidence={"recommendation": _rel(a.recommend), "verdicts": _rel(into)})
        _, where = write_record(rec, gates_dir, a.dsn)
        print(f"G2 auto-pass ({scope}): {c['added']} recommended verdict(s) added as auto, {c['kept_human']} already "
              f"decided (kept), of {c['recommended']} recommended -> {_rel(into)}. Items with no recommendation "
              f"stay held.\n  record: {where}")
        return 0

    if a.gate == "g3":
        doc = g3_verdicts([json.loads(p.read_text()) for p in a.queue])
        out = a.out or HERE / "runs" / book.book / f"g3-{scope}.auto.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
        held = held_claims([json.loads(p.read_text()) for p in a.widgets])
        decided = [{"item": q, "verdict": "accept", "why": "its family passed S6's blind grade / S7's verifier"}
                   for q in doc["verdicts"]] + held
        rec = decision_record(
            "G3", book, ch, "passed",
            f"{len(doc['verdicts'])} sampled item(s) accepted on the AI checks; {len(held)} predicate claim(s) "
            "stay held as the verifier recommends",
            decided=decided,
            rests_on=["S6: every family in the bundle passed the blind grader", "S7: every template verified",
                      "the app's marker checks every typed key; the loader refuses a bundle it cannot mark"],
            for_review=[h["item"] for h in held],
            evidence={"verdicts": _rel(out), **{f"queue_{i}": _rel(p) for i, p in enumerate(a.queue, 1)}})
        _, where = write_record(rec, gates_dir, a.dsn)
        print(f"G3 auto-pass ({scope}): {len(doc['verdicts'])} sampled item(s) accepted on the AI checks -> {_rel(out)}\n"
              f"  record: {where}\n"
              f"  next: uv run apply_review_verdicts.py {_rel(out)}   (adds to ai_checked_by, never reviewed_by)")
        return 0

    if a.gate == "g4":
        kept, dropped = g4_record_lists(json.loads(a.catalogue.read_text()), json.loads(a.s5.read_text()))
        rec = decision_record(
            "G4", book, ch, "passed",
            f"{len(kept)} catalogue entr(ies) kept by S5's verifier, {len(dropped)} dropped by it",
            decided=[{"item": k, "verdict": "keep", "why": "S5's verifier confirmed it"} for k in kept]
                    + [{"item": d, "verdict": "dropped", "why": "S5's verifier did not confirm it"} for d in dropped],
            rests_on=["S5: author + an independent fail-closed verifier",
                      "load_generated_questions --catalogue-only refuses an entry the catalogue lacks"],
            evidence={"catalogue": _rel(a.catalogue), "s5": _rel(a.s5)})
        _, where = write_record(rec, gates_dir, a.dsn)
        print(f"G4 auto-pass ({scope}, record): {len(kept)} kept, {len(dropped)} dropped by the verifier\n"
              f"  record: {where}")
        return 0

    # G5
    if not a.dsn:
        ap.error("g5 needs the database the chapter was loaded into (--dsn or AINEXT_DB_DSN)")
    coverage = json.loads(a.coverage.read_text())
    parity = parity_results(a.dsn, book, a.book_config)
    blocking, review, decided = g5_evaluate(coverage, parity)
    ledger = a.ledger or HERE / "runs" / book.book / "cost.jsonl"
    cost = cost_of(ledger, book, ch)
    if cost:
        decided.append({"item": "cost", "verdict": f"${cost.get('book_usd')} metered for the book"
                        + (f", ${cost['chapter_lessons_usd']} on this chapter's lessons" if "chapter_lessons_usd" in cost
                           else ""), "why": "the cost ledger (meter_run.py)"})
    rec = decision_record(
        "G5", book, ch, "blocked" if blocking else "passed",
        ("NO-GO: an automatic safety check fails" if blocking else
         "GO for the fan-out on the dev/pilot database (deploys and promotes nothing)")
        + f"; coverage {coverage.get('status')}, {len(review)} completeness finding(s) for Samuel",
        decided=decided, blocking=blocking, for_review=review,
        rests_on=["coverage_report.py (safety checks: " + ", ".join(sorted(SAFETY_CHECKS)) + ")",
                  "parity_check.py, the per-solution drift guard, for every course",
                  "the gate records G1–G4 for this scope"],
        evidence={"coverage": _rel(a.coverage), "dryrun": _rel(a.dryrun), "ledger": _rel(ledger) if cost else None,
                  **{f"gate_{g}": _rel(record_path(gates_dir, {"id": f"{book.book}:{scope}:{g}"}))
                     for g in ("G1", "G2", "G3", "G4")
                     if record_path(gates_dir, {"id": f"{book.book}:{scope}:{g}"}).exists()}})
    _, where = write_record(rec, gates_dir, a.dsn)
    print(f"G5 auto-pass ({scope}): {rec['outcome'].upper()} — {rec['summary']}\n  record: {where}")
    for b in blocking:
        print(f"  BLOCKED {b}")
    for r in review:
        print(f"  for Samuel: {r}")
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())

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

    uv run auto_pass_gates.py g1 <book> --chapter 9 [--approve] [--maths runs/<book>/maths/book/accepted.json]
        every decision G1 owes (objectives/<book>/chNN.check.json `undecided`) answered by the AI line's
        own recommendation: a single-finder objective the evidence check kept → approve; a terminology flag
        → keep; two mappers disagreeing → the placement the pool already uses (mapper 1); a backward link
        the independent checker agreed → approve; an unpractised objective or a finder objective with no
        home → acknowledged; an end-of-chapter item both blind mappers placed nowhere → outside the
        chapter's objectives, with that reason. A pipeline failure (links not run or failed, any other rule
        failure) is NOT auto-passed: the record says `blocked` and the command exits 1. Writes
        runs/<book>/objectives/g1-chNN.auto.json; `--approve` then runs
          assemble_objectives.py approve <book> --chapter N --by "auto-pass G1 (AI recommendation)" --verdicts …
        with the SAME maths: `--maths`, else the book's own S0b file runs/<book>/maths/book/accepted.json when it exists
        (without it `approve` would read the pilot's runs/<book>/maths/accepted.json, which lacks the other chapters'
        images, or fail on them), and the same --objectives-dir.
    uv run auto_pass_gates.py g2 <book> --chapter 9 --lesson-run runs/<book>/lessons/<runId>.json \\
              [--recommend runs/<book>/g2-ch09.recommended.json] --into runs/<book>/g2-ch09.json [--split]
        the S2–S4 run's items that owe G2 a verdict, decided in this order: a HUMAN verdict already in G2's
        file (default runs/<book>/g2.json) stands; else the recommendation file's verdict; else the AI
        checks' own rule — an item with no printed answer whose blind re-solve AGREED with the EPUB worked
        solution → accept; an item the typing check flagged → exclude (kept out of the bank and listed for
        Samuel: a fix needs fields a person or a recommendation must write); a three-way DISAGREEMENT → no
        verdict, so the assembly holds it (`answer_mismatch`: the "answers vs the book" check blocks). Every
        auto verdict is `{"verdict", "auto": true, "by": "auto-pass G2 (AI recommendation)", "note"}` in G2's
        own file. Then `assemble_objectives.py lesson-runs … --g2`, assemble, load, and
        `apply_review_verdicts.py --g2` exactly as for a human G2 file. ALWAYS pass `--into` for a fan-out chapter:
        the default, runs/<book>/g2.json, is the pilot's file. `--split` runs that lesson-runs step itself (each
        --lesson-run, with the file just written; `--maths` and `--runs-dir` are forwarded to it). An item typed not
        markable owes G2 no verdict (it becomes teaching material whichever way a check fell); a choice whose options
        were the typing agent's inventions (COLLECT-6) and was not typed again from the book's key is a typing
        problem like any other: excluded and listed. Choices the collection typed again are listed in the record.
    uv run auto_pass_gates.py g2-recommend-args <book> --chapter 1 [--lesson-run …] --embed work/<book>/packets/embedded/fanout/g2rec-ch01.workflow.js
    uv run auto_pass_gates.py g2-recommend-collect <book> --chapter 1 [--lesson-run …] --run runs/<book>/g2rec/ch01-<runId>.json \\
              --out runs/<book>/g2-ch01.recommended.json
        the G2 RECOMMENDATION RUN (g2_recommend.py, runbook/g2-recommend.workflow.js; Samuel's answers 37a and 42): the items the
        checks HELD (a three-way disagreement) or EXCLUDED (a typing problem) get a recommended verdict per item — accept, fix with
        the book's own answer re-typed, hold, exclude — from one Sonnet agent per batch of ~8, and every accept or fix is confirmed
        by an independent agent that derives the answer first. `-args` builds the packet and the generated copy (no model is called);
        `-collect` checks the saved run (the book quote, the pipeline's own models, the app's marker, the verifier) into the
        recommendation file the `g2 --recommend` line above reads. The lesson runs default to the chapter's G2 record's evidence.
    uv run auto_pass_gates.py g3 <book> --chapter 9 --queue <bundle>.review-queue.json [--queue …] \\
              [--widgets seed/generated/<book>/widget-questions.json] [--widget-gaps coverage/<book>.chNN.widget-gaps.json]
        the sampled items accepted on the AI checks (S6's blind grade passed every family in the bundle,
        S7's verifier every template) → runs/<book>/g3-chNN.auto.json; apply with
        `apply_review_verdicts.py <that file>`, which ADDS the auto-pass to ai_checked_by. Held
        predicate→misconception claims (decision 47) follow the verifier: they stay held (inactive) and are
        listed in the record — there is no `--mapping-review` step.
        WIDGET GAPS belong to G3 (FR-4306: S7 is the widget stage, G3 its sample). A chapter whose S7 author wrote no
        template has no widget question, and coverage's `module_widgets` needs its chapter-scope gaps signed. With
        `--widget-gaps` the gap report's chapter-scope gaps for THIS chapter are signed
        {"by": "auto-pass G3 (AI recommendation)", "auto": true, "at", "note"}: the chapter ships without a widget
        question for now, which is all a person's sign-off accepts either. It is never a human sign-off (coverage counts
        it as `auto_passed` and names it); it never approves a new widget kind (each proposed kind is listed in the
        record for Samuel, decision 11, and nothing is built on it); a person's sign-off already in the file is kept;
        a re-run changes nothing; and a chapter NO author examined (gap kind `unexamined`: S7 never ran, or recorded
        nothing) is a pipeline gap, not a recommendation, so it blocks (exit 1) and nothing is signed. Lesson-scope
        gaps (the chapter has widgets) are listed and not signed: they cover nothing.
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
from assemble_lesson_bundle import choice_option_problems, marker_spec_problems

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
            audit = [*choice_option_problems(it), *marker_spec_problems(it)]
            if ref in typing or ref in nopa or ref in dis or audit:
                out[f"{l['lesson']}:{ref}"] = {
                    "typing_problems": [*(typing.get(ref) or it.get("typing_problems") or []), *audit],
                    "answer_type": it.get("answer_type"),
                    "verification": "disputed" if ref in dis else ("no_printed_answer" if ref in nopa
                                                                   else it.get("verification")),
                    "agreed_with_book_solution": bool((nopa.get(ref) or {}).get("agreed_with_book_solution"))}
    return out


# Why each retype rule of the collection (lesson.workflow.js COLLECT-6) happened, in the words the gate record shows Samuel. A rule this table
# does not know gets a neutral sentence, never another rule's reason: the record is his, and a wrong reason is worse than a plain one.
RETYPE_BASIS = {
    # a choice whose options were the typing agent's inventions, typed again from the key the book printed
    "numeric": "the options were the typing agent's inventions, not the book's",
    "values": "the options were the typing agent's inventions, not the book's",
    # the key is kept exactly; only the KIND (or the type) the app's marker reads it under changes
    "kind-for-form": "the typing agent named a marker kind the asked form cannot apply to; the key is algebra in its variables, kept exactly",
    "fraction-key": "the typing agent typed a fraction as a number: the app's numeric grader reads \"a/b\" as a, so the key is kept exactly and "
                    "typed as an expression (an exact fraction), which the expression marker marks",
    "kind-for-list": "the typing agent named a marker kind the key cannot be read under: the key lists values; kept exactly, only its kind "
                     "changes to values",
    "kind-for-relations": "the typing agent named a marker kind the key cannot be read under: the key is an inequality or a set-membership "
                          "list; kept exactly, only its kind changes to interval",
    "kind-for-equation": "the typing agent named a marker kind the key cannot be read under: the key has an equals sign; kept exactly, only "
                         "its kind changes to equation",
}


def retype_basis(rule: str | None, as_: str | None = None) -> str:
    """The reason for one retype. A run recorded before the rule was named is read by what it was typed as: a choice typed again as a
    number or as values is the options rule (the only one that existed then)."""
    if not rule and as_ in ("numeric", "expression (values)"):
        rule = "numeric" if as_ == "numeric" else "values"
    return RETYPE_BASIS.get(rule or "", f"the collection typed this item again (rule {rule or 'unnamed'}); the key is kept exactly")


def g2_retyped(run: dict, chapter: int | None, prefix: str) -> list[dict]:
    """The items the collection typed again (lesson.workflow.js COLLECT-6: a choice from the book's printed key, a fraction typed numeric, a
    marker kind the key or its asked form cannot be read under): informational decisions for the record — they carry no verdict, and Samuel
    sees them beside the verdicts. The basis says which rule it was (RETYPE_BASIS)."""
    run = run.get("result", run)
    out: list[dict] = []
    for l in run.get("lessons") or []:
        if not l or (chapter is not None and not str(l.get("lesson", "")).startswith(f"{prefix}{chapter}s")):
            continue
        for r in (l.get("verify") or {}).get("retyped") or []:
            out.append({"key": f"{l['lesson']}:{r['ref']}", "decision": f"typed again as {r['as']} (key {r.get('key')})",
                        "basis": retype_basis(r.get("rule"), r.get("as")) + (f" ({'; '.join(r.get('because') or [])[:200]})" if r.get("because") else "")})
    return out


def g2_merge(owed: dict[str, dict], recommended: dict | None, existing: dict | None,
             scope: set[str] | None = None) -> tuple[dict, dict, list[dict]]:
    """G2's file with an auto verdict for every owed item no human has decided: the recommendation's when there
    is one, else the AI checks' rule; an item neither covers stays without a verdict (held). A human verdict
    already there is kept as it is. Returns (file, counts, decisions).

    `scope`: the lessons the runs given cover. An AUTO verdict the file holds for an item of one of them that is NOT owed any more (a newer
    collection of the same runs typed it again and the checks now accept it: 2026-10-01, COLLECT-6 widened) is dropped, with a decision
    line saying so: without it the old exclusion would outlive the typing problem it was written for. A human's verdict is never dropped,
    and with no scope (the default) nothing is."""
    by = review_policy.auto_pass_by("G2")
    out = dict(existing or {})
    items = dict(out.get("items") or {})
    if not out.get("by"):
        out["by"], out["auto"] = by, True          # nobody human signed this file: all of it is auto
    recs = (recommended or {}).get("items") or {}
    c = {"human": 0, "recommended": 0, "rule": 0, "held": 0}
    decisions: list[dict] = []
    if owed and str((recommended or {}).get("prepared_by") or "").startswith("g2_recommend.py"):
        # a G2 recommendation RUN (g2_recommend.py) is about the items that were owed when it was collected. A newer collection of the lesson
        # runs (2026-10-01: COLLECT-6 widened) can leave one of them owed no more, the checks' own rule having decided it: an older reading
        # must not override that, so it is not applied (and the file's own collector skips such keys; this is the same line, in the merge)
        for k in sorted(k for k in recs if k not in owed):
            decisions.append({"key": k, "decision": "recommendation not applied — no longer owed",
                              "basis": "the checks' own rule decides this item now; an older recommendation never overrides it"})
        recs = {k: v for k, v in recs.items() if k in owed}
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
    if scope:
        for key in sorted(items):
            lesson = key.split(":", 1)[0]
            v = items[key]
            if lesson in scope and key not in owed and key not in recs and (v.get("auto") or review_policy.is_auto(v.get("by"))):
                del items[key]
                c["dropped"] = c.get("dropped", 0) + 1
                decisions.append({"key": key, "decision": "earlier auto verdict dropped — no longer owed",
                                  "basis": "a newer collection of the same run no longer flags it: the checks accept it as it is"})
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


def gap_chapter(g: dict, prefixes: list[str]) -> int | None:
    """The chapter a widget gap belongs to: its module (`module:g10m-c02`), else its objective (`lo:g10m2s2-1-1`)."""
    alt = "|".join(re.escape(x) for x in prefixes)
    for field, pat in (("module", rf"^module:(?:{alt})-c(\d+)$"), ("lo_id", rf"^lo:(?:{alt})(\d+)s")):
        m = re.match(pat, g.get(field) or "")
        if m:
            return int(m.group(1))
    return None


def widget_gap_decisions(report: dict, book, chapter: int, at: str | None = None) -> tuple[dict, list[dict], list[str], dict]:
    """G3's widget-gap auto-pass (FR-4306, answer 37c): (the report with this chapter's chapter-scope gaps signed,
    the decisions, what blocks, the counts).

    A chapter-scope gap is the report's own mark that its chapter has no widget question (gap_report: scope `chapter`
    iff the chapter is uncovered). Signing it accepts the chapter without a widget FOR NOW — what a person's sign-off
    means, no more: no kind is approved (decision 11: a new kind is built only after Samuel says so), and every
    proposed kind is listed for him. A person's sign-off is never overwritten, an auto one is kept as it is (a re-run
    changes nothing, not even `at`), and a chapter nobody examined — a gap of kind `unexamined`: S7 never ran or
    recorded nothing — is not a recommendation to accept: it blocks and nothing in the chapter is signed."""
    by = review_policy.auto_pass_by("G3")
    at = at or _now()
    out = {**report, "gaps": [dict(g) for g in report.get("gaps") or []]}
    mine = [g for g in out["gaps"] if gap_chapter(g, book.id_prefixes) == chapter]
    counts = {"signed": 0, "kept_auto": 0, "kept_human": 0, "lesson_scope": 0, "kinds": 0}
    decisions: list[dict] = []
    blocked: list[str] = []
    if any(g.get("need_kind") == "unexamined" for g in mine):
        blocked.append(f"widget gaps: chapter {chapter} has no widget question and no author recorded a gap "
                       "(S7 never examined it) — a pipeline gap, not a recommendation; run S7 for it")
        return out, decisions, blocked, counts
    kinds: set[str] = set()
    for g in mine:
        kind, key = g.get("need_kind") or "unspecified", g.get("lo_id") or g.get("module") or "?"
        if g.get("scope") != "chapter":
            counts["lesson_scope"] += 1
            decisions.append({"key": f"widget gap {key}", "decision": "listed — not signed (the chapter has widgets)",
                              "detail": f"proposed kind: {kind}",
                              "basis": "a lesson-scope gap records a missing kind; it covers no chapter"})
        else:
            so = g.get("signed_off") or {}
            if so.get("by") and not (so.get("auto") or review_policy.is_auto(so.get("by"))):
                counts["kept_human"] += 1
                state = f"already signed by {so['by']} — kept"
            elif so.get("by"):
                counts["kept_auto"] += 1
                state = "already auto-passed — kept"
            else:
                g["signed_off"] = {"by": by, "auto": True, "at": at,
                                   "note": f"{by}: S7's author found no existing widget kind that fits this objective, "
                                           "so the chapter ships without a widget question for now; no new kind is "
                                           "approved by this (decision 11)"}
                counts["signed"] += 1
                state = "accepted without a widget for now (auto-pass)"
            decisions.append({"key": f"widget gap {key}", "decision": state,
                              "detail": f"proposed kind: {kind} — NOT approved, needs Samuel (decision 11)",
                              "basis": (g.get("why") or "S7's author recorded no reason")[:300]})
        if g.get("need_kind") not in (None, "", "none", "unspecified"):
            kinds.add(kind)
    counts["kinds"] = len(kinds)
    return out, decisions, blocked, counts


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
        if state == "auto_passed":
            first = "; ".join(f"{a['scope']}: AUTO-PASSED by {a.get('by')} — not a human sign-off"
                              for a in (c.get("auto_passed") or [])[:3])
        safety = c["id"] in SAFETY_CHECKS
        checks.append({"name": f"coverage {c['id']}" + (" (safety)" if safety else ""),
                       "state": {"holds": "green", "excepted": "excepted", "fails": "red"}.get(state, state),
                       "detail": f"{c.get('got')}/{c.get('want')}" + (f" — {first}" if first else "")})
        if state == "auto_passed":
            # holds only because an auto-pass stands in for a person (a widget gap, answer 37c): it passes, and it is
            # Samuel's to see — never a human sign-off
            review.append(f"coverage check {c['id']} holds only on an auto-pass: "
                          + "; ".join(f"{a['scope']} ({a.get('by')})" for a in (c.get("auto_passed") or [])[:3]))
        if state != "fails":
            continue
        (blocked if safety else review).append(
            f"coverage {'safety ' if safety else ''}check {c['id']} fails ({c.get('got')}/{c.get('want')}): {first}")
    return blocked, review, checks


def g5_findings(coverage: dict) -> list[dict]:
    """A decision line for every completeness finding and every scope that holds only on an auto-pass, one per scope:
    the console shows a record's `decisions` and `checks` to Samuel but not its `for_review`, so a content gap (an
    objective with no claim, an empty tier cell) must be a line of its own to reach his backlog. A failing SAFETY
    check is in `blocked`, not here."""
    out: list[dict] = []
    for c in coverage.get("checks") or []:
        got = f"{c.get('got')}/{c.get('want')}"
        if c.get("state") == "fails" and c["id"] not in SAFETY_CHECKS:
            for f in (c.get("failures") or [])[:200]:
                out.append({"key": f"{c['id']} {f['scope']}", "decision": "completeness finding — for Samuel, not fixed",
                            "detail": f["detail"], "basis": f"coverage {c['id']} {got}: a completeness check lists the "
                            "gap and does not block (answer 37c); the content stays as loaded"})
        for a in c.get("auto_passed") or []:
            out.append({"key": f"{c['id']} {a['scope']}", "decision": "holds only on an auto-pass — never a human sign-off",
                        "detail": a.get("detail"), "basis": f"{a.get('by')}, {a.get('at')}"})
    return out


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
def book_maths(book, maths: Path | None) -> Path | None:
    """The accepted maths a later step must read: the one asked for, else the book's own S0b file (the whole book's
    images, runs/<book>/maths/book/accepted.json) when it exists, else None (the step's own default)."""
    if maths:
        return Path(maths)
    own = HERE / "runs" / book.book / "maths" / "book" / "accepted.json"
    return own if own.exists() else None


def approve_argv(book, chapter: int, verdicts: Path, maths: Path | None, objectives_dir: Path | None) -> list[str]:
    """The `assemble_objectives.py approve` command that records an auto-passed G1 — with the maths and the objectives
    directory the auto-pass itself read (without --maths the approval reads the pilot's accepted.json, a different set
    of images, and the packet it rebuilds no longer matches the run's)."""
    argv = ["approve", book.book, "--chapter", str(chapter), "--by", review_policy.auto_pass_by("G1"),
            "--verdicts", str(verdicts)]
    m = book_maths(book, maths)
    if m:
        argv += ["--maths", str(m)]
    if objectives_dir:
        argv += ["--objectives-dir", str(objectives_dir)]
    return argv


def g2_recommend_main(a, book) -> int:
    """`g2-recommend-args` and `g2-recommend-collect` (g2_recommend.py): deterministic, no model is called."""
    import g2_recommend as G

    def _hr(p) -> str:                      # relative to services/extraction/, where every command here is run
        try:
            return str(Path(p).resolve().relative_to(HERE))
        except ValueError:
            return str(p)
    ch = a.chapter
    t = f"{ch:02d}"
    g2_path = a.g2 or HERE / "runs" / book.book / f"g2-ch{t}.json"
    try:
        lesson_runs = a.lesson_run or G.record_runs(book, ch)
        recommended = HERE / "runs" / book.book / f"g2-ch{t}.recommended.json"
        if a.gate == "g2-recommend-args":
            skip = set((json.loads(a.only_missing.read_text()).get("items") or {})) if a.only_missing else None
            info = G.prepare(book, ch, lesson_runs, g2_path, a.embed, batch=a.batch, verify_batch=a.verify_batch, model=a.model,
                             effort=a.effort, max_batches=a.max_batches, args_out=a.args_out, skip_keys=skip,
                             preview_identity=True)
            est = info["estimate"]
            if not info["items"]:
                print(f"G2 recommendation (ch{t}): nothing owes a recommendation"
                      + (f" ({info['skipped_already_recommended']} already recommended)" if info["skipped_already_recommended"] else ""))
                return 0
            print(f"G2 recommendation (ch{t}): {info['items']} item(s) ({info['by_state'].get('held', 0)} held with no verdict, "
                  f"{info['by_state'].get('excluded', 0)} excluded for typing) in {info['parts']} run(s); "
                  f"{est['recommend_agents']} recommending + up to {est['verify_agents_max']} verifying agents, "
                  f"≈ ${est['usd_low']:.0f}–{est['usd_high']:.0f} (modelled)")
            ip = info.get("identity_preview") or {}
            if "equal" in ip:
                print(f"  the app's own marker, on the typed key of the {len(ip['equal']) + len(ip['different']) + len(ip['unreadable'])} item(s) "
                      f"whose stem is 'Simplify / Expand / Factorise: …' ({ip['not_an_identity']} are not): equal to the stem's expression "
                      f"{len(ip['equal'])}, NOT equal {len(ip['different'])} (a book error or a damaged stem), unreadable {len(ip['unreadable'])}"
                      " — no model, deterministic; a recommendation to put a NOT-equal item live is held")
            for c in info["copies"]:
                print(f"  copy: {_hr(c['script'])} ({c['bytes']} bytes) — run it with Workflow scriptPath and NO args")
            if not info["copies"]:
                print("  (nothing written: pass --embed <copy>.workflow.js)")
            lrs = [_hr(p) for p in lesson_runs]
            for cmd in G.follow_ups(book.book, ch, lrs, recommended=_hr(recommended), g2_file=_hr(g2_path),
                                    run_label=", ".join(Path(p).stem for p in lesson_runs)):
                print(("  " if cmd.startswith("#") else "  $ ") + cmd)
            return 0
        # g2-recommend-collect
        runs_files = list(a.run)
        entries = G.recommendable([G.load_run(p) for p in lesson_runs], ch, book.id_prefixes[0],
                                  json.loads(g2_path.read_text()) if g2_path.exists() else None)
        runs = [json.loads(p.read_text()) for p in runs_files]
        # what the agents were shown: the packet their copy carried (found by its sha256), item by item. Without it only the whole packet
        # can be compared, and any change refuses the run
        packets = [G.find_packet(book, (r.get("result", r).get("embedded") or {}).get("generated_sha256")) for r in runs]
        for p, r, pk in zip(runs_files, runs, packets):
            r = r.get("result", r)
            keys = r.get("keys")
            if pk is None and keys and not a.allow_stale:
                now = G.items_sha256([e for e in entries if e["key"] in set(keys)])
                if r.get("items_sha256") and now != r["items_sha256"]:
                    raise G.RecommendError(f"{_hr(p)}: the run was made on a packet that no longer matches the lesson runs / G2 file "
                                           f"(items sha256 {str(r['items_sha256'])[:12]}…, now {now[:12]}…) and its packet (copy "
                                           f"{str((r.get('embedded') or {}).get('generated_sha256'))[:12]}…) is not on disk, so the items cannot be "
                                           "compared one by one: a person's verdict or a re-collected run changed an item; re-run "
                                           "g2-recommend-args for this chapter, or pass --allow-stale")
        out = a.out or recommended
        prior = json.loads(out.read_text()) if out.exists() and not a.fresh else None
        names = {_hr(p): ((r.get("result", r).get("embedded") or {}).get("generated_sha256")) for p, r in zip(runs_files, runs)}
        doc = G.collect(entries, runs, prior=prior, run_names=names, chapter=ch, packets=packets,
                        multiplication_dot=bool(getattr(getattr(book, "answer_rules", None), "multiplication_dot", False)))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
        rep = doc["report"]
        if a.ids_out:
            a.ids_out.parent.mkdir(parents=True, exist_ok=True)
            a.ids_out.write_text(json.dumps(rep["live_question_ids"], indent=1) + "\n")
            print(f"  {len(rep['live_question_ids'])} newly live question id(s) -> {_hr(a.ids_out)}")
        print(f"G2 recommendation (ch{t}): {rep['recommended']} of {rep['items']} item(s) recommended -> {_hr(out)}\n"
              f"  verdicts {rep['by_verdict']}; confidence {rep['by_confidence']}; classes {rep['by_class']}")
        print(f"  would be LIVE (accept or fix, each confirmed by the independent verifier): {len(rep['live'])}"
              f"; stem repairs {len(rep['stem_repairs'])}; retyped {len(rep['retyped'])}; corrections proposed (not applied) "
              f"{len(rep['corrections_proposed'])}; low confidence ('your call') {len(rep['low_confidence'])}")
        for k, w in sorted(rep["not_live"].items()):
            print(f"  NOT live: {k}: the agent said {w['agent_verdict']}, recommended {w['recommended']} — {w['why'][:160]}")
        if rep["unanswered"]:
            print(f"  UNANSWERED ({len(rep['unanswered'])}): {', '.join(rep['unanswered'][:8])}{' …' if len(rep['unanswered']) > 8 else ''} "
                  "— they stay as the checks left them; re-run them with g2-recommend-args --only-missing")
        if rep["no_longer_owed"]:
            print(f"  NO LONGER OWED ({len(rep['no_longer_owed'])}): the checks' own rule (a newer collection) or a person now decides "
                  f"{', '.join(k.split(':', 1)[1] for k in rep['no_longer_owed'][:10])}{' …' if len(rep['no_longer_owed']) > 10 else ''} — "
                  "their recommendations are skipped, never applied over that decision")
        if rep["stale_items"]:
            print(f"  STALE ({len(rep['stale_items'])}): the item is not what the agents were shown (typed again by a newer collection): "
                  f"{', '.join(k.split(':', 1)[1] for k in rep['stale_items'][:10])}{' …' if len(rep['stale_items']) > 10 else ''} — "
                  "nothing is recommended for them; ask again with g2-recommend-args --only-missing")
        if rep["off_task"]:
            print(f"  off task (not items of this chapter's packet, ignored): {rep['off_task'][:5]}")
        print("  next: uv run auto_pass_gates.py g2 " + f"{book.book} --chapter {ch} " + " ".join(f"--lesson-run {_hr(p)}" for p in lesson_runs)
              + f" --recommend {_hr(out)} --into {_hr(g2_path)} --split --maths runs/{book.book}/maths/book/accepted.json")
        return 0
    except G.RecommendError as e:
        print(f"g2 recommendation: {e}", file=sys.stderr)
        return 2


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
    a1.add_argument("--maths", type=Path, help="S0b's accepted maths for `approve` (default: the book's own "
                                                "runs/<book>/maths/book/accepted.json when it exists)")
    a1.add_argument("--out", type=Path)
    a1.add_argument("--approve", action="store_true", help="then run assemble_objectives.py approve with it")
    a2 = common(sub.add_parser("g2", help="book questions: auto verdicts from the recommendation and the AI checks"))
    a2.add_argument("--lesson-run", "--from-run", dest="lesson_run", type=Path, action="append", default=[],
                    help="the S2–S4 run(s) (runs/<book>/lessons/<runId>.json): the items that owe G2 a verdict")
    a2.add_argument("--recommend", type=Path, help="a recommendation file ({items: {key: {verdict, …}}})")
    a2.add_argument("--into", type=Path, help="G2's file (default runs/<book>/g2.json — the pilot's: pass your own "
                                              "for a fan-out chapter); human verdicts kept")
    a2.add_argument("--split", action="store_true",
                    help="then run `assemble_objectives.py lesson-runs <run> --g2 <into>` for each --lesson-run")
    a2.add_argument("--maths", type=Path, help="forwarded to that lesson-runs step (default: the book's own "
                                                "runs/<book>/maths/book/accepted.json when it exists)")
    a2.add_argument("--runs-dir", type=Path, help="forwarded to that lesson-runs step")
    a3 = common(sub.add_parser("g3", help="generated sample: accepted on the AI checks"))
    a3.add_argument("--queue", type=Path, action="append", required=True)
    a3.add_argument("--widgets", type=Path, action="append", default=[],
                    help="widget bundle(s), to list their held claims in the record")
    a3.add_argument("--widget-gaps", type=Path,
                    help="coverage/<book>.chNN.widget-gaps.json: sign this chapter's chapter-scope widget gaps as an "
                         "auto-pass (the file is rewritten in place; a person's sign-off is kept; needs --chapter)")
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
    def g2rec(p):
        p.add_argument("book")
        p.add_argument("--chapter", type=int, required=True)
        p.add_argument("--lesson-run", "--from-run", dest="lesson_run", type=Path, action="append", default=[],
                       help="the S2–S4 run(s) (default: the S2–S4 runs the chapter's G2 record names as evidence)")
        p.add_argument("--g2", type=Path, help="the chapter's G2 file (default runs/<book>/g2-chNN.json): a human verdict "
                                               "in it is never recommended over")
        return p
    ra = g2rec(sub.add_parser("g2-recommend-args", help="G2 recommendation run: the packet and its generated copy (no model call)"))
    ra.add_argument("--embed", type=Path, help="write the generated copy of runbook/g2-recommend.workflow.js here "
                                               "(…/g2rec-ch01.workflow.js; more parts as …part2.workflow.js)")
    ra.add_argument("--args-out", type=Path, help="also write the args themselves (for reading)")
    ra.add_argument("--batch", type=int, default=8, help="items per recommending agent (default 8)")
    ra.add_argument("--verify-batch", type=int, default=8, help="verdicts per verifying agent (default 8)")
    ra.add_argument("--model", default="sonnet", choices=["sonnet", "haiku"])
    ra.add_argument("--effort", default="high", choices=["medium", "high"])
    ra.add_argument("--max-batches", type=int, default=24, help="recommending agents per run (default 24: past it the packet "
                                                                "splits into parts)")
    ra.add_argument("--only-missing", type=Path, metavar="RECOMMENDED",
                    help="leave out the items this recommendation file already covers (a re-run of what was not answered)")
    rc = g2rec(sub.add_parser("g2-recommend-collect", help="G2 recommendation run: the saved run(s), checked, as a recommendation file"))
    rc.add_argument("--run", type=Path, action="append", required=True, help="a saved run (runs/<book>/g2rec/chNN-<runId>.json)")
    rc.add_argument("--out", type=Path, help="the recommendation file (default runs/<book>/g2-chNN.recommended.json); keys these "
                                             "runs did not answer keep an earlier file's recommendation")
    rc.add_argument("--ids-out", type=Path, help="also write the question ids the live recommendations become (a JSON list: what a delta "
                                                 "working check is limited to, working_check.py args --only)")
    rc.add_argument("--fresh", action="store_true", help="ignore an existing --out file (otherwise a re-run adds to it)")
    rc.add_argument("--allow-stale", action="store_true", help="collect a run whose packet no longer matches the lesson runs")
    a = ap.parse_args(argv)

    book = book_config.load_book(a.book)
    if a.gate.startswith("g2-recommend"):
        return g2_recommend_main(a, book)
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
            return assemble_objectives.main(approve_argv(book, ch, out, a.maths, a.objectives_dir))
        print("  next: uv run assemble_objectives.py " + " ".join(
            f'"{x}"' if " " in x else x for x in approve_argv(book, ch, out, a.maths, a.objectives_dir)))
        return 0

    if a.gate == "g2":
        if not a.lesson_run and not a.recommend:
            ap.error("g2 needs --lesson-run (the S2–S4 run) and/or --recommend")
        owed: dict[str, dict] = {}
        loaded = [json.loads(p.read_text()) for p in a.lesson_run]
        for r_ in loaded:
            owed.update(g2_items(r_, ch, book.id_prefixes[0]))
        into = a.into or HERE / "runs" / book.book / "g2.json"
        existing = json.loads(into.read_text()) if into.exists() else None
        if a.into is None and ch is not None and existing:
            foreign = [k for k in existing.get("items") or {} if not k.startswith(f"{book.id_prefixes[0]}{ch}s")]
            if foreign:
                ap.error(f"{_rel(into)} already holds verdicts for other chapters ({foreign[0]}, …) — it is the pilot's "
                         f"file; pass --into runs/{book.book}/g2-ch{ch:02d}.json for this chapter")
        rec_in = json.loads(a.recommend.read_text()) if a.recommend else None
        if rec_in and ch is not None:      # a recommendation file may hold other chapters: this one only
            rec_in = {**rec_in, "items": {k: v for k, v in (rec_in.get("items") or {}).items()
                                          if k.startswith(f"{book.id_prefixes[0]}{ch}s")}}
        scope = {l.get("lesson") for r_ in loaded for l in (r_.get("result", r_).get("lessons") or [])
                 if l and (ch is None or str(l.get("lesson", "")).startswith(f"{book.id_prefixes[0]}{ch}s"))}
        doc, c, decisions = g2_merge(owed, rec_in, existing, scope)
        into.parent.mkdir(parents=True, exist_ok=True)
        into.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
        held = [d["key"] for d in decisions if d["decision"].startswith(("no verdict", "hold", "exclude"))]
        # a recommendation the agent marked "low confidence" is a content decision (a stem repair, a teaching-only retype, a
        # partial answer): listed for Samuel beside the holds and exclusions, whatever its verdict (g2_recommend.py)
        low = [d["key"] for d in decisions if "confidence low" in (d.get("basis") or "")]
        review = held + [k for k in low if k not in held]
        retyped = [r for r_ in loaded for r in g2_retyped(r_, ch, book.id_prefixes[0])]
        rec = decision_record(
            "G2", book, ch, f"{c['recommended'] + c['rule']} book item(s) decided on the AI recommendation "
                            f"({c['recommended']} from the recommendation file, {c['rule']} by the checks' own rule); "
                            f"{c['held']} held for a person; {c['human']} already decided by a person"
                            + (f"; {len(low)} recommended with low confidence (your call)" if low else "")
                            + (f"; {c['teaching']} typed not markable (teaching only, no verdict owed)" if c.get("teaching") else "")
                            + (f"; {len(retyped)} item(s) typed again, each with its reason (a choice from the book's printed key, a fraction typed as a number, a marker kind the key or its form cannot be read under)" if retyped else ""),
            decisions=decisions + retyped, held=bool(review), for_review=review, run=a.run,
            checks=[{"name": "S3 three-way answer check (printed, EPUB solution, blind re-solve)", "state": "done"},
                    {"name": "S3 answer typing check", "state": "done"},
                    *([{"name": "G2 recommendation run: recommender + independent verifier (g2_recommend.py)", "state": "done"}]
                      if c["recommended"] else []),
                    {"name": "the app's marker on every typed key (assembly)", "state": "on load"}],
            evidence=[("G2 verdicts", into), ("recommendation", a.recommend)]
                     + [(f"S2–S4 run {p.stem}", p) for p in a.lesson_run])
        where = write_record(rec, gates_dir)
        print(f"G2 auto-pass ({scope}): {c['recommended']} from the recommendation, {c['rule']} by the AI checks' "
              f"rule, {c['held']} left held, {c['human']} human verdict(s) kept -> {_rel(into)}\n"
              f"  record: {_rel(where)}")
        if a.split:
            import assemble_objectives
            for p in a.lesson_run:
                argv = ["lesson-runs", book.book, str(p), "--g2", str(into)]
                m = book_maths(book, a.maths)
                if m:
                    argv += ["--maths", str(m)]
                if a.runs_dir:
                    argv += ["--runs-dir", str(a.runs_dir)]
                rc = assemble_objectives.main(argv)
                if rc:
                    return rc
        return 0

    if a.gate == "g3":
        doc = g3_verdicts([json.loads(p.read_text()) for p in a.queue])
        out = a.out or HERE / "runs" / book.book / f"g3-{scope}.auto.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
        held = held_claims([json.loads(p.read_text()) for p in a.widgets])
        gap_dec, gap_blocked, gap_counts, gap_review = [], [], None, []
        if a.widget_gaps:
            if ch is None:
                ap.error("--widget-gaps needs --chapter")
            report = json.loads(a.widget_gaps.read_text())
            new_report, gap_dec, gap_blocked, gap_counts = widget_gap_decisions(report, book, ch)
            if new_report != report:
                a.widget_gaps.write_text(json.dumps(new_report, indent=2, ensure_ascii=False) + "\n")
            gap_review = sorted({f"widget gap, chapter {ch}: the proposed kind {g.get('need_kind')!r} needs your approval "
                                 "before anything is built (decision 11); nothing is built on this auto-pass"
                                 for g in new_report["gaps"] if gap_chapter(g, book.id_prefixes) == ch
                                 and g.get("need_kind") not in (None, "", "none", "unspecified", "unexamined")})
        n_gap = (gap_counts or {}).get("signed", 0) + (gap_counts or {}).get("kept_auto", 0)
        rec = decision_record(
            "G3", book, ch, f"{len(doc['verdicts'])} sampled item(s) accepted on the AI checks; {len(held)} "
                            "predicate claim(s) stay held, as the verifier recommends"
                            + (f"; {n_gap} widget gap(s) accepted on the AI recommendation (the chapter ships without a "
                               f"widget question for now; {gap_counts['kinds']} proposed kind(s) NOT approved, listed for "
                               "Samuel)" if n_gap else "")
                            + ("; widget gaps NOT auto-passed" if gap_blocked else ""),
            decisions=[{"key": q, "decision": "accept", "basis": "its family passed S6's blind grade / S7's verifier"}
                       for q in doc["verdicts"]] + held + gap_dec,
            held=bool(held) or bool(gap_dec), for_review=[h["key"] for h in held] + gap_review, run=a.run,
            blocked=gap_blocked,
            checks=[{"name": "S6 blind grader, every family in the bundle", "state": "pass"},
                    {"name": "S7 verifier, every template", "state": "pass"},
                    {"name": "the app's marker on every typed key (load)", "state": "pass"}]
                   + ([{"name": "S7 author examined the chapter (a gap with a reason, or a template)",
                        "state": "fail" if gap_blocked else "pass"}] if a.widget_gaps else []),
            evidence=[("G3 verdicts (auto)", out)] + [(f"review queue {p.name}", p) for p in a.queue]
                     + [(f"widget bundle {p.name}", p) for p in a.widgets]
                     + ([("widget gaps (auto-passed)", a.widget_gaps)] if a.widget_gaps and n_gap else []))
        where = write_record(rec, gates_dir)
        print(f"G3 auto-pass ({scope}): {len(doc['verdicts'])} sampled item(s) accepted on the AI checks -> {_rel(out)}\n"
              f"  record: {_rel(where)}\n"
              f"  next: uv run apply_review_verdicts.py {_rel(out)}   (adds to ai_checked_by, never reviewed_by)")
        if gap_counts is not None:
            print(f"  widget gaps ({scope}): {gap_counts['signed']} signed by the auto-pass, {gap_counts['kept_auto']} already "
                  f"auto-passed, {gap_counts['kept_human']} signed by a person, {gap_counts['lesson_scope']} lesson-scope "
                  f"(not signed); {gap_counts['kinds']} proposed kind(s) listed for Samuel, none approved")
        for b in gap_blocked:
            print(f"  BLOCKED {b}", file=sys.stderr)
        return 1 if gap_blocked else 0

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
                    "basis": "parity GREEN for every course and no coverage safety check failing"}]
                  + g5_findings(coverage),
        checks=checks, blocked=blocked, for_review=review, run=a.run,
        evidence=[("coverage", a.coverage), ("dry run", a.dryrun), ("cost ledger", ledger if cost else None),
                  ("book config the drift guard compared the database with", a.book_config)]
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

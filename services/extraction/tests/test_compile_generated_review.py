"""compile_book_records.GeneratedReview: the review tool's Generated content decisions, applied as compile adds rows."""
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import compile_book_records as C  # noqa: E402


def review(decisions: dict) -> C.GeneratedReview:
    g = C.GeneratedReview("no-such-book")
    g.dec = decisions
    return g


def decided(g, kind, row, decision, **extra):
    return {(kind, row["id"]): {"kind": kind, "ref": row["id"], "decision": decision, "by": "TD", "at": "2026-10-17",
                                "fingerprint": g.task.fingerprint(row, kind), **extra}}


Q = lambda i, **k: {"id": f"q:pp3u2-1-1:g{i}", "lo_id": "lo:pp3u2-1-1", "stem": f"stem {i}", **k}
M = lambda i: {"id": f"mc:pp3u2-1-1:m{i}", "lo_id": "lo:pp3u2-1-1", "label": f"m{i}"}


def test_questions_reject_left_out_fix_held_approve_stamped():
    g = review({})
    rows = [Q(1), Q(2), Q(3), Q(4)]
    g.dec = {**decided(g, "question", rows[0], "reject"), **decided(g, "question", rows[1], "fix_requested", note="wrong key"),
             **decided(g, "question", rows[2], "approve")}
    out = g.apply(copy.deepcopy(rows), "questions")
    assert [r["id"] for r in out] == [rows[1]["id"], rows[2]["id"], rows[3]["id"]]
    assert {s["question"]: s["decision"] for s in g.stamps} == {rows[0]["id"]: "reject", rows[1]["id"]: "fix_requested", rows[2]["id"]: "approve"}
    assert all(s["what"] == "generated question" for s in g.stamps)
    assert g.report["held"][0]["question"] == rows[1]["id"]


def test_a_question_changed_since_is_not_applied():
    g = review({})
    row = Q(1)
    g.dec = decided(g, "question", row, "reject")
    out = g.apply([{**row, "stem": "rewritten"}], "questions")
    assert len(out) == 1 and not g.stamps and g.report["changed_since"]


def test_misconception_left_out_takes_its_links():
    g = review({})
    m1, m2 = M(1), M(2)
    g.dec = {**decided(g, "misconception", m1, "reject"), **decided(g, "misconception", m2, "approve")}
    assert [m["id"] for m in g.apply([m1, m2], "misconceptions")] == [m2["id"]]
    q = Q(1, choices=[{"key": "A", "misconception_id": m1["id"]}, {"key": "B", "misconception_id": m2["id"]}])
    gen = {"generated-questions.json": {"questions": [q], "misconceptions": [m1, m2]}}
    g.unlink_left_out(gen)
    assert "misconception_id" not in q["choices"][0] and q["choices"][1]["misconception_id"] == m2["id"]
    assert [m["id"] for m in gen["generated-questions.json"]["misconceptions"]] == [m2["id"]]
    assert g.listed == [{"kind": "misconception", "ref": m2["id"], "decision": "approve", "by": "TD", "at": "2026-10-17"}]


def test_widget_mapping_rejected_drops_that_claim_only():
    g = review({})
    w = Q(1, question_type="widget", choices={"diagnostics": [{"predicate": "p1", "misconception_id": "mc:a"},
                                                             {"predicate": "p2", "misconception_id": "mc:b"}]})
    ref = f"{w['id']}#p1"
    item = {"id": ref, "widget_id": w["id"], "lo_id": w["lo_id"], **w["choices"]["diagnostics"][0]}
    g.dec = {("mapping", ref): {"decision": "reject", "by": "TD", "at": "2026-10-17", "fingerprint": g.task.fingerprint(item, "mapping")}}
    out = g.apply([copy.deepcopy(w)], "questions")
    assert [d["predicate"] for d in out[0]["choices"]["diagnostics"]] == ["p2"]


def held_widget():
    return Q(1, question_type="widget", choices={
        "diagnostics": [{"predicate": "p1", "misconception_id": "mc:a"}],
        "pending_review": [{"predicate": "p2", "misconception_id": "mc:b", "why": "doubted", "verifier_runs": ["r1"]}],
        "pending_hints": [{"predicate": "p3", "step": 2, "text": "Check step two.", "why": "gives it away"},
                          {"predicate": "p4", "step": 1, "text": "Start from the rule.", "why": "unclear"}]})


def held_decision(g, w, ref, decision):
    item = next(i for r, i, _k, _e in g.task.held_items(w) if r == ref)
    return {("held", ref): {"decision": decision, "by": "TD", "at": "2026-10-21", "fingerprint": g.task.fingerprint(item, "held")}}


def test_held_claims_kept_go_live_dropped_go_away_undecided_stay_held():
    g = review({})
    w = held_widget()
    g.dec = {**held_decision(g, w, f"{w['id']}#p2", "keep"), **held_decision(g, w, f"{w['id']}#hint:p3", "drop"),
             **held_decision(g, w, f"{w['id']}#hint:p4", "keep")}
    ch = g.apply([copy.deepcopy(w)], "questions")[0]["choices"]
    assert [d["predicate"] for d in ch["diagnostics"]] == ["p1", "p2"]
    assert "why" not in ch["diagnostics"][1] and "verifier_runs" not in ch["diagnostics"][1], "the verifier's notes stay behind"
    assert "pending_review" not in ch
    assert [h["predicate"] for h in ch["hints"]] == ["p4"] and "pending_hints" not in ch
    assert {x["ref"] for x in g.report["claims_kept"]} == {f"{w['id']}#p2", f"{w['id']}#hint:p4"}


def test_a_held_claim_is_judged_on_the_claim_not_the_verifiers_reasons():
    g = review({})
    w = held_widget()
    g.dec = held_decision(g, w, f"{w['id']}#hint:p3", "keep")
    w2 = copy.deepcopy(w)
    w2["choices"]["pending_hints"][0]["why"] = "a later run's different reason"
    assert [h["predicate"] for h in g.apply([w2], "questions")[0]["choices"]["hints"]] == ["p3"]
    w3 = copy.deepcopy(w)
    w3["choices"]["pending_hints"][0]["text"] = "A rewritten hint."
    g2 = review({})
    g2.dec = held_decision(g2, w, f"{w['id']}#hint:p3", "keep")
    ch = g2.apply([w3], "questions")[0]["choices"]
    assert "hints" not in ch and len(ch["pending_hints"]) == 2, "a rewritten hint is a new claim: held again"


def test_deciding_a_held_claim_does_not_send_its_widget_back_for_review():
    g = review({})
    w = held_widget()
    g.dec = {**decided(g, "widget", w, "approve"), **held_decision(g, w, f"{w['id']}#p2", "keep")}
    g.apply([copy.deepcopy(w)], "questions")
    assert [s["decision"] for s in g.stamps] == ["approve"] and not g.report["changed_since"]

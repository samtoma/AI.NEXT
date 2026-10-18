"""Held generation: the review tool's task (groundtruth/review/held.py) and book_record_held.py read the same files."""
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "groundtruth" / "review"))
import book_record_held as BRH  # noqa: E402
import held as RH  # noqa: E402


@pytest.fixture
def book(tmp_path, monkeypatch):
    t, r = tmp_path / "teaching", tmp_path / "reviews"
    (t / "bk" / "families").mkdir(parents=True)
    (t / "bk" / "widgets-held").mkdir(parents=True)
    (t / "bk" / "families" / "_held--u1-1-1--fam.json").write_text(json.dumps({"parent_question_id": "none"}))
    (t / "bk" / "families" / "u1-1-1--ok.json").write_text("{}")
    (t / "bk" / "widgets-held" / "u1-1-2--tpl.json").write_text("{}")
    (t / "bk" / "held.json").write_text(json.dumps({"items": {"family:u1-1-1--fam.json": {"reasons": ["no parent"]}}}))
    monkeypatch.setattr(RH, "TEACHING", t)
    monkeypatch.setattr(RH, "REVIEWS", r)
    monkeypatch.setattr(BRH, "HERE", tmp_path)
    return "bk"


def test_both_sides_list_the_same_items_and_fingerprints(book):
    tool = {(x["kind"], x["file"]): x for x in RH.summary(book)}
    cli = {(x["kind"], x["file"]): x for x in BRH.state(book)}
    assert set(tool) == set(cli) == {("family", "u1-1-1--fam.json"), ("template", "u1-1-2--tpl.json")}
    assert all(tool[k]["fingerprint"] == cli[k]["fingerprint"] for k in tool)
    assert tool[("family", "u1-1-1--fam.json")]["reasons"] == ["no parent"]


def test_decide_states_and_a_changed_file_comes_back(book):
    with pytest.raises(ValueError):   # sending back needs a note
        RH.decide({"book": book, "kind": "family", "file": "u1-1-1--fam.json", "decision": "send_back", "by": "TD"})
    RH.decide({"book": book, "kind": "family", "file": "u1-1-1--fam.json", "decision": "send_back", "by": "TD", "note": "anchor on example 2"})
    RH.decide({"book": book, "kind": "template", "file": "u1-1-2--tpl.json", "decision": "drop", "by": "TD"})
    st = {x["file"]: x["state"] for x in BRH.state(book)}
    assert st == {"u1-1-1--fam.json": "send_back", "u1-1-2--tpl.json": "drop"}
    (RH.TEACHING / book / "widgets-held" / "u1-1-2--tpl.json").write_text('{"edited": 1}')
    assert {x["file"]: x["state"] for x in RH.summary(book)}["u1-1-2--tpl.json"] == "changed"
    led = json.loads((RH.TEACHING / book / "held.json").read_text())
    led["items"]["family:u1-1-1--fam.json"]["reauthored"] = "2026-10-18"
    (RH.TEACHING / book / "held.json").write_text(json.dumps(led))
    assert {x["file"]: x["state"] for x in BRH.state(book)}["u1-1-1--fam.json"] == "reauthored"

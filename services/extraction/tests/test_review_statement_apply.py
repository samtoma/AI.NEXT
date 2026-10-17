"""The review tool's "apply to the book record": a corrected statement's wording reaches the book record compile reads."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "groundtruth" / "review"))
import server as S  # noqa: E402


def record(role, claim, quote="a is called the first projection"):
    return {"schema": "book-record", "role": role, "lesson": {"slug": "pp3u1-1"},
            "items": [{"id": "pp3u1-1:rule-1", "type": "rule", "source_page": 7, "quote": quote, "claim": claim},
                      {"id": "pp3u1-1:drill-1", "type": "exercise", "source_page": 7, "quote": "Find x", "stem": "Find x"}]}


@pytest.fixture
def roots(tmp_path, monkeypatch):
    gt, ext = tmp_path / "gt", tmp_path / "ext"
    (gt / "bk").mkdir(parents=True)
    (ext / "bk").mkdir(parents=True)
    monkeypatch.setattr(S, "ROOTS", [("ground_truth", gt), ("extraction", ext)])
    return gt / "bk" / "pp3u1-1.json", ext / "bk" / "pp3u1-1.json"


def test_diff_then_apply_writes_the_wording_and_a_trace(roots):
    gt_p, ext_p = roots
    gt_p.write_text(json.dumps(record("ground_truth", "In (a, b), a is the first projection and b the second.")))
    ext_p.write_text(json.dumps(record("extraction", "a is the first coordinate.")))
    d = S.statement_diff("1/bk/pp3u1-1.json", "0/bk/pp3u1-1.json", "pp3u1-1:rule-1")
    assert list(d["fields"]) == ["claim"]
    out = S.apply_statement({"ext": "1/bk/pp3u1-1.json", "gt": "0/bk/pp3u1-1.json", "id": "pp3u1-1:rule-1", "by": "TD"})
    assert out["fields"] == ["claim"]
    e = json.loads(ext_p.read_text())["items"][0]
    assert e["claim"].startswith("In (a, b)") and e["review"]["edits"][0]["by"] == "TD"
    assert S.statement_diff("1/bk/pp3u1-1.json", "0/bk/pp3u1-1.json", "pp3u1-1:rule-1")["fields"] == {}


def test_only_statements_and_only_with_initials(roots):
    gt_p, ext_p = roots
    gt_p.write_text(json.dumps(record("ground_truth", "x")))
    ext_p.write_text(json.dumps(record("extraction", "y")))
    with pytest.raises(ValueError):
        S.apply_statement({"ext": "1/bk/pp3u1-1.json", "gt": "0/bk/pp3u1-1.json", "id": "pp3u1-1:drill-1", "by": "TD"})
    with pytest.raises(ValueError):
        S.apply_statement({"ext": "1/bk/pp3u1-1.json", "gt": "0/bk/pp3u1-1.json", "id": "pp3u1-1:rule-1", "by": ""})
    with pytest.raises(ValueError):   # the two keys the wrong way round
        S.apply_statement({"ext": "0/bk/pp3u1-1.json", "gt": "1/bk/pp3u1-1.json", "id": "pp3u1-1:rule-1", "by": "TD"})

"""book_record_links.apply: only the cross-unit links a person kept at G1, as listed, join the unit's own links."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import book_record_links as BL  # noqa: E402
import book_record_objectives as BO  # noqa: E402


def test_apply_writes_kept_links_beside_the_units_own(tmp_path, monkeypatch):
    monkeypatch.setattr(BL, "HERE", tmp_path)
    (tmp_path / "teaching" / "bk" / "cross-links").mkdir(parents=True)
    (tmp_path / "teaching" / "bk" / "links").mkdir(parents=True)
    own = {"src": "lo:u2-1-1", "dst": "lo:u2-2-1", "signal": "recall"}
    (tmp_path / "teaching" / "bk" / "links" / "ch02.json").write_text(json.dumps({"links": [own]}))
    cross = [{"key": f"lo:u1-1-{i}->lo:u2-1-1", "src": f"lo:u1-1-{i}", "dst": "lo:u2-1-1", "signal": "uses_method",
              "evidence": [], "fingerprint": f"fp{i}"} for i in (1, 2, 3, 4)]
    (tmp_path / "teaching" / "bk" / "cross-links" / "ch02.json").write_text(json.dumps({"run": "r", "links": cross}))
    dec = {("link", cross[0]["key"]): {"decision": "keep", "by": "TD", "fingerprint": "fp1"},
           ("link", cross[1]["key"]): {"decision": "drop", "by": "TD", "fingerprint": "fp2"},
           ("link", cross[2]["key"]): {"decision": "keep", "by": "TD", "fingerprint": "an older listing"}}
    monkeypatch.setattr(BO, "g1_decisions", lambda book: dec)
    rep = BL.apply("bk", [2], dry=False)
    links = json.loads((tmp_path / "teaching" / "bk" / "links" / "ch02.json").read_text())["links"]
    assert links[0] == own and [k["src"] for k in links[1:]] == ["lo:u1-1-1"] and links[1]["cross"]
    assert rep[2] == {"kept": 1, "undecided": 1}
    BL.apply("bk", [2], dry=False)   # again: the same, not doubled
    assert len(json.loads((tmp_path / "teaching" / "bk" / "links" / "ch02.json").read_text())["links"]) == 2

"""The Prep-3 widget defect that v0.9.3 corrected, rebuilt for the blind-verifier tests.

TEST FIXTURE. `fixtures/families/widget-templates/t2u2-2-1--domain-excluded.json` reproduces
the live template, which since v0.9.3 (migration 032) stores the stem's zeros -r and -s as
its targets. Until v0.9.3 it stored [r, s], the SHIFTS the stem prints: a spec that disagrees
with its own stem, which is exactly what the blind reading of S7 exists to refuse.
`pre_v093_templates()` loads the fixture templates with that one line put back, through the
real loader (so every template carries its real `_sha`), and builds their questions.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import generate_widget_questions as GW

TEMPLATES = Path(__file__).resolve().parent / "fixtures" / "families" / "widget-templates"
DEFECT_ID = "wt:t2u2-2-1:domain-excluded"
PRE_V093_TARGETS = "{=sorted([r, s])}"  # the shifts; the stem's zeros are -r and -s


def pre_v093_templates() -> tuple[list[dict], list[dict]]:
    with tempfile.TemporaryDirectory() as d:
        for p in sorted(TEMPLATES.glob("*.json")):
            raw = json.loads(p.read_text())
            if raw.get("id") == DEFECT_ID:
                raw["spec"]["targets"] = PRE_V093_TARGETS
            Path(d, p.name).write_text(json.dumps(raw, ensure_ascii=False, indent=2))
        templates, problems = GW.load_templates(Path(d))
    assert problems == [], problems
    questions, problems = GW.build_from_templates(templates)
    assert problems == [], problems
    return templates, questions

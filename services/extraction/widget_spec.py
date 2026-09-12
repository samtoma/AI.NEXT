"""The widget contract, Python side (ADR-0009).

Reads `contracts/widget-predicates.json` — the same file
`app/src/lib/widget-predicates.ts` is generated from — so the generator, the
loader and the app cannot disagree about what a predicate is called.

A WIDGET QUESTION IS A QUESTION. It differs from a multiple-choice item only in
where its wrong answers live: an MCQ enumerates them as options, each carrying a
`misconception_id`; a widget enumerates them as PREDICATES over a continuous
answer space, each carrying a `misconception_id`. Everything downstream —
provenance, the review gate, parity, selection, attempts, refutation serving —
treats the two identically, which is the whole point of the decision.

The stored shape, in `questions.choices`:

    {"kind": "circle_builder",
     "spec": {"element": "chord"},
     "diagnostics": [
       {"predicate": "ends-not-on-circle",
        "misconception_id": "mc:geo1-1-2:chord-endpoints-off-circle"},
       {"predicate": "chord-not-through-centre",
        "misconception_id": "mc:geo1-1-2:chord-vs-diameter"}]}

`correct_answer` holds `"ok"` — the reserved predicate meaning the construction
satisfied what was asked. That mirrors migration 008's treatment of the typed
Arabic answers: the column keeps its type and the meaning is per question_type.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

CONTRACT = Path(__file__).resolve().parents[2] / "contracts" / "widget-predicates.json"

OK = "ok"


@lru_cache(maxsize=1)
def contract() -> dict:
    return json.loads(CONTRACT.read_text())


def kinds() -> list[str]:
    return sorted(contract()["kinds"])


def predicates_for(kind: str) -> set[str]:
    """Every predicate this kind may emit, `ok` included."""
    k = contract()["kinds"].get(kind)
    return {OK} | (set(k["predicates"]) if k else set())


def describe(kind: str, predicate: str) -> str | None:
    if predicate == OK:
        return "Correct"
    k = contract()["kinds"].get(kind)
    return k["predicates"].get(predicate) if k else None


def widget_choices(kind: str, spec: dict, diagnostics: list[tuple[str, str]]) -> dict:
    """Build the `choices` payload for a widget question.

    `diagnostics` is a list of (predicate, misconception_id). Order is the order
    a reviewer reads them in, so put the likeliest error first.
    """
    return {
        "kind": kind,
        "spec": spec,
        "diagnostics": [
            {"predicate": p, "misconception_id": m} for p, m in diagnostics
        ],
    }


def validate_widget(q: dict, known_misconceptions: set[str] | None = None) -> list[str]:
    """Structural validation for one widget question.

    What this can catch is the class of defect that makes a widget unservable or
    silently mute: a kind nothing renders, a predicate the widget can never
    emit, a misconception id that does not exist. That last one is the quiet
    killer — the widget diagnoses correctly, the lookup misses, and the student
    gets silence where a refutation was meant to be. Nothing raises; it just
    stops teaching.

    What it cannot check is whether the misconception NAMED is the error the
    predicate actually represents. That is a judgement, and it is what the human
    sample (ADR-0008) is for.
    """
    problems: list[str] = []
    qid = q.get("id", "<no id>")
    choices = q.get("choices")

    if not isinstance(choices, dict):
        return [f"{qid}: a widget question must carry a choices object"]

    kind = choices.get("kind")
    if kind not in contract()["kinds"]:
        return [f"{qid}: unknown widget kind {kind!r} — nothing renders it"]

    if not isinstance(choices.get("spec"), dict):
        problems.append(f"{qid}: choices.spec must be an object")

    if str(q.get("correct_answer")) != OK:
        problems.append(
            f"{qid}: correct_answer is {q.get('correct_answer')!r}; a widget's correct "
            f"answer is the reserved predicate {OK!r}"
        )

    diags = choices.get("diagnostics")
    if not isinstance(diags, list) or not diags:
        problems.append(
            f"{qid}: no diagnostics — a widget with no predicate mapping can mark an "
            f"answer wrong but can never say why, which is the reason for ADR-0009"
        )
        return problems

    allowed = predicates_for(kind)
    seen: set[str] = set()
    for d in diags:
        if not isinstance(d, dict):
            problems.append(f"{qid}: a diagnostics entry is not an object")
            continue
        p = d.get("predicate")
        m = d.get("misconception_id")
        if p == OK:
            problems.append(f"{qid}: {OK!r} is the CORRECT predicate and cannot carry a misconception")
        elif p not in allowed:
            problems.append(
                f"{qid}: predicate {p!r} is not one {kind} can emit "
                f"(known: {sorted(allowed - {OK})})"
            )
        if p in seen:
            problems.append(f"{qid}: predicate {p!r} mapped twice")
        seen.add(p)
        if not m:
            problems.append(f"{qid}: predicate {p!r} maps to no misconception")
        elif known_misconceptions is not None and m not in known_misconceptions:
            problems.append(
                f"{qid}: predicate {p!r} names misconception {m!r}, which does not exist — "
                f"the widget would diagnose correctly and serve nothing"
            )
    return problems

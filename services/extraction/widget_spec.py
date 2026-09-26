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


def _case_key(v) -> str:
    """The contract's dispatch key for a spec value (contracts/widget-predicates.json, CAN EMIT)."""
    if v is None:
        return "(absent)"
    if isinstance(v, bool) or not isinstance(v, (str, int, float)):
        return "(present)"
    return str(v)


def can_emit(kind: str, spec: dict | None) -> tuple[set[str] | None, str]:
    """What a widget of this kind, with this stored spec, can actually report besides `ok` — the contract's
    `can_emit` table, derived from the app's grading code (consistency review 2026-09-27, W1) — and where in the
    table that was read ("mode=points"). None when the spec reaches no case: a value the widget does not render.

    A kind DECLARES more predicates than any one question can emit: line_drawer in points mode grades the two
    handles and never a slope, angle_setter asked for the inscribed angle never reports 'angle-given-as-arc'. A
    mapping on a predicate the question cannot emit never fires, and the student gets a plain "not quite" where a
    refutation was promised — the Prep-3 bank carried 14 such mappings and the Grade 10 pilot 5 active ones."""
    k = contract()["kinds"].get(kind)
    if not k or "can_emit" not in k:
        return None, "no can_emit table"
    node, path = k["can_emit"], []
    s = spec if isinstance(spec, dict) else {}
    while isinstance(node, dict):
        key = _case_key(s.get(node["by"]))
        path.append(f"{node['by']}={key}")
        if key not in node["cases"]:
            return None, ", ".join(path)
        node = node["cases"][key]
    return set(node), ", ".join(path) or "any spec"


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
    held = choices.get("pending_review")
    if held is not None and (not isinstance(held, list) or not all(
            isinstance(d, dict) and d.get("predicate") and d.get("misconception_id") for d in held)):
        problems.append(f"{qid}: pending_review is a list of {{predicate, misconception_id, why}}")
        held = []
    # Decision 47 (specs/003 FR-4306 amendment): a mapping the blind verifier did not confirm is HELD in
    # `pending_review` until a human keeps or drops it, and a widget whose every mapping is held ships as a
    # plain right/wrong widget. A widget with no mapping at all, active or held, is still refused.
    if not isinstance(diags, list) or (not diags and not held):
        problems.append(
            f"{qid}: no diagnostics — a widget with no predicate mapping can mark an "
            f"answer wrong but can never say why, which is the reason for ADR-0009"
        )
        return problems
    allowed_held = predicates_for(kind) - {OK}
    # W1: what THIS question can emit (its mode / ask / element / fn …), not only what the kind declares
    emits, where = can_emit(kind, choices.get("spec"))
    if emits is None:
        problems.append(f"{qid}: spec ({where}) reaches no case of {kind}'s can_emit table — a value the widget "
                        f"does not render")
    active = {d.get("predicate") for d in diags if isinstance(d, dict)}
    for d in held or []:
        if d["predicate"] not in allowed_held:
            problems.append(f"{qid}: held predicate {d['predicate']!r} is not one {kind} can emit")
        elif emits is not None and d["predicate"] not in emits:
            problems.append(f"{qid}: held predicate {d['predicate']!r} can never fire here — {kind} with {where} "
                            f"emits only {sorted(emits)}")
        if d["predicate"] in active:
            problems.append(f"{qid}: predicate {d['predicate']!r} is both active and held")
        if known_misconceptions is not None and d["misconception_id"] not in known_misconceptions:
            problems.append(f"{qid}: held predicate {d['predicate']!r} names misconception "
                            f"{d['misconception_id']!r}, which does not exist")

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
        elif emits is not None and p not in emits:
            problems.append(
                f"{qid}: predicate {p!r} can never fire here — {kind} with {where} emits only "
                f"{sorted(emits)}: the mapping is dead and the student would get a plain 'not quite'"
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

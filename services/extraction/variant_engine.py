"""Variant engine stub (PRD §7.3) — generates structural variants of seed questions.

PoC status: interface + grounding contract only. Wire an LLM API key to activate.
Every variant: same solution skeleton as its seed, new surface values, lands in
the review queue (status='review') with parent_question_id set. Nothing skips
the human review gate.

SACRED-CONTENT GUARD (ADR-0006, sensitive-content S1). The contract of this
function is "same skeleton, NEW SURFACE VALUES". Applied to a Quranic stem that
means machine-generated pseudo-scripture shipped to minors — the one defect in
this product that an apology does not repair. `assert_variable` therefore runs
FIRST, before the API-key check and before any model call, and it raises. It is
written here while the function is still a stub because this is the cheapest
this guard will ever be.
"""
from __future__ import annotations

import os
from typing import Iterable, Optional

from arabic_text import (
    SEALED_SENSITIVITY_CLASSES,
    longest_shared_word_run,
    scan_sacred_markers,
)
from schemas import Question, TextPassage

PROMPT_VERSION = "variant-v0"
MODEL = os.environ.get("AINEXT_MODEL", "claude-sonnet-5")

# A quote this long is a quote, not a coincidence (verification §1.6).
QUOTE_RUN_WORDS = 4


class VariantRefused(RuntimeError):
    """This question may not be varied. Never caught inside this module.

    `reason` is one of: 'sacred_class' | 'sacred_passage' | 'sacred_markers' |
    'sealed_passage' | 'quotes_passage'.
    """

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


def _question_text(seed: Question) -> str:
    """Every surface a variant generator would rewrite."""
    parts = [seed.stem]
    parts += [c.text for c in (seed.choices or [])]
    if isinstance(seed.answer, str):
        parts.append(seed.answer)
    parts += [s if isinstance(s, str) else s.claim_ar for s in seed.solution]
    return "\n".join(parts)


def assert_variable(seed: Question, passages: Iterable[TextPassage] = ()) -> None:
    """Raise unless this question may be structurally varied.

    Four independent gates, cheapest first. They overlap deliberately: the
    declared class is data a human set, the passage binding is structure, and
    the marker/quote scans are the backstop for a bundle that lies about both.

    `passages` is every sealed passage in scope. Omitting it does NOT make the
    call permissive for scripture — gates 1 and 3 still fire — but a caller that
    can supply passages must, or the quote gate cannot run.
    """
    # 1. Declared sacred class — the human-assigned label (sensitive-content §1).
    if seed.sensitivity_class in SEALED_SENSITIVITY_CLASSES:
        raise VariantRefused(
            "sacred_class",
            f"{seed.id}: refusing to vary '{seed.sensitivity_class}' content. Sacred text is "
            "copied, never produced — a generated near-miss verse is not a wrong answer, it is "
            "a corrupted scripture on a child's screen (ADR-0006 / sensitive-content S1, S4)")

    by_id = {p.id: p for p in passages}

    # 2. Bound to a passage — structure, not a label.
    if seed.passage_ref:
        src = by_id.get(seed.passage_ref)
        if src is not None and src.is_sacred:
            raise VariantRefused(
                "sacred_passage",
                f"{seed.id}: bound to sacred passage {src.id} ({src.attribution_ar}). Refusing "
                "regardless of how the question is classed")
        raise VariantRefused(
            "sealed_passage",
            f"{seed.id}: bound to sealed passage {seed.passage_ref}. A sealed passage is "
            "immutable — 'new surface values' over a fixed literary text means the text is no "
            "longer the book's (verification §1.1). Author a new question instead")

    # 3. Escalate-only detector over every surface (sensitive-content §1).
    if hits := scan_sacred_markers(_question_text(seed)):
        raise VariantRefused(
            "sacred_markers",
            f"{seed.id}: sacred-content markers in the question ({'; '.join(hits)}) and no human "
            "classification. Classify it before anything generates from it")

    # 4. The stem quotes a sealed passage (the no-retyping lint, §1.6) — catches
    #    the realistic case: an unlabelled question that quotes the text inline.
    for p in passages:
        run, text = longest_shared_word_run(_question_text(seed), p.store_text)
        if run >= QUOTE_RUN_WORDS:
            raise VariantRefused(
                "sacred_passage" if p.is_sacred else "quotes_passage",
                f"{seed.id}: quotes {run} consecutive words of sealed passage {p.id} "
                f"(«{text}»). Varying it would rewrite the book's own text")


def generate_variants(seed: Question, n: int = 3,
                      passages: Optional[Iterable[TextPassage]] = None) -> list[Question]:
    """Generate n structural variants of a seed question via LLM API.

    Contract (enforced downstream by the review gate + evals):
    - identical solution skeleton (same steps, different numbers/context)
    - same LO, same tier, same question type
    - canonical solution regenerated and re-verified against the final answer
    - every variant carries `variant_of = seed.id` (provenance, ADR-0001)
    """
    # FIRST — before the key check, before any model call. Any implementation
    # that moves this line below the API call has broken the guard.
    assert_variable(seed, passages or ())
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "Variant engine requires ANTHROPIC_API_KEY. "
            "PoC runs on authored seed questions only; this activates in Phase 2."
        )
    raise NotImplementedError("LLM variant generation lands in Phase 2 (see PRD §7.3)")

"""Variant engine stub (PRD §7.3) — generates structural variants of seed questions.

PoC status: interface + grounding contract only. Wire an LLM API key to activate.
Every variant: same solution skeleton as its seed, new surface values, lands in
the review queue (status='review') with parent_question_id set. Nothing skips
the human review gate.
"""
from __future__ import annotations

import os

from schemas import Question

PROMPT_VERSION = "variant-v0"
MODEL = os.environ.get("AINEXT_MODEL", "claude-sonnet-5")


def generate_variants(seed: Question, n: int = 3) -> list[Question]:
    """Generate n structural variants of a seed question via LLM API.

    Contract (enforced downstream by the review gate + evals):
    - identical solution skeleton (same steps, different numbers/context)
    - same LO, same tier, same question type
    - canonical solution regenerated and re-verified against the final answer
    """
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "Variant engine requires ANTHROPIC_API_KEY. "
            "PoC runs on authored seed questions only; this activates in Phase 2."
        )
    raise NotImplementedError("LLM variant generation lands in Phase 2 (see PRD §7.3)")

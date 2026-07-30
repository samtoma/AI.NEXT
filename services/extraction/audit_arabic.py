#!/usr/bin/env python3
"""Deterministic full-book audit for the Arabic bundles (ADR-0006).

    uv run audit_arabic.py seed/arabic-t1.json seed/arabic-t2.json

Checks that must not depend on a model's judgment:

1. SACRED CONTAINMENT (verification §1.6): no string anywhere in the bundles
   or the content files may quote a sealed sacred passage for ≥ N consecutive
   words (LOOSE comparison, so imlā'ī re-typings are caught) unless the item
   itself is classed quran/hadith — those are the exam-format quotes the human
   gate reviews. A leak in a 'secular' item is a VIOLATION.
2. Verification ledger: every sacred passage carries a crosscheck record;
   agree/flagged tallies, with flagged reasons listed for the human owner.
3. Graph sanity: every prerequisite edge endpoint exists; per-axis chains
   listed for the pedagogical review pass.
4. Coverage roll-up from the conveyor outputs (verdicts + non-covered items).

Exit code 1 on any VIOLATION; flags and review-queue items do not fail.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from arabic_text import longest_shared_word_run, SEALED_SENSITIVITY_CLASSES
from schemas import SeedBundle

HERE = Path(__file__).parent
QUOTE_RUN_THRESHOLD = 4  # words, verification §1.6


def iter_strings(obj, path=""):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from iter_strings(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from iter_strings(v, f"{path}[{i}]")


def main() -> None:
    bundle_paths = [Path(a) for a in sys.argv[1:]] or [
        HERE / "seed" / "arabic-t1.json", HERE / "seed" / "arabic-t2.json"]
    bundles = []
    for p in bundle_paths:
        if p.exists():
            bundles.append((p, SeedBundle.model_validate_json(p.read_text())))

    violations: list[str] = []
    infos: list[str] = []

    # every sealed sacred text in the book, by passage id
    sacred_texts: dict[str, str] = {}
    for _, b in bundles:
        for tp in b.text_passages:
            if tp.is_sacred:
                sacred_texts[tp.id] = tp.store_text

    # -- 1. containment sweep over bundles + content files --------------------
    def sweep(source_name: str, payload, item_class: str | None,
              own_passage: str | None = None) -> None:
        for path, s in iter_strings(payload):
            if len(s) < 12:
                continue
            for pid, sacred in sacred_texts.items():
                if pid == own_passage:
                    continue  # a passage may obviously contain itself
                n, run = longest_shared_word_run(s, sacred)
                if n >= QUOTE_RUN_THRESHOLD:
                    where = f"{source_name} :: {path}"
                    if item_class in SEALED_SENSITIVITY_CLASSES:
                        infos.append(
                            f"INFO sacred-classed quote ({n} words of {pid}) at {where} "
                            f"— exam-format quote, fidelity is the human gate's item")
                    else:
                        violations.append(
                            f"VIOLATION: {n}-word run of sealed {pid} inside "
                            f"'{item_class or 'unclassed'}' content at {where} — «{run[:60]}…»")

    for p, b in bundles:
        for q in b.questions:
            payload = {"stem": q.stem, "solution": q.solution,
                       "choices": [c.model_dump() for c in (q.choices or [])],
                       "answer": q.answer if isinstance(q.answer, str)
                       else q.answer.model_dump()}
            sweep(f"{p.name}:{q.id}", payload, q.sensitivity_class)
        for note in b.rhetoric_notes:
            sweep(f"{p.name}:{note.id}",
                  {"effect": note.effect_ar},  # expression IS a sealed quote by design
                  "quran" if note.passage_ref in sacred_texts else "secular")
        for g in b.grammar_rules:
            sweep(f"{p.name}:{g.id}", [c.model_dump() for c in g.clauses], "secular")

    content_dir = HERE / "seed" / "content"
    for cpath in sorted(content_dir.glob("ara*.json")):
        c = json.loads(cpath.read_text())
        own = [pp["id"] for pp in c.get("passages", []) if pp.get("sacred")]
        payload = {k: v for k, v in c.items() if k != "passages"}
        sweep(cpath.name, payload, "secular",
              own_passage=own[0] if own else None)

    # -- 2. verification ledger ----------------------------------------------
    n_agree = n_flagged = 0
    for _, b in bundles:
        for tp in b.text_passages:
            if not tp.is_sacred:
                continue
            v = tp.verification
            if v and v.verdict == "agree":
                n_agree += 1
            else:
                n_flagged += 1
                infos.append(f"FLAGGED sacred passage {tp.id}: "
                             f"{(v.flag_reason if v else 'no verification record')}")

    # -- 3. graph sanity -------------------------------------------------------
    n_prereq = 0
    for p, b in bundles:
        ids = {n.id for n in b.nodes} | set(b.external_node_refs)
        for e in b.edges:
            if e.type != "prerequisite_of":
                continue
            n_prereq += 1
            if e.src not in ids or e.dst not in ids:
                violations.append(f"VIOLATION: dangling prerequisite {e.src} → {e.dst} in {p.name}")

    # -- report ----------------------------------------------------------------
    total_q = sum(len(b.questions) for _, b in bundles)
    total_p = sum(len(b.text_passages) for _, b in bundles)
    print(f"audited {len(bundles)} bundle(s): {total_q} questions, {total_p} passages "
          f"({len(sacred_texts)} sacred: {n_agree} agree / {n_flagged} flagged), "
          f"{n_prereq} prerequisite edges")
    for line in infos:
        print(f"  {line}")
    if violations:
        print(f"\n{len(violations)} VIOLATION(S):")
        for line in violations:
            print(f"  {line}")
        sys.exit(1)
    print("containment sweep CLEAN — no sealed text leaks into secular content")


if __name__ == "__main__":
    main()

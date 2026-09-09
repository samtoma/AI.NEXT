#!/usr/bin/env python3
"""Assemble the generated explanation / refutation library into a SeedBundle.

Input:  the refutation workflow's output JSON (runbook/refutation.workflow.js),
        one record per learning objective.
Output: seed/refutations-math.json — a SeedBundle carrying ONLY misconceptions
        and explanation_entries, attached to learning objectives defined by the
        already-loaded maths bundles via `external_node_refs`.

Why a separate bundle rather than editing the maths bundles: the comparison
depends on the maths content being byte-identical to what the baseline serves
(FR-904). Touching unit1.json to add refutations would change the very files
parity_check.py fingerprints. This bundle is purely additive — the maths content
is untouched, and only the comparison environment loads this file.

⚠️  Constitution v2.0.0 Principle III is SUSPENDED for this content (ADR-0007,
decisions.md Q8): no reviewer exists at this stage, so it ships unreviewed. The
loader forces reviewed=false; nothing here can claim otherwise.

Usage:
    uv run assemble_refutations.py <workflow-output.json> [--out seed/refutations-math.json]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter

from schemas import SeedBundle

SEED = os.path.join(os.path.dirname(__file__), "seed")
SOURCE_FILE = "docs/Source/Math_En_Prp3_Tr1_2.pdf"
COURSE = "course:prep3-math-en"

ENTRY_TYPES = {"worked_example", "faded", "contrasting_case", "refutation"}
SLUG_RE = re.compile(r"[^a-z0-9]+")


def slug(text: str) -> str:
    """Stable, id-safe slug. Deterministic so a re-run produces the same ids
    and a reload replaces rather than duplicates."""
    return SLUG_RE.sub("-", text.strip().lower()).strip("-")[:40] or "x"


def build(records: list[dict], generator: str) -> tuple[list[dict], list[dict], set[str]]:
    misconceptions: list[dict] = []
    entries: list[dict] = []
    lo_ids: set[str] = set()
    seen_misc: set[str] = set()
    seen_entry: set[str] = set()

    for rec in records:
        lo = rec.get("lo")
        if not lo:
            raise SystemExit(f"record missing 'lo': {json.dumps(rec)[:120]}")
        lo_ids.add(lo)
        lo_tail = lo.split(":", 1)[-1]

        for m in rec.get("misconceptions", []) or []:
            mid = m.get("id") or f"misc:{lo_tail}:{slug(m['label'])}"
            if mid in seen_misc:
                # A duplicate id means two different misconceptions would collide
                # into one row and the second would silently win. Fail loudly.
                raise SystemExit(f"duplicate misconception id: {mid}")
            seen_misc.add(mid)
            misconceptions.append(
                {
                    "id": mid,
                    "lo": lo,
                    "label": m["label"],
                    "description": m["description"],
                    # Absent rather than guessed: a wrong signal drives a wrong
                    # diagnosis, which is worse than no diagnosis at all.
                    "signal": m.get("signal") or None,
                    "generated_by": generator,
                }
            )

        for idx, e in enumerate(rec.get("entries", []) or [], start=1):
            etype = e.get("entry_type")
            if etype not in ENTRY_TYPES:
                raise SystemExit(f"{lo}: unknown entry_type {etype!r}")
            misc = e.get("misconception")
            if misc and misc not in seen_misc:
                raise SystemExit(f"{lo}: entry references unknown misconception {misc}")
            # Prefer the misconception it answers, then a title, then the
            # ordinal. The ordinal matters: two untitled worked examples on one
            # LO are legitimate content, and without it they would both slug to
            # the same id and trip the duplicate guard below — a loud failure,
            # but for a reason the author cannot act on.
            if misc:
                tail = slug(misc.split(":")[-1])
            elif e.get("title"):
                tail = slug(e["title"])
            else:
                tail = str(idx)
            eid = e.get("id") or f"expl:{lo_tail}:{etype}:{tail}"
            if eid in seen_entry:
                raise SystemExit(f"duplicate explanation id: {eid}")
            seen_entry.add(eid)

            content = e.get("content")
            if not isinstance(content, list) or not content:
                raise SystemExit(f"{eid}: content must be a non-empty list of steps")

            entries.append(
                {
                    "id": eid,
                    "lo": lo,
                    "entry_type": etype,
                    "content": content,
                    "misconception": misc,
                    "source_page": e.get("source_page"),
                    "generated_by": generator,
                }
            )

    return misconceptions, entries, lo_ids


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", help="refutation workflow output JSON")
    ap.add_argument("--out", default=os.path.join(SEED, "refutations-math.json"))
    ap.add_argument(
        "--generator",
        default="refutation.workflow.js (pipeline-generated, UNREVIEWED)",
        help="attribution stamped on every row",
    )
    args = ap.parse_args()

    raw = json.load(open(args.input, encoding="utf-8"))
    records = raw["records"] if isinstance(raw, dict) and "records" in raw else raw
    if not isinstance(records, list):
        raise SystemExit("input must be a list of records, or {records: [...]}")

    misconceptions, entries, lo_ids = build(records, args.generator)

    bundle = {
        "source_file": SOURCE_FILE,
        "extraction_run": {
            "extractor": "refutation.workflow.js",
            "extractor_version": "1",
            "schema_version": "1",
        },
        "syllabus_version": "2025-2026",
        "nodes": [],
        "edges": [],
        "questions": [],
        # Every LO already exists, loaded by the maths bundles. Declaring them
        # external is what lets this bundle attach without redefining — and
        # without touching the content parity_check.py fingerprints.
        "external_node_refs": sorted(lo_ids | {COURSE}),
        "misconceptions": misconceptions,
        "explanation_entries": entries,
    }

    # Validate with the real schema before writing: an invalid bundle should die
    # here, with the source records in hand, not at load time against a database.
    SeedBundle.model_validate(bundle)

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(bundle, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    by_type = Counter(e["entry_type"] for e in entries)
    print(f"wrote {args.out}")
    print(f"  learning objectives : {len(lo_ids)}")
    print(f"  misconceptions      : {len(misconceptions)}")
    print(f"  explanation entries : {len(entries)}")
    for t in sorted(by_type):
        print(f"      {t:<18}{by_type[t]}")
    without = sum(1 for lo in lo_ids
                  if not any(m["lo"] == lo for m in misconceptions))
    if without:
        print(f"  ⚠ {without} LO(s) produced no misconception — those fall back to the "
              f"canonical solution and raise an authoring-gap flag at runtime (FR-305)")
    print("\n  ALL entries load reviewed=false — constitution III is suspended for "
          "this content in the comparison environment only (ADR-0007).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

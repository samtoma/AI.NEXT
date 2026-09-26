"""Pipeline normalisations of an S6 author's family spec — mechanical, no maths change, always recorded.

    uv run python -m families.normalise families/<book>/<file>.json [...] [--dry-run]

An author spec that breaks a FORMAT rule the prompt states is refused by ``--check`` (families/spec.py).
Most such refusals are the author's to fix, and go back to the author. Two are not a question of content at
all, and this module fixes them the same way every time:

  drop-redundant-answer   an expression family carries a top-level "answer" beside marker.answer. Its answer
                          IS marker.answer (spec.py); the extra field is dropped, the marker untouched.
  rename-shadowing-param  a param is named like a built-in (num, frac, gcd …), which would hide it. The param
                          is renamed <name>_v in every expression and every {=…} hole — never where the name is
                          CALLED, which is the built-in — and nothing else changes.

Anything else is an author error and is left alone. Each rule applied is appended to the spec's "notes" as
"PIPELINE NORMALISATION (not an author edit) …", so the stored spec says what the pipeline changed and why; a
re-run on a normalised spec changes nothing. Applied by an operator, by name of file, never silently inside
--check: the check keeps refusing the raw author output (reject rather than repair is the stage's rule).
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from pathlib import Path

from families import evaluator as E

MARK = "PIPELINE NORMALISATION (not an author edit)"
EXPR_DRAWS = ("randint", "choice", "sample", "shuffle", "let")


def _rename_in_expr(src: str, old: str, new: str) -> str:
    # the name, not a longer name containing it, not an attribute, and not a call of the built-in
    return re.sub(rf"(?<![A-Za-z0-9_.]){re.escape(old)}(?![A-Za-z0-9_])(?!\s*\()", new, src)


def _rename_in_template(text: str, old: str, new: str) -> str:
    out, last = [], 0
    for start, end, src in E._scan(text):
        out.append(text[last:start])
        out.append(text[start:end].replace(src, _rename_in_expr(src, old, new), 1))
        last = end
    out.append(text[last:])
    return "".join(out)


def _rename_everywhere(raw: dict, old: str, new: str) -> None:
    for prm in raw.get("params") or []:
        if prm.get("name") == old:
            prm["name"] = new
        for k in (*EXPR_DRAWS, "resample_while", "require"):
            v = prm.get(k)
            if isinstance(v, str):
                prm[k] = _rename_in_expr(v, old, new)
            elif isinstance(v, dict) and isinstance(v.get("from"), str):   # sample: {"from": expr, "k": n}
                v["from"] = _rename_in_expr(v["from"], old, new)
    raw["constraints"] = [_rename_in_expr(c, old, new) if isinstance(c, str) else c
                          for c in raw.get("constraints") or []]
    tpl = lambda s: _rename_in_template(s, old, new) if isinstance(s, str) else s  # noqa: E731
    raw["stem"] = tpl(raw.get("stem"))
    raw["solution"] = [tpl(s) for s in raw.get("solution") or []]
    if isinstance(raw.get("answer"), str):
        # a numeric family's answer is an expression; any other's is a template
        raw["answer"] = tpl(raw["answer"]) if "{=" in raw["answer"] else _rename_in_expr(raw["answer"], old, new)
    if isinstance(raw.get("marker"), dict) and isinstance(raw["marker"].get("answer"), str):
        raw["marker"]["answer"] = tpl(raw["marker"]["answer"])
    ch = raw.get("choices")
    if isinstance(ch, dict):
        ch["correct"] = tpl(ch.get("correct"))
        for d in ch.get("distractors") or []:
            if isinstance(d, dict):
                d["text"] = tpl(d.get("text"))


def normalise(raw: dict) -> tuple[dict, list[str]]:
    """The spec with every mechanical normalisation applied, and what was done (empty: nothing to do)."""
    out = copy.deepcopy(raw)
    done: list[str] = []
    marker = out.get("marker") if isinstance(out.get("marker"), dict) else {}
    if out.get("answer_type") == "expression" and "answer" in out and marker.get("answer"):
        done.append(f"drop-redundant-answer: removed the top-level \"answer\" ({json.dumps(out['answer'], ensure_ascii=False)}); "
                    f"an expression family's answer is marker.answer ({json.dumps(marker['answer'], ensure_ascii=False)}), "
                    "unchanged")
        del out["answer"]
    names = {p.get("name") for p in out.get("params") or [] if isinstance(p, dict)}
    for prm in list(out.get("params") or []):
        name = prm.get("name") if isinstance(prm, dict) else None
        if name and (name in E.FUNCTIONS or name in E.CONSTANTS):
            new, n = f"{name}_v", 2
            while new in names or new in E.FUNCTIONS or new in E.CONSTANTS:
                new, n = f"{name}_v{n}", n + 1
            _rename_everywhere(out, name, new)
            names.add(new)
            done.append(f"rename-shadowing-param: param {name!r} hid the built-in {name}(); renamed {new!r} in "
                        "every expression and hole, nothing else changed")
    if done:
        stamp = f"{MARK}: " + "; ".join(done) + "."
        out["notes"] = (out.get("notes") or "").rstrip() + ("\n\n" if out.get("notes") else "") + stamp
    return out, done


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", type=Path, nargs="+")
    ap.add_argument("--dry-run", action="store_true", help="say what would change; write nothing")
    args = ap.parse_args(argv)
    for f in args.files:
        raw = json.loads(f.read_text())
        out, done = normalise(raw)
        print(f"{f.name}: " + ("; ".join(done) if done else "nothing to normalise"))
        if done and not args.dry_run:
            f.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

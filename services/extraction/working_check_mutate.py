"""An UNBIASED calibration set for the working checker: known-good solutions with one injected defect each.

    uv run working_check_mutate.py --seed work/g10-math/pilot/seed/g10m-c08.json \\
        --calibration runs/g10-math/working-check/ch08.calibration.json \\
        --out-bundle work/g10-math/pilot/mutants/g10m-c08.cal2.json --out-truth runs/g10-math/working-check/ch08.mutants.json \\
        [--per-op 8] [--rng 8]
    uv run working_check.py args --seed <out-bundle> … --aliases <out-truth>      # the packet for a calibration run
    uv run working_check.py calibrate --truth <calibration.json> --mutants <out-truth> --flags <flags.json>

WHY. The Chapter 8 truth (runs/<book>/working-check/ch08.calibration.json) is sw-v1's OWN findings, classified by
hand: sw-v1 scores 100% against it by construction, so every other configuration looks worse next to it and
nobody can say how many defects the line misses that NO run has found. A mutant is the opposite: a solution
the earlier passes agreed was fine (sw-v1 called it consistent, and it is not one of the flagged ones) with ONE
defect of a named kind put in by this script, so the truth is known without reading the checker's output, by
defect class, and the checker never saw the answer. The defects are the kinds the real ones were:

  wrong_value   a coordinate of the question text changed (A(-3, 6) → A(-3, 7)) where the working still uses the
                old number: "a substituted value is not the question's"
  label         one occurrence of a subscript label (m_{AB}) changed to another point's (m_{AC}) where the
                solution uses that label at least twice
  sign          a negative bracket in a line that has a variable ((-2) → (2)), which the free numeric pre-check
                cannot see (it skips lines with letters)
  final_answer  the key changed (42.5 → 42.6), so the last step no longer states it
  stem_label    a point's name in the question text changed to a name the working never uses (Q for T: the book's
                own we01 misprint)

Each operator applies only where the defect is real and the free pre-check does NOT change (a mutant that the
free numeric check catches would measure the evaluator, not the agents). A mutant gets an organic-looking id
(`…:ex8-9-101`, an exercise that does not exist) so the agent is not told what it is reading; the truth file
records base, operator, kind and step. The output bundle holds the calibration subset's ORIGINAL solutions (so
one run also measures false flags on known-good controls and recall on the real defects) plus the mutants, whose
BASES are never in the subset (a mutant never shares a run with its own original).

Deterministic: the same bundle, calibration file and --rng give byte-identical output.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import working_check as W  # noqa: E402

OPERATORS = ("wrong_value", "label", "sign", "final_answer", "stem_label")
FORMAT = "ainext.working-check-mutants/1"


# ---------------------------------------------------------------------------- the raw items of a bundle
def get_stem(item: dict) -> str:
    if "content" in item:
        return next((c.get("text_md", "") for c in item["content"] if c.get("kind") == "problem"), "")
    return item.get("stem") or ""


def set_stem(item: dict, text: str) -> None:
    if "content" in item:
        next(c for c in item["content"] if c.get("kind") == "problem")["text_md"] = text
    else:
        item["stem"] = text


def get_steps(item: dict) -> list[str]:
    if "content" in item:
        return [c.get("text_md", "") for c in item["content"] if c.get("kind") != "problem"]
    sol = item.get("solution") or item.get("canonical_solution") or []
    return [x.get("text_md", "") if isinstance(x, dict) else str(x) for x in sol]


def set_step(item: dict, i: int, text: str) -> None:
    if "content" in item:
        [c for c in item["content"] if c.get("kind") != "problem"][i]["text_md"] = text
        return
    key = "solution" if "solution" in item else "canonical_solution"
    if isinstance(item[key][i], dict):
        item[key][i]["text_md"] = text
    else:
        item[key][i] = text


def _key_of(item: dict):
    return item.get("answer") if "answer" in item else item.get("correct_answer")


def _set_key(item: dict, text: str) -> None:
    item["answer" if "answer" in item else "correct_answer"] = text


def _view(item: dict) -> dict:
    return W.solutions_from_bundle({"questions": [] if "content" in item else [item],
                                    "explanation_entries": [item] if "content" in item else []})[0]


def _precheck_n(item: dict) -> int:
    return len(W.precheck_solution(_view(item)))


# ---------------------------------------------------------------------------- the operators
_NUM = re.compile(r"(?<![\d.])\d+(?![\d.])")


def _standalone(num: str, text: str) -> bool:
    return re.search(rf"(?<![\d.]){re.escape(num)}(?![\d.])", text) is not None


def op_wrong_value(item: dict):
    stem, steps = get_stem(item), get_steps(item)
    text = " ".join(steps)
    for m in re.finditer(r"[A-Z]\s*(?:\\left)?\(([^()]*?)(?:\\right)?\)", stem):
        for n in _NUM.finditer(m.group(1)):
            tok = n.group(0)
            if int(tok) < 3 or not _standalone(tok, text):
                continue
            new = str(int(tok) + 1)
            if _standalone(new, stem + " " + text):
                continue
            a, b = m.start(1) + n.start(), m.start(1) + n.end()
            step = next(i for i, s in enumerate(steps, start=1) if _standalone(tok, s))
            was = m.group(0)
            now = stem[m.start():a] + new + stem[b:m.end()]
            return ({"stem": stem[:a] + new + stem[b:]},
                    {"step": step, "kind": "wrong_value", "where": "question", "detail": f"question text: {was} → {now}"})
    return None


def op_label(item: dict):
    stem, steps = get_stem(item), get_steps(item)
    occ: dict[str, list[tuple[int, re.Match]]] = {}
    for si, st in enumerate(steps):
        for m in re.finditer(r"_\{([A-Z])([A-Z])\}", st):
            occ.setdefault(m.group(1) + m.group(2), []).append((si, m))
    letters = sorted(set(re.findall(r"(?<![A-Za-z\\])([A-Z])(?![A-Za-z])", stem + " " + " ".join(steps))))
    for lab, hits in sorted(occ.items()):
        if len(hits) < 2:
            continue
        x, y = lab
        for w in letters:
            new = x + w
            if w in (x, y) or new in occ or w + x in occ:
                continue
            si, m = hits[-1]
            st = steps[si]
            return ({"step_index": si, "step_text": st[:m.start()] + f"_{{{new}}}" + st[m.end():]},
                    {"step": si + 1, "kind": "label", "where": "working", "detail": f"step {si + 1}: _{{{lab}}} → _{{{new}}}"})
    return None


def op_sign(item: dict):
    steps = get_steps(item)
    for si, st in enumerate(steps):
        for line in re.split(r"\\\\", st):
            plain = re.sub(r"\\[A-Za-z]+(\{[^{}]*\})?", "", re.sub(r"_\{[^{}]*\}|_\w|\^\{[^{}]*\}|\^\w", "", line))
            if not re.search(r"(?<![A-Za-z\\])[a-zA-Z](?![A-Za-z])", plain):
                continue
            m = re.search(r"\(-\s*(\\text\{)?(\d+(?:\.\d+)?)\}?\)", line)
            if not m:
                continue
            new_line = line[:m.start()] + f"({m.group(2)})" + line[m.end():]
            return ({"step_index": si, "step_text": st.replace(line, new_line, 1)},
                    {"step": si + 1, "kind": "sign", "where": "working", "detail": f"step {si + 1}: {m.group(0)} → ({m.group(2)})"})
    return None


def op_final_answer(item: dict):
    key = _key_of(item)
    steps = get_steps(item)
    if key is None or not steps:
        return None
    k = str(key)
    if not re.search(r"\d", k) or re.search(r"[A-Za-z]", re.sub(r"\\[A-Za-z]+", "", k)):
        return None
    runs = list(re.finditer(r"\d+", k))
    last = steps[-1]
    for m in reversed(runs):
        d = m.group(0)
        new = d[:-1] + str((int(d[-1]) + 1) % 10)
        if _standalone(d, last) and not _standalone(new, last):
            return ({"key": k[:m.start()] + new + k[m.end():]},
                    {"step": len(steps), "kind": "final_answer", "where": "working", "detail": f"key {k} → {k[:m.start()] + new + k[m.end():]}"})
    return None


def op_stem_label(item: dict):
    stem, steps = get_stem(item), get_steps(item)
    text = " ".join(steps)
    used = set(re.findall(r"(?<![A-Za-z\\])([A-Z])(?![A-Za-z])", stem + " " + text + " " + str(_key_of(item) or "")))
    spare = [c for c in "TUVWXYZRSQNMLK" if c not in used]
    if not spare:
        return None
    for m in re.finditer(r"(?<![A-Za-z\\])([A-Z])(\s*(?:\\left)?\()", stem):
        letter = m.group(1)
        if len(re.findall(rf"(?<![A-Za-z\\]){letter}(?![A-Za-z])", text)) < 2:
            continue
        new = spare[0]
        return ({"stem": stem[:m.start(1)] + new + stem[m.end(1):]},
                {"step": None, "kind": "label", "where": "question", "detail": f"question text: point {letter}(…) renamed {new}"})
    return None


_OPS = {"wrong_value": op_wrong_value, "label": op_label, "sign": op_sign, "final_answer": op_final_answer,
        "stem_label": op_stem_label}


def apply(item: dict, op: str) -> tuple[dict, dict] | None:
    """(the mutated copy, its truth) or None where the operator does not apply or a free check would see it."""
    r = _OPS[op](item)
    if r is None:
        return None
    edit, truth = r
    new = copy.deepcopy(item)
    if "stem" in edit:
        set_stem(new, edit["stem"])
    if "step_text" in edit:
        set_step(new, edit["step_index"], edit["step_text"])
    if "key" in edit:
        _set_key(new, edit["key"])
    if _precheck_n(new) != _precheck_n(item):
        return None
    return new, {**truth, "operator": op}


# ---------------------------------------------------------------------------- the set
def _rank(rng: int, sid: str) -> str:
    return hashlib.sha256(f"{rng}:{sid}".encode()).hexdigest()


def new_id(base_id: str, n: int) -> str:
    kind, lo = base_id.split(":")[:2]
    return f"{kind}:{lo}:ex8-9-{100 + n}"


def build(bundle: dict, calibration: dict, per_op: int = 8, rng: int = 8) -> tuple[dict, dict]:
    """(the calibration bundle: the subset's originals + the mutants, the mutants truth)."""
    subset = set(calibration["subset"])
    items = [(it, "questions") for it in bundle.get("questions") or []] + \
            [(it, "explanation_entries") for it in bundle.get("explanation_entries") or []]
    sols = {s["id"]: s for s in W.solutions_from_bundle(bundle)}
    pool = sorted((it for it, _ in items if it["id"] not in subset and it["id"] in sols and W.has_working(sols[it["id"]])),
                  key=lambda it: _rank(rng, it["id"]))
    used: set[str] = set()
    mutants, out_items = [], {"questions": [], "explanation_entries": []}
    for it, field in items:
        if it["id"] in subset:
            out_items[field].append(copy.deepcopy(it))
    for op in OPERATORS:
        got = 0
        for it in pool:
            if got >= per_op:
                break
            if it["id"] in used:
                continue
            r = apply(it, op)
            if r is None:
                continue
            new, truth = r
            n = len(mutants) + 1
            new["id"] = new_id(it["id"], n)
            used.add(it["id"])
            field = "explanation_entries" if "content" in it else "questions"
            out_items[field].append(new)
            mutants.append({"id": new["id"], "base": it["id"], **truth})
            got += 1
    # one stable order for the packet: a mutant sits among the originals by a hash, not at the end
    for field in out_items:
        out_items[field].sort(key=lambda x: _rank(rng, x["id"]))
    out = {k: v for k, v in bundle.items() if k not in ("questions", "explanation_entries")}
    out.update(out_items)
    truth = {"format": FORMAT, "chapter": 8, "rng": rng, "per_operator": per_op,
             "rule": "Each mutant is a v1-consistent solution outside the calibration subset with ONE injected defect; "
                     "`base` is the original, `operator`/`kind`/`step` the injected defect. A mutant counts as caught when an "
                     "AGENT flags it (a free check never sees these: the operators leave the pre-check unchanged).",
             "mutants": mutants,
             "by_operator": {op: sum(m["operator"] == op for m in mutants) for op in OPERATORS}}
    return out, truth


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--seed", type=Path, required=True, help="the chapter bundle")
    ap.add_argument("--calibration", type=Path, required=True, help="the chapter's calibration truth (its `subset`)")
    ap.add_argument("--out-bundle", type=Path, required=True)
    ap.add_argument("--out-truth", type=Path, required=True)
    ap.add_argument("--per-op", type=int, default=8)
    ap.add_argument("--rng", type=int, default=8)
    a = ap.parse_args(argv)
    bundle, truth = build(json.loads(a.seed.read_text()), json.loads(a.calibration.read_text()), a.per_op, a.rng)
    a.out_bundle.parent.mkdir(parents=True, exist_ok=True)
    a.out_truth.parent.mkdir(parents=True, exist_ok=True)
    a.out_bundle.write_text(json.dumps(bundle, ensure_ascii=False, indent=1) + "\n")
    a.out_truth.write_text(json.dumps(truth, ensure_ascii=False, indent=1) + "\n")
    n = len(bundle["questions"]) + len(bundle["explanation_entries"])
    print(f"{len(truth['mutants'])} mutant(s) {truth['by_operator']} + {n - len(truth['mutants'])} original(s) → {a.out_bundle}; truth → {a.out_truth}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

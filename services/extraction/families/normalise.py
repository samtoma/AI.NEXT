"""Pipeline normalisations of an S6 author's family spec — mechanical, no maths change, always recorded.

    uv run python -m families.normalise families/<book>/<file>.json [...] [--dry-run]

An author spec that breaks a FORMAT rule the prompt states is refused by ``--check`` (families/spec.py).
Most such refusals are the author's to fix, and go back to the author. Four are not a question of content at
all, and this module fixes them the same way every time:

  drop-redundant-answer   an expression family carries a top-level "answer" beside marker.answer. Its answer
                          IS marker.answer (spec.py); the extra field is dropped, the marker untouched.
  rename-shadowing-param  a param is named like a built-in (num, frac, gcd …), which would hide it. The param
                          is renamed <name>_v in every expression and every {=…} hole — never where the name is
                          CALLED, which is the built-in — and nothing else changes.
  distinct-by-choices     a multiple-choice family whose stem has no {=…} hole is the same sentence in every
                          instance, so the duplicate-stem filter would keep one item of the whole family. The
                          variation is in the options; the spec is marked "distinct_by_choices": true, which
                          makes the filter read stem plus the set of options (generate_questions.same_question).
  rename-colliding-slug   two families on one objective share the first six letters of their slug, so they would
                          mint the same item ids (q:<objective>:g001-<six letters>) and --check refuses both.
                          Unlike the rules above this one needs the siblings, so it works on the directory of
                          each file named: the family first in file-name order keeps its slug, each other is
                          renamed by rotating its words (which-rational -> rational-which), else prefixed f2-,
                          f3- …, to the first slug whose six letters are free; the file is renamed to match. It
                          NEVER renames a family whose items are already loaded: Chapters 1, 2 and 8 of the
                          Grade 10 book, any family named in a generated bundle under seed/generated, and every
                          family of another book (prep3) — those are left, and reported, for a person to decide.
                          A sibling not named on the command line is never renamed either.

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
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from families import evaluator as E
from families import spec as FS

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
    stem = out.get("stem")
    if (out.get("answer_type") == "mcq" and isinstance(stem, str) and not out.get("distinct_by_choices")
            and E.holes(stem) == []):
        out["distinct_by_choices"] = True
        done.append("distinct-by-choices: the stem has no {=…} hole, so it is the same sentence in every instance "
                    "and only the options differ; the duplicate filter now reads stem plus options, so the "
                    "family is not collapsed to one item")
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
        record(out, done)
    return out, done


def record(raw: dict, done: list[str]) -> None:
    """Append what the pipeline changed to the spec's notes, in the form every rule uses (in place)."""
    stamp = f"{MARK}: " + "; ".join(done) + "."
    raw["notes"] = (raw.get("notes") or "").rstrip() + ("\n\n" if raw.get("notes") else "") + stamp


# ---------------------------------------------------------------- slug collisions (needs the siblings)
# Chapters of the Grade 10 book whose generated items are already loaded: their item ids are in the database
# and in students' history, so their families keep their ids for good. Extend it when a chapter is loaded
# (a family named in a bundle under seed/generated is protected without being listed).
LOADED_G10_CHAPTERS = frozenset({1, 2, 8})
_G10_TAIL = re.compile(r"^g10m(\d+)s")
_SLUG_OK = re.compile(r"^[a-z0-9][a-z0-9-]*$")
SEED_GENERATED = Path(__file__).resolve().parent.parent / "seed" / "generated"


def loaded_family_ids(seed_dir: Path = SEED_GENERATED) -> set[str]:
    """Every family id a generated-questions bundle under ``seed_dir`` names: its items were generated and
    are loaded (or ready to load), so the family may not be renamed."""
    ids: set[str] = set()
    for f in sorted(Path(seed_dir).rglob("*.json")):
        try:
            data = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict) or not isinstance(data.get("questions"), list):
            continue
        for key in ("families", "family_specs", "family_grades"):
            if isinstance(data.get(key), dict):
                ids.update(k for k in data[key] if isinstance(k, str))
        ids.update(q["family"] for q in data["questions"] if isinstance(q, dict) and isinstance(q.get("family"), str))
    return {i for i in ids if i.startswith("tpl:")}


def pinned_reason(raw: dict, loaded: set[str] | frozenset[str]) -> str | None:
    """Why this family may NOT be renamed (None: it may)."""
    m = _G10_TAIL.match(str(raw.get("lo_id", "")).removeprefix("lo:"))
    if not m:
        return "it is not a Grade 10 family: the other books' items are loaded"
    if int(m.group(1)) in LOADED_G10_CHAPTERS:
        return f"Chapter {int(m.group(1))}'s items are already loaded"
    if raw.get("id") in loaded:
        return "its items are in a generated bundle"
    return None


@dataclass
class Sibling:
    """One spec file of a directory: ``pinned`` is the reason it may not be renamed, or None."""
    name: str
    raw: dict
    pinned: str | None = None


def _key(raw: dict, slug: str | None = None):
    """The id-prefix key of a spec (None for one too malformed to have one: the check reports that)."""
    m = FS.FAMILY_ID_RE.match(str(raw.get("id", "")))
    lo = FS.LO_RE.match(str(raw.get("lo_id", "")))
    if not m or not lo or raw.get("kind", "family") not in FS.KINDS:
        return None
    return FS.id_prefix_key(lo.group(1), raw.get("kind", "family"), slug if slug is not None else m.group(2))


def _slug(raw: dict) -> str:
    return str(raw["id"]).rsplit(":", 1)[-1]


def _candidates(slug: str) -> Iterator[str]:
    """New slugs for a colliding one, in the order they are tried: its words rotated (which-rational ->
    rational-which), then f2-<slug>, f3-<slug> … — no randomness, so the same directory always gives the same names."""
    words = slug.split("-")
    for k in range(1, len(words)):
        yield "-".join(words[k:] + words[:k])
    j = 2
    while True:
        yield f"f{j}-{slug}"
        j += 1


@dataclass
class Rename:
    name: str          # the file before
    new_name: str      # the file after (the same when its name did not follow <objective>--<slug>.json)
    raw: dict          # the spec after: new id, recorded in its notes
    old_id: str
    new_id: str


def rename_colliding(siblings: list[Sibling]) -> tuple[list[Rename], list[str]]:
    """The renames that make a directory's families mint distinct item ids, and what could not be fixed.

    Deterministic: families are taken in file-name order; of a colliding group the first keeps its slug (a
    family that may not be renamed always keeps it), every other is renamed to the first candidate whose six
    letters nothing else on the objective uses. A group with two families that may not be renamed is left, and
    named in the second list: that is a person's decision."""
    keyed = [(sb, _key(sb.raw)) for sb in sorted(siblings, key=lambda x: x.name)]
    groups: dict[tuple, list[Sibling]] = {}
    for sb, k in keyed:
        if k is not None:
            groups.setdefault(k, []).append(sb)
    occupied = set(groups)
    renames: list[Rename] = []
    unresolved: list[str] = []
    for k in sorted(groups):
        members = groups[k]
        if len(members) < 2:
            continue
        fixed = [m for m in members if m.pinned]
        free = [m for m in members if not m.pinned]
        if len(fixed) >= 2:
            unresolved.append(
                f"{', '.join(_slug(m.raw) for m in members)} (objective {k[0]}) share the first six letters of their "
                "slug and cannot be renamed here: " + "; ".join(f"{_slug(m.raw)}: {m.pinned}" for m in fixed))
            continue
        keeper = fixed[0] if fixed else free[0]
        for m in free:
            if m is keeper:
                continue
            old_slug = _slug(m.raw)
            for new_slug in _candidates(old_slug):
                nk = _key(m.raw, new_slug)
                if _SLUG_OK.match(new_slug) and nk not in occupied:
                    break
            occupied.add(nk)
            new_id = str(m.raw["id"]).rsplit(":", 1)[0] + ":" + new_slug
            suffix = f"--{old_slug}.json"
            new_name = m.name[:-len(suffix)] + f"--{new_slug}.json" if m.name.endswith(suffix) else m.name
            out = copy.deepcopy(m.raw)
            out["id"] = new_id
            record(out, [f"rename-colliding-slug: id {m.raw['id']} -> {new_id}"
                         + (" (file renamed to match)" if new_name != m.name else "")
                         + f". The first six letters of the slug were shared with a sibling family on the same "
                           f"objective ({_slug(keeper.raw)}), so their item ids (q:<objective>:g001-<six letters>) "
                           "would collide; --check refuses that. Nothing else changed"])
            renames.append(Rename(m.name, new_name, out, m.raw["id"], new_id))
    return renames, unresolved


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", type=Path, nargs="+")
    ap.add_argument("--dry-run", action="store_true", help="say what would change; write nothing")
    args = ap.parse_args(argv)

    # 1. the rules that need one spec only
    after: dict[Path, tuple[dict, list[str]]] = {}
    for f in args.files:
        raw = json.loads(f.read_text())
        after[f] = normalise(raw)

    # 2. slug collisions, per directory: the siblings are every spec file beside those named
    loaded = loaded_family_ids()
    moved: dict[Path, Rename] = {}
    unresolved: list[str] = []
    for directory in sorted({f.parent for f in after}):
        siblings = []
        for g in sorted(directory.glob("*.json")):
            if g.name.startswith("_"):
                continue
            if g in after:
                raw = after[g][0]
                reason = pinned_reason(raw, loaded)
            else:
                try:
                    raw = json.loads(g.read_text())
                except ValueError:
                    continue
                reason = "it is not named on the command line"
            if isinstance(raw, dict):
                siblings.append(Sibling(g.name, raw, reason))
        renames, stuck = rename_colliding(siblings)
        unresolved += [f"{directory.name}: {u}" for u in stuck]
        for r in renames:
            moved[directory / r.name] = r

    # 3. say it, and write it
    for f in args.files:
        raw, done = after[f]
        r = moved.get(f)
        if r:
            raw, done = r.raw, done + [r.raw["notes"].rsplit(MARK + ": ", 1)[-1].rstrip(".").split(". The first six")[0]]
        print(f"{f.name}: " + ("; ".join(done) if done else "nothing to normalise"))
        if done and not args.dry_run:
            target = f.with_name(r.new_name) if r else f
            target.write_text(json.dumps(raw, indent=1, ensure_ascii=False) + "\n")
            if target != f:
                f.unlink()
    for u in unresolved:
        print(f"UNRESOLVED: {u}", file=sys.stderr)
    return 1 if unresolved else 0


if __name__ == "__main__":
    sys.exit(main())

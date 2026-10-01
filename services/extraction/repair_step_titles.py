"""Put back the maths the S0a adapter once dropped from worked-example STEP TITLES. Deterministic, no model.

    uv run repair_step_titles.py <book> plan  [--chapters 1,2,3] [--report OUT.json]     # the dry run: changes nothing
    uv run repair_step_titles.py <book> apply [--chapters 1,2,3] [--skip-refused]        # rewrites, with backups and a ledger
    uv run repair_step_titles.py <book> db    [--chapters 1,2,3] [--dsn "host=… dbname=…"]   # read-only: what the DB still shows

THE DEFECT. source_adapter.py read a step heading with `text_of(…, math_token=False)`, so every inline equation
in it vanished: "Extend DE to F so that EF = DE and join C to F" reached the lesson packet as "Extend to so that
and join" (Grade 10: 138 of 571 step titles, 209 equation images). The step TEXT kept its ⟦m:<md5>⟧ references;
only the titles lost them. The adapter now keeps them (`title` carries ⟦m:<md5>⟧, `title_maths` lists them), and
a lesson packet built from today's blocks.jsonl is right. What is NOT right is everything built from the old
blocks: lesson runs (the typed solutions are copied from the packet), their G2 splits, the assembled seed
bundles, and the database rows loaded from them. This tool repairs those in place, from the blocks alone.

WHAT IT DOES. A worked example's solution is a list of strings, one per step with text, "<title>: <text>" (the
text alone when the step has no title), then the loose solution (assemble_objectives.build_lesson_packet). For
every worked example that has a repaired title this tool computes both lists — the OLD one the damaged blocks
gave and the NEW one today's blocks give — and compares them with the artifact, position by position:

    * the artifact's string is the old one       → it is rewritten to the new one;
    * the artifact's string is already the new   → left alone (so a second run changes nothing);
    * it is neither, or the list has another length, or the worked example is not in blocks.jsonl exactly once,
      or a maths image the title needs is not in S0b's accepted map
                                                 → the item is REFUSED and nothing of it is written.

An item is matched by (chapter, worked-example number, step position), never by searching for the damaged words:
"Prove" and "Calculate" are titles of dozens of steps. The title is rendered exactly as the packet renders it
(`assemble_objectives._we`, S0b's LaTeX). For a bundle and the DB the bundle assembly's own transform is applied on
top (`assemble_lesson_bundle`: `normalise`, `unescape_entities`, `respace_latex`) to the WHOLE step string, as the
assembly does, so a title's `\\left({x}_{1};{y}_{1}\\right)` arrives as the assembly writes it, `{x}_{1}, {y}_{1}`.

WHERE IT LOOKS (relative to services/extraction, `--root` to move it):
    runs/<book>/lessons/*.json, lessons/recollected/*.json   the saved runs `lesson-runs` splits (so a re-split does not
                                                              bring the damage back)
    runs/<book>/lesson/*.json, lesson-draft/*.json           the G2-signed split assembly reads, and the draft G2 reads
    the book config's `bundles` and work/<book>/pilot/seed/  assembled bundles: questions[].solution and
                                                              explanation_entries[] worked_example steps
    plus `--path FILE` (any of the above kinds).
NOT touched: runs/<book>/records/ (the raw run wrappers, provenance), `superseded*` archives, work/<book>/packets/ (derived,
regenerated from blocks), generated content (S5/S6) and the S1 evidence quotes — those are reported, never rewritten.
A claim's `quote` (a run file's evidence, not shown to a student) is rewritten ONLY when it is exactly a damaged title
(with or without the trailing colon) of its own anchor's worked example, once; any other quote is left and listed.

SAFETY. A file is rewritten only after: its bytes are re-read and still hash to what the plan read (a file another
process changed meanwhile is skipped and reported, exit 3); the formatting of the original is reproduced exactly (a file
whose JSON style cannot be reproduced is refused, so a diff is only ever the repaired strings); a copy of the original goes to
work/<book>/backups/step-title-repair-<UTC>/; the write is atomic (temp file, os.replace); and the result is re-read and
re-planned (nothing left to repair, nothing else changed). `--skip-refused` repairs what is unambiguous and lists the rest;
without it any refusal stops `apply` before it writes a byte.

EXIT: 0 done / nothing to do · 1 something refused · 2 inputs missing or blocks.jsonl predates the extractor fix ·
3 a file changed while the tool was working (re-run; it is idempotent).

`--old-blocks FILE` (optional) names the pre-fix blocks.jsonl and makes the legacy titles exact; without it the legacy
title is the new one with its maths dropped and whitespace collapsed, which is exact for every step of Grade 10 but
the two "( )" titles of chapter 13 (Chapter 13 has no run yet). A copy of the pre-fix file is kept at
work/g10-math/backups/blocks.pre-step-title-fix.jsonl.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import assemble_objectives as AO  # noqa: E402  (the packet's own renderer; read, never changed)

TOKEN = AO.MATH_REF_RE            # ⟦m:<md5>⟧
WE_REF = re.compile(r"^WE(\d+)$")
EXIT_OK, EXIT_REFUSED, EXIT_INPUTS, EXIT_RACE = 0, 1, 2, 3


class RepairError(Exception):
    """An input the tool will not guess about (exit 2)."""


# ============================================================================ the book's worked examples
def legacy_title(title: str | None) -> str:
    """The title as the adapter used to extract it: the maths images dropped, whitespace collapsed."""
    return re.sub(r"\s+", " ", TOKEN.sub("", title or "")).strip()


@dataclass
class Step:
    index: int                    # position among the block's steps
    old_title: str                # rendered legacy title ('' when the step had none)
    new_title: str                # rendered title with its maths
    text: str                     # rendered step text (the heading is not part of it)

    @property
    def damaged(self) -> bool:
        return self.old_title != self.new_title


@dataclass
class WE:
    block: str
    chapter: int
    n: int
    steps: list[Step]
    loose: str
    missing: set = field(default_factory=set)       # md5s a title or step needs that S0b has not accepted

    def damaged_steps(self) -> list[Step]:
        return [s for s in self.steps if s.damaged]

    def lines(self, which: str) -> list[str]:
        """The worked example's solution list as build_lesson_packet writes it: `which` is 'old' or 'new'."""
        out = []
        for s in self.steps:
            if not s.text:
                continue
            title = s.old_title if which == "old" else s.new_title
            out.append(f"{title}: {s.text}" if title else s.text)
        if self.loose:
            out.append(self.loose)
        return out

    def positions(self) -> list[int | None]:
        """Solution position -> the step it came from (None for the loose solution)."""
        pos: list[int | None] = [s.index for s in self.steps if s.text]
        if self.loose:
            pos.append(None)
        return pos


@dataclass
class Index:
    by_key: dict                                     # (chapter, n) -> WE
    ambiguous: dict                                  # (chapter, n) -> [block ids]  (a worked example found more than once)
    problems: list                                   # reasons the whole index cannot be trusted (exit 2)
    damaged: Counter                                 # chapter -> damaged step titles in blocks
    refs: Counter                                    # chapter -> maths references in damaged titles

    def total_damaged(self) -> int:
        return sum(self.damaged.values())


def build_index(blocks: list[dict], maths: dict[str, str], old_blocks: dict[str, dict] | None = None) -> Index:
    """Every worked example of the book with its old and new step titles. `old_blocks` (id -> block of the PRE-fix
    blocks.jsonl), when given, supplies the exact legacy titles."""
    by_key: dict = {}
    seen: dict = defaultdict(list)
    problems: list[str] = []
    damaged: Counter = Counter()
    refs: Counter = Counter()
    for b in blocks:
        if b.get("type") != "worked_example":
            continue
        key = (b["chapter"], b.get("n"))
        seen[key].append(b["id"])
        missing: set[str] = set()
        w = AO._we(b, maths, missing)
        steps = []
        for i, (raw, rendered) in enumerate(zip(b.get("steps") or [], w["steps"])):
            if "title_maths" not in raw:
                problems.append(f"{b['id']}: step {i} has no `title_maths`: blocks.jsonl predates the extractor fix "
                                "(regenerate it with source_adapter.py)")
                continue
            title = raw.get("title")
            if TOKEN.findall(title or "") != list(raw["title_maths"]):
                problems.append(f"{b['id']}: step {i}: `title_maths` is not the maths references of its `title`")
            if old_blocks is not None and b["id"] in old_blocks:
                olds = (old_blocks[b["id"]].get("steps") or [])
                old = (olds[i].get("title") if i < len(olds) else None)
                old_title = AO.render(old, maths, None)
            else:
                old_title = AO.render(legacy_title(title), maths, None)
            steps.append(Step(i, old_title, rendered["title"], rendered["text"]))
        we = WE(b["id"], b["chapter"], b.get("n"), steps, w["loose_solution"], missing)
        by_key[key] = we
        for s in steps:
            if s.damaged:
                damaged[b["chapter"]] += 1
                refs[b["chapter"]] += len(TOKEN.findall(b["steps"][s.index].get("title") or ""))
    ambiguous = {k: ids for k, ids in seen.items() if len(ids) > 1 or k[1] is None}
    return Index(by_key, ambiguous, problems, damaged, refs)


# ============================================================================ the assembly's transform
class Assembler:
    """What the bundle assembly does to a solution step: `_norm` (normalise) per step, then `respace_tree` (HTML
    entities and S0b's glued LaTeX commands) over the whole bundle. Both are assemble_lesson_bundle's own functions.
    Needs node for the KaTeX command check, as the assembly does."""

    MODES = ("respaced", "normalised")      # a bundle assembled with --no-marker-check was never re-spaced

    def __init__(self):
        import assemble_lesson_bundle as alb
        self.alb = alb
        self.report = alb.Report()

    def prime(self, texts) -> None:
        self.alb.prime_known(texts)

    def __call__(self, s: str, mode: str) -> str:
        t = self.alb.normalise(s)[0]
        if mode == "normalised":
            return t
        return self.alb.respace_tree(t, self.report)


def candidate_lists(we: WE, assembler: Assembler | None) -> list[tuple[str, list[str], list[str]]]:
    """[(mode, old list, new list)] a document of this kind may hold. Run files hold the raw packet strings."""
    if assembler is None:
        return [("raw", we.lines("old"), we.lines("new"))]
    out = []
    for mode in assembler.MODES:
        out.append((mode, [assembler(s, mode) for s in we.lines("old")], [assembler(s, mode) for s in we.lines("new")]))
    return out


# ============================================================================ one solution list
@dataclass
class Verdict:
    kind: str                                 # repair | clean | refused
    rewrites: list = field(default_factory=list)    # (position, step index, old string, new string)
    already: int = 0                          # damaged positions already holding the new string
    reason: str = ""
    mode: str = ""                            # the assembly form it was judged under (bundles)


def modes_of(current: list[str], we: WE, assembler: Assembler | None) -> dict:
    """mode -> (rewrites, already) when the list is exactly the old/new text of the worked example under that assembly
    form, else the reason it is not. Pure."""
    pos = we.positions()
    out: dict = {}
    for mode, old, new in candidate_lists(we, assembler):
        if len(current) != len(old):
            out[mode] = f"{len(current)} step(s), the book's worked example gives {len(old)}"
            continue
        rewrites, already, bad = [], 0, None
        for j, (cur, o, n) in enumerate(zip(current, old, new)):
            if cur == n:
                already += o != n
            elif cur == o:
                rewrites.append((j, pos[j], o, n))
            else:
                bad = f"step {j + 1} is neither the old nor the repaired text: {cur[:70]!r}"
                break
        out[mode] = bad if bad else (rewrites, already)
    return out


def verdict_in(by_mode: dict, mode: str) -> Verdict:
    r = by_mode.get(mode)
    if r is None or isinstance(r, str):
        why = "; ".join(f"[{m}] {x}" for m, x in by_mode.items() if isinstance(x, str)) or f"no {mode} form"
        return Verdict("refused", reason=why, mode=mode)
    rewrites, already = r
    return Verdict("repair" if rewrites else "clean", rewrites, already, mode=mode)


def ok_modes(by_mode: dict) -> set:
    return {m for m, r in by_mode.items() if not isinstance(r, str)}


def judge(current: list[str], we: WE, assembler: Assembler | None) -> Verdict:
    """One list on its own (the DB scan): its only consistent form, else the assembly's default (re-spaced)."""
    if we.missing:
        return Verdict("refused", reason="maths image(s) not accepted by S0b: " + ", ".join(sorted(we.missing)[:4]))
    by_mode = modes_of(current, we, assembler)
    ok = ok_modes(by_mode)
    if not ok:
        return verdict_in(by_mode, next(iter(by_mode)))
    return verdict_in(by_mode, "respaced" if "respaced" in ok else sorted(ok)[0])


def judge_targets(targets: list, index: Index, assembler: Assembler | None, chapters: set | None) -> tuple[list, str]:
    """[(Target, Verdict)] for the worked-example lists of one file, and the assembly form inferred for it.

    A bundle is assembled once, in one form: with the app's KaTeX re-spacing (always, in production) or, for a test, without.
    The strings that tell the two apart (a step holding a glued macro such as \\triangleABC) decide it for the whole file;
    when nothing in the file tells them apart the assembly's default, re-spaced, is used and the file says so."""
    prelim = []
    for t in targets:
        if chapters is not None and t.chapter not in chapters:
            continue
        key = (t.chapter, t.n)
        if key in index.ambiguous:
            prelim.append((t, Verdict("refused", reason=f"worked example {key} is in blocks.jsonl more than once: "
                                      + ", ".join(index.ambiguous[key]))))
            continue
        we = index.by_key.get(key)
        if we is None:
            prelim.append((t, Verdict("refused", reason=f"chapter {t.chapter} has no worked example {t.n} in blocks.jsonl")))
            continue
        if not we.damaged_steps():
            continue                                                           # nothing to repair here
        if we.missing:
            prelim.append((t, Verdict("refused", reason="maths image(s) not accepted by S0b: "
                                      + ", ".join(sorted(we.missing)[:4]))))
            continue
        prelim.append((t, modes_of(t.strings, we, assembler)))
    file_modes = set(assembler.MODES) if assembler is not None else {"raw"}
    for _, x in prelim:
        if isinstance(x, dict) and ok_modes(x):
            file_modes &= ok_modes(x)
    if assembler is None:
        mode = "raw"
    elif file_modes:
        mode = "respaced" if "respaced" in file_modes else sorted(file_modes)[0]
    else:                                                       # the file's own strings disagree: judge each on its own
        mode = ""
    out = []
    for t, x in prelim:
        if isinstance(x, Verdict):
            out.append((t, x))
        elif mode:
            out.append((t, verdict_in(x, mode)))
        else:
            ok = ok_modes(x)
            out.append((t, verdict_in(x, sorted(ok)[0]) if len(ok) == 1 else
                        Verdict("refused", reason="the file's strings do not agree on one assembly form: " + "; ".join(
                            f"[{m}] {r}" for m, r in x.items() if isinstance(r, str)))))
    return out, mode


# ============================================================================ documents
@dataclass
class Target:
    where: str                                # e.g. g10m7s4-1:WE8 · q:g10m7s4-1-1:we08
    kind: str                                 # run_item | bundle_question | bundle_entry
    chapter: int
    n: int
    strings: list[str]
    put: Callable[[int, str], None]


def chapter_of_slug(slug: str, prefix: str) -> int | None:
    m = re.match(rf"^{re.escape(prefix)}(\d+)s", slug or "")
    return int(m.group(1)) if m else None


def run_lessons(doc) -> list[dict]:
    """The lesson records of a run document: a saved run ({lessons:[…]}, possibly under `result`) or a split file."""
    if not isinstance(doc, dict):
        return []
    d = doc["result"] if isinstance(doc.get("result"), dict) and "lessons" in doc["result"] else doc
    if isinstance(d.get("lessons"), list):
        return [l for l in d["lessons"] if isinstance(l, dict)]
    if isinstance(d.get("lesson"), str) and isinstance(d.get("items"), list):
        return [d]
    return []


def run_targets(doc, prefix: str) -> list[Target]:
    out = []
    for l in run_lessons(doc):
        slug = l.get("lesson")
        ch = chapter_of_slug(slug, prefix)
        for it in l.get("items") or []:
            m = WE_REF.match(str(it.get("ref") or ""))
            sol = it.get("solution")
            if not m or ch is None or not isinstance(sol, list) or not all(isinstance(s, str) for s in sol):
                continue
            out.append(Target(f"{slug}:{it['ref']}", "run_item", ch, int(m.group(1)), list(sol),
                              (lambda lst: lambda j, s: lst.__setitem__(j, s))(sol)))
    return out


_QID = re.compile(r"^q:([a-z0-9]+-\d+)-\d+:we(\d+)$")
_EID = re.compile(r"^expl:([a-z0-9]+-\d+)-\d+:we(\d+)$")


def bundle_targets(doc, prefix: str) -> list[Target]:
    out = []
    if not isinstance(doc, dict):
        return out
    for q in doc.get("questions") or []:
        m = _QID.match(str(q.get("id") or ""))
        sol = q.get("solution")
        if not m or not isinstance(sol, list) or not all(isinstance(s, str) for s in sol):
            continue
        ch = chapter_of_slug(m.group(1), prefix)
        if ch is not None:
            out.append(Target(q["id"], "bundle_question", ch, int(m.group(2)), list(sol),
                              (lambda lst: lambda j, s: lst.__setitem__(j, s))(sol)))
    for e in doc.get("explanation_entries") or []:
        m = _EID.match(str(e.get("id") or ""))
        if not m or e.get("entry_type") != "worked_example" or not isinstance(e.get("content"), list):
            continue
        steps = [c for c in e["content"] if isinstance(c, dict) and "step" in c and isinstance(c.get("text_md"), str)]
        if [c["step"] for c in steps] != list(range(1, len(steps) + 1)):
            continue
        ch = chapter_of_slug(m.group(1), prefix)
        if ch is not None:
            out.append(Target(e["id"], "bundle_entry", ch, int(m.group(2)), [c["text_md"] for c in steps],
                              (lambda items: lambda j, s: items[j].__setitem__("text_md", s))(steps)))
    return out


@dataclass
class QuotePlan:
    where: str
    old: str
    new: str
    put: Callable[[str], None]


def quote_plans(doc, prefix: str, index: Index, chapters: set | None) -> tuple[list[QuotePlan], list[dict]]:
    """Evidence quotes that are exactly a damaged title of their own anchor, once. Everything else that merely
    contains damaged words is not touched."""
    plans, left = [], []
    for l in run_lessons(doc):
        ch = chapter_of_slug(l.get("lesson"), prefix)
        if ch is None or (chapters is not None and ch not in chapters):
            continue
        for k, c in enumerate(l.get("claims") or []):
            m = WE_REF.match(str(c.get("anchor") or ""))
            q = c.get("quote")
            if not m or not isinstance(q, str) or (ch, int(m.group(1))) not in index.by_key:
                continue
            we = index.by_key[(ch, int(m.group(1)))]
            bare = re.sub(r"\s+", " ", q).strip()
            colon = bare.endswith(":")
            bare = bare[:-1].strip() if colon else bare
            hits = [s for s in we.damaged_steps() if s.old_title and s.old_title == bare]
            repaired = [s for s in we.damaged_steps() if s.new_title == bare]
            if repaired and not hits:
                continue                                                      # already repaired
            if len(hits) == 1 and not we.missing and not any(
                    s.old_title == bare for s in we.steps if not s.damaged):
                new = hits[0].new_title + (":" if colon else "")
                plans.append(QuotePlan(f"{l['lesson']}:claims[{k}]", q, new,
                                       (lambda cl: lambda s: cl.__setitem__("quote", s))(c)))
            elif hits:
                left.append({"where": f"{l['lesson']}:claims[{k}]", "quote": q,
                             "why": "the title is not unique in its worked example"})
    return plans, left


# ============================================================================ files
def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def detect_style(text: str, doc) -> dict | None:
    """The json.dumps arguments that reproduce `text` from `doc` byte for byte, or None."""
    for indent in (1, 2, None, 3, 4):
        for ensure_ascii in (False, True):
            for newline in ("\n", ""):
                kw: dict = {"ensure_ascii": ensure_ascii}
                if indent is not None:
                    kw["indent"] = indent
                if json.dumps(doc, **kw) + newline == text:
                    return {"kw": kw, "newline": newline}
    return None


def diff_paths(a, b, path=()) -> list[tuple]:
    """Paths at which two JSON values differ (leaves)."""
    if type(a) is not type(b):
        return [path]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append(path + (k,))
            else:
                out += diff_paths(a[k], b[k], path + (k,))
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [path]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out += diff_paths(x, y, path + (i,))
        return out
    return [] if a == b else [path]


@dataclass
class FilePlan:
    path: Path
    rel: str
    cls: str                                  # run | bundle
    sha: str
    items: list = field(default_factory=list)       # (Target, Verdict)
    quotes: list = field(default_factory=list)      # QuotePlan
    unrepaired_quotes: list = field(default_factory=list)
    style: dict | None = None
    mode: str = ""                                 # the assembly form a bundle was judged under

    def changes(self) -> int:
        return sum(len(v.rewrites) for _, v in self.items if v.kind == "repair") + len(self.quotes)

    def refused(self) -> list:
        return [(t, v) for t, v in self.items if v.kind == "refused"]


def plan_file(path: Path, root: Path, cls: str, index: Index, assembler: Assembler | None, prefix: str,
              chapters: set | None, text: str | None = None) -> FilePlan | None:
    raw = path.read_bytes() if text is None else text.encode("utf-8")
    try:
        txt = raw.decode("utf-8")
        doc = json.loads(txt)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    rel = str(path.relative_to(root)) if path.is_relative_to(root) else str(path)
    fp = FilePlan(path, rel, cls, sha256_bytes(raw))
    targets = run_targets(doc, prefix) if cls == "run" else bundle_targets(doc, prefix)
    fp.items, fp.mode = judge_targets(targets, index, assembler if cls == "bundle" else None, chapters)
    if cls == "run":
        fp.quotes, fp.unrepaired_quotes = quote_plans(doc, prefix, index, chapters)
    if fp.items or fp.quotes or fp.unrepaired_quotes:
        fp.style = detect_style(txt, doc)
    return fp if (fp.items or fp.quotes or fp.unrepaired_quotes) else None


def apply_plan(fp: FilePlan, root: Path, prefix: str, index: Index, assembler: Assembler | None,
               chapters: set | None, backup: Path) -> dict:
    """Re-read, re-plan on the fresh bytes, rewrite, verify. Returns a ledger entry; raises RepairError on a race."""
    raw = fp.path.read_bytes()
    if sha256_bytes(raw) != fp.sha:
        raise RepairError(f"{fp.rel} changed while the tool was working (re-run it; it is idempotent)")
    txt = raw.decode("utf-8")
    doc = json.loads(txt)
    before = copy.deepcopy(doc)
    targets = run_targets(doc, prefix) if fp.cls == "run" else bundle_targets(doc, prefix)
    n = 0
    for t, v in judge_targets(targets, index, assembler if fp.cls == "bundle" else None, chapters)[0]:
        if v.kind == "refused":
            continue                                                           # --skip-refused: left exactly as it is
        for j, _step, _old, new in v.rewrites:
            t.put(j, new)
            n += 1
    if fp.cls == "run":
        for qp in quote_plans(doc, prefix, index, chapters)[0]:
            qp.put(qp.new)
            n += 1
    if fp.style is None:
        raise RepairError(f"{fp.rel}: its JSON formatting cannot be reproduced, so a rewrite would not be a clean diff")
    out = json.dumps(doc, **fp.style["kw"]) + fp.style["newline"]
    changed = diff_paths(before, doc)
    if len(changed) != n:
        raise RepairError(f"{fp.rel}: {n} repairs planned but {len(changed)} values differ: not writing")
    backup_path = backup / fp.rel
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path.write_bytes(raw)
    if sha256_bytes(fp.path.read_bytes()) != fp.sha:                         # the last look before the swap
        raise RepairError(f"{fp.rel} changed while the tool was working (re-run it; it is idempotent)")
    tmp = fp.path.with_name(f".{fp.path.name}.{os.getpid()}.repair.tmp")
    tmp.write_text(out, encoding="utf-8")
    os.replace(tmp, fp.path)
    return {"file": fp.rel, "class": fp.cls, "strings_rewritten": n, "sha256_before": fp.sha,
            "sha256_after": sha256_bytes(out.encode("utf-8")), "backup": str(backup_path)}


# ============================================================================ the report
def change_rows(fp: FilePlan) -> list[dict]:
    rows = []
    for t, v in fp.items:
        for j, step, old, new in v.rewrites:
            rows.append({"where": t.where, "chapter": t.chapter, "solution_position": j, "step": step,
                         "old": old, "new": new})
    for qp in fp.quotes:
        rows.append({"where": qp.where, "quote": True, "old": qp.old, "new": qp.new})
    return rows


def summarise(plans: list[FilePlan], index: Index, chapters: set | None) -> dict:
    per: dict = defaultdict(lambda: Counter())
    for fp in plans:
        for t, v in fp.items:
            c = per[t.chapter]
            key = f"{fp.cls}:{'questions' if t.kind == 'bundle_question' else 'entries' if t.kind == 'bundle_entry' else 'items'}"
            if v.kind == "repair":
                c[f"{key}.strings_to_rewrite"] += len(v.rewrites)
                c[f"{key}.targets_to_repair"] += 1
            elif v.kind == "clean":
                c[f"{key}.already_repaired"] += v.already
            else:
                c[f"{key}.REFUSED"] += 1
        if fp.quotes:
            per[0]["claim_quotes_to_rewrite"] += len(fp.quotes)        # key 0: not tied to a chapter here
    return {str(k): dict(v) for k, v in sorted(per.items())}


def print_summary(plans: list[FilePlan], index: Index, chapters: set | None, verb: str) -> None:
    sel = sorted(c for c in index.damaged if chapters is None or c in chapters)
    print(f"damaged step titles in blocks.jsonl: {index.total_damaged()} "
          f"({sum(index.refs.values())} equation images); selected chapters: "
          + ", ".join(f"{c}:{index.damaged[c]}" for c in sel))
    per_file = [fp for fp in plans if fp.changes() or fp.refused()]
    by_cls: dict = defaultdict(lambda: Counter())
    for fp in plans:
        for t, v in fp.items:
            by_cls[(t.chapter, fp.cls)]["rewrite" if v.kind == "repair" else "ok" if v.kind == "clean" else "REFUSED"] += (
                len(v.rewrites) if v.kind == "repair" else v.already if v.kind == "clean" else 1)
        if fp.quotes:
            by_cls[(0, "quotes")]["rewrite"] += len(fp.quotes)
    print(f"\n{verb} — per chapter and kind (strings; REFUSED counts items):")
    for (ch, cls), c in sorted(by_cls.items()):
        label = "claim quotes" if cls == "quotes" else f"chapter {ch:>2} {cls:<6}"
        print(f"  {label}  rewrite {c['rewrite']:>4}   already repaired {c['ok']:>4}   REFUSED {c['REFUSED']:>3}")
    print(f"\nfiles with something to do: {sum(1 for fp in per_file if fp.changes())}; with a refusal: "
          f"{sum(1 for fp in per_file if fp.refused())}")


# ============================================================================ discovery
def discover(root: Path, book, extra: list[Path]) -> list[tuple[Path, str]]:
    name = book.book
    out: list[tuple[Path, str]] = []

    def add(globber, cls):
        for p in sorted(globber):
            if p.is_file() and p.suffix == ".json" and not p.name.startswith("."):
                out.append((p, cls))
    runs = root / "runs" / name
    add((runs / "lessons").glob("*.json"), "run")
    add((runs / "lessons" / "recollected").glob("*.json"), "run")
    add((runs / "lesson").glob("*.json"), "run")
    add((runs / "lesson-draft").glob("*.json"), "run")
    seen = set()
    for b in book.bundles or []:
        p = root.parent.parent / b if not Path(b).is_absolute() else Path(b)
        if p.is_file() and p not in seen:
            seen.add(p)
            out.append((p, "bundle"))
    pilot = root / "work" / name / "pilot" / "seed"
    add(pilot.glob("*-c*.json"), "bundle")
    for p in extra:
        out.append((p, "bundle" if "questions" in p.read_text(errors="ignore")[:200000] else "run"))
    done, uniq = set(), []
    for p, c in out:
        if p.resolve() not in done:
            done.add(p.resolve())
            uniq.append((p, c))
    return uniq


def load_inputs(args, root: Path):
    import book_config
    book = book_config.load_book(args.book)
    work = root / "work" / book.book
    blocks_path = Path(args.blocks) if args.blocks else work / "blocks.jsonl"
    if not blocks_path.exists():
        raise RepairError(f"no blocks at {blocks_path}: run `uv run source_adapter.py {book.book}` first")
    maths_path = Path(args.maths) if args.maths else next(
        (p for p in (root / "runs" / book.book / "maths" / "book" / "accepted.json",
                     root / "runs" / book.book / "maths" / "accepted.json") if p.exists()), None)
    if maths_path is None or not maths_path.exists():
        raise RepairError("no S0b accepted map (runs/<book>/maths/book/accepted.json): pass --maths")
    blocks = AO.load_blocks(blocks_path)
    maths = AO.load_maths(maths_path)
    old = None
    if args.old_blocks:
        old = {b["id"]: b for b in AO.load_blocks(Path(args.old_blocks))}
    index = build_index(blocks, maths, old)
    if index.problems:
        raise RepairError("blocks.jsonl cannot be trusted:\n  " + "\n  ".join(index.problems[:8]))
    return book, index, maths


# ============================================================================ commands
def parse_chapters(s: str | None) -> set | None:
    return {int(x) for x in s.split(",") if x.strip()} if s else None


def collect_plans(args, root: Path, book, index: Index, assembler: Assembler | None, chapters: set | None):
    prefix = book.id_prefixes[0]
    files = discover(root, book, [Path(p) for p in (args.path or [])])
    if assembler is not None:
        # one KaTeX round trip for every command the assembly's re-spacing will ask about
        texts = []
        for we in index.by_key.values():
            if we.damaged_steps() and (chapters is None or we.chapter in chapters):
                texts += we.lines("old") + we.lines("new")
        assembler.prime(assembler.alb.normalise(s)[0] for s in texts)
    plans = []
    for p, cls in files:
        fp = plan_file(p, root, cls, index, assembler if cls == "bundle" else None, prefix, chapters)
        if fp is not None:
            plans.append(fp)
    return plans


def make_assembler(args) -> Assembler | None:
    try:
        return Assembler()
    except Exception as e:                                         # noqa: BLE001
        raise RepairError(f"the assembly's own functions cannot be loaded: {e}") from e


def cmd_plan_apply(args) -> int:
    root = Path(args.root).resolve() if args.root else HERE
    try:
        book, index, maths = load_inputs(args, root)
        assembler = make_assembler(args)
    except RepairError as e:
        print(f"repair_step_titles: {e}", file=sys.stderr)
        return EXIT_INPUTS
    chapters = parse_chapters(args.chapters)
    try:
        plans = collect_plans(args, root, book, index, assembler, chapters)
    except Exception as e:                                         # noqa: BLE001  (e.g. node/KaTeX missing)
        print(f"repair_step_titles: {type(e).__name__}: {e}", file=sys.stderr)
        return EXIT_INPUTS
    print_summary(plans, index, chapters, "dry run" if args.cmd == "plan" else "plan")
    refused = [(fp, t, v) for fp in plans for t, v in fp.refused()]
    for fp, t, v in refused[:25]:
        print(f"  REFUSED {fp.rel} {t.where}: {v.reason}")
    unstyled = [fp for fp in plans if fp.changes() and fp.style is None]
    for fp in unstyled:
        print(f"  REFUSED {fp.rel}: its JSON formatting cannot be reproduced exactly")
    for fp in plans:
        for u in fp.unrepaired_quotes:
            print(f"  note {fp.rel} {u['where']}: quote left as it is ({u['why']})")
    report = {"book": book.book, "command": args.cmd, "chapters": sorted(chapters) if chapters else "all",
              "damaged_titles_in_blocks": dict(sorted(index.damaged.items())),
              "equation_images_in_damaged_titles": dict(sorted(index.refs.items())),
              "summary": summarise(plans, index, chapters),
              "files": [{"file": fp.rel, "class": fp.cls, "sha256": fp.sha, "changes": change_rows(fp),
                         "refused": [{"where": t.where, "reason": v.reason} for t, v in fp.refused()],
                         "quotes_left": fp.unrepaired_quotes, "style_ok": fp.style is not None}
                        for fp in plans if fp.changes() or fp.refused() or fp.unrepaired_quotes]}
    if args.report:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n")
        print(f"report → {args.report}")
    if args.cmd == "plan":
        return EXIT_REFUSED if (refused or unstyled) else EXIT_OK
    if (refused or unstyled) and not args.skip_refused:
        print("\nnothing written: some items are ambiguous or unstylable (--skip-refused repairs the rest)", file=sys.stderr)
        return EXIT_REFUSED
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backup = (Path(args.backup_dir) if args.backup_dir else root / "work" / book.book / "backups" / f"step-title-repair-{stamp}")
    ledger = {"book": book.book, "at": stamp, "tool": "repair_step_titles.py", "files": []}
    race = False
    for fp in plans:
        if not fp.changes() or fp.style is None:
            continue
        try:
            ledger["files"].append(apply_plan(fp, root, book.id_prefixes[0], index,
                                              assembler if fp.cls == "bundle" else None, chapters, backup))
        except RepairError as e:
            print(f"  SKIPPED {e}", file=sys.stderr)
            race = True
    if ledger["files"]:
        backup.mkdir(parents=True, exist_ok=True)
        (backup / "ledger.json").write_text(json.dumps(ledger, ensure_ascii=False, indent=1) + "\n")
        print(f"\nrewrote {len(ledger['files'])} file(s), {sum(f['strings_rewritten'] for f in ledger['files'])} string(s); "
              f"originals and ledger → {backup}")
    else:
        print("\nnothing to rewrite")
    # the proof: plan again, expect nothing left (apart from what was skipped)
    again = collect_plans(args, root, book, index, assembler, chapters)
    left = sum(fp.changes() for fp in again)
    print(f"re-plan after the write: {left} string(s) still to repair")
    if race:
        return EXIT_RACE
    return EXIT_REFUSED if (left or refused) else EXIT_OK


def cmd_db(args) -> int:
    root = Path(args.root).resolve() if args.root else HERE
    try:
        book, index, maths = load_inputs(args, root)
        assembler = make_assembler(args)
    except RepairError as e:
        print(f"repair_step_titles: {e}", file=sys.stderr)
        return EXIT_INPUTS
    import psycopg
    import load_seed
    dsn = args.dsn or load_seed.db_dsn()
    chapters = parse_chapters(args.chapters)
    prefix = book.id_prefixes[0]
    texts = []
    for we in index.by_key.values():
        if we.damaged_steps() and (chapters is None or we.chapter in chapters):
            texts += we.lines("old") + we.lines("new")
    assembler.prime(assembler.alb.normalise(s)[0] for s in texts)
    per: dict = defaultdict(Counter)
    refused = []
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SET TRANSACTION READ ONLY")
        print(f"target database: {load_seed.describe_dsn(dsn)} (read-only)")
        cur.execute("SELECT id, canonical_solution FROM questions WHERE id ~ %s", (rf"^q:{prefix}\d+s[0-9-]+-\d+:we\d+$",))
        qrows = cur.fetchall()
        cur.execute("SELECT id, content FROM explanation_library WHERE entry_type = 'worked_example' AND id ~ %s",
                    (rf"^expl:{prefix}\d+s[0-9-]+-\d+:we\d+$",))
        erows = cur.fetchall()
    docs = [{"questions": [{"id": i, "solution": [s.get("text_md", "") for s in (sol or [])]}]} for i, sol in qrows]
    docs += [{"explanation_entries": [{"id": i, "entry_type": "worked_example", "content": c}]} for i, c in erows]
    for d in docs:
        for t in bundle_targets(d, prefix):
            if chapters is not None and t.chapter not in chapters:
                continue
            we = index.by_key.get((t.chapter, t.n))
            if we is None or not we.damaged_steps():
                continue
            v = judge(t.strings, we, assembler)
            per[t.chapter][f"{'questions' if t.kind == 'bundle_question' else 'entries'}.{v.kind}"] += 1
            per[t.chapter]["damaged_strings_shown"] += len(v.rewrites)
            if v.kind == "refused":
                refused.append((t.where, v.reason))
    print("\nthe database, per chapter (worked examples that have a repaired title):")
    for ch in sorted(per):
        c = per[ch]
        print(f"  chapter {ch:>2}: damaged strings still shown {c['damaged_strings_shown']:>3}   "
              + "   ".join(f"{k} {v}" for k, v in sorted(c.items()) if k != "damaged_strings_shown"))
    for w, why in refused[:20]:
        print(f"  REFUSED {w}: {why}")
    return EXIT_REFUSED if refused else EXIT_OK


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("book", help="the book config name (books/<book>.json)")
    ap.add_argument("cmd", choices=("plan", "apply", "db"))
    ap.add_argument("--blocks")
    ap.add_argument("--old-blocks", help="the pre-fix blocks.jsonl (exact legacy titles; optional)")
    ap.add_argument("--maths", help="S0b's accepted map (default runs/<book>/maths/book/accepted.json)")
    ap.add_argument("--chapters", help="comma-separated chapter numbers (default: all)")
    ap.add_argument("--path", action="append", help="an extra run file or bundle to include")
    ap.add_argument("--root", help="the extraction directory to work in (default: this one)")
    ap.add_argument("--report", help="write the full list of changes as JSON")
    ap.add_argument("--skip-refused", action="store_true", help="apply: repair what is unambiguous, list the rest")
    ap.add_argument("--backup-dir")
    ap.add_argument("--dsn", help="db: the database (default: $AINEXT_DB_DSN, as load_seed.py)")
    a = ap.parse_args(argv)
    return cmd_db(a) if a.cmd == "db" else cmd_plan_apply(a)


if __name__ == "__main__":
    sys.exit(main())

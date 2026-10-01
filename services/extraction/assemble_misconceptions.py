#!/usr/bin/env python3
"""Assemble a book's misconception catalogue from S5 runs (B11, extraction-pipeline.md §3.8).

    uv run assemble_misconceptions.py runs/<book>/misconceptions/final-<runId>.json [more runs] \\
        --book <book> --out seed/generated/<book>/misconceptions.json \\
        [--bundle seed/generated/<book>/generated-questions.json] \\
        [--bundle seed/generated/<book>/widget-questions.json] [--check]

    uv run assemble_misconceptions.py <final run> --book <book> --out <catalogue> --catalogue-only   # pass 1 (below)

    uv run assemble_misconceptions.py --validate seed/generated/misconceptions.json [--book prep3-math-en]

INPUT: the return value of `runbook/misconceptions.workflow.js` with `stage: "final"`, saved by
the operating session. A draft run is refused: it was never verified, and S6/S7 have not attached
their distractors to it yet.

OUTPUT: the catalogue in exactly the shape `load_misconceptions.py` loads (`id`, `lo_id`, `label`,
`description`, `signal`, `kind`, `refutation`, `maps`, `aliases`), plus `provenance` per entry,
which the loader ignores and the export must keep (T422).

WHAT IT GUARANTEES, and refuses to write otherwise:
  * FAIL CLOSED, twice. The workflow keeps only CONFIRMED entries; this re-checks every entry's
    verdict and drops anything else, rather than trusting the file.
  * One error, one entry (FR-1115): no id twice, no objective in two runs, no two entries of one
    objective with the same label, and every alias names exactly one entry and no live id.
  * At most 4 entries per objective, `mc:<objective>:<slug>` ids, objectives the book owns, and
    a refutation of at least two steps on every entry (a label with nothing to teach is not an
    entry, FR-1112).
  * With --bundle: every distractor tag in the S6/S7 bundles resolves (FR-1112). A tag naming a
    dropped or unknown misconception is STRIPPED; a tag naming an alias is rewritten to its entry;
    a tag naming another objective's entry is stripped (FR-1106), except a widget diagnostic
    naming a transitive prerequisite's entry, which FR-1215 allows and --graph proves. An S6/S7
    item the verifier judged NOT to encode the (confirmed) entry it is tagged with is stripped
    where it can be identified exactly — a widget predicate by name, a generated option by its
    family or exact text — and is an error where it cannot: fix it at the family spec or widget
    template. A widget left with no diagnostic is an error, because it could mark an answer wrong
    and never say why (ADR-0009): S7 must re-author or drop it. Each bundle's own
    `misconceptions` list is rewritten to the verified entries it references, so
    `load_generated_questions.py` never creates an unverified row.
  * Any problem means NOTHING is written: not the catalogue, not a bundle.

TWO PASSES when S5 final refused an S6/S7 attachment of an entry it CONFIRMED (the Chapter 1 deadlock). The
bundles are generated FROM this catalogue (`generate_questions.py --catalogue`, `generate_widget_questions.py`
against the loaded catalogue), so they cannot exist when it is first assembled, yet the refusal above needs a
bundle to strip the attachment from. Pass 1, `--catalogue-only`, writes the catalogue and no bundle (it takes
no --bundle): every rule on the entries still refuses, and the attachments the verifier refused are printed as
DEFERRED. Pass 2, the same command with each --bundle, strips them — a generated option by its family and the
error it was tagged with (or its exact text), a widget predicate by its template and name (both read from the
attachment's `ref`, `<family>#<error or predicate>`) — and refuses, writing nothing, if any is not carried by a
bundle it was given. Without --catalogue-only the command is as strict as before: a refused attachment no
--bundle carries refuses. Pass 1 skips nothing a bundle could still carry out of the database: load
(load_misconceptions.py) only after pass 1, but load the BUNDLES only after pass 2.

`--s5-args OUT --stage draft|final` BUILDS the workflow's args from what the line has already
made, so no stage is hand-stitched: the objectives and book questions of the assembled bundles
(`--seed-dir`, the S9 output, with their canonical solutions), the book's evidence of error from
the lesson runs (`--lesson-runs`: caution claims, and every three-way disagreement as a
`resolve_disagreement` source), the book's own multiple-choice wrong options, and for the final
stage the S6/S7 distractors (`--distractors`, the files `generate_questions.py --s5-distractors`
and `generate_widget_questions.py --s5-distractors` write) and the draft run (`--draft`).

`--by-ref [DIR]` (with `--s5-args`) writes the packet by reference instead (packet_ref.py): every
objective's canonical solutions and evidence go to shard files the agents read, and the args keep
what the workflow's control flow needs (the objectives, the distractors, the draft, counts).

`--embed [FILE]` (with `--s5-args`) also writes a copy of misconceptions.workflow.js with the args
embedded (embed_workflow.py), run with scriptPath and no args: S5 final's args stay ~66 KB even by
reference, too big to type.

`--validate` checks an existing catalogue file with the same rules that apply to every catalogue
(ids unique, a refutation on every entry, kinds, aliases), without the S5-only ones (the id
format and the cap of 4 apply to new entries; the Prep-3 catalogue predates them). The Prep-3
single source is held to more than that by tests/test_misconception_catalogue.py.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import book_config  # noqa: E402

MC_RE = re.compile(r"^mc:([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$")
KINDS = ("book_distractor", "generated_distractor", "conceptual")
MAX_PER_OBJECTIVE = 4
LOADER_KEYS = ("id", "lo_id", "label", "description", "signal", "kind", "refutation", "maps", "aliases")


# ------------------------------------------------------------------ rules shared by every catalogue
def id_is_well_formed(mid: str, lo_id: str) -> bool:
    """`mc:<objective tail>:<slug>` where the tail is the entry's own objective (pipeline-handoff.md)."""
    m = MC_RE.match(mid or "")
    return bool(m) and f"lo:{m.group(1)}" == lo_id


def _norm(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (label or "").lower()).strip()


# FR-4308 / decision 15 in the catalogue: S5 writes in the APP's notation (its RULES), so a coordinate pair
# is "(x, y)" — never normalise this text with the bundle's book-notation normaliser, which would read
# "(-2,3)" as the decimal -2.3. What must not appear: a decimal comma OUTSIDE a pair ("9,60", "\\text{2,5}",
# "2{,}5") and a book-style pair "(x; y)". Checked fail-closed at assembly (the verifier does not judge notation).
# Inside brackets a comma separates things — a pair (-2,3), a set \{1,2,3\}, an interval [1,2] — so a
# "digit,digit" is a decimal comma only OUTSIDE every bracket (or written 2{,}5, which is always one).
_GROUP = re.compile(r"\\\{[^{}]*?\\\}|\([^()]*\)|\[[^\[\]]*\]")
_DECIMAL_COMMA = re.compile(r"(?<![0-9])[0-9]+,[0-9]+(?![0-9])")
_LATEX_DECIMAL_COMMA = re.compile(r"[0-9]\{,\}[0-9]")
_BOOK_PAIR = re.compile(r"\(\s*[-−]?\s*[0-9.,]+\s*;\s*[-−]?\s*[0-9.,]+\s*\)")


def notation_problems(text: str) -> list[str]:
    t = text or ""
    out = [f"book-style pair {m.group(0)!r}" for m in _BOOK_PAIR.finditer(t)]
    out += [f"decimal comma {m.group(0)!r}" for m in _LATEX_DECIMAL_COMMA.finditer(t)]
    rest = t
    for _ in range(6):                                    # innermost brackets first, a few levels deep
        rest, n = _GROUP.subn(" ", rest)
        if not n:
            break
    out += [f"decimal comma {m.group(0)!r}" for m in _DECIMAL_COMMA.finditer(rest)]
    return out


# What a student reads never carries the pipeline's own bookkeeping (consistency review 2026-09-27, A5): nine of
# the Chapter 8 pilot's 29 refutations did — "Take $q:g10m8s1-1-2:ex8-1-4$", shapes in the figures of three OTHER
# questions cited by id, "the worked example on page 310", and Samuel's G2 note and a G2 verdict presented as "the
# book's own review note" / "the trap the book itself flags … had to be corrected back". The S5 prompt forbids it
# (s5-v5); this refuses it, fail-closed, at assembly and at --validate, for every catalogue (the Prep-3 one has none).
# What it can see: an id or book reference, a page number, a numbered figure, and review-history phrasing (outside
# $…$). What it cannot see is a figure of another question described in words ("shape Z") — that is the prompt's
# and the verifier's job, and G4's.
_LEAK_ID = re.compile(r"\b(?:q|mc|lo|expl|tpl|wt):[a-z0-9]+(?:-[a-z0-9]+)+")   # q:g10m8s1-1-2…, not a ratio q:r
_LEAK_REF = re.compile(r"(?i)\bex\s?\d+[-:.]\d+(?:[-:.]\d+)?[a-z]?\b|\bWE\s?\d+\b")
_LEAK_PAGE = re.compile(r"(?i)\bp(?:ages?|p?\.)\s*\d+")
_LEAK_FIGURE = re.compile(r"(?i)\bfig(?:ure|\.)\s*\d")
_LEAK_REVIEW = re.compile(r"(?i)\breview(?:er)?(?:'s)?\s+notes?\b|\breviewers?\b|\breview history\b|\bat review\b"
                          r"|\bG[1-5]\b|\bSamuel\b|\bapproved correction|\bre-solve\b|\bblind solver\b"
                          r"|\bcorrected back\b|\btyping agent\b|\bpipeline\b")
_MATH_SPAN = re.compile(r"\$[^$]*\$")


def leak_problems(text: str) -> list[str]:
    """What in this student-facing text is the pipeline's bookkeeping rather than teaching ([] when none)."""
    t = text or ""
    out = [f"an internal id {m.group(0)!r} — describe the example in words" for m in _LEAK_ID.finditer(t)]
    out += [f"a book item reference {m.group(0)!r} — describe the example in words" for m in _LEAK_REF.finditer(t)]
    out += [f"a page number {m.group(0)!r}" for m in _LEAK_PAGE.finditer(t)]
    out += [f"a numbered figure {m.group(0)!r}" for m in _LEAK_FIGURE.finditer(t)]
    out += [f"review history {m.group(0)!r}" for m in _LEAK_REVIEW.finditer(_MATH_SPAN.sub(" ", t))]
    return out


def _student_texts(m: dict):
    for k in ("label", "description", "signal"):
        if isinstance(m.get(k), str):
            yield k, m[k]
    for st in m.get("refutation") or []:
        if isinstance(st, dict) and isinstance(st.get("text_md"), str):
            yield f"refutation step {st.get('step')}", st["text_md"]


def validate_catalogue(bundle: dict, *, new_ids: set[str] | None = None,
                       max_per_objective: int | None = None,
                       book: "book_config.Book | None" = None) -> list[str]:
    """Problems with a catalogue in the loader's shape; [] when it is sound.

    `new_ids`: ids that must follow the `mc:<objective>:<slug>` rule (all of them when None).
    A live id that predates the rule is never renamed, so it is exempt by being left out.
    """
    problems: list[str] = []
    entries = bundle.get("misconceptions")
    if not isinstance(entries, list):
        return ["the catalogue has no `misconceptions` list"]
    ids = [m.get("id") for m in entries]
    for mid, n in Counter(ids).items():
        if n > 1:
            problems.append(f"{mid}: appears {n} times (one error, one entry — FR-1115)")
    id_set = set(ids)
    alias_owner: dict[str, str] = {}
    per_lo: dict[str, list[dict]] = defaultdict(list)
    for m in entries:
        mid = m.get("id") or "<no id>"
        missing = [k for k in LOADER_KEYS if k not in m]
        if missing:
            problems.append(f"{mid}: missing {missing}")
            continue
        per_lo[m["lo_id"]].append(m)
        if (new_ids is None or mid in new_ids) and not id_is_well_formed(mid, m["lo_id"]):
            problems.append(f"{mid}: a new id must be mc:<objective>:<slug> on its own objective {m['lo_id']}")
        if book is not None and not book.owns_lo(m["lo_id"]):
            problems.append(f"{mid}: objective {m['lo_id']} is not one of book {book.book}'s")
        for k in ("label", "description"):
            if not isinstance(m[k], str) or not m[k].strip():
                problems.append(f"{mid}: empty {k}")
        if m["kind"] not in KINDS:
            problems.append(f"{mid}: unknown kind {m['kind']!r}")
        steps = m["refutation"]
        if not isinstance(steps, list) or len(steps) < 2:
            problems.append(f"{mid}: a refutation needs at least two steps (FR-1112, the house style)")
        else:
            if [s.get("step") for s in steps] != list(range(1, len(steps) + 1)):
                problems.append(f"{mid}: refutation steps are not numbered 1..{len(steps)}")
            if any(not isinstance(s.get("text_md"), str) or not s["text_md"].strip() for s in steps):
                problems.append(f"{mid}: a refutation step is empty")
        if book is None or (book.notation or {}).get("decimal", "point") == "point":
            for where, text in _student_texts(m):
                for bad in notation_problems(text):
                    problems.append(f"{mid}: {where}: {bad} (FR-4308: a decimal point and (x, y) pairs)")
        for where, text in _student_texts(m):
            for bad in leak_problems(text):
                problems.append(f"{mid}: {where}: {bad} (a student reads this: no ids, page numbers, "
                                f"figures they cannot see or review history — patch it as a pipeline normalisation)")
        for mp in m["maps"]:
            if not mp.get("question_id") or not isinstance(mp.get("choice_text"), str):
                problems.append(f"{mid}: a map needs question_id and choice_text: {mp}")
        if m["kind"] == "book_distractor" and not m["maps"]:
            problems.append(f"{mid}: kind book_distractor but it maps to no book choice")
        for a in m["aliases"]:
            if a in id_set:
                problems.append(f"{mid}: alias {a} is itself a live id — folding it would delete an entry")
            elif a in alias_owner and alias_owner[a] != mid:
                problems.append(f"alias {a} is claimed by both {alias_owner[a]} and {mid}")
            alias_owner[a] = mid
    for lo, ms in per_lo.items():
        labels = Counter(_norm(m["label"]) for m in ms)
        for lab, n in labels.items():
            if n > 1:
                problems.append(f"{lo}: {n} entries share the label {lab!r} (one error, one entry)")
        if max_per_objective is not None:
            fresh = [m for m in ms if new_ids is None or m["id"] in new_ids]
            if len(fresh) > max_per_objective:
                problems.append(f"{lo}: {len(fresh)} entries, more than {max_per_objective}")
    return problems


# ------------------------------------------------------------------ pipeline normalisations of an S5 run
# A student-facing text S5 wrote wrongly in a way that needs no new model call — an id where the example should be
# described in words, a page number, review history (consistency review 2026-09-27, A5) — is patched by the
# PIPELINE, never by hand-editing the catalogue. The patch sits beside the run it patches,
#     runs/<book>/misconceptions/<run stem>.normalisations.json
#     {"format": "ainext.s5-normalisations/1", "run": "<run file name>",
#      "patches": [{"id": "mc:…", "field": "refutation step 2" | "label" | "description" | "signal",
#                   "from": "<the run's exact text>", "to": "<the patched text>", "by": "…", "at": "…", "why": "…"}]}
# and is applied every time that run is assembled, so a re-assembly cannot lose it. Fail-closed: the entry must be
# a CONFIRMED entry of that run and `from` must be its text exactly (a re-run S5 writes other text, and its patches
# do not silently carry over); every patch names who made it and why, and is recorded on the entry
# (provenance.normalisations). The patched text is held to every catalogue rule like any other.
NORMALISATIONS_FORMAT = "ainext.s5-normalisations/1"
_FIELD_RE = re.compile(r"^(label|description|signal)$|^refutation step ([1-9][0-9]*)$")


def normalisations_path(run_path: Path) -> Path:
    return Path(run_path).with_name(Path(run_path).stem + ".normalisations.json")


def apply_normalisations(entries: dict[str, dict], doc: dict, run_name: str, source: str) -> list[str]:
    """Apply one sidecar's patches to this run's CONFIRMED entries (by id), in place; the problems ([] when all
    applied). Each applied patch is appended to the entry's `normalisations`."""
    problems: list[str] = []
    if doc.get("format") != NORMALISATIONS_FORMAT:
        return [f"{source}: format is {doc.get('format')!r}, not {NORMALISATIONS_FORMAT!r}"]
    if doc.get("run") != run_name:
        return [f"{source}: patches run {doc.get('run')!r}, not {run_name!r}"]
    for i, p in enumerate(doc.get("patches") or []):
        where = f"{source} patch {i + 1} ({p.get('id')}, {p.get('field')})"
        missing = [k for k in ("id", "field", "from", "to", "by", "why") if not (isinstance(p.get(k), str) and p[k].strip())]
        if missing:
            problems.append(f"{where}: missing {missing} — a patch names its text, who made it and why")
            continue
        e = entries.get(p["id"])
        if e is None:
            problems.append(f"{where}: {p['id']} is not a CONFIRMED entry of {run_name}")
            continue
        m = _FIELD_RE.match(p["field"])
        if not m:
            problems.append(f"{where}: field must be label, description, signal or 'refutation step N'")
            continue
        if m.group(1):
            holder, key = e, m.group(1)
        else:
            holder = next((s for s in e.get("refutation") or [] if s.get("step") == int(m.group(2))), None)
            key = "text_md"
            if holder is None:
                problems.append(f"{where}: the entry has no refutation step {m.group(2)}")
                continue
        if holder.get(key) != p["from"]:
            problems.append(f"{where}: `from` is not the run's text (a different S5 run? re-check the patch)")
            continue
        holder[key] = p["to"]
        e.setdefault("normalisations", []).append(
            {"field": p["field"], "from": p["from"], "to": p["to"], "by": p["by"], "at": p.get("at"),
             "why": p["why"], "file": Path(source).name})
    return problems


# ------------------------------------------------------------------ S5 runs → catalogue
def load_runs(paths: list[Path], book: str) -> tuple[list[dict], list[dict], list[dict], list[str]]:
    """(kept entries, dropped entries, stripped distractor records, problems).

    Drafts and other books' runs are refused.
    """
    kept: list[dict] = []
    dropped: list[dict] = []
    stripped: list[dict] = []
    problems: list[str] = []
    lo_run: dict[str, str] = {}
    for p in paths:
        run = json.loads(p.read_text())
        if run.get("stage") != "final":
            problems.append(f"{p.name}: stage is {run.get('stage')!r}, not 'final' — a draft is never loadable")
            continue
        if run.get("book") != book:
            problems.append(f"{p.name}: run is for book {run.get('book')!r}, not {book!r}")
            continue
        for r in run.get("records") or []:
            lo = r.get("lo")
            if lo in lo_run:
                problems.append(f"{lo}: in both {lo_run[lo]} and {p.name} — pass one run per objective")
                continue
            lo_run[lo] = p.name
            dropped += [{**d, "run": p.name} for d in r.get("dropped") or []]
            stripped += [{**d, "lo": d.get("lo") or lo, "run": p.name} for d in r.get("stripped") or []]
            for e in r.get("entries") or []:
                v = (e.get("verdict") or {}).get("verdict")
                if v != "CONFIRMED":
                    # Fail closed again: the file is not trusted to have filtered.
                    dropped.append({"id": e.get("id"), "lo_id": e.get("lo_id"), "label": e.get("label"),
                                    "aliases": e.get("aliases") or [], "verdict": v or "NO_VERDICT",
                                    "reason": "assembler: no CONFIRMED verdict on the entry", "run": p.name})
                    continue
                kept.append({**e, "_run": p.name})
        side = normalisations_path(p)
        if side.exists():
            # the patches write into copies: the saved run itself is never modified
            mine = {e["id"]: e for e in kept if e["_run"] == p.name}
            for eid, e in mine.items():
                e["refutation"] = [dict(s) for s in e.get("refutation") or []]
            problems += apply_normalisations(mine, json.loads(side.read_text()), p.name, str(side))
    return kept, dropped, stripped, problems


def to_loader_shape(e: dict) -> dict:
    return {
        "id": e["id"],
        "lo_id": e["lo_id"],
        "label": e["label"],
        "description": e["description"],
        "signal": e.get("signal") or None,
        "kind": e["kind"],
        "refutation": [{"step": s["step"], "text_md": s["text_md"]} for s in e["refutation"]],
        "maps": [{"question_id": m["question_id"], "choice_text": m["choice_text"]} for m in e.get("maps") or []],
        "aliases": list(e.get("aliases") or []),
        "provenance": {
            "run": e["_run"],
            "verdict": e["verdict"]["verdict"],
            "verifier_reason": e["verdict"].get("reason"),
            "sources": e.get("sources") or [],
            "covers": e.get("covers") or [],
            **({"normalisations": e["normalisations"]} if e.get("normalisations") else {}),
        },
    }


# ------------------------------------------------------------------ S6/S7 bundles
def _split_ref(ref: str | None) -> tuple[str | None, str | None]:
    """An S5 attachment's `ref` as the two generators write it: S6 `<family>#<tagged error or untagged>`, S7
    `<template>#<predicate name>` — (family, the part after the `#`). The fixtures' older bare `<family>` gives
    (family, None). Matching the whole string against a bundle's `family` never matched anything real."""
    fam, sep, tail = (ref or "").partition("#")
    return (fam or None), ((tail or None) if sep else None)


def _in_family(q: dict, ref: str | None) -> bool:
    fam, _ = _split_ref(ref)
    return bool(fam) and (q.get("family") == fam or fam in (q.get("source_note") or ""))


def prerequisites(bundle_paths: list[Path]) -> dict[str, set[str]]:
    """{objective: every transitive prerequisite of it}, from SeedBundles' prerequisite_of edges."""
    direct: dict[str, set[str]] = defaultdict(set)
    for p in bundle_paths:
        for e in json.loads(Path(p).read_text()).get("edges") or []:
            if e.get("type") == "prerequisite_of":
                direct[e["dst"]].add(e["src"])
    out: dict[str, set[str]] = {}
    for lo in list(direct):
        seen: set[str] = set()
        stack = [lo]
        while stack:
            for src in direct.get(stack.pop(), ()):
                if src not in seen:
                    seen.add(src)
                    stack.append(src)
        out[lo] = seen
    return out


def reconcile_bundle(bundle: dict, entries: dict[str, dict], alias_of: dict[str, str],
                     unfit: list[dict] = (), prereqs: dict[str, set[str]] | None = None
                     ) -> tuple[dict, list[str], list[str], set[int]]:
    """(bundle with every tag resolved, log lines, errors, indexes of `unfit` it applied). Pure.

    Every tag must name a verified entry, directly or through an alias, of the question's own
    objective (FR-1106) — or, for a widget diagnostic, of one of its transitive prerequisites
    (FR-1215), which needs `prereqs`; anything else is stripped. `unfit` are S6/S7 attachments
    the verifier judged NOT to encode the entry they are tagged with, although that entry itself
    was confirmed: they are stripped where they can be identified exactly (a widget predicate by
    name; a generated option by its family, or by its exact text).
    """
    log: list[str] = []
    errors: list[str] = []
    applied: set[int] = set()
    out = json.loads(json.dumps(bundle))
    referenced: set[str] = set()

    def resolve(qid: str, lo: str, mid: str | None, where: str, widget: bool = False) -> str | None:
        target = mid if mid in entries else alias_of.get(mid or "")
        if target is None:
            log.append(f"strip {qid} {where}: {mid} is not in the catalogue (dropped or never verified)")
            return None
        owner = entries[target]["lo_id"]
        if owner != lo and widget and prereqs is None:
            errors.append(f"{qid} {where}: names {target} of {owner}; a widget may name a prerequisite's "
                          f"misconception (FR-1215), but no --graph was passed to check that")
            return target
        if owner != lo and not (widget and owner in prereqs.get(lo, set())):
            rule = "FR-1215: not a prerequisite" if widget else "FR-1106"
            log.append(f"strip {qid} {where}: {target} belongs to {owner}, not {lo} ({rule})")
            return None
        if target != mid:
            log.append(f"rewrite {qid} {where}: alias {mid} -> {target}")
        return target

    def is_unfit(q: dict, target: str, *, predicate: str | None = None, text: str | None = None) -> bool:
        for i, u in enumerate(unfit):
            if u.get("lo") != q.get("lo_id"):
                continue
            ut = u.get("tagged")
            if (ut if ut in entries else alias_of.get(ut or "")) != target:
                continue
            if predicate is not None and u.get("origin") == "S7":
                # real S7 records: ref = `<template>#<predicate name>`, `text` is the predicate's MEANING (the
                # contract's sentence), so the name is matched through the ref and the family it names; the
                # fixtures' older records carry the name itself as `text`
                _, name = _split_ref(u.get("ref"))
                if (name is not None and name == predicate and _in_family(q, u.get("ref"))) or u.get("text") == predicate:
                    applied.add(i)
                    return True
            if text is not None and u.get("origin") == "S6" and (_in_family(q, u.get("ref")) or u.get("text") == text):
                applied.add(i)
                return True
        return False

    for q in out.get("questions") or []:
        qid, lo, ch = q.get("id"), q.get("lo_id"), q.get("choices")
        if isinstance(ch, list):
            for c in ch:
                mid = c.get("misconception_id")
                if not mid:
                    continue
                t = resolve(qid, lo, mid, f"option {c.get('key')}")
                if t is not None and is_unfit(q, t, text=c.get("text")):
                    log.append(f"strip {qid} option {c.get('key')}: the verifier judged it does not encode {t}")
                    t = None
                if t is None:
                    del c["misconception_id"]
                else:
                    c["misconception_id"] = t
                    referenced.add(t)
        elif isinstance(ch, dict) and isinstance(ch.get("diagnostics"), list):
            kept = []
            for d in ch["diagnostics"]:
                p = d.get("predicate")
                t = resolve(qid, lo, d.get("misconception_id"), f"predicate {p}", widget=True)
                if t is not None and is_unfit(q, t, predicate=p):
                    log.append(f"strip {qid} predicate {p}: the verifier judged it does not encode {t}")
                    t = None
                if t is not None:
                    kept.append({**d, "misconception_id": t})
                    referenced.add(t)
            ch["diagnostics"] = kept
            held = []
            for d in ch.get("pending_review") or []:   # decision 47: held mappings follow the catalogue too
                t = resolve(qid, lo, d.get("misconception_id"), f"held predicate {d.get('predicate')}", widget=True)
                if t is not None and is_unfit(q, t, predicate=d.get("predicate")):
                    log.append(f"drop held {qid} predicate {d.get('predicate')}: the verifier judged it does not encode {t}")
                elif t is not None:
                    held.append({**d, "misconception_id": t})
            if "pending_review" in ch:
                if held:
                    ch["pending_review"] = held
                else:
                    del ch["pending_review"]
            if not kept and not held:
                errors.append(f"{qid}: widget left with no diagnostic — it could mark an answer wrong and "
                              f"never say why (ADR-0009). S7 must re-author it or drop it")
    out["misconceptions"] = [
        {"id": m, "lo_id": entries[m]["lo_id"], "label": entries[m]["label"], "description": entries[m]["description"]}
        for m in sorted(referenced)
    ]
    return out, log, errors, applied


# ------------------------------------------------------------------ main
def assemble(run_paths: list[Path], book_name: str) -> tuple[dict, list[dict], list[dict], list[str]]:
    """(catalogue, dropped entries, unfit S6/S7 attachments of confirmed entries, problems)."""
    book = book_config.load_book(book_name)
    kept, dropped, stripped, problems = load_runs(run_paths, book.book)
    kept.sort(key=lambda e: (e["lo_id"], e["id"]))
    patched = sum(len(e.get("normalisations") or []) for e in kept)
    catalogue = {
        "catalogue": f"{book.book}-misconceptions",
        "course_id": book.course_id,
        "book": book.book,
        "reviewed": False,
        "generator": ("S5 runbook/misconceptions.workflow.js (Sonnet author, Sonnet fail-closed verifier) "
                      f"via assemble_misconceptions.py — runs {', '.join(sorted({e['_run'] for e in kept}))}; "
                      + (f"{patched} PIPELINE NORMALISATION(S) on {sum(1 for e in kept if e.get('normalisations'))} "
                         f"entries (provenance.normalisations says who and why); " if patched else "")
                      + "pipeline-generated, UNREVIEWED"),
        "misconceptions": [to_loader_shape(e) for e in kept],
    }
    problems += validate_catalogue(catalogue, new_ids=None, max_per_objective=MAX_PER_OBJECTIVE, book=book)
    ids = {m["id"] for m in catalogue["misconceptions"]}
    alias_of = {al: m["id"] for m in catalogue["misconceptions"] for al in m["aliases"]}
    # An attachment whose tag no longer resolves is stripped by id in any bundle. The ones that
    # still resolve (the entry was confirmed, this item was not) need stripping one by one.
    unfit = [s for s in stripped if s.get("origin") in ("S6", "S7")
             and (s.get("tagged") in ids or alias_of.get(s.get("tagged") or "") in ids)]
    return catalogue, dropped, unfit, problems


# a G2 fix that touched any of these replaced the book's answer, or the question the re-solve was shown (a stem
# fix): the disagreement was the book's (or ours), not a student's
ANSWER_FIELDS = {"answer", "marker", "answer_type", "printed_answer", "epub_final_answer", "solution", "stem"}
# a G2 fix that touched any of these changed the book's WORKING, so the canonical solution is no longer the book's
# own text (a fix of the answer alone re-types it — a fraction typed numeric, a choice key — and every Chapter 8
# fix of a wrong book answer also rewrote the solution lines that carried it)
CORRECTION_FIELDS = {"epub_final_answer", "solution"}


def _provenance(prov: str | None, corrected: bool) -> str | None:
    if not corrected:
        return prov
    return f"{prov or 'book'} — CORRECTED where the book has an error: not the book's own working"


def item_question_id(it: dict) -> str:
    """The question id the assembler mints for a lesson-run item (schemas' own minting)."""
    import schemas
    return (schemas.worked_example_question_id(it["lo"], int(it["ref"][2:])) if it["ref"].startswith("WE")
            else schemas.exercise_question_id(it["lo"], it["ref"]))


def figures_by_question(lesson_runs: list[dict]) -> dict[str, list[str]]:
    """Question id (and its worked-example entry id, expl:…) -> the figure image files the item's stem
    shows as [figure], from the lesson runs. S5, S6 and S7 hand them to agents that must SEE the diagram:
    the pilot's S5 draft stripped every figure-label option (points A–E, shapes W–Z) because its author
    was shown "[figure]" and could not open the image."""
    out: dict[str, list[str]] = {}
    for run in lesson_runs:
        for it in run.get("items") or []:
            figs = [f for f in it.get("figures") or [] if f]
            if figs:
                qid = item_question_id(it)
                out[qid] = figs
                out["expl:" + qid.removeprefix("q:")] = figs
    return out


def s5_args(book, bundles: list[dict], lesson_runs: list[dict], stage: str,
            distractors: list[dict] | None = None, draft: dict | None = None) -> dict:
    """The args of runbook/misconceptions.workflow.js, from the assembled bundles and lesson runs."""
    objectives, questions, dists = [], [], []
    figs = figures_by_question(lesson_runs)
    # A canonical solution G2 corrected is not the book's own working, and the packet says so — without the
    # reviewer's note (review history never reaches S5: consistency review 2026-09-27, A5). The pilot's S5 read
    # "solution: book_worked_epub" on a corrected solution and told students "the book goes on to show …".
    corrected: set[str] = set()
    for run in lesson_runs:
        for it in run.get("items") or []:
            g2 = it.get("g2") or {}
            if g2.get("verdict") == "fix" and set(g2.get("changed") or []) & CORRECTION_FIELDS:
                qid = item_question_id(it)
                corrected |= {qid, "expl:" + qid.removeprefix("q:")}
    for b in bundles:
        for n in b.get("nodes", []):
            if n["kind"] == "learning_objective" and book.owns_lo(n["id"]):
                objectives.append({"id": n["id"], "label": n["label"], "description": n.get("description"),
                                   "lesson": book_config.lesson_slug(n["id"]), "page": n.get("source_page")})
        for q in b.get("questions", []):
            kind = "worked_example" if (q.get("source_note") or "").startswith("Worked example") else "exercise"
            rec = {"id": q["id"], "lo": q["lo"], "kind": kind, "stem": q["stem"], "answer": q.get("answer"),
                   "canonical_solution": q["solution"],
                   "solution_provenance": _provenance(q.get("solution_provenance"), q["id"] in corrected),
                   "source_page": q.get("source_page")}
            opts = (q.get("choices") or {}).get("options") if isinstance(q.get("choices"), dict) else q.get("choices")
            if isinstance(opts, list):
                rec["choices"] = [{"key": c["key"], "text": c["text"]} for c in opts]
                dists += [{"lo": q["lo"], "origin": "book", "ref": q["id"], "question_id": q["id"],
                           "text": c["text"]} for c in opts if c["key"] != q.get("answer")]
            if figs.get(q["id"]):
                rec["figures"] = figs[q["id"]]
            questions.append(rec)
        # the book's teaching items (proofs, sketches, several-point answers: worked examples, not
        # question rows) are canonical solutions too — an objective taught only by them is not
        # "without a canonical solution" (the pilot skipped lo:g10m8s1-1-1 for that)
        for e in b.get("explanation_entries", []):
            if e.get("entry_type") != "worked_example" or not book.owns_lo(e.get("lo", "")):
                continue
            content = e.get("content") or []
            problem = next((c.get("text_md") for c in content if c.get("kind") == "problem"), "")
            steps = [c.get("text_md") for c in content if "step" in c]
            if not steps:
                continue
            rec = {"id": e["id"], "lo": e["lo"], "kind": "worked_example", "stem": problem, "answer": None,
                   "canonical_solution": steps,
                   "solution_provenance": _provenance("book (teaching item)", e["id"] in corrected),
                   "source_page": e.get("source_page")}
            if figs.get(e["id"]):
                rec["figures"] = figs[e["id"]]
            questions.append(rec)
    sources = []
    for run in lesson_runs:
        for c in run.get("claims") or []:
            if c.get("type") == "caution" and c.get("supported", True):
                sources.append({"lo": c["lo"], "kind": "caution", "ref": c["anchor"],
                                "page": c.get("printed_page"), "text": c["text"]})
        for it in run.get("items") or []:
            # A re-solve's wrong turn is evidence of a student error only where G2 kept the book's answer
            # (the re-solve was the odd one out). A disagreement G2 FIXED was the book's error or our
            # typing / part numbering, one it EXCLUDED is out of practice, and one with no verdict is not
            # settled: none of those says anything about students (the pilot's S5 draft flagged them all).
            g2 = it.get("g2") or {}
            book_answer_stood = g2.get("verdict") == "accept" or (
                g2.get("verdict") == "fix" and not set(g2.get("changed") or ["?"]) & ANSWER_FIELDS)
            # and the re-solve really took another turn: one of its pairs was judged different
            blind_differs = any(str(p.get("pair_id", "")).split("|")[-1].startswith("blind~") and p.get("verdict") == "different"
                                for p in (it.get("verify") or {}).get("pairs") or [])
            if it.get("verification") == "disputed" and it.get("blind_answer") and book_answer_stood and blind_differs:
                # the fact only — never the reviewer's note or the gate (A5: a G2 note reached a student as "the
                # book's own review note", and a kept answer as "the trap the book itself flags")
                sources.append({"lo": it["lo"], "kind": "resolve_disagreement", "ref": item_question_id(it),
                                "page": it.get("printed_page"),
                                "text": f"Our own independent re-solve (not the book) answered {it['blind_answer']}; "
                                        f"the book's answer is {it.get('printed_answer') or it.get('epub_final_answer') or '(none)'}."})
    args = {"book": book.book, "stage": stage, "language": book.language,
            "notation": book.notation or {"decimal": "point", "pair_separator": "comma"},
            "objectives": sorted(objectives, key=lambda o: o["id"]), "questions": questions,
            "sources": sources, "distractors": dists + list(distractors or [])}
    if stage == "final":
        if draft is None:
            raise SystemExit("--stage final needs --draft: the draft's ids are carried, never renamed")
        args["draft"] = draft
    return args


# ------------------------------------------------------------------ S5 packet by reference
# `--s5-args OUT --stage … --by-ref [DIR]` (packet_ref.py): each objective's canonical solutions and
# book evidence — the two big blocks misconceptions.workflow.js puts in its author AND verifier
# prompts — go to shard files, rendered as the workflow renders them (questionBlock, sourceBlock,
# re-implemented below; tests/test_packet_ref.py splices them back and compares):
#     o/<objective tail>.questions.txt    questionBlock(qs)   WHOLE: never clipped (inline clips at 14000)
#     o/<objective tail>.sources.txt      sourceBlock(srcs)   WHOLE (inline clips at 8000); none when the
#                                                             objective has no evidence
# Unclipped by reference (decision of 2026-09-26, Q2): the author and the verifier get every canonical
# solution and every piece of evidence; inline keeps today's clips byte for byte. The args keep what
# the script's control flow reads: the objectives, every distractor, the draft, and per objective the
# number of questions and evidence items. Neither agent is blind to these texts, and each reads only
# its own objective's shards.
def _js_clip_text(text: str, n: int, what: str, notes: list) -> str:
    from packet_ref import js_len, js_slice
    if js_len(text) <= n:
        return text
    notes.append(f"{what} truncated from {js_len(text)} to {n} characters")
    return js_slice(text, n) + "\n… [truncated]"


def _js_sol_text(q: dict) -> str:
    from packet_ref import js, js_or
    steps = js_or(q.get("canonical_solution"), q.get("solution"), [])
    return "\n".join(f"  {i}. {s if isinstance(s, str) else js(js_or(s.get('text_md'), s.get('text'), ''))}"
                     for i, s in enumerate(steps, start=1))


def _js_question_block(qs: list[dict], notes: list, clip: bool = True) -> str:
    from packet_ref import js, js_truthy
    out = []
    for q in qs:
        head = f"[{js(q.get('id'))}]"
        if js_truthy(q.get("kind")):
            head += f" ({js(q['kind'])})"
        if js_truthy(q.get("source_page")):
            head += f" p.{js(q['source_page'])}"
        if js_truthy(q.get("solution_provenance")):
            head += f" — solution: {js(q['solution_provenance'])}"
        lines = [head, f"  Q: {js(q.get('stem'))}"]
        if isinstance(q.get("figures"), list) and len(q["figures"]):
            lines.append("  Figure(s): " + ", ".join(js(f) for f in q["figures"]))
        ch = q.get("choices")
        if isinstance(ch, list) and len(ch):
            lines.append("  Options: " + "   ".join(f"{js(c.get('key'))}) {js(c.get('text'))}" for c in ch))
        if q.get("answer") is not None:
            lines.append(f"  Answer: {js(q.get('answer'))}")
        lines.append(f"  Canonical solution:\n{_js_sol_text(q)}")
        out.append("\n".join(lines))
    text = "\n\n".join(out)
    return _js_clip_text(text, 14000, "canonical solutions", notes) if clip else text


def _js_source_block(srcs: list[dict], notes: list, clip: bool = True) -> str:
    from packet_ref import js, js_truthy
    if not srcs:
        return "(none)"
    lines = []
    for x in srcs:
        page = f" p.{js(x['page'])}" if js_truthy(x.get("page")) else ""
        lines.append(f"[{js(x.get('kind'))} {js(x.get('ref'))}{page}] {js(x.get('text'))}")
    return _js_clip_text("\n".join(lines), 8000, "book evidence", notes) if clip else "\n".join(lines)


def s5_args_by_ref(args: dict, directory: Path) -> dict:
    """Compact S5 args: questions and sources to shards, one pair per objective."""
    import packet_ref
    shards = packet_ref.Shards(directory, f"S5 {args['stage']}")
    refs = {}
    for o in args["objectives"]:
        tail = o["id"].removeprefix("lo:")
        qs = [q for q in args["questions"] if q.get("lo") == o["id"]]
        srcs = [x for x in args["sources"] if x.get("lo") == o["id"]]
        if qs:
            shards.put(f"o/{tail}.questions.txt", _js_question_block(qs, [], clip=False))
        if srcs:
            shards.put(f"o/{tail}.sources.txt", _js_source_block(srcs, [], clip=False))
        refs[o["id"]] = {"questions": len(qs), "sources": len(srcs),
                         "figures": sum(len(q.get("figures") or []) for q in qs)}
    compact = {k: v for k, v in args.items() if k not in ("questions", "sources")}
    compact["by_ref"] = shards.finish({"book": args["book"], "s5_stage": args["stage"]})
    compact["counts"] = {"questions": len(args["questions"]), "sources": len(args["sources"])}
    compact["objective_refs"] = refs
    return compact


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("runs", nargs="*", type=Path, help="final S5 run outputs")
    ap.add_argument("--book", help="books/<book>.json name, or a path to a config")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--bundle", type=Path, action="append", default=[],
                    help="an S6/S7 bundle whose tags are reconciled in place (repeatable)")
    ap.add_argument("--graph", type=Path, action="append", default=[],
                    help="a SeedBundle of the book, for the prerequisite edges a widget's diagnostic "
                         "may lean on (FR-1215); repeatable")
    ap.add_argument("--catalogue-only", action="store_true",
                    help="the FIRST pass, before any S6/S7 bundle exists (they are generated from this catalogue): "
                         "write the catalogue only. Every rule on the entries still refuses; the S6/S7 attachments the "
                         "verifier judged not to encode a confirmed entry are listed as DEFERRED, to be stripped by the "
                         "bundle pass (the same run with --bundle), which refuses if it cannot. Takes no --bundle")
    ap.add_argument("--check", action="store_true", help="validate and report; write nothing")
    ap.add_argument("--validate", type=Path, help="validate an existing catalogue file and exit")
    ap.add_argument("--s5-args", type=Path, help="write misconceptions.workflow.js args here and exit")
    ap.add_argument("--stage", choices=["draft", "final"], help="with --s5-args")
    ap.add_argument("--seed-dir", type=Path, help="with --s5-args: the assembled bundles (default seed/<book>/)")
    ap.add_argument("--lesson-runs", type=Path, help="with --s5-args: runs/<book>/lesson/ (default)")
    ap.add_argument("--distractors", type=Path, action="append", default=[],
                    help="with --s5-args --stage final: S6/S7 distractor files (repeatable)")
    ap.add_argument("--draft", type=Path, help="with --s5-args --stage final: the draft run's return value")
    ap.add_argument("--by-ref", nargs="?", const="", default=None, metavar="DIR",
                    help="with --s5-args: packet by reference (packet_ref.py) — each objective's canonical "
                         "solutions and evidence to shard files in DIR (default work/<book>/packets/s5-<stage>/), "
                         "compact args naming them")
    ap.add_argument("--embed", nargs="?", const="", default=None, metavar="FILE",
                    help="with --s5-args: also write a copy of misconceptions.workflow.js with these args embedded "
                         "(embed_workflow.py; default work/<book>/packets/embedded/misconceptions.s5-<stage>.workflow.js), "
                         "to run with scriptPath and no args — for args too big to type (S5 final)")
    a = ap.parse_args(argv)

    if a.s5_args:
        if not a.book or not a.stage:
            ap.error("--s5-args needs --book and --stage")
        book = book_config.load_book(a.book)
        seed_dir = a.seed_dir or HERE / "seed" / book.book
        runs_dir = a.lesson_runs or HERE / "runs" / book.book / "lesson"
        bundles = [json.loads(p.read_text()) for p in sorted(seed_dir.glob("*.json"))]
        runs = [json.loads(p.read_text()) for p in sorted(runs_dir.glob("*.json"))]
        ds = [d for f in a.distractors for d in json.loads(f.read_text()).get("distractors", [])]
        draft = json.loads(a.draft.read_text()) if a.draft else None
        args = s5_args(book, bundles, runs, a.stage, ds, draft)
        if not args["objectives"]:
            print(f"no objectives of {book.book} in {seed_dir}: assemble the bundles first", file=sys.stderr)
            return 1
        summary = (f"stage {a.stage}: {len(args['objectives'])} objective(s), {len(args['questions'])} book "
                   f"question(s), {len(args['sources'])} source(s), {len(args['distractors'])} distractor(s)")
        if a.by_ref is not None:
            import packet_ref
            d = Path(a.by_ref) if a.by_ref else packet_ref.default_dir(book.book, "s5", a.stage)
            args = s5_args_by_ref(args, d)
            summary += (f"; {args['by_ref']['files']} shard(s) in {args['by_ref']['dir']}; "
                        + packet_ref.report(args, "by ref"))
        a.s5_args.parent.mkdir(parents=True, exist_ok=True)
        import packet_ref
        a.s5_args.write_text((packet_ref.dumps(args) if "by_ref" in args   # by ref: one line, to paste
                              else json.dumps(args, indent=1, ensure_ascii=False)) + "\n")
        print(f"wrote {a.s5_args} — {summary}")
        if a.embed is not None:
            import embed_workflow
            out = Path(a.embed) if a.embed else embed_workflow.default_out(book.book, "misconceptions", f"s5-{a.stage}")
            print(embed_workflow.summary(embed_workflow.write(HERE / "runbook" / "misconceptions.workflow.js", args, out)))
        return 0

    if a.validate:
        bundle = json.loads(a.validate.read_text())
        book = book_config.load_book(a.book) if a.book else None
        # An existing catalogue predates the id rule; its live ids are never renamed.
        problems = validate_catalogue(bundle, new_ids=set(), book=book)
        for p in problems:
            print(f"  x {p}", file=sys.stderr)
        print(f"{a.validate}: {len(bundle.get('misconceptions') or [])} entries, "
              f"{'OK' if not problems else f'{len(problems)} problem(s)'}")
        return 1 if problems else 0

    if not a.runs or not a.book or (not a.out and not a.check):
        ap.error("pass run files, --book and --out (or --check)")

    if a.catalogue_only and a.bundle:
        ap.error("--catalogue-only is the pass BEFORE the bundles exist; the bundle pass is this command with "
                 "--bundle and without --catalogue-only")
    catalogue, dropped, unfit, problems = assemble(a.runs, a.book)
    entries = {m["id"]: m for m in catalogue["misconceptions"]}
    alias_of = {al: m["id"] for m in catalogue["misconceptions"] for al in m["aliases"]}
    reconciled: list[tuple[Path, dict]] = []
    applied: set[int] = set()
    prereqs = prerequisites(a.graph) if a.graph else None
    for bp in a.bundle:
        new, lines, errs, hit = reconcile_bundle(json.loads(bp.read_text()), entries, alias_of, unfit, prereqs)
        problems += [f"{bp.name}: {e}" for e in errs]
        applied |= hit
        reconciled.append((bp, new))
        for line in lines:
            print(f"  {bp.name}: {line}")
    deferred = []
    for i, u in enumerate(unfit):
        if i in applied:
            continue
        if a.catalogue_only:
            deferred.append(u)       # no bundle exists yet: the bundle pass strips it or refuses (below)
            continue
        problems.append(
            f"{u['lo']}: {u['origin']} {u.get('ref')} {u.get('text')!r} was judged not to encode "
            f"{u.get('tagged')} ({u.get('reason')}), and no bundle passed with --bundle carries it. Pass the "
            f"bundle that carries it (the bundles are generated from this catalogue, so the first pass is "
            f"--catalogue-only), or remove the tag at its "
            f"{'family spec' if u['origin'] == 'S6' else 'widget template'} and re-instantiate.")

    by_kind = Counter(m["kind"] for m in catalogue["misconceptions"])
    n_lo = len({m["lo_id"] for m in entries.values()})
    print(f"{catalogue['book']}: {len(entries)} misconceptions on {n_lo} objectives "
          f"{dict(sorted(by_kind.items()))}; {sum(len(m['maps']) for m in entries.values())} book maps; "
          f"{len(dropped)} dropped")
    for d in dropped:
        print(f"  dropped {d.get('id')} ({d.get('verdict')}): {d.get('reason')}")
    for u in deferred:
        print(f"  deferred to the bundle pass: {u['lo']} {u['origin']} {u.get('ref')} — judged not to encode "
              f"{u.get('tagged')}")
    if problems:
        for p in problems:
            print(f"  x {p}", file=sys.stderr)
        print(f"REFUSING: {len(problems)} problem(s); nothing written.", file=sys.stderr)
        return 1
    if a.check:
        print("check only: nothing written")
        return 0
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(catalogue, indent=2, ensure_ascii=False) + "\n")
    for bp, new in reconciled:
        bp.write_text(json.dumps(new, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {a.out}" + (f" and reconciled {len(reconciled)} bundle(s)" if reconciled else "")
          + (f"; CATALOGUE ONLY — {len(deferred)} S6/S7 attachment(s) the verifier refused are still to be stripped "
             f"by the bundle pass (rerun with --bundle for each bundle written from this catalogue)" if a.catalogue_only
             else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

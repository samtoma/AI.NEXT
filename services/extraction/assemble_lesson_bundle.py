"""S9 Assemble: run outputs -> one SeedBundle per chapter (extraction-pipeline.md §3.12, B8).

    uv run assemble_lesson_bundle.py --book g10-math                    # every chapter
    uv run assemble_lesson_bundle.py --book g10-math --chapter 8        # the pilot chapter
    uv run assemble_lesson_bundle.py --book g10-math --check            # assemble + validate, write nothing
    uv run assemble_lesson_bundle.py --book <path/to/config.json> --manifest … --objectives … \\
        --runs … --out …                                                # any input or output moved

WHAT IT READS (every path from the book config unless overridden):

    manifest      books/<book>.json `manifest` — the S0 manifest WITH G0 APPLIED (T402/T403,
                  build_manifest.py). Per lesson: `id` (the slug), `title`, `order_in_module`,
                  and its `book_provenance` {sections: [{number, title}], part {n, of} | null,
                  chapter_intro}. (The scouting draft's single `section` + `title` is read as
                  one section, no part, no introduction.)
    objectives    objectives/<book>/<slug>.json — S1 after gate G1 (B5, WP-P2):
                  {lesson, objectives: [{id, label, statement, evidence: [...],
                   exercise_items: [...]}], prerequisites: [{src, dst}]}
    runs          runs/<book>/lesson/<slug>.json — S2–S4 after gate G2 (B6, WP-P3):
                  {lesson, claims: [...], items: [...], visuals: [...], viz_gaps: [...],
                   teacher_only: {seen, dropped, reached_claim}}
                  Item, visual and claim shapes: the RunItem / RunVisual / RunClaim models below.

WHAT IT WRITES (`--out`, default seed/<book>/):

    <prefix>-course.json   the program node, the course node and `course part_of program`
                           (ADR-0024). Every chapter bundle names the course in
                           external_node_refs, so this bundle loads first.
    <prefix>-cNN.json      one SeedBundle per chapter: its module, objectives, the book's own
                           prerequisite edges (S1's links, approved at G1), book questions,
                           visuals, the non-markable items as worked-example library entries,
                           and every lesson's book provenance (`lessons`, FR-4311), plus
                           `claims` and `assembled_from`.
    ../content/<slug>.json one lesson-content file per lesson (`--content-out`, default the
                           bundles' sibling `content/`, i.e. seed/content/): the HOME OF S2's
                           CLAIMS, where the lesson surfaces read a lesson's content
                           (app/src/lib/lesson-content.ts, the Social and Arabic shape). Its
                           `claims` are the grounded statements, each with its anchor, printed
                           page and provenance; `subtopics` groups them per objective (the
                           exposition is the claims' own words in book order, nothing added).
                           The bundle keeps `claims` too, as the checkable record.

IDS (specs/003 contracts/pipeline-handoff.md) are MINTED here, through the helpers in
schemas.py, and nowhere else:
    question     q:<lo tail>:we03 | q:<lo tail>:ex8-2-5b
    worked ex.   expl:<lo tail>:we03 | expl:<lo tail>:ex8-2-5b   (a not-markable item: teaching
                 material, not a question row, FR-4303)
    visual       v:<slug>:001
An id is a function of the item's place in the book and its objective, so re-assembling the
same inputs gives the same ids (FR-4404).

ANSWER TYPES (FR-4303, FR-4320): numeric -> `numeric`; choice -> `mcq`; expression -> `short`
with `choices: {"marker": {...}}` (contracts/answer-marker.md) and the printed answer as the
text answer; not_markable -> a worked-example library entry, never a question row.

THE APP'S MARKER CHECKS EVERY SPEC (marker_check.mjs: the app's own `readMarkerSpec` and
`validateKey`, answer-marker.ts). A spec the app would reject refuses the assembly: it would be a
server error the first time a student answered. A key the marker cannot read, or that does not
mark itself correct, HOLDS its question (verified false, so it loads at review and G2 sees it):
no student can ever be marked right against it. `--no-marker-check` skips this and says so in the
report; nothing the line ships should use it.

MARKER KEYS ARE BARE MATHS (2026-10-01): a key the typing agent copied as the EPUB wrote the final, `$(a-3)(a+3)$`, has its one enclosing
`$…$` pair removed (`unwrap_math_delimiters`; the report's `marker_keys_unwrapped` lists each, before → after): the app's marker refuses the
"$", which held 25 of Chapter 1's correct questions as "unanswerable" for a delimiter. A "$" inside the key leaves it alone.

NOTATION (decision 15, FR-4308): a decimal comma becomes a point and `(x; y)` becomes
`(x, y)` — likewise intervals `[a; b)` and sets `\\{a; b\\}` — in stems, choices, answers,
marker keys, solutions, captions, claims and worked-example entries. Words and contexts (the
Rand, "gradient") stay as printed. A bracket whose content reads as prose is left alone.
An aligned derivation `\\begin{align*}…\\end{align*}` inside `$…$` becomes `\\begin{aligned}…
\\end{aligned}`: the app renders every `$…$` inline, and KaTeX draws align* only in display mode —
inline it shows a red parse error with the raw source (the Chapter 8 pilot's "&amp;": KaTeX's error
text, HTML-escaped). The coverage audit counts any align left in a bundle as residual.

MULTI-PART EXERCISES (multipart.py, 2026-10-01): the book prints a question once and its parts beneath it, and the
line serves every part on its own — so a part can name a point or a value only an earlier part gives (Ex8-6:39d "Prove
that ST ∥ PR", S and T being part (b)'s). Over the WHOLE chapter's items (a question's parts are spread across
lessons) each such part's stem carries the sentence that makes it answerable: R1 the names an earlier part introduces,
R2 the preamble's unknowns an earlier marked part works out, R3 the gradients its worked answer uses without working
out — all in the book's words and G2's keys, never solved or invented. Every changed stem is in the report
(`stem_carry.carried`, before → after) and what the rule cannot settle in `stem_carry.unresolved` (the review backlog).
A stem changed under a human G2 stamp gets the stem-fix review note in `apply_review_verdicts.py --g2`.

PART PREREQUISITES (FR-4317) are DERIVED — every objective of part n-1 before every objective
of part n — and checked for cycles together with the book's own edges. They are never written
into `edges`: the book's edges stay exactly the book's (migration 034, data-model.md §2).

VALIDATION: every bundle through the real `schemas.SeedBundle` (referential integrity, the DAG,
lesson provenance, marker specs), then the book-level rules no single bundle can see: slugs
unique, a section's parts consecutive and numbered 1..m, no section claimed by two lessons, and
the prerequisite graph (book ∪ derived, across chapters) acyclic. Any failure writes nothing.

TWO EXTRA KEYS that `SeedBundle` does not model and the loader does not read: `claims` (S2's
grounded statements, the record; they are SERVED from the lesson-content files) and
`assembled_from` (the sha256 of every input, so a bundle is a checkable replay of committed run
outputs, QA point 16). The
solution's source is also written into `source_note` in the fixed form
    "<where in the book> · p.<page> · solution: <provenance>"
which `lib/provenance.ts` can parse (FR-4310).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

import book_config
import multipart
import schemas
from schemas import Lesson

HERE = Path(__file__).resolve().parent
EXTRACTOR = "extraction line v2 (assemble_lesson_bundle.py)"
EXTRACTOR_VERSION = "b8-1"

AnswerType = Literal["numeric", "choice", "expression", "not_markable"]
ITEM_REF = r"^(WE\d{1,3}|Ex\d{1,2}-\d{1,2}:\d{1,3}[a-z]{0,3}(?:-[ivx]+)?)$"
SOLUTION_NOTE_RE = re.compile(
    r" · solution: (book_worked|book_worked_epub|teachers_guide|answer_anchored)$")


# =============================================================================
# Notation (decision 15)
# =============================================================================

_DEC_COMMA = re.compile(r"(?<=\d),(?=\d)")            # 3,317  -> 3.317
_DEC_LATEX = re.compile(r"(?<=\d)\{,\}(?=\d)")         # 3{,}317 -> 3.317  (LaTeX from S0b)
_LATEX_CMD = re.compile(r"\\[A-Za-z]+")
_WORD = re.compile(r"[A-Za-z]{3,}")

# What a residual decimal comma looks like; the coverage audit counts these (and
# `;`-separated bracket groups, via semicolon_groups) in the assembled bundles and
# requires 0.
RESIDUAL_DECIMAL = re.compile(r"\d(?:,|\{,\})\d")
# display-only environments KaTeX refuses inside the app's inline `$…$` (align, align*, eqnarray…)
DISPLAY_ENV = re.compile(r"\\(begin|end)\{(align\*?|eqnarray\*?|gather\*?|multline\*?)\}")
_ALIGN_ENV = re.compile(r"\\(begin|end)\{(align|gather)\*?\}")
_INLINE_ENV = {"align": "aligned", "gather": "gathered"}      # KaTeX draws align*/gather* only in display mode; aligned/gathered inline


def _mathy(inner: str) -> bool:
    """A bracket group reads as maths, not as a parenthetical sentence."""
    return not _WORD.search(_LATEX_CMD.sub(" ", inner))


def semicolon_groups(text: str) -> list[tuple[int, int, list[int]]]:
    r"""Bracket groups with `;` at their own top level: (open, close, [positions of `;`]).

    A small scanner rather than a regex, because the components of a pair are often
    fractions — `\left(\frac{x_1 + x_2}{2}; \frac{y_1 + y_2}{2}\right)` — whose braces a
    regex cannot balance. `(` and `[` open a group and `)` or `]` close it, in any
    combination, because an interval is a pair too: `[2; 5)`. `\{ … \}` is a set. A
    LaTeX group `{ … }` is transparent: its `;` belongs to it, not to the enclosing
    bracket. Anything unbalanced is left alone.
    """
    out: list[tuple[int, int, list[int]]] = []
    stack: list[tuple[str, int, list[int]]] = []     # (kind, open index, semicolons)
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if text.startswith("\\{", i) or text.startswith("\\}", i):
            if ch == "\\" and text[i + 1] == "{":
                stack.append(("set", i, []))
            else:
                while stack and stack[-1][0] == "group":
                    stack.pop()
                if stack and stack[-1][0] == "set":
                    kind, o, semis = stack.pop()
                    if semis:
                        out.append((o, i + 1, semis))
            i += 2
            continue
        if ch == "\\":                       # any other command: skip its name
            j = i + 1
            while j < n and text[j].isalpha():
                j += 1
            i = max(j, i + 2) if j == i + 1 else j
            continue
        if ch == "{":
            stack.append(("group", i, []))
        elif ch == "}":
            if stack and stack[-1][0] == "group":
                stack.pop()
        elif ch in "([":
            stack.append(("bracket", i, []))
        elif ch in ")]":
            if stack and stack[-1][0] == "bracket":
                kind, o, semis = stack.pop()
                if semis:
                    out.append((o, i, semis))
        elif ch == ";" and stack and stack[-1][0] in ("bracket", "set"):
            stack[-1][2].append(i)
        i += 1
    return [(o, c, semis) for o, c, semis in out if _mathy(text[o + 1:c])]


# A4 (consistency review 2026-09-27): in this book "(7,5)" is a bracketed DECIMAL (7.5) — "(7,5)^2", "(2,5)-(-3,5)"
# — and a pair is written with ";". A whole side of an equation that is "(a,b)" with whole a, b, whose other side is
# a ";"-pair, is provably a pair (Ex8-6:46c: "(-1,4) &= (\frac{x_A+0}{2}; …)"): it is written as one. Any other
# "(a,b)" that is a whole side of an equation is ambiguous and is LISTED for G2 (counted as pair_ambiguous), read
# as the book's decimal meanwhile; one inside arithmetic is the book's decimal.
_INT_PAIR = re.compile(r"^(\\left)?\(\s*([-−]?\d+)\s*,\s*([-−]?\d+)\s*(\\right)?\)$")


_ENV_EDGE = re.compile(r"\\(begin|end)\{[A-Za-z*]+\}")


def _side(t: str) -> str:
    return _ENV_EDGE.sub("", t).strip().strip("$").strip("&").strip()


def _is_semicolon_pair(t: str) -> bool:
    """`t` is one bracket group with ';' at its top level and nothing else: a point, written the book's way."""
    return any(t[:o] in ("", "\\left") and c == len(t) - 1 for o, c, _ in semicolon_groups(t))


def _pair_commas(text: str, counts: Counter) -> str:
    rows = re.split(r"(\\\\)", text)
    for i, row in enumerate(rows):
        if row == "\\\\" or row.count("=") != 1:
            continue
        left, right = row.split("=", 1)
        for side, other in ((left, right), (right, left)):
            m = _INT_PAIR.match(_side(side))
            if not m:
                continue
            if _is_semicolon_pair(_side(other)):
                row = row.replace(m.group(0), m.group(0).replace(",", ", ", 1), 1)
                counts["pair_by_context"] += 1
            else:
                counts["pair_ambiguous"] += 1
        rows[i] = row
    return "".join(rows)


def normalise(text: str | None) -> tuple[str | None, Counter]:
    """(normalised text, Counter of what changed: decimal, pair, pair_by_context; pair_ambiguous is listed)."""
    counts: Counter = Counter()
    if not text:
        return text, counts
    text, n0 = _ALIGN_ENV.subn(lambda m: f"\\{m.group(1)}{{{_INLINE_ENV[m.group(2)]}}}", text)
    if n0:
        counts["aligned"] += n0 // 2 or 1
    text = _pair_commas(text, counts)
    out, n1 = _DEC_LATEX.subn(".", text)
    out, n2 = _DEC_COMMA.subn(".", out)
    if n1 + n2:
        counts["decimal"] += n1 + n2
    return _semicolon_pairs(out, counts), counts


def _semicolon_pairs(out: str, counts: Counter) -> str:
    """The book's `(x; y)` as the app's `(x, y)`: the `;` at the top level of every bracket group that reads as maths
    (semicolon_groups) becomes ", ". Nothing else in the text is touched."""
    groups = semicolon_groups(out)
    if groups:
        positions = sorted(p for _, _, semis in groups for p in semis)
        counts["pair"] += len(groups)
        for p in reversed(positions):
            a, b = p, p + 1
            while a > 0 and out[a - 1] == " ":
                a -= 1
            while b < len(out) and out[b] == " ":
                b += 1
            out = out[:a] + ", " + out[b:]
    return out


def normalise_pairs(text: str | None) -> tuple[str | None, Counter]:
    """`normalise`'s `;`-pair rule ALONE: no decimal commas, no align environments, no comma-pair-by-context.

    For text that was never printed with the book's decimal commas and whose commas are a list's: a learning
    objective's label and statement (S1 writes them in English from the section's own title — "Ratios of a point
    (x;y)" — so "1,2,3" there is a list, never 1.23) and a widget template's own prose. The rule is the one
    `normalise` applies to a question, so a coordinate pair, an interval and a set convert exactly as they do
    there, and a prose parenthesis ("(see the table; then answer)"), a top-level `;` and a comma list do not."""
    counts: Counter = Counter()
    if not text:
        return text, counts
    return _semicolon_pairs(text, counts), counts


_MATH_WRAPPED = re.compile(r"^\s*(\${1,2})([^$]+)\1\s*$")


def unwrap_math_delimiters(key: str | None) -> str | None:
    """A marker key is bare maths: the typing agent sometimes copies the EPUB's final as the book wrote it, `$(a-3)(a+3)$`,
    and the app's marker refuses the `$` ("unexpected character"), which held 29 of Chapter 1's questions for a delimiter, not
    a wrong answer. One enclosing `$…$` (or `$$…$$`) pair around the whole key is removed; a `$` anywhere inside means
    the key is not one wrapped formula and is left as it is."""
    if not key:
        return key
    m = _MATH_WRAPPED.match(key)
    return m.group(2).strip() if m else key


def residual_notation(text: str | None) -> list[str]:
    """Un-normalised decimal commas or `;`-pairs left in a text (the coverage audit's probe)."""
    if not text:
        return []
    hits = [m.group(0) for m in RESIDUAL_DECIMAL.finditer(text)]
    hits += [m.group(0) for m in DISPLAY_ENV.finditer(text)]
    hits += [text[o:c + 1] for o, c, _ in semicolon_groups(text)]
    return hits




# =============================================================================
# Book provenance across the whole book (FR-4311, FR-4312, FR-4317)
# =============================================================================

def check_lessons(lessons: list[Lesson]) -> list[str]:
    """Book-level rules over lessons IN CATALOGUE ORDER. Empty list = fine.

    SeedBundle checks one bundle; these hold across all of them: slugs unique, a split
    section's parts consecutive, numbered 1..m and in one module, a lesson without a part
    never sharing a section with another lesson.
    """
    problems: list[str] = []
    slugs = Counter(l.slug for l in lessons)
    problems += [f"lesson slug {s} appears {n} times" for s, n in slugs.items() if n > 1]
    parts: dict[str, list[tuple[int, Lesson]]] = defaultdict(list)
    for i, l in enumerate(lessons):
        if l.part:
            parts[l.group_key].append((i, l))
    for key, members in parts.items():
        ns = [l.part.n for _, l in members]
        m = {l.part.of for _, l in members}
        if len(m) != 1 or sorted(ns) != list(range(1, next(iter(m)) + 1)):
            problems.append(f"section {key}: parts {ns} of {sorted(m)}, expected 1..m, each once")
        idx = [i for i, _ in members]
        if idx != list(range(idx[0], idx[0] + len(idx))) or ns != sorted(ns):
            problems.append(f"section {key}: parts are not consecutive in catalogue order, in part "
                            f"order (FR-4312): {[l.slug for _, l in members]}")
        if len({l.module for _, l in members}) != 1:
            problems.append(f"section {key}: parts sit in different modules")
    owner: dict[str, str] = {}
    for l in lessons:
        for s in l.sections:
            prev = owner.get(s.number)
            if prev and not (l.part and prev in {x.slug for _, x in parts.get(s.number, [])}):
                problems.append(f"section {s.number} is claimed by both {prev} and {l.slug}")
            owner.setdefault(s.number, l.slug)
    return problems


def derived_part_edges(lessons: list[Lesson], los_by_lesson: dict[str, list[str]]
                       ) -> list[tuple[str, str]]:
    """FR-4317: every objective of part n-1 before every objective of part n."""
    edges: list[tuple[str, str]] = []
    by_group: dict[str, dict[int, str]] = defaultdict(dict)
    for l in lessons:
        if l.part:
            by_group[l.group_key][l.part.n] = l.slug
    for parts in by_group.values():
        for n in sorted(parts):
            if n - 1 in parts:
                edges += [(a, b) for a in los_by_lesson.get(parts[n - 1], [])
                          for b in los_by_lesson.get(parts[n], [])]
    return edges


def find_cycle(edges: list[tuple[str, str]]) -> list[str] | None:
    adj: dict[str, list[str]] = defaultdict(list)
    for s, d in edges:
        adj[s].append(d)
    state: dict[str, int] = {}
    stack: list[str] = []

    def dfs(u: str) -> list[str] | None:
        state[u] = 0
        stack.append(u)
        for v in adj.get(u, []):
            if state.get(v) == 0:
                return stack[stack.index(v):] + [v]
            if v not in state and (c := dfs(v)):
                return c
        stack.pop()
        state[u] = 1
        return None

    for s in list(adj):
        if s not in state and (c := dfs(s)):
            return c
    return None


# =============================================================================
# Inputs
# =============================================================================

class Evidence(BaseModel):
    model_config = ConfigDict(extra="allow")
    kind: Literal["heading", "intro", "summary", "definition", "worked_example", "exercise"]
    anchor: str
    printed_page: int
    quote: Optional[str] = None


class Objective(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(pattern=r"^lo:[a-z0-9]+-[0-9]+-[0-9]+$")
    label: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    evidence: list[Evidence] = Field(min_length=1)
    exercise_items: list[str] = []


class PrereqRef(BaseModel):
    model_config = ConfigDict(extra="allow")
    src: str
    dst: str


class ObjectivesFile(BaseModel):
    model_config = ConfigDict(extra="allow")
    lesson: str
    objectives: list[Objective] = Field(min_length=1)
    prerequisites: list[PrereqRef] = []


class Gate2(BaseModel):
    model_config = ConfigDict(extra="allow")
    verdict: Literal["accept", "fix", "exclude", "hold"]
    by: str = Field(min_length=1)
    note: Optional[str] = None


# ---- the options of a choice (collect-6, 2026-10-01) -----------------------------------------------------
# options_source "lesson" is a closed set the BOOK uses: one verbal category each ("rational" / "irrational", "real" /
# "non-real" / "undefined", true / false). Numbers, pairs of integers, values and combinations of categories are the
# book's ANSWER to type; the typing agent that wrote options around a printed answer invented them (Chapter 1: "4 and 5"
# among "3 and 4" and "5 and 6"). lesson.workflow.js refuses them (COLLECT-6); this is the same check on a run's item, for
# a run an older collection made. It only ever ADDS a typing problem: G2 (a person, or the auto-pass's exclusion) rules.
_CATEGORY = re.compile(r"^[A-Za-z][A-Za-z'’]*(?:[ -][A-Za-z][A-Za-z'’]*){0,6}$")
_LISTISH = re.compile(r"[,;/]|\s(?:and|or)\s", re.I)
INVENTED_OPTIONS = "options said to be the lesson's closed set are not categories"
TOO_MANY_OPTIONS = "a choice needs 2–5 options, not"
UNKEYED_OPTIONS = "a choice's options all need a key"


def _plain_option(o) -> str:
    return re.sub(r"\\(?:text|mathrm|textrm|mbox)\{([^{}]*)\}", r"\1", str(o if o is not None else "").replace("$", "")).strip()


def is_category(o) -> bool:
    w = _plain_option(o)
    return bool(_CATEGORY.match(w)) and not _LISTISH.search(w)


def choice_option_problems(item: dict) -> list[str]:
    """The typing problems a choice item's OPTIONS have that its run did not already name (idempotent: a problem the
    collection reported is not added again)."""
    if item.get("answer_type") != "choice":
        return []
    choices = [c for c in item.get("choices") or [] if isinstance(c, dict)]
    have = item.get("typing_problems") or []
    out: list[str] = []
    if len(choices) > 5 and not any(h.startswith(TOO_MANY_OPTIONS) for h in have):
        out.append(f"{TOO_MANY_OPTIONS} {len(choices)}: a list in the stem to select from is not a choice")
    if any(not c.get("key") for c in choices) and not any(h.startswith(UNKEYED_OPTIONS) for h in have):
        out.append(f"{UNKEYED_OPTIONS} (A, B, C …)")
    if item.get("options_source") == "lesson" and not any(h.startswith(INVENTED_OPTIONS) for h in have):
        bad = [c.get("text") for c in choices if not is_category(c.get("text"))]
        if bad:
            out.append(f"{INVENTED_OPTIONS}: " + ", ".join(f'"{b}"' for b in bad[:3]) +
                       " — numbers, pairs, values and combinations are the book's answer to type, never options to invent")
    return out


# ---- the marker spec's coherence (collect-6, 2026-10-01) ---------------------------------------------------
# A kind the asked form cannot apply to ("Factorise: 25x^3 + 1", key (∛25·x+1)(…) typed kind "surd", form "factorised") is
# refused by schemas.AnswerSpec, and a refused item used to stop the whole lesson's split — the G2 draft could not be written.
# lesson.workflow.js normalises the kind where the key is plainly algebra (COLLECT-6, rule 'kind-for-form') and otherwise flags
# the item; this is the same line for a run an older collection made. It only ever ADDS a typing problem, and only to an item
# the collection did not already flag (a flagged item need not be well formed): G2, a person or the auto-pass, rules on it.
MARKER_INCOHERENT = "the marker spec is not coherent"


def marker_spec_problems(item: dict) -> list[str]:
    if item.get("answer_type") != "expression" or not isinstance(item.get("marker"), dict) or item.get("typing_problems"):
        return []
    try:
        schemas.AnswerSpec.model_validate(item["marker"])
    except ValidationError as e:
        return [f"{MARKER_INCOHERENT}: " + "; ".join(str(x["msg"]).removeprefix("Value error, ") for x in e.errors())]
    return []


class RunItem(BaseModel):
    """One S3 book item after gate G2 (extraction-pipeline.md §3.6)."""
    model_config = ConfigDict(extra="allow")
    ref: str = Field(pattern=ITEM_REF)
    kind: Literal["worked_example", "exercise"]
    lo: str
    stem: str = Field(min_length=1)
    answer_type: AnswerType
    answer: Optional[str] = None
    choices: Optional[list[dict]] = None
    marker: Optional[dict] = None
    solution: list[str] = Field(min_length=1)
    solution_provenance: schemas.SolutionProvenance
    printed_answer: Optional[str] = None
    epub_final_answer: Optional[str] = None
    blind_answer: Optional[str] = None
    verification: Literal["agreed", "disputed", "no_printed_answer"]
    g2: Optional[Gate2] = None
    tier: schemas.Tier
    printed_page: int
    shortcode: Optional[str] = None
    teacher_only: bool = False
    # G2 (decisions 41 and 43; contracts/pipeline-handoff.md). `less_specific`: the keys of OTHER
    # options that are also true, less precisely — the app returns such a pick for re-entry and never
    # marks it wrong. `answer_only`: the book has no working, so the item is marked on its answer and
    # the tutor gives no step-by-step explanation.
    less_specific: Optional[list[str]] = None
    answer_only: Optional[bool] = None

    @model_validator(mode="after")
    def _typed(self) -> "RunItem":
        if self.teacher_only:
            raise ValueError(f"{self.ref}: a teacher-only block reached S3 (FR-4408)")
        if self.ref.startswith("WE") != (self.kind == "worked_example"):
            raise ValueError(f"{self.ref}: kind {self.kind} does not match its reference")
        if (self.kind == "worked_example") != (self.solution_provenance == "book_worked"):
            raise ValueError(f"{self.ref}: a worked example's solution is `book_worked`, and only "
                             f"a worked example's is (got {self.solution_provenance})")
        # An item the pipeline itself flagged (`typing_problems`) and that G2 has not ruled on — or excluded — is never emitted
        # as typed, so its typing need not be well formed: 4 choice items of Chapter 1 had a compound key no option
        # carries, 4 a list of numbers to select from, and the draft G2 reads could not even be written for them. A person's
        # fix, an accept or a hold puts the full shape back on it: those items are emitted.
        unsettled = bool((self.model_extra or {}).get("typing_problems")) and (self.g2 is None or self.g2.verdict == "exclude")
        if not unsettled:
            if self.answer_type == "choice":
                keys = [c.get("key") for c in self.choices or []]
                if len(keys) < 2 or self.answer not in keys:
                    raise ValueError(f"{self.ref}: a choice item needs >= 2 choices and its key "
                                     f"among them")
            elif self.choices:
                raise ValueError(f"{self.ref}: only a choice item carries choices")
            if self.answer_type == "expression":
                if not self.marker:
                    raise ValueError(f"{self.ref}: an expression item carries its marker spec "
                                     "(contracts/answer-marker.md)")
                schemas.AnswerSpec.model_validate(self.marker)
            elif self.marker:
                raise ValueError(f"{self.ref}: only an expression item carries a marker spec")
            if self.answer_type in ("numeric", "choice") and not self.answer:
                raise ValueError(f"{self.ref}: a {self.answer_type} item needs its answer key")
        if self.verification == "no_printed_answer" and self.printed_answer:
            raise ValueError(f"{self.ref}: 'no_printed_answer' but a printed answer is given")
        if self.less_specific is not None:
            keys = [c.get("key") for c in self.choices or []]
            if self.answer_type != "choice":
                raise ValueError(f"{self.ref}: less_specific belongs to a choice item, not {self.answer_type}")
            bad = [k for k in self.less_specific if k not in keys]
            if not self.less_specific or bad or len(set(self.less_specific)) != len(self.less_specific):
                raise ValueError(f"{self.ref}: less_specific {self.less_specific} must name other options "
                                 f"(keys {keys}), each once")
            if self.answer in self.less_specific:
                raise ValueError(f"{self.ref}: the key {self.answer!r} is the most specific answer, not a "
                                 "less specific one")
        if self.answer_only is not None:
            if self.answer_only is not True or self.answer_type != "expression":
                raise ValueError(f"{self.ref}: answer_only is `true` on a marked expression item only")
            pair = next((p for p in ((self.model_extra or {}).get("verify") or {}).get("pairs") or []
                         if str(p.get("pair_id", "")).endswith("|blind~printed")), None)
            if not (self.printed_answer and self.blind_answer and pair and pair.get("verdict") == "equivalent"):
                raise ValueError(f"{self.ref}: answer_only marks the answer alone, so its key must be agreed "
                                 "by the printed answer AND the blind re-solve (blind~printed equivalent)")
        return self

    def question_id(self) -> str:
        if self.kind == "worked_example":
            return schemas.worked_example_question_id(self.lo, int(self.ref[2:]))
        return schemas.exercise_question_id(self.lo, self.ref)

    def where(self) -> str:
        if self.kind == "worked_example":
            return f"Worked example {int(self.ref[2:])}"
        label, q = self.ref[2:].split(":")
        code = f" ({self.shortcode})" if self.shortcode else ""
        return f"Exercise {label}, question {q}{code}"

    def fate(self) -> str:
        """verified | held | excluded | teaching — what becomes of the item (handoff table)."""
        if self.g2 and self.g2.verdict == "exclude":
            return "excluded"
        if self.answer_type == "not_markable":
            return "teaching"
        # typing the pipeline flagged and nobody ruled on: never emitted as verified (its shape need not be well formed)
        if (self.model_extra or {}).get("typing_problems") and not self.g2:
            return "held"
        if self.g2 and self.g2.verdict in ("accept", "fix"):
            return "verified"
        if self.verification == "agreed" and not self.g2:
            return "verified"
        return "held"


class RunVisual(BaseModel):
    model_config = ConfigDict(extra="allow")
    n: int = Field(ge=1)
    lo: str
    question: Optional[str] = None          # an item ref (WE3, Ex8-2:5b) or None
    kind: str
    spec: dict
    caption: Optional[str] = None
    printed_page: Optional[int] = None


class RunClaim(BaseModel):
    model_config = ConfigDict(extra="allow")
    lo: str
    provenance: Optional[str] = None    # containment | checked | re-audited (lesson.workflow.js)
    type: schemas.ClaimType
    text: str = Field(min_length=1)
    anchor: str
    printed_page: int
    evidence_kind: Optional[schemas.EvidenceKind] = None
    supported: bool = True
    teacher_only: bool = False

    def kind(self) -> str:
        if self.evidence_kind:
            return self.evidence_kind
        if self.anchor.startswith("WE"):
            return "worked_example"
        if self.anchor.startswith("Ex"):
            return "exercise"
        return "box" if self.type == "caution" else "heading"


class TeacherOnly(BaseModel):
    model_config = ConfigDict(extra="allow")
    seen: int = 0
    dropped: int = 0
    reached_claim: int = 0


class LessonRun(BaseModel):
    model_config = ConfigDict(extra="allow")
    lesson: str
    claims: list[RunClaim] = []
    items: list[RunItem] = []
    visuals: list[RunVisual] = []
    viz_gaps: list[dict] = []
    teacher_only: TeacherOnly = Field(default_factory=TeacherOnly)


# =============================================================================
# The manifest, read leniently: WP-P1 owns its shape (T402)
# =============================================================================

def manifest_lessons(manifest: dict) -> list[tuple[dict, dict]]:
    """(module, lesson) pairs in book order."""
    out = []
    for mod in sorted(manifest["modules"], key=lambda m: m.get("order_in_parent") or m["chapter"]):
        for les in sorted(mod.get("lessons", []), key=lambda l: l.get("order_in_module", 0)):
            out.append((mod, les))
    return out


def book_lesson(mod: dict, les: dict) -> Lesson:
    """A manifest lesson's provenance as schemas.Lesson.

    B3 (build_manifest.py) writes it under `book_provenance` {sections: [{number, title,
    code}], part, chapter_intro, group_key}; top-level `sections`/`part`/`chapter_intro` are
    read too, and a scouting-draft lesson (one `section`) is one section, no part.
    """
    bp = les.get("book_provenance") or les
    sections = bp.get("sections") or [{"number": les["section"], "title": les["title"]}]
    sections = [{"number": x["number"], "title": x["title"]} for x in sections]
    return Lesson(slug=les["id"], title=les["title"], module=mod["id"], sections=sections,
                  part=bp.get("part"), chapter_intro=bool(bp.get("chapter_intro")))


# =============================================================================
# Assembly
# =============================================================================

class AssemblyError(Exception):
    pass


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def rel(p: Path) -> str:
    try:
        return str(p.resolve().relative_to(book_config.REPO_ROOT))
    except ValueError:
        return str(p)


def source_document(book, manifest: dict) -> dict:
    mb = manifest.get("book", {})
    return {"title": mb.get("title") or book.title, "publisher": mb.get("publisher") or "unknown",
            "edition": mb.get("edition"), "language": book.language, "grade": book.grade,
            "subject": "mathematics" if book.subject == "math" else book.subject,
            "file_path": book.sources.pdf}


def program_of(book) -> tuple[str, str]:
    if book.program:
        return book.program.id, book.program.label
    return f"program:{book.curriculum}", book.curriculum


def extraction_run() -> dict:
    return {"extractor": EXTRACTOR, "extractor_version": EXTRACTOR_VERSION, "schema_version": "1"}


def course_bundle(book, manifest: dict) -> dict:
    pid, plabel = program_of(book)
    edition = manifest.get("book", {}).get("edition")
    return {
        "source_document": source_document(book, manifest),
        "extraction_run": extraction_run(),
        "syllabus_version": edition or "unversioned",
        "nodes": [{"id": pid, "kind": "program", "label": plabel},
                  {"id": book.course_id, "kind": "course", "label": book.title,
                   "syllabus_ref": edition}],
        "edges": [{"src": book.course_id, "dst": pid, "type": "part_of"}],
        "questions": [],
    }


class Report:
    def __init__(self) -> None:
        self.counts: Counter = Counter()
        self.notation: Counter = Counter()
        self.notation_items: set[str] = set()
        self.excluded: list[dict] = []
        self.by_provenance: Counter = Counter()
        self.by_answer_type: Counter = Counter()
        self.derived_part_edges = 0
        self.content: dict[str, dict] = {}     # slug -> the lesson-content file (S2's claims)
        self.held_by_marker: list[dict] = []   # questions held: the app's marker cannot mark their key
        self.keys_unwrapped: list[dict] = []   # a marker key the typing agent wrote as `$…$`, delimiters removed {id, was, now}
        self.marker_check = "run"
        self.ambiguous_pairs: list[str] = []   # A4: "(a,b)" sides of an equation not provably a pair → G2
        self.respaced = 0                      # A2: glued LaTeX commands re-spaced (accepted.json untouched)
        self.assignments_split = 0             # A2: "x_1=…y_1=…" chains written as separate assignments
        self.entities = 0                      # Chapter 5: numeric HTML character references the EPUB left in the text ("&#176;" for °)
        self.dollars = 0                       # Chapter 9: escaped dollar signs (`\\$`) the app's maths splitter cannot carry, written without a `$`
        self.katex_errors: list[dict] = []     # A2: segments the app's KaTeX cannot parse (must be 0)
        self.forms_from_rules: list[dict] = [] # A9: marker forms set from the book's form rules
        self.visuals_dropped: list[dict] = []  # A8: a figure that draws the question's unknown
        self.held_for_figure: list[str] = []   # A3: a stem that shows [figure] with no figure: review
        self.captions_fixed: list[dict] = []   # a caption that described a withheld point as shown
        # answer 37d, "book picture for now": the book's own image stands in for a figure no native kind drew
        self.book_pictures = True              # --no-book-pictures: native figures only (answer 29's rule)
        self.figures_dir: Path | None = None   # where the book's images are (work/<book>/figures)
        self.figure_kinds: dict[str, str] = {} # image file -> the native kind it needs (figure-gaps.json)
        self.book_figures: dict[str, dict] = {}   # question id -> {files, page, slug, gap_kind}
        self.native_by_file: dict[str, list[dict]] = defaultdict(list)  # image file -> native transcriptions
        self.stand_ins: list[dict] = []        # book_image visuals attached (question, file, native kind)
        self.held_reveals: list[dict] = []     # a book picture that shows the unknown: held, never shown
        self.held_katex: list[str] = []        # A2: a question whose own text KaTeX cannot parse: held
        # multi-part exercises (multipart.py): a part carries what it depends on; what that cannot settle is listed
        self.carried_stems: list[dict] = []    # {question, lesson, ref, rules, from, sentences, before, after}
        self.multipart_unresolved: list[dict] = []   # {ref, lesson, reason, detail, sources}: for the review backlog
        self.book_name = ""

    def as_dict(self) -> dict:
        return {"counts": dict(sorted(self.counts.items())),
                "notation": {"changes": dict(self.notation),
                             "items_normalised": len(self.notation_items)},
                "by_solution_provenance": dict(sorted(self.by_provenance.items())),
                "by_answer_type": dict(sorted(self.by_answer_type.items())),
                "excluded": self.excluded, "derived_part_edges": self.derived_part_edges,
                "marker_check": self.marker_check, "held_by_marker": self.held_by_marker,
                "marker_keys_unwrapped": self.keys_unwrapped,
                "ambiguous_pairs_for_g2": sorted(set(self.ambiguous_pairs)), "latex_respaced": self.respaced,
                "html_entities_unescaped": self.entities, "escaped_dollars_normalised": self.dollars, "assignments_split": self.assignments_split, "katex_errors": self.katex_errors,
                "forms_from_rules": self.forms_from_rules, "visuals_dropped": self.visuals_dropped,
                "held_for_figure": self.held_for_figure, "captions_fixed": self.captions_fixed,
                "book_pictures": "on" if self.book_pictures else "off (--no-book-pictures)",
                "stand_ins": self.stand_ins, "held_reveals": self.held_reveals, "held_katex": self.held_katex,
                "stem_carry": {"carried": self.carried_stems, "unresolved": self.multipart_unresolved}}


def _norm(text: str | None, where: str, report: Report, pairs_only: bool = False) -> str | None:
    """`normalise` (or, `pairs_only`, `normalise_pairs`) with what it changed recorded in the report."""
    out, c = (normalise_pairs if pairs_only else normalise)(text)
    if c:
        report.notation.update(c)
        if c.get("decimal") or c.get("pair"):       # decision 15's items; `aligned` is presentation only
            report.notation_items.add(where)
        if c.get("pair_ambiguous"):
            report.ambiguous_pairs.append(where)
    return out


# =============================================================================
# S0b LaTeX re-spacing and the app's KaTeX (consistency review A2)
# =============================================================================
# S0b stores its transcriptions whitespace-stripped (the hash proofs in runs/<book>/maths/accepted.json are over
# that text, so accepted.json is never rewritten): "\triangle ABC" came back as "\triangleABC", "\ m" (a control
# space) as "\m", and the book's four assignments "x_1 = −2   y_1 = −5 …" as one chain. KaTeX refuses the first
# two as undefined commands and the app showed them as red error text. Assembly re-spaces every string it emits:
# a command run KaTeX does not know is split after its LONGEST known prefix ("\therefore"+"y"), or, with no known
# prefix, read as the control space it was ("\ m"). Deterministic: KaTeX (the app's own) decides what is known.
KATEX_CHECK = HERE / "katex_check.mjs"
# \textdollar is the one command this module writes itself (normalise_dollars): KaTeX 0.17 defines it in text mode only, so the probe below (`\name`
# in running maths) would call it undefined and the re-spacing pass would split it into "\text dollar".
_KNOWN: dict[str, bool] = {"textdollar": True}
_ASSIGN_TOKEN = re.compile(r"([xy])_(?:\{([12])\}|([12]))\s*=")


def _katex(mode: str, rows: list[dict]) -> dict:
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        raise AssemblyError("the KaTeX check needs node (it runs the app's own KaTeX)")
    r = subprocess.run([node, "--no-warnings", str(KATEX_CHECK), mode], capture_output=True, text=True,
                       input="".join(json.dumps(x, ensure_ascii=False) + "\n" for x in rows), timeout=600)
    if r.returncode != 0:
        raise AssemblyError(f"the KaTeX check could not run: {r.stderr.strip()[-400:]}")
    return json.loads(r.stdout)


def _command_runs(text: str) -> list[tuple[int, int]]:
    """(start, end) of every `\\letters` command in `text`; the second backslash of `\\\\` starts none."""
    out, i, n = [], 0, len(text)
    while i < n:
        if text[i] == "\\":
            if i + 1 < n and text[i + 1] == "\\":
                i += 2
                continue
            j = i + 1
            while j < n and text[j].isalpha():
                j += 1
            if j > i + 1:
                out.append((i, j))
            i = max(j, i + 1)
            continue
        i += 1
    return out


def prime_known(texts) -> None:
    """Ask KaTeX, once, about every command run in `texts` and each of its prefixes."""
    names: set[str] = set()
    for t in texts:
        if isinstance(t, str) and "\\" in t:
            for a, b in _command_runs(t):
                run = t[a + 1:b]
                names.update(run[:k] for k in range(1, len(run) + 1))
    todo = sorted(names - set(_KNOWN))
    if todo:
        known = set(_katex("known", [{"name": x} for x in todo])["known"])
        _KNOWN.update({x: x in known for x in todo})


def _split_assignments(seg: str) -> str:
    """"x_{1}=-2y_{1}=-5x_{2}=7y_{2}=-2" → "x_{1}=-2 \\quad y_{1}=-5 \\quad …": only when the segment is nothing
    but three or more DIFFERENT coordinate assignments (x_1, y_1, x_2, y_2), each once, and no other '=' —
    as a chain of equalities that string means nothing, so the book's separate assignments are the reading."""
    t = seg.strip()
    toks = list(_ASSIGN_TOKEN.finditer(t))
    if len(toks) < 3 or toks[0].start() != 0 or t.count("=") != len(toks) or "\\begin" in t:
        return seg
    names = [(m.group(1), m.group(2) or m.group(3)) for m in toks]
    if len(set(names)) != len(names):
        return seg
    parts = [t[m.start():(toks[k + 1].start() if k + 1 < len(toks) else len(t))].strip() for k, m in enumerate(toks)]
    if any(p.endswith("=") for p in parts):
        return seg
    return " \\quad ".join(parts)


def _digit_escapes(text: str) -> tuple[str, int]:
    """A backslash before a DIGIT written back as a control space: the book's thousands space survives S0b as
    `\\text{57\\000\\000}` (whitespace stripped before hashing), and KaTeX refuses `\\0` — so it becomes
    `57\\ 000\\ 000`, which renders. The second backslash of `\\\\` (a line break) is never touched."""
    out, i, n, k = [], 0, len(text), 0
    while i < n:
        c = text[i]
        if c == "\\" and i + 1 < n and text[i + 1] == "\\":
            out.append("\\\\")
            i += 2
            continue
        if c == "\\" and i + 1 < n and text[i + 1].isdigit():
            out.append("\\ ")
            k += 1
            i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out), k


def respace_latex(text: str) -> tuple[str, int, int]:
    """(text, commands re-spaced, assignment chains split). Needs prime_known() for its commands."""
    if not isinstance(text, str) or "\\" not in text and "=" not in text:
        return text, 0, 0
    text, digits = _digit_escapes(text)
    runs = _command_runs(text)
    missing = [text[a + 1:b] for a, b in runs if text[a + 1:b] not in _KNOWN]
    if missing:
        prime_known([text])
    out, last, n = [], 0, 0
    for a, b in runs:
        run = text[a + 1:b]
        out.append(text[last:a])
        if _KNOWN.get(run):
            out.append(text[a:b])
        else:
            k = next((k for k in range(len(run) - 1, 0, -1) if _KNOWN.get(run[:k])), 0)
            out.append("\\" + (run[:k] + " " + run[k:] if k else " " + run))
            n += 1
        last = b
    out.append(text[last:])
    text = "".join(out)
    split = 0

    def seg(m):
        nonlocal split
        new = _split_assignments(m.group(1))
        split += new != m.group(1)
        return "$" + new + "$"
    text = re.sub(r"\$([^$]+)\$", seg, text)
    return text, n + digits, split


_NOT_TEXT = {"assembled_from", "source_document", "extraction_run", "provenance", "source", "file_path", "src"}


_ENTITY = re.compile(r"&#(?:[xX]([0-9a-fA-F]+)|(\d+));|&deg;")
_MATH_SEG = re.compile(r"\$[^$]+\$")


_TEXT_CMD = re.compile(r"\\(?:text|textrm|textbf|textit|textsf|texttt|textnormal|mbox|hbox)(?![A-Za-z])\s*\{")


def normalise_dollars(text: str) -> tuple[str, int]:
    """(text, escaped dollar signs rewritten). Chapter 9's exchange-rate lessons carry a dollar sign the book writes `\\$` ("$\\text{\\$ 7.00}$",
    "$\\text{\\$1}&=\\text{R11.42}$", "( $\\$$ )"). The app's maths splitter, TeXRenderer's `text.split(/(\\$[^$]+\\$)/g)`, knows no escape: the `$` of a `\\$`
    closes the segment, KaTeX is handed half a command ("\\text{\\") and the rest of the text pairs its dollars the wrong way round (every later
    segment of the string is garbled, not only this one). KaTeX itself reads `\\$` fine; it is the splitter. So no `$` character may stand inside a
    maths segment: in running maths the sign is `\\text{\\textdollar}`, inside a `\\text{…}` group it is `\\textdollar{}` (KaTeX 0.17 has
    `\\textdollar` in text mode only; `{}` ends the command so that the space or the letter after it is kept), and in prose, where a lone `$`
    would pair with the next one, it is the maths segment `$\\text{\\textdollar}$`. The scan honours the escape itself, so "\\\\" (a line
    break, as in `…\\\\$`) is not mistaken for one, and nothing else is touched."""
    if not isinstance(text, str) or "\\$" not in text:
        return text, 0
    out, i, n, k = [], 0, len(text), 0
    in_math = False
    braces: list[bool] = []                  # one entry per open "{" inside maths: is it text mode?
    while i < n:
        c = text[i]
        if c == "\\" and i + 1 < n:
            if text[i + 1] == "$":
                k += 1
                out.append(("\\textdollar{}" if braces and braces[-1] else "\\text{\\textdollar}") if in_math else "$\\text{\\textdollar}$")
                i += 2
                continue
            m = _TEXT_CMD.match(text, i) if in_math else None
            if m:
                out.append(m.group(0))
                braces.append(True)
                i = m.end()
                continue
            out.append(text[i:i + 2])        # a control symbol or "\\\\": the next character is never a delimiter or a brace
            i += 2
            continue
        if c == "$":
            in_math = not in_math
            braces = []
        elif in_math and c == "{":
            braces.append(bool(braces and braces[-1]))
        elif in_math and c == "}" and braces:
            braces.pop()
        out.append(c)
        i += 1
    return "".join(out), k


def unescape_entities(text: str) -> tuple[str, int]:
    """(text, references replaced). Chapter 5's EPUB left numeric HTML character references in its text and inside its maths ("$\\cos30&#176;=$",
    "$\\tan45&#176;=1$"): KaTeX refuses the "&" and the question showed a red error. A reference is the character it names; inside `$…$` the degree
    sign is the book's own spelling of it everywhere else in the same stems, ^{\\circ}. Nothing else is touched."""
    if not isinstance(text, str) or "&" not in text:
        return text, 0
    n = 0

    def char(m, in_math):
        nonlocal n
        if m.group(0) == "&deg;":
            c = "\u00b0"
        else:
            code = int(m.group(1), 16) if m.group(1) else int(m.group(2))
            if not 0 < code < 0x110000:
                return m.group(0)
            c = chr(code)
        n += 1
        return "^{\\circ}" if in_math and c == "\u00b0" else c

    out, last = [], 0
    for seg in _MATH_SEG.finditer(text):
        out.append(_ENTITY.sub(lambda m: char(m, False), text[last:seg.start()]))
        out.append(_ENTITY.sub(lambda m: char(m, True), seg.group(0)))
        last = seg.end()
    out.append(_ENTITY.sub(lambda m: char(m, False), text[last:]))
    return "".join(out), n


def respace_tree(obj, report: Report):
    """Every student-facing string of a bundle or a lesson-content file, re-spaced (metadata keys skipped)."""
    if isinstance(obj, str):
        obj, d = normalise_dollars(obj)      # first: every later pass splits maths on `$…$`, which a `\\$` would cut in two
        report.dollars += d
        obj, e = unescape_entities(obj)
        report.entities += e
        t, n, k = respace_latex(obj)
        report.respaced += n
        report.assignments_split += k
        return t
    if isinstance(obj, list):
        return [respace_tree(x, report) for x in obj]
    if isinstance(obj, dict):
        return {key: (v if key in _NOT_TEXT else respace_tree(v, report)) for key, v in obj.items()}
    return obj


def _strings(v, skip=_NOT_TEXT):
    if isinstance(v, str):
        yield v
    elif isinstance(v, list):
        for x in v:
            yield from _strings(x, skip)
    elif isinstance(v, dict):
        for k, x in v.items():
            if k not in skip:
                yield from _strings(x, skip)


def student_texts(bundle: dict, where: str) -> list[dict]:
    """[{where, text}] for everything a student can be shown from a bundle or a lesson-content file."""
    rows = []
    for q in bundle.get("questions") or []:
        shown = {k: q.get(k) for k in ("stem", "answer", "solution", "correct_answer", "canonical_solution")}
        ch = q.get("choices")
        shown["choices"] = {k: v for k, v in ch.items() if k != "pending_review"} if isinstance(ch, dict) else ch
        rows += [{"where": q["id"], "text": t} for t in _strings(shown)]
    for e in bundle.get("explanation_entries") or []:
        rows += [{"where": e["id"], "text": t} for t in _strings(e.get("content"))]
    for v in bundle.get("visuals") or []:
        rows += [{"where": v["id"], "text": t} for t in _strings({"caption": v.get("caption"), "spec": v.get("spec")})]
    for c in bundle.get("claims") or []:
        rows += [{"where": f"claim:{c.get('lo')}", "text": c.get("claim") or c.get("text")}]
    if "questions" not in bundle and "claims" in bundle:          # a lesson-content file: all of it is shown
        rows += [{"where": f"content:{where}", "text": t} for t in _strings(bundle)]
    return [r for r in rows if isinstance(r["text"], str) and "$" in r["text"]]


def katex_errors(rows: list[dict]) -> list[dict]:
    return _katex("check", rows)["errors"] if rows else []


# =============================================================================
# The answer text, from the marker key (consistency review A1)
# =============================================================================
def _split_top(text: str, sep: str) -> list[str]:
    out, depth, cur = [], 0, []
    for ch in text:
        if ch in "{([":
            depth += 1
        elif ch in "})]":
            depth -= 1
        if ch == sep and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return [x.strip() for x in out if x.strip()]


def answer_text(marker: dict) -> str:
    """What a typed question shows as its correct answer: the marker's key, rendered — never the PDF's text layer,
    which flattens a printed fraction 9/11 to "9 11" (A1). Several values read "x = 3 \\text{ or } x = 9" when the
    answer names one variable (the families' marker_key does the same)."""
    key = str(marker.get("key") or "")
    if marker.get("kind") == "values":
        parts = _split_top(key, ";")
        vs = marker.get("variables") or []
        if len(vs) == 1:
            return r" \text{ or } ".join(f"{vs[0]} = {p}" for p in parts)
        return ",\\ ".join(parts)
    return key


def answer_problems(bundle: dict) -> list[str]:
    """A typed question's answer text must be its marker key, rendered (A1) — the load and coverage check."""
    out = []
    for q in bundle.get("questions") or []:
        ch = q.get("choices")
        if isinstance(ch, dict) and isinstance(ch.get("marker"), dict):
            want = answer_text(ch["marker"])
            if q.get("answer") != want:
                out.append(f"{q['id']}: answer {q.get('answer')!r} is not its marker key rendered ({want!r})")
    return out


# =============================================================================
# Figures a question needs (consistency review A3, A8)
# =============================================================================
_POINT_WITH_UNKNOWN = re.compile(r"(?<![A-Za-z\\])([A-Z])(?:_\{?\w+\}?)?\s*\(\s*([^;,()]+?)\s*[;,]\s*([^;,()]+?)\s*\)")


def _unknown_points(text: str) -> set[str]:
    """Names of points written with a letter for a coordinate: B(1; y), B(x, 3), M(x; y), B(2; a)."""
    out = set()
    for m in _POINT_WITH_UNKNOWN.finditer(text or ""):
        coords = [re.sub(r"\\text\{([^}]*)\}", r"\1", c).strip("$ ") for c in (m.group(2), m.group(3))]
        if any(re.fullmatch(r"[a-z]", c) for c in coords):
            out.add(m.group(1))
    return out


def _spec_points(spec) -> list[dict]:
    if isinstance(spec, dict):
        here = [spec] if isinstance(spec.get("x"), (int, float)) and isinstance(spec.get("y"), (int, float)) else []
        return here + [p for v in spec.values() for p in _spec_points(v)]
    if isinstance(spec, list):
        return [p for v in spec for p in _spec_points(v)]
    return []


def visual_gives_answer(question: dict, visual: dict) -> str | None:
    """Why a figure must not be shown with its question (A8), or None. Never draw the unknown: a point the question
    (or the figure's own label) writes with a letter for a coordinate — B(1; y), M(x; y) — is the thing asked for,
    so drawing it anywhere either gives the answer away or contradicts the key. (A point merely drawn at a
    coordinates answer is NOT refused: "find the coordinates of point D" is read off the figure, Ex8-1:1.)"""
    unknown = _unknown_points(question.get("stem") or "")
    for p in _spec_points(visual.get("spec")):
        label = str(p.get("label") or "")
        name = re.match(r"\s*([A-Z])", label)
        if _unknown_points(label) or (name and name.group(1) in unknown):
            return f"draws the unknown point {label or name.group(1)} at ({p['x']}, {p['y']})"
    return None


# A caption describes only what is drawn (2026-09-27): a point a figure WITHHOLDS (lesson-v6 `withheld`, the
# exercise's unknown) must not be described as marked, shown, drawn or plotted — "with the midpoint M marked on it",
# "tick marks along GH showing where its midpoint M falls". Deterministic: the clause that says so is dropped.
_SHOWN = re.compile(r"\b(mark(?:ed|s|ing)?|shown?|showing|drawn|draws?|plotted|labell?ed|tick(?:s| marks?)?)\b", re.I)
_NOT_SHOWN = re.compile(r"(\bnot\b|n't\b|\bun)\s*(mark|shown|drawn|plotted|label)", re.I)


def _clauses(caption: str) -> list[str]:
    """Split at "," ";" "—" outside brackets: "A(-1; 0) is plotted; B is not" is two clauses, not three."""
    out, cur, depth = [], "", 0
    for ch in caption:
        depth += ch in "([{"
        depth -= ch in ")]}"
        if ch == "—" and depth <= 0 and cur.strip():
            out.append(cur)
            cur = ch
            continue
        cur += ch
        if ch in ",;" and depth <= 0:
            out.append(cur)
            cur = ""
    out.append(cur)
    return [c.strip() for c in out if c.strip()]


def caption_problems(caption: str | None, withheld) -> list[str]:
    """The clauses of a caption that describe a withheld point as marked or shown."""
    out = []
    for c in _clauses(caption or ""):
        if any(re.search(rf"(?<![A-Za-z]){re.escape(w)}(?![A-Za-z])", c) for w in withheld or []) \
                and _SHOWN.search(c) and not _NOT_SHOWN.search(c):
            out.append(c.strip())
    return out


def fix_caption(caption: str | None, withheld) -> str | None:
    """The caption without its clauses that describe a withheld point as shown; its sentence closed again."""
    bad = caption_problems(caption, withheld)
    if not bad:
        return caption
    kept = [c for c in _clauses(caption) if c.strip() not in bad]
    text = " ".join(kept).strip().rstrip(",;—").strip()
    return (text + ".") if text and not text.endswith((".", "?", "!")) else (text or None)


# =============================================================================
# Hold reasons (migration 035) and the book picture stand-in (answer 37d)
# =============================================================================
def hold_reason_of(it: "RunItem") -> str:
    """Why a `held` item is held (review_policy's vocabulary): a human's G2 hold, the three-way check's
    disagreement with the book, or no confirmation at all."""
    if it.g2 and it.g2.verdict == "hold":
        auto = bool((it.g2.model_extra or {}).get("auto")) or str(it.g2.by).lower().startswith("auto-pass ")
        return "unverified" if auto else "human_hold"
    if it.verification == "disputed":
        return "answer_mismatch"
    return "unverified"


def needed_kind_of(gap: dict | None) -> str | None:
    """The native kind a viz gap names: a snake_case kind leading its `needed_kind` ("polygon_scene: …"), or
    the kind of a spec the check rejected (the kind exists; this drawing did not match)."""
    if not gap:
        return None
    m = re.match(r"\s*(?:an?\s+)?([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b", str(gap.get("needed_kind") or ""))
    if m:
        return m.group(1)
    return ((gap.get("rejected_spec") or {}).get("kind")) or None


def figure_kinds(path: Path) -> dict[str, str]:
    """image file -> the native kind it needs, from the figure inventory (figure_inventory.py's
    coverage/<book>.figure-gaps.json): the proposed kind for a gap, else the first kind that covers it."""
    if not path.exists():
        return {}
    out = {}
    for f in json.loads(path.read_text()).get("figures") or []:
        kind = f.get("gap_kind") or (f.get("covered_by") or [None])[0]
        if f.get("src") and kind:
            out.setdefault(str(f["src"]).replace("/", "__"), kind)
    return out


# The point a question asks for, by name, in the words after the figure ("Find the coordinates of $M$",
# "Find $T$ , the mid-point", "the $x$ -coordinate of $R$", "the value of a in $U(6, a)$").
_ASKED_POINT = [re.compile(p) for p in (
    r"coordinates?\s+of\s+(?:the\s+)?(?:point\s+)?\$([A-Z])\$",
    r"(?:Find|Determine|Calculate|Write down|Give)\s+\$([A-Z])\$",
    r"\$([A-Z])\$\s*,\s*the\s+mid-?\s*point",
    r"value\s+of\s+\$?[a-z]\$?\s+in\s+\$([A-Z])\s*\(",
)]
_ASKED_LETTERS = re.compile(r"values?\s+of\s+\$([a-z])\$(?:\s*(?:and|,)\s*\$([a-z])\$)?")
_CONSTRUCTED = re.compile(r"\b(such that|so that|would be|could be moved|if it were)\b", re.I)


def book_picture_reveals(question: dict, natives: list[dict]) -> str | None:
    """Why the BOOK'S picture must not be shown with its question (A8's rule, carried to the book's image):
    the question asks for a point — its coordinates, or a letter standing for one of them — and the picture
    draws that point. The book draws its diagrams to scale on labelled axes, so drawing the point is drawing
    the answer. Deterministic and conservative:
      * the asked point is named in the words after the figure; a point the question constructs ("such that
        OAPB is a parallelogram", "so that", "could be moved") is not in the picture;
      * the picture draws it when a native transcription of the same image labels it (or withheld it), or —
        with no transcription to read — when the point is named before the figure (the diagram's own
        description) or the question asks for its coordinates outright;
      * a read-off exercise (no coordinates or equation in the stem, nor in the labels of a transcription of
        the picture: the figure IS the data, A8's Ex8-1:1) never counts — reading the picture is the exercise.
    Every stand-in and every hold lands in the console backlog; this only decides what a student may see."""
    stem = question.get("stem") or ""
    before, _, after = stem.rpartition("[figure]")
    if not _:
        before, after = "", stem
    given = re.compile(r"\(\s*-?\$?\d|=")
    if not given.search(stem) and not any(given.search(lab) for n in natives for lab in n["labels"]):
        return None                                   # read-off: the figure is the data
    if _CONSTRUCTED.search(after):
        return None
    drawn: set[str] = set()
    for n in natives:
        drawn |= {m.group(1) for lab in n["labels"] if (m := re.match(r"\s*([A-Z])", lab))}
        drawn |= {str(w)[:1] for w in n["withheld"] if str(w)[:1].isupper()}
    for pat in _ASKED_POINT:
        for m in pat.finditer(after):
            name = m.group(1)
            if (name in drawn) or (not natives):
                return f"the book's picture draws {name}, the point the question asks for"
            if re.search(rf"\${name}\b|\b{name}\s*\(", before):
                return f"the book's picture draws {name}, the point the question asks for"
    letters = {x for m in _ASKED_LETTERS.finditer(after) for x in m.groups() if x}
    if letters:
        # the point whose coordinates those letters are — in a transcription of the picture, or described
        # before the figure; one introduced only after the figure is not in the picture
        for n in natives:
            for lab in n["labels"]:
                coords = re.findall(r"[a-z]", re.sub(r"^\s*[A-Z]", "", lab))
                if letters & set(coords):
                    return f"the book's picture draws {lab}, whose coordinates the question asks for"
        for name in _unknown_points(before):
            m = re.search(rf"{name}\s*\(([^)]*)\)", before)
            if m and letters & set(re.findall(r"\b([a-z])\b", m.group(1))):
                return f"the book's picture draws {name}, whose coordinates the question asks for"
    return None


def stand_in_alt(page: int | None) -> str:
    """Alt text for the book's picture: what it is and where it is printed. Deliberately NOT a native
    transcription's caption of the same image — that caption was written for another item's figure (it can
    name another item's task, or the very point this item asks for); the stem itself describes the givens."""
    return "The textbook's diagram for this question" + (f", printed on page {page}." if page else ".")


def police_figures(bundle: dict, report: Report) -> None:
    """A8: drop an EXERCISE figure that draws its question's unknown (a worked example's may show its answer).
    A3: a question whose stem shows [figure] and has no figure is not verified, so it loads as `review`, never
    `live`, until its figure exists. Answer 37d ("book picture for now", 2026-10-01): where the book has its
    own image of that figure, a `book_image` stand-in carries it and the question goes live, listed in the
    console backlog as "needs native figure" — unless the picture draws the question's unknown
    (`book_picture_reveals`), in which case the question stays held as `figure_reveals_answer`."""
    qs = {q["id"]: q for q in bundle.get("questions") or []}
    kept = []
    for v in bundle.get("visuals") or []:
        # exercises only: a worked example's figure may show its answer, as the book's does (the solution is
        # shown with it); refusing WE7's figure was the rule over-reaching (coordinator, 2026-09-27)
        exercise = v.get("question") in qs and not re.search(r":we\d+$", v["question"])
        why = visual_gives_answer(qs[v["question"]], v) if exercise else None
        if why:
            report.visuals_dropped.append({"visual": v["id"], "question": v["question"], "why": why})
            continue
        kept.append(v)
    bundle["visuals"] = kept
    drawn = {v.get("question") for v in kept}
    for q in bundle.get("questions") or []:
        if "[figure]" not in (q.get("stem") or "") or q["id"] in drawn:
            continue
        src = report.book_figures.get(q["id"]) or {}
        files = [f for f in src.get("files") or []
                 if report.figures_dir is not None and (report.figures_dir / f).is_file()]
        natives = [n for f in files for n in report.native_by_file.get(f, [])]
        why = book_picture_reveals(q, natives) if files and report.book_pictures else None
        if files and report.book_pictures and not why:
            for i, f in enumerate(files, 1):
                tail = q["id"].split(":", 2)[-1]
                vid = f"v:{src['slug']}:bk-{tail}" + (f"-{i}" if len(files) > 1 else "")
                # the visuals stage's own judgement of this item's figure first, else the inventory's kind
                kind = src.get("gap_kind") or report.figure_kinds.get(f)
                kept.append({"id": vid, "lo": q["lo"], "question": q["id"], "kind": "book_image",
                             "spec": {"src": f"/book-figures/{report.book_name}/{f}",
                                      "alt": stand_in_alt(src.get("page")),
                                      "stand_in": True, "native_kind_needed": kind},
                             "caption": None, "source_page": src.get("page")})
                report.stand_ins.append({"question": q["id"], "visual": vid, "file": f, "native_kind_needed": kind})
            continue
        if q.get("verified"):
            q["verified"] = False
        if why:
            q["hold_reason"] = q.get("hold_reason") or "figure_reveals_answer"
            report.held_reveals.append({"question": q["id"], "why": why, "files": files})
        else:
            q["hold_reason"] = q.get("hold_reason") or "figure_missing"
            report.held_for_figure.append(q["id"])


# =============================================================================
# Forms the book's rules ask for (consistency review A9)
# =============================================================================
def apply_form_rules(bundle: dict, book, report: Report) -> None:
    """A stem that asks for a form the book's rules name carries that form on its marker spec, whatever S3 typed
    (deterministic; book_config.AnswerRules.forms_from_stem). A subject form needs an equation."""
    rules = getattr(getattr(book, "answer_rules", None), "forms_from_stem", None) or []
    for q in bundle.get("questions") or []:
        ch = q.get("choices")
        if not (isinstance(ch, dict) and isinstance(ch.get("marker"), dict)):
            continue
        for r in rules:
            if not re.search(r.match, q.get("stem") or "", re.I):
                continue
            form = {"subject": r.subject} if r.form == "subject" else r.form
            if r.form == "subject" and ch["marker"].get("kind") != "equation":
                break
            if ch["marker"].get("form") != form:
                report.forms_from_rules.append({"id": q["id"], "form": form, "was": ch["marker"].get("form")})
                ch["marker"]["form"] = form
            break


def form_problems(bundle: dict, book) -> list[str]:
    rules = getattr(getattr(book, "answer_rules", None), "forms_from_stem", None) or []
    out = []
    for q in bundle.get("questions") or []:
        ch = q.get("choices")
        if not (isinstance(ch, dict) and isinstance(ch.get("marker"), dict)):
            continue
        for r in rules:
            if re.search(r.match, q.get("stem") or "", re.I):
                if r.form == "subject" and ch["marker"].get("kind") != "equation":
                    break
                want = {"subject": r.subject} if r.form == "subject" else r.form
                if ch["marker"].get("form") != want:
                    out.append(f"{q['id']}: the stem asks for {want}, the marker checks {ch['marker'].get('form')}")
                break
    return out


def _captioned(v, report: Report, slug: str) -> str | None:
    withheld = getattr(v, "withheld", None) or []
    fixed = fix_caption(v.caption, withheld)
    if fixed != v.caption:
        report.captions_fixed.append({"visual": f"v:{slug}:{v.n:03d}", "was": v.caption, "now": fixed})
    return fixed


# The keys a figure's spec DRAWS text under: a point's, segment's or marker's `label` (coordinate_plot, function_graph,
# number_line, geo_scene), and a geo_scene `label` element's `text` — the app reads `e.label ?? e.text`
# (components/viz/GeoScene.tsx). Grade 10 Chapter 5 drew "Q(-2;3)" and "K(-5;y)" as `{"type": "label", "text": …}` and
# only `label` was normalised, so the book's `;` reached the screen and the coverage audit's notation check refused it.
SPEC_TEXT_KEYS = ("label", "text")


def _norm_spec(spec, where: str, report: Report):
    """A figure's drawn text in the app's notation too (decision 15, FR-4308): the pilot's coordinate plots
    labelled points "P(2;1)" — its SPEC_TEXT_KEYS strings are shown on the figure. Nothing else in a spec is text."""
    if isinstance(spec, dict):
        return {k: (_norm(x, where, report) if k in SPEC_TEXT_KEYS and isinstance(x, str) else _norm_spec(x, where, report))
                for k, x in spec.items()}
    if isinstance(spec, list):
        return [_norm_spec(x, where, report) for x in spec]
    return spec


def assemble_chapter(book, manifest: dict, mod: dict, lessons: list[Lesson],
                     objectives: dict[str, ObjectivesFile], runs: dict[str, LessonRun],
                     report: Report, inputs: dict[str, Path]) -> dict:
    course = book.course_id
    nodes: list[dict] = [{
        "id": mod["id"], "kind": "module", "label": f"Chapter {mod['chapter']} — {mod['title']}",
        "syllabus_ref": f"Chapter {mod['chapter']}",
        "source_page": (mod.get("printed_pages") or [None])[0],
        "order_in_parent": mod.get("order_in_parent") or mod["chapter"]}]
    edges: list[dict] = [{"src": mod["id"], "dst": course, "type": "part_of"}]
    questions: list[dict] = []
    visuals: list[dict] = []
    entries: list[dict] = []
    claims: list[dict] = []
    los_here: set[str] = set()
    order = 0
    for les in lessons:
        obj = objectives.get(les.slug)
        if obj is None:
            raise AssemblyError(f"{les.slug}: no objectives file (S1 after G1)")
        if obj.lesson != les.slug:
            raise AssemblyError(f"objectives file for {les.slug} says lesson {obj.lesson!r}")
        want = [schemas.lo_id(les.slug, i) for i in range(1, len(obj.objectives) + 1)]
        got = [o.id for o in obj.objectives]
        if got != want:
            raise AssemblyError(f"{les.slug}: objectives must be numbered in book order "
                                f"{want}, got {got}")
        sref = ", ".join(s.number for s in les.sections)
        for o in obj.objectives:
            order += 1
            los_here.add(o.id)
            # S1 writes an objective's label from the section's own title and its statement in English, so the book's
            # `(x;y)` reaches both ("Ratios of a point (x;y)", Grade 10 Chapter 5); a `;` pair is the only notation they carry
            nodes.append({"id": o.id, "kind": "learning_objective",
                          "label": _norm(o.label, f"{o.id}:label", report, pairs_only=True),
                          "description": _norm(o.statement, f"{o.id}:description", report, pairs_only=True),
                          "syllabus_ref": sref,
                          "source_page": min(e.printed_page for e in o.evidence),
                          "order_in_parent": order})
            edges.append({"src": mod["id"], "dst": o.id, "type": "teaches"})
        for pr in obj.prerequisites:
            if pr.dst not in set(want):
                raise AssemblyError(f"{les.slug}: prerequisite {pr.src} -> {pr.dst} must end at "
                                    "one of this lesson's own objectives")
            edges.append({"src": pr.src, "dst": pr.dst, "type": "prerequisite_of"})
        report.counts["objectives"] += len(obj.objectives)

    # A part of a multi-part exercise carries what it depends on (multipart.py): the plan is made over the WHOLE
    # chapter's items first — a question's parts are spread across lessons — and applied to each stem below.
    chapter_items = [(les.slug, it) for les in lessons if runs.get(les.slug) is not None
                     for it in runs[les.slug].items]
    carries, unresolved = multipart.plan_items([it for _, it in chapter_items])
    slug_of = {it.ref: slug for slug, it in chapter_items}
    emitted = {it.ref for _, it in chapter_items if it.fate() != "excluded"}
    report.multipart_unresolved += [{**u.as_dict(), "lesson": slug_of.get(u.ref)} for u in unresolved
                                    if u.ref in emitted]
    for les in lessons:
        run = runs.get(les.slug)
        if run is None:
            raise AssemblyError(f"{les.slug}: no lesson run output (S2–S4 after G2)")
        if run.lesson != les.slug:
            raise AssemblyError(f"run file for {les.slug} says lesson {run.lesson!r}")
        own = {schemas.lo_id(les.slug, i)
               for i in range(1, len(objectives[les.slug].objectives) + 1)}
        if run.teacher_only.reached_claim:
            raise AssemblyError(f"{les.slug}: {run.teacher_only.reached_claim} teacher-only "
                                "block(s) reached a claim (FR-4408)")
        for c in run.claims:
            if c.teacher_only:
                raise AssemblyError(f"{les.slug}: a teacher-only claim (FR-4408)")
            if c.lo not in own:
                raise AssemblyError(f"{les.slug}: claim on {c.lo}, not this lesson's objective")
            if not c.supported:
                report.counts["claims_unsupported_dropped"] += 1
                continue
            step = {"claim": _norm(c.text, f"{les.slug}:claim:{c.anchor}", report), "lang": "en",
                    "claim_type": c.type, "anchor": c.anchor, "evidence_page": c.printed_page,
                    "evidence_kind": c.kind()}
            schemas.ClaimStep.model_validate(step)
            claims.append({"lo": c.lo, **step, **({"provenance": c.provenance}
                                                  if getattr(c, "provenance", None) else {})})
        refs: dict[str, str] = {}
        detached: set[str] = set()          # items that are not question rows (teaching, excluded)
        seen_refs: set[str] = set()
        for it in run.items:
            if it.ref in seen_refs:
                raise AssemblyError(f"{les.slug}: item {it.ref} appears twice")
            seen_refs.add(it.ref)
            if it.lo not in own:
                raise AssemblyError(f"{les.slug}: item {it.ref} is mapped to {it.lo}, which is not "
                                    "one of this lesson's objectives")
            qid = it.question_id()
            fate = it.fate()
            report.counts[f"{it.kind}:{fate}"] += 1
            report.by_answer_type[it.answer_type] += 1
            wkey = f"{les.slug}:{it.ref}"
            stem = _norm(it.stem, wkey, report)
            carry = carries.get(it.ref)
            if carry is not None and fate != "excluded":
                stem = _norm(carry.after, wkey, report)
                report.counts["stems_carried"] += 1
                report.carried_stems.append({
                    "question": qid if fate != "teaching" else "expl:" + qid.removeprefix("q:"),
                    "lesson": les.slug, "ref": it.ref, "rules": sorted({x["rule"] for x in carry.items}),
                    "from": sorted({x["from"] for x in carry.items}), "sentences": carry.sentences,
                    "before": _norm(it.stem, wkey, report), "after": stem})
            solution = [_norm(s, wkey, report) for s in it.solution]
            if fate in ("excluded", "teaching"):
                detached.add(it.ref)
            if fate == "excluded":
                report.excluded.append({"lesson": les.slug, "ref": it.ref, "kind": it.kind,
                                        "reason": f"excluded at G2 by {it.g2.by}"
                                                  + (f": {it.g2.note}" if it.g2.note else "")})
                continue
            if fate == "teaching":
                entries.append({
                    "id": "expl:" + qid.removeprefix("q:"), "lo": it.lo,
                    "entry_type": "worked_example",
                    "content": [{"kind": "problem", "text_md": stem}]
                               + [{"step": i + 1, "text_md": s} for i, s in enumerate(solution)],
                    "source_page": it.printed_page,
                    "generated_by": f"book ({it.solution_provenance}); {EXTRACTOR}"})
                report.excluded.append({"lesson": les.slug, "ref": it.ref, "kind": it.kind,
                                        "reason": "not markable: kept as a worked example"})
                continue
            refs[it.ref] = qid
            report.by_provenance[it.solution_provenance] += 1
            q: dict = {"id": qid, "lo": it.lo, "tier": it.tier,
                       "type": {"numeric": "numeric", "choice": "mcq",
                                "expression": "short"}[it.answer_type],
                       "stem": stem}
            if it.answer_type == "choice":
                options = [{"key": c["key"], "text": _norm(c["text"], wkey, report)} for c in it.choices]
                # decision 41: other TRUE options travel as `less_specific` (pipeline-handoff.md)
                q["choices"] = ({"options": options, "less_specific": list(it.less_specific)}
                                if it.less_specific else options)
                q["answer"] = it.answer
            elif it.answer_type == "expression":
                marker = dict(it.marker)
                bare = unwrap_math_delimiters(marker["key"])
                if bare != marker["key"]:
                    report.keys_unwrapped.append({"id": qid, "was": marker["key"], "now": bare})
                marker["key"] = _norm(bare, wkey, report)
                q["choices"] = {"marker": marker, **({"answer_only": True} if it.answer_only else {})}
                # the answer as text, for the tutor and the console (schemas.Question): the printed
                # answer when all three agreed and G2 changed nothing; otherwise the key G2 approved —
                # never a printed answer G2 corrected (the S5 pilot read "y = 2x + 12" beside the key
                # y = 2x + 7 of a book error G2 had fixed)
                # A1 (consistency review 2026-09-27): the answer text is the marker key, rendered — never the
                # printed answer's PDF text layer ("9 11" for 9/11); `trusted` no longer decides anything here
                q["answer"] = answer_text(marker)
            else:
                ans = _norm(it.answer, wkey, report).replace(" ", "")
                if not re.fullmatch(r"-?\d+(?:\.\d+)?(?:/\d+)?", ans.replace("−", "-")):
                    raise AssemblyError(f"{les.slug}: {it.ref} is typed numeric but its key "
                                        f"{it.answer!r} is not a number after normalisation — "
                                        "type it 'expression', or put the unit in the stem")
                q["answer"] = ans
            q.update({
                "solution": solution, "source_page": it.printed_page,
                "source_note": f"{it.where()} · p.{it.printed_page} · solution: "
                               f"{it.solution_provenance}",
                "verified": fate == "verified", "source": "seed",
                "solution_provenance": it.solution_provenance})
            if fate == "held":
                # why an automatic check (or a human at G2) holds it — migration 035's hold_reason
                q["hold_reason"] = hold_reason_of(it)
            questions.append(q)
            extra = it.model_extra or {}
            gap = next((g for g in run.viz_gaps if g.get("ref") == it.ref), None)
            report.book_figures[qid] = {
                "files": [Path(str(f)).name for f in extra.get("figures") or []],
                "page": it.printed_page, "slug": les.slug,
                "gap_kind": needed_kind_of(gap)}
        for v in run.visuals:
            if v.lo not in own:
                raise AssemblyError(f"{les.slug}: visual {v.n} on {v.lo}, not this lesson's")
            if v.question and v.question not in refs and v.question not in detached:
                raise AssemblyError(f"{les.slug}: visual {v.n} names item {v.question}, which is "
                                    "not an item of this lesson")
            if v.question in detached:
                # the figure is the book's and stays with the objective; the item it
                # illustrated is teaching material or was excluded at G2
                report.counts["visuals_detached_from_non_questions"] += 1
            if getattr(v, "src", None):
                report.native_by_file[str(v.src).replace("/", "__")].append(
                    {"labels": [str(p.get("label") or "") for p in _spec_points(v.spec)],
                     "withheld": list(getattr(v, "withheld", None) or []), "caption": v.caption})
            visuals.append({"id": f"v:{les.slug}:{v.n:03d}", "lo": v.lo,
                            "question": refs.get(v.question) if v.question else None,
                            "kind": v.kind, "spec": _norm_spec(v.spec, f"{les.slug}:v{v.n}", report),
                            "caption": _norm(_captioned(v, report, les.slug), f"{les.slug}:v{v.n}", report),
                            "source_page": v.printed_page})
        report.counts["viz_gaps"] += len(run.viz_gaps)
        report.counts["teacher_only_dropped"] += run.teacher_only.dropped

    external = {course} | {e["src"] for e in edges
                           if e["type"] == "prerequisite_of" and e["src"] not in los_here}
    ids = [q["id"] for q in questions] + [v["id"] for v in visuals] + [x["id"] for x in entries]
    dup = [i for i, n in Counter(ids).items() if n > 1]
    if dup:
        raise AssemblyError(f"chapter {mod['chapter']}: duplicate minted ids {dup[:5]}")
    report.counts["questions"] += len(questions)
    report.counts["visuals"] += len(visuals)
    report.counts["worked_example_entries"] += len(entries)
    report.counts["claims"] += len(claims)
    return {
        "source_document": source_document(book, manifest),
        "extraction_run": extraction_run(),
        "syllabus_version": manifest.get("book", {}).get("edition") or "unversioned",
        "nodes": nodes, "edges": edges, "questions": questions, "visuals": visuals,
        "external_node_refs": sorted(external),
        "explanation_entries": entries,
        "lessons": [l.model_dump(mode="json", exclude_defaults=True) for l in lessons],
        "claims": claims,
        # what this bundle is a replay of (QA point 16): logical input name -> sha256
        "assembled_from": {k: sha256_file(p) for k, p in sorted(inputs.items())},
    }


CLAIM_ORDER = ("definition", "rule", "method", "convention", "caution")


def lesson_content(book, les: Lesson, objectives: ObjectivesFile, claims: list[dict],
                   inputs: dict[str, Path]) -> dict:
    """One lesson's content file: S2's claims, where the lesson surfaces read lesson content.

    The shape is the one the Social and Arabic content files already have (lesson-content.ts);
    only `claims`, `language` and `provenance` are new, and the app's reader ignores what it does
    not know. `subtopics` is one entry per objective, whose exposition is that objective's
    claims in the book's order — the book's own statements, joined, nothing written."""
    by_lo: dict[str, list[dict]] = defaultdict(list)
    for c in claims:
        by_lo[c["lo"]].append(c)
    subtopics = []
    for o in objectives.objectives:
        mine = sorted(by_lo.get(o.id, []), key=lambda c: CLAIM_ORDER.index(c["claim_type"])
                      if c["claim_type"] in CLAIM_ORDER else len(CLAIM_ORDER))
        text = " ".join(c["claim"] for c in mine if c["claim_type"] != "caution")
        if text:
            subtopics.append({"key": o.id, "title": normalise_pairs(o.label)[0], "exposition": text})
    return {
        "lessonId": les.slug, "title": les.title, "language": book.language, "direction": book.direction,
        "provenance": {"sections": [s.model_dump() for s in les.sections],
                       "part": les.part.model_dump() if les.part else None,
                       "chapter_intro": les.chapter_intro},
        "subtopics": subtopics, "key_terms": [], "enrichment": [], "misconceptions": [],
        "interactives": [], "passages": [], "out_of_scope": [], "qadaya": [],
        "claims": [{k: c[k] for k in ("lo", "claim_type", "claim", "anchor", "evidence_page", "evidence_kind")}
                   | ({"provenance": c["provenance"]} if c.get("provenance") else {}) for c in claims],
        "source": {"book": book.book, "assembled_by": f"{EXTRACTOR} {EXTRACTOR_VERSION}",
                   "assembled_from": {k: sha256_file(p) for k, p in sorted(inputs.items())}},
    }


MARKER_CHECK = HERE / "marker_check.mjs"


def marker_check(rows: list[dict]) -> dict:
    """Run the app's marker (marker_check.mjs) over [{id, choices}]. Raises AssemblyError when it
    cannot run: a bundle whose specs nobody checked is not assembled."""
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        raise AssemblyError("the marker check needs node (it runs the app's own answer-marker.ts); "
                            "install it, or pass --no-marker-check and say why")
    r = subprocess.run([node, "--no-warnings", str(MARKER_CHECK), "-"], input="".join(
        json.dumps(x, ensure_ascii=False) + "\n" for x in rows), capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise AssemblyError(f"the marker check could not run: {r.stderr.strip()[-400:]}")
    return json.loads(r.stdout)


def apply_marker_check(bundles: dict[str, dict], report: Report) -> None:
    rows = [{"id": q["id"], "choices": q.get("choices")} for b in bundles.values() for q in b["questions"]
            if isinstance(q.get("choices"), dict) and "marker" in q["choices"]]
    if not rows:
        return
    res = marker_check(rows)
    if res["specs_rejected"]:
        raise AssemblyError("the app's marker rejects these specs: " + "; ".join(
            f"{x['id']}: {x['why']}" for x in res["specs_rejected"][:6]))
    held = {x["id"]: x for x in res["keys_unreadable"]}
    for b in bundles.values():
        for q in b["questions"]:
            if q["id"] in held:
                q["verified"] = False
                q["hold_reason"] = q.get("hold_reason") or "unanswerable"
                report.held_by_marker.append({"id": q["id"], "key": held[q["id"]]["key"],
                                              "why": held[q["id"]]["why"]})
    report.counts["marker_specs_checked"] = res["checked"]
    report.counts["marker_keys_held"] = len(held)


def validate_bundles(bundles: dict[str, dict], all_lessons: list[Lesson]) -> list[str]:
    """schemas.SeedBundle per bundle, then the book-level rules. Empty list = fine."""
    problems: list[str] = []
    for name, b in bundles.items():
        try:
            schemas.SeedBundle.model_validate_json(json.dumps(b))
        except ValidationError as exc:
            e = exc.errors()[0]
            problems.append(f"{name}: {e.get('msg')} at {'.'.join(map(str, e.get('loc', ())))}")
    problems += check_lessons(all_lessons)
    los_by_lesson: dict[str, list[str]] = defaultdict(list)
    book_edges: list[tuple[str, str]] = []
    for b in bundles.values():
        for n in b["nodes"]:
            if n["kind"] == "learning_objective":
                los_by_lesson[book_config.lesson_slug(n["id"])].append(n["id"])
        book_edges += [(e["src"], e["dst"]) for e in b["edges"] if e["type"] == "prerequisite_of"]
    derived = derived_part_edges(all_lessons, los_by_lesson)
    if cyc := find_cycle(book_edges + derived):
        problems.append("prerequisite cycle (book edges + derived part edges, FR-4317): "
                        + " -> ".join(cyc))
    return problems


def load_inputs(manifest_path: Path, objectives_dir: Path, runs_dir: Path,
                chapters: set[int] | None):
    manifest = json.loads(manifest_path.read_text())
    pairs = manifest_lessons(manifest)
    try:
        all_lessons = [book_lesson(m, l) for m, l in pairs]
    except ValidationError as exc:
        raise AssemblyError(f"manifest lesson provenance: {exc}") from exc
    wanted = [(m, l) for (m, _), l in zip(pairs, all_lessons)
              if chapters is None or m["chapter"] in chapters]
    if not wanted:
        raise AssemblyError(f"no lessons for chapter(s) {sorted(chapters or [])} in the manifest")
    objectives: dict[str, ObjectivesFile] = {}
    runs: dict[str, LessonRun] = {}
    inputs: dict[str, dict[str, Path]] = defaultdict(dict)
    for mod, les in wanted:
        op = objectives_dir / f"{les.slug}.json"
        rp = runs_dir / f"{les.slug}.json"
        for p in (op, rp):
            if not p.exists():
                raise AssemblyError(f"{les.slug}: missing {rel(p)}")
        try:
            objectives[les.slug] = ObjectivesFile.model_validate_json(op.read_text())
            runs[les.slug] = LessonRun.model_validate_json(rp.read_text())
        except ValidationError as exc:
            raise AssemblyError(f"{les.slug}: {exc}") from exc
        if (runs[les.slug].model_extra or {}).get("draft"):
            raise AssemblyError(f"{les.slug}: {rel(rp)} is a DRAFT for G2's page (lesson-runs --draft), "
                                "written before G2 ruled on its items; assemble from the G2-signed split")
        inputs[mod["id"]].update({f"objectives/{op.name}": op, f"runs/lesson/{rp.name}": rp})
    return manifest, all_lessons, wanted, objectives, runs, inputs


def assemble(book, manifest_path: Path, objectives_dir: Path, runs_dir: Path,
             chapters: set[int] | None = None, check_markers: bool = True,
             book_pictures: bool = True, figures_dir: Path | None = None) -> tuple[dict[str, dict], Report]:
    manifest, all_lessons, wanted, objectives, runs, inputs = load_inputs(
        manifest_path, objectives_dir, runs_dir, chapters)
    prefix = book.id_prefixes[0]
    report = Report()
    report.book_pictures = book_pictures
    report.book_name = book.book
    report.figures_dir = figures_dir or book.work_dir() / "figures"
    report.figure_kinds = figure_kinds(HERE / "coverage" / f"{book.book}.figure-gaps.json")
    bundles: dict[str, dict] = {f"{prefix}-course.json": course_bundle(book, manifest)}
    by_mod: dict[str, list[Lesson]] = defaultdict(list)
    mods: dict[str, dict] = {}
    for mod, les in wanted:
        by_mod[mod["id"]].append(les)
        mods[mod["id"]] = mod
    for mid, lessons in by_mod.items():
        name = f"{mid.removeprefix('module:')}.json"
        try:
            bundles[name] = assemble_chapter(book, manifest, mods[mid], lessons, objectives, runs,
                                             report, inputs[mid] | {"manifest": manifest_path})
        except (ValidationError, ValueError) as exc:
            raise AssemblyError(f"{name}: {exc}") from exc
    for name, b in bundles.items():
        if "questions" in b:
            apply_form_rules(b, book, report)
            police_figures(b, report)
    if check_markers:   # both need node (the app's KaTeX); --no-marker-check skips them and says so
        prime_known(t for b in bundles.values() for t in _strings(b))
        bundles = {name: respace_tree(b, report) for name, b in bundles.items()}
    for b in bundles.values():               # the answer text follows the re-spaced key
        for q in b.get("questions") or []:
            ch = q.get("choices")
            if isinstance(ch, dict) and isinstance(ch.get("marker"), dict):
                q["answer"] = answer_text(ch["marker"])
    if check_markers:
        apply_marker_check(bundles, report)
    else:
        report.marker_check = "SKIPPED (--no-marker-check)"
    report.counts["lessons"] = sum(len(v) for v in by_mod.values())
    report.counts["chapters"] = len(by_mod)
    los_by_lesson: dict[str, list[str]] = defaultdict(list)
    for b in bundles.values():
        for n in b["nodes"]:
            if n["kind"] == "learning_objective":
                los_by_lesson[book_config.lesson_slug(n["id"])].append(n["id"])
    report.derived_part_edges = len(derived_part_edges(all_lessons, los_by_lesson))
    # S2's claims, served per lesson from the lesson-content files (their home)
    claims_by_lesson: dict[str, list[dict]] = defaultdict(list)
    for b in bundles.values():
        for c in b.get("claims", []):
            claims_by_lesson[book_config.lesson_slug(c["lo"])].append(c)
    for mod, les in wanted:
        lesson_inputs = {k: v for k, v in inputs[mod["id"]].items() if k.endswith(f"/{les.slug}.json")}
        report.content[les.slug] = lesson_content(book, les, objectives[les.slug],
                                                  claims_by_lesson.get(les.slug, []), lesson_inputs)
    report.counts["content_files"] = len(report.content)
    if check_markers:     # node, as the marker check; skipped with it
        prime_known(t for c in report.content.values() for t in _strings(c))
        report.content = {slug: respace_tree(c, report) for slug, c in report.content.items()}
        rows = [r for name, b in bundles.items() for r in student_texts(b, name)]
        rows += [r for slug, c in report.content.items() for r in student_texts(c, slug)]
        report.katex_errors = katex_errors(rows)
        # A2 as a hold (migration 035): a question whose own text the app's KaTeX cannot parse is broken
        # maths in front of a student — held as katex_error, never live, until the text is fixed
        broken = {e.get("where") for e in report.katex_errors}
        for b in bundles.values():
            for q in b.get("questions") or []:
                if q["id"] in broken:
                    q["verified"] = False
                    q["hold_reason"] = q.get("hold_reason") or "katex_error"
                    report.held_katex.append(q["id"])
    # every lesson of the book is checked, not only the assembled chapters
    problems = validate_bundles(bundles, all_lessons)
    if problems:
        raise AssemblyError("validation failed:\n  " + "\n  ".join(problems))
    return bundles, report


def dump(bundle: dict) -> str:
    return json.dumps(bundle, ensure_ascii=False, indent=2) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--book", required=True, help="book name or path to its config JSON")
    ap.add_argument("--chapter", type=int, action="append", help="assemble only this chapter")
    ap.add_argument("--manifest", type=Path)
    ap.add_argument("--objectives", type=Path, help="default objectives/<book>/")
    ap.add_argument("--runs", type=Path, help="default runs/<book>/lesson/")
    ap.add_argument("--out", type=Path, help="default seed/<book>/")
    ap.add_argument("--content-out", type=Path,
                    help="where the lesson-content files go (default: the bundles' sibling content/, "
                         "which for seed/<book>/ is seed/content/)")
    ap.add_argument("--report", type=Path, help="write the assembly report JSON here too")
    ap.add_argument("--check", action="store_true", help="assemble and validate, write nothing")
    ap.add_argument("--no-marker-check", action="store_true",
                    help="do not run the app's marker over the typed answers (the report says so)")
    ap.add_argument("--no-book-pictures", action="store_true",
                    help="native figures only (answer 29): no book_image stand-ins — a question whose figure "
                         "no native kind drew stays held as figure_missing. The default is answer 37d's "
                         "'book picture for now'")
    ap.add_argument("--figures-dir", type=Path, help="the book's extracted images (default work/<book>/figures)")
    ap.add_argument("--figures-out", type=Path,
                    help="where the stand-ins' images are copied for the app to serve (default "
                         "app/public/book-figures/<book>/, served as /book-figures/<book>/<file>)")
    a = ap.parse_args(argv)

    book = book_config.load_book(a.book)
    manifest = a.manifest or (book.repo_path(book.manifest) if book.manifest else None)
    if manifest is None:
        print(f"ERROR: {book.book} has no manifest; pass --manifest", file=sys.stderr)
        return 2
    objectives = a.objectives or HERE / "objectives" / book.book
    runs = a.runs or HERE / "runs" / book.book / "lesson"
    out = a.out or HERE / "seed" / book.book
    try:
        bundles, report = assemble(book, manifest, objectives, runs,
                                   set(a.chapter) if a.chapter else None, not a.no_marker_check,
                                   book_pictures=not a.no_book_pictures, figures_dir=a.figures_dir)
    except AssemblyError as exc:
        print(f"ASSEMBLY FAILED — nothing written\n  {exc}", file=sys.stderr)
        return 1
    rep = report.as_dict()
    c = rep["counts"]
    print(f"{book.book}: {c.get('chapters', 0)} chapter(s), {c.get('lessons', 0)} lesson(s), "
          f"{c.get('objectives', 0)} objective(s), {c.get('questions', 0)} book question(s), "
          f"{c.get('visuals', 0)} visual(s), {c.get('worked_example_entries', 0)} worked-example "
          f"entr(ies), {c.get('claims', 0)} claim(s)")
    print(f"  solution sources: {rep['by_solution_provenance']}")
    print(f"  answer types:     {rep['by_answer_type']}")
    print(f"  notation:         {rep['notation']['changes'] or 'nothing to normalise'} across "
          f"{rep['notation']['items_normalised']} item(s)")
    print(f"  derived part prerequisites (not written as edges): {rep['derived_part_edges']}")
    for x in rep["excluded"]:
        print(f"  not a question: {x['lesson']} {x['ref']} — {x['reason']}")
    if rep["marker_keys_unwrapped"]:
        print(f"  marker keys written as `$…$` by the typing agent, delimiters removed: {len(rep['marker_keys_unwrapped'])}")
    print(f"  the app's marker: {rep['counts'].get('marker_specs_checked', 0)} spec(s) checked, "
          f"{len(rep['held_by_marker'])} question(s) HELD because it cannot mark their key"
          + ("" if rep["marker_check"] == "run" else f" — {rep['marker_check']}"))
    for x in rep["held_by_marker"][:12]:
        print(f"    held: {x['id']} key {x['key']!r} — {x['why']}")
    print(f"  LaTeX: {rep['latex_respaced']} glued command(s) re-spaced, {rep['assignments_split']} assignment "
          f"chain(s) split; the app's KaTeX: {len(rep['katex_errors'])} error(s)")
    for x in rep["katex_errors"][:12]:
        print(f"    KaTeX: {x['where']}: {x['segment'][:80]} — {x['why'][:100]}")
    if rep["ambiguous_pairs_for_g2"]:
        print(f"  (a,b) sides of an equation, read as decimals, listed for G2: {rep['ambiguous_pairs_for_g2']}")
    for x in rep["forms_from_rules"]:
        print(f"  form from the book's rules: {x['id']} → {x['form']} (was {x['was']})")
    for x in rep["visuals_dropped"]:
        print(f"  figure dropped: {x['visual']} ({x['question']}) — {x['why']}")
    for x in rep["captions_fixed"]:
        print(f"  caption fixed: {x['visual']}: {x['now']!r} (was {x['was']!r})")
    if rep["stand_ins"]:
        print(f"  book picture for now (answer 37d): {len(rep['stand_ins'])} book_image stand-in(s) attached — "
              f"each question is live and in the console backlog as 'needs native figure'")
    for x in rep["held_reveals"]:
        print(f"  held (review, not live): {x['question']} — {x['why']}")
    if rep["held_for_figure"]:
        print(f"  held (review, not live): {len(rep['held_for_figure'])} question(s) whose stem shows [figure] "
              f"and have no figure" + ("" if report.book_pictures else " (--no-book-pictures)"))
    if rep["held_katex"]:
        print(f"  held (review, not live): {len(rep['held_katex'])} question(s) the app's KaTeX cannot render")
    sc = rep["stem_carry"]
    print(f"  multi-part exercises: {len(sc['carried'])} part(s) carry what they depend on (multipart.py), "
          f"{len({u['ref'] for u in sc['unresolved']})} part(s) listed unresolved for the review backlog")
    for x in sc["carried"]:
        print(f"    carried: {x['ref']} [{', '.join(x['rules'])} from {', '.join(x['from'])}]")
    for u in sc["unresolved"]:
        print(f"    unresolved: {u['ref']} {u['reason']} — {u['detail'][:110]}")
    if a.report:
        a.report.parent.mkdir(parents=True, exist_ok=True)
        a.report.write_text(json.dumps(rep, indent=2, ensure_ascii=False) + "\n")
    if a.check:
        print("check: valid — nothing written")
        return 0
    out.mkdir(parents=True, exist_ok=True)
    for name, b in bundles.items():
        (out / name).write_text(dump(b))
    print(f"wrote {len(bundles)} bundle(s) to {rel(out)}: {', '.join(bundles)}")
    content_out = a.content_out or out.parent / "content"
    content_out.mkdir(parents=True, exist_ok=True)
    for slug, c in report.content.items():
        (content_out / f"{slug}.json").write_text(dump(c))
    print(f"wrote {len(report.content)} lesson-content file(s) to {rel(content_out)} "
          f"({sum(len(c['claims']) for c in report.content.values())} claim(s))")
    if report.stand_ins:
        fig_out = a.figures_out or book_config.REPO_ROOT / "app" / "public" / "book-figures" / book.book
        fig_out.mkdir(parents=True, exist_ok=True)
        copied = 0
        for f in sorted({x["file"] for x in report.stand_ins}):
            src, dst = report.figures_dir / f, fig_out / f
            if not dst.exists() or dst.read_bytes() != src.read_bytes():
                shutil.copyfile(src, dst)
                copied += 1
        print(f"book pictures: {len(report.stand_ins)} stand-in(s), {copied} image(s) copied to {rel(fig_out)} "
              f"(the app serves them as /book-figures/{book.book}/<file>)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
